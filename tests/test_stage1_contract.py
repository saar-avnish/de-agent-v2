import pytest
from pydantic import ValidationError
from backend.contracts.planner_schema import (
    PlannerContract,
    ModelSpec,
    ColumnSpec,
    SourceSpec,
    SourceTableSpec,
    TddFixtureSpec,
    ModelLayer,
    ScdType,
)


def sample_valid_planner_dict():
    return {
        "project_name": "enterprise_dw",
        "warehouse": "duckdb",
        "domain": "sales",
        "sources": [
            {
                "name": "raw_crm",
                "schema_name": "crm_source",
                "database": "analytics",
                "tables": [
                    {
                        "name": "crm_orders",
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
                "name": "stg_crm_orders",
                "layer": "staging",
                "domain": "sales",
                "estimated_row_count": 50000,
                "is_time_series": False,
                "grain": ["order_id"],
                "dependencies": ["source('raw_crm', 'crm_orders')"],
                "columns": [
                    {
                        "name": "order_id",
                        "data_type": "integer",
                        "description": "Primary key for staging orders",
                        "data_tests": ["unique", "not_null"],
                    },
                    {
                        "name": "customer_id",
                        "data_type": "integer",
                        "description": "Customer foreign key",
                        "data_tests": ["not_null"],
                    },
                    {
                        "name": "amount",
                        "data_type": "numeric",
                        "description": "Order transaction amount",
                    }
                ],
                "tdd_fixtures": [
                    {
                        "test_name": "test_stg_crm_orders_cleaning",
                        "description": "Ensure null IDs are rejected and columns normalized",
                        "given": [
                            {
                                "input": "source('raw_crm', 'crm_orders')",
                                "rows": [
                                    {"id": 1, "customer_id": 101, "order_date": "2026-01-01", "amount": 150.50}
                                ]
                            }
                        ],
                        "expect": {
                            "rows": [
                                {"order_id": 1, "customer_id": 101, "amount": 150.50}
                            ]
                        }
                    }
                ]
            },
            {
                "name": "fct_orders",
                "layer": "mart",
                "domain": "sales",
                "estimated_row_count": 1200000,
                "is_time_series": True,
                "grain": ["order_id"],
                "dependencies": ["ref('stg_crm_orders')"],
                "columns": [
                    {
                        "name": "order_id",
                        "data_type": "integer",
                        "description": "Fact order surrogate/natural key",
                        "data_tests": ["unique", "not_null"],
                    },
                    {
                        "name": "customer_id",
                        "data_type": "integer",
                        "description": "Customer dimension key",
                    },
                    {
                        "name": "total_amount",
                        "data_type": "numeric",
                        "description": "Order value in base currency",
                    }
                ],
                "tdd_fixtures": [
                    {
                        "test_name": "test_fct_orders_calculation",
                        "given": [
                            {
                                "input": "ref('stg_crm_orders')",
                                "rows": [
                                    {"order_id": 1, "customer_id": 101, "amount": 150.50}
                                ]
                            }
                        ],
                        "expect": {
                            "rows": [
                                {"order_id": 1, "customer_id": 101, "total_amount": 150.50}
                            ]
                        }
                    }
                ]
            }
        ]
    }


def test_valid_planner_schema_parses_successfully():
    data = sample_valid_planner_dict()
    contract = PlannerContract.model_validate(data)
    assert contract.project_name == "enterprise_dw"
    assert len(contract.models) == 2
    assert contract.models[0].name == "stg_crm_orders"
    assert contract.models[1].layer == ModelLayer.MART


def test_model_prefix_enforcement():
    data = sample_valid_planner_dict()
    data["models"][0]["name"] = "crm_orders_bad_prefix"
    with pytest.raises(ValidationError) as exc:
        PlannerContract.model_validate(data)
    assert "prefix" in str(exc.value).lower()


def test_dim_fct_layer_prefix_enforcement():
    data = sample_valid_planner_dict()
    data["models"][1]["name"] = "orders_mart"
    with pytest.raises(ValidationError) as exc:
        PlannerContract.model_validate(data)
    assert "dim_" in str(exc.value) or "fct_" in str(exc.value)


def test_negative_row_count_rejected():
    data = sample_valid_planner_dict()
    data["models"][0]["estimated_row_count"] = -100
    with pytest.raises(ValidationError) as exc:
        PlannerContract.model_validate(data)
    assert "greater_than_equal" in str(exc.value) or "row count" in str(exc.value).lower()


def test_empty_grain_rejected():
    data = sample_valid_planner_dict()
    data["models"][0]["grain"] = []
    with pytest.raises(ValidationError) as exc:
        PlannerContract.model_validate(data)
    assert "grain" in str(exc.value).lower()


def test_scd_type_2_metadata_validation():
    data = sample_valid_planner_dict()
    dim_customer = {
        "name": "dim_customers",
        "layer": "mart",
        "domain": "sales",
        "estimated_row_count": 25000,
        "is_time_series": False,
        "grain": ["customer_id"],
        "scd_type": "type_2",
        "dependencies": ["ref('stg_crm_orders')"],
        "columns": [
            {"name": "customer_id", "data_type": "integer", "data_tests": ["unique", "not_null"]},
            {"name": "valid_from", "data_type": "timestamp"},
            {"name": "valid_to", "data_type": "timestamp"},
            {"name": "is_current", "data_type": "boolean"},
        ],
        "tdd_fixtures": []
    }
    data["models"].append(dim_customer)
    contract = PlannerContract.model_validate(data)
    dim_model = next(m for m in contract.models if m.name == "dim_customers")
    assert dim_model.scd_type == ScdType.TYPE_2
    assert "valid_from" in [c.name for c in dim_model.columns]


def test_pii_flag_and_classification():
    col = ColumnSpec(
        name="customer_ssn",
        data_type="varchar",
        is_pii=True,
        pii_type="SSN",
        description="Encrypted social security number"
    )
    assert col.is_pii is True
    assert col.pii_type == "SSN"


def test_pii_governance_missing_type_rejected():
    with pytest.raises(ValidationError) as exc:
        ColumnSpec(
            name="customer_ssn",
            data_type="varchar",
            is_pii=True,
            pii_type=None,
        )
    assert "pii_type" in str(exc.value).lower()
