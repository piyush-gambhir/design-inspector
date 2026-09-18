import type { Page } from '@playwright/test';

/**
 * Wait for the page to have painted whatever the last interaction asked for.
 *
 * The overlay schedules its work on requestAnimationFrame, so the state a spec
 * wants to read lands one frame after the event that caused it, and the frame
 * after that is the one where the layout it triggered has settled. Two frames
 * is therefore the honest wait, and it is a wait on the page's own clock rather
 * than on a guess about how fast the machine is: the same call is instant on a
 * laptop and correct on a loaded CI runner.
 *
 * This replaces `page.waitForTimeout(150)` after hovers, clicks and toggles.
 * A timeout that models a real debounce is a different thing and stays.
 */
export async function waitForOverlayIdle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
