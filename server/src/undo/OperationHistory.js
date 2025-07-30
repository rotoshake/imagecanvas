/**
 * OperationHistory - Server-side operation history management
 * 
 * Maintains a complete history of all operations for undo/redo functionality
 * Tracks operations by user and supports transactional bundles
 * Provides conflict detection and resolution for multi-user scenarios
 */
class OperationHistory {
    constructor(db) {
        this.db = db;
        
        // In-memory caches for performance
        this.operations = new Map(); // operationId -> operation record
        this.userOperations = new Map(); // userId -> [operationIds]
        this.transactions = new Map(); // transactionId -> [operationIds]
        this.timeline = new Map(); // projectId -> [ordered operationIds]
        
        // Track undo/redo state per user per project
        this.userUndoState = new Map(); // `${userId}-${projectId}` -> { undoStack, redoStack }
    }
    
    /**
     * Initialize history for a project
     */
    async initializeProject(projectId) {
        if (!this.timeline.has(projectId)) {
            this.timeline.set(projectId, []);
            
            // Load existing operations from database if any
            await this.loadProjectHistory(projectId);
        }
    }
    
    /**
     * Load project history from database
     */
    async loadProjectHistory(projectId) {
        try {
            const operations = await this.db.all(
                `SELECT * FROM operations 
                 WHERE project_id = ? 
                 ORDER BY sequence_number ASC`,
                [projectId]
            );

            const projectTimeline = [];
            
            for (const op of operations) {
                const operation = {
                    id: op.operation_id || `op_${op.id}`, // Use operation_id if available, otherwise prefix with op_
                    type: op.operation_type,
                    params: JSON.parse(op.operation_data),
                    userId: op.user_id,
                    projectId: op.project_id,
                    timestamp: op.applied_at,
                    sequenceNumber: op.sequence_number,
                    state: 'applied',
                    transactionId: op.transaction_id || null,
                    undoData: op.undo_data ? JSON.parse(op.undo_data) : null
                };
                
                this.operations.set(operation.id, operation);
                projectTimeline.push(operation.id);
                
                // Track by user
                const userKey = operation.userId;
                if (!this.userOperations.has(userKey)) {
                    this.userOperations.set(userKey, []);
                }
                this.userOperations.get(userKey).push(operation.id);
                
                // Track transaction
                if (operation.transactionId) {
                    if (!this.transactions.has(operation.transactionId)) {
                        this.transactions.set(operation.transactionId, []);
                    }
                    this.transactions.get(operation.transactionId).push(operation.id);
                }
            }
            
            this.timeline.set(projectId, projectTimeline);
            
        } catch (error) {
            console.error('Error loading project history:', error);
        }
    }
    
