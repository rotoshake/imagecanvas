# 70 FPS Performance Investigation - Follow-up

## Issue Status
The deltaTime fix was necessary but didn't resolve the 70 FPS cap. The issue appears to be a different bottleneck.

## Key Findings

### 1. Browser FPS Limiting
70 FPS is suspiciously close to typical monitor refresh rates and browser vsync behavior. Some possibilities:
- Browser is capping at a non-standard refresh rate
- Double buffering or vsync is limiting performance
- Chrome's frame scheduling might be limiting to 70 FPS

### 2. Continuous Redraw Triggers
Multiple systems are potentially forcing continuous redraws:
- Animation system (even with fixed deltaTime)
- Loading state checks every 100ms
- Video playing checks
- Alignment animation checks
- Viewport animation checks

### 3. Performance Profiling Needed
The commented-out performance logging at line 3627 should be enabled to identify actual bottlenecks:
```javascript
// if (totalTime > 8.33) {
//     console.log(`🐌 Slow frame: ${totalTime.toFixed(1)}ms total...`);
// }
```

## Recommended Next Steps

### 1. Enable Performance Logging
Uncomment the performance logging to see actual frame times and identify which phase is slow:
- Grid drawing
- Culling
- Node rendering
- UI overlay

### 2. Add Render Reason Tracking
Add logging to track WHY each frame is being rendered:
```javascript
let renderReasons = [];
if (this.dirty_canvas) renderReasons.push('dirty');
if (hasActiveVideos) renderReasons.push('video');
if (hasActiveAlignment) renderReasons.push('alignment');
if (hasActiveViewportAnimation) renderReasons.push('viewport');
if (hasActiveAnimations) renderReasons.push('animations');
if (activelyLoadingNodes.size > 0) renderReasons.push('loading');
```

### 3. Test Minimal Render Loop
Create a test that bypasses all the checks and just renders at requestAnimationFrame speed to verify if 120 FPS is achievable.

### 4. Check Chrome Frame Scheduling
Use Chrome DevTools Performance tab to:
- Check actual frame timing
- Look for forced reflows
- Identify GPU bottlenecks
- Check for compositor issues

### 5. Isolate Animation System
Temporarily disable each system one by one:
- Animation system
- Alignment manager
- Video updates
- Loading checks

## Hypothesis
The 70 FPS cap might be due to:
1. Browser-level frame scheduling (Chrome limiting to 70 Hz for some reason)
2. Continuous animation states keeping the render loop busy
3. Hidden performance cost in one of the drawing operations
4. GPU/compositor bottleneck not visible in JavaScript profiling

## Testing Plan
1. Enable performance logging
2. Add render reason tracking
3. Use Chrome DevTools to profile actual frame scheduling
4. Test with minimal canvas (no nodes) to establish baseline
5. Progressively add systems back to identify the bottleneck