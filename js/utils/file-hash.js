/**
 * FileHashCalculator - Calculate real content hashes upfront using WebCrypto API
 * Eliminates the need for temporary hashes and hash transitions
 */
class FileHashCalculator {
    constructor() {
        this.hashCache = new Map(); // filename-size-modified -> hash (for duplicate detection)
        this.pendingHashes = new Map(); // filename -> promise (for deduplication)
    }
    
    /**
     * Calculate real SHA-256 hash from file content
     * @param {File} file - File to hash
     * @returns {Promise<string>} SHA-256 hash as hex string
     */
    async calculateHash(file) {
        // Create cache key for duplicate detection
        const cacheKey = `${file.name}-${file.size}-${file.lastModified}`;
        
        // Return cached hash if available
        if (this.hashCache.has(cacheKey)) {
            const cachedHash = this.hashCache.get(cacheKey);
            console.log(`🔄 Using cached hash for ${file.name}: ${cachedHash.substring(0, 8)}...`);
            return cachedHash;
        }
        
        // Return pending promise if already calculating
        if (this.pendingHashes.has(cacheKey)) {
            
            return this.pendingHashes.get(cacheKey);
        }
        
        // Start new hash calculation
        const hashPromise = this._calculateHashInternal(file, cacheKey);
        this.pendingHashes.set(cacheKey, hashPromise);
        
        try {
            const hash = await hashPromise;
            this.hashCache.set(cacheKey, hash);
            return hash;
        } finally {
            this.pendingHashes.delete(cacheKey);
        }
    }
    
    /**
     * Internal hash calculation using WebCrypto API
     * @private
     */
    async _calculateHashInternal(file, cacheKey) {
        console.log(`🔐 Calculating real hash for ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
        const startTime = Date.now();
        
        try {
            // Read file as ArrayBuffer
            const arrayBuffer = await this._fileToArrayBuffer(file);
            
            // Calculate SHA-256 hash
            const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
            
            // Convert to hex string
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            
            const duration = Date.now() - startTime;
            console.log(`✅ Hash calculated for ${file.name}: ${hashHex.substring(0, 8)}... (${duration}ms)`);
            
            return hashHex;
        } catch (error) {
            console.error(`❌ Failed to calculate hash for ${file.name}:`, error);
            // Fallback to simple hash for compatibility
            return this._fallbackHash(file);
        }
    }
    
    /**
     * Convert File to ArrayBuffer
     * @private
     */
    _fileToArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(file);
        });
    }
    
    /**
     * Fallback hash for older browsers or errors
     * @private
     */
    _fallbackHash(file) {
        // Use file metadata + timestamp as fallback
        const fallback = `fallback-${file.name}-${file.size}-${file.lastModified}-${Date.now()}`;
        console.warn(`⚠️ Using fallback hash for ${file.name}: ${fallback.substring(0, 16)}...`);
        return fallback;
    }
    
    /**
     * Calculate hashes for multiple files in parallel with batching
     * @param {File[]} files - Files to hash
     * @param {Function} progressCallback - Progress callback (current, total)
     * @returns {Promise<Map<File, string>>} Map of file -> hash
     */
    async calculateBatchHashes(files, progressCallback = null) {
        
        const startTime = Date.now();
        
        // Calculate batch size based on total files (avoid overwhelming the system)
        const batchSize = files.length > 50 ? 8 : files.length > 20 ? 12 : 16;
        const results = new Map();
        let completed = 0;
        
        // Process files in batches
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            
            // Calculate hashes for this batch in parallel
            const batchPromises = batch.map(async (file) => {
                try {
                    const hash = await this.calculateHash(file);
                    results.set(file, hash);
                    completed++;
                    
                    // Report progress
                    if (progressCallback) {
                        progressCallback(completed, files.length);
                    }
                    
                    return { file, hash };
                } catch (error) {
                    console.error(`❌ Hash failed for ${file.name}:`, error);
                    completed++;
                    if (progressCallback) {
                        progressCallback(completed, files.length);
                    }
                    return { file, hash: null };
                }
            });
            
            // Wait for batch to complete
            await Promise.all(batchPromises);
            
            // Yield control between batches
            if (i + batchSize < files.length) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
        
        const duration = Date.now() - startTime;
        const successful = Array.from(results.values()).filter(hash => hash !== null).length;
        console.log(`✅ Batch hash calculation complete: ${successful}/${files.length} successful (${duration}ms)`);
        
        return results;
    }
    
    /**
     * Check if hash is cached
     */
    hasCachedHash(file) {
        const cacheKey = `${file.name}-${file.size}-${file.lastModified}`;
        return this.hashCache.has(cacheKey);
    }
    
    /**
     * Clear cache (for memory management)
     */
    clearCache() {
        const size = this.hashCache.size;
        this.hashCache.clear();
        this.pendingHashes.clear();
        
    }
    
    /**
     * Get cache statistics
     */
    getCacheStats() {
        return {
            cachedHashes: this.hashCache.size,
            pendingCalculations: this.pendingHashes.size,
            memoryUsageEstimate: this.hashCache.size * 64 // ~64 bytes per hash entry
        };
    }
}

// Create global instance
window.fileHashCalculator = new FileHashCalculator();

// Export for module environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FileHashCalculator;
}