import pytest
from pathlib import Path
import yaml

from backend.contracts.planner_schema import (
    PlannerContract,
    ModelSpec,
    ColumnSpec,
    ModelLayer,
    TddFixtureSpec,
)
from backend.security.access_gate import SecurityContext, UserRole
from agent.analyzer.dag_sorter import DagSorter, CycleDetectedError
from agent.analyzer.blast_radius import BlastRadiusAnalyzer, BreakingChangeError
from agent.analyzer.dry_checker import DryGrainChecker, DuplicateGrainError
from agent.synthesizer.materialization_strategy import (
    MaterializationRouter,
    ViewStrategy,
    TableStrategy,
    IncrementalMergeStrategy,
)
from agent.synthesizer.yaml_builder import YamlBuilder
from agent.synthesizer.project_scaffolder import ProjectScaffolder
from backend.dbt_runtime.dbt_adapter import DbtAdapter
from agent.loop.stage2_repair_agent import Stage2RepairAgent
from backend.pipeline.gate_chain import GateChainPipeline


@pytest.fixture
def base_planner_data():
    return {
        "project_name": "ecommerce_pipeline",
        "warehouse": "duckdb",
        "domain": "sales",
        "sources": [
            {
                "name": "raw_crm",
                "schema_name": "raw_crm",
                "database": "analytics",
                "tables": [
                    {
                        "name": "orders",
                        "columns": [
                            {"name": "id", "data_type": "integer"},
                            {"name": "customer_id", "data_type": "integer"},
                            {"name": "order_date", "data_type": "date"},
                            {"name": "amount", "data_type": "numeric"},
                        ]
                    }
                ]
            }
        ],
        "models": [
            {
                "name": "stg_orders",
                "layer": "staging",
                "domain": "sales",
                "estimated_row_count": 45000,
                "is_time_series": False,
                "grain": ["order_id"],
                "dependencies": ["source('raw_crm', 'orders')"],
                "columns": [
                    {"name": "order_id", "data_type": "integer", "data_tests": ["unique", "not_null"]},
                    {"name": "customer_id", "data_type": "integer", "data_tests": ["not_null"]},
                    {"name": "amount", "data_type": "numeric"},
                ],
                "tdd_fixtures": [
                    {
                        "test_name": "test_stg_orders_sanitization",
                        "given": [
                            {
                                "input": "source('raw_crm', 'orders')",
                                "rows": [{"id": 1, "customer_id": 10, "order_date": "2026-01-01", "amount": 99.99}]
                            }
                        ],
                        "expect": {
                            "rows": [{"order_id": 1, "customer_id": 10, "amount": 99.99}]
                        }
                    }
                ]
            },
            {
                "name": "int_orders_enriched",
                "layer": "intermediate",
                "domain": "sales",
                "estimated_row_count": 150000,
                "is_time_series": False,
                "grain": ["order_id"],
                "dependencies": ["ref('stg_orders')"],
                "columns": [
                    {"name": "order_id", "data_type": "integer", "data_tests": ["unique", "not_null"]},
                    {"name": "customer_id", "data_type": "integer"},
                    {"name": "order_value_tier", "data_type": "varchar"},
                ],
                "tdd_fixtures": []
            },
            {
                "name": "fct_orders",
                "layer": "mart",
                "domain": "sales",
                "estimated_row_count": 2500000,
                "is_time_series": True,
                "grain": ["order_id"],
                "dependencies": ["ref('int_orders_enriched')"],
                "columns": [
                    {"name": "order_id", "data_type": "integer", "data_tests": ["unique", "not_null"]},
                    {"name": "customer_id", "data_type": "integer"},
                    {"name": "net_sales", "data_type": "numeric"},
                ],
                "tdd_fixtures": [
                    {
                        "test_name": "test_fct_orders_metric",
                        "given": [
                            {
                                "input": "ref('int_orders_enriched')",
                                "rows": [{"order_id": 1, "customer_id": 10, "order_value_tier": "HIGH"}]
                            }
                        ],
                        "expect": {
                            "rows": [{"order_id": 1, "customer_id": 10, "net_sales": 100.0}]
                        }
                    }
                ]
            }
        ]
    }


def test_dag_sorter_topological_order(base_planner_data):
    planner = PlannerContract.model_validate(base_planner_data)
    sorter = DagSorter()
    ordered_names = sorter.sort(planner.models)
    assert ordered_names == ["stg_orders", "int_orders_enriched", "fct_orders"]


def test_dag_sorter_detects_cycles(base_planner_data):
    # Introduce cycle: stg_orders depends on fct_orders, and fct_orders depends on stg_orders
    base_planner_data["models"][0]["dependencies"] = ["ref('fct_orders')"]
    planner = PlannerContract.model_validate(base_planner_data)
    sorter = DagSorter()
    with pytest.raises(CycleDetectedError) as exc:
        sorter.sort(planner.models)
    assert "cycle" in str(exc.value).lower()


def test_dry_grain_checker_detects_duplicate_grain(base_planner_data):
    # Add another mart fact model with the exact same domain, mart layer, and grain
    duplicate_fact = {
        "name": "fct_orders_duplicate",
        "layer": "mart",
        "domain": "sales",
        "estimated_row_count": 10000,
        "is_time_series": False,
        "grain": ["order_id"],
        "dependencies": ["ref('stg_orders')"],
        "columns": [
            {"name": "order_id", "data_type": "integer"},
        ],
        "tdd_fixtures": []
    }
    base_planner_data["models"].append(duplicate_fact)
    planner = PlannerContract.model_validate(base_planner_data)
    checker = DryGrainChecker()
    with pytest.raises(DuplicateGrainError) as exc:
        checker.validate(planner.models)
    assert "order_id" in str(exc.value)


