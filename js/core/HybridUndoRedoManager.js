/**
 * HybridUndoRedoManager - Provides undo/redo functionality for the new architecture
 * 
 * Features:
 * - Works with server-authoritative state sync
 * - Bundles related operations automatically
 * - Excludes navigation operations
 * - Supports both online and offline modes
 */
class HybridUndoRedoManager {
    constructor(app) {
        this.app = app;
        this.pipeline = app.operationPipeline;
        this.stateSync = app.stateSyncManager;
        
        // History tracking
        this.history = [];
        this.historyIndex = -1;
        this.maxHistorySize = 50;
        
        // Operation bundling
        this.bundleWindow = 100; // ms
        this.pendingBundle = null;
        this.bundleTimeout = null;
        
        // Operations to exclude from history
        this.excludeFromHistory = new Set([
            'viewport_pan',
            'viewport_zoom',
            'selection_change',
            'hover_change',
            'cursor_move'
        ]);
        
        // Track last operation for bundling detection
        this.lastOperation = null;
        this.lastOperationTime = 0;
        
        this.setupInterceptors();
        console.log('🔄 HybridUndoRedoManager initialized');
    }
    
    /**
     * Setup interceptors to capture operations
     */
    setupInterceptors() {
        // Intercept processQueue to capture the actual executed command
        const originalProcessQueue = this.pipeline.processQueue.bind(this.pipeline);
        
        this.pipeline.processQueue = async function() {
            // Check if there's a command to process
            if (this.executing || this.executionQueue.length === 0) {
                return originalProcessQueue.call(this);
            }
            
            // Peek at the command that will be executed
            const { command } = this.executionQueue[0];
            
            // Store reference for capture after execution
            const manager = window.app.undoRedoManager;
            const shouldTrack = command && 
                               command.origin === 'local' && 
                               manager && 
                               manager.shouldTrackOperation(command) &&
                               !this.executionQueue[0].options.skipHistory;
            
            // Call original processQueue
            await originalProcessQueue.call(this);
            
            // After execution, capture the command with its undo data
            if (shouldTrack && command.executed) {
                console.log(`📝 Capturing executed command:`, {
                    type: command.type,
                    hasUndoData: !!command.undoData,
                    undoDataLength: command.undoData?.nodes?.length || 0
                });
                
                // Pass source if available
                if (this.executionQueue[0]?.options?.source) {
                    command.source = this.executionQueue[0].options.source;
                }
                
                manager.addToHistory(command);
            }
        };
    }
    
