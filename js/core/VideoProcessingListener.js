/**
 * VideoProcessingListener - Listens for video processing events via WebSocket
 * and updates the notification system
 */
class VideoProcessingListener {
    constructor(networkLayer) {
        this.network = networkLayer;
        this.activeProcessing = new Map(); // filename -> processing info
        this.videoNodesByFilename = new Map(); // filename -> node
        this.listenersSetup = false;
        
        // Wait for network to be connected before setting up listeners
        if (this.network && this.network.isConnected) {
            this.setupListeners();
        } else {
            // Listen for connection event
            this.network.on('connect', () => {
                this.setupListeners();
            });
        }
    }
    
    setupListeners() {
        // Prevent duplicate setup
        if (this.listenersSetup) {
            return;
        }
        
        if (!this.network || !this.network.socket) {
            // Only warn once to avoid spam
            if (!this._warnedOnce) {
                console.log('VideoProcessingListener: Waiting for network connection...');
                this._warnedOnce = true;
            }
            // Retry setup after a delay
            setTimeout(() => this.setupListeners(), 1000);
            return;
        }
        
        this.listenersSetup = true;
        console.log('VideoProcessingListener: Network listeners initialized');
        
        // Listen for video processing queued
        this.network.socket.on('video_processing_queued', (data) => {
            console.log('⏳ Video queued for processing:', data.filename, `(position ${data.queuePosition})`);
            
            // Update notification to show queued status
            if (window.unifiedNotifications) {
                window.unifiedNotifications.updateVideoProgress(
                    data.filename,
                    0,
                    null,
                    `Queued (${data.queuePosition} of ${data.queueLength})`
                );
            }
        });
        
        // Listen for video processing start
        this.network.socket.on('video_processing_start', (data) => {
            console.log('🎬 Video processing started:', data.filename);
            
            // Store processing info with mapping from server filename to original
            this.activeProcessing.set(data.filename, {
                serverFilename: data.serverFilename,
                startTime: Date.now()
            });
            
            // Also store reverse mapping for progress updates
            if (data.serverFilename) {
                this.activeProcessing.set(data.serverFilename, {
                    originalFilename: data.filename,
                    isServerFilename: true
                });
            }
            
            // Don't create a new notification - drag-drop already has one
            // Just log that server processing started
            console.log(`📹 Server transcoding started for ${data.filename}`);
            
            // Update to show transcoding is starting
            if (window.unifiedNotifications) {
                window.unifiedNotifications.updateVideoProgress(
                    data.filename,
                    30,
                    null,
                    'Transcoding...'
                );
            }
        });
        
        // Listen for video processing progress
        this.network.socket.on('video_processing_progress', (data) => {
            // Handle null or undefined percent values
            const percent = data.percent != null ? data.percent : 0;
            console.log(`🎬 Video progress: ${data.file} (${data.format}): ${percent.toFixed(1)}%`);
            
            // Find original filename from our mapping
            let originalFilename = data.filename;
            if (!originalFilename && data.file) {
                // Check if this is a server filename
                const info = this.activeProcessing.get(data.file);
                if (info && info.originalFilename) {
                    originalFilename = info.originalFilename;
                }
            }
            
            // Update notification with proper progress (30-100% range for transcoding)
            if (window.unifiedNotifications && originalFilename) {
                const serverProgress = 30 + (percent / 100) * 70; // Map 0-100% to 30-100%
                window.unifiedNotifications.updateVideoProgress(
                    originalFilename,
                    serverProgress,
                    null, // Don't show format
                    'Processing...'
                );
            }
        });
        
        // Listen for video processing completion
        this.network.socket.on('video_processing_complete', (data) => {
            if (data.success) {
                console.log('✅ Video processing complete:', data.filename);
                console.log('   Available formats:', data.formats);
            } else {
                console.error('❌ Video processing failed:', data.filename, data.error);
                
                // Remove the node on failure
                this.removeVideoNode(data.filename);
            }
            
            // Remove from active processing
            this.activeProcessing.delete(data.filename);
            
            // Also remove reverse mapping if exists
            if (data.serverFilename) {
                this.activeProcessing.delete(data.serverFilename);
            }
            
            // Update notification using original filename
            if (window.unifiedNotifications) {
                window.unifiedNotifications.completeVideoProcessing(
                    data.filename,
                    data.success
                );
            }
            
            // If successful, update the video nodes to use the optimized format
            if (data.success && data.serverFilename) {
                this.updateVideoNodes(data.serverFilename, data.formats, data.filename);
            } else if (!data.success) {
                // If transcoding failed, keep using the original uploaded file
                console.warn(`⚠️ Transcoding failed for ${data.filename}, keeping original format`);
            }
        });
    }
    
