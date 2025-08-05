/**
 * NetworkLayer - Handles all network communication
 * Completely separated from operation execution logic
 */
class NetworkLayer {
    constructor(app) {
        this.app = app;
        this.socket = null;
        this.isConnected = false;
        this.currentCanvas = null;
        this.currentUser = null;
        
        // Connection settings - use same host as page, but on port 3000
        this.serverUrl = window.location.hostname === 'localhost' 
            ? 'http://localhost:3000' 
            : `http://${window.location.hostname}:3000`;
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 30000;
        this.reconnectAttempts = 0;
        
        // Enhanced reconnection settings
        this.customReconnectionEnabled = true;
        this.customReconnectAttempts = 0;
        this.customReconnectInterval = null;
        this.baseReconnectDelay = 1000; // Start with 1 second
        this.maxCustomReconnectDelay = 30000; // Max 30 seconds between attempts
        this.backgroundReconnectInterval = 30000; // Background retry every 30s
        this.isManuallyDisconnected = false;
        
        // Heartbeat settings (improved)
        this.heartbeatInterval = null;
        this.heartbeatTimeout = null;
        this.lastPingTime = null;
        this.lastPongTime = null;
        this.connectionQuality = 'unknown'; // excellent, good, poor, critical, unknown
        this.pingLatencies = []; // Track last 5 ping times for averaging
        this.heartbeatFrequency = 10000; // Reduced from 30s to 10s for faster detection
        
        // Session management
        this.sessionId = this.generateSessionId();
        this.tabId = window.__imageCanvasTabId || this.generateTabId();
        
        // Event handlers for state-based sync
        this.eventHandlers = new Map();
        
        // Setup page visibility and focus handling for smart reconnection
        this.setupVisibilityHandling();
        
        // NetworkLayer initialized
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
        // NetworkLayer.initialize() called
        // Connect to the server
        this.connect().catch(error => {
            console.error('Failed to connect during initialization:', error);
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
                    console.error('Socket.IO not loaded - cannot connect');
                    reject(new Error('Socket.IO not available'));
                    return;
                }

                // Update status to connecting
                if (this.app.updateConnectionStatus) {
                    this.app.updateConnectionStatus('connecting');
                }
                
                this.socket = io(this.serverUrl, {
                    transports: ['websocket'],
                    reconnection: false, // Disable Socket.IO reconnection - we'll handle it ourselves
                    timeout: 20000 // 20 second connection timeout
                });
                
                this.setupEventHandlers();
                
                this.socket.on('connect', () => {
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.customReconnectAttempts = 0; // Reset custom counter
                    this.clearCustomReconnectTimer(); // Stop custom reconnection attempts
                    
                    // Start heartbeat monitoring
                    this.startHeartbeat();
                    
                    // Update status to connected
                    if (this.app.updateConnectionStatus) {
                        this.app.updateConnectionStatus('connected');
                    }
                    
                    // Emit local connect event for other components
                    this.emitLocal('connect');
                    
                    // Send session info
                    this.socket.emit('session_init', {
                        sessionId: this.sessionId,
                        tabId: this.tabId,
                        userId: this.currentUser?.id
                    });
                    
                    // If we were in a canvas before disconnection, rejoin it
                    if (this.currentCanvas && this.currentUser) {
                        
                        setTimeout(() => {
                            this.joinCanvas(
                                this.currentCanvas.id
                            );
                        }, 100); // Small delay to ensure session_init is processed first
                    }
                    
                    resolve();
                });
                
                this.socket.on('connect_error', (error) => {
                    this.reconnectAttempts++;
                    console.error('Connection error:', error.message);
                    
                    // Update status to error with reconnection info
                    if (this.app.updateConnectionStatus) {
                        this.app.updateConnectionStatus('error', `Connection failed - retrying automatically`);
                    }
                    
                    // Start custom reconnection if not already running
                    if (this.customReconnectionEnabled && !this.isManuallyDisconnected) {
                        this.startCustomReconnection();
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
        this.socket.on('disconnect', (reason) => {
            this.isConnected = false;
            
            // Stop heartbeat monitoring
            this.stopHeartbeat();
            
            // Update status with reconnection info
            this.app.updateConnectionStatus('disconnected', 'Attempting to reconnect...');
            
            // Start custom reconnection if not manually disconnected
            if (this.customReconnectionEnabled && !this.isManuallyDisconnected) {
                this.startCustomReconnection();
            }
        });
        
        // Note: 'reconnect' event removed since we disabled Socket.IO's auto-reconnection
        // Our custom reconnection logic handles this in the 'connect' event
        
        // Operation events - DISABLED in favor of state sync
        // this.socket.on('canvas_operation', (data) => {
        //     this.handleIncomingOperation(data);
        // });
        
        // Project events
        this.socket.on('canvas_joined', (data) => {
            // Received canvas_joined event
            // Server sends data.canvas object, not data.canvasId
            if (data.canvas && data.canvas.id) {
                this.currentCanvas = { id: data.canvas.id };
                // Current canvas set
                
                // Request full state sync after joining project
                if (this.app.stateSyncManager) {
                    // Requesting initial state sync
                    this.app.stateSyncManager.requestFullSync();
                }
            } else {
                
            }
            
            // Forward to local event handlers (e.g., ClientUndoManager)
            this.emitLocal('canvas_joined', data);
        });
        
        this.socket.on('canvas_left', () => {
            // Left canvas
            this.currentCanvas = null;
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
            // NetworkLayer: Forwarding undo_state_update
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
            // NetworkLayer: Forwarding undo_history
            this.emitLocal('undo_history', data);
        });
        
        // Error events
        this.socket.on('error_message', (data) => {
            console.error('Server error:', data.message);
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
            
            console.log('Connection status:', this.getStatus());
            return;
        }
        
        if (!this.currentCanvas) {
            
            console.log('Full status:', this.getStatus());
            return;
        }
        
        const data = {
            canvasId: this.currentCanvas.id,
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
        // Broadcast operation
    }
    
    /**
     * Handle incoming operation from server
     */
    handleIncomingOperation(data) {
        // Ignore our own operations (by tab ID)
        if (data.operation.tabId === this.tabId) {
            // Ignoring own operation
            return;
        }
        
        // Received remote operation
        
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
        // Received state sync
        
        if (this.app.handleStateSync) {
            this.app.handleStateSync(data.state);
        }
    }
    
    /**
     * Join a canvas
     */
    joinCanvas(canvasId) {
        // NetworkLayer.joinCanvas called
        
        if (!this.isConnected) {
            
            return;
        }
        
        // Get the user ID from the canvas navigator if available
        const userId = this.app.canvasNavigator?.userId || this.currentUser?.id;
        const username = userId || `user-${this.tabId.substr(-8)}`;
        
        const data = {
            canvasId: canvasId,
            tabId: this.tabId,
            userId: userId,
            // Server expects username and displayName
            username: username,
            displayName: this.currentUser?.displayName || username
        };
        
        // Emitting join_canvas
        this.socket.emit('join_canvas', data);
        
        // Add a timeout check
        setTimeout(() => {
            if (!this.currentCanvas || this.currentCanvas.id != canvasId) {
                
            } else {
                
            }
        }, 2000);
    }
    
    /**
     * Leave current canvas
     */
    leaveCanvas() {
        if (!this.isConnected || !this.currentCanvas) {
            return;
        }
        
        this.socket.emit('leave_canvas', {
            canvasId: this.currentCanvas.id,
            tabId: this.tabId
        });
        
        this.currentCanvas = null;
    }
    
    /**
     * Request state sync
     */
    requestStateSync() {
        if (!this.isConnected || !this.currentCanvas) {
            
            return;
        }
        
        this.socket.emit('request_state_sync', {
            canvasId: this.currentCanvas.id
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
    disconnect(manual = false) {
        this.isManuallyDisconnected = manual;
        
        // Stop custom reconnection if manually disconnecting
        if (manual) {
            this.clearCustomReconnectTimer();
            this.customReconnectionEnabled = false;
        }
        
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        
        this.isConnected = false;
        this.currentCanvas = null;
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
        
        // Set up regular pings using improved frequency (10 seconds)
        this.heartbeatInterval = setInterval(() => {
            this.sendPing();
        }, this.heartbeatFrequency);
        
        // Heartbeat monitoring started
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
        // Heartbeat monitoring stopped
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
            
            this.connectionQuality = 'critical';
            this.updateConnectionQuality();
            
            // If we haven't received a pong in 30 seconds, consider connection lost
            if (this.lastPongTime && (Date.now() - this.lastPongTime > 30000)) {
                console.error('Connection appears dead, triggering manual reconnect');
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
        // Use more lenient thresholds for local development
        const isLocal = this.serverUrl.includes('localhost') || this.serverUrl.includes('127.0.0.1');
        let newQuality;
        
        if (isLocal) {
            // More lenient thresholds for local development
            if (avgLatency < 200) {
                newQuality = 'excellent';
            } else if (avgLatency < 500) {
                newQuality = 'good';
            } else if (avgLatency < 2000) {
                newQuality = 'poor';
            } else {
                newQuality = 'critical';
            }
        } else {
            // Production thresholds
            if (avgLatency < 100) {
                newQuality = 'excellent';
            } else if (avgLatency < 300) {
                newQuality = 'good';
            } else if (avgLatency < 1000) {
                newQuality = 'poor';
            } else {
                newQuality = 'critical';
            }
        }
        
        // Only update if quality changed
        if (newQuality !== this.connectionQuality) {
            this.connectionQuality = newQuality;
            this.updateConnectionQuality();
        }
        
        // Pong received
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
     * Setup page visibility and focus handling for smart reconnection
     */
    setupVisibilityHandling() {
        // Reconnect when page becomes visible after being hidden
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && !this.isConnected && !this.isManuallyDisconnected) {
                
                this.attemptReconnection('Page visibility');
            }
        });
        
        // Reconnect when window gains focus
        window.addEventListener('focus', () => {
            if (!this.isConnected && !this.isManuallyDisconnected) {
                
                this.attemptReconnection('Window focus');
            }
        });
        
        // Reconnect when browser reports we're back online
        window.addEventListener('online', () => {
            if (!this.isConnected && !this.isManuallyDisconnected) {
                
                this.attemptReconnection('Network online');
            }
        });
    }
    
    /**
     * Start custom reconnection with exponential backoff
     */
    startCustomReconnection() {
        if (this.customReconnectInterval || this.isManuallyDisconnected) {
            return; // Already running or manually disconnected
        }
        
        // Starting custom reconnection logic
        this.scheduleNextReconnection();
    }
    
    /**
     * Schedule the next reconnection attempt with exponential backoff
     */
    scheduleNextReconnection() {
        this.clearCustomReconnectTimer();
        
        this.customReconnectAttempts++;
        
        // Calculate delay with exponential backoff and jitter
        const baseDelay = Math.min(
            this.baseReconnectDelay * Math.pow(2, Math.min(this.customReconnectAttempts - 1, 5)),
            this.maxCustomReconnectDelay
        );
        
        // Add jitter (±25% randomness)
        const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
        const delay = Math.max(1000, baseDelay + jitter);
        
        // Scheduling reconnection attempt
        
        // Update status with attempt info
        if (this.app.updateConnectionStatus) {
            this.app.updateConnectionStatus('disconnected', 
                `Reconnecting... (attempt ${this.customReconnectAttempts})`);
        }
        
        this.customReconnectInterval = setTimeout(() => {
            this.attemptReconnection(`Scheduled attempt ${this.customReconnectAttempts}`);
        }, delay);
    }
    
    /**
     * Attempt to reconnect to the server
     */
    async attemptReconnection(reason = 'Manual') {
        if (this.isConnected || this.isManuallyDisconnected) {
            return;
        }

        try {
            // Update status to show we're trying
            if (this.app.updateConnectionStatus) {
                this.app.updateConnectionStatus('connecting', 
                    `Reconnecting... (${reason.toLowerCase()})`);
            }
            
            await this.connect();
            
            // Connection successful - reconnection logic will be stopped by connect event
            
        } catch (error) {
            console.error('Reconnection failed:', error.message);
            
            // Schedule next attempt if custom reconnection is enabled
            if (this.customReconnectionEnabled && !this.isManuallyDisconnected) {
                this.scheduleNextReconnection();
            }
        }
    }
    
    /**
     * Manually trigger a reconnection attempt (for user-initiated retries)
     */
    manualReconnect() {
        
        this.customReconnectAttempts = 0; // Reset attempt counter for manual retries
        this.isManuallyDisconnected = false; // Allow reconnection
        this.customReconnectionEnabled = true; // Re-enable custom reconnection
        
        this.clearCustomReconnectTimer();
        this.attemptReconnection('Manual user request');
    }
    
    /**
     * Clear custom reconnection timer
     */
    clearCustomReconnectTimer() {
        if (this.customReconnectInterval) {
            clearTimeout(this.customReconnectInterval);
            this.customReconnectInterval = null;
        }
    }
    
    /**
     * Get connection and reconnection status
     */
    getConnectionInfo() {
        return {
            isConnected: this.isConnected,
            customReconnectAttempts: this.customReconnectAttempts,
            isReconnecting: !!this.customReconnectInterval,
            isManuallyDisconnected: this.isManuallyDisconnected,
            connectionQuality: this.connectionQuality,
            lastPongTime: this.lastPongTime,
            avgLatency: this.pingLatencies.length > 0 
                ? Math.round(this.pingLatencies.reduce((a, b) => a + b, 0) / this.pingLatencies.length)
                : null
        };
    }
    
    /**
     * Cleanup resources
     */
    cleanup() {
        // Cleaning up NetworkLayer
        
        // Stop heartbeat
        this.stopHeartbeat();
        
        // Stop custom reconnection
        this.clearCustomReconnectTimer();
        
        // Clear event handlers
        this.eventHandlers.clear();
        
        // Disconnect socket
        this.disconnect(true); // Manual disconnect to prevent reconnection
        
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
            canvas: this.currentCanvas,
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