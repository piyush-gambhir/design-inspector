# QA evidence: failure states, accessibility, performance

Release evidence for `docs/PRD.md` sections 19.1, 19.2 and 19.3, for gate 10 of section 20.3,
and for the download-filename question raised by the second live pass. Recorded for version
0.1.0 on 18 September 2026.

Numbers here are measurements on one machine, not promises. The assertions in
`e2e/perf.spec.ts` and `e2e/a11y.spec.ts` are the contract; these are what they read on the
reference machine below.

**Reference machine:** Apple Silicon Mac, macOS 25.6, Playwright-managed Chromium in
headless mode, `DI_E2E=1` build, single worker, no other load.

---

## 1. Failure states (PRD 19.3)

Every state below shows a short reason and a next action. The next action is a control the
user can press, or a sentence naming the one thing that will change the outcome. Unaffected
work is always preserved: no failure empties the panel.

| State | Where it surfaces | Message | Next action |
| --- | --- | --- | --- |
| Unsupported page | Popup header, side panel header | "Chrome does not allow extensions on browser pages. Open a normal web page." and the sibling messages for extension pages, DevTools, `about:`, view-source, the Web Store, `file://` and PDFs | **Copy page URL** in the popup, so the address can be opened somewhere the inspector works. Inspect and Layout outlines are disabled rather than failing on press. |
| Denied access | Popup and side panel status line, after a toggle | "Chrome has not granted access to this tab yet. Click the Design Inspector toolbar icon or press the shortcut on this tab, then try again." | **Retry** beside the message. activeTab is granted by that click, so a retry after it succeeds. |
| Removed element | Summary group's example controls | "That element is no longer on the page. Refresh the summary, or pick another example." | **Refresh** at the top of the Summary tab; the other examples in the group still work. |
| Element offscreen | Summary group's example controls | "Scroll to the element on the page and try again." | **Scroll to it and select**, which is the only thing that moves the page, and only because it was pressed. |
| Unavailable font source | Summary, Fonts section | Source reads "Unknown source", plus "No download source was found for this family. Copy the family name and look it up, or read the declared faces below for the URLs the page did use." | **Declared faces** disclosure lists the URLs the page actually requested. No download button is offered for a source that does not exist. |
| Inaccessible asset | Assets tab, per row | Thumbnail falls back to a placeholder; the row keeps every measured field and lists its own limitations; a failed download says "The download did not start. Copy the URL and open it directly." | **Copy URL** on the row. Other rows are unaffected. |
| Partial summary | Summary, Scope section | "Partial summary: the scan stopped at 5000 elements. Raise the scan cap in the toolbar popup and refresh, or read this as a sample of the page." plus the scope note "The scan stopped at the cap of 5000 elements." | **Scan cap** in the popup (500 to 20,000), then **Refresh**. The partial summary stays readable and is labelled as partial. |
| No stack evidence | Stack tab, Summary's Stack section | "No confident evidence found. This does not prove a technology is absent. Let the page finish loading and refresh the report, or read the weak hints below and judge them yourself." | **Refresh stack report**, or open **Weak hints**, which are shown as hints and never as detections. |
| Storage full | Saved tab, after an edit, a save, or a delete | "Local storage is full. Delete some saved references or clear the collection, then try again." | **Delete** on a card, or **Clear all**. Exports are still available first, so the research can leave before it is deleted. Covered by a unit test: `__tests__/ui-saved.test.tsx`, "surfaces a storage quota failure on an inline edit with the way out". |
| Failed download | Assets row, Summary font row, Saved tab export | The reason from `chrome.downloads`, or "The download did not start. Copy the URL and open it directly." | **Copy URL** for a single asset; for an export, the Copy Markdown and Copy taste ledger paths do not touch downloads at all. |
| Interrupted export | Assets tab, after Cancel | "...cancelled. No archive was written. Select fewer assets and run it again." | **Download selected as ZIP** with a smaller selection. A completed archive that skipped some assets instead reports "N skipped; manifest.json lists every reason", so a partial success is still a delivered file. |
| Stale page data | Side panel header and Summary tab | "Page changed. Refresh for a current reading." | **Refresh** beside the message. A same-document route change marks the readings stale and keeps them; a new document drops them, because they would be readings of a different page. |
| Font file unreadable | Pinned panel typography rows, Summary Fonts card | The host's own answer as a sentence: "The font host refused the request (403).", "The font file is no longer at that URL (404).", "Not a font file.", "That font file is larger than 20 MB, so it was not read.", "The font host did not answer in time." | **Identify font file** stays enabled and can be pressed again. Every row that did not depend on the file (family alias, weight, size, colour, contrast) is untouched, so a refusal costs nothing that was already read. |

