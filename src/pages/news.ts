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

function init() {
  let showFuture = false;
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
  futureToggle.addEventListener('click', () => {
    showFuture = !showFuture;
    futureToggle.textContent = showFuture ? '🙈 Seal the Veil' : '🔮 Pierce the Veil of Time';
    applyFilter(activeDate, showFuture);
    render();
  });

  document.querySelectorAll<HTMLElement>('.news-item').forEach(item => {
    const dateStr = item.dataset.date;
    if (dateStr) {
      item.querySelector('.news-date')?.addEventListener('click', () => selectDate(dateStr));
    }
  });

  applyFilter(null, showFuture);
  render();
}

document.addEventListener('DOMContentLoaded', init);
