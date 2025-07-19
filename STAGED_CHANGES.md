# Staged Changes: Centralized Action System for Automatic Sync

## Overview
Implement a centralized action system that automatically broadcasts all canvas modifications (except navigation) to ensure comprehensive synchronization without manual broadcast calls.

## Architecture

### 1. Core Action Manager (`js/actions/CanvasActionManager.js`)

```javascript
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
                const node = await this.graph.createNode(params.nodeData);
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
        
        this.registerAction('node_rotate', {
            validate: (params) => {
                if (!params.nodeId && !params.nodeIds) {
                    return { valid: false, error: 'Missing nodeId or nodeIds' };
                }
                return { valid: true };
            },
            execute: (params) => {
                if (params.nodeIds) {
                    // Multi-node rotation
                    params.nodeIds.forEach((nodeId, index) => {
                        const node = this.graph.getNodeById(nodeId);
                        if (node && params.rotations !== undefined) {
                            node.rotation = params.rotations[index] % 360;
                            if (params.positions && params.positions[index]) {
                                node.pos[0] = params.positions[index][0];
                                node.pos[1] = params.positions[index][1];
                            }
                        }
                    });
                } else {
                    // Single node rotation
                    const node = this.graph.getNodeById(params.nodeId);
                    if (node && params.rotation !== undefined) {
                        node.rotation = params.rotation % 360;
                        if (params.pos) {
                            node.pos[0] = params.pos[0];
                            node.pos[1] = params.pos[1];
                        }
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
        
        this.registerAction('node_align', {
            validate: (params) => {
                if (!params.nodeIds || params.nodeIds.length < 2) {
                    return { valid: false, error: 'Need at least 2 nodes to align' };
                }
                if (!params.alignType) {
                    return { valid: false, error: 'Missing alignType' };
                }
                return { valid: true };
            },
            execute: (params) => {
                // Implementation would align nodes based on alignType
                // (left, right, top, bottom, center-h, center-v, distribute-h, distribute-v)
                const nodes = params.nodeIds.map(id => this.graph.getNodeById(id)).filter(Boolean);
                if (nodes.length < 2) return;
                
                // Example for left alignment
                if (params.alignType === 'left') {
                    const minX = Math.min(...nodes.map(n => n.pos[0]));
                    nodes.forEach(node => {
                        node.pos[0] = minX;
                    });
                }
                // ... other alignment implementations
            }
        });
        
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

export default CanvasActionManager;
```

### 2. Update Canvas Class (`js/canvas.js`)

```javascript
// Add to the top of canvas.js
import CanvasActionManager from './actions/CanvasActionManager.js';

// In the Canvas constructor, add:
constructor(canvasElement, graph) {
    // ... existing code ...
    
    // Initialize action manager
    this.actionManager = null; // Will be set when collaborative manager is ready
}

// Add method to set action manager
setActionManager(collaborativeManager) {
    this.actionManager = new CanvasActionManager(this, this.graph, collaborativeManager);
    
    // Set action manager on collaborative manager for remote operations
    if (collaborativeManager) {
        collaborativeManager.setActionManager(this.actionManager);
    }
}

// Update all direct manipulation methods to use action manager
// Example: Update the moveNode method
moveNode(node, dx, dy) {
    if (this.actionManager) {
        this.actionManager.executeAction('node_move', {
            nodeId: node.id,
            x: node.pos[0] + dx,
            y: node.pos[1] + dy
        });
    } else {
        // Fallback for non-collaborative mode
        node.pos[0] += dx;
        node.pos[1] += dy;
        this.dirty_canvas = true;
    }
}

// Update the resizeNode method
resizeNode(node, newWidth, newHeight) {
    if (this.actionManager) {
        this.actionManager.executeAction('node_resize', {
            nodeId: node.id,
            width: newWidth,
            height: newHeight
        });
    } else {
        // Fallback
        node.size[0] = newWidth;
        node.size[1] = newHeight;
        if (node.onResize) node.onResize();
        this.dirty_canvas = true;
    }
}

// Update the rotateNode method
rotateNode(node, angle, pivotX, pivotY) {
    if (this.actionManager) {
        this.actionManager.executeAction('node_rotate', {
            nodeId: node.id,
            rotation: angle,
            pos: [pivotX, pivotY]
        });
    } else {
        // Fallback
        node.rotation = angle % 360;
        if (pivotX !== undefined && pivotY !== undefined) {
            node.pos[0] = pivotX;
            node.pos[1] = pivotY;
        }
        this.dirty_canvas = true;
    }
}

// Update double-click handler to use action manager
onDoubleClick(e) {
    const rotationHandle = this.handleDetector.getRotationHandle(...this.mouseState.canvas);
    if (rotationHandle) {
        if (this.selection.size() > 1) {
            const selectedNodes = this.selection.getSelectedNodes();
            const nodeIds = selectedNodes.map(n => n.id);
            const values = selectedNodes.map(() => 0);
            
            if (this.actionManager) {
                this.actionManager.executeAction('node_reset', {
                    nodeIds: nodeIds,
                    resetType: 'rotation',
                    values: values
                });
            }
        } else {
            this.resetRotation(rotationHandle);
        }
        return;
    }
    
    // Similar updates for aspect ratio reset...
}

// Remove all direct broadcast calls like:
// - this.broadcastNodeMove()
// - this.broadcastNodeResize()
// - this.broadcastNodeRotate()
// - this.broadcastNodeReset()
// etc.
```

