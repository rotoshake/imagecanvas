# Undo/Redo Implementation Plan for Server-Authoritative Architecture

## Current Issues

1. **Complete Loss of Functionality**: StateManager methods are disabled, returning "server handles history" but no server implementation exists
2. **No Operation Bundling**: Complex operations (drag to duplicate, multi-node moves) aren't bundled as single undo actions
3. **Navigation Not Excluded**: No mechanism to filter viewport changes from history
4. **Disconnected Systems**: OperationPipeline has history tracking but it's not connected to actual undo/redo
5. **No Server History**: Server only handles real-time sync, not operation history

## Proposed Solution

### 1. Hybrid Undo/Redo System

Create a hybrid approach that works both offline and online:

```javascript
class HybridUndoRedoManager {
    constructor(operationPipeline, stateSyncManager) {
        this.pipeline = operationPipeline;
        this.stateSync = stateSyncManager;
        
        // Local history for immediate undo/redo
        this.localHistory = [];
        this.localIndex = -1;
        
        // Server history reference
        this.serverHistory = null;
        this.serverIndex = -1;
        
        // Operation bundling
        this.bundleWindow = 100; // ms
        this.currentBundle = null;
        
        // Track what operations to exclude
        this.excludeFromHistory = new Set([
            'viewport_pan',
            'viewport_zoom',
            'selection_change'
        ]);
    }
}
```

### 2. Operation Bundling

Bundle related operations into atomic undo units:

```javascript
class OperationBundle {
    constructor(id, description) {
        this.id = id;
        this.description = description;
        this.operations = [];
        this.timestamp = Date.now();
    }
    
    add(operation) {
        this.operations.push(operation);
    }
    
    async execute(context) {
        const results = [];
        for (const op of this.operations) {
            results.push(await op.execute(context));
        }
        return results;
    }
    
    async undo(context) {
        // Undo in reverse order
        for (let i = this.operations.length - 1; i >= 0; i--) {
            await this.operations[i].undo(context);
        }
    }
}
```

### 3. Smart History Tracking

Track only meaningful operations:

```javascript
shouldTrackOperation(operation) {
    // Skip navigation operations
    if (this.excludeFromHistory.has(operation.type)) {
        return false;
    }
    
    // Skip empty or no-op operations
    if (operation.isEmpty && operation.isEmpty()) {
        return false;
    }
    
    return true;
}
```

### 4. Server History API

Add server-side history tracking:

```javascript
// Server endpoints
POST   /projects/:id/history      // Add operation to history
GET    /projects/:id/history      // Get history list
POST   /projects/:id/undo         // Perform server undo
POST   /projects/:id/redo         // Perform server redo
GET    /projects/:id/history/:n   // Get state at history point
```

### 5. Implementation Steps

1. **Re-enable Local Undo/Redo**
   - Restore StateManager functionality
   - Connect to OperationPipeline's history
   
2. **Add Operation Bundling**
   - Detect related operations within time window
   - Bundle multi-step operations automatically
   
3. **Filter Navigation Operations**
   - Add operation type checking
   - Exclude viewport-only changes
   
4. **Server History (Phase 2)**
   - Add database schema for operation history
   - Implement server endpoints
   - Add conflict resolution for collaborative undo
   
5. **Bundle Detection Patterns**
   - Alt+drag duplicate = CREATE + MOVE operations
   - Multi-select move = Multiple MOVE operations
   - Align operations = Multiple MOVE operations
   - Reset operations = Multiple UPDATE operations

## Specific Bundling Patterns

### 1. Drag to Duplicate (Alt+drag)
```javascript
// Detect: CREATE followed by MOVE within 100ms on same node
if (lastOp.type === 'node_create' && 
    currentOp.type === 'node_move' &&
    currentOp.nodeId === lastOp.result.nodeId &&
    currentOp.timestamp - lastOp.timestamp < 100) {
    // Bundle as "Duplicate Node"
}
```

### 2. Multi-Node Operations
```javascript
// Detect: Multiple operations on different nodes with same timestamp
if (operations.filter(op => 
    op.timestamp === currentOp.timestamp &&
    op.type === currentOp.type
).length > 1) {
    // Bundle as single multi-node operation
}
```

### 3. Alignment Operations
```javascript
// Detect: Multiple MOVE operations from alignment manager
if (currentOp.source === 'alignment_manager') {
    // Bundle all moves as "Align Nodes"
}
```

## Benefits

1. **Immediate Response**: Local undo/redo works instantly
2. **Offline Support**: Full functionality without server connection
3. **Smart Bundling**: Complex operations treated as single actions
4. **Clean History**: No viewport/navigation clutter
5. **Future-Proof**: Ready for server history when implemented

## Migration Path

1. **Phase 1**: Implement local undo/redo with bundling (1-2 days)
2. **Phase 2**: Add server history API (3-4 days)
3. **Phase 3**: Implement collaborative undo with conflict resolution (1 week)
4. **Phase 4**: Add visual history timeline UI (optional, 3-4 days)