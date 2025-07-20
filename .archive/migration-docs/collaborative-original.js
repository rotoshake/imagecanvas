// ===================================
// SIMPLIFIED COLLABORATIVE MODULE
// Always multi-user, no mode switching
// ===================================

class CollaborativeManager {
    constructor(app) {
        this.app = app;
        this.canvas = app.graphCanvas;
        this.graph = app.graph;
        this.stateManager = app.stateManager;
        
        // Connection state machine
        this.connectionState = new ConnectionStateMachine();
        
        // Resource manager
        this.resourceManager = new ResourceManager();
        
        // Error boundary
        this.errorBoundary = new ErrorBoundary({
            maxRetries: 3,
            retryDelay: 1000
        });
        
        // Initialize UnifiedOperationHandler
        this.operationHandler = new UnifiedOperationHandler(app);
        
        // Initialize TransactionManager and link it
        this.transactionManager = new TransactionManager(app);
        this.operationHandler.setTransactionManager(this.transactionManager);
        
        // Core state
        this.socket = null;
        this.isConnected = false;
        this.isConnecting = false;  // Add flag to prevent duplicate connections
        this.currentProject = null;
        this.currentUser = null;
        this.otherUsers = new Map();
        this.activeUsers = new Map();  // Track all active users including self
        this.sequenceNumber = 0;
        
        // UI elements
        this.collaborationUI = null;
        this.userList = null;
        this.connectionStatus = null;
        
        // Timers
        this.syncTimer = null;
        this.heartbeatTimer = null;
        this.autoSaveTimer = null;
        this.connectionMonitorTimer = null;
        
        // Reconnection
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectTimer = null;
        
        // Auto-save state
        this.hasUnsavedChanges = false;
        this.lastSaveTime = Date.now();
        
        // Action manager
        this.actionManager = null;
        
        // Performance optimization components
        this.operationBatcher = null;
        this.stateSynchronizer = null;
        this.compressionManager = null;
        this.workerManager = null;
        
        // Debug mode
        this.debugMode = window.localStorage.getItem('DEBUG_COLLAB') === 'true' || window.DEBUG_COLLAB;
        
        this.init();
    }
    
