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
     * SIMPLIFIED FILE PROCESSING - No temp hashes, no race conditions
     * 1. Calculate real hashes upfront
     * 2. Generate previews with real hashes  
     * 3. Create nodes with real hashes (no updates)
     * 4. Upload files in background
     * 5. Sync server state
     */
    async processFiles(files, dropPos) {
        console.log(`🚀 Processing ${files.length} files with simplified architecture`);
        const startTime = Date.now();
        const newNodes = [];
        
        try {
            // PHASE 1: Calculate real hashes upfront (no temp hashes!)
            console.log('📊 Phase 1: Calculating real content hashes...');
            const hashResults = await window.fileHashCalculator.calculateBatchHashes(
                files, 
                (current, total) => {
                    console.log(`🔐 Hash progress: ${current}/${total}`);
                    // Show simple progress notification
                    if (window.unifiedNotifications && current === 1) {
                        window.unifiedNotifications.info(
                            `Processing ${total} files...`,
                            { id: 'hash-progress', duration: 0 }
                        );
                    }
                }
            );
            
            // Clear progress notification
            if (window.unifiedNotifications) {
                window.unifiedNotifications.remove('hash-progress');
            }
            
            // PHASE 2: Analyze dimensions and generate previews
            console.log('📊 Phase 2: Analyzing dimensions and generating previews...');
            const fileInfos = await this.analyzeDimensionsAndPreviews(files, hashResults);
            
            // PHASE 3: Create nodes with real hashes (no updates needed!)
            console.log('📊 Phase 3: Creating nodes with permanent hashes...');
            const nodes = await this.createNodesWithRealHashes(fileInfos, dropPos);
            newNodes.push(...nodes);
            
            // PHASE 4: Start background uploads
            console.log('📊 Phase 4: Starting background uploads...');
            this.startBackgroundUploads(fileInfos);
            
            // PHASE 5: Enable server sync (safe with real hashes)
            console.log('📊 Phase 5: Enabling server state sync...');
            this.enableServerSync(nodes);
            
            const duration = Date.now() - startTime;
            console.log(`✅ Simplified processing complete: ${nodes.length} nodes created in ${duration}ms`);
            
            // Show success notification
            window.unifiedNotifications?.success(
                `Added ${nodes.length} ${nodes.length === 1 ? 'image' : 'images'} to canvas`,
                { detail: `Processed in ${(duration / 1000).toFixed(1)}s` }
            );
            
            return newNodes;
            
        } catch (error) {
            console.error('❌ Failed to process files:', error);
            window.unifiedNotifications?.error('Failed to process files', { detail: error.message });
            return newNodes;
        }
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
                // Create node with real hash from the start
                const nodeData = {
                    type: fileInfo.isVideo ? 'media/video' : 'media/image',
                    pos: [position.x, position.y],
                    properties: {
                        filename: fileInfo.file.name,
                        hash: fileInfo.hash, // Real hash, permanent!
                        fileSize: fileInfo.file.size,
                        originalWidth: fileInfo.width,
                        originalHeight: fileInfo.height
                    },
                    size: this.calculateNodeSize(fileInfo)
                };
                
                // Create node through operation pipeline (for undo/redo support)
                const node = await window.app.operationPipeline.execute('create_node', nodeData);
                
                if (node) {
                    // Set preview immediately if available
                    if (fileInfo.preview && !fileInfo.isVideo) {
                        // Store preview in cache using real hash
                        if (window.thumbnailCache) {
                            window.thumbnailCache.setPreview(fileInfo.hash, 64, fileInfo.preview);
                        }
                        
                        // Set image using real hash
                        await node.setImage(null, fileInfo.file.name, fileInfo.hash);
                    } else if (fileInfo.isVideo) {
                        // Set video using real hash
                        await node.setVideo(null, fileInfo.file.name, fileInfo.hash);
                    }
                    
                    nodes.push(node);
                    console.log(`✅ Created node with real hash: ${fileInfo.hash.substring(0, 8)}... (${fileInfo.file.name})`);
                } else {
                    console.error(`❌ Failed to create node for ${fileInfo.file.name}`);
                }
            } catch (error) {
                console.error(`❌ Error creating node for ${fileInfo.file.name}:`, error);
            }
        }
        
        // Select all created nodes
        if (nodes.length > 0 && window.app?.graphCanvas) {
            window.app.graphCanvas.selectNodes(nodes);
        }
        
        console.log(`✅ Created ${nodes.length} nodes with permanent hashes`);
        return nodes;
    }
    
    /**
     * Start background uploads using real hashes
     */
    startBackgroundUploads(fileInfos) {
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
        
        // Schedule sync after a brief delay to allow uploads to complete
        setTimeout(() => {
            if (window.app?.stateSyncManager) {
                console.log(`🔄 Syncing ${nodes.length} nodes to server state`);
                window.app.stateSyncManager.syncNodesToServer(nodes);
            }
        }, 2000);
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