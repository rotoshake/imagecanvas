/**
 * BackgroundSyncManager - Handles background synchronization with intelligent queuing and retry logic
 * 
 * Features:
 * - Local-first operation with immediate UI feedback
 * - Background sync queue with priority handling
 * - Automatic retry with exponential backoff
 * - Connection health monitoring
 * - Adaptive chunk sizing based on network conditions
 * - Operation deduplication
 */
class BackgroundSyncManager {
    constructor(networkLayer, stateSyncManager) {
        this.network = networkLayer;
        this.stateSync = stateSyncManager;
        
        // Queue configuration
        this.operationQueue = [];
        this.processingQueue = false;
        this.maxRetries = 3;
        this.baseRetryDelay = 1000; // 1 second
        
        // Adaptive chunking
        this.minChunkSize = 5;
        this.maxChunkSize = 50;
        this.currentChunkSize = 20;
        this.successRate = 1.0;
        
        // Connection health
        this.connectionHealth = {
            latency: 0,
            successCount: 0,
            failureCount: 0,
            lastSuccessTime: Date.now(),
            isHealthy: true
        };
        
        // Operation tracking
        this.pendingOperations = new Map();
        this.completedOperations = new Set();
        
        // Performance metrics
        this.metrics = {
            queuedOperations: 0,
            processedOperations: 0,
            failedOperations: 0,
            averageProcessTime: 0
        };
        
        this.setupEventHandlers();
        this.startQueueProcessor();
    }
    
    setupEventHandlers() {
        // Monitor connection state
        if (this.network) {
            this.network.on('connected', () => this.onConnectionRestored());
            this.network.on('disconnected', () => this.onConnectionLost());
            this.network.on('error', (error) => this.onNetworkError(error));
        }
        
        // Process queue when connection is restored
        window.addEventListener('online', () => this.onConnectionRestored());
        window.addEventListener('offline', () => this.onConnectionLost());
    }
    
    /**
     * Queue an operation for background sync
     * Returns immediately with optimistic result
     */
    async queueOperation(operation, options = {}) {
        const operationId = this.generateOperationId();
        
        const queueItem = {
            id: operationId,
            operation,
            options: {
                priority: options.priority || 'normal',
                retries: 0,
                createdAt: Date.now(),
                ...options
            },
            status: 'queued',
            localResult: null,
            deferred: this.createDeferred()
        };
        
        // Apply optimistically if enabled
        if (options.optimistic !== false && this.stateSync?.optimisticEnabled) {
            try {
                queueItem.localResult = await this.applyOptimistic(operation);
            } catch (error) {
                console.error('Optimistic update failed:', error);
            }
        }
        
        // Add to queue based on priority
        if (options.priority === 'high') {
            this.operationQueue.unshift(queueItem);
        } else {
            this.operationQueue.push(queueItem);
        }
        
        this.metrics.queuedOperations++;
        
        // Start processing if not already running
        if (!this.processingQueue) {
            this.processQueue();
        }
        
        // Return promise that resolves when operation completes
        return queueItem.deferred.promise;
    }
    
    /**
     * Process queued operations in background
     */
    async processQueue() {
        if (this.processingQueue || this.operationQueue.length === 0) {
            return;
        }
        
        this.processingQueue = true;
        
        while (this.operationQueue.length > 0) {
            // Check connection health
            if (!this.isConnectionHealthy()) {
                
                await this.delay(5000);
                continue;
            }
            
            // Get next batch of operations
            const batch = this.getNextBatch();
            if (batch.length === 0) {
                break;
            }
            
            try {
                await this.processBatch(batch);
                this.updateConnectionHealth(true);
            } catch (error) {
                console.error('Batch processing failed:', error);
                this.updateConnectionHealth(false);
                
                // Requeue failed operations
                batch.forEach(item => {
                    if (item.options.retries < this.maxRetries) {
                        item.options.retries++;
                        item.status = 'queued';
                        this.operationQueue.push(item);
                    } else {
                        item.status = 'failed';
                        item.deferred.reject(error);
                        this.metrics.failedOperations++;
                    }
                });
                
                // Wait before retrying
                const retryDelay = this.calculateRetryDelay(batch[0].options.retries);
                await this.delay(retryDelay);
            }
        }
        
        this.processingQueue = false;
    }
    
    /**
     * Get next batch of operations based on current chunk size
     */
    getNextBatch() {
        const batch = [];
        const chunkSize = this.getAdaptiveChunkSize();
        
        while (batch.length < chunkSize && this.operationQueue.length > 0) {
            const item = this.operationQueue.shift();
            
            // Skip if already completed (deduplication)
            if (this.isOperationCompleted(item.operation)) {
                item.deferred.resolve({ deduplicated: true });
                continue;
            }
            
            batch.push(item);
        }
        
        return batch;
    }
    
