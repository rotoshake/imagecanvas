// ===================================
// VIDEO NODE CLASS
// ===================================

class VideoNode extends BaseNode {
    constructor() {
        super('media/video');
        this.title = 'Video';
        this.properties = { 
            src: null, 
            filename: null, 
            hash: null, 
            loop: true,
            muted: true,
            autoplay: true,
            paused: false  // Add paused property to properties
        };
        this.flags = { hide_title: true };
        this.video = null;
        this.thumbnails = new Map();
        this.thumbnailSizes = CONFIG.THUMBNAILS.SIZES;
        this.userPaused = false;  // Keep for backward compatibility
        this.thumbnailGenerated = false;
    }
    
    async setVideo(src, filename = null, hash = null) {
        this.properties.src = src;
        this.properties.filename = filename;
        this.properties.hash = hash;
        this.loadingState = 'loading';
        
        // Update title
        if (filename && (!this.title || this.title === 'Video')) {
            this.title = filename;
        }
        
        try {
            this.video = await this.loadVideoAsync(src);
            this.loadingState = 'loaded';
            
            // Set aspect ratio only if not previously set
            if (this.aspectRatio === 1) {
                this.aspectRatio = this.video.videoWidth / this.video.videoHeight;
                this.originalAspect = this.aspectRatio;
                this.size[0] = this.size[1] * this.aspectRatio;
            } else {
                this.originalAspect = this.video.videoWidth / this.video.videoHeight;
            }
            
            await this.generateThumbnails();
            this.onResize();
            this.markDirty();
            
            // Start playback only if not paused
            if (!this.properties.paused) {
                this.play();  // Auto-play by default
            } else {
                this.pause(); // Explicitly pause if paused
            }
            
        } catch (error) {
            console.error('Failed to load video:', error);
            this.loadingState = 'error';
        }
    }
    
    loadVideoAsync(src) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.muted = this.properties.muted;
            video.loop = this.properties.loop;
            video.autoplay = this.properties.autoplay && !this.properties.paused;  // Don't autoplay if paused
            video.playsInline = true; // Better mobile support
            video.crossOrigin = 'anonymous'; // For canvas drawing
            
            video.onloadedmetadata = () => {
                // Ensure video dimensions are available
                if (video.videoWidth > 0 && video.videoHeight > 0) {
                    resolve(video);
                } else {
                    reject(new Error('Video dimensions not available'));
                }
            };
            
