#!/usr/bin/env node
/**
 * 帝江号 v2 · 本地开发服务器
 * - 静态托管 app/ 下的原站点（多页）
 * - 运行时注入 v2 外壳 CSS/JS，不修改原 HTML 文件
 * - 本地演示 API：账号/配置可用；导入/扫码需接真实后端
 * - DIJIANG_REAL_API=1 时把 /api/* 代理到本机 5001/5002/5003
 *
 * 用法：node server.mjs  或  npm run dev
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// 极简 .env 读取（存在才生效；不覆盖已有环境变量）
try {
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2].replace(/^['"]|['"]$/g, '');
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
} catch { /* ignore */ }

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
const REAL_API = process.env.DIJIANG_REAL_API === '1';

// 本地演示账号/配置（仅进程内存，不落盘）
const demoAccount = { email: 'demo@local', nickname: '本地演示' };
let demoConfig = null;
let demoConfigUpdated = 0;

const ROUTES = {
  '/': 'index.html',
  '/manual/': 'manual/index.html',
  '/manual/step/': 'manual/step/index.html',
  '/agentpackage/': 'agentpackage/index.html',
  '/development/': 'development/index.html',
  '/help/': 'help/index.html',
  '/log/': 'log/index.html',
  '/admin/': 'admin/index.html',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.php': 'text/plain; charset=utf-8',
};

const INJECT_HEAD = `
  <!-- 帝江号 v2（由本地服务器注入，不修改原 HTML） -->
  <meta name="theme-color" content="#3F7E6B">
  <meta name="view-transition" content="same-origin">
  <link rel="stylesheet" href="/v2/css/tokens.css">
  <link rel="stylesheet" href="/v2/css/rooms.css">
  <link rel="stylesheet" href="/v2/css/theme.css">
`;
const INJECT_BODY = `
  <script type="module" src="/v2/js/shell.js"></script>
`;

// 在任何内容绘制前把 v2 class 挂到 body，避免“先看到旧版页面再变宽/变窄”
const INJECT_EARLY = `<script id="dj-v2-early">document.documentElement.classList.add('dj-v2');document.body.classList.add('dj-v2');</script>`;

function injectHtml(html) {
  let out = html;
  if (!out.includes('dj-v2-early')) {
    out = out.replace(/<body([^>]*)>/i, `<body$1>${INJECT_EARLY}`);
  }
  // 首页预留概览区高度，避免 shell 插入 KPI 时整页下跳
  if (!out.includes('v2OverviewPlaceholder')) {
    out = out.replace(/<div([^>]*id="scheduleResult"[^>]*)>/i,
      '<div id="v2OverviewPlaceholder" class="v2-overview-placeholder" aria-hidden="true"></div>$&');
  }
  if (!out.includes('/v2/css/theme.css')) out = out.replace('</head>', `${INJECT_HEAD}</head>`);
  if (!out.includes('/v2/js/shell.js')) out = out.replace('</body>', `${INJECT_BODY}</body>`);
  return out;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...headers,
  });
  res.end(body);
}

function sendJson(res, obj, status = 200) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function readJson(req) {
  try { return JSON.parse((await readBody(req)) || '{}'); } catch { return {}; }
}

