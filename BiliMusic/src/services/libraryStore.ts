import { MusicLibrary, PlayMode, Song } from "../types";
import { getNeteaseAudioUrl } from "./lyricsService";

const DB = "bili-music";
const VER = 1;
const META = "meta";
const FILES = "files";
const SNAP = "playlist";
const PLAYBACK = "aura:playback";

const MODES = [PlayMode.LOOP_ALL, PlayMode.LOOP_ONE, PlayMode.SHUFFLE];

export interface StoredSong {
  id: string;
  title: string;
  artist: string;
  source: "local" | "remote" | "bilibili";
  audioQuality?: Song["audioQuality"];
  origin?: string;
  coverUrl?: string;
  lyrics?: Song["lyrics"];
  colors?: string[];
  themeColor?: string;
  needsLyricsMatch?: boolean;
  isNetease?: boolean;
  neteaseId?: string;
  album?: string;
  isBilibili?: boolean;
  bvid?: string;
  biliCid?: number;
  upName?: string;
}

export interface LibrarySnapshot {
  queue: StoredSong[];
  library: MusicLibrary;
}

export interface HydratedSnapshot {
  queue: Song[];
  library: MusicLibrary;
}

interface LegacyLibrarySnapshot {
  queue?: StoredSong[];
  originalQueue?: StoredSong[];
  library?: Partial<MusicLibrary>;
}

export interface PlaybackSnapshot {
  songId: string | null;
  playMode: PlayMode;
}

const getDefaultPlayback = (): PlaybackSnapshot => ({
  songId: null,
  playMode: PlayMode.LOOP_ALL,
});

const hasWindow = () => {
  return typeof window !== "undefined";
};

export const getDefaultMusicLibrary = (): MusicLibrary => ({
  profile: {
    displayName: "BiliMusic 用户",
    bio: "把喜欢的声音收进自己的小宇宙。",
  },
  likedSongIds: [],
  favoriteSongIds: [],
  playlists: [],
});

const normalizeMusicLibrary = (input?: Partial<MusicLibrary>): MusicLibrary => {
  const base = getDefaultMusicLibrary();
  return {
    profile: {
      ...base.profile,
      ...(input?.profile && typeof input.profile === "object" ? input.profile : {}),
    },
    likedSongIds: Array.isArray(input?.likedSongIds)
      ? input.likedSongIds.filter((id): id is string => typeof id === "string")
      : [],
    favoriteSongIds: Array.isArray(input?.favoriteSongIds)
      ? input.favoriteSongIds.filter((id): id is string => typeof id === "string")
      : [],
    playlists: Array.isArray(input?.playlists)
      ? input.playlists
          .filter((playlist) => playlist && typeof playlist.id === "string")
          .map((playlist) => ({
            id: playlist.id,
            name: playlist.name || "未命名歌单",
            songIds: Array.isArray(playlist.songIds)
              ? playlist.songIds.filter((id): id is string => typeof id === "string")
              : [],
            createdAt: Number(playlist.createdAt) || Date.now(),
            updatedAt: Number(playlist.updatedAt) || Date.now(),
            coverUrl: playlist.coverUrl,
          }))
      : [],
  };
};

const openDb = async (): Promise<IDBDatabase | null> => {
  if (!hasWindow() || !("indexedDB" in window)) {
    return null;
  }

  return await new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB, VER);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META);
      }

      if (!db.objectStoreNames.contains(FILES)) {
        db.createObjectStore(FILES);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open library database"));
  });
};

const waitReq = <T>(req: IDBRequest<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
};

const waitTx = (tx: IDBTransaction): Promise<void> => {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
};

const runDb = async <T>(
  names: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T>,
): Promise<T | null> => {
  const db = await openDb();
  if (!db) {
    return null;
  }

  const tx = db.transaction(names, mode);

  try {
    const value = await run(tx);
    await waitTx(tx);
    return value;
  } finally {
    db.close();
  }
};

export const toStoredSong = (song: Song): StoredSong => {
  const source = song.source ?? (song.fileUrl.startsWith("blob:") ? "local" : "remote");

  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    source,
    audioQuality: song.audioQuality,
    origin: source === "remote" ? song.origin ?? song.fileUrl : undefined,
    coverUrl: song.coverUrl,
    lyrics: song.lyrics,
    colors: song.colors,
    themeColor: song.themeColor,
    needsLyricsMatch: song.needsLyricsMatch,
    isNetease: song.isNetease,
    neteaseId: song.neteaseId,
    album: song.album,
    isBilibili: song.isBilibili,
    bvid: song.bvid,
    biliCid: song.biliCid,
    upName: song.upName,
  };
};

export const fromStoredSong = (song: StoredSong, fileUrl?: string): Song | null => {
  if (song.source === "local") {
    if (!fileUrl) {
      return null;
    }

    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      fileUrl,
      source: "local",
      audioQuality: song.audioQuality,
      coverUrl: song.coverUrl,
      lyrics: song.lyrics,
      colors: song.colors,
      themeColor: song.themeColor,
      needsLyricsMatch: song.needsLyricsMatch,
      isNetease: song.isNetease,
      neteaseId: song.neteaseId,
      album: song.album,
    };
  }

  const origin = song.isBilibili && song.bvid
    ? `bili-audio://play/${encodeURIComponent(song.bvid)}?cid=${encodeURIComponent(song.biliCid || "")}&quality=${encodeURIComponent(song.audioQuality || "auto")}`
    : song.isNetease && song.neteaseId
      ? getNeteaseAudioUrl(song.neteaseId)
      : song.origin ?? "";
  if (!origin) {
    return null;
  }

  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    fileUrl: origin,
    source: song.source,
    audioQuality: song.audioQuality,
    origin,
    coverUrl: song.coverUrl,
    lyrics: song.lyrics,
    colors: song.colors,
    themeColor: song.themeColor,
    needsLyricsMatch: song.needsLyricsMatch,
    isNetease: song.isNetease,
    neteaseId: song.neteaseId,
    album: song.album,
    isBilibili: song.isBilibili,
    bvid: song.bvid,
    biliCid: song.biliCid,
    upName: song.upName,
  };
};

