/* ============================================================
   scheduler-core.js —— 纯算法核心模块
   总控策略：
   - 有总控天赋信赖 → 预置到一轮总控（≤3 人，按恢复降序）
   - 无总控天赋信赖 → 不参与贪心，交换后填充 A 班（低效一轮）
   - 一轮贪心 3 人 → 二轮添补 → 合并池排序（前 3 进 B 班、剩余进 A 班）
   - 优先级语义：priorityOrder 索引 0 = 优先级 1（最高），索引 4 = 优先级 5（最低）
   ============================================================ */
(function() {
    'use strict';

    const MOOD_WEIGHT = 0.3;
    const DEFAULT_PRIORITY_WEIGHTS = [1.0, 0.6, 0.3];
    const ALL_ROOMS = ['central', 'manufactA', 'manufactB', 'culture', 'meeting'];

    // ========== 基础工具函数 ==========
    function getPriorityWeights(options) {
        return options.priorityWeights || DEFAULT_PRIORITY_WEIGHTS;
    }
    function isCluePower(type) {
        return type === '线索概率提升' || type === '线索概率小幅提升';
    }
    function isManufactDebug() {
        return window.DIJIANG_MANUFACT_DEBUG === true;
    }

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

    function groupEffectiveEffReduce(members, roomKey, mode, cultureTypes) {
        let eff = 0, reduce = 0;
        for (const m of members) {
            if (!m) continue;
            const r = extractTalentForRoom(m.mergedTraits, roomKey, mode, cultureTypes);
            eff += r.eff; reduce += r.reduce;
        }
        return { eff, reduce };
    }

    // ========== 评分 ==========
    function computeScoresForAll(operators, options) {
        const mode = options.mode;
        const activeCultureTypes = options.cultureTypes;
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
                }
                if (room === '培养舱') {
                    const PRODUCT_MAP = { '矿物效率': 'mineral', '菌类效率': 'fungi', '晶植效率': 'plant' };
                    const product = PRODUCT_MAP[type];
                    if (product && activeCultureTypes.includes(product)) {
                        const rank = options.culturePriority.indexOf(product);
                        const weights = getPriorityWeights(options);
                        const weight = rank >= 0 ? (weights[rank] !== undefined ? weights[rank] : 0.1) : 1.0;
                        score.culture += val * weight;
                    }
                    if (type === '心情消耗减少') { score.culture += val * MOOD_WEIGHT; score.moodReduce += val; }
                }
                if (room === '制造舱') {
                    if (type === '干员素材效率') { score.expScore += val; if (mode === 'dual' || mode === 'exp') score.manufact += val; }
                    if (type === '武器素材效率') { score.weaponScore += val; if (mode === 'dual' || mode === 'weapon') score.manufact += val; }
                    if (type === '心情消耗减少') { score.manufact += val * MOOD_WEIGHT; score.moodReduce += val; }
                }
            }
            scores.push({ opId: op.id, name: op.name, mergedTraits: op.mergedTraits, score, isBasic: false });
        }
        return scores;
    }

    // ========== 评估与微调 ==========
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
        if (rateA >= rateB) { highRate = rateA; lowRate = rateB; cWorkHigh = cWorkA; cWorkLow = cWorkB; }
        else { highRate = rateB; lowRate = rateA; cWorkHigh = cWorkB; cWorkLow = cWorkA; }
        let bestOutput = 0, found = false;
        for (let hHigh = 1; hHigh <= 23; hHigh++) {
            const hLow = 24 - hHigh;
            const effHighWork = Math.min(hHigh, 100 / cWorkHigh);
            const effLowWork  = Math.min(hLow,  100 / cWorkLow);
            if (effHighWork * cWorkHigh > hLow * cRestHigh + 1e-6) continue;
            if (effLowWork  * cWorkLow  > hHigh * cRestLow + 1e-6) continue;
            const output = highRate * effHighWork + lowRate * effLowWork;
            if (!found || output > bestOutput) { bestOutput = output; found = true; }
        }
        if (!found) {
            const hHigh = 13, hLow = 11;
            bestOutput = highRate * Math.min(hHigh, 100 / cWorkHigh) + lowRate * Math.min(hLow, 100 / cWorkLow);
        }
        return bestOutput;
    }

    function optimizeCulturePair(A, B, priority, cRestHigh, options) {
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
            const hA = calcHA(); const hB = 24 - hA;
            const weights = getPriorityWeights(options);
            let V = 0;
            for (let i = 0; i < priority.length; i++) {
                const p = priority[i];
                const w = weights[i] !== undefined ? weights[i] : 0.1;
                V += w * (calcRate(A2, p) * hA + calcRate(B2, p) * hB);
            }
            return V;
        }
        const MAX_PER_GROUP = 3;
        let iterations = 0, improved = true;
        while (improved && iterations < 8) {
            improved = false; iterations++;
            const baseOutput = totalValue(A, B);
            outerLoop:
            for (let i = 0; i < A.length; i++) {
                for (let j = 0; j < B.length; j++) {
                    const A2 = A.slice(); A2[i] = B[j];
                    const B2 = B.slice(); B2[j] = A[i];
                    if (totalValue(A2, B2) > baseOutput + 0.01) {
                        const tmp = A[i]; A[i] = B[j]; B[j] = tmp;
                        improved = true; break outerLoop;
                    }
                }
            }
            if (improved) continue;
            if (B.length < MAX_PER_GROUP) {
                for (let i = 0; i < A.length; i++) {
                    const moved = A[i]; A.splice(i, 1); B.push(moved);
                    if (totalValue(A, B) > baseOutput + 0.01) { improved = true; break; }
                    else { B.pop(); A.splice(i, 0, moved); }
                }
            }
            if (improved) continue;
            if (A.length < MAX_PER_GROUP) {
                for (let j = 0; j < B.length; j++) {
                    const moved = B[j]; B.splice(j, 1); A.push(moved);
                    if (totalValue(A, B) > baseOutput + 0.01) { improved = true; break; }
                    else { A.pop(); B.splice(j, 0, moved); }
                }
            }
        }
    }

    function optimizeRoomReduction(round1Map, round2Map, roomKey, mode, cultureTypes, cRestHigh, options) {
        const A = round1Map[roomKey] || (round1Map[roomKey] = []);
        const B = round2Map[roomKey] || (round2Map[roomKey] = []);
        if (A.length === 0 && B.length === 0) return;
        if (roomKey === 'culture') {
            const priority = options.culturePriority;
            if (priority && priority.length > 1) { optimizeCulturePair(A, B, priority, cRestHigh, options); return; }
        }
        const MAX_PER_GROUP = 3;
        let iterations = 0, improved = true;
        while (improved && iterations < 8) {
            improved = false; iterations++;
            const baseOutput = evalPairOutput(A, B, roomKey, mode, cultureTypes, cRestHigh);
            outerLoop:
            for (let i = 0; i < A.length; i++) {
                for (let j = 0; j < B.length; j++) {
                    const A2 = A.slice(); A2[i] = B[j];
                    const B2 = B.slice(); B2[j] = A[i];
                    if (evalPairOutput(A2, B2, roomKey, mode, cultureTypes, cRestHigh) > baseOutput + 0.01) {
                        const tmp = A[i]; A[i] = B[j]; B[j] = tmp;
                        improved = true; break outerLoop;
                    }
                }
            }
            if (improved) continue;
            if (B.length < MAX_PER_GROUP) {
                for (let i = 0; i < A.length; i++) {
                    const moved = A[i]; A.splice(i, 1); B.push(moved);
                    if (evalPairOutput(A, B, roomKey, mode, cultureTypes, cRestHigh) > baseOutput + 0.01) { improved = true; break; }
                    else { B.pop(); A.splice(i, 0, moved); }
                }
            }
            if (improved) continue;
            if (A.length < MAX_PER_GROUP) {
                for (let j = 0; j < B.length; j++) {
                    const moved = B[j]; B.splice(j, 1); A.push(moved);
                    if (evalPairOutput(A, B, roomKey, mode, cultureTypes, cRestHigh) > baseOutput + 0.01) { improved = true; break; }
                    else { A.pop(); B.splice(j, 0, moved); }
                }
            }
        }
    }

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
        let iterations = 0, improved = true, MAX_ITER = 30;
        while (improved && iterations < MAX_ITER) {
            improved = false; iterations++;
            const baseOutput = totalOutput();
            outer:
            for (let i = 0; i < groups.length; i++) {
                for (let j = i + 1; j < groups.length; j++) {
                    const gi = groups[i], gj = groups[j];
                    for (let pi = 0; pi < gi.arr.length; pi++) {
                        for (let pj = 0; pj < gj.arr.length; pj++) {
                            const tmpI = gi.arr[pi], tmpJ = gj.arr[pj];
                            gi.arr[pi] = tmpJ; gj.arr[pj] = tmpI;
                            const newOutput = totalOutput();
                            if (newOutput > baseOutput + 0.01) {
                                if (isManufactDebug()) console.log(`[制造舱优化] 交换 ${gi.key}(${gi.round})[${pi}] <-> ${gj.key}(${gj.round})[${pj}]`);
                                improved = true; break outer;
                            } else { gi.arr[pi] = tmpI; gj.arr[pj] = tmpJ; }
                        }
                    }
                }
            }
            if (improved) continue;
            for (let i = 0; i < groups.length; i++) {
                const gi = groups[i]; if (gi.arr.length === 0) continue;
                for (let j = 0; j < groups.length; j++) {
                    if (i === j) continue;
                    const gj = groups[j]; if (gj.arr.length >= MAX_PER_GROUP) continue;
                    for (let pi = 0; pi < gi.arr.length; pi++) {
                        const moved = gi.arr[pi]; gi.arr.splice(pi, 1); gj.arr.push(moved);
                        const newOutput = totalOutput();
                        if (newOutput > baseOutput + 0.01) { improved = true; break; }
                        else { gj.arr.pop(); gi.arr.splice(pi, 0, moved); }
                    }
                    if (improved) break;
                }
                if (improved) break;
            }
        }
    }

    function optimizeReductionPlacement(round1Map, round2Map, doubleRooms, mode, cultureTypes, options) {
        const cRestHigh = options.cRestHigh;
        if (mode === 'exp' || mode === 'weapon') {
            optimizeManufactPair(round1Map, round2Map, mode, cultureTypes, cRestHigh);
            for (const roomKey of ['culture']) {
                if (!doubleRooms.includes(roomKey)) continue;
                optimizeRoomReduction(round1Map, round2Map, roomKey, mode, cultureTypes, cRestHigh, options);
            }
        } else {
            for (const roomKey of ['culture', 'manufactA', 'manufactB']) {
                if (!doubleRooms.includes(roomKey)) continue;
                optimizeRoomReduction(round1Map, round2Map, roomKey, mode, cultureTypes, cRestHigh, options);
            }
        }
    }

    function sortRoundsByEfficiency(round1Map, round2Map, mode, cultureTypes) {
        for (const key of ['manufactA', 'manufactB', 'culture', 'meeting']) {
            const A = round1Map[key] || []; const B = round2Map[key] || [];
            if (A.length === 0 || B.length === 0) continue;
            const pA = groupEffectiveEffReduce(A, key, mode, cultureTypes);
            const pB = groupEffectiveEffReduce(B, key, mode, cultureTypes);
            const rA = (1 + pA.eff / 100) * (1 + 0.4 * A.length);
            const rB = (1 + pB.eff / 100) * (1 + 0.4 * B.length);
            if (rA < rB) { round1Map[key] = B; round2Map[key] = A; }
        }
    }

    // ========== 会客室与制造舱后处理 ==========
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

    function calcRoomContributionActual(op, roomKey, workHours, options) {
        if (!op || !op.mergedTraits) return 0;
        const rawRoom = { central: '总控中枢', manufactA: '制造舱', manufactB: '制造舱', culture: '培养舱', meeting: '会客室' }[roomKey];
        if (!rawRoom) return 0;
        const mode = options.mode; const cultureTypes = options.cultureTypes;
        let effTotal = 0, reduceTotal = 0;
        for (const t of op.mergedTraits) {
            if (t.舱室 !== rawRoom) continue;
            const v = t.数值 || 0;
            if (t.类型 === '心情消耗减少') { reduceTotal += v; continue; }
            if (t.类型 === '线索概率提升' || t.类型 === '线索概率小幅提升') continue;
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

    function hasValidMeetingTalent(scoreObj, options) {
        if (!scoreObj || !scoreObj.mergedTraits) return false;
        for (const t of scoreObj.mergedTraits) {
            if (t.舱室 !== '会客室') continue;
            if (t.类型 === '收集线索效率' || t.类型 === '心情消耗减少') return true;
            if (t.类型 === '线索概率提升' || t.类型 === '线索概率小幅提升') {
                const num = parseInt(t.线索编号, 10);
                if (options.missingClues.has(num)) return true;
                if (!options.excludedClues.has(num)) return true;
            }
        }
        return false;
    }

    function replaceMeetingSecondRoundWithCluePowers(round1Map, round2Map, reservePool, doubleRooms, roomTiming, mode, cultureTypes, options) {
        if (!doubleRooms.includes('meeting')) return;
        const R1 = round1Map.meeting || []; const R2 = round2Map.meeting || [];
        if (R2.length === 0) return;
        const badIndices = [], neutralIndices = [];
        for (let i = 0; i < R2.length; i++) {
            const op = R2[i]; if (!op) continue;
            const info = analyzeMeetingTraits(op);
            if (info.clueEff > 0) continue;
            const usefulPowerNums = info.cluePowerNums.filter(n => options.missingClues.has(n) || !options.excludedClues.has(n));
            if (usefulPowerNums.length > 0) continue;
            if (info.cluePowerNums.length > 0) badIndices.push(i); else neutralIndices.push(i);
        }
        if (badIndices.length === 0 && neutralIndices.length === 0) return;
        const usedIds = new Set();
        for (const op of R1) if (op) usedIds.add(op.opId);
        for (const op of R2) if (op) usedIds.add(op.opId);
        const usefulCandidates = [];
        for (const s of reservePool) {
            if (usedIds.has(s.opId)) continue;
            const info = analyzeMeetingTraits(s);
            const usefulPowerNums = info.cluePowerNums.filter(n => options.missingClues.has(n) || !options.excludedClues.has(n));
            if (info.clueEff === 0 && usefulPowerNums.length === 0) continue;
            const hits = info.cluePowerNums.filter(n => options.missingClues.has(n)).length;
            const score = hits * 1000 + info.clueEff * 10 + usefulPowerNums.length * 100 + info.cluePower * 10 + 5;
            usefulCandidates.push({ op: s, score, from: null });
        }
        for (const rk of ['central', 'manufactA', 'manufactB', 'culture']) {
            const timing = roomTiming[rk] || { hA: 24, hB: 0 };
            for (const rnd of ['round1', 'round2']) {
                const map = (rnd === 'round1' ? round1Map : round2Map);
                const arr = map[rk] || [];
                const effH = (rnd === 'round1') ? timing.hA : timing.hB;
                for (let i = 0; i < arr.length; i++) {
                    const op = arr[i]; if (!op || usedIds.has(op.opId) || options.trustedAgentIds.includes(op.opId)) continue;
                    const info = analyzeMeetingTraits(op);
                    const usefulPowerNums = info.cluePowerNums.filter(n => options.missingClues.has(n) || !options.excludedClues.has(n));
                    if (info.clueEff === 0 && usefulPowerNums.length === 0) continue;
                    const contrib = calcRoomContributionActual(op, rk, effH, options);
                    if (contrib > 0.01) continue;
                    const hits = info.cluePowerNums.filter(n => options.missingClues.has(n)).length;
                    const score = hits * 1000 + info.clueEff * 10 + usefulPowerNums.length * 100 + info.cluePower * 10;
                    usefulCandidates.push({ op, score, from: { roomKey: rk, round: rnd, idx: i } });
                }
            }
        }
        usefulCandidates.sort((a, b) => b.score - a.score);
        const placeholderCandidates = [];
        for (const s of reservePool) {
            if (usedIds.has(s.opId)) continue;
            const info = analyzeMeetingTraits(s);
            const usefulPowerNums = info.cluePowerNums.filter(n => options.missingClues.has(n) || !options.excludedClues.has(n));
            if (info.clueEff === 0 && usefulPowerNums.length === 0 && info.cluePowerNums.length === 0) placeholderCandidates.push({ op: s });
        }
        const usedCandIds = new Set();
        function doReplace(idx, cand) {
            const displaced = R2[idx]; R2[idx] = cand.op;
            if (cand.from) {
                const srcMap = (cand.from.round === 'round1' ? round1Map : round2Map);
                const srcArr = srcMap[cand.from.roomKey];
                if (srcArr && srcArr[cand.from.idx] === cand.op) srcArr[cand.from.idx] = displaced;
                usedIds.delete(cand.op.opId); if (displaced) usedIds.add(displaced.opId);
            } else { usedIds.add(cand.op.opId); if (displaced) reservePool.push(displaced); }
            usedCandIds.add(cand.op.opId);
        }
        for (const idx of badIndices) {
            let cand = null; for (const c of usefulCandidates) { if (usedCandIds.has(c.op.opId)) continue; cand = c; break; }
            if (!cand) break; doReplace(idx, cand);
        }
        for (const idx of neutralIndices) {
            let cand = null; for (const c of usefulCandidates) { if (usedCandIds.has(c.op.opId)) continue; cand = c; break; }
            if (!cand) break; doReplace(idx, cand);
        }
        for (const idx of badIndices) {
            const op = R2[idx]; if (!op) continue;
            const info = analyzeMeetingTraits(op);
            if (info.clueEff > 0) continue;
            const usefulPowerNums = info.cluePowerNums.filter(n => options.missingClues.has(n) || !options.excludedClues.has(n));
            if (usefulPowerNums.length > 0 || info.cluePowerNums.length === 0) continue;
            let cand = null; for (const c of placeholderCandidates) { if (usedCandIds.has(c.op.opId)) continue; cand = c; break; }
            if (!cand) break; doReplace(idx, cand);
        }
    }

    function refineManufactSecondRoundByActualTime(round1Map, round2Map, reservePool, doubleRooms, mode, cultureTypes, roomTiming, options) {
        for (const rk of ['manufactA', 'manufactB']) {
            if (!doubleRooms.includes(rk)) continue;
            const timing = roomTiming[rk]; if (!timing || timing.hB <= 0) continue;
            const effH = timing.hB; const R2 = round2Map[rk] || [];
            if (R2.length === 0) continue;
            const weakIndices = [];
            for (let i = 0; i < R2.length; i++) {
                const op = R2[i]; if (!op) continue;
                if (calcRoomContributionActual(op, rk, effH, options) <= 0.01) weakIndices.push(i);
            }
            if (weakIndices.length === 0) continue;
            const usedIds = new Set();
            for (const key of Object.keys(round1Map)) for (const s of (round1Map[key] || [])) if (s) usedIds.add(s.opId);
            for (const key of Object.keys(round2Map)) for (const s of (round2Map[key] || [])) if (s) usedIds.add(s.opId);
            const candidates = [];
            for (const s of reservePool) {
                if (usedIds.has(s.opId) || options.trustedAgentIds.includes(s.opId)) continue;
                const contrib = calcRoomContributionActual(s, rk, effH, options);
                if (contrib > 0.01) candidates.push({ op: s, contrib });
            }
            candidates.sort((a, b) => b.contrib - a.contrib);
            const n = Math.min(weakIndices.length, candidates.length);
            for (let k = 0; k < n; k++) {
                const idx = weakIndices[k]; const displaced = R2[idx];
                const oldContrib = displaced ? calcRoomContributionActual(displaced, rk, effH, options) : 0;
                const newContrib = candidates[k].contrib;
                if (newContrib > oldContrib + 0.01) { R2[idx] = candidates[k].op; usedIds.add(candidates[k].op.opId); }
            }
        }
    }

    // ========== 稳态时长记录 ==========
    function recordTimingInfo(round1Map, round2Map, doubleRooms, mode, options) {
        const cRestHigh = options.cRestHigh;
        const cRestLow  = 12 * 1.0;
        const info = {};
        const firstCultureProduct = options.culturePriority[0] || null;
        const cultureTypesForTiming = firstCultureProduct ? [firstCultureProduct] : options.cultureTypes;
        for (const key of ['manufactA', 'manufactB', 'culture', 'meeting']) {
            if (!doubleRooms.includes(key)) continue;
            const A = round1Map[key] || []; const B = round2Map[key] || [];
            if (A.length === 0 || B.length === 0) continue;
            const typesForThis = (key === 'culture') ? cultureTypesForTiming : options.cultureTypes;
            const pA = groupEffectiveEffReduce(A, key, mode, typesForThis);
            const pB = groupEffectiveEffReduce(B, key, mode, typesForThis);
            const cWorkA = 7.2 * Math.max(0.1, 1 - pA.reduce / 100);
            const cWorkB = 7.2 * Math.max(0.1, 1 - pB.reduce / 100);
            const rA = (1 + pA.eff / 100) * (1 + 0.4 * A.length);
            const rB = (1 + pB.eff / 100) * (1 + 0.4 * B.length);
            const highIsA = rA >= rB;
            const highRate = highIsA ? rA : rB; const lowRate  = highIsA ? rB : rA;
            const cWorkHigh = highIsA ? cWorkA : cWorkB; const cWorkLow  = highIsA ? cWorkB : cWorkA;
            let bestHHigh = 13, bestOutput = -1, found = false;
            for (let hHigh = 1; hHigh <= 23; hHigh++) {
                const hLow = 24 - hHigh;
                const effHighWork = Math.min(hHigh, 100 / cWorkHigh);
                const effLowWork  = Math.min(hLow,  100 / cWorkLow);
                if (effHighWork * cWorkHigh > hLow * cRestHigh + 1e-6) continue;
                if (effLowWork  * cWorkLow  > hHigh * cRestLow  + 1e-6) continue;
                const output = highRate * effHighWork + lowRate * effLowWork;
                if (!found || output > bestOutput) { bestOutput = output; bestHHigh = hHigh; found = true; }
            }
            if (!found) bestHHigh = 13;
            const hA = highIsA ? bestHHigh : (24 - bestHHigh);
            const hB = 24 - hA;
            info[key] = { hA, hB, cA: cWorkA, cB: cWorkB, rA, rB, round1IsEfficient: highIsA };
            if (key === 'culture') info[key].cultureBasisProduct = firstCultureProduct;
        }
        if (doubleRooms.includes('central')) {
            const baseKey = ['manufactA', 'manufactB', 'culture'].find(k => info[k]);
            const base = baseKey ? info[baseKey] : { hA: 11, hB: 13, cA: 0.072, cB: 0.072, rA: 1, rB: 1 };
            const pA = groupEffectiveEffReduce(round1Map.central || [], 'central', mode, options.cultureTypes);
            const pB = groupEffectiveEffReduce(round2Map.central || [], 'central', mode, options.cultureTypes);
            const centralRound1IsEfficient = pA.eff >= pB.eff;
            info.central = { hA: base.hA, hB: base.hB, cA: base.cA, cB: base.cB, rA: base.rA, rB: base.rB, round1IsEfficient: centralRound1IsEfficient };
        }
        return info;
    }

    // ========== 核心排班主流程 ==========
    function buildSchedule(scores, operators, options) {
        const mode = options.mode;
        const doubleRooms = options.doubleRooms;
        const emptyRooms = options.emptyRooms;
        const centralDisabled = options.centralDisabled;
        const trustIdSet = new Set(options.trustedAgentIds);
        const roomModes = options.roomModes;

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

        // ===== 信赖列表：无条件强制去总控（最多 3 人，按总控天赋降序） =====
        const validTrustList = [];
        for (const id of trustIdSet) {
            const s = availableScores.find(x => x.opId === id);
            if (s) validTrustList.push(s);
        }
        validTrustList.sort((a, b) => (b.score.central || 0) - (a.score.central || 0));
        const finalTrustList = validTrustList.slice(0, 3);

        const assignedSet = new Set();
        const round1Map = { central: [], meeting: [], culture: [], manufactA: [], manufactB: [] };
        const round2Map = { central: [], meeting: [], culture: [], manufactA: [], manufactB: [] };

        // ===== 预置信赖到一轮总控池 =====
        if (!centralDisabled) {
            for (const s of finalTrustList) {
                round1Map.central.push(s);
                assignedSet.add(s.opId);
            }
        }

        let remainingPool = availableScores.filter(s => !assignedSet.has(s.opId));

        // ===== 一轮贪心 =====
        let effectiveOrder1 = options.priorityOrderRound1.slice();
        if (options.meetingPriorityEnabled) effectiveOrder1 = ['meeting'].concat(effectiveOrder1.filter(k => k !== 'meeting'));
        const activeRooms1 = effectiveOrder1.filter(k => roomModes[k] !== 'empty');
        const roomPriority1 = {};
        activeRooms1.forEach((k, index) => { roomPriority1[k] = index; });
        if (roomPriority1['central'] === undefined) roomPriority1['central'] = 4;
        let round1Rooms = activeRooms1.filter(k => k !== 'central');
        if (!centralDisabled) round1Rooms.push('central');

        const round1Pairs = [];
        for (const s of remainingPool) {
            if (assignedSet.has(s.opId)) continue;
            for (const key of round1Rooms) {
                let field = roomDefs.find(d => d.key === key).field;
                if (key === 'manufactA') field = (mode === 'weapon') ? 'weaponScore' : 'expScore';
                else if (key === 'manufactB') field = (mode === 'exp') ? 'expScore' : 'weaponScore';
                const score = s.score[field] || 0;
                if (score > 0) round1Pairs.push({ scoreObj: s, roomKey: key, score: score, priority: roomPriority1[key] });
            }
        }
        round1Pairs.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const aT = trustIdSet.has(a.scoreObj.opId) ? 1 : 0;
            const bT = trustIdSet.has(b.scoreObj.opId) ? 1 : 0;
            if (aT !== bT) return aT - bT;
            return a.priority - b.priority;
        });

        const ROOM1_CAP = { central: 3, meeting: 3, culture: 3, manufactA: 3, manufactB: 3 };
        const roomCount1 = { central: round1Map.central.length, meeting: 0, culture: 0, manufactA: 0, manufactB: 0 };
        for (const pair of round1Pairs) {
            if (assignedSet.has(pair.scoreObj.opId) || roomCount1[pair.roomKey] >= (ROOM1_CAP[pair.roomKey] || 3)) continue;
            round1Map[pair.roomKey].push(pair.scoreObj); assignedSet.add(pair.scoreObj.opId); roomCount1[pair.roomKey]++;
            const idx = remainingPool.indexOf(pair.scoreObj); if (idx !== -1) remainingPool.splice(idx, 1);
        }

        // 一轮平铺
        const round1FillRooms = activeRooms1.filter(k => k !== 'central');
        if (!centralDisabled) round1FillRooms.push('central');
        let r1FillActive = true;
        while (r1FillActive) {
            r1FillActive = false;
            if (options.meetingPriorityEnabled && round1Map.meeting.length < 3) {
                const cand = remainingPool.filter(s => !assignedSet.has(s.opId) && s.mergedTraits && s.mergedTraits.some(t => t.舱室 === '会客室' && t.类型 === '收集线索效率'));
                if (cand.length > 0) {
                    cand.sort((a, b) => (b.score.meeting || 0) - (a.score.meeting || 0));
                    const picked = cand[0]; round1Map.meeting.push(picked); assignedSet.add(picked.opId);
                    const idx = remainingPool.indexOf(picked); if (idx !== -1) remainingPool.splice(idx, 1);
                    r1FillActive = true; continue;
                }
            }
            for (const key of round1FillRooms) {
                const cap1 = 3;
                if (round1Map[key].length >= cap1) continue;
                let cand = remainingPool.filter(s => !assignedSet.has(s.opId));
                if (cand.length === 0) continue;
                let field = roomDefs.find(d => d.key === key).field;
                if (key === 'manufactA') field = (mode === 'weapon') ? 'weaponScore' : 'expScore';
                else if (key === 'manufactB') field = (mode === 'exp') ? 'expScore' : 'weaponScore';
                if (key === 'manufactA' || key === 'manufactB') {
                    const validCand = cand.filter(s => (s.score[field] || 0) > 0);
                    if (validCand.length > 0) {
                        validCand.sort((a, b) => (b.score[field] || 0) - (a.score[field] || 0));
                        const picked = validCand[0]; round1Map[key].push(picked); assignedSet.add(picked.opId);
                        const idx = remainingPool.indexOf(picked); if (idx !== -1) remainingPool.splice(idx, 1);
                        r1FillActive = true; continue;
                    } else {
                        const reduceCand = cand.filter(s => (s.score.moodReduce || 0) > 0);
                        if (reduceCand.length > 0) {
                            reduceCand.sort((a, b) => (b.score.moodReduce || 0) - (a.score.moodReduce || 0));
                            const picked = reduceCand[0]; round1Map[key].push(picked); assignedSet.add(picked.opId);
                            const idx = remainingPool.indexOf(picked); if (idx !== -1) remainingPool.splice(idx, 1);
                            r1FillActive = true; continue;
                        }
                    }
                }
                cand.sort((a, b) => (b.score[field] || 0) - (a.score[field] || 0));
                const picked = cand[0]; round1Map[key].push(picked); assignedSet.add(picked.opId);
                const idx = remainingPool.indexOf(picked); if (idx !== -1) remainingPool.splice(idx, 1);
                r1FillActive = true;
            }
        }

        // ===== 二轮贪心（总控不参与）=====
        let doubleKeys = ['meeting', 'culture', 'manufactA', 'manufactB', 'central'].filter(k => doubleRooms.includes(k) && !(k === 'central' && centralDisabled));
        let effectiveOrder2 = options.priorityOrderRound2.slice();
        if (options.meetingPriorityEnabled) effectiveOrder2 = ['meeting'].concat(effectiveOrder2.filter(k => k !== 'meeting'));
        const activeRooms2 = effectiveOrder2.filter(k => doubleKeys.includes(k));
        const roomPriority2 = {};
        activeRooms2.forEach((k, index) => { roomPriority2[k] = index; });

        const round2Pairs = [];
        for (const s of remainingPool) {
            if (assignedSet.has(s.opId)) continue;
            for (const key of doubleKeys) {
                if (key === 'central') continue;
                if (key === 'meeting' && !hasValidMeetingTalent(s, options)) continue;
                let field = roomDefs.find(d => d.key === key).field;
                if (key === 'manufactA') field = (mode === 'weapon') ? 'weaponScore' : 'expScore';
                else if (key === 'manufactB') field = (mode === 'exp') ? 'expScore' : 'weaponScore';
                const score = s.score[field] || 0;
                if (score > 0) round2Pairs.push({ scoreObj: s, roomKey: key, score: score, priority: roomPriority2[key] || 9 });
            }
        }
        round2Pairs.sort((a, b) => b.score !== a.score ? b.score - a.score : a.priority - b.priority);

        const assignedSecond = new Set();
        const roomCount2 = { central: 0, meeting: 0, culture: 0, manufactA: 0, manufactB: 0 };
        for (const pair of round2Pairs) {
            if (assignedSecond.has(pair.scoreObj.opId) || roomCount2[pair.roomKey] >= 3) continue;
            round2Map[pair.roomKey].push(pair.scoreObj); assignedSecond.add(pair.scoreObj.opId); roomCount2[pair.roomKey]++;
            const idx = remainingPool.indexOf(pair.scoreObj); if (idx !== -1) remainingPool.splice(idx, 1);
        }

        // 二轮平铺
        const round2FillRooms = doubleKeys.filter(k => k !== 'central');
        let r2FillActive = true;
        while (r2FillActive) {
            r2FillActive = false;
            if (options.meetingPriorityEnabled && round2FillRooms.includes('meeting') && round2Map.meeting.length < 3) {
                const cand = remainingPool.filter(s => !assignedSecond.has(s.opId));
                if (cand.length > 0) {
                    cand.sort((a, b) => (b.score.meeting || 0) - (a.score.meeting || 0));
                    const picked = cand[0]; round2Map.meeting.push(picked); assignedSecond.add(picked.opId);
                    const idx = remainingPool.indexOf(picked); if (idx !== -1) remainingPool.splice(idx, 1);
                    r2FillActive = true; continue;
                }
            }
            for (const key of round2FillRooms) {
                if (round2Map[key].length >= 3) continue;
                let cand = remainingPool.filter(s => {
                    if (assignedSecond.has(s.opId)) return false;
                    if (key === 'meeting' && !hasValidMeetingTalent(s, options)) return false;
                    return true;
                });
                if (key === 'meeting' && cand.length === 0) {
                    cand = remainingPool.filter(s => !assignedSecond.has(s.opId) && s.mergedTraits && s.mergedTraits.some(t => t.舱室 === '会客室'));
                }
                if (cand.length === 0) continue;
                let field = roomDefs.find(d => d.key === key).field;
                if (key === 'manufactA') field = (mode === 'weapon') ? 'weaponScore' : 'expScore';
                else if (key === 'manufactB') field = (mode === 'exp') ? 'expScore' : 'weaponScore';
                if (key === 'manufactA' || key === 'manufactB') {
                    const validCand = cand.filter(s => (s.score[field] || 0) > 0);
                    if (validCand.length > 0) {
                        validCand.sort((a, b) => (b.score[field] || 0) - (a.score[field] || 0));
                        const picked = validCand[0]; round2Map[key].push(picked); assignedSecond.add(picked.opId);
                        const idx = remainingPool.indexOf(picked); if (idx !== -1) remainingPool.splice(idx, 1);
                        r2FillActive = true; continue;
                    } else {
                        const reduceCand = cand.filter(s => (s.score.moodReduce || 0) > 0);
                        if (reduceCand.length > 0) {
                            reduceCand.sort((a, b) => (b.score.moodReduce || 0) - (a.score.moodReduce || 0));
                            const picked = reduceCand[0]; round2Map[key].push(picked); assignedSecond.add(picked.opId);
                            const idx = remainingPool.indexOf(picked); if (idx !== -1) remainingPool.splice(idx, 1);
                            r2FillActive = true; continue;
                        }
                    }
                }
                cand.sort((a, b) => (b.score[field] || 0) - (a.score[field] || 0));
                const picked = cand[0]; round2Map[key].push(picked); assignedSecond.add(picked.opId);
                const idx = remainingPool.indexOf(picked); if (idx !== -1) remainingPool.splice(idx, 1);
                r2FillActive = true;
            }
        }

        // 储备池
        const finalUsedIds = new Set();
        for (const key of Object.keys(round1Map)) for (const s of (round1Map[key] || [])) finalUsedIds.add(s.opId);
        for (const key of Object.keys(round2Map)) for (const s of (round2Map[key] || [])) finalUsedIds.add(s.opId);
        const reservePool = availableScores.filter(s => !finalUsedIds.has(s.opId));
        const reserveMap = { central: [], meeting: [], culture: [], manufactA: [], manufactB: [] };
        for (const def of roomDefs) {
            if (def.disabled) continue;
            let field = def.field;
            if (def.key === 'manufactA') field = (mode === 'weapon') ? 'weaponScore' : 'expScore';
            else if (def.key === 'manufactB') field = (mode === 'exp') ? 'expScore' : 'weaponScore';
            let cand = reservePool.filter(s => (s.score[field] || 0) > 0);
            cand.sort((a, b) => (b.score[field] || 0) - (a.score[field] || 0));
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

        // 优化与替换
        optimizeReductionPlacement(round1Map, round2Map, doubleRooms, mode, options.cultureTypes, options);
        sortRoundsByEfficiency(round1Map, round2Map, mode, options.cultureTypes);

        const roomTiming = {};
        {
            const cRestHigh = options.cRestHigh;
            for (const rk of ['central', 'manufactA', 'manufactB', 'culture', 'meeting']) {
                if (!doubleRooms.includes(rk)) continue;
                const A = round1Map[rk] || []; const B = round2Map[rk] || [];
                if (A.length === 0 || B.length === 0) { roomTiming[rk] = { hA: 24, hB: 0 }; continue; }
                const pA = groupEffectiveEffReduce(A, rk, mode, options.cultureTypes);
                const pB = groupEffectiveEffReduce(B, rk, mode, options.cultureTypes);
                const cA = 7.2 * Math.max(0.1, 1 - pA.reduce / 100);
                const cB = 7.2 * Math.max(0.1, 1 - pB.reduce / 100);
                const hA_max = Math.min(100 / cA, 24 * cRestHigh / (cA + cRestHigh));
                const hA_opt = Math.max(1, Math.min(23, Math.floor(hA_max)));
                roomTiming[rk] = { hA: hA_opt, hB: 24 - hA_opt };
            }
        }
        if (roomTiming.central) {
            const baseKey = ['manufactA', 'manufactB', 'culture'].find(k => roomTiming[k]);
            if (baseKey) { const baseHA = roomTiming[baseKey].hA; roomTiming.central = { hA: baseHA, hB: 24 - baseHA }; }
        }

        {
            const usedIds2 = new Set();
            for (const key of Object.keys(round1Map)) for (const s of (round1Map[key] || [])) usedIds2.add(s.opId);
            for (const key of Object.keys(round2Map)) for (const s of (round2Map[key] || [])) usedIds2.add(s.opId);
            const reservePool2 = availableScores.filter(s => !usedIds2.has(s.opId));
            refineManufactSecondRoundByActualTime(round1Map, round2Map, reservePool2, doubleRooms, mode, options.cultureTypes, roomTiming, options);
        }
        {
            const usedIds2 = new Set();
            for (const key of Object.keys(round1Map)) for (const s of (round1Map[key] || [])) usedIds2.add(s.opId);
            for (const key of Object.keys(round2Map)) for (const s of (round2Map[key] || [])) usedIds2.add(s.opId);
            const reservePool2 = availableScores.filter(s => !usedIds2.has(s.opId));
            replaceMeetingSecondRoundWithCluePowers(round1Map, round2Map, reservePool2, doubleRooms, roomTiming, mode, options.cultureTypes, options);
        }

        // ===== 兜底补齐：所有生产舱室优先按优先级补满（含一轮、二轮） =====
        // 会客室若开启优先（或在策略中排第 1），会最先吃满人，避免被总控挤占
        {
            const currentlyUsed = new Set();
            for (const key of Object.keys(round1Map)) for (const s of (round1Map[key] || [])) if (s) currentlyUsed.add(s.opId);
            for (const key of Object.keys(round2Map)) for (const s of (round2Map[key] || [])) if (s) currentlyUsed.add(s.opId);
            const unassigned = availableScores.filter(s => !currentlyUsed.has(s.opId));
            unassigned.sort((a, b) => Math.max(b.score.expScore||0, b.score.weaponScore||0, b.score.meeting||0, b.score.culture||0, b.score.central||0) - Math.max(a.score.expScore||0, a.score.weaponScore||0, a.score.meeting||0, a.score.culture||0, a.score.central||0));

            // 1. 一轮补齐（按一轮优先级）
            for (const rk of effectiveOrder1) {
                if (rk === 'central' || emptyRooms.includes(rk)) continue;
                const arr1 = round1Map[rk] || [];
                while (arr1.length < 3 && unassigned.length > 0) {
                    const op = unassigned.shift();
                    arr1.push(op); currentlyUsed.add(op.opId);
                }
                round1Map[rk] = arr1;
            }

            // 2. 二轮补齐（按二轮优先级）
            for (const rk of effectiveOrder2) {
                if (rk === 'central' || emptyRooms.includes(rk)) continue;
                if (!doubleRooms.includes(rk)) continue;
                const arr2 = round2Map[rk] || [];
                while (arr2.length < 3 && unassigned.length > 0) {
                    const op = unassigned.shift();
                    arr2.push(op); currentlyUsed.add(op.opId);
                }
                round2Map[rk] = arr2;
            }
        }

        // ===== 总控补漏：当备选池还有闲人，且总控总人数 < 4 时，把总控填满 =====
        if (!centralDisabled && doubleRooms.includes('central')) {
            const usedNow = new Set();
            for (const key of Object.keys(round1Map)) for (const s of (round1Map[key] || [])) if (s) usedNow.add(s.opId);
            for (const key of Object.keys(round2Map)) for (const s of (round2Map[key] || [])) if (s) usedNow.add(s.opId);
            const spare = availableScores.filter(s => !usedNow.has(s.opId));

            const currentCentralCount = (round1Map.central || []).length + (round2Map.central || []).length;
            if (currentCentralCount < 4 && spare.length > 0) {
                spare.sort((a, b) => (b.score.central || 0) - (a.score.central || 0));
                const need = 4 - currentCentralCount;
                const pull = Math.min(need, spare.length);
                for (let i = 0; i < pull; i++) {
                    round1Map.central.push(spare[i]);
                }
            }
        }

        // ===== 合并交换：保证 B 班高效，A 班保底（不限人数）=====
        if (!centralDisabled && doubleRooms.includes('central')) {
            const merged = [...(round1Map.central || []), ...(round2Map.central || [])];
            merged.sort((x, y) => (y.score.central || 0) - (x.score.central || 0));

            if (merged.length === 0) {
                round1Map.central = [];
                round2Map.central = [];
            } else if (merged.length === 1) {
                round1Map.central = [merged[0]];
                round2Map.central = [];
            } else {
                const bCount = Math.min(3, merged.length - 1);
                round2Map.central = merged.slice(0, bCount);
                round1Map.central = merged.slice(bCount);
            }
        }

        // 组装结果
        for (const def of roomDefs) {
            if (def.disabled) continue;
            const key = def.key; const isDouble = doubleRooms.includes(key);
            result[key].recommend = round1Map[key] || [];
            if (isDouble) { result[key].round1 = round1Map[key] || []; result[key].round2 = round2Map[key] || []; }
            result[key].reserve = reserveMap[key] || [];
        }
        if (centralDisabled) {
            result.central.recommend = []; result.central.reserve = [];
            result.central.round1 = []; result.central.round2 = [];
        }
        const timingInfo = recordTimingInfo(round1Map, round2Map, doubleRooms, mode, options);
        result._timingInfo = timingInfo;
        return result;
    }

    // ========== 导出接口 ==========
    window.DijiangScheduler = {
        generateSchedule: function(operators, options) {
            const scores = computeScoresForAll(operators, options);
            return buildSchedule(scores, operators, options);
        },
        computeScoresForAll: function(operators, options) {
            return computeScoresForAll(operators, options);
        }
    };
})();