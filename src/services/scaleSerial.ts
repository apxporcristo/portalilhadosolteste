/**
 * Web Serial API service for reading weight from Bluetooth serial scales.
 * Works on Chrome Android 89+ with Web Serial support.
 *
 * To change baudRate or parser behavior, edit DEFAULT_CONFIG or parseWeightFromRaw().
 */

// ─── Types ──────────────────────────────────────────────────────────

export type SerialParity = 'none' | 'even' | 'odd';

export interface ScaleSerialConfig {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: SerialParity;
  bufferSize: number;
}

export interface ParsedWeightResult {
  weightKg: number;
  rawData: string;
  normalized: string;
}

export interface StartWeightStreamHandlers {
  onWeight: (kg: number) => void;
  onStatus: (status: ScaleSerialStatus) => void;
  onRawData?: (raw: string) => void;
}

export type ScaleSerialStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reading'
  | 'error';

// ─── Defaults ───────────────────────────────────────────────────────

const DEFAULT_CONFIG: ScaleSerialConfig = {
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  bufferSize: 4096,
};

// ─── Weight Parser ──────────────────────────────────────────────────

/**
 * Extract the numeric weight portion from raw scale data.
 * Strips known prefixes (ST,GS, WT:, signs, units) to isolate the number.
 */
function extractNumericPart(raw: string): string | null {
  // Remove control chars
  let s = raw.replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (!s) return null;

  // Remove known scale prefixes/suffixes: ST,GS, WT:, kg, g, lb, etc.
  s = s.replace(/^(ST|GS|WT|NET|GROSS)[,:\s]*/gi, '');
  s = s.replace(/^(ST|GS|WT|NET|GROSS)[,:\s]*/gi, ''); // second pass for chained prefixes
  s = s.replace(/\s*(kg|g|lb|oz)\s*$/gi, '');
  s = s.replace(/^[+\s]+/, ''); // leading + and spaces
  s = s.trim();

  if (!s) return null;
  return s;
}

/**
 * Tolerant weight parser for serial scale data.
 *
 * Rules (in priority order):
 * 1. If the number has an explicit decimal (. or ,), interpret directly as kg.
 * 2. If the number is a pure integer, interpret as milligrams → divide by 1000 for kg.
 * 3. Reject negative values.
 * 4. Reject absurd values (>= 999 kg).
 *
 * Examples:
 *   "0,032"            → 0.032 kg
 *   "0.032"            → 0.032 kg
 *   "32"               → 0.032 kg
 *   "00032"            → 0.032 kg
 *   "00320"            → 0.320 kg
 *   "03200"            → 3.200 kg
 *   "ST,GS,+00032kg"   → 0.032 kg
 */
export function parseWeightFromRaw(raw: string): ParsedWeightResult | null {
  if (!raw || typeof raw !== 'string') return null;

  console.log('[ScaleParser] rawData recebido:', JSON.stringify(raw));

  // --- Toledo STX/ETX protocol ---
  const cleaned = raw.replace(/[^\x02\x03\x20-\x7E]/g, '').trim();
  const stxIdx = cleaned.indexOf('\x02');
  const etxIdx = cleaned.indexOf('\x03', stxIdx >= 0 ? stxIdx : 0);
  if (stxIdx >= 0 && etxIdx > stxIdx) {
    const payload = cleaned.substring(stxIdx + 1, etxIdx).trim();
    const result = parseNumericWeight(payload, raw);
    if (result) {
      console.log('[ScaleParser] Toledo protocol → ', result.weightKg.toFixed(3), 'kg');
      return result;
    }
  }

  // --- Generic format: extract numeric part ---
  const numPart = extractNumericPart(cleaned);
  if (!numPart) return null;

  return parseNumericWeight(numPart, raw);
}

/**
 * Core numeric conversion: takes a cleaned numeric string and converts to kg.
 */
function parseNumericWeight(input: string, rawData: string): ParsedWeightResult | null {
  // Try to find a number with explicit decimal separator (, or .)
  const decimalMatch = input.match(/(\d+[.,]\d+)/);
  if (decimalMatch) {
    const numStr = decimalMatch[1].replace(',', '.');
    const value = parseFloat(numStr);
    if (isNaN(value) || value < 0 || value >= 999) return null;
    const kg = Math.round(value * 1000) / 1000;
    console.log('[ScaleParser] decimal explícito:', decimalMatch[1], '→', kg.toFixed(3), 'kg');
    return { weightKg: kg, rawData, normalized: decimalMatch[1] };
  }

  // No decimal: extract pure integer digits
  const intMatch = input.match(/(\d+)/);
  if (!intMatch) return null;

  const intStr = intMatch[1];
  const intValue = parseInt(intStr, 10);
  if (isNaN(intValue) || intValue < 0) return null;

  // Divide by 1000 (interpret as grams → kg)
  const kg = intValue / 1000;
  if (kg <= 0 || kg >= 999) return null;

  const rounded = Math.round(kg * 1000) / 1000;
  console.log('[ScaleParser] inteiro bruto:', intStr, '→ /1000 →', rounded.toFixed(3), 'kg');
  return { weightKg: rounded, rawData, normalized: intStr };
}

