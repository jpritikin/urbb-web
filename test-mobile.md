# Mobile Testing Guide

Follow these steps exactly on a mobile device. Report any step where the expected result doesn't happen.

## Landing page - Image Slider

**L7K** Load the homepage
   - A dark purple curtain with animated spinning glyph (✦) covers the image while it loads
   - After at least 2 seconds and both images have loaded, the curtain splits apart and slides away
   - Page reveals two overlapping images (front covers: ordinary and cathedral) with a slider between them
   - Usually slider is horizontal, but occasionally (10% chance) starts in vertical mode
   - Which image is base vs overlay varies randomly (25% chance the base clips instead of overlay)
   - No "Enter Site" button is visible yet

**M3R** Click anywhere on the image (not on the slider line)
   - Slider jumps to where you clicked, revealing more of one image
   - "Enter Site" button appears below the slider

**P9A** Drag the slider
   - As you drag, one image reveals more while the other reveals less
   - "Enter Site" button appears below the slider (if not already visible)

**Q2F** Hold and drag the slider continuously for 10 seconds
   - Slider continues to respond smoothly
   - Note: Occasionally (20% chance) the slider may toggle from horizontal to vertical mode after 5 seconds of dragging

**T8N** Reload the page and wait 1 minute without touching the slider
   - "Enter Site" button appears automatically after 1 minute timeout

**W4D** Click the dark mode toggle (sun/moon icon)
   - All interface elements remain legible; toggle back

## Landing page - Audio & Flip

**K6M** Drag the slider to reveal 90% or more of the cathedral image
   - Dotted outline around image changes to gold and pulses
   - Speaker button (top-left corner) starts blinking

**R1H** Tap the speaker button
   - Button disappears immediately and music starts playing
   - Gold pulsing outline continues

**V5Q** Drag the slider below 90% cathedral visibility
   - Audio fades out and pauses
   - Outline stops pulsing and returns to gray

**B8W** With audio playing (90%+ cathedral), wait 30 seconds
   - Flip button (↻ icon) appears above the image slider
   - Note: This requires 30 seconds of total audio play time, not continuous

**Y4P** Click the flip button
   - Book cover flips with crazy 3D animation (2-3 seconds)
   - Animation varies: random intensity, speed, color shifts, direction, and wobbliness
   - After animation, images switch from front covers to back covers (or vice versa)
   - Slider resets to center position
   - Audio volume resets to 50% (mid-slider position)

## Gallery Page

**H9T** Click "Gallery" in the navigation menu
   - Page loads showing a grid of obviously forged photographs of the author with famous people
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

**A2M** Scroll past the book page gallery to the "Yoga with Joshua" section
   - Section shows a logo and four yoga pose images with captions
   - Also shows a humorous self-deprecating essay below the photos

**E5R** Tap on a yoga photo
   - Image opens in a full-screen popup/modal
   - No rotation glitch (yoga photos always display upright)
   - Close button (×) appears in the corner; tap it or tap outside to close

## Online Supplement Page

**Z1X** Click "Online Supplement" in the navigation menu
   - Page loads with hymn player and bibliography sections

### Animatronic Salmon & Cassette Player

**E6K** Observe the animated salmon in the cassette deck
   - Salmon drifts slowly around the canvas
   - Tail moves occasionally (every few seconds) to different positions
   - Mouth is closed when not playing

**G8V** Click on an unlocked hymn (e.g., "Examine A Consciência") — unlocked hymns appear first in the list
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

**U9R** Observe the playback mode buttons (🔁 loop and ⏭️ play-next)
   - By default, play-next (⏭️) is active (lit up with blue glow) and loop (🔁) is inactive
   - When a hymn finishes in play-next mode, the next unlocked hymn starts automatically
   - Click 🔁 to switch to loop mode: loop button lights up, play-next dims; current hymn repeats
   - Click ⏭️ again to switch back to play-next mode

