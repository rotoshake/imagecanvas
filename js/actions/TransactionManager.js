/**
 * TransactionManager - Provides atomic operation execution with rollback capabilities
 * Ensures complex multi-step operations either complete fully or are rolled back entirely
 */
class TransactionManager {
    constructor(app) {
        this.app = app;
        this.activeTransactions = new Map();
        this.transactionHistory = [];
        this.maxHistorySize = 100;
        
        // Transaction states
        this.STATES = {
            PENDING: 'pending',
            EXECUTING: 'executing', 
            COMMITTED: 'committed',
            ROLLED_BACK: 'rolled_back',
            FAILED: 'failed'
        };
        
        console.log('💾 TransactionManager initialized');
    }
    
    /**
     * Execute a transaction with rollback support
     */
    async executeTransaction(operations, options = {}) {
        const transactionId = this.generateTransactionId();
        const transaction = this.createTransaction(transactionId, operations, options);
        
        console.log(`🔄 Starting transaction: ${transactionId}`, { operationCount: operations.length });
        
        try {
            // Change state to executing
            this.updateTransactionState(transaction, this.STATES.EXECUTING);
            
            // Capture initial state for potential rollback
            const checkpoint = await this.createCheckpoint();
            transaction.checkpoint = checkpoint;
            
            // Execute all operations in sequence
            const results = [];
            const undoStack = [];
            
            for (let i = 0; i < operations.length; i++) {
                const operation = operations[i];
                
                try {
                    console.log(`  📝 Executing operation ${i + 1}/${operations.length}: ${operation.type}`);
                    
                    const result = await this.executeOperation(operation, {
                        transactionId,
                        operationIndex: i,
                        isTransactional: true
                    });
                    
                    results.push(result);
                    if (result.undo) {
                        undoStack.push(result.undo);
                    }
                    
                } catch (operationError) {
                    console.error(`❌ Operation ${i + 1} failed in transaction ${transactionId}:`, operationError);
                    
                    // Rollback all previous operations in reverse order
                    await this.rollbackOperations(undoStack.reverse(), transactionId);
                    
                    this.updateTransactionState(transaction, this.STATES.FAILED, operationError.message);
                    throw new TransactionError(`Transaction failed at operation ${i + 1}: ${operationError.message}`, {
                        transactionId,
                        failedOperationIndex: i,
                        originalError: operationError
                    });
                }
            }
            
            // All operations succeeded - commit the transaction
            await this.commitTransaction(transaction, results);
            
            console.log(`✅ Transaction completed successfully: ${transactionId}`);
            return {
                transactionId,
                results,
                operationsExecuted: operations.length
            };
            
        } catch (error) {
            // Final error handling - restore from checkpoint if rollback failed
            if (transaction.checkpoint && error instanceof TransactionError) {
                try {
                    await this.restoreFromCheckpoint(transaction.checkpoint);
                    console.log(`🔄 Restored from checkpoint for transaction: ${transactionId}`);
                } catch (restoreError) {
                    console.error(`💥 Failed to restore from checkpoint:`, restoreError);
                }
            }
            
            this.updateTransactionState(transaction, this.STATES.FAILED, error.message);
            throw error;
        } finally {
            // Cleanup
            this.activeTransactions.delete(transactionId);
        }
    }
    
    /**
     * Execute an operation within transaction context
     */
    async executeOperation(operation, context) {
        // Use the app's operation handler if available
        if (this.app.collaborativeManager?.operationHandler) {
            return await this.app.collaborativeManager.operationHandler.execute(operation, {
                ...context,
                isRemote: false
            });
        }
        
        // Fallback to direct execution
        throw new Error('No operation handler available for transaction execution');
    }
    
    /**
     * Execute with automatic transaction wrapper
     */
    async executeWithTransaction(operationFunc) {
        const transactionId = this.generateTransactionId();
        const transaction = this.createTransaction(transactionId, [], { auto: true });
        
        try {
            this.updateTransactionState(transaction, this.STATES.EXECUTING);
            
            // Create checkpoint
            const checkpoint = await this.createCheckpoint();
            transaction.checkpoint = checkpoint;
            
            // Execute the function
            const result = await operationFunc();
            
            // Commit
            await this.commitTransaction(transaction, [result]);
            
            return result;
            
        } catch (error) {
            // Rollback by restoring checkpoint
            if (transaction.checkpoint) {
                await this.restoreFromCheckpoint(transaction.checkpoint);
            }
            
            this.updateTransactionState(transaction, this.STATES.FAILED, error.message);
            throw error;
        } finally {
            this.activeTransactions.delete(transactionId);
        }
    }
    
