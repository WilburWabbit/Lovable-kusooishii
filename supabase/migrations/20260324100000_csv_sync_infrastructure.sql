-- ============================================================
-- CSV Sync Infrastructure
-- Four tables supporting the staged CSV round-trip workflow:
--   1. csv_sync_session   — parent record per sync operation
--   2. csv_sync_staging   — raw CSV rows landed on upload
--   3. csv_sync_changeset — computed diff (inserts/updates/deletes)
--   4. csv_sync_audit     — applied changes for audit trail & rollback
-- ============================================================

-- 1. Session
CREATE TABLE csv_sync_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  filename TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  insert_count INTEGER NOT NULL DEFAULT 0,
  update_count INTEGER NOT NULL DEFAULT 0,
  delete_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged','previewed','applied','rolled_back','error')),
  error_message TEXT,
  changeset_summary JSONB,
  performed_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ
);

-- 2. Staging (raw uploaded rows)
CREATE TABLE csv_sync_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES csv_sync_session(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw_data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','valid','error')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Changeset (computed diff)
CREATE TABLE csv_sync_changeset (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES csv_sync_session(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('insert','update','delete')),
  row_id TEXT,
  natural_key JSONB,
  before_data JSONB,
  after_data JSONB,
  changed_fields TEXT[],
  warnings TEXT[],
  errors TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Audit (applied changes — used for rollback)
CREATE TABLE csv_sync_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES csv_sync_session(id),
  table_name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('insert','update','delete')),
  row_id TEXT NOT NULL,
  before_data JSONB,
  after_data JSONB,
  performed_by UUID NOT NULL REFERENCES auth.users(id),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ────────────────────────────────────────────────

CREATE INDEX idx_csv_sync_session_table_status ON csv_sync_session(table_name, status);
CREATE INDEX idx_csv_sync_staging_session ON csv_sync_staging(session_id);
CREATE INDEX idx_csv_sync_changeset_session ON csv_sync_changeset(session_id);
CREATE INDEX idx_csv_sync_audit_session ON csv_sync_audit(session_id);
CREATE INDEX idx_csv_sync_audit_table_row ON csv_sync_audit(table_name, row_id);

-- ─── RLS ────────────────────────────────────────────────────

ALTER TABLE csv_sync_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_sync_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_sync_changeset ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_sync_audit ENABLE ROW LEVEL SECURITY;

-- Admin/staff access only (matches existing pattern from landing_raw_ebay_payout)
CREATE POLICY "csv_sync_session_admin" ON csv_sync_session
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin','staff')
    )
  );

CREATE POLICY "csv_sync_staging_admin" ON csv_sync_staging
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin','staff')
    )
  );

CREATE POLICY "csv_sync_changeset_admin" ON csv_sync_changeset
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin','staff')
    )
  );

CREATE POLICY "csv_sync_audit_admin" ON csv_sync_audit
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('admin','staff')
    )
  );

-- ─── Apply changeset atomically (called via supabase.rpc) ──

CREATE OR REPLACE FUNCTION csv_sync_apply_changeset(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session RECORD;
  v_row RECORD;
  v_table TEXT;
  v_insert_count INTEGER := 0;
  v_update_count INTEGER := 0;
  v_delete_count INTEGER := 0;
  v_cols TEXT[];
  v_vals TEXT[];
  v_sets TEXT[];
  v_key TEXT;
  v_val TEXT;
  v_sql TEXT;
  v_user_id UUID;
BEGIN
  -- Load session
  SELECT * INTO v_session FROM csv_sync_session WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found: %', p_session_id;
  END IF;
  IF v_session.status != 'previewed' THEN
    RAISE EXCEPTION 'Session status must be "previewed", got "%"', v_session.status;
  END IF;

  -- Check no errors in changeset
  IF EXISTS (
    SELECT 1 FROM csv_sync_changeset
    WHERE session_id = p_session_id AND array_length(errors, 1) > 0
  ) THEN
    RAISE EXCEPTION 'Cannot apply: changeset contains errors';
  END IF;

  v_table := v_session.table_name;
  v_user_id := v_session.performed_by;

  -- Process each changeset row
  FOR v_row IN
    SELECT * FROM csv_sync_changeset
    WHERE session_id = p_session_id
    ORDER BY
      CASE action WHEN 'insert' THEN 1 WHEN 'update' THEN 2 WHEN 'delete' THEN 3 END
  LOOP
    IF v_row.action = 'insert' THEN
      -- Build INSERT from after_data
      v_cols := ARRAY[]::TEXT[];
      v_vals := ARRAY[]::TEXT[];
      FOR v_key, v_val IN SELECT * FROM jsonb_each_text(v_row.after_data)
      LOOP
        v_cols := array_append(v_cols, quote_ident(v_key));
        v_vals := array_append(v_vals, quote_literal(v_val));
      END LOOP;

      v_sql := format(
        'INSERT INTO %I (%s) VALUES (%s)',
        v_table,
        array_to_string(v_cols, ', '),
        array_to_string(v_vals, ', ')
      );
      EXECUTE v_sql;

      -- Audit
      INSERT INTO csv_sync_audit (session_id, table_name, action, row_id, before_data, after_data, performed_by)
      VALUES (p_session_id, v_table, 'insert',
        COALESCE(v_row.after_data->>'id', v_row.row_id, 'unknown'),
        NULL, v_row.after_data, v_user_id);

      v_insert_count := v_insert_count + 1;

    ELSIF v_row.action = 'update' THEN
      -- Build UPDATE from after_data, only changed fields
      v_sets := ARRAY[]::TEXT[];
      FOR v_key, v_val IN SELECT * FROM jsonb_each_text(v_row.after_data)
      LOOP
        IF v_key = ANY(v_row.changed_fields) THEN
          v_sets := array_append(v_sets, format('%I = %L', v_key, v_val));
        END IF;
      END LOOP;

      IF array_length(v_sets, 1) > 0 THEN
        v_sql := format(
          'UPDATE %I SET %s WHERE id = %L',
          v_table,
          array_to_string(v_sets, ', '),
          v_row.row_id
        );
        EXECUTE v_sql;
      END IF;

      -- Audit
      INSERT INTO csv_sync_audit (session_id, table_name, action, row_id, before_data, after_data, performed_by)
      VALUES (p_session_id, v_table, 'update', v_row.row_id, v_row.before_data, v_row.after_data, v_user_id);

      v_update_count := v_update_count + 1;

    ELSIF v_row.action = 'delete' THEN
      v_sql := format('DELETE FROM %I WHERE id = %L', v_table, v_row.row_id);
      EXECUTE v_sql;

      -- Audit
      INSERT INTO csv_sync_audit (session_id, table_name, action, row_id, before_data, after_data, performed_by)
      VALUES (p_session_id, v_table, 'delete', v_row.row_id, v_row.before_data, NULL, v_user_id);

      v_delete_count := v_delete_count + 1;
    END IF;
  END LOOP;

  -- Update session
  UPDATE csv_sync_session
  SET status = 'applied',
      insert_count = v_insert_count,
      update_count = v_update_count,
      delete_count = v_delete_count,
      applied_at = now()
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'applied', true,
    'insert_count', v_insert_count,
    'update_count', v_update_count,
    'delete_count', v_delete_count
  );
