/**
 * GraphRefactor - Removes circular references from the graph system
 * 
 * Problem: node.graph = this creates circular references
 * Solution: Use WeakMap and event system instead
 */

class GraphRefactor {
    constructor() {
        // WeakMap to store graph references without creating circular refs
        this.nodeGraphMap = new WeakMap();
        
        // Event emitter for node-to-graph communication
        this.nodeEvents = new EventTarget();
    }
    
    /**
     * Initialize the refactoring
     */
    initialize(app) {
        this.app = app;
        this.graph = app.graph;
        this.canvas = app.graphCanvas;
        
        console.log('🔧 Initializing graph refactor...');
        
        // Override graph methods
        this.overrideGraphMethods();
        
        // Override node methods
        this.overrideNodeMethods();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        console.log('✅ Graph refactor initialized');
    }
    
    /**
     * Override graph.add to use WeakMap instead of circular reference
     */
    overrideGraphMethods() {
        const originalAdd = this.graph.add.bind(this.graph);
        const originalRemove = this.graph.remove.bind(this.graph);
        
        // Override add method
        this.graph.add = (node) => {
            // Call original add
            const result = originalAdd(node);
            
            // Instead of node.graph = this, use WeakMap
            this.nodeGraphMap.set(node, this.graph);
            
            // Remove the circular reference
            delete node.graph;
            
            return result;
        };
        
        // Override remove method
        this.graph.remove = (node) => {
            // Remove from WeakMap
            this.nodeGraphMap.delete(node);
            
            // Call original remove
            return originalRemove(node);
        };
        
        // Fix existing nodes
        this.graph.nodes.forEach(node => {
            if (node.graph) {
                this.nodeGraphMap.set(node, node.graph);
                delete node.graph;
            }
        });
    }
    
    /**
     * Override node methods to use event system instead of direct references
     */
    overrideNodeMethods() {
        // Helper to get graph safely
        const getGraph = (node) => {
            return this.nodeGraphMap.get(node);
        };
        
        // Helper to get canvas safely
        const getCanvas = (node) => {
            const graph = getGraph(node);
            return graph?.canvas;
        };
        
        // Override BaseNode prototype if it exists
        if (typeof BaseNode !== 'undefined') {
            // Add getters that use WeakMap
            Object.defineProperty(BaseNode.prototype, 'graph', {
                get: function() {
                    return window.app?.graphRefactor?.nodeGraphMap.get(this);
                },
                configurable: true
            });
        }
        
        // Create property update method that uses events
        window.emitNodePropertyUpdate = (node, property, value) => {
            this.nodeEvents.dispatchEvent(new CustomEvent('propertyUpdate', {
                detail: { node, property, value }
            }));
        };
        
        // Create canvas dirty method that uses events
        window.markCanvasDirty = () => {
            this.nodeEvents.dispatchEvent(new CustomEvent('canvasDirty'));
        };
    }
    
    /**
     * Setup event handlers for node-to-graph communication
     */
    setupEventHandlers() {
        // Handle property updates
        this.nodeEvents.addEventListener('propertyUpdate', (event) => {
            const { node, property, value } = event.detail;
            
            // Use new architecture if available
            if (this.app.operationPipeline) {
                this.app.operationPipeline.execute('node_property_update', {
                    nodeId: node.id,
                    property,
                    value
                }).catch(err => {
                    console.error('Property update failed:', err);
                });
            } else {
                // Fallback to old broadcast
                const canvas = this.canvas;
                if (canvas?.broadcastNodePropertyUpdate) {
                    canvas.broadcastNodePropertyUpdate(node.id, property, value);
                }
            }
        });
        
        // Handle canvas dirty
        this.nodeEvents.addEventListener('canvasDirty', () => {
            if (this.canvas) {
                this.canvas.dirty_canvas = true;
            }
        });
    }
    
    /**
     * Patch text node to use new system
     */
    patchTextNode() {
        if (typeof TextNode === 'undefined') return;
        
        const originalSetText = TextNode.prototype.setText;
        TextNode.prototype.setText = function(text) {
            // Call original
            const result = originalSetText.call(this, text);
            
            // Use event instead of direct reference
            window.emitNodePropertyUpdate(this, 'text', text);
            
            return result;
        };
    }
    
    /**
     * Patch video node to use new system
     */
    patchVideoNode() {
        if (typeof VideoNode === 'undefined') return;
        
        const originalTogglePlayback = VideoNode.prototype.togglePlayback;
        VideoNode.prototype.togglePlayback = function() {
            // Call original
            const result = originalTogglePlayback.call(this);
            
            // Use event instead of direct reference
            window.emitNodePropertyUpdate(this, 'paused', this.properties.paused);
            
            return result;
        };
    }
    
    /**
     * Create safe serialization method
     */
    safeSerialize(obj) {
        const seen = new WeakSet();
        
        return JSON.stringify(obj, (key, value) => {
            // Skip graph reference
            if (key === 'graph') return undefined;
            
            // Handle circular references
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                    return '[Circular]';
                }
                seen.add(value);
            }
            
            return value;
        });
    }
    
    /**
     * Test the refactor
     */
    test() {
        console.log('\n=== Testing Graph Refactor ===\n');
        
        // Test 1: Check nodes don't have circular references
        const nodes = this.graph.nodes;
        console.log('Node count:', nodes.length);
        
        if (nodes.length > 0) {
            const node = nodes[0];
            console.log('First node has .graph property:', !!node.graph);
            console.log('First node in WeakMap:', this.nodeGraphMap.has(node));
            
            // Test serialization
            try {
                const serialized = this.safeSerialize(node);
                console.log('✅ Node can be serialized');
            } catch (e) {
                console.log('❌ Node serialization failed:', e.message);
            }
        }
        
        // Test 2: Check graph getter works
        if (typeof BaseNode !== 'undefined' && nodes.length > 0) {
            const node = nodes[0];
            const graph = node.graph;
            console.log('Graph getter returns:', graph ? 'Graph instance' : 'null');
        }
        
        console.log('\n✅ Graph refactor test complete');
    }
}

// Initialize if app exists
if (window.app) {
    window.app.graphRefactor = new GraphRefactor();
    window.app.graphRefactor.initialize(window.app);
    
    // Test it
    window.app.graphRefactor.test();
} else {
    console.log('Waiting for app to initialize...');
}

// Export for use
window.GraphRefactor = GraphRefactor;