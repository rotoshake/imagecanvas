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
        
        this.init();
    }
    
    async init() {
        console.log('Initializing Image Canvas App...');
        
        try {
            // Initialize caching systems
            await window.imageCache.init();
            window.thumbnailCache = new ThumbnailCache();
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
                    node = new ImageNode();
                    break;
                case 'media/video':
                case 'canvas/video':
                    node = new VideoNode();
                    break;
                case 'media/text':
                case 'canvas/text':
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
        
        // Initialize Floating Properties Inspector
        app.propertiesInspector = new FloatingPropertiesInspector(app.graphCanvas);
        window.propertiesInspector = app.propertiesInspector;
        
        // Load last canvas or create default
        // Wait for network connection and architecture initialization
        setTimeout(() => {
            console.log('🚀 Preparing to load startup canvas...');
            
            // Check if collaborative architecture is ready
            const checkAndLoad = () => {
                if (app.collaborativeArchitecture?.initialized) {
                    console.log('✅ Collaborative architecture ready');
                    console.log('📊 Network status:', {
                        hasNetworkLayer: !!app.networkLayer,
                        isConnected: app.networkLayer?.isConnected,
                        hasStateSyncManager: !!app.stateSyncManager
                    });
                    app.canvasNavigator.loadStartupCanvas();
                } else {
                    console.log('⏳ Waiting for collaborative architecture...');
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