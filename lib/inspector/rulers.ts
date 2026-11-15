











export const RULER_SIZE = 20;


export const MINOR_STEP = 10;


export const MAJOR_STEP = 100;

export interface RulerTick {

  position: number;

  value: number;

  major: boolean;
}










export function rulerTicks(
  scroll: number,
  length: number,
  minor: number = MINOR_STEP,
  major: number = MAJOR_STEP,
): RulerTick[] {
  const step = Math.max(1, minor);
  const majorStep = Math.max(step, major);
  if (length <= 0) return [];

  const first = Math.floor(scroll / step) * step;
  const last = scroll + length;
  const ticks: RulerTick[] = [];


  const maxTicks = 4000;

  for (let value = first; value <= last && ticks.length < maxTicks; value += step) {
    ticks.push({
      position: value - scroll,
      value,

      major: Math.round(value) % Math.round(majorStep) === 0,
    });
  }
  return ticks;
}

export type GuideAxis = 'x' | 'y';

export interface PageGuide {
  id: string;
  axis: GuideAxis;

  position: number;
}

let guideCounter = 0;

export function createGuide(axis: GuideAxis, position: number): PageGuide {
  guideCounter += 1;
  return { id: `guide-${guideCounter}`, axis, position: Math.round(position) };
}






const sessionGuides: PageGuide[] = [];

export function listGuides(): PageGuide[] {
  return [...sessionGuides];
}

export function addGuide(axis: GuideAxis, position: number): PageGuide {
  const guide = createGuide(axis, position);
  sessionGuides.push(guide);
  return guide;
}

export function moveGuide(id: string, position: number): void {
  const guide = sessionGuides.find((entry) => entry.id === id);
  if (guide) guide.position = Math.round(position);
}

export function removeGuide(id: string): void {
  const index = sessionGuides.findIndex((entry) => entry.id === id);
  if (index >= 0) sessionGuides.splice(index, 1);
}


export function resetGuides(): void {
  sessionGuides.length = 0;
  guideCounter = 0;
}