    async init() {
        console.log('🤝 Collaborative manager initializing...');
        
        // Create UI immediately
        this.createUI();
        
        // Wait a bit for Socket.IO to load if not available yet
        let attempts = 0;
        while (typeof io === 'undefined' && attempts < 20) {
            console.log('⏳ Waiting for Socket.IO to load...', attempts);
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        // Check if Socket.IO is available
        if (typeof io === 'undefined') {
            console.log('⚠️ Socket.IO not loaded - collaboration unavailable');
            this.showStatus('Collaboration Unavailable', 'error');
            return;
        }
        
        console.log('✅ Socket.IO is available, proceeding with connection');
        
        // Initialize performance optimization components
        this.initializePerformanceComponents();
        
        // Always try to connect
        this.connectToServer();
    }
    
    /**
     * Initialize performance optimization components
     */
    initializePerformanceComponents() {
        try {
            // Initialize operation batcher
            if (typeof OperationBatcher !== 'undefined') {
                this.operationBatcher = new OperationBatcher(this);
                console.log('✅ OperationBatcher initialized');
            }
            
            // Initialize incremental state synchronizer
            if (typeof IncrementalStateSynchronizer !== 'undefined') {
                this.stateSynchronizer = new IncrementalStateSynchronizer(this);
                console.log('✅ IncrementalStateSynchronizer initialized');
            }
            
            // Initialize compression manager
            if (typeof CompressionManager !== 'undefined') {
                this.compressionManager = new CompressionManager();
                console.log('✅ CompressionManager initialized');
            }
            
            // Initialize worker manager
            if (typeof PerformanceWorkerManager !== 'undefined') {
                this.workerManager = new PerformanceWorkerManager();
                console.log('✅ PerformanceWorkerManager initialized');
            }
            
        } catch (error) {
            console.warn('Failed to initialize some performance components:', error);
        }
    }
    
    async connectToServer() {
        // Check if we can transition to connecting state
        if (!this.connectionState.canTransition('connecting')) {
            console.log(`⚠️ Cannot connect from state: ${this.connectionState.getState()}`);
            return;
        }
        
        // Add small random delay to prevent multiple tabs from connecting simultaneously
        const delay = Math.random() * 500; // 0-500ms random delay
        if (delay > 100) {
            console.log(`⏱️ Waiting ${Math.round(delay)}ms before connecting (prevent race conditions)...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        try {
            await this.connectionState.transition('connecting', async () => {
                console.log('🔌 Connecting to collaborative server...');
                this.showStatus('Connecting...', 'info');
                
                // Clean up any existing socket
                this.cleanupSocket();
                
                console.log('🔧 Creating socket to:', CONFIG.SERVER.API_BASE);
                
                this.socket = io(CONFIG.SERVER.API_BASE, {
                    reconnection: true,
                    reconnectionDelay: 1000,
                    reconnectionDelayMax: 5000,
                    reconnectionAttempts: 5,
                    autoConnect: false,   // We'll connect manually
                    timeout: 10000,
                    forceNew: true,       // Force new connection per tab
                    transports: ['websocket', 'polling']
                });
                
                console.log('🔧 Socket created:', !!this.socket);
                
                // Enable debug logging if in debug mode
                if (this.debugMode) {
                    console.log('🐛 Debug mode enabled for collaborative sync');
                    this.socket.on('connect', () => console.log('[COLLAB DEBUG] Socket connected'));
                    this.socket.on('disconnect', (reason) => console.log('[COLLAB DEBUG] Socket disconnected:', reason));
                    this.socket.on('connect_error', (error) => console.log('[COLLAB DEBUG] Connection error:', error.message));
                    this.socket.on('error', (error) => console.log('[COLLAB DEBUG] Socket error:', error));
                    this.socket.on('reconnect', (attempt) => console.log('[COLLAB DEBUG] Reconnected after', attempt, 'attempts'));
                    this.socket.on('reconnect_attempt', (attempt) => console.log('[COLLAB DEBUG] Reconnection attempt', attempt));
                    this.socket.on('reconnect_error', (error) => console.log('[COLLAB DEBUG] Reconnection error:', error.message));
                    this.socket.on('reconnect_failed', () => console.log('[COLLAB DEBUG] Reconnection failed'));
                }
                
                this.setupSocketHandlers();
                
                // Connect immediately
                console.log('🔧 Connecting socket...');
                this.socket.connect();
            });
        } catch (error) {
            console.error('Failed to connect:', error);
            this.showStatus('Connection Failed', 'error');
            // State machine will handle the rollback
        }
    }
    
    setupSocketHandlers() {
        this.socket.on('connect', async () => {
            console.log('✅ Connected to server');
            
            // Check current state before transitioning
            const currentState = this.connectionState.getState();
            
            // Handle based on current state
            if (currentState === 'connected') {
                console.log('⚠️ Already connected, ignoring duplicate connect event');
                return;
            }
            
            // If we're in the middle of disconnecting, wait a bit
            if (currentState === 'disconnecting') {
                console.log('⚠️ Still disconnecting, delaying connect handler');
                setTimeout(() => {
                    if (this.socket && this.socket.connected) {
                        this.socket.emit('connect'); // Re-trigger connect event
                    }
                }, 500);
                return;
            }
            
            try {
                await this.connectionState.transition('connected', async () => {
                    this.isConnected = true;
                    this.isConnecting = false;  // Clear connecting flag
                    this.reconnectAttempts = 0; // Reset counter
                    
                    // Clear any pending reconnect
                    if (this.reconnectTimer) {
                        clearTimeout(this.reconnectTimer);
                        this.reconnectTimer = null;
                    }
                    
                    this.showStatus('Connected', 'success');
                    
                    // Rejoin project if we were in one
                    if (this.currentProject && this.currentProject.id) {
                        await this.rejoinProject();
                    }
                    
                    // Start monitoring
                    this.startHeartbeat();
                    this.startConnectionMonitor();
                });
            } catch (error) {
                console.error('Failed to handle connection:', error);
                // Force state correction if needed
                if (this.socket && this.socket.connected) {
                    this.connectionState.currentState = 'connected';
                    this.isConnected = true;
                    // Try to rejoin if we have project info
                    if (this.currentProject && !this.currentUser) {
                        setTimeout(() => this.rejoinProject(), 1000);
                    }
                }
            }
        });
        
        this.socket.on('disconnect', async (reason) => {
            console.log('❌ Disconnected:', reason);
            
            try {
                // First transition to disconnecting if we're connected
                const currentState = this.connectionState.getState();
                if (currentState === 'connected') {
                    await this.connectionState.transition('disconnecting', async () => {
                        // Just mark as disconnecting
                    });
                }
                
                // Now transition to disconnected
                await this.connectionState.transition('disconnected', async () => {
                    this.isConnected = false;
                    this.isConnecting = false;  // Clear connecting flag
                    this._hasValidSession = false; // Clear session flag
                    
                    // Clear any pending reconnect
                    if (this.reconnectTimer) {
                        clearTimeout(this.reconnectTimer);
                        this.reconnectTimer = null;
                    }
                    
                    // Stop monitoring IMMEDIATELY
                    this.stopHeartbeat();
                    this.stopPeriodicSync();
                    this.stopConnectionMonitor();
                    this.stopAutoSave();
                    
                    // Clear pending operations
                    this.connectionState.clearPendingOperations();
                    
                    if (reason === 'io server disconnect') {
                        // Server kicked us out
                        this.showStatus('Disconnected by server', 'error');
                    } else if (reason === 'io client disconnect') {
                        // We disconnected intentionally
                        this.showStatus('Disconnected', 'info');
                    } else if (reason === 'transport close' || reason === 'transport error') {
                        // Transport issues - wait longer before reconnecting
                        console.log('⚠️ Transport issue detected, waiting before reconnect...');
                        this.showStatus('Connection lost - Will reconnect...', 'warning');
                        // Use longer delay for transport issues
                        setTimeout(() => {
                            if (this.connectionState.getState() === 'disconnected') {
                                this.scheduleReconnect();
                            }
                        }, 3000); // Wait 3 seconds before starting reconnection
                    } else {
                        // Other connection loss - attempt reconnection
                        this.showStatus('Connection lost - Reconnecting...', 'warning');
                        this.scheduleReconnect();
                    }
                });
            } catch (error) {
                console.error('Failed to handle disconnect:', error);
            }
        });
        
        this.socket.on('connect_error', async (error) => {
            console.log('❌ Connection error:', error.message);
            
            try {
                await this.connectionState.transition('error', async () => {
                    this.isConnected = false;
                    this.isConnecting = false;  // Clear connecting flag
                    
                    // Only schedule reconnect if we don't already have one pending
                    if (!this.reconnectTimer) {
                        this.scheduleReconnect();
                    }
                });
            } catch (stateError) {
                // If we can't transition to error state, try disconnected
                if (this.connectionState.canTransition('disconnected')) {
                    await this.connectionState.transition('disconnected', () => {
                        this.isConnected = false;
                        this.isConnecting = false;
                    });
                }
            }
        });
        
        // Project events
        this.socket.on('project_joined', this.handleProjectJoined.bind(this));
        this.socket.on('project_state', this.handleProjectState.bind(this));
        this.socket.on('active_users', this.handleActiveUsers.bind(this));
        this.socket.on('active_users_update', this.handleActiveUsersUpdate.bind(this));
        this.socket.on('user_joined', this.handleUserJoined.bind(this));
        this.socket.on('user_left', this.handleUserLeft.bind(this));
        
        // Error handling
        this.socket.on('error', this.handleServerError.bind(this));
        
        // Canvas operations
        this.socket.on('canvas_operation', this.handleRemoteOperation.bind(this));
        this.socket.on('canvas_operation_batch', this.handleRemoteOperationBatch.bind(this));
        this.socket.on('sync_response', this.handleSyncResponse.bind(this));
        this.socket.on('media_uploaded', this.handleMediaUploaded.bind(this));
        
        // Incremental sync
        this.socket.on('incremental_sync', this.handleIncrementalSync.bind(this));
        
        // Heartbeat
        this.socket.on('heartbeat_response', this.handleHeartbeatResponse.bind(this));
        
        // State sharing
        this.socket.on('request_project_state', this.handleProjectStateRequest.bind(this));
    }
    
    createUI() {
        // Create collaboration UI container
        this.collaborationUI = document.createElement('div');
        this.collaborationUI.id = 'collaboration-ui';
        this.collaborationUI.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.85);
            color: white;
            padding: 12px;
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 12px;
            z-index: 10000;
            min-width: 180px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;
        
        // Connection status
        this.connectionStatus = document.createElement('div');
        this.connectionStatus.style.cssText = `
            margin-bottom: 10px;
            padding: 6px 10px;
            border-radius: 4px;
            text-align: center;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 6px;
            justify-content: center;
        `;
        this.collaborationUI.appendChild(this.connectionStatus);
        
        // User list header
        const userHeader = document.createElement('div');
        userHeader.textContent = 'Active Users';
        userHeader.style.cssText = 'font-weight: 600; margin-bottom: 6px; opacity: 0.8;';
        this.collaborationUI.appendChild(userHeader);
        
        // User list
        this.userList = document.createElement('div');
        this.userList.id = 'user-list';
        this.userList.style.cssText = 'max-height: 200px; overflow-y: auto;';
        this.collaborationUI.appendChild(this.userList);
        
        document.body.appendChild(this.collaborationUI);
    }
    
    scheduleReconnect() {
        // Clear any existing timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        // Check current state
        const currentState = this.connectionState.getState();
        console.log(`📊 Current connection state: ${currentState}`);
        
        // If already connected or connecting, don't reconnect
        if (currentState === 'connected' || currentState === 'connecting') {
            console.log('⚠️ Already connected or connecting, skipping reconnect');
            return;
        }
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('❌ Max reconnection attempts reached');
            this.showStatus('Offline - Refresh to retry', 'error');
            return;
        }
        
        this.reconnectAttempts++;
        
        // Exponential backoff with jitter
        const baseDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
        const jitter = baseDelay * 0.5 * Math.random();
        const delay = baseDelay + jitter;
        
        console.log(`⏱️ Reconnecting in ${Math.round(delay/1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        this.reconnectTimer = setTimeout(() => {
            // Double-check state before reconnecting
            const state = this.connectionState.getState();
            if (state !== 'connected' && state !== 'connecting') {
                console.log('🔄 Attempting reconnection...');
                
                // Force state reset if stuck
                if (!this.connectionState.canTransition('connecting')) {
                    console.log('🔧 Resetting connection state machine');
                    this.connectionState.reset();
                }
                
                // Clean up socket properly
                this.cleanupSocket();
                
                // Attempt reconnection
                this.connectToServer();
            } else {
                console.log('⚠️ State changed during delay, skipping reconnect');
            }
        }, delay);
    }
    
    /**
     * Properly cleanup socket connection
     */
    cleanupSocket() {
        if (this.socket) {
            console.log('🧹 Cleaning up socket connection');
            try {
                // Remove all listeners to prevent memory leaks
                this.socket.removeAllListeners();
                
                // Disconnect if connected
                if (this.socket.connected) {
                    this.socket.disconnect();
                }
                
                // Clear the socket reference
                this.socket = null;
            } catch (error) {
                console.error('Error during socket cleanup:', error);
                // Force null the socket even on error
                this.socket = null;
            }
        }
    }
    
    showStatus(message, type = 'info') {
        if (!this.connectionStatus) return;
        
        const colors = {
            info: { bg: '#3b82f6', icon: '🔄' },
            success: { bg: '#10b981', icon: '✅' },
            warning: { bg: '#f59e0b', icon: '⚠️' },
            error: { bg: '#ef4444', icon: '❌' }
        };
        
        const status = colors[type] || colors.info;
        this.connectionStatus.innerHTML = `<span>${status.icon}</span> ${message}`;
        this.connectionStatus.style.backgroundColor = status.bg;
    }
    
    updateUserList() {
        if (!this.userList) return;
        
        this.userList.innerHTML = '';
        
        // Add current user
        if (this.currentUser) {
            const userEl = document.createElement('div');
            userEl.style.cssText = 'padding: 4px 0; color: #10b981;';
            userEl.textContent = `${this.currentUser.displayName} (you)`;
            this.userList.appendChild(userEl);
        }
        
        // Add other users
        this.otherUsers.forEach((user) => {
            const userEl = document.createElement('div');
            userEl.style.cssText = 'padding: 4px 0; color: #e5e7eb;';
            userEl.textContent = user.displayName;
            this.userList.appendChild(userEl);
        });
        
        if (this.otherUsers.size === 0 && !this.currentUser) {
            const emptyEl = document.createElement('div');
            emptyEl.style.cssText = 'padding: 4px 0; color: #6b7280; font-style: italic;';
            emptyEl.textContent = 'No users connected';
            this.userList.appendChild(emptyEl);
        }
    }
    
    async joinProject(projectId, username = null, displayName = null) {
        projectId = parseInt(projectId);
        
        if (!this.socket) {
            console.error('Cannot join project - no socket');
            return false;
        }
        
        // If we're in the same project already, don't rejoin
        if (this.currentProject && parseInt(this.currentProject.id) === parseInt(projectId)) {
            console.log('✅ Already in this project');
            return true;
        }
        
        // Prevent multiple simultaneous join attempts
        if (this.isJoining) {
            console.log('⏳ Already joining a project, waiting...');
            return false;
        }
        
        this.isJoining = true;
        
        // Wait for connection if not connected
        if (!this.isConnected) {
            console.log('⏳ Waiting for connection before joining project...');
            
            // Wait up to 10 seconds for connection
            const waitStart = Date.now();
            while (!this.isConnected && Date.now() - waitStart < 10000) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            if (!this.isConnected) {
                console.error('❌ Timeout waiting for connection');
                this.isJoining = false;
                return false;
            }
        }
        
        // Generate user info if not provided
        if (!username) {
            // Get or create base username
            let baseUsername = localStorage.getItem('username');
            if (!baseUsername) {
                // Generate more readable usernames for testing
                const adjectives = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Gray'];
                const nouns = ['Fox', 'Bear', 'Eagle', 'Wolf', 'Tiger', 'Lion', 'Hawk', 'Owl'];
                const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
                const noun = nouns[Math.floor(Math.random() * nouns.length)];
                const num = Math.floor(Math.random() * 100);
                baseUsername = `${adj}${noun}${num}`;
                localStorage.setItem('username', baseUsername);
            }
            
            // Add tab-specific identifier
            // Use a persistent tab ID stored on the window object
            if (!window.__imageCanvasTabId) {
                window.__imageCanvasTabId = Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9) + '-' + performance.now().toString(36);
                console.log('📍 Generated unique Tab ID:', window.__imageCanvasTabId);
            } else {
                console.log('📍 Using existing Tab ID:', window.__imageCanvasTabId);
            }
            
            // Combine for unique username per tab
            username = `${baseUsername}-${window.__imageCanvasTabId}`;
            
            // Display name is just the base username (without tab ID)
            if (!displayName) {
                displayName = baseUsername;
            }
        }
        
        console.log('🔐 Joining with username:', username, 'display:', displayName);
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.error('❌ Join project timeout after 10s');
                this.isJoining = false;
                // Remove listeners
                this.socket.off('project_joined', handleJoined);
                this.socket.off('error', handleError);
                resolve(false);
            }, 10000); // Increased to 10 seconds
            
            const handleJoined = (data) => {
                clearTimeout(timeout);
                console.log('✅ Joined project:', data.project.name);
                this.isJoining = false;
                // Remove error listener
                this.socket.off('error', handleError);
                resolve(true);
            };
            
            const handleError = (error) => {
                console.error('❌ Join project error:', error);
                clearTimeout(timeout);
                this.isJoining = false;
                // Remove joined listener
                this.socket.off('project_joined', handleJoined);
                resolve(false);
            };
            
            // Use on() instead of once() so we can manually remove
            this.socket.on('project_joined', handleJoined);
            this.socket.on('error', handleError);
            
            // Extract base username for display (remove tab ID suffix)
            const baseDisplayName = username.split('-').slice(0, -1).join('-') || username.split('-')[0];
            
            console.log('📤 Emitting join_project:', {
                projectId: projectId,
                username: username,
                displayName: displayName || baseDisplayName
            });
            
            this.socket.emit('join_project', {
                projectId: projectId,
                username: username,
                displayName: displayName || baseDisplayName
            });
        });
    }
    
