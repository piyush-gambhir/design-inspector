// Tools tab: the mockup overlay (competitive Tier 2 item 1).
//
// The side panel owns the file and the persistence; the content script owns the
// pixels. The two are kept in step in one direction each: a control here writes
// to IndexedDB and sends `mockup.set` with the image as a data URL, and a drag
// on the page comes back as `event.state` carrying the new offset, which this
// tab writes through `updateMockupState` without touching the stored bytes.
//
// The mockup is remembered per origin, so a reload, a route change, or coming
// back tomorrow finds the comp exactly where it was left.
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { formatBytesLabel } from '@/lib/ui/shared/format';
import { ImageUp, Trash2 } from 'lucide-react';
import type { MockupState } from '@/lib/messages';
import { sendToBackground } from '@/lib/messages';
import { cn } from '@/components/cn';
import { Button, Input, Label, Switch } from '@/components/ui';
import {
  DEFAULT_MOCKUP_STATE,
  MOCKUP_MIME_TYPES,
  blobToDataUrl,
  checkMockupSize,
  deleteMockup,
  getMockup,
  originOf,
  putMockup,
  updateMockupState,
  type StoredMockupState,
} from '@/lib/storage/mockups';
import {
  EmptyState,
  Section,
  Segmented,
  StatusLine,
  type SegmentOption,
} from '@/lib/ui/shared/components';

const BLEND_MODES: SegmentOption<'normal' | 'difference'>[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'difference', label: 'Difference' },
];

export const MOCKUP_ACCEPT = MOCKUP_MIME_TYPES.join(',');

/** Said about a mockup this tab did not put on the page (tester finding F8). */
export const FOREIGN_MOCKUP_NOTE = 'Set from outside this panel; not saved.';

/** The stored state read back as text, for a mockup with no stored blob. */
function stateSummary(state: StoredMockupState): { label: string; value: string }[] {
  return [
    { label: 'Opacity', value: state.opacity.toFixed(2) },
    { label: 'Offset', value: `${state.x}, ${state.y}` },
    { label: 'Scale', value: String(state.scale) },
    { label: 'Blend', value: state.blend },
    { label: 'Visible', value: state.visible ? 'yes' : 'no' },
    { label: 'Locked', value: state.locked ? 'yes' : 'no' },
  ];
}

/** Arrow-key nudge on the offset fields: 1px, or 10px with Shift. */
export function nudgeAmount(key: string, shiftKey: boolean): number {
  const step = shiftKey ? 10 : 1;
  if (key === 'ArrowUp' || key === 'ArrowRight') return step;
  if (key === 'ArrowDown' || key === 'ArrowLeft') return -step;
  return 0;
}

/** A dropped or chosen file we are willing to overlay. */
export function fileRejection(file: File): string | null {
  const type = (file.type || '').toLowerCase();
  if (type && !MOCKUP_MIME_TYPES.includes(type)) {
    return `${file.name} is ${type}. Mockup overlays accept PNG, JPG, WebP and SVG.`;
  }
  return checkMockupSize(file.size);
}

export interface ToolsTabProps {
  tabId: number | null;
  /** The active tab's URL, which is where the origin key comes from. */
  tabUrl: string;
  /** The mockup settings the content script currently reports, if any. */
  pageMockup: StoredMockupState | null | undefined;
}

