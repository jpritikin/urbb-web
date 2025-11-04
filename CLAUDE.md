# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Hugo static website project with TypeScript, deployed to Cloudflare Pages.

Style: glitzy New Age influencer, but decorated with faux janky styling/coding errors; Use Santo Daime theme color scheme

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

Dev branch https://dev.urbb-web.pages.dev/
