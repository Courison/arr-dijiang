# 帝江号 v2 · 本地可访问页（方案 A 初版）

> 原生多页 + 共享 v2 外壳/算法 + 本地 Node 开发服务器。
> 不改动 `dijiang/` 线上代码；本目录是可直接运行的初版应用。

---

## 1. 30 秒启动

要求：Node.js **20+**（无需 `npm install`，无第三方依赖）。

```bash
cd dijiang_new/app
npm run dev
```

或 Windows 双击：

```text
dijiang_new\app\start.cmd
```

PowerShell 也可以：

```powershell
cd dijiang_new\app
.\start.ps1
```

然后打开：

- 主站：http://127.0.0.1:5173/
- 手动：http://127.0.0.1:5173/manual/
- 步进：http://127.0.0.1:5173/manual/step/
- 干员库：http://127.0.0.1:5173/agentpackage/
- 专精：http://127.0.0.1:5173/development/
- 帮助 / 日志：`/help/`、`/log/`

> 换端口：`PORT=8080 npm run dev`（Windows PowerShell：`$env:PORT=8080; npm run dev`）
>
> 手机同局域网访问：把 `.env.example` 复制为 `.env`，将 `HOST` 改为 `0.0.0.0`，然后访问 `http://<电脑局域网IP>:5173/`（注意 Windows 防火墙放行）。
>
> 腾讯云/宝塔部署：见 [`../deploy/README-腾讯云宝塔部署.md`](../deploy/README-腾讯云宝塔部署.md)，站点包为 `deploy/dijiang-site.zip`。

---

## 2. 这一版做了什么

| 能力 | 状态 |
|---|---|
| 主站自动排班 | ✅ 原 `main.js` 全量保留；排班核心替换为 v2 |
| 手动排班 | ✅ 原 `manual.js` 全量保留 |
| 步进模拟 | ✅ 原 `step.js` 全量保留 |
| 干员库 / 专精 / 帮助 / 日志 | ✅ 原页面保留 |
| 页宠“捏捏” | ✅ 原 `pet.js` / `page-pet.js` 保留，并接入新主题 |
| 账号 / 云同步 | ✅ 本地演示 API（任意合法邮箱 + 任意密码可登录；配置保存在内存，不落盘） |
| 森空岛凭证 / 官网 Token / 扫码导入 | ⚠️ 代码保留；本地演示不接真实接口，需 `DIJIANG_REAL_API=1` + 三个后端 |
| 本地导入/导出、预设干员库 | ✅ 可用（走浏览器本地） |
| 反馈 | ✅ 本地演示返回成功，不真正上传 |
| 导出排班图 | ✅ 原 `DijiangExportSchedule` 保留 |

### 2026-10-28 修订

- 首次引导：删掉顶部图标与按钮内 icon，白框增加内边距，两个主按钮统一 420px 宽；
- 信赖：v2 的总控收容逻辑修正，双轮/单轮都会把选中的信赖干员排入总控，不能被普通干员替换出去；“重置筛选”保留并加了“已重置”反馈；
- 侧边栏：桌面常驻栏取消 `transform` 过渡，换页不再“从左侧弹出”；
- 按钮：主操作改为无填充线框按钮 + 线框 icon（引导页按钮只保留文字）；
- 总控 KPI：从“总恢复”改为 `A / B` 两班分别显示，每班只生效本班加成；
- 步进模拟：样本上限从 20,000 改为超长模拟抽稀，10s × 96h 不再丢掉开头曲线；
- 舱室图标：接入 `new_resource/` 的四枚舱室图标（按舱室主色着色），替换原来的临时 SVG。

### 2026-10-28 第四轮

- 页宠设置按钮缩到 20px、图标改为 🍎；意见反馈提到最高层，并支持剪贴板图片（浏览器会询问权限）；
- 服务器在 `<body>` 起始处提前加 `dj-v2`，首页增加概览占位，消除旧版首屏闪烁与 KPI 注入下跳；
- `new_resource/` 的干员经验、武器经验、晶植、菌类、矿物图标接入生产策略/产物标签/手动/步进；
- 生产策略改为 680px 四列网格，时间段推荐改为 700px 两列卡片；
- 手动排班改为 6 列网格：首行 3 等宽、次行 2 居中，header 图标/标题垂直居中；
- 全站可见 emoji 清理，操作 icon 统一为无填充线框 SVG。

### 视觉

- “终末地 · 工业档案”令牌：纸张、墨色、苔绿、黄铜；
- **每个舱室按对应天赋技能图标的主色做浅色透明渐变**：
  - 总控中枢 `#47C1E7`（central_physical_power）
  - 制造舱 `#F4CC15`（manufact_efficiency）
  - 培养舱 `#ACD84C`（culture_*_efficiency）
  - 会客室 `#A08EF6`（meeting_clue_efficiency）
- 舱室图标改用 `new_resource/` 的四枚图标，按主色着色后放在标题前；
- 主站/手动/步进都通过 `data-room` 自动套色，不硬编码到业务代码；
- 页宠保留，并与底部操作条错开。

