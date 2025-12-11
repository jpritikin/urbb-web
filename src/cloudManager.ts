import { Cloud, CloudType } from './cloudShape.js';
import { Point } from './geometry.js';
import { CloudRelationshipManager } from './cloudRelationshipManager.js';
import { PhysicsEngine, PhysicsConfig } from './physicsEngine.js';
import { SimulatorModel } from './ifsModel.js';
import { SimulatorView, STAR_OUTER_RADIUS, STAR_INNER_RADIUS } from './ifsView.js';
import { CarpetRenderer } from './carpetRenderer.js';
import { PieMenu, PieMenuItem } from './pieMenu.js';

export { CloudType };

export interface TherapistAction {
    id: string;
    question: string;
    shortName: string;
    category: 'discovery' | 'relationship' | 'history' | 'role';
}

export const THERAPIST_ACTIONS: TherapistAction[] = [
    { id: 'familiar', question: 'Is this part familiar to you?', shortName: 'Familiar?', category: 'discovery' },
    { id: 'first_memories', question: "When were this part's first memories?", shortName: 'Memories', category: 'history' },
    { id: 'feel_toward', question: 'How do you feel toward this part?', shortName: 'Feel', category: 'relationship' },
    { id: 'job', question: "What is this part's job?", shortName: 'Job', category: 'role' },
    { id: 'join_conference', question: 'Can this part join the conference?', shortName: 'Join', category: 'relationship' },
    { id: 'separate', question: 'Can you ask that part to separate a bit and sit next to you?', shortName: 'Separate', category: 'relationship' },
    { id: 'step_back', question: 'Can you ask this part to step back?', shortName: 'Step back', category: 'relationship' },
];

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
    private selfElement: SVGElement | null = null;
    private counterZoomGroup: SVGGElement | null = null;

    private uiContainer: HTMLElement | null = null;
    private debugBox: HTMLElement | null = null;

    private physicsEngine: PhysicsEngine;
    private model: SimulatorModel;
    private view: SimulatorView;

    private selectedAction: TherapistAction | null = null;
    private onActionSelect: ((action: TherapistAction, cloud: Cloud) => void) | null = null;
    private biographyContainer: HTMLElement | null = null;
    private thoughtBubbleGroup: SVGGElement | null = null;
    private thoughtBubbleFadeTimer: number = 0;
    private thoughtBubbleVisible: boolean = false;
    private relationshipClouds: Map<string, { instance: CloudInstance; region: string }> = new Map();
    private regionLabelsGroup: SVGGElement | null = null;
    private modeToggleContainer: HTMLElement | null = null;
    private pieMenu: PieMenu | null = null;
    private pieMenuOpen: boolean = false;
    private selectedCloudId: string | null = null;
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
    private messageCooldowns: Map<string, number> = new Map();

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

        this.model = new SimulatorModel();
        this.view = new SimulatorView(800, 600);
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

        this.carpetRenderer = new CarpetRenderer(this.canvasWidth, this.canvasHeight, this.counterZoomGroup);

        this.createSelfStar();
        this.createModeToggle();
        this.createUIContainer();
        this.createBiographyPanel();
        this.createPieMenu();
        this.createTraceButton();
        this.createTracePanel();
        this.createDebugBox();
        this.panX = this.canvasWidth / 2;
        this.panY = this.canvasHeight / 2;
        this.updateViewBox();
        this.setupVisibilityHandling();
        this.setupSelectionHandlers();
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

    private setupSelectionHandlers(): void {
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.code === 'Space' && this.view.getMode() === 'foreground' && !this.pieMenuOpen) {
                e.preventDefault();
                this.handleSelectionToggle();
            }
        });
    }

    private handleSelectionToggle(): void {
        if (this.hoveredCloudId) {
            if (this.model.isSelected(this.hoveredCloudId)) {
                this.model.deselectCloud();
            } else {
                this.model.selectCloud(this.hoveredCloudId);
            }
        } else {
            this.model.deselectCloud();
        }
    }

    setHoveredCloud(cloudId: string | null): void {
        this.hoveredCloudId = cloudId;
    }

    startLongPress(cloudId: string): void {
        if (this.view.getMode() !== 'foreground') return;
        this.cancelLongPress();
        this.longPressStartTime = performance.now();
        this.longPressTimer = window.setTimeout(() => {
            if (this.model.isSelected(cloudId)) {
                this.model.deselectCloud();
            } else {
                this.model.selectCloud(cloudId);
            }
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
        if (!this.svgElement) return;

        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        const points = 5;

        const starPoints: string[] = [];
        for (let i = 0; i < points * 2; i++) {
            const radius = i % 2 === 0 ? STAR_OUTER_RADIUS : STAR_INNER_RADIUS;
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
        this.view.setStarElement(star);
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
        if (!this.counterZoomGroup) return;

        const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        foreignObject.setAttribute('x', String(this.canvasWidth - 42));
        foreignObject.setAttribute('y', '10');
        foreignObject.setAttribute('width', '32');
        foreignObject.setAttribute('height', '32');

        this.modeToggleContainer = document.createElement('button');
        this.modeToggleContainer.className = 'zoom-toggle-btn';
        this.modeToggleContainer.innerHTML = '🔍';
        this.modeToggleContainer.title = 'Panorama view — click to focus';
        this.modeToggleContainer.addEventListener('click', () => {
            const isForeground = this.view.getMode() === 'foreground';
            this.handleModeToggle(!isForeground);
        });

        foreignObject.appendChild(this.modeToggleContainer);
        this.counterZoomGroup.appendChild(foreignObject);
    }

    private handleModeToggle(isForeground: boolean): void {
        this.view.setMode(isForeground ? 'foreground' : 'panorama');
        if (!isForeground) {
            this.model.deselectCloud();
        }
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

    private createPieMenu(): void {
        if (!this.counterZoomGroup) return;

        this.pieMenu = new PieMenu(this.counterZoomGroup);

        this.pieMenu.setOnSelect((item: PieMenuItem, cloudId: string) => {
            const action = THERAPIST_ACTIONS.find(a => a.id === item.id);
            if (action) {
                const cloud = this.getCloudById(cloudId);
                if (cloud) {
                    this.handleActionClick(action, cloud);
                }
            }
        });

        this.pieMenu.setOnClose(() => {
            this.pieMenuOpen = false;
            this.selectedCloudId = null;
            this.view.setConferenceRotationPaused(false);
        });
    }

    private getPieMenuItemsForCloud(cloudId: string): PieMenuItem[] {
        const isTarget = this.model.isTarget(cloudId);
        const isBlended = this.model.isBlended(cloudId);
        const isSupporting = this.model.getAllSupportingParts().has(cloudId);

        const items: PieMenuItem[] = [];

        for (const action of THERAPIST_ACTIONS) {
            let include = false;

            if (action.id === 'join_conference') {
                include = isSupporting && !isBlended;
            } else if (action.id === 'separate') {
                include = isBlended;
            } else if (action.id === 'step_back') {
                include = isTarget || isSupporting || isBlended;
            } else if (action.id === 'job') {
                include = isTarget || isBlended;
            } else {
                include = isTarget;
            }

            if (include) {
                items.push({
                    id: action.id,
                    label: action.question,
                    shortName: action.shortName,
                    category: action.category
                });
            }
        }

        return items;
    }

    isPieMenuOpen(): boolean {
        return this.pieMenuOpen;
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

    private handleActionClick(action: TherapistAction, targetCloud?: Cloud): void {
        const cloud = targetCloud ?? (this.selectedCloudId ? this.getCloudById(this.selectedCloudId) : null);
        if (!cloud) return;

        this.selectedAction = action;

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

        const isBlended = this.model.isBlended(cloud.id);

        this.model.recordQuestion(cloud.id, action.id);

        if (action.id === 'job') {
            this.handleJobQuestion(cloud, isBlended);
            return;
        }

        if (action.id === 'first_memories') {
            this.model.revealAge(cloud.id);
        } else if (action.id === 'feel_toward') {
            const protectorIds = this.relationships.getProtectedBy(cloud.id);
            const grievanceMap = this.relationships.getGrievances(cloud.id);

            const oldModel = this.model.clone();

            const targetIds = this.model.getTargetCloudIds();
            const blendedResponses: { cloudId: string; response: string; isGrievance: boolean }[] = [];

            for (const protectorId of protectorIds) {
                if (!targetIds.has(protectorId)) {
                    const protectorCloud = this.getCloudById(protectorId);
                    if (protectorCloud) {
                        const response = this.getProtectorResponse(protectorCloud, cloud);
                        if (response) {
                            this.model.addBlendedPart(protectorId);
                            blendedResponses.push({
                                cloudId: protectorId,
                                response,
                                isGrievance: false
                            });
                        }
                    }
                }
            }

            for (const [grievanceId, grievanceLevel] of grievanceMap) {
                if (grievanceLevel > 0 && !targetIds.has(grievanceId)) {
                    const grievanceCloud = this.getCloudById(grievanceId);
                    if (grievanceCloud && this.model.getTrust(grievanceId) < 0.5) {
                        const response = this.getGrievanceResponse(grievanceCloud, cloud);
                        if (response) {
                            this.model.addBlendedPart(grievanceId);
                            blendedResponses.push({
                                cloudId: grievanceId,
                                response,
                                isGrievance: true
                            });
                        }
                    }
                }
            }

            const blendedParts = this.model.getBlendedParts();

            if (blendedParts.length === 0) {
                const selfAspects = ['compassion', 'curiosity', 'gratitude', 'patience'];
                const selfAspect = selfAspects[Math.floor(Math.random() * selfAspects.length)];
                this.showThoughtBubble(selfAspect);
            } else if (blendedResponses.length > 0) {
                const firstResponse = blendedResponses[0];
                this.showThoughtBubble(firstResponse.response);
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

    private handleJobQuestion(cloud: Cloud, isBlended: boolean): void {
        if (this.model.isIdentityRevealed(cloud.id)) {
            this.showThoughtBubble("You already asked me that.");
            this.model.adjustTrust(cloud.id, 0.95, 'repeated job question');
            this.updateBiographyPanel();
            return;
        }

        const protectedIds = this.relationships.getProtecting(cloud.id);
        if (protectedIds.size === 0) {
            this.showThoughtBubble("I don't protect anyone.");
        } else {
            const protectedId = Array.from(protectedIds)[0];
            const protectedCloud = this.getCloudById(protectedId);
            const protectedName = protectedCloud?.text ?? 'someone';
            this.showThoughtBubble(`I protect the ${protectedName} one.`);
            this.model.revealIdentity(cloud.id);
        }

        if (isBlended) {
            this.reduceBlending(cloud.id, 0.3);
        }

        this.updateBiographyPanel();
    }

    private reduceBlending(cloudId: string, amount: number): void {
        if (!this.model.isBlended(cloudId)) return;

        const cloud = this.getCloudById(cloudId);
        if (!cloud) return;

        const oldModel = this.model.clone();
        const currentDegree = this.model.getBlendingDegree(cloudId);
        const targetDegree = Math.max(0, currentDegree - amount);
        this.model.setBlendingDegree(cloudId, targetDegree);
        this.syncViewWithModel(oldModel);
    }

    private getProtectorResponse(protectorCloud: Cloud, targetCloud: Cloud): string | null {
        const dialogues = this.model.getDialogues(protectorCloud.id);
        if (dialogues.burdenedProtector && dialogues.burdenedProtector.length > 0) {
            return dialogues.burdenedProtector[Math.floor(Math.random() * dialogues.burdenedProtector.length)];
        }
        return null;
    }

    private getGrievanceResponse(grievanceCloud: Cloud, targetCloud: Cloud): string | null {
        const dialogues = this.model.getDialogues(grievanceCloud.id);
        if (dialogues.burdenedGrievance && dialogues.burdenedGrievance.length > 0) {
            return dialogues.burdenedGrievance[Math.floor(Math.random() * dialogues.burdenedGrievance.length)];
        }
        return null;
    }

    private showThoughtBubble(reaction: string): void {
        if (!this.counterZoomGroup) return;

        this.hideThoughtBubble();

        this.thoughtBubbleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.thoughtBubbleGroup.setAttribute('class', 'thought-bubble');

        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        const bubbleX = centerX - 100;
        const bubbleY = centerY - 60;

        const bubble = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        bubble.setAttribute('cx', String(bubbleX));
        bubble.setAttribute('cy', String(bubbleY));
        bubble.setAttribute('rx', '80');
        bubble.setAttribute('ry', '40');
        bubble.setAttribute('fill', 'white');
        bubble.setAttribute('stroke', '#333');
        bubble.setAttribute('stroke-width', '2');
        bubble.setAttribute('opacity', '0.95');
        this.thoughtBubbleGroup.appendChild(bubble);

        const smallCircle1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        smallCircle1.setAttribute('cx', String(bubbleX + 50));
        smallCircle1.setAttribute('cy', String(bubbleY + 30));
        smallCircle1.setAttribute('r', '8');
        smallCircle1.setAttribute('fill', 'white');
        smallCircle1.setAttribute('stroke', '#333');
        smallCircle1.setAttribute('stroke-width', '2');
        smallCircle1.setAttribute('opacity', '0.95');
        this.thoughtBubbleGroup.appendChild(smallCircle1);

        const smallCircle2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        smallCircle2.setAttribute('cx', String(bubbleX + 65));
        smallCircle2.setAttribute('cy', String(bubbleY + 45));
        smallCircle2.setAttribute('r', '5');
        smallCircle2.setAttribute('fill', 'white');
        smallCircle2.setAttribute('stroke', '#333');
        smallCircle2.setAttribute('stroke-width', '2');
        smallCircle2.setAttribute('opacity', '0.95');
        this.thoughtBubbleGroup.appendChild(smallCircle2);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(bubbleX));
        text.setAttribute('y', String(bubbleY + 5));
        text.setAttribute('font-size', '18');
        text.setAttribute('font-family', 'sans-serif');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#333');
        text.textContent = reaction;
        this.thoughtBubbleGroup.appendChild(text);

        this.counterZoomGroup.appendChild(this.thoughtBubbleGroup);
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
        if (!this.counterZoomGroup) return;

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
        if (!primaryTargetId || !this.counterZoomGroup) return;

        const oldModel = this.model.clone();

        this.clearRelatedClouds();

        const protectorIds = this.relationships.getProtectedBy(primaryTargetId);
        const grievanceMap = this.relationships.getGrievances(primaryTargetId);
        const grievanceIds = new Set(Array.from(grievanceMap.keys()).filter(id => grievanceMap.get(id)! > 0));

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
        if (!this.counterZoomGroup) return;

        this.hideRegionLabels();

        this.regionLabelsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.regionLabelsGroup.setAttribute('class', 'region-labels');

        if (hasProtectors) {
            const protectorLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            protectorLabel.setAttribute('x', String(this.canvasWidth * 0.25));
            protectorLabel.setAttribute('y', String(this.canvasHeight * 0.15));
            protectorLabel.setAttribute('font-size', '14');
            protectorLabel.setAttribute('font-family', 'sans-serif');
            protectorLabel.setAttribute('text-anchor', 'middle');
            protectorLabel.setAttribute('fill', '#3498db');
            protectorLabel.setAttribute('font-weight', 'bold');
            protectorLabel.textContent = 'Protectors';
            this.regionLabelsGroup.appendChild(protectorLabel);
        }

        if (hasGrievances) {
            const grievanceLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            grievanceLabel.setAttribute('x', String(this.canvasWidth * 0.25));
            grievanceLabel.setAttribute('y', String(this.canvasHeight * 0.65));
            grievanceLabel.setAttribute('font-size', '14');
            grievanceLabel.setAttribute('font-family', 'sans-serif');
            grievanceLabel.setAttribute('text-anchor', 'middle');
            grievanceLabel.setAttribute('fill', '#e74c3c');
            grievanceLabel.setAttribute('font-weight', 'bold');
            grievanceLabel.textContent = 'Grievances';
            this.regionLabelsGroup.appendChild(grievanceLabel);
        }

        this.counterZoomGroup.appendChild(this.regionLabelsGroup);
    }

    private hideRegionLabels(): void {
        if (this.regionLabelsGroup && this.regionLabelsGroup.parentNode) {
            this.regionLabelsGroup.parentNode.removeChild(this.regionLabelsGroup);
        }
        this.regionLabelsGroup = null;
    }

    private positionRelatedCloud(instance: CloudInstance, region: string, index: number, total: number): void {
        if (!this.counterZoomGroup) return;

        const regionPositions = {
            protector: { x: this.canvasWidth * 0.25, y: this.canvasHeight * 0.25 },
            grievance: { x: this.canvasWidth * 0.25, y: this.canvasHeight * 0.75 },
        };

        const basePos = regionPositions[region as keyof typeof regionPositions];
        const offsetY = (index - (total - 1) / 2) * 60;

        const group = instance.cloud.getGroupElement();
        if (group) {
            if (group.parentNode !== this.counterZoomGroup) {
                this.counterZoomGroup.appendChild(group);
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
        dialogues?: { burdenedProtector?: string[]; burdenedGrievance?: string[]; unburdenedJob?: string };
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
            onHover: (hovered) => this.setHoveredCloud(hovered ? cloud.id : null),
            onLongPressStart: () => this.startLongPress(cloud.id),
            onLongPressEnd: () => this.cancelLongPress(),
        });
        this.svgElement.appendChild(group);
        cloud.updateSVGElements(this.debug, state, this.model.isSelected(cloud.id));

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
            instance.cloud.updateSVGElements(enabled, state, this.model.isSelected(instance.cloud.id));
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
        const mode = this.view.getMode();
        const isTransitioning = this.view.isTransitioning();
        let centerX = this.panX;
        let centerY = this.panY;

        if (isTransitioning || mode === 'foreground') {
            centerX = this.canvasWidth / 2;
            centerY = this.canvasHeight / 2;
        }

        const zoomFactor = this.view.getCurrentZoomFactor();
        const effectiveZoom = this.zoom * zoomFactor;

        const scaledWidth = this.canvasWidth / effectiveZoom;
        const scaledHeight = this.canvasHeight / effectiveZoom;
        const viewBoxX = centerX - scaledWidth / 2;
        const viewBoxY = centerY - scaledHeight / 2;

        this.svgElement?.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${scaledWidth} ${scaledHeight}`);

        if (this.debugBox) {
            const debugText =
                `Mode: ${mode}\n` +
                `Transition: ${isTransitioning ? 'yes' : 'no'} (${(this.view.getTransitionProgress() * 100).toFixed(0)}%)\n` +
                `ViewBox: ${viewBoxX.toFixed(1)} ${viewBoxY.toFixed(1)} ${scaledWidth.toFixed(1)} ${scaledHeight.toFixed(1)}\n` +
                `Zoom: ${effectiveZoom.toFixed(2)}x`;
            this.debugBox.textContent = debugText;
        }
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
        if (this.isLongPressActive()) {
            return;
        }

        if (this.view.getMode() === 'foreground' && this.model.isSelected(cloud.id)) {
            this.model.deselectCloud();
            return;
        }

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
            const viewState = this.view.getViewState(cloud.id);
            if (viewState && viewState.currentOpacity > 0) {
                this.togglePieMenu(cloud.id, viewState.currentX, viewState.currentY);
            }
        }
    }

    private togglePieMenu(cloudId: string, x: number, y: number): void {
        if (!this.pieMenu) return;

        if (this.pieMenuOpen && this.selectedCloudId === cloudId) {
            this.pieMenu.hide();
            return;
        }

        if (this.pieMenuOpen) {
            this.pieMenu.hide();
        }

        const items = this.getPieMenuItemsForCloud(cloudId);
        if (items.length === 0) return;

        this.pieMenu.setItems(items);
        this.pieMenu.show(x, y, cloudId);
        this.pieMenuOpen = true;
        this.selectedCloudId = cloudId;
        this.view.setConferenceRotationPaused(true);
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

        const viewState = this.view.getViewState(firstTargetId);
        if (!viewState) {
            this.showActionFeedback("Cannot locate target");
            return;
        }

        cloud.startUnblending(viewState.currentX, viewState.currentY);
    }

    private showActionFeedback(message: string): void {
        this.showThoughtBubble(message);
    }

    private stepBackPart(cloudId: string): void {
        const panoramaPositions = new Map<string, { x: number; y: number; scale: number }>();

        for (const instance of this.instances) {
            const projected = this.view.projectToScreen(instance);
            panoramaPositions.set(instance.cloud.id, {
                x: projected.x,
                y: projected.y,
                scale: projected.scale
            });
        }

        const panoramaPos = panoramaPositions.get(cloudId);
        if (!panoramaPos) return;

        this.showThoughtBubble("Stepping back...");
        this.view.animateStepBack(cloudId, panoramaPos.x, panoramaPos.y, panoramaPos.scale);
        this.model.stepBackPart(cloudId);
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

    private finishUnblending(cloudId: string): void {
        const cloud = this.getCloudById(cloudId);
        if (!cloud) return;

        // Get target seat position while still blended
        const targetPos = this.view.getBlendedStretchTarget(cloud, this.model);
        if (!targetPos) {
            this.model.promoteBlendedToTarget(cloudId);
            this.syncViewWithModel();
            return;
        }

        // Animate the stretch resolving smoothly, then promote
        this.animateStretchResolution(cloudId, targetPos, 1.0);
    }

    private animateStretchResolution(cloudId: string, targetPos: { x: number; y: number }, duration: number): void {
        const cloud = this.getCloudById(cloudId);
        if (!cloud) return;

        const initialStretch = cloud.getBlendedStretch();
        if (!initialStretch) {
            this.completeUnblending(cloudId, targetPos);
            return;
        }

        // Get the ACTUAL current lattice offset, not the target stretch
        // This ensures we start from where the lattice visually is, not where it's heading
        const actualOffset = cloud.getActualLatticeOffset();
        const startStretchX = actualOffset?.x ?? initialStretch.stretchX;
        const startStretchY = actualOffset?.y ?? initialStretch.stretchY;

        // Mark as resolving so updateBlendedLatticeDeformations doesn't interfere
        this.resolvingClouds.add(cloudId);

        const viewState = this.view.getViewState(cloudId);

        // The cloud is stretched from anchor (near star) toward seat.
        // Position is where the anchor edge is. Visual center is offset by stretch/2.
        // We want to keep the visual appearance smooth by:
        // 1. Keeping the far edge (seat side) stationary
        // 2. Retracting the near edge (star side) as stretch reduces
        //
        // The far edge is at: anchorPos + stretch
        // As stretch reduces, we move anchorPos toward the far edge to compensate.
        // Final position should be at targetPos (the seat).

        // Get the ACTUAL current position from the stretch position state, not viewState
        // During BLEND, the transform was set from stretchPositionState, not viewState
        const stretchPosState = this.view.getStretchPositionState(cloudId);
        const anchorPosX = stretchPosState?.currentX ?? viewState?.currentX ?? targetPos.x;
        const anchorPosY = stretchPosState?.currentY ?? viewState?.currentY ?? targetPos.y;

        // Also update viewState to match so the main loop doesn't cause a jump
        if (viewState) {
            viewState.currentX = anchorPosX;
            viewState.currentY = anchorPosY;
        }

        // The far edge of the stretched cloud (seat side) - use actual offset for accuracy
        const farEdgeX = anchorPosX + startStretchX;
        const farEdgeY = anchorPosY + startStretchY;


        const startTime = performance.now();

        const animate = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            const progress = Math.min(1, elapsed / duration);
            const eased = progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;

            // Reduce stretch toward zero - use startStretch for smooth animation
            const remainingStretch = 1 - eased;
            cloud.setBlendedStretchImmediate(
                startStretchX * remainingStretch,
                startStretchY * remainingStretch,
                initialStretch.anchorSide
            );

            // Move position so the far edge stays fixed, then smoothly moves to target
            // farEdge = pos + stretch, so pos = farEdge - stretch
            // As stretch reduces, pos moves toward farEdge
            // Then farEdge itself moves toward target
            const currentFarEdgeX = farEdgeX + (targetPos.x - farEdgeX) * eased;
            const currentFarEdgeY = farEdgeY + (targetPos.y - farEdgeY) * eased;

            if (viewState) {
                viewState.currentX = currentFarEdgeX - startStretchX * remainingStretch;
                viewState.currentY = currentFarEdgeY - startStretchY * remainingStretch;
            }


            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                cloud.clearBlendedStretch();
                this.resolvingClouds.delete(cloudId);
                this.completeUnblending(cloudId, targetPos);
            }
        };

        requestAnimationFrame(animate);
    }

    private completeUnblending(cloudId: string, targetPos: { x: number; y: number }): void {
        const cloud = this.getCloudById(cloudId);
        if (!cloud) return;

        cloud.clearBlendedStretch();
        cloud.setBlended(false);

        const oldModel = this.model.clone();
        this.model.promoteBlendedToTarget(cloudId);
        this.syncViewWithModel(oldModel);

        // Ensure final position is at seat
        const viewState = this.view.getViewState(cloudId);
        if (viewState) {
            viewState.currentX = targetPos.x;
            viewState.currentY = targetPos.y;
        }

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
        }
    }

    private hidePieMenu(): void {
        if (this.pieMenu && this.pieMenuOpen) {
            this.pieMenu.hide();
        }
    }

    private checkHighAttentionParts(): void {
        const sorted = [...this.instances].sort(
            (a, b) => this.model.getNeedAttention(b.cloud.id) - this.model.getNeedAttention(a.cloud.id)
        );

        for (const instance of sorted) {
            const cloud = instance.cloud;
            if (this.model.getNeedAttention(cloud.id) <= 1) break;

            const protectors = this.relationships.getProtectedBy(cloud.id);
            if (protectors.size > 0) continue;

            const grievances = this.relationships.getGrievances(cloud.id);
            if (grievances.size > 0) {
                const grievanceIds = Array.from(grievances.keys());
                const targetGrievanceId = grievanceIds[Math.floor(Math.random() * grievanceIds.length)];
                this.model.setTargetCloud(targetGrievanceId);
            }

            this.model.addBlendedPart(cloud.id);
            this.view.setMode('foreground');
            this.updateUIForMode();
            this.updateModeToggle();
            this.syncViewWithModel();
            break;
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

        if (document.hidden) {
            this.lastFrameTime = performance.now();
            this.animationFrameId = requestAnimationFrame(() => this.animate());
            return;
        }

        const currentTime = performance.now();
        const deltaTime = Math.min((currentTime - this.lastFrameTime) / 1000, 0.1);
        this.lastFrameTime = currentTime;

        this.view.animate(deltaTime);

        const mode = this.view.getMode();
        const isTransitioning = this.view.isTransitioning();

        if (isTransitioning) {
            this.syncViewWithModel();
        }

        if (this.view.isSeatCountAnimating() || this.view.isConferenceRotating()) {
            this.view.updateForegroundPositions(this.model, this.instances);
        }

        const currentZoomFactor = this.view.getCurrentZoomFactor();

        this.updateCounterZoom(currentZoomFactor);

        if (isTransitioning || mode === 'foreground') {
            this.updateViewBox();
        }

        if (mode === 'foreground') {
            this.updateThoughtBubble(deltaTime);
            this.view.animateStretchPositions(deltaTime);
            const { completedUnblendings } = this.view.animateBlendingDegrees(this.instances);
            for (const cloudId of completedUnblendings) {
                if (this.model.isBlended(cloudId)) {
                    this.finishUnblending(cloudId);
                }
            }
            this.view.updateBlendedLatticeDeformations(this.model, this.instances, this.resolvingClouds);
            const transitioningToForeground = isTransitioning && this.view.getTransitionDirection() === 'forward';
            if (this.carpetRenderer && !transitioningToForeground) {
                const seats = this.view.getSeatInfo(this.model);
                this.carpetRenderer.update(seats, deltaTime);
                this.carpetRenderer.render();
                this.carpetRenderer.renderDebugWaveField();
            }
            if (!isTransitioning && !this.pieMenuOpen) {
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
                    this.applyPhysics(instance, deltaTime * this.partitionCount);
                    const projected = this.view.projectToScreen(instance);
                    this.view.updatePanoramaPosition(instance.cloud.id, projected.x, projected.y, projected.scale);
                }
                const state = this.model.getPartState(instance.cloud.id);
                instance.cloud.updateSVGElements(this.debug, state, this.model.isSelected(instance.cloud.id));
            }

            const viewState = this.view.getViewState(instance.cloud.id);
            if (viewState) {
                const group = instance.cloud.getGroupElement();
                if (group) {
                    if (viewState.inCounterZoomGroup && group.parentNode !== this.counterZoomGroup) {
                        this.counterZoomGroup?.appendChild(group);
                    } else if (!viewState.inCounterZoomGroup && group.parentNode !== this.svgElement) {
                        this.svgElement?.appendChild(group);
                    }

                    group.setAttribute('transform',
                        `translate(${viewState.currentX}, ${viewState.currentY}) scale(${viewState.currentScale})`);
                    group.setAttribute('opacity', String(viewState.currentOpacity));
                }
            }
        }

        if (this.view.getMode() === 'panorama') {
            this.checkHighAttentionParts();
            this.depthSort();
        }
        this.currentPartition = (this.currentPartition + 1) % this.partitionCount;
        this.animationFrameId = requestAnimationFrame(() => this.animate());
    }

    private updateCounterZoom(currentZoomFactor: number): void {
        if (!this.counterZoomGroup) return;

        const counterScale = 1 / currentZoomFactor;
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;

        this.counterZoomGroup.setAttribute('transform',
            `translate(${centerX}, ${centerY}) scale(${counterScale}) translate(${-centerX}, ${-centerY})`);
    }

    private applyPhysics(instance: CloudInstance, deltaTime: number): void {
        this.physicsEngine.applyPhysics(instance, this.instances, deltaTime);
    }

    private sendMessage(senderId: string, targetId: string, text: string, type: 'grievance'): void {
        const senderViewState = this.view.getViewState(senderId);
        const targetViewState = this.view.getViewState(targetId);
        if (!senderViewState || !targetViewState) return;

        const message: Message = {
            id: `msg_${this.messageIdCounter++}`,
            type,
            senderId,
            targetId,
            text,
            progress: 0,
            duration: 3.0,
            startX: senderViewState.currentX,
            startY: senderViewState.currentY,
            endX: targetViewState.currentX,
            endY: targetViewState.currentY,
            element: null
        };

        message.element = this.createMessageElement(message);
        this.messages.push(message);
    }

    private createMessageElement(message: Message): SVGGElement {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'message-bubble');

        const padding = 8;
        const fontSize = 11;
        const maxWidth = 120;

        const words = message.text.split(' ');
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

        const lineHeight = fontSize + 2;
        const textHeight = lines.length * lineHeight;
        const textWidth = Math.min(maxWidth, Math.max(...lines.map(l => l.length * fontSize * 0.5)));
        const bubbleWidth = textWidth + padding * 2;
        const bubbleHeight = textHeight + padding * 2;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(-bubbleWidth / 2));
        rect.setAttribute('y', String(-bubbleHeight / 2));
        rect.setAttribute('width', String(bubbleWidth));
        rect.setAttribute('height', String(bubbleHeight));
        rect.setAttribute('rx', '6');
        rect.setAttribute('fill', message.type === 'grievance' ? '#ffcccc' : '#ffffff');
        rect.setAttribute('stroke', message.type === 'grievance' ? '#cc0000' : '#333333');
        rect.setAttribute('stroke-width', '1.5');
        group.appendChild(rect);

        const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('font-size', String(fontSize));
        textEl.setAttribute('font-family', 'sans-serif');
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('fill', '#333');

        const startY = -textHeight / 2 + fontSize;
        for (let i = 0; i < lines.length; i++) {
            const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspan.setAttribute('x', '0');
            tspan.setAttribute('y', String(startY + i * lineHeight));
            tspan.textContent = lines[i];
            textEl.appendChild(tspan);
        }
        group.appendChild(textEl);

        group.setAttribute('transform', `translate(${message.startX}, ${message.startY})`);
        this.counterZoomGroup?.appendChild(group);

        return group;
    }

    private updateMessages(deltaTime: number): void {
        const completed: Message[] = [];

        for (const message of this.messages) {
            message.progress += deltaTime / message.duration;

            if (message.progress >= 1) {
                completed.push(message);
                continue;
            }

            const eased = this.easeInOutCubic(message.progress);
            const x = message.startX + (message.endX - message.startX) * eased;
            const y = message.startY + (message.endY - message.startY) * eased;

            message.element?.setAttribute('transform', `translate(${x}, ${y})`);
        }

        for (const message of completed) {
            this.onMessageReceived(message);
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

            if (this.model.getNeedAttention(cloudId) < 0.5) {
                this.finishUnblending(cloudId);
            }
        }
    }

    private checkAndSendGrievanceMessages(): void {
        const blendedParts = this.model.getBlendedParts();
        const targetIds = this.model.getTargetCloudIds();

        for (const blendedId of blendedParts) {
            const blendedCloud = this.getCloudById(blendedId);
            if (!blendedCloud) continue;

            const grievances = this.relationships.getGrievances(blendedId);

            for (const [grievanceTargetId] of grievances) {
                if (!targetIds.has(grievanceTargetId)) continue;

                const cooldownKey = `${blendedId}->${grievanceTargetId}`;
                const lastSent = this.messageCooldowns.get(cooldownKey) ?? 0;
                const now = performance.now();

                if (now - lastSent < 10000) continue;

                const dialogues = this.model.getDialogues(blendedId);
                if (!dialogues.burdenedGrievance || dialogues.burdenedGrievance.length === 0) continue;

                const text = dialogues.burdenedGrievance[Math.floor(Math.random() * dialogues.burdenedGrievance.length)];
                this.sendMessage(blendedId, grievanceTargetId, text, 'grievance');
                this.messageCooldowns.set(cooldownKey, now);
            }
        }
    }
}
