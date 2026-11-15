


import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Info, Save } from 'lucide-react';
import type { AssetReading, ElementSnapshot, PageSummary, StackReport } from '@/lib/contracts';
import { sendToBackground } from '@/lib/messages';
import { cn } from '@/components/cn';
import { Button, Label, Switch } from '@/components/ui';
import {
  Pill,
  Segmented,
  StatusLine,
  StatusPill,
  actionLabel,
  noticeText,
  type SegmentOption,
} from '@/lib/ui/shared/components';
import {
  useActiveTab,
  useInspectorState,
  useRuntimeEvents,
  useSettings,
  useSidePanelPresence,
} from '@/lib/ui/shared/hooks';
import { AssetsTab } from './AssetsTab';
import { SavedTab, useSavedReferences } from './SavedTab';
import { StackReportView } from './StackReportView';
import { SummaryTab } from './SummaryTab';
import { ToolsTab } from './ToolsTab';

type PanelTab = 'summary' | 'assets' | 'stack' | 'tools' | 'saved';

const TABS: SegmentOption<PanelTab>[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'assets', label: 'Assets' },
  { value: 'stack', label: 'Stack' },
  { value: 'tools', label: 'Tools' },
  { value: 'saved', label: 'Saved' },
];

export function SidePanelApp() {
  const { tab, navigationToken, staleToken } = useActiveTab();
  const tabId = tab?.id ?? null;
  const inspector = useInspectorState(tabId);
  const { settings } = useSettings();


  useSidePanelPresence(tabId);

  const [active, setActive] = useState<PanelTab>('summary');

  const [summary, setSummary] = useState<PageSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ scanned: number; total: number } | null>(null);
  const [stale, setStale] = useState(false);

  const [assets, setAssets] = useState<AssetReading[] | null>(null);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState<string | null>(null);

  const [stack, setStack] = useState<StackReport | null>(null);
  const [stackLoading, setStackLoading] = useState(false);
  const [stackError, setStackError] = useState<string | null>(null);

  const [pinned, setPinned] = useState<ElementSnapshot | null>(null);
  const [pinnedNotice, setPinnedNotice] = useState<string | null>(null);
  const [navigated, setNavigated] = useState(false);

  const saved = useSavedReferences();
  const tabsRef = useRef<HTMLDivElement>(null);


  const hadData = summary !== null || assets !== null || stack !== null || pinned !== null;
  const hadDataRef = useRef(hadData);
  hadDataRef.current = hadData;


  useEffect(() => {
    if (navigationToken === 0) return;
    setNavigated(hadDataRef.current);
    setSummary(null);
    setAssets(null);
    setStack(null);
    setPinned(null);
    setStale(false);
    setProgress(null);
    setSummaryError(null);
    setAssetsError(null);
    setStackError(null);
  }, [navigationToken]);



  useEffect(() => {
    if (staleToken === 0) return;
    setStale(true);
    setNavigated(hadDataRef.current);
    setProgress(null);
  }, [staleToken]);

  useRuntimeEvents((event, eventTabId) => {
    if (tabId !== null && eventTabId !== null && eventTabId !== tabId) return;
    if (event.type === 'event.pinned') {
      setPinned(event.snapshot);
      setPinnedNotice(null);
      return;
    }
    if (event.type === 'event.pageChanged') {
      setStale(true);
      setNavigated(hadDataRef.current);
      return;
    }
    if (event.type === 'event.scanProgress') {
      setProgress({ scanned: event.scanned, total: event.total });
    }
  });

  const scanSummary = useCallback(() => {
    if (tabId === null) return;
    setSummaryLoading(true);
    setSummaryError(null);
    setProgress(null);
    setNavigated(false);
    void (async () => {
      const response = await sendToBackground({ type: 'summary.request', tabId });
      if (response.ok && 'summary' in response) {
        setSummary(response.summary);
        setStack(response.summary.stack);
        setStale(false);
      } else if (!response.ok) {
        setSummaryError(response.error);
      }
      setSummaryLoading(false);
      setProgress(null);
    })();
  }, [tabId]);

  const cancelScan = useCallback(() => {
    if (tabId === null) return;
    void sendToBackground({ type: 'summary.cancel', tabId });
  }, [tabId]);


  const listAssets = useCallback(
    (enrich = false) => {
      if (tabId === null) return;
      setAssetsLoading(true);
      setAssetsError(null);
      void (async () => {
        const response = await sendToBackground({ type: 'assets.request', tabId, enrich });
        if (response.ok && 'assets' in response) setAssets(response.assets);
        else if (!response.ok) setAssetsError(response.error);
        setAssetsLoading(false);
      })();
    },
    [tabId],
  );

  const detectStack = useCallback(() => {
    if (tabId === null) return;
    setStackLoading(true);
    setStackError(null);
    void (async () => {
      const response = await sendToBackground({ type: 'stack.request', tabId });
      if (response.ok && 'stack' in response) setStack(response.stack);
      else if (!response.ok) setStackError(response.error);
      setStackLoading(false);
    })();
  }, [tabId]);

  const savePinned = () => {
    if (!pinned) return;
    void (async () => {
      const response = await sendToBackground({
        type: 'reference.save',
        tabId: tabId ?? undefined,
        snapshot: pinned,
        title: pinned.element.label,
        note: '',
        captureScreenshot: true,
      });
      if (!response.ok) setPinnedNotice(response.error);
      else if ('warning' in response && response.warning)
        setPinnedNotice(`Saved to your collection. ${response.warning}`);
      else setPinnedNotice('Saved to your collection.');
    })();
  };




  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex(entry => entry.value === active);
    let target = -1;
    if (event.key === 'ArrowRight') target = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') target = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = TABS.length - 1;
    if (target < 0) return;
    const next = TABS[target];
    if (!next) return;
    event.preventDefault();
    setActive(next.value);
    const buttons = tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[target]?.focus();
  };

  const mode = inspector.state?.mode ?? null;
  const unsupported = inspector.state?.unsupportedReason ?? null;
  const inspecting = mode === 'active' || mode === 'paused';
  const outlinesOn = (inspector.state?.outlines ?? 'off') !== 'off';


  const tools = inspector.state?.tools ?? {
    rulers: false,
    semanticParents: settings.preferSemanticParents,
    layoutOverlay: true,
  };


  const toolsDisabled = inspector.busy || tabId === null || !!unsupported || !inspecting;


  const panelNotice = noticeText(tab?.url, unsupported);

  return (
    <div className="panel-root flex min-h-screen flex-col gap-4 p-3">
      {
                                                                           }
      <header className="rounded-[10px] bg-surface p-3">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={tab?.title}>
            {tab?.title || 'No active tab'}
          </p>
          <StatusPill mode={unsupported ? 'off' : mode} />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Button
            type="button"
            variant="tonal"
            onClick={inspector.toggle}
            disabled={inspector.busy || tabId === null || !!unsupported}
            aria-pressed={inspecting}
          >
            {

                                           }
            <span
              aria-hidden
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                inspecting ? 'bg-primary' : 'bg-muted-foreground',
              )}
            />
            {actionLabel(mode)}
          </Button>
          {




                                       }
          <div className="flex items-center gap-2">
            <Label htmlFor="panel-outlines" className="whitespace-nowrap font-normal">
              Layout outlines
            </Label>
            <Switch
              id="panel-outlines"
              checked={outlinesOn}
              disabled={inspector.busy || tabId === null || !!unsupported}
              onChange={event =>
                inspector.setOutlines(
                  event.currentTarget.checked ? settings.outlineColoring : 'off',
                )
              }
            />
          </div>
        </div>
        {


                                                            }
        <div
          role="group"
          aria-label="Page tools"
          className="mt-2 flex flex-wrap items-center gap-1.5"
        >
          <Pill
            selected={tools.rulers}
            disabled={toolsDisabled}
            onClick={() => inspector.setTools({ rulers: !tools.rulers })}
          >
            Rulers
          </Pill>
          <Pill
            selected={tools.semanticParents}
            disabled={toolsDisabled}
            onClick={() => inspector.setTools({ semanticParents: !tools.semanticParents })}
          >
            Semantic
          </Pill>
          <Pill
            selected={tools.layoutOverlay}
            disabled={toolsDisabled}
            onClick={() => inspector.setTools({ layoutOverlay: !tools.layoutOverlay })}
          >
            Layout overlay
          </Pill>
          <span className="group relative inline-flex items-center">
            <button
              type="button"
              aria-label="Where Pick color is"
              aria-describedby="panel-pick-hint"
              className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <Info aria-hidden className="size-3.5" />
            </button>
            {

                                                  }
            <span
              id="panel-pick-hint"
              className="pointer-events-none absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded-[6px] bg-surface-3 px-2 py-1 text-[12px] text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
            >
              Pick color is on the page badge
            </span>
          </span>
          {

                                 }
          <Pill
            selected={mode === 'paused'}
            disabled={toolsDisabled}
            onClick={() => inspector.setMode(mode === 'paused' ? 'active' : 'paused')}
          >
            Interact with page
          </Pill>
        </div>
        {panelNotice ? (
          <p className="mt-2 text-[12px] text-muted-foreground" role="status">
            {panelNotice}
          </p>
        ) : null}
        {inspector.error ? (
          <div className="mt-2">
            <StatusLine tone="error">{inspector.error}</StatusLine>
          </div>
        ) : null}
        {pinned ? (
          <div className="mt-2 flex items-center gap-2 rounded-[8px] bg-surface-2 px-2 py-1">
            <span className="min-w-0 flex-1 truncate text-[12px]">
              Pinned: <span className="font-medium">{pinned.element.label}</span>
            </span>
            <Button type="button" size="sm" variant="text" onClick={savePinned}>
              <Save aria-hidden />
              Save reference
            </Button>
          </div>
        ) : null}
        {pinnedNotice ? <StatusLine>{pinnedNotice}</StatusLine> : null}
        {


                                                                 }
        {navigated || stale ? (
          <div className="mt-2">
            <StatusLine>Page changed. Scan again for a current reading.</StatusLine>
          </div>
        ) : null}
      </header>

      <Segmented
        tablist
        size="md"
        label="Design Inspector panels"
        options={TABS}
        value={active}
        onSelect={setActive}
        trackRef={tabsRef}
        onKeyDown={onTabKeyDown}
        segmentProps={(entry, selected) => ({
          role: 'tab',
          id: `tab-${entry.value}`,
          'aria-selected': selected,
          'aria-controls': `panel-${entry.value}`,
          tabIndex: selected ? 0 : -1,
        })}
      />

      <main className="flex-1">
        <div
          role="tabpanel"
          id="panel-summary"
          aria-labelledby="tab-summary"
          hidden={active !== 'summary'}
        >
          {active === 'summary' ? (
            <SummaryTab
              tabId={tabId}
              pageTitle={tab?.title ?? ''}
              summary={summary}
              loading={summaryLoading}
              error={summaryError}
              progress={progress}
              stale={stale}
              onScan={scanSummary}
              onCancel={cancelScan}
            />
          ) : null}
        </div>

        <div
          role="tabpanel"
          id="panel-assets"
          aria-labelledby="tab-assets"
          hidden={active !== 'assets'}
        >
          {active === 'assets' ? (
            <AssetsTab
              tabId={tabId}
              assets={assets}
              loading={assetsLoading}
              error={assetsError}
              onList={() => listAssets(false)}
              onEnrich={() => listAssets(true)}
            />
          ) : null}
        </div>

        <div
          role="tabpanel"
          id="panel-stack"
          aria-labelledby="tab-stack"
          hidden={active !== 'stack'}
        >
          {active === 'stack' ? (
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="text"
                  onClick={detectStack}
                  disabled={stackLoading || tabId === null}
                >
                  {stack ? 'Refresh stack report' : 'Detect stack'}
                </Button>
                {stackLoading ? <StatusLine>Gathering page evidence.</StatusLine> : null}
              </div>
              {stackError ? <StatusLine tone="error">{stackError}</StatusLine> : null}
              <StackReportView report={stack} />
            </div>
          ) : null}
        </div>

        <div
          role="tabpanel"
          id="panel-tools"
          aria-labelledby="tab-tools"
          hidden={active !== 'tools'}
        >
          {active === 'tools' ? (
            <ToolsTab
              tabId={tabId}
              tabUrl={tab?.url ?? ''}
              pageMockup={inspector.state?.mockup}
            />
          ) : null}
        </div>

        <div
          role="tabpanel"
          id="panel-saved"
          aria-labelledby="tab-saved"
          hidden={active !== 'saved'}
        >
          {active === 'saved' ? (
            <div className="grid gap-2">
              {saved.error ? <StatusLine tone="error">{saved.error}</StatusLine> : null}
              <SavedTab references={saved.references} onReload={saved.reload} />
            </div>
          ) : null}
        </div>
      </main>

      <footer className="text-[12px] text-muted-foreground">
        Page analysis and saved references stay on your device. Fetching asset details or
        downloading an asset contacts that asset&apos;s host.
      </footer>
    </div>
  );
}
