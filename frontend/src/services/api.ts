import {
  SecurityContext,
  AuthSessionResponse,
  PlannerContract,
  ExecutionReport,
  WorkspaceFile,
} from '../types';

const API_BASE = '/api';

export const apiClient = {
  async createSession(secCtx: SecurityContext): Promise<AuthSessionResponse> {
    const res = await fetch(`${API_BASE}/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(secCtx),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to create session' }));
      throw new Error(err.detail || 'Session creation failed');
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
    secCtx: SecurityContext,
    sessionId?: string
  ): Promise<ExecutionReport> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (sessionId) {
      headers['X-Session-ID'] = sessionId;
    }

    const res = await fetch(`${API_BASE}/stages/run-to-stage-2`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        planner,
        security_context: secCtx,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Pipeline execution failed' }));
      throw new Error(err.detail || 'Stage run failed');
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
