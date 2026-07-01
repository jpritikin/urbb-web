export {};

const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function newsDateSet(includeFuture: boolean): Set<string> {
  const dates = new Set<string>();
  document.querySelectorAll<HTMLElement>('.news-item').forEach(el => {
    if (!includeFuture && el.classList.contains('future')) return;
    const d = el.dataset.date;
    if (d) dates.add(d);
  });
  return dates;
}

function renderCalendar(
  year: number, month: number,
  activeDate: string | null,
  hasDates: Set<string>,
  onDayClick: (dateStr: string) => void
) {
  const label = document.getElementById('cal-month-label')!;
  const grid = document.getElementById('cal-grid')!;
  const reset = document.getElementById('cal-reset')!;

  label.textContent = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' });
  reset.style.display = activeDate ? 'block' : 'none';

  grid.innerHTML = '';
  DAY_NAMES.forEach(n => {
    const cell = document.createElement('div');
    cell.className = 'cal-day-name';
    cell.textContent = n;
    grid.appendChild(cell);
  });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    grid.appendChild(document.createElement('div'));
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = isoDate(new Date(year, month, day));
    const cell = document.createElement('div');
    cell.className = 'cal-cell';

    const span = document.createElement('span');
    span.textContent = String(day);
    cell.appendChild(span);

    if (hasDates.has(dateStr)) {
      cell.classList.add('has-news');
      const dot = document.createElement('div');
      dot.className = 'cal-dot';
      cell.appendChild(dot);
      cell.addEventListener('click', () => onDayClick(dateStr));
    }

    if (dateStr === activeDate) {
      cell.classList.add('active');
    }

    grid.appendChild(cell);
  }
}

const PREVIEW_LENGTH = 200;

function buildPreview(item: HTMLElement): void {
  const preview = item.querySelector<HTMLElement>('.news-preview');
  const body = item.querySelector<HTMLElement>('.news-body');
  if (!preview || !body) return;

  const firstPara = body.querySelector('p');
  const rawText = firstPara ? firstPara.textContent ?? '' : body.textContent ?? '';
  const trimmed = rawText.trim();
  const needsTruncation = trimmed.length > PREVIEW_LENGTH;
  const previewText = needsTruncation ? trimmed.slice(0, PREVIEW_LENGTH).replace(/\s+\S*$/, '') + '…' : trimmed;

  preview.innerHTML = `<span class="preview-text">${previewText}</span>`
    + (needsTruncation ? ' <span class="read-more">Read more ▾</span>' : '');
}

function applyFilter(dateStr: string | null, showFuture: boolean) {
  const items = document.querySelectorAll<HTMLElement>('.news-item');
  const empty = document.getElementById('news-empty')!;
  let anyVisible = false;

  items.forEach(item => {
    const isFuture = item.classList.contains('future');
    if (isFuture) {
      item.classList.toggle('future-visible', showFuture);
    }
    const dateMatch = dateStr === null || item.dataset.date === dateStr;
    const visible = dateMatch && (!isFuture || showFuture);
    item.classList.toggle('hidden', !visible);
    if (visible) anyVisible = true;
  });

  empty.style.display = anyVisible ? 'none' : 'block';
}

const FUTURE_TOGGLE_ON = '🙈 Hide What\'s Coming';
const FUTURE_TOGGLE_OFF = '🎉 What\'s Coming Up?';

