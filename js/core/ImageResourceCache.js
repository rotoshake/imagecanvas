/**
 * ImageResourceCache - Client-side cache for deduplicating image resources
 * 
 * This cache prevents re-uploading the same image multiple times by tracking:
 * 1. File hashes to server URLs
 * 2. Thumbnails for each image
 * 3. Original file data for quick access
 */
class ImageResourceCache {
    constructor() {
        // Core mappings
        this.hashToUrl = new Map();           // hash -> server URL
        this.hashToThumbnail = new Map();     // hash -> thumbnail data URL
        this.hashToServerFilename = new Map(); // hash -> server filename
        this.hashToOriginalFilename = new Map(); // hash -> original filename
        
        // Reference counting for cleanup
        this.hashRefCount = new Map();        // hash -> reference count
        
        // Performance tracking
        this.stats = {
            hits: 0,
            misses: 0,
            bytesSaved: 0
        };
        
    }
    
    /**
     * Check if we have a cached version of this image
     */
    has(hash) {
        return this.hashToUrl.has(hash);
    }
    
    /**
     * Get cached image data
     */
    get(hash) {
        if (!this.has(hash)) {
            this.stats.misses++;
            return null;
        }
        
        this.stats.hits++;
        return {
            url: this.hashToUrl.get(hash),
            serverFilename: this.hashToServerFilename.get(hash),
            thumbnail: this.hashToThumbnail.get(hash),
            originalFilename: this.hashToOriginalFilename.get(hash),
            cached: true
        };
    }
    
    /**
     * Store image data in cache
     */
    set(hash, data) {
        this.hashToUrl.set(hash, data.url);
        this.hashToServerFilename.set(hash, data.serverFilename);
        if (data.thumbnail) {
            this.hashToThumbnail.set(hash, data.thumbnail);
        }
        if (data.originalFilename) {
            this.hashToOriginalFilename.set(hash, data.originalFilename);
        }
        
        // Initialize or increment reference count
        const currentCount = this.hashRefCount.get(hash) || 0;
        this.hashRefCount.set(hash, currentCount + 1);
        
                    if (window.Logger.isEnabled('CACHE_OPERATIONS')) {
                window.Logger.cache('debug', `💾 Cached image: ${hash.substring(0, 8)}... (refs: ${currentCount + 1})`);
            }
    }
    
    /**
     * Increment reference count for a hash
     */
    addReference(hash) {
        if (!this.has(hash)) return;
        
        const currentCount = this.hashRefCount.get(hash) || 0;
        this.hashRefCount.set(hash, currentCount + 1);
        console.log(`📈 Added reference to ${hash.substring(0, 8)}... (refs: ${currentCount + 1})`);
    }
    
    /**
     * Decrement reference count and potentially clean up
     */
    removeReference(hash) {
        if (!this.has(hash)) return;
        
        const currentCount = this.hashRefCount.get(hash) || 1;
        const newCount = currentCount - 1;
        
        if (newCount <= 0) {
            // No more references, safe to remove from cache
            this.hashToUrl.delete(hash);
            this.hashToThumbnail.delete(hash);
            this.hashToServerFilename.delete(hash);
            this.hashToOriginalFilename.delete(hash);
            this.hashRefCount.delete(hash);
            console.log(`🗑️ Removed ${hash.substring(0, 8)}... from cache (no references)`);
        } else {
            this.hashRefCount.set(hash, newCount);
            console.log(`📉 Removed reference from ${hash.substring(0, 8)}... (refs: ${newCount})`);
        }
    }
    
    /**
     * Get cache statistics
     */
    getStats() {
        const totalCached = this.hashToUrl.size;
        const hitRate = this.stats.hits + this.stats.misses > 0 ? 
            (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(1) : 0;
        
        return {
            totalCached,
            hits: this.stats.hits,
            misses: this.stats.misses,
            hitRate: `${hitRate}%`,
            estimatedBytesSaved: this.formatBytes(this.stats.bytesSaved)
        };
    }
    
    /**
     * Track bytes saved by using cache
     */
    trackBytesSaved(bytes) {
        this.stats.bytesSaved += bytes;
    }
    
    /**
     * Format bytes for display
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    /**
     * Clear the entire cache
     */
    clear() {
        this.hashToUrl.clear();
        this.hashToThumbnail.clear();
        this.hashToServerFilename.clear();
        this.hashToOriginalFilename.clear();
        this.hashRefCount.clear();
        this.stats = {
            hits: 0,
            misses: 0,
            bytesSaved: 0
        };
        console.log('🧹 ImageResourceCache cleared');
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ImageResourceCache;
} else if (typeof window !== 'undefined') {
    window.ImageResourceCache = ImageResourceCache;
}