    /**
     * Record a new operation
     */
    async recordOperation(operation, userId, projectId, transactionId = null) {
        await this.initializeProject(projectId);
        
        // Generate operation ID if not provided
        const operationId = operation.id || `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Warn if operation is missing undo data for undoable types
        const undoableTypes = ['node_move', 'node_create', 'node_delete', 'node_duplicate', 'node_property_update'];
        if (undoableTypes.includes(operation.type) && !operation.undoData) {
            
        }
        
        // Store operation record
        const record = {
            id: operationId,
            type: operation.type,
            params: operation.params,
            userId: userId,
            projectId: projectId,
            transactionId: transactionId,
            timestamp: Date.now(),
            undoData: operation.undoData || null,
            state: 'applied',
            sequenceNumber: operation.sequenceNumber || null
        };
        
        // Store in memory
        this.operations.set(operationId, record);
        
        // Add to project timeline
        const projectTimeline = this.timeline.get(projectId) || [];
        projectTimeline.push(operationId);
        this.timeline.set(projectId, projectTimeline);
        
        // Track by user
        if (!this.userOperations.has(userId)) {
            this.userOperations.set(userId, []);
        }
        this.userOperations.get(userId).push(operationId);
        
        // Track transaction
        if (transactionId) {
            if (!this.transactions.has(transactionId)) {
                this.transactions.set(transactionId, []);
            }
            this.transactions.get(transactionId).push(operationId);
        }
        
        // Clear user's redo stack on new operation
        const undoStateKey = `${userId}-${projectId}`;
        const undoState = this.userUndoState.get(undoStateKey);
        if (undoState) {
            undoState.redoStack = [];
        }
        
        // Persist to database
        await this.persistOperation(record);
        
        return operationId;
    }
    
    /**
     * Persist operation to database
     */
    async persistOperation(operation) {
        try {
            // Store undo data in a new column
            await this.db.run(
                `INSERT INTO operations 
                 (project_id, user_id, operation_type, operation_data, sequence_number, transaction_id, undo_data, operation_id) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    operation.projectId,
                    operation.userId,
                    operation.type,
                    JSON.stringify(operation.params),
                    operation.sequenceNumber,
                    operation.transactionId,
                    operation.undoData ? JSON.stringify(operation.undoData) : null,
                    operation.id
                ]
            );
        } catch (error) {
            console.error('Error persisting operation:', error);
            throw error;
        }
    }
    
    /**
     * Get undoable operations for a user in a project
     */
    getUndoableOperations(userId, projectId, limit = 1) {
        const projectTimeline = this.timeline.get(projectId) || [];
        const undoable = [];
        const processedTransactions = new Set();

        // Walk backwards through the timeline
        for (let i = projectTimeline.length - 1; i >= 0 && undoable.length < limit; i--) {
            const opId = projectTimeline[i];
            const op = this.operations.get(opId);
            
            // Only consider operations from this user that are applied
            // Use strict equality to prevent type coercion bugs
            if (op && op.userId === userId && op.state === 'applied') {
                console.log(`  ✅ Found undoable operation: ${opId}, userId: ${op.userId} (type: ${typeof op.userId})`);
                
                // Check if part of transaction
                if (op.transactionId) {
                    // Skip if we've already processed this transaction
                    if (processedTransactions.has(op.transactionId)) {
                        continue;
                    }
                    
                    // Get all operations in the transaction
                    const transactionOps = this.transactions.get(op.transactionId) || [];
                    const validTransactionOps = transactionOps.filter(id => {
                        const txOp = this.operations.get(id);
                        return txOp && txOp.state === 'applied';
                    });
                    
                    if (validTransactionOps.length > 0) {
                        undoable.push({
                            type: 'transaction',
                            operationIds: validTransactionOps,
                            transactionId: op.transactionId,
                            timestamp: op.timestamp
                        });
                        processedTransactions.add(op.transactionId);
                    }
                } else {
                    // Single operation
                    undoable.push({
                        type: 'single',
                        operationId: op.id,
                        timestamp: op.timestamp
                    });
                }
            } else if (op) {
                
            }
        }
        
        return undoable;
    }
    
    /**
     * Get redoable operations for a user in a project
     */
    getRedoableOperations(userId, projectId, limit = 1) {
        const undoStateKey = `${userId}-${projectId}`;
        const undoState = this.userUndoState.get(undoStateKey);
        
        if (!undoState || undoState.redoStack.length === 0) {
            return [];
        }
        
        return undoState.redoStack.slice(-limit).reverse();
    }
    
    /**
     * Mark operations as undone
     */
    markOperationsUndone(operationIds, userId, projectId) {
        const undoneInfo = [];
        
        for (const opId of operationIds) {
            const op = this.operations.get(opId);
            if (op && op.state === 'applied') {
                op.state = 'undone';
                op.undoneAt = Date.now();
                op.undoneBy = userId;
                
                undoneInfo.push({
                    operationId: opId,
                    type: op.type,
                    transactionId: op.transactionId
                });
            }
        }
        
        // Add to user's redo stack
        const undoStateKey = `${userId}-${projectId}`;
        if (!this.userUndoState.has(undoStateKey)) {
            this.userUndoState.set(undoStateKey, {
                undoStack: [],
                redoStack: []
            });
        }
        
        const undoState = this.userUndoState.get(undoStateKey);
        
        // Group operations by transaction for redo
        if (undoneInfo.length > 0) {
            const firstOp = this.operations.get(operationIds[0]);
            if (firstOp && firstOp.transactionId) {
                undoState.redoStack.push({
                    type: 'transaction',
                    operationIds: operationIds,
                    transactionId: firstOp.transactionId
                });
            } else {
                // Single operations
                for (const info of undoneInfo) {
                    undoState.redoStack.push({
                        type: 'single',
                        operationId: info.operationId
                    });
                }
            }
        }
        
        return undoneInfo;
    }
    
    /**
     * Mark operations as redone
     */
    markOperationsRedone(operationIds, userId, projectId) {
        const redoneInfo = [];
        
        for (const opId of operationIds) {
            const op = this.operations.get(opId);
            if (op && op.state === 'undone') {
                op.state = 'applied';
                op.redoneAt = Date.now();
                op.redoneBy = userId;
                
                redoneInfo.push({
                    operationId: opId,
                    type: op.type,
                    transactionId: op.transactionId
                });
            }
        }
        
        // Remove from redo stack
        const undoStateKey = `${userId}-${projectId}`;
        const undoState = this.userUndoState.get(undoStateKey);
        if (undoState && undoState.redoStack.length > 0) {
            // Remove the last item (most recent)
            undoState.redoStack.pop();
        }
        
        return redoneInfo;
    }
    
    /**
     * Get operations that affect specific nodes
     */
    getNodeOperations(nodeIds, projectId) {
        const projectTimeline = this.timeline.get(projectId) || [];
        const nodeIdSet = new Set(nodeIds);
        const nodeOperations = [];
        
        for (const opId of projectTimeline) {
            const op = this.operations.get(opId);
            if (op && op.state === 'applied') {
                const affectedNodes = this.getAffectedNodes(op);
                if (affectedNodes.some(nodeId => nodeIdSet.has(nodeId))) {
                    nodeOperations.push(op);
                }
            }
        }
        
        return nodeOperations;
    }
    
    /**
     * Get nodes affected by an operation
     */
    getAffectedNodes(operation) {
        const affected = [];
        
        switch (operation.type) {
            case 'node_create':
            case 'node_duplicate':
                if (operation.params.id) {
                    affected.push(operation.params.id);
                }
                break;
                
            case 'node_move':
            case 'node_property_update':
            case 'node_rotate':
            case 'video_toggle':
                if (operation.params.nodeId) {
                    affected.push(operation.params.nodeId);
                }
                if (operation.params.nodeIds) {
                    affected.push(...operation.params.nodeIds);
                }
                break;
                
            case 'node_delete':
            case 'node_resize':
            case 'node_reset':
                if (operation.params.nodeIds) {
                    affected.push(...operation.params.nodeIds);
                }
                break;
                
            case 'node_batch_property_update':
                if (operation.params.updates) {
                    for (const update of operation.params.updates) {
                        if (update.nodeId) {
                            affected.push(update.nodeId);
                        }
                    }
                }
                break;
                
            case 'node_paste':
                // Paste creates new nodes, check undo data for original IDs
                if (operation.undoData && operation.undoData.createdNodeIds) {
                    affected.push(...operation.undoData.createdNodeIds);
                }
                break;
        }
        
        return affected;
    }
    
    /**
     * Check for conflicts with other users' operations
     */
    async checkUndoConflicts(operationIds, userId, projectId) {
        const conflicts = [];
        const affectedNodes = new Set();
        
        // Collect all affected nodes
        for (const opId of operationIds) {
            const op = this.operations.get(opId);
            if (op) {
                const nodes = this.getAffectedNodes(op);
                nodes.forEach(nodeId => affectedNodes.add(nodeId));
            }
        }
        
        // Find the earliest operation we're undoing
        let earliestTimestamp = Infinity;
        for (const opId of operationIds) {
            const op = this.operations.get(opId);
            if (op && op.timestamp < earliestTimestamp) {
                earliestTimestamp = op.timestamp;
            }
        }
        
        // Check for later operations on the same nodes by other users
        const projectTimeline = this.timeline.get(projectId) || [];
        
        for (const opId of projectTimeline) {
            const op = this.operations.get(opId);
            
            // Skip if it's our own operation or if it's before our undo point
            if (!op || op.userId === userId || op.timestamp <= earliestTimestamp) {
                continue;
            }
            
            // Skip if already undone
            if (op.state !== 'applied') {
                continue;
            }
            
            // Check if this operation affects any of our nodes
            const opNodes = this.getAffectedNodes(op);
            const hasConflict = opNodes.some(nodeId => affectedNodes.has(nodeId));
            
            if (hasConflict) {
                conflicts.push({
                    operationId: op.id,
                    userId: op.userId,
                    type: op.type,
                    timestamp: op.timestamp,
                    affectedNodes: opNodes.filter(nodeId => affectedNodes.has(nodeId))
                });
            }
        }
        
        return conflicts;
    }
    
    /**
     * Get all operations for a project (for debugging)
     * @param {string} projectId - Project ID
     * @param {number} limit - Maximum number of operations to return
     * @param {string} type - 'undo' or 'redo'
     * @returns {Array} List of operations
     */
    getAllProjectOperations(projectId, limit = 20, type = 'undo') {
        const projectTimeline = this.timeline.get(projectId) || [];
        const operations = [];

        if (type === 'undo') {
            // Get most recent applied operations
            for (let i = projectTimeline.length - 1; i >= 0 && operations.length < limit; i--) {
                const opId = projectTimeline[i];
                const op = this.operations.get(opId);
                
                if (op && op.state === 'applied') {
                    // Check if this is part of a transaction
                    const transaction = this.findTransactionForOperation(opId);
                    
                    if (transaction && !operations.find(item => item.transactionId === transaction.id)) {
                        // Add transaction
                        operations.push({
                            type: 'transaction',
                            transactionId: transaction.id,
                            operationIds: transaction.operationIds,
                            timestamp: transaction.timestamp,
                            userId: transaction.userId
                        });
                    } else if (!transaction) {
                        // Single operation
                        operations.push({
                            type: 'single',
                            operationId: opId,
                            timestamp: op.timestamp,
                            userId: op.userId
                        });
                    }
                }
            }
        } else if (type === 'redo') {
            // Get most recent undone operations
            for (let i = projectTimeline.length - 1; i >= 0 && operations.length < limit; i--) {
                const opId = projectTimeline[i];
                const op = this.operations.get(opId);
                
                if (op && op.state === 'undone') {
                    operations.push({
                        type: 'single',
                        operationId: opId,
                        timestamp: op.timestamp,
                        userId: op.userId
                    });
                }
            }
        }

        return operations;
    }
    
    /**
     * Get user's undo/redo state
     */
    getUserUndoState(userId, projectId) {
        const undoable = this.getUndoableOperations(userId, projectId, 10);
        const redoable = this.getRedoableOperations(userId, projectId, 10);
        
        const state = {
            canUndo: undoable.length > 0,
            canRedo: redoable.length > 0,
            undoCount: undoable.length,
            redoCount: redoable.length,
            nextUndo: undoable[0] || null,
            nextRedo: redoable[0] || null
        };

        return state;
    }
    
    /**
     * Clear project history
     * @returns {number} Number of operations cleared
     */
    clearProjectHistory(projectId) {
        // Remove from timeline
        this.timeline.delete(projectId);
        
        let clearedCount = 0;
        
        // Remove operations
        for (const [opId, op] of this.operations.entries()) {
            if (op.projectId === projectId) {
                this.operations.delete(opId);
                clearedCount++;
                
                // Remove from user operations
                const userOps = this.userOperations.get(op.userId);
                if (userOps) {
                    const index = userOps.indexOf(opId);
                    if (index > -1) {
                        userOps.splice(index, 1);
                    }
                }
                
                // Remove from transactions
                if (op.transactionId) {
                    const txOps = this.transactions.get(op.transactionId);
                    if (txOps) {
                        const index = txOps.indexOf(opId);
                        if (index > -1) {
                            txOps.splice(index, 1);
                        }
                    }
                }
            }
        }
        
        // Clear undo states
        for (const [key, state] of this.userUndoState.entries()) {
            if (key.endsWith(`-${projectId}`)) {
                this.userUndoState.delete(key);
            }
        }
        
        return clearedCount;
    }
}

module.exports = OperationHistory;