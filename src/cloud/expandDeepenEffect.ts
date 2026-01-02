import { SimulatorModel } from '../simulator/ifsModel.js';
import { HSLColor } from '../utils/colorUtils.js';
import { SparkleColorGenerator, SparkleColor } from '../star/sparkleColors.js';

const EFFECT_DURATION_SEC = 120;
const MAX_SELF_AMPLIFICATION = 10;
const WAVEFRONT_PERIOD_SEC = 15;
const SIN_WAVE_EVOLUTION_SEC = 3;
const FADE_DURATION_SEC = 0.5;
const BORDER_FADE_DURATION_SEC = 5;
const LINE_SPACING = 400;

interface Dot {
    alongPos: number;  // position along the direction
    perpLine: number;  // which line the dot is on
    vel: number;       // small random velocity along direction
    radius: number;    // random dot radius
    finalX?: number;   // cached final screen position
    finalY?: number;
}

interface SinWaveInstance {
    startTime: number;
    angle: number; // direction angle in radians
    dirX: number;  // cached Math.cos(angle)
    dirY: number;  // cached Math.sin(angle)
    perpOffset: number; // random offset between 0 and LINE_SPACING
    dots: Dot[];
    settled: boolean; // true when dots have stopped moving
}

interface Wavefront {
    spawnTime: number;
}

interface Sparkle {
    x: number;
    y: number;
    spawnTime: number;
    radius: number;
    duration: number;
    color: SparkleColor;
}

export class ExpandDeepenEffect {
    private active = false;
    private elapsedTime = 0;
    private fadeOutProgress = 0;
    private isFadingOut = false;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private width: number;
    private height: number;
    private starColor: HSLColor | null = null;
    private wavefrontColorTransparent: string = '';
    private wavefrontColorOpaque: string = '';
    private dotColor: string = '';
    private sinWaveInstances: SinWaveInstance[] = [];
    private wavefronts: Wavefront[] = [];
    private sparkles: Sparkle[] = [];
    private sparkleColorGen: SparkleColorGenerator | null = null;
    private nextWavefrontTime = 0;
    private lastMouseX = 0;
    private lastMouseY = 0;
    private lastMouseTime = 0;
    private mouseVelocityAvg = 0;
    private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
    private clickHandler: ((e: MouseEvent) => void) | null = null;
    private touchHandler: ((e: TouchEvent) => void) | null = null;
    private audioContext: AudioContext | null = null;
    private noiseNode: AudioBufferSourceNode | null = null;
    private gainNode: GainNode | null = null;

    constructor() {
        this.width = 800;
        this.height = 600;
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.display = 'none';
        this.ctx = this.canvas.getContext('2d')!;
    }

    attach(container: HTMLElement): void {
        container.appendChild(this.canvas);
    }

    setDimensions(width: number, height: number): void {
        this.width = width;
        this.height = height;
        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
    }

    setStarColor(color: HSLColor): void {
        this.starColor = color;
        this.sparkleColorGen = new SparkleColorGenerator(color);
        const { h, s, l } = color;
        this.wavefrontColorTransparent = `hsla(${h}, ${s}%, ${l}%, 0)`;
        this.wavefrontColorOpaque = `hsla(${h}, ${s}%, ${l}%, 0.5)`;
        this.dotColor = `hsla(${h}, ${s}%, ${l}%, 1)`;
    }

    start(): void {
        if (this.active) return;
        this.active = true;
        this.elapsedTime = 0;
        this.fadeOutProgress = 0;
        this.isFadingOut = false;
        this.sinWaveInstances = [];
        this.wavefronts = [];
        this.sparkles = [];
        this.nextWavefrontTime = 0;
        this.spawnWavefront();
        this.spawnSinWaveInstance();
        this.setupInputTracking();
        this.startWhiteNoise();
        this.canvas.style.display = 'block';
    }

    cancel(): void {
        if (!this.active || this.isFadingOut) return;
        this.isFadingOut = true;
        this.fadeOutProgress = 0;
        this.stopWhiteNoise();
    }

    isActive(): boolean {
        return this.active;
    }

    isFading(): boolean {
        return this.isFadingOut;
    }