    /**
     * Register a video node with its filename for tracking
     */
    registerVideoNode(filename, node) {
        if (filename && node) {
            this.videoNodesByFilename.set(filename, node);
            console.log(`📹 Registered video node for ${filename}`);
        }
    }
    
    /**
     * Unregister a video node
     */
    unregisterVideoNode(filename) {
        if (filename && this.videoNodesByFilename.has(filename)) {
            this.videoNodesByFilename.delete(filename);
            console.log(`📹 Unregistered video node for ${filename}`);
        }
    }
    
    /**
     * Remove a video node and clean up resources
     */
    removeVideoNode(filename) {
        const node = this.videoNodesByFilename.get(filename);
        if (node && window.app?.graph) {
            console.log(`🗑️ Removing video node for cancelled processing: ${filename}`);
            
            // Clean up blob URL if exists
            if (node._tempBlobUrl) {
                URL.revokeObjectURL(node._tempBlobUrl);
            }
            
            // Remove from graph
            window.app.graph.remove(node);
            
            // Unregister
            this.unregisterVideoNode(filename);
        }
        
        // Send cancellation request to server
        this.cancelVideoProcessing(filename);
    }
    
    /**
     * Send cancellation request to server
     */
    cancelVideoProcessing(filename) {
        if (this.network && this.network.socket) {
            console.log(`🚫 Sending video processing cancellation request for ${filename}`);
            this.network.socket.emit('cancel_video_processing', { filename });
        }
    }
    
