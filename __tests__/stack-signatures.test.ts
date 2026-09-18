import { describe, expect, it } from 'vitest';
import type { StackConfidence } from '@/lib/contracts';
import type { PageEvidence } from '@/lib/readings/stack-signatures';
import { SIGNATURES, detectStack } from '@/lib/readings/stack-signatures';
import { DOM_PROBES } from '@/lib/inspector/evidence';
import { GLOBAL_PROBES } from '@/lib/background/research';
import { emptyEvidence } from './fixtures/summary';

interface Case {
  id: string;
  name: string;
  expected: StackConfidence | 'hint';
  positive: Partial<PageEvidence>;
  negative: Partial<PageEvidence>;
}

const CASES: Case[] = [
  {
    id: 'nextjs',
    name: 'Next.js',
    expected: 'high',
    positive: { inlineScriptIds: ['__NEXT_DATA__'] },
    negative: { scriptUrls: ['https://example.com/_next-gen/static/app.js'], domMarkers: ['#__next-root'] },
  },
  {
    id: 'react',
    name: 'React',
    expected: 'high',
    positive: { globals: ['React'] },
    negative: { scriptUrls: ['https://cdn.example.com/react-icons.js'] },
  },
  {
    id: 'vue',
    name: 'Vue',
    expected: 'high',
    positive: { globals: ['__VUE__'] },
    negative: { globals: ['VueUse'] },
  },
  {
    id: 'nuxt',
    name: 'Nuxt',
    expected: 'high',
    positive: { scriptUrls: ['https://example.com/_nuxt/entry.js'] },
    negative: { scriptUrls: ['https://example.com/nuxt-docs/app.js'] },
  },
  {
    id: 'sveltekit',
    name: 'SvelteKit',
    expected: 'high',
    positive: { domMarkers: ['[data-sveltekit-preload-data]'] },
    negative: { scriptUrls: ['https://example.com/_app/chunk.js'] },
  },
  {
    id: 'svelte',
    name: 'Svelte',
    expected: 'hint',
    positive: { domMarkers: ['[data-svelte-h]'] },
    negative: { domMarkers: ['[data-svelte]'] },
  },
  {
    id: 'astro',
    name: 'Astro',
    expected: 'high',
    positive: { domMarkers: ['astro-island'] },
    negative: { domMarkers: ['astro-islands'] },
  },
  {
    id: 'remix',
    name: 'Remix',
    expected: 'high',
    positive: { globals: ['__remixContext'] },
    negative: { globals: ['__remix'] },
  },
  {
    id: 'angular',
    name: 'Angular',
    expected: 'high',
    positive: { domMarkers: ['[ng-version]'] },
    negative: { globals: ['angular'] },
  },
  {
    id: 'solidjs',
    name: 'SolidJS',
    expected: 'likely',
    positive: { domMarkers: ['[data-hk]'], globals: ['_$HY'] },
    negative: { domMarkers: ['[data-hkey]'] },
  },
  {
    id: 'gatsby',
    name: 'Gatsby',
    expected: 'high',
    positive: { domMarkers: ['#___gatsby'] },
    negative: { domMarkers: ['#___gatsby-root'], scriptUrls: ['https://example.com/page-data.js'] },
  },
  {
    id: 'qwik',
    name: 'Qwik',
    expected: 'high',
    positive: { htmlAttributes: ['q:container'] },
    negative: { htmlAttributes: ['q:containers'], domMarkers: ['[q-container]'] },
  },
  {
    id: 'eleventy',
    name: 'Eleventy',
    expected: 'high',
    positive: { meta: [{ name: 'generator', content: 'Eleventy v2.0.1' }] },
    negative: { meta: [{ name: 'description', content: 'Built with Eleventy' }] },
  },
  {
    id: 'hugo',
    name: 'Hugo',
    expected: 'high',
    positive: { meta: [{ name: 'generator', content: 'Hugo 0.128.0' }] },
    negative: { meta: [{ name: 'description', content: 'A site about Hugo' }] },
  },
  {
    id: 'jekyll',
    name: 'Jekyll',
    expected: 'high',
    positive: { meta: [{ name: 'generator', content: 'Jekyll v4.3.3' }] },
    negative: { meta: [{ name: 'author', content: 'Jekyll Hyde' }] },
  },
  {
    id: 'docusaurus',
    name: 'Docusaurus',
    expected: 'high',
    positive: { domMarkers: ['#__docusaurus'] },
    negative: { domMarkers: ['#__docusaurus-root'] },
  },
  {
    id: 'vitepress',
    name: 'VitePress',
    expected: 'hint',
    positive: { domMarkers: ['#app[data-v-app]'] },
    negative: { domMarkers: ['#app'], scriptUrls: ['https://example.com/assets/app.js'] },
  },
  {
    id: 'alpine',
    name: 'Alpine.js',
    expected: 'high',
    positive: { domMarkers: ['[x-data]'] },
    negative: { domMarkers: ['[x-data-table]'] },
  },
  {
    id: 'htmx',
    name: 'htmx',
    expected: 'high',
    positive: { domMarkers: ['[hx-get]'] },
    negative: { domMarkers: ['[hx-getter]'], scriptUrls: ['https://example.com/js/htmx-notes.txt'] },
  },
  {
    id: 'jquery',
    name: 'jQuery',
    expected: 'high',
    positive: { globals: ['jQuery'] },
    negative: { globals: ['jQueryMigrate'], scriptUrls: ['https://example.com/js/myjquery.js'] },
  },
  {
    id: 'stimulus',
    name: 'Stimulus',
    expected: 'likely',
    positive: { domMarkers: ['[data-controller]', '[data-action]'] },
    negative: { domMarkers: ['[data-controller-name]'] },
  },
  {
    id: 'turbo',
    name: 'Turbo',
    expected: 'high',
    positive: { scriptUrls: ['https://cdn.example.com/@hotwired/turbo@8/dist/turbo.js'] },
    negative: { scriptUrls: ['https://example.com/js/turbocharge.js'] },
  },
  {
    id: 'webflow',
    name: 'Webflow',
    expected: 'high',
    positive: { htmlAttributes: ['data-wf-page'] },
    negative: { scriptUrls: ['https://example.com/webflow-clone.js'] },
  },
  {
    id: 'framer',
    name: 'Framer',
    expected: 'high',
    positive: { domMarkers: ['[data-framer-hydrate-v2]'] },
    negative: { domMarkers: ['[data-framer-name-extra]'] },
  },
  {
    id: 'wordpress',
    name: 'WordPress',
    expected: 'high',
    positive: { meta: [{ name: 'generator', content: 'WordPress 6.5.2' }] },
    negative: { linkUrls: ['https://example.com/wp-json/posts'] },
  },
  {
    id: 'shopify',
    name: 'Shopify',
    expected: 'high',
    positive: { globals: ['Shopify'] },
    negative: { globals: ['ShopifyAnalytics'] },
  },
  {
    id: 'wix',
    name: 'Wix',
    expected: 'high',
    positive: { domMarkers: ['#SITE_CONTAINER'] },
    negative: { scriptUrls: ['https://example.com/wix-clone.js'] },
  },
  {
    id: 'squarespace',
    name: 'Squarespace',
    expected: 'high',
    positive: { scriptUrls: ['https://static1.squarespace.com/static/site.js'] },
    negative: { scriptUrls: ['https://example.com/square-space.js'] },
  },
  {
    id: 'sanity',
    name: 'Sanity',
    expected: 'likely',
    positive: { linkUrls: ['https://cdn.sanity.io/images/a/b/c.png'], domMarkers: ['[data-sanity]'] },
    negative: { linkUrls: ['https://example.com/sanity-docs.png'] },
  },
  {
    id: 'contentful',
    name: 'Contentful',
    expected: 'likely',
    positive: {
      linkUrls: ['https://images.ctfassets.net/a/b.png'],
      scriptUrls: ['https://cdn.contentful.com/sdk.js'],
    },
    negative: { scriptUrls: ['https://example.com/content-full.js'] },
  },
  {
    id: 'tailwind',
    name: 'Tailwind',
    expected: 'high',
    positive: { scriptUrls: ['https://cdn.tailwindcss.com'] },
    negative: { domMarkers: ['[class*="text-lg"]'] },
  },
  {
    id: 'styled-components',
    name: 'styled-components',
    expected: 'high',
    positive: { domMarkers: ['style[data-styled]'] },
    negative: { domMarkers: ['style[data-styled-version]'] },
  },
  {
    id: 'emotion',
    name: 'Emotion',
    expected: 'high',
    positive: { domMarkers: ['style[data-emotion]'] },
    negative: { domMarkers: ['style[data-emotion-css]'] },
  },
  {
    id: 'bootstrap',
    name: 'Bootstrap',
    expected: 'high',
    positive: {
      stylesheetUrls: ['https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css'],
    },
    negative: { scriptUrls: ['https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js'] },
  },
  {
    id: 'bulma',
    name: 'Bulma',
    expected: 'high',
    positive: { stylesheetUrls: ['https://cdn.jsdelivr.net/npm/bulma@1.0.2/css/bulma.min.css'] },
    negative: { stylesheetUrls: ['https://example.com/css/bulmalike.css'] },
  },
  {
    id: 'foundation',
    name: 'Foundation',
    expected: 'high',
    positive: { stylesheetUrls: ['https://cdn.example.com/foundation-sites/6.8/foundation.css'] },
    negative: { stylesheetUrls: ['https://example.com/css/foundational.css'] },
  },
  {
    id: 'chakra',
    name: 'Chakra UI',
    expected: 'hint',
    positive: { domMarkers: ['[class*="chakra-"]'] },
    negative: { domMarkers: ['[class*="chakra"]'] },
  },
  {
    id: 'radix',
    name: 'Radix UI',
    expected: 'likely',
    positive: {
      domMarkers: ['[data-radix-popper-content-wrapper]', '[data-radix-scroll-area-viewport]'],
    },
    negative: { domMarkers: ['[data-radix]'] },
  },
  {
    id: 'mui',
    name: 'Material UI',
    expected: 'likely',
    positive: { domMarkers: ['[class*="MuiBox"]', '[class*="MuiButton"]'] },
    negative: { domMarkers: ['[class*="Mui"]'] },
  },
  {
    id: 'gsap',
    name: 'GSAP',
    expected: 'high',
    positive: { scriptUrls: ['https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js'] },
    negative: { scriptUrls: ['https://example.com/js/gsapper.js'] },
  },
  {
    id: 'lenis',
    name: 'Lenis',
    expected: 'high',
    positive: { globals: ['Lenis'] },
    negative: { scriptUrls: ['https://example.com/scroll.js'] },
  },
  {
    id: 'locomotive',
    name: 'Locomotive Scroll',
    expected: 'high',
    positive: { domMarkers: ['[data-scroll-container]'] },
    negative: { scriptUrls: ['https://example.com/locomotive.js'] },
  },
  {
    id: 'threejs',
    name: 'Three.js',
    expected: 'high',
    positive: { globals: ['THREE'] },
    negative: { scriptUrls: ['https://example.com/three-dots.js'] },
  },
  {
    id: 'spline',
    name: 'Spline',
    expected: 'high',
    positive: { domMarkers: ['spline-viewer'] },
    negative: { domMarkers: ['spline-view'] },
  },
  {
    id: 'rive',
    name: 'Rive',
    expected: 'high',
    positive: { scriptUrls: ['https://unpkg.com/@rive-app/canvas@2/rive.js'] },
    negative: { scriptUrls: ['https://example.com/derive.js'] },
  },
  {
    id: 'lottie',
    name: 'Lottie',
    expected: 'high',
    positive: { domMarkers: ['lottie-player'] },
    negative: { scriptUrls: ['https://example.com/lottie.js'] },
  },
  {
    id: 'scrolltrigger',
    name: 'ScrollTrigger',
    expected: 'high',
    positive: { globals: ['ScrollTrigger'] },
    negative: { globals: ['ScrollTriggerProxy'], scriptUrls: ['https://example.com/js/scroll.js'] },
  },
  {
    id: 'swiper',
    name: 'Swiper',
    expected: 'high',
    positive: { domMarkers: ['.swiper'] },
    negative: { domMarkers: ['.swiper-like'], scriptUrls: ['https://example.com/js/slider.js'] },
  },
  {
    id: 'splide',
    name: 'Splide',
    expected: 'high',
    positive: { domMarkers: ['.splide'] },
    negative: { domMarkers: ['.splide-track'] },
  },
  {
    id: 'barba',
    name: 'Barba.js',
    expected: 'high',
    positive: { domMarkers: ['[data-barba]'] },
    negative: { domMarkers: ['[data-barbara]'] },
  },
  {
    id: 'motion-one',
    name: 'Motion One',
    expected: 'high',
    positive: { scriptUrls: ['https://cdn.jsdelivr.net/npm/motion.dev/dist/motion.js'] },
    negative: { scriptUrls: ['https://example.com/js/motion.js'] },
  },
  {
    id: 'google-fonts',
    name: 'Google Fonts',
    expected: 'high',
    positive: { stylesheetUrls: ['https://fonts.googleapis.com/css2?family=Inter'] },
    negative: { linkUrls: ['https://fonts.example.com/css'] },
  },
  {
    id: 'adobe-fonts',
    name: 'Adobe Fonts',
    expected: 'high',
    positive: { linkUrls: ['https://use.typekit.net/abc1234.css'] },
    negative: { scriptUrls: ['https://example.com/typekit-helper.js'] },
  },
  {
    id: 'fontshare',
    name: 'Fontshare',
    expected: 'high',
    positive: { stylesheetUrls: ['https://api.fontshare.com/v2/css?f[]=satoshi@700'] },
    negative: { linkUrls: ['https://fontshare.example.com/css'] },
  },
  {
    id: 'vercel',
    name: 'Vercel',
    expected: 'high',
    positive: { headers: [{ name: 'x-vercel-id', value: 'bom1::abc' }] },
    negative: { headers: [{ name: 'x-vercel-id-legacy', value: 'abc' }] },
  },
  {
    id: 'vercel-analytics',
    name: 'Vercel Analytics',
    expected: 'high',
    positive: { scriptUrls: ['https://example.com/_vercel/insights/script.js'] },
    negative: { scriptUrls: ['https://example.com/_vercel/speed-insights/script.js'] },
  },
  {
    id: 'netlify',
    name: 'Netlify',
    expected: 'high',
    positive: { headers: [{ name: 'x-nf-request-id', value: '01HF' }] },
    negative: { scriptUrls: ['https://example.com/netlify.js'] },
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    expected: 'high',
    positive: { scriptUrls: ['https://example.com/cdn-cgi/scripts/5c5dd728/x.js'] },
    negative: { scriptUrls: ['https://example.com/cdn/cgi.js'] },
  },
  {
    id: 'ga4',
    name: 'Google Analytics 4',
    expected: 'high',
    positive: { scriptUrls: ['https://www.googletagmanager.com/gtag/js?id=G-ABC'] },
    negative: { scriptUrls: ['https://www.googletagmanager.com/gtag/destination?id=G-ABC'] },
  },
  {
    id: 'gtm',
    name: 'Google Tag Manager',
    expected: 'hint',
    positive: { scriptUrls: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC'] },
    negative: { scriptUrls: ['https://www.googletagmanager.com/ns.html'] },
  },
  {
    id: 'plausible',
    name: 'Plausible',
    expected: 'high',
    positive: { scriptUrls: ['https://plausible.io/js/script.js'] },
    negative: { scriptUrls: ['https://plausible.io/api/event'] },
  },
  {
    id: 'posthog',
    name: 'PostHog',
    expected: 'high',
    positive: { globals: ['posthog'] },
    negative: { globals: ['posthogjs'] },
  },
  {
    id: 'hotjar',
    name: 'Hotjar',
    expected: 'high',
    positive: { scriptUrls: ['https://static.hotjar.com/c/hotjar-123.js'] },
    negative: { globals: ['hjSiteSettings'] },
  },
  {
    id: 'youtube-embed',
    name: 'YouTube embed',
    expected: 'high',
    positive: { domMarkers: ['iframe[src*="youtube.com/embed"]'] },
    negative: { domMarkers: ['iframe[src*="youtube.com/watch"]'] },
  },
  {
    id: 'vimeo-embed',
    name: 'Vimeo embed',
    expected: 'high',
    positive: { domMarkers: ['iframe[src*="player.vimeo.com"]'] },
    negative: { domMarkers: ['iframe[src*="vimeo.com"]'] },
  },
  {
    id: 'stripe',
    name: 'Stripe.js',
    expected: 'high',
    positive: { scriptUrls: ['https://js.stripe.com/v3/'] },
    negative: { scriptUrls: ['https://example.com/js/stripe-banner.js'] },
  },
  {
    id: 'intercom',
    name: 'Intercom',
    expected: 'high',
    positive: { scriptUrls: ['https://widget.intercom.io/widget/abc123'] },
    negative: { globals: ['IntercomSettings'] },
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    expected: 'high',
    positive: { scriptUrls: ['https://js.hs-scripts.com/1234567.js'] },
    negative: { scriptUrls: ['https://example.com/js/hubspot-notes.js'] },
  },
  {
    id: 'segment',
    name: 'Segment',
    expected: 'high',
    positive: { scriptUrls: ['https://cdn.segment.com/analytics.js/v1/key/analytics.min.js'] },
    negative: { globals: ['analyticsReady'] },
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    expected: 'high',
    positive: { globals: ['mixpanel'] },
    negative: { globals: ['mixpanelReady'] },
  },
  {
    id: 'sentry',
    name: 'Sentry',
    expected: 'high',
    positive: { globals: ['Sentry'] },
    negative: { globals: ['SentryHub'], scriptUrls: ['https://example.com/js/sentry-notes.js'] },
  },
  {
    id: 'turnstile',
    name: 'Cloudflare Turnstile',
    expected: 'high',
    positive: { scriptUrls: ['https://challenges.cloudflare.com/turnstile/v0/api.js'] },
    negative: { scriptUrls: ['https://example.com/js/turnstile-docs.js'] },
  },
  {
    id: 'recaptcha',
    name: 'reCAPTCHA',
    expected: 'high',
    positive: { scriptUrls: ['https://www.google.com/recaptcha/api.js'] },
    negative: { scriptUrls: ['https://example.com/js/recaptcha-helper.js'] },
  },
];

describe('detectStack signature table', () => {
  it('covers every signature in the table with a test case', () => {
    expect(SIGNATURES).toHaveLength(73);
    expect(CASES.map((testCase) => testCase.id).sort()).toEqual(
      SIGNATURES.map((signature) => signature.id).sort(),
    );
  });

  for (const testCase of CASES) {
    it(`detects ${testCase.name} at ${testCase.expected} from direct evidence`, () => {
      const report = detectStack(emptyEvidence(testCase.positive));
      const detection = report.detections.find((entry) => entry.id === testCase.id);

      if (testCase.expected === 'hint') {
        expect(detection).toBeUndefined();
        expect(report.hints.map((hint) => hint.name)).toContain(testCase.name);
      } else {
        expect(detection?.confidence).toBe(testCase.expected);
        expect(detection?.evidence.length).toBeGreaterThan(0);
        expect(detection?.evidence[0]?.detail).not.toBe('');
      }
    });

    it(`does not detect ${testCase.name} from a near miss`, () => {
      const report = detectStack(emptyEvidence(testCase.negative));
      expect(report.detections).toEqual([]);
      expect(report.hints.map((hint) => hint.name)).not.toContain(testCase.name);
    });
  }
});

describe('detectStack confidence rules', () => {
  it('needs two weak rules for likely and reports one weak rule as a hint', () => {
    const one = detectStack(emptyEvidence({ domMarkers: ['[data-hk]'] }));
    expect(one.detections).toEqual([]);
    expect(one.hints.map((hint) => hint.name)).toEqual(['SolidJS']);

    const two = detectStack(emptyEvidence({ domMarkers: ['[data-hk]'], globals: ['_$HY'] }));
    expect(two.detections.map((entry) => entry.confidence)).toEqual(['likely']);
    expect(two.hints).toEqual([]);
  });

  it('caps a data source at likely even with several matching rules', () => {
    const report = detectStack(
      emptyEvidence({
        linkUrls: ['https://cdn.sanity.io/images/a.png'],
        scriptUrls: ['https://cdn.sanity.io/sdk.js'],
        domMarkers: ['[data-sanity]'],
      }),
    );
    expect(report.detections.find((entry) => entry.id === 'sanity')?.confidence).toBe('likely');
  });

  it('keeps Google Tag Manager a hint until the container frame is there too', () => {
    const loaderOnly = detectStack(
      emptyEvidence({ scriptUrls: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC'] }),
    );
    expect(loaderOnly.detections).toEqual([]);
    expect(loaderOnly.hints.map((hint) => hint.name)).toEqual(['Google Tag Manager']);

    const withFrame = detectStack(
      emptyEvidence({
        scriptUrls: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC'],
        domMarkers: ['noscript iframe[src*="googletagmanager.com/ns.html"]'],
      }),
    );
    expect(withFrame.detections.find((entry) => entry.id === 'gtm')?.confidence).toBe('likely');
  });

  it('never lists a detected name in hints', () => {
    const report = detectStack(
      emptyEvidence({
        inlineScriptIds: ['__NEXT_DATA__'],
        domMarkers: ['#__next', '[data-reactroot]', '[data-svelte-h]', '[data-sveltekit-preload-data]'],
        scriptUrls: ['https://www.googletagmanager.com/gtm.js?id=GTM-1'],
      }),
    );

    const names = new Set(report.detections.map((entry) => entry.name));
    for (const hint of report.hints) expect(names.has(hint.name)).toBe(false);
    expect(report.hints.map((hint) => hint.name)).toEqual(['Google Tag Manager']);
  });

  it('implies React at likely when Next.js is high', () => {
    const report = detectStack(emptyEvidence({ scriptUrls: ['https://example.com/_next/static/a.js'] }));
    const react = report.detections.find((entry) => entry.id === 'react');
    expect(react?.confidence).toBe('likely');
    expect(react?.evidence).toContainEqual({ kind: 'dom-marker', detail: 'implied by Next.js' });
  });

  it('implies React at likely when Remix is high, keeping the direct hint evidence', () => {
    const report = detectStack(
      emptyEvidence({ globals: ['__remixContext'], domMarkers: ['[data-reactroot]'] }),
    );
    const react = report.detections.find((entry) => entry.id === 'react');
    expect(react?.confidence).toBe('likely');
    expect(react?.evidence).toEqual([
      { kind: 'dom-marker', detail: '[data-reactroot]' },
      { kind: 'dom-marker', detail: 'implied by Remix' },
    ]);
  });

  it('leaves a directly detected React alone', () => {
    const report = detectStack(
      emptyEvidence({ inlineScriptIds: ['__NEXT_DATA__'], globals: ['React'] }),
    );
    expect(report.detections.find((entry) => entry.id === 'react')?.confidence).toBe('high');
  });

  it('implies Svelte at likely when SvelteKit is high', () => {
    const report = detectStack(emptyEvidence({ scriptUrls: ['https://x.dev/_app/immutable/a.js'] }));
    expect(report.detections.find((entry) => entry.id === 'svelte')?.confidence).toBe('likely');
  });

  it('returns nothing for an empty page', () => {
    const report = detectStack(emptyEvidence());
    expect(report).toEqual({
      detections: [],
      hints: [],
      scope: 'page',
      observedAt: report.observedAt,
    });
    expect(report.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('detectStack evidence and versions', () => {
  it('captures a version only when a rule reads one', () => {
    const next = detectStack(
      emptyEvidence({ meta: [{ name: 'generator', content: 'Next.js 15.2.4' }] }),
    );
    expect(next.detections.find((entry) => entry.id === 'nextjs')?.version).toBe('15.2.4');

    const wordpress = detectStack(
      emptyEvidence({ meta: [{ name: 'generator', content: 'WordPress 6.5.2' }] }),
    );
    expect(wordpress.detections.find((entry) => entry.id === 'wordpress')?.version).toBe('6.5.2');

    const astro = detectStack(emptyEvidence({ meta: [{ name: 'generator', content: 'Astro v4.16.0' }] }));
    expect(astro.detections.find((entry) => entry.id === 'astro')?.version).toBe('4.16.0');

    // The marker list cannot carry the ng-version attribute value.
    const angular = detectStack(emptyEvidence({ domMarkers: ['[ng-version]'] }));
    expect(angular.detections.find((entry) => entry.id === 'angular')?.version).toBeNull();
  });

  it('only reads a meta rule from its own meta name', () => {
    const report = detectStack(
      emptyEvidence({ meta: [{ name: 'description', content: 'Built with Next.js and WordPress' }] }),
    );
    expect(report.detections).toEqual([]);
  });

  it('shapes evidence details per channel', () => {
    const report = detectStack(
      emptyEvidence({
        inlineScriptIds: ['__NEXT_DATA__'],
        htmlAttributes: ['data-wf-page'],
        meta: [{ name: 'generator', content: 'WordPress 6.5.2' }],
        headers: [{ name: 'cf-ray', value: '8a1b2c3d4e5f' }],
      }),
    );

    const detail = (id: string) =>
      report.detections.find((entry) => entry.id === id)?.evidence[0]?.detail;
    expect(detail('nextjs')).toBe('script#__NEXT_DATA__');
    expect(detail('webflow')).toBe('html[data-wf-page]');
    expect(detail('wordpress')).toBe('meta:generator=WordPress 6.5.2');
    expect(detail('cloudflare')).toBe('cf-ray: 8a1b2c3d4e5f');
  });

  it('trims a long URL detail to 160 characters', () => {
    const url = `https://example.com/_next/static/${'a'.repeat(300)}.js`;
    const report = detectStack(emptyEvidence({ scriptUrls: [url] }));
    expect(report.detections.find((entry) => entry.id === 'nextjs')?.evidence[0]?.detail).toHaveLength(
      160,
    );
  });

  it('sorts detections by category order and then by name', () => {
    const report = detectStack(
      emptyEvidence({
        globals: ['React', 'THREE', 'Shopify'],
        scriptUrls: ['https://cdn.tailwindcss.com', 'https://static.hotjar.com/c/hotjar-1.js'],
        stylesheetUrls: ['https://fonts.googleapis.com/css2?family=Inter'],
      }),
    );

    expect(report.detections.map((entry) => entry.category)).toEqual([
      'framework',
      'builder-cms',
      'styling',
      'motion-3d',
      'font-provider',
      'infra-analytics',
    ]);
  });

  it('stamps every detection with the report timestamp', () => {
    const report = detectStack(emptyEvidence({ globals: ['React', 'Vue'] }));
    for (const detection of report.detections) {
      expect(detection.observedAt).toBe(report.observedAt);
    }
  });
});

describe('probe lists cover the signature table', () => {
  it('has a dom probe for every selector a dom-marker rule tests', () => {
    const probes = new Set(DOM_PROBES);
    for (const signature of SIGNATURES) {
      for (const rule of signature.rules) {
        if (rule.kind !== 'dom-marker' || rule.test instanceof RegExp) continue;
        expect({ id: signature.id, selector: rule.test, probed: probes.has(rule.test) }).toEqual({
          id: signature.id,
          selector: rule.test,
          probed: true,
        });
      }
    }
  });

  it('has a global probe for every name a global rule tests', () => {
    for (const signature of SIGNATURES) {
      for (const rule of signature.rules) {
        if (rule.kind !== 'global') continue;
        const matched = GLOBAL_PROBES.some((name) =>
          rule.test instanceof RegExp
            ? rule.test.test(name)
            : name.toLowerCase() === rule.test.toLowerCase(),
        );
        expect({ id: signature.id, probed: matched }).toEqual({ id: signature.id, probed: true });
      }
    }
  });

  it('probes nothing it does not use, so the lists stay auditable', () => {
    const selectors = new Set(
      SIGNATURES.flatMap((signature) =>
        signature.rules
          .filter((rule) => rule.kind === 'dom-marker' && typeof rule.test === 'string')
          .map((rule) => String(rule.test)),
      ),
    );
    // Probes exist that no rule reads yet, which is fine, but each one should be
    // a deliberate choice rather than a leftover.
    const unused = DOM_PROBES.filter((probe) => !selectors.has(probe));
    expect(unused).toEqual([
      '[data-react-helmet]',
      'link[href*="/wp-content/"]',
      'script[src*="/wp-includes/"]',
      '[data-solid]',
      'script[src*="gsap"]',
    ]);
  });
});
