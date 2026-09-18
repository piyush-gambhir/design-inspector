# Design Inspector: Product Requirements

**Working name:** Design Inspector
**Owner:** Piyush
**Date:** 18 September 2026
**Version:** 1.0
**Status:** Proposed build specification
**Initial platform:** Chrome desktop, Manifest V3

> Inspect the details. Understand the patterns. Keep what inspires you.

## 1. Product definition

Design Inspector is a browser extension for studying how websites are designed. Activate it on a page, hover over an element, and read its typography, colors, spacing, dimensions, layout, and assets. Pin the element to explore its details, copy useful styles, download an available asset, or save a reference.

A side panel reveals the page's recurring design patterns: typography combinations, palette, spacing, radii, shadows, assets, and evidence of the technology used. A research collection preserves deliberately saved discoveries, and structured exports make them useful in the taste ledger and future design work.

The product should make a typical reference-mining session possible in under two minutes without opening DevTools.

### 1.1 Relationship to Recast and Perch

- **Recast:** captures a website for reconstruction.
- **Design Inspector:** provides a live lens for understanding individual elements and recurring design choices while browsing.
- **Perch:** supplies a related visual language and established settings patterns where suitable.

Reuse existing code where verified compatible. The availability and suitability of the proposed Recast and Perch modules must be checked during implementation; this document does not assume those repositories have already been audited.

### 1.2 Decisions adopted for this specification

These defaults resolve open questions from the concept and can be changed before their implementation milestone:

1. Personal design research is the primary workflow. General developer and designer use follows from doing that well.
2. V1 includes a small local collection of explicitly saved references. References survive closing a tab and restarting the browser. The taste ledger remains the intended long-term destination.
3. V1 does not include accounts, cloud storage, collection boards, or a large reference-management application.
4. The default inspector uses ordinary page access. It does not attach a debugger or claim guaranteed rendered-font identification.
5. Inspection and saved research remain local. Settings use local storage by default; browser settings sync is a separately disclosed future option.
6. The full feature vision is retained below, with delivery phases separating the first usable release from subsequent additions.

## 2. Users and jobs to be done

| User | Primary job | Successful outcome |
|---|---|---|
| Piyush studying reference sites | Collect concrete design decisions for the taste ledger | A useful reference with source, visual context, measurements, and a short observation |
| Frontend developer | Understand a heading, component, or layout before implementing something similar | Read and copy relevant values without navigating DevTools |
| Designer | Study typography, palette, spacing, and visual assets | See recurring patterns and preserve selected examples |
| Founder or marketer | Understand visible technology choices on a site | Receive a concise stack report with evidence and uncertainty |

Primary user story:

> When I find a website I admire, I want to understand the choices behind a few key elements and save those choices with context, so I can apply what I learned later.

Supporting questions the product answers:

- What font styling, size, weight, line height, and tracking does this text use?
- How is this section spaced and constrained?
- Which colors, type combinations, and spacing values recur?
- Where does this image or SVG come from, and can I save it?
- What evidence identifies the site's framework, builder, styling tools, or motion libraries?
- What exactly did I find useful here, and how do I preserve it?

## 3. Goals, boundaries, and principles

### 3.1 Goals

- Make basic inspection immediate and readable.
- Present page patterns in a form useful for design decisions.
- Preserve source context alongside saved measurements.
- Support faithful copying and clearly labelled approximation.
- Operate only after explicit activation on the current page.
- Remain usable when some information cannot be accessed.

### 3.2 Out of scope for the initial product

- Editing the inspected website or publishing changes to it.
- Reconstructing complete components or applications from copied styles.
- Recovering an original source repository, Tailwind configuration, or complete design-token system.
- Crawling every route on a domain.
- Inspecting the internal structure of pixels painted into canvas or WebGL.
- Guaranteed extraction of streamed, protected, or dynamically assembled video.
- Complete accessibility auditing.
- Accounts, collaboration, subscriptions, cloud collections, or server-side analysis.
- AI-generated design criticism or automatic claims about why a design works.

### 3.3 Product principles

1. **Useful information first.** Hover answers the immediate question; detail appears after pinning.
2. **Evidence before certainty.** Distinguish observed, derived, inferred, and unavailable information.
3. **Context travels with a reference.** Save the source, viewport, time, and relevant visual context.
4. **Patterns remain traceable.** Every summary value should lead back to examples where possible.
5. **The page stays usable.** Inspection can be paused, dismissed, and reactivated predictably.
6. **Saving is deliberate.** Hovering does not silently build a browsing archive.

## 4. Delivery scope

All phases belong to the intended product. A later phase is not a requirement for shipping the first release.

