# CLAUDE.md

This is a Hugo static website project to promote my new book "Religion Unburdened by Belief" with TypeScript, deployed to Cloudflare Pages.

## Book Content & Style

"Religion Unburdened by Belief" is a practical consciousness user's guide combining IFS (Internal Family Systems) therapy and neurophenomenology. It aims to make esoteric practices accessible through clear instructions while maintaining academic grounding (read ./book-info.txt for details).

**Tone & Voice:**
- Playful irreverence mixed with genuine scholarship - swings between earnest explanation and theatrical self-mockery
- Self-aware about its New Age positioning ("glitzy New Age influencer" aesthetic but deliberately ironic)
- Uses fictional framing devices (daemon possession, absurdist conference scenes, manga battles between teenage editors) to deliver serious content
- Frequent meta-commentary and fourth-wall breaks
- Oscillates between practical instruction and satirical deconstruction of spiritual marketing

**Content Approach:**
- Provides actual empirical methods for consciousness exploration (cannabis dosing journals, IFS protocols, meditation techniques)
- Deliberately mixes legitimate research citations with completely fabricated ethnography (Sacred Kitchen rituals)
- Uses elaborate literary scaffolding (daemon characters, film crew asides, academic debates) to maintain engagement while covering dense theoretical material
- Takes spirituality seriously while relentlessly mocking spiritual pretension
- Commitment to verification and testing ("firsthand cannabis experimentation journal") alongside theatrical absurdity

This dual nature - simultaneously useful and self-parodying - should inform the website's glitchy, playful aesthetic that works perfectly while feeling slightly "possessed."

## Development Workflow

Ask whether the user wants you to run `npm run dev` in the background and monitor its output for errors.

## Code Organization

Segregate page-specific details from site-wide styles and layouts. Information should have the smallest possible scope:
- Page-specific CSS goes in separate files (e.g., `gallery.css`, `book.css`)
- Section-specific layouts go in `layouts/{section}/` directories
- Site-wide styles remain in global CSS files

## Page Versioning Scheme

Each page has a version number to help track testing status and know when testing procedures need updating.

**How it works:**
1. Add `version: "v1.0.0"` to the frontmatter of markdown content files (e.g., `content/gallery/_index.md`)
2. For pages without markdown (like homepage), add `<meta name="page-version" content="v1.0.0">` directly in the layout
3. Hugo's `baseof.html` automatically injects the version from frontmatter: `{{ with .Params.version }}<meta name="page-version" content="{{ . }}">{{ end }}`
4. TypeScript code reads the version: `document.querySelector('meta[name="page-version"]')?.getAttribute('content')`
5. Log the version to console so testers can verify which version they're testing

**When to increment versions:**
- Major changes to page functionality or layout: bump major version (v1.0.0 → v2.0.0)
- Minor feature additions or behavior changes: bump minor version (v1.0.0 → v1.1.0)
- Bug fixes or small tweaks: bump patch version (v1.0.0 → v1.0.1)

Update the corresponding test file (e.g., `test-mobile.md`) when the page version changes significantly.

## Website Style Guidelines

Style: glitzy New Age influencer, but decorated with faux janky styling/coding errors; Use Santo Daime theme color scheme; Try to rely on markdown. Minimize literal HTML in markdown. Try to avoid pixel dimensions and prefer resolution independent measures. Site must work perfectly on various screen sizes (desktop and mobile). Site must be able to switch between light and dark mode. Use emojis to emphasize key points in the text.

I should use webp image format instead of png or jpeg. Remind me if I add the wrong format.

## Glitchy and Playful Design Approach

- Probabilistic behavior: UI elements have random chances (10-25%) to behave differently on each page load or interaction, making the experience unique each time
- Delayed reveals: Interactive elements start hidden and only appear after time delays or user interaction, creating mystery and encouraging exploration
- Mode switching: Interactive controls can spontaneously change orientation or behavior during use, especially after prolonged interaction (e.g., 5+ second holds)
- Easter eggs through interaction: Hidden rewards (audio, animations, visual changes) unlock when users reach specific interaction thresholds
- Intentionally rough aesthetics: Use dotted outlines, unconventional layouts, and "unfinished" styling to create the faux-janky look

This approach creates a playful sense that the interface is slightly
"glitchy" or "possessed" while remaining fully functional. The goal is
to make users feel like they've discovered something special or
strange, reinforcing the New Age mystical theme with technical
unpredictability.
