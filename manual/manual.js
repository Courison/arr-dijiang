/* ============================================================
   manual.js —— 手动排班页 v6.2
   - 修复导出功能，增加 DOM 判空防御
   - 修复干员库按钮跳转及数量徽章更新
   ============================================================ */
(function () {
    'use strict';
    
    const STORAGE_KEY_CONFIG  = 'DijiangScheduleConfig';
    const STORAGE_KEY_MANUAL  = 'DijiangManualSchedule';
    const STORAGE_KEY_EDITING = 'DijiangManualEditing';
    const STORAGE_KEY_PRODUCT = 'DijiangManualProduct';
    const STORAGE_KEY_OPTIMAL_HA = 'DijiangManualOptimalHA';
    const DEFAULT_CULTURE_PRIORITY = ['plant', 'mineral', 'fungi'];
    
    const ELITE_RANK = { none: 0, 精零: 1, 精一: 2, 精二: 3, 精三: 4, 精四: 5 };
    const TALENT_ORDER = ['1_1', '2_1', '1_2', '2_2'];
    const TALENT_TIER = { '1_1': 1, '2_1': 1, '1_2': 2, '2_2': 2 };
    const ROUND_KEYS = ['round1', 'round2'];
    
    const C_WORK_BASE = 0.072;
    const C_REST_BASE = 0.12;
    
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
    let roomProducts = {};
    
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
    
    // ============ 产品选择 ============
    function loadRoomProducts() {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY_PRODUCT);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') roomProducts = parsed;
            }
        } catch (e) { roomProducts = {}; }
        
        let c = roomProducts.culture;
        if (typeof c === 'string') c = { products: [c], priority: null };
        else if (Array.isArray(c)) c = { products: c.slice(), priority: null };
        else if (!c || typeof c !== 'object') c = { products: [], priority: null };
        else {
            c.products = Array.isArray(c.products) ? c.products : [];
            if (Array.isArray(c.priority)) {
                c.priority = c.priority.filter(p => c.products.includes(p));
                if (c.priority.length === 0) c.priority = null;
            } else c.priority = null;
        }
        roomProducts.culture = c;
    }
    function saveRoomProducts() {
        try { sessionStorage.setItem(STORAGE_KEY_PRODUCT, JSON.stringify(roomProducts)); } catch (e) {}
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
    function getEffectiveCulturePriority() {
        const c = roomProducts.culture || { products: [], priority: null };
        const products = c.products || [];
        if (products.length === 0) return [];
        if (Array.isArray(c.priority) && c.priority.length > 0) {
            const result = c.priority.filter(p => products.includes(p));
            for (const p of DEFAULT_CULTURE_PRIORITY) if (products.includes(p) && !result.includes(p)) result.push(p);
            for (const p of products) if (!result.includes(p)) result.push(p);
            return result;
        }
        const result = [];
        for (const p of DEFAULT_CULTURE_PRIORITY) if (products.includes(p)) result.push(p);
        for (const p of products) if (!result.includes(p)) result.push(p);
        return result;
    }
    function setRoomProduct(roomKey, value, opts) {
        if (roomKey === 'culture') {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                roomProducts.culture = {
                    products: Array.isArray(value.products) ? value.products.slice() : [],
                    priority: Array.isArray(value.priority) && value.priority.length > 0 ? value.priority.slice() : null,
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
        if (opts && opts.silent) {
            updateCultureUIInPlace();
            return;
        }
        renderManualSchedule();
    }
    
    // ============ 核心计算 ============
    function getOperatorByName(name) { return operators.find(o => o.name === name) || null; }
    
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
    
    function computeCentralRestore(roundKey) {
        const slots = manualSchedule.rooms.central[roundKey];
        let restore = 0;
        for (const name of slots) {
            if (!name) continue;
            const op = getOperatorByName(name);
            if (!op) continue;
            const traits = getGroupedTraits(op).filter(t => t.舱室 === '总控中枢');
            for (const t of traits) if (t.类型 === '心情恢复提升') restore += (t.数值 || 0);
        }
        return restore;
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
            if (roomKey !== 'central') saveRoomTiming(roomKey, hA, hB);
            return `+${output.toFixed(2)}%（${hA}h+${hB}h）`;
        }

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

        if (!found) {
            const tMax = Math.min(24, 1 / highCw, 24 * cRestHigh / (highCw + cRestHigh));
            return `+${(highRate * tMax).toFixed(2)}%`;
        }

        const h1 = highIsA ? bestHHigh : (24 - bestHHigh);
        const h2 = 24 - h1;
        if (roomKey !== 'central') saveRoomTiming(roomKey, h1, h2);
        return `+${bestOutput.toFixed(2)}%（${h1}h+${h2}h）`;
    }
    
    function compute24hOutput(roomKey) {
        const isDouble = manualSchedule.mode === 'double';
        
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
        
        if (isManufact) {
            const meta = getProductMeta(roomKey);
            if (!meta) return { text: '', isCentral: false, needProduct: true };
            const numText = computeOneProduct24h(roomKey, meta);
            return { text: `${meta.effName}${numText}`, isCentral: false, needProduct: false };
        }
        
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
                const full = computeOneProduct24h(roomKey, m, hA);
                const numeric = full.replace(/（\d+h\+\d+h）$/, '');
                pieces.push(`${m.effName}${numeric}`);
            }
            const timeSuffix = `（${hA}h+${24 - hA}h）`;
            return { text: pieces.join(' / ') + timeSuffix, isCentral: false, needProduct: false };
        }
        
        if (isMeeting) {
            const numText = computeOneProduct24h(roomKey, { effType: '收集线索效率' });
            return { text: `线索${numText}`, isCentral: false, needProduct: false };
        }
        
        return { text: '—', isCentral: false, needProduct: false };
    }

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
        if (!g2 || g2.N === 0) return Math.min(24, Math.floor(1 / cA));
        const cB = cWorkOf(g2);
        const rA = rateOf(g1), rB = rateOf(g2);
        const highIsA = rA >= rB;
        const highCw   = highIsA ? cA : cB;
        const lowCw    = highIsA ? cB : cA;
        let bestHHigh = 13, bestOutput = -1, found = false;
        for (let hHigh = 1; hHigh <= 23; hHigh++) {
            const hLow = 24 - hHigh;
            const effHighWork = Math.min(hHigh, 1 / highCw);
            const effLowWork  = Math.min(hLow,  1 / lowCw);
            if (effHighWork * highCw > hLow * cRestHigh + 1e-6) continue;
            if (effLowWork  * lowCw  > hHigh * cRestLow  + 1e-6) continue;
            const output = (highIsA ? rA : rB) * effHighWork + (highIsA ? rB : rA) * effLowWork;
            if (!found || output > bestOutput) { bestOutput = output; bestHHigh = hHigh; found = true; }
        }
        if (!found) bestHHigh = 13;
        return highIsA ? bestHHigh : (24 - bestHHigh);
    }

    function saveRoomTiming(roomKey, h1, h2) {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY_OPTIMAL_HA);
            const obj = raw ? JSON.parse(raw) : {};
            obj[roomKey] = { h1: h1, h2: h2 };
            sessionStorage.setItem(STORAGE_KEY_OPTIMAL_HA, JSON.stringify(obj));
        } catch (e) {}
    }
    
    // ============ 图片加载 ============
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
        } catch (e) {
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
            canvas.width = pos.w; canvas.height = pos.h;
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
    
    // ============ 渲染 ============
    function renderManualSchedule() {
        const container = document.getElementById('manualSchedule');
        if (!container) return;
        
        const isDouble = manualSchedule.mode === 'double';
        const isMobile = window.innerWidth <= 768;
        
        const buildSlot = (roomKey, roundKey, slotIndex) => {
            const name = manualSchedule.rooms[roomKey][roundKey][slotIndex];
            const op = name ? getOperatorByName(name) : null;
            const isEditing = editingRooms.has(roomKey);
            const dataAttrs = `data-room="${roomKey}" data-round="${roundKey}" data-index="${slotIndex}"`;
            const stateCls = isEditing ? 'is-editing' : 'is-viewing';
            
            if (op && op.eliteLevel !== 'none') {
                const imgSrc = getAgentImgSrc(op.name);
                const traits = getGroupedTraits(op).filter(t => t.舱室 === ROOM_RAW[roomKey]);
                let slipHtml = traits.length === 0 ? '<div class="slip-empty">无生效天赋</div>' : traits.map(t => {
                    const iconPath = getTalentIconPath([t]);
                    const iconTag = iconPath ? `<img class="slip-icon" src="${iconPath}" onerror="this.style.display='none';">` : '';
                    return `<div class="slip-line">${iconTag}<span class="slip-effect">${formatSlipEffect(t)}</span></div>`;
                }).join('');
                
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
        
        const buildRoom = (roomKey) => {
            const isEditing = editingRooms.has(roomKey);
            const gearCls = isEditing ? 'room-gear-btn is-on' : 'room-gear-btn';
            const boxCls = isEditing ? 'manual-room-box is-editing' : 'manual-room-box is-viewing';
            const outputHtml = buildOutputArea(roomKey);
            let slotsHtml = buildRoundBlock(roomKey, 'round1', '一轮', false);
            if (isDouble) slotsHtml += buildRoundBlock(roomKey, 'round2', '二轮', true);
            
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
        if (isMobile) html = ROOM_KEYS.map(k => buildRoom(k)).join('');
        else {
            const top = ['central', 'manufactA', 'manufactB'].map(k => buildRoom(k)).join('');
            const bottom = ['culture', 'meeting'].map(k => buildRoom(k)).join('');
            html = `<div class="manual-room-row">${top}</div><div class="manual-room-row">${bottom}</div>`;
        }
        container.innerHTML = html;
        
        // 绑定事件
        container.querySelectorAll('.room-gear-btn').forEach(btn => btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const rk = this.dataset.room;
            if (editingRooms.has(rk)) editingRooms.delete(rk);
            else editingRooms.add(rk);
            try { sessionStorage.setItem(STORAGE_KEY_EDITING, JSON.stringify([...editingRooms])); } catch(e) {}
            renderManualSchedule();
        }));

        container.querySelectorAll('.product-select').forEach(sel => {
            sel.addEventListener('change', function() { setRoomProduct(this.dataset.room, this.value); });
        });

        container.querySelectorAll('.product-dropdown').forEach(dd => {
            const btn = dd.querySelector('.product-dropdown-btn');
            const menu = dd.querySelector('.product-dropdown-menu');
            if (btn) btn.addEventListener('click', e => {
                e.stopPropagation();
                document.querySelectorAll('.product-dropdown-menu.open').forEach(m => { if (m !== menu) m.classList.remove('open'); });
                if(menu) menu.classList.toggle('open');
            });
            if (menu) {
                menu.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                    cb.addEventListener('change', function() {
                        const val = this.value;
                        const c = roomProducts.culture || { products: [], priority: null };
                        let newProducts = this.checked ? [...c.products, val] : c.products.filter(p => p !== val);
                        let newPriority = c.priority;
                        if (Array.isArray(newPriority)) {
                            newPriority = newPriority.filter(p => newProducts.includes(p));
                            if (newPriority.length === 0) newPriority = null;
                        }
                        setRoomProduct('culture', { products: newProducts, priority: newPriority }, { silent: true });
                    });
                });
                menu.addEventListener('click', e => e.stopPropagation());
            }
        });
        
        if (!window._productDropdownGlobalBound) {
            window._productDropdownGlobalBound = true;
            document.addEventListener('click', () => {
                document.querySelectorAll('.product-dropdown-menu.open').forEach(m => m.classList.remove('open'));
            });
        }

        container.querySelectorAll('.manual-slot').forEach(el => {
            el.addEventListener('click', function (e) {
                if (e.target.classList.contains('slot-remove')) return;
                const rk = this.dataset.room;
                if (!editingRooms.has(rk)) return;
                openPicker(rk, this.dataset.round, parseInt(this.dataset.index, 10));
            });
        });
        
        container.querySelectorAll('.slot-remove').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const rk = this.dataset.room;
                if (!editingRooms.has(rk)) return;
                manualSchedule.rooms[rk][this.dataset.round][parseInt(this.dataset.index, 10)] = null;
                saveManualSchedule();
                renderManualSchedule();
            });
        });

        container.querySelectorAll('.round-stat-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                showRoundStatPopup(this, this.dataset.room, this.dataset.round);
            });
        });
    }
    
    function buildOutputArea(roomKey) {
        const output = compute24hOutput(roomKey);
        if (output.isCentral) return `<div class="room-output central-output">${escapeHtml(output.text)}</div>`;
        if (roomKey === 'culture') {
            if (output.needProduct) return `<div class="room-product-picker">${buildCultureDropdown()}</div>`;
            return `<div class="room-output-group">${buildCultureDropdown()}<div class="room-output">24h均产${escapeHtml(output.text)}</div></div>`;
        }
        const opts = PRODUCT_OPTIONS[roomKey];
        if (opts) {
            const current = roomProducts[roomKey] || '';
            const optionHtml = opts.map(o => `<option value="${o.value}" ${o.value === current ? 'selected' : ''}>${o.label}</option>`).join('');
            if (output.needProduct) {
                return `<div class="room-product-picker"><select class="product-select" data-room="${roomKey}"><option value="">选择素材</option>${optionHtml}</select></div>`;
            }
            return `<div class="room-output-group"><select class="product-select inline" data-room="${roomKey}">${optionHtml}</select><div class="room-output">24h均产${escapeHtml(output.text)}</div></div>`;
        }
        return `<div class="room-output">24h均产${escapeHtml(output.text)}</div>`;
    }
    
    function buildCultureDropdown() {
        const opts = PRODUCT_OPTIONS.culture;
        const c = roomProducts.culture || { products: [], priority: null };
        const sel = c.products || [];
        const priority = getEffectiveCulturePriority();
        const label = sel.length > 0 ? priority.map(v => (opts.find(o => o.value === v) || {}).label || v).join('/') : '选择本舱需计算均产的素材';
        const items = opts.map(o => {
            const checked = sel.includes(o.value);
            const rank = priority.indexOf(o.value);
            return `<div class="product-dd-item ${checked ? 'checked' : ''}" data-value="${o.value}">
                <input type="checkbox" value="${o.value}" ${checked ? 'checked' : ''}>
                <span class="dd-label">${o.label}</span>
                <span class="prio-badge" ${checked ? '' : 'style="display:none;"'}>${checked ? rank + 1 : ''}</span>
                <span class="prio-arrows" ${checked ? '' : 'style="display:none;"'} data-room="culture" data-value="${o.value}">
                    <button class="prio-up" type="button">▲</button><button class="prio-down" type="button">▼</button>
                </span>
            </div>`;
        }).join('');
        return `<div class="product-dropdown" data-room="culture">
            <button class="product-dropdown-btn" type="button">${escapeHtml(label)} <span class="dd-arrow">▾</span></button>
            <div class="product-dropdown-menu">
                <div class="product-dd-hint">${c.priority === null ? '默认顺序：晶植>矿物>菌类' : '优先级①最高决定时间'}</div>${items}
            </div>
        </div>`;
    }
    
    // 用局部更新避免弹窗被关
    function updateCultureUIInPlace() {
        const container = document.getElementById('manualSchedule');
        if (!container) return;
        const boxes = container.querySelectorAll('.manual-room-box');
        for (const box of boxes) {
            const header = box.querySelector('.manual-room-header > span:first-child');
            if (!header || header.textContent.trim() !== '培养舱') continue;
            const output = compute24hOutput('culture');
            const outEl = box.querySelector('.room-output');
            if (outEl) outEl.textContent = output.needProduct ? '' : `24h均产${output.text}`;
            const ddBtn = box.querySelector('.product-dropdown-btn');
            if (ddBtn) {
                const opts = PRODUCT_OPTIONS.culture;
                const sel = (roomProducts.culture || {}).products || [];
                const priority = getEffectiveCulturePriority();
                const label = sel.length > 0 ? priority.map(v => (opts.find(o => o.value === v) || {}).label || v).join('/') : '选择本舱需计算均产的素材';
                ddBtn.innerHTML = `${escapeHtml(label)} <span class="dd-arrow">▾</span>`;
            }
            const dd = box.querySelector('.product-dropdown');
            if (dd) {
                const c = roomProducts.culture || { products: [], priority: null };
                const priority = getEffectiveCulturePriority();
                dd.querySelectorAll('.product-dd-item').forEach(item => {
                    const val = item.dataset.value;
                    const checked = (c.products || []).includes(val);
                    const cb = item.querySelector('input'); if(cb) cb.checked = checked;
                    item.classList.toggle('checked', checked);
                    const badge = item.querySelector('.prio-badge');
                    const arrows = item.querySelector('.prio-arrows');
                    if (checked) {
                        const rank = priority.indexOf(val);
                        if(badge) { badge.textContent = rank + 1; badge.style.display = ''; }
                        if(arrows) arrows.style.display = '';
                    } else {
                        if(badge) badge.style.display = 'none';
                        if(arrows) arrows.style.display = 'none';
                    }
                });
            }
            break;
        }
    }

    function formatSlipEffect(t) {
        const room = t.舱室;
        let prefix = room === '总控中枢' ? '中枢' : room === '制造舱' ? '制造' : room === '培养舱' ? '培养' : room === '会客室' ? '会客' : '';
        const hl = v => `<span class="hl">${v}</span>`;
        switch (t.类型) {
            case '心情恢复提升': return `${prefix}心情恢复+${hl(t.数值)}%`;
            case '心情消耗减少': return `${prefix}心情消耗-${hl(t.数值)}%`;
            case '收集线索效率': return `线索搜集效率+${hl(t.数值)}%`;
            case '线索概率小幅提升': return `${hl('线索' + t.线索编号)}概率小幅提升`;
            case '线索概率提升': return `${hl('线索' + t.线索编号)}概率提升`;
            case '干员素材效率': return `干员经验+${hl(t.数值)}%`;
            case '武器素材效率': return `武器经验+${hl(t.数值)}%`;
            case '矿物效率': return `矿物+${hl(t.数值)}%`;
            case '菌类效率': return `菌类+${hl(t.数值)}%`;
            case '晶植效率': return `晶植+${hl(t.数值)}%`;
            default: return escapeHtml(`${t.类型} ${t.数值}%`);
        }
    }

    // ============ 编辑与选择弹窗 ============
    function loadEditingState() {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY_EDITING);
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) editingRooms = new Set(arr.filter(k => ROOM_KEYS.includes(k)));
            }
        } catch (e) { editingRooms = new Set(); }
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
                            if (Array.isArray(arr)) manualSchedule.rooms[rk][rnd] = [arr[0] || null, arr[1] || null, arr[2] || null];
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

    function openPicker(roomKey, roundKey, slotIndex) {
        pickerContext = { roomKey, roundKey, slotIndex };
        const overlay = document.getElementById('pickerOverlay');
        if (!overlay) return;
        const roundLabel = roundKey === 'round1' ? '一轮' : '二轮';
        const titleEl = document.getElementById('pickerTitle');
        if(titleEl) titleEl.textContent = `选择干员 · ${ROOM_LABELS[roomKey]} ${roundLabel} 槽位 ${slotIndex + 1}`;
        
        const roomFilter = document.getElementById('pickerRoomFilter');
        if(roomFilter) roomFilter.value = ['总控中枢', '制造舱', '培养舱', '会客室'].includes(ROOM_RAW[roomKey]) ? ROOM_RAW[roomKey] : 'all';
        
        const clearBtn = document.getElementById('pickerClearBtn');
        if(clearBtn) clearBtn.disabled = !manualSchedule.rooms[roomKey][roundKey][slotIndex];
        
        renderPickerGrid();
        overlay.classList.add('open');
    }
    function closePicker() {
        const overlay = document.getElementById('pickerOverlay');
        if (overlay) overlay.classList.remove('open');
        pickerContext = null;
    }

    function renderPickerGrid() {
        const grid = document.getElementById('pickerGrid');
        if (!grid || !pickerContext) return;
        
        const star = document.getElementById('pickerStarFilter')?.value || 'all';
        const attr = document.getElementById('pickerAttributeFilter')?.value || 'all';
        const roomFilter = document.getElementById('pickerRoomFilter')?.value || 'all';
        
        const list = operators.filter(op => {
            if (op.eliteLevel === 'none') return false;
            if (star !== 'all' && op.star !== star) return false;
            if (attr !== 'all' && op.attribute !== attr) return false;
            if (roomFilter !== 'all') {
                const traits = getGroupedTraits(op);
                if (!traits.some(t => t.舱室 === roomFilter)) return false;
            }
            return true;
        });

        const targetRaw = ROOM_RAW[pickerContext.roomKey];
        const currentName = manualSchedule.rooms[pickerContext.roomKey][pickerContext.roundKey][pickerContext.slotIndex];
        const scheduledSet = new Set();
        for (const rk of ROOM_KEYS) for (const rnd of ROUND_KEYS) for (const n of manualSchedule.rooms[rk][rnd]) if (n) scheduledSet.add(n);

        const scored = list.map(op => {
            const relevant = getGroupedTraits(op).filter(t => t.舱室 === targetRaw);
            return { op, score: relevant.reduce((s, t) => s + (t.数值 || 0), 0) };
        }).sort((a, b) => b.score - a.score);

        if (scored.length === 0) { grid.innerHTML = '<div style="text-align:center;color:#888;padding:30px;">没有符合条件的干员</div>'; return; }
        
        grid.innerHTML = scored.map(({ op }) => {
            const imgSrc = getAgentImgSrc(op.name);
            const isSelected = op.name === currentName;
            const isScheduled = scheduledSet.has(op.name) && !isSelected;
            const grouped = getGroupedTraits(op);
            let tooltipHtml = grouped.length === 0 ? '<div class="tooltip-empty">无天赋</div>' : grouped.map(t => {
                const isMatch = t.舱室 === targetRaw;
                const iconPath = getTalentIconPath([t]);
                const iconTag = iconPath ? `<img class="tooltip-icon" src="${iconPath}" onerror="this.style.display='none';">` : '';
                return `<div class="tooltip-line ${isMatch?'match':''}">${iconTag}<span class="tooltip-name">${escapeHtml(t.name || t.类型)}</span><span class="tooltip-sep">|</span><span class="tooltip-arrow">▶</span><span class="tooltip-effect">${escapeHtml(formatShortTrait(t))}</span></div>`;
            }).join('');
            
            return `<div class="picker-card ${isSelected?'is-selected':''} ${isScheduled?'is-scheduled':''}" data-name="${escapeHtml(op.name)}">
                <div class="picker-elite">${escapeHtml(op.eliteLevel)}</div>
                ${isScheduled ? `<div class="picker-scheduled-tag">已排</div>` : ''}
                <img class="picker-avatar" src="${imgSrc}" onerror="this.style.display='none';">
                <div class="picker-name">${escapeHtml(op.name)}</div>
                <div class="picker-tooltip"><div class="tooltip-title">${escapeHtml(op.name)} · ${escapeHtml(op.eliteLevel)}</div>${tooltipHtml}</div>
            </div>`;
        }).join('');

        grid.querySelectorAll('.picker-card').forEach(card => {
            const tooltip = card.querySelector('.picker-tooltip');
            card.addEventListener('click', function () {
                const name = this.dataset.name;
                // 移除旧
                for (const rk of ROOM_KEYS) for (const rnd of ROUND_KEYS) {
                    const arr = manualSchedule.rooms[rk][rnd];
                    for (let i = 0; i < 3; i++) if (arr[i] === name) arr[i] = null;
                }
                manualSchedule.rooms[pickerContext.roomKey][pickerContext.roundKey][pickerContext.slotIndex] = name;
                saveManualSchedule();
                renderManualSchedule();
                closePicker();
            });
            card.addEventListener('mouseenter', function () {
                if (!tooltip) return;
                const rect = card.getBoundingClientRect();
                const w = 280;
                let left = rect.left + rect.width / 2 - w / 2;
                if (left < 8) left = 8;
                if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
                let top = rect.top - (tooltip.offsetHeight || 120) - 10;
                if (top < 8) top = rect.bottom + 10;
                tooltip.style.left = left + 'px'; tooltip.style.top = top + 'px';
            });
        });
    }

    // ============ 从自动排班导入 ============
    function importFromAuto() {
        let queues = null; let doubleRooms = [];
        try {
            const rawQ = sessionStorage.getItem('DijiangLastQueues');
            const rawD = sessionStorage.getItem('DijiangDoubleRooms');
            if (rawQ) queues = JSON.parse(rawQ);
            if (rawD) doubleRooms = JSON.parse(rawD) || [];
            if (!Array.isArray(doubleRooms)) doubleRooms = [];
        } catch (e) {}
        
        if (!queues) { alert('未找到自动排班结果。请先去主站生成排班。'); return; }
        
        const useDouble = doubleRooms.length > 0;
        const doubleSet = new Set(doubleRooms);
        const newRooms = emptyRooms();
        
        for (const rk of ROOM_KEYS) {
            const q = queues[rk]; if (!q) continue;
            if (useDouble) {
                if (doubleSet.has(rk)) {
                    const r1 = Array.isArray(q.round1) ? q.round1 : [];
                    const r2 = Array.isArray(q.round2) ? q.round2 : [];
                    newRooms[rk].round1 = [0, 1, 2].map(i => (r1[i] && r1[i].name) || null);
                    newRooms[rk].round2 = [0, 1, 2].map(i => (r2[i] && r2[i].name) || null);
                } else {
                    const rec = Array.isArray(q.recommend) ? q.recommend : [];
                    newRooms[rk].round1 = [0, 1, 2].map(i => (rec[i] && rec[i].name) || null);
                }
            } else {
                const rec = Array.isArray(q.recommend) ? q.recommend : [];
                newRooms[rk].round1 = [0, 1, 2].map(i => (rec[i] && rec[i].name) || null);
            }
        }
        manualSchedule.rooms = newRooms; manualSchedule.mode = useDouble ? 'double' : 'single';
        saveManualSchedule();

        // ★ 强制同步产品策略配置
        try {
            const prodRaw = sessionStorage.getItem('DijiangDefaultProduct');
            if (prodRaw) {
                const prod = JSON.parse(prodRaw);
                // 同步制造舱
                if (prod.manufactA) roomProducts.manufactA = prod.manufactA;
                if (prod.manufactB) roomProducts.manufactB = prod.manufactB;
                
                // 同步培养舱
                if (prod.culture) {
                    let order = [];
                    const c = prod.culture;
                    if (Array.isArray(c)) {
                        order = c.slice();
                    } else if (c && typeof c === 'object') {
                        const prods = Array.isArray(c.products) ? c.products : [];
                        if (Array.isArray(c.priority) && c.priority.length > 0) {
                            order = c.priority.filter(x => prods.includes(x));
                            for (const x of prods) if (!order.includes(x)) order.push(x);
                        } else {
                            for (const x of DEFAULT_CULTURE_PRIORITY) if (prods.includes(x)) order.push(x);
                            for (const x of prods) if (!order.includes(x)) order.push(x);
                        }
                    }
                    roomProducts.culture = { products: order, priority: null };
                }
                saveRoomProducts();
            }
        } catch (e) {
            console.warn('同步生产策略失败：', e);
        }

        renderManualSchedule();
        
        if (typeof window.DijiangPetSay === 'function') {
            window.DijiangPetSay(`已导入排班（${useDouble ? '二轮' : '单轮'}）`);
        } else {
            alert(`已从自动排班导入（${useDouble ? '二轮' : '单轮'}）`);
        }
    }

    // ============ 导出排班图 (修复) ============
    window.DijiangExportSchedule = async function () {
        const container = document.getElementById('manualSchedule');
        if (!container || container.children.length === 0) { alert('暂无可导出的排班'); return; }
        if (typeof html2canvas === 'undefined') { alert('导出组件加载失败，请刷新页面重试'); return; }
        
        const exportContainer = document.createElement('div');
        exportContainer.style.cssText = 'position:fixed;left:-9999px;top:0;width:900px;background:#fff;padding:24px;font-family:system-ui;color:#222;';
        document.body.appendChild(exportContainer);
        
        const now = new Date();
        const dateStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        const isDouble = manualSchedule.mode === 'double';
        
        exportContainer.innerHTML = `
          <div style="text-align:center;font-size:26px;font-weight:700;margin-bottom:6px;">帝江号手动排班表${isDouble ? '（二轮）' : ''}</div>
          <div style="text-align:center;font-size:12px;color:#666;margin-bottom:18px;">生成时间 ${dateStr}</div>
          <div id="manualExportGrid" style="display:flex;flex-direction:column;gap:14px;"></div>
          <div style="margin-top:20px;border-top:1px solid #ddd;padding-top:12px;font-size:11px;color:#888;text-align:center;">https://arr-dijiang.top/manual/</div>
        `;
        
        const gridEl = exportContainer.querySelector('#manualExportGrid');
        const allNames = new Set();
        for (const rk of ROOM_KEYS) for (const rnd of ROUND_KEYS) for (const n of manualSchedule.rooms[rk][rnd]) if (n) allNames.add(n);
        
        const dataUrlMap = {};
        await Promise.all([...allNames].map(async name => {
            let url = getSpriteDataUrl(name);
            if (!url) {
                try {
                    const res = await fetch(`/Agent/${encodeURIComponent(name)}.webp`);
                    if (res.ok) {
                        const blob = await res.blob();
                        url = await new Promise(resolve => { const r = new FileReader(); r.onloadend = () => resolve(r.result); r.readAsDataURL(blob); });
                    }
                } catch (e) {}
            }
            if (url) dataUrlMap[name] = url;
        }));
        
        const buildAvatar = (name) => {
            if (!name) return `<div style="width:70px;height:70px;border-radius:10px;background:#f4f6f8;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:10px;">空位</div>`;
            const img = dataUrlMap[name];
            return `<div style="position:relative;width:70px;height:70px;border-radius:10px;overflow:hidden;border:1px solid #ddd;background:#eef2f6;">
                ${img ? `<img src="${img}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">` : ''}
                <div style="position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);color:#fff;font-size:10px;text-align:center;padding:2px 0;">${escapeHtml(name)}</div>
            </div>`;
        };
        
        const buildExportRoom = (roomKey) => {
            const output = compute24hOutput(roomKey);
            let outputText = '';
            if (output.isCentral) outputText = `<div style="font-size:11px;color:#8a6d3b;margin-bottom:6px;text-align:center;">${escapeHtml(output.text)}</div>`;
            else if (output.needProduct) outputText = `<div style="font-size:11px;color:#999;margin-bottom:6px;text-align:center;">未选择素材</div>`;
            else outputText = `<div style="font-size:11px;color:#3f7e6b;margin-bottom:6px;text-align:center;">24h均产${escapeHtml(output.text)}</div>`;
            
            let inner = `<div style="border:1px solid #e0e0e0;border-radius:12px;padding:12px;background:#fafafa;">
                <div style="font-weight:600;font-size:14px;margin-bottom:10px;text-align:center;">${ROOM_LABELS[roomKey]}</div>${outputText}`;
                
            const buildRoundRow = (rnd) => {
                const slots = manualSchedule.rooms[roomKey][rnd];
                return `<div style="display:flex;justify-content:center;gap:12px;">${[0,1,2].map(i => buildAvatar(slots[i])).join('')}</div>`;
            };
            
            if (isDouble) {
                inner += `<div style="font-size:11px;color:#666;margin-bottom:4px;">一轮</div>${buildRoundRow('round1')}<div style="font-size:11px;color:#666;margin-top:10px;margin-bottom:4px;">二轮</div>${buildRoundRow('round2')}</div>`;
            } else {
                inner += `${buildRoundRow('round1')}</div>`;
            }
            return inner;
        };
        
        gridEl.innerHTML = `<div style="display:flex;gap:14px;justify-content:center;">${['central', 'manufactA', 'manufactB'].map(buildExportRoom).join('')}</div>
                            <div style="display:flex;gap:14px;justify-content:center;">${['culture', 'meeting'].map(buildExportRoom).join('')}</div>`;
                            
        try {
            const canvas = await html2canvas(exportContainer, { scale: 2, useCORS: true, backgroundColor: '#ffffff', width: 900, height: exportContainer.scrollHeight });
            const link = document.createElement('a');
            link.download = `手动排班_${now.getFullYear()}${String(now.getMonth()+1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${isDouble ? '_双轮' : ''}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            document.body.removeChild(exportContainer);
        } catch (err) {
            alert('导出失败：' + err.message);
            if(exportContainer.parentNode) document.body.removeChild(exportContainer);
        }
    };

    // ============ 其他 UI 绑定 ============
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
            operators.push({ id: id++, name, star: info.star || '未知', attribute: info.attribute || '未知', eliteLevel: entry.elite, activatedTalents: entry.talents });
        }
    }

    // ★ 新增：更新干员数量徽章
    function updateOperatorCountBadge() {
        const badge = document.getElementById('operatorCountBadge');
        if (!badge) return;
        const owned = operators.filter(op => op.eliteLevel !== 'none').length;
        badge.textContent = owned;
    }

    function showRoundStatPopup(anchor, roomKey, roundKey) {
        const old = document.querySelector('.round-stat-popup-wrap');
        if (old) old.remove();
        
        const slots = manualSchedule.rooms[roomKey][roundKey];
        let lines = [];
        const rawRoom = ROOM_RAW[roomKey];
        let reduce = 0;
        let effSum = {};
        for (const name of slots) {
            if (!name) continue;
            const op = getOperatorByName(name);
            if (!op || op.eliteLevel === 'none') continue;
            const traits = getGroupedTraits(op).filter(t => t.舱室 === rawRoom);
            for (const t of traits) {
                if (t.类型 === '心情消耗减少') { reduce += (t.数值 || 0); continue; }
                if (isCluePower(t.类型)) continue;
                effSum[t.类型] = (effSum[t.类型] || 0) + (t.数值 || 0);
            }
        }
        for (const [k, v] of Object.entries(effSum)) lines.push(`${k} +${v}%`);
        if (reduce > 0) lines.push(`心情消耗 -${reduce}%`);
        if (lines.length === 0) lines.push('无生效天赋');
        
        const body = lines.map(l => `<div class="stat-line">${escapeHtml(l)}</div>`).join('');
        const popup = document.createElement('div');
        popup.className = 'round-stat-popup-wrap';
        popup.innerHTML = `<div class="round-stat-popup"><div class="stat-title">${ROOM_LABELS[roomKey]} · ${roundKey==='round1'?'一轮':'二轮'}</div>${body}</div>`;
        document.body.appendChild(popup);
        
        const rect = anchor.getBoundingClientRect();
        popup.style.cssText = `position:fixed;top:${rect.bottom+6}px;left:${rect.left}px;z-index:10000;`;
        
        setTimeout(() => { document.addEventListener('click', () => popup.remove(), { once: true }); }, 0);
    }

    async function init() {
        await loadSprite();
        try {
            const res = await fetch('/Agent_characteristics.json');
            if (!res.ok) throw new Error();
            rawOperatorsData = await res.json();
        } catch(e) { return; }
        
        initOperators();
        updateOperatorCountBadge(); // ★ 更新数量徽章
        loadManualSchedule();
        loadEditingState();
        loadRoomProducts();
        
        const label = document.getElementById('roundModeLabel');
        if (label) label.textContent = manualSchedule.mode === 'double' ? '二轮排班' : '单轮排班';
        
        renderManualSchedule();
        
        // ★ 绑定干员库跳转
        const opBtn = document.getElementById('openOperatorPanelBtn');
        if (opBtn) {
            opBtn.addEventListener('click', function () {
                window.location.href = '/agentpackage/';
            });
        }

        const importBtn = document.getElementById('importFromAutoBtn');
        if (importBtn) importBtn.addEventListener('click', importFromAuto);
        
        const toggleBtn = document.getElementById('toggleRoundBtn');
        if (toggleBtn) toggleBtn.addEventListener('click', function () {
            manualSchedule.mode = manualSchedule.mode === 'single' ? 'double' : 'single';
            saveManualSchedule();
            if (label) label.textContent = manualSchedule.mode === 'double' ? '二轮排班' : '单轮排班';
            renderManualSchedule();
        });

        const clearBtn = document.getElementById('clearManualBtn');
        if (clearBtn) clearBtn.addEventListener('click', function () {
            if (confirm('确定清空所有槽位吗？')) {
                manualSchedule.rooms = emptyRooms();
                saveManualSchedule();
                renderManualSchedule();
            }
        });

        const stepBtn = document.getElementById('openStepSimBtn');
        if (stepBtn) {
            stepBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                window.location.href = '/manual/step/';
            });
        }

        const pickerCloseBtn = document.getElementById('pickerCloseBtn');
        if (pickerCloseBtn) pickerCloseBtn.addEventListener('click', closePicker);
        
        const pickerOverlay = document.getElementById('pickerOverlay');
        if (pickerOverlay) pickerOverlay.addEventListener('click', e => { if (e.target === pickerOverlay) closePicker(); });
        
        ['pickerStarFilter', 'pickerAttributeFilter', 'pickerRoomFilter'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', renderPickerGrid);
        });

        const clearSlotBtn = document.getElementById('pickerClearBtn');
        if (clearSlotBtn) clearSlotBtn.addEventListener('click', function () {
            if (!pickerContext) return;
            manualSchedule.rooms[pickerContext.roomKey][pickerContext.roundKey][pickerContext.slotIndex] = null;
            saveManualSchedule(); renderManualSchedule(); closePicker();
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();