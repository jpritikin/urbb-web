import { Cloud, CloudType } from './cloudShape.js';
import { CloudRelationshipManager } from './cloudRelationshipManager.js';
import { PhysicsEngine } from './physicsEngine.js';
import { SimulatorModel, PartMessage } from './ifsModel.js';
import { SimulatorView } from './ifsView.js';
import { CarpetRenderer } from './carpetRenderer.js';
import { CloudInstance } from './types.js';
import { AnimatedStar } from './starAnimation.js';
import { PanoramaController } from './panoramaController.js';
import { PieMenuController } from './pieMenuController.js';
import { PieMenu } from './pieMenu.js';
import { TherapistAction, THERAPIST_ACTIONS } from './therapistActions.js';
import { BiographyField } from './selfRay.js';
import { createGroup } from './svgHelpers.js';
import { DualRNG, createDualRNG, SeededRNG } from './testability/rng.js';
import { ActionRecorder } from './testability/recorder.js';
import type { RecordedSession, RecordedAction, ControllerActionResult } from './testability/types.js';
import { SimulatorController } from './simulatorController.js';
import { formatActionLabel } from './actionFormatter.js';
import { UIManager } from './uiManager.js';
import { InputHandler } from './inputHandler.js';
import { ActionEffectApplicator } from './actionEffectApplicator.js';

export { CloudType };
export { TherapistAction, THERAPIST_ACTIONS };


