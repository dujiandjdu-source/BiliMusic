import React, { useRef, useState, useEffect, useCallback } from "react";
import { SearchIcon, LocalMusicIcon, SettingsIcon } from "./Icons";
import { useWindowDrag } from "../hooks/useWindowDrag";

interface TopBarProps {
  videoChromeVisible?: boolean;
  onRevealVideoChrome?: () => void;
  onFilesSelected: (files: FileList) => void;
  onSearchClick: () => void;
  onSettingsClick: () => void;
  appMode: "music" | "video";
  onToggleMode: () => void;
}

const TopBar: React.FC<TopBarProps> = ({ onFilesSelected, onSearchClick, onSettingsClick, appMode, onToggleMode, videoChromeVisible = true, onRevealVideoChrome }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [hover, setHover] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windowDrag = useWindowDrag();

  const isVideo = appMode === "video";
  const showSidebar = isVideo ? videoChromeVisible : hover;

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.win) return;
    api.win.isMaximized().then(setIsMaximized);
    const unsub = api.win.onMaximizeChange(setIsMaximized);
    return () => unsub?.();
  }, []);

  useEffect(() => {
    if (isVideo) setHover(true);
  }, [isVideo]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) { onFilesSelected(e.target.files); e.target.value = ""; }
  };

  const handleMouseEnter = useCallback(() => {
    if (isVideo) onRevealVideoChrome?.();
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    setHover(true);
  }, [isVideo, onRevealVideoChrome]);

  const handleMouseLeave = useCallback(() => {
    if (isVideo) return;
    leaveTimer.current = setTimeout(() => setHover(false), 150);
  }, [isVideo]);

  useEffect(() => {
    return () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); };
  }, []);

  return (
    <>
      {/* 检测条 — 侧边栏显示时 pointer-events-none */}
      <div
        className={`fixed top-0 left-0 bottom-0 ${isVideo && !showSidebar ? 'w-1' : 'w-12'} z-[1000] ${showSidebar ? "pointer-events-none" : ""}`}
        onMouseEnter={handleMouseEnter}
      />

      {/* 无边框窗口的拖拽区域，避开侧栏的悬停检测 */}
      {!isVideo && <div
        className="fixed top-0 left-12 right-0 h-8 z-[998] nodrag"
        aria-hidden="true"
        {...windowDrag}
      />}

      {/* 侧边栏 */}
      <div
        className={`fixed top-0 left-0 bottom-0 w-12 z-[999] transition-all duration-200 ease-out ${
          showSidebar
            ? "translate-x-0 opacity-100 pointer-events-auto"
            : "-translate-x-full opacity-0 pointer-events-none"
        }`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div {...windowDrag} className="ios-sidebar h-full w-full flex flex-col items-center py-3 gap-1 bg-black/60 backdrop-blur-xl border-r border-white/5 nodrag">
          <div className="mb-2 text-white/50 text-[10px] font-medium tracking-widest nodrag" style={{ writingMode: "vertical-rl" }}>
            BiliMusic
          </div>
          <div className="w-8 h-px bg-white/10 my-1" />
          <IconBtn onClick={() => fileInputRef.current?.click()} title="导入音乐" disabled={isVideo}>
            <LocalMusicIcon className="w-4 h-4" />
          </IconBtn>
          <IconBtn onClick={onToggleMode} title={isVideo ? "切换音乐模式" : "切换视频模式"}>
            {isVideo ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            )}
          </IconBtn>
          <IconBtn onClick={onSearchClick} title="搜索 (Ctrl+K)" disabled={isVideo}>
            <SearchIcon className="w-4 h-4" />
          </IconBtn>
          <IconBtn onClick={onSettingsClick} title="设置" disabled={isVideo}>
            <SettingsIcon className="w-4 h-4" />
          </IconBtn>
          {window.electronAPI?.desktop && <IconBtn onClick={() => { void window.electronAPI?.desktop.openMini(); }} title="迷你播放器">
            <span className="text-lg">▣</span>
          </IconBtn>}
          <div className="flex-1" />
          <div className="flex flex-col items-center gap-0 nodrag mt-2">
            <WinBtn onClick={() => window.electronAPI?.win?.minimize()}>
              <svg className="w-3 h-3" viewBox="0 0 12 12"><rect y="5" width="12" height="1.5" fill="currentColor" /></svg>
            </WinBtn>
            <WinBtn onClick={() => window.electronAPI?.win?.maximize()}>
              {isMaximized ? (
                <svg className="w-3 h-3" viewBox="0 0 12 12"><rect x="2" y="0" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /><rect x="0" y="3" width="8" height="8" rx="1" fill="#1a1a1a" stroke="currentColor" strokeWidth="1.5" /></svg>
              ) : (
                <svg className="w-3 h-3" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
              )}
            </WinBtn>
            <WinBtn onClick={() => window.electronAPI?.win?.close()} hoverClass="hover:bg-red-500/80 hover:text-white">
              <svg className="w-3 h-3" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </WinBtn>
          </div>
        </div>
      </div>

      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="audio/*,.lrc,.txt" multiple className="hidden" />
    </>
  );
};

const IconBtn: React.FC<{ onClick: () => void; title: string; children: React.ReactNode; disabled?: boolean }> = ({ onClick, title, children, disabled }) => (
  <button onClick={disabled ? undefined : onClick} title={title}
    className={`w-8 h-8 flex items-center justify-center rounded-md transition-all nodrag ${disabled ? "text-white/15 cursor-default" : "text-white/40 hover:text-white/80 hover:bg-white/5"}`}>
    {children}
  </button>
);

const WinBtn: React.FC<{ onClick: () => void; children: React.ReactNode; hoverClass?: string }> = ({ onClick, children, hoverClass }) => (
  <button onClick={onClick}
    className={`w-8 h-7 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 rounded transition-all nodrag ${hoverClass || ""}`}>
    {children}
  </button>
);

export default TopBar;
