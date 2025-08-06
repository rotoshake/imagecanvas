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
        
        // Debug logging control
        this.debugLevel = 0; // 0 = errors only, 1 = warnings, 2 = info, 3 = verbose
        
        this.setupHandlers();
        
        // Start periodic cleanup of orphaned temporary nodes
        this.startPeriodicCleanup();
        
    }
    
    /**
     * Debug logging with level control
     */
    debugLog(level, message, ...args) {
        if (this.debugLevel >= level) {
            
        }
    }
    
    setupHandlers() {
        
        // Listen for server state updates
        this.network.on('state_update', this.handleServerStateUpdate.bind(this));
        
        // Listen for operation acknowledgments
        this.network.on('operation_ack', this.handleOperationAck.bind(this));
        
        // Listen for operation rejection
        this.network.on('operation_rejected', this.handleOperationRejected.bind(this));
        
        // Listen for full state sync
        this.network.on('full_state_sync', (data) => {
            const isManualSync = this.isManualSyncPending || false;
            this.isManualSyncPending = false; // Reset the flag
            this.handleFullStateSync(data, isManualSync);
        });
        
    }
    
    /**
     * Execute an operation with server-authoritative sync
     */
    async executeOperation(command) {
        // Check if we're connected and joined to a canvas
        if (!this.network.isConnected) {
            throw new Error('Not connected to server - operation cannot be executed');
        }
        
        if (!this.network.currentCanvas) {
            throw new Error('Not joined to any canvas - operation cannot be executed');
        }
        
        const operationId = this.generateOperationId();

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
                'node_create', 'node_duplicate', 'node_paste',
                'group_create', 'group_add_node', 'group_remove_node', 'group_move', 
                'group_resize', 'group_toggle_collapsed', 'group_update_style'
            ];
            
            if (undoableOperations.includes(command.type) && command.origin === 'local') {
                // Debug logging disabled - too noisy
                // console.log(`📝 Checking ${command.type} undo data:`, {
                //     hasUndoData: !!command.undoData,
                //     hasPrepareMethod: typeof command.prepareUndoData === 'function',
                //     commandKeys: Object.keys(command),
                //     proto: Object.getPrototypeOf(command).constructor.name
                // });
                
                if (!command.undoData && typeof command.prepareUndoData === 'function') {
                    const context = {
                        graph: this.app?.graph,
                        canvas: this.app?.graphCanvas
                    };
                    
                    if (context.graph && context.canvas) {
                        try {
                            await command.prepareUndoData(context);
                        } catch (error) {
                            console.error(`❌ Error preparing undo data for ${command.type}:`, error);
                        }
                    }
                }
            }
            
            // 2. Apply optimistically if enabled and command supports it
            let localResult = null;
            let tempNodeIds = [];
            
            if (this.optimisticEnabled && command.origin === 'local' && 
                command.supportsOptimisticUpdate && command.supportsOptimisticUpdate()) {
                const optimisticResult = await this.applyOptimistic(command);
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
                                
                            } else if (!['image_upload_complete', 'sync_complete'].includes(command.type)) {
                                // Only warn for commands that should have undo data
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
                
            }
            
            // Enforce undo data presence for operations that require it
            const undoRequiredOperations = [
                'node_create', 'node_delete', 'node_move', 'node_resize', 
                'node_update', 'node_duplicate', 'node_paste', 'node_rotate',
                'group_create', 'group_add_node', 'group_remove_node', 'group_move', 
                'group_resize', 'group_toggle_collapsed', 'group_update_style',
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
            // Check if command has getServerData method
            const serverData = command.getServerData ? command.getServerData() : { type: command.type, params: command.params };
            
            const serverRequest = {
                operationId,
                type: serverData.type,
                params: serverData.params,
                stateVersion: this.serverStateVersion,
                undoData: finalUndoData,
                transactionId: this.app.transactionManager?.getCurrentTransaction()?.id || null
            };
            
            // Log payload size for debugging
            const payloadSize = JSON.stringify(serverRequest).length;
            if (window.Logger.isEnabled('STATE_SYNC_DETAILS')) {
                window.Logger.stateSync('debug', '📤 Sending operation to server:', {
                    type: serverRequest.type,
                    operationId: serverRequest.operationId,
                    hasUndoData: !!serverRequest.undoData,
                    undoDataPreview: serverRequest.undoData ? Object.keys(serverRequest.undoData) : null,
                    payloadSize: payloadSize,
                    payloadSizeMB: (payloadSize / 1024 / 1024).toFixed(2) + 'MB'
                });
            }
            
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
            if (window.Logger.isEnabled('STATE_SYNC_DETAILS')) {
                window.Logger.stateSync('debug', `⏱️ Waiting for server response with ${timeout}ms timeout for ${command.type} operation`);
            }
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
            
            command._generatedUndoData = command.undoData;
        }
        
        // Log optimistic operation result
        if (command.type === 'node_create' && localResult?.node) {
            
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
            
            this.requestFullSync();
            return;
        }
        
        // Clear optimistic update flags for nodes updated by this operation
        if (operationId && changes?.updated) {
            changes.updated.forEach(nodeData => {
                const node = this.app.graph.getNodeById(nodeData.id);
                if (node && node._optimisticUpdate && node._optimisticUpdate.operationId === operationId) {
                    
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
                    // 
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
                    this.debugLog(3, `⏭️ Skipping server node ${nodeData.id} - already exists`);
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
                    this.debugLog(2, `🔄 Updating temporary node in place: temp:${tempNode.id} -> server:${nodeData.id} at [${nodeData.pos[0]}, ${nodeData.pos[1]}]`);
                    processedTempNodes.add(tempNode.id);
                    
                    // Update the existing node in place to prevent flickering
                    console.log(`🔄 Updating node ${tempNode.id} with server data (preventing flicker)`);
                    
                    // Update node properties while preserving visual state
                    const oldId = tempNode.id;
                    tempNode.id = nodeData.id; // Update to server ID
                    tempNode.properties = { ...tempNode.properties, ...nodeData.properties };
                    
                    // Update positions if they've changed
                    if (nodeData.pos && (tempNode.pos[0] !== nodeData.pos[0] || tempNode.pos[1] !== nodeData.pos[1])) {
                        tempNode.pos = [...nodeData.pos];
                    }
                    
                    // Update size if provided
                    if (nodeData.size && (tempNode.size[0] !== nodeData.size[0] || tempNode.size[1] !== nodeData.size[1])) {
                        tempNode.size = [...nodeData.size];
                    }
                    
                    // Clear sync pending flags since we've successfully synced
                    delete tempNode._syncPending;
                    delete tempNode._operationId;
                    
                    // Mark as replaced in tracker
                    if (this.operationTracker.isNodeTracked(oldId)) {
                        this.operationTracker.markNodeReplaced(oldId);
                    }
                    
                    // No need to remove/add - node is already in graph and updated
                    const node = tempNode; // Reference for the rest of the code
                    console.log(`✅ Server node updated in place: ${node.id} (total nodes: ${this.app.graph.nodes.length})`);
                    
                    // Notify upload coordinator for image nodes
                    if (node.type === 'media/image' && this.app.imageUploadCoordinator) {
                        this.app.imageUploadCoordinator.onImageNodeCreated(node);
                    }
                    
                    // Selection is preserved automatically since we didn't remove the node
                } else {
                    if (tempNode) {
                        
                    } else {
                        
                    }
                    
                    // Create server node anyway
                    
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
            this.debugLog(3, '📊 Server changes applied, tracker will verify replacements');
            
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
                
                // Mark canvas dirty to ensure selected nodes are visually rendered
                this.app.graphCanvas.dirty_canvas = true;
            }
            
            // Check if we need to restore selection for duplicated nodes
            if (this.app.graphCanvas?._pendingDuplicationSelection && operationId && addedNodeIds.length > 0) {
                const pendingSelection = this.app.graphCanvas._pendingDuplicationSelection.get(operationId);
                if (pendingSelection && pendingSelection.wasSelected) {
                    
                    // Clear any existing selection first
                    this.app.graphCanvas.selection.clear();
                    
                    // Select all the newly added nodes from this duplication operation
                    addedNodeIds.forEach(nodeId => {
                        const node = this.app.graph.getNodeById(nodeId);
                        if (node) {
                            this.app.graphCanvas.selection.selectNode(node, true);
                            
                        }
                    });
                    
                    // Clean up the pending selection entry
                    this.app.graphCanvas._pendingDuplicationSelection.delete(operationId);
                    if (this.app.graphCanvas._pendingDuplicationSelection.size === 0) {
                        delete this.app.graphCanvas._pendingDuplicationSelection;
                    }
                    
                    // Force canvas redraw to show selection
                    this.app.graphCanvas.dirty_canvas = true;
                    this.app.graphCanvas.dirty_bgcanvas = true;
                }
            }
            
            // Check if we need to restore selection for dropped nodes
            if (this.app.graphCanvas?._pendingDropSelection) {
                
            }
            if (this.app.graphCanvas?._pendingDropSelection && addedNodeIds.length > 0) {
                const pendingSelections = this.app.graphCanvas._pendingDropSelection;
                const now = Date.now();

                // Look for pending selections that match the current node addition
                for (let i = pendingSelections.length - 1; i >= 0; i--) {
                    const pending = pendingSelections[i];
                    const age = now - pending.timestamp;

                    // For dropped nodes, they arrive individually, so we need to accumulate them
                    // Match by recency and count down the expected nodes
                    if (age < 10000) {
                        // Initialize selection tracking if not exists
                        if (!pending.selectedNodes) {
                            pending.selectedNodes = [];
                        }
                        
                        // Add the new nodes to our tracking
                        addedNodeIds.forEach(nodeId => {
                            if (!pending.selectedNodes.includes(nodeId)) {
                                pending.selectedNodes.push(nodeId);
                            }
                        });

                        // If we have all expected nodes, select them all
                        if (pending.selectedNodes.length >= pending.nodeCount) {
                            console.log(`🎯 COMPLETE! Restoring selection for ${pending.selectedNodes.length} dropped nodes (age: ${age}ms)`);
                            
                            // Clear any existing selection first
                            this.app.graphCanvas.selection.clear();
                            
                            // Select all the accumulated nodes
                            pending.selectedNodes.forEach(nodeId => {
                                const node = this.app.graph.getNodeById(nodeId);
                                if (node) {
                                    this.app.graphCanvas.selection.selectNode(node, true);
                                    
                                } else {
                                    console.error(`❌ Could not find node: ${nodeId}`);
                                }
                            });
                            
                            // Remove this pending selection
                            pendingSelections.splice(i, 1);
                            
                            // Clean up if empty
                            if (pendingSelections.length === 0) {
                                delete this.app.graphCanvas._pendingDropSelection;
                            }
                            
                            // Force canvas redraw to show selection
                            this.app.graphCanvas.dirty_canvas = true;
                            this.app.graphCanvas.dirty_bgcanvas = true;
                            
                            break; // Only match one pending selection
                        }
                    }
                }
                
                // Clean up old pending selections (older than 30 seconds)
                const filteredSelections = pendingSelections.filter(p => (now - p.timestamp) < 30000);
                if (filteredSelections.length !== pendingSelections.length) {
                    this.app.graphCanvas._pendingDropSelection = filteredSelections;
                    if (filteredSelections.length === 0) {
                        delete this.app.graphCanvas._pendingDropSelection;
                    }
                }
            } else if (this.app.graphCanvas?._pendingDropSelection) {
                
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
                            
                            delete node._optimisticUpdate;
                        }

                        this.updateNodeFromData(node, nodeData, forceUpdate);
                        
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
                
                // Force immediate redraw for undo/redo to ensure visual update
                requestAnimationFrame(() => {
                    if (this.app?.graphCanvas?.draw) {
                        this.app.graphCanvas.draw();
                        
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
    async handleFullStateSync(data, isManualSync = false) {
        const { state, stateVersion } = data;

        this.updating = true;
        
        try {
            // Clear current graph
            this.app.graph.clear();
            
            // Process nodes in batches to avoid blocking
            const nodes = state.nodes || [];
            const batchSize = 10; // Process 10 nodes at a time
            
            for (let i = 0; i < nodes.length; i += batchSize) {
                const batch = nodes.slice(i, i + batchSize);
                
                // Process batch in parallel
                const createdNodes = await Promise.all(
                    batch.map(nodeData => this.createNodeFromData(nodeData))
                );
                
                // Add to graph
                for (const node of createdNodes) {
                    if (node) {
                        this.app.graph.add(node);
                    }
                }
                
                // Force a render to show progress
                if (this.app.graphCanvas) {
                    this.app.graphCanvas.dirty_canvas = true;
                }
                
                // Yield to browser to avoid blocking
                if (i + batchSize < nodes.length) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            
            // Update version
            this.serverStateVersion = stateVersion;
            
            // Clear pending operations (they're invalid now)
            this.pendingOperations.clear();

            // Only show sync notification for manual syncs (not when loading canvases)
            if (isManualSync && window.unifiedNotifications) {
                window.unifiedNotifications.success('Sync complete', {
                    id: 'manual-sync',
                    detail: `${nodes.length} nodes synced`,
                    duration: 2000
                });
            }
            
            // No longer using NodeSyncValidator - server handles validation gracefully
            
        } finally {
            this.updating = false;
        }
    }
    
    /**
     * Request full state sync from server
     */
    requestFullSync(isManualSync = false) {
        
        if (this.network) {
            this.isManualSyncPending = isManualSync;
            this.network.emit('request_full_sync', {
                canvasId: this.network.currentCanvas?.id
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
        // Merge flags preserving constructor defaults (like hide_title: true)
        if (nodeData.flags) {
            // Start with current node flags (preserves constructor defaults)
            node.flags = { ...node.flags, ...nodeData.flags };
        }
        if (nodeData.title !== node.title) {
            // 
        }
        node.title = nodeData.title;
        
        // Restore aspect ratio if available
        if (nodeData.aspectRatio !== undefined) {
            node.aspectRatio = nodeData.aspectRatio;
        }
        
        // Call configure if the node has this method (for custom node setup)
        if (typeof node.configure === 'function') {
            node.configure(nodeData);
        }
        
        // Handle media nodes
        if (node.type === 'media/image') {
            // Set loading state immediately for visual feedback
            node.loadingState = 'loading';
            node.loadingProgress = 0;
            
            // Always use normal loading - the WebGL renderer already has
            // sophisticated LOD logic that will request the optimal size
            node.setImage(
                nodeData.properties.serverUrl || null,
                nodeData.properties.filename,
                nodeData.properties.hash
            );
            
            // Restore color correction settings if present (stored as direct properties)
            if (nodeData.adjustments) {
                node.adjustments = { ...nodeData.adjustments };
            }
            if (nodeData.toneCurve !== undefined) {
                node.toneCurve = nodeData.toneCurve;
            }
            if (nodeData.toneCurveBypassed !== undefined) {
                node.toneCurveBypassed = nodeData.toneCurveBypassed;
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
            
            // Log what we're creating
            // console.log(`🖼️ Creating image node ${node.id} with references:`, {
            //     hash: nodeData.properties.hash?.substring(0, 8),
            //     hasServerUrl: !!nodeData.properties.serverUrl,
            //     filename: nodeData.properties.filename
            // });
            
        } else if (node.type === 'media/video') {
            // Set loading state immediately for visual feedback
            node.loadingState = 'loading';
            node.loadingProgress = 0;
            
            // For reference-based nodes, we don't pass src directly
            // The node will resolve it from hash/serverUrl
            node.setVideo(
                nodeData.properties.serverUrl || null, // Pass serverUrl if available
                nodeData.properties.filename,
                nodeData.properties.hash
            );
            
            // Restore video-specific properties
            if (nodeData.properties.paused !== undefined) {
                node.properties.paused = nodeData.properties.paused;
            }
            if (nodeData.properties.loop !== undefined) {
                node.properties.loop = nodeData.properties.loop;
            }
            if (nodeData.properties.muted !== undefined) {
                node.properties.muted = nodeData.properties.muted;
            }
            if (nodeData.properties.autoplay !== undefined) {
                node.properties.autoplay = nodeData.properties.autoplay;
            }
            
            // Restore transcoding-related properties
            if (nodeData.properties.transcodingComplete !== undefined) {
                node.properties.transcodingComplete = nodeData.properties.transcodingComplete;
            }
            if (nodeData.properties.availableFormats !== undefined) {
                node.properties.availableFormats = nodeData.properties.availableFormats;
            }
            if (nodeData.properties.serverUrl !== undefined) {
                node.properties.serverUrl = nodeData.properties.serverUrl;
            }
            if (nodeData.properties.serverFilename !== undefined) {
                node.properties.serverFilename = nodeData.properties.serverFilename;
            }
            
            // Restore color correction settings for video nodes
            // Note: Color correction props should be stored directly on nodeData, not in properties
            if (nodeData.adjustments) {
                node.adjustments = { ...nodeData.adjustments };
            }
            if (nodeData.toneCurve !== undefined) {
                node.toneCurve = nodeData.toneCurve;
            }
            if (nodeData.toneCurveBypassed !== undefined) {
                node.toneCurveBypassed = nodeData.toneCurveBypassed;
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
        }
        
        return node;
    }
    
    /**
     * Update node from server data
     */
    updateNodeFromData(node, nodeData, forceUpdate = false) {
        // Check if this node has a recent optimistic update that should be preserved
        if (node._optimisticUpdate) {
            const age = Date.now() - node._optimisticUpdate.timestamp;
            // Skip server updates for recent optimistic updates (within 2 seconds)
            if (age < 2000) {
                this.debugLog(3, `⏭️ Skipping server update for node ${node.id} due to recent optimistic ${node._optimisticUpdate.type} update`);
                return;
            } else {
                // Clear old optimistic update flag
                delete node._optimisticUpdate;
            }
        }
        
        // Check if this node recently completed an alignment animation
        if (node._alignmentCompletedAt) {
            const age = Date.now() - node._alignmentCompletedAt;
            // Skip position updates for 2 seconds after alignment completion
            // BUT allow undo/redo operations to override this protection
            if (age < 2000 && nodeData.pos && !forceUpdate) {
                // Clear the flag if it's old
                if (age > 2000) {
                    delete node._alignmentCompletedAt;
                }
                // Still update other properties, just skip position
                // For groups, also skip size updates
                if (node.type === 'container/group' && nodeData.size) {
                    const { pos, size, ...otherData } = nodeData;
                    nodeData = otherData;
                } else {
                    const { pos, ...otherData } = nodeData;
                    nodeData = otherData;
                }
            } else if (forceUpdate && age < 2000) {
                this.debugLog(2, `🔄 Allowing undo/redo position update for node ${node.id} despite recent alignment completion`);
            }
        }
        
        // Check if node is currently being animated
        if ((node._gridAnimPos || node._animPos) && nodeData.pos) {
            // For undo/redo operations, we need to handle this carefully
            if (forceUpdate) {
                // Check if there's an active alignment animation
                const alignmentManager = this.app?.graphCanvas?.alignmentManager;
                const isActiveAnimation = alignmentManager?.gridAlignAnimating || alignmentManager?.autoAlignAnimating;
                
                if (isActiveAnimation) {
                    this.debugLog(2, `⏭️ Preserving animation for node ${node.id} during undo/redo`);
                    // Don't interfere with active animation, even for undo
                    const { pos, ...otherData } = nodeData;
                    nodeData = otherData;
                } else {
                    this.debugLog(2, `🔄 Clearing stale animation properties for node ${node.id} during undo/redo`);
                    // No active animation, these are stale properties - clear them
                    delete node._gridAnimPos;
                    delete node._animPos;
                    delete node._gridAnimVel;
                    delete node._animVel;
                }
            } else {
                this.debugLog(3, `⏭️ Skipping position update for node ${node.id} - animation in progress`);
                // Don't update position during animation
                const { pos, ...otherData } = nodeData;
                nodeData = otherData;
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

                // Trigger image loading with the new serverUrl
                if (node.setImage) {
                    node.setImage(
                        willHaveServerUrl,
                        node.properties.filename,
                        node.properties.hash
                    );
                }
            }
            
            // If video node just got a serverUrl (from upload in another tab), trigger loading
            if (node.type === 'media/video' && !hadServerUrl && willHaveServerUrl) {
                // Trigger video loading with the new serverUrl
                if (node.setVideo) {
                    node.setVideo(
                        willHaveServerUrl,
                        node.properties.filename,
                        node.properties.hash
                    );
                }
            }
        }
        
        // Update other attributes
        if (nodeData.rotation !== undefined) {
            node.rotation = nodeData.rotation;
        }
        
        if (nodeData.flags) {
            // Only override specific flags that are explicitly provided
            // This preserves constructor defaults (like hide_title: true) for new nodes
            for (const [key, value] of Object.entries(nodeData.flags)) {
                if (value !== undefined) {
                    node.flags[key] = value;
                }
            }
        }
        
        if (nodeData.title !== undefined) {
            if (nodeData.title !== node.title) {
                this.debugLog(3, `🔄 updateNodeFromData changing title: "${node.title}" → "${nodeData.title}" for node ${node.id}`);
            }
            node.title = nodeData.title;
        }
        
        // Update aspect ratio
        if (nodeData.aspectRatio !== undefined) {
            node.aspectRatio = nodeData.aspectRatio;
        }
        
        // Update color correction settings for image and video nodes (stored as direct properties)
        if ((node.type === 'media/image' || node.type === 'media/video')) {
            if (nodeData.adjustments) {
                node.adjustments = { ...nodeData.adjustments };
                // Mark node for WebGL update when adjustments change
                node.needsGLUpdate = true;
            }
            if (nodeData.toneCurve !== undefined) {
                node.toneCurve = nodeData.toneCurve;
                node.needsGLUpdate = true;
            }
            if (nodeData.toneCurveBypassed !== undefined) {
                node.toneCurveBypassed = nodeData.toneCurveBypassed;
                node.needsGLUpdate = true;
            }
            if (nodeData.colorAdjustmentsBypassed !== undefined) {
                node.colorAdjustmentsBypassed = nodeData.colorAdjustmentsBypassed;
                node.needsGLUpdate = true;
            }
            // Add missing color balance properties
            if (nodeData.colorBalance !== undefined) {
                node.colorBalance = nodeData.colorBalance;
                node.needsGLUpdate = true;
            }
            if (nodeData.colorBalanceBypassed !== undefined) {
                node.colorBalanceBypassed = nodeData.colorBalanceBypassed;
                node.needsGLUpdate = true;
            }
        }
        
        // Invalidate selection bounding box cache if this node is selected
        if (this.app?.graphCanvas?.selection?.isSelected(node)) {
            this.app.graphCanvas.selection.invalidateBoundingBox();
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
                        serverFilename: node.properties.serverFilename,
                        filename: node.properties.filename,
                        scale: node.properties.scale || 1.0
                    };
                    
                    // Preserve video-specific properties
                    if (node.type === 'media/video') {
                        nodeData.properties.paused = node.properties.paused;
                        nodeData.properties.transcodingComplete = node.properties.transcodingComplete;
                        nodeData.properties.availableFormats = node.properties.availableFormats;
                        nodeData.properties.loop = node.properties.loop;
                        nodeData.properties.muted = node.properties.muted;
                        nodeData.properties.autoplay = node.properties.autoplay;
                        
                        // Keep serverUrl and serverFilename if they exist (they're already in the base properties)
                        // This is important for transcoded videos
                    }
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
            if (window.Logger.isEnabled('OPERATION_ACK')) {
                window.Logger.stateSync('debug', '📋 Requesting undo state after operation acknowledgment');
            }
            window.app.undoManager.requestUndoState();
        }
    }
    
    /**
     * Handle operation rejection
     */
    handleOperationRejected(data) {
        
        // Check if rejection is due to authentication issues
        if (data.error === 'Not authenticated' || data.error === 'Not authenticated for this canvas') {
            
            // Try to rejoin the canvas after a short delay
            if (this.network.currentProject && this.network.currentUser) {
                setTimeout(() => {
                    
                    this.network.joinProject(
                        this.network.currentProject.id,
                        this.network.currentProject.canvasId || 'default',
                        this.network.currentUser.id,
                        this.network.currentUser.username
                    );
                }, 500);
            }
        }
        
        // Handled by waitForServerResponse for operation-specific logic
    }
    
    /**
     * Clean up optimistic operation after server confirmation
     */
    async cleanupOptimisticOperation(operationId, command, serverResponse) {
        const pending = this.pendingOperations.get(operationId);
        if (!pending || !pending.rollbackData) return;
        
        if (window.Logger.isEnabled('OPERATION_ACK')) {
            window.Logger.stateSync('debug', '🧹 Cleaning up optimistic operation:', command.type, operationId);
        }
        
        // For node creation/duplication: handle optimistic nodes before server nodes arrive
        if (command.type === 'node_create' || command.type === 'node_duplicate' || command.type === 'node_paste') {
            // Find any nodes that were added optimistically
            const currentNodes = this.app.graph.nodes.slice(); // Make a copy to iterate safely
            const nodesBeforeCleanup = currentNodes.length;
            
            // Track which optimistic nodes were selected (for duplication/paste)
            const selectedOptimisticNodeIds = [];
            
            for (const node of currentNodes) {
                // Remove nodes that weren't in the rollback state (i.e., were added optimistically)
                const wasInRollback = pending.rollbackData.nodes?.some(rollbackNode => rollbackNode.id === node.id);
                if (!wasInRollback) {
                    // For duplicate/paste operations, track if this node was selected
                    if ((command.type === 'node_duplicate' || command.type === 'node_paste') && 
                        this.app.graphCanvas?.selection?.isSelected(node)) {
                        selectedOptimisticNodeIds.push(node.id);
                        
                    }
                    
                    console.log(`🗑️ Removing optimistic node: ${node.id}:${node.type} (created at ${node.pos[0]}, ${node.pos[1]})`);
                    // Also remove from selection to prevent issues
                    if (this.app.graphCanvas.selection) {
                        this.app.graphCanvas.selection.deselectNode(node);
                    }
                    this.app.graph.remove(node);
                }
            }
            
            // For duplicate/paste operations, prepare to select the server nodes when they arrive
            if ((command.type === 'node_duplicate' || command.type === 'node_paste') && 
                selectedOptimisticNodeIds.length > 0 && pending.localResult?.nodes) {
                // The server will send nodes in the same order as we created them locally
                // Store this information to restore selection when server nodes arrive
                if (!this.app.graphCanvas._pendingDuplicationSelection) {
                    this.app.graphCanvas._pendingDuplicationSelection = new Map();
                }
                this.app.graphCanvas._pendingDuplicationSelection.set(operationId, {
                    nodeCount: pending.localResult.nodes.length,
                    wasSelected: true
                });
            }
        }
        
        // For other operations, rollback data handling may be different
    }
    
    /**
     * Find temporary node by operation ID
     */
    findTemporaryNodeByOperationId(operationId) {
        if (!operationId) return null;
        
        for (const node of this.app.graph.nodes) {
            if (node._operationId === operationId) {
                
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
            
        }
        
        return bestMatch;
    }
    
    /**
     * Clean up orphaned temporary nodes - now based on operation tracking
     */
    cleanupOrphanedTemporaryNodes() {
        // Skip cleanup if bulk operation in progress
        if (this.app.bulkOperationInProgress) {
            
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
            this.debugLog(2, `📊 Temp node status: ${tempNodeCount} total (${trackedCount} tracked, ${untrackedCount} untracked), cleaning ${nodesToClean.length}`);
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
            this.debugLog(2, '📊 Operation Tracker Stats:', stats);
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