/**
 * NetworkLayer - Handles all network communication
 * Completely separated from operation execution logic
 */
class NetworkLayer {
    constructor(app) {
        this.app = app;
        this.socket = null;
        this.isConnected = false;
        this.currentProject = null;
        this.currentUser = null;
        
        // Connection settings
        this.serverUrl = 'http://localhost:3000';
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 30000;
        this.reconnectAttempts = 0;
        
        // Session management
        this.sessionId = this.generateSessionId();
        this.tabId = window.__imageCanvasTabId || this.generateTabId();
        
        console.log(`🌐 NetworkLayer initialized (tab: ${this.tabId})`);
    }
    
    /**
     * Generate unique session ID
     */
    generateSessionId() {
        return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Generate unique tab ID
     */
    generateTabId() {
        const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        window.__imageCanvasTabId = id;
        return id;
    }
    
    /**
     * Connect to server
     */
    async connect() {
        return new Promise((resolve, reject) => {
            try {
                this.socket = io(this.serverUrl, {
                    transports: ['websocket'],
                    reconnection: true,
                    reconnectionDelay: this.reconnectDelay,
                    reconnectionDelayMax: this.maxReconnectDelay
                });
                
                this.setupEventHandlers();
                
                this.socket.on('connect', () => {
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    console.log('✅ Connected to server');
                    
                    // Send session info
                    this.socket.emit('session_init', {
                        sessionId: this.sessionId,
                        tabId: this.tabId,
                        userId: this.currentUser?.id
                    });
                    
                    resolve();
                });
                
                this.socket.on('connect_error', (error) => {
                    this.reconnectAttempts++;
                    console.error('❌ Connection error:', error.message);
                    if (this.reconnectAttempts === 1) {
                        reject(error);
                    }
                });
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    /**
     * Setup socket event handlers
     */
    setupEventHandlers() {
        // Connection events
        this.socket.on('disconnect', () => {
            this.isConnected = false;
            console.log('🔌 Disconnected from server');
            this.app.updateConnectionStatus('disconnected');
        });
        
        this.socket.on('reconnect', () => {
            console.log('🔄 Reconnected to server');
            this.app.updateConnectionStatus('connected');
            
            // Re-join current project if any
            if (this.currentProject) {
                this.joinProject(this.currentProject.id);
            }
        });
        
        // Operation events
        this.socket.on('operation', (data) => {
            this.handleIncomingOperation(data);
        });
        
        // Project events
        this.socket.on('project_joined', (data) => {
            console.log('📁 Joined project:', data.projectId);
            this.currentProject = { id: data.projectId };
        });
        
        this.socket.on('project_left', () => {
            console.log('📁 Left project');
            this.currentProject = null;
        });
        
        // User events
        this.socket.on('users_update', (data) => {
            this.app.updateActiveUsers(data.users);
        });
        
        // State sync events
        this.socket.on('state_sync', (data) => {
            this.handleStateSync(data);
        });
        
        // Error events
        this.socket.on('error_message', (data) => {
            console.error('⚠️ Server error:', data.message);
            this.app.showError(data.message);
        });
    }
    
    /**
     * Broadcast a command to other clients
     */
    broadcast(command) {
        if (!this.isConnected || !this.currentProject) {
            console.warn('Cannot broadcast: not connected or not in project');
            return;
        }
        
        const data = {
            projectId: this.currentProject.id,
            operation: {
                id: command.id,
                type: command.type,
                params: command.params,
                timestamp: command.timestamp,
                tabId: this.tabId,
                userId: this.currentUser?.id
            }
        };
        
        this.socket.emit('operation', data);
        console.log(`📤 Broadcast: ${command.type}`);
    }
    
    /**
     * Handle incoming operation from server
     */
    handleIncomingOperation(data) {
        // Ignore our own operations (by tab ID)
        if (data.operation.tabId === this.tabId) {
            console.log(`🔄 Ignoring own operation: ${data.operation.type}`);
            return;
        }
        
        console.log(`📥 Received: ${data.operation.type} from tab ${data.operation.tabId}`);
        
        // Create command from remote data
        try {
            const command = this.app.operationPipeline.createCommand(
                data.operation.type,
                data.operation.params,
                'remote'
            );
            
            // Preserve original metadata
            command.id = data.operation.id;
            command.timestamp = data.operation.timestamp;
            
            // Execute through pipeline
            this.app.operationPipeline.execute(command, null, {
                skipBroadcast: true,
                skipHistory: true
            }).catch(error => {
                console.error('Failed to apply remote operation:', error);
            });
            
        } catch (error) {
            console.error('Failed to create command from remote operation:', error);
        }
    }
    
    /**
     * Handle state synchronization
     */
    handleStateSync(data) {
        console.log('🔄 Received state sync');
        
        if (this.app.handleStateSync) {
            this.app.handleStateSync(data.state);
        }
    }
    
    /**
     * Join a project
     */
    joinProject(projectId, canvasId = null) {
        if (!this.isConnected) {
            console.warn('Cannot join project: not connected');
            return;
        }
        
        this.socket.emit('join_project', {
            projectId,
            canvasId,
            tabId: this.tabId,
            userId: this.currentUser?.id
        });
    }
    
    /**
     * Leave current project
     */
    leaveProject() {
        if (!this.isConnected || !this.currentProject) {
            return;
        }
        
        this.socket.emit('leave_project', {
            projectId: this.currentProject.id,
            tabId: this.tabId
        });
        
        this.currentProject = null;
    }
    
    /**
     * Request state sync
     */
    requestStateSync() {
        if (!this.isConnected || !this.currentProject) {
            console.warn('Cannot request state sync: not connected or not in project');
            return;
        }
        
        this.socket.emit('request_state_sync', {
            projectId: this.currentProject.id
        });
    }
    
    /**
     * Set current user
     */
    setUser(user) {
        this.currentUser = user;
        
        if (this.isConnected) {
            this.socket.emit('user_update', {
                userId: user?.id,
                tabId: this.tabId
            });
        }
    }
    
    /**
     * Disconnect from server
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        
        this.isConnected = false;
        this.currentProject = null;
    }
    
    /**
     * Get connection status
     */
    getStatus() {
        return {
            connected: this.isConnected,
            project: this.currentProject,
            user: this.currentUser,
            tabId: this.tabId,
            sessionId: this.sessionId
        };
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.NetworkLayer = NetworkLayer;
}