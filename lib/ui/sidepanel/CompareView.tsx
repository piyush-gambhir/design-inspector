// Two saved summaries side by side (competitive Tier 2 item 5, PRD 4 Phase 3).
//
// The header states both sources, capture times and viewports, because the most
// useful comparison is the same site at two widths and the only thing that
// distinguishes those two readings is their viewport.
//
// Nothing here recomputes a reading: both sides are the snapshots exactly as
// they were saved.
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { PageSummary, SavedReference } from '@/lib/contracts';
import { Button } from '@/components/ui';
import { CopyButton, Section, StatusLine, Swatch } from '@/lib/ui/shared/components';
import {
  compareSummaries,
  comparisonToMarkdown,
  viewportLabel,
  type CompareRow,
  type PaletteCompareRow,
  type Side,
} from './compare';

function summaryOf(reference: SavedReference): PageSummary {
  return reference.snapshot as PageSummary;
}

function sideText(side: Side, titles: { a: string; b: string }): string {
  if (side === 'both') return 'Both';
  return side === 'a' ? `${titles.a} only` : `${titles.b} only`;
}

function count(value: number | null): string {
  return value === null ? 'not present' : `x${value}`;
}

function SourceColumn({
  label,
  reference,
}: {
  label: string;
  reference: SavedReference;
}) {
  const summary = summaryOf(reference);
  return (
    <div className="min-w-0 rounded-[8px] bg-surface-2 p-2">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="truncate text-[12px] font-medium" title={reference.title}>
        {reference.title || 'Untitled reference'}
      </p>
      <p className="mt-0.5 text-[12px] break-all text-muted-foreground">{summary.source.url}</p>
      <p className="text-[12px] text-muted-foreground">Captured {summary.source.capturedAt}</p>
      <p className="text-[12px] text-muted-foreground">{viewportLabel(summary.source)}</p>
    </div>
  );
}

function RowTable({
  title,
  rows,
  titles,
}: {
  title: string;
  rows: CompareRow[];
  titles: { a: string; b: string };
}) {
  if (rows.length === 0) {
    return (
      <div>
        <h4 className="mb-1 text-[13px] font-semibold">
          {title}
        </h4>
        <StatusLine>Nothing recorded in either summary.</StatusLine>
      </div>
    );
  }
  return (
    <div>
      <h4 className="mb-1 text-[13px] font-semibold">
        {title}
      </h4>
      <ul className="grid gap-0.5">
        {rows.map(row => (
          <li
            key={row.key}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-2 rounded-[8px] px-1.5 py-1 text-[12px] odd:bg-surface-2/40"
          >
            <span className="min-w-0 truncate font-mono" title={row.label}>
              {row.label}
            </span>
            <span className="tabular-nums" title={`${titles.a}: ${count(row.a)}`}>
              {row.a === null ? '-' : row.a}
            </span>
            <span className="tabular-nums" title={`${titles.b}: ${count(row.b)}`}>
              {row.b === null ? '-' : row.b}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {sideText(row.side, titles)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaletteTable({
  rows,
  titles,
}: {
  rows: PaletteCompareRow[];
  titles: { a: string; b: string };
}) {
  if (rows.length === 0) {
    return (
      <div>
        <h4 className="mb-1 text-[13px] font-semibold">
          Palette
        </h4>
        <StatusLine>No colors were recorded in either summary.</StatusLine>
      </div>
    );
  }
  return (
    <div>
      <h4 className="mb-1 text-[13px] font-semibold">
        Palette
      </h4>
      <ul className="grid gap-0.5">
        {rows.map(row => (
          <li
            key={`${row.side}-${row.key}`}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-[8px] px-1.5 py-1 text-[12px] odd:bg-surface-2/40"
          >
            <Swatch
              color={(row.a ?? row.b)?.representative.color ?? { raw: 'transparent', hex: null, alpha: 0 }}
              size={16}
            />
            <span className="min-w-0 truncate font-mono" title={row.label}>
              {row.label}
            </span>
            <span className="tabular-nums" title={`${titles.a}: ${count(row.a?.totalCount ?? null)}`}>
              {row.a ? row.a.totalCount : '-'}
            </span>
            <span className="tabular-nums" title={`${titles.b}: ${count(row.b?.totalCount ?? null)}`}>
              {row.b ? row.b.totalCount : '-'}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {sideText(row.side, titles)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CompareView({
  a,
  b,
  onClose,
}: {
  a: SavedReference;
  b: SavedReference;
  onClose: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const titles = { a: 'A', b: 'B' };
  const left = summaryOf(a);
  const right = summaryOf(b);
  const comparison = useMemo(() => compareSummaries(left, right), [left, right]);
  const sameSite = left.source.url === right.source.url;

  return (
    <Section
      title="Compare summaries"
      subtitle={
        sameSite
          ? 'The same URL at two captures. Differences are the viewport, the capture time, or both.'
          : 'Two captures, side by side. A count is absent, not zero, when a value was never recorded.'
      }
      actions={
        <>
          <CopyButton
            label="Copy as Markdown"
            value={() => comparisonToMarkdown(left, right, titles)}
            onCopied={error => setNotice(error ?? 'Comparison copied as Markdown.')}
          />
          <Button
            type="button"
            size="sm"
            variant="text"
            aria-label="Close the comparison"
            onClick={onClose}
          >
            <X aria-hidden />
          </Button>
        </>
      }
    >
      <div className="grid gap-2">
        <div className="grid gap-1.5 sm:grid-cols-2">
          <SourceColumn label={`${titles.a}`} reference={a} />
          <SourceColumn label={`${titles.b}`} reference={b} />
        </div>
        {notice ? <StatusLine>{notice}</StatusLine> : null}
        <StatusLine>
          Columns are {titles.a} then {titles.b}. A dash means that summary never recorded the
          value.
        </StatusLine>

        {comparison.sections.slice(0, 1).map(section => (
          <RowTable key={section.title} title={section.title} rows={section.rows} titles={titles} />
        ))}
        <PaletteTable rows={comparison.palette} titles={titles} />
        {comparison.sections.slice(1).map(section => (
          <RowTable key={section.title} title={section.title} rows={section.rows} titles={titles} />
        ))}
      </div>
    </Section>
  );
}
