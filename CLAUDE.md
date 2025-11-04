# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Hugo static website project with TypeScript, deployed to Cloudflare Pages. The site will eventually include a web shop.

Domain: unburdened.biz

## Common Commands

### Development
- `npm run dev` - Start TypeScript compiler in watch mode + Hugo dev server
- `npm start` - Start Hugo dev server only (requires pre-built TypeScript)
- `hugo server -D` - Start server including draft content

### Building
- `npm run build` - Compile TypeScript and build Hugo site for production
- `npm run build:ts` - Compile TypeScript only
- `hugo --minify` - Build Hugo site with minified output

### Deployment
- Deploys automatically via Cloudflare Pages GitHub integration on push to main
- Manual deploy: push changes to GitHub, Cloudflare Pages builds automatically

### Content Management
- `hugo new posts/my-post.md` - Create a new post

## Architecture

### Directory Structure
- `src/` - TypeScript source files (compiled to static/js/)
- `layouts/` - HTML templates for rendering content
- `static/` - Static assets (images, CSS, compiled JS)
- `static/css/` - CSS stylesheets
- `static/js/` - Compiled JavaScript (git-ignored)
- `content/` - Markdown content files
- `public/` - Generated site output (git-ignored)
- `hugo.toml` - Site configuration

### TypeScript Setup
- Source files in `src/` compile to ES2020 modules in `static/js/`
- TypeScript configured for strict mode with DOM types
- Use `import/export` syntax for modules
- HTML templates load JS with `<script type="module">`

### Cloudflare Pages Deployment
- Automatic deployment via GitHub integration
- Build command: `npm run build` (compiles TS + builds Hugo)
- Build output directory: `public/`
- Deploys automatically on push to main branch
