import React, { useEffect, useState } from 'react';
import { ExecutionReport, StageTrace, WorkspaceFile } from '../types';
import { apiClient } from '../services/api';

interface GateMonitorPageProps {
  report: ExecutionReport | null;
  setReport: (r: ExecutionReport) => void;
  onBackToStudio: () => void;
}

type ArtifactCategory = 'all' | 'sql' | 'yaml' | 'manifest' | 'logs';
type SelectedGateKey = 'stage1' | 'stage2';

const filterFilesByCategory = (files: WorkspaceFile[], category: ArtifactCategory): WorkspaceFile[] => {
  if (category === 'sql') {
    return files.filter((f) => f.category === 'sql' || f.extension === '.sql');
  }
  if (category === 'yaml') {
    return files.filter((f) => f.category === 'yaml' || f.extension === '.yml' || f.extension === '.yaml');
  }
  if (category === 'manifest') {
    return files.filter((f) => f.name === 'manifest.json' || f.extension === '.json');
  }
  if (category === 'logs') {
    return files.filter(
      (f) => f.name === 'dbt.log' || f.extension === '.log' || (f.category === 'logs' && f.name !== 'manifest.json' && f.extension !== '.json')
    );
  }
  return files;
};

export const GateMonitorPage: React.FC<GateMonitorPageProps> = ({
  report,
  setReport,
  onBackToStudio,
}) => {
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [copiedContent, setCopiedContent] = useState(false);
  const [copiedExecId, setCopiedExecId] = useState(false);
  const [activeCategory, setActiveCategory] = useState<ArtifactCategory>('all');
  const [selectedGate, setSelectedGate] = useState<SelectedGateKey>('stage1');
  const [lookupExecId, setLookupExecId] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    // If no report in memory, fetch the latest execution from backend server state
    if (!report) {
      apiClient.getLatestExecution()
        .then((latest) => setReport(latest))
        .catch(() => {
          // No prior execution recorded
        });
    }
  }, [report, setReport]);

  useEffect(() => {
    if (report) {
      // Auto-select the failing gate or Stage 2 when both pass
      const s1 = report.stages.find((s) => s.stage_name.includes('Stage 1:'));
      const s2 = report.stages.find((s) => s.stage_name.includes('Stage 2:'));
      if (s1 && !s1.success) {
        setSelectedGate('stage1');
      } else if (s2) {
        setSelectedGate('stage2');
      } else {
        setSelectedGate('stage1');
      }
    }
    fetchFiles(report?.execution_id);
  }, [report?.execution_id]);

  const fetchFiles = async (execId?: string) => {
    try {
      setLoadingFiles(true);
      let files: WorkspaceFile[] = [];

      if (execId) {
        const byExec = await apiClient.getExecutionArtifacts(execId).catch(() => null);
        if (byExec && byExec.artifacts && byExec.artifacts.length > 0) {
          files = byExec.artifacts;
        }
      }

      if (files.length === 0) {
        const res = await apiClient.getWorkspaceFiles();
        files = res.files || [];
      }

      setWorkspaceFiles(files);
      const filtered = filterFilesByCategory(files, activeCategory);
      setSelectedFile((prev) => {
        if (prev && filtered.some((f) => f.path === prev.path)) {
          return filtered.find((f) => f.path === prev.path) || filtered[0] || null;
        }
        return filtered[0] || files[0] || null;
      });
    } catch (e) {
      console.error('Failed to fetch workspace files', e);
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleCategoryChange = (cat: ArtifactCategory) => {
    setActiveCategory(cat);
    const nextList = filterFilesByCategory(workspaceFiles, cat);
    if (nextList.length === 0) {
      setSelectedFile(null);
    } else if (!selectedFile || !nextList.some((f) => f.path === selectedFile.path)) {
      setSelectedFile(nextList[0]);
    }
  };

  const handleCopyContent = () => {
    if (!selectedFile) return;
    navigator.clipboard.writeText(selectedFile.content);
    setCopiedContent(true);
    setTimeout(() => setCopiedContent(false), 2000);
  };

  const handleCopyExecId = () => {
    if (!report) return;
    navigator.clipboard.writeText(report.execution_id);
    setCopiedExecId(true);
    setTimeout(() => setCopiedExecId(false), 1800);
  };

  const handleExecutionLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = lookupExecId.trim();
    setLookupError(null);
    try {
      const fetched = targetId
        ? await apiClient.getExecution(targetId)
        : await apiClient.getLatestExecution();
      setReport(fetched);
      setLookupExecId('');
    } catch (err: any) {
      setLookupError(err.message || 'Not found');
    }
  };

  const filteredFiles = filterFilesByCategory(workspaceFiles, activeCategory);

  if (!report) {
    return (
      <div className="monitor-shell" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem', maxWidth: '540px' }}>
          <h2 style={{ marginBottom: '0.75rem', color: '#f8fafc' }}>No Pipeline Executions Recorded</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            Configure your data engineering contract in Plan Studio and click &ldquo;Run Validation &amp; Synthesis&rdquo; to trigger the automated 2-Stage gate pipeline.
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

  const activeStage: StageTrace | undefined = selectedGate === 'stage1' ? stage1 : stage2;
  const activeStageStatus = selectedGate === 'stage1' ? stage1Status : stage2Status;
  const activeStageTitle = selectedGate === 'stage1'
    ? 'Stage 1: Pydantic v2 Contract & PII Gate'
    : 'Stage 2: Graph, Strategy & dbt Synthesis Gate';

  const countByCategory = (cat: ArtifactCategory) => filterFilesByCategory(workspaceFiles, cat).length;

  return (
    <div className="monitor-shell">
      {/* Compact Fixed Top Telemetry Header */}
      <header className="monitor-header">
        <div className="monitor-header-meta">
          <h1 className="monitor-header-title">Gate Monitor</h1>

          <span className={`badge ${report.success ? 'badge-passed' : 'badge-failed'}`}>
            {report.success ? 'PASSED' : 'FAILED'}
          </span>

          {report.short_circuited && (
            <span className="badge badge-failed" title="Downstream gates halted after failure">
              ⚠ Short-Circuited
            </span>
          )}

          <div className="monitor-exec-pill" title={`Execution ID: ${report.execution_id}`}>
            <span className="monitor-exec-id-text">{report.execution_id}</span>
            <button
              type="button"
              className="monitor-mini-btn"
              onClick={handleCopyExecId}
              title="Copy full Execution ID"
              aria-label="Copy Execution ID"
            >
              {copiedExecId ? '✓' : '📋'}
            </button>
          </div>

          <span
            style={{
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
            }}
            title={`${totalDurationMs.toFixed(1)} ms • ${report.project_name}`}
          >
            <strong>{totalDurationMs.toFixed(1)} ms</strong> • {report.project_name}
          </span>
        </div>

        {/* Compact Horizontal Stage 1 -> Stage 2 Stepper */}
        <div className="monitor-stepper-inline" role="tablist" aria-label="Gate Stepper">
          <button
            type="button"
            role="tab"
            aria-selected={selectedGate === 'stage1'}
            className={`monitor-step-pill ${selectedGate === 'stage1' ? 'active' : ''}`}
            onClick={() => setSelectedGate('stage1')}
          >
            <span>1. Contract &amp; PII</span>
            <span className={`badge badge-${stage1Status.toLowerCase()}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem' }}>
              {stage1Status}
            </span>
          </button>

          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>&rarr;</span>

          <button
            type="button"
            role="tab"
            aria-selected={selectedGate === 'stage2'}
            className={`monitor-step-pill ${selectedGate === 'stage2' ? 'active' : ''}`}
            onClick={() => setSelectedGate('stage2')}
          >
            <span>2. Graph &amp; dbt</span>
            <span className={`badge badge-${stage2Status.toLowerCase()}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem' }}>
              {stage2Status}
            </span>
          </button>
        </div>

        {/* Execution Selector / Actions */}
        <div className="monitor-header-actions">
          <form className="monitor-exec-lookup" onSubmit={handleExecutionLookup}>
            <input
              type="text"
              className="monitor-exec-input"
              placeholder="exec_id / latest"
              value={lookupExecId}
              onChange={(e) => {
                setLookupExecId(e.target.value);
                if (lookupError) setLookupError(null);
              }}
              title={lookupError || 'Load a specific execution ID or leave blank for latest'}
              aria-label="Execution ID lookup"
            />
            <button
              type="submit"
              className="btn btn-secondary"
              style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem' }}
              title="Load execution by ID (blank for latest)"
            >
              Load
            </button>
          </form>

          {lookupError && (
            <span style={{ fontSize: '0.7rem', color: '#fb7185', whiteSpace: 'nowrap' }} title={lookupError}>
              Not found
            </span>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', whiteSpace: 'nowrap' }}
            onClick={onBackToStudio}
          >
            &larr; Plan Studio
          </button>
        </div>
      </header>

      {/* Split Master-Detail Workbench */}
      <div className="monitor-grid">
        {/* LEFT PANE: Gate & Diagnostics Inspector */}
        <section className="monitor-pane" aria-label="Gate and Diagnostics Inspector">
          {/* Fixed Gate Summary Cards Row */}
          <div className="gate-cards-row">
            <button
              type="button"
              onClick={() => setSelectedGate('stage1')}
              className={`gate-summary-card ${stage1Status.toLowerCase()} ${selectedGate === 'stage1' ? 'selected' : ''}`}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>GATE 1 • CONTRACT &amp; PII</span>
                <span className={`badge badge-${stage1Status.toLowerCase()}`} style={{ fontSize: '0.68rem', padding: '0.12rem 0.4rem' }}>
                  {stage1Status}
                </span>
              </div>
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc' }}>
                Pydantic v2 &amp; Medallion
              </div>
              <div style={{ fontSize: '0.74rem', color: '#38bdf8' }}>
                {stage1 ? `${stage1.duration_ms} ms • Models: ${stage1.details?.models_count ?? 0} • PII: ${stage1.details?.pii_columns_detected ?? 0}` : 'Not executed'}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setSelectedGate('stage2')}
              className={`gate-summary-card ${stage2Status.toLowerCase()} ${selectedGate === 'stage2' ? 'selected' : ''}`}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>GATE 2 • GRAPH &amp; DBT</span>
                <span className={`badge badge-${stage2Status.toLowerCase()}`} style={{ fontSize: '0.68rem', padding: '0.12rem 0.4rem' }}>
                  {stage2Status}
                </span>
              </div>
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc' }}>
                DAG, Strategy &amp; Synthesis
              </div>
              <div style={{ fontSize: '0.74rem', color: '#38bdf8' }}>
                {stage2 ? `${stage2.duration_ms} ms • Heals: ${stage2.details?.healing_attempts ?? 0} • Order: ${stage2.details?.topological_order?.length ?? 0}` : (report.short_circuited ? 'Halted (Short-Circuited)' : 'Pending')}
              </div>
            </button>
          </div>

          {/* Dedicated Scrollable Diagnostics Pane */}
          <div className="gate-diagnostics-scroll">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              <div style={{ minWidth: 0 }}>
                <div className="wrap-anywhere" style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f8fafc' }}>
                  {activeStageTitle}
                </div>
                {activeStage && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Latency: <strong>{activeStage.duration_ms} ms</strong> • Started: {new Date(activeStage.started_at).toLocaleTimeString()}
                  </div>
                )}
              </div>
              <span className={`badge badge-${activeStageStatus.toLowerCase()}`}>
                {activeStageStatus}
              </span>
            </div>

            {!activeStage ? (
              <div
                className="wrap-anywhere"
                style={{
                  padding: '1rem',
                  background: '#0b111e',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.84rem',
                }}
              >
                {report.short_circuited
                  ? 'This gate was skipped because an upstream gate failed validation and short-circuited the pipeline.'
                  : 'No telemetry recorded for this gate yet.'}
              </div>
            ) : (
              <>
                {/* Error Diagnostics */}
                {activeStage.errors && activeStage.errors.length > 0 && (
                  <div
                    style={{
                      padding: '0.75rem',
                      background: 'rgba(244, 63, 94, 0.12)',
                      borderRadius: '0.5rem',
                      border: '1px solid rgba(244, 63, 94, 0.35)',
                    }}
                  >
                    <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#fb7185', marginBottom: '0.35rem', letterSpacing: '0.04em' }}>
                      DIAGNOSTIC ERRORS ({activeStage.errors.length})
                    </div>
                    {activeStage.errors.map((err, eIdx) => (
                      <div
                        key={eIdx}
                        className="wrap-anywhere"
                        style={{
                          fontSize: '0.78rem',
                          color: '#fda4af',
                          fontFamily: 'var(--font-mono)',
                          whiteSpace: 'pre-wrap',
                          marginTop: eIdx > 0 ? '0.4rem' : 0,
                        }}
                      >
                        {err}
                      </div>
                    ))}
                  </div>
                )}

                {/* Stage 2 Topological Order Summary Chips */}
                {selectedGate === 'stage2' && Array.isArray(activeStage.details?.topological_order) && (
                  <div style={{ padding: '0.65rem 0.75rem', background: '#0b111e', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                      Topological DAG Execution Order
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                      {activeStage.details.topological_order.map((node: string, i: number) => (
                        <React.Fragment key={node}>
                          {i > 0 && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>&rarr;</span>}
                          <span className="badge badge-strategy" style={{ textTransform: 'none', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                            {node}
                          </span>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}

                {/* Stage 1 PII Governance Summary */}
                {selectedGate === 'stage1' && Array.isArray(activeStage.details?.pii_governance) && activeStage.details.pii_governance.length > 0 && (
                  <div style={{ padding: '0.65rem 0.75rem', background: '#0b111e', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                      PII Columns Governed ({activeStage.details.pii_governance.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {activeStage.details.pii_governance.map((pii: any, pIdx: number) => (
                        <div key={pIdx} className="wrap-anywhere" style={{ fontSize: '0.76rem', fontFamily: 'var(--font-mono)', color: '#cbd5e1' }}>
                          {pii.model}.{pii.column} <span className="badge badge-mart" style={{ marginLeft: '0.35rem', fontSize: '0.66rem' }}>{pii.pii_type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Full Structured Telemetry Details */}
                {activeStage.details && Object.keys(activeStage.details).length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                      Stage Telemetry &amp; Trace Payload
                    </div>
                    <pre className="diagnostic-pre">
                      {JSON.stringify(activeStage.details, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* RIGHT PANE: Single-Active-File Artifact Viewer */}
        <section className="monitor-pane" aria-label="Artifact Viewer">
          <div className="artifact-toolbar">
            <div className="artifact-toolbar-top">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <strong style={{ fontSize: '0.95rem', color: '#f8fafc' }}>Artifact Viewer</strong>
                <span className="badge badge-staging" style={{ fontSize: '0.68rem' }}>
                  {filteredFiles.length} / {workspaceFiles.length}
                </span>
              </div>

              <div className="artifact-category-pills">
                {(
                  [
                    { key: 'all', label: `All (${workspaceFiles.length})` },
                    { key: 'sql', label: `SQL (${countByCategory('sql')})` },
                    { key: 'yaml', label: `YAML (${countByCategory('yaml')})` },
                    { key: 'manifest', label: `Manifest (${countByCategory('manifest')})` },
                    { key: 'logs', label: `Logs (${countByCategory('logs')})` },
                  ] as const
                ).map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    className={`btn ${activeCategory === cat.key ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '0.24rem 0.55rem', fontSize: '0.72rem' }}
                    onClick={() => handleCategoryChange(cat.key)}
                  >
                    {cat.label}
                  </button>
                ))}

                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '0.24rem 0.55rem', fontSize: '0.72rem' }}
                  onClick={() => fetchFiles(report.execution_id)}
                  title="Refresh workspace artifacts"
                >
                  ↻ Refresh
                </button>
              </div>
            </div>

            {/* File Selector Strip (Horizontal scrollable tabs + quick dropdown) */}
            {filteredFiles.length > 0 && (
              <div className="artifact-file-strip">
                <div className="artifact-file-tabs" role="tablist" aria-label="Artifact Files">
                  {filteredFiles.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      role="tab"
                      aria-selected={selectedFile?.path === f.path}
                      className={`btn ${selectedFile?.path === f.path ? 'btn-primary' : 'btn-secondary'}`}
                      style={{
                        padding: '0.24rem 0.55rem',
                        fontSize: '0.72rem',
                        fontFamily: 'var(--font-mono)',
                        flexShrink: 0,
                      }}
                      onClick={() => setSelectedFile(f)}
                      title={f.path}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>

                {filteredFiles.length > 3 && (
                  <select
                    className="artifact-file-select"
                    value={selectedFile?.path || ''}
                    onChange={(e) => {
                      const found = filteredFiles.find((f) => f.path === e.target.value);
                      if (found) setSelectedFile(found);
                    }}
                    aria-label="Quick select artifact file"
                  >
                    {filteredFiles.map((f) => (
                      <option key={f.path} value={f.path}>
                        {f.path}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {/* Single Active Artifact Code Viewport */}
          {loadingFiles ? (
            <div className="artifact-viewer-shell" style={{ justifyContent: 'center', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
              Loading workspace artifacts...
            </div>
          ) : !selectedFile ? (
            <div className="artifact-viewer-shell" style={{ justifyContent: 'center', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
              No files found in the selected category.
            </div>
          ) : (
            <div className="artifact-viewer-shell">
              <div className="artifact-file-header">
                <span className="artifact-file-path" title={selectedFile.path}>
                  {selectedFile.path}
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                  <span className="badge badge-strategy" style={{ fontSize: '0.66rem' }}>
                    {selectedFile.extension || selectedFile.category || 'file'}
                  </span>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {selectedFile.size_bytes.toLocaleString()} bytes
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0.22rem 0.55rem', fontSize: '0.72rem' }}
                    onClick={handleCopyContent}
                  >
                    {copiedContent ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
              </div>

              <pre className="artifact-code-viewport">
                <code>{selectedFile.content}</code>
              </pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
