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
            this.userId = data.userId || data.sessionId;
            console.log(`👤 Undo manager user ID set: ${this.userId}`);
            
            // Request initial undo state
            this.requestUndoState();
        });
        
        this.networkLayer.on('project_joined', (data) => {
            if (data.session) {
                this.userId = data.session.userId;
            }
            // Request undo state for the project
            this.requestUndoState();
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
        if (!this.networkLayer || !this.networkLayer.isConnected) return;
        
        this.networkLayer.emit('request_undo_state', {});
    }
    
    /**
     * Update local undo state
     */
    updateUndoState(undoState) {
        this.undoState = undoState;
        
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
        console.log('⏪ Undo requested, current state:', this.undoState);
        
        if (!this.undoState.canUndo || this.pendingUndoRedo) {
            console.log('❌ Cannot undo:', { canUndo: this.undoState.canUndo, pending: this.pendingUndoRedo });
            return;
        }
        
        console.log('🔄 Requesting undo from server...');
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
        this.pendingUndoRedo = null;
        
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
     * Handle successful redo from server
     */
    handleRedoSuccess(data) {
        console.log('✅ Redo successful:', data);
        this.pendingUndoRedo = null;
        
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
        if (this.currentTransaction) {
            this.currentTransaction.operations.push(operation.id);
        }
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