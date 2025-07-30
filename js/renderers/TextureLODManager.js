/**
 * TextureLODManager - Manages multi-resolution textures for WebGL renderer
 * Provides automatic LOD selection, texture caching, and memory management
 */
class TextureLODManager {
    constructor(gl, options = {}) {
        if (!gl) {
            throw new Error('TextureLODManager requires a valid WebGL context');
        }
        this.gl = gl;
        
        // LOD levels configuration - matches server thumbnail sizes
        this.lodLevels = [
            { size: 64,   priority: 0, atlas: true },   // Packed in atlas
            { size: 128,  priority: 1, atlas: false },  // Small thumbnails
            { size: 256,  priority: 2, atlas: false },  // Medium thumbnails
            { size: 512,  priority: 3, atlas: false },  // Large thumbnails
            { size: 1024, priority: 4, atlas: false },  // XL thumbnails
            { size: 2048, priority: 5, atlas: false },  // XXL thumbnails
            { size: null, priority: 6, atlas: false }   // Full resolution (rarely needed)
        ];
        
        // Configuration
        this.maxTextureMemory = options.maxMemory || 512 * 1024 * 1024; // 512MB default
        this.maxTextures = options.maxTextures || 500;
        this.uploadBudgetMs = options.uploadBudget || 2; // 2ms per frame
        
        // Texture storage
        this.textureCache = new Map(); // hash -> { lodSize -> { texture, lastUsed, memorySize } }
        this.atlasManager = null; // Will be initialized separately
        this.totalMemory = 0;
        
        // Upload queue management
        this.uploadQueue = [];
        this.activeUploads = new Set();
        
        // LRU tracking
        this.accessOrder = []; // Array of { hash, lodSize } for LRU eviction
        
        // Performance tracking
        this.stats = {
            textureLoads: 0,
            textureEvictions: 0,
            cacheHits: 0,
            cacheMisses: 0
        };
        
        // Initialize WebGL extensions
        this.anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
        this.maxAnisotropy = this.anisoExt ? 
            gl.getParameter(this.anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    }
    
    /**
     * Get the best texture for a given image node based on screen size
     * @param {string} hash - Image hash
     * @param {number} screenWidth - Screen width in pixels
     * @param {number} screenHeight - Screen height in pixels
     * @returns {WebGLTexture|null} Best available texture
     */
    getBestTexture(hash, screenWidth, screenHeight) {
        const targetSize = Math.max(screenWidth, screenHeight);
        const nodeCache = this.textureCache.get(hash);
        
        if (!nodeCache) {
            this.stats.cacheMisses++;
            return null;
        }
        
        // Find best available texture
        let bestTexture = null;
        let bestSize = 0;
        
        for (const [lodSize, textureData] of nodeCache) {
            if (lodSize === null || lodSize >= targetSize * 0.8) {
                // This LOD is good enough quality
                bestTexture = textureData.texture;
                bestSize = lodSize || Infinity;
                
                // Update access order for LRU
                this._markAccessed(hash, lodSize);
                this.stats.cacheHits++;
                break;
            } else if (lodSize > bestSize) {
                // Keep track of best available if no perfect match
                bestTexture = textureData.texture;
                bestSize = lodSize;
            }
        }
        
        if (bestTexture && bestSize > 0) {
            this._markAccessed(hash, bestSize);
            this.stats.cacheHits++;
        }
        
        return bestTexture;
    }
    
    /**
     * Request a texture at specific LOD level
     * @param {string} hash - Image hash
     * @param {number|null} lodSize - Target LOD size (null for full res)
     * @param {number} priority - Loading priority (0 = highest)
     * @param {HTMLImageElement|HTMLCanvasElement} source - Image source
     */
    requestTexture(hash, lodSize, priority, source) {
        // Check if already loaded
        const nodeCache = this.textureCache.get(hash);
        if (nodeCache && nodeCache.has(lodSize)) {
            return; // Already have this texture
        }
        
        // Check if already queued
        const queueKey = `${hash}_${lodSize}`;
        if (this.activeUploads.has(queueKey)) {
            return; // Already uploading
        }
        
        // Fast path for Canvas sources - upload immediately
        if (source instanceof HTMLCanvasElement && priority <= 1) {
            // Canvas sources are already decoded, upload immediately for high priority
            this.activeUploads.add(queueKey);
            this._uploadTextureImmediate({
                hash,
                lodSize,
                source,
                queueKey
            });
            return;
        }
        
        // Add to upload queue for async processing
        this.uploadQueue.push({
            hash,
            lodSize,
            priority,
            source,
            queueKey
        });
        
        // Sort by priority (stable sort)
        this.uploadQueue.sort((a, b) => a.priority - b.priority);
    }
    
    /**
     * Process texture uploads within frame budget
     * @returns {Promise<number>} Number of textures uploaded
     */
    async processUploads() {
        // Defer processing to next microtask to avoid blocking current frame
        await Promise.resolve();
        
        const startTime = performance.now();
        let uploaded = 0;
        
        // Process uploads in parallel but respect frame budget
        const uploads = [];
        
        while (this.uploadQueue.length > 0 && 
               performance.now() - startTime < this.uploadBudgetMs) {
            const upload = this.uploadQueue.shift();
            if (!upload) break;
            
            // Skip if source is no longer valid
            if (!upload.source) {
                this.activeUploads.delete(upload.queueKey);
                continue;
            }
            
            // For HTMLImageElements, check if complete
            if (upload.source instanceof HTMLImageElement && !upload.source.complete) {
                // Put it back in the queue for later
                this.uploadQueue.unshift(upload);
                break;
            }
            
            // Start async upload
            uploads.push(this._uploadTexture(upload));
            uploaded++;
            
            // Limit concurrent uploads to prevent too many ImageBitmap creations
            if (uploads.length >= 3) {
                break;
            }
        }
        
        // Wait for uploads to complete
        if (uploads.length > 0) {
            await Promise.all(uploads);
        }
        
        return uploaded;
    }
    
    /**
     * Upload texture to GPU
     * @private
     */
    async _uploadTexture(upload) {
        const { hash, lodSize, source, queueKey } = upload;
        const gl = this.gl;
        
        try {
            // Ensure source is decoded before upload
            let decodedSource = source;
            
            // If source is an HTMLImageElement, ensure it's decoded
            if (source instanceof HTMLImageElement) {
                // Check if image needs decoding
                if (!source.complete) {
                    console.warn('Attempting to upload incomplete image');
                    this.activeUploads.delete(queueKey);
                    return;
                }
                
                // ALWAYS use createImageBitmap for guaranteed decoded image
                // Never fall back to raw image to avoid synchronous decode
                try {
                    decodedSource = await createImageBitmap(source);
                } catch (error) {
                    console.error('Failed to create ImageBitmap, skipping texture upload:', error);
                    this.activeUploads.delete(queueKey);
                    return; // Skip this texture rather than cause sync decode
                }
            }
            // Canvas and ImageBitmap sources are already decoded
            
            // Create texture
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            
            // Upload texture data with decoded source
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, decodedSource);
            
            // Set high-quality filtering
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            
            // Generate mipmaps for quality downsampling
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            
            // Apply anisotropic filtering if available
            if (this.anisoExt) {
                gl.texParameterf(gl.TEXTURE_2D, 
                    this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, 
                    Math.min(16, this.maxAnisotropy));
            }
            
            // Calculate memory usage (rough estimate)
            const width = decodedSource.width || source.width;
            const height = decodedSource.height || source.height;
            const memorySize = width * height * 4 * 1.33; // 1.33 for mipmaps
            
            // Check memory limits and evict if necessary
            this._enforceMemoryLimit(memorySize);
            
            // Store in cache
            if (!this.textureCache.has(hash)) {
                this.textureCache.set(hash, new Map());
            }
            
            this.textureCache.get(hash).set(lodSize, {
                texture,
                lastUsed: Date.now(),
                memorySize,
                width,
                height
            });
            
            this.totalMemory += memorySize;
            this.stats.textureLoads++;
            
            // Mark as accessed
            this._markAccessed(hash, lodSize);
            
            // Clean up ImageBitmap if we created one
            if (decodedSource !== source && decodedSource instanceof ImageBitmap) {
                decodedSource.close();
            }
            
        } catch (error) {
            console.error('Failed to upload texture:', error);
        } finally {
            // Remove from active uploads
            this.activeUploads.delete(queueKey);
        }
    }
    
