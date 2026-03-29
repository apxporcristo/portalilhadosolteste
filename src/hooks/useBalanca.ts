import { useState, useEffect, useCallback, useRef } from 'react';
import { getSupabaseClient } from '@/lib/supabase-external';
import { toast } from '@/hooks/use-toast';

export type SerialParity = 'none' | 'even' | 'odd';

export interface SerialConfig {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: SerialParity;
}

export interface BalancaConfig {
  id?: string;
  tipo_conexao: 'bluetooth' | 'serial' | 'usb_serial';
  dispositivo_nome: string | null;
  dispositivo_id: string | null;
  endereco_dispositivo?: string | null;
  porta_serial: string | null;
  baud_rate: number;
  data_bits?: number;
  stop_bits?: number;
  parity?: string;
  valor_peso?: number;
  ativo?: boolean;
  user_id?: string | null;
}

export type BalancaStatus =
  | 'desconectada'
  | 'conectando'
  | 'conectada'
  | 'falha'
  | 'tentando'
  | 'lendo'
  | 'aguardando_leitura'
  | 'verificando_conexao'
  | 'recuperando_conexao'
  | 'erro_leitura';

const DEFAULT_CONFIG: BalancaConfig = {
  tipo_conexao: 'serial',
  dispositivo_nome: null,
  dispositivo_id: null,
  endereco_dispositivo: null,
  porta_serial: null,
  baud_rate: 9600,
  ativo: true,
};

// Toledo Prix 3 protocol: STX (0x02) + weight digits + ETX (0x03)
function parseToledoWeight(data: string): number | null {
  const stxIdx = data.indexOf('\x02');
  const etxIdx = data.indexOf('\x03', stxIdx);
  if (stxIdx === -1 || etxIdx === -1) return null;
  const payload = data.substring(stxIdx + 1, etxIdx).trim();
  const match = payload.match(/(\d+[.,]?\d*)/);
  if (!match) return null;
  const numStr = match[1].replace(',', '.');
  const value = parseFloat(numStr);
  const hasDecimal = numStr.includes('.');
  // If explicit decimal, use as-is; otherwise treat as grams
  const kg = hasDecimal ? value : value / 1000;
  console.log('[Balança] parseToledoWeight: bruto=', match[1], 'hasDecimal=', hasDecimal, 'kg=', kg);
  return kg > 0 && kg < 999 ? Math.round(kg * 1000) / 1000 : null;
}

function parseToledoWeightBytes(bytes: Uint8Array): number | null {
  const str = new TextDecoder().decode(bytes);
  return parseToledoWeight(str);
}

// Persistent BT state (module-level to survive re-renders)
let _btDevice: any = null;
let _btServer: any = null;
let _btCharacteristic: any = null;

const SERIAL_CONFIG_KEY = 'balanca_serial_config';

