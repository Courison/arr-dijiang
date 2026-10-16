/* ============================================================
   main.js —— 主排班系统
   侧边栏已改为导航菜单，由 modules/sidebar.js 处理
   干员库 / 生产策略改为弹窗，由本文件控制
   
   v2026.10.14：修复会客室排除线索/缺失线索、培养舱优先级、
                会客室二轮替换、清理重复定义
   ============================================================ */
(function() {
    // ========== 干员库 / 生产策略 弹窗控制 ==========
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

    /* ============================================================
       弹窗打开时隐藏浮动按钮，避免遮挡（兼容所有浏览器）
       ============================================================ */
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

            document.querySelectorAll('#dataSettingsModal .ds-card').forEach(c => {
                c.classList.remove('open');
            });

            if (!isCurrentlyOpen) {
                targetCard.classList.add('open');
            }
        };
    })();

    // ========== 主系统逻辑 ==========
    const ELITE_RANK = { 'none': 0, '精零': 1, '精一': 2, '精二': 3, '精三': 4, '精四': 5 };
    const ELITE_LABEL = ['未拥有', '精零', '精一', '精二', '精三', '精四'];
    const ELITE_STATES = ['none', '精零', '精一', '精二', '精三', '精四'];
    const TALENT_ORDER = ['1_1', '2_1', '1_2', '2_2'];
    const TALENT_META = {
        '1_1': { minElite: 2, prereq: null  },
        '2_1': { minElite: 3, prereq: null  },
        '1_2': { minElite: 4, prereq: '1_1' },
        '2_2': { minElite: 5, prereq: '2_1' },
    };
    const STORAGE_KEY = 'DijiangScheduleConfig';
    const MOOD_WEIGHT = 0.3;
    const DEFAULT_CULTURE_PRIORITY = ['plant', 'mineral', 'fungi'];
    const DEFAULT_PRIORITY_WEIGHTS = [1.0, 0.6, 0.3];

    function getPriorityWeights() {
        const w = window.DIJIANG_PRIORITY_WEIGHTS;
        if (Array.isArray(w) && w.length > 0) return w;
        return DEFAULT_PRIORITY_WEIGHTS;
    }

    function getCRestHigh() {
        const v = window.DIJIANG_OPT_CREST_OVERRIDE;
        if (typeof v === 'number' && isFinite(v) && v > 0) return v;
        return 12 * 1.48;
    }

    function isManufactDebug() {
        return window.DIJIANG_MANUFACT_DEBUG === true;
    }

    let centralMode = 'normal';
    let trustedAgentIds = [];
    let trustAssignMap = {};
    let meetingPriorityEnabled = false;
    let missingClues = new Set();
    let excludedClues = new Set([3, 7]);   // ★ 会客室二轮排除线索，默认 3、7
    const ALL_DOUBLE_ROOMS = ['central', 'manufactA', 'manufactB', 'culture', 'meeting'];
    let doubleRoundRooms = ALL_DOUBLE_ROOMS.slice();
    let rawOperatorsData = null;
    let operators = [];
    let nextId = 1;
    let modalDiv = null;
    let currentFilter = 'all';
    let currentStarFilter = 'all';
    let currentAttributeFilter = 'all';

    function emptyTalents() { return { '1_1': false, '2_1': false, '1_2': false, '2_2': false }; }
    function canActivate(op, tid) {
        const m = TALENT_META[tid];
        if (!m) return false;
        if (ELITE_RANK[op.eliteLevel] < m.minElite) return false;
        return true;
    }
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

    // ---------- 头像（精灵图方案） ----------
    const avatarBase64Cache = {};
    const spriteDataUrlCache = {};
    let spriteImage = null;
    let spriteIndex = null;
    let spriteReady = false;
    let spriteLoadPromise = null;

    function getAvatarPath(name) {
        return `/Agent/${encodeURIComponent(name)}.webp`;
    }

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
                console.log(`[精灵图] 已加载 ${imgUrl} (${spriteIndex.canvas_width}x${spriteIndex.canvas_height}, ${Object.keys(spriteIndex.agents || {}).length} 个干员)`);
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
            canvas.width = pos.w;
            canvas.height = pos.h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(spriteImage, pos.x, pos.y, pos.w, pos.h, 0, 0, pos.w, pos.h);
            let dataUrl = '';
            try { dataUrl = canvas.toDataURL('image/webp', 0.9); } catch (_) {}
            if (!dataUrl || dataUrl.indexOf('data:image/webp') !== 0) {
                dataUrl = canvas.toDataURL('image/png');
            }
            spriteDataUrlCache[name] = dataUrl;
            return dataUrl;
        } catch (e) {
            console.warn(`[精灵图] 裁切 ${name} 失败：`, e);
            return null;
        }
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
        } catch (e) {
            avatarBase64Cache[name] = null;
            return null;
        }
    }

    async function preloadAllAvatars(names, concurrency = 6) {
        const ok = await loadSprite();
        if (ok) {
            console.log(`[头像预载] 精灵图模式，共 ${names.length} 个干员（长图已就绪）`);
            return;
        }
        const queue = [...names];
        const total = queue.length;
        console.log(`[头像预载] 单张模式，共 ${total} 个干员...`);
        const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
            while (queue.length > 0) {
                const name = queue.shift();
                if (!name) break;
                try { await loadAvatarAsBase64(name); } catch (e) {}
            }
        });
        await Promise.all(workers);
        console.log(`[头像预载] 完成：成功 ${Object.values(avatarBase64Cache).filter(Boolean).length}/${total}`);
    }

    function getAgentImgSrc(opOrName) {
        const name = typeof opOrName === 'string' ? opOrName : opOrName.name;
        const spriteUrl = getSpriteDataUrl(name);
        if (spriteUrl) return spriteUrl;
        if (avatarBase64Cache[name]) return avatarBase64Cache[name];
        return getAvatarPath(name);
    }

    function escapeHtml(str) { return String(str).replace(/[&<>"']/g, function(m){ if(m==='&') return '&amp;'; if(m==='<') return '&lt;'; if(m==='>') return '&gt;'; if(m==='"') return '&quot;'; if(m==="'") return '&#39;'; return m; }); }

    // ---------- 天赋合并 ----------
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
            const key = isCluePower(t.类型)
                ? `${t.舱室}|线索概率|线索${t.线索编号}`
                : `${t.舱室}|${t.类型}`;
            if (!map.has(key)) {
                map.set(key, { ...t });
            } else {
                const existing = map.get(key);
                if (isCluePower(t.类型) && isCluePower(existing.类型)) {
                    if (CLUE_PRIORITY[t.类型] > CLUE_PRIORITY[existing.类型]) {
                        map.set(key, { ...t });
                    }
                } else if (t.数值 !== undefined && existing.数值 !== undefined) {
                    existing.数值 = Math.max(existing.数值, t.数值);
                }
            }
        }
        return Array.from(map.values());
    }
    // ---------- 干员列表初始化 ----------
    function initOperatorsList() {
        operators = [];
        nextId = 1;
        let order = rawOperatorsData.operator_order;
        if (!order || !Array.isArray(order) || order.length === 0) {
            order = Object.keys(rawOperatorsData).filter(key => key !== 'operator_order');
        }
        for (const name of order) {
            const info = rawOperatorsData[name];
            if (info) {
                operators.push({
                    id: nextId++,
                    name: name,
                    star: info.star || '未知',
                    attribute: info.attribute || '未知',
                    eliteLevel: 'none',
                    activatedTalents: emptyTalents(),
                    mergedTraits: []
                });
            }
        }
        updateAllMergedTraits();
        renderOperatorStatus();
    }

    function updateAllMergedTraits() {
        for (const op of operators) {
            if (op.eliteLevel === 'none' || op.eliteLevel === '精零') {
                op.mergedTraits = [];
            } else {
                op.mergedTraits = mergeActivatedTraits(op.activatedTalents, rawOperatorsData[op.name] || {});
            }
        }
    }

    function setEliteLevel(op, newLevel) {
        op.eliteLevel = newLevel;
        sanitizeTalents(op);
    }

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
            const talentBadge = (op.eliteLevel !== 'none' && op.eliteLevel !== '精零')
                ? `<span class="badge" style="background:#e0f0ea; color:#2a5a4a;">天赋 ${activeCount}/4</span>` : '';
            return `<div class="status-item" data-name="${op.name}">
                        <div class="status-item-left">
                            <img class="agent-avatar-small" src="${imgSrc}" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'32\' height=\'32\'%3E%3Crect width=\'32\' height=\'32\' fill=\'%23eaeaea\'/%3E%3C/svg%3E';">
                            <span>${escapeHtml(op.name)}</span>
                        </div>
                        ${talentBadge}
                        <span class="badge">${levelText}</span>
                    </div>`;
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

    // ---------- 单干员编辑弹窗 ----------
    function renderTalentRow(op, tid) {
        const meta = TALENT_META[tid];
        const rawData = rawOperatorsData[op.name] || {};
        const traits = getTalentList(rawData, tid);
        const activated = op.activatedTalents[tid];
        const canAct = canActivate(op, tid);

        let state = 'off';
        if (activated) state = 'on';
        else if (!canAct) state = 'locked';

        const displayName = (traits.length > 0 && traits[0].name) ? traits[0].name : tid;

        let effectText = '';
        if (traits.length > 0) {
            effectText = traits.map(t => formatShortTrait(t)).join('；');
        } else {
            effectText = '（暂无天赋数据）';
        }

        let lockMsg = '';
        if (state === 'locked') {
            lockMsg = `需 ${ELITE_LABEL[meta.minElite]}`;
        }

        const imgSrc = getTalentIconPath(traits);
        const imgTag = imgSrc ? `<img src="${imgSrc}" onerror="this.style.display='none';" alt="">` : '';
        const checkMark = state === 'on' ? '☑' : (state === 'off' ? '☐' : '🔒');

        return `<div class="talent-row" data-tid="${tid}" data-state="${state}" data-op="${escapeHtml(op.name)}">
            <div class="talent-icon" data-state="${state}" data-tid="${tid}">${imgTag}</div>
            <div class="talent-info">
                <div class="talent-id">${escapeHtml(displayName)}</div>
                <div class="talent-effect">${escapeHtml(effectText)}</div>
                ${lockMsg ? `<div class="talent-lock-msg">🔒 ${lockMsg}</div>` : ''}
            </div>
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
                <div class="elite-buttons" id="row1">
                    <div data-level="none" class="elite-btn ${currentLevel==='none'?'selected':''}">❌ 未拥有</div>
                    <div data-level="精零" class="elite-btn ${currentLevel==='精零'?'selected':''}">精零</div>
                </div>
                <div class="elite-buttons" id="row2">
                    <div data-level="精一" class="elite-btn ${currentLevel==='精一'?'selected':''}">精一</div>
                    <div data-level="精二" class="elite-btn ${currentLevel==='精二'?'selected':''}">精二</div>
                    <div data-level="精三" class="elite-btn ${currentLevel==='精三'?'selected':''}">精三</div>
                    <div data-level="精四" class="elite-btn ${currentLevel==='精四'?'selected':''}">精四</div>
                </div>

                <div class="edit-section-title">舱室天赋（点击切换激活）</div>
                <div id="talentListContainer"></div>

                <div class="modal-nav">
                    <button id="singleCancelBtn">取消</button>
                    <button id="singleConfirmBtn">确认修改</button>
                </div>
            </div>
        `;
        document.body.appendChild(modalDiv);

        const avatarDiv = modalDiv.querySelector('#singleAvatar');
        const tempImg = new Image();
        tempImg.onload = function() {
            avatarDiv.style.backgroundImage = `url(${imgSrc})`;
            avatarDiv.style.backgroundSize = 'cover';
            avatarDiv.style.backgroundPosition = 'center';
            avatarDiv.innerHTML = '';
        };
        tempImg.onerror = function() {
            avatarDiv.style.backgroundImage = 'none';
            avatarDiv.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:#f0f0f0;color:#888;font-size:0.7rem;border-radius:50%;">无图</div>`;
        };
        tempImg.src = imgSrc;
        if (tempImg.complete && tempImg.naturalWidth > 0) tempImg.onload();

        let tempLevel = currentLevel;
        let tempTalents = { ...op.activatedTalents };
        function tempOp() { return { eliteLevel: tempLevel, activatedTalents: tempTalents, name: op.name }; }
        function sanitizeTemp() {
            for (const tid of TALENT_ORDER) {
                if (tempTalents[tid] && !canActivate(tempOp(), tid)) {
                    tempTalents[tid] = false;
                    if (tid === '1_1') tempTalents['1_2'] = false;
                    if (tid === '2_1') tempTalents['2_2'] = false;
                }
            }
            if (tempTalents['1_2']) tempTalents['1_1'] = true;
            if (tempTalents['2_2']) tempTalents['2_1'] = true;
        }

        function renderTalentList() {
            const container = modalDiv.querySelector('#talentListContainer');
            container.innerHTML = TALENT_ORDER.map(tid => {
                const tmpOp = { eliteLevel: tempLevel, activatedTalents: tempTalents, name: op.name };
                const saved = { e: op.eliteLevel, a: op.activatedTalents };
                op.eliteLevel = tmpOp.eliteLevel;
                op.activatedTalents = tmpOp.activatedTalents;
                const html = renderTalentRow(op, tid);
                op.eliteLevel = saved.e;
                op.activatedTalents = saved.a;
                return html;
            }).join('');
            container.querySelectorAll('.talent-row').forEach(row => {
                row.addEventListener('click', function() {
                    const tid = this.dataset.tid;
                    const meta = TALENT_META[tid];
                    if (!meta) return;
                    const cur = { eliteLevel: tempLevel, activatedTalents: tempTalents, name: op.name };
                    const isOn = tempTalents[tid];
                    const canAct = canActivate(cur, tid);
                    if (isOn) {
                        tempTalents[tid] = false;
                        if (tid === '1_1') tempTalents['1_2'] = false;
                        if (tid === '2_1') tempTalents['2_2'] = false;
                    } else {
                        if (!canAct) {
                            alert(`需 ${ELITE_LABEL[meta.minElite]} 才能激活 ${tid}`);
                            return;
                        }
                        tempTalents[tid] = true;
                        if (tid === '1_2') tempTalents['1_1'] = true;
                        if (tid === '2_2') tempTalents['2_1'] = true;
                    }
                    sanitizeTemp();
                    renderTalentList();
                });
            });
        }

        function renderEliteButtons() {
            modalDiv.querySelectorAll('.elite-btn').forEach(btn => {
                btn.classList.toggle('selected', btn.dataset.level === tempLevel);
            });
        }

        modalDiv.querySelectorAll('.elite-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const newLevel = btn.dataset.level;
                tempLevel = newLevel;
                sanitizeTemp();
                renderEliteButtons();
                renderTalentList();
            });
        });

        renderTalentList();

        modalDiv.querySelector('#singleConfirmBtn').addEventListener('click', () => {
            op.eliteLevel = tempLevel;
            op.activatedTalents = { ...tempTalents };
            updateAllMergedTraits();
            renderOperatorStatus();
            saveConfigToSessionStorage();
            generateSchedule();
            modalDiv.remove(); modalDiv = null;
        });
        modalDiv.querySelector('#singleCancelBtn').addEventListener('click', () => { modalDiv.remove(); modalDiv = null; });
        modalDiv.querySelector('#singleCloseBtn').addEventListener('click', () => { modalDiv.remove(); modalDiv = null; });
    }

    // ---------- Session 存取 ----------
    function saveConfigToSessionStorage() {
        const config = {};
        for (const op of operators) {
            config[op.name] = {
                elite: op.eliteLevel,
                talents: TALENT_ORDER.filter(tid => op.activatedTalents[tid]),
            };
        }
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
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            console.warn('[帝江号] 配置快照解析失败，保留原字符串不覆盖：', e);
            return false;
        }
        if (!parsed || typeof parsed !== 'object') {
            console.warn('[帝江号] 配置快照格式异常，保留原字符串不覆盖。');
            return false;
        }
        let matched = 0;
        let total = 0;
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
        if (matched === 0 && total > 0) {
            console.warn('[帝江号] 配置快照与当前干员库不匹配，本次不应用，但不覆盖。');
            return false;
        }
        updateAllMergedTraits();
        renderOperatorStatus();
        return true;
    }

    function getOperatorOrder() {
        let order = rawOperatorsData.operator_order;
        if (!order || !Array.isArray(order) || order.length === 0) {
            order = Object.keys(rawOperatorsData).filter(key => key !== 'operator_order');
        }
        return order;
    }

    function getCurrentConfigJSON() {
        const config = {};
        for (const op of operators) config[op.name] = op.eliteLevel;
        const sortedNames = Object.keys(config).sort();
        const sorted = {};
        for (const name of sortedNames) sorted[name] = config[name];
        return JSON.stringify(sorted);
    }

    // ---------- 导出/导入 ----------
    function openEIOverlay(title, html) {
        document.getElementById('eiTitle').textContent = title;
        document.getElementById('eiContent').innerHTML = html;
        document.getElementById('exportImportOverlay').classList.add('open');
    }
    function closeEIOverlay() { document.getElementById('exportImportOverlay').classList.remove('open'); }
    document.getElementById('eiCloseBtn').addEventListener('click', closeEIOverlay);
    document.getElementById('exportImportOverlay').addEventListener('click', function(e) { if (e.target === this) closeEIOverlay(); });
    document.getElementById('eiBackBtn').addEventListener('click', function() {
        closeEIOverlay();
        if (typeof window.openDataSettings === 'function') window.openDataSettings();
    });

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

    // ---------- 批量设置 ----------
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

    document.getElementById('batchOperatorGrid').addEventListener('click', function(e) {
        const card = e.target.closest('.op-card');
        if (!card) return;
        const id = parseInt(card.dataset.id);
        if (batchSelectedIds.has(id)) batchSelectedIds.delete(id);
        else batchSelectedIds.add(id);
        renderBatchGrid();
    });

    function batchSelectAll() { getBatchFilteredOperators().forEach(op => batchSelectedIds.add(op.id)); renderBatchGrid(); }
    function batchClearAll() { batchSelectedIds.clear(); renderBatchGrid(); }
    document.getElementById('batchSelectAllBtn').addEventListener('click', batchSelectAll);
    document.getElementById('batchClearAllBtn').addEventListener('click', batchClearAll);
    document.getElementById('batchFilterStar').addEventListener('change', function() { batchSelectedIds.clear(); renderBatchGrid(); });
    document.getElementById('batchFilterAttribute').addEventListener('change', function() { batchSelectedIds.clear(); renderBatchGrid(); });

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
        batchSelectAll();
        document.getElementById('batchModalOverlay').classList.add('open');
    }

    document.getElementById('closeBatchModalBtn').addEventListener('click', function() { document.getElementById('batchModalOverlay').classList.remove('open'); });
    document.getElementById('batchCancelBtn').addEventListener('click', batchCancel);
    document.getElementById('batchSaveBtn').addEventListener('click', batchSave);
    document.getElementById('batchModalOverlay').addEventListener('click', function(e) { if (e.target === this && confirm('确定关闭吗？未保存的更改将丢失。')) batchCancel(); });

    document.getElementById('dsBtnBatch').addEventListener('click', function() { window.closeDataSettings(); openBatchModal(); });
    document.getElementById('dsBtnImport').addEventListener('click', function() { window.closeDataSettings(); showImportModal(); });
    document.getElementById('dsBtnExport').addEventListener('click', function() { window.closeDataSettings(); showExportModal(); });
    (function() {
        const accountCloudBtn = document.getElementById('dsBtnAccountCloud');
        if (!accountCloudBtn) return;
        accountCloudBtn.addEventListener('click', function() {
            window.closeDataSettings();
            const accountBtn = document.getElementById('accountBtn');
            if (accountBtn) {
                accountBtn.click();
            } else if (typeof window.openAccountLogin === 'function') {
                window.openAccountLogin();
            }
        });
    })();

    document.getElementById('batchBackBtn').addEventListener('click', function() { batchCancel(); window.openDataSettings(); });

    // ---------- 信赖 ----------
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
        const isDoubleCentral = doubleRoundRooms.includes('central');
        const max = isDoubleCentral ? 6 : 3;
        trustMaxCount.textContent = max;
        trustInfoLabel.textContent = `选择信赖干员（至多${max}人，${isDoubleCentral ? '可分配至两轮' : '优先放入中枢'}）：`;
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
    function openTrustModal() { updateTrustMaxLabel(); trustTempSelected = [...trustedAgentIds]; renderTrustGrid(); trustModalOverlay.classList.add('open'); }
    function closeTrustModal() { trustModalOverlay.classList.remove('open'); }

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
    trustFilterStar.addEventListener('change', renderTrustGrid);
    trustFilterAttribute.addEventListener('change', renderTrustGrid);
    trustFilterResetBtn.addEventListener('click', function() { trustFilterStar.value = 'all'; trustFilterAttribute.value = 'all'; renderTrustGrid(); });
    trustClearBtn.addEventListener('click', function() { trustTempSelected = []; renderTrustGrid(); });
    trustCancelBtn.addEventListener('click', closeTrustModal);

    trustConfirmBtn.addEventListener('click', function() {
        const max = parseInt(trustMaxCount.textContent) || 3;
        if (trustTempSelected.length > max) { alert(`最多选择 ${max} 名干员`); return; }
        trustedAgentIds = [...trustTempSelected];
        updateTrustTags();
        sessionStorage.setItem('trustedAgentIds', JSON.stringify(trustedAgentIds));
        closeTrustModal();
        if (doubleRoundRooms.includes('central') && trustedAgentIds.length > 0) {
            trustAssignMap = {};
            if (trustedAgentIds.length <= 3) { for (const id of trustedAgentIds) trustAssignMap[id] = 'round1'; }
            else {
                const half = Math.min(3, Math.ceil(trustedAgentIds.length / 2));
                trustedAgentIds.forEach((id, index) => { trustAssignMap[id] = index < half ? 'round1' : 'round2'; });
            }
            sessionStorage.setItem('trustAssignMap', JSON.stringify(trustAssignMap));
            openTrustAssignModal();
        } else {
            trustAssignMap = {};
            for (const id of trustedAgentIds) trustAssignMap[id] = 'round1';
            sessionStorage.setItem('trustAssignMap', JSON.stringify(trustAssignMap));
            generateSchedule();
        }
    });
    trustModalCloseBtn.addEventListener('click', closeTrustModal);
    trustModalOverlay.addEventListener('click', function(e) { if (e.target === this) closeTrustModal(); });

    function updateTrustTags() {
        const container = document.getElementById('trustTags');
        if (!container) return;
        if (trustedAgentIds.length === 0) { container.innerHTML = '<span style="color:#999; font-size:0.8rem;">未选择</span>'; return; }
        const names = trustedAgentIds.map(id => { const op = operators.find(o => o.id === id); return op ? op.name : '?'; });
        container.innerHTML = names.map(name => `<span class="trust-tag">${escapeHtml(name)}</span>`).join('');
    }

    const trustAssignOverlay = document.getElementById('trustAssignOverlay');
    const trustAssignCloseBtn = document.getElementById('trustAssignCloseBtn');
    const trustAssignCancelBtn = document.getElementById('trustAssignCancelBtn');
    const trustAssignConfirmBtn = document.getElementById('trustAssignConfirmBtn');
    const trustRound1Container = document.getElementById('trustRound1Container');
    const trustRound2Container = document.getElementById('trustRound2Container');
    let tempTrustAssignMap = {};

    function openTrustAssignModal() {
        if (Object.keys(trustAssignMap).length === 0 && trustedAgentIds.length > 0) {
            const half = Math.min(3, Math.ceil(trustedAgentIds.length / 2));
            trustedAgentIds.forEach((id, index) => { trustAssignMap[id] = index < half ? 'round1' : 'round2'; });
            sessionStorage.setItem('trustAssignMap', JSON.stringify(trustAssignMap));
        }
        tempTrustAssignMap = { ...trustAssignMap };
        renderTrustAssign();
        trustAssignOverlay.classList.add('open');
    }
    function closeTrustAssignModal() { trustAssignOverlay.classList.remove('open'); }
    function renderTrustAssign() {
        trustRound1Container.innerHTML = '';
        trustRound2Container.innerHTML = '';
        const round1Ids = Object.keys(tempTrustAssignMap).filter(id => tempTrustAssignMap[id] === 'round1').map(Number);
        const round2Ids = Object.keys(tempTrustAssignMap).filter(id => tempTrustAssignMap[id] === 'round2').map(Number);
        const r1Label = document.querySelector('#trustAssignOverlay .trust-round1-label');
        const r2Label = document.querySelector('#trustAssignOverlay .trust-round2-label');
        if (r1Label) {
            r1Label.textContent = `🔵 一轮（中枢） ${round1Ids.length}/3`;
            r1Label.style.color = round1Ids.length > 3 ? '#c0392b' : '';
        }
        if (r2Label) {
            r2Label.textContent = `🟡 二轮（中枢） ${round2Ids.length}/3`;
            r2Label.style.color = round2Ids.length > 3 ? '#c0392b' : '';
        }
        renderDropZone(trustRound1Container, round1Ids);
        renderDropZone(trustRound2Container, round2Ids);
    }
    function renderDropZone(container, idList) {
        container.innerHTML = '';
        if (idList.length === 0) { container.innerHTML = '<span class="empty-hint">暂无干员</span>'; return; }
        idList.forEach(id => {
            const op = operators.find(o => o.id === id);
            if (!op) return;
            const card = document.createElement('div');
            card.className = 'trust-drag-card';
            card.dataset.id = op.id;
            const imgSrc = getAgentImgSrc(op);
            card.innerHTML = `<img src="${imgSrc}" onerror="this.style.display='none';"><div class="name">${op.name}</div>`;
            card.addEventListener('click', function() {
                const cur = tempTrustAssignMap[id];
                const target = cur === 'round1' ? 'round2' : 'round1';
                tempTrustAssignMap[id] = target;
                renderTrustAssign();
            });
            container.appendChild(card);
        });
    }
    trustAssignCloseBtn.addEventListener('click', function() { tempTrustAssignMap = { ...trustAssignMap }; renderTrustAssign(); closeTrustAssignModal(); });
    trustAssignCancelBtn.addEventListener('click', function() { tempTrustAssignMap = { ...trustAssignMap }; renderTrustAssign(); closeTrustAssignModal(); });
    trustAssignConfirmBtn.addEventListener('click', function() {
        const round1Count = Object.values(tempTrustAssignMap).filter(v => v === 'round1').length;
        const round2Count = Object.values(tempTrustAssignMap).filter(v => v === 'round2').length;
        if (round1Count > 3 || round2Count > 3) {
            alert(`每轮最多 3 名干员（当前：一轮 ${round1Count} 人，二轮 ${round2Count} 人），请调整后再确认。`);
            return;
        }
        if (trustedAgentIds.length > 3 && (round1Count === 0 || round2Count === 0)) {
            alert('当选择超过3名干员时，一轮和二轮都至少需要分配1人');
            return;
        }
        trustAssignMap = { ...tempTrustAssignMap };
        sessionStorage.setItem('trustAssignMap', JSON.stringify(trustAssignMap));
        closeTrustAssignModal();
        generateSchedule();
    });
    trustAssignOverlay.addEventListener('click', function(e) { if (e.target === this) { tempTrustAssignMap = { ...trustAssignMap }; renderTrustAssign(); closeTrustAssignModal(); } });
    // ---------- 排班：产品配置 ----------
    function getManufactMode() {
        const expCheck = document.querySelector('#manufactProducts input[value="exp"]');
        const weaponCheck = document.querySelector('#manufactProducts input[value="weapon"]');
        if (!expCheck || !weaponCheck) return 'dual';
        const e = expCheck.checked, w = weaponCheck.checked;
        if (e === w) return 'dual';
        return e ? 'exp' : 'weapon';
    }
    function getCultureTypes() {
        // ★ 优先从 DijiangManualProduct 读取
        try {
            const raw = sessionStorage.getItem('DijiangManualProduct');
            if (raw) {
                const p = JSON.parse(raw);
                const c = p.culture;
                if (c && typeof c === 'object' && Array.isArray(c.products) && c.products.length) {
                    return c.products.slice();
                }
            }
        } catch (e) {}
        const checks = Array.from(document.querySelectorAll('#cultureProducts input:checked')).map(cb => cb.value);
        return checks.length ? checks : ['mineral', 'fungi', 'plant'];
    }

    // ★ 保存产品配置到 sessionStorage，供手动排班页 / 步进页导入（唯一定义）
    function saveProductConfigToSession() {
        try {
            const mode = getManufactMode();
            const cultureTypes = getCultureTypes();
            let mA, mB;
            if (mode === 'dual') { mA = 'exp'; mB = 'weapon'; }
            else if (mode === 'exp') { mA = 'exp'; mB = 'exp'; }
            else { mA = 'weapon'; mB = 'weapon'; }

            sessionStorage.setItem('DijiangDefaultProduct', JSON.stringify({
                manufactA: mA,
                manufactB: mB,
                culture: cultureTypes
            }));

            // ★ 同步更新 DijiangManualProduct 中的 culture，保留 priority
            let all = {};
            const raw = sessionStorage.getItem('DijiangManualProduct');
            if (raw) {
                try { all = JSON.parse(raw) || {}; } catch (_) { all = {}; }
            }
            const cultureProducts = getCultureTypes();
            const culturePriority = (all.culture && Array.isArray(all.culture.priority))
                ? all.culture.priority.filter(x => cultureProducts.includes(x))
                : null;
            all.culture = {
                products: cultureProducts,
                priority: (culturePriority && culturePriority.length > 0) ? culturePriority : null
            };
            sessionStorage.setItem('DijiangManualProduct', JSON.stringify(all));
        } catch (e) {
            console.warn('[帝江号] 保存产品配置失败：', e);
        }
    }

    // ★ 获取培养舱有效优先级顺序（唯一定义）
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
                for (const x of DEFAULT_CULTURE_PRIORITY) {
                    if (products.includes(x) && !result.includes(x)) result.push(x);
                }
                for (const x of products) {
                    if (!result.includes(x)) result.push(x);
                }
                return result;
            }

            const result = [];
            for (const x of DEFAULT_CULTURE_PRIORITY) {
                if (products.includes(x)) result.push(x);
            }
            for (const x of products) {
                if (!result.includes(x)) result.push(x);
            }
            return result;
        } catch (e) {
            return DEFAULT_CULTURE_PRIORITY.slice();
        }
    }

    // ---------- 评分 ----------
    function computeScoresForAll() {
        const mode = getManufactMode();
        const activeCultureTypes = getCultureTypes();
        const scores = [];
        for (const op of operators) {
            if (op.eliteLevel === 'none') continue;
            const score = { central: 0, meeting: 0, culture: 0, manufact: 0, expScore: 0, weaponScore: 0, moodReduce: 0 };
            if (op.eliteLevel === '精零') { scores.push({ opId: op.id, name: op.name, mergedTraits: [], score, isBasic: true }); continue; }
            for (const t of op.mergedTraits) {
                const room = t.舱室, type = t.类型, val = t.数值 || 0;
                if (room === '总控中枢' && type === '心情恢复提升') score.central += val;
                if (room === '会客室') {
                    if (type === '收集线索效率') score.meeting += val;
                    if (type === '心情消耗减少') { score.meeting += val * MOOD_WEIGHT; score.moodReduce += val; }
                    // ★ 线索概率不参与基础评分，避免在一轮贪心中挤占高效组
                    //   仅在二轮替换阶段作为候选排序依据（见 replaceMeetingSecondRoundWithCluePowers）
                }
                if (room === '培养舱') {
                    // 按优先级加权：高优先级产物的效率更受重视
                    const PRODUCT_MAP = { '矿物效率': 'mineral', '菌类效率': 'fungi', '晶植效率': 'plant' };
                    const product = PRODUCT_MAP[type];
                    if (product && activeCultureTypes.includes(product)) {
                        const priorityOrder = getCulturePriority();
                        const rank = priorityOrder.indexOf(product);
                        const weights = getPriorityWeights();
                        const weight = rank >= 0
                            ? (weights[rank] !== undefined ? weights[rank] : 0.1)
                            : 1.0;
                        score.culture += val * weight;
                    }
                    if (type === '心情消耗减少') { score.culture += val * MOOD_WEIGHT; score.moodReduce += val; }
                }
                if (room === '制造舱') {
                    if (type === '干员素材效率') { score.expScore += val; if (mode === 'dual' || mode === 'exp') score.manufact += val; }
                    if (type === '武器素材效率') { score.weaponScore += val; if (mode === 'dual' || mode === 'weapon') score.manufact += val; }
                    if (type === '心情消耗减少') {
                        // ★ 减耗只贡献 manufact 综合分，不污染 expScore / weaponScore
                        //   避免"只减耗、无效率"的干员被误分进制造舱 A/B
                        score.manufact += val * MOOD_WEIGHT;
                        score.moodReduce += val;
                    }
                }
            }
            scores.push({ opId: op.id, name: op.name, mergedTraits: op.mergedTraits, score, isBasic: false });
        }
        return scores;
    }

    // ========== 减耗优化：辅助函数 ==========

    // 提取干员在指定舱室的效率与减耗原始值
    function extractTalentForRoom(mergedTraits, roomKey, mode, cultureTypes) {
        const roomRawName = {
            meeting: '会客室', culture: '培养舱',
            manufactA: '制造舱', manufactB: '制造舱', central: '总控中枢'
        }[roomKey];
        if (!roomRawName) return { eff: 0, reduce: 0 };

        let eff = 0, reduce = 0;
        for (const t of (mergedTraits || [])) {
            if (t.舱室 !== roomRawName) continue;
            if (t.类型 === '心情消耗减少') { reduce += t.数值 || 0; continue; }

            if (roomKey === 'meeting' && t.类型 === '收集线索效率') eff += t.数值 || 0;
            else if (roomKey === 'culture') {
                if (cultureTypes.includes('mineral') && t.类型 === '矿物效率') eff += t.数值 || 0;
                if (cultureTypes.includes('fungi')   && t.类型 === '菌类效率') eff += t.数值 || 0;
                if (cultureTypes.includes('plant')   && t.类型 === '晶植效率') eff += t.数值 || 0;
            } else if (roomKey === 'manufactA' || roomKey === 'manufactB') {
                if (t.类型 === '干员素材效率' && (mode === 'exp' || mode === 'dual')) eff += t.数值 || 0;
                if (t.类型 === '武器素材效率' && (mode === 'weapon' || mode === 'dual')) eff += t.数值 || 0;
            } else if (roomKey === 'central' && t.类型 === '心情恢复提升') {
                eff += t.数值 || 0;
            }
        }
        return { eff, reduce };
    }

    // 计算一组干员在某舱室的有效效率与减耗总和
    function groupEffectiveEffReduce(members, roomKey, mode, cultureTypes) {
        let eff = 0, reduce = 0;
        for (const m of members) {
            if (!m) continue;
            const r = extractTalentForRoom(m.mergedTraits, roomKey, mode, cultureTypes);
            eff += r.eff;
            reduce += r.reduce;
        }
        return { eff, reduce };
    }

    function evalPairOutput(A, B, roomKey, mode, cultureTypes, cRestHigh) {
        if (!A || !B || A.length === 0 || B.length === 0) return 0;
        const cRestLow = 12 * 1.0;

        const pA = groupEffectiveEffReduce(A, roomKey, mode, cultureTypes);
        const pB = groupEffectiveEffReduce(B, roomKey, mode, cultureTypes);

        const rateA = (1 + pA.eff / 100) * (1 + 0.4 * A.length);
        const rateB = (1 + pB.eff / 100) * (1 + 0.4 * B.length);
        const cWorkA = 7.2 * Math.max(0.1, 1 - pA.reduce / 100);
        const cWorkB = 7.2 * Math.max(0.1, 1 - pB.reduce / 100);

        let highRate, lowRate, cWorkHigh, cWorkLow;
        if (rateA >= rateB) {
            highRate = rateA; lowRate = rateB;
            cWorkHigh = cWorkA; cWorkLow = cWorkB;
        } else {
            highRate = rateB; lowRate = rateA;
            cWorkHigh = cWorkB; cWorkLow = cWorkA;
        }

        let bestOutput = 0;
        let found = false;
        for (let hHigh = 1; hHigh <= 23; hHigh++) {
            const hLow = 24 - hHigh;
            const effHighWork = Math.min(hHigh, 100 / cWorkHigh);
            const effLowWork  = Math.min(hLow,  100 / cWorkLow);

            const highConsume = effHighWork * cWorkHigh;
            const highRestore = hLow * cRestHigh;
            const lowConsume  = effLowWork * cWorkLow;
            const lowRestore  = hHigh * cRestLow;

            if (highConsume > highRestore + 1e-6) continue;
            if (lowConsume  > lowRestore  + 1e-6) continue;

            const output = highRate * effHighWork + lowRate * effLowWork;
            if (!found || output > bestOutput) {
                bestOutput = output;
                found = true;
            }
        }

        // 无可行解 → 退化到 hHigh = 13 的产出（保证优化可比较）
        if (!found) {
            const hHigh = 13, hLow = 11;
            const effHighWork = Math.min(hHigh, 100 / cWorkHigh);
            const effLowWork  = Math.min(hLow,  100 / cWorkLow);
            bestOutput = highRate * effHighWork + lowRate * effLowWork;
        }
        return bestOutput;
    }

    // ★ 培养舱多产物：优先级加权评估（含空位交换，唯一定义）
    function optimizeCulturePair(A, B, priority, cRestHigh) {
        if (!A || !B || A.length === 0 || B.length === 0) return;
        if (!priority || priority.length === 0) return;

        const EFF_TYPE_MAP = { mineral: '矿物效率', fungi: '菌类效率', plant: '晶植效率' };

        function calcHA() {
            const pA = groupEffectiveEffReduce(A, 'culture', 'dual', []);
            const pB = groupEffectiveEffReduce(B, 'culture', 'dual', []);
            const cA = 7.2 * Math.max(0.1, 1 - pA.reduce / 100);
            const cB = 7.2 * Math.max(0.1, 1 - pB.reduce / 100);
            const hA_max = Math.min(100 / cA, 24 * cRestHigh / (cA + cRestHigh));
            return Math.max(1, Math.min(23, Math.floor(hA_max)));
        }

        function calcRate(group, product) {
            const effType = EFF_TYPE_MAP[product];
            if (!effType) return 0;
            let eff = 0, N = 0;
            for (const op of group) {
                if (!op) continue;
                N++;
                for (const t of (op.mergedTraits || [])) {
                    if (t.舱室 === '培养舱' && t.类型 === effType) eff += t.数值 || 0;
                }
            }
            return (1 + eff / 100) * (1 + 0.4 * N);
        }

        function totalValue(A2, B2) {
            const hA = calcHA();
            const hB = 24 - hA;
            const weights = getPriorityWeights();
            let V = 0;
            for (let i = 0; i < priority.length; i++) {
                const p = priority[i];
                const w = weights[i] !== undefined ? weights[i] : 0.1;
                V += w * (calcRate(A2, p) * hA + calcRate(B2, p) * hB);
            }
            return V;
        }

        const MAX_PER_GROUP = 3;
        let iterations = 0;
        let improved = true;
        while (improved && iterations < 8) {
            improved = false;
            iterations++;
            const baseOutput = totalValue(A, B);

            outerLoop:
            for (let i = 0; i < A.length; i++) {
                for (let j = 0; j < B.length; j++) {
                    const A2 = A.slice(); A2[i] = B[j];
                    const B2 = B.slice(); B2[j] = A[i];
                    if (totalValue(A2, B2) > baseOutput + 0.01) {
                        const tmp = A[i]; A[i] = B[j]; B[j] = tmp;
                        improved = true;
                        break outerLoop;
                    }
                }
            }
            if (improved) continue;

            if (B.length < MAX_PER_GROUP) {
                for (let i = 0; i < A.length; i++) {
                    const moved = A[i];
                    A.splice(i, 1); B.push(moved);
                    if (totalValue(A, B) > baseOutput + 0.01) { improved = true; break; }
                    else { B.pop(); A.splice(i, 0, moved); }
                }
            }
            if (improved) continue;

            if (A.length < MAX_PER_GROUP) {
                for (let j = 0; j < B.length; j++) {
                    const moved = B[j];
                    B.splice(j, 1); A.push(moved);
                    if (totalValue(A, B) > baseOutput + 0.01) { improved = true; break; }
                    else { A.pop(); B.splice(j, 0, moved); }
                }
            }
        }
    }

    // 单舱 1-opt（含空位交换）
    function optimizeRoomReduction(round1Map, round2Map, roomKey, mode, cultureTypes, cRestHigh) {
        const A = round1Map[roomKey] || (round1Map[roomKey] = []);
        const B = round2Map[roomKey] || (round2Map[roomKey] = []);
        if (A.length === 0 && B.length === 0) return;

        // ★ 培养舱多产物：走优先级加权评估
        if (roomKey === 'culture') {
            const priority = getCulturePriority();
            if (priority && priority.length > 1) {
                optimizeCulturePair(A, B, priority, cRestHigh);
                return;
            }
        }

        const MAX_PER_GROUP = 3;
        let iterations = 0;
        let improved = true;
        while (improved && iterations < 8) {
            improved = false;
            iterations++;
            const baseOutput = evalPairOutput(A, B, roomKey, mode, cultureTypes, cRestHigh);

            // 1. 交换 A 与 B 的干员
            outerLoop:
            for (let i = 0; i < A.length; i++) {
                for (let j = 0; j < B.length; j++) {
                    const A2 = A.slice(); A2[i] = B[j];
                    const B2 = B.slice(); B2[j] = A[i];
                    const newOutput = evalPairOutput(A2, B2, roomKey, mode, cultureTypes, cRestHigh);
                    if (newOutput > baseOutput + 0.01) {
                        const tmp = A[i]; A[i] = B[j]; B[j] = tmp;
                        improved = true;
                        break outerLoop;
                    }
                }
            }
            if (improved) continue;

            // 2. A -> B 空位（B 未满）
            if (B.length < MAX_PER_GROUP) {
                for (let i = 0; i < A.length; i++) {
                    const moved = A[i];
                    A.splice(i, 1);
                    B.push(moved);
                    const newOutput = evalPairOutput(A, B, roomKey, mode, cultureTypes, cRestHigh);
                    if (newOutput > baseOutput + 0.01) {
                        improved = true;
                        break;
                    } else {
                        B.pop();
                        A.splice(i, 0, moved);
                    }
                }
            }
            if (improved) continue;

            // 3. B -> A 空位（A 未满）
            if (A.length < MAX_PER_GROUP) {
                for (let j = 0; j < B.length; j++) {
                    const moved = B[j];
                    B.splice(j, 1);
                    A.push(moved);
                    const newOutput = evalPairOutput(A, B, roomKey, mode, cultureTypes, cRestHigh);
                    if (newOutput > baseOutput + 0.01) {
                        improved = true;
                        break;
                    } else {
                        A.pop();
                        B.splice(j, 0, moved);
                    }
                }
            }
        }
    }

    // 制造舱 A+B 联动
    function optimizeManufactPair(round1Map, round2Map, mode, cultureTypes, cRestHigh) {
        if (mode === 'dual') return;

        const groups = [
            { key: 'manufactA', round: 'round1', arr: round1Map.manufactA || (round1Map.manufactA = []) },
            { key: 'manufactA', round: 'round2', arr: round2Map.manufactA || (round2Map.manufactA = []) },
            { key: 'manufactB', round: 'round1', arr: round1Map.manufactB || (round1Map.manufactB = []) },
            { key: 'manufactB', round: 'round2', arr: round2Map.manufactB || (round2Map.manufactB = []) }
        ];

        const MAX_PER_GROUP = 3;

        function totalOutput() {
            let total = 0;
            total += evalPairOutput(groups[0].arr, groups[1].arr, 'manufactA', mode, cultureTypes, cRestHigh);
            total += evalPairOutput(groups[2].arr, groups[3].arr, 'manufactB', mode, cultureTypes, cRestHigh);
            return total;
        }

        let iterations = 0;
        let improved = true;
        const MAX_ITER = 30;

        while (improved && iterations < MAX_ITER) {
            improved = false;
            iterations++;
            const baseOutput = totalOutput();

            // 1. 交换任意两组的干员
            outer:
            for (let i = 0; i < groups.length; i++) {
                for (let j = i + 1; j < groups.length; j++) {
                    const gi = groups[i], gj = groups[j];
                    for (let pi = 0; pi < gi.arr.length; pi++) {
                        for (let pj = 0; pj < gj.arr.length; pj++) {
                            const tmpI = gi.arr[pi];
                            const tmpJ = gj.arr[pj];
                            gi.arr[pi] = tmpJ;
                            gj.arr[pj] = tmpI;

                            const newOutput = totalOutput();
                            if (newOutput > baseOutput + 0.01) {
                                if (isManufactDebug()) {
                                    console.log(`[制造舱优化] 交换 ${gi.key}(${gi.round})[${pi}] <-> ${gj.key}(${gj.round})[${pj}]，产出 ${baseOutput.toFixed(4)} → ${newOutput.toFixed(4)}`);
                                }
                                improved = true;
                                break outer;
                            } else {
                                gi.arr[pi] = tmpI;
                                gj.arr[pj] = tmpJ;
                            }
                        }
                    }
                }
            }
            if (improved) continue;

            // 2. 将干员从一组移到另一组的空位
            for (let i = 0; i < groups.length; i++) {
                const gi = groups[i];
                if (gi.arr.length === 0) continue;
                for (let j = 0; j < groups.length; j++) {
                    if (i === j) continue;
                    const gj = groups[j];
                    if (gj.arr.length >= MAX_PER_GROUP) continue;
                    for (let pi = 0; pi < gi.arr.length; pi++) {
                        const moved = gi.arr[pi];
                        gi.arr.splice(pi, 1);
                        gj.arr.push(moved);
                        const newOutput = totalOutput();
                        if (newOutput > baseOutput + 0.01) {
                            improved = true;
                            break;
                        } else {
                            gj.arr.pop();
                            gi.arr.splice(pi, 0, moved);
                        }
                    }
                    if (improved) break;
                }
                if (improved) break;
            }
        }
    }

    // 遍历需要优化的舱室（仅二轮舱室）
    function optimizeReductionPlacement(round1Map, round2Map, doubleRooms, mode, cultureTypes) {
        const cRestHigh = getCRestHigh();

        if (mode === 'exp' || mode === 'weapon') {
            // 制造舱 A、B 生产同一素材 → 12 槽位联动
            optimizeManufactPair(round1Map, round2Map, mode, cultureTypes, cRestHigh);
            // 其他舱室仍按单舱独立优化（会客室不参与 1-opt）
            for (const roomKey of ['culture']) {
                if (!doubleRooms.includes(roomKey)) continue;
                optimizeRoomReduction(round1Map, round2Map, roomKey, mode, cultureTypes, cRestHigh);
            }
        } else {
            // dual 模式：所有二轮舱室独立优化（会客室不参与 1-opt）
            for (const roomKey of ['culture', 'manufactA', 'manufactB']) {
                if (!doubleRooms.includes(roomKey)) continue;
                optimizeRoomReduction(round1Map, round2Map, roomKey, mode, cultureTypes, cRestHigh);
            }
        }
    }

    function recordTimingInfo(round1Map, round2Map, doubleRooms, mode, cultureTypes) {
        const cRestHigh = getCRestHigh();
        const cRestLow  = 12 * 1.0;
        const info = {};

        // ★ 培养舱：只用优先级第一的产物作为时间安排依据
        const culturePriority = getCulturePriority();
        const firstCultureProduct = culturePriority[0] || null;
        const cultureTypesForTiming = firstCultureProduct ? [firstCultureProduct] : cultureTypes;

        for (const key of ['manufactA', 'manufactB', 'culture', 'meeting']) {
            if (!doubleRooms.includes(key)) continue;
            const A = round1Map[key] || [];
            const B = round2Map[key] || [];
            if (A.length === 0 || B.length === 0) continue;

            // ★ 培养舱用单一产物；其它舱用全量
            const typesForThis = (key === 'culture') ? cultureTypesForTiming : cultureTypes;

            const pA = groupEffectiveEffReduce(A, key, mode, typesForThis);
            const pB = groupEffectiveEffReduce(B, key, mode, typesForThis);
            const cWorkA = 7.2 * Math.max(0.1, 1 - pA.reduce / 100);
            const cWorkB = 7.2 * Math.max(0.1, 1 - pB.reduce / 100);
            const rA = (1 + pA.eff / 100) * (1 + 0.4 * A.length);
            const rB = (1 + pB.eff / 100) * (1 + 0.4 * B.length);

            const highIsA = rA >= rB;
            const highRate = highIsA ? rA : rB;
            const lowRate  = highIsA ? rB : rA;
            const cWorkHigh = highIsA ? cWorkA : cWorkB;
            const cWorkLow  = highIsA ? cWorkB : cWorkA;

            let bestHHigh = 13;
            let bestOutput = -1;
            let found = false;
            for (let hHigh = 1; hHigh <= 23; hHigh++) {
                const hLow = 24 - hHigh;
                const effHighWork = Math.min(hHigh, 100 / cWorkHigh);
                const effLowWork  = Math.min(hLow,  100 / cWorkLow);

                if (effHighWork * cWorkHigh > hLow * cRestHigh + 1e-6) continue;
                if (effLowWork  * cWorkLow  > hHigh * cRestLow + 1e-6) continue;

                const output = highRate * effHighWork + lowRate * effLowWork;
                if (!found || output > bestOutput) { bestOutput = output; bestHHigh = hHigh; found = true; }
            }
            if (!found) bestHHigh = 13;

            const hA = highIsA ? bestHHigh : (24 - bestHHigh);
            const hB = 24 - hA;

            info[key] = { hA, hB, cA: cWorkA, cB: cWorkB, rA, rB, round1IsEfficient: highIsA };
            if (key === 'culture') info[key].cultureBasisProduct = firstCultureProduct;
        }
        return info;
    }

    // ---------- 会客室辅助函数 ----------
    // 分析干员的会客室天赋
    function analyzeMeetingTraits(scoreObj) {
        const info = { clueEff: 0, cluePower: 0, reduce: 0, cluePowerNums: [] };
        for (const t of (scoreObj.mergedTraits || [])) {
            if (t.舱室 !== '会客室') continue;
            if (t.类型 === '收集线索效率') info.clueEff += t.数值 || 0;
            else if (t.类型 === '心情消耗减少') info.reduce += t.数值 || 0;
            else if (t.类型 === '线索概率提升' || t.类型 === '线索概率小幅提升') {
                const n = parseInt(t.线索编号, 10);
                if (n >= 1 && n <= 7) info.cluePowerNums.push(n);
                info.cluePower += (t.类型 === '线索概率提升') ? 1.0 : 0.5;
            }
        }
        return info;
    }

    // 计算干员在某舱室的天赋总贡献
    function calcRoomContribution(op, roomKey) {
        if (!op || !op.mergedTraits) return 0;
        const rawRoom = {
            central: '总控中枢', manufactA: '制造舱', manufactB: '制造舱',
            culture: '培养舱', meeting: '会客室'
        }[roomKey];
        if (!rawRoom) return 0;
        let total = 0;
        for (const t of op.mergedTraits) {
            if (t.舱室 !== rawRoom) continue;
            total += (t.数值 || 0);
        }
        return total;
    }
    
    function calcRoomContributionActual(op, roomKey, workHours) {
        if (!op || !op.mergedTraits) return 0;
        const rawRoom = {
            central: '总控中枢', manufactA: '制造舱', manufactB: '制造舱',
            culture: '培养舱', meeting: '会客室'
        }[roomKey];
        if (!rawRoom) return 0;

        const mode = getManufactMode();
        const cultureTypes = getCultureTypes();

        let effTotal = 0;
        let reduceTotal = 0;
        for (const t of op.mergedTraits) {
            if (t.舱室 !== rawRoom) continue;
            const v = t.数值 || 0;
            if (t.类型 === '心情消耗减少') { reduceTotal += v; continue; }
            if (t.类型 === '线索概率提升' || t.类型 === '线索概率小幅提升') continue;

            // 根据舱室与当前产品过滤有效效率
            if (rawRoom === '制造舱') {
                if (t.类型 === '干员素材效率' && (mode === 'exp' || mode === 'dual')) effTotal += v;
                else if (t.类型 === '武器素材效率' && (mode === 'weapon' || mode === 'dual')) effTotal += v;
            } else if (rawRoom === '培养舱') {
                if (t.类型 === '矿物效率' && cultureTypes.includes('mineral')) effTotal += v;
                else if (t.类型 === '菌类效率' && cultureTypes.includes('fungi')) effTotal += v;
                else if (t.类型 === '晶植效率' && cultureTypes.includes('plant')) effTotal += v;
            } else if (rawRoom === '总控中枢') {
                if (t.类型 === '心情恢复提升') effTotal += v;
            } else if (rawRoom === '会客室') {
                if (t.类型 === '收集线索效率') effTotal += v;
                // 心情消耗减少已单独处理，线索概率不计入效率
            }
        }

        const effScore = effTotal * workHours;

        let reduceScore = 0;
        if (reduceTotal > 0 && workHours > 0) {
            const NO_REDUCE_MAX_H = 100 / 7.2;
            const WITH_REDUCE_MAX_H = 100 / (7.2 * Math.max(0.01, 1 - reduceTotal / 100));
            if (workHours > NO_REDUCE_MAX_H) {
                const extraH = Math.min(workHours, WITH_REDUCE_MAX_H) - NO_REDUCE_MAX_H;
                reduceScore = reduceTotal * extraH * 0.1;
            }
        }

        return effScore + reduceScore;
    }

    // 检查干员是否持有"排除清单"里的线索概率天赋
    function hasExcludedClue(scoreObj) {
        if (!scoreObj || !scoreObj.mergedTraits) return false;
        for (const t of scoreObj.mergedTraits) {
            if (t.舱室 !== '会客室') continue;
            if (t.类型 !== '线索概率提升' && t.类型 !== '线索概率小幅提升') continue;
            const num = parseInt(t.线索编号, 10);
            if (excludedClues.has(num)) return true;
        }
        return false;
    }

    function hasValidMeetingTalent(scoreObj) {
        if (!scoreObj || !scoreObj.mergedTraits) return false;
        for (const t of scoreObj.mergedTraits) {
            if (t.舱室 !== '会客室') continue;
            if (t.类型 === '收集线索效率') return true;
            if (t.类型 === '心情消耗减少') return true;
            if (t.类型 === '线索概率提升' || t.类型 === '线索概率小幅提升') {
                const num = parseInt(t.线索编号, 10);
                if (missingClues.has(num)) return true;
                // ★ 排除清单只影响二轮替换候选，不影响二轮补位
                //   只要不是“只有排除清单线索、无其它会客室天赋”，就允许进入二轮
                if (!excludedClues.has(num)) return true;
            }
        }
        return false;
    }

    // ★ 会客室二轮替换（区分负面槽位 / 中性槽位）
    //   负面槽位：有线索概率天赋，但全部编号都在排除清单里 → 必须替换
    //   中性槽位：无线索概率、无搜集效率，只有减耗等 → 保持不动
    //   候选：
    //     useful 候选（有搜集效率 或 非排除清单的线索概率）可替换两种槽位
    //     placeholder 候选（无会客室天赋）只替换负面槽位
    function replaceMeetingSecondRoundWithCluePowers(round1Map, round2Map, reservePool, doubleRooms, roomTiming, mode, cultureTypes) {
        if (!doubleRooms.includes('meeting')) return;

        const R1 = round1Map.meeting || [];
        const R2 = round2Map.meeting || [];
        if (R2.length === 0) return;

        // ---- 分类槽位 ----
        const badIndices = [];      // 负面槽位：有线索概率，但全部在排除清单里
        const neutralIndices = [];  // 中性槽位：无线索概率、无搜集效率

        for (let i = 0; i < R2.length; i++) {
            const op = R2[i];
            if (!op) continue;
            const info = analyzeMeetingTraits(op);
            if (info.clueEff > 0) continue;  // 有搜集效率 → 有效，保留
            const usefulPowerNums = info.cluePowerNums.filter(n =>
                missingClues.has(n) || !excludedClues.has(n)
            );
            if (usefulPowerNums.length > 0) continue;  // 有有效线索概率 → 有效，保留

            if (info.cluePowerNums.length > 0) {
                badIndices.push(i);       // 有线索概率但全被排除 → 负面
            } else {
                neutralIndices.push(i);   // 无线索概率 → 中性
            }
        }

        if (badIndices.length === 0 && neutralIndices.length === 0) return;

        const usedIds = new Set();
        for (const op of R1) if (op) usedIds.add(op.opId);
        for (const op of R2) if (op) usedIds.add(op.opId);

        // ---- useful 候选：有搜集效率 或 非排除清单的线索概率 ----
        const usefulCandidates = [];

        // 储备池
        for (const s of reservePool) {
            if (usedIds.has(s.opId)) continue;
            const info = analyzeMeetingTraits(s);
            const usefulPowerNums = info.cluePowerNums.filter(n =>
                missingClues.has(n) || !excludedClues.has(n)
            );
            if (info.clueEff === 0 && usefulPowerNums.length === 0) continue;

            const hits = info.cluePowerNums.filter(n => missingClues.has(n)).length;
            const score = hits * 1000
                + info.clueEff * 10
                + usefulPowerNums.length * 100
                + info.cluePower * 10
                + 5;
            usefulCandidates.push({ op: s, score, from: null });
        }

        // 2) 其它舱室的"零贡献"干员（有有效会客室天赋）
        for (const rk of ['central', 'manufactA', 'manufactB', 'culture']) {
            const timing = roomTiming[rk] || { hA: 24, hB: 0 };
            for (const rnd of ['round1', 'round2']) {
                const map = (rnd === 'round1' ? round1Map : round2Map);
                const arr = map[rk] || [];
                const effH = (rnd === 'round1') ? timing.hA : timing.hB;
                for (let i = 0; i < arr.length; i++) {
                    const op = arr[i];
                    if (!op) continue;
                    if (usedIds.has(op.opId)) continue;
                    // ★ 信赖干员锁定：任何舱室中的信赖干员都不参与会客室替换
                    if (trustedAgentIds.includes(op.opId)) continue;

                    const info = analyzeMeetingTraits(op);
                    const usefulPowerNums = info.cluePowerNums.filter(n =>
                        missingClues.has(n) || !excludedClues.has(n)
                    );
                    if (info.clueEff === 0 && usefulPowerNums.length === 0) continue;

                    const contrib = calcRoomContributionActual(op, rk, effH);
                    if (contrib > 0.01) continue;

                    const hits = info.cluePowerNums.filter(n => missingClues.has(n)).length;
                    const score = hits * 1000
                        + info.clueEff * 10
                        + usefulPowerNums.length * 100
                        + info.cluePower * 10;
                    usefulCandidates.push({ op, score, from: { roomKey: rk, round: rnd, idx: i } });
                }
            }
        }
        usefulCandidates.sort((a, b) => b.score - a.score);

        // ---- placeholder 候选：无会客室天赋（无线索概率、无搜集效率） ----
        const placeholderCandidates = [];
        for (const s of reservePool) {
            if (usedIds.has(s.opId)) continue;
            const info = analyzeMeetingTraits(s);
            const usefulPowerNums = info.cluePowerNums.filter(n =>
                missingClues.has(n) || !excludedClues.has(n)
            );
            if (info.clueEff === 0 && usefulPowerNums.length === 0 && info.cluePowerNums.length === 0) {
                placeholderCandidates.push({ op: s });
            }
        }

        // ---- 执行替换 ----
        const usedCandIds = new Set();
        function doReplace(idx, cand) {
            const displaced = R2[idx];
            R2[idx] = cand.op;
            if (cand.from) {
                const srcMap = (cand.from.round === 'round1' ? round1Map : round2Map);
                const srcArr = srcMap[cand.from.roomKey];
                if (srcArr && srcArr[cand.from.idx] === cand.op) {
                    srcArr[cand.from.idx] = displaced;
                }
                usedIds.delete(cand.op.opId);
                if (displaced) usedIds.add(displaced.opId);
            } else {
                usedIds.add(cand.op.opId);
                if (displaced) reservePool.push(displaced);  // 退回储备池
            }
            usedCandIds.add(cand.op.opId);
        }

        // 阶段 1：用 useful 候选替换负面槽位（最高优先）
        for (const idx of badIndices) {
            let cand = null;
            for (const c of usefulCandidates) {
                if (usedCandIds.has(c.op.opId)) continue;
                cand = c; break;
            }
            if (!cand) break;
            doReplace(idx, cand);
        }

        // 阶段 2：用 useful 候选替换中性槽位
        for (const idx of neutralIndices) {
            let cand = null;
            for (const c of usefulCandidates) {
                if (usedCandIds.has(c.op.opId)) continue;
                cand = c; break;
            }
            if (!cand) break;
            doReplace(idx, cand);
        }

        // 阶段 3：useful 不够时，用 placeholder 兜底替换“仍未被替换的负面槽位”
        //         ★ 绝不用于替换中性槽位（如秋栗）
        for (const idx of badIndices) {
            const op = R2[idx];
            if (!op) continue;
            const info = analyzeMeetingTraits(op);
            if (info.clueEff > 0) continue;
            const usefulPowerNums = info.cluePowerNums.filter(n =>
                missingClues.has(n) || !excludedClues.has(n)
            );
            if (usefulPowerNums.length > 0) continue;
            if (info.cluePowerNums.length === 0) continue;  // 已不是负面槽位

            let cand = null;
            for (const c of placeholderCandidates) {
                if (usedCandIds.has(c.op.opId)) continue;
                cand = c; break;
            }
            if (!cand) break;
            doReplace(idx, cand);
        }
    }
    
    // ★ 制造舱二轮时长重评估：
    //   扫描二轮每个槽位，若干员按时长评估的贡献 ≈ 0（只减耗），
    //   用储备池里有实际效率的干员替换
    function refineManufactSecondRoundByActualTime(round1Map, round2Map, reservePool, doubleRooms, mode, cultureTypes, roomTiming) {
        for (const rk of ['manufactA', 'manufactB']) {
            if (!doubleRooms.includes(rk)) continue;
            const timing = roomTiming[rk];
            if (!timing || timing.hB <= 0) continue;
            const effH = timing.hB;
            const R2 = round2Map[rk] || [];
            if (R2.length === 0) continue;

            // 找弱槽位（按时长评估贡献 ≈ 0）
            const weakIndices = [];
            for (let i = 0; i < R2.length; i++) {
                const op = R2[i];
                if (!op) continue;
                const contrib = calcRoomContributionActual(op, rk, effH);
                if (contrib <= 0.01) weakIndices.push(i);
            }
            if (weakIndices.length === 0) continue;

            // 已使用集合
            const usedIds = new Set();
            for (const key of Object.keys(round1Map)) for (const s of (round1Map[key] || [])) if (s) usedIds.add(s.opId);
            for (const key of Object.keys(round2Map)) for (const s of (round2Map[key] || [])) if (s) usedIds.add(s.opId);

            // 从储备池找替换候选（按时长评估有实际效率）
            const candidates = [];
            for (const s of reservePool) {
                if (usedIds.has(s.opId)) continue;
                // ★ 信赖干员锁定
                if (trustedAgentIds.includes(s.opId)) continue;
                const contrib = calcRoomContributionActual(s, rk, effH);
                if (contrib > 0.01) candidates.push({ op: s, contrib });
            }
            candidates.sort((a, b) => b.contrib - a.contrib);

            // 逐个替换（新贡献必须 > 旧贡献）
            const n = Math.min(weakIndices.length, candidates.length);
            for (let k = 0; k < n; k++) {
                const idx = weakIndices[k];
                const displaced = R2[idx];
                const oldContrib = displaced ? calcRoomContributionActual(displaced, rk, effH) : 0;
                const newContrib = candidates[k].contrib;
                if (newContrib > oldContrib + 0.01) {
                    R2[idx] = candidates[k].op;
                    usedIds.add(candidates[k].op.opId);
                }
            }
        }
    }
    // ---------- 排班主流程 ----------
    function buildSchedule(scores) {
        const mode = getManufactMode();
        const doubleRooms = doubleRoundRooms;
        const centralDisabled = (centralMode === 'empty');
        const isTrustMode = (centralMode === 'trust');
        const result = {
            central: { recommend: [], reserve: [], round1: [], round2: [] },
            meeting: { recommend: [], reserve: [], round1: [], round2: [] },
            culture: { recommend: [], reserve: [], round1: [], round2: [] },
            manufactA: { recommend: [], reserve: [], round1: [], round2: [] },
            manufactB: { recommend: [], reserve: [], round1: [], round2: [] }
        };
        const availableScores = scores.filter(s => {
            const op = operators.find(o => o.id === s.opId);
            return op && op.eliteLevel !== 'none';
        });
        if (availableScores.length === 0) return result;

        const roomDefs = [
            { key: 'central', field: 'central', disabled: centralDisabled },
            { key: 'meeting', field: 'meeting', disabled: false },
            { key: 'culture', field: 'culture', disabled: false },
            { key: 'manufactA', field: 'expScore', disabled: false },
            { key: 'manufactB', field: 'weaponScore', disabled: false }
        ];
        const trustIdSet = new Set(trustedAgentIds);
        let remainingPool = availableScores.filter(s => !trustIdSet.has(s.opId));
        const assignedSet = new Set(trustIdSet);
        const round1Map = { central: [], meeting: [], culture: [], manufactA: [], manufactB: [] };
        const round2Map = { central: [], meeting: [], culture: [], manufactA: [], manufactB: [] };

        // ---- 总控信赖模式：优先填入总控 ----
        if (!centralDisabled) {
            if (isTrustMode && trustIdSet.size > 0) {
                const trustRound1Ids = [], trustRound2Ids = [];
                for (const id of trustedAgentIds) {
                    (trustAssignMap[id] || 'round1') === 'round1' ? trustRound1Ids.push(id) : trustRound2Ids.push(id);
                }
                const getTrustScores = idList => idList.map(id => availableScores.find(s => s.opId === id)).filter(Boolean);
                round1Map.central = getTrustScores(trustRound1Ids).slice(0, 3);
                const need1 = 3 - round1Map.central.length;
                if (need1 > 0) {
                    const fill = remainingPool.filter(s => !assignedSet.has(s.opId))
                        .sort((a, b) => (b.score.central || 0) - (a.score.central || 0)).slice(0, need1);
                    for (const s of fill) {
                        round1Map.central.push(s); assignedSet.add(s.opId);
                        const idx = remainingPool.indexOf(s); if (idx !== -1) remainingPool.splice(idx, 1);
                    }
                }
                window._trustRound2Cache = getTrustScores(trustRound2Ids).slice(0, 3);
            } else { window._trustRound2Cache = []; }
        } else { window._trustRound2Cache = []; }

        // ---- 一轮：静态评分贪心 ----
        const roomPriority = { 'meeting': 0, 'culture': 1, 'manufactA': 2, 'manufactB': 3, 'central': 4 };
        const round1Rooms = ['meeting', 'culture', 'manufactA', 'manufactB'];
        if (!centralDisabled && !(isTrustMode && trustIdSet.size > 0)) round1Rooms.push('central');

        const round1Pairs = [];
        for (const s of remainingPool) {
            if (assignedSet.has(s.opId)) continue;
            for (const key of round1Rooms) {
                let field = roomDefs.find(d => d.key === key).field;
                if (key === 'manufactA') field = (mode === 'weapon') ? 'weaponScore' : 'expScore';
                else if (key === 'manufactB') field = (mode === 'exp') ? 'expScore' : 'weaponScore';

                const score = s.score[field] || 0;
                if (score > 0) {
                    round1Pairs.push({ scoreObj: s, roomKey: key, score: score, priority: roomPriority[key] });
                }
            }
        }
        round1Pairs.sort((a, b) => b.score !== a.score ? b.score - a.score : a.priority - b.priority);

        const roomCount1 = { central: 0, meeting: 0, culture: 0, manufactA: 0, manufactB: 0 };
        if (isTrustMode && trustIdSet.size > 0) roomCount1.central = round1Map.central.length;

        for (const pair of round1Pairs) {
            if (assignedSet.has(pair.scoreObj.opId)) continue;
            if (roomCount1[pair.roomKey] >= 3) continue;
            round1Map[pair.roomKey].push(pair.scoreObj);
            assignedSet.add(pair.scoreObj.opId);
            roomCount1[pair.roomKey]++;
            const idx = remainingPool.indexOf(pair.scoreObj);
            if (idx !== -1) remainingPool.splice(idx, 1);
        }

        // ---- 一轮平铺补位 ----
        const round1FillRooms = ['meeting', 'culture', 'manufactA', 'manufactB'];
        let r1FillActive = true;
        while (r1FillActive) {
            r1FillActive = false;

            if (meetingPriorityEnabled && round1Map.meeting.length < 3) {
                // 仅补充有“收集线索效率”的干员，避免线索概率干员挤占高效组
                const cand = remainingPool.filter(s => {
                    if (assignedSet.has(s.opId)) return false;
                    if (trustIdSet.has(s.opId)) return false;
                    return s.mergedTraits && s.mergedTraits.some(t =>
                        t.舱室 === '会客室' && t.类型 === '收集线索效率'
                    );
                });
                if (cand.length > 0) {
                    cand.sort((a, b) => (b.score.meeting || 0) - (a.score.meeting || 0));
                    const picked = cand[0];
                    round1Map.meeting.push(picked);
                    assignedSet.add(picked.opId);
                    const idx = remainingPool.indexOf(picked);
                    if (idx !== -1) remainingPool.splice(idx, 1);
                    r1FillActive = true;
                    continue;
                }
            }

            for (const key of round1FillRooms) {
                if (round1Map[key].length >= 3) continue;
                const cand = remainingPool.filter(s => !assignedSet.has(s.opId) && !trustIdSet.has(s.opId));
                if (cand.length === 0) break;

                let field = roomDefs.find(d => d.key === key).field;
                if (key === 'manufactA') field = (mode === 'weapon') ? 'weaponScore' : 'expScore';
                else if (key === 'manufactB') field = (mode === 'exp') ? 'expScore' : 'weaponScore';

                cand.sort((a, b) => (b.score[field] || 0) - (a.score[field] || 0));
                const picked = cand[0];

                round1Map[key].push(picked);
                assignedSet.add(picked.opId);
                const idx = remainingPool.indexOf(picked);
                if (idx !== -1) remainingPool.splice(idx, 1);
                r1FillActive = true;
            }
        }

        // ---- 二轮启用舱室 ----
        let doubleKeys = ['meeting', 'culture', 'manufactA', 'manufactB', 'central'].filter(k => doubleRooms.includes(k) && !(k === 'central' && centralDisabled));

        if (isTrustMode && trustIdSet.size > 0 && doubleKeys.includes('central')) {
            round2Map.central = (window._trustRound2Cache || []).slice(0, 3);
            const asg = new Set(round2Map.central.map(s => s.opId));
            const need2 = 3 - round2Map.central.length;
            if (need2 > 0) {
                const fill = remainingPool.filter(s => !assignedSet.has(s.opId) && !asg.has(s.opId))
                    .sort((a, b) => (b.score.central || 0) - (a.score.central || 0)).slice(0, need2);
                for (const s of fill) {
                    round2Map.central.push(s); asg.add(s.opId);
                    const idx = remainingPool.indexOf(s); if (idx !== -1) remainingPool.splice(idx, 1);
                }
            }
            window._centralRound2Assigned = asg;
            doubleKeys = doubleKeys.filter(k => k !== 'central');
        } else { window._centralRound2Assigned = new Set(); }

        // ---- 二轮：静态评分贪心 ----
        const round2Pairs = [];
        for (const s of remainingPool) {
            if (assignedSet.has(s.opId)) continue;
            if (window._centralRound2Assigned && window._centralRound2Assigned.has(s.opId)) continue;
            if (trustIdSet.has(s.opId)) continue;

            for (const key of doubleKeys) {
                // ★ 会客室：只有排除清单线索、无其它会客室天赋的干员 → 跳过
                if (key === 'meeting' && !hasValidMeetingTalent(s)) continue;
                let field = roomDefs.find(d => d.key === key).field;
                if (key === 'manufactA') field = (mode === 'weapon') ? 'weaponScore' : 'expScore';
                else if (key === 'manufactB') field = (mode === 'exp') ? 'expScore' : 'weaponScore';

                const score = s.score[field] || 0;
                if (score > 0) {
                    round2Pairs.push({ scoreObj: s, roomKey: key, score: score, priority: roomPriority[key] });
                }
            }
        }
        round2Pairs.sort((a, b) => b.score !== a.score ? b.score - a.score : a.priority - b.priority);

        const assignedSecond = new Set(window._centralRound2Assigned);
        const roomCount2 = { central: 0, meeting: 0, culture: 0, manufactA: 0, manufactB: 0 };
        for (const s of round2Map.central) { assignedSecond.add(s.opId); roomCount2.central++; }

        for (const pair of round2Pairs) {
            if (assignedSecond.has(pair.scoreObj.opId)) continue;
            if (roomCount2[pair.roomKey] >= 3) continue;
            round2Map[pair.roomKey].push(pair.scoreObj);
            assignedSecond.add(pair.scoreObj.opId);
            roomCount2[pair.roomKey]++;
            const idx = remainingPool.indexOf(pair.scoreObj);
            if (idx !== -1) remainingPool.splice(idx, 1);
        }

        // ---- 二轮平铺补位 ----
        const round2FillRooms = doubleKeys.filter(k => k !== 'central');
        let r2FillActive = true;
        while (r2FillActive) {
            r2FillActive = false;

            if (meetingPriorityEnabled && round2FillRooms.includes('meeting') && round2Map.meeting.length < 3) {
                const cand = remainingPool.filter(s => !assignedSecond.has(s.opId) && !trustIdSet.has(s.opId));
                if (cand.length > 0) {
                    cand.sort((a, b) => (b.score.meeting || 0) - (a.score.meeting || 0));
                    const picked = cand[0];
                    round2Map.meeting.push(picked);
                    assignedSecond.add(picked.opId);
                    const idx = remainingPool.indexOf(picked);
                    if (idx !== -1) remainingPool.splice(idx, 1);
                    r2FillActive = true;
                    continue;
                }
            }

            for (const key of round2FillRooms) {
                if (round2Map[key].length >= 3) continue;

                // 1. 严格筛选：符合有效会客室天赋
                let cand = remainingPool.filter(s => {
                    if (assignedSecond.has(s.opId)) return false;
                    if (trustIdSet.has(s.opId)) return false;
                    // ★ 会客室：只有排除清单线索、无其它会客室天赋的干员 → 跳过
                    if (key === 'meeting' && !hasValidMeetingTalent(s)) return false;
                    return true;
                });

                // 2. 会客室后备：严格筛选无人时，放宽为“只要在会客室有天赋”
                //    例如：只有心情消耗减少、或只持有被排除线索的干员
                if (key === 'meeting' && cand.length === 0) {
                    cand = remainingPool.filter(s => {
                        if (assignedSecond.has(s.opId)) return false;
                        if (trustIdSet.has(s.opId)) return false;
                        return s.mergedTraits && s.mergedTraits.some(t => t.舱室 === '会客室');
                    });
                }

                // 3. 仍然无人 → 跳过当前舱室，继续尝试其它舱室（避免 break 连锁空位）
                if (cand.length === 0) continue;

                let field = roomDefs.find(d => d.key === key).field;
                if (key === 'manufactA') field = (mode === 'weapon') ? 'weaponScore' : 'expScore';
                else if (key === 'manufactB') field = (mode === 'exp') ? 'expScore' : 'weaponScore';

                cand.sort((a, b) => (b.score[field] || 0) - (a.score[field] || 0));
                const picked = cand[0];

                round2Map[key].push(picked);
                assignedSecond.add(picked.opId);
                const idx = remainingPool.indexOf(picked);
                if (idx !== -1) remainingPool.splice(idx, 1);
                r2FillActive = true;
            }
        }

        // ---- 储备池 ----
        const finalUsedIds = new Set();
        for (const key of Object.keys(round1Map)) for (const s of (round1Map[key] || [])) finalUsedIds.add(s.opId);
        for (const key of Object.keys(round2Map)) for (const s of (round2Map[key] || [])) finalUsedIds.add(s.opId);
        const reservePool = availableScores.filter(s => !finalUsedIds.has(s.opId) && !trustIdSet.has(s.opId));
        const reserveMap = { central: [], meeting: [], culture: [], manufactA: [], manufactB: [] };
        for (const def of roomDefs) {
            if (def.disabled) continue;
            let cand = reservePool.filter(s => (s.score[def.field] || 0) > 0);
            cand.sort((a, b) => (b.score[def.field] || 0) - (a.score[def.field] || 0));
            if (def.key === 'meeting') {
                cand = cand.filter(s => {
                    let hasOther = false;
                    for (const t of s.mergedTraits) {
                        if (t.舱室 === '会客室' && (t.类型 === '收集线索效率' || t.类型 === '心情消耗减少')) { hasOther = true; break; }
                    }
                    if (!hasOther && s.mergedTraits.some(t => t.舱室 === '会客室' && isCluePower(t.类型))) return false;
                    return true;
                });
            }
            reserveMap[def.key] = cand.slice(0, 5);
        }

        // ---- ★ 减耗优化：仅对二轮舱室做轮次间交换 ----
        optimizeReductionPlacement(round1Map, round2Map, doubleRooms, mode, getCultureTypes());

        // ---- ★ 计算各二轮舱的稳态 hA/hB（用于按时长评估贡献） ----
        const roomTiming = {};
        {
            const cRestHigh = getCRestHigh();
            for (const rk of ['central', 'manufactA', 'manufactB', 'culture', 'meeting']) {
                if (!doubleRooms.includes(rk)) continue;
                const A = round1Map[rk] || [];
                const B = round2Map[rk] || [];
                if (A.length === 0 || B.length === 0) {
                    roomTiming[rk] = { hA: 24, hB: 0 };
                    continue;
                }
                const pA = groupEffectiveEffReduce(A, rk, mode, getCultureTypes());
                const pB = groupEffectiveEffReduce(B, rk, mode, getCultureTypes());
                const cA = 7.2 * Math.max(0.1, 1 - pA.reduce / 100);
                const cB = 7.2 * Math.max(0.1, 1 - pB.reduce / 100);
                const hA_max = Math.min(100 / cA, 24 * cRestHigh / (cA + cRestHigh));
                const hA_opt = Math.max(1, Math.min(23, Math.floor(hA_max)));
                roomTiming[rk] = { hA: hA_opt, hB: 24 - hA_opt };
            }
        }

        // ---- ★ 制造舱二轮时长重评估：剔除"减耗无价值"的干员 ----
        {
            const usedIds2 = new Set();
            for (const key of Object.keys(round1Map)) for (const s of (round1Map[key] || [])) usedIds2.add(s.opId);
            for (const key of Object.keys(round2Map)) for (const s of (round2Map[key] || [])) usedIds2.add(s.opId);
            const reservePool2 = availableScores.filter(s =>
                !usedIds2.has(s.opId) && !trustIdSet.has(s.opId)
            );
            refineManufactSecondRoundByActualTime(
                round1Map, round2Map, reservePool2, doubleRooms,
                mode, getCultureTypes(), roomTiming
            );
        }

        // ---- ★ 会客室二轮替换：从储备池/其它舱室拉线索概率干员替换弱槽位 ----
        {
            const usedIds2 = new Set();
            for (const key of Object.keys(round1Map)) {
                for (const s of (round1Map[key] || [])) usedIds2.add(s.opId);
            }
            for (const key of Object.keys(round2Map)) {
                for (const s of (round2Map[key] || [])) usedIds2.add(s.opId);
            }
            const reservePool2 = availableScores.filter(s =>
                !usedIds2.has(s.opId) && !trustIdSet.has(s.opId)
            );
            replaceMeetingSecondRoundWithCluePowers(
                round1Map, round2Map, reservePool2, doubleRooms,
                roomTiming, mode, getCultureTypes()
            );
        }

        // ---- 组装结果 ----
        for (const def of roomDefs) {
            if (def.disabled) continue;
            const key = def.key;
            const isDouble = doubleRooms.includes(key);
            result[key].recommend = round1Map[key] || [];
            if (isDouble) {
                result[key].round1 = round1Map[key] || [];
                result[key].round2 = round2Map[key] || [];
            }
            result[key].reserve = reserveMap[key] || [];
        }
        if (centralDisabled) {
            result.central.recommend = []; result.central.reserve = [];
            result.central.round1 = []; result.central.round2 = [];
        }
        const timingInfo = recordTimingInfo(round1Map, round2Map, doubleRooms, mode, getCultureTypes());
        result._timingInfo = timingInfo;
        delete window._trustRound2Cache;
        delete window._centralRound2Assigned;
        return result;
    }

    function getTraitDescriptionForRoom(mergedTraits, roomName, manufactType, cultureActiveTypes, isFill = false) {
        if (!mergedTraits || mergedTraits.length === 0) return isFill ? '补充队列使用' : '无天赋';
        let relevant = mergedTraits.filter(t => t.舱室 === roomName);
        if (relevant.length === 0) return isFill ? '补充队列使用' : '无天赋';
        if (roomName === '制造舱' && manufactType) {
            relevant = relevant.filter(t => {
                if (t.类型 === '干员素材效率' && manufactType === 'exp') return true;
                if (t.类型 === '武器素材效率' && manufactType === 'weapon') return true;
                if (t.类型 === '心情消耗减少') return true;
                return false;
            });
            if (relevant.length === 0) return isFill ? '补充队列使用' : '无天赋';
        }
        if (roomName === '培养舱' && cultureActiveTypes && cultureActiveTypes.length > 0) {
            relevant = relevant.filter(t => {
                if (t.类型 === '心情消耗减少') return true;
                if (t.类型 === '矿物效率' && cultureActiveTypes.includes('mineral')) return true;
                if (t.类型 === '菌类效率' && cultureActiveTypes.includes('fungi')) return true;
                if (t.类型 === '晶植效率' && cultureActiveTypes.includes('plant')) return true;
                return false;
            });
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

    // ★ 读取某舱某轮的推荐时段文本
    //   来自 schedule-timing.js 计算后写入的 window.__DIJIANG_ROOM_TIMING__
    function getRoomTimingText(roomKey, roundKey) {
        const map = window.__DIJIANG_ROOM_TIMING__;
        if (!map || !map[roomKey]) return '';
        const slot = map[roomKey][roundKey];
        return slot || '';
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
                if (rawRoom === '制造舱' && manufactType) {
                    relevant = relevant.filter(t => {
                        if (t.类型 === '干员素材效率' && manufactType === 'exp') return true;
                        if (t.类型 === '武器素材效率' && manufactType === 'weapon') return true;
                        if (t.类型 === '心情消耗减少') return true;
                        return false;
                    });
                }
                if (rawRoom === '培养舱' && cultureChecks) {
                    relevant = relevant.filter(t => {
                        if (t.类型 === '心情消耗减少') return true;
                        if (t.类型 === '矿物效率' && cultureChecks.includes('mineral')) return true;
                        if (t.类型 === '菌类效率' && cultureChecks.includes('fungi')) return true;
                        if (t.类型 === '晶植效率' && cultureChecks.includes('plant')) return true;
                        return false;
                    });
                }
                if (rawRoom === '会客室') {
                    relevant = relevant.filter(t => {
                        if (t.类型 === '收集线索效率') return true;
                        if (t.类型 === '心情消耗减少') return true;
                        if (isCluePower(t.类型)) {
                            if (meetingPriorityEnabled && missingClues.size === 0) return false;
                            return true;
                        }
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
            const data = queues[room];
            if (!data) continue;
            let productTag = '', manufactType = null;
            if (room === 'manufactA') {
                if (mode === 'dual' || mode === 'exp') { productTag = '⚙️ 干员'; manufactType = 'exp'; }
                else { productTag = '⚙️ 武器'; manufactType = 'weapon'; }
            } else if (room === 'manufactB') {
                if (mode === 'dual' || mode === 'weapon') { productTag = '⚙️ 武器'; manufactType = 'weapon'; }
                else { productTag = '⚙️ 干员'; manufactType = 'exp'; }
            } else if (room === 'culture') { productTag = `🌱 ${cultureText}`; }
            else if (room === 'meeting' && meetingPriorityEnabled) { productTag = `📄 优先线索`; }

            const isDouble = doubleRooms.includes(room);
            let recommendHTML = '';
            if (isDouble) {
                let items1 = '', items2 = '';
                for (let i = 0; i < 3; i++) {
                    items1 += buildRecommendItem((data.round1 || [])[i] || null, roomRaw[room], manufactType, cultureChecks);
                    items2 += buildRecommendItem((data.round2 || [])[i] || null, roomRaw[room], manufactType, cultureChecks);
                }
                // ★ 读取计算出的时段
                const t1 = getRoomTimingText(room, 'round1');
                const t2 = getRoomTimingText(room, 'round2');
                const badge1 = t1 ? `<span class="round-timing-badge">${escapeHtml(t1)}</span>` : '';
                const badge2 = t2 ? `<span class="round-timing-badge">${escapeHtml(t2)}</span>` : '';
                recommendHTML = `
                    <div style="margin-bottom:8px;"><div class="round-label">轮次一${badge1}</div><div class="recommend-area">${items1}</div></div>
                    <div><div class="round-label">轮次二${badge2}</div><div class="recommend-area">${items2}</div></div>
                `;
            } else {
                const recList = data.recommend || [];
                let items = '';
                for (let i = 0; i < 3; i++) items += buildRecommendItem(recList[i] || null, roomRaw[room], manufactType, cultureChecks);

                // ★ 单轮舱：若有时段缓存，显示在“轮次一”标签旁（非二轮的总控也会走这里）
                const t1 = getRoomTimingText(room, 'round1');
                const badge1 = t1 ? `<span class="round-timing-badge">${escapeHtml(t1)}</span>` : '';

                recommendHTML = `
                    <div style="margin-bottom:8px;">
                        <div class="round-label">轮次一${badge1}</div>
                        <div class="recommend-area">${items}</div>
                    </div>
                `;

                const reserveList = data.reserve || [];
                let reserveHTML = '';
                if (reserveList.length === 0) { reserveHTML = '<div style="font-size:0.7rem; color:#999; padding:4px 0;">无储备</div>'; }
                else {
                    reserveHTML = reserveList.map(m => {
                        const imgSrc = getAgentImgSrc(m);
                        const desc = getTraitDescriptionForRoom(m.mergedTraits, roomRaw[room], manufactType, cultureChecks, false);
                        return `<div class="reserve-item">
                            <img class="mini-avatar" src="${imgSrc}" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'28\' height=\'28\'%3E%3Crect width=\'28\' height=\'28\' fill=\'%23eaeaea\'/%3E%3C/svg%3E';">
                            <span class="reserve-trait">${escapeHtml(m.name)}: ${escapeHtml(desc)}</span>
                        </div>`;
                    }).join('');
                }
                recommendHTML += `<div class="reserve-area">${reserveHTML}</div>`;
            }
            roomHTML[room] = `
                <div class="room-box" data-room="${room}">
                    <div class="room-box-header"><span>${DISPLAY_NAMES[room]}</span>${productTag ? `<span class="product-tag">${productTag}</span>` : ''}</div>
                    ${recommendHTML}
                </div>
            `;
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

    function generateSchedule() {
        // ★ 生产策略变化 → 清空已缓存的时间段
        window.__DIJIANG_ROOM_TIMING__ = {};
        updateClueAvailability();
        const scores = computeScoresForAll();
        let queues;
        if (scores.length === 0) {
            queues = {
                central: { recommend: [], reserve: [], round1: [], round2: [] }, manufactA: { recommend: [], reserve: [], round1: [], round2: [] },
                manufactB: { recommend: [], reserve: [], round1: [], round2: [] }, culture: { recommend: [], reserve: [], round1: [], round2: [] },
                meeting: { recommend: [], reserve: [], round1: [], round2: [] }
            };
        } else { queues = buildSchedule(scores); }
        renderSchedule(queues);
        window._lastQueues = queues;
        window._doubleRooms = doubleRoundRooms;
        window._centralMode = centralMode;
        try {
            sessionStorage.setItem('DijiangLastQueues', JSON.stringify(queues));
            sessionStorage.setItem('DijiangDoubleRooms', JSON.stringify(doubleRoundRooms));
        } catch (e) {}
        window._manufactMode = getManufactMode();
        window._cultureTypes = getCultureTypes();
        window._meetingPriorityEnabled = meetingPriorityEnabled;
    }

    // ---------- 排班说明 & 版本号 ----------
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
            try {
                const res = await fetch('/log/log.md', { cache: 'no-cache' });
                const text = await res.text();
                const firstLine = (text.split(/\r?\n/)[0] || '').trim();
                const m = firstLine.match(/^#\s*(.+?)\s*$/);
                _changelogVersionCache = m ? m[1] : '';
            } catch (e2) {
                _changelogVersionCache = '';
            }
        }
        return _changelogVersionCache;
    }
    
    // ★ 导出图用：把时段数组格式化为 "08:00-22:00 / 22:00-08:00（次日）" 等
    function formatExportHourRange(rows) {
        if (!rows || rows.length === 0) return '';
        const fmt = (h) => {
            if (h >= 24) return '24:00';
            h = ((h % 24) + 24) % 24;
            return String(h).padStart(2, '0') + ':00';
        };
        // rows 已由 schedule-timing.js 拆好，小在前，直接拼
        return rows.map(r => `${fmt(r.start)}-${fmt(r.end)}`).join(' / ');
    }

    // ★ 导出图用：读取某舱某轮次的推荐时段（未计算时返回空串）
    function getExportRoomTiming(roomKey, roundKey) {
        if (!window.DijiangTiming || typeof window.DijiangTiming.getRoomPeriods !== 'function') return '';

        // ★ 总控中枢：不论 doubleRooms 是否包含 central，都显示时段
        if (roomKey === 'central') {
            const p = window.DijiangTiming.getRoomPeriods('central');
            if (!p) return '';
            const rows = roundKey === 'round1' ? p.round1 : p.round2;
            return formatExportHourRange(rows);
        }

        // 其它舱室：单轮舱室二轮列不显示
        const isDouble = (window._doubleRooms || []).includes(roomKey);
        if (!isDouble && roundKey === 'round2') return '';

        const p = window.DijiangTiming.getRoomPeriods(roomKey);
        if (!p) return '';
        const rows = roundKey === 'round1' ? p.round1 : p.round2;
        return formatExportHourRange(rows);
    }
    // ---------- 导出排班图 ----------
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

    // ---------- 天赋一览 ----------
    const talentModal = document.getElementById('talentModal');
    const talentCloseBtn = document.getElementById('talentCloseBtn');
    const showTalentBtn = document.getElementById('showTalentBtn');
    const talentTabs = document.getElementById('talentTabs');
    const talentContent = document.getElementById('talentContent');
    const talentStarFilter = document.getElementById('talentStarFilter');
    const talentAttrFilter = document.getElementById('talentAttrFilter');
    const talentFullExtraFilter = document.getElementById('talentFullExtraFilter');
    const talentRoomRadios = document.querySelectorAll('input[name="talentRoomRadio"]');
    let currentTalentView = 'room';

    function openTalentModal() { talentModal.classList.add('open'); renderTalentView(currentTalentView); }
    function closeTalentModal() { talentModal.classList.remove('open'); }
    function getFilteredOperatorsForTalent() {
        const star = talentStarFilter.value, attr = talentAttrFilter.value;
        return operators.filter(op => {
            if (star !== 'all' && op.star !== star) return false;
            if (attr !== 'all' && op.attribute !== attr) return false;
            return true;
        });
    }
    function renderTalentView(view) {
        const filterArea = document.getElementById('talentFilterArea');
        if (view === 'room') { renderRoomView(); filterArea.style.display = 'none'; }
        else { renderFullView(); filterArea.style.display = 'flex'; }
        talentFullExtraFilter.style.display = (view === 'full') ? 'flex' : 'none';
    }
    function renderRoomView() {
        const scores = computeScoresForAll();
        const roomConfig = {
            '总控中枢': [{ id:'mood', label:'心情恢复提升', filter:t=>t.舱室==='总控中枢'&&t.类型==='心情恢复提升' }],
            '制造舱': [
                { id:'exp', label:'干员经验效率提升', filter:t=>t.舱室==='制造舱'&&t.类型==='干员素材效率' },
                { id:'weapon', label:'武器经验效率提升', filter:t=>t.舱室==='制造舱'&&t.类型==='武器素材效率' },
                { id:'mood', label:'心情消耗减少', filter:t=>t.舱室==='制造舱'&&t.类型==='心情消耗减少' }
            ],
            '培养舱': [
                { id:'mineral', label:'矿物效率提升', filter:t=>t.舱室==='培养舱'&&t.类型==='矿物效率' },
                { id:'fungi', label:'菌类效率提升', filter:t=>t.舱室==='培养舱'&&t.类型==='菌类效率' },
                { id:'plant', label:'晶植效率提升', filter:t=>t.舱室==='培养舱'&&t.类型==='晶植效率' },
                { id:'mood', label:'心情消耗减少', filter:t=>t.舱室==='培养舱'&&t.类型==='心情消耗减少' }
            ],
            '会客室': [
                { id:'efficiency', label:'线索效率提升', filter:t=>t.舱室==='会客室'&&t.类型==='收集线索效率' },
                { id:'mood', label:'心情消耗减少', filter:t=>t.舱室==='会客室'&&t.类型==='心情消耗减少' },
                { id:'clue', label:'线索概率提升', filter:t=>t.舱室==='会客室'&&isCluePower(t.类型) }
            ]
        };
        let html = '<div class="talent-room-grid">';
        for (const [roomName, sections] of Object.entries(roomConfig)) {
            html += `<div class="talent-room-card"><div class="card-title">${roomName}</div>`;
            for (const section of sections) {
                const candidates = [];
                for (const s of scores) {
                    if (s.isBasic) continue;
                    const op = operators.find(o => o.id === s.opId);
                    if (!op) continue;
                    const traits = s.mergedTraits.filter(section.filter);
                    if (traits.length === 0) continue;
                    const totalInRoom = s.mergedTraits.filter(t => t.舱室 === roomName).length;
                    const value = Math.max(...traits.map(t => t.数值 || 0));
                    candidates.push({ opId: s.opId, name: s.name, traits, totalInRoom, value });
                }
                if (candidates.length === 0) continue;
                if (roomName === '会客室' && section.id === 'clue') {
                    candidates.sort((a,b) => parseInt(a.traits[0].线索编号||0) - parseInt(b.traits[0].线索编号||0));
                } else {
                    candidates.sort((a,b) => b.totalInRoom !== a.totalInRoom ? b.totalInRoom - a.totalInRoom : b.value - a.value);
                }
                html += `<div class="talent-sub-section"><div class="sub-title">${section.label}</div>`;
                for (const c of candidates) {
                    const op = operators.find(o => o.id === c.opId);
                    const imgSrc = getAgentImgSrc(op || c.name);
                    const desc = c.traits.map(t => formatShortTrait(t)).join('；');
                    html += `<div class="talent-agent-item">
                        <img class="avatar-mini" src="${imgSrc}" onerror="this.style.display='none';">
                        <span class="agent-name">${escapeHtml(c.name)}</span>
                        <span class="trait-text">${escapeHtml(desc)}</span>
                    </div>`;
                }
                html += `</div>`;
            }
            html += `</div>`;
        }
        html += '</div>';
        talentContent.innerHTML = html;
    }
    function renderFullView() {
        const roomFilter = document.querySelector('input[name="talentRoomRadio"]:checked')?.value || 'all';
        const filtered = getFilteredOperatorsForTalent();
        const allScores = computeScoresForAll();
        const scoresMap = {};
        for (const s of allScores) scoresMap[s.opId] = s.score;
        const items = [];
        for (const op of filtered) {
            const rawData = rawOperatorsData[op.name];
            if (!rawData) continue;
            const levels = [];
            for (const tid of TALENT_ORDER) {
                let traits = getTalentList(rawData, tid);
                if (roomFilter !== 'all') traits = traits.filter(t => t.舱室 === roomFilter);
                if (traits.length > 0) levels.push({ tid, traits });
            }
            if (levels.length === 0) continue;
            let sortScore = 0;
            const sc = scoresMap[op.id];
            if (sc) {
                if (roomFilter === 'all') sortScore = sc.central + sc.meeting + sc.culture + sc.manufact;
                else if (roomFilter === '总控中枢') sortScore = sc.central;
                else if (roomFilter === '制造舱') sortScore = sc.manufact;
                else if (roomFilter === '培养舱') sortScore = sc.culture;
                else if (roomFilter === '会客室') sortScore = sc.meeting;
            }
            items.push({ op, levels, sortScore });
        }
        items.sort((a, b) => b.sortScore - a.sortScore);
        let html = '<div class="talent-full-list">';
        for (const item of items) {
            const op = item.op;
            const imgSrc = getAgentImgSrc(op);
            html += `<div class="talent-full-item">
                <div class="avatar-name">
                    <img class="avatar" src="${imgSrc}" onerror="this.style.display='none';">
                    <span class="name">${escapeHtml(op.name)}</span>
                </div>
                <div class="talent-levels">`;
            for (const lv of item.levels) {
                const activated = op.activatedTalents[lv.tid];
                const desc = lv.traits.map(t => formatShortTrait(t)).join('；');
                const talentName = (lv.traits[0] && lv.traits[0].name) || lv.tid;
                const iconPath = getTalentIconPath(lv.traits);
                const iconTag = iconPath
                    ? `<img class="talent-full-icon" src="${iconPath}" onerror="this.style.display='none';" alt="">`
                    : '';
                const nameClass = activated ? 'talent-name activated' : 'talent-name';
                html += `<div class="level-row">
                    <span class="level-tag">${lv.tid}</span>
                    ${iconTag}
                    <span class="${nameClass}">${escapeHtml(talentName)}</span>
                    <span class="traits">${escapeHtml(desc)}</span>
                </div>`;
            }
            html += `</div></div>`;
        }
        if (items.length === 0) html += '<div class="talent-empty">暂无符合条件的干员天赋</div>';
        html += '</div>';
        talentContent.innerHTML = html;
    }
    showTalentBtn.addEventListener('click', openTalentModal);
    talentCloseBtn.addEventListener('click', closeTalentModal);
    talentModal.addEventListener('click', function(e) { if (e.target === this) closeTalentModal(); });
    talentTabs.addEventListener('click', function(e) {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;
        const view = btn.dataset.view;
        if (view === currentTalentView) return;
        currentTalentView = view;
        talentTabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderTalentView(view);
    });
    talentStarFilter.addEventListener('change', () => renderTalentView(currentTalentView));
    talentAttrFilter.addEventListener('change', () => renderTalentView(currentTalentView));
    talentRoomRadios.forEach(r => r.addEventListener('change', () => { if (currentTalentView === 'full') renderFullView(); }));

    // ---------- 线索按钮可用性 ----------
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

    // ---------- 主站培养舱优先级 UI ----------
    function initCulturePriorityUI() {
        const container = document.getElementById('cultureProducts');
        if (!container) return;

        // 从 sessionStorage 读
        let local = { products: ['mineral', 'fungi', 'plant'], priority: null };
        try {
            const raw = sessionStorage.getItem('DijiangManualProduct');
            if (raw) {
                const p = JSON.parse(raw);
                const c = p.culture;
                if (c && typeof c === 'object') {
                    local.products = Array.isArray(c.products) ? c.products.slice() : [];
                    local.priority = Array.isArray(c.priority) && c.priority.length > 0
                        ? c.priority.slice()
                        : null;
                }
            }
        } catch (e) {}

        const labels = Array.from(container.querySelectorAll('label.checkbox-label'));

        // 初始勾选
        labels.forEach(label => {
            const cb = label.querySelector('input');
            cb.checked = local.products.includes(cb.value);
        });

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
                const cb = label.querySelector('input');
                const badge = label.querySelector('.prio-badge');
                const arrows = label.querySelector('.prio-arrows');
                const up = arrows.querySelector('.prio-up');
                const down = arrows.querySelector('.prio-down');
                if (!cb.checked) {
                    badge.style.display = 'none';
                    arrows.style.display = 'none';
                    return;
                }
                const rank = priority.indexOf(cb.value);
                badge.textContent = String(rank + 1);
                badge.style.display = '';
                arrows.style.display = '';
                up.disabled = rank === 0;
                down.disabled = rank === priority.length - 1;
            });
            const hint = document.getElementById('culturePriorityHint');
            if (hint) {
                hint.textContent = local.priority === null
                    ? '未设置优先级时默认顺序：晶植 > 矿物 > 菌类'
                    : '优先级 ① 最高的产物决定本舱时间安排';
            }
        }

        function persist() {
            const products = labels.map(l => l.querySelector('input')).filter(cb => cb.checked).map(cb => cb.value);
            const priority = local.priority ? getEffectivePriority() : null;
            try {
                let all = {};
                const raw = sessionStorage.getItem('DijiangManualProduct');
                if (raw) all = JSON.parse(raw);
                all.culture = { products, priority };
                sessionStorage.setItem('DijiangManualProduct', JSON.stringify(all));
            } catch (e) {}
            saveProductConfigToSession();
        }

        // 复选框
        labels.forEach(label => {
            const cb = label.querySelector('input');
            cb.addEventListener('change', () => {
                if (!cb.checked && local.priority) {
                    local.priority = local.priority.filter(x => x !== cb.value);
                    if (local.priority.length === 0) local.priority = null;
                }
                updateBadges();
                persist();
                generateSchedule();
            });
        });

        // ▲▼
        labels.forEach(label => {
            const up = label.querySelector('.prio-up');
            const down = label.querySelector('.prio-down');
            const value = label.querySelector('input').value;

            up.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const cur = getEffectivePriority();
                const idx = cur.indexOf(value);
                if (idx <= 0) return;
                const next = cur.slice();
                [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                local.priority = next;
                updateBadges();
                persist();
                generateSchedule();
            });

            down.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const cur = getEffectivePriority();
                const idx = cur.indexOf(value);
                if (idx < 0 || idx >= cur.length - 1) return;
                const next = cur.slice();
                [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                local.priority = next;
                updateBadges();
                persist();
                generateSchedule();
            });
        });

        updateBadges();
    }

    // ---------- 二轮排除线索 UI ----------
    function initExcludedCluesUI() {
        try {
            const raw = sessionStorage.getItem('DijiangExcludedClues');
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) excludedClues = new Set(arr.filter(n => n >= 1 && n <= 7));
            }
        } catch (e) {}

        const container = document.getElementById('excludedCluesButtons');
        if (!container) return;
        container.innerHTML = '';
        for (let i = 1; i <= 7; i++) {
            const btn = document.createElement('div');
            btn.className = 'clue-btn';
            btn.textContent = `线索${i}`;
            btn.dataset.clue = i;
            if (excludedClues.has(i)) btn.classList.add('selected');
            btn.addEventListener('click', function () {
                this.classList.toggle('selected');
                const num = parseInt(this.dataset.clue, 10);
                if (this.classList.contains('selected')) excludedClues.add(num);
                else excludedClues.delete(num);
                try {
                    sessionStorage.setItem('DijiangExcludedClues', JSON.stringify([...excludedClues]));
                } catch (e) {}
                generateSchedule();
            });
            container.appendChild(btn);
        }
    }

    // ---------- UI 初始化 ----------
    function initUI() {
        const savedMode = sessionStorage.getItem('centralMode');
        if (savedMode && ['normal','empty','trust'].includes(savedMode)) centralMode = savedMode;
        const savedTrust = sessionStorage.getItem('trustedAgentIds');
        if (savedTrust) {
            try {
                const arr = JSON.parse(savedTrust);
                if (Array.isArray(arr)) {
                    trustedAgentIds = arr.filter(id => operators.some(o => o.id === id));
                    if (trustedAgentIds.length > 6) trustedAgentIds = trustedAgentIds.slice(0, 6);
                }
            } catch(e) {}
        }
        const savedAssign = sessionStorage.getItem('trustAssignMap');
        if (savedAssign) {
            try {
                const parsed = JSON.parse(savedAssign);
                const validIds = operators.map(o => o.id);
                trustAssignMap = {};
                for (const [id, round] of Object.entries(parsed)) {
                    const numId = parseInt(id);
                    if (validIds.includes(numId)) trustAssignMap[numId] = round;
                }
            } catch(e) {}
        }
        updateTrustTags();
        // ★ 默认全部舱室开启二轮；若 sessionStorage 有保存则以其为准
        const savedDouble = sessionStorage.getItem('doubleRoundRooms');
        if (savedDouble) {
            try {
                const arr = JSON.parse(savedDouble);
                if (Array.isArray(arr)) {
                    doubleRoundRooms = arr.filter(v => ALL_DOUBLE_ROOMS.includes(v));
                } else {
                    doubleRoundRooms = ALL_DOUBLE_ROOMS.slice();
                }
            } catch (e) {
                doubleRoundRooms = ALL_DOUBLE_ROOMS.slice();
            }
        } else {
            doubleRoundRooms = ALL_DOUBLE_ROOMS.slice();
            // 首次访问 → 写入默认值，避免下次再判空
            try {
                sessionStorage.setItem('doubleRoundRooms', JSON.stringify(doubleRoundRooms));
            } catch (e) {}
        }
        // 同步复选框状态
        document.querySelectorAll('#doubleRoundRooms input').forEach(cb => {
            cb.checked = doubleRoundRooms.includes(cb.value);
        });
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
                    document.querySelectorAll('.clue-btn').forEach(btn => {
                        if (missingClues.has(parseInt(btn.dataset.clue))) btn.classList.add('selected');
                    });
                } catch(e) {}
            }
        }
        const toggle = document.getElementById('meetingPriorityToggle');
        const clueArea = document.getElementById('missingCluesArea');
        const clueContainer = document.getElementById('clueButtons');
        if (clueContainer.children.length === 0) {
            for (let i = 1; i <= 7; i++) {
                const btn = document.createElement('div');
                btn.className = 'clue-btn';
                btn.textContent = `线索${i}`;
                btn.dataset.clue = i;
                btn.addEventListener('click', function() {
                    if (!meetingPriorityEnabled) return;
                    if (this.classList.contains('disabled')) return;
                    this.classList.toggle('selected');
                    const num = parseInt(this.dataset.clue);
                    if (this.classList.contains('selected')) missingClues.add(num);
                    else missingClues.delete(num);
                    sessionStorage.setItem('missingClues', JSON.stringify([...missingClues]));
                    generateSchedule();
                });
                clueContainer.appendChild(btn);
            }
        }
        updateClueAvailability();

        toggle.addEventListener('click', function() {
            meetingPriorityEnabled = !meetingPriorityEnabled;
            if (meetingPriorityEnabled) {
                this.classList.add('active');
                document.getElementById('priorityStatus').textContent = '开启';
                clueArea.style.display = 'block';
                sessionStorage.setItem('meetingPriority', 'true');
            } else {
                this.classList.remove('active');
                document.getElementById('priorityStatus').textContent = '关闭';
                clueArea.style.display = 'none';
                missingClues.clear();
                document.querySelectorAll('.clue-btn').forEach(b => b.classList.remove('selected'));
                sessionStorage.setItem('meetingPriority', 'false');
            }
            generateSchedule();
        });
        const modeBtns = document.querySelectorAll('#centralModeSelector .mode-btn');
        const trustArea = document.getElementById('centralTrustArea');
        modeBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                const mode = this.dataset.mode;
                if (mode !== 'trust' && centralMode === 'trust') {
                    trustedAgentIds = [];
                    trustAssignMap = {};
                    sessionStorage.removeItem('trustedAgentIds');
                    sessionStorage.removeItem('trustAssignMap');
                    updateTrustTags();
                    closeTrustModal();
                    closeTrustAssignModal();
                }
                centralMode = mode;
                modeBtns.forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                if (mode === 'trust') { trustArea.style.display = 'flex'; updateTrustMaxLabel(); }
                else trustArea.style.display = 'none';
                sessionStorage.setItem('centralMode', mode);
                generateSchedule();
            });
        });
        const initModeBtn = document.querySelector(`#centralModeSelector .mode-btn[data-mode="${centralMode}"]`);
        if (initModeBtn) {
            modeBtns.forEach(b => b.classList.remove('active'));
            initModeBtn.classList.add('active');
            trustArea.style.display = centralMode === 'trust' ? 'flex' : 'none';
        }
        document.getElementById('openTrustModalBtn').addEventListener('click', openTrustModal);
        // ★ 从 DijiangDefaultProduct 恢复制造舱产品复选框状态
        try {
            const rawDefault = sessionStorage.getItem('DijiangDefaultProduct');
            if (rawDefault) {
                const p = JSON.parse(rawDefault);
                const mode = (p.manufactA && p.manufactB && p.manufactA === p.manufactB)
                    ? p.manufactA
                    : 'dual';
                const expCheck = document.querySelector('#manufactProducts input[value="exp"]');
                const weaponCheck = document.querySelector('#manufactProducts input[value="weapon"]');
                if (expCheck) expCheck.checked = (mode === 'dual' || mode === 'exp');
                if (weaponCheck) weaponCheck.checked = (mode === 'dual' || mode === 'weapon');
            }
        } catch (e) {
            console.warn('[帝江号] 恢复制造舱产品失败：', e);
        }

        document.querySelectorAll('#manufactProducts input').forEach(cb => {
            cb.addEventListener('change', () => {
                saveProductConfigToSession();
                generateSchedule();
            });
        });
        // 培养舱由优先级 UI 处理（见下方 initCulturePriorityUI）
        document.querySelectorAll('#doubleRoundRooms input').forEach(cb => {
            cb.addEventListener('change', function() {
                const checked = Array.from(document.querySelectorAll('#doubleRoundRooms input:checked')).map(c => c.value);
                sessionStorage.setItem('doubleRoundRooms', JSON.stringify(checked));
                if (centralMode === 'trust') {
                    trustedAgentIds = [];
                    trustAssignMap = {};
                    sessionStorage.removeItem('trustedAgentIds');
                    sessionStorage.removeItem('trustAssignMap');
                    updateTrustTags();
                    closeTrustModal();
                    closeTrustAssignModal();
                    updateTrustMaxLabel();
                }
            });
        });
        document.getElementById('confirmDoubleRoundBtn').addEventListener('click', function() {
            const checked = Array.from(document.querySelectorAll('#doubleRoundRooms input:checked')).map(c => c.value);
            doubleRoundRooms = checked;
            sessionStorage.setItem('doubleRoundRooms', JSON.stringify(checked));
            if (centralMode === 'trust') {
                trustedAgentIds = [];
                trustAssignMap = {};
                sessionStorage.removeItem('trustedAgentIds');
                sessionStorage.removeItem('trustAssignMap');
                updateTrustTags();
                closeTrustModal();
                closeTrustAssignModal();
                updateTrustMaxLabel();
            }
            generateSchedule();
            alert('二轮舱室已更新！');
        });
        document.getElementById('eliteFilter').addEventListener('change', e => { currentFilter = e.target.value; renderOperatorStatus(); });
        document.getElementById('starFilter').addEventListener('change', e => { currentStarFilter = e.target.value; renderOperatorStatus(); });
        document.getElementById('attributeFilter').addEventListener('change', e => { currentAttributeFilter = e.target.value; renderOperatorStatus(); });
        document.getElementById('clearConfigBtn').addEventListener('click', function() {
            if (confirm('确定要清空所有干员的配置吗？此操作不可撤销。')) {
                for (const op of operators) { op.eliteLevel = 'none'; op.activatedTalents = emptyTalents(); }
                updateAllMergedTraits();
                renderOperatorStatus();
                saveConfigToSessionStorage();
                generateSchedule();
                document.getElementById('eliteFilter').value = 'all'; currentFilter = 'all';
                document.getElementById('starFilter').value = 'all'; currentStarFilter = 'all';
                document.getElementById('attributeFilter').value = 'all'; currentAttributeFilter = 'all';
                renderOperatorStatus();
                alert('已清空全部干员配置。');
            }
        });
        saveProductConfigToSession();
        initCulturePriorityUI();
        initExcludedCluesUI();
    }

    // ---------- 反馈 ----------
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
        modal.addEventListener('click', e => { if (e.target === this) closeFeedback(); });
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

    // ---------- 更新日志 ----------
    (function() {
        const overlay = document.getElementById('changelogOverlay');
        const body = document.getElementById('changelogBody');
        const closeX = document.getElementById('changelogCloseX');
        const showAllBtn = document.getElementById('changelogShowAllBtn');
        const confirmBtn = document.getElementById('changelogConfirmBtn');
        if (!overlay) return;

        const SESSION_KEY = 'dijiang_changelog_shown';

        function closeChangelog() { overlay.classList.remove('open'); }

        overlay.addEventListener('click', e => { if (e.target === overlay) closeChangelog(); });
        if (closeX) closeX.addEventListener('click', closeChangelog);
        if (confirmBtn) confirmBtn.addEventListener('click', closeChangelog);
        if (showAllBtn) showAllBtn.addEventListener('click', () => {
            window.location.href = '/log/';
        });

        if (sessionStorage.getItem(SESSION_KEY) === '1') return;

        fetch('/log/latest.md', { cache: 'no-cache' })
            .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
            .then(md => {
                if (!md || !md.trim()) return;
                body.innerHTML = marked.parse(md);
                overlay.classList.add('open');
                sessionStorage.setItem(SESSION_KEY, '1');
            })
            .catch(() => {});
    })();

    // ---------- 启动 ----------
    async function loadDataAndInit() {
        try {
            await loadSprite();

            const res = await fetch('/Agent_characteristics.json');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            rawOperatorsData = await res.json();
            if (!rawOperatorsData || Object.keys(rawOperatorsData).length === 0) throw new Error('JSON 为空');
            initOperatorsList();
            renderOperatorStatus();
            (function scheduleBackgroundPreload() {
                const names = operators.map(op => op.name);
                const run = () => preloadAllAvatars(names, 6);
                if ('requestIdleCallback' in window) {
                    requestIdleCallback(run, { timeout: 2000 });
                } else {
                    setTimeout(run, 1500);
                }
            })();
            const loaded = loadConfigFromSessionStorage();
            if (!loaded) {
                const rawSnapshot = sessionStorage.getItem(STORAGE_KEY);
                if (rawSnapshot) {
                    // 有快照但解析/匹配失败 → 只按默认渲染，不写回，保留原始字符串
                    console.warn('[帝江号] 存在无法解析的配置快照，本次按默认展示，不覆盖原快照。');
                    for (const op of operators) { op.eliteLevel = 'none'; op.activatedTalents = emptyTalents(); }
                    updateAllMergedTraits();
                    renderOperatorStatus();
                } else {
                    // 确实没有任何配置 → 初始化空配置并写入
                    for (const op of operators) { op.eliteLevel = 'none'; op.activatedTalents = emptyTalents(); }
                    updateAllMergedTraits();
                    renderOperatorStatus();
                    saveConfigToSessionStorage();
                }
            }
            initUI();
            generateSchedule();
            // ★ 主站就绪标记 + 事件，供 account.js 触发自动拉取账号配置
            window.__DIJIANG_READY__ = true;
            window.dispatchEvent(new CustomEvent('dijiang:ready'));
        } catch (error) {
            console.error('加载失败:', error);
            document.getElementById('operatorStatusContainer').innerHTML = `<div style="text-align:center; color:#ffaa88;">❌ 加载失败：${error.message}</div>`;
            document.getElementById('scheduleResult').innerHTML = '<div style="text-align:center; color:#ffaa88;">数据加载失败。</div>';
        }
    }

    // 启动时清空跳过标志，避免遗留
    window.__DIJIANG_SKIP_PAGEHIDE_SAVE__ = false;
    // ★ 时间段推荐计算完成后，刷新排班表，让时段徽章显示出来
    window.addEventListener('dijiang:timing-updated', function () {
        if (window._lastQueues) renderSchedule(window._lastQueues);
    });
    loadDataAndInit();

    // ★ 离开页面前兜底保存一次，保证跨页导航时配置完整
    window.addEventListener('pagehide', function () {
        // 预设干员库等场景会主动写入 sessionStorage 并 reload，
        // 此时内存里的 operators 还是旧的，跳过兜底保存，避免覆盖预设。
        if (window.__DIJIANG_SKIP_PAGEHIDE_SAVE__) return;

        try { saveConfigToSessionStorage(); } catch (e) {}
        try { saveProductConfigToSession(); } catch (e) {}
        try {
            sessionStorage.setItem('DijiangDoubleRooms', JSON.stringify(doubleRoundRooms));
        } catch (e) {}
        try {
            sessionStorage.setItem('DijiangExcludedClues', JSON.stringify([...excludedClues]));
        } catch (e) {}
        try {
            sessionStorage.setItem('centralMode', centralMode);
        } catch (e) {}
        try {
            sessionStorage.setItem('meetingPriority', meetingPriorityEnabled ? 'true' : 'false');
        } catch (e) {}
        try {
            sessionStorage.setItem('missingClues', JSON.stringify([...missingClues]));
        } catch (e) {}
        try {
            sessionStorage.setItem('doubleRoundRooms', JSON.stringify(doubleRoundRooms));
        } catch (e) {}
    });

    // ---------- 对外接口 ----------
    window.DijiangAPI = {
        getOperatorOrder: function() { return getOperatorOrder(); },
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
                if (!v) {
                    op.eliteLevel = 'none';
                    op.activatedTalents = emptyTalents();
                    continue;
                }
                const entry = parseConfigEntry(v);
                op.eliteLevel = entry.elite;
                const t = emptyTalents();
                if (entry.elite !== 'none') {
                    for (const tid of entry.talents) t[tid] = true;
                }
                op.activatedTalents = t;
                sanitizeTalents(op);
                if (op.eliteLevel !== 'none') applied++;
            }
            updateAllMergedTraits();
            renderOperatorStatus();
            saveConfigToSessionStorage();
            generateSchedule();

            window.dispatchEvent(new CustomEvent('dijiang:import-success'));

            return { ok: true, applied, total: operators.length };
        }
    };
    window.DijiangAccount = {
        getCurrentConfig: function() {
            try {
                const obj = buildExportObject();
                delete obj._comment;
                delete obj._version;

                // ★ 附带生产策略
                let manufactProducts = null;
                let cultureProducts = null;
                try {
                    const raw = sessionStorage.getItem('DijiangDefaultProduct');
                    if (raw) manufactProducts = JSON.parse(raw);
                } catch (e) {}
                try {
                    const raw = sessionStorage.getItem('DijiangManualProduct');
                    if (raw) {
                        const p = JSON.parse(raw);
                        if (p && p.culture) cultureProducts = p.culture;
                    }
                } catch (e) {}

                obj._strategy = {
                    doubleRoundRooms: doubleRoundRooms.slice(),
                    centralMode: centralMode,
                    trustedAgentIds: trustedAgentIds.slice(),
                    trustAssignMap: Object.assign({}, trustAssignMap),
                    meetingPriorityEnabled: meetingPriorityEnabled,
                    missingClues: [...missingClues],
                    excludedClues: [...excludedClues],
                    manufactProducts: manufactProducts,
                    cultureProducts: cultureProducts
                };

                return obj;
            } catch (e) {
                console.warn('[DijiangAccount] 获取配置失败:', e);
                return {};
            }
        },

        applyConfig: function(config) {
            try {
                if (!config || typeof config !== 'object') return false;

                // 1. 拆分出生产策略
                const strategy = config._strategy || null;
                const opConfig = {};
                for (const [name, val] of Object.entries(config)) {
                    if (name.startsWith('_')) continue;
                    opConfig[name] = val;
                }

                // 2. 应用干员库配置（内部 applyConfig 函数）
                applyConfig(opConfig);

                // 3. 应用生产策略
                if (strategy) {
                    try {
                        // 3.1 二轮舱室
                        if (Array.isArray(strategy.doubleRoundRooms)) {
                            doubleRoundRooms = strategy.doubleRoundRooms.filter(v =>
                                ['central','manufactA','manufactB','culture','meeting'].includes(v)
                            );
                            sessionStorage.setItem('DijiangDoubleRooms', JSON.stringify(doubleRoundRooms));
                            document.querySelectorAll('#doubleRoundRooms input').forEach(cb => {
                                cb.checked = doubleRoundRooms.includes(cb.value);
                            });
                        }
                        // 3.2 总控模式
                        if (typeof strategy.centralMode === 'string' &&
                            ['normal','empty','trust'].includes(strategy.centralMode)) {
                            centralMode = strategy.centralMode;
                            sessionStorage.setItem('centralMode', centralMode);
                            const modeBtns = document.querySelectorAll('#centralModeSelector .mode-btn');
                            modeBtns.forEach(b => b.classList.remove('active'));
                            const btn = document.querySelector(`#centralModeSelector .mode-btn[data-mode="${centralMode}"]`);
                            if (btn) btn.classList.add('active');
                            const trustArea = document.getElementById('centralTrustArea');
                            if (trustArea) trustArea.style.display = centralMode === 'trust' ? 'flex' : 'none';
                        }
                        // 3.3 信赖干员
                        if (Array.isArray(strategy.trustedAgentIds)) {
                            trustedAgentIds = strategy.trustedAgentIds.filter(id =>
                                operators.some(o => o.id === id)
                            );
                            sessionStorage.setItem('trustedAgentIds', JSON.stringify(trustedAgentIds));
                            updateTrustTags();
                        }
                        if (strategy.trustAssignMap && typeof strategy.trustAssignMap === 'object') {
                            trustAssignMap = {};
                            for (const [id, round] of Object.entries(strategy.trustAssignMap)) {
                                const numId = parseInt(id);
                                if (operators.some(o => o.id === numId)) trustAssignMap[numId] = round;
                            }
                            sessionStorage.setItem('trustAssignMap', JSON.stringify(trustAssignMap));
                        }
                        // 3.4 会客室优先
                        if (typeof strategy.meetingPriorityEnabled === 'boolean') {
                            meetingPriorityEnabled = strategy.meetingPriorityEnabled;
                            sessionStorage.setItem('meetingPriority', meetingPriorityEnabled ? 'true' : 'false');
                            const toggle = document.getElementById('meetingPriorityToggle');
                            const clueArea = document.getElementById('missingCluesArea');
                            const priorityStatus = document.getElementById('priorityStatus');
                            if (toggle) toggle.classList.toggle('active', meetingPriorityEnabled);
                            if (clueArea) clueArea.style.display = meetingPriorityEnabled ? 'block' : 'none';
                            if (priorityStatus) priorityStatus.textContent = meetingPriorityEnabled ? '开启' : '关闭';
                        }
                        // 3.5 缺失线索
                        if (Array.isArray(strategy.missingClues)) {
                            missingClues = new Set(strategy.missingClues.filter(n => n >= 1 && n <= 7));
                            sessionStorage.setItem('missingClues', JSON.stringify([...missingClues]));
                            document.querySelectorAll('#clueButtons .clue-btn').forEach(btn => {
                                const n = parseInt(btn.dataset.clue, 10);
                                btn.classList.toggle('selected', missingClues.has(n));
                            });
                        }
                        // 3.6 二轮排除线索
                        if (Array.isArray(strategy.excludedClues)) {
                            excludedClues = new Set(strategy.excludedClues.filter(n => n >= 1 && n <= 7));
                            sessionStorage.setItem('DijiangExcludedClues', JSON.stringify([...excludedClues]));
                            document.querySelectorAll('#excludedCluesButtons .clue-btn').forEach(btn => {
                                const n = parseInt(btn.dataset.clue, 10);
                                btn.classList.toggle('selected', excludedClues.has(n));
                            });
                        }
                        // 3.7 制造舱产品
                        if (strategy.manufactProducts) {
                            sessionStorage.setItem('DijiangDefaultProduct', JSON.stringify(strategy.manufactProducts));
                            const mA = strategy.manufactProducts.manufactA;
                            const mB = strategy.manufactProducts.manufactB;
                            const mode = (mA === mB) ? mA : 'dual';
                            const expCheck = document.querySelector('#manufactProducts input[value="exp"]');
                            const weaponCheck = document.querySelector('#manufactProducts input[value="weapon"]');
                            if (expCheck) expCheck.checked = (mode === 'dual' || mode === 'exp');
                            if (weaponCheck) weaponCheck.checked = (mode === 'dual' || mode === 'weapon');
                        }
                        // 3.8 培养舱产品与优先级
                        if (strategy.cultureProducts) {
                            let all = {};
                            try {
                                const raw = sessionStorage.getItem('DijiangManualProduct');
                                if (raw) all = JSON.parse(raw) || {};
                            } catch (e) { all = {}; }
                            all.culture = strategy.cultureProducts;
                            sessionStorage.setItem('DijiangManualProduct', JSON.stringify(all));

                            const labels = Array.from(document.querySelectorAll('#cultureProducts label.checkbox-label'));
                            const products = Array.isArray(strategy.cultureProducts.products)
                                ? strategy.cultureProducts.products : [];
                            labels.forEach(label => {
                                const cb = label.querySelector('input');
                                if (cb) cb.checked = products.includes(cb.value);
                            });
                        }
                    } catch (e) {
                        console.warn('[DijiangAccount] 应用生产策略部分失败:', e);
                    }
                }

                // 4. 重新排班
                try { generateSchedule(); } catch (e) {}
                return true;
            } catch (e) {
                console.warn('[DijiangAccount] 应用配置失败:', e);
                return false;
            }
        }
    };
    // ---------- URL 参数：自动打开账号 / 数据设置 ----------
    (function handleUrlActions() {
        const params = new URLSearchParams(window.location.search);
        const needAccount = params.get('openAccount') === '1';
        const needDataSettings = params.get('openDataSettings') === '1';
        if (!needAccount && !needDataSettings) return;

        try {
            const clean = window.location.pathname + window.location.hash;
            window.history.replaceState({}, '', clean);
        } catch (e) {}

        if (needAccount) {
            setTimeout(function () {
                const btn = document.getElementById('accountBtn');
                if (btn) btn.click();
            }, 600);
        }
        if (needDataSettings) {
            setTimeout(function () {
                if (typeof window.openDataSettings === 'function') {
                    window.openDataSettings();
                }
            }, 600);
        }
    })();
    console.log('[帝江号] DijiangAPI 已就绪。');
})();