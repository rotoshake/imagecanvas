/**
 * PersistenceHandler - Handles saving and loading canvas state
 * Works with the new OperationPipeline architecture
 */

class PersistenceHandler {
    constructor(app) {
        this.app = app;
        this.autoSaveInterval = null;
        this.saveDebounceTimer = null;
        this.lastSaveTime = Date.now();
        this.hasUnsavedChanges = false;
        
        console.log('💾 PersistenceHandler initialized');
    }
    
    /**
     * Initialize auto-save functionality
     */
    initialize() {
        // Listen for operations to save immediately
        if (this.app.operationPipeline) {
            // Hook into operation execution
            const originalExecute = this.app.operationPipeline.execute.bind(this.app.operationPipeline);
            this.app.operationPipeline.execute = async (...args) => {
                const result = await originalExecute(...args);
                
                // Save immediately after successful operation
                if (result && result.success !== false) {
                    // Only save for local operations (not remote ones)
                    const command = args[0];
                    if (command && (command.origin === 'local' || command === 'local')) {
                        console.log(`💾 Auto-saving after operation: ${command.type || args[0]}`);
                        this.hasUnsavedChanges = true;
                        this.save(); // Save immediately
                    }
                }
                
                return result;
            };
        }
        
        // No need for periodic auto-save since we save on every action
        // Just keep as backup in case something was missed
        this.startAutoSave();
        
        // Save before unload
        window.addEventListener('beforeunload', () => {
            if (this.hasUnsavedChanges) {
                this.saveImmediate();
            }
        });
        
        console.log('✅ Persistence handler initialized (saves on every action)');
    }
    
    /**
     * Mark canvas as having unsaved changes
     */
    markAsUnsaved() {
        this.hasUnsavedChanges = true;
        // No debouncing - we save immediately on operations
    }
    
    /**
     * Save canvas state to server
     */
    async save() {
        if (!this.hasUnsavedChanges) {
            return true;
        }
        
        const canvasId = this.app.canvasNavigator?.currentCanvasId;
        if (!canvasId) {
            return false;
        }
        
        try {
            // Get current state
            const canvasData = this.app.stateManager.serializeState(
                this.app.graph, 
                this.app.graphCanvas
            );
            
            // Save to server (fire and forget for performance)
            fetch(CONFIG.ENDPOINTS.PROJECT_CANVAS(canvasId), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    canvas_data: canvasData,
                    userId: this.app.canvasNavigator?.userId || 1
                })
            }).then(response => {
                if (response.ok) {
                    console.log('💾 Saved');
                } else {
                    console.error('💾 Save failed:', response.status);
                }
            }).catch(error => {
                console.error('💾 Save error:', error.message);
            });
            
            this.hasUnsavedChanges = false;
            this.lastSaveTime = Date.now();
            
            return true;
            
        } catch (error) {
            console.error('❌ Failed to prepare save:', error);
            return false;
        }
    }
    
    /**
     * Save immediately (sync)
     */
    saveImmediate() {
        if (!this.hasUnsavedChanges) return;
        
        const canvasId = this.app.canvasNavigator?.currentCanvasId;
        if (!canvasId) return;
        
        try {
            const canvasData = this.app.stateManager.serializeState(
                this.app.graph, 
                this.app.graphCanvas
            );
            
            // Use sendBeacon for synchronous save on page unload
            const data = JSON.stringify({
                canvas_data: canvasData,
                userId: this.app.canvasNavigator?.userId || 1
            });
            
            navigator.sendBeacon(
                CONFIG.ENDPOINTS.PROJECT_CANVAS(canvasId),
                new Blob([data], { type: 'application/json' })
            );
            
            console.log('💾 Immediate save sent');
        } catch (error) {
            console.error('Failed to save immediately:', error);
        }
    }
    
    /**
     * Load canvas state from server
     */
    async load(canvasId) {
        try {
            console.log('📥 Loading canvas:', canvasId);
            
            const response = await fetch(CONFIG.ENDPOINTS.PROJECT_CANVAS(canvasId));
            if (!response.ok) {
                throw new Error(`Load failed: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.canvas_data) {
                // Clear current state
                this.app.graph.clear();
                
                // Load new state
                await this.app.stateManager.loadState(
                    this.app.graph,
                    this.app.graphCanvas,
                    data.canvas_data
                );
                
                console.log('✅ Canvas loaded successfully');
                this.hasUnsavedChanges = false;
                this.lastSaveTime = Date.now();
                
                return true;
            }
            
            return false;
            
        } catch (error) {
            console.error('❌ Failed to load canvas:', error);
            return false;
        }
    }
    
    /**
     * Start auto-save timer
     */
    startAutoSave() {
        this.stopAutoSave();
        
        // Save every 30 seconds if there are changes
        this.autoSaveInterval = setInterval(() => {
            if (this.hasUnsavedChanges) {
                this.save();
            }
        }, 30000);
        
        console.log('⏰ Auto-save started (every 30s)');
    }
    
    /**
     * Stop auto-save timer
     */
    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
        
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;
        }
    }
    
    /**
     * Get save status
     */
    getStatus() {
        return {
            hasUnsavedChanges: this.hasUnsavedChanges,
            lastSaveTime: this.lastSaveTime,
            timeSinceLastSave: Date.now() - this.lastSaveTime
        };
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.PersistenceHandler = PersistenceHandler;
}