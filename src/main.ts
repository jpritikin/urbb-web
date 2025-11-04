import ImageSlider from './imageSlider.js';
import ButtonVisibilityManager from './buttonVisibility.js';

document.addEventListener('DOMContentLoaded', () => {
  // Initialize image slider on homepage
  const imageComparison = document.querySelector('.image-comparison');
  if (imageComparison) {
    const buttonManager = new ButtonVisibilityManager();
    new ImageSlider('.image-comparison', () => buttonManager.onSliderManipulated());
  }

  // Mobile navigation toggle
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.querySelector('.nav-menu');

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
      navMenu.classList.toggle('active');
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.nav-container')) {
        navMenu.classList.remove('active');
      }
    });

    // Close menu when clicking a link
    navMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('active');
      });
    });
  }
});
