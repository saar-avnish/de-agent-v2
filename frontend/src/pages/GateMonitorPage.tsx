import React, { useEffect, useState } from 'react';
import { ExecutionReport, WorkspaceFile } from '../types';
import { apiClient } from '../services/api';

interface GateMonitorPageProps {
  report: ExecutionReport | null;
  onBackToStudio: () => void;
}

export const GateMonitorPage: React.FC<GateMonitorPageProps> = ({
  report,
  onBackToStudio,
}) => {
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);

  useEffect(() => {
    fetchFiles();
  }, [report]);

  const fetchFiles = async () => {
    try {
      setLoadingFiles(true);
      const res = await apiClient.getWorkspaceFiles();
      setWorkspaceFiles(res.files || []);
      if (res.files && res.files.length > 0) {
        setSelectedFile(res.files[0]);
      }
    } catch (e) {
      console.error('Failed to fetch workspace files', e);
    } finally {
      setLoadingFiles(false);
    }
  };

  if (!report) {
    return (
      <div className="page-content">
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>No Pipeline Execution Recorded Yet</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            Configure your planner contract in Plan Studio and trigger the Stage 1 &rarr; 1.5 &rarr; 2 pipeline run.
          </p>
          <button className="btn btn-primary" onClick={onBackToStudio}>
            &larr; Go to Plan Studio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Page 3: Gate Observability & Workspace Diff Viewer</h1>
          <p className="page-desc">
            End-to-end telemetry across Stage 1 (Contract), Stage 1.5 (Access), and Stage 2 (Graph & dbt Synthesis).
            Inspect GoF execution traces and synthesized dbt 1.8+ YAML & TDD artifacts.
          </p>
        </div>

        <button className="btn btn-secondary" onClick={onBackToStudio}>
          &larr; Edit Plan in Studio
        </button>
      </div>

      {/* Stepper Display */}
      <div className="stepper-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        {/* Stage 1 */}
        {(() => {
          const s1 = report.stages.find((s) => s.stage_name.includes('Stage 1:'));
          const status = s1 ? s1.status : 'SKIPPED';
          return (
            <div className={`step-card ${status.toLowerCase()}`}>
              <div className="step-header">
                <span className="step-number">GATE 1</span>
                <span className={`badge badge-${status.toLowerCase()}`}>{status}</span>
              </div>
              <div className="step-title">Pydantic v2 Contract Gate</div>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                Kimball & Medallion prefix rules, grain validation, and TDD fixture syntax.
              </p>
              {s1 && (
                <div style={{ fontSize: '0.75rem', color: '#38bdf8', marginTop: '0.5rem' }}>
                  Duration: {s1.duration_ms} ms
                </div>
              )}
            </div>
          );
        })()}

        {/* Stage 1.5 */}
        {(() => {
          const s1_5 = report.stages.find((s) => s.stage_name.includes('Stage 1.5:'));
          const status = s1_5 ? s1_5.status : (report.short_circuited ? 'SKIPPED' : 'RUNNING');
          return (
            <div className={`step-card ${status.toLowerCase()}`}>
              <div className="step-header">
                <span className="step-number">GATE 1.5</span>
                <span className={`badge badge-${status.toLowerCase()}`}>{status}</span>
              </div>
              <div className="step-title">Security & RBAC Access Gate</div>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                Role authoring clearance, domain boundary isolation, and PII permissions.
              </p>
              {s1_5 && (
                <div style={{ fontSize: '0.75rem', color: '#38bdf8', marginTop: '0.5rem' }}>
                  Duration: {s1_5.duration_ms} ms
                </div>
              )}
            </div>
          );
        })()}

        {/* Stage 2 */}
        {(() => {
          const s2 = report.stages.find((s) => s.stage_name.includes('Stage 2:'));
          const status = s2 ? s2.status : (report.short_circuited ? 'SKIPPED' : 'PENDING');
          return (
            <div className={`step-card ${status.toLowerCase()}`}>
              <div className="step-header">
                <span className="step-number">GATE 2</span>
                <span className={`badge badge-${status.toLowerCase()}`}>{status}</span>
              </div>
              <div className="step-title">Graph & dbt Synthesis Gate</div>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                Kahn's DAG sort, DRY grains, Blast Radius, dbt 1.8+ TDD builder, & self-healing parse.
              </p>
              {s2 && (
                <div style={{ fontSize: '0.75rem', color: '#38bdf8', marginTop: '0.5rem' }}>
                  Duration: {s2.duration_ms} ms
                </div>
              )}
            </div>
          );
        })()}
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
          <strong>⚠️ Pipeline Short-Circuited:</strong> A stage gate failed validation. Downstream code generation was safely halted.
        </div>
      )}

      <div className="grid-2">
        {/* GoF Telemetry & Stage Trace Log */}
        <div className="card">
          <div className="card-title">
            <span>Execution Telemetry & Trace Logs</span>
            <span className="badge badge-strategy">
              ID: {report.execution_id}
            </span>
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
                  Duration: {stage.duration_ms}ms • Started: {new Date(stage.started_at).toLocaleTimeString()}
                </div>

                {stage.errors && stage.errors.length > 0 && (
                  <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(244, 63, 94, 0.1)', borderRadius: '0.375rem', border: '1px solid rgba(244, 63, 94, 0.2)' }}>
                    <strong style={{ fontSize: '0.75rem', color: '#fb7185' }}>ERRORS:</strong>
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
                      maxHeight: '180px',
                    }}
                  >
                    {JSON.stringify(stage.details, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Synthesized Workspace Files & YAML Diff Viewer */}
        <div className="card">
          <div className="card-title">
            <span>Synthesized dbt 1.8+ YAML & TDD Artifacts</span>
            <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={fetchFiles}>
              ↻ Refresh
            </button>
          </div>

          {loadingFiles ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading workspace files...</div>
          ) : workspaceFiles.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
              No files synthesized yet. Ensure Stage 2 succeeds.
            </div>
          ) : (
            <div>
              {/* File Selector Tabs */}
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                {workspaceFiles.map((f) => (
                  <button
                    key={f.path}
                    className={`btn ${selectedFile?.path === f.path ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}
                    onClick={() => setSelectedFile(f)}
                  >
                    {f.path.split('/').pop()}
                  </button>
                ))}
              </div>

              {selectedFile && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                    <span>Path: <code>dbt_workspace/{selectedFile.path}</code></span>
                    <span>Size: {selectedFile.size_bytes} bytes</span>
                  </div>

                  <pre className="code-viewer">
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
