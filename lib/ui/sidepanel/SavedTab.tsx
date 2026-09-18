// Saved references (PRD 14, 15).
//
// Titles and notes are editable in place and autosave on blur. The snapshot is
// never touched by an edit. Deleting asks first, and clearing asks twice as
// loudly, because this is the only copy of the research.
import { useEffect, useMemo, useState } from 'react';
import { Columns2, Package, Pencil, Trash2 } from 'lucide-react';
import type { PageSummary, SavedReference } from '@/lib/contracts';
import { sendToBackground } from '@/lib/messages';
import {
  referenceToMarkdown,
  summaryToMarkdown,
  toJsonEnvelope,
  toTasteLedger,
  type BundleResult,
} from '@/lib/exports';
import {
  clearReferences,
  deleteReference,
  estimateUsage,
  formatBytes,
  getScreenshotUrl,
  listReferences,
  updateReferenceMeta,
  type UsageEstimate,
} from '@/lib/storage/references';
import { Badge, Button, Checkbox, Input } from '@/components/ui';
import {
  Collapsible,
  EmptyState,
  GroupHeading,
  StatusLine,
} from '@/lib/ui/shared/components';
import { formatCapturedAt } from '@/lib/ui/shared/format';
import { useRuntimeEvents } from '@/lib/ui/shared/hooks';
import { CompareView } from './CompareView';
import {
  copyText,
  exportDateStamp,
  extensionVersion,
  jsonDataUrl,
  runExport,
  downloadBundle,
} from './exports';

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname || 'Unknown source';
  } catch {
    return 'Unknown source';
  }
}

/** Group by source hostname, keeping the incoming order inside each group. */
export function groupByHost(
  references: SavedReference[],
): { host: string; references: SavedReference[] }[] {
  const groups: { host: string; references: SavedReference[] }[] = [];
  for (const reference of references) {
    const host = hostnameOf(reference.snapshot.source.url);
    const existing = groups.find(group => group.host === host);
    if (existing) existing.references.push(reference);
    else groups.push({ host, references: [reference] });
  }
  return groups;
}

export type SortOrder = 'newest' | 'oldest' | 'site';

export const SORT_LABELS: Record<SortOrder, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  site: 'By site',
};

/**
 * Orders the collection. Ties break on id so the list never reshuffles between
 * renders, and 'site' still reads newest first inside each hostname.
 */