    async rejoinProject() {
        if (this.currentProject && this.currentUser) {
            console.log('🔄 Rejoining project after reconnect with user:', this.currentUser.username);
            
            // Clear isJoining flag to allow rejoin
            this.isJoining = false;
            
            // When rejoining, use the exact same username and displayName
            // to maintain session continuity
            const success = await this.joinProject(
                this.currentProject.id,
                this.currentUser.username,
                this.currentUser.displayName
            );
            
            if (!success) {
                console.error('❌ Failed to rejoin project after reconnect');
                // Schedule another attempt
                setTimeout(() => this.rejoinProject(), 2000);
            } else {
                console.log('✅ Successfully rejoined project');
                // After successful rejoin, request state sync
                if (this.isConnected && this.currentProject) {
                    this.performPeriodicSync();
                }
            }
        } else {
            console.log('⚠️ Cannot rejoin - missing project or user info');
        }
    }
    
    sendOperation(operationType, operationData) {
        return this.errorBoundary.execute(async () => {
            if (!this.socket || !this.currentProject || !this.currentUser) {
                console.log('📤 Operation queued (not ready):', operationType, 
                    'Socket:', !!this.socket, 
                    'Project:', !!this.currentProject,
                    'User:', !!this.currentUser);
                // Use connection state to queue operation
                return this.connectionState.queueOperation(() => {
                    this.sendOperation(operationType, operationData);
                });
            }
            
            // Use operation batcher if available
            if (this.operationBatcher && this.isConnected) {
                this.operationBatcher.addOperation(operationType, operationData);
                return { batched: true, type: operationType };
            }
            
            // Fallback to original implementation
            const operation = {
                type: operationType,
                data: operationData,
                timestamp: Date.now(),
                sequence: ++this.sequenceNumber
            };
            
            // Check if we have a valid session before sending operations
            if (!this._hasValidSession) {
                console.warn('⚠️ Blocking operation until authenticated:', operationType);
                return Promise.reject(new Error('Not authenticated yet'));
            }
            
            if (this.isConnected) {
                this.socket.emit('canvas_operation', {
                    projectId: this.currentProject.id,
                    operation: operation
                });
                return operation;
            } else {
                console.log('📤 Operation queued (disconnected):', operationType);
                // Queue for when connection is restored
                return this.connectionState.queueOperation(() => {
                    this.socket.emit('canvas_operation', {
                        projectId: this.currentProject.id,
                        operation: operation
                    });
                });
            }
        }, {
            id: `send_${operationType}`,
            type: 'broadcast',
            fallback: async (error) => {
                console.log(`📥 Queueing failed operation: ${operationType}`, error.message);
                // Queue for retry when connection is restored
                return this.connectionState.queueOperation(() => {
                    this.sendOperation(operationType, operationData);
                });
            }
        });
    }
    