| Capability | Phase 1: first usable release | Phase 2: expanded toolkit | Phase 3: advanced coverage |
|---|---|---|---|
| Activate, hover, pin, parent navigation | Required | Refinements | - |
| Box model and element layout | Required | More complex geometry support | - |
| Typography | Computed styling, declared families, source evidence, available self-hosted font downloads | Improved font matching and source coverage | Optional verified rendered-font mode if feasible |
| Colors and surfaces | Required; bounded contrast support | More complex background analysis | - |
| Distance measurement | - | Required | - |
| Individual assets | Images, inline SVG, CSS image URLs | Direct video files and richer asset variants | Advanced asset cases only where feasible |
| Page assets list | Required | Filters, selection, ZIP export | - |
| Page design summary | Required | Improved grouping and comparison | Optional comparison across captured viewports |
| Stack report | Small tested set of high-confidence signatures | Broader category coverage | Ongoing signature maintenance |
| Copy styles | Computed CSS and faithful Tailwind output | Closest-standard Tailwind suggestions | - |
| Save references | Local collection and notes | Better organization if justified | - |
| Export | JSON, generic Markdown, taste-ledger preset | Multi-reference bundles | - |
| Browser support | Chrome desktop | - | Firefox assessment and implementation |

## 5. Primary experience

1. The user lands on a reference site and activates the extension through its toolbar action or configured shortcut.
2. A small badge indicates that inspection is active.
3. Hovering the hero heading highlights the element and presents its main typography values.
4. Clicking pins the heading. The user reads full details, navigates to its parent, or copies selected styles.
5. The user saves the heading with an optional note about why it is useful.
6. The user inspects a section wrapper to understand padding, width constraints, alignment, and gap.
7. The user downloads a displayed image or inline SVG where available.
8. Opening the side panel reveals recurring type combinations, colors, spacing values, and a concise stack report.
9. The user selects useful references and exports Markdown for the taste ledger.
10. Turning inspection off removes its overlays and restores ordinary page interaction.

The extension must also support quick sessions that stop after answering a single question such as "what size is this heading?"

## 6. Information architecture and visual design

### 6.1 Surfaces

| Surface | Purpose | Main content |
|---|---|---|
| Toolbar popup | Entry and settings | Inspect on/off, open panel, shortcut reminder, settings |
| Inspection badge | Persistent mode awareness | Active/paused status and exit control |
| Hover card | Immediate reading | A small set of values relevant to the element |
| Pinned inspector | Detailed element analysis | Typography, surfaces, layout, assets, copy and save actions |
| Side panel | Page-level research | Summary, Assets, Stack, Saved |

The toolbar action opens a compact popup with a primary Inspect toggle. The keyboard shortcut toggles inspection directly. Activating inspection must not require opening the side panel.

### 6.2 Visual direction

- Quiet, compact, mostly monochrome, with one accent color.
- Subtle box-model tints and readable edge labels.
- Minimal borders; use restrained separators where they improve scanning.
- Light, dark, and system themes, with a manual override.
- Legible typography at normal browser zoom; avoid tiny metadata text.
- Color values always include text labels as well as swatches.
- Cards stay inside the viewport and reposition to avoid covering the selected element where practical.
- Advanced details are progressively disclosed rather than displayed on every hover.

### 6.3 Contextual hover content

- **Text:** family reading, weight, size, line height, tracking, color.
- **Image or SVG:** asset type, rendered dimensions, available source information.
- **Container:** dimensions, display mode, padding, gap, width constraint.
- **Other elements:** dimensions and the most relevant surface or layout properties.

## 7. Inspector interaction requirements

### INS-01: Activation and scope

- Activate through the toolbar or a configurable browser shortcut.
- Apply activation to the selected tab; do not activate other tabs automatically.
- On a full navigation or reload, end the inspection session and require reactivation in V1.
- On a same-document application route change, keep the mode active, clear a stale selection, and mark page results for refresh.
- Explain unsupported browser pages or denied access without displaying an empty or broken inspector.

### INS-02: Hover and highlighting

- Identify the eligible element beneath the pointer while excluding extension-owned UI.
- Highlight its content, padding, border, and margin with distinct tints.
- Display edge values without overlapping labels when space permits.
- Update geometry during scrolling and resizing.
- Handle negative margins, zero values, and very small elements without inventing positive spacing.
- For transformed elements, identify when displayed bounds are axis-aligned visual bounds rather than the untransformed layout box.

### INS-03: Pinning and selection

- A primary click while actively inspecting selects the element and pins its details.
- That selection click must not also activate a page link, button, or form submission.
- Moving the pointer after pinning must not replace the selected element.
- Clicking another page element while inspecting selects it.
- The pinned inspector remains stable enough to read and use its controls.
- If the selected node disappears, show "Element is no longer on the page" and allow a new selection.

### INS-04: Ancestor navigation

- Show a compact breadcrumb from the selected element to useful ancestors.
- Allow selecting a parent container or section without repeatedly hunting for an exposed edge.
- Provide keyboard parent/child navigation when the inspector has focus.
- Use readable labels, such as element name, role, and a short identifier where available.
- Do not rely on unstable generated class names as the only user-facing label.

### INS-05: Interaction modes and dismissal

