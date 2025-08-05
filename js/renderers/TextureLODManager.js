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
        this.maxTextureMemory = options.maxMemory || 1024 * 1024 * 1024; // 1GB default - increased for better high-res support
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
        
        
        // Find best available texture - smallest that meets requirements
        let bestTexture = null;
        let bestSize = Infinity;
        let fallbackTexture = null;
        let fallbackSize = 0;
        
        // Iterate through all available textures
        for (const [lodSize, textureData] of nodeCache) {
            const currentSize = lodSize || Infinity; // null means full resolution
            
            if (currentSize >= targetSize) {
                // This texture is large enough - check if it's better than current best
                if (currentSize < bestSize) {
                    bestTexture = textureData.texture;
                    bestSize = currentSize;
                }
            } else {
                // This texture is too small, but keep track of largest available
                if (currentSize > fallbackSize) {
                    fallbackTexture = textureData.texture;
                    fallbackSize = currentSize;
                }
            }
        }
        
        // Use best match or fallback to largest available
        let selectedTexture = bestTexture || fallbackTexture;
        let selectedSize = bestTexture ? bestSize : fallbackSize;
        
        if (selectedTexture) {
            const actualLodSize = selectedSize === Infinity ? null : selectedSize;
            this._markAccessed(hash, actualLodSize);
            this.stats.cacheHits++;
            
            // Removed verbose texture size warnings
        } else {
            this.stats.cacheMisses++;
        }
        
        return selectedTexture;
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
        // Debug: Log requests for small images (disabled for performance)
        // if (lodSize && lodSize > 64 && priority >= 0) {
        //     console.log(`📥 Requesting ${lodSize}px texture for ${hash.substring(0, 8)} (priority: ${priority})`);
        // }
        
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
        
        // Reduce budget during any kind of animation or interaction
        const budgetMs = this.canvas?.isInteracting ? 0.5 : this.uploadBudgetMs;
        
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
            
            // Limit concurrent uploads to prevent too many ImageBitmap creations
            // Reduce to 1 upload at a time to minimize blocking
            if (uploads.length >= 1) {
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
                
                // ALWAYS use createImageBitmap for guaranteed decoded image
                // Never fall back to raw image to avoid synchronous decode
                try {
                    decodedSource = await createImageBitmap(source, { imageOrientation: 'from-image' });
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
            
            // Log large textures
            if (memorySize > 100 * 1024 * 1024) { // > 100MB
                console.log(`⚠️ Large texture: ${width}x${height} = ${(memorySize / 1024 / 1024).toFixed(1)}MB for ${hash.substring(0, 8)}`);
            }
            
            // Check if this is a full-res texture and enforce limit
            if (lodSize === null) {
                this._enforceFullResLimit();
            }
            
            // Check memory limits and evict if necessary
            this._enforceMemoryLimit(memorySize);
            
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
            
            // Check if texture is oversized for its screen space and reject it
            // Never reject 64px textures as they are the smallest available
            if (screenSize && lodSize && lodSize > 64) {
                // Calculate the optimal LOD for this screen size
                const optimalLOD = this.getOptimalLOD(screenSize);
                // Allow up to 2x the optimal LOD to account for quality multiplier
                const maxAcceptable = Math.max(optimalLOD * 2, 64); // Never go below 64px
                
                if (lodSize > maxAcceptable) {
                    console.warn(`🚫 Rejecting oversized ${lodSize}px texture for ${Math.round(screenSize)}px screen space (optimal: ${optimalLOD}px, max: ${maxAcceptable}px)`);
                    // Delete the texture we just created
                    gl.deleteTexture(texture);
                    // Remove from cache if it was added
                    const nodeCache = this.textureCache.get(hash);
                    if (nodeCache) {
                        nodeCache.delete(lodSize);
                    }
                    this.totalMemory -= memorySize;
                    return; // Don't complete the upload
                }
            }
            
            // Mark as accessed
            this._markAccessed(hash, lodSize);
            
            // Mark as recently loaded to prevent thrashing
            const key = `${hash}_${lodSize}`;
            this.recentlyLoadedTextures.set(key, Date.now());
            
            // If we're in focus mode (very few visible images), be more aggressive about loading
            if (isVisible && this._isInFocusMode()) {
                console.log(`🔍 Focus mode detected - aggressively loading ${lodSize || 'FULL'}px for ${hash.substring(0, 8)}`);
                // In focus mode, immediately try to free memory for this texture
                this._aggressivelyFreeMemoryForFocusedImage(hash);
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
            
            // Check if this is a full-res texture and enforce limit
            if (lodSize === null) {
                this._enforceFullResLimit();
            }
            
            // Check memory limits and evict if necessary
            this._enforceMemoryLimit(memorySize);
            
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
            
            // if (lodSize === null || lodSize > 1024) {
            //     console.log(`📤 Uploaded ${lodSize || 'FULL'}px texture for ${hash.substring(0, 8)} - ${source.width}x${source.height} = ${(memorySize / 1024 / 1024).toFixed(1)}MB (total: ${(this.totalMemory / 1024 / 1024).toFixed(1)}MB / ${(this.maxTextureMemory / 1024 / 1024).toFixed(1)}MB)`);
            // }
            
            // Mark as accessed
            this._markAccessed(hash, lodSize);
            
            // Mark as recently loaded to prevent thrashing
            const key = `${hash}_${lodSize}`;
            this.recentlyLoadedTextures.set(key, Date.now());
            
            // If we're in focus mode, be more aggressive about loading
            if (isVisible && this._isInFocusMode()) {
                console.log(`🔍 Focus mode detected - aggressively loading ${lodSize || 'FULL'}px for ${hash.substring(0, 8)}`);
                this._aggressivelyFreeMemoryForFocusedImage(hash);
            }
            
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
        // Only enforce if we're using more than 50% of memory
        if (this.totalMemory < this.maxTextureMemory * 0.5) {
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
        
        // If still need space, use regular LRU eviction
        let skippedCount = 0;
        const maxSkips = this.accessOrder.length; // Prevent infinite loop
        
        while (this.totalMemory + requiredMemory > this.maxTextureMemory && 
               this.accessOrder.length > 0 && skippedCount < maxSkips) {
            // Get least recently used
            const lru = this.accessOrder.shift();
            if (!lru) break;
            
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
            if (loadTime && Date.now() - loadTime < this.recentTextureProtectionTime) {
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
     * @param {number} screenWidth - Screen width in pixels
     * @param {number} screenHeight - Screen height in pixels
     * @returns {number|null} Optimal LOD size
     */
    getOptimalLOD(screenWidth, screenHeight) {
        // Note: screenWidth/screenHeight should already include DPR multiplier
        const targetSize = Math.max(screenWidth, screenHeight);
        
        // Quality multiplier - we want slightly higher res than screen size for quality
        // For very small sizes (thumbnails), use lower multiplier to save memory
        let qualityMultiplier = this.qualityMultiplier || 1.2;
        if (targetSize < 100) {
            qualityMultiplier = 1.0; // No upscaling for tiny thumbnails
        } else if (targetSize < 200) {
            qualityMultiplier = 1.1; // Minimal upscaling for small images
        }
        
        const desiredSize = targetSize * qualityMultiplier;
        
        // Debug LOD selection - commented out to reduce spam
        // if (this.canvas?.viewport?.scale < 0.3) {
        //     console.log(`🎯 LOD selection: targetSize=${Math.round(targetSize)}px (with DPR), desired=${Math.round(desiredSize)}px, qualityMult=${qualityMultiplier}`);
        // }
        
        // Select appropriate LOD based on effective screen size (already includes DPR)
        // Smoother transitions with ~1.5x steps to reduce jarring quality jumps
        if (desiredSize <= 80) {
            return 64;
        } else if (desiredSize <= 160) {
            return 128;
        } else if (desiredSize <= 320) {
            return 256;
        } else if (desiredSize <= 640) {
            return 512;
        } else if (desiredSize <= 1280) {
            return 1024;
        } else if (desiredSize <= 3000) {
            return 2048;
        } else {
            // For very large sizes, use full resolution
            return null;
        }
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
            const screenSize = Math.max(screenWidth, screenHeight);
            const effectiveScreenSize = screenSize * (this.canvas?.viewport?.dpr || 1);
            const optimalLOD = this.getOptimalLOD(effectiveScreenSize);
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
                        screenSize: Math.round(screenSize),
                        optimal: this.getOptimalLOD(screenSize * (this.canvas?.viewport?.dpr || 1))
                    });
                }
            }
            
            // Clean up empty cache entries
            if (nodeCache.size === 0) {
                this.textureCache.delete(node.properties.hash);
            }
        }
        
        if (evicted.length > 0) {
            console.log(`🧹 Evicted ${evicted.length} oversized textures:`, 
                evicted.map(e => `${e.size}px for ${e.screenSize}px screen (optimal: ${e.optimal}px)`).join(', '));
        }
        
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
     * Check if we're in focus mode (only 1-2 images visible)
     * @private
     * @returns {boolean}
     */
    _isInFocusMode() {
        if (!this.canvas || !this.canvas.viewport) return false;
        
        const visibleNodes = this.canvas.viewport.getVisibleNodes?.(
            this.canvas.graph?.nodes || [],
            200 // margin
        );
        
        if (!visibleNodes) return false;
        
        // Count visible image nodes
        const visibleImageCount = visibleNodes.filter(node => 
            node.type === 'image' && node.properties?.hash
        ).length;
        
        // Focus mode if 2 or fewer images visible
        return visibleImageCount > 0 && visibleImageCount <= 2;
    }
    
    /**
     * Aggressively free memory for focused image by evicting everything else
     * @private
     * @param {string} focusedHash - Hash of the focused image
     */
    _aggressivelyFreeMemoryForFocusedImage(focusedHash) {
        console.log(`🎯 Aggressively freeing memory for focused image: ${focusedHash.substring(0, 8)}`);
        
        const texturesEvicted = [];
        
        // Go through all textures and evict everything except the focused hash
        for (const [hash, nodeCache] of this.textureCache) {
            if (hash === focusedHash) continue; // Skip the focused image
            
            for (const [lodSize, textureData] of nodeCache) {
                // Only keep small preview textures (128px and below) for other images
                if (lodSize === null || lodSize > 128) {
                    // Delete texture
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
                    
                    texturesEvicted.push(`${hash.substring(0, 8)}_${lodSize || 'FULL'}`);
                }
            }
            
            // Remove hash entry if no more textures
            if (nodeCache.size === 0) {
                this.textureCache.delete(hash);
            }
        }
        
        if (texturesEvicted.length > 0) {
            console.log(`🧹 Focus mode: Evicted ${texturesEvicted.length} textures to make room for focused image`);
            console.log(`📊 Memory after focus eviction: ${(this.totalMemory / 1024 / 1024).toFixed(1)}MB / ${(this.maxTextureMemory / 1024 / 1024).toFixed(1)}MB`);
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