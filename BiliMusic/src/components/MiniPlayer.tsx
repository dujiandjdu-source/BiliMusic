import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DesktopPlayerState } from "../types";
import SmartImage from "./SmartImage";
import { useWindowDrag } from "../hooks/useWindowDrag";
import { CloseIcon, LikeIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, QueueIcon } from "./Icons";

export default function MiniPlayer() {
  const [state, setState] = useState<DesktopPlayerState>({ title: 'BiliMusic', artist: '选择一首歌曲', isPlaying: false, liked: false });
  const [topmost, setTopmost] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [menuSong, setMenuSong] = useState<string | null>(null);
  const currentRow = useRef<HTMLDivElement>(null);
  const queueElement = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const windowDrag = useWindowDrag();
  useEffect(() => {
    const previous = document.body.style.backgroundColor;
    document.body.style.backgroundColor = 'transparent';
    const api = window.electronAPI?.desktop;
    let active = true;
    let receivedUpdate = false;
    const unsubscribe = api?.onState((next) => { receivedUpdate = true; if (active) setState(next); });
    void api?.getState().then((next) => { if (active && !receivedUpdate) setState(next); });
    return () => { active = false; unsubscribe?.(); document.body.style.backgroundColor = previous; };
  }, []);
  useEffect(() => {
    if (!menuSong) return;
    const dismiss = () => setMenuSong(null);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('click', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('click', dismiss); window.removeEventListener('blur', dismiss); window.removeEventListener('keydown', escape); };
  }, [menuSong]);
  useLayoutEffect(() => {
    const row = currentRow.current;
    const list = queueElement.current;
    if (!expanded || !row || !list) return;
    // Follow track changes and reopening, without snapping back on time updates.
    list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top;
  }, [state.songId, expanded, state.queue?.length]);
  const api = window.electronAPI?.desktop;
  const toggleQueue = async () => {
    if (resizing.current) return;
    resizing.current = true;
    try {
      await api?.setMiniExpanded(!expanded);
      setExpanded(!expanded);
      setMenuSong(null);
    } finally {
      resizing.current = false;
    }
  };
  const queue = state.queue || [];
  return <div className={`compact-mini ${expanded ? 'is-expanded' : 'is-collapsed'} text-white select-none`}>
    <section className="mini-card">
      <div className="mini-header nodrag" {...windowDrag}>
        <button className="mini-cover nodrag" aria-label="恢复主窗口" title="恢复主窗口" onClick={() => api?.command('restore')}>
          {state.coverUrl ? <SmartImage src={state.coverUrl} containerClassName="h-full w-full" imgClassName="h-full w-full object-cover" alt="封面" loading="eager" /> : <span className="text-3xl text-white/40">♪</span>}
        </button>
        <div className="mini-details">
          <div className="truncate" title={state.title}>{state.title}</div>
          <div className="truncate text-white/55" title={state.artist}>{state.artist}</div>
        </div>
        <div className="mini-transport nodrag">
          <button aria-label="喜欢" aria-pressed={state.liked} className={state.liked ? 'mini-active' : ''} onClick={() => api?.command('like')}><LikeIcon className="h-[18px] w-[18px]" filled={state.liked} /></button>
          <button aria-label="上一首" onClick={() => api?.command('previous')}><PrevIcon className="h-5 w-5" /></button>
          <button className="mini-play" aria-label={state.isPlaying ? '暂停' : '播放'} onClick={() => api?.command('toggle')}>{state.isPlaying ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}</button>
          <button aria-label="下一首" onClick={() => api?.command('next')}><NextIcon className="h-5 w-5" /></button>
          <button aria-label="显示播放队列" aria-expanded={expanded} className={expanded ? 'mini-active' : ''} onClick={() => { void toggleQueue(); }}><QueueIcon className="h-[18px] w-[18px]" /></button>
        </div>
        <button className="mini-close nodrag" aria-label="关闭迷你播放器" onClick={() => api?.closePanel()}><CloseIcon className="h-3.5 w-3.5" /></button>
        <div className="mini-progress" style={{ width: `${Math.max(0, Math.min(100, (state.currentTime || 0) / (state.duration || 1) * 100))}%` }} />
      </div>
      {expanded && <div ref={queueElement} className="mini-queue" aria-label="播放队列">
        {queue.length === 0 ? <div className="mini-empty">暂无歌曲，在主窗口添加音乐</div> : queue.map(song => <div key={song.id} ref={song.id === state.songId ? currentRow : undefined} aria-current={song.id === state.songId ? 'true' : undefined} className={`mini-row ${song.id === state.songId ? 'is-current' : ''}`}>
          <button className="mini-row-title" title={`${song.title} - ${song.artist}`} onClick={() => api?.command({ action: 'play-song', songId: song.id })}>{song.title}{song.artist && <span> - {song.artist}</span>}</button>
          <div className="mini-row-actions">
            <button aria-label={`${song.id === state.songId && state.isPlaying ? '暂停' : '播放'} ${song.title}`} onClick={() => api?.command(song.id === state.songId ? 'toggle' : { action: 'play-song', songId: song.id })}>{song.id === state.songId && state.isPlaying ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}</button>
            <button aria-label={`喜欢 ${song.title}`} aria-pressed={song.liked} className={song.liked ? 'mini-active' : ''} onClick={() => api?.command({ action: 'like-song', songId: song.id })}><LikeIcon className="h-4 w-4" filled={song.liked} /></button>
            <button aria-label={`更多 ${song.title}`} aria-expanded={menuSong === song.id} onClick={event => { event.stopPropagation(); setMenuSong(menuSong === song.id ? null : song.id); }}><span className="mini-more">···</span></button>
          </div>
        </div>)}
      </div>}
      {menuSong && <div className="mini-menu nodrag" role="menu" onClick={event => event.stopPropagation()}>
        <button role="menuitem" onClick={() => { void api?.command('restore'); setMenuSong(null); }}>在主窗口查看</button>
        <button role="menuitem" aria-label="迷你窗口置顶" aria-pressed={topmost} onClick={() => { void api?.setTopmost(!topmost).then(setTopmost); setMenuSong(null); }}>{topmost ? '取消置顶' : '窗口置顶'}</button>
      </div>}
    </section>
    <button className="mini-pin nodrag" aria-label="迷你窗口置顶" aria-pressed={topmost} title={topmost ? '取消置顶' : '窗口置顶'} onClick={() => api?.setTopmost(!topmost).then(setTopmost)}>⌖</button>
  </div>;
}
