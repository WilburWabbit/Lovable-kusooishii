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
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
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

function routeMeta(path) {
  if (path === '/') return { changefreq: 'monthly', priority: '1.0' };
  if (path.startsWith('/sets/')) return { changefreq: 'weekly', priority: '0.8' };
  return { changefreq: 'monthly', priority: '0.7' };
}

function buildXml(paths) {
  const urls = paths.map((path) => {
    const { changefreq, priority } = routeMeta(path);
    return `  <url>\n    <loc>${escapeXml(`${siteUrl}${path}`)}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

const allRoutes = [...new Set([...publicRoutes, ...(await fetchProductRoutes())])];
await writeFile(new URL('../public/sitemap.xml', import.meta.url), buildXml(allRoutes), 'utf8');
console.log(`Generated sitemap with ${allRoutes.length} URLs`);
