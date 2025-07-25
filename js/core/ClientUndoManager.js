/**
 * ClientUndoManager - Client-side undo/redo manager for server-authoritative system
 * 
 * This replaces CollaborativeUndoRedoManager with a cleaner architecture:
 * 1. Server maintains the authoritative undo history
 * 2. Client sends undo/redo requests to server
 * 3. Server validates and executes undo/redo operations
 * 4. All user sessions receive synchronized undo state
 * 5. Supports transactional bundles for multi-operation commands
 */
class ClientUndoManager {
    constructor(app) {
        this.app = app;
        this.networkLayer = app.networkLayer;
        this.userId = null;
        this.projectId = null;
        
        // Local view of undo/redo state from server
        this.undoState = {
            canUndo: false,
            canRedo: false,
            undoCount: 0,
            redoCount: 0,
            nextUndo: null,
            nextRedo: null
        };
        
        // Transaction context
        this.currentTransaction = null;
        
        // Pending operations (for optimistic UI)
        this.pendingUndoRedo = null;
        
        // Track last operation time to prevent premature undo requests
        this.lastOperationTime = 0;
        
        // Setup network handlers
        this.setupNetworkHandlers();
        
        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();
        
        // Flag to indicate we're handling keyboard shortcuts
        this.keyboardShortcutsEnabled = true;
        
        console.log('🎯 ClientUndoManager initialized');
    }
    
