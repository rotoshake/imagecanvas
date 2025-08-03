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
        
        // Visibility tracking for performance
        this._isVisible = true; // Assume visible by default
        this._wasPlaying = false; // Track if video was playing before hiding
        this._tinyPaused = false; // Track if paused due to tiny size
        
        // Frame tracking for deduplication
        this._lastRenderedTime = -1; // Track last rendered video time
        this._frameSkipCount = 0; // Track skipped frames for debugging
        
        // Color adjustments (non-destructive, used by WebGL renderer)
        this.adjustments = {
            brightness: 0.0, // range -1..1
            contrast: 0.0,   // range -1..1
            saturation: 0.0, // range -1..1
            hue: 0.0         // degrees -180..180
        };
        
        // Tone curve data
        this.toneCurve = null;
        this.toneCurveBypassed = true; // Bypass by default for performance
        this.colorAdjustmentsBypassed = true; // Bypass adjustments by default
        
        // Color balance (non-destructive, used by WebGL renderer)
        this.colorBalance = null; // Will be initialized when first used
        this.colorBalanceBypassed = true; // Bypass by default for performance
        
        this.needsGLUpdate = false; // flag for renderer cache
        
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
        
        // Check if video needs transcoding (after page refresh)
        // This happens when we have a serverFilename but transcoding wasn't completed
        if (this.properties.serverFilename && !this.properties.transcodingComplete) {
            // We'll be loading the original file while transcoding resumes
            console.log(`🎬 Video node detected interrupted transcoding, will resume in background`);
            await this.checkAndResumeTranscoding();
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
        
        // 2. Try temporary video URL (for newly dropped videos)
        if (this.properties.tempVideoUrl) {
            return this.properties.tempVideoUrl;
        }
        
        // 3. Try to get from cache using hash
        if (this.properties.hash && window.imageCache) {
            const cached = window.imageCache.get(this.properties.hash);
            if (cached) {
                return cached;
            }
        }
        
        // 4. Try server URL
        if (this.properties.serverUrl) {
            // Convert relative URL to absolute if needed
            const url = this.properties.serverUrl.startsWith('http') 
                ? this.properties.serverUrl 
                : CONFIG.SERVER.API_BASE + this.properties.serverUrl;
            return url;
        }
        
        // 4.5. If we have a serverFilename but no serverUrl (interrupted transcoding)
        // Try to load the original uploaded file
        if (this.properties.serverFilename && !this.properties.transcodingComplete) {
            console.log(`🔄 Video transcoding was interrupted, loading original: ${this.properties.serverFilename}`);
            const originalUrl = CONFIG.SERVER.API_BASE + `/uploads/${this.properties.serverFilename}`;
            
            // Mark that we need to update when transcoding completes
            this.properties.pendingServerUrlUpdate = true;
            
            return originalUrl;
        }
        
        // 5. Try resource cache (for duplicated nodes)
        if (this.properties.hash && window.app?.imageResourceCache) {
            const resource = window.app.imageResourceCache.get(this.properties.hash);
            if (resource?.url) {
                return resource.url;
            }
        }
        
        // 6. Check if we're pending initialization
        if (this.properties.pendingVideoInit) {
            // This is expected - video will be initialized soon
            return null;
        }
        
        // 7. No source available
        console.error(`❌ No video source available for node ${this.id}`, {
            hash: this.properties.hash,
            serverUrl: this.properties.serverUrl,
            filename: this.properties.filename,
            hasImageCache: !!window.imageCache,
            hasResourceCache: !!window.app?.imageResourceCache,
            tempVideoUrl: this.properties.tempVideoUrl,
            pendingInit: this.properties.pendingVideoInit
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
            
            // Use requestVideoFrameCallback for efficient video rendering if available
            if ('requestVideoFrameCallback' in video) {
                // Modern API - only redraws when video has a new frame
                const frameCallback = () => {
                    if (!this.video.paused && this._isVisible) {
                        this.markDirty();
                        this.video.requestVideoFrameCallback(frameCallback);
                    }
                };
                video.addEventListener('play', () => {
                    this.video.requestVideoFrameCallback(frameCallback);
                });
            } else {
                // Fallback: Smart throttled redraw during playback
                let lastFrameTime = 0;
                video.addEventListener('timeupdate', () => {
                    // Only trigger redraw if enough time has passed AND video is visible
                    const now = Date.now();
                    const timeSinceLastFrame = now - lastFrameTime;
                    
                    // Respect video's actual frame rate (most videos are 24-30fps, not 60fps)
                    const minFrameInterval = 33; // ~30fps max
                    
                    if (timeSinceLastFrame >= minFrameInterval && this._isVisible) {
                        lastFrameTime = now;
                        this.markDirty();
                    }
                });
            }
            
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
    
    async checkAndResumeTranscoding() {
        if (!this.properties.serverFilename || !this.properties.filename) {
            return;
        }
        
        console.log(`🔍 Checking transcoding status for ${this.properties.filename}`);
        
        try {
            // Check with server if video is still processing
            const response = await fetch(`${CONFIG.SERVER.API_BASE}/api/video-status/${encodeURIComponent(this.properties.serverFilename)}`);
            
            if (!response.ok) {
                console.log(`⚠️ Could not check video status: ${response.status}`);
                return;
            }
            
            const status = await response.json();
            console.log(`📊 Video status:`, status);
            
            // If video is pending or processing, re-queue it
            if (status.status === 'pending' || status.status === 'processing') {
                console.log(`🔄 Video ${this.properties.filename} needs transcoding, requesting re-queue`);
                
                // Mark that we're waiting for transcoding to complete
                this.properties.pendingServerUrlUpdate = true;
                
                // Register with video processing listener
                if (window.videoProcessingListener) {
                    window.videoProcessingListener.registerVideoNode(this.properties.filename, this);
                }
                
                // Request re-processing via WebSocket
                if (window.app?.network?.socket) {
                    window.app.network.socket.emit('resume_video_processing', {
                        filename: this.properties.filename,
                        serverFilename: this.properties.serverFilename
                    });
                    
                    // Show notification
                    if (window.unifiedNotifications) {
                        window.unifiedNotifications.info(`Resuming video processing for ${this.properties.filename}`, {
                            id: `video-resume-${this.properties.filename}`,
                            duration: 3000
                        });
                    }
                }
            } else if (status.status === 'completed' && status.formats && status.formats.length > 0) {
                // Video was already transcoded, update properties
                this.properties.transcodingComplete = true;
                this.properties.availableFormats = status.formats;
                
                // Update server URL to use transcoded version
                const baseName = this.properties.serverFilename.replace(/\.[^.]+$/, '');
                const transcodedFilename = `${baseName}.${status.formats[0]}`;
                this.properties.serverUrl = `/uploads/${transcodedFilename}`;
                this.properties.serverFilename = transcodedFilename;
                
                console.log(`✅ Video already transcoded, using ${transcodedFilename}`);
            } else if (status.status === 'error') {
                console.error(`❌ Video transcoding failed previously: ${status.error}`);
                // Mark as complete to prevent re-trying
                this.properties.transcodingComplete = true;
            }
        } catch (error) {
            console.error(`❌ Error checking video status:`, error);
        }
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
            // Check if we have a blob URL that should be playing or if we're transcoding
            const hasBlobUrl = this.properties.tempVideoUrl && this.properties.tempVideoUrl.startsWith('blob:');
            const isTranscoding = this.properties.pendingServerUrlUpdate;
            
            // Only show thumbnail if we don't have a blob URL trying to play and not transcoding
            if (!hasBlobUrl && !isTranscoding && this.thumbnail) {
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
                ctx.drawImage(this.thumbnail, 0, 0, this.size[0], this.size[1]);
            } else if (this.loadingState === 'loaded' && !hasBlobUrl && !isTranscoding) {
                // If we're "loaded" but video isn't ready and no blob URL, show placeholder
                this.drawPlaceholder(ctx, 'Loading...');
            } else if (hasBlobUrl || isTranscoding) {
                // We have a blob URL or are transcoding, keep trying to show video even if readyState is low
                // This prevents switching to thumbnail during initial load or transcoding
                if (this.video && this.video.videoWidth > 0) {
                    this.drawVideo(ctx);
                    this.managePlayback();
                } else if (this.thumbnail) {
                    // Fallback to thumbnail if video dimensions aren't available yet
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
                    ctx.drawImage(this.thumbnail, 0, 0, this.size[0], this.size[1]);
                }
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
        
        // Stop video decoding when very small to save CPU
        if (useThumbnail && this.video && !this.video.paused && !this.properties.paused) {
            this._tinyPaused = true;
            this.video.pause();
        } else if (!useThumbnail && this._tinyPaused && this.video && this._isVisible) {
            this._tinyPaused = false;
            if (!this.properties.paused) {
                this.video.play().catch(() => {});
            }
        }

        try {
            // Check if we have a playing blob URL or if we're transitioning from one
            const hasBlobUrl = this.properties.tempVideoUrl && this.properties.tempVideoUrl.startsWith('blob:');
            const isPlaying = this.video && !this.video.paused;
            const isTranscoding = this.properties.pendingServerUrlUpdate; // Still transcoding
            
            // Don't use thumbnail if:
            // 1. Video is actively playing
            // 2. We have a blob URL (still loading from blob)
            // 3. We're in the middle of transcoding transition
            const shouldShowVideo = isPlaying || hasBlobUrl || isTranscoding;
            
            if (useThumbnail && this.thumbnail && !shouldShowVideo) {
                // Use simple video thumbnail for small sizes only when video is truly inactive
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
        if (!this.video || !this._isVisible) return;
        
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
                    
                } else {
                    
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
    
    /**
     * Update color adjustments
     */
    updateAdjustments(newValues = {}) {
        Object.assign(this.adjustments, newValues);
        this.needsGLUpdate = true;
        
        // Schedule an immediate frame on the global canvas
        if (window.app?.graphCanvas) {
            requestAnimationFrame(() => {
                window.app.graphCanvas.draw();
            });
        }
    }
    
    /**
     * Update tone curve data
     */
    updateToneCurve(curveData) {
        // console.log('Video updateToneCurve called', curveData ? 'with data' : 'null');
        this.toneCurve = curveData;
        this.needsGLUpdate = true;
        
        // Force immediate redraw
        if (window.app?.graphCanvas) {
            window.app.graphCanvas.dirty_canvas = true;
            requestAnimationFrame(() => {
                window.app.graphCanvas.draw();
            });
        }
    }
    
    /**
     * Override markDirty to implement frame deduplication
     */
    markDirty() {
        // Check if we actually need to redraw
        if (this.video && this.video.readyState >= 2) {
            const currentTime = this.video.currentTime;
            
            // Skip if frame hasn't changed (with small tolerance for floating point)
            if (Math.abs(currentTime - this._lastRenderedTime) < 0.001) {
                this._frameSkipCount++;
                return; // Skip this frame
            }
            
            this._lastRenderedTime = currentTime;
            
            // Log frame skip stats occasionally for debugging
            if (this._frameSkipCount > 0 && Math.random() < 0.01) { // 1% chance
                if (window.DEBUG_LOD_STATUS) {
                    console.log(`🎬 Video ${this.id}: Skipped ${this._frameSkipCount} duplicate frames`);
                }
                this._frameSkipCount = 0;
            }
        }
        
        // Call parent implementation
        super.markDirty();
    }
    
    /**
     * Called when node visibility changes (for performance optimization)
     */
    onVisibilityChange(isVisible) {
        if (this._isVisible === isVisible) return; // No change
        
        this._isVisible = isVisible;
        
        if (!this.video) return;
        
        if (!isVisible) {
            // Going offscreen - pause if playing
            if (!this.video.paused && !this.properties.paused) {
                this._wasPlaying = true;
                this.video.pause();
                // Silently pause offscreen video
            }
        } else {
            // Coming onscreen - resume if was playing
            if (this._wasPlaying && !this.properties.paused && this.video.paused && !this._tinyPaused) {
                this.video.play().catch(() => {
                    // Autoplay might be blocked, that's okay
                });
                this._wasPlaying = false;
                // Silently resume onscreen video
            }
        }
    }
    
    /**
     * Get optimal video quality based on display size
     * Returns: 'preview' | 'small' | 'medium' | 'full'
     */
    getOptimalQuality(screenWidth, screenHeight) {
        const size = Math.max(screenWidth, screenHeight);
        
        if (size < 200) return 'preview';  // 240p
        if (size < 400) return 'small';    // 480p
        if (size < 800) return 'medium';   // 720p
        return 'full';                      // Original
    }
    
    /**
     * Switch video quality (for future server support)
     */
    async switchQuality(quality) {
        // This will be implemented when server supports multi-resolution
        // For now, just log the intention
        if (this._currentQuality !== quality) {
            console.log(`📹 Would switch ${this.title} to ${quality} quality`);
            this._currentQuality = quality;
        }
    }
    
    /**
     * Update video source when transcoding completes
     */
    async updateVideoSource() {
        if (!this.video || !this.properties.serverUrl) return;
        
        console.log(`🔄 Updating video source to transcoded version: ${this.properties.serverUrl}`);
        
        // Clear temp video URL to ensure we use the transcoded version
        if (this.properties.tempVideoUrl) {
            console.log('🧹 Clearing tempVideoUrl to use transcoded version');
            delete this.properties.tempVideoUrl;
        }
        
        // Save current state
        const currentTime = this.video.currentTime;
        const wasPaused = this.video.paused || this.properties.paused;
        const wasVisible = this._isVisible;
        
        // Resolve the new URL - now it will use serverUrl since tempVideoUrl is cleared
        const newUrl = await this.resolveVideoSource();
        if (!newUrl || newUrl === this.video.src) {
            console.log('📹 Video source unchanged or unavailable');
            return;
        }
        
        console.log(`🎬 Switching from ${this.video.src} to ${newUrl}`);
        
        // Create new video element to avoid interruption
        const newVideo = await this.loadVideoAsync(newUrl);
        
        // Restore state
        newVideo.currentTime = currentTime;
        if (!wasPaused && wasVisible) {
            newVideo.play().catch(() => {});
        }
        
        // Replace old video
        const oldVideo = this.video;
        this.video = newVideo;
        
        // Clean up old video
        oldVideo.pause();
        oldVideo.src = '';
        
        // Clean up blob URL if it was one
        if (this._tempBlobUrl) {
            URL.revokeObjectURL(this._tempBlobUrl);
            delete this._tempBlobUrl;
        }
        
        // Clear the pending update flag
        this.properties.pendingServerUrlUpdate = false;
        
        // Update thumbnail with new video
        this.createVideoThumbnail();
        
        // Force redraw
        this.markDirty();
        
        console.log(`✅ Video source updated successfully`);
    }
}

// Make VideoNode available globally for browser environments
if (typeof window !== 'undefined') {
    window.VideoNode = VideoNode;
}