import { createForeignObject } from '../utils/svgHelpers.js';

export interface UIManagerConfig {
    canvasWidth: number;
    canvasHeight: number;
    setMode: (mode: 'panorama' | 'foreground') => void;
    onFullscreenToggle: () => void;
    onAnimationPauseToggle: () => void;
    onDownloadSession?: () => void;
}

export class UIManager {
    private container: HTMLElement;
    private svgElement: SVGSVGElement;
    private uiGroup: SVGGElement;
    private config: UIManagerConfig;

    private modeToggleContainer: HTMLElement | null = null;
    private mobileBanner: HTMLElement | null = null;
    private mobileBannerSize: { w: number; h: number } | null = null;
    private commLogPanel: HTMLElement | null = null;
    private commLogVisible: boolean = false;
    private commLogEntries: string[] = [];
    private debugPauseButton: HTMLButtonElement | null = null;
    private recordingOverlay: SVGGElement | null = null;
    private isFullscreen: boolean = false;
    private animationPaused: boolean = false;

    constructor(
        container: HTMLElement,
        svgElement: SVGSVGElement,
        uiGroup: SVGGElement,
        config: UIManagerConfig
    ) {
        this.container = container;
        this.svgElement = svgElement;
        this.uiGroup = uiGroup;
        this.config = config;
    }

    createAllUI(): void {
        this.createModeToggle();
        this.createFullscreenButton();
        this.createCommLogButton();
        this.createCommLogPanel();
        this.createDebugPauseButton();
    }

    updateDimensions(width: number, height: number): void {
        this.config.canvasWidth = width;
        this.config.canvasHeight = height;
        this.updateModeTogglePosition();
        this.updateRecordingOverlayPosition();
    }

    // Mode toggle

    private createModeToggle(): void {
        const foreignObject = createForeignObject(this.config.canvasWidth - 42, 10, 32, 32);
        foreignObject.classList.add('mode-toggle-fo');

        this.modeToggleContainer = document.createElement('button');
        this.modeToggleContainer.className = 'zoom-toggle-btn';
        this.modeToggleContainer.innerHTML = '🔍';
        this.modeToggleContainer.title = 'Panorama view — click to focus';
        this.modeToggleContainer.addEventListener('click', () => {
            const isForeground = this.modeToggleContainer?.classList.contains('focused');
            this.config.setMode(isForeground ? 'panorama' : 'foreground');
        });

        foreignObject.appendChild(this.modeToggleContainer);
        this.uiGroup.appendChild(foreignObject);
    }

    setMode(mode: 'panorama' | 'foreground'): void {
        if (!this.modeToggleContainer) return;
        const isForeground = mode === 'foreground';
        this.modeToggleContainer.innerHTML = isForeground ? '🔭' : '🔍';
        this.modeToggleContainer.title = isForeground
            ? 'Focus view — click for panorama'
            : 'Panorama view — click to focus';
        this.modeToggleContainer.classList.toggle('focused', isForeground);
    }

    simulateModeToggleClick(): void {
        this.modeToggleContainer?.click();
    }

    private updateModeTogglePosition(): void {
        const modeToggleFo = this.uiGroup.querySelector('.mode-toggle-fo');
        if (modeToggleFo) {
            modeToggleFo.setAttribute('x', String(this.config.canvasWidth - 42));
        }

    }

    // Fullscreen

    private createFullscreenButton(): void {
        this.createMobileBanner();
        this.createFullscreenToggleButton();
    }

    private createFullscreenToggleButton(): void {
        const foreignObject = createForeignObject(10, 10, 32, 32);
        foreignObject.classList.add('fullscreen-toggle-fo');

        const btn = document.createElement('button');
        btn.className = 'zoom-toggle-btn';
        btn.innerHTML = '⛶';
        btn.title = 'Toggle fullscreen';
        btn.addEventListener('click', () => this.config.onFullscreenToggle());

        foreignObject.appendChild(btn);
        this.uiGroup.appendChild(foreignObject);
    }

