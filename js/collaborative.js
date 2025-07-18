// ===================================
// COLLABORATIVE FEATURES MODULE
// ===================================

class CollaborativeManager {
    constructor(app) {
        this.app = app;
        this.canvas = app.graphCanvas;
        this.graph = app.graph;
        this.stateManager = app.stateManager;
        
        // Collaboration state
        this.socket = null;
        this.isConnected = false;
        this.currentProject = null;
        this.currentUser = null;
        this.otherUsers = new Map(); // userId -> user info
        this.sequenceNumber = 0;
        this.pendingOperations = [];
        
        // UI elements
        this.collaborationUI = null;
        this.userList = null;
        this.connectionStatus = null;
        
        // Feature flags
        this.enableCollaboration = false;
        this.enableCursorSharing = true;
        this.enableSelectionSharing = true;
        this.enableViewportSharing = false;
        
        // Periodic sync configuration
        this.periodicSync = {
            enabled: true,
            interval: 60000, // 60 seconds - less aggressive
            lastSync: 0,
            lastKnownStateHash: null,
            timer: null,
            missedUpdatesThreshold: 5 // If we miss this many sequence numbers, force full sync
        };
        
        // Connection health monitoring
        this.connectionHealth = {
            lastHeartbeat: Date.now(),
            heartbeatInterval: 10000, // 10 seconds
            missedHeartbeats: 0,
            maxMissedHeartbeats: 3,
            timer: null
        };
        
        this.init();
    }
    
    async init() {
        console.log('🤝 Collaborative manager initializing...');
        
        // Check if Socket.IO is available
        if (typeof io === 'undefined' || window.COLLABORATIVE_MODE === false) {
            if (typeof io === 'undefined') {
                console.log('📡 Socket.IO not loaded - running in single-user mode');
            } else {
                console.log('📡 Collaborative mode disabled - running in single-user mode');
            }
            this.setupSingleUserMode();
            return;
        }
        
        console.log('📡 Socket.IO detected, checking server availability...');
        
        // Check if collaborative server is available
        try {
            const response = await fetch(CONFIG.ENDPOINTS.HEALTH);
            const health = await response.json();
            
            console.log('🏥 Health check response:', health);
            
            if (health.status === 'ok') {
                console.log('🌐 Collaborative server detected - enabling real-time features');
                this.enableCollaboration = true;
                this.setupCollaborativeMode();
            } else {
                console.log('❌ Server health check failed');
                this.setupSingleUserMode();
            }
        } catch (error) {
            console.log('📱 No collaborative server - running in single-user mode');
            console.error('Health check error:', error);
            this.setupSingleUserMode();
        }
    }
    
    setupSingleUserMode() {
        this.createUI();
        this.showStatus('Single User Mode', 'info');
        console.log('✅ Single-user mode initialized');
    }
    
    setupCollaborativeMode() {
        this.createUI();
        this.connectToServer();
        this.setupCollaborativeHandlers();
        console.log('✅ Collaborative mode initialized');
    }
    
