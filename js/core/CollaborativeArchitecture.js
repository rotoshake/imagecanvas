/**
 * CollaborativeArchitecture - Sets up the new collaborative system
 * This replaces the multiple competing systems with a single, clean architecture
 */
class CollaborativeArchitecture {
    constructor(app) {
        console.log('[STARTUP_TRACE] CollaborativeArchitecture constructor');
        this.app = app;
        this.initialized = false;
        
        // Core components
        this.operationPipeline = null;
        this.networkLayer = null;
        this.persistenceHandler = null;
        this.stateSyncManager = null;
        
        console.log('🏗️ CollaborativeArchitecture ready');
    }
    
    /**
     * Initialize the new architecture
     */
    initialize() {
        console.log('[STARTUP_TRACE] CollaborativeArchitecture.initialize started');
        
        // 1. Network Layer (must be first)
        this.networkLayer = new NetworkLayer(this.app);
        this.app.networkLayer = this.networkLayer;
        console.log('[STARTUP_TRACE] NetworkLayer created and assigned to app');
        
        // 2. Operation Pipeline
        this.operationPipeline = new OperationPipeline(this.app);
        this.app.operationPipeline = this.operationPipeline;
        
        // 3. State Sync Manager
        this.stateSyncManager = new StateSyncManager(this.app, this.networkLayer);
        this.app.stateSyncManager = this.stateSyncManager;
        
        // 4. Undo Manager
        this.undoManager = new ClientUndoManager(this.app);
        this.app.undoManager = this.undoManager;
        window.undoManager = this.undoManager; // Global access for debugging

        // 5. Transaction Manager
        this.transactionManager = new TransactionManager(this.undoManager);
        this.app.transactionManager = this.transactionManager;
        
        // 6. Persistence Handler
        this.persistenceHandler = new PersistenceHandler(this.app);
        this.app.persistenceHandler = this.persistenceHandler;
        
        // Finalize initialization
        this.networkLayer.initialize();
        this.initialized = true;

        console.log('[STARTUP_TRACE] CollaborativeArchitecture.initialize finished');
        return this.networkLayer; // Return the network layer instance
    }
    
    /**
     * Connect components together
     */
    async connectComponents() {
        // Ensure commands are loaded
        await this.loadCommands();
        
        // Connection status is now handled by unified notifications
        // updateConnectionStatus is already defined in app.js
        console.log('✅ Connection status handled by unified notifications');
        
        this.app.updateActiveUsers = (users) => {
            console.log(`Active users:`, users);
            // Update UI if needed
        };
        
        this.app.showError = (message) => {
            console.error(`Error: ${message}`);
            // Show error to user
        };
        
        this.app.handleStateSync = (state) => {
            console.log('Handling state sync:', state);
            // Implement state sync logic
        };
    }
    
    /**
     * Load command classes
     */
    async loadCommands() {
        // Commands might already be loaded via script tags
        if (typeof MoveNodeCommand === 'undefined') {
            console.log('Loading command classes...');
            
            // In a real implementation, you'd load these dynamically
            // For now, we assume they're loaded via script tags
        }
        
        // Register any additional commands
        this.registerCustomCommands();
    }
    
