# Data Engineering Agent (de-agent-v2) — Stage 2 Enterprise

An enterprise-grade, clean, modular Data Engineering Agent built from scratch strictly through **Stage 2**, adhering to **Gang of Four (GoF)** design patterns, **Kimball / Medallion Architecture**, and **Test-Driven Development (TDD)** standards.

---

## 🏛️ Decoupled Architectural Tiers

```text
de-agent-v2/
├── frontend/                       # React + TypeScript Developer Console (2-Page Workspace)
│   ├── src/pages/
│   │   ├── PlanStudioPage.tsx      # Page 1: planner.json visual builder/editor + dbt init trigger
│   │   └── GateMonitorPage.tsx     # Page 2: Stage 1 -> 2 stepper, GoF trace & categorized artifact viewer
│   ├── src/components/
│   │   └── Navbar.tsx              # Top navigation bar with live backend health & workspace badges
│   ├── src/services/
│   │   └── api.ts                  # Typed REST API client (stateless client-server sync)
│   └── src/types/
│       └── index.ts                # TypeScript domain models, contracts, and stage traces
├── backend/                        # FastAPI + Pydantic v2 + Chain of Responsibility + dbt CLI
│   ├── api/
│   │   └── routes.py               # Endpoints: /dbt/init, /stages/run-to-stage-2, /stages/executions/*
│   ├── pipeline/
│   │   └── gate_chain.py           # GoF Chain of Responsibility orchestrating Stage 1 -> 2
│   ├── contracts/
│   │   ├── planner_schema.py       # Stage 1: Pydantic v2 strict input contract + PII governance rules
│   │   └── result_schema.py        # Standardized ExecutionReport & StageTrace telemetry
│   ├── state/
│   │   └── execution_store.py      # Thread-safe server-side state registry for execution history
│   └── dbt_runtime/
│       └── dbt_adapter.py          # GoF Adapter running `dbt init`, `dbt debug`, and `dbt parse`
├── agent/                          # Graph Analyzers, GoF Builders & Bounded Self-Healer
│   ├── analyzer/
│   │   ├── dag_sorter.py           # Kahn's topological sort & cycle detector
│   │   ├── blast_radius.py         # Breaking schema change detector (_v2 enforcement)
│   │   └── dry_checker.py          # Duplicate Kimball grain detector against manifest.json
│   ├── synthesizer/
│   │   ├── materialization_strategy.py # GoF Strategy for view/table/incremental routing
│   │   ├── project_scaffolder.py   # Jinja2 + PyYAML generator for dbt_project.yml & profiles.yml
│   │   └── yaml_builder.py         # GoF Builder for _sources.yml, _properties.yml & dbt 1.8 unit_tests
│   └── loop/
│       └── stage2_repair_agent.py  # Bounded self-healing loop (max 3 retries) for dbt parse/YAML errors
├── dbt_workspace/                  # Isolated workspace bootstrapped via `dbt init`
├── tests/                          # TDD Stage-Gated Pytest Suites
│   ├── test_stage1_contract.py     # Stage 1 Pydantic v2 & Kimball/Medallion + PII tests
│   ├── test_stage2_dbt_agent.py    # Stage 2 Graph, GoF Synthesizers & dbt parse validation
│   └── test_api_endpoints.py       # FastAPI REST endpoints integration tests (tmp_path isolated)
└── requirements.txt                # Pinned production Python dependencies
```

---

## 🧩 Gang of Four (GoF) Data Engineering Patterns

| Pattern | Implementation File | Purpose & Responsibility |
|---|---|---|
| **Chain of Responsibility** | `backend/pipeline/gate_chain.py` | Chains `ContractGate` $\rightarrow$ `GraphAndDbtGate` as discrete, short-circuiting handlers returning a unified `ExecutionReport`. |
| **Strategy Pattern** | `agent/synthesizer/materialization_strategy.py` | Encapsulates statistical threshold routing: `ViewStrategy` (`<100k`), `TableStrategy` (`>=100k`), and `IncrementalMergeStrategy` (`>=1M` + time-series with Kimball merge unique_keys). |
| **Builder / Factory Pattern** | `agent/synthesizer/yaml_builder.py` | Separates construction of `_sources.yml`, `_<model>_properties.yml` (with Kimball dimension/fact contracts & `data_tests`), and dbt 1.8+ `unit_tests` (`given`/`expect` TDD fixtures) from serialization. |
| **Adapter Pattern** | `backend/dbt_runtime/dbt_adapter.py` | Decouples the agent from CLI subprocess invocation details and target warehouse profiles (`duckdb`, `bigquery`, `snowflake`, `databricks`). |

---

## 🛡️ Kimball & Medallion Governance + DataOps Guardrails

