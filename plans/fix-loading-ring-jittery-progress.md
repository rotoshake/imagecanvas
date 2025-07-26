# Fix Loading Ring Jittery Progress Animation

## Problem
The loading ring was jittering back and forth instead of progressively filling up, especially during fast loads where both image loading and thumbnail generation happened in quick succession.

## Root Cause
The same `loadingProgress` variable was being used for two different loading phases:
1. **Image loading**: Progress goes from 0 to 1.0
2. **Thumbnail generation**: Progress resets and goes from 0 to 1.0 again

This caused the progress to jump from 1.0 (image complete) back to lower values when thumbnail generation started, creating a jittery appearance.

## Solution
Separated the progress tracking for different loading phases:

### 1. Added Separate Progress Variable
```javascript
this.thumbnailProgress = 0; // Separate progress for thumbnail generation
```

### 2. Updated Thumbnail Generation Callback
Changed the thumbnail progress callback to update the new variable:
```javascript
window.thumbnailCache.generateThumbnailsProgressive(
    hash, 
    this.img, 
    (progress) => {
        this.thumbnailProgress = progress; // Was: this.loadingProgress = progress
        // Trigger redraw for progress updates
        if (this.graph?.canvas) {
            this.graph.canvas.dirty_canvas = true;
        }
    }
);
```

### 3. Updated Draw Logic to Use Appropriate Progress
Modified the draw method to select the correct progress value based on loading phase:
```javascript
// Determine which progress to show
let progressToShow = this.loadingProgress;

// If we have an image and we're just waiting for thumbnails, show faded image behind ring
if (this.img && this.loadingState === 'loaded') {
    // Use thumbnail progress for thumbnail generation phase
    progressToShow = this.thumbnailProgress;
    // ... draw faded image behind ring ...
}

this.drawProgressRing(ctx, progressToShow);
```

## Result
- **Smooth progress animation**: Loading ring now fills progressively without jumping back
- **Correct progress tracking**: Each loading phase has its own progress (0-100%)
- **No more jittering**: Progress only moves forward, never backwards
- **Clear visual feedback**: Users can see distinct progress for image loading vs thumbnail generation

## Loading Phases
1. **Image Loading Phase**: Shows `loadingProgress` (0 → 1.0)
2. **Cooldown Period**: 300ms with no ring (prevents flicker)
3. **Thumbnail Generation Phase**: Shows `thumbnailProgress` (0 → 1.0) with faded image behind