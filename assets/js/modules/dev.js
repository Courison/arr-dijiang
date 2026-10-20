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

    // 记录顶配干员被分配的舱室 { name: ['制造舱', '培养舱'] }
    let topRoomMap = {};

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

    // ========== ★ 渲染简易排班图 ==========
    function renderSimpleSchedule(queues) {
        const container = document.getElementById('devSimpleSchedule');
        if (!container) return;
        const ROOM_MAP = { central: '总控中枢', manufactA: '制造舱 A', manufactB: '制造舱 B', culture: '培养舱', meeting: '会客室' };
        let html = '';
        
        for (const rk of ['central', 'manufactA', 'manufactB', 'culture', 'meeting']) {
            const data = queues[rk];
            if (!data) continue;
            
            // 收集舱室内所有干员（去重）
            const ops = new Set();
            if (data.round1) data.round1.forEach(o => o && ops.add(o.name));
            if (data.round2) data.round2.forEach(o => o && ops.add(o.name));
            if (data.recommend) data.recommend.forEach(o => o && ops.add(o.name));
            
            if (ops.size === 0) continue;

            html += `<div class="dev-schedule-room">
                <div class="dev-schedule-room-title">${ROOM_MAP[rk]}</div>
                <div class="dev-schedule-ops">`;
                
            for (const name of ops) {
                const imgSrc = getAgentImgSrc(name);
                html += `<div class="dev-schedule-op" title="${name}">
                    <img src="${imgSrc}" onerror="this.onerror=null; this.src='${AVATAR_FALLBACK}';">
                    <div class="op-name">${escapeHtml(name)}</div>
                </div>`;
            }
            html += `</div></div>`;
        }
        container.innerHTML = html;
    }

    // ========== ★ 顶配排班计算 ==========
    function generateTopRecommendation(rawData, config) {
        const grid = document.getElementById('devTopGrid');
        if (!window.DijiangScheduler) {
            grid.innerHTML = '<p class="dev-error">算法核心模块未加载</p>';
            return;
        }

        // 组装全满干员
        const maxOps = [];
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

        if (maxOps.length === 0) {
            grid.innerHTML = '<p class="dev-empty">暂无拥有干员，无法模拟</p>';
            return;
        }

        // 读取策略
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

        const options = {
            mode: manufMode, doubleRooms: Object.keys(roomModes).filter(k => roomModes[k] === 'double'),
            roomModes: roomModes, emptyRooms: Object.keys(roomModes).filter(k => roomModes[k] === 'empty'),
            centralDisabled: (roomModes.central === 'empty'), isTrustMode: false, trustedAgentIds: [], trustAssignMap: {},
            priorityOrderRound1: p1, priorityOrderRound2: p2, meetingPriorityEnabled: meetingPriority,
            missingClues: new Set(), excludedClues: new Set(),
            cultureTypes: ['plant', 'mineral', 'fungi'], culturePriority: ['plant', 'mineral', 'fungi'],
            priorityWeights: [1.0, 0.6, 0.3], cRestHigh: 12 * 1.48
        };

        let queues = null;
        try { queues = window.DijiangScheduler.generateSchedule(maxOps, options); } catch (err) {
            console.error('顶配排班失败:', err);
            grid.innerHTML = '<p class="dev-error">计算排班时发生错误</p>';
            return;
        }

        // 渲染简易排班图
        renderSimpleSchedule(queues);

        // 提取干员所在舱室
        topRoomMap = {};
        const ROOM_MAP = { central: '总控中枢', manufactA: '制造舱', manufactB: '制造舱', culture: '培养舱', meeting: '会客室' };
        
        ['central', 'manufactA', 'manufactB', 'culture', 'meeting'].forEach(roomKey => {
            const d = queues[roomKey];
            if (!d) return;
            const roomName = ROOM_MAP[roomKey];
            const addRooms = (arr) => { 
                (arr || []).forEach(o => {
                    if (!o) return;
                    if (!topRoomMap[o.name]) topRoomMap[o.name] = new Set();
                    topRoomMap[o.name].add(roomName);
                }); 
            };
            addRooms(d.recommend); addRooms(d.round1); addRooms(d.round2);
        });

        if (Object.keys(topRoomMap).length === 0) {
            grid.innerHTML = '<p class="dev-empty">当前策略下无需干员（舱室可能为空置）</p>';
            return;
        }

        // 渲染干员卡片 (仅显示未满练的)
        let html = '';
        Object.keys(topRoomMap).forEach(name => {
            const entry = parseConfigEntry(config[name] || 'none');
            const isMax = entry.elite === '精四' && entry.talents.length === 4;
            
            // ★ 核心修改：跳过已满练干员
            if (isMax) return;

            const imgSrc = getAgentImgSrc(name);
            const roomStr = Array.from(topRoomMap[name]).join('/');
            
            html += `
                <div class="dev-top-card" data-name="${name}" title="顶配位置：${roomStr}">
                    <img src="${imgSrc}" onerror="this.onerror=null; this.src='${AVATAR_FALLBACK}';" alt="${name}">
                    <div class="name">${escapeHtml(name)}</div>
                    <div class="badge">需提升</div>
                </div>
            `;
        });
        
        // 如果全部已满练
        if (html === '') {
            html = '<p class="dev-empty" style="grid-column:1/-1; text-align:center; color:#3f7e6b; padding:20px 0;">🎉 顶配排班所需干员均已满练！</p>';
        }
        
        grid.innerHTML = html;

        // 绑定一键升级事件（必须绑在存在的元素上）
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
        if (entry.elite === '精四' && entry.talents.length === 4) return;

        const rawOpData = rawData[name] || {};
        const assignedRooms = topRoomMap[name] ? Array.from(topRoomMap[name]) : [];
        let missingDesc = [];
        
        if (entry.elite === 'none') missingDesc.push('未拥有该干员');
        else {
            if (entry.elite !== '精四') missingDesc.push(`等级提升至精四 (当前:${entry.elite})`);
            const currentTalents = new Set(entry.talents);
            
            TALENT_ORDER.forEach(tid => {
                if (!currentTalents.has(tid)) {
                    const tList = getTalentList(rawOpData, tid);
                    // 如果该干员在顶配里，只筛选对应舱室需要点出的天赋
                    const neededTraits = assignedRooms.length > 0 
                        ? tList.filter(t => assignedRooms.includes(t.舱室))
                        : tList;

                    if (neededTraits.length > 0) {
                        const tName = (neededTraits[0].name) ? neededTraits[0].name : tid;
                        const roomHint = assignedRooms.length > 0 ? `[${neededTraits[0].舱室}]` : '';
                        missingDesc.push(`天赋${roomHint}：${tName}`);
                    }
                }
            });
        }

        if (missingDesc.length === 0) return;

        const confirmMsg = `是否一键将【${name}】提升至精四满天赋？\n\n顶配排班中他将前往：${assignedRooms.join('、') || '任意舱室'}\n\n需要补充：\n${missingDesc.join('\n')}`;
        if (!confirm(confirmMsg)) return;

        config[name] = { elite: '精四', talents: ['1_1', '2_1', '1_2', '2_2'] };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));

        alert(`【${name}】已一键提升至满练状态！`);
        init();
    }

    // ========== 原有分析逻辑 ==========
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

        generateTopRecommendation(rawData, config);

        const recs = analyze(rawData, config);
        const summary = summarize(recs);

        renderOverview(ownedCount, summary);

        let currentRoom = 'all';
        render(recs, currentRoom);

        document.querySelectorAll('.dev-filter-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.dev-filter-btn').forEach(function (b) { b.classList.remove('active'); });
                this.classList.add('active');
                currentRoom = this.dataset.room;
                render(recs, currentRoom);
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    console.log('[提升建议] dev.js 已加载');
})();