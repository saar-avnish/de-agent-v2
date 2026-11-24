from __future__ import annotations
import os
import shutil
import re
import tempfile
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

        env = os.environ.copy()
        env["DBT_PROFILES_DIR"] = str(self.profiles_dir).replace("\\", "/")

        try:
            import subprocess
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                check=False,
                env=env,
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

    @classmethod
    def verify_runtime(cls, warehouse: str = "duckdb", project_name: str = "runtime_verify") -> DbtCommandResult:
        """Validates adapter connectivity inside an ephemeral OS temp directory that is destroyed immediately."""
        with tempfile.TemporaryDirectory(prefix="de_agent_runtime_verify_") as tmp_dir:
            tmp_path = Path(tmp_dir)

            # Scaffold minimal project and in-memory profile
            (tmp_path / "dbt_project.yml").write_text(
                f"name: '{project_name}'\nversion: '1.0.0'\nconfig-version: 2\nprofile: '{project_name}'\n",
                encoding="utf-8"
            )

            if warehouse == "duckdb":
                profile_body = f"{project_name}:\n  target: dev\n  outputs:\n    dev:\n      type: duckdb\n      path: ':memory:'\n"
            elif warehouse == "bigquery":
                profile_body = f"{project_name}:\n  target: dev\n  outputs:\n    dev:\n      type: bigquery\n      method: oauth\n      project: '{project_name}'\n      dataset: 'analytics'\n"
            elif warehouse == "snowflake":
                profile_body = f"{project_name}:\n  target: dev\n  outputs:\n    dev:\n      type: snowflake\n      account: 'test'\n      user: 'test'\n      password: 'test'\n      role: 'test'\n      database: 'test'\n      warehouse: 'test'\n      schema: 'public'\n"
            else:
                profile_body = f"{project_name}:\n  target: dev\n  outputs:\n    dev:\n      type: {warehouse}\n      path: ':memory:'\n"

            (tmp_path / "profiles.yml").write_text(profile_body, encoding="utf-8")
            (tmp_path / "models").mkdir(parents=True, exist_ok=True)

            adapter = cls(project_dir=tmp_path, profiles_dir=tmp_path)
            res = adapter.debug()
            return res
