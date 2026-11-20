from __future__ import annotations
import re
from typing import List, Dict, Set
from backend.contracts.planner_schema import ModelSpec


class CycleDetectedError(Exception):
    """Raised when a cyclical dependency is detected in the model DAG."""
    pass


class DagSorter:
    """Kahn's topological sort algorithm and cycle detector for dbt models."""

    REF_PATTERN = re.compile(r"ref\(['\"]([a-zA-Z0-9_]+)['\"]\)")

    @classmethod
    def extract_model_refs(cls, dependencies: List[str]) -> Set[str]:
        refs = set()
        for dep in dependencies:
            matches = cls.REF_PATTERN.findall(dep)
            if matches:
                refs.update(matches)
            elif not dep.startswith("source(") and not dep.startswith("source ("):
                # If it's a direct model name reference
                cleaned = dep.strip("'\" \t")
                if cleaned:
                    refs.add(cleaned)
        return refs

    def sort(self, models: List[ModelSpec]) -> List[str]:
        model_map = {m.name: m for m in models}
        graph: Dict[str, Set[str]] = {m.name: set() for m in models}
        in_degree: Dict[str, int] = {m.name: 0 for m in models}

        # Build DAG edges (u -> v where u must run before v)
        for model in models:
            refs = self.extract_model_refs(model.dependencies)
            for upstream in refs:
                if upstream in model_map:
                    graph[upstream].add(model.name)
                    in_degree[model.name] += 1

        # Kahn's algorithm
        queue = [name for name, degree in in_degree.items() if degree == 0]
        sorted_order: List[str] = []

        while queue:
            # Deterministic ordering by name for reproducible pipelines
            queue.sort()
            curr = queue.pop(0)
            sorted_order.append(curr)

            for neighbor in sorted(graph[curr]):
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if len(sorted_order) != len(models):
            cyclic_nodes = [name for name, degree in in_degree.items() if degree > 0]
            raise CycleDetectedError(
                f"Dependency cycle detected among models: {cyclic_nodes}. "
                f"Verify ref() relationships to break cyclical dependencies."
            )

        return sorted_order
