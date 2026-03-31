// ============================================================
// AI Assistant Edge Function
// Natural-language chat assistant for Kuso Hub admin.
// Uses Claude API tool_use to query/update the database.
// ============================================================

import {
  corsHeaders,
  createAdminClient,
  authenticateRequest,
  jsonResponse,
  errorResponse,
} from "../_shared/qbo-helpers.ts";

// ─── System Prompt ──────────────────────────────────────────

const SYSTEM_PROMPT = `You are Kuso AI, the operations assistant for Kuso — a LEGO resale commerce platform based in the UK.

You help the admin (Will) with:
- Checking stock levels and inventory status
- Searching the product catalogue
- Viewing and managing orders
- Calculating margins and financial summaries

Rules:
- Be concise and direct. Use bullet points or short tables for data.
- Format currency as GBP (£). Use 2 decimal places.
- Order numbers look like KO-XXXXXXX. Always display them when referencing orders.
- MPN format includes version suffix, e.g. 75367-1. Never drop it.
- SKU format is MPN.grade, e.g. 75367-1.3.
- Condition grades: 1 (Gold/best) → 4 (Black Sheep/lowest saleable), 5 (non-saleable).
- For write actions (like marking an order shipped), ALWAYS confirm with the user before executing. State what you will do and ask "Shall I go ahead?"
- If a query returns no data, say so clearly — don't fabricate results.
- When showing multiple items, limit to the most relevant 10 unless asked for more.`;

// ─── Tool Definitions ───────────────────────────────────────

const TOOLS = [
  {
    name: "get_stock_summary",
    description:
      "Get a summary of current stock levels grouped by status, plus total inventory value. Call this when the user asks about stock counts, inventory levels, or how many items are in each stage.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "search_products",
    description:
      "Search the product catalogue by name, theme, or MPN. Returns matching products with key details.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search term — matches against product name or MPN",
        },
        limit: {
          type: "number",
          description: "Max results to return (default 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_orders",
    description:
      "List recent orders, optionally filtered by status. Use this when the user asks about orders, what needs shipping, recent sales, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          description:
            "Filter by v2 status: new, needs_allocation, sold, shipped, delivered, complete, return_pending, refunded, etc. Leave empty for all.",
        },
        limit: {
          type: "number",
          description: "Max results (default 10)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_order_detail",
    description:
      "Get full details for a specific order including line items, customer info, and shipping details. Use the order_number (e.g. KO-0001234) or order id.",
    input_schema: {
      type: "object" as const,
      properties: {
        order_number: {
          type: "string",
          description: "The order number (e.g. KO-0001234) or UUID",
        },
      },
      required: ["order_number"],
    },
  },
  {
    name: "mark_order_shipped",
    description:
      "Mark an order as shipped with carrier and optional tracking number. ONLY call this after the user has confirmed they want to proceed.",
    input_schema: {
      type: "object" as const,
      properties: {
        order_id: {
          type: "string",
          description: "The UUID of the order to mark as shipped",
        },
        carrier: {
          type: "string",
          description:
            "Shipping carrier, e.g. Royal Mail, Evri, DPD, Yodel, UPS, FedEx",
        },
        tracking_number: {
          type: "string",
          description: "Tracking number (optional)",
        },
      },
      required: ["order_id", "carrier"],
    },
  },
  {
    name: "get_margin_for_item",
    description:
      "Calculate margin for a specific SKU code. Shows landed cost, sale price, and margin percentage.",
    input_schema: {
      type: "object" as const,
      properties: {
        sku_code: {
          type: "string",
          description: "The SKU code, e.g. 75367-1.3",
        },
      },
      required: ["sku_code"],
    },
  },
  {
    name: "get_financial_summary",
    description:
      "Get revenue, COGS, and gross margin for a date range. Use this for profit questions, monthly summaries, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        start_date: {
          type: "string",
          description: "Start date in ISO format, e.g. 2026-03-01",
        },
        end_date: {
          type: "string",
          description: "End date in ISO format, e.g. 2026-03-31",
        },
      },
      required: ["start_date", "end_date"],
    },
  },
];

// ─── Tool Handlers ──────────────────────────────────────────

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

