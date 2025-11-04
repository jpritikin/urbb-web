class ButtonVisibilityManager {
  private buttons: NodeListOf<HTMLElement>;
  private timeoutId: number | null = null;
  private isVisible = false;
  private sliderManipulated = false;

  constructor() {
    this.buttons = document.querySelectorAll('[data-enter-button]');
    this.startTimer();
  }

  private startTimer(): void {
    // Show buttons after 1 minute (60000ms)
    this.timeoutId = window.setTimeout(() => {
      this.showButtons();
    }, 60000);
  }

  public onSliderManipulated(): void {
    if (this.sliderManipulated) return;

    this.sliderManipulated = true;
    this.showButtons();
  }

  private showButtons(): void {
    if (this.isVisible) return;

    this.isVisible = true;
    this.buttons.forEach(button => {
      button.classList.add('visible');
    });

    // Clear the timeout if it hasn't fired yet
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}

export default ButtonVisibilityManager;
