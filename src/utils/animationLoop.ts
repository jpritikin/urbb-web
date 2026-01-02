export class AnimationLoop {
    private running: boolean = false;
    private animationFrameId: number | null = null;
    private lastFrameTime: number = 0;
    private onFrame: (deltaTime: number) => void;

    constructor(onFrame: (deltaTime: number) => void) {
        this.onFrame = onFrame;
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.lastFrameTime = performance.now();
        this.tick();
    }

    stop(): void {
        this.running = false;
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    isRunning(): boolean {
        return this.running;
    }

    pause(): void {
        if (this.running) {
            this.stop();
            this.running = true;
        }
    }

    resume(): void {
        if (this.running && this.animationFrameId === null) {
            this.lastFrameTime = performance.now();
            this.tick();
        }
    }

    private tick(): void {
        if (!this.running) return;

        if (document.hidden) {
            this.lastFrameTime = performance.now();
            this.animationFrameId = requestAnimationFrame(() => this.tick());
            return;
        }

        const currentTime = performance.now();
        const deltaTime = Math.min((currentTime - this.lastFrameTime) / 1000, 0.1);
        this.lastFrameTime = currentTime;

        this.onFrame(deltaTime);

        this.animationFrameId = requestAnimationFrame(() => this.tick());
    }

    setupVisibilityHandling(): void {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.pause();
            } else {
                this.resume();
            }
        });
    }
}
