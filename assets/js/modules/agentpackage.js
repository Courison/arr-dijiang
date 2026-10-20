/* ============================================================
   agentpackage.js —— 干员天赋一览页
   独立实现：数据加载、筛选、卡片渲染、练度编辑
   保存后写回 sessionStorage，与主站/手动页同步
   ============================================================ */
(function () {
    'use strict';

    // ========== 常量 ==========
    const TALENT_ORDER = ['1_1', '2_1', '1_2', '2_2'];
    const TALENT_META = {
        '1_1': { minElite: 2, label: '精一' },
        '2_1': { minElite: 3, label: '精二' },
        '1_2': { minElite: 4, label: '精三' },
        '2_2': { minElite: 5, label: '精四' },
    };
    const ELITE_RANK = { 'none': 0, '精零': 1, '精一': 2, '精二': 3, '精三': 4, '精四': 5 };
    const ELITE_ORDER = ['none', '精零', '精一', '精二', '精三', '精四'];
    const STORAGE_KEY = 'DijiangScheduleConfig';

    const TYPE_GROUP = {
        '心情恢复提升': '心情回复',
        '心情消耗减少': '心情减耗',
        '干员素材效率': '效率提升',
        '武器素材效率': '效率提升',
        '矿物效率': '效率提升',
        '菌类效率': '效率提升',
        '晶植效率': '效率提升',
        '收集线索效率': '效率提升',
        '线索概率提升': '线索概率提升',
        '线索概率小幅提升': '线索概率提升',
    };

    const AVATAR_FALLBACK = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" fill="#eaeaea"/><text x="50%" y="54%" text-anchor="middle" font-size="20" fill="#999">?</text></svg>'
    );

    // ========== 状态 ==========
    let rawData = null;
    let operatorOrder = [];
    let config = {};  // { name: { elite, talents: [] } }
    const filters = { star: 'all', room: 'all', type: 'all', status: 'all' };

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
        if (typeof val === 'string') {
            return { elite: normalizeElite(val), talents: [] };
        }
        if (val && typeof val === 'object') {
            return {
                elite: normalizeElite(val.elite),
                talents: Array.isArray(val.talents) ? val.talents.slice() : [],
            };
        }
        return { elite: 'none', talents: [] };
    }
    function emptyTalents() {
        return { '1_1': false, '2_1': false, '1_2': false, '2_2': false };
    }
    function canActivate(elite, tid) {
        return ELITE_RANK[elite] >= TALENT_META[tid].minElite;
    }
    function sanitizeTalents(elite, talents) {
        const t = Object.assign({}, talents);
        for (const tid of TALENT_ORDER) {
            if (t[tid] && !canActivate(elite, tid)) {
                t[tid] = false;
                if (tid === '1_1') t['1_2'] = false;
                if (tid === '2_1') t['2_2'] = false;
            }
        }
        if (t['1_2']) t['1_1'] = true;
        if (t['2_2']) t['2_1'] = true;
        return t;
    }
    function autoActivateByElite(elite) {
        const t = emptyTalents();
        if (elite === '精一') { t['1_1'] = true; }
        else if (elite === '精二') { t['1_1'] = t['2_1'] = true; }
        else if (elite === '精三') { t['1_1'] = t['2_1'] = t['1_2'] = true; }
        else if (elite === '精四') { t['1_1'] = t['2_1'] = t['1_2'] = t['2_2'] = true; }
        return t;
    }

    // ========== 天赋工具 ==========
    function getTalentList(opData, tid) {
        if (!opData) return [];
        if (Array.isArray(opData[tid]) && opData[tid].length) return opData[tid];
        const LEGACY = { '1_1': '精一', '2_1': '精二', '1_2': '精三', '2_2': '精四' };
        if (Array.isArray(opData[LEGACY[tid]]) && opData[LEGACY[tid]].length) return opData[LEGACY[tid]];
        return [];
    }
    function isCluePower(type) {
        return type === '线索概率提升' || type === '线索概率小幅提升';
    }
    function classifyType(type) {
        return TYPE_GROUP[type] || '其他';
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

    // ========== 头像（精灵图） ==========
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
                console.log('[干员库·精灵图] 已加载 ' + Object.keys(spriteIndex.agents || {}).length + ' 个干员');
            } catch (e) {
                spriteReady = false;
                console.warn('[干员库·精灵图] 加载失败，回退单张头像：', e);
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
            return null;
        }
    }
    function getAgentImgSrc(name) {
        const spriteUrl = getSpriteDataUrl(name);
        if (spriteUrl) return spriteUrl;
        return '/Agent/' + encodeURIComponent(name) + '.webp';
    }

    // ========== 数据加载 ==========
    async function loadData() {
        await loadSprite();

        const rawConfig = sessionStorage.getItem(STORAGE_KEY);
        config = {};
        if (rawConfig) {
            try {
                const parsed = JSON.parse(rawConfig);
                if (parsed && typeof parsed === 'object') {
                    for (const [name, val] of Object.entries(parsed)) {
                        config[name] = parseConfigEntry(val);
                    }
                }
            } catch (e) {
                console.warn('[干员库] 配置快照解析失败，本次按默认展示，不覆盖：', e);
                config = {};
            }
        }

        const res = await fetch('/Agent_characteristics.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        rawData = await res.json();
        if (!rawData || Object.keys(rawData).length === 0) throw new Error('数据为空');

        // 按 operator_order 排序
        if (Array.isArray(rawData.operator_order) && rawData.operator_order.length) {
            operatorOrder = rawData.operator_order.slice();
        } else {
            operatorOrder = Object.keys(rawData).filter(k => k !== 'operator_order');
        }
    }

    // ========== 构建扁平天赋列表 ==========
    function buildFlatList() {
        const list = [];
        for (const name of operatorOrder) {
            const opData = rawData[name];
            if (!opData) continue;

            const entry = config[name] || { elite: 'none', talents: [] };
            const elite = entry.elite;
            const curRank = ELITE_RANK[elite];
            const activated = new Set(entry.talents);

            // 收集该干员的所有天赋行
            const rows = [];
            for (const tid of TALENT_ORDER) {
                const traits = getTalentList(opData, tid);
                if (!traits.length) continue;
                const isActive = activated.has(tid);
                for (const t of traits) {
                    const room = t.舱室;
                    const typeGroup = classifyType(t.类型);
                    let status;
                    if (isActive && curRank > 0) status = 'active';
                    else if (curRank >= TALENT_META[tid].minElite) status = 'available';
                    else status = 'locked';

                    rows.push({
                        name: name,
                        star: opData.star || '未知',
                        elite: elite,
                        tid: tid,
                        trait: t,
                        room: room,
                        typeGroup: typeGroup,
                        status: status,
                        talentName: t.name || tid,
                        effectText: formatShortTrait(t),
                    });
                }
            }

            if (rows.length) {
                list.push({
                    name: name,
                    star: opData.star || '未知',
                    elite: elite,
                    rows: rows,
                });
            }
        }
        return list;
    }

    // ========== 筛选 ==========
    function filterRows(rows) {
        return rows.filter(function (r) {
            if (filters.star !== 'all' && r.star !== filters.star) return false;
            if (filters.room !== 'all' && r.room !== filters.room) return false;
            if (filters.type !== 'all' && r.typeGroup !== filters.type) return false;
            if (filters.status === 'active' && r.status !== 'active') return false;
            if (filters.status === 'inactive' && r.status === 'active') return false;
            return true;
        });
    }

    // ========== 渲染 ==========
    function renderCard(item) {
        const eliteText = item.elite === 'none' ? '未拥有' : item.elite;
        const eliteClass = item.elite === 'none' ? ' none' : '';
        const imgSrc = getAgentImgSrc(item.name);
        const rowsHtml = item.rows.map(function (r) {
            const icon = getTalentIconPath([r.trait]);
            const iconTag = icon
                ? '<img class="ap-talent-icon" src="' + icon + '" onerror="this.style.display=\'none\';" alt="">'
                : '';
            let checkIcon = '☐';
            if (r.status === 'active') checkIcon = '✅';
            else if (r.status === 'locked') checkIcon = '🔒';
            return '<div class="ap-talent-row ' + r.status + '">' +
                iconTag +
                '<span class="ap-talent-name">' + escapeHtml(r.talentName) + '</span>' +
                '<span class="ap-talent-effect">' + escapeHtml(r.effectText) + '</span>' +
                '<span class="ap-talent-status">' + checkIcon + '</span>' +
            '</div>';
        }).join('');

        return '<div class="ap-card">' +
            '<div class="ap-card-avatar-wrap">' +
                '<img class="ap-card-avatar" src="' + imgSrc + '" onerror="this.onerror=null; this.src=\'' + AVATAR_FALLBACK + '\';" alt="' + escapeHtml(item.name) + '">' +
                '<div class="ap-card-elite' + eliteClass + '">' + escapeHtml(eliteText) + '</div>' +
            '</div>' +
            '<div class="ap-card-body">' +
                '<div class="ap-card-header">' +
                    '<span class="ap-card-name">' + escapeHtml(item.name) + '</span>' +
                    '<span class="ap-card-star">' + escapeHtml(item.star) + '</span>' +
                '</div>' +
                '<div class="ap-card-talents">' + rowsHtml + '</div>' +
            '</div>' +
        '</div>';
    }

    function render() {
        const container = document.getElementById('apContent');
        const list = buildFlatList();
        const filtered = [];
        for (const op of list) {
            const rows = filterRows(op.rows);
            if (rows.length) {
                filtered.push({ name: op.name, star: op.star, elite: op.elite, rows: rows });
            }
        }
        if (!filtered.length) {
            container.innerHTML = '<p class="ap-empty">当前筛选下没有匹配的天赋</p>';
            return;
        }
        container.innerHTML = filtered.map(renderCard).join('');
    }

    // ========== 筛选交互 ==========
    function bindFilters() {
        document.querySelectorAll('.ap-filter-tags').forEach(function (group) {
            const key = group.dataset.filter;
            group.querySelectorAll('.ap-filter-tag').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    group.querySelectorAll('.ap-filter-tag').forEach(function (b) {
                        b.classList.remove('active');
                    });
                    this.classList.add('active');
                    filters[key] = this.dataset.value;
                    render();
                });
            });
        });
    }

    // ========== 编辑弹窗 ==========
    let editingName = null;   // 当前正在编辑的干员
    let tempElite = 'none';
    let tempTalents = emptyTalents();

    function openEditModal() {
        document.getElementById('apEditModal').classList.add('open');
        showSelectView();
    }
    function closeEditModal() {
        document.getElementById('apEditModal').classList.remove('open');
    }
    function showSelectView() {
        document.getElementById('apSelectView').style.display = 'block';
        document.getElementById('apEditView').style.display = 'none';
        document.getElementById('apModalBack').style.display = 'none';
        document.getElementById('apModalTitle').textContent = '✏️ 选择干员';
        renderOperatorGrid('');
    }
    function showEditView() {
        document.getElementById('apSelectView').style.display = 'none';
        document.getElementById('apEditView').style.display = 'block';
        document.getElementById('apModalBack').style.display = 'inline-block';
        document.getElementById('apModalTitle').textContent = '✏️ 修改 ' + editingName;
        renderEditPanel();
    }

    function renderOperatorGrid(search) {
        const grid = document.getElementById('apOperatorGrid');
        const kw = (search || '').trim().toLowerCase();
        const names = operatorOrder.filter(function (n) {
            if (!kw) return true;
            return n.toLowerCase().indexOf(kw) !== -1;
        });
        if (!names.length) {
            grid.innerHTML = '<p class="ap-empty" style="grid-column:1/-1;">未找到匹配的干员</p>';
            return;
        }
        grid.innerHTML = names.map(function (name) {
            const entry = config[name] || { elite: 'none', talents: [] };
            const eliteText = entry.elite === 'none' ? '未拥有' : entry.elite;
            const eliteClass = entry.elite === 'none' ? ' none' : '';
            const imgSrc = getAgentImgSrc(name);
            return '<div class="ap-op-item" data-name="' + escapeHtml(name) + '">' +
                '<img src="' + imgSrc + '" onerror="this.onerror=null; this.src=\'' + AVATAR_FALLBACK + '\';" alt="' + escapeHtml(name) + '">' +
                '<div class="ap-op-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</div>' +
                '<div class="ap-op-elite' + eliteClass + '">' + escapeHtml(eliteText) + '</div>' +
            '</div>';
        }).join('');

        grid.querySelectorAll('.ap-op-item').forEach(function (item) {
            item.addEventListener('click', function () {
                selectOperator(this.dataset.name);
            });
        });
    }

    function selectOperator(name) {
        editingName = name;
        const opData = rawData[name] || {};
        const entry = config[name] || { elite: 'none', talents: [] };
        tempElite = entry.elite;
        const t = emptyTalents();
        for (const tid of entry.talents) t[tid] = true;
        tempTalents = sanitizeTalents(tempElite, t);
        showEditView();
    }

    function renderEditPanel() {
        const opData = rawData[editingName] || {};
        const imgSrc = getAgentImgSrc(editingName);
        const avatar = document.getElementById('apEditAvatar');
        avatar.onerror = function () { this.onerror = null; this.src = AVATAR_FALLBACK; };
        avatar.src = imgSrc;
        document.getElementById('apEditName').textContent = editingName;
        document.getElementById('apEditMeta').textContent =
            (opData.star || '未知') + ' · ' + (opData.attribute || '未知');

        // 精英化按钮
        document.querySelectorAll('#apEliteGroup button').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.level === tempElite);
        });

        // 天赋列表
        const listEl = document.getElementById('apTalentEditList');
        let html = '';
        for (const tid of TALENT_ORDER) {
            const traits = getTalentList(opData, tid);
            if (!traits.length) continue;
            const t = traits[0];
            const can = canActivate(tempElite, tid);
            const on = tempTalents[tid] && can;
            const iconPath = getTalentIconPath(traits);
            const iconTag = iconPath
                ? '<img class="ap-talent-edit-icon" src="' + iconPath + '" onerror="this.style.display=\'none\';" alt="">'
                : '<div class="ap-talent-edit-icon"></div>';
            const effectText = traits.map(formatShortTrait).join('；');
            const lockText = !can ? '（需 ' + TALENT_META[tid].label + '）' : '';
            html += '<div class="ap-talent-edit-item ' + (on ? 'on' : '') + (can ? '' : ' locked') + '" data-tid="' + tid + '">' +
                iconTag +
                '<div class="ap-talent-edit-info">' +
                    '<div class="ap-talent-edit-name">' + escapeHtml(t.name || tid) + lockText + '</div>' +
                    '<div class="ap-talent-edit-effect">' + escapeHtml(effectText) + '</div>' +
                '</div>' +
                '<div class="ap-talent-edit-check">' + (on ? '☑' : '☐') + '</div>' +
            '</div>';
        }
        listEl.innerHTML = html;

        listEl.querySelectorAll('.ap-talent-edit-item').forEach(function (item) {
            item.addEventListener('click', function () {
                if (this.classList.contains('locked')) return;
                const tid = this.dataset.tid;
                const newVal = !tempTalents[tid];
                const next = Object.assign({}, tempTalents);
                next[tid] = newVal;
                if (!newVal) {
                    if (tid === '1_1') next['1_2'] = false;
                    if (tid === '2_1') next['2_2'] = false;
                } else {
                    if (tid === '1_2') next['1_1'] = true;
                    if (tid === '2_2') next['2_1'] = true;
                }
                tempTalents = sanitizeTalents(tempElite, next);
                renderEditPanel();
            });
        });
    }

    function bindEliteButtons() {
        document.querySelectorAll('#apEliteGroup button').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const newElite = this.dataset.level;
                tempElite = newElite;
                // 切换精英化：等级提高时自动激活新增天赋，降低时自动清理越界天赋
                const oldRank = ELITE_RANK[tempElite];
                const auto = autoActivateByElite(newElite);
                // 保留用户已有的激活状态，但补齐新增可点的天赋
                const next = Object.assign({}, tempTalents);
                for (const tid of TALENT_ORDER) {
                    if (auto[tid] && !next[tid] && canActivate(newElite, tid)) {
                        // 等级提高解锁的新天赋，自动激活
                        next[tid] = true;
                    }
                }
                tempTalents = sanitizeTalents(newElite, next);
                renderEditPanel();
            });
        });
    }

    function saveEdit() {
        if (!editingName) return;
        const talents = TALENT_ORDER.filter(function (tid) { return tempTalents[tid]; });
        config[editingName] = { elite: tempElite, talents: talents };

        // ★ 合并写回：先读旧快照，保留本页不认识的字段，再覆盖干员条目
        let existing = {};
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') existing = parsed;
            }
        } catch (e) {
            existing = {};
        }
        for (const [name, entry] of Object.entries(config)) {
            existing[name] = {
                elite: entry.elite,
                talents: entry.talents.slice(),
            };
        }
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
        } catch (e) {
            console.warn('保存配置失败：', e);
        }

        closeEditModal();
        render();
        console.log('[干员库] 已保存 ' + editingName + ' 的配置');
    }

    // ========== 初始化 ==========
    async function init() {
        try {
            await loadData();
        } catch (e) {
            document.getElementById('apContent').innerHTML =
                '<p class="ap-error">数据加载失败：' + escapeHtml(e.message) + '</p>';
            return;
        }

        bindFilters();
        render();

        // 编辑弹窗绑定
        document.getElementById('apOpenEditBtn').addEventListener('click', openEditModal);
        document.getElementById('apModalClose').addEventListener('click', closeEditModal);
        document.getElementById('apModalBack').addEventListener('click', showSelectView);
        document.getElementById('apEditCancel').addEventListener('click', showSelectView);
        document.getElementById('apEditSave').addEventListener('click', saveEdit);

        const searchInput = document.getElementById('apSearchInput');
        searchInput.addEventListener('input', function () {
            renderOperatorGrid(this.value);
        });

        bindEliteButtons();

        // 点击遮罩关闭
        document.getElementById('apEditModal').addEventListener('click', function (e) {
            if (e.target === this) closeEditModal();
        });

        // ★ 离开页面前兜底写回一次，保证配置不丢
        window.addEventListener('pagehide', function () {
            try {
                let existing = {};
                const raw = sessionStorage.getItem(STORAGE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed === 'object') existing = parsed;
                }
                for (const [name, entry] of Object.entries(config)) {
                    existing[name] = {
                        elite: entry.elite,
                        talents: (entry.talents || []).slice(),
                    };
                }
                sessionStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
            } catch (e) {
                console.warn('[干员库] pagehide 保存失败：', e);
            }
        });

        console.log('[干员库] agentpackage.js 已加载');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();