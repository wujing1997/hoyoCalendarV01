# HoYoCalendar 云端后端（cloud/）

Electron 本地优先日历的云端模块化单体后端：FastAPI + SQLAlchemy + Alembic +
PostgreSQL，模块为 `auth` / `sync` / `agent` / `admin`。

- 面向前端集成的冻结 OpenAPI 契约：`openapi/api.openapi.json`（用户 API）、
  `openapi/admin.openapi.json`（管理 API）。生成命令见下。
- 管理服务独立进程，仅绑定 `127.0.0.1`。
- 部署与回退：`deploy/deploy.md`；Docker Compose：`docker-compose.yml`；
  反向代理示例：`nginx/hoyocalendar-api.conf`。

## 功能

| 模块 | 说明 |
| --- | --- |
| auth | 一次性邀请码、邮箱格式账号、Argon2id、访问/刷新令牌、≤5 台设备、会话撤销、限流 |
| sync | UUID 事件、JSONB 业务数据、增量游标、operationId 幂等、baseVersion 乐观并发、冲突返回、30 天回收站、180 天墓碑、超期强制全量校准 |
| agent | 单一 OpenAI-compatible 网关，只返回结构化 action plan、不写事件；快照不留存，会话对话及待审批草案/工具上下文按 TTL 有界保存且不写日志；脱敏用量、并发/超时、全局月度预算硬熔断、管理员总开关 |
| admin | 独立管理员认证、邀请码/用户/会话/AI 用量与开关 API、审计日志；仅 127.0.0.1 |

## 本地开发

```bash
cd cloud
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt

# PostgreSQL（本机 16）准备测试库（与生产账号分离）
sudo -u postgres psql -c "CREATE ROLE hoyo_test LOGIN PASSWORD 'hoyo_dev_only_local_pw';"
sudo -u postgres createdb -O hoyo_test hoyocalendar_test || true

# 迁移
alembic upgrade head

# 测试（需要 DATABASE_URL 指向 hoyocalendar_test；conftest 默认已指向）
pytest tests -q

# 冻结 OpenAPI 契约
python scripts/generate_openapi.py
```

环境变量模板见 `.env.example`，全部敏感值只放服务器 `.env`。

## 测试

```bash
cd cloud && python -m pytest tests -q
```

覆盖验收项：邀请码一次性、密码哈希、第 6 台设备拒绝、撤销会话立即失效、
push/pull 幂等、版本冲突双版本返回不覆盖、删除/恢复/墓碑规则、Agent schema
校验、会话隔离/截断/TTL、待审批草案语义连续性、全局熔断只暂停 AI、管理端公网隔离、审计日志与日志脱敏。
