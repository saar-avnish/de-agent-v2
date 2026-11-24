export type ModelLayer = 'staging' | 'intermediate' | 'mart';
export type ScdType = 'type_0' | 'type_1' | 'type_2';

export interface ColumnSpec {
  name: string;
  data_type: string;
  description?: string;
  is_pii?: boolean;
  pii_type?: string;
  data_tests?: string[];
  quote?: boolean;
}

export interface TddFixtureGivenSpec {
  input: string;
  rows: Record<string, any>[];
}

export interface TddFixtureExpectSpec {
  rows: Record<string, any>[];
}

export interface TddFixtureSpec {
  test_name: string;
  description?: string;
  given: TddFixtureGivenSpec[];
  expect: TddFixtureExpectSpec;
}

export interface ModelSpec {
  name: string;
  layer: ModelLayer;
  domain: string;
  estimated_row_count: number;
  is_time_series: boolean;
  grain: string[];
  scd_type?: ScdType;
  dependencies: string[];
  columns: ColumnSpec[];
  tdd_fixtures: TddFixtureSpec[];
}

export interface SourceTableSpec {
  name: string;
  description?: string;
  columns?: ColumnSpec[];
}

export interface SourceSpec {
  name: string;
  schema_name?: string;
  database?: string;
  description?: string;
  tables: SourceTableSpec[];
}

export interface PlannerContract {
  project_name: string;
  warehouse: string;
  domain: string;
  sources: SourceSpec[];
  models: ModelSpec[];
}

export interface StageTrace {
  stage_name: string;
  status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'RUNNING';
  success: boolean;
  started_at: string;
  completed_at?: string;
  duration_ms: number;
  details: Record<string, any>;
  errors: string[];
}

export interface ExecutionReport {
  execution_id: string;
  project_name: string;
  success: boolean;
  short_circuited: boolean;
  stages: StageTrace[];
  artifacts: Record<string, any>;
  timestamp: string;
}

export interface WorkspaceFile {
  path: string;
  name: string;
  extension: string;
  size_bytes: number;
  content: string;
}

export interface HealthStatus {
  status: string;
  service: string;
  stage_max: string;
  stages: string[];
}
