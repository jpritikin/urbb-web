export interface FullscreenCallbacks {
    onResize: (width: number, height: number) => void;
    getIsFullscreen: () => boolean;
    setFullscreen: (value: boolean) => void;
    isMobile: () => boolean;
    isLandscape: () => boolean;
}

export class FullscreenManager {
    private container: HTMLElement;
    private svgElement: SVGSVGElement;
    private callbacks: FullscreenCallbacks;
    private originalWidth: number;
    private originalHeight: number;
    private resizeDebounceTimer: number | null = null;
    private fullscreenTransitioning: boolean = false;

    constructor(
        container: HTMLElement,
        svgElement: SVGSVGElement,
        originalWidth: number,
        originalHeight: number,
        callbacks: FullscreenCallbacks
    ) {
        this.container = container;
        this.svgElement = svgElement;
        this.originalWidth = originalWidth;
        this.originalHeight = originalHeight;
        this.callbacks = callbacks;
    }

    setup(): void {
        document.addEventListener('fullscreenchange', () => {
            this.fullscreenTransitioning = true;
            if (document.fullscreenElement) {
                this.callbacks.setFullscreen(true);
                this.requestLandscapeOrientation();
            } else {
                this.callbacks.setFullscreen(false);
                this.unlockOrientation();
            }
            this.scheduleResize();
        });

        window.addEventListener('resize', () => {
            if (this.fullscreenTransitioning || this.callbacks.getIsFullscreen()) {
                if (this.callbacks.getIsFullscreen() && !this.callbacks.isLandscape() && this.callbacks.isMobile()) {
                    this.exit();
                    return;
                }
                this.scheduleResize();
            }
        });
    }

    private scheduleResize(): void {
        const isFullscreen = this.callbacks.getIsFullscreen();
        if (this.resizeDebounceTimer !== null) {
            cancelAnimationFrame(this.resizeDebounceTimer);
            console.log('[Resize] debounce cancelled (superseded)');
        }
        console.log(`[Resize] scheduled (fullscreen: ${isFullscreen})`);
        this.resizeDebounceTimer = requestAnimationFrame(() => {
            this.resizeDebounceTimer = requestAnimationFrame(() => {
                this.resizeDebounceTimer = null;
                this.fullscreenTransitioning = false;
                if (this.callbacks.getIsFullscreen()) {
                    this.resizeToViewport();
                } else {
                    this.restoreSize();
                }
            });
        });
    }

    async toggle(): Promise<void> {
        if (this.callbacks.getIsFullscreen()) {
            await this.exit();
        } else {
            await this.enter();
        }
    }

    async enter(): Promise<void> {
        if (!this.callbacks.isLandscape() && this.callbacks.isMobile()) {
            return;
        }

        try {
            await this.container.requestFullscreen();
        } catch {
            this.enterMode();
        }
    }

    private enterMode(): void {
        this.callbacks.setFullscreen(true);
        this.requestLandscapeOrientation();
        this.scheduleResize();
    }

    async exit(): Promise<void> {
        if (document.fullscreenElement) {
            await document.exitFullscreen();
        } else {
            this.exitMode();
        }
    }

    private exitMode(): void {
        this.callbacks.setFullscreen(false);
        this.unlockOrientation();
        this.scheduleResize();
    }

    private requestLandscapeOrientation(): void {
        const screen = window.screen as Screen & {
            orientation?: { lock?: (orientation: string) => Promise<void> };
        };
        screen.orientation?.lock?.('landscape').catch(() => {});
    }

    private unlockOrientation(): void {
        const screen = window.screen as Screen & {
            orientation?: { unlock?: () => void };
        };
        try { screen.orientation?.unlock?.(); } catch {}
    }

    private resizeToViewport(): void {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.svgElement.setAttribute('width', String(width));
        this.svgElement.setAttribute('height', String(height));
        this.svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);

        console.log(`[Resize] applied: ${width}x${height} (viewport)`);
        this.callbacks.onResize(width, height);
    }

    private restoreSize(): void {
        this.svgElement.setAttribute('width', String(this.originalWidth));
        this.svgElement.setAttribute('height', String(this.originalHeight));
        this.svgElement.setAttribute('viewBox', `0 0 ${this.originalWidth} ${this.originalHeight}`);

        console.log(`[Resize] applied: ${this.originalWidth}x${this.originalHeight} (restored)`);
        this.callbacks.onResize(this.originalWidth, this.originalHeight);
    }
}
