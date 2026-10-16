/* ============================================================
   manual.js —— 手动排班页 v6
   - 单/二轮切换、从自动排班导入、干员不重复
   - tooltip fixed 定位、天赋按舱室+类型分组
   - v4：齿轮编辑态、关闭态便签、每轮统计
   - v5：制造舱/培养舱产品选择、稳态约束修正
   - v6：培养舱多选 + 优先级（默认晶植优先）、均产文字重构、
         从自动排班导入产品配置、会客室线索概率展示
   ============================================================ */
(function () {
    'use strict';
    
    const STORAGE_KEY_CONFIG  = 'DijiangScheduleConfig';
    const STORAGE_KEY_MANUAL  = 'DijiangManualSchedule';
    const STORAGE_KEY_EDITING = 'DijiangManualEditing';
    const STORAGE_KEY_PRODUCT = 'DijiangManualProduct';
    const STORAGE_KEY_OPTIMAL_HA = 'DijiangManualOptimalHA';
    // ★ 默认培养舱优先级：晶植 > 矿物 > 菌类
    const DEFAULT_CULTURE_PRIORITY = ['plant', 'mineral', 'fungi'];
    
    const ELITE_RANK = { none: 0, 精零: 1, 精一: 2, 精二: 3, 精三: 4, 精四: 5 };
    const TALENT_ORDER = ['1_1', '2_1', '1_2', '2_2'];
    const TALENT_TIER = { '1_1': 1, '2_1': 1, '1_2': 2, '2_2': 2 };
    const ROUND_KEYS = ['round1', 'round2'];
    
    const C_WORK_BASE = 0.072;   // 7.2%/h
    const C_REST_BASE = 0.12;    // 12%/h
    
    const ROOM_KEYS = ['central', 'manufactA', 'manufactB', 'culture', 'meeting'];
    const ROOM_LABELS = {
    central: '总控中枢',
    manufactA: '制造舱 A',
    manufactB: '制造舱 B',
    culture: '培养舱',
    meeting: '会客室',
    };
    const ROOM_RAW = {
    central: '总控中枢',
    manufactA: '制造舱',
    manufactB: '制造舱',
    culture: '培养舱',
    meeting: '会客室',
    };
    
    const PRODUCT_OPTIONS = {
    manufactA: [
      { value: 'exp', label: '干员经验素材', effType: '干员素材效率', effName: '干员经验' },
      { value: 'weapon', label: '武器经验素材', effType: '武器素材效率', effName: '武器经验' },
    ],
    manufactB: [
      { value: 'exp', label: '干员经验素材', effType: '干员素材效率', effName: '干员经验' },
      { value: 'weapon', label: '武器经验素材', effType: '武器素材效率', effName: '武器经验' },
    ],
    culture: [
      { value: 'mineral', label: '矿物', effType: '矿物效率', effName: '矿物' },
      { value: 'fungi',   label: '菌类', effType: '菌类效率', effName: '菌类' },
      { value: 'plant',   label: '晶植', effType: '晶植效率', effName: '晶植' },
    ],
    };
    
    let rawOperatorsData = null;
    let operators = [];
    let manualSchedule = null;
    let pickerContext = null;
    let editingRooms = new Set();
    
    // ★ roomProducts 结构：
    //   { manufactA: 'exp'|'weapon', manufactB: 'exp'|'weapon',
    //     culture: { products: string[], priority: string[]|null } }
    let roomProducts = {};
    
    // ============ 编辑状态 ============
    function loadEditingState() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_EDITING);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) editingRooms = new Set(arr.filter(k => ROOM_KEYS.includes(k)));
      }
    } catch (e) { editingRooms = new Set(); }
    }
    function saveEditingState() {
    try { sessionStorage.setItem(STORAGE_KEY_EDITING, JSON.stringify([...editingRooms])); } catch (e) {}
    }
    function toggleRoomEdit(roomKey) {
    if (editingRooms.has(roomKey)) editingRooms.delete(roomKey);
    else editingRooms.add(roomKey);
    saveEditingState();
    renderManualSchedule();
    }
    function isRoomEditing(roomKey) {
    return editingRooms.has(roomKey);
    }
    
    // ============ 产品选择 ============
    function loadRoomProducts() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_PRODUCT);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') roomProducts = parsed;
      }
    } catch (e) { roomProducts = {}; }
    
    // ★ 兼容旧格式，并把 culture 统一为 { products, priority }
    let c = roomProducts.culture;
    if (typeof c === 'string') {
      c = { products: [c], priority: null };
    } else if (Array.isArray(c)) {
      c = { products: c.slice(), priority: null };
    } else if (!c || typeof c !== 'object') {
      c = { products: [], priority: null };
    } else {
      c.products = Array.isArray(c.products) ? c.products : [];
      if (Array.isArray(c.priority)) {
        c.priority = c.priority.filter(p => c.products.includes(p));
        if (c.priority.length === 0) c.priority = null;
      } else {
        c.priority = null;
      }
    }
    roomProducts.culture = c;
    }
    function saveRoomProducts() {
    try { sessionStorage.setItem(STORAGE_KEY_PRODUCT, JSON.stringify(roomProducts)); } catch (e) {}
    }
    // ★ 保存某舱的最优 h1/h2，供步进模拟导入时使用
    function saveRoomTiming(roomKey, h1, h2) {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY_OPTIMAL_HA);
            const obj = raw ? JSON.parse(raw) : {};
            obj[roomKey] = { h1: h1, h2: h2 };
            sessionStorage.setItem(STORAGE_KEY_OPTIMAL_HA, JSON.stringify(obj));
        } catch (e) {}
    }
    function setRoomProduct(roomKey, value, opts) {
        if (roomKey === 'culture') {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                roomProducts.culture = {
                    products: Array.isArray(value.products) ? value.products.slice() : [],
                    priority: Array.isArray(value.priority) && value.priority.length > 0
                        ? value.priority.slice()
                        : null,
                };
            } else if (Array.isArray(value)) {
                const c = roomProducts.culture || { products: [], priority: null };
                roomProducts.culture = { products: value.slice(), priority: c.priority || null };
            } else {
                roomProducts.culture = { products: [], priority: null };
            }
        } else {
            if (value) roomProducts[roomKey] = value;
            else delete roomProducts[roomKey];
        }
        saveRoomProducts();
    
        // ★ silent 模式：不重绘整页，仅局部更新
        if (opts && opts.silent) {
            updateCultureUIInPlace();
            return;
        }
        renderManualSchedule();
    }
    
    // ★ 局部更新培养舱 UI（不重建 DOM）
    function updateCultureUIInPlace() {
        const container = document.getElementById('manualSchedule');
        if (!container) return;
        // 找到培养舱卡片
        const roomLabel = ROOM_LABELS.culture;
        const boxes = container.querySelectorAll('.manual-room-box');
        for (const box of boxes) {
            const header = box.querySelector('.manual-room-header > span:first-child');
            if (!header || header.textContent.trim() !== roomLabel) continue;
    
            // 更新均产文字
            const output = compute24hOutput('culture');
            const outEl = box.querySelector('.room-output');
            if (outEl) {
                if (output.needProduct) {
                    outEl.textContent = '';
                } else {
                    outEl.textContent = `24h均产${output.text}`;
                }
            }
    
            // 更新下拉按钮文字
            const ddBtn = box.querySelector('.product-dropdown-btn');
            if (ddBtn) {
                const opts = PRODUCT_OPTIONS.culture;
                const sel = (roomProducts.culture || {}).products || [];
                const priority = getEffectiveCulturePriority();
                const label = sel.length > 0
                    ? priority.map(v => (opts.find(o => o.value === v) || {}).label || v).join('/')
                    : '选择本舱需计算均产的素材';
                ddBtn.innerHTML = `${escapeHtml(label)} <span class="dd-arrow">▾</span>`;
            }
    
            // 更新菜单内徽章
            const dd = box.querySelector('.product-dropdown');
            if (dd) updateCultureDropdownBadges(dd);
    
            // 更新提示文字
            const hint = box.querySelector('.product-dd-hint');
            if (hint) {
                hint.textContent = (roomProducts.culture.priority === null)
                    ? '未设置优先级时默认顺序：晶植 > 矿物 > 菌类'
                    : '优先级 ① 最高的产物决定本舱时间安排';
            }
            break;
        }
    }
    
    // ★ 更新培养舱下拉菜单内徽章
    function updateCultureDropdownBadges(dd) {
        const opts = PRODUCT_OPTIONS.culture;
        const c = roomProducts.culture || { products: [], priority: null };
        const sel = c.products || [];
        const priority = getEffectiveCulturePriority();
    
        dd.querySelectorAll('.product-dd-item').forEach(item => {
            const val = item.dataset.value;
            const checked = sel.includes(val);
            const cb = item.querySelector('input[type="checkbox"]');
            if (cb) cb.checked = checked;
            item.classList.toggle('checked', checked);
    
            const badge = item.querySelector('.prio-badge');
            const arrows = item.querySelector('.prio-arrows');
            if (checked) {
                const rank = priority.indexOf(val);
                if (badge) {
                    badge.textContent = String(rank + 1);
                    badge.style.display = '';
                }
                if (arrows) {
                    arrows.style.display = '';
                    const up = arrows.querySelector('.prio-up');
                    const down = arrows.querySelector('.prio-down');
                    if (up) up.disabled = rank === 0;
                    if (down) down.disabled = rank === priority.length - 1;
                }
            } else {
                if (badge) badge.style.display = 'none';
                if (arrows) arrows.style.display = 'none';
            }
        });
    }
    function getProductMeta(roomKey) {
    const opts = PRODUCT_OPTIONS[roomKey];
    if (!opts) return null;
    if (roomKey === 'culture') {
      const c = roomProducts.culture || { products: [] };
      const products = c.products || [];
      return products.map(v => opts.find(o => o.value === v)).filter(Boolean);
    }
    const v = roomProducts[roomKey];
    return opts.find(o => o.value === v) || null;
    }
    // ★ 获取培养舱有效优先级顺序
    function getEffectiveCulturePriority() {
    const c = roomProducts.culture || { products: [], priority: null };
    const products = c.products || [];
    if (products.length === 0) return [];
    if (Array.isArray(c.priority) && c.priority.length > 0) {
      const result = c.priority.filter(p => products.includes(p));
      for (const p of DEFAULT_CULTURE_PRIORITY) {
        if (products.includes(p) && !result.includes(p)) result.push(p);
      }
      for (const p of products) {
        if (!result.includes(p)) result.push(p);
      }
      return result;
    }
    // 默认顺序
    const result = [];
    for (const p of DEFAULT_CULTURE_PRIORITY) {
      if (products.includes(p)) result.push(p);
    }
    for (const p of products) {
      if (!result.includes(p)) result.push(p);
    }
    return result;
    }
    
    // ============ 工具 ============
    function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[m]));
    }
    function emptyTalents() { return { '1_1': false, '2_1': false, '1_2': false, '2_2': false }; }
    function emptyRound() { return [null, null, null]; }
    function emptyRooms() {
    const rooms = {};
    for (const k of ROOM_KEYS) rooms[k] = { round1: emptyRound(), round2: emptyRound() };
    return rooms;
    }
    function createDefaultSchedule() { return { mode: 'single', rooms: emptyRooms() }; }
    
    function getOperatorOrder() {
    let order = rawOperatorsData.operator_order;
    if (!order || !Array.isArray(order) || order.length === 0) {
      order = Object.keys(rawOperatorsData).filter(k => k !== 'operator_order');
    }
    return order;
    }
    function normalizeElite(elite) {
    if (elite === '未拥有' || elite === 'none' || elite == null || elite === '') return 'none';
    return ELITE_RANK[elite] !== undefined ? elite : 'none';
    }
    function parseConfigEntry(val) {
    if (typeof val === 'string') {
      const elite = normalizeElite(val);
      const t = emptyTalents();
      if (elite === '精一') t['1_1'] = true;
      else if (elite === '精二') { t['1_1'] = t['2_1'] = true; }
      else if (elite === '精三') { t['1_1'] = t['2_1'] = t['1_2'] = true; }
      else if (elite === '精四') { t['1_1'] = t['2_1'] = t['1_2'] = t['2_2'] = true; }
      return { elite, talents: t };
    }
    if (val && typeof val === 'object') {
      const elite = normalizeElite(val.elite);
      const t = emptyTalents();
      const list = Array.isArray(val.talents) ? val.talents : [];
      for (const tid of list) if (TALENT_ORDER.includes(tid)) t[tid] = true;
      if (elite === 'none') { for (const k of TALENT_ORDER) t[k] = false; }
      return { elite, talents: t };
    }
    return { elite: 'none', talents: emptyTalents() };
    }
    function getTalentList(rawData, tid) {
    if (!rawData) return [];
    if (Array.isArray(rawData[tid]) && rawData[tid].length) return rawData[tid];
    const LEGACY = { '1_1': '精一', '2_1': '精二', '1_2': '精三', '2_2': '精四' };
    if (Array.isArray(rawData[LEGACY[tid]]) && rawData[LEGACY[tid]].length) return rawData[LEGACY[tid]];
    return [];
    }
    function isCluePower(type) {
    return type === '线索概率提升' || type === '线索概率小幅提升';
    }
    function getMergedTraits(op) {
    if (op.eliteLevel === 'none' || op.eliteLevel === '精零') return [];
    const raw = rawOperatorsData[op.name] || {};
    const all = [];
    for (const tid of TALENT_ORDER) {
      if (!op.activatedTalents[tid]) continue;
      const list = getTalentList(raw, tid);
      for (const t of list) all.push({ ...t, _tid: tid });
    }
    return all;
    }
    function formatShortTrait(t) {
    const room = t.舱室;
    let prefix = '';
    if (room === '总控中枢') prefix = '中枢';
    else if (room === '制造舱') prefix = '制造舱';
    else if (room === '培养舱') prefix = '培养舱';
    else if (room === '会客室') prefix = '会客室';
    
    if (t.类型 === '心情恢复提升') return `${prefix}心情恢复+${t.数值}%`;
    if (t.类型 === '心情消耗减少') return `${prefix}心情消耗-${t.数值}%`;
    if (t.类型 === '收集线索效率') return `线索搜集效率+${t.数值}%`;
    if (t.类型 === '线索概率小幅提升') return `线索${t.线索编号}概率小幅提升`;
    if (t.类型 === '线索概率提升') return `线索${t.线索编号}概率提升`;
    if (t.类型 === '干员素材效率') return `干员经验+${t.数值}%`;
    if (t.类型 === '武器素材效率') return `武器经验+${t.数值}%`;
    if (t.类型 === '矿物效率') return `矿物+${t.数值}%`;
    if (t.类型 === '菌类效率') return `菌类+${t.数值}%`;
    if (t.类型 === '晶植效率') return `晶植+${t.数值}%`;
    return `${t.类型} ${t.数值}%`;
    }
    function getTalentIconPath(traits) {
    if (!traits || traits.length === 0) return '';
    const t = traits[0];
    const room = t.舱室, type = t.类型;
    if (room === '总控中枢' && type === '心情恢复提升') return '/Talent/central_physical_power.webp';
    if (room === '制造舱') {
      if (type === '心情消耗减少') return '/Talent/manufact_lower_consume.webp';
      if (type === '干员素材效率' || type === '武器素材效率') return '/Talent/manufact_efficiency.webp';
    }
    if (room === '培养舱') {
      if (type === '心情消耗减少') return '/Talent/culture_lower_consume.webp';
      if (type === '矿物效率') return '/Talent/culture_mineral_efficiency.webp';
      if (type === '菌类效率') return '/Talent/culture_fungi_efficiency.webp';
      if (type === '晶植效率') return '/Talent/culture_plant_efficiency.webp';
    }
    if (room === '会客室') {
      if (type === '心情消耗减少') return '/Talent/meeting_lower_consume.webp';
      if (type === '收集线索效率') return '/Talent/meeting_clue_efficiency.webp';
      if (type === '线索概率提升' || type === '线索概率小幅提升') return '/Talent/meeting_clue_power.webp';
    }
    return '';
    }
    function groupTraitsByType(traits) {
    const map = new Map();
    for (const t of traits) {
      const key = isCluePower(t.类型)
        ? `${t.舱室}|线索概率|${t.线索编号 || ''}`
        : `${t.舱室}|${t.类型}`;
      const tier = TALENT_TIER[t._tid] || 1;
      if (!map.has(key)) map.set(key, { trait: t, tier });
      else {
        const ex = map.get(key);
        if (tier > ex.tier) map.set(key, { trait: t, tier });
      }
    }
    return Array.from(map.values()).map(v => v.trait);
    }
    function getGroupedTraits(op) {
    return groupTraitsByType(getMergedTraits(op));
    }
    
    function positionTooltip(card, tooltip) {
    if (!card || !tooltip) return;
    const cardRect = card.getBoundingClientRect();
    const tooltipW = 280;
    tooltip.style.left = '-9999px'; tooltip.style.top = '-9999px';
    const tooltipH = tooltip.offsetHeight || 120;
    let left = cardRect.left + cardRect.width / 2 - tooltipW / 2;
    if (left < 8) left = 8;
    if (left + tooltipW > window.innerWidth - 8) left = window.innerWidth - tooltipW - 8;
    let top = cardRect.top - tooltipH - 10;
    if (top < 8) top = cardRect.bottom + 10;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
    }
    
    // ---------- 便签效果 ----------
    function formatSlipEffect(t) {
    const room = t.舱室;
    let prefix = '';
    if (room === '总控中枢') prefix = '中枢';
    else if (room === '制造舱') prefix = '制造';
    else if (room === '培养舱') prefix = '培养';
    else if (room === '会客室') prefix = '会客';
    
    const hl = v => `<span class="hl">${v}</span>`;
    
    switch (t.类型) {
      case '心情恢复提升': return `${prefix}心情恢复+${hl(t.数值)}%`;
      case '心情消耗减少': return `${prefix}心情消耗-${hl(t.数值)}%`;
      case '收集线索效率': return `线索搜集效率+${hl(t.数值)}%`;
      case '线索概率小幅提升': return `${hl('线索' + t.线索编号)}概率小幅提升`;
      case '线索概率提升':     return `${hl('线索' + t.线索编号)}概率提升`;
      case '干员素材效率': return `干员经验+${hl(t.数值)}%`;
      case '武器素材效率': return `武器经验+${hl(t.数值)}%`;
      case '矿物效率': return `矿物+${hl(t.数值)}%`;
      case '菌类效率': return `菌类+${hl(t.数值)}%`;
      case '晶植效率': return `晶植+${hl(t.数值)}%`;
      default: return escapeHtml(`${t.类型} ${t.数值}%`);
    }
    }
    
    // ---------- 每轮统计 ----------
    function computeRoundStats(roomKey, roundKey) {
    const slots = manualSchedule.rooms[roomKey][roundKey];
    const rawRoom = ROOM_RAW[roomKey];
    const agg = { byType: {}, reduce: 0, N: 0 };
    
    // 收集允许的 effType
    let allowedEffTypes = null;
    if (roomKey === 'manufactA' || roomKey === 'manufactB') {
      const meta = getProductMeta(roomKey);
      allowedEffTypes = meta ? [meta.effType] : null;
    } else if (roomKey === 'culture') {
      const metas = getProductMeta(roomKey) || [];
      allowedEffTypes = metas.map(m => m.effType);
    }
    
    for (const name of slots) {
      if (!name) continue;
      const op = getOperatorByName(name);
      if (!op || op.eliteLevel === 'none' || op.eliteLevel === '精零') continue;
      agg.N++;
      const traits = getGroupedTraits(op).filter(t => t.舱室 === rawRoom);
      for (const t of traits) {
        const v = t.数值 || 0;
        if (t.类型 === '心情消耗减少') { agg.reduce += v; continue; }
        if (allowedEffTypes !== null) {
          if (allowedEffTypes.includes(t.类型)) {
            agg.byType[t.类型] = (agg.byType[t.类型] || 0) + v;
          }
        } else {
          agg.byType[t.类型] = (agg.byType[t.类型] || 0) + v;
        }
      }
    }
    return agg;
    }
    
    // ★ 收集线索概率（按编号归并，取高级）
    function collectCluePowers(roomKey, roundKey) {
    const slots = manualSchedule.rooms[roomKey][roundKey];
    const rawRoom = ROOM_RAW[roomKey];
    const map = new Map();
    for (const name of slots) {
      if (!name) continue;
      const op = getOperatorByName(name);
      if (!op || op.eliteLevel === 'none' || op.eliteLevel === '精零') continue;
      const traits = getGroupedTraits(op).filter(t => t.舱室 === rawRoom);
      for (const t of traits) {
        if (t.类型 !== '线索概率提升' && t.类型 !== '线索概率小幅提升') continue;
        const id = String(t.线索编号 || '');
        if (!id) continue;
        const tier = t.类型 === '线索概率提升' ? 2 : 1;
        const ex = map.get(id);
        if (!ex || tier > ex.tier) map.set(id, { id, tier });
      }
    }
    return Array.from(map.values()).sort((a, b) => Number(a.id) - Number(b.id));
    }
    
    function buildRoundStatHtml(roomKey, roundKey) {
    const label = ROOM_LABELS[roomKey];
    const roundLabel = roundKey === 'round1' ? '一轮' : '二轮';
    const agg = computeRoundStats(roomKey, roundKey);
    const t = agg.byType;
    const lines = [];
    
    if (roomKey === 'central') {
      if (t['心情恢复提升'] > 0) lines.push(`中枢心情恢复 +${t['心情恢复提升']}%`);
    } else if (roomKey === 'manufactA' || roomKey === 'manufactB') {
      const meta = getProductMeta(roomKey);
      if (meta) {
        if (t[meta.effType] > 0) lines.push(`${meta.effName} +${t[meta.effType]}%`);
      } else {
        lines.push('未选择素材');
      }
      if (agg.reduce > 0) lines.push(`心情消耗 -${agg.reduce}%`);
    } else if (roomKey === 'culture') {
      const metas = getProductMeta(roomKey) || [];
      if (metas.length === 0) {
        lines.push('未选择素材');
      } else {
        for (const m of metas) {
          if (t[m.effType] > 0) lines.push(`${m.effName} +${t[m.effType]}%`);
        }
      }
      if (agg.reduce > 0) lines.push(`心情消耗 -${agg.reduce}%`);
    } else if (roomKey === 'meeting') {
      if (t['收集线索效率'] > 0) lines.push(`线索搜集效率 +${t['收集线索效率']}%`);
      if (agg.reduce > 0) lines.push(`心情消耗 -${agg.reduce}%`);
      // 线索概率：按编号归并
      const cluePowers = collectCluePowers(roomKey, roundKey);
      for (const p of cluePowers) {
        lines.push(`线索${p.id} ${p.tier === 2 ? '概率提升' : '概率小幅提升'}`);
      }
    }
    
    if (lines.length === 0) lines.push('无生效天赋');
    
    const body = lines.map(l => `<div class="stat-line">${escapeHtml(l)}</div>`).join('');
    return `<div class="round-stat-popup">
      <div class="stat-title">${escapeHtml(label)} · ${roundLabel}</div>
      ${body}
    </div>`;
    }
    
    // ---------- 24h 产出 ----------
    function computeCentralRestore(roundKey) {
    const slots = manualSchedule.rooms.central[roundKey];
    let restore = 0;
    for (const name of slots) {
      if (!name) continue;
      const op = getOperatorByName(name);
      if (!op) continue;
      const traits = getGroupedTraits(op).filter(t => t.舱室 === '总控中枢');
      for (const t of traits) {
        if (t.类型 === '心情恢复提升') restore += (t.数值 || 0);
      }
    }
    return restore;
    }
    
    // ★ 按产品类型挑效率天赋（支持多产物）
    function calcGroupRate(roomKey, roundKey, productMetas) {
    const slots = manualSchedule.rooms[roomKey][roundKey];
    const rawRoom = ROOM_RAW[roomKey];
    let eff = 0, reduce = 0, N = 0;
    const metas = Array.isArray(productMetas) ? productMetas : (productMetas ? [productMetas] : []);
    const effTypes = metas.map(m => m.effType);
    for (const name of slots) {
      if (!name) continue;
      const op = getOperatorByName(name);
      if (!op || op.eliteLevel === 'none' || op.eliteLevel === '精零') continue;
      N++;
      const traits = getGroupedTraits(op).filter(t => t.舱室 === rawRoom);
      for (const t of traits) {
        const v = t.数值 || 0;
        if (t.类型 === '心情消耗减少') { reduce += v; continue; }
        if (roomKey === 'manufactA' || roomKey === 'manufactB') {
          if (effTypes.includes(t.类型)) eff += v;
        } else if (roomKey === 'meeting') {
          if (t.类型 === '收集线索效率') eff += v;
        } else if (roomKey === 'culture') {
          if (effTypes.includes(t.类型)) eff += v;
        }
      }
    }
    return { eff, reduce, N };
    }
    
    function computeOneProduct24h(roomKey, productMeta, hAOverride) {
    const isDouble = manualSchedule.mode === 'double';
    const g1 = calcGroupRate(roomKey, 'round1', productMeta);
    const g2 = isDouble ? calcGroupRate(roomKey, 'round2', productMeta) : null;

    const rateOf = g => (1 + g.eff / 100) * (1 + 0.4 * g.N);
    const cWorkOf = g => C_WORK_BASE * Math.max(0.1, 1 - g.reduce / 100);

    const restore1 = computeCentralRestore('round1');
    const restore2 = isDouble ? computeCentralRestore('round2') : restore1;
    const cRest1 = C_REST_BASE * (1 + restore1 / 100);
    const cRest2 = C_REST_BASE * (1 + restore2 / 100);
    const cRestHigh = Math.max(cRest1, cRest2);
    const cRestLow  = Math.min(cRest1, cRest2);

    // 单轮或无二轮数据
    if (!isDouble || !g2 || g2.N === 0) {
      if (g1.N === 0) return '—';
      const r = rateOf(g1);
      const cw = cWorkOf(g1);
      const tMax = Math.min(24, 1 / cw, 24 * cRestHigh / (cw + cRestHigh));
      if (hAOverride != null) {
        const hA = Math.min(hAOverride, 24);
        return `+${(r * hA).toFixed(2)}%（${hA}h）`;
      }
      return `+${(r * tMax).toFixed(2)}%`;
    }

    const rA = rateOf(g1), rB = rateOf(g2);
    const cA = cWorkOf(g1), cB = cWorkOf(g2);

    if (hAOverride != null) {
      const hA = hAOverride;
      const hB = 24 - hA;
      const output = rA * hA + rB * hB;
      // ★ 保存最优时长
    if (roomKey === 'manufactA' || roomKey === 'manufactB' || roomKey === 'meeting' || roomKey === 'culture') {
      saveRoomTiming(roomKey, hA, hB);
    }
      return `+${output.toFixed(2)}%（${hA}h+${hB}h）`;
    }

    // ★ 自动模式：整点枚举 + 稳态可行性 + 段内可短时停工
    const highIsA = rA >= rB;
    const highRate = highIsA ? rA : rB;
    const lowRate  = highIsA ? rB : rA;
    const highCw   = highIsA ? cA : cB;
    const lowCw    = highIsA ? cB : cA;

    let bestHHigh = 13;
    let bestOutput = -1;
    let found = false;

    for (let hHigh = 1; hHigh <= 23; hHigh++) {
      const hLow = 24 - hHigh;
      const effHighWork = Math.min(hHigh, 1 / highCw);   // 段内允许短时停工
      const effLowWork  = Math.min(hLow,  1 / lowCw);

      const highConsume = effHighWork * highCw;
      const highRestore = hLow * cRestHigh;
      const lowConsume  = effLowWork * lowCw;
      const lowRestore  = hHigh * cRestLow;

      if (highConsume > highRestore + 1e-6) continue;
      if (lowConsume  > lowRestore  + 1e-6) continue;

      const output = highRate * effHighWork + lowRate * effLowWork;
      if (!found || output > bestOutput) {
        bestOutput = output;
        bestHHigh = hHigh;
        found = true;
      }
    }

    // 无可行解 → 退化：只让高效组单独工作到极限
    if (!found) {
      const tMax = Math.min(24, 1 / highCw, 24 * cRestHigh / (highCw + cRestHigh));
      return `+${(highRate * tMax).toFixed(2)}%`;
    }

    // 映射回 round1/round2
    const h1 = highIsA ? bestHHigh : (24 - bestHHigh);
    const h2 = 24 - h1;
    // ★ 保存最优时长
    if (roomKey === 'manufactA' || roomKey === 'manufactB' || roomKey === 'meeting' || roomKey === 'culture') {
        saveRoomTiming(roomKey, h1, h2);
    }
    return `+${bestOutput.toFixed(2)}%（${h1}h+${h2}h）`;
}
    // ★ 计算某产物的最优 hA（用于多产物统一时长）
    //   返回 round1 的整点工作时长 h1
    function computeHAForProduct(roomKey, productMeta) {
    const isDouble = manualSchedule.mode === 'double';
    const g1 = calcGroupRate(roomKey, 'round1', productMeta);
    const g2 = isDouble ? calcGroupRate(roomKey, 'round2', productMeta) : null;

    const cWorkOf = g => C_WORK_BASE * Math.max(0.1, 1 - g.reduce / 100);
    const rateOf = g => (1 + g.eff / 100) * (1 + 0.4 * g.N);

    const restore1 = computeCentralRestore('round1');
    const restore2 = isDouble ? computeCentralRestore('round2') : restore1;
    const cRest1 = C_REST_BASE * (1 + restore1 / 100);
    const cRest2 = C_REST_BASE * (1 + restore2 / 100);
    const cRestHigh = Math.max(cRest1, cRest2);
    const cRestLow  = Math.min(cRest1, cRest2);

    const cA = cWorkOf(g1);

    // 单轮或无二轮数据：只受工作上限约束
    if (!g2 || g2.N === 0) {
      return Math.min(24, Math.floor(1 / cA));
    }

    const cB = cWorkOf(g2);
    const rA = rateOf(g1), rB = rateOf(g2);

    const highIsA = rA >= rB;
    const highRate = highIsA ? rA : rB;
    const lowRate  = highIsA ? rB : rA;
    const highCw   = highIsA ? cA : cB;
    const lowCw    = highIsA ? cB : cA;

    let bestHHigh = 13;
    let bestOutput = -1;
    let found = false;

    for (let hHigh = 1; hHigh <= 23; hHigh++) {
      const hLow = 24 - hHigh;
      const effHighWork = Math.min(hHigh, 1 / highCw);
      const effLowWork  = Math.min(hLow,  1 / lowCw);

      if (effHighWork * highCw > hLow * cRestHigh + 1e-6) continue;
      if (effLowWork  * lowCw  > hHigh * cRestLow  + 1e-6) continue;

      const output = highRate * effHighWork + lowRate * effLowWork;
      if (!found || output > bestOutput) {
        bestOutput = output;
        bestHHigh = hHigh;
        found = true;
      }
    }

    if (!found) bestHHigh = 13;
    // 映射回 round1 的时长
    return highIsA ? bestHHigh : (24 - bestHHigh);
    }
    
    function compute24hOutput(roomKey) {
    const isDouble = manualSchedule.mode === 'double';
    
    // 总控
    if (roomKey === 'central') {
      const r1 = computeCentralRestore('round1');
      if (isDouble) {
        const r2 = computeCentralRestore('round2');
        return { text: `一轮 +${r1}%/h · 二轮 +${r2}%/h`, isCentral: true, needProduct: false };
      }
      return { text: `+${r1}%/h`, isCentral: true, needProduct: false };
    }
    
    const isManufact = roomKey === 'manufactA' || roomKey === 'manufactB';
    const isCulture = roomKey === 'culture';
    const isMeeting = roomKey === 'meeting';
    
    // 制造舱
    if (isManufact) {
      const meta = getProductMeta(roomKey);
      if (!meta) return { text: '', isCentral: false, needProduct: true };
      const numText = computeOneProduct24h(roomKey, meta);
      return { text: `${meta.effName}${numText}`, isCentral: false, needProduct: false };
    }
    
    // 培养舱：多产物，统一时长，时段只列一次
    if (isCulture) {
      const metas = getProductMeta(roomKey) || [];
      if (metas.length === 0) return { text: '', isCentral: false, needProduct: true };

      const priorityOrder = getEffectiveCulturePriority();
      const firstMeta = metas.find(m => m.value === priorityOrder[0]) || metas[0];
      const hA = computeHAForProduct('culture', firstMeta);

      const pieces = [];
      for (const p of priorityOrder) {
        const m = metas.find(x => x.value === p);
        if (!m) continue;
        const full = computeOneProduct24h(roomKey, m, hA);     // 形如 "+91.08%（17h+7h）"
        const numeric = full.replace(/（\d+h\+\d+h）$/, '');   // 去掉尾部时长
        pieces.push(`${m.effName}${numeric}`);
      }
      const timeSuffix = `（${hA}h+${24 - hA}h）`;
      return { text: pieces.join(' / ') + timeSuffix, isCentral: false, needProduct: false };
    }
    
    // 会客室
    if (isMeeting) {
      const numText = computeOneProduct24h(roomKey, { effType: '收集线索效率' });
      return { text: `线索${numText}`, isCentral: false, needProduct: false };
    }
    
    return { text: '—', isCentral: false, needProduct: false };
    }
    
    // ---------- 头像 ----------
    const spriteDataUrlCache = {};
    let spriteImage = null;
    let spriteIndex = null;
    let spriteReady = false;
    
    async function loadSprite() {
    try {
      const res = await fetch('/dist/agent_sprite.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      spriteIndex = await res.json();
      const imgUrl = '/dist/' + (spriteIndex.image || 'agent_sprite.webp');
      spriteImage = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('长图加载失败'));
        img.src = imgUrl;
      });
      spriteReady = true;
      console.log('[手动页/精灵图] 已加载');
    } catch (e) {
      console.warn('[手动页/精灵图] 加载失败，回退单张：', e);
      spriteReady = false;
    }
    }
    function getSpriteDataUrl(name) {
    if (!spriteReady || !spriteImage || !spriteIndex) return null;
    if (spriteDataUrlCache[name]) return spriteDataUrlCache[name];
    const pos = spriteIndex.agents && spriteIndex.agents[name];
    if (!pos) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = pos.w;
      canvas.height = pos.h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(spriteImage, pos.x, pos.y, pos.w, pos.h, 0, 0, pos.w, pos.h);
      let url = '';
      try { url = canvas.toDataURL('image/webp', 0.9); } catch (_) {}
      if (!url || url.indexOf('data:image/webp') !== 0) url = canvas.toDataURL('image/png');
      spriteDataUrlCache[name] = url;
      return url;
    } catch (e) { return null; }
    }
    function getAgentImgSrc(name) {
    const s = getSpriteDataUrl(name);
    if (s) return s;
    return `/Agent/${encodeURIComponent(name)}.webp`;
    }
    
    // ---------- 数据加载 ----------
    function initOperators() {
    operators = [];
    const order = getOperatorOrder();
    let id = 1;
    let config = {};
    try { config = JSON.parse(sessionStorage.getItem(STORAGE_KEY_CONFIG) || '{}'); } catch (e) {}
    for (const name of order) {
      const info = rawOperatorsData[name];
      if (!info) continue;
      const entry = parseConfigEntry(config[name]);
      operators.push({
        id: id++,
        name,
        star: info.star || '未知',
        attribute: info.attribute || '未知',
        eliteLevel: entry.elite,
        activatedTalents: entry.talents,
      });
    }
    }
    
    function loadManualSchedule() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_MANUAL);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.rooms && (parsed.mode === 'single' || parsed.mode === 'double')) {
          manualSchedule = { mode: parsed.mode, rooms: emptyRooms() };
          for (const rk of ROOM_KEYS) {
            for (const rnd of ROUND_KEYS) {
              const arr = parsed.rooms[rk] && parsed.rooms[rk][rnd];
              if (Array.isArray(arr)) {
                manualSchedule.rooms[rk][rnd] = [arr[0] || null, arr[1] || null, arr[2] || null];
              }
            }
          }
          return;
        }
      }
    } catch (e) {}
    manualSchedule = createDefaultSchedule();
    }
    
    function saveManualSchedule() {
    try { sessionStorage.setItem(STORAGE_KEY_MANUAL, JSON.stringify(manualSchedule)); } catch (e) {}
    }
    
    function getOperatorByName(name) {
    return operators.find(o => o.name === name) || null;
    }
    
    // ---------- 保证不重复（移动语义） ----------
    function removeOperatorFromAll(name) {
    if (!name) return;
    for (const rk of ROOM_KEYS) {
      for (const rnd of ROUND_KEYS) {
        const arr = manualSchedule.rooms[rk][rnd];
        for (let i = 0; i < 3; i++) {
          if (arr[i] === name) arr[i] = null;
        }
      }
    }
    }
    function assignOperator(roomKey, roundKey, slotIndex, name) {
    removeOperatorFromAll(name);
    manualSchedule.rooms[roomKey][roundKey][slotIndex] = name;
    }
    
    // ---------- 渲染 ----------
    function renderManualSchedule() {
    const container = document.getElementById('manualSchedule');
    if (!container) return;
    
    const isDouble = manualSchedule.mode === 'double';
    const isMobile = window.innerWidth <= 768;
    
    // ---- 单槽位 ----
    const buildSlot = (roomKey, roundKey, slotIndex) => {
      const name = manualSchedule.rooms[roomKey][roundKey][slotIndex];
      const op = name ? getOperatorByName(name) : null;
      const isEditing = isRoomEditing(roomKey);
      const dataAttrs = `data-room="${roomKey}" data-round="${roundKey}" data-index="${slotIndex}"`;
      const stateCls = isEditing ? 'is-editing' : 'is-viewing';
    
      if (op && op.eliteLevel !== 'none') {
        const imgSrc = getAgentImgSrc(op.name);
        const traits = getGroupedTraits(op).filter(t => t.舱室 === ROOM_RAW[roomKey]);
    
        let slipHtml = '';
        if (traits.length === 0) {
          slipHtml = `<div class="slip-empty">无生效天赋</div>`;
        } else {
          slipHtml = traits.map(t => {
            const iconPath = getTalentIconPath([t]);
            const iconTag = iconPath
              ? `<img class="slip-icon" src="${iconPath}" onerror="this.style.display='none';">`
              : '';
            return `<div class="slip-line">${iconTag}<span class="slip-effect">${formatSlipEffect(t)}</span></div>`;
          }).join('');
        }
    
        return `<div class="manual-slot is-filled ${stateCls}" ${dataAttrs} title="${escapeHtml(op.name)}">
          <button class="slot-remove" ${dataAttrs} title="移除">✕</button>
          <img class="slot-avatar" src="${imgSrc}" onerror="this.style.display='none';">
          <div class="slot-bottom">
            <div class="slot-name">${escapeHtml(op.name)}</div>
            <div class="slot-trait-slip"><div class="slip-inner">${slipHtml}</div></div>
          </div>
        </div>`;
      }
      return `<div class="manual-slot is-empty ${stateCls}" ${dataAttrs}></div>`;
    };
    
    // ---- 单轮块 ----
    const buildRoundBlock = (roomKey, roundKey, label, isSecond) => {
      const slots = [0, 1, 2].map(i => buildSlot(roomKey, roundKey, i)).join('');
      const cls = isSecond ? 'manual-round-label round2' : 'manual-round-label';
      return `<div class="manual-round-block">
        <div class="${cls}">
          <span class="round-dot"></span>${label}
          <button class="round-stat-btn" data-room="${roomKey}" data-round="${roundKey}" title="查看本轮生效天赋">▾</button>
        </div>
        <div class="manual-slot-row">${slots}</div>
      </div>`;
    };
    
    const buildCultureDropdown = () => {
        const opts = PRODUCT_OPTIONS.culture;
        const c = roomProducts.culture || { products: [], priority: null };
        const sel = c.products || [];
        const priority = getEffectiveCulturePriority();
        const label = sel.length > 0
            ? priority.map(v => (opts.find(o => o.value === v) || {}).label || v).join('/')
            : '选择本舱需计算均产的素材';
    
        const items = opts.map(o => {
            const checked = sel.includes(o.value);
            const rank = priority.indexOf(o.value);
            const badgeStyle = checked ? '' : 'style="display:none;"';
            const arrowsStyle = checked ? '' : 'style="display:none;"';
            const badge = `<span class="prio-badge" ${badgeStyle}>${checked ? rank + 1 : ''}</span>`;
            const arrows = `<span class="prio-arrows" ${arrowsStyle} data-room="culture" data-value="${o.value}">
              <button class="prio-up" type="button" ${checked && rank === 0 ? 'disabled' : ''}>▲</button>
              <button class="prio-down" type="button" ${checked && rank === priority.length - 1 ? 'disabled' : ''}>▼</button>
            </span>`;
            return `<div class="product-dd-item ${checked ? 'checked' : ''}" data-value="${o.value}">
              <input type="checkbox" value="${o.value}" ${checked ? 'checked' : ''}>
              <span class="dd-label">${o.label}</span>
              ${badge}
              ${arrows}
            </div>`;
        }).join('');
    
        const hint = c.priority === null
            ? '未设置优先级时默认顺序：晶植 > 矿物 > 菌类'
            : '优先级 ① 最高的产物决定本舱时间安排';
    
        return `<div class="product-dropdown" data-room="culture">
          <button class="product-dropdown-btn" type="button">${escapeHtml(label)} <span class="dd-arrow">▾</span></button>
          <div class="product-dropdown-menu">
            <div class="product-dd-hint">${hint}</div>
            ${items}
          </div>
        </div>`;
    };
    
    // ---- 舱室头部：输出区 / 产品选择器 ----
    const buildOutputArea = (roomKey) => {
      const output = compute24hOutput(roomKey);
    
      // 总控
      if (output.isCentral) {
        return `<div class="room-output central-output">${escapeHtml(output.text)}</div>`;
      }
    
      const opts = PRODUCT_OPTIONS[roomKey];
    
      // 培养舱
      if (roomKey === 'culture') {
        if (output.needProduct) {
          return `<div class="room-product-picker">${buildCultureDropdown()}</div>`;
        }
        return `<div class="room-output-group">
          ${buildCultureDropdown()}
          <div class="room-output">24h均产${escapeHtml(output.text)}</div>
        </div>`;
      }
    
      // 制造舱
      if (opts) {
        const current = roomProducts[roomKey] || '';
        if (output.needProduct) {
          const optionHtml = opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
          return `<div class="room-product-picker">
            <select class="product-select" data-room="${roomKey}">
              <option value="">选择本舱需计算均产的素材</option>
              ${optionHtml}
            </select>
          </div>`;
        }
        const optionHtml = opts.map(o =>
          `<option value="${o.value}" ${o.value === current ? 'selected' : ''}>${o.label}</option>`
        ).join('');
        return `<div class="room-output-group">
          <select class="product-select inline" data-room="${roomKey}" title="切换素材">
            ${optionHtml}
          </select>
          <div class="room-output">24h均产${escapeHtml(output.text)}</div>
        </div>`;
      }
    
      // 会客室
      if (roomKey === 'meeting') {
        return `<div class="room-output">24h均产${escapeHtml(output.text)}</div>`;
      }
    
      return `<div class="room-output">24h均产${escapeHtml(output.text)}</div>`;
    };
    
    // ---- 单舱 ----
    const buildRoom = (roomKey) => {
      const isEditing = isRoomEditing(roomKey);
      const gearCls = isEditing ? 'room-gear-btn is-on' : 'room-gear-btn';
      const boxCls = isEditing ? 'manual-room-box is-editing' : 'manual-room-box is-viewing';
    
      const outputHtml = buildOutputArea(roomKey);
    
      let slotsHtml = '';
      if (isDouble) {
        slotsHtml =
          buildRoundBlock(roomKey, 'round1', '一轮', false) +
          buildRoundBlock(roomKey, 'round2', '二轮', true);
      } else {
        slotsHtml = buildRoundBlock(roomKey, 'round1', '一轮', false);
      }
    
      return `<div class="${boxCls}">
        <div class="manual-room-header">
          <span>${ROOM_LABELS[roomKey]}</span>
          <div class="room-header-right">
            ${outputHtml}
            <button class="${gearCls}" data-room="${roomKey}" title="${isEditing ? '关闭编辑' : '开启编辑'}">⚙️</button>
          </div>
        </div>
        ${slotsHtml}
      </div>`;
    };
    
    let html = '';
    if (isMobile) {
      html = ROOM_KEYS.map(k => buildRoom(k)).join('');
    } else {
      const top = ['central', 'manufactA', 'manufactB'].map(k => buildRoom(k)).join('');
      const bottom = ['culture', 'meeting'].map(k => buildRoom(k)).join('');
      html = `<div class="manual-room-row">${top}</div><div class="manual-room-row">${bottom}</div>`;
    }
    container.innerHTML = html;
    
    // ---- 事件绑定 ----
    // 齿轮
    container.querySelectorAll('.room-gear-btn').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleRoomEdit(this.dataset.room);
      });
    });
    
    // 产品选择（select）
    container.querySelectorAll('.product-select').forEach(sel => {
      sel.addEventListener('click', e => e.stopPropagation());
      sel.addEventListener('change', function () {
        setRoomProduct(this.dataset.room, this.value);
      });
    });
    
    // 培养舱多选下拉
    container.querySelectorAll('.product-dropdown').forEach(dd => {
      const btn = dd.querySelector('.product-dropdown-btn');
      const menu = dd.querySelector('.product-dropdown-menu');
      btn.addEventListener('click', e => {
        e.stopPropagation();
        document.querySelectorAll('.product-dropdown-menu.open').forEach(m => {
          if (m !== menu) m.classList.remove('open');
        });
        menu.classList.toggle('open');
      });
    menu.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', function () {
            const val = this.value;
            const c = roomProducts.culture || { products: [], priority: null };
            let newProducts;
            if (this.checked) {
                newProducts = c.products.includes(val) ? c.products.slice() : [...c.products, val];
            } else {
                newProducts = c.products.filter(p => p !== val);
            }
            let newPriority = c.priority;
            if (Array.isArray(newPriority)) {
                newPriority = newPriority.filter(p => newProducts.includes(p));
                if (newPriority.length === 0) newPriority = null;
            }
            // ★ 静默更新，不关闭菜单
            setRoomProduct('culture', { products: newProducts, priority: newPriority }, { silent: true });
        });
    });
      menu.addEventListener('click', e => e.stopPropagation());
    });
    // 全局关闭下拉
    if (!window._productDropdownGlobalBound) {
      window._productDropdownGlobalBound = true;
      document.addEventListener('click', () => {
        document.querySelectorAll('.product-dropdown-menu.open').forEach(m => m.classList.remove('open'));
      });
    }
    
    // 培养舱优先级调整
    container.querySelectorAll('.prio-up, .prio-down').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const val = this.closest('.prio-arrows').dataset.value;
            const currentOrder = getEffectiveCulturePriority();
            const idx = currentOrder.indexOf(val);
            if (idx < 0) return;
            const newOrder = currentOrder.slice();
            if (this.classList.contains('prio-up') && idx > 0) {
                [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
            } else if (this.classList.contains('prio-down') && idx < newOrder.length - 1) {
                [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
            } else {
                return;
            }
            const c = roomProducts.culture || { products: [], priority: null };
            // ★ 静默更新
            setRoomProduct('culture', { products: c.products, priority: newOrder }, { silent: true });
        });
    });
    
    // 槽位点击（仅编辑态可点）
    container.querySelectorAll('.manual-slot').forEach(el => {
      el.addEventListener('click', function (e) {
        if (e.target.classList.contains('slot-remove')) return;
        const roomKey = this.dataset.room;
        if (!isRoomEditing(roomKey)) return;
        openPicker(roomKey, this.dataset.round, parseInt(this.dataset.index, 10));
      });
    });
    
    // 移除按钮
    container.querySelectorAll('.slot-remove').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const roomKey = this.dataset.room;
        if (!isRoomEditing(roomKey)) return;
        manualSchedule.rooms[roomKey][this.dataset.round][parseInt(this.dataset.index, 10)] = null;
        saveManualSchedule();
        renderManualSchedule();
      });
    });
    
    // 每轮统计
    container.querySelectorAll('.round-stat-btn').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        showRoundStatPopup(this, this.dataset.room, this.dataset.round);
      });
    });
    }
    
    // ---------- 每轮统计悬浮窗 ----------
    let activeStatPopup = null;
    function showRoundStatPopup(anchor, roomKey, roundKey) {
    closeStatPopup();
    const html = buildRoundStatHtml(roomKey, roundKey);
    const popup = document.createElement('div');
    popup.className = 'round-stat-popup-wrap';
    popup.innerHTML = html;
    document.body.appendChild(popup);
    activeStatPopup = popup;
    
    const rect = anchor.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.top = (rect.bottom + 6) + 'px';
    popup.style.left = rect.left + 'px';
    popup.style.zIndex = '10000';
    const w = popup.offsetWidth || 240;
    if (rect.left + w > window.innerWidth - 8) {
      popup.style.left = (window.innerWidth - w - 8) + 'px';
    }
    setTimeout(() => {
      document.addEventListener('click', closeStatPopup, { once: true });
    }, 0);
    }
    function closeStatPopup() {
    if (activeStatPopup) { activeStatPopup.remove(); activeStatPopup = null; }
    }
    
    // ---------- 干员选择弹窗 ----------
    function openPicker(roomKey, roundKey, slotIndex) {
    pickerContext = { roomKey, roundKey, slotIndex };
    const overlay = document.getElementById('pickerOverlay');
    if (!overlay) return;
    
    const roundLabel = roundKey === 'round1' ? '一轮' : '二轮';
    document.getElementById('pickerTitle').textContent =
      `选择干员 · ${ROOM_LABELS[roomKey]} ${roundLabel} 槽位 ${slotIndex + 1}`;
    
    const roomFilter = document.getElementById('pickerRoomFilter');
    const targetRaw = ROOM_RAW[roomKey];
    if (['总控中枢', '制造舱', '培养舱', '会客室'].includes(targetRaw)) {
      roomFilter.value = targetRaw;
    } else {
      roomFilter.value = 'all';
    }
    
    const clearBtn = document.getElementById('pickerClearBtn');
    const currentName = manualSchedule.rooms[roomKey][roundKey][slotIndex];
    clearBtn.disabled = !currentName;
    
    renderPickerGrid();
    overlay.classList.add('open');
    }
    
    function closePicker() {
    const overlay = document.getElementById('pickerOverlay');
    if (overlay) overlay.classList.remove('open');
    pickerContext = null;
    }
    
    function collectAllScheduledNames() {
    const set = new Set();
    for (const rk of ROOM_KEYS) {
      for (const rnd of ROUND_KEYS) {
        for (const name of manualSchedule.rooms[rk][rnd]) {
          if (name) set.add(name);
        }
      }
    }
    return set;
    }
    
    function getPickerFilteredOperators() {
    const star = document.getElementById('pickerStarFilter').value;
    const attr = document.getElementById('pickerAttributeFilter').value;
    const roomFilter = document.getElementById('pickerRoomFilter').value;
    
    return operators.filter(op => {
      if (op.eliteLevel === 'none') return false;
      if (star !== 'all' && op.star !== star) return false;
      if (attr !== 'all' && op.attribute !== attr) return false;
      if (roomFilter !== 'all') {
        const traits = getGroupedTraits(op);
        if (!traits.some(t => t.舱室 === roomFilter)) return false;
      }
      return true;
    });
    }
    
    function renderPickerGrid() {
    const grid = document.getElementById('pickerGrid');
    if (!grid || !pickerContext) return;
    
    const list = getPickerFilteredOperators();
    const targetRaw = ROOM_RAW[pickerContext.roomKey];
    const currentName = manualSchedule.rooms[pickerContext.roomKey][pickerContext.roundKey][pickerContext.slotIndex];
    const scheduledSet = collectAllScheduledNames();
    
    const scored = list.map(op => {
      const traits = getGroupedTraits(op);
      const relevant = traits.filter(t => t.舱室 === targetRaw);
      let score = 0;
      for (const t of relevant) score += (t.数值 || 0);
      return { op, relevant, score };
    }).sort((a, b) => b.score - a.score);
    
    if (scored.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:#888;padding:30px 0;">
        没有符合条件的干员，请调整筛选条件或先在干员库中导入数据。
      </div>`;
      return;
    }
    
    grid.innerHTML = scored.map(({ op }) => {
      const imgSrc = getAgentImgSrc(op.name);
      const isSelected = op.name === currentName;
      const isScheduled = scheduledSet.has(op.name) && !isSelected;
    
      const grouped = getGroupedTraits(op);
    
      let tooltipHtml = '';
      if (grouped.length === 0) {
        tooltipHtml = `<div class="tooltip-empty">无天赋</div>`;
      } else {
        tooltipHtml = grouped.map(t => {
          const isMatch = t.舱室 === targetRaw;
          const cls = isMatch ? 'tooltip-line match' : 'tooltip-line';
          const iconPath = getTalentIconPath([t]);
          const iconTag = iconPath
            ? `<img class="tooltip-icon" src="${iconPath}" onerror="this.style.display='none';" alt="">`
            : '';
          const tName = t.name || t.类型;
          const tEffect = formatShortTrait(t);
          return `<div class="${cls}">
            ${iconTag}<span class="tooltip-name">${escapeHtml(tName)}</span>
            <span class="tooltip-sep">|</span>
            <span class="tooltip-arrow">▶</span>
            <span class="tooltip-effect">${escapeHtml(tEffect)}</span>
          </div>`;
        }).join('');
      }
    
      const clsList = ['picker-card'];
      if (isSelected) clsList.push('is-selected');
      if (isScheduled) clsList.push('is-scheduled');
    
      return `<div class="${clsList.join(' ')}" data-name="${escapeHtml(op.name)}">
        <div class="picker-elite">${escapeHtml(op.eliteLevel)}</div>
        ${isScheduled ? `<div class="picker-scheduled-tag">已排</div>` : ''}
        <img class="picker-avatar" src="${imgSrc}" onerror="this.style.display='none';">
        <div class="picker-name">${escapeHtml(op.name)}</div>
        <div class="picker-tooltip">
          <div class="tooltip-title">${escapeHtml(op.name)} · ${escapeHtml(op.eliteLevel)} · ${escapeHtml(op.star)}</div>
          ${tooltipHtml}
        </div>
      </div>`;
    }).join('');
    
    grid.querySelectorAll('.picker-card').forEach(card => {
      const tooltip = card.querySelector('.picker-tooltip');
      card.addEventListener('click', function () {
        const name = this.dataset.name;
        assignOperator(pickerContext.roomKey, pickerContext.roundKey, pickerContext.slotIndex, name);
        saveManualSchedule();
        renderManualSchedule();
        closePicker();
      });
      card.addEventListener('mouseenter', function () {
        positionTooltip(card, tooltip);
      });
    });
    }
    
    // ---------- 从自动排班导入 ----------
    function importFromAuto() {
    let queues = null;
    let doubleRooms = [];
    try {
      const rawQ = sessionStorage.getItem('DijiangLastQueues');
      const rawD = sessionStorage.getItem('DijiangDoubleRooms');
      if (rawQ) queues = JSON.parse(rawQ);
      if (rawD) doubleRooms = JSON.parse(rawD) || [];
      if (!Array.isArray(doubleRooms)) doubleRooms = [];
    } catch (e) {}
    
    if (!queues) {
      alert('未找到自动排班的排班结果。\n\n请先访问自动排班页，设置好策略并生成排班，再回到本页点击"从自动排班导入"。');
      return;
    }
    
    const useDouble = doubleRooms.length > 0;
    const doubleSet = new Set(doubleRooms);
    const newRooms = emptyRooms();
    
    for (const rk of ROOM_KEYS) {
      const q = queues[rk];
      if (!q) continue;
    
      if (useDouble) {
        if (doubleSet.has(rk)) {
          const r1 = Array.isArray(q.round1) ? q.round1 : [];
          const r2 = Array.isArray(q.round2) ? q.round2 : [];
          newRooms[rk].round1 = [0, 1, 2].map(i => (r1[i] && r1[i].name) || null);
          newRooms[rk].round2 = [0, 1, 2].map(i => (r2[i] && r2[i].name) || null);
        } else {
          const rec = Array.isArray(q.recommend) ? q.recommend : [];
          newRooms[rk].round1 = [0, 1, 2].map(i => (rec[i] && rec[i].name) || null);
          newRooms[rk].round2 = [null, null, null];
        }
      } else {
        const rec = Array.isArray(q.recommend) ? q.recommend : [];
        newRooms[rk].round1 = [0, 1, 2].map(i => (rec[i] && rec[i].name) || null);
        newRooms[rk].round2 = [null, null, null];
      }
    }
    
    // 一轮内去重
    const seenRound1 = new Set();
    for (const rk of ROOM_KEYS) {
      for (let i = 0; i < 3; i++) {
        const n = newRooms[rk].round1[i];
        if (!n) continue;
        if (seenRound1.has(n)) newRooms[rk].round1[i] = null;
        else seenRound1.add(n);
      }
    }
    // 二轮内去重，同时排除一轮已使用
    const seenRound2 = new Set();
    for (const rk of ROOM_KEYS) {
      for (let i = 0; i < 3; i++) {
        const n = newRooms[rk].round2[i];
        if (!n) continue;
        if (seenRound2.has(n) || seenRound1.has(n)) newRooms[rk].round2[i] = null;
        else seenRound2.add(n);
      }
    }
    
    manualSchedule.rooms = newRooms;
    manualSchedule.mode = useDouble ? 'double' : 'single';
    saveManualSchedule();
    
    // ★ 从自动排班导入产品配置
    try {
      const prodRaw = sessionStorage.getItem('DijiangDefaultProduct');
      if (prodRaw) {
        const prod = JSON.parse(prodRaw);
        if (prod.manufactA) roomProducts.manufactA = prod.manufactA;
        if (prod.manufactB) roomProducts.manufactB = prod.manufactB;
        if (prod.culture) {
          const c = prod.culture;
          let order = [];
          if (c && typeof c === 'object' && !Array.isArray(c)) {
            const products = Array.isArray(c.products) ? c.products : [];
            if (Array.isArray(c.priority) && c.priority.length > 0) {
              order = c.priority.filter(x => products.includes(x));
              for (const x of products) if (!order.includes(x)) order.push(x);
            } else {
              for (const x of DEFAULT_CULTURE_PRIORITY) if (products.includes(x)) order.push(x);
              for (const x of products) if (!order.includes(x)) order.push(x);
            }
          } else if (Array.isArray(c)) {
            order = c.slice();
          } else if (typeof c === 'string') {
            order = [c];
          }
          roomProducts.culture = { products: order, priority: null };
        }
        saveRoomProducts();
      }
    } catch (e) {}
    
    updateRoundModeLabel();
    renderManualSchedule();
    
    const label = useDouble ? '二轮' : '单轮';
    const onlyFirstRoundCount = ROOM_KEYS.filter(k => useDouble && !doubleSet.has(k)).length;
    
    if (typeof window.DijiangPetSay === 'function') {
      let msg = `管理员，已从自动排班导入（${label}）`;
      if (useDouble && onlyFirstRoundCount > 0) {
        msg += `，其中 ${onlyFirstRoundCount} 个单轮舱室已填入一轮`;
      }
      window.DijiangPetSay(msg);
    } else {
      let msg = `已从自动排班导入（${label}）。`;
      if (useDouble && onlyFirstRoundCount > 0) {
        msg += `\n\n检测到 ${doubleRooms.length} 个二轮舱室，已自动切换到二轮模式。\n其中 ${onlyFirstRoundCount} 个单轮舱室的数据已填入「一轮」。`;
      }
      alert(msg);
    }
    }
    
    // ---------- 单/二轮切换 ----------
    function toggleRoundMode() {
    if (manualSchedule.mode === 'single') {
      let hasAnyRound2 = false;
      for (const rk of ROOM_KEYS) {
        if (manualSchedule.rooms[rk].round2.some(n => n)) { hasAnyRound2 = true; break; }
      }
      if (!hasAnyRound2) {
        const ok = confirm('切换到二轮排班：\n\n• 一轮数据保留\n• 二轮目前为空，可手动填入\n• 也可以点「从自动排班导入」自动填充两轮\n\n是否继续？');
        if (!ok) return;
      }
      manualSchedule.mode = 'double';
    } else {
      manualSchedule.mode = 'single';
    }
    saveManualSchedule();
    updateRoundModeLabel();
    renderManualSchedule();
    }
    
    function updateRoundModeLabel() {
    const label = document.getElementById('roundModeLabel');
    if (!label) return;
    label.textContent = manualSchedule.mode === 'double' ? '二轮排班' : '单轮排班';
    const btn = document.getElementById('toggleRoundBtn');
    if (btn) btn.classList.toggle('is-double', manualSchedule.mode === 'double');
    }
    
    // ---------- 工具栏 ----------
    function bindToolbar() {
    const importBtn = document.getElementById('importFromAutoBtn');
    if (importBtn) importBtn.addEventListener('click', importFromAuto);
    
    const clearBtn = document.getElementById('clearManualBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (!confirm('确定清空所有槽位吗？（包括一轮和二轮）')) return;
        manualSchedule.rooms = emptyRooms();
        saveManualSchedule();
        renderManualSchedule();
      });
    }
    
    const toggleBtn = document.getElementById('toggleRoundBtn');
    if (toggleBtn) toggleBtn.addEventListener('click', toggleRoundMode);
    
    const opBtn = document.getElementById('openOperatorPanelBtn');
    if (opBtn) {
      opBtn.addEventListener('click', function () {
        window.location.href = '/agentpackage/';
      });
    }
    const opPanel = document.getElementById('operatorPanelOverlay');
    if (opBtn && opPanel) {
      opBtn.addEventListener('click', function () {
        renderOperatorStatus();
        opPanel.classList.add('open');
      });
      document.getElementById('operatorPanelCloseBtn').addEventListener('click', () => opPanel.classList.remove('open'));
      opPanel.addEventListener('click', e => { if (e.target === opPanel) opPanel.classList.remove('open'); });
    }
    
    const dsBtn = document.getElementById('dataSettingsBtn');
    if (dsBtn) {
      dsBtn.addEventListener('click', function () {
        if (confirm('干员数据设置仅在自动排班页可用。\n\n是否前往自动排班页进行导入或配置？')) {
          window.location.href = '/';
        }
      });
    }
    
    const stepBtn = document.getElementById('openStepSimBtn');
    if (stepBtn) {
      stepBtn.addEventListener('click', () => {
        window.location.href = '/manual/step/';
      });
    }
    
    document.getElementById('pickerCloseBtn').addEventListener('click', closePicker);
    document.getElementById('pickerOverlay').addEventListener('click', e => {
      if (e.target === document.getElementById('pickerOverlay')) closePicker();
    });
    ['pickerStarFilter', 'pickerAttributeFilter', 'pickerRoomFilter'].forEach(id => {
      document.getElementById(id).addEventListener('change', renderPickerGrid);
    });
    document.getElementById('pickerClearBtn').addEventListener('click', function () {
      if (!pickerContext) return;
      manualSchedule.rooms[pickerContext.roomKey][pickerContext.roundKey][pickerContext.slotIndex] = null;
      saveManualSchedule();
      renderManualSchedule();
      closePicker();
    });
    
    ['eliteFilter', 'starFilter', 'attributeFilter'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', renderOperatorStatus);
    });
    }
    
    // ---------- 干员库面板 ----------
    function renderOperatorStatus() {
    const container = document.getElementById('operatorStatusContainer');
    if (!container) return;
    const eliteFilter = document.getElementById('eliteFilter')?.value || 'all';
    const starFilter = document.getElementById('starFilter')?.value || 'all';
    const attrFilter = document.getElementById('attributeFilter')?.value || 'all';
    
    const filtered = operators.filter(op => {
      if (eliteFilter !== 'all' && op.eliteLevel !== eliteFilter) return false;
      if (starFilter !== 'all' && op.star !== starFilter) return false;
      if (attrFilter !== 'all' && op.attribute !== attrFilter) return false;
      return true;
    });
    
    container.innerHTML = filtered.map(op => {
      const imgSrc = getAgentImgSrc(op.name);
      const activeCount = TALENT_ORDER.filter(tid => op.activatedTalents[tid]).length;
      const talentBadge = (op.eliteLevel !== 'none' && op.eliteLevel !== '精零')
        ? `<span class="badge" style="background:#e0f0ea; color:#2a5a4a;">天赋 ${activeCount}/4</span>` : '';
      const levelText = op.eliteLevel === 'none' ? '未拥有' : op.eliteLevel;
      return `<div class="status-item" data-name="${escapeHtml(op.name)}">
        <div class="status-item-left">
          <img class="agent-avatar-small" src="${imgSrc}" onerror="this.style.display='none';">
          <span>${escapeHtml(op.name)}</span>
        </div>
        ${talentBadge}
        <span class="badge">${levelText}</span>
      </div>`;
    }).join('') || '<div style="text-align:center;color:#888;">暂无干员数据</div>';
    
    container.querySelectorAll('.status-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = item.dataset.name;
        const op = operators.find(o => o.name === name);
        if (op) openSingleEdit(op);
      });
    });
    
    const clearCfgBtn = document.getElementById('clearConfigBtn');
    if (clearCfgBtn) {
      clearCfgBtn.addEventListener('click', function () {
        if (!confirm('确定要清空所有干员的配置吗？此操作不可撤销。')) return;
        for (const op of operators) {
          op.eliteLevel = 'none';
          op.activatedTalents = emptyTalents();
        }
        saveOperatorConfig();
        renderOperatorStatus();
        renderManualSchedule();
        updateOperatorCountBadge();
        alert('已清空全部干员配置。');
      });
    }
    
    const showTalentBtn = document.getElementById('showTalentBtn');
    if (showTalentBtn) {
      showTalentBtn.addEventListener('click', function () {
        alert('干员天赋一览请到主站查看（自动排班页 → 左侧菜单）。');
      });
    }
    }
    
    // ---------- 单干员编辑弹窗 ----------
    let singleEditModal = null;
    function openSingleEdit(op) {
    if (singleEditModal) singleEditModal.remove();
    
    const ELITE_LABEL = ['未拥有', '精零', '精一', '精二', '精三', '精四'];
    let tempLevel = op.eliteLevel;
    let tempTalents = { ...op.activatedTalents };
    
    function canActivate(tid) {
      const meta = { '1_1': { minElite: 2, prereq: null }, '2_1': { minElite: 3, prereq: null },
                     '1_2': { minElite: 4, prereq: '1_1' }, '2_2': { minElite: 5, prereq: '2_1' } }[tid];
      if (!meta) return false;
      if (ELITE_RANK[tempLevel] < meta.minElite) return false;
      return true;
    }
    function sanitizeTemp() {
      for (const tid of TALENT_ORDER) {
        if (tempTalents[tid] && !canActivate(tid)) {
          tempTalents[tid] = false;
          if (tid === '1_1') tempTalents['1_2'] = false;
          if (tid === '2_1') tempTalents['2_2'] = false;
        }
      }
      if (tempTalents['1_2']) tempTalents['1_1'] = true;
      if (tempTalents['2_2']) tempTalents['2_1'] = true;
    }
    
    const imgSrc = getAgentImgSrc(op.name);
    
    singleEditModal = document.createElement('div');
    singleEditModal.className = 'modal';
    singleEditModal.innerHTML = `
      <div class="modal-content">
        <button class="close-modal" id="singleCloseBtn">×</button>
        <div class="modal-header">✏️ 修改 ${escapeHtml(op.name)}</div>
        <div class="agent-avatar" id="singleAvatar"></div>
        <div class="edit-section-title">精英化等级</div>
        <div class="elite-buttons" id="row1">
          <div data-level="none" class="elite-btn ${tempLevel === 'none' ? 'selected' : ''}">❌ 未拥有</div>
          <div data-level="精零" class="elite-btn ${tempLevel === '精零' ? 'selected' : ''}">精零</div>
        </div>
        <div class="elite-buttons" id="row2">
          <div data-level="精一" class="elite-btn ${tempLevel === '精一' ? 'selected' : ''}">精一</div>
          <div data-level="精二" class="elite-btn ${tempLevel === '精二' ? 'selected' : ''}">精二</div>
          <div data-level="精三" class="elite-btn ${tempLevel === '精三' ? 'selected' : ''}">精三</div>
          <div data-level="精四" class="elite-btn ${tempLevel === '精四' ? 'selected' : ''}">精四</div>
        </div>
        <div class="edit-section-title">舱室天赋（点击切换激活）</div>
        <div id="talentListContainer"></div>
        <div class="modal-nav">
          <button id="singleCancelBtn">取消</button>
          <button id="singleConfirmBtn">确认修改</button>
        </div>
      </div>
    `;
    document.body.appendChild(singleEditModal);
    
    const avatarDiv = singleEditModal.querySelector('#singleAvatar');
    const img = new Image();
    img.onload = function () {
      avatarDiv.style.backgroundImage = `url(${imgSrc})`;
      avatarDiv.style.backgroundSize = 'cover';
      avatarDiv.style.backgroundPosition = 'center';
    };
    img.onerror = function () {
      avatarDiv.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#f0f0f0;color:#888;font-size:0.7rem;">无图</div>';
    };
    img.src = imgSrc;
    
    function renderTalentList() {
      const container = singleEditModal.querySelector('#talentListContainer');
      const raw = rawOperatorsData[op.name] || {};
      container.innerHTML = TALENT_ORDER.map(tid => {
        const traits = getTalentList(raw, tid);
        const activated = tempTalents[tid];
        const canAct = canActivate(tid);
        let state = 'off';
        if (activated) state = 'on';
        else if (!canAct) state = 'locked';
    
        const displayName = (traits.length > 0 && traits[0].name) ? traits[0].name : tid;
        let effectText = traits.length > 0 ? traits.map(t => formatShortTrait(t)).join('；') : '（暂无天赋数据）';
    
        const meta = { '1_1': 2, '2_1': 3, '1_2': 4, '2_2': 5 }[tid];
        let lockMsg = '';
        if (state === 'locked') lockMsg = `需 ${ELITE_LABEL[meta]}`;
    
        const iconPath = getTalentIconPath(traits);
        const iconTag = iconPath ? `<img src="${iconPath}" onerror="this.style.display='none';" alt="">` : '';
        const checkMark = state === 'on' ? '☑' : (state === 'off' ? '☐' : '🔒');
    
        return `<div class="talent-row" data-tid="${tid}" data-state="${state}">
          <div class="talent-icon" data-state="${state}" data-tid="${tid}">${iconTag}</div>
          <div class="talent-info">
            <div class="talent-id">${escapeHtml(displayName)}</div>
            <div class="talent-effect">${escapeHtml(effectText)}</div>
            ${lockMsg ? `<div class="talent-lock-msg">🔒 ${lockMsg}</div>` : ''}
          </div>
          <div class="talent-check">${checkMark}</div>
        </div>`;
      }).join('');
    
      container.querySelectorAll('.talent-row').forEach(row => {
        row.addEventListener('click', function () {
          const tid = this.dataset.tid;
          const isOn = tempTalents[tid];
          const canAct = canActivate(tid);
          if (isOn) {
            tempTalents[tid] = false;
            if (tid === '1_1') tempTalents['1_2'] = false;
            if (tid === '2_1') tempTalents['2_2'] = false;
          } else {
            if (!canAct) return;
            tempTalents[tid] = true;
            if (tid === '1_2') tempTalents['1_1'] = true;
            if (tid === '2_2') tempTalents['2_1'] = true;
          }
          sanitizeTemp();
          renderTalentList();
        });
      });
    }
    
    singleEditModal.querySelectorAll('.elite-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        tempLevel = btn.dataset.level;
        sanitizeTemp();
        singleEditModal.querySelectorAll('.elite-btn').forEach(b => {
          b.classList.toggle('selected', b.dataset.level === tempLevel);
        });
        renderTalentList();
      });
    });
    
    renderTalentList();
    
    singleEditModal.querySelector('#singleConfirmBtn').addEventListener('click', () => {
      op.eliteLevel = tempLevel;
      op.activatedTalents = { ...tempTalents };
      saveOperatorConfig();
      renderOperatorStatus();
      renderManualSchedule();
      updateOperatorCountBadge();
      singleEditModal.remove();
      singleEditModal = null;
    });
    singleEditModal.querySelector('#singleCancelBtn').addEventListener('click', () => {
      singleEditModal.remove();
      singleEditModal = null;
    });
    singleEditModal.querySelector('#singleCloseBtn').addEventListener('click', () => {
      singleEditModal.remove();
      singleEditModal = null;
    });
    }
    
    function saveOperatorConfig() {
    const config = {};
    for (const op of operators) {
      config[op.name] = {
        elite: op.eliteLevel,
        talents: TALENT_ORDER.filter(tid => op.activatedTalents[tid]),
      };
    }
    try { sessionStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config)); } catch (e) {}
    }
    
    function updateOperatorCountBadge() {
    const badge = document.getElementById('operatorCountBadge');
    if (!badge) return;
    badge.textContent = operators.filter(op => op.eliteLevel !== 'none').length;
    }
    
    // ---------- 导出排班图 ----------
    window.DijiangExportSchedule = async function () {
    const container = document.getElementById('manualSchedule');
    if (!container || container.children.length === 0) {
      alert('暂无可导出的排班');
      return;
    }
    
    const exportContainer = document.createElement('div');
    exportContainer.style.cssText = 'position:fixed;left:-9999px;top:0;width:900px;background:#fff;padding:24px;font-family:system-ui;color:#222;';
    document.body.appendChild(exportContainer);
    
    const now = new Date();
    const dateStr = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0');
    
    const isDouble = manualSchedule.mode === 'double';
    exportContainer.innerHTML = `
      <div style="text-align:center;font-size:26px;font-weight:700;margin-bottom:6px;">帝江号手动排班表${isDouble ? '（二轮）' : ''}</div>
      <div style="text-align:center;font-size:12px;color:#666;margin-bottom:18px;">生成时间 ${dateStr}</div>
      <div id="manualExportGrid" style="display:flex;flex-direction:column;gap:14px;"></div>
      <div style="margin-top:20px;border-top:1px solid #ddd;padding-top:12px;font-size:11px;color:#888;text-align:center;">
        https://arr-dijiang.top/manual/ · 帝江号排班系统
      </div>
    `;
    
    const gridEl = exportContainer.querySelector('#manualExportGrid');
    
    const allNames = new Set();
    for (const rk of ROOM_KEYS) {
      for (const rnd of ROUND_KEYS) {
        for (const n of manualSchedule.rooms[rk][rnd]) if (n) allNames.add(n);
      }
    }
    const dataUrlMap = {};
    await Promise.all([...allNames].map(async name => {
      let url = getSpriteDataUrl(name);
      if (!url) {
        try {
          const res = await fetch(`/Agent/${encodeURIComponent(name)}.webp`);
          if (res.ok) {
            const blob = await res.blob();
            url = await new Promise((resolve) => {
              const r = new FileReader();
              r.onloadend = () => resolve(r.result);
              r.readAsDataURL(blob);
            });
          }
        } catch (e) {}
      }
      if (url) dataUrlMap[name] = url;
    }));
    
    const buildAvatar = (name) => {
      if (!name) {
        return `<div style="width:70px;height:70px;border-radius:10px;background:#f4f6f8;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:10px;">空位</div>`;
      }
      const img = dataUrlMap[name];
      const imgTag = img ? `<img src="${img}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">` : '';
      return `<div style="position:relative;width:70px;height:70px;border-radius:10px;overflow:hidden;border:1px solid #ddd;background:#eef2f6;">
        ${imgTag}
        <div style="position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);color:#fff;font-size:10px;text-align:center;padding:2px 0;">${escapeHtml(name)}</div>
      </div>`;
    };
    
    const buildRoundRow = (roomKey, roundKey) => {
      const slots = manualSchedule.rooms[roomKey][roundKey];
      return `<div style="display:flex;justify-content:center;gap:12px;">${[0, 1, 2].map(i => buildAvatar(slots[i])).join('')}</div>`;
    };
    
    const buildExportRoom = (roomKey) => {
      const output = compute24hOutput(roomKey);
      let outputText = '';
      if (output.isCentral) {
        outputText = `<div style="font-size:11px;color:#8a6d3b;margin-bottom:6px;text-align:center;">${escapeHtml(output.text)}</div>`;
      } else if (output.needProduct) {
        outputText = `<div style="font-size:11px;color:#999;margin-bottom:6px;text-align:center;">未选择素材</div>`;
      } else {
        outputText = `<div style="font-size:11px;color:#3f7e6b;margin-bottom:6px;text-align:center;">24h均产${escapeHtml(output.text)}</div>`;
      }
    
      if (isDouble) {
        return `<div style="border:1px solid #e0e0e0;border-radius:12px;padding:12px;background:#fafafa;">
          <div style="font-weight:600;font-size:14px;margin-bottom:10px;text-align:center;">${ROOM_LABELS[roomKey]}</div>
          ${outputText}
          <div style="font-size:11px;color:#666;margin-bottom:4px;">一轮</div>
          ${buildRoundRow(roomKey, 'round1')}
          <div style="font-size:11px;color:#666;margin-top:10px;margin-bottom:4px;">二轮</div>
          ${buildRoundRow(roomKey, 'round2')}
        </div>`;
      }
      return `<div style="border:1px solid #e0e0e0;border-radius:12px;padding:12px;background:#fafafa;">
        <div style="font-weight:600;font-size:14px;margin-bottom:10px;text-align:center;">${ROOM_LABELS[roomKey]}</div>
        ${outputText}
        ${buildRoundRow(roomKey, 'round1')}
      </div>`;
    };
    
    const topRow = ['central', 'manufactA', 'manufactB'];
    const bottomRow = ['culture', 'meeting'];
    let rowsHtml = `<div style="display:flex;gap:14px;justify-content:center;">${topRow.map(buildExportRoom).join('')}</div>`;
    rowsHtml += `<div style="display:flex;gap:14px;justify-content:center;">${bottomRow.map(buildExportRoom).join('')}</div>`;
    gridEl.innerHTML = rowsHtml;
    
    try {
      const canvas = await html2canvas(exportContainer, {
        scale: 2, useCORS: true, backgroundColor: '#ffffff',
        width: 900, height: exportContainer.scrollHeight,
      });
      const link = document.createElement('a');
      link.download = `手动排班_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${isDouble ? '_双轮' : ''}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      document.body.removeChild(exportContainer);
    } catch (err) {
      alert('导出失败：' + err.message);
      document.body.removeChild(exportContainer);
    }
    };
    
    // ---------- 启动 ----------
    async function init() {
    await loadSprite();
    
    const res = await fetch('/Agent_characteristics.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rawOperatorsData = await res.json();
    if (!rawOperatorsData || Object.keys(rawOperatorsData).length === 0) throw new Error('JSON 为空');
    
    initOperators();
    loadManualSchedule();
    loadEditingState();
    loadRoomProducts();
    updateRoundModeLabel();
    renderManualSchedule();
    bindToolbar();
    renderOperatorStatus();
    updateOperatorCountBadge();
    
    console.log('[手动页] 初始化完成');
    }
    
    // ---------- 反馈模块 ----------
    (function () {
    const modal = document.getElementById('feedbackModal');
    const closeBtn = document.getElementById('feedbackCloseBtn');
    const cancelBtn = document.getElementById('feedbackCancelBtn');
    const submitBtn = document.getElementById('feedbackSubmitBtn');
    const textarea = document.getElementById('feedbackText');
    const fileInput = document.getElementById('feedbackFileInput');
    const fileArea = document.getElementById('feedbackFileArea');
    const fileList = document.getElementById('feedbackFileList');
    const totalSizeSpan = document.getElementById('feedbackTotalSize');
    const statusDiv = document.getElementById('feedbackStatus');
    if (!modal) return;
    
    let selectedFiles = [], totalSize = 0;
    
    function openFeedback() {
      modal.classList.add('open');
      textarea.value = '';
      selectedFiles = [];
      totalSize = 0;
      updateFileList();
      updateTotalSize();
      statusDiv.className = 'feedback-status';
      statusDiv.style.display = 'none';
    }
    function closeFeedback() { modal.classList.remove('open'); }
    
    function updateFileList() {
      fileList.innerHTML = '';
      selectedFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'feedback-file-item';
        item.innerHTML = `<span>${escapeHtml(file.name)} (${(file.size / 1024).toFixed(1)} KB)</span><span class="remove-file" data-index="${index}">×</span>`;
        fileList.appendChild(item);
      });
      fileList.querySelectorAll('.remove-file').forEach(el => {
        el.addEventListener('click', function () {
          const idx = parseInt(this.dataset.index, 10);
          totalSize -= selectedFiles[idx].size;
          selectedFiles.splice(idx, 1);
          updateFileList();
          updateTotalSize();
        });
      });
    }
    function updateTotalSize() {
      totalSizeSpan.textContent = (totalSize / 1024).toFixed(1);
    }
    function addFiles(newFiles) {
      for (const f of newFiles) {
        if (!f.type.startsWith('image/')) { showStatus('仅支持图片文件', 'error'); continue; }
        if (totalSize + f.size > 5 * 1024 * 1024) { showStatus('超过5M上限', 'error'); continue; }
        selectedFiles.push(f);
        totalSize += f.size;
      }
      updateFileList();
      updateTotalSize();
    }
    function showStatus(msg, type) {
      statusDiv.textContent = msg;
      statusDiv.className = 'feedback-status ' + type;
      statusDiv.style.display = 'block';
    }
    
    window.DijiangOpenFeedback = openFeedback;
    
    closeBtn.addEventListener('click', closeFeedback);
    cancelBtn.addEventListener('click', closeFeedback);
    modal.addEventListener('click', e => { if (e.target === modal) closeFeedback(); });
    fileArea.addEventListener('click', () => fileInput.click());
    fileArea.addEventListener('dragover', e => { e.preventDefault(); fileArea.style.borderColor = '#3f7e6b'; });
    fileArea.addEventListener('dragleave', e => { e.preventDefault(); fileArea.style.borderColor = '#d0d7de'; });
    fileArea.addEventListener('drop', e => {
      e.preventDefault();
      fileArea.style.borderColor = '#d0d7de';
      addFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', function () {
      if (this.files.length) { addFiles(this.files); this.value = ''; }
    });
    
    submitBtn.addEventListener('click', function () {
      const text = textarea.value.trim();
      if (!text) { showStatus('请输入反馈内容', 'error'); return; }
    
      const formData = new FormData();
      formData.append('text', text);
      selectedFiles.forEach((file, idx) => {
        formData.append('images[]', file, `${idx + 1}.${file.name.split('.').pop()}`);
      });
    
      submitBtn.disabled = true;
      submitBtn.textContent = '提交中...';
    
      fetch('/submit_feedback.php', { method: 'POST', body: formData })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            showStatus('✅ 反馈提交成功！', 'success');
            if (typeof window.DijiangPetSay === 'function') {
              window.DijiangPetSay('管理员，感谢你的反馈~');
            }
            setTimeout(() => {
              closeFeedback();
              submitBtn.disabled = false;
              submitBtn.textContent = '确认提交';
            }, 2000);
          } else {
            showStatus('❌ 失败：' + (data.message || '未知错误'), 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = '确认提交';
          }
        })
        .catch(() => {
          showStatus('❌ 网络错误', 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = '确认提交';
        });
    });
    })();
    
    if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
    } else {
    init();
    }
})();