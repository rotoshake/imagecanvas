/**
 * CanvasStateManager - Server-side authoritative state management
 * 
 * Maintains the single source of truth for canvas state
 * Validates all operations before applying them
 * Broadcasts state changes to all connected clients
 */
class CanvasStateManager {
    constructor(db) {
        this.db = db;
        
        // In-memory canvas states by canvas ID
        this.canvasStates = new Map();
        
        // State version tracking
        this.stateVersions = new Map();
        
        // Operation validators
        this.validators = this.createValidators();

    }
    
    /**
     * Get or create canvas state for a canvas
     */
    async getCanvasState(canvasId) {
        if (!this.canvasStates.has(canvasId)) {
            // Load from database
            const state = await this.loadCanvasState(canvasId);
            this.canvasStates.set(canvasId, state);
            this.stateVersions.set(canvasId, state.version || 0);
        }
        
        return this.canvasStates.get(canvasId);
    }
    
    /**
     * Load canvas state from database
     */
    async loadCanvasState(canvasId) {
        try {
            // Get latest canvas data
            const canvas = await this.db.get(
                'SELECT * FROM canvases WHERE id = ?',
                [canvasId]
            );
            
            if (canvas && canvas.canvas_data) {
                const data = JSON.parse(canvas.canvas_data);
                return {
                    nodes: data.nodes || [],
                    version: data.version || 0,
                    lastModified: canvas.last_modified
                };
            }
        } catch (error) {
            console.error('Error loading canvas state:', error);
        }
        
        // Return empty state
        return {
            nodes: [],
            version: 0,
            lastModified: Date.now()
        };
    }
    
    /**
     * Execute operation on server state
     */
    async executeOperation(canvasId, operation, userId) {
        const state = await this.getCanvasState(canvasId);
        const currentVersion = this.stateVersions.get(canvasId) || 0;
        
        // Validate operation
        const validation = await this.validateOperation(operation, state);
        if (!validation.valid) {
            return {
                success: false,
                error: validation.error,
                stateVersion: currentVersion
            };
        }
        
        // Apply operation to state
        const changes = await this.applyOperation(operation, state);
        
        // All operations now return changes object, even if empty
        // An empty changes object still means the operation succeeded
        
        // Increment version
        const newVersion = currentVersion + 1;
        this.stateVersions.set(canvasId, newVersion);
        state.version = newVersion;
        state.lastModified = Date.now();
        
        // Save to database
        await this.saveCanvasState(canvasId, state);
        
        // Operation history is now handled by OperationHistory class in collaboration.js
        // This prevents duplicate operations (one with undo data, one without)
        
        return {
            success: true,
            stateVersion: newVersion,
            changes: changes
        };
    }
    
    /**
     * Validate operation before execution
     */
    async validateOperation(operation, state) {
        const validator = this.validators.get(operation.type);
        if (!validator) {
            return { valid: false, error: `Unknown operation type: ${operation.type}` };
        }
        
        return validator(operation, state);
    }
    
    /**
     * Apply operation to state
     */
    async applyOperation(operation, state) {
        const changes = {
            added: [],
            updated: [],
            removed: []
        };
        
        switch (operation.type) {
            case 'node_create':
                return this.applyNodeCreate(operation.params, state, changes);
                
            case 'node_move':
                return this.applyNodeMove(operation.params, state, changes);
                
            case 'node_delete':
                return this.applyNodeDelete(operation.params, state, changes);
                
            case 'node_resize':
                return this.applyNodeResize(operation.params, state, changes);
                
            case 'node_property_update':
                return this.applyNodePropertyUpdate(operation.params, state, changes);
                
            case 'node_rotate':
                return this.applyNodeRotate(operation.params, state, changes);
                
            case 'video_toggle':
                return this.applyVideoToggle(operation.params, state, changes);
                
            case 'node_batch_property_update':
                return this.applyBatchPropertyUpdate(operation.params, state, changes);
                
            case 'node_reset':
                return this.applyNodeReset(operation.params, state, changes);
                
            case 'node_duplicate':
                return this.applyNodeDuplicate(operation.params, state, changes);
                
            case 'node_paste':
                return this.applyNodePaste(operation.params, state, changes);
                
            case 'node_align':
                operation.params.nodeIds.forEach((nodeId, index) => {
                    const node = state.nodes.find(n => n.id === nodeId);
                    if (node && operation.params.positions[index]) {
                        // Update both X and Y coordinates from the provided positions
                        // The client sends complete positions after alignment animation
                        node.pos = [...operation.params.positions[index]];
                        changes.updated.push(node);
                        
                    }
                });
                break;
                
            case 'node_layer_order':
                return this.applyNodeLayerOrder(operation.params, state, changes);

            case 'image_upload_complete':
                return this.applyImageUploadComplete(operation.params, state, changes);
                
            // Group operations
            case 'group_create':
                return this.applyGroupCreate(operation.params, state, changes);
                
            case 'group_add_node':
                return this.applyGroupAddNode(operation.params, state, changes);
                
            case 'group_remove_node':
                return this.applyGroupRemoveNode(operation.params, state, changes);
                
            case 'group_move':
                return this.applyGroupMove(operation.params, state, changes);
                
            case 'group_resize':
                return this.applyGroupResize(operation.params, state, changes);
                
            case 'group_toggle_collapsed':
                return this.applyGroupToggleCollapsed(operation.params, state, changes);
                
            case 'group_update_style':
                return this.applyGroupUpdateStyle(operation.params, state, changes);
                
            default:
                
                return null;
        }
        
        return changes;
    }
    
