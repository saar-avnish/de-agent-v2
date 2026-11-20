import React from 'react';
import { SecurityContext } from '../types';

interface NavbarProps {
  activePage: 'auth' | 'studio' | 'monitor';
  setActivePage: (page: 'auth' | 'studio' | 'monitor') => void;
  securityContext: SecurityContext;
}

export const Navbar: React.FC<NavbarProps> = ({
  activePage,
  setActivePage,
  securityContext,
}) => {
  return (
    <nav className="navbar">
      <div className="nav-brand">
        <span>⚡ DE-AGENT-V2</span>
        <span className="nav-badge">Stage 2 Enterprise</span>
      </div>

      <div className="nav-links">
        <button
          className={`nav-tab ${activePage === 'auth' ? 'active' : ''}`}
          onClick={() => setActivePage('auth')}
        >
          🔐 1. Access & RBAC
        </button>
        <button
          className={`nav-tab ${activePage === 'studio' ? 'active' : ''}`}
          onClick={() => setActivePage('studio')}
        >
          📐 2. Plan Studio
        </button>
        <button
          className={`nav-tab ${activePage === 'monitor' ? 'active' : ''}`}
          onClick={() => setActivePage('monitor')}
        >
          📊 3. Gate Monitor & Diff
        </button>
      </div>

      <div className="session-indicator">
        <span className="status-dot"></span>
        <span style={{ fontWeight: 600 }}>{securityContext.user_id}</span>
        <span className="badge badge-staging">{securityContext.role}</span>
        {securityContext.pii_clearance ? (
          <span className="badge badge-passed" title="PII Clearance Enabled">PII ✓</span>
        ) : (
          <span className="badge badge-failed" title="PII Clearance Disabled">NO PII</span>
        )}
      </div>
    </nav>
  );
};
