# Batched Operation Queue Design

## Current Problem
- Temporary nodes are created optimistically
- Server creates new nodes with different IDs
- No reliable way to match temp nodes to server nodes
- Cleanup runs on a timer instead of when operations complete

## Proposed Solution: Operation Queue with Verification

### 1. Operation Tracking System
```javascript
class OperationTracker {
    constructor() {
        this.pendingOperations = new Map(); // operationId -> operation details
        this.nodeCorrelations = new Map();  // tempNodeId -> expectedServerResponse
        this.completedOperations = new Set();
    }
    
    // Track a new operation
    trackOperation(operationId, details) {
        this.pendingOperations.set(operationId, {
            id: operationId,
            type: details.type,
            tempNodeIds: details.tempNodeIds || [],
            timestamp: Date.now(),
            status: 'pending'
        });
    }
    
    // Mark operation as acknowledged by server
    markAcknowledged(operationId, serverNodeIds) {
        const op = this.pendingOperations.get(operationId);
        if (op) {
            op.status = 'acknowledged';
            op.serverNodeIds = serverNodeIds;
            
            // Map temp IDs to server IDs
            op.tempNodeIds.forEach((tempId, index) => {
                if (serverNodeIds[index]) {
                    this.nodeCorrelations.set(tempId, serverNodeIds[index]);
                }
            });
        }
    }
    
    // Check if all operations are complete
    allOperationsComplete() {
        for (const [id, op] of this.pendingOperations) {
            if (op.status === 'pending') return false;
        }
        return true;
    }
}
```

### 2. Better Alt+Drag Flow
```javascript
// When Alt+dragging nodes
handleAltDragEnd() {
    const operationId = generateOperationId();
    const tempNodes = [];
    
    // Create temporary nodes but track them properly
    for (const nodeData of duplicatedNodes) {
        const tempNode = createNode(nodeData);
        tempNode._tempOperationId = operationId;
        tempNode._awaitingServer = true; // Better flag name
        tempNodes.push(tempNode);
    }
    
    // Track this operation
    app.operationTracker.trackOperation(operationId, {
        type: 'node_duplicate',
        tempNodeIds: tempNodes.map(n => n.id)
    });
    
    // Send to server with operation ID
    app.pipeline.execute('node_duplicate', {
        operationId: operationId,
        nodeData: nodeDataArray
    });
}
```

### 3. Server Response Handling
```javascript
// Server sends back correlation data
handleServerResponse(response) {
    const { operationId, createdNodes } = response;
    
    // Mark operation as complete
    app.operationTracker.markAcknowledged(
        operationId, 
        createdNodes.map(n => n.id)
    );
    
    // Now we can safely replace nodes
    const operation = app.operationTracker.pendingOperations.get(operationId);
    operation.tempNodeIds.forEach((tempId, index) => {
        const tempNode = graph.getNodeById(tempId);
        const serverNode = createdNodes[index];
        
        if (tempNode && serverNode) {
            // Direct replacement - no guessing needed
            replaceNode(tempNode, serverNode);
        }
    });
}
```

### 4. Cleanup Only When Safe
```javascript
// Instead of timer-based cleanup
cleanupCompletedOperations() {
    const now = Date.now();
    
    for (const [opId, operation] of app.operationTracker.pendingOperations) {
        // Only clean up acknowledged operations
        if (operation.status === 'acknowledged') {
            // All temp nodes for this operation can be safely cleaned
            operation.tempNodeIds.forEach(tempId => {
                const node = graph.getNodeById(tempId);
                if (node && node._awaitingServer) {
                    // This node was successfully replaced
                    graph.remove(node);
                }
            });
            
            app.operationTracker.pendingOperations.delete(opId);
        } else if (now - operation.timestamp > 30000) {
            // Operation timeout - show user error
            console.error(`Operation ${opId} timed out`);
            showUserNotification('Some operations failed - please retry');
        }
    }
}
```

### 5. Batch Operation Queue
```javascript
class BatchOperationQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.batchSize = 50;
        this.tracker = new OperationTracker();
    }
    
    // Add operations to queue
    enqueue(operation) {
        this.queue.push(operation);
        if (!this.processing) {
            this.processBatch();
        }
    }
    
    async processBatch() {
        if (this.queue.length === 0) {
            this.processing = false;
            return;
        }
        
        this.processing = true;
        const batch = this.queue.splice(0, this.batchSize);
        const batchId = generateBatchId();
        
        // Track all operations in batch
        batch.forEach(op => {
            this.tracker.trackOperation(op.id, op);
        });
        
        try {
            // Send batch to server
            const response = await sendBatchToServer(batch, batchId);
            
            // Process responses
            response.results.forEach((result, index) => {
                const operation = batch[index];
                this.tracker.markAcknowledged(operation.id, result.nodeIds);
            });
            
            // Clean up completed operations
            this.cleanupCompleted();
            
        } catch (error) {
            // Requeue failed operations
            batch.forEach(op => {
                op.retryCount = (op.retryCount || 0) + 1;
                if (op.retryCount < 3) {
                    this.queue.unshift(op); // Add back to front
                }
            });
        }
        
        // Process next batch
        setTimeout(() => this.processBatch(), 100);
    }
}
```

## Benefits

1. **No Orphaned Nodes**: We track exactly what we're waiting for
2. **Reliable Correlation**: Direct mapping between temp and server nodes
3. **Proper Cleanup**: Only remove nodes when we know they're replaced
4. **Better Error Handling**: Can detect and retry failed operations
5. **Batch Efficiency**: Group operations for better performance

## Implementation Steps

1. Create OperationTracker class
2. Update Alt+drag to use tracking
3. Modify server to return correlation data
4. Replace timer-based cleanup with operation-based cleanup
5. Add batch queue for large operations

## Testing

1. Alt+drag 100 nodes - verify no orphans
2. Disconnect network during operation - verify timeout handling
3. Rapid operations - verify queue processes correctly
4. Mixed operations - verify tracking handles different types