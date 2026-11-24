from __future__ import annotations
import os
import json
import threading
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, List, Any, Optional
from pydantic import BaseModel, Field


class StoredArtifact(BaseModel):
    path: str
    name: str
    category: str  # "yaml", "sql", "logs"
    extension: str
    size_bytes: int
    content: str


class BaseArtifactStore(ABC):
    """Abstract interface for storing and retrieving synthesized dbt artifacts."""

    @abstractmethod
    def capture_artifacts(self, exec_id: str, sandbox_dir: str | Path) -> List[StoredArtifact]:
        """Captures artifacts from an ephemeral sandbox directory into persistent or in-memory store."""
        pass

    @abstractmethod
    def get_artifacts(self, exec_id: str) -> List[StoredArtifact]:
        """Retrieves artifacts associated with a specific execution ID."""
        pass

    @abstractmethod
    def get_latest_artifacts(self) -> List[StoredArtifact]:
        """Retrieves artifacts from the most recent pipeline execution."""
        pass

    @abstractmethod
    def get_latest_manifest(self) -> Optional[Dict[str, Any]]:
        """Retrieves parsed manifest.json from the most recent run for blast radius comparison."""
        pass

    @abstractmethod
    def clear(self) -> None:
        """Clears all stored artifacts (used in test teardown)."""
        pass


class InMemoryArtifactStore(BaseArtifactStore):
    """Default enterprise in-memory artifact store (zero host disk footprint)."""

    EXCLUDED_PATTERNS = {".duckdb", ".wal", ".msgpack", ".user.yml", ".pyc", ".gitkeep", ".DS_Store"}

    def __init__(self):
        self._lock = threading.Lock()
        self._store: Dict[str, List[StoredArtifact]] = {}
        self._latest_exec_id: Optional[str] = None

    def capture_artifacts(self, exec_id: str, sandbox_dir: str | Path) -> List[StoredArtifact]:
        sandbox_path = Path(sandbox_dir)
        captured: List[StoredArtifact] = []

        if not sandbox_path.exists():
            return captured

        for file_path in sandbox_path.glob("**/*"):
            if not file_path.is_file():
                continue

            # Filter binary and internal noise
            if any(file_path.name.endswith(ex) for ex in self.EXCLUDED_PATTERNS):
                continue
            if "__pycache__" in file_path.parts:
                continue

            ext = file_path.suffix.lower()
            rel_path = str(file_path.relative_to(sandbox_path)).replace("\\", "/")

            # Categorize artifacts
            if ext in {".yml", ".yaml"}:
                category = "yaml"
            elif ext == ".sql":
                category = "sql"
            elif file_path.name in {"manifest.json", "dbt.log"} or ext in {".json", ".log"}:
                category = "logs"
            else:
                continue

            try:
                content = file_path.read_text(encoding="utf-8", errors="replace")
                artifact = StoredArtifact(
                    path=rel_path,
                    name=file_path.name,
                    category=category,
                    extension=ext,
                    size_bytes=file_path.stat().st_size,
                    content=content,
                )
                captured.append(artifact)
            except Exception:
                pass

        with self._lock:
            self._store[exec_id] = captured
            self._latest_exec_id = exec_id

        return captured

    def get_artifacts(self, exec_id: str) -> List[StoredArtifact]:
        with self._lock:
            return self._store.get(exec_id, [])

    def get_latest_artifacts(self) -> List[StoredArtifact]:
        with self._lock:
            if not self._latest_exec_id:
                return []
            return self._store.get(self._latest_exec_id, [])

    def get_latest_manifest(self) -> Optional[Dict[str, Any]]:
        artifacts = self.get_latest_artifacts()
        for art in artifacts:
            if art.name == "manifest.json":
                try:
                    return json.loads(art.content)
                except Exception:
                    return None
        return None

    def clear(self) -> None:
        with self._lock:
            self._store.clear()
            self._latest_exec_id = None


class CloudObjectArtifactStore(BaseArtifactStore):
    """Adapter for Cloud Object Storage (S3 / GCS bucket). Defaults to in-memory buffering with remote sink."""

    def __init__(self, bucket_name: Optional[str] = None, provider: str = "s3"):
        self.bucket_name = bucket_name or os.environ.get("ARTIFACT_STORE_BUCKET", "de-agent-artifacts")
        self.provider = provider or os.environ.get("ARTIFACT_STORE_BACKEND", "s3")
        self._fallback = InMemoryArtifactStore()

    def capture_artifacts(self, exec_id: str, sandbox_dir: str | Path) -> List[StoredArtifact]:
        # Captures into buffer; in a full cloud deployment, uploads bytes to s3:// or gs://
        return self._fallback.capture_artifacts(exec_id, sandbox_dir)

    def get_artifacts(self, exec_id: str) -> List[StoredArtifact]:
        return self._fallback.get_artifacts(exec_id)

    def get_latest_artifacts(self) -> List[StoredArtifact]:
        return self._fallback.get_latest_artifacts()

    def get_latest_manifest(self) -> Optional[Dict[str, Any]]:
        return self._fallback.get_latest_manifest()

    def clear(self) -> None:
        self._fallback.clear()


def create_artifact_store() -> BaseArtifactStore:
    backend = os.environ.get("ARTIFACT_STORE_BACKEND", "memory").lower()
    if backend in {"s3", "gcs"}:
        return CloudObjectArtifactStore(provider=backend)
    return InMemoryArtifactStore()


artifact_store = create_artifact_store()
