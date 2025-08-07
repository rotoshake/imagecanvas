# Performance Issue Analysis

## The Real Problems

After reverting my overly complex changes and looking more carefully, here are the actual issues:

### 1. Image Thrashing When Zoomed In
**Symptom:** Images flash between full res and 128px thumbnails when zoomed in
**Root Cause:** The LOD selection logic in `getOptimalLOD()` doesn't account for zoom level at all - it only looks at screen size. When zoomed in, the screen size might still be small (if looking at a corner), so it picks a low LOD.

**Simple Fix Needed:**
- Just multiply the quality multiplier by zoom level when zoom > 1
- Or add a minimum LOD based on zoom level

### 2. Color Grading Performance Issues  
**Symptom:** Constant re-rendering and cache thrashing during color adjustments
**Root Cause:** The `startAdjustment` is being called on EVERY mouse move, not just once at the start. This causes constant cache invalidation.

**Simple Fix Needed:**
- Only call `startAdjustment` ONCE when dragging starts (not on every update)
- Only call `endAdjustment` ONCE when dragging ends

### 3. Cache Key Issues
**Observation:** The cache uses composite keys like `nodeId_LOD:2048` but when actively adjusting, it returns null from cache, forcing a re-render to texture every frame.

**The actual flow that's broken:**
1. User starts dragging color wheel
2. `startAdjustment` called (sets activeAdjustmentNodeId)
3. Every frame: `_getCachedOrRender` sees it's the active node, returns null
4. This forces a full render-to-texture every frame (expensive!)
5. The texture is cached but never used because it's still the active node

**Simple Fix Needed:**
- During active adjustments, still USE the cached texture if it exists
- Just don't UPDATE the cache during adjustments
- OR: Skip the cache render entirely and just apply corrections in the main shader

## Why My Previous Fixes Failed

1. **Too Complex:** Added deferred writes, active adjustment sets, etc. - too many moving parts
2. **Wrong Focus:** Tried to defer cache writes but the real issue is we shouldn't be re-rendering to texture at all during adjustments
3. **Broke Real-time Updates:** By skipping cache entirely during adjustments, nothing was being rendered

## Recommended Simple Fixes

### Fix 1: Improve LOD Selection (Simple)
```javascript
getOptimalLOD(screenWidth, screenHeight) {
    const targetSize = Math.max(screenWidth, screenHeight);
    const zoom = this.canvas?.viewport?.scale || 1;
    
    // Simple: boost quality when zoomed in
    let qualityMultiplier = this.qualityMultiplier || 1.2;
    if (zoom > 1) {
        qualityMultiplier *= Math.min(zoom, 2); // Cap at 2x
    }
    
    // Rest stays the same...
}
```

### Fix 2: Fix Color Adjustment Calls
Just ensure `startAdjustment` is only called once when dragging starts, not on every update.

### Fix 3: Don't Re-render During Adjustments
The cached texture should still be USED during adjustments, we just shouldn't re-create it every frame. The shader uniforms should handle the real-time updates.