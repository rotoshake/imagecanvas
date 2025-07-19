// js/actions/IncrementalStateSynchronizer.js

class IncrementalStateSynchronizer {
    constructor(collaborativeManager) {
        this.collaborativeManager = collaborativeManager;
        
        // State tracking
        this.lastKnownState = new Map(); // nodeId -> nodeState
        this.stateVersion = 0;
        this.lastSyncTime = 0;
        
        // Delta compression settings
        this.enableCompression = true;
        this.compressionThreshold = 1024; // 1KB
        
        // Sync configuration
        this.syncInterval = 30000; // 30 seconds
        this.forceSyncThreshold = 100; // Force full sync after 100 operations
        this.operationCounter = 0;
        
        // Delta types
        this.DELTA_TYPES = {
            NODE_ADDED: 'node_added',
            NODE_REMOVED: 'node_removed', 
            NODE_MODIFIED: 'node_modified',
            PROPERTIES_CHANGED: 'properties_changed',
            TRANSFORM_CHANGED: 'transform_changed'
        };
        
        // Properties to track for changes
        this.TRACKED_PROPERTIES = [
            'pos', 'size', 'rotation', 'aspectRatio', 
            'title', 'properties', 'flags', 'color', 'bgcolor'
        ];
        
        console.log('📊 IncrementalStateSynchronizer initialized');
    }
    
    /**
     * Initialize with current graph state
     */
    initialize(graph) {
        this.captureCurrentState(graph);
        this.stateVersion = 1;
        this.lastSyncTime = Date.now();
        console.log('📊 State synchronizer initialized with', this.lastKnownState.size, 'nodes');
    }
    
    /**
     * Capture the current state of all nodes
     */
    captureCurrentState(graph) {
        this.lastKnownState.clear();
        
        for (const node of graph.nodes) {
            this.lastKnownState.set(node.id, this.serializeNode(node));
        }
    }
    
    /**
     * Serialize a node to trackable state
     */
    serializeNode(node) {
        const state = {
            id: node.id,
            type: node.type,
            pos: [...node.pos],
            size: [...node.size],
            title: node.title || '',
            aspectRatio: node.aspectRatio || 1,
            rotation: node.rotation || 0,
            color: node.color || null,
            bgcolor: node.bgcolor || null,
            properties: node.properties ? { ...node.properties } : {},
            flags: node.flags ? { ...node.flags } : {},
            timestamp: Date.now()
        };
        
        return state;
    }
    
    /**
     * Generate delta between current state and last known state
     */
    generateDelta(graph) {
        const delta = {
            version: ++this.stateVersion,
            timestamp: Date.now(),
            changes: []
        };
        
        const currentNodes = new Set();
        
        // Check for added or modified nodes
        for (const node of graph.nodes) {
            currentNodes.add(node.id);
            const currentState = this.serializeNode(node);
            const lastState = this.lastKnownState.get(node.id);
            
            if (!lastState) {
                // Node was added
                delta.changes.push({
                    type: this.DELTA_TYPES.NODE_ADDED,
                    nodeId: node.id,
                    nodeData: currentState
                });
            } else {
                // Check for modifications
                const changes = this.compareNodeStates(lastState, currentState);
                if (changes.length > 0) {
                    delta.changes.push({
                        type: this.DELTA_TYPES.NODE_MODIFIED,
                        nodeId: node.id,
                        changes: changes
                    });
                }
            }
            
            // Update last known state
            this.lastKnownState.set(node.id, currentState);
        }
        
        // Check for removed nodes
        for (const [nodeId] of this.lastKnownState) {
            if (!currentNodes.has(nodeId)) {
                delta.changes.push({
                    type: this.DELTA_TYPES.NODE_REMOVED,
                    nodeId: nodeId
                });
                this.lastKnownState.delete(nodeId);
            }
        }
        
        return delta;
    }
    
