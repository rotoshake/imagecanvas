/**
 * UndoStateSync - Server-side undo/redo coordination
 * 
 * Handles undo/redo requests from clients
 * Validates operations for conflicts
 * Coordinates with CanvasStateManager to apply state changes
 * Synchronizes undo state across all user sessions
 */
class UndoStateSync {
    constructor(operationHistory, stateManager, io) {
        this.history = operationHistory;
        this.stateManager = stateManager;
        this.io = io;
        
        // Track user sessions for cross-tab sync
        this.userSessions = new Map(); // userId -> Set<socketId>

        this.undoHandlers = {
            'node_create': this.undoNodeCreate,
            'node_duplicate': this.undoNodeCreate,
            'node_paste': this.undoNodeCreate,
            'node_delete': this.undoNodeDelete,
            'node_move': this.undoNodeMove,
            'node_align': this.undoNodeAlign,
            'node_resize': this.undoNodeResize,
            'node_property_update': this.undoPropertyUpdate,
            'node_batch_property_update': this.undoPropertyUpdate,
            'node_rotate': this.undoNodeRotate,
            'node_reset': this.undoNodeReset,
            'video_toggle': this.undoVideoToggle,
            'node_layer_order': this.undoNodeLayerOrder,
        };
    }
    
    /**
     * Register a user session
     */
    registerUserSession(userId, socketId) {
        if (!this.userSessions.has(userId)) {
            this.userSessions.set(userId, new Set());
        }
        this.userSessions.get(userId).add(socketId);
    }
    
    /**
     * Unregister a user session
     */
    unregisterUserSession(userId, socketId) {
        const sessions = this.userSessions.get(userId);
        if (sessions) {
            sessions.delete(socketId);
            if (sessions.size === 0) {
                this.userSessions.delete(userId);
            }
        }
    }
    
    /**
     * Handle undo request from client
     */
    async handleUndo(userId, canvasId, socketId) {
        
        try {
            const undoable = this.history.getUndoableOperations(userId, canvasId, 1);
            if (undoable.length === 0) {
                return this.createUndoResponse(false, 'Nothing to undo', userId, canvasId);
            }

            const undoItem = undoable[0];
            const operationIds = undoItem.type === 'transaction'
                ? undoItem.operationIds
                : [undoItem.operationId];

            const operations = this.getOperations(operationIds);

            const conflicts = await this.history.checkUndoConflicts(operationIds, userId, canvasId);
            if (conflicts.length > 0) {
                
            }

            const stateChanges = await this.executeUndo(operations, canvasId);
            this.history.markOperationsUndone(operationIds, userId, canvasId);

            const response = this.createUndoResponse(true, 'Undo successful', userId, canvasId, operationIds, stateChanges, conflicts);

            this.broadcastUndo(response, userId, canvasId);

            return response;
        } catch (error) {
            console.error('❌ Undo execution failed:', error);
            return this.createUndoResponse(false, 'Failed to execute undo', userId, canvasId, null, null, null, error.message);
        }
    }
    
    /**
     * Handle redo request from client
     */
    async handleRedo(userId, canvasId, socketId) {
        
        // Get next redoable operation(s)
        const redoable = this.history.getRedoableOperations(userId, canvasId, 1);
        if (redoable.length === 0) {
            return {
                success: false,
                reason: 'Nothing to redo',
                undoState: this.history.getUserUndoState(userId, canvasId)
            };
        }
        
        const redoItem = redoable[0];
        const operationIds = redoItem.type === 'transaction' 
            ? redoItem.operationIds 
            : [redoItem.operationId];
        
        // Get operation details
        const operations = operationIds.map(id => this.history.operations.get(id)).filter(Boolean);
        console.log(`🔍 Retrieved ${operations.length} operations with undo data:`, 
            operations.map(op => ({ type: op.type, hasUndoData: !!op.undoData })));
        
        try {
            // Execute redo
            const stateChanges = await this.executeRedo(operations, canvasId);
            
            // Mark operations as redone
            this.history.markOperationsRedone(operationIds, userId, canvasId);
            
            // Get updated undo state
            const undoState = this.history.getUserUndoState(userId, canvasId);
            
            // Prepare response
            const response = {
                success: true,
                redoneOperations: operationIds,
                stateUpdate: stateChanges,
                undoState: undoState
            };
            
            // Broadcast state update to ALL clients (including the initiator)
            // This ensures StateSyncManager handles the changes properly
            this.io.to(`canvas_${canvasId}`).emit('state_update', {
                stateVersion: this.stateManager.stateVersions.get(canvasId) || 0,
                changes: stateChanges,
                operationId: `redo_${Date.now()}`,
                fromUserId: userId,
                isRedo: true  // Flag to force update even for optimistic nodes
            });
            
            // Broadcast redo confirmation to all user sessions (cross-tab sync)
            this.broadcastToUser(userId, 'redo_executed', {
                canvasId,
                operations: operationIds,
                stateChanges: stateChanges,
                undoState: undoState
            });
            
            // Notify other users in the canvas
            this.broadcastToOthers(userId, canvasId, 'remote_redo', {
                userId: userId,
                redoneOperations: operationIds,
                affectedNodes: this.extractAffectedNodes(operations)
            });

            return response;
            
        } catch (error) {
            console.error('❌ Redo execution failed:', error);
            return {
                success: false,
                reason: 'Failed to execute redo',
                error: error.message,
                undoState: this.history.getUserUndoState(userId, canvasId)
            };
        }
    }
    
