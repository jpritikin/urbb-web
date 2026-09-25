interface Cosigner {
    given: string;
    surname: string;
    credential: string;
    credentialNoteOverrides?: Record<string, string>;
    specialties: string[];
    location: string;
    practicingSince?: number;
    url: string;
    bio: string;
    lastChecked?: string;
}

type SortKey = 'name' | 'credential' | 'location' | 'years' | 'specialties';

function yearsPracticing(c: Cosigner): number | null {
    if (!c.practicingSince) return null;
    return new Date().getFullYear() - c.practicingSince;
}

function sortValue(c: Cosigner, key: SortKey): string | number {
    switch (key) {
        case 'name': return `${c.surname} ${c.given}`.toLowerCase();
        case 'credential': return c.credential.toLowerCase();
        case 'location': return c.location.toLowerCase();
        case 'years': return yearsPracticing(c) ?? -1;
        case 'specialties': return c.specialties.join(', ').toLowerCase();
    }
}

function renderCredential(c: Cosigner, glossary: Record<string, string>): string {
    return c.credential
        .split(', ')
        .map(acronym => {
            const note = c.credentialNoteOverrides?.[acronym] ?? glossary[acronym];
            return note
                ? `<span class="cosigner-tooltip-trigger" tabindex="0">${acronym}<span class="cosigner-tooltip">${note}</span></span>`
                : acronym;
        })
        .join(', ');
}

function renderRow(c: Cosigner, i: number, glossary: Record<string, string>): string {
    const years = yearsPracticing(c);
    return `
        <tr>
            <td><a href="${c.url}" target="_blank" rel="noopener">${c.given} ${c.surname}</a>${c.bio ? ` <button type="button" class="cosigner-bio-btn" data-cosigner-index="${i}" aria-expanded="false">bio ▾</button>` : ''}</td>
            <td>${renderCredential(c, glossary)}</td>
            <td>${c.location}</td>
            <td>${years !== null ? years : '?'}</td>
            <td>${c.specialties.join(', ') || '?'}</td>
        </tr>
        <tr class="cosigner-bio-row" data-cosigner-bio-row="${i}" hidden>
            <td colspan="5">${c.bio}</td>
        </tr>
    `;
}

function renderTable(cosigners: Cosigner[], glossary: Record<string, string>): string {
    return `
        <div class="cosigner-table-scroll">
            <table class="cosigner-table">
                <thead>
                    <tr>
                        <th data-sort-key="name" tabindex="0">Name</th>
                        <th data-sort-key="credential" tabindex="0">Credential</th>
                        <th data-sort-key="location" tabindex="0">Location</th>
                        <th data-sort-key="years" tabindex="0">Years practicing</th>
                        <th data-sort-key="specialties" tabindex="0">Specialties</th>
                    </tr>
                </thead>
                <tbody>${cosigners.map((c, i) => renderRow(c, i, glossary)).join('')}</tbody>
            </table>
        </div>
    `;
}

export async function fetchCosignerCount(): Promise<number> {
    const response = await fetch('/data/cosigners.json');
    const cosigners: Cosigner[] = await response.json();
    return cosigners.length;
}

export async function initCosigners(anchor: HTMLElement): Promise<void> {
    const [cosigners, glossary]: [Cosigner[], Record<string, string>] = await Promise.all([
        fetch('/data/cosigners.json').then(r => r.json()),
        fetch('/data/credential-glossary.json').then(r => r.json()),
    ]);
    if (cosigners.length === 0) return;

    let sortKey: SortKey = 'name';
    let sortAsc = true;
    let sorted = [...cosigners].sort((a, b) => a.surname.localeCompare(b.surname));

    function render(): void {
        anchor.innerHTML = renderTable(sorted, glossary);
        wireEvents();
    }

    function wireEvents(): void {
        anchor.querySelectorAll<HTMLElement>('th[data-sort-key]').forEach(th => {
            th.addEventListener('click', () => applySort(th.dataset.sortKey as SortKey));
            th.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    applySort(th.dataset.sortKey as SortKey);
                }
            });
        });

        anchor.querySelectorAll<HTMLButtonElement>('.cosigner-bio-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = btn.dataset.cosignerIndex;
                const bioRow = anchor.querySelector<HTMLElement>(`[data-cosigner-bio-row="${index}"]`);
                if (!bioRow) return;
                const expanded = btn.getAttribute('aria-expanded') === 'true';
                bioRow.hidden = expanded;
                btn.setAttribute('aria-expanded', String(!expanded));
                btn.textContent = expanded ? 'bio ▾' : 'bio ▴';
            });
        });
    }

    function applySort(key: SortKey): void {
        if (!key) return;
        sortAsc = key === sortKey ? !sortAsc : true;
        sortKey = key;
        sorted = [...sorted].sort((a, b) => {
            const av = sortValue(a, sortKey);
            const bv = sortValue(b, sortKey);
            const cmp = typeof av === 'number' && typeof bv === 'number'
                ? av - bv
                : String(av).localeCompare(String(bv));
            return sortAsc ? cmp : -cmp;
        });
        render();
    }

    render();
}
