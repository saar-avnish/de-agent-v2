import React, { useState, useEffect } from 'react';
import { apiClient } from '../services/api';
import { RuntimeConfig } from '../types';

interface DbtInitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRuntimeUpdated?: (config: RuntimeConfig) => void;
}

export const DbtInitModal: React.FC<DbtInitModalProps> = ({
  isOpen,
  onClose,
  onRuntimeUpdated,
}) => {
  const [warehouse, setWarehouse] = useState<'duckdb' | 'bigquery' | 'snowflake'>('duckdb');
  const [projectName, setProjectName] = useState('enterprise_dw');
  const [artifactBackend, setArtifactBackend] = useState<'memory' | 's3'>('memory');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleInitialize = async () => {
    try {
      setLoading(true);
      setStatusMsg(null);
      const res = await apiClient.initDbtWorkspace(projectName, warehouse);
      setStatusMsg({
        type: 'success',
        text: `✓ ${res.message || 'dbt runtime verified and initialized.'}`,
      });

      const updatedConfig: RuntimeConfig = {
        project_name: projectName,
        warehouse,
        dialect_path: warehouse === 'duckdb' ? ':memory:' : warehouse,
        artifact_backend: artifactBackend,
        status: 'INITIALIZED',
        message: res.message,
      };

      if (onRuntimeUpdated) {
        onRuntimeUpdated(updatedConfig);
      }
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: `✗ Initialization failed: ${err.message}`,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dbt-init-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-content">
        <div className="modal-header">
          <div className="modal-title" id="dbt-init-title">
            <span>⚡ dbt Runtime &amp; Warehouse Setup</span>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1.25rem', lineHeight: 1.5 }}>
            Configure and verify the target data warehouse runtime. Sandboxes execute completely in-memory
            with zero persistent disk storage on your device.
          </p>

          <div className="form-group">
            <label className="form-label" htmlFor="warehouse-select">Analytics Warehouse Dialect</label>
            <select
              id="warehouse-select"
              className="form-select"
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value as any)}
            >
              <option value="duckdb">DuckDB (In-Memory :memory: • Zero Disk Footprint)</option>
              <option value="bigquery">Google BigQuery (Cloud Data Warehouse)</option>
              <option value="snowflake">Snowflake (Cloud Data Warehouse)</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="project-name-input">dbt Project Name</label>
            <input
              id="project-name-input"
              type="text"
              className="form-input"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. enterprise_dw"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="artifact-backend-select">Server-Side Artifact Storage</label>
            <select
              id="artifact-backend-select"
              className="form-select"
              value={artifactBackend}
              onChange={(e) => setArtifactBackend(e.target.value as any)}
            >
              <option value="memory">In-Memory Server Store (Stateless ephemeral RAM)</option>
              <option value="s3">Cloud Object Store Adapter (S3 / GCS)</option>
            </select>
          </div>

          {statusMsg && (
            <div
              style={{
                padding: '0.75rem',
                borderRadius: '0.375rem',
                marginTop: '1rem',
                fontSize: '0.825rem',
                backgroundColor:
                  statusMsg.type === 'success'
                    ? 'rgba(16, 185, 129, 0.15)'
                    : 'rgba(244, 63, 94, 0.15)',
                border: `1px solid ${
                  statusMsg.type === 'success'
                    ? 'rgba(16, 185, 129, 0.3)'
                    : 'rgba(244, 63, 94, 0.3)'
                }`,
                color: statusMsg.type === 'success' ? '#34d399' : '#fb7185',
              }}
            >
              {statusMsg.text}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleInitialize}
            disabled={loading || !projectName}
          >
            {loading ? 'Verifying Runtime...' : 'Initialize & Verify Runtime'}
          </button>
        </div>
      </div>
    </div>
  );
};
