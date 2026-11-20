from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.api.routes import router

app = FastAPI(
    title="Data Engineering Agent (de-agent-v2) Gateway",
    description="Enterprise-grade Stage 1 -> 1.5 -> 2 Gate Chain, Graph Analyzer & dbt 1.8+ TDD Synthesizer",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "HEALTHY", "service": "de-agent-v2-backend", "stage_max": "Stage 2"}
