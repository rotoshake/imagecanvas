/**
 * TransactionManager - Automatic transaction detection and bundling
 * 
 * Detects operations that should be bundled together into atomic transactions:
 * 1. Multi-selection operations (move, resize, rotate multiple nodes)
 * 2. Alignment and distribution commands
 * 3. Batch property updates
 * 4. Complex commands that generate multiple operations
 */
class TransactionManager {
    constructor(undoManager) {
        this.undoManager = undoManager;
        
        // Transaction detection configuration
        this.transactionPatterns = new Map();
        this.setupTransactionPatterns();
        
        // Active transaction tracking
        this.activeTransaction = null;
        this.transactionTimeout = null;
        this.transactionTimeoutDuration = 500; // ms
        
        // Operation tracking for pattern detection
        this.recentOperations = [];
        this.recentOperationWindow = 100; // ms
        
        console.log('📋 TransactionManager initialized');
    }
    
    /**
     * Setup transaction patterns
     */
    setupTransactionPatterns() {
        // Multi-node operations - DISABLED
        // Move operations should be atomic, not wrapped in transactions
        /*
        this.transactionPatterns.set('multi_node', {
            detect: (operation) => {
                return operation.params && (
                    (Array.isArray(operation.params.nodeIds) && operation.params.nodeIds.length > 1) ||
                    (operation.source && operation.source.includes('multi_'))
                );
            },
            timeout: 100,
            source: 'multi_node_operation'
        });
        */
        
        // Alignment operations - DISABLED for now
        // These are already single operations with arrays of nodes
        // They don't need transaction wrapping
        /*
        this.transactionPatterns.set('alignment', {
            detect: (operation) => {
                return operation.source && (
                    operation.source.includes('align_') ||
                    operation.source.includes('distribute_') ||
                    operation.source === 'alignment'
                );
            },
            timeout: 200,
            source: 'alignment_operation'
        });
        */
        
        // Group operations
        this.transactionPatterns.set('group', {
            detect: (operation) => {
                return operation.source && (
                    operation.source.includes('group_') ||
                    operation.source.startsWith('batch_')
                );
            },
            timeout: 300,
            source: 'group_operation'
        });
        
        // Drag operations - DISABLED for now
        // Drag operations should not be auto-bundled into transactions
        // as they are already atomic operations with proper undo data
        /*
        this.transactionPatterns.set('drag', {
            detect: (operation) => {
                return operation.source === 'drag' || 
                       operation.source === 'multi_drag' ||
                       (operation.metadata && operation.metadata.isDragging);
            },
            timeout: 50,
            source: 'drag_operation'
        });
        */
        
        // Resize handle operations
        this.transactionPatterns.set('resize_handle', {
            detect: (operation) => {
                return operation.source === 'resize_handle' ||
                       operation.source === 'corner_resize' ||
                       (operation.type === 'node_resize' && operation.metadata?.continuous);
            },
            timeout: 100,
            source: 'resize_operation'
        });
        
        // Rotation operations
        this.transactionPatterns.set('rotation', {
            detect: (operation) => {
                return operation.source === 'rotation_handle' ||
                       operation.source === 'group_rotation' ||
                       (operation.type === 'node_rotate' && operation.metadata?.continuous);
            },
            timeout: 100,
            source: 'rotation_operation'
        });
        
        // Text editing operations
        this.transactionPatterns.set('text_edit', {
            detect: (operation) => {
                return operation.type === 'node_property_update' &&
                       operation.params?.property === 'content' &&
                       operation.metadata?.isTyping;
            },
            timeout: 1000, // Longer timeout for typing
            source: 'text_editing'
        });
        
        // Import/paste operations
        this.transactionPatterns.set('import', {
            detect: (operation) => {
                return operation.source === 'import' ||
                       operation.source === 'paste' ||
                       operation.source === 'drop';
            },
            timeout: 200,
            source: 'import_operation'
        });
    }
    
    /**
     * Check if an operation should start or continue a transaction
     */
    shouldHandleAsTransaction(operation) {
        // Clean up old operations
        const now = Date.now();
        this.recentOperations = this.recentOperations.filter(
            op => now - op.timestamp < this.recentOperationWindow
        );
        
        // Check each pattern
        for (const [patternName, pattern] of this.transactionPatterns) {
            if (pattern.detect(operation)) {
                return {
                    shouldStart: true,
                    pattern: patternName,
                    timeout: pattern.timeout,
                    source: pattern.source
                };
            }
        }
        
        // Check for rapid operations on same nodes - DISABLED
        // This was causing move operations to be bundled unnecessarily
        /*
        if (this.recentOperations.length > 0) {
            const lastOp = this.recentOperations[this.recentOperations.length - 1];
            const timeDiff = now - lastOp.timestamp;
            
            if (timeDiff < 50 && this.isSameTarget(operation, lastOp.operation)) {
                return {
                    shouldStart: true,
                    pattern: 'rapid_succession',
                    timeout: 100,
                    source: 'rapid_operations'
                };
            }
        }
        */
        
        return { shouldStart: false };
    }
    
