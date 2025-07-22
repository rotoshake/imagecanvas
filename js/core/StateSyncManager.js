/**
 * StateSyncManager - Implements server-authoritative state synchronization
 * 
 * Key principles:
 * 1. Server holds the single source of truth
 * 2. All changes go through server first
 * 3. Clients receive and apply server state updates
 * 4. Local changes are optimistically applied but can be rolled back
 */
class StateSyncManager {
    constructor(app, networkLayer) {
        this.app = app;
        this.network = networkLayer;
        
        // Pending operations waiting for server confirmation
        this.pendingOperations = new Map();
        
        // Last known server state
        this.serverStateVersion = 0;
        
        // Lock to prevent concurrent state updates
        this.updating = false;
        
        // Optimistic update support
        this.optimisticEnabled = true;
        
        this.setupHandlers();
        console.log('🔄 StateSyncManager initialized');
    }
    
    setupHandlers() {
        console.log('🔄 Setting up StateSyncManager handlers');
        
        // Listen for server state updates
        this.network.on('state_update', this.handleServerStateUpdate.bind(this));
        
        // Listen for operation acknowledgments
        this.network.on('operation_ack', this.handleOperationAck.bind(this));
        
        // Listen for operation rejection
        this.network.on('operation_rejected', this.handleOperationRejected.bind(this));
        
        // Listen for full state sync
        this.network.on('full_state_sync', this.handleFullStateSync.bind(this));
        
        console.log('✅ StateSyncManager handlers registered');
    }
    
    /**
     * Execute an operation with server-authoritative sync
     */
    async executeOperation(command) {
        const operationId = this.generateOperationId();
        
        // Store operation as pending
        this.pendingOperations.set(operationId, {
            command,
            timestamp: Date.now(),
            rollbackData: null
        });
        
        try {
            // 1. Apply optimistically if enabled
            let localResult = null;
            if (this.optimisticEnabled && command.origin === 'local') {
                const optimisticResult = await this.applyOptimistic(command);
                const pending = this.pendingOperations.get(operationId);
                pending.rollbackData = optimisticResult.rollbackData;
                pending.localResult = optimisticResult.localResult;
                localResult = optimisticResult.localResult;
            }
            
            // 2. Send to server for authoritative execution
            const serverRequest = {
                operationId,
                type: command.type,
                params: command.params,
                stateVersion: this.serverStateVersion
            };
            
            console.log('📤 Sending operation to server:', serverRequest);
            if (!this.network) {
                throw new Error('Network layer not initialized');
            }
            this.network.emit('execute_operation', serverRequest);
            
            // 3. Wait for server response (with timeout)
            // Increase timeout for operations with image/video data or serverUrl
            const hasMediaData = command.params.imageData || command.params.videoData || 
                               (command.params.properties && command.params.properties.serverUrl);
            const timeout = hasMediaData ? 30000 : 5000; // 30s for media, 5s for others
            console.log(`⏱️ Waiting for server response with ${timeout}ms timeout for ${command.type} operation`);
            const response = await this.waitForServerResponse(operationId, timeout);
            
            if (response.success) {
                // Clean up optimistic nodes before server state update arrives
                if (this.optimisticEnabled && command.origin === 'local') {
                    await this.cleanupOptimisticOperation(operationId, command, response);
                }
                
                // Remove from pending
                this.pendingOperations.delete(operationId);
                // Return the server response with the local result included
                return { ...response, result: localResult };
            } else {
                // Operation rejected - rollback if needed
                console.error('Operation rejected by server:', {
                    type: command.type,
                    params: command.params,
                    error: response.error,
                    stateVersion: this.serverStateVersion
                });
                await this.rollbackOperation(operationId);
                throw new Error(response.error || 'Operation rejected by server');
            }
            
        } catch (error) {
            console.error('Operation failed:', error);
            await this.rollbackOperation(operationId);
            throw error;
        }
    }
    
