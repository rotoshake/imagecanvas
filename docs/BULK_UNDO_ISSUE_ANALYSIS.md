# Bulk Operation Undo Issue Analysis

## Problem Summary
When performing bulk operations (paste/duplicate) with ~100 nodes, only approximately 12 nodes are affected by undo operations, leaving the remaining nodes unchanged.

## Root Cause Analysis

### 1. Chunking in BulkOperationManager
The `BulkOperationManager` splits large operations into chunks to avoid overwhelming the server:

```javascript
// From BulkOperationManager.js
this.CHUNK_SIZES = {
    'node_paste': 50,     
    'node_duplicate': 50, 
    'node_move': 30,      
    'node_delete': 100,   
    'default': 20         
};
```

When pasting 100 nodes with a chunk size of 50, the operation is split into 2 chunks.

### 2. Command Undo Data Storage
Each command (PasteNodesCommand, DuplicateNodesCommand) stores undo data in its `undoData` property:

```javascript
// From NodeCommandsExtended.js - PasteNodesCommand
this.undoData = { createdNodes: [] };
// ...
for (const data of nodeData) {
    const node = this.createNodeFromData(data, context);
    if (node) {
        // ...
        this.undoData.createdNodes.push(node.id);
    }
}
```

### 3. The Critical Issue: Multiple Command Instances
When `BulkOperationManager.executeBulkOperation` processes chunks, it creates **separate command instances** for each chunk:

```javascript
// From BulkOperationManager.js - executeChunkWithRetry
const result = await window.app.operationPipeline.execute(operationType, {
    ...options,
    nodeData: operationType === 'node_paste' ? chunk.items : undefined,
    nodeIds: operationType === 'node_duplicate' ? chunk.items : undefined
});
```

This means:
- Chunk 1 (nodes 1-50): Creates `PasteNodesCommand` instance #1 with its own `undoData`
- Chunk 2 (nodes 51-100): Creates `PasteNodesCommand` instance #2 with its own `undoData`

### 4. Undo Manager Only Captures One Command
The `CollaborativeUndoRedoManager` captures commands after execution:

```javascript
// From CollaborativeUndoRedoManager.js
captureExecutedCommand(command) {
    // Adds single command to history
    this.addToCurrentUserHistory(command);
}
```

**The problem**: Only the last chunk's command is captured in the undo history because:
1. Each chunk creates a new command instance
2. The undo manager only sees individual commands, not the bulk operation as a whole
3. There's no mechanism to bundle chunk commands into a single undoable operation

### 5. Why ~12 Nodes?
The "~12 nodes" behavior could be explained by:
1. **Bundling Window**: The undo manager has a 100ms bundling window
2. **Chunk Processing Speed**: If chunks process faster than the bundling window, they might not bundle
3. **Default Chunk Size**: The default chunk size is 20, which is close to 12

## Evidence from Code

### No Bulk Operation Bundling
The `CollaborativeUndoRedoManager` has bundling logic, but it only bundles based on:
- Time proximity (100ms window)
- Specific operation sources (group_rotation, alignment, etc.)
- NOT bulk operations from BulkOperationManager

```javascript
shouldStartBundle(operation) {
    const bundlingSources = ['group_rotation', 'alignment', 'multi_select', 
                           'grid_align', 'multi_scale', 'multi_select_rotation', 
                           'multi_select_reset'];
    return !this.pendingBundle && operation.source && bundlingSources.includes(operation.source);
}
```

### Missing Bulk Operation Tracking
The bulk operation doesn't pass any identifier that would allow the undo manager to recognize related chunks:

```javascript
// BulkOperationManager generates operationId but doesn't pass it to commands
const operationId = this.generateOperationId();
// This ID is not propagated to the actual commands
```

## Solution Recommendations

### 1. Pass Bulk Operation Context
Modify `BulkOperationManager` to pass bulk operation context to commands:

```javascript
const result = await window.app.operationPipeline.execute(operationType, {
    ...options,
    bulkOperationId: operationId,
    chunkIndex: i,
    totalChunks: chunks.length,
    nodeData: chunk.items
});
```

### 2. Create Composite Command
Implement a composite command pattern for bulk operations:

```javascript
class BulkOperationCommand extends Command {
    constructor(operationId, chunks) {
        super('bulk_operation');
        this.operationId = operationId;
        this.subCommands = [];
    }
    
    addChunkCommand(command) {
        this.subCommands.push(command);
    }
    
    async undo(context) {
        // Undo all sub-commands
        for (const cmd of this.subCommands.reverse()) {
            await cmd.undo(context);
        }
    }
}
```

### 3. Modify Undo Manager Bundling
Update `CollaborativeUndoRedoManager` to recognize bulk operations:

```javascript
shouldBundle(operation) {
    // Check for bulk operation context
    if (operation.params?.bulkOperationId) {
        return true;
    }
    // ... existing logic
}
```

### 4. Alternative: Single Command for All Chunks
Instead of creating separate commands per chunk, accumulate all results in a single command:

```javascript
// In BulkOperationManager
const bulkCommand = new PasteNodesCommand({
    nodeData: allNodeData,
    targetPosition: params.targetPosition
}, 'local');

// Process chunks but accumulate results in single command
for (const chunk of chunks) {
    // Process chunk and add results to bulkCommand.undoData
}

// Register single command with undo manager
```

## Immediate Workaround
Until a proper fix is implemented, consider:
1. Increasing chunk sizes for paste/duplicate operations to reduce the number of chunks
2. Implementing a post-operation cleanup that combines chunk results
3. Warning users about the limitation when pasting large numbers of nodes