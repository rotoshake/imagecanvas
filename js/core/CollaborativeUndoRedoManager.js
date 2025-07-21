/**
 * CollaborativeUndoRedoManager - Undo/redo for multi-user environments
 * 
 * Design principles:
 * 1. User-specific undo - users can only undo their own operations
 * 2. Server-aware - operations are tracked with user IDs and timestamps
 * 3. Conflict handling - gracefully handles when operations can't be undone
 * 4. Visual feedback - shows whose operations are being affected
 */
class CollaborativeUndoRedoManager {
    constructor(app) {
        this.app = app;
        this.pipeline = app.operationPipeline;
        this.network = app.networkLayer;
        
        // User-specific history
        this.userId = 'default-user'; // Default user ID
        this.userHistory = new Map(); // userId -> operation history
        this.userHistory.set(this.userId, []); // Initialize default user history
        this.currentUserHistory = this.userHistory.get(this.userId);
        this.historyIndex = -1;
        
        console.log('🎯 Undo manager initialized with userId:', this.userId);
        
        // Global operation tracking
        this.globalOperations = new Map(); // operationId -> operation details
        this.operationsByNode = new Map(); // nodeId -> Set of operationIds
        
        // Configuration
        this.maxHistoryPerUser = 50;
        this.allowUndoOthers = false; // Can users undo others' operations?
        
        // Operation bundling
        this.bundleWindow = 100;
        this.pendingBundle = null;
        
        // Track what operations to exclude
        this.excludeFromHistory = new Set([
            'viewport_pan',
            'viewport_zoom', 
            'selection_change',
            'cursor_move'
        ]);
        
        // Delay interceptor setup to ensure dependencies are ready
        setTimeout(() => {
            this.setupInterceptors();
            console.log('🎯 Interceptors set up');
        }, 0);
        
        this.setupNetworkHandlers();
        console.log('🤝 CollaborativeUndoRedoManager initialized');
    }
    
    /**
     * Setup network handlers for user identification
     */
    setupNetworkHandlers() {
        if (this.network) {
            // Get user ID when connected
            this.network.on('connected', (data) => {
                this.userId = data.userId || data.sessionId;
                console.log(`👤 User ID set: ${this.userId}`);
                
                // Initialize user history if needed
                if (!this.userHistory.has(this.userId)) {
                    this.userHistory.set(this.userId, []);
                }
                this.currentUserHistory = this.userHistory.get(this.userId);
            });
            
            // Handle remote undo/redo broadcasts
            this.network.on('remote_undo', (data) => {
                this.handleRemoteUndo(data);
            });
            
            this.network.on('remote_redo', (data) => {
                this.handleRemoteRedo(data);
            });
        }
    }
    
    /**
     * Setup interceptors to capture operations WITH their results
     */
    setupInterceptors() {
        console.log('🔧 Setting up interceptors...');
        console.log('  - Pipeline exists:', !!this.pipeline);
        console.log('  - StateSyncManager exists:', !!this.app.stateSyncManager);
        
        // Store original methods
        const originalExecute = this.pipeline.execute.bind(this.pipeline);
        const originalExecuteOperation = this.app.stateSyncManager?.executeOperation?.bind(this.app.stateSyncManager);
        
        // Intercept StateSyncManager to capture commands with undo data
        if (this.app.stateSyncManager && originalExecuteOperation) {
            console.log('  ✅ Intercepting StateSyncManager.executeOperation');
            
            const undoManager = this; // Capture reference
            this.app.stateSyncManager.executeOperation = async function(command) {
                console.log('🎯 StateSyncManager interceptor triggered for:', command.type);
                
                // Execute the operation
                const result = await originalExecuteOperation.call(this, command);
                
                console.log('📥 Post-execution state:', {
                    success: result.success,
                    executed: command.executed,
                    hasUndoData: !!command.undoData,
                    origin: command.origin
                });
                
                // If successful and local, capture for undo with the executed command
                if (result.success && command.origin === 'local' && command.executed && command.undoData && undoManager.shouldTrackOperation(command)) {
                    console.log('✅ Capturing command for undo history');
                    undoManager.captureExecutedCommand(command);
                } else {
                    console.log('⏭️ Skipping capture:', {
                        success: result.success,
                        origin: command.origin,
                        executed: command.executed,
                        hasUndoData: !!command.undoData,
                        shouldTrack: undoManager.shouldTrackOperation(command)
                    });
                }
                
                return result;
            };
        } else {
            console.log('  ❌ Could not intercept StateSyncManager');
        }
        
        // Also intercept direct pipeline execution (for offline mode)
        this.pipeline.execute = async (commandOrType, params, options = {}) => {
            const result = await originalExecute(commandOrType, params, options);
            
            // For direct execution (offline mode), capture the command
            if (result.success && !options.skipHistory && !this.app.stateSyncManager?.optimisticEnabled) {
                const command = typeof commandOrType === 'string' ? 
                    this.pipeline.commandRegistry.get(commandOrType) : 
                    commandOrType;
                    
                if (command && command.origin === 'local' && this.shouldTrackOperation(command)) {
                    this.captureExecutedCommand(command);
                }
            }
            
            return result;
        };
    }
    
