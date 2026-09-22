interface Scholar {
    given: string;
    surname: string;
    credential: string;
    url?: string;
    scholarUrl?: string;
    statement?: string;
}

function renderScholarMarkdown(credential: string): string {
    return credential.replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function renderScholars(scholars: Scholar[]): string {
    return scholars.map((s, i) => `
        <li>
            <span class="scholar-name">${s.surname}, ${s.given}</span>${s.url ? ` — <a href="${s.url}" target="_blank" rel="noopener">review</a>` : ''}${s.statement ? ` — <button type="button" class="scholar-statement-btn" data-scholar-index="${i}">statement</button>` : ''}${s.scholarUrl ? ` <a href="${s.scholarUrl}" target="_blank" rel="noopener" title="Google Scholar profile">🎓</a>` : ''}
            <p class="scholar-credential">${renderScholarMarkdown(s.credential)}</p>
        </li>
    `).join('');
}

function openStatementModal(scholar: Scholar): void {
    const modal = document.getElementById('blurb-modal');
    if (!modal) return;
    const textEl = modal.querySelector('.blurb-modal-text')!;
    const paragraphs = (scholar.statement ?? '').split('\n\n');
    textEl.innerHTML = paragraphs.map(p => `<p>${p}</p>`).join('');
    modal.querySelector('.blurb-modal-attr')!.textContent = `— ${scholar.given} ${scholar.surname}`;
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('is-open');
}

export async function initScholarReveal(anchor: HTMLElement): Promise<void> {
    const response = await fetch('/data/scholars.json');
    const scholars: Scholar[] = await response.json();
    if (scholars.length === 0) return;

    const sorted = [...scholars].sort((a, b) => a.surname.localeCompare(b.surname));

    anchor.innerHTML = `
        <details class="scholar-reveal">
            <summary>Reviewed by Ph.D. scholars</summary>
            <ul>${renderScholars(sorted)}</ul>
        </details>
    `;

    anchor.querySelectorAll<HTMLButtonElement>('.scholar-statement-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const scholar = sorted[Number(btn.dataset.scholarIndex)];
            if (scholar) openStatementModal(scholar);
        });
    });
}
