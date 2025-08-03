/**
 * ThumbnailRequestCoordinator - Centralizes and coordinates all thumbnail requests
 * Prevents duplicate requests and manages priorities
 */
class ThumbnailRequestCoordinator {
    constructor() {
        this.activeRequests = new Map(); // requestKey -> { promise, timestamp, requesters }
        this.requestQueue = []; // Priority queue of pending requests
        this.maxConcurrentRequests = 4;
        this.requestTimeout = 30000; // 30 seconds
        
        // Track which components are interested in which hashes
        this.hashSubscribers = new Map(); // hash -> Set of subscriber IDs
    }
    
    /**
     * Request a thumbnail with deduplication
     * @param {string} hash - Image hash
     * @param {string} serverFilename - Server filename
     * @param {number} size - Thumbnail size
     * @param {string} requesterId - ID of the requesting component
     * @returns {Promise<boolean>} - Success status
     */
    async requestThumbnail(hash, serverFilename, size, requesterId = 'unknown') {
        const requestKey = `${hash}_${size}`;
        
        // Register this requester as interested in this hash
        if (!this.hashSubscribers.has(hash)) {
            this.hashSubscribers.set(hash, new Set());
        }
        this.hashSubscribers.get(hash).add(requesterId);
        
        // Check if request is already active
        const activeRequest = this.activeRequests.get(requestKey);
        if (activeRequest) {
            // console.log(`📎 Reusing active request for ${hash.substring(0, 8)} (${size}px)`);
            activeRequest.requesters.add(requesterId);
            return activeRequest.promise;
        }
        
        // Create new request
        // console.log(`🆕 Creating new request for ${hash.substring(0, 8)} (${size}px)`);
        
        const promise = this._executeRequest(hash, serverFilename, size, requestKey);
        this.activeRequests.set(requestKey, {
            promise,
            timestamp: Date.now(),
            requesters: new Set([requesterId])
        });
        
        // Clean up when done
        promise.finally(() => {
            this.activeRequests.delete(requestKey);
        });
        
        return promise;
    }
    
    /**
     * Execute the actual thumbnail request
     * @private
     */
    async _executeRequest(hash, serverFilename, size, requestKey) {
        try {
            // Use the thumbnail cache to load from server
            if (window.thumbnailCache && window.thumbnailCache.loadServerThumbnails) {
                const success = await window.thumbnailCache.loadServerThumbnails(hash, serverFilename, [size]);
                
                if (success) {
                    // console.log(`✅ Thumbnail ${size}px loaded for ${hash.substring(0, 8)}`);
                    this._notifySubscribers(hash);
                }
                
                return success;
            }
            
            return false;
        } catch (error) {
            console.error(`❌ Failed to load thumbnail ${size}px for ${hash.substring(0, 8)}:`, error);
            return false;
        }
    }
    
    /**
     * Notify all subscribers that a hash has been updated
     * @private
     */
    _notifySubscribers(hash) {
        const subscribers = this.hashSubscribers.get(hash);
        if (!subscribers || subscribers.size === 0) return;
        
        // console.log(`🔔 Notifying ${subscribers.size} subscribers about ${hash.substring(0, 8)}`);
        
        // Force all nodes with this hash to update
        if (window.app?.graph?.nodes) {
            let nodesUpdated = 0;
            for (const node of window.app.graph.nodes) {
                if (node.properties?.hash === hash) {
                    // Clear render cache
                    const nodeId = node.id || `${node.properties.hash}_${node.pos[0]}_${node.pos[1]}`;
                    
                    // Clear from WebGL renderer cache
                    if (window.app.graphCanvas?.webglRenderer) {
                        const renderer = window.app.graphCanvas.webglRenderer;
                        renderer.renderedNodes.delete(nodeId);
                        
                        // Force LOD recalculation
                        renderer.lodCache.delete(nodeId);
                        
                        // Clear texture request cache to allow immediate re-request
                        renderer.lastTextureRequest.delete(nodeId);
                        
                        // Also clear any pending requests for this node
                        for (const [key, ] of renderer.pendingServerRequests) {
                            if (key.startsWith(hash)) {
                                renderer.pendingServerRequests.delete(key);
                            }
                        }
                    }
                    
                    node.needsGLUpdate = true;
                    nodesUpdated++;
                }
            }
            
            if (nodesUpdated > 0) {
                // console.log(`🔄 Force-updated ${nodesUpdated} nodes with cleared caches`);
                
                // Force immediate redraw
                if (window.app.graphCanvas) {
                    window.app.graphCanvas.dirty_canvas = true;
                    window.app.graphCanvas.dirty_bgcanvas = true;
                    
                    // Force a render on next frame
                    requestAnimationFrame(() => {
                        if (window.app.graphCanvas) {
                            window.app.graphCanvas.draw();
                        }
                    });
                }
            }
        }
    }
    
    /**
     * Clean up old requests
     */
    cleanup() {
        const now = Date.now();
        for (const [key, request] of this.activeRequests) {
            if (now - request.timestamp > this.requestTimeout) {
                // console.warn(`⏰ Request timeout for ${key}`);
                this.activeRequests.delete(key);
            }
        }
    }
}

// Create global instance
window.thumbnailRequestCoordinator = new ThumbnailRequestCoordinator();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThumbnailRequestCoordinator;
}