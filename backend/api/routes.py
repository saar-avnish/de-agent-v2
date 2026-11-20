from __future__ import annotations
import uuid
from typing import Dict, Any, Optional
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel, Field

from backend.contracts.planner_schema import PlannerContract
from backend.contracts.result_schema import ExecutionReport
from backend.security.access_gate import SecurityContext, UserRole
from backend.pipeline.gate_chain import GateChainPipeline
from backend.dbt_runtime.dbt_adapter import DbtAdapter


router = APIRouter()

# In-memory session store for developer console auth
SESSION_STORE: Dict[str, SecurityContext] = {
    "dev-default-session": SecurityContext(
        user_id="lead_alice",
        role=UserRole.LEAD_ENGINEER,
        allowed_domains=["sales", "marketing", "core", "finance"],
        pii_clearance=True,
    )
}

# Default dbt workspace directory
WORKSPACE_DIR = Path(__file__).resolve().parent.parent.parent / "dbt_workspace"


class AuthSessionRequest(BaseModel):
    user_id: str = Field(default="lead_alice", min_length=1)
    role: UserRole = Field(default=UserRole.LEAD_ENGINEER)
    allowed_domains: list[str] = Field(default_factory=lambda: ["sales", "marketing", "core"])
    pii_clearance: bool = Field(default=True)


class AuthSessionResponse(BaseModel):
    session_id: str
    user_id: str
    role: UserRole
    allowed_domains: list[str]
    pii_clearance: bool
    status: str = "AUTHENTICATED"


class DbtInitRequest(BaseModel):
    project_name: str = Field(default="de_agent_dw")
    warehouse: str = Field(default="duckdb")


class DbtInitResponse(BaseModel):
    project_name: str
    warehouse: str
    workspace_dir: str
    status: str
    message: str


class RunPipelineRequest(BaseModel):
    planner: Dict[str, Any]
    security_context: Optional[SecurityContext] = None
    manifest_models: Optional[Dict[str, Any]] = None


def get_current_security_context(
    x_session_id: Optional[str] = Header(None, alias="X-Session-ID")
) -> SecurityContext:
    if x_session_id and x_session_id in SESSION_STORE:
        return SESSION_STORE[x_session_id]
    # Default to Lead Engineer with sales domain for direct API calls
    return SecurityContext(
        user_id="lead_alice",
        role=UserRole.LEAD_ENGINEER,
        allowed_domains=["sales", "marketing", "core"],
        pii_clearance=True,
    )


@router.post("/auth/session", response_model=AuthSessionResponse)
def create_auth_session(req: AuthSessionRequest) -> AuthSessionResponse:
    """Page 1 Auth Endpoint: Configures user identity, role, domain scope, and PII clearance."""
    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    sec_ctx = SecurityContext(
        user_id=req.user_id,
        role=req.role,
        allowed_domains=req.allowed_domains,
        pii_clearance=req.pii_clearance,
    )
    SESSION_STORE[session_id] = sec_ctx
    return AuthSessionResponse(
        session_id=session_id,
        user_id=sec_ctx.user_id,
        role=sec_ctx.role,
        allowed_domains=sec_ctx.allowed_domains,
        pii_clearance=sec_ctx.pii_clearance,
    )


@router.get("/auth/session/{session_id}", response_model=AuthSessionResponse)
def get_auth_session(session_id: str) -> AuthSessionResponse:
    if session_id not in SESSION_STORE:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    sec_ctx = SESSION_STORE[session_id]
    return AuthSessionResponse(
        session_id=session_id,
        user_id=sec_ctx.user_id,
        role=sec_ctx.role,
        allowed_domains=sec_ctx.allowed_domains,
        pii_clearance=sec_ctx.pii_clearance,
    )


@router.post("/dbt/init", response_model=DbtInitResponse)
def init_dbt_workspace(req: DbtInitRequest) -> DbtInitResponse:
    """Page 2 dbt workspace initialization endpoint."""
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
    models_dir = WORKSPACE_DIR / "models"
    (models_dir / "staging").mkdir(parents=True, exist_ok=True)
    (models_dir / "intermediate").mkdir(parents=True, exist_ok=True)
    (models_dir / "marts").mkdir(parents=True, exist_ok=True)
    (WORKSPACE_DIR / "seeds").mkdir(parents=True, exist_ok=True)
    (WORKSPACE_DIR / "tests").mkdir(parents=True, exist_ok=True)
    (WORKSPACE_DIR / "macros").mkdir(parents=True, exist_ok=True)

    # Validate or check dbt availability
    adapter = DbtAdapter(project_dir=WORKSPACE_DIR)
    return DbtInitResponse(
        project_name=req.project_name,
        warehouse=req.warehouse,
        workspace_dir=str(WORKSPACE_DIR),
        status="INITIALIZED",
        message=f"Initialized isolated dbt workspace at {WORKSPACE_DIR} configured for {req.warehouse}.",
    )


@router.post("/stages/run-to-stage-2", response_model=ExecutionReport)
def run_stages_up_to_stage_2(
    req: RunPipelineRequest,
    current_sec_ctx: SecurityContext = Depends(get_current_security_context),
) -> ExecutionReport:
    """Executes Chain of Responsibility: Stage 1 (Contract) -> Stage 1.5 (Access) -> Stage 2 (Graph & dbt Synthesis)."""
    # Prefer explicit security context in body if provided, else use session header
    sec_ctx = req.security_context or current_sec_ctx

    pipeline = GateChainPipeline(workspace_dir=WORKSPACE_DIR)
    report = pipeline.run(
        raw_planner=req.planner,
        security_context=sec_ctx,
        manifest_models=req.manifest_models,
    )
    return report


@router.get("/stages/workspace-files")
def list_workspace_files() -> Dict[str, Any]:
    """Returns directory listing and contents of files generated in dbt_workspace for frontend diff viewer."""
    if not WORKSPACE_DIR.exists():
        return {"files": []}

    files_data = []
    for p in WORKSPACE_DIR.glob("**/*"):
        if p.is_file() and not p.name.endswith(".duckdb"):
            try:
                rel_path = str(p.relative_to(WORKSPACE_DIR)).replace("\\", "/")
                content = p.read_text(encoding="utf-8", errors="replace")
                files_data.append({
                    "path": rel_path,
                    "size_bytes": p.stat().st_size,
                    "content": content,
                })
            except Exception:
                pass

    return {
        "workspace_dir": str(WORKSPACE_DIR),
        "files": files_data,
    }
