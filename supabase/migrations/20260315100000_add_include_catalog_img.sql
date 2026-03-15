-- Add flag to control whether the catalog image (product.img_url) appears
-- in the storefront product-detail gallery as the final image.
ALTER TABLE product
  ADD COLUMN IF NOT EXISTS include_catalog_img boolean NOT NULL DEFAULT false;
