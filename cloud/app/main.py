"""FastAPI application factory.

`api_app` is the public user-facing API.
`admin_app` additionally mounts the admin router and is bound to 127.0.0.1 only.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import __version__ as _  # noqa: F401
from .config import settings
from .database import get_session, init_engine
from .logging_config import configure_logging
from .modules.admin.router import router as admin_router
from .modules.agent.router import router as agent_router
from .modules.auth.router import router as auth_router
from .modules.sync.router import router as sync_router
from .modules.sync.service import purge_expired

logger = logging.getLogger("hoyocalendar")

VERSION = settings.version

_PURGE_INTERVAL_SECONDS = 3600


async def _purge_loop():
    while True:
        await asyncio.sleep(_PURGE_INTERVAL_SECONDS)
        try:
            db = get_session()
            try:
                result = purge_expired(db)
                if result["bodies_cleared"] or result["tombstones_purged"]:
                    logger.info("purge completed", extra={"purge": result})
            finally:
                db.close()
        except Exception:
            logger.exception("purge task failed")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_engine()
    task = asyncio.create_task(_purge_loop())
    logger.info("HoYoCalendar cloud API starting")
    yield
    task.cancel()
    logger.info("HoYoCalendar cloud API stopped")


def create_app(include_admin: bool = False) -> FastAPI:
    configure_logging(settings.log_level)
    app = FastAPI(
        title="HoYoCalendar Cloud API",
        version=VERSION,
        docs_url="/docs" if include_admin else "/docs",
        lifespan=lifespan,
    )

    @app.middleware("http")
    async def access_log(request: Request, call_next):
        started = datetime.now(timezone.utc)
        response = await call_next(request)
        elapsed_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
        # Never log request bodies, headers, or response bodies.
        logger.info(
            "access method=%s path=%s status=%s duration_ms=%d",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        return response

    @app.exception_handler(Exception)
    async def unhandled(_request: Request, exc: Exception):
        logger.exception("unhandled error: %s", exc.__class__.__name__)
        return JSONResponse(status_code=500, content={"detail": "服务器内部错误"})

    app.include_router(auth_router, prefix="/api/auth")
    app.include_router(sync_router, prefix="/api/sync")
    app.include_router(agent_router, prefix="/api/agent")
    if include_admin:
        app.include_router(admin_router, prefix="/api/admin")

    @app.get("/api/health", tags=["health"], responses={200: {"description": "service healthy"}, 503: {"description": "database unreachable"}})
    def health():
        try:
            db = get_session()
            try:
                db.execute(__import__("sqlalchemy").text("SELECT 1"))
            finally:
                db.close()
        except Exception:
            return JSONResponse(status_code=503, content={"status": "degraded", "version": VERSION, "database": "down"})
        return {
            "status": "ok",
            "version": VERSION,
            "database": "up",
            "time": datetime.now(timezone.utc).isoformat(),
        }

    return app


api_app = create_app(include_admin=False)
admin_app = create_app(include_admin=True)
