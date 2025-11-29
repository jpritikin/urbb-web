interface BibEntry {
    id: string;
    citation: string;
}

interface BibEntryState {
    element: HTMLElement;
    originalCitation: string;
    isGlitched: boolean;
    isFaded: boolean;
    isRedacted: boolean;
    isFixed: boolean;
}

class BibliographyEffects {
    private entries: Map<string, BibEntryState> = new Map();
    private selectedEntries: Map<number, HTMLElement> = new Map();
    private battleButton: HTMLElement | null = null;
    private hymnPlayerObserver: IntersectionObserver | null = null;
    private lastEscapeTime: number = 0;

    initialize(): void {
        this.waitForBibliography();
    }

    private waitForBibliography(): void {
        const check = setInterval(() => {
            const container = document.getElementById('bibliography-container');
            if (container && container.querySelectorAll('.bib-entry').length > 0) {
                clearInterval(check);
                this.applyEffects();
            }
        }, 100);
    }

    private applyEffects(): void {
        const bibEntries = document.querySelectorAll('.bib-entry');

        bibEntries.forEach((entry, index) => {
            const citationEl = entry.querySelector('.bib-citation');
            if (!citationEl) return;

            const originalText = citationEl.textContent || '';
            const state: BibEntryState = {
                element: entry as HTMLElement,
                originalCitation: originalText,
                isGlitched: false,
                isFaded: false,
                isRedacted: false,
                isFixed: false
            };

            this.entries.set(entry.id, state);

            const rand = Math.random();
            if (rand < 0.15) {
                this.applyRandomError(entry as HTMLElement, state, index);
            } else if (rand < 0.30) {
                this.applyFadeEffect(entry as HTMLElement, state);
            } else if (rand < 0.45) {
                this.applyRedactedEffect(entry as HTMLElement, state);
            }

            entry.addEventListener('click', () => this.handleEntryClick(entry as HTMLElement, state));
        });

        this.setupBattleMode();
    }

    private applyRandomError(entry: HTMLElement, state: BibEntryState, index: number): void {
        state.isGlitched = true;
        const citationEl = entry.querySelector('.bib-citation');
        if (!citationEl) return;

        const errorTypes = [
            { suffix: ' [citation needed]', color: '#FF00FF', strike: true },
            { suffix: ' [404 not found]', color: '#FF6B6B', strike: false },
            { suffix: ' [REDACTED]', color: '#666666', strike: true },
            { suffix: ' [error: corrupted data]', color: '#00FFFF', strike: false },
            { suffix: ' [deprecated]', color: '#FFA500', strike: true },
            { suffix: ' ✓', color: '#00FF00', strike: false, mono: true }
        ];

        const error = errorTypes[Math.floor(Math.random() * errorTypes.length)];

        if (error.strike) {
            (citationEl as HTMLElement).style.textDecoration = 'line-through';
            (citationEl as HTMLElement).style.opacity = '0.7';
        }

        if (error.mono) {
            (citationEl as HTMLElement).style.fontFamily = "'Courier New', monospace";
            (citationEl as HTMLElement).style.background = 'rgba(0, 255, 0, 0.05)';
        }

        const marker = document.createElement('span');
        marker.className = 'error-marker';
        marker.textContent = error.suffix;
        marker.style.fontSize = '0.75rem';
        marker.style.color = error.color;
        marker.style.fontStyle = 'italic';
        marker.style.opacity = '0.6';
        marker.style.marginLeft = '0.5rem';

        citationEl.appendChild(marker);
    }

    private applyFadeEffect(entry: HTMLElement, state: BibEntryState): void {
        state.isFaded = true;
        entry.style.opacity = '0.1';
        entry.style.transition = 'opacity 0.3s ease';
        entry.title = 'Click to restore';
    }

    private applyRedactedEffect(entry: HTMLElement, state: BibEntryState): void {
        state.isRedacted = true;
        const citationEl = entry.querySelector('.bib-citation');
        if (!citationEl) return;

        const originalText = citationEl.textContent || '';
        const redacted = originalText.replace(/[A-Za-z0-9]/g, '█');

        citationEl.textContent = redacted;
        citationEl.setAttribute('data-original', originalText);
        (citationEl as HTMLElement).style.cursor = 'help';
        entry.title = 'Hover to decrypt';

        citationEl.addEventListener('mouseenter', () => {
            if (!state.isFixed) {
                citationEl.textContent = originalText;
            }
        });

        citationEl.addEventListener('mouseleave', () => {
            if (!state.isFixed) {
                citationEl.textContent = redacted;
            }
        });
    }

