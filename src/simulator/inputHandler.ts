import { Cloud } from '../cloud/cloudShape.js';
import { SimulatorModel } from './ifsModel.js';
import { SimulatorView } from './ifsView.js';
import { PieMenuController } from '../menu/pieMenuController.js';

export interface InputHandlerDependencies {
    getModel: () => SimulatorModel;
    view: SimulatorView;
    pieMenuController: PieMenuController;
    getCloudById: (id: string) => Cloud | null;
    updateAllCloudStyles: () => void;
}

export interface InputHandlerCallbacks {
    onCloudSelected: (cloud: Cloud, touchEvent?: TouchEvent) => void;
    onPendingActionComplete: (targetCloudId: string) => void;
}

export class InputHandler {
    private deps: InputHandlerDependencies;
    private callbacks: InputHandlerCallbacks;

    private hoveredCloudId: string | null = null;
    private touchOpenedPieMenu: boolean = false;
    private longPressTimer: number | null = null;
    private longPressStartTime: number = 0;
    private readonly LONG_PRESS_DURATION = 500;

    constructor(deps: InputHandlerDependencies, callbacks: InputHandlerCallbacks) {
        this.deps = deps;
        this.callbacks = callbacks;
    }

    setHoveredCloud(cloudId: string | null): void {
        this.hoveredCloudId = cloudId;
    }

    getHoveredCloudId(): string | null {
        return this.hoveredCloudId;
    }

    startLongPress(cloudId: string): void {
        if (this.deps.getModel().getMode() !== 'foreground') return;
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

    handleCloudClick(cloud: Cloud): void {
        if (this.touchOpenedPieMenu) {
            this.touchOpenedPieMenu = false;
            return;
        }
        this.hoveredCloudId = null;
        this.selectCloud(cloud);
    }

    handleCloudTouchStart(cloud: Cloud, e: TouchEvent): void {
        this.hoveredCloudId = null;
        this.deps.updateAllCloudStyles();

        if (this.deps.getModel().getMode() !== 'foreground') return;
        if (this.deps.getModel().getPendingAction()) return;

        const cloudState = this.deps.view.getCloudState(cloud.id);
        if (cloudState && cloudState.opacity > 0) {
            this.touchOpenedPieMenu = true;
            this.deps.pieMenuController.toggle(cloud.id, cloudState.x, cloudState.y, e);
        }
    }

    handleCloudTouchEnd(cloud: Cloud): void {
        if (!this.deps.getModel().getPendingAction()) return;
        if (this.deps.getModel().getMode() !== 'foreground') return;

        const cloudState = this.deps.view.getCloudState(cloud.id);
        if (cloudState && cloudState.opacity > 0) {
            this.callbacks.onPendingActionComplete(cloud.id);
        }
    }

    selectCloud(cloud: Cloud, touchEvent?: TouchEvent): void {
        if (this.deps.getModel().getPendingAction()) {
            this.callbacks.onPendingActionComplete(cloud.id);
            return;
        }
        if (this.deps.getModel().getMode() === 'panorama') {
            this.callbacks.onCloudSelected(cloud, touchEvent);
        } else if (this.deps.getModel().getMode() === 'foreground') {
            const cloudState = this.deps.view.getCloudState(cloud.id);
            if (cloudState && cloudState.opacity > 0) {
                this.deps.pieMenuController.toggle(cloud.id, cloudState.x, cloudState.y, touchEvent);
            }
        }
    }

    createCloudEventHandlers(cloud: Cloud): {
        onClick: () => void;
        onHover: (hovered: boolean) => void;
        onLongPressStart: () => void;
        onLongPressEnd: () => void;
        onTouchStart: (e: TouchEvent) => void;
        onTouchEnd: () => void;
    } {
        return {
            onClick: () => this.handleCloudClick(cloud),
            onHover: (hovered: boolean) => {
                this.setHoveredCloud(hovered ? cloud.id : null);
                const state = this.deps.getModel().getPartState(cloud.id);
                cloud.updateSVGElements(false, state, hovered);
            },
            onLongPressStart: () => this.startLongPress(cloud.id),
            onLongPressEnd: () => this.cancelLongPress(),
            onTouchStart: (e: TouchEvent) => this.handleCloudTouchStart(cloud, e),
            onTouchEnd: () => this.handleCloudTouchEnd(cloud),
        };
    }
}
