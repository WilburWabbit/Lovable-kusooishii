/* ------------------------------------------------------------------ */
/* Storefront content defaults — extracted from hardcoded page text    */
/* Each page has an interface + constant. These serve as both          */
/* TypeScript contracts and runtime fallbacks when no DB row exists.   */
/* ------------------------------------------------------------------ */

// ── Header ──────────────────────────────────────────────────────────
export interface HeaderContent {
  logo: string;
  navItems: { name: string; path: string }[];
}
export const HEADER_DEFAULTS: HeaderContent = {
  logo: "KUSO OISHII",
  navItems: [
    { name: "Shop", path: "/browse" },
    { name: "Themes", path: "/browse?view=themes" },
    { name: "Just Landed", path: "/browse?new=true" },
    { name: "Deals", path: "/browse?deals=true" },
    { name: "About", path: "/about" },
  ],
};

// ── Footer ──────────────────────────────────────────────────────────
export interface FooterContent {
  brandTagline: string;
  location: string;
  instagramUrl: string;
  quickLinks: { label: string; path: string }[];
  customerServiceLinks: { label: string; path: string }[];
  newsletterHeading: string;
  newsletterDescription: string;
  disclaimer: string;
}
export const FOOTER_DEFAULTS: FooterContent = {
  brandTagline: "Affordable LEGO®, responsibly re-sold. Rescued stock from UK retailers at fair prices.",
  location: "Brookville, Norfolk UK",
  instagramUrl: "https://www.instagram.com/kuso_oishii/",
  quickLinks: [
    { label: "Shop All Sets", path: "/browse" },
    { label: "Browse Themes", path: "/browse?view=themes" },
    { label: "Just Landed", path: "/browse?new=true" },
    { label: "Deals", path: "/browse?deals=true" },
    { label: "About Us", path: "/about" },
  ],
  customerServiceLinks: [
    { label: "FAQ", path: "/faq" },
    { label: "Contact Us", path: "/contact" },
    { label: "Track Your Order", path: "/order-tracking" },
    { label: "Returns & Exchanges", path: "/returns-exchanges" },
    { label: "Shipping Info", path: "/shipping-policy" },
  ],
  newsletterHeading: "First Dibs",
  newsletterDescription: "Get first dibs on rescued sets. No spam. Just bricks.",
  disclaimer: "LEGO®, the LEGO logo and the Minifigure are trademarks of the LEGO Group, which does not sponsor, authorise or endorse Kuso Oishii.",
};

// ── Home ────────────────────────────────────────────────────────────
export interface HomeContent {
  hero: { tagline: string; heading: string; description: string };
  valueProps: { title: string; desc: string; iconKey: string }[];
  cta: { heading: string; description: string; buttonText: string; buttonLink: string };
}
export const HOME_DEFAULTS: HomeContent = {
  hero: {
    tagline: "Curated Resale",
    heading: "Sets worth collecting.",
    description: "Graded, verified, and priced for adult collectors who know what they want. Every set condition-checked before it ships.",
  },
  valueProps: [
    { title: "Condition Graded", desc: "Every set inspected and rated 1–4", iconKey: "shield" },
    { title: "Free UK Shipping", desc: "Express shipping also available", iconKey: "truck" },
    { title: "Blue Bell Lego Club", desc: "5% off for you. and 5% donated to the Blue Bell", iconKey: "bell" },
  ],
  cta: {
    heading: "Want something we don't have?",
    description: "Add it to your wishlist. We track demand and source accordingly. Members get stock alerts when sets land.",
    buttonText: "Create Account",
    buttonLink: "/login",
  },
};

