import React, { useEffect, useState } from 'react';
import { apiClient } from '../services/api';
import { HealthStatus } from '../types';

interface NavbarProps {
  activePage: 'studio' | 'monitor';
  setActivePage: (page: 'studio' | 'monitor') => void;
  workspaceReady?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activePage,
  setActivePage,
  workspaceReady = true,
}) => {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(true);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const data = await apiClient.getHealth();
        setHealth(data);
        setIsOnline(true);
      } catch {
        setIsOnline(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <nav className="navbar">
      <div className="nav-brand">
        <span>⚡ DE-AGENT-V2</span>
        <span className="nav-badge">Stage 2 Enterprise</span>
      </div>

      <div className="nav-links">
        <button
          className={`nav-tab ${activePage === 'studio' ? 'active' : ''}`}
          onClick={() => setActivePage('studio')}
        >
          📐 1. Plan Studio
        </button>
        <button
          className={`nav-tab ${activePage === 'monitor' ? 'active' : ''}`}
          onClick={() => setActivePage('monitor')}
        >
          📊 2. Gate Monitor & Artifacts
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div className="session-indicator" title="Backend Gateway Health Status">
          <span
            className="status-dot"
            style={{
              backgroundColor: isOnline ? 'var(--accent-green)' : 'var(--accent-rose)',
              boxShadow: isOnline
                ? '0 0 8px rgba(16, 185, 129, 0.6)'
                : '0 0 8px rgba(244, 63, 94, 0.6)',
            }}
          ></span>
          <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>
            {isOnline ? 'Backend: Online' : 'Backend: Offline'}
          </span>
          {health && (
            <span className="badge badge-staging" style={{ fontSize: '0.68rem' }}>
              {health.stage_max}
            </span>
          )}
        </div>

        <div className="session-indicator" title="Local Analytics Warehouse Profile">
          <span className="status-dot" style={{ backgroundColor: 'var(--accent-cyan)' }}></span>
          <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>
            Workspace: {workspaceReady ? 'Ready (DuckDB)' : 'Pending Init'}
          </span>
        </div>
      </div>
    </nav>
  );
};