### 3. Update Collaborative Manager (`js/collaborative.js`)

```javascript
// Add property for action manager
constructor(graph, canvas) {
    // ... existing code ...
    this.actionManager = null;
}

// Add method to set action manager
setActionManager(actionManager) {
    this.actionManager = actionManager;
}

// Update handleRemoteOperation to use action manager
async handleRemoteOperation(data) {
    const { operation, userId } = data;
    
    if (userId === this.currentUser?.userId) {
        return; // Skip own operations
    }
    
    const { type, data: operationData } = operation;
    
    console.log('📥 Remote operation:', type, operationData);
    
    // Use action manager for all operations
    if (this.actionManager) {
        await this.actionManager.executeAction(type, operationData, { 
            fromRemote: true,
            skipUndo: true 
        });
    } else {
        // Fallback to existing implementation
        this.applyOperation(type, operationData);
    }
    
    // Update sequence number
    if (operation.sequenceNumber > this.sequenceNumber) {
        this.sequenceNumber = operation.sequenceNumber;
    }
}

// Remove individual apply methods (applyNodeMove, applyNodeResize, etc.)
// as they'll be handled by the action manager
```

### 4. Update App Initialization (`js/app.js`)

```javascript
// In the initialize method, after creating collaborative manager:
initialize() {
    // ... existing code ...
    
    // Create collaborative manager
    this.collaborativeManager = new CollaborativeManager(this.graph, this.graphCanvas);
    
    // Set up action manager
    this.graphCanvas.setActionManager(this.collaborativeManager);
    
    // ... rest of initialization ...
}
```

### 5. Migration Strategy

To migrate existing code to use the action system:

1. **Phase 1**: Implement action manager with core actions
2. **Phase 2**: Update Canvas class methods one by one to use action manager
3. **Phase 3**: Remove individual broadcast methods
4. **Phase 4**: Test all operations thoroughly
5. **Phase 5**: Add new actions as needed

### 6. Benefits

1. **Automatic Sync**: All actions are automatically broadcast unless explicitly excluded
2. **Single Source of Truth**: All canvas modifications go through one system
3. **Extensibility**: Easy to add new actions without touching sync code
4. **Validation**: Built-in parameter validation
5. **Consistency**: All actions follow same pattern
6. **Debugging**: Single point to log all actions (enable with `actionManager.debugMode = true`)
7. **Undo/Redo**: Natural integration with undo system
8. **Performance**: Can batch related operations
9. **Race Condition Prevention**: Action queue ensures proper ordering of rapid actions
10. **Better Action IDs**: Uses crypto.randomUUID() when available for more unique IDs

### 7. Example: Adding a New Node Type

With this system, adding a new node type with custom actions:

```javascript
// Register actions for new node type
actionManager.registerAction('video_toggle_play', {
    validate: (params) => {
        if (!params.nodeId) return { valid: false, error: 'Missing nodeId' };
        return { valid: true };
    },
    execute: (params) => {
        const node = this.graph.getNodeById(params.nodeId);
        if (node && node.type === 'video') {
            node.togglePlay();
            return { playing: node.isPlaying };
        }
    }
});

// Use it anywhere
canvas.actionManager.executeAction('video_toggle_play', { nodeId: videoNode.id });
// Automatically synced to all connected users!
```

No need to add broadcast calls or sync handlers - it just works!