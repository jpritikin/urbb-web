export interface SelfRayConfig {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    targetCloudId: string;
}

export interface PartContext {
    isProtector: boolean;
    isIdentityRevealed: boolean;
    partName: string;
}

export type BiographyField = 'age' | 'identity' | 'job' | 'jobAppraisal' | 'jobImpact' | 'gratitude' | 'compassion';

interface RayLayer {
    path: SVGPathElement;
    insetRatio: number;
}

interface Sparkle {
    element: SVGCircleElement;
    progress: number;
    speed: number;
    offsetRatio: number;
}

export class SelfRay {
    private group: SVGGElement | null = null;
    private hitArea: SVGPathElement | null = null;
    private layers: RayLayer[] = [];
    private hoverOverlay: SVGPathElement | null = null;
    private borderPath: SVGPathElement | null = null;
    private clipPath: SVGClipPathElement | null = null;
    private sparkles: Sparkle[] = [];
    private sparkleGroup: SVGGElement | null = null;
    private timeSincePositionUpdate: number = 0.1;
    private targetSparkleCount: number = 0;
    private hovered: boolean = false;
    private config: SelfRayConfig;
    private onClick: ((cloudId: string, x: number, y: number, event: MouseEvent | TouchEvent) => void) | null = null;

    constructor(
        private container: SVGGElement,
        config: SelfRayConfig
    ) {
        this.config = config;
    }

    setOnClick(callback: (cloudId: string, x: number, y: number, event: MouseEvent | TouchEvent) => void): void {
        this.onClick = callback;
    }

    simulateClick(): void {
        const syntheticEvent = new MouseEvent('click', { bubbles: false, cancelable: true });
        this.onClick?.(this.config.targetCloudId, this.config.startX, this.config.startY, syntheticEvent);
    }

