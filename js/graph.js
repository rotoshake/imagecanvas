// ===================================
// GRAPH CLASS
// ===================================

class ImageGraph {
    constructor() {
        this.nodes = [];
        this.connections = [];
        this.running = false;
        this.lastNodeId = 0;
        this.canvas = null;
        
        // Performance tracking
        this.stats = {
            nodeCount: 0,
            lastUpdate: Date.now()
        };
    }
    
    add(node) {
        if (!node.id) {
            node.id = ++this.lastNodeId;
        }
        
        // Ensure unique ID
        while (this.getNodeById(node.id)) {
            node.id = ++this.lastNodeId;
        }
        
        this.nodes.push(node);
        node.graph = this;
        
        this.updateStats();
        
        // Notify canvas of change
        if (this.canvas) {
            this.canvas.dirty_canvas = true;
            
            // Mark as having unsaved changes for auto-save
            if (this.canvas.collaborativeManager) {
                this.canvas.collaborativeManager.hasUnsavedChanges = true;
                // Trigger debounced save
                if (this.canvas.collaborativeManager.debouncedSave) {
                    this.canvas.collaborativeManager.debouncedSave();
                }
            }
        }
        
        return node;
    }
    
    remove(node) {
        const index = this.nodes.indexOf(node);
        if (index !== -1) {
            this.nodes.splice(index, 1);
            node.graph = null;
            
            // Call node cleanup
            if (node.onRemoved) {
                node.onRemoved();
            }
            
            // Remove from selection if selected
            if (this.canvas?.selection?.isSelected(node)) {
                this.canvas.selection.deselectNode(node);
            }
            
            this.updateStats();
            
            // Notify canvas of change
            if (this.canvas) {
                this.canvas.dirty_canvas = true;
                
                // Mark as having unsaved changes for auto-save
                if (this.canvas.collaborativeManager) {
                    this.canvas.collaborativeManager.hasUnsavedChanges = true;
                    // Trigger debounced save
                    if (this.canvas.collaborativeManager.debouncedSave) {
                        this.canvas.collaborativeManager.debouncedSave();
                    }
                }
            }
        }
    }
    
    removeMultiple(nodes) {
        for (const node of nodes) {
            this.remove(node);
        }
    }
    
    getNodeById(id) {
        return this.nodes.find(n => n.id === id);
    }
    
    getNodesByType(type) {
        return this.nodes.filter(n => n.type === type);
    }
    
    getNodesByTitle(title) {
        return this.nodes.filter(n => n.title === title);
    }
    
    clear() {
        // Clean up all nodes
        for (const node of this.nodes) {
            if (node.onRemoved) {
                node.onRemoved();
            }
            node.graph = null;
        }
        
        this.nodes = [];
        this.connections = [];
        this.lastNodeId = 0;
        
        // Clear selection
        if (this.canvas?.selection) {
            this.canvas.selection.clear();
        }
        
        this.updateStats();
        
        // Notify canvas of change
        if (this.canvas) {
            this.canvas.dirty_canvas = true;
        }
    }
    
    start() {
        this.running = true;
        console.log('Graph started');
    }
    
    stop() {
        this.running = false;
        console.log('Graph stopped');
    }
    
    updateStats() {
        this.stats.nodeCount = this.nodes.length;
        this.stats.lastUpdate = Date.now();
    }
    
    // Utility methods
    getBoundingBox() {
        if (this.nodes.length === 0) return null;
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const node of this.nodes) {
            const [x, y, w, h] = node.getBoundingBox();
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
        }
        
