# Fix: F Key Navigation State Not Persisting

## Problem
When using the 'f' key to fit selection/all to screen, the navigation state appeared to save (logs showed saves happening) but didn't persist on page refresh. The viewport would return to its pre-zoomed state.

## Root Cause
The issue was caused by a race condition between animation and state saving:

1. Pressing 'f' calls `viewport.zoomToFit()` with animation enabled by default
2. NavigationStateManager's hook was calling `onViewportChange()` immediately after `zoomToFit()` returned
3. Since animation runs asynchronously, the viewport hadn't actually changed yet when state was saved
4. The OLD viewport state was saved to localStorage
5. The animation would complete ~400ms later and save the correct state
6. If the user refreshed before animation completed, they got the old (incorrect) state

## Solution
Modified NavigationStateManager's `zoomToFit` hook to NOT call `onViewportChange()` immediately, since the viewport's `animateTo` method already includes a callback that saves navigation state when animation completes.

### Code Change
In `/js/core/NavigationStateManager.js` (lines 97-103):

```javascript
// Before:
const originalZoomToFit = this.canvas.viewport.zoomToFit.bind(this.canvas.viewport);
this.canvas.viewport.zoomToFit = (...args) => {
    const result = originalZoomToFit(...args);
    this.onViewportChange();  // This was saving state too early!
    return result;
};

// After:
const originalZoomToFit = this.canvas.viewport.zoomToFit.bind(this.canvas.viewport);
this.canvas.viewport.zoomToFit = (...args) => {
    const result = originalZoomToFit(...args);
    // Don't call onViewportChange here - viewport's animateTo will handle it
    // when the animation completes (see viewport.js line 202-204)
    return result;
};
```

## Testing
Created test file at `/.scratch/test-f-key-navigation.html` to monitor localStorage changes and verify navigation state persistence.

To test:
1. Open ImageCanvas with nodes
2. Press 'f' to fit all/selection
3. Wait for animation to complete
4. Refresh the page
5. View should restore to the same zoom/pan position

## Related Systems
- Mouse wheel zoom and keyboard zoom ('+'/'-' keys) continue to work correctly
- Pan operations save state on drag end
- The fix ensures no duplicate state saves during animations