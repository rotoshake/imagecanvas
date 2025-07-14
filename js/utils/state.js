// State management utilities
const StateManager = {
    STATE_KEY: 'litegraph_state',
    UNDO_STACK_KEY: 'litegraph_undo_stack',
    MAX_STATE_SIZE: 5 * 1024 * 1024, // 5MB limit
    MAX_UNDO_STATES: 5, // Reduce from 10 to 5 to save space
    
    // Simple compression: remove unnecessary whitespace and use shorter property names
    compressState: function(state) {
        const compressed = {
            n: state.nodes.map(node => ({
                i: node.id,
                t: node.type,
                p: node.pos,
                s: node.size,
                pr: node.properties,
                ti: node.title
            })),
            o: state.offset,
            sc: state.scale
        };
        return JSON.stringify(compressed);
    },
    
    // Decompress state data
    decompressState: function(compressedData) {
        const data = JSON.parse(compressedData);
        return {
            nodes: data.n.map(node => ({
                id: node.i,
                type: node.t,
                pos: node.p,
                size: node.s,
                properties: node.pr,
                title: node.ti
            })),
            offset: data.o,
            scale: data.sc
        };
    },
    
    // User notification for quota issues
    notifyQuotaIssue: function(message) {
        // Create a simple notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ff6b6b;
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            font-family: Arial, sans-serif;
            font-size: 14px;
            z-index: 10000;
            max-width: 300px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        // Remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
    },
    
    // Clean up old states to prevent quota issues
    cleanupOldStates: function() {
        try {
            // Clear old undo states if they exist
            const undoData = localStorage.getItem(this.UNDO_STACK_KEY);
            if (undoData) {
                const undoStack = JSON.parse(undoData);
                if (undoStack.length > this.MAX_UNDO_STATES) {
                    // Keep only the most recent states
                    const trimmedStack = undoStack.slice(-this.MAX_UNDO_STATES);
                    localStorage.setItem(this.UNDO_STACK_KEY, JSON.stringify(trimmedStack));
                }
            }
            
            // Check current state size
            const currentState = localStorage.getItem(this.STATE_KEY);
            if (currentState && currentState.length > this.MAX_STATE_SIZE) {
                console.warn('State size exceeds limit, clearing old data');
                // Clear everything and start fresh
                localStorage.removeItem(this.STATE_KEY);
                localStorage.removeItem(this.UNDO_STACK_KEY);
            }
        } catch (e) {
            console.error('Error during state cleanup:', e);
        }
    },
    
    // Save state with fallback mechanisms
    saveState: function(graph, canvas) {
        const state = {
            nodes: graph.nodes.map(node => ({
                id: node.id,
                type: node.type,
                pos: node.pos,
                size: node.size,
                // Only store hash and filename for images, never src
                properties: node.type === 'media/image'
                    ? { hash: node.properties.hash, filename: node.properties.filename }
                    : { ...node.properties },
                title: node.title
            })),
            offset: canvas.offset,
            scale: canvas.scale
        };
        // Debug: log all image node hashes on save
        const imageNodes = state.nodes.filter(n => n.type === 'media/image');
        console.debug('[State Save] image node hashes:', imageNodes.map(n => n.properties.hash));
        
        // Clean up before saving
        this.cleanupOldStates();
        
        try {
            // Try compressed version first
            const compressed = this.compressState(state);
            localStorage.setItem(this.STATE_KEY, compressed);
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                console.warn('Storage quota exceeded, attempting cleanup and retry');
                this.notifyQuotaIssue('Storage full - clearing old data to continue');
                // Try to save a minimal state without image data
                try {
                    const minimalState = {
                        nodes: graph.nodes.map(node => ({
                            id: node.id,
                            type: node.type,
                            pos: node.pos,
                            size: node.size,
                            properties: node.type === 'media/image'
                                ? { hash: node.properties.hash, filename: node.properties.filename }
                                : { ...node.properties },
                            title: node.title
                        })),
                        offset: canvas.offset,
                        scale: canvas.scale
                    };
                    const minimalCompressed = this.compressState(minimalState);
                    localStorage.setItem(this.STATE_KEY, minimalCompressed);
                    console.log('Saved minimal state (without image data)');
                    this.notifyQuotaIssue('Saved minimal state - images will be reloaded from cache');
                } catch (e2) {
                    console.error('Failed to save even minimal state:', e2);
                    // Clear everything and start fresh
                    localStorage.clear();
                    this.notifyQuotaIssue('Storage cleared - starting fresh');
                }
            } else {
                console.error('Failed to save state:', e);
            }
        }
    },
    
    loadState: function(graph, canvas, LiteGraph) {
        const saved = localStorage.getItem(this.STATE_KEY);
        if (!saved) return;
        
        try {
            let state;
            
            // Try to parse as compressed first
            try {
                state = this.decompressState(saved);
            } catch (e) {
                // Fall back to old format
                state = JSON.parse(saved);
            }
            
            // Debug: log all image node hashes on load
            const imageNodes = state.nodes.filter(n => n.type === 'media/image');
            console.debug('[State Load] image node hashes:', imageNodes.map(n => n.properties.hash));
            
            // Restore canvas state
            if (state.offset) canvas.offset = state.offset;
            if (state.scale) canvas.scale = state.scale;
            
            // Restore nodes
            state.nodes.forEach(nodeData => {
                const node = LiteGraph.createNode(nodeData.type);
                if (node) {
                    node.id = nodeData.id;
                    node.pos = nodeData.pos;
                    node.size = nodeData.size;
                    node.properties = nodeData.properties || {};
                    node.title = nodeData.title;
                    // If node has a hash, try to load image from cache
                    if (nodeData.type === "media/image" && nodeData.properties.hash) {
                        ImageCache.get(nodeData.properties.hash).then(dataURL => {
                            console.debug('[ImageCache.get] hash:', nodeData.properties.hash, 'result:', !!dataURL);
                            if (dataURL) {
                                node.setImage(dataURL, nodeData.properties.filename);
                            }
                        });
                    }
                    graph.add(node);
                }
            });
            
            graph.last_node_id = Math.max(...state.nodes.map(n => n.id), 0);
            
        } catch (e) {
            console.error('Failed to load state:', e);
            // Clear corrupted state
            localStorage.removeItem(this.STATE_KEY);
        }
    },
    
    // Save undo stack with compression
    saveUndoStack: function(undoStack) {
        try {
            const compressed = JSON.stringify(undoStack);
            localStorage.setItem(this.UNDO_STACK_KEY, compressed);
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                console.warn('Undo stack quota exceeded, clearing old states');
                this.notifyQuotaIssue('Undo history cleared due to storage limits');
                localStorage.removeItem(this.UNDO_STACK_KEY);
            } else {
                console.error('Failed to save undo stack:', e);
            }
        }
    },
    
    // Load undo stack
    loadUndoStack: function() {
        try {
            const saved = localStorage.getItem(this.UNDO_STACK_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error('Failed to load undo stack:', e);
            return [];
        }
    }
};