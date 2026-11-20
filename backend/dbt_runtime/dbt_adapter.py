from __future__ import annotations
import subprocess
import shutil
import re
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel, Field


class DbtCommandResult(BaseModel):
    command: str
    exit_code: int
    stdout: str
    stderr: str
    success: bool
    error_summary: Optional[str] = None


class DbtAdapter:
    """GoF Adapter pattern decoupling the Agent and Pipeline from dbt CLI subprocess invocation."""

    ANSI_ESCAPE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")

    def __init__(self, project_dir: str | Path, profiles_dir: Optional[str | Path] = None):
        self.project_dir = Path(project_dir).resolve()
        self.profiles_dir = Path(profiles_dir or project_dir).resolve()

    def _strip_ansi(self, text: str) -> str:
        return self.ANSI_ESCAPE.sub("", text)

    def run_command(self, args: List[str], timeout_seconds: int = 60) -> DbtCommandResult:
        """Executes a dbt CLI command with project and profiles directory flags."""
        dbt_exe = shutil.which("dbt") or "dbt"
        cmd = [
            dbt_exe,
            "--no-use-colors",
            *args,
            "--project-dir",
            str(self.project_dir),
            "--profiles-dir",
            str(self.profiles_dir),
        ]

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                check=False,
            )
            stdout = self._strip_ansi(proc.stdout or "")
            stderr = self._strip_ansi(proc.stderr or "")
            exit_code = proc.returncode
            success = exit_code == 0

            error_summary = None
            if not success:
                error_summary = stderr.strip() or stdout.strip()

            return DbtCommandResult(
                command=" ".join(cmd),
                exit_code=exit_code,
                stdout=stdout,
                stderr=stderr,
                success=success,
                error_summary=error_summary,
            )
        except subprocess.TimeoutExpired:
            return DbtCommandResult(
                command=" ".join(cmd),
                exit_code=124,
                stdout="",
                stderr=f"Command timed out after {timeout_seconds} seconds",
                success=False,
                error_summary="Execution timed out",
            )
        except Exception as ex:
            return DbtCommandResult(
                command=" ".join(cmd),
                exit_code=1,
                stdout="",
                stderr=str(ex),
                success=False,
                error_summary=str(ex),
            )

    def parse(self) -> DbtCommandResult:
        """Runs `dbt parse` to validate all YAML models, schemas, and unit tests."""
        return self.run_command(["parse"])

    def debug(self) -> DbtCommandResult:
        """Runs `dbt debug` to validate adapter connectivity and warehouse profile."""
        return self.run_command(["debug"])
