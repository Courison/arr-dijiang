/**
 * 帝江号 v2 · 页面外壳
 * - 不替换原业务 JS，只做导航/概览/可访问性/舱室配色的增强
 * - 通过 ES module 加载，失败不影响原页面
 */
import { applyRoomTheme, observeRoomTheme } from './room-theme.js';

const PAGE_LABELS = {
  home: '自动排班',
  manual: '手动排班',
  step: '步进模拟',
  roster: '干员库',
  advice: '提升建议',
  help: '帮助',
  log: '更新日志',
};

function detectPage() {
  const p = location.pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return 'home';
  if (p === '/manual') return 'manual';
  if (p === '/manual/step') return 'step';
  if (p === '/agentpackage') return 'roster';
  if (p === '/development') return 'advice';
  if (p === '/help') return 'help';
  if (p === '/log') return 'log';
  return 'home';
}

const page = detectPage();

function el(tag, attrs = {}, html) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function addSkipLink() {
  if (document.querySelector('.v2-skip')) return;
  const target = document.getElementById('scheduleResult') || document.getElementById('mainContent');
  if (!target) return;
  if (!target.id) target.id = 'mainContent';
  target.setAttribute('tabindex', '-1');
  const a = el('a', { class: 'v2-skip', href: `#${target.id}` }, '跳到主要内容');
  document.body.insertBefore(a, document.body.firstChild);
}

function addCrumb() {
  const header = document.querySelector('.app-header');
  if (!header || header.querySelector('.v2-crumb')) return;
  const h1 = header.querySelector('h1');
  if (h1) h1.textContent = h1.textContent.replace(/^[^\p{L}\p{N}]+/u, '').trim() || '帝江号排班系统';

  const shortTitle = page === 'home' ? '帝江号' : (PAGE_LABELS[page] || '帝江号');
  const applyTitle = () => {
    if (!h1) return;
    h1.textContent = window.matchMedia('(max-width: 768px)').matches
      ? shortTitle
      : (h1.dataset.v2Full || (h1.dataset.v2Full = h1.textContent));
  };
  if (h1) { h1.dataset.v2Full = h1.textContent; applyTitle(); }
  window.matchMedia('(max-width: 768px)').addEventListener?.('change', applyTitle);

  const crumb = el('div', { class: 'v2-crumb' },
    `<span>帝江号</span><span class="sep">/</span><b>${PAGE_LABELS[page] || '自动排班'}</b>`);
  const hamburger = header.querySelector('.hamburger');
  if (hamburger && hamburger.nextSibling) header.insertBefore(crumb, hamburger.nextSibling);
  else header.insertBefore(crumb, header.firstChild);
}

const BUTTON_ICONS = {
  users: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M16 5.5a3 3 0 0 1 0 5.8M17 15c2.8.2 4.5 1.8 4.5 5"/></svg>',
  clock: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>',
  sliders: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="7" cy="17" r="2"/></svg>',
  download: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
  trash: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>',
  refresh: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg>',
  chart: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V7M16 16v-3M20 16v-7"/></svg>',
  gear: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M5.5 18.5l2.1-2.1M16.4 7.6l2.1-2.1"/></svg>',
  user: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.4"/><path d="M5 21c0-3.8 3.1-6 7-6s7 2.2 7 6"/></svg>',
  play: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>',
  pause: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>',
  reset: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  forward: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6l8 6-8 6zM13 6l8 6-8 6z"/></svg>',
  edit: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M13 6l5 5"/></svg>',
  download2: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V9M7 14l5-5 5 5"/><path d="M5 3h14"/></svg>',
  back: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  key: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="12" r="4"/><path d="M12 12h9M17 12v4M20 12v3"/></svg>',
  qr: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1"/></svg>',
  cloud: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .6-7.9A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z"/></svg>',
  list: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
  grid: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  leaf: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21v-8"/><path d="M12 14c-4.2 0-6.2-2-6.2-5.2 4.2 0 6.2 2 6.2 5.2z"/><path d="M12 12.2c3.7 0 5.6-2 5.6-4.7-3.7 0-5.6 2-5.6 4.7z"/></svg>',
  mail: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7.5l9 6 9-6"/></svg>',
  ban: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/></svg>',
  message: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg>',
  rocket: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4c3 1 5 3 6 6l-6 6-4-4z"/><path d="M10 12l-4 1 1-4 3-1M6 18l-2 2"/></svg>',
  phone: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10 5h4M11 18.5h2"/></svg>',
  folder: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 2h9v11H3z"/></svg>',
  gamepad: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h10a4 4 0 0 1 3.8 5.2l-1 3a2 2 0 0 1-3.4.7L14 14h-4l-2.4 2.9a2 2 0 0 1-3.4-.7l-1-3A4 4 0 0 1 7 8z"/><path d="M8 11h2M9 10v2M16 11h.01M18 13h.01"/></svg>',
  building: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5l8-2v18M12 21V9l8 2v10"/><path d="M7 8h2M7 12h2M7 16h2M16 13h1M16 17h1"/></svg>',
  bolt: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L5 13h6l-1 9 8-11h-6z"/></svg>',
  trophy: '<svg class="v2-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5H5v2a3 3 0 0 0 3 3M16 5h3v2a3 3 0 0 1-3 3M12 13v5M8 21h8"/></svg>',
};

