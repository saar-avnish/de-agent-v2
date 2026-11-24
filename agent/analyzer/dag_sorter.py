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
    def extract_model_refs(cls, dependencies: List[str], known_source_tables: Optional[Set[str]] = None) -> Set[str]:
        refs = set()
        known_tables = known_source_tables or set()
        for dep in dependencies:
            matches = cls.REF_PATTERN.findall(dep)
            if matches:
                refs.update(matches)
            elif not dep.startswith("source(") and not dep.startswith("source (") and "." not in dep:
                cleaned = dep.strip("'\" \t")
                if cleaned and cleaned not in known_tables:
                    refs.add(cleaned)
        return refs

    @classmethod
    def extract_sources(cls, dependencies: List[str], known_source_map: Optional[Dict[str, str]] = None) -> Set[tuple[str, str]]:
        sources = set()
        for dep in dependencies:
            matches = cls.SOURCE_PATTERN.findall(dep)
            for m in matches:
                sources.add((m[0], m[1]))
            # Handle dotted dependencies e.g. "raw_aws_cur.line_items"
            if "." in dep and not matches and not dep.startswith("ref(") and not dep.startswith("ref ("):
                parts = [p.strip().strip("'\"") for p in dep.split(".", 1)]
                sources.add((parts[0], parts[1]))
            elif known_source_map and dep in known_source_map:
                sources.add((known_source_map[dep], dep))
        return sources

    def sort(
        self,
        models: List[ModelSpec],
        sources: Optional[List[SourceSpec]] = None,
        manifest_models: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        model_map = {m.name: m for m in models}
        known_sources = set()
        known_table_map: Dict[str, str] = {}
        if sources:
            for s in sources:
                for t in s.tables:
                    known_sources.add((s.name, t.name))
                    known_table_map[t.name] = s.name

        manifest_model_names = set(manifest_models.keys()) if manifest_models else set()
        known_source_tables = set(known_table_map.keys())

        # 1. Verify all ref() and source() dependencies
        for model in models:
            refs = self.extract_model_refs(model.dependencies, known_source_tables)
            for upstream_ref in refs:
                if upstream_ref not in model_map and upstream_ref not in manifest_model_names:
                    pass

            if known_sources:
                declared_sources = self.extract_sources(model.dependencies, known_table_map)
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
            refs = self.extract_model_refs(model.dependencies, known_source_tables)
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
            cycle_desc = " -> ".join(cyclic_nodes) + f" -> {cyclic_nodes[0]}"
            raise CycleDetectedError(
                f"Cyclical dependency detected in model DAG among nodes: {cyclic_nodes}. "
                f"Cycle path: {cycle_desc}."
            )

        return sorted_order
