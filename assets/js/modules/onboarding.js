/* ============================================================
   onboarding.js —— 首次访问引导页 v3

   行为规则：
   1. 未登录 + 本标签页首次打开 → 弹引导页
   2. 已登录 → 永不弹（唯一不展示依据）
   3. 同标签页刷新 / 从子页面返回 → 不弹
   4. 关闭标签页后重开 → 未登录则再弹
   5. 预设干员库：动态读 Agent_characteristics.json，全员精四满练
   ============================================================ */
(function() {
  'use strict';

  const STORAGE_KEY_SHOWN = 'dijiang_onboarding_shown';   // sessionStorage 本标签页已弹
  const STORAGE_KEY_CONFIG = 'DijiangScheduleConfig';

  const overlay = document.getElementById('onboardingOverlay');
  const startBtn = document.getElementById('onboardingStartBtn');
  const presetBtn = document.getElementById('onboardingPresetBtn');
  const skipBtn = document.getElementById('onboardingSkipBtn');
  if (!overlay || !startBtn || !skipBtn) return;

  const step1 = overlay.querySelector('.onboarding-step[data-step="1"]');
  const step2 = overlay.querySelector('.onboarding-step[data-step="2"]');

  let inProgress = false;
  let step1Done = false;
  let step2Done = false;

  // ---------- 状态控制 ----------
  function setStepState(step, state) {
    const el = step === 1 ? step1 : step2;
    if (!el) return;
    const badge = el.querySelector('.onboarding-step-badge');
    el.classList.remove('is-idle', 'is-active', 'is-done');
    el.classList.add(state === 'done' ? 'is-done' : state === 'active' ? 'is-active' : 'is-idle');
    badge.textContent = state === 'done' ? '已完成' : state === 'active' ? '正在进行' : '未开始';
    if (step === 1) step1Done = (state === 'done');
    if (step === 2) step2Done = (state === 'done');
  }

  function isLoggedIn() {
    return !!(localStorage.getItem('dijiang_account_token')
           || sessionStorage.getItem('dijiang_account_token'));
  }

  function hasAnyAgent() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_CONFIG);
      if (!raw) return false;
      const cfg = JSON.parse(raw);
      for (const name in cfg) {
        const v = cfg[name];
        const elite = typeof v === 'string' ? v : (v && v.elite);
        if (elite && elite !== 'none' && elite !== '未拥有') return true;
      }
      return false;
    } catch (e) { return false; }
  }

  function refresh() {
    setStepState(1, isLoggedIn() ? 'done' : 'idle');
    setStepState(2, hasAnyAgent() ? 'done' : 'idle');
  }

  // ---------- 显隐 ----------
  function show() {
    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      refresh();
    });
  }

  function hide() {
    overlay.classList.remove('open');
    setTimeout(() => { overlay.style.display = 'none'; }, 350);
  }

  // ---------- 本标签页已弹标记 ----------
  function markShownInThisTab() {
    try { sessionStorage.setItem(STORAGE_KEY_SHOWN, '1'); } catch (e) {}
  }
  function hasShownInThisTab() {
    try { return sessionStorage.getItem(STORAGE_KEY_SHOWN) === '1'; } catch (e) { return false; }
  }

  // ---------- 打开登录 / 导入 ----------
  function openLogin() {
    if (typeof window.openAccountLogin === 'function') {
      window.openAccountLogin();
    } else {
      const btn = document.getElementById('accountBtn');
      if (btn) btn.click();
    }
  }

  function openImport() {
    if (typeof window.openDataSettings === 'function') {
      window.openDataSettings();
    }
  }

  // ---------- 预设干员库 ----------
  // 动态读取干员列表，全员精四、天赋全激活。兼容后续新增干员。
  async function buildPresetConfig() {
    const res = await fetch('/Agent_characteristics.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rawData = await res.json();
    if (!rawData || Object.keys(rawData).length === 0) throw new Error('干员数据为空');

    let order = rawData.operator_order;
    if (!order || !Array.isArray(order) || order.length === 0) {
      order = Object.keys(rawData).filter(k => k !== 'operator_order');
    }

    const config = {};
    for (const name of order) {
      if (!rawData[name]) continue;
      config[name] = {
        elite: '精四',
        talents: ['1_1', '2_1', '1_2', '2_2'],
      };
    }
    return config;
  }

  // 返回 true 表示成功；返回字符串表示失败原因
  async function applyPresetConfig() {
    try {
      const config = await buildPresetConfig();
      // ★ 先置位跳过标志，防止后续 reload 触发 main.js 的 pagehide 把预设覆盖
      window.__DIJIANG_SKIP_PAGEHIDE_SAVE__ = true;
      sessionStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
      return true;
    } catch (e) {
      window.__DIJIANG_SKIP_PAGEHIDE_SAVE__ = false;
      console.error('[预设] 应用失败：', e);
      return e.message || '未知错误';
    }
  }

  // ---------- 监听登录成功 ----------
  window.addEventListener('dijiang:account-login', function() {
    setStepState(1, 'done');

    // 引导页已打开 → 停留 1 秒让用户看到状态更新，然后自动关闭
    if (overlay.classList.contains('open')) {
      setTimeout(function () {
        hide();
      }, 1000);
    }

    // 用户在引导流程中 → 尝试进入导入步骤
    if (inProgress && !step2Done) {
      setTimeout(() => {
        if (hasAnyAgent()) {
          setStepState(2, 'done');
          hide();
          inProgress = false;
          if (typeof window.DijiangPetSay === 'function') {
            window.DijiangPetSay('管理员，初始化完成，开始排班吧~');
          }
        } else {
          setStepState(2, 'active');
          openImport();
        }
      }, 600);
    } else if (!inProgress) {
      refresh();
    }
  });

  // ---------- 监听导入成功 ----------
  window.addEventListener('dijiang:import-success', function() {
    setStepState(2, 'done');
    if (inProgress) {
      setTimeout(() => {
        hide();
        inProgress = false;
        if (typeof window.DijiangPetSay === 'function') {
          window.DijiangPetSay('管理员，初始化完成，开始排班吧~');
        }
      }, 700);
    }
  });

  // ---------- 按钮：一键登录并导入 ----------
  startBtn.addEventListener('click', function() {
    if (isLoggedIn()) {
      inProgress = true;
      setStepState(1, 'done');
      setStepState(2, 'active');
      openImport();
      return;
    }
    inProgress = true;
    setStepState(1, 'active');
    openLogin();
  });

  // ---------- 按钮：使用预设干员库 ----------
  if (presetBtn) {
    presetBtn.addEventListener('click', async function() {
      const ok = confirm(
        '使用预设干员库将把当前干员配置覆盖为：\n\n' +
        '• 所有干员均设为「精四」\n' +
        '• 所有天赋全部激活\n\n' +
        '（预设基于当前干员数据动态生成，会自动包含后续新增干员）\n\n' +
        '继续吗？'
      );
      if (!ok) return;

      presetBtn.disabled = true;
      const oldHTML = presetBtn.innerHTML;
      presetBtn.innerHTML = '<span class="onboarding-btn-icon">⏳</span> 应用中…';

      const result = await applyPresetConfig();
      if (result === true) {
        markShownInThisTab();
        window.dispatchEvent(new CustomEvent('dijiang:import-success'));
        if (typeof window.DijiangPetSay === 'function') {
          window.DijiangPetSay('管理员，已应用预设干员库（全员精四满练）~');
        }
        // ★ 跳过标志保持到 reload 完成；reload 后 main.js 会重新初始化
        setTimeout(() => { location.reload(); }, 900);
      } else {
        alert('应用失败：' + result);
        presetBtn.disabled = false;
        presetBtn.innerHTML = oldHTML;
      }
    });
  }

  // ---------- 按钮：跳过登录直接开始 ----------
  skipBtn.addEventListener('click', function() {
    hide();
  });

  // ---------- 首次自动显示 ----------
  // 规则：以「是否登录」为唯一不展示依据
  //   - 已登录 → 不展示
  //   - 未登录 → 本标签页首次打开时展示一次
  function autoShow() {
    if (isLoggedIn()) return;             // 已登录，永不展示
    if (hasShownInThisTab()) return;      // 本标签页已弹过
    markShownInThisTab();
    setTimeout(show, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoShow);
  } else {
    autoShow();
  }

  console.log('[引导页] 已加载');
})();