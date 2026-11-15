












import { useState } from 'react';
import { ChevronLeft, ChevronRight, Crosshair, MoveVertical } from 'lucide-react';
import type { ExampleRef } from '@/lib/contracts';
import { sendToBackground } from '@/lib/messages';
import { cn } from '@/components/cn';
import { Button } from '@/components/ui';
import { StatusLine } from '@/lib/ui/shared/components';

export const MAX_HIGHLIGHTS = 20;


export const OFFSCREEN_NOTICE = 'Scroll to the element on the page and try again.';






export const REMOVED_NOTICE =
  'That element is no longer on the page. Refresh the summary, or pick another example.';

function isOffscreen(error: string): boolean {
  return /offscreen/i.test(error);
}

function isRemoved(error: string): boolean {
  return /no longer on the page|not found/i.test(error);
}


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

  reveal?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [tone, setTone] = useState<'neutral' | 'error'>('neutral');


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



          'flex items-center gap-1',
          reveal &&
            'opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-within:opacity-100',
        )}
      >
        <Button
          type="button"
          size="sm"
          variant="text"
          className="shrink-0"
          onClick={highlightAll}
        >
          <Crosshair aria-hidden />
          Show on page
        </Button>
        {examples.length > 1 ? (



          <span className="example-step">
            <Button
              type="button"
              size="sm"
              variant="text"
              aria-label="Previous example"
              className="shrink-0"
              onClick={() => step(-1)}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
              {Math.min(index, examples.length - 1) + 1} / {examples.length}
            </span>
            <Button
              type="button"
              size="sm"
              variant="text"
              aria-label="Next example"
              className="shrink-0"
              onClick={() => step(1)}
            >
              <ChevronRight aria-hidden />
            </Button>
          </span>
        ) : null}
        {current ? (
          <button
            type="button"
            onClick={() => select(current)}
            className="min-w-0 max-w-[18ch] truncate rounded-[8px] px-1.5 py-1 font-mono text-[12px] text-muted-foreground hover:bg-surface-3 hover:text-foreground"
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
