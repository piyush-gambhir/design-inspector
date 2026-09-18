import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EXTENSION_DIR, launchWithExtension } from './helpers/extension';

test.describe('extension package', () => {
  test('manifest declares only the baseline permissions and no host permissions', () => {
    const manifest = JSON.parse(readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual(
      ['activeTab', 'downloads', 'scripting', 'sidePanel', 'storage'].sort(),
    );
    // The e2e build keeps host_permissions on purpose; the shipped build is checked separately.
    const shipped = JSON.parse(
      readFileSync(path.join(EXTENSION_DIR, '..', '..', '.output', 'chrome-mv3', 'manifest.json'), 'utf8'),
    );
    expect(shipped.host_permissions).toBeUndefined();
    expect(manifest.content_scripts ?? []).toEqual([]);
    expect(manifest.side_panel?.default_path).toBe('sidepanel.html');
    expect(manifest.commands['toggle-inspector']).toBeTruthy();
  });

  test('service worker boots and popup and side panel render without console errors', async () => {
    const { context, extensionId } = await launchWithExtension();
    try {
      for (const pageName of ['popup.html', 'sidepanel.html']) {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`chrome-extension://${extensionId}/${pageName}`);
        await expect(page.locator('#root')).not.toBeEmpty();
        expect(errors, `${pageName} console errors`).toEqual([]);
        await page.close();
      }
    } finally {
      await context.close();
    }
  });
});
