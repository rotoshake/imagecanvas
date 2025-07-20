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
        
        // Register built-in commands
        this.registerBuiltinCommands();
        
        console.log('🚀 OperationPipeline initialized');
    }
    
    /**
     * Register built-in commands
     */
    registerBuiltinCommands() {
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
        const CommandClass = this.commandRegistry.get(type);
        if (!CommandClass) {
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
            command = this.createCommand(commandOrType, params, options.origin || 'local');
        } else {
            command = commandOrType;
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
     * Process the execution queue
     */
    async processQueue() {
        if (this.executing || this.executionQueue.length === 0) return;
        
        this.executing = true;
        const { command, resolve, reject, options } = this.executionQueue.shift();
        
        try {
            console.log(`⚡ Executing ${command.origin} command: ${command.type}`, command.params);
            
            // Execute command
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
            
            // Broadcast (local commands only)
            if (command.origin === 'local' && this.app.networkLayer?.isConnected && !options.skipBroadcast) {
                this.app.networkLayer.broadcast(command);
            }
            
            // Mark canvas dirty
            if (this.app.graphCanvas) {
                this.app.graphCanvas.dirty_canvas = true;
            }
            
            resolve({ success: true, result });
            
        } catch (error) {
            console.error(`❌ Command execution failed:`, error);
            reject(error);
        } finally {
            this.executing = false;
            
            // Process next command
            if (this.executionQueue.length > 0) {
                // Small delay to prevent blocking UI
                setTimeout(() => this.processQueue(), 0);
            }
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