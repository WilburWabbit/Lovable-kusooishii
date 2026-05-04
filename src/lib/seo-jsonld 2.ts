export const SITE_URL = "https://www.kusooishii.com";

type JsonLd = Record<string, unknown>;

interface BreadcrumbItem {
  name: string;
  path: string;
}

interface FaqItem {
  question: string;
  answer: string;
}

export function absoluteUrl(path: string) {
  if (/^(https?:|data:)/.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function organizationJsonLd(logoPath = "/favicon.ico"): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: "Kuso Oishii",
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl(logoPath),
    },
    description:
      "Kuso Oishii sells graded LEGO sets and minifigures for adult collectors in the United Kingdom.",
    email: "hello@kusooishii.com",
    areaServed: {
      "@type": "Country",
      name: "United Kingdom",
    },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "hello@kusooishii.com",
      areaServed: "GB",
      availableLanguage: "en-GB",
    },
    knowsAbout: [
      "LEGO resale",
      "LEGO set condition grading",
      "retired LEGO sets",
      "collectible minifigures",
    ],
  };
}

export function breadcrumbJsonLd(items: BreadcrumbItem[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function pageBreadcrumbJsonLd(name: string, path: string): JsonLd {
  return breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name, path },
  ]);
}

export function faqPageJsonLd(items: FaqItem[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function combineJsonLd(...schemas: Array<JsonLd | undefined | null | false>): JsonLd[] {
  return schemas.filter(Boolean) as JsonLd[];
}
