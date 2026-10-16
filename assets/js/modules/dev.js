/* ============================================================
   dev.js —— 专精建议页
   独立实现头像工具、天赋解析、分析算法
   不依赖 main.js
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
    const ROOM_ORDER = ['总控中枢', '制造舱', '培养舱', '会客室'];
    const STORAGE_KEY = 'DijiangScheduleConfig';
    const AVATAR_FALLBACK = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" fill="#eaeaea"/><text x="50%" y="54%" text-anchor="middle" font-size="20" fill="#999">?</text></svg>'
    );

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

    // ========== 天赋工具（与 main.js 保持一致） ==========
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

    // ========== 头像（精灵图，B 方案精简版） ==========
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
                console.log('[专精建议·精灵图] 已加载 ' + Object.keys(spriteIndex.agents || {}).length + ' 个干员');
            } catch (e) {
                spriteReady = false;
                console.warn('[专精建议·精灵图] 加载失败，回退单张头像：', e);
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

    // ========== 分析 ==========
    function analyze(rawData, config) {
        const recommendations = {};
        ROOM_ORDER.forEach(r => recommendations[r] = []);
    
        for (const [name, val] of Object.entries(config)) {
            const opData = rawData[name];
            if (!opData) continue;
            const entry = parseConfigEntry(val);
            const curRank = ELITE_RANK[entry.elite];
            if (curRank === 0) continue;   // 未拥有
    
            const activated = new Set(entry.talents);
    
            // byRoom[room][type] = { type, targetElite, traits: [] }
            // type ∈ { '补点', '升级' }
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
    
                    // 升级类型：targetElite 取该 room+type 下的最高需求等级
                    if (isUpgrade) {
                        const cur = byRoom[room][type].targetElite;
                        const curRankNum = cur ? ELITE_RANK[cur] : 0;
                        if (ELITE_RANK[meta.label] > curRankNum) {
                            byRoom[room][type].targetElite = meta.label;
                        }
                    }
    
                    byRoom[room][type].traits.push(Object.assign({ _tid: tid }, t));
                }
            }
    
            // 每种 (room, type) 各生成一条推荐
            for (const [room, typeMap] of Object.entries(byRoom)) {
                for (const info of Object.values(typeMap)) {
                    recommendations[room].push({
                        name: name,
                        star: opData.star || '未知',
                        attribute: opData.attribute || '未知',
                        elite: entry.elite,
                        targetElite: info.targetElite,
                        type: info.type,
                        traits: info.traits,
                    });
                }
            }
        }
    
        // 排序：补点 > 升级；同类型内数值降序；等级差升序
        for (const room of ROOM_ORDER) {
            recommendations[room].sort((a, b) => {
                // 1. 补点优先于升级
                if (a.type !== b.type) return a.type === '补点' ? -1 : 1;
                // 2. 数值大优先
                const aMax = Math.max.apply(null, a.traits.map(t => t.数值 || 0));
                const bMax = Math.max.apply(null, b.traits.map(t => t.数值 || 0));
                if (aMax !== bMax) return bMax - aMax;
                // 3. 等级差小优先（升级类）
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
        return { total: total, upgrades: upgrades, points: points };
    }

    // ========== 渲染 ==========
    function renderItem(item) {
        const badge = item.type === '升级'
            ? '<span class="dev-badge upgrade">升级</span>'
            : '<span class="dev-badge point">补点</span>';
        const eliteInfo = item.type === '升级'
            ? escapeHtml(item.elite) + ' → ' + escapeHtml(item.targetElite)
            : escapeHtml(item.elite) + ' <span class="dev-elite-note">(已解锁·未激活)</span>';

        const imgSrc = getAgentImgSrc(item.name);
        const traitList = item.traits.map(function (t) {
            const icon = getTalentIconPath([t]);
            const iconTag = icon
                ? '<img src="' + icon + '" class="dev-trait-icon" onerror="this.style.display=\'none\';" alt="">'
                : '';
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

        if (shownCount === 0) {
            html = '<p class="dev-empty">暂无推荐，该筛选下没有可提升项 🎉</p>';
        }
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
        document.getElementById('devContent').innerHTML =
            '<div class="dev-empty-box">' +
                '<p>⚠️ 尚未导入干员数据</p>' +
                '<p>请先前往「自动排班」页，点击右上角「干员数据设置」导入你的干员库。</p>' +
                '<a class="dev-go-btn" href="/">前往自动排班 →</a>' +
            '</div>';
    }

    // ========== 启动 ==========
    async function init() {
        // 先加载精灵图（失败不影响主流程，会回退单张）
        await loadSprite();

        const rawConfig = sessionStorage.getItem(STORAGE_KEY);
        if (!rawConfig) { showEmpty(); return; }

        let config;
        try {
            config = JSON.parse(rawConfig);
        } catch (e) {
            showEmpty();
            return;
        }
        if (!config || typeof config !== 'object') { showEmpty(); return; }

        // 统计已拥有
        let ownedCount = 0;
        for (const val of Object.values(config)) {
            if (parseConfigEntry(val).elite !== 'none') ownedCount++;
        }
        if (ownedCount === 0) { showEmpty(); return; }

        // 读干员数据
        let rawData;
        try {
            const res = await fetch('/Agent_characteristics.json', { cache: 'no-cache' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            rawData = await res.json();
        } catch (e) {
            document.getElementById('devContent').innerHTML =
                '<p class="dev-error">干员数据加载失败，请刷新重试。</p>';
            return;
        }
        if (!rawData || Object.keys(rawData).length === 0) {
            document.getElementById('devContent').innerHTML =
                '<p class="dev-error">干员数据为空。</p>';
            return;
        }

        // 分析
        const recs = analyze(rawData, config);
        const summary = summarize(recs);

        // 渲染总览
        renderOverview(ownedCount, summary);

        // 初始渲染（全部）
        let currentRoom = 'all';
        render(recs, currentRoom);

        // 筛选按钮
        document.querySelectorAll('.dev-filter-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.dev-filter-btn').forEach(function (b) {
                    b.classList.remove('active');
                });
                this.classList.add('active');
                currentRoom = this.dataset.room;
                render(recs, currentRoom);
            });
        });
    }

    // 等待 DOM 就绪
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    console.log('[专精建议] dev.js 已加载');
})();