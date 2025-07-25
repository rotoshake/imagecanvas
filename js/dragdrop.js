// ===================================
// DRAG AND DROP SYSTEM
// ===================================

class DragDropManager {
    constructor(canvas, graph) {
        this.canvas = canvas;
        this.graph = graph;
        this.acceptedTypes = new Set([
            'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp',
            'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
            'image/gif' // Treat GIF as video
        ]);
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Prevent default behavior for all drag events
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.canvas.addEventListener(eventName, this.preventDefaults.bind(this), false);
        });
        
        // Add specific handlers
        this.canvas.addEventListener('dragenter', this.onDragEnter.bind(this));
        this.canvas.addEventListener('dragover', this.onDragOver.bind(this));
        this.canvas.addEventListener('dragleave', this.onDragLeave.bind(this));
        this.canvas.addEventListener('drop', this.onDrop.bind(this));
    }
    
    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    onDragEnter(e) {
        this.preventDefaults(e);
        
        // Check if we have valid files
        if (this.hasValidFiles(e.dataTransfer)) {
            this.showDropIndicator();
        }
    }
    
    onDragOver(e) {
        this.preventDefaults(e);
        
        // Set the drop effect
        if (this.hasValidFiles(e.dataTransfer)) {
            e.dataTransfer.dropEffect = 'copy';
        } else {
            e.dataTransfer.dropEffect = 'none';
        }
    }
    
    onDragLeave(e) {
        this.preventDefaults(e);
        
        // Only hide indicator if we're leaving the canvas entirely
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            this.hideDropIndicator();
        }
    }
    
    async onDrop(e) {
        this.preventDefaults(e);
        this.hideDropIndicator();
        
        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;
        
        // Filter valid files
        const validFiles = files.filter(file => this.isValidFile(file));
        if (validFiles.length === 0) {
            this.showErrorMessage('No supported files found. Supported formats: Images (JPG, PNG, WebP, BMP) and Videos (MP4, WebM, OGG, MOV, GIF)');
            return;
        }
        
        // Get drop position
        const dropPos = this.getDropPosition(e);
        
        try {
            await this.processFiles(validFiles, dropPos);
        } catch (error) {
            console.error('Failed to process dropped files:', error);
            this.showErrorMessage('Failed to process some files');
        }
    }
    
    hasValidFiles(dataTransfer) {
        if (!dataTransfer.types) return false;
        
        // Check if we have files
        return dataTransfer.types.includes('Files');
    }
    
    isValidFile(file) {
        return this.acceptedTypes.has(file.type);
    }
    
    getDropPosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasPos = [
            e.clientX - rect.left,
            e.clientY - rect.top
        ];
        
        // Convert to graph coordinates
        return this.graph.canvas.viewport.convertOffsetToGraph(...canvasPos);
    }
    
    async processFiles(files, dropPos) {
        const newNodes = [];
        const cascadeOffset = 40; // Offset for multiple files
        
        // Start unified progress tracking
        const fileInfos = files.map(file => ({
            name: file.name,
            size: file.size,
            hash: null // Will be set during processing
        }));
        const batchId = window.imageProcessingProgress?.startBatch(fileInfos) || null;
        
        // First, process and upload all image files
        const imageFiles = [];
        const videoFiles = [];
        
        for (const file of files) {
            if (file.type.startsWith('video/') || file.type === 'image/gif') {
                videoFiles.push(file);
            } else if (file.type.startsWith('image/')) {
                imageFiles.push(file);
            }
        }
        
        // Upload images first via HTTP (videos will use the old flow for now)
        const uploadedImages = new Map(); // hash -> upload result
        
        if (imageFiles.length > 0 && window.imageUploadManager) {
            console.log(`📤 Uploading ${imageFiles.length} images via HTTP first...`);
            
            // Show upload notification
            if (window.unifiedNotifications) {
                window.unifiedNotifications.info(
                    `Uploading ${imageFiles.length} images...`,
                    { detail: 'Please wait while images are uploaded' }
                );
            }
            
            // Process images in batches to avoid overwhelming the server
            const BATCH_SIZE = 5; // Upload 5 at a time
            for (let i = 0; i < imageFiles.length; i += BATCH_SIZE) {
                const batch = imageFiles.slice(i, i + BATCH_SIZE);
                const uploadPromises = [];
                
                for (const file of batch) {
                    // Get data URL and hash
                    const dataURL = await this.fileToDataURL(file);
                    const hash = await HashUtils.hashImageData(dataURL);
                    
                    // Update progress tracking
                    if (batchId && window.imageProcessingProgress) {
                        window.imageProcessingProgress.updateFileHash(file.name, hash);
                    }
                    
                    // Start upload
                    const uploadPromise = window.imageUploadManager.uploadImage(dataURL, file.name, hash)
                        .then(result => {
                            uploadedImages.set(hash, {
                                ...result,
                                file,
                                dataURL,
                                hash
                            });
                            console.log(`✅ Uploaded ${file.name}`);
                        })
                        .catch(error => {
                            console.error(`❌ Failed to upload ${file.name}:`, error);
                            // Store failure so we can fall back to old method
                            uploadedImages.set(hash, { error, file, dataURL, hash });
                        });
                    
                    uploadPromises.push(uploadPromise);
                }
                
                // Wait for batch to complete
                await Promise.all(uploadPromises);
            }
        }
        
        // Now create nodes for all files
        const allFiles = [...imageFiles, ...videoFiles];
        for (let i = 0; i < allFiles.length; i++) {
            const file = allFiles[i];
            
            try {
                // Yield control to keep UI responsive
                await new Promise(resolve => requestAnimationFrame(resolve));
                
                const nodeData = await this.createNodeFromFile(file, dropPos, i * cascadeOffset, batchId, uploadedImages);
                if (nodeData) {
                    // Update the batch with the actual hash
                    if (batchId && nodeData.properties.hash) {
                        window.imageProcessingProgress?.updateLoadProgress(nodeData.properties.hash, 1);
                    }
                    if (window.app?.operationPipeline) {
                        try {
                            // Create node params based on whether we have a pre-uploaded image
                            const nodeParams = {
                                type: nodeData.type,
                                pos: [...nodeData.pos],
                                size: [...nodeData.size],
                                properties: {
                                    ...nodeData.properties
                                }
                            };
                            
                            // For pre-uploaded images, don't include the data URL
                            if (nodeData.properties.serverUrl) {
                                // Already uploaded - just use server URL
                                console.log(`📎 Creating node with pre-uploaded image: ${nodeData.properties.serverUrl}`);
                            } else if (nodeData.type === 'media/image') {
                                // Fallback for failed uploads - include data URL
                                nodeParams.properties.src = nodeData.dataURL;
                            }
                            
                            // For videos, include video data (keep old flow for now)
                            if (nodeData.type === 'media/video') {
                                nodeParams.videoData = {
                                    src: nodeData.dataURL,
                                    filename: nodeData.properties.filename,
                                    hash: nodeData.properties.hash
                                };
                            }
                            
                            // Use operation pipeline from the start for proper undo tracking
                            const result = await window.app.operationPipeline.execute('node_create', nodeParams);
                            
                            if (result.success && result.result?.node) {
                                const createdNode = result.result.node;
                                newNodes.push(createdNode);
                                console.log(`✅ ${nodeData.type} node created via OperationPipeline, ID:`, createdNode.id);
                                
                                // For images, the CreateNodeCommand will handle background upload
                                // No need for additional sync operations here
                            } else {
                                console.error('❌ OperationPipeline returned no node');
                            }
                        } catch (error) {
                            console.error('Failed to create node via pipeline:', error);
                            
                            // Show user-friendly error message
                            if (error.message && error.message.includes('timeout')) {
                                if (window.unifiedNotifications) {
                                    window.unifiedNotifications.warning(
                                        'Network timeout - creating local node',
                                        { detail: 'The image will sync when connection stabilizes' }
                                    );
                                }
                            }
                            
                            // Fallback to direct creation for offline mode
                            const node = NodeFactory.createNode(nodeData.type);
                            if (node) {
                                node.pos = [...nodeData.pos];
                                node.size = [...nodeData.size];
                                node.properties = { ...nodeData.properties };
                                
                                // Set loading state immediately for visual feedback
                                if (node.type === 'media/image') {
                                    node.loadingState = 'loading';
                                    node.loadingProgress = 0;
                                }
                                
                                // Load the media
                                if (nodeData.type === 'media/video') {
                                    node.setVideo(nodeData.dataURL, nodeData.properties.filename, nodeData.properties.hash);
                                } else {
                                    node.setImage(nodeData.dataURL, nodeData.properties.filename, nodeData.properties.hash);
                                }
                                
                                this.graph.add(node);
                                newNodes.push(node);
                                
                                // Force immediate redraw to show loading state
                                if (this.graph.canvas) {
                                    this.graph.canvas.dirty_canvas = true;
                                    requestAnimationFrame(() => this.graph.canvas.draw());
                                }
                                
                                // Mark for later sync when connection improves
                                node._needsServerSync = true;
                            }
                        }
                    } else {
                        // No pipeline available - create locally
                        console.log('📍 Creating node directly (no pipeline)');
                        const node = NodeFactory.createNode(nodeData.type);
                        if (node) {
                            node.pos = [...nodeData.pos];
                            node.size = [...nodeData.size];
                            node.properties = { ...nodeData.properties };
                            
                            // Set loading state immediately for visual feedback
                            if (node.type === 'media/image') {
                                node.loadingState = 'loading';
                                node.loadingProgress = 0;
                            }
                            
                            // Load the media
                            if (nodeData.type === 'media/video') {
                                node.setVideo(nodeData.dataURL, nodeData.properties.filename, nodeData.properties.hash);
                            } else {
                                node.setImage(nodeData.dataURL, nodeData.properties.filename, nodeData.properties.hash);
                            }
                            
                            this.graph.add(node);
                            newNodes.push(node);
                            
                            // Force immediate redraw to show loading state
                            if (this.graph.canvas) {
                                this.graph.canvas.dirty_canvas = true;
                                requestAnimationFrame(() => this.graph.canvas.draw());
                            }
                        }
                    }
                    
                    // Trigger redraw to show new node immediately
                    if (this.graph.canvas) {
                        this.graph.canvas.dirty_canvas = true;
                    }
                    
                    // Additional yield after adding each node for smoother experience
                    await new Promise(resolve => requestAnimationFrame(resolve));
                }
            } catch (error) {
                console.error('Failed to create node from file:', file.name, error);
            }
        }
        
        // Batch completion is handled by ImageProcessingProgressManager
        
        // Select all new nodes
        if (newNodes.length > 0) {
            this.selectNewNodes(newNodes);
            
            // Save state and add to undo stack
            if (this.graph.canvas.stateManager) {
                this.graph.canvas.stateManager.pushUndoState(this.graph, this.graph.canvas);
            }
        }
    }
    
    async createNodeFromFile(file, basePos, offset, batchId, uploadedImages) {
        // Determine node type
        const isVideo = file.type.startsWith('video/') || file.type === 'image/gif';
        const nodeType = isVideo ? 'media/video' : 'media/image';
        
        let dataURL, hash, uploadResult;
        
        // Check if this image was pre-uploaded
        if (uploadedImages && !isVideo) {
            // For images, check if we already have the upload result
            // First we need to get the hash to look it up
            dataURL = await this.fileToDataURL(file);
            hash = await HashUtils.hashImageData(dataURL);
            uploadResult = uploadedImages.get(hash);
            
            if (uploadResult && !uploadResult.error) {
                console.log(`✅ Using pre-uploaded image: ${uploadResult.url}`);
                // Don't need to cache locally since it's already on server
            } else {
                // Cache locally as fallback
                window.imageCache.set(hash, dataURL);
            }
        } else {
            // For videos or if no pre-upload, process normally
            console.log('📱 Processing file for state sync:', file.name);
            dataURL = await this.fileToDataURL(file);
            hash = await HashUtils.hashImageData(dataURL);
            
            // Cache the media locally
            window.imageCache.set(hash, dataURL);
        }
        
        // Pre-load media to get correct dimensions
        let size = [200, 200]; // Default fallback
        let aspectRatio = undefined; // Let it use natural aspect ratio
        
        if (!isVideo) {
            // For images, pre-load to get dimensions
            try {
                const img = await this.loadImageForDimensions(dataURL);
                if (img.naturalWidth && img.naturalHeight) {
                    const aspect = img.naturalWidth / img.naturalHeight;
                    // Keep height at 200, adjust width for aspect ratio
                    size = [200 * aspect, 200];
                }
            } catch (error) {
                console.warn('Failed to pre-load image dimensions:', error);
            }
        }
        // For videos, we'll let the video node handle dimensions after loading
        
        // Update progress manager with actual hash (replace placeholder)
        if (batchId && window.imageProcessingProgress) {
            window.imageProcessingProgress.updateFileHash(file.name, hash);
        }
        
        // Prepare properties based on whether we have a pre-upload
        const properties = {
            filename: file.name,
            hash: hash,
            fileSize: file.size,
            mimeType: file.type
        };
        
        // Add server URL if we have a successful pre-upload
        if (uploadResult && !uploadResult.error) {
            properties.serverUrl = uploadResult.url;
            properties.serverFilename = uploadResult.filename;
        }
        
        // Return node data for OperationPipeline, not an actual node
        return {
            type: nodeType,
            pos: [
                basePos[0] - (size[0] / 2) + offset, // Center based on actual size
                basePos[1] - (size[1] / 2) + offset
            ],
            size: size,
            properties: properties,
            dataURL: dataURL // Pass this for loading after node creation
        };
    }
    
    loadImageForDimensions(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }
    
    fileToDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }
    
    selectNewNodes(nodes) {
        if (this.graph.canvas.selection) {
            this.graph.canvas.selection.clear();
            nodes.forEach(node => this.graph.canvas.selection.selectNode(node, true));
        }
        
        if (this.graph.canvas) {
            this.graph.canvas.dirty_canvas = true;
        }
    }
    
    showDropIndicator() {
        // Add visual drop indicator
        this.canvas.classList.add('drop-active');
        
        // Create overlay if it doesn't exist
        if (!this.dropOverlay) {
            this.createDropOverlay();
        }
        
        this.dropOverlay.style.display = 'block';
    }
    
    hideDropIndicator() {
        this.canvas.classList.remove('drop-active');
        
        if (this.dropOverlay) {
            this.dropOverlay.style.display = 'none';
        }
    }
    
    createDropOverlay() {
        this.dropOverlay = document.createElement('div');
        this.dropOverlay.className = 'drop-overlay';
        this.dropOverlay.innerHTML = `
            <div class="drop-indicator">
                <div class="drop-icon">📁</div>
                <div class="drop-text">Drop images or videos here</div>
                <div class="drop-subtext">Supported: JPG, PNG, WebP, BMP, MP4, WebM, MOV, GIF</div>
            </div>
        `;
        
        // Style the overlay
        Object.assign(this.dropOverlay.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'none',
            zIndex: '1000',
            pointerEvents: 'none'
        });
        
        // Style the indicator
        const indicator = this.dropOverlay.querySelector('.drop-indicator');
        Object.assign(indicator.style, {
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            color: 'white',
            fontSize: '18px',
            fontFamily: 'Arial, sans-serif'
        });
        
        const icon = this.dropOverlay.querySelector('.drop-icon');
        Object.assign(icon.style, {
            fontSize: '48px',
            marginBottom: '16px'
        });
        
        const subtext = this.dropOverlay.querySelector('.drop-subtext');
        Object.assign(subtext.style, {
            fontSize: '14px',
            opacity: '0.8',
            marginTop: '8px'
        });
        
        // Add to canvas container
        const canvasContainer = this.canvas.parentElement || document.body;
        canvasContainer.style.position = 'relative';
        canvasContainer.appendChild(this.dropOverlay);
    }
    
    showErrorMessage(message) {
        if (window.unifiedNotifications) {
            window.unifiedNotifications.error(message);
        }
    }
    
    showSuccessMessage(message) {
        if (window.unifiedNotifications) {
            window.unifiedNotifications.success(message);
        }
    }
    
    showProgressMessage(current, total) {
        const notification = document.createElement('div');
        notification.className = 'drag-drop-progress';
        
        // Style the notification
        Object.assign(notification.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '16px 24px',
            borderRadius: '8px',
            color: 'white',
            backgroundColor: '#339af0',
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            zIndex: '10000',
            opacity: '0',
            transform: 'translateY(-20px)',
            transition: 'all 0.3s ease',
            maxWidth: '320px',
            wordWrap: 'break-word',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        });
        
        document.body.appendChild(notification);
        
        // Animate in
        requestAnimationFrame(() => {
            notification.style.opacity = '1';
            notification.style.transform = 'translateY(0)';
        });
        
        return notification;
    }
    
    updateProgressMessage(notification, current, total, filename = '') {
        const percentage = Math.round((current / total) * 100);
        const progressBar = '█'.repeat(Math.floor(percentage / 5)) + '░'.repeat(20 - Math.floor(percentage / 5));
        
        notification.innerHTML = `
            <div style="margin-bottom: 8px;">Loading images: ${current}/${total} (${percentage}%)</div>
            <div style="font-family: monospace; font-size: 12px; margin-bottom: 8px;">${progressBar}</div>
            <div style="font-size: 12px; opacity: 0.8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${filename}</div>
        `;
    }
    
    hideProgressMessage(notification) {
        if (notification && notification.parentNode) {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(-20px)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }
    }
    
    showMessage(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `drag-drop-notification ${type}`;
        notification.textContent = message;
        
        // Style the notification
        Object.assign(notification.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '12px 20px',
            borderRadius: '6px',
            color: 'white',
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            zIndex: '10000',
            opacity: '0',
            transform: 'translateY(-20px)',
            transition: 'all 0.3s ease',
            maxWidth: '300px',
            wordWrap: 'break-word'
        });
        
        // Set background color based on type
        switch (type) {
            case 'error':
                notification.style.backgroundColor = '#ff6b6b';
                break;
            case 'success':
                notification.style.backgroundColor = '#51cf66';
                break;
            default:
                notification.style.backgroundColor = '#339af0';
        }
        
        document.body.appendChild(notification);
        
        // Animate in
        requestAnimationFrame(() => {
            notification.style.opacity = '1';
            notification.style.transform = 'translateY(0)';
        });
        
        // Remove after delay
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(-20px)';
            
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
    
    // Utility methods
    getFileInfo(file) {
        return {
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            isValid: this.isValidFile(file),
            category: this.getFileCategory(file)
        };
    }
    
    getFileCategory(file) {
        if (file.type.startsWith('image/') && file.type !== 'image/gif') {
            return 'image';
        } else if (file.type.startsWith('video/') || file.type === 'image/gif') {
            return 'video';
        }
        return 'unknown';
    }
    
    // Validation
    validateFileSize(file, maxSizeMB = 100) {
        const maxBytes = maxSizeMB * 1024 * 1024;
        return file.size <= maxBytes;
    }
    
    // Cleanup
    cleanup() {
        if (this.dropOverlay && this.dropOverlay.parentNode) {
            this.dropOverlay.parentNode.removeChild(this.dropOverlay);
        }
        
        // Remove event listeners
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.canvas.removeEventListener(eventName, this.preventDefaults);
        });
    }
    
    // Debug information
    getDebugInfo() {
        return {
            acceptedTypes: Array.from(this.acceptedTypes),
            hasDropOverlay: !!this.dropOverlay,
            canvasHasDropClass: this.canvas.classList.contains('drop-active')
        };
    }
}