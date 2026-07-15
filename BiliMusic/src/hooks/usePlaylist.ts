import { useCallback, useEffect, useRef, useState } from "react";
import { AudioQuality, MusicLibrary, Song, UserPlaylist, UserProfile } from "../types";
import type { ExtractedColors } from "../services/utils";
import {
  deleteLocalFiles,
  getDefaultMusicLibrary,
  hydrateLibrarySnapshot,
  loadLibrarySnapshot,
  revokeLocalUrls,
  saveLibrarySnapshot,
  saveLocalFiles,
} from "../services/libraryStore";
import {
  extractColors,
  parseAudioMetadata,
  parseNeteaseLink,
} from "../services/utils";
import { parseLyrics } from "../services/lyrics";
import {
  fetchNeteasePlaylist,
  fetchNeteaseSong,
  getNeteaseAudioUrl,
} from "../services/lyricsService";
import {
  getVideoAudioUrl,
  getVideoInfo,
} from "../services/bilibiliService";
import { audioResourceCache } from "../services/cache";
import { useI18n } from "./useI18n";

// Levenshtein distance for fuzzy matching
const levenshteinDistance = (str1: string, str2: string): number => {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
};

// Calculate similarity score (0-1, higher is better)
const calculateSimilarity = (str1: string, str2: string): number => {
  const distance = levenshteinDistance(str1, str2);
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1;
  return 1 - distance / maxLen;
};

export interface ImportResult {
  success: boolean;
  message?: string;
  songs: Song[];
}

const makeBiliAudioUrl = (
  bvid: string,
  cid?: number,
  quality: AudioQuality = "auto",
) =>
  `bili-audio://play/${encodeURIComponent(bvid)}?cid=${encodeURIComponent(
    cid || "",
  )}&quality=${encodeURIComponent(quality)}`;

const normalizeIdentity = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[\s·•・_—–-]+/g, "")
    .replace(/[()[\]{}【】《》<>，。！？、,:;!?]/g, "");

const songIdentity = (song: Song) => {
  if (song.isNetease && song.neteaseId) return `netease:${song.neteaseId}`;
  if (song.isBilibili && song.bvid) {
    return `bilibili:${song.bvid}:${song.biliCid || 0}`;
  }
  return `track:${normalizeIdentity(song.title)}:${normalizeIdentity(song.artist)}`;
};

