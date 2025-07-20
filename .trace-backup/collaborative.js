/**
 * Fixed Collaborative Manager - Supports multiple tabs properly
 * Key fixes:
 * 1. Unique tab IDs that persist across reconnections
 * 2. Proper session management
 * 3. No blocking between tabs of same user
 */
class CollaborativeManager {
    constructor(app) {
        this.app = app;
        this.graph = app.graph;
        this.resourceManager = app.resourceManager;
        this.errorBoundary = app.errorBoundary;
        
        // Connection state
        this.socket = null;
        this.isConnected = false;
        this.currentProject = null;
        this.currentUser = null;
        
        // Generate persistent tab ID
        if (!window.__imageCanvasTabId) {
            window.__imageCanvasTabId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        }
        this.tabId = window.__imageCanvasTabId;
        
        // Session management
        this._hasValidSession = false;
        this.sequenceNumber = 0;
        
        // Operation tracking
        this.pendingOperations = new Map();
        this.appliedOperations = new Set();
        
        // Flag to prevent circular broadcasts when applying remote operations
        this._isApplyingRemoteOp = false;
        
        // Initialize UnifiedOperationHandler for centralized operation handling
        this.operationHandler = null;
        this.transactionManager = null;
        
        // UI elements
        this.statusElement = null;
        this.userListElement = null;
        
        // Timers
        this.syncTimer = null;
        this.reconnectTimer = null;
        
        console.log(`🚀 CollaborativeManager initialized with tab ID: ${this.tabId}`);
    }
    
    async initialize() {
        try {
            // Setup UI
            this.setupUI();
            
            // Initialize UnifiedOperationHandler and TransactionManager
            if (typeof UnifiedOperationHandler !== 'undefined') {
                this.operationHandler = new UnifiedOperationHandler(this.app);
                console.log('✅ UnifiedOperationHandler initialized');
                
                if (typeof TransactionManager !== 'undefined') {
                    this.transactionManager = new TransactionManager(this.operationHandler);
                    this.operationHandler.setTransactionManager(this.transactionManager);
                    console.log('✅ TransactionManager initialized');
                }
            }
            
            // Connect to server
            await this.connect();
            
            // Setup operation handlers
            this.setupOperationHandlers();
            
            console.log('✅ Collaborative features initialized');
            
        } catch (error) {
            console.error('Failed to initialize collaborative features:', error);
            this.showStatus('Offline mode', 'warning');
        }
    }
    
    setupOperationHandlers() {
        // Placeholder for operation handler setup
        // This will be where you integrate with the existing action system
        console.log('🔧 Operation handlers setup');
        
        // Don't auto-join - let the canvas navigator handle project joining
        // when it loads a specific canvas
    }
    
