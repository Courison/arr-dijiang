(() => {
  'use strict';
  if (location.protocol === 'http:' && /(^|\.)arr-dijiang\.top$/i.test(location.hostname)) {
    location.replace(`https://${location.host}${location.pathname}${location.search}`);
    return;
  }
  const $ = id => document.getElementById(id);
  const state = { page: 1, limit: 50, total: 0, role: '', search: '' };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmt(ts) {
    if (!ts) return '—';
    const d = new Date(Number(ts) * 1000);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-CN', { hour12: false });
  }
  function showLogin() {
    $('loginView').hidden = false;
    $('appView').hidden = true;
  }
  function showApp() {
    $('loginView').hidden = true;
    $('appView').hidden = false;
  }
  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (res.status === 401) { showLogin(); throw new Error(data.msg || '未登录'); }
    if (!res.ok || data.ok === false) throw new Error(data.msg || '请求失败');
    return data;
  }

  async function loadMe() {
    try {
      const d = await api('/api/admin/me');
      state.role = d.role;
      $('who').dataset.email = d.email;
      $('who').textContent = `${d.nickname || d.email} · ${d.role === 'super' ? '超级管理员' : '管理员'}`;
      $('adminPanel').hidden = d.role !== 'super';
      showApp();
      await Promise.all([loadStats(), loadUsers(), d.role === 'super' ? loadAdmins() : Promise.resolve()]);
    } catch (e) {
      showLogin();
    }
  }

  async function loadStats() {
    const d = await api('/api/admin/stats');
    const labels = [
      ['total_users', '总用户数'], ['new_today', '今日新增'], ['active_7d', '7 日活跃'],
      ['with_config', '已保存配置'], ['configs_updated_7d', '7 日配置更新'], ['admins', '管理员数'],
    ];
    $('stats').innerHTML = labels.map(([k, label]) =>
      `<div class="stat"><div class="label">${label}</div><div class="value">${Number(d.data[k] || 0)}</div></div>`
    ).join('');
  }

  async function loadUsers() {
    const qs = new URLSearchParams({ page: state.page, limit: state.limit });
    if (state.search) qs.set('search', state.search);
    const d = await api(`/api/admin/users?${qs}`);
    state.total = d.pagination.total;
    const rows = d.data.map(u => `<tr>
      <td>${u.id}</td><td>${esc(u.email)}</td><td>${esc(u.nickname || '—')}</td>
      <td>${fmt(u.created_at)}</td><td>${fmt(u.last_login)}</td>
      <td>${u.has_config ? '<span class="tag">有配置</span>' : '—'}</td>
      <td>${fmt(u.config_updated_at)}</td>
      <td>${u.admin_role ? `<span class="tag admin">${u.admin_role === 'super' ? '超级管理员' : '管理员'}</span>` : '—'}</td>
    </tr>`).join('');
    $('usersBody').innerHTML = rows || '<tr><td colspan="8" style="color:#888;text-align:center">没有用户</td></tr>';
    const maxPage = Math.max(1, Math.ceil(state.total / state.limit));
    $('pageInfo').textContent = `第 ${state.page} / ${maxPage} 页 · 共 ${state.total} 人`;
    $('prevBtn').disabled = state.page <= 1;
    $('nextBtn').disabled = state.page >= maxPage;
  }

  async function loadAdmins() {
    const d = await api('/api/admin/admins');
    $('adminList').innerHTML = d.data.map(a => `<li>
      <span class="who"><b>${esc(a.email)}</b><span class="tag ${a.role === 'super' ? 'admin' : ''}">${a.role === 'super' ? '超级管理员' : '管理员'}</span><span style="color:#8a9690">${esc(a.nickname || '')}</span></span>
      ${a.email !== $('who').dataset.email && a.role !== 'super' ? `<button class="ghost remove-admin" data-email="${esc(a.email)}">移除</button>` : ''}
    </li>`).join('');
    document.querySelectorAll('.remove-admin').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`移除管理员 ${btn.dataset.email}？`)) return;
        try { await api(`/api/admin/admins/${encodeURIComponent(btn.dataset.email)}`, { method: 'DELETE' }); await loadAdmins(); await loadStats(); }
        catch (e) { $('adminError').textContent = e.message; }
      });
    });
  }

  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('loginError').textContent = '';
    try {
      await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email: $('loginEmail').value.trim(), password: $('loginPassword').value }),
      });
      $('loginPassword').value = '';
      await loadMe();
    } catch (err) { $('loginError').textContent = err.message; }
  });

  $('logoutBtn').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch (e) {}
    showLogin();
  });

  $('searchBtn').addEventListener('click', () => { state.search = $('searchInput').value.trim(); state.page = 1; loadUsers().catch(e => alert(e.message)); });
  $('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('searchBtn').click(); });
  $('prevBtn').addEventListener('click', () => { if (state.page > 1) { state.page--; loadUsers().catch(e => alert(e.message)); } });
  $('nextBtn').addEventListener('click', () => { const max = Math.max(1, Math.ceil(state.total / state.limit)); if (state.page < max) { state.page++; loadUsers().catch(e => alert(e.message)); } });

  $('addAdminBtn').addEventListener('click', async () => {
    $('adminError').textContent = '';
    const email = $('newAdminEmail').value.trim();
    if (!email) return;
    try {
      await api('/api/admin/admins', { method: 'POST', body: JSON.stringify({ email }) });
      $('newAdminEmail').value = '';
      await loadAdmins(); await loadStats();
    } catch (e) { $('adminError').textContent = e.message; }
  });

  loadMe();
})();
