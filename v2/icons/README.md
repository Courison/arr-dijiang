# 舱室图标

来源：`dijiang_new/new_resource/` 下的四个舱室图标（白色透明 PNG）。

| 文件 | 舱室 | 主色 |
|---|---|---|
| `room-central.png` | 总控中枢 | `#47C1E7` |
| `room-manufact.png` | 制造舱 A/B | `#F4CC15` |
| `room-culture.png` | 培养舱 | `#ACD84C` |
| `room-meeting.png` | 会客室 | `#A08EF6` |

- `source/` 保留原始白色图标，便于换色/换主题；
- 根目录的彩色版本是按舱室主色填充白色像素后的产物；
- 运行时由 `v2/js/room-theme.js` 按 `data-room` 插入 `<img>`，尺寸 19×19；
- 颜色与 `v2/data/talent-colors.json`、`v2/css/rooms.css` 保持一致。

重新生成彩色图标（需要 Pillow）：

```bash
python - <<'PY'
from PIL import Image
... # 见 02-UI设计/01-设计系统.md 3.5 节
PY
```
