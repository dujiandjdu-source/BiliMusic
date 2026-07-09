import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AudioQuality,
  BilibiliVideoInfo,
  BilibiliVideoPage,
  Song,
} from "../types";
import {
  getBilibiliPlayerUrl,
  getBilibiliVideoUrl,
  getVideoAudioUrl,
  getVideoInfo,
} from "../services/bilibiliService";
import { CloseIcon, PlayIcon, PlusIcon, BilibiliIcon } from "./Icons";

interface BilibiliVideoDialogProps {
  video: BilibiliVideoInfo | null;
  onClose: () => void;
  onPlayAudio: (song: Song) => void;
  onAddAudio: (song: Song) => void;
}

const BilibiliVideoDialog: React.FC<BilibiliVideoDialogProps> = ({
  video,
  onClose,
  onPlayAudio,
  onAddAudio,
}) => {
  const [details, setDetails] = useState<BilibiliVideoInfo | null>(video);
  const [selectedPage, setSelectedPage] = useState(1);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [action, setAction] = useState<"play" | "add" | "addAll" | null>(null);
  const [audioQuality, setAudioQuality] = useState<AudioQuality>("auto");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let canceled = false;
    setDetails(video);
    setSelectedPage(1);
    setError("");
    setNotice("");
    setAudioQuality("auto");

    if (!video?.bvid) return;

    const load = async () => {
      setLoadingDetails(true);
      try {
        const info = await getVideoInfo(video.bvid);
        if (!canceled && info) {
          setDetails({ ...video, ...info });
          const firstPage = info.pages?.[0]?.page || 1;
          setSelectedPage(firstPage);
        }
      } catch (reason) {
        if (!canceled) {
          setError(reason instanceof Error ? reason.message : "视频信息加载失败");
        }
      } finally {
        if (!canceled) setLoadingDetails(false);
      }
    };

    load();
    return () => {
      canceled = true;
    };
  }, [video]);

  const pages = useMemo<BilibiliVideoPage[]>(() => {
    return details?.pages && details.pages.length > 0
      ? details.pages
      : [
          {
            page: 1,
            cid: 0,
            part: details?.title || video?.title || "视频",
            duration: details?.duration || video?.duration || 0,
          },
        ];
  }, [details, video]);

  const currentPage = useMemo(() => {
    return pages.find((page) => page.page === selectedPage) || pages[0];
  }, [pages, selectedPage]);

  const playerUrl = video
    ? getBilibiliPlayerUrl(video.bvid, currentPage?.page || selectedPage)
    : "";

  const originUrl = video
    ? getBilibiliVideoUrl(video.bvid, currentPage?.page || selectedPage)
    : "";

  const handleAddAllParts = useCallback(async () => {
    if (!video || action) return;
    setAction("addAll");
    setError("");
    setNotice("");
    try {
      const songs: Song[] = [];
      for (const page of pages) {
        try {
          const audio = await getVideoAudioUrl(
            video.bvid,
            page.cid || undefined,
            audioQuality,
          );
          if (!audio?.url) continue;
          const title = details?.title || video.title;
          const part = page.part?.trim();
          const displayTitle =
            part && pages.length > 1 && part !== title ? `${title} - ${part}` : title;
          songs.push({
            id: `bili-${video.bvid}-${audio.cid || page.cid || 0}`,
            title: displayTitle,
            artist: details?.author || video.author || "B站 UP主",
            fileUrl: audio.url,
            source: "bilibili",
            audioQuality,
            coverUrl: details?.pic || video.pic,
            isBilibili: true,
            bvid: video.bvid,
            biliCid: audio.cid || page.cid,
            upName: details?.author || video.author,
            needsLyricsMatch: true,
          });
        } catch {
          // skip failed parts
        }
      }
      if (songs.length === 0) {
        throw new Error("无法获取任何分P的声轨");
      }
      songs.forEach((song) => onAddAudio(song));
      setNotice(`已加入 ${songs.length} 个分P`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "批量加入失败");
    } finally {
      setAction(null);
    }
  }, [action, audioQuality, details, onAddAudio, pages, video]);

  const buildSong = useCallback(async (): Promise<Song> => {
    if (!video) throw new Error("没有可播放的视频");

    const audio = await getVideoAudioUrl(
      video.bvid,
      currentPage?.cid || undefined,
      audioQuality,
    );
    if (!audio?.url) {
      throw new Error(audio?.message || "无法获取这个视频的声轨");
    }

    const title = details?.title || video.title;
    const part = currentPage?.part?.trim();
    const displayTitle =
      part && pages.length > 1 && part !== title ? `${title} - ${part}` : title;

    return {
      id: `bili-${video.bvid}-${audio.cid || currentPage?.cid || 0}`,
      title: displayTitle,
      artist: details?.author || video.author || "B站 UP主",
      fileUrl: audio.url,
      source: "bilibili",
      audioQuality,
      coverUrl: details?.pic || video.pic,
      isBilibili: true,
      bvid: video.bvid,
      biliCid: audio.cid || currentPage?.cid,
      upName: details?.author || video.author,
      needsLyricsMatch: true,
    };
  }, [audioQuality, currentPage, details, pages.length, video]);

  const handleAudioAction = async (nextAction: "play" | "add") => {
    if (action) return;
    setAction(nextAction);
    setError("");
    setNotice("");
    try {
      const song = await buildSong();
      if (nextAction === "play") {
        onPlayAudio(song);
        setNotice("已切换到该视频声轨");
      } else {
        onAddAudio(song);
        setNotice("已加入播放列表");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "声轨获取失败");
    } finally {
      setAction(null);
    }
  };

  if (!video) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 text-white"
      onMouseDown={(event) => {
        if (!(event.target as HTMLElement).closest(".bili-video-inner")) {
          onClose();
        }
      }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />

      <div className="bili-video-inner relative flex h-[82vh] w-full max-w-[1040px] flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#07070a]/90 shadow-2xl backdrop-blur-2xl">
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pink-500/15 text-pink-300">
              <BilibiliIcon className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">
                {details?.title || video.title}
              </h2>
              <p className="truncate text-xs text-white/45">
                {details?.author || video.author || "Bilibili"} · {video.bvid}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-white/55 hover:text-white">
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[1fr_300px]">
          <section className="min-h-0 bg-black">
            <iframe
              key={playerUrl}
              src={playerUrl}
              title={details?.title || video.title}
              className="h-full min-h-[320px] w-full border-0"
              allow="autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          </section>

          <aside className="flex min-h-0 flex-col gap-4 border-t border-white/10 bg-white/[0.03] p-4 lg:border-l lg:border-t-0">
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-white/40">
                <span>视频分 P / 声轨来源</span>
                {loadingDetails && <span>同步中…</span>}
              </div>

              <div className="max-h-44 overflow-y-auto pr-1">
                {pages.map((page) => (
                  <button
                    key={`${page.page}-${page.cid}`}
                    onClick={() => setSelectedPage(page.page)}
                    className={`mb-1.5 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                      selectedPage === page.page
                        ? "bg-pink-500/20 text-pink-100 ring-1 ring-pink-300/20"
                        : "bg-white/5 text-white/65 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <span className="shrink-0 rounded-md bg-black/30 px-1.5 py-0.5 text-[10px]">
                      P{page.page}
                    </span>
                    <span className="line-clamp-2 min-w-0 flex-1">{page.part}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs text-white/40">
                声轨品质
                <select
                  value={audioQuality}
                  onChange={(event) =>
                    setAudioQuality(event.target.value as AudioQuality)
                  }
                  className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-sm text-white outline-none"
                >
                  <option value="auto">自动（最佳可用）</option>
                  <option value="lossless">无损优先</option>
                  <option value="high">高品质</option>
                  <option value="standard">标准品质</option>
                </select>
              </label>

              <button
                onClick={() => handleAudioAction("play")}
                disabled={!!action}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-pink-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-pink-950/30 transition hover:bg-pink-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PlayIcon className="h-4 w-4" />
                {action === "play" ? "正在获取声轨…" : "播放这个声轨"}
              </button>
              <button
                onClick={() => handleAudioAction("add")}
                disabled={!!action}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white/85 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PlusIcon className="h-4 w-4" />
                {action === "add" ? "正在加入…" : "加入播放列表"}
              </button>
              {pages.length > 1 && (
                <button
                  onClick={() => handleAddAllParts()}
                  disabled={!!action}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-green-200/85 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PlusIcon className="h-4 w-4" />
                  {action === "addAll" ? "正在批量加入…" : `加入全部 ${pages.length} 个分P`}
                </button>
              )}
              <button
                onClick={() => window.open(originUrl, "_blank", "noopener,noreferrer")}
                className="w-full rounded-xl px-4 py-2 text-sm text-white/45 transition hover:bg-white/5 hover:text-white"
              >
                打开 B站原页
              </button>
            </div>

            {(error || notice) && (
              <div
                className={`rounded-xl px-3 py-2 text-xs ${
                  error
                    ? "border border-red-400/15 bg-red-500/10 text-red-200"
                    : "border border-emerald-400/15 bg-emerald-500/10 text-emerald-200"
                }`}
              >
                {error || notice}
              </div>
            )}

            <p className="mt-auto text-xs leading-5 text-white/35">
              视频在应用内用 B站播放器打开；声轨通过本地代理获取，加入列表后可以像普通歌曲一样播放。
            </p>
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default BilibiliVideoDialog;
