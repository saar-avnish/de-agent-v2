import React, { useState, useRef } from 'react';
import { PlannerContract, ExecutionReport } from '../types';
import { apiClient } from '../services/api';

interface PlanStudioPageProps {
  planner: PlannerContract;
  setPlanner: (p: PlannerContract) => void;
  onExecute: (report: ExecutionReport) => void;
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
  saas_billing: {
    project_name: 'saas_analytics',
    warehouse: 'duckdb',
    domain: 'finance',
    sources: [
      {
        name: 'stripe_raw',
        tables: [
          {
            name: 'charges',
            columns: [
              { name: 'charge_id', data_type: 'varchar' },
              { name: 'customer_id', data_type: 'varchar' },
              { name: 'amount_cents', data_type: 'integer' },
              { name: 'created_at', data_type: 'timestamp' },
            ],
          },
        ],
      },
    ],
    models: [
      {
        name: 'stg_stripe_charges',
        layer: 'staging',
        domain: 'finance',
        estimated_row_count: 85000,
        is_time_series: false,
        grain: ['charge_id'],
        dependencies: ["source('stripe_raw', 'charges')"],
        columns: [
          { name: 'charge_id', data_type: 'varchar', data_tests: ['unique', 'not_null'] },
          { name: 'customer_id', data_type: 'varchar', data_tests: ['not_null'] },
          { name: 'amount_usd', data_type: 'numeric' },
        ],
        tdd_fixtures: [
          {
            test_name: 'test_cents_to_usd_conversion',
            given: [
              {
                input: "source('stripe_raw', 'charges')",
                rows: [{ charge_id: 'ch_1', customer_id: 'cus_1', amount_cents: 2900 }],
              },
            ],
            expect: {
              rows: [{ charge_id: 'ch_1', customer_id: 'cus_1', amount_usd: 29.0 }],
            },
          },
        ],
      },
      {
        name: 'fct_mrr_movements',
        layer: 'mart',
        domain: 'finance',
        estimated_row_count: 1200000,
        is_time_series: true,
        grain: ['charge_id'],
        dependencies: ["ref('stg_stripe_charges')"],
        columns: [
          { name: 'charge_id', data_type: 'varchar', data_tests: ['unique', 'not_null'] },
          { name: 'mrr_delta', data_type: 'numeric' },
        ],
        tdd_fixtures: [],
      },
    ],
  },
  pii_violation: {
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
          { name: 'social_security_num', data_type: 'varchar', is_pii: true, pii_type: '' },
        ],
        tdd_fixtures: [],
      },
    ],
  },
  dag_cycle: {
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
  onExecute,
}) => {
  const [jsonText, setJsonText] = useState(JSON.stringify(planner, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const formatted = JSON.stringify(parsed, null, 2);
      setJsonText(formatted);
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        setPlanner(parsed);
        setJsonText(JSON.stringify(parsed, null, 2));
        setJsonError(null);
      } catch (err: any) {
        setJsonError(`File parse failed: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const handleRunToStage2 = async () => {
    setExecuting(true);
    try {
      const report = await apiClient.runStagesToStage2(planner);
      onExecute(report);
    } catch (err: any) {
      alert(`Pipeline execution error: ${err.message}`);
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
          <h1 className="page-title">Page 1: Plan Studio &amp; Synthesis Hub</h1>
          <p className="page-desc">
            Define Kimball &amp; Medallion data contracts, column-level data tests, and native dbt 1.8+ TDD fixtures.
            Inspect GoF materialization strategies and trigger Stage 1 &rarr; Stage 2 validation and synthesis.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ fontSize: '0.95rem', padding: '0.75rem 1.5rem' }}
          onClick={handleRunToStage2}
          disabled={executing || !!jsonError}
        >
          {executing ? 'Executing Validation & Synthesis...' : 'Run Validation & Synthesis →'}
        </button>
      </div>

      {/* Preset & Action Strip */}
      <div className="card" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            SCENARIO PRESETS:
          </span>
          <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }} onClick={() => handleSelectTemplate('ecommerce')}>
            🛒 E-Commerce Medallion
          </button>
          <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }} onClick={() => handleSelectTemplate('saas_billing')}>
            💳 SaaS Billing
          </button>
          <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }} onClick={() => handleSelectTemplate('pii_violation')}>
            🚨 PII Governance Violation
          </button>
          <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }} onClick={() => handleSelectTemplate('dag_cycle')}>
            🔄 DAG Cycle Failure
          </button>

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".json"
            onChange={handleFileUpload}
          />
          <button
            className="btn btn-secondary"
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', borderColor: 'var(--accent-blue)', color: '#38bdf8' }}
            onClick={() => fileInputRef.current?.click()}
          >
            📁 Upload planner.json
          </button>

          <button
            className="btn btn-secondary"
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
            onClick={handleFormatJson}
            title="Prettify JSON indentation"
          >
            ✨ Format JSON
          </button>
        </div>

        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem' }}>
          <span>Warehouse: <strong style={{ color: '#38bdf8' }}>{planner.warehouse}</strong></span>
          <span>Domain: <strong style={{ color: '#818cf8' }}>{planner.domain}</strong></span>
          <span>Models: <strong style={{ color: '#34d399' }}>{planner.models?.length || 0}</strong></span>
        </div>
      </div>

      <div className="grid-2">
        {/* Pre-Flight Visual Model Hierarchy & Strategy Routing */}
        <div className="card">
          <div className="card-title">
            <span>Pre-Flight Model Hierarchy &amp; Strategy Preview</span>
            <span className="badge badge-strategy">Medallion / Kimball</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '560px', overflowY: 'auto' }}>
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
                      <span className="badge badge-staging" style={{ fontSize: '0.7rem', marginBottom: '0.3rem' }}>
                        🧪 Native dbt 1.8+ Unit Tests ({model.tdd_fixtures.length})
                      </span>
                      <ul style={{ fontSize: '0.75rem', color: '#cbd5e1', paddingLeft: '1rem', marginTop: '0.25rem' }}>
                        {model.tdd_fixtures.map((f) => (
                          <li key={f.test_name}>{f.test_name} ({f.given?.length} inputs &rarr; expected rows)</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Monospace JSON Editor */}
        <div className="card">
          <div className="card-title">
            <span>planner.json Contract Editor</span>
            {jsonError ? (
              <span className="badge badge-failed">Invalid JSON</span>
            ) : (
              <span className="badge badge-passed">Valid JSON</span>
            )}
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
