import { describe, expect, it } from 'vitest';

import { parseColor } from '../lib/readings/color';
import {
  compositeOver,
  computeContrast,
  contrastAgainstPicked,
  contrastRatio,
  paintedBehind,
  relativeLuminance,
  resolveBackground,
} from '../lib/readings/contrast';

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE_RGB = { r: 255, g: 255, b: 255 };
const WHITE = { r: 255, g: 255, b: 255 };

/** A style reader driven by a per element map, so no layout engine is needed. */
function reader(styles: Map<Element, Record<string, string>>) {
  return (element: Element): CSSStyleDeclaration => {
    const declared = styles.get(element) ?? {};
    const base: Record<string, string> = {
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
      mixBlendMode: 'normal',
      filter: 'none',
      backdropFilter: 'none',
      maskImage: 'none',
      opacity: '1',
      ...declared,
    };
    return {
      ...base,
      getPropertyValue: (property: string) => base[property] ?? '',
    } as unknown as CSSStyleDeclaration;
  };
}

describe('relativeLuminance', () => {
  it('matches the WCAG endpoints', () => {
    expect(relativeLuminance(BLACK)).toBe(0);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
  });
});

describe('contrastRatio', () => {
  it('reports 21 for black on white', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
  });

  it('reports 4.54 for #767676 on white', () => {
    const ratio = contrastRatio({ r: 0x76, g: 0x76, b: 0x76 }, WHITE);
    expect(Math.round(ratio * 100) / 100).toBe(4.54);
  });

  it('is order independent', () => {
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(contrastRatio(BLACK, WHITE), 10);
  });

  it('reports 1 for identical colors', () => {
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 10);
  });
});

describe('compositeOver', () => {
  it('blends half alpha black over white to mid grey', () => {
    expect(compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, WHITE)).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
    });
  });
});

describe('resolveBackground', () => {
  it('composites translucent ancestors onto the first opaque one', () => {
    document.body.innerHTML = '<div id="backdrop"><p id="card">Hello</p></div>';
    const backdrop = document.getElementById('backdrop') as Element;
    const card = document.getElementById('card') as Element;
    const styles = new Map<Element, Record<string, string>>([
      [card, { backgroundColor: 'rgba(255, 255, 255, 0.5)' }],
      [backdrop, { backgroundColor: 'rgb(0, 0, 0)' }],
    ]);

    const resolved = resolveBackground(card, reader(styles));
    expect(resolved.blocker).toBeNull();
    expect(resolved.color).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
  });

  it('treats an unstyled canvas as white and says so', () => {
    document.body.innerHTML = '<p id="plain">Hello</p>';
    const plain = document.getElementById('plain') as Element;
    const resolved = resolveBackground(plain, reader(new Map()));
    expect(resolved.color).toEqual({ r: 255, g: 255, b: 255 });
    expect(resolved.notes.join(' ')).toContain('treated as white');
  });

  it('stops at an image or gradient background', () => {
    document.body.innerHTML = '<section id="hero"><p id="text">Hello</p></section>';
    const hero = document.getElementById('hero') as Element;
    const text = document.getElementById('text') as Element;
    const styles = new Map<Element, Record<string, string>>([
      [hero, { backgroundImage: 'linear-gradient(red, blue)' }],
    ]);
    const resolved = resolveBackground(text, reader(styles));
    expect(resolved.color).toBeNull();
    expect(resolved.blocker).toContain('section#hero');
  });

  it('stops at opacity, blend, filter, backdrop-filter, and mask', () => {
    document.body.innerHTML = '<div id="wrap"><p id="text">Hello</p></div>';
    const wrap = document.getElementById('wrap') as Element;
    const text = document.getElementById('text') as Element;
    const cases: Record<string, string>[] = [
      { opacity: '0.5' },
      { mixBlendMode: 'multiply' },
      { filter: 'blur(2px)' },
      { backdropFilter: 'blur(2px)' },
      { maskImage: 'url(m.svg)' },
    ];
    for (const declared of cases) {
      const styles = new Map<Element, Record<string, string>>([[wrap, declared]]);
      expect(resolveBackground(text, reader(styles)).color).toBeNull();
    }
  });
});

describe('computeContrast', () => {
  it('reports a derived ratio with both composited colors', () => {
    document.body.innerHTML = '<div id="page"><p id="text">Hello</p></div>';
    const page = document.getElementById('page') as Element;
    const text = document.getElementById('text') as Element;
    const styles = new Map<Element, Record<string, string>>([
      [page, { backgroundColor: 'rgb(255, 255, 255)' }],
    ]);

    const reading = computeContrast(text, parseColor('rgb(0, 0, 0)'), reader(styles));
    expect(reading.status).toBe('derived');
    expect(reading.ratio).toBe(21);
    expect(reading.foreground).toBe('#000000');
    expect(reading.background).toBe('#ffffff');
  });

  it('composites translucent text onto its background', () => {
    document.body.innerHTML = '<div id="page"><p id="text">Hello</p></div>';
    const page = document.getElementById('page') as Element;
    const text = document.getElementById('text') as Element;
    const styles = new Map<Element, Record<string, string>>([
      [page, { backgroundColor: 'rgb(255, 255, 255)' }],
    ]);

    const reading = computeContrast(text, parseColor('rgba(0, 0, 0, 0.5)'), reader(styles));
    expect(reading.foreground).toBe('#808080');
    expect(reading.ratio).not.toBeNull();
    expect(reading.ratio as number).toBeLessThan(21);
  });

  it('refuses to invent a ratio over a photographic background', () => {
    document.body.innerHTML = '<div id="photo"><p id="text">Hello</p></div>';
    const photo = document.getElementById('photo') as Element;
    const text = document.getElementById('text') as Element;
    const styles = new Map<Element, Record<string, string>>([
      [photo, { backgroundImage: 'url(hero.jpg)' }],
    ]);

    const reading = computeContrast(text, parseColor('rgb(255, 255, 255)'), reader(styles));
    expect(reading.ratio).toBeNull();
    expect(reading.status).toBe('unavailable');
    expect(reading.reason).toContain('Contrast unavailable for this background.');
    expect(reading.reason).toContain('div#photo');
  });
});