### The one opt-in network path (PRD 17.1)

"Identify font file" on a pinned element, and "Identify" on a Summary font card, are the
only controls in the product that fetch a resource the user did not already ask for by
inspecting the page. What that press does, exactly:

- One `fetch` of one font file, from the host the page itself served it from, with
  `credentials: 'omit'` and a 10 second timeout. No other URL is contacted, and no other
  file of that family is fetched.
- The file is parsed in the service worker (`lib/background/font-identity.ts`), capped at
  20 MB, and only the `name` and `fvar` tables are read. The bytes are discarded; the parsed
  identity is what is kept.
- The identity is cached per URL for the worker's lifetime and mirrored (last 50) into
  `chrome.storage.session`, so a second press, another element in the same family, or a
  restarted worker costs no further request.
- The button's own tooltip says "Contacts the font host" before it is pressed, the Fonts
  section repeats it in its subtitle, and `PRIVACY.md` lists it in the table of what leaves
  the device.
- The side panel fetches the same file a second time to build its specimen, from the
  browser cache, because extension messages are JSON and a font cannot travel through them
  without being base64'd twice.

Nothing is fetched on hover, on pin, during a scan, or in the background.

### Notes on two of these

**Storage full** is the only state where the user can lose work, so it names both ways out
and the exports stay reachable while the message is on screen.

**Interrupted export** does not leave a partial archive on purpose. The ZIP is assembled in
memory and handed to `chrome.downloads` only when it is complete, so there is no half-file
to find. The message says so rather than letting the user look for one.

---

## 2. Accessibility (PRD 19.2)

Audited by `e2e/a11y.spec.ts`, which is written in-repo rather than using axe: the extension
ships no dependency it does not need, and a test-only one would still have to be installed
in CI.

| Check | Result |
| --- | --- |
| Every visible button, link and tab has an accessible name | 0 findings across Summary, Assets, Saved, Tools and the popup |
| Every `img` has an `alt` attribute | 0 findings |
| Every visible input, select and textarea has a label | 0 findings |
| Every `role="tab"` has `aria-selected` and `aria-controls` | 0 findings |
| No visible text below 12px | 0 findings (the 11px badges and role labels were raised to 12px for this release) |
| Tab list is one tab stop with roving tabindex | Pass; ArrowLeft, ArrowRight, Home and End all move the selection |
| Tab order reaches the primary actions in order | Pass: activation, then the tab list, then Refresh, Save summary, Copy Markdown, Download JSON |
| `prefers-reduced-motion: reduce` | Pass: no element reports a non-zero transition or animation duration |

### Focus indicator contrast

The indicator is a single 2px `outline` declared once in `assets/ui.css`, measured live
through `getComputedStyle` and composited against the real ancestor backgrounds.

| Scheme | Focus stops walked | Worst measured contrast | Minimum required |
| --- | --- | --- | --- |
| Light | 16 | **4.25:1** on the Summary tab (`bg-secondary/60` over `--surface`) | 3:1 (WCAG 1.4.11) |
| Dark | 16 | **9.00:1** on the Summary tab | 3:1 |

This is the one accessibility defect the release pass found and fixed. The previous
indicator was a Tailwind ring at 50% alpha in the accent colour, which measured **1.49:1 to
1.56:1** in light mode. The ring is now its own `--ring` token, fully opaque, tuned per
scheme: `oklch(0.55 0.19 255)` light and `oklch(0.8 0.14 255)` dark.

Known and accepted: the controls carry `transition-colors`, and `outline-color` is one of
the properties it animates, so the ring fades in over the default 150ms. Under
`prefers-reduced-motion: reduce` it appears instantly. The audit measures the settled
colour, which is the one a reader sees.

---

## 3. Performance (PRD 19.1, gate 20.3 item 10)

Two suites. `e2e/perf.spec.ts` holds the original activation, hover and scan budgets against
`e2e/fixtures/large.html`: 6,001 elements in 500 cards, every asset a data URL, nothing
animating. `e2e/perf-profile.spec.ts` is the newer, wider profile, and the full generated
tables live in [store/PERF.md](PERF.md), rewritten by `pnpm perf`.

| Measurement | Budget | Measured |
| --- | --- | --- |
| Activation to usable overlay (`inspector.toggle` round trip, including injection) | under 300ms | **14ms to 17ms** across runs |
| Long tasks during 20 hovers, inspector off (control) | n/a | **0** |
| Long tasks during 20 hovers, inspector live | at most 2 more than the control | **0** (delta 0) |
| Longest single task while inspecting | 100ms | **0ms**, no long task was recorded at all |
| Initial summary (`summary.request` round trip) | under 3s | **434ms to 461ms** across runs |
| Scan work reported by the scan itself (`scope.durationMs`) | n/a | **408ms to 425ms** |
| Elements scanned | capped at the 5,000 default | **5,000 of 6,001**, `scope.capped` true |
| Progress events observed during the scan | more than 0 | **52** |

