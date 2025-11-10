/**
 * PiSerialBridge
 * Thin wrapper around Electron preload serial APIs to provide
 * a predictable event-driven interface for JSONL lines.
 */

export type SerialStatus = { connected: boolean; port?: string; baud?: number; error?: string };

export type LineHandler = (line: string) => void;
export type StatusHandler = (status: SerialStatus) => void;

export class PiSerialBridge {
  private onLineUnsub: (() => void) | null = null;
  private onStatusUnsub: (() => void) | null = null;

  async listPorts(): Promise<{ success: boolean; ports?: any[]; error?: string }> {
    // @ts-ignore
    const api = window.electron?.serial;
    if (!api) return { success: false, error: 'serial API not available' };
    return api.listPorts();
  }

  async open(port: string, baud: number = 9600): Promise<{ success: boolean; error?: string }> {
    // @ts-ignore
    const api = window.electron?.serial;
    if (!api) return { success: false, error: 'serial API not available' };
    return api.open(port, baud);
  }

  async close(): Promise<{ success: boolean; error?: string }> {
    // @ts-ignore
    const api = window.electron?.serial;
    if (!api) return { success: false, error: 'serial API not available' };
    return api.close();
  }

  async writeLine(data: string | object): Promise<{ success: boolean; error?: string }> {
    // @ts-ignore
    const api = window.electron?.serial;
    if (!api) return { success: false, error: 'serial API not available' };
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    return api.writeLine(payload);
  }

  onLine(cb: LineHandler): () => void {
    // @ts-ignore
    const api = window.electron?.serial;
    if (!api) return () => {};
    this.onLineUnsub?.();
    this.onLineUnsub = api.onLine(cb);
    return () => {
      this.onLineUnsub?.();
      this.onLineUnsub = null;
    };
  }

  onStatus(cb: StatusHandler): () => void {
    // @ts-ignore
    const api = window.electron?.serial;
    if (!api) return () => {};
    this.onStatusUnsub?.();
    this.onStatusUnsub = api.onStatus(cb);
    return () => {
      this.onStatusUnsub?.();
      this.onStatusUnsub = null;
    };
  }
}

export const piSerialBridge = new PiSerialBridge();
