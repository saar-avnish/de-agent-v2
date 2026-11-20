from __future__ import annotations
from typing import List, Dict, Tuple
from backend.contracts.planner_schema import ModelSpec, ModelLayer


class DuplicateGrainError(Exception):
    """Raised when duplicate Kimball grains are defined within the same domain and mart layer."""
    pass


class DryGrainChecker:
    """Kimball DRY grain detector enforcing unique fact and dimension grains per business domain."""

    def validate(self, models: List[ModelSpec]) -> None:
        # Group models by (domain, layer, grain)
        grain_registry: Dict[Tuple[str, str, Tuple[str, ...]], str] = {}

        for model in models:
            # We strictly enforce DRY grains in Mart layers (facts and dimensions)
            if model.layer == ModelLayer.MART:
                normalized_grain = tuple(sorted(g.lower() for g in model.grain))
                key = (model.domain.lower(), model.layer.value, normalized_grain)

                if key in grain_registry:
                    existing_model = grain_registry[key]
                    raise DuplicateGrainError(
                        f"Duplicate Kimball grain violation: Model '{model.name}' shares identical grain "
                        f"{list(normalized_grain)} with existing model '{existing_model}' in domain '{model.domain}'. "
                        f"Refine grain definition or consolidate dimensional entities."
                    )
                grain_registry[key] = model.name
