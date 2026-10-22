/* ============================================================
   schedule-timing.js —— 稳态循环时间段推荐（v6.6 · 完整自动版）
   
   设计原则：
   1. 单轮舱室根据情况计算；空置舱室跳过。
   2. 移除了心情输入，起点时刻高效组立即开始休息。
   3. 用户输入起点分钟：<=20分取当前整点；>20分取下一整点。
   4. 通过正向遍历并比较 t 与 t+1 的产出，精确找到产出最大的单峰极值点。
   5. 单轮总控视作二轮计算（低恢复组加成为0%），推荐能覆盖其它舱室休息的工作时长。
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
        if (typeof h !== 'number' || isNaN(h)) return '00:00';
        if (h === 24) return '24:00';
        h = ((h % 24) + 24) % 24;
        return pad2(Math.floor(h)) + ':00';
    }

    function splitRange(startH, endH) {
        if (typeof startH !== 'number' || typeof endH !== 'number') return [];
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
        const rawM = sessionStorage.getItem('DijiangRoomModes');
        if (!rawQ) throw new Error('尚未生成自动排班，请先到主站生成排班结果');

        return { 
            queues: JSON.parse(rawQ), 
            doubleRooms: JSON.parse(rawD || '[]'),
            roomModes: rawM ? JSON.parse(rawM) : {}
        };
    }

    /* ================= 舱室分析 ================= */
    function analyzeRoom(roomKey, queues, roomModes, doubleRooms, cRestLow, cRestHigh, manufactCfg) {
        const q = queues[roomKey];
        if (!q) return null;

        const mode = roomModes && roomModes[roomKey] ? roomModes[roomKey] : (doubleRooms.includes(roomKey) ? 'double' : 'single');
        const isSingle = mode === 'single';
        const roomName = ROOM_KEY_TO_NAME[roomKey];
        
        const r1 = isSingle ? (q.recommend || []) : (q.round1 || []);
        const r2 = isSingle ? [] : (q.round2 || []);

        let effKey = null;
        if (roomKey === 'manufactA') effKey = (manufactCfg && manufactCfg.mA === 'weapon') ? 'weapon' : 'exp';
        else if (roomKey === 'manufactB') effKey = (manufactCfg && manufactCfg.mB === 'weapon') ? 'weapon' : 'exp';

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

        if (isSingle) {
            return {
                roomKey, isSingle: true, isDouble: false,
                mainRound1: g1, mainRound2: null,
                efficient: g1, inefficient: null,
                loop: null, effKey, cultureFirstProduct,
                isRound1Efficient: true,
                effRestDur: 0
            };
        }

        let efficient, inefficient;
        let isRound1Efficient = g1.rate >= g2.rate;
        
        const timingInfo = queues._timingInfo && queues._timingInfo[roomKey];
        if (timingInfo && typeof timingInfo.round1IsEfficient === 'boolean') {
            isRound1Efficient = timingInfo.round1IsEfficient;
        }

        if (isRound1Efficient) { 
            efficient = g1; inefficient = g2; 
        } else { 
            efficient = g2; inefficient = g1; 
        }

        // 使用当前真实的恢复参数重新遍历寻优
        let loop = computeSteadyLoop(efficient, inefficient, cRestLow, cRestHigh);
        
        let effRestDur = 0;
        if (loop && loop.feasible && typeof loop.hA === 'number' && typeof loop.hB === 'number') {
            // 高效组的休息时长 = 低效组的工作时长
            effRestDur = isRound1Efficient ? loop.hB : loop.hA;
        }

        return {
            roomKey, isSingle: false, isDouble: true,
            mainRound1: g1, mainRound2: g2,
            efficient, inefficient, loop,
            effKey, cultureFirstProduct,
            isRound1Efficient,
            effRestDur
        };
    }

    /* ================= 稳态循环求解（正向比价寻优版） ================= */
    function computeSteadyLoop(A, B, cRestLow, cRestHigh) {
        const cWorkHigh = A.c_work;
        const cWorkLow = B.c_work;
        const rHigh = A.rate;
        const rLow = B.rate;

        // 1. 先找到第一个能维持循环的可行解
        let firstFeasible = -1;
        for (let hHigh = 1; hHigh <= 23; hHigh++) {
            const hLow = 24 - hHigh;
            const effHighWork = Math.min(hHigh, 1.0 / cWorkHigh);
            const effLowWork  = Math.min(hLow,  1.0 / cWorkLow);

            const highConsume = effHighWork * cWorkHigh;
            const highRestore = hLow * cRestHigh;
            if (highConsume > highRestore + 1e-6) continue;

            const lowConsume = effLowWork * cWorkLow;
            const lowRestore = hHigh * cRestLow;
            if (lowConsume > lowRestore + 1e-6) continue;

            firstFeasible = hHigh;
            break;
        }

        if (firstFeasible === -1) {
            return { feasible: false, cA: cWorkHigh, cB: cWorkLow, rA: rHigh, rB: rLow };
        }

        // 2. 从可行解开始，计算 t 与 t+1 的效率，直到效率下降或无法循环
        let bestHHigh = firstFeasible;
        let bestOutput = -1;

        for (let hHigh = firstFeasible; hHigh <= 23; hHigh++) {
            const hLow = 24 - hHigh;
            const effHighWork = Math.min(hHigh, 1.0 / cWorkHigh);
            const effLowWork  = Math.min(hLow,  1.0 / cWorkLow);

            const highConsume = effHighWork * cWorkHigh;
            const highRestore = hLow * cRestHigh;
            const lowConsume = effLowWork * cWorkLow;
            const lowRestore = hHigh * cRestLow;
            
            if (highConsume > highRestore + 1e-6 || lowConsume > lowRestore + 1e-6) {
                break;
            }

            const output = rHigh * effHighWork + rLow * effLowWork;

            if (output > bestOutput) {
                bestOutput = output;
                bestHHigh = hHigh;
            } else {
                break;
            }
        }

        return {
            feasible: true,
            hA: bestHHigh, 
            hB: 24 - bestHHigh,
            cA: cWorkHigh, cB: cWorkLow,
            rA: rHigh, rB: rLow
        };
    }

    /* ================= 总控分析 ================= */
    function analyzeCentral(usedNames, queues, roomModes) {
        if (roomModes && roomModes.central === 'empty') {
            return { high: [], low: [], round1: [], round2: [], g_high: 0, g_low: 0, isSingle: false, isEmpty: true, isRound1High: true };
        }

        let r1Names = [], r2Names = [];
        if (queues && queues.central) {
            r1Names = (queues.central.round1 || []).map(x => (x && x.name) || x).filter(Boolean);
            r2Names = (queues.central.round2 || []).map(x => (x && x.name) || x).filter(Boolean);
        }
        
        if (roomModes && roomModes.central === 'single') {
            if (r1Names.length === 0 && queues && queues.central) {
                r1Names = (queues.central.recommend || []).map(x => (x && x.name) || x).filter(Boolean);
            }
            const ops = r1Names.map(n => operatorMap[n]).filter(Boolean);
            const g_high = ops.reduce((s, op) => s + op.rooms['总控中枢'].restore, 0);
            return {
                high: ops, low: [],
                round1: ops, round2: [],
                g_high, g_low: 0,
                isSingle: true, isEmpty: false, isRound1High: true
            };
        }

        if (r1Names.length > 0 || r2Names.length > 0) {
            const ops1 = r1Names.map(n => operatorMap[n]).filter(Boolean);
            const ops2 = r2Names.map(n => operatorMap[n]).filter(Boolean);
            const g1 = ops1.reduce((s, op) => s + op.rooms['总控中枢'].restore, 0);
            const g2 = ops2.reduce((s, op) => s + op.rooms['总控中枢'].restore, 0);

            const isRound1High = g1 >= g2;
            
            let high, low;
            if (isRound1High) { high = ops1; low = ops2; } 
            else { high = ops2; low = ops1; }

            return {
                high, low,
                round1: ops1, round2: ops2,
                g_high: isRound1High ? g1 : g2,
                g_low: isRound1High ? g2 : g1,
                isSingle: false, isEmpty: false, isRound1High
            };
        }

        // 兜底：如果没排班数据则从可用人员里取
        const available = Object.values(operatorMap).filter(op => !usedNames.has(op.name));
        const withRestore = available.filter(op => (op.rooms['总控中枢'].restore || 0) > 0);
        withRestore.sort((a, b) => b.rooms['总控中枢'].restore - a.rooms['总控中枢'].restore);
        const high = withRestore.slice(0, 3);
        const low = withRestore.slice(3, 6);
        return {
            high, low,
            round1: high, round2: low,
            g_high: high.reduce((s, op) => s + op.rooms['总控中枢'].restore, 0),
            g_low: low.reduce((s, op) => s + op.rooms['总控中枢'].restore, 0),
            isSingle: false, isEmpty: false, isRound1High: true
        };
    }

    /* ================= 渲染结果 ================= */
    function renderResult(result) {
        const container = document.getElementById('timingResult');
        if (!container) return;
        const { roomAnalyses, central, centralPeriod, t0H } = result;

        let html = '';
        html += `<div class="timing-overview">
            <div class="timing-overview-title">📋 稳态循环时段推荐</div>
            <div class="timing-overview-sub">
                时段为 0-24 小时绝对时间轴，整点切换。高效组先休息，总控高恢复组先工作。
            </div>
        </div>`;

        if (!central.isEmpty) {
            if (centralPeriod) {
                const highRows = splitRange(centralPeriod.start, centralPeriod.end);
                const lowRows = splitRange(centralPeriod.end, centralPeriod.start + 24);
                html += `<div class="timing-section-title">总控中枢${central.isSingle ? '（单轮）' : '高恢复段'}</div>`;
                html += `<div class="timing-central">
                    <div class="timing-setting">
                        <div class="timing-setting-row">
                            <span class="timing-setting-label">${central.isSingle ? '工作时段' : '高恢复组工作'}</span>
                            <span class="timing-setting-value">${renderRangeInline(highRows)}（${centralPeriod.duration}h）</span>
                        </div>
                        ${!central.isSingle ? `
                        <div class="timing-setting-row">
                            <span class="timing-setting-label">低恢复组工作</span>
                            <span class="timing-setting-value">${renderRangeInline(lowRows)}（${24 - centralPeriod.duration}h）</span>
                        </div>` : ''}
                    </div>
                    <div class="timing-central-row">
                        <span class="timing-tag timing-tag-high">高恢复组（+${(central.g_high * 100).toFixed(0)}%）</span>
                        <span class="timing-dur">${central.high.map(o => o.name).join('、') || '—'}</span>
                    </div>
                    ${!central.isSingle ? `
                    <div class="timing-central-row">
                        <span class="timing-tag timing-tag-low">低恢复组（+${(central.g_low * 100).toFixed(0)}%）</span>
                        <span class="timing-dur">${central.low.map(o => o.name).join('、') || '—'}</span>
                    </div>` : ''}
                    ${renderTimeline([
                        ...highRows.map(r => ({ ...r, className: 'ta-high' })),
                        ...(!central.isSingle ? lowRows.map(r => ({ ...r, className: 'ta-low' })) : [])
                    ])}
                    <div class="timing-central-note">
                        起点时刻：${pad2(t0H)}:00（已整点取整）｜总控段 ${centralPeriod.duration}h（可选 11-13h）
                    </div>
                </div>`;
            }
        }

        html += '<div class="timing-section-title">各舱推荐时段</div>';
        html += '<div class="timing-room-list">';
        for (const ra of roomAnalyses) {
            let label = ROOM_LABELS[ra.roomKey];
            if (ra.roomKey === 'manufactA' || ra.roomKey === 'manufactB') {
                const prodName = (ra.effKey === 'weapon') ? '武器' : '干员';
                label = `${label}（${prodName}）`;
            }
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

            if (!ra.loop || !ra.loop.feasible || !ra.periods) {
                const reason = (!ra.loop || !ra.loop.feasible) 
                    ? '恢复速度不足以支撑工作时间（请检查总控是否空置或干员心情减耗不足）' 
                    : '无法分配时段';
                html += `<div class="timing-room-item">
                    <div class="timing-room-item-header"><span class="timing-room-name">${label}</span></div>
                    <div class="timing-room-item-body" style="color:#c0392b;">
                        无可行稳态：${reason}
                    </div>
                </div>`;
                continue;
            }

            const effNames = ra.efficient.ops.map(o => o.name).join('、') || '—';
            const ineffNames = ra.inefficient.ops.map(o => o.name).join('、') || '—';

            let r1Rows, r2Rows;
            if (ra.isRound1Efficient) { 
                r1Rows = ra.periods.efficient;
                r2Rows = ra.periods.inefficient;
            } else {
                r1Rows = ra.periods.inefficient;
                r2Rows = ra.periods.efficient;
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
                    ...ra.periods.efficient.map(r => ({ ...r, className: 'ta-eff' })),
                    ...ra.periods.inefficient.map(r => ({ ...r, className: 'ta-trans' }))
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
        
        const moodContainer = document.getElementById('timingRInputs');
        if (moodContainer) moodContainer.innerHTML = '';

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
        
        if (t0M > 20) {
            t0H += 1;
        }
        t0H = t0H % 24;
        if (t0H < 0) t0H = 0;
        
        const t0 = t0H;

        const roomModes = loaded.roomModes || {};

        const tempUsed = new Set();
        for (const roomKey of ROOM_KEYS) {
            if (roomModes[roomKey] === 'empty') continue;
            const q = loaded.queues[roomKey];
            if (!q) continue;
            const isD = loaded.doubleRooms.includes(roomKey);
            const list = isD ? [...(q.round1 || []), ...(q.round2 || [])] : (q.recommend || []);
            for (const item of list) {
                const n = item.name || item;
                if (n) tempUsed.add(n);
            }
        }
        const tempCentral = analyzeCentral(tempUsed, loaded.queues, roomModes);
        const cRestLow = C_REST_BASE * (1 + tempCentral.g_low);
        const cRestHigh = C_REST_BASE * (1 + tempCentral.g_high);

        const manufactCfg = getManufactProductConfig();

        const roomAnalyses = [];
        const usedNames = new Set();
        for (const roomKey of ROOM_KEYS) {
            if (roomModes[roomKey] === 'empty') continue;
            
            const ra = analyzeRoom(roomKey, loaded.queues, roomModes, loaded.doubleRooms, cRestLow, cRestHigh, manufactCfg);
            if (!ra) continue;
            
            if (!ra.isSingle && ra.loop && ra.loop.feasible) {
                const lowEnd = t0 + ra.effRestDur; 
                const effStart = lowEnd;
                const effEnd = t0 + 24;
                ra.periods = {
                    efficient: splitRange(effStart, effEnd),
                    inefficient: splitRange(t0, lowEnd)
                };
            }
            
            roomAnalyses.push(ra);
            for (const op of ra.efficient.ops) usedNames.add(op.name);
            if (ra.inefficient) for (const op of ra.inefficient.ops) usedNames.add(op.name);
        }

        const central = analyzeCentral(usedNames, loaded.queues, roomModes);
        
        let centralPeriod = null;
        if (!central.isEmpty) {
            const effRestDurs = roomAnalyses.filter(ra => !ra.isSingle && ra.loop && ra.loop.feasible).map(ra => ra.effRestDur);
            const maxEffRestDur = effRestDurs.length > 0 ? Math.max(0, ...effRestDurs) : 0;
            
            let cDur = Math.ceil(maxEffRestDur);
            if (isNaN(cDur) || cDur < CENTRAL_DUR_MIN) cDur = CENTRAL_DUR_MIN;
            if (cDur > CENTRAL_DUR_MAX) cDur = CENTRAL_DUR_MAX;
            
            centralPeriod = { start: t0, duration: cDur, end: t0 + cDur };
        }

        const result = {
            roomAnalyses, central, centralPeriod,
            cRestLow, cRestHigh,
            t0H, t0M,
            manufactCfg
        };
        lastResult = result;
        renderResult(result);

        // 缓存各舱各轮时段，供主站渲染
        try {
            const timingMap = {};
            
            // 辅助函数：计算总时长
            function getTotalHours(rows) {
                if (!rows || rows.length === 0) return 0;
                let total = 0;
                for (const r of rows) total += (r.end - r.start);
                return Math.round(total);
            }

            for (const rk of ROOM_KEYS) {
                if (roomModes[rk] === 'empty') continue;
                const p = getRoomPeriods(rk);
                if (!p) continue;
                timingMap[rk] = {
                    round1: p.round1 ? `${getTotalHours(p.round1)}h ${renderRangeInline(p.round1)}` : '',
                    round2: p.round2 ? `${getTotalHours(p.round2)}h ${renderRangeInline(p.round2)}` : ''
                };
            }
            
            if (!central.isEmpty) {
                const cp = getRoomPeriods('central');
                if (cp && !cp.single) {
                    timingMap.central = {
                        round1: cp.round1 ? `${getTotalHours(cp.round1)}h ${renderRangeInline(cp.round1)}` : '',
                        round2: cp.round2 ? `${getTotalHours(cp.round2)}h ${renderRangeInline(cp.round2)}` : ''
                    };
                }
            }
            window.__DIJIANG_ROOM_TIMING__ = timingMap;
        } catch (e) {
            console.warn('[时间段] 缓存时段失败：', e);
            window.__DIJIANG_ROOM_TIMING__ = {};
        }
        window.dispatchEvent(new CustomEvent('dijiang:timing-updated'));
    }

    /* ================= 对外接口 ================= */
    function getRoomPeriods(roomKey) {
        if (!lastResult) return null;

        if (roomKey === 'central') {
            if (lastResult.central.isEmpty) return null;
            if (!lastResult.centralPeriod) return null;
            
            const cp = lastResult.centralPeriod;
            const highRows = splitRange(cp.start, cp.end);
            const lowRows  = splitRange(cp.end, cp.start + 24);

            if (lastResult.central.isSingle) {
                return {
                    single: false,
                    isCentral: true,
                    round1: highRows,
                    round2: null
                };
            }

            // 直接使用准确的判断结果
            const r1IsHigh = lastResult.central.isRound1High;

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
        if (!ra.loop || !ra.loop.feasible || !ra.periods) return null;

        let r1Rows, r2Rows;
        if (ra.isRound1Efficient) { 
            r1Rows = ra.periods.efficient;
            r2Rows = ra.periods.inefficient;
        } else {
            r1Rows = ra.periods.inefficient;
            r2Rows = ra.periods.efficient;
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

        // 确保初始加载时自动执行一次计算
        if (window.__DIJIANG_READY__) {
            setTimeout(run, 100);
        } else {
            window.addEventListener('dijiang:ready', () => {
                setTimeout(run, 100);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }

    console.log('[时间段] schedule-timing.js 已加载（v6.6 · 完整自动版）');
})();