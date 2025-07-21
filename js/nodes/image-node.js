// ===================================
// IMAGE NODE CLASS
// ===================================

class ImageNode extends BaseNode {
    constructor() {
        super('media/image');
        this.title = 'Image';
        this.properties = { src: null, scale: 1.0, filename: null, hash: null };
        this.flags = { hide_title: true };
        this.img = null;
        // Remove individual thumbnail storage - use global cache
        this.thumbnailSizes = [64, 128, 256, 512, 1024, 2048];
        this.aspectRatio = 1;
        this.originalAspect = 1;
        this.size = [200, 200];
        
        // Progressive loading state
        this.loadingProgress = 0; // 0-1 for unified progress tracking
    }
    
    async setImage(src, filename = null, hash = null) {
        this.properties.src = src;
        this.properties.filename = filename;
        this.properties.hash = hash;
        this.loadingState = 'loading';
        this.loadingProgress = 0.1; // 10% for starting load
        
        // Update title
        if (filename && (!this.title || this.title === 'Image')) {
            this.title = filename;
        }
        
        try {
            // Load image with progress tracking
            this.img = await this.loadImageAsyncOptimized(src);
            this.loadingState = 'loaded';
            this.loadingProgress = 0.3; // 30% for image loaded
            
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
    
    loadImageAsyncOptimized(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            
            // Use decode() for better performance if available
            img.onload = () => {
                if (img.decode) {
                    img.decode()
                        .then(() => resolve(img))
                        .catch(() => resolve(img)); // Fall back to regular loading
                } else {
                    resolve(img);
                }
            };
            
            img.onerror = reject;
            
            // Set crossOrigin and loading hints for better performance
            img.crossOrigin = 'anonymous';
            img.loading = 'eager';
            img.src = src;
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
    
    // Temporary workaround for browser caching - can be removed after hard refresh
    drawProgressRing(ctx, progress = 0) {
        // Draw semi-transparent background
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, this.size[0], this.size[1]);
        
        const centerX = this.size[0] / 2;
        const centerY = this.size[1] / 2;
        const radius = Math.min(this.size[0], this.size[1]) * 0.15; // 15% of smallest dimension
        
        // Make line width screen-space aware
        const scale = this.graph?.canvas?.viewport?.scale || 1;
        const lineWidth = 3 / scale; // Consistent thickness regardless of zoom
        
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
    
    onDrawForeground(ctx) {
        this.validate();
        
        if (this.loadingState === 'loading' || this.loadingState === 'idle') {
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