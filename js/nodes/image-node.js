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
        this.thumbnailSizes = [64, 128, 256, 512, 1024, 2048];
        this.aspectRatio = 1;
        this.originalAspect = 1;
        this.size = [200, 200];
        
        // Progressive loading state
        this.loadingState = 'idle'; // idle, loading, loaded, error
        this.loadingProgress = 0; // 0-1 for unified progress tracking
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
        // Only set loading state if not already set (preserve initial state)
        if (!this.loadingState || this.loadingState === 'idle') {
            this.loadingState = 'loading';
            this.loadingProgress = 0.1; // 10% for starting load
        }
        
        // console.log(`🖼️ setImage called - node:${this.id || 'pending'} loadingState:${this.loadingState} hash:${hash?.substring(0, 8) || 'none'}`)
        
        // Update title
        if (filename && (!this.title || this.title === 'Image')) {
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
            // console.log(`✅ Image loaded for node:${this.id}`);
            this.loadingState = 'loaded';
            // Progress is now handled in loadImageAsyncOptimized
            
            // Set aspect ratio immediately
            if (this.aspectRatio === 1) {
                this.aspectRatio = this.img.width / this.img.height;
                this.originalAspect = this.aspectRatio;
                this.size[0] = this.size[1] * this.aspectRatio;
            } else {
                this.originalAspect = this.img.width / this.img.height;
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
                        this.loadingProgress = progress;
                        // Trigger redraw for progress updates
                        if (this.graph?.canvas) {
                            this.graph.canvas.dirty_canvas = true;
                        }
                    }
                );
            }
            
            this.onResize();
            this.markDirty();
            
            // Force canvas redraw when image loads
            // Use global app reference as node might not be in graph yet
            const canvas = this.graph?.canvas || window.app?.graphCanvas;
            if (canvas) {
                // console.log(`🎨 Forcing canvas redraw for loaded image node:${this.id}`);
                canvas.dirty_canvas = true;
                
                // Use a small delay to ensure node is fully initialized
                setTimeout(() => {
                    if (canvas.draw) {
                        // console.log(`🖌️ Executing canvas.draw() for node:${this.id}`);
                        canvas.draw();
                    }
                }, 10);
            } else {
                console.warn(`⚠️ No canvas available for redraw - node:${this.id}`);
            }
            
        } catch (error) {
            console.error('Failed to load image:', error);
            this.loadingState = 'error';
            this.loadingProgress = 0;
        }
    }
    
    loadImageAsync(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
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
                console.log(`🔗 Converting relative URL: ${src} → ${absoluteUrl}`);
                return absoluteUrl;
            }
            // Return data URLs and absolute URLs as-is
            return src;
        }
        
        // 2. Try to get from image cache using hash
        if (this.properties.hash && window.imageCache) {
            const cached = window.imageCache.get(this.properties.hash);
            if (cached) {
                console.log(`✅ Resolved image from cache: ${this.properties.hash.substring(0, 8)}...`);
                return cached;
            }
        }
        
        // 3. Try server URL
        if (this.properties.serverUrl) {
            // Convert relative URL to absolute if needed
            const url = this.properties.serverUrl.startsWith('http') 
                ? this.properties.serverUrl 
                : CONFIG.SERVER.API_BASE + this.properties.serverUrl;
            console.log(`🌐 Using server URL: ${url}`);
            return url;
        }
        
        // 4. Try resource cache (for duplicated nodes)
        if (this.properties.hash && window.app?.imageResourceCache) {
            const resource = window.app.imageResourceCache.get(this.properties.hash);
            if (resource?.url) {
                console.log(`📦 Resolved from resource cache: ${this.properties.hash.substring(0, 8)}...`);
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
                                            if (img.decode) {
                                                img.decode()
                                                    .then(() => {
                                                        this.loadingProgress = 1.0; // 100% when decoded
                                                        resolve(img);
                                                    })
                                                    .catch(() => resolve(img));
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
                                if (img.decode) {
                                    img.decode()
                                        .then(() => {
                                            this.loadingProgress = 1.0;
                                            resolve(img);
                                        })
                                        .catch(() => resolve(img));
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
                            resolve(img);
                        };
                        img.src = src;
                    });
            } else {
                // For data URLs or other sources, use regular loading
                img.onload = () => {
                    this.loadingProgress = 0.9;
                    if (img.decode) {
                        img.decode()
                            .then(() => {
                                this.loadingProgress = 1.0;
                                resolve(img);
                            })
                            .catch(() => resolve(img));
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
    
    drawProgressRing(ctx, progress = 0) {
        // Draw semi-transparent background
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, this.size[0], this.size[1]);
        
        const centerX = this.size[0] / 2;
        const centerY = this.size[1] / 2;
        const radius = Math.min(this.size[0], this.size[1]) * 0.15; // 15% of smallest dimension
        
        // Make line width screen-space aware and thicker
        const scale = this.graph?.canvas?.viewport?.scale || 1;
        const lineWidth = Math.max(6 / scale, 2); // Thicker line (6px in screen space, min 2px)
        
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
        
        // Add percentage text in center
        // if (progress > 0) {
        //     ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        //     ctx.font = `${Math.max(12 / scale, 8)}px Arial`;
        //     ctx.textAlign = 'center';
        //     ctx.textBaseline = 'middle';
        //     ctx.fillText(`${Math.round(progress * 100)}%`, centerX, centerY);
        // }
    }
    
    onDrawForeground(ctx) {
        this.validate();
        
        // Auto-start loading if we have a source but haven't started yet
        if (this.loadingState === 'idle' && (this.properties.serverUrl || this.properties.hash) && !this.img) {
            console.log(`🎨 Auto-starting load for node:${this.id}`);
            this.setImage(this.properties.serverUrl, this.properties.filename, this.properties.hash);
        }
        
        // Show loading ring if loading or if we have potential to load
        if (this.loadingState === 'loading' || 
            (this.loadingState === 'idle' && (this.properties.serverUrl || this.properties.hash) && !this.img)) {
            // console.log(`🔄 Drawing loading ring for node:${this.id} state:${this.loadingState}`);
            this.drawProgressRing(ctx, this.loadingProgress);
            return;
        }
        
        if (this.loadingState === 'error') {
            this.drawPlaceholder(ctx, 'Error');
            return;
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
                // Simplified debug - only log significant quality mismatches occasionally
                const actualSize = Math.max(thumbnail.width, thumbnail.height);
                if (actualSize < optimalSize * 0.7 && Math.random() < 0.1) { // 10% chance, worse mismatch
                    console.log(`LOD quality issue: wanted=${optimalSize}px, got=${actualSize}px (${thumbnail.width}x${thumbnail.height})`);
                }
                
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
                ctx.drawImage(thumbnail, 0, 0, this.size[0], this.size[1]);
            } else {
                // Show radial progress if thumbnails are still generating
                // Check if thumbnails exist for this hash
                if (this.properties.hash && window.thumbnailCache && 
                    !window.thumbnailCache.hasThumbnails(this.properties.hash)) {
                    this.drawProgressRing(ctx, this.loadingProgress);
                    return;
                } else {
                    // Fall back to full image if no thumbnails available but image is loaded
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
                    ctx.drawImage(this.img, 0, 0, this.size[0], this.size[1]);
                }
            }
        } else {
            // Full resolution for 1:1 viewing
            ctx.imageSmoothingEnabled = false; // Preserve pixel-perfect quality
            ctx.drawImage(this.img, 0, 0, this.size[0], this.size[1]);
        }
        
        // Draw title if not using thumbnail and not hidden
        if (!useThumbnail) {
            this.drawTitle(ctx);
        }
    }
}