    /**
     * Check if two operations target the same nodes
     */
    isSameTarget(op1, op2) {
        const getTargetNodes = (op) => {
            if (op.params?.nodeId) return [op.params.nodeId];
            if (op.params?.nodeIds) return op.params.nodeIds;
            return [];
        };
        
        const targets1 = new Set(getTargetNodes(op1));
        const targets2 = new Set(getTargetNodes(op2));
        
        // Check if there's any overlap
        for (const target of targets1) {
            if (targets2.has(target)) return true;
        }
        
        return false;
    }
    
    /**
     * Process an operation for transaction handling
     */
    processOperation(operation) {
        const decision = this.shouldHandleAsTransaction(operation);
        
        // Track operation
        this.recentOperations.push({
            operation: operation,
            timestamp: Date.now()
        });
        
        if (decision.shouldStart) {
            if (!this.activeTransaction || this.activeTransaction.pattern !== decision.pattern) {
                // Start new transaction
                this.startTransaction(decision.source, decision.pattern);
            }
            
            // Reset timeout
            this.resetTransactionTimeout(decision.timeout);
        } else if (this.activeTransaction) {
            // Check if this operation should be included in active transaction
            const timeSinceStart = Date.now() - this.activeTransaction.startTime;
            if (timeSinceStart < 1000) { // Within 1 second of transaction start
                this.resetTransactionTimeout(this.activeTransaction.timeout);
            } else {
                // End transaction and start fresh
                this.commitTransaction();
            }
        }
        
        // Let undo manager track the operation
        if (this.undoManager) {
            this.undoManager.trackOperation(operation);
        }
    }
    
    /**
     * Start a new transaction
     */
    startTransaction(source, pattern) {
        if (this.activeTransaction) {
            this.commitTransaction();
        }
        
        this.activeTransaction = {
            source: source,
            pattern: pattern,
            startTime: Date.now(),
            timeout: this.transactionPatterns.get(pattern)?.timeout || 200
        };
        
        if (this.undoManager) {
            this.undoManager.beginTransaction(source);
        }
        
        console.log(`📝 Auto-transaction started: ${source} (${pattern})`);
    }
    
    /**
     * Reset transaction timeout
     */
    resetTransactionTimeout(duration) {
        if (this.transactionTimeout) {
            clearTimeout(this.transactionTimeout);
        }
        
        this.transactionTimeout = setTimeout(() => {
            this.commitTransaction();
        }, duration);
    }
    
    /**
     * Commit active transaction
     */
    commitTransaction() {
        if (!this.activeTransaction) return;
        
        if (this.transactionTimeout) {
            clearTimeout(this.transactionTimeout);
            this.transactionTimeout = null;
        }
        
        const duration = Date.now() - this.activeTransaction.startTime;
        console.log(`✅ Auto-transaction committed: ${this.activeTransaction.source} (${duration}ms)`);
        
        if (this.undoManager) {
            this.undoManager.commitTransaction();
        }
        
        this.activeTransaction = null;
    }
    
    /**
     * Abort active transaction
     */
    abortTransaction() {
        if (!this.activeTransaction) return;
        
        if (this.transactionTimeout) {
            clearTimeout(this.transactionTimeout);
            this.transactionTimeout = null;
        }
        
        console.log(`❌ Transaction aborted: ${this.activeTransaction.source}`);
        
        if (this.undoManager) {
            this.undoManager.abortTransaction();
        }
        
        this.activeTransaction = null;
    }
    
    /**
     * Force start a transaction with specific source
     */
    forceStartTransaction(source) {
        this.startTransaction(source, 'manual');
        // Use a longer timeout for manual transactions
        this.resetTransactionTimeout(5000);
    }
    
    /**
     * Check if currently in a transaction
     */
    isInTransaction() {
        return !!this.activeTransaction;
    }
    
    /**
     * Get current transaction info
     */
    getCurrentTransaction() {
        if (!this.activeTransaction) return null;
        
        return {
            source: this.activeTransaction.source,
            pattern: this.activeTransaction.pattern,
            duration: Date.now() - this.activeTransaction.startTime
        };
    }
    
    /**
     * Cleanup
     */
    destroy() {
        if (this.transactionTimeout) {
            clearTimeout(this.transactionTimeout);
        }
        this.commitTransaction();
        this.recentOperations = [];
    }
}