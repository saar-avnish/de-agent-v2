from __future__ import annotations
from typing import Dict, Any, Optional, List
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.contracts.result_schema import ExecutionReport
from backend.pipeline.gate_chain import GateChainPipeline
from backend.dbt_runtime.dbt_adapter import DbtAdapter
from backend.storage.execution_store import execution_store, RuntimeConfig
from backend.storage.artifact_store import artifact_store


router = APIRouter()

# Optional override workspace directory for isolated tests (tmp_path)
_override_workspace_dir: Optional[Path] = None


def get_workspace_dir() -> Optional[Path]:
    return _override_workspace_dir


def set_workspace_dir(path: Path | str) -> None:
    global _override_workspace_dir
    _override_workspace_dir = Path(path).resolve()


def reset_workspace_dir() -> None:
    global _override_workspace_dir
    _override_workspace_dir = None


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
    """Verifies dbt runtime and bootstraps in-memory configuration without writing persistent disk files."""
    try:
        verify_res = DbtAdapter.verify_runtime(
            warehouse=req.warehouse,
            project_name=req.project_name
        )
    except Exception as ex:
        raise HTTPException(
            status_code=500,
            detail=f"dbt runtime verification failed for '{req.warehouse}': {str(ex)}"
        )

    if not verify_res.success:
        raise HTTPException(
            status_code=500,
            detail=f"dbt runtime debug check failed for '{req.warehouse}': {verify_res.error_summary or verify_res.stderr or verify_res.stdout}"
        )

    msg = f"Runtime verified for '{req.warehouse}' in ephemeral in-memory sandbox (zero host disk footprint)."
    # Update runtime config in server state store
    config = RuntimeConfig(
        project_name=req.project_name,
        warehouse=req.warehouse,
        dialect_path=":memory:" if req.warehouse == "duckdb" else req.warehouse,
        status="INITIALIZED",
        message=msg,
    )
    execution_store.set_runtime_config(config)

    return DbtInitResponse(
        project_name=req.project_name,
        warehouse=req.warehouse,
        workspace_dir=":memory:" if not _override_workspace_dir else str(_override_workspace_dir),
        status="INITIALIZED",
        message=msg,
    )


@router.get("/dbt/runtime", response_model=RuntimeConfig)
def get_runtime_configuration() -> RuntimeConfig:
    """Fetches the active dbt runtime configuration and health state."""
    return execution_store.get_runtime_config()


@router.post("/stages/run-to-stage-2", response_model=ExecutionReport)
def run_stages_up_to_stage_2(req: RunPipelineRequest) -> ExecutionReport:
    """Executes 2-Stage Gate Chain: Stage 1 (Contract & PII) -> Stage 2 (Graph & dbt Synthesis). Stores report in server state."""
    pipeline = GateChainPipeline(workspace_dir=_override_workspace_dir)
    report = pipeline.run(
        raw_planner=req.planner,
        manifest_models=req.manifest_models,
    )
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


@router.get("/stages/executions/{exec_id}/artifacts")
def get_execution_artifacts(exec_id: str) -> Dict[str, Any]:
    """Retrieves all synthesized artifacts captured for a specific execution ID."""
    artifacts = artifact_store.get_artifacts(exec_id)
    return {
        "execution_id": exec_id,
        "count": len(artifacts),
        "artifacts": [a.model_dump() for a in artifacts],
    }


@router.get("/stages/workspace-files")
def list_workspace_files() -> Dict[str, Any]:
    """Returns non-binary, human-readable files (YAML, SQL, manifest.json, dbt.log) in the active or test workspace."""
    if _override_workspace_dir and _override_workspace_dir.exists():
        # Captures from the test override directory, filtering noise
        artifacts = artifact_store.capture_artifacts("override_test", _override_workspace_dir)
        return {
            "workspace_dir": str(_override_workspace_dir),
            "files": [a.model_dump() for a in artifacts],
        }

    # Default: returns all stored artifacts from the latest pipeline execution in server memory
    artifacts = artifact_store.get_latest_artifacts()
    return {
        "workspace_dir": ":memory:",
        "files": [a.model_dump() for a in artifacts],
    }