    /**
     * Apply operation optimistically
     */
    async applyOptimistic(command) {
        // Capture current state for rollback
        const rollbackData = {
            nodes: this.captureNodeStates()
        };
        
        // Apply locally
        const context = {
            graph: this.app?.graph,
            canvas: this.app?.graphCanvas
        };
        
        if (!context.graph || !context.canvas) {
            throw new Error('App not properly initialized');
        }
        
        const localResult = await command.execute(context);
        
        // Log optimistic operation result
        if (command.type === 'node_create' && localResult?.node) {
            console.log(`🔮 Optimistic node created: ${localResult.node.id}:${localResult.node.type} at [${localResult.node.pos[0]}, ${localResult.node.pos[1]}]`);
        }
        
        // Update canvas
        if (this.app?.graphCanvas) {
            this.app.graphCanvas.dirty_canvas = true;
        }
        
        return { rollbackData, localResult };
    }
    
    /**
     * Rollback an operation
     */
    async rollbackOperation(operationId) {
        const pending = this.pendingOperations.get(operationId);
        if (!pending || !pending.rollbackData) return;
        
        console.log('🔄 Rolling back operation:', operationId);
        
        // Restore previous state
        this.restoreNodeStates(pending.rollbackData?.nodes || pending.rollbackData);
        
        // Remove from pending
        this.pendingOperations.delete(operationId);
        
        // Update canvas
        if (this.app?.graphCanvas) {
            this.app.graphCanvas.dirty_canvas = true;
        }
    }
    
    /**
     * Handle server state update
     */
    async handleServerStateUpdate(data) {
        const { stateVersion, changes, operationId } = data;
        
        // Ignore if we're behind (full sync needed)
        if (stateVersion > this.serverStateVersion + 1) {
            console.log('⚠️ State version gap detected, requesting full sync');
            this.requestFullSync();
            return;
        }
        
        // Lock updates
        if (this.updating) {
            console.log('⏳ Update in progress, queueing...');
            setTimeout(() => this.handleServerStateUpdate(data), 100);
            return;
        }
        
        this.updating = true;
        
        try {
            // Apply changes
            await this.applyServerChanges(changes);
            
            // Update version
            this.serverStateVersion = stateVersion;
            
            // If this confirms our operation, remove from pending
            if (operationId && this.pendingOperations.has(operationId)) {
                this.pendingOperations.delete(operationId);
            }
            
            // Update canvas
            this.app.graphCanvas.dirty_canvas = true;
            
        } finally {
            this.updating = false;
        }
    }
    
    /**
     * Apply changes from server
     */
    async applyServerChanges(changes) {
        const { added, updated, removed } = changes;
        
        // Remove nodes
        if (removed) {
            removed.forEach(nodeId => {
                const node = this.app.graph.getNodeById(nodeId);
                if (node) {
                    this.app.graph.remove(node);
                }
            });
        }
        
        // Add new nodes
        if (added) {
            for (const nodeData of added) {
                // Check if server node already exists
                const existingNode = this.app.graph.getNodeById(nodeData.id);
                if (existingNode) {
                    console.log(`⏭️ Skipping server node ${nodeData.id} - already exists`);
                    continue;
                }
                
                console.log(`➕ Adding server node: ${nodeData.id}:${nodeData.type} at [${nodeData.pos[0]}, ${nodeData.pos[1]}]`);
                const node = await this.createNodeFromData(nodeData);
                if (node) {
                    this.app.graph.add(node);
                    console.log(`✅ Server node added successfully: ${node.id} (total nodes: ${this.app.graph.nodes.length})`);
                } else {
                    console.error(`❌ Failed to create node from server data:`, nodeData);
                }
            }
        }
        
        // Update existing nodes
        if (updated) {
            for (const nodeData of updated) {
                const node = this.app.graph.getNodeById(nodeData.id);
                if (node) {
                    // Check if this node was modified by a pending optimistic operation
                    const hasPendingOptimisticUpdate = this.isNodePendingOptimisticUpdate(nodeData.id);
                    if (!hasPendingOptimisticUpdate) {
                        // Only update if we don't have a pending optimistic update for this node
                        this.updateNodeFromData(node, nodeData);
                    }
                }
            }
        }
    }
    
    /**
     * Check if a node has pending optimistic updates
     */
    isNodePendingOptimisticUpdate(nodeId) {
        // Check all pending operations to see if any affect this node
        for (const [opId, pending] of this.pendingOperations) {
            const command = pending.command;
            if (!command) continue;
            
            // Check if this operation affects the given node
            if (command.params.nodeId === nodeId) return true;
            if (command.params.nodeIds && command.params.nodeIds.includes(nodeId)) return true;
            
            // For operations that create nodes, check the result
            if (pending.localResult?.node?.id === nodeId) return true;
            if (pending.localResult?.nodes?.some(n => n.id === nodeId)) return true;
        }
        
        return false;
    }
    
