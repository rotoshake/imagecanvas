/**
 * Canvas-related commands
 */

class NodeLayerOrderCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_layer_order', params, origin);
    }

    validate() {
        const { nodeIds, direction } = this.params;
        if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
            return { valid: false, error: 'Missing or invalid nodeIds' };
        }
        if (!['up', 'down'].includes(direction)) {
            return { valid: false, error: 'Invalid direction' };
        }
        return { valid: true };
    }

    async prepareUndoData(context) {
        const { graph } = context;
        // Store original z-index values for all affected nodes
        this.undoData = { 
            originalZIndices: {}
        };
        
        // Store z-indices for selected nodes and their children
        for (const nodeId of this.params.nodeIds) {
            const node = graph.getNodeById(nodeId);
            if (node) {
                this.undoData.originalZIndices[nodeId] = node.zIndex ?? 0;
                
                // If it's a group, store z-indices of all children too
                if (node.type === 'container/group' && node.childNodes) {
                    for (const childId of node.childNodes) {
                        const child = graph.getNodeById(childId);
                        if (child) {
                            this.undoData.originalZIndices[childId] = child.zIndex ?? 0;
                        }
                    }
                }
            }
        }
    }

    async execute(context) {
        const { graph, canvas } = context;
        const { nodeIds, direction } = this.params;
        
        // Track z-index updates for server sync
        const zIndexUpdates = {};
        
        // Process each selected node
        for (const nodeId of nodeIds) {
            const node = graph.getNodeById(nodeId);
            if (!node) continue;
            
            // Find overlapping nodes
            const overlapping = this.getOverlappingNodes(node, graph.nodes);
            if (overlapping.length === 0) continue;
            
            // Sort overlapping nodes by z-index
            overlapping.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
            
            const currentZ = node.zIndex ?? 0;
            const nodeIndex = overlapping.findIndex(n => n.id === node.id);
            
            if (direction === 'up') {
                // Find the next node above this one
                const nodesAbove = overlapping.slice(nodeIndex + 1);
                if (nodesAbove.length > 0) {
                    // Move above the first node that's currently above us
                    const targetNode = nodesAbove[0];
                    const targetZ = targetNode.zIndex ?? 0;
                    
                    // Set our z-index slightly above the target
                    node.zIndex = targetZ + 0.1;
                    
                    // Normalize z-indices to integers
                    this.normalizeZIndices(graph.nodes);
                    zIndexUpdates[nodeId] = node.zIndex;
                }
            } else { // down
                // Find the previous node below this one
                const nodesBelow = overlapping.slice(0, nodeIndex);
                if (nodesBelow.length > 0) {
                    // Move below the last node that's currently below us
                    const targetNode = nodesBelow[nodesBelow.length - 1];
                    const targetZ = targetNode.zIndex ?? 0;
                    
                    // Set our z-index slightly below the target
                    node.zIndex = targetZ - 0.1;
                    
                    // Normalize z-indices to integers
                    this.normalizeZIndices(graph.nodes);
                    zIndexUpdates[nodeId] = node.zIndex;
                }
            }
        }
        
        // Include z-index updates in params for server sync
        this.params.zIndexUpdates = zIndexUpdates;
        
        return { success: true };
    }
    
    getOverlappingNodes(targetNode, allNodes) {
        const [tx, ty, tw, th] = targetNode.getBoundingBox();
        const overlapping = [];
        
        for (const node of allNodes) {
            const [nx, ny, nw, nh] = node.getBoundingBox();
            
            // Check if bounding boxes overlap
            if (tx < nx + nw && tx + tw > nx && ty < ny + nh && ty + th > ny) {
                overlapping.push(node);
            }
        }
        
        return overlapping;
    }
    
    normalizeZIndices(nodes) {
        // Sort all nodes by current z-index
        const sorted = [...nodes].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
        
        // Reassign z-indices as integers starting from 0
        sorted.forEach((node, index) => {
            node.zIndex = index;
        });
        
        // Add all normalized z-indices to params for server sync
        if (!this.params.zIndexUpdates) {
            this.params.zIndexUpdates = {};
        }
        sorted.forEach(node => {
            this.params.zIndexUpdates[node.id] = node.zIndex;
        });
    }

    async undo(context) {
        const { graph } = context;
        const { originalZIndices } = this.undoData;
        
        // Restore original z-indices
        for (const [nodeId, zIndex] of Object.entries(originalZIndices)) {
            const node = graph.getNodeById(nodeId);
            if (node) {
                node.zIndex = zIndex;
            }
        }
        
        return { success: true };
    }
}

class NodeAlignCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_align', params, origin);
    }

    validate() {
        const { nodeIds, axis } = this.params;
        if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length < 2) {
            return { valid: false, error: 'Not enough nodes to align' };
        }
        if (!['horizontal', 'vertical', 'grid'].includes(axis)) {
            return { valid: false, error: 'Invalid axis' };
        }
        return { valid: true };
    }

    async prepareUndoData(context) {
        const { graph } = context;
        
        this.undoData = {
            previousPositions: {}
        };

        if (this.initialState) {
            // Use initialState from ClientUndoManager (preferred)
            this.params.nodeIds.forEach((nodeId, index) => {
                this.undoData.previousPositions[nodeId] = this.initialState.positions[index];
            });
        } else {
            // Fallback: read current positions
            this.params.nodeIds.forEach(nodeId => {
                const node = graph.getNodeById(nodeId);
                if (node) {
                    this.undoData.previousPositions[nodeId] = [...node.pos];
                }
            });
        }

    }

    async execute(context) {
        const { graph } = context;
        const { nodeIds, positions, axis } = this.params;

        // Check if grid alignment animation is active
        const alignmentManager = window.app?.graphCanvas?.alignmentManager;
        const isGridAlignAnimating = alignmentManager?.gridAlignAnimating === true;
        
        // If positions are provided (from alignment animation), use them directly
        if (positions && Array.isArray(positions)) {
            
            // During optimistic execution with active grid animation, skip position updates
            // The animation will handle the visual updates, and the server will sync the final positions
            if (this.origin === 'local' && isGridAlignAnimating && axis === 'grid') {
                
                // Still mark canvas dirty to ensure animation continues
                if (graph.canvas) {
                    graph.canvas.dirty_canvas = true;
                }
                return { success: true };
            }
            
            for (let i = 0; i < nodeIds.length; i++) {
                const node = graph.getNodeById(nodeIds[i]);
                if (node && positions[i]) {
                    // 
                    node.pos[0] = positions[i][0];
                    node.pos[1] = positions[i][1];
                    // Clear any animation state to prevent overwriting
                    delete node._animPos;
                    delete node._animVel;
                    delete node._gridAnimPos;
                    delete node._gridAnimVel;
                }
            }
            // Mark canvas as dirty to ensure redraw
            if (graph.canvas) {
                graph.canvas.dirty_canvas = true;
            }
            return { success: true };
        }
        
        // Fallback: calculate alignment if positions not provided (legacy support)
        const nodes = nodeIds.map(id => graph.getNodeById(id)).filter(n => n);

        // Check for active auto-align animation as well
        const isAutoAlignAnimating = alignmentManager?.autoAlignAnimating === true;
        
        if (axis === 'horizontal') {
            // Skip during active animation for consistency
            if (this.origin === 'local' && isAutoAlignAnimating) {
                
                return { success: true };
            }
            const avgY = nodes.reduce((sum, node) => sum + node.pos[1], 0) / nodes.length;
            nodes.forEach(node => node.pos[1] = avgY);
        } else if (axis === 'vertical') {
            // Skip during active animation for consistency
            if (this.origin === 'local' && isAutoAlignAnimating) {
                
                return { success: true };
            }
            const avgX = nodes.reduce((sum, node) => sum + node.pos[0], 0) / nodes.length;
            nodes.forEach(node => node.pos[0] = avgX);
        } else if (axis === 'grid') {
            // Grid alignment should always provide positions, this is just a fallback
            
        }
        return { success: true };
    }

    async undo(context) {
        const { graph } = context;
        const { previousPositions } = this.undoData;
        
        for (const [nodeId, pos] of Object.entries(previousPositions)) {
            const node = graph.getNodeById(nodeId);
            if (node) {
                
                node.pos = [...pos];
                // Clear any animation state
                delete node._animPos;
                delete node._animVel;
            }
        }
        // Mark canvas as dirty to ensure redraw
        if (graph.canvas) {
            graph.canvas.dirty_canvas = true;
        }
        return { success: true };
    }
}

// Register commands globally
if (typeof window !== 'undefined') {
    window.CanvasCommands = {
        NodeLayerOrderCommand,
        NodeAlignCommand
    };
} 