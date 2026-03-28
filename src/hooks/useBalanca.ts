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
  valor_peso: number;
  ativo?: boolean;
  user_id?: string | null;
}

export type BalancaStatus = 'desconectada' | 'conectando' | 'conectada' | 'falha' | 'tentando';

const DEFAULT_CONFIG: BalancaConfig = {
  tipo_conexao: 'serial',
  dispositivo_nome: null,
  dispositivo_id: null,
  endereco_dispositivo: null,
  porta_serial: null,
  baud_rate: 9600,
  valor_peso: 0,
  ativo: true,
};

// Toledo Prix 3 protocol: STX (0x02) + weight digits + ETX (0x03)
function parseToledoWeight(data: string): number | null {
  const stxIdx = data.indexOf('\x02');
  const etxIdx = data.indexOf('\x03', stxIdx);
  if (stxIdx === -1 || etxIdx === -1) return null;
  const payload = data.substring(stxIdx + 1, etxIdx).trim();
  const match = payload.match(/(\d+\.?\d*)/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return value > 100 ? value / 1000 : value;
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
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<BalancaStatus>('desconectada');
  const [tentativa, setTentativa] = useState(0);
  const [serialPort, setSerialPort] = useState<any>(null);
  const [serialConfig, setSerialConfigState] = useState<SerialConfig>(loadSerialConfig);
  const autoConnectAttempted = useRef(false);

  const updateSerialConfig = useCallback((partial: Partial<SerialConfig>) => {
    setSerialConfigState(prev => {
      const next = { ...prev, ...partial };
      saveSerialConfig(next);
      return next;
    });
  }, []);

  const connected = status === 'conectada';

  const fetchConfig = useCallback(async () => {
    try {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase.from('balanca_config' as any).select('*').limit(1).maybeSingle();
      if (error) console.error('Erro ao buscar config balança:', error);
      if (data) {
        setConfig({
          id: (data as any).id,
          tipo_conexao: (data as any).tipo_conexao || 'serial',
          dispositivo_nome: (data as any).dispositivo_nome || null,
          dispositivo_id: (data as any).dispositivo_id || null,
          porta_serial: (data as any).porta_serial || null,
          baud_rate: (data as any).baud_rate || 9600,
          valor_peso: (data as any).valor_peso || 0,
        });
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
      const payload = {
        tipo_conexao: newConfig.tipo_conexao,
        dispositivo_nome: newConfig.dispositivo_nome || null,
        dispositivo_id: newConfig.dispositivo_id || null,
        porta_serial: newConfig.porta_serial || null,
        baud_rate: newConfig.baud_rate,
        valor_peso: newConfig.valor_peso || 0,
      };

      if (newConfig.id) {
        const { error } = await supabase.from('balanca_config' as any)
          .update({ ...payload, updated_at: new Date().toISOString() } as any)
          .eq('id', newConfig.id);
        if (error) {
          console.error('Erro ao atualizar balança:', error);
          toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
          return;
        }
      } else {
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
      setConfig(newConfig);
      if (!options?.silent) {
        toast({ title: 'Configuração da balança salva' });
      }
    } catch (err) {
      console.error('Erro saveConfig balança:', err);
      toast({ title: 'Erro ao salvar', description: 'Falha inesperada ao salvar configuração.', variant: 'destructive' });
    }
  }, []);

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
      const num = parseFloat(raw.replace(',', '.'));
      return isNaN(num) ? null : num;
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
      let port = serialPort;

      // If current port is not readable, try to recover from granted ports
      if (!port || !port.readable) {
        try {
          const ports = await (navigator as any).serial.getPorts();
          const openPort = ports?.find((p: any) => p.readable);
          if (openPort) {
            port = openPort;
            setSerialPort(openPort);
          } else if (ports?.length) {
            // Try to reopen the first granted port
            const p = ports[0];
            await p.open({
              baudRate: serialConfig.baudRate,
              dataBits: serialConfig.dataBits,
              stopBits: serialConfig.stopBits,
              parity: serialConfig.parity,
            });
            port = p;
            setSerialPort(p);
          }
        } catch (reopenErr) {
          console.warn('[Balança] Falha ao reabrir porta:', reopenErr);
        }
      }

      if (!port || !port.readable) {
        console.log('[Balança] Nenhuma porta serial aberta para leitura.');
        return null;
      }

      // Send ENQ (0x05) if writable
      if (port.writable) {
        try {
          const writer = port.writable.getWriter();
          await writer.write(new Uint8Array([0x05]));
          writer.releaseLock();
        } catch (writeErr) {
          console.warn('[Balança] Falha ao enviar ENQ:', writeErr);
        }
      }

      // Check if readable is locked (another reader active)
      if (port.readable.locked) {
        console.warn('[Balança] Porta serial com reader travado, aguardando...');
        await new Promise(r => setTimeout(r, 500));
        if (port.readable.locked) {
          console.warn('[Balança] Reader ainda travado, tentando ENQ novamente...');
          return null;
        }
      }

      const reader = port.readable.getReader();
      const timeout = setTimeout(() => { try { reader.cancel(); } catch {} }, 3000);
      try {
        const { value, done } = await reader.read();
        clearTimeout(timeout);
        reader.releaseLock();
        if (value && !done) return parseToledoWeightBytes(value);
      } catch {
        clearTimeout(timeout);
        try { reader.releaseLock(); } catch {}
      }
      return null;
    } catch (err) {
      console.error('[Balança] Erro serial:', err);
      return null;
    }
  }, [serialPort, serialConfig]);
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
      const ok = window.IS_ANDROID_APP
        ? isScaleConnectedAndroid()
        : (canUseWebSerialForBluetooth() ? await reconnectSerialFromGrantedPorts() : isBtConnected());
      setStatus(ok ? 'conectada' : 'desconectada');
      return ok;
    }

    if (config.tipo_conexao === 'serial' || config.tipo_conexao === 'usb_serial') {
      const ok = await reconnectSerialFromGrantedPorts();
      if (!ok) setStatus('desconectada');
      return ok;
    }

    return false;
  }, [config.tipo_conexao, canUseWebSerialForBluetooth, isScaleConnectedAndroid, isBtConnected, reconnectSerialFromGrantedPorts]);

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
  }, [serialPort]);

  return {
    config,
    loading,
    connected,
    status,
    tentativa,
    saveConfig,
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
    // Android Bridge scale
    conectarBalancaAndroid,
    desconectarBalancaAndroid,
    isScaleConnectedAndroid,
    listarDispositivosPareadosAndroid,
  };
}
