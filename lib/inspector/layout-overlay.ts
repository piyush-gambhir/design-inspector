







import type { Rect } from '../contracts';
import { roundTo, splitTopLevel } from '../readings/units';

const PX_TRACK = /^-?\d+(?:\.\d+)?px$/;








export function parseTrackList(computed: string | null | undefined): number[] | null {
  const text = (computed ?? '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower === 'none' || lower === 'auto' || lower === 'masonry' || lower === 'subgrid') {
    return null;
  }

  const tokens = splitTopLevel(text, ' ');
  if (tokens.length === 0) return null;

  const sizes: number[] = [];
  for (const token of tokens) {
    if (!PX_TRACK.test(token)) return null;
    const value = Number.parseFloat(token);
    if (!Number.isFinite(value)) return null;
    sizes.push(roundTo(value, 2));
  }
  return sizes;
}

export interface TrackBand {

  start: number;
  size: number;

  gap: boolean;

  index: number | null;
}






export function trackBands(sizes: number[], gap: number): TrackBand[] {
  const bands: TrackBand[] = [];
  let offset = 0;
  sizes.forEach((size, index) => {
    bands.push({ start: roundTo(offset, 2), size: roundTo(size, 2), gap: false, index: index + 1 });
    offset += size;
    if (index < sizes.length - 1 && gap > 0) {
      bands.push({ start: roundTo(offset, 2), size: roundTo(gap, 2), gap: true, index: null });
      offset += gap;
    }
  });
  return bands;
}

export type FlexAxis = 'horizontal' | 'vertical';


export function flexMainAxis(direction: string | null | undefined): FlexAxis {
  const text = (direction ?? 'row').trim().toLowerCase();
  return text.startsWith('column') ? 'vertical' : 'horizontal';
}

export interface GapBand {

  rect: Rect;

  size: number;
}








export function flexGapBands(children: Rect[], axis: FlexAxis): GapBand[] {
  const horizontal = axis === 'horizontal';
  const mainStart = (rect: Rect): number => (horizontal ? rect.x : rect.y);
  const mainEnd = (rect: Rect): number => (horizontal ? rect.x + rect.width : rect.y + rect.height);
  const crossStart = (rect: Rect): number => (horizontal ? rect.y : rect.x);
  const crossEnd = (rect: Rect): number => (horizontal ? rect.y + rect.height : rect.x + rect.width);

  const ordered = [...children].sort((left, right) => mainStart(left) - mainStart(right));
  const bands: GapBand[] = [];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const current = ordered[index] as Rect;
    const next = ordered[index + 1] as Rect;


    const sharedStart = Math.max(crossStart(current), crossStart(next));
    const sharedEnd = Math.min(crossEnd(current), crossEnd(next));
    if (sharedEnd <= sharedStart) continue;

    const size = roundTo(mainStart(next) - mainEnd(current), 2);
    if (size <= 0) continue;

    bands.push({
      rect: horizontal
        ? { x: mainEnd(current), y: sharedStart, width: size, height: sharedEnd - sharedStart }
        : { x: sharedStart, y: mainEnd(current), width: sharedEnd - sharedStart, height: size },
      size,
    });
  }

  return bands;
}
