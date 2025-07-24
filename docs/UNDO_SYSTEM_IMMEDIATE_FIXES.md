# Undo System Immediate Fixes & Implementation Plan

## Overview

While the comprehensive redesign is the long-term solution, we can implement several immediate fixes to improve the current undo system's reliability. This document outlines practical fixes that can be implemented quickly.

## Immediate Fixes (1-2 days)

### 1. Fix Operation Capture Reliability

**Problem**: Operations are captured inconsistently due to race conditions in interceptor setup.

**Solution**:
```javascript
// In CollaborativeUndoRedoManager.js
class CollaborativeUndoRedoManager {
    constructor(app) {
        // ... existing code ...
        
        // Add operation queue for operations that arrive before setup
        this.pendingOperations = [];
        this.isReady = false;
    }
    
    setupInterceptors() {
        if (this.interceptorsSetUp) return;
        
        // Ensure we have all dependencies
        if (!this.app.stateSyncManager || !this.pipeline) {
            console.error('❌ Cannot setup interceptors - missing dependencies');
            // Retry after a delay
            setTimeout(() => this.setupInterceptors(), 100);
            return;
        }
        
        // Setup interceptors...
        this.interceptorsSetUp = true;
        this.isReady = true;
        
        // Process any pending operations
        this.pendingOperations.forEach(op => this.captureExecutedCommand(op));
        this.pendingOperations = [];
    }
    
    captureExecutedCommand(command) {
        if (!this.isReady) {
            this.pendingOperations.push(command);
            return;
        }
        // ... existing capture logic ...
    }
}
```

### 2. Improve Bundling for Bulk Operations

**Problem**: Bulk operations create multiple history entries.

**Solution**:
```javascript
// In CollaborativeUndoRedoManager.js
shouldStartBundle(operation) {
    return (
        operation.source?.includes('bulk_') ||
        operation.source?.includes('group_') ||
        operation.source?.includes('multi_') ||
        operation._bulkOperationId || // New: detect bulk operations
        operation.params?._bulkOperationId
    );
}

// Extend bundle window for bulk operations
addToBundle(operation) {
    // ... existing code ...
    
    // Extend timeout for bulk operations
    const timeout = operation._bulkOperationId ? 1000 : this.bundleWindow;
    
    if (this.bundleTimeout) {
        clearTimeout(this.bundleTimeout);
    }
    this.bundleTimeout = setTimeout(() => {
        this.finalizePendingBundle();
    }, timeout);
}
```

### 3. Add Operation Verification

**Problem**: No verification that operations were captured.

**Solution**:
```javascript
// Add to OperationPipeline.js
async execute(commandOrType, params, options = {}) {
    // ... existing code ...
    
    // After execution, verify capture
    if (command.origin === 'local' && window.app?.undoRedoManager) {
        // Give undo manager time to capture
        setTimeout(() => {
            const manager = window.app.undoRedoManager;
            const history = manager.currentUserHistory || manager.history || [];
            const found = history.some(h => 
                h.operationId === command.id || 
                h.operations?.some(op => op.operationId === command.id)
            );
            
            if (!found && manager.shouldTrackOperation(command)) {
                console.warn('⚠️ Operation not captured in undo history:', command.type);
                // Force capture
                manager.captureExecutedCommand(command);
            }
        }, 200);
    }
    
    return result;
}
```

### 4. Fix User ID Tracking

**Problem**: User ID is lost or conflated with tab ID.

**Solution**:
```javascript
// In NetworkLayer.js
handleConnect(data) {
    this.connected = true;
    this.tabId = data.tabId;
    
    // Properly separate user ID from tab ID
    this.userId = data.userId || data.sessionId || this.generateUserId();
    this.sessionId = data.sessionId;
    
    // Store in localStorage for persistence
    if (this.userId && !data.userId) {
        localStorage.setItem('imagecanvas_userId', this.userId);
    }
    
    // Emit with clear separation
    this.emit('connected', {
        tabId: this.tabId,
        userId: this.userId,
        sessionId: this.sessionId
    });
}

// In CollaborativeUndoRedoManager.js
setupNetworkHandlers() {
    if (this.network) {
        this.network.on('connected', (data) => {
            // Use userId, not tabId
            this.userId = data.userId;
            console.log(`👤 User ID set: ${this.userId}`);
            
            // Initialize user history if needed
            if (!this.userHistory.has(this.userId)) {
                this.userHistory.set(this.userId, []);
            }
            this.currentUserHistory = this.userHistory.get(this.userId);
        });
    }
}
```

### 5. Add Bulk Operation Handling

**Problem**: Bulk operations aren't treated as single undo units.

**Solution**: Update BulkCommand to properly integrate with undo system:

