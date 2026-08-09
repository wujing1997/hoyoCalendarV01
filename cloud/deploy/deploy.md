# HoYoCalendar 云端后端 — 部署与回退说明

部署目标：用户 SSH 配置中的腾讯云服务器（当前即后端部署智能体运行的主机，
内网 `10.0.0.15`）。当前为**受邀测试环境**，按用户确认的测试期限制执行。

> ⚠️ 测试期风险（用户已明确接受）：**不做异机数据库备份**。服务器或数据库
> 故障可能导致账号、会话、同步游标与云端状态丢失，客户端本地副本无法完整
> 重建。该版本只能作为「可丢失数据的受邀测试版」，不得视为生产级保障。
> 正式开放前必须补齐备份/恢复与邮箱验证/密码找回。

## 架构

- 单体 FastAPI（模块：`auth` / `sync` / `agent` / `admin`）+ PostgreSQL 16。
- 用户 API（`api_app`）与管理 API（`admin_app`）共用同一套模型/路由；
  管理路由**仅挂载在 admin_app**，admin_app **只监听 127.0.0.1**。
- 开发/内部验收通过 SSH 隧道访问；邀请外部测试用户前购买域名并启用可信 HTTPS。

## 目录布局

```
/opt/hoyocalendar/
  cloud/                 # 后端代码（本仓库 cloud/ 目录）
  venv/                  # Python 虚拟环境
  .env                   # 全部敏感配置（不入库、不入日志）
```

## 首次部署

```bash
sudo mkdir -p /opt/hoyocalendar
sudo useradd -r -m -s /usr/sbin/nologin hoyo || true
sudo chown -R hoyo:hoyo /opt/hoyocalendar

# 1. 复制代码与建虚拟环境
sudo -u hoyo rsync -a --exclude '.git' cloud/ /opt/hoyocalendar/cloud/
sudo -u hoyo python3 -m venv /opt/hoyocalendar/venv
sudo -u hoyo /opt/hoyocalendar/venv/bin/pip install -r /opt/hoyocalendar/cloud/requirements.txt

# 2. PostgreSQL 数据库与账号（已有则跳过）
sudo -u postgres psql <<'SQL'
CREATE ROLE hoyo LOGIN PASSWORD '<强口令>';
CREATE DATABASE hoyocalendar OWNER hoyo;
SQL

# 3. 生成密钥并写 .env（值只保存在服务器）
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_TOKEN_SECRET=$(openssl rand -hex 32)
ADMIN_PASSWORD_HASH=$(/opt/hoyocalendar/venv/bin/python -c \
  "from argon2 import PasswordHasher; print(PasswordHasher().hash('<你的管理密码>'))")
sudo -u hoyo tee /opt/hoyocalendar/.env >/dev/null <<ENV
DATABASE_URL=postgresql+psycopg2://hoyo:<强口令>@127.0.0.1:5432/hoyocalendar
JWT_SECRET=$JWT_SECRET
ADMIN_TOKEN_SECRET=$ADMIN_TOKEN_SECRET
ADMIN_PASSWORD_HASH=$ADMIN_PASSWORD_HASH
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
ENV
# AI 真实 API Key：部署方不接触。需要时由用户本人登录服务器写入 .env（AI_BASE_URL/AI_API_KEY/AI_MODEL）。

# 4. 迁移 + 服务
sudo -u hoyo /opt/hoyocalendar/venv/bin/alembic -c /opt/hoyocalendar/cloud/alembic.ini upgrade head
sudo cp /opt/hoyocalendar/cloud/deploy/hoyocalendar-api.service /etc/systemd/system/
sudo cp /opt/hoyocalendar/cloud/deploy/hoyocalendar-admin.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hoyocalendar-api hoyocalendar-admin
```

注意：systemd 单元以 `hoyo` 用户运行，请确保 `.env` 与代码目录属主一致
（`sudo chown -R hoyo:hoyo /opt/hoyocalendar`）。

## 验证（冒烟）

```bash
# 健康检查
curl -s http://127.0.0.1:8000/api/health
# 期望：{"status":"ok","version":"0.1.0","database":"up",...}

# 管理服务只在本机可达（公网无监听）
ss -tlnp | grep -E ':8000|:8001'   # 两条都只应显示 127.0.0.1

# 本地通过隧道访问：
#   ssh -L 8000:127.0.0.1:8000 -L 8001:127.0.0.1:8001 <user>@<server>
#   浏览器打开 http://127.0.0.1:8000/docs 与 http://127.0.0.1:8001/docs
```

端到端冒烟脚本见 `scripts/smoke.sh`（注册邀请码→注册→登录→push→pull→冲突）。

## 常用运维

```bash
sudo systemctl status hoyocalendar-api
sudo journalctl -u hoyocalendar-api -n 50 --no-pager
sudo systemctl restart hoyocalendar-api

# 生成新邀请码（需管理令牌）
TOKEN=$(curl -s -X POST http://127.0.0.1:8001/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<管理密码>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -X POST http://127.0.0.1:8001/api/admin/invites \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"expires_days":30}'
```

## 回退

回退分两层：

1. **服务回退**（代码回滚）：
   ```bash
   sudo systemctl stop hoyocalendar-api hoyocalendar-admin
   # 将 cloud/ 恢复为上一发布版本（git checkout 旧提交后 rsync 覆盖）
   sudo -u hoyo rsync -a --delete /opt/hoyocalendar/cloud_release_OLD/ /opt/hoyocalendar/cloud/
   sudo systemctl start hoyocalendar-api hoyocalendar-admin
   curl -s http://127.0.0.1:8000/api/health
   ```

2. **数据库回退**（仅当迁移出错）：Alembic 支持降级：
   ```bash
   sudo -u hoyo /opt/hoyocalendar/venv/bin/alembic -c /opt/hoyocalendar/cloud/alembic.ini downgrade -1
   ```
   当前只有一个基线迁移 `0001_initial`，数据表均在该迁移内创建；降级即回到空库。
   如需保留数据，先 `pg_dump` 备份再操作：
   ```bash
   sudo -u postgres pg_dump -U hoyo hoyocalendar -Fc -f /opt/hoyocalendar/backup.dump
   ```

## 迁移自空库（验收项）

```bash
# 全新数据库执行
sudo -u postgres createdb -O hoyo hoyocalendar_fresh
DATABASE_URL='postgresql+psycopg2://hoyo:<口令>@127.0.0.1:5432/hoyocalendar_fresh' \
  sudo -u hoyo /opt/hoyocalendar/venv/bin/alembic -c /opt/hoyocalendar/cloud/alembic.ini upgrade head
# 期望无报错，9 张业务表 + alembic_version 全部创建
```