- Provide an explicit **Interact with page** toggle that pauses selection interception while preserving the pinned element.
- In that mode, links, forms, scrolling, and page controls behave normally; the inspection badge shows Paused.
- Escape closes an inspector menu first, then clears a pinned selection, then exits inspection when no selection remains.
- Extension shortcuts must not hijack ordinary typing inside editable fields.
- Keyboard focus must be visible and must not become trapped in the extension.

### INS-06: Live readings and saved readings

- Pinned readings follow the current element and update after relevant layout or style changes.
- Record the observation time for a reading.
- Saving creates an immutable snapshot of values at that time. Later page changes do not rewrite saved references.
- Dynamic changes must not interrupt a copy action or replace text the user is selecting in the inspector.

### Acceptance criteria

- A user can select a heading, move to its section ancestor, copy a value, and exit without triggering the page's click action.
- Scrolling and zooming do not leave highlights detached from their elements.
- Turning inspection off removes overlays and interaction interception.
- Opening the side panel and changing viewport width causes live readings to refresh; saved references retain their original viewport context.

## 8. Typography requirements

### TYP-01: Required readings

| Field | Requirement |
|---|---|
| Font family | Show the declared computed family stack; separately identify a matched or verified face when evidence supports it |
| Confidence | Label identification as Declared, Matched, or Verified; explain the distinction |
| Source | Google Fonts, Adobe Fonts, Fontshare, self-hosted, system, or Unknown, with supporting URL when available |
| Weight and style | Computed weight, normal/italic/oblique, and available relevant variation settings |
| Font size | Pixels and equivalent rem, calculated using the inspected document's root font size |
| Line height | Resolved value and ratio when determinable; preserve `normal` when an exact value is unavailable |
| Letter spacing | Computed value and equivalent em where meaningful |
| Text treatment | Transform, decoration, and relevant variants such as small caps |
| Text color | Swatch and available color representations |
| Contrast | Ratio only when supported background analysis can produce a defensible result |

### TYP-02: Font identification boundaries

- Do not label the first family in a CSS stack as the verified rendered font.
- Font availability or a loaded font file alone does not prove that it rendered every character.
- Where multiple fonts render a text run, a future verified mode should report that rather than choosing one silently.
- Distinguish authored variation settings from effective axis values; report only values actually available.
- A converted rem value is an equivalent at the current root size, not proof that the original stylesheet used rem.

### TYP-03: Font source and download

- Display discovered source URLs and format information when available.
- Support download of a discovered self-hosted font file when the browser can access it.
- Indicate if a file is a subset or one of several related resources when known.
- Do not imply that a downloaded subset is the entire font family.
- If unavailable, retain useful family and source information and explain the specific limitation.

### Acceptance criteria

- A fixture with a missing first-choice font is never reported as having that font verified.
- A page with a non-16px root size receives correct rem conversions.
- `line-height: normal` is not converted into an invented precise measurement.
- Inaccessible font metadata does not prevent ordinary typography inspection.

## 9. Colors, surfaces, and contrast

### SUR-01: Surface readings

Show the selected element's relevant:

- Text, background, and individual border colors.
- Background layers and gradients in layer order.
- Box shadows, text shadows, opacity, filters, and backdrop filters.
- Border widths, styles, and per-corner radii.
- SVG fill and stroke where applicable.

Every displayed value must have a copy action. Copying a category copies its relevant properties rather than hundreds of unrelated defaults.

### SUR-02: Color representation

- Offer hex, RGB, and OKLCH representations where conversion is supported.
- Preserve alpha and the original observed color serialization.
- Label conversions that lose gamut or precision; do not imply all formats are losslessly equivalent.
- Use a checkerboard or equivalent treatment for transparency.
- Keep copied precision sufficient for faithful reuse while allowing rounded display values.

### SUR-03: Contrast

- V1 supports ordinary text over determinable solid backgrounds, including supported transparent ancestor composition.
- Identify the foreground and background used in the calculation.
- For unsupported image, gradient, blend, filter, or overlay cases, show "Contrast unavailable for this background."
- Future approximate analysis must be explicitly labelled and must not present a precise-looking ratio as verified.
- Describe the result as a contrast reading for the inspected state, not an accessibility certification of the element or page.

### Acceptance criteria

- Alpha is retained in color copies and exports.
- Multilayer backgrounds and multiple shadows preserve their ordering.
- Text over an unsupported photographic background does not receive a fabricated contrast ratio.

## 10. Spacing, layout, and measurement

### LAY-01: Layout readings

Show:

- Display mode and box sizing.
- Layout dimensions and current visual bounds, with clear labels when they differ.
- Padding, margin, and border values per side.
- Minimum, maximum, and current width/height constraints where available.
- Flex direction, wrapping, alignment, justification, and row/column gaps.
- Grid template rows/columns, auto-flow, gaps, and selected-item placement.
- Position mode, relevant insets, and z-index, preserving values such as `auto`.
- Useful parent layout context through ancestor navigation.