    /**
     * Update any video nodes that might be using the original file
     */
    updateVideoNodes(serverFilename, formats, originalFilename) {
        // Find video nodes using this file
        if (!window.app || !window.app.graph) return;
        
        const videoNodes = window.app.graph.nodes.filter(node => 
            node.type === 'media/video' && 
            (node.properties.serverFilename === serverFilename ||
             node.properties.filename === originalFilename)
        );
        
        videoNodes.forEach(node => {
            console.log(`🔄 Updating video node ${node.id} with optimized formats`);
            
            // Update the server URL to use the transcoded version
            // If we have formats, use the first one (usually webm)
            let transcodedFilename = serverFilename;
            if (formats && formats.length > 0) {
                // Replace the extension with the transcoded format
                const baseName = serverFilename.replace(/\.[^.]+$/, '');
                transcodedFilename = `${baseName}.${formats[0]}`;
                node.properties.availableFormats = formats;
            }
            
            const serverUrl = `/uploads/${transcodedFilename}`;
            node.properties.serverUrl = serverUrl;
            node.properties.serverFilename = transcodedFilename;
            node.properties.transcodingComplete = true;
            
            // Execute a batch property update command to sync all transcoding state with server
            if (window.app?.operationPipeline) {
                const updates = [
                    { nodeId: node.id, property: 'transcodingComplete', value: true },
                    { nodeId: node.id, property: 'serverUrl', value: serverUrl },
                    { nodeId: node.id, property: 'serverFilename', value: transcodedFilename }
                ];
                
                if (formats && formats.length > 0) {
                    updates.push({ nodeId: node.id, property: 'availableFormats', value: formats });
                }
                
                const updateCommand = window.app.operationPipeline.createCommand(
                    'node_batch_property_update',
                    { updates },
                    'local'
                );
                
                // Execute the command to sync with server
                window.app.operationPipeline.execute(updateCommand).catch(err => {
                    console.error(`❌ Failed to sync transcoding state for node ${node.id}:`, err);
                });
            }
            
            // Mark canvas as dirty for redraw
            node.markDirty?.();
            
            // Handle the transition from blob URL to server URL
            if (node.updateVideoSource) {
                // Use the new updateVideoSource method if available
                console.log(`🎬 Updating video source for node ${node.id}`);
                node.updateVideoSource();
            } else if (node.properties.pendingServerUrlUpdate && node.video) {
                // Fallback for older nodes
                const wasPlaying = !node.video.paused;
                const currentTime = node.video.currentTime;
                const volume = node.video.volume;
                const playbackRate = node.video.playbackRate;
                
                console.log(`🎬 Transitioning from blob URL to transcoded video for node ${node.id}`);
                
                // Update the video source
                node.video.src = CONFIG.SERVER.API_BASE + serverUrl;
                
                // Set up smooth transition
                node.video.addEventListener('loadeddata', () => {
                    // Restore all playback state
                    node.video.currentTime = currentTime;
                    node.video.volume = volume;
                    node.video.playbackRate = playbackRate;
                    
                    if (wasPlaying && !node.properties.paused) {
                        node.video.play().catch(err => {
                            console.warn(`⚠️ Could not auto-resume playback:`, err);
                        });
                    }
                    
                    console.log(`✅ Successfully transitioned to transcoded video`);
                    
                    // Only clean up blob URLs after video is fully loaded and playing
                    setTimeout(() => {
                        // Clear the pending flag first
                        node.properties.pendingServerUrlUpdate = false;
                        
                        // Clean up temp blob URL and temp properties
                        if (node._tempBlobUrl) {
                            URL.revokeObjectURL(node._tempBlobUrl);
                            delete node._tempBlobUrl;
                        }
                        if (node.properties.tempVideoUrl) {
                            delete node.properties.tempVideoUrl;
                        }
                        
                        // Clear blob URL from cache
                        if (node.properties.hash && window.imageCache) {
                            const cached = window.imageCache.get(node.properties.hash);
                            if (cached && cached.startsWith('blob:')) {
                                URL.revokeObjectURL(cached);
                                window.imageCache.set(node.properties.hash, null);
                                console.log(`🧹 Cleared blob URL cache for ${node.properties.hash.substring(0, 8)}...`);
                            }
                        }
                        
                        console.log(`🎬 Video transition completed for node ${node.id}`);
                    }, 500); // 500ms delay to ensure video is fully loaded
                }, { once: true });
                
                // Handle any errors during transition
                node.video.addEventListener('error', (e) => {
                    console.error(`❌ Error loading transcoded video:`, e);
                    // Could potentially fall back to original here
                }, { once: true });
                
                node.video.load();
            } else if (!node.video) {
                // If no video element yet, just ensure it will load the transcoded version
                console.log(`📝 Video node ${node.id} will use transcoded version when loaded`);
                
                // Clear any temporary properties
                if (node.properties.tempVideoUrl) {
                    delete node.properties.tempVideoUrl;
                }
            }
            
            // Trigger a redraw
            if (window.app?.graphCanvas) {
                window.app.graphCanvas.dirty_canvas = true;
            }
            
            // The node properties have been updated and markDirty() was called,
            // which should trigger the sync through the normal state management flow
        });
    }
    
    /**
     * Check if a file is currently being processed
     */
    isProcessing(filename) {
        return this.activeProcessing.has(filename);
    }
    
    /**
     * Get all files currently being processed
     */
    getActiveProcessing() {
        return Array.from(this.activeProcessing.entries()).map(([filename, info]) => ({
            filename,
            ...info,
            duration: Date.now() - info.startTime
        }));
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.VideoProcessingListener = VideoProcessingListener;
}