import { Cloud, CloudType } from './cloudShape.js';
import { Point } from './geometry.js';
import { CloudRelationshipManager } from './cloudRelationshipManager.js';
import { PhysicsEngine, PhysicsConfig } from './physicsEngine.js';
import { LayoutManager, LayoutConfig, TransitionState, SplitPanePositions } from './layoutManager.js';

export { CloudType };

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

export class CloudManager {
    private instances: CloudInstance[] = [];
    private svgElement: SVGSVGElement | null = null;
    private container: HTMLElement | null = null;
    private debug: boolean = false;
    private relationships: CloudRelationshipManager = new CloudRelationshipManager();
    private zoom: number = 1;
    private canvasWidth: number = 800;
    private canvasHeight: number = 600;
    private panX: number = 0;
    private panY: number = 0;
    private animating: boolean = false;
    private animationFrameId: number | null = null;
    private lastFrameTime: number = 0;
    private selectedCloud: Cloud | null = null;
    private partitionCount: number = 8;
    private currentPartition: number = 0;
    private selfElement: SVGElement | null = null;
    private counterZoomGroup: SVGGElement | null = null;

    private mode: 'panorama' | 'foreground' = 'panorama';
    private targetCloud: Cloud | null = null;
    private uiContainer: HTMLElement | null = null;
    private transitionProgress: number = 0;
    private transitionDuration: number = 1.0;
    private transitionDirection: 'forward' | 'reverse' | 'none' = 'none';
    private savedCloudTransforms: Map<Cloud, string> = new Map();
    private debugBox: HTMLElement | null = null;

    private physicsEngine: PhysicsEngine;
    private layoutManager: LayoutManager;

    constructor() {
        this.physicsEngine = new PhysicsEngine({
            torusMajorRadius: 200,
            torusMinorRadius: 80,
            torusRotationX: Math.PI / 3,
            friction: 0.6,
            repulsionStrength: 20,
            surfaceRepulsionStrength: 20,
            angularAcceleration: 25
        });

        this.layoutManager = new LayoutManager({
            canvasWidth: 800,
            canvasHeight: 600,
            perspectiveFactor: 600
        });
    }

