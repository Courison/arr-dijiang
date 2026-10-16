#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
账号系统：邮箱注册/登录/找回密码/配置同步
被 server.py 挂载为 blueprint
"""
import os
import re
import time
import json
import random
import sqlite3
import secrets
import smtplib
import ssl
from email.mime.text import MIMEText
from email.header import Header
from email.utils import formataddr

import bcrypt
from flask import Blueprint, request, jsonify

account_bp = Blueprint("account", __name__, url_prefix="/api/account")

# ==================== 配置 ====================
DB_PATH = os.environ.get("ACCOUNT_DB", "/www/wwwroot/dijiang/api-server/userdata/account.db")

SMTP_HOST = os.environ.get("SMTP_HOST", "smtpdm.aliyun.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "帝江号排班系统")

CODE_TTL = 5 * 60
SEND_INTERVAL = 60
DAILY_CODE_LIMIT = 5
MAX_CODE_ATTEMPTS = 5
TOKEN_TTL = 7 * 86400
MAX_LOGIN_FAILS = 5
LOCK_DURATION = 15 * 60


def log(msg):
    print(f"[account {time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ==================== 数据库 ====================
def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
    except Exception:
        pass
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        nickname TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_login INTEGER,
        failed_attempts INTEGER DEFAULT 0,
        locked_until INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        purpose TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tokens (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS configs (
        user_id INTEGER PRIMARY KEY,
        config_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_codes_email ON codes(email);
    CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);
    """)
    conn.commit()
    conn.close()
    log(f"数据库就绪: {DB_PATH}")