// ── About ───────────────────────────────────────────────────────────
export interface AboutContent {
  hero: { heading: string; description: string };
  storyHeading: string;
  storyParagraphs: string[];
  differenceHeading: string;
  differenceCards: { title: string; desc: string; iconKey: string }[];
  howItWorksHeading: string;
  howItWorksSteps: { title: string; desc: string }[];
  circular: { heading: string; description: string; buttonText: string; buttonLink: string };
}
export const ABOUT_DEFAULTS: AboutContent = {
  hero: {
    heading: "We rescue LEGO® sets that retailers gave up on.",
    description: "Returned stock. Dented boxes. Open bags. Perfectly good bricks heading for limbo. We grab them, inspect them properly, and sell them to people who actually want to build.",
  },
  storyHeading: "The Story",
  storyParagraphs: [
    "Here's what happens when you return a LEGO set to a big retailer: they open the box to check it, slap a \"returned\" sticker on it, and it goes into a warehouse where nobody quite knows what to do with it. The box might have a dent. A bag might be open. Most times, the set is still in mint condition. Either way, there is nothing's actually wrong with the bricks — but the retailer can't sell it as new, so it sits there until the inevitable happens and it gets thrown into a skip.",
    "That's where we come in. Kuso Oishii buys that stock from UK retailers, wholesalers, and trusted collectors. We inspect every set — weigh sealed bags, hand-count open ones, photograph the box condition, and write up honest notes so you know exactly what you're getting.",
    "It's circular commerce without the greenwash. We're not saving the planet — we're just making sure perfectly good LEGO doesn't go to waste. And you get sets at fair prices without the \"is this legit?\" anxiety.",
  ],
  differenceHeading: "The Kuso Oishii Difference",
  differenceCards: [
    { title: "Radical Honesty", desc: "Every set has detailed condition notes. Dented box? We'll say so. Missing a minifig arm? You'll know before you buy.", iconKey: "shieldCheck" },
    { title: "Collector Detail", desc: "Set numbers, minifig IDs, bag-by-bag inspection notes. We speak AFOL because we are AFOLs.", iconKey: "search" },
    { title: "Fair Prices", desc: "No markup games. No 'rare find' surcharges. Rescued stock at rescued prices. Simple.", iconKey: "package" },
    { title: "No Corporate Waffle", desc: "We don't 'curate experiences.' We sell LEGO. You build it. Everyone's happy.", iconKey: "smile" },
  ],
  howItWorksHeading: "How It Works",
  howItWorksSteps: [
    { title: "We Source", desc: "Returned, open-box, and damaged-box LEGO® sets from authorised UK retailers. Every set is genuine." },
    { title: "We Inspect", desc: "Sealed bags get weighed. Open bags get hand-counted. Box condition photographed. Honest notes written." },
    { title: "You Build", desc: "Pick your set, read the condition notes, and get building. No surprises, no anxiety, just bricks." },
  ],
  circular: {
    heading: "Circular, Not Preachy",
    description: "Every set we sell is one that didn't end up in clearance limbo or worse. We're not planting trees or offsetting carbon — we're just keeping good LEGO in circulation. That's it. No manifesto required.",
    buttonText: "Browse the Rescued Stock",
    buttonLink: "/browse",
  },
};

// ── FAQ ─────────────────────────────────────────────────────────────
export interface FAQSection {
  title: string;
  badge?: string;
  items: { id: string; q: string; a: string }[];
}
export interface FAQContent {
  pageTitle: string;
  pageSubtitle: string;
  sections: FAQSection[];
  ctaText: string;
  ctaLinkText: string;
}
export const FAQ_DEFAULTS: FAQContent = {
  pageTitle: "FAQ",
  pageSubtitle: "Straight answers. No waffle.",
  sections: [
    {
      title: "Condition Grades",
      badge: "Important",
      items: [
        { id: "sealed", q: "Sealed — What does it mean?", a: "The set is factory sealed. All bags are unopened. The box may have minor shelf wear, but the contents are untouched. Expect: As close to buying from a shop as you'll get, minus the full retail price tag." },
        { id: "openbox", q: "Open-box — What does it mean?", a: "The outer box has been opened — usually by the original retailer during a returns check. We inspect the contents and note which bags are sealed vs open. If any are open, we hand-count and verify." },
        { id: "damagedbox", q: "Damaged-box — What does it mean?", a: "The box has cosmetic damage — dents, tears, water stains, crushed corners. The LEGO inside is unaffected. Not for box-pristine collectors. If you're building the set, you won't care." },
      ],
    },
    {
      title: "Buyer Education",
      items: [
        { id: "genuine", q: "Are these genuine LEGO® sets?", a: "Yes, 100%. Every set comes from authorised UK retailers — they're returns, open-box, or damaged-box stock. We don't touch knock-offs." },
        { id: "piececount", q: "How do you verify piece counts?", a: "For sealed bags, we weigh them against known references. For opened bags, we hand-count. If anything is missing, we list it clearly in the condition notes." },
        { id: "instructions", q: "Do sets come with instructions?", a: "If the set included printed instructions and they're present, yes. If missing, we'll say so. LEGO's free digital instructions at lego.com/buildinginstructions cover every set." },
      ],
    },
    {
      title: "Ordering & Payment",
      items: [
        { id: "payment", q: "What payment methods do you accept?", a: "Visa, Mastercard, American Express, and PayPal via Stripe. We never see or store your card details." },
        { id: "confirmation", q: "Will I get an order confirmation?", a: "Yes — email confirmation immediately after placing your order, and a second email with tracking info once we ship." },
        { id: "cancel", q: "Can I cancel my order?", a: "If we haven't shipped it yet, yes — email us at hello@kusooishii.com. Once dispatched, follow the returns process." },
      ],
    },
    {
      title: "Shipping & Delivery",
      items: [
        { id: "options", q: "What are the shipping options?", a: "Standard (Free) via Evri, 3–5 working days. Express (Paid) via Royal Mail Tracked 24 or Parcelforce, 1–2 working days. Collection (Free) at the Blue Bell LEGO Club." },
        { id: "international", q: "Do you ship internationally?", a: "Not yet — UK mainland only for now. International shipping is something we're looking at for the future." },
      ],
    },
    {
      title: "Returns & Refunds",
      items: [
        { id: "returns", q: "What's the return policy?", a: "Sealed sets: 14-day return in original condition. Open-box and damaged-box: sold as-described. If something arrives damaged in transit or doesn't match the listing, get in touch." },
        { id: "missing", q: "What if pieces are missing?", a: "If we listed a set as complete and you find missing pieces, email us with photos. We'll source missing parts, offer a partial refund, or arrange a return." },
      ],
    },
  ],
  ctaText: "Still got a question?",
  ctaLinkText: "Get in touch →",
};

