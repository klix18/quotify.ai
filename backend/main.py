from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from advisor_info_api import router as advisor_router

from homeowners_parser_api import router as homeowners_parser_router
from homeowners_filler_api import router as homeowners_filler_router
from auto_filler_api import router as auto_filler_router
from bundle_filler_api import router as bundle_filler_router
from dwelling_filler_api import router as dwelling_filler_router
from commercial_filler_api import router as commercial_filler_router

from auto_parser_api import router as auto_parser_router
from dwelling_parser_api import router as dwelling_parser_router
from commercial_parser_api import router as commercial_parser_router
from bundle_parser_api import router as bundle_parser_router
from wind_parser_api import router as wind_parser_router

from browser_manager import get_browser, close_browser


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: launch Chromium once so first PDF generation is instant
    await get_browser()
    yield
    # Shutdown: clean up the browser process
    await close_browser()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://the-sizemore-snapshot.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

app.include_router(homeowners_parser_router)
app.include_router(homeowners_filler_router)
app.include_router(auto_filler_router)
app.include_router(bundle_filler_router)
app.include_router(dwelling_filler_router)
app.include_router(commercial_filler_router)
app.include_router(advisor_router)
app.include_router(auto_parser_router)
app.include_router(dwelling_parser_router)
app.include_router(commercial_parser_router)
app.include_router(bundle_parser_router)
app.include_router(wind_parser_router)