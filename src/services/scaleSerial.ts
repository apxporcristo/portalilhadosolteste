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
 * Tolerant weight parser.
 * Accepts: 0.850, 0,850, 000850, ST,GS,+000850kg, etc.
 * Returns weight in kg or null.
 */
export function parseWeightFromRaw(raw: string): ParsedWeightResult | null {
  if (!raw || typeof raw !== 'string') return null;

  // Strip control chars except STX/ETX
  const cleaned = raw.replace(/[^\x02\x03\x20-\x7E]/g, '').trim();
  if (!cleaned) return null;

  console.log('[ScaleParser] rawData recebido:', JSON.stringify(raw));

  // Toledo protocol STX/ETX
  const stxIdx = cleaned.indexOf('\x02');
  const etxIdx = cleaned.indexOf('\x03', stxIdx >= 0 ? stxIdx : 0);
  if (stxIdx >= 0 && etxIdx > stxIdx) {
    const payload = cleaned.substring(stxIdx + 1, etxIdx).trim();
    const m = payload.match(/(\d+[.,]?\d*)/);
    if (m) {
      const numStr = m[1].replace(',', '.');
      const v = parseFloat(numStr);
      const hasDecimal = numStr.includes('.');
      const kg = hasDecimal ? v : v / 1000;
      console.log('[ScaleParser] Toledo: bruto=', m[1], 'hasDecimal=', hasDecimal, 'kg=', kg);
      if (kg > 0 && kg < 999) {
        return { weightKg: Math.round(kg * 1000) / 1000, rawData: raw, normalized: m[1] };
      }
    }
  }

  // Normalize: replace comma with dot
  const normalized = cleaned.replace(/,/g, '.');

  // Find all potential number matches (take the last valid one)
  const matches = [...normalized.matchAll(/[+-]?\d{1,6}\.?\d{0,4}/g)];
  if (matches.length === 0) return null;

  // Try from last match backwards (most scales send weight at the end)
  for (let i = matches.length - 1; i >= 0; i--) {
    const numStr = matches[i][0];
    const value = parseFloat(numStr);
    if (isNaN(value) || value < 0 || value >= 999) continue;

    const hasDecimal = numStr.includes('.');
    let kg: number;
    let rule: string;

    if (hasDecimal) {
      // Explicit decimal: use as-is (already in kg)
      kg = value;
      rule = 'decimal explícito, valor em kg';
    } else {
      // No decimal separator: treat as grams, divide by 1000
      kg = value / 1000;
      rule = 'sem decimal, dividido por 1000 (gramas → kg)';
    }

    console.log('[ScaleParser] bruto extraído:', numStr, '| regra:', rule, '| peso final:', kg.toFixed(3), 'kg');

    if (kg <= 0 || kg >= 999) continue;

    return {
      weightKg: Math.round(kg * 1000) / 1000,
      rawData: raw,
      normalized: numStr,
    };
  }

  return null;
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
