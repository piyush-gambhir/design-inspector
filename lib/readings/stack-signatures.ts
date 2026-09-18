// Pure technology detection from page evidence gathered by the content script
// (DOM markers, URLs, meta tags) and by the background worker (main-world
// globals). Consumers import only `detectStack` and `PageEvidence`.
//
// Evidence rules (PRD STK-03):
// - Direct signatures only. A generic filename or class-name collision never
//   produces a detection.
// - One strong rule is enough for `high`. Two weak rules make `likely`. A
//   single weak rule is a hint, and hints are never presented as detections.
// - Version numbers appear only when a rule captures one from reliable text.
// - No downloaded site code is executed or read.
import type {
  StackCategory,
  StackConfidence,
  StackDetection,
  StackEvidence,
  StackEvidenceKind,
  StackReport,
} from '@/lib/contracts';

export interface PageEvidence {
  /** Absolute URLs of <script src>. */
  scriptUrls: string[];
  /** Absolute URLs of <link rel=stylesheet> and @import. */
  stylesheetUrls: string[];
  /** Absolute URLs of other <link> elements (preconnect, preload, icon). */
  linkUrls: string[];
  /** <meta name|property, content> pairs. */
  meta: { name: string; content: string }[];
  /** Selectors from a fixed probe list that matched at least one element. */
  domMarkers: string[];
  /** Names from a fixed probe list found on the page's window object. Empty when not probed. */
  globals: string[];
  /** Inline <script id> values, e.g. '__NEXT_DATA__'. */
  inlineScriptIds: string[];
  /** HTML element attribute names, e.g. 'data-framer-hydrate-v2'. */
  htmlAttributes: string[];
  /** Response headers when observed. Empty in V1. */
  headers: { name: string; value: string }[];
}

/**
 * Rule kinds cover every evidence channel in `PageEvidence`. Two of them
 * (`inline-script-id`, `html-attribute`) have no matching member in the
 * contract's `StackEvidenceKind`, so their evidence is reported as
 * `dom-marker` with a selector-shaped detail.
 */
type RuleKind =
  | 'script-url'
  | 'stylesheet-url'
  | 'link-url'
  | 'meta'
  | 'dom-marker'
  | 'global'
  | 'inline-script-id'
  | 'html-attribute'
  | 'header';

type RuleWeight = 'strong' | 'weak';

interface Rule {
  kind: RuleKind;
  /**
   * A string test is a case-insensitive substring match for URL and meta
   * channels, and a case-insensitive exact match for the identifier channels
   * (dom markers, globals, inline script ids, html attributes, header names).
   * A RegExp is applied as written.
   */
  test: RegExp | string;
  weight: RuleWeight;
  /** Meta rules only: the meta name or property to read. */
  name?: string;
  /** Captures a version from the matched string, group 1. */
  version?: RegExp;
}

interface Signature {
  id: string;
  name: string;
  category: StackCategory;
  rules: Rule[];
  /**
   * Ceiling for the reported confidence. Data sources cannot be distinguished
   * from a hosted asset domain, so they never reach `high`.
   */
  maxConfidence?: StackConfidence;
}

const CATEGORY_ORDER: StackCategory[] = [
  'framework',
  'builder-cms',
  'styling',
  'motion-3d',
  'font-provider',
  'infra-analytics',
];

/** URL and identifier channels behave differently for string tests. */
const URL_KINDS = new Set<RuleKind>(['script-url', 'stylesheet-url', 'link-url']);

const MAX_DETAIL = 160;

// ---------------------------------------------------------------------------
// V1 signature table (PRD STK-02: a small verified set)
//
// Deliberately absent:
// - Tailwind from class names. Utility-looking classes are not evidence
//   (PRD STK-03), and stylesheet contents are not available to this module,
//   so only the CDN build is detectable.
// - CSS Modules. Hashed-looking class names are explicitly forbidden evidence.
// - Framer Motion. There is no reliable page-level signal without reading
//   bundle contents, which this extension does not do.
// - shadcn/ui. It is copied into a project as source, so a page built with it
//   is indistinguishable from the same page written by hand.
// - UnoCSS. The injected style element carries no stable attribute of its own,
//   and utility-looking class names are not evidence (PRD STK-03).

