#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
帝江号排班系统 · 账号服务
监听 127.0.0.1:5003
"""
import time
from flask import Flask, jsonify
from flask_cors import CORS

from account import account_bp, init_db
from admin import admin_bp, init_admin_db

app = Flask(__name__)
CORS(app)


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


app.register_blueprint(account_bp)
app.register_blueprint(admin_bp)


@app.route("/api/health")
@app.route("/api/account/health")
@app.route("/api/admin/health")
def health():
    return jsonify({"code": 200, "msg": "ok", "service": "account-server"})


if __name__ == "__main__":
    init_db()
    init_admin_db()
    log("账号服务启动 → http://127.0.0.1:5003")
    app.run(host="127.0.0.1", port=5003, debug=False)
