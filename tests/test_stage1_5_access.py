import pytest
from backend.contracts.planner_schema import PlannerContract
from backend.security.access_gate import (
    AccessGate,
    SecurityContext,
    UserRole,
    AccessViolationType,
)


def sample_planner():
    return PlannerContract.model_validate({
        "project_name": "enterprise_dw",
        "warehouse": "duckdb",
        "domain": "sales",
        "sources": [],
        "models": [
            {
                "name": "stg_crm_orders",
                "layer": "staging",
                "domain": "sales",
                "estimated_row_count": 50000,
                "is_time_series": False,
                "grain": ["order_id"],
                "dependencies": [],
                "columns": [
                    {"name": "order_id", "data_type": "integer"},
                    {"name": "customer_ssn", "data_type": "varchar", "is_pii": True, "pii_type": "SSN"},
                ],
                "tdd_fixtures": []
            },
            {
                "name": "dim_customers",
                "layer": "mart",
                "domain": "marketing",
                "estimated_row_count": 10000,
                "is_time_series": False,
                "grain": ["customer_id"],
                "dependencies": ["ref('stg_crm_orders')"],
                "columns": [
                    {"name": "customer_id", "data_type": "integer"},
                ],
                "tdd_fixtures": []
            }
        ]
    })


def test_lead_engineer_with_full_clearance_passes():
    planner = sample_planner()
    sec_ctx = SecurityContext(
        user_id="lead_alice",
        role=UserRole.LEAD_ENGINEER,
        allowed_domains=["sales", "marketing"],
        pii_clearance=True,
    )
    gate = AccessGate()
    result = gate.evaluate(planner, sec_ctx)
    assert result.allowed is True
    assert len(result.violations) == 0


def test_unauthorized_role_rejected():
    planner = sample_planner()
    sec_ctx = SecurityContext(
        user_id="analyst_bob",
        role=UserRole.ANALYST,
        allowed_domains=["sales", "marketing"],
        pii_clearance=True,
    )
    gate = AccessGate()
    result = gate.evaluate(planner, sec_ctx)
    assert result.allowed is False
    assert any(v.violation_type == AccessViolationType.RBAC_UNAUTHORIZED for v in result.violations)


def test_domain_boundary_enforcement():
    planner = sample_planner()
    # User only has access to "finance", but planner touches "sales" and "marketing"
    sec_ctx = SecurityContext(
        user_id="dev_charlie",
        role=UserRole.DATA_ENGINEER,
        allowed_domains=["finance"],
        pii_clearance=True,
    )
    gate = AccessGate()
    result = gate.evaluate(planner, sec_ctx)
    assert result.allowed is False
    domain_violations = [v for v in result.violations if v.violation_type == AccessViolationType.DOMAIN_OUT_OF_SCOPE]
    assert len(domain_violations) >= 1
    assert "sales" in domain_violations[0].details or "marketing" in domain_violations[0].details


def test_pii_clearance_violation_when_unauthorized():
    planner = sample_planner()
    # User is data engineer with domain access, but pii_clearance is False while model contains customer_ssn (is_pii=True)
    sec_ctx = SecurityContext(
        user_id="dev_dave",
        role=UserRole.DATA_ENGINEER,
        allowed_domains=["sales", "marketing"],
        pii_clearance=False,
    )
    gate = AccessGate()
    result = gate.evaluate(planner, sec_ctx)
    assert result.allowed is False
    pii_violations = [v for v in result.violations if v.violation_type == AccessViolationType.PII_CLEARANCE_REQUIRED]
    assert len(pii_violations) >= 1
    assert "customer_ssn" in pii_violations[0].details


def test_admin_wildcard_domain_passes():
    planner = sample_planner()
    sec_ctx = SecurityContext(
        user_id="admin_root",
        role=UserRole.ADMIN,
        allowed_domains=["*"],
        pii_clearance=True,
    )
    gate = AccessGate()
    result = gate.evaluate(planner, sec_ctx)
    assert result.allowed is True