function stripLeadingEmoji(node) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let t;
  while ((t = walker.nextNode())) {
    const next = t.nodeValue.replace(/^[\s\p{Extended_Pictographic}\uFE0F\u200D\u25B6\u23F8\u23F9\u23ED\u23F4]+/u, '');
    if (next !== t.nodeValue) t.nodeValue = next;
    if (t.nodeValue.trim()) return;
  }
}

function enhanceButtonIcons() {
  const map = {
    openOperatorPanelBtn: 'users',
    openTimingPanelBtn: 'clock',
    openStrategyPanelBtn: 'sliders',
    importFromAutoBtn: 'download',
    clearManualBtn: 'trash',
    toggleRoundBtn: 'refresh',
    openStepSimBtn: 'chart',
    importFromManualBtn: 'download2',
    collapseAllBtn: 'refresh',
    startBtn: 'play',
    pauseBtn: 'pause',
    resetBtn: 'reset',
    fastBtn: 'forward',
    logClearBtn: 'trash',
    apOpenEditBtn: 'edit',
    dsBtnExport: 'download',
    dsBtnCred: 'key',
    dsBtnHgToken: 'key',
    dsBtnQrLogin: 'qr',
    dsBtnBatch: 'list',
    dsBtnAccountCloud: 'cloud',
    dsBtnImport: 'download2',
    openTrustModalBtn: 'users',
    runTimingBtn: 'rocket',
  };
  for (const [id, icon] of Object.entries(map)) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const ensure = () => {
      if (btn.querySelector('.v2-btn-icon')) return;
      const slot = btn.querySelector('.toolbar-icon');
      if (slot) slot.innerHTML = BUTTON_ICONS[icon];
      else btn.insertAdjacentHTML('afterbegin', BUTTON_ICONS[icon]);
      stripLeadingEmoji(btn);
    };
    ensure();
    new MutationObserver(ensure).observe(btn, { childList: true, subtree: true });
  }
  const account = document.getElementById('accountBtn');
  const accountIcon = account?.querySelector('.account-icon');
  if (accountIcon) accountIcon.innerHTML = BUTTON_ICONS.user;
  const settings = document.getElementById('dataSettingsBtn');
  if (settings && !settings.querySelector('.v2-btn-icon')) {
    settings.innerHTML = `${BUTTON_ICONS.gear}<span>干员数据设置</span>`;
  }
  const back = document.querySelector('.app-header a.header-cloud-btn[href="/manual/"]');
  if (back && !back.querySelector('.v2-btn-icon')) {
    back.innerHTML = `${BUTTON_ICONS.back}<span>返回手动排班</span>`;
  }
  for (const btn of document.querySelectorAll('.header-back-btn')) {
    if (btn.querySelector('.v2-btn-icon')) continue;
    const label = btn.textContent.replace(/^[←\s]+/, '').trim() || '返回';
    btn.innerHTML = `${BUTTON_ICONS.back}<span>${label}</span>`;
  }
}

function addSideFoot() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || sidebar.querySelector('.v2-side-foot')) return;
  sidebar.setAttribute('aria-label', '主导航');
  const foot = el('div', { class: 'v2-side-foot' },
    `<div class="v2-version"><span class="dot"></span> 本地 v2 · 初版</div>
     <div>排班核心：scheduler-core v2</div>
     <div>舱室配色：天赋技能主色</div>`);
  sidebar.appendChild(foot);
}

function enhanceSidebar() {
  const icons = {
    '/': '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    '/manual/': '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="7" cy="17" r="2"/></svg>',
    '/manual/step/': '<svg viewBox="0 0 24 24"><path d="M3 12h4l2-6 3 12 2-8 2 4h5"/><path d="M4 20h16"/></svg>',
    '/development/': '<svg viewBox="0 0 24 24"><path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V7M16 16v-3M20 16v-7"/></svg>',
    '/agentpackage/': '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M16 5.5a3 3 0 0 1 0 5.8M17 15c2.8.2 4.5 1.8 4.5 5"/></svg>',
    '/log/': '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20"/></svg>',
    '/help/': '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.6 2.6 0 1 1 4.2 2.1c-.9.7-1.8 1.2-1.8 2.4"/><path d="M12 17h.01"/></svg>',
  };
  for (const link of document.querySelectorAll('.sidebar-link')) {
    const path = link.getAttribute('href');
    const icon = link.querySelector('.sidebar-link-icon');
    if (icon && icons[path]) icon.innerHTML = icons[path];
  }
}

