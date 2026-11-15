






import { bootInspector } from '@/lib/inspector/boot';

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main() {
    bootInspector();
  },
});
