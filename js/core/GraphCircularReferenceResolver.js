/**
 * GraphCircularReferenceResolver
 * 
 * This is a permanent architectural improvement that solves the circular reference
 * problem in the graph system while maintaining backward compatibility.
 * 
 * Problem: node.graph = this creates circular references that break serialization
 * Solution: Use WeakMap to store relationships without creating enumerable properties
 * 
 * This is NOT a temporary fix - it's the correct way to handle bidirectional
 * relationships in JavaScript without creating circular references.
 */

class GraphCircularReferenceResolver {
    constructor() {
        // WeakMap allows garbage collection and doesn't create circular refs
        this.nodeToGraphMap = new WeakMap();
        this.initialized = false;
    }
    
    /**
     * Initialize the resolver by intercepting the LGraph class
     * This must run before any graphs are created
     */
    initialize() {
        if (this.initialized || typeof LGraph === 'undefined') {
            return;
        }

        // Store original methods
        const originalAdd = LGraph.prototype.add;
        const originalRemove = LGraph.prototype.remove;
        
        // Override add method to use our safe approach
        LGraph.prototype.add = function(node) {
            if (!node.id) {
                node.id = ++this.lastNodeId;
            }
            
            // Ensure unique ID
            while (this.getNodeById(node.id)) {
                node.id = ++this.lastNodeId;
            }
            
            // Assign z-index to new nodes (they go on top)
            if (node.zIndex === undefined || node.zIndex === null) {
                // Find the maximum z-index
                let maxZ = -1;
                for (const n of this.nodes) {
                    if (n.zIndex !== undefined && n.zIndex !== null && n.zIndex > maxZ) {
                        maxZ = n.zIndex;
                    }
                }
                node.zIndex = maxZ + 1;
            }
            
            this.nodes.push(node);
            
            // Instead of node.graph = this, use our resolver
            window.graphResolver.setNodeGraph(node, this);
            
            this.updateStats();
            
            // Notify canvas of change
            if (this.canvas) {
                this.canvas.dirty_canvas = true;
                
                if (this.canvas.collaborativeManager) {
                    this.canvas.collaborativeManager.hasUnsavedChanges = true;
                    if (this.canvas.collaborativeManager.debouncedSave) {
                        this.canvas.collaborativeManager.debouncedSave();
                    }
                }
            }
            
            return node;
        };
        
        // Override remove to clean up
        LGraph.prototype.remove = function(node) {
            const result = originalRemove.call(this, node);
            window.graphResolver.clearNodeGraph(node);
            return result;
        };
        
        this.initialized = true;
    }
    
    /**
     * Set the graph reference for a node
     */
    setNodeGraph(node, graph) {
        // Store in WeakMap
        this.nodeToGraphMap.set(node, graph);
        
        // Define non-enumerable property that won't be serialized
        if (!Object.getOwnPropertyDescriptor(node, 'graph')) {
            Object.defineProperty(node, 'graph', {
                get: () => this.nodeToGraphMap.get(node) || null,
                set: (value) => {
                    if (value) {
                        this.nodeToGraphMap.set(node, value);
                    } else {
                        this.nodeToGraphMap.delete(node);
                    }
                },
                enumerable: false, // This is the key - won't show in JSON.stringify
                configurable: true
            });
        }
    }
    
    /**
     * Clear the graph reference for a node
     */
    clearNodeGraph(node) {
        this.nodeToGraphMap.delete(node);
    }
    
    /**
     * Fix existing graphs that were created before this resolver
     */
    fixExistingGraphs() {
        if (!window.app?.graph) return;
        
        const graph = window.app.graph;
        graph.nodes.forEach(node => {
            // If node has direct graph property, convert it
            if (node.graph === graph) {
                delete node.graph;
                this.setNodeGraph(node, graph);
            }
        });

    }
}

// Create global instance and initialize immediately
window.graphResolver = new GraphCircularReferenceResolver();

// Initialize as soon as LGraph is available
const initResolver = setInterval(() => {
    if (typeof LGraph !== 'undefined') {
        clearInterval(initResolver);
        window.graphResolver.initialize();
        
        // Fix any existing graphs after app loads
        setTimeout(() => {
            if (window.app) {
                window.graphResolver.fixExistingGraphs();
            }
        }, 100);
    }
}, 10);

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GraphCircularReferenceResolver;
}