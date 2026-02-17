import { Cloud, CloudType } from './cloudShape.js';
import { PartStateManager } from './partStateManager.js';
import { SimulatorModel, PartMessage } from '../simulator/ifsModel.js';
import { SimulatorView } from '../simulator/ifsView.js';
import { CarpetRenderer } from '../star/carpetRenderer.js';
import type { BiographyField } from '../star/selfRay.js';
import { CloudInstance } from '../utils/types.js';
import { PanoramaCloudMotion } from './panoramaCloudMotion.js';
import { PieMenuController } from '../menu/pieMenuController.js';
import { PieMenu } from '../menu/pieMenu.js';
import type { TherapistAction } from '../simulator/therapistActions.js';
import { createGroup } from '../utils/svgHelpers.js';
import type { RNG } from '../playback/testability/rng.js';
import { createModelRNG } from '../playback/testability/rng.js';
import type { RecordedSession, RecordedAction, ControllerActionResult, SerializedModel } from '../playback/testability/types.js';
import { SimulatorController } from '../simulator/simulatorController.js';
import { STAR_CLOUD_ID } from '../simulator/view/SeatManager.js';
import { UIManager } from '../simulator/uiManager.js';
import { InputHandler } from '../simulator/inputHandler.js';
import { ActionEffectApplicator } from '../simulator/actionEffectApplicator.js';
import { FullscreenManager } from '../utils/fullscreenManager.js';
import { AnimationLoop } from '../utils/animationLoop.js';
import { MessageOrchestrator } from '../simulator/messageOrchestrator.js';
import { PanoramaInputHandler } from './panoramaInputHandler.js';
import { ExpandDeepenEffect } from './expandDeepenEffect.js';
import type { ActionResult, PlaybackSpeed } from '../playback/playback.js';
import { TimeAdvancer } from '../simulator/timeAdvancer.js';
import { PlaybackRecordingCoordinator } from '../playback/playbackRecordingCoordinator.js';

export { CloudType };
export type { TherapistAction };


declare global {
    interface Window {
        stopAnimations?: () => void;
        resumeAnimations?: () => void;
        dumpCloudStates?: () => void;
    }
}

export class CloudManager {
    private instances: CloudInstance[] = [];
    private svgElement: SVGSVGElement | null = null;
    private container: HTMLElement | null = null;
    private debug: boolean = false;
    private canvasWidth: number = 800;
    private canvasHeight: number = 600;
    private panX: number = 0;
    private panY: number = 0;
    private animationLoop: AnimationLoop;
    private partitionCount: number = 8;
    private currentPartition: number = 0;
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
    private controller: SimulatorController | null = null;
    private effectApplicator: ActionEffectApplicator | null = null;
    private insideAct: boolean = false;
    private lastHelpPanelUpdate: number = 0;
    private expandDeepenEffect: ExpandDeepenEffect | null = null;
    private timeAdvancer: TimeAdvancer | null = null;
    private playbackRecording: PlaybackRecordingCoordinator;

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

        this.playbackRecording = new PlaybackRecordingCoordinator({
            getModel: () => this.model,
            getCloudById: (id) => this.getCloudById(id),
            getCloudVisualCenter: (cloudId) => this.getCloudVisualCenter(cloudId),
            getView: () => this.view,
            getPendingBlendsCount: () => this.model.getPendingBlends().length,
            getTimeAdvancer: () => this.timeAdvancer,
            getMessageOrchestrator: () => this.messageOrchestrator,
            getPieMenuController: () => this.pieMenuController,
            getAnimatedStar: () => ({ simulateClick: () => this.view.simulateStarClick(), getElement: () => this.view.getStarElement() }),
            getInputHandler: () => this.inputHandler,
            getUIManager: () => this.uiManager,
            getContainer: () => this.container,
            getSvgElement: () => this.svgElement,
            getCanvasDimensions: () => ({ width: this.canvasWidth, height: this.canvasHeight }),
            simulateRayClick: () => this.view.simulateRayClick(),
            executeSpontaneousBlendForPlayback: (cloudId) => this.executeSpontaneousBlendForPlayback(cloudId),
            getCarpetRenderer: () => this.carpetRenderer,
            checkBlendedPartsAttention: () => this.checkBlendedPartsAttention(),
            onRngChanged: (rng) => {
                this.initController();
                this.messageOrchestrator?.setRNG(rng);
                this.timeAdvancer?.setRNG(rng);
                this.panoramaMotion.setRandom(() => Math.random());
            },
        });

