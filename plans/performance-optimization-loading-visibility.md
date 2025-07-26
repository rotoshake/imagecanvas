# Performance Optimization - Loading & Visibility Checks

## Summary
Optimized the loading checks and visibility calculations to improve FPS from ~70 to target 120 FPS.

## Changes Made

### 1. Loading Checks Optimization
- **Increased interval**: Changed LOADING_CHECK_INTERVAL from 50ms to 100ms
- **Efficient tracking**: Added `activelyLoadingNodes` Map to track only nodes that are actively loading
- **Reduced iterations**: Instead of checking ALL nodes every time, we:
  - Only scan all nodes to find new loading nodes
  - Then only check the actively loading nodes for completion
- **Removed logging**: Eliminated console.log calls that were running every check
- **Preserved functionality**: Kept the critical `shouldDraw = true` when nodes finish loading

### 2. Visibility Checks Optimization
- **Added caching**: Created `cachedVisibleNodes` to store visible nodes list
- **Viewport change detection**: Only recalculate visible nodes when viewport actually changes (pan/zoom)
- **Conditional updates**: `updateNodeVisibility()` only runs when viewport changes, not every frame
- **Added cache invalidation**: Created `invalidateVisibilityCache()` method for when needed

## Performance Impact
- **Before**: Checking all nodes every 50ms + calculating visibility every frame
- **After**: 
  - Only checking actively loading nodes every 100ms
  - Visibility calculated only on viewport changes
  - Eliminated unnecessary console I/O
  
## Expected Results
- Reduced CPU usage in render loop
- Should help achieve target 120 FPS
- Loading detection still works correctly
- No visual changes to user experience