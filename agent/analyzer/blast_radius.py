from __future__ import annotations
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from backend.contracts.planner_schema import ModelSpec


class BreakingChangeError(Exception):
    """Raised when an unversioned breaking schema change is introduced."""
    pass


class SchemaChange(BaseModel):
    model_name: str
    change_type: str  # e.g., "COLUMN_DROPPED", "TYPE_ALTERED", "GRAIN_CHANGED"
    description: str


class BlastRadiusReport(BaseModel):
    is_breaking: bool = False
    is_permitted_with_v2: bool = False
    changes: List[SchemaChange] = Field(default_factory=list)


class BlastRadiusAnalyzer:
    """Analyzes schema drift against existing manifest to enforce backward-compatibility or _v2 versioning."""

    def evaluate(
        self,
        new_models: List[ModelSpec],
        manifest_models: Optional[Dict[str, Any]] = None
    ) -> BlastRadiusReport:
        if not manifest_models:
            return BlastRadiusReport(is_breaking=False, is_permitted_with_v2=False, changes=[])

        changes: List[SchemaChange] = []
        is_breaking = False
        is_permitted_with_v2 = False

        # Build mapping of new models and their base names (e.g., stg_orders_v2 -> stg_orders)
        for model in new_models:
            # Check direct match or base match
            base_name = model.name[:-3] if model.name.endswith("_v2") else model.name
            target_manifest = manifest_models.get(model.name) or manifest_models.get(base_name)

            if target_manifest:
                old_cols = target_manifest.get("columns", {})
                new_cols = {c.name: c for c in model.columns}

                dropped_cols = [c for c in old_cols if c not in new_cols]
                if dropped_cols:
                    is_breaking = True
                    for col in dropped_cols:
                        changes.append(
                            SchemaChange(
                                model_name=model.name,
                                change_type="COLUMN_DROPPED",
                                description=f"Column '{col}' was removed from previous schema."
                            )
                        )

                    # Check versioning enforcement
                    if model.name.endswith("_v2"):
                        is_permitted_with_v2 = True
                    else:
                        raise BreakingChangeError(
                            f"Breaking schema change in model '{model.name}': dropped columns {dropped_cols}. "
                            f"To prevent downstream breakage, you must version this model using '_v2' suffix."
                        )

        return BlastRadiusReport(
            is_breaking=is_breaking,
            is_permitted_with_v2=is_permitted_with_v2,
            changes=changes
        )
