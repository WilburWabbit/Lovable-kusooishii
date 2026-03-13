import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  itemLabel?: string;
}

export function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
  itemLabel = "items",
}: PaginationControlsProps) {
  if (totalPages <= 1 && pageSizeOptions[0] >= totalItems) return null;

  const handlePageChange = (page: number) => {
    onPageChange(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Compute visible range for summary
  const start = (currentPage - 1) * pageSize + 1;
  const end = currentPage === totalPages ? totalItems : currentPage * pageSize;

  // Build page number list with ellipsis
  const pages = buildPageNumbers(currentPage, totalPages);

  return (
    <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
      {/* Item count summary */}
      <p className="font-body text-sm text-muted-foreground">
        Showing {start}–{end} of {totalItems} {itemLabel}
      </p>

      {/* Page navigation */}
      {totalPages > 1 && (
        <Pagination className="w-auto mx-0">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => currentPage > 1 && handlePageChange(currentPage - 1)}
                className={currentPage <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>

            {pages.map((p, i) =>
              p === "ellipsis" ? (
                <PaginationItem key={`e-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink
                    isActive={p === currentPage}
                    onClick={() => handlePageChange(p)}
                    className="cursor-pointer"
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}

            <PaginationItem>
              <PaginationNext
                onClick={() => currentPage < totalPages && handlePageChange(currentPage + 1)}
                className={currentPage >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      {/* Page size selector */}
      <Select
        value={String(pageSize)}
        onValueChange={(v) => onPageSizeChange(Number(v))}
      >
        <SelectTrigger className="w-[140px] font-body text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {pageSizeOptions.map((size) => (
            <SelectItem key={size} value={String(size)}>
              Show {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Build a compact list of page numbers with ellipsis gaps. */
function buildPageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "ellipsis")[] = [1];

  if (current > 3) {
    pages.push("ellipsis");
  }

  const rangeStart = Math.max(2, current - 1);
  const rangeEnd = Math.min(total - 1, current + 1);

  for (let i = rangeStart; i <= rangeEnd; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push("ellipsis");
  }

  pages.push(total);

  return pages;
}
