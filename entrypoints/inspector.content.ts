// The inspector content script. Registered at runtime (not in the manifest) so
// it only runs after the user activates the extension on a tab (PRD INS-01).
// Injected by the background worker with chrome.scripting.executeScript using
// the built path '/content-scripts/inspector.js'.
//
// Framework-free: the overlay renders into a shadow root and must stay fast
// and independent of the host page's own React or Vue runtime.
import { bootInspector } from '@/lib/inspector/boot';

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main() {
    bootInspector();
  },
});
