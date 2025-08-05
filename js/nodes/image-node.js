// ===================================
// IMAGE NODE CLASS
// ===================================

class ImageNode extends BaseNode {
    constructor() {
        super('media/image');
        this.title = 'Image';
        // IMPORTANT: No src field! Only references
        this.properties = { 
            hash: null,           // Primary identifier for cache lookup
            serverUrl: null,      // Server reference if uploaded
            filename: null,       // Original filename
            scale: 1.0           // Display scale
        };
        this.flags = { hide_title: true };
        this.img = null;
        // Remove individual thumbnail storage - use global cache
        this.thumbnailSizes = CONFIG.THUMBNAILS.SIZES; // Use config sizes: [64, 256, 512]
        this.aspectRatio = 1;
        this.originalAspect = 1;
        this.originalWidth = null;
        this.originalHeight = null;
        this.size = [200, 200];
        // Ensure redraw helper
        this._triggerRedraw = () => {
            const canvas = this.graph?.canvas;
            if (canvas) {
                canvas.dirty_canvas = true;
                if (typeof canvas.forceRedraw === 'function') {
                    canvas.forceRedraw();
                }
            }
        };
        // Color adjustments (non-destructive, used by WebGL renderer)
        this.adjustments = {
            brightness: 0.0, // range -1..1
            contrast: 0.0,   // range -1..1
            saturation: 0.0, // range -1..1
            hue: 0.0         // degrees -180..180
        };
        
        // Color balance (non-destructive, used by WebGL renderer)
        this.colorBalance = null; // Will be initialized when first used
        this.colorBalanceBypassed = true; // Bypass by default for performance
        
        // Bypass flags for all color correction operations
        this.toneCurveBypassed = true; // Bypass tone curve by default
        this.colorAdjustmentsBypassed = true; // Bypass adjustments by default

        this.needsGLUpdate = false; // flag for renderer cache

        this.aspectRatioLocked = true; // Lock aspect ratio by default
        this.lockedAspectRatio = 1; // Will be updated when image loads
        
        this._thumbnailUpdateCallback = null; // For cache notifications

        // Progressive loading state
        this.loadingState = 'idle'; // idle, loading, loaded, error - start as idle, will be set to loading when needed
        this.loadingProgress = 0; // 0-1 for unified progress tracking
        this.thumbnailProgress = 0; // Separate progress for thumbnail generation
        this.displayedProgress = 0; // Smoothed progress for display
        this.primaryLoadCompleteTime = null; // Track when primary loading finished to prevent flicker
        
        // Memory management
        this.isUnloaded = false; // Track if image was unloaded due to memory pressure
        this._forceThumbnailSize = null; // Force specific thumbnail size during memory pressure
    }
    
