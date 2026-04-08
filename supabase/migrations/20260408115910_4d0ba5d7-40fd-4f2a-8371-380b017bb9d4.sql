
-- ============================================================
-- 1. FIX VENDOR RLS: Restrict writes to admin/staff
-- ============================================================
DROP POLICY IF EXISTS "auth_manage_vendor" ON public.vendor;

CREATE POLICY "vendor_staff_write" ON public.vendor
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- ============================================================
-- 2. FIX PAYOUT FEE RLS: Restrict to admin/staff
-- ============================================================
DROP POLICY IF EXISTS "auth_select_payout_fee" ON public.payout_fee;
CREATE POLICY "staff_select_payout_fee" ON public.payout_fee
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

DROP POLICY IF EXISTS "auth_select_payout_fee_line" ON public.payout_fee_line;
CREATE POLICY "staff_select_payout_fee_line" ON public.payout_fee_line
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- ============================================================
-- 3. FIX COGS EXPOSURE: Safe RPC for customer order lines
-- ============================================================
DROP POLICY IF EXISTS "Members read own order lines" ON public.sales_order_line;

CREATE POLICY "Members read own order lines" ON public.sales_order_line
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff')
    OR EXISTS (
      SELECT 1 FROM public.sales_order so
      WHERE so.id = sales_order_line.sales_order_id
        AND so.user_id = auth.uid()
    )
  );

-- Safe RPC returning order lines WITHOUT cogs for customers
CREATE OR REPLACE FUNCTION public.get_my_order_lines(p_order_id uuid)
RETURNS TABLE(
  id uuid,
  sales_order_id uuid,
  sku_id uuid,
  quantity integer,
  unit_price numeric,
  line_total numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT sol.id, sol.sales_order_id, sol.sku_id,
         sol.quantity, sol.unit_price, sol.line_total
  FROM public.sales_order_line sol
  JOIN public.sales_order so ON so.id = sol.sales_order_id
  WHERE sol.sales_order_id = p_order_id
    AND so.user_id = auth.uid();
$$;

-- ============================================================
-- 4. FIX SECURITY DEFINER VIEWS
-- ============================================================
ALTER VIEW public.unit_profit_view SET (security_invoker = on);
ALTER VIEW public.sku_public SET (security_invoker = on);

-- ============================================================
-- 5. FIX FUNCTION SEARCH PATHS
-- ============================================================
CREATE OR REPLACE FUNCTION public.v2_link_unmatched_payout_fees()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
DECLARE updated_count INTEGER;
BEGIN
  UPDATE public.payout_fee pf
  SET sales_order_id = so.id, updated_at = now()
  FROM public.sales_order so
  WHERE pf.sales_order_id IS NULL AND pf.external_order_id IS NOT NULL
    AND so.origin_reference = pf.external_order_id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN PERFORM pgmq.create(dlq_name); EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN PERFORM pgmq.delete(source_queue, message_id); EXCEPTION WHEN undefined_table THEN NULL; END;
  RETURN new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$function$;

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer)
 RETURNS TABLE(msg_id bigint, read_ct integer, message jsonb)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
BEGIN
  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name); RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_email(queue_name text, message_id bigint)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
