/**
 * UnifiedOperationHandler - Single source of truth for all operations
 * Eliminates the triple implementation problem by centralizing operation logic
 */
class UnifiedOperationHandler {
    constructor(app) {
        this.app = app;
        this.canvas = app.graphCanvas;
        this.graph = app.graph;
        this.handlers = new Map();
        this.queue = new OperationQueue();
        this.transactionManager = null; // Will be set when TransactionManager is created
        
        // Operation validation schemas
        this.schemas = new Map();
        
        // Register all core operations
        this.registerCoreOperations();
        
        console.log('🔧 UnifiedOperationHandler initialized');
    }
    
    /**
     * Set the transaction manager
     */
    setTransactionManager(transactionManager) {
        this.transactionManager = transactionManager;
    }
    
    /**
     * Execute an operation with unified handling
     */
    async execute(operation, context = {}) {
        const { type, data } = operation;
        const isRemote = context.isRemote || false;
        const operationId = context.operationId || this.generateOperationId();
        
        console.log(`🔧 Executing operation: ${type}`, { operationId, isRemote });
        
        // Validate operation
        const validation = this.validateOperation(operation);
        if (!validation.valid) {
            throw new Error(`Operation validation failed: ${validation.error}`);
        }
        
        // Get handler
        const handler = this.handlers.get(type);
        if (!handler) {
            throw new Error(`Unknown operation type: ${type}`);
        }
        
        // Queue for ordered execution
        return this.queue.enqueue(async () => {
            let result = null;
            let undoData = null;
            
            try {
                // Execute with transaction support if available
                if (this.transactionManager && handler.supportsTransactions) {
                    result = await this.transactionManager.executeWithTransaction(async () => {
                        const execResult = await handler.execute(data, this.app, context);
                        undoData = execResult.undo;
                        return execResult.result;
                    });
                } else {
                    const execResult = await handler.execute(data, this.app, context);
                    result = execResult.result;
                    undoData = execResult.undo;
                }
                
                // Broadcast if local operation
                if (!isRemote && this.app.collaborativeManager?.isConnected) {
                    await this.app.collaborativeManager.broadcastOperation({
                        ...operation,
                        operationId,
                        timestamp: Date.now()
                    });
                }
                
                // Force canvas redraw if needed
                if (handler.requiresRedraw && this.canvas) {
                    this.canvas.dirty_canvas = true;
                }
                
                return {
                    success: true,
                    result,
                    undo: undoData,
                    operationId
                };
                
            } catch (error) {
                console.error(`❌ Operation ${type} failed:`, error);
                throw error;
            }
        });
    }
    
    /**
     * Register a new operation handler
     */
    registerOperation(type, config) {
        const handler = {
            execute: config.execute,
            validate: config.validate || (() => ({ valid: true })),
            supportsTransactions: config.supportsTransactions || false,
            requiresRedraw: config.requiresRedraw !== false, // Default true
            description: config.description || `${type} operation`
        };
        
        this.handlers.set(type, handler);
        
        // Register validation schema if provided
        if (config.schema) {
            this.schemas.set(type, config.schema);
        }
        
        console.log(`📝 Registered operation: ${type}`);
    }
    
