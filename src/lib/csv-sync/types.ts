// ============================================================
// CSV Sync — TypeScript Types
// ============================================================

// ─── Session ────────────────────────────────────────────────

export type SyncSessionStatus =
  | 'staged'
  | 'previewed'
  | 'applied'
  | 'rolled_back'
  | 'error';

export interface CsvSyncSession {
  id: string;
  tableName: string;
  filename: string;
  rowCount: number;
  insertCount: number;
  updateCount: number;
  deleteCount: number;
  warningCount: number;
  errorCount: number;
  status: SyncSessionStatus;
  errorMessage: string | null;
  changesetSummary: unknown | null;
  performedBy: string;
  createdAt: string;
  appliedAt: string | null;
  rolledBackAt: string | null;
}

// ─── Changeset ──────────────────────────────────────────────

export type ChangesetAction = 'insert' | 'update' | 'delete';

export interface ChangesetRow {
  id: string;
  sessionId: string;
  action: ChangesetAction;
  rowId: string | null;
  naturalKey: Record<string, string> | null;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  changedFields: string[];
  warnings: string[];
  errors: string[];
}

// ─── Diff Response ──────────────────────────────────────────

export interface DiffResult {
  sessionId: string;
  inserts: number;
  updates: number;
  deletes: number;
  errors: number;
  warnings: number;
  changeset: ChangesetRow[];
}

// ─── Apply / Rollback Response ──────────────────────────────

export interface ApplyResult {
  applied: boolean;
  insertCount: number;
  updateCount: number;
  deleteCount: number;
}

export interface RollbackResult {
  rolledBack: boolean;
  rowsReverted: number;
}

// ─── Table Registry Types ───────────────────────────────────

export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json' | 'enum';
export type ColumnMode = 'editable' | 'readonly' | 'fk';

export interface CsvColumnConfig {
  dbColumn: string;
  csvHeader: string;
  type: ColumnType;
  mode: ColumnMode;
  required: boolean;
  enumValues?: string[];
}

export interface FkResolver {
  fkColumn: string;
  csvLookupColumn: string;
  targetTable: string;
  targetLookupColumn: string;
  targetPkColumn: string;
}

export interface CsvTableConfig {
  tableName: string;
  displayName: string;
  primaryKey: string;
  naturalKeys: string[];
  columns: CsvColumnConfig[];
  fkResolvers: FkResolver[];
  exportOrderBy: string;
  allowDelete: boolean;
  parentTable?: string;
}

// ─── Stage Request ──────────────────────────────────────────

export interface StageResult {
  sessionId: string;
  rowCount: number;
}
