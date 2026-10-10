const ACTIONS = ['toggle', 'previous', 'next', 'favorite'];

module.exports = function createShortcutManager(globalShortcut, dispatch) {
  let current = {};
  const canonical = (key) => key.toLowerCase().replace(/commandorcontrol|cmdorctrl|control/g, 'ctrl');
  const release = (bindings) => Object.values(bindings).filter(Boolean).forEach(key => globalShortcut.unregister(key));
  const configure = (input) => {
    const next = {}, seen = new Set();
    for (const action of ACTIONS) {
      const value = input?.[action];
      if (typeof value !== 'string' || value.length > 120) return { success: false, error: '快捷键格式无效' };
      next[action] = value.trim();
      if (!next[action]) continue;
      const normalized = canonical(next[action]);
      if (seen.has(normalized)) return { success: false, error: '多个操作不能使用同一个快捷键' };
      seen.add(normalized);
    }
    if (JSON.stringify(current) === JSON.stringify(next)) return { success: true };
    release(current);
    const registered = {};
    try {
      for (const action of ACTIONS) {
        const key = next[action];
        if (!key) continue;
        if (!globalShortcut.register(key, () => dispatch(action))) throw Error('快捷键被占用或无效：'+key);
        registered[action] = key;
      }
      current = next;
      return { success: true };
    } catch (error) {
      release(registered);
      const lost = [];
      for (const action of ACTIONS) {
        const key = current[action];
        if (!key) continue;
        try { if (!globalShortcut.register(key, () => dispatch(action))) lost.push(key); }
        catch { lost.push(key); }
      }
      return { success: false, error: error.message+(lost.length ? '；原快捷键恢复失败：'+lost.join(', ') : '，已保留原设置') };
    }
  };
  return { configure, dispose: () => { release(current); current = {}; } };
};
