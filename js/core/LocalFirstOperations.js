/**
 * LocalFirstOperations - Implements local-first operations with background sync
 * 
 * Key principles:
 * 1. All operations execute locally immediately
 * 2. UI updates happen instantly  
 * 3. Server sync happens in background
 * 4. Conflicts are resolved server-side
 */
class LocalFirstOperations {
    constructor(app) {
        this.app = app;
        this.localOperationId = 0;
    }
    
    /**
     * Execute duplicate operation locally first
     */
    async duplicateLocalFirst(nodeIds, options = {}) {
        const offset = options.offset || [20, 20];
        const duplicatedNodes = [];
        
        // Step 1: Execute locally immediately
        for (const nodeId of nodeIds) {
            const original = this.app.graph.getNodeById(nodeId);
            if (!original) continue;
            
            const duplicate = this.app.graphCanvas.duplicateNode(original);
            if (duplicate) {
                duplicate.pos[0] += offset[0];
                duplicate.pos[1] += offset[1];
                duplicate._localId = this.generateLocalId();
                duplicate._pendingSync = true;
                
                this.app.graph.add(duplicate);
                duplicatedNodes.push(duplicate);
            }
        }
        
        // Step 2: Update UI immediately
        if (duplicatedNodes.length > 0) {
            this.app.graphCanvas.selection.clear();
            duplicatedNodes.forEach(node => {
                this.app.graphCanvas.selection.selectNode(node, true);
            });
            this.app.graphCanvas.dirty_canvas = true;
            this.app.graphCanvas.pushUndoState();
        }
        
        // Step 3: Queue for background sync if online
        if (this.app.backgroundSyncManager && nodeIds.length > 5) {
            // For large operations, use background sync
            this.queueBackgroundSync('duplicate', nodeIds, duplicatedNodes, options);
        } else if (this.app.operationPipeline) {
            // For small operations, sync immediately but don't block
            this.syncImmediately('duplicate', nodeIds, duplicatedNodes, options);
        }
        
        return { success: true, nodes: duplicatedNodes };
    }
    
    /**
     * Execute paste operation locally first
     */
    async pasteLocalFirst(clipboard, targetPosition, options = {}) {
        const pastedNodes = [];
        
        // Calculate center for positioning
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const nodeData of clipboard) {
            minX = Math.min(minX, nodeData.pos[0]);
            minY = Math.min(minY, nodeData.pos[1]);
            maxX = Math.max(maxX, nodeData.pos[0] + nodeData.size[0]);
            maxY = Math.max(maxY, nodeData.pos[1] + nodeData.size[1]);
        }
        const clipboardCenter = [(minX + maxX) / 2, (minY + maxY) / 2];
        
        // Step 1: Execute locally immediately
        for (const nodeData of clipboard) {
            const node = this.app.graphCanvas.deserializeNode(nodeData);
            if (node) {
                // Position relative to target
                const offsetFromCenter = [
                    nodeData.pos[0] - clipboardCenter[0],
                    nodeData.pos[1] - clipboardCenter[1]
                ];
                
                node.pos[0] = targetPosition[0] + offsetFromCenter[0];
                node.pos[1] = targetPosition[1] + offsetFromCenter[1];
                node._localId = this.generateLocalId();
                node._pendingSync = true;
                
                this.app.graph.add(node);
                pastedNodes.push(node);
            }
        }
        
        // Step 2: Update UI immediately
        if (pastedNodes.length > 0) {
            this.app.graphCanvas.selection.clear();
            pastedNodes.forEach(node => {
                this.app.graphCanvas.selection.selectNode(node, true);
            });
            this.app.graphCanvas.dirty_canvas = true;
            this.app.graphCanvas.pushUndoState();
        }
        
        // Step 3: Queue for background sync
        if (this.app.backgroundSyncManager && clipboard.length > 5) {
            this.queueBackgroundSync('paste', clipboard, pastedNodes, { targetPosition });
        } else if (this.app.operationPipeline) {
            this.syncImmediately('paste', clipboard, pastedNodes, { targetPosition });
        }
        
