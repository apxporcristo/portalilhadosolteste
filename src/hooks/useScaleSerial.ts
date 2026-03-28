import { useState, useCallback, useEffect, useRef } from 'react';
import {
  isWebSerialSupported,
  connectScale,
  disconnectScale,
  isConnected,
  readWeightOnce,
  startWeightStream,
  stopWeightStream,
  loadSerialPrefs,
  saveSerialPrefs,
  type SerialConfig,
  type ScaleStatus,
  SERIAL_DEFAULTS,
} from '@/services/scaleSerial';

export function useScaleSerial() {
  const [supported] = useState(() => isWebSerialSupported());
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [reading, setReading] = useState(false);
  const [currentWeight, setCurrentWeight] = useState<number | null>(null);
  const [rawData, setRawData] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [autoRead, setAutoRead] = useState(false);
  const [serialConfig] = useState<SerialConfig>(() => loadSerialPrefs().config);
  const autoReadRef = useRef(false);

  // Load saved auto-read preference
  useEffect(() => {
    const prefs = loadSerialPrefs();
    setAutoRead(prefs.autoRead);
    autoReadRef.current = prefs.autoRead;
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      await connectScale(serialConfig);
      setConnected(true);
      setConnecting(false);
    } catch (err: any) {
      const msg = err?.message || 'Falha ao conectar';
      if (msg.includes('No port selected') || msg.includes('cancelled')) {
        setError('Seleção de porta cancelada pelo usuário.');
      } else if (msg.includes('suportado')) {
        setError(msg);
      } else {
        setError(`Falha ao conectar: ${msg}`);
      }
      setConnected(false);
      setConnecting(false);
    }
  }, [serialConfig]);

  const disconnect = useCallback(async () => {
    stopWeightStream();
    await disconnectScale();
    setConnected(false);
    setReading(false);
    setCurrentWeight(null);
    setRawData('');
    setError(null);
  }, []);

  const refreshWeight = useCallback(async () => {
    if (!isConnected()) {
      setError('Balança não conectada.');
      return;
    }
    setError(null);
    try {
      const result = await readWeightOnce();
      if (result) {
        setCurrentWeight(result.kg);
        setRawData(result.raw);
      } else {
        setError('Nenhum peso válido recebido.');
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao ler peso.');
    }
  }, []);

  const startAutoRead = useCallback(() => {
    if (!isConnected()) return;
    autoReadRef.current = true;
    setAutoRead(true);
    setReading(true);
    saveSerialPrefs(true, serialConfig);

    startWeightStream(
      (kg) => setCurrentWeight(kg),
      (status: ScaleStatus) => {
        if (status === 'error') {
          setReading(false);
          setError('Conexão com a balança perdida.');
          setConnected(false);
        } else if (status === 'connected') {
          setReading(false);
        } else if (status === 'reading') {
          setReading(true);
        }
      },
      (raw) => setRawData(raw),
    );
  }, [serialConfig]);

  const stopAutoRead = useCallback(() => {
    autoReadRef.current = false;
    setAutoRead(false);
    setReading(false);
    saveSerialPrefs(false, serialConfig);
    stopWeightStream();
  }, [serialConfig]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopWeightStream();
    };
  }, []);

  return {
    supported,
    connected,
    connecting,
    reading,
    currentWeight,
    rawData,
    error,
    autoRead,
    connect,
    disconnect,
    refreshWeight,
    startAutoRead,
    stopAutoRead,
  };
}
