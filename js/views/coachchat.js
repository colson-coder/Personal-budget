// =============================================================================
// coachchat.js — "Ask the coach": AI chat sheet backed by the `coach` Supabase
// Edge Function (supabase/functions/coach). Off until CONFIG.AI_COACH is true
// and the function is deployed. Needs a signed-in account (not local mode).
// Each question sends the conversation plus a totals-only snapshot of the
// user's money (financeSnapshot in js/insights.js).
// =============================================================================

import { CONFIG } from '../config.js';
import { accessToken, isLocalMode } from '../db.js';
import { financeSnapshot } from '../insights.js';
import { el, openSheet, todayISO } from '../util.js';

export const aiCoachAvailable = () => Boolean(CONFIG.AI_COACH) && !isLocalMode();

const STARTERS = [
  'What should I focus on this month?',
  'How do I pay off my debt faster?',
  'Am I saving enough?',
  'How much should my emergency fund be?',
];

const history = []; // kept for the session so reopening continues the chat

export function openCoachChat(data) {
  openSheet('Ask the coach', () => {
    const log = el('div', { class: 'chat-log', 'aria-live': 'polite' });
    const input = el('textarea', { class: 'chat-input', rows: '2', placeholder: 'Ask about your money…', maxlength: '2000' });
    const send = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Send');
    const starters = el('div', { class: 'chip-row chat-starters' }, STARTERS.map((q) =>
      el('button', { class: 'chip', type: 'button', onClick: () => ask(q) }, q)));

    const bubble = (role, text) => el('div', { class: 'chat-msg chat-' + role }, text);
    for (const m of history) log.append(bubble(m.role, m.content));
    if (history.length) starters.hidden = true;

    async function ask(q) {
      q = (q || '').trim();
      if (!q || send.disabled) return;
      starters.hidden = true;
      history.push({ role: 'user', content: q });
      log.append(bubble('user', q));
      input.value = '';
      const wait = bubble('assistant', '…');
      wait.classList.add('chat-wait');
      log.append(wait);
      log.scrollTop = log.scrollHeight;
      send.disabled = true;
      try {
        const token = await accessToken();
        if (!token) throw new Error('Sign in to use the coach.');
        const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/coach`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: CONFIG.SUPABASE_ANON_KEY },
          body: JSON.stringify({ messages: history, snapshot: financeSnapshot(data, { today: todayISO() }) }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out.reply) throw new Error(out.error || 'The coach couldn’t answer right now.');
        history.push({ role: 'assistant', content: out.reply });
        wait.replaceWith(bubble('assistant', out.reply));
      } catch (err) {
        history.pop(); // let them retry the same question
        wait.replaceWith(el('div', { class: 'chat-msg chat-error' }, err.message || 'Something went wrong.'));
      } finally {
        send.disabled = false;
        log.scrollTop = log.scrollHeight;
      }
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); }
    });
    const form = el('form', { class: 'chat-form', onSubmit: (e) => { e.preventDefault(); ask(input.value); } }, [input, send]);
    return el('div', { class: 'chat' }, [
      el('p', { class: 'muted small hint' }, 'Answers use your totals, never individual purchases. It’s general guidance, not professional financial advice.'),
      log, starters, form,
    ]);
  });
}
