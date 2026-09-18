import { beforeEach, describe, expect, it } from 'vitest';

import {
  INLINE_WRAPPERS,
  SEMANTIC_PARENTS,
  TILE_AREA_RATIO,
  hasOtherBlockChildren,
  headingInsideTile,
  isBlockLevelDisplay,
  isInlineDisplay,
  isInlineWrapper,
  resolveSelection,
  semanticParentOf,
  type Box,
  type BoxOf,
  type DisplayOf,
} from '../lib/inspector/semantic';

beforeEach(() => {
  document.body.innerHTML = '';
});

/**
 * A stand-in for `getComputedStyle().display`, keyed by id. Anything not named
 * falls back to the tag's usual box, which is what the real rule reads.
 */
function displays(map: Record<string, string>): DisplayOf {
  return (element) => {
    const id = element.id;
    if (id && map[id]) return map[id] as string;
    const tag = element.tagName.toLowerCase();
    if (INLINE_WRAPPERS.includes(tag)) return 'inline';
    if (tag === 'label') return 'inline';
    if (tag === 'button') return 'inline-block';
    if (tag === 'li') return 'list-item';
    if (tag === 'td' || tag === 'th') return 'table-cell';
    return 'block';
  };
}

const plain = displays({});

describe('display predicates', () => {
  it('treats only a plain inline box as inline', () => {
    expect(isInlineDisplay('inline')).toBe(true);
    expect(isInlineDisplay('inline-block')).toBe(false);
    expect(isInlineDisplay('block')).toBe(false);
    expect(isInlineDisplay('')).toBe(false);
  });

  it('counts anything laid out as a block as a block-level sibling', () => {
    expect(isBlockLevelDisplay('block')).toBe(true);
    expect(isBlockLevelDisplay('flex')).toBe(true);
    expect(isBlockLevelDisplay('grid')).toBe(true);
    expect(isBlockLevelDisplay('list-item')).toBe(true);
    expect(isBlockLevelDisplay('table-cell')).toBe(true);
  });

  it('does not count inline boxes, contents, none, or an unreadable display', () => {
    expect(isBlockLevelDisplay('inline')).toBe(false);
    expect(isBlockLevelDisplay('inline-block')).toBe(false);
    expect(isBlockLevelDisplay('inline-flex')).toBe(false);
    expect(isBlockLevelDisplay('contents')).toBe(false);
    expect(isBlockLevelDisplay('none')).toBe(false);
    expect(isBlockLevelDisplay('')).toBe(false);
  });
});

describe('isInlineWrapper', () => {
  it('accepts the listed wrapper tags whatever they are laid out as', () => {
    document.body.innerHTML = INLINE_WRAPPERS.filter((tag) => tag !== 'a')
      .map((tag) => `<${tag} id="${tag}">x</${tag}>`)
      .join('');
    for (const tag of INLINE_WRAPPERS) {
      if (tag === 'a') continue;
      const element = document.getElementById(tag) as Element;
      // Even a wrapper the page has turned into a block is still a wrapper.
      expect(isInlineWrapper(element, displays({ [tag]: 'block' }))).toBe(true);
    }
  });

  it('accepts any element whose computed display is inline', () => {
    document.body.innerHTML = '<div id="bare">Words</div>';
    const bare = document.getElementById('bare') as Element;
    expect(isInlineWrapper(bare, displays({ bare: 'inline' }))).toBe(true);
    expect(isInlineWrapper(bare, displays({ bare: 'block' }))).toBe(false);
  });

  it('treats a link as a wrapper only when it has no href', () => {
    document.body.innerHTML = '<a id="bare">Bare</a><a id="linked" href="#x">Linked</a>';
    expect(isInlineWrapper(document.getElementById('bare') as Element, plain)).toBe(true);
    expect(isInlineWrapper(document.getElementById('linked') as Element, plain)).toBe(false);
  });

  it('never treats a promotable element as a transparent wrapper', () => {
    document.body.innerHTML = '<label id="field">Email</label><h2 id="head">Title</h2>';
    // A label is an inline box, and its identity is exactly the answer.
    expect(isInlineWrapper(document.getElementById('field') as Element, plain)).toBe(false);
    expect(isInlineWrapper(document.getElementById('head') as Element, plain)).toBe(false);
    expect(SEMANTIC_PARENTS).toContain('label');
  });
});

