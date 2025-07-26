# Loading Ring Stuck Analysis

## Issues Found

### 1. **Render Loop Loading Check Interval (250ms)**
- **Location**: `canvas.js:127` - `LOADING_CHECK_INTERVAL = 250`
- **Problem**: Only checks for loading nodes every 250ms
- **Impact**: Can miss state changes, causing up to 250ms delay before redraw

### 2. **FPS Limiting in Render Loop**
- **Location**: `canvas.js:134` - `targetFrameTime = 1000 / CONFIG.PERFORMANCE.MAX_FPS`
- **Problem**: Skips frames if less than ~16.67ms have passed (60 FPS)
- **Impact**: Even if dirty_canvas is set, render might be delayed

### 3. **Inconsistent Dirty Canvas Triggers**
Image loading sets `dirty_canvas = true` in multiple places:
- During progress updates (line 116)
- After image load (line 132)
- In image onload callback (line 154)
- After decode (line 264)
- Multiple other locations

But the render loop might not catch these immediately due to timing.

### 4. **Loading State Detection Logic**
The render loop checks for:
```javascript
const isLoading = node.loadingState === 'loading' || 
    (node.loadingState === 'idle' && 
     (node.properties?.serverUrl || node.properties?.hash) && 
     !node.img);
```
This complex check might not catch all transitions.

### 5. **Vestigial/Redundant Code**
- Multiple `dirty_canvas = true` calls in image loading
- Both `markDirty()` and direct `dirty_canvas = true` calls
- Progress updates trigger redraws frequently during loading

## Root Cause
The main issue is the 250ms loading check interval combined with FPS limiting. When an image finishes loading:
1. `loadingState` changes to 'loaded'
2. `dirty_canvas` is set to true
3. But the render loop might not check for up to 250ms
4. Mouse movement triggers immediate redraw, revealing the loaded image

## Recommended Fixes

### 1. Reduce Loading Check Interval
```javascript
const LOADING_CHECK_INTERVAL = 50; // Check every 50ms instead of 250ms
```

### 2. Force Immediate Redraw on Load Complete
In `image-node.js` after setting `loadingState = 'loaded'`:
```javascript
// Force immediate redraw bypassing render loop timing
if (this.graph?.canvas) {
    this.graph.canvas.dirty_canvas = true;
    // Force render loop to run immediately
    if (this.graph.canvas.renderFrame) {
        requestAnimationFrame(() => this.graph.canvas.renderFrame(performance.now()));
    }
}
```

### 3. Simplify Loading State Detection
Track loading nodes more directly instead of complex state checks.

### 4. Remove Redundant Dirty Canvas Calls
Consolidate to use `markDirty()` method consistently.