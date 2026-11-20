import React, { useState } from 'react';
import { SecurityContext, UserRole } from '../types';
import { apiClient } from '../services/api';

interface LoginAccessPageProps {
  securityContext: SecurityContext;
  setSecurityContext: (ctx: SecurityContext) => void;
  setSessionId: (id: string) => void;
  onProceed: () => void;
}

export const LoginAccessPage: React.FC<LoginAccessPageProps> = ({
  securityContext,
  setSecurityContext,
  setSessionId,
  onProceed,
}) => {
  const [userId, setUserId] = useState(securityContext.user_id);
  const [role, setRole] = useState<UserRole>(securityContext.role);
  const [domainInput, setDomainInput] = useState('');
  const [domains, setDomains] = useState<string[]>(securityContext.allowed_domains);
  const [piiClearance, setPiiClearance] = useState(securityContext.pii_clearance);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const applyPreset = (presetRole: UserRole, presetDomains: string[], pii: boolean, id: string) => {
    setUserId(id);
    setRole(presetRole);
    setDomains(presetDomains);
    setPiiClearance(pii);
    setMessage(null);
  };

  const addDomain = () => {
    const trimmed = domainInput.trim().toLowerCase();
    if (trimmed && !domains.includes(trimmed)) {
      setDomains([...domains, trimmed]);
      setDomainInput('');
    }
  };

  const removeDomain = (d: string) => {
    setDomains(domains.filter((item) => item !== d));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const updatedCtx: SecurityContext = {
      user_id: userId,
      role,
      allowed_domains: domains,
      pii_clearance: piiClearance,
    };

    try {
      const res = await apiClient.createSession(updatedCtx);
      setSecurityContext(updatedCtx);
      setSessionId(res.session_id);
      setMessage({
        text: `Session created successfully (${res.session_id}). Security context armed for Stage 1.5.`,
        type: 'success',
      });
    } catch (err: any) {
      setMessage({
        text: err.message || 'Failed to authenticate session',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Page 1: Control & Access Gate (Stage 1.5 RBAC)</h1>
        <p className="page-desc">
          Configure active caller identity, role authorization, domain permissions, and PII handling clearance.
          Stage 1.5 validates these policies against the proposed data engineering planner.
        </p>
      </div>

      <div className="grid-2">
        {/* Presets & Policies Card */}
        <div className="card">
          <div className="card-title">
            <span>⚡ Persona & Policy Presets</span>
            <span className="badge badge-strategy">RBAC Guardrails</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => applyPreset('lead_engineer', ['sales', 'marketing', 'core', 'finance'], true, 'lead_alice')}
            >
              <div>
                <strong style={{ color: '#38bdf8' }}>Lead Data Engineer (Full Clearance)</strong>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  Role: lead_engineer • Domains: all • PII: Granted (Passes Stage 1.5)
                </p>
              </div>
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => applyPreset('data_engineer', ['sales'], false, 'dev_bob')}
            >
              <div>
                <strong style={{ color: '#fbbf24' }}>Data Engineer (Scoped, No PII Clearance)</strong>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  Role: data_engineer • Domains: [sales] • PII: Denied (Fails if PII columns present)
                </p>
              </div>
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => applyPreset('analyst', ['sales'], false, 'analyst_carol')}
            >
              <div>
                <strong style={{ color: '#f43f5e' }}>Business Analyst (Read-Only)</strong>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  Role: analyst • Read-only access (Short-circuits Stage 1.5 Access Gate)
                </p>
              </div>
            </button>
          </div>

          <div style={{ padding: '1rem', background: '#0b111e', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
            <h4 style={{ fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '0.5rem' }}>
              🛡️ Stage 1.5 Enforcement Rules:
            </h4>
            <ul style={{ fontSize: '0.8rem', color: '#94a3b8', paddingLeft: '1.25rem', lineHeight: 1.6 }}>
              <li><strong>RBAC:</strong> Only <code>admin</code>, <code>lead_engineer</code>, and <code>data_engineer</code> can synthesize code.</li>
              <li><strong>Domain Isolation:</strong> Models touching unapproved domains trigger <code>DOMAIN_OUT_OF_SCOPE</code>.</li>
              <li><strong>PII Clearance:</strong> Models with PII columns require <code>pii_clearance = true</code>.</li>
            </ul>
          </div>
        </div>

        {/* Identity & Session Form */}
        <div className="card">
          <div className="card-title">
            <span>Identity & Clearance Configuration</span>
            <span className="badge badge-staging">Session Setup</span>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">User Identifier</label>
              <input
                type="text"
                className="form-input"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">RBAC Role</label>
              <select
                className="form-select"
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
              >
                <option value="lead_engineer">Lead Engineer (Full Authoring)</option>
                <option value="data_engineer">Data Engineer (Authoring)</option>
                <option value="admin">Administrator (* Clearance)</option>
                <option value="analyst">Analyst (Read-Only - Blocked at Stage 1.5)</option>
                <option value="guest">Guest (Unauthorized)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Allowed Business Domains</label>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. sales, marketing, finance, or *"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addDomain();
                    }
                  }}
                />
                <button type="button" className="btn btn-secondary" onClick={addDomain}>
                  Add
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {domains.map((d) => (
                  <span
                    key={d}
                    className="badge badge-strategy"
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                    onClick={() => removeDomain(d)}
                    title="Click to remove"
                  >
                    {d} &times;
                  </span>
                ))}
              </div>
            </div>

            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1.25rem' }}>
              <input
                type="checkbox"
                id="pii_toggle"
                style={{ width: '1.25rem', height: '1.25rem', accentColor: '#0284c7' }}
                checked={piiClearance}
                onChange={(e) => setPiiClearance(e.target.checked)}
              />
              <label htmlFor="pii_toggle" style={{ fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' }}>
                Grant PII Data Clearance (Allow processing SSN, Email, Financials)
              </label>
            </div>

            {message && (
              <div
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  marginBottom: '1rem',
                  fontSize: '0.85rem',
                  backgroundColor: message.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
                  color: message.type === 'success' ? '#34d399' : '#fb7185',
                  border: `1px solid ${message.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
                }}
              >
                {message.text}
              </div>
            )}

            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
                {loading ? 'Authenticating...' : 'Arm Security Context'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onProceed}
              >
                Proceed to Plan Studio &rarr;
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
