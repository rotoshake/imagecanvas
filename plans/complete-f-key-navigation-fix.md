# Complete Fix for F Key Navigation State Issue

## Problem Summary
When pressing 'f' to fit selection/all, the navigation state was not persisting on page refresh, even though logs showed it was being saved.

## Root Cause
The ViewportManager's animation completion callback was failing due to incorrect object references:

1. ViewportManager was initialized with only the DOM canvas element
2. In the animation callback, it tried to access `this.canvas.graphCanvas` 
3. Since `this.canvas` was a DOM element (not the LGraphCanvas instance), `graphCanvas` was undefined
4. The condition `if (this.canvas.graphCanvas && window.navigationStateManager)` always failed
5. Navigation state save was never triggered after animation completion

## Solution Implemented

### 1. Updated ViewportManager Constructor
Added a second parameter to accept the LGraphCanvas instance:
```javascript
constructor(canvas, graphCanvas = null) {
    this.canvas = canvas;
    this.graphCanvas = graphCanvas; // Reference to LGraphCanvas instance
    // ...
}
```

### 2. Fixed Animation Callback
Updated the animation completion callback to use the correct reference:
```javascript
// Before (broken):
if (this.canvas.graphCanvas && window.navigationStateManager) {
    window.navigationStateManager.onViewportChange();
}

// After (fixed):
if (window.navigationStateManager) {
    window.navigationStateManager.onViewportChange();
}
```

### 3. Updated Canvas Initialization
Modified LGraphCanvas to pass itself to ViewportManager:
```javascript
// Before:
this.viewport = new ViewportManager(canvas);

// After:
this.viewport = new ViewportManager(canvas, this);
```

### 4. Fixed Dirty Canvas Flag
Also fixed the dirty canvas flag setting:
```javascript
// Before (broken):
if (this.canvas && this.canvas.graphCanvas) {
    this.canvas.graphCanvas.dirty_canvas = true;
}

// After (fixed):
if (this.graphCanvas) {
    this.graphCanvas.dirty_canvas = true;
}
```

## Testing
Created test files:
- `/.scratch/diagnose-viewport-animation.html` - Demonstrates the broken callback
- `/.scratch/test-f-key-fix.html` - Monitors localStorage to verify fix

## Result
Now when pressing 'f':
1. `zoomToFit()` starts animation
2. Animation completes after ~400ms
3. Callback successfully triggers `navigationStateManager.onViewportChange()`
4. Navigation state is saved with the final zoomed position
5. Refreshing the page restores the correct view

## Related Issues Fixed
- Animation completion now properly sets `dirty_canvas = true`
- No more silent failures in viewport callbacks
- Consistent navigation state saving across all zoom operations