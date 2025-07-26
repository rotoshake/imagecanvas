# Handle Double-Click Visual Feedback - Complete Fix

## Issues Found

### Issue 1: Command Registration Failure
The primary issue was that `node_rotate` and `node_reset` commands were not being registered in the OperationPipeline, causing errors:
```
Error: Unknown command type: node_rotate
Error: Unknown command type: node_reset
```

### Issue 2: Visual Feedback Delay
Even after fixing command registration, visual feedback wasn't immediate due to FPS limiting in the render loop.

## Root Causes

### 1. Command Registration Problem
- `NodeCommandsExtended.js` exports commands to `window.NodeCommandsExtended` object
- `OperationPipeline.js` was looking for commands in the global scope (e.g., `typeof ResetNodeCommand`)
- This mismatch prevented the commands from being registered

### 2. Visual Feedback Problem
- The render loop has FPS limiting that can skip frames
- Setting `dirty_canvas = true` alone doesn't guarantee immediate redraw

## Solutions Applied

### 1. Fixed Command Registration in OperationPipeline.js
```javascript
// Before - looking in global scope
if (typeof ResetNodeCommand !== 'undefined') {
    this.registerCommand('node_reset', ResetNodeCommand);
}

// After - properly accessing from window.NodeCommandsExtended
if (typeof window.NodeCommandsExtended !== 'undefined') {
    const { ResizeNodeCommand, ResetNodeCommand, RotateNodeCommand, VideoToggleCommand } = window.NodeCommandsExtended;
    
    if (ResetNodeCommand) {
        this.registerCommand('node_reset', ResetNodeCommand);
    }
    // ... other commands
}
```

### 2. Added Immediate Redraw in canvas.js
Added `requestAnimationFrame(() => this.draw())` after operation pipeline calls in:
- `resetAspectRatio()` - for both single and multi-node resets
- `resetRotation()` - for both single and multi-node resets

## Files Modified
1. `/js/core/OperationPipeline.js` - Fixed command registration
2. `/js/canvas.js` - Added immediate redraw calls

## Testing
1. Reload the application to ensure commands are properly registered
2. Load an image node
3. Resize and double-click resize handle - should immediately reset aspect ratio
4. Rotate and double-click rotation handle - should immediately reset rotation
5. Check browser console - no more "Unknown command type" errors

Both operations now work correctly with instant visual feedback.