### 可访问性

- 跳到主内容链接、`aria-label`、`aria-current`、模态框 `role=dialog`、Esc 关闭；
- 移动端按钮 ≥44px、正文最小 11–12px；
- `prefers-reduced-motion` 关闭动画；
- 手机端 3 个干员槽位保持同排，不再 2+1 换行；
- 手机端固定底部操作条：干员 / 时间 / 策略 / 导出。

---

## 3. API 模式

### 3.1 本地演示（默认）

- `GET /api/health` → `{ok:true, mode:"demo"}`
- 账号：`/api/account/login` 任意邮箱/密码返回 demo token；`/register`、`/me`、`/config`、`/logout` 等有本地 mock；
- 导入/扫码：返回“请使用预设干员库或本地导入”的友好提示；
- 反馈：本地成功，不落盘。

> 演示 API **不会**把数据写到磁盘；刷新页面后云端配置为空。

### 3.2 接真实后端

如果本机已经启动 `dijiang/` 的 3 个 Flask 服务（5001/5002/5003）：

```bash
# Windows PowerShell
$env:DIJIANG_REAL_API="1"; npm run dev

# bash
DIJIANG_REAL_API=1 npm run dev
```

服务器会把：

- `/api/account/*` → 5003
- `/api/qr/*`、`/api/endfield/*` → 5002
- 其它 `/api/*` → 5001

> 真实后端需要各自的 Python 依赖与 `.env`；本地演示不需要。

---

## 4. 目录

```text
app/
├── index.html                 # 主站（原 DOM/JS 保留，服务器注入 v2 外壳）
├── manual/                    # 手动排班（原页面）
├── manual/step/               # 步进模拟（原页面）
├── agentpackage/              # 干员库
├── development/               # 专精建议
├── help/ log/                 # 内容页
├── assets/                    # 原 CSS/JS/vendor（scheduler-core.js 已替换为 v2）
├── Agent/ Talent/ dist/       # 头像/天赋图标/精灵图
├── v2/
│   ├── css/tokens.css         # 设计令牌
│   ├── css/rooms.css          # 舱室天赋色渐变
│   ├── css/theme.css          # 旧站换肤 + 布局/可访问性
│   ├── js/shell.js            # 导航/KPI/底部条/模态框增强
│   ├── js/room-theme.js       # data-room + 舱室图标 + A/B 类
│   ├── icons/                 # new_resource 彩色/原图舱室图标
│   └── data/talent-colors.json
├── server.mjs                 # 静态 + HTML 注入 + API mock/proxy
├── tools/check.mjs            # 自检
├── package.json
├── start.cmd / start.ps1 / start.sh
└── README.md
```

### 为什么用“服务器注入”而不是改 HTML？

- 7 个页面 HTML 加起来近 3,000 行，直接改容易破坏原业务；
- 注入只发生在响应时，原 HTML 保持可回退；
- 之后迁移到构建时，把 `INJECT_HEAD/INJECT_BODY` 固化为模板即可。

---

## 5. 与“方案 A”的关系

- **保持多页原生**：不改 URL、不改 Nginx、不引入 React/Next；
- **共享 v2 外壳**：`tokens.css`、`rooms.css`、`theme.css`、`shell.js`、`room-theme.js` 被 7 个页面共用；
- **先换视觉与外壳，再抽领域层**：下一步按 `../01-架构重构/03-迁移路线图.md` 把评分/时间/天赋抽到 `packages/domain`；
- 算法已先替换为 `scheduler-core.v2.js`，所以初版就带 A1–A5 修复，并包含“所有信赖必须进总控”的 A2b 修复。

---

## 6. 已知限制（初版）

1. **导入/扫码**：本地演示不接真实接口；这是有意的，避免把凭证处理带进本地静态环境。
2. **账号**：mock 登录不校验密码、不落盘；只用于演示云同步 UI。
3. **深色模式**：令牌已支持，但旧站硬编码颜色较多，初版默认只启用浅色；不要强行切深色。
4. **手动/步进**：只做主题与布局注入，未重写内部 DOM；个别小字/间距仍沿用旧值。
5. **页宠**：保留原交互；移动端位置已抬高避开底部条，但不同屏幕仍需实测。
6. **服务器注入**：生产部署需要 Node 或把注入固化为构建步骤；当前定位是“本地可访问页”。

---

## 7. 自检

```bash
npm run check
```

会检查页面/资源、scheduler-core 是否为 v2、Node 版本。

---

## 8. 下一步

1. 用真实手机/微信打开 `http://<局域网IP>:5173/`，检查页宠/底栏/模态框；
2. 按 `../03-UI设计/03-移动端兼容审计.md` 的 P0 修字号/触控；
3. 按 `../01-架构重构/03-迁移路线图.md` 抽 `packages/domain`，把手动/步进的重复逻辑合并；
4. 需要真实导入时，启动 3 个 Flask 后端并设置 `DIJIANG_REAL_API=1`。
