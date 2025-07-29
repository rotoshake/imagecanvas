/**
 * OperationPersistence - Server-based persistence using operations
 * 
 * Instead of saving/loading entire canvas state, this treats the server
 * as the source of truth by:
 * 1. Sending every operation to the server
 * 2. Loading canvas by replaying operations
 * 3. Ensuring consistency across all clients
 */

class OperationPersistence {
    constructor(app) {
        this.app = app;
        this.initialized = false;
        
        console.log('🔄 OperationPersistence initialized');
    }
    
    /**
     * Initialize the persistence system
     */
    initialize() {
        if (this.initialized) return;
        
        // Hook into the operation pipeline to ensure all operations go through network
        if (this.app.operationPipeline && this.app.networkLayer) {
            const originalExecute = this.app.operationPipeline.execute.bind(this.app.operationPipeline);
            
            this.app.operationPipeline.execute = async (commandOrType, params, options = {}) => {
                // Execute locally first
                const result = await originalExecute(commandOrType, params, options);
                
                // If successful and local operation, ensure it's broadcast
                if (result && result.success !== false && !options.skipBroadcast) {
                    const command = typeof commandOrType === 'string' 
                        ? this.app.operationPipeline.createCommand(commandOrType, params, 'local')
                        : commandOrType;
                    
                    if (command.origin === 'local') {
                        // Broadcast to server (which will persist and relay to others)
                        this.app.networkLayer.broadcast(command);
                    }
                }
                
                return result;
            };
        }
        
        this.initialized = true;
    }
    
    /**
     * Load canvas by requesting operation history from server
     */
    async loadCanvas(canvasId) {
        if (!this.app.networkLayer?.isConnected) {
            console.error('Cannot load canvas: not connected');
            return false;
        }
        
        console.log(`📥 Loading canvas ${canvasId} from server...`);
        
        // Clear current state
        this.app.graph.clear();
        
        // Request operation history
        return new Promise((resolve) => {
            // Set up one-time listener for operation history
            const historyHandler = async (data) => {
                this.app.networkLayer.socket.off('operation_history', historyHandler);
                
                if (data.operations && Array.isArray(data.operations)) {
                    console.log(`📥 Received ${data.operations.length} operations`);
                    
                    // Replay operations in order
                    for (const op of data.operations) {
                        try {
                            await this.app.operationPipeline.execute(
                                op.type,
                                op.data,
                                { 
                                    origin: 'remote', 
                                    skipBroadcast: true,
                                    skipHistory: true 
                                }
                            );
                        } catch (error) {
                            console.error(`Failed to replay operation ${op.type}:`, error);
                        }
                    }
                    
                    console.log('✅ Canvas loaded from operation history');
                    resolve(true);
                } else {
                    console.log('📭 No operations found for canvas');
                    resolve(true);
                }
            };
            
            this.app.networkLayer.socket.on('operation_history', historyHandler);
            
            // Request history
            this.app.networkLayer.socket.emit('request_operation_history', {
                projectId: canvasId
            });
            
            // Timeout after 5 seconds
            setTimeout(() => {
                this.app.networkLayer.socket.off('operation_history', historyHandler);
                resolve(false);
            }, 5000);
        });
    }
    
    /**
     * No need for save - operations are persisted as they happen
     */
    save() {
        // No-op - operations are already persisted
        return Promise.resolve(true);
    }
}