    /**
     * Upload texture immediately (for pre-decoded sources like canvas)
     * @private
     */
    _uploadTextureImmediate(upload) {
        const { hash, lodSize, source, queueKey } = upload;
        const gl = this.gl;
        
        try {
            // Create texture
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            
            // Upload texture data directly (canvas is already decoded)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
            
            // Set high-quality filtering
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            
            // Generate mipmaps for quality downsampling
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            
            // Apply anisotropic filtering if available
            if (this.anisoExt) {
                gl.texParameterf(gl.TEXTURE_2D, 
                    this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, 
                    Math.min(16, this.maxAnisotropy));
            }
            
            // Calculate memory usage
            const memorySize = source.width * source.height * 4 * 1.33;
            
            // Check memory limits and evict if necessary
            this._enforceMemoryLimit(memorySize);
            
            // Store in cache
            if (!this.textureCache.has(hash)) {
                this.textureCache.set(hash, new Map());
            }
            
            this.textureCache.get(hash).set(lodSize, {
                texture,
                lastUsed: Date.now(),
                memorySize,
                width: source.width,
                height: source.height
            });
            
            this.totalMemory += memorySize;
            this.stats.textureLoads++;
            
            // Mark as accessed
            this._markAccessed(hash, lodSize);
            
        } catch (error) {
            console.error('Failed to upload texture immediately:', error);
        } finally {
            // Remove from active uploads
            this.activeUploads.delete(queueKey);
        }
    }
    
