import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AppPreferences, AudioQuality, MusicLibrary, Song, UserPlaylist, UserProfile } from "../types";
import { normalizePreferences } from '../services/preferences';
import type { ExtractedColors } from "../services/utils";
import {
  deleteLocalFiles,
  getDefaultMusicLibrary,
  hydrateLibrarySnapshot,
  loadLibrarySnapshot,
  normalizeMusicLibrary,
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
import { useQueueState } from "./useQueueState";
import { cleanSongTitle, normalizeSongMetadata, parseLocalFilename } from "../services/songMetadata";
import { sameSong, uniqueSongsAgainst as uniqueAgainst } from "../services/songIdentity";
import { createBilibiliSong, createNeteaseSong, makeBiliAudioUrl } from "../services/songFactory";
import { recordPlay } from "../services/playHistory";

// Levenshtein distance for fuzzy matching
const levenshteinDistance = (str1: string, str2: string): number => {
  const longer = str1.length >= str2.length ? str1 : str2;
  const shorter = str1.length >= str2.length ? str2 : str1;
  if (shorter.length === 0) return longer.length;

  let previous = Array.from({ length: shorter.length + 1 }, (_, index) => index);
  let current = new Array<number>(shorter.length + 1);
  for (let i = 1; i <= longer.length; i++) {
    current[0] = i;
    for (let j = 1; j <= shorter.length; j++) {
      const cost = longer[i - 1] === shorter[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[shorter.length];
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

export { cleanSongTitle as extractKeywords } from "../services/songMetadata";

export const usePlaylist = () => {
  const { dict } = useI18n();
  const { queue, setQueue: publishQueue, queueRef } = useQueueState();
  const { queue: songs, setQueue: setSongs, queueRef: songsRef } = useQueueState();
  // All queue writers (including player metadata updates) register songs in the
  // catalog. Removing a queue entry has no effect on catalog ownership.
  const setQueue: Dispatch<SetStateAction<Song[]>> = useCallback((update) => {
    const next = typeof update === "function" ? update(queueRef.current) : update;
    if (next === queueRef.current) return;
    const updates = new Map(next.map((song) => [song.id, song]));
    const existingIds = new Set(songsRef.current.map((song) => song.id));
    const catalog = [
      ...songsRef.current.map((song) => updates.get(song.id) ?? song),
      ...next.filter((song) => !existingIds.has(song.id)),
    ];
    if (catalog.length !== songsRef.current.length || catalog.some((song, index) => song !== songsRef.current[index])) setSongs(catalog);
    const byId = new Map(songsRef.current.map((song) => [song.id, song]));
    publishQueue(next.map((song) => byId.get(song.id)!));
  }, [publishQueue, setSongs]);
  const [library, setLibrary] = useState<MusicLibrary>(getDefaultMusicLibrary);
  const [isReady, setIsReady] = useState(false);
  const urlsRef = useRef(new Map<string, string>());
  const restoringRef = useRef(true);
  const libraryEditsRef = useRef<Array<(library: MusicLibrary) => MusicLibrary>>([]);


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
          revokeLocalUrls(data.songs ?? data.queue);
          return;
        }

        const restored = uniqueAgainst(songsRef.current, data.songs ?? data.queue);
        revokeLocalUrls((data.songs ?? data.queue).filter((song) => !restored.includes(song)));
        restored.forEach((song) => {
          if (song.source === "local" && song.fileUrl.startsWith("blob:")) {
            storeUrl(song.id, song.fileUrl);
          }
        });

        setSongs([...songsRef.current, ...restored]);
        const restoredQueue = data.queue.map((song) => songsRef.current.find((item) => sameSong(item, song)))
          .filter((song): song is Song => Boolean(song));
        setQueue([...queueRef.current, ...uniqueAgainst(queueRef.current, restoredQueue)]);
        // An import may finish before startup hydration. Keep the imported ID
        // while translating saved favorites and playlists to the same song.
        const aliases = new Map((data.songs ?? data.queue).map((song) => [song.id,
          songsRef.current.find((item) => sameSong(item, song))?.id ?? song.id]));
        const remap = (ids: string[]) => Array.from(new Set(ids.map((id) => aliases.get(id) ?? id)));
        const history = new Map<string, NonNullable<MusicLibrary['playHistory']>[number]>();
        for (const entry of data.library.playHistory ?? []) {
          const songId = aliases.get(entry.songId) ?? entry.songId;
          const previous = history.get(songId);
          history.set(songId, { songId, playCount: (previous?.playCount ?? 0) + entry.playCount,
            lastPlayedAt: Math.max(previous?.lastPlayedAt ?? 0, entry.lastPlayedAt) });
        }
        const restoredLibrary: MusicLibrary = { ...data.library,
          likedSongIds: remap(data.library.likedSongIds), favoriteSongIds: remap(data.library.favoriteSongIds),
          playlists: data.library.playlists.map((playlist) => ({ ...playlist, songIds: remap(playlist.songIds) })),
          playHistory: [...history.values()].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt),
          playEvents: data.library.playEvents?.map((event) => ({ ...event, songId: aliases.get(event.songId) ?? event.songId })),
        };
        setLibrary(libraryEditsRef.current.reduce((value, edit) => edit(value), restoredLibrary));
      } catch (err) {
        console.warn("Failed to restore library", err);
      } finally {
        if (!canceled) {
          restoringRef.current = false;
          libraryEditsRef.current = [];
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

    saveLibrarySnapshot(queue, library, songs).catch((err) => {
      console.warn("Failed to save library", err);
    });
  }, [isReady, library, queue, songs]);

  useEffect(() => {
    if (!isReady) return;
    const validIds = new Set(songs.map((song) => song.id));
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
  }, [isReady, songs]);

  const updateSongInQueue = useCallback(
    (id: string, updates: Partial<Song>) => {
      setSongs((prev) => prev.map((song) => song.id === id ? { ...song, ...updates, id } : song));
      setQueue((prev) =>
        prev.map((song) => (song.id === id ? { ...song, ...updates, id } : song)),
      );
    },
    [],
  );

  const updateLibrary = useCallback(
    (updater: (library: MusicLibrary) => MusicLibrary) => {
      if (restoringRef.current) libraryEditsRef.current.push(updater);
      setLibrary((prev) => updater(prev));
    },
    [],
  );

  const toggleId = (list: string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  const recordSongPlayed = useCallback((songId: string) => {
    if (!songsRef.current.some((song) => song.id === songId)) return;
    const now = Date.now();
    updateLibrary((prev) => recordPlay(prev, songId, now));
  }, [updateLibrary]);

  const clearPlayHistory = useCallback(() => {
    updateLibrary((prev) => ({ ...prev, playHistory: [], playEvents: [] }));
  }, [updateLibrary]);

  const updatePreferences = useCallback((preferences: AppPreferences) => {
    updateLibrary((prev) => ({ ...prev, preferences: normalizePreferences(preferences) }));
  }, [updateLibrary]);

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
      const validated = normalizeMusicLibrary(incoming);
      updateLibrary((prev) => {
        const playlistMap = new Map(prev.playlists.map((item) => [item.id, item]));
        validated.playlists.forEach((playlist) => {
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
          profile: incoming?.profile ? { ...prev.profile, ...validated.profile } : prev.profile,
          likedSongIds: Array.from(
            new Set([...prev.likedSongIds, ...validated.likedSongIds]),
          ),
          favoriteSongIds: Array.from(
            new Set([...prev.favoriteSongIds, ...validated.favoriteSongIds]),
          ),
          playlists: Array.from(playlistMap.values()),
        };
      });
    },
    [updateLibrary],
  );

  const setSongQuality = useCallback((id: string, audioQuality: AudioQuality) => {
    const update = (prev: Song[]) => prev.map((song) => {
        if (song.id !== id) return song;
        if (song.isBilibili && song.bvid) {
          return {
            ...song,
            audioQuality,
            fileUrl: makeBiliAudioUrl(song.bvid, song.biliCid, audioQuality),
          };
        }
        if (song.isNetease && song.neteaseId) {
          const fileUrl = getNeteaseAudioUrl(song.neteaseId, audioQuality);
          return { ...song, audioQuality, fileUrl, origin: fileUrl };
        }
        return { ...song, audioQuality };
      });
    setSongs(update);
    setQueue(update);
  }, []);

  const appendSongs = useCallback((songs: Song[]) => {
    const candidates = songs.map(normalizeSongMetadata).map((song) =>
      songsRef.current.find((existing) => sameSong(existing, song)) ?? song);
    const unique = uniqueAgainst(queueRef.current, candidates);
    if (unique.length > 0) setQueue([...queueRef.current, ...unique]);
    return unique;
  }, [setQueue]);

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

  const removeSongs = useCallback((ids: string[]) => {
    const removedIds = new Set(ids);
    setQueue(queueRef.current.filter((song) => !removedIds.has(song.id)));
  }, [setQueue]);

  const deleteSongsFromLibrary = useCallback((ids: string[]) => {
    const removedIds = new Set(ids);
    const removed = songsRef.current.filter((song) => removedIds.has(song.id));
    if (removed.length === 0) return;
    const locals = removed.filter((song) => song.source === "local").map((song) => song.id);
    setQueue(queueRef.current.filter((song) => !removedIds.has(song.id)));
    setSongs(songsRef.current.filter((song) => !removedIds.has(song.id)));
    updateLibrary((prev) => ({ ...prev,
      playHistory: prev.playHistory?.filter((entry) => !removedIds.has(entry.songId)),
      playEvents: prev.playEvents?.filter((entry) => !removedIds.has(entry.songId)),
    }));
    removed.forEach((song) => audioResourceCache.delete(song.fileUrl));
    dropUrls(locals);
    void deleteLocalFiles(locals).catch((err) => console.warn("Failed to delete local files", err));
  }, [dropUrls, setQueue]);

  const addLocalFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileList = Array.from(files);

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

      const lyricsMap = new Map<string, File>();
      const lyricsByFilename = new Map<string, File>();
      lyricsFiles.forEach((file) => {
        const basename = file.name.replace(/\.[^/.]+$/, "").toLocaleLowerCase().trim();
        lyricsByFilename.set(basename, file);
        lyricsMap.set(parseLocalFilename(file.name).title.toLocaleLowerCase(), file);
      });

      // Process audio files
      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        const basename = file.name.replace(/\.[^/.]+$/, "");
        const filenameMetadata = parseLocalFilename(file.name, dict.playlist.unknownArtist);
        let title = filenameMetadata.title;
        let originalTitle = basename;
        let artist = filenameMetadata.artist;
        let coverUrl: string | undefined;
        let colors: ExtractedColors | undefined;
        let themeColor: string | undefined;
        let lyrics: { time: number; text: string }[] = [];



        try {
          const metadata = await parseAudioMetadata(file);
          if (metadata.title?.trim()) {
            originalTitle = metadata.title;
            title = cleanSongTitle(metadata.title);
          }
          if (metadata.artist?.trim()) artist = metadata.artist.trim();
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
            const songTitle = title.toLocaleLowerCase().trim();

            // Try exact match first
            let matchedLyricsFile = lyricsByFilename.get(basename.toLocaleLowerCase().trim()) || lyricsMap.get(songTitle);

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
              const lrcText = await matchedLyricsFile.text();
              if (lrcText) {
                lyrics = parseLyrics(lrcText);
              }
            }
          }
        } catch (err) {
          console.warn("Local metadata extraction failed", err);
        }

        newSongs.push({
          id: `local-${crypto.randomUUID()}`,
          originalTitle,
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

      const retained = newSongs.map((song) => songsRef.current.find((existing) => sameSong(existing, song)))
        .filter((song): song is Song => Boolean(song));
      const uniqueSongs = uniqueAgainst(songsRef.current, newSongs);
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
        dropUrls(uniqueSongs.map((song) => song.id));
        throw new Error("本地音乐保存失败，请检查磁盘空间后重新导入。", { cause: err });
      }

      const accepted = appendSongs([...retained, ...uniqueSongs]);
      const acceptedIds = new Set(accepted.map((song) => song.id));
      const rejectedIds = uniqueSongs.filter((song) => !acceptedIds.has(song.id)).map((song) => song.id);
      dropUrls(rejectedIds);
      void deleteLocalFiles(rejectedIds).catch((err) => console.warn("Failed to clean duplicate files", err));
      return accepted;
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

          const newSongs: Song[] = [];

          const pages = info.pages?.length ? info.pages : [undefined];
          for (const page of pages) {
            try {
              const audio = await getVideoAudioUrl(bvid, page?.cid);
              if (audio?.url) newSongs.push(createBilibiliSong(info, audio, page));
            } catch (error) {
              console.warn("Failed to import Bilibili part", error);
            }
          }

          if (newSongs.length === 0) {
            throw new Error("无法获取 B 站音轨");
          }

          const uniqueSongs = appendSongs(newSongs);
          if (uniqueSongs.length === 0) {
            return { success: false, message: "歌曲已在播放列表中", songs: [] };
          }
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
        const tracks = parsed.type === "playlist"
          ? await fetchNeteasePlaylist(parsed.id)
          : [await fetchNeteaseSong(parsed.id)].filter((song) => song !== null);
        for (const track of tracks) {
          if (track) newSongs.push(createNeteaseSong(track));
        }
      } catch (err) {
        console.error("Failed to fetch Netease music", err);
        return {
          success: false,
          message: dict.app.importFail,
          songs: [],
        };
      }

      const uniqueSongs = appendSongs(newSongs);
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
    songs,
    library,
    isReady,
    recordSongPlayed,
    clearPlayHistory,
    updatePreferences,
    updateSongInQueue,
    addSongs,
    reorder,
    removeSongs,
    deleteSongsFromLibrary,
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
