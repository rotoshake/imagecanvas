/**
 * ImageUploadCoordinator - Manages background uploads for image nodes
 * Ensures images are uploaded even when nodes are created via state sync
 */
class ImageUploadCoordinator {
    constructor(app) {
        this.app = app;
        this.pendingUploads = new Map(); // hash -> upload info
        this.uploadObservers = new Map(); // hash -> Set of callbacks
        
        // Bundle tracking - remove legacy bundle system
        // Now using unified progress system
        
        // Check for pending uploads periodically
        this.checkInterval = setInterval(() => this.checkPendingUploads(), 2000);
        
        // ImageUploadCoordinator initialized
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
        
        // Check if we have the data to upload
        const cached = this.app.imageResourceCache?.get(hash);
        if (!cached?.url?.startsWith('data:')) {
            // No data URL cached
            return;
        }
        
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
            
        }).catch(error => {
            console.error(`❌ Upload failed for ${hash.substring(0, 8)}...`, error);
            this.pendingUploads.delete(hash);
            
            // Could implement retry logic here
        });
    }
    
    /**
     * Update all nodes with the same hash
     */
    async updateNodesWithHash(hash, uploadResult) {
        const nodes = this.app.graph.nodes.filter(n => 
            n.type === 'media/image' && n.properties?.hash === hash
        );
        
        // Updating nodes with hash
        
        const fullUrl = uploadResult.url.startsWith('http') 
            ? uploadResult.url 
            : CONFIG.SERVER.API_BASE + uploadResult.url;
        
        // Update each node locally
        nodes.forEach(node => {
            node.properties.serverUrl = uploadResult.url;
            node.properties.serverFilename = uploadResult.filename;
            
            // Update image source if needed
            if (node.img && node.img.src.startsWith('data:')) {
                node.img.src = fullUrl;
            }
        });
        
        // Send image_upload_complete operation to sync with server
        if (this.app.operationPipeline) {
            try {
                await this.app.operationPipeline.execute('image_upload_complete', {
                    hash: hash,
                    serverUrl: uploadResult.url,
                    serverFilename: uploadResult.filename
                });
                // Server notified of upload completion
            } catch (error) {
                console.error('❌ Failed to notify server:', error);
            }
        }
        
        // Update cache
        if (this.app.imageResourceCache) {
            this.app.imageResourceCache.set(hash, {
                url: fullUrl,
                serverFilename: uploadResult.filename,
                originalFilename: nodes[0]?.properties.filename,
                thumbnail: nodes[0]?.thumbnail,
                isLocal: false
            });
            // Cache updated with server URL
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
                currentNode.properties.serverFilename = uploadResult.filename;
                
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
            // Found nodes needing upload
            needsUpload.forEach(node => this.onImageNodeCreated(node));
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