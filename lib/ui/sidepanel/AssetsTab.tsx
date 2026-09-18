// Page assets (PRD 11).
//
// Inline SVG previews go through a data URL on an <img>, never
// dangerouslySetInnerHTML: page markup is untrusted input (PRD 17.3).
import { useMemo, useRef, useState } from 'react';
import { Download, FileArchive, Gauge, ImageOff, ListTree, X } from 'lucide-react';
import type { AssetKind, AssetReading } from '@/lib/contracts';
import { sendToBackground } from '@/lib/messages';
import { Button, Checkbox } from '@/components/ui';
import {
  Collapsible,
  CopyButton,
  EmptyState,
  Field,
  Pill,
  StatusLine,
  WindowedList,
} from '@/lib/ui/shared/components';
import { downloadAssetBundle, filenameFromUrl, svgDataUrl } from './exports';

const KIND_LABELS: Record<AssetKind, string> = {
  img: 'Image',
  picture: 'Picture',
  'svg-inline': 'Inline SVG',
  'css-background': 'CSS background',
  video: 'Video',
};

/** The type filter chips (PRD AST-04 Phase 2). */
export type AssetFilter = 'all' | 'images' | 'svg' | 'backgrounds' | 'video';

const FILTERS: { id: AssetFilter; label: string; kinds: AssetKind[] | null }[] = [
  { id: 'all', label: 'All', kinds: null },
  { id: 'images', label: 'Images', kinds: ['img', 'picture'] },
  { id: 'svg', label: 'SVG', kinds: ['svg-inline'] },
  { id: 'backgrounds', label: 'Backgrounds', kinds: ['css-background'] },
  { id: 'video', label: 'Video', kinds: ['video'] },
];

