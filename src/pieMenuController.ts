import { Cloud } from './cloudShape.js';
import { CloudRelationshipManager } from './cloudRelationshipManager.js';
import { SimulatorModel } from './ifsModel.js';
import { SimulatorView } from './ifsView.js';
import { PieMenu, PieMenuItem } from './pieMenu.js';
import { TherapistAction, THERAPIST_ACTIONS } from './therapistActions.js';

export interface PieMenuDependencies {
    getCloudById: (id: string) => Cloud | null;
    model: SimulatorModel;
    view: SimulatorView;
    relationships: CloudRelationshipManager;
}

export class PieMenuController {
    private pieMenu: PieMenu | null = null;
    private pieMenuOpen = false;
    private selectedCloudId: string | null = null;
    private onActionSelect: ((action: TherapistAction, cloud: Cloud) => void) | null = null;

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
            const action = THERAPIST_ACTIONS.find(a => a.id === item.id);
            if (action) {
                const cloud = this.deps.getCloudById(cloudId);
                if (cloud && this.onActionSelect) {
                    this.onActionSelect(action, cloud);
                }
            }
        });

        this.pieMenu.setOnClose(() => {
            this.pieMenuOpen = false;
            this.selectedCloudId = null;
        });
    }

    setOnActionSelect(handler: (action: TherapistAction, cloud: Cloud) => void): void {
        this.onActionSelect = handler;
    }

    isOpen(): boolean {
        return this.pieMenuOpen;
    }

    getSelectedCloudId(): string | null {
        return this.selectedCloudId;
    }

    toggle(cloudId: string, x: number, y: number): void {
        if (!this.pieMenu) return;

        if (this.pieMenuOpen && this.selectedCloudId === cloudId) {
            this.pieMenu.hide();
            return;
        }

        if (this.pieMenuOpen) {
            this.pieMenu.hide();
        }

        const items = this.getItemsForCloud(cloudId);
        if (items.length === 0) {
            return;
        }

        this.pieMenu.setItems(items);
        this.pieMenu.show(x, y, cloudId);
        this.pieMenuOpen = true;
        this.selectedCloudId = cloudId;
    }

    hide(): void {
        if (this.pieMenu && this.pieMenuOpen) {
            this.pieMenu.hide();
        }
    }

    private getItemsForCloud(cloudId: string): PieMenuItem[] {
        const { model, relationships } = this.deps;

        const isTarget = model.isTarget(cloudId);
        const isBlended = model.isBlended(cloudId);
        const isSupporting = model.getAllSupportingParts().has(cloudId);
        const proxyAsTargetId = this.getProxyAsTarget(cloudId);
        const proxyRevealed = proxyAsTargetId && model.isIdentityRevealed(proxyAsTargetId);
        const targetIds = model.getTargetCloudIds();
        const proxies = relationships.getProxies(cloudId);
        const hasRevealedProxy = Array.from(proxies).some(id => model.isIdentityRevealed(id));
        const noBlendedParts = model.getBlendedParts().length === 0;
        const isSoleTargetWithRevealedProxy = isTarget && targetIds.size === 1 && hasRevealedProxy && noBlendedParts;
        const blendReason = model.getBlendReason(cloudId);
        const isSpontaneousBlend = isBlended && blendReason === 'spontaneous';

        const items: PieMenuItem[] = [];

        for (const action of THERAPIST_ACTIONS) {
            let include = false;

            if (action.id === 'join_conference') {
                include = isSupporting && !isBlended;
            } else if (action.id === 'separate') {
                include = isBlended;
            } else if (action.id === 'step_back') {
                const hasOtherTargets = targetIds.size > 0;
                include = (isTarget || isSupporting || (isBlended && hasOtherTargets)) && !isSpontaneousBlend;
            } else if (action.id === 'job') {
                include = isTarget || isBlended;
            } else if (action.id === 'who_do_you_see') {
                include = isTarget && proxies.size > 0;
            } else if (action.id === 'expand_calm') {
                include = isSoleTargetWithRevealedProxy;
            } else if (action.id === 'feel_toward') {
                const selfRay = model.getSelfRay();
                include = isTarget && selfRay?.targetCloudId !== cloudId;
            } else if (action.id === 'blend') {
                include = isTarget && !isBlended;
            } else {
                include = isTarget;
            }

            if (include) {
                let label = action.question;

                if (action.id === 'feel_toward' && proxyRevealed) {
                    label = "How do you feel toward this part that doesn't know you very well?";
                } else if (action.id === 'who_do_you_see' && model.getSelfRay()?.targetCloudId === cloudId && proxyRevealed) {
                    const proxyCloud = this.deps.getCloudById(proxyAsTargetId!);
                    const proxyName = proxyCloud?.text ?? 'the proxy';
                    label = `Who do you see when you look at the client?\nWould you be willing to notice the compassion instead of seeing ${proxyName}?`;
                } else if (action.id === 'separate') {
                    label = "Can you make a little space for client?";
                }

                items.push({
                    id: action.id,
                    label,
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
