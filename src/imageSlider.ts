class ImageSlider {
  private container: HTMLElement;
  private overlay: HTMLElement;
  private slider: HTMLElement;
  private isDragging = false;

  constructor(containerId: string) {
    const container = document.querySelector(containerId);
    if (!container) throw new Error(`Container ${containerId} not found`);

    this.container = container as HTMLElement;
    this.overlay = this.container.querySelector('.image-overlay')!;
    this.slider = this.container.querySelector('.slider')!;

    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    this.slider.addEventListener('mousedown', () => this.startDragging());
    document.addEventListener('mouseup', () => this.stopDragging());
    document.addEventListener('mousemove', (e) => this.handleMove(e));

    this.slider.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.startDragging();
    });
    document.addEventListener('touchend', () => this.stopDragging());
    document.addEventListener('touchmove', (e) => this.handleMove(e), { passive: false });

    this.container.addEventListener('click', (e) => {
      if (e.target === this.slider || this.slider.contains(e.target as Node)) return;
      this.updatePosition(e.clientX);
    });
  }

  private startDragging(): void {
    this.isDragging = true;
    this.container.style.cursor = 'ew-resize';
  }

  private stopDragging(): void {
    this.isDragging = false;
    this.container.style.cursor = 'ew-resize';
  }

  private handleMove(e: MouseEvent | TouchEvent): void {
    if (!this.isDragging) return;
    e.preventDefault();

    const x = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
    this.updatePosition(x);
  }

  private updatePosition(clientX: number): void {
    const rect = this.container.getBoundingClientRect();
    let position = ((clientX - rect.left) / rect.width) * 100;
    position = Math.max(0, Math.min(100, position));

    this.overlay.style.width = `${position}%`;
    this.slider.style.left = `${position}%`;
  }
}

export default ImageSlider;
