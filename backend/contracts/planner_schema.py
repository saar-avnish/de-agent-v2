from __future__ import annotations
from enum import Enum
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


class ModelLayer(str, Enum):
    STAGING = "staging"
    INTERMEDIATE = "intermediate"
    MART = "mart"


class ScdType(str, Enum):
    TYPE_0 = "type_0"
    TYPE_1 = "type_1"
    TYPE_2 = "type_2"


class ColumnSpec(BaseModel):
    name: str = Field(..., min_length=1, description="Column name")
    data_type: str = Field(default="varchar", description="Data warehouse data type")
    description: Optional[str] = Field(default=None, description="Column documentation")
    is_pii: bool = Field(default=False, description="Whether this column holds personally identifiable information")
    pii_type: Optional[str] = Field(default=None, description="PII category e.g. SSN, EMAIL, PHONE, IP")
    data_tests: List[str] = Field(default_factory=list, description="dbt column data tests (e.g. unique, not_null)")
    quote: Optional[bool] = Field(default=None, description="Whether column name requires quotes")


class TddFixtureGivenSpec(BaseModel):
    input: str = Field(..., description="Target upstream ref() or source() identifier")
    rows: List[Dict[str, Any]] = Field(default_factory=list, description="Mock input row tuples")


class TddFixtureExpectSpec(BaseModel):
    rows: List[Dict[str, Any]] = Field(default_factory=list, description="Expected calculated output row tuples")


class TddFixtureSpec(BaseModel):
    test_name: str = Field(..., min_length=1, description="Native dbt 1.8+ unit test name")
    description: Optional[str] = Field(default=None, description="Intent of unit test")
    given: List[TddFixtureGivenSpec] = Field(default_factory=list, description="Given inputs")
    expect: TddFixtureExpectSpec = Field(..., description="Expected output")


class ModelSpec(BaseModel):
    name: str = Field(..., min_length=1, description="Model identifier with mandatory medallion prefix")
    layer: ModelLayer = Field(..., description="Medallion layer: staging, intermediate, mart")
    domain: str = Field(..., min_length=1, description="Business domain e.g. sales, finance, marketing")
    estimated_row_count: int = Field(default=0, ge=0, description="Estimated target row count for materialization routing")
    is_time_series: bool = Field(default=False, description="Flag indicating time-series append/merge characteristics")
    grain: List[str] = Field(..., min_length=1, description="Kimball grain / natural primary keys")
    scd_type: Optional[ScdType] = Field(default=None, description="Slowly Changing Dimension type for dimensional models")
    dependencies: List[str] = Field(default_factory=list, description="Upstream dependencies (ref/source expressions)")
    columns: List[ColumnSpec] = Field(default_factory=list, description="Column level contracts and tests")
    tdd_fixtures: List[TddFixtureSpec] = Field(default_factory=list, description="Native dbt 1.8+ unit test fixtures")

    @field_validator("name")
    @classmethod
    def validate_name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Model name must not be empty.")
        return v

    @model_validator(mode="after")
    def validate_medallion_prefix_and_scd(self) -> ModelSpec:
        name = self.name.lower()
        layer = self.layer

        # Enforce Medallion / Kimball naming conventions
        if layer == ModelLayer.STAGING:
            if not name.startswith("stg_"):
                raise ValueError(
                    f"Model prefix violation: Staging model '{self.name}' must start with 'stg_'."
                )
        elif layer == ModelLayer.INTERMEDIATE:
            if not name.startswith("int_"):
                raise ValueError(
                    f"Model prefix violation: Intermediate model '{self.name}' must start with 'int_'."
                )
        elif layer == ModelLayer.MART:
            if not (name.startswith("dim_") or name.startswith("fct_")):
                raise ValueError(
                    f"Model prefix violation: Mart model '{self.name}' must start with 'dim_' (Kimball dimension) or 'fct_' (Kimball fact)."
                )

        # Enforce SCD Type-2 metadata validation if specified
        if self.scd_type == ScdType.TYPE_2:
            existing_col_names = {c.name.lower() for c in self.columns}
            required_scd2_fields = ["valid_from", "valid_to", "is_current"]
            missing = [f for f in required_scd2_fields if f not in existing_col_names]
            # If missing, automatically append them so contracts are enterprise-grade and complete
            for f in missing:
                if f in ["valid_from", "valid_to"]:
                    self.columns.append(ColumnSpec(name=f, data_type="timestamp", description=f"SCD2 {f} timestamp"))
                elif f == "is_current":
                    self.columns.append(ColumnSpec(name=f, data_type="boolean", description="SCD2 current record indicator"))

        return self


class SourceTableSpec(BaseModel):
    name: str = Field(..., min_length=1)
    description: Optional[str] = None
    columns: List[ColumnSpec] = Field(default_factory=list)


class SourceSpec(BaseModel):
    name: str = Field(..., min_length=1)
    schema_name: Optional[str] = None
    database: Optional[str] = None
    description: Optional[str] = None
    tables: List[SourceTableSpec] = Field(default_factory=list)


class PlannerContract(BaseModel):
    project_name: str = Field(default="de_agent_project", min_length=1)
    warehouse: str = Field(default="duckdb", description="Target warehouse adapter: duckdb, bigquery, snowflake, databricks")
    domain: str = Field(..., min_length=1)
    sources: List[SourceSpec] = Field(default_factory=list)
    models: List[ModelSpec] = Field(default_factory=list)
