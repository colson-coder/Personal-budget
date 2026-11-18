// =============================================================================
// theme.js — Appearance themes. The choice is saved in the user's settings
// (syncs across devices) and cached on this device so the right theme paints
// before the app finishes loading (see the inline script in index.html).
// =============================================================================

export const THEMES = [
  { value: 'mono', label: 'Minimal Mono', desc: 'Black & white, sharp', swatch: ['#000', '#ededed', '#4ade80'] },
  { value: 'midnight', label: 'Midnight Pro', desc: 'Calm dark emerald', swatch: ['#0f141b', '#10b981', '#34d399'] },
  { value: 'light', label: 'Clean Light', desc: 'Bright, banking style', swatch: ['#f6f7f9', '#0f766e', '#0f172a'] },
  { value: 'bold', label: 'Fintech Bold', desc: 'Gradients, big numbers', swatch: ['#06090f', '#34d399', '#06b6d4'] },
];
export const DEFAULT_THEME = 'mono';

const META_COLORS = { mono: '#000000', midnight: '#090c11', light: '#f6f7f9', bold: '#06090f' };

export function applyTheme(name) {
  const t = THEMES.some((x) => x.value === name) ? name : DEFAULT_THEME;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLORS[t]);
  try { localStorage.setItem('pb_theme', t); } catch { /* private mode: fine */ }
  return t;
}
