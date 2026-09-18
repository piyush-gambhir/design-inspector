# Design Inspector

Hover over anything on a website and read its design. A Chrome extension for studying
how sites are built: typography, colors, spacing, layout, assets, and stack, plus a page
summary, a local reference collection, and exports for your own notes.

Product requirements: [docs/PRD.md](docs/PRD.md). Competitor research and roadmap
reasoning: [docs/COMPETITIVE_FEATURES.md](docs/COMPETITIVE_FEATURES.md). Data contracts:
[lib/contracts.ts](lib/contracts.ts). Message protocol: [lib/messages.ts](lib/messages.ts).

## Features

**On the page (toolbar icon or Alt+Shift+I)**

- Hover to read the element under the cursor; click to pin it. Clicks never reach the page
  while inspecting. Escape releases one thing at a time: an open save form, an edge lock, a
  measurement lock, the pin, then it exits. The badge says which one is next.
  "Interact with page" pauses interception.
- Box model with edge labels. Breadcrumb of ancestors, ArrowUp and ArrowDown to walk them.
  Clicking a heading's inner span selects the heading, and clicking a heading inside a link
  the size of a tile selects the heading with the link kept as its parent (toggle in the
  badge, or the "Prefer semantic parents" switch in the popup).
- Typography: the typeface's real name, not the site's CSS alias. Press "Identify font
  file" and the served woff2 is read for what its own `name` table says: family, style,
  designer, foundry, version and licence, plus the `fvar` axes of a variable font. A site
  calling a font "Nb international pro webfont" reads as NB International Pro Regular by
  Neubau Berlin, with the alias kept beside it as what it is.
- Confidence that means something: declared (it is first in the CSS stack), matched (a
  loaded face covers this family and weight), verified (a canvas measurement showed the
  family paints text at a different width than the fallbacks it would drop to). Only the
  measurement earns "verified", and it is taken on the pinned element, never on hover.
- The font source as one line, "Self-hosted on cdn.example.com, woff2, 48 KB", with
  Download, Copy URL, and a link to the provider's specimen page. The hashed CDN URL is
  behind the button, not printed across seven lines of panel.
- The rest of the typography reading: weight, size in px and rem, line height and ratio,
  tracking, color in hex, rgb, and oklch, contrast with an honest "unavailable" over
  images, gradients, and video.
- Surfaces and layout: backgrounds, borders, radii, shadows, filters, flex and grid values,
  position, insets. Grid and flex overlays drawn on the pinned element.
- Copy any value, or a category as computed CSS, faithful Tailwind, or closest-standard
  Tailwind v4 utilities with the deviations listed.
- Assets: images (with srcset candidates), inline SVG exported as a standalone file, CSS
  backgrounds, and directly addressable video. Download from the panel.
- Layout outlines (Pesticide-style) by tag or nesting depth, Alt+O.
- Eyedropper using the browser's native picker, with contrast against the picked pixel.
- Measurement: hold Alt over a second element for edge distances; hold Shift for distances
  from the pointer to the nearest element edges; Alt+click or Shift+click locks. The edge
  reading is geometric, not visual: it walks outward until the topmost element changes and
  also takes the boxes of every element the pointer is inside, then reports the nearest of
  the two, so a wrapper's box edge is not missed. A direction with nothing found in range
  reads as "more than", never as a measurement.
- Rulers with droppable guides. Remove a guide by pressing it twice, by its "x" control, or
  with Delete while it is focused. A pixel-perfect mockup overlay with opacity, offset,
  scale, difference blend, and drag.
- The badge follows the viewport: below 480px it collapses to its dot and expands again when
  there is room, until you press the control yourself.
- Save a pinned element as a reference with a note and a cropped screenshot.

**Side panel**

- Summary: type scale with combinations grouped under each step, palette clustered by
  perceptual distance with role filters, spacing rhythm, radii, shadows, fonts, scan scope,
  text filter, "Show on page" for every group, cancel during long scans. Each font card
  identifies its file on request and then renders a specimen in the real face, one line per
  loaded weight, set in the page's own largest heading text. A "Jump to" row at
  the top skips to any section, so the keyboard does not have to walk hundreds of swatches.
