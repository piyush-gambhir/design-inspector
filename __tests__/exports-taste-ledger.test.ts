import { describe, expect, it } from 'vitest';
import { toTasteLedger } from '@/lib/exports';
import { cardSnapshot, elementReference, headingSnapshot } from './fixtures/snapshots';
import { pageSummary, summaryReference } from './fixtures/summary';

const fragment = toTasteLedger(
  [summaryReference(), elementReference(headingSnapshot)],
  '2026-09-18',
);

describe('toTasteLedger fragment shape', () => {
  it('starts with the dated study heading and the hostname', () => {
    expect(fragment.startsWith('## 2026-09-18: reference study, example.com')).toBe(true);
  });

  it('has the documented subsections in order', () => {
    expect(fragment.split('\n').filter((line) => line.startsWith('###'))).toEqual([
      '### Essence (mine)',
      '### Observed (computed, this viewport)',
      '### Avoid',
      '### Scope',
    ]);
  });

  it('opens with a context paragraph that names the url, date, and viewport', () => {
    expect(fragment).toContain(
      'Studied https://example.com/ on 2026-09-18 at 1440 x 900. Notes are mine; measurements are computed values at that viewport and time, not authored tokens.',
    );
  });

  it('leaves Avoid as an empty bullet for the user to fill', () => {
    expect(fragment).toContain('### Avoid\n\n- \n');
  });

  it('closes with the scope sentences', () => {
    expect(fragment).toContain(
      'Captured at 1440 x 900, root 16px. Responsive rules and interaction states were not captured. Summary covered 812 of 1200 eligible elements (capped: no).',
    );
  });

  it('never writes an em dash', () => {
    const withDashes = toTasteLedger(
      [elementReference(headingSnapshot, { title: 'Hero — type', note: 'Big — quiet.' })],
      '2026-09-18',
    );
    expect(withDashes).not.toContain('—');
    expect(withDashes).toContain('- Hero: type: Big: quiet.');
  });
});

describe('toTasteLedger Essence', () => {
  const essence = section(fragment, '### Essence (mine)');

  it('contains only titles and the user notes', () => {
    expect(essence).toContain('- Example landing page: Wide type contrast, quiet palette.');
    expect(essence).toContain('- Hero typography: Large heading balanced by a narrow text column.');
  });

  it('contains no measured value', () => {
    expect(essence).not.toMatch(/#[0-9a-f]{6}/i);
    expect(essence).not.toMatch(/\d+px/);
    expect(essence).not.toMatch(/\brem\b/);
    expect(essence).not.toContain('high');
  });

  it('says so when a reference has no note', () => {
    const noNote = toTasteLedger([elementReference(headingSnapshot, { note: '' })], '2026-09-18');
    expect(noNote).toContain('- Hero typography: no note recorded.');
  });
});

describe('toTasteLedger Observed', () => {
  const observed = section(fragment, '### Observed (computed, this viewport)');

  it('lists the type scale with family readings and their confidence', () => {
    expect(observed).toContain(
      '- Type scale: 72 / 16 px (Inter Display (matched) 600, Inter (declared) 400).',
    );
  });

  it('reads the palette as clusters, naming the inferred accents by value', () => {
    expect(observed).toContain('- Palette: 6 clusters (accent: #4f46e5; neutrals: 2).');
  });

  it('falls back to the role counts for a summary recorded before clusters existed', () => {
    const older = { ...pageSummary };
    delete older.paletteClusters;
    const output = toTasteLedger([summaryReference({ snapshot: older })], '2026-09-18');
    expect(output).toContain('- Palette by role: text 2 colors');
    expect(output).toContain('accent (inferred) 1.');
  });

  it('lists the recurring spacing values in ascending order', () => {
    expect(observed).toContain('- Spacing rhythm: 16, 24, 32, 48, 96 px recur.');
  });

  it('lists radii and the number of shadow combinations', () => {
    expect(observed).toContain('- Radii: 8px, 16px 16px 4px 16px. Shadows: 1 combination.');
  });

  it('names only detections, never a "not detected" line', () => {
    expect(observed).toContain('- Stack: Next.js 15.2 (high), React (likely).');
    expect(observed).not.toContain('Not detected');
    expect(observed).not.toContain('not detected');
  });

  it('gives one line per saved element with its measurements', () => {
    expect(observed).toContain(
      '- h1 "Build faster": Inter Display (matched) 72px / 4.5rem, 600, lh 1.05, tracking -0.02em, #0a0a0a.',
    );
  });

  it('handles an element with no text reading', () => {
    const cardOnly = toTasteLedger([elementReference(cardSnapshot)], '2026-09-18');
    expect(cardOnly).toContain('- div.card: no text reading, background #ffffff.');
  });

  it('omits the stack line when nothing was detected', () => {
    const quiet = toTasteLedger(
      [
        summaryReference({
          snapshot: { ...pageSummary, stack: { ...pageSummary.stack, detections: [] } },
        }),
      ],
      '2026-09-18',
    );
    expect(quiet).not.toContain('- Stack:');
  });
});

describe('toTasteLedger grouping', () => {
  it('emits one entry per source page', () => {
    const otherSnapshot = {
      ...headingSnapshot,
      source: { ...headingSnapshot.source, url: 'https://other.example.org/pricing' },
    };
    const combined = toTasteLedger(
      [elementReference(headingSnapshot), elementReference(otherSnapshot, { id: 'ref-other' })],
      '2026-09-18',
    );
    const entries = combined.split('\n').filter((line) => line.startsWith('## '));
    expect(entries).toEqual([
      '## 2026-09-18: reference study, example.com',
      '## 2026-09-18: reference study, other.example.org',
    ]);
  });

  it('accepts a full ISO timestamp and keeps only the date', () => {
    expect(
      toTasteLedger([elementReference(headingSnapshot)], '2026-09-18T10:30:00.000Z'),
    ).toContain('## 2026-09-18: reference study, example.com');
  });

  it('returns an empty string for no references', () => {
    expect(toTasteLedger([], '2026-09-18')).toBe('');
  });
});

function section(fragment: string, heading: string): string {
  const start = fragment.indexOf(heading);
  const rest = fragment.slice(start + heading.length);
  const end = rest.indexOf('\n###');
  return end === -1 ? rest : rest.slice(0, end);
}
