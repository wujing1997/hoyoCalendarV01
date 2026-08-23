"""Agent gateway HTTP routes."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...database import get_db
from ...deps import require_user
from ...schemas import AgentPlanRequest, AgentPlanResponse
from . import service

router = APIRouter(tags=["agent"])

_agent_service = service.AgentService()
_BEIJING_TZ = timezone(timedelta(hours=8))


def _beijing_today(instant=None) -> str:
    current = instant or datetime.now(timezone.utc)
    return current.astimezone(_BEIJING_TZ).date().isoformat()


def _handle_error(error: service.AgentError):
    raise HTTPException(status_code=error.status_code, detail=error.detail)


@router.post(
    "/plan",
    response_model=AgentPlanResponse,
    responses={502: {"description": "model upstream error"}, 429: {"description": "budget exhausted"}, 503: {"description": "AI disabled or not configured"}},
)
def plan(
    payload: AgentPlanRequest,
    current=Depends(require_user),
    db: Session = Depends(get_db),
):
    today = payload.date.isoformat() if payload.date else _beijing_today()
    try:
        return _agent_service.plan(
            db,
            current["user"].id,
            payload.message,
            payload.snapshot or [],
            today,
            payload.session_id,
            [receipt.model_dump(mode="json") for receipt in payload.receipts],
            payload.continue_planning,
        )
    except service.AgentError as error:
        _handle_error(error)
