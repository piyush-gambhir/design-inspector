// Palette read at a glance (PRD SUM-03, competitive Tier 2 item 5).
//
// A real page reports hundreds of palette rows: one per role, one per shade,
// one per alpha. This view clusters the shades that read as the same swatch and
// keeps every measured member one click away, so the page's colour language is
// legible without any measurement being hidden or averaged away.
//
// Clustering is a suggestion about perception, never a claim about the site's
// tokens. The exact values stay exact.
import { useMemo, useState, type ReactNode } from 'react';
import type { ColorGroup, ColorRole } from '@/lib/contracts';
import {
  clusterPalette,
  clusterRoleCounts,
  type PaletteCluster,
} from '@/lib/readings/summary-aggregate';
import { Collapsible, Pill, StatusLine, Swatch, WindowedList } from '@/lib/ui/shared/components';
import { ExampleControls } from './ExampleControls';

export const ROLE_LABELS: Record<ColorRole, string> = {
  text: 'Text',
  background: 'Background',
  border: 'Border',
  fill: 'Fill',
  stroke: 'Stroke',
  'gradient-stop': 'Gradient',
};

/** Chip order. 'all' is always offered; the rest appear when the scan saw them. */
export const ROLE_CHIPS: ColorRole[] = [
  'text',
  'background',
  'border',
  'fill',
  'stroke',
  'gradient-stop',
];

/**
 * A fixed hue per role so a cluster's roles can be scanned quickly. The dots are
 * decoration: the same roles are written out beside them and again, with their
 * counts, inside the expanded cluster.
 */
const ROLE_DOTS: Record<ColorRole, string> = {
  text: 'oklch(0.58 0.16 265)',
  background: 'oklch(0.68 0.14 145)',
  border: 'oklch(0.72 0.15 75)',
  fill: 'oklch(0.60 0.17 320)',
  stroke: 'oklch(0.62 0.13 205)',
  'gradient-stop': 'oklch(0.65 0.18 30)',
};

export type RoleFilter = ColorRole | 'all';

function round(value: number, places = 2): string {
  return String(Number(value.toFixed(places)));
}

function RoleDots({ roles }: { roles: ColorRole[] }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {roles.map(role => (
        <span
          key={role}
          aria-hidden
          title={ROLE_LABELS[role]}
          className="size-2 rounded-full"
          style={{ background: ROLE_DOTS[role] }}
        />
      ))}
      <span className="sr-only">
        Roles: {roles.map(role => ROLE_LABELS[role]).join(', ')}
      </span>
    </span>
  );
}

/**
 * One palette row, as a fixed grid rather than a flex line.
 *
 * The four columns are a swatch, the hex at a fixed width, the roles (the only
 * column allowed to shrink, so it truncates instead of pushing anything), and
 * the count, right aligned on its own column so counts line up down the list.
 * Annotations such as an alpha value or the inferred accent go on a second line
 * under the hex: inline they collided with the hex at 320px, which is the bug
 * from screenshot 1.
 */
const ROW_GRID = 'grid grid-cols-[16px_88px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1';

function AnnotationChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-surface-3 px-1.5 text-[12px] text-muted-foreground">
      {children}
    </span>
  );
}

