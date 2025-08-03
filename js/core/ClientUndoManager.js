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
        this.canvasId = null;
        
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
        
        // State for the current undoable interaction
        this.interactionInitialState = null;

        // Setup network handlers
        this.setupNetworkHandlers();
        
        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();
        
        // Flag to indicate we're handling keyboard shortcuts
        this.keyboardShortcutsEnabled = true;
        
    }
    
    /**
     * Setup network event handlers
     */
    setupNetworkHandlers() {
        if (!this.networkLayer) return;
        
        // User identification
        this.networkLayer.on('connected', (data) => {
            const oldUserId = this.userId;
            this.userId = data.userId || data.sessionId || data.id;
            
            // Request initial undo state after a short delay to ensure server is ready
            setTimeout(() => {
                this.requestUndoState();
            }, 100);
        });
        
        this.networkLayer.on('canvas_joined', (data) => {
            const oldUserId = this.userId;
            const oldCanvasId = this.canvasId;
            
            if (data.session) {
                this.userId = data.session.userId;
                this.canvasId = data.canvas?.id || data.canvasId;
            } else if (data.userId) {
                this.userId = data.userId;
                this.canvasId = data.canvas?.id || data.canvasId;
            }
            
            // Ensure we have the correct canvas ID from the server response
            if (data.canvas && data.canvas.id) {
                this.canvasId = data.canvas.id;
            }

            // Request undo state for the canvas after a short delay
            setTimeout(() => {
                this.requestUndoState();
            }, 100);
        });
        
        // Undo state updates
        this.networkLayer.on('undo_state_update', (data) => {
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
            this.currentTransaction = null;
        });
        
        this.networkLayer.on('transaction_aborted', (data) => {
            
            this.currentTransaction = null;
        });
    }

    /**
     * Begins an undoable interaction by capturing the initial state of the affected nodes.
     * @param {Array<LGraphNode>} nodes The nodes involved in the interaction.
     */
    beginInteraction(nodes) {
        if (this.interactionInitialState) {
            
            this.cancelInteraction(); // Use cancelInteraction instead of endInteraction
        }

        this.interactionInitialState = {
            nodes: new Map()
        };

        nodes.forEach(node => {
            if (!node) {
                console.warn('Skipping undefined node in beginInteraction');
                return;
            }
            this.interactionInitialState.nodes.set(node.id, {
                pos: [...node.pos],
                size: [...node.size],
                rotation: node.rotation || 0,
                properties: JSON.parse(JSON.stringify(node.properties || {}))
            });
        });

    }

    /**
     * Ends an undoable interaction, creates a command, and sends it for execution.
     * @param {string} commandType The type of command to execute.
     * @param {object} finalParams The final parameters for the command.
     */
    endInteraction(commandType, finalParams) {
        if (!this.interactionInitialState) {
            
            if (commandType && finalParams) {
                 window.app.operationPipeline.execute(commandType, finalParams);
            }
            return;
        }

        const initialNodesMap = this.interactionInitialState.nodes;
        const finalNodeIds = finalParams.nodeIds || Array.from(initialNodesMap.keys());

        const initialState = {
            positions: [],
            sizes: [],
            rotations: [],
            properties: []
        };

        finalNodeIds.forEach(nodeId => {
            const state = initialNodesMap.get(nodeId);
            if (state) {
                initialState.positions.push(state.pos);
                initialState.sizes.push(state.size);
                initialState.rotations.push(state.rotation);
                initialState.properties.push(state.properties);
            }
        });

        const params = {
            ...finalParams,
            nodeIds: finalNodeIds
        };
        
        // For single node operations, also set nodeId for backward compatibility
        if (finalNodeIds.length === 1) {
            params.nodeId = finalNodeIds[0];
            
            // Convert plural forms to singular for single node operations
            if (params.positions && params.positions.length === 1) {
                params.position = params.positions[0];
                delete params.positions;
            }
            if (params.sizes && params.sizes.length === 1) {
                params.size = params.sizes[0];
                delete params.sizes;
            }
            if (params.rotations && params.rotations.length === 1) {
                params.rotation = params.rotations[0];
                delete params.rotations;
            }
            // Also handle 'angles' parameter for rotation commands
            if (params.angles && params.angles.length === 1) {
                params.angle = params.angles[0];
                delete params.angles;
            }
        }

        window.app.operationPipeline.execute(commandType, params, { initialState });

        this.interactionInitialState = null;
        
    }
    
    /**
     * Cancels an undoable interaction if no change was made.
     */
    cancelInteraction() {
        if (this.interactionInitialState) {
            
            this.interactionInitialState = null;
        }
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
            
            return;
        }
        
        this.networkLayer.emit('request_undo_state', {
            userId: this.userId,
            canvasId: this.canvasId
        });
    }
    
    /**
     * Update local undo state
     */
    updateUndoState(undoState) {
        const previousState = { ...this.undoState };
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
        
        if (!this.undoState.canUndo || this.pendingUndoRedo) {
            
            return;
        }
        
        if (!this.networkLayer || !this.networkLayer.isConnected) {
            
            return;
        }
        
        // Check if we have a recent operation that might not be recorded yet
        const timeSinceLastOperation = Date.now() - (this.lastOperationTime || 0);
        if (timeSinceLastOperation < 500) { // 500ms grace period
            
            setTimeout(() => this.undo(), 250);
            return;
        }
        
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
        
        this.pendingUndoRedo = null;
        
        // NOTE: State changes are already applied by the state_update event
        // sent by the server through broadcastUndo. We don't need to apply
        // them again here as that would cause duplicate updates.
        
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
            
            return;
        }
        
        const { added, updated, removed } = stateUpdate;
        
        // Remove nodes
        if (removed && removed.length > 0) {
            for (const nodeId of removed) {
                const node = this.app.graph.getNodeById(nodeId);
                if (node) {
                    this.app.graph.remove(node);
                }
            }
        }
        
        // Add nodes
        if (added && added.length > 0) {
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
                    
                    // Add color correction properties if present
                    if (nodeData.toneCurve !== undefined) {
                        node.toneCurve = nodeData.toneCurve;
                    }
                    if (nodeData.toneCurveBypassed !== undefined) {
                        node.toneCurveBypassed = nodeData.toneCurveBypassed;
                    }
                    if (nodeData.adjustments !== undefined) {
                        node.adjustments = nodeData.adjustments;
                    }
                    if (nodeData.colorAdjustmentsBypassed !== undefined) {
                        node.colorAdjustmentsBypassed = nodeData.colorAdjustmentsBypassed;
                    }
                    if (nodeData.colorBalance !== undefined) {
                        node.colorBalance = nodeData.colorBalance;
                    }
                    if (nodeData.colorBalanceBypassed !== undefined) {
                        node.colorBalanceBypassed = nodeData.colorBalanceBypassed;
                    }
                    
                    this.app.graph.add(node);
                }
            }
        }
        
        // Update nodes
        if (updated && updated.length > 0) {
            for (const nodeData of updated) {
                const node = this.app.graph.getNodeById(nodeData.id);
                if (node) {
                    // Update position (modify in-place for LiteGraph)
                    if (nodeData.pos) {
                        node.pos[0] = nodeData.pos[0];
                        node.pos[1] = nodeData.pos[1];
                    }
                    // Update size (modify in-place for LiteGraph)
                    if (nodeData.size) {
                        node.size[0] = nodeData.size[0];
                        node.size[1] = nodeData.size[1];
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
                    
                    // Update color correction properties if present
                    if (nodeData.toneCurve !== undefined) {
                        node.toneCurve = nodeData.toneCurve;
                    }
                    if (nodeData.toneCurveBypassed !== undefined) {
                        node.toneCurveBypassed = nodeData.toneCurveBypassed;
                    }
                    if (nodeData.adjustments !== undefined) {
                        node.adjustments = nodeData.adjustments;
                    }
                    if (nodeData.colorAdjustmentsBypassed !== undefined) {
                        node.colorAdjustmentsBypassed = nodeData.colorAdjustmentsBypassed;
                    }
                    if (nodeData.colorBalance !== undefined) {
                        node.colorBalance = nodeData.colorBalance;
                    }
                    if (nodeData.colorBalanceBypassed !== undefined) {
                        node.colorBalanceBypassed = nodeData.colorBalanceBypassed;
                    }
                    
                    // Invalidate WebGL cache if color correction properties changed
                    const hasColorCorrections = nodeData.toneCurve !== undefined || 
                                               nodeData.adjustments !== undefined || 
                                               nodeData.colorBalance !== undefined ||
                                               nodeData.toneCurveBypassed !== undefined ||
                                               nodeData.colorAdjustmentsBypassed !== undefined ||
                                               nodeData.colorBalanceBypassed !== undefined;

                    if (hasColorCorrections) {
                        node.needsGLUpdate = true;
                        // Also invalidate the cache directly if renderer is available
                        if (this.app.graphCanvas?.renderer?._invalidateCache) {
                            this.app.graphCanvas.renderer._invalidateCache(node.id);
                        }
                        
                        // Update color correction UI if this node is currently selected
                        if (this.app.floatingColorCorrection && 
                            this.app.floatingColorCorrection.currentNode && 
                            this.app.floatingColorCorrection.currentNode.id === node.id) {
                            this.app.floatingColorCorrection.updateUI();
                        }
                    }
                }
            }
        }
        
        // Mark canvas as dirty to trigger redraw
        if (this.app.graphCanvas) {
            this.app.graphCanvas.dirty_canvas = true;
            this.app.graphCanvas.dirty_bgcanvas = true;
        }
        
    }
    
    /**
     * Handle successful redo from server
     */
    handleRedoSuccess(data) {
        this.pendingUndoRedo = null;
        
        // NOTE: State changes are already applied by the state_update event
        // sent by the server. We don't need to apply them again here.
        
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
        
        // CRITICAL: Apply state changes to the graph
        if (data.stateChanges) {
            this.applyStateChanges(data.stateChanges);
        }
        
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
        
        // CRITICAL: Apply state changes to the graph
        if (data.stateChanges) {
            this.applyStateChanges(data.stateChanges);
        }
        
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
        
        // Highlight affected nodes briefly
        if (data.affectedNodes && data.affectedNodes.length > 0) {
            this.highlightAffectedNodes(data.affectedNodes, data.userId);
        }
    }
    
    /**
     * Handle redo by remote user
     */
    handleRemoteRedo(data) {
        
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
            
            return;
        }
        
        this.currentTransaction = {
            source: source,
            startTime: Date.now(),
            operations: []
        };
        
        // Notify server
        this.networkLayer.emit('begin_transaction', { source });
        
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

        this.currentTransaction = null;
    }
    
    /**
     * Track an operation (called by StateSyncManager)
     */
    trackOperation(operation) {
        
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
        
    }
}

// Make ClientUndoManager available globally
if (typeof window !== 'undefined') {
    window.ClientUndoManager = ClientUndoManager;
}