    async setImage(src, filename = null, hash = null) {
        
        // Store only references, not the data
        this.properties.filename = filename;
        this.properties.hash = hash;
        
        // If src is a server URL, store it as serverUrl
        if (src && !src.startsWith('data:')) {
            this.properties.serverUrl = src;
        }
        
        // Cache the data URL if provided (but don't store in properties!)
        if (src && src.startsWith('data:') && hash && window.imageCache) {
            window.imageCache.set(hash, src);
            console.log(`💾 Cached image data for hash ${hash.substring(0, 8)}...`);
        }
        
        // Check if we already have thumbnails
        const hasThumbnails = hash && window.thumbnailCache && window.thumbnailCache.hasThumbnails(hash);
        
        // Only set loading state if we don't have thumbnails or preview (no visual content yet)
        if (!hasThumbnails && this.loadingState !== 'preview' && (!this.loadingState || this.loadingState === 'idle')) {
            this.loadingState = 'loading';
            this.loadingProgress = 0.1; // 10% for starting load
            this.thumbnailProgress = 0; // Reset thumbnail progress for new load
        } else if (this.loadingState === 'preview' && !hasThumbnails) {
            // Keep preview state but start loading full image
            this.loadingProgress = 0.1;
        }
        
        // console.log(`🖼️ setImage called - node:${this.id || 'pending'} loadingState:${this.loadingState} hash:${hash?.substring(0, 8) || 'none'}`)
        
        // Only set title if it's empty or undefined
        // This preserves user-customized titles while ensuring new nodes get a title
        if (filename && !this.title) {
            this.title = filename;
        }
        
        // Resolve the actual image source
        const imageSrc = await this.resolveImageSource(src);
        if (!imageSrc) {
            // Check if this is a temporary node (alt-drag duplication)
            if (this._isTemporary) {
                // Keep loading state for temporary nodes to show spinner
                this.loadingState = 'loading';
                this.loadingProgress = 0.5; // Show some progress
                
            } else {
                
                // Don't set error state immediately - the image might still be uploading
                // Keep it in loading state to show progress ring
                if (!this.properties.serverUrl && !this.properties.hash) {
                    // Only error if we have no way to get the image
                    this.loadingState = 'error';
                } else if (this.properties.hash && !this._retryScheduled) {
                    // We have a hash but no data yet - schedule a retry
                    this._retryCount = (this._retryCount || 0) + 1;
                    
                    // Max 10 retries to prevent infinite loops
                    if (this._retryCount < 10) {
                        this._retryScheduled = true;
                        const retryDelay = Math.min(1000 * Math.pow(1.5, this._retryCount - 1), 30000); // Exponential backoff, max 30s
                        setTimeout(() => {
                            this._retryScheduled = false;
                            this._sourceErrorLogged = false; // Allow logging again
                            this.setImage(this.properties.serverUrl, this.properties.filename, this.properties.hash);
                        }, retryDelay);
                    } else {
                        console.error(`❌ Max retries reached for node ${this.id} (hash: ${this.properties.hash?.substring(0, 8)}...) - image unavailable`);
                        this.loadingState = 'error';
                    }
                }
            }
            return;
        }
        
        // DISABLED: Canvas2D image loading - only WebGL handles images now
        // WebGL will handle all texture loading through its LOD system
        this.loadingState = 'webgl-only';
        return;
        
        /* DISABLED CODE - keeping for reference
        try {
            // Load image with progress tracking
            this.img = await this.loadImageAsyncOptimized(imageSrc);
            this.loadingState = 'loaded';
            this.primaryLoadCompleteTime = Date.now(); // Track completion time to prevent flicker
            this.isUnloaded = false; // Reset unloaded flag
            this._retryCount = 0; // Reset retry count on successful load
            
            // Keep preview data until image is fully decoded and displayed
            // This prevents flickering during the transition
            if (this._previewUrl && this.img.complete) {
                // Schedule preview cleanup after a short delay to ensure smooth transition
                setTimeout(() => {
                    if (this.img && this.img.complete && this.loadingState === 'loaded') {
                        delete this._previewUrl;
                        delete this._previewImg;
                    }
                }, 100);
            }
            // Progress is now handled in loadImageAsyncOptimized
            
            // Register with memory manager
            if (window.memoryManager) {
                window.memoryManager.registerImage(this.id, this.img);
            }
            
            // Force immediate redraw to show loaded image
            const canvas = this.graph?.canvas || window.app?.graphCanvas;
            if (canvas && canvas.forceRedraw) {
                canvas.forceRedraw();
            } else {
                console.warn(`⚠️ Cannot force redraw - canvas:${!!canvas} forceRedraw:${!!(canvas && canvas.forceRedraw)}`);
            }
            
            // Store native dimensions
            this.originalWidth = this.img.width || this.img.naturalWidth;
            this.originalHeight = this.img.height || this.img.naturalHeight;
            
            // Initialize last rendered resolution to full resolution
            this.setLastRenderedResolution(this.originalWidth, this.originalHeight, 'full');
            
            // Calculate actual aspect ratio from loaded image
            const actualAspectRatio = this.img.width / this.img.height;
            this.originalAspect = actualAspectRatio;
            
            // Only update node aspect ratio and size if it's significantly different or was default
            const currentAspectRatio = this.size[0] / this.size[1];
            const aspectDifference = Math.abs(currentAspectRatio - actualAspectRatio);
            const isDefaultAspect = Math.abs(this.aspectRatio - 1) < 0.001; // Was default square
            
            if (isDefaultAspect || aspectDifference > 0.1) {
                // Update aspect ratio and size only if needed
                this.aspectRatio = actualAspectRatio;
                this.size[0] = this.size[1] * this.aspectRatio;
                // console.log(`📐 Updated aspect ratio for ${this.properties?.filename}: ${actualAspectRatio.toFixed(3)} (was ${currentAspectRatio.toFixed(3)})`);
            } else {
                // Keep existing size but update internal aspect ratio
                this.aspectRatio = actualAspectRatio;
                //console.log(`📐 Preserved aspect ratio for ${this.properties?.filename}: ${currentAspectRatio.toFixed(3)} (actual: ${actualAspectRatio.toFixed(3)})`);
            }
            
            // Update locked aspect ratio
            this.lockedAspectRatio = this.size[0] / this.size[1];
            
            // Report load completion to progress tracker
            if (hash && window.imageProcessingProgress) {
                window.imageProcessingProgress.updateLoadProgress(hash, 1);
            }
            
            // Clear render cache when image changes
            this._cachedRenderData = null;
            this._lastScale = null;
            
            // Invalidate offscreen render cache
            if (window.offscreenRenderCache) {
                window.offscreenRenderCache.invalidate(this.id);
            }
            
            // Use global thumbnail cache - non-blocking and shared!
            if (hash && window.thumbnailCache) {
                // Add filename to image element for thumbnail cache access
                if (this.properties?.filename) {
                    this.img.setAttribute('data-filename', this.properties.filename);
                }
                
                                // Generate thumbnails for better performance
                const isVisible = this._isNodeVisible();
                const priority = isVisible ? 'high' : 'normal';
                
                if (window.Logger.isEnabled('THUMBNAIL_GENERATION')) {
                    window.Logger.imageNode('info', `🎬 Triggering thumbnail generation for ${hash.substring(0, 8)} (visible: ${isVisible}, priority: ${priority})`);
                }
                
                window.thumbnailCache.generateThumbnailsProgressive(
                    hash, 
                    this.img,
                    (progress) => {
                        this.thumbnailProgress = progress;
                        
                        if (window.Logger.isEnabled('THUMBNAIL_GENERATION')) {
                            window.Logger.imageNode('debug', `📊 Thumbnail progress for ${hash.substring(0, 8)}: ${(progress * 100).toFixed(0)}%`);
                        }
                        
                        // When thumbnails are complete, invalidate cached render data
                        if (progress >= 1.0) {
                            window.Logger.imageNode('info', `🎉 Thumbnails complete for ${hash.substring(0, 8)}, invalidating render cache`);
                            // Small delay to ensure thumbnails are actually stored in cache
                            setTimeout(() => {
                                this._cachedRenderData = null;
                                this._lastScale = null;
                                this._cachedThumbnailSize = null;
                                this._cachedScreenSize = null;
                                
                                // Verify thumbnails are actually available now
                                if (window.thumbnailCache.hasThumbnails(hash)) {
                                    // Force immediate redraw to show new thumbnails
                                    if (this.graph?.canvas) {
                                        this.graph.canvas.dirty_canvas = true;
                                        window.Logger.imageNode('debug', `🎨 Forcing canvas redraw for ${hash.substring(0, 8)}`);
                                        // Also immediately trigger a render to see new thumbnails
                                        this.graph.canvas.draw(true, true);
                                    }
                                } else {
                                    window.Logger.imageNode('warn', `⚠️ Thumbnails still not available for ${hash.substring(0, 8)} after completion`);
                                }
                            }, 100); // Increased delay to 100ms to ensure thumbnails are fully stored
                        }
                        
                        // Trigger redraw for progress updates
                        if (this.graph?.canvas) {
                            this.graph.canvas.dirty_canvas = true;
                        }
                    },
                    priority
                );
            }
            
            this.onResize();
            // markDirty() not needed - forceRedraw() already called above
            
        } catch (error) {
            console.error('Failed to load image:', error);
            this.loadingState = 'error';
            this.loadingProgress = 0;
        }
        */ // END OF DISABLED CODE
    }
    