    // Special method for undo/redo state sync
    broadcastFullState() {
        if (!this.socket || !this.isConnected || !this.currentProject) {
            console.log('⚠️ Cannot broadcast state: not connected');
            return;
        }
        
        console.log('📤 Broadcasting full state');
        
        const state = {
            nodes: this.graph.nodes.map(node => ({
                id: node.id,
                type: node.type,
                pos: [...node.pos],
                size: [...node.size],
                aspectRatio: node.aspectRatio,
                rotation: node.rotation || 0,
                properties: { ...node.properties },
                flags: { ...node.flags },
                title: node.title
            })),
            timestamp: Date.now()
        };
        
        this.sendOperation('state_sync', {
            state: state,
            reason: 'undo_redo'
        });
    }
    
    // Error handler
    handleServerError(error) {
        console.error('🚨 Server error:', error);
        
        if (error.message === 'Not authenticated for this project') {
            console.log('🔐 Authentication lost, stopping sync and attempting to rejoin...');
            this.showStatus('Re-authenticating...', 'warning');
            
            // CRITICAL: Stop periodic sync immediately to prevent error spam
            this.stopPeriodicSync();
            this._hasValidSession = false;
            
            // Don't clear currentUser - we need it to rejoin with same credentials
            // Just clear the joining flag to allow rejoin
            this.isJoining = false;
            
            // Attempt to rejoin immediately
            if (this.currentProject && this.currentUser) {
                console.log('🔄 Attempting to rejoin with existing credentials');
                this.rejoinProject();
            } else if (this.currentProject && !this.currentUser) {
                console.log('⚠️ Have project but no user - need fresh join');
                // Try to join with a new username
                this.joinProject(this.currentProject.id);
            } else {
                console.error('❌ Cannot rejoin - missing project info');
            }
        }
    }
    
    // Project event handlers
    handleProjectJoined(data) {
        console.log('🎯 Joined project:', data.project.name);
        console.log('📋 Session info:', {
            userId: data.session.userId,
            socketId: this.socket?.id,
            username: data.session.username
        });
        
        this.currentProject = data.project;
        this.currentUser = data.session;
        this.sequenceNumber = data.sequenceNumber || 0;
        
        // Mark that we're properly joined
        this.isJoining = false;
        this._hasValidSession = true;
        
        // Show clean display name in UI (without tab ID)
        const displayName = this.currentUser.displayName || this.currentUser.username.split('-')[0];
        this.showStatus(`Connected to ${data.project.name || 'Untitled Project'}`, 'success');
        this.updateUserList();
        
        // Initialize state synchronizer with current graph
        if (this.stateSynchronizer && this.graph) {
            this.stateSynchronizer.initialize(this.graph);
        }
        
        // Start periodic sync and auto-save ONLY after successful join
        this.startPeriodicSync();
        this.startAutoSave();
    }
    
    handleProjectState(state) {
        console.log('📥 Received project state');
        this.restoreProjectState(state);
    }
    
    handleActiveUsers(users) {
        console.log('📋 Received active users:', users);
        this.activeUsers.clear();
        this.otherUsers.clear();
        
        // Add current user to activeUsers
        if (this.currentUser) {
            this.activeUsers.set(this.currentUser.userId, this.currentUser);
        }
        
        // Add other users
        if (Array.isArray(users)) {
            for (const user of users) {
                this.activeUsers.set(user.userId, user);
                if (user.userId !== this.currentUser?.userId) {
                    this.otherUsers.set(user.userId, user);
                }
            }
        } else {
            console.warn('⚠️ Active users not in expected format:', users);
        }
        
        console.log(`👥 Total active users: ${this.activeUsers.size} (including self)`);
        this.updateUserList();
    }
    
    handleActiveUsersUpdate(data) {
        // Handle the active_users_update event that's broadcast when users join/leave
        if (data.users) {
            this.handleActiveUsers(data.users);
        }
    }
    
    handleUserJoined(user) {
        console.log('👋 User joined:', user.displayName);
        this.activeUsers.set(user.userId, user);
        this.otherUsers.set(user.userId, user);
        this.updateUserList();
        
        // Don't automatically broadcast nodes when users join
        // They should either:
        // 1. Load from server (if no unsaved changes)
        // 2. Request state sync (if unsaved changes exist)
        // This prevents duplicate nodes
    }
    
    handleUserLeft(user) {
        console.log('👋 User left:', user.displayName);
        this.activeUsers.delete(user.userId);
        this.otherUsers.delete(user.userId);
        this.updateUserList();
    }
    
