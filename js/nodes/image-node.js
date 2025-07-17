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
        this.thumbnails = new Map();
        this.thumbnailSizes = CONFIG.THUMBNAILS.SIZES;
    }
    
    async setImage(src, filename = null, hash = null) {
        this.properties.src = src;
        this.properties.filename = filename;
        this.properties.hash = hash;
        this.loadingState = 'loading';
        
        // Update title
        if (filename && (!this.title || this.title === 'Image')) {
            this.title = filename;
        }
        
        try {
            // Use non-blocking image loading with immediate return
            this.img = await this.loadImageAsyncOptimized(src);
            this.loadingState = 'loaded';
            
            // Set aspect ratio only if not previously set
            if (this.aspectRatio === 1) {
                this.aspectRatio = this.img.width / this.img.height;
                this.originalAspect = this.aspectRatio;
                this.size[0] = this.size[1] * this.aspectRatio;
            } else {
                this.originalAspect = this.img.width / this.img.height;
            }
            
            // Generate thumbnails asynchronously without blocking
            this.generateThumbnailsAsync();
            this.onResize();
            this.markDirty();
            
        } catch (error) {
            console.error('Failed to load image:', error);
            this.loadingState = 'error';
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
    
    generateThumbnails() {
        if (!this.img?.width || !this.img?.height) return;
        
        this.thumbnails.clear();
        
        for (const size of this.thumbnailSizes) {
            const canvas = Utils.createCanvas(1, 1);
            const ctx = canvas.getContext('2d');
            
            // Calculate dimensions maintaining aspect ratio
            let width = this.img.width;
            let height = this.img.height;
            
            if (width > height && width > size) {
                height = Math.round(height * (size / width));
                width = size;
            } else if (height > width && height > size) {
                width = Math.round(width * (size / height));
                height = size;
            } else if (Math.max(width, height) > size) {
                width = height = size;
            }
            
            canvas.width = width;
            canvas.height = height;
            
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
            ctx.drawImage(this.img, 0, 0, width, height);
            
            this.thumbnails.set(size, canvas);
        }
    }
    
    async generateThumbnailsAsync() {
        if (!this.img?.width || !this.img?.height) return;
        
        this.thumbnails.clear();
        
        // Generate thumbnails in smaller batches to avoid blocking
        for (let i = 0; i < this.thumbnailSizes.length; i++) {
            const size = this.thumbnailSizes[i];
            
            // Use setTimeout to yield control between thumbnail generations
            await new Promise(resolve => {
                setTimeout(() => {
                    const canvas = Utils.createCanvas(1, 1);
                    const ctx = canvas.getContext('2d');
                    
                    // Calculate dimensions maintaining aspect ratio
                    let width = this.img.width;
                    let height = this.img.height;
                    
                    if (width > height && width > size) {
                        height = Math.round(height * (size / width));
                        width = size;
                    } else if (height > width && height > size) {
                        width = Math.round(width * (size / height));
                        height = size;
                    } else if (Math.max(width, height) > size) {
                        width = height = size;
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
                    ctx.drawImage(this.img, 0, 0, width, height);
                    
                    this.thumbnails.set(size, canvas);
                    resolve();
                }, 0);
            });
        }
    }
    
    getBestThumbnail(targetWidth, targetHeight) {
        if (this.thumbnails.size === 0) return null;
        
        // Find the smallest thumbnail that's still larger than target
        for (const size of this.thumbnailSizes) {
            if (size >= targetWidth && size >= targetHeight) {
                return this.thumbnails.get(size);
            }
        }
        
        // Return largest available if none are big enough
        const maxSize = Math.max(...this.thumbnailSizes);
        return this.thumbnails.get(maxSize);
    }
    
    onResize() {
        if (this.aspectRatio === this.originalAspect) {
            // Maintain original aspect ratio
            this.size[1] = this.size[0] / this.aspectRatio;
        } else {
            // Update aspect ratio for non-uniform scaling
            this.aspectRatio = this.size[0] / this.size[1];
        }
    }
    
    onDrawForeground(ctx) {
        this.validate();
        
        if (this.loadingState === 'loading' || this.loadingState === 'idle') {
            this.drawPlaceholder(ctx, 'Loading…');
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
        const useThumbnail = screenWidth < CONFIG.PERFORMANCE.THUMBNAIL_THRESHOLD || 
                            screenHeight < CONFIG.PERFORMANCE.THUMBNAIL_THRESHOLD;
        
        // Draw image or thumbnail
        if (useThumbnail) {
            const thumbnail = this.getBestThumbnail(this.size[0], this.size[1]);
            if (thumbnail) {
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
                ctx.drawImage(thumbnail, 0, 0, this.size[0], this.size[1]);
            } else {
                ctx.drawImage(this.img, 0, 0, this.size[0], this.size[1]);
            }
        } else {
            ctx.drawImage(this.img, 0, 0, this.size[0], this.size[1]);
        }
        
        // Draw title if not using thumbnail and not hidden
        if (!useThumbnail) {
            this.drawTitle(ctx);
        }
    }
}