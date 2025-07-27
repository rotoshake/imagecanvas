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
        
        // Operation tracker for reliable node correlation
        this.operationTracker = new OperationTracker();
        
        // Last known server state
        this.serverStateVersion = 0;
        
        // Lock to prevent concurrent state updates
        this.updating = false;
        
        // Optimistic update support
        this.optimisticEnabled = true;
        
        this.setupHandlers();
        
        // Start periodic cleanup of orphaned temporary nodes
        this.startPeriodicCleanup();
        
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
        
        // DIAGNOSTIC: Log execution start
        console.log('🔥 EXECUTEOP START:', {
            type: command.type,
            origin: command.origin,
            optimisticEnabled: this.optimisticEnabled,
            willCallOptimistic: this.optimisticEnabled && command.origin === 'local',
            graphNodeCount: this.app?.graph?.nodes?.length || 0,
            operationId: operationId,
            timestamp: Date.now()
        });
        
        // Store operation as pending
        this.pendingOperations.set(operationId, {
            command,
            timestamp: Date.now(),
            rollbackData: null
        });
        
        try {
            // 1. Prepare undo data BEFORE execution for all undoable operations
            const undoableOperations = [
                'node_move', 'node_resize', 'node_rotate', 'node_reset',
                'node_delete', 'node_property_update', 'node_batch_property_update',
                'node_create', 'node_duplicate', 'node_paste'
            ];
            
            if (undoableOperations.includes(command.type) && command.origin === 'local') {
                console.log(`📝 Checking ${command.type} undo data:`, {
                    hasUndoData: !!command.undoData,
                    hasPrepareMethod: typeof command.prepareUndoData === 'function',
                    commandKeys: Object.keys(command),
                    proto: Object.getPrototypeOf(command).constructor.name
                });
                
                if (!command.undoData && typeof command.prepareUndoData === 'function') {
                    const context = {
                        graph: this.app?.graph,
                        canvas: this.app?.graphCanvas
                    };
                    
                    if (context.graph && context.canvas) {
                        try {
                            console.log(`📝 Preparing undo data for ${command.type}`);
                            await command.prepareUndoData(context);
                            console.log('✅ Undo data prepared:', JSON.stringify(command.undoData, null, 2));
                        } catch (error) {
                            console.error(`❌ Error preparing undo data for ${command.type}:`, error);
                        }
                    }
                }
            }
            
            // 2. Apply optimistically if enabled
            let localResult = null;
            let tempNodeIds = [];
            
            if (this.optimisticEnabled && command.origin === 'local') {
                console.log('🔮 ABOUT TO CALL applyOptimistic - graph has', this.app?.graph?.nodes?.length, 'nodes');
                const optimisticResult = await this.applyOptimistic(command);
                console.log('✅ applyOptimistic DONE - graph now has', this.app?.graph?.nodes?.length, 'nodes');
                const pending = this.pendingOperations.get(operationId);
                pending.rollbackData = optimisticResult.rollbackData;
                pending.localResult = optimisticResult.localResult;
                localResult = optimisticResult.localResult;
                
                // Track temporary nodes created
                if (command.type === 'node_duplicate' || command.type === 'node_paste') {
                    if (localResult?.nodes) {
                        tempNodeIds = localResult.nodes.map(n => n.id);
                    } else if (localResult?.node) {
                        tempNodeIds = [localResult.node.id];
                    }
                    
                    // Track this operation
                    this.operationTracker.trackOperation(operationId, {
                        type: command.type,
                        tempNodeIds: tempNodeIds,
                        nodeData: command.params.nodeData
                    });
                }
            }
            
            // 3. Ensure undo data exists for ALL operations (critical for server-authoritative undo)
            // Skip operations already handled above
            if (!command.undoData && !undoableOperations.includes(command.type)) {
                console.log(`📝 Generating undo data for ${command.type} before sending to server`);
                
                // Check if command has prepareUndoData method
                if (!command.prepareUndoData) {
                    console.error(`❌ CRITICAL: Command ${command.type} is missing prepareUndoData method!`);
                    console.error(`This command will not be undoable. Please add prepareUndoData to ${command.constructor.name}`);
                    
                    // Show warning to user
                    if (window.unifiedNotifications) {
                        window.unifiedNotifications.warning(
                            `Operation "${command.type}" may not be undoable - missing undo support`,
                            { duration: 5000 }
                        );
                    }
                } else {
                    // Generate undo data without executing the command
                    try {
                        const context = {
                            graph: this.app?.graph,
                            canvas: this.app?.graphCanvas
                        };
                        
                        if (context.graph && context.canvas) {
                            await command.prepareUndoData(context);
                            if (command.undoData) {
                                console.log(`✅ Generated undo data for ${command.type}`);
                            } else {
                                console.warn(`⚠️ prepareUndoData() did not generate undoData for ${command.type}`);
                            }
                        } else {
                            console.error(`❌ Missing graph or canvas context for ${command.type}`);
                        }
                    } catch (error) {
                        console.error(`❌ Failed to prepare undo data for ${command.type}:`, error);
                        console.error('Error details:', error.stack);
                    }
                }
            } else {
                console.log(`✅ Command ${command.type} already has undo data`);
            }
            
            // Enforce undo data presence for operations that require it
            const undoRequiredOperations = [
                'node_create', 'node_delete', 'node_move', 'node_resize', 
                'node_update', 'node_duplicate', 'node_paste', 'node_rotate',
                'edge_create', 'edge_delete', 'edge_update'
            ];
            
            const finalUndoData = command._generatedUndoData || command.undoData || null;
            
            if (undoRequiredOperations.includes(command.type) && !finalUndoData) {
                console.error(`❌ CRITICAL: Operation ${command.type} has no undo data!`);
                console.error('This operation will be rejected to maintain undo system integrity.');
                
                // Show error to user
                if (window.unifiedNotifications) {
                    window.unifiedNotifications.error(
                        `Operation "${command.type}" failed - missing undo data`,
                        { detail: 'This operation cannot be undone and was rejected for data integrity.' }
                    );
                }
                
                throw new Error(`Operation ${command.type} rejected: missing required undo data`);
            }
            
            // 3. Send to server for authoritative execution
            const serverRequest = {
                operationId,
                type: command.type,
                params: command.params,
                stateVersion: this.serverStateVersion,
                undoData: finalUndoData,
                transactionId: this.app.transactionManager?.getCurrentTransaction()?.id || null
            };
            
            // Log payload size for debugging
            const payloadSize = JSON.stringify(serverRequest).length;
            console.log('📤 Sending operation to server:', {
                type: serverRequest.type,
                operationId: serverRequest.operationId,
                hasUndoData: !!serverRequest.undoData,
                undoDataPreview: serverRequest.undoData ? Object.keys(serverRequest.undoData) : null,
                payloadSize: payloadSize,
                payloadSizeMB: (payloadSize / 1024 / 1024).toFixed(2) + 'MB'
            });
            
            // Check and warn about large payloads
            const MAX_SAFE_SIZE = 50 * 1024; // 50KB warning threshold
            
            if (payloadSize > MAX_SAFE_SIZE) {
                console.warn(`⚠️ Large operation payload: ${(payloadSize / 1024 / 1024).toFixed(2)}MB for ${command.type}`);
                
                // Check if it contains embedded image data
                if (JSON.stringify(serverRequest).includes('data:image')) {
                    console.error('❌ Operation contains embedded image data - this will likely fail');
                    console.error('   Images should be uploaded via HTTP first, not sent through WebSocket');
                    
                    // Show user notification
                    if (window.unifiedNotifications) {
                        window.unifiedNotifications.error(
                            'Operation too large',
                            { detail: 'Images must be uploaded before creating nodes. This operation will likely fail.' }
                        );
                    }
                }
            }
            if (!this.network) {
                throw new Error('Network layer not initialized');
            }
            
            // Mark as sent in tracker
            if (tempNodeIds.length > 0) {
                this.operationTracker.markSent(operationId);
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
        
        // Capture undo data generated during execution
        if (command.undoData) {
            console.log(`📝 Command generated undo data:`, command.undoData);
            command._generatedUndoData = command.undoData;
        }
        
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
        const { stateVersion, changes, operationId, isUndo, isRedo } = data;
        
        // Ignore if we're behind (full sync needed)
        if (stateVersion > this.serverStateVersion + 1) {
            console.log('⚠️ State version gap detected, requesting full sync');
            this.requestFullSync();
            return;
        }
        
        // Clear optimistic update flags for nodes updated by this operation
        if (operationId && changes?.updated) {
            changes.updated.forEach(nodeData => {
                const node = this.app.graph.getNodeById(nodeData.id);
                if (node && node._optimisticUpdate && node._optimisticUpdate.operationId === operationId) {
                    console.log(`✅ Clearing optimistic update flag for node ${node.id} - server confirmed`);
                    delete node._optimisticUpdate;
                }
            });
        }
        
        // For large updates, queue if we're already processing
        const isLargeUpdate = (changes?.added?.length > 20 || changes?.updated?.length > 20 || changes?.removed?.length > 20);
        
        if (this.updating) {
            // Add safety mechanism to prevent infinite loops
            if (!data._retryCount) data._retryCount = 0;
            data._retryCount++;
            
            if (data._retryCount > 10) {
                console.error('❌ Too many retries for state update, forcing through');
                this.updating = false; // Force reset
            } else {
                if (isLargeUpdate) {
                    // console.log(`⏳ Large update in progress, queueing (${changes?.added?.length || 0} adds, ${changes?.updated?.length || 0} updates)...`);
                } else {
                    // console.log('⏳ Update in progress, queueing...');
                }
                setTimeout(() => this.handleServerStateUpdate(data), isLargeUpdate ? 500 : 100);
                return;
            }
        }
        
        this.updating = true;
        
        try {
            // If we have an operation ID, mark it as acknowledged in tracker
            if (operationId && changes?.added?.length > 0) {
                const trackedOp = this.operationTracker.pendingOperations.get(operationId);
                if (trackedOp) {
                    console.log(`📊 Marking operation ${operationId} as acknowledged with ${changes.added.length} nodes`);
                    this.operationTracker.markAcknowledged(operationId, changes.added);
                }
            }
            
            // Apply changes with better tracking
            await this.applyServerChanges(changes, operationId, isUndo || isRedo);
            
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
    async applyServerChanges(changes, operationId, forceUpdate = false) {
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
            const addedNodeIds = [];
            const processedTempNodes = new Set();
            
            for (const nodeData of added) {
                // Check if server node already exists
                const existingNode = this.app.graph.getNodeById(nodeData.id);
                if (existingNode) {
                    console.log(`⏭️ Skipping server node ${nodeData.id} - already exists`);
                    continue;
                }
                addedNodeIds.push(nodeData.id);
                
                // Check for temporary nodes that should be replaced
                // Use OperationTracker for reliable correlation
                let tempNode = null;
                if (operationId) {
                    const serverNodeData = this.operationTracker.getServerNodeForTemp(nodeData.id);
                    if (serverNodeData) {
                        // Find temp node using tracker's correlation
                        const operation = this.operationTracker.pendingOperations.get(operationId);
                        if (operation && operation.tempNodeIds) {
                            const nodeIndex = added.indexOf(nodeData);
                            const tempNodeId = operation.tempNodeIds[nodeIndex];
                            if (tempNodeId) {
                                tempNode = this.app.graph.getNodeById(tempNodeId);
                                console.log(`🎯 Found temp node via tracker: ${tempNodeId} -> ${nodeData.id}`);
                            }
                        }
                    }
                }
                
                // Fallback to old methods if tracker doesn't have it
                if (!tempNode) {
                    tempNode = this.findTemporaryNodeByOperationId(nodeData._operationId) ||
                              this.findTemporaryNodeAtPosition(nodeData.pos, nodeData.type);
                }
                if (tempNode && !processedTempNodes.has(tempNode.id)) {
                    console.log(`🔄 Found temporary node to replace: temp:${tempNode.id} -> server:${nodeData.id} at [${nodeData.pos[0]}, ${nodeData.pos[1]}]`);
                    processedTempNodes.add(tempNode.id);
                    
                    // Transfer any important state from temp node
                    const wasSelected = this.app.graphCanvas?.selection?.isSelected(tempNode);
                    
                    // Remove temporary node
                    if (this.app.graphCanvas?.selection) {
                        this.app.graphCanvas.selection.deselectNode(tempNode);
                    }
                    this.app.graph.remove(tempNode);
                    
                    // Mark as replaced in tracker
                    if (this.operationTracker.isNodeTracked(tempNode.id)) {
                        this.operationTracker.markNodeReplaced(tempNode.id);
                    }
                    
                    // Create server node
                    console.log(`➕ Adding server node: ${nodeData.id}:${nodeData.type} at [${nodeData.pos[0]}, ${nodeData.pos[1]}]`);
                    const node = await this.createNodeFromData(nodeData);
                    if (node) {
                        // Clear sync pending flags since we've successfully synced
                        delete node._syncPending;
                        delete node._operationId;
                        
                        this.app.graph.add(node);
                        console.log(`✅ Server node added successfully: ${node.id} (total nodes: ${this.app.graph.nodes.length})`);
                        
                        // Notify upload coordinator for image nodes
                        if (node.type === 'media/image' && this.app.imageUploadCoordinator) {
                            this.app.imageUploadCoordinator.onImageNodeCreated(node);
                        }
                        
                        // Restore selection if it was selected
                        if (wasSelected && this.app.graphCanvas?.selection) {
                            this.app.graphCanvas.selection.selectNode(node, true);
                        }
                    }
                } else {
                    if (tempNode) {
                        console.log(`⚠️ Temporary node ${tempNode.id} already processed`);
                    } else {
                        console.log(`🔍 No temporary node found at [${nodeData.pos[0]}, ${nodeData.pos[1]}] for type:${nodeData.type}`);
                    }
                    
                    // Create server node anyway
                    console.log(`➕ Adding server node: ${nodeData.id}:${nodeData.type} at [${nodeData.pos[0]}, ${nodeData.pos[1]}]`);
                    const node = await this.createNodeFromData(nodeData);
                    if (node) {
                        this.app.graph.add(node);
                        console.log(`✅ Server node added successfully: ${node.id} (total nodes: ${this.app.graph.nodes.length})`);
                        
                        // Notify upload coordinator for image nodes
                        if (node.type === 'media/image' && this.app.imageUploadCoordinator) {
                            this.app.imageUploadCoordinator.onImageNodeCreated(node);
                        }
                    } else {
                        console.error(`❌ Failed to create node from server data:`, nodeData);
                    }
                }
            }
            
            // Don't clean up immediately - let the tracker verify all nodes are replaced
            // The periodic cleanup will handle truly orphaned nodes
            console.log('📊 Server changes applied, tracker will verify replacements');
            
            // Check if we need to restore selection for these nodes
            if (this.app.graphCanvas?._pendingSelectionNodeIds && addedNodeIds.length > 0) {
                const pendingIds = this.app.graphCanvas._pendingSelectionNodeIds;
                const canvas = this.app.graphCanvas;
                
                // Select any of the newly added nodes that match pending selection
                addedNodeIds.forEach(nodeId => {
                    if (pendingIds.includes(nodeId)) {
                        const node = this.app.graph.getNodeById(nodeId);
                        if (node) {
                            canvas.selection.selectNode(node, true);
                        }
                    }
                });
                
                // Clear pending selection list
                delete canvas._pendingSelectionNodeIds;
            }
            
            // No longer using NodeSyncValidator - server handles validation gracefully
        }
        
        // Update existing nodes
        if (updated) {
            for (const nodeData of updated) {
                const node = this.app.graph.getNodeById(nodeData.id);
                if (node) {
                    // Check if this node was modified by a pending optimistic operation
                    const hasPendingOptimisticUpdate = this.isNodePendingOptimisticUpdate(nodeData.id);
                    if (!hasPendingOptimisticUpdate || forceUpdate) {
                        // Update if we don't have a pending optimistic update OR if it's a forced update (undo/redo)
                        const oldState = {
                            pos: [...node.pos],
                            size: [...node.size],
                            rotation: node.rotation
                        };
                        
                        // For forced updates (undo/redo), clear optimistic flag to ensure update is applied
                        if (forceUpdate && node._optimisticUpdate) {
                            console.log(`🔄 Clearing optimistic flag for forced update on node ${node.id}`);
                            delete node._optimisticUpdate;
                        }
                        
                        console.log(`📊 About to update node ${nodeData.id} with data:`, {
                            hasRotation: 'rotation' in nodeData,
                            rotation: nodeData.rotation,
                            currentRotation: node.rotation,
                            forceUpdate
                        });
                        
                        this.updateNodeFromData(node, nodeData);
                        
                        if (forceUpdate) {
                            console.log(`🔄 Force updating node ${nodeData.id} for undo/redo`, {
                                oldPos: oldState.pos,
                                newPos: nodeData.pos ? [...nodeData.pos] : null,
                                oldSize: oldState.size,
                                newSize: nodeData.size ? [...nodeData.size] : null,
                                oldRotation: oldState.rotation,
                                newRotation: nodeData.rotation,
                                posChanged: nodeData.pos && (
                                    Math.abs(oldState.pos[0] - nodeData.pos[0]) > 0.1 || 
                                    Math.abs(oldState.pos[1] - nodeData.pos[1]) > 0.1
                                ),
                                sizeChanged: nodeData.size && (
                                    Math.abs(oldState.size[0] - nodeData.size[0]) > 0.1 || 
                                    Math.abs(oldState.size[1] - nodeData.size[1]) > 0.1
                                ),
                                rotationChanged: nodeData.rotation !== undefined && 
                                    Math.abs((oldState.rotation || 0) - (nodeData.rotation || 0)) > 0.01
                            });
                        }
                    }
                }
            }
        }
        
        // Ensure canvas is marked dirty for undo/redo operations
        if (forceUpdate && (updated?.length > 0 || added?.length > 0 || removed?.length > 0)) {
            if (this.app?.graphCanvas) {
                this.app.graphCanvas.dirty_canvas = true;
                this.app.graphCanvas.dirty_bgcanvas = true;
                console.log('🎨 Canvas marked dirty for undo/redo update');
                
                // Force immediate redraw for undo/redo to ensure visual update
                requestAnimationFrame(() => {
                    if (this.app?.graphCanvas?.draw) {
                        this.app.graphCanvas.draw();
                        console.log('🎨 Canvas redrawn for undo/redo');
                    }
                });
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
            
            // Force canvas redraw to show loading states (only set once)
            if (this.app.graphCanvas) {
                this.app.graphCanvas.dirty_canvas = true;
            }
            
            console.log('✅ Full state sync complete');
            
            // No longer using NodeSyncValidator - server handles validation gracefully
            
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
        if (nodeData.title !== node.title) {
            // console.log(`🔄 Server updating title: "${node.title}" → "${nodeData.title}" for node ${nodeData.id}`);
        }
        node.title = nodeData.title;
        
        // Restore aspect ratio if available
        if (nodeData.aspectRatio !== undefined) {
            node.aspectRatio = nodeData.aspectRatio;
        }
        
        // Handle media nodes
        if (node.type === 'media/image') {
            // Set loading state immediately for visual feedback
            node.loadingState = 'loading';
            node.loadingProgress = 0;
            
            // For reference-based nodes, we don't pass src directly
            // The node will resolve it from hash/serverUrl
            node.setImage(
                nodeData.properties.serverUrl || null, // Pass serverUrl if available
                nodeData.properties.filename,
                nodeData.properties.hash
            );
            
            // Log what we're creating
            // console.log(`🖼️ Creating image node ${node.id} with references:`, {
            //     hash: nodeData.properties.hash?.substring(0, 8),
            //     hasServerUrl: !!nodeData.properties.serverUrl,
            //     filename: nodeData.properties.filename
            // });
            
        } else if (node.type === 'media/video' && nodeData.properties.src) {
            // Don't await so loading state is visible
            node.setVideo(
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
        // Check if this node has a recent optimistic update that should be preserved
        if (node._optimisticUpdate) {
            const age = Date.now() - node._optimisticUpdate.timestamp;
            // Skip server updates for recent optimistic updates (within 2 seconds)
            if (age < 2000) {
                console.log(`⏭️ Skipping server update for node ${node.id} due to recent optimistic ${node._optimisticUpdate.type} update`);
                return;
            } else {
                // Clear old optimistic update flag
                delete node._optimisticUpdate;
            }
        }
        
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
            // Check if this is an image node getting a new serverUrl
            const hadServerUrl = node.properties?.serverUrl;
            const willHaveServerUrl = nodeData.properties?.serverUrl;
            
            Object.assign(node.properties, nodeData.properties);
            
            // If image node just got a serverUrl (from upload in another tab), trigger loading
            if (node.type === 'media/image' && !hadServerUrl && willHaveServerUrl) {
                console.log(`🖼️ Image node ${node.id} received serverUrl from sync: ${willHaveServerUrl}`);
                console.log(`🔍 Node title before setImage: "${node.title}"`);
                // Trigger image loading with the new serverUrl
                if (node.setImage) {
                    node.setImage(
                        willHaveServerUrl,
                        node.properties.filename,
                        node.properties.hash
                    );
                }
            }
        }
        
        // Update other attributes
        if (nodeData.rotation !== undefined) {
            console.log(`🔄 updateNodeFromData changing rotation: ${node.rotation} → ${nodeData.rotation} for node ${node.id}`);
            node.rotation = nodeData.rotation;
        }
        
        if (nodeData.flags) {
            Object.assign(node.flags, nodeData.flags);
        }
        
        if (nodeData.title !== undefined) {
            if (nodeData.title !== node.title) {
                console.log(`🔄 updateNodeFromData changing title: "${node.title}" → "${nodeData.title}" for node ${node.id}`);
            }
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
            // Use UndoOptimization if available, otherwise optimize inline
            if (window.UndoOptimization) {
                states.push(window.UndoOptimization.optimizeNodeData(node));
            } else {
                // Inline optimization for image nodes
                const nodeData = {
                    id: node.id,
                    type: node.type,
                    pos: [...node.pos],
                    size: [...node.size],
                    properties: { ...node.properties },
                    rotation: node.rotation,
                    flags: { ...node.flags },
                    title: node.title,
                    aspectRatio: node.aspectRatio
                };
                
                // Remove data URLs from image/video nodes
                if ((node.type === 'media/image' || node.type === 'media/video') && 
                    nodeData.properties.src?.startsWith('data:')) {
                    // Keep only references
                    nodeData.properties = {
                        hash: node.properties.hash,
                        serverUrl: node.properties.serverUrl,
                        filename: node.properties.filename,
                        scale: node.properties.scale || 1.0
                    };
                }
                
                states.push(nodeData);
            }
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
        
        // Update operation tracking time and request undo state
        if (window.app?.undoManager) {
            // Track operation time to prevent premature undo requests
            window.app.undoManager.lastOperationTime = Date.now();
            console.log('📋 Requesting undo state after operation acknowledgment');
            window.app.undoManager.requestUndoState();
        }
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
     * Find temporary node by operation ID
     */
    findTemporaryNodeByOperationId(operationId) {
        if (!operationId) return null;
        
        for (const node of this.app.graph.nodes) {
            if (node._operationId === operationId) {
                console.log(`🎯 Found node by operation ID: ${operationId}`);
                return node;
            }
        }
        
        return null;
    }
    
    /**
     * Find temporary node at given position
     */
    findTemporaryNodeAtPosition(pos, type) {
        // Increase tolerance for better matching with floating point positions
        const tolerance = 5; // 5 pixel tolerance for position matching
        
        // Find best match
        let bestMatch = null;
        let bestDistance = Infinity;
        
        for (const node of this.app.graph.nodes) {
            if (node._isTemporary && node.type === type) {
                const dx = node.pos[0] - pos[0];
                const dy = node.pos[1] - pos[1];
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < tolerance && distance < bestDistance) {
                    bestMatch = node;
                    bestDistance = distance;
                }
            }
        }
        
        // Only log if no match found (to help debug issues)
        if (!bestMatch) {
            console.log(`🔍 No temporary node found at [${pos[0]}, ${pos[1]}] for type:${type}`);
        }
        
        return bestMatch;
    }
    
    /**
     * Clean up orphaned temporary nodes - now based on operation tracking
     */
    cleanupOrphanedTemporaryNodes() {
        // Skip cleanup if bulk operation in progress
        if (this.app.bulkOperationInProgress) {
            console.log('⏸️ Skipping cleanup - bulk operation in progress');
            return;
        }
        
        // First, let tracker clean up old operations
        this.operationTracker.cleanup();
        
        // Get unresolved nodes from tracker
        const unresolvedNodes = this.operationTracker.getUnresolvedNodes();
        const now = Date.now();
        const nodesToClean = [];
        
        // Adjust timeouts based on graph size
        const nodeCount = this.app.graph.nodes.length;
        const trackedTimeout = nodeCount > 100 ? 60000 : 30000; // 60s for 100+ nodes
        const untrackedTimeout = nodeCount > 100 ? 45000 : 10000; // 45s for 100+ nodes
        
        // Count temporary nodes for diagnostics
        let tempNodeCount = 0;
        let trackedCount = 0;
        let untrackedCount = 0;
        
        for (const node of this.app.graph.nodes) {
            if (node._isTemporary) {
                tempNodeCount++;
                // Check if this node is tracked
                const isTracked = this.operationTracker.isNodeTracked(node.id);
                
                if (isTracked) {
                    trackedCount++;
                    // Node is tracked - check if operation timed out
                    const unresolved = unresolvedNodes.find(u => u.tempId === node.id);
                    if (unresolved && unresolved.age > trackedTimeout) {
                        console.log(`⏱️ Cleaning up timed-out node: ${node.id} (operation: ${unresolved.operationId}, age: ${Math.round(unresolved.age/1000)}s)`);
                        nodesToClean.push(node);
                    }
                } else {
                    untrackedCount++;
                    // Untracked temporary node - use old logic
                    if (!node._temporaryCreatedAt) {
                        node._temporaryCreatedAt = now;
                    } else if (now - node._temporaryCreatedAt > untrackedTimeout) {
                        // Give untracked nodes more time based on graph size
                        const nodeAge = Math.round((now - node._temporaryCreatedAt) / 1000);
                        console.log(`🧹 Cleaning up untracked temp node: ${node.id} (age: ${nodeAge}s)`);
                        nodesToClean.push(node);
                    }
                }
            }
        }
        
        // Log diagnostic info if we have many temp nodes
        if (tempNodeCount > 10) {
            console.log(`📊 Temp node status: ${tempNodeCount} total (${trackedCount} tracked, ${untrackedCount} untracked), cleaning ${nodesToClean.length}`);
        }
        
        if (nodesToClean.length > 0) {
            console.log(`🧹 Cleaning up ${nodesToClean.length} orphaned nodes (timeouts: ${trackedTimeout/1000}s tracked, ${untrackedTimeout/1000}s untracked)`);
            nodesToClean.forEach(node => {
                // Remove from selection first
                if (this.app.graphCanvas?.selection) {
                    this.app.graphCanvas.selection.deselectNode(node);
                }
                this.app.graph.remove(node);
            });
        }
        
        // Log tracker stats periodically
        if (Math.random() < 0.1) { // 10% chance
            const stats = this.operationTracker.getStats();
            console.log('📊 Operation Tracker Stats:', stats);
        }
    }
    
    /**
     * Generate unique operation ID
     */
    generateOperationId() {
        return `${this.network.tabId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Start periodic cleanup of orphaned temporary nodes
     */
    startPeriodicCleanup() {
        // Run cleanup every 10 seconds
        this.cleanupInterval = setInterval(() => {
            if (!this.updating && this.app?.graph) {
                this.cleanupOrphanedTemporaryNodes();
            }
        }, 10000);
    }
    
    /**
     * Stop periodic cleanup
     */
    stopPeriodicCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
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