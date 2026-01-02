import { Cloud, CloudType } from './cloudShape.js';
import { CloudRelationshipManager } from './cloudRelationshipManager.js';
import { SimulatorModel, PartMessage } from '../simulator/ifsModel.js';
import { SimulatorView } from '../simulator/ifsView.js';
import { CarpetRenderer } from '../star/carpetRenderer.js';
import { CloudInstance } from '../utils/types.js';
import { AnimatedStar } from '../star/starAnimation.js';
import { PanoramaCloudMotion } from './panoramaCloudMotion.js';
import { PieMenuController } from '../menu/pieMenuController.js';
import { PieMenu } from '../menu/pieMenu.js';
import type { TherapistAction } from '../simulator/therapistActions.js';
import { createGroup } from '../utils/svgHelpers.js';
import { RNG, createModelRNG, SeededRNG } from '../playback/testability/rng.js';
import { ActionRecorder } from '../playback/testability/recorder.js';
import type { RecordedSession, RecordedAction, ControllerActionResult, SerializedModel, SerializedRelationships } from '../playback/testability/types.js';
import { SimulatorController } from '../simulator/simulatorController.js';
import { STAR_CLOUD_ID, RAY_CLOUD_ID, MODE_TOGGLE_CLOUD_ID } from '../simulator/view/SeatManager.js';
import { formatActionLabel } from '../simulator/actionFormatter.js';
import { UIManager } from '../simulator/uiManager.js';
import { InputHandler } from '../simulator/inputHandler.js';
import { ActionEffectApplicator } from '../simulator/actionEffectApplicator.js';
import { FullscreenManager } from '../utils/fullscreenManager.js';
import { AnimationLoop } from '../utils/animationLoop.js';
import { MessageOrchestrator } from '../simulator/messageOrchestrator.js';
import { PanoramaInputHandler } from './panoramaInputHandler.js';
import { ExpandDeepenEffect } from './expandDeepenEffect.js';
import { PlaybackController, PlaybackCallbacks, ActionResult, ModelState, MenuSliceInfo } from '../playback/playback.js';
import { TimeAdvancer } from '../simulator/timeAdvancer.js';

