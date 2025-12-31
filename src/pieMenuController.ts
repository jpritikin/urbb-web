import { Cloud } from './cloudShape.js';
import { CloudRelationshipManager } from './cloudRelationshipManager.js';
import { SimulatorModel } from './ifsModel.js';
import { SimulatorView } from './ifsView.js';
import { PieMenu, PieMenuItem } from './pieMenu.js';
import { TherapistAction, THERAPIST_ACTIONS } from './therapistActions.js';
import { BiographyField, PartContext } from './selfRay.js';
import { SimulatorController, ValidAction } from './simulatorController.js';
import { STAR_CLOUD_ID } from './ifsView/SeatManager.js';

export interface PieMenuDependencies {
    getCloudById: (id: string) => Cloud | null;
    model: SimulatorModel;
    view: SimulatorView;
    relationships: CloudRelationshipManager;
    controller?: SimulatorController;
}

type MenuMode = 'cloud' | 'selfRay' | 'star';

export class PieMenuController {
    private pieMenu: PieMenu | null = null;
    private pieMenuOpen = false;
    private selectedCloudId: string | null = null;
    private menuMode: MenuMode = 'cloud';
    private onActionSelect: ((action: TherapistAction, cloud: Cloud) => void) | null = null;
    private onStarActionSelect: ((action: TherapistAction) => void) | null = null;
    private onBiographySelect: ((field: BiographyField, cloudId: string) => void) | null = null;
    private onClose: (() => void) | null = null;
    private getPartContext: ((cloudId: string) => PartContext) | null = null;

    constructor(
        private uiGroup: SVGGElement,
        private pieMenuOverlay: SVGGElement,
        private deps: PieMenuDependencies
    ) {
        this.createPieMenu();
    }

    private createPieMenu(): void {
        this.pieMenu = new PieMenu(this.uiGroup);
        this.pieMenu.setOverlayContainer(this.pieMenuOverlay);

        this.pieMenu.setOnSelect((item: PieMenuItem, cloudId: string) => {
            if (this.menuMode === 'selfRay') {
                const field = item.id as BiographyField;
                this.onBiographySelect?.(field, cloudId);
            } else if (this.menuMode === 'star') {
                const action = THERAPIST_ACTIONS.find(a => a.id === item.id);
                if (action) {
                    this.onStarActionSelect?.(action);
                }
            } else {
                const action = THERAPIST_ACTIONS.find(a => a.id === item.id);
                if (action) {
                    const cloud = this.deps.getCloudById(cloudId);
                    if (cloud && this.onActionSelect) {
                        this.onActionSelect(action, cloud);
                    }
                }
            }
        });

        this.pieMenu.setOnClose(() => {
            this.pieMenuOpen = false;
            this.selectedCloudId = null;
            this.menuMode = 'cloud';
            this.onClose?.();
        });
    }

    setOnActionSelect(handler: (action: TherapistAction, cloud: Cloud) => void): void {
        this.onActionSelect = handler;
    }

    setOnStarActionSelect(handler: (action: TherapistAction) => void): void {
        this.onStarActionSelect = handler;
    }

    setOnBiographySelect(handler: (field: BiographyField, cloudId: string) => void): void {
        this.onBiographySelect = handler;
    }

    setGetPartContext(callback: (cloudId: string) => PartContext): void {
        this.getPartContext = callback;
    }

    setOnClose(handler: () => void): void {
        this.onClose = handler;
    }

    isOpen(): boolean {
        return this.pieMenuOpen;
    }

    getSelectedCloudId(): string | null {
        return this.selectedCloudId;
    }

    toggle(cloudId: string, x: number, y: number, touchEvent?: TouchEvent): void {
        this.showMenu('cloud', cloudId, x, y, this.getItemsForCloud(cloudId), touchEvent);
    }

    toggleSelfRay(cloudId: string, x: number, y: number, touchEvent?: TouchEvent): void {
        this.showMenu('selfRay', cloudId, x, y, this.getItemsForSelfRay(cloudId), touchEvent);
    }

    toggleStar(x: number, y: number, touchEvent?: TouchEvent): void {
        this.showMenu('star', STAR_CLOUD_ID, x, y, this.getItemsForStar(), touchEvent);
    }

    private showMenu(mode: MenuMode, cloudId: string, x: number, y: number, items: PieMenuItem[], touchEvent?: TouchEvent): void {
        if (!this.pieMenu) return;

        if (this.pieMenuOpen && this.selectedCloudId === cloudId && this.menuMode === mode) {
            this.pieMenu.hide();
            return;
        }

        if (this.pieMenuOpen) {
            this.pieMenu.hide();
        }

        if (items.length === 0) return;

        this.menuMode = mode;
        this.pieMenu.setItems(items);
        if (touchEvent && touchEvent.touches.length > 0) {
            const touch = touchEvent.touches[0];
            this.pieMenu.showWithTouch(x, y, cloudId, touch.clientX, touch.clientY);
        } else {
            this.pieMenu.show(x, y, cloudId);
        }
        this.pieMenuOpen = true;
        this.selectedCloudId = cloudId;
    }