    private handleEntryClick(entry: HTMLElement, state: BibEntryState): void {
        let selectionSlot: number | null = null;
        for (const [slot, selected] of this.selectedEntries.entries()) {
            if (selected === entry) {
                selectionSlot = slot;
                break;
            }
        }

        if (selectionSlot !== null) {
            this.unselectEntry(entry, selectionSlot, state);
            return;
        }

        if (this.selectedEntries.size < 2) {
            const nextSlot = this.selectedEntries.has(1) ? 2 : 1;
            this.selectEntry(entry, nextSlot, state);
        } else {
            const slotToReplace = this.selectedEntries.has(1) ? 1 : 2;
            const oldEntry = this.selectedEntries.get(slotToReplace);
            if (oldEntry) {
                const oldState = this.entries.get(oldEntry.id);
                if (oldState) {
                    this.unselectEntry(oldEntry, slotToReplace, oldState);
                }
            }
            this.selectEntry(entry, slotToReplace, state);
        }

        if (!state.isFixed) {
            if (state.isGlitched) {
                const citationEl = entry.querySelector('.bib-citation');
                const marker = entry.querySelector('.error-marker');
                if (citationEl && marker) {
                    (citationEl as HTMLElement).style.textDecoration = 'none';
                    (citationEl as HTMLElement).style.opacity = '1';
                    (citationEl as HTMLElement).style.fontFamily = '';
                    (citationEl as HTMLElement).style.background = '';
                    marker.remove();
                    state.isGlitched = false;
                    state.isFixed = true;
                }
            }

            if (state.isFaded) {
                entry.style.opacity = '1';
                state.isFaded = false;
                state.isFixed = true;
            }

            if (state.isRedacted) {
                const citationEl = entry.querySelector('.bib-citation');
                if (citationEl) {
                    citationEl.textContent = state.originalCitation;
                    state.isRedacted = false;
                    state.isFixed = true;
                }
            }
        }
    }

    private selectEntry(entry: HTMLElement, slot: number, state: BibEntryState): void {
        this.selectedEntries.set(slot, entry);

        if (state.isGlitched) {
            const citationEl = entry.querySelector('.bib-citation');
            const marker = entry.querySelector('.error-marker');
            if (citationEl && marker) {
                (citationEl as HTMLElement).style.textDecoration = 'none';
                (citationEl as HTMLElement).style.opacity = '1';
                (citationEl as HTMLElement).style.fontFamily = '';
                (citationEl as HTMLElement).style.background = '';
                marker.remove();
                state.isGlitched = false;
            }
        }

        if (state.isFaded) {
            entry.style.opacity = '1';
            state.isFaded = false;
        }

        if (state.isRedacted) {
            const citationEl = entry.querySelector('.bib-citation');
            if (citationEl) {
                citationEl.textContent = state.originalCitation;
                (citationEl as HTMLElement).style.cursor = '';
                citationEl.removeEventListener('mouseenter', () => { });
                citationEl.removeEventListener('mouseleave', () => { });
                state.isRedacted = false;
                state.isFixed = true;
            }
        }

        const badge = document.createElement('span');
        badge.className = `selection-badge badge-${slot}`;
        badge.textContent = slot.toString();
        badge.style.cssText = `
            position: absolute;
            top: 0.5rem;
            right: 0.5rem;
            background: ${slot === 1 ? 'var(--daime-blue)' : 'var(--daime-pink)'};
            color: white;
            width: 2rem;
            height: 2rem;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 1rem;
            border: 2px solid white;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        `;
        entry.style.position = 'relative';
        entry.appendChild(badge);

        this.updateBattleButtonVisibility();
    }

    private unselectEntry(entry: HTMLElement, slot: number, state: BibEntryState): void {
        this.selectedEntries.delete(slot);
        const badge = entry.querySelector(`.badge-${slot}`);
        if (badge) badge.remove();

        this.updateBattleButtonVisibility();
    }

