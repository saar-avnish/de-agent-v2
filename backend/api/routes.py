from __future__ import annotations
from typing import Dict, Any, Optional, List
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.contracts.result_schema import ExecutionReport
from backend.pipeline.gate_chain import GateChainPipeline
from backend.dbt_runtime.dbt_adapter import DbtAdapter
from backend.state.execution_store import execution_store


router = APIRouter()

# Default dbt workspace directory
_DEFAULT_WORKSPACE_DIR = Path(__file__).resolve().parent.parent.parent / "dbt_workspace"
_current_workspace_dir = _DEFAULT_WORKSPACE_DIR


def get_workspace_dir() -> Path:
    return _current_workspace_dir


def set_workspace_dir(path: Path | str) -> None:
    global _current_workspace_dir
    _current_workspace_dir = Path(path).resolve()


def reset_workspace_dir() -> None:
    global _current_workspace_dir
    _current_workspace_dir = _DEFAULT_WORKSPACE_DIR


class DbtInitRequest(BaseModel):
    project_name: str = Field(default="enterprise_dw")
    warehouse: str = Field(default="duckdb")


class DbtInitResponse(BaseModel):
    project_name: str
    warehouse: str
    workspace_dir: str
    status: str
    message: str


class RunPipelineRequest(BaseModel):
    planner: Dict[str, Any]
    manifest_models: Optional[Dict[str, Any]] = None


@router.post("/dbt/init", response_model=DbtInitResponse)
def init_dbt_workspace(req: DbtInitRequest) -> DbtInitResponse:
    """Initializes or bootstraps the dbt workspace directory tree."""
    ws = get_workspace_dir()
    ws.mkdir(parents=True, exist_ok=True)
    models_dir = ws / "models"
    (models_dir / "staging").mkdir(parents=True, exist_ok=True)
    (models_dir / "intermediate").mkdir(parents=True, exist_ok=True)
    (models_dir / "marts").mkdir(parents=True, exist_ok=True)
    (ws / "seeds").mkdir(parents=True, exist_ok=True)
    (ws / "tests").mkdir(parents=True, exist_ok=True)
    (ws / "macros").mkdir(parents=True, exist_ok=True)

    adapter = DbtAdapter(project_dir=ws)
    return DbtInitResponse(
        project_name=req.project_name,
        warehouse=req.warehouse,
        workspace_dir=str(ws),
        status="INITIALIZED",
        message=f"Initialized dbt workspace at {ws} configured for {req.warehouse}.",
    )


@router.post("/stages/run-to-stage-2", response_model=ExecutionReport)
def run_stages_up_to_stage_2(req: RunPipelineRequest) -> ExecutionReport:
    """Executes 2-Stage Gate Chain: Stage 1 (Contract & PII) -> Stage 2 (Graph & dbt Synthesis). Stores report in server state."""
    ws = get_workspace_dir()
    pipeline = GateChainPipeline(workspace_dir=ws)
    report = pipeline.run(
        raw_planner=req.planner,
        manifest_models=req.manifest_models,
    )
    # Save to backend server state store
    execution_store.save(report)
    return report


@router.get("/stages/executions/latest", response_model=ExecutionReport)
def get_latest_execution() -> ExecutionReport:
    """Fetches the most recent pipeline execution report from backend state store."""
    report = execution_store.get_latest()
    if not report:
        raise HTTPException(status_code=404, detail="No pipeline executions recorded yet")
    return report


@router.get("/stages/executions/{exec_id}", response_model=ExecutionReport)
def get_execution_by_id(exec_id: str) -> ExecutionReport:
    """Fetches a specific execution report by ID from backend state store."""
    report = execution_store.get(exec_id)
    if not report:
        raise HTTPException(status_code=404, detail=f"Execution '{exec_id}' not found")
    return report


@router.get("/stages/workspace-files")
def list_workspace_files() -> Dict[str, Any]:
    """Returns non-binary, human-readable files (YAML, SQL, manifest.json, dbt.log) in the active workspace."""
    ws = get_workspace_dir()
    if not ws.exists():
        return {"workspace_dir": str(ws), "files": []}

    EXCLUDED_PATTERNS = {".duckdb", ".wal", ".msgpack", ".user.yml", ".pyc", ".gitkeep"}
    ALLOWED_EXTENSIONS = {".yml", ".yaml", ".sql", ".json", ".log"}

    files_data = []
    for p in ws.glob("**/*"):
        if not p.is_file():
            continue

        # Skip excluded patterns
        if any(p.name.endswith(ex) for ex in EXCLUDED_PATTERNS):
            continue

        # Only allow human-readable code and log files
        ext = p.suffix.lower()
        if ext not in ALLOWED_EXTENSIONS and p.name not in {"manifest.json", "dbt.log"}:
            continue

        try:
            rel_path = str(p.relative_to(ws)).replace("\\", "/")
            content = p.read_text(encoding="utf-8", errors="replace")
            files_data.append({
                "path": rel_path,
                "name": p.name,
                "extension": ext,
                "size_bytes": p.stat().st_size,
                "content": content,
            })
        except Exception:
            pass

    return {
        "workspace_dir": str(ws),
        "files": files_data,
    }