1. **Strict Layer Prefixes:**
   - Staging (Bronze): `stg_`
   - Intermediate (Silver): `int_`
   - Marts (Gold): `dim_` (Kimball dimensions) or `fct_` (Kimball facts)
2. **Kimball DRY Grain Checker:**
   - Analyzes model primary keys per domain to prevent duplicate grains from polluting marts.
3. **Blast Radius Breaking Change Analyzer:**
   - Compares proposed model columns against previous manifests. If backward-incompatible changes (e.g. dropped columns) are introduced, enforces `_v2` model suffixing.
4. **PII Governance:**
   - Enforces that any column marked `is_pii: true` must specify a valid classification (`pii_type`). Encodes PII metadata into model column properties.
5. **SCD Type-2 Support:**
   - Automatically validates and injects `valid_from`, `valid_to`, and `is_current` columns for dimensional models configured with `scd_type: type_2`.
6. **dbt 1.8+ Native Unit Tests:**
   - Synthesizes `unit_tests:` blocks with `model`, `given` mock inputs (`source()` and `ref()`), and `expect` output rows derived from planner `tdd_fixtures` before any SQL logic is written in Stage 3.
7. **Self-Healing Loop (`stage2_repair_agent.py`):**
   - Automatically intercepts compiler and YAML indentation errors, repairs stubs, and retries `dbt parse` up to a bounded maximum of 3 iterations.
8. **Compilation Guarantee:**
   - Every synthesized YAML file passes `yaml.safe_load()` and `dbt parse --project-dir dbt_workspace --profiles-dir dbt_workspace` with **exit code 0 and zero warnings**.

---

## 🧪 TDD Test Suites (100% Pass Rate)

Run the entire suite of 24 tests from the repository root:

```bash
cd de-agent-v2
python -m pytest -v
```

Output:
```text
tests/test_api_endpoints.py::test_health_endpoint PASSED                 [  4%]
tests/test_api_endpoints.py::test_dbt_init_endpoint PASSED               [  8%]
tests/test_api_endpoints.py::test_run_stages_endpoint_success PASSED     [ 12%]
tests/test_api_endpoints.py::test_run_stages_endpoint_short_circuits_on_invalid_contract PASSED [ 16%]
tests/test_api_endpoints.py::test_get_latest_execution PASSED            [ 20%]
tests/test_api_endpoints.py::test_get_execution_by_id PASSED             [ 25%]
tests/test_api_endpoints.py::test_workspace_files_filtering PASSED       [ 29%]
tests/test_stage1_contract.py::test_valid_planner_schema_parses_successfully PASSED [ 33%]
tests/test_stage1_contract.py::test_model_prefix_enforcement PASSED     [ 37%]
tests/test_stage1_contract.py::test_dim_fct_layer_prefix_enforcement PASSED [ 41%]
tests/test_stage1_contract.py::test_negative_row_count_rejected PASSED   [ 45%]
tests/test_stage1_contract.py::test_empty_grain_rejected PASSED          [ 50%]
tests/test_stage1_contract.py::test_scd_type_2_metadata_validation PASSED [ 54%]
tests/test_stage1_contract.py::test_pii_flag_and_classification PASSED   [ 58%]
tests/test_stage1_contract.py::test_pii_governance_missing_type_rejected PASSED [ 62%]
tests/test_stage2_dbt_agent.py::test_dag_sorter_topological_order PASSED [ 66%]
tests/test_stage2_dbt_agent.py::test_dag_sorter_detects_cycles PASSED    [ 70%]
tests/test_stage2_dbt_agent.py::test_dry_grain_checker_detects_duplicate_grain PASSED [ 75%]
tests/test_stage2_dbt_agent.py::test_blast_radius_analyzer_flags_breaking_change_without_v2 PASSED [ 79%]
tests/test_stage2_dbt_agent.py::test_blast_radius_analyzer_passes_when_v2_applied PASSED [ 83%]
tests/test_stage2_dbt_agent.py::test_materialization_strategy_routing PASSED [ 87%]
tests/test_stage2_dbt_agent.py::test_gof_yaml_builder_and_unit_tests_synthesis PASSED [ 91%]
tests/test_stage2_dbt_agent.py::test_scaffolder_and_dbt_adapter_validation PASSED [ 95%]
tests/test_stage2_dbt_agent.py::test_gate_chain_pipeline_end_to_end PASSED [100%]
======================= 24 passed in 56.48s =======================
```

---

## 🚀 Running Backend & Frontend

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Backend REST Gateway
```bash
cd de-agent-v2
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```
API docs available at: `http://127.0.0.1:8000/docs`

### 3. Frontend Developer Console
```bash
cd de-agent-v2/frontend
npm run build
npm run dev
```
Console UI available at: `http://localhost:3000`
