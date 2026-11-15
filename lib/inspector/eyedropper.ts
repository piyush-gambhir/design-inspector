












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


export function hasEyeDropper(scope: unknown = globalThis): boolean {
  const candidate = scope as PickerScope | null | undefined;
  return typeof candidate?.EyeDropper === 'function';
}

export interface PickOptions {

  onBeforeOpen?(): void;

  onAfterOpen?(): void;
  scope?: unknown;
}





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