export function matchesFilter(asset: AssetReading, filter: AssetFilter): boolean {
  const entry = FILTERS.find(candidate => candidate.id === filter);
  if (!entry || entry.kinds === null) return true;
  return entry.kinds.includes(asset.kind);
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function Thumbnail({ asset }: { asset: AssetReading }) {
  const [failed, setFailed] = useState(false);
  const source =
    asset.kind === 'svg-inline' && asset.svgMarkup
      ? svgDataUrl(asset.svgMarkup)
      : (asset.url ?? null);

  if (!source || failed) {
    return (
      <div
        aria-hidden
        className="checkerboard flex size-14 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground"
      >
        <ImageOff aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={source}
      alt={asset.alt ?? ''}
      loading="lazy"
      onError={() => setFailed(true)}
      className="checkerboard size-14 shrink-0 rounded-[6px] object-contain"
    />
  );
}

function AssetRow({
  asset,
  index,
  selected,
  onSelect,
}: {
  asset: AssetReading;
  index: number;
  selected: boolean;
  onSelect: (next: boolean) => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [tone, setTone] = useState<'neutral' | 'error' | 'success'>('neutral');

  const say = (message: string, next: 'neutral' | 'error' | 'success') => {
    setNotice(message);
    setTone(next);
  };

  const download = () => {
    void (async () => {
      if (asset.kind === 'svg-inline' && asset.svgMarkup) {
        const response = await sendToBackground({
          type: 'download.data',
          dataUrl: svgDataUrl(asset.svgMarkup),
          filename: 'inline-asset.svg',
        });
        say(response.ok ? 'Download started.' : response.error, response.ok ? 'success' : 'error');
        return;
      }
      if (!asset.url) {
        say('This asset has no downloadable URL.', 'error');
        return;
      }
      if (asset.url.startsWith('data:')) {
        const response = await sendToBackground({
          type: 'download.data',
          dataUrl: asset.url,
          filename: 'inline-asset',
        });
        say(response.ok ? 'Download started.' : response.error, response.ok ? 'success' : 'error');
        return;
      }
      const response = await sendToBackground({
        type: 'download.url',
        url: asset.url,
        filename: filenameFromUrl(asset.url, 'asset'),
      });
      say(response.ok ? 'Download started.' : response.error, response.ok ? 'success' : 'error');
    })();
  };

  const intrinsic =
    asset.intrinsicWidth !== null && asset.intrinsicHeight !== null
      ? `${asset.intrinsicWidth} x ${asset.intrinsicHeight} px`
      : 'Unknown';

  return (
    <li className="rounded-[8px] bg-surface-2 p-2">
      <div className="flex gap-2">
        <Checkbox
          className="mt-1"
          checked={selected}
          aria-label={`Select asset ${index + 1}, ${KIND_LABELS[asset.kind]}`}
          onChange={event => onSelect(event.currentTarget.checked)}
        />
        <Thumbnail asset={asset} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium">{KIND_LABELS[asset.kind]}</span>
            {asset.candidates.length > 1 ? (
              <span className="text-[12px] text-muted-foreground">
                {asset.candidates.length} candidates
              </span>
            ) : null}
          </div>
          {asset.url ? (
            <p className="value-cell mt-0.5 font-mono text-[12px] text-muted-foreground">
              {asset.url}
            </p>
          ) : (
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Inline markup, no source URL.
            </p>
          )}
          <div className="mt-1 grid gap-0.5">
            <Field label="Rendered">
              {asset.renderedWidth} x {asset.renderedHeight} px
            </Field>
            <Field label="Intrinsic">{intrinsic}</Field>
            <Field label="File size">{formatBytes(asset.fileSize)}</Field>
            <Field label="MIME">{asset.mimeType ?? 'Unknown'}</Field>
            {asset.alt ? <Field label="Alt">{asset.alt}</Field> : null}
            {/* A repeat reference is a fact about the page, not a caveat. */}
            {(asset.usageCount ?? 1) > 1 ? (
              <Field label="Usage">Used {asset.usageCount} times</Field>
            ) : null}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Button type="button" size="sm" variant="text" onClick={download}>
              <Download aria-hidden />
              Download
            </Button>
            {asset.url ? (
              <CopyButton
                value={asset.url}
                label="Copy URL"
                variant="text"
                onCopied={error => (error ? say(error, 'error') : undefined)}
              />
            ) : null}
          </div>
          {notice ? (
            <div className="mt-1">
              <StatusLine tone={tone}>{notice}</StatusLine>
            </div>
          ) : null}
          {asset.limitations.length > 0 ? (
            <ul className="mt-1 grid gap-0.5">
              {asset.limitations.map((limitation, index) => (
                <li key={`${index}-${limitation}`} className="text-[12px] text-muted-foreground">
                  {limitation}
                </li>
              ))}
            </ul>
          ) : null}
          {asset.candidates.length > 1 ? (
            <Collapsible summary={`Other discovered candidates (${asset.candidates.length})`}>
              <ul className="grid gap-0.5">
                {asset.candidates.map((candidate, index) => (
                  <li key={`${index}-${candidate.url}`} className="text-[12px]">
                    <span className="font-mono break-all">{candidate.url}</span>
                    {candidate.descriptor ? (
                      <span className="ml-1 text-muted-foreground">{candidate.descriptor}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <StatusLine>
                Candidates are discovered sources, not verified originals.
              </StatusLine>
            </Collapsible>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function AssetsTab({
  tabId,
  assets,
  loading,
  error,
  onList,
  onEnrich,
}: {
  tabId: number | null;
  assets: AssetReading[] | null;
  loading: boolean;
  error: string | null;
  onList: () => void;
  /** Re-lists with file size and MIME type, which contacts each asset's host. */
  onEnrich?: () => void;
}) {
  const [filter, setFilter] = useState<AssetFilter>('all');
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'neutral' | 'error' | 'success' } | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);

  const rows = useMemo(
    () =>
      (assets ?? [])
        .map((asset, index) => ({ asset, index }))
        .filter(row => matchesFilter(row.asset, filter)),
    [assets, filter],
  );
  const selectedRows = rows.filter(row => selected.has(row.index));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;

  const toggle = (index: number, next: boolean) => {
    setSelected(current => {
      const updated = new Set(current);
      if (next) updated.add(index);
      else updated.delete(index);
      return updated;
    });
  };

  // Select all means "all of what this filter shows", never the hidden rows.
  const toggleAll = (next: boolean) => {
    setSelected(current => {
      const updated = new Set(current);
      for (const row of rows) {
        if (next) updated.add(row.index);
        else updated.delete(row.index);
      }
      return updated;
    });
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  const downloadSelected = () => {
    if (selectedRows.length === 0 || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setNotice(null);
    setProgress({ done: 0, total: selectedRows.length });

    void (async () => {
      const response = await downloadAssetBundle(
        selectedRows.map(row => row.asset),
        {
          signal: controller.signal,
          onProgress: (done, total) => setProgress({ done, total }),
        },
      );
      if (response.ok) {
        const { manifest, stoppedAtCap, writtenCount } = response.result;
        const parts = [`${writtenCount} of ${selectedRows.length} assets written to ${response.filename}.`];
        if (manifest.skipped.length > 0) {
          parts.push(`${manifest.skipped.length} skipped; manifest.json lists every reason.`);
        }
        if (stoppedAtCap) {
          parts.push(`The batch limit stopped the run, so this archive holds the first ${writtenCount}.`);
        }
        setNotice({ text: parts.join(' '), tone: manifest.skipped.length > 0 ? 'neutral' : 'success' });
      } else {
        // A cancelled run writes nothing: the archive is assembled in memory and
        // only handed to downloads once it is complete. Saying so, with the next
        // action, is better than letting the user look for a partial file (19.3).
        const cancelled = 'cancelled' in response && response.cancelled === true;
        setNotice({
          text: cancelled
            ? `${response.error} No archive was written. Select fewer assets and run it again.`
            : response.error,
          tone: cancelled ? 'neutral' : 'error',
        });
      }
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    })();
  };

  if (loading) return <StatusLine>Listing the assets on this page.</StatusLine>;

  if (!assets) {
    return (
      <div className="grid gap-2">
        <EmptyState
          title="No asset list yet"
          body="Only assets the page has already rendered can be discovered. Nothing is scrolled or clicked to force more."
          action={
            <Button type="button" onClick={onList} disabled={tabId === null}>
              <ListTree aria-hidden />
              List assets
            </Button>
          }
        />
        {error ? <StatusLine tone="error">{error}</StatusLine> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="text" onClick={onList}>
          Refresh list
        </Button>
        {onEnrich ? (
          <Button type="button" size="sm" variant="text" onClick={onEnrich}>
            <Gauge aria-hidden />
            Fetch file details
          </Button>
        ) : null}
        <StatusLine>{assets.length} assets discovered.</StatusLine>
      </div>
      {onEnrich ? (
        <StatusLine>
          File size and MIME type are only known from the network, so fetching them contacts each
          asset&apos;s host.
        </StatusLine>
      ) : null}
      {error ? <StatusLine tone="error">{error}</StatusLine> : null}
      {assets.length === 0 ? (
        <EmptyState
          title="No assets discovered"
          body="Lazy-loaded images that have not rendered yet are not visible to the scan."
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter assets by type">
            {FILTERS.map(entry => {
              const count =
                entry.kinds === null
                  ? assets.length
                  : assets.filter(asset => entry.kinds?.includes(asset.kind)).length;
              const active = filter === entry.id;
              return (
                <Pill key={entry.id} selected={active} onClick={() => setFilter(entry.id)}>
                  {entry.label}
                  <span className="tabular-nums">{count}</span>
                </Pill>
              );
            })}
          </div>

          <div className="grid gap-1 rounded-[8px] bg-surface-2 p-2">
            <label className="flex items-center gap-2 text-[12px]">
              <Checkbox
                checked={allSelected}
                indeterminate={selectedRows.length > 0 && !allSelected}
                disabled={rows.length === 0}
                onChange={event => toggleAll(event.currentTarget.checked)}
              />
              Select all shown ({rows.length})
            </label>
            <StatusLine>Downloading contacts each asset&apos;s host.</StatusLine>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                size="sm"
                disabled={selectedRows.length === 0 || busy}
                onClick={downloadSelected}
              >
                <FileArchive aria-hidden />
                Download selected as ZIP
              </Button>
              {busy ? (
                <Button type="button" size="sm" variant="text" onClick={cancel}>
                  <X aria-hidden />
                  Cancel
                </Button>
              ) : null}
              <span className="text-[12px] text-muted-foreground">
                {selectedRows.length} selected
              </span>
            </div>
            {progress ? (
              <StatusLine>
                Fetching {progress.done} of {progress.total} assets.
              </StatusLine>
            ) : null}
            {notice ? <StatusLine tone={notice.tone}>{notice.text}</StatusLine> : null}
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="No assets of this type"
              body="Pick another filter to see the rest of what the scan discovered."
            />
          ) : (
            <WindowedList items={rows} className="grid gap-2" noun="assets">
              {row => (
                <AssetRow
                  key={`${row.asset.kind}-${row.asset.url ?? row.index}-${row.index}`}
                  asset={row.asset}
                  index={row.index}
                  selected={selected.has(row.index)}
                  onSelect={next => toggle(row.index, next)}
                />
              )}
            </WindowedList>
          )}
        </>
      )}
    </div>
  );
}
