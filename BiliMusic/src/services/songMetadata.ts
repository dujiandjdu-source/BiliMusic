import type { BilibiliVideoInfo, BilibiliVideoPage, Song } from "../types";

const text = (value?: string) => (value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const packagingTag = /^(?:更新完毕|更新中|完结|已完结|连载中|完整版|合集|精选|高音质|高品质|无损(?:音质)?|Hi-?Res|FLAC|MP3|WAV|AAC|OST|官方音频|官方MV|\d+首|\d+P|[248]K)$/i;

/** Display cleanup only: keep meaningful subtitles and distinct versions (Live/Remix). */
export const cleanSongTitle = (value?: string): string => {
  const original = text(value);
  if (!original) return "未知曲目";
  const cleaned = original
    .replace(/\[([^\]]+)\]|【([^】]+)】|\(([^)]+)\)|（([^）]+)）/g,
      (whole, ...groups: unknown[]) => {
        const tag = groups.slice(0, 4).find((item) => typeof item === "string") as string;
        return packagingTag.test(tag.replace(/\s+/g, "")) ? " " : whole;
      }).trim()
    .replace(/^(?:P\d+\s*[-.:：、]\s*|\d{1,3}\s*[.、]\s+)/i, "")
    .replace(/^[\s|｜·•:：–—_]+|[\s|｜·•:：–—_]+$/g, "")
    .replace(/\s+/g, " ").trim();
  return cleaned || original;
};

export const parseLocalFilename = (filename: string, unknownArtist = "未知歌手") => {
  const basename = text(filename.replace(/\.[^/.\\]+$/, ""));
  // A spaced separator identifies Artist - Title. Keep every subsequent hyphen.
  const match = basename.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return {
    title: cleanSongTitle(match?.[2] || basename),
    artist: text(match?.[1]) || unknownArtist,
  };
};

const separator = /^\s*[-–—:：|｜_]+\s*/;
const trackNumber = /^(?:(?:CD|DISC)\s*\d+\s*[-–—:：._|｜ ]+|(?:TRACK\s*|P)\d{1,3}\s*[-–—:：.、_|｜ ]*|第\s*\d{1,3}\s*[首曲集]\s*[-–—:：.、_|｜ ]*|[\[【(（]\s*\d{1,3}\s*[\]】)）]\s*[-–—:：.、_|｜ ]*|\d{1,3}\s*[-–—:：.、_|｜]\s*|0\d{1,2}\s+)/i;

const stripTrackNumbers = (value: string) => {
  let result = value;
  // Multiple markers occur in names such as "Disc 2 - Track 03 - Song".
  for (let i = 0; i < 4; i++) {
    const next = result.replace(trackNumber, "").trim();
    if (!next || next === result) break;
    result = next;
  }
  return result;
};

/** Candidate boundaries outside brackets; preserve hyphens inside real words. */
const titleBoundaries = (value: string) => {
  const positions: number[] = [];
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if ("[【(（《".includes(char)) { depth++; continue; }
    if ("]】)）》".includes(char)) {
      depth = Math.max(0, depth - 1);
      if (!depth && i + 1 < value.length && /^[\s\dPＴT\-–—:：|｜_]/i.test(value.slice(i + 1))) positions.push(i + 1);
      continue;
    }
    if (!depth && /[-–—:：|｜_]/.test(char) &&
      (char !== "-" || /\s/.test(value[i - 1] || "") || /\s|\d/.test(value[i + 1] || ""))) positions.push(i);
    if (!depth && /\s/.test(char) && trackNumber.test(value.slice(i).trim())) positions.push(i);
  }
  return positions;
};

export const getBilibiliCollectionTitle = (videoTitle: string, partTitles: string[] = []): string => {
  const original = text(videoTitle);
  const parts = [...new Set(partTitles.map(text).filter(Boolean))];
  const candidates = [original, ...parts];
  for (const value of candidates) {
    for (const position of titleBoundaries(value)) {
      const prefix = value.slice(0, position).trim();
      const suffix = value.slice(position).replace(separator, "").trim();
      if (!prefix || !suffix) continue;
      const matches = parts.filter((part) => part.startsWith(prefix) &&
        Boolean(part.slice(prefix.length).replace(separator, "").trim()));
      const versionOnly = matches.length > 0 && matches.every((part) =>
        /^(?:[\[(（【]?\s*)?(?:Live|Remix|Acoustic|Instrumental|Off Vocal|现场版|伴奏版|混音版)(?:\s*[\])）】])?$/i
          .test(stripTrackNumbers(part.slice(prefix.length).replace(separator, "").trim())));
      const relatedPrefix = original.startsWith(prefix) || /[\]】)）》]$/.test(prefix) || /OST|原声|专辑|合集|Soundtrack|Album/i.test(prefix);
      // Repeated album prefixes are evidence even when track numbers are absent.
      if ((matches.length >= 2 && relatedPrefix && !versionOnly) || (value === original && trackNumber.test(suffix)) ||
        (value === original && parts.some((part) => stripTrackNumbers(part) === stripTrackNumbers(suffix)))) return prefix;
    }
  }
  return original;
};

export const getBilibiliTrackTitle = (title: string, videoTitle: string): string => {
  const original = text(title);
  const collection = getBilibiliCollectionTitle(videoTitle);
  let track = original;
  // Only strip a known collection prefix, never arbitrary text before a hyphen.
  if (collection && track.startsWith(collection)) {
    const remainder = track.slice(collection.length);
    if (separator.test(remainder) || (/^\s+\S/.test(remainder) &&
      (/[\]】)）》]$/.test(collection) || trackNumber.test(remainder.trim())))) {
      track = remainder.replace(separator, "").trim();
    }
  }
  track = stripTrackNumbers(track);
  return cleanSongTitle(track || original);
};

export const getBilibiliSongTitle = (video: BilibiliVideoInfo, page?: BilibiliVideoPage) => {
  const part = text(page?.part);
  const usePart = (video.pages?.length || 0) > 1 && part && !/^P?\d+$/i.test(part);
  return usePart ? getBilibiliTrackTitle(part, getBilibiliCollectionTitle(video.title, video.pages.map((item) => item.part))) : cleanSongTitle(video.title);
};

export const normalizeSongMetadata = (song: Song): Song => ({
  ...song,
  title: song.isBilibili && song.biliVideoTitle
    ? getBilibiliTrackTitle(song.title, song.biliVideoTitle)
    : cleanSongTitle(song.title),
  originalTitle: song.originalTitle || text(song.title),
  artist: text(song.artist) || (song.isBilibili ? "B站 UP主" : "未知歌手"),
});

/** Use sibling parts to simplify old imports too, without changing original names. */
export const normalizeBilibiliCollections = (songs: Song[]): Song[] => {
  const groups = new Map<string, Song[]>();
  for (const song of songs) {
    if (!song.isBilibili || !song.bvid) continue;
    const group = groups.get(song.bvid) || [];
    group.push(song); groups.set(song.bvid, group);
  }
  let changed = false;
  const titles = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const collection = getBilibiliCollectionTitle(group[0].biliVideoTitle || group[0].originalTitle || group[0].title,
      group.map((song) => song.originalTitle || song.title));
    for (const song of group) titles.set(song.id, getBilibiliTrackTitle(song.originalTitle || song.title, collection));
  }
  const result = songs.map((song) => {
    const title = titles.get(song.id);
    if (!title || title === song.title) return song;
    changed = true; return { ...song, title };
  });
  return changed ? result : songs;
};
