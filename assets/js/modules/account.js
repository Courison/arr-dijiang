/* ============================================================
   account.js —— 邮箱账号系统
   ============================================================ */
(function() {
  'use strict';

  const TOKEN_KEY = 'dijiang_account_token';
  const EMAIL_KEY = 'dijiang_account_email';
  const NICKNAME_KEY = 'dijiang_account_nickname';
  const APPLIED_AT_KEY = 'dijiang_account_config_applied_at';

  const headerBtn = document.getElementById('accountBtn');
  const headerLabel = document.getElementById('accountLabel');

  const loginModal = document.getElementById('accountModal');
  const loginCloseBtn = document.getElementById('accountCloseBtn');
  const tabs = document.querySelectorAll('#accountModal .account-tabs button');
  const paneLogin = document.getElementById('paneLogin');
  const paneRegister = document.getElementById('paneRegister');
  const paneReset = document.getElementById('paneReset');

  const manageModal = document.getElementById('accountManageModal');
  const manageCloseBtn = document.getElementById('accountManageCloseBtn');

  let currentEmail = null;
  let currentNickname = null;
  let currentToken = null;

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null;
  }
  function getEmail() {
    return localStorage.getItem(EMAIL_KEY) || sessionStorage.getItem(EMAIL_KEY) || null;
  }
  function getNickname() {
    return localStorage.getItem(NICKNAME_KEY) || sessionStorage.getItem(NICKNAME_KEY) || null;
  }
  function saveAuth(token, email, remember, nickname) {
    const store = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;
    other.removeItem(TOKEN_KEY);
    other.removeItem(EMAIL_KEY);
    other.removeItem(NICKNAME_KEY);
    store.setItem(TOKEN_KEY, token);
    store.setItem(EMAIL_KEY, email);
    if (nickname) store.setItem(NICKNAME_KEY, nickname);
    currentToken = token;
    currentEmail = email;
    currentNickname = nickname || email.split('@')[0];
    updateHeader();
  }
  function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(NICKNAME_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EMAIL_KEY);
    sessionStorage.removeItem(NICKNAME_KEY);
    currentToken = null;
    currentEmail = null;
    currentNickname = null;
    updateHeader();
  }

  function updateHeader() {
    if (!headerBtn || !headerLabel) return;
    if (currentEmail) {
      headerBtn.classList.add('logged-in');
      headerLabel.textContent = currentNickname || currentEmail.split('@')[0];
      headerBtn.title = currentEmail + '（点击管理账号）';
    } else {
      headerBtn.classList.remove('logged-in');
      headerLabel.textContent = '登录';
      headerBtn.title = '点击登录';
    }
  }

  function setStatus(el, text, cls) {
    if (!el) return;
    el.textContent = text;
    el.className = 'account-status ' + (cls || 'info');
  }

  function isEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  async function authFetch(url, options) {
    const opts = options || {};
    opts.headers = opts.headers || {};
    if (currentToken) opts.headers['Authorization'] = 'Bearer ' + currentToken;
    return fetch(url, opts);
  }

  // ---------- Tab 切换 ----------
  function switchTab(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    paneLogin.style.display = name === 'login' ? '' : 'none';
    paneRegister.style.display = name === 'register' ? '' : 'none';
    paneReset.style.display = name === 'reset' ? '' : 'none';
  }

  function openLoginModal() {
    if (currentEmail) { openManageModal(); return; }
    loginModal.classList.add('open');
    switchTab('login');
    ['loginEmail','loginPassword','regEmail','regCode','regPassword','regPassword2',
     'resetEmail','resetCode','resetNewPassword','resetNewPassword2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    ['loginStatus','regStatus','resetStatus'].forEach(id => {
      const el = document.getElementById(id);
      if (el) setStatus(el, '', '');
    });
  }
  function closeLoginModal() { loginModal.classList.remove('open'); }

  // ---------- 发送验证码 ----------
  async function sendCode(email, purpose, btn, statusEl) {
    if (!isEmail(email)) { setStatus(statusEl, '请输入正确的邮箱', 'err'); return; }
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '发送中…';
    try {
      const resp = await fetch('/api/account/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose }),
      });
      const data = await resp.json();
      if (data.ok) {
        setStatus(statusEl, '✅ ' + data.msg, 'ok');
        let remain = 60;
        btn.textContent = `${remain}s`;
        const t = setInterval(() => {
          remain--;
          if (remain <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = original; }
          else btn.textContent = `${remain}s`;
        }, 1000);
      } else {
        setStatus(statusEl, '❌ ' + data.msg, 'err');
        btn.disabled = false;
        btn.textContent = original;
      }
    } catch (e) {
      setStatus(statusEl, '❌ 网络错误', 'err');
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  // ---------- 登录 ----------
  async function doLogin() {
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;
    const remember = document.getElementById('loginRemember').checked;
    const statusEl = document.getElementById('loginStatus');
    const btn = document.getElementById('loginSubmitBtn');

    if (!isEmail(email)) { setStatus(statusEl, '邮箱格式不正确', 'err'); return; }
    if (!password) { setStatus(statusEl, '请输入密码', 'err'); return; }

    btn.disabled = true;
    btn.textContent = '登录中…';
    setStatus(statusEl, '正在登录…', 'info');

    try {
      const resp = await fetch('/api/account/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await resp.json();
      if (data.ok) {
        saveAuth(data.token, data.email, remember, data.nickname);
        setStatus(statusEl, '✅ 登录成功', 'ok');
        // ★ 派发登录成功事件
        window.dispatchEvent(new CustomEvent('dijiang:account-login', {
          detail: { email: data.email }
        }));
        // ★ 自动拉取账号配置（非静默：本地已有数据时会询问是否覆盖）
        const autoLoaded = await autoFetchConfig(false);
        setTimeout(() => {
          closeLoginModal();
          if (!autoLoaded && typeof window.DijiangPetSay === 'function') {
            window.DijiangPetSay('管理员，欢迎回来~');
          }
        }, 500);
      } else {
        setStatus(statusEl, '❌ ' + data.msg, 'err');
        btn.disabled = false;
        btn.textContent = '登 录';
      }
    } catch (e) {
      setStatus(statusEl, '❌ 网络错误', 'err');
      btn.disabled = false;
      btn.textContent = '登 录';
    }
  }

  // ---------- 注册 ----------
  function checkPwdStrength(pwd) {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (/[a-zA-Z]/.test(pwd) && /\d/.test(pwd)) score++;
    if (pwd.length >= 12 || /[^a-zA-Z0-9]/.test(pwd)) score++;
    if (score <= 1) return 'weak';
    if (score === 2) return 'medium';
    return 'strong';
  }

  async function doRegister() {
    const email = document.getElementById('regEmail').value.trim().toLowerCase();
    const nickname = document.getElementById('regNickname').value.trim();
    const code = document.getElementById('regCode').value.trim();
    const pwd = document.getElementById('regPassword').value;
    const pwd2 = document.getElementById('regPassword2').value;
    const statusEl = document.getElementById('regStatus');
    const btn = document.getElementById('regSubmitBtn');

    if (!isEmail(email)) { setStatus(statusEl, '邮箱格式不正确', 'err'); return; }
    if (!nickname) { setStatus(statusEl, '请填写昵称', 'err'); return; }
    if (nickname.length > 20) { setStatus(statusEl, '昵称不能超过 20 个字符', 'err'); return; }
    if (!code) { setStatus(statusEl, '请输入验证码', 'err'); return; }
    if (pwd.length < 8 || !/[a-zA-Z]/.test(pwd) || !/\d/.test(pwd)) {
      setStatus(statusEl, '密码至少 8 位，需含字母和数字', 'err'); return;
    }
    if (pwd !== pwd2) { setStatus(statusEl, '两次密码不一致', 'err'); return; }

    btn.disabled = true;
    btn.textContent = '注册中…';
    setStatus(statusEl, '正在注册…', 'info');

    try {
      const resp = await fetch('/api/account/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, nickname, code, password: pwd }),
      });
      const data = await resp.json();
      if (data.ok) {
        saveAuth(data.token, data.email, true, data.nickname);
        setStatus(statusEl, '✅ 注册成功', 'ok');
        window.dispatchEvent(new CustomEvent('dijiang:account-login', {
          detail: { email: data.email, nickname: data.nickname }
        }));
        await autoFetchConfig(true);
        setTimeout(() => {
          closeLoginModal();
          if (typeof window.DijiangPetSay === 'function') {
            window.DijiangPetSay(`管理员，欢迎加入~`);
          }
        }, 500);
      } else {
        setStatus(statusEl, '❌ ' + data.msg, 'err');
        btn.disabled = false;
        btn.textContent = '注 册';
      }
    } catch (e) {
      setStatus(statusEl, '❌ 网络错误', 'err');
      btn.disabled = false;
      btn.textContent = '注 册';
    }
  }

  // ---------- 找回密码 ----------
  async function doReset() {
    const email = document.getElementById('resetEmail').value.trim().toLowerCase();
    const code = document.getElementById('resetCode').value.trim();
    const pwd = document.getElementById('resetNewPassword').value;
    const pwd2 = document.getElementById('resetNewPassword2').value;
    const statusEl = document.getElementById('resetStatus');
    const btn = document.getElementById('resetSubmitBtn');

    if (!isEmail(email)) { setStatus(statusEl, '邮箱格式不正确', 'err'); return; }
    if (!code) { setStatus(statusEl, '请输入验证码', 'err'); return; }
    if (pwd.length < 8 || !/[a-zA-Z]/.test(pwd) || !/\d/.test(pwd)) {
      setStatus(statusEl, '密码至少 8 位，需含字母和数字', 'err'); return;
    }
    if (pwd !== pwd2) { setStatus(statusEl, '两次密码不一致', 'err'); return; }

    btn.disabled = true;
    btn.textContent = '重置中…';
    setStatus(statusEl, '正在重置…', 'info');

    try {
      const resp = await fetch('/api/account/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword: pwd }),
      });
      const data = await resp.json();
      if (data.ok) {
        saveAuth(data.token, data.email, true, data.nickname);
        setStatus(statusEl, '✅ 密码已重置，已自动登录', 'ok');
        window.dispatchEvent(new CustomEvent('dijiang:account-login', {
          detail: { email: data.email }
        }));
        // ★ 自动拉取配置
        await autoFetchConfig(false);
        setTimeout(() => { closeLoginModal(); }, 800);
      } else {
        setStatus(statusEl, '❌ ' + data.msg, 'err');
        btn.disabled = false;
        btn.textContent = '重 置';
      }
    } catch (e) {
      setStatus(statusEl, '❌ 网络错误', 'err');
      btn.disabled = false;
      btn.textContent = '重 置';
    }
  }

  // ---------- 账号管理 ----------
  function openManageModal() {
    if (!currentEmail) { openLoginModal(); return; }
    document.getElementById('manageNickname').textContent = currentNickname || currentEmail.split('@')[0];
    document.getElementById('manageEmail').textContent = currentEmail;
    fetch('/api/account/me', {
      headers: { 'Authorization': 'Bearer ' + currentToken },
    }).then(r => r.json()).then(data => {
      if (data.ok) {
        const created = data.created_at ? new Date(data.created_at * 1000).toLocaleDateString() : '—';
        const lastLogin = data.last_login ? new Date(data.last_login * 1000).toLocaleString() : '—';
        document.getElementById('manageCreated').textContent = created;
        document.getElementById('manageLastLogin').textContent = lastLogin;
      }
    }).catch(() => {});
    document.getElementById('manageStatus').textContent = '';
    document.getElementById('manageStatus').className = 'account-status';
    manageModal.classList.add('open');
  }
  function closeManageModal() { manageModal.classList.remove('open'); }

  async function uploadConfig() {
    if (!window.DijiangAccount) { alert('配置接口未就绪'); return; }
    const config = window.DijiangAccount.getCurrentConfig();
    const statusEl = document.getElementById('manageStatus');
    setStatus(statusEl, '正在上传…', 'info');
    try {
      const resp = await authFetch('/api/account/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      const data = await resp.json();
      if (data.ok) {
        // ★ 记录已应用版本，避免下次自动拉取时因 updated_at 变化而弹框
        if (data.updated_at) {
          sessionStorage.setItem(APPLIED_AT_KEY, String(data.updated_at));
        }
        setStatus(statusEl, '✅ 配置已上传到账号', 'ok');
      } else {
        setStatus(statusEl, '❌ ' + data.msg, 'err');
      }
    } catch (e) {
      setStatus(statusEl, '❌ 网络错误', 'err');
    }
  }

  async function downloadConfig() {
    const statusEl = document.getElementById('manageStatus');
    setStatus(statusEl, '正在下载…', 'info');
    try {
      const resp = await authFetch('/api/account/config');
      const data = await resp.json();
      if (!data.ok) { setStatus(statusEl, '❌ ' + data.msg, 'err'); return; }
      if (!data.config) { setStatus(statusEl, '⚠️ 账号暂无保存的配置', 'err'); return; }
      if (!window.DijiangAccount) { setStatus(statusEl, '❌ 配置接口未就绪', 'err'); return; }
      window.DijiangAccount.applyConfig(data.config);
      if (data.updated_at) {
        sessionStorage.setItem(APPLIED_AT_KEY, String(data.updated_at));
      }
      const when = data.updated_at ? new Date(data.updated_at * 1000).toLocaleString() : '未知';
      setStatus(statusEl, `✅ 配置已应用（保存于 ${when}）`, 'ok');
    } catch (e) {
      setStatus(statusEl, '❌ 网络错误', 'err');
    }
  }
  
  // 登录后自动检查账号是否有保存的配置，有就应用
  // silent = true → 不弹确认框，直接应用（用于注册/重置密码后）
  async function autoFetchConfig(silent) {
    if (!currentToken) return false;
    try {
      const resp = await authFetch('/api/account/config');
      const data = await resp.json();
      if (!data.ok) return false;
      if (!data.config) return false;

      const accountUpdatedAt = data.updated_at || 0;
      const appliedAt = parseInt(sessionStorage.getItem(APPLIED_AT_KEY) || '0', 10);

      // ★ 账号配置没变 → 静默跳过，不弹框、不覆盖
      if (accountUpdatedAt && accountUpdatedAt === appliedAt) {
        return false;
      }

      // 检测本地是否已有非空配置（干员库 OR 生产策略）
      const localHasData = (function() {
        try {
          const raw = sessionStorage.getItem('DijiangScheduleConfig');
          if (raw) {
            const cfg = JSON.parse(raw);
            for (const name in cfg) {
              const v = cfg[name];
              const elite = typeof v === 'string' ? v : (v && v.elite);
              if (elite && elite !== 'none' && elite !== '未拥有') return true;
            }
          }
          if (sessionStorage.getItem('DijiangDefaultProduct')) return true;
          if (sessionStorage.getItem('DijiangManualProduct')) return true;
          if (sessionStorage.getItem('doubleRoundRooms')) return true;
          return false;
        } catch (e) { return false; }
      })();

      // 本地已有数据 → 询问是否覆盖
      if (localHasData && !silent) {
        const when = accountUpdatedAt ? new Date(accountUpdatedAt * 1000).toLocaleString() : '未知';
        const ok = confirm(
          `账号中存在保存的干员配置（保存于 ${when}）。\n\n` +
          `是否用账号配置覆盖当前页面的配置？\n` +
          `（点击"取消"保留当前页面配置）`
        );
        if (!ok) {
          // ★ 用户拒绝后记录版本，避免同一会话反复弹
          sessionStorage.setItem(APPLIED_AT_KEY, String(accountUpdatedAt));
          return false;
        }
      }

      // 应用配置
      if (window.DijiangAccount && typeof window.DijiangAccount.applyConfig === 'function') {
        window.DijiangAccount.applyConfig(data.config);
        sessionStorage.setItem(APPLIED_AT_KEY, String(accountUpdatedAt));
        const when = accountUpdatedAt ? new Date(accountUpdatedAt * 1000).toLocaleString() : '未知';
        console.log(`[账号] 已自动应用账号配置（保存于 ${when}）`);
        if (typeof window.DijiangPetSay === 'function') {
          window.DijiangPetSay(`管理员，已自动加载你的干员数据~`);
        }
        window.dispatchEvent(new CustomEvent('dijiang:import-success'));
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[账号] 自动拉取配置失败:', e);
      return false;
    }
  }
  
  async function doLogout() {
    if (!confirm('确定要退出登录吗？')) return;
    try { await authFetch('/api/account/logout', { method: 'POST' }); } catch (e) {}
    clearAuth();
    sessionStorage.removeItem(APPLIED_AT_KEY);
    closeManageModal();
    if (typeof window.DijiangPetSay === 'function') {
      window.DijiangPetSay('管理员，已退出登录');
    }
  }

  async function changePassword() {
    const oldPwd = document.getElementById('changeOldPwd').value;
    const newPwd = document.getElementById('changeNewPwd').value;
    const newPwd2 = document.getElementById('changeNewPwd2').value;
    const statusEl = document.getElementById('changePwdStatus');

    if (!oldPwd || !newPwd) { setStatus(statusEl, '请填写完整', 'err'); return; }
    if (newPwd.length < 8 || !/[a-zA-Z]/.test(newPwd) || !/\d/.test(newPwd)) {
      setStatus(statusEl, '新密码至少 8 位，需含字母和数字', 'err'); return;
    }
    if (newPwd !== newPwd2) { setStatus(statusEl, '两次密码不一致', 'err'); return; }

    try {
      const resp = await authFetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      });
      const data = await resp.json();
      if (data.ok) {
        currentToken = data.token;
        const remember = !!localStorage.getItem(TOKEN_KEY);
        saveAuth(data.token, currentEmail, remember);
        setStatus(statusEl, '✅ 密码已修改', 'ok');
        document.getElementById('changeOldPwd').value = '';
        document.getElementById('changeNewPwd').value = '';
        document.getElementById('changeNewPwd2').value = '';
      } else {
        setStatus(statusEl, '❌ ' + data.msg, 'err');
      }
    } catch (e) {
      setStatus(statusEl, '❌ 网络错误', 'err');
    }
  }

  // ---------- 注销账号 ----------
  async function deleteAccount() {
    if (!currentEmail) return;

    const confirmText = prompt(
      `⚠️ 危险操作：注销账号后，以下数据将被永久删除，无法恢复：\n\n` +
      `• 账号本身（${currentEmail}）\n` +
      `• 云端保存的干员配置\n` +
      `• 所有登录令牌\n\n` +
      `请输入您的邮箱以确认注销：`
    );

    if (confirmText === null) return;
    if (confirmText.trim().toLowerCase() !== currentEmail) {
      alert('邮箱不匹配，已取消注销。');
      return;
    }

    const finalConfirm = confirm('最后确认：真的要注销账号吗？此操作不可撤销。');
    if (!finalConfirm) return;

    const statusEl = document.getElementById('manageStatus');
    setStatus(statusEl, '正在注销…', 'info');

    try {
      const resp = await authFetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail: currentEmail }),
      });
      const data = await resp.json();
      if (data.ok) {
        setStatus(statusEl, '✅ 账号已注销', 'ok');
        clearAuth();
        setTimeout(() => {
          closeManageModal();
          if (typeof window.DijiangPetSay === 'function') {
            window.DijiangPetSay('管理员，账号已注销，后会有期~');
          }
        }, 1000);
      } else {
        setStatus(statusEl, '❌ ' + data.msg, 'err');
      }
    } catch (e) {
      setStatus(statusEl, '❌ 网络错误', 'err');
    }
  }
  // ---------- 初始化 ----------
  async function init() {
    currentToken = getToken();
    currentEmail = getEmail();
    currentNickname = getNickname();

    if (currentToken) {
      try {
        const resp = await authFetch('/api/account/me');
        if (resp.status === 401) {
          clearAuth();
        } else {
          const data = await resp.json();
          if (data.ok) {
            currentEmail = data.email;
            currentNickname = data.nickname || data.email.split('@')[0];
            const remember = !!localStorage.getItem(TOKEN_KEY);
            saveAuth(currentToken, currentEmail, remember, currentNickname);
          } else {
            clearAuth();
          }
        }
      } catch (e) {}
    }
    updateHeader();

    if (headerBtn) {
      headerBtn.addEventListener('click', () => {
        if (currentEmail) openManageModal();
        else openLoginModal();
      });
    }
    if (loginCloseBtn) loginCloseBtn.addEventListener('click', closeLoginModal);
    if (loginModal) loginModal.addEventListener('click', e => {
      if (e.target === loginModal) closeLoginModal();
    });
    if (manageCloseBtn) manageCloseBtn.addEventListener('click', closeManageModal);
    if (manageModal) manageModal.addEventListener('click', e => {
      if (e.target === manageModal) closeManageModal();
    });

    tabs.forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

    document.getElementById('loginSubmitBtn').addEventListener('click', doLogin);
    document.getElementById('loginPassword').addEventListener('keydown', e => {
      if (e.key === 'Enter') doLogin();
    });
    document.getElementById('forgotPwdLink').addEventListener('click', () => switchTab('reset'));

    document.getElementById('regSendCodeBtn').addEventListener('click', function() {
      const email = document.getElementById('regEmail').value.trim().toLowerCase();
      sendCode(email, 'register', this, document.getElementById('regStatus'));
    });
    document.getElementById('regSubmitBtn').addEventListener('click', doRegister);
    document.getElementById('regPassword').addEventListener('input', function() {
      const el = document.getElementById('regPwdStrength');
      el.className = 'pwd-strength ' + checkPwdStrength(this.value);
    });
    document.getElementById('backToLoginFromReg').addEventListener('click', () => switchTab('login'));

    document.getElementById('resetSendCodeBtn').addEventListener('click', function() {
      const email = document.getElementById('resetEmail').value.trim().toLowerCase();
      sendCode(email, 'reset', this, document.getElementById('resetStatus'));
    });
    document.getElementById('resetSubmitBtn').addEventListener('click', doReset);
    document.getElementById('backToLoginFromReset').addEventListener('click', () => switchTab('login'));

    document.getElementById('manageUploadBtn').addEventListener('click', uploadConfig);
    document.getElementById('manageDownloadBtn').addEventListener('click', downloadConfig);
    document.getElementById('manageChangePwdBtn').addEventListener('click', changePassword);
    document.getElementById('manageLogoutBtn').addEventListener('click', doLogout);
    const delBtn = document.getElementById('manageDeleteAccountBtn');
    if (delBtn) delBtn.addEventListener('click', deleteAccount);

    // ★ 暴露给引导页调用
    window.openAccountLogin = function() {
      if (currentEmail) openManageModal();
      else openLoginModal();
    };

    // ★ 已登录用户：等主站就绪后自动拉取账号配置（干员库 + 生产策略）
    if (currentToken) {
      const runAutoFetch = () => {
        autoFetchConfig(false).catch(() => {});
      };
      if (window.__DIJIANG_READY__ === true) {
        // main.js 已就绪（比如用户先登录再访问，或刷新后 main.js 先执行完）
        runAutoFetch();
      } else {
        // 等待 main.js 派发 ready
        window.addEventListener('dijiang:ready', runAutoFetch, { once: true });
      }
    }
    console.log('[账号模块] 已加载');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();