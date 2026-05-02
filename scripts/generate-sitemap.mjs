import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...loadEnv(process.env.MODE || process.env.NODE_ENV || 'production', rootDir, ''),
  ...process.env,
};

const siteUrl = 'https://www.kusooishii.com';
const publicRoutes = [
  '/',
  '/browse',
  '/themes',
  '/new-arrivals',
  '/deals',
  '/about',
  '/faq',
  '/grading',
  '/contact',
  '/shipping-policy',
  '/returns-exchanges',
  '/terms',
  '/privacy',
  '/bluebell',
];

function supabaseHeaders(supabaseKey) {
  return {
    'Content-Type': 'application/json',
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function fetchProductRoutes() {
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return [];

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/browse_catalog`, {
      method: 'POST',
      headers: supabaseHeaders(supabaseKey),
      body: JSON.stringify({
        search_term: null,
        filter_theme_id: null,
        filter_grade: null,
        filter_retired: null,
      }),
    });

    if (!response.ok) {
      console.warn(`Skipping product sitemap routes: Supabase returned ${response.status}`);
      return [];
    }

    const data = await response.json();
    return (data ?? [])
      .map((product) => product?.mpn)
      .filter((mpn) => typeof mpn === 'string' && mpn.length > 0)
      .map((mpn) => `/sets/${encodeURIComponent(mpn)}`);
  } catch (error) {
    console.warn(`Skipping product sitemap routes: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function fetchSeoSitemapEntries() {
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return [];

  try {
    const documentUrl = new URL('/rest/v1/seo_document', supabaseUrl);
    documentUrl.searchParams.set('select', 'published_revision_id');
    documentUrl.searchParams.set('status', 'eq.published');
    documentUrl.searchParams.set('published_revision_id', 'not.is.null');

    const documentResponse = await fetch(documentUrl, {
      headers: supabaseHeaders(supabaseKey),
    });

    if (!documentResponse.ok) {
      console.warn(`Using fallback sitemap routes: SEO documents returned ${documentResponse.status}`);
      return [];
    }

    const documents = await documentResponse.json();
    const revisionIds = [...new Set(
      (documents ?? [])
        .map((document) => document?.published_revision_id)
        .filter((id) => typeof id === 'string' && id.length > 0)
    )];

    if (!revisionIds.length) return [];

    const revisionUrl = new URL('/rest/v1/seo_revision', supabaseUrl);
    revisionUrl.searchParams.set('select', 'canonical_path,indexation_policy,robots_directive,sitemap');
    revisionUrl.searchParams.set('id', `in.(${revisionIds.join(',')})`);
    revisionUrl.searchParams.set('status', 'eq.published');

    const revisionResponse = await fetch(revisionUrl, {
      headers: supabaseHeaders(supabaseKey),
    });

    if (!revisionResponse.ok) {
      console.warn(`Using fallback sitemap routes: SEO revisions returned ${revisionResponse.status}`);
      return [];
    }

    const revisions = await revisionResponse.json();
    return (revisions ?? [])
      .filter((revision) => {
        const sitemap = revision?.sitemap;
        const robots = String(revision?.robots_directive ?? '').toLowerCase();
        return (
          typeof revision?.canonical_path === 'string' &&
          revision.canonical_path.startsWith('/') &&
          revision?.indexation_policy === 'index' &&
          !robots.includes('noindex') &&
          sitemap &&
          typeof sitemap === 'object' &&
          sitemap.include === true
        );
      })
      .map((revision) => ({
        path: revision.canonical_path,
        changefreq: typeof revision.sitemap.changefreq === 'string' ? revision.sitemap.changefreq : undefined,
        priority: typeof revision.sitemap.priority === 'number' ? revision.sitemap.priority.toFixed(1) : undefined,
      }));
  } catch (error) {
    console.warn(`Using fallback sitemap routes: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function routeMeta(path, override = {}) {
  const fallback = path === '/'
    ? { changefreq: 'monthly', priority: '1.0' }
    : path.startsWith('/sets/')
    ? { changefreq: 'weekly', priority: '0.8' }
    : { changefreq: 'monthly', priority: '0.7' };

  return {
    changefreq: override.changefreq ?? fallback.changefreq,
    priority: override.priority ?? fallback.priority,
  };
}

function dedupeEntries(entries) {
  const byPath = new Map();
  for (const entry of entries) {
    if (!entry?.path) continue;
    byPath.set(entry.path, { ...byPath.get(entry.path), ...entry });
  }
  return Array.from(byPath.values());
}

function buildXml(entries) {
  const urls = entries.map((entry) => {
    const { changefreq, priority } = routeMeta(entry.path, entry);
    return `  <url>\n    <loc>${escapeXml(`${siteUrl}${entry.path}`)}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

const seoEntries = await fetchSeoSitemapEntries();
const routeEntries = seoEntries.length
  ? seoEntries
  : publicRoutes.map((path) => ({ path }));
const productEntries = (await fetchProductRoutes()).map((path) => ({ path }));
const allEntries = dedupeEntries([...routeEntries, ...productEntries]);

await writeFile(new URL('../public/sitemap.xml', import.meta.url), buildXml(allEntries), 'utf8');
console.log(`Generated sitemap with ${allEntries.length} URLs`);
