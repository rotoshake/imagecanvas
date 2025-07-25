# ImageCanvas Undo/Redo System

## Overview

The ImageCanvas undo/redo system is a server-authoritative, multi-user aware system that provides robust undo/redo functionality in a collaborative environment. It handles complex scenarios including multi-tab synchronization, transaction grouping, and conflict detection.

## Architecture

### Core Components

#### Client-Side

**ClientUndoManager** (`/js/core/ClientUndoManager.js`)
- Coordinates undo/redo requests between client and server
- Manages optimistic UI updates with rollback capability
- Handles cross-tab synchronization
- Provides visual feedback during undo/redo operations

**TransactionManager** (`/js/core/TransactionManager.js`)
- Groups related operations into atomic transactions
- Manages transaction lifecycle (begin, commit, abort)
- Integrates with operation pipeline for seamless batching
- Prevents partial state updates

#### Server-Side

**OperationHistory** (`/server/src/undo/OperationHistory.js`)
- Maintains authoritative operation history per project
- Stores complete undo/redo stacks with metadata
- Handles transaction grouping and atomicity
- Provides conflict detection for multi-user scenarios

**UndoStateSync** (`/server/src/undo/UndoStateSync.js`)
- Synchronizes undo state across all connected clients
- Broadcasts undo/redo state changes
- Manages cross-tab consistency
- Provides real-time updates for collaborative undo

## How It Works

### Operation Flow

1. **User Action**: User performs an action (e.g., move node)
2. **Operation Creation**: Action creates an operation with undo data
3. **Transaction Context**: Operation may be part of a transaction
4. **Server Execution**: Operation sent to server for validation
5. **History Recording**: Server records operation in history
6. **State Broadcast**: All clients receive state update
7. **UI Update**: Undo/redo buttons update based on new state

### Undo Flow

```javascript
// Client initiates undo
ClientUndoManager.undo()
  ↓
// Request sent to server
socket.emit('undo_operation', { projectId })
  ↓
// Server processes undo
OperationHistory.undo(projectId)
  ↓
// Server broadcasts result
socket.emit('undo_success', { undoneOperations, stateUpdate })
  ↓
// All clients update state
StateSyncManager.processStateUpdate(stateUpdate)
```

### Transaction Example

```javascript
// Begin transaction for bulk move
window.transactionManager.beginTransaction('bulk_move');

// Perform multiple operations
for (const node of selectedNodes) {
    nodeCommand.execute({
        nodeId: node.id,
        params: { pos: newPosition }
    });
}

// Commit as single undoable unit
window.transactionManager.commitTransaction();
```

## Key Features

### Multi-User Conflict Detection

The system detects when an undo operation would conflict with another user's changes:

```javascript
// Server checks for conflicts
if (hasConflictingOperations(operationToUndo, otherUserOperations)) {
    return {
        success: false,
        error: 'UNDO_CONFLICT',
        conflictingUser: otherUser.displayName
    };
}
```

### Cross-Tab Synchronization

All tabs for the same user share undo state:

- Undo in one tab affects all tabs
- Redo stack synchronized across tabs
- Visual indicators show cross-tab operations

### Optimistic Updates

For better performance, the client optimistically applies undo/redo:

1. Client immediately updates UI
2. Shows pending state indicator
3. Waits for server confirmation
4. Rolls back if server rejects

### Transaction Support

Related operations can be grouped:

- **Bulk Operations**: Moving multiple nodes
- **Complex Edits**: Multi-step transformations
- **Compound Actions**: Create + configure sequences

## API Reference

### Client API

```javascript
// Undo last operation
window.clientUndoManager.undo();

// Redo last undone operation
window.clientUndoManager.redo();

// Check undo/redo availability
const canUndo = window.clientUndoManager.canUndo();
const canRedo = window.clientUndoManager.canRedo();

// Begin transaction
window.transactionManager.beginTransaction('operation_type');

// Commit transaction
window.transactionManager.commitTransaction();

// Abort transaction
window.transactionManager.abortTransaction();
```

### WebSocket Events

**Client → Server:**
- `undo_operation` - Request undo
- `redo_operation` - Request redo
- `request_undo_state` - Get current state
- `clear_undo_history` - Clear all history

**Server → Client:**
- `undo_state_update` - State changed
- `undo_success` - Undo completed
- `redo_success` - Redo completed
- `undo_error` - Operation failed

### Operation Structure

```javascript
{
    operationId: 'op-123',
    type: 'node_move',
    params: { nodeId: 'node-1', pos: [100, 200] },
    undoData: {
        nodeId: 'node-1',
        previousPos: [50, 100]
    },
    timestamp: 1234567890,
    userId: 'user-1',
    transactionId: 'txn-456' // Optional
}
```

## Best Practices

### 1. Always Include Undo Data

```javascript
// Good - includes undo data
const operation = {
    type: 'node_move',
    params: { nodeId, pos: newPos },
    undoData: { nodeId, previousPos: oldPos }
};

// Bad - no undo data
const operation = {
    type: 'node_move',
    params: { nodeId, pos: newPos }
};
```

### 2. Use Transactions for Related Operations

```javascript
// Good - atomic undo for bulk operation
transactionManager.beginTransaction('bulk_delete');
selectedNodes.forEach(node => deleteNode(node));
transactionManager.commitTransaction();

// Bad - individual undos required
selectedNodes.forEach(node => deleteNode(node));
```

### 3. Handle Undo Conflicts Gracefully

```javascript
socket.on('undo_error', (data) => {
    if (data.error === 'UNDO_CONFLICT') {
        window.unifiedNotifications.show({
            type: 'warning',
            title: 'Undo Blocked',
            message: `Cannot undo - conflicts with ${data.conflictingUser}'s changes`,
            persistent: false
        });
    }
});
```

## Limitations

1. **History Limit**: Server maintains last 1000 operations per project
2. **Transaction Size**: Maximum 100 operations per transaction
3. **Conflict Window**: Operations within 30 seconds may conflict
4. **Memory Usage**: Large operations increase server memory

## Troubleshooting

### Undo Not Working

1. Check console for errors
2. Verify WebSocket connection
3. Ensure operation includes undo data
4. Check for conflicting user operations

### Transaction Issues

1. Ensure begin/commit are paired
2. Check for nested transactions (not supported)
3. Verify all operations succeed
4. Monitor transaction timeout (30 seconds)

### Performance Problems

1. Reduce operation size
2. Use transactions for bulk operations
3. Implement operation debouncing
4. Monitor server memory usage