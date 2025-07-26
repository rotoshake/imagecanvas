# Loading Ring Stuck Fix - Version 2

## Problem
Nodes would show loading rings until mouse movement triggered a redraw, even though images had finished loading.

## Root Cause Analysis
Through automated testing with Puppeteer, I discovered:

1. **Progress Stuck at 0.9** - Many nodes had `loadingProgress = 0.9` even though `loadingState = loaded`
2. **Decode Promise Issues** - The `img.decode()` promise wasn't properly updating progress to 1.0
3. **Progress Ring Logic** - The rendering code was showing progress rings based on `loadingProgress < 1` even for loaded images
4. **ForceRedraw Recursion** - The `forceRedraw()` method could cause stack overflow by calling `draw()` synchronously

## Solution Implemented

### 1. Fixed Progress Ring Display Logic
- Modified `onDrawForeground` in `image-node.js` to check `loadingState !== 'loaded'` before showing progress ring
- This prevents showing loading rings for images that are loaded but stuck at 0.9 progress

### 2. Ensured Progress Updates to 1.0
- Added catch handlers to all `img.decode()` promises to set progress to 1.0 even on decode failure
- Added `forceRedraw()` calls after decode completion for immediate visual feedback

### 3. Fixed ForceRedraw Recursion
- Modified `forceRedraw()` to use `requestAnimationFrame` to avoid recursive calls
- This prevents stack overflow when forceRedraw is called during a draw operation

## Code Changes

### image-node.js
```javascript
// Don't show progress ring if image is already loaded
if (this.properties.hash && window.thumbnailCache && 
    !window.thumbnailCache.hasThumbnails(this.properties.hash) &&
    this.loadingState !== 'loaded') {
    this.drawProgressRing(ctx, this.loadingProgress);
    return;
}

// Ensure decode always updates progress
img.decode()
    .then(() => {
        this.loadingProgress = 1.0;
        // Force redraw after decode
        const canvas = this.graph?.canvas || window.app?.graphCanvas;
        if (canvas && canvas.forceRedraw) {
            canvas.forceRedraw();
        }
        resolve(img);
    })
    .catch(() => {
        this.loadingProgress = 1.0;
        resolve(img);
    });
```

### canvas.js
```javascript
forceRedraw() {
    // Force immediate redraw bypassing FPS limiting
    this.dirty_canvas = true;
    // Use requestAnimationFrame to avoid recursive calls
    requestAnimationFrame(() => {
        if (this.dirty_canvas) {
            this.draw();
            console.log('🎨 Forced immediate redraw');
        }
    });
}
```

## Testing Results
- Created automated tests using Puppeteer to verify the fix
- All 20 image nodes now properly show `loadingProgress = 1` and `loadingState = loaded`
- Loading rings disappear immediately upon image load without requiring mouse movement
- No stack overflow errors from forceRedraw

## Verification
1. Load page with multiple images
2. All images display without loading rings
3. No user interaction required for images to appear
4. Performance remains smooth with no recursive rendering issues