Long tasks are not attributable to an origin, which is why the same 20 pointer moves run
first with the inspector off. The assertion is on the delta, not on an absolute count the
page could blow on its own.

Cancellation is covered separately: a scan cancelled mid-run returns a well-formed response,
the overlay comes off the page cleanly, and the page still answers afterwards.

### 3a. The lightweight profile (workstream PERF)

The user's requirement was "make sure this is super light weight and consume minimal
hardware resources, and do not throttle the website". `e2e/perf-profile.spec.ts` turns that
into nine fixed 10-second windows per target, measured with CDP `Performance.getMetrics`,
a long-task `PerformanceObserver`, a forced `HeapProfiler.collectGarbage` at both ends of
every window, and wrapped scheduling globals inside the extension's own isolated world.
Three targets: the 6,001 element fixture, `en.wikipedia.org/wiki/Typography`, and
`github.com`.

Script time is quoted as a percentage of the window, over and above window A, which is the
same page with the extension never activated.

| Window | Budget | Before | After |
| --- | --- | --- | --- |
| A. Idle, never activated | baseline | 0.00%, 0 long tasks | 0.00%, 0 long tasks |
| B. Inspector active, pointer still | under 1% | **0.00%** | **0.00%** |
| C. Element pinned, pointer still | under 1% | **0.00%** | **0.00%** |
| D. Continuous hover, 60 moves a second (fixture) | under 8% | **7.91%** * | **2.73%** |
| D. Continuous hover, 60 moves a second (Wikipedia) | under 8% | **11.89%** *, over budget | **2.26%** |
| D. Continuous hover, 60 moves a second (github.com) | under 8% | **5.26%** * | **2.55%** |
| E. Layout outlines on, pointer still | under 1% | **0.00%** | **0.00%** |
| F. Rulers on, scrolling 60 steps a second (fixture) | under 5% | **1.48%** | **0.55%** |
| F. Same, Wikipedia and github.com | under 5% | **1.70%** and **1.21%** | **0.75%** and **0.53%** |
| F. Ruler tick nodes rebuilt while scrolling | transform only, under 100 | **70,426 nodes**, over budget | **0 nodes** |
| G. Mockup on and unlocked, pointer still | under 1% | **0.00%** | **0.00%** |
| H. Side panel open with a completed summary | under 1% | **0.00%** | **0.00%** |
| I. After `setMode off` | same as A | **0.00%**, host, mockup host and outline sheet all absent | unchanged |
| Live extension timers or intervals, every window | 0 | **0** | **0** |
| Animation frames registered while idle | 0 | **0** | **0** |
| Long tasks, every window on every target | 0 | **0** | **0** |
| Heap delta, idle windows | under 5 MB | **at most 0.03 MB** | **at most 0.03 MB** |
| Scan of 6,001 elements: longest task | none over 50ms | **0ms** | **0ms** |
| Scan of 6,001 elements: total | under 1.5s | **444ms** | **437ms** |
| Scan: heap after the summary vs before | within 5 MB | **+0.04 MB** | **+0.03 MB** |
| Production `content-scripts/inspector.js` | under 200 kB | **186.7 kB**, gzip 59.6 kB | **190.1 kB**, gzip 60.9 kB |

The percentages for B, C, E, G, H and I are on the fixture and on Wikipedia, where the
page's own script time in window A is zero. On `github.com` the page never stops working, so
those windows measure less script time with the inspector on than window A did: the deltas
are negative, which the budget check reads as under budget.

\* The first run of the profile did not actually drive the pointer in window D, so the
"before" column for D is the first run in which it did. That run already carried the ruler
fix, the unchanged-element skip and the read-before-write reorder, none of which touch what
the remaining hover fixes address. The true starting point for D is therefore no better than
the figures shown, and the Wikipedia figure was over budget either way.

Two budgets were broken and both are now met.

**Rulers redrew every tick on every scroll frame.** The strips were cleared and rebuilt from
`window.scrollX` on each animation frame, which on a 1280x800 viewport is 233 new nodes per
frame: 70,426 nodes over a ten second scroll, plus the style and layout work to place them.
The strips are now built once per viewport size from document offset zero and translated
with `transform`; the labels are rewritten only when the strip has slid a whole 100px step.
Ruler tick nodes created during a ten second scroll: zero.

