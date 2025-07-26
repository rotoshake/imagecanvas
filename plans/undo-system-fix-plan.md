# Undo System Fix Plan

## Problem Analysis

The undo system is failing because of a **type mismatch between node IDs**:

1. **Client side**: Node IDs are numbers (e.g., `1753416575448`)
2. **Server side**: When processing `Object.entries(undoData.previousPositions)`, the numeric keys get converted to strings
3. **Comparison fails**: `1753416575448 === "1753416575448"` returns `false`
4. **Result**: Server can't find the node to restore, undo appears to work but node doesn't move

## Current Flow (Working)
1. ✅ Client prepares undo data BEFORE node move (fixed in StateSyncManager.js)
2. ✅ Client sends undo data to server with correct original positions
3. ✅ Server receives undo request and processes it
4. ❌ **Server fails to find nodes due to type mismatch**
5. ✅ Server returns "success" but with empty state changes
6. ✅ Client receives empty state changes and doesn't update anything

## Solution

Fix the type mismatch in **server-side undo processing** by using loose equality (`==`) instead of strict equality (`===`) in node ID comparisons.

### Files to Fix

**File**: `server/src/undo/UndoStateSync.js`

**Changes needed in these methods**:
1. `applyUndoData()` - Lines 407, 418, 426, 434 (previousPositions, previousSizes, previousProperties, etc.)
2. `undoNodeMove()` - Line with `state.nodes.find(n => n.id === nodeId)`
3. `undoNodeResize()` - Similar lines
4. `undoPropertyUpdate()` - Similar lines  
5. `undoNodeRotate()` - Similar lines
6. `undoNodeReset()` - Similar lines

**Change pattern**:
```javascript
// FROM:
const node = state.nodes.find(n => n.id === nodeId);

// TO:
const node = state.nodes.find(n => n.id == nodeId); // Loose equality handles string/number conversion
```

**Alternative approach** (more explicit):
```javascript
// TO:
const node = state.nodes.find(n => n.id === Number(nodeId));
```

### Expected Result

After this fix:
1. Move a node → position changes ✅
2. Press Ctrl+Z → node returns to original position ✅
3. Console shows: `🔄 Restoring node X position from [new_x, new_y] to [old_x, old_y]` ✅

## Test Plan

1. Apply the fixes to server code
2. Restart server (nodemon should auto-restart)
3. Test sequence:
   - Move an image node to new position
   - Press Ctrl+Z
   - Verify node returns to original position
   - Check console logs show proper restoration messages

## Files to Modify

1. `/server/src/undo/UndoStateSync.js` - Main fix for type mismatch
2. Add debugging logs to confirm fix is working

This should completely resolve the undo system without affecting any other functionality.