#!/usr/bin/env node
// Copies compiled JS from .tsbuild/js (tsc's outDir) into static/js, debounced
// so a burst of tsc writes collapses into a single sync instead of triggering
// a Hugo rebuild per file.
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", ".tsbuild", "js");
const DEST = path.join(__dirname, "..", "static", "js");
const DEBOUNCE_MS = 300;

let timer = null;
const dirty = new Set();

function copyFile(relPath) {
  const src = path.join(SRC, relPath);
  const dest = path.join(DEST, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function removeFile(relPath) {
  const dest = path.join(DEST, relPath);
  if (fs.existsSync(dest) && fs.statSync(dest).isFile()) {
    fs.rmSync(dest, { force: true });
  }
}

function flush() {
  for (const relPath of dirty) {
    const srcPath = path.join(SRC, relPath);
    if (fs.existsSync(srcPath)) {
      if (fs.statSync(srcPath).isFile()) copyFile(relPath);
    } else {
      removeFile(relPath);
    }
  }
  console.log(`[syncTsOutput] synced ${dirty.size} file(s) to static/js`);
  dirty.clear();
}

function schedule(relPath) {
  dirty.add(relPath);
  clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
}

function walk(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, cb);
    else cb(full);
  }
}

fs.mkdirSync(SRC, { recursive: true });
fs.mkdirSync(DEST, { recursive: true });

// Initial full sync so the first `hugo server` start has everything.
walk(SRC, (file) => schedule(path.relative(SRC, file)));
clearTimeout(timer);
flush();

fs.watch(SRC, { recursive: true }, (_event, filename) => {
  if (!filename) return;
  schedule(filename);
});

console.log(`[syncTsOutput] watching ${SRC} -> ${DEST}`);
