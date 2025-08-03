/**
 * Extended node commands for all operations
 */

class ResizeNodeCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_resize', params, origin);
    }
    
    validate() {
        const { nodeIds, sizes, size, positions, position } = this.params;
        
        if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
            return { valid: false, error: 'Missing or invalid nodeIds' };
        }
        
        // Handle both plural (sizes) and singular (size) forms
        let sizesArray = sizes;
        if (!sizesArray && size && nodeIds.length === 1) {
            // Convert singular form to plural for consistency
            sizesArray = [size];
            this.params.sizes = sizesArray;
        }
        
        if (!sizesArray || !Array.isArray(sizesArray) || sizesArray.length !== nodeIds.length) {
            console.error('ResizeNodeCommand validation failed:', {
                sizes,
                size,
                sizesArray,
                sizesIsArray: Array.isArray(sizesArray),
                sizesLength: sizesArray?.length,
                nodeIds,
                nodeIdsLength: nodeIds.length,
                params: this.params
            });
            return { valid: false, error: 'Invalid sizes array' };
        }
        
        // Handle both plural (positions) and singular (position) forms
        let positionsArray = positions;
        if (!positionsArray && position && nodeIds.length === 1) {
            // Convert singular form to plural for consistency
            positionsArray = [position];
            this.params.positions = positionsArray;
        }
        
        if (positionsArray && (!Array.isArray(positionsArray) || positionsArray.length !== nodeIds.length)) {
            return { valid: false, error: 'Invalid positions array' };
        }
        
        return { valid: true };
    }
    
    async prepareUndoData(context) {
        const { graph } = context;
        this.undoData = { 
            previousSizes: {},
            previousPositions: {},
            previousAspectRatios: {},
            previousLockedAspectRatios: {}
        };

        if (this.initialState) {
            this.params.nodeIds.forEach((nodeId, index) => {
                this.undoData.previousSizes[nodeId] = this.initialState.sizes[index];
                this.undoData.previousPositions[nodeId] = this.initialState.positions[index];
            });
            return;
        }
        
        this.params.nodeIds.forEach(nodeId => {
            const node = graph.getNodeById(nodeId);
            if (node) {
                this.undoData.previousSizes[nodeId] = [...node.size];
                this.undoData.previousPositions[nodeId] = [...node.pos];
                this.undoData.previousAspectRatios[nodeId] = node.aspectRatio;
                this.undoData.previousLockedAspectRatios[nodeId] = node.lockedAspectRatio;
            }
        });
        
    }
    
    async execute(context) {
        const { graph } = context;
        
        // 
        this.params.nodeIds.forEach((nodeId, index) => {
            const node = graph.getNodeById(nodeId);
            if (!node) return;
            
            const newSize = [...this.params.sizes[index]];
            
            // Update size
            node.size[0] = newSize[0];
            node.size[1] = newSize[1];
            
            // If positions are provided (from server/remote), use them directly
            if (this.params.positions && this.params.positions[index]) {
                node.pos[0] = this.params.positions[index][0];
                node.pos[1] = this.params.positions[index][1];
            }
            // Otherwise, for local operations on rotated nodes, adjust position to maintain center
            else if (this.origin === 'local' && node.rotation && Math.abs(node.rotation) > 0.001) {
                // This should only happen for local operations
                // Remote operations should include positions when needed
                const oldPos = this.undoData.previousPositions[nodeId];
                const oldSize = this.undoData.previousSizes[nodeId];
                const oldCenterX = oldPos[0] + oldSize[0] / 2;
                const oldCenterY = oldPos[1] + oldSize[1] / 2;
                
                node.pos[0] = oldCenterX - newSize[0] / 2;
                node.pos[1] = oldCenterY - newSize[1] / 2;
            }
            
            // Update aspect ratio to match the new size
            // This preserves non-uniform scaling from remote clients
            node.aspectRatio = node.size[0] / node.size[1];
            
            // If aspect ratio is locked, update the locked ratio to the new one
            // This ensures property panel edits maintain the new ratio after handle resizing
            if (node.aspectRatioLocked !== false) {
                node.lockedAspectRatio = node.size[0] / node.size[1];
            }
            
            // Don't call onResize() for collaborative operations to preserve exact sizing
            // onResize() can interfere with non-uniform scaling by enforcing aspect ratios
        });
        
        // Trigger canvas redraw
        if (graph.canvas) {
            graph.canvas.dirty_canvas = true;
            graph.change();
        }
        
        this.executed = true;
        // // 
        return { success: true };
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        
        // Restore all properties for each node
        for (const nodeId of this.params.nodeIds) {
            const node = graph.getNodeById(nodeId);
            if (!node) continue;
            
            // Restore size
            if (this.undoData.previousSizes[nodeId]) {
                node.size[0] = this.undoData.previousSizes[nodeId][0];
                node.size[1] = this.undoData.previousSizes[nodeId][1];
            }
            
            // Restore position
            if (this.undoData.previousPositions[nodeId]) {
                node.pos[0] = this.undoData.previousPositions[nodeId][0];
                node.pos[1] = this.undoData.previousPositions[nodeId][1];
            }
            
            // Restore aspect ratios
            if (this.undoData.previousAspectRatios[nodeId] !== undefined) {
                node.aspectRatio = this.undoData.previousAspectRatios[nodeId];
            }
            if (this.undoData.previousLockedAspectRatios[nodeId] !== undefined) {
                node.lockedAspectRatio = this.undoData.previousLockedAspectRatios[nodeId];
            }
            
            // Call onResize to update any dependent properties
            if (node.onResize) {
                node.onResize();
            }
        }
        
        // Trigger canvas redraw
        if (graph.canvas) {
            graph.canvas.dirty_canvas = true;
            graph.change();
        }
        
        return { success: true };
    }
}

class ResetNodeCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_reset', params, origin);
    }
    
    validate() {
        const { nodeIds, resetType, resetRotation, resetAspectRatio } = this.params;
        
        if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
            return { valid: false, error: 'Missing or invalid nodeIds' };
        }
        
        // Support both old resetType format and new boolean format
        if (!resetType && !resetRotation && !resetAspectRatio) {
            return { valid: false, error: 'Missing reset parameters' };
        }
        
        return { valid: true };
    }
    
    async prepareUndoData(context) {
        const { graph } = context;

        if (this.initialState) {
            this.undoData = {
                nodes: this.params.nodeIds.map((nodeId, index) => ({
                    id: nodeId,
                    operations: [
                        { type: 'rotation', oldValue: this.initialState.rotations[index] },
                        { type: 'aspectRatio', oldSize: this.initialState.sizes[index] }
                    ]
                }))
            };
            return;
        }

        this.undoData = { nodes: [] };
        
        this.params.nodeIds.forEach((nodeId, index) => {
            const node = graph.getNodeById(nodeId);
            if (!node) return;
            
            const undoInfo = {
                id: node.id,
                operations: []
            };
            
            // Check what we're resetting
            const resetRotation = this.params.resetRotation || this.params.resetType === 'rotation' || !this.params.resetType;
            const resetAspectRatio = this.params.resetAspectRatio || this.params.resetType === 'aspectRatio';
            const resetScale = this.params.resetType === 'scale';
            
            if (resetRotation) {
                undoInfo.operations.push({
                    type: 'rotation',
                    oldValue: node.rotation || 0
                });
            }
            
            if (resetScale && node.properties.scale !== undefined) {
                undoInfo.operations.push({
                    type: 'scale',
                    oldValue: node.properties.scale
                });
            }
            
            if (resetAspectRatio && node.originalAspect) {
                undoInfo.operations.push({
                    type: 'aspectRatio',
                    oldSize: [...node.size]
                });
            }
            
            this.undoData.nodes.push(undoInfo);
        });
        
    }
    
    async execute(context) {
        const { graph, canvas } = context;
        
        // // 
        const startTime = performance.now();
        
        // First pass: Apply all changes locally immediately for instant feedback
        this.params.nodeIds.forEach((nodeId, index) => {
            const node = graph.getNodeById(nodeId);
            if (!node) return;
            
            // Handle new boolean format
            if (this.params.resetRotation) {
                node.rotation = this.params.values ? this.params.values[index] : 0;
            }
            
            if (this.params.resetAspectRatio) {
                if (node.originalAspect) {
                    const value = this.params.values ? this.params.values[index] : node.originalAspect;
                    node.size[1] = node.size[0] / value;
                    if (node.onResize) node.onResize();
                }
            }
            
            // Handle old resetType format for backwards compatibility
            if (this.params.resetType) {
                switch (this.params.resetType) {
                    case 'rotation':
                        node.rotation = this.params.values ? this.params.values[index] : 0;
                        break;
                        
                    case 'scale':
                        if (node.properties.scale !== undefined) {
                            node.properties.scale = this.params.values ? this.params.values[index] : 1;
                        }
                        break;
                        
                    case 'aspectRatio':
                        if (node.originalAspect) {
                            node.size[1] = node.size[0] / node.originalAspect;
                            if (node.onResize) node.onResize();
                        }
                        break;
                }
            }
        });
        
        // Immediate canvas update for instant visual feedback
        if (canvas) {
            canvas.dirty_canvas = true;
            // Force immediate redraw
            if (canvas.draw) {
                requestAnimationFrame(() => canvas.draw());
            }
        }
        
        const elapsed = performance.now() - startTime;
        // // console.log(`✅ Reset completed in ${elapsed.toFixed(1)}ms for ${this.params.nodeIds.length} nodes`);
        
        this.executed = true;
        return { success: true };
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        
        this.undoData.nodes.forEach((undoInfo) => {
            const node = graph.getNodeById(undoInfo.id);
            if (!node) return;
            
            // Handle new operations format
            if (undoInfo.operations) {
                undoInfo.operations.forEach(op => {
                    switch (op.type) {
                        case 'rotation':
                            node.rotation = op.oldValue;
                            break;
                            
                        case 'scale':
                            if (op.oldValue !== undefined) {
                                node.properties.scale = op.oldValue;
                            }
                            break;
                            
                        case 'aspectRatio':
                            if (op.oldSize) {
                                node.size[0] = op.oldSize[0];
                                node.size[1] = op.oldSize[1];
                                if (node.onResize) node.onResize();
                            }
                            break;
                    }
                });
            }
            
            // Handle old resetType format for backwards compatibility
            if (undoInfo.resetType) {
                switch (undoInfo.resetType) {
                    case 'rotation':
                        node.rotation = undoInfo.oldRotation;
                        break;
                        
                    case 'scale':
                        if (undoInfo.oldScale !== undefined) {
                            node.properties.scale = undoInfo.oldScale;
                        }
                        break;
                        
                    case 'aspectRatio':
                        if (undoInfo.oldSize) {
                            node.size[0] = undoInfo.oldSize[0];
                            node.size[1] = undoInfo.oldSize[1];
                            if (node.onResize) node.onResize();
                        }
                        break;
                }
            }
        });
        
        return { success: true };
    }
}

class RotateNodeCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_rotate', params, origin);
    }
    
    validate() {
        const { nodeId, nodeIds, angle, angles, positions } = this.params;
        
        // Single node rotation
        if (nodeId) {
            if (typeof angle !== 'number') {
                return { valid: false, error: 'Invalid angle' };
            }
            return { valid: true };
        }
        
        // Multi-node rotation
        if (nodeIds && Array.isArray(nodeIds)) {
            if (!angles || !Array.isArray(angles) || angles.length !== nodeIds.length) {
                return { valid: false, error: 'Invalid angles array for multi-node rotation' };
            }
            if (positions && (!Array.isArray(positions) || positions.length !== nodeIds.length)) {
                return { valid: false, error: 'Invalid positions array for multi-node rotation' };
            }
            return { valid: true };
        }
        
        return { valid: false, error: 'Missing nodeId or nodeIds' };
    }
    
    async prepareUndoData(context) {
        const { graph } = context;
        
        this.undoData = {
            previousRotations: {},
            previousPositions: {}
        };

        if (this.initialState) {
            this.params.nodeIds.forEach((nodeId, index) => {
                this.undoData.previousRotations[nodeId] = this.initialState.rotations[index];
                this.undoData.previousPositions[nodeId] = this.initialState.positions[index];
            });
            return;
        }
        
        // Single node rotation
        if (this.params.nodeId) {
            const node = graph.getNodeById(this.params.nodeId);
            if (node) {
                this.undoData.previousRotations[node.id] = node.rotation || 0;
                if (this.params.position) {
                    this.undoData.previousPositions[node.id] = [...node.pos];
                }
            }
        }
        // Multi-node rotation
        else if (this.params.nodeIds) {
            this.params.nodeIds.forEach((nodeId, index) => {
                const node = graph.getNodeById(nodeId);
                if (node) {
                    this.undoData.previousRotations[nodeId] = node.rotation || 0;
                    if (this.params.positions?.[index]) {
                        this.undoData.previousPositions[nodeId] = [...node.pos];
                    }
                }
            });
        }
        
    }
    
    async execute(context) {
        const { graph } = context;
        
        // Single node rotation
        if (this.params.nodeId) {
            const node = graph.getNodeById(this.params.nodeId);
            
            if (!node) {
                throw new Error('Node not found');
            }
            
            node.rotation = this.params.angle;
            
            this.executed = true;
            return { node };
        }
        
        // Multi-node rotation
        if (this.params.nodeIds) {
            this.params.nodeIds.forEach((nodeId, index) => {
                const node = graph.getNodeById(nodeId);
                if (!node) return;
                
                // Update rotation
                node.rotation = this.params.angles[index];
                
                // Update position if provided (for group center rotation)
                if (this.params.positions && this.params.positions[index]) {
                    node.pos[0] = this.params.positions[index][0];
                    node.pos[1] = this.params.positions[index][1];
                }
            });
            
            this.executed = true;
            return { success: true };
        }
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        
        // Restore rotations
        if (this.undoData.previousRotations) {
            for (const [nodeId, rotation] of Object.entries(this.undoData.previousRotations)) {
                const node = graph.getNodeById(nodeId);
                if (node) {
                    node.rotation = rotation;
                }
            }
        }
        
        // Restore positions
        if (this.undoData.previousPositions) {
            for (const [nodeId, pos] of Object.entries(this.undoData.previousPositions)) {
                const node = graph.getNodeById(nodeId);
                if (node) {
                    node.pos[0] = pos[0];
                    node.pos[1] = pos[1];
                }
            }
        }
        
        return { success: true };
    }
}