// ── Contact ─────────────────────────────────────────────────────────
export interface ContactContent {
  pageTitle: string;
  pageDescription: string;
  email: string;
  location: string;
  responseTime: string;
}
export const CONTACT_DEFAULTS: ContactContent = {
  pageTitle: "Contact Us",
  pageDescription: "Got a question about an order, a set, or anything else? Drop us a message.",
  email: "hello@kusooishii.com",
  location: "Brookville, Norfolk, UK",
  responseTime: "We reply within 1 working day, Monday to Friday.",
};

// ── Policy pages (Shipping, Returns, Privacy, Terms, Order Tracking) ──
export interface PolicySection {
  title: string;
  body: string;
}
export interface PolicyContent {
  pageTitle: string;
  pageSubtitle: string;
  sections: PolicySection[];
}

export const SHIPPING_DEFAULTS: PolicyContent = {
  pageTitle: "Shipping Policy",
  pageSubtitle: "UK shipping from Brookville, Norfolk",
  sections: [
    { title: "Shipping Options", body: "Standard — Free: Via Evri. Tracked delivery in 3–5 working days. Free on all orders — no minimum spend.\n\nExpress — Paid: Via Royal Mail Tracked 24 or Parcelforce (depending on parcel size). 1–2 working days. Price calculated at checkout.\n\nCollection — Free: Collect for free at the Blue Bell LEGO Club. Available at the next scheduled club meet." },
    { title: "Processing Time", body: "Orders are dispatched within 1–2 working days. We don't ship on weekends or bank holidays." },
    { title: "Shipping Area", body: "We currently ship to mainland UK only. Scottish Highlands, Northern Ireland, and Channel Islands may incur additional charges. International shipping is not yet available." },
    { title: "Packaging", body: "Every set is carefully packaged to prevent transit damage. We use recycled packaging materials where possible." },
    { title: "Issues?", body: "If your order arrives damaged or goes missing, contact us at hello@kusooishii.com. We'll sort it." },
  ],
};

