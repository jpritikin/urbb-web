# Mobile Testing Guide

Follow these steps exactly on a mobile device. Report any step where the expected result doesn't happen.

**Test these page versions:**
- Homepage: v1.0.0
- Gallery: v1.0.0
- Book: v1.0.0

## Homepage - Image Slider

1. **Load the homepage**
   - Expected: Page loads, shows two overlapping images (ordinary and cathedral) with a vertical slider line between them

2. **Click anywhere on the image (not on the slider line)**
   - Expected: Slider jumps to where you clicked, revealing more of one image

3. **Drag the slider left and right**
   - Expected: As you drag, one image reveals more while the other reveals less

4. **Hold and drag the slider continuously for 10 seconds**
   - Expected: Slider continues to respond smoothly
   - Note: Occasionally (20% chance) the slider may switch from horizontal to vertical mode after 5 seconds of dragging

5. **Reload the page and observe the slider orientation**
   - Expected: Usually starts horizontal, but occasionally (10% chance) starts in vertical mode

6. **Reload the page several times and observe which image clips**
   - Expected: Sometimes the base image clips, sometimes the overlay clips (varies randomly)

## Homepage - Audio (Mobile)

1. **Load the homepage on a mobile device**
   - Expected: A semi-transparent gray button with a muted speaker icon (speaker with X) appears in the top-left corner

2. **Drag the slider to reveal 90% or more of the cathedral image**
   - Expected: The speaker button starts blinking

3. **Tap the speaker button**
   - Expected: Button disappears immediately

4. **Drag the slider to 90% or more cathedral visibility again**
   - Expected: Cathedral organ audio starts playing and fades in as you move closer to 100%

5. **Drag the slider below 90% cathedral visibility**
   - Expected: Audio fades out and pauses

## Homepage - Dark Mode

1. **Click the dark mode toggle (sun/moon icon)**
   - Expected: Background turns dark, text turns light, images remain visible

2. **Click the toggle again**
   - Expected: Page returns to light mode

3. **Switch to dark mode and reload the page**
   - Expected: Page stays in dark mode after reload

## Gallery Page

1. **Click "Gallery" in the navigation menu**
   - Expected: Page loads showing a grid of book page images in webp format

2. **Scroll through all images**
   - Expected: All images load without errors and are clearly readable

## Book Info Page

1. **Click "Book" in the navigation menu**
   - Expected: Page loads with book cover image (webp) and author photo (webp)

2. **Verify emojis appear in the text at key points**
   - Expected: Emojis are visible and render correctly

3. **Click each purchase link (Amazon, Bookshop.org, etc.)**
   - Expected: Each link opens the correct bookstore page