- Assets: every discoverable asset with filters, selection, and ZIP download with a
  manifest of skipped items. File details are fetched only when you ask.
- Stack: 73 signatures across framework, builder, styling, motion, font provider, and
  analytics, each detection with its evidence and confidence. "Not detected" never claims
  absence.
- Saved: your references grouped by site with editable titles and notes, compare two saved
  summaries side by side (the same site at two widths reads as a responsive diff), export
  as Markdown, JSON, a taste-ledger fragment, or a ZIP bundle with screenshots.
- Tools: the mockup overlay controls.

## Develop

Requires Node 22.13+ and the pnpm version in package.json.

```bash
pnpm install
pnpm dev          # development build with reload
pnpm check        # unit tests, typecheck, production build
pnpm test:e2e     # Playwright fixture, accessibility and performance tests
                  # (pnpm exec playwright install chromium first)
pnpm perf         # full performance profile, writes store/PERF.md
pnpm zip          # store-ready archive
```

Load `.output/chrome-mv3/` through Load unpacked at `chrome://extensions`.
Press Alt+Shift+I or click the toolbar icon on a page to start inspecting.

`.github/workflows/check.yml` runs `pnpm check` and `pnpm test:e2e` on every pull request
and on `main`.

## Release

```bash
pnpm screenshots                                  # regenerate store/screenshots/ at 1280x800
pnpm release --patch --notes "What changed"       # bump, changelog, pnpm check, pnpm zip
pnpm release --minor --notes "..." --dry-run      # print the plan, change nothing
```

`scripts/release.mjs` performs no git operations: it bumps `package.json`, writes the
`CHANGELOG.md` section from `--notes`, runs the gate and builds the ZIP, and restores both
files if the gate fails. Committing and tagging stay a deliberate act.

Submission copy, permission justifications and the submit checklist live in
[store/LISTING.md](store/LISTING.md). Release evidence for failure states, accessibility and
performance is in [store/QA.md](store/QA.md). The Firefox position is in
[store/FIREFOX.md](store/FIREFOX.md): the build runs, the port has not been attempted.

## Performance

The requirement is that the extension is light and does not throttle the site it is
pointed at. That is treated as a budget with evidence, not a claim:
[store/PERF.md](store/PERF.md) is generated by `pnpm perf` and holds the current numbers.

### What runs when

| State | What is alive in the page |
| --- | --- |
| Extension installed, never activated on this tab | Nothing. There are no `content_scripts` in the manifest; the inspector is injected with `chrome.scripting.executeScript` only when you activate it. The service worker listens for `chrome.tabs.onUpdated` and returns immediately unless `changeInfo.url` is set. No alarms, no per-tab timers. |
| Inspector active, pointer still | Event listeners only. No timer, no interval, no animation frame loop. A still pointer produces no work at all. |
| Element pinned | One `ResizeObserver` on the element and one `MutationObserver` on it and up to twelve ancestors, filtered to `class` and `style`, debounced at 150ms. Both disconnect on unpin, on off, and while the document is hidden. Nothing pinned means no observers exist. |
| Pointer moving | One animation frame per move, and the frame stops early when the element under the pointer has not changed. Hover readings are shallow; the deep reading happens on pin. Every measurement is taken before the first style write, so the hover path forces one layout, not two. |
| Scrolling and resizing | Passive listeners that set a flag and schedule one frame. Rulers translate a pre-built tick strip by `transform`; the labels are rewritten only when the strip has slid a whole 100px step. The grid and flex overlay is translated rather than recomputed while the pinned box keeps its size. |
| Layout outlines on | One injected stylesheet of type and depth selectors, removed the moment outlines go off or the page hides. Outlines use `outline`, never `border`, so turning them on moves nothing. |
| Mockup on | One `<img>` in its own shadow host, `pointer-events: none`, positioned with two style writes per scroll. `will-change: transform` is present only while the image is being dragged. |
| Scanning | Chunks run in `requestIdleCallback` with a 250ms timeout, at most 200 elements per callback, and yield as soon as the browser wants the thread back. A hidden document falls back to a macrotask. The per-element records and the element list are released as soon as the summary is aggregated. |
| Inspector switched off | Nothing. The overlay host, the mockup host, the outline stylesheet, every listener and every observer are gone, and the profiler asserts it. |