    // Operation handlers
    async handleRemoteOperation(data) {
        const { operation, userId } = data;
        
        if (userId === this.currentUser?.userId) {
            return; // Skip own operations
        }
        
        const { type, data: operationData } = operation;
        
        console.log('📥 Remote operation:', type, operationData);
        
        // Use unified operation handler for all operations
        if (this.operationHandler) {
            try {
                await this.operationHandler.execute({
                    type: type,
                    data: operationData
                }, {
                    isRemote: true,
                    skipUndo: true 
                });
            } catch (validationError) {
                console.warn(`⚠️ Operation validation failed for ${type}, falling back to legacy handler:`, validationError.message);
                console.log('Operation data:', operationData);
                
                // Fallback to legacy operation handling
                this.applyOperation(type, operationData);
            }
        } else if (this.actionManager) {
            // Fallback to action manager for operations it still handles
            await this.actionManager.executeAction(type, operationData, { 
                fromRemote: true,
                skipUndo: true 
            });
        } else {
            // Final fallback to existing implementation
            this.applyOperation(type, operationData);
        }
        
        // Update sequence number
        if (operation.sequenceNumber > this.sequenceNumber) {
            this.sequenceNumber = operation.sequenceNumber;
        }
    }
    
    /**
     * Handle batch of remote operations
     */
    async handleRemoteOperationBatch(data) {
        const { operations, userId, batchId } = data;
        
        if (userId === this.currentUser?.userId) {
            return; // Skip own operations
        }
        
        console.log('📥 Remote operation batch:', operations.length, 'operations, batch:', batchId);
        
        // Process each operation in the batch
        for (const operation of operations) {
            try {
                const { type, data: operationData } = operation;
                
                // Use unified operation handler for all operations
                if (this.operationHandler) {
                    try {
                        await this.operationHandler.execute({
                            type: type,
                            data: operationData
                        }, {
                            isRemote: true,
                            skipUndo: true 
                        });
                    } catch (validationError) {
                        console.warn(`⚠️ Batch operation validation failed for ${type}, falling back to legacy handler:`, validationError.message);
                        console.log('Operation data:', operationData);
                        
                        // Fallback to legacy operation handling
                        this.applyOperation(type, operationData);
                    }
                } else if (this.actionManager) {
                    // Fallback to action manager for operations it still handles
                    await this.actionManager.executeAction(type, operationData, { 
                        fromRemote: true,
                        skipUndo: true 
                    });
                } else {
                    // Final fallback to existing implementation
                    this.applyOperation(type, operationData);
                }
                
                // Update sequence number
                if (operation.sequence > this.sequenceNumber) {
                    this.sequenceNumber = operation.sequence;
                }
            } catch (error) {
                console.error('Error processing batched operation:', error, operation);
            }
        }
        
        // Force canvas redraw after batch
        if (this.canvas) {
            this.canvas.dirty_canvas = true;
        }
    }
    
    /**
     * Handle incremental state synchronization
     */
    async handleIncrementalSync(data) {
        const { delta, userId } = data;
        
        if (userId === this.currentUser?.userId) {
            return; // Skip own sync
        }
        
        console.log('📊 Received incremental sync:', delta);
        
        if (this.stateSynchronizer) {
            try {
                this.stateSynchronizer.applyDelta(delta, this.graph);
            } catch (error) {
                console.error('Error applying incremental sync:', error);
                // Fallback to requesting full state
                this.requestFullProjectState();
            }
        }
    }
    
    applyOperation(type, operationData) {
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
                case 'node_property_update':
                    this.applyNodePropertyUpdate(operationData);
                    break;
                case 'state_sync':
                    this.applyStateSync(operationData);
                    break;
                case 'node_align':
                    this.applyNodeAlign(operationData);
                    break;
                case 'layer_order_change':
                    this.applyLayerOrderChange(operationData);
                    break;
                case 'node_reset':
                    this.applyNodeReset(operationData);
                    break;
                default:
                    console.warn('Unknown operation type:', type);
            }
            
