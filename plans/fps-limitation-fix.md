# FPS Limitation Fix

## Problem
Canvas was limited to ~66 FPS instead of the configured 120 FPS maximum.

## Root Cause
Multiple `requestAnimationFrame` loops were conflicting:
1. Main render loop with FPS limiting
2. `forceRedraw()` calling `draw()` directly within its own rAF
3. Double-click handlers calling `draw()` within separate rAFs
4. Excessive console logging in hot paths

## Issues Found

### 1. ForceRedraw Implementation
```javascript
// BAD: Creates separate rAF loop
forceRedraw() {
    this.dirty_canvas = true;
    requestAnimationFrame(() => {
        if (this.dirty_canvas) {
            this.draw();
        }
    });
}
```

### 2. Multiple rAF Calls
- 4 instances in double-click handlers calling `requestAnimationFrame(() => this.draw())`
- Each created a separate animation frame callback
- Conflicted with main render loop's FPS limiting

### 3. Console Logging Overhead
- Image loading logged on every frame
- Navigation state logged frequently
- Console I/O impacted performance

## Solutions Implemented

### 1. Simplified ForceRedraw
```javascript
forceRedraw() {
    // Force redraw on next frame
    this.dirty_canvas = true;
    // Don't call draw() directly - let the render loop handle it
    // This prevents conflicting requestAnimationFrame loops
}
```

### 2. Removed Direct Draw Calls
- Replaced all `requestAnimationFrame(() => this.draw())` with just `this.dirty_canvas = true`
- Let the main render loop handle all drawing
- Maintains proper FPS limiting

### 3. Removed Excessive Logging
- Removed per-frame console logs in image loading
- Cleaned up navigation state logging
- Kept only essential warnings and errors

## Result
- Single, unified render loop
- Proper 120 FPS capability restored
- No conflicting animation frames
- Reduced console I/O overhead
- Smoother overall performance

## Key Principle
Always use a single render loop. Setting `dirty_canvas = true` is sufficient to trigger a redraw on the next frame. Direct `draw()` calls should be avoided to prevent timing conflicts.