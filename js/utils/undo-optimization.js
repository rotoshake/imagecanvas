/**
 * Utility functions for optimizing undo data storage
 * Prevents large base64 image data from being stored in undo operations
 */

class UndoOptimization {
    /**
     * Optimize node properties for undo storage
     * Removes large data URLs while preserving references
     */
    static optimizeNodeProperties(node) {
        if (!node || !node.properties) {
            return node?.properties || {};
        }
        
        // For non-media nodes, return properties as-is
        if (node.type !== 'media/image' && node.type !== 'media/video') {
            return { ...node.properties };
        }
        
        // For media nodes, optimize the properties
        const props = { ...node.properties };
        
        // Check if we have a data URL that needs optimization
        if (props.src && props.src.startsWith('data:')) {
            const originalSize = props.src.length;
            
            // Case 1: We have a serverUrl - use it as reference
            if (props.serverUrl) {
                console.log(`🗜️ Optimizing undo data: removing ${(originalSize/1024/1024).toFixed(2)}MB data URL, keeping serverUrl`);
                return {
                    serverUrl: props.serverUrl,
                    serverFilename: props.serverFilename,
                    hash: props.hash,
                    filename: props.filename,
                    _hadDataUrl: true
                };
            }
            
            // Case 2: We have a hash - can restore from cache
            if (props.hash) {
                console.log(`🗜️ Optimizing undo data: removing ${(originalSize/1024/1024).toFixed(2)}MB data URL, keeping hash reference`);
                return {
                    hash: props.hash,
                    filename: props.filename,
                    _hadDataUrl: true,
                    _needsCacheRestore: true
                };
            }
            
            // Case 3: Large data URL with no optimization available
            if (originalSize > 100 * 1024) { // > 100KB
                console.warn(`⚠️ Large unoptimized image in undo: ${(originalSize/1024/1024).toFixed(2)}MB. Stripping to prevent issues.`);
                return {
                    filename: props.filename,
                    _hadDataUrl: true,
                    _stripped: true,
                    _originalSize: originalSize
                };
            }
        }
        
        // Return properties as-is if no optimization needed
        return props;
    }
    
    /**
     * Optimize node data for undo storage
     * Creates a clean copy with optimized properties
     */
    static optimizeNodeData(node) {
        if (!node) return null;
        
        return {
            id: node.id,
            type: node.type,
            pos: [...node.pos],
            size: [...node.size],
            properties: this.optimizeNodeProperties(node),
            rotation: node.rotation || 0,
            flags: node.flags ? { ...node.flags } : {},
            title: node.title,
            aspectRatio: node.aspectRatio
        };
    }
    
    /**
     * Optimize an array of nodes for undo storage
     */
    static optimizeNodeArray(nodes) {
        if (!Array.isArray(nodes)) return [];
        return nodes.map(node => this.optimizeNodeData(node));
    }
    
    /**
     * Calculate the size reduction from optimization
     */
    static calculateOptimization(originalNode, optimizedNode) {
        const originalSize = JSON.stringify(originalNode).length;
        const optimizedSize = JSON.stringify(optimizedNode).length;
        const reduction = originalSize - optimizedSize;
        const percentage = (reduction / originalSize * 100).toFixed(1);
        
        return {
            originalSize,
            optimizedSize,
            reduction,
            percentage,
            originalMB: (originalSize / 1024 / 1024).toFixed(2),
            optimizedKB: (optimizedSize / 1024).toFixed(2)
        };
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.UndoOptimization = UndoOptimization;
}