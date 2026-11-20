from __future__ import annotations
import os
import re
from pathlib import Path
from typing import Dict, Any, Optional
import yaml
from jinja2 import Template
from backend.contracts.planner_schema import PlannerContract, ModelSpec, ModelLayer
from agent.synthesizer.yaml_builder import YamlBuilder


DBT_PROJECT_TEMPLATE = """
name: '{{ project_name }}'
version: '1.0.0'
config-version: 2
profile: '{{ project_name }}'

model-paths: ["models"]
analysis-paths: ["analyses"]
test-paths: ["tests"]
seed-paths: ["seeds"]
macro-paths: ["macros"]

target-path: "target"
clean-targets:
  - "target"
  - "dbt_packages"

models:
  {{ project_name }}:
    staging:
      +schema: staging
    intermediate:
      +schema: intermediate
    marts:
      +schema: marts
"""

PROFILES_TEMPLATE = """
{{ project_name }}:
  target: dev
  outputs:
    dev:
      type: {{ warehouse }}
      path: dev.duckdb
"""


class ProjectScaffolder:
    """Scaffolds complete dbt project workspace with Kimball/Medallion layers and dbt 1.8+ TDD skeletons."""

    def __init__(self, workspace_dir: str | Path, yaml_builder: Optional[YamlBuilder] = None):
        self.workspace_dir = Path(workspace_dir)
        self.yaml_builder = yaml_builder or YamlBuilder()

    def scaffold(self, planner: PlannerContract, clean_stale: bool = True) -> Dict[str, Any]:
        """Creates directory trees, configuration files, source definitions, model properties, and SQL skeletons."""
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

        staging_dir = self.workspace_dir / "models" / "staging"
        int_dir = self.workspace_dir / "models" / "intermediate"
        marts_dir = self.workspace_dir / "models" / "marts"
        seeds_dir = self.workspace_dir / "seeds"
        tests_dir = self.workspace_dir / "tests"
        macros_dir = self.workspace_dir / "macros"

        for d in [staging_dir, int_dir, marts_dir, seeds_dir, tests_dir, macros_dir]:
            d.mkdir(parents=True, exist_ok=True)

        # Clean stale models if clean_stale is enabled
        if clean_stale:
            active_models = {m.name for m in planner.models}
            for d in [staging_dir, int_dir, marts_dir]:
                for sql_file in d.glob("*.sql"):
                    if sql_file.stem not in active_models:
                        sql_file.unlink(missing_ok=True)
                for prop_file in d.glob("_*_properties.yml"):
                    # e.g. _stg_orders_properties.yml -> stg_orders
                    model_stem = prop_file.name[1:-len("_properties.yml")]
                    if model_stem not in active_models:
                        prop_file.unlink(missing_ok=True)

        # 1. Scaffold dbt_project.yml
        dbt_project_content = Template(DBT_PROJECT_TEMPLATE).render(
            project_name=planner.project_name
        ).strip()
        (self.workspace_dir / "dbt_project.yml").write_text(dbt_project_content, encoding="utf-8")

        # 2. Scaffold profiles.yml
        profiles_content = Template(PROFILES_TEMPLATE).render(
            project_name=planner.project_name,
            warehouse=planner.warehouse or "duckdb"
        ).strip()
        (self.workspace_dir / "profiles.yml").write_text(profiles_content, encoding="utf-8")

        created_files = [
            str(self.workspace_dir / "dbt_project.yml"),
            str(self.workspace_dir / "profiles.yml"),
        ]

        # 3. Scaffold _sources.yml in staging
        sources_path = staging_dir / "_sources.yml"
        if planner.sources:
            sources_yaml_content = self.yaml_builder.build_sources_yaml(planner.sources)
            sources_path.write_text(sources_yaml_content, encoding="utf-8")
            created_files.append(str(sources_path))
        else:
            sources_path.unlink(missing_ok=True)

        # 4. Scaffold model properties and TDD skeletons
        for model in planner.models:
            target_dir = staging_dir
            if model.layer == ModelLayer.INTERMEDIATE:
                target_dir = int_dir
            elif model.layer == ModelLayer.MART:
                target_dir = marts_dir

            props_yaml = self.yaml_builder.build_model_properties_yaml(model)
            props_file = target_dir / f"_{model.name}_properties.yml"
            props_file.write_text(props_yaml, encoding="utf-8")
            created_files.append(str(props_file))

            # Scaffold Stage 2 SQL stub so that `dbt parse` can compile the graph and validate unit tests
            sql_file = target_dir / f"{model.name}.sql"
            sql_stub = self._generate_sql_stub(model)
            sql_file.write_text(sql_stub, encoding="utf-8")
            created_files.append(str(sql_file))

        return {
            "workspace_dir": str(self.workspace_dir),
            "created_files": created_files,
            "models_count": len(planner.models),
        }

    def _generate_sql_stub(self, model: ModelSpec) -> str:
        """Generates minimal valid SQL stub resolving upstream refs/sources for compilation."""
        cols = [c.name for c in model.columns] if model.columns else ["*"]
        select_clause = ", ".join(cols) if cols != ["*"] else "*"

        if model.dependencies:
            primary_dep = model.dependencies[0]
            if "source(" in primary_dep or "ref(" in primary_dep:
                from_clause = f"{{{{ {primary_dep} }}}}"
            else:
                from_clause = f"{{{{ ref('{primary_dep}') }}}}"
        elif model.layer == ModelLayer.STAGING:
            from_clause = "(select 1 as dummy) as stg_dummy"
        else:
            from_clause = "(select 1 as dummy) as dummy"

        return f"-- Stage 2 TDD SQL Skeleton for {model.name}\nSELECT\n    {select_clause}\nFROM {from_clause}\n"
