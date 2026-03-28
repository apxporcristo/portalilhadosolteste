import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  scaleSerialService,
  type ScaleSerialConfig,
  type ScaleSerialStatus,
} from '@/services/scaleSerial';

const STORAGE_KEY = 'scale_serial_config';

function loadConfig(): Partial<ScaleSerialConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveConfig(config: ScaleSerialConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch { /* ignore */ }
}

export function useScaleSerial() {
  const supported = useMemo(() => scaleSerialService.isSupported(), []);
  const [status, setStatus] = useState<ScaleSerialStatus>('disconnected');
  const [currentWeight, setCurrentWeight] = useState<number | null>(null);
  const [rawData, setRawData] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [autoRead, setAutoRead] = useState(false);
  const [config, setConfigState] = useState<ScaleSerialConfig>(() => {
    const saved = loadConfig();
    const defaults = scaleSerialService.getDefaultConfig();
    return { ...defaults, ...saved };
  });
  const autoReadRef = useRef(false);

  const connected = status === 'connected' || status === 'reading';
  const connecting = status === 'connecting';
  const reading = status === 'reading';

  // Apply config to service on change
  useEffect(() => {
    scaleSerialService.setConfig(config);
  }, [config]);

  const setConfig = useCallback((partial: Partial<ScaleSerialConfig>) => {
    setConfigState(prev => {
      const next = { ...prev, ...partial };
      saveConfig(next);
      return next;
    });
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setStatus('connecting');
    try {
      await scaleSerialService.connect(config);
      setStatus('connected');
    } catch (err: any) {
      const msg = err?.message || 'Falha ao conectar';
      if (msg.includes('No port selected') || msg.includes('cancelled')) {
        setError('Usuário cancelou a seleção da porta.');
      } else if (msg.includes('suportado')) {
        setError(msg);
      } else {
        setError(`Falha ao abrir a porta serial: ${msg}`);
      }
      setStatus('disconnected');
    }
  }, [config]);

  const disconnect = useCallback(async () => {
    scaleSerialService.stopWeightStream();
    await scaleSerialService.disconnect();
    setStatus('disconnected');
    setAutoRead(false);
    autoReadRef.current = false;
    setCurrentWeight(null);
    setRawData('');
    setError(null);
  }, []);

  const refreshWeight = useCallback(async () => {
    if (!scaleSerialService.isConnected()) {
      setError('Balança não conectada.');
      return;
    }
    setError(null);
    try {
      const result = await scaleSerialService.readWeightOnce();
      if (result) {
        setCurrentWeight(result.weightKg);
        setRawData(result.rawData);
      } else {
        setError('Conectado, mas sem dados válidos de peso.');
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao ler peso.');
    }
  }, []);

  const startAutoRead = useCallback(() => {
    if (!scaleSerialService.isConnected()) return;
    autoReadRef.current = true;
    setAutoRead(true);

    scaleSerialService.startWeightStream({
      onWeight: (kg) => setCurrentWeight(kg),
      onStatus: (s: ScaleSerialStatus) => {
        setStatus(s);
        if (s === 'error') {
          setError('Conexão perdida com a balança.');
        }
      },
      onRawData: (raw) => setRawData(raw),
    });
  }, []);

  const stopAutoRead = useCallback(() => {
    autoReadRef.current = false;
    setAutoRead(false);
    scaleSerialService.stopWeightStream();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      scaleSerialService.stopWeightStream();
    };
  }, []);

  return {
    supported,
    connected,
    connecting,
    reading,
    status,
    currentWeight,
    rawData,
    error,
    autoRead,
    config,
    setConfig,
    connect,
    disconnect,
    refreshWeight,
    startAutoRead,
    stopAutoRead,
  };
}
