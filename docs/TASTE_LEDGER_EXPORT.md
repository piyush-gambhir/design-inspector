# Taste-ledger export mapping

Destination: `/Users/piyush/code/personal/frontend-design-skill/references/session-ledger.md`.
Validated against that file on 2026-09-18 (PRD EXP-03 dependency).

## What the destination looks like

The ledger is "provenance, not doctrine". Entries are appended at the bottom, dated:

```markdown
## 2026-07-17: the CLI-suite redesign

One paragraph of context: what was studied, where, why.

### REMOVED (explicit user rejections; do not reintroduce)
1. **Bold lead.** Explanation.

### KEPT (approved after real evaluation; these earn their place)
...

### ADDED (ours; the identity layer)
...

### Taste signals worth remembering
- ...
```

Conventions that hold across every entry:

- Heading form is `## YYYY-MM-DD: <title>`. Subsections are `###`.
- Numbered lists inside REMOVED / KEPT / ADDED, each item starting with a bold lead.
- Plain prose. No em dashes anywhere (SKILL.md invariant). Colons, commas, periods.
- Essence notes from research are **principles only**: layout rhythm, type contrast,
  color logic, motion character, the one signature move, what to avoid. SKILL.md says
  "no hex values, no component names" for essence notes. Observed measurements are
  still useful provenance, so they go under a clearly separated **Observed** subsection
  that a reader can skip.

## The preset

`toTasteLedger(references, dateIso)` in `lib/exports/index.ts` emits one entry per
source page (references from the same URL are grouped), shaped like this:

```markdown
## 2026-09-18: reference study, example.com

Studied https://example.com/ on 2026-09-18 at 1440 x 900. Notes are mine;
measurements are computed values at that viewport and time, not authored tokens.

### Essence (mine)

- <Reference title>: <the user's note, verbatim>. Nothing is generated here. When a
  reference has no note the line reads "<title>: no note recorded."

### Observed (computed, this viewport)

- Type scale: 72 / 40 / 24 / 18 / 16 px (Inter Display 600, Inter 400). Family
  readings carry their confidence, e.g. "Inter Display (matched)".
- Palette by role: text 2 colors, background 3, border 1, accent (inferred) 1.
- Spacing rhythm: 8, 16, 24, 48, 96 px recur.
- Radii: 8px, 16px. Shadows: 2 combinations.
- Stack: Next.js (high), Tailwind (likely). "Not detected" is never written.
- Per saved element: one line per reference with label, font, size, weight,
  line-height ratio, tracking, color hex. Example:
  h1 "Build faster": Inter Display (matched) 72px / 4.5rem, 600, lh 1.05, tracking -0.02em, #0A0A0A.

### Avoid

- Left empty for the user to fill. Emitted as a single "- " line so the section exists.

### Scope

Captured at 1440 x 900, root 16px. Responsive rules and interaction states were
not captured. Summary covered N of M eligible elements (capped: yes/no).
```

Rules the adapter enforces:

- Never emit an em dash. Replace any em dash in user notes with a colon.
- The Essence subsection contains only user-authored text and titles. No measured
  values are ever written there.
- Colors appear as hex when available, otherwise the raw serialization, only in the
  Observed subsection.
- Confidence labels (declared / matched / verified, high / likely) are always
  attached to the value they qualify.
- Screenshot paths are omitted (the ledger is a text file in another repo).
- Output is a fragment meant to be appended to the ledger, so it starts with the
  `##` heading and has no document title.

## Status

Mapping validated against the actual ledger structure. The adapter may be labelled
"taste-ledger format" in the UI once `__tests__/exports.test.ts` covers the fragment
shape above.
