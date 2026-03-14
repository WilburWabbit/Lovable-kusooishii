

## Fix Product Media Card — Three Defects

### Root Cause Analysis

**Defect 1 & 3 (Primary resets, drag resets):** Same root cause. After the optimistic cache update, `invalidate()` is called immediately, which triggers a refetch. The refetch races with or arrives before the server has fully committed, so stale data overwrites the optimistic update. Additionally, `queryClient.cancelQueries()` is never called before setting optimistic data, so in-flight fetches can also overwrite it.

**Defect 2 (Drag broken on mobile):** The component uses the HTML5 Drag and Drop API (`draggable`, `onDragStart`, `onDragOver`, `onDrop`), which is not supported on touch devices. A touch-compatible library is needed.

### Plan

**File: `src/components/admin/ProductMediaCard.tsx`**

1. **Replace HTML5 drag with `@dnd-kit`** — Install `@dnd-kit/core` and `@dnd-kit/sortable` (already touch-compatible). Replace the `draggable`/`onDragStart`/`onDragOver`/`onDrop` handlers with `DndContext`, `SortableContext`, and `useSortable` per item. This fixes mobile drag (defect 2).

2. **Fix optimistic update pattern for both `handleSetPrimary` and `handleDrop`:**
   - Call `queryClient.cancelQueries({ queryKey })` before setting optimistic data to prevent in-flight fetches from overwriting.
   - Remove `invalidate()` from the success path — the optimistic state is already correct. Only invalidate on error (rollback).
   - Keep `invalidate()` for `["admin-product"]` only (to update the header image).

3. **Extract each media row into a `SortableMediaItem` sub-component** that uses `useSortable()` for drag handle and transform styling.

### Dependencies

- Add `@dnd-kit/core` and `@dnd-kit/sortable` (plus `@dnd-kit/utilities`) to `package.json`.

