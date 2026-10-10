/// <reference types="vite-plugin-pwa/react" />

declare module "*?worker&url" {
  const url: string;
  export default url;
}

declare module "jsmediatags/dist/jsmediatags.min.js" {
  export interface Picture {
    data: number[];
    format: string;
  }

  export interface Lyrics {
    lyrics?: string;
    text?: string;
  }

  export interface Tags {
    title?: string;
    artist?: string;
    picture?: Picture;
    USLT?: Lyrics | string;
    lyrics?: string;
    LYRICS?: string;
  }

  export interface Result {
    tags: Tags;
  }

  export interface Callbacks {
    onSuccess: (tag: Result) => void;
    onError: (error: unknown) => void;
  }

  const jsmediatags: {
    read(file: File | Blob | string, callbacks: Callbacks): void;
  };

  export default jsmediatags;
}

declare const __APP_VERSION__: string;

interface Window {
  electronAPI?: {
    openFileDialog: () => Promise<string[]>;
    storeGet: (key: string) => Promise<unknown>;
    storeSet: (key: string, value: unknown) => Promise<boolean>;
    desktop: {
      openMini: () => Promise<boolean>;
      openLyrics: () => Promise<boolean>;
      getLyricsPreferences: () => Promise<import('./types').DesktopLyricsPreferences>;
      setLyricsPreferences: (preferences: import('./types').DesktopLyricsPreferences) => Promise<import('./types').DesktopLyricsPreferences>;
      unlockLyrics: () => Promise<void>;
      closeLyrics: () => Promise<void>;
      configureShortcuts: (bindings: import('./types').AppPreferences['shortcuts']) => Promise<{success:boolean;error?:string}>;
      onLyricsPreferences: (callback: (preferences: import('./types').DesktopLyricsPreferences) => void) => () => void;
      getState: () => Promise<import('./types').DesktopPlayerState>;
      updateState: (state: import('./types').DesktopPlayerState) => Promise<void>;
      command: (command: import('./types').DesktopCommand) => Promise<void>;
      setTopmost: (value: boolean) => Promise<boolean>;
      closePanel: () => Promise<void>;
      quit: () => Promise<void>;
      onCommand: (callback: (command: import('./types').DesktopCommand) => void) => () => void;
      onState: (callback: (state: import('./types').DesktopPlayerState) => void) => () => void;
    };
    win: {
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
      getPosition: () => Promise<[number, number]>;
      moveTo: (x: number, y: number) => Promise<void>;
      onMaximizeChange: (callback: (value: boolean) => void) => () => void;
    };
    download: {
      audio: (url: string, title: string) => Promise<unknown>;
      onProgress: (callback: (data: unknown) => void) => () => void;
      onDone: (callback: (data: unknown) => void) => () => void;
    };
    cache?: {
      clear: () => Promise<void>;
    };
    bili: {
      getLoginStatus: () => Promise<import("./types").BilibiliLoginStatus>;
      getQRCode: () => Promise<any>;
      checkQRLogin: (key: string) => Promise<any>;
      logout: () => Promise<{ success: boolean }>;
      getFollowedUpList: (page: number, pageSize: number) => Promise<any>;
      searchUp: (keyword: string) => Promise<any>;
      searchVideos: (
        keyword: string,
        page: number,
        pageSize: number,
      ) => Promise<any>;
      getUpVideos: (mid: string, page: number, pageSize: number) => Promise<any>;
      getVideoInfo: (bvid: string) => Promise<any>;
      getVideoAudioUrl: (
        bvid: string,
        cid?: number,
        quality?: import("./types").AudioQuality,
      ) => Promise<any>;
    };
    netease: {
      searchSongs: (keyword: string, limit?: number, offset?: number) => Promise<unknown>;
      getLyrics: (songId: string) => Promise<unknown>;
      getAudioUrl: (
        songId: string,
        quality?: import("./types").AudioQuality,
      ) => Promise<{ url: string | null; code: number; message?: string; quality?: string }>;
      setMeta: (songId: string, title: string, artist: string) => Promise<boolean>;
    };
    browser: {
      show: () => Promise<void>;
      hide: () => Promise<void>;
      navigate: (url: string) => Promise<void>;
      goBack: () => Promise<void>;
      goForward: () => Promise<void>;
      reload: () => Promise<void>;
      goHome: () => Promise<void>;
      getUrl: () => Promise<string>;
      onUrlChanged: (cb: (url: string) => void) => () => void;
      onNavState: (cb: (state: { canGoBack: boolean; canGoForward: boolean; isLoading: boolean }) => void) => () => void;
    };
    setMode: (mode: "music" | "video") => Promise<void>;
  };
}

declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        src?: string;
        allowpopups?: boolean | string;
        partition?: string;
        preload?: string;
        nodeintegration?: string;
        plugins?: string;
        disablewebsecurity?: string;
      },
      HTMLElement
    >;
  }
}
