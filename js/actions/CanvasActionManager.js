// js/actions/CanvasActionManager.js

class CanvasActionManager {
    constructor(canvas, graph, collaborativeManager) {
        this.canvas = canvas;
        this.graph = graph;
        this.collaborativeManager = collaborativeManager;
        
        // Actions that should NOT be broadcast
        this.EXCLUDED_ACTIONS = new Set([
            'pan_canvas',
            'zoom_canvas',
            'select_node',
            'hover_node',
            'start_selection_box',
            'update_selection_box',
            'end_selection_box',
            'update_cursor',
            'focus_node',
            'preview_operation'
        ]);
        
        // Action queue for handling rapid successive actions
        this.actionQueue = [];
        this.isProcessingQueue = false;
        
        // Debug logging
        this.debugMode = false; // Enable via console: window.app.graphCanvas.actionManager.debugMode = true
        
        // Register all available actions
        this.actions = {};
        this.registerCoreActions();
    }
    
    /**
     * Execute an action with automatic broadcasting
     */
    async executeAction(actionType, params, options = {}) {
        // Add to queue if processing other actions (prevent race conditions)
        if (this.isProcessingQueue && !options.fromQueue) {
            this.actionQueue.push({ actionType, params, options });
            return this.processQueue();
        }
        
        // Validate action exists
        if (!this.actions[actionType]) {
            console.error(`Unknown action type: ${actionType}`);
            return { success: false, error: 'Unknown action' };
        }
        
        // Validate parameters
        const validation = this.validateAction(actionType, params);
        if (!validation.valid) {
            console.error(`Invalid parameters for ${actionType}:`, validation.error);
            return { success: false, error: validation.error };
        }
        
        // Debug logging
        if (this.debugMode) {
            console.log(`🎯 Executing action: ${actionType}`, params, options);
        }
        
        // Execute the action
        let result;
        try {
            this.isProcessingQueue = true;
            
            // Start tracking for undo system
            if (!options.skipUndo && !this.EXCLUDED_ACTIONS.has(actionType)) {
                this.canvas.startUndoTracking?.();
            }
            
            // Execute the actual action
            result = await this.actions[actionType].execute(params, this);
            
            // Broadcast if not excluded and not from remote
            if (!options.fromRemote && 
                !this.EXCLUDED_ACTIONS.has(actionType) && 
                this.collaborativeManager?.isConnected) {
                
                this.collaborativeManager.sendOperation(actionType, {
                    ...params,
                    timestamp: Date.now(),
                    actionId: this.generateActionId()
                });
            }
            
            // Complete undo tracking
            if (!options.skipUndo && !this.EXCLUDED_ACTIONS.has(actionType)) {
                this.canvas.completeUndoTracking?.();
            }
            
            // Mark canvas as dirty
            if (!this.EXCLUDED_ACTIONS.has(actionType)) {
                this.canvas.dirty_canvas = true;
            }
            
            // Debug logging
            if (this.debugMode) {
                console.log(`✅ Action completed: ${actionType}`, result);
            }
            
            return { success: true, data: result };
            
        } catch (error) {
            console.error(`Error executing action ${actionType}:`, error);
            return { success: false, error: error.message };
        } finally {
            this.isProcessingQueue = false;
            // Process any queued actions
            if (this.actionQueue.length > 0) {
                this.processQueue();
            }
        }
    }
    
    /**
     * Process queued actions
     */
    async processQueue() {
        if (this.actionQueue.length === 0) return;
        
        const { actionType, params, options } = this.actionQueue.shift();
        return this.executeAction(actionType, params, { ...options, fromQueue: true });
    }
    
    /**
     * Validate action parameters
     */
    validateAction(actionType, params) {
        const action = this.actions[actionType];
        if (!action || !action.validate) {
            return { valid: true };
        }
        
        return action.validate(params, this);
    }
    
    /**
     * Register a new action
     */
    registerAction(actionType, actionDefinition) {
        this.actions[actionType] = actionDefinition;
    }
    
