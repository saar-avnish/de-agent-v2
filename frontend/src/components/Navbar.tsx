import React, { useEffect, useState } from 'react';
import { apiClient } from '../services/api';
import { HealthStatus, RuntimeConfig } from '../types';

interface NavbarProps {
  activePage: 'studio' | 'monitor';
  setActivePage: (page: 'studio' | 'monitor') => void;
  runtimeConfig?: RuntimeConfig | null;
  onOpenDbtInit: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activePage,
  setActivePage,
  runtimeConfig,
  onOpenDbtInit,
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

  const warehouseName = runtimeConfig?.warehouse
    ? runtimeConfig.warehouse.toUpperCase()
    : 'DUCKDB';
  const dialectLabel = runtimeConfig?.warehouse === 'duckdb' || !runtimeConfig
    ? ':memory:'
    : runtimeConfig.dialect_path;

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
          📊 2. Gate Monitor &amp; Artifacts
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {/* Modal-Only dbt Init / Runtime Configuration Trigger */}
        <button
          type="button"
          onClick={onOpenDbtInit}
          className="btn btn-secondary"
          style={{
            padding: '0.35rem 0.85rem',
            fontSize: '0.8rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            borderColor: 'rgba(6, 182, 212, 0.4)',
            background: 'rgba(6, 182, 212, 0.08)',
          }}
          title="Click to configure warehouse dialect and run dbt init"
        >
          <span
            className="status-dot"
            style={{ backgroundColor: 'var(--accent-cyan)' }}
          ></span>
          <span>
            Runtime: <strong style={{ color: '#38bdf8' }}>{warehouseName}</strong> ({dialectLabel})
          </span>
          <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>⚙ Setup</span>
        </button>

        {/* Backend Online Indicator */}
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
            {isOnline ? 'Online' : 'Offline'}
          </span>
          {health && (
            <span className="badge badge-staging" style={{ fontSize: '0.68rem' }}>
              {health.stage_max}
            </span>
          )}
        </div>
      </div>
    </nav>
  );
};
