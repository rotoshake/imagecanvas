# Undo System Operation Audit

## Overview
This document audits all operation types in the ImageCanvas application to ensure they are properly captured in the undo queue.

## Operation Types and Undo Status

### ✅ Operations Captured in Undo Queue

1. **node_create** - Create new nodes
   - Command: `CreateNodeCommand`
   - Has undoData: YES
   - Properly intercepted: YES

2. **node_move** - Move nodes to new positions
   - Command: `MoveNodeCommand`
   - Has undoData: YES
   - Properly intercepted: YES

3. **node_delete** - Delete nodes
   - Command: `DeleteNodeCommand`
   - Has undoData: YES
   - Properly intercepted: YES

4. **node_property_update** - Update node properties
   - Command: `UpdateNodePropertyCommand`
   - Has undoData: YES
   - Properly intercepted: YES

5. **node_resize** - Resize nodes (including non-uniform resize)
   - Command: `ResizeNodeCommand`
   - Has undoData: YES
   - Properly intercepted: YES
   - Note: This handles both uniform and non-uniform resizing

6. **node_reset** - Reset node properties (rotation, aspect ratio)
   - Command: `ResetNodeCommand`
   - Has undoData: YES
   - Properly intercepted: YES

7. **node_rotate** - Rotate nodes
   - Command: `RotateNodeCommand`
   - Has undoData: YES
   - Properly intercepted: YES

8. **video_toggle** - Toggle video play/pause
   - Command: `VideoToggleCommand`
   - Has undoData: YES
   - Properly intercepted: YES

9. **node_batch_property_update** - Update properties on multiple nodes
   - Command: `BatchPropertyUpdateCommand`
   - Has undoData: YES
   - Properly intercepted: YES

10. **node_duplicate** - Duplicate nodes
    - Command: `DuplicateNodesCommand`
    - Has undoData: YES
    - Properly intercepted: YES

11. **node_paste** - Paste copied nodes
    - Command: `PasteNodesCommand`
    - Has undoData: YES
    - Properly intercepted: YES

### ❌ Operations Excluded from Undo Queue (As Intended)

1. **viewport_pan** - Pan the canvas viewport
   - Navigation operation
   - Should NOT be in undo queue

2. **viewport_zoom** - Zoom the canvas viewport
   - Navigation operation
   - Should NOT be in undo queue

3. **selection_change** - Change selected nodes
   - UI state operation
   - Should NOT be in undo queue

4. **cursor_move** - Move cursor position
   - UI state operation
   - Should NOT be in undo queue

## Issue Investigation: Non-Uniform Resize

The user reported that "non uniform resizes aren't going to the undo". After investigation:

1. **Non-uniform resize uses the same `node_resize` command** as uniform resize
2. The `ResizeNodeCommand` properly creates undoData for all resize operations
3. The command is registered in the OperationPipeline
4. The command should be intercepted by the `applyOptimistic` interceptor

### Potential Issues

1. **Timing Issue**: The interceptor might not be set up when the resize operation executes
2. **Origin Check**: The operation might not have `origin === 'local'`
3. **Execution Flag**: The command might not have `executed` flag set properly

## Recommendations

1. Add logging to track when resize operations are executed
2. Verify the interceptor is active when resize operations occur
3. Check if resize operations have proper metadata (origin, executed, undoData)

## Testing Instructions

To test non-uniform resize undo:
1. Select a node
2. Drag a corner resize handle while NOT holding Shift (non-uniform resize)
3. Immediately press Ctrl+Z
4. The node should return to its original size

If this doesn't work, check the console for:
- "🎯 applyOptimistic interceptor" messages
- "✅ Capturing command immediately" messages for resize operations