    /**
     * Apply node creation
     */
    applyNodeCreate(params, state, changes) {
        const nodeId = params.id || this.generateNodeId();
        
        const node = {
            id: nodeId,
            type: params.type,
            pos: [...params.pos],
            size: params.size ? [...params.size] : [150, 100],
            properties: this.optimizeNodeProperties(params.properties, params.type),
            rotation: params.rotation || 0,
            flags: { ...params.flags },
            title: params.title || '',
            aspectRatio: params.aspectRatio
        };
        
        // Add media data if provided (but optimize it)
        if (params.imageData) {
            // Only keep references, not data URLs
            const optimizedImageData = this.optimizeNodeProperties(params.imageData, 'media/image');
            node.properties = { ...node.properties, ...optimizedImageData };
        }
        if (params.videoData) {
            // Only keep references, not data URLs  
            const optimizedVideoData = this.optimizeNodeProperties(params.videoData, 'media/video');
            node.properties = { ...node.properties, ...optimizedVideoData };
        }
        
        state.nodes.push(node);
        changes.added.push(node);
        
        return changes;
    }
    
    /**
     * Optimize node properties for server storage and broadcast
     * Removes large data URLs while preserving references
     */
    optimizeNodeProperties(properties, nodeType) {
        if (!properties) return {};
        
        // For non-media nodes, return as-is
        if (nodeType !== 'media/image' && nodeType !== 'media/video') {
            return { ...properties };
        }
        
        // For media nodes, optimize
        const optimized = { ...properties };
        
        // If we have a data URL, don't store it on the server
        if (optimized.src && optimized.src.startsWith('data:')) {
            const originalSize = optimized.src.length;
            console.log(`🗜️ Server optimizing ${nodeType}: removing ${(originalSize/1024/1024).toFixed(2)}MB data URL`);
            
            // Remove the data URL - clients should get it from cache or upload
            delete optimized.src;
            
            // Ensure we have the essential references
            if (!optimized.hash) {
                
            }
        }
        
        return optimized;
    }
    
    /**
     * Apply node move
     */
    applyNodeMove(params, state, changes) {
        if (params.nodeId) {
            // Single node move
            const node = state.nodes.find(n => n.id === params.nodeId);
            if (node) {
                node.pos = [...params.position];
                changes.updated.push(node);
            }
            // If node not found, silently ignore - eventual consistency
            
        } else if (params.nodeIds && params.positions) {
            // Multi-node move
            params.nodeIds.forEach((nodeId, index) => {
                const node = state.nodes.find(n => n.id === nodeId);
                if (node) {
                    node.pos = [...params.positions[index]];
                    changes.updated.push(node);
                }
                // Missing nodes are silently ignored
            });
        }
        
        // Always return changes, even if empty - operation still succeeded
        return changes;
    }
    
    /**
     * Apply node deletion
     */
    applyNodeDelete(params, state, changes) {
        const toDelete = new Set(params.nodeIds);
        const remaining = [];
        
        // Capture full node data before deletion for undo
        const deletedNodes = [];
        
        for (const node of state.nodes) {
            if (toDelete.has(node.id)) {
                // Store complete node data for undo
                deletedNodes.push({
                    id: node.id,
                    type: node.type,
                    pos: [...node.pos],
                    size: [...node.size],
                    properties: { ...node.properties },
                    rotation: node.rotation || 0,
                    flags: node.flags ? { ...node.flags } : {},
                    title: node.title,
                    aspectRatio: node.aspectRatio
                });
                changes.removed.push(node.id);
            } else {
                remaining.push(node);
            }
        }
        
        // Store deleted nodes in changes for undo
        changes.deletedNodes = deletedNodes;
        
        state.nodes = remaining;
        
        // Clean up references in groups
        for (const node of state.nodes) {
            if (node.type === 'container/group' && node.properties && node.properties.childNodes) {
                const originalLength = node.properties.childNodes.length;
                node.properties.childNodes = node.properties.childNodes.filter(
                    childId => !toDelete.has(childId)
                );
                
                // Mark group as updated if children were removed
                if (node.properties.childNodes.length !== originalLength) {
                    changes.updated.push(node);
                }
            }
        }
        
        // Always return changes, even if empty - operation still succeeded
        return changes;
    }
    
