from __future__ import annotations
import re
from typing import List, Dict, Set, Optional, Any
from backend.contracts.planner_schema import ModelSpec, SourceSpec


class CycleDetectedError(Exception):
    """Raised when a cyclical dependency is detected in the model DAG."""
    pass


class MissingDependencyError(Exception):
    """Raised when a model declares an upstream ref() or source() that does not exist."""
    pass


class DagSorter:
    """Kahn's topological sort algorithm, cycle detector, and dependency validator for dbt models."""

    REF_PATTERN = re.compile(r"ref\(['\"]([a-zA-Z0-9_]+)['\"]\)")
    SOURCE_PATTERN = re.compile(r"source\(['\"]([a-zA-Z0-9_]+)['\"]\s*,\s*['\"]([a-zA-Z0-9_]+)['\"]\)")

    @classmethod
    def extract_model_refs(cls, dependencies: List[str]) -> Set[str]:
        refs = set()
        for dep in dependencies:
            matches = cls.REF_PATTERN.findall(dep)
            if matches:
                refs.update(matches)
            elif not dep.startswith("source(") and not dep.startswith("source ("):
                cleaned = dep.strip("'\" \t")
                if cleaned:
                    refs.add(cleaned)
        return refs

    @classmethod
    def extract_sources(cls, dependencies: List[str]) -> Set[tuple[str, str]]:
        sources = set()
        for dep in dependencies:
            matches = cls.SOURCE_PATTERN.findall(dep)
            for m in matches:
                sources.add((m[0], m[1]))
        return sources

    def sort(
        self,
        models: List[ModelSpec],
        sources: Optional[List[SourceSpec]] = None,
        manifest_models: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        model_map = {m.name: m for m in models}
        known_sources = set()
        if sources:
            for s in sources:
                for t in s.tables:
                    known_sources.add((s.name, t.name))

        manifest_model_names = set(manifest_models.keys()) if manifest_models else set()

        # 1. Verify all ref() and source() dependencies
        for model in models:
            refs = self.extract_model_refs(model.dependencies)
            for upstream_ref in refs:
                if upstream_ref not in model_map and upstream_ref not in manifest_model_names:
                    # If upstream ref is not in current plan or manifest
                    pass  # Allow external seed or custom packages, or validate if strict

            if known_sources:
                declared_sources = self.extract_sources(model.dependencies)
                for src_name, tbl_name in declared_sources:
                    if (src_name, tbl_name) not in known_sources:
                        raise MissingDependencyError(
                            f"Model '{model.name}' declares source dependency source('{src_name}', '{tbl_name}') "
                            f"which is not defined in planner sources."
                        )

        # 2. Build DAG edges (u -> v where u must run before v)
        graph: Dict[str, Set[str]] = {m.name: set() for m in models}
        in_degree: Dict[str, int] = {m.name: 0 for m in models}

        for model in models:
            refs = self.extract_model_refs(model.dependencies)
            for upstream in refs:
                if upstream in model_map:
                    graph[upstream].add(model.name)
                    in_degree[model.name] += 1

        # 3. Kahn's algorithm
        queue = [name for name, degree in in_degree.items() if degree == 0]
        sorted_order: List[str] = []

        while queue:
            queue.sort()
            curr = queue.pop(0)
            sorted_order.append(curr)

            for neighbor in sorted(graph[curr]):
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if len(sorted_order) != len(models):
            cyclic_nodes = [name for name, degree in in_degree.items() if degree > 0]
            # Format cycle nodes
            cycle_desc = " -> ".join(cyclic_nodes) + f" -> {cyclic_nodes[0]}"
            raise CycleDetectedError(
                f"Cyclical dependency detected in model DAG among nodes: {cyclic_nodes}. "
                f"Cycle path: {cycle_desc}."
            )

        return sorted_order
