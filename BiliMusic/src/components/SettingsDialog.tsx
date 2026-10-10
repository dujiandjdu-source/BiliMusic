import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as bili from "../services/bilibiliService";
import type {
  BilibiliLoginStatus,
  BilibiliUpInfo,
  BilibiliVideoInfo,
  MusicLibrary,
  Song,
  UserProfile,
} from "../types";
import { CloseIcon, BilibiliIcon, LikeIcon } from "./Icons";
import { clearResourceCaches } from "../services/cache";
import { recentlyFrequentIds } from "../services/playHistory";
import SmartImage from "./SmartImage";
import PlaybackSettings, { type PlaybackSettingsProps } from './PlaybackSettings';

type SettingsTab = "profile" | "account" | "songs" | "history" | "liked" | "favorites" | "playlists" | "playback" | "about";

interface ParsedSemver {
  core: [string, string, string];
  prerelease: string[];
}

const parseSemver = (value: string): ParsedSemver | null => {
  const match = value.trim().match(
    /^[vV]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
  if (!match) return null;

  const prerelease = match[4] ? match[4].split(".") : [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) {
    return null;
  }

  return {
    core: [match[1], match[2], match[3]],
    prerelease,
  };
};

const compareNumericIdentifiers = (left: string, right: string) => {
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
};

const compareSemver = (leftValue: string, rightValue: string): number | null => {
  const left = parseSemver(leftValue);
  const right = parseSemver(rightValue);
  if (!left || !right) return null;

  for (let index = 0; index < left.core.length; index += 1) {
    const comparison = compareNumericIdentifiers(left.core[index], right.core[index]);
    if (comparison !== 0) return comparison;
  }

  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return compareNumericIdentifiers(leftPart, rightPart);
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }

  return 0;
};

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenBiliVideo: (video: BilibiliVideoInfo) => void;
  queue: Song[];
  songs: Song[];
  onDeleteSongs: (ids: string[]) => void;
  onClearHistory: () => void;
  playback: PlaybackSettingsProps;
  library: MusicLibrary;
  currentSongId?: string;
  onPlaySong: (songId: string) => void;
  onPlaySongList: (songIds: string[]) => void;
  onImportUrl: (input: string) => Promise<Song[]>;
  onToggleLiked: (songId: string) => void;
  onToggleFavorite: (songId: string) => void;
  onUpdateProfile: (profile: Partial<UserProfile>) => void;
  onCreatePlaylist: (name: string, songIds?: string[]) => void;
  onDeletePlaylist: (id: string) => void;
  onRenamePlaylist: (id: string, name: string) => void;
  onAddSongsToPlaylist: (playlistId: string, songIds: string[]) => void;
  onRemoveSongFromPlaylist: (playlistId: string, songId: string) => void;
  onImportLibrary: (library: Partial<MusicLibrary>) => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({
  isOpen,
  onClose,
  onOpenBiliVideo,
  queue,
  songs,
  onDeleteSongs,
  onClearHistory,
  playback,
  library,
  currentSongId,
  onPlaySong,
  onPlaySongList,
  onImportUrl,
  onToggleLiked,
  onToggleFavorite,
  onUpdateProfile,
  onCreatePlaylist,
  onDeletePlaylist,
  onRenamePlaylist,
  onAddSongsToPlaylist,
  onRemoveSongFromPlaylist,
  onImportLibrary,
}) => {
  const [tab, setTab] = useState<SettingsTab>("profile");
  const [login, setLogin] = useState<BilibiliLoginStatus>({ isLogin: false });
  const [showQR, setShowQR] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [qrExpired, setQrExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [upList, setUpList] = useState<BilibiliUpInfo[]>([]);
  const [videos, setVideos] = useState<BilibiliVideoInfo[]>([]);
  const [selectedUp, setSelectedUp] = useState<BilibiliUpInfo | null>(null);
  const [view, setView] = useState<"up" | "videos">("up");
  const [searchQ, setSearchQ] = useState("");
  const [searchRes, setSearchRes] = useState<BilibiliUpInfo[]>([]);
  const [profileName, setProfileName] = useState(library.profile.displayName);
  const [profileBio, setProfileBio] = useState(library.profile.bio);
  const [createName, setCreateName] = useState("");
  const [createSource, setCreateSource] = useState<"empty" | "queue" | "liked" | "favorites">("queue");
  const [importUrl, setImportUrl] = useState("");
  const [importName, setImportName] = useState("");
  const [libraryMessage, setLibraryMessage] = useState("");
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "available" | "up-to-date" | "error">("idle");
  const [updateInfo, setUpdateInfo] = useState<{ version: string; url: string } | null>(null);
  const [cacheSize, setCacheSize] = useState<string>("");
  const [isClearingCache, setIsClearingCache] = useState(false);
  const pollToken = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const songById = useMemo(
    () => new Map(songs.map((song) => [song.id, song])),
    [songs],
  );
  const likedSongs = useMemo(
    () => library.likedSongIds.map((id) => songById.get(id)).filter(Boolean) as Song[],
    [library.likedSongIds, songById],
  );
  const favoriteSongs = useMemo(
    () =>
      library.favoriteSongIds.map((id) => songById.get(id)).filter(Boolean) as Song[],
    [library.favoriteSongIds, songById],
  );

  useEffect(() => {
    setProfileName(library.profile.displayName);
    setProfileBio(library.profile.bio);
  }, [library.profile.bio, library.profile.displayName]);

  const loadUpList = useCallback(async () => {
    setLoading(true);
    setError("");
    const result = await bili.getFollowedUpList(1, 50);
    setUpList(result.list || []);
    if (result.code && result.code !== 0) {
      setError(result.message || "关注列表加载失败");
    }
    setLoading(false);
  }, []);

  const checkLogin = useCallback(async () => {
    const status = await bili.getLoginStatus();
    setLogin(status);
    if (status.isLogin) await loadUpList();
  }, [loadUpList]);

  useEffect(() => {
    if (!isOpen) {
      pollToken.current += 1;
      return;
    }
    setError("");
    checkLogin();
  }, [checkLogin, isOpen]);

  const pollQR = async (key: string) => {
    const token = ++pollToken.current;
    for (let index = 0; index < 120 && pollToken.current === token; index += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      try {
        const result = await bili.checkQRLogin(key);
        if (result.code !== 0 || !result.data) continue;
        if (result.data.code === 0) {
          setShowQR(false);
          await checkLogin();
          return;
        }
        if (result.data.code === 86038) {
          setQrExpired(true);
          setShowQR(false);
          return;
        }
      } catch {
        // ignore transient poll errors
      }
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    setError("");
    setQrExpired(false);
    try {
      const result = await bili.getQRCode();
      if (result.code !== 0 || !result.data?.imgDataUrl) {
        throw new Error(result.message || "二维码获取失败");
      }
      setQrUrl(result.data.imgDataUrl);
      setShowQR(true);
      pollQR(result.data.qrcode_key);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    pollToken.current += 1;
    await bili.logout();
    setLogin({ isLogin: false });
    setUpList([]);
    setVideos([]);
  };

  const loadVideos = async (up: BilibiliUpInfo) => {
    setSelectedUp(up);
    setView("videos");
    setLoading(true);
    setError("");
    const result = await bili.getUpVideos(up.mid, 1, 30);
    setVideos(result.list || []);
    if (result.code && result.code !== 0) {
      setError(result.message || "视频列表加载失败");
    }
    setLoading(false);
  };

  const handleSearch = async () => {
    const query = searchQ.trim();
    if (!query) return;
    setLoading(true);
    setError("");

    try {
      const bvid = query.match(/BV[0-9A-Za-z]{10}/i)?.[0];
      if (bvid) {
        const info = await bili.getVideoInfo(bvid);
        if (!info) throw new Error("没有找到这个视频");
        setSelectedUp({
          mid: info.mid || "",
          uname: info.author || "B站 UP主",
          face: info.pic,
        });
        setVideos([
          {
            bvid: info.bvid,
            title: info.title,
            pic: info.pic,
            duration: info.duration,
            author: info.author,
            mid: info.mid,
          },
        ]);
        setView("videos");
      } else {
        const result = await bili.searchUp(query);
        setSearchRes(result.list || []);
        if (result.code && result.code !== 0) {
          setError(result.message || "搜索失败");
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "搜索失败");
    } finally {
      setLoading(false);
    }
  };

  const idsForCreate = () => {
    if (createSource === "liked") return library.likedSongIds;
    if (createSource === "favorites") return library.favoriteSongIds;
    if (createSource === "queue") return queue.map((song) => song.id);
    return [];
  };

  const handleCreatePlaylist = () => {
    onCreatePlaylist(createName, idsForCreate());
    setCreateName("");
    setLibraryMessage("歌单已创建");
  };

  const handleImportUrlAsPlaylist = async () => {
    const input = importUrl.trim();
    if (!input) return;
    setLoading(true);
    setLibraryMessage("");
    try {
      const songs = await onImportUrl(input);
      if (songs.length === 0) {
        setLibraryMessage("没有导入到新歌曲，可能歌曲已经在列表中");
        return;
      }
      onCreatePlaylist(
        importName.trim() || `导入歌单 ${new Date().toLocaleDateString()}`,
        songs.map((song) => song.id),
      );
      setImportUrl("");
      setImportName("");
      setLibraryMessage(`已导入 ${songs.length} 首，并创建歌单`);
    } finally {
      setLoading(false);
    }
  };

  const handleImportLibraryFile = async (file?: File) => {
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      const imported = raw.library || raw;
      onImportLibrary(imported);
      setLibraryMessage("歌单/收藏数据已导入");
    } catch {
      setLibraryMessage("导入失败：文件格式不正确");
    }
  };

  const handleExportLibrary = () => {
    const payload = {
      app: "BiliMusic",
      version: 1,
      exportedAt: new Date().toISOString(),
      library,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "BiliMusic-Library.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  const avatar = login.face || library.profile.avatarUrl;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-2 text-white sm:p-4"
      onMouseDown={(event) => {
        if (!(event.target as HTMLElement).closest(".settings-inner")) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" aria-hidden="true" />
      <div
        className="settings-inner relative flex h-[680px] max-h-[calc(100dvh-1rem)] w-full max-w-[860px] flex-col overflow-hidden rounded-[18px] border border-white/10 bg-black/60 shadow-2xl backdrop-blur-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-[24px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <h2 id="settings-dialog-title" className="text-xl font-bold">设置与音乐库</h2>
            <p className="mt-1 text-xs text-white/40">个人主页、B站账号、喜欢收藏与歌单管理</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1 text-white/60 hover:text-white"
            aria-label="关闭设置"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <aside className="flex w-full shrink-0 gap-1 overflow-x-auto border-b border-white/10 p-2 sm:block sm:w-44 sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3">
            {([
              ["profile", "个人主页"],
              ["account", "B站账号"],
              ["songs", `音乐库 · ${songs.length}`],
              ["history", "播放历史"],
              ["liked", `喜欢 · ${likedSongs.length}`],
              ["favorites", `收藏 · ${favoriteSongs.length}`],
              ["playlists", `歌单 · ${library.playlists.length}`],
              ["playback", "播放设置"],
              ["about", "关于"],
            ] as Array<[SettingsTab, string]>).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={`w-auto shrink-0 whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-sm sm:mb-1 sm:w-full ${
                  tab === value
                    ? "bg-white/10 font-medium text-white"
                    : "text-white/55 hover:bg-white/5 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </aside>

          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {tab === "profile" && (
              <div className="space-y-4">
                <section className="rounded-3xl border border-white/8 bg-white/5 p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br from-pink-500/35 to-violet-500/35 text-2xl font-black">
                      {avatar ? <img src={avatar} className="h-full w-full object-cover" alt="" /> : profileName.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <input
                        value={profileName}
                        onChange={(event) => setProfileName(event.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-lg font-semibold outline-none focus:border-pink-300/40"
                      />
                      <textarea
                        value={profileBio}
                        onChange={(event) => setProfileBio(event.target.value)}
                        className="mt-2 h-20 w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70 outline-none focus:border-pink-300/40"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      onUpdateProfile({
                        displayName: profileName,
                        bio: profileBio,
                        avatarUrl: library.profile.avatarUrl,
                      })
                    }
                    className="mt-4 rounded-xl bg-pink-500/20 px-4 py-2 text-sm font-medium text-pink-200 hover:bg-pink-500/30"
                  >
                    保存主页
                  </button>
                </section>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatCard label="全部歌曲" value={songs.length} />
                  <StatCard label="喜欢" value={likedSongs.length} />
                  <StatCard label="收藏" value={favoriteSongs.length} />
                  <StatCard label="创建歌单" value={library.playlists.length} />
                </div>
              </div>
            )}

            {tab === "account" && (
              <div className="space-y-4">
                <section className="rounded-2xl border border-white/5 bg-white/5 p-4">
                  <div className="mb-4 flex items-center gap-3">
                    <BilibiliIcon className="h-8 w-8 text-pink-500" />
                    <div>
                      <h3 className="font-semibold">Bilibili</h3>
                      <p className="text-xs text-white/40">扫码后可查看关注、搜索 UP 主并导入视频音轨</p>
                    </div>
                  </div>

                  {login.isLogin ? (
                    <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
                      {login.face && (
                        <img src={login.face} className="h-11 w-11 rounded-full" alt="" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{login.uname}</div>
                        <div className="text-xs text-white/40">UID {login.mid}</div>
                      </div>
                      <button
                        onClick={handleLogout}
                        className="rounded-lg px-3 py-2 text-xs text-red-300 hover:bg-red-500/10"
                      >
                        退出
                      </button>
                    </div>
                  ) : showQR ? (
                    <div className="text-center">
                      <div className="inline-block rounded-xl bg-white p-2">
                        <img src={qrUrl} className="h-44 w-44" alt="B站登录二维码" />
                      </div>
                      <p className="mt-2 text-sm text-white/60">请使用哔哩哔哩 App 扫码</p>
                    </div>
                  ) : (
                    <button
                      onClick={handleLogin}
                      disabled={loading}
                      className="rounded-xl bg-pink-500/20 px-5 py-2.5 text-sm font-medium text-pink-300 hover:bg-pink-500/30 disabled:opacity-40"
                    >
                      {qrExpired ? "二维码已过期，重新获取" : loading ? "正在获取…" : "扫码登录"}
                    </button>
                  )}
                </section>

                {error && (
                  <div className="rounded-xl border border-red-400/15 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                )}

                {login.isLogin && (
                  <section className="rounded-2xl border border-white/5 bg-white/5 p-4">
                    {view === "up" ? (
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <input
                            value={searchQ}
                            onChange={(event) => setSearchQ(event.target.value)}
                            onKeyDown={(event) => event.key === "Enter" && handleSearch()}
                            placeholder="搜索 UP 主，或粘贴 BV 号"
                            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-pink-400/40"
                          />
                          <button
                            onClick={handleSearch}
                            className="rounded-xl bg-pink-500/20 px-4 text-sm text-pink-300 hover:bg-pink-500/30"
                          >
                            搜索
                          </button>
                        </div>
                        {searchRes.map((up) => (
                          <UpRow key={up.mid} up={up} onClick={() => loadVideos(up)} />
                        ))}
                        <div className="flex items-center justify-between pt-1 text-xs text-white/40">
                          <span>我的关注 · {upList.length}</span>
                          <button onClick={loadUpList} className="hover:text-white">刷新</button>
                        </div>
                        {loading ? (
                          <div className="py-5 text-center text-sm text-white/30">加载中…</div>
                        ) : (
                          upList.map((up) => (
                            <UpRow key={up.mid} up={up} onClick={() => loadVideos(up)} />
                          ))
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <button
                          onClick={() => {
                            setView("up");
                            setVideos([]);
                          }}
                          className="text-sm text-white/50 hover:text-white"
                        >
                          ← 返回 UP 主列表
                        </button>
                        <h3 className="font-medium">{selectedUp?.uname} 的视频</h3>
                        {loading && videos.length === 0 ? (
                          <div className="py-8 text-center text-sm text-white/30">加载中…</div>
                        ) : videos.length === 0 ? (
                          <div className="py-8 text-center text-sm text-white/30">暂时没有可显示的视频</div>
                        ) : (
                          <div className="grid grid-cols-2 gap-3">
                            {videos.map((video) => (
                              <button
                                key={video.bvid}
                                onClick={() =>
                                  onOpenBiliVideo({
                                    ...video,
                                    author: video.author || selectedUp?.uname,
                                  })
                                }
                                className="overflow-hidden rounded-xl bg-white/5 text-left hover:ring-1 hover:ring-pink-400/50"
                              >
                                <div className="relative aspect-video bg-white/5">
                                  <img src={video.pic} className="h-full w-full object-cover" loading="lazy" alt="" />
                                  <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px]">
                                    {formatDuration(video.duration)}
                                  </span>
                                </div>
                                <div className="line-clamp-2 p-2.5 text-xs leading-5 text-white/80">
                                  {video.title}
                                </div>
                                <div className="px-2.5 pb-2 text-[11px] text-pink-300/80">
                                  打开视频 / 获取声轨
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}

            {tab === "playback" && <PlaybackSettings {...playback} />}

            {tab === "history" && (
              <div className="space-y-4">
                <SongSection
                  title="最近常听 · 30 天"
                  empty="播放歌曲后自动生成，按近 30 天播放次数排序，最多 50 首。"
                  songs={recentlyFrequentIds(library).map((id) => songById.get(id)).filter((song): song is Song => Boolean(song))}
                  currentSongId={currentSongId} likedIds={library.likedSongIds} favoriteIds={library.favoriteSongIds}
                  onPlaySong={onPlaySong} onPlayAll={() => onPlaySongList(recentlyFrequentIds(library))}
                  onToggleLiked={onToggleLiked} onToggleFavorite={onToggleFavorite}
                />
                <SongSection
                  title="最近播放"
                  empty="还没有播放记录。"
                  songs={(library.playHistory ?? []).map((entry) => songById.get(entry.songId)).filter((song): song is Song => Boolean(song))}
                  currentSongId={currentSongId} likedIds={library.likedSongIds} favoriteIds={library.favoriteSongIds}
                  onPlaySong={onPlaySong} onPlayAll={() => onPlaySongList((library.playHistory ?? []).map((entry) => entry.songId))}
                  onToggleLiked={onToggleLiked} onToggleFavorite={onToggleFavorite}
                  describeSong={(song) => {
                    const entry = library.playHistory?.find((entry) => entry.songId === song.id);
                    return entry ? `播放 ${entry.playCount} 次 · ${new Date(entry.lastPlayedAt).toLocaleString()}` : song.artist;
                  }}
                />
                <button className="rounded-lg bg-white/8 px-3 py-2 text-sm" onClick={() => {
                  if (window.confirm("清空所有播放历史与常听统计？音乐库和歌单会保留。")) onClearHistory();
                }}>清空播放历史</button>
              </div>
            )}

            {tab === "songs" && (
              <SongSection
                title="音乐库"
                empty="导入歌曲后会自动保存在这里。移出播放队列不会删除音乐库中的歌曲。"
                songs={songs}
                currentSongId={currentSongId}
                likedIds={library.likedSongIds}
                favoriteIds={library.favoriteSongIds}
                onPlaySong={onPlaySong}
                onPlayAll={() => onPlaySongList(songs.map((song) => song.id))}
                onToggleLiked={onToggleLiked}
                onToggleFavorite={onToggleFavorite}
                onDeleteSong={(id) => {
                  if (window.confirm("从音乐库删除这首歌？同时移除收藏、歌单引用和应用内本地副本，原始文件不会删除。")) onDeleteSongs([id]);
                }}
              />
            )}

            {tab === "liked" && (
              <SongSection
                title="我喜欢的音乐"
                empty="还没有喜欢的歌曲，可以在播放列表里点爱心。"
                songs={likedSongs}
                currentSongId={currentSongId}
                likedIds={library.likedSongIds}
                favoriteIds={library.favoriteSongIds}
                onPlaySong={onPlaySong}
                onPlayAll={() => onPlaySongList(library.likedSongIds)}
                onToggleLiked={onToggleLiked}
                onToggleFavorite={onToggleFavorite}
              />
            )}

            {tab === "favorites" && (
              <SongSection
                title="我的收藏"
                empty="还没有收藏的歌曲，可以在播放列表里点“收藏”。"
                songs={favoriteSongs}
                currentSongId={currentSongId}
                likedIds={library.likedSongIds}
                favoriteIds={library.favoriteSongIds}
                onPlaySong={onPlaySong}
                onPlayAll={() => onPlaySongList(library.favoriteSongIds)}
                onToggleLiked={onToggleLiked}
                onToggleFavorite={onToggleFavorite}
              />
            )}

            {tab === "playlists" && (
              <div className="space-y-4">
                <section className="rounded-2xl border border-white/8 bg-white/5 p-4">
                  <h3 className="mb-3 font-semibold">创建歌单</h3>
                  <div className="grid gap-2 md:grid-cols-[1fr_150px_auto]">
                    <input
                      value={createName}
                      onChange={(event) => setCreateName(event.target.value)}
                      placeholder="歌单名称"
                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none placeholder:text-white/30"
                    />
                    <select
                      value={createSource}
                      onChange={(event) => setCreateSource(event.target.value as typeof createSource)}
                      className="rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none"
                    >
                      <option value="queue">从当前列表</option>
                      <option value="liked">从喜欢</option>
                      <option value="favorites">从收藏</option>
                      <option value="empty">空歌单</option>
                    </select>
                    <button
                      onClick={handleCreatePlaylist}
                      className="rounded-xl bg-pink-500/20 px-4 py-2 text-sm text-pink-200 hover:bg-pink-500/30"
                    >
                      创建
                    </button>
                  </div>
                </section>

                <section className="rounded-2xl border border-white/8 bg-white/5 p-4">
                  <h3 className="mb-3 font-semibold">导入歌单</h3>
                  <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
                    <input
                      value={importUrl}
                      onChange={(event) => setImportUrl(event.target.value)}
                      placeholder="网易云歌单/歌曲链接，或 B站视频链接/BV号"
                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none placeholder:text-white/30"
                    />
                    <input
                      value={importName}
                      onChange={(event) => setImportName(event.target.value)}
                      placeholder="导入后歌单名"
                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none placeholder:text-white/30"
                    />
                    <button
                      onClick={handleImportUrlAsPlaylist}
                      disabled={loading}
                      className="rounded-xl bg-blue-500/20 px-4 py-2 text-sm text-blue-200 hover:bg-blue-500/30 disabled:opacity-40"
                    >
                      导入
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-lg bg-white/8 px-3 py-1.5 text-white/65 hover:text-white"
                    >
                      导入 BiliMusic JSON
                    </button>
                    <button
                      onClick={handleExportLibrary}
                      className="rounded-lg bg-white/8 px-3 py-1.5 text-white/65 hover:text-white"
                    >
                      导出我的歌单数据
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(event) => handleImportLibraryFile(event.target.files?.[0])}
                    />
                    {libraryMessage && <span className="py-1.5 text-emerald-200">{libraryMessage}</span>}
                  </div>
                </section>

                {library.playlists.length === 0 ? (
                  <div className="rounded-2xl border border-white/8 bg-white/5 p-8 text-center text-sm text-white/35">
                    暂无歌单，先创建一个吧。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {library.playlists.map((playlist) => {
                      const songs = playlist.songIds.map((id) => songById.get(id)).filter(Boolean) as Song[];
                      return (
                        <section key={playlist.id} className="rounded-2xl border border-white/8 bg-white/5 p-4">
                          <div className="mb-3 flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-white/8">
                              {songs[0]?.coverUrl ? (
                                <img src={songs[0].coverUrl} className="h-full w-full object-cover" alt="" />
                              ) : (
                                "♪"
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <h4 className="truncate font-semibold">{playlist.name}</h4>
                              <p className="text-xs text-white/40">{songs.length} 首歌曲</p>
                            </div>
                            <button onClick={() => onPlaySongList(playlist.songIds)} className="rounded-lg bg-white/8 px-3 py-1.5 text-xs hover:bg-white/12">
                              播放
                            </button>
                            <button
                              onClick={() => onAddSongsToPlaylist(playlist.id, queue.map((song) => song.id))}
                              className="rounded-lg bg-white/8 px-3 py-1.5 text-xs hover:bg-white/12"
                            >
                              加当前列表
                            </button>
                            <button
                              onClick={() => {
                                const name = window.prompt("新的歌单名", playlist.name);
                                if (name) onRenamePlaylist(playlist.id, name);
                              }}
                              className="rounded-lg bg-white/8 px-3 py-1.5 text-xs hover:bg-white/12"
                            >
                              重命名
                            </button>
                            <button onClick={() => onDeletePlaylist(playlist.id)} className="rounded-lg px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10">
                              删除
                            </button>
                          </div>
                          <div className="space-y-1">
                            {songs.slice(0, 8).map((song) => (
                              <div key={song.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/5">
                                <span className="min-w-0 flex-1 truncate text-sm text-white/75">{song.title}</span>
                                <span className="truncate text-xs text-white/35">{song.artist}</span>
                                <button onClick={() => onPlaySong(song.id)} className="text-xs text-pink-200 hover:text-pink-100">播放</button>
                                <button onClick={() => onRemoveSongFromPlaylist(playlist.id, song.id)} className="text-xs text-white/35 hover:text-red-200">移除</button>
                              </div>
                            ))}
                            {songs.length > 8 && <p className="px-2 pt-1 text-xs text-white/30">还有 {songs.length - 8} 首…</p>}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                )}

              </div>
            )}

            {tab === "about" && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/5 bg-white/5 p-5 text-sm text-white/55">
                  <h3 className="mb-2 font-semibold text-white">BiliMusic {__APP_VERSION__}</h3>
                  <p>本地音乐、网易云导入与 B 站视频声轨播放器。支持个人主页、喜欢、收藏、歌单与单曲品质偏好。</p>
                </div>

                {/* Update Check */}
                <div className="rounded-2xl border border-white/5 bg-white/5 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-white text-sm">联网更新</h4>
                      <p className="mt-1 text-xs text-white/40">检查并下载最新版本</p>
                    </div>
                    <button
                      onClick={async () => {
                        setUpdateStatus("checking");
                        setUpdateInfo(null);
                        try {
                          const res = await fetch("https://api.github.com/repos/dujiandjdu-source/BiliMusic/releases/latest");
                          if (!res.ok) {
                            throw new Error(`GitHub returned ${res.status}`);
                          }

                          const data = (await res.json()) as {
                            tag_name?: unknown;
                            html_url?: unknown;
                          };
                          if (typeof data.tag_name !== "string") {
                            throw new Error("Release version is missing");
                          }

                          const comparison = compareSemver(data.tag_name, __APP_VERSION__);
                          if (comparison === null) {
                            throw new Error("Release version is invalid");
                          }

                          if (comparison > 0) {
                            const latestVer = data.tag_name.replace(/^[vV]/, "");
                            setUpdateStatus("available");
                            setUpdateInfo({
                              version: latestVer,
                              url:
                                typeof data.html_url === "string"
                                  ? data.html_url
                                  : "https://github.com/dujiandjdu-source/BiliMusic/releases/latest",
                            });
                          } else {
                            setUpdateStatus("up-to-date");
                          }
                        } catch {
                          setUpdateStatus("error");
                        }
                      }}
                      disabled={updateStatus === "checking"}
                      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                        updateStatus === "checking"
                          ? "bg-white/10 text-white/40 cursor-not-allowed"
                          : "bg-pink-500/20 text-pink-200 hover:bg-pink-500/30"
                      }`}
                    >
                      {updateStatus === "checking" ? "检查中…" : "检查更新"}
                    </button>
                  </div>

                  {updateStatus === "checking" && (
                    <div className="flex items-center gap-2 text-xs text-white/50">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-pink-400"></span>
                      正在连接到更新服务器…
                    </div>
                  )}

                  {updateStatus === "available" && updateInfo && (
                    <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/10 p-3">
                      <p className="text-sm text-emerald-200">发现新版本 v{updateInfo.version}</p>
                      <button
                        onClick={() => window.open(updateInfo.url, "_blank")}
                        className="mt-2 rounded-lg bg-emerald-500/20 px-4 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/30"
                      >
                        前往下载
                      </button>
                    </div>
                  )}

                  {updateStatus === "up-to-date" && (
                    <p className="text-xs text-emerald-200/70">已是最新版本</p>
                  )}

                  {updateStatus === "error" && (
                    <div className="rounded-xl border border-red-400/15 bg-red-500/10 p-3">
                      <p className="text-xs text-red-200">无法连接到更新服务器，请检查网络</p>
                      <button
                        onClick={() => setUpdateStatus("idle")}
                        className="mt-2 text-xs text-red-200/60 hover:text-red-200"
                      >
                        重试
                      </button>
                    </div>
                  )}
                </div>

                {/* Cache Management */}
                <div className="rounded-2xl border border-white/5 bg-white/5 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-white text-sm">缓存管理</h4>
                      <p className="mt-1 text-xs text-white/40">清除应用缓存以释放磁盘空间</p>
                    </div>
                    <button
                      onClick={async () => {
                        setIsClearingCache(true);
                        setCacheSize("");
                        try {
                          await clearResourceCaches();
                          setCacheSize("已清除");
                        } catch {
                          setCacheSize("清除失败，请重试");
                        } finally {
                          setIsClearingCache(false);
                        }
                      }}
                      disabled={isClearingCache}
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/65 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isClearingCache ? "清理中…" : "清除缓存"}
                    </button>
                  </div>
                  <p className="text-xs text-white/30" aria-live="polite">
                    {cacheSize || "缓存包括专辑封面、音频数据等临时文件"}
                  </p>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const StatCard: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
    <div className="text-2xl font-bold">{value}</div>
    <div className="mt-1 text-xs text-white/40">{label}</div>
  </div>
);

const SongSection: React.FC<{
  title: string;
  empty: string;
  songs: Song[];
  currentSongId?: string;
  likedIds: string[];
  favoriteIds: string[];
  onPlaySong: (id: string) => void;
  onPlayAll: () => void;
  onToggleLiked: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onDeleteSong?: (id: string) => void;
  describeSong?: (song: Song) => string;
}> = ({
  title,
  empty,
  songs,
  currentSongId,
  likedIds,
  favoriteIds,
  onPlaySong,
  onPlayAll,
  onToggleLiked,
  onToggleFavorite,
  onDeleteSong,
  describeSong,
}) => (
  <section className="rounded-2xl border border-white/8 bg-white/5 p-4">
    <div className="mb-3 flex items-center justify-between">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-white/40">{songs.length} 首歌曲</p>
      </div>
      <button
        onClick={onPlayAll}
        disabled={songs.length === 0}
        className="rounded-xl bg-pink-500/20 px-4 py-2 text-sm text-pink-200 hover:bg-pink-500/30 disabled:opacity-40"
      >
        播放全部
      </button>
    </div>
    {songs.length === 0 ? (
      <div className="py-12 text-center text-sm text-white/35">{empty}</div>
    ) : (
      <div className="space-y-2">
        {songs.map((song) => (
          <div
            key={song.id}
            className={`flex items-center gap-3 rounded-xl p-2 ${song.id === currentSongId ? "bg-white/10" : "bg-white/[0.03] hover:bg-white/6"}`}
          >
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/8">
              <SmartImage src={song.coverUrl || ""} alt="" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{song.title}</div>
              <div className="truncate text-xs text-white/40">{describeSong?.(song) ?? song.artist}</div>
            </div>
            <button onClick={() => onPlaySong(song.id)} className="rounded-lg bg-white/8 px-3 py-1.5 text-xs hover:bg-white/12">
              播放
            </button>
            <button onClick={() => onToggleLiked(song.id)} className={`rounded-lg px-2 py-1.5 text-xs ${likedIds.includes(song.id) ? "text-pink-200" : "text-white/35 hover:text-white"}`}>
              <LikeIcon className="h-4 w-4" filled={likedIds.includes(song.id)} />
            </button>
            <button onClick={() => onToggleFavorite(song.id)} className={`rounded-lg px-2 py-1.5 text-xs ${favoriteIds.includes(song.id) ? "text-amber-200" : "text-white/35 hover:text-white"}`}>
              收藏
            </button>
            {onDeleteSong && <button onClick={() => onDeleteSong(song.id)} className="rounded-lg px-2 py-1.5 text-xs text-red-300 hover:bg-red-500/10">删除</button>}
          </div>
        ))}
      </div>
    )}
  </section>
);

const UpRow: React.FC<{ up: BilibiliUpInfo; onClick: () => void }> = ({
  up,
  onClick,
}) => (
  <button
    onClick={onClick}
    className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-white/5"
  >
    <img src={up.face} className="h-10 w-10 rounded-full" alt="" />
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm">{up.uname}</div>
      {typeof up.videoCount === "number" && (
        <div className="text-[11px] text-white/35">{up.videoCount} 个视频</div>
      )}
    </div>
    <span className="text-xs text-pink-300">查看</span>
  </button>
);

const formatDuration = (seconds: number) => {
  if (typeof seconds !== "number") return String(seconds || "");
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
};

export default SettingsDialog;
