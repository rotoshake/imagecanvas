/**
 * OperationPipeline - Single entry point for all operations
 * Ensures sequential execution, validation, and proper broadcasting
 */
class OperationPipeline {
    constructor(app) {
        this.app = app;
        this.commandRegistry = new Map();
        this.executionQueue = [];
        this.executing = false;
        this.history = [];
        this.historyIndex = -1;
        this.maxHistorySize = 50;
        
        // Track executed operations to prevent duplicates
        this.executedOperations = new Set();
        
        // Command merging window (ms)
        this.mergeWindow = 100;
        this.pendingMerge = null;
        
        // Operation dependency tracking
        this.dependencyTracker = typeof OperationDependencyTracker !== 'undefined' ? 
            new OperationDependencyTracker() : null;
        
        // Register built-in commands
        this.registerBuiltinCommands();
        
        console.log('🚀 OperationPipeline initialized');
        console.log('📝 Registered commands:', Array.from(this.commandRegistry.keys()));
    }
    
    /**
     * Register built-in commands
     */
    registerBuiltinCommands() {
        // Basic node commands
        if (typeof MoveNodeCommand !== 'undefined') {
            this.registerCommand('node_move', MoveNodeCommand);
        }
        if (typeof CreateNodeCommand !== 'undefined') {
            this.registerCommand('node_create', CreateNodeCommand);
        }
        if (typeof DeleteNodeCommand !== 'undefined') {
            this.registerCommand('node_delete', DeleteNodeCommand);
        }
        if (typeof UpdateNodePropertyCommand !== 'undefined') {
            this.registerCommand('node_property_update', UpdateNodePropertyCommand);
        }
        
        // Try to register extended commands if available
        this.registerExtendedCommands();
        
        if (typeof ImageUploadCompleteCommand !== 'undefined') {
            this.registerCommand('image_upload_complete', ImageUploadCompleteCommand);
        }
    }
    
    /**
     * Register extended node commands - can be called later if not available during init
     */
    registerExtendedCommands() {
        console.log('🔍 Checking for NodeCommandsExtended...', typeof window.NodeCommandsExtended);
        if (typeof window.NodeCommandsExtended !== 'undefined') {
            console.log('✅ Found NodeCommandsExtended with:', Object.keys(window.NodeCommandsExtended));
            const { ResizeNodeCommand, ResetNodeCommand, RotateNodeCommand, VideoToggleCommand } = window.NodeCommandsExtended;
            
            if (ResizeNodeCommand && !this.commandRegistry.has('node_resize')) {
                this.registerCommand('node_resize', ResizeNodeCommand);
            }
            if (ResetNodeCommand && !this.commandRegistry.has('node_reset')) {
                this.registerCommand('node_reset', ResetNodeCommand);
            }
            if (RotateNodeCommand && !this.commandRegistry.has('node_rotate')) {
                this.registerCommand('node_rotate', RotateNodeCommand);
            }
            if (VideoToggleCommand && !this.commandRegistry.has('video_toggle')) {
                this.registerCommand('video_toggle', VideoToggleCommand);
            }
            
            const { BatchPropertyUpdateCommand, DuplicateNodesCommand, PasteNodesCommand } = window.NodeCommandsExtended;
            
            if (BatchPropertyUpdateCommand && !this.commandRegistry.has('node_batch_property_update')) {
                this.registerCommand('node_batch_property_update', BatchPropertyUpdateCommand);
            }
            if (DuplicateNodesCommand && !this.commandRegistry.has('node_duplicate')) {
                this.registerCommand('node_duplicate', DuplicateNodesCommand);
            }
            if (PasteNodesCommand && !this.commandRegistry.has('node_paste')) {
                this.registerCommand('node_paste', PasteNodesCommand);
            }
            
            console.log('✅ Extended node commands registered');
            return true;
        }
        return false;
    }
    
    /**
     * Register a command class
     */
    registerCommand(type, CommandClass) {
        this.commandRegistry.set(type, CommandClass);
        console.log(`📝 Registered command: ${type}`);
    }
    
