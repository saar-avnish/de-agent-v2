from __future__ import annotations
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from datetime import datetime, timezone


def current_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class StageTrace(BaseModel):
    stage_name: str
    status: str = Field(description="PASSED, FAILED, or SKIPPED")
    success: bool
    started_at: str = Field(default_factory=current_utc_iso)
    completed_at: Optional[str] = None
    duration_ms: float = 0.0
    details: Dict[str, Any] = Field(default_factory=dict)
    errors: List[str] = Field(default_factory=list)


class ExecutionReport(BaseModel):
    execution_id: str
    project_name: str
    success: bool
    short_circuited: bool = False
    stages: List[StageTrace] = Field(default_factory=list)
    artifacts: Dict[str, Any] = Field(default_factory=dict)
    timestamp: str = Field(default_factory=current_utc_iso)