    init(containerId: string): void {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`Container ${containerId} not found`);
            return;
        }

        this.svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svgElement.setAttribute('width', String(this.canvasWidth));
        this.svgElement.setAttribute('height', String(this.canvasHeight));
        this.svgElement.setAttribute('viewBox', `0 0 ${this.canvasWidth} ${this.canvasHeight}`);
        this.svgElement.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        this.svgElement.style.border = '1px solid #ccc';
        this.svgElement.style.background = '#f0f0f0';

        this.container.appendChild(this.svgElement);

        this.counterZoomGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.counterZoomGroup.setAttribute('id', 'counter-zoom-group');
        this.svgElement.appendChild(this.counterZoomGroup);

        this.createSelfStar();
        this.createUIContainer();
        this.createDebugBox();
        this.panX = this.canvasWidth / 2;
        this.panY = this.canvasHeight / 2;
        this.updateViewBox();
        this.setupVisibilityHandling();
    }

    private setupVisibilityHandling(): void {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (this.animating) {
                    this.stopAnimation();
                    this.animating = true;
                }
            } else {
                if (this.animating) {
                    this.lastFrameTime = performance.now();
                    this.animate();
                }
            }
        });
    }

    private createSelfStar(): void {
        if (!this.svgElement) return;

        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        const outerRadius = 20;
        const innerRadius = 8;
        const points = 5;

        const starPoints: string[] = [];
        for (let i = 0; i < points * 2; i++) {
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = (Math.PI / points) * i - Math.PI / 2;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            starPoints.push(`${x.toFixed(2)},${y.toFixed(2)}`);
        }

        const star = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        star.setAttribute('points', starPoints.join(' '));
        star.setAttribute('fill', '#FFD700');
        star.setAttribute('stroke', '#DAA520');
        star.setAttribute('stroke-width', '1.5');
        star.setAttribute('opacity', '0.9');

        this.counterZoomGroup!.appendChild(star);
        this.selfElement = star;
    }

    private createDebugBox(): void {
        if (!this.container) return;

        this.debugBox = document.createElement('pre');
        this.debugBox.style.position = 'fixed';
        this.debugBox.style.top = '10px';
        this.debugBox.style.right = '10px';
        this.debugBox.style.background = 'rgba(0, 0, 0, 0.7)';
        this.debugBox.style.color = 'white';
        this.debugBox.style.padding = '10px';
        this.debugBox.style.fontFamily = 'monospace';
        this.debugBox.style.fontSize = '12px';
        this.debugBox.style.zIndex = '10000';
        this.debugBox.style.margin = '0';
        this.debugBox.style.pointerEvents = 'all';
        this.debugBox.style.userSelect = 'all';
        this.debugBox.style.webkitUserSelect = 'all';
        this.debugBox.style.cursor = 'text';
        this.debugBox.textContent = 'ViewBox: 0 0 800 600';
        document.body.appendChild(this.debugBox);
    }

    private createUIContainer(): void {
        if (!this.container) return;

        this.container.style.position = 'relative';

        this.uiContainer = document.createElement('div');
        this.uiContainer.style.position = 'absolute';
        this.uiContainer.style.top = '10px';
        this.uiContainer.style.right = '10px';
        this.uiContainer.style.display = 'none';
        this.uiContainer.style.zIndex = '1000';

        const returnButton = document.createElement('button');
        returnButton.textContent = 'Return to Panorama';
        returnButton.style.padding = '10px 20px';
        returnButton.style.fontSize = '14px';
        returnButton.style.cursor = 'pointer';
        returnButton.addEventListener('click', () => this.returnToPanorama());

        this.uiContainer.appendChild(returnButton);
        this.container.appendChild(this.uiContainer);
    }

    addCloud(word: string, options?: any): Cloud {
        if (!this.svgElement) throw new Error('SVG element not initialized');

        const position = this.physicsEngine.generateTorusPosition();

        const cloud = new Cloud(word, 0, 0, undefined, options);
        const group = cloud.createSVGElements(() => this.selectCloud(cloud));
        this.svgElement.appendChild(group);
        cloud.updateSVGElements(this.debug);

        const instance: CloudInstance = {
            cloud,
            position,
            velocity: { x: 0, y: 0, z: 0 }
        };
        this.instances.push(instance);
        this.updateCloudPosition(instance);
        return cloud;
    }

    private updateCloudPosition(instance: CloudInstance): void {
        const projected = this.layoutManager.projectToScreen(instance);
        instance.cloud.x = projected.x;
        instance.cloud.y = projected.y;

        const group = instance.cloud.getGroupElement();
        if (group) {
            group.setAttribute('transform', `translate(${projected.x}, ${projected.y}) scale(${projected.scale})`);
        }
    }

    getRelationships(): CloudRelationshipManager {
        return this.relationships;
    }

    getCloudById(id: string): Cloud | null {
        const instance = this.instances.find(i => i.cloud.id === id);
        return instance?.cloud ?? null;
    }

    removeCloud(cloud: Cloud): void {
        if (!this.svgElement) return;

        const index = this.instances.findIndex(i => i.cloud === cloud);
        if (index !== -1) {
            const instance = this.instances[index];
            const group = instance.cloud.getGroupElement();
            if (group) {
                this.svgElement.removeChild(group);
            }
            this.instances.splice(index, 1);
            this.relationships.removeCloud(cloud.id);
        }
    }

    setDebug(enabled: boolean): void {
        this.debug = enabled;
        for (const instance of this.instances) {
            instance.cloud.updateSVGElements(enabled);
        }
    }

    setZoom(zoomLevel: number): void {
        this.zoom = Math.max(0.1, Math.min(5, zoomLevel));
        this.updateViewBox();
    }

    centerOnPoint(x: number, y: number): void {
        this.panX = x;
        this.panY = y;
        this.updateViewBox();
    }

    private updateViewBox(): void {
        const transition = this.getTransitionState();
        let centerX = this.panX;
        let centerY = this.panY;

        if (transition.isTransitioning || this.mode === 'foreground') {
            centerX = this.canvasWidth / 2;
            centerY = this.canvasHeight / 2;
        }

        const effectiveZoom = this.layoutManager.calculateEffectiveZoom(this.zoom, this.mode, transition);
        const [viewBoxX, viewBoxY, scaledWidth, scaledHeight] = this.layoutManager.calculateViewBox(centerX, centerY, effectiveZoom);
        this.svgElement?.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${scaledWidth} ${scaledHeight}`);

        if (this.debugBox) {
            const debugText =
                `Mode: ${this.mode}\n` +
                `Transition: ${this.transitionDirection} (${(this.transitionProgress * 100).toFixed(0)}%)\n` +
                `ViewBox: ${viewBoxX.toFixed(1)} ${viewBoxY.toFixed(1)} ${scaledWidth.toFixed(1)} ${scaledHeight.toFixed(1)}\n` +
                `Zoom: ${effectiveZoom.toFixed(2)}x`;
            this.debugBox.textContent = debugText;

            if (this.transitionDirection !== 'none' || this.mode === 'foreground') {
                console.log(debugText);
            }
        }
    }

    private getTransitionState(): TransitionState {
        return {
            isTransitioning: this.transitionDirection !== 'none',
            direction: this.transitionDirection,
            progress: this.transitionProgress
        };
    }

    clear(): void {
        if (!this.svgElement) return;
        for (const instance of this.instances) {
            const group = instance.cloud.getGroupElement();
            if (group) {
                this.svgElement.removeChild(group);
            }
            this.relationships.removeCloud(instance.cloud.id);
        }
        this.instances = [];
    }

    startAnimation(): void {
        if (this.animating) return;
        this.animating = true;
        this.lastFrameTime = performance.now();
        this.animate();
    }

    stopAnimation(): void {
        this.animating = false;
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    selectCloud(cloud: Cloud): void {
        this.selectedCloud = cloud;
        cloud.logKnotPositions();
        cloud.logAnimationSnapshot();

        if (this.mode === 'panorama') {
            this.enterForegroundMode(cloud);
        } else {
            const centerX = cloud.centerX + cloud.x;
            const centerY = cloud.centerY + cloud.y;
            this.centerOnPoint(centerX, centerY);
        }
    }

    private enterForegroundMode(cloud: Cloud): void {
        this.targetCloud = cloud;
        this.transitionProgress = 0;
        this.transitionDirection = 'forward';

        if (this.uiContainer) {
            this.uiContainer.style.display = 'block';
        }
    }

    private returnToPanorama(): void {
        this.transitionProgress = 0;
        this.transitionDirection = 'reverse';
    }

    private finishReturnToPanorama(): void {
        this.mode = 'panorama';

        if (this.targetCloud) {
            const targetInstance = this.instances.find(i => i.cloud === this.targetCloud);
            if (targetInstance) {
                const group = targetInstance.cloud.getGroupElement();
                if (group && group.parentNode === this.counterZoomGroup) {
                    this.svgElement!.appendChild(group);
                }
                this.updateCloudPosition(targetInstance);
            }
        }

        this.targetCloud = null;

        if (this.uiContainer) {
            this.uiContainer.style.display = 'none';
        }

        if (this.selfElement) {
            this.selfElement.removeAttribute('transform');
        }

        this.panX = this.canvasWidth / 2;
        this.panY = this.canvasHeight / 2;
        this.updateViewBox();

        for (const instance of this.instances) {
            this.updateCloudPosition(instance);
        }
    }

    private depthSort(): void {
        if (!this.svgElement) return;

        this.instances.sort((a, b) => a.position.z - b.position.z);

        let selfInserted = false;
        for (const instance of this.instances) {
            if (!selfInserted && instance.position.z >= 0 && this.selfElement && this.selfElement.parentNode === this.svgElement) {
                this.svgElement.appendChild(this.selfElement);
                selfInserted = true;
            }
            const group = instance.cloud.getGroupElement();
            if (group && group.parentNode === this.svgElement) {
                this.svgElement.appendChild(group);
            }
        }

        if (!selfInserted && this.selfElement && this.selfElement.parentNode === this.svgElement) {
            this.svgElement.appendChild(this.selfElement);
        }
    }

    private animate(): void {
        if (!this.animating) return;

        const currentTime = performance.now();
        const deltaTime = Math.min((currentTime - this.lastFrameTime) / 1000, 0.1);
        this.lastFrameTime = currentTime;

        if (this.transitionDirection === 'forward' && this.transitionProgress < 1) {
            this.transitionProgress = Math.min(1, this.transitionProgress + deltaTime / this.transitionDuration);
            if (this.transitionProgress >= 1) {
                this.mode = 'foreground';
                this.transitionDirection = 'none';
            }
            this.updateForegroundTransition();
        } else if (this.transitionDirection === 'reverse' && this.transitionProgress < 1) {
            this.transitionProgress = Math.min(1, this.transitionProgress + deltaTime / this.transitionDuration);
            this.updateForegroundTransition();
            if (this.transitionProgress >= 1) {
                this.finishReturnToPanorama();
                this.transitionDirection = 'none';
            }
        } else if (this.mode === 'foreground') {
            this.updateViewBox();
            this.updateSplitPaneLayout(1);
        } else {
            this.updateCounterZoom(1);
        }

        const isTransitioning = this.transitionDirection !== 'none' && this.transitionProgress < 1;
        let fadeProgress = 0;
        if (isTransitioning) {
            const transition = this.getTransitionState();
            fadeProgress = this.layoutManager.calculateFadeProgress(transition);
        }

        for (let i = 0; i < this.instances.length; i++) {
            const instance = this.instances[i];
            const isTargetCloud = instance.cloud === this.targetCloud;

            if (isTransitioning) {
                if (!isTargetCloud) {
                    const group = instance.cloud.getGroupElement();
                    if (group) {
                        const opacity = 1 - fadeProgress;
                        group.setAttribute('opacity', String(opacity));
                    }
                }
            } else if (this.mode === 'foreground' && !isTargetCloud) {
                const group = instance.cloud.getGroupElement();
                if (group && group.getAttribute('opacity') !== '0') {
                    group.setAttribute('opacity', '0');
                }
            }

            if (i % this.partitionCount === this.currentPartition) {
                instance.cloud.animate(deltaTime * this.partitionCount);

                if (this.mode === 'panorama' && !isTransitioning) {
                    if (isTargetCloud) {
                        throw new Error('Physics should not run on target cloud - target cloud should be null in panorama mode');
                    }
                    this.applyPhysics(instance, deltaTime * this.partitionCount);
                    this.updateCloudPosition(instance);
                }
                instance.cloud.updateSVGElements(this.debug);
            }
        }

        if (this.mode === 'panorama') {
            this.depthSort();
        }
        this.currentPartition = (this.currentPartition + 1) % this.partitionCount;
        this.animationFrameId = requestAnimationFrame(() => this.animate());
    }

    private updateForegroundTransition(): void {
        this.updateViewBox();
        const transition = this.getTransitionState();
        const eased = this.layoutManager.calculateFadeProgress(transition);
        this.updateSplitPaneLayout(eased);
    }

    private updateCounterZoom(currentZoomFactor: number): void {
        if (!this.counterZoomGroup) return;

        const counterScale = 1 / currentZoomFactor;
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;

        this.counterZoomGroup.setAttribute('transform',
            `translate(${centerX}, ${centerY}) scale(${counterScale}) translate(${-centerX}, ${-centerY})`);
    }

    private updateSplitPaneLayout(progress: number): void {
        if (!this.svgElement || !this.targetCloud) return;

        const targetInstance = this.instances.find(i => i.cloud === this.targetCloud);
        if (!targetInstance) return;

        const transition = this.getTransitionState();
        const positions = this.layoutManager.calculateSplitPanePositions(targetInstance, transition);

        this.updateCounterZoom(1 / positions.counterZoomScale);

        if (this.selfElement) {
            this.selfElement.setAttribute('transform',
                `translate(${positions.starX - this.canvasWidth / 2}, ${positions.starY - this.canvasHeight / 2})`);
        }

        const group = targetInstance.cloud.getGroupElement();
        if (group) {
            if (group.parentNode !== this.counterZoomGroup) {
                this.counterZoomGroup!.appendChild(group);
            }
            group.setAttribute('transform',
                `translate(${positions.cloudX}, ${positions.cloudY}) scale(${positions.cloudScale})`);
        }
    }

    private applyPhysics(instance: CloudInstance, deltaTime: number): void {
        this.physicsEngine.applyPhysics(instance, this.instances, deltaTime);
    }
}