    /**
     * Setup network event handlers
     */
    setupNetworkHandlers() {
        if (!this.networkLayer) return;
        
        // User identification
        this.networkLayer.on('connected', (data) => {
            const oldUserId = this.userId;
            this.userId = data.userId || data.sessionId;
            console.log(`👤 Undo manager user ID set: ${this.userId} (was: ${oldUserId})`);
            console.log('📊 Connected data:', data);
            
            // Request initial undo state after a short delay to ensure server is ready
            setTimeout(() => {
                console.log('📋 Requesting initial undo state after connection');
                this.requestUndoState();
            }, 100);
        });
        
        this.networkLayer.on('project_joined', (data) => {
            console.log('📁 Project joined event received:', data);
            const oldUserId = this.userId;
            const oldProjectId = this.projectId;
            
            if (data.session) {
                this.userId = data.session.userId;
                this.projectId = data.project?.id || data.projectId;
            } else if (data.userId) {
                this.userId = data.userId;
                this.projectId = data.project?.id || data.projectId;
            }
            
            // Ensure we have the correct project ID from the server response
            if (data.project && data.project.id) {
                this.projectId = data.project.id;
            }
            
            console.log(`📁 Joined project ${this.projectId}, user ID: ${this.userId} (was: ${oldUserId}, project was: ${oldProjectId})`);
            console.log('📊 Full session data:', data.session);
            console.log('📊 Full project data:', data.project);
            
            // Request undo state for the project after a short delay
            setTimeout(() => {
                console.log(`📋 Requesting undo state for project ${this.projectId}, user ${this.userId}`);
                this.requestUndoState();
            }, 100);
        });
        
        // Undo state updates
        this.networkLayer.on('undo_state_update', (data) => {
            console.log('📨 Received undo state update:', data);
            this.updateUndoState(data.undoState);
        });
        
        // Undo/redo results
        this.networkLayer.on('undo_success', (data) => {
            this.handleUndoSuccess(data);
        });
        
        this.networkLayer.on('undo_failed', (data) => {
            this.handleUndoFailed(data);
        });
        
        this.networkLayer.on('redo_success', (data) => {
            this.handleRedoSuccess(data);
        });
        
        this.networkLayer.on('redo_failed', (data) => {
            this.handleRedoFailed(data);
        });
        
        // Cross-tab synchronization
        this.networkLayer.on('undo_executed', (data) => {
            this.handleCrossTabUndo(data);
        });
        
        this.networkLayer.on('redo_executed', (data) => {
            this.handleCrossTabRedo(data);
        });
        
        // Remote user undo/redo notifications
        this.networkLayer.on('remote_undo', (data) => {
            this.handleRemoteUndo(data);
        });
        
        this.networkLayer.on('remote_redo', (data) => {
            this.handleRemoteRedo(data);
        });
        
        // Transaction responses
        this.networkLayer.on('transaction_started', (data) => {
            if (this.currentTransaction) {
                this.currentTransaction.id = data.transactionId;
            }
        });
        
        this.networkLayer.on('transaction_committed', (data) => {
            console.log(`✅ Transaction committed: ${data.transactionId} (${data.operationCount} operations)`);
            this.currentTransaction = null;
        });
        
        this.networkLayer.on('transaction_aborted', (data) => {
            console.log(`❌ Transaction aborted: ${data.transactionId}`);
            this.currentTransaction = null;
        });
    }
    
    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Cmd/Ctrl + Z for undo
            if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.undo();
            }
            
            // Cmd/Ctrl + Shift + Z for redo
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') {
                e.preventDefault();
                this.redo();
            }
            
            // Cmd/Ctrl + Y for redo (Windows style)
            if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
                e.preventDefault();
                this.redo();
            }
        });
    }
    
    /**
     * Request current undo state from server
     */
    requestUndoState() {
        if (!this.networkLayer || !this.networkLayer.isConnected) {
            console.log('❌ Cannot request undo state - not connected');
            return;
        }
        
        console.log(`📤 Requesting undo state from server for user ${this.userId}, project ${this.projectId}`);
        this.networkLayer.emit('request_undo_state', {
            userId: this.userId,
            projectId: this.projectId
        });
    }
    
    /**
     * Update local undo state
     */
    updateUndoState(undoState) {
        const previousState = { ...this.undoState };
        this.undoState = undoState;
        
        console.log('📊 Undo state updated:', {
            previous: previousState,
            current: this.undoState,
            changes: {
                canUndo: previousState.canUndo !== this.undoState.canUndo,
                canRedo: previousState.canRedo !== this.undoState.canRedo,
                undoCount: previousState.undoCount !== this.undoState.undoCount,
                redoCount: previousState.redoCount !== this.undoState.redoCount
            }
        });
        
        // Update UI
        this.updateUndoRedoUI();
        
        // Emit event for other components
        if (this.app.events) {
            this.app.events.emit('undo_state_changed', undoState);
        }
    }
    
    /**
     * Perform undo operation
     */
    async undo() {
        console.log('⏪ Undo requested, current state:', JSON.stringify(this.undoState));
        console.log('📊 Undo details:', {
            userId: this.userId,
            connected: this.networkLayer?.isConnected,
            pendingOperation: this.pendingUndoRedo
        });
        
        if (!this.undoState.canUndo || this.pendingUndoRedo) {
            console.log('❌ Cannot undo:', { canUndo: this.undoState.canUndo, pending: this.pendingUndoRedo });
            return;
        }
        
        if (!this.networkLayer || !this.networkLayer.isConnected) {
            console.log('❌ Cannot undo - not connected to server');
            return;
        }
        
        // Check if we have a recent operation that might not be recorded yet
        const timeSinceLastOperation = Date.now() - (this.lastOperationTime || 0);
        if (timeSinceLastOperation < 500) { // 500ms grace period
            console.log('⏳ Delaying undo request to allow server to record recent operations');
            setTimeout(() => this.undo(), 250);
            return;
        }
        
        console.log('🔄 Sending undo request to server...');
        this.pendingUndoRedo = 'undo';
        
        // Optimistically update UI
        this.updateUndoRedoUI();
        
        // Send undo request to server
        this.networkLayer.emit('undo_operation', {});
    }
    
    /**
     * Perform redo operation
     */
    async redo() {
        if (!this.undoState.canRedo || this.pendingUndoRedo) {
            return;
        }
        
        console.log('🔄 Requesting redo...');
        this.pendingUndoRedo = 'redo';
        
        // Optimistically update UI
        this.updateUndoRedoUI();
        
        // Send redo request to server
        this.networkLayer.emit('redo_operation', {});
    }
    
    /**
     * Handle successful undo from server
     */
    handleUndoSuccess(data) {
        console.log('✅ Undo successful:', data);
        console.log('📊 Undo operation details:', {
            operationType: data.operation?.type,
            operationId: data.operation?.id,
            affectedNodes: data.affectedNodes,
            hasStateUpdate: !!data.stateUpdate
        });
        this.pendingUndoRedo = null;
        
        // CRITICAL: Apply state changes to the graph
        if (data.stateUpdate) {
            console.log('📝 Applying undo state changes:', data.stateUpdate);
            this.applyStateChanges(data.stateUpdate);
        }
        
        // Update undo state
        if (data.undoState) {
            this.updateUndoState(data.undoState);
        }
        
        // Show notification
        if (data.conflicts && data.conflicts.length > 0) {
            this.showNotification('Undo completed with conflicts', 'warning');
        } else {
            this.showNotification('Undo successful', 'success');
        }
    }
    
    /**
     * Handle failed undo from server
     */
    handleUndoFailed(data) {
        console.log('❌ Undo failed:', data.reason);
        this.pendingUndoRedo = null;
        
        // Update undo state
        if (data.undoState) {
            this.updateUndoState(data.undoState);
        }
        
        // Show error notification
        this.showNotification(data.reason || 'Undo failed', 'error');
    }
    
    /**
     * Apply state changes from undo/redo to the local graph
     */
    applyStateChanges(stateUpdate) {
        if (!stateUpdate || !this.app.graph) {
            console.warn('Cannot apply state changes - no update or graph');
            return;
        }
        
        const { added, updated, removed } = stateUpdate;
        
        // Remove nodes
        if (removed && removed.length > 0) {
            console.log(`🗑️ Removing ${removed.length} nodes`);
            for (const nodeId of removed) {
                const node = this.app.graph.getNodeById(nodeId);
                if (node) {
                    this.app.graph.remove(node);
                }
            }
        }
        
        // Add nodes
        if (added && added.length > 0) {
            console.log(`➕ Adding ${added.length} nodes`);
            for (const nodeData of added) {
                // Create node from server data
                const NodeClass = LiteGraph.registered_node_types[nodeData.type];
                if (NodeClass) {
                    const node = new NodeClass();
                    node.id = nodeData.id;
                    node.pos = nodeData.pos;
                    node.size = nodeData.size;
                    if (nodeData.properties) {
                        Object.assign(node.properties, nodeData.properties);
                    }
                    this.app.graph.add(node);
                }
            }
        }
        
        // Update nodes
        if (updated && updated.length > 0) {
            console.log(`🔄 Updating ${updated.length} nodes`);
            for (const nodeData of updated) {
                const node = this.app.graph.getNodeById(nodeData.id);
                if (node) {
                    // Update position
                    if (nodeData.pos) {
                        node.pos = [...nodeData.pos];
                    }
                    // Update size
                    if (nodeData.size) {
                        node.size = [...nodeData.size];
                    }
                    // Update properties
                    if (nodeData.properties) {
                        Object.assign(node.properties, nodeData.properties);
                    }
                    // Update rotation if present
                    if (nodeData.rotation !== undefined) {
                        node.rotation = nodeData.rotation;
                    }
                    // Update aspect ratio if present
                    if (nodeData.aspectRatio !== undefined) {
                        node.aspectRatio = nodeData.aspectRatio;
                    }
                }
            }
        }
        
        // Mark canvas as dirty to trigger redraw
        if (this.app.graphCanvas) {
            this.app.graphCanvas.dirty_canvas = true;
            this.app.graphCanvas.dirty_bgcanvas = true;
        }
        
        console.log('✅ State changes applied to graph');
    }
    
    /**
     * Handle successful redo from server
     */
    handleRedoSuccess(data) {
        console.log('✅ Redo successful:', data);
        this.pendingUndoRedo = null;
        
        // CRITICAL: Apply state changes to the graph
        if (data.stateUpdate) {
            console.log('📝 Applying redo state changes:', data.stateUpdate);
            this.applyStateChanges(data.stateUpdate);
        }
        
        // Update undo state
        if (data.undoState) {
            this.updateUndoState(data.undoState);
        }
        
        // Show notification
        this.showNotification('Redo successful', 'success');
    }
    
    /**
     * Handle failed redo from server
     */
    handleRedoFailed(data) {
        console.log('❌ Redo failed:', data.reason);
        this.pendingUndoRedo = null;
        
        // Update undo state
        if (data.undoState) {
            this.updateUndoState(data.undoState);
        }
        
        // Show error notification
        this.showNotification(data.reason || 'Redo failed', 'error');
    }
    
    /**
     * Handle undo from another tab (same user)
     */
    handleCrossTabUndo(data) {
        console.log('🔄 Cross-tab undo:', data);
        
        // Update undo state
        if (data.undoState) {
            this.updateUndoState(data.undoState);
        }
        
        // Show subtle notification
        this.showNotification('Undo from another tab', 'info', 2000);
    }
    
    /**
     * Handle redo from another tab (same user)
     */
    handleCrossTabRedo(data) {
        console.log('🔄 Cross-tab redo:', data);
        
        // Update undo state
        if (data.undoState) {
            this.updateUndoState(data.undoState);
        }
        
        // Show subtle notification
        this.showNotification('Redo from another tab', 'info', 2000);
    }
    
    /**
     * Handle undo by remote user
     */
    handleRemoteUndo(data) {
        console.log('👥 Remote user undo:', data);
        
        // Highlight affected nodes briefly
        if (data.affectedNodes && data.affectedNodes.length > 0) {
            this.highlightAffectedNodes(data.affectedNodes, data.userId);
        }
    }
    
    /**
     * Handle redo by remote user
     */
    handleRemoteRedo(data) {
        console.log('👥 Remote user redo:', data);
        
        // Highlight affected nodes briefly
        if (data.affectedNodes && data.affectedNodes.length > 0) {
            this.highlightAffectedNodes(data.affectedNodes, data.userId);
        }
    }
    
    /**
     * Begin a transaction for bundling operations
     */
    beginTransaction(source) {
        if (this.currentTransaction) {
            console.warn('Transaction already in progress');
            return;
        }
        
        this.currentTransaction = {
            source: source,
            startTime: Date.now(),
            operations: []
        };
        
        // Notify server
        this.networkLayer.emit('begin_transaction', { source });
        
        console.log(`📝 Transaction started: ${source}`);
    }
    
    /**
     * Commit the current transaction
     */
    commitTransaction() {
        if (!this.currentTransaction) {
            return;
        }
        
        const duration = Date.now() - this.currentTransaction.startTime;
        const operationCount = this.currentTransaction.operations.length;
        
        // Notify server
        this.networkLayer.emit('commit_transaction', {});
        
        console.log(`✅ Transaction committed: ${this.currentTransaction.source} (${operationCount} operations in ${duration}ms)`);
        
        this.currentTransaction = null;
    }
    
    /**
     * Abort the current transaction
     */
    abortTransaction() {
        if (!this.currentTransaction) {
            return;
        }
        
        // Notify server
        this.networkLayer.emit('abort_transaction', {});
        
        console.log(`❌ Transaction aborted: ${this.currentTransaction.source}`);
        
        this.currentTransaction = null;
    }
    
    /**
     * Track an operation (called by StateSyncManager)
     */
    trackOperation(operation) {
        console.log(`📝 Tracking operation: ${operation.type}`, {
            id: operation.id,
            hasUndoData: !!operation.undoData,
            userId: this.userId,
            projectId: this.projectId,
            inTransaction: !!this.currentTransaction
        });
        
        if (this.currentTransaction) {
            this.currentTransaction.operations.push(operation.id);
        }
        
        // Update last operation time to prevent premature undo requests
        this.lastOperationTime = Date.now();
    }
    
    /**
     * Update undo/redo UI buttons
     */
    updateUndoRedoUI() {
        // Update undo button
        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) {
            undoBtn.disabled = !this.undoState.canUndo || this.pendingUndoRedo === 'undo';
            undoBtn.title = this.undoState.canUndo 
                ? `Undo (${this.undoState.undoCount} available)`
                : 'Nothing to undo';
        }
        
        // Update redo button
        const redoBtn = document.getElementById('redo-btn');
        if (redoBtn) {
            redoBtn.disabled = !this.undoState.canRedo || this.pendingUndoRedo === 'redo';
            redoBtn.title = this.undoState.canRedo
                ? `Redo (${this.undoState.redoCount} available)`
                : 'Nothing to redo';
        }
    }
    
    /**
     * Highlight nodes affected by remote operations
     */
    highlightAffectedNodes(nodeIds, userId) {
        // Find user info
        const userInfo = this.app.collaborativeArchitecture?.getActiveUsers?.()
            .find(u => u.userId === userId);
        const username = userInfo?.displayName || userInfo?.username || 'Another user';
        
        // Highlight each affected node
        nodeIds.forEach(nodeId => {
            const node = this.app.graph.getNodeById(nodeId);
            if (node && node.domElement) {
                // Add highlight class
                node.domElement.classList.add('remote-operation-highlight');
                
                // Remove after animation
                setTimeout(() => {
                    node.domElement.classList.remove('remote-operation-highlight');
                }, 2000);
            }
        });
        
        // Show notification
        this.showNotification(`${username} modified ${nodeIds.length} item(s)`, 'info', 3000);
    }
    
    /**
     * Show notification to user
     */
    showNotification(message, type = 'info', duration = 4000) {
        if (this.app.notificationSystem) {
            this.app.notificationSystem.notify(message, type, duration);
        } else {
            // Fallback to console
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
    
    /**
     * Get undo/redo statistics
     */
    getStatistics() {
        return {
            userId: this.userId,
            canUndo: this.undoState.canUndo,
            canRedo: this.undoState.canRedo,
            undoCount: this.undoState.undoCount,
            redoCount: this.undoState.redoCount,
            hasActiveTransaction: !!this.currentTransaction,
            pendingOperation: this.pendingUndoRedo
        };
    }
    
    /**
     * Clear all undo/redo history (admin only)
     */
    clearHistory() {
        // This would typically require admin permissions
        console.warn('Clear history not implemented - requires server support');
    }
}