    private flashFix(entry: HTMLElement): void {
        entry.style.background = 'rgba(0, 255, 0, 0.2)';
        entry.style.transition = 'background 0.5s ease';
        setTimeout(() => {
            entry.style.background = '';
        }, 500);
    }

    private setupBattleMode(): void {
        const container = document.getElementById('bibliography-container');
        if (!container) return;

        this.battleButton = document.createElement('button');
        this.battleButton.id = 'battle-mode-btn';
        this.battleButton.textContent = '⚔️ Battle';
        this.battleButton.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            padding: 1rem 2rem;
            background: var(--daime-gold);
            border: 3px solid var(--daime-purple);
            border-radius: 12px;
            cursor: pointer;
            font-weight: 700;
            font-size: 1.2rem;
            transition: all 0.2s ease;
            z-index: 1000;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
            display: none;
        `;

        this.battleButton.addEventListener('click', () => this.startBattle());
        document.addEventListener('mousemove', (e) => this.checkMouseProximity(e));
        document.body.appendChild(this.battleButton);

        this.setupHymnPlayerObserver();
    }

    private setupHymnPlayerObserver(): void {
        const hymnPlayer = document.getElementById('cassette-player-container');
        if (!hymnPlayer) return;

        this.hymnPlayerObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.hideBattleButton();
                } else {
                    this.updateBattleButtonVisibility();
                }
            });
        }, {
            threshold: 0.1
        });

        this.hymnPlayerObserver.observe(hymnPlayer);
    }

    private updateBattleButtonVisibility(): void {
        if (!this.battleButton) return;

        const hymnPlayer = document.getElementById('cassette-player-container');
        if (!hymnPlayer) return;

        const rect = hymnPlayer.getBoundingClientRect();
        const isHymnPlayerVisible = rect.top < window.innerHeight && rect.bottom > 0;

        if (this.selectedEntries.size === 2 && !isHymnPlayerVisible) {
            this.battleButton.style.display = 'block';
        } else {
            this.battleButton.style.display = 'none';
        }
    }

    private hideBattleButton(): void {
        if (this.battleButton) {
            this.battleButton.style.display = 'none';
        }
    }

    private checkMouseProximity(e: MouseEvent): void {
        if (!this.battleButton || this.battleButton.style.display === 'none') return;

        const now = Date.now();
        if (now - this.lastEscapeTime < 500) return;

        this.lastEscapeTime = Date.now();

        const rect = this.battleButton.getBoundingClientRect();
        const buttonCenterX = rect.left + rect.width / 2;
        const buttonCenterY = rect.top + rect.height / 2;

        const distance = Math.sqrt(
            Math.pow(e.clientX - buttonCenterX, 2) +
            Math.pow(e.clientY - buttonCenterY, 2)
        );

        const detectionRadius = 150;

        if (distance < detectionRadius && Math.random() < 0.5) {
            this.runAwayFromMouse(e.clientX, e.clientY, buttonCenterX, buttonCenterY);
        }
    }

    private runAwayFromMouse(mouseX: number, mouseY: number, buttonX: number, buttonY: number): void {
        if (!this.battleButton) return;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const buttonWidth = this.battleButton.offsetWidth;
        const buttonHeight = this.battleButton.offsetHeight;

        const margin = 50;
        const randomX = margin + Math.random() * (viewportWidth - 2 * margin);
        const randomY = margin + Math.random() * (viewportHeight - 2 * margin);

        const offsetX = randomX - viewportWidth / 2;
        const offsetY = randomY - viewportHeight / 2;

        this.battleButton.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
        this.battleButton.style.transition = 'transform 0.2s ease-out';

        setTimeout(() => {
            if (this.battleButton) {
                this.battleButton.style.transition = 'transform 0.2s ease';
            }
        }, 200);
    }

    private clearBattleSelections(): void {
        for (const [slot, entry] of this.selectedEntries.entries()) {
            const state = this.entries.get(entry.id);
            if (state) {
                this.unselectEntry(entry, slot, state);
            }
        }
        this.selectedEntries.clear();
    }

    private async startBattle(): Promise<void> {
        if (this.selectedEntries.size !== 2) return;

        if (this.battleButton) {
            this.battleButton.style.display = 'none';
            this.battleButton.style.transform = 'translate(-50%, -50%)';
        }

        const fighter1 = this.selectedEntries.get(1);
        const fighter2 = this.selectedEntries.get(2);
        if (!fighter1 || !fighter2) return;

        const title1 = this.getBibTitle(fighter1);
        const title2 = this.getBibTitle(fighter2);

        const label1 = this.getDistinctiveWords(title1, title2);
        const label2 = this.getDistinctiveWords(title2, title1);

        const name1 = this.getBibName(fighter1);
        const name2 = this.getBibName(fighter2);

        const arena = this.createBattleArena(label1, label2);
        document.body.appendChild(arena);

        await this.sleep(500);
        this.addBattleLog(arena, `${name1} vs ${name2}!`);
        await this.sleep(1000);

        const hp1 = { current: 100, max: 100 };
        const hp2 = { current: 100, max: 100 };

        this.updateBattleHP(arena, 'fighter1', hp1);
        this.updateBattleHP(arena, 'fighter2', hp2);

        while (hp1.current > 0 && hp2.current > 0) {
            const damage1 = Math.floor(Math.random() * 30) + 10;
            hp2.current = Math.max(0, hp2.current - damage1);
            this.addBattleLog(arena, `${name1} attacks for ${damage1} damage!`);
            this.updateBattleHP(arena, 'fighter2', hp2);
            this.flashDamage(fighter2);
            await this.sleep(1000);

            if (hp2.current <= 0) break;

            const damage2 = Math.floor(Math.random() * 30) + 10;
            hp1.current = Math.max(0, hp1.current - damage2);
            this.addBattleLog(arena, `${name2} attacks for ${damage2} damage!`);
            this.updateBattleHP(arena, 'fighter1', hp1);
            this.flashDamage(fighter1);
            await this.sleep(1000);
        }

        const winner = hp1.current > 0 ? name1 : name2;
        await this.sleep(500);
        this.addBattleLog(arena, `🏆 ${winner} wins!`);

        await this.sleep(1000);
        this.showDismissButton(arena);
    }

    private showDismissButton(arena: HTMLElement): void {
        const dismissPhrases = [
            "Thank you for resolving this contest",
            "I'm invigorated",
            "My chakras are aligned now",
            "The universe has spoken",
            "Balance has been restored",
            "This knowledge nourishes me",
            "I have witnessed truth",
            "The cosmic debate concludes",
            "Enlightenment achieved",
            "My third eye is satisfied",
            "The akashic records are updated",
            "Gratitude flows through me",
            "The mystery is solved",
            "I am at peace with this outcome",
            "Divine wisdom has prevailed",
            "The spirits are pleased"
        ];

        const randomPhrase = dismissPhrases[Math.floor(Math.random() * dismissPhrases.length)];

        const dismissButton = document.createElement('button');
        dismissButton.textContent = randomPhrase;
        dismissButton.style.cssText = `
            margin-top: 1.5rem;
            padding: 0.75rem 1.5rem;
            background: var(--daime-gold);
            border: 2px solid white;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            font-size: 1rem;
            color: #000;
            transition: all 0.2s ease;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        `;

        dismissButton.addEventListener('mouseenter', () => {
            dismissButton.style.transform = 'scale(1.05)';
            dismissButton.style.background = 'var(--daime-blue)';
        });

        dismissButton.addEventListener('mouseleave', () => {
            dismissButton.style.transform = 'scale(1)';
            dismissButton.style.background = 'var(--daime-gold)';
        });

        dismissButton.addEventListener('click', () => {
            arena.remove();
            this.clearBattleSelections();
        });

        arena.appendChild(dismissButton);
    }

    private createBattleArena(label1: string, label2: string): HTMLElement {
        const arena = document.createElement('div');
        arena.id = 'battle-arena';
        arena.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 90%;
            max-width: 600px;
            background: linear-gradient(135deg, rgba(30, 144, 255, 0.95), rgba(147, 112, 219, 0.95));
            border: 4px solid var(--daime-gold);
            border-radius: 16px;
            padding: 2rem;
            z-index: 10000;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
            align-items: center;
        `;

        arena.innerHTML = `
            <div style="text-align: center; margin-bottom: 2rem; width: 100%;">
                <h2 style="color: var(--daime-gold); text-shadow: 2px 2px 4px rgba(0,0,0,0.5); margin: 0;">
                    📚 BIBLIOGRAPHY BATTLE! 📚
                </h2>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 2rem; width: 100%;">
                <div class="fighter-hp" data-fighter="fighter1">
                    <div style="font-weight: 600; margin-bottom: 0.5rem; color: white; text-transform: capitalize;">${label1}</div>
                    <div style="background: rgba(0,0,0,0.3); border-radius: 8px; height: 20px; overflow: hidden;">
                        <div class="hp-bar" style="background: #00FF00; height: 100%; width: 100%; transition: width 0.3s ease;"></div>
                    </div>
                    <div class="hp-text" style="color: white; font-size: 0.85rem; margin-top: 0.25rem;">100/100 HP</div>
                </div>

                <div class="fighter-hp" data-fighter="fighter2">
                    <div style="font-weight: 600; margin-bottom: 0.5rem; color: white; text-transform: capitalize;">${label2}</div>
                    <div style="background: rgba(0,0,0,0.3); border-radius: 8px; height: 20px; overflow: hidden;">
                        <div class="hp-bar" style="background: #00FF00; height: 100%; width: 100%; transition: width 0.3s ease;"></div>
                    </div>
                    <div class="hp-text" style="color: white; font-size: 0.85rem; margin-top: 0.25rem;">100/100 HP</div>
                </div>
            </div>

            <div id="battle-log" style="
                background: rgba(0,0,0,0.3);
                border-radius: 8px;
                padding: 1rem;
                height: 150px;
                overflow-y: auto;
                color: white;
                font-family: 'Courier New', monospace;
                font-size: 0.9rem;
                width: 100%;
            "></div>
        `;

        return arena;
    }

