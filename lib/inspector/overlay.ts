// The overlay: box-model highlight, edge labels, hover card, pinned panel,
// badge, and highlight outlines (PRD 6.2, INS-02, INS-05).
//
// Everything lives in one open shadow root on a single host element appended
// to documentElement, so body styles cannot move it and page CSS cannot leak
// in. The root stylesheet starts with `all: initial` for that reason. The root
// is open rather than closed so browser tests can assert on it.
//
// Page-derived strings are only ever written with textContent (PRD 17.3).

import type {
  AssetReading,
  ColorValue,
  ElementSnapshot,
  Rect,
  Sides,
  SourceContext,
} from '../contracts';
import type { InspectorMode, MockupState, OutlineMode } from '../messages';
import type { StyleCategory } from '../exports';
import { formatNumber, formatPx, parsePx, roundTo } from '../readings/units';
import { parseColor } from '../readings/color';
import { contrastAgainstPicked } from '../readings/contrast';
import { describeElement } from '../readings/locator';
import { hasEyeDropper, pickPixel } from './eyedropper';
import {
  flexGapBands,
  flexMainAxis,
  parseTrackList,
  trackBands,
  type FlexAxis,
} from './layout-overlay';
import {
  measureBoxes,
  measureGuides,
  measurementCopyText,
  type BoxMeasurement,
} from './measure';
import {
  EDGE_METHOD_LABEL,
  edgesCopyText,
  nearestEdges,
  type EdgeDirection,
  type NearestEdges,
} from './edges';
import { createMockupLayer, type MockupLayer, type MockupSettings } from './mockup';
import { pxSides } from './readings';
import {
  MAJOR_STEP,
  RULER_SIZE,
  addGuide,
  listGuides,
  moveGuide,
  removeGuide,
  rulerTicks,
} from './rulers';
import { elementAtPoint } from './select';

export const HOST_TAG = 'design-inspector-host';

const CARD_GAP = 10;
const EDGE = 8;
const MAX_HIGHLIGHTS = 20;
/** Ancestor chips kept either side of the collapsed middle of a breadcrumb. */
const CRUMBS_HEAD = 1;
const CRUMBS_TAIL = 2;
const COPY_FEEDBACK_MS = 1000;
/** Picked pixels kept for the page session (PRD 17.1: nothing is persisted). */
const MAX_PICKED_HISTORY = 8;

/** A rect this wide relative to the viewport leaves no room beside it. */
const WIDE_RECT_RATIO = 0.6;
/**
 * A wide rect this tall is a band, not a line: the panel beside it would cover
 * text, so it goes above or below instead (tester UX note 7).
 */
export const WIDE_RECT_MIN_HEIGHT = 80;
/** Below this viewport width the badge starts collapsed to its dot. */
export const BADGE_COLLAPSE_WIDTH = 480;
/** Vertical room the badge needs in the top right corner. */
const BADGE_CLEARANCE = 60;
/** How far left of the right edge the badge can reach. */
const BADGE_BAND = 420;
/** Two presses on one guide inside this window remove it (tester finding F2). */
export const GUIDE_DOUBLE_MS = 400;

/**
 * What the next Escape press lets go of. `boot.ts` releases these in exactly
 * this order, and the badge says which one is next so a keyboard user does not
 * have to guess how many presses stand between them and the page (Z2).
 */
export type EscapeStep = 'menu' | 'edges' | 'measure' | 'unpin' | 'exit';

export interface EscapeStackState {
  /** An open menu or save form. */
  menuOpen: boolean;
  edgesLocked: boolean;
  measureLocked: boolean;
  pinned: boolean;
}

/** The step the next Escape press takes, given what is currently held. */
export function nextEscapeStep(state: EscapeStackState): EscapeStep {
  if (state.menuOpen) return 'menu';
  if (state.edgesLocked) return 'edges';
  if (state.measureLocked) return 'measure';
  if (state.pinned) return 'unpin';
  return 'exit';
}

/** The badge label for each step. Quiet, and short enough to sit in the row. */
export const ESCAPE_HINTS: Record<EscapeStep, string> = {
  menu: 'Esc: close form',
  edges: 'Esc: release edge lock',
  measure: 'Esc: release measure lock',
  unpin: 'Esc: unpin',
  exit: 'Esc: exit',
};

/** The whole order, said once in the pinned panel so the stack is legible. */
export const ESCAPE_ORDER_TIP =
  'Tip: Escape releases the save form, then an edge lock, then a measurement lock, ' +
  'then the pin, then exits';

export function escapeHintFor(state: EscapeStackState): string {
  return ESCAPE_HINTS[nextEscapeStep(state)];
}

/**
 * Picked colors and the layout-overlay preference live at module scope so they
 * survive leaving and re-entering the inspector on the same page. Neither ever
 * reaches storage: a reload forgets both.
 */
const pickedHistory: ColorValue[] = [];
let lastPicked: ColorValue | null = null;
let layoutOverlayEnabled = true;
/** Rulers and their guides are a page-session preference, like the above. */
let rulersEnabled = false;
/** Where the user dragged the panel, kept for the page session only. */
let draggedPanelPosition: { x: number; y: number } | null = null;
/**
 * The one-time panel tips, in the order they are offered. Each is shown for one
 * selection and stays through that selection's live re-reads, because a tip
 * that is repainted away mid-sentence is a tip nobody reads. After the list is
 * exhausted the tip line is gone for the rest of the page session.
 */
const PANEL_TIPS: readonly string[] = ['Tip: ArrowUp selects the parent', ESCAPE_ORDER_TIP];
let tipIndex = 0;
let tipFor: Element | null = null;
/**
 * Whether the user has taken the badge's collapse decision away from the
 * viewport. Until they press the control the badge follows the window width;
 * after that their choice stands until the page is reloaded (Z1).
 */
let badgeCollapseChoice: 'collapsed' | 'expanded' | null = null;
/**
 * Whether a side panel is open for this tab. The panel hosts the same tools, so
 * the badge steps aside to its dot for as long as the panel is there (W2).
 */
let badgeSidepanelOpen = false;

/** What the collapsed dot says on hover while the side panel holds the tools. */
export const BADGE_SIDEPANEL_TITLE = 'Controls are in the side panel. Click to expand.';
/** What it says the rest of the time. */
export const BADGE_EXPAND_TITLE = 'Click to expand';

/**
 * Record a collapse decision and answer with the state the badge should be in.
 * Kept out of `createOverlay` because the decision also arrives while there is
 * no badge on screen: a side panel can open before the inspector is switched on.
 *
 * A press on the control ('user') stands until the page is reloaded. A presence
 * change ('sidepanel') takes the decision back, because an expansion sticks
 * only until the panel opens or closes; a panel that closes leaves the badge
 * collapsed only when the user collapsed it themselves (W2).
 */
export function recordBadgeCollapse(
  collapsed: boolean,
  reason: 'sidepanel' | 'user',
): boolean {
  if (reason === 'user') {
    badgeCollapseChoice = collapsed ? 'collapsed' : 'expanded';
    return collapsed;
  }
  badgeSidepanelOpen = collapsed;
  if (collapsed) {
    badgeCollapseChoice = null;
    return true;
  }
  if (badgeCollapseChoice === 'collapsed') return true;
  badgeCollapseChoice = null;
  return narrowViewport();
}

/** True while a side panel is open for this page, badge or no badge. */
export function badgeSidepanelPresence(): boolean {
  return badgeSidepanelOpen;
}

/** The rulers preference, readable with no overlay on screen. */
export function currentRulers(): boolean {
  return rulersEnabled;
}

/** The same preference, set from the side panel while the inspector is off. */
export function setRulersEnabled(enabled: boolean): void {
  rulersEnabled = enabled;
}

/** The grid and flex overlay preference, readable with no overlay on screen. */
export function currentLayoutOverlay(): boolean {
  return layoutOverlayEnabled;
}

export function setLayoutOverlayEnabled(enabled: boolean): void {
  layoutOverlayEnabled = enabled;
}

/** Test seam: forgets the dragged panel position and the one-time tips. */
export function resetOverlaySession(): void {
  draggedPanelPosition = null;
  tipIndex = 0;
  tipFor = null;
  rulersEnabled = false;
  layoutOverlayEnabled = true;
  badgeCollapseChoice = null;
  badgeSidepanelOpen = false;
}

/**
 * True when the element is actually painting something right now. A connected
 * element with no client rects (or one `checkVisibility` rejects) is hidden by
 * a breakpoint or a toggle, not gone (PRD 19.3).
 */
export function isElementRendered(element: Element): boolean {
  if (!element.isConnected) return false;
  try {
    if (element.getClientRects().length === 0) return false;
  } catch {
    return true;
  }
  const check = (element as Element & { checkVisibility?: () => boolean }).checkVisibility;
  if (typeof check !== 'function') return true;
  try {
    return check.call(element) !== false;
  } catch {
    return true;
  }
}

export type CardCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * The corner whose card overlaps the selected rect least. A hero band that
 * spans the viewport cannot be stepped around, so the panel takes the corner
 * that covers the least of it; a tie prefers the right, where the panel
 * normally lives (PRD 6.2).
 */
export function chooseCardCorner(
  target: Rect,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  edge = EDGE,
): CardCorner {
  const left = edge;
  const right = Math.max(edge, viewport.width - card.width - edge);
  const top = edge;
  const bottom = Math.max(edge, viewport.height - card.height - edge);

  const corners: { corner: CardCorner; rect: Rect }[] = [
    { corner: 'top-right', rect: { x: right, y: top, width: card.width, height: card.height } },
    { corner: 'bottom-right', rect: { x: right, y: bottom, width: card.width, height: card.height } },
    { corner: 'top-left', rect: { x: left, y: top, width: card.width, height: card.height } },
    { corner: 'bottom-left', rect: { x: left, y: bottom, width: card.width, height: card.height } },
  ];

  let best = corners[0] as { corner: CardCorner; rect: Rect };
  let bestOverlap = Number.POSITIVE_INFINITY;
  for (const candidate of corners) {
    const overlap = overlapArea(candidate.rect, target);
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      best = candidate;
    }
  }
  return best.corner;
}

/**
 * Where to put the panel for a rect that spans the viewport and is tall enough
 * to hold text: below it, or above it, whichever has more room (tester UX note
 * 7). A hero heading is 1200px wide and 120px tall, and a panel placed beside
 * it lands on the words. Null means neither band fits and the caller should
 * fall back to the least-overlap corner.
 *
 * Pure: no layout is read here, so the rule is unit testable.
 */
export function chooseWidePlacement(
  target: Rect,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  edge = EDGE,
  gap = CARD_GAP,
): { x: number; y: number } | null {
  if (target.width < viewport.width * WIDE_RECT_RATIO) return null;
  if (target.height <= WIDE_RECT_MIN_HEIGHT) return null;

  const below = viewport.height - (target.y + target.height) - gap - edge;
  const above = target.y - gap - edge;
  const preferBelow = below >= above;
  const room = preferBelow ? below : above;
  if (room < card.height) return null;

  const y = preferBelow ? target.y + target.height + gap : target.y - gap - card.height;
  const x = clamp(target.x, edge, Math.max(edge, viewport.width - card.width - edge));
  return { x, y: clamp(y, edge, Math.max(edge, viewport.height - card.height - edge)) };
}

