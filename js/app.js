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
            
            // Load saved state
            await this.stateManager.loadState(this.graph, this.graphCanvas);
            
            // Initialize collaborative features (Phase 2)
            if (typeof CollaborativeManager !== 'undefined') {
                this.collaborativeManager = new CollaborativeManager(this);
                // Connect collaborative manager to canvas for operation broadcasting
                this.graphCanvas.collaborativeManager = this.collaborativeManager;
                console.log('🤝 Collaborative features initialized');
            } else {
                console.log('📱 Running in single-user mode (collaborative features not loaded)');
            }
            
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
        // Save state periodically
        this.autoSaveInterval = setInterval(() => {
            this.stateManager.saveState(this.graph, this.graphCanvas);
        }, 10000);
        
        // Save on page unload
        this.beforeUnloadHandler = () => {
            this.stateManager.saveState(this.graph, this.graphCanvas);
        };
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
    }
    
    setupCleanup() {
        this.cleanupHandler = () => {
            this.cleanup();
        };
        window.addEventListener('beforeunload', this.cleanupHandler);
    }
    
    cleanup() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }
        
        if (this.beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this.beforeUnloadHandler);
        }
        
        if (this.cleanupHandler) {
            window.removeEventListener('beforeunload', this.cleanupHandler);
        }
        
        if (this.graphCanvas) {
            this.graphCanvas.cleanup();
        }
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
    
    static createNode(type) {
        const NodeClass = this.nodeTypes.get(type);
        if (NodeClass) {
            return new NodeClass();
        }
        
        // Fallback for built-in types
        switch (type) {
            case 'media/image':
                return new ImageNode();
            case 'media/video':
                return new VideoNode();
            case 'media/text':
                return new TextNode();
            default:
                console.warn('Unknown node type:', type);
                return null;
        }
    }
    
    static registerNodeType(type, nodeClass) {
        this.nodeTypes.set(type, nodeClass);
        console.log('Registered node type:', type);
    }
}

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