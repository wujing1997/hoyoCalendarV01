#!/usr/bin/env bash
# HoYoCalendar Cloud API 端到端冒烟脚本
# 依赖：curl、python3。API 需已在 127.0.0.1:8000 运行，管理 API 在 127.0.0.1:8001。
set -euo pipefail

API=${API:-http://127.0.0.1:8000}
ADMIN=${ADMIN:-http://127.0.0.1:8001}
ADMIN_USER=${ADMIN_USER:-admin}
ADMIN_PASS=${ADMIN_PASS:-}

if [ -z "$ADMIN_PASS" ]; then
  echo "请设置 ADMIN_PASS 环境变量为管理后台密码" >&2
  exit 1
fi

# jget <json> <dotted-path>: 用 python 提取 JSON 字段（如 events[0].event_id）
jget() { echo "$1" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for part in '$2'.split('.'):
    if '[' in part:
        name, idx = part[:-1].split('[')
        data = data[name][int(idx)]
    else:
        data = data[part]
if isinstance(data, (dict, list)):
    print(json.dumps(data, ensure_ascii=False))
else:
    print(data)
"; }

echo "== 1. 健康检查 =="
HEALTH=$(curl -sf "$API/healthz")
echo "status=$(jget "$HEALTH" status)"

echo "== 2. 管理员登录并生成邀请码 =="
ADMIN_TOKEN=$(curl -sf -X POST "$ADMIN/api/v1/admin/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
INVITE=$(curl -sf -X POST "$ADMIN/api/v1/admin/invites" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"expires_days":7}' | python3 -c "import sys,json;print(json.load(sys.stdin)['code'])")
echo "invite=$INVITE"

echo "== 3. 注册 =="
EMAIL="smoke-$(date +%s)@example.com"
REG=$(curl -sf -X POST "$API/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"invite_code\":\"$INVITE\",\"email\":\"$EMAIL\",\"password\":\"SmokePass123!\",\"device_name\":\"smoke-pc\"}")
TOKEN=$(echo "$REG" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
echo "registered $EMAIL"

echo "== 4. push 两条事件 =="
EV1=$(python3 -c "import uuid;print(uuid.uuid4())")
EV2=$(python3 -c "import uuid;print(uuid.uuid4())")
curl -sf -X POST "$API/api/v1/sync/push" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"changes\":[
     {\"eventId\":\"$EV1\",\"version\":1,\"baseVersion\":0,\"operationId\":\"$(python3 -c 'import uuid;print(uuid.uuid4())')\",\"op\":\"upsert\",\"data\":{\"event\":\"冒烟测试\",\"date\":\"2026-08-10\"}},
     {\"eventId\":\"$EV2\",\"version\":1,\"baseVersion\":0,\"operationId\":\"$(python3 -c 'import uuid;print(uuid.uuid4())')\",\"op\":\"upsert\",\"data\":{\"event\":\"另一条\",\"date\":\"2026-08-11\"}}
   ]}" >/dev/null
echo "pushed"

echo "== 5. pull 校验 =="
PULL=$(curl -sf "$API/api/v1/sync/pull?cursor=0" -H "Authorization: Bearer $TOKEN")
COUNT=$(echo "$PULL" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['events']))")
echo "events=$COUNT"
[ "$COUNT" = "2" ] || { echo "FAIL: expected 2 events, got $COUNT" >&2; exit 1; }

echo "== 6. 版本冲突（不覆盖） =="
R1=$(curl -sf -X POST "$API/api/v1/sync/push" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"changes\":[{\"eventId\":\"$EV1\",\"version\":2,\"baseVersion\":1,\"operationId\":\"$(python3 -c 'import uuid;print(uuid.uuid4())')\",\"op\":\"upsert\",\"data\":{\"event\":\"冒烟测试\",\"date\":\"2026-08-10\",\"time\":\"09:00\"}}]}")
S1=$(echo "$R1" | python3 -c "import sys,json;print(json.load(sys.stdin)['results'][0]['status'])")
echo "first update: $S1"
R2=$(curl -sf -X POST "$API/api/v1/sync/push" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"changes\":[{\"eventId\":\"$EV1\",\"version\":2,\"baseVersion\":1,\"operationId\":\"$(python3 -c 'import uuid;print(uuid.uuid4())')\",\"op\":\"upsert\",\"data\":{\"event\":\"冒烟测试\",\"date\":\"2026-08-10\",\"time\":\"12:00\"}}]}")
S2=$(echo "$R2" | python3 -c "import sys,json;print(json.load(sys.stdin)['results'][0]['status'])")
echo "stale update: $S2"
[ "$S2" = "conflict" ] || { echo "FAIL: expected conflict" >&2; exit 1; }

echo "== 7. AI 网关 =="
AI_BODY=$(curl -s -X POST "$API/api/v1/agent/plan" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"message":"创建明天的会议"}')
AI_RESP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/v1/agent/plan" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"message":"创建明天的会议"}')
if [ "$AI_RESP" = "503" ]; then
  echo "agent plan http=$AI_RESP (AI 未配置，测试环境配置 API Key 后应返回 200)"
elif [ "$AI_RESP" = "200" ]; then
  ACTIONS=$(echo "$AI_BODY" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('actions',[])))" 2>/dev/null || echo "0")
  echo "agent plan http=200 OK (actions=$ACTIONS)"
else
  echo "agent plan http=$AI_RESP（非预期，见日志）" >&2
  exit 1
fi

echo
echo "SMOKE PASS"