export const RETURNS_DEFAULTS: PolicyContent = {
  pageTitle: "Returns & Exchanges",
  pageSubtitle: "Straight talk on returns — no waffle",
  sections: [
    { title: "Return Policy", body: "We sell rescued stock at fair prices. Here's how returns work:\n\nSealed Sets: Return within 14 days in original condition for a full refund. Return shipping is on you unless the item was misdescribed.\n\nOpen-Box Sets: Sold as-described. Please read condition notes before buying. Returns only if the item doesn't match our description.\n\nDamaged-Box Sets: Sold as-described. Box damage is cosmetic — we tell you exactly what to expect. Returns only if contents don't match our notes." },
    { title: "How to Return", body: "1. Email Us — Contact hello@kusooishii.com with your order number and reason for return.\n2. We'll Confirm — We'll let you know if your return is eligible and send instructions.\n3. Ship It Back — Send the item back to us. We recommend tracked postage.\n4. Refund — Refund processed within 3–5 working days of receiving the item." },
    { title: "Missing Pieces?", body: "If a set we described as complete turns out to be missing pieces, contact us immediately. We'll make it right — refund, replacement, or we'll source the missing parts." },
    { title: "Your Statutory Rights", body: "Nothing in this policy affects your statutory consumer rights under UK law." },
    { title: "Contact", body: "Email: hello@kusooishii.com\nLocation: Brookville, Norfolk, UK" },
  ],
};

export const PRIVACY_DEFAULTS: PolicyContent = {
  pageTitle: "Privacy Policy",
  pageSubtitle: "",
  sections: [
    { title: "Who We Are", body: "Kuso Oishii is a LEGO® resale business based in Brookville, Norfolk, UK. We rescue and resell quality LEGO stock at fair prices." },
    { title: "Information We Collect", body: "• Name and contact information (when you place an order or contact us)\n• Shipping and billing addresses\n• Payment information (processed securely via our payment provider)\n• Purchase history\n• Device and browser information (via cookies)" },
    { title: "How We Use Your Information", body: "• Process and fulfil your orders\n• Send order confirmations and shipping updates\n• Respond to your questions and support requests\n• Send marketing emails (only with your consent)\n• Improve our website and service" },
    { title: "Your Rights (UK GDPR)", body: "Under UK data protection law, you have the right to:\n• Access your personal data\n• Correct inaccurate data\n• Request deletion of your data\n• Object to processing\n• Data portability\n• Withdraw consent at any time" },
    { title: "Cookies", body: "We use essential cookies for site functionality and analytics cookies to understand how you use our site. You can manage cookie preferences in your browser settings." },
    { title: "Data Security", body: "We implement appropriate security measures to protect your data. Payment processing is handled by secure third-party providers — we never store card details." },
    { title: "Contact", body: "Kuso Oishii — Data Protection\nEmail: privacy@kusooishii.com\nLocation: Brookville, Norfolk, UK" },
  ],
};

export const TERMS_DEFAULTS: PolicyContent = {
  pageTitle: "Terms of Service",
  pageSubtitle: "",
  sections: [
    { title: "1. Acceptance of Terms", body: "By accessing and using Kuso Oishii (\"we,\" \"our,\" or \"us\"), you accept and agree to be bound by these terms. We're based in Brookville, Norfolk, UK." },
    { title: "2. Product Information & Condition", body: "We sell rescued LEGO® stock — returned, open-box, and damaged-box items from UK retailers. Every set includes honest condition notes. We describe what we know, we don't embellish, and we don't hide damage." },
    { title: "3. Pricing", body: "All prices are in GBP (£) and include VAT where applicable. Prices may change without notice." },
    { title: "4. Shipping", body: "We ship within the UK via Evri, Royal Mail, and Parcelforce. Free standard shipping on all orders. Delivery times are estimates and not guaranteed." },
    { title: "5. Returns", body: "Sealed items may be returned within 14 days in original condition. Open-box and damaged-box items are sold as-described — please read condition notes carefully. Statutory consumer rights under UK law are not affected." },
    { title: "6. Intellectual Property", body: "LEGO® is a trademark of the LEGO Group of companies, which does not sponsor, authorise or endorse this site. All site content is © Kuso Oishii." },
    { title: "7. Governing Law", body: "These terms are governed by the laws of England and Wales." },
    { title: "8. Contact", body: "Kuso Oishii\nEmail: hello@kusooishii.com\nLocation: Brookville, Norfolk, UK" },
  ],
};

export const ORDER_TRACKING_DEFAULTS: PolicyContent = {
  pageTitle: "Track Your Order",
  pageSubtitle: "Pop in your order number and email. We'll tell you where your bricks are.",
  sections: [
    { title: "Shipping Info", body: "Most orders are processed within 1–2 working days and dispatched from Norfolk.\n\n• Standard via Evri (3–5 days): Free\n• Express via Royal Mail / Parcelforce (1–2 days): Paid\n• Collection at Blue Bell LEGO Club: Free" },
  ],
};
