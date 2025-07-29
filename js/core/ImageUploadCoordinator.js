/**
 * ImageUploadCoordinator - Manages background uploads for image nodes
 * Ensures images are uploaded even when nodes are created via state sync
 */
class ImageUploadCoordinator {
    constructor(app) {
        this.app = app;
        this.pendingUploads = new Map(); // hash -> upload info
        this.uploadObservers = new Map(); // hash -> Set of callbacks
        
        // Post-upload sync management
        this.lastSyncTime = 0;
        this.syncCooldown = 3000; // Minimum 3 seconds between syncs
        
        // Bundle tracking - remove legacy bundle system
        // Now using unified progress system
        
        // Check for pending uploads periodically
        this.checkInterval = setInterval(() => this.checkPendingUploads(), 2000);
        
        console.log('📤 ImageUploadCoordinator initialized with post-upload sync checks');
    }
    
    /**
     * Called when any image node is created (local or remote)
     */
    onImageNodeCreated(node) {
        if (!node || node.type !== 'media/image') return;
        
        const { hash, serverUrl, filename } = node.properties;
        
        // Skip if already has serverUrl
        if (serverUrl) {
            // Node already has serverUrl
            return;
        }
        
        // Skip if no hash
        if (!hash) {
            console.warn(`⚠️ Node ${node.id} has no hash`);
            return;
        }
        
        // Checking upload status for node
        
        // Check if upload is already pending
        if (this.pendingUploads.has(hash)) {
            // Upload already pending
            this.observeUpload(hash, node);
            return;
        }
        
        // Check if upload is already being handled by imageUploadManager
        if (window.imageUploadManager?.isUploading(hash)) {
            console.log(`📤 Upload already in progress via imageUploadManager for ${hash.substring(0, 8)}...`);
            this.observeUpload(hash, node);
            return;
        }
        
        // Check if we have the data to upload
        const cached = this.app.imageResourceCache?.get(hash);
        if (!cached?.url?.startsWith('data:')) {
            // For deferred nodes, the data might not be cached yet
            // This is OK - the dragdrop.js upload process will handle it
            if (node.loadingState === 'deferred' || node._imageDataReady) {
                console.log(`⏳ Deferred node ${node.id} - upload will start when data is ready`);
                return;
            }
            console.log(`⚠️ No cached data URL found for hash ${hash.substring(0, 8)}... - upload cannot start`);
            console.log(`   Cache has data: ${!!cached}, URL starts with data: ${cached?.url?.startsWith('data:')}`);
            return;
        }
        
        console.log(`✅ Found cached data for upload: ${hash.substring(0, 8)}... (${cached.originalFilename || 'unknown file'})`);
        
        // Start the upload
        this.startUpload(node, cached);
    }
    
    /**
     * Start background upload for a node
     */
    startUpload(node, cachedData) {
        const { hash, filename } = node.properties;
        
        // Starting upload
        
        // Mark as pending
        this.pendingUploads.set(hash, {
            startTime: Date.now(),
            filename: filename,
            nodeId: node.id
        });
        
        // Start the actual upload - unified progress system handles bundling
        window.imageUploadManager.uploadImage(
            cachedData.url,
            filename || cachedData.originalFilename,
            hash
        ).then(async (uploadResult) => {
            // Upload complete
            
            // Remove from pending
            this.pendingUploads.delete(hash);
            
            // Update all nodes with this hash
            await this.updateNodesWithHash(hash, uploadResult);
            
            // Notify observers
            this.notifyUploadComplete(hash, uploadResult);
            
            // Add a brief delay, then trigger a quick sync to ensure images are visible
            // This helps prevent invisible images that require manual refresh
            setTimeout(() => {
                this.triggerPostUploadSync(hash);
            }, 1000); // 1 second delay to allow upload processing to complete
            
        }).catch(error => {
            console.error(`❌ Upload failed for ${hash.substring(0, 8)}...`, error);
            
            // Get current retry count or initialize to 0
            const uploadInfo = this.pendingUploads.get(hash);
            const retryCount = (uploadInfo?.retryCount || 0) + 1;
            const maxRetries = 3;
            
            if (retryCount <= maxRetries) {
                console.log(`🔄 Scheduling retry ${retryCount}/${maxRetries} for ${hash.substring(0, 8)}... in ${retryCount * 2} seconds`);
                
                // Update retry count
                this.pendingUploads.set(hash, {
                    ...uploadInfo,
                    retryCount: retryCount,
                    lastRetryTime: Date.now()
                });
                
                // Schedule retry with exponential backoff
                setTimeout(() => {
                    console.log(`🔄 Retrying upload for ${hash.substring(0, 8)}... (attempt ${retryCount})`);
                    this.startUpload(node, cachedData);
                }, retryCount * 2000);
            } else {
                console.error(`❌ Max retries exceeded for ${hash.substring(0, 8)}...`);
                this.pendingUploads.delete(hash);
                
                // Mark as failed in progress system
                if (window.imageProcessingProgress) {
                    window.imageProcessingProgress.markFailed(hash, 'upload');
                }
            }
        });
    }
    