    /**
     * Capture an executed command with its undo data
     */
    captureExecutedCommand(command) {
        console.log('📸 captureExecutedCommand called:', {
            type: command.type,
            executed: command.executed,
            hasUndoData: !!command.undoData,
            userId: this.userId
        });
        
        if (!command.executed || !command.undoData) {
            console.warn(`⚠️ Command missing undo data:`, {
                type: command.type,
                executed: command.executed,
                hasUndoData: !!command.undoData
            });
            return;
        }
        
        // Add metadata
        command.userId = this.userId || 'local';
        command.timestamp = Date.now();
        command.operationId = command.id || `${command.userId}_${command.timestamp}`;
        
        // Store in global tracking
        this.globalOperations.set(command.operationId, {
            command,
            userId: command.userId,
            timestamp: command.timestamp,
            affectedNodes: this.extractAffectedNodes(command)
        });
        
        // Update node tracking
        const affectedNodes = this.extractAffectedNodes(command);
        affectedNodes.forEach(nodeId => {
            if (!this.operationsByNode.has(nodeId)) {
                this.operationsByNode.set(nodeId, new Set());
            }
            this.operationsByNode.get(nodeId).add(command.operationId);
        });
        
        // Add to user's history
        if (command.userId === this.userId) {
            this.addToCurrentUserHistory(command);
        }
        
        console.log(`📝 Captured operation:`, {
            type: command.type,
            userId: command.userId,
            hasUndoData: !!command.undoData,
            affectedNodes: affectedNodes.length
        });
    }
    
    /**
     * Check if operation should be tracked
     */
    shouldTrackOperation(operation) {
        return !this.excludeFromHistory.has(operation.type) && 
               operation.origin === 'local';
    }
    
    /**
     * Extract affected node IDs from a command
     */
    extractAffectedNodes(command) {
        const nodes = new Set();
        
        // From parameters
        if (command.params?.nodeId) nodes.add(command.params.nodeId);
        if (command.params?.nodeIds) command.params.nodeIds.forEach(id => nodes.add(id));
        
        // From undo data
        if (command.undoData?.nodes) {
            command.undoData.nodes.forEach(node => nodes.add(node.id));
        }
        if (command.undoData?.deletedNodes) {
            command.undoData.deletedNodes.forEach(node => nodes.add(node.id));
        }
        if (command.undoData?.createdNodes) {
            command.undoData.createdNodes.forEach(id => nodes.add(id));
        }
        
        // From results
        if (command.result?.node?.id) nodes.add(command.result.node.id);
        if (command.result?.nodes) {
            command.result.nodes.forEach(node => nodes.add(node.id));
        }
        
        return Array.from(nodes);
    }
    
    /**
     * Add operation to current user's history
     */
    addToCurrentUserHistory(operation) {
        // Handle bundling
        if (this.shouldBundle(operation)) {
            this.addToBundle(operation);
            return;
        }
        
        // Finalize any pending bundle
        this.finalizePendingBundle();
        
        // Remove future history if we're not at the end
        if (this.historyIndex < this.currentUserHistory.length - 1) {
            this.currentUserHistory = this.currentUserHistory.slice(0, this.historyIndex + 1);
        }
        
        // Add new operation
        this.currentUserHistory.push(operation);
        this.historyIndex++;
        
        // Limit history size
        if (this.currentUserHistory.length > this.maxHistoryPerUser) {
            const removed = this.currentUserHistory.shift();
            this.historyIndex--;
            
            // Clean up global tracking
            this.globalOperations.delete(removed.operationId);
        }
        
        console.log(`📚 Added to user history: ${operation.type} (index: ${this.historyIndex})`);
    }
    
    /**
     * Check if operation should be bundled
     */
    shouldBundle(operation) {
        if (!this.pendingBundle) return false;
        
        const lastOp = this.pendingBundle.operations[this.pendingBundle.operations.length - 1];
        const timeDiff = operation.timestamp - lastOp.timestamp;
        
        if (timeDiff > this.bundleWindow) return false;
        
        // Bundle patterns
        return (
            // Alt+drag: create followed by move
            (lastOp.type === 'node_create' && operation.type === 'node_move') ||
            // Multi-select operations
            (operation.type === lastOp.type && operation.source === 'multi_select') ||
            // Alignment operations
            (operation.source === 'alignment' && lastOp.source === 'alignment')
        );
    }
    
