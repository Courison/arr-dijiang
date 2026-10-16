帝江号排班系统
==============

基于《明日方舟：终末地》干员数据自动排班的 Web 工具。

通过读取玩家游戏账号中的干员精英化与天赋激活状态，自动为总控中枢、制造舱、培养舱、会客室等舱室生成一轮/二轮排班方案。

在线访问：https://arr-dijiang.top

GitHub 仓库：https://github.com/Courison/arr-dijiang


功能
----

### 多页面架构

| 路由 | 页面 | 状态 |
|------|------|------|
| `/` | 自动排班（主站） | ✅ |
| `/manual/` | 手动排班 v6 | ✅ |
| `/manual/step/` | 步进模拟 v8 | ✅ |
| `/development/` | 专精建议 | ✅ |
| `/agentpackage/` | 干员库 | ✅ |
| `/log/` | 更新日志 | ✅ |
| `/help/` | 关于和帮助 | ✅ |

### 三种干员数据导入方式

- 🎮 森空岛凭证导入：粘贴森空岛浏览器的 cred,token，前端直连官方接口
- 🏢 官网 Token 导入：粘贴鹰角通行证临时 Token，由后端换取 cred
- 📱 森空岛扫码登录（推荐）：用森空岛 APP 扫码，全程由服务端代理，无长期凭证暴露

三种方式最终都会识别终末地角色信息（昵称、区服、玩家 UID），并统一应用到干员库。

### 邮箱账号系统

- 注册：邮箱 + 昵称 + 验证码 + 密码
- 登录：邮箱 + 密码（支持「记住我」7 天）
- 找回密码：邮箱 + 验证码 + 新密码
- 修改密码：旧密码 + 新密码
- 账号注销：输入邮箱二次确认
- 配置同步：云端上传/下载干员库 + 生产策略

### 自动排班（主站）

- 全局最高分优先：干员按各舱室得分全局竞争，不再被舱室顺序截胡
- 同分按舱室优先级：会客室 > 培养舱 > 制造舱 A > 制造舱 B > 总控中枢
- 一轮/二轮独立分配：二轮池扣除一轮已选后重新竞争
- 平铺补位：每舱室至少分配 1 人，避免整舱空置
- 会客室优先插队：开启后线索匹配干员优先填满会客室
- 精零兜底：精零干员无天赋但提供基础 40% 效能

### 生产策略

- 二轮排班舱室（总控中枢 / 制造舱 A、B / 培养舱 / 会客室）
- 总控中枢模式（常规 / 空置 / 培养信赖）
- 制造舱产物（干员经验 / 武器经验 / 双选）
- 培养舱产物（矿物 / 菌类 / 晶植，多选 + 优先级）
- 会客室优先与缺失线索匹配（1-7 号）
- 会客室二轮排除线索（默认排除 3、7）

### 时间段推荐

- 稳态循环推导各二轮舱室的最优轮班时间
- 总控高恢复段长度 11-13h（覆盖所有高效组休息段）
- 输出 0-24h 绝对时间轴，跨夜自动拆两行
- 可选，独立浮窗

### 手动排班 v6

- 单/二轮切换、从自动排班导入、干员不重复（移动语义）
- 齿轮编辑态：开启后可点击槽位切换干员
- 关闭态便签：悬停头像展示天赋详情
- 每轮统计悬浮窗：▾ 按钮展开该轮生效天赋汇总
- 24h 均产显示
- 产品选择：制造舱单选、培养舱多选 + 优先级徽章 ①②③ + ▲▼ 调整

### 步进模拟 v8

- 用户手动/定时设置轮班，模拟时间流逝
- 观察干员心情变化曲线 + 产率
- 事件驱动模拟，精度到秒
- 0-24h 数轴可拖动，整点吸附
- 培养舱多产物分别绘制产率折线
- 悬停查看：显示时刻、产率/恢复值、每个干员的心情与状态
- 事件日志 + 最终统计

### 干员数据设置

- 三种导入方式：森空岛凭证 / 官网 Token / 扫码登录
- 批量设置：按精英化等级批量修改
- 单干员编辑：精三/精四时二阶天赋可直接点选，自动补前置
- 本地导入导出：文件 / Base64 代码
- 云端上传下载：基于账号，跨设备恢复
- 天赋一览：按舱室或全干员维度查看天赋分布
- 干员库页 `/agentpackage/`：天赋一览 + 练度修改

