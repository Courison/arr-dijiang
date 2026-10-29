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
  const ROOM_KEYS = ['central', 'manufactA', 'manufactB', 'culture', 'meeting'];
  const PRODUCTION_KEYS = ['manufactA', 'manufactB', 'culture', 'meeting'];
  const DEFAULT_PRIORITY_WEIGHTS = [1.0, 0.6, 0.3];
  const DEFAULT_CULTURE_PRIORITY = ['plant', 'mineral', 'fungi'];
  const MOOD_WEIGHT = 0.3;
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
    const underfillRoom = ROOM_KEYS.includes(o.underfillRoom) ? o.underfillRoom : 'culture';

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

    return {
      mode: ['exp', 'weapon', 'dual'].includes(o.mode) ? o.mode : 'dual',
      roomModes,
      doubleRooms,
      emptyRooms,
      underfillRoom,
      centralDisabled: !!o.centralDisabled || roomModes.central === 'empty',
      trustedAgentIds: toSet(o.trustedAgentIds),
      priorityOrderRound1: (Array.isArray(o.priorityOrderRound1)
        ? o.priorityOrderRound1.slice()
        : ['manufactB', 'manufactA', 'culture', 'meeting', 'central']).filter(k => ROOM_KEYS.includes(k)),
      priorityOrderRound2: (Array.isArray(o.priorityOrderRound2)
        ? o.priorityOrderRound2.slice()
        : ['manufactB', 'manufactA', 'culture', 'meeting', 'central']).filter(k => ROOM_KEYS.includes(k)),
      meetingPriorityEnabled: !!o.meetingPriorityEnabled,
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
        score: { central: 0, meeting: 0, culture: 0, manufact: 0, expScore: 0, weaponScore: 0, moodReduce: 0 },
        isBasic,
      };
      if (!isBasic) {
        for (const t of row.mergedTraits) {
          const room = t.舱室, type = t.类型, val = t.数值 || 0;
          if (room === '总控中枢' && type === '心情恢复提升') row.score.central += val;
          else if (room === '会客室') {
            if (type === '收集线索效率') row.score.meeting += val;
            else if (type === '心情消耗减少') { row.score.meeting += val * MOOD_WEIGHT; row.score.moodReduce += val; }
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
            // dual：A=干员经验；纯 exp：A/B 都吃干员效率；纯 weapon：不吃
            if (opt.mode === 'dual') c.manufactA.eff += val;
            else if (opt.mode === 'exp') { c.manufactA.eff += val; c.manufactB.eff += val; }
          } else if (t.类型 === '武器素材效率') {
            // dual：B=武器经验；纯 weapon：A/B 都吃武器效率；纯 exp：不吃
            if (opt.mode === 'dual') c.manufactB.eff += val;
            else if (opt.mode === 'weapon') { c.manufactA.eff += val; c.manufactB.eff += val; }
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
  function fieldFor(roomKey, mode) {
    if (roomKey === 'central') return 'central';
    if (roomKey === 'meeting') return 'meeting';
    if (roomKey === 'culture') return 'culture';
    if (roomKey === 'manufactA') return mode === 'weapon' ? 'weaponScore' : 'expScore';
    if (roomKey === 'manufactB') return mode === 'exp' ? 'expScore' : 'weaponScore';
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

  function productionOrder(opt, round) {
    const base = round === 1 ? opt.priorityOrderRound1 : opt.priorityOrderRound2;
    let order = base.filter(k => k !== 'central' && opt.roomModes[k] !== 'empty');
    if (round === 2) order = order.filter(k => opt.doubleRooms.includes(k));
    if (opt.meetingPriorityEnabled) {
      order = ['meeting'].concat(order.filter(k => k !== 'meeting'));
    } else {
      // “会客室优先”关闭时，会客室不参与数字顺序，统一放最后，
      // 避免旧配置把会客室设为 1 抢走制造舱专家。
      order = order.filter(k => k !== 'meeting');
      order.push('meeting');
    }
    // 任何被漏掉的启用舱室都补在末尾，避免策略列表旧数据导致整舱不排
    const active = ROOM_KEYS.filter(k =>
      k !== 'central' && opt.roomModes[k] !== 'empty' &&
      (round === 1 || opt.doubleRooms.includes(k))
    );
    for (const k of active) if (!order.includes(k)) order.push(k);
    return order;
  }

  function assignProduction(state, scores, opt) {
    const assigned = new Set();
    const trust = opt.trustedAgentIds;
    const pool = scores.filter(s => !trust.has(opIdOf(s)));

    const pickBest = (key, candidates, pass) => {
      if (!candidates.length) return null;
      const scored = candidates.map(s => {
        let v = 0;
        if (pass === 'specialist') {
          if (key === 'meeting') v = (hasMeetingTalent(s, opt) ? 1e6 : 0) + (s.score.meeting || 0);
          else if (key === 'culture') v = s.score.culture || 0;
          else v = s.score[fieldFor(key, opt.mode)] || 0;
        } else if (pass === 'mood') {
          v = s.score.moodReduce || 0;
        } else {
          // 兜底：优先不抢总控恢复人才，再看生产分数
          v = (s.score.central || 0) > 0 ? -1e6 : 0;
          v += productionValue(s, opt);
        }
        return { s, v };
      });
      scored.sort((a, b) => b.v - a.v || productionValue(a.s, opt) - productionValue(b.s, opt));
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
                if (key === 'meeting') return hasMeetingTalent(s, opt) || (s.score.meeting || 0) > 0;
                if (key === 'culture') return (s.score.culture || 0) > 0;
                return (s.score[fieldFor(key, opt.mode)] || 0) > 0;
              });
            } else if (pass === 'mood') {
              cands = cands.filter(s => (s.score.moodReduce || 0) > 0);
            }
            if (!cands.length) break;
            const picked = pickBest(key, cands, pass);
            if (!picked) break;
            arr.push(picked);
            assigned.add(picked.opId);
          }
        }
      };

      const hasMeeting = order.includes('meeting');
      const primary = order.filter(k => k !== 'meeting');

      // 会客室优先开启：会客室按原顺序先拿人。
      // 关闭：先把制造/培养的专家、心情、兜底全部排完，再排会客室，
      // 避免会客室用“线索天赋”抢走制造舱的跨舱专家。
      if (opt.meetingPriorityEnabled) {
        for (const pass of ['specialist', 'mood', 'generic']) runPass(pass, order);
      } else {
        for (const pass of ['specialist', 'mood', 'generic']) runPass(pass, primary);
        if (hasMeeting) runPass('specialist', ['meeting']);
        if (hasMeeting) runPass('mood', ['meeting']);
        if (hasMeeting) runPass('generic', ['meeting']);
      }
    };

    fillRound('r1', productionOrder(opt, 1));
    fillRound('r2', productionOrder(opt, 2));
    return assigned;
  }

  // ------------------------------------------------------------
  // 6. 总控独立分配
  // ------------------------------------------------------------
  function productionValue(s, opt) {
    // 用“最擅长的生产舱分数”近似机会成本：越高越应该留在生产
    const mode = opt.mode;
    const m = Math.max(
      mode === 'weapon' ? 0 : (s.score.expScore || 0),
      mode === 'exp' ? 0 : (s.score.weaponScore || 0),
      s.score.meeting || 0,
      s.score.culture || 0
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
      const rest = withTalent.filter(s => !highIds.has(opIdOf(s)) && !lowIds.has(opIdOf(s)));
      for (const s of rest) { if (low.length >= CAP) break; low.push(s); }
      for (const s of noTalent) {
        if (low.length >= CAP) break;
        if (lowIds.has(opIdOf(s)) || highIds.has(opIdOf(s))) continue;
        low.push(s);
      }
      state.central.r2 = high;
      state.central.r1 = low;
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
      if (centralRestoreOf(c.r2) < centralRestoreOf(c.r1)) {
        const tmp = c.r1; c.r1 = c.r2; c.r2 = tmp;
      }
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

    // 保持 B 班（round2）恢复量不低于 A 班；借入恢复型干员后仍成立
    if (centralRestoreOf(c.r2) < centralRestoreOf(c.r1)) {
      const tmp = c.r1; c.r1 = c.r2; c.r2 = tmp;
    }
  }

  // ------------------------------------------------------------
  // 7. 目标函数与局部搜索
  // ------------------------------------------------------------
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
      const free = scores.filter(s => !used.has(opIdOf(s)));
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
      const field = fieldFor(key, opt.mode);
      let cand = reservePool.filter(s => (s.score[field] || 0) > 0);
      cand.sort((a, b) => (b.score[field] || 0) - (a.score[field] || 0));
      if (key === 'meeting') {
        cand = cand.filter(s => {
          let hasOther = false;
          for (const t of s.mergedTraits || []) {
            if (t.舱室 === '会客室' && (t.类型 === '收集线索效率' || t.类型 === '心情消耗减少')) { hasOther = true; break; }
          }
          if (!hasOther && (s.mergedTraits || []).some(t => t.舱室 === '会客室' && isCluePower(t.类型))) return false;
          return true;
        });
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

    if (opt.centralDisabled && opt.trustedAgentIds.size > 0) {
      warnings.push('总控中枢为空置，信赖干员没有可排入的舱室；请启用总控或取消信赖选择。');
    }
    if (!opt.centralDisabled && centralInfo.unassignedTrust.length > 0) {
      warnings.push(`总控容量不足，${centralInfo.unassignedTrust.length} 名信赖干员未能排入总控。`);
    }

    const search = localSearch(state, scores, opt, contrib);
    normalizeRounds(state, opt);
    sortRoundsByEfficiency(state, opt, contrib);

    // 双班总控至少每班 1 人；不足时按“可接受不满员”舱室借人
    enforceCentralMinimum(state, opt, warnings, contrib);

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