    /**
     * Validate an operation
     */
    validateOperation(operation) {
        const { type, data } = operation;
        
        // Check if handler exists
        const handler = this.handlers.get(type);
        if (!handler) {
            return { valid: false, error: `Unknown operation type: ${type}` };
        }
        
        // Run handler validation
        try {
            const result = handler.validate(data);
            return result || { valid: true };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }
    
    /**
     * Get all registered operation types
     */
    getOperationTypes() {
        return Array.from(this.handlers.keys());
    }
    
    /**
     * Get operation handler info
     */
    getOperationInfo(type) {
        const handler = this.handlers.get(type);
        if (!handler) return null;
        
        return {
            type,
            description: handler.description,
            supportsTransactions: handler.supportsTransactions,
            requiresRedraw: handler.requiresRedraw
        };
    }
    
    /**
     * Generate unique operation ID
     */
    generateOperationId() {
        return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Register all core operations
     */
    registerCoreOperations() {
        console.log('📋 Registering core operations...');
        
        // Node Move Operation
        this.registerOperation('node_move', {
            description: 'Move nodes to new positions',
            supportsTransactions: true,
            execute: async (data, app) => {
                const { nodeIds, positions, nodeId, pos } = data;
                const canvas = app.graphCanvas;
                const undoData = { type: 'node_move', operations: [] };
                
                if (nodeIds && positions) {
                    // Multiple nodes
                    for (let i = 0; i < nodeIds.length; i++) {
                        const node = canvas.graph.getNodeById(nodeIds[i]);
                        if (node) {
                            undoData.operations.push({
                                nodeId: nodeIds[i],
                                oldPos: [...node.pos],
                                newPos: positions[i]
                            });
                            node.pos = [...positions[i]];
                        }
                    }
                } else if (nodeId && pos) {
                    // Single node
                    const node = canvas.graph.getNodeById(nodeId);
                    if (node) {
                        undoData.operations.push({
                            nodeId,
                            oldPos: [...node.pos],
                            newPos: pos
                        });
                        node.pos = [...pos];
                    }
                }
                
                return {
                    result: { moved: undoData.operations.length },
                    undo: undoData
                };
            },
            validate: (data) => {
                if (!data.nodeId && !data.nodeIds) {
                    return { valid: false, error: 'Missing nodeId or nodeIds' };
                }
                if (!data.pos && !data.positions) {
                    return { valid: false, error: 'Missing pos or positions' };
                }
                return { valid: true };
            }
        });
        
        // Node Resize Operation
        this.registerOperation('node_resize', {
            description: 'Resize nodes',
            supportsTransactions: true,
            execute: async (data, app) => {
                const { nodeId, size, nodeIds, sizes } = data;
                const canvas = app.graphCanvas;
                const undoData = { type: 'node_resize', operations: [] };
                
                if (nodeIds && sizes) {
                    // Multiple nodes
                    for (let i = 0; i < nodeIds.length; i++) {
                        const node = canvas.graph.getNodeById(nodeIds[i]);
                        if (node) {
                            undoData.operations.push({
                                nodeId: nodeIds[i],
                                oldSize: [...node.size],
                                newSize: sizes[i]
                            });
                            node.size = [...sizes[i]];
                        }
                    }
                } else if (nodeId && size) {
                    // Single node
                    const node = canvas.graph.getNodeById(nodeId);
                    if (node) {
                        undoData.operations.push({
                            nodeId,
                            oldSize: [...node.size],
                            newSize: size
                        });
                        node.size = [...size];
                    }
                }
                
                return {
                    result: { resized: undoData.operations.length },
                    undo: undoData
                };
            },
            validate: (data) => {
                if (!data.nodeId && !data.nodeIds) {
                    return { valid: false, error: 'Missing nodeId or nodeIds' };
                }
                if (!data.size && !data.sizes) {
                    return { valid: false, error: 'Missing size or sizes' };
                }
                return { valid: true };
            }
        });
        
        // Node Create Operation
        this.registerOperation('node_create', {
            description: 'Create new nodes',
            supportsTransactions: true,
            execute: async (data, app) => {
                const { nodeData, nodes } = data;
                const canvas = app.graphCanvas;
                const graph = canvas.graph;
                const undoData = { type: 'node_create', nodeIds: [] };
                
                const nodesToCreate = nodes || [nodeData];
                
                for (const nodeInfo of nodesToCreate) {
                    // Create node using NodeFactory
                    const node = NodeFactory.createNode(nodeInfo.type);
                    if (!node) {
                        throw new Error(`Failed to create node of type: ${nodeInfo.type}`);
                    }
                    
                    // Set node properties
                    if (nodeInfo.id) node.id = nodeInfo.id;
                    if (nodeInfo.pos) node.pos = [...nodeInfo.pos];
                    if (nodeInfo.size) node.size = [...nodeInfo.size];
                    if (nodeInfo.properties) {
                        Object.assign(node.properties, nodeInfo.properties);
                    }
                    
                    // Add to graph
                    graph.add(node);
                    undoData.nodeIds.push(node.id);
                }
                
                return {
                    result: { created: undoData.nodeIds },
                    undo: undoData
                };
            },
            validate: (data) => {
                if (!data.nodeData && !data.nodes) {
                    return { valid: false, error: 'Missing nodeData or nodes' };
                }
                const nodeToCheck = data.nodeData || data.nodes[0];
                if (!nodeToCheck?.type) {
                    return { valid: false, error: 'Missing node type' };
                }
                return { valid: true };
            }
        });
        
        // Node Delete Operation
        this.registerOperation('node_delete', {
            description: 'Delete nodes',
            supportsTransactions: true,
            execute: async (data, app) => {
                const { nodeIds, nodeId } = data;
                const canvas = app.graphCanvas;
                const graph = canvas.graph;
                const undoData = { type: 'node_delete', nodes: [] };
                
                const idsToDelete = nodeIds || [nodeId];
                
                for (const id of idsToDelete) {
                    const node = graph.getNodeById(id);
                    if (node) {
                        // Store node data for undo
                        undoData.nodes.push({
                            id: node.id,
                            type: node.type,
                            pos: [...node.pos],
                            size: [...node.size],
                            properties: { ...node.properties }
                        });
                        
                        // Remove from graph
                        graph.remove(node);
                    }
                }
                
                return {
                    result: { deleted: undoData.nodes.length },
                    undo: undoData
                };
            },
            validate: (data) => {
                if (!data.nodeId && !data.nodeIds) {
                    return { valid: false, error: 'Missing nodeId or nodeIds' };
                }
                return { valid: true };
            }
        });
        
        // Node Property Update Operation
        this.registerOperation('node_property_update', {
            description: 'Update node properties',
            supportsTransactions: true,
            execute: async (data, app) => {
                const { nodeId, properties, property, value } = data;
                const canvas = app.graphCanvas;
                const node = canvas.graph.getNodeById(nodeId);
                
                if (!node) {
                    throw new Error(`Node not found: ${nodeId}`);
                }
                
                const undoData = {
                    type: 'node_property_update',
                    nodeId,
                    oldProperties: {}
                };
                
                if (properties) {
                    // Multiple properties
                    Object.keys(properties).forEach(key => {
                        undoData.oldProperties[key] = node.properties[key];
                        node.properties[key] = properties[key];
                    });
                } else if (property && value !== undefined) {
                    // Single property
                    undoData.oldProperties[property] = node.properties[property];
                    node.properties[property] = value;
                }
                
                return {
                    result: { updated: nodeId },
                    undo: undoData
                };
            },
            validate: (data) => {
                if (!data.nodeId) {
                    return { valid: false, error: 'Missing nodeId' };
                }
                if (!data.properties && (!data.property || data.value === undefined)) {
                    return { valid: false, error: 'Missing properties or property/value' };
                }
                return { valid: true };
            }
        });
        
        // State Sync Operation
        this.registerOperation('state_sync', {
            description: 'Synchronize full canvas state',
            supportsTransactions: false,
            requiresRedraw: true,
            execute: async (data, app) => {
                const { state } = data;
                const canvas = app.graphCanvas;
                const stateManager = app.stateManager;
                
                // Apply state through state manager
                if (stateManager && state) {
                    stateManager.loadState(state);
                }
                
                return {
                    result: { synced: true },
                    undo: null // State sync operations are not undoable
                };
            },
            validate: (data) => {
                if (!data.state) {
                    return { valid: false, error: 'Missing state data' };
                }
                return { valid: true };
            }
        });
        
        // Transaction Operation (for remote transaction execution)
        this.registerOperation('transaction', {
            description: 'Execute a transaction from remote user',
            supportsTransactions: false, // Transactions don't nest
            requiresRedraw: true,
            execute: async (data, app, context) => {
                const { transactionId, operations } = data;
                
                console.log(`🔄 Executing remote transaction: ${transactionId}`);
                
                // Execute each operation in the transaction
                const results = [];
                for (const operation of operations) {
                    const result = await this.execute(operation, {
                        ...context,
                        isRemote: true,
                        parentTransactionId: transactionId
                    });
                    results.push(result);
                }
                
                return {
                    result: { 
                        transactionId,
                        operationsExecuted: operations.length,
                        results 
                    },
                    undo: null // Remote transactions are not undoable locally
                };
            },
            validate: (data) => {
                if (!data.transactionId) {
                    return { valid: false, error: 'Missing transactionId' };
                }
                if (!data.operations || !Array.isArray(data.operations)) {
                    return { valid: false, error: 'Missing or invalid operations array' };
                }
                return { valid: true };
            }
        });
        
        console.log(`✅ Registered ${this.handlers.size} core operations`);
    }
}

/**
 * OperationQueue - Ensures operations are executed in order
 */
class OperationQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
    }
    
    async enqueue(operation) {
        return new Promise((resolve, reject) => {
            this.queue.push({ operation, resolve, reject });
            this.processQueue();
        });
    }
    
    async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }
        
        this.processing = true;
        
        while (this.queue.length > 0) {
            const { operation, resolve, reject } = this.queue.shift();
            
            try {
                const result = await operation();
                resolve(result);
            } catch (error) {
                reject(error);
            }
        }
        
        this.processing = false;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { UnifiedOperationHandler, OperationQueue };
}