function proxyApi(req, res, pathname) {
  const port = pathname.startsWith('/api/account') || pathname.startsWith('/api/admin') ? 5003
    : pathname.startsWith('/api/qr') || pathname.startsWith('/api/endfield') ? 5002
    : 5001;
  const target = http.request({
    host: '127.0.0.1',
    port,
    path: pathname + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''),
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${port}` },
  }, up => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  target.on('error', e => sendJson(res, { ok: false, msg: `本地后端 ${port} 不可用：${e.message}` }, 502));
  req.pipe(target);
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/health' || pathname === '/api/v1/health') {
    return sendJson(res, { ok: true, service: 'dijiang-v2-local', mode: REAL_API ? 'proxy' : 'demo', version: '2.0.0-local' });
  }
  if (REAL_API) return proxyApi(req, res, pathname);

  // ---- 本地演示：账号/配置 ----
  if (pathname.startsWith('/api/account/')) {
    const action = pathname.slice('/api/account/'.length);
    const needsBody = ['login', 'register', 'reset-password', 'change-password', 'delete', 'send-code', 'config'].includes(action);
    const body = needsBody ? await readJson(req) : {};
    const email = String(body.email || demoAccount.email || 'demo@local');
    const nickname = String(body.nickname || '本地演示');
    const now = Math.floor(Date.now() / 1000);
    if (action === 'login' || action === 'register') { demoAccount.email = email; demoAccount.nickname = nickname; }

    if (action === 'send-code') {
      return sendJson(res, { ok: true, msg: '本地演示：验证码固定为 123456', code: '123456' });
    }
    if (action === 'login') {
      return sendJson(res, { ok: true, token: 'demo-token', email, nickname: '本地演示', msg: '本地演示登录成功' });
    }
    if (action === 'register') {
      return sendJson(res, { ok: true, token: 'demo-token', email, nickname, msg: '本地演示账号已创建' });
    }
    if (action === 'reset-password') {
      return sendJson(res, { ok: true, token: 'demo-token', email, nickname: '本地演示', msg: '本地演示：密码已重置' });
    }
    if (action === 'change-password') {
      return sendJson(res, { ok: true, token: 'demo-token', msg: '本地演示：密码已修改' });
    }
    if (action === 'logout') return sendJson(res, { ok: true });
    if (action === 'delete') return sendJson(res, { ok: true, msg: '本地演示：账号已注销' });
    if (action === 'me') {
      return sendJson(res, { ok: true, email: demoAccount.email, nickname: demoAccount.nickname, created_at: now - 86400, last_login: now });
    }
    if (action === 'config' && req.method === 'GET') {
      return sendJson(res, { ok: true, config: demoConfig, updated_at: demoConfigUpdated });
    }
    if (action === 'config' && req.method === 'POST') {
      demoConfig = body.config ?? null;
      demoConfigUpdated = now;
      return sendJson(res, { ok: true, updated_at: demoConfigUpdated, msg: '本地演示：配置已保存到内存（刷新服务后清空）' });
    }
    return sendJson(res, { ok: false, msg: `本地演示未实现：/api/account/${action}` }, 404);
  }

  // ---- 本地演示：导入/扫码 ----
  if (pathname.startsWith('/api/')) {
    return sendJson(res, {
      ok: false,
      msg: '本地演示环境未接入鹰角/森空岛接口。请使用“预设干员库”或本地导入/导出；需要真实导入时设置 DIJIANG_REAL_API=1 并启动三个后端。',
      local_demo: true,
    });
  }
  return sendJson(res, { ok: false, msg: 'not found' }, 404);
}

function safePath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const resolved = path.resolve(ROOT, '.' + decoded);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) return null;
  return resolved;
}

function serveFile(req, res, filePath, pathname) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { return false; }
  if (stat.isDirectory()) {
    const idx = path.join(filePath, 'index.html');
    if (fs.existsSync(idx)) return serveFile(req, res, idx, pathname);
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Cache-Control': ext === '.html' ? 'no-store' : ext === '.css' || ext === '.js' || ext === '.mjs' ? 'no-cache' : 'public, max-age=2592000',
  };
  if (ext === '.html') {
    const html = fs.readFileSync(filePath, 'utf8');
    return send(res, 200, injectHtml(html), headers);
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  let pathname = url.pathname;

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' });
      return res.end();
    }

    if (pathname === '/favicon.ico') return send(res, 204, '');
    if (pathname.startsWith('/.') || ['/server.mjs', '/package.json', '/README.md', '/start.cmd', '/start.ps1'].includes(pathname)
      || pathname.startsWith('/tools/')) {
      return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    if (pathname === '/submit_feedback.php') {
      return sendJson(res, { ok: true, success: true, msg: '本地演示：反馈已记录（不会上传）' });
    }
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);

    // 目录路由：/manual -> /manual/
    if (ROUTES[pathname + '/']) {
      res.writeHead(301, { Location: pathname + '/' });
      return res.end();
    }
    if (ROUTES[pathname]) {
      const file = path.join(ROOT, ROUTES[pathname]);
      if (serveFile(req, res, file, pathname)) return;
    }

    if (pathname === '/') {
      if (serveFile(req, res, path.join(ROOT, 'index.html'), pathname)) return;
    }

    const file = safePath(pathname);
    if (file && serveFile(req, res, file, pathname)) return;

    const notFound = path.join(ROOT, '404.html');
    if (fs.existsSync(notFound)) {
      const html = fs.readFileSync(notFound, 'utf8');
      return send(res, 404, injectHtml(html), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  } catch (e) {
    console.error('[dijiang-v2]', e);
    if (!res.headersSent) sendJson(res, { ok: false, msg: 'local server error', detail: String(e.message || e) }, 500);
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  帝江号 v2 · 本地开发环境');
  console.log(`  首页      http://${HOST}:${PORT}/`);
  console.log(`  手动排班  http://${HOST}:${PORT}/manual/`);
  console.log(`  步进模拟  http://${HOST}:${PORT}/manual/step/`);
  console.log(`  干员库    http://${HOST}:${PORT}/agentpackage/`);
  console.log(`  API 模式  ${REAL_API ? 'proxy -> 5001/5002/5003' : 'local demo（账号可用，导入/扫码需真实后端）'}`);
  console.log('  停止：Ctrl+C');
  console.log('');
});