function enhanceHeader() {
  const header = document.querySelector('.app-header');
  if (!header) return;
  header.setAttribute('aria-label', '页面顶部');
  const hamburger = header.querySelector('.hamburger');
  if (hamburger) {
    if (!hamburger.querySelector('svg')) {
      hamburger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    }
    hamburger.setAttribute('aria-label', '打开导航菜单');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.addEventListener('click', () => hamburger.setAttribute('aria-expanded', 'true'));
  }
  for (const btn of document.querySelectorAll('.close-btn')) {
    if (!btn.querySelector('svg') && btn.textContent.trim() === '✕') {
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    }
  }
  const sidebarClose = document.getElementById('closeSidebarBtn');
  if (sidebarClose && !sidebarClose.querySelector('svg')) {
    sidebarClose.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  }
  for (const id of ['accountBtn', 'dataSettingsBtn']) {
    const b = document.getElementById(id);
    if (b && !b.getAttribute('aria-label')) b.setAttribute('aria-label', b.title || b.textContent.trim());
  }
}

function addMobileBar() {
  if (page !== 'home' || document.querySelector('.v2-mobile-bar')) return;
  const bar = el('div', { class: 'v2-mobile-bar', role: 'toolbar', 'aria-label': '排班快捷操作' });
  const actions = [
    { label: '干员', icon: 'users', aria: '打开干员库', run: () => document.getElementById('openOperatorPanelBtn')?.click() },
    { label: '时间', icon: 'clock', aria: '打开时间段推荐', run: () => document.getElementById('openTimingPanelBtn')?.click() },
    { label: '策略', icon: 'sliders', aria: '打开生产策略', run: () => document.getElementById('openStrategyPanelBtn')?.click() },
    { label: '导出', icon: 'download', aria: '导出排班图片', primary: true, run: () => window.DijiangExportSchedule?.() },
  ];
  for (const a of actions) {
    const b = el('button', { type: 'button', 'aria-label': a.aria }, `${BUTTON_ICONS[a.icon] || ''}<span>${a.label}</span>`);
    if (a.primary) b.classList.add('primary');
    b.addEventListener('click', a.run);
    bar.appendChild(b);
  }
  document.body.appendChild(bar);
}

// ---------------- 概览 KPI ----------------
function centralRestoreOf(list) {
  let n = 0;
  for (const op of list || []) {
    for (const t of op?.mergedTraits || []) {
      if (t.舱室 === '总控中枢' && t.类型 === '心情恢复提升') n += t.数值 || 0;
    }
  }
  return n;
}

function collectQueues() {
  const q = window._lastQueues;
  if (!q) return null;
  const keys = ['central', 'manufactA', 'manufactB', 'culture', 'meeting'];
  const assigned = new Set();
  const reserve = new Set();
  let centralA = 0, centralB = 0;
  let active = 0;
  for (const k of keys) {
    const room = q[k];
    if (!room) continue;
    const r1 = room.round1 || [];
    const r2 = room.round2 || [];
    const rec = room.recommend || [];
    if (r1.length || r2.length || rec.length) active++;
    for (const op of [...r1, ...r2, ...rec]) if (op?.name) assigned.add(op.name);
    for (const op of room.reserve || []) if (op?.name) reserve.add(op.name);
    if (k === 'central') {
      centralA = centralRestoreOf(r1);
      centralB = centralRestoreOf(r2);
    }
  }
  return { assigned: assigned.size, reserve: reserve.size, centralA, centralB, active, warnings: q._warnings || [] };
}

