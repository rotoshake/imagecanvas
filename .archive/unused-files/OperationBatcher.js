// js/actions/OperationBatcher.js

class OperationBatcher {
    constructor(collaborativeManager) {
        this.collaborativeManager = collaborativeManager;
        
        // Batching configuration
        this.batchTimeout = 50; // 50ms batch window
        this.maxBatchSize = 20; // Maximum operations per batch
        this.maxBatchDelay = 200; // Maximum delay before forcing send
        
        // Batch storage
        this.pendingOperations = [];
        this.batchTimer = null;
        this.lastBatchTime = 0;
        
        // Operation types that should be batched
        this.BATCHABLE_OPERATIONS = new Set([
            'node_move',
            'node_resize', 
            'node_rotate',
            'node_property_update'
        ]);
        
        // Operation types that should be sent immediately
        this.IMMEDIATE_OPERATIONS = new Set([
            'node_create',
            'node_delete',
            'state_sync',
            'layer_order_change'
        ]);
        
        // Statistics for monitoring
        this.stats = {
            totalOperations: 0,
            batchedOperations: 0,
            immediateOperations: 0,
            batchesSent: 0,
            networkCallsReduced: 0
        };

    }
    
    /**
     * Add an operation to the batch or send immediately
     */
    addOperation(operationType, operationData) {
        this.stats.totalOperations++;
        
        // Check if operation should be sent immediately
        if (this.IMMEDIATE_OPERATIONS.has(operationType)) {
            this.sendImmediate(operationType, operationData);
            return;
        }
        
        // Check if operation should be batched
        if (this.BATCHABLE_OPERATIONS.has(operationType)) {
            this.addToBatch(operationType, operationData);
            return;
        }
        
        // Default: send immediately for unknown operations
        this.sendImmediate(operationType, operationData);
    }
    
    /**
     * Add operation to pending batch
     */
    addToBatch(operationType, operationData) {
        const operation = {
            type: operationType,
            data: operationData,
            timestamp: Date.now(),
            sequence: ++this.collaborativeManager.sequenceNumber
        };
        
        // Try to merge with existing operations of same type
        const merged = this.tryMergeOperation(operation);
        if (!merged) {
            this.pendingOperations.push(operation);
        }
        
        this.stats.batchedOperations++;
        
        // Check if we should send the batch immediately
        const now = Date.now();
        const timeSinceLastBatch = now - this.lastBatchTime;
        
        if (this.pendingOperations.length >= this.maxBatchSize || 
            timeSinceLastBatch >= this.maxBatchDelay) {
            this.sendBatch();
        } else {
            this.scheduleBatchSend();
        }
    }
    
