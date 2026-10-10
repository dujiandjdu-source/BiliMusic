import type { AudioQuality, BilibiliAudioInfo, BilibiliVideoInfo, BilibiliVideoPage, Song } from "../types";
import { getNeteaseAudioUrl, type NeteaseTrackInfo } from "./lyricsService";
import { getBilibiliSongTitle, normalizeSongMetadata } from "./songMetadata";

export const makeBiliAudioUrl = (bvid: string, cid?: number, quality: AudioQuality = "auto") =>
  `bili-audio://play/${encodeURIComponent(bvid)}?cid=${encodeURIComponent(cid || "")}&quality=${encodeURIComponent(quality)}`;

export const createBilibiliSong = (
  video: BilibiliVideoInfo,
  audio: BilibiliAudioInfo,
  page?: BilibiliVideoPage,
  audioQuality: AudioQuality = "auto",
): Song => {
  if (!audio.url) throw new Error(audio.message || "无法获取 B 站音轨");
  const cid = audio.cid || page?.cid;
  return normalizeSongMetadata({
    id: `bili-${video.bvid}-${cid || 0}`,
    title: getBilibiliSongTitle(video, page),
    originalTitle: (video.pages?.length || 0) > 1 ? page?.part || video.title : video.title,
    biliVideoTitle: video.title,
    artist: video.author || "B站 UP主",
    fileUrl: audio.url,
    coverUrl: video.pic?.replace(/^http:/, "https:"),
    source: "bilibili", audioQuality, isBilibili: true,
    bvid: video.bvid, biliCid: cid, upName: video.author,
    needsLyricsMatch: true,
  });
};

export const createNeteaseSong = (track: NeteaseTrackInfo, quality: AudioQuality = "standard"): Song => {
  const origin = getNeteaseAudioUrl(track.neteaseId || track.id, quality);
  return normalizeSongMetadata({
    ...track, originalTitle: track.title,
    coverUrl: track.coverUrl?.replace(/^http:/, "https:"),
    fileUrl: origin, origin, source: "remote", audioQuality: quality,
    lyrics: [], needsLyricsMatch: true,
  });
};
