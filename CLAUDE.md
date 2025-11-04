# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Hugo static website project with TypeScript, deployed to Cloudflare Pages.

Style: glitzy New Age influencer, but decorated with faux janky styling/coding errors

Site must work perfectly on various screen sizes (desktop and mobile). Site must
be able to switch between light and dark mode.

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
