/**
 * Web Serial API service for reading weight from Bluetooth serial scales.
 * Works on Chrome Android 89+ with Web Serial support.
 *
 * To change baudRate or parser behavior, edit SERIAL_DEFAULTS or parseWeightFromLine().
 */

export interface SerialConfig {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: ParityType;
  bufferSize: number;
}

export type ScaleStatus = 'disconnected' | 'connecting' | 'connected' | 'reading' | 'error';

const STORAGE_KEY = 'scaleSerial_prefs';

export const SERIAL_DEFAULTS: SerialConfig = {
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  bufferSize: 4096,
};

// ─── Persistence ────────────────────────────────────────────────────
export function loadSerialPrefs(): { autoRead: boolean; config: SerialConfig } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        autoRead: !!parsed.autoRead,
        config: { ...SERIAL_DEFAULTS, ...parsed.config },
      };
    }
  } catch { /* ignore */ }
  return { autoRead: false, config: { ...SERIAL_DEFAULTS } };
}

export function saveSerialPrefs(autoRead: boolean, config: SerialConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ autoRead, config }));
  } catch { /* ignore */ }
}

// ─── Support check ──────────────────────────────────────────────────
export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

// ─── Weight Parser ──────────────────────────────────────────────────

/**
 * Tolerant weight parser.
 * Accepts formats: 0.850, 0,850, 000850, with prefixes/suffixes.
 * Returns weight in kg or null.
 */
export function parseWeightFromLine(line: string): { kg: number; raw: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Toledo protocol STX/ETX
  const stxIdx = trimmed.indexOf('\x02');
  const etxIdx = trimmed.indexOf('\x03', stxIdx >= 0 ? stxIdx : 0);
  if (stxIdx >= 0 && etxIdx > stxIdx) {
    const payload = trimmed.substring(stxIdx + 1, etxIdx).trim();
    const m = payload.match(/(\d+\.?\d*)/);
    if (m) {
      const v = parseFloat(m[1]);
      const kg = v > 100 ? v / 1000 : v;
      if (kg > 0 && kg < 999) return { kg, raw: trimmed };
    }
  }

  // Generic: find a number in the line
  const match = trimmed.match(/(\d{1,6}[.,]?\d{0,4})/);
  if (!match) return null;

  const numStr = match[1].replace(',', '.');
  const value = parseFloat(numStr);
  if (isNaN(value) || value <= 0 || value >= 999) return null;

  // If it looks like grams (integer > 10 with no decimal), convert
  const kg = (!numStr.includes('.') && value > 10) ? value / 1000 : value;
  if (kg <= 0 || kg >= 999) return null;

  return { kg: Math.round(kg * 1000) / 1000, raw: trimmed };
}

// ─── Serial connection singleton ────────────────────────────────────
let _port: SerialPort | null = null;
let _reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let _keepReading = false;

export async function connectScale(config?: Partial<SerialConfig>): Promise<void> {
  if (!isWebSerialSupported()) throw new Error('Web Serial não suportado neste navegador.');

  const cfg = { ...SERIAL_DEFAULTS, ...config };

  // Request port (user gesture required)
  _port = await navigator.serial.requestPort();
  await _port.open({
    baudRate: cfg.baudRate,
    dataBits: cfg.dataBits,
    stopBits: cfg.stopBits,
    parity: cfg.parity,
    bufferSize: cfg.bufferSize,
  });
}

export async function disconnectScale(): Promise<void> {
  _keepReading = false;
  try { _reader?.cancel(); } catch { /* ignore */ }
  _reader = null;
  try { await _port?.close(); } catch { /* ignore */ }
  _port = null;
}

export function isConnected(): boolean {
  return _port !== null && _port.readable !== null;
}

/**
 * Read a single weight from the scale.
 * Sends ENQ (0x05), waits up to timeoutMs for a valid weight line.
 */
export async function readWeightOnce(timeoutMs = 3000): Promise<{ kg: number; raw: string } | null> {
  if (!_port || !_port.readable) throw new Error('Balança não conectada.');

  // Send ENQ
  if (_port.writable) {
    const writer = _port.writable.getWriter();
    try {
      await writer.write(new Uint8Array([0x05]));
    } finally {
      writer.releaseLock();
    }
  }

  const reader = _port.readable.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const timer = setTimeout(() => { try { reader.cancel(); } catch { /* */ } }, timeoutMs);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Try each complete line
      const lines = buffer.split(/[\r\n]+/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const result = parseWeightFromLine(line);
        if (result) {
          clearTimeout(timer);
          reader.releaseLock();
          return result;
        }
      }
    }
  } catch { /* cancelled or error */ } finally {
    clearTimeout(timer);
    try { reader.releaseLock(); } catch { /* */ }
  }
  return null;
}

/**
 * Start continuous weight stream.
 * Calls onWeight whenever a valid weight is parsed.
 */
export async function startWeightStream(
  onWeight: (kg: number) => void,
  onStatus: (status: ScaleStatus) => void,
  onRawData?: (raw: string) => void,
): Promise<void> {
  if (!_port || !_port.readable) {
    onStatus('error');
    return;
  }

  _keepReading = true;
  onStatus('reading');
  const decoder = new TextDecoder();
  let buffer = '';

  while (_keepReading && _port?.readable) {
    try {
      _reader = _port.readable.getReader();

      while (_keepReading) {
        const { value, done } = await _reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const lines = buffer.split(/[\r\n]+/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            onRawData?.(line.trim());
            const result = parseWeightFromLine(line);
            if (result) onWeight(result.kg);
          }
        }

        if (buffer.length > 2048) buffer = buffer.slice(-256);
      }
    } catch (err) {
      if (_keepReading) {
        console.error('[ScaleSerial] stream error:', err);
        onStatus('error');
      }
    } finally {
      try { _reader?.releaseLock(); } catch { /* */ }
      _reader = null;
    }

    // Small delay before retry if still reading
    if (_keepReading) await new Promise(r => setTimeout(r, 500));
  }

  if (!_keepReading) onStatus('connected');
}

export function stopWeightStream(): void {
  _keepReading = false;
  try { _reader?.cancel(); } catch { /* */ }
}
