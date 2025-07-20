/**
 * Node-related commands
 */

class MoveNodeCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_move', params, origin);
    }
    
    validate() {
        const { nodeId, nodeIds, position, positions } = this.params;
        
        // Single node move
        if (nodeId) {
            if (!position || !Array.isArray(position) || position.length !== 2) {
                return { valid: false, error: 'Invalid position for single node' };
            }
            return { valid: true };
        }
        
        // Multi-node move
        if (nodeIds && Array.isArray(nodeIds)) {
            if (!positions || !Array.isArray(positions) || positions.length !== nodeIds.length) {
                return { valid: false, error: 'Invalid positions for multi-node move' };
            }
            return { valid: true };
        }
        
        return { valid: false, error: 'Missing nodeId or nodeIds' };
    }
    
    async execute(context) {
        const { graph } = context;
        const movedNodes = [];
        
        // Store undo data
        this.undoData = { nodes: [] };
        
        // Single node move
        if (this.params.nodeId) {
            const node = graph.getNodeById(this.params.nodeId);
            if (!node) throw new Error('Node not found');
            
            this.undoData.nodes.push({
                id: node.id,
                oldPosition: [...node.pos]
            });
            
            node.pos[0] = this.params.position[0];
            node.pos[1] = this.params.position[1];
            
            // Preserve media properties if provided (for collaborative sync)
            if (this.params.properties && (node.type === 'media/image' || node.type === 'media/video')) {
                Object.assign(node.properties, this.params.properties);
                
                // Reload media if lost
                if (node.type === 'media/image' && !node.img && node.properties.src) {
                    node.setImage(node.properties.src, node.properties.filename, node.properties.hash);
                } else if (node.type === 'media/video' && !node.video && node.properties.src) {
                    node.setVideo(node.properties.src, node.properties.filename, node.properties.hash);
                }
            }
            
            movedNodes.push(node);
        }
        
        // Multi-node move
        else if (this.params.nodeIds) {
            this.params.nodeIds.forEach((nodeId, index) => {
                const node = graph.getNodeById(nodeId);
                if (!node) return;
                
                this.undoData.nodes.push({
                    id: node.id,
                    oldPosition: [...node.pos]
                });
                
                node.pos[0] = this.params.positions[index][0];
                node.pos[1] = this.params.positions[index][1];
                
                // Preserve media properties if provided
                if (this.params.nodeProperties && this.params.nodeProperties[nodeId]) {
                    const props = this.params.nodeProperties[nodeId];
                    Object.assign(node.properties, props);
                    
                    // Reload media if lost
                    if (node.type === 'media/image' && !node.img && node.properties.src) {
                        node.setImage(node.properties.src, node.properties.filename, node.properties.hash);
                    } else if (node.type === 'media/video' && !node.video && node.properties.src) {
                        node.setVideo(node.properties.src, node.properties.filename, node.properties.hash);
                    }
                }
                
                movedNodes.push(node);
            });
        }
        
        this.executed = true;
        return { nodes: movedNodes };
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        
        this.undoData.nodes.forEach(({ id, oldPosition }) => {
            const node = graph.getNodeById(id);
            if (node) {
                node.pos[0] = oldPosition[0];
                node.pos[1] = oldPosition[1];
            }
        });
        
        return { success: true };
    }
    
    canMergeWith(other) {
        // Can merge consecutive move commands for the same node(s)
        if (other.type !== 'node_move') return false;
        if (this.origin !== other.origin) return false;
        
        // Check if it's the same node(s)
        if (this.params.nodeId && other.params.nodeId) {
            return this.params.nodeId === other.params.nodeId;
        }
        if (this.params.nodeIds && other.params.nodeIds) {
            return JSON.stringify(this.params.nodeIds) === JSON.stringify(other.params.nodeIds);
        }
        
        return false;
    }
    
    mergeWith(other) {
        // Keep the original command but update position to the latest
        const merged = new MoveNodeCommand(this.params, this.origin);
        merged.id = this.id;
        merged.timestamp = this.timestamp;
        
        if (other.params.position) {
            merged.params.position = other.params.position;
        }
        if (other.params.positions) {
            merged.params.positions = other.params.positions;
        }
        
        return merged;
    }
}

class CreateNodeCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_create', params, origin);
    }
    
    validate() {
        const { type, pos, properties } = this.params;
        
        if (!type) {
            return { valid: false, error: 'Missing node type' };
        }
        
        if (!pos || !Array.isArray(pos) || pos.length !== 2) {
            return { valid: false, error: 'Invalid position' };
        }
        
        return { valid: true };
    }
    
    async execute(context) {
        const { graph } = context;
        
        // Create node using factory
        const node = NodeFactory.createNode(this.params.type);
        if (!node) {
            throw new Error(`Unknown node type: ${this.params.type}`);
        }
        
        // Set properties
        node.pos = [...this.params.pos];
        if (this.params.size) {
            node.size = [...this.params.size];
        }
        
        // Preserve or generate ID
        if (this.params.id) {
            node.id = this.params.id;
        }
        
        // Apply additional properties
        if (this.params.properties) {
            Object.assign(node.properties, this.params.properties);
        }
        
        // Handle media nodes
        if (node.type === 'media/image' && this.params.imageData) {
            await node.setImage(
                this.params.imageData.src,
                this.params.imageData.filename,
                this.params.imageData.hash
            );
        } else if (node.type === 'media/video' && this.params.videoData) {
            await node.setVideo(
                this.params.videoData.src,
                this.params.videoData.filename,
                this.params.videoData.hash
            );
        }
        
        // Add to graph
        graph.add(node);
        
        // Store for undo
        this.undoData = { nodeId: node.id };
        this.executed = true;
        
        return { node };
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData || !this.undoData.nodeId) {
            throw new Error('No undo data available');
        }
        
        const node = graph.getNodeById(this.undoData.nodeId);
        if (node) {
            graph.remove(node);
        }
        
        return { success: true };
    }
}

class DeleteNodeCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_delete', params, origin);
    }
    
    validate() {
        const { nodeIds } = this.params;
        
        if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
            return { valid: false, error: 'Missing or invalid nodeIds' };
        }
        
        return { valid: true };
    }
    
    async execute(context) {
        const { graph } = context;
        
        // Store nodes for undo
        this.undoData = { nodes: [] };
        
        this.params.nodeIds.forEach(nodeId => {
            const node = graph.getNodeById(nodeId);
            if (node) {
                // Store complete node data for restoration
                this.undoData.nodes.push({
                    id: node.id,
                    type: node.type,
                    pos: [...node.pos],
                    size: [...node.size],
                    properties: { ...node.properties },
                    rotation: node.rotation,
                    flags: { ...node.flags },
                    title: node.title
                });
                
                // Remove from graph
                graph.remove(node);
            }
        });
        
        this.executed = true;
        return { deletedCount: this.undoData.nodes.length };
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        
        // Restore nodes
        for (const nodeData of this.undoData.nodes) {
            const node = NodeFactory.createNode(nodeData.type);
            if (node) {
                // Restore all properties
                node.id = nodeData.id;
                node.pos = [...nodeData.pos];
                node.size = [...nodeData.size];
                node.properties = { ...nodeData.properties };
                node.rotation = nodeData.rotation || 0;
                node.flags = { ...nodeData.flags };
                node.title = nodeData.title;
                
                // Restore media if needed
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
                
                graph.add(node);
            }
        }
        
        return { success: true };
    }
}

class UpdateNodePropertyCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_property_update', params, origin);
    }
    
    validate() {
        const { nodeId, property, value } = this.params;
        
        if (!nodeId) {
            return { valid: false, error: 'Missing nodeId' };
        }
        
        if (!property) {
            return { valid: false, error: 'Missing property name' };
        }
        
        // value can be anything including null/undefined
        
        return { valid: true };
    }
    
    async execute(context) {
        const { graph } = context;
        const node = graph.getNodeById(this.params.nodeId);
        
        if (!node) {
            throw new Error('Node not found');
        }
        
        // Store old value for undo
        this.undoData = {
            nodeId: node.id,
            property: this.params.property,
            oldValue: node.properties[this.params.property]
        };
        
        // Update property
        node.properties[this.params.property] = this.params.value;
        
        // Handle special properties that need additional processing
        if (node.updateProperty) {
            node.updateProperty(this.params.property, this.params.value);
        }
        
        this.executed = true;
        return { node };
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        
        const node = graph.getNodeById(this.undoData.nodeId);
        if (node) {
            node.properties[this.undoData.property] = this.undoData.oldValue;
            
            if (node.updateProperty) {
                node.updateProperty(this.undoData.property, this.undoData.oldValue);
            }
        }
        
        return { success: true };
    }
}

// Register commands globally
if (typeof window !== 'undefined') {
    window.NodeCommands = {
        MoveNodeCommand,
        CreateNodeCommand,
        DeleteNodeCommand,
        UpdateNodePropertyCommand
    };
}