    /**
     * Create a new transaction record
     */
    createTransaction(id, operations, options) {
        const transaction = {
            id,
            operations: [...operations],
            options: { ...options },
            state: this.STATES.PENDING,
            startTime: Date.now(),
            checkpoint: null,
            results: [],
            error: null
        };
        
        this.activeTransactions.set(id, transaction);
        return transaction;
    }
    
    /**
     * Update transaction state
     */
    updateTransactionState(transaction, newState, error = null) {
        transaction.state = newState;
        transaction.lastUpdated = Date.now();
        
        if (error) {
            transaction.error = error;
        }
        
        if (newState === this.STATES.COMMITTED || newState === this.STATES.FAILED) {
            transaction.endTime = Date.now();
            transaction.duration = transaction.endTime - transaction.startTime;
            
            // Add to history
            this.addToHistory(transaction);
        }
    }
    
    /**
     * Commit a transaction
     */
    async commitTransaction(transaction, results) {
        transaction.results = results;
        this.updateTransactionState(transaction, this.STATES.COMMITTED);
        
        // Cleanup checkpoint data to save memory
        if (transaction.checkpoint) {
            delete transaction.checkpoint;
        }
    }
    
    /**
     * Rollback operations using undo data
     */
    async rollbackOperations(undoStack, transactionId) {
        console.log(`🔄 Rolling back ${undoStack.length} operations for transaction: ${transactionId}`);
        
        for (let i = 0; i < undoStack.length; i++) {
            const undoData = undoStack[i];
            
            try {
                await this.executeUndoOperation(undoData);
                console.log(`  ↩️ Rolled back operation ${i + 1}/${undoStack.length}`);
            } catch (undoError) {
                console.error(`❌ Failed to rollback operation ${i + 1}:`, undoError);
                // Continue with remaining rollbacks
            }
        }
    }
    
    /**
     * Execute an undo operation
     */
    async executeUndoOperation(undoData) {
        if (!undoData || !undoData.type) {
            return;
        }
        
        // Convert undo data back to executable operation
        const undoOperation = this.createUndoOperation(undoData);
        
        // Execute the undo operation
        if (this.app.collaborativeManager?.operationHandler) {
            await this.app.collaborativeManager.operationHandler.execute(undoOperation, {
                isRemote: false,
                isUndo: true
            });
        }
    }
    
    /**
     * Create executable undo operation from undo data
     */
    createUndoOperation(undoData) {
        switch (undoData.type) {
            case 'node_move':
                return {
                    type: 'node_move',
                    data: undoData.operations.length > 1 ? {
                        nodeIds: undoData.operations.map(op => op.nodeId),
                        positions: undoData.operations.map(op => op.oldPos)
                    } : {
                        nodeId: undoData.operations[0].nodeId,
                        pos: undoData.operations[0].oldPos
                    }
                };
                
            case 'node_resize':
                return {
                    type: 'node_resize',
                    data: undoData.operations.length > 1 ? {
                        nodeIds: undoData.operations.map(op => op.nodeId),
                        sizes: undoData.operations.map(op => op.oldSize)
                    } : {
                        nodeId: undoData.operations[0].nodeId,
                        size: undoData.operations[0].oldSize
                    }
                };
                
            case 'node_create':
                return {
                    type: 'node_delete',
                    data: { nodeIds: undoData.nodeIds }
                };
                
            case 'node_delete':
                return {
                    type: 'node_create',
                    data: { nodes: undoData.nodes }
                };
                
            case 'node_property_update':
                return {
                    type: 'node_property_update',
                    data: {
                        nodeId: undoData.nodeId,
                        properties: undoData.oldProperties
                    }
                };
                
            case 'node_rotate':
                return {
                    type: 'node_rotate',
                    data: undoData.operations.length > 1 ? {
                        nodeIds: undoData.operations.map(op => op.nodeId),
                        rotations: undoData.operations.map(op => op.oldRotation),
                        positions: undoData.operations.map(op => op.oldPos)
                    } : {
                        nodeId: undoData.operations[0].nodeId,
                        rotation: undoData.operations[0].oldRotation,
                        pos: undoData.operations[0].oldPos
                    }
                };
                
            default:
                console.warn(`Unknown undo operation type: ${undoData.type}`);
                return null;
        }
    }
    
