import { describe, expect, it } from 'vitest';
import { referenceToMarkdown, summaryToMarkdown } from '@/lib/exports';
import { cardSnapshot, elementReference, headingSnapshot } from './fixtures/snapshots';
import { pageSummary, summaryReference } from './fixtures/summary';

describe('referenceToMarkdown for an element', () => {
  const markdown = referenceToMarkdown(elementReference(headingSnapshot));

  it('follows the heading and section order from the PRD example', () => {
    expect(headings(markdown)).toEqual([
      '# Reference: Hero typography',
      '## Observed styles',
      '### Typography',
      '### Surfaces',
      '### Layout',
      '## My observation',
      '## Scope',
    ]);
  });

  it('lists the source bullets', () => {
    expect(markdown).toContain('- Source: https://example.com/');
    expect(markdown).toContain('- Captured: 2026-09-18T10:30:00.000Z');
    expect(markdown).toContain('- Viewport: 1440 x 900 CSS px');
    expect(markdown).toContain('- Element: h1 "Build faster"');
  });

  it('labels the font reading with its confidence', () => {
    expect(markdown).toContain('- Font reading: Inter Display (matched, not verified)');
  });

  it('names the typeface rather than the CSS alias once the file has been read', () => {
    // The superpower.com case: the site's @font-face nickname is not a
    // typeface, and a reference read six months later needs the real name.
    const identified = referenceToMarkdown(
      elementReference({
        ...headingSnapshot,
        typography: headingSnapshot.typography && {
          ...headingSnapshot.typography,
          familyReading: 'Nb international pro webfont',
          familyConfidence: 'verified',
          renderCheck: 'rendered',
          identity: {
            family: 'NB International Pro',
            subfamily: 'Regular',
            fullName: 'NB International Pro Regular',
            postscriptName: 'NBInternationalPro-Regular',
            designer: null,
            manufacturer: 'Neubau Berlin',
            version: '1.004',
            license: 'Licensed for web use.',
            licenseUrl: 'https://example.invalid/eula',
            axes: [{ tag: 'wght', name: 'Weight', min: 100, max: 900, default: 400 }],
            container: 'woff2',
            fileSize: 49152,
            evidence: 'name-table',
            url: 'https://cdn.example.invalid/nb.woff2',
          },
        },
      }),
    );

    expect(identified).toContain(
      "- Font reading: NB International Pro Regular by Neubau Berlin (declared as 'Nb international pro webfont'), self-hosted (verified)",
    );
    expect(identified).toContain('- Font version: 1.004');
    expect(identified).toContain('- Variable axes: wght 100 to 900');
    expect(identified).toContain('- Font licence: https://example.invalid/eula');
    expect(identified).toContain('- Rendering check: rendered');
  });

  it('gives the measured typography with derived equivalents', () => {
    expect(markdown).toContain('- Size: 72px; equivalent 4.5rem at a 16px root');
    expect(markdown).toContain('- Weight: 600');
    expect(markdown).toContain('- Line height: 75.6px; ratio 1.05');
    expect(markdown).toContain('- Letter spacing: -1.44px; equivalent -0.02em');
    expect(markdown).toContain('- Text color: #0a0a0a, sRGB approximation');
  });

  it('gives the contrast ratio when it is available', () => {
    expect(markdown).toContain('- Contrast: 12.4:1 (derived)');
  });

  it('gives the reason when contrast is unavailable', () => {
    const unavailable = referenceToMarkdown(
      elementReference({
        ...headingSnapshot,
        typography: {
          ...headingSnapshot.typography!,
          contrast: {
            ratio: null,
            status: 'unavailable',
            foreground: null,
            background: null,
            reason: 'gradient background',
          },
        },
      }),
    );
    expect(unavailable).toContain('- Contrast: unavailable (gradient background)');
  });

  it('records the note, or says none was recorded', () => {
    expect(markdown).toContain('Large heading balanced by a narrow text column.');
    expect(referenceToMarkdown(elementReference(headingSnapshot, { note: '   ' }))).toContain(
      'No note recorded.',
    );
  });

  it('replaces an em dash in a user note with a colon', () => {
    const scrubbed = referenceToMarkdown(
      elementReference(headingSnapshot, {
        title: 'Hero — typography',
        note: 'Wide type — quiet palette.',
      }),
    );
    expect(scrubbed).not.toContain('—');
    expect(scrubbed).toContain('# Reference: Hero: typography');
    expect(scrubbed).toContain('Wide type: quiet palette.');
  });

  it('lists assets when the element has them', () => {
    const withAssets = referenceToMarkdown(elementReference(cardSnapshot));
    expect(withAssets).toContain('## Assets');
    expect(withAssets).toContain(
      '- img: https://example.com/media/card.avif (320 x 180 rendered, 1280 x 720 intrinsic)',
    );
  });

  it('omits the assets section when there are none', () => {
    expect(markdown).not.toContain('## Assets');
  });

  it('says so when an element renders no text', () => {
    expect(referenceToMarkdown(elementReference(cardSnapshot))).toContain(
      'This element renders no text.',
    );
  });

  it('closes with the scope disclaimer', () => {
    expect(markdown.trimEnd().endsWith('Responsive rules and other interaction states were not captured.')).toBe(
      true,
    );
  });
});

describe('referenceToMarkdown for a summary', () => {
  const markdown = referenceToMarkdown(summaryReference());

  it('keeps the reference heading and adds the summary sections', () => {
    expect(headings(markdown)).toEqual([
      '# Reference: Example landing page',
      '## Observed styles',
      '## Type scale',
      '## Typography combinations',
      '## Palette clusters',
      '## Palette',
      '## Spacing',
      '## Radii and shadows',
      '## Fonts',
      '## Stack',
      '## My observation',
      '## Scope',
    ]);
  });
});

