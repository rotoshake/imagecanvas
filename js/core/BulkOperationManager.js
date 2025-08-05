/**
 * BulkOperationManager - Handles large-scale operations with chunking, optimization, and progress tracking
 */
class BulkOperationManager {
    constructor() {
        // Dynamic chunk sizes based on operation type
        this.CHUNK_SIZES = {
            'node_paste': 50,     // Larger for creation operations
            'node_duplicate': 50, // Larger for creation operations
            'node_move': 30,      // Medium for updates
            'node_delete': 100,   // Large for deletions (lightweight)
            'default': 20         // Default for other operations
        };
        this.MAX_PAYLOAD_SIZE = 5 * 1024 * 1024; // 5MB max per chunk (increased)
        this.OPERATION_TIMEOUT = 30000; // 30 seconds per chunk (increased for large operations)
        this.MAX_RETRIES = 3; // Maximum retry attempts for failed chunks
        this.RETRY_DELAY = 1000; // Initial retry delay in ms
        this.activeOperations = new Map();
        this.backgroundSync = null; // Will be set if available
    }

    /**
     * Validate items before bulk operation
     * @param {Array} items - Items to validate
     * @param {string} operationType - Type of operation
     * @returns {Array} Valid items only
     */
    validateItems(items, operationType) {
        // Paste operations send full node data, not IDs - don't validate
        if (operationType === 'node_paste') {
            
            return items;
        }
        
        // Duplicate operations with node data also don't need validation
        if (operationType === 'node_duplicate' && items.length > 0 && typeof items[0] === 'object') {
            
            return items;
        }
        
        // Only validate operations that use node IDs
        if ((operationType === 'node_move' || operationType === 'node_duplicate') && 
            items.length > 0 && typeof items[0] === 'number') {
            return items.filter(nodeId => {
                const node = window.app?.graph?.getNodeById(nodeId);
                if (!node) {
                    
                    return false;
                }
                // For move operations, skip temporary nodes
                if (operationType === 'node_move' && (node._isTemporary || node._localId || node._syncFailed)) {
                    
                    return false;
                }
                return true;
            });
        }
        
        return items;
    }
    
