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
        this.flags = { hide_title: false };
        this.img = null;
        // Remove individual thumbnail storage - use global cache
        this.thumbnailSizes = [64, 128, 256, 512, 1024, 2048];
        this.aspectRatio = 1;
        this.originalAspect = 1;
        this.originalWidth = null;
        this.originalHeight = null;
        this.size = [200, 200];
        this.aspectRatioLocked = true; // Lock aspect ratio by default
        this.lockedAspectRatio = 1; // Will be updated when image loads
        
        // Progressive loading state
        this.loadingState = 'idle'; // idle, loading, loaded, error - start as idle
        this.loadingProgress = 0; // 0-1 for unified progress tracking
        this.thumbnailProgress = 0; // Separate progress for thumbnail generation
        this.displayedProgress = 0; // Smoothed progress for display
        this.primaryLoadCompleteTime = null; // Track when primary loading finished to prevent flicker
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
        
        // Only set loading state if we don't have thumbnails (no visual content yet)
        if (!hasThumbnails && (!this.loadingState || this.loadingState === 'idle')) {
            this.loadingState = 'loading';
            this.loadingProgress = 0.1; // 10% for starting load
            this.thumbnailProgress = 0; // Reset thumbnail progress for new load
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
                console.log(`⏳ Temporary node ${this.id} - keeping loading state`);
            } else {
                console.warn(`⚠️ No image source available yet for node ${this.id} - waiting for upload`);
                // Don't set error state immediately - the image might still be uploading
                // Keep it in loading state to show progress ring
                if (!this.properties.serverUrl && !this.properties.hash) {
                    // Only error if we have no way to get the image
                    this.loadingState = 'error';
                }
            }
            return;
        }
        
        try {
            // Load image with progress tracking
            this.img = await this.loadImageAsyncOptimized(imageSrc);
            this.loadingState = 'loaded';
            this.primaryLoadCompleteTime = Date.now(); // Track completion time to prevent flicker
            // Progress is now handled in loadImageAsyncOptimized
            
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
            
            // Set aspect ratio immediately
            if (this.aspectRatio === 1) {
                this.aspectRatio = this.img.width / this.img.height;
                this.originalAspect = this.aspectRatio;
                this.size[0] = this.size[1] * this.aspectRatio;
            } else {
                this.originalAspect = this.img.width / this.img.height;
            }
            
            // Update locked aspect ratio
            this.lockedAspectRatio = this.size[0] / this.size[1];
            
            // Report load completion to progress tracker
            if (hash && window.imageProcessingProgress) {
                window.imageProcessingProgress.updateLoadProgress(hash, 1);
            }
            
            // Use global thumbnail cache - non-blocking and shared!
            if (hash && window.thumbnailCache) {
                // Add filename to image element for thumbnail cache access
                if (this.properties?.filename) {
                    this.img.setAttribute('data-filename', this.properties.filename);
                }
                
                // Start thumbnail generation if not already available
                // This will be shared between all nodes with the same hash
                window.thumbnailCache.generateThumbnailsProgressive(
                    hash, 
                    this.img, 
                    (progress) => {
                        this.thumbnailProgress = progress;
                        // Trigger redraw for progress updates
                        if (this.graph?.canvas) {
                            this.graph.canvas.dirty_canvas = true;
                        }
                    }
                );
            }
            
            this.onResize();
            // markDirty() not needed - forceRedraw() already called above
            
        } catch (error) {
            console.error('Failed to load image:', error);
            this.loadingState = 'error';
            this.loadingProgress = 0;
        }
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
            if (resource?.url) {
                return resource.url;
            }
        }
        
        // 5. No source available
        console.error(`❌ No image source available for node ${this.id}`, {
            hash: this.properties.hash,
            serverUrl: this.properties.serverUrl,
            filename: this.properties.filename,
            hasImageCache: !!window.imageCache,
            hasResourceCache: !!window.app?.imageResourceCache
        });
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
                        console.warn('Fetch failed, falling back to regular image loading:', error);
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
    
    // Use global thumbnail cache instead of individual generation
    getBestThumbnail(targetWidth, targetHeight) {
        if (!this.properties.hash || !window.thumbnailCache) return null;
        return window.thumbnailCache.getBestThumbnail(this.properties.hash, targetWidth, targetHeight);
    }
    
    getOptimalLOD(screenWidth, screenHeight) {
        // Smart LOD selection based on screen size and movement state
        const canvas = this.graph?.canvas;
        const viewport = canvas?.viewport;
        const mouseState = canvas?.mouseState;
        const isMoving = mouseState?.isDragging || viewport?.isAnimating || false;
        
        // Use the larger dimension for quality assessment
        const screenSize = Math.max(screenWidth, screenHeight);
        
        // Quality buffer: switch to higher res before it looks pixelated
        // More responsive buffers to prevent getting stuck on lower quality
        const qualityBuffer = isMoving ? 1.1 : 1.5; // Less conservative, more responsive
        
        // LOD levels optimized for smooth quality transitions
        const LOD_LEVELS = [
            { maxSize: 64 * qualityBuffer,   useSize: 64 },    // Very small
            { maxSize: 128 * qualityBuffer,  useSize: 128 },   // Small  
            { maxSize: 256 * qualityBuffer,  useSize: 256 },   // Medium
            { maxSize: 512 * qualityBuffer,  useSize: 512 },   // Large
            { maxSize: 1024 * qualityBuffer, useSize: 1024 },  // Very large
            { maxSize: 2048 * qualityBuffer, useSize: 2048 },  // Huge
            { maxSize: Infinity, useSize: null }               // Full resolution for 1:1 viewing
        ];
        
        for (const level of LOD_LEVELS) {
            if (screenSize <= level.maxSize) {
                return level.useSize;
            }
        }
        
        return null; // Use full resolution
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
        // Only show loading ring if we have NO visual content at all
        // If we have thumbnails, we can show them immediately without a loading ring
        const hasThumbnails = this.properties.hash && window.thumbnailCache && 
                             window.thumbnailCache.hasThumbnails(this.properties.hash);
        
        if (hasThumbnails) {
            return false; // Never show loading ring if we have thumbnails
        }
        
        // Only show loading ring during initial load when we have nothing to show
        if (this.loadingState === 'loading' && !this.img) {
            return true;
        }
        
        return false;
    }
    
    _triggerLazyLoad() {
        // Only load if not already loading
        if (!this._lazyLoadTriggered && !this.img && this.loadingState !== 'loading') {
            this._lazyLoadTriggered = true;
            console.log(`🔄 Lazy loading full image for ${this.properties.hash?.substring(0, 8)}...`);
            this.setImage(this.properties.serverUrl, this.properties.filename, this.properties.hash);
        }
    }
    
    drawProgressRingOnly(ctx, progress = 0) {
        const centerX = this.size[0] / 2;
        const centerY = this.size[1] / 2;
        
        // Calculate screen-space consistent line width (4px)
        const scale = this.graph?.canvas?.viewport?.scale || 1;
        const lineWidth = 4 / scale;
        
        // Calculate radius with screen-space limits
        const baseRadius = Math.min(this.size[0], this.size[1]) * 0.15; // 15% of smallest dimension
        const minRadius = 20 / scale;  // 20px minimum in screen space
        const maxRadius = 100 / scale; // 100px maximum in screen space
        const radius = Math.max(minRadius, Math.min(baseRadius, maxRadius));
        
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
    
    onDrawForeground(ctx) {
        this.validate();
        
        // Check if we have thumbnails available to show immediately
        const hasThumbnails = this.properties.hash && window.thumbnailCache && 
                             window.thumbnailCache.hasThumbnails(this.properties.hash);
        
        // If we have thumbnails, we're effectively "loaded" for display purposes
        if (hasThumbnails && this.loadingState === 'idle') {
            this.loadingState = 'loaded'; // Mark as loaded since we can display content
        }
        
        // Auto-start loading if we have a source but haven't started yet
        if (this.loadingState === 'idle' && 
            (this.properties.serverUrl || this.properties.hash) && !this.img && !hasThumbnails) {
            // No thumbnails available, need to load full image
            this.setImage(this.properties.serverUrl, this.properties.filename, this.properties.hash);
        }
        
        // Schedule lazy load of full image if we only have thumbnails
        if (hasThumbnails && !this.img && !this._lazyLoadScheduled) {
            this._lazyLoadScheduled = true;
            requestIdleCallback(() => {
                if (!this.img && this.properties.hash) {
                    console.log(`⏰ Background loading full image for ${this.properties.hash.substring(0, 8)}...`);
                    // Load silently in background without changing loading state
                    this.setImage(this.properties.serverUrl, this.properties.filename, this.properties.hash);
                }
            }, { timeout: 2000 });
        }
        
        // Check unified loading ring condition
        if (this.shouldShowLoadingRing()) {
            // Determine which progress to show
            let targetProgress = this.loadingProgress;
            
            // If we have an image and we're just waiting for thumbnails, show faded image behind ring
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
            if (!showingImageBehindRing && !this.img) {
                this.drawPlaceholderWithInfo(ctx);
                // Draw just the progress ring on top
                this.drawProgressRingOnly(ctx, this.displayedProgress);
            } else if (!showingImageBehindRing) {
                // Legacy behavior for when we have partial image data
                this.drawProgressRing(ctx, this.displayedProgress);
            } else {
                // Draw just the ring without the background
                this.drawProgressRingOnly(ctx, this.displayedProgress);
            }
            return;
        }
        
        if (this.loadingState === 'error') {
            this.drawPlaceholder(ctx, 'Error');
            return;
        }
        
        // Check if we can show thumbnails even without full image
        if (!this.img && this.properties.hash && window.thumbnailCache) {
            const thumbnail = this.getBestThumbnail(this.size[0], this.size[1]);
            if (thumbnail) {
                // Show thumbnail at full opacity - it's our primary display
                ctx.save();
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
                ctx.drawImage(thumbnail, 0, 0, this.size[0], this.size[1]);
                ctx.restore();
                
                // Trigger lazy load if not already scheduled
                if (!this._lazyLoadScheduled) {
                    this._lazyLoadScheduled = true;
                    requestIdleCallback(() => {
                        if (!this.img && this.properties.hash) {
                            console.log(`⏰ Background loading full image for ${this.properties.hash.substring(0, 8)}...`);
                            this.setImage(this.properties.serverUrl, this.properties.filename, this.properties.hash);
                        }
                    }, { timeout: 2000 });
                }
                return;
            }
        }
        
        if (!this.img) return;
        
        const scale = this.graph?.canvas?.viewport?.scale || 1;
        const screenWidth = this.size[0] * scale;
        const screenHeight = this.size[1] * scale;
        
        // Use smart LOD selection
        const optimalSize = this.getOptimalLOD(screenWidth, screenHeight);
        const useThumbnail = optimalSize !== null;
        
        // Draw image or thumbnail
        if (useThumbnail) {
            const thumbnail = this.getBestThumbnail(optimalSize, optimalSize);
            
            if (thumbnail) {
                ctx.save();
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
                ctx.drawImage(thumbnail, 0, 0, this.size[0], this.size[1]);
                ctx.restore();
            } else if (this.img) {
                // Fall back to full image if no thumbnails available but image is loaded
                ctx.save();
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
                ctx.drawImage(this.img, 0, 0, this.size[0], this.size[1]);
                ctx.restore();
            } else if (this.properties.hash && window.thumbnailCache) {
                // No thumbnail or full image - trigger lazy load if needed
                this._triggerLazyLoad();
            }
        } else {
            // Full resolution for 1:1 viewing - need full image
            if (this.img) {
                ctx.save();
                ctx.imageSmoothingEnabled = false; // Preserve pixel-perfect quality
                ctx.drawImage(this.img, 0, 0, this.size[0], this.size[1]);
                ctx.restore();
            } else {
                // Need to load full image for 1:1 viewing
                this._triggerLazyLoad();
                
                // Show best available thumbnail while loading
                const thumbnail = this.getBestThumbnail(this.size[0], this.size[1]);
                if (thumbnail) {
                    ctx.save();
                    ctx.globalAlpha = 0.7; // Slightly faded to indicate it's not full res
                    ctx.imageSmoothingEnabled = true;
                    ctx.drawImage(thumbnail, 0, 0, this.size[0], this.size[1]);
                    ctx.restore();
                }
            }
        }
        
        // Title rendering is handled at canvas level by drawNodeTitle()
    }
}

// Make ImageNode available globally for browser environments
if (typeof window !== 'undefined') {
    window.ImageNode = ImageNode;
}