    /**
     * Generate unique action ID for deduplication
     */
    generateActionId() {
        return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Register all core canvas actions
     */
    registerCoreActions() {
        // Node manipulation actions
        this.registerAction('node_create', {
            validate: (params) => {
                if (!params.nodeData) return { valid: false, error: 'Missing nodeData' };
                if (!params.nodeData.type) return { valid: false, error: 'Missing node type' };
                return { valid: true };
            },
            execute: async (params) => {
                const nodeData = params.nodeData;
                
                // Create the node using NodeFactory
                const node = NodeFactory.createNode(nodeData.type);
                if (!node) {
                    throw new Error(`Failed to create node of type: ${nodeData.type}`);
                }
                
                // Set node properties
                if (nodeData.id) node.id = nodeData.id;
                if (nodeData.pos) node.pos = [...nodeData.pos];
                if (nodeData.size) node.size = [...nodeData.size];
                if (nodeData.title) node.title = nodeData.title;
                if (nodeData.properties) node.properties = { ...node.properties, ...nodeData.properties };
                if (nodeData.flags) node.flags = { ...node.flags, ...nodeData.flags };
                if (nodeData.aspectRatio) node.aspectRatio = nodeData.aspectRatio;
                if (nodeData.rotation) node.rotation = nodeData.rotation;
                
                // Handle media nodes - load image/video content
                if ((nodeData.type === 'media/image' || nodeData.type === 'media/video') && 
                    nodeData.properties && nodeData.properties.hash) {
                    const { src, filename, hash } = nodeData.properties;
                    console.log('Creating media node with properties:', { src, filename, hash });
                    if (nodeData.type === 'media/image' && node.setImage) {
                        await node.setImage(src, filename, hash);
                    } else if (nodeData.type === 'media/video' && node.setVideo) {
                        await node.setVideo(src, filename, hash);
                    }
                }
                
                // Add node to graph
                this.graph.add(node);
                
                return { nodeId: node.id };
            }
        });
        
        this.registerAction('node_move', {
            validate: (params) => {
                if (!params.nodeId && !params.nodeIds) {
                    return { valid: false, error: 'Missing nodeId or nodeIds' };
                }
                return { valid: true };
            },
            execute: (params) => {
                if (params.nodeIds) {
                    // Multi-node move
                    params.nodeIds.forEach((nodeId, index) => {
                        const node = this.graph.getNodeById(nodeId);
                        if (node && params.positions[index]) {
                            node.pos[0] = params.positions[index][0];
                            node.pos[1] = params.positions[index][1];
                        }
                    });
                } else {
                    // Single node move
                    const node = this.graph.getNodeById(params.nodeId);
                    if (node) {
                        node.pos[0] = params.x;
                        node.pos[1] = params.y;
                    }
                }
            }
        });
        
        this.registerAction('node_resize', {
            validate: (params) => {
                if (!params.nodeId && !params.nodeIds) {
                    return { valid: false, error: 'Missing nodeId or nodeIds' };
                }
                return { valid: true };
            },
            execute: (params) => {
                if (params.nodeIds) {
                    // Multi-node resize
                    params.nodeIds.forEach((nodeId, index) => {
                        const node = this.graph.getNodeById(nodeId);
                        if (node && params.sizes[index]) {
                            node.size[0] = params.sizes[index][0];
                            node.size[1] = params.sizes[index][1];
                            if (node.onResize) node.onResize();
                        }
                    });
                } else {
                    // Single node resize
                    const node = this.graph.getNodeById(params.nodeId);
                    if (node) {
                        node.size[0] = params.width;
                        node.size[1] = params.height;
                        if (node.onResize) node.onResize();
                    }
                }
            }
        });
        
        
        this.registerAction('node_reset', {
            validate: (params) => {
                if (!params.nodeId && !params.nodeIds) {
                    return { valid: false, error: 'Missing nodeId or nodeIds' };
                }
                if (!params.resetType) {
                    return { valid: false, error: 'Missing resetType' };
                }
                return { valid: true };
            },
            execute: (params) => {
                if (params.nodeIds) {
                    // Multi-node reset
                    params.nodeIds.forEach((nodeId, index) => {
                        const node = this.graph.getNodeById(nodeId);
                        if (node) {
                            if (params.resetType === 'rotation') {
                                node.rotation = params.values[index];
                            } else if (params.resetType === 'aspect_ratio' && node.originalAspect) {
                                node.aspectRatio = params.values[index];
                                node.size[1] = node.size[0] / params.values[index];
                                if (node.onResize) node.onResize();
                            }
                        }
                    });
                } else {
                    // Single node reset
                    const node = this.graph.getNodeById(params.nodeId);
                    if (node) {
                        if (params.resetType === 'rotation') {
                            node.rotation = params.value;
                        } else if (params.resetType === 'aspect_ratio' && node.originalAspect) {
                            node.aspectRatio = params.value;
                            node.size[1] = node.size[0] / params.value;
                            if (node.onResize) node.onResize();
                        }
                    }
                }
            }
        });
        
        this.registerAction('node_delete', {
            validate: (params) => {
                if (!params.nodeId && !params.nodeIds) {
                    return { valid: false, error: 'Missing nodeId or nodeIds' };
                }
                return { valid: true };
            },
            execute: (params) => {
                const nodeIds = params.nodeIds || [params.nodeId];
                nodeIds.forEach(nodeId => {
                    this.graph.removeNode(nodeId);
                });
                return { deletedNodes: nodeIds };
            }
        });
        
        this.registerAction('node_property_update', {
            validate: (params) => {
                if (!params.nodeId) return { valid: false, error: 'Missing nodeId' };
                if (!params.property) return { valid: false, error: 'Missing property' };
                return { valid: true };
            },
            execute: (params) => {
                const node = this.graph.getNodeById(params.nodeId);
                if (node) {
                    if (params.property === 'title') {
                        node.title = params.value;
                    } else if (params.property === 'color') {
                        node.color = params.value;
                    } else if (params.property === 'bgcolor') {
                        node.bgcolor = params.value;
                    } else if (node.properties) {
                        node.properties[params.property] = params.value;
                    }
                    
                    // Call node-specific update handler
                    if (node.onPropertyUpdate) {
                        node.onPropertyUpdate(params.property, params.value);
                    }
                }
            }
        });
        
        // Alignment is handled through batch node_move operations
        
        this.registerAction('layer_order_change', {
            validate: (params) => {
                if (!params.nodeId) return { valid: false, error: 'Missing nodeId' };
                if (!params.direction) return { valid: false, error: 'Missing direction' };
                return { valid: true };
            },
            execute: (params) => {
                const nodeIndex = this.graph.nodes.findIndex(n => n.id === params.nodeId);
                if (nodeIndex === -1) return;
                
                const node = this.graph.nodes[nodeIndex];
                this.graph.nodes.splice(nodeIndex, 1);
                
                switch (params.direction) {
                    case 'front':
                        this.graph.nodes.push(node);
                        break;
                    case 'back':
                        this.graph.nodes.unshift(node);
                        break;
                    case 'forward':
                        const newIndex = Math.min(nodeIndex + 1, this.graph.nodes.length);
                        this.graph.nodes.splice(newIndex, 0, node);
                        break;
                    case 'backward':
                        const backIndex = Math.max(nodeIndex - 1, 0);
                        this.graph.nodes.splice(backIndex, 0, node);
                        break;
                }
            }
        });
        
        // Add more actions as needed...
    }
}

// Make it globally available
window.CanvasActionManager = CanvasActionManager;