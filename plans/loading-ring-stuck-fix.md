# Loading Ring Stuck Fix

## Problem
Nodes would show loading rings until mouse movement triggered a redraw, even though images had finished loading.

## Root Cause
1. **250ms Loading Check Interval** - Render loop only checked for loading nodes every 250ms
2. **FPS Limiting** - Render loop could skip frames due to 60 FPS limiting
3. **No Immediate Redraw** - Image load completion only set `dirty_canvas = true` but didn't force immediate render

## Solution Implemented

### 1. Reduced Loading Check Interval
- Changed `LOADING_CHECK_INTERVAL` from 250ms to 50ms in `canvas.js`
- Provides 5x faster feedback for loading state changes

### 2. Added forceRedraw() Method
- New method in `canvas.js` that bypasses timing checks
- Calls `draw()` immediately for critical visual updates
```javascript
forceRedraw() {
    this.dirty_canvas = true;
    this.draw();
    console.log('🎨 Forced immediate redraw');
}
```

### 3. Updated Image/Video Loading
- Both `image-node.js` and `video-node.js` now call `forceRedraw()` when loading completes
- Ensures immediate visual feedback without waiting for render loop timing

### 4. Cleaned Up Redundant Code
- Removed duplicate `markDirty()` call after `forceRedraw()`
- Consolidated redraw logic

## Result
- Loading rings now disappear immediately when content loads
- No need for mouse movement or other user interaction
- Maintains performance while providing instant feedback

## Testing
1. Load images/videos on canvas
2. Loading rings should disappear immediately upon load completion
3. No mouse movement required