    loadImageAsync(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                // Trigger redraw when image loads
                const canvas = this.graph?.canvas || window.app?.graphCanvas;
                if (canvas) {
                    canvas.dirty_canvas = true;
                }
                resolve(img);
            };
            img.onerror = reject;
            img.src = src;
        });
    }
    
    /**
     * Resolve image source from references
     * Priority: direct src > cache > serverUrl > resourceCache
     */
    async resolveImageSource(src) {
        // 1. If we have a direct source, check if it needs conversion
        if (src) {
            // Convert relative server URLs to absolute
            // More specific check for known upload paths
            if (src.startsWith('/uploads/') || src.startsWith('/thumbnails/')) {
                const absoluteUrl = CONFIG.SERVER.API_BASE + src;
                return absoluteUrl;
            }
            // Return data URLs and absolute URLs as-is
            return src;
        }
        
        // 2. Try to get from image cache using hash
        if (this.properties.hash && window.imageCache) {
            const cached = window.imageCache.get(this.properties.hash);
            if (cached) {
                return cached;
            }
        }
        
        // 3. Try server URL
        if (this.properties.serverUrl) {
            // Convert relative URL to absolute if needed
            const url = this.properties.serverUrl.startsWith('http') 
                ? this.properties.serverUrl 
                : CONFIG.SERVER.API_BASE + this.properties.serverUrl;
            return url;
        }
        
        // 4. Try resource cache (for duplicated nodes)
        if (this.properties.hash && window.app?.imageResourceCache) {
            const resource = window.app.imageResourceCache.get(this.properties.hash);
            // console.log(`🔍 Resource cache lookup for ${this.properties.hash.substring(0, 8)}:`, resource);
            if (resource?.url) {
                console.log(`📂 Found resource cache URL for ${this.properties.hash.substring(0, 8)}: ${resource.url.substring(0, 50)}...`);
                return resource.url;
            }
        }
        
        // 5. No source available
        // Only log error once per node to avoid spam
        if (!this._sourceErrorLogged) {
            this._sourceErrorLogged = true;
            // console.warn(`⏳ No image source available yet for node ${this.id} (hash: ${this.properties.hash?.substring(0, 8)}...) - will retry`);
        }
        return null;
    }
    
    loadImageAsyncOptimized(src) {
        // Use ImageLoadManager for deduplication and throttling
        if (this.properties.hash && window.imageLoadManager) {
            // Progress callback to update this node's progress
            const progressCallback = (progress) => {
                this.loadingProgress = progress;
                
                // Trigger redraw for progress updates
                const canvas = this.graph?.canvas || window.app?.graphCanvas;
                if (canvas) {
                    canvas.dirty_canvas = true;
                    
                    // Force redraw at key progress points
                    if (progress >= 0.9 && canvas.forceRedraw) {
                        canvas.forceRedraw();
                    }
                }
            };
            
            // Use shared loading with deduplication
            return window.imageLoadManager.loadShared(
                this.properties.hash,
                src,
                progressCallback
            );
        }
        
        // Fallback to direct loading if no hash or manager
        return this.loadImageDirect(src);
    }
    
    // Original loading logic as fallback
    loadImageDirect(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            
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
                                            this.loadingProgress = 0.9; // 90% when loaded
                                            
                                            // Trigger redraw when image loads
                                            const canvas = this.graph?.canvas || window.app?.graphCanvas;
                                            if (canvas) {
                                                canvas.dirty_canvas = true;
                                            }
                                            
                                            if (img.decode) {
                                                img.decode()
                                                    .then(() => {
                                                        this.loadingProgress = 1.0; // 100% when decoded
                                                        // Force redraw after decode
                                                        const canvas = this.graph?.canvas || window.app?.graphCanvas;
                                                        if (canvas && canvas.forceRedraw) {
                                                            canvas.forceRedraw();
                                                        } else if (canvas) {
                                                            canvas.dirty_canvas = true;
                                                        }
                                                        resolve(img);
                                                    })
                                                    .catch(() => {
                                                        this.loadingProgress = 1.0;
                                                        resolve(img);
                                                    });
                                            } else {
                                                this.loadingProgress = 1.0;
                                                resolve(img);
                                            }
                                        };
                                        img.src = blobUrl;
                                        return;
                                    }
                                    
                                    chunks.push(value);
                                    loaded += value.length;
                                    
                                    // Update progress (10% to 80% for download)
                                    this.loadingProgress = 0.1 + (0.7 * (loaded / total));
                                    
                                    // Trigger redraw
                                    if (this.graph?.canvas) {
                                        this.graph.canvas.dirty_canvas = true;
                                    }
                                    
                                    return pump();
                                });
                            };
                            
                            return pump();
                        } else {
                            // No content-length, fall back to simple loading
                            img.onload = () => {
                                this.loadingProgress = 0.9;
                                
                                // Trigger redraw when image loads
                                const canvas = this.graph?.canvas || window.app?.graphCanvas;
                                if (canvas) {
                                    canvas.dirty_canvas = true;
                                }
                                
                                if (img.decode) {
                                    img.decode()
                                        .then(() => {
                                            this.loadingProgress = 1.0;
                                            // Force redraw after decode
                                            const canvas = this.graph?.canvas || window.app?.graphCanvas;
                                            if (canvas && canvas.forceRedraw) {
                                                canvas.forceRedraw();
                                            } else if (canvas) {
                                                canvas.dirty_canvas = true;
                                            }
                                            resolve(img);
                                        })
                                        .catch(() => {
                                            this.loadingProgress = 1.0;
                                            resolve(img);
                                        });
                                } else {
                                    this.loadingProgress = 1.0;
                                    resolve(img);
                                }
                            };
                            img.src = src;
                        }
                    })
                    .catch(error => {
                        // Fallback to regular image loading if fetch fails
                        
                        img.onload = () => {
                            this.loadingProgress = 1.0;
                            // Trigger redraw when image loads
                            const canvas = this.graph?.canvas || window.app?.graphCanvas;
                            if (canvas) {
                                canvas.dirty_canvas = true;
                            }
                            resolve(img);
                        };
                        img.src = src;
                    });
            } else {
                // For data URLs or other sources, use regular loading
                img.onload = () => {
                    this.loadingProgress = 0.9;
                    
                    // Trigger redraw when image loads
                    const canvas = this.graph?.canvas || window.app?.graphCanvas;
                    if (canvas) {
                        canvas.dirty_canvas = true;
                    }
                    
                    if (img.decode) {
                        img.decode()
                            .then(() => {
                                this.loadingProgress = 1.0;
                                // Force redraw after decode
                                const canvas = this.graph?.canvas || window.app?.graphCanvas;
                                if (canvas && canvas.forceRedraw) {
                                    canvas.forceRedraw();
                                } else if (canvas) {
                                    canvas.dirty_canvas = true;
                                }
                                resolve(img);
                            })
                            .catch(() => {
                                this.loadingProgress = 1.0;
                                resolve(img);
                            });
                    } else {
                        this.loadingProgress = 1.0;
                        resolve(img);
                    }
                };
                img.src = src;
            }
            
            img.onerror = (error) => {
                console.error(`❌ Failed to load image from: ${src}`, {
                    error,
                    node: this.id,
                    hash: this.properties.hash?.substring(0, 8),
                    crossOrigin: img.crossOrigin
                });
                reject(error);
            };
            
            // Set crossOrigin and loading hints for better performance
            img.crossOrigin = 'anonymous';
            img.loading = 'eager';
        });
    }
    
    /**
     * Degrade image quality due to memory pressure
     */
    degradeQuality(level) {
        if (level === 'thumbnail-only') {
            // Free full image, keep thumbnails
            if (this.img) {
                if (window.memoryManager) {
                    window.memoryManager.unregisterImage(this.id);
                }
                this.img = null;
                this.isUnloaded = true;
                
            }
        } else if (level === 'minimal') {
            // Only use smallest thumbnail (64px)
            this._forceThumbnailSize = 64;
            if (this.img) {
                if (window.memoryManager) {
                    window.memoryManager.unregisterImage(this.id);
                }
                this.img = null;
                this.isUnloaded = true;
                
            }
        }
        
        // Mark canvas dirty for redraw
        const canvas = this.graph?.canvas || window.app?.graphCanvas;
        if (canvas) {
            canvas.dirty_canvas = true;
        }
    }
    
    /**
     * Restore full quality (reload image)
     */
    restoreQuality() {
        if (this.isUnloaded && this.properties.hash) {
            this._forceThumbnailSize = null;
            this.isUnloaded = false;
            
            // Trigger image reload
            this.setImage(
                this.properties.serverUrl,
                this.properties.filename,
                this.properties.hash
            );
        }
    }
    
    // Use global thumbnail cache instead of individual generation
    getBestThumbnail(targetWidth, targetHeight) {
        if (!this.properties.hash || !window.thumbnailCache) return null;
        return window.thumbnailCache.getBestThumbnail(this.properties.hash, targetWidth, targetHeight);
    }
    
    /**
     * Get the best available image to render based on current state
     * Returns: { image, quality, useSmoothing } or null
     */
    getBestAvailableImage() {
        // CANVAS2D IS NOW DISPLAY-ONLY - Never return full images
        // WebGL handles all image loading through its LOD system
        
        const scale = this.graph?.canvas?.viewport?.scale || 1;
        const screenWidth = this.size[0] * scale;
        const screenHeight = this.size[1] * scale;
        
        // Only use thumbnails if available, never full res
        if (this.properties.hash && window.thumbnailCache?.getBestThumbnail) {
            const bestThumbnail = window.thumbnailCache.getBestThumbnail(this.properties.hash, screenWidth, screenHeight);
            if (bestThumbnail) {
                const inferredSize = Math.max(bestThumbnail.width, bestThumbnail.height);
                return { image: bestThumbnail, quality: `thumbnail-${inferredSize}`, useSmoothing: true };
            }
        }
        
        // Return null to show loading state - WebGL will handle the actual image
        return null;
    }
    
    getOptimalLOD(screenWidth, screenHeight) {
        // Simple LOD selection based on screen size
        const screenSize = Math.max(screenWidth, screenHeight);
        
        // Fixed thresholds with small buffer
        if (screenSize <= 96) return 64;
        if (screenSize <= 384) return 256;
        if (screenSize <= 768) return 512;
        return null; // Full resolution
    }
    
    onResize() {
        const currentAspect = this.size[0] / this.size[1];
        const tolerance = 0.001; // Small tolerance for floating point comparison
        
        if (Math.abs(this.aspectRatio - this.originalAspect) < tolerance) {
            // Maintain original aspect ratio
            this.size[1] = this.size[0] / this.aspectRatio;
        } else {
            // Update aspect ratio for non-uniform scaling
            this.aspectRatio = currentAspect;
        }
    }
    
    /**
     * Check if loading ring should be shown (unified logic to prevent flickering)
     */
    shouldShowLoadingRing() {
        // Always show loading ring when WebGL is waiting for textures
        if (this._webglWaiting || this.loadingState === 'webgl-only') {
            return true;
        }
        
        // Show loading ring during initial load when we have nothing to show
        if (this.loadingState === 'loading' && !this.img && !this._previewImg) {
            return true;
        }
        
        // Also show for new nodes that haven't started loading yet
        if (this.loadingState === 'idle' && this.properties.hash && !this.img && !this._previewImg) {
            return true;
        }
        
        // Show loading ring during upload/processing even if we have a preview
        if (this._pendingServerSync || (this.loadingState === 'preview' && !this.img)) {
            return true;
        }
        
        // Show loading ring if we're uploading (no serverUrl yet)
        if (!this.properties.serverUrl && !this.img && this.properties.file) {
            return true;
        }
        
        return false;
    }
    
    _triggerLazyLoad() {
        // DISABLED: WebGL handles all image loading
        // Canvas2D is display-only now
    }
    
    /**
     * Check if this node is currently visible in the viewport
     */
    _isNodeVisible() {
        try {
            if (!this.graph?.canvas?.viewport) return false;
            
            const viewport = this.graph.canvas.viewport;
            const padding = 100; // Small padding for near-visible nodes
            
            // Get viewport bounds
            const viewBounds = {
                left: -viewport.offset[0] - padding,
                top: -viewport.offset[1] - padding,
                right: -viewport.offset[0] + viewport.canvas.width / viewport.scale + padding,
                bottom: -viewport.offset[1] + viewport.canvas.height / viewport.scale + padding
            };
            
            // Check if node intersects with viewport
            const [x, y] = this.pos;
            const [w, h] = this.size;
            
            return (x + w >= viewBounds.left && x <= viewBounds.right &&
                    y + h >= viewBounds.top && y <= viewBounds.bottom);
        } catch (error) {
            
            return false;
        }
    }
    
    /**
     * Defer thumbnail generation for later when node becomes visible
     */
    _deferThumbnailGeneration(hash) {
        // Mark that thumbnails are needed but deferred
        this._thumbnailsDeferred = true;
        
        // Register for viewport change notifications if not already registered
        if (!this._viewportObserver && window.app?.graphCanvas) {
            this._viewportObserver = () => {
                // Check if node is now visible and needs thumbnails
                if (this._thumbnailsDeferred && this._isNodeVisible() && this.img) {
                    
                    this._thumbnailsDeferred = false;
                    
                    window.thumbnailCache.generateThumbnailsProgressive(
                        hash, 
                        this.img, 
                        (progress) => {
                            this.thumbnailProgress = progress;
                            if (this.graph?.canvas) {
                                this.graph.canvas.dirty_canvas = true;
                            }
                        },
                        'high' // High priority since node is now visible
                    );
                    
                    // Unregister observer after generating thumbnails
                    if (window.app.graphCanvas.viewport.removeChangeListener) {
                        window.app.graphCanvas.viewport.removeChangeListener(this._viewportObserver);
                        this._viewportObserver = null;
                    }
                }
            };
            
            // Register viewport change listener if available
            if (window.app.graphCanvas.viewport.addChangeListener) {
                window.app.graphCanvas.viewport.addChangeListener(this._viewportObserver);
            } else {
                // Fallback: check periodically
                setTimeout(() => this._viewportObserver(), 5000);
            }
        }

    }
    
    drawProgressRing(ctx, progress = 0) {
        // Draw the grey placeholder box first
        this.drawPlaceholder(ctx);
        
        // Then draw the progress ring on top
        this.drawProgressRingOnly(ctx, progress);
    }
    
    drawProgressRingOnly(ctx, progress = 0) {
        const centerX = this.size[0] / 2;
        const centerY = this.size[1] / 2;
        
        // Get scale for screen-space calculations with fallbacks
        const scale = this.graph?.canvas?.viewport?.scale || 
                     window.app?.graphCanvas?.viewport?.scale ||
                     1;
        
        // Screen-space consistent line width (4px on screen)
        const lineWidth = 4 / scale;
        
        // Simple radius calculation - just percentage of node size
        const baseRadius = Math.min(this.size[0], this.size[1]) * 0.15; // 15% of smallest dimension
        const radius = baseRadius;
        
        // Draw background ring
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = lineWidth;
        ctx.stroke();
        
        // Draw progress ring (radial fill)
        if (progress > 0) {
            ctx.beginPath();
            // Start from top (-PI/2) and fill clockwise
            const endAngle = -Math.PI / 2 + (progress * Math.PI * 2);
            ctx.arc(centerX, centerY, radius, -Math.PI / 2, endAngle);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        }
    }
    
    drawPlaceholderWithInfo(ctx) {
        // Draw solid background
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, this.size[0], this.size[1]);
        
        // Draw border
        ctx.strokeStyle = '#404040';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, this.size[0], this.size[1]);
    }
    
    drawPlaceholder(ctx, text = 'Loading...') {
        // Draw grey box with border
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, this.size[0], this.size[1]);
        
        ctx.strokeStyle = '#404040';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, this.size[0], this.size[1]);
        
        // Draw text if provided
        if (text) {
            ctx.fillStyle = '#666';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, this.size[0] / 2, this.size[1] / 2);
        }
    }
    
    onDrawForeground(ctx) {
        const scale = this.graph?.canvas?.viewport?.scale || 1;
        
        // Only use offscreen render cache for loaded images, not during loading
        const shouldUseCache = window.offscreenRenderCache && 
                             this.loadingState === 'loaded' && 
                             (this.img || (this.properties.hash && window.thumbnailCache?.hasThumbnails(this.properties.hash)));
        
        if (shouldUseCache) {
            // Check if cache needs invalidation due to changes
            window.offscreenRenderCache.invalidateChanged(this);
            
            const cachedRender = window.offscreenRenderCache.getCachedRender(
                this, 
                scale, 
                (offscreenCtx, node) => {
                    // Render to offscreen canvas
                    const imageData = this.getBestAvailableImage();
                    if (imageData) {
                        offscreenCtx.imageSmoothingEnabled = imageData.useSmoothing;
                        offscreenCtx.drawImage(imageData.image, 0, 0, node.size[0], node.size[1]);
                        
                        // DEBUG: Apply tint based on thumbnail quality
                        if (window.DEBUG_THUMBNAIL_TINT) {
                            this._applyDebugTint(offscreenCtx, imageData.quality, node.size[0], node.size[1]);
                        }
                    }
                }
            );
            
            if (cachedRender) {
                // Draw the cached render
                ctx.drawImage(cachedRender, 0, 0, this.size[0], this.size[1]);
                
                // DISABLED: Lazy loading - WebGL handles all image loading
                return;
            }
        }
        
        // Fallback to direct rendering if no cache available
        const screenWidth = this.size[0] * scale;
        const screenHeight = this.size[1] * scale;
        const requiredLOD = this.getOptimalLOD(screenWidth, screenHeight);

        // Only recalculate if we don't have cached data or if the required LOD has changed
        if (!this._cachedRenderData || this._cachedLOD !== requiredLOD) {
            this._cachedRenderData = this.getBestAvailableImage();
            this._cachedLOD = requiredLOD;
        }
        
        if (this._cachedRenderData) {
            const imageData = this._cachedRenderData;
            
            // Set smoothing based on image quality
            ctx.imageSmoothingEnabled = imageData.useSmoothing;
            
            // Draw the image
            //console.log(`🎨 ACTUALLY DRAWING: quality=${imageData.quality} size=${imageData.image.width}x${imageData.image.height} for ${this.properties.hash?.substring(0, 8)}`);
            ctx.drawImage(imageData.image, 0, 0, this.size[0], this.size[1]);
            
            // DEBUG: Apply tint based on thumbnail quality
            if (window.DEBUG_THUMBNAIL_TINT) {
                this._applyDebugTint(ctx, imageData.quality, this.size[0], this.size[1]);
            }
            
            // DEBUG: Show WebGL LOD status
            if (window.DEBUG_LOD_STATUS && this._webglLOD) {
                this._drawLODStatus(ctx, this._webglLOD);
            }
            
            // DISABLED: Lazy loading - WebGL handles all image loading
            return;
        }
        
        // Check if we have thumbnails available
        const hasThumbnails = this.properties.hash && window.thumbnailCache && 
                             window.thumbnailCache.hasThumbnails(this.properties.hash);
        
        // DISABLED: Auto-loading - WebGL handles all image loading now
        // Canvas2D only displays loading states and thumbnails
        
        // Check unified loading ring condition
        if (this.shouldShowLoadingRing()) {
            // Determine which progress to show
            let targetProgress = this.loadingProgress;
            
            // Check if we should show preview or image behind the ring
            const hasPreview = this._previewUrl && (this.loadingState === 'preview' || this._pendingServerSync);
            const showingImageBehindRing = this.img && this.loadingState === 'loaded';
            
            if (showingImageBehindRing) {
                // Use thumbnail progress for thumbnail generation phase
                targetProgress = this.thumbnailProgress;
                
                ctx.save();
                ctx.globalAlpha = 0.3; // Show faded image behind loading ring
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
                ctx.drawImage(this.img, 0, 0, this.size[0], this.size[1]);
                ctx.restore();
            } else if (hasPreview) {
                // Show preview image behind loading ring during upload
                if (!this._previewImg) {
                    // Create preview image if needed
                    this._previewImg = new Image();
                    this._previewImg.src = this._previewUrl;
                }
                
                if (this._previewImg && this._previewImg.complete) {
                    ctx.save();
                    ctx.globalAlpha = 0.5; // Semi-transparent preview
                    ctx.imageSmoothingEnabled = true;
                    ctx.drawImage(this._previewImg, 0, 0, this.size[0], this.size[1]);
                    ctx.restore();
                }
            }
            
            // Smooth the progress display to prevent jittering
            // Only allow progress to increase, never decrease
            if (targetProgress > this.displayedProgress) {
                // Quick catch-up for large jumps, smooth for small changes
                const diff = targetProgress - this.displayedProgress;
                if (diff > 0.3) {
                    this.displayedProgress = targetProgress; // Jump for large changes
                } else {
                    this.displayedProgress = Math.min(targetProgress, this.displayedProgress + 0.05); // Smooth small changes
                }
            }
            
            // Draw placeholder with info first for instant feedback
            if (!showingImageBehindRing && !this.img && !hasPreview) {
                this.drawPlaceholderWithInfo(ctx);
                // Draw just the progress ring on top
                this.drawProgressRingOnly(ctx, this.displayedProgress);
            } else {
                // Just draw the ring - image or preview is already shown behind
                this.drawProgressRingOnly(ctx, this.displayedProgress);
            }
            return;
        }
        
        if (this.loadingState === 'error') {
            this.drawPlaceholder(ctx, 'Error');
            return;
        }
        
        // Title rendering is handled at canvas level by drawNodeTitle()
    }

    initSubscriptions() {
        if (this.properties.hash && window.thumbnailCache?.subscribe && !this._thumbnailUpdateCallback) {
            this._thumbnailUpdateCallback = () => {
                console.log(`🔔 Thumbnail update for ${this.properties.hash.substring(0,8)}, invalidating render cache.`);
                this._cachedRenderData = null;
                this._cachedLOD = null;
                if (this.graph) {
                    this.graph.canvas.dirty_canvas = true;
                }
            };
            window.thumbnailCache.subscribe(this.properties.hash, this._thumbnailUpdateCallback);
        }
    }
    
    // Track what's actually being rendered
    setLastRenderedResolution(width, height, source) {
        this._lastRenderedResolution = { width, height, source };
    }
    
    getLastRenderedResolution() {
        return this._lastRenderedResolution || null;
    }

    onRemoved() {
        // Unsubscribe from thumbnail updates to prevent memory leaks
        if (this.properties.hash && this._thumbnailUpdateCallback && window.thumbnailCache?.unsubscribe) {
            window.thumbnailCache.unsubscribe(this.properties.hash, this._thumbnailUpdateCallback);
            this._thumbnailUpdateCallback = null;
        }
    }

    /**
     * Merge new adjustment values and mark for re-render.
     */
    updateAdjustments(newValues = {}) {
        Object.assign(this.adjustments, newValues);
        this.needsGLUpdate = true;

        // schedule an immediate frame on the global canvas
        if (window.app?.graphCanvas) {
            requestAnimationFrame(() => {
                window.app.graphCanvas.draw();
            });
        }
    }
    
    /**
     * Update tone curve data and mark for re-render.
     */
    updateToneCurve(curveData) {
        // Simple direct update - the floating panel handles server sync
        this.toneCurve = curveData;
        // Don't set needsGLUpdate here - it causes LUT recreation

        // Force immediate redraw and invalidate any cached state
        if (window.app?.graphCanvas) {
            window.app.graphCanvas.dirty_canvas = true;
            requestAnimationFrame(() => {
                window.app.graphCanvas.draw();
            });
        }
    }
    
    /**
     * Debug method to apply color tint based on thumbnail quality
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {string} quality - Image quality type (e.g., 'thumbnail-64', 'thumbnail-256', 'full')
     * @param {number} width - Node width
     * @param {number} height - Node height
     */
    _applyDebugTint(ctx, quality, width, height) {
        let tintColor = null;
        let label = quality;
        
        // Determine tint color based on quality
        if (quality === 'thumbnail-64') {
            tintColor = 'rgba(255, 0, 0, 0.3)'; // Red tint for 64px thumbnails
            label = '64px';
        } else if (quality === 'thumbnail-256') {
            tintColor = 'rgba(0, 255, 0, 0.3)'; // Green tint for 256px thumbnails
            label = '256px';
        } else if (quality === 'thumbnail-512') {
            tintColor = 'rgba(0, 0, 255, 0.3)'; // Blue tint for 512px thumbnails
            label = '512px';
        } else if (quality === 'full' || quality === 'full-fallback') {
            tintColor = 'rgba(255, 255, 0, 0.2)'; // Yellow tint for full resolution
            label = 'Full';
        } else if (quality === 'preview') {
            tintColor = 'rgba(255, 0, 255, 0.3)'; // Magenta tint for preview
            label = 'Preview';
        }
        
        if (tintColor) {
            // Apply color overlay
            ctx.fillStyle = tintColor;
            ctx.fillRect(0, 0, width, height);
            
            // Add text label
            ctx.save();
            ctx.font = '12px monospace';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
            ctx.lineWidth = 3;
            ctx.textAlign = 'center';
            ctx.strokeText(label, width / 2, height / 2);
            ctx.fillText(label, width / 2, height / 2);
            ctx.restore();
        }
    }
    
    /**
     * Draw WebGL LOD status overlay for debugging
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Object} lodInfo - LOD information from WebGL renderer
     */
    _drawLODStatus(ctx, lodInfo) {
        ctx.save();
        
        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(5, this.size[1] - 50, 120, 45);
        
        // Text
        ctx.fillStyle = 'white';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        
        const current = lodInfo.current || 'none';
        const optimal = lodInfo.optimal || 'none';
        const screen = Math.round(lodInfo.screenSize);
        
        ctx.fillText(`Current: ${current}px`, 8, this.size[1] - 47);
        ctx.fillText(`Optimal: ${optimal}px`, 8, this.size[1] - 35);
        ctx.fillText(`Screen: ${screen}px`, 8, this.size[1] - 23);
        
        // Loading indicator
        if (lodInfo.loading) {
            ctx.fillStyle = 'yellow';
            ctx.fillText('Loading...', 8, this.size[1] - 11);
        } else if (current < optimal) {
            ctx.fillStyle = 'orange';
            ctx.fillText('Upscaling', 8, this.size[1] - 11);
        } else {
            ctx.fillStyle = 'green';
            ctx.fillText('Optimal', 8, this.size[1] - 11);
        }
        
        ctx.restore();
    }
}

// Make ImageNode available globally for browser environments
if (typeof window !== 'undefined') {
    window.ImageNode = ImageNode;
}