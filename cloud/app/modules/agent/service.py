"""Cloud Agent gateway: plan-only, never writes events, never persists bodies."""

import json
import re
import threading
import time
from copy import deepcopy
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ... import models
from ...config import settings
from .provider import FakeProvider, OpenAICompatibleProvider, ProviderError


class AgentError(Exception):
    def __init__(self, status_code: int, code: str, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.code = code
        self.detail = detail


TOOL_DEFINITIONS = {
    "list_events": {
        "type": "function",
        "function": {
            "name": "list_events",
            "description": "查询当前日程。修改或删除前必须先查询以取得准确 ID。",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "标题关键词。"},
                    "date": {"type": "string", "description": "特定日期 YYYY-MM-DD。"},
                    "start_date": {"type": "string"},
                    "end_date": {"type": "string"},
                },
            },
        },
    },
    "create_event": {
        "type": "function",
        "function": {
            "name": "create_event",
            "description": "规划创建一条日程。动作由客户端审批后统一执行。",
            "parameters": {
                "type": "object",
                "properties": {
                    "event": {"type": "string", "description": "任务标题。"},
                    "date": {"type": "string", "description": "日期 YYYY-MM-DD。"},
                    "time": {"type": "string", "description": "时间 HH:mm，可省略。"},
                    "location": {"type": "string"},
                    "note": {"type": "string"},
                    "urgency": {"type": "string", "enum": ["normal", "high"]},
                    "isRecurring": {"type": "boolean"},
                    "recurringType": {"type": "string", "enum": ["daily", "weekly", "monthly"]},
                    "recurringDays": {"type": "array", "items": {"type": "integer", "minimum": 0, "maximum": 6}},
                    "isDeadline": {"type": "boolean"},
                    "startDate": {"type": "string"},
                    "deadlineDate": {"type": "string"},
                },
                "required": ["event", "date"],
            },
        },
    },
    "update_event": {
        "type": "function",
        "function": {
            "name": "update_event",
            "description": "规划修改已有日程。必须使用 list_events 返回的真实 ID。",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"description": "日程 ID。"},
                    "event": {"type": "string"},
                    "date": {"type": "string"},
                    "time": {"type": "string"},
                    "location": {"type": "string"},
                    "note": {"type": "string"},
                },
                "required": ["id"],
            },
        },
    },
    "delete_event": {
        "type": "function",
        "function": {
            "name": "delete_event",
            "description": "规划删除已有日程。必须使用 list_events 返回的真实 ID。",
            "parameters": {
                "type": "object",
                "properties": {"id": {"description": "日程 ID。"}},
                "required": ["id"],
            },
        },
    },
}


class PlanningContext:
    def __init__(self, snapshot: List[dict]):
        self.events = deepcopy(snapshot if isinstance(snapshot, list) else [])
        self.actions = []
        self.draft_index = 0

    def execute(self, name: str, args: dict) -> dict:
        if name == "list_events":
            keyword = str(args.get("keyword") or "").lower().strip()
            results = [
                e for e in self.events
                if not keyword or keyword in str(e.get("event") or "").lower()
            ]
            return {"success": True, "count": len(results), "events": results[:100]}
        if name == "create_event":
            self.draft_index += 1
            draft_id = f"draft-{self.draft_index}"
            event = {
                "event": str(args.get("event") or "新日程"),
                "date": str(args.get("date") or ""),
                "time": str(args.get("time") or ""),
                "location": str(args.get("location") or ""),
                "note": str(args.get("note") or ""),
                "urgency": "high" if args.get("urgency") == "high" else "normal",
            }
            if args.get("isDeadline"):
                event["isDeadline"] = True
                event["startDate"] = str(args.get("startDate") or event["date"])
                event["deadlineDate"] = str(args.get("deadlineDate") or event["date"])
            if args.get("isRecurring"):
                event["isRecurring"] = True
                event["recurringType"] = args.get("recurringType") or "daily"
                event["recurringDays"] = args.get("recurringDays") or []
            event["id"] = draft_id
            self.events.append(event)
            self.actions.append({
                "type": "create",
                "draft_id": draft_id,
                "event": {k: v for k, v in event.items() if k != "id"},
            })
            return {"success": True, "event": event}
        if name == "update_event":
            event_id = args.get("id")
            event = next(
                (e for e in self.events if str(e.get("id")) == str(event_id)), None
            )
            if not event:
                return {"success": False, "message": f"未找到日程 ID {event_id}"}
            allowed = {"event", "date", "time", "location", "note", "urgency"}
            updates = {k: v for k, v in args.items() if k in allowed and k != "id"}
            event.update(updates)
            self.actions.append({"type": "update", "id": event_id, "updates": updates})
            return {"success": True, "event": event}
        if name == "delete_event":
            event_id = args.get("id")
            event = next(
                (e for e in self.events if str(e.get("id")) == str(event_id)), None
            )
            if not event:
                return {"success": False, "message": f"未找到日程 ID {event_id}"}
            self.actions.append({"type": "delete", "id": event_id})
            return {"success": True, "event": event}
        return {"success": False, "message": f"不支持的工具：{name}"}


