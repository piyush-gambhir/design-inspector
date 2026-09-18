import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// The manifest is generated. Name, description, and permissions live here so
// they sit next to the code that uses them. Version comes from package.json.
//
// Permission policy (docs/PRD.md section 17): activeTab + scripting inject the
// inspector only after the user activates it on a tab. No persistent host
// permissions, no webRequest, no debugger in the default workflow.
// DI_E2E=1 produces a test-only build under .output-e2e/ that keeps
// host_permissions so Playwright can inject without a toolbar click. Never
// ship that build.
const e2e = process.env.DI_E2E === '1';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: e2e ? '.output-e2e' : '.output',
  vite: () => ({
    plugins: [tailwindcss()],
    server: {
      // Vite 6+ only allows localhost origins by default. Dev-mode extension
      // pages load their modules from the dev server, so allow that origin.
      cors: { origin: [/^chrome-extension:\/\//, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] },
    },
  }),
  hooks: {
    // WXT adds host_permissions for the runtime-registered content script
    // because scripting.registerContentScripts would need them. We inject with
    // executeScript under activeTab instead, so strip them (PRD 17.2).
    'build:manifestGenerated': (wxt, manifest) => {
      if (!e2e) delete manifest.host_permissions;
      // `browser_specific_settings` is declared for a future Gecko submission
      // (store/FIREFOX.md). WXT keeps it on every target, and Chrome has no use
      // for it, so the shipped Chrome manifest stays exactly as it was.
      if (wxt.config.browser !== 'firefox') delete manifest.browser_specific_settings;
    },
  },
  manifest: {
    name: 'Design Inspector',
    description:
      'Hover over anything on a website and read its typography, colors, spacing, assets, and stack. Save references with context.',
    permissions: ['activeTab', 'scripting', 'sidePanel', 'downloads', 'storage'],
    icons: {
      16: '/icons/icon16.png',
      32: '/icons/icon32.png',
      48: '/icons/icon48.png',
      128: '/icons/icon128.png',
    },
    action: {
      default_title: 'Design Inspector',
      default_icon: {
        16: '/icons/icon16.png',
        32: '/icons/icon32.png',
        48: '/icons/icon48.png',
        128: '/icons/icon128.png',
      },
    },
    // Firefox is not a supported target yet (store/FIREFOX.md says what would
    // have to change first), but an add-on id and an explicit "no data
    // collection" declaration cost nothing and are required for any future
    // submission. WXT drops this key from the Chrome build; the smoke test
    // asserts that the shipped Chrome manifest is unchanged.
    browser_specific_settings: {
      gecko: {
        id: 'design-inspector@piyushgambhir.com',
        data_collection_permissions: { required: ['none'] },
      },
    },
    commands: {
      'toggle-inspector': {
        suggested_key: { default: 'Alt+Shift+I', mac: 'Alt+Shift+I' },
        description: 'Toggle Design Inspector on the current tab',
      },
    },
  },
});