function addOverview() {
  if (page !== 'home') return;
  const grid = document.getElementById('scheduleResult');
  if (!grid || document.getElementById('v2Overview')) return;
  document.getElementById('v2OverviewPlaceholder')?.remove();
  const wrap = el('section', { class: 'v2-overview', id: 'v2Overview', 'aria-label': '排班概览' });
  wrap.innerHTML = `
    <div class="v2-kpi"><div class="label">在岗干员</div><div class="value" data-k="assigned">—</div><div class="hint">全站去重</div></div>
    <div class="v2-kpi amber"><div class="label">总控恢复 A / B</div><div class="value" data-k="central">—</div><div class="hint">每班只生效本班加成</div></div>
    <div class="v2-kpi"><div class="label">备选池</div><div class="value" data-k="reserve">—<small>人</small></div><div class="hint">可手动替换</div></div>
    <div class="v2-kpi"><div class="label">校验</div><div class="value" data-k="check" style="font-size:17px">等待</div><div class="hint">重复 / 信赖 / 备选</div></div>`;
  const notice = el('div', { class: 'v2-notice', id: 'v2Notice', role: 'status', 'aria-live': 'polite' },
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>设置策略后将自动排班。</span>');
  grid.parentNode.insertBefore(wrap, grid);
  grid.parentNode.insertBefore(notice, grid);
  updateOverview();
}

function updateOverview() {
  const data = collectQueues();
  const set = (k, v) => {
    const node = document.querySelector(`#v2Overview [data-k="${k}"]`);
    if (node) node.innerHTML = v;
  };
  const notice = document.getElementById('v2Notice');
  if (!data) {
    set('assigned', '—'); set('central', '—'); set('reserve', '—<small>人</small>'); set('check', '等待');
    if (notice) { notice.className = 'v2-notice'; notice.querySelector('span').textContent = '设置策略后将自动排班。'; }
    return;
  }
  set('assigned', String(data.assigned));
  const bText = data.centralB > 0 ? `${data.centralB}` : null;
  set('central', bText === null
    ? `${data.centralA}<small>%</small>`
    : `${data.centralA}<small>%</small> / ${bText}<small>%</small>`);
  set('reserve', `${data.reserve}<small>人</small>`);
  set('check', data.warnings.length ? '注意' : '通过');
  if (notice) {
    const warn = data.warnings.length > 0;
    notice.className = `v2-notice${warn ? ' warn' : ''}`;
    notice.querySelector('span').textContent = warn
      ? data.warnings.join('；')
      : '排班校验通过：无重复干员、信赖隔离、备选池无重复。';
  }
}

// ---------------- 可访问性 ----------------
function enhanceModals() {
  for (const overlay of document.querySelectorAll('.modal-overlay')) {
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const title = overlay.querySelector('.batch-header h2, h2');
    if (title && title.id) overlay.setAttribute('aria-labelledby', title.id);
    const sync = () => overlay.setAttribute('aria-hidden', overlay.classList.contains('open') ? 'false' : 'true');
    sync();
    new MutationObserver(sync).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.modal-overlay.open')].pop();
    if (!open) return;
    const close = open.querySelector('.close-btn, .sidebar-close');
    if (close) close.click();
    else open.classList.remove('open');
  });
  for (const link of document.querySelectorAll('.sidebar-link.is-active')) link.setAttribute('aria-current', 'page');
}

function enhanceImages() {
  for (const img of document.querySelectorAll('img:not([alt])')) {
    let alt = '';
    if (img.closest('#petWidget')) alt = '捏捏';
    else alt = img.closest('.recommend-item')?.querySelector('.agent-name')?.textContent
      || img.closest('.reserve-item')?.textContent
      || img.closest('.status-item')?.textContent
      || img.closest('.operator-card, .ap-row, .tile')?.textContent
      || '干员头像';
    img.alt = String(alt).trim().slice(0, 40) || '干员头像';
  }
}

function enhanceTrustReset() {
  const btn = document.getElementById('trustFilterResetBtn');
  if (!btn || btn.dataset.v2Bound === '1') return;
  btn.dataset.v2Bound = '1';
  btn.setAttribute('aria-label', '重置信赖干员筛选');
  btn.addEventListener('click', () => {
    const old = btn.textContent;
    btn.textContent = '已重置';
    setTimeout(() => { btn.textContent = old; }, 900);
  });
}

function cleanOnboarding() {
  // 首次引导：删除顶部图标与按钮内 icon，只保留文字
  for (const el of document.querySelectorAll('.onboarding-logo, .onboarding-btn-icon')) el.remove();
  // 页面标题里的 emoji 一并去掉，避免和线框图标混用
  for (const h of document.querySelectorAll('.page-title, .page-shell-title')) stripLeadingEmoji(h);
}

const ITEM_SRC = {
  exp: '/v2/items/item-exp.png',
  weapon: '/v2/items/item-weapon.png',
  plant: '/v2/items/item-plant.png',
  fungi: '/v2/items/item-fungi.png',
  mineral: '/v2/items/item-mineral.png',
};
const ROOM_ICON_SRC = {
  central: '/v2/icons/room-central.png',
  manufactA: '/v2/icons/room-manufact.png',
  manufactB: '/v2/icons/room-manufact.png',
  culture: '/v2/icons/room-culture.png',
  meeting: '/v2/icons/room-meeting.png',
};

