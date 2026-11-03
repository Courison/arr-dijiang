/* ============================================================
   scheduler-core.v2.js —— 帝江号排班核心（整合优化版）
   ------------------------------------------------------------
   设计目标：
   1. 纯函数、无 DOM、可在浏览器 / Node / Web Worker 中运行；
   2. 统一评分、稳态时长、总控分配、备选池的唯一实现；
   3. 修复 v1 的已知问题：
      - 总控空置时仍然分配干员
      - 信赖干员在总控空置时从 UI 消失
      - 结果对象缺少 id（只有 opId），消费方容易踩空
      - _timingInfo 与真实总控恢复量脱节
   4. 在贪心结果上做确定性的局部搜索（交换 / 替换 / 跨舱移动），
      默认 8 轮，通常 < 30ms；可用 options.optimize='none' 关闭。
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.DijiangSchedulerV2 = api;
    // 未加载 v1 时，直接作为默认实现，便于整站替换
    if (!root.DijiangScheduler) root.DijiangScheduler = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '2.0.0';
  try { if (typeof window !== 'undefined') window.__DIJIANG_SCHEDULER_BUILD = '202610312400'; } catch (e) {}
  const ROOM_KEYS = ['central', 'manufactA', 'manufactB', 'culture', 'meeting'];
  const PRODUCTION_KEYS = ['manufactA', 'manufactB', 'culture', 'meeting'];
  const DEFAULT_PRIORITY_WEIGHTS = [1.0, 0.6, 0.3];
  const DEFAULT_CULTURE_PRIORITY = ['plant', 'mineral', 'fungi'];
  const DEFAULT_MATERIAL_PRIORITY = ['clue', 'weapon', 'exp', 'culture'];
  const MATERIAL_KEYS = ['clue', 'weapon', 'exp', 'culture'];
  const MOOD_WEIGHT = 0.25;
// 线索概率没有直接效率数值：给一个低于效率、但稳定高于心情的基础值。
const CLUE_PROB_BASE = 8;
const CLUE_PROB_VALUE_WEIGHT = 0.4;
  const C_WORK_BASE = 7.2;      // %/h
  const C_REST_BASE = 12;       // %/h
  const CENTRAL_VALUE_WEIGHT = 0.15;
  const CAP = 3;

  const RAW_ROOM = {
    central: '总控中枢',
    manufactA: '制造舱',
    manufactB: '制造舱',
    culture: '培养舱',
    meeting: '会客室',
  };

  // ------------------------------------------------------------
  // 1. 工具
  // ------------------------------------------------------------
  function toSet(v) {
    if (v instanceof Set) return new Set(v);
    if (Array.isArray(v)) return new Set(v);
    return new Set();
  }

  function opIdOf(op) {
    return op && (op.opId !== undefined ? op.opId : op.id);
  }

  function clueValueOf(s) {
    return s && s.score ? (s.score.clue || 0) : 0;
  }

  function meetingValueOf(s) {
    return s && s.score ? ((s.score.meeting || 0) + (s.score.clue || 0) * 0.2 + (s.score.moodReduce || 0) * 0.1) : 0;
  }

  function isCluePower(type) {
    return type === '线索概率提升' || type === '线索概率小幅提升';
  }

  function normalizeOptions(input) {
    const o = input || {};
    const roomModes = Object.assign({
      central: 'double', manufactA: 'double', manufactB: 'double', culture: 'double', meeting: 'double',
    }, o.roomModes || {});
    for (const k of ROOM_KEYS) {
      if (!['double', 'single', 'empty'].includes(roomModes[k])) roomModes[k] = 'double';
    }
    const emptyRooms = ROOM_KEYS.filter(k => roomModes[k] === 'empty');
    const doubleRooms = ROOM_KEYS.filter(k => roomModes[k] === 'double');
    const underfillRoom = ROOM_KEYS.includes(o.underfillRoom) ? o.underfillRoom : 'central';

    let cultureTypes = Array.isArray(o.cultureTypes) && o.cultureTypes.length
      ? o.cultureTypes.slice()
      : ['mineral', 'fungi', 'plant'];
    cultureTypes = cultureTypes.filter(x => ['mineral', 'fungi', 'plant'].includes(x));
    if (cultureTypes.length === 0) cultureTypes = ['mineral', 'fungi', 'plant'];

    let culturePriority = Array.isArray(o.culturePriority) && o.culturePriority.length
      ? o.culturePriority.filter(x => cultureTypes.includes(x))
      : DEFAULT_CULTURE_PRIORITY.filter(x => cultureTypes.includes(x));
    for (const x of DEFAULT_CULTURE_PRIORITY) {
      if (cultureTypes.includes(x) && !culturePriority.includes(x)) culturePriority.push(x);
    }
    for (const x of cultureTypes) if (!culturePriority.includes(x)) culturePriority.push(x);

    const priorityWeights = Array.isArray(o.priorityWeights) && o.priorityWeights.length
      ? o.priorityWeights.slice()
      : DEFAULT_PRIORITY_WEIGHTS.slice();

    let materialPriority = Array.isArray(o.materialPriority)
      ? o.materialPriority.filter(k => MATERIAL_KEYS.includes(k))
      : DEFAULT_MATERIAL_PRIORITY.slice();
    for (const k of DEFAULT_MATERIAL_PRIORITY) {
      if (!materialPriority.includes(k)) materialPriority.push(k);
    }
    materialPriority = materialPriority.slice(0, MATERIAL_KEYS.length);

    return {
      mode: ['exp', 'weapon', 'dual'].includes(o.mode) ? o.mode : 'dual',
      manufactProducts: (() => {
        const p = o.manufactProducts || {};
        const valid = v => v === 'exp' || v === 'weapon';
        if (valid(p.manufactA) || valid(p.manufactB)) {
          return {
            manufactA: valid(p.manufactA) ? p.manufactA : null,
            manufactB: valid(p.manufactB) ? p.manufactB : null,
          };
        }
        const m = ['exp', 'weapon', 'dual'].includes(o.mode) ? o.mode : 'dual';
        if (m === 'exp') return { manufactA: 'exp', manufactB: 'exp' };
        if (m === 'weapon') return { manufactA: 'weapon', manufactB: 'weapon' };
        return { manufactA: 'exp', manufactB: 'weapon' };
      })(),
      roomModes,
      doubleRooms,
      emptyRooms,
      underfillRoom,
      centralDisabled: !!o.centralDisabled || roomModes.central === 'empty',
      trustedAgentIds: toSet(o.trustedAgentIds),
      priorityOrderRound1: (Array.isArray(o.priorityOrderRound1)
        ? o.priorityOrderRound1.slice()
        : ['meeting', 'central', 'manufactB', 'manufactA', 'culture']).filter(k => ROOM_KEYS.includes(k)),
      priorityOrderRound2: (Array.isArray(o.priorityOrderRound2)
        ? o.priorityOrderRound2.slice()
        : ['meeting', 'manufactB', 'manufactA', 'culture', 'central']).filter(k => ROOM_KEYS.includes(k)),
      meetingPriorityEnabled: !!o.meetingPriorityEnabled,
      priorityFillEnabled: !!o.priorityFillEnabled,
      materialPriority,
      missingClues: toSet(o.missingClues),
      excludedClues: o.excludedClues === undefined ? new Set([3, 7]) : toSet(o.excludedClues),
      cultureTypes,
      culturePriority,
      priorityWeights,
      cRestHigh: typeof o.cRestHigh === 'number' && isFinite(o.cRestHigh) && o.cRestHigh > 0
        ? o.cRestHigh : C_REST_BASE * 1.48,
      optimize: (o.optimize === false || o.optimize === 'none') ? 'none' : 'local',
      optimizeIterations: Number.isFinite(Number(o.optimizeIterations))
        ? Math.max(0, Math.min(50, Number(o.optimizeIterations)))
        : 8,
    };
  }

  // ------------------------------------------------------------
  // 2. 评分
  // ------------------------------------------------------------
  function computeScoresForAll(operators, options) {
    const opt = normalizeOptions(options);
    const scores = [];
    for (const op of operators || []) {
      if (!op || op.eliteLevel === 'none') continue;
      const isBasic = op.eliteLevel === '精零';
      const row = {
        opId: op.id,
        id: op.id,
        name: op.name,
        mergedTraits: isBasic ? [] : (op.mergedTraits || []),
        score: { central: 0, meeting: 0, culture: 0, manufact: 0, expScore: 0, weaponScore: 0, moodReduce: 0, clue: 0 },
        isBasic,
      };
      if (!isBasic) {
        for (const t of row.mergedTraits) {
          const room = t.舱室, type = t.类型, val = t.数值 || 0;
          if (room === '总控中枢' && type === '心情恢复提升') row.score.central += val;
          else if (room === '会客室') {
            if (type === '收集线索效率') row.score.meeting += val;
            else if (type === '心情消耗减少') { row.score.meeting += val * MOOD_WEIGHT; row.score.moodReduce += val; }
            else if (isCluePower(type)) {
              const n = parseInt(t.线索编号, 10);
              if (opt.missingClues.has(n) || !opt.excludedClues.has(n)) {
                row.score.clue += val;
              }
            }
          } else if (room === '培养舱') {
            if (type === '心情消耗减少') { row.score.culture += val * MOOD_WEIGHT; row.score.moodReduce += val; }
            else {
              const product = { '矿物效率': 'mineral', '菌类效率': 'fungi', '晶植效率': 'plant' }[type];
              if (product && opt.cultureTypes.includes(product)) {
                const rank = opt.culturePriority.indexOf(product);
                const w = rank >= 0 ? (opt.priorityWeights[rank] !== undefined ? opt.priorityWeights[rank] : 0.1) : 1.0;
                row.score.culture += val * w;
              }
            }
          } else if (room === '制造舱') {
            if (type === '干员素材效率') {
              row.score.expScore += val;
              if (opt.mode === 'dual' || opt.mode === 'exp') row.score.manufact += val;
            } else if (type === '武器素材效率') {
              row.score.weaponScore += val;
              if (opt.mode === 'dual' || opt.mode === 'weapon') row.score.manufact += val;
            } else if (type === '心情消耗减少') {
              row.score.manufact += val * MOOD_WEIGHT;
              row.score.moodReduce += val;
            }
          }
        }
      }
      scores.push(row);
    }
    return scores;
  }

  // ------------------------------------------------------------
  // 3. 每干员、每舱室贡献缓存（局部搜索的性能基础）
  // ------------------------------------------------------------
  function buildContribMap(scores, opt) {
    const map = new Map();
    for (const s of scores) {
      const c = {
        central: { eff: 0, reduce: 0 },
        meeting: { eff: 0, reduce: 0, clueHits: 0, clueUseful: 0, clueAny: 0 },
        culture: { eff: 0, reduce: 0, byProduct: { mineral: 0, fungi: 0, plant: 0 } },
        manufactA: { eff: 0, reduce: 0 },
        manufactB: { eff: 0, reduce: 0 },
      };
      for (const t of s.mergedTraits || []) {
        const val = t.数值 || 0;
        const room = t.舱室;
        if (room === '总控中枢' && t.类型 === '心情恢复提升') c.central.eff += val;
        else if (room === '会客室') {
          if (t.类型 === '收集线索效率') c.meeting.eff += val;
          else if (t.类型 === '心情消耗减少') c.meeting.reduce += val;
          else if (isCluePower(t.类型)) {
            const n = parseInt(t.线索编号, 10);
            c.meeting.clueAny++;
            if (opt.missingClues.has(n)) c.meeting.clueHits++;
            if (opt.missingClues.has(n) || !opt.excludedClues.has(n)) c.meeting.clueUseful++;
          }
        } else if (room === '培养舱') {
          if (t.类型 === '心情消耗减少') c.culture.reduce += val;
          else {
            const p = { '矿物效率': 'mineral', '菌类效率': 'fungi', '晶植效率': 'plant' }[t.类型];
            if (p) {
              c.culture.byProduct[p] += val;
              if (opt.cultureTypes.includes(p)) c.culture.eff += val;
            }
          }
        } else if (room === '制造舱') {
          if (t.类型 === '心情消耗减少') { c.manufactA.reduce += val; c.manufactB.reduce += val; }
          else if (t.类型 === '干员素材效率') {
            if (opt.manufactProducts.manufactA === 'exp') c.manufactA.eff += val;
            if (opt.manufactProducts.manufactB === 'exp') c.manufactB.eff += val;
          } else if (t.类型 === '武器素材效率') {
            if (opt.manufactProducts.manufactA === 'weapon') c.manufactA.eff += val;
            if (opt.manufactProducts.manufactB === 'weapon') c.manufactB.eff += val;
          }
        }
      }
      map.set(s.opId, c);
    }
    return map;
  }

  function groupStats(members, roomKey, opt, contrib, product) {
    let n = 0, eff = 0, reduce = 0, clueHits = 0, clueUseful = 0;
    for (const m of members || []) {
      if (!m) continue;
      n++;
      const c = contrib.get(opIdOf(m));
      if (!c) continue;
      const r = c[roomKey];
      if (!r) continue;
      reduce += r.reduce || 0;
      if (roomKey === 'culture' && product) eff += (r.byProduct && r.byProduct[product]) || 0;
      else eff += r.eff || 0;
      if (roomKey === 'meeting') { clueHits += r.clueHits || 0; clueUseful += r.clueUseful || 0; }
    }
    return {
      n, eff, reduce, clueHits, clueUseful,
      rate: (1 + eff / 100) * (1 + 0.4 * n),
      cWork: C_WORK_BASE * Math.max(0.1, 1 - reduce / 100),
    };
  }

  function centralRestoreOf(members) {
    let r = 0;
    for (const m of members || []) {
      if (!m) continue;
      for (const t of m.mergedTraits || []) {
        if (t.舱室 === '总控中枢' && t.类型 === '心情恢复提升') r += t.数值 || 0;
      }
    }
    return r;
  }

  // ------------------------------------------------------------
  // 4. 稳态循环（唯一时间模型）
  // ------------------------------------------------------------
  function solveSteadyLoop(a, b, cRestHigh, cRestLow) {
    if (!a || !b || a.n === 0 || b.n === 0) {
      return { feasible: false, output: 0, hHigh: 13, hLow: 11, highIsA: true };
    }
    let highIsA = a.rate >= b.rate;
    let high = highIsA ? a : b;
    let low = highIsA ? b : a;
    let best = -1, bestH = 13, found = false;
    for (let hHigh = 1; hHigh <= 23; hHigh++) {
      const hLow = 24 - hHigh;
      const effHighWork = Math.min(hHigh, 100 / high.cWork);
      const effLowWork = Math.min(hLow, 100 / low.cWork);
      if (effHighWork * high.cWork > hLow * cRestHigh + 1e-6) continue;
      if (effLowWork * low.cWork > hHigh * cRestLow + 1e-6) continue;
      const out = high.rate * effHighWork + low.rate * effLowWork;
      if (!found || out > best) { best = out; bestH = hHigh; found = true; }
    }
    if (!found) {
      // 无可行解：退化为“高效组能工作多久就工作多久”，并明确标记
      const hHigh = Math.max(1, Math.min(23, Math.floor(Math.min(100 / high.cWork, 24 * cRestHigh / (high.cWork + cRestHigh)))));
      const hLow = 24 - hHigh;
      const output = high.rate * Math.min(hHigh, 100 / high.cWork) + low.rate * Math.min(hLow, 100 / low.cWork);
      return { feasible: false, output, hHigh, hLow, highIsA };
    }
    return { feasible: true, output: best, hHigh: bestH, hLow: 24 - bestH, highIsA };
  }

  function pairOutput(a, b, cRestHigh, cRestLow) {
    return solveSteadyLoop(a, b, cRestHigh, cRestLow).output;
  }

  /**
   * 培养舱多产物：同一组人、同一时间段，按优先级权重累加各产物产出。
   * 先按“全部产物合计效率”确定高效组与可行时段，再在时段内按权重寻优。
   */
  function cultureSingle(A, opt, contrib) {
    if (!A || A.length === 0) return 0;
    let total = 0;
    opt.culturePriority.forEach((p, i) => {
      const g = groupStats(A, 'culture', opt, contrib, p);
      const w = opt.priorityWeights[i] !== undefined ? opt.priorityWeights[i] : 0.1;
      total += w * g.rate * Math.min(24, 100 / g.cWork);
    });
    return total;
  }

  function cultureOutput(A, B, opt, contrib, cRestHigh, cRestLow) {
    const products = opt.culturePriority.slice();
    if ((!A || A.length === 0) && (!B || B.length === 0)) return 0;
    // 只有一侧有人：按单轮处理，避免把“空 A / 有人 B”误算成双轮
    if (!B || B.length === 0) return cultureSingle(A, opt, contrib);
    if (!A || A.length === 0) return cultureSingle(B, opt, contrib);
    const combinedA = groupStats(A, 'culture', opt, contrib);
    const combinedB = groupStats(B, 'culture', opt, contrib);
    const base = solveSteadyLoop(combinedA, combinedB, cRestHigh, cRestLow);
    const highIsA = base.highIsA;
    const highCombined = highIsA ? combinedA : combinedB;
    const lowCombined = highIsA ? combinedB : combinedA;
    let best = -1, found = false;
    for (let hHigh = 1; hHigh <= 23; hHigh++) {
      const hLow = 24 - hHigh;
      const effHighWork = Math.min(hHigh, 100 / highCombined.cWork);
      const effLowWork = Math.min(hLow, 100 / lowCombined.cWork);
      if (effHighWork * highCombined.cWork > hLow * cRestHigh + 1e-6) continue;
      if (effLowWork * lowCombined.cWork > hHigh * cRestLow + 1e-6) continue;
      let out = 0;
      products.forEach((p, i) => {
        const ga = groupStats(A, 'culture', opt, contrib, p);
        const gb = groupStats(B, 'culture', opt, contrib, p);
        const highRate = highIsA ? ga.rate : gb.rate;
        const lowRate = highIsA ? gb.rate : ga.rate;
        const w = opt.priorityWeights[i] !== undefined ? opt.priorityWeights[i] : 0.1;
        out += w * (highRate * effHighWork + lowRate * effLowWork);
      });
      if (!found || out > best) { best = out; found = true; }
    }
    if (found) return best;
    let out = 0;
    products.forEach((p, i) => {
      const ga = groupStats(A, 'culture', opt, contrib, p);
      const gb = groupStats(B, 'culture', opt, contrib, p);
      const w = opt.priorityWeights[i] !== undefined ? opt.priorityWeights[i] : 0.1;
      out += w * (ga.rate * Math.min(12, 100 / ga.cWork) + gb.rate * Math.min(12, 100 / gb.cWork));
    });
    return out;
  }

  function singleOutput(A, roomKey, opt, contrib) {
    const g = groupStats(A, roomKey, opt, contrib);
    if (g.n === 0) return 0;
    return g.rate * Math.min(24, 100 / g.cWork);
  }

  function restRates(state) {
    const r1 = centralRestoreOf(state.central.r1);
    const r2 = centralRestoreOf(state.central.r2);
    return {
      r1, r2,
      cRest1: C_REST_BASE * (1 + r1 / 100),
      cRest2: C_REST_BASE * (1 + r2 / 100),
      high: Math.max(C_REST_BASE * (1 + r1 / 100), C_REST_BASE * (1 + r2 / 100)),
      low: Math.min(C_REST_BASE * (1 + r1 / 100), C_REST_BASE * (1 + r2 / 100)),
    };
  }

  // ------------------------------------------------------------
  // 5. 初始贪心分配
  // ------------------------------------------------------------
  function fieldFor(roomKey, modeOrOpt) {
    if (roomKey === 'central') return 'central';
    if (roomKey === 'meeting') return 'meeting';
    if (roomKey === 'culture') return 'culture';
    if (roomKey === 'manufactA' || roomKey === 'manufactB') {
      if (modeOrOpt && typeof modeOrOpt === 'object' && modeOrOpt.manufactProducts) {
        return modeOrOpt.manufactProducts[roomKey] === 'weapon' ? 'weaponScore' : 'expScore';
      }
      const mode = modeOrOpt;
      if (roomKey === 'manufactA') return mode === 'weapon' ? 'weaponScore' : 'expScore';
      return mode === 'exp' ? 'expScore' : 'weaponScore';
    }
    return 'manufact';
  }

  function hasMeetingTalent(s, opt) {
    for (const t of s.mergedTraits || []) {
      if (t.舱室 !== '会客室') continue;
      if (t.类型 === '收集线索效率' || t.类型 === '心情消耗减少') return true;
      if (isCluePower(t.类型)) {
        const n = parseInt(t.线索编号, 10);
        if (opt.missingClues.has(n)) return true;
        if (!opt.excludedClues.has(n)) return true;
      }
    }
    return false;
  }

  function hasMeetingCore(s, opt) {
    for (const t of s.mergedTraits || []) {
      if (t.舱室 !== '会客室') continue;
      if (t.类型 === '收集线索效率') return true;
      if (isCluePower(t.类型)) {
        const n = parseInt(t.线索编号, 10);
        if (opt.missingClues.has(n) || !opt.excludedClues.has(n)) return true;
      }
    }
    return false;
  }

  function meetingInfoOf(s, opt) {
    let eff = 0, mood = 0, clue = 0, missing = false, excluded = false;
    for (const t of s.mergedTraits || []) {
      if (t.舱室 !== '会客室') continue;
      if (t.类型 === '收集线索效率') eff += t.数值 || 0;
      else if (t.类型 === '心情消耗减少') mood += t.数值 || 0;
      else if (isCluePower(t.类型)) {
        const n = parseInt(t.线索编号, 10);
        if (opt.missingClues.has(n)) missing = true;
        else if (opt.excludedClues.has(n)) excluded = true;
        else clue += t.数值 || 0;
      }
    }
    return { eff, mood, clue, missing, excluded };
  }

  function meetingTierOf(s, opt, roundKey) {
    const info = meetingInfoOf(s, opt);
    if (info.eff > 0) return 5;
    if (info.clue > 0 || info.missing) {
      if (roundKey === 'r2') {
        if (info.missing) return 4;
        if (info.clue > 0) return 3;
      } else {
        if (info.missing) return 3;
        if (info.clue > 0) return 2;
      }
    }
    // 有总控恢复天赋、但没有会客室效率/线索的干员，优先留给总控；
    // 心情减耗不能压过总控恢复，否则会被会客室先拿走。
    if ((s.score.central || 0) > 0 && info.mood > 0) return 1;
    if (roundKey === 'r2') {
      if (info.missing) return 4;
      if (info.clue > 0) return 3;
      if (info.mood > 0) return 2;
    } else {
      if (info.mood > 0) return 4;
      if (info.missing) return 3;
      if (info.clue > 0) return 2;
    }
    if (info.excluded) return -1;
    if (!hasAnyBenefit(s)) return 1;
    return 0;
  }

  function meetingRankOf(s, opt, roundKey) {
    const info = meetingInfoOf(s, opt);
    // 两轮使用不同的心情有效权重：一轮心情高于线索概率，二轮线索概率高于心情。
    const moodWeight = roundKey === 'r2' ? 0.5 : 2.5;
    return meetingTierOf(s, opt, roundKey) * 1e6 +
      info.eff * 100 + (info.missing ? 80 : 0) +
      (info.clue > 0 ? CLUE_PROB_BASE + info.clue * CLUE_PROB_VALUE_WEIGHT : 0) +
      info.mood * moodWeight;
  }

  function hasAnyMeetingTrait(s) {
    return (s.mergedTraits || []).some(t => t.舱室 === '会客室');
  }

  function makeState() {
    const s = {};
    for (const k of ROOM_KEYS) s[k] = { r1: [], r2: [] };
    return s;
  }

  function allAssigned(state) {
    const out = [];
    for (const k of ROOM_KEYS) out.push(...state[k].r1, ...state[k].r2);
    return out;
  }

  function materialRooms(material, opt) {
    const active = k => opt.roomModes[k] !== 'empty';
    if (material === 'clue') return active('meeting') ? ['meeting'] : [];
    if (material === 'culture') return active('culture') ? ['culture'] : [];
    if (material === 'weapon') {
      return ['manufactA', 'manufactB'].filter(k => active(k) && opt.manufactProducts[k] === 'weapon');
    }
    if (material === 'exp') {
      return ['manufactA', 'manufactB'].filter(k => active(k) && opt.manufactProducts[k] === 'exp');
    }
    return [];
  }

  function productionOrder(opt, round) {
    const order = [];
    const add = k => {
      if (k !== 'central' && opt.roomModes[k] !== 'empty' &&
          (round === 1 || opt.doubleRooms.includes(k)) &&
          !order.includes(k)) order.push(k);
    };

    // 材料优先级 → 生产舱顺序；未启用/未选择的材料自动从链路剔除。
    for (const material of opt.materialPriority) {
      for (const k of materialRooms(material, opt)) add(k);
    }

    // 防御：任何启用但未映射的生产舱补在末尾。
    for (const k of PRODUCTION_KEYS) add(k);
    return order;
  }

  function assignProduction(state, scores, opt) {
    const assigned = new Set();
    const trust = opt.trustedAgentIds;
    const pool = scores.filter(s => !trust.has(opIdOf(s)));

    const pickBest = (key, candidates, pass, roundKey) => {
      if (!candidates.length) return null;
      const moodWeight = roundKey === 'r2' ? 0 : MOOD_WEIGHT;
      const productivityWeight = roundKey === 'r2' ? 0 : 0.6;
      const meetingSel = s => (s.score.meeting || 0) - (MOOD_WEIGHT - moodWeight) * (s.score.moodReduce || 0);
      const cultureSel = s => (s.score.culture || 0) - (MOOD_WEIGHT - moodWeight) * (s.score.moodReduce || 0);
      const scored = candidates.map(s => {
        let v = 0;
        if (pass === 'specialist') {
          if (key === 'meeting') {
            v = meetingRankOf(s, opt, roundKey);
          } else if (key === 'culture') v = cultureSel(s);
          else v = s.score[fieldFor(key, opt)] || 0;
        } else if (pass === 'mood') {
          v = (s.score.moodReduce || 0) * moodWeight;
          if (key === 'meeting') v = meetingRankOf(s, opt, roundKey);
        } else {
          // 兜底：优先不抢总控恢复人才，再看生产分数
          v = (s.score.central || 0) > 0 ? -1e6 : 0;
          v += productionValue(s, opt, productivityWeight);
        }
        return { s, v };
      });
      scored.sort((a, b) => b.v - a.v || productionValue(a.s, opt, productivityWeight) - productionValue(b.s, opt, productivityWeight));
      return scored[0].s;
    };

    const fillRound = (roundKey, order) => {
      const runPass = (pass, keys) => {
        for (const key of keys) {
          const arr = state[key][roundKey];
          while (arr.length < CAP) {
            let cands = pool.filter(s => !assigned.has(s.opId));
            if (pass === 'specialist') {
              cands = cands.filter(s => {
                if (key === 'meeting') {
                  if (roundKey === 'r2') return hasMeetingCore(s, opt);
                  return hasMeetingTalent(s, opt) || (s.score.meeting || 0) > 0;
                }
                if (key === 'culture') return (s.score.culture || 0) > 0;
                return (s.score[fieldFor(key, opt)] || 0) > 0;
              });
            } else if (pass === 'mood') {
              cands = cands.filter(s => (s.score.moodReduce || 0) > 0);
              if (key === 'meeting') {
                cands = cands.filter(s => roundKey === 'r2' ? hasMeetingCore(s, opt) : hasMeetingTalent(s, opt));
              }
            } else if (key === 'meeting') {
              // 会客室兜底只接受会客室天赋或无增益干员；排除线索干员不进入平铺。
              cands = cands.filter(s => (!hasAnyBenefit(s) || hasMeetingTalent(s, opt)) && !hasExcludedClueOnly(s, opt));
            }
            if (!cands.length) break;
            const picked = pickBest(key, cands, pass, roundKey);
            if (!picked) break;
            arr.push(picked);
            assigned.add(picked.opId);
          }
        }
      };

      const hasMeeting = order.includes('meeting');
      const primary = order.filter(k => k !== 'meeting');

      // 按 productionOrder 严格顺序执行；会客室在素材优先级第一时先选，
      // 不再为了制造舱把会客室心情干员推迟到最后。
      for (const pass of ['specialist', 'mood', 'generic']) runPass(pass, order);
    };

    fillRound('r1', productionOrder(opt, 1));
    fillRound('r2', productionOrder(opt, 2));
    return assigned;
  }

  // ------------------------------------------------------------
  // 6. 优先满舱：按“最低 1+1 → 高优先级补满 → 低优先级保底”构建全局方案
  // ------------------------------------------------------------
  function assignPriorityPlan(state, scores, opt, warnings, contrib) {
    const used = new Set();
    const add = (s, key, round) => {
      if (!s || used.has(opIdOf(s))) return false;
      if (state[key][round].length >= CAP) return false;
      state[key][round].push(s);
      used.add(opIdOf(s));
      return true;
    };
    const candidates = () => scores.filter(s => !used.has(opIdOf(s)));

    const roleValue = (s, key) => {
      if (!s || !s.score) return -1e9;
      if (key === 'meeting') return (s.score.meeting || 0) + (s.score.clue || 0) * 0.12 + (s.score.moodReduce || 0) * 0.25;
      if (key === 'culture') return (s.score.culture || 0) + (s.score.moodReduce || 0) * 0.2;
      if (key === 'manufactA' || key === 'manufactB') return (s.score[fieldFor(key, opt)] || 0) + (s.score.moodReduce || 0) * 0.15;
      if (key === 'central') return s.score.central || 0;
      return 0;
    };
    const fitValue = (s, key) => {
      if (!s || !s.score) return -1e9;
      if (key === 'meeting') return (s.score.meeting || 0) + (s.score.clue || 0) * 0.1;
      if (key === 'culture') return s.score.culture || 0;
      if (key === 'manufactA' || key === 'manufactB') return s.score[fieldFor(key, opt)] || 0;
      if (key === 'central') return s.score.central || 0;
      return 0;
    };
    const pick = (key, allowFallback) => {
      const all = candidates();
      if (!all.length) return null;
      const isGeneric = s => !(s.score.expScore || 0) && !(s.score.weaponScore || 0) && !(s.score.culture || 0) && !(s.score.meeting || 0);
      const allowed = all.filter(s => fitValue(s, key) > 0 || isGeneric(s));
      const list = allowed.length ? allowed : (allowFallback ? all : []);
      if (!list.length) return null;
      list.sort((a, b) => fitValue(b, key) - fitValue(a, key) || roleValue(b, key) - roleValue(a, key) || productionValue(a, opt) - productionValue(b, opt));
      return list[0];
    };

    // 总控：B 高恢复组，A 低恢复组。
    if (!opt.centralDisabled && opt.roomModes.central !== 'empty') {
      const centralScores = scores.filter(s => (s.score.central || 0) > 0)
        .sort((a, b) => (b.score.central || 0) - (a.score.central || 0) || clueValueOf(a) - clueValueOf(b) || productionValue(a, opt) - productionValue(b, opt));
      const centralTrust = scores.filter(s => opt.trustedAgentIds.has(opIdOf(s)));
      const centralPool = opt.doubleRooms.includes('central')
        ? [...centralTrust, ...centralScores]
        : [...centralTrust, ...centralScores];
      for (const s of centralPool) {
        if (state.central.r2.length >= CAP) break;
        add(s, 'central', 'r2');
      }
      // A 班低恢复：优先低恢复、无线索概率的纯恢复干员，至少 1 人。
      const lowPool = candidates()
        .filter(s => (s.score.central || 0) > 0)
        .sort((a, b) => (a.score.central || 0) - (b.score.central || 0) || meetingRankOf(a, opt, 'r2') - meetingRankOf(b, opt, 'r2') || clueValueOf(a) - clueValueOf(b) || productionValue(a, opt) - productionValue(b, opt));
      if (lowPool.length) add(lowPool[0], 'central', 'r1');
      else {
        const any = pick('central', true);
        if (any) add(any, 'central', 'r1');
      }
    }

    // 先给每个生产舱每班留 1 人；从最低优先级开始，保留高优先级专家。
    const order = productionOrder(opt, 1);
    const giveMin = (key) => {
      const rounds = opt.doubleRooms.includes(key) ? ['r1', 'r2'] : ['r1'];
      for (const round of rounds) {
        if (state[key][round].length > 0) continue;
        const s = pick(key, true);
        if (s) add(s, key, round);
      }
    };
    for (const key of order.slice().reverse()) giveMin(key);

    // 按材料优先级高→低补满；低优先级只保留 1+1。
    for (const key of order) {
      const rounds = opt.doubleRooms.includes(key) ? ['r1', 'r2'] : ['r1'];
      for (const round of rounds) {
        while (state[key][round].length < CAP) {
          const s = pick(key, false);
          if (!s) break;
          add(s, key, round);
        }
      }
    }

    return used;
  }


  function productionValue(s, opt, moodWeight) {
    // 用“最擅长的生产舱分数 + 心情减耗机会成本”近似机会成本。
    const mode = opt.mode;
    const mw = typeof moodWeight === 'number' ? moodWeight : 0.6;
    const m = Math.max(
      mode === 'weapon' ? 0 : (s.score.expScore || 0),
      mode === 'exp' ? 0 : (s.score.weaponScore || 0),
      s.score.meeting || 0,
      s.score.culture || 0,
      (s.score.moodReduce || 0) * mw
    );
    return m;
  }

  function assignCentral(state, scores, opt) {
    if (opt.centralDisabled) {
      return { unassignedTrust: scores.filter(s => opt.trustedAgentIds.has(opIdOf(s))) };
    }
    const usedInProd = new Set();
    for (const k of PRODUCTION_KEYS) {
      for (const s of state[k].r1) usedInProd.add(opIdOf(s));
      for (const s of state[k].r2) usedInProd.add(opIdOf(s));
    }
    const spare = scores.filter(s => !usedInProd.has(opIdOf(s)));
    const trust = opt.trustedAgentIds;
    const isDouble = opt.doubleRooms.includes('central');

    const withTalent = spare.filter(s => (s.score.central || 0) > 0).sort((a, b) => {
      const d = (b.score.central || 0) - (a.score.central || 0);
      if (d !== 0) return d;
      // 同恢复量：非信赖优先（B 班留给真正能提供恢复的人）
      const at = trust.has(opIdOf(a)) ? 1 : 0;
      const bt = trust.has(opIdOf(b)) ? 1 : 0;
      if (at !== bt) return at - bt;
      return productionValue(a, opt) - productionValue(b, opt);
    });
    const noTalent = spare.filter(s => !(s.score.central > 0)).sort((a, b) => {
      const at = trust.has(opIdOf(a)) ? 0 : 1;
      const bt = trust.has(opIdOf(b)) ? 0 : 1;
      if (at !== bt) return at - bt;
      return productionValue(a, opt) - productionValue(b, opt);
    });

    const high = withTalent.slice(0, CAP);
    const highIds = new Set(high.map(opIdOf));

    let low = [];
    if (isDouble) {
      // A 班：无天赋信赖优先收容，再放剩余有天赋/普通人
      low = noTalent.filter(s => trust.has(opIdOf(s))).slice(0, CAP);
      const lowIds = new Set(low.map(opIdOf));
      const rest = withTalent
        .filter(s => !highIds.has(opIdOf(s)) && !lowIds.has(opIdOf(s)))
        .sort((a, b) => (a.score.central || 0) - (b.score.central || 0) || clueValueOf(a) - clueValueOf(b) || productionValue(a, opt) - productionValue(b, opt));
      for (const s of rest) { if (low.length >= CAP) break; low.push(s); }
      for (const s of noTalent) {
        if (low.length >= CAP) break;
        if (lowIds.has(opIdOf(s)) || highIds.has(opIdOf(s))) continue;
        low.push(s);
      }
      // A 班（第一班）优先高恢复组；B 班（第二班）最后用剩余人员。
      state.central.r1 = high;
      state.central.r2 = low;
    } else {
      // 单轮总控：信赖优先收容（用户明确选择），再用恢复量最高的补位
      const trustSpare = spare
        .filter(s => trust.has(opIdOf(s)))
        .sort((a, b) => (b.score.central || 0) - (a.score.central || 0));
      const chosen = trustSpare.slice(0, CAP);
      const chosenIds = new Set(chosen.map(opIdOf));
      for (const s of withTalent) {
        if (chosen.length >= CAP) break;
        if (chosenIds.has(opIdOf(s))) continue;
        chosen.push(s); chosenIds.add(opIdOf(s));
      }
      for (const s of noTalent) {
        if (chosen.length >= CAP) break;
        if (chosenIds.has(opIdOf(s))) continue;
        chosen.push(s); chosenIds.add(opIdOf(s));
      }
      state.central.r1 = chosen;
      state.central.r2 = [];
    }

    const unassignedTrust = spare.filter(s => trust.has(opIdOf(s)) &&
      !state.central.r1.some(x => opIdOf(x) === opIdOf(s)) &&
      !state.central.r2.some(x => opIdOf(x) === opIdOf(s)));
    return { unassignedTrust };
  }

  // 双班总控至少每班 1 人；不足时从“可接受不满员”舱室借 1 人。
  // 若可接受舱室就是总控，则把高恢复组拆成 1+2 / 1+1，降低高恢复组值。
  function enforceCentralMinimum(state, opt, warnings, contrib) {
    if (opt.centralDisabled || !opt.doubleRooms.includes('central')) return;
    const c = state.central;
    const slots = [c.r1, c.r2];
    const emptySlots = slots.filter(a => a.length === 0);
    if (emptySlots.length === 0) {
      // A 班保留高恢复组；B 班允许更低，不再交换 A/B。
      return;
    }

    for (const target of emptySlots) {
      if (opt.underfillRoom === 'central') {
        const donor = target === c.r1 ? c.r2 : c.r1;
        if (donor.length > 1) {
          target.push(donor.pop());
          continue;
        }
        warnings.push('总控双班要求每班至少 1 人，但可用干员不足；已保留现有人员。');
        continue;
      }

      const room = state[opt.underfillRoom];
      if (!room || opt.roomModes[opt.underfillRoom] === 'empty') {
        warnings.push(`“可接受不满员”舱室不可用，无法为总控补足每班 1 人。`);
        continue;
      }

      // 从来源舱两个班次中评估：移除谁对该班效率损失最小。
      // 效率损失用 groupStats 的 rate 前后差衡量，而不是简单按人数或分数。
      const candidates = [];
      for (const arr of [room.r1, room.r2]) {
        if (arr.length <= 1) continue;
        const before = groupStats(arr, opt.underfillRoom, opt, contrib).rate;
        for (const s of arr) {
          const afterArr = arr.filter(x => x !== s);
          const after = groupStats(afterArr, opt.underfillRoom, opt, contrib).rate;
          candidates.push({
            arr, s,
            loss: before - after,
            centralGain: centralRestoreOf([s]),
            production: productionValue(s, opt),
          });
        }
      }
      if (candidates.length === 0) {
        warnings.push(`“${RAW_ROOM[opt.underfillRoom] || opt.underfillRoom}”没有可借出的人员，总控仍有空置班。`);
        continue;
      }
      candidates.sort((a, b) => {
        if (Math.abs(a.loss - b.loss) > 1e-9) return a.loss - b.loss;
        if (b.centralGain !== a.centralGain) return b.centralGain - a.centralGain;
        return a.production - b.production;
      });
      const picked = candidates[0];
      picked.arr.splice(picked.arr.indexOf(picked.s), 1);
      target.push(picked.s);
    }
  }

  // 选择总控为“可接受不满员”时，高恢复组最多 2 人，允许 1+2 / 1+1。
  function enforceCentralUnderfill(state, opt) {
    if (opt.underfillRoom !== 'central' || !opt.doubleRooms.includes('central')) return;
    const c = state.central;
    while (c.r1.length > 2 && c.r2.length < CAP) c.r2.push(c.r1.pop());
  }

  // 总控 A 班优先拿高恢复组：从已在生产舱/总控 B 班的人员中，
  // 用更高恢复的干员替换 A 班较弱的非信赖成员，不改变总人数。
  function improveCentralA(state, opt, scores, contrib) {
    if (opt.centralDisabled || opt.roomModes.central === 'empty') return;
    const target = state.central.r1;
    const trust = opt.trustedAgentIds;
    const allSlots = [];
    for (const key of ROOM_KEYS) {
      if (opt.roomModes[key] === 'empty') continue;
      // 会客室选人优先级高于总控 A 的恢复微调，不能从这里抢走线索干员。
      if (key === 'meeting') continue;
      for (const round of ['r1', 'r2']) {
        if (round === 'r2' && !opt.doubleRooms.includes(key)) continue;
        if (key === 'central' && round === 'r1') continue;
        state[key][round].forEach((s, idx) => allSlots.push({ key, round, idx, s }));
      }
    }
    const top = scores
      .filter(s => (s.score.central || 0) > 0 && !target.some(x => opIdOf(x) === opIdOf(s)))
      .sort((a, b) => (b.score.central || 0) - (a.score.central || 0) || productionValue(a, opt) - productionValue(b, opt));

    for (const cand of top) {
      const existing = target.some(x => opIdOf(x) === opIdOf(cand));
      if (existing) continue;
      const slot = allSlots.find(x => opIdOf(x.s) === opIdOf(cand));
      if (target.length < CAP) {
        if (slot) {
          const arr = state[slot.key][slot.round];
          const at = arr.findIndex(x => opIdOf(x) === opIdOf(cand));
          if (at >= 0) arr.splice(at, 1);
        }
        target.push(cand);
        continue;
      }
      const weak = target
        .filter(s => !trust.has(opIdOf(s)))
        .sort((a, b) => (a.score.central || 0) - (b.score.central || 0))[0];
      if (!weak) break;
      if ((cand.score.central || 0) <= (weak.score.central || 0)) break;
      if (!slot) continue;
      const sourceArr = state[slot.key][slot.round];
      const targetIdx = target.indexOf(weak);
      sourceArr[slot.idx] = weak;
      target[targetIdx] = cand;
      allSlots.forEach(x => { if (x.s === weak) { x.key = 'central'; x.round = 'r1'; x.idx = targetIdx; } });
    }
  }

  // 双轮舱室至少每班 1 人，否则无法开启二轮；空班从其它舱借人。
  function enforceDoubleMinimums(state, opt, warnings, contrib) {
    const active = ROOM_KEYS.filter(k => opt.roomModes[k] !== 'empty');
    for (const key of active) {
      const rounds = opt.doubleRooms.includes(key) ? ['r1', 'r2'] : ['r1'];
      for (const round of rounds) {
        const target = state[key][round];
        if (target.length > 0) continue;
        // 二轮保底优先从本舱另一轮转移，避免把 3+1 拆成 2+2，也不跨舱抢人。
        if (opt.doubleRooms.includes(key)) {
          const otherRound = round === 'r1' ? 'r2' : 'r1';
          const ownDonor = state[key][otherRound];
          if (ownDonor.length > 1) {
            target.push(ownDonor.pop());
            continue;
          }
        }
        const candidates = [];
        for (const sourceKey of active) {
          if (sourceKey === key) continue;
          if (sourceKey === 'central') continue;
          const sourceRounds = opt.doubleRooms.includes(sourceKey) ? ['r1', 'r2'] : ['r1'];
          for (const sourceRound of sourceRounds) {
            const arr = state[sourceKey][sourceRound];
            if (arr.length <= 1) continue;
            const before = groupStats(arr, sourceKey, opt, contrib).rate;
            for (const s of arr) {
              const fit = canFillTarget(s, key, opt) ? 1 : 0;
              const after = groupStats(arr.filter(x => x !== s), sourceKey, opt, contrib).rate;
              candidates.push({ sourceKey, arr, s, fit, loss: before - after, production: productionValue(s, opt) });
            }
          }
        }
        if (!candidates.length) {
          warnings.push(`“${RAW_ROOM[key] || key}”二轮已开启，但没有可用干员补足空班。`);
          continue;
        }
        candidates.sort((a, b) => b.fit - a.fit || a.loss - b.loss || a.production - b.production);
        const picked = candidates[0];
        picked.arr.splice(picked.arr.indexOf(picked.s), 1);
        target.push(picked.s);
      }
    }
  }

  // 策略靠前的生产舱尽可能补满；只从优先级更低的舱室借人，并保留来源至少 1 人。
  function enforcePriorityFill(state, opt, warnings, contrib) {
    const order = productionOrder(opt, 1);
    for (const key of order) {
      if (opt.roomModes[key] === 'empty') continue;
      const idx = order.indexOf(key);
      const rounds = opt.doubleRooms.includes(key) ? ['r1', 'r2'] : ['r1'];
      for (const round of rounds) {
        const target = state[key][round];
        while (target.length < CAP) {
          const candidates = [];
          const targetBefore = groupStats(target, key, opt, contrib).rate;
          for (const sourceKey of order.slice(idx + 1)) {
            if (opt.roomModes[sourceKey] === 'empty') continue;
            const sourceRounds = opt.doubleRooms.includes(sourceKey) ? ['r1', 'r2'] : ['r1'];
            for (const sourceRound of sourceRounds) {
              const arr = state[sourceKey][sourceRound];
              if (arr.length <= 1) continue;
              const before = groupStats(arr, sourceKey, opt, contrib).rate;
              for (const s of arr) {
                if (!canFillTarget(s, key, opt)) continue;
                const after = groupStats(arr.filter(x => x !== s), sourceKey, opt, contrib).rate;
                const gain = groupStats(target.concat(s), key, opt, contrib).rate - targetBefore;
                candidates.push({
                  arr, s,
                  sourcePriority: order.indexOf(sourceKey),
                  loss: before - after,
                  gain,
                  production: productionValue(s, opt),
                });
              }
            }
          }
          if (!candidates.length) break;
          candidates.sort((a, b) =>
            b.sourcePriority - a.sourcePriority ||
            a.loss - b.loss ||
            b.gain - a.gain ||
            a.production - b.production
          );
          const picked = candidates[0];
          picked.arr.splice(picked.arr.indexOf(picked.s), 1);
          target.push(picked.s);
        }
      }
    }
  }


  function canFillTarget(s, target, opt) {
    const generic = productionValue(s, opt) === 0;
    if (target === 'meeting') return meetingRankOf(s, opt, 'r2') > 0;
    if (target === 'culture') return generic || (s.score.culture || 0) > 0;
    if (target === 'manufactA' || target === 'manufactB') {
      return generic || (s.score[fieldFor(target, opt)] || 0) > 0;
    }
    return true;
  }

  function improveClueSwap(state, opt) {
    // A 班是低恢复组：只在这里做线索交换；B 班高恢复组保持不动。
    const centralArrs = [state.central.r1];
    const meetingArrs = opt.doubleRooms.includes('meeting')
      ? [state.meeting.r1, state.meeting.r2]
      : [state.meeting.r1];

    for (const cArr of centralArrs) {
      for (let ci = 0; ci < cArr.length; ci++) {
        const c = cArr[ci];
        if (clueValueOf(c) <= 0) continue;
        for (const mArr of meetingArrs) {
          for (let mi = 0; mi < mArr.length; mi++) {
            const m = mArr[mi];
            if (clueValueOf(m) >= clueValueOf(c)) continue;
            cArr[ci] = m;
            mArr[mi] = c;
            return;
          }
        }
      }
    }
  }

  function balanceCentralLow(state, opt) {
    if (opt.centralDisabled || opt.roomModes.central === 'empty') return;
    const lowArr = state.central.r1;
    const sources = [];
    for (const key of PRODUCTION_KEYS) {
      if (opt.roomModes[key] === 'empty') continue;
      const rounds = opt.doubleRooms.includes(key) ? ['r1', 'r2'] : ['r1'];
      for (const round of rounds) {
        state[key][round].forEach((s, idx) => sources.push({ key, round, idx, s }));
      }
    }
    sources.sort((a, b) =>
      centralRestoreOf([a.s]) - centralRestoreOf([b.s]) ||
      clueValueOf(a.s) - clueValueOf(b.s) ||
      productionValue(a.s, opt) - productionValue(b.s, opt)
    );
    const withCentral = sources.filter(x => centralRestoreOf([x.s]) > 0);
    const pool = withCentral.length ? withCentral : sources;
    for (let i = 0; i < lowArr.length && pool.length; i++) {
      const current = lowArr[i];
      const candidate = pool[0];
      if (!candidate) break;
      if (centralRestoreOf([candidate.s]) >= centralRestoreOf([current])) continue;
      const srcArr = state[candidate.key][candidate.round];
      const srcIdx = srcArr.indexOf(candidate.s);
      if (srcIdx < 0) { pool.shift(); i--; continue; }
      srcArr[srcIdx] = current;
      lowArr[i] = candidate.s;
      pool.shift();
    }
  }

  function improveMeetingMood(state, opt) {
    if (opt.roomModes.meeting === 'empty') return;
    const targets = opt.doubleRooms.includes('meeting') ? [state.meeting.r1, state.meeting.r2] : [state.meeting.r1];
    const sources = [];
    for (const key of PRODUCTION_KEYS) {
      if (key === 'meeting' || opt.roomModes[key] === 'empty') continue;
      const rounds = opt.doubleRooms.includes(key) ? ['r1', 'r2'] : ['r1'];
      for (const round of rounds) {
        state[key][round].forEach((s, idx) => {
          if ((s.score.moodReduce || 0) > 0 || (s.score.meeting || 0) > 0) sources.push({ key, round, idx, s });
        });
      }
    }
    sources.sort((a, b) => (b.s.score.meeting || 0) - (a.s.score.meeting || 0) || (b.s.score.moodReduce || 0) - (a.s.score.moodReduce || 0));

    for (const target of targets.slice().sort((a, b) => a.length - b.length)) {
      for (const candidate of sources.slice()) {
        const sourceArr = state[candidate.key][candidate.round];
        if (sourceArr.length <= 1) continue;
        const sourceIdx = sourceArr.indexOf(candidate.s);
        if (sourceIdx < 0) continue;
        const weakestIdx = target
          .map((s, i) => ({ i, v: (s.score.meeting || 0) + (s.score.moodReduce || 0) * 0.5 }))
          .sort((a, b) => a.v - b.v)[0];
        const candidateValue = (candidate.s.score.meeting || 0) + (candidate.s.score.moodReduce || 0) * 0.5;
        if (target.length >= CAP) {
          if (!weakestIdx || candidateValue <= weakestIdx.v) continue;
          sourceArr[sourceIdx] = target[weakestIdx.i];
          target[weakestIdx.i] = candidate.s;
        } else {
          sourceArr.splice(sourceIdx, 1);
          target.push(candidate.s);
        }
        break;
      }
    }
  }

  function improveMeetingClue(state, opt) {
    if (opt.roomModes.meeting === 'empty') return;
    const targets = opt.doubleRooms.includes('meeting') ? [state.meeting.r1, state.meeting.r2] : [state.meeting.r1];
    const sources = [];
    for (const key of PRODUCTION_KEYS) {
      if (key === 'meeting' || opt.roomModes[key] === 'empty') continue;
      const rounds = opt.doubleRooms.includes(key) ? ['r1', 'r2'] : ['r1'];
      for (const round of rounds) {
        state[key][round].forEach((s, idx) => {
          if (clueValueOf(s) > 0) sources.push({ key, round, idx, s });
        });
      }
    }
    sources.sort((a, b) => clueValueOf(b.s) - clueValueOf(a.s));
    for (const target of targets.slice().sort((a, b) => a.length - b.length)) {
      for (const candidate of sources.slice()) {
        const sourceArr = state[candidate.key][candidate.round];
        if (sourceArr.length <= 1) continue;
        const sourceIdx = sourceArr.indexOf(candidate.s);
        if (sourceIdx < 0) continue;
        let weakestIdx = -1, weakestValue = Infinity;
        target.forEach((s, i) => {
          const v = clueValueOf(s);
          if (v < weakestValue) { weakestValue = v; weakestIdx = i; }
        });
        if (target.length >= CAP) {
          if (clueValueOf(candidate.s) <= weakestValue) continue;
          sourceArr[sourceIdx] = target[weakestIdx];
          target[weakestIdx] = candidate.s;
        } else {
          sourceArr.splice(sourceIdx, 1);
          target.push(candidate.s);
        }
        break;
      }
    }
  }

  function swapCentralClueWithMeeting(state, opt) {
    if (opt.centralDisabled || opt.roomModes.central === 'empty' || opt.roomModes.meeting === 'empty') return;
    const a = state.central.r1;
    // 总控 A 是一轮，和会客室 A 做同轮交换；不能拿一轮心情去和二轮线索跨轮比较。
    const meetingArrs = [state.meeting.r1];
    const meetingRounds = ['r1'];
    for (let ci = 0; ci < a.length; ci++) {
      const c = a[ci];
      if (opt.trustedAgentIds.has(opIdOf(c))) continue;
      for (let ri = 0; ri < meetingArrs.length; ri++) {
        const mArr = meetingArrs[ri];
        const roundKey = meetingRounds[ri];
        const cr = meetingRankOf(c, opt, roundKey);
        if (cr <= 0) continue;
        for (let mi = 0; mi < mArr.length; mi++) {
          const m = mArr[mi];
          const mr = meetingRankOf(m, opt, roundKey);
          if (mr >= cr) continue;
          a[ci] = m;
          mArr[mi] = c;
          return;
        }
      }
    }
  }

  function fillMeetingFromCentral(state, opt) {
    if (opt.centralDisabled || opt.roomModes.central === 'empty' || opt.roomModes.meeting === 'empty') return;
    const rounds = opt.doubleRooms.includes('meeting') ? ['r1', 'r2'] : ['r1'];
    for (const round of rounds) {
      const target = state.meeting[round];
      while (target.length < CAP) {
        const candidates = [];
        for (const cround of ['r1', 'r2']) {
          if (cround === 'r2' && !opt.doubleRooms.includes('central')) continue;
          for (const s of state.central[cround]) {
            if (state.central[cround].length <= 1) continue; // 总控每班至少保留 1 人。
            if (opt.trustedAgentIds.has(opIdOf(s))) continue;
            const rank = meetingRankOf(s, opt, round);
            if (rank > 0) candidates.push({ s, cround, rank });
          }
        }
        if (!candidates.length) break;
        candidates.sort((a, b) => b.rank - a.rank);
        const pick = candidates[0];
        const arr = state.central[pick.cround];
        arr.splice(arr.indexOf(pick.s), 1);
        target.push(pick.s);
      }
    }
  }

  function rebalanceMeetingRounds(state, opt) {
    if (!opt.doubleRooms.includes('meeting')) return;
    const all = [...state.meeting.r1, ...state.meeting.r2];
    if (all.length < 2) return;
    all.sort((a, b) =>
      ((b.score.meeting || 0) + (b.score.clue || 0) * 0.2 + (b.score.moodReduce || 0) * 0.5) -
      ((a.score.meeting || 0) + (a.score.clue || 0) * 0.2 + (a.score.moodReduce || 0) * 0.5)
    );
    state.meeting.r1 = all.slice(0, CAP);
    state.meeting.r2 = all.slice(CAP, CAP * 2);
    // 保留双轮保底：若总数不足 6，也至少要保证 A/B 各 1 人。
    if (all.length >= 2 && state.meeting.r2.length === 0) {
      state.meeting.r2.push(state.meeting.r1.pop());
    }
  }

  // 统一班次轮转：总控 A/B 在最终结果中反向放置，保持高恢复组仍是高恢复组。
  function swapCentralRounds(state) {
    const r1 = state.central.r1;
    state.central.r1 = state.central.r2;
    state.central.r2 = r1;
  }

  // “会客室优先”开启时，最后检查会客室空位，并从其它生产舱借出
  function enforceMeetingFill(state, opt, warnings, contrib) {
    if (!opt.meetingPriorityEnabled || opt.roomModes.meeting === 'empty') return;
    const targetRounds = opt.doubleRooms.includes('meeting') ? [state.meeting.r1, state.meeting.r2] : [state.meeting.r1];

    for (const target of targetRounds) {
      while (target.length < CAP) {
        const candidates = [];
        const targetBefore = groupStats(target, 'meeting', opt, contrib).rate;

        for (const sourceKey of PRODUCTION_KEYS) {
          if (sourceKey === 'meeting' || opt.roomModes[sourceKey] === 'empty') continue;
          const sourceRounds = opt.doubleRooms.includes(sourceKey)
            ? [state[sourceKey].r1, state[sourceKey].r2]
            : [state[sourceKey].r1];
          for (const arr of sourceRounds) {
            // 保留来源舱至少 1 人，避免“补会客室”把来源舱直接抽空。
            if (arr.length <= 1) continue;
            const before = groupStats(arr, sourceKey, opt, contrib).rate;
            for (const s of arr) {
              const fit = canFillTarget(s, 'meeting', opt) ? 1 : 0;
              const after = groupStats(arr.filter(x => x !== s), sourceKey, opt, contrib).rate;
              const targetAfter = groupStats(target.concat(s), 'meeting', opt, contrib).rate;
              candidates.push({
                sourceKey, arr, s, fit,
                loss: before - after,
                gain: targetAfter - targetBefore,
                production: productionValue(s, opt),
              });
            }
          }
        }

        if (!candidates.length) break;
        candidates.sort((a, b) => {
          if (b.fit !== a.fit) return b.fit - a.fit;
          if (Math.abs(a.loss - b.loss) > 1e-9) return a.loss - b.loss;
          if (Math.abs(b.gain - a.gain) > 1e-9) return b.gain - a.gain;
          return a.production - b.production;
        });

        const picked = candidates[0];
        picked.arr.splice(picked.arr.indexOf(picked.s), 1);
        target.push(picked.s);
      }
    }

    const remaining = targetRounds.reduce((n, arr) => n + Math.max(0, CAP - arr.length), 0);
    if (remaining > 0) {
      warnings.push(`“会客室优先”已开启，但其它舱室可借出的干员不足，会客室仍有 ${remaining} 个空位。`);
    }
  }


  function openSlotsOutside(state, opt, skipKey) {
    let open = 0;
    for (const key of ROOM_KEYS) {
      if (key === skipKey || opt.roomModes[key] === 'empty') continue;
      const rounds = opt.doubleRooms.includes(key) ? ['r1', 'r2'] : ['r1'];
      for (const round of rounds) open += Math.max(0, CAP - state[key][round].length);
    }
    return open;
  }

  function underfillContribution(s, key, opt) {
    if (key === 'culture') {
      // 培养舱按已设置的产物优先级加权；高优先级产物天赋必须优先保留。
      return (s.score.culture || 0) + (s.score.moodReduce || 0) * MOOD_WEIGHT;
    }
    if (key === 'meeting') {
      return meetingRankOf(s, opt, 'r2');
    }
    if (key === 'manufactA' || key === 'manufactB') {
      return (s.score[fieldFor(key, opt)] || 0) + (s.score.moodReduce || 0) * MOOD_WEIGHT;
    }
    if (key === 'central') return s.score.central || 0;
    return productionValue(s, opt);
  }

  function releaseUnderfillExtras(state, opt, maxRelease) {
    const key = opt.underfillRoom;
    if (!key || !ROOM_KEYS.includes(key) || opt.roomModes[key] === 'empty') return [];
    // 信赖干员必须收容在总控，不能因“允许总控不满”被抽出。
    if (key === 'central' && opt.trustedAgentIds.size > 0) return [];
    const limit = Math.max(0, maxRelease == null ? Infinity : maxRelease);
    const rounds = opt.doubleRooms.includes(key) ? ['r1', 'r2'] : ['r1'];
    const all = [];
    for (const round of rounds) all.push(...state[key][round]);
    if (!all.length) return [];
    const minKeep = rounds.length > 1 ? 2 : 1;
    const keepCount = Math.max(minKeep, all.length - limit);
    // 保留本舱贡献最高的干员；低优先级产物/低贡献先释放。
    all.sort((a, b) => underfillContribution(b, key, opt) - underfillContribution(a, key, opt));
    const keep = all.slice(0, Math.min(all.length, keepCount));
    const released = all.slice(keep.length);
    if (rounds.length > 1) {
      state[key].r1 = keep.length ? [keep[0]] : [];
      state[key].r2 = keep.length > 1 ? [keep[1]] : [];
      // 若还有保留名额，后续补回 A 班，保证不会因为分轮丢人。
      for (let i = 2; i < keep.length; i++) state[key].r1.push(keep[i]);
    } else {
      state[key].r1 = keep.length ? [keep[0]] : [];
      state[key].r2 = [];
    }
    return released;
  }

  function moverTargetScore(s, key, opt) {
    if (!s || !s.score) return -Infinity;
    if (key === 'meeting') return meetingRankOf(s, opt, 'r2');
    if (key === 'culture') return s.score.culture || 0;
    if (key === 'manufactA' || key === 'manufactB') return s.score[fieldFor(key, opt)] || 0;
    if (key === 'central') return s.score.central || 0;
    return 0;
  }

  function placeReleased(state, released, opt) {
    if (!released.length) return;
    // 总控特殊询问：只执行一次。非总控允许不满舱时，若总控双轮且人数≤3，
    // 先向总控转移 1 人。总控按会客室规则取最低分，优先收容排除线索干员。
    if (opt.underfillRoom !== 'central' && !opt.centralDisabled &&
        opt.roomModes.central !== 'empty' && opt.doubleRooms.includes('central') &&
        state.central.r1.length + state.central.r2.length <= 3) {
      const target = state.central.r1.length < CAP ? state.central.r1 : state.central.r2;
      if (target.length < CAP) {
        let lowIdx = 0;
        for (let i = 1; i < released.length; i++) {
          if (moverTargetScore(released[i], 'meeting', opt) < moverTargetScore(released[lowIdx], 'meeting', opt)) lowIdx = i;
        }
        target.push(released.splice(lowIdx, 1)[0]);
      }
    }
    const targets = productionOrder(opt, 1);
    for (const key of targets) {
      if (key === opt.underfillRoom || opt.roomModes[key] === 'empty') continue;
      const rounds = opt.doubleRooms.includes(key) ? ['r1', 'r2'] : ['r1'];
      for (const round of rounds) {
        const arr = state[key][round];
        while (arr.length < CAP && released.length) {
          // 每到一个目标舱，按该舱二轮权重重新排序，高分先移动。
          released.sort((a, b) => moverTargetScore(b, key, opt) - moverTargetScore(a, key, opt));
          const s = released[0];
          if (key === 'meeting' && moverTargetScore(s, key, opt) <= 0) break;
          arr.push(released.shift());
        }
      }
    }
  }

  function fitValueFor(s, key, opt) {
    if (!s || !s.score) return 0;
    if (key === 'meeting') return Math.max(0, meetingRankOf(s, opt, 'r2'));
    if (key === 'culture') return s.score.culture || 0;
    if (key === 'manufactA' || key === 'manufactB') return s.score[fieldFor(key, opt)] || 0;
    return 0;
  }

  function evaluateState(state, opt, contrib) {
    const r = restRates(state);
    let total = 0;
    const perRoom = {};

    for (const key of ROOM_KEYS) {
      if (opt.roomModes[key] === 'empty') { perRoom[key] = 0; continue; }
      const A = state[key].r1, B = state[key].r2;
      if (key === 'central') {
        const v = centralRestoreOf(A) * CENTRAL_VALUE_WEIGHT + centralRestoreOf(B) * CENTRAL_VALUE_WEIGHT;
        perRoom[key] = v; total += v;
        continue;
      }
      let v = 0;
      if (key === 'culture') {
        v = cultureOutput(A, B, opt, contrib, r.high, r.low);
      } else if (opt.doubleRooms.includes(key) && A.length && B.length) {
        v = pairOutput(groupStats(A, key, opt, contrib), groupStats(B, key, opt, contrib), r.high, r.low);
      } else {
        // 双轮舱室只有一侧有人时，按单轮处理（不能把空轮当成 0 产出）
        v = singleOutput(A.length ? A : B, key, opt, contrib);
      }
      if (key === 'meeting') {
        for (const group of [A, B]) {
          for (const s of group) {
            for (const t of s.mergedTraits || []) {
              if (t.舱室 !== '会客室' || !isCluePower(t.类型)) continue;
              const n = parseInt(t.线索编号, 10);
              if (opt.missingClues.has(n)) v += 2.0;
              else if (!opt.excludedClues.has(n)) v += 0.2;
            }
          }
        }
      }
      perRoom[key] = v; total += v;
    }
    return { total, perRoom, cRestHigh: r.high, cRestLow: r.low, r1: r.r1, r2: r.r2 };
  }

  function slotList(state, opt) {
    const slots = [];
    for (const key of ROOM_KEYS) {
      if (opt.roomModes[key] === 'empty') continue;
      state[key].r1.forEach((op, idx) => { if (op) slots.push({ key, round: 'r1', idx }); });
      if (opt.doubleRooms.includes(key)) {
        state[key].r2.forEach((op, idx) => { if (op) slots.push({ key, round: 'r2', idx }); });
      }
    }
    return slots;
  }

  function arrOf(state, slot) {
    return slot.round === 'r1' ? state[slot.key].r1 : state[slot.key].r2;
  }

  function applySwap(state, a, b) {
    const arrA = arrOf(state, a), arrB = arrOf(state, b);
    const oa = arrA[a.idx], ob = arrB[b.idx];
    arrA[a.idx] = ob; arrB[b.idx] = oa;
  }

  function localSearch(state, scores, opt, contrib) {
    if (opt.optimize === 'none' || opt.optimizeIterations <= 0) {
      return { value: evaluateState(state, opt, contrib).total, moves: 0, iterations: 0 };
    }
    const trust = opt.trustedAgentIds;
    const inState = () => new Set(allAssigned(state).map(opIdOf));
    let base = evaluateState(state, opt, contrib).total;
    let moves = 0, iter = 0;

    while (iter < opt.optimizeIterations) {
      iter++;
      const slots = slotList(state, opt);
      if (slots.length === 0) break;
      let bestDelta = 1e-4, bestMove = null;

      // 7.1 槽位交换
      for (let i = 0; i < slots.length; i++) {
        const a = slots[i];
        const arrA = arrOf(state, a);
        for (let j = i + 1; j < slots.length; j++) {
          const b = slots[j];
          if (a.key !== b.key) continue; // 选人阶段已决定舱室归属，微调只做同舱 A/B 交换。
          if (a.key === b.key && a.round === b.round) continue;
          const arrB = arrOf(state, b);
          const oa = arrA[a.idx], ob = arrB[b.idx];
          if (!oa || !ob) continue;
          if (trust.has(opIdOf(oa)) && b.key !== 'central') continue;
          if (trust.has(opIdOf(ob)) && a.key !== 'central') continue;
          applySwap(state, a, b);
          const v = evaluateState(state, opt, contrib).total;
          if (v - base > bestDelta) { bestDelta = v - base; bestMove = { type: 'swap', a, b }; }
          applySwap(state, a, b);
        }
      }

      // 7.2 与未排班干员替换
      const used = inState();
      // 选人阶段已确定舱室归属；微调不再用自由池替换，避免把会客室线索干员换到总控。
      const free = [];
      for (const slot of slots) {
        const arr = arrOf(state, slot);
        const old = arr[slot.idx];
        if (!old) continue;
        // 信赖干员是用户明确选择的收容对象：不允许被普通干员替换出总控
        if (slot.key === 'central' && trust.has(opIdOf(old))) continue;
        for (const cand of free) {
          const cid = opIdOf(cand);
          if (cid === opIdOf(old)) continue;
          if (trust.has(cid) && slot.key !== 'central') continue;
          arr[slot.idx] = cand;
          const v = evaluateState(state, opt, contrib).total;
          if (v - base > bestDelta) { bestDelta = v - base; bestMove = { type: 'replace', slot, cand, old } }
          arr[slot.idx] = old;
        }
      }

      // 7.3 跨舱移动（只在目标舱未满时）
      for (const slot of slots) {
        const arr = arrOf(state, slot);
        const op = arr[slot.idx];
        if (!op) continue;
        for (const key of ROOM_KEYS) {
          if (key !== slot.key) continue; // 禁止全局微调跨舱搬人。
          if (opt.roomModes[key] === 'empty') continue;
          if (key === 'central' && opt.centralDisabled) continue;
          if (trust.has(opIdOf(op)) && key !== 'central') continue;
          for (const round of ['r1', 'r2']) {
            if (round === 'r2' && !opt.doubleRooms.includes(key)) continue;
            if (slot.key === key && slot.round === round) continue;
            const target = state[key][round];
            if (target.length >= CAP) continue;
            arr.splice(slot.idx, 1);
            target.push(op);
            const v = evaluateState(state, opt, contrib).total;
            if (v - base > bestDelta) { bestDelta = v - base; bestMove = { type: 'move', slot, key, round, op } }
            target.pop();
            arr.splice(slot.idx, 0, op);
          }
        }
      }

      if (!bestMove) break;
      moves++;
      if (bestMove.type === 'swap') applySwap(state, bestMove.a, bestMove.b);
      else if (bestMove.type === 'replace') arrOf(state, bestMove.slot)[bestMove.slot.idx] = bestMove.cand;
      else if (bestMove.type === 'move') {
        const arr = arrOf(state, bestMove.slot);
        arr.splice(bestMove.slot.idx, 1);
        state[bestMove.key][bestMove.round].push(bestMove.op);
      }
      base = evaluateState(state, opt, contrib).total;
    }
    return { value: base, moves, iterations: iter };
  }

  // ------------------------------------------------------------
  // 8. 时间参数（总控恢复量真实耦合）
  // ------------------------------------------------------------
  function optimizeRoundPartitions(state, opt, contrib) {
    if (!opt.doubleRooms.length) return;
    const rates = restRates(state);
    for (const key of ['manufactA', 'manufactB', 'culture', 'meeting']) {
      if (!opt.doubleRooms.includes(key) || opt.roomModes[key] === 'empty') continue;
      const all = [...state[key].r1, ...state[key].r2];
      if (all.length < 2) continue;
      let best = null;
      const n = all.length;
      for (let mask = 1; mask < (1 << n) - 1; mask++) {
        const A = [], B = [];
        for (let i = 0; i < n; i++) ((mask >> i) & 1 ? A : B).push(all[i]);
        if (!A.length || !B.length || A.length > CAP || B.length > CAP) continue;
        let value;
        if (key === 'culture') {
          value = cultureOutput(A, B, opt, contrib, rates.high, rates.low);
        } else {
          value = pairOutput(
            groupStats(A, key, opt, contrib),
            groupStats(B, key, opt, contrib),
            rates.high, rates.low
          );
        }
        if (key === 'meeting') {
          // 会客室线索概率占小幅权重，避免纯时长交换丢掉线索干员。
          for (const arr of [A, B]) for (const s of arr) value += (s.score.clue || 0) * 0.01;
        }
        if (!best || value > best.value) best = { A, B, value };
      }
      if (best) {
        state[key].r1 = best.A;
        state[key].r2 = best.B;
      }
    }
  }


  function roomObjective(state, key, opt, contrib) {
    const rates = restRates(state);
    const A = state[key].r1, B = state[key].r2;
    if (!opt.doubleRooms.includes(key) || !A.length || !B.length) {
      return singleOutput(A.length ? A : B, key, opt, contrib);
    }
    let value = key === 'culture'
      ? cultureOutput(A, B, opt, contrib, rates.high, rates.low)
      : pairOutput(groupStats(A, key, opt, contrib), groupStats(B, key, opt, contrib), rates.high, rates.low);
    if (key === 'meeting') {
      for (const arr of [A, B]) for (const s of arr) value += (s.score.clue || 0) * 0.01;
    }
    return value;
  }

  function optimizeUnassignedReplacements(state, opt, contrib, scores) {
    const used = new Set();
    for (const key of ROOM_KEYS) {
      for (const round of ['r1', 'r2']) {
        if (round === 'r2' && !opt.doubleRooms.includes(key)) continue;
        for (const s of state[key][round]) used.add(opIdOf(s));
      }
    }
    const free = scores.filter(s => !used.has(opIdOf(s)) && !opt.trustedAgentIds.has(opIdOf(s)));
    if (!free.length) return;
    for (let pass = 0; pass < 8; pass++) {
      let best = null;
      for (const key of ['manufactA', 'manufactB', 'culture', 'meeting']) {
        if (opt.roomModes[key] === 'empty') continue;
        const rounds = opt.doubleRooms.includes(key) ? ['r1', 'r2'] : ['r1'];
        const before = roomObjective(state, key, opt, contrib);
        for (const round of rounds) {
          const arr = state[key][round];
          for (let i = 0; i < arr.length; i++) {
            if (opt.trustedAgentIds.has(opIdOf(arr[i]))) continue;
            const old = arr[i];
            for (const cand of free) {
              if (used.has(opIdOf(cand))) continue;
              if (key !== 'central' && fitValueFor(cand, key, opt) <= 0) continue;
              arr[i] = cand;
              const value = roomObjective(state, key, opt, contrib);
              arr[i] = old;
              if (value > (best?.value ?? before) + 1e-6) {
                best = { key, round, i, old, cand, value };
              }
            }
          }
        }
      }
      if (!best) break;
      const arr = state[best.key][best.round];
      const idx = arr.indexOf(best.old);
      if (idx < 0) break;
      arr[idx] = best.cand;
      used.delete(opIdOf(best.old));
      used.add(opIdOf(best.cand));
    }
  }

  function optimizeProductionSwaps(state, opt, contrib) {
    const prodSlots = [];
    for (const key of ['manufactA', 'manufactB']) {
      if (opt.roomModes[key] === 'empty') continue;
      state[key].r1.forEach((op, idx) => prodSlots.push({ key, round: 'r1', idx }));
      if (opt.doubleRooms.includes(key)) {
        state[key].r2.forEach((op, idx) => prodSlots.push({ key, round: 'r2', idx }));
      }
    }
    let base = evaluateState(state, opt, contrib).total;
    let iter = 0;
    while (iter++ < 6) {
      let best = null;
      let bestValue = base + 1e-6;
      for (let i = 0; i < prodSlots.length; i++) {
        for (let j = i + 1; j < prodSlots.length; j++) {
          const sa = prodSlots[i], sb = prodSlots[j];
          if (sa.key === sb.key && sa.round === sb.round) continue;
          const aa = state[sa.key][sa.round], ab = state[sb.key][sb.round];
          const oa = aa[sa.idx], ob = ab[sb.idx];
          if (!oa || !ob) continue;
          aa[sa.idx] = ob; ab[sb.idx] = oa;
          const v = evaluateState(state, opt, contrib).total;
          aa[sa.idx] = oa; ab[sb.idx] = ob;
          if (v > bestValue) { bestValue = v; best = { sa, sb, oa, ob }; }
        }
      }
      if (!best) break;
      const aa = state[best.sa.key][best.sa.round], ab = state[best.sb.key][best.sb.round];
      aa[best.sa.idx] = best.ob; ab[best.sb.idx] = best.oa;
      base = bestValue;
    }
  }

  function hasAnyBenefit(s) {
    if (!s || !s.score) return false;
    return (s.score.central || 0) > 0 ||
      (s.score.expScore || 0) > 0 ||
      (s.score.weaponScore || 0) > 0 ||
      (s.score.culture || 0) > 0 ||
      (s.score.meeting || 0) > 0;
  }

  function hasExcludedClueOnly(s, opt) {
    let hasClue = false, hasUsableClue = false;
    for (const t of s.mergedTraits || []) {
      if (t.舱室 !== '会客室' || !isCluePower(t.类型)) continue;
      hasClue = true;
      const n = parseInt(t.线索编号, 10);
      if (opt.missingClues.has(n) || !opt.excludedClues.has(n)) hasUsableClue = true;
    }
    if (!hasClue || hasUsableClue) return false;
    return !(hasAnyBenefit(s) && (s.score.meeting || 0) > 0);
  }

  function fillRemainingSlots(state, opt, scores) {
    const used = new Set();
    for (const key of ROOM_KEYS) {
      for (const round of ['r1', 'r2']) {
        if (round === 'r2' && !opt.doubleRooms.includes(key)) continue;
        for (const s of state[key][round]) used.add(opIdOf(s));
      }
    }
    let free = scores.filter(s => !used.has(opIdOf(s)) && !opt.trustedAgentIds.has(opIdOf(s)));
    if (!free.length) return;

    const ordered = productionOrder(opt, 1).slice();
    if (opt.underfillRoom && ordered.includes(opt.underfillRoom)) {
      ordered.splice(ordered.indexOf(opt.underfillRoom), 1);
      ordered.push(opt.underfillRoom);
    }
    if (!opt.centralDisabled && opt.roomModes.central !== 'empty') ordered.push('central');

    for (const key of ordered) {
      if (key === 'central' && opt.centralDisabled) continue;
      const rounds = key === 'central'
        ? ['r2', 'r1']
        : (opt.doubleRooms.includes(key) ? ['r1', 'r2'] : ['r1']);
      for (const round of rounds) {
        const arr = state[key][round];
        while (arr.length < CAP) {
          if (!free.length) return;
          const fit = free.filter(s => fitValueFor(s, key, opt) > 0);
          let pick;
          if (fit.length) {
            fit.sort((a, b) => fitValueFor(b, key, opt) - fitValueFor(a, key, opt) || productionValue(a, opt) - productionValue(b, opt));
            pick = fit[0];
          } else {
            // 无增益干员最后补位；会客室不优先塞入被排除线索的干员。
            let pool = key === 'meeting'
              ? free.filter(s => !hasAnyBenefit(s))
              : free;
            if (key === 'central') {
              // 总控溢出位只接收“任何舱室都没有增益”的干员，避免抢走有培养/生产天赋的人。
              pool = free.filter(s => !hasAnyBenefit(s));
            }
            const fallback = pool.length ? pool : (key === 'central' ? [] : free);
            if (!fallback.length) break;
            fallback.sort((a, b) =>
              (hasAnyBenefit(a) ? 1 : 0) - (hasAnyBenefit(b) ? 1 : 0) ||
              (hasExcludedClueOnly(a, opt) ? 1 : 0) - (hasExcludedClueOnly(b, opt) ? 1 : 0) ||
              productionValue(a, opt) - productionValue(b, opt)
            );
            pick = fallback[0];
          }
          if (!pick) break;
          arr.push(pick);
          free = free.filter(s => s !== pick);
        }
      }
    }
  }

  function optimizeMeetingByRank(state, opt, scores) {
    const used = new Set();
    for (const key of ROOM_KEYS) for (const round of ['r1', 'r2']) {
      if (round === 'r2' && !opt.doubleRooms.includes(key)) continue;
      for (const s of state[key][round]) used.add(opIdOf(s));
    }
    let free = scores.filter(s => !used.has(opIdOf(s)) && !opt.trustedAgentIds.has(opIdOf(s)));
    for (const round of ['r1', 'r2']) {
      if (round === 'r2' && !opt.doubleRooms.includes('meeting')) continue;
      const arr = state.meeting[round];
      for (let i = 0; i < arr.length; i++) {
        const current = arr[i];
        if (opt.trustedAgentIds.has(opIdOf(current))) continue;
        let best = null;
        for (const cand of free) {
          if (meetingRankOf(cand, opt, round) <= meetingRankOf(current, opt, round) + 1e-6) continue;
          if (!best || meetingRankOf(cand, opt, round) > meetingRankOf(best, opt, round)) best = cand;
        }
        if (!best) continue;
        arr[i] = best;
        free = free.filter(s => s !== best);
        used.delete(opIdOf(current));
        used.add(opIdOf(best));
        free.push(current);
      }
    }
  }

  function optimizeCentralPartition(state, opt) {
    if (opt.centralDisabled || opt.roomModes.central === 'empty' || !opt.doubleRooms.includes('central')) return;
    const all = [...state.central.r1, ...state.central.r2];
    if (all.length < 2) return;
    // B 班放恢复最高的 1-3 人，A 班至少留 1 人。
    all.sort((a, b) => centralRestoreOf([b]) - centralRestoreOf([a]));
    const bCount = Math.min(CAP, all.length - 1);
    const b = all.slice(0, bCount);
    const a = all.slice(bCount);
    state.central.r2 = b;
    state.central.r1 = a;
  }

  function enforceTrustedCentral(state, opt, scores) {
    if (opt.centralDisabled || opt.trustedAgentIds.size === 0) return;
    const inCentral = new Set([...state.central.r1, ...state.central.r2].map(opIdOf));
    for (const s of scores) {
      const id = opIdOf(s);
      if (!opt.trustedAgentIds.has(id) || inCentral.has(id)) continue;
      let placed = false;
      for (const key of ROOM_KEYS) {
        if (key === 'central') continue;
        for (const round of ['r1', 'r2']) {
          const arr = state[key][round];
          const at = arr.findIndex(x => opIdOf(x) === id);
          if (at >= 0) { arr.splice(at, 1); }
        }
      }
      for (const round of ['r2', 'r1']) {
        if (state.central[round].length < CAP) {
          state.central[round].push(s);
          inCentral.add(id);
          placed = true;
          break;
        }
      }
      if (!placed) {
        const target = state.central.r2.length ? state.central.r2 : state.central.r1;
        const weak = target.find(x => !opt.trustedAgentIds.has(opIdOf(x)));
        if (weak) target[target.indexOf(weak)] = s;
      }
    }
  }

  function fillPriorityRooms(state, opt) {
    if (!opt.priorityFillEnabled) return;
    const order = productionOrder(opt, 1);
    for (const key of order) {
      if (key === opt.underfillRoom || opt.roomModes[key] === 'empty') continue;
      const rounds = opt.doubleRooms.includes(key) ? ['r1', 'r2'] : ['r1'];
      for (const round of rounds) {
        const target = state[key][round];
        while (target.length < CAP) {
          const candidates = [];
          for (let si = order.indexOf(key) + 1; si < order.length; si++) {
            const sourceKey = order[si];
            if (sourceKey === opt.underfillRoom || opt.roomModes[sourceKey] === 'empty') continue;
            const sourceRounds = opt.doubleRooms.includes(sourceKey) ? ['r1', 'r2'] : ['r1'];
            for (const sr of sourceRounds) {
              const arr = state[sourceKey][sr];
              if (arr.length <= 1) continue;
              for (const s of arr) {
                const ts = moverTargetScore(s, key, opt);
                if (key === 'meeting' && ts < 0) continue;
                candidates.push({ arr, s, targetScore: ts, loss: underfillContribution(s, sourceKey, opt) });
              }
            }
          }
          if (!candidates.length) break;
          candidates.sort((a, b) => b.targetScore - a.targetScore || a.loss - b.loss);
          const pick = candidates[0];
          pick.arr.splice(pick.arr.indexOf(pick.s), 1);
          target.push(pick.s);
        }
      }
    }
  }

  function sortHighEfficiencyToA(state, opt, contrib) {
    for (const key of ['manufactA', 'manufactB', 'culture', 'meeting']) {
      if (!opt.doubleRooms.includes(key) || opt.roomModes[key] === 'empty') continue;
      const A = state[key].r1, B = state[key].r2;
      if (!A.length || !B.length) continue;
      const a = groupStats(A, key, opt, contrib).rate;
      const b = groupStats(B, key, opt, contrib).rate;
      if (a < b) { state[key].r1 = B; state[key].r2 = A; }
    }
  }

  function sortRoundsByEfficiency(state, opt, contrib) {
    for (const key of ['manufactA', 'manufactB', 'meeting']) {
      if (!opt.doubleRooms.includes(key)) continue;
      const A = state[key].r1, B = state[key].r2;
      if (!A.length || !B.length) continue;
      const a = groupStats(A, key, opt, contrib);
      const b = groupStats(B, key, opt, contrib);
      if (a.rate < b.rate) { state[key].r1 = B; state[key].r2 = A; }
    }
  }

  /** 双轮舱室只有一轮有人时，把唯一一轮归一化到 A 班，保证 UI/时间参数一致 */
  function normalizeRounds(state, opt) {
    for (const key of ROOM_KEYS) {
      if (key === 'central') continue;
      if (!opt.doubleRooms.includes(key)) continue;
      if (state[key].r1.length === 0 && state[key].r2.length > 0) {
        state[key].r1 = state[key].r2;
        state[key].r2 = [];
      }
    }
  }

  function roomTiming(key, state, opt, contrib, cRestHigh, cRestLow) {
    const A = state[key].r1, B = state[key].r2;
    if (key === 'central') {
      const rA = centralRestoreOf(A), rB = centralRestoreOf(B);
      return {
        hA: 0, hB: 0, feasible: true, highDuration: 0,
        round1IsEfficient: rA >= rB,
        rA, rB, cA: C_WORK_BASE, cB: C_WORK_BASE,
      };
    }
    if (!opt.doubleRooms.includes(key) || B.length === 0) {
      const g = key === 'culture'
        ? groupStats(A, 'culture', opt, contrib, opt.culturePriority[0])
        : groupStats(A, key, opt, contrib);
      return {
        hA: 24, hB: 0, feasible: true, output: g.rate * Math.min(24, 100 / g.cWork),
        round1IsEfficient: true, cA: g.cWork, cB: 0, rA: g.rate, rB: 0,
      };
    }
    let ga, gb;
    if (key === 'culture') {
      ga = groupStats(A, 'culture', opt, contrib, opt.culturePriority[0]);
      gb = groupStats(B, 'culture', opt, contrib, opt.culturePriority[0]);
    } else {
      ga = groupStats(A, key, opt, contrib);
      gb = groupStats(B, key, opt, contrib);
    }
    const loop = solveSteadyLoop(ga, gb, cRestHigh, cRestLow);
    const hA = loop.highIsA ? loop.hHigh : loop.hLow;
    return {
      hA, hB: 24 - hA, feasible: loop.feasible, output: loop.output,
      round1IsEfficient: loop.highIsA,
      cA: ga.cWork, cB: gb.cWork, rA: ga.rate, rB: gb.rate,
      highDuration: opt.doubleRooms.includes('central') ? Math.max(11, Math.min(13, Math.ceil(loop.hLow))) : 0,
    };
  }

  // ------------------------------------------------------------
  // 9. 备选池
  // ------------------------------------------------------------
  function buildReserve(state, scores, opt, usedIds) {
    const reservePool = scores.filter(s => !usedIds.has(opIdOf(s)) && !opt.trustedAgentIds.has(opIdOf(s)));
    const map = {};
    for (const key of ROOM_KEYS) {
      if (opt.roomModes[key] === 'empty') { map[key] = []; continue; }
      const field = fieldFor(key, opt);
      const manufMood = s => {
        let n = 0;
        for (const t of s.mergedTraits || []) {
          if (t.舱室 === '制造舱' && t.类型 === '心情消耗减少') n += t.数值 || 0;
        }
        return n;
      };
      let cand;
      if (key === 'meeting') {
        // 会客室储备：收集线索效率、会客室心情、有效线索概率都纳入。
        cand = reservePool.filter(s => (s.score.meeting || 0) > 0 || hasMeetingCore(s, opt));
        cand.sort((a, b) => meetingRankOf(b, opt, 'r2') - meetingRankOf(a, opt, 'r2'));
      } else {
        cand = reservePool.filter(s => (s.score[field] || 0) > 0 ||
          ((key === 'manufactA' || key === 'manufactB') && manufMood(s) > 0));
        cand.sort((a, b) => {
          const av = (a.score[field] || 0) * 100 + manufMood(a);
          const bv = (b.score[field] || 0) * 100 + manufMood(b);
          return bv - av;
        });
      }
      if (key === 'meeting') {
        cand = cand.filter(s => !hasExcludedClueOnly(s, opt));
      }
      map[key] = cand.slice(0, 5);
    }
    return map;
  }

  // ------------------------------------------------------------
  // 10. 主流程
  // ------------------------------------------------------------
  function generateSchedule(operators, inputOptions) {
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const opt = normalizeOptions(inputOptions);
    const scores = computeScoresForAll(operators, opt);
    const state = makeState();
    const warnings = [];

    if (scores.length === 0) {
      const empty = {};
      for (const k of ROOM_KEYS) empty[k] = { recommend: [], reserve: [], round1: [], round2: [] };
      empty._timingInfo = {};
      empty._warnings = ['没有可用干员'];
      empty._meta = { version: VERSION, elapsedMs: 0 };
      return empty;
    }

    const contrib = buildContribMap(scores, opt);
    assignProduction(state, scores, opt);
    const centralInfo = assignCentral(state, scores, opt);
    const search = localSearch(state, scores, opt, contrib);
    normalizeRounds(state, opt);
    sortRoundsByEfficiency(state, opt, contrib);

    if (opt.centralDisabled && opt.trustedAgentIds.size > 0) {
      warnings.push('总控中枢为空置，信赖干员没有可排入的舱室；请启用总控或取消信赖选择。');
    }
    if (!opt.centralDisabled && centralInfo.unassignedTrust.length > 0) {
      warnings.push(`总控容量不足，${centralInfo.unassignedTrust.length} 名信赖干员未能排入总控。`);
    }

    // 总控 A 班先维持高恢复组，最终再反向放置为 B 高恢复组。
    improveCentralA(state, opt, scores, contrib);
    // 双轮舱室至少每班 1 人。
    enforceDoubleMinimums(state, opt, warnings, contrib);
    // 优先满舱关闭时，不处理允许不满舱。
    if (opt.priorityFillEnabled) {
      // 其它舱室没有空位时不释放任何干员。
      const openOutside = openSlotsOutside(state, opt, opt.underfillRoom);
      const releasedByUnderfill = openOutside > 0
        ? releaseUnderfillExtras(state, opt, openOutside)
        : [];
      if (releasedByUnderfill.length) placeReleased(state, releasedByUnderfill, opt);
    }
    // 优先满舱的补位只由“允许不满舱”释放驱动，不再额外从其它舱室迁移。
    // if (opt.priorityFillEnabled) enforcePriorityFill(state, opt, warnings, contrib);
    // 双班总控至少每班 1 人。
    enforceCentralMinimum(state, opt, warnings, contrib);
    enforceCentralUnderfill(state, opt);
    // 会客室优先由材料优先级/优先满舱处理，不再单独强制拉人。
    if (opt.meetingPriorityEnabled) enforceMeetingFill(state, opt, warnings, contrib);
    if (!opt.centralDisabled && opt.roomModes.central !== 'empty' && opt.doubleRooms.includes('central')) {
      swapCentralRounds(state);
    }
    swapCentralClueWithMeeting(state, opt);
    fillMeetingFromCentral(state, opt);
    sortRoundsByEfficiency(state, opt, contrib);
    optimizeRoundPartitions(state, opt, contrib);
    optimizeUnassignedReplacements(state, opt, contrib, scores);
    optimizeRoundPartitions(state, opt, contrib);
    // 6 人满舱 / 制造同产物 12 人跨舱交换，使用真实 24h 目标。
    optimizeProductionSwaps(state, opt, contrib);
    optimizeRoundPartitions(state, opt, contrib);
    fillRemainingSlots(state, opt, scores);
    fillPriorityRooms(state, opt);
    optimizeRoundPartitions(state, opt, contrib);
    sortHighEfficiencyToA(state, opt, contrib);
    if (!opt.centralDisabled && opt.roomModes.central !== 'empty' && opt.doubleRooms.includes('central')) {
      if (centralRestoreOf(state.central.r2) < centralRestoreOf(state.central.r1)) {
        swapCentralRounds(state);
      }
    }

    // 总控最后一次效率调整：B 班放高恢复组，A 班保留至少 1 人。
    optimizeCentralPartition(state, opt);
    enforceTrustedCentral(state, opt, scores);
    // 防御性去重：任何后置优化都不允许同一干员占用多个槽位。
    const seenAssigned = new Set();
    for (const key of ROOM_KEYS) {
      for (const round of ['r1', 'r2']) {
        if (round === 'r2' && !opt.doubleRooms.includes(key)) continue;
        state[key][round] = state[key][round].filter(s => {
          const id = opIdOf(s);
          if (seenAssigned.has(id)) return false;
          seenAssigned.add(id);
          return true;
        });
      }
    }
    // 所有后置修正结束后，最终再保证总控 B 为高恢复组。
    if (!opt.centralDisabled && opt.roomModes.central !== 'empty' && opt.doubleRooms.includes('central')) {
      if (state.central.r1.length === 0 && state.central.r2.length > 0) state.central.r1.push(state.central.r2.pop());
      if (state.central.r2.length === 0 && state.central.r1.length > 1) state.central.r2.push(state.central.r1.pop());
      if (centralRestoreOf(state.central.r2) < centralRestoreOf(state.central.r1)) {
        swapCentralRounds(state);
      }
    }

    // 二轮保底之后再做一次效率微调；补位/保底不能成为最终低效结果。
    optimizeProductionSwaps(state, opt, contrib);
    optimizeRoundPartitions(state, opt, contrib);
    sortHighEfficiencyToA(state, opt, contrib);
    if (!opt.centralDisabled && opt.roomModes.central !== 'empty' && opt.doubleRooms.includes('central')) {
      if (centralRestoreOf(state.central.r2) < centralRestoreOf(state.central.r1)) {
        swapCentralRounds(state);
      }
    }

    // 局部搜索可能再次调整总控人员，未排入的信赖干员必须以最终状态为准
    const finalTrustAssigned = new Set([
      ...state.central.r1.map(opIdOf),
      ...state.central.r2.map(opIdOf),
    ]);
    const unassignedTrust = scores.filter(s =>
      opt.trustedAgentIds.has(opIdOf(s)) && !finalTrustAssigned.has(opIdOf(s))
    );
    centralInfo.unassignedTrust = unassignedTrust;

    const rates = restRates(state);
    const timing = {};
    for (const key of ROOM_KEYS) {
      if (opt.roomModes[key] === 'empty') continue;
      timing[key] = roomTiming(key, state, opt, contrib, rates.high, rates.low);
      if (timing[key].feasible === false) warnings.push(`${key} 在当前恢复量下无法维持 24h 稳态循环。`);
    }
    if (timing.central) {
      const highDur = Math.max(11, Math.min(13, Math.ceil(
        Math.max(0, ...PRODUCTION_KEYS.map(k => timing[k] && timing[k].hB ? timing[k].hB : 0))
      )));
      timing.central.highDuration = highDur;
      timing.central.hA = timing.central.round1IsEfficient ? highDur : 24 - highDur;
      timing.central.hB = 24 - timing.central.hA;
    }

    // 组装 result（保持 v1 字段形状）
    const result = {};
    const usedIds = new Set();
    for (const key of ROOM_KEYS) {
      const isDouble = opt.doubleRooms.includes(key);
      const r1 = state[key].r1.slice();
      const r2 = isDouble ? state[key].r2.slice() : [];
      result[key] = {
        recommend: r1.slice(),
        round1: r1,
        round2: r2,
        reserve: [],
      };
      if (opt.roomModes[key] === 'empty') {
        result[key] = { recommend: [], round1: [], round2: [], reserve: [] };
      }
      for (const s of r1) usedIds.add(opIdOf(s));
      for (const s of r2) usedIds.add(opIdOf(s));
    }

    const reserveMap = buildReserve(state, scores, opt, usedIds);
    for (const key of ROOM_KEYS) {
      if (opt.roomModes[key] === 'empty') continue;
      result[key].reserve = reserveMap[key] || [];
    }

    // 总控空置时，信赖干员至少要在数据里可见（供 UI 提示 / 备选展示）
    result._trustedUnassigned = centralInfo.unassignedTrust.map(s => s);
    if (centralInfo.unassignedTrust.length > 0) {
      const names = centralInfo.unassignedTrust.map(s => s.name).join('、');
      const rest = (result.central.reserve || []).filter(op =>
        !centralInfo.unassignedTrust.some(x => opIdOf(x) === opIdOf(op))
      );
      result.central.reserve = centralInfo.unassignedTrust.concat(rest);
      warnings.push(`未排入的信赖干员：${names}`);
    }

    result._timingInfo = timing;
    result._warnings = Array.from(new Set(warnings));
    result._meta = {
      version: VERSION,
      elapsedMs: Math.round((((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0) * 100) / 100,
      optimize: opt.optimize,
      searchIterations: search.iterations,
      searchMoves: search.moves,
      objective: Math.round(search.value * 1000) / 1000,
      cRestHigh: Math.round(rates.high * 1000) / 1000,
      cRestLow: Math.round(rates.low * 1000) / 1000,
    };
    return result;
  }

  // ------------------------------------------------------------
  // 11. 导出
  // ------------------------------------------------------------
  return {
    VERSION,
    ROOM_KEYS,
    normalizeOptions,
    computeScoresForAll,
    generateSchedule,
    solveSteadyLoop,
    groupStats,
    centralRestoreOf,
    restRates,
    // 供手动排班 / 步进模拟复用的纯函数
    computeRoomTiming: function (roomKey, A, B, options, cRestHigh, cRestLow) {
      const opt = normalizeOptions(options);
      const scores = [];
      const seen = new Set();
      for (const op of [...(A || []), ...(B || [])]) {
        if (!op || seen.has(opIdOf(op))) continue;
        seen.add(opIdOf(op));
        scores.push({
          opId: opIdOf(op), id: opIdOf(op), name: op.name, mergedTraits: op.mergedTraits || [], score: op.score || {},
        });
      }
      const contrib = buildContribMap(scores, opt);
      const state = makeState();
      state[roomKey].r1 = A || [];
      state[roomKey].r2 = B || [];
      return roomTiming(roomKey, state, opt, contrib, cRestHigh, cRestLow);
    },
  };
});
