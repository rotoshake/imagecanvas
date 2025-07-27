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
                console.warn('IndexedDB not available - thumbnails will not persist');
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
                    console.log('🗄️ Created IndexedDB thumbnail store');
                }
            };
            
            // Wait for database to open
            this.db = await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            
            this.isAvailable = true;
            console.log('✅ IndexedDB thumbnail store initialized');
            
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
                console.log(`💾 IndexedDB cache hit for ${hash.substring(0, 8)}... (${loadTime.toFixed(1)}ms)`);
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
            
            console.log(`💾 Stored thumbnails for ${hash.substring(0, 8)}... to IndexedDB (${writeTime.toFixed(1)}ms)`);
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
                console.log(`🧹 Cleaned up ${deletedCount} old thumbnail entries`);
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
            
            console.log('🗑️ Cleared all IndexedDB thumbnail data');
        } catch (error) {
            console.error('Failed to clear IndexedDB:', error);
        }
    }
}

// Create singleton instance
window.indexedDBThumbnailStore = new IndexedDBThumbnailStore();

// Debug helper
window.thumbnailStoreStats = () => window.indexedDBThumbnailStore.getStats();