    /**
     * Execute undo operations
     */
    async executeUndo(operations, canvasId) {
        const stateChanges = {
            added: [],
            updated: [],
            removed: []
        };
        
        // Get current state
        const state = await this.stateManager.getCanvasState(canvasId);

        // Process operations in reverse order
        for (let i = operations.length - 1; i >= 0; i--) {
            const op = operations[i];
            console.log(`📍 Undoing operation ${op.id} (${op.type}), has undo data: ${!!op.undoData}`);
            const changes = await this.undoOperation(op, state);
            
            // Merge changes
            if (changes) {
                stateChanges.added.push(...(changes.added || []));
                stateChanges.updated.push(...(changes.updated || []));
                stateChanges.removed.push(...(changes.removed || []));
            }
        }
        
        // Increment state version
        const currentVersion = this.stateManager.stateVersions.get(canvasId) || 0;
        const newVersion = currentVersion + 1;
        this.stateManager.stateVersions.set(canvasId, newVersion);
        state.version = newVersion;
        
        // Save state
        await this.stateManager.saveCanvasState(canvasId, state);
        
        return stateChanges;
    }
    
    /**
     * Execute redo operations
     */
    async executeRedo(operations, canvasId) {
        const stateChanges = {
            added: [],
            updated: [],
            removed: []
        };
        
        // Get current state
        const state = await this.stateManager.getCanvasState(canvasId);
        
        // Process operations in original order
        for (const op of operations) {
            // Re-apply the operation
            const changes = await this.stateManager.applyOperation(op, state);
            
            // Merge changes
            if (changes) {
                stateChanges.added.push(...(changes.added || []));
                stateChanges.updated.push(...(changes.updated || []));
                stateChanges.removed.push(...(changes.removed || []));
            }
        }
        
        // Increment state version
        const currentVersion = this.stateManager.stateVersions.get(canvasId) || 0;
        const newVersion = currentVersion + 1;
        this.stateManager.stateVersions.set(canvasId, newVersion);
        state.version = newVersion;
        
        // Save state
        await this.stateManager.saveCanvasState(canvasId, state);
        
        return stateChanges;
    }
    
    /**
     * Undo a single operation
     */
    async undoOperation(operation, state) {
        const changes = {
            added: [],
            updated: [],
            removed: []
        };
        
        // Use undo data if available
        if (operation.undoData) {
            return this.applyUndoData(operation, state, changes);
        }
        
        // Otherwise, use reverse logic based on operation type
        const handler = this.undoHandlers[operation.type];
        if (handler) {
            return handler.call(this, operation, state, changes);
        }

        return null;
    }
    