    private setupInputTracking(): void {
        const VELOCITY_WINDOW = 0.1; // 100ms moving average window
        const VELOCITY_THRESHOLD = 600;

        this.mouseVelocityAvg = 0;
        this.lastMouseTime = performance.now();

        this.mouseMoveHandler = (e: MouseEvent) => {
            const now = performance.now();
            const dt = (now - this.lastMouseTime) / 1000;
            if (dt > 0.001) {
                const dx = e.clientX - this.lastMouseX;
                const dy = e.clientY - this.lastMouseY;
                const instantVelocity = Math.sqrt(dx * dx + dy * dy) / dt;

                // Exponential moving average with time-based decay
                const alpha = Math.min(1, dt / VELOCITY_WINDOW);
                this.mouseVelocityAvg = alpha * instantVelocity + (1 - alpha) * this.mouseVelocityAvg;

                if (this.mouseVelocityAvg > VELOCITY_THRESHOLD) {
                    this.cancel();
                }

                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
                this.lastMouseTime = now;
            }
        };
        this.clickHandler = () => this.cancel();
        this.touchHandler = () => this.cancel();

        document.addEventListener('mousemove', this.mouseMoveHandler);
        document.addEventListener('click', this.clickHandler, true);
        document.addEventListener('touchstart', this.touchHandler, true);
    }

    private teardownInputTracking(): void {
        if (this.mouseMoveHandler) {
            document.removeEventListener('mousemove', this.mouseMoveHandler);
            this.mouseMoveHandler = null;
        }
        if (this.clickHandler) {
            document.removeEventListener('click', this.clickHandler, true);
            this.clickHandler = null;
        }
        if (this.touchHandler) {
            document.removeEventListener('touchstart', this.touchHandler, true);
            this.touchHandler = null;
        }
    }

    private startWhiteNoise(): void {
        if (this.audioContext) return;

        this.audioContext = new AudioContext();
        const bufferSize = this.audioContext.sampleRate * 2; // 2 seconds of noise
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        this.noiseNode = this.audioContext.createBufferSource();
        this.noiseNode.buffer = noiseBuffer;
        this.noiseNode.loop = true;

        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 0;

        this.noiseNode.connect(this.gainNode);
        this.gainNode.connect(this.audioContext.destination);
        this.noiseNode.start();
    }

    private stopWhiteNoise(): void {
        if (this.noiseNode) {
            this.noiseNode.stop();
            this.noiseNode.disconnect();
            this.noiseNode = null;
        }
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }

    private updateWhiteNoiseVolume(): void {
        if (!this.gainNode) return;
        const progress = Math.min(1, this.elapsedTime / EFFECT_DURATION_SEC);
        this.gainNode.gain.value = progress * 0.2;
    }

    private getWavefrontInterval(): number {
        // Gradually decrease interval: starts at WAVEFRONT_PERIOD_SEC/2, ends at WAVEFRONT_PERIOD_SEC/4
        const progress = Math.min(1, this.elapsedTime / EFFECT_DURATION_SEC);
        return WAVEFRONT_PERIOD_SEC / (2 + 2 * progress);
    }

    private spawnWavefront(): void {
        this.wavefronts.push({ spawnTime: this.elapsedTime });
        this.nextWavefrontTime = this.elapsedTime + this.getWavefrontInterval();
    }

    private spawnSinWaveInstance(): void {
        // Require at least +/-pi/3 rotation from previous instance
        let angle: number;
        if (this.sinWaveInstances.length === 0) {
            angle = Math.random() * Math.PI * 2;
        } else {
            const prevAngle = this.sinWaveInstances[this.sinWaveInstances.length - 1].angle;
            const minRotation = Math.PI / 3;
            const rotationRange = Math.PI - minRotation; // up to pi rotation
            const rotation = minRotation + Math.random() * rotationRange;
            const direction = Math.random() < 0.5 ? 1 : -1;
            angle = prevAngle + direction * rotation;
        }

        const dots: Dot[] = [];

        const screenCenterX = this.width / 2;
        const screenCenterY = this.height / 2;
        const maxDist = Math.sqrt(screenCenterX * screenCenterX + screenCenterY * screenCenterY);
        const numLines = Math.ceil(maxDist * 2 / LINE_SPACING);
        const dotsPerLine = 25;

        for (let line = -numLines; line <= numLines; line++) {
            for (let d = 0; d < dotsPerLine; d++) {
                dots.push({
                    alongPos: (Math.random() - 0.5) * maxDist * 2,
                    perpLine: line,
                    vel: (Math.random() < 0.5 ? 1 : -1) * 1.5 + (Math.random() - 0.5) * 0.2,
                    radius: 1.5 + Math.random() * 3
                });
            }
        }

        this.sinWaveInstances.push({
            startTime: this.elapsedTime,
            angle,
            dirX: Math.cos(angle),
            dirY: Math.sin(angle),
            perpOffset: Math.random() * LINE_SPACING,
            dots,
            settled: false
        });
    }

