import ImageSlider from './imageSlider.js';
import ButtonVisibilityManager from './buttonVisibility.js';

document.addEventListener('DOMContentLoaded', () => {
  // Initialize image slider on homepage
  const imageComparison = document.querySelector('.image-comparison');
  if (imageComparison) {
    const buttonManager = new ButtonVisibilityManager();
    new ImageSlider('.image-comparison', () => buttonManager.onSliderManipulated());
  }

  // Dark/Light mode toggle
  const themeToggle = document.getElementById('theme-toggle');
  const htmlElement = document.documentElement;

  const getPreferredTheme = (): string => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      return savedTheme;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  const setTheme = (theme: string) => {
    if (theme === 'dark') {
      htmlElement.classList.add('dark');
    } else {
      htmlElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  };

  setTheme(getPreferredTheme());

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const currentTheme = htmlElement.classList.contains('dark') ? 'dark' : 'light';
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      setTheme(newTheme);
    });
  }

  // Mobile navigation toggle
  const navToggle = document.getElementById('nav-toggle');
  const mobileMenu = document.getElementById('mobile-menu');

  if (navToggle && mobileMenu) {
    navToggle.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
    });

    // Close menu when clicking a link
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
      });
    });
  }
});
