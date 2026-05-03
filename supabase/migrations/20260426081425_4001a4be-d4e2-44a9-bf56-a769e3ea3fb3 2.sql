-- RPC to safely add a column to public.product on demand, used when a new
-- canonical_attribute is registered with a db_column that doesn't yet exist.
-- Restricted to a whitelist of safe data types and validates the column name.

CREATE OR REPLACE FUNCTION public.ensure_product_column(
  p_column_name text,
  p_data_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sql_type text;
  v_exists boolean;
BEGIN
  -- Validate column name: snake_case identifier, max 63 chars
  IF p_column_name !~ '^[a-z_][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'Invalid column name: %', p_column_name;
  END IF;

  -- Map canonical data_type → safe Postgres types
  v_sql_type := CASE lower(p_data_type)
    WHEN 'string'  THEN 'text'
    WHEN 'text'    THEN 'text'
    WHEN 'int'     THEN 'integer'
    WHEN 'integer' THEN 'integer'
    WHEN 'number'  THEN 'numeric'
    WHEN 'numeric' THEN 'numeric'
    WHEN 'bool'    THEN 'boolean'
    WHEN 'boolean' THEN 'boolean'
    WHEN 'date'    THEN 'date'
    WHEN 'timestamp' THEN 'timestamptz'
    WHEN 'json'    THEN 'jsonb'
    WHEN 'jsonb'   THEN 'jsonb'
    ELSE NULL
  END;

  IF v_sql_type IS NULL THEN
    RAISE EXCEPTION 'Unsupported data type: %', p_data_type;
  END IF;

  -- Check if column already exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product'
      AND column_name = p_column_name
  ) INTO v_exists;

  IF v_exists THEN
    RETURN jsonb_build_object('created', false, 'column', p_column_name, 'sql_type', v_sql_type);
  END IF;

  EXECUTE format('ALTER TABLE public.product ADD COLUMN %I %s', p_column_name, v_sql_type);
  RETURN jsonb_build_object('created', true, 'column', p_column_name, 'sql_type', v_sql_type);
END;
$$;

-- Only authenticated admins should be able to call this. The edge function uses
-- the service role which bypasses RLS, but explicitly grant for clarity.
REVOKE ALL ON FUNCTION public.ensure_product_column(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_product_column(text, text) TO service_role;