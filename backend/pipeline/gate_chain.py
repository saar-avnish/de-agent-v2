from __future__ import annotations
import tempfile
import time
import uuid
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional, Dict, Any, List
from pydantic import BaseModel

from backend.contracts.planner_schema import PlannerContract
from backend.contracts.result_schema import ExecutionReport, StageTrace
from agent.analyzer.dag_sorter import DagSorter
from agent.analyzer.blast_radius import BlastRadiusAnalyzer
from agent.analyzer.dry_checker import DryGrainChecker
from agent.synthesizer.project_scaffolder import ProjectScaffolder
from backend.dbt_runtime.dbt_adapter import DbtAdapter
from agent.loop.stage2_repair_agent import Stage2RepairAgent
from backend.storage.artifact_store import artifact_store
from backend.storage.execution_store import execution_store


class PipelineContext(BaseModel):
    execution_id: str
    planner: Optional[PlannerContract] = None
    raw_planner: Optional[Dict[str, Any]] = None
    workspace_dir: str
    manifest_models: Optional[Dict[str, Any]] = None
    report: ExecutionReport


class GateHandler(ABC):
    """Abstract handler in the GoF Chain of Responsibility."""

    def __init__(self):
        self._next_handler: Optional[GateHandler] = None

    def set_next(self, handler: GateHandler) -> GateHandler:
        self._next_handler = handler
        return handler

    @abstractmethod
    def handle(self, ctx: PipelineContext) -> None:
        """Processes the stage gate. If failed, records trace and short-circuits."""
        pass

    def pass_to_next(self, ctx: PipelineContext) -> None:
        if not ctx.report.short_circuited and self._next_handler:
            self._next_handler.handle(ctx)


class ContractGateHandler(GateHandler):
    """Stage 1: Pydantic v2 input contract gate validating schemas, prefixes, Kimball rules, and PII governance."""

    def handle(self, ctx: PipelineContext) -> None:
        start_time = time.time()
        stage_trace = StageTrace(
            stage_name="Stage 1: Pydantic v2 Contract & PII Gate",
            status="RUNNING",
            success=False,
        )

        try:
            if ctx.planner is None:
                if ctx.raw_planner is None:
                    raise ValueError("No planner configuration provided to pipeline.")
                ctx.planner = PlannerContract.model_validate(ctx.raw_planner)

            # Summarize PII columns for governance compliance
            pii_columns = [
                {"model": m.name, "column": c.name, "pii_type": c.pii_type}
                for m in ctx.planner.models
                for c in m.columns
                if c.is_pii
            ]

            duration_ms = (time.time() - start_time) * 1000
            stage_trace.status = "PASSED"
            stage_trace.success = True
            stage_trace.duration_ms = round(duration_ms, 2)
            stage_trace.details = {
                "project_name": ctx.planner.project_name,
                "domain": ctx.planner.domain,
                "models_count": len(ctx.planner.models),
                "sources_count": len(ctx.planner.sources),
                "pii_columns_detected": len(pii_columns),
                "pii_governance": pii_columns,
            }
            ctx.report.stages.append(stage_trace)
            self.pass_to_next(ctx)

        except Exception as ex:
            duration_ms = (time.time() - start_time) * 1000
            stage_trace.status = "FAILED"
            stage_trace.success = False
            stage_trace.duration_ms = round(duration_ms, 2)
            stage_trace.errors = [str(ex)]
            ctx.report.stages.append(stage_trace)
            ctx.report.short_circuited = True
            ctx.report.success = False