class VideoToggleCommand extends Command {
    constructor(params, origin = 'local') {
        super('video_toggle', params, origin);
    }
    
    validate() {
        const { nodeId } = this.params;
        
        if (!nodeId) {
            return { valid: false, error: 'Missing nodeId' };
        }
        
        return { valid: true };
    }
    
    async prepareUndoData(context) {
        const { graph } = context;
        const node = graph.getNodeById(this.params.nodeId);
        
        if (node && node.type === 'media/video') {
            this.undoData = {
                nodeId: node.id,
                wasPlaying: node.properties.playing || false,
                wasPaused: node.properties.paused || false
            };
        }
        
    }
    
    async execute(context) {
        const { graph } = context;
        const node = graph.getNodeById(this.params.nodeId);
        
        if (!node || node.type !== 'media/video') {
            throw new Error('Video node not found');
        }
        
        this.undoData = {
            nodeId: node.id,
            wasPaused: node.properties.paused
        };
        
        // Toggle or set specific state
        const newPaused = this.params.paused !== undefined ? 
            this.params.paused : !node.properties.paused;
        
        node.properties.paused = newPaused;
        
        if (node.video) {
            if (newPaused) {
                node.video.pause();
            } else {
                await node.video.play().catch(() => {
                    // Handle autoplay restrictions
                    
                });
            }
        }
        
        this.executed = true;
        return { node, paused: newPaused };
    }
    
    async undo(context) {
        const { graph } = context;
        const node = graph.getNodeById(this.undoData.nodeId);
        
        if (node && node.type === 'media/video') {
            node.properties.paused = this.undoData.wasPaused;
            
            if (node.video) {
                if (this.undoData.wasPaused) {
                    node.video.pause();
                } else {
                    await node.video.play().catch(() => {});
                }
            }
        }
        
        return { success: true };
    }
}

class BatchPropertyUpdateCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_batch_property_update', params, origin);
    }
    
    validate() {
        const { updates } = this.params;
        
        if (!updates || !Array.isArray(updates) || updates.length === 0) {
            return { valid: false, error: 'Missing or invalid updates array' };
        }
        
        // Each update should have nodeId, property, and value
        for (const update of updates) {
            if (!update.nodeId || !update.property) {
                return { valid: false, error: 'Invalid update entry' };
            }
        }
        
        return { valid: true };
    }
    
    async prepareUndoData(context) {
        const { graph } = context;
        this.undoData = { updates: [] };
        
        for (const update of this.params.updates) {
            const node = graph.getNodeById(update.nodeId);
            if (!node) continue;
            
            // Store old value
            const oldValue = update.property === 'properties' 
                ? { ...node.properties }
                : node[update.property];
                
            this.undoData.updates.push({
                nodeId: update.nodeId,
                property: update.property,
                oldValue: oldValue,
                newValue: update.value
            });
        }
        
    }
    
    async execute(context) {
        const { graph } = context;
        
        // Undo data should already be prepared
        if (!this.undoData) {
            this.undoData = { updates: [] };
        
        for (const update of this.params.updates) {
            const node = graph.getNodeById(update.nodeId);
            if (!node) continue;
            
            // Store old value
            this.undoData.updates.push({
                nodeId: update.nodeId,
                property: update.property,
                oldValue: node.properties[update.property]
            });
            
            // Update property
            node.properties[update.property] = update.value;
            
            // Handle special properties
            if (node.updateProperty) {
                node.updateProperty(update.property, update.value);
            }
        }
        
        this.executed = true;
        return { success: true };
        }  // This was the missing closing brace
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        
        for (const update of this.undoData.updates) {
            const node = graph.getNodeById(update.nodeId);
            if (!node) continue;
            
            node.properties[update.property] = update.oldValue;
            
            if (node.updateProperty) {
                node.updateProperty(update.property, update.oldValue);
            }
        }
        
        return { success: true };
    }
}

class DuplicateNodesCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_duplicate', params, origin);
    }
    
    validate() {
        const { nodeIds, nodeData, offset } = this.params;
        
        // Either nodeIds for standard duplication or nodeData for explicit duplication (Alt+drag)
        if (nodeData && Array.isArray(nodeData) && nodeData.length > 0) {
            return { valid: true }; // Explicit node data provided
        }
        
        if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
            return { valid: false, error: 'Missing or invalid nodeIds or nodeData' };
        }
        
        return { valid: true };
    }
    
    async prepareUndoData(context) {
        // For duplicate, we need to store the IDs of nodes that will be created
        // Since we don't know the IDs yet, we'll store placeholder data
        this.undoData = {
            createdNodeIds: [] // Will be populated during execute
        };
    }
    
    async execute(context) {
        const { graph } = context;
        
        // Check if optimistic updates are disabled - if so, skip local graph modification
        const optimisticEnabled = window.app?.operationPipeline?.stateSyncManager?.optimisticEnabled === true;
        const isRemoteOrigin = this.origin === 'remote' || this.origin === 'server';
        
        // Declare createdNodes at function level to avoid scoping issues
        let createdNodes = [];
        
        // Initialize undoData if not already done by prepareUndoData
        if (!this.undoData) {
            this.undoData = { createdNodeIds: [] };
        }
        
        // Handle explicit node data (Alt+drag) or standard duplication
        if (this.params.nodeData && Array.isArray(this.params.nodeData)) {
            const offset = this.params.offset || [0, 0];
            
            for (const nodeData of this.params.nodeData) {
                const duplicate = this.createNodeFromData(nodeData, context);
                if (duplicate) {
                    // Apply offset (usually [0,0] for Alt+drag since positions are pre-calculated)
                    duplicate.pos[0] += offset[0];
                    duplicate.pos[1] += offset[1];
                    
                    // Generate new ID
                    duplicate.id = Date.now() + Math.floor(Math.random() * 1000);
                    
                    // Add stable operation reference for sync tracking
                    // Use the operation ID from params if provided (Alt+drag)
                    if (this.params.operationId) {
                        duplicate._operationId = this.params.operationId;
                    } else {
                        duplicate._operationId = `${this.id}-${nodeData.id || duplicate.id}`;
                    }
                    duplicate._syncPending = true;
                    
                    // Mark as temporary for optimistic updates
                    if (optimisticEnabled && !isRemoteOrigin) {
                        duplicate._isTemporary = true;
                        duplicate._temporaryCreatedAt = Date.now();
                    }
                    
                    // For Alt+drag with explicit nodeData, nodes are ALREADY in the graph from drag operation
                    // Don't add them again - this would create phantom duplicates
                    // Only add to graph if this is a server/remote operation (server applying the change)
                    if (isRemoteOrigin) {
                        
                        graph.add(duplicate);
                    } else {
                        console.log(`⏭️ Skipping local add for Alt+drag node: ${duplicate.id} (already in graph)`);
                    }
                    
                    createdNodes.push(duplicate);
                    this.undoData.createdNodeIds.push(duplicate.id);
                }
            }
        } else {
            const offset = this.params.offset || [20, 20];
            
            for (const nodeId of this.params.nodeIds) {
                const originalNode = graph.getNodeById(nodeId);
                if (!originalNode) continue;

                // Serialize and deserialize to create a copy
                const nodeData = this.serializeNode(originalNode);
                const duplicate = this.createNodeFromData(nodeData, context);
                if (duplicate) {
                    // Apply offset
                    duplicate.pos[0] += offset[0];
                    duplicate.pos[1] += offset[1];
                    
                    // Generate new ID
                    duplicate.id = Date.now() + Math.floor(Math.random() * 1000);
                    
                    // Add stable operation reference for sync tracking
                    // Use the operation ID from params if provided
                    if (this.params.operationId) {
                        duplicate._operationId = this.params.operationId;
                    } else {
                        duplicate._operationId = `${this.id}-${originalNode.id}`;
                    }
                    duplicate._syncPending = true;
                    
                    // Mark as temporary for optimistic updates
                    if (optimisticEnabled && !isRemoteOrigin) {
                        duplicate._isTemporary = true;
                        duplicate._temporaryCreatedAt = Date.now();
                    }
                    
                    // For Ctrl+D: Only add to graph if optimistic updates enabled OR server/remote operation
                    if (optimisticEnabled || isRemoteOrigin) {
                        graph.add(duplicate);
                    }
                    
                    createdNodes.push(duplicate);
                    this.undoData.createdNodeIds.push(duplicate.id);
                }
            }
        }
        
        // Select the created nodes for optimistic updates
        if (optimisticEnabled && !isRemoteOrigin && createdNodes.length > 0 && context.canvas?.selection) {
            // Clear existing selection
            context.canvas.selection.clear();
            // Select all created nodes
            createdNodes.forEach(node => {
                context.canvas.selection.selectNode(node, true);
            });
        }
        
        // Force immediate canvas redraw to show loading states
        if (context.graph?.canvas && createdNodes.length > 0) {
            context.graph.canvas.dirty_canvas = true;
            requestAnimationFrame(() => context.graph.canvas.draw());
        }
        
        this.executed = true;
        return { success: true, nodes: createdNodes };
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        
        // Remove created nodes
        for (const nodeId of this.undoData.createdNodeIds) {
            const node = graph.getNodeById(nodeId);
            if (node) {
                graph.remove(node);
            }
        }
        
        return { success: true };
    }
    
    serializeNode(node) {
        return {
            type: node.type,
            pos: [...node.pos],
            size: [...node.size],
            title: node.title,
            properties: { ...node.properties },
            flags: { ...node.flags },
            aspectRatio: node.aspectRatio,
            rotation: node.rotation
        };
    }
    
    createNodeFromData(nodeData, context) {
        const node = NodeFactory.createNode(nodeData.type);
        if (!node) return null;
        
        // Apply all properties
        node.pos = [...nodeData.pos];
        node.size = [...nodeData.size];
        node.properties = { ...nodeData.properties };
        node.rotation = nodeData.rotation || 0;
        // Merge flags preserving constructor defaults (like hide_title: true)
        if (nodeData.flags) {
            node.flags = { ...node.flags, ...nodeData.flags };
        }
        node.title = nodeData.title;
        node.aspectRatio = nodeData.aspectRatio;
        
        // Restore color correction properties
        const colorCorrectionProps = [
            'adjustments', 
            'toneCurve', 
            'toneCurveBypassed',
            'colorAdjustmentsBypassed',
            'colorBalance',
            'colorBalanceBypassed'
        ];
        
        colorCorrectionProps.forEach(prop => {
            if (nodeData[prop] !== undefined) {
                node[prop] = nodeData[prop];
            }
        });
        
        // Set loading state immediately for image nodes
        if (node.type === 'media/image') {
            node.loadingState = 'loading';
            node.loadingProgress = 0;
        }
        
        // Handle media nodes with deduplication
        if (node.type === 'media/image' && nodeData.properties.src) {
            
            // Check if we can use cached resource
            if (nodeData.properties.hash && window.app?.imageResourceCache) {
                const cachedResource = window.app.imageResourceCache.get(nodeData.properties.hash);
                
                if (cachedResource) {
                    // console.log(`♻️ Using cached image for duplicate: ${nodeData.properties.hash.substring(0, 8)}...`, cachedResource);
                    
                    // Use cached data - don't await so loading state is visible
                    node.setImage(
                        cachedResource.url,
                        cachedResource.originalFilename || nodeData.properties.filename,
                        nodeData.properties.hash
                    );
                    
                    // Update node properties to use server URLs
                    node.properties.serverUrl = cachedResource.url;
                    node.properties.serverFilename = cachedResource.serverFilename;
                    
                    // Increment reference count
                    window.app.imageResourceCache.addReference(nodeData.properties.hash);
                    
                    // Track bytes saved
                    const estimatedSize = 500 * 1024; // 500KB average
                    window.app.imageResourceCache.trackBytesSaved(estimatedSize);
                } else {
                    // console.log(`❌ Cache miss for hash: ${nodeData.properties.hash?.substring(0, 8)}...`);
                    
                    // Check if we have a server URL already (from synced node)
                    if (nodeData.properties.serverUrl) {
                        // 
                        node.setImage(
                            nodeData.properties.serverUrl,
                            nodeData.properties.filename,
                            nodeData.properties.hash
                        );
                        // Also add to cache for future use
                        if (window.app?.imageResourceCache && nodeData.properties.hash) {
                            window.app.imageResourceCache.set(nodeData.properties.hash, {
                                url: nodeData.properties.serverUrl,
                                serverFilename: nodeData.properties.serverFilename,
                                originalFilename: nodeData.properties.filename
                            });
                            // 
                        }
                    } else {
                        // Not cached and no server URL - check if original node has data URL we can reuse
                        // console.log('📤 No server URL - using original image data (may trigger upload)');
                        node.setImage(
                            nodeData.properties.src,
                            nodeData.properties.filename,
                            nodeData.properties.hash
                        );
                        
                        // Add to cache immediately with local data so subsequent duplicates can reuse
                        if (window.app?.imageResourceCache && nodeData.properties.hash && nodeData.properties.src) {
                            window.app.imageResourceCache.set(nodeData.properties.hash, {
                                url: nodeData.properties.src, // Use the data URL temporarily
                                serverFilename: null,
                                originalFilename: nodeData.properties.filename,
                                isLocal: true // Mark as local so we know it needs server upgrade later
                            });
                            // 
                        }
                    }
                }
            } else {
                // No cache available, use original data
                // 
                node.setImage(
                    nodeData.properties.src,
                    nodeData.properties.filename,
                    nodeData.properties.hash
                );
            }
        } else if (node.type === 'media/video' && nodeData.properties.src) {
            node.setVideo(
                nodeData.properties.src,
                nodeData.properties.filename,
                nodeData.properties.hash
            );
        }
        
        return node;
    }
}

class PasteNodesCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_paste', params, origin);
    }
    
    validate() {
        const { nodeData, targetPosition } = this.params;
        
        if (!nodeData || !Array.isArray(nodeData) || nodeData.length === 0) {
            return { valid: false, error: 'Missing or invalid node data' };
        }
        
        if (!targetPosition || !Array.isArray(targetPosition) || targetPosition.length !== 2) {
            return { valid: false, error: 'Invalid target position' };
        }
        
        return { valid: true };
    }
    
    async prepareUndoData(context) {
        // For paste, we need to store the IDs of nodes that will be created
        // Since we don't know the IDs yet, we'll store placeholder data
        this.undoData = {
            createdNodeIds: [] // Will be populated during execute
        };
    }
    
    async execute(context) {
        const { graph } = context;
        
        // Check if optimistic updates are disabled - if so, skip local graph modification
        const optimisticEnabled = window.app?.operationPipeline?.stateSyncManager?.optimisticEnabled === true;
        const isRemoteOrigin = this.origin === 'remote' || this.origin === 'server';
        
        // Initialize undoData if not already done by prepareUndoData
        if (!this.undoData) {
            this.undoData = { createdNodeIds: [] };
        }
        const createdNodes = [];
        const { nodeData, targetPosition } = this.params;
        
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
            const node = this.createNodeFromData(data, context);
            if (node) {
                // Position relative to target position
                const offsetFromCenter = [
                    data.pos[0] - clipboardCenter[0],
                    data.pos[1] - clipboardCenter[1]
                ];
                
                node.pos[0] = targetPosition[0] + offsetFromCenter[0];
                node.pos[1] = targetPosition[1] + offsetFromCenter[1];
                
                // Generate new ID
                node.id = Date.now() + Math.floor(Math.random() * 1000);
                
                // Mark as temporary for optimistic updates
                if (optimisticEnabled && !isRemoteOrigin) {
                    node._isTemporary = true;
                    node._temporaryCreatedAt = Date.now();
                }
                
                // Only add to graph if optimistic updates are enabled OR this is a server/remote operation
                if (optimisticEnabled || isRemoteOrigin) {
                    graph.add(node);
                }
                createdNodes.push(node);
                this.undoData.createdNodeIds.push(node.id);
            }
        }
        
        // Select the created nodes for optimistic updates
        if (optimisticEnabled && !isRemoteOrigin && createdNodes.length > 0 && context.canvas?.selection) {
            // Clear existing selection
            context.canvas.selection.clear();
            // Select all created nodes
            createdNodes.forEach(node => {
                context.canvas.selection.selectNode(node, true);
            });
        }
        
        // Force immediate canvas redraw to show loading states
        if (context.graph?.canvas && createdNodes.length > 0) {
            context.graph.canvas.dirty_canvas = true;
            requestAnimationFrame(() => context.graph.canvas.draw());
        }
        
        this.executed = true;
        return { success: true, nodes: createdNodes };
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        
        // Remove created nodes
        for (const nodeId of this.undoData.createdNodeIds) {
            const node = graph.getNodeById(nodeId);
            if (node) {
                graph.remove(node);
            }
        }
        
        return { success: true };
    }
    
    createNodeFromData(nodeData, context) {
        const node = NodeFactory.createNode(nodeData.type);
        if (!node) return null;
        
        // Apply all properties
        node.pos = [...nodeData.pos];
        node.size = [...nodeData.size];
        node.properties = { ...nodeData.properties };
        node.rotation = nodeData.rotation || 0;
        // Merge flags preserving constructor defaults (like hide_title: true)
        if (nodeData.flags) {
            node.flags = { ...node.flags, ...nodeData.flags };
        }
        node.title = nodeData.title;
        node.aspectRatio = nodeData.aspectRatio;
        
        // Restore color correction properties
        const colorCorrectionProps = [
            'adjustments', 
            'toneCurve', 
            'toneCurveBypassed',
            'colorAdjustmentsBypassed',
            'colorBalance',
            'colorBalanceBypassed'
        ];
        
        colorCorrectionProps.forEach(prop => {
            if (nodeData[prop] !== undefined) {
                node[prop] = nodeData[prop];
            }
        });
        
        // Set loading state immediately for image nodes
        if (node.type === 'media/image') {
            node.loadingState = 'loading';
            node.loadingProgress = 0;
        }
        
        // Handle media nodes with deduplication
        if (node.type === 'media/image' && nodeData.properties.src) {
            
            // Check if we can use cached resource
            if (nodeData.properties.hash && window.app?.imageResourceCache) {
                const cachedResource = window.app.imageResourceCache.get(nodeData.properties.hash);
                
                if (cachedResource) {
                    // console.log(`♻️ Using cached image for duplicate: ${nodeData.properties.hash.substring(0, 8)}...`, cachedResource);
                    
                    // Use cached data - don't await so loading state is visible
                    node.setImage(
                        cachedResource.url,
                        cachedResource.originalFilename || nodeData.properties.filename,
                        nodeData.properties.hash
                    );
                    
                    // Update node properties to use server URLs
                    node.properties.serverUrl = cachedResource.url;
                    node.properties.serverFilename = cachedResource.serverFilename;
                    
                    // Increment reference count
                    window.app.imageResourceCache.addReference(nodeData.properties.hash);
                    
                    // Track bytes saved
                    const estimatedSize = 500 * 1024; // 500KB average
                    window.app.imageResourceCache.trackBytesSaved(estimatedSize);
                } else {
                    // console.log(`❌ Cache miss for hash: ${nodeData.properties.hash?.substring(0, 8)}...`);
                    
                    // Check if we have a server URL already (from synced node)
                    if (nodeData.properties.serverUrl) {
                        // 
                        node.setImage(
                            nodeData.properties.serverUrl,
                            nodeData.properties.filename,
                            nodeData.properties.hash
                        );
                        // Also add to cache for future use
                        if (window.app?.imageResourceCache && nodeData.properties.hash) {
                            window.app.imageResourceCache.set(nodeData.properties.hash, {
                                url: nodeData.properties.serverUrl,
                                serverFilename: nodeData.properties.serverFilename,
                                originalFilename: nodeData.properties.filename
                            });
                            // 
                        }
                    } else {
                        // Not cached and no server URL - check if original node has data URL we can reuse
                        // console.log('📤 No server URL - using original image data (may trigger upload)');
                        node.setImage(
                            nodeData.properties.src,
                            nodeData.properties.filename,
                            nodeData.properties.hash
                        );
                        
                        // Add to cache immediately with local data so subsequent duplicates can reuse
                        if (window.app?.imageResourceCache && nodeData.properties.hash && nodeData.properties.src) {
                            window.app.imageResourceCache.set(nodeData.properties.hash, {
                                url: nodeData.properties.src, // Use the data URL temporarily
                                serverFilename: null,
                                originalFilename: nodeData.properties.filename,
                                isLocal: true // Mark as local so we know it needs server upgrade later
                            });
                            // 
                        }
                    }
                }
            } else {
                // No cache available, use original data
                // 
                node.setImage(
                    nodeData.properties.src,
                    nodeData.properties.filename,
                    nodeData.properties.hash
                );
            }
        } else if (node.type === 'media/video' && nodeData.properties.src) {
            node.setVideo(
                nodeData.properties.src,
                nodeData.properties.filename,
                nodeData.properties.hash
            );
        }
        
        return node;
    }
    
    // Connection health monitoring (same as DuplicateNodesCommand)
    checkConnectionHealth() {
        const socket = window.app?.networkLayer?.socket;
        const stateSyncManager = window.app?.operationPipeline?.stateSyncManager;
        
        return {
            connected: socket?.connected || false,
            socketReady: socket?.readyState === 1, // WebSocket.OPEN
            hasSocket: !!socket,
            pendingOperations: stateSyncManager?.pendingOperations?.size || 0,
            lastPingTime: socket?.lastPing || 0,
            reconnecting: socket?.reconnecting || false,
            bufferedAmount: socket?.bufferedAmount || 0
        };
    }
    
    // Memory usage monitoring (same as DuplicateNodesCommand)
    getMemoryUsage() {
        if (performance.memory) {
            return {
                used: `${Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)}MB`,
                total: `${Math.round(performance.memory.totalJSHeapSize / 1024 / 1024)}MB`,
                limit: `${Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)}MB`,
                usagePercent: `${Math.round((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100)}%`
            };
        }
        return { available: false };
    }
}

// Register extended commands
if (typeof window !== 'undefined') {
    try {
        // Check if all classes are defined
        const classes = {
            ResizeNodeCommand: typeof ResizeNodeCommand !== 'undefined' ? ResizeNodeCommand : null,
            ResetNodeCommand: typeof ResetNodeCommand !== 'undefined' ? ResetNodeCommand : null,
            RotateNodeCommand: typeof RotateNodeCommand !== 'undefined' ? RotateNodeCommand : null,
            VideoToggleCommand: typeof VideoToggleCommand !== 'undefined' ? VideoToggleCommand : null,
            BatchPropertyUpdateCommand: typeof BatchPropertyUpdateCommand !== 'undefined' ? BatchPropertyUpdateCommand : null,
            DuplicateNodesCommand: typeof DuplicateNodesCommand !== 'undefined' ? DuplicateNodesCommand : null,
            PasteNodesCommand: typeof PasteNodesCommand !== 'undefined' ? PasteNodesCommand : null
        };
        
        // Log which classes are available
        
        window.NodeCommandsExtended = classes;
    } catch (error) {
        console.error('❌ Failed to register NodeCommandsExtended:', error);
        console.error('Stack:', error.stack);
    }
}