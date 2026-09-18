import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ColorValue } from '@/lib/contracts';
import {
  ColorValueLabel,
  ConfidenceBadge,
  CopyButton,
  EmptyState,
  Kbd,
  Pill,
  Segmented,
  StatusPill,
  Swatch,
} from '@/lib/ui/shared/components';
import { formatCapturedAt, formatViewport } from '@/lib/ui/shared/format';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: (() => void)[] = [];

async function render(node: ReactNode): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  mounted.push(() => {
    void act(() => {
      root.unmount();
    });
    container.remove();
  });
  return container;
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.();
});

function color(overrides: Partial<ColorValue> = {}): ColorValue {
  return {
    raw: 'rgb(10, 10, 10)',
    hex: '#0A0A0A',
    rgb: 'rgb(10, 10, 10)',
    oklch: 'oklch(0.18 0 0)',
    alpha: 1,
    lossy: false,
    ...overrides,
  };
}

describe('Swatch', () => {
  it('shows the color as a style and repeats the value as text', async () => {
    const container = await render(<Swatch color={color()} />);
    const swatch = container.querySelector('span');
    expect(swatch?.getAttribute('title')).toBe('#0A0A0A');
    expect(container.textContent).toContain('#0A0A0A');
  });

  it('uses the raw value when no hex conversion exists', async () => {
    const container = await render(
      <Swatch color={color({ hex: null, raw: 'color(display-p3 1 0 0)' })} />,
    );
    expect(container.textContent).toContain('color(display-p3 1 0 0)');
  });

  it('keeps a checkerboard underlay so alpha is visible', async () => {
    const container = await render(<Swatch color={color({ alpha: 0.4 })} />);
    expect(container.querySelector('.checkerboard')).not.toBeNull();
  });
});

describe('ColorValueLabel', () => {
  it('states alpha as text rather than by appearance alone', async () => {
    const container = await render(<ColorValueLabel color={color({ alpha: 0.5 })} />);
    expect(container.textContent).toContain('alpha 0.50');
  });

  it('flags a lossy conversion', async () => {
    const container = await render(<ColorValueLabel color={color({ lossy: true })} />);
    expect(container.textContent).toContain('converted');
  });
});

describe('ConfidenceBadge', () => {
  it('labels font confidence', async () => {
    expect((await render(<ConfidenceBadge confidence="declared" />)).textContent).toBe('Declared');
    expect((await render(<ConfidenceBadge confidence="matched" />)).textContent).toBe('Matched');
    expect((await render(<ConfidenceBadge confidence="verified" />)).textContent).toBe('Verified');
  });

  it('labels stack confidence', async () => {
    expect((await render(<ConfidenceBadge confidence="high" />)).textContent).toBe('High');
    expect((await render(<ConfidenceBadge confidence="likely" />)).textContent).toBe('Likely');
  });
});

describe('CopyButton', () => {
  it('writes to the clipboard and confirms in text', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const container = await render(<CopyButton value="h1 { font-size: 72px }" />);
    const button = container.querySelector('button');
    expect(button?.textContent).toContain('Copy');
    await act(async () => {
      button?.click();
    });
    expect(writeText).toHaveBeenCalledWith('h1 { font-size: 72px }');
    expect(button?.textContent).toContain('Copied');
  });

  it('reports a clipboard failure instead of claiming success', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Document is not focused');
        },
      },
    });
    const onCopied = vi.fn();
    const container = await render(<CopyButton value="x" onCopied={onCopied} />);
    await act(async () => {
      container.querySelector('button')?.click();
    });
    expect(onCopied).toHaveBeenCalledWith('Document is not focused');
    expect(container.textContent).not.toContain('Copied');
  });
});

describe('EmptyState', () => {
  it('renders its title, body, and action', async () => {
    const container = await render(
      <EmptyState title="No page summary yet" body="Scanning reads the current state." action={<button type="button">Scan</button>} />,
    );
    expect(container.textContent).toContain('No page summary yet');
    expect(container.textContent).toContain('Scanning reads the current state.');
    expect(container.querySelector('button')?.textContent).toBe('Scan');
  });
});

describe('reading formats', () => {
  it('writes a capture time as local date and time', () => {
    const iso = new Date(2026, 8, 18, 15, 36).toISOString();
    expect(formatCapturedAt(iso)).toBe('18 Sep 2026, 15:36');
  });

  it('pads the clock and never abbreviates the month to four letters', () => {
    expect(formatCapturedAt(new Date(2026, 0, 3, 9, 5).toISOString())).toBe('3 Jan 2026, 09:05');
  });

  it('hands back an unparseable timestamp rather than inventing one', () => {
    expect(formatCapturedAt('not a date')).toBe('not a date');
  });

  it('writes a viewport as width, height and ratio', () => {
    expect(formatViewport({ width: 1126, height: 853, devicePixelRatio: 2 })).toBe(
      '1126 x 853 at 2x',
    );
    expect(formatViewport({ width: 390, height: 844, devicePixelRatio: 1.5 })).toBe(
      '390 x 844 at 1.5x',
    );
  });
});

describe('StatusPill', () => {
  it('says the state in one word', async () => {
    expect((await render(<StatusPill mode="active" />)).textContent).toBe('Inspecting');
    expect((await render(<StatusPill mode="off" />)).textContent).toBe('Off');
    expect((await render(<StatusPill mode={null} />)).textContent).toBe('Checking');
  });
});

describe('Kbd', () => {
  it('gives every key its own chip', async () => {
    const container = await render(<Kbd keys="Alt+Shift+I" />);
    expect([...container.querySelectorAll('kbd')].map(node => node.textContent)).toEqual([
      'Alt',
      'Shift',
      'I',
    ]);
  });

  it('splits a run of macOS glyphs that arrives as one string', async () => {
    const container = await render(<Kbd keys={'\u2325\u21e7I'} />);
    expect([...container.querySelectorAll('kbd')].map(node => node.textContent)).toEqual([
      '\u2325',
      '\u21e7',
      'I',
    ]);
  });
});

describe('Segmented', () => {
  it('marks the selected segment and reports a choice', async () => {
    const chosen: string[] = [];
    const container = await render(
      <Segmented
        label="Theme"
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
        ]}
        value="system"
        onSelect={value => chosen.push(value)}
      />,
    );
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    await act(async () => {
      buttons[1]?.click();
    });
    expect(chosen).toEqual(['light']);
  });

  it('never fills a selected segment with the accent', async () => {
    const container = await render(
      <Segmented
        label="Theme"
        options={[{ value: 'system', label: 'System' }]}
        value="system"
        onSelect={() => undefined}
      />,
    );
    const selected = container.querySelector('button');
    expect(selected?.className).toContain('bg-selected-surface');
    expect(selected?.className).not.toContain('bg-primary');
  });
});

describe('Pill', () => {
  it('tints rather than fills when it is on', async () => {
    const container = await render(<Pill selected>Text</Pill>);
    const pill = container.querySelector('button');
    expect(pill?.getAttribute('aria-pressed')).toBe('true');
    expect(pill?.className).toContain('bg-accent-quiet');
    expect(pill?.className).not.toContain('bg-primary');
  });
});
