/**
 * Node-related commands
 */

class MoveNodeCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_move', params, origin);
    }
    
    validate() {
        const { nodeId, nodeIds, position, positions } = this.params;
        
        // Single node move
        if (nodeId) {
            if (!position || !Array.isArray(position) || position.length !== 2) {
                return { valid: false, error: 'Invalid position for single node' };
            }
            return { valid: true };
        }
        
        // Multi-node move
        if (nodeIds && Array.isArray(nodeIds)) {
            if (!positions || !Array.isArray(positions) || positions.length !== nodeIds.length) {
                return { valid: false, error: 'Invalid positions for multi-node move' };
            }
            return { valid: true };
        }
        
        return { valid: false, error: 'Missing nodeId or nodeIds' };
    }
    
    async prepareUndoData(context) {
        const { graph } = context;

        if (this.initialState) {
            this.undoData = {
                previousPositions: {}
            };
            this.params.nodeIds.forEach((nodeId, index) => {
                this.undoData.previousPositions[nodeId] = this.initialState.positions[index];
            });
            this.undoData.nodes = this.params.nodeIds.map((nodeId, index) => ({
                id: nodeId,
                oldPosition: this.initialState.positions[index]
            }));
            return;
        }

        this.undoData = { 
            previousPositions: {},
            nodes: [] // Keep for backward compatibility
        };
        
        // Single node move
        if (this.params.nodeId) {
            const node = graph.getNodeById(this.params.nodeId);
            if (node) {
                // Use initial position if provided (from drag operation)
                const position = this.params.initialPosition || [...node.pos];
                this.undoData.previousPositions[node.id] = position;
                // Also keep old format for compatibility
                this.undoData.nodes.push({
                    id: node.id,
                    oldPosition: position
                });
            }
        }
        
        // Multi-node move
        else if (this.params.nodeIds) {
            this.params.nodeIds.forEach(nodeId => {
                const node = graph.getNodeById(nodeId);
                if (node) {
                    // Use initial position if provided (from drag operation)
                    let position = [...node.pos];
                    if (this.params.initialPositions && this.params.initialPositions[nodeId]) {
                        position = this.params.initialPositions[nodeId];
                    }
                    
                    this.undoData.previousPositions[node.id] = position;
                    // Also keep old format for compatibility
                    this.undoData.nodes.push({
                        id: node.id,
                        oldPosition: position
                    });
                }
            });
        }
        
        // Undo data prepared for move command
    }
    
    async execute(context) {
        const { graph } = context;
        const movedNodes = [];
        
        // Single node move
        if (this.params.nodeId) {
            const node = graph.getNodeById(this.params.nodeId);
            if (!node) throw new Error('Node not found');
            
            node.pos[0] = this.params.position[0];
            node.pos[1] = this.params.position[1];
            
            // Preserve media properties if provided (for collaborative sync)
            if (this.params.properties && (node.type === 'media/image' || node.type === 'media/video')) {
                Object.assign(node.properties, this.params.properties);
                
                // Ensure video nodes have proper default properties if missing
                if (node.type === 'media/video') {
                    if (node.properties.loop === undefined) {
                        node.properties.loop = true;
                    }
                    if (node.properties.muted === undefined) {
                        node.properties.muted = true;
                    }
                    if (node.properties.autoplay === undefined) {
                        node.properties.autoplay = true;
                    }
                    if (node.properties.paused === undefined) {
                        node.properties.paused = false;
                    }
                }
                
                // Reload media if lost
                if (node.type === 'media/image' && !node.img && (node.properties.src || node.properties.serverUrl)) {
                    node.setImage(node.properties.serverUrl || node.properties.src, node.properties.filename, node.properties.hash);
                } else if (node.type === 'media/video' && !node.video && (node.properties.src || node.properties.serverUrl)) {
                    node.setVideo(node.properties.serverUrl || node.properties.src, node.properties.filename, node.properties.hash);
                }
            }
            
            movedNodes.push(node);
        }
        
        // Multi-node move
        else if (this.params.nodeIds) {
            const missingNodes = [];
            
            this.params.nodeIds.forEach((nodeId, index) => {
                const node = graph.getNodeById(nodeId);
                if (!node) {
                    missingNodes.push(nodeId);
                    return;
                }
                
                node.pos[0] = this.params.positions[index][0];
                node.pos[1] = this.params.positions[index][1];
                
                // Preserve media properties if provided
                if (this.params.nodeProperties && this.params.nodeProperties[nodeId]) {
                    const props = this.params.nodeProperties[nodeId];
                    Object.assign(node.properties, props);
                    
                    // Reload media if lost
                    if (node.type === 'media/image' && !node.img && (node.properties.src || node.properties.serverUrl)) {
                        node.setImage(node.properties.serverUrl || node.properties.src, node.properties.filename, node.properties.hash);
                    } else if (node.type === 'media/video' && !node.video && (node.properties.src || node.properties.serverUrl)) {
                        node.setVideo(node.properties.serverUrl || node.properties.src, node.properties.filename, node.properties.hash);
                    }
                }
                
                movedNodes.push(node);
            });
            
            // Report missing nodes if any
            if (missingNodes.length > 0) {
                console.warn(`⚠️ Move operation: ${missingNodes.length} nodes not found: ${missingNodes.join(', ')}`);
                // Don't throw error - partial success is better than total failure
                // The server will handle the discrepancy
            }
        }
        
        this.executed = true;
        return { nodes: movedNodes };
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        
        this.undoData.nodes.forEach(({ id, oldPosition }) => {
            const node = graph.getNodeById(id);
            if (node) {
                node.pos[0] = oldPosition[0];
                node.pos[1] = oldPosition[1];
            }
        });
        
        return { success: true };
    }
    
    canMergeWith(other) {
        // Can merge consecutive move commands for the same node(s)
        if (other.type !== 'node_move') return false;
        if (this.origin !== other.origin) return false;
        
        // Check if it's the same node(s)
        if (this.params.nodeId && other.params.nodeId) {
            return this.params.nodeId === other.params.nodeId;
        }
        if (this.params.nodeIds && other.params.nodeIds) {
            return JSON.stringify(this.params.nodeIds) === JSON.stringify(other.params.nodeIds);
        }
        
        return false;
    }
    
    mergeWith(other) {
        // Keep the original command but update position to the latest
        const merged = new MoveNodeCommand(this.params, this.origin);
        merged.id = this.id;
        merged.timestamp = this.timestamp;
        
        if (other.params.position) {
            merged.params.position = other.params.position;
        }
        if (other.params.positions) {
            merged.params.positions = other.params.positions;
        }
        
        return merged;
    }
}

class CreateNodeCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_create', params, origin);
    }
    
    validate() {
        const { type, pos, properties } = this.params;
        
        if (!type) {
            return { valid: false, error: 'Missing node type' };
        }
        
        if (!pos || !Array.isArray(pos) || pos.length !== 2) {
            return { valid: false, error: 'Invalid position' };
        }
        
        return { valid: true };
    }
    
    async prepareUndoData(context) {
        // For node creation, we need to know the node ID that will be created
        // We can't predict it perfectly, but we can prepare the structure
        if (this.params.id) {
            // If ID is provided, use it
            this.undoData = { nodeId: this.params.id };
        } else {
            // Generate a temporary ID that matches the pattern used by the command factory
            // This should match what will be generated on the server
            this.undoData = { nodeId: 'temp_' + Date.now() };
        }
        // 
    }
    
    async execute(context) {
        const { graph } = context;
        
        // Create node using factory
        const node = NodeFactory.createNode(this.params.type);
        if (!node) {
            throw new Error(`Unknown node type: ${this.params.type}`);
        }
        
        // Set properties
        node.pos = [...this.params.pos];
        if (this.params.size) {
            node.size = [...this.params.size];
        }
        
        // Preserve or generate ID
        if (this.params.id) {
            node.id = this.params.id;
        }
        
        // Apply additional properties
        if (this.params.properties) {
            Object.assign(node.properties, this.params.properties);
        }
        
        // Apply additional node attributes for duplication support
        if (this.params.title !== undefined) {
            node.title = this.params.title;
        }
        
        if (this.params.rotation !== undefined) {
            node.rotation = this.params.rotation;
        }
        
        if (this.params.aspectRatio !== undefined) {
            node.aspectRatio = this.params.aspectRatio;
        }
        
        if (this.params.flags) {
            // Only override specific flags that are explicitly provided
            // This preserves constructor defaults (like hide_title: true)
            for (const [key, value] of Object.entries(this.params.flags)) {
                if (value !== undefined) {
                    node.flags[key] = value;
                }
            }
        }
        
        // Handle media nodes
        if (node.type === 'media/image') {
            // Loading state is already set in ImageNode constructor
            // Just ensure progress is at 0
            node.loadingProgress = 0;
            
            // Check if we have a local data URL that needs uploading
            const needsUpload = this.params.properties?.src?.startsWith('data:') && 
                               !this.params.properties?.serverUrl;
            
            if (this.params.properties && this.params.properties.serverUrl) {
                // Image already uploaded, use server URL
                // Construct full URL if it's a relative path
                const url = this.params.properties.serverUrl.startsWith('http') 
                    ? this.params.properties.serverUrl 
                    : CONFIG.SERVER.API_BASE + this.params.properties.serverUrl;
                    
                node.setImage(
                    url,
                    this.params.properties.filename,
                    this.params.properties.hash
                );
                
                // Don't mark as loaded - let the image node handle loading state
                // This ensures loading ring shows while image loads
            } else if (this.params.imageData) {
                // Legacy: embedded image data (should be avoided)
                
                node.setImage(
                    this.params.imageData.src,
                    this.params.imageData.filename,
                    this.params.imageData.hash
                );
            } else if (this.params.properties?.src) {
                // New: local data URL that will be uploaded later
                // This should only happen as a fallback
                
                node.setImage(
                    this.params.properties.src,
                    this.params.properties.filename,
                    this.params.properties.hash
                );
            }
            
            // Add to graph BEFORE upload so user sees it immediately
            graph.add(node);
            
            // Force immediate canvas redraw to show loading state
            if (graph.canvas) {
                if (graph.canvas.forceRedraw) {
                    graph.canvas.forceRedraw();
                } else {
                    graph.canvas.dirty_canvas = true;
                    graph.canvas.draw();
                }
            }
            
            // Store for undo - this is the actual node that will persist
            this.undoData = { nodeId: node.id };
            this.executed = true;
            
            // Handle background upload if needed
            if (needsUpload && window.imageUploadManager) {
                // 
                // Pre-populate cache with local data URL so duplicates can use it immediately
                if (window.app?.imageResourceCache && this.params.properties.hash) {
                    
                    window.app.imageResourceCache.set(this.params.properties.hash, {
                        url: this.params.properties.src, // Local data URL
                        serverFilename: null, // Will be updated when upload completes
                        originalFilename: this.params.properties.filename,
                        thumbnail: node.thumbnail,
                        isLocal: true // Mark as local so we know to update later
                    });
                }
                
                // Start background upload
                
                const uploadPromise = window.imageUploadManager.uploadImage(
                    this.params.properties.src,
                    this.params.properties.filename,
                    this.params.properties.hash
                );

                // Update node when upload completes
                uploadPromise.then(async (uploadResult) => {
                    
                    // Check if node still exists (might have been deleted during upload)
                    // Use window.app.graph instead of context.graph as context might not be available in promise
                    const currentNode = window.app?.graph?.getNodeById(node.id);
                    if (!currentNode) {
                        
                        return;
                    }
                    
                    // Update the node's properties with server URL
                    currentNode.properties.serverUrl = uploadResult.url;
                    currentNode.properties.serverFilename = uploadResult.serverFilename;
                    
                    // Update the image source to use server URL
                    const fullUrl = CONFIG.SERVER.API_BASE + uploadResult.url;
                    if (currentNode.img) {
                        currentNode.img.src = fullUrl;
                    }
                    
                    // Force aggressive redraw to show updated image
                    const canvas = window.app?.graphCanvas || window.app?.graph?.canvas;
                    if (canvas) {
                        canvas.dirty_canvas = true;
                        canvas.dirty_bgcanvas = true;
                        // Use requestAnimationFrame to ensure redraw happens
                        requestAnimationFrame(() => {
                            canvas.draw();
                        });
                    }
                    
                    // Store upload result for future syncs
                    currentNode._uploadResult = uploadResult;
                    
                    // Send image_upload_complete operation to sync serverUrl across all clients
                    if (window.app?.operationPipeline && currentNode.properties.hash) {
                        console.log(`📤 Sending image_upload_complete for hash ${currentNode.properties.hash.substring(0, 8)}...`);
                        
                        try {
                            const completeResult = await window.app.operationPipeline.execute('image_upload_complete', {
                                hash: currentNode.properties.hash,
                                serverUrl: uploadResult.url,
                                serverFilename: uploadResult.serverFilename || uploadResult.filename
                            });
                            
                        } catch (error) {
                            console.error('❌ Failed to notify server of upload completion:', error);
                            console.error('Error details:', error.stack);
                        }
                    } else {
                        
                    }
                    
                    // Debug cache state
                    
                    // Upgrade cache with server URL (replacing any local data URL)
                    if (window.app?.imageResourceCache && node.properties.hash) {
                        const wasLocal = window.app.imageResourceCache.get(node.properties.hash)?.isLocal;
                        window.app.imageResourceCache.set(node.properties.hash, {
                            url: fullUrl,
                            serverFilename: uploadResult.serverFilename || uploadResult.filename,
                            originalFilename: node.properties.filename,
                            thumbnail: node.thumbnail,
                            isLocal: false // Now upgraded to server URL
                        });
                        
                        if (wasLocal) {
                            console.log(`🔄 Upgraded cache from local to server URL: ${node.properties.hash.substring(0, 8)}...`);
                        } else {
                            console.log(`💾 Added image to cache: ${node.properties.hash.substring(0, 8)}...`);
                        }
                        
                        // Also populate any existing nodes with the same hash that don't have server URLs
                        // This handles cases where duplicates were created before upload completed
                        const allNodes = window.app?.graph?.nodes || [];
                        let updatedNodes = 0;
                        allNodes.forEach(existingNode => {
                            if (existingNode.type === 'media/image' && 
                                existingNode.properties.hash === node.properties.hash &&
                                existingNode.id !== node.id &&
                                !existingNode.properties.serverUrl) {

                                existingNode.properties.serverUrl = fullUrl;
                                existingNode.properties.serverFilename = uploadResult.serverFilename;
                                
                                // Update image source if the node has an img element
                                if (existingNode.img) {
                                    existingNode.img.src = fullUrl;
                                }
                                updatedNodes++;
                            }
                        });
                        
                        if (updatedNodes > 0) {
                            
                        }
                    } else {
                        
                    }
                }).catch(error => {
                    console.error('❌ Failed to upload image:', error);
                    console.error('Upload error details:', {
                        nodeId: node.id,
                        hash: this.params.properties.hash,
                        errorMessage: error.message,
                        errorStack: error.stack
                    });
                    // Node remains with local data URL
                });

            } else {
                console.log('🔍 No upload needed:', {
                    needsUpload,
                    hasImageUploadManager: !!window.imageUploadManager,
                    hasSrc: !!this.params.properties?.src,
                    srcStartsWithData: this.params.properties?.src?.startsWith('data:'),
                    hasServerUrl: !!this.params.properties?.serverUrl
                });
            }
        } else if (node.type === 'media/video' && (this.params.properties?.serverUrl || this.params.properties?.src)) {
            // Video creation matching the image pattern
            if (this.params.properties && this.params.properties.serverUrl) {
                // Video already uploaded, use server URL
                // Construct full URL if it's a relative path
                const url = this.params.properties.serverUrl.startsWith('http') 
                    ? this.params.properties.serverUrl 
                    : CONFIG.SERVER.API_BASE + this.params.properties.serverUrl;
                    
                node.setVideo(
                    url,
                    this.params.properties.filename,
                    this.params.properties.hash
                );
                
                // Mark as loading (will complete when video loads)
                node.loadingState = 'loading';
                node.loadingProgress = 50;
            } else if (this.params.properties?.src) {
                // Fallback: local data URL 
                
                node.setVideo(
                    this.params.properties.src,
                    this.params.properties.filename,
                    this.params.properties.hash
                );
            }
            
            // Add to graph AFTER setVideo to ensure properties are set
            graph.add(node);
            
            // Force immediate canvas redraw to show loading state
            if (graph.canvas) {
                graph.canvas.dirty_canvas = true;
                requestAnimationFrame(() => graph.canvas.draw());
            }
            
            // Store for undo
            this.undoData = { nodeId: node.id };
            this.executed = true;
        } else {
            // Non-media nodes
            // Add to graph
            graph.add(node);
            
            // Store for undo
            this.undoData = { nodeId: node.id };
            this.executed = true;
        }
        
        return { node };
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData || !this.undoData.nodeId) {
            throw new Error('No undo data available');
        }
        
        const node = graph.getNodeById(this.undoData.nodeId);
        if (node) {
            graph.remove(node);
        }
        
        return { success: true };
    }
}

class DeleteNodeCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_delete', params, origin);
    }
    
    validate() {
        const { nodeIds } = this.params;
        
        if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
            return { valid: false, error: 'Missing or invalid nodeIds' };
        }
        
        return { valid: true };
    }
    
    async prepareUndoData(context) {
        const { graph } = context;
        this.undoData = { deletedNodes: [] };
        
        this.params.nodeIds.forEach(nodeId => {
            const node = graph.getNodeById(nodeId);
            if (node) {
                // Store complete node data for restoration
                const nodeData = {
                    id: node.id,
                    type: node.type,
                    pos: [...node.pos],
                    size: [...node.size],
                    properties: { ...node.properties },
                    rotation: node.rotation,
                    flags: { ...node.flags },
                    title: node.title
                };
                
                // Optimize media node data same as in execute method
                if ((node.type === 'media/image' || node.type === 'media/video') && 
                    nodeData.properties.src && 
                    nodeData.properties.src.startsWith('data:')) {
                    
                    const originalSize = JSON.stringify(nodeData.properties).length;
                    
                    // Case 1: We have a serverUrl - use it
                    if (nodeData.properties.serverUrl) {
                        nodeData.properties = {
                            serverUrl: nodeData.properties.serverUrl,
                            hash: nodeData.properties.hash,
                            filename: nodeData.properties.filename,
                            _hadDataUrl: true
                        };
                        const optimizedSize = JSON.stringify(nodeData.properties).length;
                        console.log(`🗜️ Optimized deletion undo data for ${node.id}: ${(originalSize/1024/1024).toFixed(2)}MB → ${(optimizedSize/1024).toFixed(2)}KB (using serverUrl)`);
                    } 
                    // Case 2: No serverUrl but we have a hash - check cache
                    else if (nodeData.properties.hash && window.app?.imageResourceCache?.has(nodeData.properties.hash)) {
                        const cached = window.app.imageResourceCache.get(nodeData.properties.hash);
                        nodeData.properties = {
                            hash: nodeData.properties.hash,
                            filename: nodeData.properties.filename || cached.filename,
                            _hadDataUrl: true,
                            _fromCache: true
                        };
                        // If cache has serverUrl, include it
                        if (cached.serverUrl) {
                            nodeData.properties.serverUrl = cached.serverUrl;
                        }
                        const optimizedSize = JSON.stringify(nodeData.properties).length;
                        console.log(`🗜️ Optimized deletion undo data for ${node.id}: ${(originalSize/1024/1024).toFixed(2)}MB → ${(optimizedSize/1024).toFixed(2)}KB (using cache)`);
                    }
                    // Case 3: Large data URL with no optimization available - strip it anyway
                    else if (originalSize > 100 * 1024) { // > 100KB
                        console.warn(`⚠️ Large unoptimized image in deletion: ${(originalSize/1024/1024).toFixed(2)}MB. Stripping data URL to prevent disconnection.`);
                        nodeData.properties = {
                            hash: nodeData.properties.hash,
                            filename: nodeData.properties.filename,
                            _hadDataUrl: true,
                            _stripped: true,
                            _originalSize: originalSize
                        };
                    }
                }
                
                this.undoData.deletedNodes.push(nodeData);
            }
        });

    }
    
    async execute(context) {
        const { graph, canvas } = context;
        
        // Store nodes for undo
        this.undoData = { deletedNodes: [] };

        this.params.nodeIds.forEach(nodeId => {
            const node = graph.getNodeById(nodeId);
            if (node) {
                // Store complete node data for restoration
                const nodeData = {
                    id: node.id,
                    type: node.type,
                    pos: [...node.pos],
                    size: [...node.size],
                    properties: { ...node.properties },
                    rotation: node.rotation,
                    flags: { ...node.flags },
                    title: node.title
                };
                
                // Debug logging
                // if (node.type === 'media/image' || node.type === 'media/video') {
                //     console.log(`🖼️ Deleting ${node.type} node ${node.id}:`, {
                //         hasServerUrl: !!nodeData.properties.serverUrl,
                //         hasSrc: !!nodeData.properties.src,
                //         srcIsDataUrl: nodeData.properties.src?.startsWith('data:'),
                //         srcLength: nodeData.properties.src?.length || 0,
                //         hash: nodeData.properties.hash?.substring(0, 8)
                //     });
                // }
                
                // Optimize media node data for network transmission
                if ((node.type === 'media/image' || node.type === 'media/video') && 
                    nodeData.properties.src && 
                    nodeData.properties.src.startsWith('data:')) {
                    
                    const originalSize = JSON.stringify(nodeData.properties).length;
                    
                    // Case 1: We have a serverUrl - use it
                    if (nodeData.properties.serverUrl) {
                        nodeData.properties = {
                            serverUrl: nodeData.properties.serverUrl,
                            hash: nodeData.properties.hash,
                            filename: nodeData.properties.filename,
                            _hadDataUrl: true
                        };
                        const optimizedSize = JSON.stringify(nodeData.properties).length;
                        console.log(`🗜️ Optimized deletion undo data for ${node.id}: ${(originalSize/1024/1024).toFixed(2)}MB → ${(optimizedSize/1024).toFixed(2)}KB (using serverUrl)`);
                    } 
                    // Case 2: No serverUrl but we have a hash - check cache
                    else if (nodeData.properties.hash && window.app?.imageResourceCache?.has(nodeData.properties.hash)) {
                        const cached = window.app.imageResourceCache.get(nodeData.properties.hash);
                        nodeData.properties = {
                            hash: nodeData.properties.hash,
                            filename: nodeData.properties.filename || cached.filename,
                            _hadDataUrl: true,
                            _fromCache: true
                        };
                        // If cache has serverUrl, include it
                        if (cached.serverUrl) {
                            nodeData.properties.serverUrl = cached.serverUrl;
                        }
                        const optimizedSize = JSON.stringify(nodeData.properties).length;
                        console.log(`🗜️ Optimized deletion undo data for ${node.id}: ${(originalSize/1024/1024).toFixed(2)}MB → ${(optimizedSize/1024).toFixed(2)}KB (using cache)`);
                    }
                    // Case 3: Large data URL with no optimization available - strip it anyway
                    else if (originalSize > 100 * 1024) { // > 100KB
                        console.warn(`⚠️ Large unoptimized image in deletion: ${(originalSize/1024/1024).toFixed(2)}MB. Stripping data URL to prevent disconnection.`);
                        nodeData.properties = {
                            hash: nodeData.properties.hash,
                            filename: nodeData.properties.filename,
                            _hadDataUrl: true,
                            _stripped: true,
                            _originalSize: originalSize
                        };
                    }
                }
                
                this.undoData.deletedNodes.push(nodeData);
                
                // Clear from selection if selected
                if (canvas?.selection) {
                    canvas.selection.deselectNode(node);
                }
                
                // Remove from graph
                graph.remove(node);
            }
        });
        
        // Log total undo data size
        const totalUndoSize = JSON.stringify(this.undoData).length;
        console.log(`📊 Total deletion undo data size: ${(totalUndoSize/1024/1024).toFixed(2)}MB for ${this.undoData.deletedNodes.length} nodes`);
        
        this.executed = true;
        return { deletedCount: this.undoData.deletedNodes.length };
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        
        // Restore nodes
        const nodesToRestore = this.undoData.deletedNodes || this.undoData.nodes || [];
        for (const nodeData of nodesToRestore) {
            const node = NodeFactory.createNode(nodeData.type);
            if (node) {
                // Restore all properties
                node.id = nodeData.id;
                node.pos = [...nodeData.pos];
                node.size = [...nodeData.size];
                node.properties = { ...nodeData.properties };
                node.rotation = nodeData.rotation || 0;
                // Merge flags preserving constructor defaults (like hide_title: true)
                if (nodeData.flags) {
                    node.flags = { ...node.flags, ...nodeData.flags };
                }
                node.title = nodeData.title;
                
                // Restore media if needed
                if (node.type === 'media/image') {
                    // Check if we have a cached version first
                    if (nodeData.properties.hash && window.app?.imageResourceCache) {
                        const cached = window.app.imageResourceCache.get(nodeData.properties.hash);
                        if (cached?.dataUrl || cached?.serverUrl) {
                            // Use cached data
                            node.setImage(
                                cached.serverUrl || cached.dataUrl,
                                nodeData.properties.filename || cached.filename,
                                nodeData.properties.hash
                            );
                        } else if (nodeData.properties.serverUrl) {
                            // Use server URL if available
                            node.setImage(
                                nodeData.properties.serverUrl,
                                nodeData.properties.filename,
                                nodeData.properties.hash
                            );
                        }
                    } else if (nodeData.properties.src) {
                        // Fallback to src if available
                        node.setImage(
                            nodeData.properties.src,
                            nodeData.properties.filename,
                            nodeData.properties.hash
                        );
                    } else if (nodeData.properties.serverUrl) {
                        // Last resort - use serverUrl
                        node.setImage(
                            nodeData.properties.serverUrl,
                            nodeData.properties.filename,
                            nodeData.properties.hash
                        );
                    }
                } else if (node.type === 'media/video' && (nodeData.properties.src || nodeData.properties.serverUrl)) {
                    await node.setVideo(
                        nodeData.properties.serverUrl || nodeData.properties.src,
                        nodeData.properties.filename,
                        nodeData.properties.hash
                    );
                }
                
                graph.add(node);
            }
        }
        
        return { success: true };
    }
}

class UpdateNodePropertyCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_property_update', params, origin);
    }
    
    validate() {
        const { nodeId, property, value } = this.params;
        
        if (!nodeId) {
            return { valid: false, error: 'Missing nodeId' };
        }
        
        if (!property) {
            return { valid: false, error: 'Missing property name' };
        }
        
        // value can be anything including null/undefined
        
        return { valid: true };
    }
    
    async prepareUndoData(context) {
        const { graph } = context;

        if (this.initialState) {
            this.undoData = {
                previousProperties: {}
            };
            this.params.nodeIds.forEach((nodeId, index) => {
                const isDirectProperty = ['title'].includes(this.params.property);
                const oldValue = isDirectProperty ? this.initialState.nodes[index][this.params.property] : this.initialState.nodes[index].properties[this.params.property];
                this.undoData.previousProperties[nodeId] = {
                    [this.params.property]: oldValue
                };
            });
            return;
        }

        const node = graph.getNodeById(this.params.nodeId);
        
        if (node) {
            // Store old value for undo
            const isDirectProperty = ['title'].includes(this.params.property);
            const oldValue = isDirectProperty ? node[this.params.property] : node.properties[this.params.property];
            
            // Debug logging for title property
            if (this.params.property === 'title') {
                
            }
            
            // Use server format for undo data
            this.undoData = {
                previousProperties: {}
            };
            
            // For direct properties like 'title', we still need to store them
            // The server will handle both direct and nested properties
            this.undoData.previousProperties[node.id] = {
                [this.params.property]: oldValue
            };

        } else {
            
        }
    }
    
    async execute(context) {
        const { graph } = context;

        for (const nodeId of this.params.nodeIds) {
            const node = graph.getNodeById(nodeId);
            if (!node) continue;

            const isDirectProperty = ['title'].includes(this.params.property);
            if (isDirectProperty) {
                node[this.params.property] = this.params.value;
            } else {
                node.properties[this.params.property] = this.params.value;
            }

            if (node.updateProperty) {
                node.updateProperty(this.params.property, this.params.value);
            }
        }

        this.executed = true;
        return { success: true };
    }
    
    async undo(context) {
        const { graph } = context;
        
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        
        // Restore properties
        if (this.undoData.previousProperties) {
            for (const [nodeId, props] of Object.entries(this.undoData.previousProperties)) {
                const node = graph.getNodeById(nodeId);
                if (node) {
                    for (const [key, value] of Object.entries(props)) {
                        const isDirectProperty = ['title'].includes(key);
                        if (isDirectProperty) {
                            node[key] = value;
                        } else {
                            node.properties[key] = value;
                        }
                        
                        if (node.updateProperty) {
                            node.updateProperty(key, value);
                        }
                    }
                }
            }
        }
        
        return { success: true };
    }
}

// Register commands globally
if (typeof window !== 'undefined') {
    window.NodeCommands = {
        MoveNodeCommand,
        CreateNodeCommand,
        DeleteNodeCommand,
        UpdateNodePropertyCommand
    };
}