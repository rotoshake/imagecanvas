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
        
        // Heartbeat settings
        this.heartbeatInterval = null;
        this.heartbeatTimeout = null;
        this.lastPingTime = null;
        this.lastPongTime = null;
        this.connectionQuality = 'unknown'; // excellent, good, poor, critical, unknown
        this.pingLatencies = []; // Track last 5 ping times for averaging
        
        // Session management
        this.sessionId = this.generateSessionId();
        this.tabId = window.__imageCanvasTabId || this.generateTabId();
        
        // Event handlers for state-based sync
        this.eventHandlers = new Map();
        
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
     * Initialize the network layer and connect to server
     */
    initialize() {
        console.log('🌐 NetworkLayer.initialize() called');
        // Connect to the server
        this.connect().catch(error => {
            console.error('❌ Failed to connect during initialization:', error);
        });
    }
    
    /**
     * Connect to server
     */
    async connect() {
        return new Promise((resolve, reject) => {
            try {
                // Check if Socket.IO is available
                if (typeof io === 'undefined') {
                    console.error('❌ Socket.IO not loaded - cannot connect');
                    reject(new Error('Socket.IO not available'));
                    return;
                }
                
                console.log(`🔌 Attempting to connect to ${this.serverUrl}...`);
                
                // Update status to connecting
                if (this.app.updateConnectionStatus) {
                    this.app.updateConnectionStatus('connecting');
                }
                
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
                    
                    // Start heartbeat monitoring
                    this.startHeartbeat();
                    
                    // Update status to connected
                    if (this.app.updateConnectionStatus) {
                        this.app.updateConnectionStatus('connected');
                    }
                    
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
                    
                    // Update status to error
                    if (this.app.updateConnectionStatus) {
                        this.app.updateConnectionStatus('error');
                    }
                    
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
            
            // Stop heartbeat monitoring
            this.stopHeartbeat();
            
            this.app.updateConnectionStatus('disconnected');
        });
        
        this.socket.on('reconnect', () => {
            console.log('🔄 Reconnected to server');
            
            // Restart heartbeat monitoring
            this.startHeartbeat();
            
            this.app.updateConnectionStatus('connected');
            
            // Re-join current project if any
            if (this.currentProject) {
                this.joinProject(this.currentProject.id);
            }
        });
        
        // Operation events - DISABLED in favor of state sync
        // this.socket.on('canvas_operation', (data) => {
        //     this.handleIncomingOperation(data);
        // });
        
        // Project events
        this.socket.on('project_joined', (data) => {
            console.log('📁 Received project_joined event:', data);
            // Server sends data.project object, not data.projectId
            if (data.project && data.project.id) {
                this.currentProject = { id: data.project.id };
                console.log('✅ Current project set to:', this.currentProject);
                
                // Request full state sync after joining project
                if (this.app.stateSyncManager) {
                    console.log('📥 Requesting initial state sync...');
                    this.app.stateSyncManager.requestFullSync();
                }
            } else {
                console.warn('⚠️ Invalid project_joined data:', data);
            }
            
            // Forward to local event handlers (e.g., ClientUndoManager)
            this.emitLocal('project_joined', data);
        });
        
        this.socket.on('project_left', () => {
            console.log('📁 Left project');
            this.currentProject = null;
        });
        
        // User events
        this.socket.on('users_update', (data) => {
            this.app.updateActiveUsers(data.users);
        });
        
        // Legacy state sync events
        this.socket.on('state_sync', (data) => {
            this.handleStateSync(data);
        });
        
        // New state-based sync events
        this.socket.on('state_update', (data) => {
            this.emitLocal('state_update', data);
        });
        
        this.socket.on('operation_ack', (data) => {
            this.emitLocal('operation_ack', data);
        });
        
        this.socket.on('operation_rejected', (data) => {
            this.emitLocal('operation_rejected', data);
        });
        
        this.socket.on('full_state_sync', (data) => {
            this.emitLocal('full_state_sync', data);
        });
        
        // Undo/redo events
        this.socket.on('undo_state_update', (data) => {
            console.log('📨 NetworkLayer: Forwarding undo_state_update:', data);
            this.emitLocal('undo_state_update', data);
        });
        
        this.socket.on('undo_success', (data) => {
            this.emitLocal('undo_success', data);
        });
        
        this.socket.on('undo_failed', (data) => {
            this.emitLocal('undo_failed', data);
        });
        
        this.socket.on('redo_success', (data) => {
            this.emitLocal('redo_success', data);
        });
        
        this.socket.on('redo_failed', (data) => {
            this.emitLocal('redo_failed', data);
        });
        
        // Undo history event for debug HUD
        this.socket.on('undo_history', (data) => {
            console.log('📨 NetworkLayer: Forwarding undo_history:', data);
            this.emitLocal('undo_history', data);
        });
        
        // Error events
        this.socket.on('error_message', (data) => {
            console.error('⚠️ Server error:', data.message);
            this.app.showError(data.message);
        });
        
        // Heartbeat events
        this.socket.on('pong', (timestamp) => {
            this.handlePong(timestamp);
        });
    }
    
    /**
     * Add event listener (for state-based operations)
     */
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }
    
    /**
     * Remove event listener
     */
    off(event, handler) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }
    
    /**
     * Emit to local handlers
     */
    emitLocal(event, data) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Error in ${event} handler:`, error);
                }
            });
        }
    }
    
    /**
     * Emit to server
     */
    emit(event, data) {
        if (!this.socket) return;
        this.socket.emit(event, data);
    }
    
    /**
     * Broadcast a command to other clients
     */
    broadcast(command) {
        if (!this.isConnected) {
            console.warn('Cannot broadcast: not connected to server');
            console.log('Connection status:', this.getStatus());
            return;
        }
        
        if (!this.currentProject) {
            console.warn('Cannot broadcast: not in a project');
            console.log('Current project:', this.currentProject);
            console.log('Full status:', this.getStatus());
            return;
        }
        
        const data = {
            projectId: this.currentProject.id,
            operation: {
                id: command.id,
                type: command.type,
                data: command.params,  // Server expects 'data' not 'params'
                timestamp: command.timestamp,
                tabId: this.tabId,
                userId: this.currentUser?.id
            }
        };
        
        // Server expects 'canvas_operation' not 'operation'
        this.socket.emit('canvas_operation', data);
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
                data.operation.data,  // Server sends 'data' not 'params'
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
        console.log(`📁 NetworkLayer.joinProject called: projectId=${projectId}, canvasId=${canvasId}`);
        
        if (!this.isConnected) {
            console.warn('Cannot join project: not connected');
            return;
        }
        
        // Get the user ID from the canvas navigator if available
        const userId = this.app.canvasNavigator?.userId || this.currentUser?.id;
        const username = userId || `user-${this.tabId.substr(-8)}`;
        
        const data = {
            projectId,
            canvasId,
            tabId: this.tabId,
            userId: userId,
            // Server expects username and displayName
            username: username,
            displayName: this.currentUser?.displayName || username
        };
        
        console.log('📤 Emitting join_project:', data);
        this.socket.emit('join_project', data);
        
        // Add a timeout check
        setTimeout(() => {
            if (!this.currentProject || this.currentProject.id != projectId) {
                console.warn(`⚠️ Project ${projectId} not joined after 2 seconds. Current project:`, this.currentProject);
            } else {
                console.log(`✅ Successfully joined project ${projectId}`);
            }
        }, 2000);
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
     * Start heartbeat monitoring
     */
    startHeartbeat() {
        // Clear any existing heartbeat
        this.stopHeartbeat();
        
        // Reset connection quality
        this.connectionQuality = 'unknown';
        this.pingLatencies = [];
        
        // Send initial ping immediately
        this.sendPing();
        
        // Set up regular pings every 30 seconds
        this.heartbeatInterval = setInterval(() => {
            this.sendPing();
        }, 30000);
        
        console.log('💓 Heartbeat monitoring started');
    }
    
    /**
     * Stop heartbeat monitoring
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatTimeout = null;
        }
        
        this.connectionQuality = 'unknown';
        console.log('💓 Heartbeat monitoring stopped');
    }
    
    /**
     * Send ping to server
     */
    sendPing() {
        if (!this.isConnected || !this.socket) {
            return;
        }
        
        const timestamp = Date.now();
        this.lastPingTime = timestamp;
        
        // Set timeout for pong response (10 seconds)
        this.heartbeatTimeout = setTimeout(() => {
            console.warn('💓 Ping timeout - connection may be degraded');
            this.connectionQuality = 'critical';
            this.updateConnectionQuality();
            
            // If we haven't received a pong in 30 seconds, consider connection lost
            if (this.lastPongTime && (Date.now() - this.lastPongTime > 30000)) {
                console.error('💓 Connection appears dead, triggering manual reconnect');
                this.socket.disconnect();
                this.socket.connect();
            }
        }, 10000);
        
        // Send ping with timestamp
        this.socket.emit('ping', timestamp);
    }
    
    /**
     * Handle pong response from server
     */
    handlePong(timestamp) {
        if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatTimeout = null;
        }
        
        const now = Date.now();
        const latency = now - timestamp;
        this.lastPongTime = now;
        
        // Track latency for quality assessment
        this.pingLatencies.push(latency);
        if (this.pingLatencies.length > 5) {
            this.pingLatencies.shift(); // Keep only last 5 measurements
        }
        
        // Calculate average latency
        const avgLatency = this.pingLatencies.reduce((a, b) => a + b, 0) / this.pingLatencies.length;
        
        // Determine connection quality
        let newQuality;
        if (avgLatency < 100) {
            newQuality = 'excellent';
        } else if (avgLatency < 300) {
            newQuality = 'good';
        } else if (avgLatency < 1000) {
            newQuality = 'poor';
        } else {
            newQuality = 'critical';
        }
        
        // Only update if quality changed
        if (newQuality !== this.connectionQuality) {
            this.connectionQuality = newQuality;
            this.updateConnectionQuality();
        }
        
        console.log(`💓 Pong received: ${latency}ms (avg: ${Math.round(avgLatency)}ms, quality: ${this.connectionQuality})`);
    }
    
    /**
     * Update connection status with quality info
     */
    updateConnectionQuality() {
        if (!this.app.updateConnectionStatus) return;
        
        const qualityMessages = {
            excellent: null, // Don't show notification for excellent connections
            good: null,      // Don't show notification for good connections
            poor: 'Connection quality is poor',
            critical: 'Connection quality is critical',
            unknown: null
        };
        
        const message = qualityMessages[this.connectionQuality];
        if (message && this.isConnected) {
            // Show a warning notification but keep status as connected
            if (window.unifiedNotifications) {
                window.unifiedNotifications.warning(message, {
                    duration: 5000,
                    id: 'connection-quality'
                });
            }
        }
    }
    
    /**
     * Cleanup resources
     */
    cleanup() {
        console.log('🧹 Cleaning up NetworkLayer...');
        
        // Stop heartbeat
        this.stopHeartbeat();
        
        // Clear event handlers
        this.eventHandlers.clear();
        
        // Disconnect socket
        this.disconnect();
        
        // Clear references
        this.app = null;
        this.currentUser = null;
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