export interface LyricWord {
  text: string;
  startTime: number;
  endTime: number;
}

export interface LyricLine {
  key?: string; // Source lyric key (e.g. TTML itunes:key)
  time: number; // Start time in seconds
  endTime?: number; // End time in seconds (from TTML <p> end or last word)
  text: string; // Main text (e.g. Original Language)
  translation?: string; // Secondary text (e.g. Translation)
  romanization?: string; // Optional romanized lyric line
  words?: LyricWord[]; // For enhanced LRC animation of the main text
  isPreciseTiming?: boolean; // If true, end times are exact (from YRC) and shouldn't be auto-extended
  isInterlude?: boolean; // If true, this is an instrumental interlude line ("...")
  isMetadata?: boolean; // If true, line represents metadata and shouldn't drive playback
  isBackground?: boolean; // If true, this line is background vocal
  isDuet?: boolean; // If true, this line belongs to a multi-performer song
  agent?: string; // Performer ID from ttm:agent (e.g. "v1", "v2")
  align?: "left" | "right"; // Alignment for duet lines
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  fileUrl: string;
  source?: "local" | "remote" | "bilibili";
  audioQuality?: AudioQuality;
  origin?: string;
  coverUrl?: string;
  lyrics?: LyricLine[];
  colors?: string[]; // Array of dominant/accent colors
  themeColor?: string; // Stable dominant color for PWA/browser chrome
  needsLyricsMatch?: boolean; // Flag indicating song needs cloud lyrics matching
  // Netease specific fields
  isNetease?: boolean;
  neteaseId?: string;
  album?: string;
  // Bilibili specific fields
  isBilibili?: boolean;
  bvid?: string;
  biliCid?: number;
  upName?: string;
}

export type AudioQuality = "auto" | "standard" | "high" | "lossless";

export interface UserProfile {
  displayName: string;
  bio: string;
  avatarUrl?: string;
}

export interface UserPlaylist {
  id: string;
  name: string;
  songIds: string[];
  createdAt: number;
  updatedAt: number;
  coverUrl?: string;
}

export interface MusicLibrary {
  profile: UserProfile;
  likedSongIds: string[];
  favoriteSongIds: string[];
  playlists: UserPlaylist[];
}

export interface BilibiliLoginStatus {
  isLogin: boolean;
  uname?: string;
  mid?: string;
  face?: string;
  level?: number;
}

export interface BilibiliUpInfo {
  mid: string;
  uname: string;
  face: string;
  sign?: string;
  videoCount?: number;
  fans?: number;
}

export interface BilibiliVideoPage {
  cid: number;
  page: number;
  part: string;
  duration: number;
}

export interface BilibiliVideoInfo {
  bvid: string;
  aid?: number;
  title: string;
  pic: string;
  duration: number;
  durationText?: string;
  play?: number;
  author?: string;
  mid?: string;
  description?: string;
  arcurl?: string;
  pages?: BilibiliVideoPage[];
}

export interface BilibiliAudioInfo {
  url: string | null;
  cid?: number;
  bandwidth?: number;
  codec?: string;
  code?: number;
  message?: string;
}

export enum PlayState {
  PAUSED,
  PLAYING,
}

export enum PlayMode {
  LOOP_ALL,
  LOOP_ONE,
  SHUFFLE,
}
