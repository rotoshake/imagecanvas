/**
 * GraphFixEarly - Fixes the circular reference issue before nodes are created
 * This runs very early to prevent any issues with node.graph assignment
 */

(function() {
    console.log('🔧 Installing early graph circular reference fix...');
    
    // Store graph references in a WeakMap to avoid circular references
    const nodeGraphMap = new WeakMap();
    
    // Wait for LGraph to be available
    const installFix = () => {
        if (typeof LGraph === 'undefined') {
            setTimeout(installFix, 10);
            return;
        }
        
        // Override the add method on the prototype
        const originalAdd = LGraph.prototype.add;
        LGraph.prototype.add = function(node) {
            if (!node.id) {
                node.id = ++this.lastNodeId;
            }
            
            // Ensure unique ID
            while (this.getNodeById(node.id)) {
                node.id = ++this.lastNodeId;
            }
            
            this.nodes.push(node);
            
            // Instead of node.graph = this, use our property definition
            nodeGraphMap.set(node, this);
            
            // Define graph property with getter/setter that doesn't create circular reference
            if (!node.hasOwnProperty('graph') || node.graph !== this) {
                Object.defineProperty(node, 'graph', {
                    get: function() {
                        return nodeGraphMap.get(this) || null;
                    },
                    set: function(value) {
                        if (value) {
                            nodeGraphMap.set(this, value);
                        } else {
                            nodeGraphMap.delete(this);
                        }
                    },
                    enumerable: false, // Prevents inclusion in JSON.stringify
                    configurable: true
                });
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
            
            return node;
        };
        
        // Override remove to clean up
        const originalRemove = LGraph.prototype.remove;
        LGraph.prototype.remove = function(node) {
            const index = this.nodes.indexOf(node);
            if (index !== -1) {
                this.nodes.splice(index, 1);
                nodeGraphMap.delete(node); // Clean up WeakMap
                
                // Call node cleanup
                if (node.onRemoved) {
                    node.onRemoved();
                }
                
                this.updateStats();
                
                // Clear all interactions with this node
                if (this.canvas) {
                    this.canvas.clearNodeInteractions(node);
                }
            }
        };
        
        console.log('✅ Early graph circular reference fix installed');
    };
    
    // Install the fix as early as possible
    installFix();
})();