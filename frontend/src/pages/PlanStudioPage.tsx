import React, { useState } from 'react';
import { PlannerContract, SecurityContext, ExecutionReport } from '../types';
import { apiClient } from '../services/api';

interface PlanStudioPageProps {
  planner: PlannerContract;
  setPlanner: (p: PlannerContract) => void;
  securityContext: SecurityContext;
  sessionId?: string;
  setExecutionReport: (report: ExecutionReport) => void;
  onExecute: () => void;
}

const TEMPLATES: Record<string, PlannerContract> = {
  ecommerce: {
    project_name: 'enterprise_dw',
    warehouse: 'duckdb',
    domain: 'sales',
    sources: [
      {
        name: 'raw_crm',
        schema_name: 'raw_crm',
        database: 'analytics',
        description: 'Core CRM transactional system',
        tables: [
          {
            name: 'orders',
            description: 'Raw inbound order items',
            columns: [
              { name: 'id', data_type: 'integer', data_tests: ['unique', 'not_null'] },
              { name: 'customer_id', data_type: 'integer', data_tests: ['not_null'] },
              { name: 'order_date', data_type: 'date' },
              { name: 'amount', data_type: 'numeric' },
            ],
          },
        ],
      },
    ],
    models: [
      {
        name: 'stg_orders',
        layer: 'staging',
        domain: 'sales',
        estimated_row_count: 45000,
        is_time_series: false,
        grain: ['order_id'],
        dependencies: ["source('raw_crm', 'orders')"],
        columns: [
          { name: 'order_id', data_type: 'integer', data_tests: ['unique', 'not_null'] },
          { name: 'customer_id', data_type: 'integer', data_tests: ['not_null'] },
          { name: 'amount', data_type: 'numeric' },
        ],
        tdd_fixtures: [
          {
            test_name: 'test_stg_orders_sanitization',
            description: 'Ensure raw staging orders map cleanly to integer surrogate IDs',
            given: [
              {
                input: "source('raw_crm', 'orders')",
                rows: [{ id: 1, customer_id: 10, order_date: '2026-01-01', amount: 99.99 }],
              },
            ],
            expect: {
              rows: [{ order_id: 1, customer_id: 10, amount: 99.99 }],
            },
          },
        ],
      },
      {
        name: 'int_orders_enriched',
        layer: 'intermediate',
        domain: 'sales',
        estimated_row_count: 150000,
        is_time_series: false,
        grain: ['order_id'],
        dependencies: ["ref('stg_orders')"],
        columns: [
          { name: 'order_id', data_type: 'integer', data_tests: ['unique', 'not_null'] },
          { name: 'customer_id', data_type: 'integer' },
          { name: 'order_value_tier', data_type: 'varchar' },
        ],
        tdd_fixtures: [],
      },
      {
        name: 'fct_orders',
        layer: 'mart',
        domain: 'sales',
        estimated_row_count: 2500000,
        is_time_series: true,
        grain: ['order_id'],
        dependencies: ["ref('int_orders_enriched')"],
        columns: [
          { name: 'order_id', data_type: 'integer', data_tests: ['unique', 'not_null'] },
          { name: 'customer_id', data_type: 'integer' },
          { name: 'net_sales', data_type: 'numeric' },
        ],
        tdd_fixtures: [
          {
            test_name: 'test_fct_orders_calculation',
            description: 'Validate net sales calculation and tier aggregation',
            given: [
              {
                input: "ref('int_orders_enriched')",
                rows: [{ order_id: 1, customer_id: 10, order_value_tier: 'HIGH' }],
              },
            ],
            expect: {
              rows: [{ order_id: 1, customer_id: 10, net_sales: 100.0 }],
            },
          },
        ],
      },
      {
        name: 'dim_customers',
        layer: 'mart',
        domain: 'sales',
        estimated_row_count: 35000,
        is_time_series: false,
        grain: ['customer_id'],
        scd_type: 'type_2',
        dependencies: ["ref('stg_orders')"],
        columns: [
          { name: 'customer_id', data_type: 'integer', data_tests: ['unique', 'not_null'] },
          { name: 'valid_from', data_type: 'timestamp' },
          { name: 'valid_to', data_type: 'timestamp' },
          { name: 'is_current', data_type: 'boolean' },
        ],
        tdd_fixtures: [],
      },
    ],
  },
  pii_simulation: {
    project_name: 'enterprise_dw',
    warehouse: 'duckdb',
    domain: 'sales',
    sources: [],
    models: [
      {
        name: 'stg_customer_sensitive',
        layer: 'staging',
        domain: 'sales',
        estimated_row_count: 15000,
        is_time_series: false,
        grain: ['customer_id'],
        dependencies: [],
        columns: [
          { name: 'customer_id', data_type: 'integer' },
          { name: 'social_security_num', data_type: 'varchar', is_pii: true, pii_type: 'SSN' },
        ],
        tdd_fixtures: [],
      },
    ],
  },
  cycle_simulation: {
    project_name: 'cyclical_pipeline',
    warehouse: 'duckdb',
    domain: 'sales',
    sources: [],
    models: [
      {
        name: 'stg_orders',
        layer: 'staging',
        domain: 'sales',
        estimated_row_count: 10000,
        is_time_series: false,
        grain: ['id'],
        dependencies: ["ref('fct_orders')"],
        columns: [{ name: 'id', data_type: 'integer' }],
        tdd_fixtures: [],
      },
      {
        name: 'fct_orders',
        layer: 'mart',
        domain: 'sales',
        estimated_row_count: 10000,
        is_time_series: false,
        grain: ['id'],
        dependencies: ["ref('stg_orders')"],
        columns: [{ name: 'id', data_type: 'integer' }],
        tdd_fixtures: [],
      },
    ],
  },
};

