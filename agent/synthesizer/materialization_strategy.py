from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Dict, Any
from backend.contracts.planner_schema import ModelSpec


class MaterializationStrategy(ABC):
    """GoF Strategy Pattern interface for dbt materialization configuration."""

    @property
    @abstractmethod
    def materialization_name(self) -> str:
        """Name of the dbt materialization (e.g. view, table, incremental)."""
        pass

    @abstractmethod
    def get_config(self, model: ModelSpec) -> Dict[str, Any]:
        """Returns the dbt configuration dictionary for this strategy."""
        pass


class ViewStrategy(MaterializationStrategy):
    """Strategy for small datasets (<100k rows) prioritizing zero storage overhead and fresh data."""

    @property
    def materialization_name(self) -> str:
        return "view"

    def get_config(self, model: ModelSpec) -> Dict[str, Any]:
        return {
            "materialized": "view"
        }


class TableStrategy(MaterializationStrategy):
    """Strategy for medium/large non-time-series datasets (>=100k rows) caching query computation."""

    @property
    def materialization_name(self) -> str:
        return "table"

    def get_config(self, model: ModelSpec) -> Dict[str, Any]:
        return {
            "materialized": "table"
        }


class IncrementalMergeStrategy(MaterializationStrategy):
    """Strategy for high-volume time-series datasets (>=1M rows) using Kimball mergeupserts."""

    @property
    def materialization_name(self) -> str:
        return "incremental"

    def get_config(self, model: ModelSpec) -> Dict[str, Any]:
        return {
            "materialized": "incremental",
            "incremental_strategy": "merge",
            "unique_key": model.grain,
            "on_schema_change": "append_new_columns",
        }


class MaterializationRouter:
    """Context router encapsulating threshold decision logic to select appropriate materialization strategy."""

    VIEW_THRESHOLD = 100_000
    INCREMENTAL_THRESHOLD = 1_000_000

    def resolve_strategy(self, model: ModelSpec) -> MaterializationStrategy:
        if model.estimated_row_count >= self.INCREMENTAL_THRESHOLD and model.is_time_series:
            return IncrementalMergeStrategy()
        elif model.estimated_row_count >= self.VIEW_THRESHOLD:
            return TableStrategy()
        else:
            return ViewStrategy()
