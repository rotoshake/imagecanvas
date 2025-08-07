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
        this.maxTextureMemory = options.maxMemory || 1536 * 1024 * 1024; // 1.5GB default for better high-res support
        this.maxTextures = options.maxTextures || 500;
        this.uploadBudgetMs = options.uploadBudget || 1; // 1ms per frame (was 2ms) - more conservative
        this.canvas = options.canvas; // Canvas reference for viewport state checks
        this.maxFullResTextures = 10; // Allow more full-res textures since we have 1.5GB limit
        this.qualityMultiplier = options.qualityMultiplier || 1.2; // Adjustable quality vs performance
        
        // Texture storage
        this.textureCache = new Map(); // hash -> { lodSize -> { texture, lastUsed, memorySize } }
        this.atlasManager = null; // Will be initialized separately
        this.totalMemory = 0;
        
        // Upload queue management
        this.uploadQueue = [];
        this.activeUploads = new Set();
        
        // Decode throttling to prevent lag on page reload
        this.maxConcurrentDecodes = 4; // Increased for better initial load performance
        this.activeDecodes = 0;
        
        // Track initial page load for performance optimization
        this.pageLoadTime = Date.now();
        this.isInitialLoad = true;
        setTimeout(() => { 
            this.isInitialLoad = false;
            this.maxConcurrentDecodes = 2; // Reduce after initial load
        }, 3000); // 3 second initial load period
        this.decodeQueue = [];
        this.decodedCache = new WeakMap(); // Track already decoded images
        
        // LRU tracking
        this.accessOrder = []; // Array of { hash, lodSize } for LRU eviction
        
        // Performance tracking
        this.stats = {
            textureLoads: 0,
            textureEvictions: 0,
            cacheHits: 0,
            cacheMisses: 0
        };
        
        // Track nodes that need high resolution
        this._highZoomNodes = new Set();
        
        // Track actively rendered textures to prevent eviction
        this.activelyRenderedTextures = new Set();
        this.lastActiveUpdate = 0;
        
        // Track recently loaded textures to prevent thrashing
        this.recentlyLoadedTextures = new Map(); // key -> timestamp
        this.recentTextureProtectionTime = 5000; // Protect for 5 seconds
        this.recentTextureCleanupInterval = 10000; // Cleanup old entries every 10 seconds
        
        // Track recently evicted textures to prevent re-requesting
        this.recentlyEvictedTextures = new Map(); // key -> timestamp
        this.evictionCooldownTime = 3000; // Don't re-request for 3 seconds after eviction
        
        // Start cleanup timer for recently loaded textures
        this._startRecentTextureCleanup();
        
        // Initialize WebGL extensions
        this.anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
        this.maxAnisotropy = this.anisoExt ? 
            gl.getParameter(this.anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
            
        // Check for compressed texture support
        this.dxtExt = gl.getExtension('WEBGL_compressed_texture_s3tc');
        this.etcExt = gl.getExtension('WEBGL_compressed_texture_etc');
        this.astcExt = gl.getExtension('WEBGL_compressed_texture_astc');
        
        if (this.dxtExt) {
            console.log('✅ DXT/S3TC compression supported - could reduce texture memory by 4-6x');
        }
        if (this.etcExt) {
            console.log('✅ ETC2 compression supported');
        }
        if (this.astcExt) {
            console.log('✅ ASTC compression supported');
        }
    }
    
    /**
     * Get the current texture size being used for a hash
     * @param {string} hash - Image hash
     * @returns {number|null} Current texture size, or null if none/full-res
     */
    getCurrentTextureSize(hash) {
        const nodeCache = this.textureCache.get(hash);
        if (!nodeCache || nodeCache.size === 0) {
            return null;
        }
        
        // Find the most recently accessed texture for this hash
        let mostRecentSize = null;
        let mostRecentTime = 0;
        
        for (const [lodSize, textureData] of nodeCache) {
            if (textureData.lastUsed > mostRecentTime) {
                mostRecentTime = textureData.lastUsed;
                mostRecentSize = lodSize;
            }
        }
        
        return mostRecentSize;
    }
    
    /**
     * Get the best texture for a given image node based on screen size
     * SIMPLIFIED VERSION - just pick the right texture
     * @param {string} hash - Image hash
     * @param {number} screenWidth - Screen width in pixels (already includes DPR)
     * @param {number} screenHeight - Screen height in pixels (already includes DPR)
     * @returns {WebGLTexture|null} Best available texture
     */
    getBestTexture(hash, screenWidth, screenHeight) {
        const nodeCache = this.textureCache.get(hash);
        if (!nodeCache || nodeCache.size === 0) {
            this.stats.cacheMisses++;
            return null;
        }
        
        // Simple: what size do we need on screen?
        const targetSize = Math.max(screenWidth, screenHeight);
        
        // Available texture sizes: 64, 128, 256, 512, 1024, 2048, null (full)
        // Pick the smallest one that's >= targetSize
        let bestTexture = null;
        let bestSize = Infinity;
        let bestDiff = Infinity;
        
        for (const [lodSize, textureData] of nodeCache) {
            const textureSize = lodSize || 10000; // Treat full res as 10000 for comparison
            
            // Is this texture big enough?
            if (textureSize >= targetSize) {
                // Yes - is it closer to our target than what we have?
                const diff = textureSize - targetSize;
                if (diff < bestDiff) {
                    bestTexture = textureData.texture;
                    bestSize = lodSize;
                    bestDiff = diff;
                }
            }
        }
        
        // If we didn't find anything big enough, use the largest available
        if (!bestTexture) {
            let largestSize = 0;
            for (const [lodSize, textureData] of nodeCache) {
                const textureSize = lodSize || 10000;
                if (textureSize > largestSize) {
                    largestSize = textureSize;
                    bestTexture = textureData.texture;
                    bestSize = lodSize;
                }
            }
        }
        
        if (bestTexture) {
            this._markAccessed(hash, bestSize);
            this.stats.cacheHits++;
            console.log(`📊 Using ${bestSize || 'FULL'}px texture for ${hash.substring(0, 8)} (target: ${Math.round(targetSize)}px)`);
        } else {
            this.stats.cacheMisses++;
        }
        
        return bestTexture;
    }
    
    /**
     * Get any available texture immediately (for prioritizing framerate)
     * @param {string} hash - Image hash
     * @returns {WebGLTexture|null} Any available texture
     */
    getAnyAvailableTexture(hash) {
        const nodeCache = this.textureCache.get(hash);
        
        if (!nodeCache || nodeCache.size === 0) {
            return null;
        }
        
        // Return the first available texture (prioritize smaller sizes for faster loading)
        let bestTexture = null;
        let bestSize = Infinity;
        
        for (const [lodSize, textureData] of nodeCache) {
            const size = lodSize || Infinity;
            if (size < bestSize) {
                bestTexture = textureData.texture;
                bestSize = size;
            }
        }
        
        if (bestTexture) {
            // Mark as accessed
            this._markAccessed(hash, bestSize === Infinity ? null : bestSize);
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
     * @param {boolean} isVisible - Whether the node is currently visible
     * @param {number} screenSize - Screen space size the texture is being requested for
     */
    requestTexture(hash, lodSize, priority, source, isVisible = false, screenSize = null) {
        // Debug: Log requests for full res
        if (lodSize === null) {
            console.log(`📥 Requesting FULL RES texture for ${hash.substring(0, 8)} (priority: ${priority})`);
        }
        
        // Check if already loaded
        const nodeCache = this.textureCache.get(hash);
        if (nodeCache && nodeCache.has(lodSize)) {
            if (lodSize === null) {
                console.log(`✅ Full res already loaded for ${hash.substring(0, 8)}`);
            }
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
                queueKey,
                isVisible,
                screenSize
            });
            return;
        }
        
        // Adjust priority for visible nodes - they get boosted priority
        const adjustedPriority = isVisible ? Math.max(0, priority - 2) : priority;
        
        // Add to upload queue for async processing
        this.uploadQueue.push({
            hash,
            lodSize,
            priority: adjustedPriority,
            source,
            queueKey,
            isVisible,
            screenSize: screenSize || 0
        });
        
        // Sort by priority (stable sort)
        this.uploadQueue.sort((a, b) => a.priority - b.priority);
    }
    
    /**
     * Clear pending uploads for a specific hash to make room for higher priority
     * @param {string} hash - Image hash to clear
     */
    clearPendingUploadsForHash(hash) {
        this.uploadQueue = this.uploadQueue.filter(upload => upload.hash !== hash);
    }
    
    /**
     * Process texture uploads within frame budget
     * @returns {Promise<number>} Number of textures uploaded
     */
    async processUploads() {
        // Defer all uploads if viewport is moving to prevent ImageDecode during panning
        if (this.canvas?.viewport?.isAnimating || this.canvas?.viewport?.shouldDeferQualityUpdate?.()) {
            // Retry after movement stops
            setTimeout(() => this.processUploads(), 100);
            return 0;
        }
        
        // Defer processing to next microtask to avoid blocking current frame
        await Promise.resolve();
        
        const startTime = performance.now();
        let uploaded = 0;
        
        // Process uploads in parallel but respect frame budget
        const uploads = [];
        
        // Detect if we're in bulk loading phase (many pending uploads or initial load)
        const isBulkLoading = this.uploadQueue.length > 5 || this.isInitialLoad;
        
        // Adjust budget based on context:
        // - Initial load: aggressive budget (8ms)
        // - Bulk loading: moderate budget (4ms)
        // - During interaction: minimal budget (0.5ms)
        // - Normal operation: standard budget (2ms)
        let budgetMs;
        if (this.canvas?.isInteracting) {
            budgetMs = 0.5;
        } else if (this.isInitialLoad) {
            budgetMs = 8; // Aggressive during initial page load
        } else if (isBulkLoading) {
            budgetMs = 4; // Moderate for bulk operations
        } else {
            budgetMs = 2; // Slightly higher for normal operation
        }
        
        while (this.uploadQueue.length > 0 && 
               performance.now() - startTime < budgetMs) {
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
            
            // Limit concurrent uploads based on context
            // During initial load, allow even more concurrent uploads
            const maxConcurrent = this.isInitialLoad ? 8 : (isBulkLoading ? 5 : 2);
            if (uploads.length >= maxConcurrent) {
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
        const { hash, lodSize, source, queueKey, isVisible, screenSize } = upload;
        const gl = this.gl;
        
        try {
            // Check if texture is oversized BEFORE uploading
            // Never reject 64px textures as they are the smallest available
            if (screenSize && lodSize && lodSize > 64) {
                // Calculate the optimal LOD for this screen size
                const screenWidth = screenSize;
                const screenHeight = screenSize;
                const optimalLOD = this.getOptimalLOD(screenWidth, screenHeight);
                
                // If optimalLOD is null (full resolution), don't reject any texture
                if (optimalLOD !== null) {
                    // Allow up to 2x the optimal LOD to account for quality multiplier
                    const maxAcceptable = Math.max(optimalLOD * 2, 64); // Never go below 64px
                    
                    if (lodSize > maxAcceptable) {
                        console.warn(`🚫 Rejecting oversized ${lodSize}px texture for ${Math.round(screenSize)}px screen space (optimal: ${optimalLOD}px, max: ${maxAcceptable}px)`);
                        this.activeUploads.delete(queueKey);
                        return; // Don't upload at all
                    }
                }
            }
            
            // Pre-check memory requirements and evict if necessary
            const preWidth = source.width || source.naturalWidth || 1024;
            const preHeight = source.height || source.naturalHeight || 1024;
            const estimatedMemory = preWidth * preHeight * 4 * 1.33; // 1.33 for mipmaps
            
            // Emergency memory relief if we're already over limit
            if (this.totalMemory >= this.maxTextureMemory) {
                console.warn(`🚨 Emergency memory relief: ${(this.totalMemory / 1024 / 1024).toFixed(1)}MB >= ${(this.maxTextureMemory / 1024 / 1024).toFixed(1)}MB limit`);
                // Need to free at least the new texture size plus 10% headroom
                const emergencyTarget = this.maxTextureMemory * 0.7;
                const toFree = this.totalMemory - emergencyTarget + estimatedMemory;
                this._emergencyMemoryRelief(toFree);
                
                // If still over limit after emergency relief, skip this upload
                if (this.totalMemory + estimatedMemory > this.maxTextureMemory) {
                    console.warn(`⏭️ Skipping texture upload - insufficient memory after emergency relief`);
                    this.activeUploads.delete(queueKey);
                    return;
                }
            }
            
            // If in focus mode and visible, do smart eviction BEFORE upload
            if (isVisible && this._isInFocusMode()) {
                const focusedHashes = this._getFocusedImageHashes();
                if (focusedHashes.has(hash)) {
                    // This is the focused image - make room for it if needed
                    if (this.totalMemory + estimatedMemory > this.maxTextureMemory * 0.85) {
                        console.log(`🎯 Focus mode: Making room for focused image ${hash.substring(0, 8)}`);
                        this._smartFocusEviction(hash, estimatedMemory);
                    }
                }
            }
            // Regular pre-emptive memory management for non-focused images
            // Only trigger at 92% to reduce thrashing (was 85%)
            else if (this.totalMemory + estimatedMemory > this.maxTextureMemory * 0.92) {
                console.log(`📊 Pre-emptive memory management: need ${(estimatedMemory / 1024 / 1024).toFixed(1)}MB, current ${(this.totalMemory / 1024 / 1024).toFixed(1)}MB / ${(this.maxTextureMemory / 1024 / 1024).toFixed(1)}MB`);
                this._enforceMemoryLimit(estimatedMemory);
            }
            
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
                
                // Check if viewport is moving - if so, defer the decode
                if (this.canvas?.viewport?.isAnimating || this.canvas?.viewport?.shouldDeferQualityUpdate?.()) {
                    // Put back in queue for later
                    this.uploadQueue.unshift({ hash, lodSize, source });
                    this.activeUploads.delete(queueKey);
                    // Retry after movement stops
                    setTimeout(() => this.processUploads(), 100);
                    return;
                }
                
                // Use throttled decode to prevent lag on page reload
                try {
                    decodedSource = await this._throttledDecode(source, hash, lodSize);
                } catch (error) {
                    console.error('Failed to decode image, skipping texture upload:', error);
                    this.activeUploads.delete(queueKey);
                    return; // Skip this texture rather than cause sync decode
                }
            }
            // Canvas and ImageBitmap sources are already decoded
            
            // Create texture
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            
            // Check once more if we should defer before the expensive texImage2D call
            if (this.canvas?.viewport?.isAnimating) {
                // Abort upload and put back in queue
                gl.deleteTexture(texture);
                this.uploadQueue.unshift({ hash, lodSize, source: decodedSource, priority: upload.priority });
                this.activeUploads.delete(queueKey);
                // Clean up ImageBitmap if we created one
                if (decodedSource !== source && decodedSource instanceof ImageBitmap) {
                    decodedSource.close();
                }
                setTimeout(() => this.processUploads(), 100);
                return;
            }
            
            // Check texture size and warn if it's very large
            const textureSize = (decodedSource.width || source.width) * (decodedSource.height || source.height) * 4;
            if (textureSize > 16 * 1024 * 1024) { // > 16MB
                console.warn(`⚠️ Large texture upload: ${(textureSize / 1024 / 1024).toFixed(1)}MB may cause frame drops`);
            }
            
            // Upload texture data with decoded source
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, decodedSource);
            
            // Set high-quality filtering
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            
            // Get texture dimensions
            const width = decodedSource.width || source.width;
            const height = decodedSource.height || source.height;
            
            // Only generate mipmaps for large textures (>256px)
            // Small thumbnails don't need them and mipmap generation is expensive
            if (width > 256 || height > 256) {
                // Large textures benefit from mipmaps for quality downsampling
                gl.generateMipmap(gl.TEXTURE_2D);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            } else {
                // Small textures (thumbnails) don't need mipmaps
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            }
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            
            // Apply anisotropic filtering if available
            if (this.anisoExt) {
                gl.texParameterf(gl.TEXTURE_2D, 
                    this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, 
                    Math.min(16, this.maxAnisotropy));
            }
            
            // Calculate memory usage (rough estimate)
            const memorySize = width * height * 4 * 1.33; // 1.33 for mipmaps
            
            // Log large textures
            if (memorySize > 100 * 1024 * 1024) { // > 100MB
                console.log(`⚠️ Large texture: ${width}x${height} = ${(memorySize / 1024 / 1024).toFixed(1)}MB for ${hash.substring(0, 8)}`);
            }
            
            // Skip post-upload enforcement for focused images (we already made room)
            const skipEnforcement = this._isInFocusMode() && this._getFocusedImageHashes().has(hash);
            
            if (!skipEnforcement) {
                // Check if this is a full-res texture and enforce limit
                if (lodSize === null) {
                    this._enforceFullResLimit();
                }
                
                // Check memory limits and evict if necessary
                this._enforceMemoryLimit(memorySize);
            }
            
            // Store in cache
            if (!this.textureCache.has(hash)) {
                this.textureCache.set(hash, new Map());
            }
            
            this.textureCache.get(hash).set(lodSize, {
                texture,
                source: decodedSource,
                lastUsed: Date.now(),
                memorySize,
                width,
                height,
                screenSize: screenSize || 0
            });
            
            this.totalMemory += memorySize;
            this.stats.textureLoads++;
            
            // Mark as accessed
            this._markAccessed(hash, lodSize);
            
            // Mark as recently loaded to prevent thrashing
            const key = `${hash}_${lodSize}`;
            this.recentlyLoadedTextures.set(key, Date.now());
            
            // Skip additional evictions for focused images - we already made room
            const focusedHashes = this._isInFocusMode() ? this._getFocusedImageHashes() : new Set();
            if (!focusedHashes.has(hash)) {
                // Only do post-upload enforcement for non-focused images
                // (focused images already had space made for them)
            }
            
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
        const { hash, lodSize, source, queueKey, isVisible, screenSize } = upload;
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
            
            // Only generate mipmaps for large textures (>256px)
            // Small thumbnails don't need them and mipmap generation is expensive
            const width = source.width;
            const height = source.height;
            
            if (width > 256 || height > 256) {
                // Large textures benefit from mipmaps for quality downsampling
                gl.generateMipmap(gl.TEXTURE_2D);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            } else {
                // Small textures (thumbnails) don't need mipmaps
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            }
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            
            // Apply anisotropic filtering if available
            if (this.anisoExt) {
                gl.texParameterf(gl.TEXTURE_2D, 
                    this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, 
                    Math.min(16, this.maxAnisotropy));
            }
            
            // Calculate memory usage
            const memorySize = source.width * source.height * 4 * 1.33;
            
            // Skip post-upload enforcement for focused images (we already made room)
            const skipEnforcement = this._isInFocusMode() && this._getFocusedImageHashes().has(hash);
            
            if (!skipEnforcement) {
                // Check if this is a full-res texture and enforce limit
                if (lodSize === null) {
                    this._enforceFullResLimit();
                }
                
                // Check memory limits and evict if necessary
                this._enforceMemoryLimit(memorySize);
            }
            
            // Store in cache
            if (!this.textureCache.has(hash)) {
                this.textureCache.set(hash, new Map());
            }
            
            this.textureCache.get(hash).set(lodSize, {
                texture,
                source: source,
                lastUsed: Date.now(),
                memorySize,
                width: source.width,
                height: source.height,
                screenSize: screenSize || 0
            });
            
            this.totalMemory += memorySize;
            this.stats.textureLoads++;
            
            if (lodSize === null || lodSize > 1024) {
                console.log(`📤 Uploaded ${lodSize || 'FULL'}px texture for ${hash.substring(0, 8)} - ${source.width}x${source.height} = ${(memorySize / 1024 / 1024).toFixed(1)}MB (total: ${(this.totalMemory / 1024 / 1024).toFixed(1)}MB / ${(this.maxTextureMemory / 1024 / 1024).toFixed(1)}MB)`);
            }
            
            // Mark as accessed
            this._markAccessed(hash, lodSize);
            
            // Mark as recently loaded to prevent thrashing
            const key = `${hash}_${lodSize}`;
            this.recentlyLoadedTextures.set(key, Date.now());
            
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
        
        // Update last used timestamp in cache
        const nodeCache = this.textureCache.get(hash);
        if (nodeCache && nodeCache.has(lodSize)) {
            nodeCache.get(lodSize).lastUsed = Date.now();
        }
    }
    
    /**
     * Enforce limit on full resolution textures
     * @private
     */
    _enforceFullResLimit() {
        // Only enforce if we're using more than 70% of memory (raised from 50%)
        if (this.totalMemory < this.maxTextureMemory * 0.7) {
            return; // Plenty of memory available, no need to limit
        }
        
        // Count current full-res textures
        const fullResTextures = [];
        for (const [hash, nodeCache] of this.textureCache) {
            if (nodeCache.has(null)) {
                const textureData = nodeCache.get(null);
                fullResTextures.push({ 
                    hash, 
                    lastUsed: textureData.lastUsed,
                    memorySize: textureData.memorySize,
                    texture: textureData.texture,
                    nodeCache: nodeCache
                });
            }
        }
        
        // Calculate dynamic limit based on average full-res size
        const avgFullResSize = 62 * 1024 * 1024; // ~62MB average
        const maxFullResBasedOnMemory = Math.floor((this.maxTextureMemory * 0.7) / avgFullResSize);
        const dynamicLimit = Math.max(3, Math.min(this.maxFullResTextures, maxFullResBasedOnMemory));
        
        // If we're at or over the limit, evict the oldest
        if (fullResTextures.length >= dynamicLimit) {
            // Sort by last used time (oldest first)
            fullResTextures.sort((a, b) => a.lastUsed - b.lastUsed);
            
            // Evict the oldest full-res textures
            const toEvict = fullResTextures.length - this.maxFullResTextures + 1;
            for (let i = 0; i < toEvict; i++) {
                const victim = fullResTextures[i];
                
                // Check if this texture is actively being rendered
                const activeKey = `${victim.hash}_null`;
                if (this.activelyRenderedTextures.has(activeKey)) {
                    // Silently skip - too noisy during video playback
                    continue;
                }
                
                // Check if we have a lower resolution available
                const availableLODs = this.getAvailableLODs(victim.hash);
                const hasLowerRes = availableLODs.some(lod => lod !== null && lod >= 1024);
                
                // Silently evict/downgrade full-res textures
                
                // Delete the texture
                this.gl.deleteTexture(victim.texture);
                this.totalMemory -= victim.memorySize;
                
                // Remove from cache
                if (victim.nodeCache) {
                    victim.nodeCache.delete(null);
                    if (victim.nodeCache.size === 0) {
                        this.textureCache.delete(victim.hash);
                    }
                }
                
                // Remove from access order
                const index = this.accessOrder.findIndex(
                    item => item.hash === victim.hash && item.lodSize === null
                );
                if (index !== -1) {
                    this.accessOrder.splice(index, 1);
                }
            }
        }
    }
    
    /**
     * Enforce memory limit by evicting least recently used textures
     * @private
     */
    _enforceMemoryLimit(requiredMemory) {
        // Get visible nodes for selective eviction
        let visibleHashes = new Set();
        if (this.canvas) {
            const visibleNodes = this.canvas.viewport?.getVisibleNodes?.(
                this.canvas.graph?.nodes || [],
                200 // margin
            );
            
            if (visibleNodes) {
                for (const node of visibleNodes) {
                    if (node.properties?.hash) {
                        visibleHashes.add(node.properties.hash);
                    }
                }
            }
        }
        
        // First try to free up space by unloading high-res textures for non-visible nodes
        if (this.canvas && this.totalMemory + requiredMemory > this.maxTextureMemory) {
            // When zoomed out far, be more aggressive about what to keep
            const zoomLevel = this.canvas.viewport?.scale || 1;
            let keepThreshold = 512;
            
            if (zoomLevel < 0.3) {
                keepThreshold = 64; // Very zoomed out - only keep tiny thumbnails
            } else if (zoomLevel < 0.5) {
                keepThreshold = 128; // Moderately zoomed out
            } else if (zoomLevel < 1.0) {
                keepThreshold = 256; // Slightly zoomed out
            }
            
            if (visibleHashes.size > 0) {
                // Try unloading non-visible high-res textures first
                const unloaded = this.unloadNonVisibleHighRes(visibleHashes, keepThreshold);
                if (unloaded > 0 && this.totalMemory + requiredMemory <= this.maxTextureMemory) {
                    return; // We freed enough space
                }
            }
        }
        
        // Check if we're in critical memory pressure (>95% full) - raised from 90% to reduce thrashing
        const memoryUsagePercent = this.totalMemory / this.maxTextureMemory;
        const aggressiveMode = memoryUsagePercent > 0.95;
        
        if (aggressiveMode || memoryUsagePercent > 0.8) {
            console.warn(`⚠️ Memory pressure: ${(memoryUsagePercent * 100).toFixed(1)}% - ${aggressiveMode ? 'AGGRESSIVE eviction' : 'normal eviction'} (${(this.totalMemory / 1024 / 1024).toFixed(0)}MB / ${(this.maxTextureMemory / 1024 / 1024).toFixed(0)}MB)`);
            
            // Log what's taking up memory when zoomed out
            if (this.canvas?.viewport?.scale < 0.5) {
                const summary = new Map();
                for (const item of this.accessOrder) {
                    const key = item.lodSize || 'FULL';
                    summary.set(key, (summary.get(key) || 0) + 1);
                }
                console.log('📊 Texture distribution:', Object.fromEntries(summary));
            }
        }
        
        // Get focused image hashes if in focus mode
        let focusedHashes = new Set();
        if (this._isInFocusMode()) {
            focusedHashes = this._getFocusedImageHashes();
            if (focusedHashes.size > 0) {
                console.log(`🎯 Protecting focused images from eviction: ${Array.from(focusedHashes).map(h => h.substring(0, 8)).join(', ')}`);
            }
        }
        
        // If still need space, use regular LRU eviction
        let skippedCount = 0;
        const maxSkips = this.accessOrder.length; // Prevent infinite loop
        
        while (this.totalMemory + requiredMemory > this.maxTextureMemory && 
               this.accessOrder.length > 0 && skippedCount < maxSkips) {
            // Get least recently used
            const lru = this.accessOrder.shift();
            if (!lru) break;
            
            // Protect focused images from eviction
            if (focusedHashes.has(lru.hash)) {
                // Put it back at the end of the queue (most recently used position)
                this.accessOrder.push(lru);
                skippedCount++;
                continue;
            }
            
            // Check if this texture is actively being rendered
            const activeKey = `${lru.hash}_${lru.lodSize}`;
            if (this.activelyRenderedTextures.has(activeKey) && !aggressiveMode) {
                // Put it back at the end and skip (unless in aggressive mode)
                this.accessOrder.push(lru);
                skippedCount++;
                continue;
            }
            
            // Check if this texture was recently loaded (prevent thrashing)
            const recentKey = `${lru.hash}_${lru.lodSize}`;
            const loadTime = this.recentlyLoadedTextures.get(recentKey);
            // Use longer protection time in focus mode (30s vs 5s)
            const protectionTime = this._isInFocusMode() ? 30000 : this.recentTextureProtectionTime;
            if (loadTime && Date.now() - loadTime < protectionTime) {
                // Get the texture data to check screen size it was loaded for
                const nodeCache = this.textureCache.get(lru.hash);
                const textureData = nodeCache ? nodeCache.get(lru.lodSize) : null;
                const loadedForScreenSize = textureData ? textureData.screenSize : 0;
                
                // Only protect if texture size is reasonable for the screen space it was loaded for
                const maxReasonableSize = loadedForScreenSize ? loadedForScreenSize * 2 : 512;
                
                if (lru.lodSize !== null && lru.lodSize > maxReasonableSize) {
                    console.log(`❌ Not protecting oversized ${lru.lodSize}px texture loaded for ${Math.round(loadedForScreenSize)}px screen space`);
                    // Continue with eviction - don't protect oversized textures
                } else {
                    // Protect appropriately sized recent textures
                    this.accessOrder.push(lru);
                    skippedCount++;
                    console.log(`🛡️ Protecting recently loaded texture ${lru.lodSize || 'FULL'}px for ${lru.hash.substring(0, 8)} from eviction (screen: ${Math.round(loadedForScreenSize)}px)`);
                    continue;
                }
            }
            
            // Protect textures based on zoom level and visibility
            const zoomLevel = this.canvas?.viewport?.scale || 1;
            let protectSize = 256; // Default protection threshold
            
            // IMPORTANT: Protect full resolution textures when zoomed in
            // This prevents the flashing between full res and low res
            if (lru.lodSize === null && zoomLevel > 0.5 && !aggressiveMode) {
                // When zoomed in, protect full resolution textures that were recently used
                const nodeCache = this.textureCache.get(lru.hash);
                const textureData = nodeCache?.get(lru.lodSize);
                const wasRecentlyUsed = textureData && (Date.now() - textureData.lastUsed < 10000); // 10 second protection
                
                if (wasRecentlyUsed || visibleHashes.has(lru.hash)) {
                    // Protect this full res texture from eviction
                    this.accessOrder.push(lru);
                    skippedCount++;
                    console.log(`🛡️ Protecting full res texture for ${lru.hash.substring(0, 8)} (zoom: ${zoomLevel.toFixed(2)})`);
                    continue;
                }
            }
            
            if (zoomLevel < 0.3 && !aggressiveMode) {
                // When zoomed out far, only protect 64px textures for visible nodes
                protectSize = 64;
            } else if (zoomLevel < 0.5 && !aggressiveMode) {
                // Moderately zoomed out - protect up to 128px
                protectSize = 128;
            }
            
            if (lru.lodSize !== null && lru.lodSize <= protectSize && !aggressiveMode) {
                // Check if this texture belongs to a visible node
                const isVisible = this.canvas && visibleHashes && visibleHashes.has(lru.hash);
                if (isVisible) {
                    // Put it back at the end and skip - protect visible preview textures
                    this.accessOrder.push(lru);
                    skippedCount++;
                    continue;
                }
                // Non-visible preview textures can be evicted if needed
            }
            
            const nodeCache = this.textureCache.get(lru.hash);
            if (!nodeCache) continue;
            
            const textureData = nodeCache.get(lru.lodSize);
            if (!textureData) continue;
            
            // Check if we can downgrade instead of evicting completely
            if (lru.lodSize === null || lru.lodSize > 256) {
                // Check if we have a lower resolution available
                const availableLODs = this.getAvailableLODs(lru.hash);
                const hasLowerRes = availableLODs.some(lod => lod !== null && lod >= 256);
                
                // Silently downgrade without logging
            }
            
            // Delete texture
            this.gl.deleteTexture(textureData.texture);
            this.totalMemory -= textureData.memorySize;
            nodeCache.delete(lru.lodSize);
            
            // Only log evictions of large textures to reduce spam
            if (lru.lodSize === null || lru.lodSize > 1024) {
                console.log(`🗑️ Evicted ${lru.lodSize || 'FULL'}px texture for ${lru.hash.substring(0, 8)} (memory: ${(this.totalMemory / 1024 / 1024).toFixed(1)}MB / ${(this.maxTextureMemory / 1024 / 1024).toFixed(1)}MB)`);
            }
            
            // Remove hash entry if no more textures
            if (nodeCache.size === 0) {
                this.textureCache.delete(lru.hash);
            }
            
            this.stats.textureEvictions++;
            skippedCount = 0; // Reset skip count on successful eviction
        }
    }
    
    /**
     * Get optimal LOD size for given screen dimensions
     * SIMPLIFIED VERSION - just pick the right size
     * @param {number} screenWidth - Screen width in pixels (already includes DPR)
     * @param {number} screenHeight - Screen height in pixels (already includes DPR)
     * @returns {number|null} Optimal LOD size
     */
    getOptimalLOD(screenWidth, screenHeight) {
        const targetSize = Math.max(screenWidth, screenHeight);
        
        // Simple thresholds - pick the texture size that covers our needs
        // with a small buffer (1.2x) to avoid constant switching
        const sizeWithBuffer = targetSize * 1.2;
        
        console.log(`🎯 Need texture for ${Math.round(targetSize)}px screen size`);
        
        // Pick the right texture size
        if (sizeWithBuffer <= 64) return 64;
        if (sizeWithBuffer <= 128) return 128;
        if (sizeWithBuffer <= 256) return 256;
        if (sizeWithBuffer <= 512) return 512;
        if (sizeWithBuffer <= 1024) return 1024;
        if (sizeWithBuffer <= 2048) return 2048;
        
        // Need full res
        return null;
    }
    
    /**
     * Evict textures that are oversized for their current screen space
     * @param {Array} visibleNodes - Array of currently visible nodes
     * @returns {number} Number of textures evicted
     */
    evictOversizedForScreenSpace(visibleNodes) {
        const evicted = [];
        
        for (const node of visibleNodes) {
            if (!node.properties?.hash) continue;
            
            // Calculate current screen space size
            const screenWidth = node.size[0] * (this.canvas?.viewport?.scale || 1);
            const screenHeight = node.size[1] * (this.canvas?.viewport?.scale || 1);
            const dpr = this.canvas?.viewport?.dpr || 1;
            const effectiveScreenWidth = screenWidth * dpr;
            const effectiveScreenHeight = screenHeight * dpr;
            const optimalLOD = this.getOptimalLOD(effectiveScreenWidth, effectiveScreenHeight);
            // Allow up to 2x the optimal LOD before considering it oversized
            const maxReasonableSize = optimalLOD * 2;
            
            const nodeCache = this.textureCache.get(node.properties.hash);
            if (!nodeCache) continue;
            
            // Evict textures that are >2x the optimal size
            // Never evict 64px textures as they are the smallest available
            for (const [lodSize, textureData] of nodeCache) {
                if (lodSize !== null && lodSize > 64 && lodSize > maxReasonableSize) {
                    // Remove from access order
                    this.accessOrder = this.accessOrder.filter(item => 
                        !(item.hash === node.properties.hash && item.lodSize === lodSize)
                    );
                    
                    // Delete texture
                    this.gl.deleteTexture(textureData.texture);
                    this.totalMemory -= textureData.memorySize;
                    nodeCache.delete(lodSize);
                    
                    evicted.push({
                        hash: node.properties.hash,
                        size: lodSize,
                        screenSize: Math.round(Math.max(screenWidth, screenHeight)),
                        optimal: this.getOptimalLOD(effectiveScreenWidth, effectiveScreenHeight)
                    });
                }
            }
            
            // Clean up empty cache entries
            if (nodeCache.size === 0) {
                this.textureCache.delete(node.properties.hash);
            }
        }
        
        // if (evicted.length > 0) {
        //     console.log(`🧹 Evicted ${evicted.length} oversized textures:`, 
        //         evicted.map(e => `${e.size}px for ${e.screenSize}px screen (optimal: ${e.optimal}px)`).join(', '));
        // }
        
        return evicted.length;
    }

    /**
     * Unload high-resolution textures for nodes that are not visible
     * @param {Set<string>} visibleHashes - Set of hashes for currently visible nodes
     * @param {number} keepThreshold - Size threshold to keep (e.g., keep 256px and below)
     * @param {boolean} aggressiveMode - If true, also unload full-res for visible nodes if we have 2048px
     */
    unloadNonVisibleHighRes(visibleHashes, keepThreshold = 256, aggressiveMode = false) {
        const texturesUnloaded = [];
        
        for (const [hash, nodeCache] of this.textureCache) {
            const isVisible = visibleHashes.has(hash);
            
            // In aggressive mode, even unload full-res for visible nodes if we have 2048px
            if (!isVisible || aggressiveMode) {
                // Check each LOD for this hash
                for (const [lodSize, textureData] of nodeCache) {
                    let shouldUnload = false;
                    
                    if (!isVisible) {
                        // Not visible - unload anything larger than threshold
                        // But ALWAYS keep preview textures (256px and below)
                        shouldUnload = (lodSize === null || lodSize > keepThreshold) && (lodSize === null || lodSize > 256);
                    } else if (aggressiveMode && lodSize === null) {
                        // Visible but in aggressive mode - only unload full-res if we have 2048px
                        // AND the node is not actively being viewed at high zoom
                        // (keep full res for nodes that need it based on screen size)
                        shouldUnload = nodeCache.has(2048) && !this._isHighZoomNode(hash);
                    }
                    
                    if (shouldUnload) {
                        console.log(`🗑️ Unloading ${lodSize === null ? 'full res' : lodSize + 'px'} texture for ${hash.substring(0, 8)}... (visible: ${isVisible}, aggressive: ${aggressiveMode})`);
                        
                        // Delete the texture
                        this.gl.deleteTexture(textureData.texture);
                        this.totalMemory -= textureData.memorySize;
                        nodeCache.delete(lodSize);
                        
                        // Remove from access order
                        const index = this.accessOrder.findIndex(
                            item => item.hash === hash && item.lodSize === lodSize
                        );
                        if (index !== -1) {
                            this.accessOrder.splice(index, 1);
                        }
                        
                        texturesUnloaded.push({ hash, lodSize, memorySize: textureData.memorySize });
                    }
                }
            }
            
            // Remove hash entry if no more textures
            if (nodeCache.size === 0) {
                this.textureCache.delete(hash);
            }
        }
        
        if (texturesUnloaded.length > 5) {
            const freedMemory = texturesUnloaded.reduce((sum, t) => sum + (t.memorySize || 0), 0);
            // console.log(`🧹 Unloaded ${texturesUnloaded.length} high-res textures for non-visible nodes (freed ${(freedMemory / 1024 / 1024).toFixed(1)}MB)`);
        }
        
        return texturesUnloaded.length;
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
        
        // Only log cleanup when debugging
        if (window.DEBUG_LOD_STATUS) {
            console.log(`🧹 Cleaned up WebGL textures for ${hash.substring(0, 8)}...`);
        }
    }
    
    /**
     * Start periodic cleanup of recently loaded texture tracking
     * @private
     */
    _startRecentTextureCleanup() {
        setInterval(() => {
            const now = Date.now();
            const expiredKeys = [];
            
            // Find expired entries
            for (const [key, timestamp] of this.recentlyLoadedTextures) {
                if (now - timestamp > this.recentTextureProtectionTime) {
                    expiredKeys.push(key);
                }
            }
            
            // Remove expired entries
            for (const key of expiredKeys) {
                this.recentlyLoadedTextures.delete(key);
            }
            
            if (expiredKeys.length > 0) {
                console.log(`🧹 Cleaned up ${expiredKeys.length} expired recently loaded texture entries`);
            }
        }, this.recentTextureCleanupInterval);
    }
    
    /**
     * Check if we're in focus mode (only 1-2 images visible or single image dominates viewport)
     * @private
     * @returns {boolean}
     */
    _isInFocusMode() {
        if (!this.canvas || !this.canvas.viewport) return false;
        
        const viewport = this.canvas.viewport;
        const visibleNodes = viewport.getVisibleNodes?.(
            this.canvas.graph?.nodes || [],
            200 // margin
        );
        
        if (!visibleNodes) return false;
        
        // Filter to only image nodes
        const visibleImages = visibleNodes.filter(node => 
            node.type === 'image' && node.properties?.hash
        );
        
        // Focus mode if 2 or fewer images visible
        if (visibleImages.length > 0 && visibleImages.length <= 2) {
            return true;
        }
        
        // Also check if single image takes up > 50% of viewport
        const viewportArea = viewport.width * viewport.height;
        for (const node of visibleImages) {
            const nodeScreenArea = node.size[0] * node.size[1] * viewport.scale * viewport.scale;
            if (nodeScreenArea / viewportArea > 0.5) {
                return true; // Single image dominates viewport
            }
        }
        
        return false;
    }
    
    /**
     * Get hashes of focused images (images in focus mode)
     * @private
     * @returns {Set<string>}
     */
    _getFocusedImageHashes() {
        const focusedHashes = new Set();
        
        if (!this.canvas || !this.canvas.viewport) return focusedHashes;
        
        const viewport = this.canvas.viewport;
        const visibleNodes = viewport.getVisibleNodes?.(
            this.canvas.graph?.nodes || [],
            200 // margin
        );
        
        if (!visibleNodes) return focusedHashes;
        
        const visibleImages = visibleNodes.filter(node => 
            node.type === 'image' && node.properties?.hash
        );
        
        // If in focus mode (1-2 images), add them all
        if (visibleImages.length > 0 && visibleImages.length <= 2) {
            visibleImages.forEach(node => focusedHashes.add(node.properties.hash));
            return focusedHashes;
        }
        
        // Otherwise, add any image that dominates the viewport
        const viewportArea = viewport.width * viewport.height;
        for (const node of visibleImages) {
            const nodeScreenArea = node.size[0] * node.size[1] * viewport.scale * viewport.scale;
            if (nodeScreenArea / viewportArea > 0.5) {
                focusedHashes.add(node.properties.hash);
            }
        }
        
        return focusedHashes;
    }
    
    /**
     * Emergency memory relief - aggressively free memory when at or over limit
     * @private
     * @param {number} bytesToFree - Amount of memory to free
     */
    _emergencyMemoryRelief(bytesToFree) {
        console.warn(`🚨 Emergency eviction: need to free ${(bytesToFree / 1024 / 1024).toFixed(1)}MB`);
        
        let freedMemory = 0;
        const evicted = [];
        
        // In emergency, evict everything we can (except actively rendered)
        // Start with largest textures first
        const allTextures = [];
        for (const [hash, nodeCache] of this.textureCache) {
            for (const [lodSize, textureData] of nodeCache) {
                // Skip actively rendered textures
                const activeKey = `${hash}_${lodSize}`;
                if (this.activelyRenderedTextures.has(activeKey)) continue;
                
                allTextures.push({
                    hash,
                    lodSize,
                    texture: textureData.texture,
                    memorySize: textureData.memorySize,
                    size: lodSize || 10000 // Sort full-res as largest
                });
            }
        }
        
        // Sort by size descending (evict largest first in emergency)
        allTextures.sort((a, b) => b.size - a.size);
        
        // Evict until we free enough
        for (const tex of allTextures) {
            if (freedMemory >= bytesToFree) break;
            
            // Delete texture
            this.gl.deleteTexture(tex.texture);
            this.totalMemory -= tex.memorySize;
            freedMemory += tex.memorySize;
            
            // Remove from cache
            const nodeCache = this.textureCache.get(tex.hash);
            if (nodeCache) {
                nodeCache.delete(tex.lodSize);
                if (nodeCache.size === 0) {
                    this.textureCache.delete(tex.hash);
                }
            }
            
            // Remove from access order
            const index = this.accessOrder.findIndex(
                item => item.hash === tex.hash && item.lodSize === tex.lodSize
            );
            if (index !== -1) {
                this.accessOrder.splice(index, 1);
            }
            
            evicted.push(`${tex.hash.substring(0, 8)}_${tex.lodSize || 'FULL'}`);
            
            // Track eviction to prevent immediate re-request
            const evictKey = `${tex.hash}_${tex.lodSize}`;
            this.recentlyEvictedTextures.set(evictKey, Date.now());
        }
        
        console.warn(`🚨 Emergency eviction complete: freed ${(freedMemory / 1024 / 1024).toFixed(1)}MB by evicting ${evicted.length} textures`);
        console.log(`📊 Memory after emergency: ${(this.totalMemory / 1024 / 1024).toFixed(1)}MB / ${(this.maxTextureMemory / 1024 / 1024).toFixed(1)}MB`);
    }
    
    /**
     * Smart eviction for focused images - only evict what's necessary
     * @private
     * @param {string} focusedHash - Hash of the focused image
     * @param {number} requiredMemory - Memory needed for the new texture
     */
    _smartFocusEviction(focusedHash, requiredMemory) {
        const targetMemory = this.maxTextureMemory * 0.75; // Target 75% usage after eviction
        const memoryToFree = Math.max(0, this.totalMemory + requiredMemory - targetMemory);
        
        if (memoryToFree <= 0) return; // No eviction needed
        
        console.log(`🎯 Smart focus eviction: need to free ${(memoryToFree / 1024 / 1024).toFixed(1)}MB for ${focusedHash.substring(0, 8)}`);
        
        // Get all focused image hashes
        const focusedHashes = this._getFocusedImageHashes();
        
        // Build list of eviction candidates (non-focused textures)
        const candidates = [];
        for (const [hash, nodeCache] of this.textureCache) {
            if (focusedHashes.has(hash)) continue; // Skip all focused images
            
            for (const [lodSize, textureData] of nodeCache) {
                candidates.push({
                    hash,
                    lodSize,
                    texture: textureData.texture,
                    memorySize: textureData.memorySize,
                    lastUsed: textureData.lastUsed,
                    priority: lodSize === null ? 1 : (lodSize > 512 ? 2 : 3) // Prioritize evicting full-res and large textures
                });
            }
        }
        
        // Sort by priority (lower = evict first) and then by last used
        candidates.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return a.lastUsed - b.lastUsed; // Older first
        });
        
        // Evict until we have enough space
        let freedMemory = 0;
        const evicted = [];
        
        for (const candidate of candidates) {
            if (freedMemory >= memoryToFree) break;
            
            // Delete texture
            this.gl.deleteTexture(candidate.texture);
            this.totalMemory -= candidate.memorySize;
            freedMemory += candidate.memorySize;
            
            // Remove from cache
            const nodeCache = this.textureCache.get(candidate.hash);
            if (nodeCache) {
                nodeCache.delete(candidate.lodSize);
                if (nodeCache.size === 0) {
                    this.textureCache.delete(candidate.hash);
                }
            }
            
            // Remove from access order
            const index = this.accessOrder.findIndex(
                item => item.hash === candidate.hash && item.lodSize === candidate.lodSize
            );
            if (index !== -1) {
                this.accessOrder.splice(index, 1);
            }
            
            evicted.push(`${candidate.hash.substring(0, 8)}_${candidate.lodSize || 'FULL'}`);
        }
        
        if (evicted.length > 0) {
            console.log(`🧹 Smart eviction: freed ${(freedMemory / 1024 / 1024).toFixed(1)}MB by evicting ${evicted.length} textures`);
            console.log(`📊 Memory after eviction: ${(this.totalMemory / 1024 / 1024).toFixed(1)}MB / ${(this.maxTextureMemory / 1024 / 1024).toFixed(1)}MB`);
        }
    }
    
    /**
     * Get memory usage statistics
     */
    getStats() {
        return {
            ...this.stats,
            totalMemory: this.totalMemory,
            textureCount: this.accessOrder.length,
            queueLength: this.uploadQueue.length,
            memoryByLOD: this.getMemoryByLOD()
        };
    }
    
    /**
     * Get memory usage breakdown by LOD size
     */
    getMemoryByLOD() {
        const breakdown = {};
        let totalCalculated = 0;
        
        for (const [hash, nodeCache] of this.textureCache) {
            for (const [lodSize, textureData] of nodeCache) {
                const key = lodSize || 'FULL';
                if (!breakdown[key]) {
                    breakdown[key] = { count: 0, memory: 0 };
                }
                breakdown[key].count++;
                breakdown[key].memory += textureData.memorySize;
                totalCalculated += textureData.memorySize;
            }
        }
        
        // Add summary
        breakdown.total = {
            count: this.accessOrder.length,
            memory: totalCalculated,
            reportedMemory: this.totalMemory
        };
        
        return breakdown;
    }
    
    /**
     * Debug: Log current cache contents
     */
    logCacheContents() {
        // console.log(`\n📊 Texture Cache Contents:`);
        // console.log(`Total memory: ${(this.totalMemory / 1024 / 1024).toFixed(1)}MB / ${(this.maxTextureMemory / 1024 / 1024).toFixed(1)}MB`);
        // console.log(`Total textures: ${this.accessOrder.length}`);
        
        const textureSummary = new Map();
        for (const [hash, nodeCache] of this.textureCache) {
            for (const [lodSize, textureData] of nodeCache) {
                const key = `${hash.substring(0, 8)}_${lodSize || 'FULL'}`;
                textureSummary.set(key, {
                    size: lodSize,
                    width: textureData.width,
                    height: textureData.height,
                    memory: textureData.memorySize
                });
            }
        }
        
        // Sort by memory usage
        const sorted = Array.from(textureSummary.entries()).sort((a, b) => b[1].memory - a[1].memory);
        
        // console.log(`\nTop textures by memory:`);
        sorted.slice(0, 10).forEach(([key, data]) => {
            // console.log(`  ${key}: ${data.width}x${data.height} = ${(data.memory / 1024 / 1024).toFixed(1)}MB`);
        });
        
        // Group by hash
        const byHash = new Map();
        for (const [hash, nodeCache] of this.textureCache) {
            const sizes = Array.from(nodeCache.keys()).map(s => s || 'FULL').join(', ');
            const totalMem = Array.from(nodeCache.values()).reduce((sum, d) => sum + d.memorySize, 0);
            byHash.set(hash.substring(0, 8), { sizes, totalMem });
        }
        
        // Debug logging disabled - uncomment if needed
        // console.log(`\nTextures by image:`);
        // byHash.forEach((data, hash) => {
        //     console.log(`  ${hash}: [${data.sizes}] = ${(data.totalMem / 1024 / 1024).toFixed(1)}MB`);
        // });
    }
    
    /**
     * Invalidate cache for a specific hash
     * @param {string} hash - The hash to invalidate
     */
    invalidateHash(hash) {
        if (!this.textureCache.has(hash)) return;
        
        // Only log invalidation for debugging when enabled
        if (window.DEBUG_LOD_STATUS) {
            console.log(`🔄 LOD Manager: Invalidating cache for ${hash.substring(0, 8)}`);
        }
        
        // Delete all GL textures for this hash
        const hashCache = this.textureCache.get(hash);
        if (hashCache) {
            for (const lodData of hashCache.values()) {
                if (lodData.texture) {
                    this.gl.deleteTexture(lodData.texture);
                }
            }
        }
        
        // Remove from caches
        this.textureCache.delete(hash);
        
        // Remove from access order
        const index = this.accessOrder.findIndex(item => item.hash === hash);
        if (index !== -1) {
            this.accessOrder.splice(index, 1);
        }
        
        // Remove any pending uploads for this hash
        this.uploadQueue = this.uploadQueue.filter(item => item.hash !== hash);
    }
    
    /**
     * Clear all cached textures
     */
    clear() {
        // Delete all GL textures
        for (const hashCache of this.textureCache.values()) {
            for (const lodData of hashCache.values()) {
                if (lodData.texture) {
                    this.gl.deleteTexture(lodData.texture);
                }
            }
        }
        
        this.textureCache.clear();
        this.uploadQueue.length = 0;
        this.accessOrder.length = 0;
        this.activelyRenderedTextures.clear();
        console.log('🧹 LOD Manager: Cleared all textures');
    }
    
    /**
     * Clear the list of actively rendered textures (call at start of each frame)
     */
    clearActivelyRendered() {
        // Only clear if enough time has passed (prevent clearing mid-frame)
        const now = Date.now();
        if (now - this.lastActiveUpdate > 16) { // 16ms = ~60fps
            this.activelyRenderedTextures.clear();
            this.lastActiveUpdate = now;
        }
    }
    
    /**
     * Get all available LOD sizes for a given hash
     * @param {string} hash - Image hash
     * @returns {Array<number|null>} Array of available LOD sizes
     */
    getAvailableLODs(hash) {
        const nodeCache = this.textureCache.get(hash);
        if (!nodeCache) return [];
        
        return Array.from(nodeCache.keys()).sort((a, b) => {
            // Sort by size (null = full res goes last)
            if (a === null) return 1;
            if (b === null) return -1;
            return b - a; // Descending order
        });
    }
    
    markHighZoomNode(hash) {
        this._highZoomNodes.add(hash);
    }
    
    clearHighZoomNodes() {
        this._highZoomNodes.clear();
    }
    
    _isHighZoomNode(hash) {
        return this._highZoomNodes.has(hash);
    }
    
    /**
     * Throttled image decoding to prevent performance issues on page reload
     */
    async _throttledDecode(source, hash, lodSize) {
        // Check if already decoded
        if (this.decodedCache.has(source)) {
            return this.decodedCache.get(source);
        }
        
        // If source is already an ImageBitmap, return as-is
        if (source instanceof ImageBitmap) {
            return source;
        }
        
        // For small thumbnails (64px), decode immediately without throttling
        if (lodSize <= 64) {
            try {
                const decoded = await createImageBitmap(source, { imageOrientation: 'from-image' });
                this.decodedCache.set(source, decoded);
                return decoded;
            } catch (error) {
                throw error;
            }
        }
        
        // Wait for decode slot - this prevents too many concurrent decodes
        // Use dynamic limit based on initial load state
        const currentMaxDecodes = this.isInitialLoad ? 6 : this.maxConcurrentDecodes;
        while (this.activeDecodes >= currentMaxDecodes) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        this.activeDecodes++;
        
        try {
            // Use requestIdleCallback for non-critical decodes during bulk loading
            // This helps prevent blocking the main thread
            if (this.uploadQueue.length > 5) {
                await new Promise(resolve => {
                    if (window.requestIdleCallback) {
                        window.requestIdleCallback(() => resolve(), { timeout: 50 });
                    } else {
                        setTimeout(resolve, 0);
                    }
                });
            }
            
            const decoded = await createImageBitmap(source, { imageOrientation: 'from-image' });
            this.decodedCache.set(source, decoded);
            return decoded;
            
        } finally {
            this.activeDecodes--;
        }
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TextureLODManager;
}

// Make available globally for browser environments
if (typeof window !== 'undefined') {
    window.TextureLODManager = TextureLODManager;
    
    // Debug helper
    window.checkTextureCache = () => {
        if (window.app?.graphCanvas?.webglRenderer?.lodManager) {
            window.app.graphCanvas.webglRenderer.lodManager.logCacheContents();
        } else {
            console.log('TextureLODManager not found');
        }
    };
}