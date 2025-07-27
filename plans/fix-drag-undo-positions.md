# Fix Drag Undo Position Issue

## Problem
When dragging a node and then undoing, the node doesn't return to its original position. The undo operation completes but the position remains unchanged.

## Root Cause
The undo data is capturing the wrong initial position. When `prepareUndoData` is called during `finishInteractions`, the node has already been moved to its final position by the drag operation. The undo system is storing the final position as the "old position", which is why undo doesn't work.

### Timeline of a drag operation:
1. `startNodeDrag` - drag begins, node still at original position
2. `updateNodeDrag` - called repeatedly during drag, updates node.pos in real-time
3. `finishInteractions` - drag ends, sends node_move operation
4. `prepareUndoData` - captures current position (which is the final position, not the initial!)

## Solution
Store the initial positions when the drag starts, and use those positions when preparing undo data.

### Implementation:
1. In `startNodeDrag`, capture and store the initial positions of all selected nodes
2. Store these positions in the drag state
3. When preparing undo data for a drag operation, use the stored initial positions instead of the current positions

### Code Changes Needed:

1. **canvas.js** - Modify `startNodeDrag` to capture initial positions:
```javascript
startNodeDrag(node, e) {
    // ... existing selection logic ...
    
    // Capture initial positions for undo
    const selectedNodes = this.selection.getSelectedNodes();
    this.interactionState.dragging.initialPositions = new Map();
    for (const selectedNode of selectedNodes) {
        this.interactionState.dragging.initialPositions.set(
            selectedNode.id, 
            [...selectedNode.pos]
        );
    }
    
    // ... rest of existing code ...
}
```

2. **canvas.js** - Pass initial positions when sending node_move:
```javascript
if (window.app?.operationPipeline && wasInteracting && !wasDuplication && hasMoved) {
    // ... existing code ...
    
    // Include initial positions for undo
    moveData.initialPositions = Object.fromEntries(
        this.interactionState.dragging.initialPositions
    );
    
    window.app.operationPipeline.execute('node_move', moveData);
}
```

3. **NodeCommands.js** - Use initial positions in prepareUndoData:
```javascript
async prepareUndoData(context) {
    const { graph } = context;
    this.undoData = { 
        previousPositions: {},
        nodes: []
    };
    
    // Check if we have initial positions from a drag operation
    if (this.params.initialPositions) {
        // Use the provided initial positions
        for (const [nodeId, position] of Object.entries(this.params.initialPositions)) {
            this.undoData.previousPositions[nodeId] = position;
            this.undoData.nodes.push({
                id: nodeId,
                oldPosition: position
            });
        }
    } else {
        // Fall back to current positions (for programmatic moves)
        // ... existing code ...
    }
}
```

This ensures that drag operations correctly store the positions from before the drag started, allowing undo to properly restore nodes to their original locations.