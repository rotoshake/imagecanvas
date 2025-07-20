/**
 * CollaborativeArchitecture - Sets up the new collaborative system
 * This replaces the multiple competing systems with a single, clean architecture
 */
class CollaborativeArchitecture {
    constructor(app) {
        this.app = app;
        this.initialized = false;
        
        // Core components
        this.operationPipeline = null;
        this.networkLayer = null;
        this.migrationAdapter = null;
        
        console.log('🏗️ CollaborativeArchitecture ready');
    }
    
    /**
     * Initialize the new architecture
     */
    async initialize() {
        if (this.initialized) {
            console.log('Architecture already initialized');
            return;
        }
        
        try {
            console.log('🚀 Initializing new collaborative architecture...');
            
            // 1. Create Operation Pipeline
            this.operationPipeline = new OperationPipeline(this.app);
            this.app.operationPipeline = this.operationPipeline;
            
            // 2. Create Network Layer
            this.networkLayer = new NetworkLayer(this.app);
            this.app.networkLayer = this.networkLayer;
            
            // 3. Create Migration Adapter
            this.migrationAdapter = new MigrationAdapter(this.app);
            this.app.migrationAdapter = this.migrationAdapter;
            
            // 4. Connect components
            await this.connectComponents();
            
            // 5. Initialize migration adapter
            this.migrationAdapter.initialize();
            
            // 6. Connect to server
            try {
                await this.networkLayer.connect();
            } catch (error) {
                console.warn('Failed to connect to server:', error);
                // Continue in offline mode
            }
            
            // 7. Setup keyboard shortcuts for undo/redo
            this.setupKeyboardShortcuts();
            
            this.initialized = true;
            console.log('✅ New collaborative architecture initialized');
            
            // Show status
            this.showStatus();
            
        } catch (error) {
            console.error('Failed to initialize architecture:', error);
            throw error;
        }
    }
    
    /**
     * Connect components together
     */
    async connectComponents() {
        // Ensure commands are loaded
        await this.loadCommands();
        
        // Connect app callbacks
        this.app.updateConnectionStatus = (status) => {
            console.log(`Connection status: ${status}`);
            // Update UI if needed
        };
        
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
        document.addEventListener('keydown', (e) => {
            // Undo: Ctrl/Cmd + Z
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.operationPipeline.undo();
            }
            
            // Redo: Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y
            else if (((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) ||
                     ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
                e.preventDefault();
                this.operationPipeline.redo();
            }
        });
    }
    
    /**
     * Show architecture status
     */
    showStatus() {
        const status = {
            pipeline: this.operationPipeline ? '✅' : '❌',
            network: this.networkLayer ? '✅' : '❌',
            migration: this.migrationAdapter ? '✅' : '❌',
            connected: this.networkLayer?.isConnected ? '✅' : '❌'
        };
        
        console.log('=== Architecture Status ===');
        console.log(`Pipeline: ${status.pipeline}`);
        console.log(`Network: ${status.network}`);
        console.log(`Migration: ${status.migration}`);
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
     * Get migration statistics
     */
    getMigrationStats() {
        return this.migrationAdapter?.getStats() || null;
    }
    
    /**
     * Enable debug mode
     */
    enableDebugMode() {
        this.migrationAdapter?.enableDebugLogging();
        
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
            const stats = this.getMigrationStats();
            const history = this.operationPipeline.getHistoryInfo();
            const network = this.networkLayer.getStatus();
            
            debugDiv.innerHTML = `
                <h3 style="margin: 0 0 10px 0;">Collaborative Debug</h3>
                <div><strong>Migration Stats:</strong></div>
                <div>Intercepted: ${stats?.intercepted || 0}</div>
                <div>Routed: ${stats?.routed || 0}</div>
                <div>Failed: ${stats?.failed || 0}</div>
                <div>Success: ${stats?.successRate || 'N/A'}</div>
                <hr style="margin: 10px 0;">
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