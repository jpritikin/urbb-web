const DESKTOP_REFERENCE_WIDTH_PX = 1024;
const MIN_VIEWPORT_SCALE = 0.5;

export function viewportScale(widthPx: number): number {
    return Math.min(1, Math.max(MIN_VIEWPORT_SCALE, widthPx / DESKTOP_REFERENCE_WIDTH_PX));
}