# ==================== 工具 ====================
def is_valid_email(email):
    if not email or len(email) > 128:
        return False
    return bool(re.match(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$", email))


def gen_code():
    return f"{random.randint(0, 999999):06d}"


def hash_password(password):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def check_password(password, password_hash):
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False

def validate_nickname(nickname):
    if not nickname:
        return False, "请填写昵称"
    nickname = nickname.strip()
    if len(nickname) < 1:
        return False, "昵称不能为空"
    if len(nickname) > 20:
        return False, "昵称不能超过 20 个字符"
    return True, "ok"
    
def validate_password_strength(password):
    if not password or len(password) < 8:
        return False, "密码至少 8 位"
    if len(password) > 64:
        return False, "密码不能超过 64 位"
    if not re.search(r"[a-zA-Z]", password):
        return False, "密码需包含字母"
    if not re.search(r"\d", password):
        return False, "密码需包含数字"
    weak = {"12345678", "password", "qwerty123", "abc123456", "11111111", "00000000"}
    if password.lower() in weak:
        return False, "密码过于简单"
    return True, "ok"


# ==================== 邮件 ====================
def send_verification_email(to_email, code, purpose):
    if not SMTP_USER or not SMTP_PASS:
        return False, "服务器未配置邮件服务"

    if purpose == "register":
        subject = "【帝江号排班系统】注册验证码"
        body = f"""尊敬的管理员：

您的注册验证码是：

    {code}

该验证码在 5 分钟内有效，请勿泄露给他人。

如果这不是您本人的操作，请忽略此邮件。

—— 帝江号排班系统
https://arr-dijiang.top
"""
    else:
        subject = "【帝江号排班系统】密码重置验证码"
        body = f"""尊敬的管理员：

您正在申请重置密码，验证码是：

    {code}

该验证码在 5 分钟内有效。重置后其他设备的登录状态会失效。

如果这不是您本人的操作，请立即修改密码。

—— 帝江号排班系统
https://arr-dijiang.top
"""

    msg = MIMEText(body, "plain", "utf-8")
    msg["From"] = formataddr([SMTP_FROM_NAME, SMTP_USER])
    msg["To"] = to_email
    msg["Subject"] = Header(subject, "utf-8")

    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx, timeout=15) as s:
            s.login(SMTP_USER, SMTP_PASS)
            s.sendmail(SMTP_USER, [to_email], msg.as_string())
        return True, "发送成功"
    except smtplib.SMTPAuthenticationError:
        log("邮件服务认证失败")
        return False, "邮件服务认证失败"
    except Exception as e:
        log(f"邮件发送失败: {e}")
        return False, "邮件发送失败"


# ==================== Token ====================
def create_token(user_id):
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    conn = get_db()
    conn.execute(
        "INSERT INTO tokens (token, user_id, expires_at, created_at) VALUES (?,?,?,?)",
        (token, user_id, now + TOKEN_TTL, now),
    )
    conn.commit()
    conn.close()
    return token


def get_user_by_token(token):
    if not token:
        return None
    now = int(time.time())
    conn = get_db()
    row = conn.execute(
        """SELECT u.* FROM users u
        JOIN tokens t ON t.user_id = u.id
        WHERE t.token = ? AND t.expires_at > ?""",
        (token, now),
    ).fetchone()
    conn.close()
    return row


def extract_token():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


def verify_code(email, code, purpose):
    now = int(time.time())
    conn = get_db()
    row = conn.execute(
        """SELECT * FROM codes
        WHERE email = ? AND purpose = ? AND used = 0
        ORDER BY created_at DESC LIMIT 1""",
        (email, purpose),
    ).fetchone()
    if not row:
        conn.close()
        return False, "请先发送验证码"
    if now > row["expires_at"]:
        conn.close()
        return False, "验证码已过期，请重新发送"
    if row["attempts"] >= MAX_CODE_ATTEMPTS:
        conn.close()
        return False, "尝试次数过多，请重新发送"
    if code != row["code"]:
        conn.execute("UPDATE codes SET attempts = attempts + 1 WHERE id = ?", (row["id"],))
        conn.commit()
        left = MAX_CODE_ATTEMPTS - row["attempts"] - 1
        conn.close()
        return False, f"验证码错误，剩余 {left} 次机会"

    conn.execute("UPDATE codes SET used = 1 WHERE id = ?", (row["id"],))
    conn.commit()
    conn.close()
    return True, "ok"


# ==================== 接口 ====================
@account_bp.route("/send-code", methods=["POST"])
def api_send_code():
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    purpose = (body.get("purpose") or "register").strip()

    if not is_valid_email(email):
        return jsonify({"ok": False, "msg": "邮箱格式不正确"}), 400
    if purpose not in ("register", "reset"):
        return jsonify({"ok": False, "msg": "无效的用途"}), 400

    now = int(time.time())
    conn = get_db()
    user = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()

    if purpose == "register" and user:
        conn.close()
        return jsonify({"ok": False, "msg": "该邮箱已注册，请直接登录"}), 400
    if purpose == "reset" and not user:
        conn.close()
        return jsonify({"ok": False, "msg": "该邮箱未注册"}), 400

    last = conn.execute(
        """SELECT created_at FROM codes
        WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1""",
        (email, purpose),
    ).fetchone()
    if last and now - last["created_at"] < SEND_INTERVAL:
        wait = SEND_INTERVAL - (now - last["created_at"])
        conn.close()
        return jsonify({"ok": False, "msg": f"请 {wait} 秒后再试"}), 429

    day_ago = now - 86400
    daily = conn.execute(
        "SELECT COUNT(*) AS c FROM codes WHERE email = ? AND created_at > ?",
        (email, day_ago),
    ).fetchone()["c"]
    if daily >= DAILY_CODE_LIMIT:
        conn.close()
        return jsonify({"ok": False, "msg": "今日验证码发送次数已达上限"}), 429

    code = gen_code()
    ok, msg = send_verification_email(email, code, purpose)
    if not ok:
        conn.close()
        return jsonify({"ok": False, "msg": msg}), 500

    conn.execute(
        """INSERT INTO codes (email, code, purpose, expires_at, created_at)
        VALUES (?,?,?,?,?)""",
        (email, code, purpose, now + CODE_TTL, now),
    )
    conn.commit()
    conn.close()

    log(f"[{purpose}] {email} → {code}")
    return jsonify({"ok": True, "msg": "验证码已发送，请查收邮件"})


@account_bp.route("/register", methods=["POST"])
def api_register():
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    code = (body.get("code") or "").strip()
    password = body.get("password") or ""
    nickname = (body.get("nickname") or "").strip()

    if not is_valid_email(email):
        return jsonify({"ok": False, "msg": "邮箱格式不正确"}), 400
    ok, msg = validate_password_strength(password)
    if not ok:
        return jsonify({"ok": False, "msg": msg}), 400
    ok, msg = validate_nickname(nickname)
    if not ok:
        return jsonify({"ok": False, "msg": msg}), 400

    conn = get_db()
    exists = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if exists:
        conn.close()
        return jsonify({"ok": False, "msg": "该邮箱已注册"}), 400

    ok, msg = verify_code(email, code, "register")
    if not ok:
        conn.close()
        return jsonify({"ok": False, "msg": msg}), 400

    now = int(time.time())
    pwd_hash = hash_password(password)
    cur = conn.execute(
        "INSERT INTO users (email, nickname, password_hash, created_at, last_login) VALUES (?,?,?,?,?)",
        (email, nickname, pwd_hash, now, now),
    )
    user_id = cur.lastrowid
    conn.commit()
    conn.close()

    token = create_token(user_id)
    log(f"[注册] {email} 昵称={nickname}")
    return jsonify({
        "ok": True, "msg": "注册成功",
        "token": token, "email": email, "nickname": nickname,
    })


@account_bp.route("/login", methods=["POST"])
def api_login():
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    if not is_valid_email(email) or not password:
        return jsonify({"ok": False, "msg": "邮箱或密码不能为空"}), 400

    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"ok": False, "msg": "邮箱或密码错误"}), 400

    now = int(time.time())
    if user["locked_until"] and now < user["locked_until"]:
        wait = user["locked_until"] - now
        conn.close()
        return jsonify({"ok": False, "msg": f"账号已锁定，请 {wait // 60} 分钟后再试"}), 429

    if not check_password(password, user["password_hash"]):
        fails = user["failed_attempts"] + 1
        locked = 0
        if fails >= MAX_LOGIN_FAILS:
            locked = now + LOCK_DURATION
        conn.execute(
            "UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?",
            (fails, locked, user["id"]),
        )
        conn.commit()
        conn.close()
        if locked:
            return jsonify({"ok": False, "msg": f"连续错误 {MAX_LOGIN_FAILS} 次，账号锁定 15 分钟"}), 429
        return jsonify({"ok": False, "msg": "邮箱或密码错误"}), 400

    conn.execute(
        "UPDATE users SET failed_attempts = 0, locked_until = 0, last_login = ? WHERE id = ?",
        (now, user["id"]),
    )
    conn.commit()
    conn.close()

    token = create_token(user["id"])
    nickname = user["nickname"] or email.split("@")[0]
    log(f"[登录] {email} 昵称={nickname}")
    return jsonify({
        "ok": True, "msg": "登录成功",
        "token": token, "email": email, "nickname": nickname,
    })