    /**
     * Apply node resize
     */
    applyNodeResize(params, state, changes) {
        params.nodeIds.forEach((nodeId, index) => {
            const node = state.nodes.find(n => n.id === nodeId);
            if (node) {
                const newSize = [...params.sizes[index]];
                
                // Update size
                node.size = newSize;
                
                // If positions are provided (for rotated nodes), use them directly
                // This means the client has already calculated the correct position
                if (params.positions && params.positions[index]) {
                    node.pos[0] = params.positions[index][0];
                    node.pos[1] = params.positions[index][1];
                }
                // Otherwise, if node is rotated, calculate position to maintain center
                else if (node.rotation && Math.abs(node.rotation) > 0.001) {
                    // This fallback shouldn't normally happen now, but keeping for safety
                    const oldCenterX = node.pos[0] + node.size[0] / 2;
                    const oldCenterY = node.pos[1] + node.size[1] / 2;
                    node.pos[0] = oldCenterX - newSize[0] / 2;
                    node.pos[1] = oldCenterY - newSize[1] / 2;
                }
                
                // Update aspect ratio to preserve non-uniform scaling
                // This is critical for preserving the exact scaling across clients
                node.aspectRatio = newSize[0] / newSize[1];
                
                changes.updated.push(node);
            }
            // Missing nodes are silently ignored
        });
        
        // Always return changes, even if empty - operation still succeeded
        return changes;
    }
    
    /**
     * Apply node property update
     */
    applyNodePropertyUpdate(params, state, changes) {
        const node = state.nodes.find(n => n.id === params.nodeId);
        if (node) {
            // Log color correction updates
            if (['toneCurve', 'toneCurveBypassed', 'colorAdjustmentsBypassed', 'adjustments', 'colorBalance', 'colorBalanceBypassed'].includes(params.property)) {
                console.log(`[CanvasStateManager] Updating color correction property: ${params.property}`, params.value);
            }
            
            // Handle special properties that belong on the node object itself
            const nodeDirectProperties = ['title', 'rotation', 'aspectRatio', 'toneCurve', 'toneCurveBypassed', 'colorAdjustmentsBypassed', 'adjustments', 'colorBalance', 'colorBalanceBypassed'];
            
            if (nodeDirectProperties.includes(params.property)) {
                // Update property directly on the node object
                node[params.property] = params.value;
                console.log(`[CanvasStateManager] Updated node.${params.property} directly`);
            } else {
                // Update property in the properties object
                node.properties[params.property] = params.value;
                console.log(`[CanvasStateManager] Updated node.properties.${params.property}`);
            }
            
            changes.updated.push(node);
        } else {
            console.warn(`[CanvasStateManager] Node ${params.nodeId} not found for property update`);
        }
        // Missing nodes are silently ignored
        
        // Always return changes, even if empty - operation still succeeded
        return changes;
    }
    
    /**
     * Apply node rotation
     */
    applyNodeRotate(params, state, changes) {
        // Single node rotation
        if (params.nodeId) {
            const node = state.nodes.find(n => n.id === params.nodeId);
            if (node) {
                node.rotation = params.angle;
                changes.updated.push(node);
            }
            // Missing nodes are silently ignored
            return changes;
        }
        
        // Multi-node rotation (batch)
        if (params.nodeIds) {
            params.nodeIds.forEach((nodeId, index) => {
                const node = state.nodes.find(n => n.id === nodeId);
                if (node) {
                    // Update rotation
                    node.rotation = params.angles[index];
                    
                    // Update position if provided (for group center rotation)
                    if (params.positions && params.positions[index]) {
                        node.pos[0] = params.positions[index][0];
                        node.pos[1] = params.positions[index][1];
                    }
                    
                    changes.updated.push(node);
                }
                // Missing nodes are silently ignored
            });
            
            return changes;
        }
        
        // Always return changes, even if empty
        return changes;
    }
    
