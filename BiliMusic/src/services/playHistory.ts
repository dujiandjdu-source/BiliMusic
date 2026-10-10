import type { MusicLibrary, PlayEvent, PlayHistoryEntry } from "../types";

const MONTH = 30 * 24 * 60 * 60 * 1000;
export const normalizeHistory = (history: unknown): PlayHistoryEntry[] => {
  if (!Array.isArray(history)) return [];
  const entries = new Map<string, PlayHistoryEntry>();
  for (const entry of history) {
    if (!entry || typeof entry.songId !== "string" || !Number.isSafeInteger(entry.playCount) || entry.playCount < 1 ||
      !Number.isFinite(entry.lastPlayedAt) || entry.lastPlayedAt < 0) continue;
    const old = entries.get(entry.songId);
    if (!old || old.lastPlayedAt < entry.lastPlayedAt) entries.set(entry.songId, {
      songId: entry.songId, playCount: entry.playCount, lastPlayedAt: entry.lastPlayedAt,
    });
  }
  return [...entries.values()].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
};

export const normalizePlayEvents = (events: unknown, now = Date.now()): PlayEvent[] =>
  Array.isArray(events) ? events.filter((event) => event && typeof event.songId === "string" &&
    Number.isFinite(event.playedAt) && event.playedAt >= now - MONTH && event.playedAt <= now)
    .map((event) => ({ songId: event.songId, playedAt: event.playedAt })).slice(-10000) : [];

export const recordPlay = (library: MusicLibrary, songId: string, now = Date.now()): MusicLibrary => {
  const previous = library.playHistory?.find((entry) => entry.songId === songId);
  return { ...library,
    playHistory: [{ songId, playCount: (previous?.playCount ?? 0) + 1, lastPlayedAt: now },
      ...(library.playHistory ?? []).filter((entry) => entry.songId !== songId)],
    playEvents: [...normalizePlayEvents(library.playEvents, now), { songId, playedAt: now }].slice(-10000),
  };
};

export const recentlyFrequentIds = (library: MusicLibrary, now = Date.now()): string[] => {
  const counts = new Map<string, { count: number; last: number }>();
  for (const event of normalizePlayEvents(library.playEvents, now)) {
    const old = counts.get(event.songId);
    counts.set(event.songId, { count: (old?.count ?? 0) + 1, last: Math.max(old?.last ?? 0, event.playedAt) });
  }
  return [...counts].sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last).slice(0, 50).map(([id]) => id);
};
