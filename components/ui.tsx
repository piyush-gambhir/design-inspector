// Native form controls keep the extension independent of Radix.
//
// Borderless by construction: nothing here draws a hairline. A control is told
// apart from its background by a tonal step (--surface-2, --surface-3) or by an
// accent fill, never by an outline, and the only outline any of these can carry
// is the shared focus ring from assets/ui.css.

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

// ---------------------------------------------------------------------------
// Button
//
// Four variants, and each one says what it is: `primary` is the single accent
// action a view is allowed, `tonal` is every other real button, `text` is an
// action that lives inside a reading and must not compete with it, and
// `danger-text` is the same thing for something destructive. Heights are 28 /
// 32 / 40 so a row of controls lines up with the switches and chips beside it.

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        tonal: 'bg-surface-2 text-foreground hover:bg-surface-3',
        text: 'bg-transparent text-accent-text hover:bg-surface-2',
        'danger-text': 'bg-transparent text-destructive hover:bg-surface-2',
      },
      size: {
        sm: 'h-7 px-2 text-[12px]',
        md: 'h-8 px-3 text-[13px]',
        lg: 'h-10 px-4 text-[13px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

// ---------------------------------------------------------------------------
// Badge

const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-[6px] px-1.5 py-0.5 text-[12px] font-medium w-fit whitespace-nowrap shrink-0 gap-1',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-surface-2 text-muted-foreground',
        destructive: 'bg-destructive/15 text-destructive',
        success: 'bg-success/15 text-success',
        outline: 'bg-surface-2 text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

// ---------------------------------------------------------------------------
// Progress

export function Progress({
  value,
  className,
  ...props
}: React.ComponentProps<'div'> & { value: number }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)}
      {...props}
    >
      <div
        className="h-full bg-primary transition-[width] duration-300"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Switch (native checkbox with a 34x20 track: --surface-3 off, --accent on)

export function Switch({
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <span
      className={cn('relative inline-flex h-5 w-[34px] shrink-0 items-center', className)}
      style={{ minWidth: 34 }}
    >
      <input
        type="checkbox"
        className="peer absolute inset-0 z-10 cursor-pointer appearance-none rounded-full"
        {...props}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full bg-surface-3 transition-colors peer-checked:bg-primary"
      />
      <span
        aria-hidden
        className="pointer-events-none relative z-0 ml-0.5 size-4 rounded-full bg-white transition-transform peer-checked:translate-x-[14px]"
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Checkbox: a native input with a tonal box. `indeterminate` is a DOM property
// rather than an attribute, so it has to be assigned through a ref.

export function Checkbox({
  className,
  indeterminate = false,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & { indeterminate?: boolean }) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !props.checked;
  }, [indeterminate, props.checked]);
  return (
    <span className={cn('relative inline-flex size-4 shrink-0 items-center justify-center', className)}>
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          'peer size-4 cursor-pointer appearance-none rounded-[4px] bg-surface-3 transition-colors',
          'checked:bg-primary indeterminate:bg-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...props}
      />
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute size-3 text-primary-foreground opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-100"
      >
        <path d={indeterminate && !props.checked ? 'M6 12h12' : 'M20 6 9 17l-5-5'} />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Input

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'flex h-8 w-full min-w-0 rounded-[8px] bg-surface-2 px-2 py-1 text-[13px] transition-colors',
        'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// NumberStepper: a compact tonal number field with -/+ controls.

export function NumberStepper({
  value,
  onValueChange,
  min = 0,
  max = Infinity,
  step = 1,
  className,
  'aria-label': ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  'aria-label'?: string;
}) {
  const clamp = (n: number) => String(Math.max(min, Math.min(max, n)));
  const nudge = (direction: 1 | -1) => {
    const current = parseInt(value, 10);
    onValueChange(clamp((Number.isFinite(current) ? current : min) + direction * step));
  };
  const stepButton =
    'flex h-6 w-6 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground disabled:pointer-events-none disabled:opacity-40';
  const current = parseInt(value, 10);
  return (
    <div className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-[8px] bg-surface-2 p-0.5', className)}>
      <button type="button" aria-label="Decrease" className={stepButton} disabled={Number.isFinite(current) && current <= min} onClick={() => nudge(-1)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14" /></svg>
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={ariaLabel}
        min={min}
        max={max}
        value={value}
        onChange={event => onValueChange(event.currentTarget.value)}
        onBlur={event => {
          const parsed = parseInt(event.currentTarget.value, 10);
          onValueChange(clamp(Number.isFinite(parsed) ? parsed : min));
        }}
        className="w-11 bg-transparent text-center text-[12px] font-medium tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button type="button" aria-label="Increase" className={stepButton} disabled={Number.isFinite(current) && current >= max} onClick={() => nudge(1)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alert

const alertVariants = cva('relative w-full rounded-[10px] px-3 py-2 text-[13px] grid gap-0.5', {
  variants: {
    variant: {
      default: 'bg-surface text-foreground',
      destructive: 'bg-destructive/10 text-destructive [&>[data-slot=description]]:text-destructive/90',
      success: 'bg-success/10 text-success [&>[data-slot=description]]:text-success/90',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant, className }))} {...props} />;
}

export function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('font-medium', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="description" className={cn('text-[12px]', className)} {...props} />;
}

// ---------------------------------------------------------------------------
// Label

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      className={cn('text-[13px] font-medium leading-none select-none', className)}
      {...props}
    />
  );
}