    update(deltaTime: number, model: SimulatorModel): boolean {
        if (!this.active) return false;

        if (this.isFadingOut) {
            this.fadeOutProgress += deltaTime / FADE_DURATION_SEC;
            if (this.fadeOutProgress >= 1) {
                this.active = false;
                this.teardownInputTracking();
                this.canvas.style.display = 'none';
                model.setSelfAmplification(1);
                return false;
            }
            return true;
        }

        this.elapsedTime += deltaTime;

        // Update selfAmplification linearly over 2 minutes
        const amplification = 1 + (MAX_SELF_AMPLIFICATION - 1) * Math.min(1, this.elapsedTime / EFFECT_DURATION_SEC);
        model.setSelfAmplification(amplification);

        // Spawn new wavefronts at dynamically scheduled intervals
        while (this.elapsedTime >= this.nextWavefrontTime) {
            this.spawnWavefront();
        }

        // Prune wavefronts that have fully exited
        this.wavefronts = this.wavefronts.filter(w => {
            const age = this.elapsedTime - w.spawnTime;
            return age < WAVEFRONT_PERIOD_SEC;
        });

        // Spawn new sin wave instance every half period
        const spawnPeriod = SIN_WAVE_EVOLUTION_SEC / 2;
        const expectedInstances = Math.floor(this.elapsedTime / spawnPeriod) + 1;
        while (this.sinWaveInstances.length < expectedInstances) {
            this.spawnSinWaveInstance();
        }

        // Update sin wave dot positions
        this.updateSinWaveDots(deltaTime);

        // Update sparkles
        this.updateSparkles();

        // Update white noise volume
        this.updateWhiteNoiseVolume();

        // Check for blending cancellation
        if (model.getBlendedParts().length > 0) {
            this.cancel();
        }

        return true;
    }

