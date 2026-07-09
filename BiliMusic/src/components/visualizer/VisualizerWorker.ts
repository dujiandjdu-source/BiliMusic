// VisualizerWorker.ts

export type WorkerMessage =
    | { type: "INIT"; canvas: OffscreenCanvas; config: VisualizerConfig; port: MessagePort }
    | { type: "AUDIO_DATA"; data: Float32Array }
    | { type: "RESIZE"; width: number; height: number }
    | { type: "DESTROY" };

export interface VisualizerConfig {
    barCount: number;
    gap: number;
    fftSize: number;
    smoothingTimeConstant: number;
    dpr?: number;
}

const ctx: Worker = self as any;

console.log("VisualizerWorker: Worker script loaded");

let canvas: OffscreenCanvas | null = null;
let canvasCtx: OffscreenCanvasRenderingContext2D | null = null;
let config: VisualizerConfig | null = null;
let animationFrameId: number | null = null;
let workletPort: MessagePort | null = null;

// Ring buffer for smoothing/history
const BUFFER_SIZE = 2048; // Store enough history for a nice wave
const historyBuffer = new Float32Array(BUFFER_SIZE);
let historyIndex = 0;

ctx.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const { type } = e.data;
    console.log("VisualizerWorker: Received message", type);

    switch (type) {
        case 'INIT': {
             const payload = e.data as { type: "INIT"; canvas: OffscreenCanvas; config: VisualizerConfig; port: MessagePort };
            console.log("VisualizerWorker: Initializing...");
            canvas = payload.canvas;
            config = payload.config;
            canvasCtx = canvas.getContext('2d');
            console.log("VisualizerWorker: Canvas context created", !!canvasCtx);

            // Setup port to worklet
            workletPort = payload.port;
            console.log("VisualizerWorker: Port received");
            workletPort.onmessage = (ev) => {
                 if (ev.data.type === "AUDIO_DATA") {
                    const newData = ev.data.data as Float32Array;
                    // Write to ring buffer
                    for (let i = 0; i < newData.length; i++) {
                        historyBuffer[historyIndex] = newData[i];
                        historyIndex = (historyIndex + 1) % BUFFER_SIZE;
                    }
                }
            };

            startLoop();
            break;
        }
        case 'AUDIO_DATA': {
            // This case is now handled by the workletPort.onmessage handler
            break;
        }
        case 'RESIZE': {
             const payload = e.data as { type: "RESIZE"; width: number; height: number };
            if (canvas) {
                canvas.width = payload.width;
                canvas.height = payload.height;
            }
            break;
        }
        case 'DESTROY': {
            console.log("VisualizerWorker: Destroying");
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            if (workletPort) {
                workletPort.close();
            }
            canvas = null;
            canvasCtx = null;
            break;
        }
    }
};

function startLoop() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);

    const loop = () => {
        if (canvas && canvasCtx && config) {
            draw(canvasCtx, canvas.width, canvas.height);
        }
        animationFrameId = requestAnimationFrame(loop);
    };
    loop();
}


// State for bar smoothing
let bars: number[] = [];

function draw(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number) {
    ctx.clearRect(0, 0, width, height);

    if (!config) return;

    const { barCount, gap, fftSize, smoothingTimeConstant, dpr = 1 } = config;

    // Initialize bars if needed
    if (bars.length !== barCount) {
        bars = new Array(barCount).fill(0);
    }

    // Analyze audio data
    const size = Math.max(256, Math.min(fftSize, BUFFER_SIZE));
    const recentData = new Float32Array(size);

    // Copy recent data from ring buffer
    for (let i = 0; i < size; i++) {
        const idx = (historyIndex - size + i + BUFFER_SIZE) % BUFFER_SIZE;
        recentData[i] = historyBuffer[idx];
    }

    // Calculate bar amplitudes
    // User wants "0 based" and "highest point represents the highest point of the entire frequency"
    // We will map amplitude 0-1 to height-0.
    // We use the full step for accuracy (no sparse sampling).

    const step = Math.max(1, Math.floor(size / barCount));
    let targetBars = new Array(barCount).fill(0);

    for (let i = 0; i < barCount; i++) {
        let maxVal = 0;
        const start = i * step;

        // Scan full step for accuracy
        for (let j = 0; j < step; j++) {
            if (start + j >= recentData.length) break;
            const val = Math.abs(recentData[start + j] || 0);
            if (val > maxVal) maxVal = val;
        }
        targetBars[i] = maxVal;
    }

    // Reverse direction: Newest data (right of window) should be on the Left (index 0)
    targetBars.reverse();

    // Apply Savitzky-Golay Smoothing (Window Size 7)
    // "Front that one and last that one not needed anymore" -> Skip smoothing for edges
    const smoothedTarget = new Array(barCount).fill(0);
    for (let i = 0; i < barCount; i++) {
        if (i < 3 || i >= barCount - 3) {
            smoothedTarget[i] = targetBars[i];
        } else {
            const y_m3 = targetBars[i - 3];
            const y_m2 = targetBars[i - 2];
            const y_m1 = targetBars[i - 1];
            const y_0 = targetBars[i];
            const y_p1 = targetBars[i + 1];
            const y_p2 = targetBars[i + 2];
            const y_p3 = targetBars[i + 3];

            const val = (-2 * y_m3 + 3 * y_m2 + 6 * y_m1 + 7 * y_0 + 6 * y_p1 + 3 * y_p2 - 2 * y_p3) / 21;
            smoothedTarget[i] = Math.max(0, val);
        }
    }
    targetBars = smoothedTarget;

    const effectiveHeight = height / dpr;
    const effectiveWidth = width / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Smooth the bars temporally
    for (let i = 0; i < barCount; i++) {
        const factor = 0.15;
        bars[i] += (targetBars[i] - bars[i]) * factor;
    }

    // Draw small rounded bars (cylinders)
    ctx.fillStyle = '#ffffff';

    const barWidth = Math.max(2, (effectiveWidth - gap * Math.max(0, barCount - 1)) / barCount);
    const span = barWidth + gap;

    for (let i = 0; i < barCount; i++) {
        let amplitude = bars[i];
        if (amplitude > 1) amplitude = 1;

        const x = i * span;
        const barHeight = Math.max(4, amplitude * effectiveHeight);
        const y = effectiveHeight - barHeight;

        // Draw rounded rect (small cylinder appearance)
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        ctx.fill();
    }

    ctx.restore();
}