declare global {
    interface Window {
        stopAnimations?: () => void;
        resumeAnimations?: () => void;
    }
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
    private partitionCount: number = 8;
    private currentPartition: number = 0;
    private animatedStar: AnimatedStar | null = null;
    private zoomGroup: SVGGElement | null = null;
    private uiGroup: SVGGElement | null = null;

    private uiManager: UIManager | null = null;
    private inputHandler: InputHandler | null = null;

    private physicsEngine: PhysicsEngine;
    private panoramaController: PanoramaController;
    private model: SimulatorModel;
    private view: SimulatorView;

    private selectedAction: TherapistAction | null = null;
    private onActionSelect: ((action: TherapistAction, cloud: Cloud) => void) | null = null;
    private relationshipClouds: Map<string, { instance: CloudInstance; region: string }> = new Map();
    private pieMenuController: PieMenuController | null = null;
    private pieMenuOverlay: SVGGElement | null = null;
    private originalCanvasWidth: number = 800;
    private originalCanvasHeight: number = 600;
    private resolvingClouds: Set<string> = new Set();
    private carpetRenderer: CarpetRenderer | null = null;
    private messageContainer: SVGGElement | null = null;
    private messageCooldownTimers: Map<string, number> = new Map();
    private blendStartTimers: Map<string, number> = new Map();
    private pendingGrievanceTargets: Map<string, string> = new Map();
    private genericDialogueCooldowns: Map<string, number> = new Map();
    private readonly BLEND_MESSAGE_DELAY = 3;
    private readonly GENERIC_DIALOGUE_INTERVAL = 8;
    private rng: DualRNG = createDualRNG();
    private recorder: ActionRecorder = new ActionRecorder();
    private controller: SimulatorController | null = null;
    private effectApplicator: ActionEffectApplicator | null = null;
    private insideAct: boolean = false;
    private resizeDebounceTimer: number | null = null;
    private fullscreenTransitioning: boolean = false;

    constructor() {
        this.physicsEngine = new PhysicsEngine({
            torusMajorRadius: 200,
            torusMinorRadius: 80,
            torusRotationX: Math.PI / 3,
            friction: 0.6,
            repulsionStrength: 20,
            surfaceRepulsionStrength: 20,
            angularAcceleration: 100
        });
        this.panoramaController = new PanoramaController(this.physicsEngine);

        this.model = new SimulatorModel();
        this.view = new SimulatorView(800, 600);
        PieMenu.setGlobalVisibilityCallback((visible) => {
            this.view.setConferenceRotationPaused(visible);
        });
        this.initController();
    }

    private initController(): void {
        this.controller = new SimulatorController({
            model: this.model,
            relationships: this.relationships,
            rng: this.rng,
            getPartName: (id) => this.getCloudById(id)?.text ?? id
        });
        this.effectApplicator = new ActionEffectApplicator(this.model, this.view);
    }

    setRNG(rng: DualRNG): void {
        this.rng = rng;
        this.initController();
    }

    getRNG(): DualRNG {
        return this.rng;
    }

    startRecording(codeVersion: string): void {
        if (!(this.rng.model instanceof SeededRNG)) {
            const seed = Math.floor(Math.random() * 2147483647);
            this.setRNG(createDualRNG(seed));
        }
        const platform = this.uiManager?.isMobile() ? 'mobile' : 'desktop';
        this.recorder.start(
            this.model.toJSON(),
            this.relationships.toJSON(),
            codeVersion,
            platform,
            this.rng.model as SeededRNG,
            this.rng
        );
        this.uiManager?.showRecording();
    }

    stopRecording(): RecordedSession | null {
        const session = this.recorder.getSession(
            this.model.toJSON(),
            this.relationships.toJSON()
        );
        this.recorder.clear();
        this.uiManager?.hideRecording();
        return session;
    }

    isRecording(): boolean {
        return this.recorder.isRecording();
    }

    init(containerId: string): void {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`Container ${containerId} not found`);
            return;
        }

        this.view.setHtmlContainer(this.container);

        this.svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svgElement.setAttribute('width', String(this.canvasWidth));
        this.svgElement.setAttribute('height', String(this.canvasHeight));
        this.svgElement.setAttribute('viewBox', `0 0 ${this.canvasWidth} ${this.canvasHeight}`);
        this.svgElement.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        this.svgElement.style.border = '1px solid #ccc';
        this.svgElement.style.background = '#e5fdff';

        this.container.appendChild(this.svgElement);

        // zoomGroup contains content that zooms (clouds, carpet, rays)
        this.zoomGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.zoomGroup.setAttribute('id', 'zoom-group');
        this.svgElement.appendChild(this.zoomGroup);

        // uiGroup contains content that stays in screen coordinates (star, pie menu, toggle)
        this.uiGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.uiGroup.setAttribute('id', 'ui-group');
        this.svgElement.appendChild(this.uiGroup);

        const rayContainer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        rayContainer.setAttribute('id', 'ray-container');
        this.zoomGroup.appendChild(rayContainer);
        this.view.setRayContainer(rayContainer);

        this.pieMenuOverlay = createGroup({ id: 'pie-menu-overlay' });
        this.uiGroup.appendChild(this.pieMenuOverlay);
        this.view.setPieMenuOverlay(this.pieMenuOverlay);

        this.messageContainer = createGroup({ id: 'message-container' });
        this.uiGroup.appendChild(this.messageContainer);
        this.view.setMessageContainer(this.messageContainer);
        this.view.setOnMessageReceived((message) => this.onMessageReceived(message));

        const thoughtBubbleContainer = createGroup({ id: 'thought-bubble-container' });
        this.uiGroup.appendChild(thoughtBubbleContainer);
        this.view.setThoughtBubbleContainer(thoughtBubbleContainer);
        this.view.setOnThoughtBubbleDismiss(() => this.model.clearThoughtBubbles());

        this.pieMenuController = new PieMenuController(this.uiGroup, this.pieMenuOverlay, {
            getCloudById: (id) => this.getCloudById(id),
            model: this.model,
            view: this.view,
            relationships: this.relationships,
        });
        this.pieMenuController.setOnActionSelect((action, cloud) => this.handleActionClick(action, cloud));
        this.pieMenuController.setOnBiographySelect((field, cloudId) => this.handleRayFieldSelect(field, cloudId));
        this.pieMenuController.setGetPartContext((cloudId) => ({
            isProtector: this.relationships.getProtecting(cloudId).size > 0,
            isIdentityRevealed: this.model.parts.isIdentityRevealed(cloudId),
            isAttacked: this.model.parts.isAttacked(cloudId),
            partName: this.model.parts.getPartName(cloudId),
        }));
        this.pieMenuController.setOnClose(() => {
            this.inputHandler?.setHoveredCloud(null);
            this.updateAllCloudStyles();
        });

        this.inputHandler = new InputHandler(
            {
                model: this.model,
                view: this.view,
                pieMenuController: this.pieMenuController,
                getCloudById: (id) => this.getCloudById(id),
                updateAllCloudStyles: () => this.updateAllCloudStyles(),
            },
            {
                onCloudSelected: (cloud, touchEvent) => this.handlePanoramaSelect(cloud),
                onTargetActionComplete: (action, sourceCloudId, targetCloudId) => {
                    if (action.id === 'notice_part') {
                        this.handleNoticePart(sourceCloudId, targetCloudId);
                    }
                },
                onPendingTargetSet: (text, cloudId) => this.showThoughtBubble(text, cloudId),
            }
        );

        this.carpetRenderer = new CarpetRenderer(this.canvasWidth, this.canvasHeight, this.zoomGroup);
        this.view.setOnSelfRayClick((cloudId, x, y, event) => {
            const touchEvent = (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) ? event : undefined;
            this.pieMenuController?.toggleSelfRay(cloudId, x, y, touchEvent);
        });
        this.view.setOnModeChange((mode) => {
            if (mode === 'panorama') {
                this.model.clearSelfRay();
            }
            this.inputHandler?.clearPendingTargetAction();
            this.updateUIForMode();
            this.uiManager?.setMode(mode);
        });

        this.createSelfStar();

        this.uiManager = new UIManager(this.container, this.svgElement, this.uiGroup, {
            canvasWidth: this.canvasWidth,
            canvasHeight: this.canvasHeight,
            onModeToggle: (isForeground) => this.handleModeToggle(isForeground),
            onFullscreenToggle: () => this.toggleFullscreen(),
            onAnimationPauseToggle: () => this.toggleAnimationPause(),
            onTracePanelToggle: () => this.toggleTracePanel(),
        });
        this.uiManager.createAllUI();

        this.panX = this.canvasWidth / 2;
        this.panY = this.canvasHeight / 2;
        this.updateViewBox();
        this.setupVisibilityHandling();
        this.setupFullscreenHandling();
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
        if (!this.uiGroup) return;

        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;

        this.animatedStar = new AnimatedStar(centerX, centerY);
        const starElement = this.animatedStar.createElement();

        this.uiGroup.appendChild(starElement);
        this.view.setStarElement(starElement);

        // Expose star for console testing: star.testTransition('removing', 6, 5)
        (window as unknown as { star: AnimatedStar }).star = this.animatedStar;
    }

    private handleModeToggle(isForeground: boolean): void {
        const mode = isForeground ? 'foreground' : 'panorama';
        this.act(`Mode: ${mode}`, () => {
            this.view.setMode(mode);
            this.updateUIForMode();
            this.uiManager?.setMode(mode);
        });
    }

    private setupFullscreenHandling(): void {
        document.addEventListener('fullscreenchange', () => {
            this.fullscreenTransitioning = true;
            if (document.fullscreenElement) {
                this.uiManager?.setFullscreen(true);
                this.requestLandscapeOrientation();
            } else {
                this.uiManager?.setFullscreen(false);
                this.unlockOrientation();
            }
            this.scheduleResize();
        });

        window.addEventListener('resize', () => {
            if (this.fullscreenTransitioning || this.uiManager?.getIsFullscreen()) {
                if (this.uiManager?.getIsFullscreen() && !this.uiManager.isLandscape() && this.uiManager.isMobile()) {
                    this.exitFullscreen();
                    return;
                }
                this.scheduleResize();
            }
        });
    }

    private scheduleResize(): void {
        if (this.resizeDebounceTimer !== null) {
            cancelAnimationFrame(this.resizeDebounceTimer);
        }
        this.resizeDebounceTimer = requestAnimationFrame(() => {
            this.resizeDebounceTimer = requestAnimationFrame(() => {
                this.resizeDebounceTimer = null;
                this.fullscreenTransitioning = false;
                if (this.uiManager?.getIsFullscreen()) {
                    this.resizeCanvasToViewport();
                } else {
                    this.restoreCanvasSize();
                }
            });
        });
    }

    private async toggleFullscreen(): Promise<void> {
        if (this.uiManager?.getIsFullscreen()) {
            await this.exitFullscreen();
        } else {
            await this.enterFullscreen();
        }
    }

    private async enterFullscreen(): Promise<void> {
        if (!this.container || !this.uiManager) return;

        if (!this.uiManager.isLandscape() && this.uiManager.isMobile()) {
            return;
        }

        try {
            await this.container.requestFullscreen();
            // enterFullscreenMode() will be called by fullscreenchange handler
        } catch {
            // Fallback for browsers without fullscreen API
            this.enterFullscreenMode();
        }
    }

    private enterFullscreenMode(): void {
        this.uiManager?.setFullscreen(true);
        this.requestLandscapeOrientation();
        this.scheduleResize();
    }

    private async exitFullscreen(): Promise<void> {
        if (document.fullscreenElement) {
            await document.exitFullscreen();
        } else {
            this.exitFullscreenMode();
        }
    }

    private exitFullscreenMode(): void {
        this.uiManager?.setFullscreen(false);
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

    private resizeCanvasToViewport(): void {
        if (!this.svgElement || !this.container) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.canvasWidth = width;
        this.canvasHeight = height;

        this.svgElement.setAttribute('width', String(width));
        this.svgElement.setAttribute('height', String(height));
        this.svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);

        this.view.setDimensions(width, height);
        this.panX = width / 2;
        this.panY = height / 2;

        if (this.animatedStar) {
            this.animatedStar.setPosition(width / 2, height / 2);
        }

        this.carpetRenderer?.setDimensions(width, height);
        this.uiManager?.updateDimensions(width, height);
        this.updateViewBox();
    }

    private restoreCanvasSize(): void {
        if (!this.svgElement) return;

        this.canvasWidth = this.originalCanvasWidth;
        this.canvasHeight = this.originalCanvasHeight;

        this.svgElement.setAttribute('width', String(this.originalCanvasWidth));
        this.svgElement.setAttribute('height', String(this.originalCanvasHeight));
        this.svgElement.setAttribute('viewBox', `0 0 ${this.originalCanvasWidth} ${this.originalCanvasHeight}`);

        this.view.setDimensions(this.originalCanvasWidth, this.originalCanvasHeight);
        this.panX = this.originalCanvasWidth / 2;
        this.panY = this.originalCanvasHeight / 2;

        if (this.animatedStar) {
            this.animatedStar.setPosition(this.originalCanvasWidth / 2, this.originalCanvasHeight / 2);
        }

        this.carpetRenderer?.setDimensions(this.originalCanvasWidth, this.originalCanvasHeight);
        this.uiManager?.updateDimensions(this.originalCanvasWidth, this.originalCanvasHeight);
        this.updateViewBox();
    }

    isPieMenuOpen(): boolean {
        return this.pieMenuController?.isOpen() ?? false;
    }

    private toggleTracePanel(): void {
        this.uiManager?.toggleTracePanel();
    }

    private toggleAnimationPause(): void {
        if (this.animating) {
            this.stopAnimation();
            this.uiManager?.setAnimationPaused(true);
        } else {
            this.animating = true;
            this.lastFrameTime = performance.now();
            this.animate();
            this.uiManager?.setAnimationPaused(false);
        }
    }

    private handleActionClick(action: TherapistAction, targetCloud?: Cloud): void {
        const selectedId = this.pieMenuController?.getSelectedCloudId();
        const cloud = targetCloud ?? (selectedId ? this.getCloudById(selectedId) : null);
        if (!cloud || !this.controller) return;

        this.selectedAction = action;

        if (this.model.getBlendReason(cloud.id) === 'spontaneous') {
            this.model.setBlendReason(cloud.id, 'therapist');
        }

        const rec: RecordedAction = { action: action.id, cloudId: cloud.id };
        const isBlended = this.model.isBlended(cloud.id);

        if (action.id === 'notice_part') {
            this.inputHandler?.setPendingTargetAction(action, cloud.id);
            this.showThoughtBubble("Which part?", cloud.id);
            return;
        }

        this.act(rec, () => {
            const result = this.controller!.executeAction(action.id, cloud.id, { isBlended });
            this.applyActionResult(result, cloud.id);
        });

        if (this.onActionSelect) {
            this.onActionSelect(action, cloud);
        }
    }

    private applyActionResult(result: ControllerActionResult, cloudId: string): void {
        this.effectApplicator!.apply(result, cloudId);
    }

    setActionSelectHandler(handler: (action: TherapistAction, cloud: Cloud) => void): void {
        this.onActionSelect = handler;
    }

    getSelectedAction(): TherapistAction | null {
        return this.selectedAction;
    }

    private showThoughtBubble(text: string, cloudId: string): void {
        this.model.addThoughtBubble(text, cloudId);
    }

    private hideThoughtBubble(): void {
        this.model.clearThoughtBubbles();
    }

    private handleRayFieldSelect(field: 'age' | 'identity' | 'job' | 'jobAppraisal' | 'jobImpact' | 'gratitude' | 'whatNeedToKnow' | 'compassion' | 'apologize', cloudId: string): void {
        this.inputHandler?.clearPendingTargetAction();
        if (!this.controller) return;

        this.act({ action: 'ray_field_select', cloudId, field }, () => {
            const result = this.controller!.executeAction('ray_field_select', cloudId, { field });
            this.applyActionResult(result, cloudId);
        });
    }

    private updateThoughtBubbles(): void {
        this.model.expireThoughtBubbles();
        this.view.syncThoughtBubbles(this.model);
    }

    private positionRelatedCloud(instance: CloudInstance, region: string, index: number, total: number): void {
        if (!this.zoomGroup) return;

        const regionPositions = {
            protector: { x: this.canvasWidth * 0.25, y: this.canvasHeight * 0.25 },
            grievance: { x: this.canvasWidth * 0.25, y: this.canvasHeight * 0.75 },
        };

        const basePos = regionPositions[region as keyof typeof regionPositions];
        const offsetY = (index - (total - 1) / 2) * 60;

        const group = instance.cloud.getGroupElement();
        if (group) {
            if (group.parentNode !== this.zoomGroup) {
                this.zoomGroup.appendChild(group);
            }
            group.setAttribute('transform', `translate(${basePos.x}, ${basePos.y + offsetY}) scale(1)`);
            group.setAttribute('opacity', '1');
        }

        this.relationshipClouds.set(instance.cloud.id, { instance, region });
    }

    private clearRelatedClouds(): void {
        this.relationshipClouds.clear();
        this.model.clearSupportingParts();
    }

    addCloud(word: string, options?: {
        id?: string;
        trust?: number;
        needAttention?: number;
        agreedWaitUntil?: number;
        partAge?: number | string;
        dialogues?: { burdenedJobAppraisal?: string[]; burdenedJobImpact?: string[]; unburdenedJob?: string; genericBlendedDialogues?: string[] };
    }): Cloud {
        if (!this.svgElement) throw new Error('SVG element not initialized');

        const position = this.physicsEngine.generateTorusPosition();

        const cloud = new Cloud(word, 0, 0, undefined, { id: options?.id });
        this.model.registerPart(cloud.id, word, {
            trust: options?.trust,
            needAttention: options?.needAttention,
            agreedWaitUntil: options?.agreedWaitUntil,
            partAge: options?.partAge,
            dialogues: options?.dialogues,
        });

        const state = this.model.getPartState(cloud.id);
        const eventHandlers = this.inputHandler?.createCloudEventHandlers(cloud) ?? {
            onClick: () => {},
            onHover: () => {},
            onLongPressStart: () => {},
            onLongPressEnd: () => {},
            onTouchStart: () => {},
            onTouchEnd: () => {},
        };
        const group = cloud.createSVGElements(eventHandlers);
        this.zoomGroup?.appendChild(group);
        cloud.updateSVGElements(this.debug, state, false);

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
        const projected = this.view.projectToScreen(instance);
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

    applyAssessedNeedAttention(): void {
        for (const instance of this.instances) {
            const assessed = this.relationships.assessNeedAttention(instance.cloud.id);
            this.model.parts.setNeedAttention(instance.cloud.id, assessed);
            if (this.relationships.getProxyFor(instance.cloud.id).size > 0) {
                this.model.parts.markAsProxy(instance.cloud.id);
            }
        }
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
        this.updateAllCloudStyles();
    }

    private updateAllCloudStyles(): void {
        const hoveredCloudId = this.inputHandler?.getHoveredCloudId() ?? null;
        for (const instance of this.instances) {
            const state = this.model.getPartState(instance.cloud.id);
            const hovered = hoveredCloudId === instance.cloud.id;
            instance.cloud.updateSVGElements(this.debug, state, hovered);
        }
    }

    setCarpetDebug(enabled: boolean): void {
        this.carpetRenderer?.setDebugMode(enabled);
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
        // ViewBox stays fixed - zooming is done via zoomGroup transform
        this.svgElement?.setAttribute('viewBox', `0 0 ${this.canvasWidth} ${this.canvasHeight}`);
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

        const panoramaPositions = new Map<string, { x: number; y: number; scale: number }>();
        for (const instance of this.instances) {
            const projected = this.view.projectToScreen(instance);
            panoramaPositions.set(instance.cloud.id, {
                x: projected.x,
                y: projected.y,
                scale: projected.scale
            });
        }
        this.view.initializeViewStates(this.instances, panoramaPositions);

        this.animating = true;
        this.lastFrameTime = performance.now();
        this.animate();

        window.stopAnimations = () => this.stopAnimation();
        window.resumeAnimations = () => {
            if (!this.animating) {
                this.animating = true;
                this.lastFrameTime = performance.now();
                this.animate();
            }
        };
    }

    stopAnimation(): void {
        this.animating = false;
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    private handlePanoramaSelect(cloud: Cloud): void {
        this.act({ action: 'select_a_target', cloudId: cloud.id }, () => {
            this.model.setTargetCloud(cloud.id);
            this.view.setMode('foreground');
            this.updateUIForMode();
            this.uiManager?.setMode('foreground');
        });
    }

    private handleNoticePart(protectorId: string, targetCloudId: string): void {
        if (!this.controller) return;

        this.act({ action: 'notice_part', cloudId: protectorId, targetCloudId }, () => {
            const result = this.controller!.executeAction('notice_part', protectorId, { targetCloudId });
            this.applyActionResult(result, protectorId);
        });
    }

    private promotePendingBlend(cloudId: string): void {
        if (!this.model.isPendingBlend(cloudId)) return;

        const pending = this.model.getPendingBlends().find(p => p.cloudId === cloudId);
        if (!pending) return;

        const name = this.model.parts.getPartName(cloudId);
        this.act(`${name} blends`, () => {
            const tempQueue: { cloudId: string; reason: 'spontaneous' | 'therapist' }[] = [];
            let item = this.model.dequeuePendingBlend();
            while (item && item.cloudId !== cloudId) {
                tempQueue.push(item);
                item = this.model.dequeuePendingBlend();
            }
            for (const temp of tempQueue) {
                this.model.enqueuePendingBlend(temp.cloudId, temp.reason);
            }
            if (item) {
                this.model.addBlendedPart(cloudId, item.reason);
            }
        });
    }

    private finishUnblending(cloudId: string): void {
        const cloud = this.getCloudById(cloudId);
        if (!cloud) return;

        // Get target seat position while still blended
        const targetPos = this.view.getBlendedStretchTarget(cloud, this.model);
        if (!targetPos) {
            this.completeUnblending(cloudId);
            return;
        }

        // Skip stretch animation for spontaneous blends - go directly to target
        if (this.model.getBlendReason(cloudId) !== 'therapist') {
            this.completeUnblending(cloudId);
            return;
        }

        // Animate the stretch resolving smoothly, then promote
        this.animateStretchResolution(cloudId, 1.0);
    }

    private animateStretchResolution(cloudId: string, duration: number): void {
        const cloud = this.getCloudById(cloudId);
        if (!cloud) return;

        const initialStretch = cloud.getBlendedStretch();
        const debugState = this.view.getCloudState(cloudId);
        console.log('[animateStretchResolution]', cloudId, {
            hasStretch: !!initialStretch,
            stretch: initialStretch,
            cloudPos: debugState ? { x: debugState.x, y: debugState.y } : null,
            isSeated: this.view.isSeated(cloudId)
        });
        if (!initialStretch) {
            this.completeUnblending(cloudId);
            return;
        }

        // Get the ACTUAL current lattice offset, not the target stretch
        const actualOffset = cloud.getActualLatticeOffset();
        const startStretchX = actualOffset?.x ?? initialStretch.stretchX;
        const startStretchY = actualOffset?.y ?? initialStretch.stretchY;

        // Mark as resolving so updateBlendedLatticeDeformations doesn't interfere
        this.resolvingClouds.add(cloudId);

        const cloudState = this.view.getCloudState(cloudId);

        // Get current position from cloudState
        const startPosX = cloudState?.x ?? 0;
        const startPosY = cloudState?.y ?? 0;

        // The far edge of the stretched cloud (seat side)
        const startFarEdgeX = startPosX + startStretchX;
        const startFarEdgeY = startPosY + startStretchY;

        // Update cloudState to use absolute position during resolution
        if (cloudState) {
            cloudState.positionTarget = { type: 'absolute', x: startPosX, y: startPosY };
            cloudState.smoothing.position = 0;
        }

        const startTime = performance.now();

        const animate = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            const progress = Math.min(1, elapsed / duration);
            const eased = progress; // linear

            // Get current seat position (tracks rotating table)
            const currentSeatPos = this.view.getCloudPosition(cloudId)
                ?? { x: startFarEdgeX, y: startFarEdgeY };

            // Reduce stretch toward zero
            const remainingStretch = 1 - eased;
            cloud.setBlendedStretchImmediate(
                startStretchX * remainingStretch,
                startStretchY * remainingStretch,
                initialStretch.anchorSide
            );

            // Move far edge from starting position toward current seat position
            const currentFarEdgeX = startFarEdgeX + (currentSeatPos.x - startFarEdgeX) * eased;
            const currentFarEdgeY = startFarEdgeY + (currentSeatPos.y - startFarEdgeY) * eased;

            // Position = far edge - remaining stretch
            const newX = currentFarEdgeX - startStretchX * remainingStretch;
            const newY = currentFarEdgeY - startStretchY * remainingStretch;

            if (cloudState) {
                cloudState.positionTarget = { type: 'absolute', x: newX, y: newY };
                cloudState.x = newX;
                cloudState.y = newY;
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                cloud.clearBlendedStretch();
                this.resolvingClouds.delete(cloudId);
                if (cloudState) {
                    cloudState.smoothing.position = 8;
                }
                this.completeUnblending(cloudId);
            }
        };

        requestAnimationFrame(animate);
    }

    private completeUnblending(cloudId: string): void {
        const name = this.model.parts.getPartName(cloudId);
        this.act(`${name} separates`, () => {
            this.model.promoteBlendedToTarget(cloudId);
        });
    }

    private syncViewWithModel(oldModel: SimulatorModel | null = null): void {
        const panoramaPositions = new Map<string, { x: number; y: number; scale: number }>();
        const cloudNames = new Map<string, string>();
        for (const instance of this.instances) {
            const projected = this.view.projectToScreen(instance);
            panoramaPositions.set(instance.cloud.id, {
                x: projected.x,
                y: projected.y,
                scale: projected.scale
            });
            cloudNames.set(instance.cloud.id, instance.cloud.text);
        }

        this.view.setCloudNames(cloudNames);
        this.view.syncWithModel(oldModel, this.model, this.instances, panoramaPositions);
    }

    private act(action: string | RecordedAction, fn: () => void): void {
        if (this.insideAct) {
            throw new Error('Nested act() calls are not allowed');
        }

        const recordedAction = typeof action === 'string' ? undefined : action;
        const label = typeof action === 'string'
            ? action
            : formatActionLabel(action, (id) => this.getCloudById(id)?.text ?? id);

        this.view.setAction(label);
        const oldModel = this.model.clone();
        this.insideAct = true;
        try {
            fn();
        } finally {
            this.insideAct = false;
        }
        this.syncViewWithModel(oldModel);
        if (recordedAction && this.recorder.isRecording()) {
            this.recorder.record(recordedAction, this.view.getViewStateSnapshot());
        }
    }

    private updateUIForMode(): void {
        const mode = this.view.getMode();

        if (mode !== 'foreground') {
            this.hideThoughtBubble();
            this.hidePieMenu();
            this.clearMessages();
        }
    }

    private clearMessages(): void {
        this.model.clearMessages();
        this.view.clearMessages();
    }

    private hidePieMenu(): void {
        this.pieMenuController?.hide();
    }

    private animate(): void {
        if (!this.animating) return;

        if (document.hidden) {
            this.lastFrameTime = performance.now();
            this.animationFrameId = requestAnimationFrame(() => this.animate());
            return;
        }

        const currentTime = performance.now();
        const deltaTime = Math.min((currentTime - this.lastFrameTime) / 1000, 0.1);
        this.lastFrameTime = currentTime;

        this.view.animate(deltaTime);
        this.updateStarScale();
        this.animatedStar?.animate(deltaTime);

        const mode = this.view.getMode();
        const isTransitioning = this.view.isTransitioning();

        if (isTransitioning) {
            this.syncViewWithModel();
        }

        if (this.view.isSeatCountAnimating() || this.view.isConferenceRotating()) {
            this.view.updateForegroundPositions(this.model, this.instances);
        }

        // Animate unified cloud states
        const panoramaPositions = new Map<string, { x: number; y: number; scale: number }>();
        for (const instance of this.instances) {
            const projected = this.view.projectToScreen(instance);
            panoramaPositions.set(instance.cloud.id, projected);
        }
        const { completedUnblendings, completedPendingBlends } = this.view.animateCloudStates(deltaTime, panoramaPositions, this.model);
        for (const cloudId of completedUnblendings) {
            if (this.model.isBlended(cloudId)) {
                this.finishUnblending(cloudId);
            }
        }
        for (const cloudId of completedPendingBlends) {
            this.promotePendingBlend(cloudId);
        }

        this.updateZoomGroup();

        if (mode === 'foreground') {
            this.updateThoughtBubbles();
            this.view.updateSelfRayPosition();
            this.view.animateSelfRay(deltaTime);
            this.view.animateStretchEffects(deltaTime);
            this.view.animateSpiralExits();
            this.view.animateFlyOutExits();
            this.view.animateSupportingEntries(this.model);
            this.view.animateDelayedArrivals(this.model);
            this.view.updateBlendedLatticeDeformations(this.model, this.instances, this.resolvingClouds);
            const transitioningToForeground = isTransitioning && this.view.getTransitionDirection() === 'forward';
            if (this.carpetRenderer && !transitioningToForeground) {
                const carpetStates = this.view.getCarpetStates();
                const seats = this.view.getSeats();
                this.carpetRenderer.update(carpetStates, seats, deltaTime);
                this.carpetRenderer.render(carpetStates);
                this.carpetRenderer.renderDebugWaveField(carpetStates);
            }
            this.updateMessageTimers(deltaTime);
            if (!isTransitioning && !this.isPieMenuOpen()) {
                this.checkAndSendGrievanceMessages();
                this.checkAndShowGenericDialogues(deltaTime);
                this.checkBlendedPartsAttention();
            }
            this.view.animateMessages(deltaTime);
        } else {
            this.carpetRenderer?.clear();
        }

        const targetIds = this.model.getTargetCloudIds();

        for (let i = 0; i < this.instances.length; i++) {
            const instance = this.instances[i];

            if (i % this.partitionCount === this.currentPartition) {
                instance.cloud.animate(deltaTime * this.partitionCount);

                if (this.view.getMode() === 'panorama' && !this.view.isTransitioning()) {
                    this.panoramaController.applyPhysics(instance, this.instances, deltaTime * this.partitionCount);
                }
                const state = this.model.getPartState(instance.cloud.id);
                const hovered = this.inputHandler?.getHoveredCloudId() === instance.cloud.id;
                instance.cloud.updateSVGElements(this.debug, state, hovered);
            }

            const cloudState = this.view.getCloudState(instance.cloud.id);
            if (cloudState) {
                instance.cloud.animatedBlendingDegree = cloudState.blendingDegree;

                const group = instance.cloud.getGroupElement();
                if (group) {
                    group.setAttribute('transform',
                        `translate(${cloudState.x}, ${cloudState.y}) scale(${cloudState.scale})`);
                    group.setAttribute('opacity', String(cloudState.opacity));
                    const enablePointerEvents = cloudState.opacity > 0.1;
                    group.setAttribute('pointer-events', enablePointerEvents ? 'auto' : 'none');
                }
            }
        }

        this.increaseGrievanceNeedAttention(deltaTime);
        this.updateHelpPanel();
        if (this.uiManager?.isTracePanelVisible()) {
            this.uiManager.updateTrace(this.view.getTrace());
        }

        if (!this.isPieMenuOpen()) {
            const demandingCloudId = this.model.checkAttentionDemands(this.relationships);
            if (demandingCloudId) {
                this.act({ action: 'spontaneous_blend', cloudId: demandingCloudId }, () => {
                    this.controller?.executeAction('spontaneous_blend', demandingCloudId);
                });
            }
        }

        if (this.view.getMode() === 'panorama') {
            this.panoramaController.depthSort(this.instances, this.zoomGroup!, this.animatedStar?.getElement() ?? null);
        } else {
            // Ensure correct layering in zoomGroup: ray (bottom), carpet, clouds (top)
            if (this.zoomGroup) {
                const rayContainer = this.zoomGroup.querySelector('#ray-container');
                const carpetGroup = this.zoomGroup.querySelector('#carpet-group');

                if (rayContainer && rayContainer !== this.zoomGroup.firstChild) {
                    this.zoomGroup.insertBefore(rayContainer, this.zoomGroup.firstChild);
                }

                if (carpetGroup && rayContainer && carpetGroup.previousSibling !== rayContainer) {
                    this.zoomGroup.insertBefore(carpetGroup, rayContainer.nextSibling);
                }
            }
        }
        this.currentPartition = (this.currentPartition + 1) % this.partitionCount;
        this.animationFrameId = requestAnimationFrame(() => this.animate());
    }

    private updateStarScale(): void {
        if (!this.animatedStar) return;

        if (this.view.getMode() === 'foreground') {
            const targetIds = this.model.getTargetCloudIds();
            const blendedParts = this.model.getBlendedParts();
            const totalParts = targetIds.size + blendedParts.length;
            const scale = totalParts > 0 ? 5 / Math.sqrt(totalParts) : 6;
            this.animatedStar.setTargetRadiusScale(scale);
        } else {
            this.animatedStar.setTargetRadiusScale(1.5);
        }
    }

    private updateZoomGroup(): void {
        if (!this.zoomGroup || !this.uiGroup) return;

        const mode = this.view.getMode();
        const isTransitioning = this.view.isTransitioning();
        const starElement = this.animatedStar?.getElement();
        const foregroundCloudIds = this.view.getForegroundCloudIds();

        if (mode === 'foreground' && !isTransitioning) {
            // In foreground mode, no zoom transform - clouds are at screen coords
            this.zoomGroup.removeAttribute('transform');

            // Move star to uiGroup first (it should be behind clouds)
            if (starElement && starElement.parentNode !== this.uiGroup) {
                // Insert star at beginning of uiGroup, before other elements
                this.uiGroup.insertBefore(starElement, this.uiGroup.firstChild);
            }

            // Move foreground clouds to uiGroup (after star, before pie menu overlay)
            for (const cloudId of foregroundCloudIds) {
                const cloud = this.getCloudById(cloudId);
                const group = cloud?.getGroupElement();
                if (group && group.parentNode !== this.uiGroup) {
                    // Insert before pie menu overlay to keep overlay on top
                    if (this.pieMenuOverlay) {
                        this.uiGroup.insertBefore(group, this.pieMenuOverlay);
                    } else {
                        this.uiGroup.appendChild(group);
                    }
                }
            }
        } else {
            // In panorama mode or during transition, apply zoom centered on canvas
            const centerX = this.canvasWidth / 2;
            const centerY = this.canvasHeight / 2;
            const scale = this.zoom;

            this.zoomGroup.setAttribute('transform',
                `translate(${centerX}, ${centerY}) scale(${scale}) translate(${-centerX}, ${-centerY})`);

            // Move star to zoomGroup for depth-sorting with clouds
            if (starElement && starElement.parentNode !== this.zoomGroup) {
                this.zoomGroup.appendChild(starElement);
            }
            // Move all clouds back to zoomGroup for panorama mode
            for (const instance of this.instances) {
                const group = instance.cloud.getGroupElement();
                if (group && group.parentNode !== this.zoomGroup) {
                    this.zoomGroup.appendChild(group);
                }
            }
        }
    }

    private sendMessage(senderId: string, targetId: string, text: string, type: 'grievance'): void {
        const senderState = this.view.getCloudState(senderId);
        const targetState = this.view.getCloudState(targetId);
        if (!senderState || !targetState) return;

        const senderName = this.model.parts.getPartName(senderId);
        const targetName = this.model.parts.getPartName(targetId);
        const actionLabel = senderId === targetId
            ? `${senderName} spirals in self-grievance`
            : `${senderName} sends grievance to ${targetName}`;
        let message: PartMessage | null = null;
        this.act(actionLabel, () => {
            message = this.model.sendMessage(senderId, targetId, text, type);
        });
        if (message) {
            this.view.startMessage(message, senderState.x, senderState.y, targetState.x, targetState.y);
        }
    }

    private onMessageReceived(message: PartMessage): void {
        if (message.type === 'grievance') {
            this.model.parts.adjustTrust(message.targetId, 0.99);
            this.model.parts.adjustNeedAttention(message.senderId, 0.8);
            if (message.senderId !== message.targetId) {
                this.model.parts.setAttacked(message.targetId);
            }
        }
        this.model.removeMessage(message.id);
    }

    private checkBlendedPartsAttention(): void {
        const blendedParts = this.model.getBlendedParts();
        for (const cloudId of blendedParts) {
            if (this.resolvingClouds.has(cloudId)) continue;
            if (this.model.getBlendReason(cloudId) !== 'spontaneous') continue;

            if (this.model.parts.getNeedAttention(cloudId) < 0.25) {
                this.finishUnblending(cloudId);
            }
        }
    }

    private updateHelpPanel(): void {
        let lowestTrust: { name: string; trust: number } | null = null;
        let highestNeedAttention: { name: string; needAttention: number } | null = null;

        for (const instance of this.instances) {
            const cloudId = instance.cloud.id;
            const trust = this.model.parts.getTrust(cloudId);
            const needAttention = this.model.parts.getNeedAttention(cloudId);

            if (lowestTrust === null || trust < lowestTrust.trust) {
                lowestTrust = { name: instance.cloud.text, trust };
            }
            if (highestNeedAttention === null || needAttention > highestNeedAttention.needAttention) {
                highestNeedAttention = { name: instance.cloud.text, needAttention };
            }
        }

        this.view.updateHelpPanel({ lowestTrust, highestNeedAttention });
    }

    private increaseGrievanceNeedAttention(deltaTime: number): void {
        this.model.increaseGrievanceNeedAttention(this.relationships, deltaTime);
    }

    private updateMessageTimers(deltaTime: number): void {
        // Update cooldown timers
        for (const [key, time] of this.messageCooldownTimers) {
            this.messageCooldownTimers.set(key, time + deltaTime);
        }
        // Update blend start timers
        for (const [key, time] of this.blendStartTimers) {
            this.blendStartTimers.set(key, time + deltaTime);
        }
    }

    private checkAndSendGrievanceMessages(): void {
        // Don't send messages while spiral exits are active or parts are awaiting arrival
        if (this.view.hasActiveSpiralExits()) return;

        const blendedParts = this.model.getBlendedParts();
        const targetIds = this.model.getTargetCloudIds();

        // Track new blends and clean up old blend timers
        for (const blendedId of blendedParts) {
            if (!this.blendStartTimers.has(blendedId)) {
                this.blendStartTimers.set(blendedId, 0);
            }
        }
        for (const blendedId of this.blendStartTimers.keys()) {
            if (!blendedParts.includes(blendedId)) {
                this.blendStartTimers.delete(blendedId);
            }
        }

        for (const blendedId of blendedParts) {
            const blendedCloud = this.getCloudById(blendedId);
            if (!blendedCloud) continue;

            // Don't send messages from parts that have revealed their unburdened job
            if (this.model.parts.isUnburdenedJobRevealed(blendedId)) continue;

            // Don't send messages from parts that haven't visually arrived yet
            if (this.view.isAwaitingArrival(blendedId)) continue;

            const blendTime = this.blendStartTimers.get(blendedId) ?? 0;
            if (blendTime < this.BLEND_MESSAGE_DELAY) continue;

            const grievanceTargets = this.relationships.getGrievanceTargets(blendedId);
            if (grievanceTargets.size === 0) continue;

            // Single cooldown timer per blended part
            const timeSinceSent = this.messageCooldownTimers.get(blendedId) ?? 10;
            if (timeSinceSent < 3) continue;

            // Check if there's a pending target from a previous summon
            let grievanceTargetId = this.pendingGrievanceTargets.get(blendedId);

            if (!grievanceTargetId) {
                if (timeSinceSent < 10) continue;
                // Pick a random target from all grievance targets
                const grievanceTargetArray = Array.from(grievanceTargets);
                grievanceTargetId = this.rng.model.pickRandom(grievanceTargetArray, 'grievance_target');
            }

            const dialogues = this.relationships.getGrievanceDialogues(blendedId, grievanceTargetId);
            if (dialogues.length === 0) continue;

            // If target is not in conference yet, summon them (unless it's a self-grievance)
            if (!targetIds.has(grievanceTargetId) && grievanceTargetId !== blendedId) {
                const blenderName = this.model.parts.getPartName(blendedId);
                const targetName = this.model.parts.getPartName(grievanceTargetId);
                this.act(`${blenderName} summons ${targetName}`, () => {
                    this.model.addTargetCloud(grievanceTargetId);
                });
                this.pendingGrievanceTargets.set(blendedId, grievanceTargetId);
                this.messageCooldownTimers.set(blendedId, 0);
                continue;
            }

            // Don't send messages to parts that haven't visually arrived yet
            if (this.view.isAwaitingArrival(grievanceTargetId)) continue;

            const text = this.rng.cosmetic.pickRandom(dialogues);
            this.sendMessage(blendedId, grievanceTargetId, text, 'grievance');
            this.messageCooldownTimers.set(blendedId, 0);
            // Clear the pending target since we just sent the message
            this.pendingGrievanceTargets.delete(blendedId);
        }
    }

    private checkAndShowGenericDialogues(deltaTime: number): void {
        if (this.view.hasActiveSpiralExits()) return;

        const blendedParts = this.model.getBlendedParts();

        for (const blendedId of this.genericDialogueCooldowns.keys()) {
            if (!blendedParts.includes(blendedId)) {
                this.genericDialogueCooldowns.delete(blendedId);
            }
        }

        for (const blendedId of blendedParts) {
            if (this.view.isAwaitingArrival(blendedId)) continue;

            const blendTime = this.blendStartTimers.get(blendedId) ?? 0;
            if (blendTime < this.BLEND_MESSAGE_DELAY) continue;

            const hasGrievances = this.relationships.getGrievanceTargets(blendedId).size > 0;
            if (hasGrievances) continue;

            const dialogues = this.model.parts.getDialogues(blendedId)?.genericBlendedDialogues;
            if (!dialogues || dialogues.length === 0) continue;

            const cooldown = this.genericDialogueCooldowns.get(blendedId) ?? this.GENERIC_DIALOGUE_INTERVAL;
            const newCooldown = cooldown + deltaTime;
            this.genericDialogueCooldowns.set(blendedId, newCooldown);

            if (newCooldown >= this.GENERIC_DIALOGUE_INTERVAL) {
                const text = this.rng.cosmetic.pickRandom(dialogues);
                this.showThoughtBubble(text, blendedId);
                this.genericDialogueCooldowns.set(blendedId, 0);
                break;
            }
        }
    }
}
