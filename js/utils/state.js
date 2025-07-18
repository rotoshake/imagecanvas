// ===================================
// STATE MANAGEMENT
// ===================================

class StateManager {
    constructor() {
        this.stateKey = CONFIG.STORAGE.STATE_KEY;
        this.undoStackKey = CONFIG.STORAGE.UNDO_STACK_KEY;
        this.maxUndoStates = CONFIG.STORAGE.MAX_UNDO_STATES;
        this.db = null;
        this.undoStack = [];
        this.redoStack = [];
        
        // Performance optimization: cache parsed states
        this.parsedStateCache = new Map();
        this.maxCacheSize = 5; // Keep last 5 states parsed
    }
    
    async init() {
        try {
            this.db = await this.openDB();
            this.undoStack = await this.loadUndoStack();
            console.log('State manager initialized with', this.undoStack.length, 'undo states');
        } catch (error) {
            console.warn('State database not available, using localStorage:', error);
            // Fallback: try to load from localStorage
            try {
                const saved = localStorage.getItem(this.undoStackKey);
                this.undoStack = saved ? JSON.parse(saved) : [];
            } catch (e) {
                console.warn('Failed to load undo stack from localStorage:', e);
                this.undoStack = [];
            }
        }
        
        // Ensure undoStack is always an array
        if (!Array.isArray(this.undoStack)) {
            this.undoStack = [];
        }
    }
    
    openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('ImageCanvasState', 1);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('state')) {
                    db.createObjectStore('state');
                }
            };
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    async saveState(graph, canvas) {
        const state = this.serializeState(graph, canvas);
        
        try {
            if (this.db) {
                await this.putToDB(this.stateKey, state);
            } else {
                localStorage.setItem(this.stateKey, JSON.stringify(state));
            }
        } catch (error) {
            console.warn('Failed to save state:', error);
            this.handleStorageError(error);
        }
    }
    
    async loadState(graph, canvas, externalState = null) {
        try {
            let state;
            
            if (externalState) {
                // Use provided state data
                state = externalState;
            } else if (this.db) {
                state = await this.getFromDB(this.stateKey);
            } else {
                const saved = localStorage.getItem(this.stateKey);
                state = saved ? JSON.parse(saved) : null;
            }
            
            if (state) {
                await this.deserializeState(state, graph, canvas);
            }
        } catch (error) {
            console.warn('Failed to load state:', error);
        }
    }
    
    serializeState(graph, canvas) {
        return {
            nodes: graph.nodes.map(node => ({
                id: node.id,
                type: node.type,
                pos: [...node.pos],
                size: [...node.size],
                aspectRatio: node.aspectRatio,
                rotation: node.rotation,
                properties: this.serializeProperties(node),
                flags: { ...node.flags },
                title: node.title
            })),
            viewport: {
                offset: [...canvas.viewport.offset],
                scale: canvas.viewport.scale
            },
            timestamp: Date.now()
        };
    }
    
    serializeUndoState(graph, canvas) {
        // Undo states don't include viewport - only node changes
        return {
            nodes: graph.nodes.map(node => ({
                id: node.id,
                type: node.type,
                pos: [...node.pos],
                size: [...node.size],
                aspectRatio: node.aspectRatio,
                rotation: node.rotation,
                properties: this.serializeProperties(node),
                flags: { ...node.flags },
                title: node.title
            })),
            timestamp: Date.now()
        };
    }
    
    serializeProperties(node) {
        if (node.type === 'media/image') {
            // Image nodes: store hash, filename, and any other properties
            return {
                hash: node.properties.hash,
                filename: node.properties.filename,
                serverFilename: node.properties.serverFilename,
                ...Object.fromEntries(
                    Object.entries(node.properties).filter(([key]) => 
                        !['hash', 'filename', 'serverFilename', 'src'].includes(key)
                    )
                )
            };
        } else if (node.type === 'media/video') {
            // Video nodes: store hash, filename, and all video properties (loop, muted, autoplay, paused, etc.)
            return {
                hash: node.properties.hash,
                filename: node.properties.filename,
                serverFilename: node.properties.serverFilename,
                loop: node.properties.loop,
                muted: node.properties.muted,
                autoplay: node.properties.autoplay,
                paused: node.properties.paused,
                ...Object.fromEntries(
                    Object.entries(node.properties).filter(([key]) => 
                        !['hash', 'filename', 'serverFilename', 'src'].includes(key)
                    )
                )
            };
        } else {
            // Text nodes and others: store all properties
            return { ...node.properties };
        }
    }
    
    async deserializeState(state, graph, canvas) {
        // Restore viewport
        if (state.viewport) {
            canvas.viewport.offset = [...state.viewport.offset];
            canvas.viewport.scale = state.viewport.scale;
            
            // Validate viewport values
            canvas.viewport.scale = Utils.clamp(
                canvas.viewport.scale,
                CONFIG.CANVAS.MIN_SCALE,
                CONFIG.CANVAS.MAX_SCALE
            );
        }
        
        // Efficient node restoration: preserve loaded media when possible
        await this.restoreNodesEfficiently(state.nodes, graph);
        
        graph.lastNodeId = Math.max(...state.nodes.map(n => n.id), 0);
        canvas.dirty_canvas = true;
    }
    
    async restoreNodesEfficiently(targetNodes, graph) {
        const startTime = performance.now();
        const currentNodes = new Map();
        const targetNodeMap = new Map();
        
        // Map current nodes by ID
        for (const node of graph.nodes) {
            currentNodes.set(node.id, node);
        }
        
        // Map target nodes by ID
        for (const nodeData of targetNodes) {
            targetNodeMap.set(nodeData.id, nodeData);
        }
        
        // Remove nodes that shouldn't exist
        for (const [id, node] of currentNodes) {
            if (!targetNodeMap.has(id)) {
                graph.remove(node);
            }
        }
        
        // Update existing nodes or create new ones
        for (const nodeData of targetNodes) {
            const existingNode = currentNodes.get(nodeData.id);
            
            if (existingNode && existingNode.type === nodeData.type) {
                // Update existing node (preserves media objects)
                this.updateExistingNode(existingNode, nodeData);
            } else {
                // Remove existing node with different type
                if (existingNode) {
                    graph.remove(existingNode);
                }
                
                // Create new node
                const newNode = NodeFactory.createNode(nodeData.type);
                if (newNode) {
                    newNode.id = nodeData.id;
                    this.applyNodeData(newNode, nodeData);
                    
                    // Load media content from cache
                    if ((nodeData.type === 'media/image' || nodeData.type === 'media/video') && nodeData.properties.hash) {
                        this.loadNodeFromCache(newNode, nodeData.type);
                    }
                    
                    graph.add(newNode);
                                 }
             }
         }
         
         const endTime = performance.now();
         console.log(`Efficient undo restoration took ${(endTime - startTime).toFixed(2)}ms for ${targetNodes.length} nodes`);
     }
    
    updateExistingNode(node, nodeData) {
        // Update all properties while preserving media objects
        node.pos = [...nodeData.pos];
        node.size = [...nodeData.size];
        node.aspectRatio = nodeData.aspectRatio || 1;
        node.rotation = nodeData.rotation || 0;
        node.flags = { ...nodeData.flags };
        node.title = nodeData.title;
        
        // Update properties carefully for media nodes
        if (node.type === 'media/image') {
            const oldHash = node.properties.hash;
            const newHash = nodeData.properties.hash;
            
            // Only reload media if hash changed
            if (oldHash !== newHash) {
                node.properties = { ...nodeData.properties };
                if (newHash) {
                    this.loadNodeFromCache(node, node.type);
                }
            } else {
                // Preserve existing media objects, just update other properties
                const mediaProperties = ['hash', 'filename', 'src'];
                for (const [key, value] of Object.entries(nodeData.properties)) {
                    if (!mediaProperties.includes(key)) {
                        node.properties[key] = value;
                    }
                }
                
                // Ensure media is still loaded (in case it was lost)
                if (newHash && !node.img) {
                    this.loadNodeFromCache(node, node.type);
                }
            }
        } else if (node.type === 'media/video') {
            const oldHash = node.properties.hash;
            const newHash = nodeData.properties.hash;
            
            // Only reload media if hash changed
            if (oldHash !== newHash) {
                node.properties = { ...nodeData.properties };
                if (newHash) {
                    this.loadNodeFromCache(node, node.type);
                }
            } else {
                // Preserve existing media objects, update all other properties including video controls
                const mediaProperties = ['hash', 'filename', 'src'];
                for (const [key, value] of Object.entries(nodeData.properties)) {
                    if (!mediaProperties.includes(key)) {
                        node.properties[key] = value;
                    }
                }
                
                // Apply video state changes
                if (node.video && typeof nodeData.properties.paused !== 'undefined') {
                    if (nodeData.properties.paused) {
                        node.video.pause();
                    } else if (!nodeData.properties.paused && node.video.paused) {
                        node.video.play().catch(() => {}); // Ignore autoplay restrictions
                    }
                }
                
                // Ensure media is still loaded (in case it was lost)
                if (newHash && !node.video) {
                    this.loadNodeFromCache(node, node.type);
                }
            }
        } else {
            // Non-media nodes (including text) can have properties replaced
            node.properties = { ...nodeData.properties };
        }
    }
    
    applyNodeData(node, nodeData) {
        node.pos = [...nodeData.pos];
        node.size = [...nodeData.size];
        node.aspectRatio = nodeData.aspectRatio || 1;
        node.rotation = nodeData.rotation || 0;
        node.properties = { ...nodeData.properties };
        node.flags = { ...nodeData.flags };
        node.title = nodeData.title;
    }
    
    async loadNodeFromCache(node, nodeType) {
        // Try memory cache first
        let cached = window.imageCache.get(node.properties.hash);
        
        if (!cached && window.imageCache.db) {
            // Try IndexedDB
            cached = await window.imageCache.getFromDB(node.properties.hash);
        }
        
        if (cached) {
            try {
                if (nodeType === 'media/video') {
                    await node.setVideo(cached, node.properties.filename, node.properties.hash);
                } else {
                    await node.setImage(cached, node.properties.filename, node.properties.hash);
                }
            } catch (error) {
                console.warn('Failed to load cached media:', error);
            }
        }
    }
    
    // Undo/Redo functionality
    pushUndoState(graph, canvas) {
        try {
            // Ensure undoStack exists
            if (!Array.isArray(this.undoStack)) {
                this.undoStack = [];
            }
            
            const state = this.serializeUndoState(graph, canvas); // Use undo-specific serialization
            const stateString = JSON.stringify(state);
            
            this.undoStack.push(stateString);
            
            if (this.undoStack.length > this.maxUndoStates) {
                this.undoStack.shift();
            }
            
            this.redoStack = []; // Clear redo stack when new operation is performed
            this.saveUndoStack();
            
            console.log('Pushed undo state, stack size:', this.undoStack.length);
        } catch (error) {
            console.warn('Failed to push undo state:', error);
        }
    }
    
    undo(graph, canvas) {
        if (!Array.isArray(this.undoStack) || this.undoStack.length < 2) {
            console.log('Nothing to undo');
            return false;
        }
        
        const current = this.undoStack.pop();
        if (!Array.isArray(this.redoStack)) {
            this.redoStack = [];
        }
        this.redoStack.push(current);
        
        const prev = this.undoStack[this.undoStack.length - 1];
        this.loadUndoState(prev, graph, canvas);
        this.saveUndoStack();
        
        console.log('Undo performed, stack size:', this.undoStack.length);
        return true;
    }
    
    redo(graph, canvas) {
        if (!Array.isArray(this.redoStack) || this.redoStack.length === 0) {
            console.log('Nothing to redo');
            return false;
        }
        
        const state = this.redoStack.pop();
        if (!Array.isArray(this.undoStack)) {
            this.undoStack = [];
        }
        this.undoStack.push(state);
        
        this.loadUndoState(state, graph, canvas);
        this.saveUndoStack();
        
        console.log('Redo performed, stack size:', this.undoStack.length);
        return true;
    }
    
    async loadUndoState(stateString, graph, canvas) {
        try {
            let state;
            
            // Check cache first
            if (this.parsedStateCache.has(stateString)) {
                state = this.parsedStateCache.get(stateString);
            } else {
                // Parse and cache
                state = JSON.parse(stateString);
                this.cacheState(stateString, state);
            }
            
            await this.deserializeState(state, graph, canvas);
        } catch (error) {
            console.error('Failed to load undo state:', error);
        }
    }
    
    cacheState(stateString, parsedState) {
        // Simple LRU: if cache is full, remove oldest
        if (this.parsedStateCache.size >= this.maxCacheSize) {
            const firstKey = this.parsedStateCache.keys().next().value;
            this.parsedStateCache.delete(firstKey);
        }
        
        this.parsedStateCache.set(stateString, parsedState);
    }
    
    async saveUndoStack() {
        try {
            if (this.db) {
                await this.putToDB(this.undoStackKey, this.undoStack);
            } else {
                localStorage.setItem(this.undoStackKey, JSON.stringify(this.undoStack));
            }
        } catch (error) {
            console.warn('Failed to save undo stack:', error);
        }
    }
    
    async loadUndoStack() {
        try {
            let undoStack;
            
            if (this.db) {
                undoStack = await this.getFromDB(this.undoStackKey);
            } else {
                const saved = localStorage.getItem(this.undoStackKey);
                undoStack = saved ? JSON.parse(saved) : null;
            }
            
            return undoStack || [];
        } catch (error) {
            console.warn('Failed to load undo stack:', error);
            return [];
        }
    }
    
    handleStorageError(error) {
        if (error.name === 'QuotaExceededError') {
            console.warn('Storage quota exceeded, attempting cleanup');
            this.cleanupStorage();
        }
    }
    
    cleanupStorage() {
        // Reduce undo stack size
        this.undoStack = this.undoStack.slice(-Math.floor(this.maxUndoStates / 2));
        this.saveUndoStack();
        
        // Clear old cache entries
        if (window.imageCache) {
            window.imageCache.clear();
        }
    }
    
    async putToDB(key, value) {
        if (!this.db) return;
        
        const transaction = this.db.transaction(['state'], 'readwrite');
        const store = transaction.objectStore('state');
        await store.put(value, key);
    }
    
    async getFromDB(key) {
        if (!this.db) return null;
        
        const transaction = this.db.transaction(['state'], 'readonly');
        const store = transaction.objectStore('state');
        const request = store.get(key);
        
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}