import React, { useCallback, useEffect, useRef, useState } from "react";

const BILIBILI_URL = "https://www.bilibili.com/";

type WebviewElement = HTMLElement & {
  reload: () => void;
  loadURL: (url: string) => void;
  openDevTools?: () => void;
};

type LoadError = {
  code: number;
  description: string;
  url: string;
};

const BilibiliWebView: React.FC = () => {
  const webviewRef = useRef<WebviewElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);

  const reload = useCallback(() => {
    setError(null);
    setIsLoading(true);
    const webview = webviewRef.current;
    if (!webview) return;
    try {
      webview.reload();
    } catch {
      webview.loadURL(BILIBILI_URL);
    }
  }, []);

  const openExternal = useCallback(() => {
    window.open(BILIBILI_URL, "_blank", "noopener,noreferrer");
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleStart = () => {
      setIsLoading(true);
      setError(null);
    };
    const handleStop = () => setIsLoading(false);
    const handleReady = () => {
      setIsReady(true);
      setIsLoading(false);
    };
    const handleFail = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        validatedURL?: string;
      };
      if (detail.errorCode === -3) return;
      setError({
        code: detail.errorCode ?? 0,
        description: detail.errorDescription || "Bilibili page failed to load",
        url: detail.validatedURL || BILIBILI_URL,
      });
      setIsLoading(false);
    };

    webview.addEventListener("did-start-loading", handleStart);
    webview.addEventListener("did-stop-loading", handleStop);
    webview.addEventListener("dom-ready", handleReady);
    webview.addEventListener("did-fail-load", handleFail);

    return () => {
      webview.removeEventListener("did-start-loading", handleStart);
      webview.removeEventListener("did-stop-loading", handleStop);
      webview.removeEventListener("dom-ready", handleReady);
      webview.removeEventListener("did-fail-load", handleFail);
    };
  }, []);

  return (
    <div className="relative z-20 mt-10 h-[calc(100vh-40px)] w-full overflow-hidden bg-[#0b0c10]">
      <webview
        ref={(node) => {
          webviewRef.current = node as WebviewElement | null;
        }}
        src={BILIBILI_URL}
        partition="persist:bilibili"
        allowpopups
        className="block h-full w-full border-0 bg-[#0b0c10]"
      />

      {(isLoading || error) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0b0c10] text-white">
          <div className="pointer-events-auto flex w-[min(420px,calc(100vw-48px))] flex-col items-center gap-4 rounded-lg border border-white/10 bg-black/50 p-6 text-center shadow-2xl backdrop-blur-xl">
            {error ? (
              <>
                <div className="text-base font-semibold">B 站页面加载失败</div>
                <div className="max-w-full break-words text-xs leading-5 text-white/60">
                  {error.description} ({error.code})
                  <br />
                  {error.url}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={reload}
                    className="rounded-md bg-white px-3 py-2 text-sm font-medium text-black transition hover:bg-white/85"
                  >
                    重试
                  </button>
                  <button
                    type="button"
                    onClick={openExternal}
                    className="rounded-md border border-white/15 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    用浏览器打开
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                <div className="text-sm text-white/70">
                  {isReady ? "正在加载 B 站内容..." : "正在启动 B 站页面..."}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BilibiliWebView;
