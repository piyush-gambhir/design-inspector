












import { isViewportDependentLength } from '@/lib/readings/units';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export function formatCapturedAt(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;





  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${when.getDate()} ${MONTHS[when.getMonth()]} ${when.getFullYear()}, ` +
    `${pad(when.getHours())}:${pad(when.getMinutes())}`
  );
}











function trim(value: number, places: number): string {
  if (!Number.isFinite(value)) return '0';
  const text = value.toFixed(places);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}


export function formatPxLabel(value: number, places = 2): string {
  return `${trim(value, places)} px`;
}


export function formatRemLabel(px: number, rootFontSize: number): string | null {
  if (!Number.isFinite(rootFontSize) || rootFontSize <= 0) return null;
  return `${trim(px / rootFontSize, 3)} rem`;
}


export function isPlainRoot(rootFontSize: number): boolean {
  return Number.isFinite(rootFontSize) && rootFontSize > 0 && Number.isInteger(rootFontSize);
}






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


function pxValue(raw: string): number | null {
  const text = raw.trim();
  if (!/px$/i.test(text)) return null;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}







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





export function formatBytesLabel(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return 'Unknown';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${trim(kb, 2)} KB`;
  return `${trim(kb / 1024, 2)} MB`;
}


export function formatViewport(viewport: {
  width: number;
  height: number;
  devicePixelRatio: number;
}): string {
  const ratio = String(Number(viewport.devicePixelRatio.toFixed(2)));
  return `${viewport.width} x ${viewport.height} at ${ratio}x`;
}
