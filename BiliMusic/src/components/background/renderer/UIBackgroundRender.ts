import { BaseBackgroundRender } from "./BaseBackgroundRender";

export type UIRenderCallback = (
  ctx: CanvasRenderingContext2D,
  now: number,
) => void;

export class UIBackgroundRender extends BaseBackgroundRender {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private rafId: number | null = null;
  private running = false;
  private readonly renderCallback: UIRenderCallback;

  constructor(
    canvas: HTMLCanvasElement,
    renderCallback: UIRenderCallback,
    targetFps: number = 60,
  ) {
    super(targetFps);
    this.canvas = canvas;
    this.renderCallback = renderCallback;
  }

  private tick = (now: number) => {
    if (!this.running) return;
    if (!this.ctx) {
      this.ctx = this.canvas.getContext("2d");
    }

    if (!this.ctx) return;

    if (!this.isPaused && this.shouldRender(now)) {
      this.renderCallback(this.ctx, now);
    }

    this.rafId = window.requestAnimationFrame(this.tick);
  };

  start() {
    if (this.running) {
      this.stop();
    }

    this.ctx = this.canvas.getContext("2d");
    if (!this.ctx) {
      console.error("Failed to get 2D context for UI background renderer");
      return;
    }

    this.running = true;
    this.resetClock(performance.now());
    this.rafId = window.requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resize(width?: number, height?: number) {
    const w = width ?? this.canvas.clientWidth;
    const h = height ?? this.canvas.clientHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }
}
