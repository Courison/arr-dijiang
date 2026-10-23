/* ============================================================
   main.js —— 主排班系统界面控制与渲染 (拆分版)
   ============================================================ */
(function() {
    // ========== 弹窗控制 ==========
    (function() {
        const opPanel = document.getElementById('operatorPanelOverlay');
        const stPanel = document.getElementById('strategyPanelOverlay');
        const tmPanel = document.getElementById('timingPanelOverlay');
        const opBtn = document.getElementById('openOperatorPanelBtn');
        const stBtn = document.getElementById('openStrategyPanelBtn');
        const tmBtn = document.getElementById('openTimingPanelBtn');
        const opClose = document.getElementById('operatorPanelCloseBtn');
        const stClose = document.getElementById('strategyPanelCloseBtn');
        const tmClose = document.getElementById('timingPanelCloseBtn');

        function openModal(m) { if (m) m.classList.add('open'); }
        function closeModal(m) { if (m) m.classList.remove('open'); }

        if (opBtn) opBtn.addEventListener('click', () => { window.location.href = '/agentpackage/'; });
        if (stBtn) stBtn.addEventListener('click', () => openModal(stPanel));
        if (tmBtn) tmBtn.addEventListener('click', () => openModal(tmPanel));
        if (opClose) opClose.addEventListener('click', () => closeModal(opPanel));
        if (stClose) stClose.addEventListener('click', () => closeModal(stPanel));
        if (tmClose) tmClose.addEventListener('click', () => closeModal(tmPanel));
        if (opPanel) opPanel.addEventListener('click', e => { if (e.target === opPanel) closeModal(opPanel); });
        if (stPanel) stPanel.addEventListener('click', e => { if (e.target === stPanel) closeModal(stPanel); });
        if (tmPanel) tmPanel.addEventListener('click', e => { if (e.target === tmPanel) closeModal(tmPanel); });
    })();

    (function() {
        const floatingGroup = document.querySelector('.floating-btn-group');
        if (!floatingGroup) return;
        function syncFloatingButton() {
            const anyModalOpen = document.querySelector('.modal-overlay.open, .changelog-modal-overlay.open');
            if (anyModalOpen) {
                floatingGroup.style.display = 'none';
            } else {
                floatingGroup.style.display = '';
            }
        }
        const observer = new MutationObserver(syncFloatingButton);
        document.querySelectorAll('.modal-overlay, .changelog-modal-overlay').forEach(el => {
            observer.observe(el, { attributes: true, attributeFilter: ['class'] });
        });
        syncFloatingButton();
    })();

    (function() {
        const banner = document.getElementById('mobileBanner');
        const closeBtn = document.getElementById('bannerCloseBtn');
        if (!banner || !closeBtn) return;
        if (localStorage.getItem('mobileBannerClosed') === 'true') banner.style.display = 'none';
        closeBtn.addEventListener('click', function() {
            banner.style.display = 'none';
            localStorage.setItem('mobileBannerClosed', 'true');
        });
    })();

    // ========== 干员数据设置面板 ==========
    (function() {
        const modal = document.getElementById('dataSettingsModal');
        function openDataSettings() { modal.classList.add('open'); }
        function closeDataSettings() { modal.classList.remove('open'); }
        window.openDataSettings = openDataSettings;
        window.closeDataSettings = closeDataSettings;
        document.getElementById('dataSettingsBtn').addEventListener('click', openDataSettings);
        document.getElementById('dataSettingsCloseBtn').addEventListener('click', closeDataSettings);
        modal.addEventListener('click', function(e) { if (e.target === modal) closeDataSettings(); });
        window.toggleDsCard = function(cardId) {
            const targetCard = document.querySelector(`.ds-card[data-card="${cardId}"]`);
            if (!targetCard) return;
            const isCurrentlyOpen = targetCard.classList.contains('open');
            document.querySelectorAll('#dataSettingsModal .ds-card').forEach(c => { c.classList.remove('open'); });
            if (!isCurrentlyOpen) targetCard.classList.add('open');
        };
    })();

    // ========== 核心状态变量 ==========
    const ELITE_RANK = { 'none': 0, '精零': 1, '精一': 2, '精二': 3, '精三': 4, '精四': 5 };
    const ELITE_LABEL = ['未拥有', '精零', '精一', '精二', '精三', '精四'];
    const ELITE_STATES = ['none', '精零', '精一', '精二', '精三', '精四'];
    const TALENT_ORDER = ['1_1', '2_1', '1_2', '2_2'];
    const TALENT_META = {
        '1_1': { minElite: 2, prereq: null  }, '2_1': { minElite: 3, prereq: null  },
        '1_2': { minElite: 4, prereq: '1_1' }, '2_2': { minElite: 5, prereq: '2_1' },
    };
    const STORAGE_KEY = 'DijiangScheduleConfig';
    const MOOD_WEIGHT = 0.3;
    const DEFAULT_CULTURE_PRIORITY = ['plant', 'mineral', 'fungi'];
    const DEFAULT_PRIORITY_WEIGHTS = [1.0, 0.6, 0.3];

    let centralMode = 'normal';
    let trustedAgentIds = [];
    let trustAssignMap = {}; // 已废弃：信赖干员轮次由核心按天赋评分自动分配
    let meetingPriorityEnabled = false;
    let missingClues = new Set();
    let excludedClues = new Set([3, 7]);
    const ALL_ROOMS = ['central', 'manufactA', 'manufactB', 'culture', 'meeting'];
    
    const DEFAULT_PRIORITY_ORDER_ROUND1 = ['meeting', 'central', 'manufactA', 'manufactB', 'culture'];
    const DEFAULT_PRIORITY_ORDER_ROUND2 = ['meeting', 'manufactA', 'manufactB', 'culture', 'central'];
    let roomPriorityOrderRound1 = DEFAULT_PRIORITY_ORDER_ROUND1.slice();
    let roomPriorityOrderRound2 = DEFAULT_PRIORITY_ORDER_ROUND2.slice();

    let roomModes = { central: 'double', manufactA: 'double', manufactB: 'double', culture: 'double', meeting: 'double' };
    let doubleRoundRooms = ALL_ROOMS.filter(k => roomModes[k] === 'double');
    let rawOperatorsData = null;
    let operators = [];
    let nextId = 1;
    let modalDiv = null;
    let currentFilter = 'all', currentStarFilter = 'all', currentAttributeFilter = 'all';

    function getPriorityWeights() { return window.DIJIANG_PRIORITY_WEIGHTS || DEFAULT_PRIORITY_WEIGHTS; }
    function getCRestHigh() { return (typeof window.DIJIANG_OPT_CREST_OVERRIDE === 'number' && isFinite(window.DIJIANG_OPT_CREST_OVERRIDE) && window.DIJIANG_OPT_CREST_OVERRIDE > 0) ? window.DIJIANG_OPT_CREST_OVERRIDE : 12 * 1.48; }
    
    function getRoomPriorityOrder(round) {
        const key = round === 1 ? 'DijiangRoomPriorityOrderRound1' : 'DijiangRoomPriorityOrderRound2';
        try {
            const raw = sessionStorage.getItem(key);
            if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr) && arr.length === ALL_ROOMS.length) return arr; }
        } catch(e) {}
        return round === 1 ? roomPriorityOrderRound1.slice() : roomPriorityOrderRound2.slice();
    }
    function saveRoomPriorityOrder(round, order) {
        const key = round === 1 ? 'DijiangRoomPriorityOrderRound1' : 'DijiangRoomPriorityOrderRound2';
        sessionStorage.setItem(key, JSON.stringify(order));
        if (round === 1) roomPriorityOrderRound1 = order; else roomPriorityOrderRound2 = order;
        generateSchedule();
    }

    function getManufactMode() {
        const expCheck = document.querySelector('#manufactProducts input[value="exp"]');
        const weaponCheck = document.querySelector('#manufactProducts input[value="weapon"]');
        if (!expCheck || !weaponCheck) return 'dual';
        const e = expCheck.checked, w = weaponCheck.checked;
        if (e === w) return 'dual';
        return e ? 'exp' : 'weapon';
    }
    function getCultureTypes() {
        try {
            const raw = sessionStorage.getItem('DijiangManualProduct');
            if (raw) {
                const p = JSON.parse(raw);
                const c = p.culture;
                if (c && typeof c === 'object' && Array.isArray(c.products) && c.products.length) return c.products.slice();
            }
        } catch (e) {}
        const checks = Array.from(document.querySelectorAll('#cultureProducts input:checked')).map(cb => cb.value);
        return checks.length ? checks : ['mineral', 'fungi', 'plant'];
    }
    function getCulturePriority() {
        try {
            const raw = sessionStorage.getItem('DijiangManualProduct');
            if (!raw) return DEFAULT_CULTURE_PRIORITY.slice();
            const p = JSON.parse(raw);
            let c = p.culture;
            if (!c) return DEFAULT_CULTURE_PRIORITY.slice();
            if (typeof c === 'string') c = { products: [c], priority: null };
            else if (Array.isArray(c)) c = { products: c.slice(), priority: null };
            const products = Array.isArray(c.products) ? c.products : [];
            if (products.length === 0) return DEFAULT_CULTURE_PRIORITY.slice();
            if (Array.isArray(c.priority) && c.priority.length > 0) {
                const result = c.priority.filter(x => products.includes(x));
                for (const x of DEFAULT_CULTURE_PRIORITY) if (products.includes(x) && !result.includes(x)) result.push(x);
                for (const x of products) if (!result.includes(x)) result.push(x);
                return result;
            }
            const result = [];
            for (const x of DEFAULT_CULTURE_PRIORITY) if (products.includes(x)) result.push(x);
            for (const x of products) if (!result.includes(x)) result.push(x);
            return result;
        } catch (e) { return DEFAULT_CULTURE_PRIORITY.slice(); }
    }

    // ========== 天赋与图像处理 ==========
    function emptyTalents() { return { '1_1': false, '2_1': false, '1_2': false, '2_2': false }; }
    function canActivate(op, tid) { const m = TALENT_META[tid]; return m && ELITE_RANK[op.eliteLevel] >= m.minElite; }
    function sanitizeTalents(op) {
        for (const tid of TALENT_ORDER) {
            if (op.activatedTalents[tid] && !canActivate(op, tid)) {
                op.activatedTalents[tid] = false;
                if (tid === '1_1') op.activatedTalents['1_2'] = false;
                if (tid === '2_1') op.activatedTalents['2_2'] = false;
            }
        }
        if (op.activatedTalents['1_2']) op.activatedTalents['1_1'] = true;
        if (op.activatedTalents['2_2']) op.activatedTalents['2_1'] = true;
    }
    function autoActivateByElite(elite) {
        const t = emptyTalents();
        if (elite === '精一') { t['1_1'] = true; }
        else if (elite === '精二') { t['1_1'] = t['2_1'] = true; }
        else if (elite === '精三') { t['1_1'] = t['2_1'] = t['1_2'] = true; }
        else if (elite === '精四') { t['1_1'] = t['2_1'] = t['1_2'] = t['2_2'] = true; }
        return t;
    }
    function normalizeTalents(list) {
        const set = new Set(list || []);
        if (set.has('1_2')) set.add('1_1');
        if (set.has('2_2')) set.add('2_1');
        return Array.from(set);
    }
    function parseActivatedTalents(cultivationTalents) {
        const activated = emptyTalents();
        const SUFFIX_MAP = { '_1_1': '1_1', '_2_1': '2_1', '_1_2': '1_2', '_2_2': '2_2' };
        for (const t of (cultivationTalents || [])) {
            for (const [suffix, tid] of Object.entries(SUFFIX_MAP)) {
                if ((t.id || '').endsWith(suffix)) { activated[tid] = true; break; }
            }
        }
        return activated;
    }
    function getTalentIconPath(traits) {
        if (!traits || traits.length === 0) return '';
        const t = traits[0]; const room = t.舱室, type = t.类型;
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
    function getTalentList(rawData, tid) {
        if (!rawData) return [];
        if (Array.isArray(rawData[tid]) && rawData[tid].length) return rawData[tid];
        const LEGACY = { '1_1': '精一', '2_1': '精二', '1_2': '精三', '2_2': '精四' };
        if (Array.isArray(rawData[LEGACY[tid]]) && rawData[LEGACY[tid]].length) return rawData[LEGACY[tid]];
        return [];
    }
    function isCluePower(type) { return type === '线索概率提升' || type === '线索概率小幅提升'; }
    function mergeActivatedTraits(activatedTalents, rawData) {
        const allTraits = [];
        for (const tid of TALENT_ORDER) {
            if (!activatedTalents[tid]) continue;
            const traits = getTalentList(rawData, tid);
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
    function updateAllMergedTraits() {
        for (const op of operators) {
            if (op.eliteLevel === 'none' || op.eliteLevel === '精零') op.mergedTraits = [];
            else op.mergedTraits = mergeActivatedTraits(op.activatedTalents, rawOperatorsData[op.name] || {});
        }
    }

    // 头像加载 (精灵图方案)
    const avatarBase64Cache = {};
    const spriteDataUrlCache = {};
    let spriteImage = null;
    let spriteIndex = null;
    let spriteReady = false;
    let spriteLoadPromise = null;

    function getAvatarPath(name) { return `/Agent/${encodeURIComponent(name)}.webp`; }
    async function loadSprite() {
        if (spriteLoadPromise) return spriteLoadPromise;
        spriteLoadPromise = (async () => {
            try {
                const res = await fetch('/dist/agent_sprite.json', { cache: 'no-cache' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                spriteIndex = await res.json();
                const imgUrl = '/dist/' + (spriteIndex.image || 'agent_sprite.webp') + '?t=' + Date.now();
                spriteImage = await new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = () => reject(new Error('长图加载失败'));
                    img.src = imgUrl;
                });
                spriteReady = true;
            } catch (e) {
                spriteReady = false;
                console.warn('[精灵图] 加载失败，回退单张头像：', e);
            }
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
    async function loadAvatarAsBase64(name) {
        const spriteUrl = getSpriteDataUrl(name);
        if (spriteUrl) return spriteUrl;
        if (name in avatarBase64Cache) return avatarBase64Cache[name];
        const path = getAvatarPath(name);
        try {
            const res = await fetch(path);
            if (!res.ok) { avatarBase64Cache[name] = null; return null; }
            const blob = await res.blob();
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            avatarBase64Cache[name] = dataUrl;
            return dataUrl;
        } catch (e) { avatarBase64Cache[name] = null; return null; }
    }
    async function preloadAllAvatars(names, concurrency = 6) {
        const ok = await loadSprite();
        if (ok) return;
        const queue = [...names];
        const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
            while (queue.length > 0) {
                const name = queue.shift();
                if (!name) break;
                try { await loadAvatarAsBase64(name); } catch (e) {}
            }
        });
        await Promise.all(workers);
    }
    function getAgentImgSrc(opOrName) {
        const name = typeof opOrName === 'string' ? opOrName : opOrName.name;
        const spriteUrl = getSpriteDataUrl(name);
        if (spriteUrl) return spriteUrl;
        if (avatarBase64Cache[name]) return avatarBase64Cache[name];
        return getAvatarPath(name);
    }
    function escapeHtml(str) { return String(str).replace(/[&<>"']/g, function(m){ if(m==='&') return '&amp;'; if(m==='<') return '&lt;'; if(m==='>') return '&gt;'; if(m==='"') return '&quot;'; if(m==="'") return '&#39;'; return m; }); }

    // ========== 系统初始化与存储 ==========
    function initOperatorsList() {
        operators = []; nextId = 1;
        let order = rawOperatorsData.operator_order;
        if (!order || !Array.isArray(order) || order.length === 0) order = Object.keys(rawOperatorsData).filter(key => key !== 'operator_order');
        for (const name of order) {
            const info = rawOperatorsData[name];
            if (info) {
                operators.push({ id: nextId++, name, star: info.star || '未知', attribute: info.attribute || '未知', eliteLevel: 'none', activatedTalents: emptyTalents(), mergedTraits: [] });
            }
        }
        updateAllMergedTraits();
        renderOperatorStatus();
    }
    function saveConfigToSessionStorage() {
        const config = {};
        for (const op of operators) config[op.name] = { elite: op.eliteLevel, talents: TALENT_ORDER.filter(tid => op.activatedTalents[tid]) };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }
    function normalizeElite(elite) {
        if (elite === '未拥有' || elite === 'none' || elite == null || elite === '') return 'none';
        return ELITE_RANK[elite] !== undefined ? elite : 'none';
    }
    function parseConfigEntry(val) {
        if (typeof val === 'string') {
            const elite = normalizeElite(val);
            return { elite, talents: TALENT_ORDER.filter(tid => autoActivateByElite(elite)[tid]) };
        }
        if (val && typeof val === 'object') {
            const elite = normalizeElite(val.elite);
            let talents = normalizeTalents(val.talents || []);
            if (elite === 'none') talents = [];
            return { elite, talents };
        }
        return { elite: 'none', talents: [] };
    }
    function loadConfigFromSessionStorage() {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { return false; }
        if (!parsed || typeof parsed !== 'object') return false;
        let matched = 0, total = 0;
        for (const op of operators) {
            total++;
            const v = parsed[op.name];
            if (!v) continue;
            matched++;
            const entry = parseConfigEntry(v);
            op.eliteLevel = entry.elite;
            const t = emptyTalents();
            for (const tid of entry.talents) t[tid] = true;
            op.activatedTalents = t;
            sanitizeTalents(op);
        }
        if (matched === 0 && total > 0) return false;
        updateAllMergedTraits();
        renderOperatorStatus();
        return true;
    }
    function saveProductConfigToSession() {
        try {
            const mode = getManufactMode();
            const cultureTypes = getCultureTypes();
            let mA, mB;
            if (mode === 'dual') { mA = 'exp'; mB = 'weapon'; }
            else if (mode === 'exp') { mA = 'exp'; mB = 'exp'; }
            else { mA = 'weapon'; mB = 'weapon'; }
            sessionStorage.setItem('DijiangDefaultProduct', JSON.stringify({ manufactA: mA, manufactB: mB, culture: cultureTypes }));
            let all = {};
            const raw = sessionStorage.getItem('DijiangManualProduct');
            if (raw) { try { all = JSON.parse(raw) || {}; } catch (_) { all = {}; } }
            const culturePriority = (all.culture && Array.isArray(all.culture.priority)) ? all.culture.priority.filter(x => cultureTypes.includes(x)) : null;
            all.culture = { products: cultureTypes, priority: (culturePriority && culturePriority.length > 0) ? culturePriority : null };
            sessionStorage.setItem('DijiangManualProduct', JSON.stringify(all));
        } catch (e) { console.warn('[帝江号] 保存产品配置失败：', e); }
    }
    
    function loadRoomModes() {
        try {
            const raw = sessionStorage.getItem('DijiangRoomModes');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    for (const k of ALL_ROOMS) if (['empty', 'single', 'double'].includes(parsed[k])) roomModes[k] = parsed[k];
                }
            }
        } catch (e) {}
        try {
            const oldDouble = sessionStorage.getItem('doubleRoundRooms');
            if (oldDouble && !sessionStorage.getItem('DijiangRoomModes')) {
                const arr = JSON.parse(oldDouble);
                for (const k of ALL_ROOMS) roomModes[k] = arr.includes(k) ? 'double' : 'single';
            }
        } catch (e) {}
        syncDoubleRooms();
    }
    function syncDoubleRooms() {
        doubleRoundRooms = ALL_ROOMS.filter(k => roomModes[k] === 'double');
        sessionStorage.setItem('DijiangRoomModes', JSON.stringify(roomModes));
    }

    function collectClueNumbers() {
        const found = new Set();
        if (!rawOperatorsData) return found;
        for (const op of operators) {
            if (op.eliteLevel === 'none' || op.eliteLevel === '精零') continue;
            const raw = rawOperatorsData[op.name];
            if (!raw) continue;
            for (const tid of TALENT_ORDER) {
                if (!op.activatedTalents[tid]) continue;
                const traits = getTalentList(raw, tid);
                for (const t of traits) {
                    if (t.舱室 !== '会客室') continue;
                    const n = parseInt(t.线索编号, 10);
                    if (n >= 1 && n <= 7) found.add(n);
                }
            }
        }
        return found;
    }
    function updateClueAvailability() {
        const available = collectClueNumbers();
        const clueContainer = document.getElementById('clueButtons');
        if (!clueContainer) return;
        clueContainer.querySelectorAll('.clue-btn').forEach(btn => {
            const n = parseInt(btn.dataset.clue, 10);
            const ok = available.has(n);
            btn.classList.toggle('disabled', !ok);
            btn.setAttribute('aria-disabled', ok ? 'false' : 'true');
            if (!ok && missingClues.has(n)) {
                missingClues.delete(n);
                btn.classList.remove('selected');
            }
        });
        sessionStorage.setItem('missingClues', JSON.stringify([...missingClues]));
    }

    // ========== 核心触发点 ==========
    function generateSchedule() {
        window.__DIJIANG_ROOM_TIMING__ = {};
        updateClueAvailability();
        
        const options = {
            mode: getManufactMode(), doubleRooms: doubleRoundRooms, roomModes: roomModes,
            emptyRooms: ALL_ROOMS.filter(k => roomModes[k] === 'empty'),
            centralDisabled: (centralMode === 'empty' || roomModes.central === 'empty'),
            isTrustMode: (centralMode === 'trust'), trustedAgentIds: trustedAgentIds, trustAssignMap: trustAssignMap,
            priorityOrderRound1: getRoomPriorityOrder(1), priorityOrderRound2: getRoomPriorityOrder(2),
            meetingPriorityEnabled: meetingPriorityEnabled, missingClues: missingClues, excludedClues: excludedClues,
            cultureTypes: getCultureTypes(), culturePriority: getCulturePriority(),
            priorityWeights: getPriorityWeights(), cRestHigh: getCRestHigh()
        };

        let queues = null;
        if (window.DijiangScheduler) { queues = window.DijiangScheduler.generateSchedule(operators, options); }
        else { console.error("DijiangScheduler 未加载！"); }

        renderSchedule(queues);
        window._lastQueues = queues; window._doubleRooms = doubleRoundRooms; window._centralMode = centralMode;
        window._manufactMode = options.mode; window._cultureTypes = options.cultureTypes; window._meetingPriorityEnabled = meetingPriorityEnabled;

        try {
            sessionStorage.setItem('DijiangLastQueues', JSON.stringify(queues));
            sessionStorage.setItem('DijiangDoubleRooms', JSON.stringify(doubleRoundRooms));
        } catch (e) {}

        if (window.DijiangTiming && typeof window.DijiangTiming.run === 'function') {
            setTimeout(() => { try { window.DijiangTiming.run(); } catch (err) {} }, 50);
        }
    }

    // ========== 渲染排班表 ==========
    function getRoomTimingText(roomKey, roundKey) {
        const map = window.__DIJIANG_ROOM_TIMING__;
        if (!map || !map[roomKey]) return '';
        return map[roomKey][roundKey] || '';
    }
    function getTraitDescriptionForRoom(mergedTraits, roomName, manufactType, cultureActiveTypes, isFill = false) {
        if (!mergedTraits || mergedTraits.length === 0) return isFill ? '补充队列使用' : '无天赋';
        let relevant = mergedTraits.filter(t => t.舱室 === roomName);
        if (relevant.length === 0) return isFill ? '补充队列使用' : '无天赋';
        if (roomName === '制造舱' && manufactType) {
            relevant = relevant.filter(t => (t.类型 === '干员素材效率' && manufactType === 'exp') || (t.类型 === '武器素材效率' && manufactType === 'weapon') || t.类型 === '心情消耗减少');
            if (relevant.length === 0) return isFill ? '补充队列使用' : '无天赋';
        }
        if (roomName === '培养舱' && cultureActiveTypes && cultureActiveTypes.length > 0) {
            relevant = relevant.filter(t => (t.类型 === '心情消耗减少') || (t.类型 === '矿物效率' && cultureActiveTypes.includes('mineral')) || (t.类型 === '菌类效率' && cultureActiveTypes.includes('fungi')) || (t.类型 === '晶植效率' && cultureActiveTypes.includes('plant')));
            if (relevant.length === 0) return isFill ? '补充队列使用' : '无天赋';
        }
        const parts = [];
        for (const t of relevant) {
            if (t.类型 === '心情恢复提升') parts.push(`心情恢复+${t.数值}%`);
            else if (t.类型 === '心情消耗减少') parts.push(`心情消耗-${t.数值}%`);
            else if (t.类型 === '收集线索效率') parts.push(`搜集效率+${t.数值}%`);
            else if (t.类型 === '线索概率小幅提升') parts.push(`线索${t.线索编号}概率小幅提升`);
            else if (t.类型 === '线索概率提升') parts.push(`线索${t.线索编号}概率提升`);
            else if (t.类型 === '干员素材效率') parts.push(`干员经验+${t.数值}%`);
            else if (t.类型 === '武器素材效率') parts.push(`武器经验+${t.数值}%`);
            else if (t.类型 === '矿物效率') parts.push(`矿物+${t.数值}%`);
            else if (t.类型 === '菌类效率') parts.push(`菌类+${t.数值}%`);
            else if (t.类型 === '晶植效率') parts.push(`晶植+${t.数值}%`);
            else parts.push(`${t.类型} ${t.数值}%`);
        }
        return parts.join('，');
    }
    function renderSchedule(queues) {
        const container = document.getElementById('scheduleResult');
        const hasAnyElite = operators.some(op => op.eliteLevel !== 'none');
        let noticeHTML = '';
        if (!hasAnyElite) noticeHTML = `<div class="global-notice">⚠️ 暂无可用干员，请设置精英化情况</div>`;
        if (!queues) { container.innerHTML = noticeHTML + '<div style="text-align:center; color:#888;">暂无排班数据</div>'; return; }
        const DISPLAY_NAMES = { central:'总控中枢', manufactA:'制造舱 A', manufactB:'制造舱 B', culture:'培养舱', meeting:'会客室' };
        const roomKeys = ['central', 'manufactA', 'manufactB', 'culture', 'meeting'];
        const roomRaw = { central:'总控中枢', manufactA:'制造舱', manufactB:'制造舱', culture:'培养舱', meeting:'会客室' };
        const mode = getManufactMode();
        const cultureChecks = getCultureTypes();
        const cultureText = cultureChecks.map(v => v==='mineral'?'矿物':v==='fungi'?'菌类':'晶植').join('、');
        const doubleRooms = doubleRoundRooms;

        const buildRecommendItem = (m, rawRoom, manufactType, cultureChecks) => {
            if (!m) return `<div class="recommend-item"><div class="empty-placeholder"><span>空位</span></div></div>`;
            const imgSrc = getAgentImgSrc(m);
            let hasValidTrait = false;
            if (m.mergedTraits && m.mergedTraits.length > 0) {
                let relevant = m.mergedTraits.filter(t => t.舱室 === rawRoom);
                if (rawRoom === '制造舱' && manufactType) relevant = relevant.filter(t => (t.类型 === '干员素材效率' && manufactType === 'exp') || (t.类型 === '武器素材效率' && manufactType === 'weapon') || t.类型 === '心情消耗减少');
                if (rawRoom === '培养舱' && cultureChecks) relevant = relevant.filter(t => (t.类型 === '心情消耗减少') || (t.类型 === '矿物效率' && cultureChecks.includes('mineral')) || (t.类型 === '菌类效率' && cultureChecks.includes('fungi')) || (t.类型 === '晶植效率' && cultureChecks.includes('plant')));
                if (rawRoom === '会客室') {
                    relevant = relevant.filter(t => {
                        if (t.类型 === '收集线索效率' || t.类型 === '心情消耗减少') return true;
                        if (isCluePower(t.类型)) { if (meetingPriorityEnabled && missingClues.size === 0) return false; return true; }
                        return false;
                    });
                }
                if (rawRoom === '总控中枢') relevant = relevant.filter(t => t.类型 === '心情恢复提升');
                if (relevant.length > 0) hasValidTrait = true;
            }
            const desc = getTraitDescriptionForRoom(m.mergedTraits, rawRoom, manufactType, cultureChecks, !hasValidTrait);
            const isTrust = (rawRoom === '总控中枢' && trustedAgentIds.includes(m.opId));
            const trustBadge = isTrust ? `<span style="background:#f0c040; color:#fff; font-weight:600; font-size:0.65rem; padding:2px 8px; border-radius:12px; margin-left:4px; display:inline-block;">培养信赖</span>` : '';
            return `<div class="recommend-item">
                <img class="agent-img" src="${imgSrc}" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'124\'%3E%3Crect width=\'100\' height=\'124\' fill=\'%23eaeaea\'/%3E%3C/svg%3E';">
                <div class="agent-name">${escapeHtml(m.name)}${trustBadge}</div>
                <div class="trait-summary">${escapeHtml(desc)}</div>
            </div>`;
        };

        const roomHTML = {};
        for (const room of roomKeys) {
            if (roomModes[room] === 'empty') {
                roomHTML[room] = `<div class="room-box" data-room="${room}" style="opacity:0.6;"><div class="room-box-header"><span>${DISPLAY_NAMES[room]}</span><span class="product-tag" style="background:#eee; color:#888;">空置</span></div><div style="text-align:center; padding:40px 0; color:#999; font-size:0.85rem;">未启用排班</div></div>`;
                continue;
            }
            const data = queues[room];
            if (!data) continue;
            let productTag = '', manufactType = null;
            if (room === 'manufactA') { if (mode === 'dual' || mode === 'exp') { productTag = '⚙️ 干员'; manufactType = 'exp'; } else { productTag = '⚙️ 武器'; manufactType = 'weapon'; } }
            else if (room === 'manufactB') { if (mode === 'dual' || mode === 'weapon') { productTag = '⚙️ 武器'; manufactType = 'weapon'; } else { productTag = '⚙️ 干员'; manufactType = 'exp'; } }
            else if (room === 'culture') { productTag = `🌱 ${cultureText}`; }
            else if (room === 'meeting' && meetingPriorityEnabled) { productTag = `📄 优先线索`; }

            const isDouble = doubleRooms.includes(room);
            let recommendHTML = '';
            if (isDouble) {
                let items1 = '', items2 = '';
                for (let i = 0; i < 3; i++) {
                    items1 += buildRecommendItem((data.round1 || [])[i] || null, roomRaw[room], manufactType, cultureChecks);
                    items2 += buildRecommendItem((data.round2 || [])[i] || null, roomRaw[room], manufactType, cultureChecks);
                }
                const t1 = getRoomTimingText(room, 'round1');
                const t2 = getRoomTimingText(room, 'round2');
                const badge1 = t1 ? `<span class="round-timing-badge">${escapeHtml(t1)}</span>` : '';
                const badge2 = t2 ? `<span class="round-timing-badge">${escapeHtml(t2)}</span>` : '';
                recommendHTML = `<div style="margin-bottom:8px;"><div class="round-label">A 班${badge1}</div><div class="recommend-area">${items1}</div></div><div><div class="round-label">B 班${badge2}</div><div class="recommend-area">${items2}</div></div>`;
            } else {
                const recList = data.recommend || [];
                let items = '';
                for (let i = 0; i < 3; i++) items += buildRecommendItem(recList[i] || null, roomRaw[room], manufactType, cultureChecks);
                const t1 = getRoomTimingText(room, 'round1');
                const badge1 = t1 ? `<span class="round-timing-badge">${escapeHtml(t1)}</span>` : '';
                recommendHTML = `<div style="margin-bottom:8px;"><div class="round-label">A 班${badge1}</div><div class="recommend-area">${items}</div></div>`;
                const reserveList = data.reserve || [];
                let reserveHTML = '';
                if (reserveList.length === 0) { reserveHTML = '<div style="font-size:0.7rem; color:#999; padding:4px 0;">无储备</div>'; }
                else {
                    reserveHTML = reserveList.map(m => {
                        const imgSrc = getAgentImgSrc(m);
                        const desc = getTraitDescriptionForRoom(m.mergedTraits, roomRaw[room], manufactType, cultureChecks, false);
                        return `<div class="reserve-item"><img class="mini-avatar" src="${imgSrc}" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'28\' height=\'28\'%3E%3Crect width=\'28\' height=\'28\' fill=\'%23eaeaea\'/%3E%3C/svg%3E';"><span class="reserve-trait">${escapeHtml(m.name)}: ${escapeHtml(desc)}</span></div>`;
                    }).join('');
                }
                recommendHTML += `<div class="reserve-area">${reserveHTML}</div>`;
            }
            roomHTML[room] = `<div class="room-box" data-room="${room}"><div class="room-box-header"><span>${DISPLAY_NAMES[room]}</span>${productTag ? `<span class="product-tag">${productTag}</span>` : ''}</div>${recommendHTML}</div>`;
        }

        const isMobile = window.innerWidth <= 768;
        let finalHTML = '';
        if (isMobile) finalHTML = roomKeys.map(r => roomHTML[r] || '').join('');
        else {
            const topRow = ['central', 'manufactA', 'manufactB'].map(r => roomHTML[r] || '').join('');
            const bottomRow = ['culture', 'meeting'].map(r => roomHTML[r] || '').join('');
            finalHTML = `<div class="room-row">${topRow}</div><div class="room-row-bottom">${bottomRow}</div>`;
        }
        container.innerHTML = noticeHTML + finalHTML;
    }
    
    // ========== 干员状态与单点编辑 ==========
    function updateOperatorCountBadge() {
        const badge = document.getElementById('operatorCountBadge');
        if (!badge) return;
        const owned = operators.filter(op => op.eliteLevel !== 'none').length;
        badge.textContent = owned;
    }
    function renderOperatorStatus() {
        const container = document.getElementById('operatorStatusContainer');
        if (!container) return;
        if (!operators.length) { container.innerHTML = '<div style="text-align:center; color:#888;">暂无干员数据</div>'; return; }
        const filtered = operators.filter(op => {
            if (currentFilter !== 'all' && op.eliteLevel !== currentFilter) return false;
            if (currentStarFilter !== 'all' && op.star !== currentStarFilter) return false;
            if (currentAttributeFilter !== 'all' && op.attribute !== currentAttributeFilter) return false;
            return true;
        });
        container.innerHTML = filtered.map(op => {
            let levelText = op.eliteLevel === 'none' ? '未拥有' : op.eliteLevel;
            const imgSrc = getAgentImgSrc(op);
            const activeCount = TALENT_ORDER.filter(tid => op.activatedTalents[tid]).length;
            const talentBadge = (op.eliteLevel !== 'none' && op.eliteLevel !== '精零') ? `<span class="badge" style="background:#e0f0ea; color:#2a5a4a;">天赋 ${activeCount}/4</span>` : '';
            return `<div class="status-item" data-name="${op.name}"><div class="status-item-left"><img class="agent-avatar-small" src="${imgSrc}" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'32\' height=\'32\'%3E%3Crect width=\'32\' height=\'32\' fill=\'%23eaeaea\'/%3E%3C/svg%3E';"><span>${escapeHtml(op.name)}</span></div>${talentBadge}<span class="badge">${levelText}</span></div>`;
        }).join('');
        document.querySelectorAll('.status-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const name = item.dataset.name;
                const op = operators.find(o => o.name === name);
                if (op) showSingleEditModal(op);
            });
        });
        updateOperatorCountBadge();
    }
    function renderTalentRow(op, tid) {
        const meta = TALENT_META[tid];
        const rawData = rawOperatorsData[op.name] || {};
        const traits = getTalentList(rawData, tid);
        const activated = op.activatedTalents[tid];
        const canAct = canActivate(op, tid);
        let state = 'off';
        if (activated) state = 'on'; else if (!canAct) state = 'locked';
        const displayName = (traits.length > 0 && traits[0].name) ? traits[0].name : tid;
        let effectText = traits.length > 0 ? traits.map(t => formatShortTrait(t)).join('；') : '（暂无天赋数据）';
        let lockMsg = state === 'locked' ? `需 ${ELITE_LABEL[meta.minElite]}` : '';
        const imgSrc = getTalentIconPath(traits);
        const imgTag = imgSrc ? `<img src="${imgSrc}" onerror="this.style.display='none';" alt="">` : '';
        const checkMark = state === 'on' ? '☑' : (state === 'off' ? '☐' : '🔒');
        return `<div class="talent-row" data-tid="${tid}" data-state="${state}" data-op="${escapeHtml(op.name)}">
            <div class="talent-icon" data-state="${state}" data-tid="${tid}">${imgTag}</div>
            <div class="talent-info"><div class="talent-id">${escapeHtml(displayName)}</div><div class="talent-effect">${escapeHtml(effectText)}</div>${lockMsg ? `<div class="talent-lock-msg">🔒 ${lockMsg}</div>` : ''}</div>
            <div class="talent-check">${checkMark}</div>
        </div>`;
    }
    function showSingleEditModal(op) {
        if (modalDiv) modalDiv.remove();
        const currentLevel = op.eliteLevel;
        const imgSrc = getAgentImgSrc(op);
        modalDiv = document.createElement('div');
        modalDiv.className = 'modal';
        modalDiv.innerHTML = `
            <div class="modal-content">
                <button class="close-modal" id="singleCloseBtn">×</button>
                <div class="modal-header">✏️ 修改 ${escapeHtml(op.name)}</div>
                <div class="agent-avatar" id="singleAvatar"></div>
                <div class="edit-section-title">精英化等级</div>
                <div class="elite-buttons" id="row1"><div data-level="none" class="elite-btn ${currentLevel==='none'?'selected':''}">❌ 未拥有</div><div data-level="精零" class="elite-btn ${currentLevel==='精零'?'selected':''}">精零</div></div>
                <div class="elite-buttons" id="row2"><div data-level="精一" class="elite-btn ${currentLevel==='精一'?'selected':''}">精一</div><div data-level="精二" class="elite-btn ${currentLevel==='精二'?'selected':''}">精二</div><div data-level="精三" class="elite-btn ${currentLevel==='精三'?'selected':''}">精三</div><div data-level="精四" class="elite-btn ${currentLevel==='精四'?'selected':''}">精四</div></div>
                <div class="edit-section-title">舱室天赋（点击切换激活）</div>
                <div id="talentListContainer"></div>
                <div class="modal-nav"><button id="singleCancelBtn">取消</button><button id="singleConfirmBtn">确认修改</button></div>
            </div>`;
        document.body.appendChild(modalDiv);
        const avatarDiv = modalDiv.querySelector('#singleAvatar');
        const tempImg = new Image();
        tempImg.onload = function() { avatarDiv.style.backgroundImage = `url(${imgSrc})`; avatarDiv.style.backgroundSize = 'cover'; avatarDiv.style.backgroundPosition = 'center'; avatarDiv.innerHTML = ''; };
        tempImg.onerror = function() { avatarDiv.style.backgroundImage = 'none'; avatarDiv.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#f0f0f0;color:#888;font-size:0.7rem;border-radius:50%;">无图</div>`; };
        tempImg.src = imgSrc;
        if (tempImg.complete && tempImg.naturalWidth > 0) tempImg.onload();

        let tempLevel = currentLevel;
        let tempTalents = { ...op.activatedTalents };
        function tempOp() { return { eliteLevel: tempLevel, activatedTalents: tempTalents, name: op.name }; }
        function sanitizeTemp() {
            for (const tid of TALENT_ORDER) {
                if (tempTalents[tid] && !canActivate(tempOp(), tid)) { tempTalents[tid] = false; if (tid === '1_1') tempTalents['1_2'] = false; if (tid === '2_1') tempTalents['2_2'] = false; }
            }
            if (tempTalents['1_2']) tempTalents['1_1'] = true;
            if (tempTalents['2_2']) tempTalents['2_1'] = true;
        }
        function renderTalentList() {
            const container = modalDiv.querySelector('#talentListContainer');
            container.innerHTML = TALENT_ORDER.map(tid => {
                const tmpOp = { eliteLevel: tempLevel, activatedTalents: tempTalents, name: op.name };
                const saved = { e: op.eliteLevel, a: op.activatedTalents };
                op.eliteLevel = tmpOp.eliteLevel; op.activatedTalents = tmpOp.activatedTalents;
                const html = renderTalentRow(op, tid);
                op.eliteLevel = saved.e; op.activatedTalents = saved.a;
                return html;
            }).join('');
            container.querySelectorAll('.talent-row').forEach(row => {
                row.addEventListener('click', function() {
                    const tid = this.dataset.tid; const meta = TALENT_META[tid]; if (!meta) return;
                    const cur = { eliteLevel: tempLevel, activatedTalents: tempTalents, name: op.name };
                    const isOn = tempTalents[tid]; const canAct = canActivate(cur, tid);
                    if (isOn) { tempTalents[tid] = false; if (tid === '1_1') tempTalents['1_2'] = false; if (tid === '2_1') tempTalents['2_2'] = false; }
                    else {
                        if (!canAct) { alert(`需 ${ELITE_LABEL[meta.minElite]} 才能激活 ${tid}`); return; }
                        tempTalents[tid] = true; if (tid === '1_2') tempTalents['1_1'] = true; if (tid === '2_2') tempTalents['2_1'] = true;
                    }
                    sanitizeTemp(); renderTalentList();
                });
            });
        }
        function renderEliteButtons() { modalDiv.querySelectorAll('.elite-btn').forEach(btn => btn.classList.toggle('selected', btn.dataset.level === tempLevel)); }
        modalDiv.querySelectorAll('.elite-btn').forEach(btn => { btn.addEventListener('click', () => { const newLevel = btn.dataset.level; tempLevel = newLevel; sanitizeTemp(); renderEliteButtons(); renderTalentList(); }); });
        renderTalentList();
        modalDiv.querySelector('#singleConfirmBtn').addEventListener('click', () => { op.eliteLevel = tempLevel; op.activatedTalents = { ...tempTalents }; updateAllMergedTraits(); renderOperatorStatus(); saveConfigToSessionStorage(); generateSchedule(); modalDiv.remove(); modalDiv = null; });
        modalDiv.querySelector('#singleCancelBtn').addEventListener('click', () => { modalDiv.remove(); modalDiv = null; });
        modalDiv.querySelector('#singleCloseBtn').addEventListener('click', () => { modalDiv.remove(); modalDiv = null; });
    }

    // ========== 舱室优先级 UI ==========
    function renderRoomModesUI() {
        const container = document.getElementById('roomModeList');
        if (!container) return;
        const LABELS = { central: '总控中枢', manufactA: '制造舱 A', manufactB: '制造舱 B', culture: '培养舱', meeting: '会客室' };
        const order1 = getRoomPriorityOrder(1), order2 = getRoomPriorityOrder(2);
        let html = '';
        for (const rk of ALL_ROOMS) {
            const idx1 = order1.indexOf(rk), idx2 = order2.indexOf(rk);
            let optionsHtml1 = '', optionsHtml2 = '';
            for (let i = 0; i < ALL_ROOMS.length; i++) {
                optionsHtml1 += `<option value="${i}" ${idx1 === i ? 'selected' : ''}>${i+1}</option>`;
                optionsHtml2 += `<option value="${i}" ${idx2 === i ? 'selected' : ''}>${i+1}</option>`;
            }
            html += `<div style="display:flex; align-items:center; justify-content:space-between; padding:4px 0; border-bottom:1px dashed #e0e0e0;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <select class="prio-select" data-round="1" data-room="${rk}" style="font-size:0.75rem; padding:1px 2px; border-radius:4px; border:1px solid #d0d7de; background:#f8fafc; color:#333;">${optionsHtml1}</select>
                    <select class="prio-select" data-round="2" data-room="${rk}" style="font-size:0.75rem; padding:1px 2px; border-radius:4px; border:1px solid #d0d7de; background:#f8fafc; color:#333;">${optionsHtml2}</select>
                    <span style="font-size:0.9rem; font-weight:500; margin-left:4px;">${LABELS[rk]}</span>
                </div>
                <select class="room-mode-select" data-room="${rk}" style="border:1px solid #d0d7de; border-radius:6px; padding:2px 8px; font-size:0.85rem;">
                    <option value="double" ${roomModes[rk] === 'double' ? 'selected' : ''}>二轮排班</option>
                    <option value="single" ${roomModes[rk] === 'single' ? 'selected' : ''}>单轮排班</option>
                    <option value="empty" ${roomModes[rk] === 'empty' ? 'selected' : ''}>空置 (停用)</option>
                </select>
            </div>`;
        }
        container.innerHTML = html;
        container.querySelectorAll('.room-mode-select').forEach(sel => {
            sel.addEventListener('change', function() {
                const rk = this.dataset.room; roomModes[rk] = this.value; syncDoubleRooms();
                if (roomModes[rk] === 'empty' && trustedAgentIds.length > 0 && rk === 'central') {
                    trustedAgentIds = []; trustAssignMap = {}; sessionStorage.removeItem('trustedAgentIds'); sessionStorage.removeItem('trustAssignMap'); updateTrustTags(); closeTrustModal(); closeTrustAssignModal();
                }
                generateSchedule();
            });
        });
        container.querySelectorAll('.prio-select').forEach(sel => {
            sel.addEventListener('change', function() {
                const round = parseInt(this.dataset.round); const rk = this.dataset.room; const newIndex = parseInt(this.value);
                const currentOrder = round === 1 ? getRoomPriorityOrder(1) : getRoomPriorityOrder(2);
                const oldIndex = currentOrder.indexOf(rk);
                if (oldIndex === newIndex) return;
                currentOrder.splice(oldIndex, 1); currentOrder.splice(newIndex, 0, rk);
                saveRoomPriorityOrder(round, currentOrder); renderRoomModesUI();
            });
        });
    }

    // ========== 培养舱优先级 UI ==========
    function initCulturePriorityUI() {
        const container = document.getElementById('cultureProducts');
        if (!container) return;
        let local = { products: ['mineral', 'fungi', 'plant'], priority: null };
        try {
            const raw = sessionStorage.getItem('DijiangManualProduct');
            if (raw) {
                const p = JSON.parse(raw); const c = p.culture;
                if (c && typeof c === 'object') {
                    local.products = Array.isArray(c.products) ? c.products.slice() : [];
                    local.priority = Array.isArray(c.priority) && c.priority.length > 0 ? c.priority.slice() : null;
                }
            }
        } catch (e) {}
        const labels = Array.from(container.querySelectorAll('label.checkbox-label'));
        labels.forEach(label => { const cb = label.querySelector('input'); cb.checked = local.products.includes(cb.value); });
        function getEffectivePriority() {
            const products = labels.map(l => l.querySelector('input')).filter(cb => cb.checked).map(cb => cb.value);
            if (products.length === 0) return [];
            if (local.priority && local.priority.length > 0) {
                const result = local.priority.filter(x => products.includes(x));
                for (const x of DEFAULT_CULTURE_PRIORITY) if (products.includes(x) && !result.includes(x)) result.push(x);
                for (const x of products) if (!result.includes(x)) result.push(x);
                return result;
            }
            const result = [];
            for (const x of DEFAULT_CULTURE_PRIORITY) if (products.includes(x)) result.push(x);
            for (const x of products) if (!result.includes(x)) result.push(x);
            return result;
        }
        function updateBadges() {
            const priority = getEffectivePriority();
            labels.forEach(label => {
                const cb = label.querySelector('input'); const badge = label.querySelector('.prio-badge'); const arrows = label.querySelector('.prio-arrows');
                const up = arrows.querySelector('.prio-up'); const down = arrows.querySelector('.prio-down');
                if (!cb.checked) { badge.style.display = 'none'; arrows.style.display = 'none'; return; }
                const rank = priority.indexOf(cb.value); badge.textContent = String(rank + 1); badge.style.display = ''; arrows.style.display = '';
                up.disabled = rank === 0; down.disabled = rank === priority.length - 1;
            });
            const hint = document.getElementById('culturePriorityHint');
            if (hint) hint.textContent = local.priority === null ? '未设置优先级时默认顺序：晶植 > 矿物 > 菌类' : '优先级 ① 最高的产物决定本舱时间安排';
        }
        function persist() {
            const products = labels.map(l => l.querySelector('input')).filter(cb => cb.checked).map(cb => cb.value);
            const priority = local.priority ? getEffectivePriority() : null;
            try { let all = {}; const raw = sessionStorage.getItem('DijiangManualProduct'); if (raw) all = JSON.parse(raw); all.culture = { products, priority }; sessionStorage.setItem('DijiangManualProduct', JSON.stringify(all)); } catch (e) {}
            saveProductConfigToSession();
        }
        labels.forEach(label => {
            const cb = label.querySelector('input');
            cb.addEventListener('change', () => {
                if (!cb.checked && local.priority) { local.priority = local.priority.filter(x => x !== cb.value); if (local.priority.length === 0) local.priority = null; }
                updateBadges(); persist(); generateSchedule();
            });
        });
        labels.forEach(label => {
            const up = label.querySelector('.prio-up'); const down = label.querySelector('.prio-down'); const value = label.querySelector('input').value;
            up.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                const cur = getEffectivePriority(); const idx = cur.indexOf(value); if (idx <= 0) return;
                const next = cur.slice(); [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                local.priority = next; updateBadges(); persist(); generateSchedule();
            });
            down.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                const cur = getEffectivePriority(); const idx = cur.indexOf(value); if (idx < 0 || idx >= cur.length - 1) return;
                const next = cur.slice(); [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                local.priority = next; updateBadges(); persist(); generateSchedule();
            });
        });
        updateBadges();
    }

    // ========== 排除线索 UI ==========
    function initExcludedCluesUI() {
        try { const raw = sessionStorage.getItem('DijiangExcludedClues'); if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) excludedClues = new Set(arr.filter(n => n >= 1 && n <= 7)); } } catch (e) {}
        const container = document.getElementById('excludedCluesButtons');
        if (!container) return;
        container.innerHTML = '';
        for (let i = 1; i <= 7; i++) {
            const btn = document.createElement('div'); btn.className = 'clue-btn'; btn.textContent = `线索${i}`; btn.dataset.clue = i;
            if (excludedClues.has(i)) btn.classList.add('selected');
            btn.addEventListener('click', function () {
                this.classList.toggle('selected'); const num = parseInt(this.dataset.clue, 10);
                if (this.classList.contains('selected')) excludedClues.add(num); else excludedClues.delete(num);
                try { sessionStorage.setItem('DijiangExcludedClues', JSON.stringify([...excludedClues])); } catch (e) {}
                generateSchedule();
            });
            container.appendChild(btn);
        }
    }

    // ========== 信赖 UI ==========
    function updateTrustTags() {
        const container = document.getElementById('trustTags');
        if (!container) return;
        if (trustedAgentIds.length === 0) { container.innerHTML = '<span style="color:#999; font-size:0.8rem;">未选择</span>'; return; }
        const names = trustedAgentIds.map(id => { const op = operators.find(o => o.id === id); return op ? op.name : '?'; });
        container.innerHTML = names.map(name => `<span class="trust-tag">${escapeHtml(name)}</span>`).join('');
    }
    function closeTrustModal() {
        const el = document.getElementById('trustModalOverlay');
        if (el) el.classList.remove('open');
    }
    function closeTrustAssignModal() {
        const el = document.getElementById('trustAssignOverlay');
        if (el) el.classList.remove('open');
    }

    // ==========================================
    // ★ 补充模块：批量设置
    // ==========================================
    let batchTempEliteMap = {};
    let batchTempTalentsMap = {};
    let batchSelectedIds = new Set();
    const batchTabKeys = ['unset/unowned', '精四', '精三', '精二', '精一', '精零'];
    const batchTabLabels = { 'unset/unowned': '未设置/未拥有', '精四': '精四', '精三': '精三', '精二': '精二', '精一': '精一', '精零': '精零' };
    let batchCurrentTab = 'unset/unowned';

    function initBatchTempMap() {
        for (const op of operators) {
            if (op.eliteLevel === 'none') batchTempEliteMap[op.id] = 'unowned';
            else if (['精零','精一','精二','精三','精四'].includes(op.eliteLevel)) batchTempEliteMap[op.id] = op.eliteLevel;
            else batchTempEliteMap[op.id] = 'unset';
            batchTempTalentsMap[op.id] = { ...op.activatedTalents };
        }
    }

    function getBatchFilteredOperators() {
        const star = document.getElementById('batchFilterStar').value;
        const attr = document.getElementById('batchFilterAttribute').value;
        return operators.filter(op => {
            const lv = batchTempEliteMap[op.id] || 'unset';
            if (batchCurrentTab === 'unset/unowned') {
                if (lv !== 'unset' && lv !== 'unowned') return false;
            } else {
                if (lv !== batchCurrentTab) return false;
            }
            if (star !== 'all' && op.star !== star) return false;
            if (attr !== 'all' && op.attribute !== attr) return false;
            return true;
        });
    }

    function renderBatchTabs() {
        const counts = {};
        batchTabKeys.forEach(key => { counts[key] = 0; });
        for (const op of operators) {
            const lv = batchTempEliteMap[op.id] || 'unset';
            if (lv === 'unset' || lv === 'unowned') counts['unset/unowned'] = (counts['unset/unowned'] || 0) + 1;
            else if (counts[lv] !== undefined) counts[lv] = (counts[lv] || 0) + 1;
        }
        const tabBar = document.getElementById('batchTabBar');
        tabBar.innerHTML = batchTabKeys.map(key => {
            const label = batchTabLabels[key] || key;
            const count = counts[key] || 0;
            const active = (key === batchCurrentTab) ? ' active' : '';
            return `<button class="tab-btn${active}" data-tab="${key}">${label} <span class="count">${count}</span></button>`;
        }).join('');
        tabBar.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                batchCurrentTab = this.dataset.tab;
                batchSelectedIds.clear();
                renderBatchTabs();
                renderBatchGrid();
            });
        });
    }

    function renderBatchGrid() {
        const filtered = getBatchFilteredOperators();
        const grid = document.getElementById('batchOperatorGrid');
        grid.innerHTML = filtered.map(op => {
            const lv = batchTempEliteMap[op.id] || 'unset';
            let displayText = '', tagClass = '';
            if (lv === 'unset') { displayText = '未设置'; tagClass = 'unset'; }
            else if (lv === 'unowned') { displayText = '未拥有'; tagClass = 'unowned'; }
            else { displayText = lv; tagClass = ''; }
            const isSelected = batchSelectedIds.has(op.id);
            const selectedClass = isSelected ? ' selected' : '';
            const imgSrc = getAgentImgSrc(op);
            const avatarHtml = `<img src="${imgSrc}" alt="${op.name}" onerror="this.style.display='none'; this.parentElement.textContent='${op.name.charAt(0)}'; this.parentElement.style.background='#d0d7de'; this.parentElement.style.color='#555'; this.parentElement.style.fontWeight='bold'; this.parentElement.style.fontSize='1.2rem';" />`;
            return `<div class="op-card${selectedClass}" data-id="${op.id}">
                        <div class="op-avatar">${avatarHtml}</div>
                        <div class="op-name" title="${op.name}">${op.name}</div>
                        <div class="op-level-tag ${tagClass}">${displayText}</div>
                    </div>`;
        }).join('');
    }

    function getBatchTargets() {
        if (batchSelectedIds.size === 0) return getBatchFilteredOperators().map(op => op.id);
        return Array.from(batchSelectedIds);
    }

    function batchSetLevel(level) {
        const targets = getBatchTargets();
        for (const id of targets) {
            if (batchTempEliteMap[id] === undefined) continue;
            if (level === 'unowned') {
                batchTempEliteMap[id] = 'unowned';
                batchTempTalentsMap[id] = emptyTalents();
            } else {
                batchTempEliteMap[id] = level;
                batchTempTalentsMap[id] = autoActivateByElite(level);
            }
        }
        batchSelectedIds.clear();
        batchCurrentTab = (level === 'unowned') ? 'unset/unowned' : level;
        renderBatchTabs();
        renderBatchGrid();
    }

    function batchSave() {
        const confirmed = confirm(
            '⚠️ 批量设置将把所选干员的精英化等级设置到对应阶级，' +
            '并默认激活该阶级下所有可解锁的天赋。\n\n' +
            '如需精细设置个别干员的单个天赋开关，请：\n' +
            '1. 在干员库中点击单个干员进行修改；或\n' +
            '2. 使用"森空岛凭证导入"从游戏账号自动读取真实天赋状态。\n\n' +
            '确认保存吗？'
        );
        if (!confirmed) return;
        for (const op of operators) {
            const lv = batchTempEliteMap[op.id] || 'unset';
            if (lv === 'unset') continue;
            op.eliteLevel = (lv === 'unowned') ? 'none' : lv;
            const t = batchTempTalentsMap[op.id] || emptyTalents();
            op.activatedTalents = { ...t };
            sanitizeTalents(op);
        }
        updateAllMergedTraits();
        renderOperatorStatus();
        saveConfigToSessionStorage();
        generateSchedule();
        document.getElementById('batchModalOverlay').classList.remove('open');
        alert('设置已保存！');
    }

    function batchCancel() {
        initBatchTempMap();
        batchSelectedIds.clear();
        batchCurrentTab = 'unset/unowned';
        renderBatchTabs();
        renderBatchGrid();
        document.getElementById('batchModalOverlay').classList.remove('open');
    }

    function openBatchModal() {
        initBatchTempMap();
        batchSelectedIds.clear();
        batchCurrentTab = 'unset/unowned';
        renderBatchTabs();
        renderBatchGrid();
        document.getElementById('batchModalOverlay').classList.add('open');
    }

    // ==========================================
    // ★ 补充模块：导入导出
    // ==========================================
    function openEIOverlay(title, html) {
        document.getElementById('eiTitle').textContent = title;
        document.getElementById('eiContent').innerHTML = html;
        document.getElementById('exportImportOverlay').classList.add('open');
    }
    function closeEIOverlay() { document.getElementById('exportImportOverlay').classList.remove('open'); }

    function buildExportObject() {
        const obj = {
            _comment: "精英化：none/精零/精一/精二/精三/精四；talents：激活天赋编号数组（含 1_2 会自动补 1_1，含 2_2 会自动补 2_1）",
            _version: 2,
        };
        for (const op of operators) {
            obj[op.name] = {
                elite: op.eliteLevel,
                talents: TALENT_ORDER.filter(tid => op.activatedTalents[tid]),
            };
        }
        return obj;
    }

    function encodeOperatorByte(op) {
        const elite = normalizeElite(op.eliteLevel);
        const e = ELITE_RANK[elite] || 0;
        if (e === 0) return 0;
        let bits = 0;
        if (op.activatedTalents['1_1']) bits |= 1;
        if (op.activatedTalents['2_1']) bits |= 2;
        if (op.activatedTalents['1_2']) bits |= 4;
        if (op.activatedTalents['2_2']) bits |= 8;
        return (e << 4) | bits;
    }
    function decodeOperatorByte(byte) {
        const e = (byte >> 4) & 0x0F;
        const elite = ELITE_STATES[e] || 'none';
        const talents = [];
        if (elite !== 'none') {
            if (byte & 1) talents.push('1_1');
            if (byte & 2) talents.push('2_1');
            if (byte & 4) talents.push('1_2');
            if (byte & 8) talents.push('2_2');
        }
        return { elite, talents };
    }
    function exportConfigToBase64() {
        const order = getOperatorOrder();
        const bytes = order.map(name => {
            const op = operators.find(o => o.name === name);
            return op ? encodeOperatorByte(op) : 0;
        });
        const binary = String.fromCharCode(...bytes);
        return btoa(binary);
    }
    function importConfigFromBase64(base64) {
        const order = getOperatorOrder();
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const config = {};
        for (let i = 0; i < order.length && i < bytes.length; i++) {
            config[order[i]] = decodeOperatorByte(bytes[i]);
        }
        return config;
    }

    function applyConfig(config) {
        for (const op of operators) {
            const v = config[op.name];
            if (!v) {
                op.eliteLevel = 'none';
                op.activatedTalents = emptyTalents();
                continue;
            }
            const entry = parseConfigEntry(v);
            op.eliteLevel = entry.elite;
            const t = emptyTalents();
            for (const tid of entry.talents) t[tid] = true;
            op.activatedTalents = t;
            sanitizeTalents(op);
        }
        updateAllMergedTraits();
        renderOperatorStatus();
        saveConfigToSessionStorage();
        generateSchedule();
    }

    function showExportModal() {
        let html = `
            <div style="text-align:center; margin-bottom:16px;">
                <div class="choice-buttons">
                    <div class="choice-btn" id="exportFileBtn">📁 生成文件</div>
                    <div class="choice-btn" id="exportCodeBtn">🔢 生成代码</div>
                </div>
                <div id="exportResultArea" style="margin-top:12px;"></div>
            </div>
        `;
        openEIOverlay('💾 导出配置', html);
        document.getElementById('exportFileBtn').addEventListener('click', function() {
            const obj = buildExportObject();
            const dataStr = JSON.stringify(obj, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'My_Agent.json';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            document.getElementById('exportResultArea').innerHTML = '<div style="color:#3f7e6b;">✅ 文件已下载</div>';
        });
        document.getElementById('exportCodeBtn').addEventListener('click', function() {
            let base64 = '';
            try { base64 = exportConfigToBase64(); } catch(e) { alert('生成代码失败：' + e.message); return; }
            document.getElementById('exportResultArea').innerHTML = `
                <div style="margin-top:8px; font-size:0.9rem;">Base64 代码：</div>
                <div class="code-area" id="codeDisplay">${escapeHtml(base64)}</div>
                <div style="display:flex; justify-content:flex-end;">
                    <span class="copy-btn" id="copyCodeBtn">📋 复制</span>
                </div>
            `;
            document.getElementById('copyCodeBtn').addEventListener('click', function() {
                const code = document.getElementById('codeDisplay').textContent;
                navigator.clipboard.writeText(code).then(() => alert('✅ 已复制')).catch(() => {
                    const range = document.createRange();
                    const sel = window.getSelection();
                    const el = document.getElementById('codeDisplay');
                    range.selectNodeContents(el);
                    sel.removeAllRanges(); sel.addRange(range);
                    document.execCommand('copy');
                    alert('✅ 已复制');
                });
            });
        });
    }

    function showImportModal() {
        let html = `
            <div style="text-align:center;">
                <div class="choice-buttons">
                    <div class="choice-btn" id="importFileBtn">📁 导入文件</div>
                    <div class="choice-btn" id="importCodeBtn">🔢 导入代码</div>
                </div>
                <div id="importResultArea" style="margin-top:12px;"></div>
            </div>
        `;
        openEIOverlay('📂 导入配置', html);
        document.getElementById('importFileBtn').addEventListener('click', function() {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'application/json';
            input.onchange = function(e) {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = function(ev) {
                    try {
                        const importedObj = JSON.parse(ev.target.result);
                        const config = {};
                        for (const [name, val] of Object.entries(importedObj)) {
                            if (name.startsWith('_')) continue;
                            config[name] = val;
                        }
                        applyConfig(config);
                        document.getElementById('importResultArea').innerHTML = '<div style="color:#3f7e6b;">✅ 导入成功！</div>';
                        setTimeout(closeEIOverlay, 1500);
                    } catch(err) { alert('配置文件格式错误'); }
                };
                reader.readAsText(file);
            };
            input.click();
        });
        document.getElementById('importCodeBtn').addEventListener('click', function() {
            document.getElementById('importResultArea').innerHTML = `
                <div style="margin-top:8px;">请输入 Base64 代码：</div>
                <textarea id="codeInput" style="width:100%; background:#f9f9f9; border:1px solid #d0d7de; color:#222; padding:8px; border-radius:8px; min-height:60px; margin-top:8px;"></textarea>
                <div style="display:flex; justify-content:flex-end; margin-top:8px;">
                    <button id="decodeBtn" style="background:#3f7e6b; color:white; border:none; padding:6px 20px; border-radius:30px; cursor:pointer;">解码并应用</button>
                </div>
            `;
            document.getElementById('decodeBtn').addEventListener('click', function() {
                const code = document.getElementById('codeInput').value.trim();
                if (!code) { alert('请输入 Base64 代码'); return; }
                let config;
                try { config = importConfigFromBase64(code); } catch(e) { alert('解码失败：' + e.message); return; }
                applyConfig(config);
                document.getElementById('importResultArea').innerHTML = '<div style="color:#3f7e6b;">✅ 导入成功！</div>';
                setTimeout(closeEIOverlay, 1500);
            });
        });
    }

    // ==========================================
    // ★ 补充模块：信赖系统（选择信赖干员，轮次由核心自动分配）
    // ==========================================
    const trustModalOverlay = document.getElementById('trustModalOverlay');
    const trustModalCloseBtn = document.getElementById('trustModalCloseBtn');
    const trustOperatorGrid = document.getElementById('trustOperatorGrid');
    const trustSelectedCount = document.getElementById('trustSelectedCount');
    const trustMaxCount = document.getElementById('trustMaxCount');
    const trustClearBtn = document.getElementById('trustClearBtn');
    const trustCancelBtn = document.getElementById('trustCancelBtn');
    const trustConfirmBtn = document.getElementById('trustConfirmBtn');
    const trustFilterStar = document.getElementById('trustFilterStar');
    const trustFilterAttribute = document.getElementById('trustFilterAttribute');
    const trustFilterResetBtn = document.getElementById('trustFilterResetBtn');
    const trustInfoLabel = document.getElementById('trustInfoLabel');
    let trustTempSelected = [];

    function updateTrustMaxLabel() {
        const max = 3; // 强制上限 3 人
        if(trustMaxCount) trustMaxCount.textContent = max;
        if(trustInfoLabel) trustInfoLabel.textContent = `选择信赖干员（至多 3 人，将优先安排至总控中枢）：`;
    }
    function getTrustFilteredOperators() {
        const star = trustFilterStar.value;
        const attr = trustFilterAttribute.value;
        return operators.filter(op => {
            if (op.eliteLevel === 'none') return false;
            if (star !== 'all' && op.star !== star) return false;
            if (attr !== 'all' && op.attribute !== attr) return false;
            return true;
        });
    }
    function openTrustModal() { 
        updateTrustMaxLabel(); 
        trustTempSelected = [...trustedAgentIds]; 
        renderTrustGrid(); 
        if(trustModalOverlay) trustModalOverlay.classList.add('open'); 
    }

    function renderTrustGrid() {
        const filtered = getTrustFilteredOperators();
        trustOperatorGrid.innerHTML = filtered.map(op => {
            const isSelected = trustTempSelected.includes(op.id);
            const selectedClass = isSelected ? ' selected' : '';
            const imgSrc = getAgentImgSrc(op);
            const avatarHtml = `<img src="${imgSrc}" alt="${op.name}" onerror="this.style.display='none'; this.parentElement.textContent='${op.name.charAt(0)}';" />`;
            return `<div class="op-card${selectedClass}" data-id="${op.id}">
                        <div class="op-avatar">${avatarHtml}</div>
                        <div class="op-name" title="${op.name}">${op.name}</div>
                        <div class="op-level-tag">${op.eliteLevel}</div>
                    </div>`;
        }).join('');
        trustSelectedCount.textContent = trustTempSelected.length;
        trustOperatorGrid.querySelectorAll('.op-card').forEach(card => {
            card.addEventListener('click', function() {
                const id = parseInt(this.dataset.id);
                const idx = trustTempSelected.indexOf(id);
                if (idx !== -1) trustTempSelected.splice(idx, 1);
                else {
                    if (trustTempSelected.length >= parseInt(trustMaxCount.textContent)) { alert(`最多选择 ${trustMaxCount.textContent} 名干员`); return; }
                    trustTempSelected.push(id);
                }
                renderTrustGrid();
            });
        });
    }
    
    if (trustFilterStar) trustFilterStar.addEventListener('change', renderTrustGrid);
    if (trustFilterAttribute) trustFilterAttribute.addEventListener('change', renderTrustGrid);
    if (trustFilterResetBtn) trustFilterResetBtn.addEventListener('click', function() { trustFilterStar.value = 'all'; trustFilterAttribute.value = 'all'; renderTrustGrid(); });
    if (trustClearBtn) trustClearBtn.addEventListener('click', function() { trustTempSelected = []; renderTrustGrid(); });
    if (trustCancelBtn) trustCancelBtn.addEventListener('click', function() { if (trustModalOverlay) trustModalOverlay.classList.remove('open'); });
    if (trustConfirmBtn) trustConfirmBtn.addEventListener('click', function() {
        const max = parseInt(trustMaxCount.textContent) || 3;
        if (trustTempSelected.length > max) { alert(`最多选择 ${max} 名干员`); return; }
        trustedAgentIds = [...trustTempSelected];
        updateTrustTags();
        sessionStorage.setItem('trustedAgentIds', JSON.stringify(trustedAgentIds));
        if (trustModalOverlay) trustModalOverlay.classList.remove('open');
        trustAssignMap = {};
        sessionStorage.removeItem('trustAssignMap');
        generateSchedule();
    });
    if (trustModalCloseBtn) trustModalCloseBtn.addEventListener('click', function() { if (trustModalOverlay) trustModalOverlay.classList.remove('open'); });
    if (trustModalOverlay) trustModalOverlay.addEventListener('click', function(e) { if (e.target === this) trustModalOverlay.classList.remove('open'); });

    // ===== 信赖轮次分配页面已废弃（信赖干员由核心自动分配轮次）=====
    const trustAssignOverlay = document.getElementById('trustAssignOverlay');
    let tempTrustAssignMap = {};
    if (trustAssignOverlay) {
        const trustAssignCloseBtn = document.getElementById('trustAssignCloseBtn');
        const trustAssignCancelBtn = document.getElementById('trustAssignCancelBtn');
        if (trustAssignCloseBtn) trustAssignCloseBtn.addEventListener('click', function() { trustAssignOverlay.classList.remove('open'); });
        if (trustAssignCancelBtn) trustAssignCancelBtn.addEventListener('click', function() { trustAssignOverlay.classList.remove('open'); });
        trustAssignOverlay.addEventListener('click', function(e) { if (e.target === this) trustAssignOverlay.classList.remove('open'); });
    }
    function openTrustAssignModal() { /* 已废弃 */ }

    // 补充 批量设置/导入导出的绑定
    document.getElementById('batchOperatorGrid').addEventListener('click', function(e) {
        const card = e.target.closest('.op-card');
        if (!card) return;
        const id = parseInt(card.dataset.id);
        if (batchSelectedIds.has(id)) batchSelectedIds.delete(id);
        else batchSelectedIds.add(id);
        renderBatchGrid();
    });
    document.getElementById('batchSelectAllBtn').addEventListener('click', function() { getBatchFilteredOperators().forEach(op => batchSelectedIds.add(op.id)); renderBatchGrid(); });
    document.getElementById('batchClearAllBtn').addEventListener('click', function() { batchSelectedIds.clear(); renderBatchGrid(); });
    document.getElementById('batchFilterStar').addEventListener('change', function() { batchSelectedIds.clear(); renderBatchGrid(); });
    document.getElementById('batchFilterAttribute').addEventListener('change', function() { batchSelectedIds.clear(); renderBatchGrid(); });
    document.querySelectorAll('.batch-actions button[data-level]').forEach(btn => {
        btn.addEventListener('click', function() {
            const level = this.dataset.level;
            if (level) batchSetLevel(level);
        });
    });
    document.getElementById('batchActivateAllBtn').addEventListener('click', function() {
        const targets = getBatchTargets();
        for (const id of targets) {
            const lv = batchTempEliteMap[id];
            if (!lv || lv === 'unowned' || lv === 'unset') continue;
            batchTempTalentsMap[id] = autoActivateByElite(lv);
        }
        batchSelectedIds.clear();
        renderBatchGrid();
    });
    document.getElementById('batchClearTalentsBtn').addEventListener('click', function() {
        const targets = getBatchTargets();
        for (const id of targets) {
            if (batchTempTalentsMap[id]) batchTempTalentsMap[id] = emptyTalents();
        }
        batchSelectedIds.clear();
        renderBatchGrid();
    });
    document.getElementById('closeBatchModalBtn').addEventListener('click', function() { document.getElementById('batchModalOverlay').classList.remove('open'); });
    document.getElementById('batchCancelBtn').addEventListener('click', batchCancel);
    document.getElementById('batchSaveBtn').addEventListener('click', batchSave);
    document.getElementById('batchModalOverlay').addEventListener('click', function(e) { if (e.target === this && confirm('确定关闭吗？未保存的更改将丢失。')) batchCancel(); });
    document.getElementById('batchBackBtn').addEventListener('click', function() { batchCancel(); window.openDataSettings(); });

    document.getElementById('eiCloseBtn').addEventListener('click', closeEIOverlay);
    document.getElementById('exportImportOverlay').addEventListener('click', function(e) { if (e.target === this) closeEIOverlay(); });
    document.getElementById('eiBackBtn').addEventListener('click', function() {
        closeEIOverlay();
        if (typeof window.openDataSettings === 'function') window.openDataSettings();
    });


    function initUI() {
        const savedMode = sessionStorage.getItem('centralMode');
        if (savedMode && ['normal','empty','trust'].includes(savedMode)) centralMode = savedMode;
        const savedTrust = sessionStorage.getItem('trustedAgentIds');
        if (savedTrust) {
            try {
                const arr = JSON.parse(savedTrust);
                if (Array.isArray(arr)) { trustedAgentIds = arr.filter(id => operators.some(o => o.id === id)); if (trustedAgentIds.length > 3) trustedAgentIds = trustedAgentIds.slice(0, 3); }
            } catch(e) {}
        }
        // trustAssignMap 已废弃，忽略历史存储
        trustAssignMap = {};
        updateTrustTags();
        loadRoomModes();
        renderRoomModesUI();
        const savedMeeting = sessionStorage.getItem('meetingPriority');
        if (savedMeeting === 'true') {
            meetingPriorityEnabled = true;
            document.getElementById('meetingPriorityToggle').classList.add('active');
            document.getElementById('priorityStatus').textContent = '开启';
            document.getElementById('missingCluesArea').style.display = 'block';
            const savedClues = sessionStorage.getItem('missingClues');
            if (savedClues) {
                try {
                    missingClues = new Set(JSON.parse(savedClues));
                    document.querySelectorAll('.clue-btn').forEach(btn => { if (missingClues.has(parseInt(btn.dataset.clue))) btn.classList.add('selected'); });
                } catch(e) {}
            }
        }
        const toggle = document.getElementById('meetingPriorityToggle');
        const clueArea = document.getElementById('missingCluesArea');
        const clueContainer = document.getElementById('clueButtons');
        if (clueContainer.children.length === 0) {
            for (let i = 1; i <= 7; i++) {
                const btn = document.createElement('div'); btn.className = 'clue-btn'; btn.textContent = `线索${i}`; btn.dataset.clue = i;
                btn.addEventListener('click', function() {
                    if (!meetingPriorityEnabled) return; if (this.classList.contains('disabled')) return;
                    this.classList.toggle('selected'); const num = parseInt(this.dataset.clue);
                    if (this.classList.contains('selected')) missingClues.add(num); else missingClues.delete(num);
                    sessionStorage.setItem('missingClues', JSON.stringify([...missingClues])); generateSchedule();
                });
                clueContainer.appendChild(btn);
            }
        }
        updateClueAvailability();

        toggle.addEventListener('click', function() {
            meetingPriorityEnabled = !meetingPriorityEnabled;
            if (meetingPriorityEnabled) { this.classList.add('active'); document.getElementById('priorityStatus').textContent = '开启'; clueArea.style.display = 'block'; sessionStorage.setItem('meetingPriority', 'true'); }
            else { this.classList.remove('active'); document.getElementById('priorityStatus').textContent = '关闭'; clueArea.style.display = 'none'; missingClues.clear(); document.querySelectorAll('.clue-btn').forEach(b => b.classList.remove('selected')); sessionStorage.setItem('meetingPriority', 'false'); }
            generateSchedule();
        });
        const modeBtns = document.querySelectorAll('#centralModeSelector .mode-btn');
        const trustArea = document.getElementById('centralTrustArea');
        modeBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                const mode = this.dataset.mode;
                if (mode !== 'trust' && centralMode === 'trust') { trustedAgentIds = []; trustAssignMap = {}; sessionStorage.removeItem('trustedAgentIds'); sessionStorage.removeItem('trustAssignMap'); updateTrustTags(); closeTrustModal(); closeTrustAssignModal(); }
                centralMode = mode; modeBtns.forEach(b => b.classList.remove('active')); this.classList.add('active');
                if (mode === 'trust') { trustArea.style.display = 'flex'; } else trustArea.style.display = 'none';
                sessionStorage.setItem('centralMode', mode); generateSchedule();
            });
        });
        const initModeBtn = document.querySelector(`#centralModeSelector .mode-btn[data-mode="${centralMode}"]`);
        if (initModeBtn) { modeBtns.forEach(b => b.classList.remove('active')); initModeBtn.classList.add('active'); trustArea.style.display = centralMode === 'trust' ? 'flex' : 'none'; }
        
        try {
            const rawDefault = sessionStorage.getItem('DijiangDefaultProduct');
            if (rawDefault) {
                const p = JSON.parse(rawDefault); const mode = (p.manufactA && p.manufactB && p.manufactA === p.manufactB) ? p.manufactA : 'dual';
                const expCheck = document.querySelector('#manufactProducts input[value="exp"]');
                const weaponCheck = document.querySelector('#manufactProducts input[value="weapon"]');
                if (expCheck) expCheck.checked = (mode === 'dual' || mode === 'exp');
                if (weaponCheck) weaponCheck.checked = (mode === 'dual' || mode === 'weapon');
            }
        } catch (e) {}

        document.querySelectorAll('#manufactProducts input').forEach(cb => {
            cb.addEventListener('change', () => {
                saveProductConfigToSession();
                generateSchedule();
            });
        });

        const trustBtn = document.getElementById('openTrustModalBtn');
        if (trustBtn) {
            const newBtn = trustBtn.cloneNode(true);
            trustBtn.parentNode.replaceChild(newBtn, trustBtn);
            newBtn.addEventListener('click', openTrustModal);
        }

        document.getElementById('dsBtnBatch').addEventListener('click', function() { window.closeDataSettings(); openBatchModal(); });
        document.getElementById('dsBtnImport').addEventListener('click', function() { window.closeDataSettings(); showImportModal(); });
        document.getElementById('dsBtnExport').addEventListener('click', function() { window.closeDataSettings(); showExportModal(); });
        
        const accountCloudBtn = document.getElementById('dsBtnAccountCloud');
        if (accountCloudBtn) {
            accountCloudBtn.addEventListener('click', function() {
                window.closeDataSettings();
                const accountBtn = document.getElementById('accountBtn');
                if (accountBtn) {
                    accountBtn.click();
                } else if (typeof window.openAccountLogin === 'function') {
                    window.openAccountLogin();
                }
            });
        }

        saveProductConfigToSession();
        initCulturePriorityUI();
        initExcludedCluesUI();
    }

    // ---------- 启动 ----------
    async function loadDataAndInit() {
        try {
            await loadSprite();
            const res = await fetch('/Agent_characteristics.json');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            rawOperatorsData = await res.json();
            if (!rawOperatorsData || Object.keys(rawOperatorsData).length === 0) throw new Error('JSON 为空');
            initOperatorsList(); renderOperatorStatus();
            (function scheduleBackgroundPreload() {
                const names = operators.map(op => op.name); const run = () => preloadAllAvatars(names, 6);
                if ('requestIdleCallback' in window) { requestIdleCallback(run, { timeout: 2000 }); } else { setTimeout(run, 1500); }
            })();
            const loaded = loadConfigFromSessionStorage();
            if (!loaded) {
                const rawSnapshot = sessionStorage.getItem(STORAGE_KEY);
                if (rawSnapshot) {
                    for (const op of operators) { op.eliteLevel = 'none'; op.activatedTalents = emptyTalents(); }
                    updateAllMergedTraits(); renderOperatorStatus();
                } else {
                    for (const op of operators) { op.eliteLevel = 'none'; op.activatedTalents = emptyTalents(); }
                    updateAllMergedTraits(); renderOperatorStatus(); saveConfigToSessionStorage();
                }
            }
            initUI(); generateSchedule();
            window.__DIJIANG_READY__ = true; window.dispatchEvent(new CustomEvent('dijiang:ready'));
        } catch (error) {
            console.error('加载失败:', error);
            document.getElementById('operatorStatusContainer').innerHTML = `<div style="text-align:center; color:#ffaa88;">❌ 加载失败：${error.message}</div>`;
            document.getElementById('scheduleResult').innerHTML = '<div style="text-align:center; color:#ffaa88;">数据加载失败。</div>';
        }
    }

    window.__DIJIANG_SKIP_PAGEHIDE_SAVE__ = false;
    window.addEventListener('dijiang:timing-updated', function () { if (window._lastQueues) renderSchedule(window._lastQueues); });
    loadDataAndInit();

    window.addEventListener('pagehide', function () {
        if (window.__DIJIANG_SKIP_PAGEHIDE_SAVE__) return;
        try { saveConfigToSessionStorage(); } catch (e) {}
        try { saveProductConfigToSession(); } catch (e) {}
        try { sessionStorage.setItem('DijiangDoubleRooms', JSON.stringify(doubleRoundRooms)); } catch (e) {}
        try { sessionStorage.setItem('DijiangExcludedClues', JSON.stringify([...excludedClues])); } catch (e) {}
        try { sessionStorage.setItem('centralMode', centralMode); } catch (e) {}
        try { sessionStorage.setItem('meetingPriority', meetingPriorityEnabled ? 'true' : 'false'); } catch (e) {}
        try { sessionStorage.setItem('missingClues', JSON.stringify([...missingClues])); } catch (e) {}
        try { sessionStorage.setItem('doubleRoundRooms', JSON.stringify(doubleRoundRooms)); } catch (e) {}
    });

    // ==========================================
    // ★ 补充模块 1：反馈弹窗相关逻辑
    // ==========================================
    (function() {
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
            textarea.value = ''; selectedFiles = []; totalSize = 0;
            updateFileList(); updateTotalSize();
            statusDiv.className = 'feedback-status'; statusDiv.style.display = 'none';
        }
        function closeFeedback() { modal.classList.remove('open'); }
        function updateFileList() {
            fileList.innerHTML = '';
            selectedFiles.forEach((file, index) => {
                const item = document.createElement('div');
                item.className = 'feedback-file-item';
                item.innerHTML = `<span>${file.name} (${(file.size/1024).toFixed(1)} KB)</span><span class="remove-file" data-index="${index}">×</span>`;
                fileList.appendChild(item);
            });
            fileList.querySelectorAll('.remove-file').forEach(el => {
                el.addEventListener('click', function() {
                    const idx = parseInt(this.dataset.index);
                    totalSize -= selectedFiles[idx].size;
                    selectedFiles.splice(idx, 1);
                    updateFileList(); updateTotalSize();
                });
            });
        }
        function updateTotalSize() { totalSizeSpan.textContent = (totalSize / 1024).toFixed(1); }
        function addFiles(newFiles) {
            for (const f of newFiles) {
                if (!f.type.startsWith('image/')) { showStatus('仅支持图片文件', 'error'); continue; }
                if (totalSize + f.size > 5 * 1024 * 1024) { showStatus('超过5M上限', 'error'); continue; }
                selectedFiles.push(f); totalSize += f.size;
            }
            updateFileList(); updateTotalSize();
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
        fileArea.addEventListener('drop', e => { e.preventDefault(); fileArea.style.borderColor = '#d0d7de'; addFiles(e.dataTransfer.files); });
        fileInput.addEventListener('change', function() { if (this.files.length) { addFiles(this.files); this.value = ''; } });
        submitBtn.addEventListener('click', function() {
            const text = textarea.value.trim();
            if (!text) { showStatus('请输入反馈内容', 'error'); return; }
            const formData = new FormData();
            formData.append('text', text);
            selectedFiles.forEach((file, idx) => formData.append('images[]', file, `${idx+1}.${file.name.split('.').pop()}`));
            submitBtn.disabled = true; submitBtn.textContent = '提交中...';
            fetch('/submit_feedback.php', { method: 'POST', body: formData })
                .then(res => res.json())
                .then(data => {
                        if (data.success) {
                            showStatus('✅ 反馈提交成功！', 'success');
                            if (typeof window.DijiangPetSay === 'function') {
                                window.DijiangPetSay('管理员，感谢你的反馈~');
                            }
                            setTimeout(() => { closeFeedback(); submitBtn.disabled = false; submitBtn.textContent = '确认提交'; }, 2000);
                        } else {
                        showStatus('❌ 失败：' + (data.message || '未知错误'), 'error');
                        submitBtn.disabled = false; submitBtn.textContent = '确认提交';
                    }
                })
                .catch(err => {
                    showStatus('❌ 网络错误', 'error');
                    submitBtn.disabled = false; submitBtn.textContent = '确认提交';
                });
        });
    })();


    // ==========================================
    // ★ 补充模块 2：排班图导出逻辑
    // ==========================================
    function buildRoomDescription() {
        const parts1 = [];
        const parts2 = [];
        const isDouble = (k) => doubleRoundRooms.includes(k) ? '【二轮】' : '';
        const centralText = { 'normal': '常规中枢', 'empty': '中枢空置', 'trust': '培养信赖' }[centralMode] || '常规中枢';
        parts1.push(`总控中枢${isDouble('central')}${centralText}`);
        const mode = getManufactMode();
        let aText, bText;
        if (mode === 'dual') { aText = '干员经验'; bText = '武器经验'; }
        else if (mode === 'exp') { aText = '干员经验'; bText = '干员经验'; }
        else { aText = '武器经验'; bText = '武器经验'; }
        parts1.push(`制造舱A${isDouble('manufactA')}${aText}`);
        parts1.push(`制造舱B${isDouble('manufactB')}${bText}`);
        const cultureTypes = getCultureTypes();
        const cultureText = cultureTypes.map(v => v==='mineral'?'矿物':v==='fungi'?'菌类':'晶植').join('、');
        parts2.push(`培养舱${isDouble('culture')}${cultureText}`);
        const meetingText = meetingPriorityEnabled ? '优先线索' : '常规';
        parts2.push(`会客室${isDouble('meeting')}${meetingText}`);
        return { line1: parts1.join('；'), line2: parts2.join('；') };
    }

    let _changelogVersionCache = null;
    async function getChangelogVersion() {
        if (_changelogVersionCache !== null) return _changelogVersionCache;
        try {
            const res = await fetch('/log/version.json', { cache: 'no-cache' });
            if (!res.ok) throw new Error();
            const data = await res.json();
            _changelogVersionCache = data.version || '';
        } catch (e) {
            _changelogVersionCache = '';
        }
        return _changelogVersionCache;
    }
    
    function formatExportHourRange(rows) {
        if (!rows || rows.length === 0) return '';
        const fmt = (h) => {
            if (h >= 24) return '24:00';
            h = ((h % 24) + 24) % 24;
            return String(h).padStart(2, '0') + ':00';
        };
        return rows.map(r => `${fmt(r.start)}-${fmt(r.end)}`).join(' / ');
    }

    function getExportRoomTiming(roomKey, roundKey) {
        if (!window.DijiangTiming || typeof window.DijiangTiming.getRoomPeriods !== 'function') return '';
        if (roomKey === 'central') {
            const p = window.DijiangTiming.getRoomPeriods('central');
            if (!p) return '';
            const rows = roundKey === 'round1' ? p.round1 : p.round2;
            return formatExportHourRange(rows);
        }
        const isDouble = (window._doubleRooms || []).includes(roomKey);
        if (!isDouble && roundKey === 'round2') return '';
        const p = window.DijiangTiming.getRoomPeriods(roomKey);
        if (!p) return '';
        const rows = roundKey === 'round1' ? p.round1 : p.round2;
        return formatExportHourRange(rows);
    }

    window.DijiangExportSchedule = async function() {
        if (!window._lastQueues) { alert('暂无排班数据'); return; }
        const version = await getChangelogVersion();
        const descObj = buildRoomDescription();
        const exportContainer = document.createElement('div');
        exportContainer.style.cssText = `position: fixed; left: -9999px; top: 0; width: 800px; background: #ffffff; padding: 20px; font-family: system-ui; color: #222;`;
        document.body.appendChild(exportContainer);
        const now = new Date();
        const dateStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0') + ' ' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
        exportContainer.innerHTML = `
            <div style="text-align:center;font-size:28px;font-weight:700;">帝江号排班表</div>
            <div style="text-align:center;font-size:13px;color:#555;margin:10px 0 16px;line-height:1.7;">${escapeHtml(descObj.line1)}<br>${escapeHtml(descObj.line2)}</div>
        `;
        const queues = window._lastQueues;
        const roomKeys = ['central', 'manufactA', 'manufactB', 'culture', 'meeting'];
        const roomLabels = { central: '总控中枢', manufactA: '制造舱A', manufactB: '制造舱B', culture: '培养舱', meeting: '会客室' };
        const bodyDiv = document.createElement('div');
        bodyDiv.style.cssText = 'display:flex;gap:20px;justify-content:center;';
        exportContainer.appendChild(bodyDiv);
        const col1 = await createExportColumn(queues, roomKeys, roomLabels, 'round1', '一轮');
        bodyDiv.appendChild(col1);
        const col2 = await createExportColumn(queues, roomKeys, roomLabels, 'round2', '二轮');
        bodyDiv.appendChild(col2);
        const footerDiv = document.createElement('div');
        footerDiv.style.cssText = 'margin-top:20px;border-top:1px solid #ddd;padding-top:12px;font-size:12px;color:#666;position:relative;';
        footerDiv.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:baseline;">
                <div>帝江号自动排班小工具　<span style="font-size:11px;color:#999;">生成时间 ${dateStr}</span></div>
                <div style="font-size:11px;color:#888;">${escapeHtml(version)}</div>
            </div>
            <div style="font-size:11px;">https://arr-dijiang.top/</div>
            <div style="font-size:11px;">BiliBili：Courison</div>
        `;
        exportContainer.appendChild(footerDiv);
        try {
            const canvas = await html2canvas(exportContainer, {
                scale: 2, useCORS: true, backgroundColor: '#ffffff',
                width: 800, height: exportContainer.scrollHeight,
            });
            const link = document.createElement('a');
            link.download = `排班图_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            document.body.removeChild(exportContainer);
        } catch (err) {
            alert('导出失败：' + err.message);
            document.body.removeChild(exportContainer);
        }
    };

    async function createExportColumn(queues, roomKeys, roomLabels, roundKey, roundLabel) {
        const col = document.createElement('div');
        col.style.cssText = 'flex:1;min-width:0;';
        col.innerHTML = `<div style="text-align:center;font-weight:600;font-size:16px;margin-bottom:8px;border-bottom:2px solid #3f7e6b;padding-bottom:4px;">${roundLabel}</div>`;
        const allNames = new Set();
        for (const key of roomKeys) {
            const data = queues[key];
            const isDouble = (window._doubleRooms || []).includes(key);
            const agents = isDouble ? (data[roundKey] || []) : (roundKey === 'round1' ? (data.recommend || []) : []);
            for (let i = 0; i < 3; i++) if (agents[i]) allNames.add(agents[i].name);
        }
        const dataUrlMap = {};
        await Promise.all([...allNames].map(async name => { dataUrlMap[name] = await loadAvatarAsBase64(name); }));
        const slashSvg = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34"><line x1="9" y1="25" x2="25" y2="9" stroke="#c8c8c8" stroke-width="1.6" stroke-dasharray="4 3" stroke-linecap="round"/></svg>');
        for (const key of roomKeys) {
            const card = document.createElement('div');
            card.style.cssText = 'border:1px solid #ddd;border-radius:8px;padding:8px;margin-bottom:8px;background:#fafafa;';
            const data = queues[key];
            const isDouble = (window._doubleRooms || []).includes(key);
            const agents = isDouble ? (data[roundKey] || []) : (roundKey === 'round1' ? (data.recommend || []) : []);
            const timingText = getExportRoomTiming(key, roundKey);
            card.innerHTML = `
                <div style="font-weight:500;font-size:13px;text-align:center;margin-bottom:2px;">${roomLabels[key]}</div>
                <div style="text-align:center;font-size:11px;color:#3f7e6b;font-family:ui-monospace,monospace;margin-bottom:6px;min-height:14px;">${timingText || ''}</div>
            `;
            const avatarRow = document.createElement('div');
            avatarRow.style.cssText = 'display:flex;justify-content:center;gap:8px;';
            for (let i = 0; i < 3; i++) {
                const circle = document.createElement('div');
                circle.style.cssText = 'width:50px;height:50px;border-radius:50%;background:#eee;border:1px solid #ccc;overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative;';
                const agent = agents[i];
                if (agent && dataUrlMap[agent.name]) {
                    const img = document.createElement('img');
                    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                    img.src = dataUrlMap[agent.name];
                    circle.appendChild(img);
                } else if (agent) {
                    circle.textContent = agent.name.charAt(0);
                    circle.style.cssText += 'font-size:20px;font-weight:bold;color:#999;';
                } else {
                    circle.style.background = '#f8f8f8';
                    circle.style.border = '1px dashed #ccc';
                    circle.style.backgroundImage = `url("${slashSvg}")`;
                    circle.style.backgroundSize = '34px 34px';
                    circle.style.backgroundPosition = 'center';
                    circle.style.backgroundRepeat = 'no-repeat';
                }
                avatarRow.appendChild(circle);
            }
            card.appendChild(avatarRow);
            col.appendChild(card);
        }
        return col;
    }
    
    // ==========================================
    // ★ 补充模块 3：更新日志弹窗控制
    // ==========================================
    (async function initChangelog() {
        const overlay = document.getElementById('changelogOverlay');
        const body = document.getElementById('changelogBody');
        const closeX = document.getElementById('changelogCloseX');
        const confirmBtn = document.getElementById('changelogConfirmBtn');
        const showAllBtn = document.getElementById('changelogShowAllBtn');
        if (!overlay || !body) return;

        let latestMarkdown = '';
        let allMarkdown = null; // null 表示未加载
        let showingAll = false;

        try {
            const resLatest = await fetch('/log/latest.md', { cache: 'no-cache' });
            if (resLatest.ok) latestMarkdown = await resLatest.text();
        } catch (e) {}

        async function loadAllMarkdown() {
            if (allMarkdown !== null) return allMarkdown;
            try {
                const resAll = await fetch('/log/log.md', { cache: 'no-cache' });
                if (resAll.ok) allMarkdown = await resAll.text();
                else allMarkdown = '';
            } catch (e) { allMarkdown = ''; }
            return allMarkdown;
        }

        function renderMarkdown(text) {
            if (window.marked) return window.marked.parse(text);
            return String(text).replace(/\n/g, '<br>');
        }

        const version = await getChangelogVersion();
        const lastVersion = localStorage.getItem('DijiangLastViewedLogVersion');

        function closeModal() {
            overlay.classList.remove('open');
            if (version) localStorage.setItem('DijiangLastViewedLogVersion', version);
        }

        if (closeX) closeX.addEventListener('click', closeModal);
        if (confirmBtn) confirmBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

        function updateDisplay() {
            if (showingAll && allMarkdown) {
                body.innerHTML = renderMarkdown(allMarkdown);
                if (showAllBtn) showAllBtn.textContent = '收起日志';
            } else {
                body.innerHTML = latestMarkdown
                    ? renderMarkdown(latestMarkdown)
                    : '<p style="color:#888;">暂无日志内容</p>';
                if (showAllBtn) {
                    if (allMarkdown && allMarkdown !== latestMarkdown) {
                        showAllBtn.style.display = '';
                        showAllBtn.textContent = '显示全部日志';
                    } else {
                        showAllBtn.style.display = 'none';
                    }
                }
            }
        }

        if (showAllBtn) {
            showAllBtn.addEventListener('click', async () => {
                if (!showingAll) {
                    await loadAllMarkdown();
                    showingAll = true;
                } else {
                    showingAll = false;
                }
                updateDisplay();
            });
        }

        updateDisplay();

        // 首次打开网页，或版本号发生变化时，自动弹出更新日志
        if (version && version !== lastVersion) {
            setTimeout(() => {
                const onboarding = document.getElementById('onboardingOverlay');
                if (onboarding && onboarding.style.display !== 'none' && onboarding.style.display !== '') {
                    setTimeout(() => overlay.classList.add('open'), 2000);
                } else {
                    overlay.classList.add('open');
                }
            }, 800);
        }
    })();
    // ---------- 对外接口 ----------
    function getOperatorOrder() {
        let order = rawOperatorsData.operator_order;
        if (!order || !Array.isArray(order) || order.length === 0) order = Object.keys(rawOperatorsData).filter(key => key !== 'operator_order');
        return order;
    }
    window.DijiangAPI = {
        getOperatorOrder: getOperatorOrder,
        getOperators: function() { return operators; },
        getRawData: function() { return rawOperatorsData; },
        parseActivatedTalents: function(cultivationTalents) { return parseActivatedTalents(cultivationTalents); },
        getEliteLabel: function(stage) { return ELITE_LABEL[stage] || '精零'; },
        getTalentIconPath: function(traits) { return getTalentIconPath(traits); },
        getTalentList: function(rawData, tid) { return getTalentList(rawData, tid); },
        TALENT_ORDER: TALENT_ORDER,
        applyEliteConfig: function(config) {
            if (!operators.length) return { ok: false, msg: '干员库未就绪' };
            let applied = 0;
            for (const op of operators) {
                const v = config[op.name];
                if (!v) { op.eliteLevel = 'none'; op.activatedTalents = emptyTalents(); continue; }
                const entry = parseConfigEntry(v);
                op.eliteLevel = entry.elite;
                const t = emptyTalents();
                if (entry.elite !== 'none') { for (const tid of entry.talents) t[tid] = true; }
                op.activatedTalents = t; sanitizeTalents(op);
                if (op.eliteLevel !== 'none') applied++;
            }
            updateAllMergedTraits(); renderOperatorStatus(); saveConfigToSessionStorage(); generateSchedule();
            window.dispatchEvent(new CustomEvent('dijiang:import-success'));
            return { ok: true, applied, total: operators.length };
        }
    };
    
    window.DijiangAccount = {
        getCurrentConfig: function() {
            try {
                const obj = { _version: 2 };
                for (const op of operators) obj[op.name] = { elite: op.eliteLevel, talents: TALENT_ORDER.filter(tid => op.activatedTalents[tid]) };
                let manufactProducts = null, cultureProducts = null;
                try { const raw = sessionStorage.getItem('DijiangDefaultProduct'); if (raw) manufactProducts = JSON.parse(raw); } catch (e) {}
                try { const raw = sessionStorage.getItem('DijiangManualProduct'); if (raw) { const p = JSON.parse(raw); if (p && p.culture) cultureProducts = p.culture; } } catch (e) {}
                obj._strategy = {
                    doubleRoundRooms: doubleRoundRooms.slice(), roomModes: Object.assign({}, roomModes), centralMode: centralMode,
                    trustedAgentIds: trustedAgentIds.slice(), trustAssignMap: Object.assign({}, trustAssignMap),
                    meetingPriorityEnabled: meetingPriorityEnabled, missingClues: [...missingClues], excludedClues: [...excludedClues],
                    manufactProducts: manufactProducts, cultureProducts: cultureProducts,
                    roomPriorityOrderRound1: roomPriorityOrderRound1.slice(), roomPriorityOrderRound2: roomPriorityOrderRound2.slice()
                };
                return obj;
            } catch (e) { return {}; }
        },
        applyConfig: function(config) {
            try {
                if (!config || typeof config !== 'object') return false;
                const strategy = config._strategy || null;
                const opConfig = {};
                for (const [name, val] of Object.entries(config)) { if (name.startsWith('_')) continue; opConfig[name] = val; }
                if (window.DijiangAPI) window.DijiangAPI.applyEliteConfig(opConfig);
                
                if (strategy) {
                    try {
                        if (strategy.roomModes) { for (const k of ALL_ROOMS) { if (['empty', 'single', 'double'].includes(strategy.roomModes[k])) roomModes[k] = strategy.roomModes[k]; } syncDoubleRooms(); renderRoomModesUI(); }
                        else if (Array.isArray(strategy.doubleRoundRooms)) { doubleRoundRooms = strategy.doubleRoundRooms.filter(v => ['central','manufactA','manufactB','culture','meeting'].includes(v)); }
                        if (typeof strategy.centralMode === 'string' && ['normal','empty','trust'].includes(strategy.centralMode)) centralMode = strategy.centralMode;
                        if (Array.isArray(strategy.trustedAgentIds)) trustedAgentIds = strategy.trustedAgentIds.filter(id => operators.some(o => o.id === id));
                        // trustAssignMap 已废弃，忽略
                        trustAssignMap = {};
                        if (typeof strategy.meetingPriorityEnabled === 'boolean') meetingPriorityEnabled = strategy.meetingPriorityEnabled;
                        if (Array.isArray(strategy.missingClues)) missingClues = new Set(strategy.missingClues.filter(n => n >= 1 && n <= 7));
                        if (Array.isArray(strategy.excludedClues)) excludedClues = new Set(strategy.excludedClues.filter(n => n >= 1 && n <= 7));
                        if (strategy.manufactProducts) { sessionStorage.setItem('DijiangDefaultProduct', JSON.stringify(strategy.manufactProducts)); }
                        if (strategy.cultureProducts) { let all = {}; try { const raw = sessionStorage.getItem('DijiangManualProduct'); if (raw) all = JSON.parse(raw) || {}; } catch (e) {} all.culture = strategy.cultureProducts; sessionStorage.setItem('DijiangManualProduct', JSON.stringify(all)); }
                        if (Array.isArray(strategy.roomPriorityOrderRound1)) roomPriorityOrderRound1 = strategy.roomPriorityOrderRound1;
                        if (Array.isArray(strategy.roomPriorityOrderRound2)) roomPriorityOrderRound2 = strategy.roomPriorityOrderRound2;
                    } catch (e) {}
                }
                initUI(); generateSchedule();
                return true;
            } catch (e) { return false; }
        }
    };

    (function handleUrlActions() {
        const params = new URLSearchParams(window.location.search);
        const needAccount = params.get('openAccount') === '1';
        const needDataSettings = params.get('openDataSettings') === '1';
        if (!needAccount && !needDataSettings) return;
        try { const clean = window.location.pathname + window.location.hash; window.history.replaceState({}, '', clean); } catch (e) {}
        if (needAccount) { setTimeout(function () { const btn = document.getElementById('accountBtn'); if (btn) btn.click(); }, 600); }
        if (needDataSettings) { setTimeout(function () { if (typeof window.openDataSettings === 'function') window.openDataSettings(); }, 600); }
    })();
    console.log('[帝江号] 拆分版 main.js 已就绪。');
})();