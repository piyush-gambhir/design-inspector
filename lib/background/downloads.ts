

import type { BackgroundResponse } from '@/lib/messages';

const MAX_FILENAME_LENGTH = 120;
const FALLBACK_FILENAME = 'design-inspector-download';






export function sanitizeFilename(raw: string): string {
  const lastSegment = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  let cleaned = '';
  for (const char of lastSegment) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    cleaned += '<>:"|?*'.includes(char) ? '-' : char;
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim().replace(/^\.+/, '').trim();
  if (!cleaned) return FALLBACK_FILENAME;
  if (cleaned.length <= MAX_FILENAME_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= 12 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, MAX_FILENAME_LENGTH - extension.length) + extension;
}

export async function startDownload(url: string, filename: string): Promise<BackgroundResponse> {
  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: sanitizeFilename(filename),
      saveAs: false,
      conflictAction: 'uniquify',
    });
    if (typeof downloadId !== 'number') {
      return { ok: false, error: 'The download did not start. Copy the URL and open it directly.' };
    }
    return { ok: true, downloadId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The download could not be started.',
    };
  }
}