Do not equate computed pixel values with original authored units. Source expressions such as `clamp()` or custom properties may be shown separately when their origin is actually available.

### LAY-02: Distance measurement, Phase 2

- Pin one element and hold Alt/Option while hovering another to compare them.
- Draw horizontal and vertical edge-distance guides in CSS pixels.
- Distinguish separation, overlap, and containment.
- Define measurements using current visible bounding boxes; they are geometric distances, not inferred CSS margin values.
- Recalculate after scrolling and resizing.
- Avoid triggering measurement shortcuts while the user is typing in a field.

### Acceptance criteria

- Fixtures for flex, grid, constrained containers, negative margins, sticky positioning, and transforms produce correctly labelled results.
- A measured visual gap is not exported as a margin declaration unless that margin was independently observed.

## 11. Assets

### AST-01: Individual asset inspection

Support images, inline SVGs, and CSS background-image URLs in Phase 1. Add directly addressable video files in Phase 2.

Display when available:

- Asset type and URL.
- Rendered dimensions.
- Available intrinsic dimensions with their units and interpretation.
- Selected responsive source and other discoverable candidates.
- File size only when known; Unknown must not appear as zero.

For responsive images, identify the resource the browser selected. Do not assume a larger undisclosed original exists. Offer other discovered candidates separately and do not label them verified originals without evidence.

### AST-02: Downloads

- Download the selected available resource without silently resizing it.
- Use a sensible filename and preserve the extension where known.
- Distinguish a direct browser download from operations that require reading the resource's bytes.
- Keep asset URLs available for copying when a download or byte fetch fails.
- Report failures per asset with an actionable reason when known.

### AST-03: Inline SVG

- Serialize a selected inline SVG into a standalone `.svg` file.
- Include required namespaces and resolve styling, definitions, and references where feasible.
- Remove executable content from exported SVGs.
- Preview exports on test fixtures to verify appearance.
- Identify unresolved external dependencies; do not silently claim a self-contained export when dependencies remain.

### AST-04: Page assets list

- Show discovered assets with thumbnails or type placeholders.
- Deduplicate repeated resource references while retaining usage counts.
- In V1, show currently discoverable assets and allow individual downloads.
- In Phase 2, add filters by type, multi-select, select-all within the current filter, and ZIP export.
- Clearly identify lazy-loaded or inaccessible assets that have not been discovered or fetched.
- Never auto-scroll or activate page controls solely to force asset discovery.

### AST-05: Bulk export, Phase 2

- Display progress and allow cancellation.
- Include successful files and a manifest of skipped or failed items.
- Handle filename collisions deterministically.
- Apply a documented memory/size limit and offer smaller batches when exceeded.
- Do not lose the entire batch because one asset fails.

### Acceptance criteria

- An image selected through `picture` or `srcset` is associated with the selected resource, not merely its fallback `src` attribute.
- Repeated icons do not produce duplicate resource rows by default.
- Blob-backed or streamed video is not represented as a guaranteed downloadable source file.
- A ZIP with partial failures reports those failures clearly.

## 12. Page design summary

### SUM-01: Scope and collection

- Generate a summary on demand when the user opens Summary or requests a refresh.
- Scan eligible rendered DOM elements in the current document state, including offscreen elements with available rendered layout.
- Exclude hidden elements, extension UI, and inactive content that is not currently rendered.
- Disclose inaccessible frames, closed component internals, skipped rendering, and scan limits.
- Do not imply coverage of unvisited routes, unopened states, unloaded content, or other breakpoints.
- Record viewport, root font size, page URL, capture time, and scan coverage.
- Mark results stale after relevant changes and provide Refresh. Avoid continuous whole-page rescanning.

### SUM-02: Typography combinations

- Group text-bearing elements by family reading, size, weight, style, line height, and letter spacing.
- Show readable samples, usage counts, and example elements.
- Distinguish a compact size scale from the full list of typography combinations.
- Count text-bearing elements without counting an ancestor again solely because a descendant contains text.

### SUM-03: Palette

- Group observed colors by property role: text, backgrounds, borders, and SVG fill/stroke.
- Treat labels such as Accent as inferred suggestions, with user correction available if included.
- Show normalized comparable values while retaining source values and alpha.
- Keep gradient stops distinguishable from solid surfaces.
- Define counts as element/property occurrences, not visual area or prominence.

### SUM-04: Spacing rhythm

- List recurring padding, margin, and gap values with separate usage breakdowns.
- Make frequent values and one-offs easy to distinguish.
- Keep zero values and negative margins accessible without letting them dominate the default view.
- If nearby values are grouped into a suggested scale, retain exact measurements and disclose the grouping.
- Never imply that the inferred scale is the site's original token system.

### SUM-05: Fonts, radii, and shadows

- Separate font declarations, known loaded faces, and faces matched to inspected content.
- Do not label every `@font-face` declaration as a completed download.
- Show recurring radius patterns, including asymmetric corners.
- Show deduplicated shadow combinations with examples.