function init() {
  let showFuture = true;
  let activeDate: string | null = null;

  let viewYear: number;
  let viewMonth: number;

  const mostRecentPast = Array.from(document.querySelectorAll<HTMLElement>('.news-item'))
    .find(el => !el.classList.contains('future'));
  if (mostRecentPast?.dataset.date) {
    const d = parseLocalDate(mostRecentPast.dataset.date);
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
  } else {
    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
  }

  const render = () => renderCalendar(viewYear, viewMonth, activeDate, newsDateSet(showFuture), selectDate);

  function selectDate(dateStr: string) {
    activeDate = dateStr;
    const d = parseLocalDate(dateStr);
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
    applyFilter(activeDate, showFuture);
    render();
  }

  document.getElementById('cal-prev')!.addEventListener('click', () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    render();
  });

  document.getElementById('cal-next')!.addEventListener('click', () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    render();
  });

  document.getElementById('cal-reset')!.addEventListener('click', () => {
    activeDate = null;
    applyFilter(null, showFuture);
    render();
  });

  const futureToggle = document.getElementById('future-toggle')!;
  futureToggle.textContent = FUTURE_TOGGLE_ON;
  futureToggle.addEventListener('click', () => {
    showFuture = !showFuture;
    futureToggle.textContent = showFuture ? FUTURE_TOGGLE_ON : FUTURE_TOGGLE_OFF;
    applyFilter(activeDate, showFuture);
    render();
  });

  document.querySelectorAll<HTMLElement>('.news-item').forEach(item => {
    buildPreview(item);
    const dateStr = item.dataset.date;
    if (dateStr) {
      item.querySelector('.news-date')?.addEventListener('click', () => selectDate(dateStr));
    }
  });

  function collapseItem(item: HTMLElement) {
    item.classList.remove('expanded', 'highlighted', 'highlight-adjacent');
    const next = item.nextElementSibling as HTMLElement | null;
    const prev = item.previousElementSibling as HTMLElement | null;
    if (next?.classList.contains('news-item')) next.classList.remove('highlight-adjacent');
    if (prev?.classList.contains('news-item')) prev.classList.remove('highlight-adjacent');
  }

  function collapseAll() {
    document.querySelectorAll<HTMLElement>('.news-item').forEach(el => collapseItem(el));
    history.replaceState(null, '', location.pathname + location.search);
  }

  function expandItem(id: string, scrollBehavior: ScrollBehavior = 'smooth') {
    document.querySelectorAll<HTMLElement>('.news-item').forEach(el => collapseItem(el));
    const target = document.getElementById(id);
    if (!target) return;
    const isFuture = target.classList.contains('future');
    if (isFuture) {
      showFuture = true;
      futureToggle.textContent = FUTURE_TOGGLE_ON;
    }
    applyFilter(null, showFuture);
    render();
    target.classList.add('expanded', 'highlighted');
    const prev = target.previousElementSibling as HTMLElement | null;
    const next = target.nextElementSibling as HTMLElement | null;
    if (prev?.classList.contains('news-item')) prev.classList.add('highlight-adjacent');
    if (next?.classList.contains('news-item')) next.classList.add('highlight-adjacent');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const navHeight = (document.querySelector('nav') as HTMLElement | null)?.offsetHeight ?? 0;
      const rect = target.getBoundingClientRect();
      const top = rect.top + window.scrollY - navHeight - 24;
      window.scrollTo({ top, behavior: scrollBehavior });
    }));
  }

  function navigateTo(id: string) {
    history.pushState(null, '', '#' + id);
    expandItem(id);
  }

  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (id) expandItem(id);
    else collapseAll();
  });

  document.querySelectorAll<HTMLElement>('.news-title').forEach(titleEl => {
    titleEl.style.cursor = 'pointer';
    titleEl.addEventListener('click', e => {
      const link = (e.target as HTMLElement).closest('.news-permalink');
      if (link) e.preventDefault();
      const item = titleEl.closest<HTMLElement>('.news-item');
      if (!item) return;
      if (item.classList.contains('expanded')) {
        collapseAll();
      } else {
        navigateTo(item.id);
      }
    });
  });

  document.querySelectorAll<HTMLElement>('.news-preview').forEach(previewEl => {
    previewEl.addEventListener('click', () => {
      const item = previewEl.closest<HTMLElement>('.news-item');
      if (!item) return;
      navigateTo(item.id);
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.querySelector('.news-item.expanded')) {
      collapseAll();
    }
  });

  const hash = location.hash.slice(1);
  if (hash) {
    expandItem(hash, 'instant');
    return;
  }

  applyFilter(null, showFuture);
  render();
}

document.addEventListener('DOMContentLoaded', init);

// ── Teaser: pie chart + dial controls + listbox + enter button ────────────

interface InterviewEntry {
  id: string;
  show: string;
  speakerWords: Record<string, number>;
}

declare const INTERVIEW_DATA: InterviewEntry[] | undefined;

function speakerKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const val = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(val * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

const speakerColorCache = new Map<string, { bg: string; fg: string }>();
let speakerColorIndex = 0;

function speakerColor(key: string): { bg: string; fg: string } {
  if (!speakerColorCache.has(key)) {
    // Golden angle spacing for maximum hue separation; S=0.7, V=0.55 for bg, V=0.92 for fg
    const hue = (speakerColorIndex * 137.508) % 360;
    speakerColorIndex++;
    speakerColorCache.set(key, {
      bg: hsvToHex(hue, 0.70, 0.55),
      fg: hsvToHex(hue, 0.30, 0.92),
    });
  }
  return speakerColorCache.get(key)!;
}

// Map value in [min,max] to dial pointer rotation [-135deg, +135deg]
function valToAngle(val: number, min: number, max: number): number {
  return -135 + ((val - min) / (max - min)) * 270;
}

interface PieParams { holeFrac: number; sinAmp: number; }

const SIN_WAVE_FREQ = 8;
const SIN_SEGMENTS = 180;

function drawPie(canvas: HTMLCanvasElement, interview: InterviewEntry, params: PieParams): void {
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.getBoundingClientRect().width || canvas.width;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  const cx = size / 2, cy = size / 2;
  const maxSinMag = (size / 2) * 0.20;
  const baseOuterR = size / 2 - 2 - maxSinMag;
  const innerR = baseOuterR * params.holeFrac;
  const sinMag = baseOuterR * params.sinAmp;

  ctx.clearRect(0, 0, size, size);

  const entries = Object.entries(interview.speakerWords);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return;

  let angle = -Math.PI / 2;
  for (const [speaker, words] of entries) {
    const slice = (words / total) * 2 * Math.PI;
    const key = speakerKey(speaker);
    const color = speakerColor(key).bg;

    const steps = Math.max(4, Math.ceil(SIN_SEGMENTS * slice / (2 * Math.PI)));
    ctx.beginPath();
    // outer edge with sin wave
    for (let i = 0; i <= steps; i++) {
      const a = angle + (i / steps) * slice;
      const r = baseOuterR + sinMag * Math.sin(SIN_WAVE_FREQ * a);
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    // inner edge (straight arc, reversed)
    for (let i = steps; i >= 0; i--) {
      const a = angle + (i / steps) * slice;
      ctx.lineTo(cx + innerR * Math.cos(a), cy + innerR * Math.sin(a));
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    angle += slice;
  }
}

function renderPieLegend(container: HTMLElement, interview: InterviewEntry): void {
  container.innerHTML = '';
  const total = Object.values(interview.speakerWords).reduce((s, v) => s + v, 0);
  for (const [speaker, words] of Object.entries(interview.speakerWords)) {
    const pct = total ? (words / total * 100) : 0;
    const key = speakerKey(speaker);
    const colors = speakerColor(key);
    const row = document.createElement('div');
    row.className = 'pie-legend-row';
    row.innerHTML = `<span class="pie-legend-swatch" style="background:${colors.bg}"></span>`
      + `<span>${speaker}</span><span class="pie-legend-pct">${pct.toFixed(0)}%</span>`;
    container.appendChild(row);
  }
}

function initTeaser(): void {
  const enterBtn = document.getElementById('teaser-enter-btn');
  if (enterBtn) {
    enterBtn.addEventListener('click', () => { window.location.href = '/news/analysis/'; });
  }

  const interviews: InterviewEntry[] = typeof INTERVIEW_DATA !== 'undefined' ? INTERVIEW_DATA : [];
  if (!interviews.length) return;

  const canvas = document.getElementById('teaser-pie') as HTMLCanvasElement | null;
  const legend = document.getElementById('teaser-pie-legend');
  if (!canvas || !legend) return;

  let activeIdx = 0;
  const pieParams: PieParams = { holeFrac: 0.2, sinAmp: 0.05 };

  function redraw(): void {
    drawPie(canvas!, interviews[activeIdx], pieParams);
  }

  function showInterview(idx: number): void {
    activeIdx = idx;
    redraw();
    renderPieLegend(legend!, interviews[idx]);
    document.querySelectorAll<HTMLElement>('.teaser-listbox-item').forEach((item, i) => {
      item.classList.toggle('active', i === idx);
    });
  }

  document.querySelectorAll<HTMLElement>('.teaser-listbox-item').forEach((item, i) => {
    item.addEventListener('click', () => showInterview(i));
  });

  // Dial definitions for pie style
  interface PieDialConfig {
    min: number; max: number; defaultVal: number; step: number;
    format: (v: number) => string;
    apply: (v: number) => void;
  }
  const dialConfigs: Record<string, PieDialConfig> = {
    hole: {
      min: 0, max: 48, defaultVal: 20, step: 1,
      format: v => `${v}%`,
      apply: v => { pieParams.holeFrac = v / 100; redraw(); },
    },
    glow: {
      min: 0, max: 20, defaultVal: 5, step: 1,
      format: v => `${v}%`,
      apply: v => { pieParams.sinAmp = v / 100; redraw(); },
    },
  };

  document.querySelectorAll<HTMLElement>('.sc-dial').forEach(dial => {
    const name = dial.dataset.dial ?? '';
    const cfg = dialConfigs[name];
    if (!cfg) return;

    const stored = localStorage.getItem(`sc-pie-dial-${name}`);
    let currentVal = stored !== null ? parseFloat(stored) : cfg.defaultVal;

    function applyVal(v: number): void {
      currentVal = Math.max(cfg.min, Math.min(cfg.max, v));
      const valEl = document.getElementById(`dial-${name}-val`);
      if (valEl) valEl.textContent = cfg.format(currentVal);
      const ptr = document.getElementById(`dial-${name}-ptr`);
      if (ptr) ptr.style.transform = `translateX(-50%) rotate(${valToAngle(currentVal, cfg.min, cfg.max)}deg)`;
      cfg.apply(currentVal);
      localStorage.setItem(`sc-pie-dial-${name}`, String(currentVal));
    }

    applyVal(currentVal);

    let startY = 0, startVal = currentVal, dragging = false;
    dial.addEventListener('pointerdown', e => {
      e.preventDefault();
      dragging = true; startY = e.clientY; startVal = currentVal;
      dial.setPointerCapture(e.pointerId);
    });
    dial.addEventListener('pointermove', e => {
      if (!dragging) return;
      const delta = startY - e.clientY;
      const raw = startVal + (delta / 80) * (cfg.max - cfg.min);
      applyVal(Math.round(raw / cfg.step) * cfg.step);
    });
    dial.addEventListener('pointerup', () => { dragging = false; });
    dial.addEventListener('pointercancel', () => { dragging = false; });
    dial.addEventListener('wheel', e => {
      e.preventDefault();
      applyVal(currentVal + (e.deltaY < 0 ? cfg.step : -cfg.step));
    }, { passive: false });
  });

  showInterview(0);
}

document.addEventListener('DOMContentLoaded', initTeaser);
