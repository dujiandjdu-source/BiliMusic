import React, { useCallback, useEffect, useRef, useState } from "react";

const BILIBILI_URL = "https://www.bilibili.com/";

const BackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const ForwardIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const ReloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);
const HomeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

function faviconUrl(url: string): string {
  try { const u = new URL(url); return "https://www.google.com/s2/favicons?domain=" + u.hostname + "&sz=32"; } catch { return ""; }
}

const BilibiliWebView: React.FC<{ chromeVisible: boolean; onHideChrome: () => void; onRevealChrome: () => void }> = ({ chromeVisible, onHideChrome, onRevealChrome }) => {
  const urlInputRef = useRef<HTMLInputElement>(null);
  const [currentUrl, setCurrentUrl] = useState(BILIBILI_URL);
  const [urlInput, setUrlInput] = useState(BILIBILI_URL);
  const [isLoading, setIsLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const api = window.electronAPI?.browser;

  useEffect(() => {
    if (!api) return;
    const u1 = api.onUrlChanged((url: string) => { if (url && url !== "about:blank") { setCurrentUrl(url); setUrlInput(url); } });
    const u2 = api.onNavState((s: { canGoBack: boolean; canGoForward: boolean; isLoading: boolean }) => { setCanGoBack(s.canGoBack); setCanGoForward(s.canGoForward); setIsLoading(s.isLoading); });
    api.getUrl().then((u: string) => { if (u) { setCurrentUrl(u); setUrlInput(u); } });
    return () => { u1?.(); u2?.(); };
  }, [api]);

  const navBack = useCallback(() => api?.goBack(), [api]);
  const navFwd = useCallback(() => api?.goForward(), [api]);
  const navReload = useCallback(() => api?.reload(), [api]);
  const navHome = useCallback(() => api?.goHome(), [api]);
  const handleSubmit = useCallback(() => { let t = urlInput.trim(); if (!t) return; if (!t.includes("://")) t = "https://" + t; api?.navigate(t); }, [urlInput, api]);
  const openExt = useCallback(() => { window.open(currentUrl || BILIBILI_URL, "_blank", "noopener,noreferrer"); }, [currentUrl]);

  return (
    <div style={{ position: "fixed", top: 0, left: 48, width: "calc(100vw - 48px)", height: "100vh", zIndex: 20 }} className="flex flex-col bg-transparent pointer-events-none">
      {!chromeVisible && <div aria-label="显示浏览工具栏" onMouseEnter={onRevealChrome} className="fixed top-0 left-0 right-0 h-1 pointer-events-auto" />}
      <div className={`${chromeVisible ? 'flex' : 'hidden'} items-center gap-1.5 h-9 px-2 bg-[#0b0c10]/90 backdrop-blur-md border-b border-white/5 nodrag shrink-0 pointer-events-auto`}>
        <button onClick={onHideChrome} title="隐藏侧栏和工具栏（移到窗口边缘恢复）" aria-label="隐藏浏览工具栏" className="w-7 h-7 flex items-center justify-center rounded text-white/50 hover:text-white hover:bg-white/8 shrink-0">⌃</button>
        <button onClick={navBack} disabled={!canGoBack} title="后退" className="w-7 h-7 flex items-center justify-center rounded text-white/50 hover:text-white/90 hover:bg-white/8 disabled:opacity-20 disabled:cursor-default transition"><BackIcon /></button>
        <button onClick={navFwd} disabled={!canGoForward} title="前进" className="w-7 h-7 flex items-center justify-center rounded text-white/50 hover:text-white/90 hover:bg-white/8 disabled:opacity-20 disabled:cursor-default transition"><ForwardIcon /></button>
        <button onClick={navReload} title="刷新" className="w-7 h-7 flex items-center justify-center rounded text-white/50 hover:text-white/90 hover:bg-white/8 transition"><ReloadIcon /></button>
        <button onClick={navHome} title="B站首页" className="w-7 h-7 flex items-center justify-center rounded text-white/50 hover:text-white/90 hover:bg-white/8 transition"><HomeIcon /></button>
        <div className="flex-1 flex items-center mx-1">
          <div className="flex items-center w-full h-7 rounded-md bg-white/5 border border-white/10 px-2 gap-1.5 focus-within:bg-white/8 focus-within:border-white/20 transition">
            {currentUrl && <img src={faviconUrl(currentUrl)} alt="" className="w-3.5 h-3.5 rounded-sm shrink-0 opacity-60" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
            <input ref={urlInputRef} type="text" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onFocus={() => urlInputRef.current?.select()} onKeyDown={(e) => { if (e.key === "Enter") { handleSubmit(); urlInputRef.current?.blur(); } }} onBlur={() => setUrlInput(currentUrl)} placeholder="输入 B 站链接..." spellCheck={false} className="flex-1 bg-transparent text-white/80 text-xs outline-none placeholder:text-white/20 min-w-0" />
            {isLoading && <div className="h-3 w-3 animate-spin rounded-full border border-white/25 border-t-white/70 shrink-0" />}
          </div>
        </div>
        <button onClick={openExt} title="用浏览器打开" className="w-7 h-7 flex items-center justify-center rounded text-white/40 hover:text-white/80 hover:bg-white/8 transition shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
        </button>
      </div>
      <div className="flex-1 pointer-events-none" />
    </div>
  );
};

export default BilibiliWebView;