    /**
     * Apply undo data to restore previous state
     */
    applyUndoData(operation, state, changes) {
        const undoData = operation.undoData;
        console.log(`📝 Applying undo data for ${operation.type}:`, JSON.stringify(undoData, null, 2));
        
        // Track which nodes have been updated to avoid duplicates
        const updatedNodeIds = new Set();
        
        // Handle node move operations with array format
        if (undoData.nodes && Array.isArray(undoData.nodes)) {
            for (const nodeData of undoData.nodes) {
                const node = state.nodes.find(n => n.id == nodeData.id);
                if (node && nodeData.oldPosition) {
                    
                    node.pos = [...nodeData.oldPosition];
                    if (!updatedNodeIds.has(node.id)) {
                        changes.updated.push(node);
                        updatedNodeIds.add(node.id);
                    }
                }
            }
            // Don't return early if we also have previousPositions
            if (!undoData.previousPositions) {
                return changes;
            }
        }
        
        if (undoData.deletedNodes) {
            // Restore deleted nodes
            for (const node of undoData.deletedNodes) {
                state.nodes.push(node);
                changes.added.push(node);
            }
        }
        
        if (undoData.createdNodeIds) {
            // Remove created nodes
            const toRemove = new Set(undoData.createdNodeIds);
            state.nodes = state.nodes.filter(node => {
                if (toRemove.has(node.id)) {
                    changes.removed.push(node.id);
                    return false;
                }
                return true;
            });
        }
        
        if (undoData.previousState) {
            // Restore previous state for modified nodes
            for (const [nodeId, prevState] of Object.entries(undoData.previousState)) {
                const node = state.nodes.find(n => n.id == nodeId);
                if (node) {
                    // Apply previous state
                    Object.assign(node, prevState);
                    if (!updatedNodeIds.has(node.id)) {
                        changes.updated.push(node);
                        updatedNodeIds.add(node.id);
                    }
                }
            }
        }
        
        if (undoData.previousPositions) {
            // Restore previous positions
            for (const [nodeId, pos] of Object.entries(undoData.previousPositions)) {
                const node = state.nodes.find(n => n.id == nodeId); // Use loose equality for type conversion
                if (node) {
                    
                    node.pos = [...pos];
                    if (!updatedNodeIds.has(node.id)) {
                        changes.updated.push(node);
                        updatedNodeIds.add(node.id);
                    }
                }
            }
        }
        
        if (undoData.previousSizes) {
            // Restore previous sizes
            for (const [nodeId, size] of Object.entries(undoData.previousSizes)) {
                const node = state.nodes.find(n => n.id == nodeId); // Use loose equality for type conversion
                if (node) {
                    node.size = [...size];
                    if (!updatedNodeIds.has(node.id)) {
                        changes.updated.push(node);
                        updatedNodeIds.add(node.id);
                    }
                }
            }
        }
        
        if (undoData.previousRotations) {
            
            // Restore previous rotations
            for (const [nodeId, rotation] of Object.entries(undoData.previousRotations)) {
                const node = state.nodes.find(n => n.id == nodeId); // Use loose equality for type conversion
                if (node) {
                    
                    const oldRotation = node.rotation;
                    node.rotation = rotation;
                    
                    if (!updatedNodeIds.has(node.id)) {
                        // Push the actual node - the state will be saved correctly
                        changes.updated.push(node);
                        updatedNodeIds.add(node.id);
                    }
                } else {
                    
                }
            }
        }
        
        if (undoData.previousProperties) {
            // Restore previous properties
            for (const [nodeId, props] of Object.entries(undoData.previousProperties)) {
                const node = state.nodes.find(n => n.id == nodeId); // Use loose equality for type conversion
                if (node) {
                    // Handle both direct properties (like title) and nested properties
                    for (const [key, value] of Object.entries(props)) {
                        if (['title', 'type', 'id', 'pos', 'size', 'rotation', 'flags', 'toneCurve', 'toneCurveBypassed', 'colorAdjustmentsBypassed', 'adjustments', 'colorBalance', 'colorBalanceBypassed'].includes(key)) {
                            // Direct node property
                            node[key] = value;
                        } else {
                            // Nested property
                            if (!node.properties) node.properties = {};
                            node.properties[key] = value;
                        }
                    }
                    if (!updatedNodeIds.has(node.id)) {
                        changes.updated.push(node);
                        updatedNodeIds.add(node.id);
                    }
                }
            }
        }
        
        return changes;
    }
    
    /**
     * Undo node creation
     */
    undoNodeCreate(operation, state, changes) {
        // First check if we have undo data with the created node ID
        if (operation.undoData && operation.undoData.nodeId) {
            const nodeId = operation.undoData.nodeId;
            const index = state.nodes.findIndex(n => n.id == nodeId);
            if (index !== -1) {
                state.nodes.splice(index, 1);
                changes.removed.push(nodeId);
                
            } else {
                
            }
        } 
        // Fallback to params.id if available
        else if (operation.params.id) {
            const nodeId = operation.params.id;
            const index = state.nodes.findIndex(n => n.id == nodeId);
            if (index !== -1) {
                state.nodes.splice(index, 1);
                changes.removed.push(nodeId);
                
            }
        } else {
            console.error('❌ Cannot undo node_create - no node ID found in undoData or params');
        }
        return changes;
    }
    
