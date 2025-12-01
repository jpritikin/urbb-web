class AnimatronicSalmon {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private mouthState: number = 0;
    private tailPosition: number = 0;
    private animationFrame: number | null = null;
    private isPlaying: boolean = false;
    private glitchOffset: { x: number; y: number } = { x: 0, y: 0 };
    private glitchIntensity: number = 0;
    private transitionTimer: number = 0;
    private nextTransitionTime: number = 0;
    private nextTailTransition: number = 0;
    private headOpen: boolean = false;
    private cassetteInTransit: boolean = false;
    private cassettePosition: { x: number; y: number } = { x: 0, y: 0 };
    private cassetteColor: string = '#333333';
    private cassetteTargetPosition: { x: number; y: number } | null = null;
    private cassetteVelocity: { x: number; y: number } = { x: 0, y: 0 };
    private cassetteTargetType: 'salmon' | 'element' | null = null;
    private cassetteTargetElement: HTMLElement | null = null;
    private driftOffset: { x: number; y: number } = { x: 0, y: 0 };
    private driftVelocity: { x: number; y: number } = { x: 0, y: 0 };
    private driftTarget: { x: number; y: number } = { x: 0, y: 0 };
    private driftTime: number = 0;
    private driftFrameCounter: number = 0;
    private readonly salmonScale: number = 1.0;

    constructor(canvasId: string) {
        this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        if (!this.canvas) {
            throw new Error(`Canvas with id "${canvasId}" not found`);
        }
        this.ctx = this.canvas.getContext('2d')!;
        this.setupCanvas();
        this.initializeDrift();
        this.drawSalmon();
    }

    private initializeDrift(): void {
        this.pickNewDriftTarget();
        this.animationFrame = requestAnimationFrame(this.animate);
    }

    private pickNewDriftTarget(): void {
        const width = this.canvas.width / (window.devicePixelRatio || 1);
        const height = this.canvas.height / (window.devicePixelRatio || 1);

        const bodyLength = width * 0.5 * this.salmonScale;
        const bodyHeight = height * 0.35 * this.salmonScale;

        const marginX = bodyLength * 0.6;
        const marginY = bodyHeight * 0.6;

        const maxDriftX = (width / 2 - marginX);
        const maxDriftY = (height / 2 - marginY);

        this.driftTarget = {
            x: (Math.random() - 0.5) * 2 * maxDriftX,
            y: (Math.random() - 0.5) * 2 * maxDriftY
        };
    }

    private setupCanvas(): void {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;

        this.ctx.scale(dpr, dpr);
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
    }

    private drawSalmon(): void {
        const width = this.canvas.width / (window.devicePixelRatio || 1);
        const height = this.canvas.height / (window.devicePixelRatio || 1);

        this.ctx.clearRect(0, 0, width, height);

        this.ctx.save();

        this.ctx.translate(width / 2, height / 2);
        this.ctx.scale(this.salmonScale, this.salmonScale);
        this.ctx.translate(-width / 2, -height / 2);

        const centerX = width / 2 + this.glitchOffset.x + this.driftOffset.x;
        const centerY = height / 2 + this.glitchOffset.y + this.driftOffset.y;
        const bodyLength = width * 0.5;
        const bodyHeight = height * 0.35;

        // Body (realistic salmon shape using bezier curves)
        const bodyGradient = this.ctx.createLinearGradient(
            centerX - bodyLength / 2,
            centerY,
            centerX + bodyLength / 2,
            centerY
        );
        bodyGradient.addColorStop(0, '#c4816b');
        bodyGradient.addColorStop(0.3, '#d98f7a');
        bodyGradient.addColorStop(0.6, '#e8a590');
        bodyGradient.addColorStop(1, '#d98f7a');

        this.ctx.fillStyle = bodyGradient;
        this.ctx.beginPath();

        // Draw body with proper salmon silhouette
        const headX = centerX + bodyLength * 0.35;
        const tailX = centerX - bodyLength * 0.45;

        this.ctx.moveTo(headX, centerY);
        // Top of body
        this.ctx.bezierCurveTo(
            headX - bodyLength * 0.1, centerY - bodyHeight * 0.6,
            centerX, centerY - bodyHeight * 0.5,
            tailX, centerY - bodyHeight * 0.2
        );
        // Tail connection
        this.ctx.lineTo(tailX, centerY + bodyHeight * 0.2);
        // Bottom of body
        this.ctx.bezierCurveTo(
            centerX, centerY + bodyHeight * 0.5,
            headX - bodyLength * 0.1, centerY + bodyHeight * 0.6,
            headX, centerY
        );
        this.ctx.closePath();
        this.ctx.fill();

        // Belly highlight
        this.ctx.fillStyle = 'rgba(255, 220, 200, 0.4)';
        this.ctx.beginPath();
        this.ctx.ellipse(
            centerX,
            centerY + bodyHeight * 0.15,
            bodyLength * 0.25,
            bodyHeight * 0.25,
            0,
            0,
            Math.PI * 2
        );
        this.ctx.fill();

        // Spots
        this.ctx.fillStyle = 'rgba(100, 60, 50, 0.3)';
        const spotSize = Math.min(width, height) * 0.013;
        const spots = [
            { x: centerX - bodyLength * 0.1, y: centerY - bodyHeight * 0.2, r: spotSize },
            { x: centerX + bodyLength * 0.05, y: centerY - bodyHeight * 0.25, r: spotSize * 0.77 },
            { x: centerX - bodyLength * 0.2, y: centerY - bodyHeight * 0.15, r: spotSize * 0.92 },
            { x: centerX + bodyLength * 0.15, y: centerY - bodyHeight * 0.3, r: spotSize * 0.62 },
        ];
        spots.forEach(spot => {
            this.ctx.beginPath();
            this.ctx.arc(spot.x, spot.y, spot.r, 0, Math.PI * 2);
            this.ctx.fill();
        });

        // Tail (animated with discrete positions)
        const tailBaseX = tailX;
        const tailBaseY = centerY;
        const tailTipX = tailBaseX - width * 0.125;
        const tailPositions = [-height * 0.083, -height * 0.033, 0, height * 0.033, height * 0.083];
        const tailSwing = tailPositions[this.tailPosition];

        this.ctx.fillStyle = '#c4816b';
        this.ctx.beginPath();
        this.ctx.moveTo(tailBaseX, tailBaseY - bodyHeight * 0.2);
        this.ctx.quadraticCurveTo(
            tailTipX + width * 0.0375, tailBaseY - height * 0.117 + tailSwing,
            tailTipX, tailBaseY - height * 0.133 + tailSwing
        );
        this.ctx.lineTo(tailTipX + width * 0.025, tailBaseY + tailSwing);
        this.ctx.quadraticCurveTo(
            tailTipX + width * 0.0375, tailBaseY + height * 0.117 + tailSwing,
            tailBaseX, tailBaseY + bodyHeight * 0.2
        );
        this.ctx.closePath();
        this.ctx.fill();

        // Dorsal fin
        this.ctx.fillStyle = '#b57562';
        this.ctx.beginPath();
        this.ctx.moveTo(centerX - bodyLength * 0.05, centerY - bodyHeight * 0.5);
        this.ctx.lineTo(centerX, centerY - bodyHeight * 0.7);
        this.ctx.lineTo(centerX + bodyLength * 0.1, centerY - bodyHeight * 0.5);
        this.ctx.closePath();
        this.ctx.fill();

        // Pectoral fin
        this.ctx.fillStyle = 'rgba(181, 117, 98, 0.7)';
        this.ctx.beginPath();
        this.ctx.ellipse(
            centerX + bodyLength * 0.15,
            centerY + bodyHeight * 0.3,
            width * 0.0375,
            height * 0.027,
            -0.5,
            0,
            Math.PI * 2
        );
        this.ctx.fill();

        // Eye
        const eyeX = centerX + bodyLength * 0.28;
        const eyeY = centerY - bodyHeight * 0.25;
        const eyeSize = Math.min(width, height) * 0.033;

        this.ctx.fillStyle = '#ffffff';
        this.ctx.beginPath();
        this.ctx.arc(eyeX, eyeY, eyeSize, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = '#000000';
        this.ctx.beginPath();
        this.ctx.arc(eyeX + eyeSize * 0.1, eyeY, eyeSize * 0.6, 0, Math.PI * 2);
        this.ctx.fill();

        // Highlight in eye
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        this.ctx.beginPath();
        this.ctx.arc(eyeX + eyeSize * 0.2, eyeY - eyeSize * 0.2, eyeSize * 0.2, 0, Math.PI * 2);
        this.ctx.fill();

        // Mouth (animated - wide opening)
        const mouthX = centerX + bodyLength * 0.35;
        const mouthY = centerY;
        const mouthOpen = this.mouthState * height * 0.15;
        const mouthScale = Math.min(width, height);

        // Open mouth cavity (when open)
        if (this.mouthState > 0.3) {
            this.ctx.save();
            this.ctx.fillStyle = '#4a2818';
            this.ctx.beginPath();
            this.ctx.ellipse(
                mouthX + width * 0.0125,
                mouthY,
                width * 0.03,
                mouthOpen / 2,
                0,
                0,
                Math.PI * 2
            );
            this.ctx.fill();
            this.ctx.restore();
        }

        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = mouthScale * 0.01;
        this.ctx.lineCap = 'round';

        // Upper jaw
        this.ctx.beginPath();
        this.ctx.moveTo(mouthX - width * 0.02, mouthY - mouthOpen / 2 - height * 0.01);
        this.ctx.lineTo(mouthX + width * 0.05, mouthY - mouthOpen / 2);
        this.ctx.stroke();

        // Lower jaw
        this.ctx.beginPath();
        this.ctx.moveTo(mouthX - width * 0.02, mouthY + mouthOpen / 2 + height * 0.01);
        this.ctx.lineTo(mouthX + width * 0.05, mouthY + mouthOpen / 2);
        this.ctx.stroke();

        // Mechanical servo indicators
        if (this.isPlaying) {
            this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
            this.ctx.lineWidth = mouthScale * 0.003;
            this.ctx.setLineDash([mouthScale * 0.01, mouthScale * 0.01]);

            // Mouth servo
            this.ctx.beginPath();
            this.ctx.arc(mouthX - width * 0.025, mouthY, mouthScale * 0.013, 0, Math.PI * 2);
            this.ctx.stroke();

            // Tail servo
            this.ctx.beginPath();
            this.ctx.arc(tailBaseX, tailBaseY, mouthScale * 0.013, 0, Math.PI * 2);
            this.ctx.stroke();

            this.ctx.setLineDash([]);
        }
        this.ctx.restore();
    }

    public startPlaying(): void {
        this.isPlaying = true;
        this.scheduleNextTransition();
        this.scheduleNextTailTransition();
        if (!this.animationFrame) {
            this.animate();
        }
    }

    private scheduleNextTailTransition(): void {
        this.nextTailTransition = this.transitionTimer + Math.random() * 200 + 150;
    }

    public stopPlaying(): void {
        this.isPlaying = false;
        this.mouthState = 0;
        this.tailPosition = 2;
        this.glitchIntensity = 0;
        this.glitchOffset = { x: 0, y: 0 };
    }

    private scheduleNextTransition(): void {
        this.nextTransitionTime = this.transitionTimer + Math.random() * 1000 + 500;
    }

    private pickRandomMouthState(): void {
        const states = [0, 0.3, 0.6, 1];
        this.mouthState = states[Math.floor(Math.random() * states.length)];
        this.scheduleNextTransition();
    }

    private updateDrift(): void {
        this.driftFrameCounter++;
        const stepSize = 5

        if (this.driftFrameCounter % stepSize !== 0) {
            return;
        }

        this.driftTime += 0.016 * stepSize;

        const dx = this.driftTarget.x - this.driftOffset.x;
        const dy = this.driftTarget.y - this.driftOffset.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const easeStrength = 0.007;
        this.driftVelocity.x += dx * easeStrength;
        this.driftVelocity.y += dy * easeStrength;

        this.driftVelocity.x *= 0.96;
        this.driftVelocity.y *= 0.96;

        this.driftOffset.x += this.driftVelocity.x;
        this.driftOffset.y += this.driftVelocity.y;

        if (distance < 3 || this.driftTime > 12) {
            this.pickNewDriftTarget();
            this.driftTime = 0;
        }
    }

    private updateCassetteTargetWithDrift(): void {
        if (!this.cassetteTargetPosition) return;

        if (this.cassetteTargetType === 'salmon') {
            const canvasRect = this.canvas.getBoundingClientRect();
            // driftOffset is already in canvas logical coordinates, just add it directly
            this.cassetteTargetPosition.x = canvasRect.left + canvasRect.width * 0.7 + this.driftOffset.x;
            this.cassetteTargetPosition.y = canvasRect.top + canvasRect.height * 0.5 + this.driftOffset.y;
        } else if (this.cassetteTargetType === 'element' && this.cassetteTargetElement) {
            const targetRect = this.cassetteTargetElement.getBoundingClientRect();
            this.cassetteTargetPosition.x = targetRect.left + targetRect.width * 0.5;
            this.cassetteTargetPosition.y = targetRect.top + targetRect.height * 0.5;
        }
    }

    private animate = (): void => {
        if (this.isPlaying) {
            this.transitionTimer += 16;

            if (this.transitionTimer >= this.nextTransitionTime) {
                this.pickRandomMouthState();
                this.glitchIntensity = Math.random();
                this.glitchOffset = {
                    x: (Math.random() - 0.5) * 6,
                    y: (Math.random() - 0.5) * 6
                };
            }

            if (this.transitionTimer >= this.nextTailTransition) {
                this.tailPosition = Math.floor(Math.random() * 5);
                this.scheduleNextTailTransition();
            }
        } else {
            this.glitchOffset.x *= 0.9;
            this.glitchOffset.y *= 0.9;
            this.glitchIntensity *= 0.9;
        }

        this.updateDrift();

        if (this.cassetteInTransit && this.cassetteTargetPosition) {
            this.updateCassetteTargetWithDrift();

            const dx = this.cassetteTargetPosition.x - this.cassettePosition.x;
            const dy = this.cassetteTargetPosition.y - this.cassettePosition.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 5) {
                this.cassetteInTransit = false;
                this.cassetteTargetPosition = null;
                this.cassetteTargetType = null;
                this.cassetteTargetElement = null;
            } else {
                // Update velocity to track the moving target
                const speed = 6;
                this.cassetteVelocity.x = (dx / distance) * speed;
                this.cassetteVelocity.y = (dy / distance) * speed;

                this.cassettePosition.x += this.cassetteVelocity.x;
                this.cassettePosition.y += this.cassetteVelocity.y;
            }
        }

        this.drawSalmon();

        this.animationFrame = requestAnimationFrame(this.animate);
    };

    public async openHeadAndEjectCassette(targetElement: HTMLElement): Promise<void> {
        this.headOpen = true;
        if (!this.animationFrame) {
            this.animate();
        }

        this.mouthState = 0.6;
        await this.sleep(200);
        this.mouthState = 1;
        await this.sleep(300);

        const canvasRect = this.canvas.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();

        const startX = canvasRect.left + canvasRect.width * 0.7 + this.driftOffset.x;
        const startY = canvasRect.top + canvasRect.height * 0.5 + this.driftOffset.y;
        const endX = targetRect.left + targetRect.width * 0.5;
        const endY = targetRect.top + targetRect.height * 0.5;

        this.startCassetteTransit(startX, startY, endX, endY, 'element', targetElement);

        await this.waitForCassetteTransit();
        await this.sleep(100);

        this.mouthState = 0.6;
        await this.sleep(200);
        this.mouthState = 0;
        await this.sleep(100);

        this.headOpen = false;
    }

    public async insertCassetteAndCloseHead(color: string, sourceElement: HTMLElement): Promise<void> {
        this.cassetteColor = color;
        this.headOpen = true;
        if (!this.animationFrame) {
            this.animate();
        }

        this.mouthState = 0.6;
        await this.sleep(200);
        this.mouthState = 1;
        await this.sleep(300);

        const canvasRect = this.canvas.getBoundingClientRect();
        const sourceRect = sourceElement.getBoundingClientRect();

        const startX = sourceRect.left + sourceRect.width * 0.5;
        const startY = sourceRect.top + sourceRect.height * 0.5;
        const endX = canvasRect.left + canvasRect.width * 0.7 + this.driftOffset.x;
        const endY = canvasRect.top + canvasRect.height * 0.5 + this.driftOffset.y;

        this.startCassetteTransit(startX, startY, endX, endY, 'salmon', null);

        await this.waitForCassetteTransit();
        await this.sleep(100);

        this.mouthState = 0.6;
        await this.sleep(200);
        this.mouthState = 0;
        await this.sleep(100);

        this.headOpen = false;
    }

    private startCassetteTransit(startX: number, startY: number, endX: number, endY: number, targetType: 'salmon' | 'element', targetElement: HTMLElement | null): void {
        this.cassettePosition = { x: startX, y: startY };
        this.cassetteTargetPosition = { x: endX, y: endY };
        this.cassetteTargetType = targetType;
        this.cassetteTargetElement = targetElement;

        const dx = endX - startX;
        const dy = endY - startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const speed = 6;

        this.cassetteVelocity = {
            x: (dx / distance) * speed,
            y: (dy / distance) * speed
        };

        this.cassetteInTransit = true;
    }

    private async waitForCassetteTransit(): Promise<void> {
        while (this.cassetteInTransit) {
            await this.sleep(16);
        }
    }

    public drawCassette(ctx: CanvasRenderingContext2D): void {
        if (!this.cassetteInTransit) return;

        const scale = 1.2;
        const width = 40 * scale;
        const height = 25 * scale;

        ctx.save();
        ctx.fillStyle = this.cassetteColor;
        ctx.fillRect(this.cassettePosition.x - width / 2, this.cassettePosition.y - height / 2, width, height);

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(this.cassettePosition.x - width / 2, this.cassettePosition.y - height / 2, width, height);

        const wheelRadius = 6 * scale;
        const wheelOffset = 12 * scale;

        ctx.fillStyle = '#666666';
        ctx.beginPath();
        ctx.arc(this.cassettePosition.x - wheelOffset, this.cassettePosition.y, wheelRadius, 0, Math.PI * 2);
        ctx.arc(this.cassettePosition.x + wheelOffset, this.cassettePosition.y, wheelRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#222222';
        ctx.beginPath();
        ctx.arc(this.cassettePosition.x - wheelOffset, this.cassettePosition.y, wheelRadius / 2, 0, Math.PI * 2);
        ctx.arc(this.cassettePosition.x + wheelOffset, this.cassettePosition.y, wheelRadius / 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Cassette player controller
class CassettePlayer {
    private audio: HTMLAudioElement;
    private source: HTMLSourceElement;
    private salmon: AnimatronicSalmon;
    private currentHymn: string | null = null;

    constructor(salmon: AnimatronicSalmon) {
        this.salmon = salmon;
        this.audio = document.getElementById('hymn-audio') as HTMLAudioElement;
        this.source = document.getElementById('hymn-source') as HTMLSourceElement;

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        document.querySelectorAll('.hymn-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const hymnId = item.getAttribute('data-hymn');
                const hymnTitle = item.getAttribute('data-title');
                const isLocked = item.classList.contains('locked');

                if (isLocked) {
                    this.showLockedMessage(item as HTMLElement);
                } else if (hymnId && hymnTitle) {
                    this.loadCassette(hymnId, hymnTitle, item as HTMLElement);
                }
            });
        });

        const playPauseBtn = document.getElementById('play-pause-btn');
        playPauseBtn?.addEventListener('click', () => this.togglePlayPause());

        const loopBtn = document.getElementById('loop-btn');
        loopBtn?.addEventListener('click', () => this.toggleLoop());

        this.audio.addEventListener('play', () => {
            this.salmon.startPlaying();
            if (playPauseBtn) playPauseBtn.textContent = '⏸';
        });

        this.audio.addEventListener('pause', () => {
            this.salmon.stopPlaying();
            if (playPauseBtn) playPauseBtn.textContent = '▶';
        });

        this.audio.addEventListener('ended', () => {
            this.salmon.stopPlaying();
            if (!this.audio.loop && playPauseBtn) playPauseBtn.textContent = '▶';
        });
    }

    private showLockedMessage(item: HTMLElement): void {
        item.style.animation = 'shake 0.5s';
        setTimeout(() => {
            item.style.animation = '';
        }, 500);

        if (typeof window !== 'undefined' && (window as any).bibEffects) {
            (window as any).bibEffects.showLockPopup(item);
        }
    }

    private async loadCassette(hymnId: string, hymnTitle: string, hymnElement: HTMLElement): Promise<void> {
        const cassetteColors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
            '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'
        ];
        const randomColor = cassetteColors[Math.floor(Math.random() * cassetteColors.length)];

        if (this.currentHymn) {
            const currentElement = document.querySelector(`[data-title="${this.currentHymn}"]`) as HTMLElement;
            if (currentElement) {
                await this.salmon.openHeadAndEjectCassette(currentElement);
            }
        }

        await this.salmon.insertCassetteAndCloseHead(randomColor, hymnElement);

        this.currentHymn = hymnTitle;
        this.source.src = `/audio/${hymnId}.mp3`;
        this.audio.load();

        document.getElementById('current-hymn-display')!.textContent = hymnTitle;
        (document.getElementById('play-pause-btn') as HTMLButtonElement).disabled = false;
    }

    private togglePlayPause(): void {
        if (this.audio.paused) {
            this.audio.play();
        } else {
            this.audio.pause();
        }
    }

    private toggleLoop(): void {
        this.audio.loop = !this.audio.loop;
        const loopBtn = document.getElementById('loop-btn');
        if (loopBtn) {
            if (this.audio.loop) {
                loopBtn.classList.add('active');
                loopBtn.title = 'Loop enabled';
            } else {
                loopBtn.classList.remove('active');
                loopBtn.title = 'Loop disabled';
            }
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Convert AsciiDoc formatting to HTML
function formatAsciidoc(text: string): string {
    return text
        // Convert _italic_ to <em>
        .replace(/_([^_]+)_/g, '<em>$1</em>')
        // Remove [.nocase]# markers but keep the text
        .replace(/\[\.nocase\]#([^#]+)#/g, '$1')
        // Convert ++[++ and ++]++ to literal brackets
        .replace(/\+\+\[\+\+/g, '[')
        .replace(/\+\+\]\+\+/g, ']')
        // Make URLs clickable
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

// Load bibliography data
async function loadBibliography(): Promise<void> {
    try {
        const response = await fetch('/data/bibliography.json');
        const entries = await response.json();

        const container = document.getElementById('bibliography-container');
        if (!container) return;

        container.innerHTML = entries
            .map((entry: { id: string; citation: string }) => {
                const formattedCitation = formatAsciidoc(entry.citation);
                return `<div class="bib-entry" id="bib-${entry.id}">
          <div class="bib-citation">${formattedCitation}</div>
        </div>`;
            })
            .join('');
    } catch (error) {
        console.error('Failed to load bibliography:', error);
        const container = document.getElementById('bibliography-container');
        if (container) {
            container.innerHTML = '<p style="color: red;">Failed to load bibliography data.</p>';
        }
    }
}

// Global cassette overlay
class CassetteOverlay {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private salmon: AnimatronicSalmon | null = null;

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'fixed';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '9999';
        document.body.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d')!;
        this.setupCanvas();
        this.animate();

        window.addEventListener('resize', () => this.setupCanvas());
    }

    private setupCanvas(): void {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    setSalmon(salmon: AnimatronicSalmon): void {
        this.salmon = salmon;
    }

    private animate = (): void => {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.salmon) {
            this.salmon.drawCassette(this.ctx);
        }

        requestAnimationFrame(this.animate);
    };
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    try {
        const pageVersion = document.querySelector('meta[name="page-version"]')?.getAttribute('content');
        if (pageVersion) {
            console.log('[Supplement] Page version:', pageVersion);
        }

        const overlay = new CassetteOverlay();
        const salmon = new AnimatronicSalmon('salmon-canvas');
        overlay.setSalmon(salmon);
        const player = new CassettePlayer(salmon);
        loadBibliography();
    } catch (error) {
        console.error('Failed to initialize:', error);
    }
});
