import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Song, PlayState, PlayMode } from "../types";
import { extractColors, shuffleArray } from "../services/utils";
import { parseLyrics } from "../services/lyrics";
import {
  loadPlaybackSnapshot,
  savePlaybackSnapshot,
} from "../services/libraryStore";
import {
  fetchLyricsById,
  searchAndMatchLyrics,
  MatchedLyricsResult,
} from "../services/lyricsService";
import { sameSong, uniqueSongsAgainst } from "../services/songIdentity";
import { cancelAudioTransition, getAudioEngine, prepareAudioTransition, stopAudioEngine } from '../services/audioEngine';

type MatchStatus = "idle" | "matching" | "success" | "failed";

interface UsePlayerParams {
  isReady: boolean;
  queue: Song[];
  updateSongInQueue: (id: string, updates: Partial<Song>) => void;
  setQueue: Dispatch<SetStateAction<Song[]>>;
  onSongPlayed?: (songId: string) => void;
}

const MATCH_TIMEOUT_MS = 8000;

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Lyrics request timed out"));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
};

export const usePlayer = ({
  isReady,
  queue,
  updateSongInQueue,
  setQueue,
  onSongPlayed,
}: UsePlayerParams) => {
  const [savedPlayback] = useState(loadPlaybackSnapshot);
  const savedRef = useRef(savedPlayback);
  const restoredRef = useRef(false);
  const songRef = useRef<string | null>(savedRef.current.songId);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playState, setPlayState] = useState<PlayState>(PlayState.PAUSED);
  const playStateRef = useRef<PlayState>(PlayState.PAUSED);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playMode, setPlayMode] = useState<PlayMode>(savedRef.current.playMode);
  const [matchStatus, setMatchStatus] = useState<MatchStatus>("idle");
  const [speed, setSpeed] = useState(1);
  const [preservesPitch, setPreservesPitch] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [bufferProgress, setBufferProgress] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const isSeekingRef = useRef(false);
  const poolRef = useRef<string[]>([]);
  const pastRef = useRef<string[]>([]);
  const playRequestRef = useRef(0);
  const playVisitRef = useRef(0);
  const countedVisitRef = useRef(-1);
  const lyricsRequestRef = useRef(0);
  const advanceRef = useRef({ enabled: false, next: () => {} });
  const fadedVisitRef = useRef(-1);
  const previousIdsRef = useRef<string[]>([]);

  // Keep playStateRef in sync with playState
  useEffect(() => {
    playStateRef.current = playState;
  }, [playState]);

  const applyAudio = useCallback(() => {
    const audio = audioRef.current as (HTMLAudioElement & {
      webkitPreservesPitch?: boolean;
      mozPreservesPitch?: boolean;
    }) | null;
    if (!audio) return;

    audio.preservesPitch = preservesPitch;
    audio.webkitPreservesPitch = preservesPitch;
    audio.mozPreservesPitch = preservesPitch;
    audio.playbackRate = speed;
  }, [preservesPitch, speed]);

  const pauseAndResetCurrentAudio = useCallback(() => {
    playVisitRef.current += 1;
    playRequestRef.current += 1;
    if (!audioRef.current) return;
    prepareAudioTransition(audioRef.current);
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  }, []);

  const primeNeteaseMeta = useCallback((song?: Song) => {
    const songId = song?.neteaseId || (song?.isNetease ? song.id : "");
    if (!song || !songId) return;

    const request = window.electronAPI?.netease?.setMeta(
      songId,
      song.title,
      song.artist,
    );
    void request?.catch((error) => {
      console.warn("Failed to prime Netease metadata", error);
    });
  }, []);

  const setIndex = useCallback(
    (index: number, list: Song[] = queue) => {
      const song = index >= 0 ? list[index] : undefined;
      primeNeteaseMeta(song);
      if (songRef.current !== (song?.id ?? null)) {
        playRequestRef.current += 1;
        playVisitRef.current += 1;
      }
      songRef.current = song?.id ?? null;
      setCurrentIndex(index);
    },
    [primeNeteaseMeta, queue],
  );

  const currentSong =
    (songRef.current
      ? queue.find((song) => song.id === songRef.current)
      : null) ??
    queue[currentIndex] ??
    null;
  const resolvedAudioSrc = currentSong?.fileUrl || null;
  const accentColor = currentSong?.colors?.[0] || "#a855f7";
  const idsKey = queue.map((song) => song.id).join("\n");

  const pickShuffle = useCallback(() => {
    if (queue.length === 0) {
      return null;
    }

    const currId = currentSong?.id ?? null;
    const ids = new Set(queue.map((song) => song.id));
    const seen = new Set<string>();

    poolRef.current = poolRef.current.filter((id) => {
      if (!ids.has(id) || id === currId || seen.has(id)) {
        return false;
      }

      seen.add(id);
      return true;
    });

    if (poolRef.current.length === 0) {
      poolRef.current = shuffleArray(
        queue.map((song) => song.id).filter((id) => id !== currId),
      );
    }

    return poolRef.current.shift() ?? currId ?? queue[0]?.id ?? null;
  }, [currentSong?.id, queue]);

  const toggleMode = useCallback(() => {
    let nextMode: PlayMode;
    if (playMode === PlayMode.LOOP_ALL) nextMode = PlayMode.LOOP_ONE;
    else if (playMode === PlayMode.LOOP_ONE) nextMode = PlayMode.SHUFFLE;
    else nextMode = PlayMode.LOOP_ALL;

    setPlayMode(nextMode);
    setMatchStatus("idle");

    if (nextMode === PlayMode.SHUFFLE) {
      const currId = currentSong?.id ?? null;
      poolRef.current = shuffleArray(
        queue.map((song) => song.id).filter((id) => id !== currId),
      );
      pastRef.current = [];
    } else {
      poolRef.current = [];
      pastRef.current = [];
    }
  }, [playMode, currentSong?.id, queue]);

  const playAudioElement = useCallback(
    async (reason: string) => {
      const audio = audioRef.current;
      if (!audio) return false;
      const request = ++playRequestRef.current;
      const source = audio.src;
      const songId = songRef.current;

      try {
        setPlaybackError(null);
        // A failed media element stays failed until load() creates a fresh request.
        // Retry only on an explicit play action; never loop on unavailable tracks.
        if (audio.error) audio.load();
        applyAudio();
        getAudioEngine(audio)?.resume();
        await audio.play();
        if (request !== playRequestRef.current || source !== audio.src || songId !== songRef.current || audio.paused) return false;
        setPlayState(PlayState.PLAYING);
        playStateRef.current = PlayState.PLAYING;
        return true;
      } catch (err: any) {
        if (request !== playRequestRef.current || source !== audio.src || songId !== songRef.current) return false;
        // AbortError means a newer play() interrupted this one — not a real failure
        if (err?.name === "AbortError") {
          return false;
        }
        console.error(`${reason} failed`, err);
        cancelAudioTransition(audio);
        setPlayState(PlayState.PAUSED);
        playStateRef.current = PlayState.PAUSED;
        setPlaybackError('歌曲播放失败，请检查网络或音源后重试');
        return false;
      }
    },
    [applyAudio],
  );

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (playState === PlayState.PLAYING) {
      stopAudioEngine(audioRef.current);
      playRequestRef.current += 1;
      audioRef.current.pause();
      playStateRef.current = PlayState.PAUSED;
      setPlayState(PlayState.PAUSED);
    } else {
      const duration = audioRef.current.duration || 0;
      const isAtEnd =
        duration > 0 && audioRef.current.currentTime >= duration - 0.01;
      if (isAtEnd) {
        audioRef.current.currentTime = 0;
        setCurrentTime(0);
      }
      void playAudioElement("Play");
    }
  }, [playAudioElement, playState]);

  const play = useCallback(() => {
    void playAudioElement("Play");
  }, [playAudioElement]);

  const pause = useCallback(() => {
    if (!audioRef.current) return;
    stopAudioEngine(audioRef.current);
    playRequestRef.current += 1;
    audioRef.current.pause();
    playStateRef.current = PlayState.PAUSED;
    setPlayState(PlayState.PAUSED);
  }, []);

  const handleSeek = useCallback(
    (
      time: number,
      playImmediately: boolean = false,
      defer: boolean = false,
    ) => {
      if (!audioRef.current) return;

      if (defer) {
        // Only update visual state during drag, don't actually seek
        isSeekingRef.current = true;
        setCurrentTime(time);
      } else {
        // Actually perform the seek
        cancelAudioTransition(audioRef.current);
        audioRef.current.currentTime = time;
        setCurrentTime(time);
        isSeekingRef.current = false;
        if (playImmediately) {
          void playAudioElement("Play");
        }
      }
    },
    [playAudioElement],
  );

  const handleTimeUpdate = useCallback((allowCrossfade = false) => {
    if (!audioRef.current || isSeekingRef.current) return;
    const value = audioRef.current.currentTime;
    setCurrentTime(Number.isFinite(value) ? value : 0);
    const audio = audioRef.current;
    const seconds = getAudioEngine(audio)?.graph.settings.crossfadeSeconds ?? 0;
    if (allowCrossfade && seconds > 0 && advanceRef.current.enabled && !audio.paused &&
        Number.isFinite(audio.duration) && audio.duration > seconds * 2 &&
        audio.duration - value > 0 && audio.duration - value <= seconds && fadedVisitRef.current !== playVisitRef.current) {
      fadedVisitRef.current = playVisitRef.current;
      advanceRef.current.next();
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (!audioRef.current) return;
    applyAudio();
    const value = audioRef.current.duration;
    setDuration(Number.isFinite(value) ? value : 0);
    // Don't call play() here — the dedicated auto-play effect handles all playback
    // triggering via canplay/loadedmetadata events to avoid double-play race conditions.
  }, [applyAudio]);

  useEffect(() => {
    isSeekingRef.current = false;
    setPlaybackError(null);
    setCurrentTime(0);
    setDuration(0);
  }, [currentSong?.id]);

  useEffect(() => {
    if (playMode !== PlayMode.SHUFFLE) {
      poolRef.current = [];
      pastRef.current = [];
      return;
    }

    const currId = currentSong?.id ?? null;
    const ids = new Set(queue.map((song) => song.id));
    const seen = new Set<string>();

    poolRef.current = poolRef.current.filter((id) => {
      if (!ids.has(id) || id === currId || seen.has(id)) {
        return false;
      }

      seen.add(id);
      return true;
    });

    pastRef.current = pastRef.current.filter((id) => ids.has(id));

    const extra = queue
      .map((song) => song.id)
      .filter(
        (id) =>
          id !== currId &&
          !poolRef.current.includes(id) &&
          !pastRef.current.includes(id),
      );

    if (extra.length > 0) {
      poolRef.current = [...poolRef.current, ...shuffleArray(extra)];
    }
  }, [idsKey, playMode, currentSong?.id, queue]);

  const playNext = useCallback(() => {
    if (queue.length === 0) return;

    if (playMode === PlayMode.LOOP_ONE || queue.length === 1) {
      pauseAndResetCurrentAudio();
      if (audioRef.current) {
        void playAudioElement("Loop-one play next");
      }
      return;
    }

    pauseAndResetCurrentAudio();

    if (playMode === PlayMode.SHUFFLE) {
      const nextId = pickShuffle();
      const currId = currentSong?.id ?? null;

      if (!nextId) {
        return;
      }

      if (currId && currId !== nextId) {
        pastRef.current.push(currId);
      }

      const idx = queue.findIndex((song) => song.id === nextId);
      if (idx === -1) {
        return;
      }

      setIndex(idx);
      setMatchStatus("idle");
      setPlayState(PlayState.PLAYING);
      return;
    }

    const next = (currentIndex + 1) % queue.length;
    setIndex(next);
    setMatchStatus("idle");
    setPlayState(PlayState.PLAYING);
  }, [
    queue,
    playMode,
    currentIndex,
    pauseAndResetCurrentAudio,
    setIndex,
    pickShuffle,
    currentSong?.id,
    playAudioElement,
  ]);

  const playPrev = useCallback(() => {
    if (queue.length === 0) return;
    pauseAndResetCurrentAudio();

    if (queue.length === 1) {
      void playAudioElement("Single-song play previous");
      return;
    }

    if (playMode === PlayMode.SHUFFLE) {
      const prevId = pastRef.current.pop();
      const currId = currentSong?.id ?? null;

      if (!prevId) {
        if (audioRef.current) {
          audioRef.current.currentTime = 0;
        }
        setMatchStatus("idle");
        void playAudioElement("Shuffle replay without history");
        return;
      }

      if (currId && currId !== prevId) {
        poolRef.current = [
          currId,
          ...poolRef.current.filter((id) => id !== currId),
        ];
      }

      const idx = queue.findIndex((song) => song.id === prevId);
      if (idx === -1) {
        return;
      }

      setIndex(idx);
      setMatchStatus("idle");
      setPlayState(PlayState.PLAYING);
      return;
    }

    const prev = (currentIndex - 1 + queue.length) % queue.length;
    setIndex(prev);
    setMatchStatus("idle");
    setPlayState(PlayState.PLAYING);
  }, [
    queue,
    playMode,
    currentIndex,
    pauseAndResetCurrentAudio,
    setIndex,
    currentSong?.id,
    playAudioElement,
  ]);

  advanceRef.current = { enabled: queue.length > 1 && playMode !== PlayMode.LOOP_ONE, next: playNext };
  useEffect(() => {
    const ids = new Set(queue.map(song => song.id));
    if (previousIdsRef.current.some(id => !ids.has(id))) cancelAudioTransition(audioRef.current);
    previousIdsRef.current = [...ids];
  }, [idsKey]);
  useEffect(() => () => stopAudioEngine(audioRef.current), []);

  const playIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= queue.length) return;
      pauseAndResetCurrentAudio();

      if (queue[index]?.id === currentSong?.id) {
        void playAudioElement("Replay selected song");
        return;
      }

      if (playMode === PlayMode.SHUFFLE) {
        const nextId = queue[index]?.id;
        const currId = currentSong?.id ?? null;

        if (nextId) {
          poolRef.current = poolRef.current.filter((id) => id !== nextId);
        }

        if (currId && nextId && currId !== nextId) {
          pastRef.current.push(currId);
        }
      }

      setIndex(index);
      setPlayState(PlayState.PLAYING);
      setMatchStatus("idle");
    },
    [queue, playMode, pauseAndResetCurrentAudio, setIndex, currentSong?.id, playAudioElement],
  );

  const handleAudioEnded = useCallback((stopAfterCurrent = false) => {
    playVisitRef.current += 1;
    if (stopAfterCurrent) { pause(); return; }
    if (playMode === PlayMode.LOOP_ONE) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        void playAudioElement("Loop-one replay");
      }
      return;
    }

    if (queue.length === 1) {
      setPlayState(PlayState.PAUSED);
      return;
    }

    playNext();
  }, [playMode, queue.length, playNext, playAudioElement, pause]);

  const addSongAndPlay = useCallback(
    (song: Song) => {
      pauseAndResetCurrentAudio();
      if (playMode === PlayMode.SHUFFLE && currentSong?.id && currentSong.id !== song.id) {
        pastRef.current.push(currentSong.id);
      }

      const selected = queue.find((item) => sameSong(item, song)) || song;
      setQueue((prev) => [...prev, ...uniqueSongsAgainst(prev, [selected])]);
      poolRef.current = poolRef.current.filter((id) => id !== selected.id);
      const next = queue.some((item) => item.id === selected.id) ? queue : [...queue, selected];
      setIndex(next.findIndex((item) => item.id === selected.id), next);
      setPlayState(PlayState.PLAYING);
      setMatchStatus("idle");
      if (selected.id === currentSong?.id && selected.fileUrl === currentSong.fileUrl) void playAudioElement('Replay library song');
    },
    [playMode, currentSong?.id, currentSong?.fileUrl, queue, setIndex, setQueue, pauseAndResetCurrentAudio, playAudioElement],
  );

  const handleAudioPlaying = useCallback(() => {
    if (audioRef.current) getAudioEngine(audioRef.current)?.onPlaying();
    if (!songRef.current || audioRef.current?.paused || countedVisitRef.current === playVisitRef.current) return;
    countedVisitRef.current = playVisitRef.current;
    onSongPlayed?.(songRef.current);
  }, [onSongPlayed]);

  const playSongs = useCallback((songs: Song[]) => {
    if (songs.length === 0) return;
    const next = uniqueSongsAgainst([], songs);
    pauseAndResetCurrentAudio();
    setQueue(next);
    setIndex(0, next);
    poolRef.current = [];
    pastRef.current = [];
    setPlayState(PlayState.PLAYING);
    setMatchStatus("idle");
    if (next[0].id === currentSong?.id && next[0].fileUrl === currentSong.fileUrl) void playAudioElement("Replay playlist");
  }, [setQueue, setIndex, pauseAndResetCurrentAudio, currentSong?.id, currentSong?.fileUrl, playAudioElement]);

  const handlePlaylistAddition = useCallback(
    (added: Song[], wasEmpty: boolean) => {
      if (added.length === 0) return;
      setMatchStatus("idle");
      if (!songRef.current && (wasEmpty || currentIndex === -1)) {
        setIndex(0, added);
        setPlayState(PlayState.PLAYING);
      }
    },
    [currentIndex, setIndex],
  );

  const mergeLyricsWithMetadata = useCallback(
    (result: MatchedLyricsResult) => {
      const hasTtml = Boolean(result.ttml && result.ttml.trim());

      const parsed = hasTtml
        ? parseLyrics(result.ttml!)
        : parseLyrics(result.lrc ?? "", result.tLrc, {
            yrcContent: result.yrc,
          });

      const metadataCount = result.metadata.length;
      const metadataLines = result.metadata.map((text, idx) => ({
        time: -0.1 * (metadataCount - idx),
        text,
        isMetadata: true,
      }));

      return [...metadataLines, ...parsed].sort((a, b) => a.time - b.time);
    },
    [],
  );

  const loadLyricsFile = useCallback(
    async (file?: File): Promise<boolean> => {
      if (!file || !currentSong) return false;
      const songId = currentSong.id, request = ++lyricsRequestRef.current;
      try {
        const parsedLyrics = parseLyrics(await file.text());
        if (!parsedLyrics.some((line) => !line.isMetadata && line.text.trim())) throw new Error('歌词文件中没有可用歌词');
        if (request !== lyricsRequestRef.current || songRef.current !== songId) return false;
        updateSongInQueue(songId, { lyrics: parsedLyrics, lyricsManual: true, lyricsSourceId: undefined, needsLyricsMatch: false });
        setMatchStatus("success");
        return true;
      } catch (error) {
        if (request === lyricsRequestRef.current && songRef.current === songId) setMatchStatus(currentSong.lyrics?.length ? 'success' : 'failed');
        throw error;
      }
    },
    [currentSong, updateSongInQueue],
  );

  const selectLyricsMatch = useCallback(async (sourceId: string): Promise<boolean> => {
    if (!currentSong || !/^\d+$/.test(sourceId)) return false;
    const songId = currentSong.id, request = ++lyricsRequestRef.current;
    try {
      const result = await withTimeout(fetchLyricsById(sourceId), MATCH_TIMEOUT_MS);
      if (!result) throw new Error('未找到这首歌的歌词');
      const lyrics = mergeLyricsWithMetadata(result);
      if (!lyrics.some((line) => !line.isMetadata && line.text.trim())) throw new Error('所选歌曲没有可用歌词');
      if (request !== lyricsRequestRef.current || songRef.current !== songId) return false;
      updateSongInQueue(songId, { lyrics, lyricsManual: true, lyricsSourceId: sourceId, needsLyricsMatch: false });
      setMatchStatus('success');
      return true;
    } catch (error) {
      if (request === lyricsRequestRef.current && songRef.current === songId) setMatchStatus(currentSong.lyrics?.length ? 'success' : 'failed');
      throw error;
    }
  }, [currentSong?.id, currentSong?.lyrics, mergeLyricsWithMetadata, updateSongInQueue]);

  useEffect(() => {
    const request = ++lyricsRequestRef.current;
    if (!currentSong) {
      if (matchStatus !== "idle") {
        setMatchStatus("idle");
      }
      return;
    }

    const songId = currentSong.id;
    const songTitle = currentSong.title;
    const songArtist = currentSong.artist;
    const needsLyricsMatch = currentSong.needsLyricsMatch;
    const existingLyrics = currentSong.lyrics ?? [];
    const isNeteaseSong = currentSong.isNetease;
    const songNeteaseId = currentSong.neteaseId;

    let cancelled = false;

    const markMatchFailed = () => {
      if (cancelled || request !== lyricsRequestRef.current) return;
      updateSongInQueue(songId, {
        needsLyricsMatch: false,
      });
      setMatchStatus("failed");
    };

    const markMatchSuccess = () => {
      if (cancelled || request !== lyricsRequestRef.current) return;
      setMatchStatus("success");
    };

    if (existingLyrics.length > 0) {
      markMatchSuccess();
      return;
    }

    if (currentSong.lyricsManual) return;
    if (!needsLyricsMatch) {
      markMatchFailed();
      return;
    }

    const fetchLyrics = async () => {
      setMatchStatus("matching");
      try {
        if (isNeteaseSong && songNeteaseId) {
          const raw = await withTimeout(
            fetchLyricsById(songNeteaseId),
            MATCH_TIMEOUT_MS,
          );
          if (cancelled || request !== lyricsRequestRef.current) return;
          if (raw) {
            updateSongInQueue(songId, {
              lyrics: mergeLyricsWithMetadata(raw),
              needsLyricsMatch: false,
            });
            markMatchSuccess();
          } else {
            markMatchFailed();
          }
        } else {
          const result = await withTimeout(
            searchAndMatchLyrics(songTitle, songArtist),
            MATCH_TIMEOUT_MS,
          );
          if (cancelled || request !== lyricsRequestRef.current) return;
          if (result) {
            updateSongInQueue(songId, {
              lyrics: mergeLyricsWithMetadata(result),
              needsLyricsMatch: false,
            });
            markMatchSuccess();
          } else {
            markMatchFailed();
          }
        }
      } catch (error) {
        console.warn("Lyrics matching failed:", error);
        markMatchFailed();
      }
    };

    fetchLyrics();

    return () => {
      cancelled = true;
    };
  }, [currentSong?.id, currentSong?.lyricsManual, mergeLyricsWithMetadata, updateSongInQueue]);

  // Error retry state — use ref so it persists across re-renders
  const errorRetryRef = useRef(0);
  useEffect(() => { errorRetryRef.current = 0; }, [currentSong?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const MAX_RETRIES = 2;

    const handleAudioError = () => {
      const error = audio.error;
      const code = error?.code ?? 0;
      // MEDIA_ERR_ABORTED(1) = user aborted, not a real error
      if (code === 1) return;

      console.warn(
        `Audio error (code=${code}, retry=${errorRetryRef.current}):`,
        error?.message || "Unknown error",
      );

      // For network/decode errors, retry by reloading the same source
      if (errorRetryRef.current < MAX_RETRIES && (code === 2 || code === 3) && audio.src) {
        errorRetryRef.current++;
        // Force reload without clearing src — avoids race with source resolution effect
        audio.load();
        if (playStateRef.current === PlayState.PLAYING) {
          void playAudioElement('Retry playback');
        }
        return;
      }

      // Exhausted retries or unrecoverable error
      playRequestRef.current += 1;
      cancelAudioTransition(audio);
      audio.pause();
      audio.currentTime = 0;
      setPlayState(PlayState.PAUSED);
      playStateRef.current = PlayState.PAUSED;
      setCurrentTime(0);
      setDuration(0);
      setIsBuffering(false);
      setPlaybackError(code === 2
        ? '歌曲加载失败，请检查网络后点击播放重试'
        : '音源不可用或格式不支持，请点击播放重试，或更换音源');
      errorRetryRef.current = 0;
    };

    const handleCanPlay = () => {
      // Reset retry count when audio can play successfully
      errorRetryRef.current = 0;
    };

    audio.addEventListener("error", handleAudioError);
    audio.addEventListener("canplay", handleCanPlay);
    return () => {
      audio.removeEventListener("error", handleAudioError);
      audio.removeEventListener("canplay", handleCanPlay);
    };
  }, [playAudioElement]);

  // Provide high-precision time updates directly from the native audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleNativeTimeUpdate = () => {
      if (isSeekingRef.current) return;
      const value = audio.currentTime;
      setCurrentTime(Number.isFinite(value) ? value : 0);
    };

    audio.addEventListener("timeupdate", handleNativeTimeUpdate);
    return () => {
      audio.removeEventListener("timeupdate", handleNativeTimeUpdate);
    };
  }, [audioRef]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleDurationChange = () => {
      const value = audio.duration;
      setDuration(Number.isFinite(value) ? value : 0);
    };

    audio.addEventListener("durationchange", handleDurationChange);
    return () => {
      audio.removeEventListener("durationchange", handleDurationChange);
    };
  }, [audioRef]);

  useEffect(() => {
    if (
      !currentSong ||
      !currentSong.isNetease ||
      !currentSong.coverUrl ||
      currentSong.themeColor &&
      currentSong.colors &&
      currentSong.colors.length > 0
    ) {
      return;
    }

    extractColors(currentSong.coverUrl)
      .then((colors) => {
        if (colors.length > 0) {
          updateSongInQueue(currentSong.id, {
            colors,
            themeColor: colors.themeColor,
          });
        }
      })
      .catch((err) => console.warn("Color extraction failed", err));
  }, [currentSong, updateSongInQueue]);

  useEffect(() => {
    if (!isReady || restoredRef.current) return;

    restoredRef.current = true;

    if (queue.length === 0) return;

    const idx = savedRef.current.songId
      ? queue.findIndex((song) => song.id === savedRef.current.songId)
      : -1;

    setIndex(idx !== -1 ? idx : 0);
    setMatchStatus("idle");
  }, [isReady, queue, setIndex]);

  useEffect(() => {
    if (!isReady || !restoredRef.current) return;

    savePlaybackSnapshot({
      songId: currentSong?.id ?? null,
      playMode,
    });
  }, [isReady, currentSong?.id, playMode]);

  useEffect(() => {
    if (queue.length === 0) {
      stopAudioEngine(audioRef.current);
      if (currentIndex === -1) return;
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
      setPlayState(PlayState.PAUSED);
      setIndex(-1, []);
      setCurrentTime(0);
      setDuration(0);
      setMatchStatus("idle");
      return;
    }

    const id = songRef.current;
    if (id && queue[currentIndex]?.id !== id) {
      const idx = queue.findIndex((song) => song.id === id);
      if (idx !== -1) {
        setCurrentIndex(idx);
        return;
      }

      const replacement = Math.max(0, Math.min(queue.length - 1, currentIndex));
      setIndex(replacement);
      setMatchStatus("idle");
      return;
    }

    if (currentIndex >= queue.length || !queue[currentIndex]) {
      const nextIndex = Math.max(0, Math.min(queue.length - 1, currentIndex));
      setIndex(nextIndex);
      setMatchStatus("idle");
    }
  }, [queue, currentIndex, setIndex]);

  const handleSetSpeed = useCallback((newSpeed: number) => {
    cancelAudioTransition(audioRef.current);
    setSpeed(newSpeed);
  }, []);

  const handleTogglePreservesPitch = useCallback(() => {
    cancelAudioTransition(audioRef.current);
    setPreservesPitch((prev) => !prev);
  }, []);

  // Trigger auto-play when audio source resolves and playState is PLAYING.
  // Uses canplay event as primary trigger for reliability with slow protocols.
  useEffect(() => {
    const audio = audioRef.current;
    if (
      !audio ||
      !currentSong?.id ||
      !resolvedAudioSrc ||
      playState !== PlayState.PLAYING
    ) {
      return;
    }

    let playRequested = false;

    const tryAutoPlay = () => {
      if (playRequested || playStateRef.current !== PlayState.PLAYING) return;
      if (audio.paused && audio.readyState >= 1) {
        playRequested = true;
        void playAudioElement("Auto-play on source change");
      }
    };

    // Try immediately if audio is already ready enough
    if (audio.readyState >= 1 && audio.paused) {
      tryAutoPlay();
    }

    // Listen for canplay — fires when enough data is available to start playback
    audio.addEventListener("canplay", tryAutoPlay, { once: true });
    // Also listen for loadedmetadata as a fallback for fast-loading sources
    audio.addEventListener("loadedmetadata", tryAutoPlay, { once: true });

    return () => {
      audio.removeEventListener("canplay", tryAutoPlay);
      audio.removeEventListener("loadedmetadata", tryAutoPlay);
    };
  }, [currentSong?.fileUrl, currentSong?.id, playAudioElement, playState, resolvedAudioSrc]);

  // Re-apply playback settings whenever state or source changes.
  useEffect(() => {
    applyAudio();
  }, [applyAudio, currentSong?.id, playState, resolvedAudioSrc]);


  // The media element owns loading. Observe its state instead of copying its src
  // into React state or downloading the same audio a second time.
  useEffect(() => {
    const audio = audioRef.current;
    setIsBuffering(false);
    setBufferProgress(0);
    if (!audio) return;
    const waiting = () => setIsBuffering(!audio.paused);
    const ready = () => setIsBuffering(false);
    const progress = () => {
      const value = audio.duration;
      if (Number.isFinite(value) && value > 0 && audio.buffered?.length) {
        setBufferProgress(Math.min(1, audio.buffered.end(audio.buffered.length - 1) / value));
      }
    };
    audio.addEventListener("waiting", waiting);
    audio.addEventListener("stalled", waiting);
    for (const event of ["playing", "canplay", "pause", "error", "ended"]) audio.addEventListener(event, ready);
    audio.addEventListener("progress", progress);
    audio.addEventListener("loadedmetadata", progress);
    return () => {
      audio.removeEventListener("waiting", waiting);
      audio.removeEventListener("stalled", waiting);
      for (const event of ["playing", "canplay", "pause", "error", "ended"]) audio.removeEventListener(event, ready);
      audio.removeEventListener("progress", progress);
      audio.removeEventListener("loadedmetadata", progress);
    };
  }, [currentSong?.fileUrl]);

  return {
    audioRef,
    currentSong,
    currentIndex,
    playState,
    currentTime,
    duration,
    playMode,
    matchStatus,
    accentColor,
    speed,
    preservesPitch,
    togglePlay,
    toggleMode,
    handleSeek,
    playNext,
    playPrev,
    playIndex,
    handleTimeUpdate,
    handleLoadedMetadata,
    handlePlaylistAddition,
    loadLyricsFile,
    selectLyricsMatch,
    addSongAndPlay,
    playSongs,
    handleAudioEnded,
    handleAudioPlaying,
    setSpeed: handleSetSpeed,
    togglePreservesPitch: handleTogglePreservesPitch,
    pitch: 0, // Default pitch
    setPitch: (pitch: number) => { }, // Placeholder
    play,
    pause,
    resolvedAudioSrc,
    isBuffering,
    bufferProgress,
    playbackError,
  };
};