function PaletteRow({
  color,
  roles,
  count,
  accent,
}: {
  color: ColorGroup['color'];
  roles: ColorRole[];
  count: number;
  accent: boolean;
}) {
  const label = color.hex ?? color.raw;
  const roleNames = roles.map(role => ROLE_LABELS[role]).join(', ');
  const annotations = color.alpha < 1 || accent;
  return (
    <>
      <Swatch color={color} size={16} />
      <span className="truncate font-mono text-[12px] tabular-nums" title={label}>
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-1.5" title={roleNames}>
        <RoleDots roles={roles} />
        <span className="min-w-0 truncate text-[12px] text-muted-foreground">{roleNames}</span>
      </span>
      <span className="justify-self-end text-[12px] text-muted-foreground tabular-nums">
        x{count}
      </span>
      {annotations ? (
        <span className="col-span-3 col-start-2 flex flex-wrap items-center gap-1">
          {color.alpha < 1 ? <AnnotationChip>alpha {round(color.alpha)}</AnnotationChip> : null}
          {accent ? (
            <span className="inline-flex h-5 items-center rounded-full bg-accent-quiet px-1.5 text-[12px] text-accent-text">
              accent (inferred)
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );
}

function ClusterRow({
  cluster,
  tabId,
  expanded,
  onToggle,
}: {
  cluster: PaletteCluster;
  tabId: number | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const color = cluster.representative.color;
  const roleCounts = clusterRoleCounts(cluster);

  return (
    <li className="rounded-[8px] bg-surface-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={`${ROW_GRID} w-full rounded-[8px] p-2 text-left hover:bg-surface-3`}
      >
        <PaletteRow
          color={color}
          roles={cluster.roles}
          count={cluster.totalCount}
          accent={cluster.inferredRole === 'accent'}
        />
      </button>

      {expanded ? (
        <div className="px-2 pb-2">
          <p className="text-[12px] text-muted-foreground">
            {cluster.members.length === 1
              ? 'One measured value.'
              : `${cluster.members.length} measured values read as this swatch.`}{' '}
            {roleCounts.map(entry => `${ROLE_LABELS[entry.role]} x${entry.count}`).join(', ')}.
          </p>
          <ul className="mt-1 grid gap-1.5">
            {cluster.members.map(member => (
              <li key={`${member.role}-${member.key}`} className="group/row rounded-[8px] bg-surface p-2">
                <div className={ROW_GRID}>
                  <PaletteRow
                    color={member.color}
                    roles={[member.role]}
                    count={member.count}
                    accent={false}
                  />
                </div>
                {member.color.raw !== (member.color.hex ?? member.color.raw) ? (
                  <p className="mt-1 value-cell font-mono text-[12px] text-muted-foreground">
                    raw {member.color.raw}
                  </p>
                ) : null}
                <ExampleControls examples={member.examples} tabId={tabId} reveal />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

/** The flat, unclustered list, kept because clustering is a view and not a truth. */
function FlatList({ colors, tabId }: { colors: ColorGroup[]; tabId: number | null }) {
  // A real page reports hundreds of measured values here, and this list sits
  // inside a disclosure most readers never open. It is windowed rather than
  // built in full: nothing is hidden, the total is stated on the button.
  return (
    <div className="grid gap-1.5">
      <WindowedList items={colors} className="grid gap-1.5" noun="measured values">
        {group => (
        <li key={`${group.role}-${group.key}`} className="group/row rounded-[8px] bg-surface-2 p-2">
          <div className={ROW_GRID}>
            <PaletteRow
              color={group.color}
              roles={[group.role]}
              count={group.count}
              accent={group.inferredRole === 'accent'}
            />
          </div>
          {group.color.raw !== (group.color.hex ?? group.color.raw) ? (
            <p className="mt-1 value-cell font-mono text-[12px] text-muted-foreground">
              raw {group.color.raw}
            </p>
          ) : null}
          <ExampleControls examples={group.examples} tabId={tabId} reveal />
        </li>
        )}
      </WindowedList>
    </div>
  );
}

export function PaletteView({
  colors,
  tabId,
  clusters: stored,
}: {
  colors: ColorGroup[];
  tabId: number | null;
  /**
   * The clusters the scan already computed and stored on the summary. They
   * describe the whole palette, so they are used as they are when nothing is
   * filtered and recomputed otherwise (tester finding F11).
   */
  clusters?: PaletteCluster[];
}) {
  const [role, setRole] = useState<RoleFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const available = useMemo(
    () => ROLE_CHIPS.filter(entry => colors.some(group => group.role === entry)),
    [colors],
  );
  // A filter that the current scan cannot satisfy would silently empty the view.
  const activeRole: RoleFilter = role !== 'all' && !available.includes(role) ? 'all' : role;
  const shown = useMemo(
    () => (activeRole === 'all' ? colors : colors.filter(group => group.role === activeRole)),
    [colors, activeRole],
  );
  // Clustering a few hundred colours is not free, and the scan has already
  // done it. The stored answer only describes the unfiltered palette, so a role
  // filter, or a summary saved before the field existed, recomputes.
  const useStored = activeRole === 'all' && stored !== undefined;
  const computed = useMemo(
    () => (useStored ? [] : clusterPalette(shown)),
    [shown, useStored],
  );
  const clusters = useStored ? (stored as PaletteCluster[]) : computed;

  return (
    <div className="grid gap-2">
      <div
        role="group"
        aria-label="Filter the palette by role"
        className="flex flex-wrap items-center gap-1"
      >
        {(['all', ...available] as RoleFilter[]).map(entry => {
          const selected = entry === activeRole;
          return (
            <Pill
              key={entry}
              selected={selected}
              onClick={() => {
                setRole(entry);
                setExpanded(null);
              }}
            >
              {entry === 'all' ? 'All' : ROLE_LABELS[entry]}
            </Pill>
          );
        })}
      </div>

      {clusters.length === 0 ? (
        <StatusLine>No colors in this role.</StatusLine>
      ) : (
        <>
          <StatusLine>
            {clusters.length} {clusters.length === 1 ? 'swatch' : 'swatches'} from {shown.length}{' '}
            measured {shown.length === 1 ? 'value' : 'values'}. Near-identical shades are grouped
            for reading; open one to see its exact values.
          </StatusLine>
          <WindowedList items={clusters} className="grid gap-1.5" noun="swatches">
            {cluster => (
              <ClusterRow
                key={cluster.key}
                cluster={cluster}
                tabId={tabId}
                expanded={expanded === cluster.key}
                onToggle={() => setExpanded(expanded === cluster.key ? null : cluster.key)}
              />
            )}
          </WindowedList>
        </>
      )}

      {shown.length > 0 ? (
        <Collapsible summary={`Show all ${shown.length} occurrences`}>
          <FlatList colors={shown} tabId={tabId} />
        </Collapsible>
      ) : null}
    </div>
  );
}
