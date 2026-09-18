// Theme application for the popup and the side panel (PRD 6.2).
//
// `system` removes the attribute so the prefers-color-scheme rules in
// assets/ui.css take over. Everything else pins data-theme.
import type { ThemePreference } from '@/lib/contracts';

export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
