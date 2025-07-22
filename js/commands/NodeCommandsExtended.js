/**
 * Extended node commands for all operations
 */

class ResizeNodeCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_resize', params, origin);
    }
    
    validate() {
        const { nodeIds, sizes, positions } = this.params;
        
        if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
            return { valid: false, error: 'Missing or invalid nodeIds' };
        }
        
        if (!sizes || !Array.isArray(sizes) || sizes.length !== nodeIds.length) {
            return { valid: false, error: 'Invalid sizes array' };
        }
        
        if (positions && (!Array.isArray(positions) || positions.length !== nodeIds.length)) {
            return { valid: false, error: 'Invalid positions array' };
        }
        
        return { valid: true };
    }
    
    async execute(context) {
        const { graph } = context;
        
        console.log('🎯 ResizeNodeCommand.execute:', {
            origin: this.origin,
            nodeIds: this.params.nodeIds,
            sizes: this.params.sizes
        });
        
        this.undoData = { nodes: [] };
        
        this.params.nodeIds.forEach((nodeId, index) => {
            const node = graph.getNodeById(nodeId);
            if (!node) return;
            
            const newSize = [...this.params.sizes[index]];
            
            this.undoData.nodes.push({
                id: node.id,
                oldSize: [...node.size],
                oldPos: [...node.pos]
            });
            
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
                const oldCenterX = this.undoData.nodes[this.undoData.nodes.length - 1].oldPos[0] + 
                                   this.undoData.nodes[this.undoData.nodes.length - 1].oldSize[0] / 2;
                const oldCenterY = this.undoData.nodes[this.undoData.nodes.length - 1].oldPos[1] + 
                                   this.undoData.nodes[this.undoData.nodes.length - 1].oldSize[1] / 2;
                
                node.pos[0] = oldCenterX - newSize[0] / 2;
                node.pos[1] = oldCenterY - newSize[1] / 2;
            }
            
            // Update aspect ratio to match the new size
            // This preserves non-uniform scaling from remote clients
            node.aspectRatio = node.size[0] / node.size[1];
            
            // Don't call onResize() for collaborative operations to preserve exact sizing
            // onResize() can interfere with non-uniform scaling by enforcing aspect ratios
        });
        
        this.executed = true;
        console.log('✅ ResizeNodeCommand.executed = true, undoData created');
        return { success: true };
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        
        this.undoData.nodes.forEach(({ id, oldSize, oldPos }) => {
            const node = graph.getNodeById(id);
            if (node) {
                node.size[0] = oldSize[0];
                node.size[1] = oldSize[1];
                
                if (oldPos) {
                    node.pos[0] = oldPos[0];
                    node.pos[1] = oldPos[1];
                }
                
                if (node.onResize) {
                    node.onResize();
                }
            }
        });
        
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
    
    async execute(context) {
        const { graph, canvas } = context;
        
        console.log(`🚀 ResetNodeCommand: Resetting ${this.params.nodeIds.length} nodes`);
        const startTime = performance.now();
        
        this.undoData = { nodes: [] };
        
        // First pass: Apply all changes locally immediately for instant feedback
        this.params.nodeIds.forEach((nodeId, index) => {
            const node = graph.getNodeById(nodeId);
            if (!node) return;
            
            const undoInfo = {
                id: node.id,
                operations: []
            };
            
            // Handle new boolean format
            if (this.params.resetRotation) {
                undoInfo.operations.push({
                    type: 'rotation',
                    oldValue: node.rotation || 0
                });
                node.rotation = this.params.values ? this.params.values[index] : 0;
            }
            
            if (this.params.resetAspectRatio) {
                if (node.originalAspect) {
                    undoInfo.operations.push({
                        type: 'aspectRatio',
                        oldSize: [...node.size]
                    });
                    const value = this.params.values ? this.params.values[index] : node.originalAspect;
                    node.size[1] = node.size[0] / value;
                    if (node.onResize) node.onResize();
                }
            }
            
            // Handle old resetType format for backwards compatibility
            if (this.params.resetType) {
                switch (this.params.resetType) {
                    case 'rotation':
                        undoInfo.operations.push({
                            type: 'rotation',
                            oldValue: node.rotation || 0
                        });
                        node.rotation = this.params.values ? this.params.values[index] : 0;
                        break;
                        
                    case 'scale':
                        if (node.properties.scale !== undefined) {
                            undoInfo.operations.push({
                                type: 'scale',
                                oldValue: node.properties.scale
                            });
                            node.properties.scale = this.params.values ? this.params.values[index] : 1;
                        }
                        break;
                        
                    case 'aspectRatio':
                        if (node.originalAspect) {
                            undoInfo.operations.push({
                                type: 'aspectRatio',
                                oldSize: [...node.size]
                            });
                            node.size[1] = node.size[0] / node.originalAspect;
                            if (node.onResize) node.onResize();
                        }
                        break;
                }
            }
            
            this.undoData.nodes.push(undoInfo);
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
        console.log(`✅ Reset completed in ${elapsed.toFixed(1)}ms for ${this.params.nodeIds.length} nodes`);
        
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
    
    async execute(context) {
        const { graph } = context;
        
        // Single node rotation
        if (this.params.nodeId) {
            const node = graph.getNodeById(this.params.nodeId);
            
            if (!node) {
                throw new Error('Node not found');
            }
            
            this.undoData = {
                nodeId: node.id,
                oldRotation: node.rotation || 0
            };
            
            node.rotation = this.params.angle;
            
            this.executed = true;
            return { node };
        }
        
        // Multi-node rotation
        if (this.params.nodeIds) {
            this.undoData = { nodes: [] };
            
            this.params.nodeIds.forEach((nodeId, index) => {
                const node = graph.getNodeById(nodeId);
                if (!node) return;
                
                this.undoData.nodes.push({
                    id: node.id,
                    oldRotation: node.rotation || 0,
                    oldPos: [...node.pos]
                });
                
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
        
        // Single node undo
        if (this.undoData.nodeId) {
            const node = graph.getNodeById(this.undoData.nodeId);
            if (node) {
                node.rotation = this.undoData.oldRotation;
            }
            return { success: true };
        }
        
        // Multi-node undo
        if (this.undoData.nodes) {
            this.undoData.nodes.forEach(({ id, oldRotation, oldPos }) => {
                const node = graph.getNodeById(id);
                if (node) {
                    node.rotation = oldRotation;
                    if (oldPos) {
                        node.pos[0] = oldPos[0];
                        node.pos[1] = oldPos[1];
                    }
                }
            });
            return { success: true };
        }
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
                    console.warn('Video autoplay prevented');
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
    
    async execute(context) {
        const { graph } = context;
        
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
        const { nodeIds, offset } = this.params;
        
        if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
            return { valid: false, error: 'Missing or invalid nodeIds' };
        }
        
        return { valid: true };
    }
    
    async execute(context) {
        const { graph } = context;
        
        console.log(`📋 DuplicateNodesCommand: Duplicating ${this.params.nodeIds.length} nodes`);
        
        this.undoData = { createdNodes: [] };
        const createdNodes = [];
        const offset = this.params.offset || [20, 20];
        
        for (const nodeId of this.params.nodeIds) {
            const originalNode = graph.getNodeById(nodeId);
            if (!originalNode) continue;
            
            // Serialize and deserialize to create a copy
            const nodeData = this.serializeNode(originalNode);
            const duplicate = await this.createNodeFromData(nodeData, context);
            if (duplicate) {
                // Apply offset
                duplicate.pos[0] += offset[0];
                duplicate.pos[1] += offset[1];
                
                // Generate new ID
                duplicate.id = Date.now() + Math.floor(Math.random() * 1000);
                
                graph.add(duplicate);
                createdNodes.push(duplicate);
                this.undoData.createdNodes.push(duplicate.id);
            }
        }
        
        // Log cache statistics if available
        if (window.app?.imageResourceCache) {
            const stats = window.app.imageResourceCache.getStats();
            console.log(`📊 Image cache stats: ${stats.hitRate} hit rate, ${stats.estimatedBytesSaved} saved`);
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
        for (const nodeId of this.undoData.createdNodes) {
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
    
    async createNodeFromData(nodeData, context) {
        const node = NodeFactory.createNode(nodeData.type);
        if (!node) return null;
        
        // Apply all properties
        node.pos = [...nodeData.pos];
        node.size = [...nodeData.size];
        node.properties = { ...nodeData.properties };
        node.rotation = nodeData.rotation || 0;
        node.flags = { ...nodeData.flags };
        node.title = nodeData.title;
        node.aspectRatio = nodeData.aspectRatio;
        
        // Handle media nodes with deduplication
        if (node.type === 'media/image' && nodeData.properties.src) {
            // Check if we can use cached resource
            if (nodeData.properties.hash && window.app?.imageResourceCache) {
                const cachedResource = window.app.imageResourceCache.get(nodeData.properties.hash);
                
                if (cachedResource) {
                    console.log(`♻️ Using cached image for duplicate: ${nodeData.properties.hash.substring(0, 8)}...`);
                    
                    // Use cached data
                    await node.setImage(
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
                    // Not cached, use original data
                    await node.setImage(
                        nodeData.properties.src,
                        nodeData.properties.filename,
                        nodeData.properties.hash
                    );
                }
            } else {
                // No cache available, use original data
                await node.setImage(
                    nodeData.properties.src,
                    nodeData.properties.filename,
                    nodeData.properties.hash
                );
            }
        } else if (node.type === 'media/video' && nodeData.properties.src) {
            await node.setVideo(
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
    
    async execute(context) {
        const { graph } = context;
        
        this.undoData = { createdNodes: [] };
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
            const node = await this.createNodeFromData(data, context);
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
                
                graph.add(node);
                createdNodes.push(node);
                this.undoData.createdNodes.push(node.id);
            }
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
        for (const nodeId of this.undoData.createdNodes) {
            const node = graph.getNodeById(nodeId);
            if (node) {
                graph.remove(node);
            }
        }
        
        return { success: true };
    }
    
    async createNodeFromData(nodeData, context) {
        const node = NodeFactory.createNode(nodeData.type);
        if (!node) return null;
        
        // Apply all properties
        node.pos = [...nodeData.pos];
        node.size = [...nodeData.size];
        node.properties = { ...nodeData.properties };
        node.rotation = nodeData.rotation || 0;
        node.flags = { ...nodeData.flags };
        node.title = nodeData.title;
        node.aspectRatio = nodeData.aspectRatio;
        
        // Handle media nodes with deduplication
        if (node.type === 'media/image' && nodeData.properties.src) {
            // Check if we can use cached resource
            if (nodeData.properties.hash && window.app?.imageResourceCache) {
                const cachedResource = window.app.imageResourceCache.get(nodeData.properties.hash);
                
                if (cachedResource) {
                    console.log(`♻️ Using cached image for duplicate: ${nodeData.properties.hash.substring(0, 8)}...`);
                    
                    // Use cached data
                    await node.setImage(
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
                    // Not cached, use original data
                    await node.setImage(
                        nodeData.properties.src,
                        nodeData.properties.filename,
                        nodeData.properties.hash
                    );
                }
            } else {
                // No cache available, use original data
                await node.setImage(
                    nodeData.properties.src,
                    nodeData.properties.filename,
                    nodeData.properties.hash
                );
            }
        } else if (node.type === 'media/video' && nodeData.properties.src) {
            await node.setVideo(
                nodeData.properties.src,
                nodeData.properties.filename,
                nodeData.properties.hash
            );
        }
        
        return node;
    }
}

// Register extended commands
if (typeof window !== 'undefined') {
    window.NodeCommandsExtended = {
        ResizeNodeCommand,
        ResetNodeCommand,
        RotateNodeCommand,
        VideoToggleCommand,
        BatchPropertyUpdateCommand,
        DuplicateNodesCommand,
        PasteNodesCommand
    };
}