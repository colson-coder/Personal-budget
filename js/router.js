// =============================================================================
// router.js — Minimal hash-based router. No dependencies, no build step.
// Hash routing keeps the whole app on a single index.html, which is exactly
// what GitHub Pages + service-worker app-shell caching want.
// =============================================================================

const routes = new Map();
let notFound = null;
let outlet = null;
let onNavigate = null;

export function defineRoute(path, render) {
  routes.set(path, render);
}

export function setNotFound(render) {
  notFound = render;
}

export function initRouter(outletEl, opts = {}) {
  outlet = outletEl;
  onNavigate = opts.onNavigate || null;
  window.addEventListener('hashchange', renderCurrent);
  renderCurrent();
}

export function currentPath() {
  return (location.hash.replace(/^#/, '') || '/dashboard').split('?')[0];
}

export function navigate(path) {
  if (currentPath() === path) renderCurrent();
  else location.hash = path;
}

export function queryParams() {
  const q = (location.hash.split('?')[1] || '');
  return Object.fromEntries(new URLSearchParams(q));
}

async function renderCurrent() {
  const path = currentPath();
  const render = routes.get(path) || notFound;
  if (!render || !outlet) return;
  outlet.scrollTop = 0;
  outlet.replaceChildren(); // clear
  try {
    const view = await render(queryParams());
    if (view) outlet.append(view);
  } catch (err) {
    console.error('Route render failed:', err);
    const div = document.createElement('div');
    div.className = 'card error-card';
    div.textContent = 'Something went wrong loading this page: ' + (err.message || err);
    outlet.append(div);
  }
  if (onNavigate) onNavigate(path);
}
