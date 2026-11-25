// =============================================================================
// auth.js (view) — Login / signup screen, plus the "skip login (local mode)"
// path. Talks only to db.js — never to Supabase directly.
// =============================================================================

import { db, setLocalMode } from '../db.js';
import { startDemo } from '../demo.js';
import { el, toast } from '../util.js';
import { CONFIG } from '../config.js';

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

    // Errors stay on screen (not just a 3-second toast) so they can be read.
    const errorBox = el('p', { class: 'auth-error', role: 'alert', hidden: 'hidden' });
    const submitBtn = el(
      'button',
      { class: 'btn btn-primary btn-block', type: 'submit' },
      mode === 'login' ? 'Log in' : 'Create account'
    );

    const form = el('form', { class: 'auth-card card' }, [
      el('h1', { class: 'auth-title' }, CONFIG.APP_NAME),
      el('p', { class: 'auth-sub' }, mode === 'login'
        ? 'Log in to sync across your devices.'
        : 'Create an account to sync across your devices.'),
      el('label', { for: 'auth-email' }, 'Email'),
      emailInput,
      el('label', { for: 'auth-pass' }, 'Password'),
      passInput,
      errorBox,
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
          setLocalMode(true); // the local-mode banner explains it from here on
          onAuthed();
        },
      }, 'Skip login (local mode)'),
      el('p', { class: 'auth-hint' },
        'Local mode stores everything only on this device and will not sync.'),
      el('button', {
        class: 'btn btn-ghost btn-block auth-demo',
        type: 'button',
        onClick: () => { startDemo(); location.hash = '#/dashboard'; onAuthed(); },
      }, 'Try a demo with sample data'),
      el('p', { class: 'auth-hint' }, [
        el('a', { href: './welcome.html' }, `What is ${CONFIG.APP_NAME}?`), ' · ',
        el('a', { href: './privacy.html' }, 'Privacy'),
      ]),
    ]);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const password = passInput.value;
      if (!email || !password) return;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Please wait…';
      errorBox.hidden = true;
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
        errorBox.textContent = friendlyAuthError(err);
        errorBox.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = mode === 'login' ? 'Log in' : 'Create account';
      }
    });

    root.append(form);
  }

  draw();
  return root;
}

// Plain-language sign-in errors, keeping the original text for anything unknown.
export function friendlyAuthError(err) {
  const msg = String(err?.message || err || '');
  if (/invalid login credentials/i.test(msg)) return 'That email and password don’t match. Check for typos (and Caps Lock), or sign up if you’re new.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first: open the link we sent you, then log in.';
  if (/failed to fetch|load failed|networkerror|network request failed/i.test(msg)) return 'Can’t reach the server. Check your internet connection and try again.';
  if (/rate limit|too many/i.test(msg)) return 'Too many tries in a short time. Wait a minute and try again.';
  if (/already registered|already exists/i.test(msg)) return 'There’s already an account with that email. Log in instead.';
  return msg ? `Couldn’t log in: ${msg}` : 'Couldn’t log in. Please try again.';
}
