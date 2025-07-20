/**
 * Extended node commands for all operations
 */

class ResizeNodeCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_resize', params, origin);
    }
    
    validate() {
        const { nodeIds, sizes } = this.params;
        
        if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
            return { valid: false, error: 'Missing or invalid nodeIds' };
        }
        
        if (!sizes || !Array.isArray(sizes) || sizes.length !== nodeIds.length) {
            return { valid: false, error: 'Invalid sizes array' };
        }
        
        return { valid: true };
    }
    
    async execute(context) {
        const { graph } = context;
        
        this.undoData = { nodes: [] };
        
        this.params.nodeIds.forEach((nodeId, index) => {
            const node = graph.getNodeById(nodeId);
            if (!node) return;
            
            this.undoData.nodes.push({
                id: node.id,
                oldSize: [...node.size]
            });
            
            node.size[0] = this.params.sizes[index][0];
            node.size[1] = this.params.sizes[index][1];
            
            // Call node's resize handler if it exists
            if (node.onResize) {
                node.onResize();
            }
        });
        
        this.executed = true;
        return { success: true };
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        
        this.undoData.nodes.forEach(({ id, oldSize }) => {
            const node = graph.getNodeById(id);
            if (node) {
                node.size[0] = oldSize[0];
                node.size[1] = oldSize[1];
                
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
        const { nodeIds, resetType } = this.params;
        
        if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
            return { valid: false, error: 'Missing or invalid nodeIds' };
        }
        
        if (!resetType) {
            return { valid: false, error: 'Missing reset type' };
        }
        
        return { valid: true };
    }
    
    async execute(context) {
        const { graph } = context;
        
        this.undoData = { nodes: [] };
        
        this.params.nodeIds.forEach((nodeId, index) => {
            const node = graph.getNodeById(nodeId);
            if (!node) return;
            
            const undoInfo = {
                id: node.id,
                resetType: this.params.resetType
            };
            
            switch (this.params.resetType) {
                case 'rotation':
                    undoInfo.oldRotation = node.rotation || 0;
                    node.rotation = this.params.values ? this.params.values[index] : 0;
                    break;
                    
                case 'scale':
                    if (node.properties.scale !== undefined) {
                        undoInfo.oldScale = node.properties.scale;
                        node.properties.scale = this.params.values ? this.params.values[index] : 1;
                    }
                    break;
                    
                case 'aspectRatio':
                    if (node.resetAspectRatio) {
                        undoInfo.oldSize = [...node.size];
                        node.resetAspectRatio();
                    }
                    break;
            }
            
            this.undoData.nodes.push(undoInfo);
        });
        
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
                    }
                    break;
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
        const { nodeId, angle } = this.params;
        
        if (!nodeId) {
            return { valid: false, error: 'Missing nodeId' };
        }
        
        if (typeof angle !== 'number') {
            return { valid: false, error: 'Invalid angle' };
        }
        
        return { valid: true };
    }
    
    async execute(context) {
        const { graph } = context;
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
    
    async undo(context) {
        const { graph } = context;
        const node = graph.getNodeById(this.undoData.nodeId);
        
        if (node) {
            node.rotation = this.undoData.oldRotation;
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

// Register extended commands
if (typeof window !== 'undefined') {
    window.NodeCommandsExtended = {
        ResizeNodeCommand,
        ResetNodeCommand,
        RotateNodeCommand,
        VideoToggleCommand,
        BatchPropertyUpdateCommand
    };
}