    createUI() {
        // Create collaboration UI container
        this.collaborationUI = document.createElement('div');
        this.collaborationUI.id = 'collaboration-ui';
        this.collaborationUI.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px;
            border-radius: 5px;
            font-family: Arial, sans-serif;
            font-size: 12px;
            z-index: 10000;
            min-width: 160px;
        `;
        
        // Connection status
        this.connectionStatus = document.createElement('div');
        this.connectionStatus.style.cssText = `
            margin-bottom: 10px;
            padding: 5px;
            border-radius: 3px;
            text-align: center;
        `;
        this.collaborationUI.appendChild(this.connectionStatus);
        
        // User list
        const userHeader = document.createElement('div');
        userHeader.textContent = 'Active Users:';
        userHeader.style.fontWeight = 'bold';
        userHeader.style.marginBottom = '5px';
        this.collaborationUI.appendChild(userHeader);
        
        this.userList = document.createElement('div');
        this.userList.id = 'user-list';
        this.collaborationUI.appendChild(this.userList);
        
        // Toggle buttons
        if (this.enableCollaboration) {
            const togglesContainer = document.createElement('div');
            togglesContainer.style.marginTop = '10px';
            
            const cursorToggle = this.createToggle('Cursors', this.enableCursorSharing, (enabled) => {
                this.enableCursorSharing = enabled;
            });
            
            const selectionToggle = this.createToggle('Selections', this.enableSelectionSharing, (enabled) => {
                this.enableSelectionSharing = enabled;
            });
            
            togglesContainer.appendChild(cursorToggle);
            togglesContainer.appendChild(selectionToggle);
            this.collaborationUI.appendChild(togglesContainer);
        }
        
        document.body.appendChild(this.collaborationUI);
    }
    
    createToggle(label, initialState, callback) {
        const container = document.createElement('div');
        container.style.marginBottom = '5px';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = initialState;
        checkbox.onchange = () => callback(checkbox.checked);
        
        const labelEl = document.createElement('label');
        labelEl.textContent = ` ${label}`;
        labelEl.style.fontSize = '11px';
        
        container.appendChild(checkbox);
        container.appendChild(labelEl);
        
        return container;
    }
    
    showStatus(message, type = 'info') {
        if (!this.connectionStatus) return;
        
        this.connectionStatus.textContent = message;
        
        const colors = {
            info: '#4a90e2',
            success: '#7ed321',
            warning: '#f5a623',
            error: '#d0021b'
        };
        
        this.connectionStatus.style.backgroundColor = colors[type] || colors.info;
    }
    
    updateUserList() {
        if (!this.userList) return;
        
        console.log('📝 Updating user list. Current user:', this.currentUser?.displayName, 'Other users:', this.otherUsers.size);
        
        this.userList.innerHTML = '';
        
        // Add current user
        if (this.currentUser) {
            const userEl = document.createElement('div');
            userEl.style.cssText = 'padding: 2px 0; color: #7ed321;';
            userEl.textContent = `${this.currentUser.displayName} (you)`;
            this.userList.appendChild(userEl);
        }
        
        // Add other users
        this.otherUsers.forEach((user) => {
            console.log('📝 Adding other user to list:', user.displayName);
            const userEl = document.createElement('div');
            userEl.style.cssText = 'padding: 2px 0; color: #ccc;';
            userEl.textContent = user.displayName;
            this.userList.appendChild(userEl);
        });
        
        if (this.otherUsers.size === 0 && !this.currentUser) {
            const emptyEl = document.createElement('div');
            emptyEl.style.cssText = 'padding: 2px 0; color: #666; font-style: italic;';
            emptyEl.textContent = 'No users connected';
            this.userList.appendChild(emptyEl);
        }
    }
    
    connectToServer() {
        try {
            console.log('🔌 Attempting to connect to', CONFIG.SERVER.API_BASE);
            console.log('🔧 io function available:', typeof io !== 'undefined');
            
            this.socket = io(CONFIG.SERVER.API_BASE);
            
            console.log('🔌 Socket.IO client created:', !!this.socket);
            
            this.socket.on('connect', () => {
                this.isConnected = true;
                this.showStatus('Connected', 'success');
                console.log('🔌 Connected to collaborative server');
                
                // Start health monitoring
                this.startHeartbeat();
                
                // If we were in a project before disconnect, rejoin it
                if (this.currentProject) {
                    console.log('🔄 Reconnecting to project:', this.currentProject.id);
                    this.joinProject(this.currentProject.id, this.currentUser?.username, this.currentUser?.displayName);
                }
            });
            
            this.socket.on('disconnect', (reason) => {
                console.log('🔌 Disconnected from collaborative server. Reason:', reason);
                this.isConnected = false;
                
                // Only clear users if it's a permanent disconnect
                if (reason === 'io server disconnect' || reason === 'io client disconnect') {
                    this.showStatus('Disconnected', 'error');
                    this.otherUsers.clear();
                    this.updateUserList();
                } else {
                    // Temporary disconnect - keep user list
                    this.showStatus('Reconnecting...', 'warning');
                }
                
                // Stop health monitoring and sync
                this.stopHeartbeat();
                this.stopPeriodicSync();
            });
            
            this.socket.on('connect_error', (error) => {
                console.error('Socket connect_error:', error);
                this.showStatus('Connection Error', 'error');
            });
            
            this.socket.on('error', (error) => {
                console.error('Socket error:', error);
                this.showStatus('Connection Error', 'error');
            });
            
        } catch (error) {
            console.error('Failed to connect to server:', error);
            this.showStatus('Connection Failed', 'error');
        }
    }
    
    setupCollaborativeHandlers() {
        if (!this.socket) return;
        
        // Project events
        this.socket.on('project_joined', (data) => {
            console.log('🎯 Project joined event received:', data.project.id, data.project.name);
            console.log('🎯 Sequence number from server:', data.sequenceNumber);
            
            this.currentProject = data.project;
            this.currentUser = data.session;
            this.sequenceNumber = data.sequenceNumber || 0;
            
            // Clear any pending sync state from previous project
            this.periodicSync.lastKnownStateHash = null;
            this.periodicSync.lastSync = 0;
            
            this.showStatus(`Connected to ${data.project.name || 'Untitled Project'}`, 'success');
            this.updateUserList();
            
            // Start periodic sync for this project
            this.startPeriodicSync();
            
            // Start auto-save for this project
            this.startAutoSave();
            
            console.log('🎯 Successfully joined project:', data.project.id);
        });
        
        this.socket.on('project_state', (state) => {
            this.restoreProjectState(state);
        });
        
        this.socket.on('active_users', (users) => {
            // Populate user list with existing users
            this.otherUsers.clear();
            console.log('👥 Current user ID:', this.currentUser?.userId);
            console.log('👥 Active users:', users);
            
            for (const user of users) {
                if (user.userId !== this.currentUser?.userId) {
                    this.otherUsers.set(user.userId, user);
                }
            }
            this.updateUserList();
            console.log('👥 Received active users:', users.length, 'Other users:', this.otherUsers.size);
        });
        
        this.socket.on('user_joined', (user) => {
            console.log('👋 User joined event received:', user);
            this.otherUsers.set(user.userId, user);
            console.log('👋 Other users map size:', this.otherUsers.size);
            this.updateUserList();
            console.log('👋 User joined:', user.displayName, 'ID:', user.userId);
        });
        
        this.socket.on('user_left', (user) => {
            this.otherUsers.delete(user.userId);
            this.updateUserList();
            console.log('�� User left:', user.displayName);
        });
        
        // Canvas operations
        this.socket.on('canvas_operation', (operation) => {
            this.handleRemoteOperation(operation);
        });
        
        // Sync and health monitoring
        this.socket.on('sync_response', (data) => {
            this.handleSyncResponse(data);
        });
        
        this.socket.on('heartbeat_response', () => {
            this.handleHeartbeatResponse();
        });
        
        // Media operations
        this.socket.on('media_uploaded', (data) => {
            this.handleMediaUploaded(data);
        });
        
        // Real-time features
        this.socket.on('cursor_update', (data) => {
            if (this.enableCursorSharing) {
                this.updateRemoteCursor(data);
            }
        });
        
        this.socket.on('selection_update', (data) => {
            if (this.enableSelectionSharing) {
                this.updateRemoteSelection(data);
            }
        });
        
        this.socket.on('viewport_update', (data) => {
            if (this.enableViewportSharing) {
                this.updateRemoteViewport(data);
            }
        });
        
        // Project state sharing requests
        this.socket.on('request_project_state', (data) => {
            this.handleProjectStateRequest(data);
        });
    }

    // Handle media upload from other users
    handleMediaUploaded(data) {
        const { fileInfo, nodeData } = data;
        console.log('📸 Media uploaded by other user:', fileInfo.original_name);
        
        // Create the media URL from server
        const mediaUrl = `${CONFIG.ENDPOINTS.UPLOADS}/${fileInfo.filename}`;
        
        // Create node based on the data received
        if (typeof NodeFactory !== 'undefined' && this.app?.graph) {
            const node = NodeFactory.createNode(nodeData.type);
            if (node) {
                // Set node properties
                node.pos = [...nodeData.pos];
                node.size = [...nodeData.size];
                node.title = nodeData.title;
                node.properties = { ...nodeData.properties };
                node.properties.hash = fileInfo.file_hash;
                node.properties.serverFilename = fileInfo.filename; // Store server filename for restoration
                node.flags = { ...nodeData.flags };
                node.aspectRatio = nodeData.aspectRatio || 1;
                node.rotation = nodeData.rotation || 0;
                
                // Load the media from server
                if (nodeData.type === 'media/video' && node.setVideo) {
                    node.setVideo(mediaUrl, fileInfo.original_name, fileInfo.file_hash);
                } else if (nodeData.type === 'media/image' && node.setImage) {
                    node.setImage(mediaUrl, fileInfo.original_name, fileInfo.file_hash);
                }
                
                // Add to graph
                this.app.graph.add(node);
                if (this.app.graphCanvas) {
                    this.app.graphCanvas.dirty_canvas = true;
                }
                
                console.log('✅ Added collaborative media node:', fileInfo.original_name);
            }
        }
    }

    // Send media upload to other users
    async uploadMedia(file, nodeData) {
        if (!this.isConnected || !this.socket) {
            console.log('⚠️ Not connected to collaborative server');
            return null;
        }
        
        try {
            console.log('📤 Uploading to collaborative server:', file.name);
            
            const formData = new FormData();
            formData.append('file', file);
            formData.append('projectId', this.currentProject?.id || 'demo-project');
            
            // Add uploader info to exclude them from broadcast
            const enhancedNodeData = {
                ...nodeData,
                uploaderUserId: this.currentUser?.userId
            };
            formData.append('nodeData', JSON.stringify(enhancedNodeData));
            
            const response = await fetch(CONFIG.ENDPOINTS.UPLOAD, {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log('✅ Media uploaded to server:', result.fileInfo.filename);
                return result;
            } else {
                console.error('❌ Failed to upload media:', response.statusText);
                return null;
            }
        } catch (error) {
            console.error('❌ Media upload error:', error);
            return null;
        }
    }
    
    async joinProject(projectId, username = null, displayName = null) {
        if (!this.socket || !this.isConnected) {
            console.warn('Cannot join project: not connected');
            return;
        }
        
        // Convert projectId to number to ensure consistency
        projectId = parseInt(projectId);
        
        // If we're already in this project, don't rejoin
        if (this.currentProject && this.currentProject.id === projectId) {
            console.log('Already in project:', projectId);
            return;
        }
        
        // Leave current project if we're in one
        if (this.currentProject && this.currentProject.id) {
            console.log('Leaving project:', this.currentProject.id);
            
            // Stop all timers first
            this.stopPeriodicSync();
            this.stopAutoSave();
            this.stopHeartbeat();
            
            // Leave the room
            this.socket.emit('leave_project', { projectId: this.currentProject.id });
            
            // Clear state
            this.currentProject = null;
            this.sequenceNumber = 0;
            this.otherUsers.clear();
            this.updateUserList();
        }
        
        // Use stored user info if not provided
        if (!username && this.currentUser) {
            username = this.currentUser.username;
            displayName = this.currentUser.displayName;
        }
        
        // Default username if still not set
        if (!username) {
            username = 'user-' + Math.random().toString(36).substr(2, 9);
        }
        
        console.log('Joining project:', projectId);
        
        this.socket.emit('join_project', {
            projectId: projectId,
            username: username,
            displayName: displayName || username
        });
    }
    
    sendOperation(operationType, operationData) {
        if (!this.socket || !this.isConnected || !this.currentProject) {
            return; // Gracefully handle offline mode
        }
        
        const operation = {
            type: operationType,
            data: operationData,
            timestamp: Date.now()
        };
        
        this.socket.emit('canvas_operation', {
            projectId: this.currentProject.id,
            operation: operation
        });
    }
    
    handleRemoteOperation(data) {
        // Skip operations from current user
        if (data.userId === this.currentUser?.userId) {
            return;
        }
        
        console.log('📥 Remote operation:', data.operation.type, data);
        
        const { operation } = data;
        const { type, data: operationData } = operation;
        
        // Prevent infinite loops by temporarily disabling collaboration events
        const wasEnabled = this.enableCollaboration;
        this.enableCollaboration = false;
        
        try {
            switch (type) {
                case 'node_move':
                    this.applyNodeMove(operationData);
                    break;
                case 'node_resize': 
                    this.applyNodeResize(operationData);
                    break;
                case 'node_rotate':
                    this.applyNodeRotate(operationData);
                    break;
                case 'node_delete':
                    this.applyNodeDelete(operationData);
                    break;
                case 'node_create':
                    this.applyNodeCreate(operationData);
                    break;
                case 'node_reset':
                    this.applyNodeReset(operationData);
                    break;
                case 'video_toggle':
                    this.applyVideoToggle(operationData);
                    break;
                case 'node_align':
                    this.applyNodeAlign(operationData);
                    break;
                case 'node_property_update':
                    this.applyNodePropertyUpdate(operationData);
                    break;
                case 'selection_change':
                    this.applySelectionChange(operationData);
                    break;
                case 'layer_order_change':
                    this.applyLayerOrderChange(operationData);
                    break;
                default:
                    console.warn('Unknown operation type:', type);
            }
            
            // Force canvas redraw
            if (this.canvas) {
                this.canvas.dirty_canvas = true;
            }
            
        } finally {
            // Re-enable collaboration events
            this.enableCollaboration = wasEnabled;
        }
        
        // Update sequence number
        if (data.sequenceNumber) {
            this.sequenceNumber = Math.max(this.sequenceNumber, data.sequenceNumber);
        }
    }
    
    applyNodeMove(operationData) {
        const { nodeId, pos, nodeIds, positions } = operationData;
        
        if (nodeIds && positions) {
            // Multi-node move
            for (let i = 0; i < nodeIds.length; i++) {
                const node = this.graph.getNodeById(nodeIds[i]);
                if (node && positions[i]) {
                    node.pos[0] = positions[i][0];
                    node.pos[1] = positions[i][1];
                }
            }
        } else if (nodeId && pos) {
            // Single node move
            const node = this.graph.getNodeById(nodeId);
            if (node) {
                node.pos[0] = pos[0];
                node.pos[1] = pos[1];
            }
        }
    }
    
    applyNodeResize(operationData) {
        const { nodeId, size, pos, nodeIds, sizes, positions } = operationData;
        
        if (nodeIds && sizes) {
            // Multi-node resize
            for (let i = 0; i < nodeIds.length; i++) {
                const node = this.graph.getNodeById(nodeIds[i]);
                if (node && sizes[i]) {
                    node.size[0] = sizes[i][0];
                    node.size[1] = sizes[i][1];
                    node.aspectRatio = node.size[0] / node.size[1];
                    
                    if (positions && positions[i]) {
                        node.pos[0] = positions[i][0];
                        node.pos[1] = positions[i][1];
                    }
                    
                    if (node.onResize) {
                        node.onResize();
                    }
                }
            }
        } else if (nodeId && size) {
            // Single node resize
            const node = this.graph.getNodeById(nodeId);
            if (node) {
                node.size[0] = size[0];
                node.size[1] = size[1];
                node.aspectRatio = node.size[0] / node.size[1];
                
                if (pos) {
                    node.pos[0] = pos[0];
                    node.pos[1] = pos[1];
                }
                
                if (node.onResize) {
                    node.onResize();
                }
            }
        }
    }
    
    applyNodeRotate(operationData) {
        const { nodeId, rotation, pos, nodeIds, rotations, positions } = operationData;
        
        if (nodeIds && rotations) {
            // Multi-node rotation
            for (let i = 0; i < nodeIds.length; i++) {
                const node = this.graph.getNodeById(nodeIds[i]);
                if (node && typeof rotations[i] === 'number') {
                    node.rotation = rotations[i] % 360;
                    
                    if (positions && positions[i]) {
                        node.pos[0] = positions[i][0];
                        node.pos[1] = positions[i][1];
                    }
                }
            }
        } else if (nodeId && typeof rotation === 'number') {
            // Single node rotation
            const node = this.graph.getNodeById(nodeId);
            if (node) {
                node.rotation = rotation % 360;
                
                if (pos) {
                    node.pos[0] = pos[0];
                    node.pos[1] = pos[1];
                }
            }
        }
    }
    
    applyNodeDelete(operationData) {
        const { nodeId, nodeIds } = operationData;
        
        if (nodeIds) {
            // Multi-node delete
            for (const id of nodeIds) {
                const node = this.graph.getNodeById(id);
                if (node) {
                    this.graph.remove(node);
                }
            }
        } else if (nodeId) {
            // Single node delete
            const node = this.graph.getNodeById(nodeId);
            if (node) {
                this.graph.remove(node);
            }
        }
    }
    
    handleProjectStateRequest(data) {
        console.log('📤 Sharing project state with new user');
        
        if (!this.graph || !data.forUser) return;
        
        // Capture current project state
        const projectState = this.captureProjectState();
        
        // Send state to server to forward to the requesting user
        this.socket.emit('share_project_state', {
            projectState: projectState,
            forUser: data.forUser
        });
    }
    
    captureProjectState() {
        // Use the state manager's serialization method
        if (this.stateManager) {
            return this.stateManager.serializeState(this.graph, this.canvas);
        }
        
        // Fallback if state manager not available
        const nodes = this.graph.nodes.map(node => ({
            id: node.id,
            type: node.type,
            pos: [...node.pos],
            size: [...node.size],
            title: node.title,
            properties: { ...node.properties },
            flags: { ...node.flags },
            aspectRatio: node.aspectRatio || 1,
            rotation: node.rotation || 0
        }));
        
        const viewport = this.canvas?.viewport ? {
            scale: this.canvas.viewport.scale,
            offset: [...this.canvas.viewport.offset]
        } : null;
        
        return {
            nodes: nodes,
            viewport: viewport,
            timestamp: Date.now()
        };
    }
    
    restoreProjectState(state) {
        console.log('🔄 Restoring project state:', state);
        
        // Temporarily disable collaboration to prevent broadcasting during restoration
        const wasEnabled = this.enableCollaboration;
        this.enableCollaboration = false;
        
        try {
            if (state.nodes && Array.isArray(state.nodes)) {
                // Clear current nodes
                this.graph.clear();
                
                // Restore nodes
                for (const nodeData of state.nodes) {
                    this.createNodeFromData(nodeData);
                }
            }
            
            if (state.viewport) {
                this.restoreViewport(state.viewport);
            }
            
            // Force canvas redraw
            if (this.canvas) {
                this.canvas.dirty_canvas = true;
            }
            
        } finally {
            // Re-enable collaboration
            this.enableCollaboration = wasEnabled;
        }
    }
    
    createNodeFromData(nodeData) {
        if (typeof NodeFactory !== 'undefined') {
            const node = NodeFactory.createNode(nodeData.type);
            if (node) {
                // Set all properties
                node.id = nodeData.id;
                node.pos = [...nodeData.pos];
                node.size = [...nodeData.size];
                node.title = nodeData.title;
                node.properties = { ...nodeData.properties };
                node.flags = { ...nodeData.flags };
                node.aspectRatio = nodeData.aspectRatio || 1;
                node.rotation = nodeData.rotation || 0;
                
                // Ensure the graph's lastNodeId is updated to prevent conflicts
                if (this.graph && node.id >= this.graph.lastNodeId) {
                    this.graph.lastNodeId = node.id;
                }
                
                // Handle media nodes that need to load content
                if (nodeData.type === 'media/image' || nodeData.type === 'media/video') {
                    this.loadNodeMedia(node, nodeData);
                }
                
                // Add to graph
                this.graph.add(node);
                console.log('✅ Restored node:', nodeData.title || nodeData.type);
            }
        }
    }
    
    loadNodeMedia(node, nodeData) {
        const hash = nodeData.properties.hash;
        const filename = nodeData.properties.filename;
        const isVideo = nodeData.type === 'media/video';
        
        if (!hash) return;
        
        // Try to get from cache first
        if (window.imageCache) {
            const cached = window.imageCache.get(hash);
            if (cached) {
                if (isVideo && node.setVideo) {
                    node.setVideo(cached, filename, hash);
                } else if (node.setImage) {
                    node.setImage(cached, filename, hash);
                }
                return;
            }
        }
        
        // Set loading state
        if (window.thumbnailCache && window.thumbnailCache.hasThumbnails(hash)) {
            node.loadingState = 'loaded';
            node.loadingProgress = 1.0;
        } else {
            node.loadingState = 'loading';
            node.loadingProgress = 0;
        }
        
        // Load from server
        const serverFilename = nodeData.properties.serverFilename || filename;
        const serverUrl = `${CONFIG.ENDPOINTS.UPLOADS}/${serverFilename}`;
        
        if (isVideo && node.setVideo) {
            node.setVideo(serverUrl, filename, hash).catch(() => {
                console.warn('Failed to load collaborative video:', filename);
                node.loadingState = 'error';
            });
        } else if (node.setImage) {
            node.setImage(serverUrl, filename, hash).catch(() => {
                console.warn('Failed to load collaborative image:', filename);
                node.loadingState = 'error';
            });
        }
    }
    
    restoreViewport(viewport) {
        if (this.canvas && this.canvas.viewport && viewport) {
            if (viewport.scale !== undefined) {
                this.canvas.viewport.scale = viewport.scale;
            }
            if (viewport.offset && Array.isArray(viewport.offset)) {
                this.canvas.viewport.offset = [...viewport.offset];
            }
        }
    }
    
    applyNodeCreate(operationData) {
        const { nodeData } = operationData;
        
        console.log('🔄 Applying node create operation:', nodeData?.id, nodeData?.type);
        
        if (nodeData && typeof NodeFactory !== 'undefined') {
            // Check if node already exists
            const existingNode = this.graph.getNodeById(nodeData.id);
            if (existingNode) {
                console.log('⚠️ Node already exists, skipping creation:', nodeData.id);
                return;
            }
            
            const node = NodeFactory.createNode(nodeData.type);
            if (node) {
                // Set all properties
                node.id = nodeData.id;
                node.pos = [...nodeData.pos];
                node.size = [...nodeData.size];
                node.title = nodeData.title;
                node.properties = { ...nodeData.properties };
                node.flags = { ...nodeData.flags };
                node.aspectRatio = nodeData.aspectRatio || 1;
                node.rotation = nodeData.rotation || 0;
                
                // Ensure the graph's lastNodeId is updated to prevent conflicts
                if (this.graph && node.id >= this.graph.lastNodeId) {
                    this.graph.lastNodeId = node.id;
                }
                
                // Handle media nodes that need to load content
                if ((nodeData.type === 'media/image' || nodeData.type === 'media/video') && nodeData.properties.hash) {
                    // Use the canvas's media loading logic for consistency
                    if (this.canvas && this.canvas.loadMediaForNode) {
                        this.canvas.loadMediaForNode(node, nodeData);
                    } else {
                        // Fallback to the local method
                        this.loadNodeMedia(node, nodeData);
                    }
                }
                
                // Add to graph
                this.graph.add(node);
                
                console.log('✅ Created collaborative node:', nodeData.title || nodeData.type, 'Total nodes:', this.graph.nodes.length);
            }
        }
    }
    
    applySelectionChange(operationData) {
        const { selectedNodeIds } = operationData;
        
        if (this.canvas && this.canvas.selection) {
            // Don't update our own selection, just store remote selections for visual feedback
            console.log('Remote user selected nodes:', selectedNodeIds);
        }
    }
    
    handleRemoteCursor(data) {
        // TODO: Render other users' cursors on canvas
        console.log('🖱️ Remote cursor:', data);
    }
    
    handleRemoteSelection(data) {
        // TODO: Highlight other users' selections
        console.log('🎯 Remote selection:', data);
    }
    
    handleRemoteViewport(data) {
        // TODO: Implement viewport following
        console.log('👀 Remote viewport:', data);
    }
    
    applyNodeReset(operationData) {
        const { nodeId, resetType, value, nodeIds, values } = operationData;
        
        if (nodeId) {
            // Single node reset
            const node = this.graph.getNodeById(nodeId);
            if (node) {
                this.applyResetToNode(node, resetType, value);
            }
        } else if (nodeIds) {
            // Multi-node reset
            for (let i = 0; i < nodeIds.length; i++) {
                const node = this.graph.getNodeById(nodeIds[i]);
                if (node) {
                    const resetValue = values ? values[i] : value;
                    this.applyResetToNode(node, resetType, resetValue);
                }
            }
        }
    }
    
    applyResetToNode(node, resetType, value) {
        if (resetType === 'rotation') {
            node.rotation = value;
        } else if (resetType === 'aspect_ratio') {
            node.aspectRatio = value;
            node.size[1] = node.size[0] / value;
            if (node.onResize) {
                node.onResize();
            }
        }
    }
    
    applyVideoToggle(operationData) {
        const { nodeId, paused } = operationData;
        const node = this.graph.getNodeById(nodeId);
        
        if (node && node.type === 'media/video') {
            // Update the video state without triggering another broadcast
            node.properties.paused = paused;
            
            if (paused) {
                if (node.pause) node.pause();
            } else {
                if (node.play) node.play();
            }
        }
    }
    
    applyNodeAlign(operationData) {
        const { nodeIds, positions } = operationData;
        
        if (nodeIds && positions && nodeIds.length === positions.length) {
            for (let i = 0; i < nodeIds.length; i++) {
                const node = this.graph.getNodeById(nodeIds[i]);
                if (node && positions[i]) {
                    node.pos[0] = positions[i][0];
                    node.pos[1] = positions[i][1];
                }
            }
        }
    }
    
    applyNodePropertyUpdate(operationData) {
        const { nodeId, nodeIds, propertyName, value, values } = operationData;
        
        if (nodeIds && values) {
            // Multi-node property update
            for (let i = 0; i < nodeIds.length; i++) {
                const node = this.graph.getNodeById(nodeIds[i]);
                if (node && typeof values[i] !== 'undefined') {
                    node.properties[propertyName] = values[i];
                    
                    // Handle special property updates for different node types
                    this.handleSpecialPropertyUpdate(node, propertyName, values[i]);
                    
                    console.log(`🔄 Node ${nodeIds[i]} property ${propertyName} updated to:`, values[i]);
                }
            }
        } else if (nodeId && typeof value !== 'undefined') {
            // Single node property update
            const node = this.graph.getNodeById(nodeId);
            if (node) {
                node.properties[propertyName] = value;
                
                // Handle special property updates for different node types
                this.handleSpecialPropertyUpdate(node, propertyName, value);
                
                console.log(`🔄 Node ${nodeId} property ${propertyName} updated to:`, value);
            }
        }
    }
    
    handleSpecialPropertyUpdate(node, propertyName, value) {
        // Handle video node state changes
        if (node.type === 'media/video' && node.video) {
            if (propertyName === 'paused') {
                if (value) {
                    node.video.pause();
                } else if (node.video.paused) {
                    node.video.play().catch(() => {}); // Ignore autoplay restrictions
                }
            } else if (propertyName === 'loop') {
                node.video.loop = value;
            } else if (propertyName === 'muted') {
                node.video.muted = value;
            }
        }
        
        // Handle text node changes that might need special processing
        if (node.type === 'media/text') {
            if (propertyName === 'text' || propertyName === 'fontSize' || propertyName === 'fontFamily') {
                // Trigger text reflow/resize if needed
                if (node.fitTextToBox) {
                    node.fitTextToBox();
                }
            }
        }
        
        // Mark node as dirty for re-rendering
        if (node.markDirty) {
            node.markDirty();
        }
    }
    
    applyLayerOrderChange(operationData) {
        const { nodeIds, direction, newLayerOrder } = operationData;
        
        if (newLayerOrder && Array.isArray(newLayerOrder)) {
            // Apply the complete new layer order
            const reorderedNodes = [];
            
            // Reorder nodes according to the new layer order
            for (const nodeId of newLayerOrder) {
                const node = this.graph.getNodeById(nodeId);
                if (node) {
                    reorderedNodes.push(node);
                }
            }
            
            // Update the graph's nodes array with the new order
            this.graph.nodes = reorderedNodes;
            
            console.log(`🔄 Applied layer order change for ${nodeIds.length} nodes (${direction})`);
        }
    }
    
    // Integration hooks for existing canvas operations
    onNodeCreate(node) {
        if (this.enableCollaboration) {
            this.sendOperation('node_create', {
                nodeId: node.id,
                type: node.type,
                pos: node.pos,
                size: node.size,
                properties: node.properties
            });
        }
    }
    
    onNodeUpdate(node, changes) {
        if (this.enableCollaboration) {
            this.sendOperation('node_update', {
                nodeId: node.id,
                changes: changes
            });
        }
    }
    
    onNodeDelete(nodeId) {
        if (this.enableCollaboration) {
            this.sendOperation('node_delete', {
                nodeId: nodeId
            });
        }
    }
    
    onSelectionChange(selectedNodes) {
        if (this.enableCollaboration && this.enableSelectionSharing) {
            this.socket?.emit('selection_update', {
                projectId: this.currentProject?.id,
                selection: selectedNodes.map(node => node.id)
            });
        }
    }
    
    onCursorMove(position) {
        if (this.enableCollaboration && this.enableCursorSharing) {
            // Throttle cursor updates
            if (!this.lastCursorUpdate || Date.now() - this.lastCursorUpdate > 50) {
                this.socket?.emit('cursor_update', {
                    projectId: this.currentProject?.id,
                    position: position
                });
                this.lastCursorUpdate = Date.now();
            }
        }
    }
    
    // ===================================
    // PERIODIC SYNCHRONIZATION
    // ===================================
    
    startPeriodicSync() {
        if (!this.periodicSync.enabled) return;
        
        this.stopPeriodicSync(); // Clear any existing timer
        
        this.periodicSync.timer = setInterval(() => {
            if (this.isConnected && this.currentProject) {
                this.performPeriodicSync();
            }
        }, this.periodicSync.interval);
        
        console.log(`🔄 Periodic sync started (every ${this.periodicSync.interval / 1000}s)`);
    }
    
    stopPeriodicSync() {
        if (this.periodicSync.timer) {
            clearInterval(this.periodicSync.timer);
            this.periodicSync.timer = null;
        }
    }
    
    async performPeriodicSync() {
        try {
            // Don't sync if we're not in a project or switching projects
            if (!this.socket || !this.isConnected || !this.currentProject || !this.currentProject.id) {
                console.log('🔄 Skipping sync - no project or not connected');
                return;
            }
            
            const now = Date.now();
            this.periodicSync.lastSync = now;
            
            console.log('🔄 Starting periodic sync check...');
            console.log('🔄 Current project:', this.currentProject);
            console.log('🔄 Socket connected:', this.isConnected);
            console.log('🔄 Current sequence:', this.sequenceNumber);
            
            // Calculate current state hash
            const currentStateHash = this.calculateProjectStateHash();
            
            const syncData = {
                projectId: this.currentProject.id,
                sequenceNumber: this.sequenceNumber,
                stateHash: currentStateHash,
                timestamp: now
            };
            
            console.log('🔄 Sending sync_check with data:', syncData);
            
            this.socket.emit('sync_check', syncData);
            
        } catch (error) {
            console.error('❌ Periodic sync failed:', error);
            console.error('Error stack:', error.stack);
        }
    }
    
    calculateProjectStateHash() {
        // Create a hash of the current project state for comparison
        const nodes = this.graph.nodes.map(node => ({
            id: node.id,
            type: node.type,
            pos: node.pos,
            size: node.size,
            rotation: node.rotation || 0,
            properties: node.properties
        })).sort((a, b) => a.id - b.id); // Sort for consistent hashing
        
        const stateString = JSON.stringify(nodes);
        
        // Simple hash function (for production, use a proper crypto hash)
        let hash = 0;
        for (let i = 0; i < stateString.length; i++) {
            const char = stateString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        
        return hash.toString();
    }
    
    handleSyncResponse(data) {
        console.log('🔄 Received sync response:', data);
        
        const { projectId, needsSync, missedOperations, latestSequence, serverStateHash } = data;
        
        // Make sure this sync response is for our current project
        if (!this.currentProject || this.currentProject.id !== parseInt(projectId)) {
            console.log('🔄 Ignoring sync response for different project:', projectId, 'current:', this.currentProject?.id);
            return;
        }
        
        console.log('🔄 Sync response is for current project', projectId);
        
        if (needsSync) {
            console.log('🔄 Sync needed for project', projectId, '- missed operations:', missedOperations?.length || 0);
            
            if (missedOperations && missedOperations.length > 0) {
                // Apply missed operations in sequence
                console.log('🔄 Applying', missedOperations.length, 'missed operations...');
                this.applyMissedOperations(missedOperations);
            } else if (missedOperations === null) {
                // If we can't get operations, request full state
                console.log('🔄 No operations available, requesting full state');
                this.requestFullProjectState();
            }
        } else {
            console.log('🔄 No sync needed - client is up to date');
        }
        
        // Update our sequence number
        if (latestSequence > this.sequenceNumber) {
            console.log('🔄 Updating sequence number from', this.sequenceNumber, 'to', latestSequence);
            this.sequenceNumber = latestSequence;
        }
        
        // Update state hash
        this.periodicSync.lastKnownStateHash = serverStateHash;
    }
    
    applyMissedOperations(operations) {
        console.log('🔄 Applying', operations.length, 'missed operations');
        console.log('🔄 Current project:', this.currentProject?.id);
        console.log('🔄 Current nodes:', this.graph.nodes.length);
        
        const wasEnabled = this.enableCollaboration;
        this.enableCollaboration = false;
        
        try {
            for (const operation of operations) {
                console.log('🔄 Applying operation:', operation.operation?.type, 'seq:', operation.sequenceNumber);
                this.handleRemoteOperation(operation);
            }
            
            if (this.canvas) {
                this.canvas.dirty_canvas = true;
            }
            
            console.log('🔄 After applying operations, nodes:', this.graph.nodes.length);
            
        } finally {
            this.enableCollaboration = wasEnabled;
        }
    }
    
    requestFullProjectState() {
        console.log('🔄 Requesting full project state...');
        
        if (!this.socket || !this.currentProject) {
            console.warn('Cannot request project state - not connected or no current project');
            return;
        }
        
        // Ask other users in the project to share their state
        this.socket.emit('request_project_state', {
            projectId: this.currentProject.id,
            fromUser: this.currentUser?.userId
        });
    }
    
    // ===================================
    // CONNECTION HEALTH MONITORING
    // ===================================
    
    startHeartbeat() {
        this.stopHeartbeat();
        
        this.connectionHealth.timer = setInterval(() => {
            if (this.isConnected) {
                this.sendHeartbeat();
            }
        }, this.connectionHealth.heartbeatInterval);
    }
    
    stopHeartbeat() {
        if (this.connectionHealth.timer) {
            clearInterval(this.connectionHealth.timer);
            this.connectionHealth.timer = null;
        }
    }
    
    sendHeartbeat() {
        if (this.socket) {
            this.socket.emit('heartbeat', {
                timestamp: Date.now(),
                projectId: this.currentProject?.id
            });
        }
    }
    
    handleHeartbeatResponse() {
        this.connectionHealth.lastHeartbeat = Date.now();
        this.connectionHealth.missedHeartbeats = 0;
    }
    
    handleHeartbeatMissed() {
        this.connectionHealth.missedHeartbeats++;
        
        if (this.connectionHealth.missedHeartbeats >= this.connectionHealth.maxMissedHeartbeats) {
            console.warn('💔 Connection appears unhealthy, attempting reconnection');
            this.attemptReconnection();
        }
    }
    
    attemptReconnection() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket.connect();
        }
    }
    
    // Clean shutdown
    disconnect() {
        this.stopPeriodicSync();
        this.stopHeartbeat();
        
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        
        if (this.collaborationUI) {
            this.collaborationUI.remove();
            this.collaborationUI = null;
        }
        
        console.log('🤝 Collaborative manager disconnected');
    }
    
    // ===================================
    // AUTO-SAVE FUNCTIONALITY
    // ===================================
    
    startAutoSave() {
        if (!this.enableCollaboration) return;
        
        this.stopAutoSave(); // Clear any existing timer
        
        // Initialize debounced save
        this.debouncedSave = this.createDebouncedSave();
        
        // Track changes and save locally for recovery
        if (!this.hasChangeTracking) {
            this.setupChangeTracking();
        }
        
        // Set up periodic sync for reliability (every 5 seconds)
        this.autoSaveTimer = setInterval(() => {
            if (this.hasUnsavedChanges && this.currentProject) {
                this.saveCanvas();
            }
        }, 5000);
        
        // Set up beforeunload handler for unsaved changes
        window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
        
        console.log('💾 Real-time save enabled with recovery');
    }
    
    createDebouncedSave() {
        let saveTimeout;
        return () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                if (this.currentProject && this.hasUnsavedChanges) {
                    this.saveCanvas();
                }
            }, 1000); // Save 1 second after last change
        };
    }
    
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }
    
    setupChangeTracking() {
        // Mark as changed when any operation is sent
        const originalSendOperation = this.sendOperation.bind(this);
        this.sendOperation = (type, data) => {
            this.hasUnsavedChanges = true;
            
            // Save to local storage for recovery
            this.saveToLocalRecovery();
            
            // Trigger debounced save
            if (this.debouncedSave) {
                this.debouncedSave();
            }
            
            return originalSendOperation(type, data);
        };
        
        this.hasChangeTracking = true;
    }
    
    saveToLocalRecovery() {
        if (!this.currentProject) return;
        
        try {
            const recoveryData = {
                projectId: this.currentProject.id,
                canvasData: this.captureProjectState(),
                timestamp: Date.now()
            };
            
            localStorage.setItem('canvasRecovery', JSON.stringify(recoveryData));
        } catch (error) {
            console.warn('Failed to save recovery data:', error);
        }
    }
    
    async checkForRecovery() {
        try {
            const recoveryData = localStorage.getItem('canvasRecovery');
            if (!recoveryData) return false;
            
            const { projectId, canvasData, timestamp } = JSON.parse(recoveryData);
            
            // Check if recovery is recent (within 24 hours)
            const age = Date.now() - timestamp;
            if (age > 24 * 60 * 60 * 1000) {
                localStorage.removeItem('canvasRecovery');
                return false;
            }
            
            // Check if this is for current project
            if (this.currentProject && this.currentProject.id === projectId) {
                const recover = confirm('Found unsaved changes from your last session. Would you like to recover them?');
                if (recover) {
                    this.stateManager.loadState(canvasData);
                    this.hasUnsavedChanges = true;
                    this.saveCanvas(); // Save recovered state
                }
                localStorage.removeItem('canvasRecovery');
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to check recovery:', error);
            return false;
        }
    }
    
    handleBeforeUnload(event) {
        if (this.hasUnsavedChanges) {
            // Save one last time
            this.saveToLocalRecovery();
            
            // Most browsers ignore custom messages now, but we still need to set it
            const message = 'Changes are being saved...';
            event.returnValue = message;
            return message;
        }
    }
    
    async saveCanvas() {
        console.log('💾 saveCanvas called, currentProject:', this.currentProject?.id, 'hasUnsavedChanges:', this.hasUnsavedChanges);
        
        if (!this.currentProject) {
            console.log('⚠️ No current project, skipping save');
            return;
        }
        
        if (!this.hasUnsavedChanges) {
            console.log('⚠️ No unsaved changes, skipping save');
            return;
        }
        
        try {
            console.log('💾 Auto-saving canvas...');
            
            // Capture current state
            const canvasData = this.captureProjectState();
            console.log('💾 Canvas data captured, nodes:', canvasData.nodes?.length);
            
            console.log('💾 Sending save request to:', CONFIG.ENDPOINTS.PROJECT_CANVAS(this.currentProject.id));
            
            const response = await fetch(CONFIG.ENDPOINTS.PROJECT_CANVAS(this.currentProject.id), {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    canvas_data: canvasData,
                    userId: this.currentUser?.id || 1
                })
            });
            
            console.log('💾 Save response status:', response.status);
            
            if (response.ok) {
                this.hasUnsavedChanges = false;
                this.lastSaveTime = Date.now();
                this.showStatus('Canvas saved', 'success');
                console.log('✅ Canvas auto-saved successfully');
                
                // Verify save by fetching back
                const verifyResponse = await fetch(CONFIG.ENDPOINTS.PROJECT_CANVAS(this.currentProject.id));
                if (verifyResponse.ok) {
                    const verifyData = await verifyResponse.json();
                    console.log('✅ Save verified, nodes in DB:', verifyData.canvas_data?.nodes?.length || 0);
                }
            } else {
                const errorText = await response.text();
                console.error('❌ Failed to auto-save canvas:', response.status, errorText);
                this.showStatus('Auto-save failed', 'error');
            }
        } catch (error) {
            console.error('❌ Auto-save error:', error);
            this.showStatus('Auto-save error', 'error');
        }
    }
    
    async loadCanvas(projectId) {
        try {
            console.log('📥 Loading canvas for project:', projectId);
            
            const response = await fetch(CONFIG.ENDPOINTS.PROJECT_CANVAS(projectId));
            
            if (!response.ok) {
                throw new Error(`Failed to load canvas: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.canvas_data) {
                // Clear current canvas
                this.graph.clear();
                
                // Load the saved state with external data
                await this.stateManager.loadState(this.graph, this.canvas, data.canvas_data);
                
                console.log('✅ Canvas loaded successfully');
                this.showStatus('Canvas loaded', 'success');
                
                // Reset save tracking
                this.hasUnsavedChanges = false;
                this.lastSaveTime = Date.now();
                
                // Check for recovery after loading
                setTimeout(() => this.checkForRecovery(), 500);
            } else {
                console.log('ℹ️ No saved canvas data for this project');
            }
        } catch (error) {
            console.error('❌ Failed to load canvas:', error);
            this.showStatus('Failed to load canvas', 'error');
        }
    }
    
    // Manual save method
    async save() {
        this.hasUnsavedChanges = true;
        await this.saveCanvas();
    }
    
    // Mark canvas as modified and trigger save
    markModified() {
        console.log('📝 markModified called');
        console.log('📝 currentProject:', this.currentProject);
        console.log('📝 isConnected:', this.isConnected);
        
        this.hasUnsavedChanges = true;
        if (this.debouncedSave) {
            console.log('📝 Calling debouncedSave...');
            this.debouncedSave();
        } else {
            console.log('⚠️ No debouncedSave function available');
        }
    }
}

// Make it globally available
window.CollaborativeManager = CollaborativeManager; 