import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from advisor_info_api import router as advisor_router

# Unified parser — single endpoint for all insurance types via skills system
from parsers.unified_parser_api import router as unified_parser_router

from fillers.homeowners_filler_api import router as homeowners_filler_router
from fillers.auto_filler_api import router as auto_filler_router
from fillers.bundle_filler_api import router as bundle_filler_router
from fillers.dwelling_filler_api import router as dwelling_filler_router
from fillers.commercial_filler_api import router as commercial_filler_router

from analytics_api import router as analytics_router, self_router as analytics_self_router
from track_api import router as track_router
from pdf_storage_api import router as pdf_storage_router
from clerk_users_api import router as clerk_users_router
from chat_api import router as chat_router
from report_generator import router as report_router

from settings_api import router as settings_router, usage_router as api_usage_router
from auto_clear_task import start_auto_clear_loop
from browser_manager import get_browser, close_browser
from database import init_db, close_pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: launch Chromium + initialize database
    await get_browser()
    await init_db()
    # Start background auto-clear task
    auto_clear = asyncio.create_task(start_auto_clear_loop())
    yield
    auto_clear.cancel()
    # Shutdown: clean up browser + database pool
    await close_browser()
    await close_pool()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://the-sizemore-snapshot.vercel.app",
        "https://sizemoresnapshot.ai",
        "https://www.sizemoresnapshot.ai",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# Unified parser (single endpoint for all insurance types via skills system)
app.include_router(unified_parser_router)

# Filler routers (form-filling endpoints — still active)
app.include_router(homeowners_filler_router)
app.include_router(auto_filler_router)
app.include_router(bundle_filler_router)
app.include_router(dwelling_filler_router)
app.include_router(commercial_filler_router)
app.include_router(advisor_router)

# Analytics & tracking routers
app.include_router(analytics_router)
app.include_router(analytics_self_router)
app.include_router(track_router)

# PDF storage router
app.include_router(pdf_storage_router)

# Clerk user management router
app.include_router(clerk_users_router)

# Chat & reports
app.include_router(chat_router)
app.include_router(report_router)

# Settings & API usage
app.include_router(settings_router)
app.include_router(api_usage_router)
