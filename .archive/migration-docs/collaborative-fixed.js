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
        if (!this._hasValidSession) {
            console.warn('⚠️ Cannot broadcast - no valid session');
            return;
        }
        
        const operation = {
            type: operationType,
            data: operationData,
            timestamp: Date.now(),
            sequence: this.sequenceNumber // Server will assign actual sequence
        };
        
        // Send to server
        this.socket.emit('canvas_operation', {
            projectId: this.currentProject.id,
            operation: operation
        });
        
        console.log(`📤 Broadcast operation: ${operationType}`);
        
        return operation;
    }
    
    applyRemoteOperation(operation) {
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
                case 'node_delete':
                    this.applyNodeDelete(operation.data);
                    break;
                case 'node_update':
                    this.applyNodeUpdate(operation.data);
                    break;
                case 'state_sync':
                    this.applyStateSync(operation.data);
                    break;
                default:
                    console.warn('Unknown operation type:', operation.type);
            }
            
            // Trigger canvas redraw
            if (this.graph.canvas) {
                this.graph.canvas.setDirty(true, true);
            }
            
        } catch (error) {
            console.error('Error applying remote operation:', error);
        }
    }
    
    // Operation handlers
    applyNodeCreate(data) {
        const existingNode = this.graph._nodes.find(n => n.id === data.nodeData.id);
        if (existingNode) {
            console.log('Node already exists:', data.nodeData.id);
            return;
        }
        
        const node = LiteGraph.createNode(data.nodeData.type);
        if (node) {
            node.id = data.nodeData.id;
            node.pos = [...data.nodeData.pos];
            node.size = [...data.nodeData.size];
            
            if (data.nodeData.properties) {
                Object.assign(node.properties, data.nodeData.properties);
            }
            
            this.graph.add(node);
            console.log('✅ Created remote node:', node.id);
        }
    }
    
    applyNodeMove(data) {
        const node = this.graph.getNodeById(data.nodeId);
        if (node) {
            node.pos = [...data.position];
            console.log('✅ Moved remote node:', node.id);
        }
    }
    
    applyNodeResize(data) {
        const node = this.graph.getNodeById(data.nodeId);
        if (node) {
            node.size = [...data.size];
            console.log('✅ Resized remote node:', node.id);
        }
    }
    
    applyNodeDelete(data) {
        const node = this.graph.getNodeById(data.nodeId);
        if (node) {
            this.graph.remove(node);
            console.log('✅ Deleted remote node:', data.nodeId);
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
    
    applyStateSync(data) {
        console.log('📊 Applying full state sync');
        // This would be a complete state replacement
        // Implementation depends on your specific needs
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