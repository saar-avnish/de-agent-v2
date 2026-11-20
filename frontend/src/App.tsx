import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { LoginAccessPage } from './pages/LoginAccessPage';
import { PlanStudioPage } from './pages/PlanStudioPage';
import { GateMonitorPage } from './pages/GateMonitorPage';
import { SecurityContext, PlannerContract, ExecutionReport } from './types';

const INITIAL_SECURITY_CONTEXT: SecurityContext = {
  user_id: 'lead_alice',
  role: 'lead_engineer',
  allowed_domains: ['sales', 'marketing', 'core', 'finance'],
  pii_clearance: true,
};

const INITIAL_PLANNER: PlannerContract = {
  project_name: 'enterprise_dw',
  warehouse: 'duckdb',
  domain: 'sales',
  sources: [
    {
      name: 'raw_crm',
      schema_name: 'raw_crm',
      database: 'analytics',
      description: 'Core transactional CRM data',
      tables: [
        {
          name: 'orders',
          description: 'Inbound customer order headers',
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
          description: 'Validate staging ID renaming and schema cleaning',
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
          description: 'Validate business metrics and discount math',
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
  ],
};

export const App: React.FC = () => {
  const [activePage, setActivePage] = useState<'auth' | 'studio' | 'monitor'>('studio');
  const [securityContext, setSecurityContext] = useState<SecurityContext>(INITIAL_SECURITY_CONTEXT);
  const [sessionId, setSessionId] = useState<string>('dev-default-session');
  const [planner, setPlanner] = useState<PlannerContract>(INITIAL_PLANNER);
  const [executionReport, setExecutionReport] = useState<ExecutionReport | null>(null);

  return (
    <div className="app-container">
      <Navbar
        activePage={activePage}
        setActivePage={setActivePage}
        securityContext={securityContext}
      />

      {activePage === 'auth' && (
        <LoginAccessPage
          securityContext={securityContext}
          setSecurityContext={setSecurityContext}
          setSessionId={setSessionId}
          onProceed={() => setActivePage('studio')}
        />
      )}

      {activePage === 'studio' && (
        <PlanStudioPage
          planner={planner}
          setPlanner={setPlanner}
          securityContext={securityContext}
          sessionId={sessionId}
          setExecutionReport={setExecutionReport}
          onExecute={() => setActivePage('monitor')}
        />
      )}

      {activePage === 'monitor' && (
        <GateMonitorPage
          report={executionReport}
          onBackToStudio={() => setActivePage('studio')}
        />
      )}
    </div>
  );
};
