














import type { OutlineMode } from '../messages';
import { HOST_TAG } from './overlay';


export const OUTLINE_STYLE_ATTRIBUTE = 'data-design-inspector-outlines';

const OUTLINE_STYLE_SELECTOR = `style[${OUTLINE_STYLE_ATTRIBUTE}]`;


export const HOST_EXCLUSION_RULE = `${HOST_TAG}, ${HOST_TAG} * { outline: none !important; }`;

interface TagGroup {

  name: string;
  color: string;
  tags: readonly string[];
}






export const TAG_GROUPS: readonly TagGroup[] = [
  {
    name: 'sectioning',
    color: 'oklch(0.62 0.16 255)',
    tags: ['header', 'nav', 'main', 'section', 'article', 'aside', 'footer'],
  },
  { name: 'containers', color: 'oklch(0.64 0.13 175)', tags: ['div'] },
  {
    name: 'text blocks',
    color: 'oklch(0.63 0.17 330)',
    tags: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'],
  },
  {
    name: 'inline text',
    color: 'oklch(0.64 0.15 140)',
    tags: ['span', 'a', 'strong', 'em', 'small', 'code'],
  },
  {
    name: 'lists',
    color: 'oklch(0.66 0.14 90)',
    tags: ['ul', 'ol', 'li', 'dl', 'dt', 'dd'],
  },
  {
    name: 'media',
    color: 'oklch(0.65 0.17 40)',
    tags: ['img', 'picture', 'svg', 'video', 'canvas', 'iframe'],
  },
  {
    name: 'forms',
    color: 'oklch(0.61 0.17 295)',
    tags: ['form', 'input', 'button', 'select', 'textarea', 'label'],
  },
  {
    name: 'tables',
    color: 'oklch(0.62 0.16 15)',
    tags: ['table', 'thead', 'tbody', 'tr', 'td', 'th'],
  },
];


export const DEPTH_LEVELS = 8;







export const DEPTH_HUES = [255, 75, 165, 345, 30, 210, 120, 300];


const DEPTH_LIGHTNESS = 0.62;
const DEPTH_CHROMA = 0.17;

export function depthColor(level: number): string {
  const hue = DEPTH_HUES[level] ?? DEPTH_HUES[0];
  return `oklch(${DEPTH_LIGHTNESS} ${DEPTH_CHROMA} ${hue})`;
}











export function depthSelector(level: number): string {
  const chain = `body${' > *'.repeat(level + 1)}`;
  return level === DEPTH_LEVELS - 1 ? `${chain}, ${chain} *` : chain;
}

function outlineRule(selector: string, color: string): string {
  return `${selector} { outline: 1px solid ${color} !important; outline-offset: -1px !important; }`;
}

function tagRules(): string[] {
  return TAG_GROUPS.map(group => outlineRule(group.tags.join(', '), group.color));
}

function depthRules(): string[] {
  return Array.from({ length: DEPTH_LEVELS }, (_unused, level) =>
    outlineRule(depthSelector(level), depthColor(level)),
  );
}


export function outlineCss(mode: 'tag' | 'depth'): string {
  const rules = mode === 'tag' ? tagRules() : depthRules();

  return [...rules, HOST_EXCLUSION_RULE].join('\n');
}





export function applyOutlines(mode: OutlineMode): OutlineMode {
  const existing = document.querySelector<HTMLStyleElement>(OUTLINE_STYLE_SELECTOR);
  if (mode === 'off') {
    existing?.remove();
    return 'off';
  }

  const parent = document.head ?? document.documentElement;
  if (!parent) return 'off';

  const style = existing ?? document.createElement('style');
  style.setAttribute(OUTLINE_STYLE_ATTRIBUTE, mode);
  const css = outlineCss(mode);
  if (style.textContent !== css) style.textContent = css;


  if (parent.lastElementChild !== style) parent.appendChild(style);
  return mode;
}


export function currentOutlineMode(): OutlineMode {
  const style = document.querySelector(OUTLINE_STYLE_SELECTOR);
  const value = style?.getAttribute(OUTLINE_STYLE_ATTRIBUTE);
  return value === 'tag' || value === 'depth' ? value : 'off';
}