describe('semanticParentOf', () => {
  it('promotes the Wikipedia shape: h1 > span', () => {
    document.body.innerHTML = '<h1 id="head"><span id="text">Design Inspector</span></h1>';
    const span = document.getElementById('text') as Element;
    expect(semanticParentOf(span, plain)?.id).toBe('head');
  });

  it('promotes the Stripe shape: h1 > em', () => {
    document.body.innerHTML = '<h1 id="head"><em id="text">Payments</em></h1>';
    expect(semanticParentOf(document.getElementById('text') as Element, plain)?.id).toBe('head');
  });

  it('promotes the Linear shape: h1 > span > span, however deep', () => {
    document.body.innerHTML =
      '<h1 id="head"><span id="outer"><span id="inner">Plan and build</span></span></h1>';
    expect(semanticParentOf(document.getElementById('inner') as Element, plain)?.id).toBe('head');
    expect(semanticParentOf(document.getElementById('outer') as Element, plain)?.id).toBe('head');
  });

  it('promotes even when the wrapper does not paint the heading box', () => {
    // The box rule this replaced refused exactly this: a heading is as wide as
    // its container and its inline wrapper is only as wide as the glyphs.
    document.body.innerHTML = '<h2 id="head"><span id="text">Short</span></h2>';
    const span = document.getElementById('text') as Element;
    // The wrapper is a block here, which the old same-box rule also refused.
    expect(semanticParentOf(span, displays({ text: 'block' }))?.id).toBe('head');
  });

  it('promotes to every listed parent and to nothing else', () => {
    // Built by hand: the parser drops a `<td>` that is not inside a table, and
    // a bare `<a>` would be read as a wrapper rather than as the parent.
    const build = (tag: string): Element => {
      document.body.innerHTML = '';
      const parent = document.createElement(tag);
      parent.id = 'parent';
      const span = document.createElement('span');
      span.id = 'text';
      span.textContent = 'x';
      parent.appendChild(span);
      document.body.appendChild(parent);
      return span;
    };

    for (const tag of SEMANTIC_PARENTS) {
      const span = build(tag);
      expect(semanticParentOf(span, displays({ parent: 'block' }))?.id).toBe('parent');
    }
    expect(semanticParentOf(build('div'), displays({ parent: 'block' }))).toBeNull();
  });

  it('refuses a span in a div that also holds two paragraphs', () => {
    document.body.innerHTML =
      '<div id="wrap"><p id="one">One</p><p id="two">Two</p><span id="text">Loose</span></div>';
    expect(semanticParentOf(document.getElementById('text') as Element, plain)).toBeNull();
  });

  it('refuses a promotable parent that holds a block child of its own', () => {
    document.body.innerHTML =
      '<li id="item"><div id="panel">A block</div><span id="text">Label</span></li>';
    expect(semanticParentOf(document.getElementById('text') as Element, plain)).toBeNull();
  });

  it('ignores inline siblings, which are part of the same line of text', () => {
    document.body.innerHTML =
      '<p id="para"><strong id="lead">Note</strong><span id="text">the rest</span></p>';
    expect(semanticParentOf(document.getElementById('text') as Element, plain)?.id).toBe('para');
  });

  it('refuses a click that did not land on a wrapper at all', () => {
    document.body.innerHTML = '<h2 id="head">Plain heading</h2>';
    expect(semanticParentOf(document.getElementById('head') as Element, plain)).toBeNull();
  });

  it('refuses a link, because a destination is a real target', () => {
    document.body.innerHTML = '<h2 id="head"><a id="link" href="#x">Go</a></h2>';
    expect(semanticParentOf(document.getElementById('link') as Element, plain)).toBeNull();
  });

  it('refuses an orphan with no parent to promote to', () => {
    const orphan = document.createElement('span');
    expect(semanticParentOf(orphan, plain)).toBeNull();
  });

  it('refuses rather than throwing when the display cannot be read', () => {
    document.body.innerHTML = '<h2 id="head"><span id="text">Words</span></h2>';
    expect(
      semanticParentOf(document.getElementById('text') as Element, () => {
        throw new Error('detached');
      }),
    ).toBeNull();
  });
});

describe('hasOtherBlockChildren', () => {
  it('skips the child the walk came up through', () => {
    document.body.innerHTML = '<h2 id="head"><span id="text">Words</span></h2>';
    const head = document.getElementById('head') as Element;
    const text = document.getElementById('text') as Element;
    expect(hasOtherBlockChildren(head, text, displays({ text: 'block' }))).toBe(false);
  });

  it('reports a block sibling of that child', () => {
    document.body.innerHTML = '<li id="item"><div id="panel">Block</div><span id="text">x</span></li>';
    const item = document.getElementById('item') as Element;
    const text = document.getElementById('text') as Element;
    expect(hasOtherBlockChildren(item, text, plain)).toBe(true);
  });
});