    /**
     * Apply node reset (rotation, aspect ratio, etc.)
     */
    applyNodeReset(params, state, changes) {
        const { nodeIds, resetRotation, resetAspectRatio, values } = params;
        
        if (!nodeIds || !Array.isArray(nodeIds)) return null;
        
        nodeIds.forEach((nodeId, index) => {
            const node = state.nodes.find(n => n.id === nodeId);
            if (!node) return;
            
            let updated = false;
            
            if (resetRotation) {
                node.rotation = values ? values[index] : 0;
                updated = true;
            }
            
            if (resetAspectRatio && values && values[index]) {
                // Reset aspect ratio by adjusting height based on width and target aspect ratio
                const targetAspect = values[index];
                node.size[1] = node.size[0] / targetAspect;
                node.aspectRatio = targetAspect; // Update aspect ratio in server state
                updated = true;
            }
            
            if (updated) {
                changes.updated.push(node);
            }
        });
        
        return changes;
    }
    
    /**
     * Apply video toggle
     */
    applyVideoToggle(params, state, changes) {
        const node = state.nodes.find(n => n.id === params.nodeId);
        if (node && node.type === 'media/video') {
            const newPaused = params.paused !== undefined ? 
                params.paused : !node.properties.paused;
            
            node.properties.paused = newPaused;
            changes.updated.push(node);
        }
        // Missing nodes or non-video nodes are silently ignored
        
        // Always return changes, even if empty - operation still succeeded
        return changes;
    }
    
    /**
     * Apply batch property update
     */
    applyBatchPropertyUpdate(params, state, changes) {
        for (const update of params.updates) {
            const node = state.nodes.find(n => n.id === update.nodeId);
            if (node) {
                node.properties[update.property] = update.value;
                changes.updated.push(node);
            }
            // Missing nodes are silently ignored
        }
        
        // Always return changes, even if empty - operation still succeeded
        return changes;
    }
    
    /**
     * Apply node duplication
     */
    applyNodeDuplicate(params, state, changes) {
        const { nodeIds, nodeData, offset } = params;
        
        // Handle explicit node data (Alt+drag) or standard duplication
        if (nodeData && Array.isArray(nodeData)) {
            const defaultOffset = offset || [0, 0];
            
            for (const data of nodeData) {
                // Create duplicate with new ID using explicit data
                const duplicate = {
                    id: this.generateNodeId(),
                    type: data.type,
                    pos: [data.pos[0] + defaultOffset[0], data.pos[1] + defaultOffset[1]],
                    size: [...data.size],
                    properties: { ...data.properties },
                    rotation: data.rotation || 0,
                    flags: { ...data.flags },
                    title: data.title,
                    aspectRatio: data.aspectRatio,
                    // Preserve operation ID for sync tracking
                    _operationId: data._operationId
                };
                
                state.nodes.push(duplicate);
                changes.added.push(duplicate);
            }
        } else if (nodeIds && Array.isArray(nodeIds)) {
            // Standard duplication from existing nodes
            const defaultOffset = offset || [20, 20];
            
            for (const nodeId of nodeIds) {
                const originalNode = state.nodes.find(n => n.id === nodeId);
                if (originalNode) {
                    // Create duplicate with new ID
                    const duplicate = {
                        id: this.generateNodeId(),
                        type: originalNode.type,
                        pos: [originalNode.pos[0] + defaultOffset[0], originalNode.pos[1] + defaultOffset[1]],
                        size: [...originalNode.size],
                        properties: { ...originalNode.properties },
                        rotation: originalNode.rotation || 0,
                        flags: { ...originalNode.flags },
                        title: originalNode.title,
                        aspectRatio: originalNode.aspectRatio,
                        // Generate operation ID for standard duplication
                        _operationId: `dup-${Date.now()}-${nodeId}`
                    };
                    
                    state.nodes.push(duplicate);
                    changes.added.push(duplicate);
                }
                // Missing nodes are silently ignored
            }
        }
        
        // Always return changes, even if empty - operation still succeeded
        return changes;
    }
    
