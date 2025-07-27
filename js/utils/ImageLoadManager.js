// ===================================
// IMAGE LOAD MANAGER - REQUEST DEDUPLICATION & THROTTLING
// ===================================

class ImageLoadManager {
    constructor() {
        // Deduplication: track pending loads by hash
        this.pendingLoads = new Map(); // hash -> Promise<Image>
        
        // Connection throttling
        this.loadQueue = [];           // Queue of pending load requests
        this.activeLoads = 0;          // Current concurrent loads
        this.maxConcurrent = 6;        // Browser connection limit
        
        // Performance tracking
        this.stats = {
            totalRequests: 0,
            deduplicatedRequests: 0,
            queuedRequests: 0,
            completedLoads: 0,
            failedLoads: 0,
            concurrentHighWaterMark: 0
        };
        
        // Progress callbacks by hash
        this.progressCallbacks = new Map(); // hash -> Set<callback>
    }
    
    /**
     * Load an image with deduplication and throttling
     * @param {string} hash - Unique hash of the image
     * @param {string} url - URL to load from
     * @param {Function} progressCallback - Optional progress callback
     * @returns {Promise<HTMLImageElement>}
     */
    async loadShared(hash, url, progressCallback = null) {
        this.stats.totalRequests++;
        
        // Check if already loading this hash
        if (this.pendingLoads.has(hash)) {
            this.stats.deduplicatedRequests++;
            
            // Add progress callback to existing load
            if (progressCallback) {
                if (!this.progressCallbacks.has(hash)) {
                    this.progressCallbacks.set(hash, new Set());
                }
                this.progressCallbacks.get(hash).add(progressCallback);
            }
            
            return this.pendingLoads.get(hash);
        }
        
        // Initialize progress callbacks for this hash
        if (progressCallback) {
            this.progressCallbacks.set(hash, new Set([progressCallback]));
        } else {
            this.progressCallbacks.set(hash, new Set());
        }
        
        // Create new load promise with queuing
        const loadPromise = this._queueLoad(hash, url);
        this.pendingLoads.set(hash, loadPromise);
        
        // Clean up when done
        loadPromise.finally(() => {
            this.pendingLoads.delete(hash);
            this.progressCallbacks.delete(hash);
        });
        
        return loadPromise;
    }
    
    /**
     * Queue a load request with connection throttling
     */
    _queueLoad(hash, url) {
        return new Promise((resolve, reject) => {
            const loadRequest = { hash, url, resolve, reject };
            
            // If under limit, start immediately
            if (this.activeLoads < this.maxConcurrent) {
                this._startLoad(loadRequest);
            } else {
                // Queue for later
                this.loadQueue.push(loadRequest);
                this.stats.queuedRequests++;
                console.log(`🔄 Queued load for ${hash.substring(0, 8)}... (${this.loadQueue.length} in queue)`);
            }
        });
    }
    
    /**
     * Start loading an image
     */
    _startLoad(request) {
        this.activeLoads++;
        this.stats.concurrentHighWaterMark = Math.max(this.stats.concurrentHighWaterMark, this.activeLoads);
        
        console.log(`📥 Starting load for ${request.hash.substring(0, 8)}... (${this.activeLoads}/${this.maxConcurrent} active)`);
        
        // Use the optimized loading approach with progress tracking
        this._loadImageWithProgress(request.url, request.hash)
            .then(img => {
                this.stats.completedLoads++;
                request.resolve(img);
            })
            .catch(error => {
                this.stats.failedLoads++;
                console.error(`❌ Failed to load ${request.hash.substring(0, 8)}...`, error);
                request.reject(error);
            })
            .finally(() => {
                this.activeLoads--;
                this._processQueue();
            });
    }
    
    /**
     * Process the queue when a slot becomes available
     */
    _processQueue() {
        if (this.loadQueue.length > 0 && this.activeLoads < this.maxConcurrent) {
            const nextRequest = this.loadQueue.shift();
            this._startLoad(nextRequest);
        }
    }
    
