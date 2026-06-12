// =============================================================================
// auth.js (view) — Login / signup screen, plus the "skip login (local mode)"
// path. Talks only to db.js — never to Supabase directly.
// =============================================================================

import { db, setLocalMode } from '../db.js';
import { el, toast } from '../util.js';

// Renders into a full-screen container; calls onAuthed() once the user is in
// (either signed in, or local mode enabled).
export function renderAuth(onAuthed) {
  let mode = 'login'; // 'login' | 'signup'

  const root = el('div', { class: 'auth-wrap' });

  function draw() {
    root.replaceChildren();

    const emailInput = el('input', {
      type: 'email',
      id: 'auth-email',
      placeholder: 'you@example.com',
      autocomplete: 'email',
      required: 'required',
    });
    const passInput = el('input', {
      type: 'password',
      id: 'auth-pass',
      placeholder: 'Password',
      autocomplete: mode === 'login' ? 'current-password' : 'new-password',
      required: 'required',
    });

    const submitBtn = el(
      'button',
      { class: 'btn btn-primary btn-block', type: 'submit' },
      mode === 'login' ? 'Log in' : 'Create account'
    );

    const form = el('form', { class: 'auth-card card' }, [
      el('h1', { class: 'auth-title' }, 'Personal Budget'),
      el('p', { class: 'auth-sub' }, mode === 'login'
        ? 'Log in to sync across your devices.'
        : 'Create an account to sync across your devices.'),
      el('label', { for: 'auth-email' }, 'Email'),
      emailInput,
      el('label', { for: 'auth-pass' }, 'Password'),
      passInput,
      submitBtn,
      el('p', { class: 'auth-switch' }, [
        mode === 'login' ? "No account? " : 'Have an account? ',
        el('a', {
          href: '#',
          onClick: (e) => {
            e.preventDefault();
            mode = mode === 'login' ? 'signup' : 'login';
            draw();
          },
        }, mode === 'login' ? 'Sign up' : 'Log in'),
      ]),
      el('div', { class: 'auth-divider' }, 'or'),
      el('button', {
        class: 'btn btn-ghost btn-block',
        type: 'button',
        onClick: () => {
          setLocalMode(true);
          toast('Local mode enabled — data stays on this device.', 'info');
          onAuthed();
        },
      }, 'Skip login (local mode)'),
      el('p', { class: 'auth-hint' },
        'Local mode stores everything only on this device and will not sync.'),
    ]);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const password = passInput.value;
      if (!email || !password) return;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Please wait…';
      try {
        setLocalMode(false);
        if (mode === 'signup') {
          await db.signUp(email, password);
          toast('Account created. Check your email to confirm, then log in.', 'success');
          mode = 'login';
          draw();
        } else {
          await db.signIn(email, password);
          onAuthed();
        }
      } catch (err) {
        toast(err.message || 'Authentication failed', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = mode === 'login' ? 'Log in' : 'Create account';
      }
    });

    root.append(form);
  }

  draw();
  return root;
}