    private getBibName(entry: HTMLElement): string {
        const citation = entry.querySelector('.bib-citation');
        if (!citation) return 'Unknown';

        const text = citation.textContent || '';
        const match = text.match(/^([^,\.]+)/);
        return match ? match[1].substring(0, 30) : text.substring(0, 30);
    }

    private getBibTitle(entry: HTMLElement): string {
        const citation = entry.querySelector('.bib-citation');
        if (!citation) return 'Unknown';

        const text = citation.textContent || '';

        const titleMatch = text.match(/[""]([^""]+)[""]/) ||
            text.match(/_([^_]+)_/) ||
            text.match(/\*([^*]+)\*/);

        if (titleMatch) {
            return titleMatch[1];
        }

        const parts = text.split(/[.,]/);
        return parts.length > 1 ? parts[1].trim() : text;
    }

    private getDistinctiveWords(text1: string, text2: string): string {
        const commonWords = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'but', 'with', 'from', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being']);

        const words1 = text1.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !commonWords.has(w));
        const words2 = text2.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !commonWords.has(w));

        const set2 = new Set(words2);
        const uniqueWords = words1.filter(w => !set2.has(w));

        const result = uniqueWords.slice(0, 3).join(' ');
        return result || text1.split(/\s+/).slice(0, 3).join(' ');
    }

    private updateBattleHP(arena: HTMLElement, fighter: string, hp: { current: number, max: number }): void {
        const fighterDiv = arena.querySelector(`[data-fighter="${fighter}"]`);
        if (!fighterDiv) return;

        const hpBar = fighterDiv.querySelector('.hp-bar') as HTMLElement;
        const hpText = fighterDiv.querySelector('.hp-text') as HTMLElement;

        if (hpBar) {
            const percentage = (hp.current / hp.max) * 100;
            hpBar.style.width = `${percentage}%`;

            if (percentage > 50) {
                hpBar.style.background = '#00FF00';
            } else if (percentage > 25) {
                hpBar.style.background = '#FFFF00';
            } else {
                hpBar.style.background = '#FF0000';
            }
        }

        if (hpText) {
            hpText.textContent = `${hp.current}/${hp.max} HP`;
        }
    }

    private addBattleLog(arena: HTMLElement, message: string): void {
        const log = arena.querySelector('#battle-log');
        if (!log) return;

        const entry = document.createElement('div');
        entry.textContent = `> ${message}`;
        entry.style.marginBottom = '0.5rem';
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }

    private flashDamage(entry: HTMLElement): void {
        entry.style.background = 'rgba(255, 0, 0, 0.3)';
        entry.style.transition = 'background 0.2s ease';
        setTimeout(() => {
            entry.style.background = '';
        }, 200);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const bibEffects = new BibliographyEffects();
bibEffects.initialize();
