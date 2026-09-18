// Background service worker. Owns activation, content-script injection,
// downloads, screenshots, and message routing. Must not assume it stays alive:
// per-tab state is re-derived from the content script on demand.
//
// Implemented in lib/background/*. This file only wires the listeners.
import { registerBackground } from '@/lib/background/register';

export default defineBackground(() => {
  registerBackground();
});