    /**
     * Process a batch of operations
     */
    async processBatch(batch) {
        const startTime = Date.now();

        // Group operations by type for efficiency
        const groupedOps = this.groupOperationsByType(batch);
        
        for (const [type, items] of groupedOps) {
            await this.processOperationGroup(type, items);
        }
        
        // Update metrics
        const processTime = Date.now() - startTime;
        this.updateProcessingMetrics(batch.length, processTime);
        
        // Mark operations as completed
        batch.forEach(item => {
            item.status = 'completed';
            this.markOperationCompleted(item.operation);
            item.deferred.resolve(item.localResult);
            this.metrics.processedOperations++;
        });
    }
    
    /**
     * Process a group of operations of the same type
     */
    async processOperationGroup(type, items) {
        switch (type) {
            case 'node_duplicate':
                await this.processDuplicateGroup(items);
                break;
            case 'node_paste':
                await this.processPasteGroup(items);
                break;
            case 'node_move':
                await this.processMoveGroup(items);
                break;
            default:
                // Process individually
                for (const item of items) {
                    await this.network.emit('execute_operation', {
                        operationId: item.id,
                        type: item.operation.type,
                        params: item.operation.params,
                        stateVersion: this.stateSync?.serverStateVersion || 0
                    });
                }
        }
    }
    
    /**
     * Process duplicate operations as a group
     */
    async processDuplicateGroup(items) {
        // Combine all node IDs and data
        const allNodeIds = [];
        const allNodeData = [];
        
        items.forEach(item => {
            const params = item.operation.params;
            if (params.nodeIds) {
                allNodeIds.push(...params.nodeIds);
            }
            if (params.nodeData) {
                allNodeData.push(...params.nodeData);
            }
        });
        
        // Send as single operation
        if (allNodeIds.length > 0 || allNodeData.length > 0) {
            await this.network.emit('execute_operation', {
                operationId: this.generateOperationId(),
                type: 'node_duplicate',
                params: {
                    nodeIds: allNodeIds.length > 0 ? allNodeIds : undefined,
                    nodeData: allNodeData.length > 0 ? allNodeData : undefined,
                    offset: items[0].operation.params.offset || [20, 20]
                },
                stateVersion: this.stateSync?.serverStateVersion || 0
            });
        }
    }
    
    /**
     * Process paste operations as a group
     */
    async processPasteGroup(items) {
        // For paste, we need to maintain separate positions
        // So we can't easily combine them
        for (const item of items) {
            await this.network.emit('execute_operation', {
                operationId: item.id,
                type: item.operation.type,
                params: item.operation.params,
                stateVersion: this.stateSync?.serverStateVersion || 0
            });
        }
    }
    
    /**
     * Process move operations as a group
     */
    async processMoveGroup(items) {
        // Combine all moves into a single batch move
        const nodePositions = new Map();
        
        items.forEach(item => {
            const params = item.operation.params;
            if (params.nodeId) {
                nodePositions.set(params.nodeId, params.position);
            } else if (params.nodeIds && params.positions) {
                params.nodeIds.forEach((id, index) => {
                    nodePositions.set(id, params.positions[index]);
                });
            }
        });
        
        if (nodePositions.size > 0) {
            await this.network.emit('execute_operation', {
                operationId: this.generateOperationId(),
                type: 'node_move',
                params: {
                    nodeIds: Array.from(nodePositions.keys()),
                    positions: Array.from(nodePositions.values())
                },
                stateVersion: this.stateSync?.serverStateVersion || 0
            });
        }
    }
    
    /**
     * Group operations by type for batch processing
     */
    groupOperationsByType(batch) {
        const groups = new Map();
        
        batch.forEach(item => {
            const type = item.operation.type;
            if (!groups.has(type)) {
                groups.set(type, []);
            }
            groups.get(type).push(item);
        });
        
        return groups;
    }
    
    /**
     * Apply operation optimistically
     */
    async applyOptimistic(operation) {
        // Create a proper Command instance
        if (this.stateSync?.applyOptimistic) {
            // Get the appropriate command class
            const CommandClass = this.getCommandClass(operation.type);
            if (!CommandClass) {
                console.error(`No command class found for operation type: ${operation.type}`);
                return null;
            }
            
            // Create command instance
            const command = new CommandClass(operation.params, 'local');
            
            return await this.stateSync.applyOptimistic(command);
        }
        return null;
    }
    
    /**
     * Get command class for operation type
     */
    getCommandClass(operationType) {
        // Map operation types to command classes
        const commandMap = {
            'node_duplicate': window.DuplicateNodesCommand,
            'node_paste': window.PasteNodesCommand,
            'node_move': window.MoveNodeCommand || window.MoveNodesCommand,
            'node_create': window.CreateNodeCommand,
            'node_delete': window.DeleteNodeCommand || window.DeleteNodesCommand
        };
        
        return commandMap[operationType];
    }
    
