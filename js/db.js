// =============================================================================
// db.js — THE single data-access layer for the whole app.
//
// No page, view, or component may import Supabase or touch localStorage
// directly. Everything goes through the `db` object exported here. That is the
// rule that makes "local mode" possible without duplicating logic everywhere.
//
// There are two interchangeable backends behind the same interface:
//   • supabaseBackend  — real auth + Postgres, syncs across devices (RLS-secured)
//   • localBackend     — localStorage only, no account, single-device
//
// activeBackend() picks one at call time based on the persisted "local mode"
// preference (and whether Supabase is even configured). Because both backends
// implement the identical method surface, callers never branch on which is live.
// =============================================================================

import { CONFIG, DEFAULT_CATEGORIES } from './config.js';

// ---------------------------------------------------------------------------
// Local-mode preference (persisted). When true, db routes to localStorage and
// auth is bypassed entirely.
// ---------------------------------------------------------------------------
const LOCAL_MODE_KEY = 'pb_local_mode';

export function isLocalMode() {
  return localStorage.getItem(LOCAL_MODE_KEY) === '1';
}

export function setLocalMode(on) {
  localStorage.setItem(LOCAL_MODE_KEY, on ? '1' : '0');
}

// ---------------------------------------------------------------------------
// Supabase client — lazily created so local mode never needs the network or a
// valid URL/key. Imported from the official ESM CDN build (no bundler needed).
// ---------------------------------------------------------------------------
let _sb = null;
async function sb() {
  if (_sb) return _sb;
  const { createClient } = await import(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
  );
  _sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  return _sb;
}

function uid() {
  return (
    crypto.randomUUID?.() ||
    'id-' + Date.now() + '-' + Math.random().toString(16).slice(2)
  );
}