class GraphAndDbtGateHandler(GateHandler):
    """Stage 2: Graph Analysis, GoF Strategy/Scaffold Synthesis, and Bounded Self-Healing dbt parse."""

    def __init__(self):
        super().__init__()
        self.dag_sorter = DagSorter()
        self.blast_analyzer = BlastRadiusAnalyzer()
        self.dry_checker = DryGrainChecker()

    def handle(self, ctx: PipelineContext) -> None:
        start_time = time.time()
        stage_trace = StageTrace(
            stage_name="Stage 2: Graph, Strategy & dbt Synthesis Gate",
            status="RUNNING",
            success=False,
        )

        try:
            planner = ctx.planner
            if not planner:
                raise ValueError("Stage 2 requires a valid PlannerContract from Stage 1.")

            # 1. Kahn's DAG Sorter & Cycle Detection
            topological_order = self.dag_sorter.sort(planner.models)

            # 2. Kimball DRY Grain Checking
            self.dry_checker.validate(planner.models)

            # 3. Blast Radius & Breaking Schema Check
            blast_report = self.blast_analyzer.evaluate(planner.models, ctx.manifest_models)

            # 4. Scaffolding & YAML / TDD Synthesis (delegated cleanly to ProjectScaffolder)
            scaffolder = ProjectScaffolder(workspace_dir=ctx.workspace_dir)
            scaffold_result = scaffolder.scaffold(planner)

            # 5. dbt parse validation & Bounded Self-Healing Loop
            adapter = DbtAdapter(project_dir=ctx.workspace_dir, profiles_dir=ctx.workspace_dir)
            repair_agent = Stage2RepairAgent(workspace_dir=ctx.workspace_dir, adapter=adapter)
            healing_report = repair_agent.execute_and_heal()

            duration_ms = (time.time() - start_time) * 1000

            if healing_report.succeeded:
                stage_trace.status = "PASSED"
                stage_trace.success = True
                stage_trace.duration_ms = round(duration_ms, 2)
                stage_trace.details = {
                    "topological_order": topological_order,
                    "scaffold_result": scaffold_result,
                    "blast_radius": blast_report.model_dump(),
                    "healing_attempts": healing_report.total_attempts,
                    "parse_output": healing_report.final_output,
                }
                ctx.report.artifacts = {
                    "workspace_dir": str(ctx.workspace_dir),
                    "created_files": scaffold_result["created_files"],
                    "topological_order": topological_order,
                }
                ctx.report.stages.append(stage_trace)
                ctx.report.success = True
                self.pass_to_next(ctx)
            else:
                stage_trace.status = "FAILED"
                stage_trace.success = False
                stage_trace.duration_ms = round(duration_ms, 2)
                stage_trace.errors = [healing_report.final_output]
                stage_trace.details = {
                    "healing_report": healing_report.model_dump()
                }
                ctx.report.stages.append(stage_trace)
                ctx.report.short_circuited = True
                ctx.report.success = False

        except Exception as ex:
            duration_ms = (time.time() - start_time) * 1000
            stage_trace.status = "FAILED"
            stage_trace.success = False
            stage_trace.duration_ms = round(duration_ms, 2)
            stage_trace.errors = [str(ex)]
            ctx.report.stages.append(stage_trace)
            ctx.report.short_circuited = True
            ctx.report.success = False


class GateChainPipeline:
    """Orchestrator linking Stage 1 -> Stage 2 in a clean GoF Chain of Responsibility."""

    def __init__(self, workspace_dir: Optional[str | Path] = None):
        self.workspace_dir = str(Path(workspace_dir).resolve()) if workspace_dir else None

    def run(
        self,
        planner: Optional[PlannerContract] = None,
        raw_planner: Optional[Dict[str, Any]] = None,
        manifest_models: Optional[Dict[str, Any]] = None,
    ) -> ExecutionReport:
        execution_id = f"exec_{uuid.uuid4().hex[:8]}"
        project_name = planner.project_name if planner else (raw_planner.get("project_name") if raw_planner else "unknown")

        report = ExecutionReport(
            execution_id=execution_id,
            project_name=project_name,
            success=False,
            short_circuited=False,
        )

        def _execute_in_sandbox(active_dir: str) -> ExecutionReport:
            ctx = PipelineContext(
                execution_id=execution_id,
                planner=planner,
                raw_planner=raw_planner,
                workspace_dir=active_dir,
                manifest_models=manifest_models,
                report=report,
            )

            # Build 2-Stage Chain: ContractGate -> GraphAndDbtGate
            contract_gate = ContractGateHandler()
            graph_dbt_gate = GraphAndDbtGateHandler()
            contract_gate.set_next(graph_dbt_gate)

            # Execute chain starting at Stage 1
            contract_gate.handle(ctx)

            # Capture all synthesized artifacts into artifact_store before sandbox teardown
            captured = artifact_store.capture_artifacts(execution_id, active_dir)
            ctx.report.artifacts["captured_count"] = len(captured)
            ctx.report.artifacts["captured_files"] = [c.path for c in captured]

            # Save report to server-side execution store
            execution_store.save(ctx.report)
            return ctx.report

        if self.workspace_dir:
            return _execute_in_sandbox(self.workspace_dir)
        else:
            with tempfile.TemporaryDirectory(prefix=f"de_agent_{execution_id}_") as temp_dir:
                return _execute_in_sandbox(temp_dir)