function itemIcon(key) {
  return ITEM_SRC[key] ? `<img class="v2-item-icon" src="${ITEM_SRC[key]}" alt="" aria-hidden="true" decoding="async">` : '';
}

function roomKeyOf(text) {
  const s = String(text || '');
  if (s.includes('总控')) return 'central';
  if (s.includes('制造舱 A') || s.includes('制造舱A')) return 'manufactA';
  if (s.includes('制造舱 B') || s.includes('制造舱B')) return 'manufactB';
  if (s.includes('制造')) return 'manufactA';
  if (s.includes('培养')) return 'culture';
  if (s.includes('会客')) return 'meeting';
  return null;
}

function translateDisplayLabels(root = document.body) {
  if (!root) return;
  const rules = [
    [/制造舱\s*A/g, '制造舱 Ⅰ'],
    [/制造舱\s*B/g, '制造舱 Ⅱ'],
    [/二轮排班/g, '双班排班'],
    [/单轮排班/g, '单班排班'],
    [/单轮\s*\/\s*二轮/g, '单班/双班'],
    [/单轮\s*\/\s*两轮/g, '单班/双班'],
    [/单\s*\/\s*二轮/g, '单班/双班'],
    [/一轮时长/g, 'A班时长'],
    [/二轮时长/g, 'B班时长'],
    [/二轮排除/g, 'B班排除'],
    [/单轮/g, '单班'],
    [/双轮/g, '双班'],
    [/第\s*1\s*轮/g, 'A班'],
    [/第\s*2\s*轮/g, 'B班'],
    [/第\s*一\s*轮/g, 'A班'],
    [/第\s*二\s*轮/g, 'B班'],
    [/一轮/g, 'A班'],
    [/二轮/g, 'B班'],
    [/两轮/g, '双班'],
  ];
  const skip = 'script,style,textarea,pre,code,[contenteditable="true"]';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest(skip)) continue;
    let text = node.nodeValue;
    for (const [re, to] of rules) text = text.replace(re, to);
    if (text !== node.nodeValue) node.nodeValue = text;
  }
  for (const el of root.querySelectorAll('[title],[aria-label],[alt]')) {
    for (const attr of ['title', 'aria-label', 'alt']) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      let text = v;
      for (const [re, to] of rules) text = text.replace(re, to);
      if (text !== v) el.setAttribute(attr, text);
    }
  }
}

let labelTimer = 0;
function translateSoon() {
  clearTimeout(labelTimer);
  labelTimer = setTimeout(() => translateDisplayLabels(), 40);
}

function enhanceProductSelects() {
  for (const sel of document.querySelectorAll('#manualSchedule select.product-select')) {
    const sync = () => { sel.dataset.product = sel.value || ''; };
    if (sel.dataset.v2Product !== '1') {
      sel.dataset.v2Product = '1';
      sel.addEventListener('change', sync);
    }
    sync();
  }
}

function enhanceHeadings() {
  const rules = [
    ['生产策略', 'sliders'],
    ['舱室排班模式', 'grid'],
    ['培养信赖', 'users'],
    ['制造舱', 'gear'],
    ['培养舱', 'leaf'],
    ['会客室优先', 'mail'],
    ['二轮排除', 'ban'],
    ['轮班时间段', 'clock'],
    ['稳态循环', 'list'],
    ['心情恢复', 'bolt'],
    ['顶配排班', 'trophy'],
    ['反馈', 'message'],
    ['数据设置', 'gear'],
  ];
  const nodes = document.querySelectorAll('h1, h2, h3, h4, .batch-header h2, .strategy-section-inner h4, .toggle-label, .timing-overview-title, .timing-section-title');
  for (const node of nodes) {
    if (node.querySelector('.v2-head-icon')) continue;
    stripLeadingEmoji(node);
    const text = node.textContent;
    const hit = rules.find(([needle]) => text.includes(needle));
    if (hit && BUTTON_ICONS[hit[1]]) node.insertAdjacentHTML('afterbegin', BUTTON_ICONS[hit[1]].replace('v2-btn-icon', 'v2-head-icon'));
  }
  // “二轮排除线索”等纯文本小标题
  for (const el of document.querySelectorAll('#strategyPanelOverlay .strategy-section-inner div')) {
    if (el.children.length) continue;
    const raw = el.textContent.trim();
    if (!/^[\p{Extended_Pictographic}\uFE0F]/u.test(raw)) continue;
    stripLeadingEmoji(el);
    if (/排除/.test(raw) && !el.querySelector('.v2-head-icon')) {
      el.insertAdjacentHTML('afterbegin', BUTTON_ICONS.ban.replace('v2-btn-icon', 'v2-head-icon'));
    }
  }
}

