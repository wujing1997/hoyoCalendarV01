"""Model providers for the cloud Agent gateway.

Only the OpenAI-compatible chat completions API is used. Providers return a
ChatResult that never contains raw API keys; request/response bodies are never
logged or persisted by the caller.
"""

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx


class ProviderError(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class ChatResult:
    content: str
    tool_calls: List[ToolCall] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0


class OpenAICompatibleProvider:
    def __init__(self, base_url: str, api_key: str, timeout: float = 45.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def complete(self, messages: List[dict], tools: List[dict], model: str) -> ChatResult:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.1,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        try:
            with httpx.Client(timeout=self.timeout, headers=headers) as client:
                response = client.post(f"{self.base_url}/chat/completions", json=payload)
        except httpx.TimeoutException:
            raise ProviderError("timeout", "model request timed out")
        except httpx.HTTPError as error:
            raise ProviderError("network_error", f"model request failed: {error}")

        if response.status_code != 200:
            snippet = (response.text or "")[:300].replace("\n", " ")
            raise ProviderError(
                "upstream_error",
                f"model returned HTTP {response.status_code}: {snippet}",
            )
        try:
            body = response.json()
            choice = body["choices"][0]
            message = choice.get("message") or {}
            usage = body.get("usage") or {}
        except (ValueError, KeyError, IndexError):
            raise ProviderError("bad_response", "model returned an unparseable response")

        tool_calls = []
        for call in message.get("tool_calls") or []:
            try:
                arguments = json.loads(call.get("function", {}).get("arguments") or "{}")
            except ValueError:
                arguments = {}
            tool_calls.append(
                ToolCall(
                    id=str(call.get("id") or ""),
                    name=str(call.get("function", {}).get("name") or ""),
                    arguments=arguments if isinstance(arguments, dict) else {},
                )
            )
        return ChatResult(
            content=str(message.get("content") or ""),
            tool_calls=tool_calls,
            prompt_tokens=int(usage.get("prompt_tokens") or 0),
            completion_tokens=int(usage.get("completion_tokens") or 0),
        )


class FakeProvider:
    """Deterministic in-memory provider used for tests (no network)."""

    def __init__(self, plan: Optional[List[dict]] = None):
        # plan: list of assistant turns; each turn is {"tool_calls": [...]} or {"content": str}
        self.plan = plan or []
        self.calls = 0

    def complete(self, messages: List[dict], tools: List[dict], model: str) -> ChatResult:
        self.calls += 1
        turn_index = min(self.calls - 1, len(self.plan) - 1) if self.plan else 0
        turn = self.plan[turn_index] if self.plan else {"content": "已完成。"}
        tool_calls = []
        for call in turn.get("tool_calls", []):
            tool_calls.append(
                ToolCall(
                    id=call.get("id") or f"call_{self.calls}",
                    name=call["name"],
                    arguments=call.get("arguments", {}),
                )
            )
        return ChatResult(
            content=turn.get("content") or "",
            tool_calls=tool_calls,
            prompt_tokens=12,
            completion_tokens=6,
        )