    /**
     * Load image with progress tracking (similar to loadImageAsyncOptimized)
     */
    async _loadImageWithProgress(src, hash) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            
            // Notify all callbacks for this hash
            const notifyProgress = (progress) => {
                const callbacks = this.progressCallbacks.get(hash);
                if (callbacks) {
                    callbacks.forEach(callback => callback(progress));
                }
            };
            
            // Try to track progress if possible
            if (src.startsWith('http')) {
                // For HTTP URLs, we can try to track download progress
                fetch(src, { mode: 'cors' })
                    .then(response => {
                        if (!response.ok) throw new Error('Network response was not ok');
                        
                        const contentLength = response.headers.get('content-length');
                        if (contentLength) {
                            const total = parseInt(contentLength, 10);
                            let loaded = 0;
                            
                            const reader = response.body.getReader();
                            const chunks = [];
                            
                            const pump = () => {
                                return reader.read().then(({ done, value }) => {
                                    if (done) {
                                        // Combine chunks and create blob
                                        const blob = new Blob(chunks);
                                        const blobUrl = URL.createObjectURL(blob);
                                        
                                        // Load the blob URL into the image
                                        img.onload = () => {
                                            URL.revokeObjectURL(blobUrl);
                                            notifyProgress(0.9); // 90% when loaded
                                            
                                            if (img.decode) {
                                                img.decode()
                                                    .then(() => {
                                                        notifyProgress(1.0); // 100% when decoded
                                                        resolve(img);
                                                    })
                                                    .catch(() => {
                                                        notifyProgress(1.0);
                                                        resolve(img);
                                                    });
                                            } else {
                                                notifyProgress(1.0);
                                                resolve(img);
                                            }
                                        };
                                        img.src = blobUrl;
                                        return;
                                    }
                                    
                                    chunks.push(value);
                                    loaded += value.length;
                                    
                                    // Update progress (10% to 80% for download)
                                    notifyProgress(0.1 + (0.7 * (loaded / total)));
                                    
                                    return pump();
                                });
                            };
                            
                            return pump();
                        } else {
                            // No content-length, fall back to simple loading
                            img.onload = () => {
                                notifyProgress(0.9);
                                
                                if (img.decode) {
                                    img.decode()
                                        .then(() => {
                                            notifyProgress(1.0);
                                            resolve(img);
                                        })
                                        .catch(() => {
                                            notifyProgress(1.0);
                                            resolve(img);
                                        });
                                } else {
                                    notifyProgress(1.0);
                                    resolve(img);
                                }
                            };
                            img.src = src;
                        }
                    })
                    .catch(error => {
                        // Fallback to regular image loading if fetch fails
                        console.warn('Fetch failed, falling back to regular image loading:', error);
                        img.onload = () => {
                            notifyProgress(1.0);
                            resolve(img);
                        };
                        img.src = src;
                    });
            } else {
                // For data URLs or other sources, use regular loading
                img.onload = () => {
                    notifyProgress(0.9);
                    
                    if (img.decode) {
                        img.decode()
                            .then(() => {
                                notifyProgress(1.0);
                                resolve(img);
                            })
                            .catch(() => {
                                notifyProgress(1.0);
                                resolve(img);
                            });
                    } else {
                        notifyProgress(1.0);
                        resolve(img);
                    }
                };
                img.src = src;
            }
            
            img.onerror = (error) => {
                reject(error);
            };
            
            // Set crossOrigin and loading hints for better performance
            img.crossOrigin = 'anonymous';
            img.loading = 'eager';
        });
    }
    
    /**
     * Get current stats
     */
    getStats() {
        return {
            ...this.stats,
            currentlyActive: this.activeLoads,
            currentQueueLength: this.loadQueue.length,
            pendingHashes: Array.from(this.pendingLoads.keys())
        };
    }
    
    /**
     * Clear all pending loads (useful for cleanup)
     */
    clearPending() {
        // Reject all queued requests
        this.loadQueue.forEach(request => {
            request.reject(new Error('Load cancelled'));
        });
        this.loadQueue = [];
        
        // Note: We don't cancel in-flight requests as they might be shared
    }
}

// Create singleton instance
window.imageLoadManager = new ImageLoadManager();

// Debug helper
window.imageLoadStats = () => window.imageLoadManager.getStats();