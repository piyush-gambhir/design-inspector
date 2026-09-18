import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildLocator,
  classList,
  collectAncestors,
  describeElement,
  hasOwnText,
  isGeneratedClass,
  labelOf,
  roleOf,
  textSample,
} from '../lib/readings/locator';

function pick(selector: string): Element {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`fixture is missing ${selector}`);
  return element;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('isGeneratedClass', () => {
  it('rejects hashed and framework prefixed names', () => {
    expect(isGeneratedClass('css-1q2w3e')).toBe(true);
    expect(isGeneratedClass('sc-AxjAm')).toBe(true);
    expect(isGeneratedClass('_heroTitle_1a2b3')).toBe(true);
    expect(isGeneratedClass('jsx-2914193755')).toBe(true);
    expect(isGeneratedClass('Button_root__2xk9Fq')).toBe(true);
    expect(isGeneratedClass('a1b2c3')).toBe(true);
    expect(isGeneratedClass('')).toBe(true);
  });

  it('rejects case-salad hashes that carry no digits', () => {
    expect(isGeneratedClass('cVAQDa')).toBe(true);
    expect(isGeneratedClass('MwJdiW_root')).toBe(true);
    expect(isGeneratedClass('Primer_Brand__Hero-module__Hero___It6gj')).toBe(true);
    expect(isGeneratedClass('Hero-module_title')).toBe(true);
  });

  it('accepts authored names, including utility classes with digits', () => {
    expect(isGeneratedClass('heroTitle')).toBe(false);
    expect(isGeneratedClass('HeroSection')).toBe(false);
    expect(isGeneratedClass('hero')).toBe(false);
    expect(isGeneratedClass('hero-title')).toBe(false);
    expect(isGeneratedClass('text-2xl')).toBe(false);
    expect(isGeneratedClass('grid-cols-12')).toBe(false);
    expect(isGeneratedClass('col-md-6')).toBe(false);
  });
});

describe('labelOf', () => {
  it('falls back to the tag plus a short text sample', () => {
    document.body.innerHTML = '<h1>Design that reads clearly</h1>';
    expect(labelOf(pick('h1'))).toBe('h1 "Design that…"');
  });

  it('uses the tag alone when the element carries no text of its own', () => {
    document.body.innerHTML = '<div><p>Inside</p></div>';
    expect(labelOf(pick('div'))).toBe('div');
  });

  it('never labels an element with a hashed class name', () => {
    document.body.innerHTML = `
      <h1 class="cVAQDa">Design that reads clearly</h1>
      <div class="MwJdiW_root"></div>
      <section class="Primer_Brand__Hero-module__Hero___It6gj"></section>
      <p class="Button_root__2xk9Fq">Copy</p>`;
    expect(labelOf(pick('h1'))).toBe('h1 "Design that…"');
    expect(labelOf(pick('div'))).toBe('div');
    expect(labelOf(pick('section'))).toBe('section');
    expect(labelOf(pick('p'))).toBe('p "Copy"');
  });

  it('uses a role the tag does not already imply, before aria-label', () => {
    document.body.innerHTML =
      '<div role="tablist" aria-label="Views"></div><h2 role="heading">Title</h2>';
    expect(labelOf(pick('div'))).toBe('div[role="tablist"]');
    // `heading` is what an h2 already is, so it adds nothing.
    expect(labelOf(pick('h2'))).toBe('h2 "Title"');
  });

  it('uses an authored id', () => {
    document.body.innerHTML = '<section id="hero"></section>';
    expect(labelOf(pick('section'))).toBe('section#hero');
  });

  it('uses the accessible text of a control', () => {
    document.body.innerHTML = '<button>Get started</button>';
    expect(labelOf(pick('button'))).toBe('button "Get started"');
  });

  it('uses aria-label', () => {
    document.body.innerHTML = '<nav aria-label="Main"></nav>';
    expect(labelOf(pick('nav'))).toBe('nav[aria-label="Main"]');
  });

  it('never uses a generated class name', () => {
    document.body.innerHTML = '<div class="css-1q2w3e sc-AxjAm"></div>';
    expect(labelOf(pick('div'))).toBe('div');
  });

  it('uses an authored class when nothing better exists', () => {
    document.body.innerHTML = '<div class="css-1q2w3e card"></div>';
    expect(labelOf(pick('div'))).toBe('div.card');
  });

  it('does not anchor on a generated id', () => {
    document.body.innerHTML = '<div id="_next_a1b2c3" class="shell"></div>';
    expect(labelOf(pick('div'))).toBe('div.shell');
  });

  it('uses alt text for an image', () => {
    document.body.innerHTML = '<img alt="Team photo" />';
    expect(labelOf(pick('img'))).toBe('img "Team photo"');
  });
});

