








import * as React from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import type { ColorValue, FontConfidence, StackConfidence } from '@/lib/contracts';
import { cn } from '@/components/cn';
import { Badge, Button } from '@/components/ui';




export function Swatch({
  color,
  size = 16,
  className,
}: {
  color: Pick<ColorValue, 'raw' | 'hex' | 'alpha'>;
  size?: number;
  className?: string;
}) {
  const label = color.hex ?? color.raw;
  return (
    <span
      className={cn('checkerboard inline-block shrink-0 rounded-[4px]', className)}
      style={{ width: size, height: size, minWidth: size }}
      title={label}
    >
      <span
        aria-hidden
        className="block size-full rounded-[4px]"
        style={{ background: color.raw }}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}


export function ColorValueLabel({ color }: { color: ColorValue }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Swatch color={color} />
      <span className="value-cell font-mono text-[13px] tabular-nums">
        {color.hex ?? color.raw}
      </span>
      {color.alpha < 1 ? (
        <span className="text-[12px] text-muted-foreground tabular-nums">
          alpha {color.alpha.toFixed(2)}
        </span>
      ) : null}
      {color.lossy ? (
        <span className="text-[12px] text-muted-foreground">converted</span>
      ) : null}
    </span>
  );
}




const FONT_LABELS: Record<FontConfidence, string> = {
  declared: 'Declared',
  matched: 'Matched',
  verified: 'Verified',
};

const STACK_LABELS: Record<StackConfidence, string> = {
  high: 'High',
  likely: 'Likely',
};

export function ConfidenceBadge({
  confidence,
  className,
}: {
  confidence: FontConfidence | StackConfidence;
  className?: string;
}) {
  const isStack = confidence === 'high' || confidence === 'likely';
  const label = isStack
    ? STACK_LABELS[confidence as StackConfidence]
    : FONT_LABELS[confidence as FontConfidence];
  const variant = confidence === 'verified' || confidence === 'high' ? 'success' : 'secondary';
  return (
    <Badge variant={variant} className={cn('text-[12px]', className)}>
      {label}
    </Badge>
  );
}




export type InspectorMode = 'off' | 'active' | 'paused' | null;

export function statusWord(mode: InspectorMode): string {
  if (mode === 'active') return 'Inspecting';
  if (mode === 'paused') return 'Paused';
  if (mode === 'off') return 'Off';
  return 'Checking';
}


export function actionLabel(mode: InspectorMode): string {
  if (mode === 'active') return 'Stop inspecting';
  if (mode === 'paused') return 'Resume inspecting';
  return 'Inspect this page';
}


export function isBlankTab(url: string | undefined): boolean {
  const target = url ?? '';
  if (!target) return true;
  return /^(about:blank|about:newtab|chrome:\/\/newtab)/i.test(target);
}





export function noticeText(
  url: string | undefined,
  unsupportedReason: string | null,
): string | null {
  if (!unsupportedReason) return null;
  if (isBlankTab(url)) return 'Open a website to inspect it.';
  return unsupportedReason;
}

export function StatusPill({ mode, className }: { mode: InspectorMode; className?: string }) {
  const word = statusWord(mode);
  const live = mode === 'active';
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2 text-[12px]',
        live || mode === 'paused' ? 'text-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          live ? 'bg-primary' : 'bg-muted-foreground',
        )}
      />
      {word}
    </span>
  );
}