describe('resolveSelection', () => {
  it('returns the parent and the wrapper it came from', () => {
    document.body.innerHTML = '<h2 id="head"><span id="text">Words</span></h2>';
    const span = document.getElementById('text') as Element;
    const resolved = resolveSelection(span, true, plain);
    expect(resolved.target.id).toBe('head');
    expect(resolved.wrapper?.id).toBe('text');
  });

  it('selects exactly what was clicked when the preference is off', () => {
    document.body.innerHTML = '<h2 id="head"><span id="text">Words</span></h2>';
    const span = document.getElementById('text') as Element;
    const resolved = resolveSelection(span, false, plain);
    expect(resolved.target.id).toBe('text');
    expect(resolved.wrapper).toBeNull();
  });

  it('reports no wrapper when nothing was promoted', () => {
    document.body.innerHTML = '<div id="wrap"><span id="text">Words</span></div>';
    const span = document.getElementById('text') as Element;
    const resolved = resolveSelection(span, true, plain);
    expect(resolved.target.id).toBe('text');
    expect(resolved.wrapper).toBeNull();
  });

  it('selects the heading inside a full-tile link, with no wrapper chip (UX 6)', () => {
    document.body.innerHTML = APPLE_TILE;
    const tile = document.getElementById('tile') as Element;
    const resolved = resolveSelection(tile, true, plain, {
      point: { x: 200, y: 260 },
      viewport: VIEWPORT,
      boxOf: tileBoxes(),
    });
    expect(resolved.target.id).toBe('title');
    // The link is the heading's parent, so the breadcrumb keeps it already.
    expect(resolved.wrapper).toBeNull();
  });

  it('leaves the tile alone when the preference is off', () => {
    document.body.innerHTML = APPLE_TILE;
    const tile = document.getElementById('tile') as Element;
    const resolved = resolveSelection(tile, false, plain, {
      point: { x: 200, y: 260 },
      viewport: VIEWPORT,
      boxOf: tileBoxes(),
    });
    expect(resolved.target.id).toBe('tile');
  });
});

// ---------------------------------------------------------------------------
// Heading inside a full-tile link (tester UX note 6)

const VIEWPORT = { width: 1440, height: 900 };

/** An apple.com style card: one link over the whole tile, heading inside it. */
const APPLE_TILE = `
  <a id="tile" href="/mac">
    <h2 id="title">MacBook Pro</h2>
    <p id="copy">Mind-blowing. Head-turning.</p>
  </a>
`;

/**
 * Boxes for the tile fixture. jsdom reports zero sized rects, so every rule
 * that reads layout gets its geometry injected, exactly as the overlay's own
 * placement tests do.
 */
function tileBoxes(overrides: Record<string, Box> = {}): BoxOf {
  const base: Record<string, Box> = {
    // 1000 x 700 of a 1440 x 900 viewport: 54 percent, well past the ratio.
    tile: { x: 100, y: 100, width: 1000, height: 700 },
    title: { x: 140, y: 240, width: 400, height: 48 },
    copy: { x: 140, y: 320, width: 400, height: 40 },
  };
  return (element) => {
    const box = overrides[element.id] ?? base[element.id];
    return box ?? { x: 0, y: 0, width: 0, height: 0 };
  };
}