export const SIGNATURES: Signature[] = [
  // --- Frameworks -------------------------------------------------------
  {
    id: 'nextjs',
    name: 'Next.js',
    category: 'framework',
    rules: [
      { kind: 'inline-script-id', test: '__NEXT_DATA__', weight: 'strong' },
      { kind: 'script-url', test: '/_next/static/', weight: 'strong' },
      { kind: 'global', test: /^(?:__NEXT_DATA__|__next_f)$/, weight: 'strong' },
      {
        kind: 'meta',
        name: 'generator',
        test: 'Next.js',
        weight: 'strong',
        version: /Next\.js\s*v?([\d.]+[\dx]*)/i,
      },
      { kind: 'dom-marker', test: '#__next', weight: 'weak' },
    ],
  },
  {
    id: 'react',
    name: 'React',
    category: 'framework',
    rules: [
      { kind: 'global', test: /^(?:React|__REACT_DEVTOOLS_GLOBAL_HOOK__)$/, weight: 'strong' },
      { kind: 'dom-marker', test: '[data-reactroot]', weight: 'weak' },
    ],
  },
  {
    id: 'vue',
    name: 'Vue',
    category: 'framework',
    rules: [
      { kind: 'global', test: /^(?:__VUE__|Vue)$/, weight: 'strong' },
      { kind: 'dom-marker', test: '[data-v-app]', weight: 'weak' },
    ],
  },
  {
    id: 'nuxt',
    name: 'Nuxt',
    category: 'framework',
    rules: [
      { kind: 'global', test: '__NUXT__', weight: 'strong' },
      { kind: 'script-url', test: '/_nuxt/', weight: 'strong' },
      { kind: 'dom-marker', test: '#__nuxt', weight: 'weak' },
    ],
  },
  {
    id: 'sveltekit',
    name: 'SvelteKit',
    category: 'framework',
    rules: [
      { kind: 'dom-marker', test: '[data-sveltekit-preload-data]', weight: 'strong' },
      { kind: 'script-url', test: '/_app/immutable/', weight: 'strong' },
      { kind: 'html-attribute', test: 'data-sveltekit-preload-data', weight: 'weak' },
    ],
  },
  {
    id: 'svelte',
    name: 'Svelte',
    category: 'framework',
    // Compiled Svelte leaves only scoped class hashes behind, which are not
    // usable evidence, so Svelte alone stays a hint unless SvelteKit is high.
    rules: [{ kind: 'dom-marker', test: '[data-svelte-h]', weight: 'weak' }],
  },
  {
    id: 'astro',
    name: 'Astro',
    category: 'framework',
    rules: [
      { kind: 'dom-marker', test: 'astro-island', weight: 'strong' },
      {
        kind: 'meta',
        name: 'generator',
        test: 'Astro',
        weight: 'strong',
        version: /Astro\s*v?([\d.]+)/i,
      },
      { kind: 'dom-marker', test: '[data-astro-cid]', weight: 'weak' },
      { kind: 'script-url', test: '/_astro/', weight: 'weak' },
    ],
  },
  {
    id: 'remix',
    name: 'Remix',
    category: 'framework',
    rules: [
      { kind: 'global', test: '__remixContext', weight: 'strong' },
      { kind: 'dom-marker', test: '[data-remix-run]', weight: 'weak' },
    ],
  },
  {
    id: 'angular',
    name: 'Angular',
    category: 'framework',
    // The ng-version attribute carries the version in the DOM, but the marker
    // list only reports which selectors matched, so no version is available.
    rules: [
      { kind: 'dom-marker', test: '[ng-version]', weight: 'strong' },
      { kind: 'global', test: /^(?:ng|getAllAngularRootElements)$/, weight: 'strong' },
    ],
  },
  {
    id: 'solidjs',
    name: 'SolidJS',
    category: 'framework',
    rules: [
      { kind: 'dom-marker', test: '[data-hk]', weight: 'weak' },
      { kind: 'global', test: '_$HY', weight: 'weak' },
    ],
  },
  {
    id: 'gatsby',
    name: 'Gatsby',
    category: 'framework',
    rules: [
      { kind: 'dom-marker', test: '#___gatsby', weight: 'strong' },
      { kind: 'script-url', test: '/page-data/', weight: 'strong' },
    ],
  },
  {
    id: 'qwik',
    name: 'Qwik',
    category: 'framework',
    // `q:container` sits on the html element itself, which the marker probes
    // cannot select, so it is read from the html attribute channel instead.
    rules: [{ kind: 'html-attribute', test: 'q:container', weight: 'strong' }],
  },
  {
    id: 'eleventy',
    name: 'Eleventy',
    category: 'framework',
    rules: [
      {
        kind: 'meta',
        name: 'generator',
        test: 'Eleventy',
        weight: 'strong',
        version: /Eleventy\s*v?([\d.]+)/i,
      },
    ],
  },
  {
    id: 'hugo',
    name: 'Hugo',
    category: 'framework',
    rules: [
      {
        kind: 'meta',
        name: 'generator',
        test: 'Hugo',
        weight: 'strong',
        version: /Hugo\s*v?([\d.]+)/i,
      },
    ],
  },
  {
    id: 'jekyll',
    name: 'Jekyll',
    category: 'framework',
    rules: [
      {
        kind: 'meta',
        name: 'generator',
        test: 'Jekyll',
        weight: 'strong',
        version: /Jekyll\s*v?([\d.]+)/i,
      },
    ],
  },
  {
    id: 'docusaurus',
    name: 'Docusaurus',
    category: 'framework',
    rules: [
      {
        kind: 'meta',
        name: 'generator',
        test: 'Docusaurus',
        weight: 'strong',
        version: /Docusaurus\s*v?([\d.]+)/i,
      },
      { kind: 'dom-marker', test: '#__docusaurus', weight: 'strong' },
    ],
  },
  {
    id: 'vitepress',
    name: 'VitePress',
    category: 'framework',
    // A Vue app mounted on #app is all a VitePress page shows of itself, and a
    // `/assets/` bundle path is far too common to count as evidence at all, so
    // one weak rule is the honest reading: VitePress can only ever be a hint.
    rules: [{ kind: 'dom-marker', test: '#app[data-v-app]', weight: 'weak' }],
  },
  {
    id: 'alpine',
    name: 'Alpine.js',
    category: 'framework',
    rules: [{ kind: 'dom-marker', test: '[x-data]', weight: 'strong' }],
  },
  {
    id: 'htmx',
    name: 'htmx',
    category: 'framework',
    rules: [
      { kind: 'dom-marker', test: '[hx-get]', weight: 'strong' },
      { kind: 'dom-marker', test: '[hx-post]', weight: 'strong' },
      { kind: 'dom-marker', test: '[hx-target]', weight: 'strong' },
      { kind: 'script-url', test: 'htmx.org', weight: 'strong' },
    ],
  },
  {
    id: 'jquery',
    name: 'jQuery',
    category: 'framework',
    rules: [
      { kind: 'global', test: 'jQuery', weight: 'strong' },
      { kind: 'script-url', test: '/jquery', weight: 'strong' },
    ],
  },
  {
    id: 'stimulus',
    name: 'Stimulus',
    category: 'framework',
    // Both attributes are plain enough that a hand-written page could use
    // either one, so neither is strong and both together only make it likely.
    rules: [
      { kind: 'dom-marker', test: '[data-controller]', weight: 'weak' },
      { kind: 'dom-marker', test: '[data-action]', weight: 'weak' },
    ],
  },
  {
    id: 'turbo',
    name: 'Turbo',
    category: 'framework',
    rules: [
      { kind: 'script-url', test: '@hotwired/turbo', weight: 'strong' },
      { kind: 'dom-marker', test: '[data-turbo]', weight: 'weak' },
    ],
  },

  // --- Builders and CMS -------------------------------------------------
  {
    id: 'webflow',
    name: 'Webflow',
    category: 'builder-cms',
    rules: [
      { kind: 'dom-marker', test: '[data-wf-page]', weight: 'strong' },
      { kind: 'html-attribute', test: 'data-wf-page', weight: 'strong' },
      { kind: 'script-url', test: /webflow\.js|assets\.website-files\.com/i, weight: 'strong' },
      { kind: 'dom-marker', test: 'html.w-mod-js', weight: 'weak' },
      { kind: 'dom-marker', test: '.w-webflow-badge', weight: 'weak' },
    ],
  },
  {
    id: 'framer',
    name: 'Framer',
    category: 'builder-cms',
    rules: [
      { kind: 'dom-marker', test: '[data-framer-hydrate-v2]', weight: 'strong' },
      { kind: 'script-url', test: /framerusercontent\.com|framer\.com\/m\//i, weight: 'strong' },
      { kind: 'meta', name: 'generator', test: 'Framer', weight: 'strong' },
      { kind: 'dom-marker', test: '[data-framer-name]', weight: 'weak' },
    ],
  },
  {
    id: 'wordpress',
    name: 'WordPress',
    category: 'builder-cms',
    rules: [
      {
        kind: 'meta',
        name: 'generator',
        test: 'WordPress',
        weight: 'strong',
        version: /WordPress\s*v?([\d.]+)/i,
      },
      { kind: 'link-url', test: /\/wp-content\/|\/wp-includes\//i, weight: 'strong' },
      { kind: 'script-url', test: /\/wp-content\/|\/wp-includes\//i, weight: 'strong' },
      { kind: 'dom-marker', test: 'body[class*="wp-"]', weight: 'weak' },
    ],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'builder-cms',
    rules: [
      { kind: 'global', test: 'Shopify', weight: 'strong' },
      { kind: 'script-url', test: 'cdn.shopify.com', weight: 'strong' },
      { kind: 'dom-marker', test: '#shopify-section-header', weight: 'weak' },
      { kind: 'dom-marker', test: '[data-shopify]', weight: 'weak' },
    ],
  },
  {
    id: 'wix',
    name: 'Wix',
    category: 'builder-cms',
    rules: [
      { kind: 'dom-marker', test: '#SITE_CONTAINER', weight: 'strong' },
      { kind: 'dom-marker', test: '[data-wix-app]', weight: 'strong' },
      { kind: 'script-url', test: /static\.parastorage\.com|wixstatic\.com/i, weight: 'strong' },
    ],
  },
  {
    id: 'squarespace',
    name: 'Squarespace',
    category: 'builder-cms',
    rules: [
      { kind: 'script-url', test: /squarespace\.com|sqsp\.net/i, weight: 'strong' },
      { kind: 'meta', name: 'generator', test: 'Squarespace', weight: 'strong' },
      { kind: 'dom-marker', test: '.sqs-layout', weight: 'weak' },
    ],
  },
  {
    id: 'sanity',
    name: 'Sanity',
    category: 'builder-cms',
    // A data source, not a rendering layer: capped so an asset CDN hit never
    // reads as a confident statement about how the page is built.
    maxConfidence: 'likely',
    rules: [
      { kind: 'link-url', test: 'cdn.sanity.io', weight: 'weak' },
      { kind: 'script-url', test: 'cdn.sanity.io', weight: 'weak' },
      { kind: 'dom-marker', test: '[data-sanity]', weight: 'weak' },
    ],
  },
  {
    id: 'contentful',
    name: 'Contentful',
    category: 'builder-cms',
    maxConfidence: 'likely',
    rules: [
      { kind: 'link-url', test: /ctfassets\.net|contentful\.com/i, weight: 'weak' },
      { kind: 'script-url', test: /ctfassets\.net|contentful\.com/i, weight: 'weak' },
    ],
  },

  // --- Styling ----------------------------------------------------------
  {
    id: 'tailwind',
    name: 'Tailwind',
    category: 'styling',
    // URLs only. Class names that look like utilities are not evidence
    // (PRD STK-03), and this module never sees stylesheet contents, so a
    // compiled Tailwind build is simply not detectable in V1.
    rules: [{ kind: 'script-url', test: 'cdn.tailwindcss.com', weight: 'strong' }],
  },
  {
    id: 'styled-components',
    name: 'styled-components',
    category: 'styling',
    rules: [
      { kind: 'dom-marker', test: 'style[data-styled]', weight: 'strong' },
      // The probe is one selector covering both positions of the class, and a
      // marker is reported as the probe that matched, so the rule reads it
      // whole rather than testing half of it and never firing.
      { kind: 'dom-marker', test: '[class^="sc-"], [class*=" sc-"]', weight: 'weak' },
    ],
  },
  {
    id: 'emotion',
    name: 'Emotion',
    category: 'styling',
    rules: [
      { kind: 'dom-marker', test: 'style[data-emotion]', weight: 'strong' },
      { kind: 'dom-marker', test: '[class^="css-"], [class*=" css-"]', weight: 'weak' },
    ],
  },
  {
    id: 'bootstrap',
    name: 'Bootstrap',
    category: 'styling',
    rules: [
      {
        kind: 'stylesheet-url',
        test: /bootstrap(\.min)?\.(css|js)|cdn\.jsdelivr\.net\/npm\/bootstrap/i,
        weight: 'strong',
      },
      {
        kind: 'script-url',
        test: /bootstrap(\.min)?\.(css|js)|cdn\.jsdelivr\.net\/npm\/bootstrap/i,
        weight: 'strong',
      },
      { kind: 'dom-marker', test: 'link[href*="bootstrap"]', weight: 'weak' },
    ],
  },
  {
    id: 'bulma',
    name: 'Bulma',
    category: 'styling',
    rules: [
      {
        kind: 'stylesheet-url',
        test: /bulma(\.min)?\.css|\/npm\/bulma/i,
        weight: 'strong',
      },
    ],
  },
  {
    id: 'foundation',
    name: 'Foundation',
    category: 'styling',
    rules: [
      {
        kind: 'stylesheet-url',
        test: /foundation(\.min)?\.css|foundation-sites/i,
        weight: 'strong',
      },
    ],
  },
  {
    id: 'chakra',
    name: 'Chakra UI',
    category: 'styling',
    // A `chakra-` class prefix is the only thing a built page shows, and a
    // class name is not evidence on its own (PRD STK-03), so this is a hint.
    rules: [{ kind: 'dom-marker', test: '[class*="chakra-"]', weight: 'weak' }],
  },
  {
    id: 'radix',
    name: 'Radix UI',
    category: 'styling',
    // Radix writes its own data attributes onto the elements it portals and
    // scrolls. Either one alone could be a coincidence; both together are not.
    rules: [
      { kind: 'dom-marker', test: '[data-radix-popper-content-wrapper]', weight: 'weak' },
      { kind: 'dom-marker', test: '[data-radix-scroll-area-viewport]', weight: 'weak' },
    ],
  },
  {
    id: 'mui',
    name: 'Material UI',
    category: 'styling',
    // Mui-prefixed class names again: two different components carrying them
    // is the point at which it stops reading as a naming coincidence.
    rules: [
      { kind: 'dom-marker', test: '[class*="MuiBox"]', weight: 'weak' },
      { kind: 'dom-marker', test: '[class*="MuiButton"]', weight: 'weak' },
    ],
  },

  // --- Motion and 3D ----------------------------------------------------
  {
    id: 'gsap',
    name: 'GSAP',
    category: 'motion-3d',
    rules: [
      { kind: 'global', test: 'gsap', weight: 'strong' },
      { kind: 'script-url', test: /(?:^|[/@])gsap(?:[./\-@]|$)/i, weight: 'strong' },
      { kind: 'dom-marker', test: '[data-gsap]', weight: 'weak' },
    ],
  },
  {
    id: 'lenis',
    name: 'Lenis',
    category: 'motion-3d',
    rules: [
      { kind: 'dom-marker', test: '.lenis', weight: 'strong' },
      { kind: 'dom-marker', test: '[data-lenis]', weight: 'strong' },
      { kind: 'global', test: 'Lenis', weight: 'strong' },
      { kind: 'script-url', test: 'lenis', weight: 'strong' },
    ],
  },
  {
    id: 'locomotive',
    name: 'Locomotive Scroll',
    category: 'motion-3d',
    rules: [
      { kind: 'dom-marker', test: '[data-scroll-container]', weight: 'strong' },
      { kind: 'script-url', test: 'locomotive-scroll', weight: 'strong' },
    ],
  },
  {
    id: 'threejs',
    name: 'Three.js',
    category: 'motion-3d',
    rules: [
      { kind: 'global', test: 'THREE', weight: 'strong' },
      { kind: 'script-url', test: /three\.module\.js|\/three@|three\.min\.js/i, weight: 'strong' },
      { kind: 'dom-marker', test: 'canvas[data-engine*="three"]', weight: 'weak' },
    ],
  },
  {
    id: 'spline',
    name: 'Spline',
    category: 'motion-3d',
    rules: [
      { kind: 'dom-marker', test: 'spline-viewer', weight: 'strong' },
      { kind: 'script-url', test: /unpkg\.com\/@splinetool|prod\.spline\.design/i, weight: 'strong' },
    ],
  },
  {
    id: 'rive',
    name: 'Rive',
    category: 'motion-3d',
    rules: [
      { kind: 'script-url', test: /rive-app|unpkg\.com\/@rive-app/i, weight: 'strong' },
      { kind: 'dom-marker', test: 'canvas.rive', weight: 'weak' },
    ],
  },
  {
    id: 'lottie',
    name: 'Lottie',
    category: 'motion-3d',
    rules: [
      { kind: 'dom-marker', test: 'lottie-player', weight: 'strong' },
      { kind: 'script-url', test: /lottie-player|lottie-web|lottie\.min\.js/i, weight: 'strong' },
      { kind: 'dom-marker', test: '[data-lottie]', weight: 'weak' },
    ],
  },
  {
    id: 'scrolltrigger',
    name: 'ScrollTrigger',
    category: 'motion-3d',
    // A GSAP plugin, and worth naming separately: it is the difference between
    // a page that animates and a page whose animation is driven by scrolling.
    rules: [
      { kind: 'script-url', test: 'ScrollTrigger', weight: 'strong' },
      { kind: 'global', test: 'ScrollTrigger', weight: 'strong' },
    ],
  },
  {
    id: 'swiper',
    name: 'Swiper',
    category: 'motion-3d',
    rules: [
      { kind: 'dom-marker', test: '.swiper', weight: 'strong' },
      { kind: 'script-url', test: 'swiper', weight: 'strong' },
    ],
  },
  {
    id: 'splide',
    name: 'Splide',
    category: 'motion-3d',
    rules: [{ kind: 'dom-marker', test: '.splide', weight: 'strong' }],
  },
  {
    id: 'barba',
    name: 'Barba.js',
    category: 'motion-3d',
    rules: [{ kind: 'dom-marker', test: '[data-barba]', weight: 'strong' }],
  },
  {
    id: 'motion-one',
    name: 'Motion One',
    category: 'motion-3d',
    rules: [{ kind: 'script-url', test: 'motion.dev', weight: 'strong' }],
  },

  // --- Font providers ---------------------------------------------------
  {
    id: 'google-fonts',
    name: 'Google Fonts',
    category: 'font-provider',
    rules: [
      // Only a requested stylesheet proves use. A bare preconnect/preload link
      // (wordpress.org has one with every face self-hosted) is a weak hint.
      { kind: 'stylesheet-url', test: /fonts\.googleapis\.com|fonts\.gstatic\.com/i, weight: 'strong' },
      { kind: 'link-url', test: /fonts\.googleapis\.com\/css/i, weight: 'strong' },
      { kind: 'link-url', test: /fonts\.googleapis\.com|fonts\.gstatic\.com/i, weight: 'weak' },
    ],
  },
  {
    id: 'adobe-fonts',
    name: 'Adobe Fonts',
    category: 'font-provider',
    rules: [
      { kind: 'stylesheet-url', test: /use\.typekit\.net|p\.typekit\.net/i, weight: 'strong' },
      { kind: 'link-url', test: /use\.typekit\.net\/.+\.css/i, weight: 'strong' },
      { kind: 'link-url', test: /use\.typekit\.net|p\.typekit\.net/i, weight: 'weak' },
      { kind: 'script-url', test: /use\.typekit\.net|p\.typekit\.net/i, weight: 'strong' },
    ],
  },
  {
    id: 'fontshare',
    name: 'Fontshare',
    category: 'font-provider',
    rules: [
      { kind: 'stylesheet-url', test: /api\.fontshare\.com|cdn\.fontshare\.com/i, weight: 'strong' },
      { kind: 'link-url', test: /api\.fontshare\.com\/(v2\/)?css/i, weight: 'strong' },
      { kind: 'link-url', test: /api\.fontshare\.com|cdn\.fontshare\.com/i, weight: 'weak' },
    ],
  },

  // --- Infrastructure and analytics -------------------------------------
  {
    id: 'vercel',
    name: 'Vercel',
    category: 'infra-analytics',
    // Hosting cannot be proven from the page alone, so the insights script is
    // only a weak signal and Vercel stays a hint until a header is observed.
    rules: [
      { kind: 'header', test: 'x-vercel-id', weight: 'strong' },
      { kind: 'script-url', test: '/_vercel/insights', weight: 'weak' },
    ],
  },
  {
    id: 'vercel-analytics',
    name: 'Vercel Analytics',
    category: 'infra-analytics',
    rules: [{ kind: 'script-url', test: '/_vercel/insights', weight: 'strong' }],
  },
  {
    id: 'netlify',
    name: 'Netlify',
    category: 'infra-analytics',
    rules: [
      { kind: 'header', test: 'x-nf-request-id', weight: 'strong' },
      { kind: 'script-url', test: 'netlify-identity-widget', weight: 'weak' },
    ],
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'infra-analytics',
    // Rocket Loader, challenge scripts, and email decoding all live under
    // /cdn-cgi/ on the site's own origin.
    rules: [
      { kind: 'header', test: 'cf-ray', weight: 'strong' },
      { kind: 'script-url', test: '/cdn-cgi/', weight: 'strong' },
    ],
  },
  {
    id: 'ga4',
    name: 'Google Analytics 4',
    category: 'infra-analytics',
    rules: [{ kind: 'script-url', test: 'googletagmanager.com/gtag/js', weight: 'strong' }],
  },
  {
    id: 'gtm',
    name: 'Google Tag Manager',
    category: 'infra-analytics',
    // A container tells us nothing about what it loads, so the loader alone is
    // weak and surfaces only as a hint. The no-script fallback frame is the
    // second weak signal that makes the container itself worth reporting.
    rules: [
      { kind: 'script-url', test: 'googletagmanager.com/gtm.js', weight: 'weak' },
      {
        kind: 'dom-marker',
        test: 'noscript iframe[src*="googletagmanager.com/ns.html"]',
        weight: 'weak',
      },
    ],
  },
  {
    id: 'plausible',
    name: 'Plausible',
    category: 'infra-analytics',
    rules: [{ kind: 'script-url', test: 'plausible.io/js/', weight: 'strong' }],
  },
  {
    id: 'posthog',
    name: 'PostHog',
    category: 'infra-analytics',
    rules: [
      { kind: 'global', test: 'posthog', weight: 'strong' },
      { kind: 'script-url', test: /posthog\.com|\/static\/array\.js/i, weight: 'strong' },
    ],
  },
  {
    id: 'hotjar',
    name: 'Hotjar',
    category: 'infra-analytics',
    rules: [
      { kind: 'script-url', test: 'static.hotjar.com', weight: 'strong' },
      { kind: 'global', test: 'hj', weight: 'strong' },
    ],
  },

  // --- Embeds and third-party services ----------------------------------
  //
  // `StackCategory` has no member for an embed or a paid service, so these are
  // reported under infra-analytics and say what they are in the name instead.
  {
    id: 'youtube-embed',
    name: 'YouTube embed',
    category: 'infra-analytics',
    rules: [{ kind: 'dom-marker', test: 'iframe[src*="youtube.com/embed"]', weight: 'strong' }],
  },
  {
    id: 'vimeo-embed',
    name: 'Vimeo embed',
    category: 'infra-analytics',
    rules: [{ kind: 'dom-marker', test: 'iframe[src*="player.vimeo.com"]', weight: 'strong' }],
  },
  {
    id: 'stripe',
    name: 'Stripe.js',
    category: 'infra-analytics',
    rules: [{ kind: 'script-url', test: 'js.stripe.com', weight: 'strong' }],
  },
  {
    id: 'intercom',
    name: 'Intercom',
    category: 'infra-analytics',
    rules: [
      { kind: 'script-url', test: 'widget.intercom.io', weight: 'strong' },
      { kind: 'global', test: 'Intercom', weight: 'strong' },
    ],
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'infra-analytics',
    rules: [
      { kind: 'script-url', test: 'js.hs-scripts.com', weight: 'strong' },
      { kind: 'script-url', test: 'js.hsforms.net', weight: 'strong' },
    ],
  },
  {
    id: 'segment',
    name: 'Segment',
    category: 'infra-analytics',
    // `analytics` is a name plenty of sites define for themselves, so it is
    // only a supporting signal next to the CDN script.
    rules: [
      { kind: 'script-url', test: 'cdn.segment.com', weight: 'strong' },
      { kind: 'global', test: 'analytics', weight: 'weak' },
    ],
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    category: 'infra-analytics',
    rules: [
      { kind: 'script-url', test: 'cdn.mxpnl.com', weight: 'strong' },
      { kind: 'global', test: 'mixpanel', weight: 'strong' },
    ],
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'infra-analytics',
    rules: [
      { kind: 'script-url', test: 'browser.sentry-cdn.com', weight: 'strong' },
      { kind: 'global', test: 'Sentry', weight: 'strong' },
    ],
  },
  {
    id: 'turnstile',
    name: 'Cloudflare Turnstile',
    category: 'infra-analytics',
    rules: [
      { kind: 'script-url', test: 'challenges.cloudflare.com/turnstile', weight: 'strong' },
    ],
  },
  {
    id: 'recaptcha',
    name: 'reCAPTCHA',
    category: 'infra-analytics',
    rules: [{ kind: 'script-url', test: 'google.com/recaptcha', weight: 'strong' }],
  },
];

/** Detections that follow from another detection rather than from direct evidence. */
const IMPLICATIONS: { when: string[]; id: string; name: string; category: StackCategory }[] = [
  { when: ['nextjs', 'remix'], id: 'react', name: 'React', category: 'framework' },
  { when: ['sveltekit'], id: 'svelte', name: 'Svelte', category: 'framework' },
];

// ---------------------------------------------------------------------------

export function detectStack(evidence: PageEvidence): StackReport {
  const observedAt = new Date().toISOString();
  const detections: StackDetection[] = [];
  const hints: { name: string; evidence: StackEvidence[] }[] = [];
  const highIds = new Set<string>();

  for (const signature of SIGNATURES) {
    const matches = signature.rules
      .map((rule) => matchRule(rule, evidence))
      .filter((match): match is RuleMatch => match !== null);
    if (matches.length === 0) continue;

    const strong = matches.filter((match) => match.weight === 'strong');
    const weak = matches.filter((match) => match.weight === 'weak');
    const stackEvidence = matches.map((match) => match.evidence);

    if (strong.length >= 1) {
      const confidence = signature.maxConfidence ?? 'high';
      if (confidence === 'high') highIds.add(signature.id);
      detections.push({
        id: signature.id,
        name: signature.name,
        category: signature.category,
        confidence,
        evidence: stackEvidence,
        version: firstVersion(matches),
        observedAt,
      });
      continue;
    }

    if (weak.length >= 2) {
      detections.push({
        id: signature.id,
        name: signature.name,
        category: signature.category,
        confidence: 'likely',
        evidence: stackEvidence,
        version: firstVersion(matches),
        observedAt,
      });
      continue;
    }

    hints.push({ name: signature.name, evidence: stackEvidence });
  }

  applyImplications(detections, hints, highIds, observedAt);

  const detectedNames = new Set(detections.map((detection) => detection.name));
  const remainingHints = hints
    .filter((hint) => !detectedNames.has(hint.name))
    .sort((a, b) => compareStrings(a.name, b.name));

  detections.sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      compareStrings(a.name, b.name),
  );

  return { detections, hints: remainingHints, scope: 'page', observedAt };
}

/**
 * Adds the detections that follow from another one, for example React under a
 * high-confidence Next.js. An existing direct detection is left alone; a hint
 * is promoted to `likely` and keeps the evidence it already had.
 */
function applyImplications(
  detections: StackDetection[],
  hints: { name: string; evidence: StackEvidence[] }[],
  highIds: Set<string>,
  observedAt: string,
): void {
  for (const implication of IMPLICATIONS) {
    const trigger = implication.when.find((id) => highIds.has(id));
    if (!trigger) continue;
    if (detections.some((detection) => detection.id === implication.id)) continue;

    const triggerName =
      SIGNATURES.find((signature) => signature.id === trigger)?.name ?? trigger;
    const implied: StackEvidence = {
      kind: 'dom-marker',
      detail: `implied by ${triggerName}`,
    };

    const hintIndex = hints.findIndex((hint) => hint.name === implication.name);
    const inherited = hintIndex >= 0 ? (hints[hintIndex]?.evidence ?? []) : [];
    if (hintIndex >= 0) hints.splice(hintIndex, 1);

    detections.push({
      id: implication.id,
      name: implication.name,
      category: implication.category,
      confidence: 'likely',
      evidence: [...inherited, implied],
      version: null,
      observedAt,
    });
  }
}

interface RuleMatch {
  weight: RuleWeight;
  evidence: StackEvidence;
  matched: string;
  version?: RegExp;
}

function matchRule(rule: Rule, evidence: PageEvidence): RuleMatch | null {
  for (const candidate of candidatesFor(rule, evidence)) {
    if (!testMatches(rule, candidate.text)) continue;
    return {
      weight: rule.weight,
      evidence: { kind: evidenceKind(rule.kind), detail: clampDetail(candidate.detail) },
      matched: candidate.text,
      ...(rule.version ? { version: rule.version } : {}),
    };
  }
  return null;
}

interface Candidate {
  /** The string the rule's test runs against. */
  text: string;
  /** What the user sees as evidence. */
  detail: string;
}

function candidatesFor(rule: Rule, evidence: PageEvidence): Candidate[] {
  switch (rule.kind) {
    case 'script-url':
      return evidence.scriptUrls.map((url) => ({ text: url, detail: url }));
    case 'stylesheet-url':
      return evidence.stylesheetUrls.map((url) => ({ text: url, detail: url }));
    case 'link-url':
      return evidence.linkUrls.map((url) => ({ text: url, detail: url }));
    case 'meta':
      return evidence.meta
        .filter((entry) => rule.name === undefined || equalsIgnoreCase(entry.name, rule.name))
        .map((entry) => ({ text: entry.content, detail: `meta:${entry.name}=${entry.content}` }));
    case 'dom-marker':
      return evidence.domMarkers.map((selector) => ({ text: selector, detail: selector }));
    case 'global':
      return evidence.globals.map((name) => ({ text: name, detail: name }));
    case 'inline-script-id':
      return evidence.inlineScriptIds.map((id) => ({ text: id, detail: `script#${id}` }));
    case 'html-attribute':
      return evidence.htmlAttributes.map((attr) => ({ text: attr, detail: `html[${attr}]` }));
    case 'header':
      return evidence.headers.map((header) => ({
        text: header.name,
        detail: `${header.name}: ${header.value}`,
      }));
  }
}

function testMatches(rule: Rule, text: string): boolean {
  if (rule.test instanceof RegExp) return rule.test.test(text);
  if (URL_KINDS.has(rule.kind) || rule.kind === 'meta') {
    return text.toLowerCase().includes(rule.test.toLowerCase());
  }
  // Identifier channels report exact probe results, so an exact match keeps a
  // near miss such as `[data-framer-name-extra]` from counting.
  return equalsIgnoreCase(text, rule.test);
}

function evidenceKind(kind: RuleKind): StackEvidenceKind {
  // The contract has no member for the inline-script-id and html-attribute
  // channels, so both are reported as selector-shaped dom markers.
  if (kind === 'inline-script-id' || kind === 'html-attribute') return 'dom-marker';
  return kind;
}

function firstVersion(matches: RuleMatch[]): string | null {
  for (const match of matches) {
    if (!match.version) continue;
    const found = match.version.exec(match.matched);
    const captured = found?.[1];
    if (captured) return captured;
  }
  return null;
}

function equalsIgnoreCase(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function clampDetail(detail: string): string {
  return detail.length <= MAX_DETAIL ? detail : detail.slice(0, MAX_DETAIL);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
