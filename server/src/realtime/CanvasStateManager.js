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
        
        // In-memory canvas states by project ID
        this.canvasStates = new Map();
        
        // State version tracking
        this.stateVersions = new Map();
        
        // Operation validators
        this.validators = this.createValidators();

    }
    
    /**
     * Get or create canvas state for a project
     */
    async getCanvasState(projectId) {
        if (!this.canvasStates.has(projectId)) {
            // Load from database
            const state = await this.loadCanvasState(projectId);
            this.canvasStates.set(projectId, state);
            this.stateVersions.set(projectId, state.version || 0);
        }
        
        return this.canvasStates.get(projectId);
    }
    
    /**
     * Load canvas state from database
     */
    async loadCanvasState(projectId) {
        try {
            // Get latest canvas data
            const canvas = await this.db.get(
                'SELECT * FROM canvases WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1',
                [projectId]
            );
            
            if (canvas && canvas.data) {
                const data = JSON.parse(canvas.data);
                return {
                    nodes: data.nodes || [],
                    version: canvas.version || 0,
                    lastModified: canvas.updated_at
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
    async executeOperation(projectId, operation, userId) {
        const state = await this.getCanvasState(projectId);
        const currentVersion = this.stateVersions.get(projectId) || 0;
        
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
        this.stateVersions.set(projectId, newVersion);
        state.version = newVersion;
        state.lastModified = Date.now();
        
        // Save to database
        await this.saveCanvasState(projectId, state);
        
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

            case 'image_upload_complete':
                return this.applyImageUploadComplete(operation.params, state, changes);
                
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
        
        for (const node of state.nodes) {
            if (toDelete.has(node.id)) {
                changes.removed.push(node.id);
            } else {
                remaining.push(node);
            }
        }
        
        state.nodes = remaining;
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
            // Handle special properties that belong on the node object itself
            const nodeDirectProperties = ['title', 'rotation', 'aspectRatio'];
            
            if (nodeDirectProperties.includes(params.property)) {
                // Update property directly on the node object
                node[params.property] = params.value;
                
            } else {
                // Update property in the properties object
                node.properties[params.property] = params.value;
                
            }
            
            changes.updated.push(node);
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
            
            for (const data of nodeData) {
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
                
                state.nodes.push(node);
                changes.added.push(node);
            }
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
    async saveCanvasState(projectId, state) {
        const data = JSON.stringify({
            nodes: state.nodes,
            version: state.version
        });
        
        await this.db.run(
            `INSERT OR REPLACE INTO canvases (project_id, data, version, updated_at)
             VALUES (?, ?, ?, ?)`,
            [projectId, data, state.version, Date.now()]
        );
    }
    
    /**
     * Get full canvas state for sync
     */
    async getFullState(projectId) {
        const state = await this.getCanvasState(projectId);
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
        
        validators.set('image_upload_complete', (op, state) => {
            if (!op.params.hash || !op.params.serverUrl) {
                return { valid: false, error: 'Missing hash or serverUrl' };
            }
            return { valid: true };
        });
        
        return validators;
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
    clearState(projectId) {
        this.canvasStates.delete(projectId);
        this.stateVersions.delete(projectId);
    }
}

module.exports = CanvasStateManager;