### 其他

- 导出排班图（PNG，含每舱每轮推荐时段）
- 意见反馈（支持截图上传）
- 更新日志自动加载
- 右下角「捏捏」交互角色（气泡对话、快捷按钮）
- 网页中有彩蛋（?）


技术架构
--------

### 前端

- 入口：index.html
- 样式：assets/css/ 下按功能拆分的 18 个 CSS 文件（01-base ... 18-timing）
- 逻辑：
  - assets/js/main.js 主排班系统（约 3000 行）
  - assets/js/modules/ 拆分模块：
    - enfd-import.js / hg-token-import.js / qr-login.js：三种导入
    - account.js：邮箱账号
    - onboarding.js：引导页
    - sidebar.js / header-actions.js：导航
    - pet.js / page-pet.js：捏捏角色
    - dev.js：专精建议
    - agentpackage.js：干员库
    - schedule-timing.js：时间段推荐
- 头像：精灵图 `/dist/agent_sprite.json` + `/dist/agent_sprite.webp`
- 资源：Agent/、Talent/、vendor/

所有 JS/CSS 引用带 ?v=日期 版本号，配合 Nginx 缓存策略，避免移动端浏览器缓存不刷新。

### 后端

| 服务 | 端口 | systemd 单元 | 职责 |
|------|------|--------------|------|
| api-server | 5001 | skland-endfield.service | 鹰角 Token → cred |
| qr-server | 5002 | skland-web.service | 扫码登录 + 干员数据 |
| account-server | 5003 | dijiang-account.service | 邮箱注册/登录/注销 + 配置同步 |

均为 Flask 应用，通过 systemd 常驻。

### Nginx 分流

- `/api/account/` → 127.0.0.1:5003
- `/api/qr/`、`/api/endfield/` → 127.0.0.1:5002
- `/api/` → 127.0.0.1:5001
- `/manual/`、`/manual/step/`、`/development/`、`/agentpackage/`、`/log/`、`/help/` → 各页目录（try_files 回落到各自 index.html）

静态资源缓存策略：
- HTML：no-store（每次拿最新）
- JS / CSS：no-cache（协商缓存）
- 图片 / 字体：max-age=2592000（30 天）
- markdown / json：no-cache
- `/dist/`：max-age=604800（7 天）


目录结构
--------

    /www/wwwroot/dijiang/
    ├── index.html                  主站（自动排班）
    ├── 404.html
    ├── submit_feedback.php         反馈接口（PHP）
    │
    ├── manual/                     手动排班 v6
    │   ├── index.html
    │   ├── manual.css
    │   ├── manual.js
    │   └── step/                   步进模拟 v8
    │       ├── index.html
    │       ├── step.css
    │       └── step.js
    │
    ├── development/                专精建议
    │   └── index.html
    │
    ├── agentpackage/               干员库
    │   └── index.html
    │
    ├── log/                        更新日志
    │   ├── index.html
    │   ├── log.md
    │   ├── latest.md
    │   └── version.json
    │
    ├── help/                       帮助页
    │   ├── index.html
    │   └── list.json
    │
    ├── assets/                     前端静态资源
    │   ├── css/                    01-base ... 18-timing
    │   ├── js/
    │   │   ├── main.js
    │   │   └── modules/
    │   └── images/
    │
    ├── Agent/                      干员头像 webp
    ├── Talent/                     天赋图标 webp
    ├── dist/                       精灵图
    │   ├── agent_sprite.json
    │   └── agent_sprite.webp
    ├── vendor/                     第三方库
    │   ├── marked.min.js
    │   ├── html2canvas.min.js
    │   └── crypto-js.min.js
    │
    ├── Agent_characteristics.json  干员原始数据
    ├── cred.png                    凭证示例图
    ├── README.md                   本文件
    ├── .gitignore
    ├── .well-known/                SSL 续期验证
    │
    ├── api-server/                 5001 · 鹰角 Token → cred
    │   ├── server.py
    │   └── requirements.txt
    │
    ├── qr-server/                  5002 · 扫码登录 + 干员数据
    │   ├── server.py
    │   └── requirements.txt
    │
    ├── account-server/             5003 · 邮箱账号 + 配置同步
    │   ├── server.py
    │   ├── account.py
    │   ├── requirements.txt
    │   └── .env                    敏感，不进仓库
    │
    └── tools/
        ├── build_sprite.py         精灵图生成
        └── update_log.py           日志生成


