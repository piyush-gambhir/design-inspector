// Stack evidence gathering (PRD STK-01, STK-03). The content script only
// observes; the pure signature table decides what counts as a detection.
//
// The isolated world cannot read the page's own window object, so `globals`
// arrives from the background worker's MAIN-world probe and is passed straight
// through. Response headers are out of scope in V1.

import type { PageEvidence } from '../readings/stack-signatures';

/** Fixed probe list. Each selector that matches becomes one dom-marker. */
export const DOM_PROBES: readonly string[] = [
  '#__next',
  '#__nuxt',
  '[data-reactroot]',
  '[data-react-helmet]',
  'astro-island',
  '[data-astro-cid]',
  '[data-svelte-h]',
  '[data-sveltekit-preload-data]',
  '[ng-version]',
  '[data-v-app]',
  '[data-framer-hydrate-v2]',
  '[data-framer-name]',
  '.w-webflow-badge',
  '[data-wf-page]',
  'html.w-mod-js',
  '[data-shopify]',
  '#shopify-section-header',
  'link[href*="/wp-content/"]',
  'script[src*="/wp-includes/"]',
  'body[class*="wp-"]',
  '[data-wix-app]',
  '#SITE_CONTAINER',
  '.sqs-layout',
  '[data-sanity]',
  '[data-remix-run]',
  '[data-solid]',
  '[data-hk]',
  'script[src*="gsap"]',
  '[data-gsap]',
  '[data-lenis]',
  '.lenis',
  '[data-scroll-container]',
  'canvas[data-engine*="three"]',
  'spline-viewer',
  'canvas.rive',
  'lottie-player',
  '[data-lottie]',
  '[class^="sc-"], [class*=" sc-"]',
  '[class^="css-"], [class*=" css-"]',
  'style[data-emotion]',
  'style[data-styled]',
  'link[href*="bootstrap"]',
  '#___gatsby',
  '#__docusaurus',
  '#app[data-v-app]',
  '[x-data]',
  '[hx-get]',
  '[hx-post]',
  '[hx-target]',
  '[data-controller]',
  '[data-action]',
  '[data-turbo]',
  '[class*="chakra-"]',
  '[data-radix-popper-content-wrapper]',
  '[data-radix-scroll-area-viewport]',
  '[class*="MuiBox"]',
  '[class*="MuiButton"]',
  '.swiper',
  '.splide',
  '[data-barba]',
  'iframe[src*="youtube.com/embed"]',
  'iframe[src*="player.vimeo.com"]',
  'noscript iframe[src*="googletagmanager.com/ns.html"]',
];

function absolute(url: string | null, baseUrl: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

function importUrls(doc: Document): string[] {
  const out: string[] = [];
  let sheets: StyleSheet[];
  try {
    sheets = Array.from(doc.styleSheets);
  } catch {
    return out;
  }
  for (const sheet of sheets) {
    let rules: CSSRuleList | null = null;
    try {
      rules = (sheet as CSSStyleSheet).cssRules;
    } catch {
      continue;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      const imported = (rule as CSSImportRule).href;
      if (typeof imported === 'string') {
        const resolved = absolute(imported, (sheet as CSSStyleSheet).href ?? doc.baseURI);
        if (resolved) out.push(resolved);
      }
    }
  }
  return out;
}

/** Observable evidence for stack detection. Never throws. */
export function gatherEvidence(globals: string[] = [], doc: Document = document): PageEvidence {
  const baseUrl = doc.baseURI;

  const scriptUrls: string[] = [];
  const inlineScriptIds: string[] = [];
  try {
    doc.querySelectorAll('script').forEach((node) => {
      const src = node.getAttribute('src');
      if (src) {
        const resolved = absolute(src, baseUrl);
        if (resolved) scriptUrls.push(resolved);
        return;
      }
      const id = node.getAttribute('id');
      if (id) inlineScriptIds.push(id);
    });
  } catch {
    // Leave the lists as they are.
  }

  const stylesheetUrls: string[] = [];
  const linkUrls: string[] = [];
  try {
    doc.querySelectorAll('link[href]').forEach((node) => {
      const resolved = absolute(node.getAttribute('href'), baseUrl);
      if (!resolved) return;
      const rel = (node.getAttribute('rel') ?? '').toLowerCase();
      if (rel.split(/\s+/).includes('stylesheet')) stylesheetUrls.push(resolved);
      else linkUrls.push(resolved);
    });
  } catch {
    // Leave the lists as they are.
  }
  stylesheetUrls.push(...importUrls(doc));

  const meta: { name: string; content: string }[] = [];
  try {
    doc.querySelectorAll('meta').forEach((node) => {
      const name = node.getAttribute('name') ?? node.getAttribute('property');
      const content = node.getAttribute('content');
      if (name && content !== null) meta.push({ name, content });
    });
  } catch {
    // Leave the list as it is.
  }

  const domMarkers: string[] = [];
  for (const probe of DOM_PROBES) {
    try {
      if (doc.querySelector(probe)) domMarkers.push(probe);
    } catch {
      // An unsupported selector is simply not evidence.
    }
  }

  let htmlAttributes: string[] = [];
  try {
    htmlAttributes = Array.from(doc.documentElement?.attributes ?? []).map(
      (attribute) => attribute.name,
    );
  } catch {
    htmlAttributes = [];
  }

  return {
    scriptUrls: Array.from(new Set(scriptUrls)),
    stylesheetUrls: Array.from(new Set(stylesheetUrls)),
    linkUrls: Array.from(new Set(linkUrls)),
    meta,
    domMarkers,
    globals,
    inlineScriptIds,
    htmlAttributes,
    headers: [],
  };
}
