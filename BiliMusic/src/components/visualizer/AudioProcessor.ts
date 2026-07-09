// AudioProcessor.ts (AudioWorklet)

interface AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare var AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (options?: unknown): AudioWorkletProcessor;
};

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: unknown) => AudioWorkletProcessor,
): void;

class AudioProcessor extends AudioWorkletProcessor {
  private static readonly window = 2048;

  private port2: MessagePort | null = null;
  private size = 0;
  private sum = 0;
  private peak = 0;

  constructor() {
    super();
    this.port.onmessage = (event) => {
      if (event.data.type !== "PORT") return;
      this.port2 = event.data.port;
      this.port.postMessage({ type: "PORT_RECEIVED" });
    };
  }

  process(
    inputs: Float32Array[][],
    _outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const data = input[0];
    if (!data || data.length === 0) return true;

    if (this.port2) {
      const copy = new Float32Array(data);
      this.port2.postMessage({ type: "AUDIO_DATA", data: copy }, [copy.buffer]);
    }

    for (let i = 0; i < data.length; i++) {
      const value = data[i] ?? 0;
      const abs = Math.abs(value);
      this.sum += value * value;
      if (abs > this.peak) {
        this.peak = abs;
      }
    }

    this.size += data.length;
    if (this.size < AudioProcessor.window) {
      return true;
    }

    const rms = Math.sqrt(this.sum / this.size);
    const level = Math.min(1, Math.max(rms * 2.8, this.peak * 0.9));
    this.port.postMessage({ type: "LEVEL", level, rms, peak: this.peak });

    this.size = 0;
    this.sum = 0;
    this.peak = 0;
    return true;
  }
}

registerProcessor("audio-processor", AudioProcessor);
