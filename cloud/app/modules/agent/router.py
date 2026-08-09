"""Agent gateway HTTP routes."""

from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...database import get_db
from ...deps import require_user
from ...schemas import AgentPlanRequest, AgentPlanResponse
from . import service

router = APIRouter(tags=["agent"])

_agent_service = service.AgentService()


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
    today = payload.date or date_type.today().strftime("%Y-%m-%d")
    try:
        return _agent_service.plan(
            db,
            current["user"].id,
            payload.message,
            payload.snapshot or [],
            today,
            payload.session_id,
        )
    except service.AgentError as error:
        _handle_error(error)