    /**
     * Apply node paste
     */
    applyNodePaste(params, state, changes) {
        const { nodeData, targetPosition } = params;
        
        if (nodeData && Array.isArray(nodeData) && targetPosition) {
            // Calculate center of clipboard content
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const data of nodeData) {
                minX = Math.min(minX, data.pos[0]);
                minY = Math.min(minY, data.pos[1]);
                maxX = Math.max(maxX, data.pos[0] + data.size[0]);
                maxY = Math.max(maxY, data.pos[1] + data.size[1]);
            }
            
            const clipboardCenter = [(minX + maxX) / 2, (minY + maxY) / 2];
            
            // Track created nodes by index for parent-child mapping
            const nodesByIndex = new Map();
            
            // First pass: create all nodes
            nodeData.forEach((data, index) => {
                // Position relative to target position
                const offsetFromCenter = [
                    data.pos[0] - clipboardCenter[0],
                    data.pos[1] - clipboardCenter[1]
                ];
                
                const node = {
                    id: this.generateNodeId(),
                    type: data.type,
                    pos: [
                        targetPosition[0] + offsetFromCenter[0],
                        targetPosition[1] + offsetFromCenter[1]
                    ],
                    size: [...data.size],
                    properties: { ...data.properties },
                    rotation: data.rotation || 0,
                    flags: { ...data.flags },
                    title: data.title,
                    aspectRatio: data.aspectRatio
                };
                
                // Initialize childNodes for group nodes
                if (node.type === 'container/group') {
                    if (!node.properties) {
                        node.properties = {};
                    }
                    node.properties.childNodes = [];
                }
                
                state.nodes.push(node);
                changes.added.push(node);
                nodesByIndex.set(index, node);
            });
            
            // Second pass: recreate parent-child relationships
            nodeData.forEach((data, index) => {
                if (data.type === 'container/group' && data.properties && data.properties._pasteChildIndices) {
                    const parentNode = nodesByIndex.get(index);
                    if (parentNode) {
                        // Add children based on indices
                        for (const childIndex of data.properties._pasteChildIndices) {
                            const childNode = nodesByIndex.get(childIndex);
                            if (childNode) {
                                // Add to parent's childNodes
                                parentNode.properties.childNodes.push(childNode.id);
                                console.log(`[Paste] Added child ${childNode.id} to group ${parentNode.id}`);
                            }
                        }
                    }
                }
            });
        }
        