function loadSerialConfig(): SerialConfig {
  try {
    const raw = localStorage.getItem(SERIAL_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' };
}

function saveSerialConfig(sc: SerialConfig): void {
  try { localStorage.setItem(SERIAL_CONFIG_KEY, JSON.stringify(sc)); } catch { /* ignore */ }
}

export function useBalanca() {
  const [config, setConfig] = useState<BalancaConfig>(DEFAULT_CONFIG);
  const [allConfigs, setAllConfigs] = useState<BalancaConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<BalancaStatus>('desconectada');
  const [tentativa, setTentativa] = useState(0);
  const [serialPort, setSerialPort] = useState<any>(null);
  const [serialConfig, setSerialConfigState] = useState<SerialConfig>(loadSerialConfig);
  const autoConnectAttempted = useRef(false);
  const activeReaderRef = useRef<any>(null);
  const readingInProgressRef = useRef(false);
  const consecutiveReadFailuresRef = useRef(0);
  const lastValidReadAtRef = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatRunningRef = useRef(false);

  const updateSerialConfig = useCallback((partial: Partial<SerialConfig>) => {
    setSerialConfigState(prev => {
      const next = { ...prev, ...partial };
      saveSerialConfig(next);
      return next;
    });
  }, []);

  const connected =
    status === 'conectada'
    || status === 'lendo'
    || status === 'aguardando_leitura'
    || status === 'verificando_conexao'
    || status === 'recuperando_conexao';

  const mapRowToConfig = (row: any): BalancaConfig => ({
    id: row.id,
    tipo_conexao: row.tipo_conexao || 'serial',
    dispositivo_nome: row.dispositivo_nome || null,
    dispositivo_id: row.dispositivo_id || null,
    endereco_dispositivo: row.endereco_dispositivo || null,
    porta_serial: row.porta_serial || null,
    baud_rate: row.baud_rate || 9600,
    data_bits: row.data_bits ?? 8,
    stop_bits: row.stop_bits ?? 1,
    parity: row.parity || 'none',
    ativo: row.ativo ?? false,
    user_id: row.user_id || null,
  });

  const fetchConfig = useCallback(async () => {
    try {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase.from('balanca_config' as any).select('*').order('ativo', { ascending: false });
      if (error) console.error('Erro ao buscar config balança:', error);
      if (data && (data as any[]).length > 0) {
        const configs = (data as any[]).map(mapRowToConfig);
        setAllConfigs(configs);
        const active = configs.find(c => c.ativo) || configs[0];
        setConfig(active);
      }
    } catch (err) {
      console.error('Erro fetchConfig balança:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const saveConfig = useCallback(async (newConfig: BalancaConfig, options?: { silent?: boolean }) => {
    try {
      const supabase = await getSupabaseClient();
      const payload: any = {
        tipo_conexao: newConfig.tipo_conexao,
        dispositivo_nome: newConfig.dispositivo_nome || null,
        dispositivo_id: newConfig.dispositivo_id || null,
        endereco_dispositivo: newConfig.endereco_dispositivo || null,
        porta_serial: newConfig.porta_serial || null,
        baud_rate: newConfig.baud_rate,
        data_bits: newConfig.data_bits ?? 8,
        stop_bits: newConfig.stop_bits ?? 1,
        parity: newConfig.parity || 'none',
        ativo: newConfig.ativo ?? true,
      };

      if (newConfig.id) {
        // UPDATE existing record
        const { error } = await supabase.from('balanca_config' as any)
          .update({ ...payload, updated_at: new Date().toISOString() } as any)
          .eq('id', newConfig.id);
        if (error) {
          console.error('Erro ao atualizar balança:', error);
          toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
          return;
        }
      } else {
        // Check for existing record with same dispositivo_id or endereco_dispositivo
        let existingId: string | null = null;
        if (newConfig.dispositivo_id) {
          const { data: existing } = await supabase.from('balanca_config' as any)
            .select('id')
            .eq('dispositivo_id', newConfig.dispositivo_id)
            .limit(1)
            .maybeSingle();
          if (existing) existingId = (existing as any).id;
        }
        if (!existingId && newConfig.endereco_dispositivo) {
          const { data: existing } = await supabase.from('balanca_config' as any)
            .select('id')
            .eq('endereco_dispositivo', newConfig.endereco_dispositivo)
            .limit(1)
            .maybeSingle();
          if (existing) existingId = (existing as any).id;
        }

        if (existingId) {
          // Update existing instead of inserting duplicate
          const { error } = await supabase.from('balanca_config' as any)
            .update({ ...payload, updated_at: new Date().toISOString() } as any)
            .eq('id', existingId);
          if (error) {
            console.error('Erro ao atualizar balança existente:', error);
            toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
            return;
          }
          newConfig = { ...newConfig, id: existingId };
        } else {
          // INSERT new record
          const { data, error } = await supabase.from('balanca_config' as any)
            .insert(payload as any)
            .select()
            .single();
          if (error) {
            console.error('Erro ao inserir balança:', error);
            toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
            return;
          }
          if (data) newConfig = { ...newConfig, id: (data as any).id };
        }
      }

      // If this config is active, deactivate others
      if (newConfig.ativo && newConfig.id) {
        const supabase2 = await getSupabaseClient();
        await supabase2.from('balanca_config' as any)
          .update({ ativo: false, updated_at: new Date().toISOString() } as any)
          .neq('id', newConfig.id);
      }

      setConfig(newConfig);
      await fetchConfig(); // Refresh all configs
      if (!options?.silent) {
        toast({ title: 'Configuração da balança salva' });
      }
    } catch (err) {
      console.error('Erro saveConfig balança:', err);
      toast({ title: 'Erro ao salvar', description: 'Falha inesperada ao salvar configuração.', variant: 'destructive' });
    }
  }, [fetchConfig]);

  const deleteBalancaConfig = useCallback(async (id: string) => {
    try {
      const supabase = await getSupabaseClient();
      const { error } = await supabase.from('balanca_config' as any).delete().eq('id', id);
      if (error) {
        toast({ title: 'Erro ao excluir', description: error.message, variant: 'destructive' });
        return;
      }
      toast({ title: 'Balança excluída' });
      await fetchConfig();
    } catch (err) {
      console.error('Erro deleteConfig balança:', err);
    }
  }, [fetchConfig]);

  const activateConfig = useCallback(async (id: string) => {
    try {
      const supabase = await getSupabaseClient();
      // Deactivate all
      await supabase.from('balanca_config' as any)
        .update({ ativo: false, updated_at: new Date().toISOString() } as any)
        .neq('id', '00000000-0000-0000-0000-000000000000'); // update all
      // Activate the chosen one
      await supabase.from('balanca_config' as any)
        .update({ ativo: true, updated_at: new Date().toISOString() } as any)
        .eq('id', id);
      toast({ title: 'Balança ativada' });
      await fetchConfig();
    } catch (err) {
      console.error('Erro activateConfig:', err);
    }
  }, [fetchConfig]);

  const persistConnectedConfig = useCallback(async (patch?: Partial<BalancaConfig>) => {
    const nextConfig: BalancaConfig = {
      ...config,
      ...(patch || {}),
    };
    await saveConfig(nextConfig, { silent: true });
  }, [config, saveConfig]);

  const reconnectSerialFromGrantedPorts = useCallback(async (): Promise<boolean> => {
    try {
      if (typeof navigator === 'undefined' || !('serial' in navigator)) return false;

      if (serialPort?.readable) {
        setStatus('conectada');
        return true;
      }

      const ports = await (navigator as any).serial.getPorts();
      if (!ports?.length) return false;

      const port = ports[0];
      if (!port.readable) {
        await port.open({
          baudRate: serialConfig.baudRate,
          dataBits: serialConfig.dataBits,
          stopBits: serialConfig.stopBits,
          parity: serialConfig.parity,
        });
      }

      setSerialPort(port);
      setStatus('conectada');

      const info = port.getInfo?.();
      const serialId = info?.usbVendorId && info?.usbProductId
        ? `${info.usbVendorId}:${info.usbProductId}`
        : config.dispositivo_id;

      await persistConnectedConfig({
        tipo_conexao: config.tipo_conexao,
        dispositivo_nome: config.dispositivo_nome || 'Web Serial',
        dispositivo_id: serialId || null,
      });
      return true;
    } catch (err) {
      console.warn('[Balança] Não foi possível reconectar porta serial já autorizada:', err);
      return false;
    }
  }, [serialPort, serialConfig, config.tipo_conexao, config.dispositivo_nome, config.dispositivo_id, persistConnectedConfig]);

  const canUseWebSerialForBluetooth = useCallback((): boolean => {
    return config.tipo_conexao === 'bluetooth'
      && !window.IS_ANDROID_APP
      && typeof navigator !== 'undefined'
      && 'serial' in navigator;
  }, [config.tipo_conexao]);

  const stopHeartbeat = useCallback((reason = 'manual') => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (heartbeatRunningRef.current) {
      console.log(`[Balança][Heartbeat] Parado (${reason})`);
    }
    heartbeatRunningRef.current = false;
  }, []);

  const releaseActiveReader = useCallback(async (reason = 'unknown') => {
    const reader = activeReaderRef.current;
    if (!reader) return;

    console.log(`[Balança][Reader] Liberando lock (${reason})`);
    try { await reader.cancel(); } catch { /* ignore */ }
    try { reader.releaseLock(); } catch { /* ignore */ }
    activeReaderRef.current = null;
  }, []);

  const ensureSerialPortReady = useCallback(async (): Promise<any | null> => {
    if (typeof navigator === 'undefined' || !('serial' in navigator)) return null;

    try {
      if (serialPort?.readable) {
        console.log('[Balança][Serial] Reutilizando porta já aberta');
        return serialPort;
      }

      const ports = await (navigator as any).serial.getPorts();
      if (!ports?.length) {
        console.log('[Balança][Serial] Nenhuma porta previamente autorizada');
        return null;
      }

      const openPort = ports.find((p: any) => p.readable);
      if (openPort) {
        setSerialPort(openPort);
        console.log('[Balança][Serial] Reutilizando porta autorizada já aberta');
        return openPort;
      }

      const candidate = ports[0];
      await candidate.open({
        baudRate: serialConfig.baudRate,
        dataBits: serialConfig.dataBits,
        stopBits: serialConfig.stopBits,
        parity: serialConfig.parity,
      });
      setSerialPort(candidate);
      console.log('[Balança][Serial] Porta autorizada reaberta com sucesso');
      return candidate;
    } catch (err) {
      console.warn('[Balança][Serial] Falha ao preparar porta serial:', err);
      return null;
    }
  }, [serialPort, serialConfig]);

  const readFromSerialPort = useCallback(async (
    port: any,
    options?: { timeoutMs?: number; emitStatus?: boolean; origin?: string },
  ): Promise<number | null> => {
    const timeoutMs = options?.timeoutMs ?? 3500;
    const emitStatus = options?.emitStatus ?? true;
    const origin = options?.origin ?? 'read';

    if (!port?.readable) return null;

    for (let i = 0; i < 8 && readingInProgressRef.current; i++) {
      await new Promise(r => setTimeout(r, 120));
    }

    if (readingInProgressRef.current) {
      console.warn(`[Balança][Serial] Leitura concorrente detectada (${origin}), ignorando`);
      return null;
    }

    readingInProgressRef.current = true;
    if (emitStatus) setStatus('lendo');

    try {
      if (port.readable.locked) {
        console.warn(`[Balança][Serial] Stream locked antes da leitura (${origin}), resetando reader`);
        await releaseActiveReader(`pre-read-${origin}`);
      }

      if (port.writable && !port.writable.locked) {
        try {
          const writer = port.writable.getWriter();
          try {
            await writer.write(new Uint8Array([0x05])); // ENQ
          } finally {
            writer.releaseLock();
          }
        } catch (writeErr) {
          console.warn(`[Balança][Serial] Falha ao enviar ENQ (${origin}):`, writeErr);
        }
      }

      const reader = port.readable.getReader();
      activeReaderRef.current = reader;

      const decoder = new TextDecoder();
      let buffer = '';
      const timer = setTimeout(() => {
        try { reader.cancel(); } catch { /* ignore */ }
      }, timeoutMs);

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          console.log(`[Balança][Serial] Chunk recebido (${origin}):`, JSON.stringify(chunk));

          const parsedFromBuffer = parseToledoWeight(buffer);
          if (parsedFromBuffer !== null && parsedFromBuffer > 0) {
            clearTimeout(timer);
            lastValidReadAtRef.current = Date.now();
            consecutiveReadFailuresRef.current = 0;
            console.log(`[Balança][Serial] Leitura válida (${origin}):`, parsedFromBuffer.toFixed(3), 'kg');
            if (emitStatus) setStatus('aguardando_leitura');
            return parsedFromBuffer;
          }

          const lines = buffer.split(/[\r\n]+/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            const parsedLine = parseToledoWeight(line);
            if (parsedLine !== null && parsedLine > 0) {
              clearTimeout(timer);
              lastValidReadAtRef.current = Date.now();
              consecutiveReadFailuresRef.current = 0;
              console.log(`[Balança][Serial] Leitura válida por linha (${origin}):`, parsedLine.toFixed(3), 'kg');
              if (emitStatus) setStatus('aguardando_leitura');
              return parsedLine;
            }
          }

          if (buffer.length > 2048) {
            buffer = buffer.slice(-256);
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      console.warn(`[Balança][Serial] Falha na leitura (${origin}):`, err);
    } finally {
      await releaseActiveReader(`post-read-${origin}`);
      readingInProgressRef.current = false;
    }

    return null;
  }, [releaseActiveReader]);

  const recoverSerialConnection = useCallback(async (reason: string): Promise<boolean> => {
    console.warn(`[Balança][Recovery] Iniciando recuperação: ${reason}`);
    setStatus('recuperando_conexao');

    // Nível 1: reinicia apenas reader/stream
    await releaseActiveReader(`recover-l1-${reason}`);
    let port = await ensureSerialPortReady();
    if (port) {
      console.log('[Balança][Recovery] Nível 1: tentando recuperar reader na mesma porta');
      const probe = await readFromSerialPort(port, { timeoutMs: 2200, emitStatus: false, origin: 'recover-l1' });
      if (probe !== null && probe > 0) {
        console.log('[Balança][Recovery] Nível 1 OK');
        setStatus('aguardando_leitura');
        return true;
      }
    }

    // Nível 2: reabre leitura na mesma porta autorizada
    try {
      const ports = typeof navigator !== 'undefined' && 'serial' in navigator
        ? await (navigator as any).serial.getPorts()
        : [];
      const candidate = port || ports?.[0];
      if (candidate) {
        console.log('[Balança][Recovery] Nível 2: reabrindo porta existente');
        try {
          await releaseActiveReader('recover-l2-before-close');
          if (candidate.readable) {
            await candidate.close();
          }
        } catch (closeErr) {
          console.warn('[Balança][Recovery] Falha ao fechar porta no nível 2:', closeErr);
        }

        await candidate.open({
          baudRate: serialConfig.baudRate,
          dataBits: serialConfig.dataBits,
          stopBits: serialConfig.stopBits,
          parity: serialConfig.parity,
        });

        setSerialPort(candidate);
        port = candidate;

        const probe = await readFromSerialPort(port, { timeoutMs: 2500, emitStatus: false, origin: 'recover-l2' });
        if (probe !== null && probe > 0) {
          console.log('[Balança][Recovery] Nível 2 OK');
          setStatus('aguardando_leitura');
          return true;
        }
      }
    } catch (err) {
      console.warn('[Balança][Recovery] Nível 2 falhou:', err);
    }

    // Nível 3: perda real de conexão
    console.error('[Balança][Recovery] Nível 3: conexão perdida, aguardando reconexão manual/automática controlada');
    setStatus('falha');
    return false;
  }, [ensureSerialPortReady, readFromSerialPort, releaseActiveReader, serialConfig]);

  // ========== BLUETOOTH CONNECTION ==========
  // Web Bluetooth (BLE/GATT) does NOT work with classic serial scales (SPP/RFCOMM).
  // Scales like Toledo Prix 3 use Bluetooth Classic, which Chrome/Web Bluetooth cannot access.
  // All BT scale communication must go through the Android Bridge (APK auxiliar).

  const isBtConnected = useCallback((): boolean => {
    // In Android app, check via bridge
    if (window.IS_ANDROID_APP) {
      return window.AndroidBridge?.isScaleConnected?.() ?? false;
    }
    // In browser, BT scale is never connected (not supported)
    return false;
  }, []);

  // Try to reconnect via Android Bridge
  const reconnectSavedDevice = useCallback(async (): Promise<boolean> => {
    if (canUseWebSerialForBluetooth()) {
      return reconnectSerialFromGrantedPorts();
    }

    if (isBtConnected()) {
      setStatus('conectada');
      return true;
    }
    // Only works through Android Bridge
    if (window.IS_ANDROID_APP && window.AndroidBridge?.connectScale) {
      const address = config.dispositivo_id || '';
      if (!address) return false;
      console.log('[Balança] Tentando reconectar via AndroidBridge:', address);
      const ok = window.AndroidBridge.connectScale(address, config.baud_rate);
      setStatus(ok ? 'conectada' : 'falha');
      if (ok) {
        await persistConnectedConfig({
          tipo_conexao: config.tipo_conexao,
          dispositivo_id: address,
        });
      }
      return ok;
    }
    return false;
  }, [canUseWebSerialForBluetooth, reconnectSerialFromGrantedPorts, isBtConnected, config.dispositivo_id, config.baud_rate, config.tipo_conexao, persistConnectedConfig]);

  // Auto-reconnect on mount using saved config
  useEffect(() => {
    if (!loading && !autoConnectAttempted.current) {
      autoConnectAttempted.current = true;

      if (config.tipo_conexao === 'bluetooth' && config.dispositivo_id) {
        reconnectSavedDevice().then(ok => {
          if (ok) {
            console.log('Balança BT reconectada automaticamente');
          } else {
            console.log('Auto-reconexão BT falhou, aguardando ação manual');
          }
        });
      }

      if ((config.tipo_conexao === 'serial' || config.tipo_conexao === 'usb_serial')) {
        reconnectSerialFromGrantedPorts().then(ok => {
          if (ok) {
            console.log('Balança Serial reconectada automaticamente');
          }
        });
      }
    }
  }, [loading, config.tipo_conexao, config.dispositivo_id, reconnectSavedDevice, reconnectSerialFromGrantedPorts]);

  // Reconnect with 3 retries, then fallback to new pairing
  const connectBluetoothWithRetries = useCallback(async (): Promise<boolean> => {
    if (canUseWebSerialForBluetooth()) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        setStatus('tentando');
        setTentativa(attempt);
        const ok = await reconnectSerialFromGrantedPorts();
        if (ok) {
          setTentativa(0);
          return true;
        }
        if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
      }
      setTentativa(0);
      setStatus('falha');
      return false;
    }

    // Already connected?
    if (isBtConnected()) {
      setStatus('conectada');
      return true;
    }

    // Try 3 reconnection attempts
    for (let attempt = 1; attempt <= 3; attempt++) {
      setStatus('tentando');
      setTentativa(attempt);
      const ok = await reconnectSavedDevice();
      if (ok) {
        setTentativa(0);
        return true;
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
    }

    setTentativa(0);
    setStatus('falha');
    return false;
  }, [canUseWebSerialForBluetooth, reconnectSerialFromGrantedPorts, isBtConnected, reconnectSavedDevice]);

  const listarDispositivosPareadosAndroid = useCallback((): Array<{ name: string; address: string }> => {
    try {
      const raw = window.AndroidBridge?.listPairedDevices?.();
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }, []);


  const parearNovoDispositivo = useCallback(async (): Promise<boolean> => {
    if (window.IS_ANDROID_APP && window.AndroidBridge?.listPairedDevices) {
      // In Android app, list paired devices and let user pick
      const devices = listarDispositivosPareadosAndroid();
      if (devices.length === 0) {
        toast({ title: 'Nenhum dispositivo pareado', description: 'Pareie a balança nas configurações Bluetooth do Android primeiro.', variant: 'destructive' });
        return false;
      }
      // Connect to first device as default (user can change in settings)
      const first = devices[0];
      const ok = window.AndroidBridge.connectScale!(first.address, config.baud_rate);
      if (ok) {
        const newConfig: BalancaConfig = {
          ...config,
          dispositivo_nome: first.name,
          dispositivo_id: first.address,
        };
        await saveConfig(newConfig);
        setStatus('conectada');
        toast({ title: 'Balança conectada', description: `Conectado a: ${first.name}` });
        return true;
      }
      setStatus('falha');
      return false;
    }

    // Try Web Serial API (Chrome Android 89+)
    const hasWebSerial = typeof navigator !== 'undefined' && 'serial' in navigator;
    if (hasWebSerial) {
      let port: any = null;
      try {
        // Close ALL previously opened ports (granted + state) before selecting a new one
        try {
          const grantedPorts = await (navigator as any).serial.getPorts();
          for (const gp of grantedPorts) {
            try {
              if (gp?.readable) {
                const reader = gp.readable.getReader();
                await reader.cancel().catch(() => {});
                reader.releaseLock();
              }
              if (gp?.writable) {
                const writer = gp.writable.getWriter();
                await writer.close().catch(() => {});
                writer.releaseLock();
              }
              await gp.close();
            } catch { /* ignore individual port close errors */ }
          }
        } catch { /* ignore */ }
        if (serialPort) setSerialPort(null);

        console.log('[Balança] Solicitando porta serial...');
        port = await (navigator as any).serial.requestPort();
        console.log('[Balança] Porta selecionada, info:', port.getInfo?.() || 'N/A');

        const openOpts = {
          baudRate: serialConfig.baudRate,
          dataBits: serialConfig.dataBits,
          stopBits: serialConfig.stopBits,
          parity: serialConfig.parity,
        };
        console.log('[Balança] Abrindo porta com config:', JSON.stringify(openOpts));

        await port.open(openOpts);
        console.log('[Balança] Porta aberta com sucesso');
      } catch (openErr: any) {
        // If port is already open (e.g. reselected same port), try using it directly
        if (port && (openErr?.message?.includes('already open') || port?.readable)) {
          console.log('[Balança] Porta já estava aberta, reutilizando...');
        } else {
          throw openErr;
        }
      }

      try {
        setSerialPort(port);
        setStatus('conectada');

        const info = port.getInfo?.();
        const serialId = info?.usbVendorId && info?.usbProductId
          ? `${info.usbVendorId}:${info.usbProductId}`
          : config.dispositivo_id;

        const newConfig: BalancaConfig = {
          ...config,
          tipo_conexao: config.tipo_conexao,
          dispositivo_nome: config.dispositivo_nome || 'Web Serial',
          dispositivo_id: serialId || null,
        };
        await saveConfig(newConfig);
        toast({ title: 'Balança conectada', description: 'Conectado via Web Serial.' });
        return true;
      } catch (err: any) {
        console.error('[Balança] Web Serial erro bruto:', err);
        console.error('[Balança] Web Serial erro name:', err?.name, 'message:', err?.message);
        if (err?.name === 'NotFoundError') {
          toast({ title: 'Nenhuma porta selecionada', description: 'Usuário cancelou a seleção da porta.', variant: 'destructive' });
        } else if (err?.message?.includes('already open')) {
          toast({
            title: 'Porta já em uso',
            description: 'Feche outras abas que possam estar usando a balança e tente novamente.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Falha ao abrir a porta serial',
            description: `${err?.message || 'Verifique se a balança está livre, pareada e com configuração serial correta.'}`,
            variant: 'destructive',
          });
        }
        setStatus('falha');
        return false;
      }
    } else {
      toast({
        title: 'Web Serial não suportado',
        description: 'Abra no Chrome Android 89+ para conectar a balança, ou use o app auxiliar.',
        variant: 'destructive',
      });
    }
    return false;
  }, [config, serialConfig, saveConfig, listarDispositivosPareadosAndroid]);

  // List previously paired BT devices (only via Android Bridge)
  const listarDispositivosPareados = useCallback(async (): Promise<Array<{ id: string; name: string; device: any }>> => {
    if (window.IS_ANDROID_APP) {
      return listarDispositivosPareadosAndroid().map(d => ({
        id: d.address,
        name: d.name,
        device: d,
      }));
    }
    return [];
  }, [listarDispositivosPareadosAndroid]);

  // Connect to a specific device from the list (via Android Bridge)
  const conectarDispositivo = useCallback(async (device: any): Promise<boolean> => {
    if (window.IS_ANDROID_APP && window.AndroidBridge?.connectScale) {
      const address = device.address || device.id;
      const ok = window.AndroidBridge.connectScale(address, config.baud_rate);
      if (ok) {
        const newConfig: BalancaConfig = {
          ...config,
          dispositivo_nome: device.name || 'Balança BT',
          dispositivo_id: address,
        };
        await saveConfig(newConfig);
        setStatus('conectada');
        return true;
      }
      setStatus('falha');
    }
    return false;
  }, [config, saveConfig]);

  const lerPesoAndroid = useCallback((): number | null => {
    try {
      const bridge = window.AndroidBridge;
      if (!bridge || !bridge.readScale) return null;
      const raw = bridge.readScale();
      console.log('[Balança] AndroidBridge.readScale() retornou:', raw);
      if (!raw) return null;
      const parsed = parseToledoWeight(raw);
      if (parsed !== null) return parsed;
      // Fallback: try plain number
      const numStr = raw.replace(',', '.').trim();
      const num = parseFloat(numStr);
      if (isNaN(num) || num <= 0) return null;
      const hasDecimal = numStr.includes('.');
      const kg = hasDecimal ? num : num / 1000;
      console.log('[Balança] Android fallback: bruto=', raw, 'hasDecimal=', hasDecimal, 'kg=', kg);
      return Math.round(kg * 1000) / 1000;
    } catch {
      return null;
    }
  }, []);

  // Read weight via Android Bridge (Bluetooth Classic serial)
  const lerPesoBluetooth = useCallback(async (): Promise<number | null> => {
    return lerPesoAndroid();
  }, [lerPesoAndroid]);

  const lerPesoSerial = useCallback(async (): Promise<number | null> => {
    try {
      if (!('serial' in navigator)) return null;
      const port = await ensureSerialPortReady();
      if (!port) {
        console.log('[Balança] Nenhuma porta serial disponível para leitura.');
        return null;
      }

      const result = await readFromSerialPort(port, { origin: 'lerPesoSerial' });
      if (result !== null && result > 0) {
        consecutiveReadFailuresRef.current = 0;
        return result;
      }

      // Increment failure counter; try recovery if threshold reached
      consecutiveReadFailuresRef.current++;
      console.warn(`[Balança] Falhas consecutivas: ${consecutiveReadFailuresRef.current}`);
      if (consecutiveReadFailuresRef.current >= 2) {
        const recovered = await recoverSerialConnection('consecutive-read-failures');
        if (recovered) {
          consecutiveReadFailuresRef.current = 0;
          // Retry once after recovery
          const retryResult = await readFromSerialPort(port, { origin: 'lerPesoSerial-retry' });
          if (retryResult !== null && retryResult > 0) return retryResult;
        }
      }

      return null;
    } catch (err) {
      console.error('[Balança] Erro serial:', err);
      return null;
    }
  }, [ensureSerialPortReady, readFromSerialPort, recoverSerialConnection]);
  const conectarBalancaAndroid = useCallback((): boolean => {
    const bridge = window.AndroidBridge;
    if (!bridge?.connectScale) return false;
    const address = config.dispositivo_id || '';
    if (!address) {
      toast({ title: 'Dispositivo não configurado', description: 'Configure o endereço da balança em balanca_config.', variant: 'destructive' });
      return false;
    }
    console.log('[Balança] connectScale:', address, 'baud:', config.baud_rate);
    const ok = bridge.connectScale(address, config.baud_rate);
    setStatus(ok ? 'conectada' : 'falha');
    return ok;
  }, [config.dispositivo_id, config.baud_rate]);

  const desconectarBalancaAndroid = useCallback(() => {
    window.AndroidBridge?.disconnectScale?.();
    setStatus('desconectada');
  }, []);

  const isScaleConnectedAndroid = useCallback((): boolean => {
    return window.AndroidBridge?.isScaleConnected?.() ?? false;
  }, []);

  // (listarDispositivosPareadosAndroid moved above parearNovoDispositivo)

  // Main read function - prioritizes AndroidBridge, then persistent BT/serial
  const lerPeso = useCallback(async (retries = 3): Promise<number | null> => {
    // Always try Android Bridge first (works with auxiliary app)
    const pesoAndroid = lerPesoAndroid();
    if (pesoAndroid !== null && pesoAndroid > 0) return pesoAndroid;

    for (let attempt = 1; attempt <= retries; attempt++) {
      // Serial/USB
      if (config.tipo_conexao === 'serial' || config.tipo_conexao === 'usb_serial') {
        const peso = await lerPesoSerial();
        if (peso !== null && peso > 0) return peso;
      }

      // Bluetooth via Web Bluetooth (only in Android app context, skip in browser)
      if (config.tipo_conexao === 'bluetooth') {
        if (window.IS_ANDROID_APP) {
          // In Android app, try Web Bluetooth connection
          if (!isBtConnected()) {
            const reconnected = await reconnectSavedDevice();
            if (!reconnected) continue;
          }
          const pesoBt = await lerPesoBluetooth();
          if (pesoBt !== null && pesoBt > 0) return pesoBt;
        } else if (canUseWebSerialForBluetooth()) {
          const pesoSerial = await lerPesoSerial();
          if (pesoSerial !== null && pesoSerial > 0) return pesoSerial;
        }
      }

      if (attempt < retries) await new Promise(r => setTimeout(r, 1000));
    }

    // All retries failed for BT
    if (config.tipo_conexao === 'bluetooth') {
      const hasWebSerial = typeof navigator !== 'undefined' && 'serial' in navigator;
      if (hasWebSerial) {
        toast({ title: 'Balança não respondeu', description: 'Tente conectar pela opção Web Serial na tela de pesagem.' });
      } else if (window.IS_ANDROID_APP) {
        toast({ title: 'Balança não respondeu', description: 'Verifique se o app auxiliar está conectado à balança.' });
      } else {
        toast({ title: 'Balança não respondeu', description: 'Use o Chrome Android com Web Serial ou digite o peso manualmente.' });
      }
    }

    return null;
  }, [config.tipo_conexao, canUseWebSerialForBluetooth, lerPesoSerial, lerPesoAndroid, lerPesoBluetooth, isBtConnected, reconnectSavedDevice]);

  const testarConexao = useCallback(async (): Promise<boolean> => {
    if (config.tipo_conexao === 'bluetooth' || config.tipo_conexao === 'serial' || config.tipo_conexao === 'usb_serial') {
      const bluetoothViaWebSerial = config.tipo_conexao === 'bluetooth' && canUseWebSerialForBluetooth();

      const ok = config.tipo_conexao === 'bluetooth'
        ? (bluetoothViaWebSerial ? await reconnectSerialFromGrantedPorts() : await connectBluetoothWithRetries())
        : await reconnectSerialFromGrantedPorts();

      if (!ok) {
        toast({ title: 'Falha na conexão', description: 'Não foi possível conectar à balança. Tente conectar novamente.', variant: 'destructive' });
        return false;
      }

      const peso = config.tipo_conexao === 'bluetooth'
        ? (bluetoothViaWebSerial ? await lerPesoSerial() : await lerPesoBluetooth())
        : await lerPesoSerial();
      if (peso !== null) {
        toast({ title: 'Conexão OK', description: `Peso lido: ${peso.toFixed(3)} kg` });
        return true;
      }

      toast({ title: 'Conectada', description: 'Balança conectada, mas sem leitura de peso no momento.' });
      return true;
    }

    const peso = await lerPeso();
    if (peso !== null) {
      toast({ title: 'Conexão OK', description: `Peso lido: ${peso.toFixed(3)} kg` });
      setStatus('conectada');
      return true;
    }
    toast({ title: 'Falha na conexão', description: 'Não foi possível ler peso da balança.', variant: 'destructive' });
    setStatus('falha');
    return false;
  }, [config.tipo_conexao, canUseWebSerialForBluetooth, connectBluetoothWithRetries, reconnectSerialFromGrantedPorts, lerPesoBluetooth, lerPesoSerial, lerPeso]);

  const verificarConexaoHeartbeat = useCallback(async (): Promise<boolean> => {
    if (config.tipo_conexao === 'bluetooth') {
      if (window.IS_ANDROID_APP) {
        const ok = isScaleConnectedAndroid();
        setStatus(ok ? 'conectada' : 'desconectada');
        return ok;
      }
      if (canUseWebSerialForBluetooth()) {
        const port = await ensureSerialPortReady();
        if (!port) {
          setStatus('desconectada');
          return false;
        }
        // Functional probe: try a quick read to verify stream is alive
        if (!readingInProgressRef.current) {
          setStatus('verificando_conexao');
          const probe = await readFromSerialPort(port, { timeoutMs: 2000, emitStatus: false, origin: 'heartbeat-probe' });
          if (probe !== null && probe > 0) {
            console.log('[Balança][Heartbeat] Conexão funcional, peso probe:', probe.toFixed(3));
            consecutiveReadFailuresRef.current = 0;
            setStatus('aguardando_leitura');
            return true;
          }
          // Probe returned null but port still exists — still "connected" but may be stale
          if (port.readable) {
            consecutiveReadFailuresRef.current++;
            if (consecutiveReadFailuresRef.current >= 3) {
              console.warn('[Balança][Heartbeat] Falhas consecutivas no probe, tentando recuperação');
              const recovered = await recoverSerialConnection('heartbeat-probe-failures');
              return recovered;
            }
            setStatus('aguardando_leitura');
            return true;
          }
          setStatus('desconectada');
          return false;
        }
        // Reading in progress — connection is alive
        return true;
      }
      const ok = isBtConnected();
      setStatus(ok ? 'conectada' : 'desconectada');
      return ok;
    }

    if (config.tipo_conexao === 'serial' || config.tipo_conexao === 'usb_serial') {
      const port = await ensureSerialPortReady();
      if (!port) {
        setStatus('desconectada');
        return false;
      }
      if (!readingInProgressRef.current) {
        setStatus('verificando_conexao');
        const probe = await readFromSerialPort(port, { timeoutMs: 2000, emitStatus: false, origin: 'heartbeat-serial' });
        if (probe !== null && probe > 0) {
          consecutiveReadFailuresRef.current = 0;
          setStatus('aguardando_leitura');
          return true;
        }
        if (port.readable) {
          consecutiveReadFailuresRef.current++;
          if (consecutiveReadFailuresRef.current >= 3) {
            const recovered = await recoverSerialConnection('heartbeat-serial-failures');
            return recovered;
          }
          setStatus('aguardando_leitura');
          return true;
        }
        setStatus('desconectada');
        return false;
      }
      return true;
    }

    return false;
  }, [config.tipo_conexao, canUseWebSerialForBluetooth, isScaleConnectedAndroid, isBtConnected, ensureSerialPortReady, readFromSerialPort, recoverSerialConnection]);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat('restart');
    console.log('[Balança][Heartbeat] Iniciando intervalo de 10s');
    heartbeatRunningRef.current = true;
    heartbeatIntervalRef.current = setInterval(async () => {
      if (!heartbeatRunningRef.current) return;
      console.log('[Balança][Heartbeat] Tick');
      await verificarConexaoHeartbeat();
    }, 10_000);
  }, [stopHeartbeat, verificarConexaoHeartbeat]);

  const garantirConexaoComTentativas = useCallback(async (maxTentativas = 3): Promise<boolean> => {
    const conectado = await verificarConexaoHeartbeat();
    if (conectado) return true;

    for (let attempt = 1; attempt <= maxTentativas; attempt++) {
      setStatus('tentando');
      setTentativa(attempt);

      const ok = config.tipo_conexao === 'bluetooth'
        ? (canUseWebSerialForBluetooth() ? await reconnectSerialFromGrantedPorts() : await reconnectSavedDevice())
        : await reconnectSerialFromGrantedPorts();

      if (ok) {
        setTentativa(0);
        setStatus('conectada');
        return true;
      }

      if (attempt < maxTentativas) await new Promise(r => setTimeout(r, 1200));
    }

    setTentativa(0);
    setStatus('falha');
    return false;
  }, [verificarConexaoHeartbeat, config.tipo_conexao, canUseWebSerialForBluetooth, reconnectSavedDevice, reconnectSerialFromGrantedPorts]);

  const buscarDispositivosSerial = useCallback(async (): Promise<string[]> => {
    try {
      if (!('serial' in navigator)) return [];
      const port = await (navigator as any).serial.requestPort();
      const info = port.getInfo();
      return [info?.usbProductId ? `USB Device ${info.usbProductId}` : 'Serial Port'];
    } catch {
      return [];
    }
  }, []);

  const disconnect = useCallback(async () => {
    stopHeartbeat('disconnect');
    await releaseActiveReader('disconnect');
    if (_btServer && _btServer.connected) {
      try { _btServer.disconnect(); } catch { /* ignore */ }
    }
    _btDevice = null;
    _btServer = null;
    _btCharacteristic = null;

    if (serialPort) {
      try { await serialPort.close(); } catch { /* ignore */ }
      setSerialPort(null);
    }
    setStatus('desconectada');
    consecutiveReadFailuresRef.current = 0;
  }, [serialPort, stopHeartbeat, releaseActiveReader]);

  return {
    config,
    allConfigs,
    loading,
    connected,
    status,
    tentativa,
    saveConfig,
    deleteBalancaConfig,
    activateConfig,
    lerPeso,
    testarConexao,
    buscarDispositivosSerial,
    disconnect,
    fetchConfig,
    serialConfig,
    updateSerialConfig,
    // BT-specific (Web Bluetooth)
    parearNovoDispositivo,
    listarDispositivosPareados,
    conectarDispositivo,
    connectBluetoothWithRetries,
    isBtConnected,
    verificarConexaoHeartbeat,
    garantirConexaoComTentativas,
    startHeartbeat,
    stopHeartbeat,
    recoverSerialConnection,
    // Android Bridge scale
    conectarBalancaAndroid,
    desconectarBalancaAndroid,
    isScaleConnectedAndroid,
    listarDispositivosPareadosAndroid,
  };
}
