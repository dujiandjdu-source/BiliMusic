import { useEffect, useState } from 'react';

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'installing' | 'error';
  currentVersion: string;
  portable: boolean;
  version?: string;
  progress: number;
  error?: string;
}

export default function UpdateSettings() {
  const api = window.electronAPI?.updater;
  const [state, setState] = useState<UpdateState>({ status: 'idle', currentVersion: __APP_VERSION__, portable: false, progress: 0 });
  useEffect(() => {
    if (!api) return;
    let active = true, received = false;
    const unsubscribe = api.onState(next => { received = true; if (active) setState(next); });
    void api.getState().then(next => { if (active && !received) setState(next); }).catch(() => {
      if (active) setState(previous => ({ ...previous, status: 'error', error: '无法获取更新状态，请重试。' }));
    });
    return () => { active = false; unsubscribe(); };
  }, [api]);
  const invoke = async (action: 'check' | 'download' | 'install') => {
    if (!api) return;
    try { await api[action](); }
    catch { setState(previous => ({ ...previous, status: 'error', error: '更新请求失败，请重试。' })); }
  };
  const busy = ['checking', 'downloading', 'installing'].includes(state.status);
  return <div className="rounded-2xl border border-white/5 bg-white/5 p-5">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div><h4 className="font-semibold text-white text-sm">联网更新</h4><p className="mt-1 text-xs text-white/40">检查、下载并安装最新版本</p></div>
      <button disabled={!api || busy || state.status === 'downloaded'} onClick={() => void invoke('check')}
        className="rounded-xl bg-pink-500/20 px-4 py-2 text-sm text-pink-200 hover:bg-pink-500/30 disabled:cursor-not-allowed disabled:opacity-40">
        {state.status === 'checking' ? '检查中…' : '检查更新'}
      </button>
    </div>
    <div aria-live="polite" className="space-y-3 text-xs text-white/60">
      {!api && <p>请使用桌面版本检查更新。</p>}
      {state.status === 'checking' && <p>正在连接 GitHub 更新服务器…</p>}
      {state.status === 'up-to-date' && <p className="text-emerald-200">已是最新版本</p>}
      {['available', 'downloading', 'downloaded', 'installing'].includes(state.status) && <p className="text-emerald-200">发现新版本 v{state.version}</p>}
      {state.portable && state.version && <p>便携版将下载安装版；原便携文件会保留，音乐库和设置继续使用。</p>}
      {state.status === 'available' && <button onClick={() => void invoke('download')} className="rounded-lg bg-emerald-500/20 px-4 py-2 text-emerald-200">下载更新</button>}
      {state.status === 'downloading' && <div><p>正在下载：{state.progress.toFixed(1)}%</p><progress aria-label="更新下载进度" value={state.progress} max={100} className="mt-2 w-full accent-emerald-400" /></div>}
      {state.status === 'downloaded' && <><p>下载完成，安装会退出当前播放器。</p><button onClick={() => void invoke('install')} className="rounded-lg bg-emerald-500/20 px-4 py-2 text-emerald-200">退出并安装</button></>}
      {state.status === 'installing' && <p>正在启动安装程序…</p>}
      {state.status === 'error' && <div className="space-y-2"><p className="text-red-200">{state.error}</p><button onClick={() => void invoke('check')} className="text-pink-200">重试检查</button></div>}
      {api && <button onClick={() => { void api.openRelease().catch(() => setState(previous => ({ ...previous, status: 'error', error: '无法打开浏览器，请稍后重试。' }))); }} className="text-white/45 hover:text-white">前往 GitHub 下载</button>}
    </div>
  </div>;
}
