import { describe, expect, it } from 'vitest';

import { hasEyeDropper, pickPixel, UNSUPPORTED_REASON } from '@/lib/inspector/eyedropper';

function scopeWith(open: () => Promise<{ sRGBHex: string }>): unknown {
  return {
    EyeDropper: class {
      open(): Promise<{ sRGBHex: string }> {
        return open();
      }
    },
  };
}

describe('hasEyeDropper', () => {
  it('detects the native picker without assuming it exists', () => {
    expect(hasEyeDropper({})).toBe(false);
    expect(hasEyeDropper(undefined)).toBe(false);
    expect(hasEyeDropper(scopeWith(() => Promise.resolve({ sRGBHex: '#000000' })))).toBe(true);
  });
});

describe('pickPixel', () => {
  it('hides and restores the overlay around a successful pick', async () => {
    const calls: string[] = [];
    const outcome = await pickPixel({
      scope: scopeWith(() => {
        calls.push('open');
        return Promise.resolve({ sRGBHex: '#3874cb' });
      }),
      onBeforeOpen: () => calls.push('hide'),
      onAfterOpen: () => calls.push('show'),
    });

    expect(outcome).toEqual({ status: 'picked', hex: '#3874cb' });
    expect(calls).toEqual(['hide', 'open', 'show']);
  });

  it('treats an AbortError as a cancellation and still restores the overlay', async () => {
    const calls: string[] = [];
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const outcome = await pickPixel({
      scope: scopeWith(() => Promise.reject(abort)),
      onBeforeOpen: () => calls.push('hide'),
      onAfterOpen: () => calls.push('show'),
    });

    expect(outcome).toEqual({ status: 'cancelled' });
    expect(calls).toEqual(['hide', 'show']);
  });

  it('reports any other failure as unavailable', async () => {
    const outcome = await pickPixel({
      scope: scopeWith(() => Promise.reject(new Error('no screen access'))),
    });
    expect(outcome).toEqual({ status: 'unavailable', reason: 'no screen access' });
  });

  it('says so when the browser has no picker, and never opens one', async () => {
    const calls: string[] = [];
    const outcome = await pickPixel({ scope: {}, onBeforeOpen: () => calls.push('hide') });
    expect(outcome).toEqual({ status: 'unavailable', reason: UNSUPPORTED_REASON });
    expect(calls).toEqual([]);
  });
});