const uniqueAgainst = (existing: Song[], incoming: Song[]) => {
  const keys = new Set(existing.map(songIdentity));
  return incoming.filter((song) => {
    const key = songIdentity(song);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
};

export const usePlaylist = () => {
  const { dict } = useI18n();
  const [queue, setQueue] = useState<Song[]>([]);
  const [library, setLibrary] = useState<MusicLibrary>(getDefaultMusicLibrary);
  const [isReady, setIsReady] = useState(false);
  const urlsRef = useRef(new Map<string, string>());
  const queueRef = useRef<Song[]>([]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const storeUrl = useCallback((id: string, url: string) => {
    const prev = urlsRef.current.get(id);
    if (prev && prev !== url) {
      URL.revokeObjectURL(prev);
    }
    urlsRef.current.set(id, url);
  }, []);

  const dropUrls = useCallback((ids: string[]) => {
    ids.forEach((id) => {
      const url = urlsRef.current.get(id);
      if (!url) {
        return;
      }

      URL.revokeObjectURL(url);
      urlsRef.current.delete(id);
    });
  }, []);

  useEffect(() => {
    let canceled = false;

    const load = async () => {
      try {
        const snap = await loadLibrarySnapshot();
        if (!snap || canceled) {
          return;
        }

        const data = await hydrateLibrarySnapshot(snap);
        if (canceled) {
          revokeLocalUrls(data.queue);
          return;
        }

        data.queue.forEach((song) => {
          if (song.source === "local" && song.fileUrl.startsWith("blob:")) {
            storeUrl(song.id, song.fileUrl);
          }
        });

        setQueue(data.queue);
        setLibrary(data.library);
      } catch (err) {
        console.warn("Failed to restore library", err);
      } finally {
        if (!canceled) {
          setIsReady(true);
        }
      }
    };

    load();

    return () => {
      canceled = true;
      dropUrls(Array.from(urlsRef.current.keys()));
    };
  }, [dropUrls, storeUrl]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    saveLibrarySnapshot(queue, library).catch((err) => {
      console.warn("Failed to save library", err);
    });
  }, [isReady, library, queue]);

  useEffect(() => {
    if (!isReady) return;
    const validIds = new Set(queue.map((song) => song.id));
    setLibrary((prev) => {
      const likedSongIds = prev.likedSongIds.filter((id) => validIds.has(id));
      const favoriteSongIds = prev.favoriteSongIds.filter((id) => validIds.has(id));
      const playlists = prev.playlists.map((playlist) => ({
        ...playlist,
        songIds: playlist.songIds.filter((id) => validIds.has(id)),
      }));

      const unchanged =
        likedSongIds.length === prev.likedSongIds.length &&
        favoriteSongIds.length === prev.favoriteSongIds.length &&
        playlists.every(
          (playlist, index) =>
            playlist.songIds.length === prev.playlists[index]?.songIds.length,
        );

      return unchanged ? prev : { ...prev, likedSongIds, favoriteSongIds, playlists };
    });
  }, [isReady, queue]);

  const updateSongInQueue = useCallback(
    (id: string, updates: Partial<Song>) => {
      setQueue((prev) =>
        prev.map((song) => (song.id === id ? { ...song, ...updates } : song)),
      );
    },
    [],
  );

  const updateLibrary = useCallback(
    (updater: (library: MusicLibrary) => MusicLibrary) => {
      setLibrary((prev) => updater(prev));
    },
    [],
  );

  const toggleId = (list: string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  const toggleLiked = useCallback(
    (id: string) => {
      updateLibrary((prev) => ({
        ...prev,
        likedSongIds: toggleId(prev.likedSongIds, id),
      }));
    },
    [updateLibrary],
  );

  const toggleFavorite = useCallback(
    (id: string) => {
      updateLibrary((prev) => ({
        ...prev,
        favoriteSongIds: toggleId(prev.favoriteSongIds, id),
      }));
    },
    [updateLibrary],
  );

  const updateProfile = useCallback(
    (profile: Partial<UserProfile>) => {
      updateLibrary((prev) => ({
        ...prev,
        profile: { ...prev.profile, ...profile },
      }));
    },
    [updateLibrary],
  );

  const createPlaylist = useCallback(
    (name: string, songIds: string[] = []) => {
      const playlist: UserPlaylist = {
        id: `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim() || "未命名歌单",
        songIds: Array.from(new Set(songIds)),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      updateLibrary((prev) => ({
        ...prev,
        playlists: [playlist, ...prev.playlists],
      }));
      return playlist;
    },
    [updateLibrary],
  );

  const deletePlaylist = useCallback(
    (id: string) => {
      updateLibrary((prev) => ({
        ...prev,
        playlists: prev.playlists.filter((playlist) => playlist.id !== id),
      }));
    },
    [updateLibrary],
  );

  const renamePlaylist = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      updateLibrary((prev) => ({
        ...prev,
        playlists: prev.playlists.map((playlist) =>
          playlist.id === id
            ? { ...playlist, name: trimmed, updatedAt: Date.now() }
            : playlist,
        ),
      }));
    },
    [updateLibrary],
  );

  const addSongsToPlaylist = useCallback(
    (playlistId: string, songIds: string[]) => {
      updateLibrary((prev) => ({
        ...prev,
        playlists: prev.playlists.map((playlist) =>
          playlist.id === playlistId
            ? {
                ...playlist,
                songIds: Array.from(new Set([...playlist.songIds, ...songIds])),
                updatedAt: Date.now(),
              }
            : playlist,
        ),
      }));
    },
    [updateLibrary],
  );

  const removeSongFromPlaylist = useCallback(
    (playlistId: string, songId: string) => {
      updateLibrary((prev) => ({
        ...prev,
        playlists: prev.playlists.map((playlist) =>
          playlist.id === playlistId
            ? {
                ...playlist,
                songIds: playlist.songIds.filter((id) => id !== songId),
                updatedAt: Date.now(),
              }
            : playlist,
        ),
      }));
    },
    [updateLibrary],
  );

  const importLibrary = useCallback(
    (incoming: Partial<MusicLibrary>) => {
      updateLibrary((prev) => {
        const playlistMap = new Map(prev.playlists.map((item) => [item.id, item]));
        (incoming.playlists || []).forEach((playlist) => {
          if (!playlist?.id) return;
          playlistMap.set(playlist.id, {
            id: playlist.id,
            name: playlist.name || "导入的歌单",
            songIds: Array.from(new Set(playlist.songIds || [])),
            createdAt: playlist.createdAt || Date.now(),
            updatedAt: Date.now(),
            coverUrl: playlist.coverUrl,
          });
        });

        return {
          ...prev,
          profile: { ...prev.profile, ...(incoming.profile || {}) },
          likedSongIds: Array.from(
            new Set([...prev.likedSongIds, ...(incoming.likedSongIds || [])]),
          ),
          favoriteSongIds: Array.from(
            new Set([...prev.favoriteSongIds, ...(incoming.favoriteSongIds || [])]),
          ),
          playlists: Array.from(playlistMap.values()),
        };
      });
    },
    [updateLibrary],
  );

  const setSongQuality = useCallback((id: string, audioQuality: AudioQuality) => {
    setQueue((prev) =>
      prev.map((song) => {
        if (song.id !== id) return song;
        if (song.isBilibili && song.bvid) {
          return {
            ...song,
            audioQuality,
            fileUrl: makeBiliAudioUrl(song.bvid, song.biliCid, audioQuality),
          };
        }
        return { ...song, audioQuality };
      }),
    );
  }, []);

  const appendSongs = useCallback((songs: Song[]) => {
    if (songs.length === 0) return;
    setQueue((prev) => {
      const unique = uniqueAgainst(prev, songs);
      return unique.length > 0 ? [...prev, ...unique] : prev;
    });
  }, []);

  const addSongs = useCallback((songs: Song[]) => {
    appendSongs(songs);
  }, [appendSongs]);

  const reorder = useCallback((ids: string[]) => {
    if (ids.length === 0) return;

    const order = new Map(ids.map((id, idx) => [id, idx]));
    setQueue((prev) => {
      if (
        prev.length !== ids.length ||
        order.size !== ids.length ||
        prev.some((song) => !order.has(song.id))
      ) {
        return prev;
      }

      return [...prev].sort(
        (a, b) =>
          (order.get(a.id) ?? ids.length) - (order.get(b.id) ?? ids.length),
      );
    });
  }, []);

  const removeSongs = useCallback((ids: string[], options?: { onWillRemovePlaying?: () => boolean }) => {
    if (ids.length === 0) return;
    const locals = new Set<string>();

    // 检查是否要删除正在播放的歌曲
    if (options?.onWillRemovePlaying) {
      const shouldProceed = options.onWillRemovePlaying();
      if (!shouldProceed) return;
    }

    // 先收集需要释放的资源（在 setQueue 外部）
    const urlsToRelease: string[] = [];
    queueRef.current.forEach((song) => {
      if (ids.includes(song.id) && song.fileUrl && !song.fileUrl.startsWith("blob:")) {
        urlsToRelease.push(song.fileUrl);
      }
      if (ids.includes(song.id) && song.source === "local") {
        locals.add(song.id);
      }
    });

    // 释放缓存资源（在 setQueue 外部执行副作用）
    urlsToRelease.forEach((url) => audioResourceCache.delete(url));

    setQueue((prev) => prev.filter((song) => !ids.includes(song.id)));

    if (locals.size > 0) {
      const list = Array.from(locals);
      dropUrls(list);
      deleteLocalFiles(list).catch((err) => {
        console.warn("Failed to delete local files", err);
      });
    }
  }, [dropUrls]);

  const addLocalFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileList =
        files instanceof FileList ? Array.from(files) : Array.from(files);

      // Separate audio and lyrics files
      const audioFiles: File[] = [];
      const lyricsFiles: File[] = [];

      fileList.forEach((file) => {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (ext === "lrc" || ext === "txt" || ext === "json") {
          lyricsFiles.push(file);
        } else {
          audioFiles.push(file);
        }
      });

      const newSongs: Song[] = [];

      // Build lyrics map: extract song title from filename (part after first "-")
      // Remove Netease IDs like (12345678) from title
      const lyricsMap = new Map<string, File>();
      lyricsFiles.forEach((file) => {
        const basename = file.name.replace(/\.[^/.]+$/, "");
        const firstDashIndex = basename.indexOf("-");

        // If has "-", use part after first dash as title, otherwise use full basename
        let title = firstDashIndex > 0 && firstDashIndex < basename.length - 1
          ? basename.substring(firstDashIndex + 1).trim()
          : basename;

        // Remove Netease ID pattern like (12345678) or [12345678]
        title = title.replace(/[\(\[]?\d{7,9}[\)\]]?/g, "").trim();

        lyricsMap.set(title.toLowerCase(), file);
      });

      // Process audio files
      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        const basename = file.name.replace(/\.[^/.]+$/, "");
        let title = basename;
        let artist = dict.playlist.unknownArtist;
        let coverUrl: string | undefined;
        let colors: ExtractedColors | undefined;
        let themeColor: string | undefined;
        let lyrics: { time: number; text: string }[] = [];

        const nameParts = title.split("-");
        if (nameParts.length > 1) {
          artist = nameParts[0].trim();
          title = nameParts[1].trim();
        }

        try {
          const metadata = await parseAudioMetadata(file);
          if (metadata.title) title = metadata.title;
          if (metadata.artist) artist = metadata.artist;
          if (metadata.picture) {
            coverUrl = metadata.picture;
            colors = await extractColors(coverUrl);
            themeColor = colors.themeColor;
          }

          // Check for embedded lyrics first (highest priority)
          if (metadata.lyrics && metadata.lyrics.trim().length > 0) {
            try {
              lyrics = parseLyrics(metadata.lyrics);
            } catch (err) {
              console.warn("Failed to parse embedded lyrics", err);
            }
          }

          // If no embedded lyrics, try to match lyrics by fuzzy matching
          if (lyrics.length === 0) {
            // Normalize song title for matching
            const songTitle = title.toLowerCase().trim();

            // Try exact match first
            let matchedLyricsFile = lyricsMap.get(songTitle);

            // If no exact match, try fuzzy matching
            if (!matchedLyricsFile && lyricsMap.size > 0) {
              let bestMatch: { file: File; score: number } | null = null;
              const minSimilarity = 0.75; // Require 75% similarity (allows 1-2 errors for typical song titles)

              for (const [lyricsTitle, lyricsFile] of lyricsMap.entries()) {
                const similarity = calculateSimilarity(songTitle, lyricsTitle);

                if (similarity >= minSimilarity) {
                  if (!bestMatch || similarity > bestMatch.score) {
                    bestMatch = { file: lyricsFile, score: similarity };
                  }
                }
              }

              if (bestMatch) {
                matchedLyricsFile = bestMatch.file;
              }
            }

            // Load matched lyrics file
            if (matchedLyricsFile) {
              const reader = new FileReader();
              const lrcText = await new Promise<string>((resolve) => {
                reader.onload = (e) =>
                  resolve((e.target?.result as string) || "");
                reader.readAsText(matchedLyricsFile!);
              });
              if (lrcText) {
                lyrics = parseLyrics(lrcText);
              }
            }
          }
        } catch (err) {
          console.warn("Local metadata extraction failed", err);
        }

        newSongs.push({
          id: `local-${Date.now()}-${i}`,
          title,
          artist,
          fileUrl: "",
          source: "local",
          coverUrl,
          lyrics,
          colors: colors && colors.length > 0 ? colors : undefined,
          themeColor,
          needsLyricsMatch: lyrics.length === 0, // Flag for cloud matching
        });
      }

      const uniqueSongs = uniqueAgainst(queueRef.current, newSongs);
      const uniqueIds = new Set(uniqueSongs.map((song) => song.id));
      const uniqueFiles = audioFiles.filter((_, idx) => uniqueIds.has(newSongs[idx].id));

      uniqueSongs.forEach((song, idx) => {
        const url = URL.createObjectURL(uniqueFiles[idx]);
        song.fileUrl = url;
        storeUrl(song.id, url);
      });

      try {
        await saveLocalFiles(
          uniqueSongs.map((song, idx) => ({
            id: song.id,
            file: uniqueFiles[idx],
          })),
        );
      } catch (err) {
        console.warn("Failed to persist local files", err);
      }

      appendSongs(uniqueSongs);
      return uniqueSongs;
    },
    [appendSongs, dict.playlist.unknownArtist, storeUrl],
  );

  const importFromUrl = useCallback(
    async (input: string): Promise<ImportResult> => {
      const bvid = input.match(/BV[0-9A-Za-z]{10}/i)?.[0];
      if (bvid) {
        try {
          const info = await getVideoInfo(bvid);
          if (!info) throw new Error("无法读取 B 站视频信息");
          const cid = info.pages?.[0]?.cid;
          const audio = await getVideoAudioUrl(bvid, cid);
          if (!audio?.url) throw new Error(audio?.message || "无法获取 B 站音轨");

          const song: Song = {
            id: `bili-${bvid}-${audio.cid || cid || 0}`,
            title: info.title,
            artist: info.author || "B站 UP主",
            fileUrl: audio.url,
            source: "bilibili",
            audioQuality: "auto",
            coverUrl: info.pic,
            isBilibili: true,
            bvid,
            biliCid: audio.cid || cid,
            upName: info.author,
            needsLyricsMatch: true,
          };
          const uniqueSongs = uniqueAgainst(queueRef.current, [song]);
          if (uniqueSongs.length === 0) {
            return { success: false, message: "歌曲已在播放列表中", songs: [] };
          }
          appendSongs(uniqueSongs);
          return { success: true, songs: uniqueSongs };
        } catch (err) {
          console.error("Failed to import Bilibili video", err);
          return {
            success: false,
            message: err instanceof Error ? err.message : "B 站视频导入失败",
            songs: [],
          };
        }
      }

      const parsed = parseNeteaseLink(input);
      if (!parsed) {
        return {
          success: false,
          message: "请粘贴网易云歌曲/歌单链接，或 B 站视频链接/BV号",
          songs: [],
        };
      }

      const newSongs: Song[] = [];
      try {
        if (parsed.type === "playlist") {
          const songs = await fetchNeteasePlaylist(parsed.id);
          songs.forEach((song) => {
            const origin = getNeteaseAudioUrl(song.id);
            if (window.electronAPI?.netease?.setMeta) {
              window.electronAPI.netease.setMeta(song.id, song.title, song.artist);
            }
            newSongs.push({
              ...song,
              fileUrl: origin,
              source: "remote",
              origin,
              lyrics: [],
              colors: [],
              needsLyricsMatch: true,
            });
          });
        } else {
          const song = await fetchNeteaseSong(parsed.id);
          if (song) {
            const origin = getNeteaseAudioUrl(song.id);
            if (window.electronAPI?.netease?.setMeta) {
              window.electronAPI.netease.setMeta(song.id, song.title, song.artist);
            }
            newSongs.push({
              ...song,
              fileUrl: origin,
              source: "remote",
              origin,
              lyrics: [],
              colors: [],
              needsLyricsMatch: true,
            });
          }
        }
      } catch (err) {
        console.error("Failed to fetch Netease music", err);
        return {
          success: false,
          message: dict.app.importFail,
          songs: [],
        };
      }

      const uniqueSongs = uniqueAgainst(queueRef.current, newSongs);
      appendSongs(uniqueSongs);
      if (uniqueSongs.length === 0) {
        return {
          success: false,
          message: "歌曲已在播放列表中",
          songs: [],
        };
      }

      return { success: true, songs: uniqueSongs };
    },
    [appendSongs, dict.app.importFail],
  );

  return {
    queue,
    library,
    isReady,
    updateSongInQueue,
    addSongs,
    reorder,
    removeSongs,
    toggleLiked,
    toggleFavorite,
    updateProfile,
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    addSongsToPlaylist,
    removeSongFromPlaylist,
    importLibrary,
    setSongQuality,
    addLocalFiles,
    importFromUrl,
    setQueue,
  };
};
