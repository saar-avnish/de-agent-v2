# Data Engineering Agent (de-agent-v2) — Stage 2 Enterprise

An enterprise-grade, clean, modular Data Engineering Agent built from scratch strictly through **Stage 2**, adhering to **Gang of Four (GoF)** design patterns, **Kimball / Medallion Architecture**, and **Test-Driven Development (TDD)** standards.

---

## 🏛️ Decoupled Architectural Tiers

```text
de-agent-v2/
├── frontend/                       # React + TypeScript Developer Console
│   ├── src/pages/
│   │   ├── LoginAccessPage.tsx     # Page 1: User identity, role, domains & PII clearance setup
│   │   ├── PlanStudioPage.tsx      # Page 2: planner.json builder/editor + dbt init trigger
│   │   └── GateMonitorPage.tsx     # Page 3: Stage 1 -> 1.5 -> 2 stepper, GoF trace & YAML diff viewer
├── backend/                        # FastAPI + Pydantic v2 + Chain of Responsibility + dbt CLI
│   ├── api/
│   │   └── routes.py               # Endpoints: /auth/session, /dbt/init, /stages/run-to-stage-2
│   ├── pipeline/
│   │   └── gate_chain.py           # GoF Chain of Responsibility orchestrating Stage 1 -> 1.5 -> 2
│   ├── contracts/
│   │   ├── planner_schema.py       # Stage 1: Pydantic v2 strict input contract + TDD fixtures
│   │   └── result_schema.py        # Standardized ExecutionReport & StageTrace telemetry
│   ├── security/
│   │   └── access_gate.py          # Stage 1.5: RBAC, domain scoping & PII clearance gate
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
└── tests/                          # TDD Stage-Gated Pytest Suites
    ├── test_stage1_contract.py     # Stage 1 Pydantic v2 & Kimball/Medallion tests
    ├── test_stage1_5_access.py     # Stage 1.5 RBAC, Domain & PII clearance tests
    ├── test_stage2_dbt_agent.py    # Stage 2 Graph, GoF Synthesizers & dbt parse validation
    └── test_api_endpoints.py       # FastAPI REST endpoints integration tests
```

---

## 🧩 Gang of Four (GoF) Data Engineering Patterns

| Pattern | Implementation File | Purpose & Responsibility |
|---|---|---|
| **Chain of Responsibility** | `backend/pipeline/gate_chain.py` | Chains `ContractGate` $\rightarrow$ `AccessGate` $\rightarrow$ `GraphAndDbtGate` as discrete, short-circuiting handlers returning unified `ExecutionReport`. |
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
4. **SCD Type-2 Support:**
   - Automatically validates and injects `valid_from`, `valid_to`, and `is_current` columns for dimensional models configured with `scd_type: type_2`.
5. **dbt 1.8+ Native Unit Tests:**
   - Synthesizes `unit_tests:` blocks with `model`, `given` mock inputs (`source()` and `ref()`), and `expect` output rows derived from planner `tdd_fixtures` before any SQL logic is written in Stage 3.
6. **Self-Healing Loop (`stage2_repair_agent.py`):**
   - Automatically intercepts compiler and YAML indentation errors, repairs stubs, and retries `dbt parse` up to a bounded maximum of 3 iterations.
7. **Compilation Guarantee:**
   - Every synthesized YAML file passes `yaml.safe_load()` and `dbt parse --project-dir dbt_workspace` with exit code `0`.

---

## 🧪 TDD Test Suites (100% Pass Rate)

Run the entire suite of 26 tests from the root or `de-agent-v2` directory:

```bash
cd de-agent-v2
python -m pytest
```

Output:
```text
tests/test_api_endpoints.py .....                            [ 19%]
tests/test_stage1_5_access.py .....                          [ 38%]
tests/test_stage1_contract.py .......                        [ 65%]
tests/test_stage2_dbt_agent.py .........                     [100%]
======================= 26 passed in 30.69s =======================
```

---

## 🚀 Running Backend & Frontend

### 1. Backend REST Gateway
```bash
cd de-agent-v2
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```
API docs available at: `http://127.0.0.1:8000/docs`

### 2. Frontend Developer Console
```bash
cd de-agent-v2/frontend
npm install
npm run dev
```
Console UI available at: `http://localhost:3000`
