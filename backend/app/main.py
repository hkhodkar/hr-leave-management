import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, SQLModel

from .config import Settings
from .database import make_engine
from .routers import employees, leave_requests, overview, reference, session
from .seed import seed_if_empty

logger = logging.getLogger("leave")

DESCRIPTION = """
Leave requests, approvals and balances for a small company.

There is no login in this demo. Every call (except the user list) is made as an
employee picked with the `X-User-Id` header, and the API checks what that person
may see and do: employees work with their own leave, managers decide for their
team and HR admins see everyone.
"""


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    engine = make_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        SQLModel.metadata.create_all(engine)
        if settings.seed_demo_data:
            with Session(engine) as db:
                if seed_if_empty(db):
                    logger.info("Database was empty, loaded demo data")
        yield
        engine.dispose()

    app = FastAPI(
        title="Leave Management API",
        description=DESCRIPTION,
        version="1.0.0",
        lifespan=lifespan,
    )
    app.state.engine = engine

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    api = APIRouter(prefix="/api")
    for module in (session, employees, leave_requests, overview, reference):
        api.include_router(module.router)

    @api.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(api)
    return app


app = create_app()
