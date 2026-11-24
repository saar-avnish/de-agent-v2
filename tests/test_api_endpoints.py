import pytest
from starlette.testclient import TestClient
from backend.main import app
from backend.api import routes

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_workspace(tmp_path):
    """Isolates the dbt workspace in a temporary folder during API tests to protect live dbt_workspace/."""
    ws = tmp_path / "api_test_workspace"
    ws.mkdir(parents=True, exist_ok=True)
    routes.set_workspace_dir(ws)
    yield ws
    routes.reset_workspace_dir()


def sample_payload():
    return {
        "planner": {
            "project_name": "api_test_dw",
            "warehouse": "duckdb",
            "domain": "sales",
            "sources": [
                {
                    "name": "raw_crm",
                    "tables": [
                        {
                            "name": "customers",
                            "columns": [{"name": "id", "data_type": "integer"}]
                        }
                    ]
                }
            ],
            "models": [
                {
                    "name": "stg_customers",
                    "layer": "staging",
                    "domain": "sales",
                    "estimated_row_count": 25000,
                    "is_time_series": False,
                    "grain": ["id"],
                    "dependencies": ["source('raw_crm', 'customers')"],
                    "columns": [
                        {"name": "id", "data_type": "integer", "data_tests": ["unique", "not_null"]}
                    ],
                    "tdd_fixtures": [
                        {
                            "test_name": "test_stg_customers_format",
                            "given": [
                                {
                                    "input": "source('raw_crm', 'customers')",
                                    "rows": [{"id": 1}]
                                }
                            ],
                            "expect": {
                                "rows": [{"id": 1}]
                            }
                        }
                    ]
                }
            ]
        }
    }


def test_health_endpoint():
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "HEALTHY"
    assert "Stage 1: Pydantic v2 Contract & PII Gate" in data["stages"]


def test_dbt_init_endpoint():
    resp = client.post("/api/dbt/init", json={
        "project_name": "test_init_dw",
        "warehouse": "duckdb"
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "INITIALIZED"


def test_run_stages_endpoint_success():
    payload = sample_payload()
    resp = client.post("/api/stages/run-to-stage-2", json=payload)
    assert resp.status_code == 200
    report = resp.json()
    assert report["success"] is True
    assert report["short_circuited"] is False
    assert len(report["stages"]) == 2
    assert report["stages"][0]["status"] == "PASSED"
    assert report["stages"][0]["stage_name"] == "Stage 1: Pydantic v2 Contract & PII Gate"
    assert report["stages"][1]["status"] == "PASSED"
    assert report["stages"][1]["stage_name"] == "Stage 2: Graph, Strategy & dbt Synthesis Gate"


def test_run_stages_endpoint_short_circuits_on_invalid_contract():
    payload = sample_payload()
    # Violate Medallion prefix rule
    payload["planner"]["models"][0]["name"] = "bad_prefix_customers"
    resp = client.post("/api/stages/run-to-stage-2", json=payload)
    assert resp.status_code == 200
    report = resp.json()
    assert report["success"] is False
    assert report["short_circuited"] is True
    assert len(report["stages"]) == 1
    assert report["stages"][0]["status"] == "FAILED"


def test_get_latest_execution():
    payload = sample_payload()
    run_resp = client.post("/api/stages/run-to-stage-2", json=payload)
    assert run_resp.status_code == 200
    exec_id = run_resp.json()["execution_id"]

    resp = client.get("/api/stages/executions/latest")
    assert resp.status_code == 200
    data = resp.json()
    assert data["execution_id"] == exec_id


def test_get_execution_by_id():
    payload = sample_payload()
    run_resp = client.post("/api/stages/run-to-stage-2", json=payload)
    exec_id = run_resp.json()["execution_id"]

    resp = client.get(f"/api/stages/executions/{exec_id}")
    assert resp.status_code == 200
    assert resp.json()["execution_id"] == exec_id


def test_workspace_files_filtering(isolate_workspace):
    # Create valid files and binary/excluded files
    (isolate_workspace / "models" / "staging").mkdir(parents=True, exist_ok=True)
    (isolate_workspace / "models" / "staging" / "stg_test.sql").write_text("SELECT 1", encoding="utf-8")
    (isolate_workspace / "models" / "staging" / "_properties.yml").write_text("version: 2", encoding="utf-8")
    (isolate_workspace / "dev.duckdb").write_bytes(b"\x00\x01\x02binary")
    (isolate_workspace / ".user.yml").write_text("internal", encoding="utf-8")

    resp = client.get("/api/stages/workspace-files")
    assert resp.status_code == 200
    files = resp.json()["files"]
    file_names = [f["name"] for f in files]

    assert "stg_test.sql" in file_names
    assert "_properties.yml" in file_names
    assert "dev.duckdb" not in file_names
    assert ".user.yml" not in file_names
