from __future__ import annotations
import re
from enum import Enum
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


IDENTIFIER_REGEX = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


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
    pii_type: Optional[str] = Field(default=None, description="PII category e.g. SSN, EMAIL, PHONE, FINANCIAL, PASSPORT, IP")
    data_tests: List[str] = Field(default_factory=list, description="dbt column data tests (e.g. unique, not_null)")
    quote: Optional[bool] = Field(default=None, description="Whether column name requires quotes")

    @field_validator("name")
    @classmethod
    def validate_column_identifier(cls, v: str) -> str:
        v = v.strip()
        if not IDENTIFIER_REGEX.match(v):
            raise ValueError(f"Column name '{v}' is not a valid SQL identifier (must match ^[a-zA-Z_][a-zA-Z0-9_]*$).")
        return v

    @model_validator(mode="after")
    def validate_pii_governance(self) -> ColumnSpec:
        if self.is_pii and (not self.pii_type or not self.pii_type.strip()):
            raise ValueError(
                f"PII Governance violation: Column '{self.name}' is flagged as is_pii=True but lacks mandatory pii_type classification (e.g., SSN, EMAIL, PHONE, FINANCIAL, PASSPORT, IP)."
            )
        return self


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
    row_count: int = Field(default=0, ge=0, description="Target row count, must be non-negative")
    is_time_series: bool = Field(default=False, description="Flag indicating time-series append/merge characteristics")
    grain: List[str] = Field(..., min_length=1, description="Kimball grain / natural primary keys")
    scd_type: Optional[ScdType] = Field(default=None, description="Slowly Changing Dimension type for dimensional models")
    dependencies: List[str] = Field(default_factory=list, description="Upstream dependencies (ref/source expressions)")
    columns: List[ColumnSpec] = Field(default_factory=list, description="Column level contracts and tests")
    tdd_fixtures: List[TddFixtureSpec] = Field(default_factory=list, description="Native dbt 1.8+ unit test fixtures")

    @field_validator("name")
    @classmethod
    def validate_model_identifier(cls, v: str) -> str:
        v = v.strip()
        if not IDENTIFIER_REGEX.match(v):
            raise ValueError(f"Model name '{v}' is not a valid SQL identifier (must match ^[a-zA-Z_][a-zA-Z0-9_]*$).")
        return v

    @model_validator(mode="after")
    def validate_medallion_prefix_and_kimball(self) -> ModelSpec:
        # Synchronize row_count and estimated_row_count if only one is specified
        if self.row_count != 0 and self.estimated_row_count == 0:
            self.estimated_row_count = self.row_count
        elif self.estimated_row_count != 0 and self.row_count == 0:
            self.row_count = self.estimated_row_count

        name = self.name.lower()
        layer_str = self.layer.value if isinstance(self.layer, ModelLayer) else str(self.layer).lower()

        # Enforce strict Medallion / Kimball naming conventions
        if layer_str == "staging":
            if not name.startswith("stg_"):
                raise ValueError(
                    f"Model prefix violation: Model '{self.name}' in layer '{layer_str}' must start with prefix 'stg_'."
                )
        elif layer_str == "intermediate":
            if not name.startswith("int_"):
                raise ValueError(
                    f"Model prefix violation: Model '{self.name}' in layer '{layer_str}' must start with prefix 'int_'."
                )
        elif layer_str == "mart":
            if not (name.startswith("dim_") or name.startswith("fct_")):
                raise ValueError(
                    f"Model prefix violation: Model '{self.name}' in layer '{layer_str}' must start with prefix 'dim_' or 'fct_'."
                )

        # Enforce SCD Type-2 metadata validation if specified
        if self.scd_type == ScdType.TYPE_2:
            existing_col_names = {c.name.lower() for c in self.columns}
            required_scd2_fields = ["valid_from", "valid_to", "is_current"]
            missing = [f for f in required_scd2_fields if f not in existing_col_names]
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

    @field_validator("name")
    @classmethod
    def validate_table_name(cls, v: str) -> str:
        v = v.strip()
        if not IDENTIFIER_REGEX.match(v):
            raise ValueError(f"Source table name '{v}' is not a valid SQL identifier.")
        return v


class SourceSpec(BaseModel):
    name: str = Field(..., min_length=1)
    schema_name: Optional[str] = None
    database: Optional[str] = None
    description: Optional[str] = None
    tables: List[SourceTableSpec] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def validate_source_name(cls, v: str) -> str:
        v = v.strip()
        if not IDENTIFIER_REGEX.match(v):
            raise ValueError(f"Source name '{v}' is not a valid SQL identifier.")
        return v


class PlannerContract(BaseModel):
    project_name: str = Field(default="de_agent_project", min_length=1)
    warehouse: str = Field(default="duckdb", description="Target warehouse adapter: duckdb, bigquery, snowflake")
    domain: str = Field(..., min_length=1)
    sources: List[SourceSpec] = Field(default_factory=list)
    models: List[ModelSpec] = Field(default_factory=list)

    @field_validator("project_name")
    @classmethod
    def validate_project_name(cls, v: str) -> str:
        v = v.strip()
        if not IDENTIFIER_REGEX.match(v):
            raise ValueError(f"Project name '{v}' is not a valid identifier.")
        return v
