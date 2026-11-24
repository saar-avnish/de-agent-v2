# Data Engineering Agent (de-agent-v2) — Stage 2 Enterprise

An enterprise-grade, clean, modular Data Engineering Agent built strictly through **Stage 2**, adhering to **Gang of Four (GoF)** design patterns, **Kimball / Medallion Architecture**, and **Test-Driven Development (TDD)** standards.

---

## 🔒 Enterprise Zero-Disk & Zero-Browser Storage Architecture

1. **Zero Personal Device Storage:**
   - No static `dbt_workspace/` directory or `.duckdb` files are ever persisted to the host machine's disk.
   - All dbt operations execute in context-managed ephemeral sandboxes (`tempfile.TemporaryDirectory`) that clean up OS temporary files immediately upon completion.
   - DuckDB operates with `path: ":memory:"` in `profiles.yml` for pure in-memory execution.
2. **Pluggable Server-Side Artifact & State Store (`backend/storage/`):**
   - Synthesized YAML models, TDD fixtures, SQL stubs, `manifest.json`, and `dbt.log` are captured into `BaseArtifactStore` (`InMemoryArtifactStore` default or `CloudObjectArtifactStore` for S3/GCS).
   - Execution reports, stage latencies, topological DAG order, and runtime configurations are tracked in thread-safe server state (`execution_store.py`).
3. **Zero Browser Storage:**
   - Strictly zero `localStorage` or `sessionStorage` in the React frontend.
   - The UI acts as a pure stateless view layer synchronized with the backend REST gateway.
4. **Modal-Only `dbt init`:**
   - Workspace initialization and dialect configuration (`duckdb :memory:`, `bigquery`, `snowflake`) are managed through an accessible modal dialog (`DbtInitModal.tsx`) launched from the top `Navbar`.

---

## 🏛️ Decoupled Architectural Tiers

```text
de-agent-v2/
├── frontend/                       # React + TypeScript Developer Console (2-Page Workspace)
│   ├── src/pages/
│   │   ├── PlanStudioPage.tsx      # Page 1: planner.json visual builder/editor & GoF strategy preview
│   │   └── GateMonitorPage.tsx     # Page 2: Stage 1 -> 2 stepper, GoF trace & categorized artifact viewer
│   ├── src/components/
│   │   ├── Navbar.tsx              # Top navigation bar with live backend health & runtime setup badge
│   │   └── DbtInitModal.tsx        # Modal dialog for warehouse dialect & server storage configuration
│   ├── src/services/
│   │   └── api.ts                  # Typed REST API client (stateless client-server sync)
│   └── src/types/
│       └── index.ts                # TypeScript domain models, contracts, and stage traces
├── backend/                        # FastAPI + Pydantic v2 + Chain of Responsibility + dbt CLI
│   ├── api/
│   │   └── routes.py               # Endpoints: /dbt/init, /dbt/runtime, /stages/run-to-stage-2, /stages/executions/*
│   ├── pipeline/
│   │   └── gate_chain.py           # GoF Chain of Responsibility orchestrating Stage 1 -> 2
│   ├── contracts/
│   │   ├── planner_schema.py       # Stage 1: Pydantic v2 strict input contract + PII governance rules
│   │   └── result_schema.py        # Standardized ExecutionReport & StageTrace telemetry
│   ├── storage/                    # Pluggable server-side storage tier
│   │   ├── artifact_store.py       # In-Memory & Cloud Object Storage adapters (zero disk noise)
│   │   └── execution_store.py      # Thread-safe server-side state registry for execution history
│   └── dbt_runtime/
│       └── dbt_adapter.py          # GoF Adapter running ephemeral `dbt debug` and `dbt parse`
├── agent/                          # Graph Analyzers, GoF Builders & Bounded Self-Healer
│   ├── analyzer/
│   │   ├── dag_sorter.py           # Kahn's topological sort & cycle detector
│   │   ├── blast_radius.py         # Breaking schema change detector (_v2 enforcement)
│   │   └── dry_checker.py          # Duplicate Kimball grain detector against manifest.json
│   ├── synthesizer/
│   │   ├── materialization_strategy.py # GoF Strategy for view/table/incremental routing
│   │   ├── project_scaffolder.py   # Jinja2 + PyYAML generator with in-memory DuckDB profiles
│   │   └── yaml_builder.py         # GoF Builder for _sources.yml, _properties.yml & dbt 1.8 unit_tests
│   └── loop/
│       └── stage2_repair_agent.py  # Bounded self-healing loop (max 3 retries) for dbt parse/YAML errors
├── tests/                          # TDD Stage-Gated Pytest Suites
│   ├── test_stage1_contract.py     # Stage 1 Pydantic v2 & Kimball/Medallion + PII tests
│   ├── test_stage2_dbt_agent.py    # Stage 2 Graph, GoF Synthesizers & dbt parse validation
│   └── test_api_endpoints.py       # FastAPI REST endpoints integration tests (zero disk validation)
└── requirements.txt                # Pinned production Python dependencies
```