export function sortReferences(
  references: SavedReference[],
  order: SortOrder,
): SavedReference[] {
  const byNewest = (a: SavedReference, b: SavedReference): number =>
    a.createdAt === b.createdAt ? cmp(b.id, a.id) : cmp(b.createdAt, a.createdAt);

  return [...references].sort((a, b) => {
    if (order === 'oldest') return -byNewest(a, b);
    if (order === 'site') {
      const hosts = cmp(
        hostnameOf(a.snapshot.source.url),
        hostnameOf(b.snapshot.source.url),
      );
      if (hosts !== 0) return hosts;
    }
    return byNewest(a, b);
  });
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function markdownFor(reference: SavedReference): string {
  if (reference.kind === 'summary') return summaryToMarkdown(reference.snapshot as PageSummary);
  return referenceToMarkdown(reference);
}

// ---------------------------------------------------------------------------

function ScreenshotThumbnail({
  screenshotId,
  isCrop,
}: {
  screenshotId: string;
  isCrop: boolean | null;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let created: string | null = null;
    void getScreenshotUrl(screenshotId)
      .then(next => {
        if (!active) {
          if (next) URL.revokeObjectURL(next);
          return;
        }
        created = next;
        setUrl(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [screenshotId]);

  if (!url) return null;
  return (
    <img
      src={url}
      alt="Saved screenshot of the captured element"
      title={isCrop ? 'Visible crop. The element extended beyond the viewport.' : undefined}
      className="checkerboard size-14 shrink-0 rounded-[6px] object-cover"
    />
  );
}

function ReferenceCard({
  reference,
  selected,
  onSelect,
  onChanged,
  onError,
}: {
  reference: SavedReference;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState(reference.title);
  const [note, setNote] = useState(reference.note);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setTitle(reference.title);
    setNote(reference.note);
  }, [reference.id, reference.title, reference.note]);

  const commit = (patch: { title?: string; note?: string }) => {
    void updateReferenceMeta(reference.id, patch).then(onChanged, (error: unknown) =>
      onError(error instanceof Error ? error.message : 'The edit could not be saved.'),
    );
  };

  const remove = () => {
    void deleteReference(reference.id).then(onChanged, (error: unknown) =>
      onError(error instanceof Error ? error.message : 'The reference could not be deleted.'),
    );
  };

  const viewport = reference.snapshot.source.viewport;

  return (
    <li className="rounded-[8px] bg-surface-2 p-2">
      <div className="flex items-start gap-2">
        <label className="flex shrink-0 items-center pt-1">
          <Checkbox
            checked={selected}
            onChange={event => onSelect(event.currentTarget.checked)}
            aria-label={`Select ${reference.title}`}
          />
        </label>
        {reference.screenshotId ? (
          <ScreenshotThumbnail
            screenshotId={reference.screenshotId}
            isCrop={reference.screenshotIsCrop}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* The title reads as text until it is clicked, and the pencil is
                what says it can be. A field with a box around it would make
                every card look like a form. */}
            <div className="group relative min-w-0 flex-1">
              <Input
                value={title}
                aria-label="Reference title"
                placeholder="Untitled reference"
                onChange={event => setTitle(event.currentTarget.value)}
                onBlur={() => {
                  if (title !== reference.title) commit({ title });
                }}
                className="h-7 w-full bg-transparent px-1 pr-6 text-[13px] font-semibold hover:bg-surface-3 focus:bg-surface-3"
              />
              <Pencil
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              />
            </div>
            <Badge variant="outline" className="shrink-0">
              {reference.kind === 'summary' ? 'Summary' : 'Element'}
            </Badge>
          </div>

          <p className="value-cell mt-0.5 px-1 text-[12px] text-muted-foreground">
            {formatCapturedAt(reference.createdAt)} · {viewport.width} x {viewport.height}
            {reference.updatedAt !== reference.createdAt
              ? ` · edited ${formatCapturedAt(reference.updatedAt)}`
              : ''}
            {reference.screenshotId && reference.screenshotIsCrop ? ' · Visible crop' : ''}
          </p>
          <p className="value-cell px-1 text-[12px] text-muted-foreground">
            {reference.snapshot.source.url}
          </p>

          <textarea
            value={note}
            aria-label="Why I saved this"
            placeholder="Why I saved this"
            onChange={event => setNote(event.currentTarget.value)}
            onBlur={() => {
              if (note !== reference.note) commit({ note });
            }}
            rows={2}
            className="mt-1 w-full resize-y rounded-[6px] bg-transparent px-1 py-1 text-[12px] hover:bg-surface-3 focus:bg-surface-3 placeholder:text-muted-foreground"
          />

          <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
            {confirming ? (
              <>
                <StatusLine tone="error">Delete this reference?</StatusLine>
                <Button type="button" size="sm" variant="danger-text" onClick={remove}>
                  Delete
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="text"
                  onClick={() => setConfirming(false)}
                >
                  Keep
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="danger-text"
                aria-label={`Delete ${reference.title}`}
                onClick={() => setConfirming(true)}
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------

export function SavedTab({
  references,
  onReload,
}: {
  references: SavedReference[];
  onReload: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [usage, setUsage] = useState<UsageEstimate | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tone, setTone] = useState<'neutral' | 'error' | 'success'>('neutral');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [order, setOrder] = useState<SortOrder>('newest');
  const [manifest, setManifest] = useState<BundleResult['manifest'] | null>(null);
  const [comparing, setComparing] = useState<[string, string] | null>(null);

  const say = (message: string, next: 'neutral' | 'error' | 'success' = 'neutral') => {
    setNotice(message);
    setTone(next);
  };

  useEffect(() => {
    void estimateUsage().then(setUsage);
  }, [references.length]);

  const ordered = useMemo(() => sortReferences(references, order), [references, order]);
  const groups = useMemo(() => groupByHost(ordered), [ordered]);
  const chosen = useMemo(
    () => ordered.filter(reference => selected.has(reference.id)),
    [ordered, selected],
  );
  const summariesChosen = chosen.filter(reference => reference.kind === 'summary');
  const pair = useMemo(() => {
    if (!comparing) return null;
    const [firstId, secondId] = comparing;
    const first = references.find(reference => reference.id === firstId);
    const second = references.find(reference => reference.id === secondId);
    return first && second ? ([first, second] as const) : null;
  }, [comparing, references]);

  const allSelected = references.length > 0 && chosen.length === references.length;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(references.map(reference => reference.id)));
  };

  const toggleOne = (id: string, isSelected: boolean) => {
    setSelected(current => {
      const next = new Set(current);
      if (isSelected) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleGroup = (ids: string[], selectAll: boolean) => {
    setSelected(current => {
      const next = new Set(current);
      for (const id of ids) {
        if (selectAll) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const requireSelection = (): boolean => {
    if (chosen.length === 0) {
      say('Select at least one reference first.', 'error');
      return false;
    }
    return true;
  };

  const exportMarkdown = () => {
    if (!requireSelection()) return;
    const attempt = runExport(() => chosen.map(markdownFor).join('\n\n---\n\n'));
    if (!attempt.ok) {
      say(`Markdown export is unavailable: ${attempt.error}`, 'error');
      return;
    }
    void copyText(attempt.value).then(error =>
      error ? say(error, 'error') : say(`Copied ${chosen.length} references as Markdown.`, 'success'),
    );
  };

  const exportJson = () => {
    if (!requireSelection()) return;
    const attempt = runExport(() =>
      JSON.stringify(toJsonEnvelope(chosen, extensionVersion()), null, 2),
    );
    if (!attempt.ok) {
      say(`JSON export is unavailable: ${attempt.error}`, 'error');
      return;
    }
    void (async () => {
      const response = await sendToBackground({
        type: 'download.data',
        dataUrl: jsonDataUrl(attempt.value),
        filename: `design-inspector-export-${exportDateStamp()}.json`,
      });
      if (response.ok) say('JSON download started.', 'success');
      else say(response.error, 'error');
    })();
  };

  const exportTasteLedger = () => {
    if (!requireSelection()) return;
    const attempt = runExport(() => toTasteLedger(chosen, new Date().toISOString()));
    if (!attempt.ok) {
      say(`Taste ledger export is unavailable: ${attempt.error}`, 'error');
      return;
    }
    void copyText(attempt.value).then(error =>
      error ? say(error, 'error') : say('Taste ledger entry copied.', 'success'),
    );
  };

  /**
   * ZIP bundle for the selection (PRD EXP-03 Phase 2, AST-05). The screenshots
   * are loaded here because only this surface can read the local blob store,
   * and the download is started from this page because a blob URL belongs to
   * the context that created it.
   */
  const exportBundle = () => {
    if (!requireSelection()) return;
    setManifest(null);
    void (async () => {
      try {
        const screenshots = new Map<string, Blob>();
        for (const reference of chosen) {
          if (!reference.screenshotId) continue;
          const objectUrl = await getScreenshotUrl(reference.screenshotId);
          if (!objectUrl) continue;
          try {
            screenshots.set(reference.id, await (await fetch(objectUrl)).blob());
          } finally {
            URL.revokeObjectURL(objectUrl);
          }
        }

        const result = await downloadBundle(chosen, screenshots, { includeLedger: true });
        if (!result.ok) throw new Error(result.error);
        setManifest(result.manifest);
        say(`Bundle download started: ${result.filename}.`, 'success');
      } catch (error) {
        say(
          `Bundle export is unavailable: ${describe(error, 'the bundle could not be built.')}`,
          'error',
        );
      }
    })();
  };

  const compare = () => {
    if (summariesChosen.length !== 2) {
      say('Select exactly two saved summaries to compare.', 'error');
      return;
    }
    const [first, second] = summariesChosen;
    if (!first || !second) return;
    setComparing([first.id, second.id]);
  };

  const clearAll = () => {
    void clearReferences().then(
      () => {
        setSelected(new Set());
        setConfirmingClear(false);
        say('Collection cleared.', 'success');
        onReload();
      },
      (error: unknown) =>
        say(error instanceof Error ? error.message : 'The collection could not be cleared.', 'error'),
    );
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="tonal"
          onClick={toggleAll}
          disabled={references.length === 0}
          aria-pressed={allSelected}
        >
          {allSelected ? 'Clear selection' : 'Select all'}
        </Button>
        <Button type="button" size="sm" variant="text" onClick={exportMarkdown}>
          Copy Markdown
        </Button>
        <Button type="button" size="sm" variant="text" onClick={exportJson}>
          Download JSON
        </Button>
        <Button type="button" size="sm" variant="text" onClick={exportTasteLedger}>
          Copy taste ledger
        </Button>
        <Button type="button" size="sm" variant="text" onClick={exportBundle}>
          <Package aria-hidden />
          Export bundle (ZIP)
        </Button>
        <Button
          type="button"
          size="sm"
          variant="text"
          onClick={compare}
          disabled={summariesChosen.length !== 2}
          title="Select two saved summaries"
        >
          <Columns2 aria-hidden />
          Compare
        </Button>
        {confirmingClear ? (
          <>
            <Button type="button" size="sm" variant="danger-text" onClick={clearAll}>
              Clear everything
            </Button>
            <Button
              type="button"
              size="sm"
              variant="text"
              onClick={() => setConfirmingClear(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="danger-text"
            onClick={() => setConfirmingClear(true)}
            disabled={references.length === 0}
          >
            Clear all
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="saved-sort" className="text-[12px] text-muted-foreground">
          Sort
        </label>
        <select
          id="saved-sort"
          value={order}
          onChange={event => setOrder(event.currentTarget.value as SortOrder)}
          className="h-7 shrink-0 rounded-[8px] bg-surface-2 px-1.5 text-[12px]"
        >
          {(Object.keys(SORT_LABELS) as SortOrder[]).map(value => (
            <option key={value} value={value}>
              {SORT_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      <StatusLine>
        {chosen.length} of {references.length} selected. Local storage in use:{' '}
        {formatBytes(usage?.usageBytes ?? null)}
        {usage?.quotaBytes ? ` of about ${formatBytes(usage.quotaBytes)}` : ''}.
      </StatusLine>
      {notice ? <StatusLine tone={tone}>{notice}</StatusLine> : null}
      {manifest ? (
        <Collapsible
          summary={`Bundle contents: ${manifest.written.length} written, ${manifest.skipped.length} skipped`}
        >
          <ul className="grid gap-0.5">
            {manifest.written.map(path => (
              <li key={`written-${path}`} className="font-mono text-[12px] break-all">
                {path}
              </li>
            ))}
            {manifest.skipped.map(entry => (
              <li
                key={`skipped-${entry.path}`}
                className="text-[12px] break-all text-muted-foreground"
              >
                <span className="font-mono">{entry.path}</span> skipped: {entry.reason}
              </li>
            ))}
          </ul>
        </Collapsible>
      ) : null}

      {pair ? (
        <CompareView a={pair[0]} b={pair[1]} onClose={() => setComparing(null)} />
      ) : null}

      {references.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          body="Pin an element on the page and press Save reference, or scan a page and press Save summary. Only deliberate saves are stored."
        />
      ) : (
        <div className="grid gap-3">
          {groups.map(group => {
            const ids = group.references.map(reference => reference.id);
            const groupSelected = ids.every(id => selected.has(id));
            return (
              <div key={group.host}>
                <GroupHeading
                  count={`${group.references.length} ${
                    group.references.length === 1 ? 'reference' : 'references'
                  }`}
                  actions={
                    <Button
                      type="button"
                      size="sm"
                      variant="text"
                      aria-pressed={groupSelected}
                      onClick={() => toggleGroup(ids, !groupSelected)}
                    >
                      {groupSelected ? 'Clear group' : 'Select group'}
                    </Button>
                  }
                >
                  {group.host}
                </GroupHeading>
                <ul className="grid gap-2">
                  {group.references.map(reference => (
                    <ReferenceCard
                      key={reference.id}
                      reference={reference}
                      selected={selected.has(reference.id)}
                      onSelect={isSelected => toggleOne(reference.id, isSelected)}
                      onChanged={onReload}
                      onError={message => say(message, 'error')}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Loads the collection and keeps it current from event.savedChanged. */
export function useSavedReferences(): {
  references: SavedReference[];
  error: string | null;
  reload: () => void;
} {
  const [references, setReferences] = useState<SavedReference[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    void listReferences().then(setReferences, (loadError: unknown) =>
      setError(loadError instanceof Error ? loadError.message : 'Saved references could not be read.'),
    );
  };

  useEffect(reload, []);

  useRuntimeEvents(event => {
    if (event.type === 'event.savedChanged') setReferences(event.references);
  });

  return { references, error, reload };
}
