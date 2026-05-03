import { writeFile } from 'node:fs/promises';

const siteUrl = process.env.VITE_SITE_URL || 'https://www.kusooishii.com';
const staticRoutes = ['/', '/browse', '/themes', '/new-arrivals', '/deals', '/about', '/faq', '/grading', '/contact', '/shipping-policy', '/returns-exchanges', '/order-tracking', '/terms', '/privacy', '/bluebell'];

async function fetchProductRoutes() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return [];

  // Use browse_catalog to respect live storefront filtering rules,
  // including sold-out visibility policies.
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/browse_catalog`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      search_term: null,
      filter_theme_id: null,
      filter_grade: null,
      filter_retired: null,
    }),
  });

  if (!response.ok) return [];
  const rows = await response.json();
  const mpns = new Set((rows ?? []).map((r) => r?.mpn).filter((v) => typeof v === 'string' && v.length > 0));
  return [...mpns].map((mpn) => `/sets/${mpn}`);
}

const toUrl = (path) => `${siteUrl}${path}`;

function buildXml(paths) {
  const nodes = paths.map((path) => `  <url>\n    <loc>${toUrl(path)}</loc>\n    <changefreq>${path.startsWith('/sets/') ? 'weekly' : 'monthly'}</changefreq>\n    <priority>${path === '/' ? '1.0' : path.startsWith('/sets/') ? '0.8' : '0.7'}</priority>\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${nodes}\n</urlset>\n`;
}

const productRoutes = await fetchProductRoutes();
const allRoutes = [...new Set([...staticRoutes, ...productRoutes])];
await writeFile('public/sitemap.xml', buildXml(allRoutes), 'utf8');
console.log(`Generated sitemap with ${allRoutes.length} URLs`);
