import { useEffect } from 'react';

const SITE_NAME = 'Kuso Oishii';
const BASE_URL = 'https://kusooishii.com';

interface PageSeoOptions {
  title: string;
  description: string;
  path: string;
  noIndex?: boolean;
  ogImage?: string;
  ogType?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute('content', content);
  return el;
}

function upsertLink(rel: string, href: string) {
  let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) { el = document.createElement('link'); el.setAttribute('rel', rel); document.head.appendChild(el); }
  el.setAttribute('href', href);
  return el;
}

export function usePageSeo({ title, description, path, noIndex, ogImage, ogType, jsonLd }: PageSeoOptions) {
  useEffect(() => {
    const prevTitle = document.title;
    const fullTitle = `${title} | ${SITE_NAME}`;
    const canonicalUrl = `${BASE_URL}${path}`;

    document.title = fullTitle;

    const metas = [
      upsertMeta('name', 'description', description),
      upsertMeta('property', 'og:title', fullTitle),
      upsertMeta('property', 'og:description', description),
      upsertMeta('property', 'og:url', canonicalUrl),
      upsertMeta('property', 'og:type', ogType ?? 'website'),
      upsertMeta('property', 'og:site_name', SITE_NAME),
      upsertMeta('property', 'og:locale', 'en_GB'),
      upsertMeta('name', 'twitter:card', 'summary_large_image'),
      upsertMeta('name', 'twitter:title', fullTitle),
      upsertMeta('name', 'twitter:description', description),
    ];

    if (ogImage) {
      metas.push(upsertMeta('property', 'og:image', ogImage));
      metas.push(upsertMeta('name', 'twitter:image', ogImage));
    }

    if (noIndex) metas.push(upsertMeta('name', 'robots', 'noindex, nofollow'));

    const canonical = upsertLink('canonical', canonicalUrl);

    // JSON-LD structured data
    let jsonLdScript: HTMLScriptElement | null = null;
    if (jsonLd) {
      jsonLdScript = document.createElement('script');
      jsonLdScript.type = 'application/ld+json';
      const schemas = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
      jsonLdScript.textContent = JSON.stringify(schemas.length === 1 ? schemas[0] : schemas);
      document.head.appendChild(jsonLdScript);
    }

    return () => {
      document.title = prevTitle;
      metas.forEach(el => { try { document.head.removeChild(el); } catch {} });
      try { document.head.removeChild(canonical); } catch {}
      if (jsonLdScript) { try { document.head.removeChild(jsonLdScript); } catch {} }
    };
  }, [title, description, path, noIndex, ogImage, ogType, jsonLd]);
}
