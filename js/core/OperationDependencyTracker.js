/**
 * OperationDependencyTracker - Manages operation dependencies to prevent race conditions
 * 
 * Ensures operations that depend on each other execute in the correct order
 */
class OperationDependencyTracker {
    constructor() {
        // Map of nodeId -> pending operations on that node
        this.nodeOperations = new Map();
        
        // Map of operationId -> operation info
        this.operations = new Map();
        
        // Operation queue for each node
        this.nodeQueues = new Map();
    }
    
    /**
     * Register an operation that will modify specific nodes
     */
    registerOperation(operationId, nodeIds, operation) {
        // Store operation info
        this.operations.set(operationId, {
            id: operationId,
            nodeIds: new Set(nodeIds),
            operation: operation,
            status: 'pending',
            timestamp: Date.now()
        });
        
        // Track which nodes this operation affects
        for (const nodeId of nodeIds) {
            if (!this.nodeOperations.has(nodeId)) {
                this.nodeOperations.set(nodeId, new Set());
            }
            this.nodeOperations.get(nodeId).add(operationId);
            
            // Initialize queue for this node if needed
            if (!this.nodeQueues.has(nodeId)) {
                this.nodeQueues.set(nodeId, []);
            }
            this.nodeQueues.get(nodeId).push(operationId);
        }
    }
    
    /**
     * Check if an operation can execute (no pending operations on same nodes)
     */
    canExecute(operationId) {
        const op = this.operations.get(operationId);
        if (!op) return true; // Unknown operation, allow it
        
        // Check if any nodes have earlier pending operations
        for (const nodeId of op.nodeIds) {
            const queue = this.nodeQueues.get(nodeId) || [];
            const position = queue.indexOf(operationId);
            
            // If there are earlier operations in queue, can't execute yet
            if (position > 0) {
                // Check if earlier operations are still pending
                for (let i = 0; i < position; i++) {
                    const earlierOp = this.operations.get(queue[i]);
                    if (earlierOp && earlierOp.status === 'pending') {
                        return false;
                    }
                }
            }
        }
        
        return true;
    }
    
    /**
     * Wait for dependencies to clear before executing
     */
    async waitForDependencies(operationId, timeout = 5000) {
        const startTime = Date.now();
        
        while (!this.canExecute(operationId)) {
            if (Date.now() - startTime > timeout) {
                throw new Error(`Operation ${operationId} timed out waiting for dependencies`);
            }
            
            // Wait a bit before checking again
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }
    
    /**
     * Mark operation as executing
     */
    markExecuting(operationId) {
        const op = this.operations.get(operationId);
        if (op) {
            op.status = 'executing';
        }
    }
    
    /**
     * Mark operation as completed and clean up
     */
    markCompleted(operationId) {
        const op = this.operations.get(operationId);
        if (!op) return;
        
        op.status = 'completed';
        
        // Remove from node tracking
        for (const nodeId of op.nodeIds) {
            const nodeOps = this.nodeOperations.get(nodeId);
            if (nodeOps) {
                nodeOps.delete(operationId);
                if (nodeOps.size === 0) {
                    this.nodeOperations.delete(nodeId);
                }
            }
            
            // Remove from queue
            const queue = this.nodeQueues.get(nodeId);
            if (queue) {
                const index = queue.indexOf(operationId);
                if (index >= 0) {
                    queue.splice(index, 1);
                }
                if (queue.length === 0) {
                    this.nodeQueues.delete(nodeId);
                }
            }
        }
        
        // Clean up old completed operations (keep last 100)
        if (this.operations.size > 100) {
            const sorted = Array.from(this.operations.entries())
                .filter(([_, op]) => op.status === 'completed')
                .sort((a, b) => a[1].timestamp - b[1].timestamp);
            
            // Remove oldest completed operations
            const toRemove = sorted.slice(0, sorted.length - 50);
            for (const [id] of toRemove) {
                this.operations.delete(id);
            }
        }
    }
    
    /**
     * Mark operation as failed
     */
    markFailed(operationId) {
        const op = this.operations.get(operationId);
        if (op) {
            op.status = 'failed';
            // Clean up same as completed
            this.markCompleted(operationId);
        }
    }
    
    /**
     * Get pending operations for a node
     */
    getPendingOperations(nodeId) {
        const ops = this.nodeOperations.get(nodeId);
        if (!ops) return [];
        
        return Array.from(ops)
            .map(id => this.operations.get(id))
            .filter(op => op && op.status === 'pending')
            .sort((a, b) => a.timestamp - b.timestamp);
    }
    
    /**
     * Clear all tracking (for cleanup)
     */
    clear() {
        this.nodeOperations.clear();
        this.operations.clear();
        this.nodeQueues.clear();
    }
    
    /**
     * Get statistics
     */
    getStats() {
        const stats = {
            totalOperations: this.operations.size,
            pendingOperations: 0,
            executingOperations: 0,
            completedOperations: 0,
            failedOperations: 0,
            nodesWithPendingOps: this.nodeOperations.size
        };
        
        for (const op of this.operations.values()) {
            switch (op.status) {
                case 'pending': stats.pendingOperations++; break;
                case 'executing': stats.executingOperations++; break;
                case 'completed': stats.completedOperations++; break;
                case 'failed': stats.failedOperations++; break;
            }
        }
        
        return stats;
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.OperationDependencyTracker = OperationDependencyTracker;
}