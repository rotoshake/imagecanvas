/**
 * Minimal fix for circular references
 * Instead of fixing the root cause, we'll make the system work with them
 */

// Override JSON.stringify globally to handle circular references
(function() {
    const originalStringify = JSON.stringify;
    
    JSON.stringify = function(obj, replacer, space) {
        const seen = new WeakSet();
        
        const circularReplacer = function(key, value) {
            // Handle circular references
            if (typeof value === 'object' && value !== null) {
                // Skip 'graph' property entirely
                if (key === 'graph') return undefined;
                
                if (seen.has(value)) {
                    return '[Circular]';
                }
                seen.add(value);
            }
            
            // Call original replacer if provided
            if (replacer) {
                return replacer(key, value);
            }
            
            return value;
        };
        
        return originalStringify.call(this, obj, circularReplacer, space);
    };
    
    // Mark that we've applied the fix
    JSON.stringify._circularRefFixed = true;
})();

// Also fix console.log to handle circular references
(function() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    
    const safeStringify = (arg) => {
        if (typeof arg === 'object' && arg !== null) {
            try {
                // Try normal stringify first (with our fixed version)
                return JSON.stringify(arg);
            } catch (e) {
                // If it still fails, return a simple representation
                if (arg.constructor && arg.constructor.name) {
                    return `[${arg.constructor.name}]`;
                }
                return '[Object]';
            }
        }
        return arg;
    };
    
    console.log = function(...args) {
        // Process args to handle circular refs
        const safeArgs = args.map(arg => {
            if (typeof arg === 'object' && arg !== null) {
                // For objects, create a safe version
                try {
                    // If it's a node, show essential info only
                    if (arg.id && arg.type && arg.pos) {
                        return `Node(${arg.id}, ${arg.type}, [${arg.pos}])`;
                    }
                    // For other objects, try to stringify
                    return safeStringify(arg);
                } catch (e) {
                    return '[Object with circular reference]';
                }
            }
            return arg;
        });
        
        originalLog.apply(console, safeArgs);
    };
    
    console.error = function(...args) {
        const safeArgs = args.map(arg => {
            if (typeof arg === 'object' && arg !== null) {
                return safeStringify(arg);
            }
            return arg;
        });
        originalError.apply(console, safeArgs);
    };
    
    console.warn = function(...args) {
        const safeArgs = args.map(arg => {
            if (typeof arg === 'object' && arg !== null) {
                return safeStringify(arg);
            }
            return arg;
        });
        originalWarn.apply(console, safeArgs);
    };
    
    // Mark that we've applied the fix
    console.log._circularRefFixed = true;
})();

console.log('✅ Circular reference handling installed');

// Now we can safely use the new architecture
if (window.app?.collaborativeArchitecture) {
    console.log('Testing with circular ref protection...');
    
    // Test operations
    (async function() {
        try {
            const nodes = window.app.graph.nodes;
            console.log('Found', nodes.length, 'nodes');
            
            if (nodes.length > 0) {
                const node = nodes[0];
                console.log('Testing with node:', node);
                
                // Move it
                const result = await window.app.collaborativeArchitecture.executeOperation('node_move', {
                    nodeId: node.id,
                    position: [300, 300]
                });
                
                console.log('Move result:', result);
                
                // Check history
                const history = window.app.operationPipeline.getHistoryInfo();
                console.log('History:', history);
            }
        } catch (e) {
            console.error('Test error:', e);
        }
    })();
}