describe('headingInsideTile', () => {
  it('returns the one heading the click point is inside', () => {
    document.body.innerHTML = APPLE_TILE;
    const tile = document.getElementById('tile') as Element;
    expect(
      headingInsideTile(tile, {
        point: { x: 200, y: 260 },
        viewport: VIEWPORT,
        boxOf: tileBoxes(),
      })?.id,
    ).toBe('title');
  });

  it('applies to a button the size of a tile as well as a link', () => {
    document.body.innerHTML = APPLE_TILE.replace('<a id="tile" href="/mac">', '<button id="tile">')
      .replace('</a>', '</button>');
    const tile = document.getElementById('tile') as Element;
    expect(
      headingInsideTile(tile, {
        point: { x: 200, y: 260 },
        viewport: VIEWPORT,
        boxOf: tileBoxes(),
      })?.id,
    ).toBe('title');
  });

  it('leaves a small link alone however precisely it was clicked', () => {
    document.body.innerHTML = APPLE_TILE;
    const tile = document.getElementById('tile') as Element;
    // 300 x 200 is 4.6 percent of the viewport: a link, not a tile.
    const boxes = tileBoxes({ tile: { x: 100, y: 100, width: 300, height: 200 } });
    expect(
      headingInsideTile(tile, { point: { x: 200, y: 260 }, viewport: VIEWPORT, boxOf: boxes }),
    ).toBeNull();
  });

  it('leaves a tile alone when the click landed outside every heading', () => {
    document.body.innerHTML = APPLE_TILE;
    const tile = document.getElementById('tile') as Element;
    // Inside the tile, inside the paragraph, nowhere near the heading's box.
    expect(
      headingInsideTile(tile, {
        point: { x: 200, y: 340 },
        viewport: VIEWPORT,
        boxOf: tileBoxes(),
      }),
    ).toBeNull();
  });

  it('refuses when two headings both contain the point', () => {
    document.body.innerHTML = `
      <a id="tile" href="/mac">
        <h2 id="title">MacBook Pro</h2>
        <h3 id="second">Now in space black</h3>
      </a>
    `;
    const tile = document.getElementById('tile') as Element;
    const boxes = tileBoxes({
      // Overlapping boxes, as an absolutely positioned eyebrow produces.
      title: { x: 140, y: 240, width: 400, height: 80 },
      second: { x: 140, y: 250, width: 400, height: 60 },
    });
    expect(
      headingInsideTile(tile, { point: { x: 200, y: 280 }, viewport: VIEWPORT, boxOf: boxes }),
    ).toBeNull();
  });

  it('picks the heading the point is in when a second one is elsewhere', () => {
    document.body.innerHTML = `
      <a id="tile" href="/mac">
        <h2 id="title">MacBook Pro</h2>
        <h3 id="second">Now in space black</h3>
      </a>
    `;
    const tile = document.getElementById('tile') as Element;
    const boxes = tileBoxes({
      title: { x: 140, y: 240, width: 400, height: 48 },
      second: { x: 140, y: 400, width: 400, height: 40 },
    });
    expect(
      headingInsideTile(tile, { point: { x: 200, y: 260 }, viewport: VIEWPORT, boxOf: boxes })?.id,
    ).toBe('title');
  });

  it('does nothing without a click point, on a plain element, or on a zero viewport', () => {
    document.body.innerHTML = APPLE_TILE;
    const tile = document.getElementById('tile') as Element;
    const boxOf = tileBoxes();
    expect(headingInsideTile(tile, { viewport: VIEWPORT, boxOf })).toBeNull();
    expect(
      headingInsideTile(tile, { point: { x: 200, y: 260 }, viewport: { width: 0, height: 0 }, boxOf }),
    ).toBeNull();

    document.body.innerHTML = '<div id="tile"><h2 id="title">Words</h2></div>';
    expect(
      headingInsideTile(document.getElementById('tile') as Element, {
        point: { x: 200, y: 260 },
        viewport: VIEWPORT,
        boxOf,
      }),
    ).toBeNull();
  });

  it('ignores an anchor with no href, which is not a destination', () => {
    document.body.innerHTML = APPLE_TILE.replace('href="/mac"', '');
    const tile = document.getElementById('tile') as Element;
    expect(
      headingInsideTile(tile, {
        point: { x: 200, y: 260 },
        viewport: VIEWPORT,
        boxOf: tileBoxes(),
      }),
    ).toBeNull();
  });

  it('needs more than the stated share of the viewport', () => {
    expect(TILE_AREA_RATIO).toBe(0.4);
    document.body.innerHTML = APPLE_TILE;
    const tile = document.getElementById('tile') as Element;
    const area = VIEWPORT.width * VIEWPORT.height;
    // Exactly at the ratio is not past it.
    const exact = tileBoxes({
      tile: { x: 0, y: 0, width: VIEWPORT.width, height: (area * TILE_AREA_RATIO) / VIEWPORT.width },
    });
    expect(
      headingInsideTile(tile, { point: { x: 200, y: 260 }, viewport: VIEWPORT, boxOf: exact }),
    ).toBeNull();
  });

  it('refuses rather than throwing when a box cannot be read', () => {
    document.body.innerHTML = APPLE_TILE;
    const tile = document.getElementById('tile') as Element;
    expect(
      headingInsideTile(tile, {
        point: { x: 200, y: 260 },
        viewport: VIEWPORT,
        boxOf: () => {
          throw new Error('detached');
        },
      }),
    ).toBeNull();
  });
});
