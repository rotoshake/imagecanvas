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
        this.undoData = { originalOrder: [...graph.nodes].map(n => n.id) };
    }

    async execute(context) {
        const { graph } = context;
        const { nodeIds, direction } = this.params;
        
        // This is a simplified version. A real implementation would be more robust.
        if (direction === 'up') {
            nodeIds.forEach(nodeId => {
                const node = graph.getNodeById(nodeId);
                if (node) {
                    const index = graph.nodes.indexOf(node);
                    if (index < graph.nodes.length - 1) {
                        graph.nodes.splice(index, 1);
                        graph.nodes.splice(index + 1, 0, node);
                    }
                }
            });
        } else { // down
            nodeIds.forEach(nodeId => {
                const node = graph.getNodeById(nodeId);
                if (node) {
                    const index = graph.nodes.indexOf(node);
                    if (index > 0) {
                        graph.nodes.splice(index, 1);
                        graph.nodes.splice(index - 1, 0, node);
                    }
                }
            });
        }
        return { success: true };
    }

    async undo(context) {
        const { graph } = context;
        const { originalOrder } = this.undoData;
        graph.nodes.sort((a, b) => originalOrder.indexOf(a.id) - originalOrder.indexOf(b.id));
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
        const { nodeIds } = this.params;
        this.undoData = {
            originalPositions: nodeIds.map(nodeId => {
                const node = graph.getNodeById(nodeId);
                return { id: nodeId, pos: [...node.pos] };
            })
        };
        console.log('[NodeAlignCommand] Prepared undo data:', {
            nodeIds: this.params.nodeIds,
            originalPositions: this.undoData.originalPositions
        });
    }

    async execute(context) {
        const { graph } = context;
        const { nodeIds, positions, axis } = this.params;
        
        console.log('[NodeAlignCommand] Executing with params:', { nodeIds, positions, axis });
        
        // If positions are provided (from alignment animation), use them directly
        if (positions && Array.isArray(positions)) {
            console.log('[NodeAlignCommand] Using provided positions');
            for (let i = 0; i < nodeIds.length; i++) {
                const node = graph.getNodeById(nodeIds[i]);
                if (node && positions[i]) {
                    console.log(`[NodeAlignCommand] Moving node ${nodeIds[i]} to`, positions[i]);
                    node.pos[0] = positions[i][0];
                    node.pos[1] = positions[i][1];
                    // Clear any animation state to prevent overwriting
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
        
        // Fallback: calculate alignment if positions not provided (legacy support)
        const nodes = nodeIds.map(id => graph.getNodeById(id)).filter(n => n);

        if (axis === 'horizontal') {
            const avgY = nodes.reduce((sum, node) => sum + node.pos[1], 0) / nodes.length;
            nodes.forEach(node => node.pos[1] = avgY);
        } else if (axis === 'vertical') {
            const avgX = nodes.reduce((sum, node) => sum + node.pos[0], 0) / nodes.length;
            nodes.forEach(node => node.pos[0] = avgX);
        } else if (axis === 'grid') {
            // Grid alignment should always provide positions, this is just a fallback
            console.warn('[NodeAlignCommand] Grid alignment without positions - no changes made');
        }
        return { success: true };
    }

    async undo(context) {
        const { graph } = context;
        const { originalPositions } = this.undoData;
        console.log('[NodeAlignCommand] Undoing with data:', {
            originalPositions: originalPositions
        });
        originalPositions.forEach(({ id, pos }) => {
            const node = graph.getNodeById(id);
            if (node) {
                console.log(`[NodeAlignCommand] Restoring node ${id} to`, pos);
                node.pos = [...pos];
                // Clear any animation state
                delete node._animPos;
                delete node._animVel;
            }
        });
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