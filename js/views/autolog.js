// =============================================================================
// autolog.js — "Log card purchases automatically" (Settings).
//
// No phone wallet offers a web API, so this doesn't connect to Wallet directly.
// Instead the phone's own automation app opens a quick-add link the moment a
// card is tapped:
//   iPhone (iOS 17+): Shortcuts → Automation → Transaction trigger
//   Android: MacroDroid / Tasker reading the Google Wallet or bank notification
// The link (#/add?amount=…&merchant=…&auto=1) is handled in views/add.js.
// =============================================================================

import { el, toast } from '../util.js';
import { CONFIG } from '../config.js';
import { isLocalMode } from '../db.js';

export function appBaseURL() {
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}

export function quickAddURL({ amount = 'AMOUNT', merchant = 'MERCHANT', auto = true } = {}) {
  return `${appBaseURL()}#/add?amount=${amount}&merchant=${merchant}${auto ? '&auto=1' : ''}`;
}

export function autoLogCard() {
  let platform = /android/i.test(navigator.userAgent) ? 'android' : 'iphone';
  let auto = true;
  const card = el('div', { class: 'card autolog-card' });

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Link copied', 'success'); }
    catch { prompt('Copy this link:', text); }
  }

  function draw() {
    const url = quickAddURL({ auto });
    const seg = (value, label) => el('button', {
      class: 'btn btn-sm' + (platform === value ? ' btn-primary' : ''), type: 'button',
      onClick: () => { platform = value; draw(); },
    }, label);
    const steps = platform === 'iphone' ? [
      'Open the Shortcuts app, go to Automation and tap ＋.',
      'Choose “Transaction”, pick your cards, and choose “Run Immediately”.',
      'Tap “Create New Shortcut”. Add a “URL Encode” action and set it to Shortcut Input → Merchant.',
      'Add a “Text” action and paste the link below. Replace AMOUNT with Shortcut Input → Amount, and MERCHANT with the URL-encoded text.',
      'Add an “Open URLs” action. Now every tap-to-pay purchase opens the app and is logged.',
    ] : [
      'Install MacroDroid (free) or Tasker.',
      'Trigger: “Notification received” from Google Wallet or your bank’s app.',
      'Use a text action to pull the amount and the shop name out of the notification text.',
      'Action: “Open website / URL” with the link below. Put the amount in place of AMOUNT and the shop name in place of MERCHANT.',
    ];
    card.replaceChildren(
      el('h2', {}, 'Log card purchases automatically'),
      el('p', { class: 'muted small hint' },
        'When you pay by tapping your phone or card, your phone can send the purchase straight here. It’s set up once in your phone’s automation app. No bank login is involved.'),
      el('div', { class: 'autolog-seg' }, [seg('iphone', 'iPhone'), seg('android', 'Android')]),
      el('ol', { class: 'autolog-steps' }, steps.map((t) => el('li', {}, t))),
      el('label', { class: 'check-row' }, [
        el('input', { type: 'checkbox', checked: auto ? 'checked' : null, onChange: (e) => { auto = e.target.checked; draw(); } }),
        el('span', {}, 'Save without asking (otherwise you check it and tap Save)'),
      ]),
      el('div', { class: 'autolog-url' }, [
        el('code', {}, url),
        el('button', { class: 'btn btn-sm', type: 'button', onClick: () => copy(url) }, 'Copy'),
      ]),
      el('p', { class: 'muted small hint' }, [
        'The category is guessed from the shop name and learns from your changes. ',
        el('a', { href: quickAddURL({ amount: '4.50', merchant: 'Test%20Coffee', auto: false }) }, 'Try a test link'),
        '.',
      ]),
      platform === 'iphone'
        ? el('p', { class: 'small autolog-note' }, isLocalMode()
          ? `Heads up: links open in Safari, and this device-only (local) mode keeps data separate for Safari and the home-screen app. To use this, create an account so both see the same data.`
          : `Links open in Safari, so sign in to ${CONFIG.APP_NAME} in Safari once.`)
        : null,
    );
  }
  draw();
  return card;
}