function enhanceItemIcons() {
  // 生产策略复选框
  for (const cb of document.querySelectorAll('#manufactProducts input[value], #cultureProducts input[value]')) {
    const label = cb.closest('label');
    if (!label || label.querySelector('.v2-item-icon')) continue;
    const src = ITEM_SRC[cb.value];
    if (!src) continue;
    cb.insertAdjacentHTML('afterend', itemIcon(cb.value));
  }

  // 主站舱室 header 的产物标签
  for (const tag of document.querySelectorAll('.product-tag')) {
    if (tag.querySelector('.v2-item-icon')) continue;
    let text = tag.textContent.replace(/^[\s\p{Extended_Pictographic}\uFE0F\u200D]+/u, '').trim();
    if (!text) continue;
    const keys = [
      ['干员', 'exp'], ['武器', 'weapon'], ['晶植', 'plant'],
      ['菌类', 'fungi'], ['矿物', 'mineral'],
    ];
    for (const [label, key] of keys) {
      if (text.includes(label)) text = text.replace(label, `${itemIcon(key)}<span>${label}</span>`);
    }
    if (text.includes('优先线索')) text = text.replace('优先线索', `${BUTTON_ICONS.mail.replace('v2-btn-icon', 'v2-item-inline-icon')}<span>优先线索</span>`);
    tag.innerHTML = text;
  }

  // 手动排班产物下拉按钮
  for (const btn of document.querySelectorAll('.product-dropdown-btn')) {
    if (btn.querySelector('.v2-item-icon')) continue;
    const text = btn.textContent;
    const key = text.includes('干员') ? 'exp' : text.includes('武器') ? 'weapon'
      : text.includes('晶植') ? 'plant' : text.includes('菌类') ? 'fungi'
      : text.includes('矿物') ? 'mineral' : null;
    if (key) btn.insertAdjacentHTML('afterbegin', itemIcon(key));
  }

  // 步进模拟的追踪素材
  for (const label of document.querySelectorAll('#roomConfigArea .rc-product-row label, #roomConfigArea .rc-checkboxes label')) {
    if (label.querySelector('.v2-item-icon')) continue;
    const text = label.textContent;
    const key = text.includes('干员经验') ? 'exp' : text.includes('武器经验') ? 'weapon'
      : text.includes('矿物') ? 'mineral' : text.includes('菌类') ? 'fungi'
      : text.includes('晶植') ? 'plant' : null;
    if (!key) continue;
    const input = label.querySelector('input');
    if (input) input.insertAdjacentHTML('afterend', itemIcon(key));
    else label.insertAdjacentHTML('afterbegin', itemIcon(key));
  }
  enhanceProductSelects();
}

function enhanceRoomModeLabels() {
  for (const span of document.querySelectorAll('#roomModeList > div span')) {
    if (span.querySelector('img') || span.children.length) continue;
    const key = roomKeyOf(span.textContent);
    if (!key) continue;
    span.classList.add('v2-room-mode-label');
    span.insertAdjacentHTML('afterbegin', `<img src="${ROOM_ICON_SRC[key]}" alt="" aria-hidden="true" decoding="async">`);
  }
}

function enhanceTimingIcons() {
  for (const name of document.querySelectorAll('#timingResult .timing-room-name')) {
    if (name.querySelector('.v2-timing-room-icon')) continue;
    stripLeadingEmoji(name);
    const key = roomKeyOf(name.textContent);
    if (!key) continue;
    name.insertAdjacentHTML('afterbegin', `<img class="v2-timing-room-icon" src="${ROOM_ICON_SRC[key]}" alt="" aria-hidden="true" decoding="async">`);
    const text = name.textContent;
    const itemKey = text.includes('干员') ? 'exp' : text.includes('武器') ? 'weapon'
      : text.includes('晶植') ? 'plant' : text.includes('菌类') ? 'fungi'
      : text.includes('矿物') ? 'mineral' : null;
    if (itemKey) name.insertAdjacentHTML('beforeend', itemIcon(itemKey));
  }
  for (const title of document.querySelectorAll('#timingResult .timing-overview-title, #timingResult .timing-section-title')) {
    if (title.querySelector('.v2-head-icon')) continue;
    stripLeadingEmoji(title);
    title.insertAdjacentHTML('afterbegin', BUTTON_ICONS.list.replace('v2-btn-icon', 'v2-head-icon'));
  }
}