    private updateSinWaveDots(deltaTime: number): void {
        const screenCenterX = this.width / 2;
        const screenCenterY = this.height / 2;
        const maxDist = Math.sqrt(screenCenterX * screenCenterX + screenCenterY * screenCenterY);
        const range = maxDist * 2;

        for (const instance of this.sinWaveInstances) {
            if (instance.settled) continue;

            const age = this.elapsedTime - instance.startTime;
            const evolutionProgress = Math.min(1, age / SIN_WAVE_EVOLUTION_SEC);
            const justSettled = evolutionProgress >= 1;

            const startAmp = 20;
            const endAmp = 0;
            const freq = 0.05;
            const amp = startAmp + (endAmp - startAmp) * Math.sqrt(evolutionProgress);

            const { dirX, dirY, perpOffset } = instance;
            const perpX = -dirY;
            const perpY = dirX;

            // Time-based velocity multiplier (slows down as evolution progresses)
            const velocityScale = (1 - Math.sqrt(evolutionProgress)) * deltaTime * 60;

            for (const dot of instance.dots) {
                // Update position using deltaTime
                dot.alongPos += dot.vel * velocityScale;
                dot.alongPos = ((dot.alongPos + maxDist) % range + range) % range - maxDist;

                const alongDist = dot.alongPos;
                const perpDist = dot.perpLine * LINE_SPACING + perpOffset;
                const sinOffset = Math.sin(alongDist * freq + Math.PI * 2 * age) * amp;

                const x = screenCenterX + dirX * alongDist + perpX * (perpDist + sinOffset);
                const y = screenCenterY + dirY * alongDist + perpY * (perpDist + sinOffset);

                // Cache final position (only visible dots)
                if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
                    dot.finalX = x;
                    dot.finalY = y;
                } else {
                    dot.finalX = undefined;
                    dot.finalY = undefined;
                }
            }

            if (justSettled) {
                instance.settled = true;
            }
        }
    }

    private updateSparkles(): void {
        const MIN_SPARKLES = 5;
        const MAX_SPARKLES = 50;

        // Remove expired sparkles
        this.sparkles = this.sparkles.filter(s => this.elapsedTime - s.spawnTime < s.duration);

        // Target count increases linearly with effect progress
        const progress = Math.min(1, this.elapsedTime / EFFECT_DURATION_SEC);
        const targetCount = Math.floor(MIN_SPARKLES + (MAX_SPARKLES - MIN_SPARKLES) * progress);

        // Spawn new sparkles to reach target
        while (this.sparkles.length < targetCount && this.sparkleColorGen) {
            const t = Math.random();
            this.sparkles.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                spawnTime: this.elapsedTime,
                radius: 5.5 + t * 10,           // larger when t is high
                duration: 3.25 - t * 3,          // shorter when t is high
                color: this.sparkleColorGen.generateRandom()
            });
        }
    }

    render(centerX: number, centerY: number): void {
        if (!this.active || !this.starColor) return;

        this.ctx.clearRect(0, 0, this.width, this.height);

        const opacity = this.isFadingOut ? 1 - this.fadeOutProgress : 1;
        const selfAmp = 1 + (MAX_SELF_AMPLIFICATION - 1) * Math.min(1, this.elapsedTime / EFFECT_DURATION_SEC);

        this.renderWavefronts(centerX, centerY, opacity, selfAmp);
        this.renderSinWaveDots(opacity);
        this.renderSparkles(opacity);
    }

    private renderSparkles(globalOpacity: number): void {
        for (const sparkle of this.sparkles) {
            const age = this.elapsedTime - sparkle.spawnTime;
            const sparkleOpacity = (1 - age / sparkle.duration) * globalOpacity;
            if (sparkleOpacity <= 0) continue;

            const { hue, saturation, lightness } = sparkle.color;
            this.ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${sparkleOpacity})`;
            this.drawSparkleShape(sparkle.x, sparkle.y, sparkle.radius);
        }
    }

    private drawSparkleShape(x: number, y: number, size: number): void {
        // 4-pointed star shape like the sparkles emoji
        const innerRadius = size * 0.2;
        const outerRadius = size;

        this.ctx.beginPath();
        for (let i = 0; i < 4; i++) {
            const outerAngle = (i * Math.PI / 2) - Math.PI / 2;
            const innerAngle = outerAngle + Math.PI / 4;

            const outerX = x + Math.cos(outerAngle) * outerRadius;
            const outerY = y + Math.sin(outerAngle) * outerRadius;
            const innerX = x + Math.cos(innerAngle) * innerRadius;
            const innerY = y + Math.sin(innerAngle) * innerRadius;

            if (i === 0) {
                this.ctx.moveTo(outerX, outerY);
            } else {
                this.ctx.lineTo(outerX, outerY);
            }
            this.ctx.lineTo(innerX, innerY);
        }
        this.ctx.closePath();
        this.ctx.fill();
    }

    private renderWavefronts(centerX: number, centerY: number, opacity: number, selfAmp: number): void {
        const maxRadius = Math.max(this.width, this.height) / 2;
        const wavefrontWidth = selfAmp * 5;

        for (const wavefront of this.wavefronts) {
            const age = this.elapsedTime - wavefront.spawnTime;
            const phase = age / WAVEFRONT_PERIOD_SEC;
            this.renderSingleWavefront(centerX, centerY, phase, maxRadius, wavefrontWidth, opacity);
        }
    }

    private renderSingleWavefront(
        centerX: number, centerY: number,
        phase: number, maxRadius: number, wavefrontWidth: number, opacity: number
    ): void {
        const distanceMultiplier = 1 + phase * 0.5;
        const effectiveMax = maxRadius + wavefrontWidth * 2;
        const wavefrontRadius = phase * effectiveMax * distanceMultiplier;
        const ageScale = 1 + 2 * wavefrontRadius / effectiveMax;

        const innerRadius = Math.max(0, wavefrontRadius - ageScale * wavefrontWidth);
        const outerRadius = wavefrontRadius + ageScale * wavefrontWidth;

        const gradient = this.ctx.createRadialGradient(
            centerX, centerY, innerRadius,
            centerX, centerY, outerRadius
        );

        // Use pre-computed color strings, adjust middle opacity
        gradient.addColorStop(0, this.wavefrontColorTransparent);
        this.ctx.globalAlpha = opacity;
        gradient.addColorStop(0.5, this.wavefrontColorOpaque);
        gradient.addColorStop(1, this.wavefrontColorTransparent);

        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.globalAlpha = 1;
    }

    private renderSinWaveDots(opacity: number): void {
        this.ctx.fillStyle = this.dotColor;

        for (const instance of this.sinWaveInstances) {
            const age = this.elapsedTime - instance.startTime;
            const instanceOpacity = Math.min(1, age / 0.5) * opacity;
            this.ctx.globalAlpha = instanceOpacity;

            this.ctx.beginPath();
            for (const dot of instance.dots) {
                if (dot.finalX !== undefined && dot.finalY !== undefined) {
                    this.ctx.moveTo(dot.finalX + dot.radius, dot.finalY);
                    this.ctx.arc(dot.finalX, dot.finalY, dot.radius, 0, Math.PI * 2);
                }
            }
            this.ctx.fill();
        }
        this.ctx.globalAlpha = 1;
    }

    getBorderOpacity(): number {
        if (!this.active) return 1;
        // Fade from 1 to 0 over BORDER_FADE_DURATION_SEC
        return Math.max(0, 1 - this.elapsedTime / BORDER_FADE_DURATION_SEC);
    }
}