    /**
     * Handle full state sync from server
     */
    async handleFullStateSync(data) {
        const { state, stateVersion } = data;
        
        console.log('📥 Receiving full state sync, version:', stateVersion);
        
        this.updating = true;
        
        try {
            // Clear current graph
            this.app.graph.clear();
            
            // Rebuild from server state
            for (const nodeData of state.nodes || []) {
                const node = await this.createNodeFromData(nodeData);
                if (node) {
                    this.app.graph.add(node);
                }
            }
            
            // Update version
            this.serverStateVersion = stateVersion;
            
            // Clear pending operations (they're invalid now)
            this.pendingOperations.clear();
            
            // Update canvas
            this.app.graphCanvas.dirty_canvas = true;
            
            console.log('✅ Full state sync complete');
            
        } finally {
            this.updating = false;
        }
    }
    
    /**
     * Request full state sync from server
     */
    requestFullSync() {
        console.log('📤 Requesting full state sync');
        if (this.network) {
            this.network.emit('request_full_sync', {
                projectId: this.network.currentProject?.id
            });
        } else {
            console.error('Cannot request full sync - network not initialized');
        }
    }
    
    /**
     * Create node from server data
     */
    async createNodeFromData(nodeData) {
        const node = NodeFactory.createNode(nodeData.type);
        if (!node) return null;
        
        // Apply all properties
        node.id = nodeData.id;
        node.pos = [...nodeData.pos];
        node.size = [...nodeData.size];
        node.properties = { ...nodeData.properties };
        node.rotation = nodeData.rotation || 0;
        node.flags = { ...nodeData.flags };
        node.title = nodeData.title;
        
        // Restore aspect ratio if available
        if (nodeData.aspectRatio !== undefined) {
            node.aspectRatio = nodeData.aspectRatio;
        }
        
        // Handle media nodes
        if (node.type === 'media/image' && nodeData.properties.src) {
            await node.setImage(
                nodeData.properties.src,
                nodeData.properties.filename,
                nodeData.properties.hash
            );
        } else if (node.type === 'media/video' && nodeData.properties.src) {
            await node.setVideo(
                nodeData.properties.src,
                nodeData.properties.filename,
                nodeData.properties.hash
            );
        }
        
        return node;
    }
    
    /**
     * Update node from server data
     */
    updateNodeFromData(node, nodeData) {
        // Update position and size together for rotated nodes
        const hasPositionUpdate = nodeData.pos && (
            Math.abs(node.pos[0] - nodeData.pos[0]) > 0.1 || 
            Math.abs(node.pos[1] - nodeData.pos[1]) > 0.1
        );
        const hasSizeUpdate = nodeData.size && (
            Math.abs(node.size[0] - nodeData.size[0]) > 0.1 || 
            Math.abs(node.size[1] - nodeData.size[1]) > 0.1
        );
        
        // Update position
        if (hasPositionUpdate) {
            node.pos[0] = nodeData.pos[0];
            node.pos[1] = nodeData.pos[1];
        }
        
        // Update size  
        if (hasSizeUpdate) {
            node.size[0] = nodeData.size[0];
            node.size[1] = nodeData.size[1];
        }
        
        // Always update aspect ratio if provided, regardless of size change
        // This preserves non-uniform scaling even for small adjustments
        if (nodeData.aspectRatio !== undefined) {
            node.aspectRatio = nodeData.aspectRatio;
        }
        
        // Only call onResize for local changes, not for server sync
        // Server data should be trusted as authoritative
        // if (node.onResize) {
        //     node.onResize();
        // }
        
        // Update properties
        if (nodeData.properties) {
            Object.assign(node.properties, nodeData.properties);
        }
        
        // Update other attributes
        if (nodeData.rotation !== undefined) {
            node.rotation = nodeData.rotation;
        }
        
        if (nodeData.flags) {
            Object.assign(node.flags, nodeData.flags);
        }
        
        if (nodeData.title !== undefined) {
            node.title = nodeData.title;
        }
        
        // Update aspect ratio
        if (nodeData.aspectRatio !== undefined) {
            node.aspectRatio = nodeData.aspectRatio;
        }
    }
    
