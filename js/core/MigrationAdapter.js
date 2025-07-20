/**
 * MigrationAdapter - Allows gradual migration from old system to new architecture
 * Intercepts old system calls and routes them through the new pipeline
 */
class MigrationAdapter {
    constructor(app) {
        this.app = app;
        this.originalMethods = {};
        this.migrationStats = {
            intercepted: 0,
            routed: 0,
            failed: 0
        };
        
        console.log('🔄 MigrationAdapter initialized');
    }
    
    /**
     * Initialize the adapter - intercept old system methods
     */
    initialize() {
        // Intercept ActionManager methods
        if (this.app.actionManager) {
            this.interceptActionManager();
        }
        
        // Intercept direct broadcast methods
        if (this.app.graphCanvas) {
            this.interceptCanvasBroadcasts();
        }
        
        // Intercept collaborative manager methods
        if (this.app.collaborativeManager) {
            this.interceptCollaborativeManager();
        }
        
        console.log('✅ Migration adapter ready');
    }
    
    /**
     * Intercept ActionManager.executeAction
     */
    interceptActionManager() {
        const actionManager = this.app.actionManager;
        this.originalMethods.executeAction = actionManager.executeAction.bind(actionManager);
        
        actionManager.executeAction = async (type, params, options = {}) => {
            console.log(`🔀 Intercepted ActionManager.executeAction: ${type}`);
            this.migrationStats.intercepted++;
            
            try {
                // Route through new pipeline
                const result = await this.app.operationPipeline.execute(type, params, {
                    origin: options.fromRemote ? 'remote' : 'local',
                    skipBroadcast: options.fromRemote
                });
                
                this.migrationStats.routed++;
                return result;
                
            } catch (error) {
                console.error('Migration failed, falling back to original:', error);
                this.migrationStats.failed++;
                
                // Fallback to original method
                return this.originalMethods.executeAction(type, params, options);
            }
        };
    }
    
    /**
     * Intercept canvas broadcast methods
     */
    interceptCanvasBroadcasts() {
        const canvas = this.app.graphCanvas;
        const broadcastMethods = [
            'broadcastNodeMove',
            'broadcastNodeResize',
            'broadcastNodeCreate',
            'broadcastNodeDelete',
            'broadcastNodePropertyUpdate',
            'broadcastVideoToggle',
            'broadcastLayerOrderChange'
        ];
        
        broadcastMethods.forEach(method => {
            if (typeof canvas[method] === 'function') {
                this.originalMethods[method] = canvas[method].bind(canvas);
                
                canvas[method] = (...args) => {
                    console.log(`🔀 Intercepted ${method}`);
                    this.migrationStats.intercepted++;
                    
                    // Convert to command and execute
                    try {
                        const command = this.convertBroadcastToCommand(method, args);
                        if (command) {
                            this.app.operationPipeline.execute(
                                command.type,
                                command.params,
                                { origin: 'local' }
                            ).then(() => {
                                this.migrationStats.routed++;
                            }).catch(error => {
                                console.error('Failed to route broadcast:', error);
                                this.migrationStats.failed++;
                            });
                            
                            // Don't call original - we're handling it
                            return;
                        }
                    } catch (error) {
                        console.error('Failed to convert broadcast:', error);
                    }
                    
                    // Fallback to original
                    this.migrationStats.failed++;
                    return this.originalMethods[method](...args);
                };
            }
        });
    }
    
    /**
     * Convert broadcast method calls to commands
     */
    convertBroadcastToCommand(method, args) {
        switch (method) {
            case 'broadcastNodeMove':
                // broadcastNodeMove(nodeId, x, y) or (nodes array)
                if (Array.isArray(args[0])) {
                    const nodes = args[0];
                    return {
                        type: 'node_move',
                        params: {
                            nodeIds: nodes.map(n => n.id),
                            positions: nodes.map(n => [...n.pos])
                        }
                    };
                } else {
                    return {
                        type: 'node_move',
                        params: {
                            nodeId: args[0],
                            position: [args[1], args[2]]
                        }
                    };
                }
                
            case 'broadcastNodeCreate':
                // broadcastNodeCreate(nodeData)
                const nodeData = args[0];
                return {
                    type: 'node_create',
                    params: {
                        id: nodeData.id,
                        type: nodeData.type,
                        pos: nodeData.pos,
                        size: nodeData.size,
                        properties: nodeData.properties,
                        imageData: nodeData.imageData,
                        videoData: nodeData.videoData
                    }
                };
                
            case 'broadcastNodeDelete':
                // broadcastNodeDelete(nodeIds)
                return {
                    type: 'node_delete',
                    params: {
                        nodeIds: args[0]
                    }
                };
                
            case 'broadcastNodePropertyUpdate':
                // broadcastNodePropertyUpdate(nodeId, property, value)
                return {
                    type: 'node_property_update',
                    params: {
                        nodeId: args[0],
                        property: args[1],
                        value: args[2]
                    }
                };
                
            default:
                console.warn(`No conversion for ${method}`);
                return null;
        }
    }
    
