import type { AppPreferences, DesktopLyricsPreferences, GlobalShortcutAction } from '../types';

export const SHORTCUT_ACTIONS: GlobalShortcutAction[] = ['toggle', 'previous', 'next', 'favorite'];
export const defaultPreferences = (): AppPreferences => ({
  desktopLyrics: { topmost: true, locked: false, clickThrough: false, fontSize: 30,
    fontFamily: 'Microsoft YaHei', color: '#ffffff', translationColor: '#f9a8d4' },
  shortcuts: { toggle: 'CommandOrControl+Alt+Space', previous: 'CommandOrControl+Alt+Left',
    next: 'CommandOrControl+Alt+Right', favorite: 'CommandOrControl+Alt+F' },
});

export const normalizeDesktopLyrics = (input?: Partial<DesktopLyricsPreferences>): DesktopLyricsPreferences => {
  const base = defaultPreferences().desktopLyrics;
  return {
    topmost: typeof input?.topmost === 'boolean' ? input.topmost : base.topmost,
    locked: typeof input?.locked === 'boolean' ? input.locked : base.locked,
    clickThrough: typeof input?.clickThrough === 'boolean' ? input.clickThrough : base.clickThrough,
    fontSize: Number.isFinite(input?.fontSize) ? Math.min(72, Math.max(16, Number(input?.fontSize))) : base.fontSize,
    fontFamily: typeof input?.fontFamily === 'string' && input.fontFamily.trim() ? input.fontFamily.slice(0, 80) : base.fontFamily,
    color: typeof input?.color === 'string' && /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : base.color,
    translationColor: typeof input?.translationColor === 'string' && /^#[0-9a-f]{6}$/i.test(input.translationColor) ? input.translationColor : base.translationColor,
  };
};

export const normalizePreferences = (input?: Partial<AppPreferences>): AppPreferences => {
  const base = defaultPreferences();
  for (const action of SHORTCUT_ACTIONS) {
    const value = input?.shortcuts?.[action];
    if (typeof value === 'string' && value.length < 120) base.shortcuts[action] = value.trim();
  }
  return { desktopLyrics: normalizeDesktopLyrics(input?.desktopLyrics), shortcuts: base.shortcuts };
};