        this.initController();
    }

    private initController(): void {
        this.controller = new SimulatorController({
            getModel: () => this.model,
            getRelationships: () => this.model.parts,
            rng: this.playbackRecording.getRNG(),
            getPartName: (id) => this.getCloudById(id)?.text ?? id,
            getTime: () => this.timeAdvancer?.getTime() ?? 0
        });
        this.effectApplicator = new ActionEffectApplicator(() => this.model, this.view);
    }

    setRNG(rng: RNG): void {
        this.playbackRecording.setRNG(rng);
    }

    getRNG(): RNG {
        return this.playbackRecording.getRNG();
    }

    setSeed(seed: number): void {
        this.playbackRecording.setSeed(seed);
    }

    restoreFromSession(initialModel: SerializedModel): void {
        if (!this.svgElement) throw new Error('SVG element not initialized');

        this.model = SimulatorModel.fromJSON(initialModel);

        for (const [cloudId, partState] of Object.entries(initialModel.partStates) as [string, { name: string }][]) {
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
        this.playbackRecording.startRecording(codeVersion, this.uiManager?.isMobile() ?? false);
    }

    getRecordingSession(): RecordedSession | null {
        return this.playbackRecording.getRecordingSession();
    }

    stopRecording(): RecordedSession | null {
        return this.playbackRecording.stopRecording();
    }

    isRecording(): boolean {
        return this.playbackRecording.isRecording();
    }

    setDownloadSessionHandler(handler: () => void): void {
        this.playbackRecording.setDownloadSessionHandler(handler);
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
            () => this.model.parts,
            this.playbackRecording.getRNG(),
            {
                act: (label, fn) => this.act(label, fn),
                showThoughtBubble: (text, cloudId) => this.showThoughtBubble(text, cloudId),
                getCloudById: (id) => this.getCloudById(id),
                getTime: () => this.timeAdvancer?.getTime() ?? 0,
            }
        );
        this.view.setOnMessageReceived((message) => this.messageOrchestrator!.onMessageReceived(message));

        this.timeAdvancer = new TimeAdvancer(
            () => this.model,
            this.messageOrchestrator,
            this.playbackRecording.getRNG(),
            {
                getMode: () => this.model.getMode(),
                onSpontaneousBlend: (event: { cloudId: string; urgent: boolean }, accumulatedTime: number) => {
                    this.playbackRecording.recordIntervals();
                    this.playbackRecording.markSpontaneousBlendTriggered(accumulatedTime);
                    this.handleSpontaneousBlend(event.cloudId, event.urgent);
                },
            }//, { skipAttentionChecks: true }
        );

        const thoughtBubbleContainer = createGroup({ id: 'thought-bubble-container' });
        this.uiGroup.appendChild(thoughtBubbleContainer);
        this.view.setThoughtBubbleContainer(thoughtBubbleContainer);
        this.view.setOnThoughtBubbleDismiss(() => this.model.clearThoughtBubbles());

        this.pieMenuController = new PieMenuController(this.uiGroup, this.pieMenuOverlay, {
            getCloudById: (id) => this.getCloudById(id),
            getModel: () => this.model,
            view: this.view,
            getRelationships: () => this.model.parts,
            getController: () => this.controller ?? undefined,
        });
        this.pieMenuController.setOnActionSelect((action, cloud) => this.handleActionClick(action, cloud));
        this.pieMenuController.setOnStarActionSelect((action) => this.handleStarActionClick(action));
        this.pieMenuController.setOnBiographySelect((field, cloudId) => this.handleRayFieldSelect(field, cloudId));
        this.pieMenuController.setGetPartContext((cloudId) => ({
            isProtector: this.model.parts.getProtecting(cloudId).size > 0,
            isIdentityRevealed: this.model.parts.isIdentityRevealed(cloudId),
            partName: this.model.parts.getPartName(cloudId),
        }));
        this.pieMenuController.setOnClose(() => {
            this.inputHandler?.setHoveredCloud(null);
            this.updateAllCloudStyles();
        });

        this.inputHandler = new InputHandler(
            {
                svgElement: this.svgElement,
                getModel: () => this.model,
                view: this.view,
                pieMenuController: this.pieMenuController,
                getCloudById: (id) => this.getCloudById(id),
                updateAllCloudStyles: () => this.updateAllCloudStyles(),
            },
            {
                onCloudSelected: (cloud, touchEvent) => this.handlePanoramaSelect(cloud),
                onPendingActionComplete: (targetCloudId) => this.completePendingAction(targetCloudId),
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
        this.model.setOnModeChange((mode) => {
            if (!this.insideAct) {
                this.act({ action: 'mode_change', cloudId: '', newMode: mode }, () => { });
            }
        });
        this.view.setOnModeChange((mode) => {
            this.updateUIForMode();
            this.uiManager?.setMode(mode);
        });
        this.view.setOnPendingActionDismiss(() => {
            this.act('Cancel pending action', () => {
                this.model.setPendingAction(null);
            });
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

        this.view.setGroups(this.zoomGroup!, this.uiGroup!);
        this.view.createStar((_x, _y, event) => {
            if (this.pieMenuController && this.model.getMode() === 'foreground') {
                const starPos = this.view.getStarScreenPosition();
                const touchEvent = (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) ? event : undefined;
                this.pieMenuController.toggleStar(starPos.x, starPos.y, touchEvent);
            }
        });

        this.expandDeepenEffect = new ExpandDeepenEffect();
        this.expandDeepenEffect.attach(this.container);
        this.expandDeepenEffect.setDimensions(this.canvasWidth, this.canvasHeight);
        const starColor = this.view.getStarFillColor();
        if (starColor) {
            this.expandDeepenEffect.setStarColor(starColor);
        }

        this.uiManager = new UIManager(this.container, this.svgElement, this.uiGroup, {
            canvasWidth: this.canvasWidth,
            canvasHeight: this.canvasHeight,
            setMode: (mode) => {
                this.model.setMode(mode);
                this.syncViewWithModel();
            },
            onFullscreenToggle: () => this.toggleFullscreen(),
            onAnimationPauseToggle: () => this.toggleAnimationPause(),
            onDownloadSession: () => this.playbackRecording.triggerDownload(),
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
                getMode: () => this.model.getMode(),
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
        this.view.handleStarResize(width, height);
        this.carpetRenderer?.setDimensions(width, height);
        this.uiManager?.updateDimensions(width, height);
        this.expandDeepenEffect?.setDimensions(width, height);
        this.panoramaMotion.setDimensions(width, height);
        this.updateViewBox();
        this.playbackRecording.onCanvasResized();
    }

    private toggleFullscreen(): void {
        this.fullscreenManager?.toggle();
    }

    isPieMenuOpen(): boolean {
        return this.pieMenuController?.isOpen() ?? false;
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

        this.act(rec, () => {
            const result = this.controller!.executeAction(action.id, cloud.id, { isBlended });
            this.applyActionResult(result, cloud.id);
        });

        if (this.onActionSelect) {
            this.onActionSelect(action, cloud);
        }
    }

    private applyActionResult(result: ControllerActionResult, cloudId: string): void {
        this.playbackRecording.setLastActionResult({
            success: result.success,
            error: result.message
        });
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
        if (this.model.isBlended(cloudId)) {
            const time = this.timeAdvancer?.getTime() ?? 0;
            this.model.parts.setUtterance(cloudId, text, time);
        }
    }

    private hideThoughtBubble(): void {
        this.model.clearThoughtBubbles();
    }

    private handleRayFieldSelect(field: BiographyField, cloudId: string): void {
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
        partAge?: number | string;
        dialogues?: { burdenedJobAppraisal?: string[]; burdenedJobImpact?: string[]; unburdenedJob?: string; genericBlendedDialogues?: string[] };
    }): Cloud {
        if (!this.svgElement) throw new Error('SVG element not initialized');

        const cloud = this.createCloudVisual(word, options?.id);

        this.model.registerPart(cloud.id, word, {
            trust: options?.trust,
            needAttention: options?.needAttention,
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

    getRelationships(): PartStateManager {
        return this.model.parts;
    }

    applyAssessedNeedAttention(): void {
        for (const instance of this.instances) {
            const assessed = this.model.parts.assessNeedAttention(instance.cloud.id);
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
        const mode = this.view.getVisualMode();
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
            this.model.parts.removeCloud(cloud.id);
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
            this.model.parts.removeCloud(instance.cloud.id);
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
        window.dumpCloudStates = () => {
            const fgIds = this.view.getForegroundCloudIds();
            const confIds = this.model.getConferenceCloudIds();
            const targetIds = this.model.getTargetCloudIds();
            for (const inst of this.instances) {
                const id = inst.cloud.id;
                const name = this.model.parts.getPartName(id);
                const state = this.view.getCloudState(id);
                const parentId = (inst.cloud.getGroupElement()?.parentNode as Element)?.id ?? '?';
                const inFg = fgIds.has(id);
                const inConf = confIds.has(id);
                const isTarget = targetIds.has(id);
                console.log(`${name}: pos=(${state?.x?.toFixed(0)},${state?.y?.toFixed(0)}) ` +
                    `opacity=${state?.opacity?.toFixed(2)} scale=${state?.scale?.toFixed(2)} ` +
                    `posTarget=${state?.positionTarget?.type} group=${parentId} ` +
                    `fg=${inFg} conf=${inConf} target=${isTarget}`);
            }
            console.log(`mode=${this.model.getMode()} transDir=${this.view.getTransitionDirection()} ` +
                `transProg=${this.view.getTransitionProgress()?.toFixed(2)}`);
        };
    }

    stopAnimation(): void {
        this.animationLoop.stop();
    }

    private handlePanoramaSelect(cloud: Cloud): void {
        this.act({ action: 'select_a_target', cloudId: cloud.id }, () => {
            this.model.setTargetCloud(cloud.id);
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

        this.act({ action: 'feel_toward', cloudId: targetCloudId }, () => {
            const result = this.controller!.executeAction('feel_toward', STAR_CLOUD_ID, { targetCloudId });
            this.applyActionResult(result, targetCloudId);
        });
    }

    private completePendingAction(targetCloudId: string): void {
        const pending = this.model.getPendingAction();
        if (!pending) return;

        const { actionId, sourceCloudId } = pending;
        if (actionId === 'add_target') {
            this.act({ action: 'select_a_target', cloudId: targetCloudId }, () => {
                this.model.setPendingAction(null);
                this.model.addTargetCloud(targetCloudId);
                this.model.setMode('foreground');
            });
            return;
        }
        this.act({ action: actionId, cloudId: sourceCloudId, targetCloudId }, () => {
            this.model.setPendingAction(null);
            if (actionId === 'notice_part') {
                const result = this.controller!.executeAction('notice_part', sourceCloudId, { targetCloudId });
                this.applyActionResult(result, sourceCloudId);
            } else if (actionId === 'feel_toward') {
                const result = this.controller!.executeAction('feel_toward', STAR_CLOUD_ID, { targetCloudId });
                this.applyActionResult(result, targetCloudId);
            }
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

        this.view.syncWithModel(oldModel, this.model, this.instances);

        this.model.syncConversation(this.playbackRecording.getRNG());
        if (this.model.isConversationInitialized()) {
            this.carpetRenderer?.setConversationActive(true);
            this.carpetRenderer?.setOnRotationEnd((carpetId, stanceDelta) => {
                const rounded = Math.round(stanceDelta * 10) / 10;
                if (Math.abs(rounded) < 0.01) return;
                const rec: RecordedAction = { action: 'nudge_stance', cloudId: carpetId, stanceDelta: rounded };
                this.act(rec, () => {
                    this.controller!.executeAction('nudge_stance', carpetId, { stanceDelta: rounded });
                });
            });
        } else {
            this.carpetRenderer?.setConversationActive(false);
            this.carpetRenderer?.setOnRotationEnd(null);
        }

        this.dismissPieMenuIfPartLeft();
    }

    private dismissPieMenuIfPartLeft(): void {
        if (!this.pieMenuController?.isOpen()) return;
        const selectedId = this.pieMenuController.getSelectedCloudId();
        if (!selectedId) return;
        const isInConference = this.model.getTargetCloudIds().has(selectedId) ||
            this.model.getBlendedParts().includes(selectedId);
        if (!isInConference) {
            this.hidePieMenu();
        }
    }

    private act(action: string | RecordedAction, fn: () => void): void {
        if (this.insideAct) {
            throw new Error('Nested act() calls are not allowed');
        }

        const recordedAction = typeof action === 'string' ? undefined : action;
        if (!recordedAction) {
            this.playbackRecording.cancelIfReady();
        }
        const oldModel = this.model.clone();
        if (recordedAction) {
            this.playbackRecording.recordIntervals();
        }
        this.insideAct = true;
        try {
            fn();
        } finally {
            this.insideAct = false;
        }
        this.syncViewWithModel(oldModel);
        if (recordedAction) {
            this.playbackRecording.recordAction(recordedAction);
        }
    }

    private updateUIForMode(): void {
        const mode = this.model.getMode();

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
        this.playbackRecording.updatePlayback(deltaTime);
        this.view.animate(deltaTime);
        this.view.animateStarVisuals(deltaTime);

        const mode = this.view.getVisualMode();
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
            const convParticipants = this.view.getConversationParticipantIds();
            this.view.updateStarConversationState(convParticipants, this.instances);

            const conversationParticipantSet = convParticipants ? new Set(convParticipants) : null;

            const transitioningToForeground = isTransitioning && this.view.getTransitionDirection() === 'forward';
            if (this.carpetRenderer && !transitioningToForeground) {
                const carpetStates = this.view.getCarpetStates();
                const seats = this.view.getSeats();
                this.model.updateConversationEffectiveStancesCache();
                const rawStances = this.model.getConversationEffectiveStances();
                const effectiveStances: Map<string, number> | null = rawStances.size > 0 ? rawStances : null;
                const phases = this.model.getConversationPhases();
                this.carpetRenderer.setConversationPhases(phases.size > 0 ? phases : null);
                this.carpetRenderer.update(carpetStates, seats, deltaTime, conversationParticipantSet, effectiveStances);
                this.carpetRenderer.render(carpetStates);
                this.carpetRenderer.renderDebugWaveField(carpetStates);
                this.view.renderSeatDebug();
            }
            if (!this.playbackRecording.isPlaying() && !isTransitioning) {
                this.checkBlendedPartsAttention();
            }
            this.view.animateMessages(deltaTime);

            // Update and render expand/deepen effect
            if (this.expandDeepenEffect?.isActive()) {
                this.expandDeepenEffect.update(deltaTime, this.model);
                const starPos = this.view.getStarScreenPosition();
                this.expandDeepenEffect.render(starPos.x, starPos.y);
            }
            if (this.expandDeepenEffect) {
                this.view.setStarBorderOpacity(this.expandDeepenEffect.getBorderOpacity());
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

        if (this.view.getVisualMode() === 'panorama' && !this.view.isTransitioning()) {
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

        if (!this.playbackRecording.isPlaying() && !this.view.isTransitioning()) {
            this.timeAdvancer?.advance(deltaTime);
            this.playbackRecording.addEffectiveTime(deltaTime);
        }
        this.view.checkVictoryCondition(this.model);
        this.lastHelpPanelUpdate += deltaTime;
        if (this.lastHelpPanelUpdate >= 0.25) {
            this.lastHelpPanelUpdate = 0;
            this.updateHelpPanel();
        }

        const inPanorama = this.view.getVisualMode() === 'panorama' && !this.view.isTransitioning();
        if (inPanorama) {
            this.panoramaMotion.depthSort(this.instances, this.zoomGroup!, this.view.getStarElement());
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

    private onTransitionStart(direction: 'forward' | 'reverse'): void {
        if (!this.zoomGroup || !this.uiGroup) return;

        const foregroundCloudIds = direction === 'forward'
            ? this.model.getConferenceCloudIds()
            : this.view.getForegroundCloudIds();

        if (direction === 'forward') {
            for (const cloudId of foregroundCloudIds) {
                this.moveCloudToUIGroup(cloudId);
            }
        } else {
            for (const instance of this.instances) {
                if (!foregroundCloudIds.has(instance.cloud.id)) {
                    this.moveCloudToZoomGroup(instance.cloud.id);
                }
            }
            for (const cloudId of this.model.getBlendedParts()) {
                const cloud = this.getCloudById(cloudId);
                cloud?.releaseBlendedStretch();
            }
        }
        this.view.onTransitionStartStar(direction);
    }

    private finalizeCloudGroups(): void {
        if (!this.zoomGroup || !this.uiGroup) return;

        const mode = this.view.getVisualMode();
        const foregroundCloudIds = this.view.getForegroundCloudIds();

        if (mode === 'foreground') {
            for (const cloudId of foregroundCloudIds) {
                this.moveCloudToUIGroup(cloudId);
            }
        } else {
            for (const instance of this.instances) {
                this.moveCloudToZoomGroup(instance.cloud.id);
            }
        }
        this.view.finalizeStarGroup(mode);
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
        let mostSelfLoathing: { name: string; trust: number } | null = null;

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
            if (this.model.parts.hasInterPartRelation(cloudId, cloudId)) {
                const selfTrust = this.model.parts.getInterPartTrust(cloudId, cloudId);
                if (selfTrust < 1 && (mostSelfLoathing === null || selfTrust < mostSelfLoathing.trust)) {
                    mostSelfLoathing = { name: instance.cloud.text, trust: selfTrust };
                }
            }
        }

        let worstInterPartDistrust: { fromName: string; toName: string; trust: number } | null = null;
        const worstRel = this.model.parts.getWorstNonSelfInterPartRelation();
        if (worstRel) {
            worstInterPartDistrust = {
                fromName: this.model.parts.getPartName(worstRel.fromId),
                toName: this.model.parts.getPartName(worstRel.toId),
                trust: worstRel.trust,
            };
        }

        this.view.updateHelpPanel({
            lowestTrust,
            highestNeedAttention,
            mostSelfLoathing,
            worstInterPartDistrust,
            victoryAchieved: this.model.isVictoryAchieved()
        });
    }

    private handleSpontaneousBlend(cloudId: string, urgent: boolean): void {
        this.act({ action: 'spontaneous_blend', cloudId }, () => {
            if (urgent) {
                this.model.clearTargets();
            }
            this.controller?.executeAction('spontaneous_blend', cloudId);
        });
    }

    private executeSpontaneousBlendForPlayback(cloudId: string): void {
        const oldModel = this.model.clone();
        this.controller?.executeAction('spontaneous_blend', cloudId);
        this.syncViewWithModel(oldModel);
    }

    // Playback mode methods
    startPlayback(session: RecordedSession, speed?: PlaybackSpeed): void {
        this.playbackRecording.startPlayback(session, speed);
    }

    isInPlaybackMode(): boolean {
        return this.playbackRecording.isInPlaybackMode();
    }

    pausePlayback(): void {
        this.playbackRecording.pausePlayback();
    }

    cancelPlayback(): void {
        this.playbackRecording.cancelPlayback();
    }

    setLastActionResult(result: ActionResult): void {
        this.playbackRecording.setLastActionResult(result);
    }
}
