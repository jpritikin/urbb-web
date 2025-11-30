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

The user typically has `npm run dev` running, which automatically watches and rebuilds TypeScript and CSS changes. **Do not run `npm run build` manually** unless the dev server is not running.

## Website Style Guidelines

Style: glitzy New Age influencer, but decorated with faux janky styling/coding errors; Use Santo Daime theme color scheme; Try to rely on markdown. Minimize literal HTML in markdown. Try to avoid pixel dimensions and prefer resolution independent measures. Site must work perfectly on various screen sizes (desktop and mobile). Site must be able to switch between light and dark mode.

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