    /**
     * Check if connection is healthy enough for operations
     */
    isConnectionHealthy() {
        // Check if online
        if (!navigator.onLine) {
            
            return false;
        }
        
        // Check if network layer is connected
        if (this.network && this.network.isConnected === false) {
            
            return false;
        }
        
        // If we have no connection history yet, assume healthy
        const totalAttempts = this.connectionHealth.successCount + this.connectionHealth.failureCount;
        if (totalAttempts === 0) {
            return true; // No history yet, assume healthy
        }
        
        // Check recent failure rate
        if (totalAttempts > 10) {
            const failureRate = this.connectionHealth.failureCount / totalAttempts;
            if (failureRate > 0.5) {
                console.log(`📡 High failure rate: ${(failureRate * 100).toFixed(1)}%`);
                return false;
            }
        }
        
        // Don't check time since last success for initial operations
        if (this.connectionHealth.successCount === 0) {
            return true; // Haven't had any successes yet, but that's ok initially
        }
        
        // Check if last success was too long ago
        const timeSinceLastSuccess = Date.now() - this.connectionHealth.lastSuccessTime;
        if (timeSinceLastSuccess > 60000) { // 1 minute
            console.log(`📡 Last success was ${Math.round(timeSinceLastSuccess / 1000)}s ago`);
            return false;
        }
        
        return true;
    }
    
    /**
     * Get adaptive chunk size based on connection health
     */
    getAdaptiveChunkSize() {
        // Start with current chunk size
        let size = this.currentChunkSize;
        
        // Adjust based on success rate
        if (this.successRate > 0.9) {
            // Increase chunk size
            size = Math.min(size + 5, this.maxChunkSize);
        } else if (this.successRate < 0.5) {
            // Decrease chunk size
            size = Math.max(size - 5, this.minChunkSize);
        }
        
        // Adjust based on latency
        if (this.connectionHealth.latency > 1000) {
            size = Math.max(size - 10, this.minChunkSize);
        }
        
        this.currentChunkSize = size;
        return size;
    }
    
    /**
     * Update connection health metrics
     */
    updateConnectionHealth(success) {
        if (success) {
            this.connectionHealth.successCount++;
            this.connectionHealth.lastSuccessTime = Date.now();
        } else {
            this.connectionHealth.failureCount++;
        }
        
        // Update success rate
        const total = this.connectionHealth.successCount + this.connectionHealth.failureCount;
        this.successRate = total > 0 ? this.connectionHealth.successCount / total : 1.0;
    }
    
    /**
     * Update processing metrics
     */
    updateProcessingMetrics(operationCount, processTime) {
        const avgTime = processTime / operationCount;
        
        // Update rolling average
        if (this.metrics.averageProcessTime === 0) {
            this.metrics.averageProcessTime = avgTime;
        } else {
            this.metrics.averageProcessTime = 
                (this.metrics.averageProcessTime * 0.7) + (avgTime * 0.3);
        }
        
        // Update latency estimate
        this.connectionHealth.latency = this.metrics.averageProcessTime;
    }
    
    /**
     * Check if operation has already been completed (deduplication)
     */
    isOperationCompleted(operation) {
        const hash = this.hashOperation(operation);
        return this.completedOperations.has(hash);
    }
    
    /**
     * Mark operation as completed
     */
    markOperationCompleted(operation) {
        const hash = this.hashOperation(operation);
        this.completedOperations.add(hash);
        
        // Clean up old completed operations
        if (this.completedOperations.size > 1000) {
            const toDelete = this.completedOperations.size - 500;
            const iterator = this.completedOperations.values();
            for (let i = 0; i < toDelete; i++) {
                this.completedOperations.delete(iterator.next().value);
            }
        }
    }
    
    /**
     * Generate hash for operation deduplication
     */
    hashOperation(operation) {
        // Simple hash based on type and key parameters
        const key = `${operation.type}:${JSON.stringify(operation.params.nodeIds || operation.params.nodeId || '')}`;
        return key;
    }
    
    /**
     * Calculate retry delay with exponential backoff
     */
    calculateRetryDelay(retryCount) {
        return Math.min(this.baseRetryDelay * Math.pow(2, retryCount), 30000);
    }
    
    /**
     * Handle connection restored
     */
    onConnectionRestored() {
        
        this.connectionHealth.isHealthy = true;
        
        if (!this.processingQueue && this.operationQueue.length > 0) {
            this.processQueue();
        }
    }
    
    /**
     * Handle connection lost
     */
    onConnectionLost() {
        
        this.connectionHealth.isHealthy = false;
    }
    
    /**
     * Handle network errors
     */
    onNetworkError(error) {
        console.error('Network error:', error);
        this.updateConnectionHealth(false);
    }
    
    /**
     * Create deferred promise
     */
    createDeferred() {
        const deferred = {};
        deferred.promise = new Promise((resolve, reject) => {
            deferred.resolve = resolve;
            deferred.reject = reject;
        });
        return deferred;
    }
    
    /**
     * Start continuous queue processor
     */
    startQueueProcessor() {
        setInterval(() => {
            if (!this.processingQueue && this.operationQueue.length > 0) {
                this.processQueue();
            }
        }, 1000);
    }
    
    /**
     * Generate unique operation ID
     */
    generateOperationId() {
        return `bg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Get queue status
     */
    getQueueStatus() {
        return {
            queueLength: this.operationQueue.length,
            processing: this.processingQueue,
            metrics: this.metrics,
            connectionHealth: this.connectionHealth,
            currentChunkSize: this.currentChunkSize
        };
    }
    
    /**
     * Clear completed operations cache
     */
    clearCompletedCache() {
        this.completedOperations.clear();
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BackgroundSyncManager;
}