        // Always return changes, even if empty - operation still succeeded
        return changes;
    }
    
    /**
     * Apply image upload complete - update all nodes with matching hash
     */
    applyImageUploadComplete(params, state, changes) {
        const { hash, serverUrl, serverFilename } = params;
        
        console.log(`🔍 Processing image_upload_complete:`, {
            hash: hash?.substring(0, 8),
            serverUrl,
            totalNodes: state.nodes.length,
            imageNodes: state.nodes.filter(n => n.type === 'media/image').length
        });
        
        // Debug: Show all image nodes
        state.nodes.filter(n => n.type === 'media/image').forEach(node => {
            console.log(`  Image node ${node.id}:`, {
                hash: node.properties.hash?.substring(0, 8),
                hasServerUrl: !!node.properties.serverUrl,
                matchesHash: node.properties.hash === hash
            });
        });
        
        // Find all image nodes with this hash
        let updatedCount = 0;
        for (const node of state.nodes) {
            if (node.type === 'media/image' && 
                node.properties.hash === hash && 
                !node.properties.serverUrl) {
                
                // Update node with server URL
                node.properties.serverUrl = serverUrl;
                if (serverFilename) {
                    node.properties.serverFilename = serverFilename;
                }
                
                changes.updated.push(node);
                updatedCount++;

            }
        }
        
        if (updatedCount > 0) {
            console.log(`📝 Image upload complete: Updated ${updatedCount} nodes with hash ${hash.substring(0, 8)}...`);
        } else {
            console.log(`⚠️ No nodes updated for hash ${hash?.substring(0, 8)} - all already have serverUrl or hash mismatch`);
        }
        
        // Always return changes, even if empty - operation still succeeded
        return changes;
    }
    
    /**
     * Save canvas state to database
     */
    async saveCanvasState(canvasId, state) {
        // Log if any nodes have color correction properties
        const nodesWithColorCorrections = state.nodes.filter(node => 
            node.toneCurve || node.adjustments || node.colorBalance ||
            node.toneCurveBypassed !== undefined || 
            node.colorAdjustmentsBypassed !== undefined ||
            node.colorBalanceBypassed !== undefined
        );
        
        if (nodesWithColorCorrections.length > 0) {
            console.log(`[CanvasStateManager] Saving ${nodesWithColorCorrections.length} nodes with color corrections`);
            nodesWithColorCorrections.forEach(node => {
                console.log(`  Node ${node.id}: toneCurve=${!!node.toneCurve}, adjustments=${!!node.adjustments}, colorBalance=${!!node.colorBalance}, ` +
                          `toneCurveBypassed=${node.toneCurveBypassed}, colorAdjustmentsBypassed=${node.colorAdjustmentsBypassed}, colorBalanceBypassed=${node.colorBalanceBypassed}`);
            });
        }
        
        const data = JSON.stringify({
            nodes: state.nodes,
            version: state.version
        });
        
        await this.db.run(
            `UPDATE canvases 
             SET canvas_data = ?, last_modified = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [data, canvasId]
        );
    }
    
    /**
     * Get full canvas state for sync
     */
    async getFullState(canvasId) {
        const state = await this.getCanvasState(canvasId);
        return {
            nodes: state.nodes,
            version: state.version
        };
    }
    
    /**
     * Create operation validators
     */
    createValidators() {
        const validators = new Map();
        
        validators.set('node_create', (op, state) => {
            if (!op.params.type || !op.params.pos) {
                return { valid: false, error: 'Missing required parameters' };
            }
            return { valid: true };
        });
        
        validators.set('node_move', (op, state) => {
            if (!op.params.nodeId && !op.params.nodeIds) {
                return { valid: false, error: 'Missing nodeId or nodeIds' };
            }
            
            // Always valid - missing nodes will be silently ignored during apply
            // This allows for eventual consistency between client and server
            return { valid: true };
        });
        
        validators.set('node_delete', (op, state) => {
            if (!op.params.nodeIds || op.params.nodeIds.length === 0) {
                return { valid: false, error: 'No nodes to delete' };
            }
            // Always valid - missing nodes will be silently ignored during apply
            // This prevents "node not found" errors during collaborative editing
            return { valid: true };
        });
        
        validators.set('node_resize', (op, state) => {
            if (!op.params.nodeIds || !op.params.sizes) {
                return { valid: false, error: 'Missing required parameters' };
            }
            if (op.params.nodeIds.length !== op.params.sizes.length) {
                return { valid: false, error: 'Mismatched nodeIds and sizes arrays' };
            }
            // Always valid - missing nodes will be silently ignored during apply
            return { valid: true };
        });
        
        validators.set('node_property_update', (op, state) => {
            if (!op.params.nodeId || !op.params.property) {
                return { valid: false, error: 'Missing required parameters' };
            }
            // Always valid - missing nodes will be silently ignored during apply
            // This allows property updates during node creation/sync
            return { valid: true };
        });
        
        validators.set('node_rotate', (op, state) => {
            // Single node rotation
            if (op.params.nodeId) {
                if (typeof op.params.angle !== 'number') {
                    return { valid: false, error: 'Missing required parameters' };
                }
                // Always valid - missing nodes will be silently ignored during apply
                return { valid: true };
            }
            
            // Multi-node rotation
            if (op.params.nodeIds) {
                if (!Array.isArray(op.params.nodeIds) || !Array.isArray(op.params.angles)) {
                    return { valid: false, error: 'Missing required parameters for batch rotation' };
                }
                if (op.params.nodeIds.length !== op.params.angles.length) {
                    return { valid: false, error: 'Mismatched nodeIds and angles arrays' };
                }
                if (op.params.positions && op.params.positions.length !== op.params.nodeIds.length) {
                    return { valid: false, error: 'Mismatched positions array length' };
                }
                // Always valid - missing nodes will be silently ignored during apply
                return { valid: true };
            }
            
            return { valid: false, error: 'Missing nodeId or nodeIds parameter' };
        });
        
        validators.set('node_reset', (op, state) => {
            if (!op.params.nodeIds || !Array.isArray(op.params.nodeIds) || op.params.nodeIds.length === 0) {
                return { valid: false, error: 'Missing or invalid nodeIds' };
            }
            if (!op.params.resetRotation && !op.params.resetAspectRatio) {
                return { valid: false, error: 'Missing reset parameters' };
            }
            // Always valid - missing nodes will be silently ignored during apply
            return { valid: true };
        });
        
        validators.set('video_toggle', (op, state) => {
            if (!op.params.nodeId) {
                return { valid: false, error: 'Missing nodeId' };
            }
            // Always valid - missing nodes will be silently ignored during apply
            // Non-video nodes will also be ignored gracefully
            return { valid: true };
        });
        
        validators.set('node_batch_property_update', (op, state) => {
            if (!op.params.updates || !Array.isArray(op.params.updates)) {
                return { valid: false, error: 'Missing updates array' };
            }
            // Always valid - missing nodes will be silently ignored during apply
            return { valid: true };
        });
        
        validators.set('node_duplicate', (op, state) => {
            // Support explicit node data (Alt+drag) or standard duplication
            if (op.params.nodeData && Array.isArray(op.params.nodeData) && op.params.nodeData.length > 0) {
                return { valid: true }; // Explicit node data provided
            }
            
            if (!op.params.nodeIds || !Array.isArray(op.params.nodeIds) || op.params.nodeIds.length === 0) {
                return { valid: false, error: 'Missing or invalid nodeIds or nodeData' };
            }
            // Always valid - missing nodes will be silently ignored during apply
            // This allows duplication during sync and handles race conditions
            return { valid: true };
        });
        
        validators.set('node_paste', (op, state) => {
            if (!op.params.nodeData || !Array.isArray(op.params.nodeData) || op.params.nodeData.length === 0) {
                return { valid: false, error: 'Missing or invalid node data' };
            }
            if (!op.params.targetPosition || !Array.isArray(op.params.targetPosition) || op.params.targetPosition.length !== 2) {
                return { valid: false, error: 'Invalid target position' };
            }
            return { valid: true };
        });
        
        validators.set('node_align', (op, state) => {
            if (!op.params.nodeIds || !Array.isArray(op.params.nodeIds) || op.params.nodeIds.length < 2) {
                return { valid: false, error: 'Missing or invalid nodeIds (need at least 2 nodes)' };
            }
            if (!op.params.axis || !['horizontal', 'vertical', 'grid'].includes(op.params.axis)) {
                return { valid: false, error: 'Missing or invalid axis' };
            }
            if (!op.params.positions || !Array.isArray(op.params.positions) || 
                op.params.positions.length !== op.params.nodeIds.length) {
                return { valid: false, error: 'Missing or invalid positions array' };
            }
            // Always valid - missing nodes will be silently ignored during apply
            return { valid: true };
        });
        
        validators.set('node_layer_order', (op, state) => {
            if (!op.params.nodeIds || !Array.isArray(op.params.nodeIds) || op.params.nodeIds.length === 0) {
                return { valid: false, error: 'Missing or invalid nodeIds' };
            }
            if (!['up', 'down', 'front', 'back'].includes(op.params.direction)) {
                return { valid: false, error: 'Invalid direction' };
            }
            return { valid: true };
        });
        
        validators.set('image_upload_complete', (op, state) => {
            if (!op.params.hash || !op.params.serverUrl) {
                return { valid: false, error: 'Missing hash or serverUrl' };
            }
            return { valid: true };
        });
        
        // Group operation validators
        validators.set('group_create', (op, state) => {
            if (!op.params.nodeIds || !Array.isArray(op.params.nodeIds)) {
                return { valid: false, error: 'Missing or invalid nodeIds for group creation' };
            }
            if (!op.params.groupPos || !Array.isArray(op.params.groupPos) || op.params.groupPos.length !== 2) {
                return { valid: false, error: 'Invalid group position' };
            }
            return { valid: true };
        });
        
        validators.set('group_add_node', (op, state) => {
            if (!op.params.groupId || !op.params.nodeId) {
                return { valid: false, error: 'Missing groupId or nodeId' };
            }
            return { valid: true };
        });
        
        validators.set('group_remove_node', (op, state) => {
            if (!op.params.groupId || !op.params.nodeId) {
                return { valid: false, error: 'Missing groupId or nodeId' };
            }
            return { valid: true };
        });
        
        validators.set('group_move', (op, state) => {
            if (!op.params.groupId) {
                return { valid: false, error: 'Missing groupId for move' };
            }
            if (!op.params.position || !Array.isArray(op.params.position) || op.params.position.length !== 2) {
                return { valid: false, error: 'Invalid position for group move' };
            }
            return { valid: true };
        });
        
        validators.set('group_resize', (op, state) => {
            if (!op.params.groupId) {
                return { valid: false, error: 'Missing groupId for resize' };
            }
            if (!op.params.size || !Array.isArray(op.params.size) || op.params.size.length !== 2) {
                return { valid: false, error: 'Invalid size for group resize' };
            }
            return { valid: true };
        });
        
        validators.set('group_toggle_collapsed', (op, state) => {
            if (!op.params.groupId) {
                return { valid: false, error: 'Missing groupId for toggle collapsed' };
            }
            return { valid: true };
        });
        
        validators.set('group_update_style', (op, state) => {
            if (!op.params.groupId) {
                return { valid: false, error: 'Missing groupId for style update' };
            }
            if (!op.params.style || typeof op.params.style !== 'object') {
                return { valid: false, error: 'Invalid style object' };
            }
            return { valid: true };
        });
        
        return validators;
    }
    
    // ===================================
    // GROUP OPERATION HANDLERS
    // ===================================
    
    /**
     * Apply group creation
     */
    applyGroupCreate(params, state, changes) {
        const groupId = params.groupId || this.generateNodeId();
        
        // Create group node
        const group = {
            id: groupId,
            type: 'container/group',
            pos: [...params.groupPos],
            size: params.groupSize ? [...params.groupSize] : [300, 200],
            properties: {
                childNodes: [...params.nodeIds],
                isCollapsed: false,
                style: params.style || {}
            },
            title: params.groupTitle || 'Group',
            flags: {}
        };
        
        state.nodes.push(group);
        changes.added.push(group);
        
        return changes;
    }
    
    /**
     * Apply adding node to group
     */
    applyGroupAddNode(params, state, changes) {
        const group = state.nodes.find(n => n.id === params.groupId);
        if (!group || group.type !== 'container/group') {
            return changes; // Silently ignore missing groups
        }
        
        // Initialize childNodes if it doesn't exist
        if (!group.properties.childNodes) {
            group.properties.childNodes = [];
        }
        
        // Add node to group if not already present
        if (!group.properties.childNodes.includes(params.nodeId)) {
            group.properties.childNodes.push(params.nodeId);
            changes.updated.push(group);
        }
        
        return changes;
    }
    
    /**
     * Apply removing node from group
     */
    applyGroupRemoveNode(params, state, changes) {
        const group = state.nodes.find(n => n.id === params.groupId);
        if (!group || group.type !== 'container/group') {
            return changes; // Silently ignore missing groups
        }
        
        if (group.properties.childNodes) {
            const index = group.properties.childNodes.indexOf(params.nodeId);
            if (index !== -1) {
                group.properties.childNodes.splice(index, 1);
                changes.updated.push(group);
            }
        }
        
        return changes;
    }
    
    /**
     * Apply group move (moves group and all child nodes)
     */
    applyGroupMove(params, state, changes) {
        const group = state.nodes.find(n => n.id === params.groupId);
        if (!group || group.type !== 'container/group') {
            return changes; // Silently ignore missing groups
        }
        
        // Calculate offset
        const deltaX = params.position[0] - group.pos[0];
        const deltaY = params.position[1] - group.pos[1];
        
        // Update group position
        group.pos[0] = params.position[0];
        group.pos[1] = params.position[1];
        changes.updated.push(group);
        
        // Update child node positions
        if (group.properties.childNodes) {
            for (const nodeId of group.properties.childNodes) {
                const childNode = state.nodes.find(n => n.id === nodeId);
                if (childNode) {
                    childNode.pos[0] += deltaX;
                    childNode.pos[1] += deltaY;
                    changes.updated.push(childNode);
                }
            }
        }
        
        return changes;
    }
    
    /**
     * Apply group resize
     */
    applyGroupResize(params, state, changes) {
        const group = state.nodes.find(n => n.id === params.groupId);
        if (!group || group.type !== 'container/group') {
            return changes; // Silently ignore missing groups
        }
        
        // Update group size
        group.size[0] = params.size[0];
        group.size[1] = params.size[1];
        
        // Update position if provided
        if (params.position) {
            group.pos[0] = params.position[0];
            group.pos[1] = params.position[1];
        }
        
        changes.updated.push(group);
        return changes;
    }
    
    /**
     * Apply group collapse/expand toggle
     */
    applyGroupToggleCollapsed(params, state, changes) {
        const group = state.nodes.find(n => n.id === params.groupId);
        if (!group || group.type !== 'container/group') {
            return changes; // Silently ignore missing groups
        }
        
        // Toggle collapsed state
        group.properties.isCollapsed = !group.properties.isCollapsed;
        
        // Update size based on collapsed state
        if (group.properties.isCollapsed) {
            // Store expanded size and use collapsed size
            group.properties.expandedSize = [...group.size];
            group.size = [200, 40]; // Collapsed size
        } else {
            // Restore expanded size
            if (group.properties.expandedSize) {
                group.size = [...group.properties.expandedSize];
            }
        }
        
        changes.updated.push(group);
        return changes;
    }
    
    /**
     * Apply group style update
     */
    applyGroupUpdateStyle(params, state, changes) {
        const group = state.nodes.find(n => n.id === params.groupId);
        if (!group || group.type !== 'container/group') {
            return changes; // Silently ignore missing groups
        }
        
        // Update group style
        if (!group.properties.style) {
            group.properties.style = {};
        }
        
        Object.assign(group.properties.style, params.style);
        changes.updated.push(group);
        
        return changes;
    }
    
    /**
     * Apply node layer order change
     */
    applyNodeLayerOrder(params, state, changes) {
        const { nodeIds, direction } = params;
        
        // Update z-index values based on the final positions from the client
        if (params.zIndexUpdates) {
            for (const [nodeId, zIndex] of Object.entries(params.zIndexUpdates)) {
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
     * Generate unique node ID
     */
    generateNodeId() {
        // Match the client-side ID format
        return Date.now() + Math.floor(Math.random() * 1000);
    }
    
    /**
     * Clear canvas state (for testing)
     */
    clearState(canvasId) {
        this.canvasStates.delete(canvasId);
        this.stateVersions.delete(canvasId);
    }
}

module.exports = CanvasStateManager;