    async connect() {
        return new Promise((resolve, reject) => {
            try {
                // Connect to Socket.IO server
                this.socket = io('http://localhost:3000', {
                    transports: ['websocket'],
                    reconnection: true,
                    reconnectionDelay: 1000,
                    reconnectionDelayMax: 5000,
                    reconnectionAttempts: Infinity
                });
                
                this.setupSocketHandlers();
                
                // Wait for connection
                this.socket.on('connect', () => {
                    console.log('✅ Connected to collaboration server');
                    this.isConnected = true;
                    this.showStatus('Connected', 'success');
                    resolve();
                });
                
                this.socket.on('connect_error', (error) => {
                    console.error('Connection error:', error);
                    this.showStatus('Connection failed', 'error');
                    reject(error);
                });
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    setupSocketHandlers() {
        // Connection events
        this.socket.on('connect', () => {
            this.isConnected = true;
            this.showStatus('Connected', 'success');
            
            // Rejoin project if we were in one
            if (this.currentProject && !this._hasValidSession) {
                console.log('🔄 Reconnected - rejoining project...');
                this.rejoinProject();
            }
        });
        
        this.socket.on('disconnect', () => {
            this.isConnected = false;
            this._hasValidSession = false;
            this.showStatus('Disconnected', 'error');
            this.stopPeriodicSync();
        });
        
        // Project events
        this.socket.on('project_joined', (data) => {
            this.handleProjectJoined(data);
        });
        
        this.socket.on('active_users', (users) => {
            this.handleActiveUsers(users);
        });
        
        this.socket.on('user_joined', (user) => {
            this.handleUserJoined(user);
        });
        
        this.socket.on('user_left', (user) => {
            this.handleUserLeft(user);
        });
        
        this.socket.on('tab_closed', (data) => {
            console.log(`📱 Tab closed: ${data.tabId} for user ${data.userId}`);
        });
        
        // Canvas operations
        this.socket.on('canvas_operation', (data) => {
            this.handleRemoteOperation(data);
        });
        
        this.socket.on('sync_response', (data) => {
            this.handleSyncResponse(data);
        });
        
        // Media upload events
        this.socket.on('media_uploaded', (data) => {
            this.handleRemoteMediaUpload(data);
        });
        
        // State sharing
        this.socket.on('request_project_state', (data) => {
            this.handleStateRequest(data);
        });
        
        this.socket.on('project_state', (state) => {
            this.handleProjectState(state);
        });
        
        // Error handling
        this.socket.on('error', (error) => {
            this.handleServerError(error);
        });
    }
    
    async joinProject(projectId) {
        if (!this.isConnected) {
            console.warn('⚠️ Cannot join project - not connected');
            return false;
        }
        
        // Clear any existing session
        this._hasValidSession = false;
        this.stopPeriodicSync();
        
        // Generate username
        const baseUsername = localStorage.getItem('imagecanvas_username') || 'User';
        const username = `${baseUsername}-${this.tabId.split('-')[0]}`;
        
        console.log(`🎯 Joining project ${projectId} as ${username} (tab: ${this.tabId})`);
        
        return new Promise((resolve) => {
            // Set up one-time handlers
            const handleJoined = (data) => {
                this.socket.off('project_joined', handleJoined);
                this.socket.off('error', handleError);
                resolve(true);
            };
            
            const handleError = (error) => {
                this.socket.off('project_joined', handleJoined);
                this.socket.off('error', handleError);
                console.error('Failed to join project:', error);
                resolve(false);
            };
            
            this.socket.once('project_joined', handleJoined);
            this.socket.once('error', handleError);
            
            // Send join request
            this.socket.emit('join_project', {
                projectId: projectId,
                username: username,
                displayName: baseUsername,
                tabId: this.tabId
            });
            
            // Timeout after 5 seconds
            setTimeout(() => {
                this.socket.off('project_joined', handleJoined);
                this.socket.off('error', handleError);
                resolve(false);
            }, 5000);
        });
    }
    
    handleProjectJoined(data) {
        console.log('🎉 Successfully joined project:', data.project.name);
        
        this.currentProject = data.project;
        this.currentUser = data.session;
        this.sequenceNumber = data.sequenceNumber || 0;
        this._hasValidSession = true;
        
        // Update UI
        this.showStatus(`Joined: ${data.project.name}`, 'success');
        
        // Start periodic sync
        this.startPeriodicSync();
        
        // Enable collaborative features
        this.enableCollaborativeFeatures();
    }
    
    handleActiveUsers(users) {
        console.log('👥 Active users updated:', users);
        this.updateUserList(users);
    }
    
    handleUserJoined(user) {
        console.log(`👋 ${user.username} joined`);
        this.showStatus(`${user.displayName} joined`, 'info');
    }
    
    handleUserLeft(user) {
        console.log(`👋 ${user.username} left`);
        this.showStatus(`${user.displayName} left`, 'info');
    }
    
    handleRemoteOperation(data) {
        const { operation, fromUserId, fromTabId, fromSocketId } = data;
        
        // Skip if this is our own operation echoed back
        if (fromSocketId === this.socket.id) {
            console.log('📥 Skipping own operation echo');
            return;
        }
        
        // Skip if we already applied this operation
        const opId = `${operation.sequence}-${operation.type}`;
        if (this.appliedOperations.has(opId)) {
            console.log('📥 Skipping duplicate operation:', opId);
            return;
        }
        
        console.log(`📥 Remote operation from ${fromTabId}:`, operation.type);
        
        // Apply the operation
        this.applyRemoteOperation(operation);
        
        // Track that we applied it
        this.appliedOperations.add(opId);
        
        // Update sequence number
        if (operation.sequence > this.sequenceNumber) {
            this.sequenceNumber = operation.sequence;
        }
    }
    
    async broadcastOperation(operationType, operationData) {
        // Skip if we're applying a remote operation
        if (this._isApplyingRemoteOp) {
            console.log('⏭️ Skipping broadcast - applying remote operation');
            return;
        }
        
        if (!this._hasValidSession) {
            console.warn('⚠️ Cannot broadcast - no valid session');
            return;
        }
        
        // Direct broadcast - DO NOT use UnifiedOperationHandler here
        // to avoid infinite loops. The operation has already been executed locally.
        const operation = {
            type: operationType,
            data: operationData,
            timestamp: Date.now(),
            sequence: this.sequenceNumber // Server will assign actual sequence
        };
        
        // Send to server (this already saves to database via handleCanvasOperation)
        this.socket.emit('canvas_operation', {
            projectId: this.currentProject.id,
            operation: operation
        });
        
        console.log(`📤 Broadcast operation: ${operationType}`);
        
        // Also trigger immediate canvas save for important operations
        if (this.shouldSaveCanvas(operationType)) {
            this.triggerCanvasSave();
        }
        
        return operation;
    }
    
    shouldSaveCanvas(operationType) {
        // Save canvas state for structural changes
        const saveOperations = [
            'node_create', 'node_delete', 'node_move', 'node_resize',
            'node_property_update', 'layer_order_change'
        ];
        return saveOperations.includes(operationType);
    }
    
    triggerCanvasSave() {
        // Debounce saves to avoid too many requests
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        
        this.saveTimer = setTimeout(() => {
            if (this.app.canvasNavigator && this.app.canvasNavigator.saveCanvasToServer) {
                console.log('💾 Auto-saving canvas state after operation');
                this.app.canvasNavigator.saveCanvasToServer();
            }
        }, 1000); // Save 1 second after last operation
    }
    
    applyRemoteOperation(operation) {
        // Set flag to prevent re-broadcasting
        this._isApplyingRemoteOp = true;
        
        try {
            // Apply based on operation type
            switch (operation.type) {
                case 'node_create':
                    this.applyNodeCreate(operation.data);
                    break;
                case 'node_move':
                    this.applyNodeMove(operation.data);
                    break;
                case 'node_resize':
                    this.applyNodeResize(operation.data);
                    break;
                case 'node_rotate':
                    this.applyNodeRotate(operation.data);
                    break;
                case 'node_delete':
                    this.applyNodeDelete(operation.data);
                    break;
                case 'node_update':
                    this.applyNodeUpdate(operation.data);
                    break;
                case 'node_property_update':
                    this.applyNodePropertyUpdate(operation.data);
                    break;
                case 'state_sync':
                    this.applyStateSync(operation.data);
                    break;
                case 'undo_operation':
                    this.applyUndoOperation(operation.data);
                    break;
                case 'redo_operation':
                    this.applyRedoOperation(operation.data);
                    break;
                case 'node_reset':
                    this.applyNodeReset(operation.data);
                    break;
                case 'video_toggle':
                    this.applyVideoToggle(operation.data);
                    break;
                case 'layer_order_change':
                    this.applyLayerOrderChange(operation.data);
                    break;
                case 'text_update':
                    this.applyTextUpdate(operation.data);
                    break;
                default:
                    console.warn('Unknown operation type:', operation.type);
            }
            
            // Trigger canvas redraw
            this.requestCanvasRedraw();
            
        } catch (error) {
            console.error('Error applying remote operation:', error);
        } finally {
            // Always reset the flag
            this._isApplyingRemoteOp = false;
        }
    }
    
    // Operation handlers
    applyNodeCreate(data) {
        // Check if node already exists
        if (this.graph.getNodeById && this.graph.getNodeById(data.nodeData.id)) {
            console.log('Node already exists:', data.nodeData.id);
            return;
        }
        
        // Use NodeFactory to properly create and initialize nodes
        const node = NodeFactory.createNode(data.nodeData.type, {
            id: data.nodeData.id,
            pos: [...data.nodeData.pos],
            size: [...data.nodeData.size],
            properties: data.nodeData.properties || {},
            flags: data.nodeData.flags || {}
        });
        
        if (node) {
            // Add the node to the graph
            this.graph.add(node);
            console.log('✅ Created remote node:', node.id, 'type:', node.type);
            
            // For media nodes, ensure content is loaded
            if (node.type === 'media/image' && data.nodeData.properties?.src) {
                // Use setImage method if available, otherwise loadImage
                if (node.setImage) {
                    node.setImage(data.nodeData.properties.src, 
                                 data.nodeData.properties.filename || 'remote-image', 
                                 data.nodeData.properties.hash);
                } else if (node.loadImage) {
                    node.loadImage(data.nodeData.properties.src);
                }
            } else if (node.type === 'media/video' && data.nodeData.properties?.src) {
                // Use setVideo method if available, otherwise loadVideo
                if (node.setVideo) {
                    node.setVideo(data.nodeData.properties.src,
                                 data.nodeData.properties.filename || 'remote-video',
                                 data.nodeData.properties.hash);
                } else if (node.loadVideo) {
                    node.loadVideo(data.nodeData.properties.src);
                }
            }
        }
    }
    
    applyNodeMove(data) {
        if (data.nodeIds && data.positions) {
            // Multi-node move
            data.nodeIds.forEach((nodeId, index) => {
                const node = this.graph.getNodeById(nodeId);
                if (node && data.positions[index]) {
                    node.pos[0] = data.positions[index][0];
                    node.pos[1] = data.positions[index][1];
                    console.log('✅ Moved remote node (multi):', node.id);
                }
            });
        } else if (data.nodeId) {
            // Single node move
            const node = this.graph.getNodeById(data.nodeId);
            if (node) {
                // Handle both formats: x,y or position array
                if (data.x !== undefined && data.y !== undefined) {
                    node.pos[0] = data.x;
                    node.pos[1] = data.y;
                } else if (data.position && Array.isArray(data.position)) {
                    node.pos[0] = data.position[0];
                    node.pos[1] = data.position[1];
                } else if (data.pos && Array.isArray(data.pos)) {
                    node.pos[0] = data.pos[0];
                    node.pos[1] = data.pos[1];
                }
                console.log('✅ Moved remote node:', node.id);
            }
        }
    }
    
    applyNodeResize(data) {
        if (data.nodeIds && data.sizes) {
            // Multi-node resize
            data.nodeIds.forEach((nodeId, index) => {
                const node = this.graph.getNodeById(nodeId);
                if (node && data.sizes[index]) {
                    node.size[0] = data.sizes[index][0];
                    node.size[1] = data.sizes[index][1];
                    console.log('✅ Resized remote node (multi):', node.id);
                }
            });
        } else if (data.nodeId) {
            // Single node resize
            const node = this.graph.getNodeById(data.nodeId);
            if (node) {
                // Handle different formats
                if (data.width !== undefined && data.height !== undefined) {
                    node.size[0] = data.width;
                    node.size[1] = data.height;
                } else if (data.size && Array.isArray(data.size)) {
                    node.size[0] = data.size[0];
                    node.size[1] = data.size[1];
                }
                console.log('✅ Resized remote node:', node.id);
            }
        }
    }
    
    applyNodeDelete(data) {
        const node = this.graph.getNodeById(data.nodeId);
        if (node) {
            this.graph.remove(node);
            console.log('✅ Deleted remote node:', data.nodeId);
        }
    }
    
    applyNodeRotate(data) {
        if (data.nodeIds && data.rotations) {
            // Multi-node rotate
            data.nodeIds.forEach((nodeId, index) => {
                const node = this.graph.getNodeById(nodeId);
                if (node && data.rotations[index] !== undefined) {
                    node.rotation = data.rotations[index];
                    // Also update position if provided
                    if (data.positions && data.positions[index]) {
                        node.pos[0] = data.positions[index][0];
                        node.pos[1] = data.positions[index][1];
                    }
                    console.log('✅ Rotated remote node (multi):', node.id);
                }
            });
        } else if (data.nodeId) {
            // Single node rotate
            const node = this.graph.getNodeById(data.nodeId);
            if (node) {
                if (data.rotation !== undefined) {
                    node.rotation = data.rotation;
                }
                // Also update position if provided (rotation can change position)
                if (data.pos && Array.isArray(data.pos)) {
                    node.pos[0] = data.pos[0];
                    node.pos[1] = data.pos[1];
                }
                console.log('✅ Rotated remote node:', node.id);
            }
        }
    }

    applyNodeUpdate(data) {
        const node = this.graph.getNodeById(data.nodeId);
        if (node && data.updates) {
            Object.entries(data.updates).forEach(([key, value]) => {
                if (key === 'properties') {
                    Object.assign(node.properties, value);
                } else {
                    node[key] = value;
                }
            });
            console.log('✅ Updated remote node:', node.id);
        }
    }
    
    applyNodePropertyUpdate(data) {
        const { nodeId, property, value, properties } = data;
        const node = this.graph.getNodeById(nodeId);
        if (node) {
            if (properties) {
                // Multiple properties
                Object.assign(node.properties, properties);
            } else if (property && value !== undefined) {
                // Single property
                node.properties[property] = value;
            }
            console.log('✅ Updated remote node properties:', nodeId);
        }
    }
    
    applyStateSync(data) {
        console.log('📊 Applying full state sync');
        // This would be a complete state replacement
        // Implementation depends on your specific needs
    }
    
    applyUndoOperation(data) {
        console.log('↶ Applying remote undo operation');
        
        // Use the app's undo/redo system if available
        if (this.app.stateManager && this.app.stateManager.undo) {
            this.app.stateManager.undo();
        } else if (this.app.graphCanvas && this.app.graphCanvas.undo) {
            this.app.graphCanvas.undo();
        } else {
            console.warn('No undo system available');
        }
    }
    
    applyRedoOperation(data) {
        console.log('↷ Applying remote redo operation');
        
        // Use the app's undo/redo system if available  
        if (this.app.stateManager && this.app.stateManager.redo) {
            this.app.stateManager.redo();
        } else if (this.app.graphCanvas && this.app.graphCanvas.redo) {
            this.app.graphCanvas.redo();
        } else {
            console.warn('No redo system available');
        }
    }
    
    applyNodeReset(data) {
        console.log('🔄 Applying node reset:', data.nodeId);
        const node = this.graph.getNodeById(data.nodeId);
        if (node) {
            // Reset rotation
            if (data.resetRotation && node.rotation !== undefined) {
                node.rotation = 0;
            }
            
            // Reset aspect ratio
            if (data.resetAspectRatio && node.resetAspectRatio) {
                node.resetAspectRatio();
            }
            
            console.log('✅ Reset node:', node.id);
        }
    }
    
    applyVideoToggle(data) {
        console.log('▶️ Applying video toggle:', data.nodeId, data.playing ? 'play' : 'pause');
        const node = this.graph.getNodeById(data.nodeId);
        if (node && node.type === 'media/video') {
            node.properties.playing = data.playing;
            
            // Call the node's play/pause methods if they exist
            if (data.playing && node.play) {
                node.play();
            } else if (!data.playing && node.pause) {
                node.pause();
            }
            
            console.log('✅ Toggled video playback:', node.id);
        }
    }
    
    applyLayerOrderChange(data) {
        console.log('📚 Applying layer order change:', data.nodeId, data.direction);
        const node = this.graph.getNodeById(data.nodeId);
        if (node) {
            // Use graph methods to change layer order
            if (data.direction === 'front') {
                this.graph.moveNodeToFront(node);
            } else if (data.direction === 'back') {
                this.graph.moveNodeToBack(node);
            } else if (data.direction === 'forward' && this.graph.moveNodeForward) {
                this.graph.moveNodeForward(node);
            } else if (data.direction === 'backward' && this.graph.moveNodeBackward) {
                this.graph.moveNodeBackward(node);
            }
            
            console.log('✅ Changed layer order:', node.id);
        }
    }
    
    applyTextUpdate(data) {
        console.log('📝 Applying text update:', data.nodeId);
        const node = this.graph.getNodeById(data.nodeId);
        if (node && node.type === 'media/text') {
            if (data.text !== undefined) {
                node.properties.text = data.text;
            }
            
            if (data.properties) {
                Object.assign(node.properties, data.properties);
            }
            
            // Trigger text node update if it has a method for it
            if (node.updateText) {
                node.updateText();
            }
            
            console.log('✅ Updated text node:', node.id);
        }
    }
    
    // Periodic sync
    startPeriodicSync() {
        this.stopPeriodicSync();
        
        if (!this._hasValidSession) {
            console.log('⏸️ Cannot start sync - no valid session');
            return;
        }
        
        this.syncTimer = setInterval(() => {
            if (this._hasValidSession && this.isConnected) {
                this.performSync();
            }
        }, 30000); // Every 30 seconds
        
        console.log('🔄 Started periodic sync');
    }
    
    stopPeriodicSync() {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
            console.log('⏹️ Stopped periodic sync');
        }
    }
    
    stopAutoSave() {
        // This method is called by canvas navigator but not needed in current implementation
        // Auto-save functionality is handled by periodic sync
        console.log('stopAutoSave called (no-op in current implementation)');
    }
    
    stopHeartbeat() {
        // This method is called by canvas navigator but not needed in current implementation
        // Heartbeat functionality is handled by Socket.IO connection
        console.log('stopHeartbeat called (no-op in current implementation)');
    }
    
    async save() {
        // Save the current canvas state
        if (!this._hasValidSession || !this.currentProject) {
            console.log('Cannot save - no active session or project');
            return false;
        }
        
        try {
            // Mark that we have unsaved changes
            this.hasUnsavedChanges = true;
            
            // Trigger a sync to save the current state
            await this.performSync();
            
            console.log('Canvas saved successfully');
            return true;
        } catch (error) {
            console.error('Error saving canvas:', error);
            this.showStatus('Failed to save canvas', 'error');
            return false;
        }
    }
    
    async performSync() {
        if (!this._hasValidSession) return;
        
        console.log('🔄 Performing sync check...');
        
        this.socket.emit('sync_check', {
            projectId: this.currentProject.id,
            lastSequence: this.sequenceNumber
        });
    }
    
    handleSyncResponse(data) {
        const { operations, currentSequence } = data;
        
        if (operations && operations.length > 0) {
            console.log(`📥 Sync: applying ${operations.length} missed operations`);
            
            operations.forEach(op => {
                this.handleRemoteOperation({
                    operation: {
                        type: op.operation_type,
                        data: op.operation_data,
                        sequence: op.sequence_number
                    },
                    fromUserId: op.user_id,
                    fromSocketId: 'sync' // Mark as from sync
                });
            });
        }
        
        this.sequenceNumber = currentSequence;
    }
    
    handleRemoteMediaUpload(data) {
        const { nodeData, fileInfo, mediaUrl, fromSocketId } = data;
        
        // Skip if this is our own upload
        if (fromSocketId === this.socket.id) {
            console.log('📥 Skipping own media upload echo');
            return;
        }
        
        console.log('📥 Remote media upload received:', nodeData.id);
        
        // Create the node from the uploaded media
        const fullMediaUrl = `${CONFIG.SERVER.API_BASE}${mediaUrl}`;
        
        // Modify nodeData to include the server URL
        nodeData.properties = nodeData.properties || {};
        nodeData.properties.src = fullMediaUrl;
        nodeData.properties.hash = fileInfo.file_hash;
        nodeData.properties.filename = fileInfo.original_name;
        nodeData.properties.serverFilename = fileInfo.filename;
        
        // Apply as a remote node creation
        this.applyRemoteOperation({
            type: 'node_create',
            data: { nodeData }
        });
    }
    
    // State sharing
    handleStateRequest(data) {
        if (data.forUser && this.currentProject) {
            const state = this.captureProjectState();
            
            this.socket.emit('share_project_state', {
                projectState: state,
                forUser: data.forUser
            });
            
            console.log('📤 Shared project state with new user');
        }
    }
    
    handleProjectState(state) {
        console.log('📥 Received project state from peer');
        // Apply the shared state
        this.applyProjectState(state);
    }
    
    captureProjectState() {
        // Handle case where graph or nodes might not be ready
        if (!this.graph || !this.graph._nodes) {
            console.log('⚠️ Graph not ready for state capture');
            return {
                nodes: [],
                timestamp: Date.now()
            };
        }
        
        return {
            nodes: this.graph._nodes.map(node => ({
                id: node.id,
                type: node.type,
                pos: [...node.pos],
                size: [...node.size],
                properties: { ...node.properties },
                flags: { ...node.flags }
            })),
            timestamp: Date.now()
        };
    }
    
    applyProjectState(state) {
        // Clear existing nodes
        this.graph.clear();
        
        // Add nodes from state
        state.nodes.forEach(nodeData => {
            const node = LiteGraph.createNode(nodeData.type);
            if (node) {
                node.id = nodeData.id;
                node.pos = nodeData.pos;
                node.size = nodeData.size;
                Object.assign(node.properties, nodeData.properties);
                Object.assign(node.flags, nodeData.flags);
                
                this.graph.add(node);
            }
        });
        
        console.log(`✅ Applied project state with ${state.nodes.length} nodes`);
    }
    
    // Error handling
    handleServerError(error) {
        console.error('🚨 Server error:', error);
        
        if (error.message === 'Not authenticated for this project') {
            this._hasValidSession = false;
            this.stopPeriodicSync();
            
            // Attempt to rejoin
            if (this.currentProject) {
                console.log('🔄 Attempting to rejoin after auth error...');
                setTimeout(() => {
                    this.rejoinProject();
                }, 2000);
            }
        }
        
        this.showStatus(error.message, 'error');
    }
    
    async rejoinProject() {
        if (!this.currentProject) return;
        
        console.log('🔄 Rejoining project...');
        const projectId = this.currentProject.id;
        
        // Clear state
        this.currentProject = null;
        this.currentUser = null;
        this._hasValidSession = false;
        
        // Rejoin
        await this.joinProject(projectId);
    }
    
    // UI methods
    setupUI() {
        // Add CSS for collaboration UI
        this.addCollaborationCSS();
        
        // Status indicator
        const statusContainer = document.createElement('div');
        statusContainer.className = 'collab-status';
        statusContainer.innerHTML = `
            <span class="status-indicator"></span>
            <span class="status-text">Connecting...</span>
        `;
        document.body.appendChild(statusContainer);
        this.statusElement = statusContainer;
        
        // User list
        const userListContainer = document.createElement('div');
        userListContainer.className = 'collab-users';
        userListContainer.innerHTML = '<h3>Active Users</h3><ul></ul>';
        document.body.appendChild(userListContainer);
        this.userListElement = userListContainer;
    }
    
    addCollaborationCSS() {
        if (document.getElementById('collaboration-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'collaboration-styles';
        style.textContent = `
            .collab-status {
                position: fixed;
                top: 10px;
                right: 10px;
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 8px 12px;
                border-radius: 4px;
                font-family: monospace;
                font-size: 12px;
                z-index: 1000;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .status-indicator {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #666;
            }
            
            .status-indicator.status-success { background: #4CAF50; }
            .status-indicator.status-error { background: #F44336; }
            .status-indicator.status-warning { background: #FF9800; }
            .status-indicator.status-info { background: #2196F3; }
            
            .collab-users {
                position: fixed;
                top: 50px;
                right: 10px;
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 8px 12px;
                border-radius: 4px;
                font-family: monospace;
                font-size: 12px;
                z-index: 1000;
                min-width: 200px;
            }
            
            .collab-users h3 {
                margin: 0 0 8px 0;
                font-size: 12px;
                color: #ccc;
            }
            
            .collab-users ul {
                margin: 0;
                padding: 0;
                list-style: none;
            }
            
            .collab-users li {
                margin: 4px 0;
                display: flex;
                justify-content: space-between;
            }
            
            .user-name {
                font-weight: bold;
            }
            
            .user-tabs {
                color: #999;
                font-size: 10px;
            }
        `;
        document.head.appendChild(style);
    }
    
    showStatus(message, type = 'info') {
        if (!this.statusElement) return;
        
        const indicator = this.statusElement.querySelector('.status-indicator');
        const text = this.statusElement.querySelector('.status-text');
        
        indicator.className = `status-indicator status-${type}`;
        text.textContent = message;
        
        // Auto-hide info messages
        if (type === 'info') {
            setTimeout(() => {
                if (text.textContent === message) {
                    text.textContent = this.isConnected ? 'Connected' : 'Disconnected';
                }
            }, 3000);
        }
    }
    
    updateUserList(users) {
        if (!this.userListElement) return;
        
        const list = this.userListElement.querySelector('ul');
        list.innerHTML = '';
        
        users.forEach(user => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="user-name">${user.displayName}</span>
                <span class="user-tabs">(${user.tabs.length} tab${user.tabs.length > 1 ? 's' : ''})</span>
            `;
            list.appendChild(li);
        });
    }
    
    // Feature management
    enableCollaborativeFeatures() {
        console.log('✨ Enabling collaborative features');
        // This is where you'd enable real-time cursors, etc.
    }
    
    // Action manager integration (required by existing code)
    setActionManager(actionManager) {
        this.actionManager = actionManager;
        console.log('🔧 Action manager set on collaborative manager');
    }
    
    // Legacy method for compatibility with CanvasActionManager
    sendOperation(operationType, operationData) {
        return this.broadcastOperation(operationType, operationData);
    }
    
    // Canvas redraw helper
    requestCanvasRedraw() {
        try {
            // Try different ways to trigger canvas redraw
            if (this.app.graphCanvas && this.app.graphCanvas.setDirty) {
                this.app.graphCanvas.setDirty(true, true);
            } else if (this.graph.canvas && this.graph.canvas.setDirty) {
                this.graph.canvas.setDirty(true, true);
            } else if (this.app.graphCanvas && this.app.graphCanvas.draw) {
                this.app.graphCanvas.draw(true);
            } else if (this.graph.canvas && this.graph.canvas.draw) {
                this.graph.canvas.draw(true);
            } else {
                // Fallback - try to find canvas and trigger redraw
                const canvas = this.app.graphCanvas || this.graph.canvas;
                if (canvas) {
                    // Force a redraw by requesting animation frame
                    requestAnimationFrame(() => {
                        if (canvas.draw) canvas.draw(true);
                    });
                }
            }
        } catch (error) {
            console.warn('Failed to trigger canvas redraw:', error.message);
        }
    }
    
    // Media upload functionality
    async uploadMedia(file, nodeData) {
        if (!this._hasValidSession || !this.currentProject) {
            throw new Error('No active collaborative session. Please ensure you have loaded a canvas.');
        }
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('projectId', this.currentProject.id);
        formData.append('nodeData', JSON.stringify(nodeData));
        
        try {
            const response = await fetch(CONFIG.ENDPOINTS.UPLOAD, {
                method: 'POST',
                body: formData,
                headers: {
                    // Don't set Content-Type - let browser set it with boundary
                }
            });
            
            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            // Broadcast the media upload event
            if (result.success) {
                this.socket.emit('media_uploaded', {
                    projectId: this.currentProject.id,
                    nodeData: nodeData,
                    fileInfo: result.fileInfo,
                    mediaUrl: result.mediaUrl || result.url
                });
                
                // Also trigger canvas save after upload
                this.triggerCanvasSave();
            }
            
            return result;
            
        } catch (error) {
            console.error('Media upload error:', error);
            throw error;
        }
    }
    
    // Cleanup
    destroy() {
        this.stopPeriodicSync();
        
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        
        if (this.statusElement) {
            this.statusElement.remove();
        }
        
        if (this.userListElement) {
            this.userListElement.remove();
        }
        
        console.log('🧹 CollaborativeManager destroyed');
    }
}

// Export for use
window.CollaborativeManager = CollaborativeManager;