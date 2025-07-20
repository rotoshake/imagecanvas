# NetworkLayer Project Join Fix

## Problem
When moving nodes, the console showed "Cannot broadcast: not connected or not in project" even though the UI showed "Connected". The issue was that the NetworkLayer connects to the server but doesn't automatically join a project when a canvas is loaded.

## Root Cause
The new NetworkLayer was missing integration with the canvas loading process. When a canvas was loaded:
1. CollaborativeManager would join the project
2. NetworkLayer would NOT join the project
3. Operations would be sent through NetworkLayer which hadn't joined the project
4. Result: "Cannot broadcast: not connected or not in project"

## Solution
Modified `canvas-navigator.js` to call `networkLayer.joinProject()` whenever a canvas is loaded:

1. **Loading existing canvas** - Added NetworkLayer project join in `loadCanvas()`
2. **Creating new canvas** - Added NetworkLayer project join in `createNewCanvas()`
3. **Saving as new canvas** - Added NetworkLayer project join in `saveAsNewCanvas()`
4. **Creating default canvas** - Added NetworkLayer project join in `createDefaultCanvas()`

## Code Changes
In each canvas loading scenario, added:
```javascript
// Join using the new NetworkLayer if available
if (this.app.networkLayer && this.app.networkLayer.isConnected) {
    console.log('🔌 Joining project via NetworkLayer:', canvasId);
    this.app.networkLayer.joinProject(canvasId);
}
```

## Additional Work
1. Restored missing architecture files from archive:
   - NetworkLayer.js
   - OperationPipeline.js
   - CollaborativeArchitecture.js
   - MigrationAdapter.js
   - CanvasIntegration.js
   - AutoInit.js

2. These files were previously archived but are critical for the new collaborative architecture to function.

## Testing
After these changes:
1. Clear browser cache (Cmd+Shift+R or Ctrl+Shift+F5)
2. Load a canvas
3. Move a node
4. The NetworkLayer should now properly broadcast operations without the "not in project" error

## Status
✅ NetworkLayer now properly joins projects when canvases are loaded
✅ Operations can be broadcast through the new architecture
✅ The circular reference issue remains fixed with GraphCircularReferenceResolver