    /**
     * Execute a bulk operation with automatic chunking
     * @param {string} operationType - Type of operation (duplicate, paste, etc.)
     * @param {Array} items - Items to process
     * @param {Object} params - Additional parameters
     * @param {Function} prepareItem - Function to prepare each item for sending
     * @returns {Promise<Object>} Combined results from all chunks
     */
    async executeBulkOperation(operationType, items, params, prepareItem) {
        const operationId = this.generateOperationId();
        const operation = {
            id: operationId,
            type: operationType,
            totalItems: items.length,
            processedItems: 0,
            chunks: [],
            results: [],
            errors: [],
            startTime: Date.now()
        };
        
        this.activeOperations.set(operationId, operation);
        
        try {
            // Validate items first
            const validItems = this.validateItems(items, operationType);
            if (validItems.length === 0) {
                
                return { success: true, result: { nodes: [] } };
            }
            
            if (validItems.length < items.length) {
                
            }
            
            // Prepare items and calculate payload sizes
            const preparedItems = validItems.map(item => {
                const prepared = prepareItem ? prepareItem(item) : item;
                const size = this.estimatePayloadSize(prepared);
                return { data: prepared, size };
            });
            
            // Create optimized chunks
            const chunks = this.createOptimizedChunks(preparedItems, operationType);
            operation.chunks = chunks;

            // Show initial progress notification
            let progressNotification = null;
            if (chunks.length > 1 || items.length > 10) {
                progressNotification = window.app?.notifications?.show({
                    type: 'info',
                    message: `Processing ${items.length} items...`,
                    timeout: 0
                });
            }
            
            // Use BulkCommand to execute all chunks as a single undoable operation
            let bulkResult;
            
            if (typeof BulkCommand !== 'undefined' && chunks.length > 1) {
                // Use BulkCommand for multi-chunk operations
                
                try {
                    // Create and execute bulk command
                    const bulkCommand = new BulkCommand(operationType, chunks, params);
                    bulkResult = await window.app.operationPipeline.executeCommand(bulkCommand);
                    
                    // Update progress notification
                    if (progressNotification) {
                        window.app?.notifications?.update(progressNotification, {
                            message: `Completed processing ${items.length} items`
                        });
                    }
                    
                    operation.processedItems = items.length;
                    
                } catch (error) {
                    console.error('❌ Bulk command failed:', error);
                    throw error;
                }
                
            } else {
                // Fallback to individual chunk processing for single chunks or if BulkCommand not available
                // console.log(`📦 Processing ${chunks.length} chunk(s) individually`);
                
                const chunkResults = [];
                let processedCount = 0;
                
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    
                    // Update progress
                    if (progressNotification) {
                        window.app?.notifications?.update(progressNotification, {
                            message: `Processing items ${processedCount + 1}-${processedCount + chunk.items.length} of ${items.length}...`
                        });
                    }
                    
                    try {
                        // Use intelligent retry with chunk splitting
                        const chunkResult = await this.executeChunkWithRetry(
                            chunk,
                            operationType,
                            params,
                            i,
                            chunks.length
                        );
                        
                        chunkResults.push(chunkResult);
                        processedCount += chunk.items.length;
                        operation.processedItems = processedCount;
                        
                    } catch (error) {
                        console.error(`❌ Chunk ${i + 1} failed completely:`, error);
                        operation.errors.push({
                            chunk: i,
                            error: error.message,
                            items: chunk.items.length
                        });
                        
                        // Push a failed result so we track these nodes
                        chunkResults.push({
                            success: false,
                            error: error.message,
                            result: {
                                nodes: [],
                                errors: chunk.items.map((item, idx) => ({
                                    item: idx,
                                    error: error.message,
                                    data: item
                                }))
                            },
                            items: chunk.items
                        });
                        
                        // Continue processing other chunks
                        processedCount += chunk.items.length;
                        operation.processedItems = processedCount;
                    }
                    
                    // Small delay between chunks to prevent overwhelming the server
                    if (i < chunks.length - 1) {
                        await this.delay(100);
                    }
                }
                
                // Convert chunk results to bulk result format
                bulkResult = this.combineChunkResults(chunkResults, operationType);
                // console.log(`📦 Combined bulk result:`, bulkResult);
            }
            
            // Clear progress notification
            if (progressNotification) {
                window.app?.notifications?.dismiss(progressNotification);
            }
            
            // Use bulk result or combine chunk results
            const combinedResult = bulkResult || { success: true, result: { nodes: [], errors: [] } };
            
            // Show completion notification
            const successfulNodes = combinedResult.result.nodes ? combinedResult.result.nodes.length : 0;
            const failedNodes = combinedResult.result.errors ? combinedResult.result.errors.length : 0;
            
            if (operation.errors.length > 0 || failedNodes > 0) {
                const message = failedNodes > 0 
                    ? `Pasted ${successfulNodes} of ${items.length} nodes. ${failedNodes} nodes failed.`
                    : `Completed with errors: ${successfulNodes} of ${items.length} nodes pasted`;
                    
                window.app?.notifications?.show({
                    type: 'warning',
                    message: message,
                    timeout: 5000
                });
                
                // Log details about failed nodes for debugging
                if (failedNodes > 0) {

                }
            } else if (items.length > 10) {
                window.app?.notifications?.show({
                    type: 'success',
                    message: `Successfully pasted ${successfulNodes} nodes`,
                    timeout: 3000
                });
            }
            
            return combinedResult;
            
        } finally {
            this.activeOperations.delete(operationId);
        }
    }

    /**
     * Execute chunk with intelligent retry and splitting
     */
    async executeChunkWithRetry(chunk, operationType, options, chunkIndex, totalChunks, retryCount = 0) {
        try {
            
            const result = await window.app.operationPipeline.execute(operationType, {
                ...options,
                nodeData: operationType === 'node_paste' ? chunk.items : undefined,
                nodeIds: operationType === 'node_duplicate' ? chunk.items : undefined
            });
            
            // console.log(`📦 Chunk execution result:`, result);
            
            return {
                success: true,
                result: result,
                items: chunk.items
            };
            
        } catch (error) {
            console.warn(`⚠️ Chunk ${chunkIndex + 1} failed (attempt ${retryCount + 1}):`, error);
            
            if (retryCount < this.MAX_RETRIES) {
                // For large chunks that fail, try splitting them
                if (chunk.items.length > 10) {
                    
                    const midpoint = Math.floor(chunk.items.length / 2);
                    const chunk1 = { items: chunk.items.slice(0, midpoint), size: chunk.size / 2 };
                    const chunk2 = { items: chunk.items.slice(midpoint), size: chunk.size / 2 };
                    
                    // Recursively retry with smaller chunks
                    const [result1, result2] = await Promise.all([
                        this.executeChunkWithRetry(chunk1, operationType, options, chunkIndex, totalChunks, retryCount + 1),
                        this.executeChunkWithRetry(chunk2, operationType, options, chunkIndex, totalChunks, retryCount + 1)
                    ]);
                    
                    // Combine results
                    return {
                        success: result1.success && result2.success,
                        result: {
                            nodes: [...(result1.result?.nodes || []), ...(result2.result?.nodes || [])],
                            errors: [...(result1.result?.errors || []), ...(result2.result?.errors || [])]
                        },
                        items: chunk.items
                    };
                }
                
                // Small chunk - retry with exponential backoff
                const delay = this.RETRY_DELAY * Math.pow(2, retryCount);
                
                await this.delay(delay);
                return this.executeChunkWithRetry(chunk, operationType, options, chunkIndex, totalChunks, retryCount + 1);
            }
            
            // Max retries exceeded
            throw error;
        }
    }
    
    /**
     * Create optimized chunks based on item count and payload size
     */
    createOptimizedChunks(preparedItems, operationType) {
        const chunks = [];
        let currentChunk = { items: [], size: 0 };
        
        // Get chunk size for this operation type
        const chunkSize = this.CHUNK_SIZES[operationType] || this.CHUNK_SIZES.default;
        
        for (const item of preparedItems) {
            // Check if adding this item would exceed limits
            if (currentChunk.items.length >= chunkSize ||
                (currentChunk.size + item.size > this.MAX_PAYLOAD_SIZE && currentChunk.items.length > 0)) {
                // Start a new chunk
                chunks.push(currentChunk);
                currentChunk = { items: [], size: 0 };
            }
            
            currentChunk.items.push(item.data);
            currentChunk.size += item.size;
        }
        
        // Add the last chunk
        if (currentChunk.items.length > 0) {
            chunks.push(currentChunk);
        }
        
        return chunks;
    }

    /**
     * Process a single chunk
     */
    async processChunk(operationType, chunk, params, operation) {
        const chunkParams = { ...params };
        
        // Adjust parameters based on operation type
        switch (operationType) {
            case 'node_duplicate':
                // Check if we're dealing with nodeIds or nodeData
                if (params.nodeIds && params.nodeIds.length > 0) {
                    chunkParams.nodeIds = chunk.items;
                } else if (params.nodeData || (Array.isArray(chunk.items[0]) === false && chunk.items[0].type)) {
                    // If items are node data objects (have type property)
                    chunkParams.nodeData = chunk.items;
                    chunkParams.nodeIds = []; // Ensure nodeIds is empty
                } else {
                    // Default to nodeIds
                    chunkParams.nodeIds = chunk.items;
                }
                break;
                
            case 'node_paste':
                chunkParams.nodeData = chunk.items;
                break;
                
            case 'node_delete':
                chunkParams.nodeIds = chunk.items;
                break;
                
            default:
                throw new Error(`Unknown operation type: ${operationType}`);
        }
        
        // Use background sync if available for better reliability
        if (this.backgroundSync && chunk.items.length > 5) {
            // For duplicate operations with nodeData, we've already created local nodes
            // So we don't want optimistic updates
            const useOptimistic = operationType !== 'node_duplicate' || !chunkParams.nodeData;
            
            return this.backgroundSync.queueOperation({
                type: operationType,
                params: chunkParams
            }, {
                priority: 'high',
                optimistic: useOptimistic
            });
        }
        
        // Otherwise use direct execution with timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Operation timeout')), this.OPERATION_TIMEOUT);
        });
        
        const operationPromise = window.app.operationPipeline.execute(operationType, chunkParams);
        
        return Promise.race([operationPromise, timeoutPromise]);
    }

    /**
     * Combine results from multiple chunks
     */
    combineChunkResults(chunkResults, operationType) {
        // console.log(`📦 combineChunkResults called with ${chunkResults.length} chunks`);
        const combined = {
            success: true,
            result: {
                nodes: [],
                errors: []
            }
        };
        
        for (const chunkResult of chunkResults) {
            // console.log(`📦 Processing chunk result:`, chunkResult);
            if (chunkResult && chunkResult.result) {
                // The chunkResult.result is the command result which has { success: true, result: { nodes: [...] } }
                const commandResult = chunkResult.result;
                if (commandResult.result && commandResult.result.nodes) {
                    // console.log(`📦 Found nodes in command result:`, commandResult.result.nodes.length);
                    combined.result.nodes.push(...commandResult.result.nodes);
                } else if (commandResult.nodes) {
                    // Fallback for commands that return nodes directly
                    // console.log(`📦 Found nodes directly:`, commandResult.nodes.length);
                    combined.result.nodes.push(...commandResult.nodes);
                }
                if (commandResult.result && commandResult.result.errors) {
                    combined.result.errors.push(...commandResult.result.errors);
                } else if (commandResult.errors) {
                    combined.result.errors.push(...commandResult.errors);
                }
            }
        }
        
        // console.log(`📦 Combined result has ${combined.result.nodes.length} nodes`);
        return combined;
    }

    /**
     * Estimate payload size for an item
     */
    estimatePayloadSize(item) {
        // Rough estimation of JSON stringified size
        const str = JSON.stringify(item);
        return str.length * 2; // UTF-16 characters
    }

    /**
     * Determine if operation should abort on error
     */
    shouldAbortOnError(error) {
        // Abort on critical errors
        return error.message.includes('unauthorized') ||
               error.message.includes('forbidden') ||
               error.message.includes('server error');
    }

    /**
     * Optimize node data for transmission
     */
    optimizeNodeData(node) {
        const optimized = {
            type: node.type,
            pos: [...node.pos],
            size: [...node.size],
            properties: {},
            flags: { ...node.flags },
            title: node.title,
            rotation: node.rotation || 0,
            aspectRatio: node.aspectRatio
        };
        
        // Preserve copy/paste metadata
        if (node._copiedChildIndices) {
            optimized._copiedChildIndices = node._copiedChildIndices;
        }
        
        // Optimize based on node type
        if (node.type === 'media/image' && node.properties.hash) {
            // For images with server URLs, send minimal data
            if (node.properties.serverUrl) {
                optimized.properties = {
                    hash: node.properties.hash,
                    filename: node.properties.filename,
                    serverUrl: node.properties.serverUrl,
                    serverFilename: node.properties.serverFilename
                };
            } else {
                // Need to send full image data
                optimized.properties = { ...node.properties };
            }
        } else if (node.type === 'media/video' && node.properties.hash) {
            // Similar optimization for videos
            if (node.properties.serverUrl) {
                optimized.properties = {
                    hash: node.properties.hash,
                    filename: node.properties.filename,
                    serverUrl: node.properties.serverUrl,
                    serverFilename: node.properties.serverFilename
                };
            } else {
                optimized.properties = { ...node.properties };
            }
        } else {
            // For other node types, include all properties
            optimized.properties = { ...node.properties };
        }
        
        return optimized;
    }

    /**
     * Generate unique operation ID
     */
    generateOperationId() {
        return `bulk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get active operation status
     */
    getOperationStatus(operationId) {
        return this.activeOperations.get(operationId);
    }
    
    /**
     * Verify bulk operation completed successfully
     */
    async verifyBulkOperation(operationId, originalItems) {
        if (!window.app?.graph) return;
        
        // Find any orphaned temporary nodes
        const orphanedNodes = [];
        const now = Date.now();
        
        for (const node of window.app.graph.nodes) {
            if (node._isTemporary) {
                const age = now - (node._temporaryCreatedAt || now);
                if (age > 5000) { // Only check nodes older than 5 seconds
                    orphanedNodes.push(node);
                }
            }
        }
        
        if (orphanedNodes.length > 0) {
            
            // Log details for debugging
            
            orphanedNodes.forEach(node => {
                console.log(`  - Node ${node.id} at [${Math.round(node.pos[0])}, ${Math.round(node.pos[1])}], type: ${node.type}, age: ${Math.round((now - (node._temporaryCreatedAt || now))/1000)}s`);
            });
            
            // Check how many nodes we expected vs what we have
            const totalNodes = window.app.graph.nodes.length;
            const tempNodes = window.app.graph.nodes.filter(n => n._isTemporary).length;

            // Notify user
            window.app?.notifications?.show({
                type: 'warning',
                message: `${orphanedNodes.length} nodes may not have synced properly. Try refreshing the page.`,
                timeout: 10000
            });
        } else {
            
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BulkOperationManager;
}

// Make BulkOperationManager available globally
if (typeof window !== 'undefined') {
    window.BulkOperationManager = BulkOperationManager;
}