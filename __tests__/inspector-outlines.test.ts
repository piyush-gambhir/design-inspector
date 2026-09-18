import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEPTH_HUES,
  DEPTH_LEVELS,
  HOST_EXCLUSION_RULE,
  OUTLINE_STYLE_ATTRIBUTE,
  TAG_GROUPS,
  applyOutlines,
  currentOutlineMode,
  depthColor,
  depthSelector,
  outlineCss,
} from '../lib/inspector/outlines';

const SELECTOR = `style[${OUTLINE_STYLE_ATTRIBUTE}]`;

function sheets(): HTMLStyleElement[] {
  return [...document.querySelectorAll<HTMLStyleElement>(SELECTOR)];
}

function rules(css: string): string[] {
  return css.split('\n').filter((line) => line.trim().length > 0);
}

beforeEach(() => {
  document.querySelectorAll(SELECTOR).forEach((node) => node.remove());
  document.body.innerHTML = '';
});

afterEach(() => {
  document.querySelectorAll(SELECTOR).forEach((node) => node.remove());
});

describe('outlineCss', () => {
  it('writes one rule per tag group plus the host exclusion', () => {
    const css = outlineCss('tag');
    expect(TAG_GROUPS).toHaveLength(8);
    expect(rules(css)).toHaveLength(TAG_GROUPS.length + 1);
    expect(css.endsWith(HOST_EXCLUSION_RULE)).toBe(true);
  });

  it('writes eight depth rules plus the host exclusion', () => {
    const css = outlineCss('depth');
    expect(DEPTH_LEVELS).toBe(8);
    expect(rules(css)).toHaveLength(DEPTH_LEVELS + 1);
    expect(css.endsWith(HOST_EXCLUSION_RULE)).toBe(true);
  });

  it('marks every outline declaration important so focus resets cannot win', () => {
    for (const mode of ['tag', 'depth'] as const) {
      for (const rule of rules(outlineCss(mode))) {
        expect(rule).toContain('!important');
      }
      // Every coloring rule declares both the line and the inward offset.
      for (const rule of rules(outlineCss(mode)).slice(0, -1)) {
        expect(rule).toContain('outline: 1px solid');
        expect(rule).toContain('outline-offset: -1px !important');
      }
    }
  });

  it('never uses border, so turning outlines on cannot move the layout', () => {
    expect(outlineCss('tag')).not.toContain('border');
    expect(outlineCss('depth')).not.toContain('border');
  });

  it('excludes our own overlay host and everything inside it', () => {
    expect(HOST_EXCLUSION_RULE).toBe(
      'design-inspector-host, design-inspector-host * { outline: none !important; }',
    );
    expect(outlineCss('tag')).toContain(HOST_EXCLUSION_RULE);
  });

  it('gives every tag group its own colour and lists the documented tags', () => {
    const colors = new Set(TAG_GROUPS.map((group) => group.color));
    expect(colors.size).toBe(TAG_GROUPS.length);
    const css = outlineCss('tag');
    expect(css).toContain('header, nav, main, section, article, aside, footer {');
    expect(css).toContain('div {');
    expect(css).toContain('img, picture, svg, video, canvas, iframe {');
    expect(css).toContain('table, thead, tbody, tr, td, th {');
  });

  it('gives every depth level its own hue and keeps neighbours far apart', () => {
    expect(DEPTH_HUES).toHaveLength(DEPTH_LEVELS);
    const colors = new Set(
      Array.from({ length: DEPTH_LEVELS }, (_unused, level) => depthColor(level)),
    );
    expect(colors.size).toBe(DEPTH_LEVELS);

    // Evenly spread: the eight hues are the eight 45 degree steps of the wheel.
    expect([...DEPTH_HUES].sort((a, b) => a - b)).toEqual([
      30, 75, 120, 165, 210, 255, 300, 345,
    ]);
    // Adjacent levels jump across the wheel instead of walking it: the old ramp
    // put blue, pink and purple side by side and they read as the same line.
    const steps: number[] = [];
    for (let level = 1; level < DEPTH_LEVELS; level += 1) {
      const delta = Math.abs((DEPTH_HUES[level] ?? 0) - (DEPTH_HUES[level - 1] ?? 0)) % 360;
      steps.push(Math.min(delta, 360 - delta));
    }
    expect(steps).toEqual([180, 90, 180, 45, 180, 90, 180]);

    // One lightness and one chroma for every level, so only the hue differs.
    expect(depthColor(0)).toBe('oklch(0.62 0.17 255)');
    expect(outlineCss('depth')).toContain('oklch(0.62 0.17 75)');
  });

  it('builds depth selectors structurally, never by writing page attributes', () => {
    expect(depthSelector(0)).toBe('body > *');
    expect(depthSelector(1)).toBe('body > * > *');
    expect(depthSelector(DEPTH_LEVELS - 1)).toBe(
      'body > * > * > * > * > * > * > * > *, body > * > * > * > * > * > * > * > * *',
    );
    const css = outlineCss('depth');
    expect(css).not.toContain('data-di-depth');
    for (let level = 0; level < DEPTH_LEVELS; level += 1) {
      expect(css).toContain(depthSelector(level));
    }
  });
});

describe('applyOutlines', () => {
  it('installs one sheet as the last child of head', () => {
    expect(applyOutlines('tag')).toBe('tag');
    const installed = sheets();
    expect(installed).toHaveLength(1);
    expect(installed[0]?.parentElement).toBe(document.head);
    expect(document.head.lastElementChild).toBe(installed[0]);
    expect(installed[0]?.textContent).toBe(outlineCss('tag'));
    expect(currentOutlineMode()).toBe('tag');
  });

  it('is idempotent: re-applying the same coloring reuses the element', () => {
    applyOutlines('tag');
    const first = sheets()[0];
    applyOutlines('tag');
    applyOutlines('tag');
    expect(sheets()).toHaveLength(1);
    expect(sheets()[0]).toBe(first);
  });

  it('replaces the sheet in place when the coloring changes', () => {
    applyOutlines('tag');
    const first = sheets()[0];
    applyOutlines('depth');
    expect(sheets()).toHaveLength(1);
    expect(sheets()[0]).toBe(first);
    expect(sheets()[0]?.textContent).toBe(outlineCss('depth'));
    expect(currentOutlineMode()).toBe('depth');
  });

  it('stays last in head when the page appends a stylesheet afterwards', () => {
    applyOutlines('tag');
    document.head.appendChild(document.createElement('style'));
    applyOutlines('tag');
    expect(document.head.lastElementChild).toBe(sheets()[0]);
  });

  it('removes the element for off and reports off when nothing is installed', () => {
    applyOutlines('depth');
    expect(applyOutlines('off')).toBe('off');
    expect(sheets()).toHaveLength(0);
    expect(currentOutlineMode()).toBe('off');
    // Off on an already clean document is not an error.
    expect(applyOutlines('off')).toBe('off');
  });

  it('ignores a stray value on the marker attribute', () => {
    applyOutlines('tag');
    sheets()[0]?.setAttribute(OUTLINE_STYLE_ATTRIBUTE, 'rainbow');
    expect(currentOutlineMode()).toBe('off');
  });
});
