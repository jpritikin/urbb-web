const IS_LOCAL = typeof window !== 'undefined' && window.location.hostname === 'localhost';
const RETICLE_TOP_HAND_X_OFFSET = -10;
const RETICLE_BOTTOM_HAND_X_OFFSET = 10;
const RETICLE_FADE_MS = IS_LOCAL ? 50 : 600;
const HUG_DURATION_MS = IS_LOCAL ? 50 : 400;
const MOVE_BASE_DURATION_MS = IS_LOCAL ? 100 : 900;
const MOVE_BASE_DISTANCE = 300;
const KISS_DURATION_MS = IS_LOCAL ? 200 : 1500;
const KISS_SPEED = 25;

interface DriftingKiss {
    element: SVGTextElement;
    x: number;
    y: number;
    vx: number;
    vy: number;
    rotation: number;
    angularVelocity: number;
    age: number;
}

export class PlaybackReticle {
    private reticleGroup: SVGGElement | null = null;
    private reticleOpacity: number = 0;
    private reticleX: number = 0;
    private reticleY: number = 0;
    private reticleTargetX: number = 0;
    private reticleTargetY: number = 0;
    private reticleVisible: boolean = false;
    private reticleTilt: number = 0;
    private reticleFadeDirection: 'in' | 'out' | 'none' = 'none';
    private hugAnimating: boolean = false;
    private hugProgress: number = 0;
    private hugRelaxFactor: number = 1;
    private fadeProgress: number = 0;
    private fadeOutArcAngle: number = 0;
    private kisses: DriftingKiss[] = [];

    private reticleMoveProgress: number = 1;
    private reticleMoveDuration: number = 0;
    private reticleMoveStartX: number = 0;
    private reticleMoveStartY: number = 0;
    private reticleMoveEndX: number = 0;
    private reticleMoveEndY: number = 0;

    private topHand: SVGTextElement | null = null;
    private bottomHand: SVGTextElement | null = null;
    private haloCircle: SVGCircleElement | null = null;

    private static readonly HALO_RADIUS_OPEN = 45;
    private static readonly HALO_RADIUS_CLICK = 4;
    private static readonly HALO_OPACITY_OPEN = 0.2;
    private static readonly HALO_OPACITY_CLICK = 1;
    private static readonly HALO_COLOR = '#E6B3CC';

    constructor(private svgElement: SVGSVGElement) {}

    create(): void {
        this.reticleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.reticleGroup.setAttribute('class', 'playback-reticle');
        this.reticleGroup.style.display = 'none';
        this.reticleGroup.style.pointerEvents = 'none';

        this.haloCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        this.haloCircle.setAttribute('cx', '0');
        this.haloCircle.setAttribute('cy', '0');
        this.haloCircle.setAttribute('r', String(PlaybackReticle.HALO_RADIUS_OPEN));
        this.haloCircle.setAttribute('fill', PlaybackReticle.HALO_COLOR);
        this.haloCircle.setAttribute('opacity', String(PlaybackReticle.HALO_OPACITY_OPEN));
        this.reticleGroup.appendChild(this.haloCircle);

        this.topHand = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        this.topHand.setAttribute('font-size', '28');
        this.topHand.setAttribute('text-anchor', 'middle');
        this.topHand.setAttribute('dominant-baseline', 'middle');
        this.topHand.textContent = '🫳';
        this.reticleGroup.appendChild(this.topHand);

        this.bottomHand = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        this.bottomHand.setAttribute('font-size', '28');
        this.bottomHand.setAttribute('text-anchor', 'middle');
        this.bottomHand.setAttribute('dominant-baseline', 'middle');
        this.bottomHand.textContent = '🫴';
        this.reticleGroup.appendChild(this.bottomHand);

        this.updateHugHands(0);
        this.svgElement.appendChild(this.reticleGroup);
    }

    destroy(): void {
        this.reticleGroup?.remove();
        this.reticleGroup = null;
        for (const kiss of this.kisses) {
            kiss.element.remove();
        }
        this.kisses = [];
    }

    async showAt(x: number, y: number, trackCloudId?: string, getCloudPosition?: (id: string) => { x: number; y: number } | null): Promise<void> {
        if (this.reticleVisible) {
            await this.moveTo(x, y, trackCloudId, getCloudPosition);
        } else {
            this.reticleX = x;
            this.reticleY = y;
            this.reticleTargetX = x;
            this.reticleTargetY = y;
            this.reticleVisible = true;
            this.reticleTilt = 40 + (Math.random() - 0.5) * 60;
            this.reticleFadeDirection = 'in';
            this.fadeProgress = 0;
            await this.trackingDelay(RETICLE_FADE_MS, trackCloudId, getCloudPosition);
        }
    }

