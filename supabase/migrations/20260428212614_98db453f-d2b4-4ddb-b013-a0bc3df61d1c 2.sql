REVOKE EXECUTE ON FUNCTION public.allocate_order_line_stock_unit(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.allocate_order_line_stock_unit(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.allocate_order_line_stock_unit(uuid, uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.v2_consume_fifo_unit(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.v2_consume_fifo_unit(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.v2_consume_fifo_unit(text) TO authenticated;