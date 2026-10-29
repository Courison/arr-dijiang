#!/usr/bin/env node
/**
 * 本地环境自检：不依赖任何 npm 包。
 * 运行：npm run check
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'index.html',
  'manual/index.html',
  'manual/step/index.html',
  'agentpackage/index.html',
  'development/index.html',
  'help/index.html',
  'log/index.html',
  'Agent_characteristics.json',
  'assets/js/main.js',
  'assets/js/scheduler-core.js',
  'v2/css/tokens.css',
  'v2/css/rooms.css',
  'v2/css/theme.css',
  'v2/js/shell.js',
  'v2/js/room-theme.js',
];

let ok = true;
const missing = required.filter(f => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) {
  ok = false;
  console.error('✗ 缺少文件：', missing.join(', '));
} else {
  console.log('✓ 页面与 v2 资源齐全');
}

const core = fs.readFileSync(path.join(ROOT, 'assets/js/scheduler-core.js'), 'utf8');
if (core.includes("VERSION = '2.0.0'") || core.includes('VERSION = "2.0.0"')) console.log('✓ 排班核心：scheduler-core v2');
else { ok = false; console.error('✗ scheduler-core.js 不是 v2'); }

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
if (html.includes('/assets/js/main.js')) console.log('✓ 主站业务脚本保留');
else { ok = false; console.error('✗ 主站 main.js 缺失'); }
if (fs.existsSync(path.join(ROOT, 'assets/js/modules/pet.js'))) console.log('✓ 页宠模块保留：assets/js/modules/pet.js');
else { ok = false; console.error('✗ 页宠模块缺失'); }

try {
  const v = execFileSync(process.execPath, ['-v'], { encoding: 'utf8' }).trim();
  console.log(`✓ Node ${v}`);
} catch {
  ok = false;
  console.error('✗ 无法执行 Node');
}

console.log('');
if (ok) {
  console.log('自检通过。运行：npm run dev  →  http://127.0.0.1:5173/');
} else {
  process.exitCode = 1;
}