    create(): SVGGElement {
        this.group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.group.setAttribute('class', 'self-ray');
        this.group.style.opacity = '0.2';

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        this.clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        const clipId = `ray-clip-${this.config.targetCloudId}-${Date.now()}`;
        this.clipPath.setAttribute('id', clipId);
        defs.appendChild(this.clipPath);
        this.group.appendChild(defs);

        const clippedGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        clippedGroup.setAttribute('clip-path', `url(#${clipId})`);

        const colors = this.getAspectColors();

        const layerConfigs = [
            { insetRatio: 0, color: colors.outer },
            { insetRatio: 0.3, color: colors.middle },
            { insetRatio: 0.55, color: colors.inner },
        ];

        for (const layerConfig of layerConfigs) {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('fill', layerConfig.color);
            path.setAttribute('pointer-events', 'none');
            clippedGroup.appendChild(path);
            this.layers.push({ path, insetRatio: layerConfig.insetRatio });
        }

        this.hoverOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.hoverOverlay.setAttribute('fill', 'black');
        this.hoverOverlay.setAttribute('opacity', '0');
        this.hoverOverlay.setAttribute('pointer-events', 'none');
        clippedGroup.appendChild(this.hoverOverlay);

        this.group.appendChild(clippedGroup);

        this.borderPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.borderPath.setAttribute('fill', 'none');
        this.borderPath.setAttribute('stroke', '#f400d7');
        this.borderPath.setAttribute('stroke-width', '1');
        this.borderPath.setAttribute('stroke-dasharray', '2,2');
        this.borderPath.setAttribute('pointer-events', 'none');
        this.group.appendChild(this.borderPath);

        this.sparkleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.group.appendChild(this.sparkleGroup);
        this.initSparkles();

        this.hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.hitArea.setAttribute('fill', 'transparent');
        this.hitArea.setAttribute('cursor', 'pointer');
        this.hitArea.setAttribute('pointer-events', 'fill');

        const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        if (!isMobile) {
            this.hitArea.addEventListener('mouseenter', () => this.handleMouseEnter());
            this.hitArea.addEventListener('mouseleave', () => this.handleMouseLeave());
        }
        this.hitArea.addEventListener('click', (e) => this.handleClick(e));
        this.hitArea.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });

        this.group.appendChild(this.hitArea);

        this.updatePaths();

        return this.group;
    }

    private getAspectColors(): { outer: string; middle: string; inner: string; stroke: string } {
        return { outer: '#fff280', middle: '#ffc699', inner: '#ffa899', stroke: '#d4a017' };
    }

    private getRayParameters() {
        const { startX, startY, endX, endY } = this.config;
        const dx = endX - startX;
        const dy = endY - startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        const rayEndDistance = distance + 100;
        return { startX, startY, distance, angle, rayEndDistance };
    }

    private computeRayGeometry(insetRatio: number): { path: string } {
        const { startX, startY, angle, rayEndDistance } = this.getRayParameters();

        const baseWidthStart = 10;
        const baseWidthEnd = 80;

        const insetWidthStart = baseWidthStart * (1 - insetRatio);
        const insetWidthEnd = baseWidthEnd * (1 - insetRatio);

        const actualStartX = startX;
        const actualStartY = startY;
        const actualEndX = startX + rayEndDistance * Math.cos(angle);
        const actualEndY = startY + rayEndDistance * Math.sin(angle);

        const perpX = -Math.sin(angle);
        const perpY = Math.cos(angle);

        const p1x = actualStartX + perpX * insetWidthStart;
        const p1y = actualStartY + perpY * insetWidthStart;
        const p2x = actualStartX - perpX * insetWidthStart;
        const p2y = actualStartY - perpY * insetWidthStart;

        const p3x = actualEndX - perpX * insetWidthEnd;
        const p3y = actualEndY - perpY * insetWidthEnd;
        const p4x = actualEndX + perpX * insetWidthEnd;
        const p4y = actualEndY + perpY * insetWidthEnd;

        return {
            path: `M ${p1x},${p1y} L ${p2x},${p2y} L ${p3x},${p3y} L ${p4x},${p4y} Z`
        };
    }

    private computeOutlinePath(capFlatness: number = 0.15): string {
        const { startX, startY, angle, rayEndDistance } = this.getRayParameters();

        const baseWidthStart = 10;
        const baseWidthEnd = 80;
        const curveLength = 15;

        const pullbackT = (rayEndDistance - curveLength) / rayEndDistance;
        const widthAtPullback = baseWidthStart + (baseWidthEnd - baseWidthStart) * pullbackT;

        const ellipseRadiusY = widthAtPullback;
        const ellipseRadiusX = ellipseRadiusY * capFlatness;

        const actualEndX = startX + (rayEndDistance - curveLength) * Math.cos(angle);
        const actualEndY = startY + (rayEndDistance - curveLength) * Math.sin(angle);

        const perpX = -Math.sin(angle);
        const perpY = Math.cos(angle);

        const p1x = startX + perpX * baseWidthStart;
        const p1y = startY + perpY * baseWidthStart;
        const p2x = startX - perpX * baseWidthStart;
        const p2y = startY - perpY * baseWidthStart;

        const p3x = actualEndX - perpX * widthAtPullback;
        const p3y = actualEndY - perpY * widthAtPullback;
        const p4x = actualEndX + perpX * widthAtPullback;
        const p4y = actualEndY + perpY * widthAtPullback;

        const angleDeg = (angle * 180) / Math.PI;

        return `M ${p1x},${p1y} L ${p2x},${p2y} L ${p3x},${p3y} ` +
            `A ${ellipseRadiusX},${ellipseRadiusY} ${angleDeg} 0 1 ${p4x},${p4y} Z`;
    }

    private updatePaths(): void {
        for (const layer of this.layers) {
            const geo = this.computeRayGeometry(layer.insetRatio);
            layer.path.setAttribute('d', geo.path);
        }

        const outlinePath = this.computeOutlinePath();

        if (this.clipPath) {
            this.clipPath.innerHTML = '';
            const clipPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            clipPathElement.setAttribute('d', outlinePath);
            this.clipPath.appendChild(clipPathElement);
        }

        if (this.hoverOverlay) {
            this.hoverOverlay.setAttribute('d', outlinePath);
        }

        if (this.borderPath) {
            this.borderPath.setAttribute('d', outlinePath);
        }

        if (this.hitArea) {
            this.hitArea.setAttribute('d', outlinePath);
        }
    }

    private handleMouseEnter(): void {
        this.hovered = true;
        if (this.hoverOverlay) {
            this.hoverOverlay.setAttribute('opacity', '0.1');
        }
    }

    private handleMouseLeave(): void {
        this.hovered = false;
        if (this.hoverOverlay) {
            this.hoverOverlay.setAttribute('opacity', '0');
        }
    }

    private handleClick(e: MouseEvent): void {
        e.stopPropagation();
        const { startX, startY } = this.config;
        this.onClick?.(this.config.targetCloudId, startX, startY, e);
    }

    private handleTouchStart(e: TouchEvent): void {
        e.preventDefault();
        e.stopPropagation();
        const { startX, startY } = this.config;
        this.onClick?.(this.config.targetCloudId, startX, startY, e);
    }

    updatePosition(startX: number, startY: number, endX: number, endY: number): void {
        this.config.startX = startX;
        this.config.startY = startY;
        this.config.endX = endX;
        this.config.endY = endY;
        this.updatePaths();
    }

    private initSparkles(): void {
        if (!this.sparkleGroup) return;

        for (const sparkle of this.sparkles) {
            sparkle.element.remove();
        }
        this.sparkles = [];
    }

    private updateSparklePositions(): void {
        const { startX, startY, angle, rayEndDistance } = this.getRayParameters();
        const perpX = -Math.sin(angle);
        const perpY = Math.cos(angle);

        const baseWidthStart = 10;
        const baseWidthEnd = 80;

        for (const sparkle of this.sparkles) {
            const t = sparkle.progress;
            const posAlongRay = t * rayEndDistance;
            const x = startX + posAlongRay * Math.cos(angle);
            const y = startY + posAlongRay * Math.sin(angle);

            const widthAtT = baseWidthStart + (baseWidthEnd - baseWidthStart) * t;
            const offsetX = perpX * widthAtT * sparkle.offsetRatio;
            const offsetY = perpY * widthAtT * sparkle.offsetRatio;

            sparkle.element.setAttribute('cx', String(x + offsetX));
            sparkle.element.setAttribute('cy', String(y + offsetY));

            const fadeIn = Math.min(1, t * 5);
            const fadeOut = Math.min(1, (1 - t) * 5);
            const randomFlicker = 0.3 + Math.random() * 0.7;
            sparkle.element.setAttribute('opacity', String(0.8 * fadeIn * fadeOut * randomFlicker));
        }
    }

    animate(deltaTime: number): void {
        for (const sparkle of this.sparkles) {
            sparkle.progress += sparkle.speed * deltaTime;
            if (sparkle.progress > 1) {
                sparkle.progress = 0;
                sparkle.offsetRatio = (Math.random() - 0.5) * 2;
            }
        }
        this.timeSincePositionUpdate += deltaTime;
        if (this.timeSincePositionUpdate >= 0.1) {
            this.updateSparklePositions();
            this.timeSincePositionUpdate = 0;
        }
        this.adjustSparkleCount();
    }

    private adjustSparkleCount(): void {
        if (!this.sparkleGroup) return;

        if (this.sparkles.length > this.targetSparkleCount) {
            const sparkle = this.sparkles.pop();
            sparkle?.element.remove();
        } else if (this.sparkles.length < this.targetSparkleCount) {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('r', '2');
            circle.setAttribute('fill', 'white');
            circle.setAttribute('opacity', '0.8');
            this.sparkleGroup.appendChild(circle);

            this.sparkles.push({
                element: circle,
                progress: Math.random(),
                speed: 0.02 + Math.random() * 0.03,
                offsetRatio: (Math.random() - 0.5) * 1.9
            });
        }
    }

    remove(): void {
        if (this.group && this.group.parentNode) {
            this.group.style.transition = 'opacity 0.3s ease-out';
            this.group.style.opacity = '0';
            const groupToRemove = this.group;
            setTimeout(() => {
                groupToRemove.parentNode?.removeChild(groupToRemove);
            }, 300);
        }
        this.group = null;
        this.hitArea = null;
        this.layers = [];
        this.sparkles = [];
    }

    getTargetCloudId(): string {
        return this.config.targetCloudId;
    }

    setTrustGainFeedback(trustGain: number): void {
        const opacity = Math.min(1, Math.max(0.2, 0.2 + (trustGain / 0.6) * 0.8));
        if (this.group) {
            this.group.style.opacity = String(opacity);
        }

        this.targetSparkleCount = trustGain >= 0.2
            ? Math.round(((trustGain - 0.2) / 0.8) * 200)
            : 0;
    }
}
