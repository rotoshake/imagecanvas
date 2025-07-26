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
        this.bundleTimeout = null;
        
        // Track what operations to exclude
        this.excludeFromHistory = new Set([
            'viewport_pan',
            'viewport_zoom', 
            'selection_change',
            'cursor_move'
        ]);
        
        // Don't set up interceptors here - wait for explicit call from CollaborativeArchitecture
        this.interceptorsSetUp = false;
        console.log('🔧 CollaborativeUndoRedoManager created - awaiting interceptor setup');
        
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
            
            // Handle server undo/redo responses
            this.network.on('undo_executed', (data) => {
                console.log('📨 Received undo_executed event:', data);
                // Update local state if needed
                if (data.undoState) {
                    this.updateUndoRedoState(data.undoState);
                }
            });
            
            this.network.on('redo_executed', (data) => {
                console.log('📨 Received redo_executed event:', data);
                // Update local state if needed
                if (data.undoState) {
                    this.updateUndoRedoState(data.undoState);
                }
            });
            
            // Handle undo/redo failures
            this.network.on('undo_failed', (data) => {
                console.log('📨 Received undo_failed event:', data);
            });
            
            this.network.on('redo_failed', (data) => {
                console.log('📨 Received redo_failed event:', data);
            });
        }
    }
    
    /**
     * Setup interceptors to capture operations WITH their results
     */
    setupInterceptors() {
        if (this.interceptorsSetUp) {
            console.log('⚠️ Interceptors already set up - skipping');
            return;
        }
        
        console.log('🔧 Setting up interceptors...');
        console.log('  - Pipeline exists:', !!this.pipeline);
        console.log('  - StateSyncManager exists:', !!this.app.stateSyncManager);
        
        if (!this.app.stateSyncManager) {
            console.error('❌ Cannot set up interceptors - StateSyncManager not available');
            return;
        }
        
        // Store original methods
        const originalExecute = this.pipeline.execute.bind(this.pipeline);
        const originalExecuteOperation = this.app.stateSyncManager?.executeOperation?.bind(this.app.stateSyncManager);
        
        // Intercept StateSyncManager to capture commands with undo data
        if (this.app.stateSyncManager && originalExecuteOperation) {
            console.log('  ✅ Intercepting StateSyncManager.executeOperation');
            
            // Also intercept applyOptimistic to capture immediately after local execution
            const originalApplyOptimistic = this.app.stateSyncManager.applyOptimistic?.bind(this.app.stateSyncManager);
            
            if (originalApplyOptimistic) {
                const undoManager = this; // Capture reference
                
                this.app.stateSyncManager.applyOptimistic = async function(command) {
                    console.log('🎯 applyOptimistic interceptor - before execution:', {
                        type: command.type,
                        executed: command.executed,
                        hasUndoData: !!command.undoData
                    });
                    
                    // Execute locally
                    const result = await originalApplyOptimistic.call(this, command);
                    
                    console.log('🎯 applyOptimistic interceptor - after execution:', {
                        type: command.type,
                        executed: command.executed,
                        hasUndoData: !!command.undoData,
                        origin: command.origin,
                        shouldTrack: undoManager.shouldTrackOperation(command)
                    });
                    
                    // Capture immediately after local execution if successful
                    if (command.executed && command.undoData && command.origin === 'local' && undoManager.shouldTrackOperation(command)) {
                        console.log('✅ Capturing command immediately after local execution');
                        undoManager.captureExecutedCommand(command);
                    } else {
                        console.log('⏭️ Not capturing:', {
                            executed: command.executed,
                            hasUndoData: !!command.undoData,
                            origin: command.origin,
                            shouldTrack: undoManager.shouldTrackOperation(command)
                        });
                    }
                    
                    return result;
                };
            }
            
            const undoManager = this; // Capture reference
            this.app.stateSyncManager.executeOperation = async function(command) {
                console.log('🎯 StateSyncManager interceptor triggered for:', command.type);
                
                // Execute the operation
                const result = await originalExecuteOperation.call(this, command);
                
                // For non-optimistic mode, capture here
                if (!this.optimisticEnabled && result.success && command.origin === 'local' && command.executed && command.undoData && undoManager.shouldTrackOperation(command)) {
                    console.log('✅ Capturing command for undo history (non-optimistic mode)');
                    undoManager.captureExecutedCommand(command);
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
        
        // Mark interceptors as set up
        this.interceptorsSetUp = true;
        console.log('✅ Interceptors successfully set up');
    }
    
    /**
     * Capture an executed command with its undo data
     */
    captureExecutedCommand(command) {
        console.log('📸 captureExecutedCommand called:', {
            type: command.type,
            executed: command.executed,
            hasUndoData: !!command.undoData,
            userId: this.userId,
            isConnected: !!this.network?.isConnected,
            hasStateSyncManager: !!this.app.stateSyncManager
        });
        
        // CRITICAL FIX: Skip recording if we're in server-connected mode
        // This prevents double recording - operations are already recorded on server
        if (this.network?.isConnected && this.app.stateSyncManager) {
            console.log('🔄 Skipping client-side recording - using server-authoritative undo');
            return;
        }
        
        if (!command.executed || !command.undoData) {
            console.warn(`⚠️ Command missing undo data:`, {
                type: command.type,
                executed: command.executed,
                hasUndoData: !!command.undoData
            });
            return;
        }
        
        // Only record for offline mode
        console.log('📝 Recording operation in offline mode');
        
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
        
        console.log(`📝 Captured operation for offline undo:`, {
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
        // Check if this operation should start or continue bundling
        const shouldStartBundle = this.shouldStartBundle(operation);
        const shouldContinueBundle = this.shouldBundle(operation);
        
        if (shouldStartBundle || shouldContinueBundle) {
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
     * Check if operation should start a new bundle
     */
    shouldStartBundle(operation) {
        // Operations that should start bundling
        const bundlingSources = ['group_rotation', 'alignment', 'multi_select', 'grid_align', 'multi_scale', 'multi_select_rotation', 'multi_select_reset'];
        return !this.pendingBundle && operation.source && bundlingSources.includes(operation.source);
    }
    
    /**
     * Check if operation should be bundled with existing bundle
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
            // Multi-select operations with same source
            (operation.source && operation.source === lastOp.source) ||
            // Legacy patterns
            (operation.type === lastOp.type && operation.source === 'multi_select')
        );
    }
    
    /**
     * Undo last operation by current user
     */
    async undo() {
        console.log('🔄 Undo called:', {
            historyLength: this.currentUserHistory.length,
            historyIndex: this.historyIndex,
            userId: this.userId,
            isConnected: !!this.network?.isConnected
        });
        
        // CRITICAL FIX: Route through server when connected
        if (this.network?.isConnected && this.app.stateSyncManager) {
            console.log('🔄 Using server-authoritative undo');
            
            // Send undo request to server
            return new Promise((resolve, reject) => {
                // Set up timeout
                const timeout = setTimeout(() => {
                    console.error('❌ Server undo timeout');
                    this.showUndoError('Server response timeout');
                    resolve(false);
                }, 5000);
                
                // Set up response handlers
                const cleanup = () => {
                    clearTimeout(timeout);
                    this.network.off('undo_executed', successHandler);
                    this.network.off('undo_failed', failHandler);
                };
                
                const successHandler = (data) => {
                    cleanup();
                    console.log('✅ Server undo successful:', data);
                    // Server will handle state updates via state_update event
                    resolve(true);
                };
                
                const failHandler = (data) => {
                    cleanup();
                    console.log('❌ Server undo failed:', data);
                    this.showUndoWarning(data.reason || 'Unable to undo');
                    resolve(false);
                };
                
                this.network.once('undo_executed', successHandler);
                this.network.once('undo_failed', failHandler);
                
                // Send undo request
                console.log('📤 Sending undo request to server');
                this.network.emit('undo_operation', {
                    userId: this.userId,
                    projectId: this.app.projectId || this.network.currentProject?.id
                });
            });
        }
        
        // Fallback to client-side undo for offline mode
        console.log('📱 Using offline client-side undo');
        
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
            console.log(`↩️ Undoing offline: ${operation.type}`);
            
            const context = {
                app: this.app,
                graph: this.app.graph,
                canvas: this.app.graphCanvas
            };
            
            // Execute undo
            await operation.undo(context);
            
            // Update history index
            this.historyIndex--;
            
            // Update canvas
            this.app.graphCanvas.dirty_canvas = true;
            
            return true;
            
        } catch (error) {
            console.error('❌ Offline undo failed:', error);
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
     * Add operation to bundle
     */
    addToBundle(operation) {
        if (!this.pendingBundle) {
            // Start new bundle
            this.pendingBundle = {
                operations: [operation],
                timestamp: operation.timestamp,
                type: 'bundle'
            };
        } else {
            // Add to existing bundle
            this.pendingBundle.operations.push(operation);
        }
        
        // Set timeout to finalize bundle
        if (this.bundleTimeout) {
            clearTimeout(this.bundleTimeout);
        }
        this.bundleTimeout = setTimeout(() => {
            this.finalizePendingBundle();
        }, this.bundleWindow);
    }
    
    finalizePendingBundle() {
        if (!this.pendingBundle) return;
        
        if (this.bundleTimeout) {
            clearTimeout(this.bundleTimeout);
            this.bundleTimeout = null;
        }
        
        // Create bundled command
        const bundle = this.pendingBundle;
        this.pendingBundle = null;
        
        if (bundle.operations.length === 1) {
            // Single operation, no bundling needed
            this.addToCurrentUserHistory(bundle.operations[0]);
        } else {
            // Create composite command
            const bundledCommand = {
                type: 'bundled_operations',
                operations: bundle.operations,
                timestamp: bundle.timestamp,
                userId: this.userId,
                operationId: `bundle_${this.userId}_${bundle.timestamp}`,
                executed: true,
                undoData: { operations: bundle.operations },
                
                // Composite undo function
                undo: async (context) => {
                    // Undo in reverse order
                    for (let i = bundle.operations.length - 1; i >= 0; i--) {
                        const op = bundle.operations[i];
                        if (op.undo) {
                            await op.undo(context);
                        }
                    }
                    return { success: true };
                },
                
                // Composite redo function
                execute: async (context) => {
                    // Execute in order
                    for (const op of bundle.operations) {
                        if (op.execute) {
                            await op.execute(context);
                        }
                    }
                    return { success: true };
                }
            };
            
            this.addToCurrentUserHistory(bundledCommand);
        }
    }
    
    /**
     * Redo operation
     */
    async redo() {
        console.log('🔄 Redo called:', {
            historyLength: this.currentUserHistory.length,
            historyIndex: this.historyIndex,
            userId: this.userId,
            isConnected: !!this.network?.isConnected
        });
        
        // CRITICAL FIX: Route through server when connected
        if (this.network?.isConnected && this.app.stateSyncManager) {
            console.log('🔄 Using server-authoritative redo');
            
            // Send redo request to server
            return new Promise((resolve, reject) => {
                // Set up timeout
                const timeout = setTimeout(() => {
                    console.error('❌ Server redo timeout');
                    this.showUndoError('Server response timeout');
                    resolve(false);
                }, 5000);
                
                // Set up response handlers
                const cleanup = () => {
                    clearTimeout(timeout);
                    this.network.off('redo_executed', successHandler);
                    this.network.off('redo_failed', failHandler);
                };
                
                const successHandler = (data) => {
                    cleanup();
                    console.log('✅ Server redo successful:', data);
                    // Server will handle state updates via state_update event
                    resolve(true);
                };
                
                const failHandler = (data) => {
                    cleanup();
                    console.log('❌ Server redo failed:', data);
                    this.showUndoWarning(data.reason || 'Unable to redo');
                    resolve(false);
                };
                
                this.network.once('redo_executed', successHandler);
                this.network.once('redo_failed', failHandler);
                
                // Send redo request
                console.log('📤 Sending redo request to server');
                this.network.emit('redo_operation', {
                    userId: this.userId,
                    projectId: this.app.projectId || this.network.currentProject?.id
                });
            });
        }
        
        // Fallback to client-side redo for offline mode
        console.log('📱 Using offline client-side redo');
        
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
    
    /**
     * Update local undo/redo state from server
     */
    updateUndoRedoState(undoState) {
        console.log('📊 Updating undo/redo state from server:', undoState);
        
        // Update UI indicators
        if (this.app.updateUndoRedoButtons) {
            this.app.updateUndoRedoButtons({
                canUndo: undoState.canUndo,
                canRedo: undoState.canRedo
            });
        }
        
        // Store server state for reference
        this.serverUndoState = undoState;
    }
    
    /**
     * Verify undo system is properly set up
     */
    verifySetup() {
        const issues = [];
        
        if (!this.interceptorsSetUp) {
            issues.push('Interceptors not set up');
        }
        
        if (!this.app.stateSyncManager) {
            issues.push('StateSyncManager not available');
        }
        
        if (!this.pipeline) {
            issues.push('OperationPipeline not available');
        }
        
        if (!this.userId && this.network?.connected) {
            issues.push('User ID not set despite being connected');
        }
        
        if (issues.length > 0) {
            console.error('❌ Undo system issues:', issues);
            return false;
        }
        
        console.log('✅ Undo system verified and working');
        console.log(`  - History: ${this.history.length} operations`);
        console.log(`  - User ID: ${this.userId || 'local'}`);
        console.log(`  - Can undo: ${this.canUndo()}`);
        console.log(`  - Can redo: ${this.canRedo()}`);
        return true;
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.CollaborativeUndoRedoManager = CollaborativeUndoRedoManager;
}