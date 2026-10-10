import type { AudioPreferences } from '../types';

export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const defaultAudioPreferences = (): AudioPreferences => ({
  volume: 1, speed: 1, preservesPitch: true,
  equalizerEnabled: false, gains: EQ_FREQUENCIES.map(() => 0), normalization: false, crossfadeSeconds: 0,
});
export const normalizeAudioPreferences = (input?: Partial<AudioPreferences>): AudioPreferences => ({
  volume: typeof input?.volume === 'number' && Number.isFinite(input.volume) ? Math.min(1, Math.max(0, input.volume)) : 1,
  speed: typeof input?.speed === 'number' && Number.isFinite(input.speed) ? Math.min(3, Math.max(0.25, input.speed)) : 1,
  preservesPitch: input?.preservesPitch !== false,
  equalizerEnabled: input?.equalizerEnabled === true,
  gains: EQ_FREQUENCIES.map((_, index) => {
    const value = input?.gains?.[index];
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(-12, Math.min(12, value)) : 0;
  }),
  normalization: input?.normalization === true,
  crossfadeSeconds: typeof input?.crossfadeSeconds === 'number' && Number.isFinite(input.crossfadeSeconds)
    ? Math.max(0, Math.min(8, input.crossfadeSeconds)) : 0,
});

/** Real-time RMS leveling with a silence gate, bounded boost and peak headroom. */
export const normalizationGain = (rms: number, peak: number): number | null => {
  if (!Number.isFinite(rms) || !Number.isFinite(peak) || rms < 0.003 || peak <= 0) return null;
  return Math.max(0.1, Math.min(4, 0.125 / rms, 0.95 / peak));
};