            video.onerror = () => reject(new Error('Failed to load video'));
            video.src = src;
        });
    }
    
    onDblClick(event) {
        // Get mouse position from canvas
        const canvas = this.graph?.canvas;
        if (!canvas || !this.video) return false;
        
        const mousePos = canvas.mouseState?.graph;
        if (!mousePos) return false;
        
        const inBounds = this.containsPoint(mousePos[0], mousePos[1]);
        if (inBounds) {
            const scale = canvas.viewport?.scale || 1;
            const screenWidth = this.size[0] * scale;
            const useThumbnail = screenWidth < CONFIG.PERFORMANCE.THUMBNAIL_THRESHOLD;
            
            if (!useThumbnail) {
                this.togglePlayback();
                this.markDirty();
                return true;  // Event handled
            }
        }
        return false;
    }

    async generateThumbnails() {
        if (!this.video?.videoWidth || !this.video?.videoHeight || this.thumbnailGenerated) {
            return;
        }
        
        try {
            // Wait for video to be ready for frame capture
            await this.ensureVideoReady();
            
            // Seek to first frame for thumbnail
            this.video.currentTime = 0;
            await this.waitForSeek();
            
            this.thumbnails.clear();
            
            for (const size of this.thumbnailSizes) {
                const canvas = Utils.createCanvas(1, 1);
                const ctx = canvas.getContext('2d');
                
                // Calculate dimensions maintaining aspect ratio
                let width = this.video.videoWidth;
                let height = this.video.videoHeight;
                
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
                
                try {
                    ctx.drawImage(this.video, 0, 0, width, height);
                    this.thumbnails.set(size, canvas);
                } catch (error) {
                    console.warn('Failed to generate thumbnail for size', size, error);
                }
            }
            
            this.thumbnailGenerated = true;
            
        } catch (error) {
            console.warn('Failed to generate video thumbnails:', error);
        }
    }
    
    ensureVideoReady() {
        return new Promise((resolve) => {
            if (this.video.readyState >= 2) {
                resolve();
            } else {
                const onCanPlay = () => {
                    this.video.removeEventListener('canplay', onCanPlay);
                    resolve();
                };
                this.video.addEventListener('canplay', onCanPlay);
            }
        });
    }
    
    waitForSeek() {
        return new Promise((resolve) => {
            const onSeeked = () => {
                this.video.removeEventListener('seeked', onSeeked);
                resolve();
            };
            this.video.addEventListener('seeked', onSeeked);
            
            // Fallback timeout
            setTimeout(resolve, 100);
        });
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
        
        if (!this.video) return;
        
        const scale = this.graph?.canvas?.viewport?.scale || 1;
        const screenWidth = this.size[0] * scale;
        const screenHeight = this.size[1] * scale;
        const useThumbnail = screenWidth < CONFIG.PERFORMANCE.THUMBNAIL_THRESHOLD || 
                            screenHeight < CONFIG.PERFORMANCE.THUMBNAIL_THRESHOLD;
        
        try {
            if (useThumbnail) {
                const thumbnail = this.getBestThumbnail(this.size[0], this.size[1]);
                if (thumbnail) {
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
                    ctx.drawImage(thumbnail, 0, 0, this.size[0], this.size[1]);
                } else {
                    // Fallback to video if thumbnail not available
                    this.drawVideo(ctx);
                }
            } else {
                this.drawVideo(ctx);
                this.managePlayback();
            }
        } catch (error) {
            console.warn('Video drawing error:', error);
            this.drawPlaceholder(ctx, 'Video Error');
        }
        
        // Draw title if not using thumbnail
        if (!useThumbnail) {
            this.drawTitle(ctx);
        }
        
        // // Draw playback controls indicator if paused
        // if (!useThumbnail && (this.video.paused || this.userPaused)) {
        //     this.drawPlaybackIndicator(ctx);
        // }
    }
    
    drawVideo(ctx) {
        if (this.video.readyState >= 2) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
            ctx.drawImage(this.video, 0, 0, this.size[0], this.size[1]);
        }
    }
    
    managePlayback() {
        // Continue video playback if not paused
        if (!this.properties.paused && this.video.paused) {
            this.video.play().catch(() => {
                // Autoplay might be blocked, that's okay
            });
        }
    }
    
    drawPlaybackIndicator(ctx) {
        ctx.save();
        
        // Semi-transparent overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, this.size[0], this.size[1]);
        
        // Play/pause icon
        const centerX = this.size[0] / 2;
        const centerY = this.size[1] / 2;
        const iconSize = Math.min(this.size[0], this.size[1]) * 0.1;
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        
        if (this.video.paused || this.userPaused) {
            // Play triangle
            ctx.beginPath();
            ctx.moveTo(centerX - iconSize, centerY - iconSize);
            ctx.lineTo(centerX + iconSize, centerY);
            ctx.lineTo(centerX - iconSize, centerY + iconSize);
            ctx.closePath();
            ctx.fill();
        } else {
            // Pause bars
            const barWidth = iconSize * 0.6;
            const barGap = iconSize * 0.4;
            ctx.fillRect(centerX - barGap / 2 - barWidth, centerY - iconSize, barWidth, iconSize * 2);
            ctx.fillRect(centerX + barGap / 2, centerY - iconSize, barWidth, iconSize * 2);
        }
        
        ctx.restore();
    }
    
    // Video control methods
    play() {
        this.properties.paused = false;
        this.userPaused = false;  // Keep for backward compatibility
        if (this.video) {
            this.video.play().catch(console.warn);
        }
    }
    
    pause() {
        this.properties.paused = true;
        this.userPaused = true;  // Keep for backward compatibility
        if (this.video) {
            this.video.pause();
        }
    }
    
    togglePlayback() {
        if (this.properties.paused || this.video?.paused) {
            this.play();
        } else {
            this.pause();
        }
    }
    
    seek(time) {
        if (this.video) {
            this.video.currentTime = time;
        }
    }
    
    // Updated containsPoint: Keep pure, no side effects
    containsPoint(x, y) {
        return super.containsPoint(x, y);
    }
    
    onRemoved() {
        super.onRemoved();
        
        // Clean up video resources
        if (this.video) {
            this.video.pause();
            this.video.src = '';
            this.video = null;
        }
        
        // Clear thumbnails
        this.thumbnails.clear();
    }
    
    // Get video metadata
    getVideoInfo() {
        if (!this.video) return null;
        
        return {
            duration: this.video.duration,
            currentTime: this.video.currentTime,
            width: this.video.videoWidth,
            height: this.video.videoHeight,
            paused: this.video.paused,
            muted: this.video.muted,
            loop: this.video.loop,
            readyState: this.video.readyState
        };
    }
}