### SUM-06: Traceability

- Clicking a summary entry reveals example elements and can highlight them on the page.
- Selecting an example opens its inspector details.
- Request user action before scrolling to an offscreen example.
- Cap simultaneous highlights and provide Next/Previous navigation for large match sets.
- Export the scan scope and counting definitions with the summary.

### Acceptance criteria

- A hidden mobile navigation does not inflate the desktop typography inventory.
- Nested text markup does not produce ancestor-only duplicates.
- The user can move from a palette swatch or spacing value to at least one available source example.
- Resizing the page makes the prior summary's viewport explicit and offers a refreshed reading.

## 13. Stack detection

### STK-01: Report structure

Each detection includes:

- Technology name and category.
- Confidence label: High or Likely.
- Evidence such as a characteristic URL, DOM marker, metadata, accessible runtime signal, or observed header.
- Observation scope and timestamp.

Weak hints may be exposed in an expanded evidence view but must not appear as confident detections. Version numbers are shown only when explicitly supported by reliable evidence.

### STK-02: Intended coverage

| Category | Target technologies |
|---|---|
| Frameworks | React, Next.js, Vue, Nuxt, Svelte, SvelteKit, Astro, Remix, Angular, SolidJS |
| Builders and CMS | Webflow, Framer, WordPress, Shopify, Wix, Squarespace, Sanity, Contentful |
| Styling | Tailwind, CSS Modules, styled-components, Emotion, Bootstrap |
| Motion and 3D | GSAP, Framer Motion, Lenis, Locomotive, Three.js, Spline, Rive, Lottie |
| Font providers | Google Fonts, Adobe Fonts, Fontshare |
| Infrastructure and analytics | Vercel, Netlify, Cloudflare, GA4, Plausible, PostHog, Hotjar |

This is a coverage roadmap, not a guarantee that every installation can be detected. V1 ships a smaller verified signature set. A technology enters the supported list only after positive and negative fixture checks.

### STK-03: Evidence rules

- Prefer direct signatures over generic naming coincidences.
- Do not identify Tailwind solely because an element has classes resembling common utility names.
- Do not identify CSS Modules solely from hashed-looking class names.
- Distinguish provider, proxy, analytics, and application framework roles.
- "Not detected" means insufficient evidence, not proof that a technology is absent.
- Do not execute downloaded site code to determine its stack.
- V1 uses available page evidence. Header observation is a later capability with separately evaluated permissions and timing.

### Acceptance criteria

- Every visible detection has inspectable evidence.
- A generic filename or class-name collision does not create a high-confidence match.
- A script loaded before activation is not described as a network request the extension observed.
- Unknown results are presented honestly and do not block other product features.

## 14. Saving references

### SAV-01: Explicit save

Provide **Save reference** on a pinned element and **Save summary** in the page summary.

A saved element reference contains:

- User-editable title and optional "Why I saved this" note.
- Page title, source URL, capture time, viewport, root font size, and relevant scroll context.
- Element label and a best-effort locator for context; the locator is not a promise of future rediscovery.
- Measured style categories and the evidence/confidence attached to uncertain readings.
- Associated asset URLs.
- Optional screenshot of the currently visible element or region.

### SAV-02: Screenshot behavior

- Screenshots are taken only as part of an explicit save/capture action.
- Capture the visible page state without extension overlays where feasible.
- Account for zoom and device pixel ratio when cropping.
- If the element extends beyond the viewport, identify the image as a visible crop.
- Do not automatically scroll, stitch, or alter the page to produce a full-element capture in V1.
- Saving measurements must still work when screenshot capture is unavailable.

### SAV-03: Local collection

- Saved shows deliberately captured references, grouped by source page or capture session.
- References persist across tab closure and browser restart.
- Users can rename, edit notes, preview, select for export, delete, or clear saved items.
- Save failures and storage limits must be visible; never report success before persistence succeeds.
- Deleting a reference removes its associated local screenshot if no other reference needs it.
- Do not store every hovered reading or collect general browsing history.

### Acceptance criteria

- A saved reference remains available after the original page is closed.
- Updating the live page does not alter an existing saved snapshot.
- A note and source URL survive JSON export and Markdown export.
- The collection provides useful saved context without requiring an account.

## 15. Copying and export

### EXP-01: Individual values and computed CSS

- Support one-click copy of a value, a category, or the relevant combined style set.
- Label CSS output as computed styles at the captured viewport.
- Exclude irrelevant browser defaults from normal exports; make the selected property set predictable.
- Keep inherited typography when needed to make the selected style snippet useful.
- Explain that copied styles do not include the element's DOM structure, ancestor layout, responsive rules, or all interaction states.
- Never replace the user's clipboard until they invoke a copy action.

### EXP-02: Tailwind

Provide two explicit modes:

1. **Faithful values:** represent supported observed properties using arbitrary values or equivalent utilities, with explicit overrides for coupled properties such as line height.
2. **Closest standard utilities, Phase 2:** suggest utilities from a stated Tailwind version/default theme and list deviations from the observed values.

Requirements:

- Do not claim to recover the site's original classes or project configuration.
- State the target Tailwind version/theme assumption.
- Keep unsupported properties as accompanying CSS and list them visibly.
- Do not silently discard a property because a convenient class is unavailable.
- Do not invent responsive prefixes from a single viewport observation.

### EXP-03: Page and reference exports

Support:

- Versioned JSON for downstream tooling.
- Human-readable Markdown for page summaries and selected references.
- A taste-ledger Markdown preset.

The taste-ledger adapter must be matched to an actual example/schema from the frontend-design-skill repository before being labelled compatible. Until that mapping is validated, generic Markdown export remains available and must not be described as exact taste-ledger formatting. See [TASTE_LEDGER_EXPORT.md](TASTE_LEDGER_EXPORT.md) for the validated mapping.

### EXP-04: Required export context

Include source URL/title, timestamp, viewport, scan scope, captured values, notes, confidence, limitations, and asset references. User notes must remain distinguishable from measured data and inferred patterns.

Markdown may link to local screenshots only when those files are included in a companion export folder or bundle. Otherwise omit broken local paths and retain the textual reference. Remote source URLs must remain usable.

### Example generic reference export

```markdown
# Reference: Hero typography

- Source: https://example.com/
- Captured: 2026-09-18T10:30:00Z
- Viewport: 1440 x 900 CSS px
- Element: h1
- Font reading: Inter Display (matched, not verified)

## Observed styles

- Size: 72px; equivalent 4.5rem at a 16px root
- Weight: 600
- Line height: 75.6px; ratio 1.05
- Letter spacing: -1.44px; equivalent -0.02em
- Text color: #0A0A0A

## My observation

Large heading balanced by a narrow text column and generous section spacing.

## Scope

Values describe the captured element at this viewport and time.
Responsive rules and other interaction states were not captured.
```

### Acceptance criteria

- Copying faithful typography does not silently change line height or tracking to a preset default.
- JSON includes a schema version and supports round-trip validation of saved readings.
- Markdown remains readable without the extension.
- Taste-ledger export is checked against the agreed destination format before release.

## 16. Accuracy and supported coverage

### 16.1 Shared evidence model

| Status | Meaning | Example |
|---|---|---|
| Observed | Read directly from an available browser/page source | Computed padding or selected image URL |
| Derived | Calculated from observed values | px-to-rem conversion or a supported contrast calculation |
| Inferred | Suggested from evidence that does not prove the conclusion | Font match, framework detection, proposed spacing scale |
| Unavailable | Cannot be determined with current access or supported logic | Contrast over a complex background |

Use more specific labels such as Declared/Matched/Verified for fonts and High/Likely for technology detection, while retaining this shared meaning in exported data.

### 16.2 Coverage boundaries

- Browser-internal and other restricted pages may be unsupported.
- Cross-origin frames and resources may require additional access and can remain unavailable.
- Open shadow roots should be supported where practical; closed internals must not be assumed accessible.
- Pseudo-element styles may appear under their owning element when accessible; they do not need independent pointer selection in V1.
- Canvas, WebGL, embedded documents, and third-party widgets may expose only their containing element.
- Animation readings are snapshots of current state; provide clear handling for rapidly changing values.
- Large or unusual pages may yield a partial summary with explicit coverage information.

Partial support must degrade individual capabilities, not crash the entire inspector.

## 17. Privacy, permissions, and security

### 17.1 User-facing privacy promise

> Page analysis and saved references stay on your device. The extension has no analysis server and sends no inspected content or telemetry to us. Asset downloads may contact the resource's original host. You control what you export.

If browser settings sync is introduced, disclose that it uses Chrome Sync, is optional, and applies only to settings. Do not continue using an absolute "nothing leaves the browser" claim in that configuration.

### 17.2 Baseline permissions

| Permission | Intended purpose |
|---|---|
| `activeTab` | Temporary access to the page following user activation |
| `scripting` | Inject and remove inspection functionality |
| `sidePanel` | Present page-level research tools |
| `downloads` | User-requested asset and export downloads |
| `storage` | Settings and local saved-reference metadata |

Do not request broad persistent access to every website for the default workflow. Additional host access, network observation, and debugger-based capabilities require a separately reviewed product flow and accurate permission disclosure.

Header observation through `webRequest` requires that permission plus applicable host access. It observes qualifying traffic while active and must not be treated as historical access to all completed requests.

### 17.3 Data handling and defensive behavior

- No background browsing surveillance, analytics SDK, or remote analysis in the initial product.
- No automatic saving of page text, screenshots, or asset bytes during hover.
- Treat all page text, URLs, SVG content, and messages as untrusted input.
- Render extracted strings safely; do not execute them as extension code or markup.
- Validate content-script messages and constrain privileged actions to supported user-initiated operations.
- Keep private research out of synchronized storage.
- Prevent prototype data, screenshots, and fixture captures from entering production builds.
- Provide clear controls to delete saved research.

