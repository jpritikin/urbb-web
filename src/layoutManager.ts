import { Cloud } from './cloudShape.js';

interface Vec3 {
    x: number;
    y: number;
    z: number;
}

interface CloudInstance {
    cloud: Cloud;
    position: Vec3;
    velocity: Vec3;
}

export interface LayoutConfig {
    canvasWidth: number;
    canvasHeight: number;
    perspectiveFactor: number;
}

export interface TransitionState {
    isTransitioning: boolean;
    direction: 'forward' | 'reverse' | 'none';
    progress: number;
}

export interface SplitPanePositions {
    leftPaneX: number;
    rightPaneX: number;
    starX: number;
    starY: number;
    cloudX: number;
    cloudY: number;
    cloudScale: number;
    counterZoomScale: number;
}

export class LayoutManager {
    private config: LayoutConfig;
    private maxZoomFactor: number = 2.0;

    constructor(config: LayoutConfig) {
        this.config = config;
    }

    updateConfig(config: Partial<LayoutConfig>): void {
        this.config = { ...this.config, ...config };
    }

    calculateEffectiveZoom(
        baseZoom: number,
        mode: 'panorama' | 'foreground',
        transition: TransitionState
    ): number {
        if (transition.isTransitioning) {
            const eased = this.easeInOutCubic(transition.progress);
            const zoomProgress = transition.direction === 'forward' ? eased : 1 - eased;
            return baseZoom * (1 + (this.maxZoomFactor - 1) * zoomProgress);
        } else if (mode === 'foreground') {
            return baseZoom * this.maxZoomFactor;
        }
        return baseZoom;
    }

    calculateViewBox(centerX: number, centerY: number, effectiveZoom: number): [number, number, number, number] {
        const scaledWidth = this.config.canvasWidth / effectiveZoom;
        const scaledHeight = this.config.canvasHeight / effectiveZoom;
        const viewBoxX = centerX - scaledWidth / 2;
        const viewBoxY = centerY - scaledHeight / 2;
        return [viewBoxX, viewBoxY, scaledWidth, scaledHeight];
    }

    projectToScreen(instance: CloudInstance): { x: number; y: number; scale: number } {
        const scale = this.config.perspectiveFactor / (this.config.perspectiveFactor - instance.position.z);
        const projectedX = instance.position.x * scale;
        const projectedY = instance.position.y * scale;
        return {
            x: this.config.canvasWidth / 2 + projectedX,
            y: this.config.canvasHeight / 2 + projectedY,
            scale
        };
    }

    calculateSplitPanePositions(
        targetInstance: CloudInstance,
        transition: TransitionState
    ): SplitPanePositions {
        const leftPaneX = this.config.canvasWidth * 0.25;
        const rightPaneX = this.config.canvasWidth * 0.75;
        const centerX = this.config.canvasWidth / 2;
        const centerY = this.config.canvasHeight / 2;

        const perspectiveScale = this.config.perspectiveFactor /
            (this.config.perspectiveFactor - targetInstance.position.z);
        const naturalScale = 1.0;

        let currentZoomFactor: number;
        if (transition.isTransitioning) {
            const eased = this.easeInOutCubic(transition.progress);
            const zoomProgress = transition.direction === 'forward' ? eased : 1 - eased;
            currentZoomFactor = 1 + (this.maxZoomFactor - 1) * zoomProgress;
        } else {
            currentZoomFactor = this.maxZoomFactor;
        }

        const eased = transition.isTransitioning ? this.easeInOutCubic(transition.progress) : 1;

        let starX: number, starY: number;
        let cloudX: number, cloudY: number;
        let cloudScale: number;

        if (transition.direction === 'forward' && transition.isTransitioning) {
            starX = centerX + (leftPaneX - centerX) * eased;
            starY = centerY;

            const cloudStartX = centerX + targetInstance.position.x * perspectiveScale;
            const cloudStartY = centerY + targetInstance.position.y * perspectiveScale;
            cloudX = cloudStartX + (rightPaneX - cloudStartX) * eased;
            cloudY = cloudStartY + (centerY - cloudStartY) * eased;
            cloudScale = perspectiveScale + (naturalScale - perspectiveScale) * eased;
        } else if (transition.direction === 'reverse' && transition.isTransitioning) {
            starX = leftPaneX + (centerX - leftPaneX) * eased;
            starY = centerY;

            const cloudTargetX = centerX + targetInstance.position.x * perspectiveScale;
            const cloudTargetY = centerY + targetInstance.position.y * perspectiveScale;
            cloudX = rightPaneX + (cloudTargetX - rightPaneX) * eased;
            cloudY = centerY + (cloudTargetY - centerY) * eased;
            cloudScale = naturalScale + (perspectiveScale - naturalScale) * eased;
        } else {
            starX = leftPaneX;
            starY = centerY;
            cloudX = rightPaneX;
            cloudY = centerY;
            cloudScale = naturalScale;
        }

        return {
            leftPaneX,
            rightPaneX,
            starX,
            starY,
            cloudX,
            cloudY,
            cloudScale,
            counterZoomScale: 1 / currentZoomFactor
        };
    }

    calculateFadeProgress(transition: TransitionState): number {
        if (!transition.isTransitioning) return 0;
        const eased = this.easeInOutCubic(transition.progress);
        return transition.direction === 'forward' ? eased : 1 - eased;
    }

    private easeInOutCubic(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
}
