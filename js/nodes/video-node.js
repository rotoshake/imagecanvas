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
        // Remove individual thumbnail storage - use global cache
        this.thumbnailSizes = CONFIG.THUMBNAILS.SIZES;
        this.userPaused = false;  // Keep for backward compatibility
        this.loadingProgress = 0; // 0-1 for unified progress tracking
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
            
            // Use global thumbnail cache - non-blocking and shared!
            if (hash && window.thumbnailCache) {
                // Start thumbnail generation if not already available
                window.thumbnailCache.generateThumbnailsProgressive(
                    hash, 
                    this.video, 
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

    waitForSeek() {
        return new Promise(resolve => {
            const onSeeked = () => {
                this.video.removeEventListener('seeked', onSeeked);
                resolve();
            };
            this.video.addEventListener('seeked', onSeeked);
        });
    }
    
    // Use global thumbnail cache instead of individual generation
    getBestThumbnail(targetWidth, targetHeight) {
        if (!this.properties.hash || !window.thumbnailCache) return null;
        return window.thumbnailCache.getBestThumbnail(this.properties.hash, targetWidth, targetHeight);
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
            this.drawProgressRing(ctx, this.loadingProgress);
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
                    // Show progress if thumbnails are still generating
                    if (this.properties.hash && window.thumbnailCache && 
                        !window.thumbnailCache.hasThumbnails(this.properties.hash)) {
                        this.drawProgressRing(ctx, this.loadingProgress);
                        return;
                    } else {
                        // Fallback to video if thumbnail not available
                        this.drawVideo(ctx);
                    }
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
        
        // Broadcast video toggle for collaboration
        if (this.graph?.canvas?.broadcastVideoToggle) {
            this.graph.canvas.broadcastVideoToggle(this.id, this.properties.paused);
        }
    }
    
    setLoop(loop) {
        this.properties.loop = loop;
        if (this.video) {
            this.video.loop = loop;
        }
        
        // Broadcast loop change for collaboration
        if (this.graph?.canvas?.broadcastNodePropertyUpdate) {
            this.graph.canvas.broadcastNodePropertyUpdate(this.id, 'loop', loop);
        }
    }
    
    setMuted(muted) {
        this.properties.muted = muted;
        if (this.video) {
            this.video.muted = muted;
        }
        
        // Broadcast muted change for collaboration
        if (this.graph?.canvas?.broadcastNodePropertyUpdate) {
            this.graph.canvas.broadcastNodePropertyUpdate(this.id, 'muted', muted);
        }
    }
    
    setAutoplay(autoplay) {
        this.properties.autoplay = autoplay;
        // Note: autoplay attribute can't be changed on existing video elements
        // This will take effect on next video load
        
        // Broadcast autoplay change for collaboration
        if (this.graph?.canvas?.broadcastNodePropertyUpdate) {
            this.graph.canvas.broadcastNodePropertyUpdate(this.id, 'autoplay', autoplay);
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