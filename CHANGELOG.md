# Changelog

Every released version, newest first. Versions are plain semver and match the version in
`package.json`, which is where the manifest takes it from. `scripts/release.mjs` writes each
new section from its `--notes` argument.

## 0.1.0 (2026-09-18)

First release: the Phase 1 scope of `docs/PRD.md`.

**On the page**

- Hover to read the element under the cursor, click to pin it, Escape to unpin and then
  exit. Clicks never reach the page while inspecting, and "Interact with page" pauses the
  interception. Activation is the toolbar icon or Alt+Shift+I, per tab, never automatic.
- Box model with edge labels, a breadcrumb of ancestors with ArrowUp and ArrowDown, and an
  option to select a heading rather than the inline span inside it.
- Typography: family with declared or matched confidence and never "verified", source
  (Google, Adobe, Fontshare, self-hosted, system or unknown), weight, size in px and rem,
  line height and ratio, tracking, colour in hex, rgb and oklch, and contrast that says
  "unavailable" over images, gradients and video instead of guessing.
- Surfaces and layout: backgrounds, borders, radii, shadows, filters, flex and grid values,
  position and insets, with grid and flex overlays on the pinned element.
- Copy any value, or a category as computed CSS, faithful Tailwind, or closest-standard
  Tailwind v4 utilities with every deviation listed.
- Assets: images with their srcset candidates, inline SVG exported as a standalone file, CSS
  backgrounds and directly addressable video.
- Layout outlines by tag or by nesting depth (Alt+O), the browser's native eyedropper with
  contrast against the picked pixel, Alt and Shift distance measurement, rulers with
  droppable guides, and a mockup overlay with opacity, offset, scale, difference blend and
  drag, remembered per site.

**Side panel**

- Summary: type scale with the combinations grouped under each step, palette clustered by
  perceptual distance with role filters, spacing rhythm, radii, shadows, declared fonts,
  scan scope, a text filter, "Show on page" for every group, and cancel during a long scan.
- Assets: every discoverable asset with filters, selection and a ZIP download whose manifest
  lists what was skipped and why. File details are fetched only when you ask.
- Stack: framework, builder, styling, motion, font provider and analytics detections with
  their evidence and confidence. "Not detected" never claims absence.
- Saved: references grouped by site with editable titles and notes, two summaries compared
  side by side, and export as Markdown, JSON, a taste-ledger fragment, or a ZIP bundle with
  screenshots.

**Fixed in the second live-site pass**

- Alt+click and Shift+click keep their lock. A hover frame scheduled earlier in the same
  frame used to run after the lock and drop it, so the pending frame is now cancelled before
  anything is locked, and a measurement is only ever unlocked on purpose. A hidden measure
  block no longer leaves "Measure (locked)" behind for a screen reader to read.
- Guides can be removed. A guide captures the pointer for its drag, so the browser never
  delivers it a double click; two presses within 400ms, an "x" control that appears on hover
  or focus, and Delete or Backspace while the guide is focused all remove it now.
- Selecting a heading works on real pages. The promotion rule compared the wrapper's box with
  the heading's, which never matched, because an inline wrapper hugs the glyphs and a block
  heading is as wide as its container. It is about layout roles instead: an inline wrapper,
  any depth of them, up to the first box that is not inline, promoted only when that box is a
  tag worth naming and holds no other block-level child.
- An unlocked mockup no longer swallows inspection clicks. The image never takes pointer
  events; its drag is driven from the selection listeners and only while the inspector is not
  intercepting. Mockups now start locked, and the Tools tab says "Unlock to drag".
- Alt+click and Shift+click on our own badge or panel lock the reading underneath them rather
  than doing nothing, because both readings are about the page under the pointer.
- The badge fits a phone. It is capped to the viewport, wraps to a second row, and starts
  collapsed to its dot below 480px. It now follows the viewport too: a rotation or a resize
  collapses or expands it, until you press the control yourself.
- The "first 20 of N" notice in a summary group can actually appear: the aggregate keeps 24
  examples where the controls and the overlay show 20, and the notice states the real cap.
- Edge distances report the nearest element edge, not the nearest hit-test change. The walk
  missed a closer edge whenever a wrapper's box ended before the topmost element changed, so
  the boxes of every element under the pointer are taken into account as well.
- A mockup set from outside the Tools tab is visible to it. The tab reconciles against the
  page's own state, shows the fields it can read, offers Remove, and says "Set from outside
  this panel; not saved." rather than pretending there is nothing there.
- The palette uses the clusters the scan already stored, and recomputes only when a role
  filter is on or the field is absent.
- The Summary tab has a "Jump to" row and focusable section headings, so a keyboard can reach
  the end of a long summary without walking every swatch.
- A pinned element wider than 60 percent of the viewport and taller than 80px gets the panel
  above or below it, whichever has more room, instead of a panel over its own words.
- Escape says what it will do next. The badge shows the next release in the stack, and the
  pinned panel states the whole order once.
- Clicking a heading inside a link the size of a tile selects the heading, with the link kept
  in the breadcrumb as its parent.

**Privacy and permissions**

- Five permissions, no host permissions, no `webRequest`, no `debugger`, no telemetry. The
  only network requests are the asset detail fetches and downloads you ask for. See
  [PRIVACY.md](PRIVACY.md).

**Quality**

- Accessible names on every control, a tab list with roving tabindex and arrow, Home and End
  keys, status and error live regions, a focus indicator measured at 4.25:1 or better in
  light and 9.00:1 or better in dark, no text below 12px, and reduced motion honoured.
- Measured on a 6,001 element fixture: activation 15ms against a 300ms budget, a capped
  5,000 element scan in 437ms against a 3s budget, and no long tasks added over a run with
  the inspector off. See [store/QA.md](store/QA.md).