---

## 🧩 Gang of Four (GoF) Data Engineering Patterns

| Pattern | Implementation File | Purpose & Responsibility |
|---|---|---|
| **Chain of Responsibility** | `backend/pipeline/gate_chain.py` | Chains `ContractGate` $\rightarrow$ `GraphAndDbtGate` as discrete, short-circuiting handlers returning a unified `ExecutionReport`. |
| **Strategy Pattern** | `agent/synthesizer/materialization_strategy.py` | Encapsulates statistical threshold routing: `ViewStrategy` (`<100k`), `TableStrategy` (`>=100k`), and `IncrementalMergeStrategy` (`>=1M` + time-series with Kimball merge unique_keys). |
| **Builder / Factory Pattern** | `agent/synthesizer/yaml_builder.py` | Separates construction of `_sources.yml`, `_<model>_properties.yml` (with Kimball dimension/fact contracts & `data_tests`), and dbt 1.8+ `unit_tests` (`given`/`expect` TDD fixtures) from serialization. |
| **Adapter Pattern** | `backend/dbt_runtime/dbt_adapter.py` & `backend/storage/artifact_store.py` | Decouples the agent from CLI subprocess invocation details and abstracts artifact persistence across in-memory and cloud object storage. |

---

## 🛡️ Kimball & Medallion Governance + DataOps Guardrails

1. **Strict Layer Prefixes:**
   - Staging (Bronze): `stg_`
   - Intermediate (Silver): `int_`
   - Marts (Gold): `dim_` (Kimball dimensions) or `fct_` (Kimball facts)
2. **Kimball DRY Grain Checker:**
   - Analyzes model primary keys per domain to prevent duplicate grains from polluting marts.
3. **Blast Radius Breaking Change Analyzer:**
   - Compares proposed model columns against previous manifests in `artifact_store`. If backward-incompatible changes (e.g. dropped columns) are introduced, enforces `_v2` model suffixing.
4. **PII Governance:**
   - Enforces that any column marked `is_pii: true` must specify a valid classification (`pii_type`). Encodes PII metadata into model column properties.
5. **SCD Type-2 Support:**
   - Automatically validates and injects `valid_from`, `valid_to`, and `is_current` columns for dimensional models configured with `scd_type: type_2`.
6. **dbt 1.8+ Native Unit Tests:**
   - Synthesizes `unit_tests:` blocks with `model`, `given` mock inputs (`source()` and `ref()`), and `expect` output rows derived from planner `tdd_fixtures` before any SQL logic is written in Stage 3.
7. **Self-Healing Loop (`stage2_repair_agent.py`):**
   - Automatically intercepts compiler and YAML indentation errors, repairs stubs, and retries `dbt parse` up to a bounded maximum of 3 iterations.
8. **Compilation Guarantee:**
   - Every synthesized YAML file passes `yaml.safe_load()` and `dbt parse` inside ephemeral sandboxes with **exit code 0 and zero warnings**.

---

## 🧪 TDD Test Suites (100% Pass Rate)

Run the full pytest suite from the repository root:

```bash
cd de-agent-v2
python -m pytest -v
```

All 27 integration and gate tests run cleanly in isolation without leaving artifacts or `.duckdb` files on disk.

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
