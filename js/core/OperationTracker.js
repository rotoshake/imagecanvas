/**
 * OperationTracker - Tracks operations sent to server and their corresponding temporary nodes
 * Ensures we can reliably correlate temporary nodes with server responses
 */
class OperationTracker {
    constructor() {
        this.pendingOperations = new Map(); // operationId -> operation details
        this.nodeCorrelations = new Map();  // tempNodeId -> { operationId, expectedServerNodeId }
        this.completedOperations = new Set();
        this.operationTimeout = 30000; // 30 seconds
        
    }
    
    /**
     * Track a new operation with its temporary nodes
     */
    trackOperation(operationId, details) {
        console.log(`📊 Tracking operation ${operationId}:`, details);
        
        this.pendingOperations.set(operationId, {
            id: operationId,
            type: details.type,
            tempNodeIds: details.tempNodeIds || [],
            nodeData: details.nodeData || [],
            timestamp: Date.now(),
            status: 'pending',
            retryCount: 0
        });
        
        // Map each temp node to this operation
        if (details.tempNodeIds) {
            details.tempNodeIds.forEach((tempId, index) => {
                this.nodeCorrelations.set(tempId, {
                    operationId,
                    index,
                    status: 'awaiting_server'
                });
            });
        }
    }
    
    /**
     * Mark operation as sent to server
     */
    markSent(operationId) {
        const op = this.pendingOperations.get(operationId);
        if (op) {
            op.status = 'sent';
            op.sentTimestamp = Date.now();
            console.log(`📤 Operation ${operationId} sent to server`);
        }
    }
    
    /**
     * Mark operation as acknowledged by server with created node IDs
     */
    markAcknowledged(operationId, serverNodes) {
        const op = this.pendingOperations.get(operationId);
        if (!op) {
            console.warn(`⚠️ Unknown operation acknowledged: ${operationId}`);
            return;
        }
        
        op.status = 'acknowledged';
        op.serverNodes = serverNodes;
        op.acknowledgedTimestamp = Date.now();
        
        console.log(`✅ Operation ${operationId} acknowledged with ${serverNodes.length} nodes`);
        
        // Update correlations with server node data
        op.tempNodeIds.forEach((tempId, index) => {
            const correlation = this.nodeCorrelations.get(tempId);
            if (correlation && serverNodes[index]) {
                correlation.serverNodeId = serverNodes[index].id;
                correlation.serverNodeData = serverNodes[index];
                correlation.status = 'server_confirmed';
            }
        });
        
        return op;
    }
    
    /**
     * Get server node data for a temporary node
     */
    getServerNodeForTemp(tempNodeId) {
        const correlation = this.nodeCorrelations.get(tempNodeId);
        if (correlation && correlation.serverNodeData) {
            return correlation.serverNodeData;
        }
        return null;
    }
    
    /**
     * Check if a node is being tracked
     */
    isNodeTracked(nodeId) {
        return this.nodeCorrelations.has(nodeId);
    }
    
    /**
     * Mark temp node as replaced
     */
    markNodeReplaced(tempNodeId) {
        const correlation = this.nodeCorrelations.get(tempNodeId);
        if (correlation) {
            correlation.status = 'replaced';
            correlation.replacedTimestamp = Date.now();
            
            // Check if entire operation is complete
            const op = this.pendingOperations.get(correlation.operationId);
            if (op && this.isOperationComplete(op)) {
                this.markOperationComplete(op.id);
            }
        }
    }
    
    /**
     * Check if all nodes in an operation have been replaced
     */
    isOperationComplete(operation) {
        if (operation.status !== 'acknowledged') return false;
        
        for (const tempId of operation.tempNodeIds) {
            const correlation = this.nodeCorrelations.get(tempId);
            if (!correlation || correlation.status !== 'replaced') {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * Mark operation as complete and clean up
     */
    markOperationComplete(operationId) {
        const op = this.pendingOperations.get(operationId);
        if (op) {
            op.status = 'completed';
            op.completedTimestamp = Date.now();
            this.completedOperations.add(operationId);
            
            console.log(`🎉 Operation ${operationId} completed in ${op.completedTimestamp - op.timestamp}ms`);
            
            // Clean up correlations after a delay
            setTimeout(() => {
                op.tempNodeIds.forEach(tempId => {
                    this.nodeCorrelations.delete(tempId);
                });
                this.pendingOperations.delete(operationId);
            }, 5000);
        }
    }
    
    /**
     * Get all pending operations that have timed out
     */
    getTimedOutOperations() {
        const now = Date.now();
        const timedOut = [];
        
        for (const [id, op] of this.pendingOperations) {
            if (op.status === 'sent' && now - op.sentTimestamp > this.operationTimeout) {
                timedOut.push(op);
            } else if (op.status === 'pending' && now - op.timestamp > this.operationTimeout * 2) {
                timedOut.push(op);
            }
        }
        
        return timedOut;
    }
    
    /**
     * Clean up completed operations
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;
        
        // Remove completed operations older than 30 seconds
        for (const [id, op] of this.pendingOperations) {
            if (op.status === 'completed' && now - op.completedTimestamp > 30000) {
                this.pendingOperations.delete(id);
                this.completedOperations.delete(id);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            console.log(`🧹 Cleaned up ${cleaned} completed operations`);
        }
        
        // Check for timed out operations
        const timedOut = this.getTimedOutOperations();
        if (timedOut.length > 0) {
            console.warn(`⏱️ ${timedOut.length} operations timed out:`, timedOut.map(op => op.id));
            
            // Emit timeout event for each
            timedOut.forEach(op => {
                if (window.app) {
                    window.app.notifications?.show({
                        type: 'error',
                        message: `Operation timed out - some nodes may not have synced`,
                        timeout: 5000
                    });
                }
                
                // Mark as failed
                op.status = 'timeout';
                
                // Clean up correlations
                op.tempNodeIds.forEach(tempId => {
                    const correlation = this.nodeCorrelations.get(tempId);
                    if (correlation) {
                        correlation.status = 'timeout';
                    }
                });
            });
        }
    }
    
    /**
     * Get statistics
     */
    getStats() {
        const stats = {
            pending: 0,
            sent: 0,
            acknowledged: 0,
            completed: 0,
            timeout: 0,
            totalTrackedNodes: this.nodeCorrelations.size
        };
        
        for (const [id, op] of this.pendingOperations) {
            stats[op.status] = (stats[op.status] || 0) + 1;
        }
        
        return stats;
    }
    
    /**
     * Debug: Get all unresolved temp nodes
     */
    getUnresolvedNodes() {
        const unresolved = [];
        
        for (const [tempId, correlation] of this.nodeCorrelations) {
            if (correlation.status !== 'replaced' && correlation.status !== 'timeout') {
                unresolved.push({
                    tempId,
                    operationId: correlation.operationId,
                    status: correlation.status,
                    age: Date.now() - (this.pendingOperations.get(correlation.operationId)?.timestamp || 0)
                });
            }
        }
        
        return unresolved;
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.OperationTracker = OperationTracker;
}