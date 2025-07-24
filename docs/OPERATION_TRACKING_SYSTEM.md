# Operation Tracking System

## Overview

The Operation Tracking System eliminates orphaned temporary nodes by providing reliable correlation between client-side temporary nodes and server-created nodes. Instead of relying on timers and position-based matching, operations are tracked from creation to completion.

## Key Components

### 1. OperationTracker (js/core/OperationTracker.js)
Central tracking system that:
- Tracks pending operations with unique IDs
- Maps temporary node IDs to expected server responses
- Monitors operation lifecycle (pending → sent → acknowledged → completed)
- Provides correlation between temp and server nodes
- Handles timeouts and cleanup

### 2. Enhanced Alt+Drag Flow (js/canvas.js)
```javascript
// Generate operation ID for tracking
const operationId = `alt-drag-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Add operation ID to temp nodes
duplicatedNodes.forEach(node => {
    node._operationId = operationId;
});

// Track operation before sending
operationTracker.trackOperation(operationId, {
    type: 'node_duplicate',
    tempNodeIds: tempNodeIds,
    nodeData: nodeDataArray
});

// Include operation ID in server request
operationPipeline.execute('node_duplicate', {
    nodeData: nodeDataArray,
    operationId: operationId
});
```

### 3. Server Response Correlation (js/core/StateSyncManager.js)
```javascript
// Server returns nodes with preserved operation IDs
handleServerStateUpdate(data) {
    const { operationId, changes } = data;
    
    // Mark operation as acknowledged
    if (operationId && changes?.added?.length > 0) {
        this.operationTracker.markAcknowledged(operationId, changes.added);
    }
    
    // Use tracker to find correct temp nodes
    for (const serverNode of changes.added) {
        const tempNode = this.findTempNodeViaTracker(operationId, serverNode);
        if (tempNode) {
            replaceNode(tempNode, serverNode);
            this.operationTracker.markNodeReplaced(tempNode.id);
        }
    }
}
```

## Operation Lifecycle

1. **Creation**: User performs Alt+drag
   - Temporary nodes created with `_isTemporary = true`
   - Operation ID generated and assigned to nodes
   - Operation tracked in OperationTracker

2. **Transmission**: Operation sent to server
   - Operation marked as "sent" in tracker
   - Server processes and creates new nodes
   - Server preserves operation correlation data

3. **Acknowledgment**: Server responds
   - Operation marked as "acknowledged"
   - Temp node IDs mapped to server node IDs
   - Reliable correlation established

4. **Replacement**: Nodes replaced atomically
   - Temp nodes found via tracker (not position)
   - Server nodes replace temp nodes
   - Each replacement marked in tracker

5. **Completion**: Operation finalized
   - All nodes verified as replaced
   - Operation marked as "completed"
   - Cleanup scheduled after delay

## Benefits

1. **No Orphaned Nodes**: Every temp node is tracked until replaced
2. **Reliable Correlation**: Direct ID mapping, no position guessing
3. **Better Error Handling**: Timeouts detected and reported
4. **Atomic Operations**: Nodes replaced as complete sets
5. **Performance**: No need for periodic position-based searches

## Timeout Handling

Operations that don't complete within 30 seconds:
- Marked as "timeout" status
- User notified via notification system
- Temp nodes can be cleaned up safely
- Operation can be retried if needed

## Statistics and Debugging

The tracker provides real-time statistics:
```javascript
tracker.getStats() // Returns pending, sent, acknowledged, completed counts
tracker.getUnresolvedNodes() // Lists nodes awaiting server response
tracker.getTimedOutOperations() // Shows operations that exceeded timeout
```

## Testing

Run the test script to verify operation tracking:
```bash
# In browser console
await import('./.scratch/test-operation-tracker.js')
```

This tests:
1. Tracker initialization
2. Operation lifecycle simulation
3. Actual Alt+drag with server sync

## Migration Notes

The system is backward compatible:
- Falls back to position matching if no tracker data
- Old position-based cleanup still runs for untracked nodes
- Server nodes without operation IDs handled normally

## Future Improvements

1. Batch operation support for very large selections
2. Operation priority queuing
3. Retry mechanism for failed operations
4. Operation history for debugging
5. Performance metrics per operation type