        return { success: true, nodes: pastedNodes };
    }
    
    /**
     * Queue operation for background sync
     */
    queueBackgroundSync(type, sourceData, localNodes, options) {
        const operation = this.createSyncOperation(type, sourceData, options);
        
        // Track local nodes for ID mapping when server responds
        const localIdMap = new Map();
        localNodes.forEach(node => {
            localIdMap.set(node._localId, node);
        });
        
        this.app.backgroundSyncManager.queueOperation(operation, {
            priority: 'normal',
            optimistic: false, // Already applied locally
            onSuccess: (result) => {
                this.handleSyncSuccess(result, localIdMap);
            },
            onError: (error) => {
                this.handleSyncError(error, localNodes);
            }
        });
    }
    
    /**
     * Sync immediately for small operations
     */
    async syncImmediately(type, sourceData, localNodes, options) {
        try {
            const operation = this.createSyncOperation(type, sourceData, options);
            const result = await this.app.operationPipeline.execute(
                operation.type,
                operation.params
            );
            
            // Map server IDs to local nodes
            if (result && result.result && result.result.nodes) {
                const localIdMap = new Map();
                localNodes.forEach((node, index) => {
                    localIdMap.set(node._localId, node);
                });
                this.handleSyncSuccess(result, localIdMap);
            }
        } catch (error) {
            
            // Fall back to background sync
            if (this.app.backgroundSyncManager) {
                this.queueBackgroundSync(type, sourceData, localNodes, options);
            }
        }
    }
    
    /**
     * Create sync operation based on type
     */
    createSyncOperation(type, sourceData, options) {
        switch (type) {
            case 'duplicate':
                return {
                    type: 'node_duplicate',
                    params: {
                        nodeIds: sourceData,
                        offset: options.offset || [20, 20]
                    }
                };
                
            case 'paste':
                // Optimize node data for sync
                const optimizedData = sourceData.map(nodeData => {
                    if (this.app.bulkOperationManager) {
                        return this.app.bulkOperationManager.optimizeNodeData(nodeData);
                    }
                    return nodeData;
                });
                
                return {
                    type: 'node_paste',
                    params: {
                        nodeData: optimizedData,
                        targetPosition: options.targetPosition
                    }
                };
                
            default:
                throw new Error(`Unknown operation type: ${type}`);
        }
    }
    
    /**
     * Handle successful sync response
     */
    handleSyncSuccess(result, localIdMap) {
        if (!result.result || !result.result.nodes) return;
        
        // Map server nodes to local nodes and update IDs
        result.result.nodes.forEach((serverNode, index) => {
            // Find corresponding local node
            let localNode = null;
            
            // Try to match by position and type
            for (const [localId, node] of localIdMap) {
                if (node.type === serverNode.type &&
                    Math.abs(node.pos[0] - serverNode.pos[0]) < 1 &&
                    Math.abs(node.pos[1] - serverNode.pos[1]) < 1) {
                    localNode = node;
                    break;
                }
            }
            
            if (localNode) {
                // Update local node with server ID
                const oldId = localNode.id;
                localNode.id = serverNode.id;
                delete localNode._localId;
                delete localNode._pendingSync;
                
                // Update any references
                this.app.graph._nodes_by_id[serverNode.id] = localNode;
                delete this.app.graph._nodes_by_id[oldId];

            }
        });
    }
    
    /**
     * Handle sync error
     */
    handleSyncError(error, localNodes) {
        console.error('❌ Sync failed:', error);
        
        // Mark nodes as sync failed
        localNodes.forEach(node => {
            node._syncFailed = true;
            delete node._pendingSync;
        });
        
        // Show user notification
        if (this.app.notifications) {
            this.app.notifications.show({
                type: 'warning',
                message: 'Some changes could not be synced. They will be retried when connection improves.',
                timeout: 5000
            });
        }
    }
    
    /**
     * Generate local ID for optimistic operations
     */
    generateLocalId() {
        return `local_${Date.now()}_${++this.localOperationId}`;
    }
    
    /**
     * Check if operations should use local-first approach
     */
    shouldUseLocalFirst(operationSize) {
        // Use local-first for all operations to maximize responsiveness
        return true;
        
        // Alternative: only for large operations
        // return operationSize > 10;
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LocalFirstOperations;
}