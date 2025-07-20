/**
 * CanvasIntegration - Integrates canvas mouse operations with the new pipeline
 * This ensures drag operations go through the proper command system
 */

class CanvasIntegration {
    constructor(app) {
        this.app = app;
        this.canvas = app.graphCanvas;
        this.pipeline = app.operationPipeline;
        
        // Track ongoing drag operation
        this.dragState = {
            active: false,
            lastPositions: new Map(), // nodeId -> [x, y]
            dragCommands: [], // Track commands for this drag
            startTime: 0
        };
        
        console.log('🔌 CanvasIntegration initialized');
    }
    
    /**
     * Initialize the integration
     */
    initialize() {
        if (!this.canvas || !this.pipeline) {
            console.error('Canvas or pipeline not available');
            return;
        }
        
        // Override the updateNodeDrag method
        this.overrideUpdateNodeDrag();
        
        // Override the finish interaction methods
        this.overrideFinishInteraction();
        
        console.log('✅ Canvas integration active');
    }
    
    /**
     * Override updateNodeDrag to use the pipeline
     */
    overrideUpdateNodeDrag() {
        const originalUpdate = this.canvas.updateNodeDrag.bind(this.canvas);
        
        this.canvas.updateNodeDrag = () => {
            // If no pipeline, fall back to original
            if (!this.pipeline) {
                return originalUpdate();
            }
            
            // Start drag tracking if not active
            if (!this.dragState.active) {
                this.dragState.active = true;
                this.dragState.startTime = Date.now();
                this.dragState.lastPositions.clear();
                this.dragState.dragCommands = [];
                
                // Store initial positions
                for (const [nodeId, offset] of this.canvas.interactionState.dragging.offsets) {
                    const node = this.canvas.graph.getNodeById(nodeId);
                    if (node) {
                        this.dragState.lastPositions.set(nodeId, [...node.pos]);
                    }
                }
            }
            
            // Calculate new positions
            const updates = [];
            for (const [nodeId, offset] of this.canvas.interactionState.dragging.offsets) {
                const node = this.canvas.graph.getNodeById(nodeId);
                if (node) {
                    const newX = this.canvas.mouseState.graph[0] + offset[0];
                    const newY = this.canvas.mouseState.graph[1] + offset[1];
                    
                    // Only update if position actually changed
                    const lastPos = this.dragState.lastPositions.get(nodeId);
                    if (!lastPos || lastPos[0] !== newX || lastPos[1] !== newY) {
                        updates.push({
                            nodeId,
                            oldPos: lastPos || [...node.pos],
                            newPos: [newX, newY],
                            node
                        });
                        
                        this.dragState.lastPositions.set(nodeId, [newX, newY]);
                    }
                }
            }
            
            // Apply updates immediately for smooth dragging
            // (The commands will make it official when drag ends)
            updates.forEach(({ node, newPos }) => {
                node.pos[0] = newPos[0];
                node.pos[1] = newPos[1];
            });
            
            // Invalidate selection bounding box
            this.canvas.selection.invalidateBoundingBox();
            
            // Mark canvas dirty
            this.canvas.dirty_canvas = true;
        };
    }
    
    /**
     * Override finish interaction to commit the drag
     */
    overrideFinishInteraction() {
        const originalFinish = this.canvas.finishInteractions.bind(this.canvas);
        
        this.canvas.finishInteractions = () => {
            // Check if we were dragging nodes (not canvas)
            const wasDraggingNodes = this.canvas.interactionState.dragging.node && 
                                   this.dragState.active &&
                                   this.dragState.lastPositions.size > 0;
            
            // Temporarily disable the old actionManager to prevent double execution
            const originalActionManager = this.canvas.actionManager;
            if (wasDraggingNodes) {
                this.canvas.actionManager = null;
            }
            
            // Call original finish (but actionManager is disabled)
            originalFinish();
            
            // Restore actionManager
            if (wasDraggingNodes) {
                this.canvas.actionManager = originalActionManager;
                
                // Now commit through our pipeline
                this.commitDragOperation();
            }
            
            // Reset drag state
            this.dragState.active = false;
            this.dragState.lastPositions.clear();
            this.dragState.dragCommands = [];
        };
    }
    
    /**
     * Commit the drag operation through the pipeline
     */
    async commitDragOperation() {
        const positions = Array.from(this.dragState.lastPositions.entries());
        
        if (positions.length === 0) return;
        
        try {
            // Single node move
            if (positions.length === 1) {
                const [nodeId, position] = positions[0];
                const node = this.canvas.graph.getNodeById(nodeId);
                
                if (node) {
                    // Include media properties for media nodes
                    const moveData = {
                        nodeId,
                        position
                    };
                    
                    if (node.type === 'media/image' || node.type === 'media/video') {
                        moveData.properties = {
                            src: node.properties.src,
                            hash: node.properties.hash,
                            filename: node.properties.filename,
                            serverFilename: node.properties.serverFilename
                        };
                    }
                    
                    await this.pipeline.execute('node_move', moveData);
                }
            }
            // Multi-node move
            else {
                const nodeIds = [];
                const finalPositions = [];
                const nodeProperties = {};
                
                for (const [nodeId, position] of positions) {
                    const node = this.canvas.graph.getNodeById(nodeId);
                    if (node) {
                        nodeIds.push(nodeId);
                        finalPositions.push(position);
                        
                        // Include media properties
                        if (node.type === 'media/image' || node.type === 'media/video') {
                            nodeProperties[nodeId] = {
                                src: node.properties.src,
                                hash: node.properties.hash,
                                filename: node.properties.filename,
                                serverFilename: node.properties.serverFilename
                            };
                        }
                    }
                }
                
                if (nodeIds.length > 0) {
                    const moveData = {
                        nodeIds,
                        positions: finalPositions
                    };
                    
                    if (Object.keys(nodeProperties).length > 0) {
                        moveData.nodeProperties = nodeProperties;
                    }
                    
                    await this.pipeline.execute('node_move', moveData);
                }
            }
            
            console.log('✅ Drag operation committed to pipeline');
            
        } catch (error) {
            console.error('Failed to commit drag operation:', error);
        }
    }
    
    /**
     * Test the integration
     */
    test() {
        console.log('\n=== Testing Canvas Integration ===\n');
        
        console.log('Canvas available:', !!this.canvas);
        console.log('Pipeline available:', !!this.pipeline);
        console.log('updateNodeDrag overridden:', this.canvas?.updateNodeDrag?.toString().includes('dragState'));
        console.log('finishInteractions overridden:', this.canvas?.finishInteractions?.toString().includes('commitDragOperation'));
        
        console.log('\n✅ Canvas integration test complete');
    }
}

// Initialize if app and architecture exist
if (window.app?.collaborativeArchitecture) {
    window.app.canvasIntegration = new CanvasIntegration(window.app);
    window.app.canvasIntegration.initialize();
    window.app.canvasIntegration.test();
} else {
    console.log('⏳ Waiting for collaborative architecture...');
    
    // Set up a watcher
    const checkInterval = setInterval(() => {
        if (window.app?.collaborativeArchitecture?.operationPipeline) {
            clearInterval(checkInterval);
            window.app.canvasIntegration = new CanvasIntegration(window.app);
            window.app.canvasIntegration.initialize();
            window.app.canvasIntegration.test();
        }
    }, 100);
}

// Export for use
window.CanvasIntegration = CanvasIntegration;