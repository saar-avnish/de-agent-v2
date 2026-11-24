import {
  PlannerContract,
  ExecutionReport,
  WorkspaceFile,
  HealthStatus,
} from '../types';

const API_BASE = '/api';

export const apiClient = {
  async getHealth(): Promise<HealthStatus> {
    const res = await fetch('/health');
    if (!res.ok) {
      throw new Error('Health check failed');
    }
    return res.json();
  },

  async initDbtWorkspace(projectName: string, warehouse: string): Promise<any> {
    const res = await fetch(`${API_BASE}/dbt/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_name: projectName, warehouse }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to initialize dbt' }));
      throw new Error(err.detail || 'dbt init failed');
    }
    return res.json();
  },

  async runStagesToStage2(
    planner: PlannerContract,
    manifestModels?: Record<string, any>
  ): Promise<ExecutionReport> {
    const res = await fetch(`${API_BASE}/stages/run-to-stage-2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planner,
        manifest_models: manifestModels,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Pipeline execution failed' }));
      throw new Error(err.detail || 'Stage run failed');
    }
    return res.json();
  },

  async getLatestExecution(): Promise<ExecutionReport> {
    const res = await fetch(`${API_BASE}/stages/executions/latest`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to fetch latest execution' }));
      throw new Error(err.detail || 'No prior execution');
    }
    return res.json();
  },

  async getExecution(execId: string): Promise<ExecutionReport> {
    const res = await fetch(`${API_BASE}/stages/executions/${execId}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Execution not found' }));
      throw new Error(err.detail || 'Execution not found');
    }
    return res.json();
  },

  async getWorkspaceFiles(): Promise<{ workspace_dir: string; files: WorkspaceFile[] }> {
    const res = await fetch(`${API_BASE}/stages/workspace-files`);
    if (!res.ok) {
      throw new Error('Failed to retrieve workspace files');
    }
    return res.json();
  },
};
