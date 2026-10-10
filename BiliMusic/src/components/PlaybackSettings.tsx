import React, { useEffect, useRef, useState } from 'react';
import type { AppPreferences, Song } from '../types';
import { defaultPreferences, normalizePreferences, SHORTCUT_ACTIONS } from '../services/preferences';
import { searchNetEase, type NeteaseTrackInfo } from '../services/lyricsService';
import type { SleepTimerState } from '../services/sleepTimer';

export interface PlaybackSettingsProps {
  song: Song | null;
  preferences: AppPreferences;
  onPreferences: (preferences: AppPreferences) => void;
  onLyricsOffset: (seconds: number) => void;
  onLyricsFile: (file: File) => Promise<boolean>;
  onLyricsMatch: (sourceId: string) => Promise<boolean>;
  sleep: SleepTimerState;
  onSleep: (value: 'off' | 'song' | 15 | 30 | 60) => void;
}

const inputClass = 'rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white';
const sectionClass = 'space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4';
export default function PlaybackSettings(props: PlaybackSettingsProps) {
  const { song, preferences, onPreferences, onLyricsOffset, onLyricsFile, onLyricsMatch, sleep, onSleep } = props;
  const [query, setQuery] = useState(song ? `${song.title} ${song.artist}` : '');
  const [results, setResults] = useState<NeteaseTrackInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [shortcuts, setShortcuts] = useState(preferences.shortcuts);
  const requestRef = useRef(0);
  useEffect(() => { setShortcuts(preferences.shortcuts); }, [preferences.shortcuts]);
  useEffect(() => {
    requestRef.current += 1; setQuery(song ? `${song.title} ${song.artist}` : ''); setResults([]); setMessage(''); setBusy(false);
    return () => { requestRef.current += 1; };
  }, [song?.id]);
  const perform = async (action: () => Promise<boolean>, success: string) => {
    const request = ++requestRef.current;
    setBusy(true); setMessage('');
    try {
      const applied = await action();
      if (request === requestRef.current) setMessage(applied ? success : '歌曲已切换，请重新操作');
    } catch (error) {
      if (request === requestRef.current) setMessage(error instanceof Error ? error.message : '操作失败，请重试');
    } finally { if (request === requestRef.current) setBusy(false); }
  };
  const search = async () => {
    if (!query.trim() || !song) return;
    const request = ++requestRef.current;
    setBusy(true); setMessage('');
    try {
      const rows = await searchNetEase(query.trim());
      if (request !== requestRef.current) return;
      setResults(rows); setMessage(rows.length ? '选择歌曲以使用对应歌词' : '未找到歌曲，请更换关键词或导入歌词文件');
    } catch { if (request === requestRef.current) setMessage('搜索失败，请重试'); }
    finally { if (request === requestRef.current) setBusy(false); }
  };
  const labels = { toggle: '播放 / 暂停', previous: '上一首', next: '下一首', favorite: '收藏 / 取消收藏' };
  return <div className="space-y-4">
    <section className={sectionClass}>
      <h3 className="font-semibold">歌词校准</h3>
      <p className="text-sm text-white/60">{song ? `${song.title} · ${song.artist}` : '先选择一首歌曲'}</p>
      <label className="flex flex-wrap items-center gap-3 text-sm">歌词延后（秒）
        <input aria-label="歌词延后秒数" className={inputClass+' w-24'} type="number" min={-60} max={60} step={0.1} value={song?.lyricsOffset ?? 0}
          disabled={!song} onChange={(e) => { const value = Number(e.target.value); if (Number.isFinite(value)) onLyricsOffset(value); }} />
        <button disabled={!song} onClick={() => onLyricsOffset(0)}>重置</button>
      </label>
      <p className="text-xs text-white/40">正数延后、负数提前，范围 ±60 秒。仅调整歌词显示，不改变音频。每首歌单独保存。</p>
      <label className="block text-sm">导入歌词（LRC / TTML / TXT / JSON）
        <input aria-label="导入校准歌词" className="mt-2 block w-full text-xs" type="file" accept=".lrc,.ttml,.xml,.txt,.json" disabled={!song || busy}
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void perform(() => onLyricsFile(file), '歌词已导入并保存'); }} />
      </label>
      <div className="flex gap-2"><input aria-label="搜索匹配歌词" className={inputClass+' min-w-0 flex-1'} value={query} disabled={!song} onChange={e=>setQuery(e.target.value)} />
        <button className={inputClass} disabled={!song || busy} onClick={() => void search()}>搜索歌词</button></div>
      {song?.lyricsSourceId && <p className="text-xs text-white/40">已选歌词来源：网易云 {song.lyricsSourceId}</p>}
      <div className="max-h-56 space-y-2 overflow-auto">
        {results.map(row=><button key={row.id} className="block w-full rounded-lg bg-white/5 p-2 text-left text-sm hover:bg-white/10 disabled:opacity-40" disabled={busy}
          onClick={()=>void perform(()=>onLyricsMatch(row.id), '歌词匹配已保存')}>
          {row.title} <span className="text-white/50">· {row.artist} · {row.album}</span>
        </button>)}
      </div>
      {message && <p role="status" className="text-sm text-pink-200">{message}</p>}
      {busy && <p role="status" className="text-sm text-white/50">正在加载歌词…</p>}
    </section>
    <section className={sectionClass}>
      <h3 className="font-semibold">定时停止</h3>
      <div className="flex flex-wrap gap-2">
        {([15,30,60] as const).map(minutes=><button key={minutes} className={inputClass} onClick={()=>onSleep(minutes)}>{minutes} 分钟</button>)}
        <button className={inputClass} disabled={!song} onClick={()=>onSleep('song')}>当前歌曲播完停止</button>
        <button className={inputClass} onClick={()=>onSleep('off')}>取消定时</button>
      </div>
      <p role="status" className="text-sm text-white/60">{sleep.mode==='off' ? '未开启定时停止' : sleep.mode==='song' ? '当前歌曲结束后暂停（手动切歌会取消）' : `将在 ${new Date(sleep.expiresAt).toLocaleTimeString()} 暂停`}</p>
    </section>
    {window.electronAPI?.desktop && <>
      <section className={sectionClass}>
        <h3 className="font-semibold">桌面歌词</h3>
        <button className={inputClass} onClick={()=>void window.electronAPI?.desktop.openLyrics()}>打开桌面歌词</button>
        <div className="flex flex-wrap gap-4 text-sm">
          {(['topmost','locked','clickThrough'] as const).map((key,index)=><label key={key} className="flex items-center gap-2">
            <input type="checkbox" checked={preferences.desktopLyrics[key]} onChange={e=>onPreferences({...preferences,desktopLyrics:{...preferences.desktopLyrics,[key]:e.target.checked}})} />
            {['置顶','锁定位置','鼠标穿透'][index]}
          </label>)}
        </div>
        <p className="text-xs text-white/40">穿透后可通过此页面关闭穿透，也可在托盘菜单中解锁桌面歌词。</p>
        <div className="flex flex-wrap gap-3 text-sm">
          <label>字号 <input aria-label="桌面歌词字号" className={inputClass+' w-20'} type="number" min={16} max={72} value={preferences.desktopLyrics.fontSize}
            onChange={e=>onPreferences({...preferences,desktopLyrics:{...preferences.desktopLyrics,fontSize:Number(e.target.value)}})} /></label>
          <label>字体 <select aria-label="桌面歌词字体" className={inputClass} value={preferences.desktopLyrics.fontFamily} onChange={e=>onPreferences({...preferences,desktopLyrics:{...preferences.desktopLyrics,fontFamily:e.target.value}})}>
            {['Microsoft YaHei','SimHei','SimSun','Arial','sans-serif'].map(font=><option key={font} value={font}>{font}</option>)}
          </select></label>
          <label>歌词颜色 <input aria-label="歌词颜色" type="color" value={preferences.desktopLyrics.color} onChange={e=>onPreferences({...preferences,desktopLyrics:{...preferences.desktopLyrics,color:e.target.value}})} /></label>
          <label>翻译颜色 <input aria-label="翻译颜色" type="color" value={preferences.desktopLyrics.translationColor} onChange={e=>onPreferences({...preferences,desktopLyrics:{...preferences.desktopLyrics,translationColor:e.target.value}})} /></label>
        </div>
      </section>
      <section className={sectionClass}>
        <h3 className="font-semibold">全局快捷键</h3>
        <p className="text-xs text-white/40">在其他软件中也可控制播放器。示例：CommandOrControl+Alt+Space。留空可禁用该项；冲突时会保留原设置。</p>
        {SHORTCUT_ACTIONS.map(action=><label key={action} className="flex flex-wrap items-center justify-between gap-2 text-sm">{labels[action]}
          <input aria-label={`全局快捷键 ${labels[action]}`} className={inputClass+' w-72'} value={shortcuts[action]} onChange={e=>setShortcuts({...shortcuts,[action]:e.target.value})} />
        </label>)}
        <button className={inputClass} onClick={()=>onPreferences(normalizePreferences({...preferences,shortcuts}))}>应用快捷键</button>
        <button className={inputClass+' ml-2'} onClick={()=>onPreferences({...preferences,shortcuts:defaultPreferences().shortcuts})}>恢复默认快捷键</button>
      </section>
    </>}
  </div>;
}
