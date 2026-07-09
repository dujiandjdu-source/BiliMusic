import React, { useRef, useState, useEffect } from "react";
import { SearchIcon, LocalMusicIcon, SettingsIcon } from "./Icons";

interface TopBarProps {
  onFilesSelected: (files: FileList) => void;
  onSearchClick: () => void;
  onSettingsClick: () => void;
  appMode: "music" | "video";
  onToggleMode: () => void;
}

const TopBar: React.FC<TopBarProps> = ({ onFilesSelected, onSearchClick, onSettingsClick, appMode, onToggleMode }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.win) return;
    api.win.isMaximized().then(setIsMaximized);
    const unsub = api.win.onMaximizeChange(setIsMaximized);
    return () => unsub?.();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) { onFilesSelected(e.target.files); e.target.value = ""; }
  };

  return (
    <div className="fixed top-0 left-0 right-0 h-10 z-[60] drag bg-black/35 backdrop-blur-xl border-b border-white/5">
      {/* 左侧：Logo + 标题 */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
        <span className="text-white/60 text-xs font-medium tracking-wide">BiliMusic</span>
      </div>

      {/* 右侧：功能按钮 + 窗口控制 */}
      <div className="absolute right-0 top-0 h-full flex items-center">
        <div className="flex items-center gap-0.5 pr-1 nodrag">
          <IconBtn onClick={() => fileInputRef.current?.click()} title="导入音乐">
            <LocalMusicIcon className="w-4 h-4" />
          </IconBtn>
          <IconBtn onClick={onToggleMode} title={appMode === "music" ? "切换视频模式" : "切换音乐模式"}>
            {appMode === "music" ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            )}
          </IconBtn>
          <IconBtn onClick={onSearchClick} title="搜索 (Ctrl+K)">
            <SearchIcon className="w-4 h-4" />
          </IconBtn>
          <IconBtn onClick={onSettingsClick} title="设置">
            <SettingsIcon className="w-4 h-4" />
          </IconBtn>
        </div>
        {/* 窗口控制按钮 */}
        <div className="flex nodrag">
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

      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="audio/*,.lrc,.txt" multiple className="hidden" />
    </div>
  );
};

const IconBtn: React.FC<{ onClick: () => void; title: string; children: React.ReactNode }> = ({ onClick, title, children }) => (
  <button onClick={onClick} title={title}
    className="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 rounded-md transition-all">
    {children}
  </button>
);

const WinBtn: React.FC<{ onClick: () => void; children: React.ReactNode; hoverClass?: string }> = ({ onClick, children, hoverClass }) => (
  <button onClick={onClick}
    className={`w-10 h-8 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-all ${hoverClass || ""}`}>
    {children}
  </button>
);

export default TopBar;
