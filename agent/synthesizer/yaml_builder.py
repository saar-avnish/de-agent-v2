from __future__ import annotations
from typing import List, Dict, Any, Optional
import yaml
from backend.contracts.planner_schema import (
    SourceSpec,
    ModelSpec,
    TddFixtureSpec,
    ColumnSpec,
)
from agent.synthesizer.materialization_strategy import MaterializationRouter


class IndentedDumper(yaml.SafeDumper):
    def increase_indent(self, flow=False, indentless=False):
        return super().increase_indent(flow, False)


class YamlBuilder:
    """GoF Builder / Factory constructing standardized dbt 1.8+ YAML specifications."""

    def __init__(self, router: Optional[MaterializationRouter] = None):
        self.router = router or MaterializationRouter()

    def build_sources_yaml(self, sources: List[SourceSpec]) -> str:
        """Constructs _sources.yml definition for staging layer raw inputs."""
        sources_list: List[Dict[str, Any]] = []

        for src in sources:
            src_entry: Dict[str, Any] = {
                "name": src.name,
                "description": src.description or f"Raw source {src.name} ingested for analytics.",
            }
            if src.schema_name:
                src_entry["schema"] = src.schema_name
            if src.database:
                src_entry["database"] = src.database

            tables_list: List[Dict[str, Any]] = []
            for tbl in src.tables:
                tbl_entry: Dict[str, Any] = {
                    "name": tbl.name,
                    "description": tbl.description or f"Source table {tbl.name}",
                }
                if tbl.columns:
                    col_entries: List[Dict[str, Any]] = []
                    for col in tbl.columns:
                        col_dict: Dict[str, Any] = {
                            "name": col.name,
                            "data_type": col.data_type,
                        }
                        if col.description:
                            col_dict["description"] = col.description
                        if col.data_tests:
                            col_dict["data_tests"] = col.data_tests
                        col_entries.append(col_dict)
                    tbl_entry["columns"] = col_entries
                tables_list.append(tbl_entry)

            src_entry["tables"] = tables_list
            sources_list.append(src_entry)

        payload = {
            "version": 2,
            "sources": sources_list
        }
        return yaml.dump(payload, Dumper=IndentedDumper, sort_keys=False, default_flow_style=False)

    def build_model_properties_yaml(self, model: ModelSpec) -> str:
        """Constructs model documentation, column contracts, data_tests, and dbt 1.8+ unit_tests."""
        strategy = self.router.resolve_strategy(model)
        config = strategy.get_config(model)

        # Build column contracts and data tests
        columns_data: List[Dict[str, Any]] = []
        for col in model.columns:
            col_dict: Dict[str, Any] = {
                "name": col.name,
                "data_type": col.data_type,
            }
            if col.description:
                col_dict["description"] = col.description
            if col.data_tests:
                col_dict["data_tests"] = col.data_tests
            columns_data.append(col_dict)

        model_entry: Dict[str, Any] = {
            "name": model.name,
            "description": f"Kimball {model.layer.value} model '{model.name}' serving domain '{model.domain}'.",
            "config": config,
            "columns": columns_data,
        }

        payload: Dict[str, Any] = {
            "version": 2,
            "models": [model_entry],
        }

        # Build dbt 1.8+ native unit tests if fixtures are present
        if model.tdd_fixtures:
            unit_tests_list: List[Dict[str, Any]] = []
            for fix in model.tdd_fixtures:
                ut_entry: Dict[str, Any] = {
                    "name": fix.test_name,
                    "model": model.name,
                    "given": [
                        {"input": g.input, "rows": g.rows}
                        for g in fix.given
                    ],
                    "expect": {
                        "rows": fix.expect.rows
                    }
                }
                if fix.description:
                    ut_entry["description"] = fix.description
                unit_tests_list.append(ut_entry)

            payload["unit_tests"] = unit_tests_list

        return yaml.dump(payload, Dumper=IndentedDumper, sort_keys=False, default_flow_style=False)
