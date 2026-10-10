import React, { useEffect, useState } from 'react';
import type { DesktopPlayerState } from '../types';
import { defaultPreferences } from '../services/preferences';

export default function DesktopLyrics() {
  const [state, setState] = useState<DesktopPlayerState>({title:'BiliMusic',artist:'',isPlaying:false,liked:false});
  const [preferences, setPreferences] = useState(defaultPreferences().desktopLyrics);
  useEffect(()=>{
    const api = window.electronAPI?.desktop;
    const oldBackground = document.body.style.backgroundColor;
    document.body.style.backgroundColor = 'transparent';
    if (!api) return () => { document.body.style.backgroundColor = oldBackground; };
    let active = true;
    const stopState=api.onState(next=>{if(active)setState(next);});
    const stopPreferences=api.onLyricsPreferences(next=>{if(active)setPreferences(next);});
    api.getState().then(next=>{if(active)setState(next);});
    api.getLyricsPreferences().then(next=>{if(active)setPreferences(next);});
    return ()=>{active=false;stopState();stopPreferences();document.body.style.backgroundColor=oldBackground;};
  },[]);
  return <div className={`group flex h-screen flex-col justify-center px-5 py-3 select-none ${preferences.locked ? 'nodrag' : 'drag'}`}>
    <div className="nodrag absolute right-3 top-2 flex gap-3 rounded-lg bg-black/60 px-3 py-1 text-xs text-white/70 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
      <button onClick={()=>void window.electronAPI?.desktop.unlockLyrics()}>解锁</button>
      <button onClick={()=>void window.electronAPI?.desktop.command('restore')}>主窗口</button>
      <button aria-label="关闭桌面歌词" onClick={()=>void window.electronAPI?.desktop.closeLyrics()}>×</button>
    </div>
    <div data-testid="desktop-lyric" className="text-center font-semibold leading-tight" style={{fontFamily:preferences.fontFamily,fontSize:preferences.fontSize,
      color:preferences.color,textShadow:'0 2px 4px #000, 1px 0 2px #000, -1px 0 2px #000',overflowWrap:'anywhere'}}>
      {state.lyric || (state.title==='BiliMusic' ? 'BiliMusic · 选择一首歌曲' : state.title)}
    </div>
    {state.translation && <div className="mt-2 text-center leading-tight" style={{fontFamily:preferences.fontFamily,fontSize:Math.max(14,preferences.fontSize*0.65),color:preferences.translationColor,
      textShadow:'0 2px 4px #000',overflowWrap:'anywhere'}}>{state.translation}</div>}
  </div>;
}