    /**
     * Intercept CollaborativeManager methods
     */
    interceptCollaborativeManager() {
        const collabManager = this.app.collaborativeManager;
        
        // Intercept sendOperation
        if (collabManager.sendOperation) {
            this.originalMethods.sendOperation = collabManager.sendOperation.bind(collabManager);
            
            collabManager.sendOperation = (type, data) => {
                console.log(`🔀 Intercepted sendOperation: ${type}`);
                this.migrationStats.intercepted++;
                
                // Don't send - let the new pipeline handle broadcasting
                console.log('Blocked direct sendOperation - handled by pipeline');
            };
        }
        
        // Intercept applyRemoteOperation
        if (collabManager.applyRemoteOperation) {
            this.originalMethods.applyRemoteOperation = collabManager.applyRemoteOperation.bind(collabManager);
            
            collabManager.applyRemoteOperation = async (operation) => {
                console.log(`🔀 Intercepted applyRemoteOperation: ${operation.type}`);
                this.migrationStats.intercepted++;
                
                try {
                    // Route through new pipeline
                    const result = await this.app.operationPipeline.execute(
                        operation.type,
                        operation.data,
                        { 
                            origin: 'remote',
                            skipBroadcast: true,
                            skipHistory: true
                        }
                    );
                    
                    this.migrationStats.routed++;
                    return result;
                    
                } catch (error) {
                    console.error('Failed to route remote operation:', error);
                    this.migrationStats.failed++;
                    
                    // Fallback to original
                    return this.originalMethods.applyRemoteOperation(operation);
                }
            };
        }
    }
    
    /**
     * Restore original methods (for testing or rollback)
     */
    restore() {
        // Restore ActionManager
        if (this.app.actionManager && this.originalMethods.executeAction) {
            this.app.actionManager.executeAction = this.originalMethods.executeAction;
        }
        
        // Restore canvas broadcasts
        if (this.app.graphCanvas) {
            Object.keys(this.originalMethods).forEach(method => {
                if (method.startsWith('broadcast') && this.app.graphCanvas[method]) {
                    this.app.graphCanvas[method] = this.originalMethods[method];
                }
            });
        }
        
        // Restore collaborative manager
        if (this.app.collaborativeManager) {
            if (this.originalMethods.sendOperation) {
                this.app.collaborativeManager.sendOperation = this.originalMethods.sendOperation;
            }
            if (this.originalMethods.applyRemoteOperation) {
                this.app.collaborativeManager.applyRemoteOperation = this.originalMethods.applyRemoteOperation;
            }
        }
        
        console.log('🔄 Migration adapter restored original methods');
    }
    
    /**
     * Get migration statistics
     */
    getStats() {
        const successRate = this.migrationStats.routed / (this.migrationStats.intercepted || 1) * 100;
        
        return {
            ...this.migrationStats,
            successRate: successRate.toFixed(2) + '%'
        };
    }
    
    /**
     * Enable debug logging
     */
    enableDebugLogging() {
        // Log all pipeline executions
        const originalExecute = this.app.operationPipeline.execute;
        this.app.operationPipeline.execute = async (...args) => {
            console.group(`🔍 Pipeline Execution`);
            console.log('Args:', args);
            
            try {
                const result = await originalExecute.apply(this.app.operationPipeline, args);
                console.log('Result:', result);
                console.groupEnd();
                return result;
            } catch (error) {
                console.error('Error:', error);
                console.groupEnd();
                throw error;
            }
        };
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.MigrationAdapter = MigrationAdapter;
}