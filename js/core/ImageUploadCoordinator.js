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
        
        console.log('📤 ImageUploadCoordinator initialized');
    }
    
    /**
     * Called when any image node is created (local or remote)
     */
    onImageNodeCreated(node) {
        if (!node || node.type !== 'media/image') return;
        
        const { hash, serverUrl, filename } = node.properties;
        
        // Skip if already has serverUrl
        if (serverUrl) {
            console.log(`✅ Node ${node.id} already has serverUrl`);
            return;
        }
        
        // Skip if no hash
        if (!hash) {
            console.warn(`⚠️ Node ${node.id} has no hash`);
            return;
        }
        
        console.log(`🔍 Checking upload status for node ${node.id} (hash: ${hash.substring(0, 8)}...)`);
        
        // Check if upload is already pending
        if (this.pendingUploads.has(hash)) {
            console.log(`⏳ Upload already pending for hash ${hash.substring(0, 8)}...`);
            this.observeUpload(hash, node);
            return;
        }
        
        // Check if we have the data to upload
        const cached = this.app.imageResourceCache?.get(hash);
        if (!cached?.url?.startsWith('data:')) {
            console.log(`❌ No data URL cached for hash ${hash.substring(0, 8)}...`);
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
        
        console.log(`📤 Starting upload for ${filename} (${hash.substring(0, 8)}...)`);
        
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
            console.log(`✅ Upload complete for ${hash.substring(0, 8)}...`);
            
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
        
        console.log(`🔄 Updating ${nodes.length} nodes with hash ${hash.substring(0, 8)}...`);
        
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
                console.log(`✅ Server notified of upload completion`);
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
            console.log(`💾 Cache updated with server URL`);
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
            console.log(`🔍 Found ${needsUpload.length} nodes needing upload`);
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