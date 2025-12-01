# Mobile Testing Guide

Follow these steps exactly on a mobile device. Report any step where the expected result doesn't happen.

## Landing page - Image Slider

**L7K** Load the homepage
   - Page shows two overlapping images (ordinary and cathedral) with a slider between them

**M3R** Click anywhere on the image (not on the slider line)
   - Slider jumps to where you clicked, revealing more of one image

**P9A** Drag the slider
   - As you drag, one image reveals more while the other reveals less

**Q2F** Hold and drag the slider continuously for 10 seconds
   - Slider continues to respond smoothly
   - Note: Occasionally (20% chance) the slider may toggle from horizontal to vertical mode after 5 seconds of dragging

**T8N** Reload the page and observe the slider orientation
   - Usually starts horizontal, but occasionally (10% chance) starts in vertical mode
   - Sometimes the base image clips, sometimes the overlay clips (varies randomly)

**W4D** Click the dark mode toggle (sun/moon icon)
   - Are all the interface elements still legible? Toggle back

## Landing page - Audio

**K6M** Drag the slider to reveal 90% or more of the cathedral image
   - The speaker button starts blinking

**R1H** Tap the speaker button
   - Button disappears immediately and music starts playing

**V5Q** Drag the slider below 90% cathedral visibility
   - Audio fades out and pauses

## Gallery Page

**H9T** Click "Gallery" in the navigation menu
   - Page loads showing a grid of book page images in webp format
   - Images appear in random order (changes on each page load)

**D3W** Scroll through all images
   - One image (randomly selected) is under "Legal Hold" with ⚖️ icon
   - Another image (randomly selected) has a broken link with 🔗💥 icon

**N7B** Tap on a normal gallery image (not Legal Hold or broken)
   - Image opens in a full-screen popup/modal
   - Zoomed image fills most of the screen
   - Close button (×) appears in the corner
   - **Glitchy behavior**: 20% chance the zoomed image is rotated 90° or 270°

**J2Y** Close the zoomed image
   - Tap the × button to close, or
   - Tap outside the image (on the dark background) to close
   - Returns to gallery view

**F8L** Tap on the "Legal Hold" image
   - Opens a detailed legal notice popup (satirical)
   - Popup shows case number, filing date, and absurd legal claims
   - Close button (×) appears in the popup
   - Can close by tapping × or tapping outside popup

**C4P** Tap on the "broken link" image
   - Nothing happens (image is non-interactive)

## Online Supplement Page

**Z1X** Click "Online Supplement" in the navigation menu
   - Page loads with hymn player and bibliography sections

### Animatronic Salmon & Cassette Player

**E6K** Observe the animated salmon in the cassette deck
   - Salmon drifts slowly around the canvas
   - Tail moves occasionally (every few seconds) to different positions
   - Mouth is closed when not playing

**G8V** Click on an unlocked hymn (e.g., "Examine A Consciência")
   - Cassette flies from hymn item to salmon's mouth
   - Salmon's mouth opens wide during cassette insertion
   - After cassette arrives, mouth closes
   - Hymn title appears in "Current hymn display"
   - Play button becomes enabled

**B5M** Click the play button (▶)
   - Music starts playing
   - Salmon's mouth animates (opens to various degrees randomly)
   - Tail continues moving to different positions
   - Play button changes to pause (⏸)

**Y3N** Click a different unlocked hymn while one is playing
   - Cassette ejects from salmon's mouth back to previous hymn item
   - New cassette flies from clicked hymn to salmon
   - Mouth opens/closes for ejection and insertion
   - New hymn starts playing

**U9R** Click the loop button (🔁)
   - Button becomes inactive/dimmed (loop disabled)
   - Click again to re-enable (button lights up with blue glow)

**S2J** Click on a locked hymn (with 🔒 icon)
   - Hymn shakes/vibrates briefly
   - Nothing else happens (stays locked)

**X7W** **Secret unlock sequence**: Click hymns in numerical order 26, 84, 108, 115
   - All locked hymns unlock (🔒 icons disappear)
   - Unlocked state persists on page reload (saved to localStorage)
   - Alternative sequence: 26, 108, 115, 152

### Bibliography Battle System

**A4F** Scroll down to the Bibliography section
   - Some entries have visual errors/glitches:
     * ~15% have error markers like "[citation needed]", "[404 not found]", "[REDACTED]", etc.
     * ~15% are faded (very low opacity)
     * ~15% have words partially redacted (replaced with █ characters)

**L8C** Click on a glitched/faded/redacted entry
   - Entry "fixes" itself (errors remove, opacity returns, redaction clears)
   - Numbered badge (1 or 2) appears on entry
   - Entry is now "selected"

**T6Z** Click on a second different entry
   - Second entry gets a different colored badge
   - Both entries are now selected

**M1Q** With two entries selected, scroll away from hymn player
   - "⚔️ Battle" button appears in center of screen
   - Note: On desktop, button may dodge the mouse, but this won't happen on mobile

**K9D** Click the Battle button
   - Full-screen battle arena appears with Santo Daime colors
   - Two HP bars show fighter names (distinctive words from titles)
   - Battle log shows turn-by-turn combat
   - Entries flash red when damaged
   - HP bars change color (green → yellow → red as damage increases)

**P3H** Watch the battle complete
   - One fighter wins when other reaches 0 HP
   - Winner announced in battle log
   - Dismiss button appears with random phrase (e.g., "Thank you for resolving this contest")

**R7E** **Mutual Regard** (2.2% chance per turn): Start a new battle and repeat if needed
   - Occasionally battle stops mid-fight
   - Screen shakes violently
   - Static/glitch overlay appears
   - Fighters declare mutual regard instead of fighting
   - "💕 MUTUAL REGARD ACHIEVED 💕" message
   - Draggable heart appears with both fighter names
   - Heart can be dragged around the screen
   - Dismiss button with loving phrase appears

**W2A** Try to battle the same pair again after mutual regard
   - Angry chastisement modal appears
   - Modal shakes and glows
   - Refuses to let them fight
   - Existing heart zooms to center and pulses if visible
   - Must click "I am deeply ashamed" to dismiss

**N5G** Try to battle two entries with the same surname
   - Solemn apology modal appears
   - Modal pulses with golden glow
   - Explains cosmic impossibility of same-surname battles
   - Must click "I understand and forgive you" to dismiss

**H4U** Click dark mode toggle
   - All supplement page elements remain legible and functional

## Gratitude

You're done testing! Thank you for your time.

## Developer Notes

* Hover and mouse proximity can't be tested on mobile.

* The codes before each item (e.g., **L7K**) are content hashes to help track which steps have changed between versions.

* Each markdown page has a version number to help know when testing procedures need updating. This testing guide was built assuming the following versions:

- Homepage: v1.0.0
- Gallery: v1.0.0
- Online Supplement: v1.0.0
