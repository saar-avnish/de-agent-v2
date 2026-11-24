import React, { useEffect, useState } from 'react';
import { ExecutionReport, WorkspaceFile } from '../types';
import { apiClient } from '../services/api';

interface GateMonitorPageProps {
  report: ExecutionReport | null;
  setReport: (r: ExecutionReport) => void;
  onBackToStudio: () => void;
}

export const GateMonitorPage: React.FC<GateMonitorPageProps> = ({
  report,
  setReport,
  onBackToStudio,
}) => {
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeCategory, setActiveCategory] = useState<'all' | 'yaml' | 'sql' | 'logs'>('all');

  useEffect(() => {
    // If no report in memory, fetch the latest execution from backend server state
    if (!report) {
      apiClient.getLatestExecution()
        .then((latest) => setReport(latest))
        .catch(() => {
          // No prior execution recorded
        });
    }
    fetchFiles();
  }, [report?.execution_id]);

  const fetchFiles = async () => {
    try {
      setLoadingFiles(true);
      const res = await apiClient.getWorkspaceFiles();
      setWorkspaceFiles(res.files || []);
      if (res.files && res.files.length > 0) {
        // Keep current selected file if still exists, or default to first
        setSelectedFile((prev) => {
          if (prev && res.files.some((f) => f.path === prev.path)) {
            return res.files.find((f) => f.path === prev.path) || res.files[0];
          }
          return res.files[0];
        });
      }
    } catch (e) {
      console.error('Failed to fetch workspace files', e);
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleCopy = () => {
    if (!selectedFile) return;
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Group files into 3 categorized buckets
  const filterFiles = () => {
    if (activeCategory === 'yaml') {
      return workspaceFiles.filter(
        (f) => f.category === 'yaml' || f.extension === '.yml' || f.extension === '.yaml'
      );
    }
    if (activeCategory === 'sql') {
      return workspaceFiles.filter(
        (f) => f.category === 'sql' || f.extension === '.sql'
      );
    }
    if (activeCategory === 'logs') {
      return workspaceFiles.filter(
        (f) =>
          f.category === 'logs' ||
          f.name === 'manifest.json' ||
          f.name === 'dbt.log' ||
          f.extension === '.log' ||
          f.extension === '.json'
      );
    }
    return workspaceFiles;
  };

  const filteredFiles = filterFiles();

  if (!report) {
    return (
      <div className="page-content">
        <div className="card" style={{ textAlign: 'center', padding: '3.5rem' }}>
          <h2 style={{ marginBottom: '1rem', color: '#f8fafc' }}>No Pipeline Executions Recorded</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', maxWidth: '500px', margin: '0 auto 1.5rem auto' }}>
            Configure your data engineering contract in Plan Studio and click "Run Validation &amp; Synthesis" to trigger the automated 2-Stage gate pipeline.
          </p>
          <button className="btn btn-primary" onClick={onBackToStudio}>
            &larr; Go to Plan Studio
          </button>
        </div>
      </div>
    );
  }

  const stage1 = report.stages.find((s) => s.stage_name.includes('Stage 1:'));
  const stage2 = report.stages.find((s) => s.stage_name.includes('Stage 2:'));
  const stage1Status = stage1 ? stage1.status : 'SKIPPED';
  const stage2Status = stage2 ? stage2.status : (report.short_circuited ? 'SKIPPED' : 'PENDING');

  const totalDurationMs = report.stages.reduce((acc, s) => acc + (s.duration_ms || 0), 0);

  return (
    <div className="page-content">
      {/* Top Header Bar */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <h1 className="page-title" style={{ margin: 0 }}>Gate Observability &amp; Artifacts</h1>
            <span
              className={`badge ${report.success ? 'badge-passed' : 'badge-failed'}`}
              style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
            >
              {report.success ? 'PIPELINE PASSED' : 'PIPELINE FAILED'}
            </span>
          </div>
          <p className="page-desc">
            Execution ID: <code style={{ color: '#38bdf8' }}>{report.execution_id}</code> • Total Runtime: <strong>{totalDurationMs.toFixed(1)} ms</strong> • Timestamp: {new Date(report.timestamp).toLocaleString()}
          </p>
        </div>

        <button className="btn btn-secondary" onClick={onBackToStudio}>
          &larr; Back to Plan Studio
        </button>
      </div>

      {/* 2-Stage Gate Stepper */}
      <div className="stepper-container" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
        {/* Stage 1 */}
        <div className={`step-card ${stage1Status.toLowerCase()}`}>
          <div className="step-header">
            <span className="step-number">GATE 1</span>
            <span className={`badge badge-${stage1Status.toLowerCase()}`}>{stage1Status}</span>
          </div>
          <div className="step-title">Stage 1: Pydantic v2 Contract &amp; PII Gate</div>
          <p style={{ fontSize: '0.825rem', color: '#94a3b8', marginTop: '0.25rem' }}>
            Kimball &amp; Medallion prefix rules, grain validation, and PII classification governance.
          </p>
          {stage1 && (
            <div style={{ fontSize: '0.75rem', color: '#38bdf8', marginTop: '0.6rem' }}>
              Duration: {stage1.duration_ms} ms • Models: {stage1.details?.models_count || 0} • PII Columns: {stage1.details?.pii_columns_detected || 0}
            </div>
          )}
        </div>

        {/* Stage 2 */}
        <div className={`step-card ${stage2Status.toLowerCase()}`}>
          <div className="step-header">
            <span className="step-number">GATE 2</span>
            <span className={`badge badge-${stage2Status.toLowerCase()}`}>{stage2Status}</span>
          </div>
          <div className="step-title">Stage 2: Graph, Strategy &amp; dbt Synthesis Gate</div>
          <p style={{ fontSize: '0.825rem', color: '#94a3b8', marginTop: '0.25rem' }}>
            Kahn's DAG sort, DRY grains, Blast Radius _v2, GoF Strategy/Builder &amp; bounded self-healing dbt parse.
          </p>
          {stage2 && (
            <div style={{ fontSize: '0.75rem', color: '#38bdf8', marginTop: '0.6rem' }}>
              Duration: {stage2.duration_ms} ms • Healing Attempts: {stage2.details?.healing_attempts || 0}
            </div>
          )}
        </div>
      </div>

      {/* Short Circuit Alert Banner if failed */}
      {report.short_circuited && (
        <div
          style={{
            padding: '1rem',
            borderRadius: '0.5rem',
            marginBottom: '1.5rem',
            backgroundColor: 'rgba(244, 63, 94, 0.15)',
            border: '1px solid rgba(244, 63, 94, 0.4)',
            color: '#fb7185',
          }}
        >
          <strong>⚠️ Pipeline Short-Circuited:</strong> A stage gate failed contract or graph validation. Downstream operations were safely halted.
        </div>
      )}

      <div className="grid-2">
        {/* Telemetry & Stage Trace Log */}
        <div className="card">
          <div className="card-title">
            <span>Execution Telemetry &amp; Trace Logs</span>
            <span className="badge badge-strategy">ID: {report.execution_id}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {report.stages.map((stage, idx) => (
              <div
                key={idx}
                style={{
                  padding: '1rem',
                  background: '#0b111e',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <strong style={{ fontSize: '0.95rem', color: '#f8fafc' }}>{stage.stage_name}</strong>
                  <span className={`badge badge-${stage.status.toLowerCase()}`}>{stage.status}</span>
                </div>

                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.5rem' }}>
                  Latency: <strong>{stage.duration_ms} ms</strong> • Started: {new Date(stage.started_at).toLocaleTimeString()}
                </div>

                {stage.errors && stage.errors.length > 0 && (
                  <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(244, 63, 94, 0.1)', borderRadius: '0.375rem', border: '1px solid rgba(244, 63, 94, 0.2)' }}>
                    <strong style={{ fontSize: '0.75rem', color: '#fb7185' }}>DIAGNOSTIC ERRORS:</strong>
                    {stage.errors.map((err, eIdx) => (
                      <div key={eIdx} style={{ fontSize: '0.75rem', color: '#fda4af', fontFamily: 'var(--font-mono)', marginTop: '0.2rem' }}>
                        {err}
                      </div>
                    ))}
                  </div>
                )}

                {stage.details && Object.keys(stage.details).length > 0 && (
                  <pre
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.5rem',
                      background: '#070b13',
                      borderRadius: '0.375rem',
                      fontSize: '0.75rem',
                      color: '#94a3b8',
                      overflowX: 'auto',
                      maxHeight: '190px',
                    }}
                  >
                    {JSON.stringify(stage.details, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Categorized Artifact Explorer */}
        <div className="card">
          <div className="card-title">
            <span>Categorized Artifact Explorer</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {selectedFile && (
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                  onClick={handleCopy}
                >
                  {copied ? '✓ Copied!' : '📋 Copy Content'}
                </button>
              )}
              <button
                className="btn btn-secondary"
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                onClick={fetchFiles}
              >
                ↻ Refresh
              </button>
            </div>
          </div>

          {/* Category Filter Pills */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', flexWrap: 'wrap' }}>
            <button
              className={`btn ${activeCategory === 'all' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
              onClick={() => setActiveCategory('all')}
            >
              All Files ({workspaceFiles.length})
            </button>
            <button
              className={`btn ${activeCategory === 'yaml' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
              onClick={() => setActiveCategory('yaml')}
            >
              1. YAML &amp; Unit Tests
            </button>
            <button
              className={`btn ${activeCategory === 'sql' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
              onClick={() => setActiveCategory('sql')}
            >
              2. SQL Stubs
            </button>
            <button
              className={`btn ${activeCategory === 'logs' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
              onClick={() => setActiveCategory('logs')}
            >
              3. Manifest &amp; Logs
            </button>
          </div>

          {loadingFiles ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading workspace artifacts...</div>
          ) : filteredFiles.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
              No files found in selected category.
            </div>
          ) : (
            <div>
              {/* File Selector Tabs */}
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem', maxHeight: '110px', overflowY: 'auto' }}>
                {filteredFiles.map((f) => (
                  <button
                    key={f.path}
                    className={`btn ${selectedFile?.path === f.path ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '0.25rem 0.55rem', fontSize: '0.725rem', fontFamily: 'var(--font-mono)' }}
                    onClick={() => setSelectedFile(f)}
                  >
                    {f.name}
                  </button>
                ))}
              </div>

              {selectedFile && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                    <span>Path: <code>{selectedFile.path}</code></span>
                    <span>Size: <strong>{selectedFile.size_bytes.toLocaleString()}</strong> bytes</span>
                  </div>

                  <pre className="code-viewer" style={{ maxHeight: '390px' }}>
                    {selectedFile.content}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
