import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "./hooks/useToast";
import { AppPreferences, PlayState, Song } from "./types";
import FluidBackground from "./components/FluidBackground";
import Controls from "./components/Controls";
import LyricsView from "./components/LyricsView";
import PlaylistPanel from "./components/PlaylistPanel";
import KeyboardShortcuts from "./components/KeyboardShortcuts";
import TopBar from "./components/TopBar";
import SearchModal from "./components/SearchModal";
import PwaUpdatePrompt from "./components/PwaUpdatePrompt";
import SettingsDialog from "./components/SettingsDialog";
import BilibiliVideoDialog from "./components/BilibiliVideoDialog";
import BilibiliWebView from "./components/BilibiliWebView";
import { usePlaylist } from "./hooks/usePlaylist";
import { usePlayer } from "./hooks/usePlayer";
import { useI18n } from "./hooks/useI18n";
import { keyboardRegistry } from "./services/keyboardRegistry";
import MediaSessionController from "./components/MediaSessionController";
import { getThemeColor } from "./services/utils";
import type { BilibiliVideoInfo } from "./types";
import { sameSong } from "./services/songIdentity";
import { normalizePreferences } from './services/preferences';
import { activeDesktopLyric, calibrateLyrics, normalizeLyricsOffset } from './services/lyricCalibration';
import { useSleepTimer } from './hooks/useSleepTimer';
import { getAudioEngine } from './services/audioEngine';

