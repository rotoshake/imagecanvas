/**
 * BulkCommand - Composite command that wraps multiple chunk operations
 * Ensures all chunks are undone/redone together
 */
class BulkCommand extends Command {
    constructor(operationType, chunks, params = {}) {
        super(`bulk_${operationType}`, params, 'local');
        this.operationType = operationType;
        this.chunks = chunks;
        this.chunkCommands = [];
        this.bulkOperationId = `bulk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    validate() {
        if (!this.chunks || this.chunks.length === 0) {
            return { valid: false, error: 'No chunks provided' };
        }
        return { valid: true };
    }
    
    async execute(context) {
        console.log(`🎯 Executing bulk ${this.operationType} with ${this.chunks.length} chunks`);
        
        const results = {
            success: true,
            nodes: [],
            errors: []
        };
        
        // Store undo data for all chunks
        this.undoData = {
            operationType: this.operationType,
            chunkCommands: []
        };
        
        // Process each chunk
        for (let i = 0; i < this.chunks.length; i++) {
            const chunk = this.chunks[i];
            console.log(`  Processing chunk ${i + 1}/${this.chunks.length} with ${chunk.items.length} items`);
            
            try {
                // Create command for this chunk
                const CommandClass = context.graph.canvas?.app?.operationPipeline?.commandRegistry?.get(this.operationType);
                if (!CommandClass) {
                    throw new Error(`Command class not found for ${this.operationType}`);
                }
                
                // Prepare chunk params
                const chunkParams = {
                    ...this.params,
                    _bulkOperationId: this.bulkOperationId,
                    _chunkIndex: i,
                    _totalChunks: this.chunks.length
                };
                
                // Add chunk-specific data
                if (this.operationType === 'node_paste') {
                    chunkParams.nodeData = chunk.items;
                } else if (this.operationType === 'node_duplicate') {
                    chunkParams.nodeIds = chunk.items;
                } else if (this.operationType === 'node_move') {
                    chunkParams.nodeIds = chunk.items.map(item => item.nodeId);
                    chunkParams.positions = chunk.items.map(item => item.position);
                } else if (this.operationType === 'node_delete') {
                    chunkParams.nodeIds = chunk.items;
                }
                
                // Create and execute chunk command
                const chunkCommand = new CommandClass(chunkParams, 'local');
                const chunkResult = await chunkCommand.execute(context);
                
                // Store the executed command for undo
                if (chunkCommand.undoData) {
                    this.undoData.chunkCommands.push({
                        command: chunkCommand,
                        undoData: chunkCommand.undoData
                    });
                }
                
                // Collect results
                if (chunkResult.nodes) {
                    results.nodes.push(...(Array.isArray(chunkResult.nodes) ? chunkResult.nodes : [chunkResult.nodes]));
                }
                if (chunkResult.node) {
                    results.nodes.push(chunkResult.node);
                }
                if (chunkResult.errors) {
                    results.errors.push(...chunkResult.errors);
                }
                
                // Store chunk command reference
                this.chunkCommands.push(chunkCommand);
                
            } catch (error) {
                console.error(`❌ Chunk ${i + 1} failed:`, error);
                results.errors.push({
                    chunk: i,
                    error: error.message,
                    items: chunk.items.length
                });
                results.success = false;
            }
        }
        
        this.executed = true;
        console.log(`✅ Bulk operation completed: ${results.nodes.length} nodes, ${results.errors.length} errors`);
        
        return {
            success: results.success,
            result: results
        };
    }
    
    async undo(context) {
        console.log(`↩️ Undoing bulk ${this.operationType} with ${this.undoData.chunkCommands.length} chunks`);
        
        if (!this.undoData || !this.undoData.chunkCommands) {
            throw new Error('No undo data available for bulk operation');
        }
        
        // Undo all chunks in reverse order
        for (let i = this.undoData.chunkCommands.length - 1; i >= 0; i--) {
            const { command, undoData } = this.undoData.chunkCommands[i];
            console.log(`  Undoing chunk ${i + 1}/${this.undoData.chunkCommands.length}`);
            
            try {
                // Restore the undo data to the command
                command.undoData = undoData;
                await command.undo(context);
            } catch (error) {
                console.error(`❌ Failed to undo chunk ${i + 1}:`, error);
                // Continue undoing other chunks
            }
        }
        
        return { success: true };
    }
    
    async redo(context) {
        console.log(`↪️ Redoing bulk ${this.operationType}`);
        
        // Simply re-execute
        return this.execute(context);
    }
    
    getDescription() {
        const totalItems = this.chunks.reduce((sum, chunk) => sum + chunk.items.length, 0);
        return `Bulk ${this.operationType} (${totalItems} items in ${this.chunks.length} chunks)`;
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.BulkCommand = BulkCommand;
}

// Also export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BulkCommand;
}