    /**
     * Capture current node states for rollback
     */
    captureNodeStates() {
        const states = [];
        
        for (const node of this.app.graph.nodes) {
            states.push({
                id: node.id,
                type: node.type,
                pos: [...node.pos],
                size: [...node.size],
                properties: { ...node.properties },
                rotation: node.rotation,
                flags: { ...node.flags },
                title: node.title,
                aspectRatio: node.aspectRatio
            });
        }
        
        return states;
    }
    
    /**
     * Restore node states
     */
    restoreNodeStates(states) {
        // Create a map for quick lookup
        const stateMap = new Map(states.map(s => [s.id, s]));
        
        // Remove nodes not in saved state
        const toRemove = [];
        for (const node of this.app.graph.nodes) {
            if (!stateMap.has(node.id)) {
                toRemove.push(node);
            }
        }
        toRemove.forEach(node => this.app.graph.remove(node));
        
        // Update existing and add missing nodes
        for (const state of states) {
            let node = this.app.graph.getNodeById(state.id);
            
            if (!node) {
                // Recreate node
                node = NodeFactory.createNode(state.type);
                if (!node) continue;
                
                node.id = state.id;
                this.app.graph.add(node);
            }
            
            // Restore state
            this.updateNodeFromData(node, state);
        }
    }
    
    /**
     * Wait for server response with timeout
     */
    async waitForServerResponse(operationId, timeout) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Server response timeout'));
            }, timeout);
            
            const cleanup = () => {
                clearTimeout(timer);
                this.network.off('operation_ack', ackHandler);
                this.network.off('operation_rejected', rejectHandler);
            };
            
            const ackHandler = (data) => {
                if (data.operationId === operationId) {
                    cleanup();
                    resolve({ success: true, ...data });
                }
            };
            
            const rejectHandler = (data) => {
                if (data.operationId === operationId) {
                    cleanup();
                    resolve({ success: false, ...data });
                }
            };
            
            this.network.on('operation_ack', ackHandler);
            this.network.on('operation_rejected', rejectHandler);
        });
    }
    
    /**
     * Handle operation acknowledgment
     */
    handleOperationAck(data) {
        // Handled by waitForServerResponse
    }
    
    /**
     * Handle operation rejection
     */
    handleOperationRejected(data) {
        // Handled by waitForServerResponse
    }
    
    /**
     * Clean up optimistic operation after server confirmation
     */
    async cleanupOptimisticOperation(operationId, command, serverResponse) {
        const pending = this.pendingOperations.get(operationId);
        if (!pending || !pending.rollbackData) return;
        
        console.log('🧹 Cleaning up optimistic operation:', command.type, operationId);
        
        // For node creation: remove the optimistic node so server node can be added cleanly
        if (command.type === 'node_create') {
            // Find any nodes that were added optimistically
            const currentNodes = this.app.graph.nodes.slice(); // Make a copy to iterate safely
            const nodesBeforeCleanup = currentNodes.length;
            
            for (const node of currentNodes) {
                // Remove nodes that weren't in the rollback state (i.e., were added optimistically)
                const wasInRollback = pending.rollbackData.nodes?.some(rollbackNode => rollbackNode.id === node.id);
                if (!wasInRollback) {
                    console.log(`🗑️ Removing optimistic node: ${node.id}:${node.type} (created at ${node.pos[0]}, ${node.pos[1]})`);
                    // Also remove from selection to prevent issues
                    if (this.app.graphCanvas.selection) {
                        this.app.graphCanvas.selection.deselectNode(node);
                    }
                    this.app.graph.remove(node);
                }
            }
            
            const nodesAfterCleanup = this.app.graph.nodes.length;
            console.log(`🧹 Cleanup complete: removed ${nodesBeforeCleanup - nodesAfterCleanup} optimistic nodes`);
        }
        
        // For other operations, rollback data handling may be different
        // but for now, creation is the main culprit for phantom nodes
    }
    
    /**
     * Generate unique operation ID
     */
    generateOperationId() {
        return `${this.network.tabId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Get sync statistics
     */
    getStats() {
        return {
            serverVersion: this.serverStateVersion,
            pendingOperations: this.pendingOperations.size,
            isUpdating: this.updating,
            optimisticEnabled: this.optimisticEnabled
        };
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.StateSyncManager = StateSyncManager;
}