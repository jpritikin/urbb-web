const HOVER_OPACITY = 0.2;
const RESTORE_DURATION = 0.5;

export class HoverFade {
    private wasHovered = false;
    private restoreTimer = RESTORE_DURATION;

    update(hovered: boolean, deltaTime: number): void {
        if (hovered) {
            this.wasHovered = true;
            this.restoreTimer = 0;
        } else if (this.wasHovered) {
            this.restoreTimer = Math.min(this.restoreTimer + deltaTime, RESTORE_DURATION);
            if (this.restoreTimer >= RESTORE_DURATION) {
                this.wasHovered = false;
            }
        }
    }

    apply(baseOpacity: number): number {
        if (!this.wasHovered) return baseOpacity;
        const t = this.restoreTimer / RESTORE_DURATION;
        return HOVER_OPACITY + (baseOpacity - HOVER_OPACITY) * t;
    }
}