    private createMobileBanner(): void {
        if (!this.isMobileDevice()) return;

        this.mobileBanner = document.createElement('div');
        this.mobileBanner.className = 'mobile-fullscreen-banner';
        this.mobileBanner.innerHTML = `
            <div class="banner-content">
                <div class="rotation-prompt">
                    <span class="rotation-icon">📱</span>
                    <span class="rotation-text">Rotate to landscape</span>
                    <span class="rotation-check">✓</span>
                </div>
                <button class="enter-fullscreen-btn">Enter Fullscreen</button>
            </div>
        `;

        const enterBtn = this.mobileBanner.querySelector('.enter-fullscreen-btn');
        enterBtn?.addEventListener('click', () => this.config.onFullscreenToggle());

        this.mobileBanner.style.maxWidth = '320px';
        this.mobileBanner.style.width = 'max-content';
        this.mobileBanner.style.height = 'fit-content';
        document.body.appendChild(this.mobileBanner);
        this.updateOrientationIndicator();
        this.updateBannerPosition();

        const onUpdate = () => { this.updateOrientationIndicator(); this.updateBannerPosition(); };
        window.addEventListener('orientationchange', onUpdate);
        window.addEventListener('resize', onUpdate);
        window.visualViewport?.addEventListener('resize', onUpdate);
        window.visualViewport?.addEventListener('scroll', onUpdate);
    }

    private isMobileDevice(): boolean {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
            || ('ontouchstart' in window);
    }

    private updateOrientationIndicator(): void {
        if (!this.mobileBanner) return;

        const isLandscape = window.innerWidth > window.innerHeight;
        const check = this.mobileBanner.querySelector('.rotation-check') as HTMLElement;
        const text = this.mobileBanner.querySelector('.rotation-text') as HTMLElement;
        const btn = this.mobileBanner.querySelector('.enter-fullscreen-btn') as HTMLButtonElement;

        if (check && text) {
            if (isLandscape) {
                check.style.display = 'inline';
                text.textContent = 'Landscape ';
            } else {
                check.style.display = 'none';
                text.textContent = 'Rotate to landscape';
            }
        }

        if (btn) {
            btn.disabled = !isLandscape;
        }
    }

    private updateBannerPosition(): void {
        if (!this.mobileBanner) return;
        const vv = window.visualViewport;
        if (!vv) return;
        // position:fixed uses visual px. Center banner on the visual viewport center.
        const cx = vv.offsetLeft + vv.width / 2;
        const cy = vv.offsetTop + vv.height / 2;
        if (!this.mobileBannerSize) {
            this.mobileBannerSize = { w: this.mobileBanner.offsetWidth, h: this.mobileBanner.offsetHeight };
        }
        const { w, h } = this.mobileBannerSize;
        this.mobileBanner.style.left = `${cx - w / 2}px`;
        this.mobileBanner.style.top = `${cy - h / 2}px`;
    }

setFullscreen(isFullscreen: boolean): void {
        this.isFullscreen = isFullscreen;

        if (isFullscreen) {
            document.body.classList.add('ifs-fullscreen');
            this.container.classList.add('fullscreen-active');
            if (this.mobileBanner) {
                this.mobileBanner.style.display = 'none';
            }
        } else {
            document.body.classList.remove('ifs-fullscreen');
            this.container.classList.remove('fullscreen-active');
            if (this.mobileBanner) {
                this.mobileBanner.style.display = 'flex';
            }
        }
    }

    getIsFullscreen(): boolean {
        return this.isFullscreen;
    }

    isMobile(): boolean {
        return this.isMobileDevice();
    }

    isLandscape(): boolean {
        return window.innerWidth > window.innerHeight;
    }

    // Communication log

    private createCommLogButton(): void {
        const foreignObject = createForeignObject(52, 10, 64, 32);
        foreignObject.classList.add('comm-log-toggle-fo');

        const btn = document.createElement('button');
        btn.className = 'zoom-toggle-btn';
        btn.textContent = '📜';
        btn.title = 'Show communication log';
        btn.addEventListener('click', () => this.toggleCommLog());

        foreignObject.appendChild(btn);
        this.uiGroup.appendChild(foreignObject);
    }

    private createCommLogPanel(): void {
        this.commLogPanel = document.createElement('div');
        this.commLogPanel.className = 'comm-log-panel';
        this.commLogPanel.style.display = 'none';

        const header = document.createElement('div');
        header.className = 'comm-log-header';
        header.textContent = 'Communication Log';
        this.commLogPanel.appendChild(header);

        const content = document.createElement('div');
        content.className = 'comm-log-content';
        this.commLogPanel.appendChild(content);

        this.container.appendChild(this.commLogPanel);
    }

