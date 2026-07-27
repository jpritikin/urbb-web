// A simple feathered wing silhouette: a handful of stacked curved feather
// shapes fanning out from a shared root, rendered full-height beside the
// popup image. The right wing is the left wing mirrored via CSS transform.
const FEATHER_ROWS = 6;

function buildFeatherPath(index: number, total: number): string {
  const t = index / (total - 1); // 0 (top/short) -> 1 (bottom/long)
  const rootY = 20 + t * 160;
  const length = 40 + t * 55;
  const droop = 10 + t * 30;
  const width = 14 + t * 10;

  const tipX = length;
  const tipY = rootY + droop;
  const cx1 = length * 0.35;
  const cy1 = rootY - width * 0.2;
  const cx2 = length * 0.75;
  const cy2 = tipY - width * 0.5;

  const cx3 = length * 0.7;
  const cy3 = tipY + width * 0.3;
  const cx4 = length * 0.25;
  const cy4 = rootY + width * 0.5;

  return `M 0 ${rootY} ` +
    `C ${cx1} ${cy1}, ${cx2} ${cy2}, ${tipX} ${tipY} ` +
    `C ${cx3} ${cy3}, ${cx4} ${cy4}, 0 ${rootY} Z`;
}

export function buildAngelWingSvg(): string {
  const feathers: string[] = [];
  for (let i = 0; i < FEATHER_ROWS; i++) {
    const path = buildFeatherPath(i, FEATHER_ROWS);
    const opacity = (0.55 + (i / FEATHER_ROWS) * 0.4).toFixed(2);
    feathers.push(
      `<path d="${path}" fill="url(#angel-wing-gradient)" fill-opacity="${opacity}" stroke="rgba(255,255,255,0.6)" stroke-width="1"/>`
    );
  }

  return `
    <svg class="angel-wing-svg" viewBox="0 0 100 220" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="angel-wing-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#fffdf5"/>
          <stop offset="55%" stop-color="#ffe9a8"/>
          <stop offset="100%" stop-color="#d4af37"/>
        </linearGradient>
      </defs>
      ${feathers.join('\n')}
    </svg>
  `;
}
