# Collaboration Stabilization Plan

## Current State
- Infinite loops: FIXED ✓
- Nodes disappearing: ACTIVE ISSUE
- State inconsistency: ACTIVE ISSUE
- Race conditions: ACTIVE ISSUE

## Root Cause
Multiple competing state management systems creating conflicts and race conditions.

## Stabilization Strategy (Quick Fixes - 1-2 days)

### 1. State Sync Debouncing (PRIORITY 1)
**Problem**: Rapid state syncs cause nodes to disappear/reappear
**Solution**: 
- Debounce state sync operations (min 500ms between syncs)
- Queue local operations during sync
- Apply local operations after sync completes

### 2. Operation Serialization (PRIORITY 1)
**Problem**: Operations can execute simultaneously causing conflicts
**Solution**:
- Single operation queue with proper locking
- Operations must complete before next starts
- Add operation sequence numbers

### 3. Node State Validation (PRIORITY 2)
**Problem**: Nodes lose properties during updates
**Solution**:
- Validate node integrity before/after operations
- Preserve critical properties (media src, hash, etc.)
- Auto-repair corrupted nodes

### 4. Conflict Resolution (PRIORITY 2)
**Problem**: Simultaneous edits create inconsistent state
**Solution**:
- Last-write-wins with proper timestamps
- Preserve local changes when possible
- Clear conflict indicators

### 5. Broadcast Optimization (PRIORITY 3)
**Problem**: Too many individual broadcasts
**Solution**:
- Batch operations within 50ms window
- Coalesce rapid position updates
- Single broadcast for multi-step operations

## Implementation Order

### Day 1: Critical Fixes
```javascript
// 1. Add operation queue with locking
class OperationQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.localOpsBuffer = [];
    }
    
    async enqueue(operation) {
        this.queue.push(operation);
        if (!this.processing) {
            await this.process();
        }
    }
    
    async process() {
        this.processing = true;
        while (this.queue.length > 0) {
            const op = this.queue.shift();
            await this.executeOperation(op);
        }
        this.processing = false;
    }
}

// 2. State sync debouncing
let syncTimeout = null;
function requestStateSync() {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
        performStateSync();
    }, 500);
}

// 3. Node validation
function validateNode(node) {
    if (node.type === 'media/image') {
        if (!node.properties.src && node.properties.hash) {
            // Attempt repair
            repairMediaNode(node);
        }
    }
}
```

### Day 2: Stability Improvements
- Implement conflict resolution
- Add operation batching
- Comprehensive testing

## Success Metrics
1. No nodes disappearing during normal operation
2. Consistent state across all tabs within 1 second
3. No lost media properties
4. Smooth collaborative editing

## Long-term Recommendation
After stabilization, consider architectural refactor:
- Single source of truth (CRDT-based)
- Event sourcing pattern
- Proper transaction support
- Remove circular dependencies

## Testing Protocol
1. Two tabs moving same node
2. Three tabs creating nodes simultaneously  
3. Rapid consecutive operations
4. Network latency simulation
5. Media node persistence across operations