// =============================================================================
// SUPABASE BACKEND — every query is scoped by the database's RLS policies to
// rows where user_id = auth.uid(). We still set user_id on insert so the row is
// owned correctly; reads don't need an explicit filter because RLS enforces it.
// =============================================================================
const supabaseBackend = {
  async getCurrentUser() {
    const client = await sb();
    const { data } = await client.auth.getUser();
    return data?.user || null;
  },

  async signUp(email, password) {
    const client = await sb();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      // Email-confirmation links return here. This must match a URL listed under
      // Supabase → Authentication → URL Configuration (see README).
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
    if (error) throw error;
    return data;
  },

  async signIn(email, password) {
    const client = await sb();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async signOut() {
    const client = await sb();
    await client.auth.signOut();
  },

  async listCategories() {
    const client = await sb();
    const { data, error } = await client
      .from('categories')
      .select('*')
      .order('name');
    if (error) throw error;
    return data;
  },

  async createCategory(cat) {
    const client = await sb();
    const user = await this.getCurrentUser();
    const { data, error } = await client
      .from('categories')
      .insert({ ...cat, user_id: user.id })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateCategory(id, patch) {
    const client = await sb();
    const { data, error } = await client
      .from('categories')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteCategory(id) {
    const client = await sb();
    const { error } = await client.from('categories').delete().eq('id', id);
    if (error) throw error;
  },

  async listTransactions(filters = {}) {
    const client = await sb();
    let q = client.from('transactions').select('*').order('date', { ascending: false });
    if (filters.from) q = q.gte('date', filters.from);
    if (filters.to) q = q.lte('date', filters.to);
    if (filters.category_id) q = q.eq('category_id', filters.category_id);
    if (filters.currency) q = q.eq('currency', filters.currency);
    if (filters.limit) q = q.limit(filters.limit);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async createTransaction(tx) {
    const client = await sb();
    const user = await this.getCurrentUser();
    const { data, error } = await client
      .from('transactions')
      .insert({ ...tx, user_id: user.id })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async createTransactionsBulk(txs) {
    const client = await sb();
    const user = await this.getCurrentUser();
    const rows = txs.map((t) => ({ ...t, user_id: user.id }));
    const { data, error } = await client.from('transactions').insert(rows).select();
    if (error) throw error;
    return data;
  },

  async updateTransaction(id, patch) {
    const client = await sb();
    const { data, error } = await client
      .from('transactions')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteTransaction(id) {
    const client = await sb();
    const { error } = await client.from('transactions').delete().eq('id', id);
    if (error) throw error;
  },

  async seedDefaultCategories() {
    const existing = await this.listCategories();
    if (existing.length) return existing;
    const client = await sb();
    const user = await this.getCurrentUser();
    const rows = DEFAULT_CATEGORIES.map((c) => ({
      ...c,
      user_id: user.id,
      is_default: true,
    }));
    const { data, error } = await client.from('categories').insert(rows).select();
    if (error) throw error;
    return data;
  },
};

// =============================================================================
// LOCAL BACKEND — same interface, stored entirely in localStorage. There is no
// real auth; getCurrentUser() returns a synthetic local user so callers that
// check "are we signed in?" behave consistently.
// =============================================================================
const LS_TX = 'pb_local_transactions';
const LS_CAT = 'pb_local_categories';

function lsRead(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}
function lsWrite(key, arr) {
  localStorage.setItem(key, JSON.stringify(arr));
}

const localBackend = {
  async getCurrentUser() {
    return { id: 'local-user', email: 'local@device', local: true };
  },

  // Auth is a no-op in local mode; provided so the interface matches.
  async signUp() {
    throw new Error('Sign up is unavailable in local mode.');
  },
  async signIn() {
    throw new Error('Sign in is unavailable in local mode.');
  },
  async signOut() {
    /* nothing to do */
  },

  async listCategories() {
    return lsRead(LS_CAT).sort((a, b) => a.name.localeCompare(b.name));
  },

  async createCategory(cat) {
    const cats = lsRead(LS_CAT);
    const row = { id: uid(), is_default: false, ...cat, user_id: 'local-user' };
    cats.push(row);
    lsWrite(LS_CAT, cats);
    return row;
  },

  async updateCategory(id, patch) {
    const cats = lsRead(LS_CAT);
    const i = cats.findIndex((c) => c.id === id);
    if (i === -1) throw new Error('Category not found');
    cats[i] = { ...cats[i], ...patch };
    lsWrite(LS_CAT, cats);
    return cats[i];
  },

  async deleteCategory(id) {
    lsWrite(LS_CAT, lsRead(LS_CAT).filter((c) => c.id !== id));
  },

  async listTransactions(filters = {}) {
    let rows = lsRead(LS_TX);
    if (filters.from) rows = rows.filter((r) => r.date >= filters.from);
    if (filters.to) rows = rows.filter((r) => r.date <= filters.to);
    if (filters.category_id) rows = rows.filter((r) => r.category_id === filters.category_id);
    if (filters.currency) rows = rows.filter((r) => r.currency === filters.currency);
    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    if (filters.limit) rows = rows.slice(0, filters.limit);
    return rows;
  },

  async createTransaction(tx) {
    const rows = lsRead(LS_TX);
    const row = { id: uid(), created_at: new Date().toISOString(), ...tx, user_id: 'local-user' };
    rows.push(row);
    lsWrite(LS_TX, rows);
    return row;
  },

  async createTransactionsBulk(txs) {
    const rows = lsRead(LS_TX);
    const created = txs.map((t) => ({
      id: uid(),
      created_at: new Date().toISOString(),
      ...t,
      user_id: 'local-user',
    }));
    lsWrite(LS_TX, rows.concat(created));
    return created;
  },

  async updateTransaction(id, patch) {
    const rows = lsRead(LS_TX);
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) throw new Error('Transaction not found');
    rows[i] = { ...rows[i], ...patch };
    lsWrite(LS_TX, rows);
    return rows[i];
  },

  async deleteTransaction(id) {
    lsWrite(LS_TX, lsRead(LS_TX).filter((r) => r.id !== id));
  },

  async seedDefaultCategories() {
    const existing = lsRead(LS_CAT);
    if (existing.length) return existing;
    const rows = DEFAULT_CATEGORIES.map((c) => ({
      id: uid(),
      user_id: 'local-user',
      is_default: true,
      ...c,
    }));
    lsWrite(LS_CAT, rows);
    return rows;
  },
};

// ---------------------------------------------------------------------------
// Backend switch. Resolved per call so toggling local mode takes effect without
// reloading any module state.
// ---------------------------------------------------------------------------
function activeBackend() {
  return isLocalMode() ? localBackend : supabaseBackend;
}

// Public facade: forwards every method to whichever backend is active. `this`
// is bound to the backend so its internal helper calls (e.g. getCurrentUser)
// resolve correctly.
export const db = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === 'isLocalMode') return isLocalMode;
      if (prop === 'setLocalMode') return setLocalMode;
      return (...args) => {
        const backend = activeBackend();
        const fn = backend[prop];
        if (typeof fn !== 'function') {
          throw new Error(`db.${String(prop)} is not implemented`);
        }
        return fn.apply(backend, args);
      };
    },
  }
);
