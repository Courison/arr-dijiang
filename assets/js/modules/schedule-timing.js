/* ============================================================
   schedule-timing.js —— 稳态循环时间段推荐（v5 · 完整版）
   
   设计原则：
   1. 只针对开启二轮的舱室；单轮舱室推荐 00:00-24:00。
   2. 干员分配与 hA/hB 由 main.js 计算，本模块读取 DijiangLastQueues._timingInfo。
   3. 稳态下高效/低效组最优时长只取决于配置，与当前心情无关。
   4. 用户输入起点时刻（时、分，默认当前时间）与各舱室高效组最低心情。
   5. 总控高恢复段先确定（覆盖所有高效组休息段），在 [11h, 13h] 内选最优覆盖。
   6. 输出 0-24h 绝对数轴；跨夜自动拆两行，小在前。
   7. 培养舱时间安排以“优先级第一产物”为基准。
   8. 总控干员优先读取 main 排班结果，反映实际（含信赖干员）。
   ============================================================ */
(function () {
    'use strict';

    const C_WORK_BASE = 0.072;   // 7.2%/h
    const C_REST_BASE = 0.12;    // 12%/h

    const CENTRAL_DUR_MIN = 11;  // 总控最短恢复时长
    const CENTRAL_DUR_MAX = 13;  // 总控最长恢复时长

    const ROOM_KEYS = ['manufactA', 'manufactB', 'culture', 'meeting'];
    const ROOM_LABELS = {
        manufactA: '制造舱 A', manufactB: '制造舱 B',
        culture: '培养舱', meeting: '会客室', central: '总控中枢'
    };
    const ROOM_KEY_TO_NAME = {
        manufactA: '制造舱', manufactB: '制造舱',
        culture: '培养舱', meeting: '会客室', central: '总控中枢'
    };

    let rawData = null;
    let operatorMap = null;
    let lastResult = null;

    /* ================= 工具函数 ================= */
    function pad2(n) { return String(n).padStart(2, '0'); }

    function fmtHour(h) {
        if (h >= 24) return '24:00';
        h = ((h % 24) + 24) % 24;
        return pad2(h) + ':00';
    }

    function splitRange(startH, endH) {
        if (endH <= startH) return [];
        const total = endH - startH;
        if (total >= 24) return [{ start: 0, end: 24 }];
        const s = ((startH % 24) + 24) % 24;
        const e = s + total;
        if (e <= 24) return [{ start: s, end: e }];
        return [
            { start: 0, end: e - 24 },
            { start: s, end: 24 }
        ];
    }

    function renderRangeInline(rows) {
        if (!rows || rows.length === 0) return '—';
        return rows.map(r => `${fmtHour(r.start)}-${fmtHour(r.end)}`).join(' / ');
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
    }

    function talentBaseName(name) {
        return String(name || '').replace(/[·・][αβγ]$/, '').trim();
    }

    function renderTimeline(ranges) {
        let html = '<div class="ta-axis">';
        for (const r of ranges) {
            if (r.end <= r.start) continue;
            const leftPct = (r.start / 24) * 100;
            const widthPct = ((r.end - r.start) / 24) * 100;
            html += `<div class="${r.className}" style="left:${leftPct}%; width:${widthPct}%"></div>`;
        }
        html += '<div class="ta-labels">';
        for (let h = 0; h <= 24; h += 6) {
            html += `<span>${h === 24 ? '24:00' : pad2(h) + ':00'}</span>`;
        }
        html += '</div></div>';
        return html;
    }

    /* ================= 制造舱产品配置 ================= */
    function getManufactProductConfig() {
        let mA = 'exp', mB = 'weapon';
        try {
            const raw = sessionStorage.getItem('DijiangDefaultProduct');
            if (raw) {
                const p = JSON.parse(raw);
                if (p.manufactA === 'exp' || p.manufactA === 'weapon') mA = p.manufactA;
                if (p.manufactB === 'exp' || p.manufactB === 'weapon') mB = p.manufactB;
            }
        } catch (e) {}
        return { mA, mB };
    }

    // ★ 培养舱优先级第一的产物
    function getCultureFirstProduct() {
        try {
            const raw = sessionStorage.getItem('DijiangManualProduct');
            if (!raw) return null;
            const p = JSON.parse(raw);
            const c = p && p.culture;
            if (!c) return null;
            if (Array.isArray(c.priority) && c.priority.length > 0) return c.priority[0];
            if (Array.isArray(c.products) && c.products.length > 0) {
                const DEFAULT = ['plant', 'mineral', 'fungi'];
                for (const x of DEFAULT) if (c.products.includes(x)) return x;
                return c.products[0];
            }
            return null;
        } catch (e) { return null; }
    }

    /* ================= 干员构建 ================= */
    function buildOperator(name, elite) {
        const raw = rawData[name];
        if (!raw) return null;
        const levels = ['精一', '精二', '精三', '精四'];
        const idx = levels.indexOf(elite);
        if (idx < 0) return null;
        const op = {
            name, star: raw.star, attribute: raw.attribute, elite,
            rooms: {
                '制造舱': { reduce: 0, eff: { exp: 0, weapon: 0 } },
                '培养舱': { reduce: 0, eff: { mineral: 0, fungi: 0, plant: 0 } },
                '会客室': { reduce: 0, eff: { clue: 0 } },
                '总控中枢': { restore: 0 }
            }
        };
        const collected = {};
        for (let i = 0; i <= idx; i++) {
            for (const t of (raw[levels[i]] || [])) {
                const bn = talentBaseName(t.name) || (t.舱室 + '|' + t.类型);
                collected[bn] = t;
            }
        }
        for (const t of Object.values(collected)) {
            const val = (t.数值 || 0) / 100;
            const room = op.rooms[t.舱室];
            if (!room) continue;
            switch (t.类型) {
                case '心情消耗减少': room.reduce += val; break;
                case '心情恢复提升': room.restore += val; break;
                case '干员素材效率': room.eff.exp += val; break;
                case '武器素材效率': room.eff.weapon += val; break;
                case '矿物效率': room.eff.mineral += val; break;
                case '菌类效率': room.eff.fungi += val; break;
                case '晶植效率': room.eff.plant += val; break;
                case '收集线索效率': room.eff.clue += val; break;
            }
        }
        return op;
    }

    /* ================= 数据加载 ================= */
    async function loadAll() {
        if (!rawData) {
            rawData = await fetch('/Agent_characteristics.json', { cache: 'no-cache' }).then(r => r.json());
        }
        const configRaw = sessionStorage.getItem('DijiangScheduleConfig');
        if (!configRaw) throw new Error('尚未导入干员数据');
        const config = JSON.parse(configRaw);

        operatorMap = {};
        const order = rawData.operator_order || Object.keys(rawData).filter(k => k !== 'operator_order');
        for (const name of order) {
            const entry = config[name];
            if (!entry) continue;
            const elite = typeof entry === 'string' ? entry : entry.elite;
            if (!elite || elite === 'none') continue;
            const op = buildOperator(name, elite);
            if (op) operatorMap[name] = op;
        }

        const rawQ = sessionStorage.getItem('DijiangLastQueues');
        const rawD = sessionStorage.getItem('DijiangDoubleRooms');
        if (!rawQ) throw new Error('尚未生成自动排班，请先到主站生成排班结果');

        return { queues: JSON.parse(rawQ), doubleRooms: JSON.parse(rawD || '[]') };
    }

    /* ================= 舱室分析 ================= */
    function analyzeRoom(roomKey, queues, doubleRooms, cRestLow, cRestHigh, manufactCfg) {
        const q = queues[roomKey];
        if (!q) return null;
        const isDouble = doubleRooms.includes(roomKey);
        const roomName = ROOM_KEY_TO_NAME[roomKey];
        const r1 = isDouble ? (q.round1 || []) : (q.recommend || []);
        const r2 = isDouble ? (q.round2 || []) : [];

        // 制造舱：决定效率字段
        let effKey = null;
        if (roomKey === 'manufactA') effKey = (manufactCfg && manufactCfg.mA === 'weapon') ? 'weapon' : 'exp';
        else if (roomKey === 'manufactB') effKey = (manufactCfg && manufactCfg.mB === 'weapon') ? 'weapon' : 'exp';

        // 培养舱：只用优先级第一的产物
        let cultureFirstProduct = null;
        if (roomKey === 'culture') {
            cultureFirstProduct = getCultureFirstProduct();
        }

        function calcGroup(list) {
            let e_sum = 0, d_sum = 0;
            const ops = [];
            for (const item of list) {
                const name = item.name || item;
                const op = operatorMap[name];
                if (!op) continue;
                ops.push(op);
                const room = op.rooms[roomName];
                if (room) {
                    d_sum += room.reduce || 0;
                    if (roomKey === 'manufactA' || roomKey === 'manufactB') {
                        if (effKey) e_sum += room.eff[effKey] || 0;
                    } else if (roomKey === 'culture') {
                        if (cultureFirstProduct) {
                            e_sum += room.eff[cultureFirstProduct] || 0;
                        } else {
                            e_sum += Math.max(room.eff.mineral || 0, room.eff.fungi || 0, room.eff.plant || 0);
                        }
                    } else if (roomKey === 'meeting') {
                        e_sum += room.eff.clue || 0;
                    }
                }
            }
            const N = ops.length;
            const c_work = C_WORK_BASE * Math.max(0.01, 1 - d_sum);
            return { ops, N, E: e_sum, d_sum, c_work, rate: (1 + e_sum) * (1 + 0.4 * N) };
        }

        const g1 = calcGroup(r1);
        const g2 = calcGroup(r2);

        if (r2.length === 0) {
            return {
                roomKey, isSingle: true, isDouble,
                mainRound1: g1, mainRound2: null,
                efficient: g1, inefficient: null,
                loop: null,
                effKey,
                cultureFirstProduct
            };
        }

        let efficient, inefficient;
        if (g1.rate >= g2.rate) { efficient = g1; inefficient = g2; }
        else { efficient = g2; inefficient = g1; }

        let loop;
        const timingInfo = queues._timingInfo && queues._timingInfo[roomKey];
        if (timingInfo) {
            loop = {
                feasible: true,
                hA: timingInfo.hA,
                hB: timingInfo.hB,
                cA: timingInfo.cA,
                cB: timingInfo.cB,
                rA: timingInfo.rA,
                rB: timingInfo.rB
            };
        } else {
            loop = computeSteadyLoop(efficient, inefficient, cRestLow, cRestHigh);
        }

        return {
            roomKey, isSingle: false, isDouble,
            mainRound1: g1, mainRound2: g2,
            efficient, inefficient, loop,
            effKey,
            cultureFirstProduct
        };
    }

    /* ================= 稳态循环求解（兼容旧数据） ================= */
    function computeSteadyLoop(A, B, cRestLow, cRestHigh) {
        const cA = A.c_work;
        const cB = B.c_work;
        const rA = A.rate;
        const rB = B.rate;

        const hA_workMax = 1.0 / cA;
        const hB_workMax = 1.0 / cB;

        const hA_restoreMax = 24 * cRestHigh / (cA + cRestHigh);
        const hA_restoreMin = 24 * cB / (cB + cRestLow);

        const hA_min = Math.max(hA_restoreMin, 24 - hB_workMax);
        const hA_max = Math.min(hA_restoreMax, hA_workMax);

        if (hA_min > hA_max) {
            return { feasible: false, cA, cB, rA, rB, hA_min, hA_max };
        }

        const hA_opt = Math.max(1, Math.min(23, Math.floor(hA_max)));
        const hB_opt = 24 - hA_opt;

        return {
            feasible: true,
            hA: hA_opt, hB: hB_opt,
            hA_min, hA_max,
            cA, cB, rA, rB
        };
    }

    /* ================= 总控分析 ================= */
    // ★ 优先读 main 排班结果里总控的实际干员（含信赖干员）
    function analyzeCentral(usedNames, queues) {
        let r1Names = [], r2Names = [];
        if (queues && queues.central) {
            r1Names = (queues.central.round1 || []).map(x => (x && x.name) || x).filter(Boolean);
            r2Names = (queues.central.round2 || []).map(x => (x && x.name) || x).filter(Boolean);
        }
        const usedInCentral = [...new Set([...r1Names, ...r2Names])];

        if (usedInCentral.length > 0) {
            const ops = usedInCentral.map(n => operatorMap[n]).filter(Boolean);
            if (ops.length > 0) {
                ops.sort((a, b) => b.rooms['总控中枢'].restore - a.rooms['总控中枢'].restore);
                const high = ops.slice(0, 3);
                const low = ops.slice(3, 6);
                return {
                    high, low,
                    g_high: high.reduce((s, op) => s + op.rooms['总控中枢'].restore, 0),
                    g_low: low.reduce((s, op) => s + op.rooms['总控中枢'].restore, 0),
                    fromQueues: true
                };
            }
        }

        // 兜底：从全局可用干员里按 restore 挑
        const available = Object.values(operatorMap).filter(op => !usedNames.has(op.name));
        const withRestore = available.filter(op => (op.rooms['总控中枢'].restore || 0) > 0);
        withRestore.sort((a, b) => b.rooms['总控中枢'].restore - a.rooms['总控中枢'].restore);
        const high = withRestore.slice(0, 3);
        const low = withRestore.slice(3, 6);
        return {
            high, low,
            g_high: high.reduce((s, op) => s + op.rooms['总控中枢'].restore, 0),
            g_low: low.reduce((s, op) => s + op.rooms['总控中枢'].restore, 0),
            fromQueues: false
        };
    }

    /* ================= 心情输入区 ================= */
    function renderMoodInputs(roomAnalyses) {
        const container = document.getElementById('timingRInputs');
        if (!container) return;
        const eligible = roomAnalyses.filter(ra => !ra.isSingle);
        if (eligible.length === 0) {
            container.innerHTML = '<div class="timing-hint-line">所有舱室均为单轮，无需输入心情。</div>';
            return;
        }
        let html = '<div class="timing-input-title">请检查各舱室高效组的最低心情（默认 100%）</div>';
        for (const ra of eligible) {
            const label = ROOM_LABELS[ra.roomKey];
            const names = ra.efficient.ops.map(o => o.name).join('、') || '—';
            const inputId = 'timingMood_' + ra.roomKey;
            const prev = document.getElementById(inputId);
            const val = prev && prev.value !== '' ? prev.value : '100';
            html += `<div class="timing-input-row">
                <div class="timing-input-label">
                    <span class="timing-room-name">${label}</span>
                    <span class="timing-room-ops">高效组：${escapeHtml(names)}</span>
                </div>
                <div class="timing-input-fields">
                    <input type="number" id="${inputId}" min="1" max="100" value="${val}">
                    <span>%</span>
                </div>
            </div>`;
        }
        container.innerHTML = html;
    }

    function getMoodInputs(roomAnalyses) {
        const moods = {};
        for (const ra of roomAnalyses) {
            const input = document.getElementById('timingMood_' + ra.roomKey);
            if (!input || input.value === '') {
                moods[ra.roomKey] = 1.0;
            } else {
                const v = parseFloat(input.value);
                moods[ra.roomKey] = isNaN(v) ? 1.0 : Math.max(1, Math.min(100, v)) / 100;
            }
        }
        return moods;
    }

    /* ================= 总控高恢复段 ================= */
    function computeCentralPeriod(roomAnalyses, moods, t0) {
        const eligible = roomAnalyses.filter(ra => !ra.isSingle && ra.loop && ra.loop.feasible);
        if (eligible.length === 0) return null;

        const intervals = eligible.map(ra => {
            const mood = moods[ra.roomKey] || 1.0;
            const firstWork = Math.min(ra.loop.hA, mood / ra.loop.cA);
            const restStart = t0 + firstWork;
            const restDur = ra.loop.hB;
            return {
                roomKey: ra.roomKey,
                restStart,
                restEnd: restStart + restDur,
                restDur
            };
        });

        const minDur = Math.max(...intervals.map(i => i.restDur));

        // ★ clamp 到 [11, 13]
        let cDur = Math.ceil(minDur);
        if (cDur < CENTRAL_DUR_MIN) cDur = CENTRAL_DUR_MIN;
        if (cDur > CENTRAL_DUR_MAX) cDur = CENTRAL_DUR_MAX;

        const earliestRest = Math.min(...intervals.map(i => i.restStart));
        let cStart = Math.floor(earliestRest);
        if (cStart < t0) cStart = Math.ceil(t0);

        const latestRestEnd = Math.max(...intervals.map(i => i.restEnd));
        if (cStart + cDur < latestRestEnd) {
            cStart = Math.ceil(latestRestEnd - cDur);
            if (cStart < t0) cStart = Math.ceil(t0);
        }

        cStart = ((cStart % 24) + 24) % 24;

        return {
            start: cStart,
            duration: cDur,
            end: cStart + cDur
        };
    }

    /* ================= 单舱时段 ================= */
    function computeRoomPeriods(ra, centralPeriod) {
        if (ra.isSingle) {
            return {
                single: true,
                efficient: [{ start: 0, end: 24 }],
                inefficient: []
            };
        }
        if (!ra.loop || !ra.loop.feasible || !centralPeriod) {
            return { infeasible: true };
        }

        const restStart = centralPeriod.start;
        const restEnd = restStart + ra.loop.hB;

        const effRows = splitRange(restEnd, restStart + 24);
        const ineffRows = splitRange(restStart, restEnd);
        return { efficient: effRows, inefficient: ineffRows };
    }

    /* ================= 渲染结果 ================= */
    function renderResult(result) {
        const container = document.getElementById('timingResult');
        if (!container) return;
        const { roomAnalyses, central, centralPeriod, t0H, t0M } = result;

        let html = '';
        html += `<div class="timing-overview">
            <div class="timing-overview-title">📋 稳态循环时段推荐</div>
            <div class="timing-overview-sub">
                时段为 0-24 小时绝对时间轴，整点切换。高效组与低效组交替工作，稳态下可长期使用。
            </div>
        </div>`;

        if (centralPeriod) {
            const highRows = splitRange(centralPeriod.start, centralPeriod.end);
            const lowRows = splitRange(centralPeriod.end, centralPeriod.start + 24);
            html += '<div class="timing-section-title">总控中枢高恢复段</div>';
            html += `<div class="timing-central">
                <div class="timing-setting">
                    <div class="timing-setting-row">
                        <span class="timing-setting-label">高恢复组工作</span>
                        <span class="timing-setting-value">${renderRangeInline(highRows)}（${centralPeriod.duration}h）</span>
                    </div>
                    <div class="timing-setting-row">
                        <span class="timing-setting-label">低恢复组工作</span>
                        <span class="timing-setting-value">${renderRangeInline(lowRows)}（${24 - centralPeriod.duration}h）</span>
                    </div>
                </div>
                <div class="timing-central-row">
                    <span class="timing-tag timing-tag-high">高恢复组（+${(central.g_high * 100).toFixed(0)}%）</span>
                    <span class="timing-dur">${central.high.map(o => o.name).join('、') || '—'}</span>
                </div>
                <div class="timing-central-row">
                    <span class="timing-tag timing-tag-low">低恢复组（+${(central.g_low * 100).toFixed(0)}%）</span>
                    <span class="timing-dur">${central.low.map(o => o.name).join('、') || '—'}</span>
                </div>
                ${renderTimeline([
                    ...highRows.map(r => ({ ...r, className: 'ta-high' })),
                    ...lowRows.map(r => ({ ...r, className: 'ta-low' }))
                ])}
                <div class="timing-central-note">
                    起点时刻：${pad2(t0H)}:${pad2(t0M)}（用户输入）｜总控段 ${centralPeriod.duration}h（可选 11-13h）
                </div>
            </div>`;
        }

        html += '<div class="timing-section-title">各舱推荐时段</div>';
        html += '<div class="timing-room-list">';
        for (const ra of roomAnalyses) {
            let label = ROOM_LABELS[ra.roomKey];
            // ★ 制造舱显示当前产品
            if (ra.roomKey === 'manufactA' || ra.roomKey === 'manufactB') {
                const prodName = (ra.effKey === 'weapon') ? '武器' : '干员';
                label = `${label}（${prodName}）`;
            }
            // ★ 培养舱显示当前时间基准产物
            if (ra.roomKey === 'culture' && ra.cultureFirstProduct) {
                const prodMap = { mineral: '矿物', fungi: '菌类', plant: '晶植' };
                label = `${label}（基准：${prodMap[ra.cultureFirstProduct] || ra.cultureFirstProduct}）`;
            }

            if (ra.isSingle) {
                html += `<div class="timing-room-item">
                    <div class="timing-room-item-header">
                        <span class="timing-room-name">${label}</span>
                        <span class="timing-badge-single">单轮</span>
                    </div>
                    <div class="timing-setting">
                        <div class="timing-setting-row">
                            <span class="timing-setting-label">全程工作</span>
                            <span class="timing-setting-value">00:00-24:00</span>
                        </div>
                    </div>
                    <div class="timing-room-item-body">
                        <div>干员：${escapeHtml(ra.efficient.ops.map(o => o.name).join('、') || '—')}</div>
                    </div>
                    ${renderTimeline([{ start: 0, end: 24, className: 'ta-eff' }])}
                </div>`;
                continue;
            }

            if (!ra.loop || !ra.loop.feasible) {
                html += `<div class="timing-room-item">
                    <div class="timing-room-item-header"><span class="timing-room-name">${label}</span></div>
                    <div class="timing-room-item-body" style="color:#c0392b;">
                        无可行稳态：请检查干员配置或心情输入
                    </div>
                </div>`;
                continue;
            }

            const periods = computeRoomPeriods(ra, centralPeriod);
            const effNames = ra.efficient.ops.map(o => o.name).join('、') || '—';
            const ineffNames = ra.inefficient.ops.map(o => o.name).join('、') || '—';

            let r1Rows, r2Rows;
            if (ra.mainRound1 === ra.efficient) {
                r1Rows = periods.efficient;
                r2Rows = periods.inefficient;
            } else {
                r1Rows = periods.inefficient;
                r2Rows = periods.efficient;
            }

            html += `<div class="timing-room-item">
                <div class="timing-room-item-header">
                    <span class="timing-room-name">${label}</span>
                    <span class="timing-switch-time">稳态 hA=${ra.loop.hA}h / hB=${ra.loop.hB}h</span>
                </div>
                <div class="timing-setting">
                    <div class="timing-setting-row">
                        <span class="timing-setting-label">轮次一</span>
                        <span class="timing-setting-value">${renderRangeInline(r1Rows)}</span>
                    </div>
                    <div class="timing-setting-row">
                        <span class="timing-setting-label">轮次二</span>
                        <span class="timing-setting-value">${renderRangeInline(r2Rows)}</span>
                    </div>
                </div>
                <div class="timing-room-item-body">
                    <div>高效组：${escapeHtml(effNames)}</div>
                    <div style="color:#888; margin-top:3px;">低效组：${escapeHtml(ineffNames)}</div>
                </div>
                ${renderTimeline([
                    ...periods.efficient.map(r => ({ ...r, className: 'ta-eff' })),
                    ...periods.inefficient.map(r => ({ ...r, className: 'ta-trans' }))
                ])}
            </div>`;
        }
        html += '</div>';

        container.innerHTML = html;
    }

    /* ================= 主流程 ================= */
    async function run() {
        const resultDiv = document.getElementById('timingResult');
        if (!resultDiv) return;
        resultDiv.innerHTML = '<p style="color:#888;">计算稳态循环…</p>';

        let loaded;
        try {
            loaded = await loadAll();
        } catch (e) {
            resultDiv.innerHTML = `<p style="color:#c0392b;">${escapeHtml(e.message)}</p>`;
            return;
        }

        const t0HInput = document.getElementById('timingStartHour');
        const t0MInput = document.getElementById('timingStartMinute');
        const now = new Date();
        let t0H = t0HInput ? parseInt(t0HInput.value, 10) : now.getHours();
        let t0M = t0MInput ? parseInt(t0MInput.value, 10) : now.getMinutes();
        if (isNaN(t0H)) t0H = now.getHours();
        if (isNaN(t0M)) t0M = now.getMinutes();
        t0H = Math.max(0, Math.min(23, t0H));
        t0M = Math.max(0, Math.min(59, t0M));
        const t0 = t0H + t0M / 60;

        const tempUsed = new Set();
        for (const roomKey of ROOM_KEYS) {
            const q = loaded.queues[roomKey];
            if (!q) continue;
            const isD = loaded.doubleRooms.includes(roomKey);
            const list = isD ? [...(q.round1 || []), ...(q.round2 || [])] : (q.recommend || []);
            for (const item of list) {
                const n = item.name || item;
                if (n) tempUsed.add(n);
            }
        }
        const tempCentral = analyzeCentral(tempUsed, loaded.queues);
        const cRestLow = C_REST_BASE * (1 + tempCentral.g_low);
        const cRestHigh = C_REST_BASE * (1 + tempCentral.g_high);

        const manufactCfg = getManufactProductConfig();

        const roomAnalyses = [];
        const usedNames = new Set();
        for (const roomKey of ROOM_KEYS) {
            const ra = analyzeRoom(roomKey, loaded.queues, loaded.doubleRooms, cRestLow, cRestHigh, manufactCfg);
            if (!ra) continue;
            roomAnalyses.push(ra);
            for (const op of ra.efficient.ops) usedNames.add(op.name);
            if (ra.inefficient) for (const op of ra.inefficient.ops) usedNames.add(op.name);
        }

        const central = analyzeCentral(usedNames, loaded.queues);

        renderMoodInputs(roomAnalyses);
        const moods = getMoodInputs(roomAnalyses);

        const centralPeriod = computeCentralPeriod(roomAnalyses, moods, t0);

        const result = {
            roomAnalyses, central, centralPeriod,
            cRestLow, cRestHigh, moods,
            t0H, t0M,
            manufactCfg
        };
        lastResult = result;
        renderResult(result);
    }

    /* ================= 对外接口 ================= */
    // ★ 供导出排班图读取某舱某轮次的推荐时段
    function getRoomPeriods(roomKey) {
        if (!lastResult) return null;

        // 总控中枢特殊处理
        if (roomKey === 'central') {
            if (!lastResult.centralPeriod) return null;
            const cp = lastResult.centralPeriod;
            const highRows = splitRange(cp.start, cp.end);
            const lowRows  = splitRange(cp.end, cp.start + 24);

            let r1IsHigh = true;
            try {
                const raw = sessionStorage.getItem('DijiangLastQueues');
                if (raw) {
                    const q = JSON.parse(raw);
                    const r1List = (q.central && q.central.round1) || [];
                    const highNames = new Set(lastResult.central.high.map(o => o.name));
                    let inter = 0;
                    for (const item of r1List) {
                        const n = item.name || item;
                        if (highNames.has(n)) inter++;
                    }
                    if (r1List.length >= 2) r1IsHigh = inter >= Math.ceil(r1List.length / 2);
                }
            } catch (e) {}

            return {
                single: false,
                isCentral: true,
                round1: r1IsHigh ? highRows : lowRows,
                round2: r1IsHigh ? lowRows  : highRows
            };
        }

        const ra = lastResult.roomAnalyses.find(r => r.roomKey === roomKey);
        if (!ra) return null;
        if (ra.isSingle) {
            return { single: true, round1: [{ start: 0, end: 24 }], round2: null };
        }
        if (!ra.loop || !ra.loop.feasible || !lastResult.centralPeriod) return null;
        const periods = computeRoomPeriods(ra, lastResult.centralPeriod);
        let r1Rows, r2Rows;
        if (ra.mainRound1 === ra.efficient) {
            r1Rows = periods.efficient;
            r2Rows = periods.inefficient;
        } else {
            r1Rows = periods.inefficient;
            r2Rows = periods.efficient;
        }
        return { single: false, round1: r1Rows, round2: r2Rows };
    }

    window.DijiangTiming = {
        run: run,
        getLastResult: () => lastResult,
        getRoomPeriods: getRoomPeriods
    };

    /* ================= 绑定 ================= */
    function initTimeInputs() {
        const now = new Date();
        const h = document.getElementById('timingStartHour');
        const m = document.getElementById('timingStartMinute');
        if (h && !h.dataset.touched) h.value = now.getHours();
        if (m && !m.dataset.touched) m.value = now.getMinutes();
        if (h) h.addEventListener('input', () => { h.dataset.touched = '1'; });
        if (m) m.addEventListener('input', () => { m.dataset.touched = '1'; });
    }

    function bind() {
        const btn = document.getElementById('runTimingBtn');
        if (btn) btn.addEventListener('click', run);
        initTimeInputs();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }

    console.log('[时间段] schedule-timing.js 已加载（稳态循环 · v5）');
})();