        return [minX, minY, maxX - minX, maxY - minY];
    }
    
    getNodesByBoundingBox(bbox) {
        const [x, y, width, height] = bbox;
        return this.nodes.filter(node => {
            const [nx, ny, nw, nh] = node.getBoundingBox();
            return nx + nw > x && nx < x + width &&
                   ny + nh > y && ny < y + height;
        });
    }
    
    // Layer management
    moveNodeToFront(node) {
        const index = this.nodes.indexOf(node);
        if (index !== -1 && index < this.nodes.length - 1) {
            this.nodes.splice(index, 1);
            this.nodes.push(node);
            
            if (this.canvas) {
                this.canvas.dirty_canvas = true;
            }
        }
    }
    
    moveNodeToBack(node) {
        const index = this.nodes.indexOf(node);
        if (index > 0) {
            this.nodes.splice(index, 1);
            this.nodes.unshift(node);
            
            if (this.canvas) {
                this.canvas.dirty_canvas = true;
            }
        }
    }
    
    moveNodeUp(node) {
        const index = this.nodes.indexOf(node);
        if (index !== -1 && index < this.nodes.length - 1) {
            // Swap with next node
            [this.nodes[index], this.nodes[index + 1]] = [this.nodes[index + 1], this.nodes[index]];
            
            if (this.canvas) {
                this.canvas.dirty_canvas = true;
            }
        }
    }
    
    moveNodeDown(node) {
        const index = this.nodes.indexOf(node);
        if (index > 0) {
            // Swap with previous node
            [this.nodes[index], this.nodes[index - 1]] = [this.nodes[index - 1], this.nodes[index]];
            
            if (this.canvas) {
                this.canvas.dirty_canvas = true;
            }
        }
    }
    
    // Node organization
    centerNodesAt(nodes, centerPoint) {
        if (nodes.length === 0) return;
        
        // Calculate current center of nodes
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const node of nodes) {
            minX = Math.min(minX, node.pos[0]);
            minY = Math.min(minY, node.pos[1]);
            maxX = Math.max(maxX, node.pos[0] + node.size[0]);
            maxY = Math.max(maxY, node.pos[1] + node.size[1]);
        }
        
        const currentCenter = [
            (minX + maxX) / 2,
            (minY + maxY) / 2
        ];
        
        // Calculate offset to move to new center
        const offset = [
            centerPoint[0] - currentCenter[0],
            centerPoint[1] - currentCenter[1]
        ];
        
        // Apply offset to all nodes
        for (const node of nodes) {
            node.pos[0] += offset[0];
            node.pos[1] += offset[1];
        }
        
        if (this.canvas) {
            this.canvas.dirty_canvas = true;
        }
    }
    
    // Search and filtering
    findNodes(predicate) {
        return this.nodes.filter(predicate);
    }
    
    findNodesByProperty(property, value) {
        return this.nodes.filter(node => node.properties[property] === value);
    }
    
    // Validation
    validate() {
        // Remove invalid nodes
        this.nodes = this.nodes.filter(node => {
            if (!node || typeof node.validate !== 'function') {
                console.warn('Removing invalid node:', node);
                return false;
            }
            
            try {
                node.validate();
                return true;
            } catch (error) {
                console.warn('Node validation failed:', error, node);
                return false;
            }
        });
        
        // Update IDs to ensure uniqueness
        const usedIds = new Set();
        for (const node of this.nodes) {
            if (usedIds.has(node.id)) {
                node.id = ++this.lastNodeId;
            }
            usedIds.add(node.id);
            this.lastNodeId = Math.max(this.lastNodeId, node.id);
        }
        
        this.updateStats();
    }
    
    // Performance monitoring
    getPerformanceInfo() {
        const nodeTypes = {};
        for (const node of this.nodes) {
            nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1;
        }
        
        return {
            totalNodes: this.nodes.length,
            nodeTypes: nodeTypes,
            lastUpdate: this.stats.lastUpdate,
            running: this.running
        };
    }
    
    // Debugging
    getDebugInfo() {
        return {
            nodeCount: this.nodes.length,
            connectionCount: this.connections.length,
            running: this.running,
            lastNodeId: this.lastNodeId,
            boundingBox: this.getBoundingBox(),
            performance: this.getPerformanceInfo()
        };
    }
    
    // Serialization helpers (for state management)
    serialize() {
        return {
            nodes: this.nodes.map(node => ({
                id: node.id,
                type: node.type,
                pos: [...node.pos],
                size: [...node.size],
                title: node.title,
                properties: { ...node.properties },
                flags: { ...node.flags },
                aspectRatio: node.aspectRatio,
                rotation: node.rotation
            })),
            lastNodeId: this.lastNodeId
        };
    }
}

// Expose globally and keep backward compatibility alias
if (typeof window !== 'undefined') {
    window.ImageGraph = ImageGraph;
    window.LGraph = ImageGraph; // Temporary alias for legacy references
}