def test_blast_radius_analyzer_flags_breaking_change_without_v2(base_planner_data):
    # Existing manifest model schema has columns: [order_id, customer_id, amount]
    manifest_models = {
        "stg_orders": {
            "columns": {
                "order_id": {"data_type": "integer"},
                "customer_id": {"data_type": "integer"},
                "amount": {"data_type": "numeric"},
                "legacy_column": {"data_type": "varchar"},  # Dropped in planner!
            }
        }
    }
    planner = PlannerContract.model_validate(base_planner_data)
    analyzer = BlastRadiusAnalyzer()
    
    # If legacy_column was dropped and model is still named 'stg_orders' (no _v2 suffix), it's a breaking change!
    with pytest.raises(BreakingChangeError) as exc:
        analyzer.evaluate(planner.models, manifest_models)
    assert "legacy_column" in str(exc.value)
    assert "_v2" in str(exc.value)


def test_blast_radius_analyzer_passes_when_v2_applied(base_planner_data):
    # If model is versioned with _v2, breaking change is permitted
    base_planner_data["models"][0]["name"] = "stg_orders_v2"
    manifest_models = {
        "stg_orders": {
            "columns": {
                "order_id": {"data_type": "integer"},
                "legacy_column": {"data_type": "varchar"},
            }
        }
    }
    planner = PlannerContract.model_validate(base_planner_data)
    analyzer = BlastRadiusAnalyzer()
    report = analyzer.evaluate(planner.models, manifest_models)
    assert report.is_breaking is True
    assert report.is_permitted_with_v2 is True


def test_materialization_strategy_routing(base_planner_data):
    planner = PlannerContract.model_validate(base_planner_data)
    router = MaterializationRouter()
    
    # 45k rows -> View
    strat_stg = router.resolve_strategy(planner.models[0])
    assert isinstance(strat_stg, ViewStrategy)
    assert strat_stg.materialization_name == "view"
    
    # 150k rows -> Table
    strat_int = router.resolve_strategy(planner.models[1])
    assert isinstance(strat_int, TableStrategy)
    assert strat_int.materialization_name == "table"
    
    # 2.5M rows + is_time_series -> IncrementalMerge
    strat_fct = router.resolve_strategy(planner.models[2])
    assert isinstance(strat_fct, IncrementalMergeStrategy)
    assert strat_fct.materialization_name == "incremental"
    cfg = strat_fct.get_config(planner.models[2])
    assert cfg["incremental_strategy"] == "merge"
    assert cfg["unique_key"] == ["order_id"]


def test_gof_yaml_builder_and_unit_tests_synthesis(base_planner_data, tmp_path):
    planner = PlannerContract.model_validate(base_planner_data)
    builder = YamlBuilder()
    
    # Build _sources.yml
    sources_yaml = builder.build_sources_yaml(planner.sources)
    sources_dict = yaml.safe_load(sources_yaml)
    assert sources_dict["version"] == 2
    assert sources_dict["sources"][0]["name"] == "raw_crm"
    
    # Build model properties and dbt 1.8+ unit_tests
    model_props_yaml = builder.build_model_properties_yaml(planner.models[0])
    props_dict = yaml.safe_load(model_props_yaml)
    assert props_dict["version"] == 2
    assert props_dict["models"][0]["name"] == "stg_orders"
    assert "unit_tests" in props_dict
    assert props_dict["unit_tests"][0]["name"] == "test_stg_orders_sanitization"
    assert props_dict["unit_tests"][0]["model"] == "stg_orders"
    assert props_dict["unit_tests"][0]["given"][0]["input"] == "source('raw_crm', 'orders')"


def test_scaffolder_and_dbt_adapter_validation(base_planner_data, tmp_path):
    planner = PlannerContract.model_validate(base_planner_data)
    workspace_dir = tmp_path / "test_dbt_workspace"
    scaffolder = ProjectScaffolder(workspace_dir=workspace_dir)
    scaffolder.scaffold(planner)
    
    # Verify dbt_project.yml and profiles.yml exist and parse cleanly
    assert (workspace_dir / "dbt_project.yml").exists()
    assert (workspace_dir / "profiles.yml").exists()
    
    # Verify models folders and synthesized YAML files exist
    stg_yaml = workspace_dir / "models" / "staging" / "_stg_orders_properties.yml"
    assert stg_yaml.exists()
    stg_content = yaml.safe_load(stg_yaml.read_text())
    assert stg_content["models"][0]["name"] == "stg_orders"
    
    # Run dbt parse via DbtAdapter
    adapter = DbtAdapter(project_dir=workspace_dir, profiles_dir=workspace_dir)
    parse_result = adapter.parse()
    assert parse_result.exit_code == 0
    assert parse_result.success is True


def test_gate_chain_pipeline_end_to_end(base_planner_data, tmp_path):
    planner = PlannerContract.model_validate(base_planner_data)
    sec_ctx = SecurityContext(
        user_id="lead_eng",
        role=UserRole.LEAD_ENGINEER,
        allowed_domains=["sales"],
        pii_clearance=True,
    )
    
    workspace_dir = tmp_path / "e2e_dbt_workspace"
    chain = GateChainPipeline(workspace_dir=workspace_dir)
    report = chain.run(planner, sec_ctx)
    
    assert report.success is True
    assert report.short_circuited is False
    assert len(report.stages) == 3
    assert report.stages[0].stage_name == "Stage 1: Contract Gate"
    assert report.stages[1].stage_name == "Stage 1.5: Access Gate"
    assert report.stages[2].stage_name == "Stage 2: Graph & dbt Synthesis Gate"
    assert report.stages[2].success is True
