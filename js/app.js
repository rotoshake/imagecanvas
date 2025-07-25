// ===================================
// MAIN APPLICATION
// ===================================

class ImageCanvasApp {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.graph = new LGraph();
        this.graphCanvas = new LGraphCanvas(this.canvas, this.graph);
        this.dragDropManager = new DragDropManager(this.canvas, this.graph);
        this.stateManager = new StateManager();
        this.bulkOperationManager = new BulkOperationManager();
        this.backgroundSyncManager = null; // Will be initialized after network layer
        
        this.init();
    }
    
    async init() {
        console.log('Initializing Image Canvas App...');
        
        try {
            // Initialize caching systems
            await window.imageCache.init();
            window.thumbnailCache = new ThumbnailCache();
            
            // Initialize image resource cache for deduplication
            this.imageResourceCache = new ImageResourceCache();
            
            await this.stateManager.init();
            
            // Connect state manager to canvas
            this.graphCanvas.setStateManager(this.stateManager);
            
            // Initialize alignment system
            this.graphCanvas.alignmentManager = new AutoAlignmentManager(this.graphCanvas);
            
            // Register node types
            NodeFactory.registerNodeType('media/image', ImageNode);
            NodeFactory.registerNodeType('media/video', VideoNode);
            NodeFactory.registerNodeType('media/text', TextNode);
            
            // State will be loaded from server when joining a project
            // No local state loading needed with server-authoritative sync
            console.log('📥 State will be loaded from server');
            
            // Collaborative features are now handled by CollaborativeArchitecture
            // which is automatically initialized by AutoInit.js
            console.log('🤝 Collaborative features handled by new architecture');
            
            // Setup auto-save
            this.setupAutoSave();
            
            // Setup cleanup
            this.setupCleanup();
            
            console.log('Image Canvas App initialized successfully');
            this.logControls();
            
        } catch (error) {
            console.error('Failed to initialize app:', error);
        }
    }
    
    setupAutoSave() {
        // Auto-save disabled - server handles all persistence with state sync
        console.log('💾 Client-side auto-save disabled (server-authoritative mode)');
    }
    
    setupCleanup() {
        this.cleanupHandler = () => {
            this.cleanup();
        };
        window.addEventListener('beforeunload', this.cleanupHandler);
    }
    
    cleanup() {
        console.log('🧹 Cleaning up ImageCanvasApp...');
        
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }
        
        if (this.beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this.beforeUnloadHandler);
        }
        
        if (this.cleanupHandler) {
            window.removeEventListener('beforeunload', this.cleanupHandler);
        }
        
        // Clean up components
        if (this.graphCanvas) {
            this.graphCanvas.cleanup();
        }
        
        if (this.dragDropManager?.cleanup) {
            this.dragDropManager.cleanup();
        }
        
        
        if (this.networkLayer?.cleanup) {
            this.networkLayer.cleanup();
        }
        
        if (this.stateSyncManager?.cleanup) {
            this.stateSyncManager.cleanup();
        }
        
        if (this.operationPipeline?.cleanup) {
            this.operationPipeline.cleanup();
        }
        
        // Clear references
        this.graph = null;
        this.graphCanvas = null;
        this.dragDropManager = null;
        this.stateManager = null;
        this.networkLayer = null;
        this.stateSyncManager = null;
        this.operationPipeline = null;
    }
    
    logControls() {
        console.log('🎮 Controls:');
        console.log('- Drag & drop images/videos to add them');
        console.log('- Drag nodes to move them');
        console.log('- Alt+drag to duplicate a node');
        console.log('- Shift+click to multi-select');
        console.log('- Ctrl/Cmd+C to copy, Ctrl/Cmd+V to paste');
        console.log('- Ctrl/Cmd+D to duplicate selected');
        console.log('- Delete/Backspace to remove selected');
        console.log('- Drag resize handle (bottom-right) to resize');
        console.log('- Drag rotation handle to rotate');
        console.log('- Mouse wheel to zoom, drag empty space to pan');
        console.log('- = (plus) to zoom in 2x, - (minus) to zoom out 0.5x');
        console.log('- F to fit all/selection to view');
        console.log('- H to recenter and reset zoom');
        console.log('- T to create text node');
        console.log('- Shift+T to toggle title visibility');
        console.log('- [ ] to adjust layer order');
        console.log('- Double-click to edit titles/text');
        console.log('');
        console.log('🎯 Alignment Features:');
        console.log('- Shift+drag on empty space (with multi-selection) for auto-align');
        console.log('- Ctrl/Cmd+Shift+drag for grid alignment');
        console.log('- 1 key for horizontal alignment');
        console.log('- 2 key for vertical alignment');
        console.log('');
        console.log('🔧 Debug Commands:');
        console.log('- window.thumbnailCache.getStats() - show thumbnail cache stats');
        console.log('- window.imageCache - access image cache');
        console.log('- window.app - access main app instance');
        console.log('- window.lcanvas - access canvas instance');
        console.log('');
        console.log('🤝 Collaborative Features (Phase 2):');
        console.log('- Real-time multi-user editing with conflict resolution');
        console.log('- Live cursor and selection sharing');
        console.log('- Operational transformation for seamless collaboration');
        console.log('- Check the collaboration panel (top-right) for connection status');
    }
    
    /**
     * Show a notification to the user (using unified notification system)
     */
    showNotification(options) {
        if (window.unifiedNotifications) {
            const { type = 'info', message, duration = 3000, detail } = options;
            return window.unifiedNotifications.show({
                type,
                message,
                detail,
                duration
            });
        }
        
        // Fallback to simple notification if unified system not loaded
        console.log(`[${options.type || 'info'}] ${options.message}`);
    }
    
    /**
     * Update connection status (using unified notification system)
     */
    updateConnectionStatus(status, detail) {
        if (window.unifiedNotifications) {
            window.unifiedNotifications.updateConnectionStatus(status, detail);
        }
        console.log(`Connection status: ${status}${detail ? ' - ' + detail : ''}`);
    }
    
    /**
     * Create properties inspector toggle button
     */
    createPropertiesButton() {
        // Create button element
        this.propertiesBtn = document.createElement('button');
        this.propertiesBtn.className = 'properties-inspector-toggle';
        this.propertiesBtn.innerHTML = '<span class="icon">ⓘ</span>';
        this.propertiesBtn.title = 'Show/Hide Properties Inspector';
        
        // Add styles
        this.addPropertiesButtonStyles();
        
        // Add click handler
        this.propertiesBtn.addEventListener('click', () => {
            this.propertiesInspector.toggle();
            this.propertiesBtn.classList.toggle('active', this.propertiesInspector.isVisible);
        });
        
        // Add to DOM
        document.body.appendChild(this.propertiesBtn);
        
        console.log('✅ Properties inspector button created');
    }
    
    /**
     * Add styles for properties button
     */
    addPropertiesButtonStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Properties Inspector Toggle Button */
            .properties-inspector-toggle {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: #1e1e1e;
                border: 1px solid #333;
                color: #e0e0e0;
                padding: 6px;
                border-radius: 50%;
                cursor: pointer;
                font-size: 12px;
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
                z-index: 999;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            }
            
            .properties-inspector-toggle .icon {
                font-size: 14px;
                line-height: 1;
            }
            
            .properties-inspector-toggle:hover {
                background: #252525;
                border-color: #444;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                transform: translateY(-1px);
            }
            
            .properties-inspector-toggle.active {
                background: #333;
                border-color: #0066cc;
                box-shadow: 0 0 0 2px rgba(0, 102, 204, 0.2);
            }
            
            .properties-inspector-toggle:active {
                transform: translateY(0);
            }
            
            /* Responsive adjustments */
            @media (max-width: 768px) {
                .properties-inspector-toggle {
                    bottom: 15px;
                    right: 15px;
                    width: 18px;
                    height: 18px;
                    padding: 5px;
                }
                
                .properties-inspector-toggle .icon {
                    font-size: 12px;
                }
            }
        `;
        document.head.appendChild(style);
    }
}

// ===================================
// NODE FACTORY
// ===================================

class NodeFactory {
    static nodeTypes = new Map();
    
    static createNode(type, options = {}) {
        let node = null;
        
        // Get node class
        const NodeClass = this.nodeTypes.get(type);
        if (NodeClass) {
            node = new NodeClass();
        } else {
            // Fallback for built-in types
            switch (type) {
                case 'media/image':
                case 'canvas/image':
                case 'image':  // Legacy database type
                    node = new ImageNode();
                    break;
                case 'media/video':
                case 'canvas/video':
                case 'video':  // Legacy database type
                    node = new VideoNode();
                    break;
                case 'media/text':
                case 'canvas/text':
                case 'text':   // Legacy database type
                    node = new TextNode();
                    break;
                default:
                    console.warn('Unknown node type:', type);
                    return null;
            }
        }
        
        // Apply options if provided
        if (node && options) {
            if (options.id) node.id = options.id;
            if (options.pos) node.pos = [...options.pos];
            if (options.size) node.size = [...options.size];
            if (options.properties) {
                Object.assign(node.properties, options.properties);
            }
            if (options.flags) {
                Object.assign(node.flags, options.flags);
            }
            if (options.title) node.title = options.title;
            if (options.rotation !== undefined) node.rotation = options.rotation;
            if (options.aspectRatio !== undefined) node.aspectRatio = options.aspectRatio;
            
            // Do NOT automatically add to graph - let the caller handle it
            // This prevents double-adding and broadcast loops
        }
        
        return node;
    }
    
    static registerNodeType(type, nodeClass) {
        this.nodeTypes.set(type, nodeClass);
        console.log('Registered node type:', type);
    }
}

// Export NodeFactory globally
window.NodeFactory = NodeFactory;

// ===================================
// GLOBAL INSTANCES AND COMPATIBILITY
// ===================================

// Global instances
window.imageCache = new ImageCache();
window.thumbnailCache = new ThumbnailCache();
let app = null;

// Custom LiteGraph compatibility object
window.LiteGraph = {
    createNode: (type) => NodeFactory.createNode(type),
    registerNodeType: (type, nodeClass) => NodeFactory.registerNodeType(type, nodeClass)
};

// ===================================
// INITIALIZATION
// ===================================

async function initApp() {
    const canvasElement = document.getElementById('mycanvas');
    if (!canvasElement) {
        console.error('Canvas element not found');
        return;
    }
    
    try {
        app = new ImageCanvasApp(canvasElement);
        
        // Make app globally accessible for debugging
        window.app = app;
        window.lcanvas = app.graphCanvas;
        
        // Initialize Canvas Navigator
        app.canvasNavigator = new CanvasNavigator(app);
        window.canvasNavigator = app.canvasNavigator;
        
        // Initialize Image Upload Coordinator
        if (window.ImageUploadCoordinator) {
            app.imageUploadCoordinator = new ImageUploadCoordinator(app);
            console.log('✅ Image Upload Coordinator initialized');
        }
        
        // Initialize Floating Properties Inspector
        app.propertiesInspector = new FloatingPropertiesInspector(app.graphCanvas);
        window.propertiesInspector = app.propertiesInspector;
        
        // Create Properties Inspector Toggle Button
        app.createPropertiesButton();
        
        // Set up visibility sync between button and inspector
        app.propertiesInspector.setVisibilityCallback((isVisible) => {
            app.propertiesBtn.classList.toggle('active', isVisible);
        });
        
        // Initialize Navigation State Manager
        app.navigationStateManager = new NavigationStateManager(app);
        window.navigationStateManager = app.navigationStateManager;
        
        // Load last canvas or create default
        // Use more robust initialization that doesn't strictly depend on collaborative architecture
        setTimeout(() => {
            console.log('🚀 Preparing to load startup canvas...');
            
            let attempts = 0;
            const maxAttempts = 20; // 10 seconds max wait
            
            // Check if essential components are ready (with fallback)
            const checkAndLoad = () => {
                attempts++;
                
                // Check if we have the essential components needed for startup
                const hasEssentials = app.canvasNavigator && 
                                    (app.networkLayer || attempts > 10); // Allow fallback after 5 seconds
                
                const isArchitectureReady = app.collaborativeArchitecture?.initialized;
                
                if (isArchitectureReady || (hasEssentials && attempts > 6)) {
                    console.log('✅ Starting canvas load:', {
                        architectureReady: isArchitectureReady,
                        hasEssentials: hasEssentials,
                        attempts: attempts,
                        fallbackMode: !isArchitectureReady
                    });
                    
                    console.log('📊 Component status:', {
                        hasNetworkLayer: !!app.networkLayer,
                        isConnected: app.networkLayer?.isConnected,
                        hasStateSyncManager: !!app.stateSyncManager,
                        hasCanvasNavigator: !!app.canvasNavigator
                    });
                    
                    // Initialize NavigationStateManager if available
                    if (app.navigationStateManager) {
                        app.navigationStateManager.initialize();
                    }
                    
                    // Load startup canvas
                    if (app.canvasNavigator?.loadStartupCanvas) {
                        app.canvasNavigator.loadStartupCanvas().catch(error => {
                            console.error('❌ Failed to load startup canvas:', error);
                            // Continue anyway, user can manually open navigator
                        });
                    } else {
                        console.warn('⚠️ Canvas navigator not available for startup loading');
                    }
                    
                } else if (attempts >= maxAttempts) {
                    console.warn('⚠️ Startup loading timeout - proceeding without full initialization');
                    console.warn('User will need to manually select a canvas');
                    
                    // Still try to load if we have canvas navigator
                    if (app.canvasNavigator?.loadStartupCanvas) {
                        app.canvasNavigator.loadStartupCanvas().catch(error => {
                            console.error('❌ Fallback startup canvas load failed:', error);
                        });
                    }
                    
                } else {
                    console.log(`⏳ Waiting for components... (${attempts}/${maxAttempts})`);
                    setTimeout(checkAndLoad, 500);
                }
            };
            
            checkAndLoad();
        }, 500);
        
    } catch (error) {
        console.error('Failed to initialize application:', error);
    }
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// Handle errors gracefully
window.addEventListener('error', (event) => {
    console.error('Application error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    event.preventDefault();
});