    async moveTo(x: number, y: number, trackCloudId?: string, getCloudPosition?: (id: string) => { x: number; y: number } | null): Promise<void> {
        const dx = x - this.reticleX;
        const dy = y - this.reticleY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const duration = MOVE_BASE_DURATION_MS * (distance / MOVE_BASE_DISTANCE);

        this.reticleMoveStartX = this.reticleX;
        this.reticleMoveStartY = this.reticleY;
        this.reticleMoveEndX = x;
        this.reticleMoveEndY = y;
        this.reticleMoveProgress = 0;
        this.reticleMoveDuration = duration;
        this.reticleTargetX = x;
        this.reticleTargetY = y;

        await this.delay(duration);
    }

    async fadeOut(): Promise<void> {
        this.reticleFadeDirection = 'out';
        this.fadeOutArcAngle = -(10 + Math.random() * 10) * Math.PI / 180;
        await this.delay(RETICLE_FADE_MS);
        this.reticleVisible = false;
        this.reticleOpacity = 0;
        this.fadeProgress = 0;
    }

    async animateHug(): Promise<void> {
        this.hugAnimating = true;
        this.hugProgress = 0;
        this.hugRelaxFactor = 0.5 + Math.random() * 0.5;
        await this.delay(HUG_DURATION_MS);
        this.hugAnimating = false;
    }

    setTarget(x: number, y: number): void {
        this.reticleTargetX = x;
        this.reticleTargetY = y;
    }

