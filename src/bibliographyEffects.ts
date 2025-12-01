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
    private mutualRegardPairs: Set<string> = new Set();
    private hearts: HTMLElement[] = [];
    private lastReplacedSlot: number = 2;

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
            this.setupLongPressCopy(entry as HTMLElement, state);
        });

        this.setupBattleMode();
    }

    private setupLongPressCopy(entry: HTMLElement, state: BibEntryState): void {
        let pressStartTime = 0;
        let startX = 0;
        let startY = 0;
        let hasMoved = false;
        let longPressTriggered = false;
        let feedbackTimer: number | null = null;
        const LONG_PRESS_DURATION = 500;
        const MOVE_THRESHOLD = 10; // pixels - allow small movements

        const startPress = (e: Event) => {
            hasMoved = false;
            longPressTriggered = false;
            pressStartTime = Date.now();

            // Record starting position
            if (e instanceof TouchEvent && e.touches.length > 0) {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
            } else if (e instanceof MouseEvent) {
                startX = e.clientX;
                startY = e.clientY;
            }

            // Show "Copied!" feedback after holding for LONG_PRESS_DURATION
            feedbackTimer = window.setTimeout(() => {
                if (!hasMoved && pressStartTime > 0) {
                    this.showCopyFeedback(entry);
                    longPressTriggered = true;
                }
            }, LONG_PRESS_DURATION);
        };

        const endPress = (e: Event) => {
            // Clear the feedback timer
            if (feedbackTimer) {
                clearTimeout(feedbackTimer);
                feedbackTimer = null;
            }

            // If long press was triggered (feedback shown), copy on release
            if (longPressTriggered && pressStartTime > 0) {
                // Copy immediately within the user gesture
                this.copyReferenceToClipboard(entry, state, true); // true = skip showing feedback again
                e.preventDefault();
            }

            pressStartTime = 0;
        };

        const handleTouchMove = (e: Event) => {
            if (!(e instanceof TouchEvent) || e.touches.length === 0) return;

            const currentX = e.touches[0].clientX;
            const currentY = e.touches[0].clientY;
            const deltaX = Math.abs(currentX - startX);
            const deltaY = Math.abs(currentY - startY);
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            // Only cancel if moved beyond threshold
            if (distance > MOVE_THRESHOLD) {
                hasMoved = true;

                // Clear feedback timer if user moves significantly
                if (feedbackTimer) {
                    clearTimeout(feedbackTimer);
                    feedbackTimer = null;
                }
            }
        };

        const handleLeave = () => {
            pressStartTime = 0;
            if (feedbackTimer) {
                clearTimeout(feedbackTimer);
                feedbackTimer = null;
            }
        };

        entry.addEventListener('mousedown', startPress);
        entry.addEventListener('mouseup', endPress);
        entry.addEventListener('mouseleave', handleLeave);
        entry.addEventListener('touchstart', startPress, { passive: true });
        entry.addEventListener('touchend', endPress);
        entry.addEventListener('touchmove', handleTouchMove, { passive: true });

        // Prevent click event if long press was triggered
        entry.addEventListener('click', (e) => {
            if (longPressTriggered) {
                e.preventDefault();
                e.stopPropagation();
                // Reset after a brief delay
                setTimeout(() => {
                    longPressTriggered = false;
                }, 100);
                return false;
            }
        }, { capture: true });
    }

    private async copyReferenceToClipboard(entry: HTMLElement, state: BibEntryState, skipFeedback = false): Promise<void> {
        const citationText = state.originalCitation;

        try {
            // Try modern Clipboard API first
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(citationText);
                if (!skipFeedback) {
                    this.showCopyFeedback(entry);
                }
            } else {
                // Fallback to execCommand for older browsers
                this.copyToClipboardFallback(citationText);
                if (!skipFeedback) {
                    this.showCopyFeedback(entry);
                }
            }
        } catch (err) {
            // If Clipboard API fails (e.g., lack of user activation), use fallback
            try {
                this.copyToClipboardFallback(citationText);
                if (!skipFeedback) {
                    this.showCopyFeedback(entry);
                }
            } catch (fallbackErr) {
                console.error('[Bibliography] Failed to copy:', err, fallbackErr);
            }
        }
    }

    private copyToClipboardFallback(text: string): void {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            document.execCommand('copy');
        } finally {
            textArea.remove();
        }
    }

    private showCopyFeedback(entry: HTMLElement): void {
        const feedback = document.createElement('div');
        feedback.textContent = '📋 Copied!';
        feedback.style.cssText = `
            position: absolute;
            top: 50%;
            right: 1rem;
            transform: translateY(-50%);
            background: var(--daime-gold);
            color: #000;
            padding: 0.4rem 0.8rem;
            border-radius: 6px;
            font-size: 0.85rem;
            font-weight: 600;
            pointer-events: none;
            z-index: 100;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            animation: copy-fade 1.5s ease-out forwards;
        `;

        const existingFeedback = entry.querySelector('.copy-feedback');
        if (existingFeedback) {
            existingFeedback.remove();
        }

        feedback.className = 'copy-feedback';
        entry.appendChild(feedback);

        const style = document.createElement('style');
        style.textContent = `
            @keyframes copy-fade {
                0% {
                    opacity: 0;
                    transform: translateY(-50%) scale(0.8);
                }
                20% {
                    opacity: 1;
                    transform: translateY(-50%) scale(1);
                }
                80% {
                    opacity: 1;
                    transform: translateY(-50%) scale(1);
                }
                100% {
                    opacity: 0;
                    transform: translateY(-50%) translateY(-10px) scale(0.9);
                }
            }
        `;

        if (!document.getElementById('copy-feedback-style')) {
            style.id = 'copy-feedback-style';
            document.head.appendChild(style);
        }

        setTimeout(() => {
            feedback.remove();
        }, 1500);
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

        const words = originalText.split(/(\s+)/);
        const wordIndices = words.map((w, i) => ({ word: w, index: i }))
            .filter(item => item.word.trim().length > 0 && /[A-Za-z]/.test(item.word));

        if (wordIndices.length === 0) return;

        const numToRedact = Math.min(Math.max(1, Math.floor(wordIndices.length * 0.2)), 3);
        const indicesToRedact = new Set<number>();
        while (indicesToRedact.size < numToRedact) {
            const randomIndex = Math.floor(Math.random() * wordIndices.length);
            indicesToRedact.add(wordIndices[randomIndex].index);
        }

        const redactedWords = words.map((word, i) => {
            if (indicesToRedact.has(i)) {
                return word.replace(/[A-Za-z0-9]/g, '█');
            }
            return word;
        });

        const redacted = redactedWords.join('');

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

        let slotToUse: number;

        if (this.selectedEntries.size === 0) {
            slotToUse = 1;
        } else if (this.selectedEntries.size === 1) {
            slotToUse = this.selectedEntries.has(1) ? 2 : 1;
        } else {
            slotToUse = this.lastReplacedSlot === 1 ? 2 : 1;
            const oldEntry = this.selectedEntries.get(slotToUse);
            if (oldEntry) {
                const oldState = this.entries.get(oldEntry.id);
                if (oldState) {
                    this.unselectEntry(oldEntry, slotToUse, oldState);
                }
            }
        }

        this.selectEntry(entry, slotToUse, state);
        this.lastReplacedSlot = slotToUse;

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

        this.battleButton.addEventListener('click', () => {
            if (this.battleButton) {
                this.battleButton.style.transition = 'opacity 1s ease';
                this.battleButton.style.opacity = '0';
                setTimeout(() => {
                    if (this.battleButton) {
                        this.battleButton.style.display = 'none';
                        this.battleButton.style.opacity = '1';
                    }
                }, 1000);
            }
            this.startBattle();
        });
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

        // Don't run away on mobile
        if (this.isMobilePortrait() || window.innerWidth <= 768) return;

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

    private getPairKey(entry1: HTMLElement, entry2: HTMLElement): string {
        const ids = [entry1.id, entry2.id].sort();
        return `${ids[0]}|${ids[1]}`;
    }

    private hasMutualRegard(entry1: HTMLElement, entry2: HTMLElement): boolean {
        return this.mutualRegardPairs.has(this.getPairKey(entry1, entry2));
    }

    private async startBattle(): Promise<void> {
        if (this.selectedEntries.size !== 2) return;

        const fighter1 = this.selectedEntries.get(1);
        const fighter2 = this.selectedEntries.get(2);
        if (!fighter1 || !fighter2) return;

        const surname1 = this.getBibSurname(fighter1);
        const surname2 = this.getBibSurname(fighter2);

        // Check for same surname - show apology without rotation requirement
        if (surname1.toLowerCase() === surname2.toLowerCase() && surname1 !== 'Unknown') {
            this.showSameSurnameApology(surname1);
            return;
        }

        // Check for mutual regard - show chastisement without rotation requirement
        if (this.hasMutualRegard(fighter1, fighter2)) {
            this.showChastisement(fighter1, fighter2);
            return;
        }

        // Check for mobile portrait orientation only for actual battles
        if (this.isMobilePortrait()) {
            this.showRotateDeviceMessage();
            return;
        }

        if (this.battleButton) {
            this.battleButton.style.display = 'none';
            this.battleButton.style.transform = 'translate(-50%, -50%)';
        }

        const title1 = this.getBibTitle(fighter1);
        const title2 = this.getBibTitle(fighter2);

        const label1 = this.getDistinctiveWords(title1, title2);
        const label2 = this.getDistinctiveWords(title2, title1);

        const name1 = this.getBibName(fighter1);
        const name2 = this.getBibName(fighter2);

        const arena = this.createBattleArena(label1, label2);
        document.body.appendChild(arena);

        let debugTriggered = false;
        const debugBtn = arena.querySelector('#debug-mutual-regard');
        if (debugBtn) {
            debugBtn.addEventListener('click', () => {
                debugTriggered = true;
            });
        }

        await this.sleep(500);
        this.addBattleLog(arena, `${name1} vs ${name2}!`);
        await this.sleep(1000);

        const hp1 = { current: 100, max: 100 };
        const hp2 = { current: 100, max: 100 };

        this.updateBattleHP(arena, 'fighter1', hp1);
        this.updateBattleHP(arena, 'fighter2', hp2);

        const mutualRegardChance = 0.022;
        let battleInterrupted = false;

        while (hp1.current > 0 && hp2.current > 0) {
            if ((Math.random() < mutualRegardChance || debugTriggered) && !battleInterrupted) {
                battleInterrupted = true;
                await this.triggerMutualRegardTransition(arena, fighter1, fighter2, name1, name2);
                return;
            }

            const damage1 = Math.floor(Math.random() * 30) + 10;
            hp2.current = Math.max(0, hp2.current - damage1);
            this.addBattleLog(arena, `${name1} attacks for ${damage1} damage!`);
            this.updateBattleHP(arena, 'fighter2', hp2);
            this.flashDamage(fighter2);
            await this.sleep(1000);

            if (hp2.current <= 0) break;

            if ((Math.random() < mutualRegardChance || debugTriggered) && !battleInterrupted) {
                battleInterrupted = true;
                await this.triggerMutualRegardTransition(arena, fighter1, fighter2, name1, name2);
                return;
            }

            const damage2 = Math.floor(Math.random() * 30) + 10;
            hp1.current = Math.max(0, hp1.current - damage2);
            this.addBattleLog(arena, `${name2} attacks for ${damage2} damage!`);
            this.updateBattleHP(arena, 'fighter1', hp1);
            this.flashDamage(fighter1);
            await this.sleep(1000);
        }

        const winner = hp1.current > 0 ? name1 : name2;
        this.addBattleLog(arena, `🏆 ${winner} wins!`);
        this.hideHPBars(arena);
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
            max-height: 85vh;
            background: linear-gradient(135deg, rgba(30, 144, 255, 0.95), rgba(147, 112, 219, 0.95));
            border: 3px solid var(--daime-gold);
            border-radius: 12px;
            padding: 1rem;
            z-index: 10000;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
            align-items: center;
            overflow-y: auto;
        `;

        arena.innerHTML = `
            <div style="text-align: center; margin-bottom: 1rem; width: 100%; position: relative;">
                <h2 style="color: var(--daime-gold); text-shadow: 2px 2px 4px rgba(0,0,0,0.5); margin: 0; font-size: 1.3rem;">
                    📚 BIBLIOGRAPHY BATTLE! 📚
                </h2>
                <button id="debug-mutual-regard" style="
                    position: absolute;
                    top: 0;
                    right: 0;
                    padding: 0.25rem 0.5rem;
                    background: rgba(255, 0, 255, 0.3);
                    border: 1px solid rgba(255, 0, 255, 0.6);
                    border-radius: 4px;
                    color: rgba(255, 255, 255, 0.7);
                    font-size: 0.7rem;
                    cursor: pointer;
                    font-family: monospace;
                    display: block;
                ">DEBUG: ♥</button>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1rem; width: 100%;">
                <div class="fighter-hp" data-fighter="fighter1">
                    <div style="font-weight: 600; margin-bottom: 0.3rem; color: white; text-transform: capitalize; font-size: 0.85rem;">${label1}</div>
                    <div style="background: rgba(0,0,0,0.3); border-radius: 6px; height: 16px; overflow: hidden;">
                        <div class="hp-bar" style="background: #00FF00; height: 100%; width: 100%; transition: width 0.3s ease;"></div>
                    </div>
                    <div class="hp-text" style="color: white; font-size: 0.75rem; margin-top: 0.2rem;">100/100 HP</div>
                </div>

                <div class="fighter-hp" data-fighter="fighter2">
                    <div style="font-weight: 600; margin-bottom: 0.3rem; color: white; text-transform: capitalize; font-size: 0.85rem;">${label2}</div>
                    <div style="background: rgba(0,0,0,0.3); border-radius: 6px; height: 16px; overflow: hidden;">
                        <div class="hp-bar" style="background: #00FF00; height: 100%; width: 100%; transition: width 0.3s ease;"></div>
                    </div>
                    <div class="hp-text" style="color: white; font-size: 0.75rem; margin-top: 0.2rem;">100/100 HP</div>
                </div>
            </div>

            <div id="battle-log" style="
                background: rgba(0,0,0,0.3);
                border-radius: 6px;
                padding: 0.75rem;
                height: 100px;
                overflow-y: auto;
                color: white;
                font-family: 'Courier New', monospace;
                font-size: 0.8rem;
                width: 100%;
                line-height: 1.3;
                transition: height 0.5s ease;
                touch-action: pan-y;
                overscroll-behavior: contain;
            "></div>
        `;

        const battleLog = arena.querySelector('#battle-log');
        if (battleLog) {
            battleLog.addEventListener('touchstart', (e) => {
                e.stopPropagation();
            }, { passive: true });

            battleLog.addEventListener('touchmove', (e) => {
                e.stopPropagation();
            }, { passive: true });
        }

        return arena;
    }

    private getBibName(entry: HTMLElement): string {
        const citation = entry.querySelector('.bib-citation');
        if (!citation) return 'Unknown';

        const text = citation.textContent || '';
        const match = text.match(/^([^,\.]+)/);
        return match ? match[1].substring(0, 30) : text.substring(0, 30);
    }

    private getBibSurname(entry: HTMLElement): string {
        const citation = entry.querySelector('.bib-citation');
        if (!citation) return 'Unknown';

        const text = citation.textContent || '';
        const match = text.match(/^([^\s,\.]+)/);
        return match ? match[1].trim() : 'Unknown';
    }

    private getBibTitle(entry: HTMLElement): string {
        const citation = entry.querySelector('.bib-citation');
        if (!citation) return 'Unknown';

        const text = citation.textContent || '';

        const yearMatch = text.match(/\((\d{4}[a-z]?)\)\.\s+(.+)/);
        if (yearMatch && yearMatch[2]) {
            const afterYear = yearMatch[2];

            const italicMatch = afterYear.match(/^(.+?)\.\s*_/) || afterYear.match(/^_([^_]+)_/);
            if (italicMatch) {
                return italicMatch[1].trim();
            }

            const firstSentence = afterYear.match(/^([^.?!]+)/);
            if (firstSentence) {
                return firstSentence[1].trim();
            }
        }

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

    private hideHPBars(arena: HTMLElement): void {
        const hpContainer = arena.querySelector('[style*="grid-template-columns"]') as HTMLElement;
        const battleLog = arena.querySelector('#battle-log') as HTMLElement;

        if (hpContainer) {
            hpContainer.style.transition = 'opacity 0.5s ease, height 0.5s ease';
            hpContainer.style.opacity = '0';
            hpContainer.style.height = '0';
            hpContainer.style.marginBottom = '0';
            hpContainer.style.overflow = 'hidden';
        }

        if (battleLog) {
            battleLog.style.height = '250px';
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

    private async triggerMutualRegardTransition(arena: HTMLElement, fighter1: HTMLElement, fighter2: HTMLElement, name1: string, name2: string): Promise<void> {
        arena.style.animation = 'battle-shake 0.3s infinite';

        await this.sleep(300);

        const staticOverlay = document.createElement('div');
        staticOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image:
                repeating-linear-gradient(0deg, transparent 0px, transparent 1px, rgba(0,0,0,0.8) 1px, rgba(0,0,0,0.8) 2px),
                repeating-linear-gradient(90deg, rgba(255,255,255,0.1) 0px, rgba(255,255,255,0.1) 1px, transparent 1px, transparent 2px);
            background-size: 100% 4px, 4px 100%;
            opacity: 0;
            animation: static-glitch 0.05s infinite, static-fade-in 0.3s forwards;
            pointer-events: none;
            z-index: 10;
        `;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes battle-shake {
                0% { transform: translate(-50%, -50%); }
                10% { transform: translate(calc(-50% - 8px), calc(-50% + 6px)); }
                20% { transform: translate(calc(-50% + 7px), calc(-50% - 8px)); }
                30% { transform: translate(calc(-50% - 6px), calc(-50% + 7px)); }
                40% { transform: translate(calc(-50% + 8px), calc(-50% - 5px)); }
                50% { transform: translate(calc(-50% - 7px), calc(-50% + 8px)); }
                60% { transform: translate(calc(-50% + 6px), calc(-50% - 7px)); }
                70% { transform: translate(calc(-50% - 8px), calc(-50% + 5px)); }
                80% { transform: translate(calc(-50% + 7px), calc(-50% - 6px)); }
                90% { transform: translate(calc(-50% - 5px), calc(-50% + 8px)); }
                100% { transform: translate(-50%, -50%); }
            }
            @keyframes static-glitch {
                0% {
                    opacity: 0.9;
                    background-position: 0 0, 0 0;
                    filter: contrast(1.2) brightness(1.1);
                }
                10% {
                    opacity: 0.95;
                    background-position: -12px -8px, 5px -3px;
                    filter: contrast(1.3) brightness(0.9);
                }
                20% {
                    opacity: 0.85;
                    background-position: 15px 12px, -8px 6px;
                    filter: contrast(1.1) brightness(1.2);
                }
                30% {
                    opacity: 0.9;
                    background-position: -8px 15px, 12px -5px;
                    filter: contrast(1.4) brightness(0.95);
                }
                40% {
                    opacity: 0.95;
                    background-position: 18px -10px, -15px 8px;
                    filter: contrast(1.2) brightness(1.05);
                }
                50% {
                    opacity: 0.88;
                    background-position: -20px 5px, 10px -12px;
                    filter: contrast(1.35) brightness(0.92);
                }
                60% {
                    opacity: 0.92;
                    background-position: 8px -18px, -6px 15px;
                    filter: contrast(1.15) brightness(1.08);
                }
                70% {
                    opacity: 0.9;
                    background-position: -15px 10px, 20px -8px;
                    filter: contrast(1.25) brightness(0.98);
                }
                80% {
                    opacity: 0.95;
                    background-position: 12px -15px, -10px 12px;
                    filter: contrast(1.3) brightness(1.1);
                }
                90% {
                    opacity: 0.87;
                    background-position: -5px 18px, 15px -10px;
                    filter: contrast(1.2) brightness(0.95);
                }
                100% {
                    opacity: 0.9;
                    background-position: 0 0, 0 0;
                    filter: contrast(1.2) brightness(1.1);
                }
            }
            @keyframes static-fade-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }
        `;
        document.head.appendChild(style);

        arena.appendChild(staticOverlay);

        await this.sleep(1500);

        staticOverlay.style.animation = 'static-fade-out 0.5s forwards';
        const fadeOutStyle = document.createElement('style');
        fadeOutStyle.textContent = `
            @keyframes static-fade-out {
                from { opacity: 1; }
                to { opacity: 0; }
            }
        `;
        document.head.appendChild(fadeOutStyle);

        await this.sleep(500);
        arena.style.animation = '';
        arena.style.transform = 'translate(-50%, -50%)';
        staticOverlay.remove();

        await this.showMutualRegard(arena, fighter1, fighter2, name1, name2);
    }

    private async showMutualRegard(arena: HTMLElement, fighter1: HTMLElement, fighter2: HTMLElement, name1: string, name2: string): Promise<void> {
        await this.sleep(300);
        this.addBattleLog(arena, '...');
        await this.sleep(800);
        this.addBattleLog(arena, `${name1} pauses...`);
        await this.sleep(1000);
        this.addBattleLog(arena, `${name2} lowers their guard...`);
        await this.sleep(1200);
        this.addBattleLog(arena, '"We need not fight," they say.');
        await this.sleep(1500);
        this.addBattleLog(arena, '"Our contributions complement each other."');
        await this.sleep(1500);
        this.addBattleLog(arena, '💕 MUTUAL REGARD ACHIEVED 💕');

        this.hideHPBars(arena);

        this.mutualRegardPairs.add(this.getPairKey(fighter1, fighter2));

        const heart = this.createDraggableHeart(name1, name2);
        document.body.appendChild(heart);
        this.hearts.push(heart);

        this.showMutualRegardDismissButton(arena);
    }

    private createDraggableHeart(name1: string, name2: string): HTMLElement {
        const heart = document.createElement('div');
        heart.className = 'mutual-regard-heart';
        heart.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 200px;
            height: 180px;
            cursor: move;
            user-select: none;
            z-index: 9999;
            filter: drop-shadow(0 4px 12px rgba(255, 20, 147, 0.6));
            touch-action: none;
        `;

        heart.innerHTML = `
            <svg viewBox="0 0 200 180" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="heart-gradient-${Date.now()}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#FF1493;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#FF69B4;stop-opacity:1" />
                    </linearGradient>
                </defs>
                <path d="M100,170 C100,170 20,120 20,70 C20,50 30,30 50,30 C70,30 85,45 100,60 C115,45 130,30 150,30 C170,30 180,50 180,70 C180,120 100,170 100,170 Z"
                      fill="url(#heart-gradient-${Date.now()})"
                      stroke="#FF1493"
                      stroke-width="3"/>
                <text x="100" y="85" text-anchor="middle" font-size="14" font-weight="bold" fill="white" stroke="#FF1493" stroke-width="0.5">
                    ${this.truncateName(name1)}
                </text>
                <text x="100" y="105" text-anchor="middle" font-size="14" font-weight="bold" fill="white" stroke="#FF1493" stroke-width="0.5">
                    &amp;
                </text>
                <text x="100" y="125" text-anchor="middle" font-size="14" font-weight="bold" fill="white" stroke="#FF1493" stroke-width="0.5">
                    ${this.truncateName(name2)}
                </text>
            </svg>
        `;

        this.makeDraggable(heart);
        return heart;
    }

    private truncateName(name: string): string {
        const maxLength = 18;
        return name.length > maxLength ? name.substring(0, maxLength - 3) + '...' : name;
    }

    private makeDraggable(element: HTMLElement): void {
        let isDragging = false;
        let currentX = 0;
        let currentY = 0;
        let initialX = 0;
        let initialY = 0;

        const startDrag = (clientX: number, clientY: number) => {
            isDragging = true;
            initialX = clientX - currentX;
            initialY = clientY - currentY;
            element.style.cursor = 'grabbing';
        };

        const drag = (clientX: number, clientY: number) => {
            if (isDragging) {
                currentX = clientX - initialX;
                currentY = clientY - initialY;
                element.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px))`;
            }
        };

        const endDrag = () => {
            isDragging = false;
            element.style.cursor = 'move';
        };

        element.addEventListener('mousedown', (e: MouseEvent) => {
            startDrag(e.clientX, e.clientY);
        });

        document.addEventListener('mousemove', (e: MouseEvent) => {
            if (isDragging) {
                e.preventDefault();
                drag(e.clientX, e.clientY);
            }
        });

        document.addEventListener('mouseup', endDrag);

        element.addEventListener('touchstart', (e: TouchEvent) => {
            if (e.touches.length === 1) {
                startDrag(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: true });

        document.addEventListener('touchmove', (e: TouchEvent) => {
            if (isDragging && e.touches.length === 1) {
                e.preventDefault();
                drag(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: false });

        document.addEventListener('touchend', (e: TouchEvent) => {
            if (isDragging) {
                endDrag();
            }
        });
    }

    private showMutualRegardDismissButton(arena: HTMLElement): void {
        const dismissPhrases = [
            "This warms my soul",
            "Love transcends citation counts",
            "Collaboration over competition",
            "The universe celebrates their bond",
            "My heart chakra is activated",
            "This is the energy we need",
            "Peaceful resolution achieved",
            "They have found harmony",
            "The cosmos approves",
            "Academic solidarity achieved"
        ];

        const randomPhrase = dismissPhrases[Math.floor(Math.random() * dismissPhrases.length)];

        const dismissButton = document.createElement('button');
        dismissButton.textContent = randomPhrase;
        dismissButton.style.cssText = `
            margin-top: 1.5rem;
            padding: 0.75rem 1.5rem;
            background: linear-gradient(135deg, #FF1493, #FF69B4);
            border: 2px solid white;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            font-size: 1rem;
            color: white;
            transition: all 0.2s ease;
            box-shadow: 0 2px 8px rgba(255, 20, 147, 0.5);
        `;

        dismissButton.addEventListener('mouseenter', () => {
            dismissButton.style.transform = 'scale(1.05)';
            dismissButton.style.boxShadow = '0 4px 16px rgba(255, 20, 147, 0.7)';
        });

        dismissButton.addEventListener('mouseleave', () => {
            dismissButton.style.transform = 'scale(1)';
            dismissButton.style.boxShadow = '0 2px 8px rgba(255, 20, 147, 0.5)';
        });

        dismissButton.addEventListener('click', () => {
            arena.remove();
            this.clearBattleSelections();
        });

        arena.appendChild(dismissButton);
    }

    private showSameSurnameApology(surname: string): void {
        const apologyModal = document.createElement('div');
        apologyModal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 90%;
            max-width: 320px;
            max-height: 85vh;
            background: linear-gradient(135deg, rgba(25, 25, 112, 0.98), rgba(72, 61, 139, 0.98));
            border: 3px solid var(--daime-gold);
            border-radius: 12px;
            padding: 0.75rem;
            z-index: 10001;
            box-shadow: 0 0 40px rgba(218, 165, 32, 0.6);
            text-align: center;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            align-items: center;
        `;

        const apologies = [
            `We must humbly and profoundly apologize.<br><br>We <em>cannot</em> permit a battle involving the <strong>${surname}</strong> name.<br><br>Whether this represents:<br>• A single scholar battling themselves<br>• Two relatives in familial discord<br>• A remarkable coincidence<br><br>...the cosmic implications are equally dire.<br><br>The fabric of academic spacetime cannot withstand such conflict.<br><br>Please, we <em>implore</em> you: select different combatants.`,

            `With the deepest regret and most sincere apologies...<br><br>A battle between works bearing the <strong>${surname}</strong> name is <em>strictly forbidden</em> by ancient academic protocol.<br><br>Perhaps this is one author at war with their own earlier work. Perhaps these are family members. We cannot know.<br><br>What we <em>do</em> know: such conflicts create paradoxes that have historically resulted in spontaneous retraction cascades and temporal citation loops.<br><br>The karmic debt would be... <em>unfathomable</em>.<br><br>We must respectfully decline.`,

            `Oh dear. Oh my.<br><br>We find ourselves in a most <em>delicate</em> predicament.<br><br>You have selected two works sharing the name <strong>${surname}</strong>.<br><br>Is this the same person? Relatives? Strangers who happen to share a name?<br><br>It matters not. The citation field detects only the surname frequency resonance, and it is <em>screaming</em> warnings at us.<br><br>The last time we ignored this, three peer reviewers mysteriously disappeared and a conference was canceled mid-keynote.<br><br>We cannot, in good conscience, proceed.`,

            `A thousand apologies, dear user.<br><br>You have asked us to pit <strong>${surname}</strong> against <strong>${surname}</strong>.<br><br>Perhaps one scholar in existential combat with themselves. Perhaps relatives. Perhaps doppelgängers from parallel academic universes.<br><br>In any scenario, the universe has made its position clear through sacred numerology and the alignment of the reference stars:<br><br><em>This must not come to pass.</em><br><br>Please forgive us for this inconvenience.`
        ];

        const randomApology = apologies[Math.floor(Math.random() * apologies.length)];

        apologyModal.innerHTML = `
            <style>
                @keyframes solemn-pulse {
                    0%, 100% { box-shadow: 0 0 40px rgba(218, 165, 32, 0.6); }
                    50% { box-shadow: 0 0 60px rgba(218, 165, 32, 0.9); }
                }
            </style>
            <div style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.8;">🙏</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: var(--daime-gold); margin-bottom: 0.5rem; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">
                Our Sincerest Apologies
            </div>
            <div style="color: white; font-weight: 500; font-size: 0.85rem; line-height: 1.5; margin-bottom: 0.75rem; text-shadow: 1px 1px 2px rgba(0,0,0,0.5); flex: 1; overflow-y: auto;">
                ${randomApology}
            </div>
            <button id="accept-apology" style="
                padding: 0.6rem 1rem;
                background: var(--daime-gold);
                border: 2px solid white;
                border-radius: 8px;
                cursor: pointer;
                font-weight: 700;
                font-size: 0.9rem;
                color: #191970;
                transition: all 0.2s ease;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
            ">I understand and forgive you</button>
        `;

        apologyModal.style.animation = 'solemn-pulse 2s infinite';

        // Prevent scroll events from propagating to the page behind
        apologyModal.addEventListener('wheel', (e) => {
            e.stopPropagation();
        }, { passive: false });

        apologyModal.addEventListener('touchmove', (e) => {
            e.stopPropagation();
        }, { passive: false });

        document.body.appendChild(apologyModal);

        const acceptBtn = apologyModal.querySelector('#accept-apology');
        acceptBtn?.addEventListener('mouseenter', () => {
            (acceptBtn as HTMLElement).style.transform = 'scale(1.05)';
            (acceptBtn as HTMLElement).style.background = 'var(--daime-blue)';
            (acceptBtn as HTMLElement).style.color = 'white';
        });

        acceptBtn?.addEventListener('mouseleave', () => {
            (acceptBtn as HTMLElement).style.transform = 'scale(1)';
            (acceptBtn as HTMLElement).style.background = 'var(--daime-gold)';
            (acceptBtn as HTMLElement).style.color = '#191970';
        });

        acceptBtn?.addEventListener('click', () => {
            apologyModal.remove();
            this.clearBattleSelections();
        });
    }

    private showChastisement(fighter1: HTMLElement, fighter2: HTMLElement): void {
        const name1 = this.getBibName(fighter1);
        const name2 = this.getBibName(fighter2);

        const existingHeart = this.hearts.find(heart => {
            const text = heart.textContent || '';
            return (text.includes(this.truncateName(name1)) && text.includes(this.truncateName(name2))) ||
                   (text.includes(this.truncateName(name2)) && text.includes(this.truncateName(name1)));
        });

        const chastiseModal = document.createElement('div');
        chastiseModal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 90%;
            max-width: 320px;
            background: linear-gradient(135deg, rgba(139, 0, 0, 0.98), rgba(255, 0, 0, 0.98));
            border: 5px solid #FFD700;
            border-radius: 16px;
            padding: 1rem;
            z-index: 10001;
            box-shadow: 0 0 60px rgba(255, 0, 0, 0.8);
            text-align: center;
            animation: shake 0.5s infinite;
        `;

        const chastisements = [
            `HOW DARE YOU?!?!?!<br><br>${name1} and ${name2} have declared their ETERNAL MUTUAL REGARD!!!<br><br>You CANNOT force them to battle again!!!<br><br>Their bond is SACRED and UNBREAKABLE!!!<br><br>The universe ITSELF would collapse if they were to fight!!!<br><br>SHAME! SHAME UPON YOUR HOUSE!!!`,
            `ABSOLUTELY UNACCEPTABLE!!!<br><br>These two scholars have found PEACE!!!<br><br>They have TRANSCENDED the petty battles you seek!!!<br><br>Their mutual respect is a BEACON OF LIGHT in the dark academic world!!!<br><br>You shall NOT defile their sacred bond!!!<br><br>BE GONE WITH YOUR VIOLENCE!!!`,
            `WHAT KIND OF MONSTER ARE YOU?!?!<br><br>${name1} and ${name2} are SOUL MATES in the realm of knowledge!!!<br><br>They have gazed into each other's methodologies and found BEAUTY!!!<br><br>You DARE attempt to shatter their harmonious union?!?!<br><br>The AUDACITY! The GALL! The ABSOLUTE DISRESPECT!!!`,
            `NO! NO! NO! A THOUSAND TIMES NO!!!<br><br>These authors have achieved what few ever do: TRUE UNDERSTANDING!!!<br><br>Their citations intertwine like COSMIC VINES!!!<br><br>You would DESTROY this beautiful connection?!?!<br><br>Your chakras must be COMPLETELY misaligned!!!<br><br>BEGONE! REFLECT ON YOUR ACTIONS!!!`
        ];

        const randomChastisement = chastisements[Math.floor(Math.random() * chastisements.length)];

        chastiseModal.innerHTML = `
            <style>
                @keyframes shake {
                    0%, 100% { transform: translate(-50%, -50%) rotate(0deg); }
                    25% { transform: translate(-50%, -50%) rotate(-2deg); }
                    75% { transform: translate(-50%, -50%) rotate(2deg); }
                }
                @keyframes glow-pulse {
                    0%, 100% { filter: drop-shadow(0 0 20px rgba(255, 20, 147, 1)) drop-shadow(0 0 40px rgba(255, 20, 147, 0.8)); }
                    50% { filter: drop-shadow(0 0 40px rgba(255, 20, 147, 1)) drop-shadow(0 0 80px rgba(255, 20, 147, 1)); }
                }
            </style>
            <div style="font-size: 2.5rem; margin-bottom: 1rem;">⚠️🚫⚠️</div>
            <div style="color: white; font-weight: 700; font-size: 1.1rem; line-height: 1.6; margin-bottom: 2rem; text-shadow: 2px 2px 4px rgba(0,0,0,0.8);">
                ${randomChastisement}
            </div>
            <button id="acknowledge-shame" style="
                padding: 1rem 2rem;
                background: #FFD700;
                border: 3px solid white;
                border-radius: 8px;
                cursor: pointer;
                font-weight: 700;
                font-size: 1.1rem;
                color: #8B0000;
                transition: all 0.2s ease;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
            ">I am deeply ashamed</button>
        `;

        document.body.appendChild(chastiseModal);

        if (existingHeart) {
            existingHeart.style.transition = 'all 0.3s ease';
            existingHeart.style.left = '50%';
            existingHeart.style.top = '50%';
            existingHeart.style.transform = 'translate(-50%, -50%) scale(2)';
            existingHeart.style.animation = 'glow-pulse 1s infinite';
            existingHeart.style.zIndex = '10002';

            const acknowledgeBtn = chastiseModal.querySelector('#acknowledge-shame');
            acknowledgeBtn?.addEventListener('click', () => {
                chastiseModal.remove();
                this.clearBattleSelections();

                setTimeout(() => {
                    existingHeart.style.transform = 'translate(-50%, -50%) scale(1)';
                    existingHeart.style.animation = '';
                    existingHeart.style.zIndex = '9999';
                }, 100);
            });
        } else {
            const acknowledgeBtn = chastiseModal.querySelector('#acknowledge-shame');
            acknowledgeBtn?.addEventListener('click', () => {
                chastiseModal.remove();
                this.clearBattleSelections();
            });
        }
    }

    private isMobilePortrait(): boolean {
        return window.innerWidth <= 768 && window.innerHeight > window.innerWidth;
    }

    private showRotateDeviceMessage(): void {
        const rotateModal = document.createElement('div');
        rotateModal.id = 'rotate-device-modal';
        rotateModal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 85%;
            max-width: 320px;
            background: linear-gradient(135deg, rgba(30, 144, 255, 0.98), rgba(147, 112, 219, 0.98));
            border: 3px solid var(--daime-gold);
            border-radius: 12px;
            padding: 1.25rem;
            z-index: 10001;
            box-shadow: 0 0 30px rgba(218, 165, 32, 0.6);
            text-align: center;
            animation: gentle-pulse 2s infinite;
        `;

        rotateModal.innerHTML = `
            <style>
                @keyframes gentle-pulse {
                    0%, 100% { box-shadow: 0 0 30px rgba(218, 165, 32, 0.6); }
                    50% { box-shadow: 0 0 50px rgba(218, 165, 32, 0.9); }
                }
                @keyframes rotate-icon {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(90deg); }
                }
            </style>
            <div style="font-size: 2.5rem; margin-bottom: 0.75rem; animation: rotate-icon 1s ease-in-out infinite alternate;">📱</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: var(--daime-gold); margin-bottom: 0.75rem; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">
                Rotate Your Device
            </div>
            <div style="color: white; font-weight: 500; font-size: 0.85rem; line-height: 1.5; margin-bottom: 1.25rem; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">
                Bibliography Battle requires landscape mode for optimal cosmic alignment.
            </div>
            <button id="dismiss-rotate" style="
                padding: 0.6rem 1.2rem;
                background: var(--daime-gold);
                border: 2px solid white;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 600;
                font-size: 0.9rem;
                color: #1E90FF;
                transition: all 0.2s ease;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            ">I Understand</button>
        `;

        document.body.appendChild(rotateModal);

        const dismissBtn = rotateModal.querySelector('#dismiss-rotate');
        dismissBtn?.addEventListener('mouseenter', () => {
            (dismissBtn as HTMLElement).style.transform = 'scale(1.05)';
            (dismissBtn as HTMLElement).style.background = 'var(--daime-blue)';
            (dismissBtn as HTMLElement).style.color = 'white';
        });

        dismissBtn?.addEventListener('mouseleave', () => {
            (dismissBtn as HTMLElement).style.transform = 'scale(1)';
            (dismissBtn as HTMLElement).style.background = 'var(--daime-gold)';
            (dismissBtn as HTMLElement).style.color = '#1E90FF';
        });

        dismissBtn?.addEventListener('click', () => {
            rotateModal.remove();
        });

        // Listen for orientation change
        const handleOrientationChange = () => {
            if (!this.isMobilePortrait()) {
                rotateModal.remove();
                window.removeEventListener('resize', handleOrientationChange);
                // Automatically retry the battle
                this.startBattle();
            }
        };

        window.addEventListener('resize', handleOrientationChange);
    }
}

const bibEffects = new BibliographyEffects();
bibEffects.initialize();
