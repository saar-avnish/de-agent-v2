import pytest
from starlette.testclient import TestClient
from backend.main import app

client = TestClient(app)


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
        },
        "security_context": {
            "user_id": "test_lead",
            "role": "lead_engineer",
            "allowed_domains": ["sales"],
            "pii_clearance": True
        }
    }


def test_health_endpoint():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "HEALTHY"


def test_auth_session_creation():
    resp = client.post("/api/auth/session", json={
        "user_id": "engineer_bob",
        "role": "data_engineer",
        "allowed_domains": ["sales", "marketing"],
        "pii_clearance": True
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["user_id"] == "engineer_bob"
    assert data["role"] == "data_engineer"
    assert "sess_" in data["session_id"]


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
    assert len(report["stages"]) == 3
    assert report["stages"][0]["status"] == "PASSED"
    assert report["stages"][1]["status"] == "PASSED"
    assert report["stages"][2]["status"] == "PASSED"


def test_run_stages_endpoint_short_circuits_on_access_violation():
    payload = sample_payload()
    # Demote user to unauthorized role
    payload["security_context"]["role"] = "analyst"
    resp = client.post("/api/stages/run-to-stage-2", json=payload)
    assert resp.status_code == 200
    report = resp.json()
    assert report["success"] is False
    assert report["short_circuited"] is True
    # Stage 1 passed, Stage 1.5 failed, Stage 2 was not reached
    assert len(report["stages"]) == 2
    assert report["stages"][0]["status"] == "PASSED"
    assert report["stages"][1]["status"] == "FAILED"
