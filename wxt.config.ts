import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';










const e2e = process.env.DI_E2E === '1';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: e2e ? '.output-e2e' : '.output',
  vite: () => ({
    plugins: [tailwindcss()],
    server: {


      cors: { origin: [/^chrome-extension:\/\//, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] },
    },
  }),
  hooks: {



    'build:manifestGenerated': (wxt, manifest) => {
      if (!e2e) delete manifest.host_permissions;



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