## 18. Technical foundation

### 18.1 Intended stack

- WXT for extension development and packaging.
- React 19 and TypeScript for extension interfaces.
- Tailwind CSS v4 for styling.
- Manifest V3, Chrome first.
- Vitest for pure logic and parsing tests.
- Playwright with an extension-capable Chromium environment for integration and browser tests.

Pin compatible package versions during setup. Firefox is a later product milestone; WXT does not remove the need to assess browser-specific APIs and behavior.

### 18.2 Responsibilities

| Component | Responsibility |
|---|---|
| Content script | Element selection, geometry, computed readings, scoped page scanning, overlay rendering |
| Isolated UI root | Protect extension interface styling using a shadow root and deliberate inherited-style resets |
| Side panel | Summary, assets, stack evidence, saved references, export controls |
| Popup | Activation, shortcut guidance, settings entry |
| Background service worker | Coordinate permitted downloads, activation, messaging, and persistent operations |
| Detection modules | Pure or narrowly scoped logic for fonts, colors, contrast, asset discovery, CSS/Tailwind conversion, and stack signatures |
| Local persistence | Reference metadata and settings; larger binary data in an appropriate local store such as IndexedDB |
| Export adapters | Stable JSON, generic Markdown, validated taste-ledger format |

Do not depend on the service worker remaining alive indefinitely. Persist durable job/reference state where required and handle interruption or restart explicitly.

### 18.3 Proposed reuse

From Recast, evaluate scaffold/configuration, shared UI, CSS parsing and font-face resolution, asset URL handling, release tooling, store checklist, landing-page structure, and test fixtures.

From Perch, evaluate theme controls, settings organization, and visual components. Adapt any sync-first settings behavior to this product's local-first default.

### 18.4 Minimum data contracts

**Element snapshot:** identifier, source context, capture time, viewport, selected element description, geometry, typography, surfaces, layout, asset references, and evidence/limitations.

**Page summary:** source context, scan scope/counts, typography groups, role-based colors, spacing values, radii, shadows, font records, technology detections, and examples.

**Saved reference:** immutable snapshot, editable title/note, optional local screenshot reference, creation time, and last metadata-edit time.

**Export envelope:** schema version, extension version, export time, source records, payloads, and limitations.

Keep raw observed values separate from display formatting and inferred groups. Version persisted records and exports so later changes can be migrated safely.

Implemented in [lib/contracts.ts](../lib/contracts.ts).

## 19. Performance, accessibility, and reliability

### 19.1 Proposed performance budgets

These are acceptance targets to measure on a documented reference machine and pinned Chrome version, not claims about an existing implementation.

| Operation | Initial target |
|---|---|
| Activation to usable overlay | Under 300ms at p95 on a normal already-loaded fixture |
| Pointer movement to updated basic highlight/card | Under 50ms at p95, excluding separately loaded metadata |
| Initial summary for 2,000 eligible elements | Under 2 seconds at p95 |
| Extension-induced uninterrupted main-thread work | Avoid tasks exceeding 50ms in the representative performance suite |
| Download/scan actions | Prompt progress feedback; cancel long-running work |

- Batch DOM reads and writes and avoid full scans on pointer movement.
- Compute detailed or expensive fields only when needed.
- Use bounded incremental scans with cancellation and visible progress.
- Establish a documented scan cap for large pages and label partial results.
- Reuse readings where valid and invalidate them after relevant changes.
- Stopping inspection cancels active scanning and removes event interception.

### 19.2 Accessibility

- Keyboard access to activation, pin details, ancestor selection, copying, saving, panel tabs, and exports.
- Visible focus, accessible control names, and sensible focus restoration.
- Readable contrast in both extension themes.
- Status and errors communicated with text, not color alone.
- Respect reduced-motion settings.
- Avoid announcing every pointer movement to assistive technology; announce deliberate selection and completed actions.

### 19.3 Failure states

Design explicit states for unsupported page, denied access, removed element, unavailable font source, inaccessible asset, partial summary, no stack evidence, storage full, failed download, interrupted export, and stale page data.

Each failure must preserve unaffected work. Show a short reason and a useful next action such as Retry, Refresh, Copy URL, Select another element, or Export existing results.

## 20. Validation and launch criteria

### 20.1 Representative fixture coverage

- Static marketing page and application with client-side navigation.
- Text with fallback fonts, variable fonts, mixed scripts, inherited styles, and unusual root sizes.
- Solid/translucent backgrounds, gradients, images, shadows, and wide-gamut colors.
- Flex/grid layouts, transforms, sticky elements, nested scrolling, and negative margins.
- Inline SVGs, CSS backgrounds, responsive images, lazy assets, and duplicate resources.
- Open shadow roots, inaccessible frames, pseudo-elements, canvas, and removed DOM nodes.
- Large DOM, zoom changes, viewport changes, side-panel opening, and animations.
- Positive and negative technology signatures.

