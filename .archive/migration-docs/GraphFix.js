/**
 * GraphFix - Properly fixes the circular reference issue
 * Instead of modifying global methods, we fix the root cause
 */

(function() {
    console.log('🔧 Applying graph circular reference fix...');
    
    // Wait for graph to be available
    const applyFix = () => {
        if (!window.app?.graph) {
            setTimeout(applyFix, 100);
            return;
        }
        
        const graph = window.app.graph;
        
        // Override the add method to use a WeakMap instead of direct reference
        const nodeGraphMap = new WeakMap();
        const originalAdd = graph.add.bind(graph);
        
        graph.add = function(node) {
            // Call original add first
            const result = originalAdd(node);
            
            // Store the graph reference in WeakMap instead of on the node
            nodeGraphMap.set(node, this);
            
            // Replace the circular reference with a getter that doesn't enumerate
            if (node.graph === this) {
                delete node.graph;
                Object.defineProperty(node, 'graph', {
                    get: function() {
                        return nodeGraphMap.get(this) || null;
                    },
                    set: function(value) {
                        // Silently ignore sets to prevent errors
                        if (value) {
                            nodeGraphMap.set(this, value);
                        }
                    },
                    enumerable: false, // This prevents it from being included in JSON.stringify
                    configurable: true
                });
            }
            
            return result;
        };
        
        // Fix existing nodes
        graph.nodes.forEach(node => {
            if (node.graph === graph) {
                nodeGraphMap.set(node, graph);
                delete node.graph;
                Object.defineProperty(node, 'graph', {
                    get: function() {
                        return nodeGraphMap.get(this) || null;
                    },
                    set: function(value) {
                        // Silently ignore sets to prevent errors
                        if (value) {
                            nodeGraphMap.set(this, value);
                        }
                    },
                    enumerable: false,
                    configurable: true
                });
            }
        });
        
        // Override remove to clean up WeakMap
        const originalRemove = graph.remove.bind(graph);
        graph.remove = function(node) {
            nodeGraphMap.delete(node);
            return originalRemove(node);
        };
        
        console.log('✅ Graph circular reference fixed');
        
        // Test the fix
        if (graph.nodes.length > 0) {
            const testNode = graph.nodes[0];
            console.log('Test node has graph getter:', !!testNode.graph);
            console.log('Graph reference works:', testNode.graph === graph);
            
            try {
                const str = JSON.stringify(testNode);
                console.log('✅ Node can be serialized without circular reference');
            } catch (e) {
                console.error('❌ Serialization still fails:', e.message);
            }
        }
    };
    
    applyFix();
})();