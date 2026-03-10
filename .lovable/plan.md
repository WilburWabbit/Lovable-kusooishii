

## Product Media Card + ChatGPT Integration

### Current State

- **`media_asset` table exists** with columns: `id`, `original_url`, `alt_text`, `caption`, `width`, `height`, `mime_type`, `file_size_bytes`, `checksum`, `provenance`, `created_by`. RLS allows staff full access, public read.
- **No join table** linking media assets to products — `product.img_url` is a single text field set by the Hub sync function.
- **`media` storage bucket** exists and is public.
- **AI copy generation** uses Lovable AI gateway via `generate-product-copy` edge function.
- **Admin product detail page** has cards for stats, dimensions, content, channel overrides, and SKUs — no media management.

### What We Need

1. **`product_media` join table** — links `media_asset` records to a `product_id` with `sort_order` and `is_primary` flag
2. **Media card UI** on admin product detail page — upload, delete, reorder (drag), edit alt text per image, AI alt text generation button per image
3. **ChatGPT edge function** — replaces Lovable AI gateway calls with OpenAI API using a user-provided `OPENAI_API_KEY` secret
4. **Update `generate-product-copy`** to call ChatGPT instead of Lovable AI
5. **New `generate-alt-text` action** in the ChatGPT function for image-based alt text generation
6. **Update `product.img_url`** — set automatically from the primary media asset

### Implementation Plan

#### 1. Secret: `OPENAI_API_KEY`

Request the user's OpenAI API key before proceeding with any code changes.

#### 2. Database Migration

```sql
CREATE TABLE public.product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.product(id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL REFERENCES public.media_asset(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, media_asset_id)
);

ALTER TABLE public.product_media ENABLE ROW LEVEL SECURITY;

-- Staff manage, public read
CREATE POLICY "Product media managed by staff" ON public.product_media
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

CREATE POLICY "Product media readable by all" ON public.product_media
  FOR SELECT TO public USING (true);
```

#### 3. Edge Function: ChatGPT Integration

Create `supabase/functions/chatgpt/index.ts` with two actions:

| Action | Purpose |
|--------|---------|
| `generate-copy` | Product copy generation (replaces Lovable AI in `generate-product-copy`) |
| `generate-alt-text` | Vision-based alt text for a product image |

- `generate-copy`: Same system prompt and tool-calling pattern as current `generate-product-copy`, but calls `https://api.openai.com/v1/chat/completions` with `OPENAI_API_KEY`
- `generate-alt-text`: Sends image URL + product context to GPT-4o vision, returns SEO-optimised alt text (~125 chars)

#### 4. Update `generate-product-copy/index.ts`

Rewrite to call OpenAI API directly instead of Lovable AI gateway. Same auth, same system prompt, same tool-calling schema — just swap the endpoint and API key.

#### 5. Admin-data: Media CRUD Actions

Add to `admin-data/index.ts`:

| Action | Purpose |
|--------|---------|
| `list-product-media` | Return media assets for a product, ordered by `sort_order` |
| `upload-product-media` | Upload file to `media` bucket, create `media_asset` + `product_media` records |
| `delete-product-media` | Delete `product_media` link and the `media_asset` + storage file |
| `reorder-product-media` | Accept `{ items: [{ id, sort_order }] }`, batch update sort orders |
| `update-media-alt-text` | Update `media_asset.alt_text` for a given asset |
| `set-primary-media` | Set `is_primary` on one, clear others, update `product.img_url` |

#### 6. Media Card UI Component

New `src/components/admin/ProductMediaCard.tsx`:

- Grid of thumbnails from `product_media` join, sorted by `sort_order`
- Drag-and-drop reorder (using HTML5 drag events — no extra library needed)
- Click thumbnail to expand with alt text input field
- Upload button (file input, accepts `image/*`)
- Delete button per image (with confirmation)
- Star/primary toggle per image
- **"Generate Alt Text" button** per image — calls `chatgpt` function with `generate-alt-text` action, passing the image URL and product name/MPN
- Card-level action button: "Generate All Alt Text" to batch-generate for all images missing alt text

#### 7. Update Product Detail Admin Page

Insert the `ProductMediaCard` between the Dimensions card and the Content card. Pass `product.id` and product context (name, MPN, theme) as props.

#### 8. Storefront Integration

Update `ProductDetailPage.tsx` to query `product_media` and display a gallery instead of the current placeholder. Primary image shown large, thumbnails below.

### Files Changed

| File | Change |
|------|--------|
| Database migration | Create `product_media` table with RLS |
| `supabase/functions/generate-product-copy/index.ts` | Swap Lovable AI → OpenAI API |
| `supabase/functions/chatgpt/index.ts` | **New** — `generate-alt-text` action using GPT-4o vision |
| `supabase/functions/admin-data/index.ts` | Add media CRUD actions |
| `src/components/admin/ProductMediaCard.tsx` | **New** — Media management card |
| `src/pages/admin/ProductDetailAdminPage.tsx` | Add ProductMediaCard |
| `src/pages/ProductDetailPage.tsx` | Replace placeholder with image gallery from `product_media` |

### Secret Required

`OPENAI_API_KEY` — Your OpenAI platform API key from https://platform.openai.com/api-keys

