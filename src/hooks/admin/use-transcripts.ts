import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TranscriptRow = {
  id: string;
  message_index: number;
  message_index_end: number | null;
  role: "user" | "assistant" | "system" | "range";
  occurred_at: string | null;
  source_file: string;
  part_number: number;
  title: string | null;
  body: string;
  token_count: number;
  char_count: number;
  created_at: string;
};

export interface TranscriptFilters {
  role?: TranscriptRow["role"] | "all";
  search?: string;
  page?: number;
  pageSize?: number;
}

function applyFilters(query: any, filters: TranscriptFilters) {
  let q = query;
  if (filters.role && filters.role !== "all") {
    q = q.eq("role", filters.role);
  }
  if (filters.search && filters.search.trim()) {
    const term = filters.search.trim().replace(/%/g, "");
    q = q.or(`body.ilike.%${term}%,title.ilike.%${term}%`);
  }
  return q;
}

export function useTranscripts(filters: TranscriptFilters = {}) {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 50;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  return useQuery({
    queryKey: ["lovable-transcripts", filters],
    queryFn: async () => {
      let q = supabase
        .from("lovable_agent_transcripts")
        .select("*", { count: "exact" })
        .order("occurred_at", { ascending: false, nullsFirst: false })
        .order("message_index", { ascending: false })
        .range(from, to);
      q = applyFilters(q, filters);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as TranscriptRow[], total: count ?? 0 };
    },
  });
}

export async function fetchAllTranscripts(filters: TranscriptFilters = {}): Promise<TranscriptRow[]> {
  const pageSize = 1000;
  let page = 0;
  const all: TranscriptRow[] = [];
  while (true) {
    let q = supabase
      .from("lovable_agent_transcripts")
      .select("*")
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .order("message_index", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    q = applyFilters(q, filters);
    const { data, error } = await q;
    if (error) throw error;
    const batch = (data ?? []) as TranscriptRow[];
    all.push(...batch);
    if (batch.length < pageSize) break;
    page++;
  }
  return all;
}
