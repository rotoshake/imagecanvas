// ===================================
// VIDEO NODE CLASS
// ===================================

class VideoNode extends BaseNode {
    constructor() {
        super('media/video');
        this.title = '';
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
        this.thumbnail = null; // Simple single thumbnail for small display
        this.userPaused = false;  // Keep for backward compatibility
        this.loadingProgress = 0; // 0-1 for unified progress tracking
        this.loadingState = 'idle'; // Start as idle, not loading
        this._loadingStarted = false; // Track if we've started loading
        this._lastDrawTime = 0; // Track last draw to prevent flicker
        this._primaryLoadCompleteTime = null; // Track when video finished loading
        
    }
    
    async setVideo(src, filename = null, hash = null) {
        // Prevent multiple loading attempts
        if (this._loadingStarted) {
            return;
        }
        this._loadingStarted = true;
        
        // Ensure loop property is always defined (fix for undefined from state restoration)
        if (this.properties.loop === undefined) {
            this.properties.loop = true;
        }
        
        // Store only references, not the data
        this.properties.filename = filename;
        this.properties.hash = hash;
        
        // If src is a server URL, store it as serverUrl
        if (src && !src.startsWith('data:')) {
            this.properties.serverUrl = src;
        } else if (src) {
            this.properties.src = src;
        }
        
        this.loadingState = 'loading';
        
        // Only set title if it's empty or undefined
        // This preserves user-customized titles while ensuring new nodes get a title
        if (filename && !this.title) {
            this.title = filename;
        }
        
        // Resolve the actual video source
        const videoSrc = await this.resolveVideoSource(src);
        if (!videoSrc) {
            console.warn(`⚠️ No video source available yet for node ${this.id} - waiting for upload`);
            if (!this.properties.serverUrl && !this.properties.hash) {
                this.loadingState = 'error';
            }
            return;
        }
        
        try {
            this.video = await this.loadVideoAsync(videoSrc);
            
            // Store original dimensions
            this.originalWidth = this.video.videoWidth;
            this.originalHeight = this.video.videoHeight;
            
            // Set aspect ratio only if not previously set
            if (this.aspectRatio === 1) {
                this.aspectRatio = this.video.videoWidth / this.video.videoHeight;
                this.originalAspect = this.aspectRatio;
                this.size[0] = this.size[1] * this.aspectRatio;
            } else {
                this.originalAspect = this.video.videoWidth / this.video.videoHeight;
            }
            
            // Update locked aspect ratio if using default lock
            if (this.aspectRatioLocked !== false) {
                this.lockedAspectRatio = this.size[0] / this.size[1];
            }
            
            // Create a simple single thumbnail for small display sizes
            // This will set loadingProgress to 1.0 and loadingState to 'loaded'
            this.createVideoThumbnail();
            
            // Set loading state after thumbnail creation
            this.loadingState = 'loaded';
            this._primaryLoadCompleteTime = Date.now(); // Track when loading finished
            
            // Mark loading as complete in the progress tracking system
            if (this.properties.hash && window.imageProcessingProgress) {
                window.imageProcessingProgress.updateLoadProgress(this.properties.hash, 1.0);
            }
            
            // Force immediate redraw to show loaded video
            const canvas = this.graph?.canvas || window.app?.graphCanvas;
            if (canvas && canvas.forceRedraw) {
                canvas.forceRedraw();
            }
            
            this.onResize();
            this.markDirty();
            
            // Start playback only if not paused
            if (!this.properties.paused) {
                // Ensure video is muted for autoplay to work
                this.video.muted = true;
                this.properties.muted = true;
                this.play();  // Auto-play by default
            } else {
                this.pause(); // Explicitly pause if paused
            }
            
        } catch (error) {
            console.error('Failed to load video:', error);
            this.loadingState = 'error';
            this.loadingProgress = 1.0; // Mark as complete even if failed
            
            // Mark as failed in the progress tracking system
            if (this.properties.hash && window.imageProcessingProgress) {
                window.imageProcessingProgress.markFailed(this.properties.hash, 'loading');
            }
        }
    }
    
    /**
     * Resolve video source from references
     * Priority: direct src > cache > serverUrl > resourceCache
     */
    async resolveVideoSource(src) {
        // 1. If we have a direct source, check if it needs conversion
        if (src) {
            // Convert relative server URLs to absolute
            if (src.startsWith('/uploads/') || src.startsWith('/thumbnails/')) {
                const absoluteUrl = CONFIG.SERVER.API_BASE + src;
                return absoluteUrl;
            }
            // Return data URLs and absolute URLs as-is
            return src;
        }
        
        // 2. Try to get from cache using hash
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
        console.error(`❌ No video source available for node ${this.id}`, {
            hash: this.properties.hash,
            serverUrl: this.properties.serverUrl,
            filename: this.properties.filename,
            hasImageCache: !!window.imageCache,
            hasResourceCache: !!window.app?.imageResourceCache
        });
        return null;
    }
    
