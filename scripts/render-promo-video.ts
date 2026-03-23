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
import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const WIDTH  = 1920;
const HEIGHT = 1080;
const FPS    = 24;
const TOTAL_SECONDS = 15;
const FRAMES = TOTAL_SECONDS * FPS;        // 360

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

    console.log(`Navigating to ${BASE_URL}`);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Wait for the promo animation driver to signal readiness
    await page.waitForFunction(() => (window as any).promoReady === true, { timeout: 10_000 });
    console.log('Promo ready. Capturing frames…');

    // Drive time synthetically: inject a controlled clock so we get exact frames.
    // We override requestAnimationFrame to be driven by us, then step through.
    await page.evaluate(() => {
        const realRAF = window.requestAnimationFrame.bind(window);
        const callbacks: Map<number, FrameRequestCallback> = new Map();
        let handle = 0;
        let simTime = 0;

        (window as any).__rafCallbacks = callbacks;
        (window as any).__advanceFrame = (dt: number) => {
            simTime += dt;
            const cbs = Array.from(callbacks.values());
            callbacks.clear();
            for (const cb of cbs) cb(simTime);
        };

        window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
            const h = ++handle;
            callbacks.set(h, cb);
            return h;
        };
        window.cancelAnimationFrame = (h: number) => { callbacks.delete(h); };

        // Kick off the first rAF tick at t=0
        (window as any).__advanceFrame(0);
    });

    const dtMs = 1000 / FPS;

    for (let i = 0; i < FRAMES; i++) {
        // Advance simulation by one frame
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