describe('roleOf', () => {
  it('prefers an explicit role', () => {
    document.body.innerHTML = '<div role="tablist button"></div>';
    expect(roleOf(pick('div'))).toBe('tablist');
  });

  it('implies landmark roles', () => {
    document.body.innerHTML =
      '<nav></nav><main></main><header></header><footer></footer><aside></aside>';
    expect(roleOf(pick('nav'))).toBe('navigation');
    expect(roleOf(pick('main'))).toBe('main');
    expect(roleOf(pick('header'))).toBe('banner');
    expect(roleOf(pick('footer'))).toBe('contentinfo');
    expect(roleOf(pick('aside'))).toBe('complementary');
  });

  it('only calls a section a region when it is named', () => {
    document.body.innerHTML = '<section id="a"></section><section id="b" aria-label="Work"></section>';
    expect(roleOf(pick('#a'))).toBeNull();
    expect(roleOf(pick('#b'))).toBe('region');
  });

  it('only calls an anchor a link when it has an href', () => {
    document.body.innerHTML = '<a id="a"></a><a id="b" href="#x"></a>';
    expect(roleOf(pick('#a'))).toBeNull();
    expect(roleOf(pick('#b'))).toBe('link');
  });

  it('maps input types', () => {
    document.body.innerHTML =
      '<input id="t" /><input id="c" type="checkbox" /><input id="s" type="submit" /><input id="h" type="hidden" />';
    expect(roleOf(pick('#t'))).toBe('textbox');
    expect(roleOf(pick('#c'))).toBe('checkbox');
    expect(roleOf(pick('#s'))).toBe('button');
    expect(roleOf(pick('#h'))).toBeNull();
  });
});

describe('hasOwnText', () => {
  it('is true only for a direct non whitespace text node', () => {
    document.body.innerHTML = '<div id="wrap">   <p id="text">Hello</p>   </div>';
    expect(hasOwnText(pick('#text'))).toBe(true);
    expect(hasOwnText(pick('#wrap'))).toBe(false);
  });
});

describe('textSample', () => {
  it('collapses whitespace and caps the length', () => {
    document.body.innerHTML = '<p>  Hello\n   world  </p>';
    expect(textSample(pick('p'))).toBe('Hello world');
    document.body.innerHTML = `<p>${'x'.repeat(200)}</p>`;
    expect((textSample(pick('p')) as string).length).toBe(80);
  });

  it('returns null when there is no text', () => {
    document.body.innerHTML = '<p>   </p>';
    expect(textSample(pick('p'))).toBeNull();
  });
});

describe('buildLocator', () => {
  it('prefers a unique id', () => {
    document.body.innerHTML = '<section id="hero"><h1 id="hero-heading">Hi</h1></section>';
    expect(buildLocator(pick('#hero-heading'))).toBe('#hero-heading');
  });

  it('builds an nth-of-type chain from the nearest id', () => {
    document.body.innerHTML =
      '<section id="hero"><div><p>one</p><p class="target">two</p></div></section>';
    expect(buildLocator(pick('.target'))).toBe('#hero > div:nth-of-type(1) > p:nth-of-type(2)');
  });

  it('falls back to body when no ancestor has an id', () => {
    document.body.innerHTML = '<div><span>a</span><span class="x">b</span></div>';
    expect(buildLocator(pick('.x'))).toBe('body > div:nth-of-type(1) > span:nth-of-type(2)');
  });

  it('resolves back to the element it describes', () => {
    document.body.innerHTML = '<main><ul><li>a</li><li>b</li><li class="c">c</li></ul></main>';
    const target = pick('.c');
    expect(document.querySelector(buildLocator(target))).toBe(target);
  });
});

describe('describeElement', () => {
  it('collects the descriptor fields', () => {
    document.body.innerHTML =
      '<button id="cta" class="btn css-1q2w3e" role="button">Get started</button>';
    const descriptor = describeElement(pick('#cta'));
    expect(descriptor).toMatchObject({
      tag: 'button',
      id: 'cta',
      role: 'button',
      label: 'button#cta',
      textSample: 'Get started',
      locator: '#cta',
    });
    expect(descriptor.classes).toEqual(['btn', 'css-1q2w3e']);
    expect(classList(pick('#cta'))).toEqual(['btn', 'css-1q2w3e']);
  });
});

describe('collectAncestors', () => {
  it('walks up to body and stops there', () => {
    document.body.innerHTML = '<main><section id="hero"><h1 id="t">Hi</h1></section></main>';
    const labels = collectAncestors(pick('#t')).map((entry) => entry.descriptor.label);
    expect(labels).toEqual(['section#hero', 'main', 'body']);
  });

  it('marks a wrapper with the same box as its only child as redundant', () => {
    document.body.innerHTML = '<main><div id="wrap"><p id="t">Hi</p></div></main>';
    const boxes = new Map<string, { x: number; y: number; width: number; height: number }>([
      ['wrap', { x: 0, y: 0, width: 100, height: 20 }],
      ['t', { x: 0, y: 0, width: 100, height: 20 }],
    ]);
    const entries = collectAncestors(pick('#t'), (element) => {
      const id = element.getAttribute('id') ?? '';
      return boxes.get(id) ?? { x: 0, y: 0, width: 999, height: 999 };
    });
    const wrap = entries.find((entry) => entry.descriptor.label === 'div#wrap');
    expect(wrap?.redundant).toBe(true);
    expect(entries.find((entry) => entry.descriptor.label === 'main')?.redundant).toBe(false);
  });
});
