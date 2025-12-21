import { PerlinNoise } from './perlinNoise.js';

const DOT_COUNT = 400;
const FIELD_SIZE = 400;
const CURL_NOISE_SCALE = 0.02;
const CURL_TIME_SCALE = 1.0;
const BASE_SPEED_NOISE_RATE = 2;
const SPEED_NOISE_RATE_AMPLITUDE = 1;
const SPEED_NOISE_RATE_PERIOD = 5 * 60 * 1000; // 5 minutes in milliseconds
const DOT_TRAIL_LENGTH = 64;
const TRAIL_POINTS_PER_SEGMENT = 8;
const RENDER_INTERVAL_MS = 1000 / 40;

interface Dot {
    x: number;
    y: number;
    trail: { x: number; y: number }[];
    noiseOffset: number;
    hue: number;
    saturation: number;
    lightness: number;
}

export class StarFillField {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private dots: Dot[] = [];
    private noiseTime: number = 0;
    private perlinNoise: PerlinNoise;
    private fillHue: number;
    private fillSaturation: number;
    private fillLightness: number;
    private currentBlobUrl: string | null = null;
    private blobUrlDirty: boolean = true;
    private totalTime: number = 0;
    private timeSinceLastRender: number = 0;
    private speedNoisePhaseOffset: number;

    constructor(fillHue: number, fillSaturation: number, fillLightness: number) {
        this.fillHue = fillHue;
        this.fillSaturation = fillSaturation;
        this.fillLightness = fillLightness;
        this.perlinNoise = new PerlinNoise();
        this.speedNoisePhaseOffset = Math.random() * 2 * Math.PI;

        this.canvas = document.createElement('canvas');
        this.canvas.width = FIELD_SIZE;
        this.canvas.height = FIELD_SIZE;
        this.ctx = this.canvas.getContext('2d')!;

        for (let i = 0; i < DOT_COUNT; i++) {
            const x = Math.random() * FIELD_SIZE;
            const y = Math.random() * FIELD_SIZE;
            const trail: { x: number; y: number }[] = [];
            for (let t = 0; t < DOT_TRAIL_LENGTH; t++) {
                trail.push({ x, y });
            }

            const isWhite = i < DOT_COUNT / 2;
            const hue = isWhite ? 0 : this.pickSpacedHue();
            const saturation = isWhite ? 0 : fillSaturation * 1;
            const lightness = isWhite ? 100 : 85;

            this.dots.push({ x, y, trail, noiseOffset: Math.random() * 1000, hue, saturation, lightness });
        }
    }

    private nextHueIndex = 0;

    private pickSpacedHue(): number {
        const coloredCount = Math.ceil(DOT_COUNT / 2);
        const excludeRange = 36; // 10% of 360
        const availableRange = 360 - excludeRange;
        const spacing = availableRange / coloredCount;
        const offset = (this.fillHue + excludeRange / 2) % 360;
        const hue = (offset + this.nextHueIndex * spacing) % 360;
        this.nextHueIndex++;
        return hue;
    }

    getSize(): number {
        return FIELD_SIZE;
    }

    toDataURL(): string {
        return this.canvas.toDataURL();
    }

    getBlobUrl(callback: (url: string) => void): void {
        if (!this.blobUrlDirty && this.currentBlobUrl) {
            callback(this.currentBlobUrl);
            return;
        }
        this.canvas.toBlob((blob) => {
            if (!blob) return;
            if (this.currentBlobUrl) {
                URL.revokeObjectURL(this.currentBlobUrl);
            }
            this.currentBlobUrl = URL.createObjectURL(blob);
            this.blobUrlDirty = false;
            callback(this.currentBlobUrl);
        });
    }

    getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }

    markDirty(): void {
        this.blobUrlDirty = true;
    }

    private noise(x: number, y: number, t: number): number {
        return Math.sin(x * 1.0 + t) * Math.cos(y * 1.3) +
            Math.sin(x * 2.1 - t * 0.7) * Math.cos(y * 1.9 + t * 0.3) * 0.5 +
            Math.sin(x * 4.3 + t * 0.4) * Math.cos(y * 3.7 - t * 0.2) * 0.25;
    }

    private curlNoise(x: number, y: number, t: number): { vx: number; vy: number } {
        const eps = 0.01;
        const dPdy = (this.noise(x, y + eps, t) - this.noise(x, y - eps, t)) / (2 * eps);
        const dPdx = (this.noise(x + eps, y, t) - this.noise(x - eps, y, t)) / (2 * eps);
        return { vx: dPdy, vy: -dPdx };
    }

    update(deltaTime: number): void {
        this.noiseTime += deltaTime * CURL_TIME_SCALE;
        this.totalTime += deltaTime;

        const animatedSpeedNoiseRate = BASE_SPEED_NOISE_RATE +
            SPEED_NOISE_RATE_AMPLITUDE * Math.sin(2 * Math.PI * this.totalTime / SPEED_NOISE_RATE_PERIOD + this.speedNoisePhaseOffset);

        for (const dot of this.dots) {
            for (let t = DOT_TRAIL_LENGTH - 1; t > 0; t--) {
                dot.trail[t].x = dot.trail[t - 1].x;
                dot.trail[t].y = dot.trail[t - 1].y;
            }
            dot.trail[0].x = dot.x;
            dot.trail[0].y = dot.y;

            const { vx, vy } = this.curlNoise(
                dot.x * CURL_NOISE_SCALE,
                dot.y * CURL_NOISE_SCALE,
                this.noiseTime
            );

            const speed = this.perlinNoise.noise(dot.noiseOffset, this.noiseTime * animatedSpeedNoiseRate);

            dot.x += vx * speed;
            dot.y += vy * speed;

            if (dot.x < 0) dot.x = -dot.x;
            else if (dot.x > FIELD_SIZE) dot.x = 2 * FIELD_SIZE - dot.x;
            if (dot.y < 0) dot.y = -dot.y;
            else if (dot.y > FIELD_SIZE) dot.y = 2 * FIELD_SIZE - dot.y;
        }

        this.timeSinceLastRender += deltaTime * 1000;
        if (this.timeSinceLastRender >= RENDER_INTERVAL_MS) {
            this.timeSinceLastRender = 0;
            this.render();
            this.blobUrlDirty = true;
        }
    }

    private render(): void {
        const ctx = this.ctx;
        ctx.fillStyle = `hsl(${this.fillHue}, ${this.fillSaturation}%, ${this.fillLightness}%)`;
        ctx.fillRect(0, 0, FIELD_SIZE, FIELD_SIZE);

        const maxDistSq = (FIELD_SIZE / 4) ** 2;

        for (const dot of this.dots) {
            const color = `hsl(${dot.hue}, ${dot.saturation}%, ${dot.lightness}%)`;

            const segments = Math.ceil(DOT_TRAIL_LENGTH / TRAIL_POINTS_PER_SEGMENT);

            ctx.lineCap = 'round';
            ctx.lineWidth = 1;

            let prevX = dot.x;
            let prevY = dot.y;
            for (let seg = 0; seg < segments; seg++) {
                const endIdx = Math.min((seg + 1) * TRAIL_POINTS_PER_SEGMENT, DOT_TRAIL_LENGTH - 1);
                const endPoint = dot.trail[endIdx];

                const dx = prevX - endPoint.x;
                const dy = prevY - endPoint.y;
                const distSq = dx * dx + dy * dy;

                if (distSq < maxDistSq) {
                    const opacity = 1 - (seg / segments) * 0.75;
                    ctx.globalAlpha = opacity;
                    ctx.strokeStyle = color;
                    ctx.beginPath();
                    ctx.moveTo(prevX, prevY);
                    ctx.lineTo(endPoint.x, endPoint.y);
                    ctx.stroke();
                }

                prevX = endPoint.x;
                prevY = endPoint.y;
            }
            ctx.globalAlpha = 1;
        }
    }
}