    /**
     * Register custom commands
     */
    registerCustomCommands() {
        // Ensure extended commands are registered
        if (this.operationPipeline && this.operationPipeline.registerExtendedCommands) {
            this.operationPipeline.registerExtendedCommands();
        }
        
        // Example: Register video toggle command
        class VideoToggleCommand extends Command {
            constructor(params, origin = 'local') {
                super('video_toggle', params, origin);
            }
            
            validate() {
                if (!this.params.nodeId) {
                    return { valid: false, error: 'Missing nodeId' };
                }
                return { valid: true };
            }
            
            async execute(context) {
                const node = context.graph.getNodeById(this.params.nodeId);
                if (!node || node.type !== 'media/video') {
                    throw new Error('Invalid video node');
                }
                
                // Store old state
                this.undoData = {
                    nodeId: node.id,
                    wasPaused: node.properties.paused
                };
                
                // Toggle state
                const newPaused = this.params.paused !== undefined ? 
                    this.params.paused : !node.properties.paused;
                
                node.properties.paused = newPaused;
                
                if (node.video) {
                    if (newPaused) {
                        node.video.pause();
                    } else {
                        node.video.play().catch(() => {});
                    }
                }
                
                return { node, paused: newPaused };
            }
            
            async undo(context) {
                const node = context.graph.getNodeById(this.undoData.nodeId);
                if (node && node.type === 'media/video') {
                    node.properties.paused = this.undoData.wasPaused;
                    
                    if (node.video) {
                        if (this.undoData.wasPaused) {
                            node.video.pause();
                        } else {
                            node.video.play().catch(() => {});
                        }
                    }
                }
                
                return { success: true };
            }
        }
        
        this.operationPipeline.registerCommand('video_toggle', VideoToggleCommand);
    }
    
    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        // The ClientUndoManager now handles all keyboard shortcuts
        // This method is kept for backward compatibility but does nothing
        // to prevent duplicate event handlers
        console.log('Keyboard shortcuts are now handled by ClientUndoManager');
    }
    
    /**
     * Show architecture status
     */
    showStatus() {
        const status = {
            pipeline: this.operationPipeline ? '✅' : '❌',
            network: this.networkLayer ? '✅' : '❌',
            persistence: this.persistenceHandler ? '✅' : '❌',
            stateSync: this.stateSyncManager ? '✅' : '❌',
            connected: this.networkLayer?.isConnected ? '✅' : '❌'
        };
        
        console.log('=== Architecture Status ===');
        console.log(`Pipeline: ${status.pipeline}`);
        console.log(`Network: ${status.network}`);
        console.log(`Persistence: ${status.persistence}`);
        console.log(`State Sync: ${status.stateSync}`);
        console.log(`Connected: ${status.connected}`);
        console.log('========================');
    }
    
    /**
     * Execute an operation through the new system
     */
    async executeOperation(type, params, options = {}) {
        if (!this.operationPipeline) {
            throw new Error('Architecture not initialized');
        }
        
        return this.operationPipeline.execute(type, params, options);
    }
    
    /**
     * Enable debug mode
     */
    enableDebugMode() {
        // Add debug UI
        this.addDebugUI();
    }
    
    /**
     * Add debug UI overlay
     */
    addDebugUI() {
        const debugDiv = document.createElement('div');
        debugDiv.id = 'collab-debug';
        debugDiv.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 10px;
            font-family: monospace;
            font-size: 12px;
            z-index: 10000;
            max-width: 300px;
        `;
        
        const updateDebug = () => {
            const history = this.operationPipeline.getHistoryInfo();
            const network = this.networkLayer.getStatus();
            
            debugDiv.innerHTML = `
                <h3 style="margin: 0 0 10px 0;">Collaborative Debug</h3>
                <div><strong>History:</strong></div>
                <div>Size: ${history.size} (${history.index + 1})</div>
                <div>Can Undo: ${history.canUndo ? '✅' : '❌'}</div>
                <div>Can Redo: ${history.canRedo ? '✅' : '❌'}</div>
                <hr style="margin: 10px 0;">
                <div><strong>Network:</strong></div>
                <div>Connected: ${network.connected ? '✅' : '❌'}</div>
                <div>Tab ID: ${network.tabId.substr(-8)}</div>
                <div>Project: ${network.project?.id || 'None'}</div>
            `;
        };
        
        document.body.appendChild(debugDiv);
        updateDebug();
        setInterval(updateDebug, 1000);
        
        // Add close button
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
            position: absolute;
            top: 5px;
            right: 5px;
            background: none;
            border: none;
            color: white;
            cursor: pointer;
        `;
        closeBtn.onclick = () => debugDiv.remove();
        debugDiv.appendChild(closeBtn);
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.CollaborativeArchitecture = CollaborativeArchitecture;
}