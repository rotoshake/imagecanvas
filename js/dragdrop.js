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
        
        // Set bulk operation flag to prevent aggressive memory cleanup
        if (files.length > 10) {
            if (window.app) window.app.bulkOperationInProgress = true;
            if (window.memoryManager) window.memoryManager.bulkOperationInProgress = true;
        }
        
        try {
            // PHASE 1: Generate ultra-low-res previews (64px) for immediate display
            console.log('⚡ Phase 1: Generating quick previews...');
            const previewDataMap = await this.generateQuickPreviews(files);
            
            // PHASE 2: Create layout with preview images visible
            console.log('📐 Phase 2: Creating layout with previews...');
            const nodes = await this.createNodesWithPreviews(files, previewDataMap, dropPos);
            
            // Clear preview data URLs after nodes are created to free memory
            console.log('🧹 Clearing preview memory...');
            previewDataMap.forEach(data => {
                if (data.url && data.url.startsWith('blob:')) {
                    URL.revokeObjectURL(data.url);
                }
            });
            previewDataMap.clear();
            
            // Show success - users see actual images immediately
            window.unifiedNotifications?.info(
                `Added ${files.length} ${files.length === 1 ? 'image' : 'images'} to canvas`,
                { detail: 'Processing in background...', duration: 2000 }
            );
            
            // PHASE 3: Start background processing pipeline
            console.log('🔧 Phase 3: Starting background processing...');
            this.startBackgroundPipeline(files, nodes);
            
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
        
        // Show progress
        let progressId = null;
        if (window.unifiedNotifications) {
            progressId = window.unifiedNotifications.show({
                type: 'info',
                message: `Generating previews for ${files.length} files...`,
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
                                
                                // Store preview data
                                previewMap.set(file, {
                                    url: canvas.toDataURL('image/jpeg', 0.6), // Low quality for size
                                    width: img.width,
                                    height: img.height,
                                    aspectRatio: aspectRatio
                                });
                                
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
                        // Video files - just store dimensions
                        previewMap.set(file, {
                            url: null,
                            width: 640,
                            height: 480,
                            aspectRatio: 640/480,
                            isVideo: true
                        });
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
                    console.warn(`Failed to generate preview for ${file.name}:`, error);
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
        
        console.log(`✅ Generated ${previewMap.size} previews`);
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
                
                // Add to graph immediately
                this.graph.add(node);
                
                // Mark node as pending server sync until we have a hash
                node._pendingServerSync = true;
                
                // Don't sync to server yet - wait until we have a hash
                console.log(`⏸️ Delaying server sync for node ${node.id} until hash is calculated`);
                
                // Set preview image if available
                if (fileInfo.previewUrl && !fileInfo.isVideo) {
                    // Store preview temporarily
                    node._previewUrl = fileInfo.previewUrl;
                    node.loadingState = 'preview';
                    
                    // Trigger visual update
                    if (this.graph.canvas) {
                        this.graph.canvas.dirty_canvas = true;
                    }
                }
                
                nodes.push(node);
                console.log(`✅ Created preview node for ${fileInfo.file.name}`);
                
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
                console.warn('Failed to select nodes:', error);
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
        
        // Show overall progress
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
        
        console.log('🔐 Starting background hash calculation...');
        
        // Calculate hashes in background with progress
        const hashResults = new Map();
        const batchSize = 2; // Small batches to maintain responsiveness
        
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            
            await Promise.all(batch.map(async file => {
                try {
                    // Calculate hash
                    const hash = await window.fileHashCalculator.calculateHash(file);
                    hashResults.set(file, hash);
                    
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
                                    console.warn(`⚠️ Failed to sync node ${node.id} to server:`, error);
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
        
        console.log(`✅ Calculated ${hashResults.size} hashes`);
        
        // Move to next stage
        this.startFullImageLoading(pipeline, hashResults);
    }
    
    /**
     * Start progressive full image loading
     */
    async startFullImageLoading(pipeline, hashResults) {
        const { files, fileNodeMap } = pipeline;
        
        console.log('🖼️ Starting viewport-aware image loading...');
        
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
                                    window.thumbnailCache.generateThumbnailsProgressive(hash, img).then(() => {
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
        
        console.log('✅ Image data caching complete');
        
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
        
        console.log('☁️ Starting background uploads...');
        
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
                    console.log(`✅ Uploaded ${file.name}`);
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
        
        // Complete pipeline after uploads finish
        setTimeout(() => {
            if (pipeline.progressId) {
                window.unifiedNotifications.remove(pipeline.progressId);
            }
            console.log('✅ Background pipeline complete');
            
            // Clear bulk operation flag
            if (window.app) window.app.bulkOperationInProgress = false;
            if (window.memoryManager) window.memoryManager.bulkOperationInProgress = false;
            
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
        console.log(`✅ Cached data for ${files.length} files`);
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
                    console.warn(`⚠️ No hash available for ${file.name}, skipping`);
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
                        // Video files - get basic dimensions
                        const dims = await this.getVideoDimensions(file);
                        width = dims.width;
                        height = dims.height;
                        preview = null; // Videos don't need previews for now
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
        
        console.log(`✅ Analyzed ${fileInfos.length} files with real hashes`);
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
                
                // Execute through operation pipeline for server sync (async)
                window.app.operationPipeline.execute('node_create', {
                    type: node.type,
                    pos: node.pos,
                    size: node.size,
                    properties: node.properties,
                    id: node.id
                }).catch(error => {
                    console.warn(`⚠️ Operation pipeline failed for ${fileInfo.file.name}:`, error);
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
                    console.log(`✅ Selected ${nodes.length} newly created nodes`);
                } else {
                    console.warn('⚠️ Cannot select nodes - selection manager not available');
                }
            } catch (error) {
                console.warn('⚠️ Failed to select nodes after creation:', error);
                // Don't throw - node creation was successful, selection is just a UX enhancement
            }
        }
        
        console.log(`✅ Created ${nodes.length} nodes with permanent hashes`);
        return nodes;
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
                    console.log(`✅ Upload complete for ${fileInfo.file.name}: ${uploadResult.url}`);
                    
                    // Update any nodes using this hash
                    if (window.app && window.app.graph) {
                        const nodes = window.app.graph.nodes.filter(node => 
                            node.properties?.hash === fileInfo.hash
                        );
                        
                        nodes.forEach(node => {
                            if (node.properties) {
                                node.properties.serverUrl = uploadResult.url;
                                node.properties.serverFilename = uploadResult.filename;
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
        
        console.log(`✅ Enabled server sync for ${nodes.length} nodes with stable hashes`);
        // Server sync happens automatically via the operation pipeline
    }
    
    /**
     * Set up viewport-based loading for large image sets
     */
    setupViewportBasedLoading(fileNodeMap) {
        console.log('👁️ Setting up viewport-based image loading...');
        
        // Create a viewport observer
        const checkVisibleNodes = () => {
            if (!window.app?.graphCanvas?.viewport) return;
            
            const viewport = window.app.graphCanvas.viewport;
            const nodes = Array.from(fileNodeMap.values());
            let loadedCount = 0;
            let deferredCount = 0;
            
            for (const node of nodes) {
                // Skip if already loading or loaded full image
                if (!node._imageDataReady || node.loadingState === 'loading' || 
                    (node.loadingState === 'loaded' && node.img)) {
                    continue;
                }
                
                // Check if node is visible using the viewport manager
                const isVisible = viewport.isNodeVisible(node, CONFIG.PERFORMANCE.VISIBILITY_MARGIN);
                
                if (isVisible && node.loadingState === 'deferred') {
                    // Load the full image
                    node.loadingState = 'loading';
                    node.setImage(null, node.properties.filename, node.properties.hash);
                    loadedCount++;
                    
                    // Limit how many we load at once to prevent overwhelming the system
                    if (loadedCount >= 3) break;
                } else if (!isVisible && node.loadingState === 'loaded' && node.img && 
                          !window.memoryManager?.bulkOperationInProgress) {
                    // Consider unloading images that are far outside viewport during memory pressure
                    const memoryUsage = window.memoryManager?.getMemoryUsagePercent() || 0;
                    if (memoryUsage > 85) {
                        // Only unload if really far away (3x margin)
                        if (!viewport.isNodeVisible(node, CONFIG.PERFORMANCE.VISIBILITY_MARGIN * 3)) {
                            node.degradeQuality('thumbnail-only');
                            deferredCount++;
                        }
                    }
                }
            }
            
            if (loadedCount > 0 || deferredCount > 0) {
                console.log(`📸 Viewport update: loaded ${loadedCount}, deferred ${deferredCount} images`);
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
        
        console.log('✅ Viewport-based loading configured');
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
}

// Make DragDropManager available globally
if (typeof window !== 'undefined') {
    window.DragDropManager = DragDropManager;
}