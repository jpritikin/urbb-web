export interface PieMenuItem {
    id: string;
    label: string;
    shortName: string;
    icon?: string;
    category?: string;
}

export interface PieMenuConfig {
    items: PieMenuItem[];
    radius: number;
    innerRadius: number;
}

export class PieMenu {
    private group: SVGGElement | null = null;
    private visible: boolean = false;
    private targetCloudId: string | null = null;
    private items: PieMenuItem[] = [];
    private radius: number = 75;
    private innerRadius: number = 20;
    private onSelect: ((item: PieMenuItem, cloudId: string) => void) | null = null;
    private onClose: (() => void) | null = null;
    private tooltipElement: SVGGElement | null = null;
    private hoverIndex: number = -1;
    private overlayContainer: SVGGElement | null = null;

    constructor(private container: SVGGElement) {}

    setOverlayContainer(overlay: SVGGElement): void {
        this.overlayContainer = overlay;
    }

    setItems(items: PieMenuItem[]): void {
        this.items = items;
    }

    setConfig(config: Partial<PieMenuConfig>): void {
        if (config.items) this.items = config.items;
        if (config.radius) this.radius = config.radius;
        if (config.innerRadius) this.innerRadius = config.innerRadius;
    }

    setOnSelect(callback: (item: PieMenuItem, cloudId: string) => void): void {
        this.onSelect = callback;
    }

    setOnClose(callback: () => void): void {
        this.onClose = callback;
    }

    isVisible(): boolean {
        return this.visible;
    }

    getTargetCloudId(): string | null {
        return this.targetCloudId;
    }

    show(x: number, y: number, cloudId: string): void {
        if (this.visible) {
            this.hide();
        }

        this.targetCloudId = cloudId;
        this.visible = true;
        this.hoverIndex = -1;
        this.createMenuElements(x, y);
    }

    hide(): void {
        if (this.group && this.group.parentNode) {
            this.group.parentNode.removeChild(this.group);
        }
        this.group = null;
        this.visible = false;
        this.targetCloudId = null;
        this.onClose?.();
    }

