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

/** "1126 x 853 at 2x". The unit is CSS px everywhere in this product. */
export function formatViewport(viewport: {
  width: number;
  height: number;
  devicePixelRatio: number;
}): string {
  const ratio = String(Number(viewport.devicePixelRatio.toFixed(2)));
  return `${viewport.width} x ${viewport.height} at ${ratio}x`;
}