```javascript
// In BulkCommand.js
async execute(context) {
    // Mark start of bulk operation
    if (window.app?.undoRedoManager) {
        window.app.undoRedoManager.beginBundle('bulk_operation');
    }
    
    // ... existing execution logic ...
    
    // Mark end of bulk operation
    if (window.app?.undoRedoManager) {
        setTimeout(() => {
            window.app.undoRedoManager.finalizePendingBundle();
        }, 100);
    }
    
    return result;
}
```

## Medium-term Fixes (1 week)

### 1. Add Server-Side Operation History

Create a simple operation log on the server:

```javascript
// In server/src/realtime/CanvasStateManager.js
class CanvasStateManager {
    constructor() {
        // ... existing code ...
        this.operationHistory = [];
        this.maxHistorySize = 1000;
    }
    
    applyOperation(operation, userId, connectionId) {
        // ... existing validation ...
        
        // Record operation
        const historyEntry = {
            id: operation.operationId,
            type: operation.type,
            userId: userId,
            connectionId: connectionId,
            timestamp: Date.now(),
            params: operation.params
        };
        
        this.operationHistory.push(historyEntry);
        if (this.operationHistory.length > this.maxHistorySize) {
            this.operationHistory.shift();
        }
        
        // ... apply operation ...
    }
    
    // New: Get user's recent operations
    getUserOperations(userId, limit = 50) {
        return this.operationHistory
            .filter(op => op.userId === userId)
            .slice(-limit);
    }
}
```

### 2. Add Cross-Tab Undo Sync

Broadcast undo state changes:

```javascript
// In CollaborativeUndoRedoManager.js
undo() {
    // ... perform undo ...
    
    // Broadcast to other tabs
    if (this.network) {
        this.network.emit('user_undo', {
            userId: this.userId,
            undoneOperation: operation.id,
            affectedNodes: this.extractAffectedNodes(operation)
        });
    }
}

// Listen for remote undos
setupNetworkHandlers() {
    // ... existing handlers ...
    
    this.network.on('user_undo', (data) => {
        if (data.userId === this.userId) {
            // Sync our undo state
            this.syncUndoState(data);
        } else {
            // Show indicator
            this.showRemoteUndoIndicator(data);
        }
    });
}
```

### 3. Add Transaction Support

Implement basic transaction grouping:

```javascript
// In OperationPipeline.js
beginTransaction(source) {
    this.currentTransaction = {
        id: `txn_${Date.now()}`,
        source: source,
        operations: []
    };
    
    // Notify undo manager
    if (window.app?.undoRedoManager?.beginBundle) {
        window.app.undoRedoManager.beginBundle(source);
    }
}

commitTransaction() {
    if (!this.currentTransaction) return;
    
    // Send transaction to server
    if (this.currentTransaction.operations.length > 0) {
        this.network?.emit('transaction_complete', {
            transactionId: this.currentTransaction.id,
            operations: this.currentTransaction.operations
        });
    }
    
    this.currentTransaction = null;
    
    // Notify undo manager
    if (window.app?.undoRedoManager?.finalizePendingBundle) {
        window.app.undoRedoManager.finalizePendingBundle();
    }
}
```

## Testing Checklist

### Basic Functionality
- [ ] Single operation undo/redo
- [ ] Bulk operation (100+ nodes) undo as single action
- [ ] Multi-select operations bundle correctly
- [ ] Undo only affects current user's operations

### Multi-User Scenarios  
- [ ] User A and B make changes, each can only undo their own
- [ ] Undo indicators show when other users undo
- [ ] No conflicts when users undo simultaneously

### Cross-Tab Sync
- [ ] Undo in tab 1 reflects in tab 2
- [ ] History stays synchronized across tabs
- [ ] No duplicate operations in history

### Robustness
- [ ] No orphaned nodes after undo
- [ ] Server state stays consistent
- [ ] Network disconnection doesn't break undo
- [ ] Large operations don't timeout

## Implementation Priority

1. **Day 1**: 
   - Fix operation capture reliability
   - Improve bundling for bulk operations
   - Add operation verification

2. **Day 2**:
   - Fix user ID tracking
   - Update BulkCommand integration
   - Test multi-user scenarios

3. **Week 1**:
   - Add server-side operation history
   - Implement cross-tab sync
   - Add transaction support

4. **Ongoing**:
   - Monitor for issues
   - Gather user feedback
   - Plan full architectural redesign

## Success Metrics

- Bulk operations (100+ nodes) undo with single Ctrl+Z
- User can only undo their own operations in multi-user sessions
- No orphaned nodes after undo operations
- Cross-tab undo synchronization works reliably
- Bundled operations (like alignment) undo as one unit

## Next Steps

1. Implement immediate fixes
2. Test thoroughly with multiple users
3. Monitor production for issues
4. Begin planning full architectural redesign
5. Create migration strategy from current to new system