describe('summaryToMarkdown', () => {
  const markdown = summaryToMarkdown(pageSummary);

  it('uses the page title and the documented section order', () => {
    expect(headings(markdown)).toEqual([
      '# Page summary: Example: a landing page',
      '## Type scale',
      '## Typography combinations',
      '## Palette clusters',
      '## Palette',
      '## Spacing',
      '## Radii and shadows',
      '## Fonts',
      '## Stack',
      '## Scope',
    ]);
  });

  it('states the viewport and the scan scope in the header bullets', () => {
    expect(markdown).toContain('- Viewport: 1440 x 900 CSS px');
    expect(markdown).toContain(
      '- Scan scope: 812 of 1200 eligible elements (cap 5000, capped: no)',
    );
  });

  it('gives the type scale in px and rem with families and counts', () => {
    expect(markdown).toContain('| Size px | rem | Families and weights | Count |');
    expect(markdown).toContain('| 72 | 4.5 | Inter Display 600 | 1 |');
  });

  it('escapes pipe characters inside a table cell', () => {
    expect(markdown).toContain('Ship a design system \\| fast');
  });

  it('leads with the palette clusters, highest total count first', () => {
    const clusters = section(markdown, '## Palette clusters');
    expect(clusters).toContain('| Value | Roles | Total count | Label |');
    expect(clusters).toContain('| #0a0a0a | text | 42 | neutral (inferred) |');
    // The near-white gradient stop reads as the same swatch as the background.
    expect(clusters).toContain('| #ffffff | background, gradient-stop | 34 | neutral (inferred) |');
    expect(clusters).toContain('| #4f46e5 | text | 3 | accent (inferred) |');
    expect(clusters).toContain('| #71717a | stroke | 2 |  |');
    expect(clusters.indexOf('| #0a0a0a |')).toBeLessThan(clusters.indexOf('| #ffffff |'));
    // The flat table still carries every measured row.
    expect(markdown).toContain('| gradient-stop | #f4f4f5 | 1 | 4 |');
  });

  it('leaves the clusters section out of a summary recorded before clusters existed', () => {
    const older = { ...pageSummary };
    delete older.paletteClusters;
    const output = summaryToMarkdown(older);
    expect(output).not.toContain('## Palette clusters');
    expect(output).toContain('## Palette');
  });

  it('groups the palette by role and marks inferred labels', () => {
    const palette = section(markdown, '## Palette');
    expect(palette).toContain('| text | #0a0a0a | 1 | 42 | neutral (inferred) |');
    expect(palette).toContain('| text | #4f46e5 | 1 | 3 | accent (inferred) |');
    expect(palette.indexOf('| background |')).toBeGreaterThan(palette.indexOf('| text |'));
    expect(palette).toContain('| gradient-stop |');
  });

  it('lists spacing as three short lists that keep zero and negatives', () => {
    expect(markdown).toContain('- Padding: 24px (60), 96px (8), 0px (120)');
    expect(markdown).toContain('- Margin: 16px (22), 0px (200), -8px (2)');
    expect(markdown).toContain('- Gap: 32px (9), 48px (4)');
  });

  it('lists radii and shadows', () => {
    expect(markdown).toContain('- Radii: 8px (12), 16px 16px 4px 16px (3)');
    expect(markdown).toContain('- Shadows: rgba(0, 0, 0, 0.06) 0px 1px 2px 0px (7)');
  });

  it('shows an unreadable loaded state as unknown, and an unread font file as not identified', () => {
    const fonts = section(markdown, '## Fonts');
    expect(fonts).toContain(
      '| Inter Display | not identified | yes | yes | yes | self-hosted | 600 | unknown |',
    );
    expect(fonts).toContain(
      '| Inter | not identified | yes | unknown | yes | google | 400, 500 | unknown |',
    );
  });

  it('shows each detection with its version, confidence, and first evidence', () => {
    expect(markdown).toContain('| Next.js 15.2 | framework | high | dom-marker: script#__NEXT_DATA__ |');
    expect(markdown).toContain('| React | framework | likely | dom-marker: implied by Next.js |');
  });

  it('exports the scan scope and counting definitions', () => {
    const scope = section(markdown, '## Scope');
    expect(scope).toContain('- Scanned 812 of 1200 eligible elements in 184.5 ms (cap 5000, capped: no).');
    expect(scope).toContain('- Inaccessible frames: 1. Open shadow roots: 2.');
    expect(scope).toContain('- Skipped 388: not rendered.');
    expect(scope).toContain('- Counts are element and property occurrences, not visual area.');
  });

  it('never writes an em dash', () => {
    expect(markdown).not.toContain('—');
  });

  it('handles an empty summary without inventing values', () => {
    const empty = summaryToMarkdown({
      ...pageSummary,
      typography: [],
      sizeScale: [],
      colors: [],
      spacing: { padding: [], margin: [], gap: [] },
      fonts: [],
      radii: [],
      shadows: [],
      stack: { ...pageSummary.stack, detections: [] },
    });
    expect(empty).toContain('No text-bearing elements were scanned.');
    expect(empty).toContain('No colors were recorded.');
    expect(empty).toContain('- Padding: none recorded');
    expect(empty).toContain('No technologies were detected with sufficient evidence.');
  });
});

function headings(markdown: string): string[] {
  return markdown.split('\n').filter((line) => line.startsWith('#'));
}

function section(markdown: string, heading: string): string {
  // The whole heading line, so '## Palette' does not match '## Palette clusters'.
  const start = markdown.indexOf(`${heading}\n`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}
