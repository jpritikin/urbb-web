export class AnimationLoop {
    private running: boolean = false;
    private animationFrameId: number | null = null;
    private lastFrameTime: number | null = null;
    private onFrame: (deltaTime: number) => void;

    constructor(onFrame: (deltaTime: number) => void) {
        this.onFrame = onFrame;
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.animationFrameId = requestAnimationFrame((t) => this.tick(t));
    }

    stop(): void {
        this.running = false;
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.lastFrameTime = null;
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
            this.lastFrameTime = null;
            this.animationFrameId = requestAnimationFrame((t) => this.tick(t));
        }
    }

    private tick(timestamp: number): void {
        if (!this.running) return;

        if (document.hidden) {
            this.lastFrameTime = null;
            this.animationFrameId = requestAnimationFrame((t) => this.tick(t));
            return;
        }

        const deltaTime = this.lastFrameTime !== null
            ? Math.min((timestamp - this.lastFrameTime) / 1000, 0.1)
            : 0;
        this.lastFrameTime = timestamp;

        this.onFrame(deltaTime);

        this.animationFrameId = requestAnimationFrame((t) => this.tick(t));
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
