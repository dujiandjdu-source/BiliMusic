import type { Song } from "../types";

const normalizeIdentity = (value: string) => value.normalize("NFKC").toLocaleLowerCase()
  .replace(/[’'`]/g, "").replace(/[\s·•・_—–-]+/g, "")
  .replace(/[()[\]{}【】《》<>，。！？、,:;!?]/g, "");

export const songIdentity = (song: Song): string => {
  if (song.isNetease && song.neteaseId) return `netease:${song.neteaseId}`;
  if (song.isBilibili && song.bvid) return `bilibili:${song.bvid}:${song.biliCid || 0}`;
  return `track:${normalizeIdentity(song.title)}:${normalizeIdentity(song.artist)}`;
};

export const sameSong = (left: Song, right: Song) => left.id === right.id || songIdentity(left) === songIdentity(right);

export const uniqueSongsAgainst = (existing: Song[], incoming: Song[]): Song[] => {
  const identities = new Set(existing.map(songIdentity));
  const ids = new Set(existing.map((song) => song.id));
  return incoming.filter((song) => {
    const identity = songIdentity(song);
    if (ids.has(song.id) || identities.has(identity)) return false;
    ids.add(song.id);
    identities.add(identity);
    return true;
  });
};
