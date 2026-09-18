# Firefox assessment

PRD milestone M6, Phase 3. This is an assessment, not a port. Nothing here has been
attempted beyond running the build and reading what it produced.

```bash
pnpm build:firefox     # wxt build -b firefox
```

The build **succeeds** and writes `.output/firefox-mv2/`. A build that succeeds is not an
extension that works: WXT translates the manifest, not the code. Five things would break at
runtime, and two of them are the product's spine.

## What the build actually produces

WXT targets `firefox-mv2` by default and rewrites the manifest:

| Chrome MV3 | Firefox MV2 output |
| --- | --- |
| `manifest_version: 3` | `manifest_version: 2` |
| `background.service_worker` | `background.scripts: ["background.js"]` |
| `action` | `browser_action` |
| `side_panel.default_path` | `sidebar_action.default_panel` |
| `permissions` | unchanged, including `sidePanel`, which Firefox does not know |

`browser_specific_settings.gecko` is now declared in `wxt.config.ts` with an add-on id and
`data_collection_permissions: { required: ['none'] }`, which clears both of WXT's Firefox
warnings. A hook strips that key from every non-Firefox build, so the shipped Chrome
manifest is byte-for-byte what it was; `e2e/smoke.spec.ts` asserts the Chrome manifest's
permissions and the absence of host permissions on every run.

## What breaks

### 1. `sidePanel` is Chrome-only. Severity: high.

WXT maps the manifest key to `sidebar_action`, but the **code** calls `chrome.sidePanel`
directly in three places:

- `lib/background/router.ts`: `chrome.sidePanel.open({ tabId })`
- `lib/background/register.ts`: `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })`
- `lib/ui/popup/PopupApp.tsx`: `chrome.sidePanel.open({ tabId })`

Firefox has `browser.sidebarAction`, whose model is different in a way that matters: a
sidebar is per-window, not per-tab. `sidebarAction.open()` exists and requires a user
gesture, but there is no `{ tabId }` and no per-tab panel content. The panel's whole design
assumes "the active tab of this window", which it already computes in `useActiveTab`, so
this is survivable, but every `sidePanel` call needs a branch and the popup's
"Open side panel" button needs the gesture to survive the async hop. Also drop `sidePanel`
from `permissions` on the Gecko build; Firefox warns about the unknown permission.

### 2. `chrome.scripting` with `world: 'MAIN'`. Severity: high.

`lib/background/research.ts` probes for page globals (`__NEXT_DATA__`, `React`, `Vue`, and
so on) with `chrome.scripting.executeScript({ world: 'MAIN' })`. That is the evidence behind
a large part of the Stack tab.

Firefox MV2 has no `browser.scripting` at all: it has `browser.tabs.executeScript`, and it
has **no main-world execution**. Content scripts run in an isolated compartment, and the
documented escape hatch is `window.wrappedJSObject` from a content script, which is a
different mechanism with different privileges and different failure modes. `scripting` does
exist in Firefox MV3, but `world: 'MAIN'` support landed late and is not something to rely
on across supported versions.

The code already treats an empty globals list as "not probed" rather than "not present",
so a Firefox build would degrade honestly rather than lie. It would simply detect less.

Note that injection itself also changes: `ensureContentScript` uses
`chrome.scripting.executeScript({ files })`, which becomes `tabs.executeScript({ file })`
under MV2.

### 3. `EyeDropper`. Severity: medium, already handled.

`lib/inspector/eyedropper.ts` feature-detects with `hasEyeDropper()` and the overlay hides
the Pick color control when the constructor is absent. Firefox has not shipped the
`EyeDropper` API, so the feature would simply not appear. No code change needed, and no
fallback should be invented: a screen-reading fallback would need a capture permission the
product does not ask for.

### 4. `chrome.downloads` with blob URLs. Severity: medium.

`lib/ui/sidepanel/exports.ts` creates an object URL in the side panel page and hands it to
`chrome.downloads.download`, then revokes it when `downloads.onChanged` reports a final
state, with a 60s timer as the backstop.

Firefox supports `browser.downloads.download` with blob URLs created by the extension, and
in fact this is the Firefox-recommended pattern, which Chrome's MV3 service worker made
awkward. The sharp edge is the reverse of Chrome's: Firefox revokes more eagerly in some
paths, and `downloads.onChanged` delta shapes differ slightly. The asset ZIP and the
reference bundle both go through this path, so both need a real download test on Firefox
before any claim is made. Data URLs, used for JSON and inline SVG downloads, are rejected
by `browser.downloads.download` in Firefox and would have to become blobs.

### 5. `OffscreenCanvas` in the worker. Severity: medium.

`lib/background/screenshot.ts` crops the captured tab image with
`createImageBitmap` plus `new OffscreenCanvas(...)` and `canvas.convertToBlob()`. This runs
in the service worker, where there is no DOM.

Firefox supports `OffscreenCanvas` and `convertToBlob` in workers. The MV2 background page,
however, is a real DOM page, so a Firefox build could use an ordinary `<canvas>` and would
not need the offscreen path at all. The greater risk is upstream:
`chrome.tabs.captureVisibleTab` exists in Firefox but returns a data URL with its own
sizing behaviour on HiDPI displays, and `computeCrop` is written against Chrome's
`devicePixelRatio` convention. Saved-reference screenshots would need re-verification, not
re-architecture.

## Recommended approach

Do not port now. The two high-severity items are not polish: without a per-tab side panel
and without main-world probing, a Firefox build would be a different, smaller product, and
shipping it as the same product would misrepresent it.

When it is worth doing, in this order:

1. **Target Firefox MV3, not MV2.** `wxt build -b firefox --mv3`. MV2 is on its way out and
   porting to it buys a second migration.
2. **Put every browser-specific call behind a small adapter.** One module that exposes
   `openPanel(tabId)`, `injectContentScript(tabId)`, `probeGlobals(tabId)`,
   `download(blobOrUrl, filename)` and `cropImage(...)`, with a Chrome and a Gecko
   implementation. Today those calls are spread across five files in `lib/background` and
   `lib/ui`, which is exactly the shape that makes a port feel impossible.
3. **Accept a reduced Stack tab on Firefox** and say so in the UI, using the existing
   "not probed" wording rather than inventing a new caveat.
4. **Re-run the whole e2e suite against Firefox**, including `e2e/a11y.spec.ts` and
   `e2e/perf.spec.ts`. Playwright drives Firefox, but extension loading differs and the
   helper in `e2e/helpers/extension.ts` is Chromium-specific.
5. **Re-verify downloads and screenshots by hand.** Both are the kind of thing that passes a
   unit test and fails a user.

Until all of that is done, the README, the store listing and the privacy page should keep
saying Chrome.
