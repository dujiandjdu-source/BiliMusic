import type { AudioPreferences } from '../types';
import { defaultAudioPreferences, EQ_FREQUENCIES, normalizationGain, normalizeAudioPreferences } from './audioSettings';

/** One audible path. Analysis taps never connect back to the destination. */
export class AudioGraph {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly analyser: AnalyserNode;
  readonly filters: BiquadFilterNode[];
  readonly levelGain: GainNode;
  readonly preamp: GainNode;
  readonly limiter: WaveShaperNode;
  settings = defaultAudioPreferences();
  constructor(readonly context: BaseAudioContext) {
    this.input = context.createGain();
    this.output = context.createGain();
    this.preamp = context.createGain();
    this.levelGain = context.createGain();
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.filters = EQ_FREQUENCIES.map(frequency => {
      const filter = context.createBiquadFilter();
      filter.type = 'peaking'; filter.frequency.value = Math.min(frequency, context.sampleRate * 0.45); filter.Q.value = 1.4;
      return filter;
    });
    let node: AudioNode = this.input;
    for (const filter of this.filters) { node.connect(filter); node = filter; }
    node.connect(this.preamp); this.preamp.connect(this.analyser); this.analyser.connect(this.levelGain);
    // A compressor adds automatic makeup gain in Chromium. A unity-gain
    // safety clipper preserves the measured RMS target below its ceiling.
    this.limiter = context.createWaveShaper();
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.max(-0.98, Math.min(0.98, i * 2 / (curve.length - 1) - 1));
    this.limiter.curve = curve;
    this.limiter.oversample = '4x';
    this.levelGain.connect(this.output); this.output.connect(context.destination);
  }
  configure(input: AudioPreferences) {
    const settings = normalizeAudioPreferences(input), time = this.context.currentTime;
    const wasProcessed = this.settings.normalization || this.settings.equalizerEnabled;
    const processed = settings.normalization || settings.equalizerEnabled;
    if (wasProcessed !== processed) {
      this.levelGain.disconnect(); this.limiter.disconnect();
      if (processed) { this.levelGain.connect(this.limiter); this.limiter.connect(this.output); }
      else this.levelGain.connect(this.output);
    }
    this.settings = settings;
    this.filters.forEach((filter, index) => filter.gain.setTargetAtTime(settings.equalizerEnabled ? settings.gains[index] : 0, time, 0.025));
    const headroom = settings.equalizerEnabled ? Math.max(0, ...settings.gains) : 0;
    this.preamp.gain.setTargetAtTime(10 ** (-headroom / 20), time, 0.025);
    if (!settings.normalization) this.levelGain.gain.setTargetAtTime(1, time, 0.1);
  }
  updateLevel(rms: number, peak: number) {
    if (!this.settings.normalization) return;
    const gain = normalizationGain(rms, peak);
    if (gain !== null) this.levelGain.gain.setTargetAtTime(gain, this.context.currentTime, gain < this.levelGain.gain.value ? 0.08 : 0.8);
  }
}

const engines = new WeakMap<HTMLAudioElement, AudioEngine>();