function enhanceDataSettingsIcons() {
  const map = [
    ['🎮', 'gamepad'], ['🏢', 'building'], ['📱', 'phone'],
    ['⚙', 'gear'], ['☁', 'cloud'], ['📁', 'folder'],
  ];
  for (const icon of document.querySelectorAll('#dataSettingsModal .ds-icon')) {
    if (icon.querySelector('svg')) continue;
    const text = icon.textContent.trim();
    const hit = map.find(([emoji]) => text.startsWith(emoji));
    if (!hit) continue;
    icon.classList.add('v2-ds-icon');
    icon.innerHTML = BUTTON_ICONS[hit[1]].replace('v2-btn-icon', 'v2-ds-icon-svg');
  }
}

function enhanceGearButtons() {
  for (const btn of document.querySelectorAll('.room-gear-btn')) {
    if (btn.querySelector('.v2-btn-icon')) continue;
    btn.innerHTML = BUTTON_ICONS.gear;
    btn.setAttribute('aria-label', btn.title || '舱室设置');
  }
}

function enhanceCloseIcons() {
  for (const btn of document.querySelectorAll('.close-btn')) {
    if (!btn.querySelector('svg') && btn.textContent.trim() === '✕') {
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    }
  }
}

function enhanceExports() {
  const original = window.DijiangExportSchedule;
  if (typeof original !== 'function' || original.__v2Labels) return;
  const wrapped = function (...args) {
    translateDisplayLabels();
    return original.apply(this, args);
  };
  wrapped.__v2Labels = true;
  window.DijiangExportSchedule = wrapped;
}

function layoutCultureFilter() {
  const box = document.querySelector('.manual-room-box[data-room="culture"]');
  if (!box) return;
  const filter = box.querySelector('.manual-room-header .product-dropdown');
  const title = box.querySelector('.manual-room-header > span:not(.v2-room-icon)');
  if (!filter || !title) return;
  filter.classList.add('room-title-filter');
  if (filter.parentElement !== title.parentElement) title.after(filter);
}

function enhanceBrand() {
  const brand = document.querySelector('#sidebar .sidebar-header > span');
  if (brand && brand.textContent !== 'Arr-Dijiang') brand.textContent = 'Arr-Dijiang';
}

function enhanceAboutLogo() {
  const logo = document.getElementById('aboutLogo');
  if (!logo || logo.querySelector('img')) return;
  logo.classList.add('v2-about-pet');
  logo.innerHTML = '<img src="/assets/images/pet.webp" alt="捏捏">';
}

function enhancePet() {
  const btn = document.querySelector('.pet-settings-btn');
  if (!btn) return;
  if (btn.textContent.trim() !== '🍎') btn.textContent = '🍎';
  btn.setAttribute('aria-label', '捏捏设置');
  btn.setAttribute('title', '捏捏设置');
}

function feedbackStatus(msg, type = 'error') {
  const el = document.getElementById('feedbackStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'feedback-status ' + type;
  el.style.display = 'block';
}

function enhanceFeedbackClipboard() {
  const modal = document.getElementById('feedbackModal');
  if (!modal || modal.dataset.v2Clipboard === '1') return;
  const area = document.getElementById('feedbackFileArea');
  const input = document.getElementById('feedbackFileInput');
  if (!area || !input) return;
  modal.dataset.v2Clipboard = '1';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'v2-paste-btn';
  btn.textContent = '从剪贴板读取图片';
  btn.setAttribute('aria-label', '从剪贴板读取图片，浏览器会询问剪贴板权限');
  const hint = document.createElement('div');
  hint.className = 'v2-paste-hint';
  hint.textContent = '首次使用会请求剪贴板权限；也可以直接在弹窗内 Ctrl+V 粘贴。';
  area.appendChild(btn);
  area.appendChild(hint);

  function sendFiles(files) {
    const list = [...files].filter(f => f && f.type.startsWith('image/'));
    if (!list.length) { feedbackStatus('剪贴板里没有图片'); return; }
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    feedbackStatus(`已读取 ${list.length} 张图片`, 'success');
  }

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!navigator.clipboard || !navigator.clipboard.read) {
      feedbackStatus('当前浏览器不支持读取剪贴板，请使用 Ctrl+V 或选择文件');
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      const files = [];
      for (const item of items) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type);
        const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        files.push(new File([blob], `clipboard-${Date.now()}.${ext}`, { type }));
      }
      sendFiles(files);
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        feedbackStatus('未获得剪贴板权限：请在浏览器弹窗中允许，或使用 Ctrl+V');
      } else {
        feedbackStatus('读取剪贴板失败，请使用 Ctrl+V 或选择文件');
      }
    }
  });

  modal.addEventListener('paste', (e) => {
    const files = e.clipboardData && e.clipboardData.files;
    if (files && files.length) {
      e.preventDefault();
      sendFiles(files);
    }
  });
}