export function Kbd({ keys, className }: { keys: string; className?: string }) {


  const parts = keys.split(/\s*\+\s*/).flatMap(part => {
    const glyphs = part.match(/[⌘⌥⇧⌃]/g);
    if (!glyphs) return [part];
    const rest = part.replace(/[⌘⌥⇧⌃]/g, '');
    return rest ? [...glyphs, rest] : glyphs;
  });
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {parts.filter(Boolean).map((part, index) => (
        <kbd
          key={`${part}-${index}`}


          className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-surface-3 px-1 font-sans text-[12px] text-foreground tabular-nums"
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}





export function Pill({
  selected,
  className,
  ...props
}: React.ComponentProps<'button'> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] transition-colors',
        selected
          ? 'bg-accent-quiet text-accent-text'
          : 'bg-surface-2 text-muted-foreground hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}









export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onSelect,
  size = 'sm',
  label,
  labelledBy,
  tablist = false,
  trackRef,
  onKeyDown,
  segmentProps,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onSelect: (value: T) => void;

  size?: 'sm' | 'md';
  label?: string;
  labelledBy?: string;
  tablist?: boolean;
  trackRef?: React.Ref<HTMLDivElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;

  segmentProps?: (option: SegmentOption<T>, selected: boolean) => React.ComponentProps<'button'>;
  className?: string;
}) {
  return (
    <div
      ref={trackRef}
      role={tablist ? 'tablist' : 'group'}
      aria-label={label}
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className={cn(
        'flex w-full items-stretch rounded-[8px] bg-surface-2 p-0.5',
        size === 'sm' ? 'h-7' : 'h-8',
        className,
      )}
    >
      {options.map(option => {
        const selected = option.value === value;
        const extra = segmentProps?.(option, selected) ?? {};
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
            {...(tablist ? {} : { 'aria-pressed': selected })}
            {...extra}
            className={cn(




              'flex-1 truncate rounded-[6px] text-[12px] transition-colors',
              selected
                ? 'bg-selected-surface font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
              extra.className,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}




export function Section({
  id,
  title,
  count,
  subtitle,
  actions,
  children,
  className,
}: {





  id?: string;
  title: string;

  count?: number;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {


  const headingId = React.useId();
  return (
    <section
      id={id}
      tabIndex={id ? -1 : undefined}
      aria-labelledby={headingId}
      className={cn('rounded-[10px] bg-surface p-3 focus-visible:outline-2', className)}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <h3 id={headingId} className="truncate text-[13px] font-semibold">
              {title}
            </h3>
            {count !== undefined ? (
              <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
                <span aria-hidden>· </span>
                {count}
              </span>
            ) : null}
          </div>
          {subtitle ? (
            <p className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}


export function GroupHeading({
  children,
  count,
  actions,
  className,
}: {
  children: React.ReactNode;
  count?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-1 flex items-center gap-2', className)}>
      <h4 className="min-w-0 truncate text-[13px] font-semibold">{children}</h4>
      {count !== undefined ? (
        <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">{count}</span>
      ) : null}
      {actions ? <div className="ml-auto shrink-0">{actions}</div> : null}
    </div>
  );
}

export function Collapsible({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details className={cn('group', className)} open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-[6px] px-1 py-1 text-[12px] text-muted-foreground hover:text-foreground">
        <ChevronDown aria-hidden className="size-3 shrink-0 transition-transform group-open:rotate-0 -rotate-90" />
        {summary}
      </summary>
      <div className="pt-1">{children}</div>
    </details>
  );
}


export const LIST_PAGE_SIZE = 200;









export function WindowedList<T>({
  items,
  children,
  className,
  noun = 'rows',
  page = LIST_PAGE_SIZE,
}: {
  items: readonly T[];
  children: (item: T, index: number) => React.ReactNode;
  className?: string;

  noun?: string;
  page?: number;
}) {
  const [limit, setLimit] = React.useState(page);


  const shown = items.length > limit ? items.slice(0, limit) : items;
  const hidden = items.length - shown.length;
  return (
    <>
      <ul className={className}>{shown.map((item, index) => children(item, index))}</ul>
      {hidden > 0 ? (
        <Button
          variant="text"
          size="sm"
          className="mt-1 self-start"
          onClick={() => setLimit(limit + page)}
        >
          Show {Math.min(hidden, page)} more of {items.length} {noun}
        </Button>
      ) : null}
    </>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-[10px] bg-surface px-4 py-6 text-center">
      <p className="text-[13px] font-semibold">{title}</p>
      {body ? (
        <p className="mx-auto mt-1 max-w-[34ch] text-[12px] text-muted-foreground">{body}</p>
      ) : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}






export function StatusLine({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'error' | 'success';
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'error'
      ? 'text-destructive'
      : tone === 'success'
        ? 'text-success'
        : 'text-muted-foreground';


  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={cn('text-[12px]', toneClass)}>
      {children}
    </p>
  );
}


export function Notice({
  children,
  action,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'neutral' | 'error';
}) {
  return (
    <div className="rounded-[10px] bg-surface p-3">
      <p
        role={tone === 'error' ? 'alert' : 'status'}
        className={cn('text-[12px]', tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}
      >
        {children}
      </p>
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}


export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field-row py-0.5">
      <span className="shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <span className="field-value value-cell min-w-0 text-[13px] tabular-nums">{children}</span>
    </div>
  );
}




export function CopyButton({
  value,
  label = 'Copy',
  className,
  size = 'sm',
  variant = 'text',
  onCopied,
}: {
  value: string | (() => string | Promise<string>);
  label?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'tonal' | 'text' | 'danger-text';
  onCopied?: (error: string | null) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      const text = typeof value === 'function' ? await value() : value;
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopied?.(null);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1000);
    } catch (error) {
      onCopied?.(error instanceof Error ? error.message : 'Copy failed.');
    }
  };

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      onClick={() => void copy()}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? 'Copied' : label}
    </Button>
  );
}
