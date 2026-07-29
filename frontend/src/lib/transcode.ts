/**
 * Percentage complete for a transcode run, safe to drop straight into a CSS
 * width.
 *
 * The guards are not theoretical. `total` is 0 before a run starts, and a bare
 * division would yield NaN -- `width: NaN%` is an invalid declaration that
 * browsers discard, leaving a bar stuck at full width. Clamping matters too:
 * the run state is polled, so a stale snapshot can briefly report more
 * processed than total.
 */
export function transcodeProgressPercent(processed: number, total: number): number {
  if (!Number.isFinite(processed) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((processed / total) * 100)));
}