function addRouteProgress() {
  if (!document.body || document.querySelector('.v2-route-progress')) return;
  const bar = el('div', { class: 'v2-route-progress', 'aria-hidden': 'true' });
  document.body.appendChild(bar);
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    try {
      const u = new URL(href, location.href);
      if (u.origin !== location.origin) return;
      if (/\.(zip|png|jpe?g|webp|svg|pdf|json|csv|xlsx?|docx?)$/i.test(u.pathname)) return;
      bar.classList.add('is-loading');
    } catch {}
  }, { capture: true });
  window.addEventListener('pageshow', () => bar.classList.remove('is-loading'));
}

function prefetchPages() {
  for (const link of document.querySelectorAll('.sidebar-link[href^="/"]')) {
    const href = link.getAttribute('href');
    if (!href || href === location.pathname || href === '/') continue;
    if (document.querySelector(`link[rel="prefetch"][href="${href}"]`)) continue;
    const l = document.createElement('link');
    l.rel = 'prefetch';
    l.href = href;
    l.as = 'document';
    document.head.appendChild(l);
  }
}

function removeMobileBanner() {
  document.getElementById('mobileBanner')?.remove();
}

function petGreeting() {
  // 手机端不自动弹气泡，避免遮挡排班卡；页宠仍可点击互动。
  if (window.matchMedia('(max-width: 768px)').matches) return;
  if (sessionStorage.getItem('dj:v2:pet-greeted') === '1') return;
  const trySay = (tries = 0) => {
    if (typeof window.DijiangPetSay === 'function') {
      sessionStorage.setItem('dj:v2:pet-greeted', '1');
      window.DijiangPetSay('欢迎回来，今天的排班也交给我吧～');
      setTimeout(() => document.getElementById('petBubble')?.classList.remove('show'), 6000);
      return;
    }
    if (tries < 20) setTimeout(() => trySay(tries + 1), 250);
  };
  setTimeout(() => trySay(), 1600);
}

function watchSchedule() {
  const grid = document.getElementById('scheduleResult');
  if (!grid) return;
  let timer = 0;
  const run = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { applyRoomTheme(document); enhanceImages(); enhanceItemIcons(); translateDisplayLabels(); updateOverview(); }, 40);
  };
  new MutationObserver(run).observe(grid, { childList: true, subtree: true });
  run();
}

function observePanel(id, fn) {
  const node = document.getElementById(id);
  if (!node) return;
  let timer = 0;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(fn, 30);
  }).observe(node, { childList: true, subtree: true });
  fn();
}

function init() {
  document.body.classList.add('dj-v2');
  document.body.dataset.page = page;
  addSkipLink();
  addCrumb();
  addSideFoot();
  enhanceSidebar();
  enhanceButtonIcons();
  enhanceHeader();
  enhanceTrustReset();
  cleanOnboarding();
  addMobileBar();
  addRouteProgress();
  prefetchPages();
  removeMobileBanner();
  addOverview();
  enhanceModals();
  enhanceImages();
  enhanceHeadings();
  translateDisplayLabels();
  enhanceItemIcons();
  enhanceGearButtons();
  enhanceCloseIcons();
  enhanceRoomModeLabels();
  enhanceTimingIcons();
  enhanceDataSettingsIcons();
  enhanceBrand();
  enhanceAboutLogo();
  layoutCultureFilter();
  enhancePet();
  enhanceFeedbackClipboard();
  enhanceExports();
  observeRoomTheme(() => { enhanceImages(); updateOverview(); });
  watchSchedule();
  observePanel('roomModeList', () => { enhanceRoomModeLabels(); translateDisplayLabels(); });
  observePanel('manualSchedule', () => { applyRoomTheme(document); enhanceImages(); enhanceItemIcons(); enhanceGearButtons(); enhanceRoomModeLabels(); translateDisplayLabels(); });
  observePanel('roomConfigArea', () => { enhanceItemIcons(); translateDisplayLabels(); });
  observePanel('timingResult', () => { enhanceTimingIcons(); translateDisplayLabels(); });
  new MutationObserver(() => { enhanceBrand(); enhanceAboutLogo(); layoutCultureFilter(); enhancePet(); enhanceFeedbackClipboard(); enhanceDataSettingsIcons(); enhanceGearButtons(); enhanceCloseIcons(); enhanceHeadings(); enhanceExports(); translateSoon(); })
    .observe(document.body, { childList: true, subtree: true });
  petGreeting();
  console.info('[帝江号 v2] shell ready:', page);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