    /**
     * Create a checkpoint of current state
     */
    async createCheckpoint() {
        try {
            const canvas = this.app.graphCanvas;
            const graph = canvas?.graph;
            
            if (!graph) {
                return null;
            }
            
            // Capture current state
            const checkpoint = {
                timestamp: Date.now(),
                nodes: graph.nodes.map(node => ({
                    id: node.id,
                    type: node.type,
                    pos: [...node.pos],
                    size: [...node.size],
                    properties: { ...node.properties }
                })),
                nodeCount: graph.nodes.length
            };
            
            return checkpoint;
            
        } catch (error) {
            console.error('Failed to create checkpoint:', error);
            return null;
        }
    }
    
    /**
     * Restore state from checkpoint
     */
    async restoreFromCheckpoint(checkpoint) {
        if (!checkpoint) {
            throw new Error('No checkpoint available for restore');
        }
        
        console.log(`🔄 Restoring from checkpoint: ${checkpoint.timestamp}`);
        
        try {
            const canvas = this.app.graphCanvas;
            const graph = canvas?.graph;
            
            if (!graph) {
                throw new Error('No graph available for restore');
            }
            
            // Clear current graph
            graph.clear();
            
            // Restore nodes
            for (const nodeData of checkpoint.nodes) {
                const node = NodeFactory.createNode(nodeData.type);
                if (node) {
                    node.id = nodeData.id;
                    node.pos = [...nodeData.pos];
                    node.size = [...nodeData.size];
                    node.properties = { ...nodeData.properties };
                    graph.add(node);
                }
            }
            
            // Force redraw
            if (canvas) {
                canvas.dirty_canvas = true;
            }
            
            console.log(`✅ Restored ${checkpoint.nodeCount} nodes from checkpoint`);
            
        } catch (error) {
            console.error('Failed to restore from checkpoint:', error);
            throw error;
        }
    }
    
    /**
     * Add transaction to history
     */
    addToHistory(transaction) {
        // Remove sensitive data
        const historyEntry = {
            id: transaction.id,
            operationCount: transaction.operations.length,
            state: transaction.state,
            startTime: transaction.startTime,
            endTime: transaction.endTime,
            duration: transaction.duration,
            error: transaction.error
        };
        
        this.transactionHistory.push(historyEntry);
        
        // Keep history size bounded
        if (this.transactionHistory.length > this.maxHistorySize) {
            this.transactionHistory.shift();
        }
    }
    
    /**
     * Get transaction statistics
     */
    getStatistics() {
        const stats = {
            activeTransactions: this.activeTransactions.size,
            totalTransactions: this.transactionHistory.length,
            successfulTransactions: this.transactionHistory.filter(t => t.state === this.STATES.COMMITTED).length,
            failedTransactions: this.transactionHistory.filter(t => t.state === this.STATES.FAILED).length,
            averageDuration: 0
        };
        
        const completedTransactions = this.transactionHistory.filter(t => t.duration);
        if (completedTransactions.length > 0) {
            stats.averageDuration = completedTransactions.reduce((sum, t) => sum + t.duration, 0) / completedTransactions.length;
        }
        
        return stats;
    }
    
    /**
     * Generate unique transaction ID
     */
    generateTransactionId() {
        return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Get active transactions
     */
    getActiveTransactions() {
        return Array.from(this.activeTransactions.values());
    }
    
    /**
     * Get transaction history
     */
    getHistory() {
        return [...this.transactionHistory];
    }
}

/**
 * TransactionError - Custom error for transaction failures
 */
class TransactionError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'TransactionError';
        this.details = details;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TransactionManager, TransactionError };
}