    hide(): void {
        if (this.pieMenu && this.pieMenuOpen) {
            this.pieMenu.hide();
        }
    }

    private getItemsForCloud(cloudId: string): PieMenuItem[] {
        const { model, relationships, controller } = this.deps;

        const validActions = controller?.getValidActions() ?? [];
        const validForCloud = validActions.filter(a => a.cloudId === cloudId && a.action !== 'ray_field_select');

        const proxyAsTargetId = this.getProxyAsTarget(cloudId);
        const proxyRevealed = proxyAsTargetId && model.parts.isIdentityRevealed(proxyAsTargetId);

        const items: PieMenuItem[] = [];
        const seenActions = new Set<string>();

        for (const validAction of validForCloud) {
            if (seenActions.has(validAction.action)) continue;
            seenActions.add(validAction.action);

            const action = THERAPIST_ACTIONS.find(a => a.id === validAction.action);
            if (!action) continue;

            let label = action.question;

            if (action.id === 'feel_toward' && proxyRevealed) {
                label = "How do you feel toward this part that doesn't know you very well?";
            } else if (action.id === 'who_do_you_see' && model.getSelfRay()?.targetCloudId === cloudId && proxyRevealed) {
                const proxyCloud = this.deps.getCloudById(proxyAsTargetId!);
                const proxyName = proxyCloud?.text ?? 'the proxy';
                label = `Who do you see when you look at the client?\nWould you be willing to notice the compassion instead of seeing ${proxyName}?`;
            } else if (action.id === 'separate') {
                label = "Can you make a little space for client?";
            } else if (action.id === 'help_protected') {
                const protectedIds = relationships.getProtecting(cloudId);
                if (protectedIds.size > 0) {
                    const protectedId = Array.from(protectedIds)[0];
                    const protectedCloud = this.deps.getCloudById(protectedId);
                    const protectedName = protectedCloud?.text ?? 'that';
                    label = label.replace('$PART', protectedName);
                }
            }

            items.push({
                id: action.id,
                label,
                shortName: action.shortName,
                category: action.category
            });
        }

        return items;
    }

    private getItemsForSelfRay(cloudId: string): PieMenuItem[] {
        const { controller } = this.deps;
        const context = this.getPartContext?.(cloudId) ?? {
            isProtector: false,
            isIdentityRevealed: false,
            isAttacked: false,
            partName: ''
        };

        const validActions = controller?.getValidActions() ?? [];
        const rayActions = validActions.filter(a => a.cloudId === cloudId && a.action === 'ray_field_select');
        const validFields = new Set(rayActions.map(a => a.field));

        const fieldLabels: Record<string, { label: string; shortName: string; category: string }> = {
            age: { label: 'How old are you?', shortName: 'Age', category: 'curiosity' },
            identity: { label: 'Who are you?', shortName: 'Identity', category: 'curiosity' },
            jobAppraisal: { label: 'How do you like your job?', shortName: 'Appraisal', category: 'curiosity' },
            jobImpact: { label: 'How do you understand the impact of your job?', shortName: 'Impact', category: 'curiosity' },
            whatNeedToKnow: { label: 'What do you need me to know?', shortName: 'Need?', category: 'curiosity' },
            gratitude: { label: 'Thank you for being here', shortName: 'Gratitude', category: 'gratitude' },
            compassion: { label: 'I care about you', shortName: 'Compassion', category: 'gratitude' },
            apologize: { label: `Apologize to ${context.partName} for allowing other parts to attack it`, shortName: 'Apologize', category: 'gratitude' },
        };

        const fieldOrder = ['age', 'identity', 'jobAppraisal', 'jobImpact', 'whatNeedToKnow', 'gratitude', 'compassion', 'apologize'];

        const items: PieMenuItem[] = [];
        for (const field of fieldOrder) {
            if (validFields.has(field as BiographyField)) {
                const info = fieldLabels[field];
                items.push({ id: field, label: info.label, shortName: info.shortName, category: info.category });
            }
        }

        return items;
    }

    private getItemsForStar(): PieMenuItem[] {
        const { controller } = this.deps;
        const validActions = controller?.getValidActions() ?? [];
        const starActions = validActions.filter(a => a.cloudId === STAR_CLOUD_ID);

        const items: PieMenuItem[] = [];
        for (const validAction of starActions) {
            const action = THERAPIST_ACTIONS.find(a => a.id === validAction.action);
            if (action) {
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

    private getProxyAsTarget(cloudId: string): string | null {
        const { model, relationships } = this.deps;
        const targetIds = model.getTargetCloudIds();
        if (!targetIds.has(cloudId)) return null;
        const proxies = relationships.getProxies(cloudId);
        for (const proxyId of proxies) {
            if (targetIds.has(proxyId)) return proxyId;
        }
        return null;
    }
}