    /**
     * Compare two node states and return differences
     */
    compareNodeStates(oldState, newState) {
        const changes = [];
        
        // Check position changes
        if (!this.arraysEqual(oldState.pos, newState.pos)) {
            changes.push({
                property: 'pos',
                oldValue: oldState.pos,
                newValue: newState.pos
            });
        }
        
        // Check size changes
        if (!this.arraysEqual(oldState.size, newState.size)) {
            changes.push({
                property: 'size', 
                oldValue: oldState.size,
                newValue: newState.size
            });
        }
        
        // Check rotation changes
        if (oldState.rotation !== newState.rotation) {
            changes.push({
                property: 'rotation',
                oldValue: oldState.rotation,
                newValue: newState.rotation
            });
        }
        
        // Check aspect ratio changes
        if (oldState.aspectRatio !== newState.aspectRatio) {
            changes.push({
                property: 'aspectRatio',
                oldValue: oldState.aspectRatio,
                newValue: newState.aspectRatio
            });
        }
        
        // Check title changes
        if (oldState.title !== newState.title) {
            changes.push({
                property: 'title',
                oldValue: oldState.title,
                newValue: newState.title
            });
        }
        
        // Check color changes
        if (oldState.color !== newState.color) {
            changes.push({
                property: 'color',
                oldValue: oldState.color,
                newValue: newState.color
            });
        }
        
        // Check bgcolor changes
        if (oldState.bgcolor !== newState.bgcolor) {
            changes.push({
                property: 'bgcolor',
                oldValue: oldState.bgcolor,
                newValue: newState.bgcolor
            });
        }
        
        // Check properties changes
        const propChanges = this.compareObjects(oldState.properties, newState.properties);
        if (propChanges.length > 0) {
            changes.push({
                property: 'properties',
                changes: propChanges
            });
        }
        
        // Check flags changes
        const flagChanges = this.compareObjects(oldState.flags, newState.flags);
        if (flagChanges.length > 0) {
            changes.push({
                property: 'flags',
                changes: flagChanges
            });
        }
        
        return changes;
    }
    
    /**
     * Compare two objects and return property-level differences
     */
    compareObjects(oldObj, newObj) {
        const changes = [];
        const allKeys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);
        
        for (const key of allKeys) {
            const oldValue = oldObj?.[key];
            const newValue = newObj?.[key];
            
            if (!this.deepEqual(oldValue, newValue)) {
                changes.push({
                    key: key,
                    oldValue: oldValue,
                    newValue: newValue
                });
            }
        }
        
