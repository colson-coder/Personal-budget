// =============================================================================
// autolog.js — "Log card purchases automatically" (Settings).
//
// No phone wallet offers a web API, so this doesn't connect to Wallet directly.
// Instead the phone's own automation app opens a quick-add link the moment a
// card is tapped:
//   iPhone: Shortcuts → Automation → Wallet (called "Transaction" on some iOS
//           versions), with Merchant and Amount from the Shortcut Input
//   Android: MacroDroid / Tasker reading the Google Wallet or bank notification
// The link (#/add?auto=1&merchant=…&amount=…) is handled in views/add.js.
//
// CONFIG.SHORTCUT_URL: once a ready-made iCloud shortcut link exists, the card
// leads with a one-tap "Get the shortcut" button and folds the manual steps.
// =============================================================================

import { el, toast } from '../util.js';
import { CONFIG } from '../config.js';
import { isLocalMode } from '../db.js';

export function appBaseURL() {
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}

// The start of the link; the phone appends the shop name, then &amount=….
export function linkStart({ auto = true } = {}) {
  return `${appBaseURL()}#/add?${auto ? 'auto=1&' : ''}merchant=`;
}

export function quickAddURL({ amount = 'AMOUNT', merchant = 'MERCHANT', auto = true } = {}) {
  return `${linkStart({ auto })}${merchant}&amount=${amount}`;
}

export function autoLogCard() {
  let platform = /android/i.test(navigator.userAgent) ? 'android' : 'iphone';
  let auto = true;
  const card = el('div', { class: 'card autolog-card' });

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied', 'success'); }
    catch { prompt('Copy this:', text); }
  }

  const b = (t) => el('b', {}, t);
  const li = (...parts) => el('li', {}, parts);

  function linkBox() {
    const start = linkStart({ auto });
    return el('div', { class: 'autolog-url' }, [
      el('code', {}, start),
      el('button', { class: 'btn btn-sm', type: 'button', onClick: () => copy(start) }, 'Copy'),
    ]);
  }

  function iphoneSteps() {
    return el('ol', { class: 'autolog-steps' }, [
      li('Open the ', b('Shortcuts'), ' app. Tap ', b('Automation'), ' at the bottom, then ', b('＋'), '.'),
      li('Tap ', b('Wallet'), ' (on some iPhones it’s called ', b('Transaction'), '). Pick your cards, choose ', b('Run Immediately'), ', tap ', b('Next'), ', then ', b('New Blank Automation'), '.'),
      li('Search for and add ', b('URL Encode'), '. Tap ', b('Text'), ', choose ', b('Shortcut Input'), ', then tap ', b('Shortcut Input'), ' again and pick ', b('Merchant'), '.'),
      li('Add a ', b('Text'), ' action and paste the link below. Right after it, tap ', b('URL Encoded Text'), ' in the bar above the keyboard.'),
      li('Type ', el('code', {}, '&amount='), ', tap ', b('Shortcut Input'), ', then tap it again and pick ', b('Amount'), '.'),
      li('Add ', b('Open URLs'), '. That’s it: every Apple Pay purchase is now logged.'),
    ]);
  }

  function androidSteps() {
    return el('ol', { class: 'autolog-steps' }, [
      li('Install ', b('MacroDroid'), ' (free) or Tasker.'),
      li('Trigger: ', b('Notification received'), ' from Google Wallet or your bank’s app.'),
      li('Use a text action to take the amount and the shop name from the notification.'),
      li('Action: ', b('Open website / URL'), ' with the link below, then the shop name, then ', el('code', {}, '&amount='), ' and the amount.'),
    ]);
  }

  function draw() {
    const seg = (value, label) => el('button', {
      class: 'btn btn-sm' + (platform === value ? ' btn-primary' : ''), type: 'button',
      onClick: () => { platform = value; draw(); },
    }, label);
    const oneTap = platform === 'iphone' && CONFIG.SHORTCUT_URL;
    const manual = [
      platform === 'iphone' ? iphoneSteps() : androidSteps(),
      linkBox(),
      el('label', { class: 'check-row autolog-check' }, [
        el('input', { type: 'checkbox', checked: auto ? 'checked' : null, onChange: (e) => { auto = e.target.checked; draw(); } }),
        el('span', {}, 'Save without asking (turn off to check each purchase first)'),
      ]),
    ];

    card.replaceChildren(
      el('h2', {}, 'Log card purchases automatically'),
      el('p', { class: 'muted small hint' },
        'Pay by tapping your phone, and the purchase appears here on its own, with the amount, shop and category filled in. You set it up once on your phone. No bank login needed.'),
      el('div', { class: 'autolog-seg' }, [seg('iphone', 'iPhone'), seg('android', 'Android')]),
      ...(oneTap ? [
        el('ol', { class: 'autolog-steps' }, [
          li('Tap ', b('Get the shortcut'), ', then ', b('Add Shortcut'), '.'),
          li('In Shortcuts, tap ', b('Automation'), ' → ', b('＋'), ' → ', b('Wallet'), ', pick your cards, choose ', b('Run Immediately'), ', and select ', b('Log to Babylon’s Purse'), '.'),
        ]),
        el('a', { class: 'btn btn-primary', href: CONFIG.SHORTCUT_URL, target: '_blank', rel: 'noopener' }, 'Get the shortcut'),
        el('details', { class: 'autolog-more' }, [el('summary', {}, 'Or build it yourself'), ...manual]),
      ] : manual),
      el('p', { class: 'muted small hint' }, [
        'The category is guessed from the shop name and learns from your changes. ',
        el('a', { href: quickAddURL({ amount: '4.50', merchant: 'Test%20Coffee', auto: false }) }, 'Try a test link'),
        '.',
      ]),
      ...(platform !== 'iphone' ? [] : [el('p', { class: 'small autolog-note' }, isLocalMode()
        ? 'Heads up: purchases open in Safari, which keeps its own copy of data in device-only mode. Create an account so Safari and the app share the same data.'
        : `Purchases open in Safari, so log in to ${CONFIG.APP_NAME} in Safari once.`)]),
    );
  }
  draw();
  return card;
}