    /**
     * Undo node deletion
     */
    undoNodeDelete(operation, state, changes) {
        // First try to use server-captured data from the operation's changes
        if (operation.changes && operation.changes.deletedNodes) {
            for (const node of operation.changes.deletedNodes) {
                state.nodes.push(node);
                changes.added.push(node);
            }
        }
        // Fallback to client-provided undo data (for backward compatibility)
        else if (operation.undoData && operation.undoData.deletedNodes) {
            for (const node of operation.undoData.deletedNodes) {
                state.nodes.push(node);
                changes.added.push(node);
            }
        }
        // If neither is available, we can't undo
        else {
            console.error('Cannot undo node deletion - no node data available');
        }
        return changes;
    }
    
    /**
     * Undo node move
     */
    undoNodeMove(operation, state, changes) {
        if (operation.undoData && operation.undoData.previousPositions) {
            for (const [nodeId, pos] of Object.entries(operation.undoData.previousPositions)) {
                const node = state.nodes.find(n => n.id == nodeId);
                if (node) {
                    node.pos = [...pos];
                    changes.updated.push(node);
                }
            }
        }
        return changes;
    }
    
    /**
     * Undo node alignment
     */
    undoNodeAlign(operation, state, changes) {
        if (operation.undoData && operation.undoData.previousPositions) {
            for (const [nodeId, pos] of Object.entries(operation.undoData.previousPositions)) {
                const node = state.nodes.find(n => n.id == nodeId);
                if (node) {
                    node.pos = [...pos];
                    changes.updated.push(node);
                }
            }
        }
        return changes;
    }
    
    /**
     * Undo node resize
     */
    undoNodeResize(operation, state, changes) {
        if (operation.undoData && operation.undoData.previousSizes) {
            for (const [nodeId, size] of Object.entries(operation.undoData.previousSizes)) {
                const node = state.nodes.find(n => n.id == nodeId);
                if (node) {
                    node.size = [...size];
                    if (operation.undoData.previousPositions && operation.undoData.previousPositions[nodeId]) {
                        node.pos = [...operation.undoData.previousPositions[nodeId]];
                    }
                    if (operation.undoData.previousAspectRatios && operation.undoData.previousAspectRatios[nodeId]) {
                        node.aspectRatio = operation.undoData.previousAspectRatios[nodeId];
                    }
                    changes.updated.push(node);
                }
            }
        }
        return changes;
    }
    
    /**
     * Undo property update
     */
    undoPropertyUpdate(operation, state, changes) {
        if (operation.undoData && operation.undoData.previousProperties) {
            // Track which nodes have been updated to avoid duplicates
            const updatedNodeIds = new Set();
            
            for (const [nodeId, props] of Object.entries(operation.undoData.previousProperties)) {
                const node = state.nodes.find(n => n.id == nodeId);
                if (node) {
                    // Handle both direct properties (like title) and nested properties
                    for (const [key, value] of Object.entries(props)) {
                        if (['title', 'type', 'id', 'pos', 'size', 'rotation', 'flags', 'toneCurve', 'toneCurveBypassed', 'colorAdjustmentsBypassed', 'adjustments', 'colorBalance', 'colorBalanceBypassed'].includes(key)) {
                            // Direct node property
                            node[key] = value;
                        } else {
                            // Nested property
                            if (!node.properties) node.properties = {};
                            node.properties[key] = value;
                        }
                    }
                    if (!updatedNodeIds.has(node.id)) {
                        changes.updated.push(node);
                        updatedNodeIds.add(node.id);
                    }
                }
            }
        }
        return changes;
    }
    
    /**
     * Undo node rotation
     */
    undoNodeRotate(operation, state, changes) {
        if (operation.undoData && operation.undoData.previousRotations) {
            for (const [nodeId, rotation] of Object.entries(operation.undoData.previousRotations)) {
                const node = state.nodes.find(n => n.id == nodeId);
                if (node) {
                    node.rotation = rotation;
                    if (operation.undoData.previousPositions && operation.undoData.previousPositions[nodeId]) {
                        node.pos = [...operation.undoData.previousPositions[nodeId]];
                    }
                    changes.updated.push(node);
                }
            }
        }
        return changes;
    }
    
