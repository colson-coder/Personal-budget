// =============================================================================
// more.js — "More" hub for phones: every page as a tile (the bottom bar only
// fits five). Respects which features the user turned on.
// =============================================================================

import { el } from '../util.js';
import { icon } from '../icons.js';
import { navItems } from '../nav.js';

export function renderMore() {
  const root = el('div', { class: 'view view-more' });
  root.append(el('div', { class: 'view-head' }, [el('h1', {}, 'More')]));
  root.append(el('div', { class: 'tile-grid' }, navItems()
    .filter((n) => n.path !== '/more')
    .map((n) => el('a', { class: 'tile card', href: '#' + n.path }, [
      el('span', { class: 'tile-icon' }, icon(n.icon, 24)),
      el('span', { class: 'tile-label' }, n.label),
      n.desc ? el('span', { class: 'tile-desc muted' }, n.desc) : null,
    ]))));
  return root;
}
