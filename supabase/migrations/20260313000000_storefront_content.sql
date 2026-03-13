-- Storefront content editor: key-value store for page content
CREATE TABLE public.storefront_content (
  page_key text PRIMARY KEY,
  content jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- RLS
ALTER TABLE public.storefront_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Content public read"
  ON public.storefront_content FOR SELECT TO public
  USING (true);

CREATE POLICY "Content managed by staff"
  ON public.storefront_content FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
