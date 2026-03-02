import ImageSlider from './pages/imageSlider.js';
import ButtonVisibilityManager from './pages/buttonVisibility.js';
import { initBookNav } from './pages/bookNav.js';
import { initCurtainStars } from './pages/curtainStars.js';
import { initCartDrawer, openCart, syncBadge } from './shop/cartDrawer.js';
import { getCart } from './shop/cart.js';

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('image-curtain')) {
        initCurtainStars();
    }

    const cartBtns = document.querySelectorAll('.cart-icon-btn');
    if (cartBtns.length > 0) {
        initCartDrawer();
        syncBadge(getCart());
        cartBtns.forEach(btn => btn.addEventListener('click', openCart));
    }

    const imageComparison = document.querySelector('.image-comparison');
    if (imageComparison) {
        const buttonManager = new ButtonVisibilityManager();
        const slider = new ImageSlider('.image-comparison', () => buttonManager.onSliderManipulated());
        (window as any).flipBookCover = () => slider.flipCover();
    }

    if (document.querySelector('.book-page')) {
        initBookNav();
    }

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

    const navToggle = document.getElementById('nav-toggle');
    const mobileMenu = document.getElementById('mobile-menu');

    if (navToggle && mobileMenu) {
        navToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            mobileMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!mobileMenu.classList.contains('hidden') &&
                !mobileMenu.contains(e.target as Node) &&
                e.target !== navToggle) {
                mobileMenu.classList.add('hidden');
            }
        });

        mobileMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                mobileMenu.classList.add('hidden');
            });
        });
    }
});
