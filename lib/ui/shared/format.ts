// Reading-to-text helpers shared by the panel surfaces.
//
// A stored reading is an ISO timestamp and a raw viewport record, because that
// is what an export and a diff need. A person reading the panel needs neither:
// they need to know when this was taken and how wide the window was, in the
// fewest characters that still say it exactly. These helpers are the display
// layer only, and nothing they produce is ever exported.

/**
 * An ISO timestamp as local date and time, for example "18 Sep 2026, 15:36".
 * The panel is 340px wide on a normal day, and the ISO string alone is 24
 * characters of which the reader uses six.
 */
import { isViewportDependentLength } from '@/lib/readings/units';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export function formatCapturedAt(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;
  // Local time, but a fixed day-month-year order, a three letter month and a
  // 24 hour clock. A reading that says 09/10 is a reading nobody can date, the
  // month name is written out rather than left to the platform's idea of
  // "short" (which is "Sept" in some ICU builds), and the panel reads the same
  // on every machine it is opened on.
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${when.getDate()} ${MONTHS[when.getMonth()]} ${when.getFullYear()}, ` +
    `${pad(when.getHours())}:${pad(when.getMinutes())}`
  );
}

// ---------------------------------------------------------------------------
// Sizes.
//
// Two decimals at most, trailing zeros stripped, and the unit spaced off the
// number: the side panel writes "16.12 px" and "1.125 rem" everywhere, while
// the overlay writes the same readings code-style, as "16.12px". Which of the
// two values leads is a fact about the page: when the root font size scales
// with the viewport, the px reading is only true at this window width, so the
// rem value goes first and the px value follows it.

function trim(value: number, places: number): string {
  if (!Number.isFinite(value)) return '0';
  const text = value.toFixed(places);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** "16.12 px". */
export function formatPxLabel(value: number, places = 2): string {
  return `${trim(value, places)} px`;
}

/** "1.125 rem", to three decimals, or null when the root is unusable. */
export function formatRemLabel(px: number, rootFontSize: number): string | null {
  if (!Number.isFinite(rootFontSize) || rootFontSize <= 0) return null;
  return `${trim(px / rootFontSize, 3)} rem`;
}

/** True for a root font size a person could have typed, such as 16 or 20. */
export function isPlainRoot(rootFontSize: number): boolean {
  return Number.isFinite(rootFontSize) && rootFontSize > 0 && Number.isInteger(rootFontSize);
}

/**
 * A text size for the side panel. Fluid roots read rem first, a whole px size
 * on a plain root needs no rem at all, and everything else reads px first with
 * the rem equivalent after it.
 */
export function formatSizeLabel(
  px: number,
  rootFontSize: number,
  fluid: boolean | undefined,
): string {
  const rem = formatRemLabel(px, rootFontSize);
  if (fluid && rem) return `${rem} · ${formatPxLabel(px)}`;
  if (!rem) return formatPxLabel(px);
  if (isPlainRoot(rootFontSize) && Number.isInteger(px)) return formatPxLabel(px);
  return `${formatPxLabel(px)} · ${rem}`;
}

/**
 * The Scope card's root font size: the reading, then why px values move.
 *
 * The authored value is only named when it is the one that moves. A page can be
 * read as fluid off its computed root alone, and naming the plain `1rem` rule
 * we happened to read as the cause of that would be wrong.
 */
export function formatRootFontSize(source: {
  rootFontSize: number;
  rootFontSizeAuthored?: string | null;
  rootFontSizeFluid?: boolean;
}): string {
  const reading = formatPxLabel(source.rootFontSize);
  if (!source.rootFontSizeFluid) return reading;
  const authored = (source.rootFontSizeAuthored ?? '').trim();
  return isViewportDependentLength(authored)
    ? `${reading} (fluid, from ${authored})`
    : `${reading} (fluid)`;
}

/** The leading number of a computed length, when it is one in px. */
function pxValue(raw: string): number | null {
  const text = raw.trim();
  if (!/px$/i.test(text)) return null;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * A line height, in the side panel's voice. The computed value arrives as a
 * raw string ("57.68px", "normal", "1.5"), and a px reading on its own says
 * nothing about the type it belongs to, so the ratio against the size goes with
 * it. On a fluid root the ratio leads, because it is the stable half.
 */
export function formatLineHeightLabel(
  raw: string,
  sizePx: number,
  fluid?: boolean,
): string {
  const px = pxValue(raw);
  if (px === null) return raw.trim() || 'normal';
  const label = formatPxLabel(px);
  if (!(sizePx > 0)) return label;
  const ratio = trim(px / sizePx, 2);
  return fluid ? `${ratio} ratio · ${label}` : `${label} (${ratio})`;
}

/** Letter spacing, with its em equivalent, on the same rule as line height. */
export function formatTrackingLabel(raw: string, sizePx: number, fluid?: boolean): string {
  const text = raw.trim();
  if (text === '' || text === 'normal') return 'normal';
  const px = pxValue(text);
  if (px === null) return text;
  const label = formatPxLabel(px);
  if (!(sizePx > 0)) return label;
  const em = `${trim(px / sizePx, 3)} em`;
  return fluid ? `${em} · ${label}` : `${label} (${em})`;
}

/**
 * A file size with the same decimal rule as every other number in the panel:
 * at most two decimals, trailing zeros stripped, the unit spaced off.
 */
export function formatBytesLabel(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return 'Unknown';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${trim(kb, 2)} KB`;
  return `${trim(kb / 1024, 2)} MB`;
}

/** "1126 x 853 at 2x". The unit is CSS px everywhere in this product. */
export function formatViewport(viewport: {
  width: number;
  height: number;
  devicePixelRatio: number;
}): string {
  const ratio = String(Number(viewport.devicePixelRatio.toFixed(2)));
  return `${viewport.width} x ${viewport.height} at ${ratio}x`;
}
