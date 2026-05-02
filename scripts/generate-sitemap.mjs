import { writeFile } from 'node:fs/promises';
const siteUrl = process.env.VITE_SITE_URL || 'https://www.kusooishii.com';
const staticRoutes = ['/', '/browse', '/themes', '/new-arrivals', '/deals', '/about', '/faq', '/grading', '/contact', '/shipping-policy', '/returns-exchanges', '/order-tracking', '/terms', '/privacy', '/bluebell'];
async function fetchProductRoutes() { const u=process.env.VITE_SUPABASE_URL; const k=process.env.VITE_SUPABASE_ANON_KEY; if(!u||!k) return []; const r=await fetch(`${u}/rest/v1/product?select=mpn&status=eq.active`,{headers:{apikey:k,Authorization:`Bearer ${k}`}}); if(!r.ok) return []; const d=await r.json(); return (d??[]).map((p)=>`/sets/${p.mpn}`);} 
const toUrl=(p)=>`${siteUrl}${p}`;
const buildXml=(paths)=>`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p)=>`  <url>\n    <loc>${toUrl(p)}</loc>\n    <changefreq>${p.startsWith('/sets/')?'weekly':'monthly'}</changefreq>\n    <priority>${p==='/'?'1.0':p.startsWith('/sets/')?'0.8':'0.7'}</priority>\n  </url>`).join('\n')}\n</urlset>\n`;
const all=[...new Set([...staticRoutes, ...(await fetchProductRoutes())])]; await writeFile('public/sitemap.xml', buildXml(all), 'utf8'); console.log(`Generated sitemap with ${all.length} URLs`);