export const PlanStudioPage: React.FC<PlanStudioPageProps> = ({
  planner,
  setPlanner,
  securityContext,
  sessionId,
  setExecutionReport,
  onExecute,
}) => {
  const [jsonText, setJsonText] = useState(JSON.stringify(planner, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [dbtInitStatus, setDbtInitStatus] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  const handleJsonChange = (val: string) => {
    setJsonText(val);
    try {
      const parsed = JSON.parse(val);
      setPlanner(parsed);
      setJsonError(null);
    } catch (e: any) {
      setJsonError(e.message);
    }
  };

  const handleSelectTemplate = (key: string) => {
    const tmpl = TEMPLATES[key];
    if (tmpl) {
      setPlanner(tmpl);
      setJsonText(JSON.stringify(tmpl, null, 2));
      setJsonError(null);
    }
  };

  const handleTriggerDbtInit = async () => {
    try {
      setDbtInitStatus('Initializing workspace...');
      const res = await apiClient.initDbtWorkspace(planner.project_name, planner.warehouse);
      setDbtInitStatus(`✓ ${res.message}`);
    } catch (err: any) {
      setDbtInitStatus(`✗ ${err.message}`);
    }
  };

  const handleRunToStage2 = async () => {
    setExecuting(true);
    try {
      const report = await apiClient.runStagesToStage2(planner, securityContext, sessionId);
      setExecutionReport(report);
      onExecute();
    } catch (err: any) {
      alert(`Pipeline error: ${err.message}`);
    } finally {
      setExecuting(false);
    }
  };

  const getStrategyLabel = (m: any) => {
    if (m.estimated_row_count >= 1000000 && m.is_time_series) {
      return { name: 'IncrementalMergeStrategy', tag: '>=1M + time_series -> incremental' };
    } else if (m.estimated_row_count >= 100000) {
      return { name: 'TableStrategy', tag: '>=100k -> table' };
    }
    return { name: 'ViewStrategy', tag: '<100k -> view' };
  };

  return (
    <div className="page-content">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Page 2: Plan Studio & Synthesis Hub</h1>
          <p className="page-desc">
            Define Kimball & Medallion data engineering contracts, column-level data tests, and native dbt 1.8+ TDD fixtures.
            Inspect GoF materialization strategies and trigger Stage 1 &rarr; 1.5 &rarr; 2 execution.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleTriggerDbtInit}
          >
            🚀 Run `dbt init`
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleRunToStage2}
            disabled={executing || !!jsonError}
          >
            {executing ? 'Executing Stage Chain...' : '⚡ Run to Stage 2 &rarr;'}
          </button>
        </div>
      </div>

      {dbtInitStatus && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '0.5rem',
            marginBottom: '1.5rem',
            backgroundColor: dbtInitStatus.startsWith('✓') ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
            border: '1px solid var(--border-color)',
            fontSize: '0.875rem',
          }}
        >
          {dbtInitStatus}
        </div>
      )}

      {/* Preset & Meta selector */}
      <div className="card" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            SCENARIO TEMPLATES:
          </span>
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => handleSelectTemplate('ecommerce')}>
            🛒 E-Commerce Medallion
          </button>
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => handleSelectTemplate('pii_simulation')}>
            🚨 PII Violation Trigger
          </button>
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => handleSelectTemplate('cycle_simulation')}>
            🔄 DAG Cycle Trigger
          </button>
        </div>

        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem' }}>
          <span>Warehouse: <strong style={{ color: '#38bdf8' }}>{planner.warehouse}</strong></span>
          <span>Domain: <strong style={{ color: '#818cf8' }}>{planner.domain}</strong></span>
          <span>Models: <strong style={{ color: '#34d399' }}>{planner.models?.length || 0}</strong></span>
        </div>
      </div>

      <div className="grid-2">
        {/* Visual Model Hierarchy & Strategy Routing */}
        <div className="card">
          <div className="card-title">
            <span>Proposed Models & GoF Strategy Routing</span>
            <span className="badge badge-strategy">Medallion / Kimball</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {planner.models?.map((model, idx) => {
              const strat = getStrategyLabel(model);
              return (
                <div
                  key={model.name || idx}
                  style={{
                    padding: '1rem',
                    background: '#0b111e',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <strong style={{ fontSize: '1rem', color: '#f8fafc' }}>{model.name}</strong>
                      <span className={`badge badge-${model.layer}`}>{model.layer}</span>
                      {model.scd_type && <span className="badge badge-staging">{model.scd_type}</span>}
                    </div>
                    <span className="badge badge-strategy">{strat.name}</span>
                  </div>

                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <span>Grain: <code>[{model.grain?.join(', ')}]</code></span>
                    <span>Rows: <strong>{model.estimated_row_count?.toLocaleString()}</strong></span>
                    <span>Time Series: <strong>{model.is_time_series ? 'YES' : 'NO'}</strong></span>
                  </div>

                  {model.tdd_fixtures && model.tdd_fixtures.length > 0 && (
                    <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px dashed #1e293b' }}>
                      <span style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 600 }}>
                        🧪 Native dbt 1.8+ Unit Tests:
                      </span>
                      <ul style={{ fontSize: '0.75rem', color: '#cbd5e1', paddingLeft: '1rem' }}>
                        {model.tdd_fixtures.map((f) => (
                          <li key={f.test_name}>{f.test_name} ({f.given?.length} given inputs &rarr; expect rows)</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Live JSON Editor */}
        <div className="card">
          <div className="card-title">
            <span>planner.json Editor & Contract Validator</span>
            <span className="badge badge-staging">Stage 1 Input</span>
          </div>

          {jsonError && (
            <div style={{ padding: '0.5rem', marginBottom: '0.75rem', borderRadius: '0.375rem', background: 'rgba(244, 63, 94, 0.15)', color: '#fb7185', fontSize: '0.8rem' }}>
              JSON Syntax Error: {jsonError}
            </div>
          )}

          <textarea
            className="form-textarea"
            style={{ width: '100%', height: '520px' }}
            value={jsonText}
            onChange={(e) => handleJsonChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
};