// ─── Service Class ──────────────────────────────────────────────────

export class ScaleSerialService {
  private port: any = null;
  private reader: any = null;
  private keepReading = false;
  private config: ScaleSerialConfig = { ...DEFAULT_CONFIG };

  /** Check if Web Serial API is available */
  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  getDefaultConfig(): ScaleSerialConfig {
    return { ...DEFAULT_CONFIG };
  }

  getConfig(): ScaleSerialConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<ScaleSerialConfig>): void {
    this.config = { ...this.config, ...config };
  }

  isConnected(): boolean {
    return this.port !== null && this.port.readable !== null;
  }

  /** Request port + open connection (requires user gesture) */
  async connect(config?: Partial<ScaleSerialConfig>): Promise<void> {
    if (!this.isSupported()) throw new Error('Web Serial não suportado neste navegador.');

    const cfg = { ...this.config, ...config };
    this.config = cfg;

    console.log('[ScaleSerial] requestPort iniciado');
    this.port = await (navigator as any).serial.requestPort();
    console.log('[ScaleSerial] porta selecionada');

    await this.port.open({
      baudRate: cfg.baudRate,
      dataBits: cfg.dataBits,
      stopBits: cfg.stopBits,
      parity: cfg.parity,
      bufferSize: cfg.bufferSize,
    });
    console.log('[ScaleSerial] porta aberta, baudRate:', cfg.baudRate);
  }

  /** Close port and clean up */
  async disconnect(): Promise<void> {
    this.keepReading = false;
    try { this.reader?.cancel(); } catch { /* ignore */ }
    this.reader = null;
    try { await this.port?.close(); } catch { /* ignore */ }
    this.port = null;
    console.log('[ScaleSerial] desconectado');
  }

  /** Read a single weight. Sends ENQ (0x05), waits up to timeoutMs. */
  async readWeightOnce(timeoutMs = 3000): Promise<ParsedWeightResult | null> {
    if (!this.port || !this.port.readable) throw new Error('Balança não conectada.');

    // Send ENQ
    if (this.port.writable) {
      const writer = this.port.writable.getWriter();
      try {
        await writer.write(new Uint8Array([0x05]));
      } finally {
        writer.releaseLock();
      }
    }

    const reader = this.port.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const timer = setTimeout(() => { try { reader.cancel(); } catch { /* */ } }, timeoutMs);

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        console.log('[ScaleSerial] dados brutos:', chunk);

        const lines = buffer.split(/[\r\n]+/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          const result = parseWeightFromRaw(line);
          if (result) {
            console.log('[ScaleSerial] peso parseado:', result.weightKg, 'kg');
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

  /** Start continuous weight stream */
  async startWeightStream(handlers: StartWeightStreamHandlers): Promise<void> {
    if (!this.port || !this.port.readable) {
      handlers.onStatus('error');
      return;
    }

    this.keepReading = true;
    handlers.onStatus('reading');
    const decoder = new TextDecoder();
    let buffer = '';

    while (this.keepReading && this.port?.readable) {
      try {
        this.reader = this.port.readable.getReader();

        while (this.keepReading) {
          const { value, done } = await this.reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          const lines = buffer.split(/[\r\n]+/);
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              handlers.onRawData?.(line.trim());
              const result = parseWeightFromRaw(line);
              if (result) {
                console.log('[ScaleSerial] peso stream:', result.weightKg, 'kg');
                handlers.onWeight(result.weightKg);
              }
            }
          }

          if (buffer.length > 2048) buffer = buffer.slice(-256);
        }
      } catch (err) {
        if (this.keepReading) {
          console.error('[ScaleSerial] erro no stream:', err);
          handlers.onStatus('error');
        }
      } finally {
        try { this.reader?.releaseLock(); } catch { /* */ }
        this.reader = null;
      }

      if (this.keepReading) await new Promise(r => setTimeout(r, 500));
    }

    if (!this.keepReading) handlers.onStatus('connected');
  }

  /** Stop continuous reading */
  stopWeightStream(): void {
    this.keepReading = false;
    try { this.reader?.cancel(); } catch { /* */ }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

export const scaleSerialService = new ScaleSerialService();
