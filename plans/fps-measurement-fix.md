# FPS Measurement Fix

## Problem
FPS counter was showing ~65 FPS even though MAX_FPS was set to 120.

## Root Cause
The FPS counter was only counting frames when `draw()` was called, not the actual render loop frequency. This meant:

1. Render loop runs at up to 120 FPS (8.33ms intervals)
2. But `draw()` only happens when `shouldDraw = true`
3. FPS counter only incremented on actual draws
4. Result: Counter showed "draws per second" not "frames per second"

## Solution
Moved `updatePerformanceStats()` to count every frame that passes FPS limiting, regardless of whether a draw occurs. This gives an accurate measure of the render loop's capability.

### Before:
```javascript
// Only counted when drawing
if (shouldDraw) {
    this.updatePerformanceStats(currentTime);
    this.draw();
}
```

### After:
```javascript
// Count every frame after FPS limiting
if (currentTime - lastRenderTime < targetFrameTime) {
    requestAnimationFrame(renderFrame);
    return;
}

// Count this as a potential frame
this.updatePerformanceStats(currentTime);
lastRenderTime = currentTime;
```

## Result
- FPS counter now shows true render loop frequency
- Can verify if 120 FPS is achievable
- Separates "frame capability" from "draws needed"

## Testing
To test maximum FPS, you can:
1. Move the mouse continuously (triggers dirty_canvas)
2. Have a video playing
3. Or temporarily add `canvas.dirty_canvas = true` in console

The FPS counter should now show up to 120 FPS if your system supports it.