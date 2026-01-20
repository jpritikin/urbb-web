#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const WIDTH_INCHES = 7;
const HEIGHT_INCHES = 5;
const DPI = 96;
const WIDTH = WIDTH_INCHES * DPI;
const HEIGHT = HEIGHT_INCHES * DPI;

function generateCertificate(name = 'Your Name Here', outputPath = null) {
  const gold = '#C9A227';
  const goldLight = '#E8D48A';
  const goldDark = '#8B6914';
  const cream = '#FFF8E7';
  const darkGreen = '#1A3A2F';
  const forestGreen = '#2D5A47';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${WIDTH_INCHES}in" height="${HEIGHT_INCHES}in"
     viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${goldLight}"/>
      <stop offset="50%" style="stop-color:${gold}"/>
      <stop offset="100%" style="stop-color:${goldDark}"/>
    </linearGradient>

    <linearGradient id="borderGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${goldDark}"/>
      <stop offset="25%" style="stop-color:${goldLight}"/>
      <stop offset="50%" style="stop-color:${gold}"/>
      <stop offset="75%" style="stop-color:${goldLight}"/>
      <stop offset="100%" style="stop-color:${goldDark}"/>
    </linearGradient>

    <pattern id="cornerOrnament" width="40" height="40" patternUnits="userSpaceOnUse">
      <circle cx="20" cy="20" r="3" fill="${gold}" opacity="0.6"/>
      <path d="M10,20 Q20,10 30,20 Q20,30 10,20" fill="none" stroke="${gold}" stroke-width="0.5" opacity="0.4"/>
    </pattern>

    <filter id="emboss">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1" result="blur"/>
      <feOffset in="blur" dx="1" dy="1" result="offsetBlur"/>
      <feComposite in="SourceGraphic" in2="offsetBlur" operator="over"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="100%" height="100%" fill="${cream}"/>

  <!-- Subtle texture pattern -->
  <rect width="100%" height="100%" fill="url(#cornerOrnament)" opacity="0.15"/>

  <!-- Outer decorative border -->
  <rect x="12" y="12" width="${WIDTH - 24}" height="${HEIGHT - 24}"
        fill="none" stroke="url(#borderGradient)" stroke-width="4" rx="8"/>

  <!-- Inner decorative border -->
  <rect x="24" y="24" width="${WIDTH - 48}" height="${HEIGHT - 48}"
        fill="none" stroke="${gold}" stroke-width="1.5" rx="4"/>

  <!-- Double line inner border -->
  <rect x="32" y="32" width="${WIDTH - 64}" height="${HEIGHT - 64}"
        fill="none" stroke="${gold}" stroke-width="0.5" rx="2" opacity="0.6"/>

  <!-- Corner flourishes -->
  ${generateCornerFlourish(40, 40, 1, 1, gold)}
  ${generateCornerFlourish(WIDTH - 40, 40, -1, 1, gold)}
  ${generateCornerFlourish(40, HEIGHT - 40, 1, -1, gold)}
  ${generateCornerFlourish(WIDTH - 40, HEIGHT - 40, -1, -1, gold)}

  <!-- Header ornament -->
  <path d="M${WIDTH/2 - 80},70 Q${WIDTH/2 - 40},55 ${WIDTH/2},60 Q${WIDTH/2 + 40},55 ${WIDTH/2 + 80},70"
        fill="none" stroke="url(#goldGradient)" stroke-width="2"/>
  <circle cx="${WIDTH/2}" cy="58" r="4" fill="${gold}"/>
  <circle cx="${WIDTH/2 - 60}" cy="65" r="2" fill="${gold}"/>
  <circle cx="${WIDTH/2 + 60}" cy="65" r="2" fill="${gold}"/>

  <!-- Main title -->
  <text x="${WIDTH/2}" y="105"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="28" font-weight="bold"
        fill="${darkGreen}" text-anchor="middle"
        letter-spacing="4" filter="url(#emboss)">
    CERTIFICATE
  </text>

  <text x="${WIDTH/2}" y="130"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="14" font-style="italic"
        fill="${forestGreen}" text-anchor="middle" letter-spacing="2">
    of Lifetime Membership
  </text>

  <!-- Decorative line under title -->
  <line x1="${WIDTH/2 - 120}" y1="145" x2="${WIDTH/2 + 120}" y2="145"
        stroke="url(#goldGradient)" stroke-width="1.5"/>
  <circle cx="${WIDTH/2}" cy="145" r="3" fill="${gold}"/>

  <!-- Presented to text -->
  <text x="${WIDTH/2}" y="175"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="11" fill="${forestGreen}" text-anchor="middle">
    This certifies that
  </text>

  <!-- Name field -->
  <text x="${WIDTH/2}" y="210"
        font-family="'Brush Script MT', 'Segoe Script', cursive"
        font-size="32" fill="${darkGreen}" text-anchor="middle">
    ${escapeXml(name)}
  </text>

  <!-- Line under name -->
  <line x1="${WIDTH/2 - 140}" y1="220" x2="${WIDTH/2 + 140}" y2="220"
        stroke="${gold}" stroke-width="1" opacity="0.7"/>

  <!-- Body text -->
  <text x="${WIDTH/2}" y="252"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="11" fill="${forestGreen}" text-anchor="middle">
    is hereby recognized as a Lifetime Member of
  </text>

  <!-- Organization name -->
  <text x="${WIDTH/2}" y="280"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="18" font-weight="bold"
        fill="${darkGreen}" text-anchor="middle" letter-spacing="2">
    The Way of Open Inquiry
  </text>

  <!-- Subtitle / description -->
  <text x="${WIDTH/2}" y="305"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="10" font-style="italic"
        fill="${forestGreen}" text-anchor="middle">
    demonstrating unwavering commitment to consciousness exploration
  </text>
  <text x="${WIDTH/2}" y="320"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="10" font-style="italic"
        fill="${forestGreen}" text-anchor="middle">
    and the pursuit of experiential wisdom
  </text>

  <!-- 3D Five-pointed star with question mark -->
  ${generate3DStar(WIDTH/2, 390, gold, goldLight, goldDark, darkGreen)}
</svg>`;

  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, svg);
    console.log(`Certificate generated: ${outputPath}`);
  }

  return svg;
}

function generate3DStar(cx, cy, gold, goldLight, goldDark, darkGreen) {
  const outerRadius = 55;
  const innerRadius = 19;
  const depth = 8;
  const yScale = 0.5;

  const outerPoints = [];
  const innerPoints = [];
  for (let i = 0; i < 5; i++) {
    const outerAngle = (i * 72 - 90) * Math.PI / 180;
    const innerAngle = ((i * 72) + 36 - 90) * Math.PI / 180;
    outerPoints.push({
      x: Math.cos(outerAngle) * outerRadius,
      y: Math.sin(outerAngle) * outerRadius * yScale
    });
    innerPoints.push({
      x: Math.cos(innerAngle) * innerRadius,
      y: Math.sin(innerAngle) * innerRadius * yScale
    });
  }

  const panels = [];
  const panelColors = ['#A08020', '#B89830', '#907018', '#C8A838', '#987820'];
  const backPanelColors = ['#706010', '#806818', '#605008', '#907020', '#685010'];

  for (let i = 0; i < 5; i++) {
    const outer = outerPoints[i];
    const inner = innerPoints[i];
    const nextOuter = outerPoints[(i + 1) % 5];

    panels.push({
      frontPath: `M${cx + outer.x},${cy + outer.y} L${cx + inner.x},${cy + inner.y} L${cx + inner.x},${cy + inner.y - depth} L${cx + outer.x},${cy + outer.y - depth} Z`,
      color: panelColors[i],
      zIndex: outer.y + inner.y
    });

    panels.push({
      frontPath: `M${cx + inner.x},${cy + inner.y} L${cx + nextOuter.x},${cy + nextOuter.y} L${cx + nextOuter.x},${cy + nextOuter.y - depth} L${cx + inner.x},${cy + inner.y - depth} Z`,
      color: backPanelColors[i],
      zIndex: inner.y + nextOuter.y
    });
  }

  panels.sort((a, b) => a.zIndex - b.zIndex);

  let starPath = `M${cx + outerPoints[0].x},${cy + outerPoints[0].y - depth}`;
  for (let i = 0; i < 5; i++) {
    starPath += ` L${cx + innerPoints[i].x},${cy + innerPoints[i].y - depth}`;
    starPath += ` L${cx + outerPoints[(i + 1) % 5].x},${cy + outerPoints[(i + 1) % 5].y - depth}`;
  }
  starPath += ' Z';

  const panelsSvg = panels.map(p =>
    `<path d="${p.frontPath}" fill="${p.color}" stroke="${goldDark}" stroke-width="0.5"/>`
  ).join('\n    ');

  return `
  <g>
    <!-- 3D side panels -->
    ${panelsSvg}

    <!-- Front star face -->
    <path d="${starPath}" fill="${goldLight}" stroke="${gold}" stroke-width="1"/>

    <!-- Question mark (text) -->
    <text x="${cx}" y="${cy - depth}"
          font-family="Georgia, serif" font-size="36" font-weight="bold"
          fill="${darkGreen}" text-anchor="middle">?</text>

    <!-- Orbiting curves -->
    ${generateOrbitingCurves(cx, cy - depth + 5, gold)}
  </g>

  <!-- Scattered question marks on left and right -->
  ${generateScatteredQuestionMarks(cx, gold, goldDark)}`;
}

function generateOrbitingCurves(cx, cy, gold, seed = 42) {
  const curves = [];
  const yScale = 0.4;

  function seededRandom() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }

  function gaussian() {
    const u1 = seededRandom();
    const u2 = seededRandom();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  for (let i = 0; i < 100; i++) {
    const baseRadius = 75 + Math.abs(gaussian()) * 25;
    const angleStart = seededRandom() * 360;
    const arcLength = 60 + seededRandom() * 120 + Math.abs(gaussian()) * 40;

    const startRadius = baseRadius * (1 + gaussian() * 0.04);
    const endRadius = baseRadius * (1 + gaussian() * 0.04);

    const opacity = 0.5 + seededRandom() * 0.12;

    const startAngle = angleStart * Math.PI / 180;
    const endAngle = (angleStart + arcLength) * Math.PI / 180;

    const x1 = cx + Math.cos(startAngle) * startRadius;
    const y1 = cy + Math.sin(startAngle) * startRadius * yScale;
    const x2 = cx + Math.cos(endAngle) * endRadius;
    const y2 = cy + Math.sin(endAngle) * endRadius * yScale;

    // Cubic bezier approximation for ellipse arc
    // kappa factor for arc approximation: 4/3 * tan(theta/4)
    const theta = endAngle - startAngle;
    const kappa = (4 / 3) * Math.tan(theta / 4);

    // Tangent directions at start and end (perpendicular to radius)
    const tx1 = -Math.sin(startAngle);
    const ty1 = Math.cos(startAngle) * yScale;
    const tx2 = -Math.sin(endAngle);
    const ty2 = Math.cos(endAngle) * yScale;

    // Control points along tangent, scaled by kappa * radius
    const cp1x = x1 + tx1 * startRadius * kappa;
    const cp1y = y1 + ty1 * startRadius * kappa;
    const cp2x = x2 - tx2 * endRadius * kappa;
    const cp2y = y2 - ty2 * endRadius * kappa;

    curves.push(`<path d="M${x1.toFixed(1)},${y1.toFixed(1)} C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}"
          fill="none" stroke="${gold}" stroke-width="0.3" opacity="${opacity.toFixed(2)}"/>`);
  }

  return curves.join('\n    ');
}

function generateScatteredQuestionMarks(cx, gold, goldDark) {
  const marks = [];
  const positions = [
    { x: 80, y: 360, size: 14, opacity: 0.25 },
    { x: 120, y: 400, size: 10, opacity: 0.18 },
    { x: 60, y: 420, size: 12, opacity: 0.22 },
    { x: 140, y: 380, size: 8, opacity: 0.15 },
    { x: 95, y: 440, size: 11, opacity: 0.2 },
    { x: 672 - 80, y: 365, size: 13, opacity: 0.23 },
    { x: 672 - 125, y: 405, size: 9, opacity: 0.17 },
    { x: 672 - 55, y: 425, size: 11, opacity: 0.2 },
    { x: 672 - 145, y: 385, size: 10, opacity: 0.16 },
    { x: 672 - 100, y: 435, size: 12, opacity: 0.21 },
  ];

  for (const pos of positions) {
    const color = pos.opacity > 0.2 ? gold : goldDark;
    marks.push(`<text x="${pos.x}" y="${pos.y}"
        font-family="Georgia, serif" font-size="${pos.size}"
        fill="${color}" opacity="${0.5+pos.opacity}" text-anchor="middle">?</text>`);
  }

  return marks.join('\n  ');
}

function generateCornerFlourish(x, y, scaleX, scaleY, color) {
  return `
  <g transform="translate(${x}, ${y}) scale(${scaleX}, ${scaleY})">
    <path d="M0,0 Q15,-5 20,-15 M0,0 Q-5,15 -15,20"
          fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="0" cy="0" r="3" fill="${color}"/>
    <path d="M5,5 Q10,2 12,-2" fill="none" stroke="${color}" stroke-width="0.8" opacity="0.6"/>
    <path d="M-2,12 Q2,10 5,5" fill="none" stroke="${color}" stroke-width="0.8" opacity="0.6"/>
  </g>`;
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const name = args[0] || 'Your Name Here';
  const outputPath = args[1] || path.join(__dirname, 'certificate-template.svg');

  generateCertificate(name, outputPath);
}

module.exports = { generateCertificate };
