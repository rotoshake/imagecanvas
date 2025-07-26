# Handle Double-Click Visual Feedback Fix

## Issue
Double-clicking on resize handles (for aspect ratio reset) and rotation handles (for rotation reset) did not provide instant visual feedback. Users had to refresh or wait for the next render cycle to see the changes.

## Root Cause
The `resetAspectRatio()` and `resetRotation()` functions in `js/canvas.js` were calling the operation pipeline but not setting `this.dirty_canvas = true` after the operation, which meant the canvas wouldn't redraw immediately.

## Solution
Added `this.dirty_canvas = true` after each `operationPipeline.execute()` call in both functions:

### Changes Made
1. **resetAspectRatio() - Single node reset** (line ~3228)
2. **resetAspectRatio() - Multi-node reset** (line ~3259) 
3. **resetRotation() - Single node reset** (line ~3288)
4. **resetRotation() - Multi-node reset** (line ~3301)

### Technical Details
- The `ResetNodeCommand` in `NodeCommandsExtended.js` already includes immediate visual feedback code
- However, the canvas-level reset functions weren't triggering a redraw after the operation pipeline execution
- The fix ensures that `dirty_canvas` is set to `true`, which will trigger a redraw on the next animation frame
- Fallback paths already had `this.dirty_canvas = true` and continue to work correctly

## Testing
To test the fix:
1. Load an image node on the canvas
2. Resize it to change its aspect ratio
3. Double-click on a resize handle - should immediately reset to original aspect ratio
4. Rotate the node
5. Double-click on the rotation handle - should immediately reset rotation to 0°

Both operations should now provide instant visual feedback without requiring a refresh.