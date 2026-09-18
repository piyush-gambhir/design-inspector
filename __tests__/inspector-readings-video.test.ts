import { describe, expect, it } from 'vitest';

import { readAssets } from '../lib/inspector/readings';

const style = { backgroundImage: 'none' } as unknown as CSSStyleDeclaration;

describe('readAssets for video', () => {
  it('reports a directly addressable video file with a downloadable url', () => {
    document.body.innerHTML =
      '<video id="v" poster="https://cdn.example.com/poster.jpg"><source src="https://cdn.example.com/clip.mp4" type="video/mp4"></video>';
    const video = document.getElementById('v') as Element;
    const assets = readAssets(video, style, { deep: true });
    const clip = assets.find((asset) => asset.kind === 'video');
    expect(clip?.url).toBe('https://cdn.example.com/clip.mp4');
    expect(assets.some((asset) => asset.kind === 'img' && asset.url?.endsWith('poster.jpg'))).toBe(true);
  });

  it('reports a streamed source as not downloadable instead of inventing a file', () => {
    document.body.innerHTML = '<video id="v" src="blob:https://example.com/abc"></video>';
    const video = document.getElementById('v') as Element;
    const assets = readAssets(video, style, { deep: true });
    const clip = assets.find((asset) => asset.kind === 'video');
    expect(clip).toBeTruthy();
    expect(clip?.url).toBeNull();
    expect(clip?.limitations.join(' ')).toMatch(/stream/i);
  });
});