    spawnKisses(x: number, y: number): void {
        const r = Math.random();
        const count = r < 0.6 ? 1 : r < 0.9 ? 2 : 3;
        const emojis = ['💋', '🎉', '🎊', '🪄', '💎', '🔑', '❤️', '💥', '💦'];
        const rotatedEmojis = new Set(['💋', '🔑']);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = KISS_SPEED * (0.5 + Math.random() * 0.5);
            const emoji = emojis[Math.floor(Math.random() * emojis.length)];
            const shouldRotate = rotatedEmojis.has(emoji);

            const kiss = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            kiss.setAttribute('font-size', '16');
            kiss.setAttribute('text-anchor', 'middle');
            kiss.setAttribute('dominant-baseline', 'middle');
            kiss.textContent = emoji;
            kiss.style.pointerEvents = 'none';
            this.svgElement.appendChild(kiss);

            this.kisses.push({
                element: kiss,
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                rotation: shouldRotate ? 45 : 0,
                angularVelocity: shouldRotate ? (Math.random() - 0.5) * 400 : 0,
                age: 0
            });
        }
    }

    update(deltaTime: number): void {
        if (!this.reticleGroup) return;

        const fadeRate = deltaTime / (RETICLE_FADE_MS / 1000);
        if (this.reticleFadeDirection === 'in') {
            this.fadeProgress = Math.min(1, this.fadeProgress + fadeRate);
            this.reticleOpacity = Math.min(1, this.reticleOpacity + fadeRate);
            if (this.fadeProgress >= 1) {
                this.reticleFadeDirection = 'none';
            }
        } else if (this.reticleFadeDirection === 'out') {
            this.fadeProgress = Math.max(0, this.fadeProgress - fadeRate);
            this.reticleOpacity = Math.max(0, this.reticleOpacity - fadeRate);
        }

        if (this.reticleMoveProgress < 1 && this.reticleMoveDuration > 0) {
            this.reticleMoveProgress = Math.min(1, this.reticleMoveProgress + deltaTime / (this.reticleMoveDuration / 1000));
            const t = this.reticleMoveProgress;
            const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            this.reticleX = this.reticleMoveStartX + (this.reticleMoveEndX - this.reticleMoveStartX) * eased;
            this.reticleY = this.reticleMoveStartY + (this.reticleMoveEndY - this.reticleMoveStartY) * eased;
        } else {
            const positionSmoothing = 10;
            this.reticleX += (this.reticleTargetX - this.reticleX) * Math.min(1, deltaTime * positionSmoothing);
            this.reticleY += (this.reticleTargetY - this.reticleY) * Math.min(1, deltaTime * positionSmoothing);
        }

        if (this.hugAnimating) {
            this.hugProgress = Math.min(1, this.hugProgress + deltaTime / (HUG_DURATION_MS / 1000));
        }
        this.updateHugHands(this.hugProgress);

        this.reticleGroup.setAttribute('transform', `translate(${this.reticleX}, ${this.reticleY}) rotate(${this.reticleTilt})`);
        this.reticleGroup.setAttribute('opacity', String(this.reticleOpacity));
        this.reticleGroup.style.display = this.reticleVisible ? '' : 'none';

        this.updateKisses(deltaTime);
    }

    getPosition(): { x: number; y: number } {
        return { x: this.reticleX, y: this.reticleY };
    }

    private updateHugHands(progress: number): void {
        const triangle = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
        const easedSqueeze = triangle < 0.5
            ? 8 * triangle * triangle * triangle * triangle
            : 1 - Math.pow(-2 * triangle + 2, 4) / 2;
        const baseSpread = 35;
        const hugSpread = 12;
        const relaxTarget = hugSpread + (baseSpread - hugSpread) * this.hugRelaxFactor;
        const targetSpread = progress < 0.5 ? baseSpread : relaxTarget;
        const spread = targetSpread - (targetSpread - hugSpread) * easedSqueeze;

        const easeOut = 1 - Math.pow(1 - this.fadeProgress, 2);
        const rotation = 90 * (1 - this.fadeProgress);
        const extraDistance = 100 * (1 - easeOut);

        const fadeOutT = 1 - this.fadeProgress;
        const pathAngle = this.fadeOutArcAngle * fadeOutT * (1 - fadeOutT) * 4;
        const distance = spread + extraDistance;
        const pathX = Math.sin(pathAngle) * distance;

        const topY = -Math.cos(pathAngle) * distance;
        const bottomY = Math.cos(pathAngle) * distance;

        const offsetScale = this.fadeProgress * (1 - 0.5 * easedSqueeze);
        const topOffset = RETICLE_TOP_HAND_X_OFFSET * offsetScale;
        const bottomOffset = RETICLE_BOTTOM_HAND_X_OFFSET * offsetScale;
        this.topHand?.setAttribute('transform', `translate(${-pathX + topOffset}, ${topY}) rotate(${rotation})`);
        this.bottomHand?.setAttribute('transform', `translate(${pathX + bottomOffset}, ${bottomY}) scale(-1, 1) rotate(${-rotation})`);

        if (this.haloCircle) {
            const { HALO_RADIUS_OPEN, HALO_RADIUS_CLICK, HALO_OPACITY_OPEN, HALO_OPACITY_CLICK } = PlaybackReticle;
            const radius = HALO_RADIUS_OPEN - (HALO_RADIUS_OPEN - HALO_RADIUS_CLICK) * easedSqueeze;
            const opacity = HALO_OPACITY_OPEN + (HALO_OPACITY_CLICK - HALO_OPACITY_OPEN) * easedSqueeze;
            this.haloCircle.setAttribute('r', String(radius));
            this.haloCircle.setAttribute('opacity', String(opacity));
        }
    }

    private updateKisses(deltaTime: number): void {
        for (let i = this.kisses.length - 1; i >= 0; i--) {
            const kiss = this.kisses[i];
            kiss.age += deltaTime * 1000;
            kiss.x += kiss.vx * deltaTime;
            kiss.y += kiss.vy * deltaTime;
            kiss.rotation += kiss.angularVelocity * deltaTime;

            const progress = kiss.age / KISS_DURATION_MS;
            const opacity = 1 - progress;
            const scale = 1 + progress;

            kiss.element.setAttribute('transform', `translate(${kiss.x}, ${kiss.y}) rotate(${kiss.rotation}) scale(${scale})`);
            kiss.element.setAttribute('opacity', String(Math.max(0, opacity)));

            if (kiss.age >= KISS_DURATION_MS) {
                kiss.element.remove();
                this.kisses.splice(i, 1);
            }
        }
    }

    private async trackingDelay(ms: number, cloudId?: string, getCloudPosition?: (id: string) => { x: number; y: number } | null): Promise<void> {
        if (!cloudId || !getCloudPosition) {
            await this.delay(ms);
            return;
        }
        const interval = 50;
        let remaining = ms;
        while (remaining > 0) {
            await this.delay(Math.min(interval, remaining));
            remaining -= interval;
            const pos = getCloudPosition(cloudId);
            if (pos) {
                this.reticleTargetX = pos.x;
                this.reticleTargetY = pos.y;
            }
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