            // Force canvas redraw
            if (this.canvas) {
                this.canvas.dirty_canvas = true;
            }
        } catch (error) {
            console.error('Error applying operation:', error);
        }
        
        // Update sequence number
        if (data.sequenceNumber) {
            this.sequenceNumber = Math.max(this.sequenceNumber, data.sequenceNumber);
        }
    }
    
    // Apply operation methods
    applyNodeMove(operationData) {
        const { nodeId, pos, nodeIds, positions, x, y } = operationData;
        
        console.log('Applying node move:', operationData);
        
        // Track if we're missing any nodes
        let missingNodes = false;
        let nodesFound = 0;
        
        if (nodeIds && positions) {
            // Multi-node move
            for (let i = 0; i < nodeIds.length; i++) {
                const node = this.graph.getNodeById(nodeIds[i]);
                if (node && positions[i]) {
                    node.pos[0] = positions[i][0];
                    node.pos[1] = positions[i][1];
                    console.log(`Moved node ${nodeIds[i]} to:`, node.pos);
                    nodesFound++;
                } else if (!node) {
                    console.warn(`Node ${nodeIds[i]} not found during move operation`);
                    missingNodes = true;
                }
            }
        } else if (nodeId && pos) {
            // Single node move with pos array
            const node = this.graph.getNodeById(nodeId);
            if (node) {
                node.pos[0] = pos[0];
                node.pos[1] = pos[1];
                console.log(`Moved node ${nodeId} to:`, node.pos, 'Node exists:', !!node, 'Has image:', !!node.img);
                nodesFound++;
            } else {
                console.warn(`Node ${nodeId} not found during move operation`);
                missingNodes = true;
            }
        } else if (nodeId && (x !== undefined && y !== undefined)) {
            // Single node move with x,y coordinates (from action manager)
            const node = this.graph.getNodeById(nodeId);
            if (node) {
                node.pos[0] = x;
                node.pos[1] = y;
                console.log(`Moved node ${nodeId} to:`, node.pos, 'Node exists:', !!node, 'Has image:', !!node.img);
                nodesFound++;
            } else {
                console.warn(`Node ${nodeId} not found during move operation`);
                missingNodes = true;
            }
        }
        
        console.log(`Move operation completed. Nodes found: ${nodesFound}, Missing: ${missingNodes}`);
        
        // Log all current nodes for debugging
        console.log('Current nodes in graph:', this.graph.nodes.map(n => ({
            id: n.id,
            type: n.type,
            pos: [...n.pos],
            hasImage: !!n.img,
            loadingState: n.loadingState
        })));
        
        // Force canvas redraw after move
        if (this.canvas) {
            this.canvas.dirty_canvas = true;
        }
        
        // If we're missing nodes, request a state sync
        if (missingNodes && this.socket && this.socket.connected) {
            console.log('🔄 Requesting state sync due to missing nodes');
            this.socket.emit('request_state', {
                projectId: this.projectId
            });
        }
    }
    
    applyNodeResize(operationData) {
        const { nodeId, size, pos, nodeIds, sizes, positions } = operationData;
        
        // Track if we're missing any nodes
        let missingNodes = false;
        
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
                } else if (!node) {
                    console.warn(`Node ${nodeIds[i]} not found during resize operation`);
                    missingNodes = true;
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
            } else {
                console.warn(`Node ${nodeId} not found during resize operation`);
                missingNodes = true;
            }
        }
        
        // If we're missing nodes, request a state sync
        if (missingNodes && this.socket && this.socket.connected) {
            console.log('🔄 Requesting state sync due to missing nodes');
            this.socket.emit('request_state', {
                projectId: this.projectId
            });
        }
    }
    
    applyNodeRotate(operationData) {
        const { nodeId, rotation, pos, nodeIds, rotations, positions } = operationData;
        
        // Track if we're missing any nodes
        let missingNodes = false;
        
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
                } else if (!node) {
                    console.warn(`Node ${nodeIds[i]} not found during rotate operation`);
                    missingNodes = true;
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
            } else {
                console.warn(`Node ${nodeId} not found during rotate operation`);
                missingNodes = true;
            }
        }
        
        // If we're missing nodes, request a state sync
        if (missingNodes && this.socket && this.socket.connected) {
            console.log('🔄 Requesting state sync due to missing nodes');
            this.socket.emit('request_state', {
                projectId: this.projectId
            });
        }
    }
    
    applyNodeReset(operationData) {
        const { nodeId, nodeIds, resetType, value, values } = operationData;
        
        if (nodeIds && values) {
            // Multi-node reset
            for (let i = 0; i < nodeIds.length; i++) {
                const node = this.graph.getNodeById(nodeIds[i]);
                if (node) {
                    if (resetType === 'rotation') {
                        node.rotation = values[i];
                    } else if (resetType === 'aspect_ratio' && node.originalAspect) {
                        node.aspectRatio = values[i];
                        node.size[1] = node.size[0] / values[i];
                        if (node.onResize) node.onResize();
                    }
                }
            }
        } else if (nodeId && value !== undefined) {
            // Single node reset
            const node = this.graph.getNodeById(nodeId);
            if (node) {
                if (resetType === 'rotation') {
                    node.rotation = value;
                } else if (resetType === 'aspect_ratio' && node.originalAspect) {
                    node.aspectRatio = value;
                    node.size[1] = node.size[0] / value;
                    if (node.onResize) node.onResize();
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
    
    applyNodeCreate(operationData) {
        const { nodeData } = operationData;
        
        console.log('📦 Applying node create:', nodeData);
        
        if (nodeData && typeof NodeFactory !== 'undefined') {
            // Check if node already exists
            const existingNode = this.graph.getNodeById(nodeData.id);
            if (existingNode) {
                console.log('⚠️ Node already exists:', nodeData.id);
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
                
                // Update lastNodeId
                if (this.graph && node.id >= this.graph.lastNodeId) {
                    this.graph.lastNodeId = node.id;
                }
                
                // Handle media nodes
                if ((nodeData.type === 'media/image' || nodeData.type === 'media/video') && nodeData.properties.hash) {
                    console.log('🖼️ Loading media for node:', node.id, nodeData.properties);
                    this.loadNodeMedia(node, nodeData);
                }
                
                // Add to graph
                this.graph.add(node);
                console.log('✅ Created node:', nodeData.title || nodeData.type, 'at position:', node.pos);
                
                // Force canvas redraw
                if (this.canvas) {
                    this.canvas.dirty_canvas = true;
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
                    this.handleSpecialPropertyUpdate(node, propertyName, values[i]);
                }
            }
        } else if (nodeId && typeof value !== 'undefined') {
            // Single node property update
            const node = this.graph.getNodeById(nodeId);
            if (node) {
                node.properties[propertyName] = value;
                this.handleSpecialPropertyUpdate(node, propertyName, value);
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
        
        // Handle text node changes
        if (node.type === 'media/text') {
            if (propertyName === 'text' || propertyName === 'fontSize' || propertyName === 'fontFamily') {
                if (node.fitTextToBox) {
                    node.fitTextToBox();
                }
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
    
    applyLayerOrderChange(operationData) {
        const { nodeIds, direction, newLayerOrder } = operationData;
        
        if (newLayerOrder && Array.isArray(newLayerOrder)) {
            // Apply the complete new layer order
            const reorderedNodes = [];
            
            for (const nodeId of newLayerOrder) {
                const node = this.graph.getNodeById(nodeId);
                if (node) {
                    reorderedNodes.push(node);
                }
            }
            
            this.graph.nodes = reorderedNodes;
            console.log(`🔄 Applied layer order change`);
        }
    }
    
    applyStateSync(operationData) {
        const { state, reason } = operationData;
        
        if (!state || !state.nodes) {
            console.warn('Invalid state sync data');
            return;
        }
        
        console.log(`🔄 Applying state sync (reason: ${reason})`);
        
        try {
            // Use state manager for efficient restoration
            if (this.stateManager && this.stateManager.restoreNodesEfficiently) {
                this.stateManager.restoreNodesEfficiently(state.nodes, this.graph);
            } else {
                // Fallback: manual restoration
                this.graph.clear();
                for (const nodeData of state.nodes) {
                    this.createNodeFromData(nodeData);
                }
            }
            
            // Update lastNodeId
            if (state.nodes.length > 0) {
                this.graph.lastNodeId = Math.max(...state.nodes.map(n => n.id), 0);
            }
            
            // Clear selection
            if (this.canvas && this.canvas.selection) {
                this.canvas.selection.clear();
            }
        } catch (error) {
            console.error('Error applying state sync:', error);
        }
    }
    
    // Media handling
    loadNodeMedia(node, nodeData) {
        const hash = nodeData.properties.hash;
        const filename = nodeData.properties.filename;
        const isVideo = nodeData.type === 'media/video';
        
        if (!hash) return;
        
        // Try cache first
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
        
        // Load from server
        const serverFilename = nodeData.properties.serverFilename || filename;
        const serverUrl = `${CONFIG.ENDPOINTS.UPLOADS}/${serverFilename}`;
        
        if (isVideo && node.setVideo) {
            node.setVideo(serverUrl, filename, hash).catch(() => {
                console.warn('Failed to load video:', filename);
                node.loadingState = 'error';
            });
        } else if (node.setImage) {
            node.setImage(serverUrl, filename, hash).catch(() => {
                console.warn('Failed to load image:', filename);
                node.loadingState = 'error';
            });
        }
    }
    
    handleMediaUploaded(data) {
        const { fileInfo, nodeData } = data;
        console.log('📸 Media uploaded by other user:', fileInfo.original_name);
        
        // Check if node already exists (e.g., if we already loaded it from server)
        if (nodeData.id && this.app?.graph) {
            const existingNode = this.app.graph.getNodeById(nodeData.id);
            if (existingNode) {
                console.log('⚠️ Node already exists from media upload:', nodeData.id);
                return;
            }
        }
        
        const mediaUrl = `${CONFIG.ENDPOINTS.UPLOADS}/${fileInfo.filename}`;
        
        if (typeof NodeFactory !== 'undefined' && this.app?.graph) {
            const node = NodeFactory.createNode(nodeData.type);
            if (node) {
                // Set node properties INCLUDING ID!
                if (nodeData.id) {
                    node.id = nodeData.id;
                }
                node.pos = [...nodeData.pos];
                node.size = [...nodeData.size];
                node.title = nodeData.title;
                node.properties = { ...nodeData.properties };
                node.properties.hash = fileInfo.file_hash;
                node.properties.serverFilename = fileInfo.filename;
                node.flags = { ...nodeData.flags };
                node.aspectRatio = nodeData.aspectRatio || 1;
                node.rotation = nodeData.rotation || 0;
                
                // Load media
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
            }
        }
    }
    
    async uploadMedia(file, nodeData) {
        if (!this.isConnected || !this.socket) {
            console.log('⚠️ Not connected - cannot upload media');
            return null;
        }
        
        try {
            console.log('📤 Uploading media:', file.name);
            
            const formData = new FormData();
            formData.append('file', file);
            formData.append('projectId', this.currentProject?.id || 'demo-project');
            
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
                console.log('✅ Media uploaded:', result.fileInfo.filename);
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
    
    // State management
    createNodeFromData(nodeData) {
        if (typeof NodeFactory !== 'undefined') {
            const node = NodeFactory.createNode(nodeData.type);
            if (node) {
                node.id = nodeData.id;
                node.pos = [...nodeData.pos];
                node.size = [...nodeData.size];
                node.title = nodeData.title;
                node.properties = { ...nodeData.properties };
                node.flags = { ...nodeData.flags };
                node.aspectRatio = nodeData.aspectRatio || 1;
                node.rotation = nodeData.rotation || 0;
                
                if (this.graph && node.id >= this.graph.lastNodeId) {
                    this.graph.lastNodeId = node.id;
                }
                
                if (nodeData.type === 'media/image' || nodeData.type === 'media/video') {
                    this.loadNodeMedia(node, nodeData);
                }
                
                this.graph.add(node);
            }
        }
    }
    
    restoreProjectState(state) {
        console.log('🔄 Restoring project state');
        
        try {
            if (state.nodes && Array.isArray(state.nodes)) {
                this.graph.clear();
                for (const nodeData of state.nodes) {
                    this.createNodeFromData(nodeData);
                }
            }
            
            if (state.viewport && this.canvas?.viewport) {
                if (state.viewport.scale !== undefined) {
                    this.canvas.viewport.scale = state.viewport.scale;
                }
                if (state.viewport.offset && Array.isArray(state.viewport.offset)) {
                    this.canvas.viewport.offset = [...state.viewport.offset];
                }
            }
            
            if (this.canvas) {
                this.canvas.dirty_canvas = true;
            }
        } catch (error) {
            console.error('Error restoring state:', error);
        }
    }
    
    captureProjectState() {
        if (this.stateManager) {
            return this.stateManager.serializeState(this.graph, this.canvas);
        }
        
        // Fallback
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
    
    handleProjectStateRequest(data) {
        console.log('📤 Sharing project state with new user');
        
        if (!this.graph || !data.forUser) return;
        
        const projectState = this.captureProjectState();
        
        this.socket.emit('share_project_state', {
            projectState: projectState,
            forUser: data.forUser
        });
    }
    
    // Periodic sync
    startPeriodicSync() {
        this.stopPeriodicSync();
        
        const intervalId = setInterval(() => {
            if (this.isConnected && this.currentProject && this.currentUser) {
                // Only sync if we have a valid session
                this.performPeriodicSync();
            } else {
                console.log('⏸️ Skipping periodic sync - not fully authenticated', {
                    isConnected: this.isConnected,
                    hasProject: !!this.currentProject,
                    hasUser: !!this.currentUser
                });
            }
        }, 60000); // Every 60 seconds
        
        this.resourceManager.registerInterval('periodicSync', intervalId);
        this.syncTimer = intervalId;
        
        console.log('🔄 Periodic sync started');
    }
    
    stopPeriodicSync() {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
        }
    }
    
    async performPeriodicSync() {
        // Strict validation - ALL conditions must be met
        if (!this._hasValidSession) {
            console.log('⛔ No valid session - sync blocked');
            return;
        }
        
        if (!this.socket || !this.socket.connected) {
            console.log('⏭️ Skipping sync - socket not connected');
            this._hasValidSession = false; // Reset flag
            return;
        }
        
        if (!this.isConnected || !this.currentProject || !this.currentUser) {
            console.log('⚠️ Missing requirements for sync:', {
                isConnected: this.isConnected,
                hasProject: !!this.currentProject,
                hasUser: !!this.currentUser
            });
            return;
        }
        
        console.log('🔄 Performing periodic sync', {
            projectId: this.currentProject.id,
            userId: this.currentUser?.userId,
            socketId: this.socket?.id,
            connected: this.socket?.connected,
            hasValidSession: this._hasValidSession
        });
        
        const stateHash = this.calculateStateHash();
        
        this.socket.emit('sync_check', {
            projectId: this.currentProject.id,
            sequenceNumber: this.sequenceNumber,
            stateHash: stateHash,
            timestamp: Date.now()
        });
    }
    
    calculateStateHash() {
        const nodes = this.graph.nodes.map(node => ({
            id: node.id,
            type: node.type,
            pos: node.pos,
            size: node.size,
            rotation: node.rotation || 0,
            aspectRatio: node.aspectRatio || 1,
            properties: node.properties
        })).sort((a, b) => a.id - b.id);
        
        const stateString = JSON.stringify(nodes);
        
        // Simple hash
        let hash = 0;
        for (let i = 0; i < stateString.length; i++) {
            const char = stateString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        
        return hash.toString();
    }
    
    handleSyncResponse(data) {
        console.log('🔄 Sync response:', data);
        
        const { projectId, needsSync, missedOperations, latestSequence } = data;
        
        if (!this.currentProject || this.currentProject.id !== parseInt(projectId)) {
            return;
        }
        
        if (needsSync) {
            if (missedOperations && missedOperations.length > 0) {
                console.log('🔄 Applying', missedOperations.length, 'missed operations');
                for (const operation of missedOperations) {
                    this.handleRemoteOperation(operation);
                }
            } else if (missedOperations === null) {
                console.log('🔄 Requesting full state');
                this.requestFullProjectState();
            }
        }
        
        if (latestSequence > this.sequenceNumber) {
            this.sequenceNumber = latestSequence;
        }
    }
    
    requestFullProjectState() {
        if (!this.socket || !this.currentProject) {
            return;
        }
        
        this.socket.emit('request_project_state', {
            projectId: this.currentProject.id,
            fromUser: this.currentUser?.userId
        });
    }
    
    // Connection Health Monitoring
    startConnectionMonitor() {
        this.stopConnectionMonitor();
        
        const intervalId = setInterval(() => {
            // Check if socket exists but is disconnected
            if (this.socket && !this.socket.connected && this.isConnected) {
                console.log('⚠️ Connection health check failed - socket disconnected');
                this.isConnected = false;
                this.showStatus('Connection lost - Reconnecting...', 'warning');
                
                // Trigger reconnection
                this.scheduleReconnect();
            }
            
            // Check if state machine is in sync with actual connection
            const state = this.connectionState.getState();
            const actuallyConnected = this.socket && this.socket.connected;
            
            if (state === 'connected' && !actuallyConnected) {
                console.log('⚠️ State mismatch detected - fixing...');
                // Transition directly to disconnected (socket is already gone)
                this.connectionState.transition('disconnected', () => {
                    this.isConnected = false;
                    this.scheduleReconnect();
                }).catch(error => {
                    console.error('Transition failed:', error);
                    // Force reset if transition fails
                    this.connectionState.reset();
                    this.isConnected = false;
                    this.scheduleReconnect();
                });
            }
        }, 5000); // Check every 5 seconds
        
        this.resourceManager.registerInterval('connectionMonitor', intervalId);
        this.connectionMonitorTimer = intervalId;
        console.log('🏥 Connection health monitoring started');
    }
    
    stopConnectionMonitor() {
        if (this.connectionMonitorTimer) {
            clearInterval(this.connectionMonitorTimer);
            this.connectionMonitorTimer = null;
            console.log('🏥 Connection health monitoring stopped');
        }
    }
    
    // Heartbeat
    startHeartbeat() {
        this.stopHeartbeat();
        
        const intervalId = setInterval(() => {
            if (this.isConnected) {
                this.sendHeartbeat();
            }
        }, 10000); // Every 10 seconds
        
        this.resourceManager.registerInterval('heartbeat', intervalId);
        this.heartbeatTimer = intervalId;
    }
    
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
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
        // Connection is healthy
    }
    
    // Auto-save
    startAutoSave() {
        this.stopAutoSave();
        
        // Track changes
        if (!this.hasChangeTracking) {
            this.setupChangeTracking();
        }
        
        // Periodic save
        const intervalId = setInterval(() => {
            if (this.hasUnsavedChanges && this.currentProject) {
                this.saveCanvas();
            }
        }, 5000); // Every 5 seconds
        
        this.resourceManager.registerInterval('autoSave', intervalId);
        this.autoSaveTimer = intervalId;
        
        console.log('💾 Auto-save enabled');
    }
    
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }
    
    setupChangeTracking() {
        const originalSendOperation = this.sendOperation.bind(this);
        this.sendOperation = (type, data) => {
            this.hasUnsavedChanges = true;
            return originalSendOperation(type, data);
        };
        this.hasChangeTracking = true;
    }
    
    async saveCanvas() {
        if (!this.currentProject || !this.hasUnsavedChanges) {
            return;
        }
        
        try {
            console.log('💾 Auto-saving...');
            
            const canvasData = this.captureProjectState();
            
            const response = await fetch(CONFIG.ENDPOINTS.PROJECT_CANVAS(this.currentProject.id), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    canvas_data: canvasData,
                    userId: this.currentUser?.id || 1
                })
            });
            
            if (response.ok) {
                this.hasUnsavedChanges = false;
                this.lastSaveTime = Date.now();
                console.log('✅ Canvas saved');
            } else {
                console.error('❌ Save failed:', response.status);
            }
        } catch (error) {
            console.error('❌ Save error:', error);
        }
    }
    
    async save() {
        this.hasUnsavedChanges = true;
        await this.saveCanvas();
    }
    
    markModified() {
        this.hasUnsavedChanges = true;
    }
    
    // Cleanup
    setActionManager(actionManager) {
        this.actionManager = actionManager;
    }
    
    disconnect() {
        console.log('🔌 Disconnecting collaborative session...');
        
        // Stop all timers
        this.stopPeriodicSync();
        this.stopHeartbeat();
        this.stopAutoSave();
        this.stopConnectionMonitor();
        
        // Clear flags
        this.isConnecting = false;
        this.isConnected = false;
        
        // Clear reconnection timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        // Clean up performance components
        if (this.operationBatcher) {
            this.operationBatcher.cleanup();
        }
        if (this.workerManager) {
            this.workerManager.cleanup();
        }
        
        // Clean up operation handler and transaction manager
        if (this.operationHandler) {
            this.operationHandler = null;
        }
        if (this.transactionManager) {
            this.transactionManager = null;
        }
        
        // Clean up all resources
        this.resourceManager.cleanupAll();
        
        // Disconnect socket
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
        }
        
        // Update connection state
        if (this.connectionState.canTransition('disconnected')) {
            this.connectionState.transition('disconnected');
        }
        
        if (this.collaborationUI) {
            this.collaborationUI.remove();
            this.collaborationUI = null;
        }
        
        console.log('🤝 Collaborative manager disconnected');
    }
    
    /**
     * Enable or disable debug mode
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
        window.localStorage.setItem('DEBUG_COLLAB', enabled ? 'true' : 'false');
        console.log(`🐛 Collaborative debug mode ${enabled ? 'enabled' : 'disabled'}`);
        
        if (enabled) {
            console.log('Debug commands:');
            console.log('  app.collaborativeManager.getConnectionInfo() - Get connection status');
            console.log('  app.collaborativeManager.forceReconnect() - Force reconnection');
            console.log('  app.collaborativeManager.connectionState.getStateInfo() - Get state machine info');
        }
    }
    
    /**
     * Get current connection information
     */
    getConnectionInfo() {
        return {
            isConnected: this.isConnected,
            socketConnected: this.socket ? this.socket.connected : false,
            connectionState: this.connectionState.getState(),
            currentProject: this.currentProject,
            reconnectAttempts: this.reconnectAttempts,
            activeUsers: this.otherUsers.size + (this.currentUser ? 1 : 0),
            pendingOperations: this.connectionState.pendingOperations.length
        };
    }
    
    /**
     * Force reconnection (for debugging)
     */
    forceReconnect() {
        console.log('🔄 Forcing reconnection...');
        this.cleanupSocket();
        this.reconnectAttempts = 0;
        this.connectToServer();
    }
    
    /**
     * Get comprehensive performance statistics
     */
    getPerformanceStats() {
        const stats = {
            timestamp: Date.now(),
            connection: {
                isConnected: this.isConnected,
                sequenceNumber: this.sequenceNumber,
                reconnectAttempts: this.reconnectAttempts
            },
            batching: null,
            synchronization: null,
            compression: null,
            workers: null
        };
        
        // Get batching statistics
        if (this.operationBatcher) {
            stats.batching = this.operationBatcher.getStats();
        }
        
        // Get synchronization statistics  
        if (this.stateSynchronizer) {
            stats.synchronization = this.stateSynchronizer.getStats();
        }
        
        // Get compression statistics
        if (this.compressionManager) {
            stats.compression = this.compressionManager.getStats();
        }
        
        // Get worker statistics
        if (this.workerManager) {
            stats.workers = this.workerManager.getStats();
        }
        
        return stats;
    }
    
    /**
     * Reset all performance statistics
     */
    resetPerformanceStats() {
        if (this.operationBatcher) {
            this.operationBatcher.resetStats();
        }
        if (this.compressionManager) {
            this.compressionManager.resetStats();
        }
        console.log('📊 Performance statistics reset');
    }
}

// Make it globally available
window.CollaborativeManager = CollaborativeManager;