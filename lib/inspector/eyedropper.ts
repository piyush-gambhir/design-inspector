// Native eyedropper access (competitive Tier 1 item 2, PRD SUR-02, 16.1).
//
// The browser's own `EyeDropper` is the only picker we use: it needs no screen
// capture, no extra permission, and no canvas copy of the page. It does need a
// user gesture, so every caller is a click handler.
//
// A picked pixel is Observed evidence about what the screen actually shows,
// which is a different and stronger claim than the Derived background color we
// composite from computed styles. The two are labelled differently on purpose.
//
// The types are declared locally rather than in a `declare global` block so
// this compiles whether or not the installed lib.dom already knows the API.

interface EyeDropperResult {
  sRGBHex: string;
}

interface EyeDropperLike {
  open(options?: { signal?: AbortSignal }): Promise<EyeDropperResult>;
}

type EyeDropperConstructor = new () => EyeDropperLike;

type PickerScope = { EyeDropper?: EyeDropperConstructor };

export type PickOutcome =
  | { status: 'picked'; hex: string }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: string };

export const UNSUPPORTED_REASON = 'This browser has no built-in color picker.';

/** True when the native picker exists. Buttons are hidden when it does not. */
export function hasEyeDropper(scope: unknown = globalThis): boolean {
  const candidate = scope as PickerScope | null | undefined;
  return typeof candidate?.EyeDropper === 'function';
}

export interface PickOptions {
  /** Runs before the picker opens: the overlay hides so the real pixel is read. */
  onBeforeOpen?(): void;
  /** Always runs once the picker has settled, cancelled or not. */
  onAfterOpen?(): void;
  scope?: unknown;
}

/**
 * Opens the picker and resolves with the chosen pixel. Escape cancels, which
 * the API reports as an `AbortError`; that is a no-op, never an error message.
 */
export async function pickPixel(options: PickOptions = {}): Promise<PickOutcome> {
  const scope = (options.scope ?? globalThis) as PickerScope;
  const Picker = scope.EyeDropper;
  if (typeof Picker !== 'function') {
    return { status: 'unavailable', reason: UNSUPPORTED_REASON };
  }

  options.onBeforeOpen?.();
  try {
    const result = await new Picker().open();
    const hex = (result?.sRGBHex ?? '').trim();
    if (!hex) return { status: 'cancelled' };
    return { status: 'picked', hex };
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (name === 'AbortError') return { status: 'cancelled' };
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    options.onAfterOpen?.();
  }
}
