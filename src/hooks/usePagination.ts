import { useState, useMemo, useEffect } from "react";

const PAGE_SIZE_OPTIONS = [12, 24, 36, 48] as const;
const DEFAULT_PAGE_SIZE = 12;
const MIN_LAST_PAGE_ITEMS = 7;

export function usePagination<T>(items: T[] | undefined, defaultPageSize = DEFAULT_PAGE_SIZE) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const totalItems = items?.length ?? 0;

  // Compute total pages with smart last-page merging
  const totalPages = useMemo(() => {
    if (totalItems === 0) return 0;
    const naivePages = Math.ceil(totalItems / pageSize);
    if (naivePages <= 1) return naivePages;
    const lastPageItems = totalItems - (naivePages - 1) * pageSize;
    if (lastPageItems < MIN_LAST_PAGE_ITEMS) {
      return naivePages - 1;
    }
    return naivePages;
  }, [totalItems, pageSize]);

  // Reset to page 1 when items change (filters) or page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [totalItems, pageSize]);

  const paginatedItems = useMemo(() => {
    if (!items || items.length === 0) return items;
    const start = (currentPage - 1) * pageSize;
    // On the last page, take everything remaining (handles smart merge)
    if (currentPage === totalPages) {
      return items.slice(start);
    }
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize, totalPages]);

  return {
    paginatedItems,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalPages,
    totalItems,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
  };
}
