// ===================================
// LOD (Level of Detail) Cache System
// ===================================

/**
 * Cache for LOD decisions to avoid recalculation during render
 */
class LODCache {
    constructor() {
        this.cache = new Map(); // nodeId -> LOD decision
        this.lastViewport = null;
        this.lastScale = null;
        this.cacheTimeout = 100; // ms - cache validity period
        this.lastUpdate = 0;
        
        // Hysteresis to prevent LOD thrashing
        this.hysteresisRange = 0.15; // 15% scale change required to switch LOD
        this.previousDecisions = new Map(); // nodeId -> previous LOD level
    }
    
    /**
     * Get LOD decision for a node
     * @param {Object} node - The image node
     * @param {number} screenWidth - Node width on screen
     * @param {number} screenHeight - Node height on screen
     * @param {number} scale - Current viewport scale
     * @returns {Object} LOD decision { size, source }
     */
    getLOD(node, screenWidth, screenHeight, scale) {
        const nodeId = node.id;
        const now = Date.now();
        
        // Check if viewport has changed significantly
        if (this.lastScale && Math.abs(scale - this.lastScale) < 0.01 && 
            (now - this.lastUpdate) < this.cacheTimeout) {
            // Use cached decision
            const cached = this.cache.get(nodeId);
            if (cached) {
                return cached;
            }
        }
        
        // Calculate new LOD decision
        const decision = this._calculateLOD(node, screenWidth, screenHeight, scale);
        
        // Apply hysteresis to prevent thrashing
        const previous = this.previousDecisions.get(nodeId);
        if (previous && previous.size !== decision.size) {
            // For upgrades (zooming in), always allow if we're requesting higher quality
            if (decision.size > previous.size) {
                // Always allow quality upgrades when zooming in
                if (window.DEBUG_LOD_STATUS) {
                    console.log(`🔼 LOD upgrade allowed: ${previous.size}px → ${decision.size}px for screen size ${Math.round(decision.screenSize)}px`);
                }
                this.cache.set(nodeId, decision);
                this.previousDecisions.set(nodeId, decision);
                return decision;
            }
            
            // For downgrades (zooming out), apply hysteresis to prevent thrashing
            const scaleRatio = previous.size / decision.size;
            if (scaleRatio < (1 + this.hysteresisRange)) {
                // Keep previous (higher quality) decision - change not significant enough
                this.cache.set(nodeId, previous);
                return previous;
            }
        }
        
        // Cache the new decision
        this.cache.set(nodeId, decision);
        this.previousDecisions.set(nodeId, decision);
        
        return decision;
    }
    
    /**
     * Calculate LOD decision for a node
     * @private
     */
    _calculateLOD(node, screenWidth, screenHeight, scale) {
        const maxScreenDimension = Math.max(screenWidth, screenHeight);
        
        // Determine LOD based on screen size
        let targetSize;
        let source = 'thumbnail';
        
        if (maxScreenDimension < 50) {
            targetSize = 64;
        } else if (maxScreenDimension < 100) {
            targetSize = 128;
        } else if (maxScreenDimension < 200) {
            targetSize = 256;
        } else if (maxScreenDimension < 400) {
            targetSize = 512;
        } else if (maxScreenDimension < 800) {
            targetSize = 1024;
        } else if (maxScreenDimension < 1600) {
            targetSize = 2048;
        } else {
            // Use full resolution
            targetSize = Math.max(node.originalWidth || 0, node.originalHeight || 0);
            source = 'full';
        }
        
        return {
            size: targetSize,
            source: source,
            scale: scale,
            screenSize: maxScreenDimension
        };
    }
    
    /**
     * Invalidate cache (e.g., on viewport change)
     */
    invalidate() {
        const now = Date.now();
        this.lastUpdate = now;
    }
    
    /**
     * Clear cache for specific node
     */
    clearNode(nodeId) {
        this.cache.delete(nodeId);
        this.previousDecisions.delete(nodeId);
    }
    
    /**
     * Clear entire cache
     */
    clear() {
        this.cache.clear();
        this.previousDecisions.clear();
        this.lastViewport = null;
        this.lastScale = null;
        this.lastUpdate = 0;
    }
    
    /**
     * Update viewport info for cache validation
     */
    updateViewport(scale, offset) {
        // Check if viewport changed significantly
        if (!this.lastScale || Math.abs(scale - this.lastScale) > 0.05) {
            this.invalidate();
        }
        
        this.lastScale = scale;
        this.lastViewport = { scale, offset };
    }
    
    /**
     * Get cache statistics
     */
    getStats() {
        return {
            cachedDecisions: this.cache.size,
            previousDecisions: this.previousDecisions.size,
            lastScale: this.lastScale,
            lastUpdate: this.lastUpdate
        };
    }
}

// Export globally
if (typeof window !== 'undefined') {
    window.LODCache = LODCache;
}