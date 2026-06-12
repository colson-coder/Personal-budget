// =============================================================================
// app.js — Bootstrap: decides auth vs. local mode, seeds categories, builds the
// nav chrome + local-mode banner, and wires up the router. Entry point loaded by
// index.html as a module.
// =============================================================================

import { db, isLocalMode, setLocalMode } from './db.js';
import { defineRoute, setNotFound, initRouter, navigate } from './router.js';
import { renderAuth } from './views/auth.js';
import { renderDashboard } from './views/dashboard.js';
import { renderTransactions } from './views/transactions.js';
import { renderAdd } from './views/add.js';
import { renderCategories } from './views/categories.js';
import { renderImport } from './views/import.js';
import { el, toast } from './util.js';

const app = document.getElementById('app');

const NAV = [
  { path: '/dashboard', label: 'Dashboard', icon: '◧' },
  { path: '/transactions', label: 'Transactions', icon: '≣' },
  { path: '/add', label: 'Add', icon: '＋' },
  { path: '/categories', label: 'Categories', icon: '☰' },
  { path: '/import', label: 'Import', icon: '↑' },
];

async function boot() {
  // Are we authenticated, or in local mode? If neither, show the auth screen.
  let authed = false;
  if (isLocalMode()) {
    authed = true;
  } else {
    try {
      const user = await db.getCurrentUser();
      authed = !!user;
    } catch {
      authed = false;
    }
  }

  if (!authed) {
    app.replaceChildren(renderAuth(() => boot()));
    return;
  }

  // Ensure the predefined categories exist for this account/device.
  try {
    await db.seedDefaultCategories();
  } catch (err) {
    console.error('Could not seed categories:', err);
  }

  renderShell();
}

function renderShell() {
  app.replaceChildren();

  // Persistent local-mode banner.
  if (isLocalMode()) {
    app.append(el('div', { class: 'local-banner', role: 'status' },
      'Local mode — data is stored only on this device and will not sync.'));
  }

  const sideNav = el('nav', { class: 'sidenav' }, [
    el('div', { class: 'brand' }, [el('span', { class: 'brand-mark' }, '▮▮▮'), el('span', {}, 'Personal Budget')]),
    ...NAV.map((n) => navLink(n, 'side')),
    el('div', { class: 'sidenav-spacer' }),
    el('button', { class: 'btn btn-ghost btn-block signout', onClick: signOut },
      isLocalMode() ? 'Exit local mode' : 'Sign out'),
  ]);

  const outlet = el('main', { class: 'outlet', id: 'outlet' });

  const bottomNav = el('nav', { class: 'bottomnav' },
    NAV.map((n) => navLink(n, 'bottom')));

  app.append(el('div', { class: 'layout' + (isLocalMode() ? ' has-banner' : '') }, [sideNav, outlet]));
  app.append(bottomNav);

  // Routes
  defineRoute('/dashboard', renderDashboard);
  defineRoute('/transactions', renderTransactions);
  defineRoute('/add', renderAdd);
  defineRoute('/categories', renderCategories);
  defineRoute('/import', renderImport);
  setNotFound(renderDashboard);

  initRouter(outlet, { onNavigate: highlightNav });
}

function navLink(n, variant) {
  return el('a', {
    href: '#' + n.path,
    class: `nav-link nav-${variant}`,
    dataset: { path: n.path },
  }, [el('span', { class: 'nav-icon' }, n.icon), el('span', { class: 'nav-label' }, n.label)]);
}

function highlightNav(path) {
  document.querySelectorAll('.nav-link').forEach((a) => {
    a.classList.toggle('active', a.dataset.path === path);
  });
}

async function signOut() {
  try {
    if (isLocalMode()) {
      setLocalMode(false);
    } else {
      await db.signOut();
    }
  } catch (err) {
    console.error(err);
  }
  toast('Signed out', 'info');
  location.hash = '';
  boot();
}

// Register the service worker for offline app-shell caching (PWA). Ignored on
// file:// — the app must be served over http(s).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((e) =>
      console.warn('SW registration failed:', e));
  });
}

boot();
