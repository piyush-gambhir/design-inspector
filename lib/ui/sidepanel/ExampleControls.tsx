// Traceability controls for a summary group (PRD SUM-06).
//
// "Show on page" highlights up to MAX_HIGHLIGHTS examples at once; Previous and
// Next step through them one at a time; Select opens the element's inspector.
//
// On a long page every row carrying these controls turns the summary into a
// wall of buttons, so `reveal` keeps them transparent until the row is hovered
// or something inside it takes focus. They stay in the DOM and in the tab
// order: focus-within makes them visible the moment a keyboard reaches them.
//
// The row group is named `row` on purpose: Collapsible carries an unnamed
// `group` for its own chevron, and an unnamed group-hover here would match that
// ancestor and reveal every row in an open section at once.
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Crosshair, MoveVertical } from 'lucide-react';
import type { ExampleRef } from '@/lib/contracts';
import { sendToBackground } from '@/lib/messages';
import { cn } from '@/components/cn';
import { Button } from '@/components/ui';
import { StatusLine } from '@/lib/ui/shared/components';

export const MAX_HIGHLIGHTS = 20;

/** The message shown when the page has scrolled the example out of view. */
export const OFFSCREEN_NOTICE = 'Scroll to the element on the page and try again.';

/**
 * The message for an example the page has since removed. The summary is a
 * snapshot, so a live page can outrun it; refreshing is the only honest fix
 * and the rest of the summary stays usable (PRD 19.3).
 */
export const REMOVED_NOTICE =
  'That element is no longer on the page. Refresh the summary, or pick another example.';

function isOffscreen(error: string): boolean {
  return /offscreen/i.test(error);
}

function isRemoved(error: string): boolean {
  return /no longer on the page|not found/i.test(error);
}

/** The panel's wording for a content-script failure on one example. */
export function exampleNotice(error: string): string {
  if (isOffscreen(error)) return OFFSCREEN_NOTICE;
  if (isRemoved(error)) return REMOVED_NOTICE;
  return error;
}

export function ExampleControls({
  examples,
  tabId,
  reveal = false,
}: {
  examples: ExampleRef[];
  tabId: number | null;
  /** Hide the controls until the surrounding `.group/row` is hovered or focused. */
  reveal?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [tone, setTone] = useState<'neutral' | 'error'>('neutral');
  // Set when a select failed because the element is out of view. Holding the
  // example here is what lets the user ask for the scroll explicitly (SUM-06).
  const [offscreen, setOffscreen] = useState<ExampleRef | null>(null);

  if (examples.length === 0) {
    return <StatusLine>No example elements were recorded for this group.</StatusLine>;
  }

  const current = examples[Math.min(index, examples.length - 1)];

  const report = (error: string | null, fallback?: string) => {
    if (!error) {
      setTone('neutral');
      setNotice(fallback ?? null);
      return;
    }
    setTone('error');
    setNotice(exampleNotice(error));
  };

  const highlightAll = () => {
    if (tabId === null) return;
    setOffscreen(null);
    void (async () => {
      const response = await sendToBackground({
        type: 'element.highlight',
        tabId,
        locators: examples.slice(0, MAX_HIGHLIGHTS).map(example => example.locator),
      });
      report(
        response.ok ? null : response.error,
        examples.length > MAX_HIGHLIGHTS
          ? `Showing the first ${MAX_HIGHLIGHTS} of ${examples.length} examples.`
          : undefined,
      );
    })();
  };

  const step = (direction: 1 | -1) => {
    if (tabId === null) return;
    const next = (index + direction + examples.length) % examples.length;
    setIndex(next);
    setOffscreen(null);
    const target = examples[next];
    if (!target) return;
    void (async () => {
      const response = await sendToBackground({
        type: 'element.highlight',
        tabId,
        locators: [target.locator],
      });
      report(response.ok ? null : response.error, `Example ${next + 1} of ${examples.length}.`);
    })();
  };

  /**
   * Selects an example. `scroll` is only ever true because the user pressed the
   * scroll button: the page is never moved without being asked (PRD SUM-06).
   */
  const select = (example: ExampleRef, scroll = false) => {
    if (tabId === null) return;
    void (async () => {
      const response = await sendToBackground({
        type: 'element.select',
        tabId,
        locator: example.locator,
        ...(scroll ? { scroll: true } : {}),
      });
      if (!response.ok && isOffscreen(response.error)) {
        setOffscreen(example);
        report(response.error);
        return;
      }
      setOffscreen(null);
      report(response.ok ? null : response.error, 'Pinned on the page.');
    })();
  };

  return (
    <div className="mt-1.5">
      <div
        className={cn(
          'flex flex-wrap items-center gap-1',
          reveal &&
            'opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-within:opacity-100',
        )}
      >
        <Button type="button" size="sm" variant="text" onClick={highlightAll}>
          <Crosshair aria-hidden />
          Show on page
        </Button>
        {examples.length > 1 ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="text"
              aria-label="Previous example"
              onClick={() => step(-1)}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <span className="text-[12px] text-muted-foreground tabular-nums">
              {Math.min(index, examples.length - 1) + 1} / {examples.length}
            </span>
            <Button
              type="button"
              size="sm"
              variant="text"
              aria-label="Next example"
              onClick={() => step(1)}
            >
              <ChevronRight aria-hidden />
            </Button>
          </>
        ) : null}
        {current ? (
          <button
            type="button"
            onClick={() => select(current)}
            className="max-w-[18ch] truncate rounded-[8px] px-1.5 py-1 font-mono text-[12px] text-muted-foreground hover:bg-surface-3 hover:text-foreground"
            title={`Select ${current.label}`}
          >
            {current.label}
          </button>
        ) : null}
      </div>
      {notice ? (
        <div className="mt-1">
          <StatusLine tone={tone}>{notice}</StatusLine>
        </div>
      ) : null}
      {offscreen ? (
        <div className="mt-1">
          <Button
            type="button"
            size="sm"
            variant="text"
            onClick={() => select(offscreen, true)}
          >
            <MoveVertical aria-hidden />
            Scroll to it and select
          </Button>
        </div>
      ) : null}
    </div>
  );
}