export const buildLibrarySnapshot = (
  queue: Song[],
  library: MusicLibrary = getDefaultMusicLibrary(),
): LibrarySnapshot => {
  return {
    queue: queue.map(toStoredSong),
    library: normalizeMusicLibrary(library),
  };
};

export const saveLibrarySnapshot = async (
  queue: Song[],
  library?: MusicLibrary,
) => {
  const snap = buildLibrarySnapshot(queue, library);

  await runDb([META], "readwrite", async (tx) => {
    await waitReq(tx.objectStore(META).put(snap, SNAP));
    return undefined;
  });
};

export const parseLibrarySnapshot = (raw: unknown): LibrarySnapshot | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const snap = raw as LegacyLibrarySnapshot;
  const queue = Array.isArray(snap.originalQueue) && snap.originalQueue.length > 0
    ? snap.originalQueue
    : Array.isArray(snap.queue)
      ? snap.queue
      : [];

  return { queue, library: normalizeMusicLibrary(snap.library) };
};

export const loadLibrarySnapshot = async (): Promise<LibrarySnapshot | null> => {
  const value = await runDb([META], "readonly", async (tx) => {
    const raw = await waitReq(tx.objectStore(META).get(SNAP));
    return parseLibrarySnapshot(raw);
  });

  return value ?? null;
};

export const saveLocalFiles = async (list: Array<{ id: string; file: Blob }>) => {
  if (list.length === 0) {
    return;
  }

  await runDb([FILES], "readwrite", async (tx) => {
    const store = tx.objectStore(FILES);
    await Promise.all(list.map((item) => waitReq(store.put(item.file, item.id))));
    return undefined;
  });
};

export const loadLocalFile = async (id: string): Promise<Blob | null> => {
  const value = await runDb([FILES], "readonly", async (tx) => {
    const raw = await waitReq(tx.objectStore(FILES).get(id));
    return raw instanceof Blob ? raw : null;
  });

  return value ?? null;
};

export const deleteLocalFiles = async (ids: string[]) => {
  if (ids.length === 0) {
    return;
  }

  await runDb([FILES], "readwrite", async (tx) => {
    const store = tx.objectStore(FILES);
    await Promise.all(ids.map((id) => waitReq(store.delete(id))));
    return undefined;
  });
};

export const hydrateLibrarySnapshot = async (
  snap: LibrarySnapshot,
): Promise<HydratedSnapshot> => {
  const urls = new Map<string, string>();

  const hydrate = async (list: StoredSong[]) => {
    const out: Song[] = [];

    for (const item of list) {
      if (item.source === "local") {
        let url = urls.get(item.id);

        if (!url) {
          const file = await loadLocalFile(item.id);
          if (!file) {
            continue;
          }

          url = URL.createObjectURL(file);
          urls.set(item.id, url);
        }

        const song = fromStoredSong(item, url);
        if (song) {
          out.push(song);
        }

        continue;
      }

      const song = fromStoredSong(item);
      if (song) {
        out.push(song);
      }
    }

    return out;
  };

  return {
    queue: await hydrate(snap.queue),
    library: normalizeMusicLibrary(snap.library),
  };
};

export const revokeLocalUrls = (list: Song[]) => {
  if (!hasWindow()) {
    return;
  }

  const seen = new Set<string>();

  list.forEach((song) => {
    if (song.source !== "local") {
      return;
    }

    if (!song.fileUrl.startsWith("blob:")) {
      return;
    }

    if (seen.has(song.fileUrl)) {
      return;
    }

    seen.add(song.fileUrl);
    URL.revokeObjectURL(song.fileUrl);
  });
};

export const parsePlaybackSnapshot = (raw: string | null): PlaybackSnapshot => {
  if (!raw) {
    return getDefaultPlayback();
  }

  try {
    const value = JSON.parse(raw) as Partial<PlaybackSnapshot>;
    const playMode = MODES.includes(value.playMode as PlayMode)
      ? (value.playMode as PlayMode)
      : PlayMode.LOOP_ALL;

    return {
      songId: typeof value.songId === "string" && value.songId.trim()
        ? value.songId
        : null,
      playMode,
    };
  } catch {
    return getDefaultPlayback();
  }
};

export const loadPlaybackSnapshot = (): PlaybackSnapshot => {
  if (!hasWindow() || !("localStorage" in window)) {
    return getDefaultPlayback();
  }

  return parsePlaybackSnapshot(window.localStorage.getItem(PLAYBACK));
};

export const savePlaybackSnapshot = (snap: PlaybackSnapshot) => {
  if (!hasWindow() || !("localStorage" in window)) {
    return;
  }

  window.localStorage.setItem(PLAYBACK, JSON.stringify(snap));
};
