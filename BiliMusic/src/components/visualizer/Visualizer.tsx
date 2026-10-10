import React, { useEffect, useRef } from "react";
import { publishAudioLevel } from "@/services/audioLevelBridge";
import audioProcessorUrl from "./AudioProcessor.ts?worker&url";
import { peekAudioEngine } from '../../services/audioEngine';

interface VisualizerProps {
    audioRef: React.RefObject<HTMLAudioElement>;
    isPlaying: boolean;
}

const BAR_COUNT = 96;
const FFT_SIZE = 1024;
const BAR_GAP = 4;

const Visualizer: React.FC<VisualizerProps> = ({ audioRef, isPlaying }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const workerRef = useRef<Worker | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);

    // Effect 1: Audio Context and Worklet Initialization
    useEffect(() => {
        if (!isPlaying) {
            publishAudioLevel(0);
        }
    }, [isPlaying]);

    useEffect(() => {
        let active = true;
        let tap: AudioWorkletNode | null = null;
        let output: AudioNode | null = null;
        const initAudio = async () => {
            if (!audioRef.current) return;
            const engine = peekAudioEngine(audioRef.current);
            if (!engine) return;
            engine.resume();
            try {
                await engine.context.audioWorklet.addModule(audioProcessorUrl);
                if (!active) return;
                tap = new AudioWorkletNode(engine.context, "audio-processor");
                tap.port.onmessage = (e) => {
                    if (active && e.data?.type === "LEVEL" && typeof e.data.level === "number") publishAudioLevel(e.data.level);
                };
                workletNodeRef.current = tap;
                output = engine.graph.output;
                output.connect(tap);
            } catch (e) { if (active) console.error("Visualizer: Failed to load AudioWorklet", e); }
        };

        if (isPlaying) {
            initAudio();
        }

        return () => {
            active = false;
            if (tap) {
                output?.disconnect(tap);
                tap.port.close(); tap.disconnect();
                if (workletNodeRef.current === tap) workletNodeRef.current = null;
            }
        };
    }, [isPlaying, audioRef]);

    // Effect 2: Worker Initialization
    useEffect(() => {
        let active = true;
        let frame = 0;
        if (!isPlaying) {
            if (workerRef.current) {
                workerRef.current.postMessage({ type: "DESTROY" });
                workerRef.current.terminate();
                workerRef.current = null;
            }
            return;
        }

        const canvasEl = canvasRef.current;
        if (!canvasEl) {
            return;
        }

        if (workerRef.current) {
            return;
        }

        const isOffscreenSupported = !!canvasEl.transferControlToOffscreen;
        if (!isOffscreenSupported) {
            console.warn("Visualizer: OffscreenCanvas not available, skipping worker");
            return;
        }

        try {
            const worker = new Worker(new URL("./VisualizerWorker.ts", import.meta.url), {
                type: "module"
            });
            workerRef.current = worker;

            const dpr = window.devicePixelRatio || 1;
            canvasEl.width = 1000 * dpr;
            canvasEl.height = 80 * dpr;

            const offscreen = canvasEl.transferControlToOffscreen();

            const channel = new MessageChannel();

            worker.postMessage(
                {
                    type: "INIT",
                    canvas: offscreen,
                    config: {
                        barCount: BAR_COUNT,
                        gap: BAR_GAP,
                        fftSize: FFT_SIZE,
                        smoothingTimeConstant: 0.5,
                        dpr: dpr
                    },
                    port: channel.port1
                },
                [offscreen, channel.port1]
            );

            const sendPortToWorklet = () => {
                if (!active) return;
                if (workletNodeRef.current) {
                    workletNodeRef.current.port.postMessage({ type: "PORT", port: channel.port2 }, [
                        channel.port2
                    ]);
                } else {
                    frame = requestAnimationFrame(sendPortToWorklet);
                }
            };
            sendPortToWorklet();
        } catch (e) {
            console.error("Visualizer: Failed to initialize worker", e);
        }

        return () => {
            active = false;
            cancelAnimationFrame(frame);
            if (workerRef.current) {
                workerRef.current.postMessage({ type: "DESTROY" });
                workerRef.current.terminate();
                workerRef.current = null;
            }
            publishAudioLevel(0);
        };
    }, [isPlaying]);

    if (!isPlaying) return <div className="h-10 w-full"></div>;

    return (
        <canvas
            ref={canvasRef}
            className="w-full h-10 transition-opacity duration-500"
        />
    );
};

export default Visualizer;