    /**
     * Mark texture as recently accessed for LRU tracking
     * @private
     */
    _markAccessed(hash, lodSize) {
        const key = { hash, lodSize };
        
        // Remove from current position if exists
        const index = this.accessOrder.findIndex(
            item => item.hash === hash && item.lodSize === lodSize
        );
        if (index !== -1) {
            this.accessOrder.splice(index, 1);
        }
        
        // Add to end (most recently used)
        this.accessOrder.push(key);
    }
    
    /**
     * Enforce memory limit by evicting least recently used textures
     * @private
     */
    _enforceMemoryLimit(requiredMemory) {
        while (this.totalMemory + requiredMemory > this.maxTextureMemory && 
               this.accessOrder.length > 0) {
            // Get least recently used
            const lru = this.accessOrder.shift();
            if (!lru) break;
            
            const nodeCache = this.textureCache.get(lru.hash);
            if (!nodeCache) continue;
            
            const textureData = nodeCache.get(lru.lodSize);
            if (!textureData) continue;
            
            // Delete texture
            this.gl.deleteTexture(textureData.texture);
            this.totalMemory -= textureData.memorySize;
            nodeCache.delete(lru.lodSize);
            
            // Remove hash entry if no more textures
            if (nodeCache.size === 0) {
                this.textureCache.delete(lru.hash);
            }
            
            this.stats.textureEvictions++;
        }
    }
    
    /**
     * Get optimal LOD size for given screen dimensions
     * @param {number} screenWidth - Screen width in pixels
     * @param {number} screenHeight - Screen height in pixels
     * @returns {number|null} Optimal LOD size
     */
    getOptimalLOD(screenWidth, screenHeight) {
        const targetSize = Math.max(screenWidth, screenHeight);
        
        // Find the smallest LOD that provides good quality
        // Use 1.5x the screen size for sharper rendering
        const desiredSize = targetSize * 1.5;
        
        // Debug: Log LOD calculation
        if (targetSize > 1000) {
            console.log(`🎯 LOD calc: target=${Math.round(targetSize)}px, desired=${Math.round(desiredSize)}px, available=[${this.lodLevels.map(l => l.size || 'FULL').join(', ')}]`);
        }
        
        for (const lod of this.lodLevels) {
            if (lod.size === null || lod.size >= desiredSize) {
                return lod.size;
            }
        }
        
        return null; // Full resolution
    }
    
    /**
     * Clear all cached textures
     */
    clear() {
        for (const [hash, nodeCache] of this.textureCache) {
            for (const [lodSize, textureData] of nodeCache) {
                this.gl.deleteTexture(textureData.texture);
            }
        }
        
        this.textureCache.clear();
        this.accessOrder = [];
        this.uploadQueue = [];
        this.activeUploads.clear();
        this.totalMemory = 0;
    }
    
    /**
     * Clean up textures for a specific image hash
     * @param {string} hash - Image hash to clean up
     */
    clearTexturesForHash(hash) {
        const nodeCache = this.textureCache.get(hash);
        if (!nodeCache) return;
        
        // Delete all WebGL textures for this hash
        for (const [lodSize, textureData] of nodeCache) {
            this.gl.deleteTexture(textureData.texture);
            this.totalMemory -= textureData.memorySize;
            
            // Remove from access order
            const index = this.accessOrder.findIndex(
                item => item.hash === hash && item.lodSize === lodSize
            );
            if (index !== -1) {
                this.accessOrder.splice(index, 1);
            }
        }
        
        // Remove the hash entry
        this.textureCache.delete(hash);
        
        console.log(`🧹 Cleaned up WebGL textures for ${hash.substring(0, 8)}...`);
    }
    
    /**
     * Get memory usage statistics
     */
    getStats() {
        return {
            ...this.stats,
            totalMemory: this.totalMemory,
            textureCount: this.accessOrder.length,
            queueLength: this.uploadQueue.length
        };
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TextureLODManager;
}

// Make available globally for browser environments
if (typeof window !== 'undefined') {
    window.TextureLODManager = TextureLODManager;
}