    createVideoThumbnail() {
        if (!this.video || this.video.readyState < 2) {
            // Video not ready yet, try again later
            if (this.video && this.video.readyState < 2) {
                this.video.addEventListener('loadeddata', () => {
                    this.createVideoThumbnail();
                }, { once: true });
            }
            return;
        }
        
        try {
            // Create a simple 64x64 thumbnail for small display
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const size = 64; // Single small thumbnail size
            
            // Maintain aspect ratio
            const videoAspect = this.video.videoWidth / this.video.videoHeight;
            let thumbWidth, thumbHeight;
            
            if (videoAspect > 1) {
                thumbWidth = size;
                thumbHeight = size / videoAspect;
            } else {
                thumbWidth = size * videoAspect;
                thumbHeight = size;
            }
            
            canvas.width = thumbWidth;
            canvas.height = thumbHeight;
            
            // Don't seek if video is already playing - use current frame
            const drawThumbnail = () => {
                try {
                    // Draw current video frame to thumbnail
                    ctx.drawImage(this.video, 0, 0, thumbWidth, thumbHeight);
                    
                } catch (drawError) {
                    console.warn(`Failed to draw video thumbnail for ${this.id}:`, drawError);
                    // Create a placeholder thumbnail
                    ctx.fillStyle = '#333';
                    ctx.fillRect(0, 0, thumbWidth, thumbHeight);
                    ctx.fillStyle = '#fff';
                    ctx.font = '12px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('📹', thumbWidth/2, thumbHeight/2);
                }
            };
            
            // Try to draw immediately, but also set up a fallback
            drawThumbnail();
            
            // Also try again after a short delay in case the seek needs time
            setTimeout(drawThumbnail, 100);
            
            // Store thumbnail
            this.thumbnail = canvas;
            
            
            // Complete loading progress - this is a video thumbnail, not image thumbnails
            this.loadingProgress = 1.0;
            
            // Mark thumbnail as complete in the progress tracking system
            if (this.properties.hash && window.imageProcessingProgress) {
                window.imageProcessingProgress.updateThumbnailProgress(this.properties.hash, 1.0);
            }
            
            // Trigger redraw to show completed progress
            const graphCanvas = this.graph?.canvas || window.app?.graphCanvas;
            if (graphCanvas) {
                graphCanvas.dirty_canvas = true;
            }
            
        } catch (error) {
            console.warn('Failed to create video thumbnail:', error);
            // Set progress to complete even if thumbnail failed
            this.loadingProgress = 1.0;
            
            // Mark thumbnail as complete in the progress tracking system even if failed
            if (this.properties.hash && window.imageProcessingProgress) {
                window.imageProcessingProgress.updateThumbnailProgress(this.properties.hash, 1.0);
            }
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
            
            // Add event listeners to handle looping and ensure canvas redraws
            video.addEventListener('ended', () => {
                // Trust the browser's loop implementation
                // Only force redraw when video ends
                this.markDirty();
            });
            
            video.addEventListener('play', () => {
                // Single redraw when video starts playing
                this.markDirty();
            });
            
            video.addEventListener('pause', () => {
                // Single redraw when video pauses
                this.markDirty();
            });
            
            // Throttled redraw during playback
            video.addEventListener('timeupdate', () => {
                // Only trigger redraw occasionally, not every frame
                if (!this._lastUpdateTime || Date.now() - this._lastUpdateTime > 100) {
                    this._lastUpdateTime = Date.now();
                    this.markDirty();
                }
            });
            
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
                // If video needs user interaction, any click will start it
                if (this._needsUserInteraction) {
                    this._needsUserInteraction = false;
                    this.play();
                } else {
                    this.togglePlayback();
                }
                this.markDirty();
                return true;  // Event handled
            }
        }
        return false;
    }
    
    onClick(event) {
        // Single click can also start videos that need user interaction
        if (this._needsUserInteraction && this.video) {
            const canvas = this.graph?.canvas;
            if (!canvas) return false;
            
            const mousePos = canvas.mouseState?.graph;
            if (!mousePos) return false;
            
            const inBounds = this.containsPoint(mousePos[0], mousePos[1]);
            if (inBounds) {
                this._needsUserInteraction = false;
                this.play();
                this.markDirty();
                return true;
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
    
    // Video nodes use their own simple thumbnail instead of the global cache
    getBestThumbnail(targetWidth, targetHeight) {
        return this.thumbnail; // Return our simple thumbnail or null
    }
    
    shouldShowLoadingRing() {
        // Always show during primary loading
        if (this.loadingState === 'loading' || (!this.video && this.loadingState !== 'error')) {
            return true;
        }
        
        // Don't show loading ring if primary loading just finished (prevents flicker)
        if (this._primaryLoadCompleteTime) {
            const timeSinceLoad = Date.now() - this._primaryLoadCompleteTime;
            if (timeSinceLoad < 300) { // 300ms cooldown
                return false;
            }
        }
        
        return false;
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
    
    onDrawForeground(ctx) {
        this.validate();
        
        // Auto-start loading if we have a source but haven't started yet
        if (this.loadingState === 'idle' && !this._loadingStarted && !this.video &&
            (this.properties.serverUrl || this.properties.hash || this.properties.src)) {
            this.setVideo(this.properties.serverUrl || this.properties.src, this.properties.filename, this.properties.hash);
        }
        
        // Show loading ring based on unified check
        if (this.shouldShowLoadingRing()) {
            this.drawProgressRing(ctx, this.loadingProgress);
            return;
        }
        
        if (this.loadingState === 'error') {
            this.drawPlaceholder(ctx, 'Error');
            return;
        }
        
        // Don't try to draw video if it's not ready yet
        if (!this.video || this.video.readyState < 2) {
            // Show thumbnail if available while video loads
            if (this.thumbnail) {
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
                ctx.drawImage(this.thumbnail, 0, 0, this.size[0], this.size[1]);
            } else if (this.loadingState === 'loaded') {
                // If we're "loaded" but video isn't ready, show placeholder
                this.drawPlaceholder(ctx, 'Loading...');
            }
            return;
        }
        
        // Get scale from multiple possible sources
        const scale = this.graph?.canvas?.viewport?.scale || 
                     window.app?.graphCanvas?.viewport?.scale ||
                     window.app?.graphCanvas?.ds?.scale ||
                     1;
                     
        const screenWidth = this.size[0] * scale;
        const screenHeight = this.size[1] * scale;
        const useThumbnail = screenWidth < CONFIG.PERFORMANCE.THUMBNAIL_THRESHOLD || 
                            screenHeight < CONFIG.PERFORMANCE.THUMBNAIL_THRESHOLD;
        
        
        try {
            if (useThumbnail && this.thumbnail) {
                // Use simple video thumbnail for small sizes
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
                ctx.drawImage(this.thumbnail, 0, 0, this.size[0], this.size[1]);
                
            } else {
                // Full resolution video
                this.drawVideo(ctx);
                this.managePlayback();
                
                // Show play indicator if video needs user interaction
                if (this._needsUserInteraction) {
                    this.drawPlayIndicator(ctx);
                }
            }
        } catch (error) {
            console.warn('Video drawing error:', error);
            this.drawPlaceholder(ctx, 'Video Error');
        }
        
        // Title rendering is handled at canvas level by drawNodeTitle()
        // (same as image nodes for consistency)
    }
    
    drawVideo(ctx) {
        // Only draw if video is truly ready with valid dimensions
        if (this.video.readyState >= 2 && this.video.videoWidth > 0 && this.video.videoHeight > 0) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
            ctx.drawImage(this.video, 0, 0, this.size[0], this.size[1]);
        } else if (this.thumbnail) {
            // Fall back to thumbnail if video isn't fully ready
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
            ctx.drawImage(this.thumbnail, 0, 0, this.size[0], this.size[1]);
        }
    }
    
    managePlayback() {
        if (!this.video) return;
        
        // Only try to play if we should be playing but aren't
        if (!this.properties.paused && this.video.paused && !this._needsUserInteraction) {
            // Check if video is at the end and needs manual restart
            if (this.video.ended && this.properties.loop) {
                this.video.currentTime = 0;
            }
            this.video.play().catch(() => {
                // Autoplay might be blocked, that's okay
                this._needsUserInteraction = true;
            });
        }
        
        // Ensure loop property is set correctly
        if (this.video.loop !== this.properties.loop) {
            this.video.loop = this.properties.loop;
        }
    }
    
    
    drawPlayIndicator(ctx) {
        ctx.save();
        
        // Semi-transparent overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, this.size[0], this.size[1]);
        
        // Play triangle
        const centerX = this.size[0] / 2;
        const centerY = this.size[1] / 2;
        const iconSize = Math.min(this.size[0], this.size[1]) * 0.15;
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.moveTo(centerX - iconSize, centerY - iconSize);
        ctx.lineTo(centerX + iconSize, centerY);
        ctx.lineTo(centerX - iconSize, centerY + iconSize);
        ctx.closePath();
        ctx.fill();
        
        // "Click to play" text
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = `${Math.max(12, Math.min(16, this.size[0] * 0.08))}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Click to play', centerX, centerY + iconSize + 20);
        
        ctx.restore();
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
        if (this.video && this.video.paused) {  // Only play if actually paused
            this.video.play().catch((error) => {
                if (error.name === 'NotAllowedError') {
                    // Mark as needing user interaction
                    this._needsUserInteraction = true;
                    console.log(`🎬 Video ${this.id} needs user interaction to play`);
                } else {
                    console.warn('Video play error:', error);
                }
            });
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
            this.graph.canvas.broadcastVideoToggle(this.id, !this.properties.paused);
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
        
        // Note: Thumbnails are managed by global cache, no individual cleanup needed
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

// Make VideoNode available globally for browser environments
if (typeof window !== 'undefined') {
    window.VideoNode = VideoNode;
}