**S2J** Click on a locked hymn (with 🔒 icon)
   - Hymn shakes/vibrates briefly
   - Lock popup appears with mystical question (e.g., "Love or Gratitude?", "Heart or Spirit?")
   - Popup shows a heart receptacle (circular area with 💝 icon)
   - Popup auto-dismisses after 10 seconds if no heart is dragged to it

**X7W** **Secret unlock sequence**: Click hymns in numerical order 26, 84, 108, 115
   - All locked hymns unlock (🔒 icons disappear)
   - Unlocked state persists on page reload (saved to localStorage)
   - Alternative sequence: 26, 108, 115, 152

### Bibliography Filtering & Sort

**F2K** Scroll to the Bibliography section and tap a category label (e.g., **Psychology & Psychotherapy**)
   - Entries shuffle into random order
   - A retro terminal panel appears with boot-up messages (e.g., "INITIATING CROSS-REFERENCE ANALYSIS...")
   - A progress bar appears while the animated bubble sort runs
   - Only entries in that category are shown; others are hidden
   - An A–Z navigation sidebar appears on the right

**V6T** While the sort is running, tap a letter in the A–Z sidebar
   - Behavior is unreliable during sort (by design):
     - 25% chance: scrolls to the correct letter
     - 30% chance: scrolls to a wrong letter; button briefly shows a glitch emoji
     - 20% chance: scrolls to a random position; button briefly shows 🫠
     - 25% chance: does nothing; button briefly shows a glitch emoji

**B3N** After sorting completes, tap a letter in the A–Z sidebar
   - Scrolls reliably to the first entry starting with that letter
   - Letters with no visible entries are dimmed

**P7M** Tap the same category label again (while not sorting)
   - All entries reappear in shuffled order; sort UI hides; A–Z nav resets

**J5W** Tap a different category label while the bubble sort is actively running
   - A "nausea" modal appears (e.g., "SORT INTERRUPTED — The sorting algorithm is experiencing acute nausea...")
   - Tap OK to acknowledge; new filter then starts

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

**R7E** **Mutual Regard** (2.2% chance per turn, guaranteed within 5 battles): Start battles until it triggers
   - Occasionally battle stops mid-fight
   - Screen shakes violently
   - Static/glitch overlay appears
   - Fighters declare mutual regard instead of fighting
   - "💕 MUTUAL REGARD ACHIEVED 💕" message
   - Draggable heart (💕) appears with both fighter names
   - Heart can be dragged around the screen with touch or mouse
   - Heart persists even after dismissing the battle
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

**Q8X** **Unlock hymn with heart**: After achieving mutual regard, drag the heart to a locked hymn
   - Click a locked hymn to show the lock popup with heart receptacle
   - Drag a mutual regard heart (💕) toward the receptacle
   - When heart gets close enough, it snaps to the receptacle
   - Heart shrinks and fades into the receptacle
   - Receptacle glows gold and shows 💖
   - After brief animation, the hymn unlocks (🔒 icon disappears)
   - Hymn flashes gold and becomes clickable
   - Lock popup fades away

**C9L** Click on a bibliography entry that has an external URL link
   - A confirmation dialog appears: "Opening External Link, continue?"
   - "Yes" opens the link in a new tab; "Cancel" dismisses without navigating
   - Tapping outside the dialog also dismisses it

**D7V** **Long press to copy bibliography**: Press and hold on any bibliography entry
   - After 500ms of holding, "📋 Copied!" feedback appears
   - Full citation text is copied to clipboard
   - Feedback fades after 1.5 seconds
   - Works on glitched, faded, redacted, and fixed entries
   - Small finger movements (< 10 pixels) don't cancel the long press

**H4U** Click dark mode toggle
   - All supplement page elements remain legible and functional

## Gratitude

You're done testing! Thank you for your time.

## Developer Notes

* Hover and mouse proximity can't be tested on mobile. Don't talk about desktop scenarios.

* The codes before each item (e.g., **L7K**) are content hashes to help track which steps have changed between versions.

* Each markdown page has a version number to help know when testing procedures need updating. This testing guide was built assuming the following versions:

- Homepage: v1.7.3
- Gallery: v1.1.0
- Online Supplement: v1.4.9