    /**
     * Undo last operation by current user
     */
    async undo() {
        console.log('🔄 Undo called:', {
            historyLength: this.currentUserHistory.length,
            historyIndex: this.historyIndex,
            userId: this.userId
        });
        
        if (this.historyIndex < 0) {
            console.log('Nothing to undo');
            return false;
        }
        
        const operation = this.currentUserHistory[this.historyIndex];
        
        // Check if operation can be undone
        const validation = this.validateUndo(operation);
        if (!validation.canUndo) {
            console.warn(`⚠️ Cannot undo: ${validation.reason}`);
            this.showUndoWarning(validation.reason);
            return false;
        }
        
        try {
            console.log(`↩️ Undoing: ${operation.type}`);
            
            const context = {
                app: this.app,
                graph: this.app.graph,
                canvas: this.app.graphCanvas
            };
            
            // Execute undo
            await operation.undo(context);
            
            // Update history index
            this.historyIndex--;
            
            // Broadcast undo if connected
            if (this.network?.isConnected) {
                this.network.emit('user_undo', {
                    operationId: operation.operationId,
                    userId: this.userId,
                    type: operation.type
                });
            }
            
            // Update canvas
            this.app.graphCanvas.dirty_canvas = true;
            
            return true;
            
        } catch (error) {
            console.error('❌ Undo failed:', error);
            this.showUndoError(error.message);
            return false;
        }
    }
    
    /**
     * Validate if an operation can be undone
     */
    validateUndo(operation) {
        // Check if nodes still exist
        const affectedNodes = this.extractAffectedNodes(operation);
        const missingNodes = [];
        
        for (const nodeId of affectedNodes) {
            if (operation.type !== 'node_delete' && !this.app.graph.getNodeById(nodeId)) {
                missingNodes.push(nodeId);
            }
        }
        
        if (missingNodes.length > 0) {
            return {
                canUndo: false,
                reason: `Nodes have been deleted by another user`
            };
        }
        
        // Check for conflicting operations
        const conflicts = this.findConflictingOperations(operation);
        if (conflicts.length > 0) {
            const otherUsers = [...new Set(conflicts.map(c => c.userId))].filter(id => id !== this.userId);
            if (otherUsers.length > 0) {
                return {
                    canUndo: false,
                    reason: `Nodes have been modified by other users`
                };
            }
        }
        
        return { canUndo: true };
    }
    
    /**
     * Find operations that conflict with undoing this operation
     */
    findConflictingOperations(operation) {
        const conflicts = [];
        const affectedNodes = this.extractAffectedNodes(operation);
        
        affectedNodes.forEach(nodeId => {
            const nodeOps = this.operationsByNode.get(nodeId) || new Set();
            nodeOps.forEach(opId => {
                const op = this.globalOperations.get(opId);
                if (op && op.timestamp > operation.timestamp) {
                    conflicts.push(op);
                }
            });
        });
        
        return conflicts;
    }
    
    /**
     * Show warning when undo cannot be performed
     */
    showUndoWarning(reason) {
        if (this.app.showNotification) {
            this.app.showNotification({
                type: 'warning',
                message: `Cannot undo: ${reason}`,
                duration: 3000
            });
        }
    }
    
    /**
     * Show error when undo fails
     */
    showUndoError(message) {
        if (this.app.showNotification) {
            this.app.showNotification({
                type: 'error',
                message: `Undo failed: ${message}`,
                duration: 3000
            });
        }
    }
    
    /**
     * Get history info for current user
     */
    getHistoryInfo() {
        return {
            userId: this.userId,
            size: this.currentUserHistory.length,
            index: this.historyIndex,
            canUndo: this.historyIndex >= 0,
            canRedo: this.historyIndex < this.currentUserHistory.length - 1,
            operations: this.currentUserHistory.map((op, i) => ({
                type: op.type,
                active: i === this.historyIndex,
                timestamp: op.timestamp,
                canUndo: this.validateUndo(op).canUndo
            }))
        };
    }
    
    /**
     * Bundle operations stub (simplified for now)
     */
    addToBundle(operation) {
        // TODO: Implement bundling
        this.addToCurrentUserHistory(operation);
    }
    
    finalizePendingBundle() {
        // TODO: Implement bundling
    }
    
    /**
     * Redo operation
     */
    async redo() {
        if (this.historyIndex >= this.currentUserHistory.length - 1) {
            console.log('Nothing to redo');
            return false;
        }
        
        this.historyIndex++;
        const operation = this.currentUserHistory[this.historyIndex];
        
        try {
            const context = {
                app: this.app,
                graph: this.app.graph,
                canvas: this.app.graphCanvas
            };
            
            await operation.execute(context);
            
            // Broadcast
            if (this.network?.isConnected) {
                this.network.emit('user_redo', {
                    operationId: operation.operationId,
                    userId: this.userId,
                    type: operation.type
                });
            }
            
            this.app.graphCanvas.dirty_canvas = true;
            return true;
            
        } catch (error) {
            console.error('❌ Redo failed:', error);
            this.historyIndex--;
            return false;
        }
    }
    
    /**
     * Handle remote undo operations
     */
    handleRemoteUndo(data) {
        // Update UI to show what was undone by whom
        console.log(`👤 User ${data.userId} undid ${data.type}`);
    }
    
    /**
     * Handle remote redo operations  
     */
    handleRemoteRedo(data) {
        // Update UI to show what was redone by whom
        console.log(`👤 User ${data.userId} redid ${data.type}`);
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.CollaborativeUndoRedoManager = CollaborativeUndoRedoManager;
}