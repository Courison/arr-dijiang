#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
干员头像拼接工具（WebP 输出）

根目录：/www/wwwroot/dijiang

读取 Agent 目录下的头像，按指定顺序裁切为方形，
每 N 个一行拼接成长图（WebP），并生成索引 JSON。

用法：
    python3 /www/wwwroot/dijiang/tools/build_sprite.py
    python3 /www/wwwroot/dijiang/tools/build_sprite.py --focus top
"""

import os
import sys
import json
import math
import argparse
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("[错误] 缺少 Pillow，请先执行： pip install pillow", file=sys.stderr)
    sys.exit(1)


ROOT = Path("/www/wwwroot/dijiang")


def parse_args():
    p = argparse.ArgumentParser(description="干员头像拼接工具（WebP）")
    p.add_argument("--root", default=str(ROOT), help=f"项目根目录（默认 {ROOT}）")
    p.add_argument("--agent-dir", default=None, help="干员头像目录（默认 <root>/Agent）")
    p.add_argument("--data", default=None, help="干员数据 JSON")
    p.add_argument("--list", dest="list_file", default=None, help="顺序列表文件，优先级高于 --data")
    p.add_argument("--out-image", default=None, help="输出长图（默认 <root>/dist/agent_sprite.webp）")
    p.add_argument("--out-index", default=None, help="输出索引（默认 <root>/dist/agent_sprite.json）")
    p.add_argument("--tile", type=int, default=180, help="单头像边长（默认 180）")
    p.add_argument("--cols", type=int, default=6, help="每行头像数（默认 6）")
    p.add_argument("--focus", default="center",
                   help="裁剪锚点：center / top / bottom / 0.0~1.0")
    p.add_argument("--bg", default="#ffffff", help="背景色（默认 #ffffff）")
    p.add_argument("--pad", type=int, default=0, help="内边距（像素，默认 0）")
    p.add_argument("--quality", type=int, default=90,
                   help="WebP 质量 1-100（默认 90），设为 101 用无损")
    p.add_argument("--lossless", action="store_true",
                   help="启用 WebP 无损压缩（体积更大，画质无损）")
    return p.parse_args()


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def load_order_from_json(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    order = data.get("operator_order")
    if isinstance(order, list) and order:
        return order
    return [k for k in data.keys() if k != "operator_order"]


def load_order_from_list(path):
    with open(path, "r", encoding="utf-8") as f:
        return [ln.strip() for ln in f if ln.strip() and not ln.startswith("#")]


def resolve_agent_path(agent_dir, name):
    for ext in (".webp", ".png", ".jpg", ".jpeg"):
        p = Path(agent_dir) / (name + ext)
        if p.exists():
            return p
    return None


def crop_to_square(img, focus):
    w, h = img.size
    if w == h:
        return img
    if w > h:
        new_size = h
        if focus == "center":
            left = (w - new_size) // 2
        elif focus == "top":
            left = 0
        elif focus == "bottom":
            left = w - new_size
        else:
            try:
                ratio = max(0.0, min(1.0, float(focus)))
                left = int((w - new_size) * ratio)
            except ValueError:
                left = (w - new_size) // 2
        return img.crop((left, 0, left + new_size, h))
    else:
        new_size = w
        if focus == "center":
            top = (h - new_size) // 2
        elif focus == "top":
            top = 0
        elif focus == "bottom":
            top = h - new_size
        else:
            try:
                ratio = max(0.0, min(1.0, float(focus)))
                top = int((h - new_size) * ratio)
            except ValueError:
                top = (h - new_size) // 2
        return img.crop((0, top, w, top + new_size))


def make_placeholder(size, bg_rgb, name):
    img = Image.new("RGBA", (size, size), bg_rgb + (255,))
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("arial.ttf", size // 4)
    except Exception:
        font = ImageFont.load_default()
    text = (name[:1] if name else "?").upper()
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    draw.text(
        ((size - tw) / 2, (size - th) / 2 - bbox[1]),
        text,
        fill=(180, 180, 180, 255),
        font=font,
    )
    return img


def save_webp(image_rgba, out_path, quality, lossless):
    """统一用 WebP 保存，RGBA 保留透明通道"""
    kwargs = {"format": "WEBP", "method": 6}  # method 6 = 最高压缩率
    if lossless:
        kwargs["lossless"] = True
    else:
        kwargs["quality"] = max(1, min(100, quality))
    image_rgba.save(out_path, **kwargs)


def main():
    args = parse_args()
    root = Path(args.root).resolve()

    agent_dir = Path(args.agent_dir) if args.agent_dir else root / "Agent"
    data_file = Path(args.data) if args.data else root / "Agent_characteristics.json"
    out_image = Path(args.out_image) if args.out_image else root / "dist" / "agent_sprite.webp"
    out_index = Path(args.out_index) if args.out_index else root / "dist" / "agent_sprite.json"

    tile = args.tile
    cols = args.cols

    print(f"[信息] 根目录：{root}")
    print(f"[信息] 头像目录：{agent_dir}")

    if args.list_file:
        order = load_order_from_list(args.list_file)
        print(f"[信息] 从列表文件读取顺序：{args.list_file}")
    else:
        if not data_file.exists():
            print(f"[错误] 找不到数据文件：{data_file}", file=sys.stderr)
            sys.exit(1)
        order = load_order_from_json(data_file)
        print(f"[信息] 从数据文件读取顺序：{data_file}")

    if not order:
        print("[错误] 干员列表为空", file=sys.stderr)
        sys.exit(1)

    print(f"[信息] 共 {len(order)} 个干员")

    rows = math.ceil(len(order) / cols)
    canvas_w = cols * tile
    canvas_h = rows * tile
    bg_rgb = hex_to_rgb(args.bg)
    canvas = Image.new("RGBA", (canvas_w, canvas_h), bg_rgb + (255,))

    index = {
        "tile_size": tile,
        "cols": cols,
        "rows": rows,
        "canvas_width": canvas_w,
        "canvas_height": canvas_h,
        "image": out_image.name,
        "agents": {},
    }

    missing = []
    for i, name in enumerate(order):
        row = i // cols
        col = i % cols
        x = col * tile
        y = row * tile

        path = resolve_agent_path(agent_dir, name)
        if path is None:
            missing.append(name)
            thumb = make_placeholder(tile, bg_rgb, name)
        else:
            try:
                src = Image.open(path).convert("RGBA")
                cropped = crop_to_square(src, args.focus)
                thumb = cropped.resize((tile, tile), Image.LANCZOS)
            except Exception as e:
                print(f"[警告] 处理 {name} 失败：{e}")
                missing.append(name)
                thumb = make_placeholder(tile, bg_rgb, name)

        if args.pad > 0:
            inner = tile - args.pad * 2
            if inner > 0:
                thumb = thumb.resize((inner, inner), Image.LANCZOS)
                tmp = Image.new("RGBA", (tile, tile), bg_rgb + (255,))
                tmp.paste(thumb, (args.pad, args.pad), thumb)
                thumb = tmp

        canvas.paste(thumb, (x, y), thumb)

        index["agents"][name] = {
            "row": row,
            "col": col,
            "x": x,
            "y": y,
            "w": tile,
            "h": tile,
        }

    out_image.parent.mkdir(parents=True, exist_ok=True)
    out_index.parent.mkdir(parents=True, exist_ok=True)

    # ★ 强制 webp 保存
    save_webp(canvas, out_image, args.quality, args.lossless)

    with open(out_index, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    size_kb = out_image.stat().st_size / 1024
    print(f"[完成] 长图：{out_image}  ({canvas_w} x {canvas_h}, {size_kb:.1f} KB)")
    print(f"[完成] 索引：{out_index}")
    if missing:
        preview = "、".join(missing[:10])
        more = "..." if len(missing) > 10 else ""
        print(f"[警告] 缺失头像 {len(missing)} 个：{preview}{more}")


if __name__ == "__main__":
    main()