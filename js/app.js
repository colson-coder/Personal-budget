// =============================================================================
// app.js — Bootstrap: decides auth vs. local mode, seeds categories, builds the
// nav chrome + local-mode banner, and wires up the router. Entry point loaded by
// index.html as a module.
// =============================================================================

import { isDemo, startDemo, endDemo } from './demo.js';
import { db, isLocalMode, setLocalMode } from './db.js';
import { applyRecurring } from './recurring.js';
import { defineRoute, setNotFound, initRouter, navigate } from './router.js';
import { renderAuth } from './views/auth.js';
import { renderDashboard } from './views/dashboard.js';
import { renderTransactions } from './views/transactions.js';
import { renderAdd } from './views/add.js';
import { renderExpenses } from './views/expenses.js';
import { renderCategories } from './views/categories.js';
import { renderImport } from './views/import.js';
import { renderReports } from './views/reports.js';
import { renderPlan } from './views/plan.js';
import { renderFunds } from './views/funds.js';
import { renderDebts } from './views/debts.js';
import { renderIncome } from './views/income.js';
import { renderSettings } from './views/settings.js';
import { renderTaxes } from './views/taxes.js';
import { renderSetup } from './views/setup.js';
import { renderMore } from './views/more.js';
import { loadSettings, getSettings } from './store.js';
import { navItems, bottomItems } from './nav.js';
import { icon } from './icons.js';
import { CONFIG } from './config.js';
import { el, toast } from './util.js';

const app = document.getElementById('app');

document.title = CONFIG.APP_NAME;

async function boot() {
  // index.html?demo=1 (the landing page's "Try the demo") starts the demo.
  const qs = new URLSearchParams(location.search);
  if (qs.has('demo')) {
    startDemo();
    history.replaceState(null, '', location.pathname + '#/dashboard');
  }
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

  // Per-user settings: home currency, timezone, features, money plan.
  await loadSettings();
  if (!getSettings().setup_done) {
    app.replaceChildren(renderSetup(() => { location.hash = '#/dashboard'; boot(); }));
    return;
  }

  renderShell();

  // Auto-tracking: materialize any recurring transactions that came due since
  // the last launch. Runs after the shell renders so it never blocks the UI;
  // refreshes the current view if anything was added.
  applyRecurring().then((n) => {
    if (n > 0) {
      toast(`${n} recurring transaction${n === 1 ? '' : 's'} added automatically`, 'success');
      navigate(location.hash.replace(/^#/, '') || '/dashboard');
    }
  });
}

function renderShell() {
  app.replaceChildren();

  // Persistent local-mode banner (or the demo banner).
  if (isDemo()) {
    app.append(el('div', { class: 'local-banner demo-banner', role: 'status' }, [
      el('span', {}, 'You’re trying a demo with sample data. '),
      el('button', { class: 'link-inline', onClick: leaveDemo }, 'Start my own →'),
    ]));
  } else if (isLocalMode()) {
    app.append(el('div', { class: 'local-banner', role: 'status' },
      'Local mode — data is stored only on this device and will not sync.'));
  }

  const sideNav = el('nav', { class: 'sidenav' }, [
    el('div', { class: 'brand' }, [el('span', { class: 'brand-mark' }, '▮▮▮'), el('span', {}, CONFIG.APP_NAME)]),
    ...navItems().map((n) => navLink(n, 'side')),
    el('div', { class: 'sidenav-spacer' }),
    el('button', { class: 'btn btn-ghost btn-block signout', onClick: signOut },
      isDemo() ? 'Exit demo' : isLocalMode() ? 'Exit local mode' : 'Sign out'),
  ]);

  const outlet = el('main', { class: 'outlet', id: 'outlet' });

  const bottomNav = el('nav', { class: 'bottomnav' },
    bottomItems().map((n) => navLink(n, 'bottom')));

  app.append(el('div', { class: 'layout' + (isLocalMode() ? ' has-banner' : '') }, [sideNav, outlet]));
  app.append(bottomNav);

  // Routes
  defineRoute('/dashboard', renderDashboard);
  defineRoute('/transactions', renderTransactions);
  defineRoute('/add', renderAdd);
  defineRoute('/expenses', renderExpenses);
  defineRoute('/categories', renderCategories);
  defineRoute('/import', renderImport);
  defineRoute('/reports', renderReports);
  defineRoute('/plan', renderPlan);
  defineRoute('/funds', renderFunds);
  defineRoute('/debts', renderDebts);
  defineRoute('/income', renderIncome);
  defineRoute('/settings', renderSettings);
  defineRoute('/taxes', renderTaxes);
  defineRoute('/more', renderMore);
  setNotFound(renderDashboard);

  initRouter(outlet, { onNavigate: highlightNav });
}

function navLink(n, variant) {
  return el('a', {
    href: '#' + n.path,
    class: `nav-link nav-${variant}`,
    dataset: { path: n.path },
  }, [el('span', { class: 'nav-icon' }, icon(n.icon)), el('span', { class: 'nav-label' }, n.label)]);
}

// Pages reachable from "More" keep the More tab lit on phones.
const BOTTOM_PATHS = () => bottomItems().map((n) => n.path);
function highlightNav(path) {
  const onBottom = BOTTOM_PATHS().includes(path);
  document.querySelectorAll('.nav-link').forEach((a) => {
    const p = a.dataset.path;
    const isBottom = a.classList.contains('nav-bottom');
    a.classList.toggle('active', p === path || (isBottom && !onBottom && p === '/more'));
  });
}

// Feature toggles in Settings rebuild the nav without a reload.
window.addEventListener('pb:settings-changed', () => renderShell());

function leaveDemo() {
  endDemo();
  location.hash = '';
  boot();
}

async function signOut() {
  if (isDemo()) return leaveDemo();
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