    /**
     * Try to merge operation with existing operations of the same type
     */
    tryMergeOperation(newOperation) {
        const { type, data } = newOperation;
        
        // Find existing operation of same type targeting same node(s)
        for (let i = this.pendingOperations.length - 1; i >= 0; i--) {
            const existing = this.pendingOperations[i];
            
            if (existing.type === type && this.canMergeOperations(existing, newOperation)) {
                // Merge the operations
                this.pendingOperations[i] = this.mergeOperations(existing, newOperation);
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Check if two operations can be merged
     */
    canMergeOperations(op1, op2) {
        if (op1.type !== op2.type) return false;
        
        switch (op1.type) {
            case 'node_move':
                return this.sameNodeTargets(op1.data, op2.data);
            case 'node_resize':
                return this.sameNodeTargets(op1.data, op2.data);
            case 'node_rotate':
                return this.sameNodeTargets(op1.data, op2.data);
            case 'node_property_update':
                return op1.data.nodeId === op2.data.nodeId && 
                       op1.data.property === op2.data.property;
            default:
                return false;
        }
    }
    
    /**
     * Check if operations target the same node(s)
     */
    sameNodeTargets(data1, data2) {
        // Single node operations
        if (data1.nodeId && data2.nodeId) {
            return data1.nodeId === data2.nodeId;
        }
        
        // Multi-node operations
        if (data1.nodeIds && data2.nodeIds) {
            if (data1.nodeIds.length !== data2.nodeIds.length) return false;
            return data1.nodeIds.every(id => data2.nodeIds.includes(id));
        }
        
        return false;
    }
    
    /**
     * Merge two operations of the same type
     */
    mergeOperations(op1, op2) {
        const merged = {
            ...op2, // Use newer operation as base
            timestamp: op2.timestamp,
            sequence: op2.sequence
        };
        
        switch (op1.type) {
            case 'node_move':
            case 'node_resize':
            case 'node_rotate':
                // For transform operations, just use the latest values
                // The newer operation data overwrites the older one
                break;
                
            case 'node_property_update':
                // For property updates, use the latest value
                break;
        }
        
        return merged;
    }
    
    /**
     * Send operation immediately without batching
     */
    sendImmediate(operationType, operationData) {
        this.stats.immediateOperations++;
        
        if (!this.collaborativeManager.socket || !this.collaborativeManager.isConnected) {
            // Queue for when connection is restored
            this.collaborativeManager.connectionState?.queueOperation(() => {
                this.sendImmediate(operationType, operationData);
            });
            return;
        }
        
        const operation = {
            type: operationType,
            data: operationData,
            timestamp: Date.now(),
            sequence: ++this.collaborativeManager.sequenceNumber
        };
        
        this.collaborativeManager.socket.emit('canvas_operation', {
            projectId: this.collaborativeManager.currentProject.id,
            operation: operation
        });
    }
    
    /**
     * Schedule batch send with debouncing
     */
    scheduleBatchSend() {
        // Clear existing timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
        }
        
        // Schedule new batch send
        this.batchTimer = setTimeout(() => {
            this.sendBatch();
        }, this.batchTimeout);
    }
    
    /**
     * Send the current batch of operations
     */
    sendBatch() {
        if (this.pendingOperations.length === 0) return;
        
        if (!this.collaborativeManager.socket || !this.collaborativeManager.isConnected) {
            // Queue entire batch for when connection is restored
            const batchToQueue = [...this.pendingOperations];
            this.collaborativeManager.connectionState?.queueOperation(() => {
                this.sendOperationBatch(batchToQueue);
            });
            this.pendingOperations = [];
            return;
        }
        
        this.sendOperationBatch(this.pendingOperations);
        
        // Update statistics
        this.stats.batchesSent++;
        this.stats.networkCallsReduced += Math.max(0, this.pendingOperations.length - 1);
        
        // Clear batch
        this.pendingOperations = [];
        this.lastBatchTime = Date.now();
        
        // Clear timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
    }
    
    /**
     * Send a batch of operations to the server
     */
    sendOperationBatch(operations) {
        if (operations.length === 0) return;
        
        if (operations.length === 1) {
            // Single operation - send normally
            const op = operations[0];
            this.collaborativeManager.socket.emit('canvas_operation', {
                projectId: this.collaborativeManager.currentProject.id,
                operation: op
            });
        } else {
            // Multiple operations - send as batch
            this.collaborativeManager.socket.emit('canvas_operation_batch', {
                projectId: this.collaborativeManager.currentProject.id,
                operations: operations,
                batchId: this.generateBatchId(),
                timestamp: Date.now()
            });
        }
    }
    
    /**
     * Force send any pending operations immediately
     */
    flush() {
        if (this.pendingOperations.length > 0) {
            this.sendBatch();
        }
    }
    
    /**
     * Generate unique batch ID
     */
    generateBatchId() {
        return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Get batching statistics
     */
    getStats() {
        const reductionPercentage = this.stats.totalOperations > 0 ? 
            Math.round((this.stats.networkCallsReduced / this.stats.totalOperations) * 100) : 0;
            
        return {
            ...this.stats,
            reductionPercentage,
            averageBatchSize: this.stats.batchesSent > 0 ? 
                Math.round(this.stats.batchedOperations / this.stats.batchesSent) : 0
        };
    }
    
    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalOperations: 0,
            batchedOperations: 0,
            immediateOperations: 0,
            batchesSent: 0,
            networkCallsReduced: 0
        };
    }
    
    /**
     * Update configuration
     */
    configure(options) {
        if (options.batchTimeout !== undefined) {
            this.batchTimeout = Math.max(10, Math.min(1000, options.batchTimeout));
        }
        if (options.maxBatchSize !== undefined) {
            this.maxBatchSize = Math.max(1, Math.min(100, options.maxBatchSize));
        }
        if (options.maxBatchDelay !== undefined) {
            this.maxBatchDelay = Math.max(50, Math.min(5000, options.maxBatchDelay));
        }

    }
    
    /**
     * Cleanup resources
     */
    cleanup() {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        
        // Send any remaining operations
        this.flush();

    }
}

// Make it globally available
window.OperationBatcher = OperationBatcher;