    /**
     * Create a command instance
     */
    createCommand(type, params, origin = 'local') {
        let CommandClass = this.commandRegistry.get(type);
        
        // If command not found, try registering extended commands as a fallback
        if (!CommandClass && (type === 'node_resize' || type === 'node_rotate' || type === 'node_reset')) {
            console.warn(`⚠️ Command ${type} not found, attempting to register extended commands...`);
            this.registerExtendedCommands();
            CommandClass = this.commandRegistry.get(type);
        }
        
        if (!CommandClass) {
            console.error('❌ Available commands:', Array.from(this.commandRegistry.keys()));
            throw new Error(`Unknown command type: ${type}`);
        }
        
        return new CommandClass(params, origin);
    }
    
    /**
     * Execute a command - main entry point
     */
    async execute(commandOrType, params, options = {}) {
        let command;
        
        // Handle both command objects and type+params
        if (typeof commandOrType === 'string') {
            // REMOVED: Pre-validation was causing more problems than it solved
            // Operations should succeed locally and handle server errors gracefully
            
            // LOG ALL OPERATIONS FOR DEBUGGING
            console.log(`🔍 OPERATION REQUESTED: ${commandOrType}`, {
                params: params,
                origin: options.origin || 'local',
                caller: new Error().stack.split('\n')[2] // Get caller for debugging
            });
            
            command = this.createCommand(commandOrType, params, options.origin || 'local');
        } else {
            command = commandOrType;
            console.log(`🔍 OPERATION REQUESTED: ${command.type}`, {
                params: command.params,
                origin: command.origin,
                caller: new Error().stack.split('\n')[2]
            });
        }
        
        // Check for duplicate remote operations
        if (command.origin === 'remote' && this.executedOperations.has(command.id)) {
            console.log(`⏭️ Skipping duplicate operation: ${command.id}`);
            return { success: false, reason: 'duplicate' };
        }
        
        // Validate command
        const validation = command.validate();
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.error}`);
        }
        
        // Extract affected node IDs and register with dependency tracker
        if (this.dependencyTracker) {
            const nodeIds = this.extractNodeIds(command);
            if (nodeIds.length > 0) {
                this.dependencyTracker.registerOperation(command.id, nodeIds, command);
            }
        }
        
        // Check if we can merge with pending command
        if (command.origin === 'local' && this.pendingMerge && this.pendingMerge.command.canMergeWith(command)) {
            // Merge commands
            this.pendingMerge.command = this.pendingMerge.command.mergeWith(command);
            return { success: true, merged: true };
        }
        
        // Queue for execution
        return new Promise((resolve, reject) => {
            const queueItem = { command, resolve, reject, options };
            
            // For local rapid operations, set up merge window
            if (command.origin === 'local' && command.canMergeWith) {
                if (this.pendingMerge) {
                    clearTimeout(this.pendingMerge.timeout);
                    this.executionQueue.push(this.pendingMerge.item);
                }
                
                this.pendingMerge = {
                    command,
                    item: queueItem,
                    timeout: setTimeout(() => {
                        this.executionQueue.push(this.pendingMerge.item);
                        this.pendingMerge = null;
                        this.processQueue();
                    }, this.mergeWindow)
                };
            } else {
                // Clear any pending merge
                if (this.pendingMerge) {
                    clearTimeout(this.pendingMerge.timeout);
                    this.executionQueue.push(this.pendingMerge.item);
                    this.pendingMerge = null;
                }
                
                this.executionQueue.push(queueItem);
            }
            
            this.processQueue();
        });
    }
    
    /**
     * Check if we should use state sync for this operation
     */
    shouldUseStateSync(command) {
        // Always use state sync for local operations when connected
        // This is now the primary sync method
        return this.app.stateSyncManager && 
               command.origin === 'local' &&
               this.app.networkLayer?.isConnected;
    }
    
    /**
     * Process the execution queue
     */
    async processQueue() {
        if (this.executing || this.executionQueue.length === 0) return;
        
        this.executing = true;
        const { command, resolve, reject, options } = this.executionQueue.shift();
        
        try {
            console.log(`⚡ Executing ${command.origin} command: ${command.type}`, command.params);
            
            // Check if we should use state sync
            if (this.shouldUseStateSync(command) && !options.skipBroadcast) {
                // Route through StateSyncManager for server-authoritative execution
                console.log('🔄 Using server-authoritative state sync');
                
                // For certain UI operations, execute locally first for immediate feedback
                const optimisticOperations = ['node_reset', 'node_rotate'];
                if (optimisticOperations.includes(command.type)) {
                    console.log('⚡ Executing optimistic update for immediate feedback');
                    const context = {
                        app: this.app,
                        graph: this.app.graph,
                        canvas: this.app.graphCanvas
                    };
                    
                    // Execute locally for immediate visual feedback
                    try {
                        await command.execute(context);
                        
                        // Mark affected nodes as having optimistic updates to prevent server overwrites
                        const nodeIds = this.extractNodeIds(command);
                        nodeIds.forEach(nodeId => {
                            const node = this.app.graph.getNodeById(nodeId);
                            if (node) {
                                node._optimisticUpdate = {
                                    operationId: command.id,
                                    timestamp: Date.now(),
                                    type: command.type
                                };
                            }
                        });
                    } catch (error) {
                        console.error('Optimistic update failed:', error);
                        // Continue with server sync anyway
                    }
                }
                
                // Let transaction manager process the operation
                if (this.app.transactionManager) {
                    this.app.transactionManager.processOperation(command);
                }
                
                try {
                    const result = await this.app.stateSyncManager.executeOperation(command);
                    
                    // Don't add to history here - CollaborativeUndoRedoManager handles it
                    // and has access to the command with undo data
                    
                    resolve({ success: true, result: result.result });
                } catch (error) {
                    // If state sync fails, we don't fall back to local execution
                    // This ensures consistency
                    console.error('State sync failed:', error);
                    reject(error);
                }
                
            } else {
                // Execute locally (for remote operations or when offline)
                const context = {
                    app: this.app,
                    graph: this.app.graph,
                    canvas: this.app.graphCanvas
                };
                
                const result = await command.execute(context);
                
                // Track executed remote operations
                if (command.origin === 'remote') {
                    this.executedOperations.add(command.id);
                    
                    // Clean up old entries (keep last 1000)
                    if (this.executedOperations.size > 1000) {
                        const entries = Array.from(this.executedOperations);
                        entries.slice(0, entries.length - 1000).forEach(id => {
                            this.executedOperations.delete(id);
                        });
                    }
                }
                
                // Add to history (local commands only)
                if (command.origin === 'local' && !options.skipHistory) {
                    this.addToHistory(command);
                }
                
                // No longer using legacy broadcast - state sync handles all network communication
                
                // Mark canvas dirty
                if (this.app.graphCanvas) {
                    this.app.graphCanvas.dirty_canvas = true;
                }
                
                resolve({ success: true, result });
            }
            
        } catch (error) {
            console.error(`❌ Command execution failed:`, error);
            reject(error);
        } finally {
            this.executing = false;
            
            // Process next command
            if (this.executionQueue.length > 0) {
                // Use requestIdleCallback for better performance, fallback to setTimeout
                if (typeof requestIdleCallback !== 'undefined') {
                    requestIdleCallback(() => this.processQueue(), { timeout: 50 });
                } else {
                    setTimeout(() => this.processQueue(), 0);
                }
            }
        }
    }
    
    /**
     * Execute a command directly (for BulkCommand)
     */
    async executeCommand(command) {
        // Validate command
        const validation = command.validate();
        if (!validation.valid) {
            throw new Error(validation.error || 'Command validation failed');
        }
        
        // Execute through state sync if available and it's a local command
        if (this.app.stateSyncManager && command.origin === 'local') {
            try {
                const result = await this.app.stateSyncManager.executeOperation(command);
                return { success: true, result: result.result };
            } catch (error) {
                console.error('State sync failed:', error);
                throw error;
            }
        } else {
            // Execute locally
            const context = {
                app: this.app,
                graph: this.app.graph,
                canvas: this.app.graphCanvas
            };
            
            const result = await command.execute(context);
            
            // Mark canvas dirty
            if (this.app.graphCanvas) {
                this.app.graphCanvas.dirty_canvas = true;
            }
            
            return { success: true, result };
        }
    }
    
    /**
     * Add command to history
     */
    addToHistory(command) {
        // Remove any commands after current index (when new action after undo)
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        
        // Add new command
        this.history.push(command);
        this.historyIndex++;
        
        // Limit history size
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
            this.historyIndex--;
        }
        
        console.log(`📚 Added to history: ${command.type} (index: ${this.historyIndex})`);
    }
    
    /**
     * Undo last operation
     */
    async undo() {
        if (this.historyIndex < 0) {
            console.log('Nothing to undo');
            return false;
        }
        
        const command = this.history[this.historyIndex];
        
        try {
            const context = {
                app: this.app,
                graph: this.app.graph,
                canvas: this.app.graphCanvas
            };
            
            await command.undo(context);
            this.historyIndex--;
            
            // Broadcast undo
            if (this.app.networkLayer?.isConnected) {
                this.app.networkLayer.broadcast({
                    type: 'undo',
                    params: { commandId: command.id }
                });
            }
            
            // Mark canvas dirty
            if (this.app.graphCanvas) {
                this.app.graphCanvas.dirty_canvas = true;
            }
            
            console.log(`↩️ Undid: ${command.type}`);
            return true;
            
        } catch (error) {
            console.error('Undo failed:', error);
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
        const command = this.history[this.historyIndex];
        
        try {
            const context = {
                app: this.app,
                graph: this.app.graph,
                canvas: this.app.graphCanvas
            };
            
            await command.execute(context);
            
            // Broadcast redo
            if (this.app.networkLayer?.isConnected) {
                this.app.networkLayer.broadcast({
                    type: 'redo',
                    params: { commandId: command.id }
                });
            }
            
            // Mark canvas dirty
            if (this.app.graphCanvas) {
                this.app.graphCanvas.dirty_canvas = true;
            }
            
            console.log(`↪️ Redid: ${command.type}`);
            return true;
            
        } catch (error) {
            console.error('Redo failed:', error);
            this.historyIndex--;
            return false;
        }
    }
    
    /**
     * Clear history
     */
    clearHistory() {
        this.history = [];
        this.historyIndex = -1;
        this.executedOperations.clear();
        console.log('🗑️ History cleared');
    }
    
    /**
     * Extract node IDs affected by a command
     */
    extractNodeIds(command) {
        const nodeIds = [];
        
        switch (command.type) {
            case 'node_move':
                if (command.params.nodeId) {
                    nodeIds.push(command.params.nodeId);
                } else if (command.params.nodeIds) {
                    nodeIds.push(...command.params.nodeIds);
                }
                break;
                
            case 'node_create':
                // New nodes don't have dependencies
                break;
                
            case 'node_delete':
                if (command.params.nodeIds) {
                    nodeIds.push(...command.params.nodeIds);
                }
                break;
                
            case 'node_resize':
                if (command.params.nodeIds) {
                    nodeIds.push(...command.params.nodeIds);
                }
                break;
                
            case 'node_property_update':
                if (command.params.nodeId) {
                    nodeIds.push(command.params.nodeId);
                }
                break;
                
            case 'node_rotate':
                if (command.params.nodeId) {
                    nodeIds.push(command.params.nodeId);
                }
                break;
                
            case 'video_toggle':
                if (command.params.nodeId) {
                    nodeIds.push(command.params.nodeId);
                }
                break;
                
            case 'node_batch_property_update':
                if (command.params.updates) {
                    for (const update of command.params.updates) {
                        if (update.nodeId) {
                            nodeIds.push(update.nodeId);
                        }
                    }
                }
                break;
        }
        
        return nodeIds;
    }
    
    /**
     * Get history info
     */
    getHistoryInfo() {
        return {
            size: this.history.length,
            index: this.historyIndex,
            canUndo: this.historyIndex >= 0,
            canRedo: this.historyIndex < this.history.length - 1
        };
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.OperationPipeline = OperationPipeline;
}