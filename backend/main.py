from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from homeowners_parser_api import router as parser_router
from homeowners_filler_api import router as filler_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

app.include_router(parser_router)
app.include_router(filler_router)