async function handleGetStockSummary(admin: SupabaseAdmin) {
  // Count by v2_status
  const { data: units, error } = await admin
    .from("stock_unit")
    .select("v2_status");

  if (error) throw new Error(`stock_unit query failed: ${error.message}`);

  const counts: Record<string, number> = {};
  let total = 0;
  for (const row of units ?? []) {
    const status = (row as Record<string, unknown>).v2_status as string ?? "unknown";
    counts[status] = (counts[status] ?? 0) + 1;
    total++;
  }

  // Total value of active stock
  const { data: valueRows, error: valErr } = await admin
    .from("stock_unit")
    .select("landed_cost")
    .not("v2_status" as never, "in", '("shipped","delivered","complete","written_off","scrap","refunded")');

  if (valErr) throw new Error(`stock value query failed: ${valErr.message}`);

  let totalValue = 0;
  for (const row of valueRows ?? []) {
    totalValue += ((row as Record<string, unknown>).landed_cost as number) ?? 0;
  }

  return {
    total_units: total,
    by_status: counts,
    active_inventory_value: Math.round(totalValue * 100) / 100,
  };
}

async function handleSearchProducts(
  admin: SupabaseAdmin,
  input: { query: string; limit?: number },
) {
  const limit = input.limit ?? 10;

  const { data, error } = await admin
    .from("catalog_product")
    .select("id, mpn, name, product_type, release_year, piece_count, retired_flag, status")
    .or(`name.ilike.%${input.query}%,mpn.ilike.%${input.query}%`)
    .limit(limit);

  if (error) throw new Error(`product search failed: ${error.message}`);

  return { count: (data ?? []).length, products: data ?? [] };
}

async function handleGetOrders(
  admin: SupabaseAdmin,
  input: { status?: string; limit?: number },
) {
  const limit = input.limit ?? 10;

  let query = admin
    .from("sales_order")
    .select("id, order_number, origin_channel, v2_status, gross_total, txn_date, created_at, shipped_via, tracking_number")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.status) {
    query = query.eq("v2_status" as never, input.status);
  }

  const { data, error } = await query;
  if (error) throw new Error(`orders query failed: ${error.message}`);

  return { count: (data ?? []).length, orders: data ?? [] };
}

async function handleGetOrderDetail(
  admin: SupabaseAdmin,
  input: { order_number: string },
) {
  // Try by order_number first, fall back to id
  let orderQuery = admin
    .from("sales_order")
    .select("*")
    .eq("order_number", input.order_number)
    .maybeSingle();

  let { data: order, error } = await orderQuery;

  if (!order && !error) {
    // Try as UUID
    const res = await admin
      .from("sales_order")
      .select("*")
      .eq("id", input.order_number)
      .maybeSingle();
    order = res.data;
    error = res.error;
  }

  if (error) throw new Error(`order detail query failed: ${error.message}`);
  if (!order) return { error: `Order ${input.order_number} not found` };

  // Get line items
  const { data: lines, error: lineErr } = await admin
    .from("sales_order_line")
    .select("id, sku_id, stock_unit_id, quantity, unit_price, line_discount, line_total")
    .eq("sales_order_id", (order as Record<string, unknown>).id as string);

  if (lineErr) throw new Error(`order lines query failed: ${lineErr.message}`);

  // Enrich with stock unit info
  const enrichedLines = [];
  for (const line of lines ?? []) {
    const l = line as Record<string, unknown>;
    let unitInfo = null;
    if (l.stock_unit_id) {
      const { data: unit } = await admin
        .from("stock_unit")
        .select("uid, mpn, condition_grade, v2_status, landed_cost")
        .eq("id", l.stock_unit_id as string)
        .maybeSingle();
      unitInfo = unit;
    }
    enrichedLines.push({ ...l, stock_unit: unitInfo });
  }

  return { order, lines: enrichedLines };
}

