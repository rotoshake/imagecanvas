// ===================================
// OFFSCREEN RENDER CACHE
// High-performance rendering cache using off-screen canvases
// ===================================

class OffscreenRenderCache {
    constructor() {
        // Cache structure: nodeId -> { canvas, hash, scale, lastUsed }
        this.cache = new Map();
        this.maxCacheSize = 50; // Maximum cached renders
        this.minScaleRatio = 0.5; // Reuse if scale within 50-200% of cached
        this.maxScaleRatio = 2.0;
        
        // Performance tracking
        this.stats = {
            hits: 0,
            misses: 0,
            renders: 0,
            evictions: 0
        };
        
        // Cleanup interval
        this.cleanupInterval = 30000; // 30 seconds
        this.lastCleanup = Date.now();

    }
    
    /**
     * Get or create a cached render for a node
     * @param {Object} node - The node to render
     * @param {number} scale - Current viewport scale
     * @param {Function} renderCallback - Function to render the node
     * @returns {HTMLCanvasElement|null} The cached canvas or null
     */
    getCachedRender(node, scale, renderCallback) {
        if (!node || !node.id) return null;
        
        const cached = this.cache.get(node.id);
        
        // Check if we have a valid cached render
        if (cached) {
            const scaleRatio = scale / cached.scale;
            
            // Reuse if scale hasn't changed too much
            if (scaleRatio >= this.minScaleRatio && scaleRatio <= this.maxScaleRatio) {
                // Update last used time
                cached.lastUsed = Date.now();
                this.stats.hits++;
                return cached.canvas;
            }
        }
        
        // Need to create new render
        this.stats.misses++;
        return this.createCachedRender(node, scale, renderCallback);
    }
    
    /**
     * Create a new cached render
     */
    createCachedRender(node, scale, renderCallback) {
        try {
            // Create offscreen canvas
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { 
                alpha: true,
                desynchronized: true,
                willReadFrequently: false // Force GPU acceleration
            });
            
            if (!ctx) return null;
            
            // Set canvas size based on node size and scale
            // Use a reasonable scale factor to balance quality and memory
            const renderScale = Math.min(scale, 2.0); // Cap at 2x for memory efficiency
            canvas.width = Math.ceil(node.size[0] * renderScale);
            canvas.height = Math.ceil(node.size[1] * renderScale);
            
            // Scale context for rendering
            ctx.scale(renderScale, renderScale);
            
            // Clear canvas
            ctx.clearRect(0, 0, node.size[0], node.size[1]);
            
            // Render node content
            if (renderCallback) {
                renderCallback(ctx, node);
            }
            
            // Cache the rendered canvas
            const cacheEntry = {
                canvas: canvas,
                scale: scale,
                renderScale: renderScale,
                hash: this.getNodeHash(node),
                lastUsed: Date.now()
            };
            
            // Evict old entries if needed
            if (this.cache.size >= this.maxCacheSize) {
                this.evictOldest();
            }
            
            this.cache.set(node.id, cacheEntry);
            this.stats.renders++;
            
            // Periodic cleanup
            if (Date.now() - this.lastCleanup > this.cleanupInterval) {
                this.cleanup();
            }
            
            return canvas;
        } catch (error) {
            console.error('Failed to create cached render:', error);
            return null;
        }
    }
    
    /**
     * Invalidate cache for a specific node
     */
    invalidate(nodeId) {
        if (this.cache.has(nodeId)) {
            this.cache.delete(nodeId);
        }
    }
    
    /**
     * Invalidate cache for nodes that have changed
     */
    invalidateChanged(node) {
        const cached = this.cache.get(node.id);
        if (cached) {
            const currentHash = this.getNodeHash(node);
            if (currentHash !== cached.hash) {
                this.invalidate(node.id);
            }
        }
    }
    
    /**
     * Get a hash representing the node's visual state
     */
    getNodeHash(node) {
        // Simple hash based on properties that affect rendering
        return `${node.size[0]}_${node.size[1]}_${node.properties?.hash || ''}_${node.rotation || 0}`;
    }
    
    /**
     * Evict the oldest cached entry
     */
    evictOldest() {
        let oldestTime = Infinity;
        let oldestKey = null;
        
        for (const [key, entry] of this.cache) {
            if (entry.lastUsed < oldestTime) {
                oldestTime = entry.lastUsed;
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            this.cache.delete(oldestKey);
            this.stats.evictions++;
        }
    }
    
    /**
     * Clean up unused cache entries
     */
    cleanup() {
        const now = Date.now();
        const maxAge = 60000; // 1 minute
        
        for (const [key, entry] of this.cache) {
            if (now - entry.lastUsed > maxAge) {
                this.cache.delete(key);
                this.stats.evictions++;
            }
        }
        
        this.lastCleanup = now;
    }
    
    /**
     * Clear entire cache
     */
    clear() {
        this.cache.clear();
        this.stats = {
            hits: 0,
            misses: 0,
            renders: 0,
            evictions: 0
        };
    }
    
    /**
     * Get cache statistics
     */
    getStats() {
        const hitRate = this.stats.hits + this.stats.misses > 0 
            ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(1)
            : 0;
            
        return {
            ...this.stats,
            size: this.cache.size,
            hitRate: `${hitRate}%`
        };
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.OffscreenRenderCache = OffscreenRenderCache;
}