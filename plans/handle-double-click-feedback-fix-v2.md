# Handle Double-Click Visual Feedback Fix - Version 2

## Issue
Double-clicking on resize handles (for aspect ratio reset) and rotation handles (for rotation reset) did not provide instant visual feedback due to FPS limiting in the render loop.

## Root Cause
The render loop in `startRenderLoop()` has FPS limiting (lines 138-142) that skips frames if not enough time has passed since the last render. This means setting `dirty_canvas = true` alone doesn't guarantee an immediate redraw - it just marks the canvas for redraw on the next allowed frame.

## Solution
Added `requestAnimationFrame(() => this.draw())` after setting `dirty_canvas = true` in all reset operations. This forces an immediate redraw by directly calling the draw function, bypassing the FPS limiting for this critical user interaction.

### Changes Made
1. **resetAspectRatio() - Single node reset** (line ~3230)
2. **resetAspectRatio() - Multi-node reset** (line ~3262) 
3. **resetRotation() - Single node reset** (line ~3290)
4. **resetRotation() - Multi-node reset** (line ~3304)

### Pattern Used
```javascript
// Ensure immediate visual feedback
this.dirty_canvas = true;
requestAnimationFrame(() => this.draw());
```

This pattern is already used throughout the codebase in:
- `NodeCommands.js` - for showing loading states
- `NodeCommandsExtended.js` - in ResetNodeCommand
- `NavigationStateManager.js` - for navigation updates
- `StateSyncManager.js` - for undo/redo operations

## Testing
To test the fix:
1. Load an image node on the canvas
2. Resize it to change its aspect ratio
3. Double-click on a resize handle - should immediately reset to original aspect ratio
4. Rotate the node
5. Double-click on the rotation handle - should immediately reset rotation to 0°

Both operations should now provide instant visual feedback without any delay or need to interact with the canvas.