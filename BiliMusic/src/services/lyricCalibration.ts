import type { LyricLine, Song } from '../types';

export const normalizeLyricsOffset = (offset: unknown): number =>
  typeof offset === 'number' && Number.isFinite(offset) ? Math.max(-60, Math.min(60, offset)) : 0;

export const calibrateLyrics = (lyrics: LyricLine[], offset: number): LyricLine[] => {
  const shift = normalizeLyricsOffset(offset);
  if (!shift) return lyrics;
  return lyrics.map((line) => line.isMetadata ? line : ({ ...line,
    time: line.time + shift,
    endTime: line.endTime === undefined ? undefined : line.endTime + shift,
    words: line.words?.map((word) => ({ ...word, startTime: word.startTime + shift, endTime: word.endTime + shift })),
  }));
};

export const activeDesktopLyric = (song: Song | null, currentTime: number) => {
  const time = currentTime - normalizeLyricsOffset(song?.lyricsOffset);
  let active: LyricLine | undefined;
  for (const line of song?.lyrics ?? []) {
    if (line.isMetadata || line.isBackground || line.time > time) continue;
    if (!active || line.time >= active.time) active = line;
  }
  if (active?.endTime !== undefined && time >= active.endTime) return { lyric: '', translation: '' };
  return { lyric: active?.text ?? '', translation: active?.translation ?? '' };
};