    /**
     * Update all nodes with the same hash (with retry for timing issues)
     */
    async updateNodesWithHash(hash, uploadResult) {
        let nodes = this.app.graph.nodes.filter(n => 
            n.type === 'media/image' && n.properties?.hash === hash
        );
        
        // If no nodes found, wait a bit and retry (optimistic nodes might be in transition)
        if (nodes.length === 0) {
            console.log(`⏳ No nodes found for hash ${hash.substring(0, 8)}..., retrying in 500ms`);
            await new Promise(resolve => setTimeout(resolve, 500));
            
            nodes = this.app.graph.nodes.filter(n => 
                n.type === 'media/image' && n.properties?.hash === hash
            );
        }
        
        console.log(`🔄 Updated ${nodes.length} local nodes with serverUrl for hash ${hash.substring(0, 8)}...`);
        
        // Debug: Log all nodes to understand what's available
        if (nodes.length === 0) {
            const allImageNodes = this.app.graph.nodes.filter(n => n.type === 'media/image');
            console.log(`🔍 Debug: Found ${allImageNodes.length} total image nodes:`);
            allImageNodes.forEach(node => {
                console.log(`  - Node ${node.id}: hash=${node.properties?.hash?.substring(0, 8)}..., serverUrl=${!!node.properties?.serverUrl}`);
            });
            
            // Also check if there are any nodes in transition/optimistic state
            if (this.app.stateSyncManager && this.app.stateSyncManager.optimisticNodes) {
                const optimisticNodes = Array.from(this.app.stateSyncManager.optimisticNodes.values());
                console.log(`🔍 Debug: Found ${optimisticNodes.length} optimistic nodes in StateSyncManager`);
            }
        }
        
        const fullUrl = uploadResult.url.startsWith('http') 
            ? uploadResult.url 
            : CONFIG.SERVER.API_BASE + uploadResult.url;
        
        // Update each node locally
        if (nodes.length > 0) {
            nodes.forEach(node => {
                node.properties.serverUrl = uploadResult.url;
                node.properties.serverFilename = uploadResult.serverFilename || uploadResult.filename;
                
                // Update image source if needed
                if (node.img && node.img.src.startsWith('data:')) {
                    node.img.src = fullUrl;
                }
            });
            console.log(`✅ Successfully updated ${nodes.length} nodes with serverUrl`);
        } else {
            console.warn(`⚠️ No nodes found to update for hash ${hash.substring(0, 8)}...`);
        }
        
        // Send image_upload_complete operation to sync with server
        if (this.app.operationPipeline) {
            try {
                await this.app.operationPipeline.execute('image_upload_complete', {
                    hash: hash,
                    serverUrl: uploadResult.url,
                    serverFilename: uploadResult.serverFilename || uploadResult.filename
                });
                // Server notified of upload completion
            } catch (error) {
                console.error('❌ Failed to notify server:', error);
                
                // If it's an authentication error, try to retry after a delay
                if (error.message && error.message.includes('Not authenticated')) {
                    console.log('🔄 Retrying upload notification after authentication error');
                    setTimeout(async () => {
                        try {
                            await this.app.operationPipeline.execute('image_upload_complete', {
                                hash: hash,
                                serverUrl: uploadResult.url,
                                serverFilename: uploadResult.serverFilename || uploadResult.filename
                            });
                            console.log('✅ Upload notification retry succeeded');
                        } catch (retryError) {
                            console.error('❌ Upload notification retry failed:', retryError);
                        }
                    }, 2000); // Wait 2 seconds before retry
                }
            }
        }
        
        // Update cache
        if (this.app.imageResourceCache) {
            // Get original filename from existing cache entry if nodes not found
            const existingCache = this.app.imageResourceCache.get(hash);
            const originalFilename = nodes[0]?.properties.filename || existingCache?.originalFilename;
            
            this.app.imageResourceCache.set(hash, {
                url: fullUrl,
                serverFilename: uploadResult.serverFilename || uploadResult.filename,
                originalFilename: originalFilename,
                thumbnail: nodes[0]?.thumbnail || existingCache?.thumbnail,
                isLocal: false
            });
            console.log(`💾 Updated cache for hash ${hash.substring(0, 8)}... with server URL`);
        }
    }
    
    /**
     * Observe an upload for a specific node
     */
    observeUpload(hash, node) {
        if (!this.uploadObservers.has(hash)) {
            this.uploadObservers.set(hash, new Set());
        }
        
        this.uploadObservers.get(hash).add((uploadResult) => {
            // Update this specific node when upload completes
            const currentNode = this.app.graph.getNodeById(node.id);
            if (currentNode) {
                currentNode.properties.serverUrl = uploadResult.url;
                currentNode.properties.serverFilename = uploadResult.serverFilename || uploadResult.filename;
                
                const fullUrl = uploadResult.url.startsWith('http') 
                    ? uploadResult.url 
                    : CONFIG.SERVER.API_BASE + uploadResult.url;
                    
                if (currentNode.img && currentNode.img.src.startsWith('data:')) {
                    currentNode.img.src = fullUrl;
                }
            }
        });
    }
    