**Continuous hover cost 2ms a frame on Wikipedia.** Four things were paying for readings
nobody looked at: the ancestor chain was built for every hover snapshot although only the
pinned panel's breadcrumb reads it, and it costs a `getBoundingClientRect` per ancestor; the
box model was measured a second time by the overlay after the snapshot had already measured
it; `elementsFromPoint` built the whole stack under the pointer when the top of it is almost
always the answer; and the page's source context, including a `getComputedStyle` on the root
element, was re-read sixty times a second. The hover path also rendered the card before
measuring the element, which forced a second synchronous layout per frame. With those fixed,
Wikipedia went from 11.89% to 2.26%.

### What the profile could not prove

`PerformanceObserver` long tasks and CDP `Performance.getMetrics` are per renderer, not per
world, so the extension's share is always a difference against window A rather than a direct
attribution. On `github.com` the page never stops working, and its window A happened to be
busier than the windows that followed, so the idle deltas there come out negative, between
-0.26% and -0.40%. That is page-side noise larger than anything the extension adds, not a
measurement of a negative cost, and the budget check reads it as under budget.

The side panel runs in its own renderer and never appears in the page's counters, so it is
measured separately: 973 elements on the fixture, 2,912 on Wikipedia, 3,293 on github.com,
with the summary rendered. Lists over 200 rows are now windowed with a "Show more" button,
and the summary view and the typography grouping are memoised on the summary's identity.
The candidate fix of collapsing summary sections beyond the first two was not made: window H
measures zero added script time on the inspected page, the panel's own node count is in the
low thousands, and hiding the product's main output by default is a cost the measurements do
not justify.

---

## 4. Download filenames (tester UX note 5)

**The finding: the extension was never at fault, and no code changed.** The tester reported
that the asset ZIP and the reference bundle arrive as UUIDs rather than as
`design-inspector-assets-<date>.zip` and `design-inspector-bundle-<date>.zip`. Both archives
travel as blob URLs, which made the report plausible: a blob URL's path is a UUID, so a
download that falls back to the URL for its name gets one.

Re-run in a real headed Chromium, both archives land with exactly the names the panel
announces:

```
chrome.downloads.search:
  design-inspector-bundle-2026-09-18.zip   state complete   mime application/zip
  design-inspector-assets-2026-09-18.zip   state complete   mime application/zip
files on disk, first two bytes of each: 50 4b
```

The UUIDs the tester saw are an artifact of the test harness, not of Chrome. Playwright always
sends `Browser.setDownloadBehavior` for a context it owns. `acceptDownloads: true` uses
`allowAndName`, which writes every download under a GUID and carries the real name only on
`download.suggestedFilename()`; `acceptDownloads: false` uses `deny`, which interrupts every
download with `USER_CANCELED`; and overriding it over CDP with `behavior: 'allow'` still
bypasses Chrome's own download target determination, which is the step where an extension's
`filename` is applied. There is no Playwright mode that leaves the naming alone, so the
verification was done by driving a headed Chromium over raw CDP with the download behaviour
never touched.

Four paths were isolated in the same browser to be sure which part does the naming:

| Download | Lands as |
| --- | --- |
| blob URL, `filename` and `conflictAction: 'uniquify'` (what ships) | `probe-blob-uniquify.zip` |
| blob URL, no `filename` | `7ab30f13-e1b7-4bed-887d-d67888f74387.zip` |
| data URL with `filename` | `probe-data.zip` |
| `<a download>` click inside the panel | `probe-anchor.zip` |

So `chrome.downloads.download` honours `filename` for a blob URL, and the UUID shape appears
only when no filename is passed. `lib/ui/sidepanel/exports.ts` already passes both `filename`
(through `sanitizeFilename`) and `conflictAction: 'uniquify'`, and it is the panel, not the
background worker, that starts these two downloads, because a blob URL only resolves in the
context that created it. Nothing was changed for this note.

Consequence for the test suite: `e2e/assets.spec.ts` cannot assert the name on disk, and does
not try to. It asserts the bytes are a ZIP and that the panel reports the name it asked for,
with a comment saying why. That remains the right assertion under Playwright.

Reproduce with the harness in the workstream scratchpad (`z4-flow.mjs`, headed, raw CDP), not
with `pnpm test:e2e`.

---

## 5. How to reproduce

```bash
pnpm check
DI_E2E=1 pnpm exec wxt build && pnpm exec playwright test
pnpm perf          # the nine-window profile on three targets, rewrites store/PERF.md
```

The `[a11y]` and `[perf]` lines in the Playwright output are the numbers in the tables
above. Re-run and update this file whenever the UI or the scan changes. `store/PERF.md` is
generated, not hand-edited: re-run `pnpm perf` instead.