export { CloudType };
export type { TherapistAction };


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
    private canvasWidth: number = 800;
    private canvasHeight: number = 600;
    private panX: number = 0;
    private panY: number = 0;
    private animationLoop: AnimationLoop;
    private partitionCount: number = 8;
    private currentPartition: number = 0;
    private animatedStar: AnimatedStar | null = null;
    private zoomGroup: SVGGElement | null = null;
    private uiGroup: SVGGElement | null = null;

    private uiManager: UIManager | null = null;
    private inputHandler: InputHandler | null = null;
    private fullscreenManager: FullscreenManager | null = null;
    private messageOrchestrator: MessageOrchestrator | null = null;
    private panoramaInputHandler: PanoramaInputHandler | null = null;

    private panoramaMotion: PanoramaCloudMotion;
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
    private rng: RNG = createModelRNG();
    private recorder: ActionRecorder = new ActionRecorder();
    private controller: SimulatorController | null = null;
    private effectApplicator: ActionEffectApplicator | null = null;
    private insideAct: boolean = false;
    private downloadSessionHandler: (() => void) | null = null;
    private lastHelpPanelUpdate: number = 0;
    private expandDeepenEffect: ExpandDeepenEffect | null = null;
    private playbackController: PlaybackController | null = null;
    private pauseTimeEffects: boolean = false;
    private lastActionResult: ActionResult | null = null;
    private timeAdvancer: TimeAdvancer | null = null;

    constructor() {
        this.animationLoop = new AnimationLoop((dt) => this.animate(dt));
        this.panoramaMotion = new PanoramaCloudMotion({
            torusMajorRadiusX: this.canvasWidth * 0.35,
            torusMajorRadiusY: this.canvasHeight * 0.35,
            torusMinorRadius: 80,
            torusRotationX: Math.PI / 3,
            maxVelocity: 10,
            minRetargetInterval: 5,
            maxRetargetInterval: 30,
            angularVelocity: -0.1
        });

        this.model = new SimulatorModel();
        this.view = new SimulatorView(800, 600);
        PieMenu.setGlobalVisibilityCallback((visible) => {
            this.view.setConferenceRotationPaused(visible);
            this.view.setHelpPanelVisible(!visible);
        });
        this.initController();
    }

    private initController(): void {
        this.controller = new SimulatorController({
            getModel: () => this.model,
            getRelationships: () => this.relationships,
            rng: this.rng,
            getPartName: (id) => this.getCloudById(id)?.text ?? id
        });
        this.effectApplicator = new ActionEffectApplicator(() => this.model, this.view);
    }

    setRNG(rng: RNG): void {
        this.rng = rng;
        this.initController();
        this.messageOrchestrator?.setRNG(rng);
        this.panoramaMotion.setRandom(() => Math.random());
    }

    getRNG(): RNG {
        return this.rng;
    }

    setSeed(seed: number): void {
        this.setRNG(createModelRNG(seed));
    }

    restoreFromSession(initialModel: SerializedModel, initialRelationships: SerializedRelationships): void {
        if (!this.svgElement) throw new Error('SVG element not initialized');

        this.model = SimulatorModel.fromJSON(initialModel);
        this.relationships = CloudRelationshipManager.fromJSON(initialRelationships);

        for (const [cloudId, partState] of Object.entries(initialModel.partStates)) {
            const cloud = this.createCloudVisual(partState.name, cloudId);
            this.updateCloudVisual(cloud);
        }
    }

    private createCloudVisual(name: string, id?: string): Cloud {
        const position = this.panoramaMotion.generateInitialPosition();
        const cloud = new Cloud(name, 0, 0, undefined, { id });
        this.panoramaMotion.initializeCloud(cloud.id, position);

        const eventHandlers = this.inputHandler?.createCloudEventHandlers(cloud) ?? {
            onClick: () => { },
            onHover: () => { },
            onLongPressStart: () => { },
            onLongPressEnd: () => { },
            onTouchStart: () => { },
            onTouchEnd: () => { },
        };
        const group = cloud.createSVGElements(eventHandlers);
        this.zoomGroup?.appendChild(group);

        const instance: CloudInstance = {
            cloud,
            position,
            velocity: { x: 0, y: 0, z: 0 }
        };
        this.instances.push(instance);
        this.updateCloudPosition(instance);
        return cloud;
    }

    private updateCloudVisual(cloud: Cloud): void {
        const state = this.model.getPartState(cloud.id);
        cloud.updateSVGElements(this.debug, state, false);
    }

    startRecording(codeVersion: string): void {
        if (!(this.rng instanceof SeededRNG)) {
            const seed = Math.floor(Math.random() * 2147483647);
            this.setRNG(createModelRNG(seed));
        }
        const platform = this.uiManager?.isMobile() ? 'mobile' : 'desktop';
        this.recorder.start(
            this.model.toJSON(),
            this.relationships.toJSON(),
            codeVersion,
            platform,
            this.rng as SeededRNG
        );
    }

    getRecordingSession(): RecordedSession | null {
        return this.recorder.getSession(
            this.model.toJSON(),
            this.relationships.toJSON()
        );
    }

    stopRecording(): RecordedSession | null {
        const session = this.recorder.getSession(
            this.model.toJSON(),
            this.relationships.toJSON()
        );
        this.recorder.clear();
        return session;
    }

    isRecording(): boolean {
        return this.recorder.isRecording();
    }

    setDownloadSessionHandler(handler: () => void): void {
        this.downloadSessionHandler = handler;
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

        // rayContainer is in screen coordinates but renders underneath clouds
        const rayContainer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        rayContainer.setAttribute('id', 'ray-container');
        this.svgElement.insertBefore(rayContainer, this.zoomGroup);
        this.view.setRayContainer(rayContainer);

        // uiGroup contains content that stays in screen coordinates (star, pie menu, toggle)
        this.uiGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.uiGroup.setAttribute('id', 'ui-group');
        this.svgElement.appendChild(this.uiGroup);

        this.pieMenuOverlay = createGroup({ id: 'pie-menu-overlay' });
        this.uiGroup.appendChild(this.pieMenuOverlay);
        this.view.setPieMenuOverlay(this.pieMenuOverlay);

        this.messageContainer = createGroup({ id: 'message-container' });
        this.uiGroup.appendChild(this.messageContainer);
        this.view.setMessageContainer(this.messageContainer, (cloudId) => this.getCloudVisualCenter(cloudId));

        this.messageOrchestrator = new MessageOrchestrator(
            () => this.model,
            this.view,
            () => this.relationships,
            this.rng,
            {
                act: (label, fn) => this.act(label, fn),
                showThoughtBubble: (text, cloudId) => this.showThoughtBubble(text, cloudId),
                getCloudById: (id) => this.getCloudById(id),
            }
        );
        this.view.setOnMessageReceived((message) => this.messageOrchestrator!.onMessageReceived(message));

        this.timeAdvancer = new TimeAdvancer(
            () => this.model,
            () => this.relationships,
            this.messageOrchestrator,
            this.rng,
            {
                getMode: () => this.view.getMode(),
                onSpontaneousBlend: (event, lastAttentionCheck) => {
                    // Record intervals processed before this blend triggered
                    if (this.recorder.isRecording()) {
                        const intervalCount = this.timeAdvancer?.getAndResetIntervalCount() ?? 0;
                        if (intervalCount > 0) {
                            this.recorder.recordIntervals(intervalCount);
                        }
                    }
                    this.recorder.markSpontaneousBlendTriggered(
                        this.rng.getCallCount(),
                        lastAttentionCheck
                    );
                    this.handleSpontaneousBlend(event.cloudId, event.urgent);
                },
            }
        );

        const thoughtBubbleContainer = createGroup({ id: 'thought-bubble-container' });
        this.uiGroup.appendChild(thoughtBubbleContainer);
        this.view.setThoughtBubbleContainer(thoughtBubbleContainer);
        this.view.setOnThoughtBubbleDismiss(() => this.model.clearThoughtBubbles());

        this.pieMenuController = new PieMenuController(this.uiGroup, this.pieMenuOverlay, {
            getCloudById: (id) => this.getCloudById(id),
            getModel: () => this.model,
            view: this.view,
            getRelationships: () => this.relationships,
            getController: () => this.controller ?? undefined,
        });
        this.pieMenuController.setOnActionSelect((action, cloud) => this.handleActionClick(action, cloud));
        this.pieMenuController.setOnStarActionSelect((action) => this.handleStarActionClick(action));
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
                    } else if (action.id === 'feel_toward') {
                        this.handleFeelToward(targetCloudId);
                    }
                },
                onPendingTargetSet: (text, cloudId) => this.showThoughtBubble(text, cloudId),
            }
        );

        this.carpetRenderer = new CarpetRenderer(this.canvasWidth, this.canvasHeight, this.uiGroup);
        this.carpetRenderer.setOnCarpetDrag(
            (carpetId, x, y) => this.view.setCarpetPosition(carpetId, x, y),
            () => this.view.clearCarpetDragging()
        );
        // Ensure carpet is at the back (first child) so clouds render on top
        const carpetGroup = this.uiGroup.querySelector('#carpet-group');
        if (carpetGroup && this.uiGroup.firstChild !== carpetGroup) {
            this.uiGroup.insertBefore(carpetGroup, this.uiGroup.firstChild);
        }

        const seatDebugGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        seatDebugGroup.setAttribute('id', 'seat-debug-group');
        this.uiGroup.appendChild(seatDebugGroup);
        this.view.setSeatDebugGroup(seatDebugGroup);

        const panoramaDebugGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        panoramaDebugGroup.setAttribute('id', 'panorama-debug-group');
        this.zoomGroup.appendChild(panoramaDebugGroup);
        this.panoramaMotion.setDebugGroup(panoramaDebugGroup);
        this.view.setOnSelfRayClick((cloudId, _x, _y, event) => {
            const starPos = this.view.getStarScreenPosition();
            const cloudState = this.view.getCloudState(cloudId);
            const cloudPos = cloudState ? { x: cloudState.x, y: cloudState.y } : starPos;
            const menuX = starPos.x + (cloudPos.x - starPos.x) / 3;
            const menuY = starPos.y + (cloudPos.y - starPos.y) / 3;
            const touchEvent = (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) ? event : undefined;
            this.pieMenuController?.toggleSelfRay(cloudId, menuX, menuY, touchEvent);
        });
        this.view.setOnModeChange((mode) => {
            const applyModeChange = () => {
                if (mode === 'panorama') {
                    this.model.clearSelfRay();
                }
                this.inputHandler?.clearPendingTargetAction();
                this.updateUIForMode();
                this.uiManager?.setMode(mode);
            };
            if (this.insideAct) {
                applyModeChange();
            } else {
                this.act({ action: 'mode_change', cloudId: '', newMode: mode }, applyModeChange);
            }
        });
        this.view.on('transition-started', ({ direction }) => {
            this.onTransitionStart(direction);
        });
        this.view.on('transition-completed', () => {
            this.finalizeCloudGroups();
        });
        this.view.on('clouds-joined-foreground', ({ cloudIds }) => {
            for (const cloudId of cloudIds) {
                this.moveCloudToUIGroup(cloudId);
            }
        });

        this.createSelfStar();

        this.expandDeepenEffect = new ExpandDeepenEffect();
        this.expandDeepenEffect.attach(this.container);
        this.expandDeepenEffect.setDimensions(this.canvasWidth, this.canvasHeight);
        if (this.animatedStar) {
            this.expandDeepenEffect.setStarColor(this.animatedStar.getFillColor());
        }

        this.uiManager = new UIManager(this.container, this.svgElement, this.uiGroup, {
            canvasWidth: this.canvasWidth,
            canvasHeight: this.canvasHeight,
            onModeToggle: (isForeground) => this.handleModeToggle(isForeground),
            onFullscreenToggle: () => this.toggleFullscreen(),
            onAnimationPauseToggle: () => this.toggleAnimationPause(),
            onTracePanelToggle: () => this.toggleTracePanel(),
            onDownloadSession: () => this.downloadSessionHandler?.(),
        });
        this.uiManager.createAllUI();

        this.panX = this.canvasWidth / 2;
        this.panY = this.canvasHeight / 2;
        this.updateViewBox();

        this.fullscreenManager = new FullscreenManager(
            this.container,
            this.svgElement,
            this.originalCanvasWidth,
            this.originalCanvasHeight,
            {
                onResize: (width, height) => this.handleResize(width, height),
                getIsFullscreen: () => this.uiManager?.getIsFullscreen() ?? false,
                setFullscreen: (value) => this.uiManager?.setFullscreen(value),
                isMobile: () => this.uiManager?.isMobile() ?? false,
                isLandscape: () => this.uiManager?.isLandscape() ?? false,
            }
        );
        this.fullscreenManager.setup();
        this.animationLoop.setupVisibilityHandling();

        this.panoramaInputHandler = new PanoramaInputHandler(
            this.svgElement,
            {
                getMode: () => this.view.getMode(),
                getZoom: () => this.view.getPanoramaZoom(),
                setZoom: (zoom) => this.view.setPanoramaZoom(zoom),
            }
        );
    }

    private handleResize(width: number, height: number): void {
        this.canvasWidth = width;
        this.canvasHeight = height;
        this.panX = width / 2;
        this.panY = height / 2;

        this.view.setDimensions(width, height);
        this.animatedStar?.setPosition(width / 2, height / 2);
        this.carpetRenderer?.setDimensions(width, height);
        this.uiManager?.updateDimensions(width, height);
        this.expandDeepenEffect?.setDimensions(width, height);
        this.panoramaMotion.setDimensions(width, height);
        this.updateViewBox();
    }

    private createSelfStar(): void {
        if (!this.uiGroup) return;

        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;

        this.animatedStar = new AnimatedStar(centerX, centerY);
        this.animatedStar.setOnClick((_x, _y, event) => {
            if (this.pieMenuController && this.view.getMode() === 'foreground') {
                const starPos = this.view.getStarScreenPosition();
                const touchEvent = (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) ? event : undefined;
                this.pieMenuController.toggleStar(starPos.x, starPos.y, touchEvent);
            }
        });
        const starElement = this.animatedStar.createElement();

        this.uiGroup.appendChild(starElement);
        this.view.setStarElement(starElement);

        // Expose star for console testing: star.testTransition('removing', 6, 5)
        (window as unknown as { star: AnimatedStar }).star = this.animatedStar;
    }

    private handleModeToggle(isForeground: boolean): void {
        const mode = isForeground ? 'foreground' : 'panorama';
        // mode_change is recorded via setOnModeChange callback when view.setMode emits 'mode-changed'
        this.view.setMode(mode);
    }

    private toggleFullscreen(): void {
        this.fullscreenManager?.toggle();
    }

    isPieMenuOpen(): boolean {
        return this.pieMenuController?.isOpen() ?? false;
    }

    private toggleTracePanel(): void {
        this.uiManager?.toggleTracePanel();
        this.uiManager?.updateTrace(this.view.getTrace());
    }

    private toggleAnimationPause(): void {
        if (this.animationLoop.isRunning()) {
            this.animationLoop.stop();
            this.uiManager?.setAnimationPaused(true);
        } else {
            this.animationLoop.start();
            this.uiManager?.setAnimationPaused(false);
        }
    }

    private handleStarActionClick(action: TherapistAction): void {
        if (!this.controller) return;

        this.selectedAction = action;
        this.hidePieMenu();

        if (action.id === 'feel_toward') {
            this.inputHandler?.setPendingTargetAction(action, STAR_CLOUD_ID);
            this.showThoughtBubble("Which part?", STAR_CLOUD_ID);
            return;
        }

        if (action.id === 'expand_deepen') {
            this.expandDeepenEffect?.start();
        }

        const rec: RecordedAction = { action: action.id, cloudId: STAR_CLOUD_ID };
        this.act(rec, () => {
            const result = this.controller!.executeAction(action.id, STAR_CLOUD_ID);
            this.applyActionResult(result, STAR_CLOUD_ID);
        });
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
        this.lastActionResult = {
            success: result.success,
            error: result.message
        };
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

    addCloud(word: string, options?: {
        id?: string;
        trust?: number;
        needAttention?: number;
        agreedWaitUntil?: number;
        partAge?: number | string;
        dialogues?: { burdenedJobAppraisal?: string[]; burdenedJobImpact?: string[]; unburdenedJob?: string; genericBlendedDialogues?: string[] };
    }): Cloud {
        if (!this.svgElement) throw new Error('SVG element not initialized');

        const cloud = this.createCloudVisual(word, options?.id);

        this.model.registerPart(cloud.id, word, {
            trust: options?.trust,
            needAttention: options?.needAttention,
            agreedWaitUntil: options?.agreedWaitUntil,
            partAge: options?.partAge,
            dialogues: options?.dialogues,
        });

        this.updateCloudVisual(cloud);
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
        }
    }

    getCloudById(id: string): Cloud | null {
        const instance = this.instances.find(i => i.cloud.id === id);
        return instance?.cloud ?? null;
    }

    private getCloudVisualCenter(cloudId: string): { x: number; y: number } | null {
        const cloudState = this.view.getCloudState(cloudId);
        if (!cloudState || cloudState.opacity < 0.1) return null;
        const mode = this.view.getMode();
        const transitioning = this.view.isTransitioning();
        let pos = { x: cloudState.x, y: cloudState.y };
        if (mode !== 'foreground' && !transitioning) {
            const zoom = this.view.getCurrentZoomFactor();
            const centerX = this.canvasWidth / 2;
            const centerY = this.canvasHeight / 2;
            pos = {
                x: centerX + (pos.x - centerX) * zoom,
                y: centerY + (pos.y - centerY) * zoom
            };
        }
        const margin = 50;
        if (pos.x < -margin || pos.x > this.canvasWidth + margin ||
            pos.y < -margin || pos.y > this.canvasHeight + margin) {
            return null;
        }
        return pos;
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

    setSeatDebug(enabled: boolean): void {
        this.view.setSeatDebug(enabled);
    }

    setPanoramaDebug(enabled: boolean): void {
        this.panoramaMotion.setDebugEnabled(enabled);
    }

    finalizePanoramaSetup(): void {
        this.panoramaMotion.finalizeInitialization(this.instances);
    }

    setZoom(zoomLevel: number): void {
        this.view.setPanoramaZoom(zoomLevel);
    }

    setTransitionDuration(seconds: number): void {
        this.view.setTransitionDuration(seconds);
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
        if (this.animationLoop.isRunning()) return;

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

        this.animationLoop.start();

        window.stopAnimations = () => this.animationLoop.stop();
        window.resumeAnimations = () => this.animationLoop.start();
    }

    stopAnimation(): void {
        this.animationLoop.stop();
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

    private handleFeelToward(targetCloudId: string): void {
        if (!this.controller) return;

        this.model.removeThoughtBubblesForCloud(STAR_CLOUD_ID);
        this.act({ action: 'feel_toward', cloudId: targetCloudId }, () => {
            const result = this.controller!.executeAction('feel_toward', targetCloudId);
            this.applyActionResult(result, targetCloudId);
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
        this.view.syncWithModel(oldModel, this.model, this.instances, panoramaPositions, this.relationships);
        const noBlendedParts = this.model.getBlendedParts().length === 0 && !this.model.peekPendingBlend();
        this.animatedStar?.setPointerEventsEnabled(noBlendedParts);
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
        // Record intervals BEFORE the action (they happened before user clicked)
        if (recordedAction && this.recorder.isRecording()) {
            const intervalCount = this.timeAdvancer?.getAndResetIntervalCount() ?? 0;
            if (intervalCount > 0) {
                this.recorder.recordIntervals(intervalCount);
            }
        }
        this.insideAct = true;
        try {
            fn();
        } finally {
            this.insideAct = false;
        }
        this.syncViewWithModel(oldModel);
        if (recordedAction && this.recorder.isRecording()) {
            const orchState = this.messageOrchestrator?.getDebugState();
            const selfRay = this.model.getSelfRay();
            const biography: Record<string, { ageRevealed: boolean; identityRevealed: boolean; jobRevealed: boolean; jobAppraisalRevealed: boolean; jobImpactRevealed: boolean }> = {};
            const needAttention: Record<string, number> = {};
            const trust: Record<string, number> = {};
            for (const cloudId of this.model.getAllPartIds()) {
                biography[cloudId] = {
                    ageRevealed: this.model.parts.isAgeRevealed(cloudId),
                    identityRevealed: this.model.parts.isIdentityRevealed(cloudId),
                    jobRevealed: this.model.parts.isJobRevealed(cloudId),
                    jobAppraisalRevealed: this.model.parts.isJobAppraisalRevealed(cloudId),
                    jobImpactRevealed: this.model.parts.isJobImpactRevealed(cloudId),
                };
                needAttention[cloudId] = this.model.parts.getNeedAttention(cloudId);
                trust[cloudId] = this.model.parts.getTrust(cloudId);
            }
            const modelState = {
                targets: [...this.model.getTargetCloudIds()],
                blended: this.model.getBlendedParts(),
                selfRay: selfRay ? { targetCloudId: selfRay.targetCloudId } : null,
                biography,
                needAttention,
                trust,
            };
            this.recorder.record(recordedAction, orchState, modelState);
        }
        if (this.uiManager?.isTracePanelVisible()) {
            this.uiManager.updateTrace(this.view.getTrace());
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

    private animate(deltaTime: number): void {
        this.playbackController?.update(deltaTime);
        this.view.animate(deltaTime);
        this.updateStarScale();
        this.animatedStar?.animate(deltaTime);

        const mode = this.view.getMode();
        const isTransitioning = this.view.isTransitioning();

        if (isTransitioning) {
            this.syncViewWithModel();
        }

        if (this.view.isConferenceRotating()) {
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
                this.view.renderSeatDebug();
            }
            if (!this.pauseTimeEffects && !isTransitioning) {
                this.checkBlendedPartsAttention();
            }
            this.view.animateMessages(deltaTime);

            // Update and render expand/deepen effect
            if (this.expandDeepenEffect?.isActive()) {
                this.expandDeepenEffect.update(deltaTime, this.model);
                const starPos = this.view.getStarScreenPosition();
                this.expandDeepenEffect.render(starPos.x, starPos.y);
            }
            // Always sync border opacity (returns 1 when effect inactive)
            if (this.expandDeepenEffect) {
                this.animatedStar?.setBorderOpacity(this.expandDeepenEffect.getBorderOpacity());
            }
        } else {
            // Cancel expand/deepen effect when leaving foreground
            this.expandDeepenEffect?.cancel();
            this.carpetRenderer?.clear();
            // Clear stretch once fully released during panorama
            for (const instance of this.instances) {
                if (instance.cloud.isStretchReleased()) {
                    instance.cloud.clearBlendedStretch();
                }
            }
        }

        if (this.view.getMode() === 'panorama' && !this.view.isTransitioning()) {
            const userRotation = this.panoramaInputHandler?.consumePendingRotation() ?? 0;
            this.panoramaMotion.animate(this.instances, deltaTime, userRotation);
        }

        for (let i = 0; i < this.instances.length; i++) {
            const instance = this.instances[i];

            if (i % this.partitionCount === this.currentPartition) {
                instance.cloud.animate(deltaTime * this.partitionCount);
                const state = this.model.getPartState(instance.cloud.id);
                const hovered = this.inputHandler?.getHoveredCloudId() === instance.cloud.id;
                instance.cloud.updateSVGElements(this.debug, state, hovered);
            }

            const cloudState = this.view.getCloudState(instance.cloud.id);
            if (cloudState) {
                instance.cloud.animatedBlendingDegree = cloudState.blendingDegree;
                instance.cloud.x = cloudState.x;
                instance.cloud.y = cloudState.y;

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

        if (!this.pauseTimeEffects && !this.view.isTransitioning()) {
            this.timeAdvancer?.advance(deltaTime);
            if (this.recorder.isRecording()) {
                this.recorder.addEffectiveTime(deltaTime);
            }
        }
        this.view.checkVictoryCondition(this.model, this.relationships);
        this.lastHelpPanelUpdate += deltaTime;
        if (this.lastHelpPanelUpdate >= 0.25) {
            this.lastHelpPanelUpdate = 0;
            this.updateHelpPanel();
        }

        const inPanorama = this.view.getMode() === 'panorama' && !this.view.isTransitioning();
        if (inPanorama) {
            this.panoramaMotion.depthSort(this.instances, this.zoomGroup!, this.animatedStar?.getElement() ?? null);
            const debugGroup = this.zoomGroup!.querySelector('#panorama-debug-group');
            if (debugGroup) {
                this.zoomGroup!.appendChild(debugGroup);
            }
            this.panoramaMotion.renderDebug(this.instances, this.canvasWidth, this.canvasHeight, 600);
        } else {
            // Ensure carpet is at bottom of zoomGroup (clouds render on top)
            if (this.zoomGroup) {
                const carpetGroup = this.zoomGroup.querySelector('#carpet-group');
                if (carpetGroup && carpetGroup !== this.zoomGroup.firstChild) {
                    this.zoomGroup.insertBefore(carpetGroup, this.zoomGroup.firstChild);
                }
            }
        }
        this.currentPartition = (this.currentPartition + 1) % this.partitionCount;
    }

    private updateStarScale(): void {
        if (!this.animatedStar) return;

        const starElement = this.animatedStar.getElement();
        const inZoomGroup = starElement?.parentNode === this.zoomGroup;
        const isReverseTransition = this.view.getTransitionDirection() === 'reverse';

        if (this.view.getMode() === 'foreground') {
            // Foreground mode: scale based on part count
            const targetIds = this.model.getTargetCloudIds();
            const blendedParts = this.model.getBlendedParts();
            const totalParts = targetIds.size + blendedParts.length;
            const visualTarget = totalParts > 0 ? 5 / Math.sqrt(totalParts) : 6;
            this.animatedStar.setTargetRadiusScale(visualTarget);
        } else if (isReverseTransition && !inZoomGroup) {
            // Reverse transition with star in uiGroup: animate toward panorama visual size
            // Star will be moved to zoomGroup after transition, where its scale will be divided by zoom
            const panoramaZoom = this.view.getPanoramaZoom();
            this.animatedStar.setTargetRadiusScale(1.5 * panoramaZoom);
        } else {
            // Panorama mode with star in zoomGroup: use fixed scale, let zoomGroup handle zoom
            this.animatedStar.setTargetRadiusScale(1.5);
        }
    }

    private updateZoomGroup(): void {
        if (!this.zoomGroup) return;

        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        const scale = this.view.getCurrentZoomFactor();

        this.zoomGroup.setAttribute('transform',
            `translate(${centerX}, ${centerY}) scale(${scale}) translate(${-centerX}, ${-centerY})`);
    }

    private moveCloudToUIGroup(cloudId: string): void {
        if (!this.zoomGroup || !this.uiGroup) return;

        const cloud = this.getCloudById(cloudId);
        const group = cloud?.getGroupElement();
        if (!group || group.parentNode === this.uiGroup) return;

        // Always use panoramaZoom for the transform so reverse transitions work correctly.
        // The view's panorama-ui position target also uses panoramaZoom.
        const zoom = this.view.getPanoramaZoom();
        const cloudState = this.view.getCloudState(cloudId);
        if (cloudState) {
            const centerX = this.canvasWidth / 2;
            const centerY = this.canvasHeight / 2;
            // Transform from zoomGroup coords to uiGroup (screen) coords
            cloudState.x = centerX + (cloudState.x - centerX) * zoom;
            cloudState.y = centerY + (cloudState.y - centerY) * zoom;
            cloudState.scale = cloudState.scale * zoom;
        }

        if (this.pieMenuOverlay) {
            this.uiGroup.insertBefore(group, this.pieMenuOverlay);
        } else {
            this.uiGroup.appendChild(group);
        }
    }

    private moveCloudToZoomGroup(cloudId: string): void {
        if (!this.zoomGroup || !this.uiGroup) return;

        const cloud = this.getCloudById(cloudId);
        const group = cloud?.getGroupElement();
        if (!group || group.parentNode === this.zoomGroup) return;

        const zoom = this.view.getPanoramaZoom();
        const cloudState = this.view.getCloudState(cloudId);
        if (cloudState) {
            const centerX = this.canvasWidth / 2;
            const centerY = this.canvasHeight / 2;
            // Transform from uiGroup (screen) coords to zoomGroup coords
            cloudState.x = centerX + (cloudState.x - centerX) / zoom;
            cloudState.y = centerY + (cloudState.y - centerY) / zoom;
            cloudState.scale = cloudState.scale / zoom;
            // Also update targets so no further animation needed
            cloudState.targetScale = cloudState.scale;
            cloudState.positionTarget = { type: 'panorama' };
        }

        this.zoomGroup.appendChild(group);
    }

    private moveStarToUIGroup(): void {
        if (!this.zoomGroup || !this.uiGroup || !this.animatedStar) return;

        const starElement = this.animatedStar.getElement();
        if (!starElement || starElement.parentNode === this.uiGroup) return;

        const zoom = this.view.getCurrentZoomFactor();
        const scaleBefore = this.animatedStar.getRadiusScale();
        // Star offset is relative to center; in zoomGroup it gets scaled
        // Transform to uiGroup: multiply offset and scale by zoom
        this.view.transformStarPosition(zoom);
        this.animatedStar.setRadiusScale(scaleBefore * zoom);

        this.uiGroup.insertBefore(starElement, this.uiGroup.firstChild);
    }

    private moveStarToZoomGroup(): void {
        if (!this.zoomGroup || !this.uiGroup || !this.animatedStar) return;

        const starElement = this.animatedStar.getElement();
        if (!starElement || starElement.parentNode === this.zoomGroup) return;

        const zoom = this.view.getCurrentZoomFactor();
        const scaleBefore = this.animatedStar.getRadiusScale();
        // Transform from uiGroup to zoomGroup: divide offset and scale by zoom
        this.view.transformStarPosition(1 / zoom);
        this.animatedStar.setRadiusScale(scaleBefore / zoom);

        this.zoomGroup.appendChild(starElement);
    }

    private onTransitionStart(direction: 'forward' | 'reverse'): void {
        if (!this.zoomGroup || !this.uiGroup) return;

        // For forward: use conference clouds (what WILL be in foreground)
        // For reverse: use previous foreground clouds (what IS currently in foreground)
        const foregroundCloudIds = direction === 'forward'
            ? this.model.getConferenceCloudIds()
            : this.view.getForegroundCloudIds();

        if (direction === 'forward') {
            // panorama → fg: move participating clouds and star to uiGroup at start
            for (const cloudId of foregroundCloudIds) {
                this.moveCloudToUIGroup(cloudId);
            }
            this.moveStarToUIGroup();
        } else {
            // fg → panorama: release stretch gradually on partially blended clouds
            for (const cloudId of this.model.getBlendedParts()) {
                const cloud = this.getCloudById(cloudId);
                cloud?.releaseBlendedStretch();
            }
        }
    }

    private finalizeCloudGroups(): void {
        if (!this.zoomGroup || !this.uiGroup) return;

        const mode = this.view.getMode();
        const foregroundCloudIds = this.view.getForegroundCloudIds();

        if (mode === 'foreground') {
            this.moveStarToUIGroup();
            for (const cloudId of foregroundCloudIds) {
                this.moveCloudToUIGroup(cloudId);
            }
        } else {
            this.moveStarToZoomGroup();
            for (const instance of this.instances) {
                this.moveCloudToZoomGroup(instance.cloud.id);
            }
        }
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

        this.view.updateHelpPanel({
            lowestTrust,
            highestNeedAttention,
            victoryAchieved: this.model.isVictoryAchieved()
        });
    }

    private advanceSimulationTime(deltaTime: number): void {
        this.view.completeAllDelayedArrivals((cloudId) => this.model.isBlended(cloudId));
        this.timeAdvancer?.advance(deltaTime);
    }

    private handleSpontaneousBlend(cloudId: string, urgent: boolean): void {
        const inPanorama = this.view.getMode() === 'panorama';
        this.act({ action: 'spontaneous_blend', cloudId }, () => {
            if (urgent) {
                this.model.clearTargets();
            }
            if (inPanorama) {
                this.view.setMode('foreground');
                this.updateUIForMode();
                this.uiManager?.setMode('foreground');
            }
            this.controller?.executeAction('spontaneous_blend', cloudId);
        });
    }

    private executeSpontaneousBlendForPlayback(cloudId: string): void {
        const inPanorama = this.view.getMode() === 'panorama';
        const oldModel = this.model.clone();
        if (inPanorama) {
            this.view.setMode('foreground');
            this.updateUIForMode();
            this.uiManager?.setMode('foreground');
        }
        this.controller?.executeAction('spontaneous_blend', cloudId);
        this.syncViewWithModel(oldModel);
    }

    // Playback mode methods
    startPlayback(session: RecordedSession): void {
        if (!this.container || !this.svgElement) return;

        const callbacks: PlaybackCallbacks = {
            getCloudPosition: (cloudId) => {
                if (cloudId === STAR_CLOUD_ID) {
                    return this.view.getStarScreenPosition();
                }
                if (cloudId === RAY_CLOUD_ID) {
                    const selfRay = this.model.getSelfRay();
                    if (!selfRay) return null;
                    const starPos = this.view.getStarScreenPosition();
                    const cloudState = this.view.getCloudState(selfRay.targetCloudId);
                    const cloudPos = cloudState ? { x: cloudState.x, y: cloudState.y } : starPos;
                    return {
                        x: (starPos.x + cloudPos.x) / 2,
                        y: (starPos.y + cloudPos.y) / 2
                    };
                }
                if (cloudId === MODE_TOGGLE_CLOUD_ID) {
                    return { x: this.canvasWidth - 42 + 16, y: 10 + 16 };
                }
                return this.getCloudVisualCenter(cloudId);
            },
            getMenuCenter: () => this.pieMenuController?.getMenuCenter() ?? null,
            getSlicePosition: (sliceIndex, menuCenter, itemCount) => {
                const angleStep = (2 * Math.PI) / itemCount;
                const startAngle = -Math.PI / 2;
                const angle = startAngle + sliceIndex * angleStep;
                const radius = 60;
                return {
                    x: menuCenter.x + radius * Math.cos(angle),
                    y: menuCenter.y + radius * Math.sin(angle)
                };
            },
            getMode: () => this.view.getMode(),
            getPartName: (cloudId) => this.getCloudById(cloudId)?.text ?? cloudId,
            getLastActionResult: () => this.lastActionResult,
            clearLastActionResult: () => { this.lastActionResult = null; },
            getModelState: (): ModelState => ({
                targets: [...this.model.getTargetCloudIds()],
                blended: this.model.getBlendedParts()
            }),
            isTransitioning: () => this.view.isTransitioning(),
            hasPendingBlends: () => this.model.getPendingBlends().length > 0,
            hasActiveSpiralExits: () => this.view.hasActiveSpiralExits(),
            isMobile: () => this.uiManager?.isMobile() ?? false,
            getIsFullscreen: () => this.uiManager?.getIsFullscreen() ?? false,
            findActionInOpenMenu: (actionId: string): MenuSliceInfo | null => {
                const items = this.pieMenuController?.getCurrentMenuItems() ?? [];
                const sliceIndex = items.findIndex(item => item.id === actionId);
                if (sliceIndex < 0) return null;
                return { sliceIndex, itemCount: items.length };
            },
            simulateHover: (x, y) => {
                this.simulateHoverAtPosition(x, y);
            },
            simulateClickAtPosition: (x, y) => {
                return this.simulateClickAtPosition(x, y);
            },
            simulateClickOnCloud: (cloudId) => {
                return this.simulateClickOnCloud(cloudId);
            },
            setPauseTimeEffects: (paused) => {
                this.pauseTimeEffects = paused;
            },
            advanceSimulationTime: (deltaTime: number) => {
                this.advanceSimulationTime(deltaTime);
            },
            advanceIntervals: (count: number) => {
                this.timeAdvancer?.advanceIntervals(count);
                this.checkBlendedPartsAttention();
            },
            executeSpontaneousBlend: (cloudId: string) => {
                this.executeSpontaneousBlendForPlayback(cloudId);
            },
            onActionCompleted: (action: RecordedAction): ActionResult => {
                return this.verifyPlaybackSync(action);
            },
            onPlaybackComplete: () => {
                this.playbackController = null;
            },
            onPlaybackCancelled: () => {
                this.playbackController = null;
            },
            onPlaybackError: () => {
                this.downloadSessionHandler?.();
            }
        };

        this.playbackController = new PlaybackController(this.container, this.svgElement, callbacks);
        this.playbackController.start(session);
    }

    private simulateHoverAtPosition(x: number, y: number): void {
        const { clientX, clientY } = this.svgToScreenCoords(x, y);
        const element = document.elementFromPoint(clientX, clientY);
        if (!element) return;

        const mouseEnterEvent = new MouseEvent('mouseenter', {
            clientX,
            clientY,
            bubbles: true,
            cancelable: true
        });

        const mouseMoveEvent = new MouseEvent('mousemove', {
            clientX,
            clientY,
            bubbles: true,
            cancelable: true
        });

        element.dispatchEvent(mouseEnterEvent);
        element.dispatchEvent(mouseMoveEvent);
    }

    private svgToScreenCoords(x: number, y: number): { clientX: number; clientY: number } {
        if (!this.svgElement) return { clientX: x, clientY: y };
        const rect = this.svgElement.getBoundingClientRect();
        const viewBox = this.svgElement.viewBox.baseVal;
        const scaleX = rect.width / (viewBox.width || this.canvasWidth);
        const scaleY = rect.height / (viewBox.height || this.canvasHeight);
        return {
            clientX: rect.left + x * scaleX,
            clientY: rect.top + y * scaleY
        };
    }

    private simulateClickAtPosition(x: number, y: number, retryCount: number = 0): ActionResult {
        const { clientX, clientY } = this.svgToScreenCoords(x, y);
        const starElement = this.animatedStar?.getElement();
        if (starElement) starElement.style.pointerEvents = 'none';
        const element = document.elementFromPoint(clientX, clientY);
        if (starElement) starElement.style.pointerEvents = '';
        if (!element) {
            return { success: false, error: `No element at svg(${x.toFixed(0)}, ${y.toFixed(0)}) screen(${clientX.toFixed(0)}, ${clientY.toFixed(0)})` };
        }

        const clickEvent = new MouseEvent('click', {
            clientX,
            clientY,
            bubbles: true,
            cancelable: true
        });

        element.dispatchEvent(clickEvent);

        // If we hit a thought bubble, it gets dismissed - caller should retry after delay
        if (element.closest('.thought-bubble')) {
            return { success: true, message: 'thought-bubble-dismissed' };
        }

        return { success: true };
    }

    private simulateClickOnCloud(cloudId: string): ActionResult {
        if (cloudId === STAR_CLOUD_ID) {
            this.animatedStar?.simulateClick();
            return { success: true };
        }
        if (cloudId === RAY_CLOUD_ID) {
            this.view.simulateRayClick();
            return { success: true };
        }
        if (cloudId === MODE_TOGGLE_CLOUD_ID) {
            this.uiManager?.simulateModeToggleClick();
            return { success: true };
        }
        const cloud = this.getCloudById(cloudId);
        if (!cloud) {
            return { success: false, error: `Cloud not found: ${cloudId}` };
        }
        this.inputHandler?.handleCloudClick(cloud);
        return { success: true };
    }

    isInPlaybackMode(): boolean {
        return this.playbackController !== null && this.playbackController.isPlaying();
    }

    setPauseTimeEffects(paused: boolean): void {
        this.pauseTimeEffects = paused;
    }

    cancelPlayback(): void {
        this.playbackController?.cancel();
    }

    private verifyPlaybackSync(action: RecordedAction): ActionResult {
        const parts: string[] = [];

        if (action.rngCounts) {
            const actualModelCount = this.rng.getCallCount();
            if (action.rngCounts.model !== actualModelCount) {
                const actualLog = this.rng.getCallLog();
                console.log('[Sync] RNG mismatch - expected count:', action.rngCounts.model,
                    'actual count:', actualModelCount, 'log:', actualLog);
                parts.push(`model RNG count: expected ${action.rngCounts.model}, got ${actualModelCount}`);
            }
        }

        const expected = action.modelState;
        if (!expected) {
            if (parts.length > 0) {
                return { success: false, error: `Sync mismatch: ${parts.join('; ')}` };
            }
            return { success: true };
        }

        const actual = {
            targets: [...this.model.getTargetCloudIds()],
            blended: this.model.getBlendedParts()
        };

        const expectedTargets = new Set(expected.targets);
        const actualTargets = new Set(actual.targets);
        const expectedBlended = new Set(expected.blended);
        const actualBlended = new Set(actual.blended);

        const missingTargets = [...expectedTargets].filter(t => !actualTargets.has(t));
        const extraTargets = [...actualTargets].filter(t => !expectedTargets.has(t));
        const missingBlended = [...expectedBlended].filter(b => !actualBlended.has(b));
        const extraBlended = [...actualBlended].filter(b => !expectedBlended.has(b));
        if (missingTargets.length || extraTargets.length || missingBlended.length || extraBlended.length) {
            const getName = (id: string) => this.getCloudById(id)?.text ?? id;
            if (missingTargets.length) parts.push(`missing targets: ${missingTargets.map(getName).join(', ')}`);
            if (extraTargets.length) parts.push(`extra targets: ${extraTargets.map(getName).join(', ')}`);
            if (missingBlended.length) parts.push(`missing blended: ${missingBlended.map(getName).join(', ')}`);
            if (extraBlended.length) parts.push(`extra blended: ${extraBlended.map(getName).join(', ')}`);
        }

        if (expected.biography) {
            for (const [cloudId, expectedBio] of Object.entries(expected.biography)) {
                const actualBio = {
                    ageRevealed: this.model.parts.isAgeRevealed(cloudId),
                    identityRevealed: this.model.parts.isIdentityRevealed(cloudId),
                    jobRevealed: this.model.parts.isJobRevealed(cloudId),
                    jobAppraisalRevealed: this.model.parts.isJobAppraisalRevealed(cloudId),
                    jobImpactRevealed: this.model.parts.isJobImpactRevealed(cloudId),
                };
                const getName = (id: string) => this.getCloudById(id)?.text ?? id;
                for (const [field, expectedVal] of Object.entries(expectedBio)) {
                    const actualVal = actualBio[field as keyof typeof actualBio];
                    if (expectedVal !== actualVal) {
                        parts.push(`${getName(cloudId)} ${field}: expected ${expectedVal}, got ${actualVal}`);
                    }
                }
            }
        }

        if (expected.trust) {
            const getName = (id: string) => this.getCloudById(id)?.text ?? id;
            for (const [cloudId, expectedTrust] of Object.entries(expected.trust)) {
                const actualTrust = this.model.parts.getTrust(cloudId);
                if (Math.abs(expectedTrust - actualTrust) > 0.001) {
                    parts.push(`${getName(cloudId)} trust: expected ${expectedTrust.toFixed(3)}, got ${actualTrust.toFixed(3)}`);
                }
            }
        }

        const expectedOrch = action.orchState;
        if (expectedOrch && this.messageOrchestrator) {
            const actualOrch = this.messageOrchestrator.getDebugState();
            for (const [cloudId, expectedTime] of Object.entries(expectedOrch.blendTimers)) {
                const actualTime = actualOrch.blendTimers[cloudId] ?? 0;
                if (Math.abs(expectedTime - actualTime) > 0.01) {
                    const getName = (id: string) => this.getCloudById(id)?.text ?? id;
                    parts.push(`blendTimer ${getName(cloudId)}: expected ${expectedTime.toFixed(2)}, got ${actualTime.toFixed(2)}`);
                }
            }
        }

        if (parts.length > 0) {
            return { success: false, error: `Sync mismatch: ${parts.join('; ')}` };
        }

        return { success: true };
    }
}
