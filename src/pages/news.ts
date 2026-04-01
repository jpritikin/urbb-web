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

  function clearHighlight() {
    document.querySelectorAll<HTMLElement>('.news-item').forEach(el => {
      el.classList.remove('highlighted', 'highlight-adjacent');
    });
    history.replaceState(null, '', location.pathname + location.search);
  }

  function highlightItem(id: string, scrollBehavior: ScrollBehavior = 'smooth') {
    document.querySelectorAll<HTMLElement>('.news-item').forEach(el => {
      el.classList.remove('highlighted', 'highlight-adjacent');
    });
    const target = document.getElementById(id);
    if (!target) return;
    const isFuture = target.classList.contains('future');
    if (isFuture) {
      showFuture = true;
      futureToggle.textContent = '🙈 Seal the Veil';
    }
    applyFilter(null, showFuture);
    render();
    target.classList.add('highlighted');
    const prev = target.previousElementSibling as HTMLElement | null;
    const next = target.nextElementSibling as HTMLElement | null;
    if (prev?.classList.contains('news-item')) prev.classList.add('highlight-adjacent');
    if (next?.classList.contains('news-item')) next.classList.add('highlight-adjacent');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const navHeight = (document.querySelector('nav') as HTMLElement | null)?.offsetHeight ?? 0;
      const rect = target.getBoundingClientRect();
      const top = rect.top + window.scrollY - navHeight - 24;
      console.log('[news] highlightItem scroll:', { id, rectTop: rect.top, scrollY: window.scrollY, navHeight, top });
      window.scrollTo({ top, behavior: scrollBehavior });
    }));
  }

  function navigateTo(id: string) {
    history.pushState(null, '', '#' + id);
    highlightItem(id);
  }

  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (id) highlightItem(id);
    else clearHighlight();
  });

  document.querySelectorAll<HTMLAnchorElement>('.news-permalink').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const id = link.getAttribute('href')?.slice(1);
      if (!id) return;
      const item = document.getElementById(id);
      if (item?.classList.contains('highlighted')) {
        clearHighlight();
      } else {
        navigateTo(id);
      }
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.querySelector('.news-item.highlighted')) {
      clearHighlight();
    }
  });

  const hash = location.hash.slice(1);
  if (hash) {
    highlightItem(hash, 'instant');
    return;
  }

  applyFilter(null, showFuture);
  render();
}

document.addEventListener('DOMContentLoaded', init);
