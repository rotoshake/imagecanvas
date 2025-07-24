# Large Scale Node Synchronization Fix

## Problem Analysis

When working with ~220 nodes, several nodes refuse to sync properly:
- Some nodes don't sync between tabs
- Nodes snap back to old positions on refresh
- Happens with every group action

## Root Causes

### 1. **Aggressive Cleanup Timing**
- Temporary nodes cleaned up after 10 seconds (untracked) or 30 seconds (tracked)
- With 220 nodes in chunks of 50, processing takes 5+ chunks
- Server processing + network latency can exceed cleanup windows

### 2. **State Version Conflicts**
- Multiple chunks create multiple state updates
- Concurrent updates can cause version gaps
- Some nodes might be in a "limbo" state between versions

### 3. **Operation Tracking Gaps**
- Not all bulk operations properly track every node
- Some nodes might lose their operation ID during processing
- Correlation between temp and server nodes fails

### 4. **Partial Update Application**
- When a chunk fails, some nodes remain temporary
- These temporary nodes get cleaned up
- On refresh, server state shows old positions

## Solution Implementation

### Step 1: Extend Cleanup Grace Period for Bulk Operations

```javascript
// In StateSyncManager.js
cleanupOrphanedTemporaryNodes() {
    // Skip cleanup if bulk operation in progress
    if (this.app.bulkOperationInProgress) {
        console.log('⏸️ Skipping cleanup - bulk operation in progress');
        return;
    }
    
    // Increase timeouts for large operations
    const nodeCount = this.app.graph.nodes.length;
    const baseTimeout = nodeCount > 100 ? 60000 : 30000; // 60s for 100+ nodes
    const untrackTimeout = nodeCount > 100 ? 45000 : 10000; // 45s for 100+ nodes
    
    // ... rest of cleanup logic with dynamic timeouts
}
```

### Step 2: Track Bulk Operations Properly

```javascript
// In BulkOperationManager.js
async executeBulkOperation(operationType, items, params, prepareItem) {
    // Mark bulk operation in progress
    this.app.bulkOperationInProgress = true;
    this.app.bulkOperationNodeCount = items.length;
    
    try {
        // ... existing operation logic
    } finally {
        // Always clear flag
        this.app.bulkOperationInProgress = false;
        
        // Schedule verification after delay
        setTimeout(() => this.verifyBulkOperation(operationId), 5000);
    }
}

async verifyBulkOperation(operationId) {
    // Check for orphaned nodes from this operation
    const orphaned = this.app.graph.nodes.filter(n => 
        n._isTemporary && 
        n._bulkOperationId === operationId
    );
    
    if (orphaned.length > 0) {
        console.warn(`Found ${orphaned.length} orphaned nodes from operation ${operationId}`);
        // Retry sync for these specific nodes
        await this.retrySyncForNodes(orphaned);
    }
}
```

### Step 3: Improve State Consistency

```javascript
// In StateSyncManager.js
async handleServerStateUpdate(data) {
    const { stateVersion, changes, operationId } = data;
    
    // Queue updates if processing large operation
    if (this.processingLargeUpdate) {
        this.queuedUpdates.push(data);
        return;
    }
    
    // For large updates, process atomically
    if (changes?.added?.length > 20 || changes?.updated?.length > 20) {
        this.processingLargeUpdate = true;
        
        try {
            // Process all nodes at once
            await this.applyServerChanges(changes, operationId);
            
            // Process any queued updates
            while (this.queuedUpdates.length > 0) {
                const queued = this.queuedUpdates.shift();
                await this.applyServerChanges(queued.changes, queued.operationId);
            }
        } finally {
            this.processingLargeUpdate = false;
        }
    }
}
```

### Step 4: Add Node State Verification

```javascript
// New method in StateSyncManager
async verifyNodeStates() {
    const localNodes = new Map();
    const issues = [];
    
    // Build local state map
    this.app.graph.nodes.forEach(node => {
        if (!node._isTemporary) {
            localNodes.set(node.id, {
                pos: [...node.pos],
                size: [...node.size],
                version: node._stateVersion || 0
            });
        }
    });
    
    // Request server verification
    const serverState = await this.network.emit('verify_nodes', {
        nodeIds: Array.from(localNodes.keys())
    });
    
    // Compare states
    serverState.nodes.forEach(serverNode => {
        const localNode = localNodes.get(serverNode.id);
        if (localNode) {
            const posDiff = Math.abs(localNode.pos[0] - serverNode.pos[0]) + 
                           Math.abs(localNode.pos[1] - serverNode.pos[1]);
            
            if (posDiff > 1) {
                issues.push({
                    id: serverNode.id,
                    localPos: localNode.pos,
                    serverPos: serverNode.pos,
                    diff: posDiff
                });
            }
        }
    });
    
    if (issues.length > 0) {
        console.warn(`Found ${issues.length} nodes with position mismatches`);
        // Force sync these specific nodes
        this.requestNodeSync(issues.map(i => i.id));
    }
    
    return issues;
}
```

### Step 5: Implement Incremental State Sync

```javascript
// For very large operations, sync in stages
async syncLargeOperation(nodes, operationType) {
    const STAGE_SIZE = 50;
    const stages = Math.ceil(nodes.length / STAGE_SIZE);
    
    console.log(`📊 Syncing ${nodes.length} nodes in ${stages} stages`);
    
    for (let i = 0; i < stages; i++) {
        const start = i * STAGE_SIZE;
        const end = Math.min(start + STAGE_SIZE, nodes.length);
        const stageNodes = nodes.slice(start, end);
        
        // Mark nodes with stage info
        stageNodes.forEach(node => {
            node._syncStage = i;
            node._syncStages = stages;
        });
        
        // Sync this stage
        await this.syncNodeStage(stageNodes, operationType, i, stages);
        
        // Wait for stage to complete before next
        await this.waitForStageCompletion(i);
    }
}
```

## Testing Strategy

1. Create test with exactly 220 nodes
2. Perform various group operations (move, duplicate, delete)
3. Monitor for orphaned nodes after each operation
4. Verify state consistency between tabs
5. Test refresh behavior

## Monitoring

Add logging to track:
- Cleanup operations and what they remove
- State version gaps
- Operation completion times
- Nodes that fail to sync

## Configuration

Add settings for large-scale operations:
```javascript
CONFIG.SYNC.LARGE_OPERATION_THRESHOLD = 100; // nodes
CONFIG.SYNC.LARGE_OPERATION_TIMEOUT = 60000; // ms
CONFIG.SYNC.BULK_OPERATION_STAGE_SIZE = 50;
CONFIG.SYNC.CLEANUP_GRACE_MULTIPLIER = 2; // 2x timeout for large ops
```