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
        
        this.init();
    }
    
    async init() {
        console.log('🤝 Collaborative manager initializing...');
        
        // Check if Socket.IO is available
        if (typeof io === 'undefined') {
            console.log('📡 Socket.IO not loaded - running in single-user mode');
            this.setupSingleUserMode();
            return;
        }
        
        // Check if collaborative server is available
        try {
            const response = await fetch('http://localhost:3000/health');
            const health = await response.json();
            
            if (health.status === 'ok') {
                console.log('🌐 Collaborative server detected - enabling real-time features');
                this.enableCollaboration = true;
                this.setupCollaborativeMode();
            } else {
                this.setupSingleUserMode();
            }
        } catch (error) {
            console.log('📱 No collaborative server - running in single-user mode');
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
            min-width: 200px;
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
            this.socket = io('http://localhost:3000');
            
            this.socket.on('connect', () => {
                this.isConnected = true;
                this.showStatus('Connected', 'success');
                console.log('🔌 Connected to collaborative server');
                
                // Auto-join demo project
                this.joinProject('demo-project', 'user-' + Math.random().toString(36).substr(2, 9));
            });
            
            this.socket.on('disconnect', () => {
                this.isConnected = false;
                this.showStatus('Disconnected', 'error');
                this.otherUsers.clear();
                this.updateUserList();
                console.log('🔌 Disconnected from collaborative server');
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
            this.currentProject = data.project;
            this.currentUser = data.session;
            this.sequenceNumber = data.sequenceNumber;
            
            this.showStatus(`Connected to ${data.project.name || 'Untitled Project'}`, 'success');
            this.updateUserList();
            
            console.log('🎯 Joined project:', data);
        });
        
        this.socket.on('user_joined', (user) => {
            this.otherUsers.set(user.userId, user);
            this.updateUserList();
            console.log('👋 User joined:', user.displayName);
        });
        
        this.socket.on('user_left', (user) => {
            this.otherUsers.delete(user.userId);
            this.updateUserList();
            console.log('👋 User left:', user.username);
        });
        
        this.socket.on('active_users', (users) => {
            this.otherUsers.clear();
            users.forEach(user => {
                if (user.userId !== this.currentUser?.userId) {
                    this.otherUsers.set(user.userId, user);
                }
            });
            this.updateUserList();
        });
        
        // Canvas operation events
        this.socket.on('canvas_operation', (data) => {
            this.handleRemoteOperation(data);
        });
        
        // Cursor and selection events
        this.socket.on('cursor_update', (data) => {
            if (this.enableCursorSharing) {
                this.handleRemoteCursor(data);
            }
        });
        
        this.socket.on('selection_update', (data) => {
            if (this.enableSelectionSharing) {
                this.handleRemoteSelection(data);
            }
        });
        
        this.socket.on('viewport_update', (data) => {
            if (this.enableViewportSharing) {
                this.handleRemoteViewport(data);
            }
        });
    }
    
    joinProject(projectId, username, displayName = null) {
        if (!this.socket || !this.isConnected) {
            console.warn('Cannot join project: not connected');
            return;
        }
        
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
        
        console.log('📥 Remote operation:', data);
        
        // Apply operation to canvas
        // This would integrate with the existing canvas operations
        // For now, just log it
        
        // Update sequence number
        this.sequenceNumber = Math.max(this.sequenceNumber, data.sequenceNumber);
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
    
    // Clean shutdown
    disconnect() {
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
}

// Make it globally available
window.CollaborativeManager = CollaborativeManager; 