# Performance Drop from 120 FPS to 70 FPS - Audit Report

## Executive Summary
The performance drop from 120 FPS to 70 FPS is caused by a critical bug in the render loop where `deltaTime` is incorrectly calculated, resulting in broken animation timing that forces unnecessary continuous redraws.

## Root Cause Analysis

### Primary Issue: Incorrect deltaTime Calculation
**Location:** `js/canvas.js:216`

```javascript
// BUG: deltaTime is calculated AFTER lastRenderTime was already updated
const deltaTime = currentTime - lastRenderTime;
const hasActiveAnimations = this.animationSystem && this.animationSystem.updateAnimations(deltaTime);
```

**Problem:** 
- `lastRenderTime` is updated on line 160 to `currentTime`
- Then on line 216, `deltaTime = currentTime - lastRenderTime` always equals 0
- This causes animations to never progress properly
- The animation system thinks animations are always active because they never complete
- This forces continuous redraws even when nothing is actually animating

### Secondary Issues Found

1. **FPS Measurement Issue**
   - The FPS counter counts potential frames, not actual rendered frames
   - This gives misleading performance metrics

2. **Unnecessary Work in Render Loop**
   - Loading node checks run every 100ms even when no nodes are loading
   - Video playing check runs on every frame using `Array.some()`
   - Multiple animation system checks that could be consolidated

## Performance Impact

- **Before Bug:** Render loop would skip frames efficiently, only drawing when needed
- **After Bug:** Animation system always reports active animations, forcing draws every frame
- **Result:** Constant 70 FPS instead of variable FPS up to 120 when needed

## Recommended Fix

```javascript
// Store the previous frame time before updating
const deltaTime = currentTime - lastRenderTime;
lastRenderTime = currentTime;

// Then use deltaTime for animation updates
const hasActiveAnimations = this.animationSystem && this.animationSystem.updateAnimations(deltaTime);
```

## Additional Optimization Opportunities

1. **Cache Active States**
   - Track when videos start/stop playing
   - Track when animations are added/removed
   - Only check states when they might have changed

2. **Optimize Loading Checks**
   - Only run loading checks when nodes are added or loading state changes
   - Use events instead of polling

3. **Consolidate Animation Checks**
   - Combine all animation state checks into a single method
   - Cache the result for the frame

## Testing Recommendations

1. Monitor actual FPS vs reported FPS
2. Check animation completion times
3. Verify idle performance (no animations should mean minimal CPU usage)
4. Test with Chrome DevTools Performance profiler

## Conclusion

This is a regression introduced in recent commits that refactored the render loop. The fix is simple but critical for performance. The bug essentially breaks the FPS limiting mechanism by forcing continuous redraws.