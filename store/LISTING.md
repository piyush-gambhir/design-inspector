# Chrome Web Store listing: Design Inspector

Maintained copy for the next submission. This file is the source, not a record of what the
dashboard currently holds. Check it against the built manifest and the published privacy
page before you edit the dashboard.

- **Name:** Design Inspector
- **Category:** Developer Tools
- **Language:** English (United States)
- **Intended visibility:** Unlisted for the first release
- **Privacy policy URL:** host [PRIVACY.md](../PRIVACY.md) and paste the link
- **Package:** `.output/design-inspector-<version>-chrome.zip` from `pnpm zip`

## Summary (132 character maximum)

```text
Hover any element to read its type, colour, spacing and assets. Page summaries, stack detection and saved references, all local.
```

128 characters. Recount before changing it; the dashboard truncates silently.

## Single purpose

Design Inspector has one purpose: reading the design of a web page you are looking at, and
keeping notes about it. Everything in the extension serves that: the on-page inspector
reads the element under the cursor, the side panel summarises the whole page, and the saved
collection keeps what you chose to keep. It does not modify pages, block content, manage
tabs, or do anything unrelated to reading and recording design.

## Description

```text
Design Inspector answers "how is this built?" without opening DevTools.

Hover anything on a page and read it: the family with declared or matched
confidence and where it is served from, size in px and rem, line height
and its ratio, tracking, colour in hex, rgb and oklch, and contrast with
an honest "unavailable" over images, gradients and video. Click to pin,
then walk the ancestors with the arrow keys.

• Box model with edge labels, grid and flex overlays, and Pesticide-style
  layout outlines by tag or by nesting depth.
• Copy any value, or a whole category as computed CSS, faithful Tailwind,
  or closest-standard Tailwind v4 with the deviations listed.
• Assets: images with their srcset candidates, inline SVG exported as a
  standalone file, CSS backgrounds and directly addressable video.
• Measure distances between elements, drop rulers and guides, and lay a
  mockup over the page with opacity, offset, scale and difference blend.
• Native eyedropper, with contrast against the picked pixel.

The side panel summarises the page: a type scale with the combinations
grouped under each step, a palette clustered by perceptual distance with
role filters, spacing rhythm, radii, shadows and declared fonts. Every
group links back to the elements it came from. Stack detection reports
framework, builder, styling, motion, font provider and analytics with the
evidence behind each one, and never claims a technology is absent.

Save an element or a whole summary as a reference with your own note and
a cropped screenshot. Compare two saved summaries side by side, which is
how the same site at two widths reads as a responsive diff. Export as
Markdown, JSON, a taste-ledger fragment, or a ZIP with the screenshots.

Every reading is honest about its limits. Confidence is stated, partial
scans say they are partial, and a value that cannot be measured says so
instead of guessing.

Private by construction: no account, no telemetry, no analysis server.
Page analysis and saved references stay on your device. The only network
requests are the ones you ask for, when you fetch an asset's file details
or download it, and those go to the host the page already uses.
```

## Permission justifications

Paste these into the dashboard's Privacy practices tab, one per permission.

| Permission | Justification |
| --- | --- |
| `activeTab` | The inspector reads the page you activate it on. activeTab grants that access from your click on the toolbar icon or your keyboard shortcut, for that tab only, and it lapses when you navigate away. It is requested instead of host permissions so the extension has no standing access to any site. |
| `scripting` | Injects the inspector into the tab when you activate it, and removes it when you stop. The same API reads the page's own global variables for stack detection. Nothing is injected before you activate. |
| `sidePanel` | Presents the page-level research tools beside the page: the design summary, the asset list, the stack report, the mockup controls, and your saved references. |
| `downloads` | Saves the files you ask for: an image or SVG from the Assets tab, a self-hosted font file, a JSON or ZIP export of your saved references. Downloads only start from a button you pressed. |
| `storage` | Keeps your settings and your saved research on this device. Written to local storage only, never to synchronised storage, so private research does not leave the machine. |

**Remote code:** No. All code ships inside the package.

**Host permissions:** None. The generated manifest has no `host_permissions` key, which
`e2e/smoke.spec.ts` asserts on every run.

**Data usage:** Design Inspector does not collect or transmit user data. Declare no data
collection in every category. See [PRIVACY.md](../PRIVACY.md).

## Graphics

- Store icon: `public/icons/icon128.png` (the packaged manifest declares it).
- Screenshots, 1280x800, in `store/screenshots/`:

| File | What it shows |
| --- | --- |
| `01-typography.png` | The inspector pinned on a heading: family, confidence, source, size, line height, tracking, colour, contrast. |
| `02-layout-outlines.png` | Layout outlines over the page, with the box model and edge labels on the pinned element. |
| `03-summary-palette.png` | The side panel's page summary: type scale and the clustered palette with role filters. |
| `04-assets.png` | The Assets tab: every discoverable asset with filters, selection and the ZIP action. |
| `05-measure.png` | Distance measurement between two elements. |

Regenerate after any UI change:

```bash
pnpm screenshots
```

The product is the screenshot: nothing is overlaid, annotated, or composited. If a shot
needs a caption to make sense, fix the UI instead.

## Submit checklist

1. [ ] Create or select the item in the [developer dashboard](https://chrome.google.com/webstore/devconsole). A developer account is a one-time 5 USD fee.
2. [ ] `pnpm check` is green, `pnpm test:e2e` is green, and `store/QA.md` reflects this build.
3. [ ] `pnpm release --patch --notes "..."` (or `--minor`, `--major`), which bumps the version, writes the changelog entry, reruns the gate, and builds the ZIP.
4. [ ] Confirm the built `.output/chrome-mv3/manifest.json` has no `host_permissions` and exactly the five permissions above.
5. [ ] Upload `.output/design-inspector-<version>-chrome.zip`.
6. [ ] Paste Name, Summary, Description, Category and Language from this file.
7. [ ] Upload the screenshots from `store/screenshots/`.
8. [ ] Privacy tab: paste the permission justifications, declare no data collection, answer "no remote code", and paste the privacy policy URL.
9. [ ] Confirm the privacy page is deployed and its wording matches the shipped behaviour.
10. [ ] Set visibility and submit. A submitted package is not an approved one: check the dashboard for the review result.