def select_tools(message: str) -> List[dict]:
    if re.search(r"删除|取消|移除", message):
        names = ["list_events", "delete_event"]
    elif re.search(r"修改|改到|改成|移到|推迟|提前|重命名|调整", message):
        names = ["list_events", "update_event"]
    elif re.search(r"查询|查看|有什么|哪些|冲突|空闲", message):
        names = ["list_events"]
    elif re.search(r"添加|新增|创建|安排|提醒|记下", message):
        names = ["create_event"]
    else:
        names = ["list_events", "create_event", "update_event", "delete_event"]
    return [TOOL_DEFINITIONS[name] for name in names]


class AgentService:
    def __init__(self, provider_override=None):
        self._semaphore = threading.BoundedSemaphore(settings.ai_max_concurrency)
        self._sessions: dict = {}
        self._session_lock = threading.Lock()
        self.provider_override = provider_override

    # ------------------------------------------------------------------ budget

    def _admin_setting(self, db: Session, key: str, default: float) -> Optional[str]:
        row = db.execute(
            select(models.AdminSetting).where(models.AdminSetting.key == key)
        ).scalar_one_or_none()
        return row.value if row else None

    def ai_enabled(self, db: Session) -> bool:
        value = self._admin_setting(db, "ai_enabled", None)
        if value is not None:
            return value.strip().lower() in ("1", "true", "yes", "on")
        return settings.ai_enabled_default

    def ai_monthly_budget(self, db: Session) -> float:
        value = self._admin_setting(db, "ai_monthly_budget_usd", None)
        if value is not None:
            try:
                return float(value)
            except ValueError:
                pass
        return settings.ai_monthly_budget_usd

    def spent_this_month(self, db: Session) -> float:
        start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        total = db.execute(
            select(func.coalesce(func.sum(models.AiUsage.estimated_cost_usd), 0.0)).where(
                models.AiUsage.created_at >= start,
                models.AiUsage.status == "success",
            )
        ).scalar()
        return float(total or 0.0)

    def _check_budget(self, db: Session) -> None:
        if not self.ai_enabled(db):
            raise AgentError(503, "ai_disabled", "AI 服务已被管理员关闭")
        budget = self.ai_monthly_budget(db)
        if budget > 0 and self.spent_this_month(db) >= budget:
            raise AgentError(429, "budget_exceeded", "AI 月度预算已用完，日历与同步功能不受影响")

    def _record_usage(
        self,
        db: Session,
        user_id,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        latency_ms: int,
        status: str,
        error_code: Optional[str] = None,
    ) -> None:
        cost = (
            prompt_tokens * settings.ai_input_price_per_1k
            + completion_tokens * settings.ai_output_price_per_1k
        ) / 1000.0
        db.add(models.AiUsage(
            user_id=user_id,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            estimated_cost_usd=round(cost, 8),
            latency_ms=latency_ms,
            status=status,
            error_code=error_code,
        ))
        db.commit()

    # ------------------------------------------------------------------ plan

    def _provider(self):
        if self.provider_override is not None:
            return self.provider_override
        if settings.ai_api_key or settings.ai_base_url:
            if not settings.ai_base_url:
                raise AgentError(503, "not_configured", "AI 服务未配置")
            return OpenAICompatibleProvider(
                settings.ai_base_url, settings.ai_api_key, settings.ai_timeout_seconds
            )
        raise AgentError(503, "not_configured", "AI 服务未配置")

    def plan(self, db: Session, user_id, message: str, snapshot, today: str, session_id: Optional[str]) -> dict:
        self._check_budget(db)
        acquired = self._semaphore.acquire(timeout=15.0)
        if not acquired:
            raise AgentError(503, "busy", "AI 服务繁忙，请稍后再试")
        started = time.monotonic()
        provider = None
        model = settings.ai_model or "default"
        try:
            provider = self._provider()
            history = []
            if session_id:
                with self._session_lock:
                    history = deepcopy(self._sessions.get(session_id, []))[-6:]
            system = (
                "你是 HoYoCalendar 的日程执行助手。"
                f"今天是 {today}。先理解用户目标，再使用工具规划必要动作。"
                "修改或删除前必须先 list_events，禁止猜测 ID。"
                "Deadline 任务设置 isDeadline=true；循环任务使用 isRecurring=true。"
                "不要声称已经写入数据；工具成功后用简洁中文说明具体规划结果。"
                "如果信息不足，先提出一个最关键的澄清问题，不调用写工具。"
            )
            messages = [{"role": "system", "content": system}, *history]
            if snapshot:
                messages.append({
                    "role": "user",
                    "content": f"以下是当前日历快照（共 {len(snapshot)} 条）：\n{_render_snapshot(snapshot)}",
                })
            messages.append({"role": "user", "content": message})
            tools = select_tools(message)
            context = PlanningContext(snapshot)
            final_message = ""
            total_prompt = 0
            total_completion = 0

            for _round in range(3):
                result = provider.complete(messages, tools, model)
                total_prompt += result.prompt_tokens
                total_completion += result.completion_tokens
                assistant_payload = {"role": "assistant", "content": result.content or ""}
                if result.tool_calls:
                    assistant_payload["tool_calls"] = [
                        {
                            "id": call.id,
                            "type": "function",
                            "function": {
                                "name": call.name,
                                # OpenAI 线格式要求 arguments 为 JSON 字符串（DeepSeek 严格校验）
                                "arguments": json.dumps(call.arguments, ensure_ascii=False),
                            },
                        }
                        for call in result.tool_calls
                    ]
                messages.append(assistant_payload)
                if not result.tool_calls:
                    final_message = result.content or "处理完成。"
                    break
                for call in result.tool_calls:
                    result_payload = context.execute(call.name, call.arguments)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": _dump(result_payload),
                    })

            if not final_message:
                final_message = (
                    f"已规划 {len(context.actions)} 项日程变更。"
                    if context.actions
                    else "已完成查询，没有需要写入的变更。"
                )
            if session_id:
                with self._session_lock:
                    history = self._sessions.setdefault(session_id, [])
                    history.extend([
                        {"role": "user", "content": message},
                        {"role": "assistant", "content": final_message},
                    ])
                    self._sessions[session_id] = history[-8:]

            latency_ms = int((time.monotonic() - started) * 1000)
            self._record_usage(
                db, user_id, model, total_prompt, total_completion, latency_ms, "success"
            )
            return {
                "message": final_message,
                "actions": context.actions,
                "configured": True,
                "usage": {
                    "model": model,
                    "prompt_tokens": total_prompt,
                    "completion_tokens": total_completion,
                    "latency_ms": latency_ms,
                },
                "budget": self._budget_info(db),
            }
        except ProviderError as error:
            latency_ms = int((time.monotonic() - started) * 1000)
            try:
                self._record_usage(
                    db, user_id, model, 0, 0, latency_ms, "error", error.code
                )
            except Exception:
                pass
            raise AgentError(502, error.code, f"AI 请求失败：{error.detail}")
        finally:
            self._semaphore.release()

    def _budget_info(self, db: Session) -> dict:
        budget = self.ai_monthly_budget(db)
        if budget <= 0:
            return {"enabled": False}
        return {
            "enabled": True,
            "remaining_usd": round(max(0.0, budget - self.spent_this_month(db)), 4),
        }


def _render_snapshot(snapshot: List[dict]) -> str:
    lines = []
    for event in snapshot[: settings.ai_max_snapshot_events]:
        try:
            lines.append(_dump({
                "id": event.get("id"),
                "event": event.get("event"),
                "date": event.get("date"),
                "time": event.get("time"),
                "isDeadline": event.get("isDeadline"),
                "isRecurring": event.get("isRecurring"),
                "isCompleted": event.get("isCompleted"),
            }))
        except Exception:
            continue
    return "\n".join(lines)


def _dump(value) -> str:
    import json

    return json.dumps(value, ensure_ascii=False, default=str)