@account_bp.route("/logout", methods=["POST"])
def api_logout():
    token = extract_token()
    if token:
        conn = get_db()
        conn.execute("DELETE FROM tokens WHERE token = ?", (token,))
        conn.commit()
        conn.close()
    return jsonify({"ok": True, "msg": "已退出登录"})


@account_bp.route("/me", methods=["GET"])
def api_me():
    token = extract_token()
    user = get_user_by_token(token)
    if not user:
        return jsonify({"ok": False, "msg": "未登录"}), 401
    return jsonify({
        "ok": True,
        "email": user["email"],
        "nickname": user["nickname"] or user["email"].split("@")[0],
        "created_at": user["created_at"],
        "last_login": user["last_login"],
    })

@account_bp.route("/delete", methods=["POST"])
def api_delete_account():
    token = extract_token()
    user = get_user_by_token(token)
    if not user:
        return jsonify({"ok": False, "msg": "未登录"}), 401

    body = request.get_json(silent=True) or {}
    confirm_email = (body.get("confirmEmail") or "").strip().lower()

    if confirm_email != user["email"]:
        return jsonify({"ok": False, "msg": "确认邮箱不匹配"}), 400

    user_id = user["id"]
    conn = get_db()
    conn.execute("DELETE FROM tokens WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM configs WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM codes WHERE email = ?", (user["email"],))
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()

    log(f"[注销账号] {user['email']}")
    return jsonify({"ok": True, "msg": "账号已注销"})
    