    /**
     * Notify all observers when upload completes
     */
    notifyUploadComplete(hash, uploadResult) {
        const observers = this.uploadObservers.get(hash);
        if (observers) {
            observers.forEach(callback => callback(uploadResult));
            this.uploadObservers.delete(hash);
        }
    }
    
    /**
     * Trigger a post-upload sync check to ensure images are visible
     */
    triggerPostUploadSync(hash) {
        // Check if the uploaded images are actually visible in the current state
        const nodesWithHash = this.app.graph.nodes.filter(n => 
            n.type === 'media/image' && n.properties?.hash === hash
        );
        
        if (nodesWithHash.length === 0) {
            console.log(`📄 No nodes found with hash ${hash.substring(0, 8)}... - sync may be needed`);
            this.requestQuickSync('no nodes found with uploaded hash');
            return;
        }
        
        // Check if nodes have proper serverUrl
        const nodesWithoutServerUrl = nodesWithHash.filter(n => !n.properties.serverUrl);
        if (nodesWithoutServerUrl.length > 0) {
            console.log(`📄 ${nodesWithoutServerUrl.length} nodes missing serverUrl for hash ${hash.substring(0, 8)}... - sync needed`);
            this.requestQuickSync('nodes missing serverUrl after upload');
            return;
        }
        
        // Check if images are actually loading/loaded
        const nodesWithBrokenImages = nodesWithHash.filter(n => {
            return n.img && (n.img.src.startsWith('data:') || !n.img.complete);
        });
        
        if (nodesWithBrokenImages.length > 0) {
            console.log(`📄 ${nodesWithBrokenImages.length} nodes with broken/loading images for hash ${hash.substring(0, 8)}... - sync needed`);
            this.requestQuickSync('images not loaded properly after upload');
            return;
        }
        
        console.log(`✅ Post-upload check passed for hash ${hash.substring(0, 8)}... - all images appear properly synced`);
    }
    
    /**
     * Request a quick sync to refresh the canvas state
     */
    requestQuickSync(reason) {
        const now = Date.now();
        
        // Check cooldown to prevent too frequent syncing
        if (now - this.lastSyncTime < this.syncCooldown) {
            console.log(`⏳ Sync request skipped (cooldown): ${reason}`);
            return;
        }
        
        this.lastSyncTime = now;
        console.log(`🔄 Requesting post-upload sync: ${reason}`);
        
        if (this.app.stateSyncManager?.requestFullSync) {
            this.app.stateSyncManager.requestFullSync();
            
            // Show a brief notification to let the user know we're syncing
            if (window.unifiedNotifications) {
                window.unifiedNotifications.info('Syncing images...', { 
                    duration: 2000,
                    id: 'post-upload-sync'
                });
            }
        } else {
            console.warn('⚠️ Cannot request sync - StateSyncManager not available');
        }
    }
    
    /**
     * Check for nodes that need upload (periodic check)
     */
    checkPendingUploads() {
        // Find all image nodes without serverUrl
        const needsUpload = this.app.graph.nodes.filter(n => 
            n.type === 'media/image' && 
            n.properties?.hash && 
            !n.properties?.serverUrl &&
            !this.pendingUploads.has(n.properties.hash)
        );
        
        if (needsUpload.length > 0) {
            console.log(`🔍 Found ${needsUpload.length} nodes needing upload`);
            needsUpload.forEach(node => this.onImageNodeCreated(node));
        }
        
        // Clean up stale retry entries (older than 5 minutes)
        const now = Date.now();
        const staleThreshold = 5 * 60 * 1000; // 5 minutes
        
        for (const [hash, uploadInfo] of this.pendingUploads) {
            if (uploadInfo.lastRetryTime && (now - uploadInfo.lastRetryTime) > staleThreshold) {
                console.warn(`🧹 Cleaning up stale retry for ${hash.substring(0, 8)}...`);
                this.pendingUploads.delete(hash);
                
                // Mark as failed
                if (window.imageProcessingProgress) {
                    window.imageProcessingProgress.markFailed(hash, 'stale');
                }
            }
        }
    }
    
    // Bundle management removed - now handled by unified progress system
    
    /**
     * Cleanup
     */
    destroy() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        // No bundle timeout to clear - handled by unified progress system
        this.pendingUploads.clear();
        this.uploadObservers.clear();
    }
}

// Export
if (typeof window !== 'undefined') {
    window.ImageUploadCoordinator = ImageUploadCoordinator;
}