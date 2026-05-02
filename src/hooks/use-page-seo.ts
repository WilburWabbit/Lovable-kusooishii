import { useEffect } from 'react';

const SITE_NAME = 'Kuso Oishii';
const BASE_URL = 'https://www.kusooishii.com';
const SEO_OWNER = 'usePageSeo';

interface PageSeoOptions {
  title: string;
  description: string;
  path: string;
  noIndex?: boolean;
  keywords?: string[];
  imageUrl?: string;
  imageAlt?: string;
  locale?: string;
  geo?: {
    region?: string;
    placename?: string;
    position?: string;
  };
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  const selector = `meta[${attr}="${key}"]`;
  let el = document.querySelector(selector) as HTMLMetaElement | null;
  const created = !el;
  const previous = el?.getAttribute('content');

  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    el.setAttribute('data-seo-owner', SEO_OWNER);
    document.head.appendChild(el);
  }

  el.setAttribute('content', content);

  return {
    restore: () => {
      if (!el) return;
      if (created) {
        try { document.head.removeChild(el); } catch {}
        return;
      }
      if (previous !== null) el.setAttribute('content', previous);
    },
  };
}

function upsertLink(rel: string, href: string) {
  const selector = `link[rel="${rel}"]`;
  let el = document.querySelector(selector) as HTMLLinkElement | null;
  const created = !el;
  const previous = el?.getAttribute('href');

  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    el.setAttribute('data-seo-owner', SEO_OWNER);
    document.head.appendChild(el);
  }

  el.setAttribute('href', href);

  return {
    restore: () => {
      if (!el) return;
      if (created) {
        try { document.head.removeChild(el); } catch {}
        return;
      }
      if (previous !== null) el.setAttribute('href', previous);
    },
  };
}

function upsertJsonLd(scriptId: string, value: unknown) {
  let el = document.querySelector(`script[data-seo-id="${scriptId}"]`) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.setAttribute('data-seo-id', scriptId);
    el.setAttribute('data-seo-owner', SEO_OWNER);
    document.head.appendChild(el);
  }
  el.text = JSON.stringify(value);
  return {
    restore: () => {
      if (!el) return;
      try { document.head.removeChild(el); } catch {}
    },
  };
}

export function usePageSeo({ title, description, path, noIndex, keywords, imageUrl, imageAlt, locale = 'en_GB', geo, jsonLd }: PageSeoOptions) {
  useEffect(() => {
    const prevTitle = document.title;
    const fullTitle = `${title} | ${SITE_NAME}`;
    const canonicalUrl = `${BASE_URL}${path}`;

    document.title = fullTitle;

    const restorers = [
      upsertMeta('name', 'description', description),
      upsertMeta('property', 'og:title', fullTitle),
      upsertMeta('property', 'og:description', description),
      upsertMeta('property', 'og:url', canonicalUrl),
      upsertMeta('property', 'og:type', 'website'),
      upsertMeta('property', 'og:site_name', SITE_NAME),
      upsertMeta('property', 'og:locale', locale),
      upsertMeta('name', 'twitter:card', imageUrl ? 'summary_large_image' : 'summary'),
      upsertMeta('name', 'twitter:title', fullTitle),
      upsertMeta('name', 'twitter:description', description),
      upsertMeta('name', 'robots', noIndex ? 'noindex, nofollow' : 'index, follow'),
    ];

    if (keywords?.length) restorers.push(upsertMeta('name', 'keywords', keywords.join(', ')));
    if (imageUrl) {
      restorers.push(upsertMeta('property', 'og:image', imageUrl));
      restorers.push(upsertMeta('name', 'twitter:image', imageUrl));
    }
    if (imageAlt) {
      restorers.push(upsertMeta('property', 'og:image:alt', imageAlt));
      restorers.push(upsertMeta('name', 'twitter:image:alt', imageAlt));
    }

    if (geo?.region) restorers.push(upsertMeta('name', 'geo.region', geo.region));
    if (geo?.placename) restorers.push(upsertMeta('name', 'geo.placename', geo.placename));
    if (geo?.position) restorers.push(upsertMeta('name', 'geo.position', geo.position));

    restorers.push(upsertLink('canonical', canonicalUrl));

    if (jsonLd) restorers.push(upsertJsonLd(`page-schema-${path}`, jsonLd));

    return () => {
      document.title = prevTitle;
      restorers.forEach((r) => r.restore());
    };
  }, [title, description, path, noIndex, keywords, imageUrl, imageAlt, locale, geo, jsonLd]);
}
