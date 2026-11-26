import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { DbtInitModal } from './components/DbtInitModal';
import { PlanStudioPage } from './pages/PlanStudioPage';
import { GateMonitorPage } from './pages/GateMonitorPage';
import { PlannerContract, ExecutionReport, RuntimeConfig } from './types';
import { apiClient } from './services/api';

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
  const [activePage, setActivePage] = useState<'studio' | 'monitor'>('studio');
  const [planner, setPlanner] = useState<PlannerContract>(INITIAL_PLANNER);
  const [executionReport, setExecutionReport] = useState<ExecutionReport | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [isDbtModalOpen, setIsDbtModalOpen] = useState(false);

  // Sync latest execution and runtime config on load from backend server state
  useEffect(() => {
    apiClient.getLatestExecution()
      .then((report) => setExecutionReport(report))
      .catch(() => {});

    apiClient.getRuntimeConfig()
      .then((cfg) => setRuntimeConfig(cfg))
      .catch(() => {});
  }, []);

  const handleExecute = (report: ExecutionReport) => {
    setExecutionReport(report);
    setActivePage('monitor');
  };

  const handleRuntimeUpdated = (newConfig: RuntimeConfig) => {
    setRuntimeConfig(newConfig);
    setPlanner((prev) => ({
      ...prev,
      warehouse: newConfig.warehouse,
      project_name: newConfig.project_name,
    }));
  };

  return (
    <div className={`app-container ${activePage === 'monitor' ? 'app-container--locked' : ''}`}>
      <Navbar
        activePage={activePage}
        setActivePage={setActivePage}
        runtimeConfig={runtimeConfig}
        onOpenDbtInit={() => setIsDbtModalOpen(true)}
      />

      {activePage === 'studio' && (
        <PlanStudioPage
          planner={planner}
          setPlanner={setPlanner}
          onExecute={handleExecute}
        />
      )}

      {activePage === 'monitor' && (
        <GateMonitorPage
          report={executionReport}
          setReport={setExecutionReport}
          onBackToStudio={() => setActivePage('studio')}
        />
      )}

      <DbtInitModal
        isOpen={isDbtModalOpen}
        onClose={() => setIsDbtModalOpen(false)}
        onRuntimeUpdated={handleRuntimeUpdated}
      />
    </div>
  );
};