describe('contrastAgainstPicked', () => {
  it('computes the ratio against a picked pixel', () => {
    const result = contrastAgainstPicked(parseColor('rgb(0, 0, 0)'), parseColor('#ffffff'));
    expect(result).not.toBeNull();
    expect(result?.ratio).toBe(21);
    expect(result?.foreground).toBe('#000000');
    expect(result?.background).toBe('#ffffff');
  });

  it('composites translucent text over the picked pixel', () => {
    const result = contrastAgainstPicked(
      parseColor('rgba(0, 0, 0, 0.5)'),
      parseColor('#ffffff'),
    );
    expect(result?.foreground).toBe('#808080');
    expect(result?.background).toBe('#ffffff');
    // The composited channel is 127.5; only the hex display rounds it.
    expect(result?.ratio).toBeCloseTo(
      Math.round(contrastRatio({ r: 127.5, g: 127.5, b: 127.5 }, WHITE_RGB) * 100) / 100,
      2,
    );
  });

  it('treats a translucent picked value as sitting over white', () => {
    const result = contrastAgainstPicked(
      parseColor('rgb(0, 0, 0)'),
      parseColor('rgba(0, 0, 0, 0.5)'),
    );
    expect(result?.background).toBe('#808080');
  });

  it('returns null when either color cannot be read', () => {
    expect(contrastAgainstPicked(parseColor('not-a-color'), parseColor('#ffffff'))).toBeNull();
    expect(contrastAgainstPicked(parseColor('#000000'), parseColor('currentcolor'))).toBeNull();
  });
});


describe('paintedBehind', () => {
  function withStack(stack: Element[], target: Element, run: () => void) {
    const doc = document as Document & { elementsFromPoint?: (x: number, y: number) => Element[] };
    const original = doc.elementsFromPoint;
    doc.elementsFromPoint = () => stack;
    const rect = target.getBoundingClientRect;
    target.getBoundingClientRect = () =>
      ({ left: 10, top: 10, width: 100, height: 20, right: 110, bottom: 30, x: 10, y: 10 }) as DOMRect;
    try {
      run();
    } finally {
      doc.elementsFromPoint = original;
      target.getBoundingClientRect = rect;
    }
  }

  it('refuses a ratio when a sibling video sits behind the text', () => {
    document.body.innerHTML =
      '<section id="hero"><video id="bg"></video><h1 id="text">Hello</h1></section>';
    const hero = document.getElementById('hero') as Element;
    const video = document.getElementById('bg') as Element;
    const text = document.getElementById('text') as Element;
    const styles = new Map<Element, Record<string, string>>([[hero, { backgroundColor: 'rgb(255, 255, 255)' }]]);
    withStack([text, video, hero, document.body], text, () => {
      expect(paintedBehind(text, hero, reader(styles))).toContain('video#bg');
      const reading = computeContrast(text, parseColor('rgb(255, 255, 255)'), reader(styles));
      expect(reading.status).toBe('unavailable');
      expect(reading.ratio).toBeNull();
      expect(reading.reason).toContain('video#bg');
    });
  });

  it('ignores ancestors, descendants, and anything under the opaque base', () => {
    document.body.innerHTML =
      '<div id="under"><img id="deep"></div><section id="hero"><h1 id="text"><span id="inner">Hello</span></h1></section>';
    const hero = document.getElementById('hero') as Element;
    const text = document.getElementById('text') as Element;
    const inner = document.getElementById('inner') as Element;
    const deep = document.getElementById('deep') as Element;
    const styles = new Map<Element, Record<string, string>>([[hero, { backgroundColor: 'rgb(0, 0, 0)' }]]);
    withStack([inner, text, hero, deep, document.body], text, () => {
      expect(paintedBehind(text, hero, reader(styles))).toBeNull();
      const reading = computeContrast(text, parseColor('rgb(255, 255, 255)'), reader(styles));
      expect(reading.status).toBe('derived');
      expect(reading.ratio).toBe(21);
    });
  });

  it('finds media inside a transparent non-ancestor wrapper that covers the point', () => {
    document.body.innerHTML =
      '<section id="hero"><div id="wrap"><video id="bg"></video></div><h1 id="text">Hello</h1></section>';
    const hero = document.getElementById('hero') as Element;
    const wrap = document.getElementById('wrap') as Element;
    const video = document.getElementById('bg') as Element;
    const text = document.getElementById('text') as Element;
    video.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0 }) as DOMRect;
    withStack([text, wrap, hero, document.body], text, () => {
      expect(paintedBehind(text, hero, reader(new Map()))).toContain('video#bg');
    });
  });

  it('flags a non-ancestor with an image or opaque background behind the text', () => {
    document.body.innerHTML = '<div id="art"></div><p id="text">Hello</p>';
    const art = document.getElementById('art') as Element;
    const text = document.getElementById('text') as Element;
    const styles = new Map<Element, Record<string, string>>([[art, { backgroundImage: 'url(a.png)' }]]);
    withStack([text, art, document.body], text, () => {
      expect(paintedBehind(text, null, reader(styles))).toContain('div#art');
    });
  });
});
