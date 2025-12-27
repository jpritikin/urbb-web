import { createForeignObject } from './svgHelpers.js';

export interface UIManagerConfig {
    canvasWidth: number;
    canvasHeight: number;
    onModeToggle: (isForeground: boolean) => void;
    onFullscreenToggle: () => void;
    onAnimationPauseToggle: () => void;
    onTracePanelToggle: () => void;
    onRecordingToggle?: () => void;
}

export class UIManager {
    private container: HTMLElement;
    private svgElement: SVGSVGElement;
    private uiGroup: SVGGElement;
    private config: UIManagerConfig;

    private modeToggleContainer: HTMLElement | null = null;
    private mobileBanner: HTMLElement | null = null;
    private tracePanel: HTMLElement | null = null;
    private traceVisible: boolean = false;
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
        this.createTraceButton();
        this.createTracePanel();
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
            this.config.onModeToggle(!isForeground);
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

    private updateModeTogglePosition(): void {
        const modeToggleFo = this.uiGroup.querySelector('.mode-toggle-fo');
        if (modeToggleFo) {
            modeToggleFo.setAttribute('x', String(this.config.canvasWidth - 42));
        }

        const fullscreenFo = this.uiGroup.querySelector('.fullscreen-toggle-fo');
        if (fullscreenFo) {
            fullscreenFo.setAttribute('x', String(this.config.canvasWidth - 84));
        }
    }

    // Fullscreen

    private createFullscreenButton(): void {
        this.createMobileBanner();
        this.createFullscreenToggleButton();
    }

    private createFullscreenToggleButton(): void {
        const foreignObject = createForeignObject(this.config.canvasWidth - 84, 10, 32, 32);
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

        this.container.appendChild(this.mobileBanner);
        this.updateOrientationIndicator();

        window.addEventListener('orientationchange', () => this.updateOrientationIndicator());
        window.addEventListener('resize', () => this.updateOrientationIndicator());
    }

    private isMobileDevice(): boolean {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
            || (window.innerWidth <= 800 && 'ontouchstart' in window);
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

    // Trace panel

    private createTraceButton(): void {
        const btn = document.createElement('button');
        btn.className = 'trace-toggle-btn';
        btn.textContent = '📜 Trace';
        btn.title = 'Show state change history';
        btn.addEventListener('click', () => this.config.onTracePanelToggle());
        this.container.appendChild(btn);
    }

    private createTracePanel(): void {
        this.tracePanel = document.createElement('div');
        this.tracePanel.className = 'trace-panel';
        this.tracePanel.style.display = 'none';

        const header = document.createElement('div');
        header.className = 'trace-header';

        const title = document.createElement('span');
        title.textContent = 'State History';
        header.appendChild(title);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'trace-copy-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => this.copyTraceToClipboard());
        header.appendChild(copyBtn);

        this.tracePanel.appendChild(header);

        const content = document.createElement('pre');
        content.className = 'trace-content';
        this.tracePanel.appendChild(content);

        this.container.appendChild(this.tracePanel);
    }

    toggleTracePanel(): void {
        this.traceVisible = !this.traceVisible;
        if (this.tracePanel) {
            this.tracePanel.style.display = this.traceVisible ? 'block' : 'none';
        }
    }

    isTracePanelVisible(): boolean {
        return this.traceVisible;
    }

    updateTrace(trace: string): void {
        if (!this.tracePanel || !this.traceVisible) return;
        const content = this.tracePanel.querySelector('.trace-content');
        if (content) {
            content.textContent = trace;
        }
    }

    private copyTraceToClipboard(): void {
        const content = this.tracePanel?.querySelector('.trace-content');
        if (!content?.textContent) return;

        navigator.clipboard.writeText(content.textContent);

        const copyBtn = this.tracePanel?.querySelector('.trace-copy-btn');
        if (copyBtn) {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 1000);
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
                if (this.config.onRecordingToggle) {
                    this.config.onRecordingToggle();
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
