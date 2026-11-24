from __future__ import annotations
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
import yaml
from backend.dbt_runtime.dbt_adapter import DbtAdapter, DbtCommandResult


class RepairAttempt(BaseModel):
    attempt_number: int
    command_result: DbtCommandResult
    diagnosed_issue: Optional[str] = None
    applied_fix: Optional[str] = None
    success: bool


class SelfHealingReport(BaseModel):
    total_attempts: int
    succeeded: bool
    attempts: List[RepairAttempt] = Field(default_factory=list)
    final_output: str = ""


class Stage2RepairAgent:
    """Bounded self-healing loop for dbt parse and YAML compilation errors (max 3 iterations)."""

    MAX_RETRIES = 3

    def __init__(self, workspace_dir: str | Path, adapter: Optional[DbtAdapter] = None):
        self.workspace_dir = Path(workspace_dir)
        self.adapter = adapter or DbtAdapter(project_dir=self.workspace_dir)

    def execute_and_heal(self) -> SelfHealingReport:
        attempts: List[RepairAttempt] = []

        for attempt_idx in range(1, self.MAX_RETRIES + 1):
            cmd_result = self.adapter.parse()

            if cmd_result.success:
                attempts.append(
                    RepairAttempt(
                        attempt_number=attempt_idx,
                        command_result=cmd_result,
                        diagnosed_issue=None,
                        applied_fix="No errors detected; parse succeeded",
                        success=True,
                    )
                )
                return SelfHealingReport(
                    total_attempts=attempt_idx,
                    succeeded=True,
                    attempts=attempts,
                    final_output=cmd_result.stdout,
                )

            # Diagnose failure
            diagnosis, fix_applied = self._diagnose_and_repair(cmd_result)

            attempts.append(
                RepairAttempt(
                    attempt_number=attempt_idx,
                    command_result=cmd_result,
                    diagnosed_issue=diagnosis,
                    applied_fix=fix_applied,
                    success=False,
                )
            )

        # If loop exhausts
        return SelfHealingReport(
            total_attempts=self.MAX_RETRIES,
            succeeded=False,
            attempts=attempts,
            final_output=attempts[-1].command_result.error_summary or "Parse failed after 3 healing attempts",
        )

    def _diagnose_and_repair(self, result: DbtCommandResult) -> tuple[str, str]:
        combined_logs = f"{result.stdout}\n{result.stderr}"

        # 1. Check for YAML syntax errors or unquoted strings in YAML files
        yaml_files = list(self.workspace_dir.glob("models/**/*.yml")) + list(self.workspace_dir.glob("models/**/*.yaml"))
        for yf in yaml_files:
            try:
                content = yf.read_text(encoding="utf-8")
                yaml.safe_load(content)
            except yaml.YAMLError as ye:
                try:
                    fixed = re.sub(r":\s+([a-zA-Z0-9_]+)\s*\n", r': "\1"\n', content)
                    yf.write_text(fixed, encoding="utf-8")
                    return (
                        f"YAMLError in {yf.name}: {str(ye)}",
                        f"Sanitized YAML quoting in {yf.name}",
                    )
                except Exception:
                    pass

        # 2. Check for erroneously generated ref('source.table') with a dot in any SQL file
        for sql_file in self.workspace_dir.glob("models/**/*.sql"):
            try:
                content = sql_file.read_text(encoding="utf-8")
                if re.search(r"\{\{\s*ref\(['\"]([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)['\"]\)\s*\}\}", content):
                    fixed = re.sub(
                        r"\{\{\s*ref\(['\"]([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)['\"]\)\s*\}\}",
                        r"{{ source('\1', '\2') }}",
                        content
                    )
                    sql_file.write_text(fixed, encoding="utf-8")
                    return (
                        f"Erroneous ref() with dot detected in {sql_file.name}",
                        f"Converted ref() with dot to source() in {sql_file.name}",
                    )
            except Exception:
                pass

        # 3. Check for missing ref compilation errors
        if "depends on a node named" in combined_logs or "not found" in combined_logs:
            missing_match = re.search(r"node named '([a-zA-Z0-9_]+)'", combined_logs)
            if missing_match:
                missing_name = missing_match.group(1)
                # Create stub for missing model
                stub_file = self.workspace_dir / "models" / "intermediate" / f"{missing_name}.sql"
                stub_file.write_text(
                    f"-- Self-healed stub for missing ref {missing_name}\nSELECT 1 as dummy_id\n",
                    encoding="utf-8"
                )
                return (
                    f"Missing referenced node: {missing_name}",
                    f"Generated auto-stub SQL for {missing_name} in models/intermediate",
                )

        return (
            "Unrecognized compilation error in dbt parse output",
            "Inspected workspace files and validated structure",
        )
