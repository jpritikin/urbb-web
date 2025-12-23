import { Cloud, CloudType } from './cloudShape.js';
import { CloudRelationshipManager } from './cloudRelationshipManager.js';
import { PhysicsEngine } from './physicsEngine.js';
import { SimulatorModel } from './ifsModel.js';
import { SimulatorView } from './ifsView.js';
import { CarpetRenderer } from './carpetRenderer.js';
import { CloudInstance } from './types.js';
import { AnimatedStar } from './starAnimation.js';
import { PanoramaController } from './panoramaController.js';
import { PieMenuController } from './pieMenuController.js';
import { PieMenu } from './pieMenu.js';
import { TherapistAction, THERAPIST_ACTIONS } from './therapistActions.js';
import {
    createGroup, createCircle, createEllipse, createRect, createText,
    createForeignObject, setClickHandler, TextLine
} from './svgHelpers.js';

export { CloudType };
export { TherapistAction, THERAPIST_ACTIONS };

interface Message {
    id: string;
    type: 'grievance';
    senderId: string;
    targetId: string;
    text: string;
    progress: number;
    duration: number;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    element: SVGGElement | null;
    phase: 'traveling' | 'lingering' | 'fading';
    lingerTime: number;
    lingerDuration: number;
}

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
    private selectedCloud: Cloud | null = null;
    private partitionCount: number = 8;
    private currentPartition: number = 0;
    private animatedStar: AnimatedStar | null = null;
    private zoomGroup: SVGGElement | null = null;
    private uiGroup: SVGGElement | null = null;

    private uiContainer: HTMLElement | null = null;
    private debugBox: HTMLElement | null = null;

    private physicsEngine: PhysicsEngine;
    private panoramaController: PanoramaController;
    private model: SimulatorModel;
    private view: SimulatorView;

    private selectedAction: TherapistAction | null = null;
    private onActionSelect: ((action: TherapistAction, cloud: Cloud) => void) | null = null;
    private biographyContainer: HTMLElement | null = null;
    private thoughtBubbleGroup: SVGGElement | null = null;
    private thoughtBubbleFadeTimer: number = 0;
    private thoughtBubbleVisible: boolean = false;
    private thoughtBubbleFollowUp: { label: string; targetCloudId: string } | null = null;
    private relationshipClouds: Map<string, { instance: CloudInstance; region: string }> = new Map();
    private regionLabelsGroup: SVGGElement | null = null;
    private modeToggleContainer: HTMLElement | null = null;
    private pieMenuController: PieMenuController | null = null;
    private pieMenuOverlay: SVGGElement | null = null;
    private hoveredCloudId: string | null = null;
    private longPressTimer: number | null = null;
    private longPressStartTime: number = 0;
    private readonly LONG_PRESS_DURATION = 500;
    private tracePanel: HTMLElement | null = null;
    private traceVisible: boolean = false;
    private resolvingClouds: Set<string> = new Set();
    private carpetRenderer: CarpetRenderer | null = null;
    private messages: Message[] = [];
    private messageIdCounter: number = 0;
    private messageCooldownTimers: Map<string, number> = new Map();
    private blendStartTimers: Map<string, number> = new Map();
    private pendingGrievanceTargets: Map<string, string> = new Map();
    private readonly BLEND_MESSAGE_DELAY = 3;

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

        this.pieMenuController = new PieMenuController(this.uiGroup, this.pieMenuOverlay, {
            getCloudById: (id) => this.getCloudById(id),
            model: this.model,
            view: this.view,
            relationships: this.relationships,
        });
        this.pieMenuController.setOnActionSelect((action, cloud) => this.handleActionClick(action, cloud));

        this.carpetRenderer = new CarpetRenderer(this.canvasWidth, this.canvasHeight, this.zoomGroup);
        this.view.setOnRayFieldSelect((field, cloudId) => this.handleRayFieldSelect(field, cloudId));
        this.view.setOnModeChange((mode) => {
            if (mode === 'panorama') {
                this.model.clearSelfRay();
            }
            this.updateUIForMode();
            this.updateModeToggle();
        });

        this.createSelfStar();
        this.createModeToggle();
        this.createUIContainer();
        this.createBiographyPanel();
        this.createTraceButton();
        this.createTracePanel();
        this.createDebugBox();
        this.panX = this.canvasWidth / 2;
        this.panY = this.canvasHeight / 2;
        this.updateViewBox();
        this.setupVisibilityHandling();
        this.setupClickDiagnostics();
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

    private createModeToggle(): void {
        if (!this.uiGroup) return;

        const foreignObject = createForeignObject(this.canvasWidth - 42, 10, 32, 32);

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
        this.view.setMode(isForeground ? 'foreground' : 'panorama');
        this.syncViewWithModel();
        this.updateUIForMode();
        this.updateModeToggle();
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

        const cloudNames = new Map<string, string>();
        for (const instance of this.instances) {
            cloudNames.set(instance.cloud.id, instance.cloud.text);
        }

        content.textContent = this.model.formatTrace(cloudNames);
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

        if (this.model.getBlendReason(cloud.id) === 'spontaneous') {
            this.model.setBlendReason(cloud.id, 'therapist');
        }

        if (action.id === 'join_conference') {
            this.showThoughtBubble("Joining the conference...");
            const oldModel = this.model.clone();
            this.model.addTargetCloud(cloud.id);
            this.syncViewWithModel(oldModel);
            this.updateBiographyPanel();
            return;
        }

        if (action.id === 'step_back') {
            this.stepBackPart(cloud.id);
            return;
        }

        if (action.id === 'separate') {
            if (this.model.isBlended(cloud.id)) {
                this.startUnblendingBlendedPart(cloud.id);
            }
            return;
        }

        if (action.id === 'blend') {
            this.blendTargetPart(cloud.id);
            return;
        }

        const isBlended = this.model.isBlended(cloud.id);

        this.model.recordQuestion(cloud.id, action.id);

        if (action.id === 'job') {
            this.handleJobQuestion(cloud, isBlended);
            return;
        }

        if (action.id === 'who_do_you_see') {
            this.handleWhoDoYouSee(cloud);
            return;
        }

        if (action.id === 'expand_calm') {
            this.handleExpandCalm(cloud);
            return;
        }

        if (action.id === 'feel_toward') {
            const grievanceTargets = this.relationships.getGrievanceTargets(cloud.id);

            const oldModel = this.model.clone();

            const targetIds = this.model.getTargetCloudIds();
            const alreadyBlended = this.model.getBlendedParts();
            const blendedResponses: { cloudId: string; response: string }[] = [];

            for (const blendedId of alreadyBlended) {
                if (this.relationships.hasGrievance(blendedId, cloud.id)) {
                    const response = this.getGrievanceResponse(blendedId, cloud.id);
                    if (response) {
                        blendedResponses.push({ cloudId: blendedId, response });
                    }
                }
            }

            for (const grievanceId of grievanceTargets) {
                const isPending = this.model.isPendingBlend(grievanceId);
                if (!targetIds.has(grievanceId) && !alreadyBlended.includes(grievanceId) && !isPending) {
                    const grievanceCloud = this.getCloudById(grievanceId);
                    if (grievanceCloud && this.model.getTrust(grievanceId) < 0.5) {
                        this.model.enqueuePendingBlend(grievanceId, 'therapist');
                    }
                }
            }

            const blendedParts = this.model.getBlendedParts();
            const hasPendingBlends = this.model.peekPendingBlend() !== null;

            if (blendedParts.length === 0 && !hasPendingBlends) {
                const unrevealed = this.model.getUnrevealedBiographyFields(cloud.id);
                this.createSelfRay(cloud.id, unrevealed);
            } else if (blendedResponses.length > 0) {
                this.showThoughtBubble(blendedResponses[0].response);
                this.model.adjustTrust(cloud.id, 0.9, 'therapist invited attack');
            }

            this.model.revealRelationships(cloud.id);
            this.syncViewWithModel(oldModel);
        }

        this.updateBiographyPanel();

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
        const protectedIds = this.relationships.getProtecting(cloudId);
        if (protectedIds.size === 0) {
            return "I don't have a job.";
        }
        const protectedId = Array.from(protectedIds)[0];
        const protectedCloud = this.getCloudById(protectedId);
        const protectedName = protectedCloud?.text ?? 'someone';
        this.model.revealIdentity(cloudId);
        return `I protect the ${protectedName} one.`;
    }

    private handleJobQuestion(cloud: Cloud, isBlended: boolean): void {
        if (this.model.isIdentityRevealed(cloud.id)) {
            this.showThoughtBubble("You already asked me that.");
            this.model.adjustTrust(cloud.id, 0.95, 'repeated job question');
            this.updateBiographyPanel();
            return;
        }

        this.showThoughtBubble(this.getJobResponse(cloud.id));

        if (isBlended) {
            this.reduceBlending(cloud.id, 0.3);
        }

        this.updateBiographyPanel();
    }

    private handleExpandCalm(cloud: Cloud): void {
        this.showThoughtBubble("Expanding calm and patience...", { label: 'Did the part notice?', targetCloudId: cloud.id });
    }

    private handleExpandCalmFollowUp(cloudId: string): void {
        if (Math.random() < 0.75) {
            this.relationships.clearProxies(cloudId);
            this.showThoughtBubble("I see you.");
        } else {
            this.showThoughtBubble("The part didn't notice yet.");
        }
    }

    private handleWhoDoYouSee(cloud: Cloud): void {
        const proxies = this.relationships.getProxies(cloud.id);
        if (proxies.size === 0) {
            this.showThoughtBubble("I see you.");
            return;
        }

        const targetIds = this.model.getTargetCloudIds();
        const availableProxies = Array.from(proxies).filter(id => !targetIds.has(id));
        if (availableProxies.length === 0) {
            const successChance = this.model.getSelfRay()?.targetCloudId === cloud.id ? 0.6 : 0.2;
            if (Math.random() < successChance) {
                this.relationships.clearProxies(cloud.id);
                this.showThoughtBubble("I see you.");
                return;
            }
            const proxyIds = Array.from(proxies);
            const proxyId = proxyIds[Math.floor(Math.random() * proxyIds.length)];
            const proxyCloud = this.getCloudById(proxyId);
            const proxyName = proxyCloud?.text ?? 'someone';
            this.showThoughtBubble(`I see the ${proxyName}.`);
            return;
        }

        const proxyId = availableProxies[Math.floor(Math.random() * availableProxies.length)];
        const proxyCloud = this.getCloudById(proxyId);
        const proxyName = proxyCloud?.text ?? 'someone';

        const oldModel = this.model.clone();
        this.model.addBlendedPart(proxyId, 'therapist');
        this.model.revealIdentity(proxyId);
        this.syncViewWithModel(oldModel);

        this.showThoughtBubble(`I see the ${proxyName}.`);
        this.updateBiographyPanel();
    }

    private reduceBlending(cloudId: string, baseAmount: number): void {
        if (!this.model.isBlended(cloudId)) return;

        const cloud = this.getCloudById(cloudId);
        if (!cloud) return;

        // Parts with low needAttention unblend more readily (up to 3x faster)
        const needAttention = this.model.getNeedAttention(cloudId);
        const multiplier = 1 + 2 * (1 - Math.min(1, needAttention));
        const amount = baseAmount * multiplier;

        const oldModel = this.model.clone();
        const currentDegree = this.model.getBlendingDegree(cloudId);
        const targetDegree = Math.max(0, currentDegree - amount);
        this.model.setBlendingDegree(cloudId, targetDegree);
        this.syncViewWithModel(oldModel);
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

        if (bio?.jobRevealed && dialogues?.unburdenedJob) {
            parts.push(`who ${dialogues.unburdenedJob.toLowerCase()}`);
        }

        if (parts.length === 0) {
            return 'this part';
        }
        return parts.join(', ');
    }

    private showThoughtBubble(reaction: string, followUp?: { label: string; targetCloudId: string }): void {
        if (!this.uiGroup) return;

        this.hideThoughtBubble();
        this.thoughtBubbleFollowUp = followUp ?? null;

        this.thoughtBubbleGroup = createGroup({ class: 'thought-bubble', 'pointer-events': 'none' });

        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        const bubbleX = centerX - 100;
        const bubbleY = centerY - 60;
        const hasFollowUp = !!followUp;
        const lines = reaction.split('\n');
        const bubbleRy = (hasFollowUp ? 55 : 40) + (lines.length > 1 ? (lines.length - 1) * 10 : 0);

        const bubbleStyle = { fill: 'white', stroke: '#333', 'stroke-width': 2, opacity: 0.95, 'pointer-events': 'auto' };
        const bubble = createEllipse(bubbleX, bubbleY, 80, bubbleRy, bubbleStyle);
        setClickHandler(bubble, () => this.hideThoughtBubble());
        this.thoughtBubbleGroup.appendChild(bubble);

        const smallCircle1 = createCircle(bubbleX + 50, bubbleY + bubbleRy - 10, 8, bubbleStyle);
        setClickHandler(smallCircle1, () => this.hideThoughtBubble());
        this.thoughtBubbleGroup.appendChild(smallCircle1);

        const smallCircle2 = createCircle(bubbleX + 65, bubbleY + bubbleRy + 5, 5, bubbleStyle);
        setClickHandler(smallCircle2, () => this.hideThoughtBubble());
        this.thoughtBubbleGroup.appendChild(smallCircle2);

        const lineHeight = 20;
        const totalTextHeight = lines.length * lineHeight;
        const textStartY = bubbleY - (hasFollowUp ? 15 : 0) - totalTextHeight / 2 + lineHeight / 2;

        const textLines: TextLine[] = lines.map((line, i) => ({
            text: line,
            fontSize: i === lines.length - 1 ? 18 : 14,
            fontStyle: i === lines.length - 1 ? 'italic' : undefined,
        }));
        const text = createText(bubbleX, textStartY, textLines, {
            'font-family': 'sans-serif',
            'text-anchor': 'middle',
            fill: '#333',
        });
        this.thoughtBubbleGroup.appendChild(text);

        if (followUp) {
            const buttonGroup = createGroup({ class: 'thought-bubble-button', 'pointer-events': 'auto' });
            buttonGroup.style.cursor = 'pointer';

            const buttonWidth = 100;
            const buttonHeight = 24;
            const buttonRect = createRect(bubbleX - buttonWidth / 2, bubbleY + 15, buttonWidth, buttonHeight, {
                rx: 12, fill: '#e8f4fd', stroke: '#3498db', 'stroke-width': 1.5, 'pointer-events': 'auto',
            });
            buttonGroup.appendChild(buttonRect);

            const buttonText = createText(bubbleX, bubbleY + 15 + buttonHeight / 2 + 4, followUp.label, {
                'font-size': 12, 'font-family': 'sans-serif', 'text-anchor': 'middle', fill: '#2980b9',
            });
            buttonGroup.appendChild(buttonText);

            setClickHandler(buttonGroup, () => this.handleThoughtBubbleFollowUp());
            this.thoughtBubbleGroup.appendChild(buttonGroup);
        }

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
        this.thoughtBubbleFollowUp = null;
    }

    private handleThoughtBubbleFollowUp(): void {
        const followUp = this.thoughtBubbleFollowUp;
        if (!followUp) return;

        const cloudId = followUp.targetCloudId;

        if (followUp.label === 'Did the part notice?') {
            this.handleExpandCalmFollowUp(cloudId);
            return;
        }

        const proxies = this.relationships.getProxies(cloudId);

        if (proxies.size > 0) {
            const deflections = ["The part is looking away.", "Shrug.", "I don't trust you."];
            const response = deflections[Math.floor(Math.random() * deflections.length)];
            this.showThoughtBubble(response);
            return;
        }

        const unrevealed = this.model.getUnrevealedBiographyFields(cloudId);

        if (unrevealed.length === 0) {
            if (this.otherPartsNeedMoreAttention(cloudId)) {
                this.showThoughtBubble("Other parts need your attention more than me.");
            } else {
                this.model.adjustTrust(cloudId, 1.2, 'received compassion');
                this.showThoughtBubble("Thank you for seeing me.");
            }
            this.updateBiographyPanel();
            return;
        }

        const fieldToReveal = unrevealed[Math.floor(Math.random() * unrevealed.length)];
        const response = this.revealBiographyField(fieldToReveal, cloudId);
        this.showThoughtBubble(response);
        this.updateBiographyPanel();
    }

    private otherPartsNeedMoreAttention(cloudId: string): boolean {
        const targetTrust = this.model.getTrust(cloudId);
        const allStates = this.model.getAllPartStates();

        let totalTrust = 0;
        let count = 0;
        for (const [id, state] of allStates) {
            if (id !== cloudId) {
                totalTrust += state.trust;
                count++;
            }
        }

        if (count === 0) return false;
        const averageTrust = totalTrust / count;
        return averageTrust < targetTrust;
    }

    private createSelfRay(cloudId: string, _unrevealedFields: ('age' | 'identity' | 'job')[]): void {
        this.model.setSelfRay(cloudId);
        this.syncViewWithModel();
    }

    private revealBiographyField(field: 'age' | 'identity' | 'job', cloudId: string): string {
        const cloud = this.getCloudById(cloudId);
        const partState = this.model.getPartState(cloudId);

        switch (field) {
            case 'age':
                this.model.revealAge(cloudId);
                const age = partState?.biography.partAge;
                if (typeof age === 'number') {
                    return `I'm ${age} years old.`;
                } else if (typeof age === 'string') {
                    return `I'm a ${age}.`;
                }
                return "I'm not sure how old I am.";
            case 'identity':
                this.model.revealIdentity(cloudId);
                return `I'm the ${cloud?.text ?? 'part'}.`;
            case 'job':
                this.model.revealJob(cloudId);
                if (!partState?.dialogues.unburdenedJob) {
                    throw new Error(`No unburdenedJob defined for part ${cloudId}`);
                }
                return partState.dialogues.unburdenedJob;
        }
    }

    private handleRayFieldSelect(field: 'age' | 'identity' | 'job' | 'gratitude', cloudId: string): void {
        const partState = this.model.getPartState(cloudId);
        if (!partState) return;

        let response: string;
        if (field === 'gratitude') {
            const protectedIds = this.relationships.getProtecting(cloudId);
            if (protectedIds.size > 0) {
                const protectedId = Array.from(protectedIds)[0];
                const protectedCloud = this.getCloudById(protectedId);
                const protectedName = protectedCloud?.text ?? 'someone';
                response = `Thank you for protecting the ${protectedName} one.`;
            } else {
                response = partState.dialogues.gratitudeResponse ?? "Thank you...";
            }
            this.model.adjustTrust(cloudId, 1.15, 'received gratitude');
        } else if (field === 'job') {
            response = this.getJobResponse(cloudId);
            this.model.adjustTrust(cloudId, 1.1, 'received curiosity');
        } else {
            response = this.revealBiographyField(field, cloudId);
            this.model.adjustTrust(cloudId, 1.1, 'received curiosity');
        }

        this.showThoughtBubble(response);
        this.syncViewWithModel();
        this.updateBiographyPanel();
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

    private showProtectors(targetCloud: Cloud): void {
        if (!this.zoomGroup) return;

        const oldModel = this.model.clone();

        this.clearRelatedClouds();

        const protectorIds = this.relationships.getProtectedBy(targetCloud.id);
        if (protectorIds.size === 0) return;

        const targetIds = this.model.getTargetCloudIds();
        const filteredProtectorIds = new Set(
            Array.from(protectorIds).filter(id => !targetIds.has(id))
        );

        this.model.setSupportingParts(targetCloud.id, filteredProtectorIds);

        let protectorIndex = 0;
        filteredProtectorIds.forEach((cloudId) => {
            const instance = this.instances.find(i => i.cloud.id === cloudId);
            if (instance) {
                this.positionRelatedCloud(instance, 'protector', protectorIndex++, filteredProtectorIds.size);
            }
        });

        this.syncViewWithModel(oldModel);
    }

    private showRelatedClouds(): void {
        const targetIds = this.model.getTargetCloudIds();
        const primaryTargetId = Array.from(targetIds)[0];
        if (!primaryTargetId || !this.zoomGroup) return;

        const oldModel = this.model.clone();

        this.clearRelatedClouds();

        const protectorIds = this.relationships.getProtectedBy(primaryTargetId);
        const grievanceIds = this.relationships.getGrievanceTargets(primaryTargetId);

        const filteredProtectorIds = new Set(
            Array.from(protectorIds).filter(id => !targetIds.has(id))
        );
        const filteredGrievanceIds = new Set(
            Array.from(grievanceIds).filter(id => !targetIds.has(id))
        );

        const allSupportingIds = new Set([...filteredProtectorIds, ...filteredGrievanceIds]);
        this.model.setSupportingParts(primaryTargetId, allSupportingIds);

        this.showRegionLabels(filteredProtectorIds.size > 0, filteredGrievanceIds.size > 0);

        let protectorIndex = 0;
        filteredProtectorIds.forEach((cloudId) => {
            const instance = this.instances.find(i => i.cloud.id === cloudId);
            if (instance) {
                this.positionRelatedCloud(instance, 'protector', protectorIndex++, filteredProtectorIds.size);
            }
        });

        let grievanceIndex = 0;
        filteredGrievanceIds.forEach(cloudId => {
            const instance = this.instances.find(i => i.cloud.id === cloudId);
            if (instance) {
                this.positionRelatedCloud(instance, 'grievance', grievanceIndex++, filteredGrievanceIds.size);
            }
        });

        this.syncViewWithModel(oldModel);
    }

    private showRegionLabels(hasProtectors: boolean, hasGrievances: boolean): void {
        if (!this.uiGroup) return;

        this.hideRegionLabels();
        this.regionLabelsGroup = createGroup({ class: 'region-labels' });

        const labelStyle = { 'font-size': 14, 'font-family': 'sans-serif', 'text-anchor': 'middle', 'font-weight': 'bold' };

        if (hasProtectors) {
            const label = createText(this.canvasWidth * 0.25, this.canvasHeight * 0.15, 'Protectors', { ...labelStyle, fill: '#3498db' });
            this.regionLabelsGroup.appendChild(label);
        }

        if (hasGrievances) {
            const label = createText(this.canvasWidth * 0.25, this.canvasHeight * 0.65, 'Grievances', { ...labelStyle, fill: '#e74c3c' });
            this.regionLabelsGroup.appendChild(label);
        }

        this.uiGroup.appendChild(this.regionLabelsGroup);
    }

    private hideRegionLabels(): void {
        if (this.regionLabelsGroup && this.regionLabelsGroup.parentNode) {
            this.regionLabelsGroup.parentNode.removeChild(this.regionLabelsGroup);
        }
        this.regionLabelsGroup = null;
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

    private createBiographyPanel(): void {
        if (!this.container) return;

        this.biographyContainer = document.createElement('div');
        this.biographyContainer.className = 'biography-panel';
        this.biographyContainer.style.display = 'none';
        this.container.appendChild(this.biographyContainer);
    }

    private updateBiographyPanel(): void {
        if (!this.biographyContainer) return;

        const targetIds = this.model.getTargetCloudIds();
        if (targetIds.size === 0) return;

        let html = '';

        if (targetIds.size === 1) {
            const cloudId = Array.from(targetIds)[0];
            const cloud = this.getCloudById(cloudId);
            if (!cloud) return;

            const biography = this.model.getBiography(cloudId);
            const displayLabel = this.model.isIdentityRevealed(cloudId) ? cloud.text : '???';
            const displayAge = this.model.getDisplayAge(cloudId);
            html = `<div class="bio-header">${displayLabel}</div>`;

            if (displayAge) {
                html += `<div class="bio-field"><span class="bio-label">Age:</span> ${displayAge}</div>`;
            }

            if (biography?.protectsRevealed) {
                const protectedIds = this.relationships.getProtecting(cloudId);
                if (protectedIds.size > 0) {
                    const protectedNames = Array.from(protectedIds)
                        .map(id => {
                            const protectedCloud = this.getCloudById(id);
                            return this.model.isIdentityRevealed(id) ? protectedCloud?.text ?? '???' : '???';
                        })
                        .join(', ');
                    html += `<div class="bio-field"><span class="bio-label">Protects:</span> ${protectedNames}</div>`;
                } else {
                    html += `<div class="bio-field"><span class="bio-label">Protects:</span> <em>no one</em></div>`;
                }
            }
        } else {
            html = `<div class="bio-header">Conference Room (${targetIds.size} parts)</div>`;
            for (const cloudId of targetIds) {
                const cloud = this.getCloudById(cloudId);
                if (cloud) {
                    const displayLabel = this.model.isIdentityRevealed(cloudId) ? cloud.text : '???';
                    html += `<div class="bio-field">• ${displayLabel}</div>`;
                }
            }
        }

        this.biographyContainer.innerHTML = html;
    }

    addCloud(word: string, options?: {
        id?: string;
        trust?: number;
        needAttention?: number;
        agreedWaitUntil?: number;
        partAge?: number | string;
        dialogues?: { burdenedJobAppraisal?: string[]; burdenedJobImpact?: string[]; unburdenedJob?: string };
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
        for (const instance of this.instances) {
            const state = this.model.getPartState(instance.cloud.id);
            const hovered = this.hoveredCloudId === instance.cloud.id;
            instance.cloud.updateSVGElements(enabled, state, hovered);
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
        if (this.debugPauseButton) return;

        const btn = document.createElement('button');
        btn.textContent = '⏸ Pause';
        btn.style.cssText = `
            position: fixed;
            bottom: 10px;
            left: 10px;
            z-index: 9999;
            padding: 8px 16px;
            font-size: 14px;
            font-weight: bold;
            background: #ff6b6b;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;

        btn.addEventListener('click', () => {
            if (this.animating) {
                this.stopAnimation();
                btn.textContent = '▶ Resume';
                btn.style.background = '#51cf66';
            } else {
                this.animating = true;
                this.lastFrameTime = performance.now();
                this.animate();
                btn.textContent = '⏸ Pause';
                btn.style.background = '#ff6b6b';
            }
        });

        document.body.appendChild(btn);
        this.debugPauseButton = btn;
    }

    private handleCloudClick(cloud: Cloud): void {
        this.hoveredCloudId = null;
        this.selectCloud(cloud);
    }

    selectCloud(cloud: Cloud): void {
        this.selectedCloud = cloud;

        if (this.view.getMode() === 'panorama') {
            this.model.setTargetCloud(cloud.id);
            this.view.setMode('foreground');
            this.updateUIForMode();
            this.updateModeToggle();
            this.syncViewWithModel();
        } else if (this.view.getMode() === 'foreground') {
            const cloudState = this.view.getCloudState(cloud.id);
            if (cloudState && cloudState.opacity > 0) {
                this.pieMenuController?.toggle(cloud.id, cloudState.x, cloudState.y);
            }
        }
    }

    private startUnblendingPart(cloudId: string): void {
        const cloud = this.getCloudById(cloudId);
        if (!cloud) {
            this.showActionFeedback("Part not found");
            return;
        }

        const targetIds = this.model.getTargetCloudIds();
        const firstTargetId = Array.from(targetIds)[0];
        if (!firstTargetId) {
            this.showActionFeedback("No target part to unblend toward");
            return;
        }

        const targetInstance = this.instances.find(i => i.cloud.id === firstTargetId);
        if (!targetInstance) {
            this.showActionFeedback("Target part not found");
            return;
        }

        const cloudState = this.view.getCloudState(firstTargetId);
        if (!cloudState) {
            this.showActionFeedback("Cannot locate target");
            return;
        }

        cloud.startUnblending(cloudState.x, cloudState.y);
    }

    private showActionFeedback(message: string): void {
        this.showThoughtBubble(message);
    }

    private stepBackPart(cloudId: string, options?: { showThoughtBubble?: boolean }): void {
        const showBubble = options?.showThoughtBubble ?? true;

        if (this.model.wasProxy(cloudId)) {
            if (showBubble) {
                this.showThoughtBubble("I want to watch.");
            }
            this.model.adjustTrust(cloudId, 0.98, 'refused to step back');
            return;
        }

        if (showBubble) {
            this.showThoughtBubble("Stepping back...");
        }

        // Model change triggers view to detect part left foreground and start fly-out
        this.model.stepBackPart(cloudId);
        this.syncViewWithModel();
        this.updateBiographyPanel();
    }

    private startUnblendingBlendedPart(cloudId: string): void {
        if (!this.model.isBlended(cloudId)) {
            this.showActionFeedback("This part is not blended");
            return;
        }

        this.showThoughtBubble("Okay, I'll separate a bit...");
        this.reduceBlending(cloudId, 0.3);
    }

    private blendTargetPart(cloudId: string): void {
        const oldModel = this.model.clone();
        this.model.removeTargetCloud(cloudId);
        this.model.addBlendedPart(cloudId, 'therapist');
        this.syncViewWithModel(oldModel);
        this.updateBiographyPanel();
    }

    private promotePendingBlend(cloudId: string): void {
        if (!this.model.isPendingBlend(cloudId)) return;

        const pending = this.model.getPendingBlends().find(p => p.cloudId === cloudId);
        if (!pending) return;

        // Remove from pending queue by dequeueing until we find it
        // (In practice there should only be one pending at a time reaching the star)
        const tempQueue: { cloudId: string; reason: 'spontaneous' | 'therapist' }[] = [];
        let item = this.model.dequeuePendingBlend();
        while (item && item.cloudId !== cloudId) {
            tempQueue.push(item);
            item = this.model.dequeuePendingBlend();
        }
        // Re-enqueue any items we removed that weren't the target
        for (const temp of tempQueue) {
            this.model.enqueuePendingBlend(temp.cloudId, temp.reason);
        }

        if (item) {
            this.model.addBlendedPart(cloudId, item.reason);
            this.syncViewWithModel();
        }
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
        console.log('[CloudManager] completeUnblending:', cloudId);
        const oldModel = this.model.clone();
        console.log('[CloudManager] oldModel blended:', oldModel.getBlendedParts(), 'targets:', Array.from(oldModel.getTargetCloudIds()));
        this.model.promoteBlendedToTarget(cloudId);
        console.log('[CloudManager] newModel blended:', this.model.getBlendedParts(), 'targets:', Array.from(this.model.getTargetCloudIds()));
        this.syncViewWithModel(oldModel);

        this.updateBiographyPanel();
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
        for (const instance of this.instances) {
            const projected = this.view.projectToScreen(instance);
            panoramaPositions.set(instance.cloud.id, {
                x: projected.x,
                y: projected.y,
                scale: projected.scale
            });
        }

        this.view.syncWithModel(oldModel, this.model, this.instances, panoramaPositions);
    }

    private updateUIForMode(): void {
        const mode = this.view.getMode();

        if (mode === 'foreground') {
            if (this.biographyContainer) {
                this.biographyContainer.style.display = 'block';
                this.updateBiographyPanel();
            }
        } else {
            if (this.biographyContainer) {
                this.biographyContainer.style.display = 'none';
            }
            this.hideThoughtBubble();
            this.hideRegionLabels();
            this.hidePieMenu();
            this.clearMessages();
        }
    }

    private clearMessages(): void {
        for (const message of this.messages) {
            message.element?.remove();
        }
        this.messages = [];
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
                this.checkBlendedPartsAttention();
            }
            this.updateMessages(deltaTime);
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
                    const enablePointerEvents = cloudState.opacity > 0.1 && !this.isPieMenuOpen();
                    group.setAttribute('pointer-events', enablePointerEvents ? 'auto' : 'none');
                }
            }
        }

        this.increaseGrievanceNeedAttention(deltaTime);
        this.updateDebugBox();

        if (!this.isPieMenuOpen()) {
            this.model.checkAttentionDemands(this.relationships);
            this.syncViewWithModel();
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

        const message: Message = {
            id: `msg_${this.messageIdCounter++}`,
            type,
            senderId,
            targetId,
            text,
            progress: 0,
            duration: 3.0,
            startX: senderState.x,
            startY: senderState.y,
            endX: targetState.x,
            endY: targetState.y,
            element: null,
            phase: 'traveling',
            lingerTime: 0,
            lingerDuration: 1.0 + Math.random() * 1.0
        };

        message.element = this.createMessageElement(message);
        this.messages.push(message);
    }

    private createMessageElement(message: Message): SVGGElement {
        const group = createGroup({ class: 'message-bubble' });

        const padding = 8;
        const fontSize = 11;
        const maxWidth = 120;

        const lines = this.wrapText(message.text, maxWidth, fontSize);
        const lineHeight = fontSize + 2;
        const textHeight = lines.length * lineHeight;
        const textWidth = Math.min(maxWidth, Math.max(...lines.map(l => l.length * fontSize * 0.5)));
        const bubbleWidth = textWidth + padding * 2;
        const bubbleHeight = textHeight + padding * 2;

        const isGrievance = message.type === 'grievance';
        const rect = createRect(-bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight, {
            rx: 6, fill: isGrievance ? '#ffcccc' : '#ffffff',
            stroke: isGrievance ? '#cc0000' : '#333333', 'stroke-width': 1.5,
        });
        group.appendChild(rect);

        const startY = -textHeight / 2 + fontSize;
        const textLines: TextLine[] = lines.map(line => ({ text: line }));
        const textEl = createText(0, startY, textLines, {
            'font-size': fontSize, 'font-family': 'sans-serif', 'text-anchor': 'middle', fill: '#333',
        });
        group.appendChild(textEl);

        group.setAttribute('transform', `translate(${message.startX}, ${message.startY})`);
        this.uiGroup?.appendChild(group);

        return group;
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

    private updateMessages(deltaTime: number): void {
        const toRemove: Message[] = [];

        for (const message of this.messages) {
            if (message.phase === 'traveling') {
                message.progress += deltaTime / message.duration;

                if (message.progress >= 1) {
                    message.progress = 1;
                    message.phase = 'lingering';
                    this.onMessageReceived(message);
                }

                let x: number, y: number;
                if (message.senderId === message.targetId) {
                    const angle = message.progress * 2 * Math.PI;
                    const radius = 40;
                    x = message.startX + radius * Math.cos(angle);
                    y = message.startY + radius * Math.sin(angle);
                } else {
                    const eased = this.easeInOutCubic(message.progress);
                    x = message.startX + (message.endX - message.startX) * eased;
                    y = message.startY + (message.endY - message.startY) * eased;
                }
                message.element?.setAttribute('transform', `translate(${x}, ${y})`);
            } else if (message.phase === 'lingering') {
                message.lingerTime += deltaTime;
                if (message.lingerTime >= message.lingerDuration) {
                    message.phase = 'fading';
                }
            } else if (message.phase === 'fading') {
                message.lingerTime += deltaTime;
                const fadeProgress = (message.lingerTime - message.lingerDuration) / 0.5;
                if (fadeProgress >= 1) {
                    toRemove.push(message);
                } else {
                    message.element?.setAttribute('opacity', String(1 - fadeProgress));
                }
            }
        }

        for (const message of toRemove) {
            message.element?.remove();
            const idx = this.messages.indexOf(message);
            if (idx !== -1) this.messages.splice(idx, 1);
        }
    }

    private easeInOutCubic(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    private onMessageReceived(message: Message): void {
        if (message.type === 'grievance') {
            this.model.adjustTrust(message.targetId, 0.99, 'grievance message');
            this.model.adjustNeedAttention(message.senderId, 0.8);
        }
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

    private updateDebugBox(): void {
        if (!this.debugBox) return;
        let maxNeedAttention = 0;
        let maxNeedAttentionName = '';
        for (const instance of this.instances) {
            const na = this.model.getNeedAttention(instance.cloud.id);
            if (na > maxNeedAttention) {
                maxNeedAttention = na;
                maxNeedAttentionName = instance.cloud.text;
            }
        }
        this.debugBox.textContent = `${maxNeedAttentionName}: ${maxNeedAttention.toFixed(2)}`;
    }

    private increaseGrievanceNeedAttention(deltaTime: number): void {
        for (const instance of this.instances) {
            const cloudId = instance.cloud.id;
            const hasGrievances = this.relationships.getGrievanceTargets(cloudId).size > 0;
            if (!hasGrievances) continue;

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
                const oldModel = this.model.clone();
                this.model.addTargetCloud(grievanceTargetId);
                this.syncViewWithModel(oldModel);
                // Store the target for next time and reset cooldown to queue the message with delay
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
}