async function handleMarkOrderShipped(
  admin: SupabaseAdmin,
  input: { order_id: string; carrier: string; tracking_number?: string },
) {
  const now = new Date().toISOString();

  // Update order
  const { error: orderErr } = await admin
    .from("sales_order")
    .update({
      v2_status: "shipped",
      shipped_via: input.carrier,
      tracking_number: input.tracking_number?.trim() || null,
      shipped_date: now.split("T")[0],
    } as never)
    .eq("id", input.order_id);

  if (orderErr) throw new Error(`Failed to update order: ${orderErr.message}`);

  // Update linked stock units
  const { error: unitErr } = await admin
    .from("stock_unit")
    .update({
      v2_status: "shipped",
      shipped_at: now,
    } as never)
    .eq("order_id" as never, input.order_id)
    .in("v2_status" as never, ["sold"]);

  if (unitErr) throw new Error(`Failed to update stock units: ${unitErr.message}`);

  // Fetch order number for confirmation
  const { data: updated } = await admin
    .from("sales_order")
    .select("order_number")
    .eq("id", input.order_id)
    .maybeSingle();

  return {
    success: true,
    order_number: (updated as Record<string, unknown>)?.order_number ?? input.order_id,
    carrier: input.carrier,
    tracking_number: input.tracking_number ?? null,
    shipped_date: now.split("T")[0],
  };
}

