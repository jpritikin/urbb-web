#!/usr/bin/env npx tsx
/**
 * Renders the /promo/ page to a 1920x1080 @ 24fps video.
 *
 * Usage:
 *   npx tsx scripts/render-promo-video.ts [output.mp4]
 *
 * Requirements:
 *   npm install --save-dev playwright
 *   npx playwright install chromium
 *   ffmpeg must be in PATH
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 24;
const TOTAL_SECONDS = 60 * 5;
const FRAMES = TOTAL_SECONDS * FPS;

const OUTPUT = process.argv[2] ?? 'promo.mp4';
const FRAMES_DIR = '/tmp/promo-frames';
const BASE_URL = process.env.PROMO_URL ?? 'http://localhost:1313/promo/';

// ── Helpers ──────────────────────────────────────────────────────────────────
function ensureFramesDir(): void {
    if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true });
    mkdirSync(FRAMES_DIR, { recursive: true });
}

function framePath(i: number): string {
    return join(FRAMES_DIR, `frame${String(i).padStart(5, '0')}.png`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
    ensureFramesDir();

    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });

    await page.addInitScript(`
        (function() {
        const callbacks = new Map();
        let handle = 0;
        let simTime = 0;

        window.__rafCallbacks = callbacks;
        window.__advanceFrame = function(dt) {
            simTime += dt;
            const cbs = Array.from(callbacks.values());
            callbacks.clear();
            for (const cb of cbs) cb(simTime);
        };

        window.requestAnimationFrame = function(cb) {
            const h = ++handle;
            callbacks.set(h, cb);
            return h;
        };
        window.cancelAnimationFrame = function(h) { callbacks.delete(h); };

        Object.defineProperty(document, 'hidden', { get: function() { return false; } });
        Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; } });
        })();
    `);

    await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith('http') && !url.startsWith(BASE_URL) && !url.startsWith('http://localhost')) {
            route.abort();
        } else {
            route.continue();
        }
    });

    console.log(`Navigating to ${BASE_URL}`);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(`document.fonts.ready`);

    await page.waitForFunction(() => (window as any).promoReady === true, { timeout: 10_000 });
    console.log('Promo ready. Capturing frames…');

    await page.evaluate(`window.__advanceFrame(0)`);

    const dtMs = 1000 / FPS;

    for (let i = 0; i < FRAMES; i++) {
        await page.evaluate((dt: number) => {
            (window as any).__advanceFrame(dt);
        }, dtMs);

        await page.screenshot({ path: framePath(i), type: 'png' });

        if (i % 24 === 0) process.stdout.write(`  frame ${i}/${FRAMES}\r`);
    }

    console.log(`\nAll ${FRAMES} frames captured. Running ffmpeg…`);
    await browser.close();

    const ffmpegCmd = [
        'ffmpeg', '-y',
        '-framerate', String(FPS),
        '-i', `${FRAMES_DIR}/frame%05d.png`,
        '-c:v', 'libx264',
        '-preset', 'slow',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        OUTPUT,
    ];
    console.log(ffmpegCmd.join(' '));

    await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpegCmd[0], ffmpegCmd.slice(1), { stdio: 'inherit' });
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
    });

    rmSync(FRAMES_DIR, { recursive: true });
    console.log(`Done: ${OUTPUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