    private toggleCommLog(): void {
        this.commLogVisible = !this.commLogVisible;
        if (this.commLogPanel) {
            this.commLogPanel.style.display = this.commLogVisible ? 'block' : 'none';
            if (this.commLogVisible) {
                this.renderCommLog();
            }
        }
    }

    private renderCommLog(): void {
        if (!this.commLogPanel) return;
        const content = this.commLogPanel.querySelector('.comm-log-content')!;
        content.innerHTML = '';
        for (const entry of this.commLogEntries) {
            const line = document.createElement('div');
            line.className = 'comm-log-entry';
            line.textContent = entry;
            content.appendChild(line);
        }
        content.scrollTop = content.scrollHeight;
    }

    appendCommLog(entry: string): void {
        this.commLogEntries.push(entry);
        if (!this.commLogVisible || !this.commLogPanel) return;
        const content = this.commLogPanel.querySelector('.comm-log-content')!;
        const line = document.createElement('div');
        line.className = 'comm-log-entry';
        line.textContent = entry;
        content.appendChild(line);
        content.scrollTop = content.scrollHeight;
    }

    setCommLogPointerEventsEnabled(enabled: boolean): void {
        if (this.commLogPanel) {
            this.commLogPanel.style.pointerEvents = enabled ? '' : 'none';
        }
    }

    // Debug pause button

    private createDebugPauseButton(): void {
        if (this.debugPauseButton) return;

        const btn = document.createElement('button');
        btn.textContent = '⏸';
        btn.style.cssText = `
            position: absolute;
            bottom: 10px;
            left: 10px;
            z-index: 40;
            padding: 6px 10px;
            font-size: 16px;
            background: #ff6b6b;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;

        btn.addEventListener('click', () => this.config.onAnimationPauseToggle());

        let longPressTimer: number | null = null;
        btn.addEventListener('touchstart', () => {
            longPressTimer = window.setTimeout(() => {
                if (this.config.onDownloadSession) {
                    this.config.onDownloadSession();
                }
                longPressTimer = null;
            }, 2000);
        });
        btn.addEventListener('touchend', () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        });

        let hovered = false;
        btn.addEventListener('mouseenter', () => { hovered = true; });
        btn.addEventListener('mouseleave', () => { hovered = false; });
        document.addEventListener('keydown', (e) => {
            if (hovered && e.key === 'r') {
                e.preventDefault();
                this.config.onDownloadSession?.();
            }
        });

        this.container.appendChild(btn);
        this.debugPauseButton = btn;
    }

    setAnimationPaused(paused: boolean): void {
        this.animationPaused = paused;
        if (this.debugPauseButton) {
            if (paused) {
                this.debugPauseButton.textContent = '▶';
                this.debugPauseButton.style.background = '#51cf66';
            } else {
                this.debugPauseButton.textContent = '⏸';
                this.debugPauseButton.style.background = '#ff6b6b';
            }
        }
        this.svgElement.classList.toggle('master-paused', paused);
    }

    isAnimationPaused(): boolean {
        return this.animationPaused;
    }

    // Recording overlay

    showRecording(): void {
        if (this.recordingOverlay) return;

        this.recordingOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.recordingOverlay.setAttribute('pointer-events', 'none');

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(this.config.canvasWidth / 2));
        text.setAttribute('y', String(this.config.canvasHeight / 2));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('font-size', '48');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('fill', 'rgba(255, 0, 0, 0.15)');
        text.setAttribute('transform', `rotate(-15, ${this.config.canvasWidth / 2}, ${this.config.canvasHeight / 2})`);
        text.style.userSelect = 'none';
        text.textContent = 'RECORDING SESSION';

        this.recordingOverlay.appendChild(text);
        this.svgElement.insertBefore(this.recordingOverlay, this.svgElement.firstChild);
    }

    hideRecording(): void {
        if (this.recordingOverlay) {
            this.recordingOverlay.remove();
            this.recordingOverlay = null;
        }
    }

    private updateRecordingOverlayPosition(): void {
        if (!this.recordingOverlay) return;
        const text = this.recordingOverlay.querySelector('text');
        if (text) {
            text.setAttribute('x', String(this.config.canvasWidth / 2));
            text.setAttribute('y', String(this.config.canvasHeight / 2));
            text.setAttribute('transform', `rotate(-15, ${this.config.canvasWidth / 2}, ${this.config.canvasHeight / 2})`);
        }
    }
}
