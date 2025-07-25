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
    async handleUndo(userId, projectId, socketId) {
        console.log(`🔄 Undo request from user ${userId} in project ${projectId}`);
        
        // Get next undoable operation(s)
        const undoable = this.history.getUndoableOperations(userId, projectId, 1);
        console.log(`📋 Found ${undoable.length} undoable operations`);
        if (undoable.length === 0) {
            console.log(`⚠️ No operations to undo for user ${userId}`);
            return {
                success: false,
                reason: 'Nothing to undo',
                undoState: this.history.getUserUndoState(userId, projectId)
            };
        }
        
        const undoItem = undoable[0];
        const operationIds = undoItem.type === 'transaction' 
            ? undoItem.operationIds 
            : [undoItem.operationId];
        
        // Get operation details
        const operations = operationIds.map(id => this.history.operations.get(id)).filter(Boolean);
        console.log(`🔍 Retrieved ${operations.length} operations with undo data:`, 
            operations.map(op => ({ 
                id: op.id, 
                type: op.type, 
                hasUndoData: !!op.undoData, 
                state: op.state,
                userId: op.userId 
            })));
            
        // Check if any operations are missing undo data
        const opsWithoutUndo = operations.filter(op => !op.undoData);
        if (opsWithoutUndo.length > 0) {
            console.warn(`⚠️ ${opsWithoutUndo.length} operations missing undo data:`, 
                opsWithoutUndo.map(op => ({ id: op.id, type: op.type })));
        }
        
        // Check for conflicts
        const conflicts = await this.history.checkUndoConflicts(operationIds, userId, projectId);
        if (conflicts.length > 0) {
            console.log(`⚠️ Undo conflicts detected:`, conflicts);
            
            // For now, we'll warn but allow the undo
            // In a production system, you might want to prompt the user
        }
        
        try {
            console.log(`⚡ Executing undo for operations:`, operationIds);
            // Execute undo
            const stateChanges = await this.executeUndo(operations, projectId);
            console.log(`✅ Undo executed, state changes:`, stateChanges);
            
            // Mark operations as undone
            this.history.markOperationsUndone(operationIds, userId, projectId);
            
            // Get updated undo state
            const undoState = this.history.getUserUndoState(userId, projectId);
            
            // Prepare response
            const response = {
                success: true,
                undoneOperations: operationIds,
                stateUpdate: stateChanges,
                undoState: undoState,
                conflicts: conflicts.length > 0 ? conflicts : null
            };
            
            // Broadcast to all user sessions (cross-tab sync)
            this.broadcastToUser(userId, 'undo_executed', {
                projectId,
                operations: operationIds,
                stateChanges: stateChanges,
                undoState: undoState
            });
            
            // Notify other users in the project
            this.broadcastToOthers(userId, projectId, 'remote_undo', {
                userId: userId,
                undoneOperations: operationIds,
                affectedNodes: this.extractAffectedNodes(operations)
            });
            
            console.log(`✅ Undo completed for user ${userId}`);
            return response;
            
        } catch (error) {
            console.error('❌ Undo execution failed:', error);
            return {
                success: false,
                reason: 'Failed to execute undo',
                error: error.message,
                undoState: this.history.getUserUndoState(userId, projectId)
            };
        }
    }
    
    /**
     * Handle redo request from client
     */
    async handleRedo(userId, projectId, socketId) {
        console.log(`🔄 Redo request from user ${userId} in project ${projectId}`);
        
        // Get next redoable operation(s)
        const redoable = this.history.getRedoableOperations(userId, projectId, 1);
        if (redoable.length === 0) {
            return {
                success: false,
                reason: 'Nothing to redo',
                undoState: this.history.getUserUndoState(userId, projectId)
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
            const stateChanges = await this.executeRedo(operations, projectId);
            
            // Mark operations as redone
            this.history.markOperationsRedone(operationIds, userId, projectId);
            
            // Get updated undo state
            const undoState = this.history.getUserUndoState(userId, projectId);
            
            // Prepare response
            const response = {
                success: true,
                redoneOperations: operationIds,
                stateUpdate: stateChanges,
                undoState: undoState
            };
            
            // Broadcast to all user sessions (cross-tab sync)
            this.broadcastToUser(userId, 'redo_executed', {
                projectId,
                operations: operationIds,
                stateChanges: stateChanges,
                undoState: undoState
            });
            
            // Notify other users in the project
            this.broadcastToOthers(userId, projectId, 'remote_redo', {
                userId: userId,
                redoneOperations: operationIds,
                affectedNodes: this.extractAffectedNodes(operations)
            });
            
            console.log(`✅ Redo completed for user ${userId}`);
            return response;
            
        } catch (error) {
            console.error('❌ Redo execution failed:', error);
            return {
                success: false,
                reason: 'Failed to execute redo',
                error: error.message,
                undoState: this.history.getUserUndoState(userId, projectId)
            };
        }
    }
    
    /**
     * Execute undo operations
     */
    async executeUndo(operations, projectId) {
        const stateChanges = {
            added: [],
            updated: [],
            removed: []
        };
        
        // Get current state
        const state = await this.stateManager.getCanvasState(projectId);
        
        // Process operations in reverse order
        for (let i = operations.length - 1; i >= 0; i--) {
            const op = operations[i];
            const changes = await this.undoOperation(op, state);
            
            // Merge changes
            if (changes) {
                stateChanges.added.push(...(changes.added || []));
                stateChanges.updated.push(...(changes.updated || []));
                stateChanges.removed.push(...(changes.removed || []));
            }
        }
        
        // Increment state version
        const currentVersion = this.stateManager.stateVersions.get(projectId) || 0;
        const newVersion = currentVersion + 1;
        this.stateManager.stateVersions.set(projectId, newVersion);
        state.version = newVersion;
        
        // Save state
        await this.stateManager.saveCanvasState(projectId, state);
        
        return stateChanges;
    }
    
    /**
     * Execute redo operations
     */
    async executeRedo(operations, projectId) {
        const stateChanges = {
            added: [],
            updated: [],
            removed: []
        };
        
        // Get current state
        const state = await this.stateManager.getCanvasState(projectId);
        
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
        const currentVersion = this.stateManager.stateVersions.get(projectId) || 0;
        const newVersion = currentVersion + 1;
        this.stateManager.stateVersions.set(projectId, newVersion);
        state.version = newVersion;
        
        // Save state
        await this.stateManager.saveCanvasState(projectId, state);
        
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
        switch (operation.type) {
            case 'node_create':
            case 'node_duplicate':
            case 'node_paste':
                // Remove created nodes
                return this.undoNodeCreate(operation, state, changes);
                
            case 'node_delete':
                // Restore deleted nodes
                return this.undoNodeDelete(operation, state, changes);
                
            case 'node_move':
                // Move nodes back to original positions
                return this.undoNodeMove(operation, state, changes);
                
            case 'node_resize':
                // Restore original sizes
                return this.undoNodeResize(operation, state, changes);
                
            case 'node_property_update':
            case 'node_batch_property_update':
                // Restore original properties
                return this.undoPropertyUpdate(operation, state, changes);
                
            case 'node_rotate':
                // Restore original rotation
                return this.undoNodeRotate(operation, state, changes);
                
            case 'node_reset':
                // Restore pre-reset state
                return this.undoNodeReset(operation, state, changes);
                
            case 'video_toggle':
                // Toggle back
                return this.undoVideoToggle(operation, state, changes);
                
            default:
                console.warn(`No undo handler for operation type: ${operation.type}`);
                return null;
        }
    }
    
    /**
     * Apply undo data to restore previous state
     */
    applyUndoData(operation, state, changes) {
        const undoData = operation.undoData;
        console.log(`📝 Applying undo data for ${operation.type}:`, undoData);
        
        // Handle node move operations with array format
        if (undoData.nodes && Array.isArray(undoData.nodes)) {
            for (const nodeData of undoData.nodes) {
                const node = state.nodes.find(n => n.id === nodeData.id);
                if (node && nodeData.oldPosition) {
                    node.pos = [...nodeData.oldPosition];
                    changes.updated.push(node);
                }
            }
            return changes;
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
                const node = state.nodes.find(n => n.id === nodeId);
                if (node) {
                    // Apply previous state
                    Object.assign(node, prevState);
                    changes.updated.push(node);
                }
            }
        }
        
        if (undoData.previousPositions) {
            // Restore previous positions
            for (const [nodeId, pos] of Object.entries(undoData.previousPositions)) {
                const node = state.nodes.find(n => n.id === nodeId);
                if (node) {
                    node.pos = [...pos];
                    changes.updated.push(node);
                }
            }
        }
        
        if (undoData.previousSizes) {
            // Restore previous sizes
            for (const [nodeId, size] of Object.entries(undoData.previousSizes)) {
                const node = state.nodes.find(n => n.id === nodeId);
                if (node) {
                    node.size = [...size];
                    changes.updated.push(node);
                }
            }
        }
        
        if (undoData.previousProperties) {
            // Restore previous properties
            for (const [nodeId, props] of Object.entries(undoData.previousProperties)) {
                const node = state.nodes.find(n => n.id === nodeId);
                if (node) {
                    Object.assign(node.properties, props);
                    changes.updated.push(node);
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
            const index = state.nodes.findIndex(n => n.id === nodeId);
            if (index !== -1) {
                state.nodes.splice(index, 1);
                changes.removed.push(nodeId);
                console.log(`✅ Removed node ${nodeId} using undo data`);
            } else {
                console.warn(`⚠️ Node ${nodeId} not found in state for undo`);
            }
        } 
        // Fallback to params.id if available
        else if (operation.params.id) {
            const nodeId = operation.params.id;
            const index = state.nodes.findIndex(n => n.id === nodeId);
            if (index !== -1) {
                state.nodes.splice(index, 1);
                changes.removed.push(nodeId);
                console.log(`✅ Removed node ${nodeId} using params.id`);
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
        // This requires the undo data to have stored the deleted nodes
        if (operation.undoData && operation.undoData.deletedNodes) {
            for (const node of operation.undoData.deletedNodes) {
                state.nodes.push(node);
                changes.added.push(node);
            }
        }
        return changes;
    }
    
    /**
     * Undo node move
     */
    undoNodeMove(operation, state, changes) {
        if (operation.undoData && operation.undoData.previousPositions) {
            for (const [nodeId, pos] of Object.entries(operation.undoData.previousPositions)) {
                const node = state.nodes.find(n => n.id === nodeId);
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
                const node = state.nodes.find(n => n.id === nodeId);
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
            for (const [nodeId, props] of Object.entries(operation.undoData.previousProperties)) {
                const node = state.nodes.find(n => n.id === nodeId);
                if (node) {
                    Object.assign(node.properties, props);
                    changes.updated.push(node);
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
                const node = state.nodes.find(n => n.id === nodeId);
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
                const node = state.nodes.find(n => n.id === nodeId);
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
        const node = state.nodes.find(n => n.id === nodeId);
        if (node && node.type === 'media/video') {
            // Toggle the paused state back
            node.properties.paused = !node.properties.paused;
            changes.updated.push(node);
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
     * Broadcast to other users in a project
     */
    broadcastToOthers(userId, projectId, event, data) {
        // Broadcast to project room, excluding the user's sockets
        const userSessions = this.userSessions.get(userId) || new Set();
        this.io.to(`project_${projectId}`).except([...userSessions]).emit(event, data);
    }
    
    /**
     * Get undo/redo state for a user
     */
    getUserUndoState(userId, projectId) {
        return this.history.getUserUndoState(userId, projectId);
    }
}

module.exports = UndoStateSync;