    private createMenuElements(centerX: number, centerY: number): void {
        this.group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.group.setAttribute('class', 'pie-menu');
        this.group.setAttribute('transform', `translate(${centerX}, ${centerY})`);

        const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        backdrop.setAttribute('cx', '0');
        backdrop.setAttribute('cy', '0');
        backdrop.setAttribute('r', String(this.radius + 30));
        backdrop.setAttribute('fill', 'rgba(0, 0, 0, 0.15)');
        backdrop.setAttribute('class', 'pie-menu-backdrop');
        backdrop.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hide();
        });
        this.group.appendChild(backdrop);

        const itemCount = this.items.length;
        const angleStep = (2 * Math.PI) / itemCount;
        const startAngle = -Math.PI / 2;

        for (let i = 0; i < itemCount; i++) {
            const item = this.items[i];
            const angle = startAngle + i * angleStep;
            const labelGroup = this.createLabelItem(item, angle);
            this.group.appendChild(labelGroup);
        }

        const centerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        centerCircle.setAttribute('cx', '0');
        centerCircle.setAttribute('cy', '0');
        centerCircle.setAttribute('r', String(this.innerRadius));
        centerCircle.setAttribute('fill', 'rgba(255, 255, 255, 0.95)');
        centerCircle.setAttribute('stroke', '#7b68ee');
        centerCircle.setAttribute('stroke-width', '2');
        centerCircle.setAttribute('class', 'pie-menu-center');
        centerCircle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hide();
        });
        this.group.appendChild(centerCircle);

        const closeX = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        closeX.setAttribute('x', '0');
        closeX.setAttribute('y', '4');
        closeX.setAttribute('text-anchor', 'middle');
        closeX.setAttribute('font-size', '14');
        closeX.setAttribute('fill', '#7b68ee');
        closeX.setAttribute('font-weight', 'bold');
        closeX.setAttribute('pointer-events', 'none');
        closeX.textContent = '✕';
        this.group.appendChild(closeX);

        (this.overlayContainer ?? this.container).appendChild(this.group);
    }

    private createLabelItem(item: PieMenuItem, angle: number): SVGGElement {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'pie-menu-item');
        group.setAttribute('cursor', 'pointer');

        const x = this.radius * Math.cos(angle);
        const y = this.radius * Math.sin(angle);

        const rectWidth = 70;
        const rectHeight = 24;

        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('x', String(x - rectWidth / 2));
        bgRect.setAttribute('y', String(y - rectHeight / 2));
        bgRect.setAttribute('width', String(rectWidth));
        bgRect.setAttribute('height', String(rectHeight));

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(x));
        text.setAttribute('y', String(y + 4));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', '12');
        text.setAttribute('font-weight', '500');
        text.setAttribute('fill', '#333');
        text.setAttribute('class', 'pie-menu-label');
        text.textContent = item.shortName;
        bgRect.setAttribute('rx', '4');
        bgRect.setAttribute('fill', '#fff');
        bgRect.setAttribute('stroke', this.getCategoryColor(item.category, 0.6));
        bgRect.setAttribute('stroke-width', '1.5');
        bgRect.setAttribute('class', 'pie-menu-item-bg');
        group.appendChild(bgRect);

        group.appendChild(text);

        group.addEventListener('mouseenter', () => {
            bgRect.setAttribute('fill', this.getCategoryColor(item.category, 0.15));
            bgRect.setAttribute('stroke', this.getCategoryColor(item.category, 1));
            bgRect.setAttribute('stroke-width', '2');
            this.showTooltip(item.label);
        });

        group.addEventListener('mouseleave', () => {
            bgRect.setAttribute('fill', '#fff');
            bgRect.setAttribute('stroke', this.getCategoryColor(item.category, 0.6));
            bgRect.setAttribute('stroke-width', '1.5');
            this.hideTooltip();
        });

        group.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.onSelect && this.targetCloudId) {
                this.onSelect(item, this.targetCloudId);
            }
            this.hide();
        });

        return group;
    }

    private getCategoryColor(category: string | undefined, opacity: number): string {
        const colors: Record<string, string> = {
            discovery: `rgba(52, 152, 219, ${opacity})`,
            history: `rgba(230, 126, 34, ${opacity})`,
            relationship: `rgba(231, 76, 60, ${opacity})`,
            role: `rgba(46, 204, 113, ${opacity})`
        };
        return colors[category ?? ''] ?? `rgba(155, 89, 182, ${opacity})`;
    }

    private showTooltip(text: string): void {
        this.hideTooltip();

        if (!this.group) return;

        this.tooltipElement = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.tooltipElement.setAttribute('class', 'pie-menu-tooltip');

        const padding = 10;
        const fontSize = 13;
        const lineHeight = fontSize + 4;
        const tooltipY = this.radius + 15;

        const lines = text.split('\n');

        const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('x', '0');
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('font-size', String(fontSize));
        textEl.setAttribute('fill', '#fff');
        textEl.setAttribute('pointer-events', 'none');

        for (let i = 0; i < lines.length; i++) {
            const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspan.setAttribute('x', '0');
            tspan.setAttribute('y', String(tooltipY + padding + fontSize - 2 + i * lineHeight));
            tspan.textContent = lines[i];
            textEl.appendChild(tspan);
        }

        this.tooltipElement.appendChild(textEl);
        this.group.appendChild(this.tooltipElement);

        const bbox = textEl.getBBox();
        const rectWidth = bbox.width + padding * 2;
        const rectHeight = bbox.height + padding * 2;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(-rectWidth / 2));
        rect.setAttribute('y', String(tooltipY));
        rect.setAttribute('width', String(rectWidth));
        rect.setAttribute('height', String(rectHeight));
        rect.setAttribute('rx', '4');
        rect.setAttribute('fill', 'rgba(0, 0, 0, 0.85)');
        rect.setAttribute('class', 'pie-menu-tooltip-bg');

        this.tooltipElement.insertBefore(rect, textEl);
    }

    private hideTooltip(): void {
        if (this.tooltipElement && this.tooltipElement.parentNode) {
            this.tooltipElement.parentNode.removeChild(this.tooltipElement);
        }
        this.tooltipElement = null;
    }
}
