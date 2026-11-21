#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""帝江号管理员后台 API（挂载到现有 account-server）"""

import os
import time
import sqlite3
from functools import wraps

from flask import Blueprint, request, jsonify, make_response

import account

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")

ADMIN_COOKIE = "dj_admin_session"
DEFAULT_ADMIN_EMAIL = os.environ.get("DIJIANG_DEFAULT_ADMIN_EMAIL", "courison@qq.com").strip().lower()
DEFAULT_ADMIN_PASSWORD = os.environ.get("DIJIANG_DEFAULT_ADMIN_PASSWORD", "")
MAX_LOGIN_FAILS = 5
LOCK_DURATION = 15 * 60
PAGE_MAX = 100


def audit(conn, email, action, target="", ip=""):
    try:
        conn.execute(
            "INSERT INTO admin_audit (email, action, target, ip, created_at) VALUES (?,?,?,?,?)",
            (email, action, target or "", ip or "", int(time.time())),
        )
    except Exception:
        pass


def init_admin_db():
    conn = account.get_db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS admins (
        email TEXT PRIMARY KEY,
        role TEXT NOT NULL DEFAULT 'admin',
        created_at INTEGER NOT NULL,
        created_by TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS admin_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT DEFAULT '',
        ip TEXT DEFAULT '',
        created_at INTEGER NOT NULL
    );
    """)
    conn.commit()

    # 默认只设置第一个超级管理员；绝不覆盖已有账号密码。
    count = conn.execute("SELECT COUNT(*) AS n FROM admins").fetchone()["n"]
    if count == 0 and DEFAULT_ADMIN_EMAIL:
        user = conn.execute("SELECT * FROM users WHERE lower(email)=?", (DEFAULT_ADMIN_EMAIL,)).fetchone()
        if not user and DEFAULT_ADMIN_PASSWORD:
            now = int(time.time())
            conn.execute(
                "INSERT INTO users (email, nickname, password_hash, created_at) VALUES (?,?,?,?)",
                (DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_EMAIL.split("@")[0],
                 account.hash_password(DEFAULT_ADMIN_PASSWORD), now),
            )
            user = conn.execute("SELECT * FROM users WHERE lower(email)=?", (DEFAULT_ADMIN_EMAIL,)).fetchone()
        if user:
            conn.execute(
                "INSERT OR IGNORE INTO admins (email, role, created_at, created_by) VALUES (?,?,?,?)",
                (user["email"].lower(), "super", int(time.time()), "system"),
            )
            conn.commit()
            account.log(f"默认管理员已设置: {user['email']}")
    conn.close()


def _token_from_request():
    token = request.cookies.get(ADMIN_COOKIE, "")
    if token:
        return token
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return ""


def _admin_from_request():
    token = _token_from_request()
    user = account.get_user_by_token(token)
    if not user:
        return None, None, None
    conn = account.get_db()
    row = conn.execute(
        "SELECT role, created_at FROM admins WHERE lower(email)=?",
        (user["email"].lower(),),
    ).fetchone()
    conn.close()
    if not row:
        return user, None, token
    return user, row, token


def admin_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        user, admin, _ = _admin_from_request()
        if not user:
            return jsonify({"ok": False, "msg": "未登录管理员账号"}), 401
        if not admin:
            return jsonify({"ok": False, "msg": "没有管理员权限"}), 403
        request.admin_user = user
        request.admin_role = admin["role"]
        return fn(*args, **kwargs)
    return wrapped


def super_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        user, admin, _ = _admin_from_request()
        if not user:
            return jsonify({"ok": False, "msg": "未登录管理员账号"}), 401
        if not admin:
            return jsonify({"ok": False, "msg": "没有管理员权限"}), 403
        if admin["role"] != "super":
            return jsonify({"ok": False, "msg": "仅超级管理员可以执行此操作"}), 403
        request.admin_user = user
        request.admin_role = admin["role"]
        return fn(*args, **kwargs)
    return wrapped


@admin_bp.route("/login", methods=["POST"])
def admin_login():
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not email or not password:
        return jsonify({"ok": False, "msg": "请输入邮箱和密码"}), 400

    conn = account.get_db()
    user = conn.execute("SELECT * FROM users WHERE lower(email)=?", (email,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"ok": False, "msg": "账号或密码错误"}), 400

    now = int(time.time())
    if user["locked_until"] and now < user["locked_until"]:
        wait = user["locked_until"] - now
        conn.close()
        return jsonify({"ok": False, "msg": f"账号已锁定，请 {wait // 60 + 1} 分钟后重试"}), 429

    if not account.check_password(password, user["password_hash"]):
        fails = (user["failed_attempts"] or 0) + 1
        locked = now + LOCK_DURATION if fails >= MAX_LOGIN_FAILS else 0
        conn.execute("UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?", (fails, locked, user["id"]))
        conn.commit()
        conn.close()
        return jsonify({"ok": False, "msg": "账号或密码错误"}), 400

    admin = conn.execute("SELECT role FROM admins WHERE lower(email)=?", (email,)).fetchone()
    if not admin:
        conn.execute("UPDATE users SET failed_attempts=0, locked_until=0 WHERE id=?", (user["id"],))
        conn.commit()
        conn.close()
        return jsonify({"ok": False, "msg": "该账号不是管理员"}), 403

    conn.execute("UPDATE users SET failed_attempts=0, locked_until=0, last_login=? WHERE id=?", (now, user["id"]))
    conn.commit()
    token = account.create_token(user["id"])
    audit(conn, email, "login", "", request.remote_addr or "")
    conn.commit()
    conn.close()

    resp = make_response(jsonify({
        "ok": True,
        "email": user["email"],
        "nickname": user["nickname"] or email.split("@")[0],
        "role": admin["role"],
    }))
    resp.set_cookie(
        ADMIN_COOKIE, token, max_age=account.TOKEN_TTL,
        httponly=True, secure=True, samesite="Strict", path="/",
    )
    return resp


@admin_bp.route("/logout", methods=["POST"])
def admin_logout():
    token = _token_from_request()
    if token:
        conn = account.get_db()
        conn.execute("DELETE FROM tokens WHERE token=?", (token,))
        conn.commit()
        conn.close()
    resp = make_response(jsonify({"ok": True, "msg": "已退出"}))
    resp.delete_cookie(ADMIN_COOKIE, path="/")
    return resp


@admin_bp.route("/me", methods=["GET"])
@admin_required
def admin_me():
    user = request.admin_user
    return jsonify({
        "ok": True,
        "email": user["email"],
        "nickname": user["nickname"] or user["email"].split("@")[0],
        "role": request.admin_role,
    })


@admin_bp.route("/stats", methods=["GET"])
@admin_required
def admin_stats():
    conn = account.get_db()
    now = int(time.time())
    day = now - 86400
    week = now - 7 * 86400
    def one(sql, args=()):
        return conn.execute(sql, args).fetchone()[0]
    data = {
        "total_users": one("SELECT COUNT(*) FROM users"),
        "new_today": one("SELECT COUNT(*) FROM users WHERE created_at>=?", (day,)),
        "active_7d": one("SELECT COUNT(*) FROM users WHERE last_login>=?", (week,)),
        "with_config": one("SELECT COUNT(DISTINCT user_id) FROM configs"),
        "configs_updated_7d": one("SELECT COUNT(*) FROM configs WHERE updated_at>=?", (week,)),
        "admins": one("SELECT COUNT(*) FROM admins"),
    }
    conn.close()
    return jsonify({"ok": True, "data": data})


@admin_bp.route("/users", methods=["GET"])
@admin_required
def admin_users():
    search = (request.args.get("search") or "").strip().lower()
    page = max(1, int(request.args.get("page", 1) or 1))
    limit = min(PAGE_MAX, max(1, int(request.args.get("limit", 50) or 50)))
    offset = (page - 1) * limit
    where = ""
    args = []
    if search:
        where = "WHERE lower(u.email) LIKE ? OR lower(COALESCE(u.nickname,'')) LIKE ?"
        args = [f"%{search}%", f"%{search}%"]
    conn = account.get_db()
    total = conn.execute(f"SELECT COUNT(*) FROM users u {where}", args).fetchone()[0]
    rows = conn.execute(
        f"""SELECT u.id, u.email, u.nickname, u.created_at, u.last_login,
                   CASE WHEN c.user_id IS NULL THEN 0 ELSE 1 END AS has_config,
                   COALESCE(LENGTH(c.config_json),0) AS config_size,
                   c.updated_at AS config_updated_at,
                   a.role AS admin_role
            FROM users u
            LEFT JOIN configs c ON c.user_id = u.id
            LEFT JOIN admins a ON lower(a.email) = lower(u.email)
            {where}
            ORDER BY u.id DESC LIMIT ? OFFSET ?""",
        args + [limit, offset],
    ).fetchall()
    conn.close()
    return jsonify({
        "ok": True,
        "data": [dict(r) for r in rows],
        "pagination": {"page": page, "limit": limit, "total": total},
    })


@admin_bp.route("/users/<int:user_id>", methods=["GET"])
@admin_required
def admin_user_detail(user_id):
    conn = account.get_db()
    row = conn.execute(
        """SELECT u.id, u.email, u.nickname, u.created_at, u.last_login,
                  CASE WHEN c.user_id IS NULL THEN 0 ELSE 1 END AS has_config,
                  COALESCE(LENGTH(c.config_json),0) AS config_size,
                  c.updated_at AS config_updated_at,
                  a.role AS admin_role
           FROM users u
           LEFT JOIN configs c ON c.user_id = u.id
           LEFT JOIN admins a ON lower(a.email) = lower(u.email)
           WHERE u.id=?""",
        (user_id,),
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"ok": False, "msg": "用户不存在"}), 404
    return jsonify({"ok": True, "data": dict(row)})


@admin_bp.route("/admins", methods=["GET"])
@admin_required
def admin_list():
    conn = account.get_db()
    rows = conn.execute(
        """SELECT a.email, a.role, a.created_at, a.created_by,
                  COALESCE(u.nickname,'') AS nickname
           FROM admins a LEFT JOIN users u ON lower(u.email)=lower(a.email)
           ORDER BY CASE WHEN a.role='super' THEN 0 ELSE 1 END, a.created_at ASC"""
    ).fetchall()
    conn.close()
    return jsonify({"ok": True, "data": [dict(r) for r in rows]})


@admin_bp.route("/admins", methods=["POST"])
@super_required
def admin_add():
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    if not email:
        return jsonify({"ok": False, "msg": "请输入邮箱"}), 400
    conn = account.get_db()
    user = conn.execute("SELECT email FROM users WHERE lower(email)=?", (email,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"ok": False, "msg": "该邮箱尚未注册主站账号"}), 404
    exists = conn.execute("SELECT email FROM admins WHERE lower(email)=?", (email,)).fetchone()
    if exists:
        conn.close()
        return jsonify({"ok": False, "msg": "该账号已经是管理员"}), 409
    conn.execute(
        "INSERT INTO admins (email, role, created_at, created_by) VALUES (?,?,?,?)",
        (user["email"].lower(), "admin", int(time.time()), request.admin_user["email"].lower()),
    )
    audit(conn, request.admin_user["email"], "admin_add", user["email"], request.remote_addr or "")
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "msg": "管理员已添加"})


@admin_bp.route("/admins/<email>", methods=["DELETE"])
@super_required
def admin_remove(email):
    email = (email or "").strip().lower()
    if email == request.admin_user["email"].lower():
        return jsonify({"ok": False, "msg": "不能移除自己"}), 400
    conn = account.get_db()
    row = conn.execute("SELECT role FROM admins WHERE lower(email)=?", (email,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"ok": False, "msg": "管理员不存在"}), 404
    if row["role"] == "super":
        sup = conn.execute("SELECT COUNT(*) FROM admins WHERE role='super'").fetchone()[0]
        if sup <= 1:
            conn.close()
            return jsonify({"ok": False, "msg": "不能移除最后一个超级管理员"}), 400
    conn.execute("DELETE FROM admins WHERE lower(email)=?", (email,))
    audit(conn, request.admin_user["email"], "admin_remove", email, request.remote_addr or "")
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "msg": "管理员已移除"})