@account_bp.route("/reset-password", methods=["POST"])
def api_reset_password():
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    code = (body.get("code") or "").strip()
    new_pwd = body.get("newPassword") or ""

    if not is_valid_email(email):
        return jsonify({"ok": False, "msg": "邮箱格式不正确"}), 400
    ok, msg = validate_password_strength(new_pwd)
    if not ok:
        return jsonify({"ok": False, "msg": msg}), 400

    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"ok": False, "msg": "该邮箱未注册"}), 400

    ok, msg = verify_code(email, code, "reset")
    if not ok:
        conn.close()
        return jsonify({"ok": False, "msg": msg}), 400

    pwd_hash = hash_password(new_pwd)
    conn.execute(
        "UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = 0 WHERE id = ?",
        (pwd_hash, user["id"]),
    )
    conn.execute("DELETE FROM tokens WHERE user_id = ?", (user["id"],))
    conn.commit()
    conn.close()

    token = create_token(user["id"])
    nickname = user["nickname"] or email.split("@")[0]
    log(f"[重置密码] {email}")
    return jsonify({
        "ok": True, "msg": "密码已重置",
        "token": token, "email": email, "nickname": nickname,
    })


@account_bp.route("/change-password", methods=["POST"])
def api_change_password():
    token = extract_token()
    user = get_user_by_token(token)
    if not user:
        return jsonify({"ok": False, "msg": "未登录"}), 401

    body = request.get_json(silent=True) or {}
    old_pwd = body.get("oldPassword") or ""
    new_pwd = body.get("newPassword") or ""

    if not check_password(old_pwd, user["password_hash"]):
        return jsonify({"ok": False, "msg": "原密码错误"}), 400
    ok, msg = validate_password_strength(new_pwd)
    if not ok:
        return jsonify({"ok": False, "msg": msg}), 400

    conn = get_db()
    pwd_hash = hash_password(new_pwd)
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (pwd_hash, user["id"]))
    conn.execute("DELETE FROM tokens WHERE user_id = ?", (user["id"],))
    conn.commit()
    conn.close()

    new_token = create_token(user["id"])
    log(f"[修改密码] {user['email']}")
    return jsonify({"ok": True, "msg": "密码已修改", "token": new_token})


@account_bp.route("/config", methods=["GET"])
def api_get_config():
    token = extract_token()
    user = get_user_by_token(token)
    if not user:
        return jsonify({"ok": False, "msg": "未登录"}), 401

    conn = get_db()
    row = conn.execute(
        "SELECT config_json, updated_at FROM configs WHERE user_id = ?", (user["id"],)
    ).fetchone()
    conn.close()

    if not row:
        return jsonify({"ok": True, "config": None, "updated_at": None})
    return jsonify({
        "ok": True,
        "config": json.loads(row["config_json"]),
        "updated_at": row["updated_at"],
    })


@account_bp.route("/config", methods=["POST"])
def api_save_config():
    token = extract_token()
    user = get_user_by_token(token)
    if not user:
        return jsonify({"ok": False, "msg": "未登录"}), 401

    body = request.get_json(silent=True) or {}
    config = body.get("config")
    if not config or not isinstance(config, dict):
        return jsonify({"ok": False, "msg": "配置格式错误"}), 400

    now = int(time.time())
    conn = get_db()
    conn.execute(
        """INSERT INTO configs (user_id, config_json, updated_at) VALUES (?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at""",
        (user["id"], json.dumps(config, ensure_ascii=False), now),
    )
    conn.commit()
    conn.close()

    log(f"[配置保存] {user['email']}")
    return jsonify({"ok": True, "msg": "配置已保存", "updated_at": now})