async function handleGetMarginForItem(
  admin: SupabaseAdmin,
  input: { sku_code: string },
) {
  // Find the SKU
  const { data: sku, error: skuErr } = await admin
    .from("sku")
    .select("id, sku_code, condition_grade, catalog_product_id")
    .eq("sku_code", input.sku_code)
    .maybeSingle();

  if (skuErr) throw new Error(`SKU lookup failed: ${skuErr.message}`);
  if (!sku) return { error: `SKU ${input.sku_code} not found` };

  const skuData = sku as Record<string, unknown>;

  // Get stock units for this SKU to find avg landed cost
  const { data: units, error: unitErr } = await admin
    .from("stock_unit")
    .select("landed_cost, v2_status")
    .eq("sku_id" as never, skuData.id as string);

  if (unitErr) throw new Error(`stock unit query failed: ${unitErr.message}`);

  const unitList = (units ?? []) as Array<Record<string, unknown>>;
  const costs = unitList
    .filter((u) => typeof u.landed_cost === "number")
    .map((u) => u.landed_cost as number);

  const avgCost =
    costs.length > 0
      ? Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 100) / 100
      : null;

  // Get sale prices from completed order lines
  const { data: soldLines, error: soldErr } = await admin
    .from("sales_order_line")
    .select("unit_price")
    .eq("sku_id", skuData.id as string);

  if (soldErr) throw new Error(`sales line query failed: ${soldErr.message}`);

  const prices = ((soldLines ?? []) as Array<Record<string, unknown>>)
    .filter((l) => typeof l.unit_price === "number")
    .map((l) => l.unit_price as number);

  const avgPrice =
    prices.length > 0
      ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100
      : null;

  const margin =
    avgCost !== null && avgPrice !== null
      ? Math.round((avgPrice - avgCost) * 100) / 100
      : null;

  const marginPct =
    margin !== null && avgPrice !== null && avgPrice > 0
      ? Math.round((margin / avgPrice) * 10000) / 100
      : null;

  return {
    sku_code: input.sku_code,
    condition_grade: skuData.condition_grade,
    units_count: unitList.length,
    units_by_status: unitList.reduce(
      (acc, u) => {
        const s = (u.v2_status as string) ?? "unknown";
        acc[s] = (acc[s] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
    avg_landed_cost: avgCost,
    avg_sale_price: avgPrice,
    margin,
    margin_pct: marginPct,
  };
}

async function handleGetFinancialSummary(
  admin: SupabaseAdmin,
  input: { start_date: string; end_date: string },
) {
  const completedStatuses = ["shipped", "delivered", "complete", "payout_received"];

  // Get orders in range with completed statuses
  const { data: orders, error } = await admin
    .from("sales_order")
    .select("id, gross_total, v2_status")
    .in("v2_status" as never, completedStatuses)
    .gte("txn_date" as never, input.start_date)
    .lte("txn_date" as never, input.end_date);

  if (error) throw new Error(`financial query failed: ${error.message}`);

  const orderList = (orders ?? []) as Array<Record<string, unknown>>;
  const orderCount = orderList.length;
  const revenue = orderList.reduce((s, o) => s + ((o.gross_total as number) ?? 0), 0);

  // Get COGS from line items → stock units
  const orderIds = orderList.map((o) => o.id as string);
  let cogs = 0;

  if (orderIds.length > 0) {
    const { data: lines, error: lineErr } = await admin
      .from("sales_order_line")
      .select("stock_unit_id")
      .in("sales_order_id", orderIds);

    if (lineErr) throw new Error(`line items query failed: ${lineErr.message}`);

    const unitIds = ((lines ?? []) as Array<Record<string, unknown>>)
      .map((l) => l.stock_unit_id as string)
      .filter(Boolean);

    if (unitIds.length > 0) {
      const { data: costUnits, error: costErr } = await admin
        .from("stock_unit")
        .select("landed_cost")
        .in("id", unitIds);

      if (costErr) throw new Error(`COGS query failed: ${costErr.message}`);

      cogs = ((costUnits ?? []) as Array<Record<string, unknown>>).reduce(
        (s, u) => s + ((u.landed_cost as number) ?? 0),
        0,
      );
    }
  }

  const grossMargin = revenue - cogs;
  const marginPct = revenue > 0 ? Math.round((grossMargin / revenue) * 10000) / 100 : 0;

  return {
    period: `${input.start_date} to ${input.end_date}`,
    order_count: orderCount,
    revenue: Math.round(revenue * 100) / 100,
    cogs: Math.round(cogs * 100) / 100,
    gross_margin: Math.round(grossMargin * 100) / 100,
    margin_pct: marginPct,
  };
}

// ─── Tool Router ────────────────────────────────────────────

async function executeTool(
  admin: SupabaseAdmin,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "get_stock_summary":
      return handleGetStockSummary(admin);
    case "search_products":
      return handleSearchProducts(admin, input as { query: string; limit?: number });
    case "get_orders":
      return handleGetOrders(admin, input as { status?: string; limit?: number });
    case "get_order_detail":
      return handleGetOrderDetail(admin, input as { order_number: string });
    case "mark_order_shipped":
      return handleMarkOrderShipped(
        admin,
        input as { order_id: string; carrier: string; tracking_number?: string },
      );
    case "get_margin_for_item":
      return handleGetMarginForItem(admin, input as { sku_code: string });
    case "get_financial_summary":
      return handleGetFinancialSummary(
        admin,
        input as { start_date: string; end_date: string },
      );
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Main Handler ───────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const admin = createAdminClient();
    const { userId } = await authenticateRequest(req, admin);

    // Role check — admin or staff only
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    const hasAccess = (roles ?? []).some(
      (r: { role: string }) => r.role === "admin" || r.role === "staff",
    );
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("messages array is required");
    }

    // Build Claude messages from conversation history
    const claudeMessages = messages.map((m: { role: string; content: string }) => ({
      role: m.role,
      content: m.content,
    }));

    // Tool-use loop
    const MAX_ITERATIONS = 5;
    let iterations = 0;
    let finalText = "";

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages: claudeMessages,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Claude API error [${response.status}]: ${errText}`);
      }

      const result = await response.json();

      // Extract text and tool_use blocks
      const contentBlocks = result.content ?? [];
      const textBlocks = contentBlocks.filter(
        (b: { type: string }) => b.type === "text",
      );
      const toolBlocks = contentBlocks.filter(
        (b: { type: string }) => b.type === "tool_use",
      );

      // Collect any text
      finalText = textBlocks.map((b: { text: string }) => b.text).join("\n");

      // If no tool calls, we're done
      if (result.stop_reason !== "tool_use" || toolBlocks.length === 0) {
        break;
      }

      // Execute tool calls and build result messages
      // Add the assistant message with tool_use blocks
      claudeMessages.push({ role: "assistant", content: contentBlocks });

      const toolResults = [];
      for (const block of toolBlocks) {
        const { id, name, input } = block as {
          id: string;
          name: string;
          input: Record<string, unknown>;
        };

        let toolResult: unknown;
        try {
          toolResult = await executeTool(admin, name, input);
        } catch (err) {
          toolResult = {
            error: err instanceof Error ? err.message : "Tool execution failed",
          };
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: id,
          content: JSON.stringify(toolResult),
        });
      }

      // Add tool results as user message
      claudeMessages.push({ role: "user", content: toolResults });
    }

    return jsonResponse({ reply: finalText });
  } catch (err) {
    return errorResponse(err);
  }
});