    /**
     * Check if operation should be tracked in history
     */
    shouldTrackOperation(operation) {
        // Skip excluded operation types
        if (this.excludeFromHistory.has(operation.type)) {
            return false;
        }
        
        // Skip remote operations
        if (operation.origin !== 'local') {
            return false;
        }
        
        // Skip no-op operations
        if (operation.isEmpty && operation.isEmpty()) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Add operation to history with bundling support
     */
    addToHistory(operation) {
        const now = Date.now();
        
        // Check if we should bundle with previous operation
        if (this.shouldBundle(operation, now)) {
            this.addToBundle(operation);
        } else {
            // Finalize any pending bundle
            this.finalizePendingBundle();
            
            // Check if this starts a new bundle
            if (this.isMultiNodeOperation(operation) || this.isDragDuplicateStart(operation)) {
                this.startNewBundle(operation);
            } else {
                // Add as single operation
                this.addSingleOperation(operation);
            }
        }
        
        this.lastOperation = operation;
        this.lastOperationTime = now;
    }
    
    /**
     * Check if operation should be bundled with previous
     */
    shouldBundle(operation, timestamp) {
        if (!this.lastOperation || !this.pendingBundle) return false;
        
        // Time window check
        if (timestamp - this.lastOperationTime > this.bundleWindow) return false;
        
        // Drag duplicate pattern: CREATE followed by MOVE
        if (this.lastOperation.type === 'node_create' && 
            operation.type === 'node_move' &&
            this.hasSameNode(operation, this.lastOperation)) {
            return true;
        }
        
        // Multi-node move pattern
        if (operation.type === 'node_move' && 
            this.lastOperation.type === 'node_move' &&
            !this.hasSameNode(operation, this.lastOperation)) {
            return true;
        }
        
        // Alignment pattern
        if (operation.source === 'alignment' && 
            this.lastOperation.source === 'alignment') {
            return true;
        }
        
        // Reset pattern (multiple property updates)
        if (operation.type === 'node_reset' && 
            this.lastOperation.type === 'node_reset') {
            return true;
        }
        
        // Batch property updates
        if (operation.type === 'node_batch_property_update' ||
            (operation.type === 'node_property_update' && 
             this.lastOperation.type === 'node_property_update')) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Check if operations affect the same node
     */
    hasSameNode(op1, op2) {
        const nodes1 = this.getAffectedNodes(op1);
        const nodes2 = this.getAffectedNodes(op2);
        
        return nodes1.some(n1 => nodes2.includes(n1));
    }
    
    /**
     * Get affected node IDs from operation
     */
    getAffectedNodes(operation) {
        const nodes = [];
        
        if (operation.params.nodeId) {
            nodes.push(operation.params.nodeId);
        }
        if (operation.params.nodeIds) {
            nodes.push(...operation.params.nodeIds);
        }
        if (operation.result?.node?.id) {
            nodes.push(operation.result.node.id);
        }
        if (operation.result?.nodes) {
            nodes.push(...operation.result.nodes.map(n => n.id));
        }
        
        return nodes;
    }
    
    /**
     * Check if operation is multi-node
     */
    isMultiNodeOperation(operation) {
        return operation.params.nodeIds && operation.params.nodeIds.length > 1;
    }
    
    /**
     * Check if operation starts a drag duplicate
     */
    isDragDuplicateStart(operation) {
        return operation.type === 'node_create' || 
               operation.type === 'node_duplicate';
    }
    
    /**
     * Start a new operation bundle
     */
    startNewBundle(operation) {
        this.pendingBundle = {
            id: `bundle_${Date.now()}`,
            description: this.getBundleDescription(operation),
            operations: [operation],
            timestamp: Date.now()
        };
        
        // Set timeout to finalize bundle
        this.bundleTimeout = setTimeout(() => {
            this.finalizePendingBundle();
        }, this.bundleWindow * 2);
    }
    
    /**
     * Add operation to current bundle
     */
    addToBundle(operation) {
        if (!this.pendingBundle) return;
        
        this.pendingBundle.operations.push(operation);
        
        // Reset timeout
        clearTimeout(this.bundleTimeout);
        this.bundleTimeout = setTimeout(() => {
            this.finalizePendingBundle();
        }, this.bundleWindow * 2);
    }
    
    /**
     * Finalize pending bundle and add to history
     */
    finalizePendingBundle() {
        if (!this.pendingBundle) return;
        
        clearTimeout(this.bundleTimeout);
        
        // Create bundled command
        const bundle = new BundledCommand(
            this.pendingBundle.operations,
            this.pendingBundle.description
        );
        
        this.addSingleOperation(bundle);
        this.pendingBundle = null;
    }
    
    /**
     * Add single operation to history
     */
    addSingleOperation(operation) {
        // Remove any operations after current index
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        
        // Add new operation
        this.history.push(operation);
        this.historyIndex++;
        
        // Limit history size
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
            this.historyIndex--;
        }
        
        console.log(`📚 Added to history: ${operation.type || operation.description} (index: ${this.historyIndex})`);
    }
    
    /**
     * Get bundle description based on operations
     */
    getBundleDescription(operation) {
        switch (operation.type) {
            case 'node_create':
            case 'node_duplicate':
                return 'Duplicate Node';
            case 'node_move':
                return operation.params.nodeIds?.length > 1 ? 'Move Selection' : 'Move Node';
            case 'node_reset':
                return 'Reset Properties';
            case 'node_property_update':
                return 'Update Properties';
            default:
                return 'Bundled Operation';
        }
    }
    
    /**
     * Undo last operation
     */
    async undo() {
        // Finalize any pending bundle first
        this.finalizePendingBundle();
        
        if (this.historyIndex < 0) {
            console.log('Nothing to undo');
            return false;
        }
        
        const operation = this.history[this.historyIndex];
        
        try {
            console.log(`↩️ Undoing: ${operation.type || operation.description}`);
            
            // Create undo context
            const context = {
                app: this.app,
                graph: this.app.graph,
                canvas: this.app.graphCanvas
            };
            
            // Execute undo
            await operation.undo(context);
            
            // Update index
            this.historyIndex--;
            
            // Update canvas
            if (this.app.graphCanvas) {
                this.app.graphCanvas.dirty_canvas = true;
            }
            
            // Notify state sync if connected
            if (this.stateSync && this.app.networkLayer?.isConnected) {
                // In future, this could sync undo operation to server
                console.log('📡 Undo completed (local only for now)');
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ Undo failed:', error);
            return false;
        }
    }
    
    /**
     * Redo operation
     */
    async redo() {
        if (this.historyIndex >= this.history.length - 1) {
            console.log('Nothing to redo');
            return false;
        }
        
        this.historyIndex++;
        const operation = this.history[this.historyIndex];
        
        try {
            console.log(`↪️ Redoing: ${operation.type || operation.description}`);
            
            // Create redo context
            const context = {
                app: this.app,
                graph: this.app.graph,
                canvas: this.app.graphCanvas
            };
            
            // Execute operation
            await operation.execute(context);
            
            // Update canvas
            if (this.app.graphCanvas) {
                this.app.graphCanvas.dirty_canvas = true;
            }
            
            // Notify state sync if connected
            if (this.stateSync && this.app.networkLayer?.isConnected) {
                // In future, this could sync redo operation to server
                console.log('📡 Redo completed (local only for now)');
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ Redo failed:', error);
            this.historyIndex--;
            return false;
        }
    }
    
    /**
     * Clear history
     */
    clearHistory() {
        this.finalizePendingBundle();
        this.history = [];
        this.historyIndex = -1;
        this.lastOperation = null;
        console.log('🗑️ History cleared');
    }
    
    /**
     * Get history info
     */
    getHistoryInfo() {
        return {
            size: this.history.length,
            index: this.historyIndex,
            canUndo: this.historyIndex >= 0,
            canRedo: this.historyIndex < this.history.length - 1,
            operations: this.history.map((op, i) => ({
                type: op.type || op.description,
                active: i === this.historyIndex
            }))
        };
    }
}

/**
 * BundledCommand - Represents multiple operations as a single undo/redo unit
 */
class BundledCommand {
    constructor(operations, description) {
        this.operations = operations;
        this.description = description;
        this.type = 'bundled';
        this.timestamp = Date.now();
    }
    
    async execute(context) {
        const results = [];
        for (const op of this.operations) {
            const result = await op.execute(context);
            results.push(result);
        }
        return { success: true, results };
    }
    
    async undo(context) {
        // Undo in reverse order
        for (let i = this.operations.length - 1; i >= 0; i--) {
            await this.operations[i].undo(context);
        }
    }
    
    validate() {
        return { valid: true };
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.HybridUndoRedoManager = HybridUndoRedoManager;
    window.BundledCommand = BundledCommand;
}