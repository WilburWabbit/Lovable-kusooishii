import { useQuery } from "@tanstack/react-query";
import { invokeWithAuth } from "@/lib/invokeWithAuth";

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

type ListResponse = { rows: TranscriptRow[]; total: number };

async function listTranscripts(params: {
  role?: string;
  search?: string;
  from: number;
  to: number;
}): Promise<ListResponse> {
  return invokeWithAuth<ListResponse>("admin-data", {
    action: "list-transcripts",
    ...params,
  });
}

export function useTranscripts(filters: TranscriptFilters = {}) {
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 50;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  return useQuery({
    queryKey: ["lovable-transcripts", filters],
    queryFn: () =>
      listTranscripts({ role: filters.role, search: filters.search, from, to }),
  });
}

export async function fetchAllTranscripts(
  filters: TranscriptFilters = {},
): Promise<TranscriptRow[]> {
  const pageSize = 1000;
  let page = 0;
  const all: TranscriptRow[] = [];
  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { rows } = await listTranscripts({
      role: filters.role,
      search: filters.search,
      from,
      to,
    });
    all.push(...rows);
    if (rows.length < pageSize) break;
    page++;
  }
  return all;
}
