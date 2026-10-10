import React, { useEffect, useState } from "react";
import type { DesktopPlayerState } from "../types";
import SmartImage from "./SmartImage";

export default function MiniPlayer() {
  const [state, setState] = useState<DesktopPlayerState>({ title: 'BiliMusic', artist: '选择一首歌曲', isPlaying: false, liked: false });
  const [topmost, setTopmost] = useState(true);
  useEffect(() => {
    const api = window.electronAPI?.desktop;
    if (!api) return;
    let active = true;
    const unsubscribe = api.onState((next) => { if (active) setState(next); });
    api.getState().then((next) => { if (active) setState(next); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const api = window.electronAPI?.desktop;
  return <div className="h-screen bg-[#171923] p-3 text-white select-none">
    <header className="drag flex items-center justify-between text-xs text-white/50">
      <span>BiliMusic</span>
      <div className="nodrag flex gap-3">
        <button aria-label="迷你窗口置顶" aria-pressed={topmost} onClick={() => api?.setTopmost(!topmost).then(setTopmost)}>{topmost ? '已置顶' : '置顶'}</button>
        <button aria-label="恢复主窗口" onClick={() => api?.command('restore')}>展开</button>
        <button aria-label="关闭迷你播放器" onClick={() => api?.closePanel()}>×</button>
      </div>
    </header>
    <div className="mt-3 flex items-center gap-3">
      <div className="drag flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/10">
        <SmartImage src={state.coverUrl || ''} containerClassName="h-full w-full" imgClassName="h-full w-full object-cover" alt="封面" loading="eager" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="drag truncate text-sm font-semibold" title={state.title}>{state.title}</div>
        <div className="truncate text-xs text-white/45">{state.artist}</div>
        <div className="mt-2 flex items-center gap-5 text-sm">
          <button aria-label="上一首" onClick={() => api?.command('previous')}>⏮</button>
          <button aria-label={state.isPlaying ? '暂停' : '播放'} onClick={() => api?.command('toggle')}>{state.isPlaying ? '⏸' : '▶'}</button>
          <button aria-label="下一首" onClick={() => api?.command('next')}>⏭</button>
          <button aria-label="喜欢" aria-pressed={state.liked} className={state.liked ? 'text-pink-300' : 'text-white/45'} onClick={() => api?.command('like')}>♥</button>
        </div>
      </div>
    </div>
    <progress className="mt-3 h-1 w-full accent-pink-400" max={state.duration || 1} value={state.currentTime || 0} />
  </div>;
}
