from __future__ import annotations
import threading
from typing import Dict, List, Optional
from backend.contracts.result_schema import ExecutionReport


class ExecutionStore:
    """Thread-safe backend in-memory server state store for pipeline execution reports."""

    def __init__(self):
        self._lock = threading.Lock()
        self._executions: Dict[str, ExecutionReport] = {}
        self._execution_order: List[str] = []

    def save(self, report: ExecutionReport) -> ExecutionReport:
        with self._lock:
            self._executions[report.execution_id] = report
            if report.execution_id in self._execution_order:
                self._execution_order.remove(report.execution_id)
            self._execution_order.append(report.execution_id)
            return report

    def get_latest(self) -> Optional[ExecutionReport]:
        with self._lock:
            if not self._execution_order:
                return None
            latest_id = self._execution_order[-1]
            return self._executions.get(latest_id)

    def get(self, execution_id: str) -> Optional[ExecutionReport]:
        with self._lock:
            return self._executions.get(execution_id)

    def list_all(self) -> List[ExecutionReport]:
        with self._lock:
            return [self._executions[eid] for eid in reversed(self._execution_order)]

    def clear(self) -> None:
        with self._lock:
            self._executions.clear()
            self._execution_order.clear()


execution_store = ExecutionStore()
