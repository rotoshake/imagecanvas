// ===================================
// SIMPLIFIED DRAG AND DROP SYSTEM
// No temp hashes, no hash transitions, no race conditions
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
        }
    }
    
    onDragLeave(e) {
        this.preventDefaults(e);
        
        // Hide drop indicator when truly leaving the canvas
        if (!this.canvas.contains(e.relatedTarget)) {
            this.hideDropIndicator();
        }
    }
    
    async onDrop(e) {
        this.preventDefaults(e);
        this.hideDropIndicator();
        
        const files = Array.from(e.dataTransfer.files).filter(file => 
            this.acceptedTypes.has(file.type)
        );
        
        if (files.length === 0) {
            window.unifiedNotifications?.error('No supported image or video files found');
            return;
        }
        
        // Get drop position in graph coordinates
        const rect = this.canvas.getBoundingClientRect();
        const canvasPos = [
            e.clientX - rect.left,
            e.clientY - rect.top
        ];
        const dropPos = this.graph.canvas.viewport.convertOffsetToGraph(...canvasPos);
        
        // Process files with simplified architecture
        await this.processFiles(files, dropPos);
    }
    
    hasValidFiles(dataTransfer) {
        if (!dataTransfer.items) return false;
        
        for (let item of dataTransfer.items) {
            if (item.kind === 'file' && this.acceptedTypes.has(item.type)) {
                return true;
            }
        }
        return false;
    }
    
    showDropIndicator() {
        // Add visual feedback
        this.canvas.style.backgroundColor = 'rgba(0, 150, 255, 0.1)';
        this.canvas.style.border = '2px dashed #0096ff';
    }
    
    hideDropIndicator() {
        // Remove visual feedback
        this.canvas.style.backgroundColor = '';
        this.canvas.style.border = '';
    }
    
    /**
     * PROGRESSIVE FILE PROCESSING - Low-res previews first, then background processing
     * 1. Generate tiny previews for immediate visual feedback
     * 2. Create layout with actual images visible
     * 3. Background hash calculation
     * 4. Progressive full-res loading
     * 5. Background uploads and optimization
     */
    async processFiles(files, dropPos) {
        if (window.Logger.isEnabled('DRAGDROP_DETAILS')) {
            window.Logger.dragdrop('info', `🚀 Processing ${files.length} files with memory-efficient progressive loading`);
        }
        const startTime = Date.now();
        
        // Separate images and videos
        const imageFiles = [];
        const videoFiles = [];
        
        files.forEach(file => {
            if (file.type.startsWith('video/') || file.type === 'image/gif') {
                videoFiles.push(file);
            } else {
                imageFiles.push(file);
            }
        });
        
        console.log(`📁 Processing ${imageFiles.length} images and ${videoFiles.length} videos`);
        
        // Set bulk operation flag to prevent aggressive memory cleanup
        if (files.length > 10) {
            if (window.app) window.app.bulkOperationInProgress = true;
            if (window.memoryManager) window.memoryManager.bulkOperationInProgress = true;
        }
        
        try {
            // PHASE 1: Generate ultra-low-res previews (64px) for immediate display
            
            const previewDataMap = await this.generateQuickPreviews(files);
            
            // PHASE 2: Create layout with preview images visible
            
            const nodes = await this.createNodesWithPreviews(files, previewDataMap, dropPos);
            
            // Defer preview cleanup to ensure nodes have time to use the URLs
            // This prevents the blob URL ERR_FILE_NOT_FOUND error
            setTimeout(() => {
                previewDataMap.forEach(data => {
                    if (data.url && data.url.startsWith('blob:')) {
                        URL.revokeObjectURL(data.url);
                    }
                });
                previewDataMap.clear();
            }, 5000); // Wait 5 seconds before cleanup
            
            // Show success only for images (videos have their own purple notification)
            if (imageFiles.length > 0) {
                const message = `Added ${imageFiles.length} ${imageFiles.length === 1 ? 'image' : 'images'} to canvas`;
                window.unifiedNotifications?.info(message, { detail: 'Processing in background...', duration: 2000 });
            }
            
            // PHASE 3: Start background processing pipeline
            // Process images and videos separately
            if (imageFiles.length > 0) {
                this.startBackgroundPipeline(imageFiles, nodes.filter(n => n.type === 'media/image'));
            }
            
            if (videoFiles.length > 0) {
                this.startVideoProcessingPipeline(videoFiles, nodes.filter(n => n.type === 'media/video'));
            }
            
            return nodes;
            
        } catch (error) {
            console.error('❌ Failed to process files:', error);
            window.unifiedNotifications?.error('Failed to process files', { detail: error.message });
            return [];
        }
    }
    
    /**
     * Generate ultra-fast, memory-efficient previews
     */
    async generateQuickPreviews(files) {
        const previewMap = new Map();
        const previewSize = 64; // Tiny previews for minimal memory usage
        const maxConcurrent = 4; // Process in small batches
        
        // Show progress only for images
        let progressId = null;
        const imageCount = files.filter(f => !f.type.startsWith('video/') && f.type !== 'image/gif').length;
        if (window.unifiedNotifications && imageCount > 0) {
            progressId = window.unifiedNotifications.show({
                type: 'info',
                message: `Generating previews for ${imageCount} ${imageCount === 1 ? 'image' : 'images'}...`,
                duration: 0,
                persistent: true,
                progress: {
                    current: 0,
                    total: files.length,
                    showBar: true,
                    label: '0%'
                }
            });
        }
        
        // Process files in batches for memory efficiency
        for (let i = 0; i < files.length; i += maxConcurrent) {
            const batch = files.slice(i, i + maxConcurrent);
            
            await Promise.all(batch.map(async (file, batchIndex) => {
                const fileIndex = i + batchIndex;
                
                try {
                    if (file.type.startsWith('image/')) {
                        // Create canvas for preview generation
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        const img = new Image();
                        
                        // Use blob URL for memory efficiency
                        const blobUrl = URL.createObjectURL(file);
                        
                        await new Promise((resolve, reject) => {
                            img.onload = () => {
                                // Calculate dimensions
                                const aspectRatio = img.width / img.height;
                                if (aspectRatio >= 1) {
                                    canvas.width = previewSize;
                                    canvas.height = previewSize / aspectRatio;
                                } else {
                                    canvas.width = previewSize * aspectRatio;
                                    canvas.height = previewSize;
                                }
                                
                                // Draw tiny preview
                                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                                
                                // Convert to blob asynchronously for better performance
                                canvas.toBlob(blob => {
                                    if (blob) {
                                        const url = URL.createObjectURL(blob);
                                        previewMap.set(file, {
                                            url: url,
                                            width: img.width,
                                            height: img.height,
                                            aspectRatio: aspectRatio,
                                            isObjectURL: true // Mark for cleanup
                                        });
                                    }
                                }, 'image/jpeg', 0.6);
                                
                                // Clean up immediately
                                URL.revokeObjectURL(blobUrl);
                                resolve();
                            };
                            img.onerror = () => {
                                URL.revokeObjectURL(blobUrl);
                                reject(new Error(`Failed to load ${file.name}`));
                            };
                            img.src = blobUrl;
                        });
                    } else {
                        // Video files - extract first frame preview
                        try {
                            const preview = await this.extractVideoPreview(file, previewSize);
                            const dims = await this.getVideoDimensions(file);
                            
                            previewMap.set(file, {
                                url: preview,
                                width: dims.width,
                                height: dims.height,
                                aspectRatio: dims.width / dims.height,
                                isVideo: true
                            });
                            
                            if (preview) {
                                console.log(`🎬 Extracted preview for video: ${file.name}`);
                            }
                        } catch (error) {
                            console.warn(`Failed to extract video preview for ${file.name}:`, error);
                            // Fallback dimensions
                            previewMap.set(file, {
                                url: null,
                                width: 640,
                                height: 480,
                                aspectRatio: 640/480,
                                isVideo: true
                            });
                        }
                    }
                    
                    // Update progress
                    if (progressId) {
                        const progress = fileIndex + 1;
                        window.unifiedNotifications.update(progressId, {
                            progress: {
                                current: progress,
                                total: files.length,
                                showBar: true,
                                label: `${Math.round((progress / files.length) * 100)}%`
                            }
                        });
                    }
                } catch (error) {
                    
                    // Store fallback data
                    previewMap.set(file, {
                        url: null,
                        width: 200,
                        height: 200,
                        aspectRatio: 1
                    });
                }
            }));
            
            // Yield to maintain UI responsiveness
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        // Clear progress
        if (progressId) {
            window.unifiedNotifications.remove(progressId);
        }

        return previewMap;
    }
    
    /**
     * Create nodes with preview images visible immediately
     */
    async createNodesWithPreviews(files, previewDataMap, dropPos) {
        const nodes = [];
        const fileInfos = [];
        
        // Build file info array with preview data
        files.forEach(file => {
            const previewData = previewDataMap.get(file);
            if (previewData) {
                fileInfos.push({
                    file,
                    width: previewData.width,
                    height: previewData.height,
                    aspectRatio: previewData.aspectRatio,
                    previewUrl: previewData.url,
                    isVideo: previewData.isVideo || file.type.startsWith('video/')
                });
            }
        });
        
        // Calculate layout
        const positions = this.calculateAspectRatioLayout(fileInfos, dropPos);
        
        // Create nodes with previews
        for (let i = 0; i < fileInfos.length; i++) {
            const fileInfo = fileInfos[i];
            const position = positions[i];
            
            try {
                // Create node locally first for immediate reference
                const nodeType = fileInfo.isVideo ? 'media/video' : 'media/image';
                const node = NodeFactory.createNode(nodeType);
                
                if (!node) {
                    console.error(`❌ Failed to create node type: ${nodeType}`);
                    continue;
                }
                
                // Set node properties
                node.pos = [position.x, position.y];
                node.size = this.calculateNodeSize(fileInfo);
                node.properties = {
                    filename: fileInfo.file.name,
                    tempId: `temp-${Date.now()}-${i}`,
                    fileSize: fileInfo.file.size,
                    originalWidth: fileInfo.width,
                    originalHeight: fileInfo.height,
                    isPreview: true // Mark as preview to prevent heavy processing
                };
                
                // For video nodes, create a blob URL for immediate playback
                if (nodeType === 'media/video') {
                    const blobUrl = URL.createObjectURL(fileInfo.file);
                    node._tempBlobUrl = blobUrl;
                    node.properties.tempVideoUrl = blobUrl;
                    
                    // Don't set the video yet - wait for hash calculation
                    // This prevents the "No video source available" error
                    node.properties.pendingVideoInit = true;
                }
                
                // Add to graph immediately
                this.graph.add(node);
                
                // Mark node as pending server sync until we have a hash
                node._pendingServerSync = true;
                
                // Don't sync to server yet - wait until we have a hash
                
                // Set preview image if available
                if (fileInfo.previewUrl) {
                    // Store preview temporarily
                    node._previewUrl = fileInfo.previewUrl;
                    node.loadingState = 'preview';
                    
                    // For videos, store the preview to be used later when we have a hash
                    if (fileInfo.isVideo) {
                        node._pendingVideoPreview = fileInfo.previewUrl;
                    }
                    
                    // Trigger visual update
                    if (this.graph.canvas) {
                        this.graph.canvas.dirty_canvas = true;
                    }
                }
                
                nodes.push(node);
                
            } catch (error) {
                console.error(`❌ Failed to create node for ${fileInfo.file.name}:`, error);
            }
        }
        
        // Select created nodes
        if (nodes.length > 0) {
            try {
                if (window.app?.graphCanvas?.selection) {
                    window.app.graphCanvas.selection.selectAll(nodes);
                }
            } catch (error) {
                
            }
        }
        
        return nodes;
    }
    
    /**
     * Start background processing pipeline
     */
    async startBackgroundPipeline(files, nodes) {
        // Create file-to-node mapping
        const fileNodeMap = new Map();
        files.forEach((file, index) => {
            if (nodes[index]) {
                fileNodeMap.set(file, nodes[index]);
            }
        });
        
        // Start pipeline with progress tracking
        const pipeline = {
            files,
            nodes,
            fileNodeMap,
            completed: 0,
            total: files.length * 4 // 4 stages per file
        };
        
        // Show overall progress for images only
        const progressId = window.unifiedNotifications?.show({
            type: 'info',
            message: 'Processing images...',
            duration: 0,
            persistent: true,
            progress: {
                current: 0,
                total: 100,
                showBar: true,
                label: 'Starting...'
            }
        });
        
        pipeline.progressId = progressId;
        
        // Start stages
        this.startHashCalculation(pipeline);
    }
    
    /**
     * Start background hash calculation
     */
    async startHashCalculation(pipeline) {
        const { files, fileNodeMap, progressId } = pipeline;

        // Calculate hashes in background with progress
        const hashResults = new Map();
        const batchSize = 2; // Small batches to maintain responsiveness
        
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            
            await Promise.all(batch.map(async file => {
                try {
                    // Calculate hash
                    console.log(`🔢 Starting hash calculation for ${file.name}...`);
                    const hash = await window.fileHashCalculator.calculateHash(file);
                    hashResults.set(file, hash);
                    console.log(`✅ Hash calculated and stored: ${hash.substring(0, 8)}... for ${file.name}`);
                    
                    // Cache the file data immediately for upload coordinator
                    // This prevents "No cached data URL found" errors
                    if (window.app?.imageResourceCache && !file.type.startsWith('video/')) {
                        console.log(`📦 Caching data for upload: ${hash.substring(0, 8)}...`);
                        const reader = new FileReader();
                        const dataUrl = await new Promise((resolve, reject) => {
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(file);
                        });
                        
                        window.app.imageResourceCache.set(hash, {
                            url: dataUrl,
                            originalFilename: file.name,
                            isLocal: true
                        });
                        console.log(`✅ Data cached in imageResourceCache for ${hash.substring(0, 8)}...`);
                        
                        if (window.imageCache) {
                            window.imageCache.set(hash, dataUrl);
                            console.log(`✅ Data also cached in imageCache for ${hash.substring(0, 8)}...`);
                        }
                    }
                    
                    // Update node with real hash
                    const node = fileNodeMap.get(file);
                    if (node) {
                        node.properties.hash = hash;
                        delete node.properties.tempId; // Remove temp ID
                        
                        // Store file for later loading
                        node._pendingFile = file;
                        
                        // Now that we have a hash, sync the node to the server
                        if (node._pendingServerSync && window.app?.operationPipeline) {
                            delete node._pendingServerSync;
                            
                            // Create the node on the server with the proper hash
                            const nodeData = {
                                type: node.type,
                                pos: node.pos,
                                size: node.size,
                                properties: {
                                    ...node.properties,
                                    hash: hash,
                                    tempId: null
                                },
                                id: node.id
                            };
                            
                            window.app.operationPipeline.execute('node_create', nodeData)
                                .then(result => {
                                    console.log(`✅ Node ${node.id} synced to server with hash ${hash.substring(0, 8)}...`);
                                })
                                .catch(error => {
                                    
                                });
                        }
                    }
                    
                    // Update progress
                    pipeline.completed++;
                    this.updatePipelineProgress(pipeline);
                    
                } catch (error) {
                    console.error(`Failed to hash ${file.name}:`, error);
                }
            }));
            
            // Yield to maintain responsiveness
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Move to next stage
        this.startFullImageLoading(pipeline, hashResults);
    }
    
    /**
     * Start progressive full image loading
     */
    async startFullImageLoading(pipeline, hashResults) {
        const { files, fileNodeMap } = pipeline;

        // For bulk operations, only load visible images initially
        const loadFullImages = files.length <= 10; // Only load all if small batch
        
        // Process all files to cache data, but don't load images yet for large batches
        for (const file of files) {
            const node = fileNodeMap.get(file);
            const hash = hashResults.get(file);
            
            if (!node || !hash) continue;
            
            try {
                // Always cache the data URL for later use
                await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const dataUrl = reader.result;
                        
                        // Cache the data - ALWAYS cache for uploads later
                        if (window.imageCache) {
                            window.imageCache.set(hash, dataUrl);
                        }
                        // CRITICAL: Always cache in imageResourceCache for upload coordinator
                        if (window.app?.imageResourceCache) {
                            window.app.imageResourceCache.set(hash, {
                                url: dataUrl,
                                originalFilename: file.name,
                                isLocal: true
                            });
                        }
                        
                        // Update node
                        node.properties.isPreview = false;
                        
                        // For small batches or visible nodes, load immediately
                        if (loadFullImages || node._isNodeVisible?.()) {
                            // Set image (will trigger loading)
                            node.setImage(null, file.name, hash);
                        } else {
                            // For large batches, just mark as ready to load
                            node._imageDataReady = true;
                            node.loadingState = 'deferred';
                            console.log(`⏸️ Deferring full image load for ${file.name} (not visible)`);
                            
                            // Still ensure thumbnails are generated for deferred images
                            // Generate thumbnails using the cached image data
                            const cachedData = window.imageCache?.get(hash);
                            if (cachedData && window.thumbnailCache) {
                                const img = new Image();
                                img.onload = () => {
                                    // For deferred images in bulk imports, use low priority
                                    window.thumbnailCache.generateThumbnailsProgressive(
                                        hash, 
                                        img,
                                        null, // No progress callback needed
                                        'low' // Low priority for deferred images
                                    ).then(() => {
                                        console.log(`✅ Thumbnails generated for deferred image ${hash.substring(0, 8)}`);
                                        
                                        // Clear cached thumbnail to force refresh
                                        if (node._cachedThumbnail) {
                                            delete node._cachedThumbnail;
                                            delete node._cachedThumbnailSize;
                                        }
                                        
                                        // Force immediate redraw to show thumbnails
                                        if (window.app?.graphCanvas) {
                                            window.app.graphCanvas.dirty_canvas = true;
                                            window.app.graphCanvas.dirty_bgcanvas = true;
                                            // Force synchronous draw if possible
                                            if (window.app.graphCanvas.draw) {
                                                window.app.graphCanvas.draw(true, true);
                                            }
                                        }
                                    }).catch(err => {
                                        console.warn(`Failed to generate thumbnails for deferred image ${hash.substring(0, 8)}:`, err);
                                    });
                                };
                                img.src = cachedData;
                            }
                        }
                        
                        // Update progress
                        pipeline.completed++;
                        this.updatePipelineProgress(pipeline);
                        
                        resolve();
                    };
                    reader.onerror = () => {
                        console.error(`Failed to read ${file.name}`);
                        resolve();
                    };
                    reader.readAsDataURL(file);
                });
                
            } catch (error) {
                console.error(`Failed to process ${file.name}:`, error);
            }
            
            // Shorter yield for better performance
            if (files.indexOf(file) % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        // For large batches, set up viewport-based loading
        if (!loadFullImages) {
            this.setupViewportBasedLoading(fileNodeMap);
        }
        
        // Start uploads
        this.startBackgroundUploads(pipeline, hashResults);
    }
    
    /**
     * Start background uploads
     */
    async startBackgroundUploads(pipeline, hashResults) {
        const { files, fileNodeMap } = pipeline;

        // Upload files in background
        files.forEach(file => {
            const hash = hashResults.get(file);
            const node = fileNodeMap.get(file);
            if (!hash) return;
            
            // Mark this upload as being handled to prevent duplicate attempts
            if (window.app?.imageUploadCoordinator && node) {
                window.app.imageUploadCoordinator.pendingUploads.set(hash, {
                    startTime: Date.now(),
                    filename: file.name,
                    nodeId: node.id,
                    handledByDragDrop: true
                });
            }
            
            if (window.imageUploadManager) {
                window.imageUploadManager.uploadImage(
                    file,
                    file.name,
                    hash,
                    file.type
                ).then(result => {
                    
                    pipeline.completed++;
                    pipeline.uploadsCompleted = (pipeline.uploadsCompleted || 0) + 1;
                    this.updatePipelineProgress(pipeline);
                    
                    // Notify the upload coordinator
                    if (window.app?.imageUploadCoordinator) {
                        window.app.imageUploadCoordinator.pendingUploads.delete(hash);
                        window.app.imageUploadCoordinator.updateNodesWithHash(hash, result);
                        window.app.imageUploadCoordinator.notifyUploadComplete(hash, result);
                    }
                }).catch(error => {
                    console.error(`❌ Upload failed for ${file.name}:`, error);
                    
                    // Clean up from upload coordinator
                    if (window.app?.imageUploadCoordinator) {
                        window.app.imageUploadCoordinator.pendingUploads.delete(hash);
                    }
                    
                    // Still increment upload count even on failure
                    pipeline.uploadsCompleted = (pipeline.uploadsCompleted || 0) + 1;
                    this.updatePipelineProgress(pipeline);
                });
            }
        });
        
        // Enable server sync
        const nodes = Array.from(fileNodeMap.values());
        this.enableServerSync(nodes);
        
        // Clear bulk operation flag once initial processing is done
        // This allows user interactions to proceed normally
        setTimeout(() => {
            if (window.app) window.app.bulkOperationInProgress = false;
            if (window.memoryManager) window.memoryManager.bulkOperationInProgress = false;
            console.log('✅ Bulk operation flag cleared - user interactions now prioritized');
        }, 1000); // Clear after 1 second instead of 5
        
        // Complete pipeline notification after uploads finish
        setTimeout(() => {
            if (pipeline.progressId) {
                window.unifiedNotifications.remove(pipeline.progressId);
            }
            
            // Show completion message
            const successCount = pipeline.completed / 4; // Rough estimate
            window.unifiedNotifications?.success(
                `Processed ${Math.floor(successCount)} images`,
                { duration: 3000 }
            );
        }, 5000);
    }
    
    /**
     * Update pipeline progress
     */
    updatePipelineProgress(pipeline) {
        if (!pipeline.progressId) return;
        
        const percent = Math.min(100, Math.round((pipeline.completed / pipeline.total) * 100));
        const stage = pipeline.completed < pipeline.files.length ? 'Calculating hashes' :
                     pipeline.completed < pipeline.files.length * 2 ? 'Loading images' :
                     pipeline.completed < pipeline.files.length * 3 ? 'Uploading' : 'Finishing';
        
        window.unifiedNotifications.update(pipeline.progressId, {
            detail: stage,
            progress: {
                current: percent,
                total: 100,
                showBar: true,
                label: `${percent}%`
            }
        });
    }
    
    /**
     * Cache file data synchronously for uploads
     */
    async cacheFileData(files, hashResults) {
        const cachePromises = files.map(async (file) => {
            const hash = hashResults.get(file);
            if (!hash || file.type.startsWith('video/')) {
                return; // Skip videos and files without hashes
            }
            
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const dataURL = reader.result;
                    
                    // Store in image cache for node resolution
                    if (window.imageCache) {
                        window.imageCache.set(hash, dataURL);
                    }
                    
                    // Store in imageResourceCache for upload coordinator
                    if (window.app?.imageResourceCache) {
                        window.app.imageResourceCache.set(hash, {
                            url: dataURL,
                            originalFilename: file.name,
                            isLocal: true
                        });
                    }
                    
                    console.log(`💾 Pre-cached file data for hash ${hash.substring(0, 8)}...`);
                    resolve();
                };
                reader.onerror = () => {
                    console.error(`❌ Failed to cache data for ${file.name}`);
                    resolve(); // Don't block other files
                };
                reader.readAsDataURL(file);
            });
        });
        
        await Promise.all(cachePromises);
        
    }
    
    /**
     * Analyze dimensions and generate previews using real hashes
     */
    async analyzeDimensionsAndPreviews(files, hashResults) {
        const fileInfos = [];
        const batchSize = files.length > 50 ? 4 : files.length > 20 ? 8 : 12;
        
        // Process in batches to avoid overwhelming the system
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            
            const batchPromises = batch.map(async (file) => {
                const hash = hashResults.get(file);
                if (!hash) {
                    
                    return null;
                }
                
                try {
                    // Get dimensions and preview using real hash
                    let width, height, preview;
                    
                    if (file.type.startsWith('image/')) {
                        const analysis = await ImageDimensionReader.getDimensionsAndPreview(file, {
                            previewSizes: [64], // Small preview for immediate display
                            quality: 0.8,
                            format: 'image/webp'
                        });
                        
                        width = analysis.width;
                        height = analysis.height;
                        preview = analysis.previews[64];
                    } else {
                        // Video files - get dimensions and extract preview frame
                        const dims = await this.getVideoDimensions(file);
                        width = dims.width;
                        height = dims.height;
                        
                        // Extract preview frame from video
                        try {
                            preview = await this.extractVideoPreview(file, 64);
                            if (preview) {
                                console.log(`🎬 Extracted video preview for ${file.name}`);
                            }
                        } catch (error) {
                            console.error(`Failed to extract video preview for ${file.name}:`, error);
                            preview = null;
                        }
                    }
                    
                    return {
                        file,
                        hash, // Real hash, never changes!
                        width,
                        height,
                        aspectRatio: width / height,
                        preview,
                        isVideo: file.type.startsWith('video/') || file.type === 'image/gif'
                    };
                } catch (error) {
                    console.error(`❌ Failed to analyze ${file.name}:`, error);
                    return {
                        file,
                        hash,
                        width: 200,
                        height: 200,
                        aspectRatio: 1,
                        preview: null,
                        isVideo: file.type.startsWith('video/') || file.type === 'image/gif'
                    };
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            fileInfos.push(...batchResults.filter(info => info !== null));
            
            // Yield control between batches
            if (i + batchSize < files.length) {
                await new Promise(resolve => setTimeout(resolve, 5));
            }
        }

        return fileInfos;
    }
    
    /**
     * Create nodes using real hashes (no updates needed!)
     */
    async createNodesWithRealHashes(fileInfos, dropPos) {
        // Calculate aspect-ratio aware layout
        const positions = this.calculateAspectRatioLayout(fileInfos, dropPos);
        const nodes = [];
        
        for (let i = 0; i < fileInfos.length; i++) {
            const fileInfo = fileInfos[i];
            const position = positions[i];
            
            try {
                // Create node directly using NodeFactory (for immediate ImageNode methods)
                const node = NodeFactory.createNode(fileInfo.isVideo ? 'media/video' : 'media/image');
                
                if (!node) {
                    console.error(`❌ Failed to create node type: ${fileInfo.isVideo ? 'media/video' : 'media/image'}`);
                    continue;
                }
                
                // Set node properties with real hash
                node.pos = [position.x, position.y];
                node.size = this.calculateNodeSize(fileInfo);
                node.properties = {
                    filename: fileInfo.file.name,
                    hash: fileInfo.hash, // Real hash, permanent!
                    fileSize: fileInfo.file.size,
                    originalWidth: fileInfo.width,
                    originalHeight: fileInfo.height
                };
                
                // Add node to graph and execute through operation pipeline for undo support
                this.graph.add(node);
                
                // Queue the node creation for server sync to avoid overwhelming the server
                // We'll sync these in batches after all nodes are created locally
                if (!this._pendingNodeCreations) {
                    this._pendingNodeCreations = [];
                }
                this._pendingNodeCreations.push({
                    type: node.type,
                    pos: node.pos,
                    size: node.size,
                    properties: node.properties,
                    id: node.id
                });
                
                // Show loading state immediately (grey box) 
                node.loadingState = 'loading';
                node.loadingProgress = 0.1;
                
                // Node already added to graph above
                nodes.push(node);
                
                // Force immediate redraw to show grey loading box
                if (this.graph.canvas) {
                    this.graph.canvas.dirty_canvas = true;
                }
                
                // Set image using cached data (data is already cached from Phase 2)
                if (!fileInfo.isVideo) {
                    node.setImage(null, fileInfo.file.name, fileInfo.hash).catch(error => {
                        console.error(`❌ Failed to set image for ${fileInfo.file.name}:`, error);
                    });
                }
                
                // Set content asynchronously (don't await here for immediate feedback)
                if (fileInfo.preview && !fileInfo.isVideo) {
                    // Store 64px preview directly as thumbnail to eliminate redundancy
                    if (window.thumbnailCache) {
                        // Convert data URL to image for thumbnail storage
                        const img = new Image();
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            canvas.width = 64;
                            canvas.height = 64;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, 64, 64);
                            
                            // Store as regular thumbnail, not preview
                            window.thumbnailCache.setThumbnail(fileInfo.hash, 64, canvas);
                            console.log(`💾 Stored 64px preview as thumbnail for ${fileInfo.hash.substring(0, 8)}`);
                        };
                        img.src = fileInfo.preview;
                    }
                } else if (fileInfo.isVideo) {
                    // Set video using real hash (async)
                    node.setVideo(null, fileInfo.file.name, fileInfo.hash).catch(error => {
                        console.error(`❌ Failed to set video for ${fileInfo.file.name}:`, error);
                    });
                }
                
                console.log(`✅ Created node with real hash: ${fileInfo.hash.substring(0, 8)}... (${fileInfo.file.name})`);
            } catch (error) {
                console.error(`❌ Error creating node for ${fileInfo.file.name}:`, error);
            }
        }
        
        // Select all created nodes using proper SelectionManager API
        if (nodes.length > 0) {
            try {
                if (window.app?.graphCanvas?.selection) {
                    window.app.graphCanvas.selection.selectAll(nodes);
                    
                } else {
                    
                }
            } catch (error) {
                
                // Don't throw - node creation was successful, selection is just a UX enhancement
            }
        }
        
        // Start processing the queued node creations in batches
        if (this._pendingNodeCreations && this._pendingNodeCreations.length > 0) {
            this.processPendingNodeCreations();
        }

        return nodes;
    }
    
    /**
     * Process pending node creations in batches to avoid overwhelming the server
     */
    async processPendingNodeCreations() {
        if (!this._pendingNodeCreations || this._pendingNodeCreations.length === 0) return;
        
        const BATCH_SIZE = 10; // Send 10 at a time
        const BATCH_DELAY = 500; // Wait 500ms between batches
        
        console.log(`📦 Processing ${this._pendingNodeCreations.length} node creations in batches of ${BATCH_SIZE}`);
        
        while (this._pendingNodeCreations.length > 0) {
            // Take a batch
            const batch = this._pendingNodeCreations.splice(0, BATCH_SIZE);
            
            // Send each node creation in the batch
            const promises = batch.map(nodeData => 
                window.app.operationPipeline.execute('node_create', nodeData)
                    .catch(error => {
                        console.error(`Failed to sync node ${nodeData.id}:`, error);
                    })
            );
            
            // Wait for this batch to complete
            await Promise.all(promises);
            
            console.log(`✅ Synced batch of ${batch.length} nodes, ${this._pendingNodeCreations.length} remaining`);
            
            // Wait before sending next batch
            if (this._pendingNodeCreations.length > 0) {
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
            }
        }
        
        console.log('✅ All node creations synced to server');
    }
    
    /**
     * Start background uploads using real hashes (OLD METHOD - DEPRECATED)
     */
    startBackgroundUploadsOld(fileInfos) {
        fileInfos.forEach(fileInfo => {
            if (window.imageUploadManager) {
                // Upload file with real hash
                window.imageUploadManager.uploadImage(
                    fileInfo.file, // Upload original file
                    fileInfo.file.name,
                    fileInfo.hash, // Real hash
                    fileInfo.file.type
                ).then(uploadResult => {
                    
                    // Update any nodes using this hash
                    if (window.app && window.app.graph) {
                        const nodes = window.app.graph.nodes.filter(node => 
                            node.properties?.hash === fileInfo.hash
                        );
                        
                        nodes.forEach(node => {
                            if (node.properties) {
                                node.properties.serverUrl = uploadResult.url;
                                node.properties.serverFilename = uploadResult.serverFilename;
                            }
                        });
                    }
                }).catch(error => {
                    console.error(`❌ Upload failed for ${fileInfo.file.name}:`, error);
                });
            }
        });
    }
    
    /**
     * Enable server state synchronization (safe with real hashes)
     */
    enableServerSync(nodes) {
        // Re-enable server sync now that we have stable hashes
        nodes.forEach(node => {
            node._needsServerSync = true; // Safe now with real hashes
        });

        // Server sync happens automatically via the operation pipeline
    }
    
    /**
     * Set up viewport-based loading for large image sets
     */
    setupViewportBasedLoading(fileNodeMap) {
        console.log(`🔭 Setting up viewport-based loading for ${fileNodeMap.size} images`);
        
        // Track loading state
        const loadingState = {
            activeLoads: 0,
            maxConcurrentLoads: 5, // Increased from 3 for better performance
            lastCheck: 0,
            checkInterval: 100, // ms between checks
            priorityQueue: [] // Queue for loading based on proximity to viewport
        };
        
        // Create a viewport observer
        const checkVisibleNodes = () => {
            if (!window.app?.graphCanvas?.viewport) return;
            
            const now = Date.now();
            if (now - loadingState.lastCheck < loadingState.checkInterval) return;
            loadingState.lastCheck = now;
            
            const viewport = window.app.graphCanvas.viewport;
            const nodes = Array.from(fileNodeMap.values());
            const scale = viewport.scale;
            
            // Clear and rebuild priority queue
            loadingState.priorityQueue = [];
            
            // Calculate viewport bounds with extra padding for preloading
            const padding = 500; // Match ThumbnailCache padding
            const viewBounds = {
                left: -viewport.offset[0] - padding,
                top: -viewport.offset[1] - padding,
                right: -viewport.offset[0] + viewport.canvas.width / scale + padding,
                bottom: -viewport.offset[1] + viewport.canvas.height / scale + padding
            };
            
            // Center of viewport for distance calculations
            const viewportCenterX = -viewport.offset[0] + viewport.canvas.width / scale / 2;
            const viewportCenterY = -viewport.offset[1] + viewport.canvas.height / scale / 2;
            
            for (const node of nodes) {
                // Skip if already loading or loaded full image
                if (!node._imageDataReady || node.loadingState === 'loading' || 
                    (node.loadingState === 'loaded' && node.img)) {
                    continue;
                }
                
                const [x, y] = node.pos;
                const [w, h] = node.size;
                
                // Check if node intersects with extended viewport
                const isNearViewport = x + w >= viewBounds.left && x <= viewBounds.right &&
                                      y + h >= viewBounds.top && y <= viewBounds.bottom;
                
                if (isNearViewport && node.loadingState === 'deferred') {
                    // Calculate distance from viewport center for prioritization
                    const nodeCenterX = x + w / 2;
                    const nodeCenterY = y + h / 2;
                    const distance = Math.sqrt(
                        Math.pow(nodeCenterX - viewportCenterX, 2) + 
                        Math.pow(nodeCenterY - viewportCenterY, 2)
                    );
                    
                    loadingState.priorityQueue.push({
                        node,
                        distance,
                        priority: scale > 0.5 ? distance / 2 : distance // Higher priority when zoomed in
                    });
                }
            }
            
            // Sort by priority (closest first)
            loadingState.priorityQueue.sort((a, b) => a.priority - b.priority);
            
            // Process queue
            while (loadingState.activeLoads < loadingState.maxConcurrentLoads && 
                   loadingState.priorityQueue.length > 0) {
                const { node } = loadingState.priorityQueue.shift();
                
                // Load the full image
                node.loadingState = 'loading';
                loadingState.activeLoads++;
                
                console.log(`📸 Loading deferred image: ${node.properties.filename} (${loadingState.activeLoads}/${loadingState.maxConcurrentLoads} active)`);
                
                // Track when load completes
                const originalSetImage = node.setImage.bind(node);
                node.setImage = async function(...args) {
                    await originalSetImage(...args);
                    loadingState.activeLoads--;
                    // Restore original method
                    node.setImage = originalSetImage;
                };
                
                node.setImage(null, node.properties.filename, node.properties.hash);
            }
            
            // Log progress if we loaded any images
            if (loadingState.activeLoads > 0 || loadingState.priorityQueue.length > 0) {
                console.log(`📊 Viewport loading: ${loadingState.activeLoads} active, ${loadingState.priorityQueue.length} queued`);
            }
        };
        
        // Check immediately
        setTimeout(checkVisibleNodes, 100);
        
        // Set up periodic checks during scrolling/zooming
        let checkInterval = null;
        let lastViewportChange = Date.now();
        let movementCheckDelay = null;
        
        const startChecking = () => {
            lastViewportChange = Date.now();
            
            // Clear any pending check
            if (movementCheckDelay) {
                clearTimeout(movementCheckDelay);
            }
            
            // Don't check during active movement - wait for stillness
            if (!checkInterval) {
                checkInterval = setInterval(() => {
                    const timeSinceLastChange = Date.now() - lastViewportChange;
                    
                    // Stop checking after 500ms of no viewport changes
                    if (timeSinceLastChange > 500) {
                        clearInterval(checkInterval);
                        checkInterval = null;
                        
                        // Do final check after a brief delay to ensure movement has stopped
                        movementCheckDelay = setTimeout(() => {
                            checkVisibleNodes();
                            movementCheckDelay = null;
                        }, 100);
                        return;
                    }
                }, 100); // Check less frequently to reduce overhead
            }
        };
        
        // Listen for viewport changes using the viewport manager
        if (window.app?.graphCanvas?.viewport) {
            const viewport = window.app.graphCanvas.viewport;
            
            // Hook into existing viewport change handlers
            const originalPan = viewport.pan.bind(viewport);
            viewport.pan = function(...args) {
                originalPan(...args);
                this.notifyMovement();
                startChecking();
            };
            
            const originalZoom = viewport.zoom.bind(viewport);
            viewport.zoom = function(...args) {
                originalZoom(...args);
                this.notifyMovement();
                startChecking();
            };
            
            // Also listen for animation-based movements
            const originalAnimateTo = viewport.animateTo.bind(viewport);
            viewport.animateTo = function(...args) {
                originalAnimateTo(...args);
                startChecking();
            };
        }
        
        // Also check when window resizes
        window.addEventListener('resize', Utils.debounce(checkVisibleNodes, 300));

    }
    
    /**
     * Calculate aspect-ratio aware layout
     */
    calculateAspectRatioLayout(fileInfos, dropPos) {
        const padding = 20;
        const maxRowWidth = 800;
        const baseHeight = 200;
        
        // Group items into rows based on total width
        const rows = [];
        let currentRow = [];
        let currentRowWidth = 0;
        
        for (const fileInfo of fileInfos) {
            const itemWidth = baseHeight * fileInfo.aspectRatio;
            
            if (currentRow.length === 0 || currentRowWidth + itemWidth + padding <= maxRowWidth) {
                currentRow.push(fileInfo);
                currentRowWidth += itemWidth + (currentRow.length > 1 ? padding : 0);
            } else {
                rows.push(currentRow);
                currentRow = [fileInfo];
                currentRowWidth = itemWidth;
            }
        }
        
        if (currentRow.length > 0) {
            rows.push(currentRow);
        }
        
        // Calculate positions
        const positions = [];
        let currentY = dropPos[1] - (rows.length * (baseHeight + padding)) / 2;
        
        for (const row of rows) {
            // Calculate total width for centering
            let totalWidth = 0;
            for (const item of row) {
                totalWidth += baseHeight * item.aspectRatio;
            }
            totalWidth += (row.length - 1) * padding;
            
            // Position items in row
            let currentX = dropPos[0] - totalWidth / 2;
            for (const item of row) {
                const itemWidth = baseHeight * item.aspectRatio;
                positions.push({
                    x: currentX + itemWidth / 2,
                    y: currentY
                });
                currentX += itemWidth + padding;
            }
            
            currentY += baseHeight + padding;
        }
        
        return positions;
    }
    
    /**
     * Calculate node size based on file info
     */
    calculateNodeSize(fileInfo) {
        const importMode = window.CONFIG?.IMPORT?.IMAGE_IMPORT_MODE || 'fit';
        const fitSize = window.CONFIG?.IMPORT?.FIT_SIZE || 200;
        
        if (importMode === 'native') {
            return [fileInfo.width, fileInfo.height];
        } else {
            // Fit mode - maintain aspect ratio
            const aspectRatio = fileInfo.aspectRatio;
            if (aspectRatio >= 1) {
                return [fitSize, fitSize / aspectRatio];
            } else {
                return [fitSize * aspectRatio, fitSize];
            }
        }
    }
    
    /**
     * Get video dimensions (placeholder implementation)
     */
    async getVideoDimensions(file) {
        return new Promise((resolve) => {
            const video = document.createElement('video');
            const objectURL = URL.createObjectURL(file);
            
            video.onloadedmetadata = () => {
                URL.revokeObjectURL(objectURL);
                resolve({
                    width: video.videoWidth || 640,
                    height: video.videoHeight || 480
                });
            };
            
            video.onerror = () => {
                URL.revokeObjectURL(objectURL);
                resolve({ width: 640, height: 480 }); // Fallback
            };
            
            video.src = objectURL;
        });
    }
    
    /**
     * Start video processing pipeline with purple notifications
     */
    async startVideoProcessingPipeline(videoFiles, videoNodes) {
        console.log(`🎬 Starting video processing pipeline for ${videoFiles.length} videos`);
        
        // Create file-to-node mapping
        const fileNodeMap = new Map();
        videoFiles.forEach((file, index) => {
            if (videoNodes[index]) {
                fileNodeMap.set(file, videoNodes[index]);
            }
        });
        
        // Track individual video notifications
        const videoNotifications = new Map(); // file -> notificationId
        const videoCancelled = new Map(); // file -> boolean
        
        // Create a single notification for each video
        videoFiles.forEach(file => {
            const notificationId = window.unifiedNotifications?.showVideoProcessing(
                file.name,
                {
                    detail: 'Preparing...',
                    progress: {
                        current: 0,
                        total: 100,
                        showBar: true
                    },
                    onCancel: () => {
                        // Mark as cancelled so we can handle it when we have the hash
                        videoCancelled.set(file, true);
                        console.log(`🚫 Cancel requested for ${file.name}`);
                        
                        // Try to find and remove the node
                        const node = fileNodeMap.get(file);
                        if (node && window.app?.graph) {
                            window.app.graph.remove(node);
                            console.log(`🗑️ Removed video node for cancelled ${file.name}`);
                        }
                    }
                }
            );
            videoNotifications.set(file, notificationId);
        });
        
        // Calculate hashes for videos
        const hashResults = new Map();
        
        for (let i = 0; i < videoFiles.length; i++) {
            const file = videoFiles[i];
            const node = fileNodeMap.get(file);
            
            try {
                // Check if cancelled
                if (videoCancelled.get(file)) {
                    console.log(`⏭️ Skipping cancelled video: ${file.name}`);
                    continue;
                }
                
                // Calculate hash
                const hash = await window.fileHashCalculator.calculateHash(file);
                hashResults.set(file, hash);
                
                // Update cancel handler now that we have the hash
                if (window.unifiedNotifications && hash) {
                    const notificationData = window.unifiedNotifications.notifications.get(`video-${file.name}`);
                    if (notificationData) {
                        notificationData.onCancel = () => {
                            console.log(`🚫 Cancelling upload for ${file.name} (${hash})`);
                            
                            // Cancel the upload
                            if (window.imageUploadManager) {
                                window.imageUploadManager.cancelUpload(hash);
                            }
                            
                            // Remove the node
                            const node = fileNodeMap.get(file);
                            if (node && window.app?.graph) {
                                window.app.graph.remove(node);
                            }
                            
                            // Clean up blob URL
                            if (node?._tempBlobUrl) {
                                URL.revokeObjectURL(node._tempBlobUrl);
                            }
                            
                            // Also try to remove via VideoProcessingListener
                            // in case the node was already registered
                            if (window.videoProcessingListener) {
                                window.videoProcessingListener.removeVideoNode(file.name);
                            }
                        };
                    }
                }
                
                if (node) {
                    node.properties.hash = hash;
                    delete node.properties.tempId;
                    
                    // Now sync to server
                    if (node._pendingServerSync && window.app?.operationPipeline) {
                        delete node._pendingServerSync;
                        
                        const nodeData = {
                            type: node.type,
                            pos: node.pos,
                            size: node.size,
                            properties: {
                                ...node.properties,
                                hash: hash,
                                tempId: null
                            },
                            id: node.id
                        };
                        
                        await window.app.operationPipeline.execute('node_create', nodeData);
                        console.log(`✅ Video node ${node.id} synced to server with hash ${hash.substring(0, 8)}...`);
                    }
                    
                    // Create blob URL from file for video playback
                    const blobUrl = URL.createObjectURL(file);
                    
                    // Store blob URL in cache for immediate playback
                    if (window.imageCache) {
                        window.imageCache.set(hash, blobUrl);
                    }
                    
                    // Clear the pending init flag
                    delete node.properties.pendingVideoInit;
                    
                    // Set video immediately with blob URL for instant playback
                    await node.setVideo(blobUrl, file.name, hash);
                    
                    // Mark that we need to update to server URL after upload
                    node.properties.pendingServerUrlUpdate = true;
                    node._tempBlobUrl = blobUrl;
                    
                    // Store the video preview as thumbnail now that we have a hash
                    if (node._pendingVideoPreview && window.thumbnailCache) {
                        const img = new Image();
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            canvas.width = 64;
                            canvas.height = 64;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, 64, 64);
                            
                            window.thumbnailCache.setThumbnail(hash, 64, canvas);
                            console.log(`💾 Stored video preview as thumbnail for ${hash.substring(0, 8)}...`);
                            
                            // Force redraw to show thumbnail
                            if (window.app?.graphCanvas) {
                                window.app.graphCanvas.dirty_canvas = true;
                            }
                        };
                        img.src = node._pendingVideoPreview;
                        delete node._pendingVideoPreview;
                    }
                }
                
                // Update progress: 10% after hashing
                const notificationId = videoNotifications.get(file);
                if (notificationId) {
                    window.unifiedNotifications.updateVideoProgress(
                        file.name,
                        10,
                        null,
                        'Uploading...'
                    );
                }
                
            } catch (error) {
                console.error(`Failed to process video ${file.name}:`, error);
            }
        }
        
        // Start uploads (process up to 2 videos concurrently to prevent overwhelming server)
        const maxConcurrentVideoUploads = 2;
        const uploadQueue = Array.from(fileNodeMap.entries());
        
        // Process uploads in batches
        for (let i = 0; i < uploadQueue.length; i += maxConcurrentVideoUploads) {
            const batch = uploadQueue.slice(i, i + maxConcurrentVideoUploads);
            
            // Upload batch concurrently
            await Promise.all(batch.map(async ([file, node]) => {
                // Check if cancelled
                if (videoCancelled.get(file)) {
                    console.log(`⏭️ Skipping upload for cancelled video: ${file.name}`);
                    return;
                }
                
                const hash = hashResults.get(file);
                if (!hash) return;
                
                try {
                    // Track upload progress for this video
                    const uploadStartTime = Date.now();
                    let lastProgressUpdate = 0;
                    
                    // Listen for upload progress
                    const progressHandler = (uploadHash, progress) => {
                        if (uploadHash === hash) {
                            // Map upload progress from 10% to 30%
                            const mappedProgress = 10 + (progress * 20);
                            const now = Date.now();
                            
                            // Throttle updates to every 500ms
                            if (now - lastProgressUpdate > 500) {
                                window.unifiedNotifications.updateVideoProgress(
                                    file.name,
                                    mappedProgress,
                                    null,
                                    'Uploading...'
                                );
                                lastProgressUpdate = now;
                            }
                        }
                    };
                
                    // Register progress handler if available
                    if (window.imageProcessingProgress) {
                        window.imageProcessingProgress.on?.('uploadProgress', progressHandler);
                    }
                    
                    // Upload video
                    const result = await window.imageUploadManager.uploadMedia(
                        file,
                        file.name,
                        hash,
                        file.type
                    );
                    
                    // Remove progress handler
                    if (window.imageProcessingProgress) {
                        window.imageProcessingProgress.off?.('uploadProgress', progressHandler);
                    }
                    
                    // Update progress: 30% after upload (transcoding starts at 30%)
                    const notificationId = videoNotifications.get(file);
                    if (notificationId) {
                        window.unifiedNotifications.updateVideoProgress(
                            file.name,
                            30,
                            null,
                            'Queued for processing...'
                        );
                    }
                
                    // Update node with server info
                    if (node && result) {
                        node.properties.serverUrl = result.url;
                        node.properties.serverFilename = result.filename;
                        
                        // Don't update video source yet - wait for transcoding to complete
                        // The blob URL will continue playing during upload and transcoding
                        console.log(`📤 Upload complete for ${file.name}, continuing with blob URL during transcoding`);
                        
                        // Keep the pendingServerUrlUpdate flag true so VideoProcessingListener
                        // can handle the transition after transcoding is complete
                        
                        // Register the node with VideoProcessingListener for tracking
                        if (window.videoProcessingListener) {
                            window.videoProcessingListener.registerVideoNode(file.name, node);
                        }
                    }
                    
                } catch (error) {
                    console.error(`Failed to upload video ${file.name}:`, error);
                    
                    // Video remains playable from blob URL even if upload fails
                    console.log(`📹 Video ${file.name} will continue playing from local blob URL`);
                    
                    // Update notification to show error
                    window.unifiedNotifications?.updateVideoProgress(
                        file.name,
                        0,
                        null,
                        'Upload failed - retrying...'
                    );
                    
                    // Retry once for timeout/network errors
                    if (error.message?.includes('timeout') || error.message?.includes('Network')) {
                        console.log(`🔄 Retrying upload for ${file.name}...`);
                        
                        try {
                            const result = await window.imageUploadManager.uploadMedia(
                                file,
                                file.name,
                                hash,
                                file.type
                            );
                            
                            // Update progress after successful retry
                            window.unifiedNotifications?.updateVideoProgress(
                                file.name,
                                30,
                                null,
                                'Processing on server...'
                            );
                            
                            // Update node with server info
                            if (node && result) {
                                node.properties.serverUrl = result.url;
                                node.properties.serverFilename = result.filename;
                                
                                // Don't update video source yet - wait for transcoding
                                console.log(`📤 Upload retry successful for ${file.name}, continuing with blob URL during transcoding`);
                                
                                // Keep the pendingServerUrlUpdate flag true
                            }
                        } catch (retryError) {
                            console.error(`❌ Retry failed for ${file.name}:`, retryError);
                            
                            // Mark as failed
                            window.unifiedNotifications?.completeVideoProcessing(
                                file.name,
                                false
                            );
                        }
                    } else {
                        // Non-retryable error
                        window.unifiedNotifications?.completeVideoProcessing(
                            file.name,
                            false
                        );
                    }
                }
            })); // End of batch.map
        } // End of batch processing loop
        
        // Videos continue processing on server - notifications will be updated by VideoProcessingListener
        
        // Clear bulk operation flag if needed
        if (videoFiles.length > 10) {
            if (window.app) window.app.bulkOperationInProgress = false;
            if (window.memoryManager) window.memoryManager.bulkOperationInProgress = false;
        }
    }
    
    /**
     * Extract a preview frame from video
     */
    async extractVideoPreview(file, targetSize = 64) {
        return new Promise((resolve) => {
            const video = document.createElement('video');
            const objectURL = URL.createObjectURL(file);
            
            video.onloadeddata = () => {
                // Seek to 10% of the video duration for a better thumbnail
                video.currentTime = video.duration * 0.1;
            };
            
            video.onseeked = () => {
                try {
                    // Create canvas for preview
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    // Calculate dimensions maintaining aspect ratio
                    const aspectRatio = video.videoWidth / video.videoHeight;
                    let width = targetSize;
                    let height = targetSize;
                    
                    if (aspectRatio > 1) {
                        height = targetSize / aspectRatio;
                    } else {
                        width = targetSize * aspectRatio;
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    
                    // Draw video frame
                    ctx.drawImage(video, 0, 0, width, height);
                    
                    // Convert to blob asynchronously for better performance
                    canvas.toBlob(blob => {
                        URL.revokeObjectURL(objectURL);
                        if (blob) {
                            const previewUrl = URL.createObjectURL(blob);
                            resolve(previewUrl);
                        } else {
                            resolve(null);
                        }
                    }, 'image/webp', 0.8);
                } catch (error) {
                    console.error('Failed to extract video preview:', error);
                    URL.revokeObjectURL(objectURL);
                    resolve(null);
                }
            };
            
            video.onerror = () => {
                URL.revokeObjectURL(objectURL);
                resolve(null);
            };
            
            // Set video properties for loading
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            video.src = objectURL;
        });
    }
}

// Make DragDropManager available globally
if (typeof window !== 'undefined') {
    window.DragDropManager = DragDropManager;
}