// ===================================
// INDEXEDDB THUMBNAIL STORE - PERSISTENT CACHING
// ===================================

class IndexedDBThumbnailStore {
    constructor() {
        this.dbName = 'ImageCanvasThumbnails';
        this.dbVersion = 1;
        this.storeName = 'thumbnails';
        this.db = null;
        this.isAvailable = false;
        this.initPromise = this._init();
        
        // Performance tracking
        this.stats = {
            hits: 0,
            misses: 0,
            writes: 0,
            deletes: 0,
            errors: 0,
            totalLoadTime: 0,
            totalWriteTime: 0
        };
    }
    
    async _init() {
        try {
            // Check if IndexedDB is available
            if (!window.indexedDB) {
                
                this.isAvailable = false;
                return false;
            }
            
            // Open database
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            // Handle database upgrade
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create thumbnails store if it doesn't exist
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'hash' });
                    // Create indexes for efficient queries
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('serverFilename', 'serverFilename', { unique: false });
                    
                }
            };
            
            // Wait for database to open
            this.db = await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            
            this.isAvailable = true;
            
            // Clean up old entries periodically
            this._scheduleCleanup();
            
            return true;
        } catch (error) {
            console.error('Failed to initialize IndexedDB:', error);
            this.isAvailable = false;
            return false;
        }
    }
    
    /**
     * Ensure database is ready before operations
     */
    async _ensureReady() {
        await this.initPromise;
        if (!this.isAvailable || !this.db) {
            throw new Error('IndexedDB not available');
        }
    }
    
    /**
     * Get thumbnail data from IndexedDB
     * @param {string} hash - Image hash
     * @returns {Promise<Object|null>} Thumbnail data or null if not found
     */
    async get(hash) {
        const startTime = performance.now();
        
        try {
            await this._ensureReady();
            
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(hash);
            
            const result = await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            
            const loadTime = performance.now() - startTime;
            this.stats.totalLoadTime += loadTime;
            
            if (result) {
                this.stats.hits++;
                return result;
            } else {
                this.stats.misses++;
                return null;
            }
        } catch (error) {
            this.stats.errors++;
            console.error('IndexedDB get error:', error);
            return null;
        }
    }
    
    /**
     * Store thumbnail data in IndexedDB
     * @param {string} hash - Image hash
     * @param {Object} thumbnails - Object with size keys and blob values
     * @param {string} serverFilename - Optional server filename
     */
    async set(hash, thumbnails, serverFilename = null) {
        const startTime = performance.now();
        
        try {
            await this._ensureReady();
            
            // Convert canvas thumbnails to blobs
            const blobThumbnails = {};
            for (const [size, canvas] of Object.entries(thumbnails)) {
                if (canvas instanceof HTMLCanvasElement) {
                    const blob = await this._canvasToBlob(canvas);
                    blobThumbnails[size] = blob;
                } else if (canvas instanceof Blob) {
                    blobThumbnails[size] = canvas;
                }
            }
            
            const data = {
                hash,
                thumbnails: blobThumbnails,
                timestamp: Date.now(),
                serverFilename,
                version: this.dbVersion
            };
            
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(data);
            
            await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
            
            const writeTime = performance.now() - startTime;
            this.stats.writes++;
            this.stats.totalWriteTime += writeTime;
            
        } catch (error) {
            this.stats.errors++;
            console.error('IndexedDB set error:', error);
        }
    }
    
    /**
     * Check if thumbnails exist for a hash
     * @param {string} hash - Image hash
     * @returns {Promise<boolean>}
     */
    async has(hash) {
        try {
            await this._ensureReady();
            
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.count(hash);
            
            const count = await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            
            return count > 0;
        } catch (error) {
            console.error('IndexedDB has error:', error);
            return false;
        }
    }
    
    /**
     * Delete thumbnails for a hash
     * @param {string} hash - Image hash
     */
    async delete(hash) {
        try {
            await this._ensureReady();
            
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(hash);
            
            await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
            
            this.stats.deletes++;
            console.log(`🗑️ Deleted thumbnails for ${hash.substring(0, 8)}... from IndexedDB`);
        } catch (error) {
            this.stats.errors++;
            console.error('IndexedDB delete error:', error);
        }
    }
    
    /**
     * Get all stored hashes
     * @returns {Promise<string[]>}
     */
    async getAllHashes() {
        try {
            await this._ensureReady();
            
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAllKeys();
            
            return await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('IndexedDB getAllHashes error:', error);
            return [];
        }
    }
    
    /**
     * Convert canvas to blob - using dataURL as intermediate to ensure alpha preservation
     */
    _canvasToBlob(canvas) {
        return new Promise((resolve, reject) => {
            try {
                // Use toDataURL to ensure alpha is preserved
                const dataURL = canvas.toDataURL('image/png');
                
                // Convert dataURL to blob
                fetch(dataURL)
                    .then(res => res.blob())
                    .then(blob => {
                        resolve(blob);
                    })
                    .catch(reject);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    /**
     * Convert blob back to canvas
     */
    async _blobToCanvas(blob) {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        
        try {
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = url;
            });
            
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            
            // Simply draw the image - default composite operation preserves alpha
            ctx.drawImage(img, 0, 0);
            
            return canvas;
        } finally {
            URL.revokeObjectURL(url);
        }
    }
    
    /**
     * Load thumbnails and convert blobs back to canvases
     */
    async getThumbnails(hash) {
        const data = await this.get(hash);
        if (!data || !data.thumbnails) return null;
        
        const canvasThumbnails = {};
        
        // Convert blobs back to canvases
        for (const [size, blob] of Object.entries(data.thumbnails)) {
            try {
                canvasThumbnails[size] = await this._blobToCanvas(blob);
            } catch (error) {
                console.error(`Failed to convert thumbnail ${size} for ${hash}:`, error);
            }
        }
        
        return Object.keys(canvasThumbnails).length > 0 ? canvasThumbnails : null;
    }
    
    /**
     * Clean up old entries (older than 30 days)
     */
    async _cleanup() {
        try {
            await this._ensureReady();
            
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('timestamp');
            const range = IDBKeyRange.upperBound(thirtyDaysAgo);
            
            const request = index.openCursor(range);
            let deletedCount = 0;
            
            await new Promise((resolve, reject) => {
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        store.delete(cursor.value.hash);
                        deletedCount++;
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                request.onerror = () => reject(request.error);
            });
            
            if (deletedCount > 0) {
                
            }
        } catch (error) {
            console.error('Cleanup error:', error);
        }
    }
    
    /**
     * Schedule periodic cleanup
     */
    _scheduleCleanup() {
        // Run cleanup on startup
        setTimeout(() => this._cleanup(), 5000);
        
        // Run cleanup every 24 hours
        setInterval(() => this._cleanup(), 24 * 60 * 60 * 1000);
    }
    
    /**
     * Get storage statistics
     */
    async getStorageInfo() {
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const estimate = await navigator.storage.estimate();
                return {
                    usage: estimate.usage,
                    quota: estimate.quota,
                    percent: ((estimate.usage / estimate.quota) * 100).toFixed(2)
                };
            }
        } catch (error) {
            console.error('Failed to get storage info:', error);
        }
        return null;
    }
    
    /**
     * Get performance statistics
     */
    getStats() {
        return {
            ...this.stats,
            hitRate: this.stats.hits + this.stats.misses > 0 
                ? ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(1) + '%'
                : '0%',
            avgLoadTime: this.stats.hits > 0 
                ? (this.stats.totalLoadTime / this.stats.hits).toFixed(1) + 'ms'
                : '0ms',
            avgWriteTime: this.stats.writes > 0
                ? (this.stats.totalWriteTime / this.stats.writes).toFixed(1) + 'ms'
                : '0ms'
        };
    }
    
    /**
     * Store preview-specific data (temporary or permanent)
     * @param {string} hash - Image hash (could be temporary)
     * @param {number} size - Preview size
     * @param {string|Blob} previewData - Preview URL or blob
     * @param {boolean} isTemporary - Whether this is temporary preview data
     */
    async setPreview(hash, size, previewData, isTemporary = false) {
        if (isTemporary) {
            // For temporary previews, use in-memory cache
            if (!this.tempPreviewCache) {
                this.tempPreviewCache = new Map();
            }
            
            if (!this.tempPreviewCache.has(hash)) {
                this.tempPreviewCache.set(hash, {});
            }
            
            this.tempPreviewCache.get(hash)[size] = previewData;
            return;
        }
        
        // For permanent previews, use IndexedDB
        try {
            await this._ensureReady();
            
            // Get existing data or create new
            let data = await this.get(hash);
            if (!data) {
                data = {
                    hash,
                    thumbnails: {},
                    timestamp: Date.now(),
                    version: this.dbVersion
                };
            }
            
            // Add/update the preview
            if (previewData instanceof Blob) {
                data.thumbnails[size] = previewData;
            } else if (typeof previewData === 'string' && previewData.startsWith('blob:')) {
                // Convert blob URL to actual blob
                try {
                    const response = await fetch(previewData);
                    data.thumbnails[size] = await response.blob();
                } catch (error) {
                    
                    return;
                }
            }
            
            // Store updated data
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(data);
            
            await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
            
        } catch (error) {
            console.error('Failed to set preview:', error);
        }
    }
    
    /**
     * Get preview for specific size
     * @param {string} hash - Image hash
     * @param {number} size - Preview size
     * @returns {Promise<string|null>} Preview URL or null
     */
    async getPreview(hash, size) {
        // Check temporary cache first
        if (this.tempPreviewCache && this.tempPreviewCache.has(hash)) {
            const tempPreviews = this.tempPreviewCache.get(hash);
            if (tempPreviews[size]) {
                return tempPreviews[size];
            }
        }
        
        // Check IndexedDB
        try {
            const data = await this.get(hash);
            if (data && data.thumbnails && data.thumbnails[size]) {
                // Convert blob to URL
                return URL.createObjectURL(data.thumbnails[size]);
            }
        } catch (error) {
            console.error('Failed to get preview:', error);
        }
        
        return null;
    }
    
    /**
     * Update hash mapping for temporary previews (when real hash becomes available)
     * @param {string} tempHash - Temporary hash
     * @param {string} realHash - Real image hash
     */
    updatePreviewHash(tempHash, realHash) {
        if (!this.tempPreviewCache || !this.tempPreviewCache.has(tempHash)) {
            return;
        }
        
        const tempPreviews = this.tempPreviewCache.get(tempHash);
        this.tempPreviewCache.set(realHash, tempPreviews);
        this.tempPreviewCache.delete(tempHash);

    }
    
    /**
     * Clean up temporary preview cache
     */
    cleanupTempPreviews() {
        if (this.tempPreviewCache) {
            // Revoke object URLs to prevent memory leaks
            for (const [hash, previews] of this.tempPreviewCache) {
                for (const [size, url] of Object.entries(previews)) {
                    if (typeof url === 'string' && url.startsWith('blob:')) {
                        URL.revokeObjectURL(url);
                    }
                }
            }
            this.tempPreviewCache.clear();
        }
    }

    /**
     * Clear all data (use with caution!)
     */
    async clear() {
        try {
            await this._ensureReady();
            
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();
            
            await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            // Also clean up temporary previews
            this.cleanupTempPreviews();
        } catch (error) {
            console.error('Failed to clear IndexedDB:', error);
        }
    }
}

// Create singleton instance
window.indexedDBThumbnailStore = new IndexedDBThumbnailStore();

// Debug helper
window.thumbnailStoreStats = () => window.indexedDBThumbnailStore.getStats();