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

interface Window {
  electronAPI?: {
    openFileDialog: () => Promise<string[]>;
    storeGet: (key: string) => Promise<unknown>;
    storeSet: (key: string, value: unknown) => Promise<boolean>;
    win: {
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
      onMaximizeChange: (callback: (value: boolean) => void) => () => void;
    };
    download: {
      audio: (url: string, title: string) => Promise<unknown>;
      onProgress: (callback: (data: unknown) => void) => () => void;
      onDone: (callback: (data: unknown) => void) => () => void;
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