部署
----

### 环境要求

- Linux（推荐 Ubuntu / CentOS）
- Nginx 1.18+
- Python 3.8+
- systemd
- SQLite（account-server 使用）

### 快速开始

1. 克隆仓库

       git clone git@github.com:Courison/arr-dijiang.git /www/wwwroot/dijiang
       cd /www/wwwroot/dijiang

2. 安装后端依赖

       cd api-server
       python3 -m venv venv
       source venv/bin/activate
       pip install flask flask-cors requests
       deactivate

       cd ../qr-server
       python3 -m venv venv
       source venv/bin/activate
       pip install -r requirements.txt
       deactivate

       cd ../account-server
       python3 -m venv venv
       source venv/bin/activate
       pip install flask flask-cors bcrypt
       deactivate

3. 配置 account-server/.env

       SMTP_HOST=smtpdm.aliyun.com
       SMTP_PORT=465
       SMTP_USER=<发件邮箱>
       SMTP_PASS=<SMTP 密码>
       SMTP_FROM_NAME=帝江号排班系统
       ACCOUNT_DB=/www/wwwroot/dijiang/account-server/userdata/account.db

4. 配置 systemd

   参考各 server.py 顶部的注释。

5. 配置 Nginx

   按上文「Nginx 分流」配置域名指向 /www/wwwroot/dijiang。

6. 验证

       curl http://127.0.0.1:5001/api/health
       curl http://127.0.0.1:5002/api/health
       curl http://127.0.0.1:5003/api/health


更新流程
--------

本地修改后：

    cd /www/wwwroot/dijiang
    git add .
    git commit -m "fix: 修复 xxx"
    git push

重启后端：

    sudo systemctl restart skland-endfield
    sudo systemctl restart skland-web
    sudo systemctl restart dijiang-account

刷新前端缓存：

    V=$(date +%Y%m%d%H%M)
    sed -i -E "s/\?v=[0-9]+/\?v=$V/g" index.html


关键接口
--------

### api-server (5001)

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/hg-to-cred | POST | 鹰角 Token → cred |
| /api/skland/binding | POST | 森空岛绑定列表 |
| /api/skland/endfield-detail | POST | 终末地干员详情 |
| /api/health | GET | 健康检查 |

### qr-server (5002)

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/qr/create | POST | 生成扫码二维码 |
| /api/qr/status/<scanId> | GET | 轮询扫码状态 |
| /api/endfield/characters | POST | 扫码后拉取干员数据 |
| /api/health | GET | 健康检查 |

### account-server (5003)

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/account/send-code | POST | 发送邮箱验证码（register / reset） |
| /api/account/register | POST | 注册 |
| /api/account/login | POST | 登录 |
| /api/account/logout | POST | 退出 |
| /api/account/me | GET | 查询当前账号 |
| /api/account/reset-password | POST | 找回密码 |
| /api/account/change-password | POST | 修改密码 |
| /api/account/delete | POST | 注销账号 |
| /api/account/config | GET | 拉取云端配置 |
| /api/account/config | POST | 上传云端配置 |
| /api/account/health | GET | 健康检查 |


核心算法
--------

### 排班主算法（main.js）

保留静态评分贪心：

    score.central  = 心情恢复提升 × 1.0
    score.meeting  = 搜集效率 × 1.0 + 减耗 × 0.3 + (missingClues 命中 × 1000)
    score.culture  = Σ(效率类型 × 优先级权重) + 减耗 × 0.3
    score.manufact = 效率 × 1.0 + 减耗 × 0.3
    score.expScore = 干员素材效率 × 1.0
    score.weaponScore = 武器素材效率 × 1.0

关键点：
- 制造舱减耗不污染 expScore / weaponScore
- 会客室线索概率只在 missingClues 命中时极端加权

### 减耗优化（二轮专属）

仅对 doubleRooms 内的舱室执行：