### 20.2 Testing approach

- Unit-test conversions, normalization, font matching, supported contrast cases, confidence rules, export serialization, and Tailwind property preservation.
- Integration-test activation, pinning, parent navigation, event suppression, pause/exit, persistence, asset failure handling, and exports.
- Visually verify overlay alignment, card placement, both themes, small viewports, and SVG/screenshot output.
- Run manual checks on diverse real websites to discover cases absent from controlled fixtures.
- Test that disabling inspection restores page behavior and that no extension-initiated telemetry or analysis requests occur.

### 20.3 Phase 1 release gate

Release only when:

1. The primary two-minute research workflow can be completed on representative supported pages.
2. Inspector activation, pinning, parent selection, and dismissal are reliable.
3. Typography, surface, and layout readings preserve observed values and identify uncertainty.
4. Individual image/SVG downloads work where supported and fail clearly where unsupported.
5. Page summaries include scope and link back to examples.
6. Saved references persist correctly and can be deleted.
7. CSS, faithful Tailwind, JSON, and Markdown exports pass their acceptance checks.
8. The taste-ledger preset is verified against the actual destination format before being advertised as supported.
9. Permission descriptions and privacy language match implementation.
10. Performance, keyboard access, and representative browser checks pass without unresolved launch-blocking defects.

### 20.4 Product success measures

Evaluate through manual research sessions and opt-in feedback; do not introduce telemetry merely to collect these metrics.

- Time to answer a basic typography or spacing question.
- Time to save a useful reference with context.
- Completion rate for the primary workflow without opening DevTools.
- Frequency of misleading readings or unsupported cases presented as facts.
- Whether exported references remain understandable and useful a week later.
- Whether the page summary helps identify patterns faster than individually inspecting elements.

## 21. Implementation milestones and dependencies

| Milestone | Deliverable | Exit condition |
|---|---|---|
| M0: Foundation and validation | Inspect reusable code; establish fixtures, data contracts, permissions, and taste-ledger example | Reuse and permission decisions documented; export target available |
| M1: Inspector | Activation, selection, highlight, pin, ancestors, typography, surfaces, layout | Reliable inspection across core fixtures |
| M2: Capture and copy | CSS/Tailwind copy, individual assets, saved references, local persistence | A useful reference survives page closure and can be exported |
| M3: Page research | Summary, basic asset list, tested stack signatures, export adapters | End-to-end research workflow passes |
| M4: Release hardening | Performance, accessibility, failure handling, privacy verification, packaging | Phase 1 release gate passes |
| M5: Expanded toolkit | Distance measurement, ZIP export, wider signatures, approximate Tailwind suggestions | Phase 2 feature acceptance checks pass |
| M6: Advanced coverage | Evaluate verified font mode, additional asset support, Firefox | Each capability ships only with validated access, UX, and browser support |

No calendar estimate is implied until repository reuse and the early technical investigations are complete.

### Dependencies to resolve during M0

- Locate the actual Recast and Perch repositories and verify candidate modules.
- Obtain an actual taste-ledger entry or schema and its destination conventions.
- Confirm the initial extension identifier, working name, icon direction, and shortcut choice.
- Validate font-source discovery under the baseline permissions.
- Validate screenshot cropping and faithful SVG export on controlled fixtures.
- Define the initial stack-signature set and its negative test cases.
- Pin the browser/runtime versions and performance reference environment.

These dependencies affect specific integrations and release claims. They do not require stopping independent inspector development.

## 22. Technical source notes

The following references support the main platform constraints. Verify them again when implementing the affected capability.

- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab): user-triggered temporary page access.
- [Chrome webRequest](https://developer.chrome.com/docs/extensions/reference/api/webRequest): network-observation permissions and access scope.
- [Chrome debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger): debugging-protocol access and required permission.
- [Chromium CSS protocol](https://chromium.googlesource.com/chromium/src.git/+/d801e95c1bc026bab29d1ea2f63b38c086605a65/third_party/blink/public/devtools_protocol/domains/CSS.pdl): separate rendered-font usage information through `getPlatformFontsForNode`.
- [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage): local, session, and synchronized storage behavior and limits.
- [MDN getComputedStyle](https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle): resolved values rather than recovery of original authored CSS.
- [MDN currentSrc](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/currentSrc): browser-selected image source.
- [MDN checkVisibility](https://developer.mozilla.org/en-US/docs/Web/API/Element/checkVisibility): visibility-related checks and their scope.
- [Tailwind font-size](https://tailwindcss.com/docs/font-size): theme-dependent utilities, coupled line heights, and arbitrary values.

---

**Product acceptance statement:** On a supported page, a user can inspect a design detail, understand its surrounding pattern, and preserve a useful reference with clear provenance and honest limits, without opening DevTools.