    /**
     * Undo node reset
     */
    undoNodeReset(operation, state, changes) {
        if (operation.undoData && operation.undoData.previousState) {
            for (const [nodeId, prevState] of Object.entries(operation.undoData.previousState)) {
                const node = state.nodes.find(n => n.id == nodeId);
                if (node) {
                    if (prevState.rotation !== undefined) {
                        node.rotation = prevState.rotation;
                    }
                    if (prevState.aspectRatio !== undefined) {
                        node.aspectRatio = prevState.aspectRatio;
                    }
                    if (prevState.size) {
                        node.size = [...prevState.size];
                    }
                    changes.updated.push(node);
                }
            }
        }
        return changes;
    }
    
    /**
     * Undo video toggle
     */
    undoVideoToggle(operation, state, changes) {
        const nodeId = operation.params.nodeId;
        const node = state.nodes.find(n => n.id == nodeId);
        if (node && node.type === 'media/video') {
            // Toggle the paused state back
            node.properties.paused = !node.properties.paused;
            changes.updated.push(node);
        }
        return changes;
    }
    
    /**
     * Undo node layer order
     */
    undoNodeLayerOrder(operation, state, changes) {
        if (operation.undoData && operation.undoData.originalZIndices) {
            for (const [nodeId, zIndex] of Object.entries(operation.undoData.originalZIndices)) {
                const node = state.nodes.find(n => n.id == nodeId);
                if (node) {
                    node.zIndex = zIndex;
                    changes.updated.push(node);
                }
            }
        }
        return changes;
    }
    
    /**
     * Extract affected nodes from operations
     */
    extractAffectedNodes(operations) {
        const affected = new Set();
        for (const op of operations) {
            const nodes = this.history.getAffectedNodes(op);
            nodes.forEach(nodeId => affected.add(nodeId));
        }
        return Array.from(affected);
    }
    
    /**
     * Broadcast to all sessions of a specific user
     */
    broadcastToUser(userId, event, data) {
        const sessions = this.userSessions.get(userId);
        if (sessions) {
            for (const socketId of sessions) {
                this.io.to(socketId).emit(event, data);
            }
        }
    }
    
    /**
     * Broadcast to other users in a canvas
     */
    broadcastToOthers(userId, canvasId, event, data) {
        // Broadcast to canvas room, excluding the user's sockets
        const userSessions = this.userSessions.get(userId) || new Set();
        this.io.to(`canvas_${canvasId}`).except([...userSessions]).emit(event, data);
    }
    
    /**
     * Get undo/redo state for a user
     */
    getUserUndoState(userId, canvasId) {
        return this.history.getUserUndoState(userId, canvasId);
    }

    createUndoResponse(success, reason, userId, canvasId, operationIds = [], stateChanges = {}, conflicts = [], error = null) {
        const response = {
            success,
            reason,
            undoState: this.history.getUserUndoState(userId, canvasId)
        };

        if (success) {
            response.undoneOperations = operationIds;
            response.stateUpdate = stateChanges;
            response.conflicts = conflicts.length > 0 ? conflicts : null;
        }

        if (error) {
            response.error = error;
        }

        return response;
    }

    getOperations(operationIds) {
        const operations = operationIds.map(id => this.history.operations.get(id)).filter(Boolean);
        console.log(`🔍 Retrieved ${operations.length} operations with undo data:`,
            operations.map(op => ({
                id: op.id,
                type: op.type,
                hasUndoData: !!op.undoData,
                state: op.state,
                userId: op.userId
            })));
        return operations;
    }

    broadcastUndo(response, userId, canvasId) {
        this.io.to(`canvas_${canvasId}`).emit('state_update', {
            stateVersion: this.stateManager.stateVersions.get(canvasId) || 0,
            changes: response.stateUpdate,
            operationId: `undo_${Date.now()}`,
            fromUserId: userId,
            isUndo: true
        });

        this.broadcastToUser(userId, 'undo_executed', {
            canvasId,
            operations: response.undoneOperations,
            stateChanges: response.stateUpdate,
            undoState: response.undoState
        });

        this.broadcastToOthers(userId, canvasId, 'remote_undo', {
            userId: userId,
            undoneOperations: response.undoneOperations,
            affectedNodes: this.extractAffectedNodes(this.getOperations(response.undoneOperations))
        });
    }
}

module.exports = UndoStateSync;