export function ToolsTab({ tabId, tabUrl, pageMockup }: ToolsTabProps) {
  const origin = originOf(tabUrl);
  const [state, setState] = useState<StoredMockupState | null>(null);
  const [name, setName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** The data URL for the current image, so a settings change can re-send it. */
  const dataUrlRef = useRef<string>('');

  const send = useCallback(
    async (mockup: MockupState | null) => {
      if (tabId === null) return;
      const response = await sendToBackground({ type: 'mockup.set', tabId, mockup });
      if (!response.ok) setError(response.error);
      else setError(null);
    },
    [tabId],
  );

  // On tab activation, and whenever the origin changes, load what was stored
  // for this site and put it back on the page: a reload drops the content
  // script's copy, and the stored one is the one that survives.
  useEffect(() => {
    let cancelled = false;
    setNotice(null);
    setError(null);
    if (!origin) {
      setState(null);
      setName('');
      dataUrlRef.current = '';
      return;
    }
    void (async () => {
      try {
        const record = await getMockup(origin);
        if (cancelled) return;
        if (!record) {
          setState(null);
          setName('');
          dataUrlRef.current = '';
          return;
        }
        const dataUrl = await blobToDataUrl(record.blob);
        if (cancelled) return;
        dataUrlRef.current = dataUrl;
        setState(record.state);
        setName(formatBytesLabel(record.blob.size));
        await send({ dataUrl, ...record.state });
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [origin, send]);

  // A drag on the page reports the new offset. It is written straight through,
  // because the image did not change and the panel is not the author of it.
  useEffect(() => {
    if (!origin || !pageMockup || !state) return;
    if (pageMockup.x === state.x && pageMockup.y === state.y) return;
    const next = { ...state, x: pageMockup.x, y: pageMockup.y };
    setState(next);
    void updateMockupState(origin, next).catch((writeError: unknown) => {
      setError(writeError instanceof Error ? writeError.message : String(writeError));
    });
  }, [origin, pageMockup, state]);

  const applyState = useCallback(
    (next: StoredMockupState) => {
      setState(next);
      if (!origin) return;
      void updateMockupState(origin, next).catch((writeError: unknown) => {
        setError(writeError instanceof Error ? writeError.message : String(writeError));
      });
      void send({ dataUrl: dataUrlRef.current, ...next });
    },
    [origin, send],
  );

  const acceptFile = useCallback(
    async (file: File) => {
      if (!origin) {
        setError('This page has no origin to remember a mockup against.');
        return;
      }
      const rejection = fileRejection(file);
      if (rejection) {
        setError(rejection);
        return;
      }
      try {
        const next = state ?? { ...DEFAULT_MOCKUP_STATE };
        const dataUrl = await blobToDataUrl(file);
        await putMockup(origin, file, next);
        dataUrlRef.current = dataUrl;
        setState(next);
        setName(file.name);
        setError(null);
        setNotice('Mockup set for this site.');
        await send({ dataUrl, ...next });
      } catch (writeError) {
        setError(writeError instanceof Error ? writeError.message : String(writeError));
      }
    },
    [origin, send, state],
  );

  /**
   * A mockup the page has and this tab does not. There is no blob to delete,
   * so removal is only the message that clears it from the page.
   */
  const foreign = !state && pageMockup ? pageMockup : null;

  const removeForeign = useCallback(async () => {
    setNotice('Mockup removed from the page.');
    setError(null);
    await send(null);
  }, [send]);

  const remove = useCallback(async () => {
    if (!origin) return;
    try {
      await deleteMockup(origin);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      return;
    }
    dataUrlRef.current = '';
    setState(null);
    setName('');
    setNotice('Mockup removed.');
    if (fileRef.current) fileRef.current.value = '';
    await send(null);
  }, [origin, send]);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void acceptFile(file);
  };

  const offsetField = (axis: 'x' | 'y') => (
    <div className="grid gap-1">
      <Label htmlFor={`mockup-${axis}`} className="text-[12px] font-normal text-muted-foreground">
        {axis.toUpperCase()}
      </Label>
      <Input
        id={`mockup-${axis}`}
        type="number"
        inputMode="numeric"
        aria-label={`Mockup ${axis.toUpperCase()} offset in pixels`}
        value={String(state?.[axis] ?? 0)}
        onChange={event => {
          if (!state) return;
          const parsed = Number.parseInt(event.currentTarget.value, 10);
          applyState({ ...state, [axis]: Number.isFinite(parsed) ? parsed : 0 });
        }}
        onKeyDown={event => {
          if (!state) return;
          const delta = nudgeAmount(event.key, event.shiftKey);
          if (delta === 0) return;
          // The browser's own number stepping is 1 with no Shift behaviour, so
          // the keys are handled here instead of on top of it.
          event.preventDefault();
          applyState({ ...state, [axis]: state[axis] + delta });
        }}
      />
    </div>
  );

  if (!origin) {
    return (
      <EmptyState
        title="No site to overlay"
        body="Open a normal web page. A mockup is remembered against that site's origin."
      />
    );
  }

  return (
    <div className="grid gap-2">
      <Section
        title="Mockup overlay"
        subtitle="Lay a comp over the page to compare it pixel for pixel. Stored on this device, for this site only."
      >
        <div
          onDragOver={event => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'grid gap-2 rounded-[10px] bg-surface-2 p-3 text-center transition-colors',
            dragging && 'bg-accent-quiet',
          )}
        >
          <ImageUp aria-hidden className="mx-auto size-5 text-muted-foreground" />
          <p className="text-[12px] text-muted-foreground">
            Drop a PNG, JPG, WebP or SVG here, or choose a file.
          </p>
          <input
            ref={fileRef}
            type="file"
            aria-label="Mockup image"
            accept={MOCKUP_ACCEPT}
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              if (file) void acceptFile(file);
            }}
            className="mx-auto text-[12px] file:mr-2 file:rounded-[8px] file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-[12px]"
          />
        </div>

        {error ? <StatusLine tone="error">{error}</StatusLine> : null}
        {notice && !error ? <StatusLine tone="success">{notice}</StatusLine> : null}

        {/*
          A mockup can reach the page without going through this tab: another
          window's panel, a reload that left the content script holding one, a
          direct mockup.set. With no stored blob there is nothing to edit here,
          so the page's own state is reported and the one thing this tab can
          still honestly do is take it off again (tester finding F8).
        */}
        {!state && foreign ? (
          <div className="mt-3 grid gap-2" data-role="foreign-mockup">
            <StatusLine>{FOREIGN_MOCKUP_NOTE}</StatusLine>
            <dl className="grid gap-0.5">
              {stateSummary(foreign).map(entry => (
                <div key={entry.label} className="flex items-baseline justify-between gap-2">
                  <dt className="text-[12px] text-muted-foreground">{entry.label}</dt>
                  <dd className="text-[12px] tabular-nums">{entry.value}</dd>
                </div>
              ))}
            </dl>
            <div>
              <Button
                type="button"
                size="sm"
                variant="danger-text"
                onClick={() => void removeForeign()}
              >
                <Trash2 aria-hidden />
                Remove
              </Button>
            </div>
          </div>
        ) : null}

        {state ? (
          <div className="mt-3 grid gap-3">
            <p className="truncate text-[12px] text-muted-foreground">{name}</p>

            <div className="grid gap-1">
              <Label htmlFor="mockup-opacity" className="text-[12px] font-normal text-muted-foreground">
                Opacity {state.opacity.toFixed(2)}
              </Label>
              <input
                id="mockup-opacity"
                type="range"
                min={0}
                max={1}
                step={0.01}
                aria-label="Mockup opacity"
                value={state.opacity}
                onChange={event =>
                  applyState({ ...state, opacity: Number(event.currentTarget.value) })
                }
                className="w-full accent-primary"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              {offsetField('x')}
              {offsetField('y')}
              <div className="grid gap-1">
                <Label htmlFor="mockup-scale" className="text-[12px] font-normal text-muted-foreground">
                  Scale
                </Label>
                <Input
                  id="mockup-scale"
                  type="number"
                  step={0.05}
                  min={0.05}
                  aria-label="Mockup scale"
                  value={String(state.scale)}
                  onChange={event => {
                    const parsed = Number.parseFloat(event.currentTarget.value);
                    applyState({ ...state, scale: Number.isFinite(parsed) ? parsed : 1 });
                  }}
                />
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Arrow keys nudge the offset by 1px, Shift by 10px.
            </p>

            <Segmented
              label="Blend mode"
              options={BLEND_MODES}
              value={state.blend}
              onSelect={blend => applyState({ ...state, blend })}
            />

            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="mockup-visible">Visible</Label>
              <Switch
                id="mockup-visible"
                checked={state.visible}
                onChange={event =>
                  applyState({ ...state, visible: event.currentTarget.checked })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="mockup-locked">Lock position</Label>
              <Switch
                id="mockup-locked"
                checked={state.locked}
                onChange={event =>
                  applyState({ ...state, locked: event.currentTarget.checked })
                }
              />
            </div>
            <p className="text-[12px] text-muted-foreground">
              Unlock to drag the comp on the page. While the inspector is active a click selects
              an element, so drag it after pressing Interact with page, or use the offsets above.
            </p>

            <div>
              <Button type="button" size="sm" variant="danger-text" onClick={() => void remove()}>
                <Trash2 aria-hidden />
                Remove
              </Button>
            </div>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
