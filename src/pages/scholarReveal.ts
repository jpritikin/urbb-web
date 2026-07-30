interface Scholar {
    given: string;
    surname: string;
    credential: string;
    url?: string;
}

function renderScholarMarkdown(credential: string): string {
    return credential.replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function renderScholars(scholars: Scholar[]): string {
    const sorted = [...scholars].sort((a, b) => a.surname.localeCompare(b.surname));
    return sorted.map(s => `
        <li>
            <span class="scholar-name">${s.surname}, ${s.given}</span>${s.url ? ` — <a href="${s.url}" target="_blank" rel="noopener">review</a>` : ''}
            <p class="scholar-credential">${renderScholarMarkdown(s.credential)}</p>
        </li>
    `).join('');
}

export async function initScholarReveal(anchor: HTMLElement): Promise<void> {
    const response = await fetch('/data/scholars.json');
    const scholars: Scholar[] = await response.json();
    if (scholars.length === 0) return;

    anchor.innerHTML = `
        <details class="scholar-reveal">
            <summary>Reviewed by Ph.D. scholars</summary>
            <ul>${renderScholars(scholars)}</ul>
        </details>
    `;
}
