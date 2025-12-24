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
import {
    createGroup, createCircle, createRect, createText,
    createForeignObject, setClickHandler, TextLine
} from './svgHelpers.js';

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

    private uiContainer: HTMLElement | null = null;

    private physicsEngine: PhysicsEngine;
    private panoramaController: PanoramaController;
    private model: SimulatorModel;
    private view: SimulatorView;

    private selectedAction: TherapistAction | null = null;
    private onActionSelect: ((action: TherapistAction, cloud: Cloud) => void) | null = null;
    private thoughtBubbleGroup: SVGGElement | null = null;
    private thoughtBubbleFadeTimer: number = 0;
    private thoughtBubbleVisible: boolean = false;
    private relationshipClouds: Map<string, { instance: CloudInstance; region: string }> = new Map();
    private modeToggleContainer: HTMLElement | null = null;
    private pieMenuController: PieMenuController | null = null;
    private pieMenuOverlay: SVGGElement | null = null;
    private hoveredCloudId: string | null = null;
    private touchOpenedPieMenu: boolean = false;
    private longPressTimer: number | null = null;
    private longPressStartTime: number = 0;
    private readonly LONG_PRESS_DURATION = 500;
    private tracePanel: HTMLElement | null = null;
    private traceVisible: boolean = false;
    private isFullscreen: boolean = false;
    private mobileBanner: HTMLElement | null = null;
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
    private pendingTargetAction: { action: TherapistAction; sourceCloudId: string } | null = null;

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
            isIdentityRevealed: this.model.isIdentityRevealed(cloudId),
            isAttacked: this.model.isAttacked(cloudId),
            partName: this.model.getPartName(cloudId),
        }));
        this.pieMenuController.setOnClose(() => {
            this.hoveredCloudId = null;
            this.updateAllCloudStyles();
        });

        this.carpetRenderer = new CarpetRenderer(this.canvasWidth, this.canvasHeight, this.zoomGroup);
        this.view.setOnSelfRayClick((cloudId, x, y, event) => {
            const touchEvent = (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) ? event : undefined;
            this.pieMenuController?.toggleSelfRay(cloudId, x, y, touchEvent);
        });
        this.view.setOnModeChange((mode) => {
            if (mode === 'panorama') {
                this.model.clearSelfRay();
            }
            this.pendingTargetAction = null;
            this.updateUIForMode();
            this.updateModeToggle();
        });

        this.createSelfStar();
        this.createModeToggle();
        this.createFullscreenButton();
        this.createUIContainer();
        this.createTraceButton();
        this.createTracePanel();
        this.panX = this.canvasWidth / 2;
        this.panY = this.canvasHeight / 2;
        this.updateViewBox();
        this.setupVisibilityHandling();
        this.setupClickDiagnostics();
        this.setupFullscreenHandling();
    }

    private setupClickDiagnostics(): void {
        if (!this.svgElement) return;

        this.svgElement.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as Element;
            const isCloud = target.closest('g[transform]')?.querySelector('path') !== null;
            if (!isCloud) {
                const rect = this.svgElement!.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                console.log(`[SVG Click] Missed all clouds at (${x.toFixed(0)}, ${y.toFixed(0)}), target=${target.tagName}, mode=${this.view.getMode()}, thoughtBubble=${this.thoughtBubbleVisible}`);
            }
        });
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

    setHoveredCloud(cloudId: string | null): void {
        this.hoveredCloudId = cloudId;
    }

    startLongPress(cloudId: string): void {
        if (this.view.getMode() !== 'foreground') return;
        this.cancelLongPress();
        this.longPressStartTime = performance.now();
        this.longPressTimer = window.setTimeout(() => {
            this.longPressTimer = null;
        }, this.LONG_PRESS_DURATION);
    }

    cancelLongPress(): void {
        if (this.longPressTimer !== null) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
    }

    isLongPressActive(): boolean {
        return this.longPressTimer !== null &&
            (performance.now() - this.longPressStartTime) >= this.LONG_PRESS_DURATION;
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

    private createModeToggle(): void {
        if (!this.uiGroup) return;

        const foreignObject = createForeignObject(this.canvasWidth - 42, 10, 32, 32);
        foreignObject.classList.add('mode-toggle-fo');

        this.modeToggleContainer = document.createElement('button');
        this.modeToggleContainer.className = 'zoom-toggle-btn';
        this.modeToggleContainer.innerHTML = '🔍';
        this.modeToggleContainer.title = 'Panorama view — click to focus';
        this.modeToggleContainer.addEventListener('click', () => {
            const isForeground = this.view.getMode() === 'foreground';
            this.handleModeToggle(!isForeground);
        });

        foreignObject.appendChild(this.modeToggleContainer);
        this.uiGroup.appendChild(foreignObject);
    }

    private handleModeToggle(isForeground: boolean): void {
        const mode = isForeground ? 'foreground' : 'panorama';
        this.act(`Mode: ${mode}`, () => {
            this.view.setMode(mode);
            this.updateUIForMode();
            this.updateModeToggle();
        });
    }

    private createFullscreenButton(): void {
        if (!this.container || !this.uiGroup) return;

        this.createMobileBanner();
        this.createFullscreenToggleButton();
    }

    private isMobileDevice(): boolean {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
            || (window.innerWidth <= 800 && 'ontouchstart' in window);
    }

    private createMobileBanner(): void {
        if (!this.container || !this.isMobileDevice()) return;

        this.mobileBanner = document.createElement('div');
        this.mobileBanner.className = 'mobile-fullscreen-banner';
        this.mobileBanner.innerHTML = `
            <div class="banner-content">
                <div class="rotation-prompt">
                    <span class="rotation-icon">📱</span>
                    <span class="rotation-text">Rotate to landscape</span>
                    <span class="rotation-check">✓</span>
                </div>
                <button class="enter-fullscreen-btn">Enter Fullscreen</button>
            </div>
        `;

        const enterBtn = this.mobileBanner.querySelector('.enter-fullscreen-btn');
        enterBtn?.addEventListener('click', () => this.enterFullscreen());

        this.container.appendChild(this.mobileBanner);
        this.updateOrientationIndicator();

        window.addEventListener('orientationchange', () => this.updateOrientationIndicator());
        window.addEventListener('resize', () => this.updateOrientationIndicator());
    }

    private createFullscreenToggleButton(): void {
        if (!this.uiGroup) return;

        const foreignObject = createForeignObject(this.canvasWidth - 84, 10, 32, 32);
        foreignObject.classList.add('fullscreen-toggle-fo');

        const btn = document.createElement('button');
        btn.className = 'zoom-toggle-btn';
        btn.innerHTML = '⛶';
        btn.title = 'Toggle fullscreen';
        btn.addEventListener('click', () => this.toggleFullscreen());

        foreignObject.appendChild(btn);
        this.uiGroup.appendChild(foreignObject);
    }

    private updateOrientationIndicator(): void {
        if (!this.mobileBanner) return;

        const isLandscape = window.innerWidth > window.innerHeight;
        const check = this.mobileBanner.querySelector('.rotation-check') as HTMLElement;
        const text = this.mobileBanner.querySelector('.rotation-text') as HTMLElement;
        const btn = this.mobileBanner.querySelector('.enter-fullscreen-btn') as HTMLButtonElement;

        if (check && text) {
            if (isLandscape) {
                check.style.display = 'inline';
                text.textContent = 'Landscape ';
            } else {
                check.style.display = 'none';
                text.textContent = 'Rotate to landscape';
            }
        }

        if (btn) {
            btn.disabled = !isLandscape;
        }
    }

    private setupFullscreenHandling(): void {
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                this.exitFullscreenMode();
            }
        });

        window.addEventListener('resize', () => {
            if (this.isFullscreen) {
                const isLandscape = window.innerWidth > window.innerHeight;
                if (!isLandscape && this.isMobileDevice()) {
                    console.log('[IFS] Exiting fullscreen due to portrait orientation');
                    this.exitFullscreen();
                    return;
                }
                this.resizeCanvasToViewport();
            }
        });
    }

    private async toggleFullscreen(): Promise<void> {
        if (this.isFullscreen) {
            await this.exitFullscreen();
        } else {
            await this.enterFullscreen();
        }
    }

    private async enterFullscreen(): Promise<void> {
        if (!this.container) return;

        const isLandscape = window.innerWidth > window.innerHeight;
        if (!isLandscape && this.isMobileDevice()) {
            console.log('[IFS] Please rotate to landscape before entering fullscreen');
            return;
        }

        try {
            await this.container.requestFullscreen();
            this.enterFullscreenMode();
        } catch (err) {
            console.log('[IFS] Fullscreen not available, using pseudo-fullscreen');
            this.enterFullscreenMode();
        }
    }

    private enterFullscreenMode(): void {
        this.isFullscreen = true;
        document.body.classList.add('ifs-fullscreen');
        this.container?.classList.add('fullscreen-active');

        if (this.mobileBanner) {
            this.mobileBanner.style.display = 'none';
        }

        this.requestLandscapeOrientation();
        this.resizeCanvasToViewport();
    }

    private async exitFullscreen(): Promise<void> {
        if (document.fullscreenElement) {
            await document.exitFullscreen();
        } else {
            this.exitFullscreenMode();
        }
    }

    private exitFullscreenMode(): void {
        this.isFullscreen = false;
        document.body.classList.remove('ifs-fullscreen');
        this.container?.classList.remove('fullscreen-active');

        if (this.mobileBanner) {
            this.mobileBanner.style.display = 'flex';
        }

        this.unlockOrientation();
        this.restoreCanvasSize();
    }

    private requestLandscapeOrientation(): void {
        const screen = window.screen as Screen & {
            orientation?: {
                lock?: (orientation: string) => Promise<void>;
                unlock?: () => void;
            };
        };

        if (screen.orientation?.lock) {
            screen.orientation.lock('landscape').catch(() => {
                // Orientation lock not supported or not in fullscreen
            });
        }
    }

    private unlockOrientation(): void {
        const screen = window.screen as Screen & {
            orientation?: {
                unlock?: () => void;
            };
        };

        if (screen.orientation?.unlock) {
            try {
                screen.orientation.unlock();
            } catch {
                // Ignore unlock errors
            }
        }
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
        this.updateModeTogglePosition();
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
        this.updateModeTogglePosition();
        this.updateViewBox();
    }

    private updateModeTogglePosition(): void {
        if (!this.uiGroup) return;

        const modeToggleFo = this.uiGroup.querySelector('.mode-toggle-fo');
        if (modeToggleFo) {
            modeToggleFo.setAttribute('x', String(this.canvasWidth - 42));
        }

        const fullscreenFo = this.uiGroup.querySelector('.fullscreen-toggle-fo');
        if (fullscreenFo) {
            fullscreenFo.setAttribute('x', String(this.canvasWidth - 84));
        }
    }

    private createUIContainer(): void {
        if (!this.container) return;

        this.uiContainer = document.createElement('div');
        this.uiContainer.style.position = 'absolute';
        this.uiContainer.style.top = '10px';
        this.uiContainer.style.right = '10px';
        this.uiContainer.style.display = 'none';
        this.uiContainer.style.zIndex = '1000';

        this.container.appendChild(this.uiContainer);
    }

    isPieMenuOpen(): boolean {
        return this.pieMenuController?.isOpen() ?? false;
    }

    private createTraceButton(): void {
        if (!this.container) return;

        const btn = document.createElement('button');
        btn.className = 'trace-toggle-btn';
        btn.textContent = '📜 Trace';
        btn.title = 'Show state change history';
        btn.addEventListener('click', () => this.toggleTracePanel());
        this.container.appendChild(btn);
    }

    private createTracePanel(): void {
        if (!this.container) return;

        this.tracePanel = document.createElement('div');
        this.tracePanel.className = 'trace-panel';
        this.tracePanel.style.display = 'none';

        const header = document.createElement('div');
        header.className = 'trace-header';

        const title = document.createElement('span');
        title.textContent = 'State History';
        header.appendChild(title);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'trace-copy-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => this.copyTraceToClipboard());
        header.appendChild(copyBtn);

        this.tracePanel.appendChild(header);

        const content = document.createElement('pre');
        content.className = 'trace-content';
        this.tracePanel.appendChild(content);

        this.container.appendChild(this.tracePanel);
    }

    private toggleTracePanel(): void {
        this.traceVisible = !this.traceVisible;
        if (this.tracePanel) {
            this.tracePanel.style.display = this.traceVisible ? 'block' : 'none';
            if (this.traceVisible) {
                this.updateTracePanel();
            }
        }
    }

    private updateTracePanel(): void {
        if (!this.tracePanel || !this.traceVisible) return;

        const content = this.tracePanel.querySelector('.trace-content');
        if (!content) return;

        content.textContent = this.view.getTrace();
    }

    private copyTraceToClipboard(): void {
        const content = this.tracePanel?.querySelector('.trace-content');
        if (!content?.textContent) return;

        navigator.clipboard.writeText(content.textContent);

        const copyBtn = this.tracePanel?.querySelector('.trace-copy-btn');
        if (copyBtn) {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 1000);
        }
    }

    private handleActionClick(action: TherapistAction, targetCloud?: Cloud): void {
        const selectedId = this.pieMenuController?.getSelectedCloudId();
        const cloud = targetCloud ?? (selectedId ? this.getCloudById(selectedId) : null);
        if (!cloud) return;

        this.selectedAction = action;
        const actionLabel = `${action.shortName}: ${cloud.text}`;

        if (this.model.getBlendReason(cloud.id) === 'spontaneous') {
            this.model.setBlendReason(cloud.id, 'therapist');
        }

        if (action.id === 'join_conference') {
            this.showThoughtBubble("Joining the conference...", cloud.id);
            this.act(actionLabel, () => this.model.addTargetCloud(cloud.id));
            return;
        }

        if (action.id === 'step_back') {
            this.act(actionLabel, () => this.doStepBack(cloud.id));
            return;
        }

        if (action.id === 'separate') {
            if (this.model.isBlended(cloud.id)) {
                this.act(actionLabel, () => this.startUnblendingBlendedPart(cloud.id));
            }
            return;
        }

        if (action.id === 'blend') {
            this.act(actionLabel, () => this.blendTargetPart(cloud.id));
            return;
        }

        const isBlended = this.model.isBlended(cloud.id);

        if (action.id === 'job') {
            this.act(actionLabel, () => this.handleJobQuestion(cloud, isBlended));
            return;
        }

        if (action.id === 'who_do_you_see') {
            this.act(actionLabel, () => this.handleWhoDoYouSee(cloud));
            return;
        }

        if (action.id === 'help_protected') {
            this.act(actionLabel, () => this.handleHelpProtected(cloud));
            return;
        }

        if (action.id === 'notice_part') {
            this.pendingTargetAction = { action, sourceCloudId: cloud.id };
            this.showThoughtBubble("Which part?", cloud.id);
            return;
        }

        if (action.id === 'feel_toward') {
            this.act(actionLabel, () => {
                const grievanceTargets = this.relationships.getGrievanceTargets(cloud.id);
                const targetIds = this.model.getTargetCloudIds();
                const blendedParts = this.model.getBlendedParts();
                const blendedResponses: { cloudId: string; response: string }[] = [];

                for (const blendedId of blendedParts) {
                    if (this.relationships.hasGrievance(blendedId, cloud.id)) {
                        const response = this.getGrievanceResponse(blendedId, cloud.id);
                        if (response) {
                            blendedResponses.push({ cloudId: blendedId, response });
                        }
                    } else {
                        const dialogues = this.model.getDialogues(blendedId).genericBlendedDialogues;
                        if (dialogues && dialogues.length > 0) {
                            blendedResponses.push({ cloudId: blendedId, response: dialogues[Math.floor(Math.random() * dialogues.length)] });
                        }
                    }
                }

                for (const grievanceId of grievanceTargets) {
                    const isPending = this.model.isPendingBlend(grievanceId);
                    if (!targetIds.has(grievanceId) && !blendedParts.includes(grievanceId) && !isPending) {
                        const grievanceCloud = this.getCloudById(grievanceId);
                        if (grievanceCloud && this.model.getTrust(grievanceId) < 0.5) {
                            this.model.enqueuePendingBlend(grievanceId, 'therapist');
                        }
                    }
                }

                const hasPendingBlends = this.model.peekPendingBlend() !== null;

                if (blendedParts.length === 0 && !hasPendingBlends) {
                    const unrevealed = this.model.getUnrevealedBiographyFields(cloud.id);
                    this.createSelfRay(cloud.id, unrevealed);
                } else if (blendedResponses.length > 0) {
                    this.showThoughtBubble(blendedResponses[0].response, blendedResponses[0].cloudId);
                    this.model.adjustTrust(cloud.id, 0.9);
                }

                this.model.revealRelationships(cloud.id);
            });
        }

        if (this.onActionSelect) {
            this.onActionSelect(action, cloud);
        }
    }

    setActionSelectHandler(handler: (action: TherapistAction, cloud: Cloud) => void): void {
        this.onActionSelect = handler;
    }

    getSelectedAction(): TherapistAction | null {
        return this.selectedAction;
    }

    private getJobResponse(cloudId: string): string {
        if (this.model.isUnburdenedJobRevealed(cloudId)) {
            const unburdenedJob = this.model.getDialogues(cloudId)?.unburdenedJob;
            if (!unburdenedJob) {
                throw new Error(`Part ${cloudId} has unburdenedJobRevealed but no unburdenedJob dialogue`);
            }
            return unburdenedJob;
        }

        const protectedIds = this.relationships.getProtecting(cloudId);
        if (protectedIds.size === 0) {
            return "I don't have a job.";
        }
        const protectedId = Array.from(protectedIds)[0];
        const protectedCloud = this.getCloudById(protectedId);
        const protectedName = protectedCloud?.text ?? 'someone';
        this.model.revealIdentity(cloudId);
        this.model.revealIdentity(protectedId);

        this.model.summonSupportingPart(cloudId, protectedId);

        return `I protect the ${protectedName} one.`;
    }

    private handleJobQuestion(cloud: Cloud, isBlended: boolean): void {
        if (this.model.isIdentityRevealed(cloud.id) && !this.model.isUnburdenedJobRevealed(cloud.id)) {
            const protectedIds = this.relationships.getProtecting(cloud.id);
            const protecteeInConference = Array.from(protectedIds).some(
                id => this.model.isTarget(id) || this.model.isBlended(id) || this.model.getAllSupportingParts().has(id)
            );
            if (protectedIds.size === 0 || protecteeInConference) {
                this.showThoughtBubble("You already asked me that.", cloud.id);
                this.model.adjustTrust(cloud.id, 0.95);
                return;
            }
        }

        this.showThoughtBubble(this.getJobResponse(cloud.id), cloud.id);

        if (isBlended) {
            this.reduceBlending(cloud.id, 0.3);
        }
    }

    private readonly UNWILLING_RESPONSES = [
        "I'm not comfortable with that idea.",
        "No, I don't think so.",
        "That's not going to work.",
        "Why would I let you do that?",
    ];

    private handleHelpProtected(cloud: Cloud): void {
        const protectedIds = this.relationships.getProtecting(cloud.id);
        if (protectedIds.size === 0) return;

        const trust = this.model.getTrust(cloud.id);
        const willing = trust >= Math.random();

        if (!willing) {
            const response = this.UNWILLING_RESPONSES[Math.floor(Math.random() * this.UNWILLING_RESPONSES.length)];
            this.showThoughtBubble(response, cloud.id);
            this.view.setAction(`Help? ${cloud.text}: refused`);
            return;
        }

        this.showThoughtBubble(`Yes, I'd like that.`, cloud.id);
        this.model.setConsentedToHelp(cloud.id);
        this.view.setAction(`Help? ${cloud.text}: consented`);
    }

    private getSelfRecognitionResponse(cloudId: string): string {
        const isProtector = this.relationships.getProtecting(cloudId).size > 0;
        const specific = isProtector
            ? ["I feel your gratitude.", "I feel your concern."]
            : ["I feel your compassion.", "I feel your warmth."];
        const responses = [...specific, "I see a brilliant star."];
        return responses[Math.floor(Math.random() * responses.length)];
    }

    private handleWhoDoYouSee(cloud: Cloud): void {
        const proxies = this.relationships.getProxies(cloud.id);
        if (proxies.size === 0) {
            this.showThoughtBubble(this.getSelfRecognitionResponse(cloud.id), cloud.id);
            return;
        }

        const targetIds = this.model.getTargetCloudIds();
        const availableProxies = Array.from(proxies).filter(id => !targetIds.has(id));
        if (availableProxies.length === 0) {
            const successChance = this.model.getSelfRay()?.targetCloudId === cloud.id ? 0.95 : 0.2;
            if (Math.random() < successChance) {
                this.relationships.clearProxies(cloud.id);
                this.showThoughtBubble(this.getSelfRecognitionResponse(cloud.id), cloud.id);
                return;
            }
            const proxyIds = Array.from(proxies);
            const proxyId = proxyIds[Math.floor(Math.random() * proxyIds.length)];
            const proxyCloud = this.getCloudById(proxyId);
            const proxyName = proxyCloud?.text ?? 'someone';
            this.showThoughtBubble(`I see the ${proxyName}.`, cloud.id);
            return;
        }

        const proxyId = availableProxies[Math.floor(Math.random() * availableProxies.length)];
        const proxyCloud = this.getCloudById(proxyId);
        const proxyName = proxyCloud?.text ?? 'someone';

        this.model.addBlendedPart(proxyId, 'therapist');
        this.model.revealIdentity(proxyId);

        this.showThoughtBubble(`I see the ${proxyName}.`, cloud.id);
    }

    private reduceBlending(cloudId: string, baseAmount: number): void {
        if (!this.model.isBlended(cloudId)) return;

        const cloud = this.getCloudById(cloudId);
        if (!cloud) return;

        // Parts with low needAttention unblend more readily (up to 3x faster)
        const needAttention = this.model.getNeedAttention(cloudId);
        const multiplier = 1 + 2 * (1 - Math.min(1, needAttention));
        const amount = baseAmount * multiplier;

        const currentDegree = this.model.getBlendingDegree(cloudId);
        const targetDegree = Math.max(0, currentDegree - amount);
        this.model.setBlendingDegree(cloudId, targetDegree);
    }

    private getGrievanceResponse(cloudId: string, targetId: string): string | null {
        const dialogues = this.relationships.getGrievanceDialogues(cloudId, targetId);
        if (dialogues.length > 0) {
            return dialogues[Math.floor(Math.random() * dialogues.length)];
        }
        return null;
    }

    private buildPartDescription(cloudId: string): string {
        const parts: string[] = [];
        const bio = this.model.getBiography(cloudId);
        const dialogues = this.model.getDialogues(cloudId);
        const cloud = this.getCloudById(cloudId);

        if (bio?.ageRevealed && bio.partAge !== null) {
            if (typeof bio.partAge === 'number') {
                parts.push(`the ${bio.partAge} year old`);
            } else {
                parts.push(`the ${bio.partAge}`);
            }
        }

        if (bio?.identityRevealed && cloud) {
            parts.push(cloud.text);
        }

        if (bio?.unburdenedJobRevealed && dialogues?.unburdenedJob) {
            parts.push(`who ${dialogues.unburdenedJob.toLowerCase()}`);
        }

        if (parts.length === 0) {
            return 'this part';
        }
        return parts.join(', ');
    }

    private wrapText(text: string, maxWidth: number, fontSize: number): string[] {
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = '';
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (testLine.length * fontSize * 0.5 > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);
        return lines;
    }

    private showThoughtBubble(reaction: string, cloudId: string): void {
        if (!this.uiGroup) return;

        const cloudState = this.view.getCloudState(cloudId);
        if (!cloudState) return;

        this.hideThoughtBubble();

        this.thoughtBubbleGroup = createGroup({ class: 'thought-bubble', 'pointer-events': 'none' });

        const padding = 12;
        const fontSize = 16;
        const maxWidth = 200;
        const lines = this.wrapText(reaction, maxWidth, fontSize);
        const lineHeight = fontSize + 4;
        const textHeight = lines.length * lineHeight;
        const textWidth = Math.min(maxWidth, Math.max(...lines.map(l => l.length * fontSize * 0.55)));
        const bubbleWidth = textWidth + padding;
        const bubbleHeight = textHeight + padding * 2;

        const bubbleX = cloudState.x;
        const bubbleY = cloudState.y - 60 - bubbleHeight / 2;

        const bubbleStyle = { rx: 8, fill: 'white', stroke: '#333', 'stroke-width': 1.5, opacity: 0.95, 'pointer-events': 'auto' };
        const bubble = createRect(bubbleX - bubbleWidth / 2, bubbleY - bubbleHeight / 2, bubbleWidth, bubbleHeight, bubbleStyle);
        setClickHandler(bubble, () => this.hideThoughtBubble());
        this.thoughtBubbleGroup.appendChild(bubble);

        const tailStyle = { fill: 'white', stroke: '#333', 'stroke-width': 1.5, 'pointer-events': 'auto' };
        const smallCircle1 = createCircle(bubbleX, bubbleY + bubbleHeight / 2 + 8, 6, tailStyle);
        setClickHandler(smallCircle1, () => this.hideThoughtBubble());
        this.thoughtBubbleGroup.appendChild(smallCircle1);

        const smallCircle2 = createCircle(bubbleX, bubbleY + bubbleHeight / 2 + 18, 4, tailStyle);
        setClickHandler(smallCircle2, () => this.hideThoughtBubble());
        this.thoughtBubbleGroup.appendChild(smallCircle2);

        const textStartY = bubbleY - textHeight / 2 + fontSize;
        const textLines: TextLine[] = lines.map(line => ({
            text: line,
            fontSize,
            fontStyle: 'italic' as const,
        }));
        const text = createText(bubbleX, textStartY, textLines, {
            'font-family': 'sans-serif',
            'text-anchor': 'middle',
            fill: '#333',
        });
        this.thoughtBubbleGroup.appendChild(text);

        this.uiGroup.appendChild(this.thoughtBubbleGroup);
        this.thoughtBubbleVisible = true;
        this.thoughtBubbleFadeTimer = 0;
    }

    private hideThoughtBubble(): void {
        if (this.thoughtBubbleGroup && this.thoughtBubbleGroup.parentNode) {
            this.thoughtBubbleGroup.parentNode.removeChild(this.thoughtBubbleGroup);
        }
        this.thoughtBubbleGroup = null;
        this.thoughtBubbleVisible = false;
        this.thoughtBubbleFadeTimer = 0;
    }

    private createSelfRay(cloudId: string, _unrevealedFields: ('age' | 'identity' | 'job')[]): void {
        this.model.setSelfRay(cloudId);
    }

    private revealBiographyField(field: 'age' | 'identity', cloudId: string): string {
        const cloud = this.getCloudById(cloudId);
        const partState = this.model.getPartState(cloudId);

        switch (field) {
            case 'age':
                if (partState?.biography.ageRevealed) {
                    return "I told you already.";
                }
                this.model.revealAge(cloudId);
                const age = partState?.biography.partAge;
                if (typeof age === 'number') {
                    return `I'm ${age} years old.`;
                } else if (typeof age === 'string') {
                    return `I'm a ${age}.`;
                }
                return "I'm not sure how old I am.";
            case 'identity':
                if (partState?.biography.identityRevealed) {
                    return "I told you already.";
                }
                this.model.revealIdentity(cloudId);
                return `I'm the ${cloud?.text ?? 'part'}.`;
        }
    }

    private handleRayFieldSelect(field: 'age' | 'identity' | 'job' | 'jobAppraisal' | 'jobImpact' | 'gratitude' | 'whatNeedToKnow' | 'compassion' | 'apologize', cloudId: string): void {
        this.pendingTargetAction = null;

        const partState = this.model.getPartState(cloudId);
        if (!partState) return;

        const cloudName = this.getCloudById(cloudId)?.text ?? cloudId;

        const proxies = this.relationships.getProxies(cloudId);
        if (proxies.size > 0 && Math.random() < 0.95) {
            const deflections = [
                "I don't trust you.",
                "Why should I tell you?",
                "You wouldn't understand.",
                "I'm not talking to you.",
                "Leave me alone."
            ];
            this.showThoughtBubble(deflections[Math.floor(Math.random() * deflections.length)], cloudId);
            return;
        }

        this.act(`Ask ${field}: ${cloudName}`, () => {
            let response: string | null;
            if (field === 'whatNeedToKnow') {
                response = this.handleWhatNeedToKnow(cloudId);
                if (response === null) return;
            } else if (field === 'gratitude') {
                const protectedIds = this.relationships.getProtecting(cloudId);
                if (protectedIds.size > 0) {
                    const gratitudeResponses = [
                        "I'm not used to being appreciated. Thank you.",
                        "This is unfamiliar. No one ever thanks me.",
                        "You're grateful? That's new.",
                        "I've been working so hard for so long. Thank you for noticing.",
                    ];
                    response = gratitudeResponses[Math.floor(Math.random() * gratitudeResponses.length)];
                    this.model.addTrust(cloudId, 0.25);
                } else {
                    response = "Gratitude? For what?";
                    this.model.adjustTrust(cloudId, 0.95);
                }
            } else if (field === 'job') {
                if (this.model.isIdentityRevealed(cloudId)) {
                    response = "I told you already.";
                } else {
                    response = this.getJobResponse(cloudId);
                    this.model.addTrust(cloudId, 0.25);
                }
            } else if (field === 'jobAppraisal') {
                response = this.handleJobAppraisalQuestion(cloudId);
            } else if (field === 'jobImpact') {
                response = this.handleJobImpactQuestion(cloudId);
            } else if (field === 'compassion') {
                const isProtector = this.relationships.getProtecting(cloudId).size > 0;
                if (isProtector) {
                    response = partState.dialogues.compassionResponse ?? "That means a lot to me.";
                    this.model.addTrust(cloudId, 0.25);
                } else {
                    response = this.handleWhatNeedToKnow(cloudId);
                    if (response === null) return;
                }
            } else if (field === 'apologize') {
                response = this.handleApologize(cloudId);
            } else {
                response = this.revealBiographyField(field, cloudId);
                this.model.addTrust(cloudId, 0.25);
            }

            this.showThoughtBubble(response, cloudId);
            if (Math.random() < 0.25) {
                this.model.clearSelfRay();
            }
        });
    }

    private readonly NO_JOB_RESPONSES = [
        "Did I say I had a job?",
        "What job?",
        "I don't know what you mean.",
    ];

    private handleJobAppraisalQuestion(cloudId: string): string {
        const partState = this.model.getPartState(cloudId);
        if (!partState) return "...";

        if (!this.model.isIdentityRevealed(cloudId)) {
            this.model.adjustTrust(cloudId, 0.95);
            return this.NO_JOB_RESPONSES[Math.floor(Math.random() * this.NO_JOB_RESPONSES.length)];
        }

        if (this.model.isJobAppraisalRevealed(cloudId)) {
            this.model.adjustTrust(cloudId, 0.98);
            return "I told you already.";
        }

        const dialogues = partState.dialogues.burdenedJobAppraisal;
        if (!dialogues || dialogues.length === 0) {
            this.model.adjustTrust(cloudId, 0.95);
            return this.NO_JOB_RESPONSES[Math.floor(Math.random() * this.NO_JOB_RESPONSES.length)];
        }

        this.model.revealJobAppraisal(cloudId);
        this.model.addTrust(cloudId, 0.25);
        return dialogues[Math.floor(Math.random() * dialogues.length)];
    }

    private handleJobImpactQuestion(cloudId: string): string {
        const partState = this.model.getPartState(cloudId);
        if (!partState) return "...";

        if (!this.model.isIdentityRevealed(cloudId)) {
            this.model.adjustTrust(cloudId, 0.95);
            return this.NO_JOB_RESPONSES[Math.floor(Math.random() * this.NO_JOB_RESPONSES.length)];
        }

        if (this.model.isJobImpactRevealed(cloudId)) {
            this.model.adjustTrust(cloudId, 0.98);
            return "I told you already.";
        }

        const dialogues = partState.dialogues.burdenedJobImpact;
        if (!dialogues || dialogues.length === 0) {
            this.model.adjustTrust(cloudId, 0.95);
            return this.NO_JOB_RESPONSES[Math.floor(Math.random() * this.NO_JOB_RESPONSES.length)];
        }

        this.model.revealJobImpact(cloudId);
        this.model.addTrust(cloudId, 0.25);
        return dialogues[Math.floor(Math.random() * dialogues.length)];
    }

    private handleApologize(cloudId: string): string {
        if (!this.model.isAttacked(cloudId)) {
            return "What are you apologizing for?";
        }

        const grievanceSenders = this.relationships.getGrievanceSenders(cloudId);
        const hasUnburdenedAttacker = Array.from(grievanceSenders).some(
            senderId => this.model.isUnburdenedJobRevealed(senderId)
        );
        if (!hasUnburdenedAttacker) {
            this.model.adjustTrust(cloudId, 0.95);
            return "The ones who attacked me are still burdened. How can I trust you?";
        }

        const trust = this.model.getTrust(cloudId);
        if (trust < 0.5 || Math.random() > trust) {
            this.model.adjustTrust(cloudId, 0.9);
            const rejections = [
                "It's going to take more than that.",
                "Words are easy. Show me you mean it.",
                "I'm not ready to forgive yet.",
            ];
            return rejections[Math.floor(Math.random() * rejections.length)];
        }

        this.model.clearAttacked(cloudId);
        this.model.addTrust(cloudId, 0.2);
        const acceptances = [
            "Thank you. I appreciate that.",
            "I can tell you mean it. Thank you.",
            "That means a lot to me.",
        ];
        return acceptances[Math.floor(Math.random() * acceptances.length)];
    }

    private handleWhatNeedToKnow(cloudId: string): string | null {
        const trustGain = 0.05 + Math.random() * 0.2;
        const protectorIds = this.relationships.getProtectedBy(cloudId);
        for (const protectorId of protectorIds) {
            if (!this.model.hasConsentedToHelp(protectorId)) {
                const protectorTrust = this.model.getTrust(protectorId);
                const newProtectorTrust = protectorTrust - trustGain;
                if (newProtectorTrust < Math.random()) {
                    this.model.setTrust(protectorId, 0);
                    this.triggerBacklash(protectorId, cloudId);
                    return null;
                } else {
                    this.model.setTrust(protectorId, newProtectorTrust);
                }
            }
        }

        const trust = this.model.getTrust(cloudId);
        if (trust < 1) {
            this.model.addTrust(cloudId, trustGain);

            return "Blah blah blah.";
        }

        return "I feel understood.";
    }

    private triggerBacklash(protectorId: string, protecteeId: string): void {
        const protectorName = this.getCloudById(protectorId)?.text ?? protectorId;
        this.act(`Backlash: ${protectorName}`, () => {
            this.model.adjustTrust(protecteeId, 0.5);
            const currentNeedAttention = this.model.getNeedAttention(protectorId);
            this.model.setNeedAttention(protectorId, currentNeedAttention + 1);
            this.model.addBlendedPart(protectorId, 'spontaneous');
            this.doStepBack(protecteeId, false);
        });
    }

    private updateThoughtBubble(deltaTime: number): void {
        if (!this.thoughtBubbleVisible || !this.thoughtBubbleGroup) return;

        this.thoughtBubbleFadeTimer += deltaTime;

        if (this.thoughtBubbleFadeTimer >= 15) {
            this.hideThoughtBubble();
        } else if (this.thoughtBubbleFadeTimer >= 13) {
            const fadeProgress = (this.thoughtBubbleFadeTimer - 13) / 2;
            const opacity = 0.95 * (1 - fadeProgress);
            this.thoughtBubbleGroup.setAttribute('opacity', String(opacity));
        }
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
        const group = cloud.createSVGElements({
            onClick: () => this.handleCloudClick(cloud),
            onHover: (hovered) => {
                this.setHoveredCloud(hovered ? cloud.id : null);
                cloud.updateSVGElements(this.debug, state, hovered);
            },
            onLongPressStart: () => this.startLongPress(cloud.id),
            onLongPressEnd: () => this.cancelLongPress(),
            onTouchStart: (e) => this.handleCloudTouchStart(cloud, e),
            onTouchEnd: () => this.handleCloudTouchEnd(cloud),
        });
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
            this.model.setNeedAttention(instance.cloud.id, assessed);
            if (this.relationships.getProxyFor(instance.cloud.id).size > 0) {
                this.model.markAsProxy(instance.cloud.id);
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
        for (const instance of this.instances) {
            const state = this.model.getPartState(instance.cloud.id);
            const hovered = this.hoveredCloudId === instance.cloud.id;
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
        this.createDebugPauseButton();
    }

    stopAnimation(): void {
        this.animating = false;
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    private debugPauseButton: HTMLButtonElement | null = null;

    private createDebugPauseButton(): void {
        if (this.debugPauseButton || !this.container) return;

        const btn = document.createElement('button');
        btn.textContent = '⏸';
        btn.style.cssText = `
            position: absolute;
            bottom: 10px;
            left: 10px;
            z-index: 1000;
            padding: 6px 10px;
            font-size: 16px;
            background: #ff6b6b;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;

        btn.addEventListener('click', () => {
            if (this.animating) {
                this.stopAnimation();
                btn.textContent = '▶';
                btn.style.background = '#51cf66';
            } else {
                this.animating = true;
                this.lastFrameTime = performance.now();
                this.animate();
                btn.textContent = '⏸';
                btn.style.background = '#ff6b6b';
            }
        });

        this.container.appendChild(btn);
        this.debugPauseButton = btn;
    }

    private handleCloudClick(cloud: Cloud): void {
        if (this.touchOpenedPieMenu) {
            this.touchOpenedPieMenu = false;
            return;
        }
        this.hoveredCloudId = null;
        this.selectCloud(cloud);
    }

    private handleCloudTouchStart(cloud: Cloud, e: TouchEvent): void {
        this.hoveredCloudId = null;
        this.updateAllCloudStyles();

        if (this.view.getMode() !== 'foreground') return;
        if (this.pendingTargetAction) return;

        const cloudState = this.view.getCloudState(cloud.id);
        if (cloudState && cloudState.opacity > 0) {
            this.touchOpenedPieMenu = true;
            this.pieMenuController?.toggle(cloud.id, cloudState.x, cloudState.y, e);
        }
    }

    private handleCloudTouchEnd(cloud: Cloud): void {
        if (!this.pendingTargetAction) return;
        if (this.view.getMode() !== 'foreground') return;

        const cloudState = this.view.getCloudState(cloud.id);
        if (cloudState && cloudState.opacity > 0) {
            this.completePendingTargetAction(cloud.id);
        }
    }

    selectCloud(cloud: Cloud, touchEvent?: TouchEvent): void {
        if (this.view.getMode() === 'panorama') {
            this.act(`Click: ${cloud.text}`, () => {
                this.model.setTargetCloud(cloud.id);
                this.view.setMode('foreground');
                this.updateUIForMode();
                this.updateModeToggle();
            });
        } else if (this.view.getMode() === 'foreground') {
            if (this.pendingTargetAction) {
                this.completePendingTargetAction(cloud.id);
                return;
            }
            const cloudState = this.view.getCloudState(cloud.id);
            if (cloudState && cloudState.opacity > 0) {
                this.pieMenuController?.toggle(cloud.id, cloudState.x, cloudState.y, touchEvent);
            }
        }
    }

    private completePendingTargetAction(targetCloudId: string): void {
        if (!this.pendingTargetAction) return;

        const { action, sourceCloudId } = this.pendingTargetAction;
        this.pendingTargetAction = null;

        if (action.id === 'notice_part') {
            this.handleNoticePart(sourceCloudId, targetCloudId);
        }
    }

    private handleNoticePart(protectorId: string, targetCloudId: string): void {
        const protectedIds = this.relationships.getProtecting(protectorId);
        if (!protectedIds.has(targetCloudId)) {
            this.showThoughtBubble("That's not a part I protect.", protectorId);
            return;
        }

        const targetTrust = this.model.getTrust(targetCloudId);
        if (targetTrust < 1) {
            this.showThoughtBubble("I don't see anything different.", protectorId);
            return;
        }

        const protectorCloud = this.getCloudById(protectorId);
        const targetCloud = this.getCloudById(targetCloudId);
        const protectorName = protectorCloud?.text ?? protectorId;
        const targetName = targetCloud?.text ?? targetCloudId;

        this.act(`Notice: ${protectorName} notices ${targetName}`, () => {
            this.model.revealUnburdenedJob(protectorId);
            this.model.setNeedAttention(protectorId, 0);
            const unburdenedJob = this.model.getDialogues(protectorId)?.unburdenedJob;
            if (unburdenedJob) {
                this.showThoughtBubble(`I see that ${targetName} is okay now. ${unburdenedJob}`, protectorId);
            } else {
                this.showThoughtBubble(`I see that ${targetName} is okay now. I don't need to protect them anymore.`, protectorId);
            }
        });
    }

    private startUnblendingPart(cloudId: string): void {
        const cloud = this.getCloudById(cloudId);
        if (!cloud) throw new Error(`Part not found: ${cloudId}`);

        const targetIds = this.model.getTargetCloudIds();
        const firstTargetId = Array.from(targetIds)[0];
        if (!firstTargetId) throw new Error('No target part to unblend toward');

        const targetInstance = this.instances.find(i => i.cloud.id === firstTargetId);
        if (!targetInstance) throw new Error(`Target part not found: ${firstTargetId}`);

        const cloudState = this.view.getCloudState(firstTargetId);
        if (!cloudState) throw new Error(`Cannot locate target: ${firstTargetId}`);

        cloud.startUnblending(cloudState.x, cloudState.y);
    }

    private doStepBack(cloudId: string, showBubble: boolean = true): void {
        if (this.model.wasProxy(cloudId)) {
            if (showBubble) {
                this.showThoughtBubble("I want to watch.", cloudId);
            }
            this.model.adjustTrust(cloudId, 0.98);
            return;
        }

        if (showBubble) {
            this.showThoughtBubble("Stepping back...", cloudId);
        }

        this.model.stepBackPart(cloudId);
    }

    private startUnblendingBlendedPart(cloudId: string): void {
        if (!this.model.isBlended(cloudId)) throw new Error(`Part is not blended: ${cloudId}`);

        this.showThoughtBubble("Okay, I'll separate a bit...", cloudId);
        this.reduceBlending(cloudId, 0.3);
    }

    private blendTargetPart(cloudId: string): void {
        this.model.removeTargetCloud(cloudId);
        this.model.addBlendedPart(cloudId, 'therapist');
    }

    private promotePendingBlend(cloudId: string): void {
        if (!this.model.isPendingBlend(cloudId)) return;

        const pending = this.model.getPendingBlends().find(p => p.cloudId === cloudId);
        if (!pending) return;

        const name = this.model.getPartName(cloudId);
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
        const name = this.model.getPartName(cloudId);
        this.act(`${name} separates`, () => {
            this.model.promoteBlendedToTarget(cloudId);
        });
    }

    private updateModeToggle(): void {
        if (!this.modeToggleContainer) return;
        const isForeground = this.view.getMode() === 'foreground';
        this.modeToggleContainer.innerHTML = isForeground ? '🔭' : '🔍';
        this.modeToggleContainer.title = isForeground ? 'Focus view — click for panorama' : 'Panorama view — click to focus';
        this.modeToggleContainer.classList.toggle('focused', isForeground);
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

    private act(action: string, fn: () => void): void {
        this.view.setAction(action);
        const oldModel = this.model.clone();
        fn();
        this.syncViewWithModel(oldModel);
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
            this.updateThoughtBubble(deltaTime);
            this.view.updateSelfRayPosition();
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
                const hovered = this.hoveredCloudId === instance.cloud.id;
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

        if (!this.isPieMenuOpen()) {
            this.act('Attention check', () => {
                this.model.checkAttentionDemands(this.relationships);
            });
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

        const senderName = this.model.getPartName(senderId);
        const targetName = this.model.getPartName(targetId);
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
            this.model.adjustTrust(message.targetId, 0.99);
            this.model.adjustNeedAttention(message.senderId, 0.8);
            if (message.senderId !== message.targetId) {
                this.model.setAttacked(message.targetId);
            }
        }
        this.model.removeMessage(message.id);
    }

    private checkBlendedPartsAttention(): void {
        const blendedParts = this.model.getBlendedParts();
        for (const cloudId of blendedParts) {
            if (this.resolvingClouds.has(cloudId)) continue;
            if (this.model.getBlendReason(cloudId) !== 'spontaneous') continue;

            if (this.model.getNeedAttention(cloudId) < 0.25) {
                this.finishUnblending(cloudId);
            }
        }
    }

    private updateHelpPanel(): void {
        let lowestTrust: { name: string; trust: number } | null = null;
        let highestNeedAttention: { name: string; needAttention: number } | null = null;

        for (const instance of this.instances) {
            const cloudId = instance.cloud.id;
            const trust = this.model.getTrust(cloudId);
            const needAttention = this.model.getNeedAttention(cloudId);

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
        for (const instance of this.instances) {
            const cloudId = instance.cloud.id;
            const hasGrievances = this.relationships.getGrievanceTargets(cloudId).size > 0;
            if (!hasGrievances) continue;

            if (this.model.isUnburdenedJobRevealed(cloudId)) continue;
            if (this.model.isBlended(cloudId) || this.model.isTarget(cloudId)) continue;

            const current = this.model.getNeedAttention(cloudId);
            this.model.setNeedAttention(cloudId, current + deltaTime * 0.05);
        }
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
            if (this.model.isUnburdenedJobRevealed(blendedId)) continue;

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
                grievanceTargetId = grievanceTargetArray[Math.floor(Math.random() * grievanceTargetArray.length)];
            }

            const dialogues = this.relationships.getGrievanceDialogues(blendedId, grievanceTargetId);
            if (dialogues.length === 0) continue;

            // If target is not in conference yet, summon them (unless it's a self-grievance)
            if (!targetIds.has(grievanceTargetId) && grievanceTargetId !== blendedId) {
                const blenderName = this.model.getPartName(blendedId);
                const targetName = this.model.getPartName(grievanceTargetId);
                this.act(`${blenderName} summons ${targetName}`, () => {
                    this.model.addTargetCloud(grievanceTargetId);
                });
                this.pendingGrievanceTargets.set(blendedId, grievanceTargetId);
                this.messageCooldownTimers.set(blendedId, 0);
                continue;
            }

            // Don't send messages to parts that haven't visually arrived yet
            if (this.view.isAwaitingArrival(grievanceTargetId)) continue;

            const text = dialogues[Math.floor(Math.random() * dialogues.length)];
            this.sendMessage(blendedId, grievanceTargetId, text, 'grievance');
            this.messageCooldownTimers.set(blendedId, 0);
            // Clear the pending target since we just sent the message
            this.pendingGrievanceTargets.delete(blendedId);
        }
    }

    private checkAndShowGenericDialogues(deltaTime: number): void {
        if (this.view.hasActiveSpiralExits()) return;
        if (this.thoughtBubbleVisible) return;

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

            const dialogues = this.model.getDialogues(blendedId)?.genericBlendedDialogues;
            if (!dialogues || dialogues.length === 0) continue;

            const cooldown = this.genericDialogueCooldowns.get(blendedId) ?? this.GENERIC_DIALOGUE_INTERVAL;
            const newCooldown = cooldown + deltaTime;
            this.genericDialogueCooldowns.set(blendedId, newCooldown);

            if (newCooldown >= this.GENERIC_DIALOGUE_INTERVAL) {
                const text = dialogues[Math.floor(Math.random() * dialogues.length)];
                this.showThoughtBubble(text, blendedId);
                this.genericDialogueCooldowns.set(blendedId, 0);
                break;
            }
        }
    }
}
