/**
 * 舱室配色 / 图标
 * 颜色来源：Talent/*.webp 的高饱和主色（见 data/talent-colors.json）
 * 只负责设置 CSS 变量与 data-room，不改变业务 DOM 结构。
 */

export const ROOM_META = {
  central: { label: '总控中枢', icon: 'central' },
  manufactA: { label: '制造舱 A', icon: 'manufact' },
  manufactB: { label: '制造舱 B', icon: 'manufact' },
  culture: { label: '培养舱', icon: 'culture' },
  meeting: { label: '会客室', icon: 'meeting' },
};

const TEXT_MAP = [
  ['总控', 'central'],
  ['制造舱 A', 'manufactA'],
  ['制造舱A', 'manufactA'],
  ['制造舱 B', 'manufactB'],
  ['制造舱B', 'manufactB'],
  ['制造', 'manufactA'],
  ['培养', 'culture'],
  ['会客', 'meeting'],
];

export function roomKeyFromText(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  for (const [needle, key] of TEXT_MAP) {
    if (s.includes(needle)) return key;
  }
  return null;
}

const ICON_SRC = {
  central: '/v2/icons/room-central.png',
  manufactA: '/v2/icons/room-manufact.png',
  manufactB: '/v2/icons/room-manufact.png',
  culture: '/v2/icons/room-culture.png',
  meeting: '/v2/icons/room-meeting.png',
};

const ICONS = {
  central: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>',
  manufact: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M5.5 18.5l2.1-2.1M16.4 7.6l2.1-2.1"/></svg>',
  culture: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21v-8"/><path d="M12 14c-4.2 0-6.2-2-6.2-5.2 4.2 0 6.2 2 6.2 5.2z"/><path d="M12 12.2c3.7 0 5.6-2 5.6-4.7-3.7 0-5.6 2-5.6 4.7z"/></svg>',
  meeting: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7.5l9 6 9-6"/></svg>',
};

function iconFor(key) {
  const src = ICON_SRC[key];
  if (src) return `<img src="${src}" alt="" aria-hidden="true" decoding="async">`;
  const meta = ROOM_META[key];
  return ICONS[meta?.icon] || ICONS.central;
}

function ensureIcon(header, key, beforeSelector) {
  if (!header || header.querySelector(':scope > .v2-room-icon')) return;
  const icon = document.createElement('span');
  icon.className = 'v2-room-icon';
  icon.dataset.room = key;
  icon.innerHTML = iconFor(key);
  const before = beforeSelector ? header.querySelector(beforeSelector) : header.firstElementChild;
  header.insertBefore(icon, before || header.firstChild);
}

function resolveKey(el) {
  const direct = el.dataset.room;
  if (direct && ROOM_META[direct]) return direct;
  const header = el.querySelector('.room-box-header, .manual-room-header, .rc-header, .room-card-header');
  if (!header) return null;
  return roomKeyFromText(header.textContent);
}

function applyOne(el) {
  const key = resolveKey(el);
  if (!key) return;
  if (!el.dataset.room) el.dataset.room = key;
  el.classList.add('v2-room');

  if (el.classList.contains('room-box')) {
    ensureIcon(el.querySelector('.room-box-header'), key);
  } else if (el.classList.contains('manual-room-box')) {
    ensureIcon(el.querySelector('.manual-room-header'), key);
  } else if (el.classList.contains('rc-card')) {
    ensureIcon(el.querySelector('.rc-header'), key);
  } else if (el.classList.contains('room-card')) {
    ensureIcon(el.querySelector('.room-card-header'), key);
  }
}

/** 给主站 A/B 轮次块加显式类，替代 :has() 依赖 */
export function markRounds(root = document) {
  for (const box of root.querySelectorAll('.room-box')) {
    for (const child of box.children) {
      if (!child.querySelector || !child.querySelector(':scope > .round-label')) continue;
      child.classList.add('v2-round');
      const label = child.querySelector(':scope > .round-label');
      const isB = /B\s*班/.test(label.textContent);
      child.classList.toggle('v2-round-b', isB);
      child.classList.toggle('v2-round-a', !isB);
    }
  }
}

/**
 * 应用舱室配色。可在每次 DOM 更新后重复调用（幂等）。
 */
export function applyRoomTheme(root = document) {
  const selectors = [
    '.room-box[data-room]',
    '.manual-room-box',
    '.rc-card[data-room]',
    '.room-card[data-room]',
  ];
  for (const sel of selectors) {
    for (const el of root.querySelectorAll(sel)) applyOne(el);
  }
  markRounds(root);
}

export function observeRoomTheme(onChange) {
  let raf = 0;
  const run = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      applyRoomTheme(document);
      onChange?.();
    });
  };
  const mo = new MutationObserver(run);
  mo.observe(document.body, { childList: true, subtree: true });
  run();
  return () => mo.disconnect();
}
