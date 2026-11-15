






import { useState } from 'react';
import { PanelRight, Power } from 'lucide-react';
import type { Settings, ThemePreference } from '@/lib/contracts';
import { Button, Label, NumberStepper, Switch } from '@/components/ui';
import { SCAN_CAP_MAX, SCAN_CAP_MIN } from '@/lib/storage/settings';
import {
  Kbd,
  Notice,
  Segmented,
  StatusPill,
  actionLabel,
  isBlankTab,
  noticeText,
  statusWord,
  type SegmentOption,
} from '@/lib/ui/shared/components';
import {
  useActiveTab,
  useCommandShortcut,
  useInspectorState,
  useSettings,
} from '@/lib/ui/shared/hooks';

const THEMES: SegmentOption<ThemePreference>[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const COLORINGS: SegmentOption<NonNullable<Settings['outlineColoring']>>[] = [
  { value: 'tag', label: 'Tag' },
  { value: 'depth', label: 'Depth' },
];

const SHORTCUTS_URL = 'chrome://extensions/shortcuts';


export function statusText(
  mode: 'off' | 'active' | 'paused' | null,
  unsupportedReason: string | null,
): string {


  if (unsupportedReason) return 'Off';
  return statusWord(mode);
}

export function PopupApp() {
  const { tab } = useActiveTab();
  const { state, busy, error, toggle, setOutlines } = useInspectorState(tab?.id ?? null);
  const { settings, update } = useSettings();
  const shortcut = useCommandShortcut('toggle-inspector');
  const [panelError, setPanelError] = useState<string | null>(null);

  const mode = state?.mode ?? null;
  const unsupported = state?.unsupportedReason ?? null;
  const inspecting = mode === 'active' || mode === 'paused';

  const outlinesOn = (state?.outlines ?? 'off') !== 'off';
  const notice = noticeText(tab?.url, unsupported);
  const blocked = busy || !tab || !!unsupported;

  const openSidePanel = () => {
    if (!tab) return;
    try {

      void chrome.sidePanel.open({ tabId: tab.id }).then(
        () => window.close(),
        (openError: unknown) =>
          setPanelError(
            openError instanceof Error ? openError.message : 'The side panel could not open.',
          ),
      );
    } catch (openError) {
      setPanelError(
        openError instanceof Error ? openError.message : 'The side panel could not open.',
      );
    }
  };

  const openShortcuts = () => {
    try {
      void chrome.tabs.create({ url: SHORTCUTS_URL }).then(
        () => window.close(),
        () => setPanelError('Open chrome://extensions/shortcuts to set the shortcut.'),
      );
    } catch {
      setPanelError('Open chrome://extensions/shortcuts to set the shortcut.');
    }
  };

  const copyUrl = () => {
    if (!tab?.url) return;
    void navigator.clipboard.writeText(tab.url).catch(() => undefined);
  };

  return (
    <div className="popup-root w-[320px] p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h1 className="truncate text-[16px] font-semibold">Design Inspector</h1>
        <StatusPill mode={unsupported ? 'off' : mode} />
      </header>

      <Button
        type="button"
        size="lg"
        variant={inspecting ? 'tonal' : 'primary'}
        className="w-full rounded-[10px]"
        onClick={toggle}
        disabled={blocked}
        aria-pressed={inspecting}
      >
        <Power aria-hidden />
        {actionLabel(mode)}
      </Button>

      {notice ? (
        <div className="mt-2">
          <Notice
            action={
              tab?.url && !isBlankTab(tab.url) ? (
                <Button type="button" size="sm" variant="text" className="-ml-2" onClick={copyUrl}>
                  Copy page URL
                </Button>
              ) : null
            }
          >
            {notice}
          </Notice>
        </div>
      ) : null}

      {                                                                         }
      {error || panelError ? (
        <div className="mt-2">
          <Notice
            tone="error"
            action={
              error ? (


                <Button
                  type="button"
                  size="sm"
                  variant="text"
                  className="-ml-2"
                  onClick={toggle}
                  disabled={busy || !tab}
                >
                  Try again
                </Button>
              ) : null
            }
          >
            {error ?? panelError}
          </Notice>
        </div>
      ) : null}

      <div className="mt-2 flex items-stretch gap-2">
        <Button
          type="button"
          variant="tonal"
          className="h-9 flex-1"
          onClick={openSidePanel}
          disabled={!tab}
        >
          <PanelRight aria-hidden />
          Side panel
        </Button>
        <Button type="button" variant="tonal" className="h-9 flex-1 gap-1.5" onClick={openShortcuts}>
          {shortcut ? (
            <>
              <span className="text-muted-foreground">Shortcut</span>
              <Kbd keys={shortcut} />
            </>
          ) : (
            'Set shortcut'
          )}
        </Button>
      </div>

      <div className="mt-3 grid gap-2 rounded-[10px] bg-surface p-3">
        <div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="layout-outlines" className="truncate">
              Layout outlines
            </Label>
            <Switch
              id="layout-outlines"
              checked={outlinesOn}
              disabled={blocked}
              onChange={event =>
                setOutlines(event.currentTarget.checked ? settings.outlineColoring : 'off')
              }
            />
          </div>
          {
                                                                }
          {outlinesOn ? (
            <div className="mt-1.5">
              <Segmented
                label="Outline coloring"
                options={COLORINGS}
                value={settings.outlineColoring}
                onSelect={value => {
                  update({ outlineColoring: value });

                  setOutlines(value);
                }}
              />
            </div>
          ) : null}
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="prefer-semantic-parents" className="truncate">
              Prefer semantic parents
            </Label>
            <Switch
              id="prefer-semantic-parents"
              checked={settings.preferSemanticParents}
              onChange={event => update({ preferSemanticParents: event.currentTarget.checked })}
            />
          </div>
          <p className="truncate text-[12px] text-muted-foreground">
            Span inside a heading selects the heading.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="hover-card" className="truncate">
              Hover card
            </Label>
            <Switch
              id="hover-card"
              checked={settings.hoverCard}
              onChange={event => update({ hoverCard: event.currentTarget.checked })}
            />
          </div>
          <p className="truncate text-[12px] text-muted-foreground">
            Read while moving, not only when pinned.
          </p>
        </div>
      </div>

      <div className="mt-2 grid gap-2 rounded-[10px] bg-surface p-3">
        <div className="flex items-center justify-between gap-3">
          <Label id="theme-label" className="shrink-0">
            Theme
          </Label>
          <div className="w-[176px]">
            <Segmented
              labelledBy="theme-label"
              options={THEMES}
              value={settings.theme}
              onSelect={value => update({ theme: value })}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          {
                                                                }
          <span className="shrink-0 text-[13px] font-medium">Scan cap</span>
          <NumberStepper
            aria-label="Scan cap"
            value={String(settings.summaryScanCap)}
            min={SCAN_CAP_MIN}
            max={SCAN_CAP_MAX}
            step={500}
            onValueChange={next => {
              const parsed = Number.parseInt(next, 10);
              if (Number.isFinite(parsed)) update({ summaryScanCap: parsed });
            }}
          />
        </div>
      </div>

      <footer className="mt-3 text-[12px] text-muted-foreground">
        Page analysis and saved references stay on your device. Fetching asset details or
        downloading an asset contacts that asset&apos;s host.
      </footer>
    </div>
  );
}
