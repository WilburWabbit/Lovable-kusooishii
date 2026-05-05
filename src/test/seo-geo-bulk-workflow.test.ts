import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const seoGeoPage = readFileSync(join(repoRoot, "src/pages/admin-v2/SeoGeoPage.tsx"), "utf8");
const seoRevisionRpc = readFileSync(
  join(repoRoot, "supabase/migrations/20260503112000_save_seo_revision_draft_rpc.sql"),
  "utf8",
);

describe("SEO/GEO bulk publishing workflow", () => {
  it("treats save draft and approve/publish as independent bulk actions", () => {
    expect(seoGeoPage).toContain('onClick={() => handleBulkApply("save")}');
    expect(seoGeoPage).toContain('onClick={() => handleBulkApply("publish")}');
    expect(seoGeoPage).toContain("Approve & publish selected");
    expect(seoGeoPage).toContain("Approve & Publish");
    expect(seoGeoPage).toContain("await publishSeoRevision(record, result.editor)");
  });

  it("shows published as a workflow status after publish succeeds", () => {
    expect(seoGeoPage).toContain('type SeoStatusFilter = "all" | "published"');
    expect(seoGeoPage).toContain('if (status === "published") return <Badge label="Published"');
    expect(seoGeoPage).toContain("patchSeoDocumentRevision(record, result.editor, revision, action)");
    expect(seoGeoPage).toContain('status: "published"');
    expect(seoGeoPage).toContain("published_revision: nextRevision");
    expect(seoGeoPage).toContain("draft_revision: null");
  });

  it("keeps the database publish RPC responsible for the durable published state", () => {
    expect(seoRevisionRpc).toContain("CREATE OR REPLACE FUNCTION public.publish_seo_revision");
    expect(seoRevisionRpc).toContain("UPDATE public.seo_revision");
    expect(seoRevisionRpc).toContain("SET status = ''archived''");
    expect(seoRevisionRpc).toContain("status = ''published''");
    expect(seoRevisionRpc).toContain("published_revision_id = v_revision_id");
    expect(seoRevisionRpc).not.toContain("$$");
  });
});
