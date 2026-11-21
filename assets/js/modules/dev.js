/* ============================================================
   dev.js —— 提升建议页 (顶配推荐版)
   ============================================================ */
(function () {
    'use strict';

    const TALENT_ORDER = ['1_1', '2_1', '1_2', '2_2'];
    const TALENT_META = {
        '1_1': { minElite: 2, label: '精一' },
        '2_1': { minElite: 3, label: '精二' },
        '1_2': { minElite: 4, label: '精三' },
        '2_2': { minElite: 5, label: '精四' },
    };
    const ELITE_RANK = { 'none': 0, '精零': 1, '精一': 2, '精二': 3, '精三': 4, '精四': 5 };
    const ROOM_ORDER = ['总控中枢', '制造舱', '培养舱', '会客室'];
    const STORAGE_KEY = 'DijiangScheduleConfig';
    const AVATAR_FALLBACK = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" fill="#eaeaea"/><text x="50%" y="54%" text-anchor="middle" font-size="20" fill="#999">?</text></svg>'
    );

    // 记录顶配干员被分配的舱室 { name: Set(['制造舱', '总控中枢', '总控中枢(低效)']) }
    let topRoomMap = {};
    // 提升路线批量选择；选择阶段不重算，统一应用时才重算一次。
    let selectedPlanNames = new Set();

    // ========== 工具 ==========
    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, function (m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
        });
    }
    function normalizeElite(elite) {
        if (elite === '未拥有' || elite === 'none' || elite == null || elite === '') return 'none';
        return ELITE_RANK[elite] !== undefined ? elite : 'none';
    }
    function parseConfigEntry(val) {
        if (typeof val === 'string') return { elite: normalizeElite(val), talents: [] };
        if (val && typeof val === 'object') return { elite: normalizeElite(val.elite), talents: Array.isArray(val.talents) ? val.talents.slice() : [] };
        return { elite: 'none', talents: [] };
    }

    // ========== 天赋工具 ==========
    function getTalentList(rawData, tid) {
        if (!rawData) return [];
        if (Array.isArray(rawData[tid]) && rawData[tid].length) return rawData[tid];
        const LEGACY = { '1_1': '精一', '2_1': '精二', '1_2': '精三', '2_2': '精四' };
        if (Array.isArray(rawData[LEGACY[tid]]) && rawData[LEGACY[tid]].length) return rawData[LEGACY[tid]];
        return [];
    }
    function isCluePower(type) { return type === '线索概率提升' || type === '线索概率小幅提升'; }
    function formatShortTrait(t) {
        let roomPrefix = '';
        if (t.舱室 === '总控中枢') roomPrefix = '中枢';
        else if (t.舱室 === '制造舱') roomPrefix = '制造舱';
        else if (t.舱室 === '培养舱') roomPrefix = '培养舱';
        else if (t.舱室 === '会客室') roomPrefix = '会客室';
        if (t.类型 === '心情恢复提升') return `${roomPrefix}心情恢复+${t.数值}%`;
        if (t.类型 === '心情消耗减少') return `${roomPrefix}心情消耗-${t.数值}%`;
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
            if (isCluePower(type)) return '/Talent/meeting_clue_power.webp';
        }
        return '';
    }

    function calcMergedTraits(opName, activatedTalents, rawData) {
        const rawOpData = rawData[opName] || {};
        const allTraits = [];
        for (const tid of TALENT_ORDER) {
            if (!activatedTalents[tid]) continue;
            const traits = getTalentList(rawOpData, tid);
            for (const t of traits) {
                const copy = { ...t, _talentId: tid };
                if (isCluePower(copy.类型) && copy.数值 === undefined) {
                    if (copy.类型 === '线索概率小幅提升') copy.数值 = 10;
                    else if (copy.类型 === '线索概率提升') copy.数值 = 25;
                    else copy.数值 = (tid === '1_1' || tid === '2_1') ? 10 : 25;
                }
                allTraits.push(copy);
            }
        }
        const map = new Map();
        const CLUE_PRIORITY = { '线索概率小幅提升': 1, '线索概率提升': 2 };
        for (const t of allTraits) {
            const key = isCluePower(t.类型) ? `${t.舱室}|线索概率|线索${t.线索编号}` : `${t.舱室}|${t.类型}`;
            if (!map.has(key)) map.set(key, { ...t });
            else {
                const existing = map.get(key);
                if (isCluePower(t.类型) && isCluePower(existing.类型)) {
                    if (CLUE_PRIORITY[t.类型] > CLUE_PRIORITY[existing.类型]) map.set(key, { ...t });
                } else if (t.数值 !== undefined && existing.数值 !== undefined) {
                    existing.数值 = Math.max(existing.数值, t.数值);
                }
            }
        }
        return Array.from(map.values());
    }

    // ========== 精灵图加载 ==========
    const spriteDataUrlCache = {};
    let spriteImage = null;
    let spriteIndex = null;
    let spriteReady = false;
    let spriteLoadPromise = null;
    function loadSprite() {
        if (spriteLoadPromise) return spriteLoadPromise;
        spriteLoadPromise = (async () => {
            try {
                const res = await fetch('/dist/agent_sprite.json', { cache: 'no-cache' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                spriteIndex = await res.json();
                const imgUrl = '/dist/' + (spriteIndex.image || 'agent_sprite.webp');
                spriteImage = await new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = () => reject(new Error('长图加载失败'));
                    img.src = imgUrl;
                });
                spriteReady = true;
            } catch (e) { spriteReady = false; }
            return spriteReady;
        })();
        return spriteLoadPromise;
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
            let dataUrl = '';
            try { dataUrl = canvas.toDataURL('image/webp', 0.9); } catch (_) {}
            if (!dataUrl || dataUrl.indexOf('data:image/webp') !== 0) { dataUrl = canvas.toDataURL('image/png'); }
            spriteDataUrlCache[name] = dataUrl;
            return dataUrl;
        } catch (e) { return null; }
    }
    function getAgentImgSrc(name) {
        const spriteUrl = getSpriteDataUrl(name);
        if (spriteUrl) return spriteUrl;
        return '/Agent/' + encodeURIComponent(name) + '.webp';
    }

    // ========== ★ 渲染简易排班图 (按班次每行3人) ==========
    function renderSimpleSchedule(queues) {
        const container = document.getElementById('devSimpleSchedule');
        if (!container) return;
        const ROOM_MAP = { central: '总控中枢', manufactA: '制造舱 A', manufactB: '制造舱 B', culture: '培养舱', meeting: '会客室' };
        let html = '';
        
        const renderOpCard = (op) => {
            if (!op) return '<div></div>';
            const imgSrc = getAgentImgSrc(op.name);
            return `<div class="dev-schedule-op" title="${op.name}">
                <img src="${imgSrc}" onerror="this.onerror=null; this.src='${AVATAR_FALLBACK}';">
                <div class="op-name">${escapeHtml(op.name)}</div>
            </div>`;
        };

        for (const rk of ['central', 'manufactA', 'manufactB', 'culture', 'meeting']) {
            const data = queues[rk];
            if (!data) continue;
            
            const isDouble = (data.round1 && data.round1.length > 0) || (data.round2 && data.round2.length > 0);
            const hasSingle = data.recommend && data.recommend.length > 0;
            
            if (!isDouble && !hasSingle) continue;

            html += `<div class="dev-schedule-room">
                <div class="dev-schedule-room-title">${ROOM_MAP[rk]}</div>`;
                
            if (isDouble) {
                html += `<div class="dev-schedule-round-label">A 班</div>
                         <div class="dev-schedule-ops">`;
                for (let i = 0; i < 3; i++) html += renderOpCard((data.round1 || [])[i]);
                html += `</div>`;
                
                html += `<div class="dev-schedule-round-label">B 班</div>
                         <div class="dev-schedule-ops">`;
                for (let i = 0; i < 3; i++) html += renderOpCard((data.round2 || [])[i]);
                html += `</div>`;
            } else {
                html += `<div class="dev-schedule-ops" style="margin-top:8px;">`;
                for (let i = 0; i < 3; i++) html += renderOpCard((data.recommend || [])[i]);
                html += `</div>`;
            }
            html += `</div>`;
        }
        
        container.innerHTML = html || '<p class="dev-empty">当前配置下无干员排班</p>';
    }

    // ========== ★ 最小代价提升路线 ==========
    // 思路：把自动排班 scheduler 当作黑盒，每次只枚举“单条天赋解锁/升级”动作，
    // 用当前完整生产策略评估 24h 目标，按收益/代价贪心选择；达到全满配目标分即停。
    // 等价干员/总控多队会在后续动作收益为 0 时自然停止，不会推荐重复培养。
    const ELITE_LABEL_BY_RANK = ['none', '精零', '精一', '精二', '精三', '精四'];
    const ELITE_STEP_COST = 1;

    function rankOfElite(elite) {
        return ELITE_RANK[elite] || 0;
    }
    function eliteOfRank(rank) {
        return ELITE_LABEL_BY_RANK[Math.max(0, Math.min(5, rank))] || 'none';
    }
    function makePlanOperator(base, elite, talents, rawData) {
        return {
            ...base,
            eliteLevel: elite,
            activatedTalents: { ...talents },
            mergedTraits: calcMergedTraits(base.name, talents, rawData)
        };
    }
    let planScoreOptions = null;
    function objectiveOf(queues) {
        if (!queues) return 0;
        const opt = planScoreOptions || {};
        const order = Array.isArray(opt.materialPriority) ? opt.materialPriority : ['clue', 'weapon', 'exp', 'culture'];
        const weight = m => Math.max(1, order.length - Math.max(0, order.indexOf(m)));
        const timing = queues._timingInfo || {};
        const group = (members, room, productType) => {
            let eff = 0, reduce = 0;
            for (const op of members || []) {
                for (const t of (op.mergedTraits || [])) {
                    if (t.舱室 !== room) continue;
                    if (t.类型 === productType) eff += Number(t.数值) || 0;
                    if (t.类型 === '心情消耗减少') reduce += Number(t.数值) || 0;
                }
            }
            return {
                n: (members || []).length,
                rate: (1 + eff / 100) * (1 + 0.4 * (members || []).length),
                reduce
            };
        };
        const roomHours = rk => {
            const t = timing[rk];
            if (!t) return { hA: 12, hB: 12 };
            return { hA: Number(t.hA) || 0, hB: Number(t.hB) || 0 };
        };
        let score = 0;
        for (const rk of ['manufactA', 'manufactB']) {
            const product = (opt.manufactProducts && opt.manufactProducts[rk]) || 'exp';
            const type = product === 'weapon' ? '武器素材效率' : '干员素材效率';
            const h = roomHours(rk);
            const a = group(queues[rk] && queues[rk].round1, '制造舱', type);
            const b = group(queues[rk] && queues[rk].round2, '制造舱', type);
            score += weight(product) * (a.rate * h.hA + b.rate * h.hB);
        }
        if (queues.culture) {
            const h = roomHours('culture');
            const products = opt.culturePriority || ['plant', 'mineral', 'fungi'];
            const typeMap = { plant: '晶植效率', mineral: '矿物效率', fungi: '菌类效率' };
            products.forEach((p, i) => {
                const w = (opt.priorityWeights && opt.priorityWeights[i] !== undefined) ? opt.priorityWeights[i] : (1 / Math.max(1, products.length));
                const a = group(queues.culture.round1, '培养舱', typeMap[p]);
                const b = group(queues.culture.round2, '培养舱', typeMap[p]);
                score += weight('culture') * w * (a.rate * h.hA + b.rate * h.hB);
            });
        }
        if (queues.meeting) {
            const h = roomHours('meeting');
            const a = group(queues.meeting.round1, '会客室', '收集线索效率');
            const b = group(queues.meeting.round2, '会客室', '收集线索效率');
            score += weight('clue') * (a.rate * h.hA + b.rate * h.hB);
            const clueOps = new Set();
            for (const round of ['round1', 'round2']) {
                for (const op of (queues.meeting[round] || [])) {
                    if (!op || clueOps.has(op.name)) continue;
                    if ((op.mergedTraits || []).some(t => t.舱室 === '会客室' &&
                        (t.类型 === '线索概率提升' || t.类型 === '线索概率小幅提升'))) clueOps.add(op.name);
                }
            }
            // 线索概率没有直接产出数值，固定每个有效干员 1 分。
            score += clueOps.size;
        }
        if (queues.central) {
            let rec = 0;
            for (const round of ['round1', 'round2']) {
                for (const op of (queues.central[round] || [])) {
                    for (const t of (op.mergedTraits || [])) {
                        if (t.舱室 === '总控中枢' && t.类型 === '心情恢复提升') rec += Number(t.数值) || 0;
                    }
                }
            }
            score += rec * 0.02;
        }
        return score;
    }
    function centralHighNamesOf(queue) {
        const names = new Set();
        if (!queue || !queue.central) return names;
        const timing = queue._timingInfo && queue._timingInfo.central;
        if (timing) {
            const round = timing.round1IsEfficient ? 'round1' : 'round2';
            for (const op of (queue.central[round] || [])) names.add(op.name);
            if (names.size) return names;
        }
        const restoreOf = round => (queue.central[round] || []).reduce((sum, op) =>
            sum + (op.mergedTraits || []).reduce((s, t) =>
                s + (t.舱室 === '总控中枢' && t.类型 === '心情恢复提升' ? (t.数值 || 0) : 0), 0), 0);
        const round = restoreOf('round1') >= restoreOf('round2') ? 'round1' : 'round2';
        for (const op of (queue.central[round] || [])) names.add(op.name);
        return names;
    }
    function runPlanSchedule(ops, options) {
        try {
            return window.DijiangScheduler.generateSchedule(ops, options);
        } catch (e) {
            console.warn('[提升建议] 排班评估失败', e);
            return null;
        }
    }
    function planConfigEntry(config, op) {
        if (!config) return null;
        return config[op.name] || (op.charId ? config[op.charId] : null) || null;
    }

    function getPlanOptions() {
        let roomModes = { central: 'double', manufactA: 'double', manufactB: 'double', culture: 'double', meeting: 'double' };
        try { const rm = sessionStorage.getItem('DijiangRoomModes'); if (rm) roomModes = JSON.parse(rm); } catch (e) {}
        let p1 = ['meeting', 'central', 'manufactA', 'manufactB', 'culture'];
        let p2 = ['meeting', 'manufactA', 'manufactB', 'culture', 'central'];
        try {
            const s1 = sessionStorage.getItem('DijiangRoomPriorityOrderRound1'); if (s1) p1 = JSON.parse(s1);
            const s2 = sessionStorage.getItem('DijiangRoomPriorityOrderRound2'); if (s2) p2 = JSON.parse(s2);
        } catch (e) {}
        let manufMode = 'dual';
        try {
            const dp = sessionStorage.getItem('DijiangDefaultProduct');
            if (dp) { const p = JSON.parse(dp); if (p.manufactA === p.manufactB) manufMode = p.manufactA; }
        } catch (e) {}
        let meetingPriority = false;
        try { meetingPriority = sessionStorage.getItem('meetingPriority') === 'true'; } catch (e) {}
        let options;
        if (typeof window.DijiangBuildOptions === 'function') {
            options = window.DijiangBuildOptions();
        } else {
            try {
                const rawSnap = sessionStorage.getItem('DijiangLastStrategySnapshot');
                if (rawSnap) {
                    const snap = JSON.parse(rawSnap);
                    snap.missingClues = new Set(Array.isArray(snap.missingClues) ? snap.missingClues : []);
                    snap.excludedClues = new Set(Array.isArray(snap.excludedClues) ? snap.excludedClues : [3, 7]);
                    snap.trustedAgentIds = Array.isArray(snap.trustedAgentIds) ? snap.trustedAgentIds : [];
                    options = snap;
                }
            } catch (e) {}
        }
        if (!options) {
            const readJson = (key, fallback) => {
                try {
                    const raw = sessionStorage.getItem(key);
                    if (!raw) return fallback;
                    const v = JSON.parse(raw);
                    return v == null ? fallback : v;
                } catch (e) { return fallback; }
            };
            const defaultModes = { central: 'double', manufactA: 'double', manufactB: 'double', culture: 'double', meeting: 'double' };
            const modes = Object.assign(defaultModes, readJson('DijiangRoomModes', {}));
            const savedProduct = readJson('DijiangDefaultProduct', null);
            const products = (savedProduct && (savedProduct.manufactA || savedProduct.manufactB))
                ? { manufactA: savedProduct.manufactA || null, manufactB: savedProduct.manufactB || null }
                : { manufactA: 'exp', manufactB: 'weapon' };
            const manual = readJson('DijiangManualProduct', {});
            const c = manual && manual.culture;
            const cultureTypes = c && Array.isArray(c.products) && c.products.length ? c.products.slice() : ['mineral', 'fungi', 'plant'];
            let culturePriority = c && Array.isArray(c.priority) ? c.priority.filter(x => cultureTypes.includes(x)) : [];
            if (!culturePriority.length) culturePriority = readJson('DijiangCulturePriority', ['plant', 'mineral', 'fungi']).filter(x => cultureTypes.includes(x));
            if (!culturePriority.length) culturePriority = ['plant', 'mineral', 'fungi'].filter(x => cultureTypes.includes(x));
            const material = readJson('DijiangMaterialPriority', ['clue', 'weapon', 'exp', 'culture']);
            const ex = readJson('DijiangExcludedClues', [3, 7]);
            const miss = readJson('missingClues', []);
            options = {
                mode: manufMode,
                manufactProducts: products,
                doubleRooms: Object.keys(modes).filter(k => modes[k] === 'double'),
                roomModes: modes,
                emptyRooms: Object.keys(modes).filter(k => modes[k] === 'empty'),
                centralDisabled: (modes.central === 'empty'),
                isTrustMode: false, trustedAgentIds: [], trustAssignMap: {},
                priorityOrderRound1: p1, priorityOrderRound2: p2,
                materialPriority: Array.isArray(material) && material.length ? material : ['clue', 'weapon', 'exp', 'culture'],
                priorityFillEnabled: sessionStorage.getItem('priorityFillEnabled') === 'true',
                underfillRoom: sessionStorage.getItem('underfillRoom') || 'central',
                meetingPriorityEnabled: meetingPriority,
                missingClues: new Set(Array.isArray(miss) ? miss : []),
                excludedClues: new Set(Array.isArray(ex) ? ex : [3, 7]),
                cultureTypes: cultureTypes,
                culturePriority: culturePriority,
                priorityWeights: [1.0, 0.6, 0.3],
                cRestHigh: 12 * 1.48
            };
        }
        return options;
    }

    async function buildMinimalPlan(rawData, config, options) {
        if (!options) options = getPlanOptions();
        planScoreOptions = options;
        let live = (window.DijiangAPI && typeof window.DijiangAPI.getOperators === 'function')
            ? window.DijiangAPI.getOperators().filter(op => op.eliteLevel !== 'none')
            : [];
        if (!live.length) {
            // /development 直接打开时 main.js 可能未初始化干员对象，从配置文件兜底。
            for (const [name, val] of Object.entries(config || {})) {
                if (name.startsWith('_')) continue;
                const entry = parseConfigEntry(val);
                if (entry.elite === 'none') continue;
                const info = rawData[name] || {};
                live.push({
                    id: name, name, charId: info.charId || info.id || name,
                    eliteLevel: entry.elite,
                    activatedTalents: entry.talents.reduce((m, tid) => (m[tid] = true, m), {}),
                });
            }
        }
        if (!live.length) return { empty: true };

        const currentOps = live.map(op => {
            const entry = parseConfigEntry(planConfigEntry(config, op) || 'none');
            const elite = op.eliteLevel && op.eliteLevel !== 'none' ? op.eliteLevel : entry.elite;
            const talents = op.activatedTalents && typeof op.activatedTalents === 'object'
                ? { ...op.activatedTalents }
                : { '1_1': false, '2_1': false, '1_2': false, '2_2': false };
            return makePlanOperator(op, elite, talents, rawData);
        });

        const fullTalents = { '1_1': true, '2_1': true, '1_2': true, '2_2': true };
        const fullOps = live.map(op => makePlanOperator(op, '精四', fullTalents, rawData));

        const currentQueue = runPlanSchedule(currentOps, options);
        const fullQueue = runPlanSchedule(fullOps, options);
        if (!currentQueue || !fullQueue) return { empty: true, failed: true };
        const currentHighNames = centralHighNamesOf(currentQueue);

        const startScore = objectiveOf(currentQueue);
        let targetScore = objectiveOf(fullQueue);
        let state = currentOps;
        let score = startScore;
        let steps = [];
        const seen = new Set();

        // 动作只包含“缺失天赋”，并把解锁该天赋需要的精英阶段一起算入代价。
        // 同一干员的两个天赋可以组成一个动作，避免“效率+心情减耗”只有合在一起才有效时被漏掉。
        function actionsFor(ops, includePairs) {
            const out = [];
            const makeAction = (op, tids) => {
                const curRank = rankOfElite(op.eliteLevel);
                if (curRank <= 0 || !tids.length) return null;
                let targetRank = curRank;
                const talents = { ...(op.activatedTalents || {}) };
                const traits = [];
                const names = [];
                for (const tid of tids) {
                    const list = getTalentList(rawData[op.name], tid);
                    if (!list.length) return null;
                    const needRank = TALENT_META[tid] ? TALENT_META[tid].minElite : curRank;
                    targetRank = Math.max(targetRank, needRank);
                    talents[tid] = true;
                    traits.push(...list);
                    names.push(...list.map(t => t.name).filter(Boolean));
                }
                const targetElite = eliteOfRank(targetRank);
                if (currentHighNames.size >= 3 && traits.length && traits.every(t => t.舱室 === '总控中枢' && t.类型 === '心情恢复提升') && !currentHighNames.has(op.name)) {
                    return null;
                }
                return {
                    name: op.name,
                    charId: op.charId || op.name,
                    tid: tids[0],
                    tids: tids.slice(),
                    currentElite: op.eliteLevel,
                    targetElite,
                    talents,
                    traits,
                    traitNames: Array.from(new Set(names)),
                    cost: (targetRank - curRank) * ELITE_STEP_COST + tids.length,
                    key: `${op.name}|${targetElite}|${tids.slice().sort().join('+')}`
                };
            };
            for (const op of ops) {
                const curRank = rankOfElite(op.eliteLevel);
                if (curRank <= 0) continue;
                const missing = TALENT_ORDER.filter(tid => !(op.activatedTalents && op.activatedTalents[tid]) && getTalentList(rawData[op.name], tid).length);
                for (const tid of missing) {
                    const action = makeAction(op, [tid]);
                    if (action) out.push(action);
                }
                if (includePairs && missing.length >= 2) {
                    for (let i = 0; i < missing.length; i++) {
                        for (let j = i + 1; j < missing.length; j++) {
                            const action = makeAction(op, [missing[i], missing[j]]);
                            if (action) out.push(action);
                        }
                    }
                }
            }
            return out;
        }

        function chooseBest(actions) {
            let best = null;
            for (const action of actions) {
                if (seen.has(action.key)) continue;
                const nextOps = state.map(op => op.name === action.name
                    ? makePlanOperator(op, action.targetElite, action.talents, rawData)
                    : op);
                const q = runPlanSchedule(nextOps, options);
                const nextScore = objectiveOf(q);
                const gain = nextScore - score;
                if (gain <= 0.01) continue;
                const ratio = gain / Math.max(0.01, action.cost);
                if (!best || ratio > best.ratio + 1e-9 ||
                    (Math.abs(ratio - best.ratio) <= 1e-9 && gain > best.gain + 1e-9) ||
                    (Math.abs(ratio - best.ratio) <= 1e-9 && Math.abs(gain - best.gain) <= 1e-9 && action.cost < best.action.cost)) {
                    best = { action, nextOps, nextScore, gain, ratio };
                }
            }
            return best;
        }

        // 单步都没有收益时，检查跨干员双动作组合；用于发现“效率 + 另一人心情减耗”这类联动。
        function chooseBestPair(actions) {
            const valueOf = a => a.traits.reduce((s, t) => s + (Number(t.数值) || 0), 0);
            const pool = actions.filter(a => !seen.has(a.key)).sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 32);
            let best = null;
            for (let i = 0; i < pool.length; i++) {
                for (let j = i + 1; j < pool.length; j++) {
                    const a = pool[i], b = pool[j];
                    if (a.name === b.name) continue;
                    let nextOps = state.map(op => op.name === a.name
                        ? makePlanOperator(op, a.targetElite, a.talents, rawData) : op);
                    nextOps = nextOps.map(op => op.name === b.name
                        ? makePlanOperator(op, b.targetElite, b.talents, rawData) : op);
                    const q = runPlanSchedule(nextOps, options);
                    const nextScore = objectiveOf(q);
                    const gain = nextScore - score;
                    if (gain <= 0.01) continue;
                    const cost = a.cost + b.cost;
                    const ratio = gain / Math.max(0.01, cost);
                    if (!best || ratio > best.ratio + 1e-9 ||
                        (Math.abs(ratio - best.ratio) <= 1e-9 && gain > best.gain + 1e-9)) {
                        best = { a, b, nextOps, nextScore, gain, cost, ratio };
                    }
                }
            }
            return best;
        }

        for (let iter = 0; iter < 60; iter++) {
            if (iter % 5 === 0) await new Promise(resolve => setTimeout(resolve, 0));
            if (score >= targetScore - 0.01) break;
            // 先找单天赋；没有正收益时再尝试同干员双天赋、跨干员双动作。
            let best = chooseBest(actionsFor(state, false));
            if (!best) best = chooseBest(actionsFor(state, true));
            if (!best) {
                const pair = chooseBestPair(actionsFor(state, false));
                if (!pair) break;
                seen.add(pair.a.key);
                seen.add(pair.b.key);
                state = pair.nextOps;
                score = pair.nextScore;
                steps.push({ ...pair.a, gain: pair.gain / 2, scoreAfter: score });
                steps.push({ ...pair.b, gain: pair.gain / 2, scoreAfter: score });
                continue;
            }
            seen.add(best.action.key);
            state = best.nextOps;
            score = best.nextScore;
            steps.push({ ...best.action, gain: best.gain, scoreAfter: best.nextScore });
        }

        // 单步/双步都无正收益时，按满配目标排班里实际使用的干员补全缺失天赋；
        // 这样“只要还没到目标分就继续推荐”，最后由统一剪枝移除真正冗余的步骤。
        const targetNames = new Set();
        for (const rk of ['central', 'manufactA', 'manufactB', 'culture', 'meeting']) {
            const q = fullQueue[rk];
            if (!q) continue;
            for (const op of [...(q.round1 || []), ...(q.round2 || []), ...(q.recommend || [])]) {
                if (op && op.name) targetNames.add(op.name);
            }
        }
        for (let iter = 0; iter < 40 && score < targetScore - 0.01; iter++) {
            if (iter % 5 === 0) await new Promise(resolve => setTimeout(resolve, 0));
            const candidates = [];
            for (const op of state) {
                if (!targetNames.has(op.name)) continue;
                const missing = TALENT_ORDER.filter(tid =>
                    !(op.activatedTalents && op.activatedTalents[tid]) && getTalentList(rawData[op.name], tid).length
                );
                if (!missing.length) continue;
                const curRank = rankOfElite(op.eliteLevel);
                const targetRank = Math.max(curRank, ...missing.map(tid => TALENT_META[tid].minElite));
                const targetElite = eliteOfRank(targetRank);
                const missingTraits = missing.flatMap(tid => getTalentList(rawData[op.name], tid));
                if (currentHighNames.size >= 3 && missingTraits.length &&
                    missingTraits.every(t => t.舱室 === '总控中枢' && t.类型 === '心情恢复提升') &&
                    !currentHighNames.has(op.name)) continue;
                const talents = { ...(op.activatedTalents || {}) };
                missing.forEach(tid => { talents[tid] = true; });
                const nextOps = state.map(x => x.name === op.name ? makePlanOperator(x, targetElite, talents, rawData) : x);
                const q = runPlanSchedule(nextOps, options);
                const out = objectiveOf(q);
                const gain = out - score;
                const rawValue = missing.reduce((sum, tid) => {
                    const list = getTalentList(rawData[op.name], tid);
                    return sum + list.reduce((s, t) => s + (Number(t.数值) || 0), 0);
                }, 0);
                candidates.push({
                    name: op.name,
                    currentElite: op.eliteLevel,
                    targetElite,
                    tid: missing[0],
                    tids: missing,
                    talents,
                    traits: missing.flatMap(tid => getTalentList(rawData[op.name], tid)),
                    traitNames: missing.flatMap(tid => getTalentList(rawData[op.name], tid).map(t => t.name).filter(Boolean)),
                    cost: (targetRank - curRank) * ELITE_STEP_COST + missing.length,
                    nextOps, nextScore: out, gain,
                    value: rawValue / Math.max(1, (targetRank - curRank) * ELITE_STEP_COST + missing.length)
                });
            }
            if (!candidates.length) break;
            const positive = candidates.filter(c => c.gain > 0.01);
            const pick = positive.length
                ? positive.sort((a, b) => (b.gain / Math.max(1, b.cost)) - (a.gain / Math.max(1, a.cost)))[0]
                : candidates.sort((a, b) => b.value - a.value || b.gain - a.gain)[0];
            state = pick.nextOps;
            score = pick.nextScore;
            steps.push({
                name: pick.name, tid: pick.tid, tids: pick.tids,
                currentElite: pick.currentElite, targetElite: pick.targetElite,
                talents: pick.talents, traits: pick.traits, traitNames: pick.traitNames,
                cost: pick.cost, gain: pick.gain, forced: true, scoreAfter: score
            });
        }

        // 后处理：移除后续动作已经覆盖、或对最终分数没有影响的步骤。
        function applySteps(base, list) {
            let arr = base;
            for (const step of list) {
                arr = arr.map(op => op.name === step.name
                    ? makePlanOperator(op, step.targetElite, step.talents, rawData)
                    : op);
            }
            return arr;
        }
        if (steps.length > 1) {
            let pruned = steps.slice();
            // 先做单步冗余剔除
            for (let i = pruned.length - 1; i >= 0; i--) {
                const trial = pruned.filter((_, idx) => idx !== i);
                const trialOps = applySteps(currentOps, trial);
                const q = runPlanSchedule(trialOps, options);
                if (q && objectiveOf(q) >= score - 0.01) pruned = trial;
            }
            // 再做整干员剔除：如果去掉该干员全部动作仍不降分，说明其不是必要培养。
            const names = Array.from(new Set(pruned.map(s => s.name)));
            for (const name of names) {
                const trial = pruned.filter(s => s.name !== name);
                const trialOps = applySteps(currentOps, trial);
                const q = runPlanSchedule(trialOps, options);
                if (q && objectiveOf(q) >= score - 0.01) pruned = trial;
            }
            steps = pruned;
        }

        // 推荐层过滤：
        // 1) 总控已有高恢复组 3 人后，不再推荐其它干员的总控恢复天赋；
        // 2) 某舱 A/B 效率已经相等时，心情减耗单独动作不再推荐（效率动作保留）。
        if (steps.length) {
            const finalOps = applySteps(currentOps, steps);
            const finalQueue = runPlanSchedule(finalOps, options);
            if (finalQueue) {
                const centralTiming = finalQueue._timingInfo && finalQueue._timingInfo.central;
                let highNames = new Set();
                if (centralTiming) {
                    const highRound = centralTiming.round1IsEfficient ? 'round1' : 'round2';
                    for (const op of (finalQueue.central[highRound] || [])) highNames.add(op.name);
                }
                // timingInfo 缺失时，直接按两轮恢复量判断高恢复组。
                if (highNames.size < 3) {
                    const restoreOf = round => (finalQueue.central[round] || []).reduce((sum, op) =>
                        sum + (op.mergedTraits || []).reduce((s, t) =>
                            s + (t.舱室 === '总控中枢' && t.类型 === '心情恢复提升' ? (t.数值 || 0) : 0), 0), 0);
                    const round = restoreOf('round1') >= restoreOf('round2') ? 'round1' : 'round2';
                    highNames = new Set((finalQueue.central[round] || []).map(op => op.name));
                }
                const equalRooms = new Set();
                for (const rk of ['manufactA', 'manufactB', 'culture', 'meeting']) {
                    const t = finalQueue._timingInfo && finalQueue._timingInfo[rk];
                    if (t && Math.abs(Number(t.rA) - Number(t.rB)) < 1e-6) equalRooms.add(rk);
                }
                const filtered = steps.filter(step => {
                    const traits = step.traits || [];
                    const onlyCentralRecovery = traits.length > 0 && traits.every(t =>
                        t.舱室 === '总控中枢' && t.类型 === '心情恢复提升'
                    );
                    if (onlyCentralRecovery && highNames.size >= 3 && !highNames.has(step.name)) return false;
                    const moodOnly = traits.length > 0 && traits.every(t => t.类型 === '心情消耗减少');
                    if (moodOnly) {
                        const room = traits[0].舱室;
                        const roomKey = room === '制造舱' ? (step.name && null) : room === '培养舱' ? 'culture' : room === '会客室' ? 'meeting' : null;
                        // 制造舱需要区分 A/B 产物；用 finalQueue 的制造舱任一舱即可判断。
                        if (room === '制造舱') {
                            if (equalRooms.has('manufactA') || equalRooms.has('manufactB')) return false;
                        } else if (roomKey && equalRooms.has(roomKey)) {
                            return false;
                        }
                    }
                    return true;
                });
                if (filtered.length !== steps.length) {
                    const fq = runPlanSchedule(applySteps(currentOps, filtered), options);
                    if (fq && objectiveOf(fq) >= score - 0.01) {
                        steps = filtered;
                        score = objectiveOf(fq);
                    }
                }

                // 总控恢复最多保留三名不同的培养对象；已有一队高恢复后，
                // 再点第四名干员的总控恢复不应进入推荐。
                const centralOnly = steps.filter(step => {
                    const traits = step.traits || [];
                    return traits.length > 0 && traits.every(t => t.舱室 === '总控中枢' && t.类型 === '心情恢复提升');
                });
                const centralNames = new Set(centralOnly.map(s => s.name));
                if (centralNames.size > 3) {
                    const keep = new Set(highNames);
                    const capped = [];
                    const keptNames = new Set();
                    for (const step of steps) {
                        const traits = step.traits || [];
                        const isCentral = traits.length > 0 && traits.every(t => t.舱室 === '总控中枢' && t.类型 === '心情恢复提升');
                        if (isCentral) {
                            if (keep.size ? !keep.has(step.name) : keptNames.size >= 3) continue;
                            if (!keep.size) keptNames.add(step.name);
                        }
                        capped.push(step);
                    }
                    if (capped.length !== steps.length) {
                        const cq = runPlanSchedule(applySteps(currentOps, capped), options);
                        if (cq) {
                            steps = capped;
                            score = objectiveOf(cq);
                            // 总控只保留一队高恢复：满配目标也按同样的 3 人上限重算，
                            // 避免把低恢复班的多余天赋算进目标分。
                            if (highNames.size >= 3) {
                                const cappedFullOps = fullOps.map(op => {
                                    const talents = { ...(op.activatedTalents || {}) };
                                    if (!highNames.has(op.name)) {
                                        for (const tid of TALENT_ORDER) {
                                            const traits = getTalentList(rawData[op.name], tid);
                                            if (traits.length && traits.every(t => t.舱室 === '总控中枢' && t.类型 === '心情恢复提升')) {
                                                talents[tid] = false;
                                            }
                                        }
                                    }
                                    return makePlanOperator(op, '精四', talents, rawData);
                                });
                                const cappedFullQueue = runPlanSchedule(cappedFullOps, options);
                                if (cappedFullQueue) targetScore = objectiveOf(cappedFullQueue);
                            }
                        }
                    }
                }
            }
        }

        // 同一干员的多个天赋合并为一张卡；点击时只应用这条路线，不会自动满练。
        const byOp = new Map();
        for (const step of steps) {
            if (!byOp.has(step.name)) {
                byOp.set(step.name, {
                    name: step.name,
                    currentElite: step.currentElite,
                    targetElite: step.targetElite,
                    talents: {},
                    tids: [],
                    cost: 0,
                    gain: 0,
                    traits: [],
                    traitNames: [],
                    talentDetails: []
                });
            }
            const item = byOp.get(step.name);
            if (rankOfElite(step.targetElite) > rankOfElite(item.targetElite)) item.targetElite = step.targetElite;
            const stepTids = step.tids && step.tids.length ? step.tids : [step.tid];
            for (const tid of stepTids) {
                item.talents[tid] = true;
                if (!item.tids.includes(tid)) item.tids.push(tid);
                const traits = getTalentList(rawData[step.name], tid);
                item.talentDetails.push({
                    tid,
                    name: traits.map(t => t.name).filter(Boolean)[0] || TALENT_META[tid].label,
                    effects: traits.map(t => formatShortTrait(t)),
                    traits,
                    icon: getTalentIconPath(traits),
                    targetElite: step.targetElite,
                    cost: step.cost
                });
            }
            item.cost += step.cost;
            item.gain += step.gain;
            item.traits.push(...step.traits);
            item.traitNames.push(...(step.traitNames || []));
        }

        // 当前练度下单独评估也有效、但未被主路线选中的替代项（例如明河）。
        const alternatives = [];
        if (steps.length) {
            for (const action of actionsFor(currentOps, false)) {
                if (byOp.has(action.name)) continue;
                const nextOps = currentOps.map(op => op.name === action.name
                    ? makePlanOperator(op, action.targetElite, action.talents, rawData)
                    : op);
                const q = runPlanSchedule(nextOps, options);
                const gain = objectiveOf(q) - startScore;
                if (gain > 0.01) {
                    alternatives.push({ ...action, gain });
                }
            }
            alternatives.sort((a, b) => b.gain - a.gain);
        }

        const unactivated = [];
        for (const op of currentOps) {
            for (const tid of TALENT_ORDER) {
                if (op.activatedTalents && op.activatedTalents[tid]) continue;
                const traits = getTalentList(rawData[op.name], tid);
                if (!traits.length) continue;
                unactivated.push({
                    name: op.name,
                    elite: op.eliteLevel,
                    tid,
                    room: traits[0].舱室 || '',
                    traitNames: traits.map(t => t.name).filter(Boolean),
                    effects: traits.map(t => formatShortTrait(t)),
                    traits,
                    icon: getTalentIconPath(traits)
                });
            }
        }
        unactivated.sort((a, b) => a.name.localeCompare(b.name, 'zh') || a.tid.localeCompare(b.tid));

        // 材料优先级转换建议：同一干员同时有效率和培养物天赋时，
        // 即使当前 scheduler 把他放在低优先级舱室，也提示更高优先级材料的天赋。
        const materialOrder = Array.isArray(options.materialPriority)
            ? options.materialPriority : ['clue', 'weapon', 'exp', 'culture'];
        const materialIndex = m => materialOrder.indexOf(m);
        const traitMaterial = t => {
            if (t.舱室 === '会客室') return 'clue';
            if (t.舱室 === '培养舱') return 'culture';
            if (t.舱室 === '制造舱') {
                if (t.类型 === '武器素材效率') return 'weapon';
                if (t.类型 === '干员素材效率') return 'exp';
            }
            return '';
        };
        const assignedRoom = name => {
            for (const rk of ['central', 'manufactA', 'manufactB', 'culture', 'meeting']) {
                const q = currentQueue[rk];
                if (!q) continue;
                for (const round of ['round1', 'round2']) {
                    if ((q[round] || []).some(op => op.name === name)) return rk;
                }
            }
            return '';
        };
        const roomMaterial = rk => {
            if (rk === 'culture') return 'culture';
            if (rk === 'meeting') return 'clue';
            if (rk === 'manufactA' || rk === 'manufactB') {
                return (options.manufactProducts && options.manufactProducts[rk]) || 'exp';
            }
            return '';
        };
        const prioritySuggestions = [];
        for (const op of currentOps) {
            const curRoom = assignedRoom(op.name);
            const curMaterial = roomMaterial(curRoom);
            if (!curMaterial) continue;
            const missing = [];
            for (const tid of TALENT_ORDER) {
                if (op.activatedTalents && op.activatedTalents[tid]) continue;
                const traits = getTalentList(rawData[op.name], tid);
                if (!traits.length) continue;
                for (const t of traits) {
                    const m = traitMaterial(t);
                    if (m && materialIndex(m) >= 0 && materialIndex(m) < materialIndex(curMaterial)) {
                        missing.push({ tid, traits });
                        break;
                    }
                }
            }
            if (!missing.length) continue;
            const tids = missing.map(x => x.tid);
            const traits = missing.flatMap(x => x.traits);
            const targetMaterial = traitMaterial(traits[0]);
            const curRank = rankOfElite(op.eliteLevel);
            const targetRank = Math.max(curRank, ...tids.map(tid => TALENT_META[tid].minElite));
            const talents = { ...(op.activatedTalents || {}) };
            tids.forEach(tid => { talents[tid] = true; });
            prioritySuggestions.push({
                name: op.name,
                fromMaterial: curMaterial,
                toMaterial: targetMaterial,
                tids,
                targetElite: eliteOfRank(targetRank),
                talents,
                traits,
                traitNames: Array.from(new Set(traits.map(t => t.name).filter(Boolean))),
                cost: (targetRank - curRank) * ELITE_STEP_COST + tids.length
            });
        }
        prioritySuggestions.sort((a, b) => materialIndex(a.toMaterial) - materialIndex(b.toMaterial) || b.cost - a.cost);
        if (score > targetScore) targetScore = score;

        return {
            empty: false,
            currentQueue,
            fullQueue,
            startScore,
            targetScore,
            plannedScore: score,
            steps,
            alternatives: alternatives.slice(0, 12),
            unactivated,
            prioritySuggestions,
            byOp: Array.from(byOp.values()).sort((a, b) => b.gain - a.gain),
            coreByOp: Array.from(byOp.values()).filter(x => x.gain >= 1).sort((a, b) => b.gain - a.gain),
            optionalByOp: Array.from(byOp.values()).filter(x => x.gain < 1).sort((a, b) => b.gain - a.gain),
            cost: steps.reduce((a, x) => a + x.cost, 0)
        };
    }

    function prioritySectionHtml(plan) {
        const items = plan.prioritySuggestions || [];
        if (!items.length) return '';
        return `<div class="dev-room-card" style="margin-top:12px;">
            <div class="dev-room-title">材料优先级转换建议 <span class="dev-count">${items.length}</span></div>
            <div style="padding:6px 12px 10px;color:#6b7b73;font-size:0.78rem;">同一干员同时有效率和培养物天赋；当前排班在低优先级舱室，若想按材料优先级培养，可单独点这些天赋。</div>
            <div class="dev-list">${items.map((a, i) => `<div class="dev-item">
                <img class="dev-avatar" src="${getAgentImgSrc(a.name)}" onerror="this.onerror=null; this.src='${AVATAR_FALLBACK}';" alt="">
                <div class="dev-item-body">
                    <div class="dev-item-header"><span class="dev-name">${escapeHtml(a.name)}</span><span class="dev-badge point">${escapeHtml(a.fromMaterial)} → ${escapeHtml(a.toMaterial)}</span><button type="button" class="dev-badge point" data-priority-index="${i}" style="cursor:pointer;border:0;">应用</button></div>
                    <div class="dev-item-elite">天赋：${escapeHtml(a.traitNames.join(' / '))}</div>
                    <div class="dev-item-traits"><div class="dev-trait"><span>${escapeHtml(a.traits.map(t => formatShortTrait(t)).join('、'))}</span></div></div>
                </div>
            </div>`).join('')}</div>
        </div>`;
    }

    function bindPriorityButtons(plan, rawData) {
        document.querySelectorAll('[data-priority-index]').forEach(btn => {
            btn.addEventListener('click', () => {
                const item = (plan.prioritySuggestions || [])[Number(btn.dataset.priorityIndex)];
                if (!item) return;
                const config = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}') || {};
                const entry = parseConfigEntry(config[item.name] || 'none');
                const talents = new Set(entry.talents || []);
                item.tids.forEach(tid => talents.add(tid));
                config[item.name] = { elite: item.targetElite, talents: Array.from(talents) };
                sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
                alert(`【${item.name}】已按材料优先级补点天赋。`);
                init();
            });
        });
    }

    function renderMinimalPlan(plan, rawData) {
        const grid = document.getElementById('devTopGrid');
        const content = document.getElementById('devContent');
        const overview = document.getElementById('devOverview');
        if (!grid || !content) return;
        selectedPlanNames = new Set();
        const actionBar = document.getElementById('devPlanActions');
        if (actionBar) { actionBar.classList.remove('show'); actionBar.innerHTML = ''; }
        if (plan.empty) {
            grid.innerHTML = '<p class="dev-empty">暂无拥有干员，无法计算提升路线</p>';
            content.innerHTML = '';
            return;
        }
        if (plan.failed) {
            grid.innerHTML = '<p class="dev-error">排班评估失败，请刷新后重试</p>';
            return;
        }
        renderSimpleSchedule(plan.fullQueue);

        const gap = Math.max(0, plan.targetScore - plan.plannedScore);
        overview.innerHTML =
            '<div class="dev-stat"><div class="dev-stat-num">' + plan.startScore.toFixed(1) + '</div><div class="dev-stat-label">当前模拟分</div></div>' +
            '<div class="dev-stat"><div class="dev-stat-num">' + plan.plannedScore.toFixed(1) + '</div><div class="dev-stat-label">路线后模拟分</div></div>' +
            '<div class="dev-stat"><div class="dev-stat-num">' + plan.targetScore.toFixed(1) + '</div><div class="dev-stat-label">满配目标分</div></div>' +
            '<div class="dev-stat"><div class="dev-stat-num">' + plan.cost + '</div><div class="dev-stat-label">路线总代价</div></div>';

        if (plan.byOp.length === 0) {
            grid.innerHTML = '<p class="dev-empty" style="grid-column:1/-1; text-align:center; color:#3f7e6b; padding:20px 0;">🎉 当前阵容已经达到该策略下的模拟最优，不需要额外培养。</p>';
            content.innerHTML = '<div class="dev-empty-box"><p>当前干员练度已经覆盖该生产策略下的最优排班。</p><p>等价干员、总控替补和不需要的天赋不会被推荐。</p></div>' + prioritySectionHtml(plan);
            bindPriorityButtons(plan, rawData);
            renderUnactivated(plan);
            return;
        }

        const displayItems = plan.byOp.filter(x => x.gain > 0.01);
        selectedPlanNames = new Set();
        if (displayItems.length === 0) {
            grid.innerHTML = '<p class="dev-empty" style="grid-column:1/-1; text-align:center; color:#6b7b73; padding:16px 0;">当前没有单项收益 ≥1 分的重点提升；下方仅列出边际补强。</p>';
        } else {
            grid.innerHTML = displayItems.map(item => {
                const imgSrc = getAgentImgSrc(item.name);
                const talentText = item.traitNames.length ? item.traitNames.join(' / ') : item.tids.map(tid => TALENT_META[tid].label).join('/');
                const tipLines = (item.talentDetails || []).map(d => {
                    const icon = d.icon ? `<img class="tip-talent-icon" src="${d.icon}" onerror="this.style.display='none';">` : '<span class="tip-talent-placeholder"></span>';
                    return `<div class="tip-talent">${icon}<div class="tip-talent-body"><div class="tip-talent-name">${escapeHtml(d.name)}</div><div class="tip-talent-effect">${escapeHtml(d.effects.join('、'))}</div></div></div>`;
                }).join('');
                const tooltip = `<div class="dev-plan-tooltip"><div class="tip-title">${escapeHtml(item.name)} 需要点满的天赋</div>${tipLines || '<div class="tip-line">—</div>'}</div>`;
                return `<div class="dev-top-card" data-plan-name="${escapeHtml(item.name)}" title="点击选择该干员，最后统一应用">
                    <span class="dev-select-check">✓</span>
                    <img src="${imgSrc}" onerror="this.onerror=null; this.src='${AVATAR_FALLBACK}';" alt="${escapeHtml(item.name)}">
                    <div class="name">${escapeHtml(item.name)}</div>
                    <div class="badge">+${item.gain.toFixed(1)}分</div>
                    <div class="dev-plan-card-meta">需点满：${escapeHtml(talentText)}</div>
                    ${tooltip}
                </div>`;
            }).join('');
        }

        content.innerHTML = `<div class="dev-room-card">
            <div class="dev-room-title">最小提升路线 <span class="dev-count">${plan.steps.length} 步 / 代价 ${plan.cost}</span></div>
            <div class="dev-list">${plan.steps.map((s, i) => {
                const traitText = s.traits.map(t => escapeHtml(formatShortTrait(t))).join('、');
                const talentName = (s.traitNames && s.traitNames.length) ? s.traitNames.join(' / ') : TALENT_META[s.tid].label;
                const optional = s.gain < 1 ? '<span class="dev-badge point" style="background:#f5f5f5;color:#888;">边际</span>' : '';
                return `<div class="dev-item">
                    <img class="dev-avatar" src="${getAgentImgSrc(s.name)}" onerror="this.onerror=null; this.src='${AVATAR_FALLBACK}';" alt="">
                    <div class="dev-item-body">
                        <div class="dev-item-header"><span class="dev-name">${i + 1}. ${escapeHtml(s.name)}</span><span class="dev-star">+${s.gain.toFixed(1)}分</span><span class="dev-badge point">代价 ${s.cost}</span>${optional}</div>
                        <div class="dev-item-elite">天赋：${escapeHtml(talentName)}</div>
                        <div class="dev-item-traits"><div class="dev-trait"><span>${traitText}</span></div></div>
                    </div>
                </div>`;
            }).join('')}</div>
        </div>
        ${plan.alternatives && plan.alternatives.length ? `<div class="dev-room-card" style="margin-top:12px;">
            <div class="dev-room-title">可单独提升的替代选项 <span class="dev-count">${plan.alternatives.length}</span></div>
            <div style="padding:6px 12px 10px;color:#6b7b73;font-size:0.78rem;">这些天赋在当前练度下单独点也有收益，但主路线选择了其他更优组合；可作为备选。</div>
            <div class="dev-list">${plan.alternatives.map(a => {
                const names = a.traitNames.length ? a.traitNames.join(' / ') : TALENT_META[a.tid].label;
                return `<div class="dev-item">
                    <img class="dev-avatar" src="${getAgentImgSrc(a.name)}" onerror="this.onerror=null; this.src='${AVATAR_FALLBACK}';" alt="">
                    <div class="dev-item-body">
                        <div class="dev-item-header"><span class="dev-name">${escapeHtml(a.name)}</span><span class="dev-star">+${a.gain.toFixed(1)}分</span><span class="dev-badge point">代价 ${a.cost}</span></div>
                        <div class="dev-item-elite">天赋：${escapeHtml(names)}</div>
                    </div>
                </div>`;
            }).join('')}</div>
        </div>` : ''}
        ${prioritySectionHtml(plan)}
        <div class="dev-room-card" style="margin-top:12px;">
            <div class="dev-room-title">模拟说明</div>
            <div style="padding:8px 12px;color:#666;font-size:0.82rem;line-height:1.7;">
                当前分与目标分使用与自动排班页完全相同的生产策略和 scheduler 计算。
                只枚举“缺失天赋 + 解锁所需精英阶段”，不再默认把干员全部点满。
                上方列出当前路线中所有正收益可选项；低于 1 分的显示为边际补强。
                若某种培养对最终 24h 目标没有可观测收益，本路线不会推荐它。
                ${gap > 0.01 ? `<br>仍有 ${gap.toFixed(1)} 分差距，说明当前单步枚举没有找到更高收益动作。` : '<br>路线已达到满配模拟目标分。'}
            </div>
        </div>`;

        grid.querySelectorAll('[data-plan-name]').forEach(card => {
            card.addEventListener('click', () => {
                const name = card.dataset.planName;
                if (selectedPlanNames.has(name)) {
                    selectedPlanNames.delete(name);
                    card.classList.remove('selected');
                } else {
                    selectedPlanNames.add(name);
                    card.classList.add('selected');
                }
                updatePlanToolbar();
            });
        });
        renderPlanToolbar(displayItems, plan);
        bindPriorityButtons(plan, rawData);
        renderUnactivated(plan);
    }

    let devUnactivatedRoom = 'all';
    function renderUnactivated(plan) {
        const box = document.getElementById('devUnactivated');
        const body = document.getElementById('devUnactivatedBody');
        const count = document.getElementById('devUnactivatedCount');
        if (!box || !body) return;
        const items = plan.unactivated || [];
        if (!items.length) { box.hidden = true; return; }
        box.hidden = false;
        count.textContent = `(${items.length})`;
        const rooms = ['all', '总控中枢', '制造舱', '培养舱', '会客室'];
        const renderList = () => {
            const filters = rooms.map(r => `<button type="button" data-u-room="${r}" class="${devUnactivatedRoom === r ? 'active' : ''}">${r === 'all' ? '全部' : r}</button>`).join('');
            const list = items.filter(x => devUnactivatedRoom === 'all' || x.room === devUnactivatedRoom);
            body.innerHTML = `<div class="dev-unactivated-filters">${filters}</div><div class="dev-unactivated-grid">${list.map(x => `
                <div class="dev-unactivated-item">
                    <img src="${getAgentImgSrc(x.name)}" onerror="this.onerror=null; this.src='${AVATAR_FALLBACK}';" alt="">
                    <div>
                        <div><span class="u-name">${escapeHtml(x.name)}</span> <span class="u-meta">${escapeHtml(x.room)}</span></div>
                        <div class="u-meta">${escapeHtml(x.traitNames.join(' / ') || TALENT_META[x.tid].label)}</div>
                        <div class="u-meta">${escapeHtml(x.effects.join('、'))}</div>
                    </div>
                </div>`).join('') || '<div class="u-meta">该舱室没有未点天赋</div>'}</div>`;
            body.querySelectorAll('[data-u-room]').forEach(btn => {
                btn.addEventListener('click', () => {
                    devUnactivatedRoom = btn.dataset.uRoom;
                    renderList();
                });
            });
        };
        renderList();
    }

    function renderPlanToolbar(displayItems, plan) {
        const bar = document.getElementById('devPlanActions');
        if (!bar) return;
        if (!displayItems.length) {
            bar.classList.remove('show');
            bar.innerHTML = '';
            return;
        }
        bar.classList.add('show');
        bar.innerHTML = `
            <button type="button" id="devPlanSelectAll">全选提升项</button>
            <button type="button" id="devPlanClear">清空选择</button>
            <button type="button" class="primary" id="devPlanApply">应用选中（0）</button>
            <span class="plan-selected-count" id="devPlanSelectedCount">已选 0 / ${displayItems.length}</span>
        `;
        const allNames = displayItems.map(x => x.name);
        bar.querySelector('#devPlanSelectAll').addEventListener('click', () => {
            selectedPlanNames = new Set(allNames);
            document.querySelectorAll('#devTopGrid [data-plan-name]').forEach(c => c.classList.add('selected'));
            updatePlanToolbar();
        });
        bar.querySelector('#devPlanClear').addEventListener('click', () => {
            selectedPlanNames.clear();
            document.querySelectorAll('#devTopGrid [data-plan-name]').forEach(c => c.classList.remove('selected'));
            updatePlanToolbar();
        });
        bar.querySelector('#devPlanApply').addEventListener('click', () => applySelectedPlans(plan));
        updatePlanToolbar();
    }

    function updatePlanToolbar() {
        const count = selectedPlanNames.size;
        const btn = document.getElementById('devPlanApply');
        const label = document.getElementById('devPlanSelectedCount');
        if (btn) {
            btn.textContent = `应用选中（${count}）`;
            btn.disabled = count === 0;
        }
        if (label) label.textContent = `已选 ${count}`;
    }

    function applySelectedPlans(plan) {
        if (selectedPlanNames.size === 0) return;
        const items = plan.byOp.filter(x => selectedPlanNames.has(x.name));
        if (!items.length) return;
        const raw = sessionStorage.getItem(STORAGE_KEY);
        let config = {};
        try { config = JSON.parse(raw) || {}; } catch (e) {}
        let added = 0, cost = 0;
        const lines = [];
        for (const item of items) {
            const entry = parseConfigEntry(config[item.name] || 'none');
            const talentSet = new Set(entry.talents || []);
            item.tids.forEach(tid => talentSet.add(tid));
            config[item.name] = { elite: item.targetElite, talents: Array.from(talentSet) };
            added += item.tids.length;
            cost += item.cost;
            lines.push(`${item.name}：${item.tids.map(tid => TALENT_META[tid].label).join('、')}`);
        }
        const msg = `一次应用 ${items.length} 名干员的天赋提升？\n\n` +
            lines.join('\n') + `\n\n总代价：${cost}\n\n` +
            `不会自动点满未列出的天赋。`;
        if (!confirm(msg)) return;
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        selectedPlanNames.clear();
        alert(`已应用 ${items.length} 名干员的提升路线。`);
        init();
    }

    function applyPlanOperator(name, plan, rawData) {
        const item = plan.byOp.find(x => x.name === name);
        if (!item) return;
        const raw = sessionStorage.getItem(STORAGE_KEY);
        let config = {};
        try { config = JSON.parse(raw) || {}; } catch (e) {}
        const entry = parseConfigEntry(config[name] || 'none');
        const currentTalentSet = new Set(entry.talents || []);
        item.tids.forEach(tid => currentTalentSet.add(tid));
        const talentNames = item.tids.map(tid => TALENT_META[tid].label).join('、');
        const msg = `应用【${name}】需要点满的天赋？\n\n` +
            `需要点满：${talentNames}\n` +
            `预计代价：${item.cost}\n\n` +
            `不会自动点满其它天赋。`;
        if (!confirm(msg)) return;
        config[name] = {
            elite: item.targetElite,
            talents: Array.from(currentTalentSet)
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        alert(`【${name}】已按最小路线提升。`);
        init();
    }

    // ========== ★ 旧版全量顶配列表（保留供旧页面兼容，不再由 init 调用） ==========
    function generateTopRecommendation(rawData, config) {
        const grid = document.getElementById('devTopGrid');
        if (!window.DijiangScheduler) {
            grid.innerHTML = '<p class="dev-error">算法核心模块未加载</p>';
            return;
        }

        const maxOps = [];
        const liveOps = (window.DijiangAPI && typeof window.DijiangAPI.getOperators === 'function')
            ? window.DijiangAPI.getOperators().filter(op => op.eliteLevel !== 'none')
            : [];
        if (liveOps.length) {
            const fullTalents = { '1_1': true, '2_1': true, '1_2': true, '2_2': true };
            for (const op of liveOps) {
                maxOps.push({
                    ...op,
                    eliteLevel: '精四',
                    activatedTalents: { ...fullTalents },
                    mergedTraits: calcMergedTraits(op.name, fullTalents, rawData)
                });
            }
        } else {
        for (const [name, val] of Object.entries(config)) {
            const entry = parseConfigEntry(val);
            if (entry.elite === 'none') continue;
            const fullTalents = { '1_1': true, '2_1': true, '1_2': true, '2_2': true };
            maxOps.push({
                id: name, name,
                eliteLevel: '精四',
                activatedTalents: fullTalents,
                mergedTraits: calcMergedTraits(name, fullTalents, rawData)
            });
        }
        }

        if (maxOps.length === 0) {
            grid.innerHTML = '<p class="dev-empty">暂无拥有干员，无法模拟</p>';
            return;
        }

        let roomModes = { central: 'double', manufactA: 'double', manufactB: 'double', culture: 'double', meeting: 'double' };
        try { const rm = sessionStorage.getItem('DijiangRoomModes'); if (rm) roomModes = JSON.parse(rm); } catch (e) {}
        
        let p1 = ['meeting', 'central', 'manufactA', 'manufactB', 'culture'];
        let p2 = ['meeting', 'manufactA', 'manufactB', 'culture', 'central'];
        try {
            const s1 = sessionStorage.getItem('DijiangRoomPriorityOrderRound1'); if (s1) p1 = JSON.parse(s1);
            const s2 = sessionStorage.getItem('DijiangRoomPriorityOrderRound2'); if (s2) p2 = JSON.parse(s2);
        } catch (e) {}

        let manufMode = 'dual';
        try {
            const dp = sessionStorage.getItem('DijiangDefaultProduct');
            if (dp) { const p = JSON.parse(dp); if (p.manufactA === p.manufactB) manufMode = p.manufactA; }
        } catch (e) {}

        let meetingPriority = false;
        try { meetingPriority = sessionStorage.getItem('meetingPriority') === 'true'; } catch (e) {}

        // 与自动排班页共用同一份策略解析，避免预览页使用旧默认值。
        let options;
        if (typeof window.DijiangBuildOptions === 'function') {
            options = window.DijiangBuildOptions();
        } else {
            try {
                const rawSnap = sessionStorage.getItem('DijiangLastStrategySnapshot');
                if (rawSnap) {
                    const snap = JSON.parse(rawSnap);
                    snap.missingClues = new Set(Array.isArray(snap.missingClues) ? snap.missingClues : []);
                    snap.excludedClues = new Set(Array.isArray(snap.excludedClues) ? snap.excludedClues : [3,7]);
                    snap.trustedAgentIds = Array.isArray(snap.trustedAgentIds) ? snap.trustedAgentIds : [];
                    options = snap;
                }
            } catch (e) {}
        }
        if (!options) {
        options = {
            mode: manufMode, doubleRooms: Object.keys(roomModes).filter(k => roomModes[k] === 'double'),
            roomModes: roomModes, emptyRooms: Object.keys(roomModes).filter(k => roomModes[k] === 'empty'),
            centralDisabled: (roomModes.central === 'empty'), isTrustMode: false, trustedAgentIds: [], trustAssignMap: {},
            priorityOrderRound1: p1, priorityOrderRound2: p2, meetingPriorityEnabled: meetingPriority,
            missingClues: new Set(), excludedClues: new Set([3,7]),
            materialPriority: ['clue','weapon','exp','culture'], priorityFillEnabled: false, underfillRoom: 'central',
            cultureTypes: ['plant', 'mineral', 'fungi'], culturePriority: ['plant', 'mineral', 'fungi'],
            priorityWeights: [1.0, 0.6, 0.3], cRestHigh: 12 * 1.48
        };
        }

        let queues = null;
        try { queues = window.DijiangScheduler.generateSchedule(maxOps, options); } catch (err) {
            console.error('顶配排班失败:', err);
            grid.innerHTML = '<p class="dev-error">计算排班时发生错误</p>';
            return;
        }

        renderSimpleSchedule(queues);

        topRoomMap = {};
        const ROOM_MAP = { central: '总控中枢', manufactA: '制造舱', manufactB: '制造舱', culture: '培养舱', meeting: '会客室' };
        
        ['central', 'manufactA', 'manufactB', 'culture', 'meeting'].forEach(roomKey => {
            const d = queues[roomKey];
            if (!d) return;
            const roomName = ROOM_MAP[roomKey];
            
            const addRooms = (arr, tag) => { 
                (arr || []).forEach(o => {
                    if (!o) return;
                    if (!topRoomMap[o.name]) topRoomMap[o.name] = new Set();
                    topRoomMap[o.name].add(tag);
                }); 
            };

            if (roomKey === 'central') {
                if (d.round1 && d.round1.length > 0) addRooms(d.round1, '总控中枢(低效)');
                if (d.round2 && d.round2.length > 0) addRooms(d.round2, '总控中枢');
                if ((!d.round1 || d.round1.length === 0) && (!d.round2 || d.round2.length === 0)) {
                    addRooms(d.recommend, '总控中枢');
                }
            } else {
                addRooms(d.recommend, roomName); 
                addRooms(d.round1, roomName); 
                addRooms(d.round2, roomName);
            }
        });

        if (Object.keys(topRoomMap).length === 0) {
            grid.innerHTML = '<p class="dev-empty">当前策略下无需干员（舱室可能为空置）</p>';
            return;
        }

        const groups = {
            '总控中枢': [],
            '制造舱': [],
            '培养舱': [],
            '会客室': []
        };

        Object.keys(topRoomMap).forEach(name => {
            const entry = parseConfigEntry(config[name] || 'none');
            const assignedRooms = Array.from(topRoomMap[name]);
            const targetRoomsForTalents = assignedRooms.filter(r => r !== '总控中枢(低效)');

            let missingTargetTalents = [];
            TALENT_ORDER.forEach(tid => {
                if (entry.talents.includes(tid)) return;
                const tList = getTalentList(rawData[name], tid);
                if (tList.some(t => targetRoomsForTalents.includes(t.舱室))) {
                    missingTargetTalents.push(tid);
                }
            });

            if (missingTargetTalents.length === 0) return;

            let primaryGroup = '';
            if (targetRoomsForTalents.includes('总控中枢')) primaryGroup = '总控中枢';
            else if (targetRoomsForTalents.includes('制造舱')) primaryGroup = '制造舱';
            else if (targetRoomsForTalents.includes('培养舱')) primaryGroup = '培养舱';
            else if (targetRoomsForTalents.includes('会客室')) primaryGroup = '会客室';

            if (primaryGroup && groups[primaryGroup]) {
                groups[primaryGroup].push({ name, assignedRooms: targetRoomsForTalents });
            }
        });

        let html = '';
        const groupKeys = ['总控中枢', '制造舱', '培养舱', '会客室'];
        let isFirstGroup = true;

        groupKeys.forEach(gk => {
            const list = groups[gk];
            if (list.length === 0) return;

            if (!isFirstGroup) {
                html += `<div class="dev-group-divider"></div>`;
            }
            isFirstGroup = false;

            list.forEach(item => {
                const imgSrc = getAgentImgSrc(item.name);
                const roomStr = item.assignedRooms.join('/');
                html += `
                    <div class="dev-top-card" data-name="${item.name}" title="顶配位置：${roomStr}">
                        <img src="${imgSrc}" onerror="this.onerror=null; this.src='${AVATAR_FALLBACK}';" alt="${item.name}">
                        <div class="name">${escapeHtml(item.name)}</div>
                        <div class="badge">需提升</div>
                    </div>
                `;
            });
        });
        
        if (html === '') {
            html = '<p class="dev-empty" style="grid-column:1/-1; text-align:center; color:#3f7e6b; padding:20px 0;">🎉 顶配排班所需生效天赋均已满练！</p>';
        }
        
        grid.innerHTML = html;

        grid.querySelectorAll('.dev-top-card').forEach(card => {
            card.addEventListener('click', () => handleQuickUpgrade(card.dataset.name, rawData));
        });
    }

    // ========== ★ 快捷升级逻辑 (按舱室精准推荐) ==========
    function handleQuickUpgrade(name, rawData) {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        let config = {};
        try { config = JSON.parse(raw) || {}; } catch (e) {}
        
        const entry = parseConfigEntry(config[name] || 'none');
        const rawOpData = rawData[name] || {};
        const assignedRooms = topRoomMap[name] ? Array.from(topRoomMap[name]) : [];
        const targetRoomsForTalents = assignedRooms.filter(r => r !== '总控中枢(低效)');
        let missingDesc = [];
        
        if (entry.elite === 'none') missingDesc.push('未拥有该干员');
        else {
            if (entry.elite !== '精四') missingDesc.push(`等级提升至精四 (当前:${entry.elite})`);
            const currentTalents = new Set(entry.talents);
            
            TALENT_ORDER.forEach(tid => {
                if (!currentTalents.has(tid)) {
                    const tList = getTalentList(rawOpData, tid);
                    const neededTraits = targetRoomsForTalents.length > 0 
                        ? tList.filter(t => targetRoomsForTalents.includes(t.舱室))
                        : tList;

                    if (neededTraits.length > 0) {
                        const tName = (neededTraits[0].name) ? neededTraits[0].name : tid;
                        missingDesc.push(`天赋[${neededTraits[0].舱室}]：${tName}`);
                    }
                }
            });
        }

        if (missingDesc.length === 0) return;

        const confirmMsg = `是否一键将【${name}】提升至精四满天赋？\n\n顶配排班中他将前往：${targetRoomsForTalents.join('、') || '任意舱室'}\n\n需要补充：\n${missingDesc.join('\n')}`;
        if (!confirm(confirmMsg)) return;

        config[name] = { elite: '精四', talents: ['1_1', '2_1', '1_2', '2_2'] };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));

        alert(`【${name}】已一键提升至满练状态！`);
        init();
    }

    // ========== 原有分析逻辑 (展示全量缺失天赋) ==========
    function analyze(rawData, config) {
        const recommendations = {};
        ROOM_ORDER.forEach(r => recommendations[r] = []);
    
        for (const [name, val] of Object.entries(config)) {
            const opData = rawData[name];
            if (!opData) continue;
            const entry = parseConfigEntry(val);
            const curRank = ELITE_RANK[entry.elite];
            if (curRank === 0) continue;
    
            const activated = new Set(entry.talents);
            const byRoom = {};
    
            for (const tid of TALENT_ORDER) {
                if (activated.has(tid)) continue;
                const meta = TALENT_META[tid];
                const traits = getTalentList(opData, tid);
                if (!traits.length) continue;
    
                const isUpgrade = curRank < meta.minElite;
                const type = isUpgrade ? '升级' : '补点';
    
                for (const t of traits) {
                    const room = t.舱室;
                    if (!room || ROOM_ORDER.indexOf(room) === -1) continue;
    
                    if (!byRoom[room]) byRoom[room] = {};
                    if (!byRoom[room][type]) {
                        byRoom[room][type] = {
                            type: type,
                            targetElite: isUpgrade ? meta.label : null,
                            traits: [],
                        };
                    }
                    if (isUpgrade) {
                        const cur = byRoom[room][type].targetElite;
                        const curRankNum = cur ? ELITE_RANK[cur] : 0;
                        if (ELITE_RANK[meta.label] > curRankNum) byRoom[room][type].targetElite = meta.label;
                    }
                    byRoom[room][type].traits.push(Object.assign({ _tid: tid }, t));
                }
            }
    
            for (const [room, typeMap] of Object.entries(byRoom)) {
                for (const info of Object.values(typeMap)) {
                    recommendations[room].push({
                        name: name, star: opData.star || '未知', attribute: opData.attribute || '未知',
                        elite: entry.elite, targetElite: info.targetElite, type: info.type, traits: info.traits,
                    });
                }
            }
        }
    
        for (const room of ROOM_ORDER) {
            recommendations[room].sort((a, b) => {
                if (a.type !== b.type) return a.type === '补点' ? -1 : 1;
                const aMax = Math.max.apply(null, a.traits.map(t => t.数值 || 0));
                const bMax = Math.max.apply(null, b.traits.map(t => t.数值 || 0));
                if (aMax !== bMax) return bMax - aMax;
                const aDiff = a.targetElite ? ELITE_RANK[a.targetElite] - ELITE_RANK[a.elite] : 0;
                const bDiff = b.targetElite ? ELITE_RANK[b.targetElite] - ELITE_RANK[b.elite] : 0;
                return aDiff - bDiff;
            });
        }
        return recommendations;
    }

    function summarize(recommendations) {
        let total = 0, upgrades = 0, points = 0;
        for (const room of ROOM_ORDER) {
            for (const r of (recommendations[room] || [])) {
                total++;
                if (r.type === '升级') upgrades++;
                else points++;
            }
        }
        return { total, upgrades, points };
    }

    function renderItem(item) {
        const badge = item.type === '升级' ? '<span class="dev-badge upgrade">升级</span>' : '<span class="dev-badge point">补点</span>';
        const eliteInfo = item.type === '升级' ? escapeHtml(item.elite) + ' → ' + escapeHtml(item.targetElite) : escapeHtml(item.elite) + ' <span class="dev-elite-note">(已解锁·未激活)</span>';
        const imgSrc = getAgentImgSrc(item.name);
        const traitList = item.traits.map(function (t) {
            const icon = getTalentIconPath([t]);
            const iconTag = icon ? '<img src="' + icon + '" class="dev-trait-icon" onerror="this.style.display=\'none\';" alt="">' : '';
            return '<div class="dev-trait">' + iconTag + '<span>' + escapeHtml(formatShortTrait(t)) + '</span></div>';
        }).join('');

        return '<div class="dev-item">' +
            '<img class="dev-avatar" src="' + imgSrc + '" onerror="this.onerror=null; this.src=\'' + AVATAR_FALLBACK + '\';" alt="' + escapeHtml(item.name) + '">' +
            '<div class="dev-item-body">' +
                '<div class="dev-item-header">' +
                    '<span class="dev-name">' + escapeHtml(item.name) + '</span>' +
                    '<span class="dev-star">' + escapeHtml(item.star) + '</span>' +
                    badge +
                '</div>' +
                '<div class="dev-item-elite">' + eliteInfo + '</div>' +
                '<div class="dev-item-traits">' + traitList + '</div>' +
            '</div>' +
        '</div>';
    }

    function render(recommendations, filterRoom) {
        const container = document.getElementById('devContent');
        const rooms = filterRoom === 'all' ? ROOM_ORDER : [filterRoom];
        let html = '';
        let shownCount = 0;

        for (const room of rooms) {
            const list = recommendations[room] || [];
            if (!list.length) continue;
            shownCount += list.length;
            html += '<div class="dev-room-card">' +
                '<div class="dev-room-title">' + escapeHtml(room) +
                ' <span class="dev-count">' + list.length + '</span></div>' +
                '<div class="dev-list">';
            for (const item of list) html += renderItem(item);
            html += '</div></div>';
        }

        if (shownCount === 0) html = '<p class="dev-empty">暂无推荐，该筛选下没有可提升项 🎉</p>';
        container.innerHTML = html;
    }

    function renderOverview(owned, summary) {
        document.getElementById('devFilter').style.display = 'flex';
        document.getElementById('devOverview').innerHTML =
            '<div class="dev-stat"><div class="dev-stat-num">' + owned + '</div><div class="dev-stat-label">已拥有干员</div></div>' +
            '<div class="dev-stat"><div class="dev-stat-num">' + summary.total + '</div><div class="dev-stat-label">可提升项</div></div>' +
            '<div class="dev-stat"><div class="dev-stat-num">' + summary.upgrades + '</div><div class="dev-stat-label">升级推荐</div></div>' +
            '<div class="dev-stat"><div class="dev-stat-num">' + summary.points + '</div><div class="dev-stat-label">补点推荐</div></div>';
    }

    function showEmpty() {
        document.getElementById('devOverview').innerHTML = '';
        document.getElementById('devFilter').style.display = 'none';
        document.getElementById('devTopGrid').innerHTML = '<p class="dev-empty">暂无数据</p>';
        document.getElementById('devSimpleSchedule').innerHTML = '<p class="dev-empty">暂无数据</p>';
        document.getElementById('devContent').innerHTML =
            '<div class="dev-empty-box">' +
                '<p>⚠️ 尚未导入干员数据</p>' +
                '<p>请先前往「自动排班」页，点击右上角「干员数据设置」导入你的干员库。</p>' +
                '<a class="dev-go-btn" href="/">前往自动排班 →</a>' +
            '</div>';
    }

    // ========== 启动 ==========
    async function init() {
        await loadSprite();

        const rawConfig = sessionStorage.getItem(STORAGE_KEY);
        if (!rawConfig) { showEmpty(); return; }

        let config;
        try { config = JSON.parse(rawConfig); } catch (e) { showEmpty(); return; }
        if (!config || typeof config !== 'object') { showEmpty(); return; }

        let ownedCount = 0;
        for (const val of Object.values(config)) {
            if (parseConfigEntry(val).elite !== 'none') ownedCount++;
        }
        if (ownedCount === 0) { showEmpty(); return; }

        let rawData;
        try {
            const res = await fetch('/Agent_characteristics.json', { cache: 'no-cache' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            rawData = await res.json();
        } catch (e) {
            document.getElementById('devContent').innerHTML = '<p class="dev-error">干员数据加载失败，请刷新重试。</p>';
            return;
        }
        if (!rawData || Object.keys(rawData).length === 0) {
            document.getElementById('devContent').innerHTML = '<p class="dev-error">干员数据为空。</p>';
            return;
        }

        const options = getPlanOptions();
        const loadingHtml = '<div class="dev-plan-loading"><div class="dev-loading-spinner"></div>正在用当前练度枚举最小提升路线…</div>';
        document.getElementById('devTopGrid').innerHTML = loadingHtml;
        document.getElementById('devSimpleSchedule').innerHTML = loadingHtml;
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 30)));
        const plan = await buildMinimalPlan(rawData, config, options);
        renderMinimalPlan(plan, rawData);
        document.getElementById('devFilter').style.display = 'none';
        return;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    console.log('[提升建议] dev.js 已加载');
})();