### The budgets

| Window | Budget |
| --- | --- |
| Idle: inspector on, pinned, outlines on, mockup on, side panel open | Added script time under 1 percent, zero long tasks, zero live timers or animation frames, heap delta under 5 MB |
| Continuous hover at 60 moves a second | Added script time under 8 percent, no task over 50ms, added layout time under 2 percent |
| Scrolling at 60 steps a second with rulers on | Added script time under 5 percent, zero long tasks, rulers move by transform only |
| Scan of a 6,001 element page | No task over 50ms, under 1.5s in total, heap back within 5 MB afterwards |
| Teardown | Identical to a page that was never activated, and every node, listener and observer gone |
| Bundle | Production `content-scripts/inspector.js` under 205 KiB, gzip size reported. Raised from 200 KiB when font identity and the verified-rendering check landed; the execution budgets above did not move. |

### Re-measuring

```bash
pnpm perf                          # builds both outputs, profiles three targets, writes store/PERF.md
pnpm perf --fixture-only           # local fixture only, no network
pnpm perf --skip-build --window 4000
```

`pnpm perf` runs `e2e/perf-profile.spec.ts` through `scripts/perf-profile.mjs`. The engine
is `e2e/helpers/perf-profile.ts`: nine fixed windows per target, CDP `Performance.getMetrics`
for script, style and layout time, a `PerformanceObserver` for long tasks, a forced
`HeapProfiler.collectGarbage` on both ends of every window, and wrapped scheduling globals
in the extension's own isolated world so a stray timer cannot hide there. The same spec runs
under `pnpm test:e2e` against the local fixture, where the budgets are assertions and a
regression fails the build.

## Layout

| Location | Responsibility |
| --- | --- |
| `entrypoints/` | Thin WXT shells: background, popup, side panel, runtime content script |
| `lib/contracts.ts` | Versioned data contracts (snapshots, summary, saved references, exports) |
| `lib/messages.ts` | Typed message protocol |
| `lib/inspector/` | Content-script inspector: selection, overlay, readings, scanning |
| `lib/readings/` | Pure reading logic: color, contrast, units, fonts, Tailwind, stack signatures |
| `lib/exports/` | CSS, Tailwind, JSON, Markdown, taste-ledger adapters |
| `lib/storage/` | Settings and saved references (IndexedDB) |
| `lib/background/` | Service worker handlers |
| `lib/ui/` | React popup and side panel |
| `__tests__/` | Vitest unit and DOM tests |
| `e2e/` | Playwright tests against local fixtures, plus the accessibility and performance suites |
| `scripts/` | Release packaging and store screenshot generation |
| `store/` | Listing copy, QA evidence, Firefox assessment, screenshots |

## Privacy

Page analysis and saved references stay on your device. Fetching asset details,
identifying a font file, or downloading an asset contacts that resource's host. There is no
analysis server and no telemetry.

The Assets tab lists what the page rendered without touching the network. File size
and MIME type are only knowable from a request, so they are fetched when you press
Fetch file details, and never before.

"Identify font file" is the same bargain for fonts: a typeface's real name lives inside the
file, so pressing the button fetches that one file from the host the page already loaded it
from, reads its `name` and `fvar` tables, and keeps only the parsed identity. Nothing is
fetched on hover, on pin, or on a scan.

Full policy, including what is stored locally and how to delete it: [PRIVACY.md](PRIVACY.md).