- 单舱 1-opt（optimizeRoomReduction）：A/B 组两两交换 + 与空位交换
- 制造舱 A+B 联动（optimizeManufactPair）：12 槽位联合交换
- 培养舱优先级加权（optimizeCulturePair）：多产物时生效
- 会客室不参与 1-opt（由后处理替换负责）

### evalPairOutput

穷举所有整点 hHigh ∈ [1,23]，取最大产出，允许段内短时停工。

    hA_max = min(1/cA, 24 × cRestHigh / (cA + cRestHigh))
    hA_opt = floor(hA_max) → 整点枚举
    c_rest 默认 = 12 × 1.48 = 17.76%/h

### 会客室二轮替换

replaceMeetingSecondRoundWithCluePowers：

1. 找弱槽位：无搜集效率、无线索概率
2. 候选来源：储备池 + 其它舱室零贡献位置
3. 从储备池拉 → 被替换干员退回储备池
4. 从其它舱室拉 → 用被替换干员交换回原位置

### 培养舱优先级

- 默认顺序：['plant', 'mineral', 'fungi']（晶植 > 矿物 > 菌类）
- 权重：[1.0, 0.6, 0.3]
- 优先级 ① 最高的产物决定该舱时间安排

### 时间段推荐

- 总控高恢复段先确定（覆盖所有高效组休息段）
- 稳态循环：假设所有干员每周期开始心情满 100%
- 总控段长度 clamp 到 [11, 13] h


调试工具（F12 Console）
----------------------

    window.DIJIANG_MANUFACT_DEBUG = true;      // 打印制造舱交换详情
    window.DIJIANG_OPT_CREST_OVERRIDE = 12;    // 覆盖 c_rest
    window.DIJIANG_PRIORITY_WEIGHTS = [1, 0.5, 0.2];  // 覆盖培养舱优先级权重


安全说明
--------

- 所有 cred、token、scanCode 等凭证不落盘、不记录日志
- 后端仅在内存中转发凭证，用完即弃
- 三种导入方式均附有风险提示，引导用户了解凭证权限范围
- 邮箱账号系统：bcrypt（rounds=12）、Token 7 天、登录失败 5 次锁 15 分钟、验证码 5 分钟有效
- 云端上传的干员配置仅包含精英化、天赋激活状态与生产策略，不含任何账号凭证
- 仓库不包含数据库、密钥、日志、用户反馈等隐私文件


仓库隐私策略
------------

仓库**不包含**：

- `account-server/userdata/account.db` 及任何 `*.db`
- `account-server/.env` 及任何 `*.env`、`*.key`、`*.pem`
- 各后端 `venv/`、`__pycache__/`
- `Suggest/`（用户反馈）
- `*.log`（含请求信息）
- `.well-known/acme-challenge/`（续期临时文件）
- `*.bak.*`（本地备份）


常见问题
--------

### 森空岛凭证导入报「HTTP 401」？

凭证已失效或服务器时间不同步。重新登录森空岛官网复制最新凭证即可。

### 扫码后显示「未知用户」或 UID 不对？

终末地账号的 nickName 字段可能为空，正确信息在 bindingList[0].defaultRole.nickname 和 roleId 中。

### 更新后页面还是旧版？

移动端浏览器会强制缓存 HTML。建议：
1. 确认 Nginx 已配置 HTML no-store
2. 更新 index.html 中所有 ?v= 版本号
3. 用户端：微信长按右上角「...」→ 强制刷新

### 登录后每次进入自动排班页都提示覆盖？

已在 `account.js` 中记录 `dijiang_account_config_applied_at`，同版本配置不再弹框。如仍出现，清空浏览器 sessionStorage 后重试。

### 时间推荐里总控干员没跟着调整？

`analyzeCentral` 优先读 `DijiangLastQueues.central.round1`，确保主站已生成过一次排班。

### 网页中有彩蛋（?）

自己找找看。


更新日志
--------

详见 `log/log.md`。


反馈
----

- 站内反馈：主站右下角「捏捏」→ 气泡「意见反馈」
- GitHub Issue：https://github.com/Courison/arr-dijiang/issues


免责声明
--------

本项目为个人学习与交流用途，与鹰角网络、森空岛官方无任何关联。使用本项目产生的任何风险由使用者自行承担。请勿将本项目用于任何商业用途。

游戏数据、账号信息均归鹰角网络所有。