export class AudioEngine {
  readonly graph: AudioGraph;
  readonly source: MediaElementAudioSourceNode;
  readonly primaryGain: GainNode;
  private outgoing: { audio: HTMLAudioElement; source: MediaElementAudioSourceNode; gain: GainNode } | null = null;
  private monitor?: ReturnType<typeof setInterval>;
  private deadline?: ReturnType<typeof setTimeout>;
  private cleanup?: ReturnType<typeof setTimeout>;
  private pendingFade = false;
  private samples = new Float32Array(2048);
  constructor(readonly audio: HTMLAudioElement, readonly context: AudioContext) {
    this.graph = new AudioGraph(context);
    this.primaryGain = context.createGain();
    this.source = context.createMediaElementSource(audio);
    this.source.connect(this.primaryGain); this.primaryGain.connect(this.graph.input);
    audio.addEventListener('error', () => this.cancelTransition());
    audio.addEventListener('volumechange', () => {
      if (this.outgoing) { this.outgoing.audio.volume = audio.volume; this.outgoing.audio.muted = audio.muted; }
    });
  }
  configure(settings: AudioPreferences) {
    this.graph.configure(settings);
    if (!this.graph.settings.crossfadeSeconds) this.cancelTransition();
  }
  async resume(): Promise<boolean> {
    if (this.context.state === 'suspended') {
      try { await this.context.resume(); } catch { return false; }
    }
    if (this.context.state !== 'running') return false;
    if (this.monitor === undefined) this.monitor = setInterval(() => {
      if (this.audio.paused && !this.outgoing) return;
      this.graph.analyser.getFloatTimeDomainData(this.samples);
      let sum = 0, peak = 0;
      for (const value of this.samples) { sum += value * value; peak = Math.max(peak, Math.abs(value)); }
      this.graph.updateLevel(Math.sqrt(sum / this.samples.length), peak);
    }, 100);
    return true;
  }
  beginTransition() {
    this.cancelTransition();
    const seconds = this.graph.settings.crossfadeSeconds;
    if (!seconds || this.audio.paused || this.audio.ended || this.audio.readyState < 2) return;
    const audio = new Audio();
    audio.crossOrigin = this.audio.crossOrigin;
    audio.src = this.audio.currentSrc || this.audio.src;
    audio.volume = this.audio.volume; audio.muted = this.audio.muted;
    audio.playbackRate = this.audio.playbackRate; audio.preservesPitch = this.audio.preservesPitch;
    audio.currentTime = this.audio.currentTime;
    const source = this.context.createMediaElementSource(audio), gain = this.context.createGain();
    source.connect(gain); gain.connect(this.graph.input);
    const outgoing = { audio, source, gain };
    this.outgoing = outgoing; this.pendingFade = true;
    this.primaryGain.gain.cancelScheduledValues(this.context.currentTime);
    this.primaryGain.gain.setValueAtTime(0, this.context.currentTime);
    // A failed incoming URL cannot leave the old song playing indefinitely.
    this.deadline = setTimeout(() => this.cancelTransition(), 8000 + seconds * 1000);
    audio.onended = () => { if (this.outgoing === outgoing) this.releaseOutgoing(); };
    void audio.play().catch(() => { if (this.outgoing === outgoing) this.releaseOutgoing(); });
  }
  onPlaying() {
    void this.resume();
    if (!this.pendingFade) return;
    this.pendingFade = false;
    if (this.deadline !== undefined) clearTimeout(this.deadline);
    this.deadline = undefined;
    const time = this.context.currentTime, seconds = this.graph.settings.crossfadeSeconds;
    const fade = (param: AudioParam, start: number, end: number) => {
      param.cancelScheduledValues(time); param.setValueAtTime(start, time); param.linearRampToValueAtTime(end, time + seconds);
    };
    fade(this.primaryGain.gain, 0, 1);
    if (this.outgoing) fade(this.outgoing.gain.gain, 1, 0);
    this.cleanup = setTimeout(() => { this.releaseOutgoing(); this.cleanup = undefined; }, seconds * 1000 + 50);
  }
  private releaseOutgoing() {
    if (!this.outgoing) return;
    const { audio, source, gain } = this.outgoing; this.outgoing = null;
    audio.onended = null; audio.pause(); audio.removeAttribute('src'); audio.load(); source.disconnect(); gain.disconnect();
  }
  cancelTransition() {
    if (this.deadline !== undefined) clearTimeout(this.deadline);
    if (this.cleanup !== undefined) clearTimeout(this.cleanup);
    this.deadline = undefined; this.cleanup = undefined; this.pendingFade = false;
    this.releaseOutgoing();
    this.primaryGain.gain.cancelScheduledValues(this.context.currentTime);
    this.primaryGain.gain.setValueAtTime(1, this.context.currentTime);
  }
  stop() {
    this.cancelTransition();
    if (this.monitor !== undefined) clearInterval(this.monitor);
    this.monitor = undefined;
  }
}

export const getAudioEngine = (audio: HTMLAudioElement): AudioEngine | undefined => {
  let engine = engines.get(audio);
  if (!engine && typeof window !== 'undefined' && window.AudioContext) {
    engine = new AudioEngine(audio, new window.AudioContext()); engines.set(audio, engine);
  }
  return engine;
};
/** Read an already-created engine without taking ownership of the media output. */
export const peekAudioEngine = (audio: HTMLAudioElement): AudioEngine | undefined => engines.get(audio);
export const prepareAudioTransition = (audio: HTMLAudioElement | null) => { if (audio) engines.get(audio)?.beginTransition(); };
export const cancelAudioTransition = (audio: HTMLAudioElement | null) => { if (audio) engines.get(audio)?.cancelTransition(); };
export const stopAudioEngine = (audio: HTMLAudioElement | null) => { if (audio) engines.get(audio)?.stop(); };