BEGIN
  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN RETURN FALSE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.csv_sync_apply_changeset(p_session_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE
  v_session RECORD; v_row RECORD; v_table TEXT;
  v_insert_count INTEGER := 0; v_update_count INTEGER := 0; v_delete_count INTEGER := 0;
  v_cols TEXT[]; v_vals TEXT[]; v_sets TEXT[]; v_key TEXT; v_val TEXT; v_sql TEXT; v_user_id UUID;
BEGIN
  SELECT * INTO v_session FROM csv_sync_session WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found: %', p_session_id; END IF;
  IF v_session.status != 'previewed' THEN RAISE EXCEPTION 'Session status must be "previewed", got "%"', v_session.status; END IF;
  IF EXISTS (SELECT 1 FROM csv_sync_changeset WHERE session_id = p_session_id AND array_length(errors, 1) > 0) THEN
    RAISE EXCEPTION 'Cannot apply: changeset contains errors';
  END IF;
  v_table := v_session.table_name; v_user_id := v_session.performed_by;
  FOR v_row IN SELECT * FROM csv_sync_changeset WHERE session_id = p_session_id ORDER BY CASE action WHEN 'insert' THEN 1 WHEN 'update' THEN 2 WHEN 'delete' THEN 3 END
  LOOP
    IF v_row.action = 'insert' THEN
      v_cols := ARRAY[]::TEXT[]; v_vals := ARRAY[]::TEXT[];
      FOR v_key, v_val IN SELECT * FROM jsonb_each_text(v_row.after_data) LOOP
        v_cols := array_append(v_cols, quote_ident(v_key)); v_vals := array_append(v_vals, quote_literal(v_val));
      END LOOP;
      v_sql := format('INSERT INTO %I (%s) VALUES (%s)', v_table, array_to_string(v_cols, ', '), array_to_string(v_vals, ', '));
      EXECUTE v_sql;
      INSERT INTO csv_sync_audit (session_id, table_name, action, row_id, before_data, after_data, performed_by)
      VALUES (p_session_id, v_table, 'insert', COALESCE(v_row.after_data->>'id', v_row.row_id, 'unknown'), NULL, v_row.after_data, v_user_id);
      v_insert_count := v_insert_count + 1;
    ELSIF v_row.action = 'update' THEN
      v_sets := ARRAY[]::TEXT[];
      FOR v_key, v_val IN SELECT * FROM jsonb_each_text(v_row.after_data) LOOP
        IF v_key = ANY(v_row.changed_fields) THEN v_sets := array_append(v_sets, format('%I = %L', v_key, v_val)); END IF;
      END LOOP;
      IF array_length(v_sets, 1) > 0 THEN
        v_sql := format('UPDATE %I SET %s WHERE id = %L', v_table, array_to_string(v_sets, ', '), v_row.row_id);
        EXECUTE v_sql;
      END IF;
      INSERT INTO csv_sync_audit (session_id, table_name, action, row_id, before_data, after_data, performed_by) VALUES (p_session_id, v_table, 'update', v_row.row_id, v_row.before_data, v_row.after_data, v_user_id);
      v_update_count := v_update_count + 1;
    ELSIF v_row.action = 'delete' THEN
      v_sql := format('DELETE FROM %I WHERE id = %L', v_table, v_row.row_id); EXECUTE v_sql;
      INSERT INTO csv_sync_audit (session_id, table_name, action, row_id, before_data, after_data, performed_by) VALUES (p_session_id, v_table, 'delete', v_row.row_id, v_row.before_data, NULL, v_user_id);
      v_delete_count := v_delete_count + 1;
    END IF;
  END LOOP;
  UPDATE csv_sync_session SET status = 'applied', insert_count = v_insert_count, update_count = v_update_count, delete_count = v_delete_count, applied_at = now() WHERE id = p_session_id;
  RETURN jsonb_build_object('applied', true, 'insert_count', v_insert_count, 'update_count', v_update_count, 'delete_count', v_delete_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.csv_sync_rollback_session(p_session_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE
  v_session RECORD; v_row RECORD; v_table TEXT; v_reverted INTEGER := 0;
  v_cols TEXT[]; v_vals TEXT[]; v_key TEXT; v_val TEXT; v_sql TEXT;
BEGIN
  SELECT * INTO v_session FROM csv_sync_session WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found: %', p_session_id; END IF;
  IF v_session.status != 'applied' THEN RAISE EXCEPTION 'Session status must be "applied", got "%"', v_session.status; END IF;
  v_table := v_session.table_name;
  IF EXISTS (SELECT 1 FROM csv_sync_session WHERE table_name = v_table AND status = 'applied' AND applied_at > v_session.applied_at) THEN
    RAISE EXCEPTION 'Cannot rollback: a newer sync has been applied to this table';
  END IF;
  FOR v_row IN SELECT * FROM csv_sync_audit WHERE session_id = p_session_id ORDER BY CASE action WHEN 'delete' THEN 1 WHEN 'update' THEN 2 WHEN 'insert' THEN 3 END
  LOOP
    IF v_row.action = 'insert' THEN
      v_sql := format('DELETE FROM %I WHERE id = %L', v_table, v_row.row_id); EXECUTE v_sql;
    ELSIF v_row.action = 'update' THEN
      v_cols := ARRAY[]::TEXT[];
      FOR v_key, v_val IN SELECT * FROM jsonb_each_text(v_row.before_data) LOOP v_cols := array_append(v_cols, format('%I = %L', v_key, v_val)); END LOOP;
      v_sql := format('UPDATE %I SET %s WHERE id = %L', v_table, array_to_string(v_cols, ', '), v_row.row_id); EXECUTE v_sql;
    ELSIF v_row.action = 'delete' THEN
      v_cols := ARRAY[]::TEXT[]; v_vals := ARRAY[]::TEXT[];
      FOR v_key, v_val IN SELECT * FROM jsonb_each_text(v_row.before_data) LOOP
        v_cols := array_append(v_cols, quote_ident(v_key)); v_vals := array_append(v_vals, quote_literal(v_val));
      END LOOP;
      v_sql := format('INSERT INTO %I (%s) VALUES (%s)', v_table, array_to_string(v_cols, ', '), array_to_string(v_vals, ', ')); EXECUTE v_sql;
    END IF;
    v_reverted := v_reverted + 1;
  END LOOP;
  UPDATE csv_sync_session SET status = 'rolled_back', rolled_back_at = now() WHERE id = p_session_id;
  RETURN jsonb_build_object('rolled_back', true, 'rows_reverted', v_reverted);
END;
$function$;

CREATE OR REPLACE FUNCTION public.v2_on_grade_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE v_sku_code TEXT; v_affected_sku TEXT;
BEGIN
  IF NEW.condition_grade IS NOT NULL AND NEW.mpn IS NOT NULL THEN
    v_sku_code := NEW.mpn || '.' || NEW.condition_grade::text;
    PERFORM public.v2_recalculate_variant_stats(v_sku_code);
    IF OLD.condition_grade IS NOT NULL AND OLD.condition_grade IS DISTINCT FROM NEW.condition_grade THEN
      PERFORM public.v2_recalculate_variant_stats(OLD.mpn || '.' || OLD.condition_grade::text);
    END IF;
    IF NEW.line_item_id IS NOT NULL AND (OLD.condition_grade IS NULL OR OLD.condition_grade IS DISTINCT FROM NEW.condition_grade) THEN
      PERFORM public.v2_reallocate_costs_by_grade(NEW.line_item_id);
      FOR v_affected_sku IN
        SELECT DISTINCT su2.mpn || '.' || su2.condition_grade::text FROM public.stock_unit su2
        WHERE su2.line_item_id = NEW.line_item_id AND su2.condition_grade IS NOT NULL
          AND (su2.mpn || '.' || su2.condition_grade::text) != v_sku_code
      LOOP PERFORM public.v2_recalculate_variant_stats(v_affected_sku); END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.v2_cascade_sku_price_to_listings()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
BEGIN
  IF NEW.price IS DISTINCT FROM OLD.price THEN
    UPDATE public.channel_listing SET listed_price = NEW.price, updated_at = now() WHERE sku_id = NEW.id AND v2_status = 'live';
    INSERT INTO public.price_audit_log (sku_id, sku_code, old_price, new_price, reason)
    VALUES (NEW.id, NEW.sku_code, OLD.price, NEW.price,
      CASE WHEN NEW.v2_markdown_applied IS DISTINCT FROM OLD.v2_markdown_applied AND NEW.v2_markdown_applied IS NOT NULL
        THEN 'auto_markdown_' || NEW.v2_markdown_applied ELSE 'manual' END);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.v2_recalculate_variant_stats(p_sku_code text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE v_sku_id UUID; v_avg NUMERIC(12,2); v_floor NUMERIC(12,2); v_min NUMERIC(12,2); v_max NUMERIC(12,2); v_range TEXT; v_margin NUMERIC;
BEGIN
  SELECT id INTO v_sku_id FROM public.sku WHERE sku_code = p_sku_code;
  IF v_sku_id IS NULL THEN RETURN; END IF;
  SELECT COALESCE((SELECT value FROM public.pricing_settings WHERE key = 'minimum_margin_target'), 0.25) INTO v_margin;
  SELECT ROUND(AVG(su.landed_cost), 2), ROUND(MAX(su.landed_cost) * (1 + v_margin), 2), MIN(su.landed_cost), MAX(su.landed_cost)
  INTO v_avg, v_floor, v_min, v_max FROM public.stock_unit su
  WHERE su.sku_id = v_sku_id AND su.v2_status IN ('graded', 'listed') AND su.landed_cost IS NOT NULL;
  IF v_min IS NULL THEN v_range := NULL;
  ELSIF v_min = v_max THEN v_range := '£' || v_min::text;
  ELSE v_range := '£' || v_min::text || '–£' || v_max::text; END IF;
  UPDATE public.sku SET avg_cost = v_avg, floor_price = v_floor, cost_range = v_range WHERE id = v_sku_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.v2_on_unit_sold()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE v_sku_code TEXT;
BEGIN
  IF NEW.v2_status = 'sold' AND (OLD.v2_status IS DISTINCT FROM 'sold') THEN
    IF NEW.sku_id IS NOT NULL THEN
      SELECT sku_code INTO v_sku_code FROM public.sku WHERE id = NEW.sku_id;
      IF v_sku_code IS NOT NULL THEN PERFORM public.v2_recalculate_variant_stats(v_sku_code); END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.v2_on_unit_restocked()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE v_sku_code TEXT;
BEGIN
  IF NEW.v2_status IN ('listed', 'restocked') AND OLD.v2_status IS DISTINCT FROM NEW.v2_status THEN
    IF NEW.sku_id IS NOT NULL THEN
      SELECT sku_code INTO v_sku_code FROM public.sku WHERE id = NEW.sku_id;
      IF v_sku_code IS NOT NULL THEN PERFORM public.v2_recalculate_variant_stats(v_sku_code); END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_users_detailed()
 RETURNS TABLE(user_id uuid, email text, display_name text, first_name text, last_name text, company_name text, avatar_url text, phone text, mobile text, ebay_username text, facebook_handle text, instagram_handle text, roles text[], order_count bigint, total_order_value numeric)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'staff')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, p.display_name, p.first_name, p.last_name, p.company_name, p.avatar_url, p.phone, p.mobile,
    p.ebay_username, p.facebook_handle, p.instagram_handle,
    COALESCE(array_agg(DISTINCT ur.role::text) FILTER (WHERE ur.role IS NOT NULL), ARRAY[]::text[]),
    COUNT(DISTINCT so.id), COALESCE(SUM(so.gross_total), 0)
  FROM auth.users u
  LEFT JOIN public.profile p ON p.user_id = u.id
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id
  LEFT JOIN public.sales_order so ON so.user_id = u.id OR (so.guest_email IS NOT NULL AND lower(so.guest_email) = lower(u.email))
  GROUP BY u.id, u.email, p.display_name, p.first_name, p.last_name, p.company_name, p.avatar_url, p.phone, p.mobile, p.ebay_username, p.facebook_handle, p.instagram_handle;
END;
$function$;

CREATE OR REPLACE FUNCTION public.v2_reallocate_costs_by_grade(p_line_item_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE v_total_landed NUMERIC; v_total_expected_revenue NUMERIC; rec RECORD;
  grade_ratio NUMERIC[] := ARRAY[1.0, 0.8, 0.6, 0.4];
BEGIN
  SELECT quantity * landed_cost_per_unit INTO v_total_landed FROM public.purchase_line_items WHERE id = p_line_item_id;
  IF v_total_landed IS NULL OR v_total_landed = 0 THEN RETURN; END IF;
  SELECT COALESCE(SUM(CASE WHEN sk.market_price IS NOT NULL AND sk.market_price > 0 THEN sk.market_price ELSE grade_ratio[su.condition_grade::integer] * 100 END), 0)
  INTO v_total_expected_revenue FROM public.stock_unit su LEFT JOIN public.sku sk ON sk.sku_code = (su.mpn || '.' || su.condition_grade::text)
  WHERE su.line_item_id = p_line_item_id AND su.condition_grade IS NOT NULL;
  IF v_total_expected_revenue = 0 THEN RETURN; END IF;
  FOR rec IN
    SELECT su.id AS unit_id, CASE WHEN sk.market_price IS NOT NULL AND sk.market_price > 0 THEN sk.market_price ELSE grade_ratio[su.condition_grade::integer] * 100 END AS expected_price
    FROM public.stock_unit su LEFT JOIN public.sku sk ON sk.sku_code = (su.mpn || '.' || su.condition_grade::text)
    WHERE su.line_item_id = p_line_item_id AND su.condition_grade IS NOT NULL
  LOOP
    UPDATE public.stock_unit SET landed_cost = ROUND((rec.expected_price / v_total_expected_revenue) * v_total_landed, 2) WHERE id = rec.unit_id;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.v2_calculate_apportioned_costs(p_batch_id text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE v_total_shared NUMERIC(12,2); v_total_unit_cost NUMERIC;
BEGIN
  SELECT total_shared_costs INTO v_total_shared FROM public.purchase_batches WHERE id = p_batch_id;
  IF v_total_shared IS NULL OR v_total_shared = 0 THEN
    UPDATE public.purchase_line_items SET apportioned_cost = 0, landed_cost_per_unit = unit_cost WHERE batch_id = p_batch_id;
  ELSE
    SELECT COALESCE(SUM(unit_cost * quantity), 0) INTO v_total_unit_cost FROM public.purchase_line_items WHERE batch_id = p_batch_id;
    IF v_total_unit_cost > 0 THEN
      UPDATE public.purchase_line_items SET apportioned_cost = ROUND((unit_cost / v_total_unit_cost) * v_total_shared, 2),
        landed_cost_per_unit = unit_cost + ROUND((unit_cost / v_total_unit_cost) * v_total_shared, 2) WHERE batch_id = p_batch_id;
    END IF;
  END IF;
  UPDATE public.stock_unit su SET landed_cost = pli.landed_cost_per_unit FROM public.purchase_line_items pli WHERE su.line_item_id = pli.id AND su.batch_id = p_batch_id;
END;
$function$;
