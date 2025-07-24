# Temporary Node Orphaning Root Cause Analysis

## Overview
When Alt+dragging nodes to duplicate them, temporary nodes are created locally and should be replaced by server nodes when the server responds. However, some temporary nodes become orphaned and are not properly replaced, leading to duplicate nodes on the canvas.

## Flow Analysis

### 1. Alt+Drag Initiation (canvas.js)
```javascript
// When Alt+drag starts, temporary nodes are created locally
startNodeDuplication(node, e) {
    const duplicate = this.duplicateNode(node);
    duplicate._isTemporary = true;
    duplicate._temporaryCreatedAt = Date.now();
    this.graph.add(duplicate);  // Added to graph immediately
    duplicates.push(duplicate);
}
```

### 2. Drag Complete - Server Sync (canvas.js)
```javascript
// When drag completes, nodes are sent to server
if (wasDuplication && window.app?.operationPipeline) {
    const tempNodeMap = new Map();
    duplicatedNodes.forEach(node => {
        if (node._isTemporary) {
            tempNodeMap.set(node.id, node);  // Track temp nodes by their LOCAL ID
        }
    });
    
    // Send to server via node_duplicate command
    operationPromise = window.app.operationPipeline.execute('node_duplicate', {
        nodeData: nodeDataArray,
        offset: [0, 0]
    });
}
```

### 3. Command Execution (NodeCommandsExtended.js)
```javascript
// DuplicateNodesCommand.execute()
// For Alt+drag with explicit nodeData:
if (isRemoteOrigin) {
    graph.add(duplicate);  // Server adds its version
} else {
    // Local: Node ALREADY in graph, skip adding
    console.log(`⏭️ Skipping local add for Alt+drag node: ${duplicate.id} (already in graph)`);
}
```

### 4. Server Response Flow (StateSyncManager.js)
```javascript
// Server creates new nodes with NEW IDs
applyServerChanges(changes) {
    if (added) {
        for (const nodeData of added) {
            // Try to find temporary node to replace
            const tempNode = this.findTemporaryNodeByOperationId(nodeData._operationId) ||
                            this.findTemporaryNodeAtPosition(nodeData.pos, nodeData.type);
            
            if (tempNode) {
                // Remove temp node and add server node
                this.app.graph.remove(tempNode);
                const node = await this.createNodeFromData(nodeData);
                this.app.graph.add(node);
            }
        }
    }
}
```

## Root Causes Identified

### 1. **ID Mismatch Problem**
- Temporary nodes have LOCAL IDs (e.g., `1737657447123`)
- Server creates NEW IDs (e.g., `789`)
- The `tempNodeMap` tracks by LOCAL ID but server nodes have different IDs
- No reliable way to match temp node to server node

### 2. **Operation ID Tracking Issues**
- `_operationId` is added in DuplicateNodesCommand but may not survive server round-trip
- Server's `applyNodeDuplicate` preserves `_operationId` but it's not guaranteed to match
- Operation IDs are generated differently for different flows

### 3. **Position-Based Matching Unreliability**
- `findTemporaryNodeAtPosition` uses position matching with 5px tolerance
- Nodes may have moved slightly during drag
- Multiple nodes at similar positions cause wrong matches
- Floating point precision issues

### 4. **Race Condition**
- Optimistic cleanup happens BEFORE server state update
- `cleanupOptimisticOperation` removes nodes based on rollback data
- Server state update tries to find temp nodes that may already be removed
- No coordination between cleanup and state update

### 5. **Async Timing Issues**
- Image loading is async and may complete after server response
- Loading states may prevent cleanup (`if (node.loadingState === 'loading')`)
- No guarantee server response arrives before/after image load completes

### 6. **Missing Synchronization**
The system doesn't wait for server confirmation before proceeding because:
- It uses optimistic updates for better UX (instant feedback)
- Server operations are async and can take 5-30 seconds
- Blocking would freeze the UI

## Why Temporary Nodes Become Orphaned

1. **Cleanup Timing**: The 5-second cleanup timeout may fire before server responds
2. **ID Tracking Failure**: Can't reliably match temp nodes to server nodes
3. **Race Conditions**: Optimistic cleanup and server updates happen independently
4. **Position Drift**: Nodes move during drag, breaking position-based matching
5. **Operation ID Loss**: Operation IDs may not survive the full round trip

## Recommended Fix

### 1. **Stable Correlation ID**
```javascript
// Generate correlation ID that survives the full flow
const correlationId = `temp-${Date.now()}-${Math.random()}`;
duplicate._correlationId = correlationId;

// Include in server request
nodeData.correlationId = node._correlationId;

// Server preserves and returns it
duplicate.correlationId = data.correlationId;

// Match using correlation ID
const tempNode = this.findTemporaryNodeByCorrelationId(nodeData.correlationId);
```

### 2. **Deferred Cleanup**
- Don't clean up temp nodes immediately after server ACK
- Wait for state update to complete replacement
- Only clean up truly orphaned nodes (no pending operations)

### 3. **Atomic Replacement**
- Combine cleanup and creation in a single atomic operation
- Ensure temp node removal and server node addition happen together
- Prevent intermediate states where neither exists

### 4. **Better State Tracking**
- Track which temp nodes are waiting for which operations
- Clear tracking when replacement completes
- Only cleanup nodes with no pending operations