const App: React.FC = () => {
  const { toast } = useToast();
  const notifiedUpdateRef = useRef('');
  useEffect(() => window.electronAPI?.updater?.onState(state => {
    if (state.status === 'available' && state.version && notifiedUpdateRef.current !== state.version) {
      notifiedUpdateRef.current = state.version;
      toast.success(`发现新版本 v${state.version}，可在设置 → 关于中下载更新`);
    }
  }), [toast]);
  const { dict } = useI18n();
  const playlist = usePlaylist();
  const player = usePlayer({
    isReady: playlist.isReady,
    queue: playlist.queue,
    updateSongInQueue: playlist.updateSongInQueue,
    setQueue: playlist.setQueue,
    onSongPlayed: playlist.recordSongPlayed,
  });

  const {
    audioRef,
    currentSong,
    playState,
    currentTime,
    duration,
    playMode,
    matchStatus,
    accentColor,
    togglePlay,
    toggleMode,
    handleSeek,
    playNext,
    playPrev,
    handleTimeUpdate,
    handleLoadedMetadata,
    handlePlaylistAddition,
    loadLyricsFile,
    playIndex,
    addSongAndPlay,
    handleAudioEnded,
    play,
    pause,
    isBuffering,
  } = player;
  const preferences = useMemo(() => normalizePreferences(playlist.library.preferences), [playlist.library.preferences]);
  useEffect(() => {
    if (player.playbackError) toast.error(player.playbackError);
  }, [player.playbackError, toast]);
  const lyricsPreferencesKey = JSON.stringify(preferences.desktopLyrics);
  const shortcutPreferencesKey = JSON.stringify(preferences.shortcuts);
  const audioPreferencesKey = JSON.stringify(preferences.audio);
  useEffect(() => {
    if (!playlist.isReady || !audioRef.current) return;
    getAudioEngine(audioRef.current)?.configure(JSON.parse(audioPreferencesKey));
  }, [playlist.isReady, audioPreferencesKey, audioRef]);
  const preferencesRequestRef = useRef(0);
  const sleep = useSleepTimer(pause, currentSong?.id);
  const displayLyrics = useMemo(() => calibrateLyrics(currentSong?.lyrics ?? [], currentSong?.lyricsOffset ?? 0),
    [currentSong?.lyrics, currentSong?.lyricsOffset]);
  const updatePreferences = useCallback(async (incoming: AppPreferences) => {
    const next = normalizePreferences(incoming), request = ++preferencesRequestRef.current;
    if (JSON.stringify(next.shortcuts) === JSON.stringify(preferences.shortcuts)) {
      playlist.updatePreferences(next);
      return;
    }
    try {
      const result = await window.electronAPI?.desktop?.configureShortcuts(next.shortcuts);
      if (request !== preferencesRequestRef.current) return;
      if (result && !result.success) { toast.error(result.error || '快捷键注册失败'); return; }
      playlist.updatePreferences(next);
    } catch { if (request === preferencesRequestRef.current) toast.error('设置保存失败，请重试'); }
  }, [playlist.updatePreferences, preferences.shortcuts, toast]);

  useEffect(() => {
    if (!playlist.isReady) return;
    const api = window.electronAPI?.desktop;
    if (!api) return;
    let active = true;
    api.setLyricsPreferences(JSON.parse(lyricsPreferencesKey)).catch(() => { if (active) toast.error('桌面歌词设置未能应用'); });
    return () => { active = false; };
  }, [playlist.isReady, lyricsPreferencesKey, toast]);

  useEffect(() => {
    if (!playlist.isReady || !window.electronAPI?.desktop) return;
    let active = true;
    window.electronAPI.desktop.configureShortcuts(JSON.parse(shortcutPreferencesKey)).then(result => {
      if (active && !result.success) toast.error(result.error || '全局快捷键注册失败');
    }).catch(() => { if (active) toast.error('全局快捷键注册失败'); });
    return () => { active = false; };
  }, [playlist.isReady, shortcutPreferencesKey, toast]);

  useEffect(() => window.electronAPI?.desktop?.onLyricsPreferences((desktopLyrics) => {
    playlist.updatePreferences({ ...preferences, desktopLyrics });
  }), [playlist.updatePreferences, preferences]);

  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [biliVideo, setBiliVideo] = useState<BilibiliVideoInfo | null>(null);
  const [showVolumePopup, setShowVolumePopup] = useState(false);
  const [showSettingsPopup, setShowSettingsPopup] = useState(false);
  const volume = preferences.audio.volume;
  const setVolume = useCallback((volume: number) => {
    playlist.updatePreferences({ ...preferences, audio: { ...preferences.audio, volume } });
  }, [preferences, playlist.updatePreferences]);
  useEffect(() => {
    if (!playlist.isReady) return;
    player.setSpeed(preferences.audio.speed);
  }, [playlist.isReady, preferences.audio.speed, player.setSpeed]);
  useEffect(() => {
    if (playlist.isReady && player.preservesPitch !== preferences.audio.preservesPitch) player.togglePreservesPitch();
  }, [playlist.isReady, preferences.audio.preservesPitch, player.preservesPitch, player.togglePreservesPitch]);
  const setSpeed = (speed: number) => playlist.updatePreferences({ ...preferences, audio: { ...preferences.audio, speed } });
  const togglePreservesPitch = () => playlist.updatePreferences({ ...preferences, audio: { ...preferences.audio, preservesPitch: !preferences.audio.preservesPitch } });
  const [appMode, setAppMode] = useState<"music" | "video">("music");
  const [browserChromeVisible, setBrowserChromeVisible] = useState(true);
  useEffect(() => {
    void window.electronAPI?.browser?.setChromeVisible(appMode !== 'video' || browserChromeVisible);
  }, [appMode, browserChromeVisible]);

  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [activePanel, setActivePanel] = useState<"controls" | "lyrics">(
    "controls",
  );
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const mobileViewportRef = useRef<HTMLDivElement>(null);
  const theme = currentSong?.themeColor || getThemeColor(currentSong?.colors);
  const [paneWidth, setPaneWidth] = useState(() => {
    if (typeof window === "undefined") return 0;
    return window.innerWidth;
  });
  const openPlaylist = useCallback(() => {
    setShowPlaylist(true);
  }, []);

  useEffect(() => window.electronAPI?.desktop?.onCommand((command) => {
    if (typeof command === 'object') {
      const index = playlist.queue.findIndex(song => song.id === command.songId);
      if (index < 0) return;
      if (command.action === 'play-song') playIndex(index);
      if (command.action === 'like-song') playlist.toggleLiked(command.songId);
      return;
    }
    if (command === 'toggle') togglePlay();
    if (command === 'next') playNext();
    if (command === 'previous') playPrev();
    if (command === 'like' && currentSong) playlist.toggleLiked(currentSong.id);
    if (command === 'favorite' && currentSong) playlist.toggleFavorite(currentSong.id);
  }), [togglePlay, playNext, playPrev, playIndex, playlist.queue, currentSong?.id, playlist.toggleLiked, playlist.toggleFavorite]);

  useEffect(() => {
    void window.electronAPI?.desktop?.updateState({
      songId: currentSong?.id,
      queue: playlist.queue.map(song => ({ id: song.id, title: song.title, artist: song.artist, liked: playlist.library.likedSongIds.includes(song.id) })),
      title: currentSong?.title || 'BiliMusic', artist: currentSong?.artist || '选择一首歌曲',
      coverUrl: currentSong?.coverUrl, isPlaying: playState === PlayState.PLAYING,
      liked: Boolean(currentSong && playlist.library.likedSongIds.includes(currentSong.id)), currentTime, duration,
      ...activeDesktopLyric(currentSong, currentTime),
    });
  }, [currentSong, playlist.queue, playState, playlist.library.likedSongIds, currentTime, duration]);
  const closePlaylist = useCallback(() => {
    setShowPlaylist(false);
  }, []);
  const togglePlaylist = useCallback(() => {
    setShowPlaylist((prev) => !prev);
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume, audioRef]);

  // BrowserView show/hide + pause on mode switch
  useEffect(() => {
    const api = window.electronAPI?.browser;
    if (appMode === "video") {
      api?.show();
      pause();
    } else {
      api?.hide();
    }
  }, [appMode]);


  useEffect(() => {
    if (typeof window === "undefined") return;
    let meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = theme;
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 1024px)");
    const updateLayout = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsMobileLayout(event.matches);
    };
    updateLayout(query);
    query.addEventListener("change", updateLayout);
    return () => query.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    if (!isMobileLayout) {
      setActivePanel("controls");
      setTouchStartX(null);
      setDragOffsetX(0);
    }
  }, [isMobileLayout]);


  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateWidth = () => {
      setPaneWidth(window.innerWidth);
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    window.visualViewport?.addEventListener("resize", updateWidth);
    return () => {
      window.removeEventListener("resize", updateWidth);
      window.visualViewport?.removeEventListener("resize", updateWidth);
    };
  }, [isMobileLayout]);


  // Global Keyboard Registry Initialization
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyboardRegistry.handle(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Global Search Shortcut (Registered directly via useEffect for simplicity, or could use useKeyboardScope with high priority)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleFileChange = async (files: FileList) => {
    try {
    const wasEmpty = playlist.queue.length === 0;
    const addedSongs = await playlist.addLocalFiles(files);
    if (addedSongs.length > 0) {
      setTimeout(() => {
        handlePlaylistAddition(addedSongs, wasEmpty);
      }, 0);
    }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "本地音乐导入失败");
    }
  };

  const handleImportUrl = useCallback(async (input: string): Promise<boolean> => {
    const trimmed = input.trim();
    if (!trimmed) return false;
    const wasEmpty = playlist.queue.length === 0;
    const result = await playlist.importFromUrl(trimmed);
    if (!result.success) {
      toast.error(result.message ?? dict.app.importFail);
      return false;
    }
    if (result.songs.length > 0) {
      setTimeout(() => {
        handlePlaylistAddition(result.songs, wasEmpty);
      }, 0);
      toast.success(dict.app.importOk(result.songs.length));
      return true;
    }
    return false;
  }, [
    dict.app.importFail,
    dict.app.importOk,
    handlePlaylistAddition,
    playlist.importFromUrl,
    playlist.queue.length,
    toast,
  ]);

  const handleImportUrlToSongs = useCallback(async (input: string): Promise<Song[]> => {
    const trimmed = input.trim();
    if (!trimmed) return [];
    const wasEmpty = playlist.queue.length === 0;
    const result = await playlist.importFromUrl(trimmed);
    if (!result.success) {
      toast.error(result.message ?? dict.app.importFail);
      return [];
    }
    if (result.songs.length > 0) {
      setTimeout(() => {
        handlePlaylistAddition(result.songs, wasEmpty);
      }, 0);
      toast.success(dict.app.importOk(result.songs.length));
    }
    return result.songs;
  }, [
    dict.app.importFail,
    dict.app.importOk,
    handlePlaylistAddition,
    playlist.importFromUrl,
    playlist.queue.length,
    toast,
  ]);

  const handleImportAndPlay = useCallback((song: Song) => {
    // Check if song already exists in queue (by neteaseId for cloud songs, or by id)
    const existingIndex = playlist.queue.findIndex((item) => sameSong(item, song));

    if (existingIndex !== -1) {
      // Song already in queue, just play it
      playIndex(existingIndex);
    } else {
      // Add and play atomically - no race conditions!
      addSongAndPlay(playlist.songs.find((item) => sameSong(item, song)) ?? song);
    }
  }, [addSongAndPlay, playIndex, playlist.queue, playlist.songs]);

  const handleAddToQueue = useCallback((song: Song) => {
    playlist.addSongs([song]);
  }, [playlist.addSongs]);

  const handlePlaySongId = useCallback((songId: string) => {
    const index = playlist.queue.findIndex((song) => song.id === songId);
    if (index !== -1) {
      playIndex(index);
    } else {
      const song = playlist.songs.find((song) => song.id === songId);
      if (song) addSongAndPlay(song);
    }
  }, [playIndex, addSongAndPlay, playlist.queue, playlist.songs]);

  const handlePlaySongList = useCallback((songIds: string[]) => {
    const byId = new Map(playlist.songs.map((song) => [song.id, song]));
    player.playSongs(songIds.map((id) => byId.get(id)).filter((song): song is Song => Boolean(song)));
  }, [player.playSongs, playlist.songs]);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileLayout) return;
    setTouchStartX(event.touches[0]?.clientX ?? null);
    setDragOffsetX(0);
    setIsDragging(true);
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileLayout || touchStartX === null) return;
    const currentX = event.touches[0]?.clientX;
    if (currentX === undefined) return;
    const deltaX = currentX - touchStartX;
    const containerWidth = event.currentTarget.getBoundingClientRect().width;
    const limitedDelta = Math.max(
      Math.min(deltaX, containerWidth),
      -containerWidth,
    );
    setDragOffsetX(limitedDelta);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileLayout || touchStartX === null) return;
    const endX = event.changedTouches[0]?.clientX;
    if (endX === undefined) {
      setTouchStartX(null);
      setDragOffsetX(0);
      setIsDragging(false);
      return;
    }
    const deltaX = endX - touchStartX;
    const threshold = 60;
    if (deltaX > threshold) {
      setActivePanel("controls");
    } else if (deltaX < -threshold) {
      setActivePanel("lyrics");
    }
    setTouchStartX(null);
    setDragOffsetX(0);
    setIsDragging(false);
  };

  const handleTouchCancel = () => {
    if (isMobileLayout) {
      setTouchStartX(null);
      setDragOffsetX(0);
      setIsDragging(false);
    }
  };

  const toggleIndicator = () => {
    setActivePanel((prev) => (prev === "controls" ? "lyrics" : "controls"));
    setDragOffsetX(0);
    setIsDragging(false);
  };

  const controlsSection = (
    <div className="flex flex-col items-center justify-center w-full h-full z-30 relative p-4">
      <div className="relative flex flex-col items-center gap-8 w-full max-w-[720px]">
        <Controls
          isPlaying={playState === PlayState.PLAYING}
          onPlayPause={togglePlay}
          currentTime={currentTime}
          duration={duration}
          trackId={currentSong?.id || "no-song"}
          onSeek={handleSeek}
          title={currentSong?.title || dict.app.welcome}
          artist={currentSong?.artist || dict.app.selectSong}
          audioRef={audioRef}
          onNext={playNext}
          onPrev={playPrev}
          playMode={playMode}
          onToggleMode={toggleMode}
          onTogglePlaylist={openPlaylist}
          accentColor={accentColor}
          volume={volume}
          onVolumeChange={setVolume}
          speed={player.speed}
          preservesPitch={player.preservesPitch}
          onSpeedChange={setSpeed}
          onTogglePreservesPitch={togglePreservesPitch}
          coverUrl={currentSong?.coverUrl}
          isBuffering={isBuffering}
          showVolumePopup={showVolumePopup}
          setShowVolumePopup={setShowVolumePopup}
          showSettingsPopup={showSettingsPopup}
          setShowSettingsPopup={setShowSettingsPopup}
          onOpenSettings={() => setShowSettings(true)}
          playlistPanel={
            <PlaylistPanel
              isOpen={showPlaylist}
              onClose={closePlaylist}
              queue={playlist.queue}
              currentSongId={currentSong?.id}
              onPlay={playIndex}
              onImport={handleImportUrl}
              onReorder={playlist.reorder}
              onRemove={playlist.removeSongs}
              library={playlist.library}
              onToggleLiked={playlist.toggleLiked}
              onToggleFavorite={playlist.toggleFavorite}
              onQualityChange={playlist.setSongQuality}
              accentColor={accentColor}
            />
          }
        />
      </div>
    </div>
  );

  const lyricsVersion = currentSong?.lyrics ? currentSong.lyrics.length : 0;
  const lyricsKey = currentSong
    ? `${currentSong.id}-${lyricsVersion}`
    : "no-song";

  const lyricsSection = (
    <div className="w-full h-full relative z-20 flex flex-col justify-center px-4 lg:pl-12">
      <LyricsView
        key={lyricsKey}
        lyrics={displayLyrics}
        audioRef={audioRef}
        isPlaying={playState === PlayState.PLAYING}
        currentTime={currentTime}
        onSeekRequest={handleSeek}
        matchStatus={matchStatus}
      />
    </div>
  );

  const fallbackWidth = typeof window !== "undefined" ? window.innerWidth : 0;
  const effectivePaneWidth = paneWidth || fallbackWidth;
  const baseOffset = activePanel === "lyrics" ? -effectivePaneWidth : 0;
  const mobileTranslate = baseOffset + dragOffsetX;

  return (
    <div className="ios-app relative w-full h-screen flex flex-col overflow-hidden">
      <FluidBackground
        key={isMobileLayout ? "mobile" : "desktop"}
        colors={currentSong?.colors || []}
        coverUrl={currentSong?.coverUrl}
        isPlaying={playState === PlayState.PLAYING}
        isMobileLayout={isMobileLayout}
      />

      <audio
        ref={audioRef}
        src={currentSong?.fileUrl}
        onTimeUpdate={() => handleTimeUpdate(sleep.state.mode === 'off')}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => handleAudioEnded(sleep.timer.consumeEnded(currentSong?.id))}
        onPlaying={player.handleAudioPlaying}

      />

      <KeyboardShortcuts
        isPlaying={playState === PlayState.PLAYING}
        onPlayPause={togglePlay}
        onNext={playNext}
        onPrev={playPrev}
        onSeek={handleSeek}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        onVolumeChange={setVolume}
        onToggleMode={toggleMode}
        onTogglePlaylist={togglePlaylist}
        speed={player.speed}
        onSpeedChange={setSpeed}
        onToggleVolumeDialog={() => setShowVolumePopup((prev) => !prev)}
        onToggleSpeedDialog={() => setShowSettingsPopup((prev) => !prev)}
      />

      <MediaSessionController
        currentSong={currentSong ?? null}
        playState={playState}
        currentTime={currentTime}
        duration={duration}
        playbackRate={player.speed}
        onPlay={play}
        onPause={pause}
        onNext={playNext}
        onPrev={playPrev}
        onSeek={handleSeek}
      />

      <PwaUpdatePrompt />

      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onOpenBiliVideo={setBiliVideo}
        queue={playlist.queue}
        songs={playlist.songs}
        onDeleteSongs={playlist.deleteSongsFromLibrary}
        onClearHistory={playlist.clearPlayHistory}
        playback={{ song: currentSong, preferences, onPreferences: (next) => { void updatePreferences(next); },
          onLyricsOffset: (seconds) => { if (currentSong) playlist.updateSongInQueue(currentSong.id, {lyricsOffset:normalizeLyricsOffset(seconds)}); },
          onLyricsFile: loadLyricsFile, onLyricsMatch: player.selectLyricsMatch, sleep: sleep.state,
          onSleep: (value) => {
            if (value === 'off') sleep.timer.cancel();
            else if (value === 'song') { if (currentSong) sleep.timer.armAfterSong(currentSong.id); }
            else sleep.timer.armMinutes(value);
          } }}
        library={playlist.library}
        currentSongId={currentSong?.id}
        onPlaySong={handlePlaySongId}
        onPlaySongList={handlePlaySongList}
        onImportUrl={handleImportUrlToSongs}
        onToggleLiked={playlist.toggleLiked}
        onToggleFavorite={playlist.toggleFavorite}
        onUpdateProfile={playlist.updateProfile}
        onCreatePlaylist={(name, songIds) => {
          playlist.createPlaylist(name, songIds);
        }}
        onDeletePlaylist={playlist.deletePlaylist}
        onRenamePlaylist={playlist.renamePlaylist}
        onAddSongsToPlaylist={playlist.addSongsToPlaylist}
        onRemoveSongFromPlaylist={playlist.removeSongFromPlaylist}
        onImportLibrary={playlist.importLibrary}
        onBeforeRestore={() => { pause(); sleep.timer.cancel(); }}
      />

      <BilibiliVideoDialog
        video={biliVideo}
        onClose={() => setBiliVideo(null)}
        onPlayAudio={handleImportAndPlay}
        onAddAudio={handleAddToQueue}
      />

      {/* Top Bar */}
      <TopBar
        videoChromeVisible={browserChromeVisible}
        onRevealVideoChrome={() => setBrowserChromeVisible(true)}
        onFilesSelected={handleFileChange}
        appMode={appMode}
        onToggleMode={() => setAppMode((m) => (m === "music" ? "video" : "music"))}
        onSearchClick={() => setShowSearch(true)}
        onSettingsClick={() => setShowSettings(true)}
      />

      {/* Search Modal - Always rendered to preserve state, visibility handled internally */}
      <SearchModal
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
        queue={playlist.queue}
        onPlayQueueIndex={playIndex}
        onImportAndPlay={handleImportAndPlay}
        onAddToQueue={handleAddToQueue}
        onOpenBiliVideo={setBiliVideo}
        onCreatePlaylist={(name, songIds) => {
          playlist.createPlaylist(name, songIds);
        }}
        currentSong={currentSong}
        isPlaying={playState === PlayState.PLAYING}
        accentColor={accentColor}
      />

      {/* Main Content Split */}
      {appMode === "video" ? (
        <BilibiliWebView chromeVisible={browserChromeVisible} onHideChrome={() => setBrowserChromeVisible(false)} onRevealChrome={() => setBrowserChromeVisible(true)} />
      ) : isMobileLayout ? (
        <div className="flex-1 relative w-full h-full">
          <div
            ref={mobileViewportRef}
            className="w-full h-full overflow-hidden"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchCancel}
          >
            <div
              className={`flex h-full ${isDragging ? "transition-none" : "transition-transform duration-300"}`}
              style={{
                width: `${effectivePaneWidth * 2}px`,
                transform: `translateX(${mobileTranslate}px)`,
              }}
            >
              <div
                className="flex-none h-full"
                style={{ width: effectivePaneWidth }}
              >
                {controlsSection}
              </div>
              <div
                className="flex-none h-full"
                style={{ width: effectivePaneWidth }}
              >
                {lyricsSection}
              </div>
            </div>
          </div>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
            <button
              type="button"
              onClick={toggleIndicator}
              className="relative flex h-4 w-28 items-center justify-center rounded-full bg-white/10 backdrop-blur-2xl border border-white/15 transition-transform duration-200 active:scale-105"
              style={{
                transform: `translateX(${isDragging ? dragOffsetX * 0.04 : 0}px)`,
              }}
            >
              <span
                className={`absolute inset-0 rounded-full bg-white/25 backdrop-blur-[30px] transition-opacity duration-200 ${
                  activePanel === "controls" ? "opacity-90" : "opacity-60"
                }`}
              />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid lg:grid-cols-2 w-full h-full">
          {controlsSection}
          {lyricsSection}
        </div>
      )}
    </div>
  );
};

export default App;
