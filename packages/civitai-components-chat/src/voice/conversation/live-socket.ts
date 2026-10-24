const CONNECT_TIMEOUT_MS = 10_000;

export interface LiveSocketHandlers {
  onEvent?(event: { type: string } & Record<string, unknown>): void;
  onAudio?(bytes: Uint8Array): void;
  onClose?(): void;
}

/** A live step's `socketUrl`: binary frames carry its input and output, text frames its JSON events. */
export class LiveSocket {
  #ws: WebSocket;

  private constructor(ws: WebSocket, handlers: LiveSocketHandlers) {
    this.#ws = ws;
    ws.onmessage = (message: MessageEvent<string | ArrayBuffer>) => {
      if (typeof message.data === 'string') {
        const event = JSON.parse(message.data) as { type: string };
        if (event.type !== 'ack') handlers.onEvent?.(event);
      } else {
        handlers.onAudio?.(new Uint8Array(message.data));
      }
    };
    ws.onclose = () => handlers.onClose?.();
  }

  static open(url: string, handlers: LiveSocketHandlers): Promise<LiveSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('The live connection did not open.'));
      }, CONNECT_TIMEOUT_MS);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(new LiveSocket(ws, handlers));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('The live connection failed.'));
      };
    });
  }

  get open(): boolean {
    return this.#ws.readyState === WebSocket.OPEN;
  }

  /** The step's input: audio for transcription, UTF-8 text for speech. */
  send(bytes: Uint8Array | Int16Array): void {
    if (this.open) this.#ws.send(bytes);
  }

  /** Tells the step its input is complete; it finishes what it has, then closes the socket. */
  end(): void {
    if (this.open) this.#ws.send(JSON.stringify({ type: 'end' }));
  }

  close(): void {
    this.#ws.onclose = null;
    this.#ws.close();
  }
}