END;
$$;

-- ─── Rollback function ─────────────────────────────────────

CREATE OR REPLACE FUNCTION csv_sync_rollback_session(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session RECORD;
  v_row RECORD;
  v_table TEXT;
  v_reverted INTEGER := 0;
  v_cols TEXT[];
  v_vals TEXT[];
  v_key TEXT;
  v_val TEXT;
  v_sql TEXT;
BEGIN
  SELECT * INTO v_session FROM csv_sync_session WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found: %', p_session_id;
  END IF;
  IF v_session.status != 'applied' THEN
    RAISE EXCEPTION 'Session status must be "applied", got "%"', v_session.status;
  END IF;

  v_table := v_session.table_name;

  -- Check this was the most recent applied sync for this table
  IF EXISTS (
    SELECT 1 FROM csv_sync_session
    WHERE table_name = v_table
      AND status = 'applied'
      AND applied_at > v_session.applied_at
  ) THEN
    RAISE EXCEPTION 'Cannot rollback: a newer sync has been applied to this table';
  END IF;

  -- Reverse in opposite order (deletes first, then updates, then inserts)
  FOR v_row IN
    SELECT * FROM csv_sync_audit
    WHERE session_id = p_session_id
    ORDER BY
      CASE action WHEN 'delete' THEN 1 WHEN 'update' THEN 2 WHEN 'insert' THEN 3 END
  LOOP
    IF v_row.action = 'insert' THEN
      -- Reverse insert = delete
      v_sql := format('DELETE FROM %I WHERE id = %L', v_table, v_row.row_id);
      EXECUTE v_sql;

    ELSIF v_row.action = 'update' THEN
      -- Reverse update = restore before_data
      v_cols := ARRAY[]::TEXT[];
      FOR v_key, v_val IN SELECT * FROM jsonb_each_text(v_row.before_data)
      LOOP
        v_cols := array_append(v_cols, format('%I = %L', v_key, v_val));
      END LOOP;
      v_sql := format('UPDATE %I SET %s WHERE id = %L', v_table, array_to_string(v_cols, ', '), v_row.row_id);
      EXECUTE v_sql;

    ELSIF v_row.action = 'delete' THEN
      -- Reverse delete = re-insert before_data
      v_cols := ARRAY[]::TEXT[];
      v_vals := ARRAY[]::TEXT[];
      FOR v_key, v_val IN SELECT * FROM jsonb_each_text(v_row.before_data)
      LOOP
        v_cols := array_append(v_cols, quote_ident(v_key));
        v_vals := array_append(v_vals, quote_literal(v_val));
      END LOOP;
      v_sql := format('INSERT INTO %I (%s) VALUES (%s)', v_table, array_to_string(v_cols, ', '), array_to_string(v_vals, ', '));
      EXECUTE v_sql;
    END IF;

    v_reverted := v_reverted + 1;
  END LOOP;

  UPDATE csv_sync_session
  SET status = 'rolled_back', rolled_back_at = now()
  WHERE id = p_session_id;

  RETURN jsonb_build_object('rolled_back', true, 'rows_reverted', v_reverted);
END;
$$;