function overlapArea(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

function rememberPicked(color: ColorValue): void {
  lastPicked = color;
  const key = (color.hex ?? color.raw).toLowerCase();
  const existing = pickedHistory.findIndex(
    (entry) => (entry.hex ?? entry.raw).toLowerCase() === key,
  );
  if (existing >= 0) pickedHistory.splice(existing, 1);
  pickedHistory.unshift(color);
  if (pickedHistory.length > MAX_PICKED_HISTORY) pickedHistory.length = MAX_PICKED_HISTORY;
}

/** Test seam: clears the module-level picked memory. */
export function resetPickedColors(): void {
  pickedHistory.length = 0;
  lastPicked = null;
}

export interface DownloadRequest {
  url?: string;
  dataUrl?: string;
  filename: string;
}

export interface SaveRequest {
  title: string;
  note: string;
  captureScreenshot: boolean;
}

/** What a network round trip can add to an asset row that the DOM cannot. */
export interface AssetDetails {
  fileSize: number | null;
  mimeType: string | null;
}

export interface OverlayCallbacks {
  onExit(): void;
  onTogglePaused(): void;
  /** Badge button: cycles layout outlines off to the configured coloring. */
  onToggleOutlines(): void;
  /** Badge button: rulers and their guides on or off (competitive Tier 2). */
  onToggleRulers(): void;
  /**
   * Badge button: "Prefer semantic parents". This lives on the badge rather
   * than in the popup because `Settings` belongs to another contract and adding
   * a field to it is out of this workstream's bounds, so the preference is a
   * per-page-session toggle.
   */
  onToggleSemanticParents(): void;
  /**
   * The pinned panel's "Layout overlay" toggle was pressed. The overlay has
   * already applied it; this is how the side panel's mirror of the same tool
   * learns about it (W3).
   */
  onToggleLayoutOverlay(): void;
  /** The badge's own collapse control was pressed, dot to row or back (W2). */
  onToggleBadge(): void;
  /** Badge button: show or hide the mockup overlay without forgetting it. */
  onToggleMockupVisible(): void;
  onUnpin(): void;
  onSelectAncestor(index: number): void;
  /**
   * The breadcrumb's trailing child chip: the inline wrapper a click was
   * promoted away from (competitive tester note, PRD INS-04).
   */
  onSelectChild(): void;
  onNavigate(direction: 'up' | 'down'): void;
  onReread(): void;
  /** Resolves with an error string, or null on success. */
  onDownload(request: DownloadRequest): Promise<string | null>;
  /**
   * File size and MIME type for one asset URL, which costs a request to that
   * asset's host. Resolves with an error string when it cannot be answered.
   */
  onAssetDetails(url: string): Promise<AssetDetails | string>;
  onSave(request: SaveRequest): Promise<string | null>;
  /** Returns the text to copy, or null when the exporter is unavailable. */
  cssFor(category: StyleCategory): string | null;
  tailwindFor(category: StyleCategory): string | null;
  /**
   * Closest-standard Tailwind (PRD EXP-02 mode 2). Null while the adapter is
   * missing, which the button reports as "Copy unavailable" rather than
   * pretending to have copied something.
   */
  tailwindClosestFor(category: StyleCategory): string | null;
  /** The mockup's settings changed on the page: drag or arrow-key nudge. */
  onMockupMoved(state: MockupSettings): void;
}

export interface Overlay {
  host: HTMLElement;
  root: ShadowRoot;
  setMode(mode: InspectorMode): void;
  /** Reflects the current layout-outline mode on the badge toggle. */
  setOutlines(mode: OutlineMode): void;
  setHover(snapshot: ElementSnapshot | null, element: Element | null): void;
  /**
   * `child` is the inline wrapper a click was promoted away from, shown as the
   * trailing breadcrumb chip so the wrapper stays one click away.
   */
  setPinned(
    snapshot: ElementSnapshot | null,
    element: Element | null,
    options?: { child?: Element | null },
  ): void;
  markPinnedMissing(): void;
  /**
   * The pinned element is still in the document but renders nothing right now.
   * The readings stay on screen, dimmed, and the bands come off until it
   * renders again (PRD 19.3).
   */
  setPinnedHidden(hidden: boolean): void;
  /**
   * Alt measurement against a second element (PRD LAY-02). Null clears it.
   * A locked measurement survives releasing Alt until it is cleared.
   */
  setMeasure(element: Element | null, options?: { locked?: boolean }): void;
  measureLocked(): boolean;
  /**
   * Point-to-edge measurement (competitive Tier 2 item 3). The point is in
   * viewport coordinates; null clears the reading. A locked reading survives
   * releasing Shift until Escape clears it.
   */
  setEdges(point: { x: number; y: number } | null, options?: { locked?: boolean }): void;
  edgesLocked(): boolean;
  /** Rulers and guides on or off, reflected on the badge. */
  setRulers(enabled: boolean): void;
  rulersOn(): boolean;
  /** Reflects the per-session "Prefer semantic parents" toggle on the badge. */
  setSemanticParents(enabled: boolean): void;
  /** The grid and flex overlay for the pinned element, on or off. */
  setLayoutOverlay(enabled: boolean): void;
  layoutOverlayOn(): boolean;
  /**
   * Collapse the badge to its dot, or expand it again. 'sidepanel' is a panel
   * opening or closing, 'user' is a deliberate press somewhere else (W2).
   */
  setBadgeCollapsed(collapsed: boolean, reason: 'sidepanel' | 'user'): void;
  /** True while the badge is showing nothing but its dot. */
  badgeCollapsed(): boolean;
  /** The mockup overlay for this page. Null clears it. */
  setMockup(mockup: MockupState | null): void;
  /** The current mockup settings, without the image. Null when there is none. */
  mockupState(): MockupSettings | null;
  /**
   * Pointer dragging for an unlocked mockup. The image itself never takes
   * pointer events, so `select.ts` offers it every pointerdown and starts a
   * drag only when this says the point belongs to the mockup.
   */
  mockupDragStart(point: { x: number; y: number }): boolean;
  mockupDragMove(point: { x: number; y: number }): void;
  mockupDragEnd(): void;
  reposition(): void;
  setVisible(visible: boolean): void;
  highlight(elements: Element[]): void;
  clearHighlight(): void;
  setScanProgress(scanned: number, total: number | null): void;
  closeMenu(): boolean;
  hasOpenMenu(): boolean;
  owns(node: Node | null | undefined): boolean;
  panelHasFocus(): boolean;
  focusPanel(): void;
  hasTextSelection(): boolean;
  msSinceCopy(): number;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Stylesheet. Inlined so no extension resource has to be web accessible.

const STYLES = `
:host {
  all: initial;
  font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
  color-scheme: light dark;
  /* The accent carries white text on the one filled button, which is normal
     sized text and so owes 4.5:1: at 0.62 that was 3.58:1. Its text colour is
     its own token, because in dark mode the accent is light and the text on it
     has to be dark. Accent coloured *text* is a third token, mixed toward the
     foreground, because the fill that carries white is too light to be read on
     a white surface. Measured in both schemes; see the report for V4. */
  --di-accent: oklch(0.55 0.19 255);
  --di-accent-foreground: oklch(0.99 0 0);
  --di-accent-text: color-mix(in oklab, var(--di-accent) 80%, var(--di-text));
  --di-accent-quiet: oklch(0.55 0.19 255 / 0.14);
  --di-surface-1: oklch(0.995 0 0);
  --di-surface-2: oklch(0.965 0.002 255);
  --di-surface-3: oklch(0.925 0.004 255);
  --di-text: oklch(0.24 0.012 260);
  /* Muted text sits on surface-3 in every section head: 0.52 measured 4.41:1
     there, which is a fail. */
  --di-text-muted: oklch(0.50 0.012 260);
  --di-shadow: 0 18px 48px -14px oklch(0.25 0.04 260 / 0.3);
  --di-check: oklch(0.85 0 0);
  --di-tint-content: oklch(0.62 0.17 255 / 0.3);
  --di-tint-padding: oklch(0.62 0.17 255 / 0.16);
  --di-tint-border: oklch(0.45 0.01 260 / 0.22);
  --di-tint-margin: oklch(0.65 0.02 60 / 0.2);
}

@media (prefers-color-scheme: dark) {
  :host {
    --di-accent: oklch(0.73 0.15 255);
    --di-accent-foreground: oklch(0.16 0 0);
    --di-accent-quiet: oklch(0.73 0.15 255 / 0.2);
    --di-surface-1: oklch(0.215 0.012 262);
    --di-surface-2: oklch(0.265 0.014 262);
    --di-surface-3: oklch(0.325 0.016 262);
    --di-text: oklch(0.96 0.004 262);
    --di-text-muted: oklch(0.74 0.01 262);
    --di-shadow: 0 20px 52px -14px oklch(0.06 0.02 262 / 0.72);
    --di-check: oklch(0.42 0 0);
  }
}

* { box-sizing: border-box; margin: 0; padding: 0; font: inherit; color: inherit; }

.layer { position: absolute; inset: 0; pointer-events: none; }

.band { position: absolute; border-style: solid; border-color: transparent; }
#band-margin { border-color: var(--di-tint-margin); }
#band-border { border-color: var(--di-tint-border); }
#band-padding { border-color: var(--di-tint-padding); }
#band-content { position: absolute; background: var(--di-tint-content); }

.edge-label {
  position: absolute;
  transform: translate(-50%, -50%);
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--di-surface-1);
  color: var(--di-text);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  box-shadow: 0 2px 8px -4px oklch(0.2 0.02 260 / 0.5);
}
.edge-label.negative { color: var(--di-accent-text); }

.outline {
  position: absolute;
  outline: 2px solid var(--di-accent);
  outline-offset: 1px;
  border-radius: 2px;
  background: var(--di-accent-quiet);
}

/* Grid, flex, and measurement drawing. One accent, no hairline panels. */
.grid-line { position: absolute; background: var(--di-accent); opacity: 0.55; }
.tint-band { position: absolute; background: var(--di-accent-quiet); }
.axis-line { position: absolute; background: var(--di-accent); opacity: 0.5; }
.axis-arrow { position: absolute; width: 0; height: 0; border-style: solid; border-color: transparent; }
.guide-line { position: absolute; background: var(--di-accent); }
.measure-outline {
  position: absolute;
  outline: 2px dashed var(--di-accent);
  outline-offset: 1px;
  border-radius: 2px;
}

/* Point-to-edge guides: dashed, so they never read as a box-model band. */
.edge-guide { position: absolute; background: var(--di-accent); opacity: 0.8; }
.edge-dot {
  position: absolute;
  width: 7px;
  height: 7px;
  margin: -3px 0 0 -3px;
  border-radius: 50%;
  background: var(--di-accent);
}

/* Rulers and guides. The strips take pointer events; the rest of the layer
   does not, so the page stays clickable everywhere else. */
#ruler-layer[hidden] { display: none; }
.ruler {
  position: absolute;
  background: var(--di-surface-1);
  color: var(--di-text-muted);
  pointer-events: auto;
  overflow: hidden;
}
#ruler-top { top: 0; left: 0; right: 0; height: ${RULER_SIZE}px; cursor: col-resize; }
#ruler-left { top: 0; left: 0; bottom: 0; width: ${RULER_SIZE}px; cursor: row-resize; }
#ruler-corner {
  position: absolute;
  top: 0;
  left: 0;
  width: ${RULER_SIZE}px;
  height: ${RULER_SIZE}px;
  background: var(--di-surface-2);
  pointer-events: auto;
}
/* The tick strip is built once per viewport size and translated on scroll, so
   a scrolling page costs one transform per axis and no DOM work at all. It is
   a little longer than the viewport, by one major step, so the translation
   never uncovers an empty edge. The accent marks follow the hovered element
   rather than the scroll, so they live in their own, untranslated layer. */
.ruler-strip { position: absolute; top: 0; left: 0; will-change: transform; }
#ruler-top .ruler-strip { height: ${RULER_SIZE}px; }
#ruler-left .ruler-strip { width: ${RULER_SIZE}px; }
.ruler-marks { position: absolute; top: 0; left: 0; }
.tick { position: absolute; background: var(--di-text-muted); opacity: 0.55; }
.tick-label {
  position: absolute;
  font-size: 9px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--di-text-muted);
  white-space: nowrap;
}
.ruler-mark { position: absolute; background: var(--di-accent); }
.page-guide { position: absolute; pointer-events: auto; }
.page-guide i { position: absolute; display: block; background: var(--di-accent); }
.page-guide[data-axis="x"] { width: 9px; margin-left: -4px; top: 0; bottom: 0; cursor: col-resize; }
.page-guide[data-axis="x"] i { left: 4px; top: 0; bottom: 0; width: 1px; }
.page-guide[data-axis="y"] { height: 9px; margin-top: -4px; left: 0; right: 0; cursor: row-resize; }
.page-guide[data-axis="y"] i { top: 4px; left: 0; right: 0; height: 1px; }
.page-guide:focus-visible { outline: 2px solid var(--di-accent); outline-offset: 0; }
/* The guide's own remove control. A guide captures its pointer for dragging,
   so the browser never delivers a dblclick to it; this, a double pointerdown,
   and the Delete key are the three ways out (tester finding F2). */
.guide-remove {
  position: absolute;
  width: 16px;
  height: 16px;
  padding: 0;
  border-radius: 50%;
  line-height: 14px;
  text-align: center;
  background: var(--di-surface-1);
  color: var(--di-text-muted);
  box-shadow: 0 2px 8px -4px oklch(0.2 0.02 260 / 0.5);
  opacity: 0;
  cursor: pointer;
}
.page-guide[data-axis="x"] .guide-remove { left: -4px; top: ${RULER_SIZE + 4}px; }
.page-guide[data-axis="y"] .guide-remove { top: -4px; left: ${RULER_SIZE + 4}px; }
.page-guide:hover .guide-remove,
.page-guide:focus-within .guide-remove,
.guide-remove:focus-visible { opacity: 1; }

.card {
  position: absolute;
  max-width: 340px;
  background: var(--di-surface-1);
  color: var(--di-text);
  border-radius: 10px;
  box-shadow: var(--di-shadow);
  pointer-events: auto;
  overflow: hidden;
}
#hover-card { max-width: 300px; padding: 8px 10px; }
#panel { width: 340px; display: flex; flex-direction: column; max-height: 72vh; }
#pick-card { top: 56px; right: 12px; width: 240px; padding: 8px 10px; }
/* The edge reading needs somewhere to live when nothing is pinned, so it has
   its own card as well as a block inside the panel. */
#edge-card { bottom: 12px; left: 12px; width: 240px; padding: 8px 10px; }
#panel[hidden], #hover-card[hidden], #badge[hidden], #pick-card[hidden], #edge-card[hidden] { display: none; }

.picked-swatches { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 0; }
.picked-swatches .swatch { width: 16px; height: 16px; margin-right: 0; }
.measure-block { margin-top: 8px; border-radius: 8px; background: var(--di-surface-2); overflow: hidden; }
.measure-block[hidden] { display: none; }
.measure-head { display: flex; align-items: center; gap: 4px; padding: 6px 8px; background: var(--di-surface-3); }
.measure-head span { flex: 1; font-weight: 600; }
.measure-body { padding: 4px 8px 7px; }

.panel-scroll { overflow: auto; padding: 0 10px 10px; overscroll-behavior: contain; }

.panel-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 10px 7px;
  background: var(--di-surface-2);
  cursor: grab;
  touch-action: none;
}
.panel-head[data-dragging="true"] { cursor: grabbing; }
.panel-title { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel-hidden-note { color: var(--di-accent-text); padding: 3px 0; }
#panel[data-hidden-element="true"] .panel-scroll { opacity: 0.55; }
.tip { color: var(--di-text-muted); padding: 2px 0 4px; }

.chip {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--di-surface-3);
  color: var(--di-text-muted);
  font-size: 12px;
}
.chip.accent { background: var(--di-accent-quiet); color: var(--di-text); }

.crumbs { display: flex; flex-wrap: wrap; gap: 4px; padding: 7px 0; }

button {
  appearance: none;
  border: 0;
  border-radius: 6px;
  background: var(--di-surface-2);
  color: var(--di-text);
  padding: 3px 7px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
button:hover { background: var(--di-surface-3); }
button:focus-visible { outline: 2px solid var(--di-accent); outline-offset: 2px; }
button.quiet { background: transparent; color: var(--di-text-muted); padding: 2px 5px; }
button.quiet:hover { background: var(--di-surface-2); color: var(--di-text); }
button.crumb { background: var(--di-surface-2); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The pinned element's own chip is a label too, and a long selector should not
   set the panel's width. */
.chip.crumb-current { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button.crumb-more { background: var(--di-surface-2); font-variant-numeric: tabular-nums; }
button.primary { background: var(--di-accent); color: var(--di-accent-foreground); }

.section { margin-top: 8px; border-radius: 8px; background: var(--di-surface-2); overflow: hidden; }
.section[hidden] { display: none; }
/* One line at any panel width: the name takes what is left and truncates, the
   copy control keeps its size. */
.section-head { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: var(--di-surface-3); }
.section-name { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.section-head .copy-toggle { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 3px; }
.section-head .copy-toggle .chevron { line-height: 1; }
.section-body { padding: 4px 8px 7px; }

/* The section's copy menu. It opens under the head, inside the section, so it
   is never clipped by the card and never covers the reading below it. */
.copy-menu { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0 2px; }
.copy-menu[hidden] { display: none; }
.copy-menu button { background: var(--di-surface-3); }
.copy-menu button:hover { background: var(--di-surface-1); }

.row { display: flex; align-items: center; gap: 6px; padding: 2px 0; min-height: 20px; }
.row-key { color: var(--di-text-muted); flex: 0 0 104px; }
.row-value { flex: 1; min-width: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
/* A URL reads as one line with the rest behind a tooltip and the Copy button;
   wrapped, it is six lines of hash in a 340px panel. */
.row-value.one-line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .row-copy { opacity: 0; }
.row:hover .row-copy, .row:focus-within .row-copy { opacity: 1; }

.swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  vertical-align: -2px;
  margin-right: 5px;
  background-image:
    linear-gradient(45deg, var(--di-check) 25%, transparent 25%, transparent 75%, var(--di-check) 75%),
    linear-gradient(45deg, var(--di-check) 25%, transparent 25%, transparent 75%, var(--di-check) 75%);
  background-size: 6px 6px;
  background-position: 0 0, 3px 3px;
  overflow: hidden;
}
.swatch i { display: block; width: 100%; height: 100%; }

.note { color: var(--di-text-muted); padding: 3px 0; }
.limitations { margin-top: 8px; color: var(--di-text-muted); }
.limitations li { margin-left: 14px; }

/* The four panel actions: two rows of two, equal widths, nothing wrapping
   unevenly, and one accent button among three tonal ones. */
.panel-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
.panel-actions button { width: 100%; padding: 5px 7px; text-align: center; }

.save-form { display: none; flex-direction: column; gap: 6px; margin-top: 8px; }
.save-form[data-open="true"] { display: flex; }
input[type="text"], textarea {
  width: 100%;
  border: 0;
  border-radius: 6px;
  background: var(--di-surface-2);
  color: var(--di-text);
  padding: 5px 7px;
  font: inherit;
}
textarea { min-height: 48px; resize: vertical; }
label.check { display: flex; align-items: center; gap: 6px; color: var(--di-text-muted); }
.form-actions { display: flex; gap: 6px; align-items: center; }

#badge {
  position: absolute;
  /* Shifted down so the site's own top navigation stays reachable. */
  top: 20px;
  right: 12px;
  display: flex;
  align-items: center;
  /* A phone viewport cannot hold the row, so it wraps rather than running off
     the left edge of the screen (tester finding F6). */
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: calc(100vw - 16px);
  gap: 6px;
  row-gap: 4px;
  padding: 6px 8px;
  border-radius: 999px;
  background: var(--di-surface-1);
  color: var(--di-text);
  box-shadow: var(--di-shadow);
  pointer-events: auto;
}
#badge-status { display: flex; align-items: center; gap: 5px; font-weight: 600; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--di-accent); }
#badge[data-mode="paused"] .dot { background: var(--di-text-muted); }
#badge-collapse { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px; }
#badge-collapse .chevron { font-size: 11px; line-height: 1; }
#badge[data-collapsed="true"] { padding: 5px; gap: 0; }
#badge[data-collapsed="true"] #badge-status,
#badge[data-collapsed="true"] #badge-escape,
#badge[data-collapsed="true"] #badge-progress,
#badge[data-collapsed="true"] #badge-outlines,
#badge[data-collapsed="true"] #badge-rulers,
#badge[data-collapsed="true"] #badge-semantic,
#badge[data-collapsed="true"] #badge-mockup,
#badge[data-collapsed="true"] #badge-pick,
#badge[data-collapsed="true"] .badge-action,
#badge[data-collapsed="true"] #badge-collapse .chevron { display: none; }
#badge-outlines[aria-pressed="true"],
#badge-rulers[aria-pressed="true"],
#badge-semantic[aria-pressed="true"],
#badge-mockup[aria-pressed="true"] { background: var(--di-accent-quiet); color: var(--di-text); }
#badge-mockup[hidden] { display: none; }
#badge-progress { color: var(--di-text-muted); }
/* The Escape hint is for the keyboard; a pointer user can read past it. */
#badge-escape { color: var(--di-text-muted); font-variant-numeric: tabular-nums; }

.stack { display: flex; flex-direction: column; gap: 2px; }
/* A stack inside a section is a column of readings, so a button in it keeps its
   own width and its left edge rather than stretching across and centring. */
.section-body .stack { align-items: flex-start; }
.hover-title { font-weight: 600; margin-bottom: 3px; }
.hover-row { display: flex; gap: 6px; align-items: baseline; }
.hover-row span:first-child { color: var(--di-text-muted); flex: 0 0 82px; }
/* A font stack or a URL is longer than the card: it wraps inside its column
   instead of pushing the card wider or spilling out of it. */
.hover-row span:last-child { min-width: 0; flex: 1; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
`;

// ---------------------------------------------------------------------------
// Small DOM helpers

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text: string, className: string, ariaLabel?: string): HTMLButtonElement {
  const node = h('button', className, text);
  node.type = 'button';
  node.setAttribute('aria-label', ariaLabel ?? text);
  return node;
}

function place(node: HTMLElement, rect: Rect): void {
  node.style.left = `${rect.x}px`;
  node.style.top = `${rect.y}px`;
  node.style.width = `${Math.max(0, rect.width)}px`;
  node.style.height = `${Math.max(0, rect.height)}px`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/** True on a viewport too narrow to hold the badge's full row. */
function narrowViewport(): boolean {
  const width = typeof window === 'undefined' ? 0 : window.innerWidth;
  return width > 0 && width < BADGE_COLLAPSE_WIDTH;
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path, which works without permissions.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('aria-hidden', 'true');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function filenameFromUrl(url: string, fallback: string): string {
  if (/^data:/i.test(url)) return fallback;
  try {
    const parsed = new URL(url, document.baseURI);
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // Not a parseable URL; use the fallback.
  }
  return fallback;
}

/** Extension for a data URL asset, so a download still gets a sensible name. */
function extensionForDataUrl(url: string): string {
  const match = /^data:([\w.+-]+)\/([\w.+-]+)/i.exec(url);
  const subtype = match?.[2]?.toLowerCase();
  if (!subtype) return 'bin';
  if (subtype === 'svg+xml') return 'svg';
  if (subtype === 'jpeg') return 'jpg';
  return subtype;
}

const FONT_FILE = /\.(woff2|woff|ttf|otf|eot)(\?|#|$)/i;

function safeName(label: string): string {
  return label.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'asset';
}

// ---------------------------------------------------------------------------
// Size readings.
//
// The overlay writes readings code-style, with the unit against the number
// ("16.12px", "1.125rem"), which is how they would be typed into CSS. Which
// value leads depends on the page: a root font size that scales with the
// viewport makes every px reading true only at this width, so the rem value
// goes first and the px value follows it as the reading at this width.

function remText(value: number, rootFontSize: number): string | null {
  if (!Number.isFinite(rootFontSize) || rootFontSize <= 0) return null;
  return `${formatNumber(roundTo(value / rootFontSize, 3), 3)}rem`;
}

function sizeText(value: number, source: SourceContext): string {
  const rem = remText(value, source.rootFontSize);
  if (!rem) return formatPx(value);
  return source.rootFontSizeFluid
    ? `${rem} · ${formatPx(value)} at this width`
    : `${formatPx(value)} · ${rem}`;
}

/** The same reading without the trailing clause, for the small hover card. */
function sizeTextCompact(value: number, source: SourceContext): string {
  const rem = remText(value, source.rootFontSize);
  if (!rem) return formatPx(value);
  return source.rootFontSizeFluid
    ? `${rem} · ${formatPx(value)}`
    : `${formatPx(value)} · ${rem}`;
}

/** What Copy puts on the clipboard for a size row: the stable value. */
function sizeCopyText(value: number, source: SourceContext): string {
  const rem = remText(value, source.rootFontSize);
  return source.rootFontSizeFluid && rem ? rem : `${value}px`;
}

/**
 * A width by height reading. Both numbers carry the unit: one trailing "px"
 * reads as though only the second value had one, and a Rendered row in px
 * beside an Intrinsic row without one reads as an oversight.
 */
function sizePair(width: number, height: number): string {
  return `${formatPx(width)} x ${formatPx(height)}`;
}

function fluidRootNote(source: SourceContext): string {
  return (
    `Root font size is ${formatPx(source.rootFontSize)} and scales with the viewport, ` +
    'so px values change with the window; rem is the stable reading.'
  );
}

function sidesText(values: Sides<number>): string {
  const parts = [values.top, values.right, values.bottom, values.left].map((value) =>
    formatNumber(roundTo(value, 2), 2),
  );
  // Every side carries its own unit. One trailing "px" on a four value row read
  // as though only the last value had a unit ("0 0 12 0px").
  return parts.every((part) => part === parts[0])
    ? `${parts[0]}px`
    : parts.map((part) => `${part}px`).join(' ');
}

// ---------------------------------------------------------------------------
// Box geometry

interface BoxGeometry {
  margin: Rect;
  border: Rect;
  padding: Rect;
  content: Rect;
  marginValues: Sides<number>;
  paddingValues: Sides<number>;
  borderValues: Sides<number>;
}

/**
 * The box model as rects, from values already measured.
 *
 * Kept separate from the reading so the hover path can build the highlight out
 * of the snapshot it has just taken instead of measuring the same element a
 * second time: one `getComputedStyle`, twelve property reads and one
 * `getBoundingClientRect` saved per frame (PERF 3).
 */
function geometryFrom(
  rect: Rect,
  marginValues: Sides<number>,
  paddingValues: Sides<number>,
  borderValues: Sides<number>,
): BoxGeometry | null {
  if (rect.width === 0 && rect.height === 0) return null;
  const clamp = (value: number): number => Math.max(0, value);

  const border: Rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const margin: Rect = {
    x: border.x - clamp(marginValues.left),
    y: border.y - clamp(marginValues.top),
    width: border.width + clamp(marginValues.left) + clamp(marginValues.right),
    height: border.height + clamp(marginValues.top) + clamp(marginValues.bottom),
  };
  const padding: Rect = {
    x: border.x + borderValues.left,
    y: border.y + borderValues.top,
    width: Math.max(0, border.width - borderValues.left - borderValues.right),
    height: Math.max(0, border.height - borderValues.top - borderValues.bottom),
  };
  const content: Rect = {
    x: padding.x + paddingValues.left,
    y: padding.y + paddingValues.top,
    width: Math.max(0, padding.width - paddingValues.left - paddingValues.right),
    height: Math.max(0, padding.height - paddingValues.top - paddingValues.bottom),
  };

  return { margin, border, padding, content, marginValues, paddingValues, borderValues };
}

function geometryOf(element: Element): BoxGeometry | null {
  let style: CSSStyleDeclaration;
  try {
    style = getComputedStyle(element);
  } catch {
    return null;
  }
  const rect = element.getBoundingClientRect();
  return geometryFrom(
    { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    pxSides(style, 'margin'),
    pxSides(style, 'padding'),
    pxSides(style, 'border'),
  );
}

/** The same geometry, out of a snapshot's layout reading. */
function geometryOfLayout(layout: ElementSnapshot['layout']): BoxGeometry | null {
  return geometryFrom(layout.visualRect, layout.margin, layout.padding, layout.border);
}

// ---------------------------------------------------------------------------
// Overlay

export function createOverlay(callbacks: OverlayCallbacks): Overlay {
  const host = document.createElement(HOST_TAG);
  host.setAttribute('aria-hidden', 'false');
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;pointer-events:none;contain:layout style;';
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  root.appendChild(style);

  // Grid and flex drawing sits under the box-model bands, so a pinned
  // element's own padding and margin still read on top of its track lines.
  const layoutLayer = h('div', 'layer');
  layoutLayer.id = 'layout-layer';

  const boxLayer = h('div', 'layer');
  const bandMargin = h('div', 'band');
  bandMargin.id = 'band-margin';
  const bandBorder = h('div', 'band');
  bandBorder.id = 'band-border';
  const bandPadding = h('div', 'band');
  bandPadding.id = 'band-padding';
  const bandContent = h('div');
  bandContent.id = 'band-content';
  const labelLayer = h('div', 'layer');
  boxLayer.append(bandMargin, bandBorder, bandPadding, bandContent);
  const measureLayer = h('div', 'layer');
  measureLayer.id = 'measure-layer';
  const edgeLayer = h('div', 'layer');
  edgeLayer.id = 'edge-layer';
  const highlightLayer = h('div', 'layer');

  // Rulers sit above the drawing layers and below the cards: a guide should be
  // visible over the page, and the panel should still be readable over a guide.
  const rulerLayer = h('div', 'layer');
  rulerLayer.id = 'ruler-layer';
  rulerLayer.hidden = true;
  const rulerTop = h('div', 'ruler');
  rulerTop.id = 'ruler-top';
  const rulerLeft = h('div', 'ruler');
  rulerLeft.id = 'ruler-left';
  // Ticks and labels live in a strip that only ever moves by transform; the
  // accent marks are redrawn from the hovered rect and stay out of it.
  const rulerTopStrip = h('div', 'ruler-strip');
  const rulerLeftStrip = h('div', 'ruler-strip');
  const rulerTopMarks = h('div', 'ruler-marks');
  const rulerLeftMarks = h('div', 'ruler-marks');
  rulerTop.append(rulerTopStrip, rulerTopMarks);
  rulerLeft.append(rulerLeftStrip, rulerLeftMarks);
  const rulerCorner = h('div');
  rulerCorner.id = 'ruler-corner';
  const guideLayer = h('div', 'layer');
  guideLayer.id = 'guide-layer';
  rulerLayer.append(guideLayer, rulerTop, rulerLeft, rulerCorner);

  const hoverCard = h('div', 'card');
  hoverCard.id = 'hover-card';
  hoverCard.hidden = true;

  const pickCard = h('div', 'card');
  pickCard.id = 'pick-card';
  pickCard.hidden = true;

  const edgeCard = h('div', 'card');
  edgeCard.id = 'edge-card';
  edgeCard.hidden = true;

  const panel = h('div', 'card');
  panel.id = 'panel';
  panel.hidden = true;
  panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Design Inspector element details');

  const badge = h('div');
  badge.id = 'badge';
  badge.hidden = true;
  const badgeStatus = h('div');
  badgeStatus.id = 'badge-status';
  const badgeDot = h('span', 'dot');
  const badgeText = h('span', undefined, 'Inspecting');
  badgeStatus.append(badgeText);
  // The collapse control carries the status dot, so a collapsed badge is a dot
  // that is still the button that brings the badge back.
  const collapseButton = button('', 'quiet', 'Collapse the Design Inspector badge');
  collapseButton.id = 'badge-collapse';
  const collapseChevron = h('span', 'chevron', '⌃');
  collapseButton.append(badgeDot, collapseChevron);
  const badgeProgress = h('span');
  badgeProgress.id = 'badge-progress';
  // The next Escape action, said quietly. A live region would announce every
  // hover; this is read when the badge is read, which is what it is for.
  const badgeEscape = h('span');
  badgeEscape.id = 'badge-escape';
  const outlinesButton = button('Outlines', 'quiet', 'Toggle layout outlines');
  outlinesButton.id = 'badge-outlines';
  outlinesButton.setAttribute('aria-pressed', 'false');
  const rulersButton = button('Rulers', 'quiet', 'Toggle rulers and guides');
  rulersButton.id = 'badge-rulers';
  rulersButton.setAttribute('aria-pressed', 'false');
  const semanticButton = button('Semantic', 'quiet', 'Prefer semantic parents when selecting');
  semanticButton.id = 'badge-semantic';
  semanticButton.setAttribute('aria-pressed', 'true');
  // Only meaningful while a mockup exists, so it is absent until one does.
  const mockupButton = button('Mockup', 'quiet', 'Show or hide the mockup overlay');
  mockupButton.id = 'badge-mockup';
  mockupButton.setAttribute('aria-pressed', 'false');
  mockupButton.hidden = true;
  const interactButton = button('Interact with page', 'quiet badge-action', 'Interact with page');
  const exitButton = button('Exit', 'quiet badge-action', 'Exit Design Inspector');
  badge.append(
    collapseButton,
    badgeStatus,
    badgeEscape,
    badgeProgress,
    outlinesButton,
    rulersButton,
    semanticButton,
    mockupButton,
  );
  // No native picker means no button at all, rather than one that cannot work.
  const pickButton = hasEyeDropper() ? button('Pick color', 'quiet', 'Pick a color from the page') : null;
  if (pickButton) {
    pickButton.id = 'badge-pick';
    badge.append(pickButton);
  }
  badge.append(interactButton, exitButton);

  root.append(
    layoutLayer,
    boxLayer,
    labelLayer,
    measureLayer,
    edgeLayer,
    highlightLayer,
    rulerLayer,
    hoverCard,
    pickCard,
    edgeCard,
    panel,
    badge,
  );
  (document.documentElement ?? document.body).appendChild(host);

  // The mockup carries its own host: see the comment at the top of mockup.ts
  // for why a blended image cannot live inside this stacking context.
  const mockupLayer: MockupLayer = createMockupLayer({
    onStateChange: (next) => {
      applyMockupBadge();
      callbacks.onMockupMoved(next);
    },
  });

  /**
   * A phone-width viewport has no room for the full row, so the badge starts as
   * its dot and the user expands it (tester finding F6). Wider viewports open
   * with everything on show, as before.
   */
  let badgeCollapsed = badgeCollapseChoice
    ? badgeCollapseChoice === 'collapsed'
    : badgeSidepanelOpen || narrowViewport();
  function applyBadgeCollapsed(): void {
    badge.dataset.collapsed = badgeCollapsed ? 'true' : 'false';
    badge.dataset.collapseReason = badgeSidepanelOpen ? 'sidepanel' : 'user';
    collapseChevron.textContent = badgeCollapsed ? '⌄' : '⌃';
    // The dot is the only thing left on screen when the side panel holds the
    // tools, so it says where they went rather than just how to get it back.
    if (badgeCollapsed) {
      collapseButton.setAttribute(
        'title',
        badgeSidepanelOpen ? BADGE_SIDEPANEL_TITLE : BADGE_EXPAND_TITLE,
      );
      collapseButton.setAttribute(
        'aria-label',
        badgeSidepanelOpen
          ? 'Expand the Design Inspector badge. Controls are in the side panel.'
          : 'Expand the Design Inspector badge',
      );
    } else {
      collapseButton.setAttribute('title', 'Click to collapse');
      collapseButton.setAttribute('aria-label', 'Collapse the Design Inspector badge');
    }
    collapseButton.setAttribute('aria-expanded', badgeCollapsed ? 'false' : 'true');
  }
  applyBadgeCollapsed();

  collapseButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Pressing the control takes the decision off the viewport for good: a
    // rotation must not undo what the user just asked for (Z1). It also
    // outlives the side panel closing again (W2).
    badgeCollapsed = recordBadgeCollapse(!badgeCollapsed, 'user');
    applyBadgeCollapsed();
    callbacks.onToggleBadge();
  });

  /**
   * The collapse decision follows the window until the user takes it. Rotating
   * a phone, dragging a window across 480px, or opening DevTools beside a page
   * all change how much room the badge has, and the state it was given at mount
   * stops being the right one (Z1).
   */
  function syncBadgeToViewport(): void {
    const narrow = narrowViewport();
    if (narrow && !badgeCollapsed && badgeCollapseChoice !== 'expanded') {
      badgeCollapsed = true;
      applyBadgeCollapsed();
      return;
    }
    if (!narrow && badgeCollapsed && badgeCollapseChoice !== 'collapsed') {
      badgeCollapsed = false;
      applyBadgeCollapsed();
    }
  }
  window.addEventListener('resize', syncBadgeToViewport);

  outlinesButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    callbacks.onToggleOutlines();
  });
  rulersButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    callbacks.onToggleRulers();
  });
  semanticButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    callbacks.onToggleSemanticParents();
  });
  mockupButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    callbacks.onToggleMockupVisible();
  });
  interactButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    callbacks.onTogglePaused();
  });
  exitButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    callbacks.onExit();
  });
  // The click is the user gesture the EyeDropper API requires.
  pickButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void runPick('value');
  });

  let mode: InspectorMode = 'off';
  let hoverElement: Element | null = null;
  let hoverSnapshot: ElementSnapshot | null = null;
  let pinnedElement: Element | null = null;
  let pinnedSnapshot: ElementSnapshot | null = null;
  let highlighted: Element[] = [];
  let lastCopyAt = 0;
  let saveOpen = false;
  /**
   * The one open section copy menu, if any. One at a time, and Escape closes it
   * before it touches anything else the user is holding (Z2).
   */
  let openCopyMenu: { menu: HTMLElement; toggle: HTMLButtonElement } | null = null;
  let hostVisible = true;
  /** The pinned element is connected but renders nothing at the moment. */
  let pinnedHidden = false;

  // Measurement state. None of it is persisted or part of a snapshot.
  let measureElement: Element | null = null;
  let measureLockedFlag = false;
  let measurement: BoxMeasurement | null = null;

  // Point-to-edge state, same rule: read on screen, never saved.
  let edgePoint: { x: number; y: number } | null = null;
  let edgeReading: NearestEdges | null = null;
  let edgeLockedFlag = false;

  /** The inline wrapper a click was promoted away from, if any. */
  let pinnedChild: Element | null = null;
  /** Guide being dragged, so a pointermove knows which line it is moving. */
  /**
   * Ruler strip bookkeeping. The strips are rebuilt only when the viewport
   * size changes; `rulerBaseX` and `rulerBaseY` are the document coordinate
   * the strips' origin currently stands for, so a scroll that stays inside the
   * same major step rewrites no text at all.
   */
  let rulerStripWidth = -1;
  let rulerStripHeight = -1;
  let rulerBaseX = Number.NaN;
  let rulerBaseY = Number.NaN;
  const rulerTopLabels: { node: HTMLElement; offset: number }[] = [];
  const rulerLeftLabels: { node: HTMLElement; offset: number }[] = [];
  /** Guides are redrawn only when the set changes; a scroll re-places them. */
  let guideCount = -1;

  /** The pinned rect the layout overlay was last drawn from, in viewport px. */
  let layoutOrigin: Rect | null = null;

  let guideDrag: { id: string; axis: 'x' | 'y' } | null = null;
  /** Last pointerdown on a guide, so a second one can read as a double click. */
  let lastGuidePress: { id: string; at: number } | null = null;

  // Panel pieces that are repainted without rebuilding the whole panel.
  let measureBlock: HTMLElement | null = null;
  let measureBody: HTMLElement | null = null;
  let measureTitle: HTMLElement | null = null;
  let pickedSection: HTMLElement | null = null;
  let pickedBody: HTMLElement | null = null;
  let pickedNote = '';
  let layoutNote: HTMLElement | null = null;
  let contrastPickHost: HTMLElement | null = null;
  let edgeBlock: HTMLElement | null = null;
  let edgeBody: HTMLElement | null = null;
  let edgeTitle: HTMLElement | null = null;
  /** The background pixel supplied for the pinned element's contrast row. */
  let pickedBackground: ColorValue | null = null;

  // -------------------------------------------------------------------------
  // Box model and labels

  function clearBox(): void {
    bandMargin.style.display = 'none';
    bandBorder.style.display = 'none';
    bandPadding.style.display = 'none';
    bandContent.style.display = 'none';
    labelLayer.textContent = '';
  }

  function drawLabels(geometry: BoxGeometry): void {
    labelLayer.textContent = '';
    const placed: Rect[] = [];
    const viewport = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };

    const add = (value: number, x: number, y: number): void => {
      if (roundTo(value, 2) === 0) return;
      const text = formatNumber(roundTo(value, 2), 2);
      const width = text.length * 7 + 12;
      const box: Rect = { x: x - width / 2, y: y - 8, width, height: 16 };
      if (!intersects(box, viewport)) return;
      if (placed.some((other) => intersects(box, other))) return;
      placed.push(box);
      const label = h('div', value < 0 ? 'edge-label negative' : 'edge-label', text);
      label.style.left = `${x}px`;
      label.style.top = `${y}px`;
      labelLayer.appendChild(label);
    };

    const marginBand = (side: 'top' | 'right' | 'bottom' | 'left'): void => {
      const value = geometry.marginValues[side];
      const thickness = Math.max(Math.abs(value), 12);
      if (side === 'top') add(value, geometry.border.x + geometry.border.width / 2, geometry.border.y - thickness / 2);
      if (side === 'bottom')
        add(
          value,
          geometry.border.x + geometry.border.width / 2,
          geometry.border.y + geometry.border.height + thickness / 2,
        );
      if (side === 'left') add(value, geometry.border.x - thickness / 2, geometry.border.y + geometry.border.height / 2);
      if (side === 'right')
        add(
          value,
          geometry.border.x + geometry.border.width + thickness / 2,
          geometry.border.y + geometry.border.height / 2,
        );
    };

    const paddingBand = (side: 'top' | 'right' | 'bottom' | 'left'): void => {
      const value = geometry.paddingValues[side];
      if (side === 'top')
        add(value, geometry.padding.x + geometry.padding.width / 2, geometry.padding.y + value / 2);
      if (side === 'bottom')
        add(
          value,
          geometry.padding.x + geometry.padding.width / 2,
          geometry.padding.y + geometry.padding.height - value / 2,
        );
      if (side === 'left')
        add(value, geometry.padding.x + value / 2, geometry.padding.y + geometry.padding.height / 2);
      if (side === 'right')
        add(
          value,
          geometry.padding.x + geometry.padding.width - value / 2,
          geometry.padding.y + geometry.padding.height / 2,
        );
    };

    (['top', 'bottom', 'left', 'right'] as const).forEach(paddingBand);
    (['top', 'bottom', 'left', 'right'] as const).forEach(marginBand);
  }

  /** The read half: measure the element, then hand the geometry to the writes. */
  function drawBox(element: Element | null): void {
    if (!element || !element.isConnected) {
      clearBox();
      return;
    }
    drawBoxGeometry(geometryOf(element));
  }

  /**
   * The write half of drawing the box. Split from the read half so a caller
   * that has already measured the element (the hover path) can take every
   * reading before the first style write and avoid a forced synchronous
   * layout in the middle of the frame.
   */
  function drawBoxGeometry(geometry: BoxGeometry | null): void {
    if (!geometry) {
      clearBox();
      return;
    }

    bandMargin.style.display = 'block';
    place(bandMargin, geometry.margin);
    bandMargin.style.borderTopWidth = `${Math.max(0, geometry.marginValues.top)}px`;
    bandMargin.style.borderRightWidth = `${Math.max(0, geometry.marginValues.right)}px`;
    bandMargin.style.borderBottomWidth = `${Math.max(0, geometry.marginValues.bottom)}px`;
    bandMargin.style.borderLeftWidth = `${Math.max(0, geometry.marginValues.left)}px`;

    bandBorder.style.display = 'block';
    place(bandBorder, geometry.border);
    bandBorder.style.borderTopWidth = `${geometry.borderValues.top}px`;
    bandBorder.style.borderRightWidth = `${geometry.borderValues.right}px`;
    bandBorder.style.borderBottomWidth = `${geometry.borderValues.bottom}px`;
    bandBorder.style.borderLeftWidth = `${geometry.borderValues.left}px`;

    bandPadding.style.display = 'block';
    place(bandPadding, geometry.padding);
    bandPadding.style.borderTopWidth = `${geometry.paddingValues.top}px`;
    bandPadding.style.borderRightWidth = `${geometry.paddingValues.right}px`;
    bandPadding.style.borderBottomWidth = `${geometry.paddingValues.bottom}px`;
    bandPadding.style.borderLeftWidth = `${geometry.paddingValues.left}px`;

    bandContent.style.display = 'block';
    place(bandContent, geometry.content);

    drawLabels(geometry);
  }

  // -------------------------------------------------------------------------
  // Card placement

  /**
   * Drag the panel by its header. Pointer events are handled inside the shadow
   * root only, with pointer capture, so the page never sees the drag and no
   * window listener is needed.
   */
  function makeDraggable(handle: HTMLElement): void {
    let offset: { x: number; y: number } | null = null;

    handle.addEventListener('pointerdown', (event) => {
      // Buttons in the header are controls, not a drag handle.
      if ((event.target as Element | null)?.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      offset = { x: event.clientX - rect.x, y: event.clientY - rect.y };
      handle.dataset.dragging = 'true';
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Capture is an optimisation; the move handler still works without it.
      }
      event.preventDefault();
      event.stopPropagation();
    });

    handle.addEventListener('pointermove', (event) => {
      if (!offset) return;
      const size = panel.getBoundingClientRect();
      const x = clamp(event.clientX - offset.x, EDGE, Math.max(EDGE, window.innerWidth - size.width - EDGE));
      const y = clamp(event.clientY - offset.y, EDGE, Math.max(EDGE, window.innerHeight - size.height - EDGE));
      draggedPanelPosition = { x, y };
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
      event.preventDefault();
      event.stopPropagation();
    });

    const end = (event: PointerEvent): void => {
      if (!offset) return;
      offset = null;
      delete handle.dataset.dragging;
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        // Already released with the pointer.
      }
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function positionCard(card: HTMLElement, target: Rect | null): void {
    card.style.left = '0px';
    card.style.top = '0px';
    const size = card.getBoundingClientRect();
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;
    const width = size.width || 300;
    const height = size.height || 120;

    // The panel is the user's to place: a dragged position wins over anything
    // computed, for the rest of the page session.
    if (card === panel && draggedPanelPosition) {
      card.style.left = `${clamp(draggedPanelPosition.x, EDGE, Math.max(EDGE, viewWidth - width - EDGE))}px`;
      card.style.top = `${clamp(draggedPanelPosition.y, EDGE, Math.max(EDGE, viewHeight - height - EDGE))}px`;
      return;
    }

    // A rect that spans most of the viewport cannot be stepped around. A tall
    // one gets the band above or below it, whichever has more room; anything
    // else takes the corner that covers the least of it.
    if (card === panel && target && target.width >= viewWidth * WIDE_RECT_RATIO) {
      const band = chooseWidePlacement(
        target,
        { width, height },
        { width: viewWidth, height: viewHeight },
      );
      if (band) {
        card.style.left = `${band.x}px`;
        card.style.top = `${clearBadge(band.x, band.y, width, height, viewWidth, viewHeight)}px`;
        return;
      }
      const corner = chooseCardCorner(target, { width, height }, { width: viewWidth, height: viewHeight });
      const x = corner.endsWith('right') ? Math.max(EDGE, viewWidth - width - EDGE) : EDGE;
      const y = corner.startsWith('top') ? EDGE : Math.max(EDGE, viewHeight - height - EDGE);
      card.style.left = `${x}px`;
      card.style.top = `${clearBadge(x, y, width, height, viewWidth, viewHeight)}px`;
      return;
    }

    const anchor = target ?? { x: EDGE, y: EDGE, width: 0, height: 0 };
    let left = anchor.x;
    let top = anchor.y + anchor.height + CARD_GAP;

    if (top + height > viewHeight - EDGE) {
      const above = anchor.y - height - CARD_GAP;
      if (above >= EDGE) {
        top = above;
      } else {
        // Neither below nor above fits: sit beside the element instead of over it.
        top = Math.min(Math.max(EDGE, anchor.y), Math.max(EDGE, viewHeight - height - EDGE));
        const right = anchor.x + anchor.width + CARD_GAP;
        left = right + width <= viewWidth - EDGE ? right : anchor.x - width - CARD_GAP;
      }
    }

    left = Math.min(Math.max(EDGE, left), Math.max(EDGE, viewWidth - width - EDGE));
    top = Math.min(Math.max(EDGE, top), Math.max(EDGE, viewHeight - height - EDGE));
    card.style.left = `${left}px`;
    card.style.top = `${card === panel ? clearBadge(left, top, width, height, viewWidth, viewHeight) : top}px`;
  }

  /**
   * The badge is drawn over the panel, so a panel that would start under it
   * loses its own header. This drops the panel below the badge when the two
   * would share the top right corner.
   */
  function clearBadge(
    left: number,
    top: number,
    width: number,
    height: number,
    viewWidth: number,
    viewHeight: number,
  ): number {
    if (badge.hidden) return top;
    if (top >= BADGE_CLEARANCE) return top;
    if (left + width <= viewWidth - BADGE_BAND) return top;
    return Math.min(BADGE_CLEARANCE, Math.max(EDGE, viewHeight - height - EDGE));
  }

  // -------------------------------------------------------------------------
  // Value rows

  function swatchFor(color: ColorValue): HTMLElement {
    const swatch = h('span', 'swatch');
    const fill = h('i');
    fill.style.background = color.raw;
    swatch.appendChild(fill);
    return swatch;
  }

  function copyButton(label: string, value: () => string): HTMLButtonElement {
    const node = button('Copy', 'quiet row-copy', `Copy ${label}`);
    node.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = value();
      void copyText(text).then((ok) => {
        lastCopyAt = Date.now();
        node.textContent = ok ? 'Copied' : 'Failed';
        window.setTimeout(() => {
          node.textContent = 'Copy';
        }, COPY_FEEDBACK_MS);
      });
    });
    return node;
  }

  function row(
    key: string,
    value: string,
    options: {
      color?: ColorValue;
      copy?: string;
      allowPick?: boolean;
      /**
       * Keep the value on one line, with the whole of it in a tooltip and on
       * the Copy button. A CDN font URL is 180 characters: wrapped, it buries
       * the rest of the section under six lines of hash.
       */
      oneLine?: boolean;
    } = {},
  ): HTMLElement {
    const line = h('div', 'row');
    line.append(h('span', 'row-key', key));
    const valueNode = h('span', 'row-value');
    if (options.oneLine) {
      valueNode.classList.add('one-line');
      valueNode.title = value;
    }
    if (options.color) valueNode.appendChild(swatchFor(options.color));
    valueNode.appendChild(document.createTextNode(value));
    line.append(valueNode, copyButton(key, () => options.copy ?? value));
    // Every color row offers the picker, because the rendered pixel and the
    // computed color are different claims (competitive Tier 1 item 2).
    if (options.color && options.allowPick !== false && hasEyeDropper()) {
      const pick = button('Pick', 'quiet row-copy', 'Pick a color from the page');
      pick.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void runPick('value');
      });
      line.append(pick);
    }
    return line;
  }

  /**
   * A section-head copy button over an exporter that may be unavailable. The
   * label reports what happened and returns to itself, so the button is never
   * left claiming a state it is not in.
   */
  function exportButton(
    label: string,
    ariaLabel: string,
    produce: () => string | null,
  ): HTMLButtonElement {
    const node = button(label, 'quiet', ariaLabel);
    const restore = (): void => {
      window.setTimeout(() => {
        node.textContent = label;
      }, COPY_FEEDBACK_MS);
    };
    node.addEventListener('click', () => {
      let text: string | null = null;
      try {
        text = produce();
      } catch {
        text = null;
      }
      if (text === null) {
        node.textContent = 'Copy unavailable';
        restore();
        return;
      }
      void copyText(text).then((ok) => {
        lastCopyAt = Date.now();
        node.textContent = ok ? 'Copied' : 'Failed';
        restore();
      });
    });
    return node;
  }

  /** Closes whichever section's copy menu is open. True when one was. */
  function closeCopyMenu(): boolean {
    if (!openCopyMenu) return false;
    openCopyMenu.menu.hidden = true;
    openCopyMenu.toggle.setAttribute('aria-expanded', 'false');
    openCopyMenu = null;
    return true;
  }

  function section(
    name: string,
    category: StyleCategory | null,
  ): { wrapper: HTMLElement; body: HTMLElement } {
    const wrapper = h('div', 'section');
    const head = h('div', 'section-head');
    head.append(h('span', 'section-name', name));
    const body = h('div', 'section-body');

    if (category) {
      // Three labelled copy buttons wrapped onto two lines and misaligned the
      // head at panel width, so the head carries one control and the three
      // exporters live in a menu under it. It opens downward inside the
      // section rather than floating, which keeps it inside the scroll area
      // and out of the clipped corners, and Escape closes it first (Z2).
      const menu = h('div', 'copy-menu');
      menu.setAttribute('role', 'group');
      menu.setAttribute('aria-label', `Copy ${name} as`);
      menu.hidden = true;

      const toggle = button('Copy', 'quiet copy-toggle', `Copy ${name}`);
      toggle.append(h('span', 'chevron', '▾'));
      toggle.setAttribute('aria-haspopup', 'true');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const open = menu.hidden;
        closeCopyMenu();
        if (open) {
          menu.hidden = false;
          toggle.setAttribute('aria-expanded', 'true');
          openCopyMenu = { menu, toggle };
        }
        applyEscapeHint();
      });

      menu.append(
        exportButton('CSS', `Copy ${name} as CSS`, () => callbacks.cssFor(category)),
        exportButton('Tailwind', `Copy ${name} as Tailwind classes`, () =>
          callbacks.tailwindFor(category),
        ),
        // Mode 2 of PRD EXP-02: standard utilities only, with the deviations
        // stated. Its adapter belongs to another workstream, so an absent
        // implementation reads as "Copy unavailable" rather than as a crash.
        exportButton(
          'Closest standard',
          `Copy ${name} as the closest standard Tailwind classes`,
          () => callbacks.tailwindClosestFor(category),
        ),
      );

      head.append(toggle);
      body.append(menu);
    }

    wrapper.append(head, body);
    return { wrapper, body };
  }

  // -------------------------------------------------------------------------
  // Eyedropper (competitive Tier 1 item 2)

  function rectOf(element: Element): Rect {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  function applyHostDisplay(hiddenForPick: boolean): void {
    const hidden = hiddenForPick || !hostVisible;
    host.style.display = hidden ? 'none' : '';
    // A screenshot or a picked pixel must read the page, not our mockup.
    mockupLayer.setHostVisible(!hidden);
  }

  /**
   * The badge's Escape hint, repainted whenever anything Escape would release
   * changes. It is cheap enough to call from every one of those places rather
   * than trying to remember which of them can matter (Z2).
   */
  function applyEscapeHint(): void {
    badgeEscape.textContent = escapeHintFor({
      menuOpen: saveOpen || openCopyMenu !== null,
      edgesLocked: edgeLockedFlag && edgePoint !== null,
      measureLocked: measureLockedFlag && measureElement !== null,
      pinned: pinnedElement !== null,
    });
  }

  /** The Mockup toggle exists only while there is a mockup to toggle. */
  function applyMockupBadge(): void {
    const state = mockupLayer.current();
    mockupButton.hidden = state === null;
    mockupButton.setAttribute('aria-pressed', state?.visible ? 'true' : 'false');
  }

  /**
   * True for anything the extension drew, in either host. Used both by the
   * public `owns` and by the edge sampler, which must never mistake one of our
   * own guides for a page element.
   */
  function ownsNode(node: Node | null | undefined): boolean {
    if (!node) return false;
    if (node === host) return true;
    let current: Node | null = node;
    while (current) {
      if (current === host || current === root) return true;
      const parent: Node | null = current.parentNode ?? ((current as { host?: Node }).host ?? null);
      current = parent;
    }
    return mockupLayer.owns(node);
  }

  /**
   * Opens the native picker. The overlay host is hidden for the duration so
   * the pick reads the page's own pixel and not our tint, and is restored
   * whether the pick succeeded, was cancelled, or threw.
   */
  async function runPick(purpose: 'value' | 'background'): Promise<void> {
    const outcome = await pickPixel({
      onBeforeOpen: () => applyHostDisplay(true),
      onAfterOpen: () => applyHostDisplay(false),
    });

    if (outcome.status === 'cancelled') return;
    if (outcome.status === 'unavailable') {
      pickedNote = outcome.reason;
      paintPicked();
      return;
    }

    pickedNote = '';
    const color = parseColor(outcome.hex);
    rememberPicked(color);
    if (purpose === 'background') pickedBackground = color;
    paintPicked();
    paintPickedContrast();
  }

  function pickedHistoryRow(): HTMLElement {
    const strip = h('div', 'picked-swatches');
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', 'Recent picked colors');
    pickedHistory.forEach((entry) => {
      const label = entry.hex ?? entry.raw;
      const swatchButton = h('button', 'quiet');
      swatchButton.type = 'button';
      swatchButton.setAttribute('aria-label', `Show ${label}`);
      swatchButton.appendChild(swatchFor(entry));
      swatchButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        lastPicked = entry;
        paintPicked();
        paintPickedContrast();
      });
      strip.appendChild(swatchButton);
    });
    return strip;
  }

  function paintPickedRows(parent: HTMLElement, color: ColorValue): void {
    const hex = color.hex ?? color.raw;
    parent.appendChild(row('Hex', hex, { color, copy: hex, allowPick: false }));
    parent.appendChild(row('rgb', color.rgb ?? 'unavailable', { allowPick: false }));
    parent.appendChild(row('oklch', color.oklch ?? 'unavailable', { allowPick: false }));
    parent.appendChild(h('div', 'note', 'Observed (picked pixel)'));
    if (pickedHistory.length > 0) parent.appendChild(pickedHistoryRow());
  }

  function paintPicked(): void {
    if (pickedSection && pickedBody) {
      pickedBody.textContent = '';
      if (lastPicked) paintPickedRows(pickedBody, lastPicked);
      if (pickedNote) pickedBody.appendChild(h('div', 'note', pickedNote));
      pickedSection.hidden = !lastPicked && !pickedNote;
    }

    // The floating card only exists when there is no panel to put the result in.
    pickCard.textContent = '';
    if (!panel.hidden || (!lastPicked && !pickedNote)) {
      pickCard.hidden = true;
      return;
    }
    const stack = h('div', 'stack');
    stack.appendChild(h('div', 'hover-title', 'Picked color'));
    if (lastPicked) paintPickedRows(stack, lastPicked);
    if (pickedNote) stack.appendChild(h('div', 'note', pickedNote));
    const dismiss = button('Dismiss', 'quiet', 'Dismiss the picked color');
    dismiss.addEventListener('click', () => {
      pickCard.hidden = true;
    });
    stack.appendChild(dismiss);
    pickCard.appendChild(stack);
    pickCard.hidden = false;
  }

  /**
   * Contrast against a picked pixel (PRD SUR-03's future case). The snapshot's
   * own `contrast` reading is left exactly as it was read; this is panel state
   * and it says who supplied the background.
   */
  function paintPickedContrast(): void {
    if (!contrastPickHost) return;
    contrastPickHost.textContent = '';
    const type = pinnedSnapshot?.typography;
    if (!type) return;

    if (hasEyeDropper()) {
      const pick = button('Pick background', 'quiet', 'Pick the background pixel behind this text');
      pick.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void runPick('background');
      });
      contrastPickHost.appendChild(pick);
    }

    if (!pickedBackground) return;
    const result = contrastAgainstPicked(type.color, pickedBackground);
    if (!result) {
      contrastPickHost.appendChild(
        h('div', 'note', 'That picked pixel could not be read as a color.'),
      );
      return;
    }
    contrastPickHost.appendChild(
      row(
        'Contrast',
        `${formatNumber(result.ratio, 2)}:1 (against picked pixel, user-supplied)`,
        { copy: `${result.ratio}`, allowPick: false },
      ),
    );
    contrastPickHost.appendChild(
      row('Against', result.background, {
        color: pickedBackground,
        copy: result.background,
        allowPick: false,
      }),
    );
    contrastPickHost.appendChild(
      h(
        'div',
        'note',
        'Observed (picked pixel). The saved reading keeps its own unavailable status.',
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Measurement (PRD LAY-02)

  const CASE_LABELS: Record<BoxMeasurement['case'], string> = {
    separated: 'separated',
    overlap: 'overlapping',
    containment: 'containment',
  };

  function drawGuide(rect: Rect, orientation: 'horizontal' | 'vertical', label: string): void {
    const line = h('div', 'guide-line');
    if (orientation === 'horizontal') {
      place(line, { x: rect.x, y: rect.y - 0.5, width: Math.max(1, rect.width), height: 1 });
    } else {
      place(line, { x: rect.x - 0.5, y: rect.y, width: 1, height: Math.max(1, rect.height) });
    }
    measureLayer.appendChild(line);

    const text = h('div', 'edge-label measure-label', label);
    text.style.left = `${rect.x + rect.width / 2}px`;
    text.style.top = `${rect.y + rect.height / 2}px`;
    measureLayer.appendChild(text);
  }

  function drawMeasure(): void {
    measureLayer.textContent = '';
    measurement = null;

    const target = measureElement;
    if (
      target &&
      pinnedElement &&
      target !== pinnedElement &&
      target.isConnected &&
      pinnedElement.isConnected
    ) {
      const a = rectOf(pinnedElement);
      const b = rectOf(target);
      measurement = measureBoxes(a, b);

      const outline = h('div', 'measure-outline');
      place(outline, b);
      measureLayer.appendChild(outline);

      measureGuides(a, b, measurement).forEach((guide) => {
        drawGuide(guide.rect, guide.orientation, guide.label);
      });
    }

    paintMeasureBlock();
    applyEscapeHint();
  }

  function paintMeasureBlock(): void {
    if (!measureBlock || !measureBody || !measureTitle) return;
    measureBody.textContent = '';

    const current = measurement;
    if (!current || !measureElement || !pinnedSnapshot) {
      measureBlock.hidden = true;
      // A hidden block that still says "Measure (locked)" is read by assistive
      // technology and shows through a repaint (tester UX note 2).
      measureTitle.textContent = '';
      return;
    }

    measureBlock.hidden = false;
    measureTitle.textContent = measureLockedFlag ? 'Measure (locked)' : 'Measure';

    const from = pinnedSnapshot.element.label;
    const to = describeElement(measureElement).label;
    measureBody.appendChild(row('From', `${from} to ${to}`, { allowPick: false }));
    measureBody.appendChild(row('Case', CASE_LABELS[current.case], { allowPick: false }));

    if (current.case === 'containment') {
      const inner = current.contains === 'a-in-b' ? from : to;
      measureBody.appendChild(row('Inside', inner, { allowPick: false }));
      measureBody.appendChild(row('Inset top', formatPx(current.edges.top), { allowPick: false }));
      measureBody.appendChild(row('Inset right', formatPx(current.edges.right), { allowPick: false }));
      measureBody.appendChild(
        row('Inset bottom', formatPx(current.edges.bottom), { allowPick: false }),
      );
      measureBody.appendChild(row('Inset left', formatPx(current.edges.left), { allowPick: false }));
    } else if (current.case === 'overlap') {
      measureBody.appendChild(
        row('Overlap x', formatPx(Math.abs(current.gapX)), { allowPick: false }),
      );
      measureBody.appendChild(
        row('Overlap y', formatPx(Math.abs(current.gapY)), { allowPick: false }),
      );
      measureBody.appendChild(
        row(
          'Edges t r b l',
          [current.edges.top, current.edges.right, current.edges.bottom, current.edges.left]
            .map((value) => formatPx(value))
            .join(' '),
          { allowPick: false },
        ),
      );
    } else {
      measureBody.appendChild(
        row('Gap x', formatPx(Math.max(0, current.gapX)), { allowPick: false }),
      );
      measureBody.appendChild(
        row('Gap y', formatPx(Math.max(0, current.gapY)), { allowPick: false }),
      );
      measureBody.appendChild(
        row(
          'Edges t r b l',
          [current.edges.top, current.edges.right, current.edges.bottom, current.edges.left]
            .map((value) => formatPx(value))
            .join(' '),
          { allowPick: false },
        ),
      );
    }

    const actions = h('div', 'form-actions');
    actions.appendChild(copyButton('measurement', () => measurementCopyText(current)));
    measureBody.appendChild(actions);
    measureBody.appendChild(
      h(
        'div',
        'note',
        'A geometric distance between the painted boxes, not a margin. Measurements are not saved.',
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Point-to-edge measurement (competitive Tier 2 item 3)

  const EDGE_ROW_LABELS: Record<EdgeDirection, string> = {
    top: 'Up',
    right: 'Right',
    bottom: 'Down',
    left: 'Left',
  };

  /** The topmost page element at a viewport point, with our own UI skipped. */
  function sampleAt(x: number, y: number): Element | null {
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return null;
    return elementAtPoint(x, y, ownsNode);
  }

  /**
   * The boxes of every page element the point is inside, ours excluded. The
   * hit-test walk only sees where the topmost element changes, which can be
   * further away than a box that ends right there (tester finding F10).
   */
  function stackRectsAt(point: { x: number; y: number }): Rect[] {
    let candidates: Element[] = [];
    try {
      candidates = Array.from(document.elementsFromPoint(point.x, point.y));
    } catch {
      return [];
    }
    const rects: Rect[] = [];
    for (const candidate of candidates) {
      if (ownsNode(candidate)) continue;
      if (candidate.tagName.toLowerCase() === 'html') continue;
      try {
        const rect = rectOf(candidate);
        if (rect.width <= 0 || rect.height <= 0) continue;
        rects.push(rect);
      } catch {
        // An element whose box cannot be read simply contributes no edge.
      }
    }
    return rects;
  }

  function drawEdgeGuide(
    point: { x: number; y: number },
    direction: EdgeDirection,
    value: { distance: number; found: boolean },
  ): void {
    const length = Math.max(1, value.distance);
    const line = h('div', 'edge-guide');
    if (direction === 'top') {
      place(line, { x: point.x - 0.5, y: point.y - length, width: 1, height: length });
    } else if (direction === 'bottom') {
      place(line, { x: point.x - 0.5, y: point.y, width: 1, height: length });
    } else if (direction === 'left') {
      place(line, { x: point.x - length, y: point.y - 0.5, width: length, height: 1 });
    } else {
      place(line, { x: point.x, y: point.y - 0.5, width: length, height: 1 });
    }
    edgeLayer.appendChild(line);

    // A distance the walk never confirmed is labelled as a lower bound, not as
    // a measurement (PRD 16.1).
    const text = value.found ? formatPx(value.distance) : `>${formatPx(value.distance)}`;
    const label = h('div', 'edge-label edge-guide-label', text);
    const half = length / 2;
    label.style.left = `${
      direction === 'left' ? point.x - half : direction === 'right' ? point.x + half : point.x
    }px`;
    label.style.top = `${
      direction === 'top' ? point.y - half : direction === 'bottom' ? point.y + half : point.y
    }px`;
    edgeLayer.appendChild(label);
  }

  function drawEdges(): void {
    edgeLayer.textContent = '';
    edgeReading = null;

    const point = edgePoint;
    if (point) {
      const reading = nearestEdges(
        sampleAt,
        point,
        { width: window.innerWidth, height: window.innerHeight },
        undefined,
        stackRectsAt(point),
      );
      if (reading.hasOrigin) {
        edgeReading = reading;
        const dot = h('div', 'edge-dot');
        dot.style.left = `${point.x}px`;
        dot.style.top = `${point.y}px`;
        edgeLayer.appendChild(dot);
        (['top', 'right', 'bottom', 'left'] as const).forEach((direction) => {
          drawEdgeGuide(point, direction, reading[direction]);
        });
      }
    }

    paintEdgeBlock();
    applyEscapeHint();
  }

  function edgeRows(parent: HTMLElement, reading: NearestEdges): void {
    (['top', 'right', 'bottom', 'left'] as const).forEach((direction) => {
      const value = reading[direction];
      parent.appendChild(
        row(
          EDGE_ROW_LABELS[direction],
          value.found ? formatPx(value.distance) : `more than ${formatPx(value.distance)}`,
          { copy: String(value.distance), allowPick: false },
        ),
      );
    });
    const actions = h('div', 'form-actions');
    actions.appendChild(copyButton('edge distances', () => edgesCopyText(reading)));
    parent.appendChild(actions);
    // The method, stated wherever the numbers are (competitive Tier 2 item 3).
    parent.appendChild(h('div', 'note', EDGE_METHOD_LABEL));
  }

  function paintEdgeBlock(): void {
    const reading = edgeReading;
    const title = edgeLockedFlag ? 'Edges (locked)' : 'Edges';

    if (edgeBlock && edgeBody && edgeTitle) {
      edgeBody.textContent = '';
      edgeBlock.hidden = reading === null;
      if (reading) {
        edgeTitle.textContent = title;
        edgeRows(edgeBody, reading);
      }
    }

    // With no panel open the reading still needs somewhere to be read.
    edgeCard.textContent = '';
    if (!panel.hidden || !reading) {
      edgeCard.hidden = true;
      return;
    }
    const stack = h('div', 'stack');
    stack.appendChild(h('div', 'hover-title', title));
    edgeRows(stack, reading);
    edgeCard.appendChild(stack);
    edgeCard.hidden = false;
  }

  // -------------------------------------------------------------------------
  // Rulers and guides (Designer Tools territory)

  /**
   * `known` is the rect the caller has already measured. Passing it keeps the
   * hover path free of a second layout read after the card has been written.
   */
  function drawRulerMarks(known?: Rect | null): void {
    rulerTopMarks.textContent = '';
    rulerLeftMarks.textContent = '';
    const element = hoverElement ?? pinnedElement;
    if (!element || !element.isConnected) return;
    let rect: Rect;
    if (known) {
      rect = known;
    } else {
      try {
        rect = rectOf(element);
      } catch {
        return;
      }
    }
    [rect.x, rect.x + rect.width].forEach((x) => {
      const mark = h('div', 'ruler-mark');
      place(mark, { x, y: 0, width: 1, height: RULER_SIZE });
      rulerTopMarks.appendChild(mark);
    });
    [rect.y, rect.y + rect.height].forEach((y) => {
      const mark = h('div', 'ruler-mark');
      place(mark, { x: 0, y, width: RULER_SIZE, height: 1 });
      rulerLeftMarks.appendChild(mark);
    });
  }

  /**
   * Building the strip is the only DOM work the rulers ever do, and it happens
   * once per viewport size. The strip is built from document offset zero and
   * covers the viewport plus one major step, so every tick's "major" flag and
   * every label's place in the strip are fixed; scrolling only chooses which
   * document coordinate offset zero currently stands for.
   */
  function buildRulerStrips(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (width === rulerStripWidth && height === rulerStripHeight) return;
    rulerStripWidth = width;
    rulerStripHeight = height;
    rulerTopStrip.textContent = '';
    rulerLeftStrip.textContent = '';
    rulerTopLabels.length = 0;
    rulerLeftLabels.length = 0;

    rulerTicks(0, width + MAJOR_STEP).forEach((tick) => {
      const size = tick.major ? 11 : 5;
      const mark = h('div', 'tick');
      place(mark, { x: tick.position, y: RULER_SIZE - size, width: 1, height: size });
      rulerTopStrip.appendChild(mark);
      if (!tick.major) return;
      const label = h('div', 'tick-label');
      label.style.left = `${tick.position + 3}px`;
      label.style.top = '2px';
      rulerTopStrip.appendChild(label);
      rulerTopLabels.push({ node: label, offset: tick.position });
    });

    rulerTicks(0, height + MAJOR_STEP).forEach((tick) => {
      const size = tick.major ? 11 : 5;
      const mark = h('div', 'tick');
      place(mark, { x: RULER_SIZE - size, y: tick.position, width: size, height: 1 });
      rulerLeftStrip.appendChild(mark);
      if (!tick.major) return;
      const label = h('div', 'tick-label');
      label.style.left = '2px';
      label.style.top = `${tick.position + 2}px`;
      rulerLeftStrip.appendChild(label);
      rulerLeftLabels.push({ node: label, offset: tick.position });
    });

    // A rebuilt strip carries no labels yet, so the next positioning pass has
    // to write them whatever the scroll offset is.
    rulerBaseX = Number.NaN;
    rulerBaseY = Number.NaN;
  }

  /**
   * One transform per axis. The label text is rewritten only when the strip
   * has slid a whole major step, which on a 1280px viewport is fourteen text
   * assignments per 100px of scroll rather than 233 new nodes per frame.
   */
  function positionRulerStrips(): void {
    const baseX = Math.floor(window.scrollX / MAJOR_STEP) * MAJOR_STEP;
    const baseY = Math.floor(window.scrollY / MAJOR_STEP) * MAJOR_STEP;
    rulerTopStrip.style.transform = `translateX(${baseX - window.scrollX}px)`;
    rulerLeftStrip.style.transform = `translateY(${baseY - window.scrollY}px)`;
    if (baseX !== rulerBaseX) {
      rulerBaseX = baseX;
      for (const label of rulerTopLabels) label.node.textContent = String(baseX + label.offset);
    }
    if (baseY !== rulerBaseY) {
      rulerBaseY = baseY;
      for (const label of rulerLeftLabels) label.node.textContent = String(baseY + label.offset);
    }
  }

  function drawRulerTicks(known?: Rect | null): void {
    buildRulerStrips();
    positionRulerStrips();
    drawRulerMarks(known);
  }

  function drawGuides(): void {
    guideLayer.textContent = '';
    guideCount = listGuides().length;
    listGuides().forEach((guide) => {
      const node = h('div', 'page-guide');
      node.dataset.axis = guide.axis;
      node.dataset.guideId = guide.id;
      node.setAttribute('role', 'separator');
      // Focusable, because Delete has to have somewhere to be pressed.
      node.tabIndex = 0;
      node.setAttribute(
        'aria-label',
        `${guide.axis === 'x' ? 'Vertical' : 'Horizontal'} guide at ${guide.position}px. ` +
          'Drag to move, double-click or press Delete to remove.',
      );
      if (guide.axis === 'x') node.style.left = `${guide.position - window.scrollX}px`;
      else node.style.top = `${guide.position - window.scrollY}px`;
      node.appendChild(h('i'));
      const remove = button('×', 'guide-remove', `Remove the guide at ${guide.position}px`);
      remove.dataset.role = 'guide-remove';
      node.appendChild(remove);
      guideLayer.appendChild(node);
    });
  }

  /**
   * A scroll does not change a guide's document coordinate, only where it is
   * painted, so the nodes are moved rather than rebuilt. The set is redrawn
   * only when its size changed, which is the only way a guide can appear or
   * disappear outside a drag.
   */
  function positionGuides(): void {
    const guides = listGuides();
    if (guides.length !== guideCount) {
      drawGuides();
      return;
    }
    for (const guide of guides) {
      const node = guideLayer.querySelector(
        `[data-guide-id="${guide.id}"]`,
      ) as HTMLElement | null;
      if (!node) {
        drawGuides();
        return;
      }
      if (guide.axis === 'x') node.style.left = `${guide.position - window.scrollX}px`;
      else node.style.top = `${guide.position - window.scrollY}px`;
    }
  }

  /** Drops the guide and repaints, wherever the request came from. */
  function dropGuide(id: string): void {
    removeGuide(id);
    guideDrag = null;
    lastGuidePress = null;
    drawGuides();
  }

  function drawRulers(known?: Rect | null): void {
    rulerLayer.hidden = !rulersEnabled;
    rulersButton.setAttribute('aria-pressed', rulersEnabled ? 'true' : 'false');
    if (!rulersEnabled) {
      rulerTopStrip.textContent = '';
      rulerLeftStrip.textContent = '';
      rulerTopMarks.textContent = '';
      rulerLeftMarks.textContent = '';
      rulerTopLabels.length = 0;
      rulerLeftLabels.length = 0;
      // Force a rebuild the next time the rulers come back on.
      rulerStripWidth = -1;
      rulerStripHeight = -1;
      guideLayer.textContent = '';
      guideCount = -1;
      return;
    }
    drawRulerTicks(known);
    positionGuides();
  }

  /** A click anywhere on a ruler drops a guide at that document coordinate. */
  function rulerClick(axis: 'x' | 'y'): (event: MouseEvent) => void {
    return (event) => {
      event.preventDefault();
      event.stopPropagation();
      addGuide(axis, axis === 'x' ? event.clientX + window.scrollX : event.clientY + window.scrollY);
      drawGuides();
    };
  }
  rulerTop.addEventListener('click', rulerClick('x'));
  rulerLeft.addEventListener('click', rulerClick('y'));

  function guideNodeFor(target: EventTarget | null): HTMLElement | null {
    const element = target as Element | null;
    if (!element || typeof element.closest !== 'function') return null;
    return element.closest('.page-guide') as HTMLElement | null;
  }

  guideLayer.addEventListener('pointerdown', (event) => {
    const node = guideNodeFor(event.target);
    const id = node?.dataset.guideId;
    if (!node || !id) return;
    event.preventDefault();
    event.stopPropagation();

    // The remove control is a control, not a place to start a drag.
    const target = event.target as Element | null;
    if (target && typeof target.closest === 'function' && target.closest('.guide-remove')) {
      dropGuide(id);
      return;
    }

    // This layer captures the pointer so a drag survives leaving the 9px strip,
    // and a captured pointer never produces a dblclick, so the double press is
    // counted here instead (tester finding F2).
    const now = Date.now();
    if (lastGuidePress && lastGuidePress.id === id && now - lastGuidePress.at <= GUIDE_DOUBLE_MS) {
      dropGuide(id);
      return;
    }
    lastGuidePress = { id, at: now };

    guideDrag = { id, axis: node.dataset.axis === 'y' ? 'y' : 'x' };
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      // Capture is an optimisation; the move handler works without it.
    }
  });

  guideLayer.addEventListener('keydown', (event) => {
    const node = guideNodeFor(event.target);
    const id = node?.dataset.guideId;
    if (!id) return;
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    event.preventDefault();
    event.stopPropagation();
    dropGuide(id);
  });

  guideLayer.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== 'function') return;
    if (!target.closest('.guide-remove')) return;
    // The pointerdown already removed it; this only keeps the click contained.
    event.preventDefault();
    event.stopPropagation();
  });

  guideLayer.addEventListener('pointermove', (event) => {
    const drag = guideDrag;
    if (!drag) return;
    const position =
      drag.axis === 'x' ? event.clientX + window.scrollX : event.clientY + window.scrollY;
    moveGuide(drag.id, position);
    // The node is moved in place rather than redrawn, so the pointer capture
    // survives the drag.
    const node = guideLayer.querySelector(`[data-guide-id="${drag.id}"]`) as HTMLElement | null;
    if (node) {
      if (drag.axis === 'x') node.style.left = `${position - window.scrollX}px`;
      else node.style.top = `${position - window.scrollY}px`;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  const endGuideDrag = (): void => {
    if (!guideDrag) return;
    guideDrag = null;
    drawGuides();
  };
  guideLayer.addEventListener('pointerup', endGuideDrag);
  guideLayer.addEventListener('pointercancel', endGuideDrag);

  // Kept for the case where the pointer capture did not take and the browser
  // does deliver a dblclick. Removing an already removed guide is a no-op.
  guideLayer.addEventListener('dblclick', (event) => {
    const node = guideNodeFor(event.target);
    const id = node?.dataset.guideId;
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    dropGuide(id);
  });

  // -------------------------------------------------------------------------
  // Grid and flex overlay (competitive Tier 1 item 4)

  function drawLine(rect: Rect): void {
    const line = h('div', 'grid-line');
    place(line, rect);
    layoutLayer.appendChild(line);
  }

  function drawTint(rect: Rect): void {
    const band = h('div', 'tint-band');
    place(band, rect);
    layoutLayer.appendChild(band);
  }

  function drawTrackLabel(text: string, x: number, y: number): void {
    const label = h('div', 'edge-label track-label', text);
    label.style.left = `${x}px`;
    label.style.top = `${y}px`;
    layoutLayer.appendChild(label);
  }

  function drawGridOverlay(geometry: BoxGeometry, style: CSSStyleDeclaration): string {
    const columns = parseTrackList(style.gridTemplateColumns);
    const rows = parseTrackList(style.gridTemplateRows);
    if (!columns || !rows) return 'Grid overlay unavailable for this template';

    const content = geometry.content;
    const columnGap = parsePx(style.columnGap);
    const rowGap = parsePx(style.rowGap);

    trackBands(columns, columnGap).forEach((band) => {
      const x = content.x + band.start;
      if (band.gap) {
        drawTint({ x, y: content.y, width: band.size, height: content.height });
        return;
      }
      drawLine({ x, y: content.y, width: 1, height: content.height });
      drawLine({ x: x + band.size - 1, y: content.y, width: 1, height: content.height });
      drawTrackLabel(formatPx(band.size), x + band.size / 2, content.y + 10);
    });

    trackBands(rows, rowGap).forEach((band) => {
      const y = content.y + band.start;
      if (band.gap) {
        drawTint({ x: content.x, y, width: content.width, height: band.size });
        return;
      }
      drawLine({ x: content.x, y, width: content.width, height: 1 });
      drawLine({ x: content.x, y: y + band.size - 1, width: content.width, height: 1 });
      drawTrackLabel(formatPx(band.size), content.x + 28, y + band.size / 2);
    });

    return '';
  }

  function drawFlexArrow(content: Rect, axis: FlexAxis, reversed: boolean): void {
    const arrow = h('div', 'axis-arrow');
    const size = 5;
    const length = 7;
    if (axis === 'horizontal') {
      arrow.style.top = `${content.y + content.height / 2 - size}px`;
      if (reversed) {
        arrow.style.left = `${content.x}px`;
        arrow.style.borderWidth = `${size}px ${length}px ${size}px 0`;
        arrow.style.borderRightColor = 'var(--di-accent)';
      } else {
        arrow.style.left = `${content.x + content.width - length}px`;
        arrow.style.borderWidth = `${size}px 0 ${size}px ${length}px`;
        arrow.style.borderLeftColor = 'var(--di-accent)';
      }
    } else {
      arrow.style.left = `${content.x + content.width / 2 - size}px`;
      if (reversed) {
        arrow.style.top = `${content.y}px`;
        arrow.style.borderWidth = `0 ${size}px ${length}px ${size}px`;
        arrow.style.borderBottomColor = 'var(--di-accent)';
      } else {
        arrow.style.top = `${content.y + content.height - length}px`;
        arrow.style.borderWidth = `${length}px ${size}px 0 ${size}px`;
        arrow.style.borderTopColor = 'var(--di-accent)';
      }
    }
    layoutLayer.appendChild(arrow);
  }

  function drawFlexOverlay(
    element: Element,
    geometry: BoxGeometry,
    style: CSSStyleDeclaration,
  ): string {
    const content = geometry.content;
    const direction = (style.flexDirection || 'row').trim().toLowerCase();
    const axis = flexMainAxis(direction);

    const baseline = h('div', 'axis-line');
    place(
      baseline,
      axis === 'horizontal'
        ? { x: content.x, y: content.y + content.height / 2 - 0.5, width: content.width, height: 1 }
        : { x: content.x + content.width / 2 - 0.5, y: content.y, width: 1, height: content.height },
    );
    layoutLayer.appendChild(baseline);

    const children = Array.from(element.children)
      .filter((child) => child.getClientRects().length > 0)
      .map((child) => rectOf(child));

    // The band is the distance actually painted between two children, which
    // `justify-content` can make much larger than the declared gap. Both are
    // shown when they disagree, and neither is called a margin (PRD LAY-02).
    const declaredGap = parsePx(axis === 'horizontal' ? style.columnGap : style.rowGap);
    flexGapBands(children, axis).forEach((band) => {
      drawTint(band.rect);
      const sameAsDeclared = Math.abs(band.size - declaredGap) < 0.5;
      const label =
        declaredGap > 0 && !sameAsDeclared
          ? `${formatPx(band.size)} (gap ${formatPx(declaredGap)})`
          : formatPx(band.size);
      drawTrackLabel(
        label,
        band.rect.x + band.rect.width / 2,
        band.rect.y + band.rect.height / 2,
      );
    });

    drawFlexArrow(content, axis, direction.endsWith('-reverse'));
    return '';
  }

  function drawLayoutOverlay(): void {
    layoutLayer.textContent = '';
    layoutLayer.style.transform = '';
    layoutOrigin = null;
    let note = '';

    const element = pinnedElement;
    if (layoutOverlayEnabled && element && element.isConnected) {
      let style: CSSStyleDeclaration | null = null;
      try {
        style = getComputedStyle(element);
      } catch {
        style = null;
      }
      const geometry = style ? geometryOf(element) : null;
      if (style && geometry) {
        const display = (style.display || '').toLowerCase();
        if (display.includes('grid')) note = drawGridOverlay(geometry, style);
        else if (display.includes('flex')) note = drawFlexOverlay(element, geometry, style);
        // Only a drawing can be translated; an empty layer is redrawn instead.
        if (layoutLayer.firstChild) layoutOrigin = { ...geometry.border };
      }
    }

    if (layoutNote) {
      layoutNote.textContent = note;
      layoutNote.hidden = note === '';
    }
  }

  /**
   * The scroll path. Tracks and bands are drawn in viewport coordinates, so a
   * scroll moves every one of them by the same offset: comparing the pinned
   * rect against the one the drawing was made from turns a full recompute
   * (a getComputedStyle, a geometry read and a few dozen nodes) into one
   * transform. Anything that changed the element's size still redraws (PERF 3).
   */
  function repositionLayoutOverlay(): void {
    const element = pinnedElement;
    if (!layoutOverlayEnabled || !element || !element.isConnected || !layoutOrigin) {
      drawLayoutOverlay();
      return;
    }
    let rect: DOMRect;
    try {
      rect = element.getBoundingClientRect();
    } catch {
      drawLayoutOverlay();
      return;
    }
    if (
      Math.abs(rect.width - layoutOrigin.width) > 0.5 ||
      Math.abs(rect.height - layoutOrigin.height) > 0.5
    ) {
      drawLayoutOverlay();
      return;
    }
    const dx = rect.x - layoutOrigin.x;
    const dy = rect.y - layoutOrigin.y;
    layoutLayer.style.transform = dx === 0 && dy === 0 ? '' : `translate(${dx}px, ${dy}px)`;
  }

  // -------------------------------------------------------------------------
  // Hover card

  function assetSummary(asset: AssetReading): string {
    const kind =
      asset.kind === 'svg-inline'
        ? 'Inline SVG'
        : asset.kind === 'css-background'
          ? 'CSS background'
          : asset.kind === 'picture'
            ? 'Picture'
            : asset.kind === 'video'
              ? 'Video'
              : 'Image';
    return kind;
  }

  function renderHoverCard(snapshot: ElementSnapshot): void {
    hoverCard.textContent = '';
    const stack = h('div', 'stack');
    hoverCard.appendChild(stack);

    const title = h('div', 'hover-title');
    title.textContent = snapshot.element.label;
    stack.appendChild(title);

    const line = (key: string, value: string): void => {
      const node = h('div', 'hover-row');
      node.append(h('span', undefined, key), h('span', undefined, value));
      stack.appendChild(node);
    };

    const type = snapshot.typography;
    const asset = snapshot.assets[0];

    if (type) {
      line('Family', `${type.familyReading} (${type.familyConfidence})`);
      line('Weight', String(type.weight));
      line('Size', sizeTextCompact(type.sizePx, snapshot.source));
      line('Line height', type.lineHeightPx === null ? type.lineHeightRaw : formatPx(type.lineHeightPx));
      line('Tracking', type.letterSpacingRaw === 'normal' ? 'normal' : formatPx(type.letterSpacingPx));
      const colorRow = h('div', 'hover-row');
      const colorValue = h('span');
      colorValue.appendChild(swatchFor(type.color));
      colorValue.appendChild(document.createTextNode(type.color.hex ?? type.color.raw));
      colorRow.append(h('span', undefined, 'Color'), colorValue);
      stack.appendChild(colorRow);
    } else if (asset) {
      line('Asset', assetSummary(asset));
      line('Rendered', sizePair(asset.renderedWidth, asset.renderedHeight));
      if (asset.intrinsicWidth && asset.intrinsicHeight) {
        line('Intrinsic', sizePair(asset.intrinsicWidth, asset.intrinsicHeight));
      }
      if (asset.url) line('Source', asset.url);
    } else {
      const layout = snapshot.layout;
      line('Size', sizePair(layout.layoutSize.width, layout.layoutSize.height));
      line('Display', layout.display);
      line('Padding', sidesText(layout.padding));
      if (layout.flex) line('Gap', `${formatPx(layout.flex.rowGap)} / ${formatPx(layout.flex.columnGap)}`);
      else if (layout.grid) line('Gap', `${formatPx(layout.grid.rowGap)} / ${formatPx(layout.grid.columnGap)}`);
      if (layout.maxWidth !== 'none') line('Max width', layout.maxWidth);
    }

    if (snapshot.layout.transformed) {
      stack.appendChild(h('div', 'note', 'Transformed: bounds are visual, not layout.'));
    }
  }

  // -------------------------------------------------------------------------
  // Pinned panel

  function renderAssetSection(snapshot: ElementSnapshot, parent: HTMLElement): void {
    if (snapshot.assets.length === 0) return;
    const { wrapper, body } = section('Assets', null);

    snapshot.assets.forEach((asset, index) => {
      body.appendChild(row('Type', assetSummary(asset)));
      if (asset.url) body.appendChild(row('URL', asset.url, { oneLine: true }));
      body.appendChild(row('Rendered', sizePair(asset.renderedWidth, asset.renderedHeight)));
      if (asset.intrinsicWidth !== null && asset.intrinsicHeight !== null) {
        body.appendChild(
          row('Intrinsic', sizePair(asset.intrinsicWidth, asset.intrinsicHeight)),
        );
      }
      if (asset.alt) body.appendChild(row('Alt text', asset.alt));
      asset.candidates.forEach((candidate, candidateIndex) => {
        body.appendChild(
          row(
            `Candidate ${candidateIndex + 1}`,
            candidate.descriptor ? `${candidate.url} (${candidate.descriptor})` : candidate.url,
            { copy: candidate.url, oneLine: true },
          ),
        );
      });

      // File size and MIME type are only knowable from the network, so they
      // are fetched when the user asks and never before (PRD 17.1).
      if (asset.url && !/^(data|blob|filesystem):/i.test(asset.url)) {
        const assetUrl = asset.url;
        const detailActions = h('div', 'form-actions');
        const detailStatus = h('span', 'note');
        const fetchDetails = button('Fetch file details', 'quiet', `Fetch file details for asset ${index + 1}`);
        fetchDetails.addEventListener('click', () => {
          fetchDetails.disabled = true;
          detailStatus.textContent = 'Contacting the asset host';
          void callbacks.onAssetDetails(assetUrl).then((result) => {
            fetchDetails.disabled = false;
            if (typeof result === 'string') {
              detailStatus.textContent = result;
              return;
            }
            detailStatus.textContent = '';
            body.insertBefore(
              row('File size', result.fileSize === null ? 'Unknown' : `${result.fileSize} bytes`),
              detailActions,
            );
            body.insertBefore(row('MIME', result.mimeType ?? 'Unknown'), detailActions);
            fetchDetails.hidden = true;
          });
        });
        detailActions.append(fetchDetails, detailStatus);
        body.appendChild(detailActions);
        body.appendChild(h('div', 'note', 'This contacts the asset’s host.'));
      }

      const actions = h('div', 'form-actions');
      const status = h('span', 'note');
      const download = button('Download', '', `Download asset ${index + 1}`);
      download.addEventListener('click', () => {
        download.disabled = true;
        const request: DownloadRequest | null = asset.url
          ? {
              url: asset.url,
              filename: filenameFromUrl(
                asset.url,
                `${safeName(snapshot.element.label)}.${extensionForDataUrl(asset.url)}`,
              ),
            }
          : asset.svgMarkup
            ? {
                dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.svgMarkup)}`,
                filename: `${safeName(snapshot.element.label)}.svg`,
              }
            : null;
        if (!request) {
          status.textContent = 'This asset has no downloadable source.';
          download.disabled = false;
          return;
        }
        void callbacks.onDownload(request).then((error) => {
          download.disabled = false;
          status.textContent = error ?? 'Download started';
        });
      });
      actions.append(download, status);
      body.appendChild(actions);

      asset.limitations.forEach((limitation) => body.appendChild(h('div', 'note', limitation)));
    });

    parent.appendChild(wrapper);
  }

  function renderSaveForm(
    snapshot: ElementSnapshot,
    /** The action grid the toggle joins, so all four actions share a shape. */
    actions: HTMLElement,
    /** Where the form itself goes: under the grid, full width. */
    parent: HTMLElement,
  ): void {
    const form = h('div', 'save-form');
    form.dataset.open = saveOpen ? 'true' : 'false';

    const titleInput = h('input');
    titleInput.type = 'text';
    titleInput.setAttribute('aria-label', 'Reference title');
    titleInput.value = `${snapshot.element.label} on ${snapshot.source.title || snapshot.source.url}`.slice(0, 160);

    const noteInput = h('textarea');
    noteInput.setAttribute('aria-label', 'Why this is useful');
    noteInput.placeholder = 'Why is this useful?';

    const checkLabel = h('label', 'check');
    const checkbox = h('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkLabel.append(checkbox, document.createTextNode('Include screenshot'));

    const formActions = h('div', 'form-actions');
    const submit = button('Save', 'primary', 'Save this reference');
    const status = h('span', 'note');
    formActions.append(submit, status);

    submit.addEventListener('click', () => {
      submit.disabled = true;
      status.textContent = 'Saving';
      void callbacks
        .onSave({
          title: titleInput.value,
          note: noteInput.value,
          captureScreenshot: checkbox.checked,
        })
        .then((error) => {
          submit.disabled = false;
          status.textContent = error ?? 'Saved';
        });
    });

    form.append(titleInput, noteInput, checkLabel, formActions);

    const toggle = button('Save reference', 'primary', 'Save reference');
    toggle.setAttribute('aria-expanded', saveOpen ? 'true' : 'false');
    toggle.addEventListener('click', () => {
      saveOpen = !saveOpen;
      form.dataset.open = saveOpen ? 'true' : 'false';
      toggle.setAttribute('aria-expanded', saveOpen ? 'true' : 'false');
      applyEscapeHint();
      if (saveOpen) titleInput.focus();
    });

    actions.append(toggle);
    parent.append(form);
  }

  /**
   * The tip line for the current selection. The same selection keeps the tip it
   * was given through every live re-read; a different one moves to the next tip
   * in the list, and an exhausted list is no tip line at all.
   */
  function currentTip(): string | null {
    if (tipFor !== pinnedElement) {
      if (tipFor !== null) tipIndex += 1;
      tipFor = pinnedElement;
    }
    return PANEL_TIPS[tipIndex] ?? null;
  }

  function renderPanel(snapshot: ElementSnapshot | null, missing: boolean): void {
    panel.textContent = '';
    // The panel is rebuilt on every live re-read, so the pieces that are
    // repainted on their own have to forget the nodes that just went away.
    openCopyMenu = null;
    measureBlock = null;
    measureBody = null;
    measureTitle = null;
    pickedSection = null;
    pickedBody = null;
    layoutNote = null;
    contrastPickHost = null;
    edgeBlock = null;
    edgeBody = null;
    edgeTitle = null;

    if (!snapshot) {
      panel.hidden = true;
      return;
    }

    const head = h('div', 'panel-head');
    makeDraggable(head);
    const title = h('div', 'panel-title', snapshot.element.label);
    // The label is a selector and can be far longer than the head: it
    // truncates, and the whole of it is one hover away.
    title.title = snapshot.element.label;
    head.appendChild(title);
    if (pinnedHidden) head.appendChild(h('span', 'chip', 'Not rendered'));
    if (snapshot.element.role) head.appendChild(h('span', 'chip', snapshot.element.role));
    const layoutToggle = button('Layout overlay', 'quiet', 'Toggle the grid and flex overlay');
    layoutToggle.id = 'panel-layout-overlay';
    layoutToggle.setAttribute('aria-pressed', layoutOverlayEnabled ? 'true' : 'false');
    layoutToggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Through the overlay's own setter, so the side panel's mirror of this
      // toggle hears about the change as well (W3).
      overlay.setLayoutOverlay(!layoutOverlayEnabled);
      callbacks.onToggleLayoutOverlay();
    });
    head.appendChild(layoutToggle);
    const close = button('Unpin', 'quiet', 'Unpin this element');
    close.addEventListener('click', () => callbacks.onUnpin());
    head.appendChild(close);
    panel.appendChild(head);

    const scroll = h('div', 'panel-scroll');
    panel.appendChild(scroll);
    panel.dataset.hiddenElement = pinnedHidden ? 'true' : 'false';

    if (missing) {
      scroll.appendChild(h('div', 'note', 'Element is no longer on the page.'));
    }
    if (pinnedHidden) {
      scroll.appendChild(
        h(
          'div',
          'panel-hidden-note',
          'Element is not rendered right now. These are the last readings taken.',
        ),
      );
    }

    // Breadcrumb: outermost ancestor first, then the element itself.
    //
    // A deeply nested element on a real page has eight or more ancestors, which
    // wrapped to four lines of chips and pushed the reading off the panel. The
    // middle of the chain is the part nobody reads, so it collapses behind a
    // count that expands in place.
    const crumbs = h('div', 'crumbs');
    crumbs.setAttribute('role', 'group');
    crumbs.setAttribute('aria-label', 'Ancestors');
    const chain = [...snapshot.ancestors].reverse();

    const crumbFor = (ancestor: (typeof chain)[number], reversedIndex: number): HTMLElement => {
      const index = snapshot.ancestors.length - 1 - reversedIndex;
      const crumb = button(ancestor.label, 'crumb', `Select ${ancestor.label}`);
      crumb.title = ancestor.label;
      crumb.addEventListener('click', () => callbacks.onSelectAncestor(index));
      return crumb;
    };

    const paintCrumbs = (expanded: boolean): void => {
      crumbs.textContent = '';
      const hidden = chain.length - (CRUMBS_HEAD + CRUMBS_TAIL);
      if (expanded || hidden <= 1) {
        chain.forEach((ancestor, reversedIndex) => {
          crumbs.appendChild(crumbFor(ancestor, reversedIndex));
        });
      } else {
        chain.slice(0, CRUMBS_HEAD).forEach((ancestor, reversedIndex) => {
          crumbs.appendChild(crumbFor(ancestor, reversedIndex));
        });
        const more = button(
          `+${hidden}`,
          'quiet crumb-more',
          `Show ${hidden} more ancestors`,
        );
        more.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          paintCrumbs(true);
        });
        crumbs.appendChild(more);
        chain.slice(chain.length - CRUMBS_TAIL).forEach((ancestor, offset) => {
          crumbs.appendChild(crumbFor(ancestor, chain.length - CRUMBS_TAIL + offset));
        });
      }

      const currentCrumb = h('span', 'chip accent crumb-current', snapshot.element.label);
      currentCrumb.title = snapshot.element.label;
      crumbs.appendChild(currentCrumb);

      // A click promoted to a semantic parent still shows the wrapper it came
      // from, as a child rather than an ancestor, so nothing is hidden by the
      // preference (competitive tester note).
      if (pinnedChild && pinnedChild.isConnected) {
        const childLabel = describeElement(pinnedChild).label;
        const childCrumb = button(childLabel, 'crumb', `Select ${childLabel}`);
        childCrumb.title = childLabel;
        childCrumb.dataset.role = 'child-crumb';
        childCrumb.addEventListener('click', () => callbacks.onSelectChild());
        crumbs.appendChild(childCrumb);
      }
    };

    paintCrumbs(false);
    scroll.appendChild(crumbs);

    // One tip per selection, in order, and not lost to a live re-read of the
    // same element, because then it would flash by unread. The ArrowUp tip is
    // first; the Escape order takes its place once it has been shown (Z2).
    const tip = currentTip();
    if (tip) scroll.appendChild(h('div', 'tip', tip));

    layoutNote = h('div', 'note');
    layoutNote.hidden = true;
    scroll.appendChild(layoutNote);

    measureBlock = h('div', 'measure-block');
    measureBlock.hidden = true;
    const measureHead = h('div', 'measure-head');
    measureTitle = h('span', undefined, 'Measure');
    measureHead.appendChild(measureTitle);
    measureBody = h('div', 'measure-body');
    measureBlock.append(measureHead, measureBody);
    scroll.appendChild(measureBlock);

    edgeBlock = h('div', 'measure-block');
    edgeBlock.id = 'edge-block';
    edgeBlock.hidden = true;
    const edgeHead = h('div', 'measure-head');
    edgeTitle = h('span', undefined, 'Edges');
    edgeHead.appendChild(edgeTitle);
    edgeBody = h('div', 'measure-body');
    edgeBlock.append(edgeHead, edgeBody);
    scroll.appendChild(edgeBlock);

    const picked = section('Picked color', null);
    pickedSection = picked.wrapper;
    pickedBody = picked.body;
    pickedSection.hidden = true;
    scroll.appendChild(pickedSection);

    const type = snapshot.typography;
    const fluidRoot = snapshot.source.rootFontSizeFluid === true;
    if (type) {
      const { wrapper, body } = section('Typography', 'typography');
      // Why the px readings below move when the window does. One line, at the
      // top of the section, because it governs every size in it.
      if (fluidRoot) body.appendChild(h('div', 'note', fluidRootNote(snapshot.source)));
      body.appendChild(
        row('Family', `${type.familyReading} (${type.familyConfidence})`, { copy: type.familyReading }),
      );
      if (type.familyStack.length > 1) {
        body.appendChild(row('Stack', type.familyStack.join(', ')));
      }
      body.appendChild(
        row(
          'Source',
          type.source.url ? `${type.source.kind}: ${type.source.url}` : type.source.kind,
          { copy: type.source.url ?? type.source.kind, oneLine: !!type.source.url },
        ),
      );
      if (type.source.format) body.appendChild(row('Format', type.source.format));
      const downloadable = !!type.source.url && FONT_FILE.test(type.source.url);
      // With a Download button present the subset caveat belongs on the button
      // as one sentence, not as a separate row plus a note.
      if (type.source.subset !== null && !downloadable) {
        body.appendChild(row('Subset', type.source.subset ? 'yes' : 'no'));
      }
      if (type.source.note) body.appendChild(h('div', 'note', type.source.note));
      if (downloadable && type.source.url) {
        // A discovered font file can be downloaded, but it may be a subset
        // rather than the whole family (PRD TYP-03).
        const fontUrl = type.source.url;
        const actions = h('div', 'form-actions');
        const status = h('span', 'note');
        const download = button('Download font', '', `Download the ${type.familyReading} font file`);
        download.addEventListener('click', () => {
          download.disabled = true;
          void callbacks
            .onDownload({
              url: fontUrl,
              filename: filenameFromUrl(fontUrl, `${safeName(type.familyReading)}.woff2`),
            })
            .then((error) => {
              download.disabled = false;
              status.textContent = error ?? 'Download started';
            });
        });
        // One sentence beside the button says what the file is and is not.
        const caveat = h(
          'span',
          'note',
          type.source.subset === false
            ? 'Download the discovered file'
            : 'Download the discovered file (a subset, not the whole family)',
        );
        actions.append(download, caveat, status);
        body.appendChild(actions);
      }
      body.appendChild(row('Weight', String(type.weight)));
      body.appendChild(row('Style', type.style));
      if (type.variationSettings) body.appendChild(row('Variations', type.variationSettings));
      // One Size row rather than a px row and a rem row: the two are one
      // reading, and on a fluid root only their order says which one is stable.
      body.appendChild(
        row('Size', sizeText(type.sizePx, snapshot.source), {
          copy: sizeCopyText(type.sizePx, snapshot.source),
        }),
      );
      const lineRatio =
        type.lineHeightRatio === null
          ? null
          : formatNumber(roundTo(type.lineHeightRatio, 3), 3);
      body.appendChild(
        row(
          'Line height',
          type.lineHeightPx === null
            ? type.lineHeightRaw
            : fluidRoot && lineRatio
              ? `${lineRatio} ratio · ${formatPx(type.lineHeightPx)} at this width`
              : `${formatPx(type.lineHeightPx)}${lineRatio ? ` (${lineRatio})` : ''}`,
          { copy: type.lineHeightRaw },
        ),
      );
      const trackingEm =
        type.letterSpacingEm === null
          ? null
          : `${formatNumber(roundTo(type.letterSpacingEm, 4), 4)}em`;
      body.appendChild(
        row(
          'Letter spacing',
          type.letterSpacingRaw === 'normal'
            ? 'normal'
            : fluidRoot && trackingEm
              ? `${trackingEm} · ${formatPx(type.letterSpacingPx)} at this width`
              : `${formatPx(type.letterSpacingPx)}${trackingEm ? ` (${trackingEm})` : ''}`,
          { copy: type.letterSpacingRaw },
        ),
      );
      if (type.textTransform !== 'none') body.appendChild(row('Transform', type.textTransform));
      if (type.textDecoration !== 'none') body.appendChild(row('Decoration', type.textDecoration));
      if (type.fontVariant !== 'normal') body.appendChild(row('Variant', type.fontVariant));
      body.appendChild(
        row('Color', type.color.hex ?? type.color.raw, { color: type.color, copy: type.color.raw }),
      );
      body.appendChild(row('Color (rgb)', type.color.rgb ?? 'unavailable'));
      body.appendChild(row('Color (oklch)', type.color.oklch ?? 'unavailable'));
      if (type.color.lossy) {
        body.appendChild(
          h('div', 'note', 'This color was converted from outside sRGB, so hex and rgb are clipped.'),
        );
      }
      if (type.contrast.ratio !== null) {
        body.appendChild(
          row(
            'Contrast',
            `${formatNumber(type.contrast.ratio, 2)}:1 (${type.contrast.foreground ?? ''} on ${type.contrast.background ?? ''})`,
            { copy: `${type.contrast.ratio}` },
          ),
        );
        body.appendChild(
          h('div', 'note', 'A reading for this state, not an accessibility certification.'),
        );
      } else {
        body.appendChild(h('div', 'note', type.contrast.reason ?? 'Contrast unavailable.'));
      }
      // When contrast is unavailable the user can supply the background pixel
      // themselves; the offer lives next to the contrast row either way.
      if (type.contrast.status === 'unavailable') {
        contrastPickHost = h('div', 'stack');
        body.appendChild(contrastPickHost);
      }
      scroll.appendChild(wrapper);
    }

    const surfaces = snapshot.surfaces;
    const surfaceSection = section('Surfaces', 'surfaces');
    surfaceSection.body.appendChild(
      row('Background', surfaces.backgroundColor.hex ?? surfaces.backgroundColor.raw, {
        color: surfaces.backgroundColor,
        copy: surfaces.backgroundColor.raw,
      }),
    );
    surfaces.backgroundLayers.forEach((layer, index) => {
      surfaceSection.body.appendChild(row(`Layer ${index + 1}`, layer));
    });
    (['top', 'right', 'bottom', 'left'] as const).forEach((side) => {
      if (surfaces.borderWidth[side] > 0 && surfaces.borderStyle[side] !== 'none') {
        surfaceSection.body.appendChild(
          row(
            `Border ${side}`,
            `${formatPx(surfaces.borderWidth[side])} ${surfaces.borderStyle[side]} ${surfaces.borderColor[side].hex ?? ''}`,
            { color: surfaces.borderColor[side] },
          ),
        );
      }
    });
    const radius = surfaces.radius;
    const radiusText = [radius.topLeft, radius.topRight, radius.bottomRight, radius.bottomLeft].join(' ');
    surfaceSection.body.appendChild(row('Radius', radiusText));
    surfaces.boxShadow.forEach((shadow, index) => {
      surfaceSection.body.appendChild(row(`Box shadow ${index + 1}`, shadow));
    });
    surfaces.textShadow.forEach((shadow, index) => {
      surfaceSection.body.appendChild(row(`Text shadow ${index + 1}`, shadow));
    });
    if (surfaces.opacity !== 1) surfaceSection.body.appendChild(row('Opacity', String(surfaces.opacity)));
    if (surfaces.filter !== 'none') surfaceSection.body.appendChild(row('Filter', surfaces.filter));
    if (surfaces.backdropFilter !== 'none') {
      surfaceSection.body.appendChild(row('Backdrop filter', surfaces.backdropFilter));
    }
    if (surfaces.fill) {
      surfaceSection.body.appendChild(
        row('Fill', surfaces.fill.hex ?? surfaces.fill.raw, { color: surfaces.fill }),
      );
    }
    if (surfaces.stroke) {
      surfaceSection.body.appendChild(
        row('Stroke', surfaces.stroke.hex ?? surfaces.stroke.raw, { color: surfaces.stroke }),
      );
    }
    scroll.appendChild(surfaceSection.wrapper);

    const layout = snapshot.layout;
    const layoutSection = section('Layout', 'layout');
    layoutSection.body.appendChild(row('Display', layout.display));
    layoutSection.body.appendChild(row('Box sizing', layout.boxSizing));
    layoutSection.body.appendChild(
      row('Layout size', sizePair(layout.layoutSize.width, layout.layoutSize.height)),
    );
    layoutSection.body.appendChild(
      row('Visual bounds', sizePair(layout.visualRect.width, layout.visualRect.height)),
    );
    if (layout.transformed) {
      layoutSection.body.appendChild(
        h('div', 'note', 'Transformed: visual bounds are axis aligned, not the layout box.'),
      );
    }
    layoutSection.body.appendChild(row('Padding', sidesText(layout.padding)));
    layoutSection.body.appendChild(row('Margin', sidesText(layout.margin)));
    layoutSection.body.appendChild(row('Border', sidesText(layout.border)));
    layoutSection.body.appendChild(
      row('Width limits', `min ${layout.minWidth}, max ${layout.maxWidth}`),
    );
    layoutSection.body.appendChild(
      row('Height limits', `min ${layout.minHeight}, max ${layout.maxHeight}`),
    );
    if (layout.flex) {
      layoutSection.body.appendChild(
        row('Flex', `${layout.flex.direction} ${layout.flex.wrap}`),
      );
      layoutSection.body.appendChild(
        row('Align', `${layout.flex.justifyContent} / ${layout.flex.alignItems}`),
      );
      layoutSection.body.appendChild(
        row('Gap', `${formatPx(layout.flex.rowGap)} ${formatPx(layout.flex.columnGap)}`),
      );
    }
    if (layout.grid) {
      layoutSection.body.appendChild(row('Grid columns', layout.grid.templateColumns));
      layoutSection.body.appendChild(row('Grid rows', layout.grid.templateRows));
      layoutSection.body.appendChild(row('Auto flow', layout.grid.autoFlow));
      layoutSection.body.appendChild(
        row('Gap', `${formatPx(layout.grid.rowGap)} ${formatPx(layout.grid.columnGap)}`),
      );
      if (layout.grid.itemPlacement) {
        layoutSection.body.appendChild(
          row(
            'Placement',
            `column ${layout.grid.itemPlacement.column}, row ${layout.grid.itemPlacement.row}`,
          ),
        );
      }
    }
    layoutSection.body.appendChild(row('Position', layout.position));
    if (layout.position !== 'static') {
      layoutSection.body.appendChild(
        row(
          'Inset',
          `${layout.inset.top} ${layout.inset.right} ${layout.inset.bottom} ${layout.inset.left}`,
        ),
      );
    }
    layoutSection.body.appendChild(row('z-index', layout.zIndex));
    Object.entries(layout.sourceExpressions).forEach(([property, value]) => {
      layoutSection.body.appendChild(row(`Authored ${property}`, value));
    });
    scroll.appendChild(layoutSection.wrapper);

    renderAssetSection(snapshot, scroll);

    if (snapshot.limitations.length > 0) {
      const list = h('ul', 'limitations');
      snapshot.limitations.forEach((limitation) => list.appendChild(h('li', undefined, limitation)));
      scroll.appendChild(list);
    }

    // Four actions of very different label lengths wrapped into an uneven row,
    // so they sit on a two column grid: equal widths, two tidy lines, and the
    // one accent button in the last cell where the eye ends up.
    const actions = h('div', 'panel-actions');
    const reread = button('Re-read', '', 'Read this element again');
    reread.addEventListener('click', () => callbacks.onReread());
    const parent = button('Select parent', '', 'Select the parent element');
    parent.addEventListener('click', () => callbacks.onNavigate('up'));
    const child = button('Select child', '', 'Select the first child element');
    child.addEventListener('click', () => callbacks.onNavigate('down'));
    actions.append(reread, parent, child);
    scroll.appendChild(actions);

    renderSaveForm(snapshot, actions, scroll);

    panel.hidden = false;
  }

  // -------------------------------------------------------------------------
  // Public surface

  function repositionCards(): void {
    if (!hoverCard.hidden) {
      // The page can scroll under a still pointer, so the hover card follows
      // the element's live rect rather than the rect captured at hover time.
      const live = hoverElement?.isConnected ? hoverElement.getBoundingClientRect() : null;
      positionCard(
        hoverCard,
        live
          ? { x: live.x, y: live.y, width: live.width, height: live.height }
          : hoverSnapshot
            ? hoverSnapshot.layout.visualRect
            : null,
      );
    }
    if (!panel.hidden && pinnedElement) {
      const rect = pinnedElement.isConnected
        ? pinnedElement.getBoundingClientRect()
        : null;
      positionCard(panel, rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null);
    }
  }

  function drawHighlights(): void {
    highlightLayer.textContent = '';
    highlighted.slice(0, MAX_HIGHLIGHTS).forEach((element) => {
      if (!element.isConnected) return;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const node = h('div', 'outline');
      place(node, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      highlightLayer.appendChild(node);
    });
  }

  const overlay: Overlay = {
    host,
    root,

    setMode(next) {
      mode = next;
      badge.dataset.mode = next;
      badge.hidden = next === 'off';
      badgeText.textContent = next === 'paused' ? 'Paused' : 'Inspecting';
      interactButton.textContent = next === 'paused' ? 'Resume inspecting' : 'Interact with page';
      interactButton.setAttribute(
        'aria-label',
        next === 'paused' ? 'Resume inspecting' : 'Interact with page',
      );
      if (next === 'off') {
        overlay.setHover(null, null);
        overlay.setPinned(null, null);
        overlay.clearHighlight();
        clearBox();
        pickCard.hidden = true;
        overlay.setEdges(null);
      }
      if (next === 'paused') {
        hoverCard.hidden = true;
        hoverElement = null;
        hoverSnapshot = null;
        drawBox(pinnedElement);
      }
      // Rulers outlive a mode change, like outlines do: the point of pausing is
      // to use the page while still reading the measurements over it.
      drawRulers();
      applyEscapeHint();
    },

    setOutlines(next) {
      // The label stays one word; the pressed state carries the meaning.
      outlinesButton.setAttribute('aria-pressed', next === 'off' ? 'false' : 'true');
      outlinesButton.dataset.coloring = next;
    },

    setHover(snapshot, element) {
      hoverSnapshot = snapshot;
      hoverElement = element;
      if (!snapshot || !element || pinnedElement || mode !== 'active') {
        hoverCard.hidden = true;
        if (!pinnedElement) drawBox(pinnedElement ?? hoverElement);
        if (rulersEnabled) drawRulers();
        return;
      }
      // Reads first, writes after, and no read at all that the snapshot has
      // already made: the box model comes out of the reading that was just
      // taken, so a hover frame measures the element once (PRD 19.1, PERF 3).
      const geometry = geometryOfLayout(snapshot.layout);
      renderHoverCard(snapshot);
      hoverCard.hidden = false;
      drawBoxGeometry(geometry);
      positionCard(hoverCard, snapshot.layout.visualRect);
      // The ruler's accent marks follow the hovered element, off the rect that
      // has already been measured rather than off a fresh one.
      if (rulersEnabled) drawRulers(geometry?.border ?? null);
    },

    setPinned(snapshot, element, options = {}) {
      if (options.child !== undefined) pinnedChild = options.child;
      // A different element means a different background question, so a
      // previously picked contrast background does not carry over.
      if (element !== pinnedElement) pickedBackground = null;
      // A fresh reading is by definition a rendered one.
      pinnedHidden = false;
      pinnedSnapshot = snapshot;
      pinnedElement = element;
      if (!snapshot) {
        saveOpen = false;
        pinnedChild = null;
        measureElement = null;
        measureLockedFlag = false;
        renderPanel(null, false);
        drawBox(hoverElement);
        drawLayoutOverlay();
        drawMeasure();
        paintPicked();
        // The panel went away, so a live edge reading moves to its own card.
        paintEdgeBlock();
        return;
      }
      hoverCard.hidden = true;
      renderPanel(snapshot, false);
      drawBox(element);
      drawLayoutOverlay();
      drawMeasure();
      paintPicked();
      paintPickedContrast();
      paintEdgeBlock();
      if (rulersEnabled) drawRulers();
      repositionCards();
    },

    setPinnedHidden(hidden) {
      if (hidden === pinnedHidden) return;
      pinnedHidden = hidden;
      if (!pinnedSnapshot) return;
      renderPanel(pinnedSnapshot, false);
      if (hidden) {
        // Bands drawn around a zero sized box would be a lie about the layout.
        clearBox();
        layoutLayer.textContent = '';
        measureElement = null;
        measureLockedFlag = false;
        drawMeasure();
      } else {
        drawBox(pinnedElement);
        drawLayoutOverlay();
      }
      paintPicked();
      paintPickedContrast();
      repositionCards();
    },

    markPinnedMissing() {
      if (!pinnedSnapshot) return;
      renderPanel(pinnedSnapshot, true);
      clearBox();
      layoutLayer.textContent = '';
      measureElement = null;
      measureLockedFlag = false;
      drawMeasure();
      paintPicked();
      paintPickedContrast();
      repositionCards();
    },

    setMeasure(element, options = {}) {
      measureElement = element;
      // A lock is only ever let go of on purpose. A hover frame that landed
      // after an Alt+click used to clear it by arriving with no options at all
      // (tester finding F1), so silence now means "leave it as it is".
      if (options.locked === true) measureLockedFlag = true;
      else if (options.locked === false) measureLockedFlag = false;
      drawMeasure();
    },

    measureLocked() {
      return measureLockedFlag && measureElement !== null;
    },

    setEdges(point, options = {}) {
      edgePoint = point;
      edgeLockedFlag = point !== null && options.locked === true;
      drawEdges();
    },

    edgesLocked() {
      return edgeLockedFlag && edgePoint !== null;
    },

    setRulers(enabled) {
      rulersEnabled = enabled;
      drawRulers();
    },

    rulersOn() {
      return rulersEnabled;
    },

    setSemanticParents(enabled) {
      semanticButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    },

    setLayoutOverlay(enabled) {
      layoutOverlayEnabled = enabled;
      // The toggle lives in the pinned panel's head, which only exists while
      // something is pinned; the drawing below is what the page actually sees.
      panel
        .querySelector('#panel-layout-overlay')
        ?.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      drawLayoutOverlay();
    },

    layoutOverlayOn() {
      return layoutOverlayEnabled;
    },

    setBadgeCollapsed(collapsed, reason) {
      badgeCollapsed = recordBadgeCollapse(collapsed, reason);
      applyBadgeCollapsed();
    },

    badgeCollapsed() {
      return badgeCollapsed;
    },

    setMockup(mockup) {
      mockupLayer.set(mockup);
      applyMockupBadge();
    },

    mockupState() {
      return mockupLayer.current();
    },

    mockupDragStart(point) {
      return mockupLayer.dragStart(point);
    },

    mockupDragMove(point) {
      mockupLayer.dragMove(point);
    },

    mockupDragEnd() {
      mockupLayer.dragEnd();
    },

    reposition() {
      drawBox(pinnedElement ?? hoverElement);
      repositionLayoutOverlay();
      drawMeasure();
      // A scroll moves the page under a fixed pointer, so the edges genuinely
      // changed and the reading is taken again rather than translated.
      drawEdges();
      drawHighlights();
      drawRulers();
      mockupLayer.reposition();
      repositionCards();
    },

    setVisible(visible) {
      hostVisible = visible;
      applyHostDisplay(false);
    },

    highlight(elements) {
      highlighted = elements.slice(0, MAX_HIGHLIGHTS);
      drawHighlights();
    },

    clearHighlight() {
      highlighted = [];
      highlightLayer.textContent = '';
    },

    setScanProgress(scanned, total) {
      badgeProgress.textContent =
        total === null ? '' : `Scanning ${scanned}${total > 0 ? ` of ${total}` : ''}`;
    },

    closeMenu() {
      // A copy menu is the shallowest thing Escape can be holding, so it goes
      // first, and one press never closes both it and the save form.
      if (closeCopyMenu()) {
        applyEscapeHint();
        return true;
      }
      if (!saveOpen) return false;
      saveOpen = false;
      const form = panel.querySelector('.save-form') as HTMLElement | null;
      if (form) form.dataset.open = 'false';
      applyEscapeHint();
      return true;
    },

    hasOpenMenu() {
      return saveOpen || openCopyMenu !== null;
    },

    owns(node) {
      return ownsNode(node);
    },

    panelHasFocus() {
      const active = root.activeElement;
      return !!active && panel.contains(active);
    },

    focusPanel() {
      if (panel.hidden) return;
      panel.focus();
    },

    hasTextSelection() {
      // shadowRoot.getSelection is Chrome specific, so it is probed not assumed.
      const scoped = root as ShadowRoot & { getSelection?(): Selection | null };
      const selection = scoped.getSelection ? scoped.getSelection() : null;
      if (selection && !selection.isCollapsed) return true;
      const windowSelection = window.getSelection();
      if (!windowSelection || windowSelection.isCollapsed) return false;
      return overlay.owns(windowSelection.anchorNode);
    },

    msSinceCopy() {
      return Date.now() - lastCopyAt;
    },

    destroy() {
      window.removeEventListener('resize', syncBadgeToViewport);
      host.remove();
      // The mockup host is ours too, and leaving it behind would leave an
      // image floating over a page with no inspector to remove it.
      mockupLayer.destroy();
    },
  };

  applyEscapeHint();
  return overlay;
}