        return changes;
    }
    
    /**
     * Apply a delta to the current graph
     */
    applyDelta(delta, graph) {
        console.log('📊 Applying delta with', delta.changes.length, 'changes');
        
        for (const change of delta.changes) {
            try {
                this.applyChange(change, graph);
            } catch (error) {
                console.error('Error applying delta change:', error, change);
            }
        }
        
        // Update version
        this.stateVersion = Math.max(this.stateVersion, delta.version);
        
        // Force canvas redraw
        if (this.collaborativeManager.canvas) {
            this.collaborativeManager.canvas.dirty_canvas = true;
        }
    }
    
    /**
     * Apply a single change from a delta
     */
    applyChange(change, graph) {
        switch (change.type) {
            case this.DELTA_TYPES.NODE_ADDED:
                this.applyNodeAdd(change, graph);
                break;
                
            case this.DELTA_TYPES.NODE_REMOVED:
                this.applyNodeRemove(change, graph);
                break;
                
            case this.DELTA_TYPES.NODE_MODIFIED:
                this.applyNodeModify(change, graph);
                break;
        }
    }
    
    /**
     * Apply node addition
     */
    applyNodeAdd(change, graph) {
        const { nodeData } = change;
        
        // Check if node already exists
        if (graph.getNodeById(nodeData.id)) {
            console.warn('Node already exists:', nodeData.id);
            return;
        }
        
        // Create node using NodeFactory
        if (typeof NodeFactory !== 'undefined') {
            const node = NodeFactory.createNode(nodeData.type);
            if (node) {
                // Apply all properties
                Object.assign(node, nodeData);
                node.pos = [...nodeData.pos];
                node.size = [...nodeData.size];
                
                // Handle media loading if needed
                if ((nodeData.type === 'media/image' || nodeData.type === 'media/video') && 
                    nodeData.properties?.hash) {
                    this.collaborativeManager.loadNodeMedia?.(node, nodeData);
                }
                
                graph.add(node);
                this.lastKnownState.set(nodeData.id, nodeData);
            }
        }
    }
    
    /**
     * Apply node removal
     */
    applyNodeRemove(change, graph) {
        const node = graph.getNodeById(change.nodeId);
        if (node) {
            graph.remove(node);
            this.lastKnownState.delete(change.nodeId);
        }
    }
    
    /**
     * Apply node modifications
     */
    applyNodeModify(change, graph) {
        const node = graph.getNodeById(change.nodeId);
        if (!node) {
            console.warn('Cannot modify non-existent node:', change.nodeId);
            return;
        }
        
        for (const propertyChange of change.changes) {
            this.applyPropertyChange(node, propertyChange);
        }
        
        // Update our tracking
        this.lastKnownState.set(change.nodeId, this.serializeNode(node));
    }
    
    /**
     * Apply a property change to a node
     */
    applyPropertyChange(node, change) {
        switch (change.property) {
            case 'pos':
                node.pos[0] = change.newValue[0];
                node.pos[1] = change.newValue[1];
                break;
                
            case 'size':
                node.size[0] = change.newValue[0];
                node.size[1] = change.newValue[1];
                if (node.onResize) node.onResize();
                break;
                
            case 'rotation':
                node.rotation = change.newValue;
                break;
                
            case 'aspectRatio':
                node.aspectRatio = change.newValue;
                break;
                
            case 'title':
                node.title = change.newValue;
                break;
                
            case 'color':
                node.color = change.newValue;
                break;
                
            case 'bgcolor':
                node.bgcolor = change.newValue;
                break;
                
            case 'properties':
                for (const propChange of change.changes) {
                    if (propChange.newValue === undefined) {
                        delete node.properties[propChange.key];
                    } else {
                        node.properties[propChange.key] = propChange.newValue;
                    }
                }
                break;
                
            case 'flags':
                for (const flagChange of change.changes) {
                    if (flagChange.newValue === undefined) {
                        delete node.flags[flagChange.key];
                    } else {
                        node.flags[flagChange.key] = flagChange.newValue;
                    }
                }
                break;
        }
    }
    
    /**
     * Send incremental sync to other clients
     */
    performIncrementalSync(graph) {
        const delta = this.generateDelta(graph);
        
        if (delta.changes.length === 0) {
            console.log('📊 No changes to sync');
            return;
        }
        
        console.log('📊 Sending incremental sync with', delta.changes.length, 'changes');
        
        // Send delta via collaborative manager
        if (this.collaborativeManager.socket && this.collaborativeManager.isConnected) {
            this.collaborativeManager.socket.emit('incremental_sync', {
                projectId: this.collaborativeManager.currentProject.id,
                delta: delta,
                fromUser: this.collaborativeManager.currentUser?.userId
            });
        }
        
        this.lastSyncTime = Date.now();
        this.operationCounter = 0;
    }
    
    /**
     * Check if full sync is needed
     */
    shouldPerformFullSync() {
        const timeSinceSync = Date.now() - this.lastSyncTime;
        return this.operationCounter >= this.forceSyncThreshold || 
               timeSinceSync >= this.syncInterval;
    }
    
    /**
     * Perform full state sync as fallback
     */
    performFullSync(graph) {
        console.log('📊 Performing full state sync');
        
        this.captureCurrentState(graph);
        
        if (this.collaborativeManager.broadcastFullState) {
            this.collaborativeManager.broadcastFullState();
        }
        
        this.lastSyncTime = Date.now();
        this.operationCounter = 0;
    }
    
    /**
     * Increment operation counter
     */
    recordOperation() {
        this.operationCounter++;
    }
    
    /**
     * Utility functions
     */
    arraysEqual(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
        if (a.length !== b.length) return false;
        return a.every((val, i) => val === b[i]);
    }
    
    deepEqual(a, b) {
        if (a === b) return true;
        if (a == null || b == null) return false;
        if (typeof a !== typeof b) return false;
        
        if (Array.isArray(a)) {
            return this.arraysEqual(a, b);
        }
        
        if (typeof a === 'object') {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) return false;
            return keysA.every(key => this.deepEqual(a[key], b[key]));
        }
        
        return false;
    }
    
    /**
     * Reset synchronizer state
     */
    reset() {
        this.lastKnownState.clear();
        this.stateVersion = 0;
        this.lastSyncTime = 0;
        this.operationCounter = 0;
        console.log('📊 State synchronizer reset');
    }
    
    /**
     * Get synchronization statistics
     */
    getStats() {
        return {
            stateVersion: this.stateVersion,
            trackedNodes: this.lastKnownState.size,
            operationCounter: this.operationCounter,
            lastSyncTime: this.lastSyncTime,
            timeSinceSync: Date.now() - this.lastSyncTime
        };
    }
}

// Make it globally available
window.IncrementalStateSynchronizer = IncrementalStateSynchronizer;