const { v4: uuidv4 } = require('uuid');
const CanvasStateManager = require('./CanvasStateManager');
const OperationHistory = require('../undo/OperationHistory');
const UndoStateSync = require('../undo/UndoStateSync');

/**
 * Fixed Collaboration Manager - Supports multiple tabs per user
 * Key changes:
 * 1. Each tab gets a unique socket connection
 * 2. Multiple tabs can share the same user account
 * 3. Operations sync across all tabs of the same user
 * 4. Server maintains authoritative state
 * 5. Full undo/redo support with cross-tab synchronization
 */
class CollaborationManager {
    constructor(io, db) {
        this.io = io;
        this.db = db;
        
        // State manager for authoritative canvas state
        this.stateManager = new CanvasStateManager(db);
        
        // Operation history for undo/redo
        this.operationHistory = new OperationHistory(db);
        
        // Undo state synchronization
        this.undoStateSync = new UndoStateSync(this.operationHistory, this.stateManager, io);
        
        // Track sessions by socket ID
        this.socketSessions = new Map(); // socketId -> session info
        
        // Track which sockets belong to which user
        this.userSockets = new Map(); // userId -> Set of socketIds
        
        // Track project rooms
        this.projectRooms = new Map(); // projectId -> room info
        
        // Track active transactions
        this.activeTransactions = new Map(); // `${userId}-${projectId}` -> transaction info
        
        this.setupSocketHandlers();
    }
    
    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`🔌 New socket connection: ${socket.id}`);
            
            // Project management
            socket.on('join_project', async (data) => {
                await this.handleJoinProject(socket, data);
            });
            
            socket.on('leave_project', async (data) => {
                await this.handleLeaveProject(socket, data);
            });
            
            // Canvas operations (legacy)
            socket.on('canvas_operation', async (data) => {
                await this.handleCanvasOperation(socket, data);
            });
            
            // State-based operations (new)
            socket.on('execute_operation', async (data) => {
                await this.handleExecuteOperation(socket, data);
            });
            
            socket.on('request_full_sync', async (data) => {
                await this.handleRequestFullSync(socket, data);
            });
            
            // Sync operations
            socket.on('sync_check', async (data) => {
                await this.handleSyncCheck(socket, data);
            });
            
            // Undo/Redo operations
            socket.on('undo_operation', async (data) => {
                await this.handleUndoOperation(socket, data);
            });
            
            socket.on('redo_operation', async (data) => {
                await this.handleRedoOperation(socket, data);
            });
            
            socket.on('request_undo_state', async (data) => {
                await this.handleRequestUndoState(socket, data);
            });
            
            socket.on('get_undo_history', async (data) => {
                await this.handleGetUndoHistory(socket, data);
            });
            
            socket.on('clear_undo_history', async (data) => {
                await this.handleClearUndoHistory(socket, data);
            });
            
            // Transaction management
            socket.on('begin_transaction', async (data) => {
                await this.handleBeginTransaction(socket, data);
            });
            
            socket.on('commit_transaction', async (data) => {
                await this.handleCommitTransaction(socket, data);
            });
            
            socket.on('abort_transaction', async (data) => {
                await this.handleAbortTransaction(socket, data);
            });
            
            // Heartbeat monitoring
            socket.on('ping', (timestamp) => {
                this.handlePing(socket, timestamp);
            });
            
            // Disconnect
            socket.on('disconnect', () => {
                this.handleDisconnect(socket);
            });
        });
    }
    
    async handleJoinProject(socket, { projectId, username, displayName, tabId }) {
        try {
            console.log(`📥 Join request from ${username} (tab: ${tabId}) for project ${projectId}`);
            
            // Find or create user (but allow multiple connections)
            let user = await this.db.getUserByUsername(username);
            if (!user) {
                const userId = await this.db.createUser(username, displayName);
                user = await this.db.getUser(userId);
                console.log(`👤 Created new user: ${username} (ID: ${userId})`);
            } else {
                console.log(`👤 Found existing user: ${username} (ID: ${user.id})`);
            }
            
            // Verify project exists
            const project = await this.getOrCreateProject(projectId, user);
            if (!project) {
                socket.emit('error', { message: 'Project not found' });
                return;
            }
            
            // Create session for this specific socket/tab
            const session = {
                socketId: socket.id,
                userId: user.id,
                projectId: project.id,
                username: user.username,
                displayName: user.display_name || user.username,
                tabId: tabId || `tab-${Date.now()}`,
                joinedAt: Date.now()
            };
            
            // Store session
            this.socketSessions.set(socket.id, session);
            
            // Track user's sockets
            if (!this.userSockets.has(user.id)) {
                this.userSockets.set(user.id, new Set());
            }
            this.userSockets.get(user.id).add(socket.id);
            
            // Register with undo state sync
            this.undoStateSync.registerUserSession(user.id, socket.id);
            
            // Initialize operation history for this project
            await this.operationHistory.initializeProject(project.id);
            console.log(`📚 Initialized operation history for project ${project.id}`);
            
            // Join socket room
            socket.join(`project_${project.id}`);
            
            // Initialize project room if needed
            if (!this.projectRooms.has(project.id)) {
                const latestOp = await this.db.get(
                    'SELECT MAX(sequence_number) as latest FROM operations WHERE project_id = ?',
                    [project.id]
                );
                
                this.projectRooms.set(project.id, {
                    sockets: new Set(),
                    sequenceNumber: latestOp?.latest || 0
                });
            }
            
            const room = this.projectRooms.get(project.id);
            room.sockets.add(socket.id);
            
            // Send success response
            socket.emit('project_joined', {
                project: project,
                session: {
                    userId: user.id,
                    username: user.username,
                    displayName: session.displayName,
                    tabId: session.tabId
                },
                sequenceNumber: room.sequenceNumber
            });
            
            // Get active users (count unique users, not sockets)
            const activeUsers = await this.getActiveUsersInProject(project.id);
            
            // Send to joining socket
            socket.emit('active_users', activeUsers);
            
            // Notify others (including other tabs of same user)
            socket.to(`project_${project.id}`).emit('user_joined', {
                userId: user.id,
                username: user.username,
                displayName: session.displayName,
                tabId: session.tabId
            });
            
            // Send updated user list to all
            socket.to(`project_${project.id}`).emit('active_users', activeUsers);
            
            // Request state from another tab (prefer same user's tab if available)
            if (room.sockets.size > 1) {
                const otherSockets = Array.from(room.sockets).filter(sid => sid !== socket.id);
                const sameUserSocket = otherSockets.find(sid => {
                    const sess = this.socketSessions.get(sid);
                    return sess && sess.userId === user.id;
                });
                
                const targetSocket = sameUserSocket || otherSockets[0];
                this.io.to(targetSocket).emit('request_project_state', {
                    forUser: socket.id,
                    projectId: project.id
                });
            }
            
            console.log(`✅ ${username} (${session.tabId}) joined project ${project.name}`);
            console.log(`📊 Project ${project.id} now has ${room.sockets.size} connections`);
            
            // Send initial undo state to the user
            const undoState = this.operationHistory.getUserUndoState(user.id, project.id);
            socket.emit('undo_state_update', {
                undoState,
                projectId: project.id
            });
            console.log(`📤 Sent initial undo state to ${username}:`, undoState);
            
        } catch (error) {
            console.error('Error in handleJoinProject:', error);
            socket.emit('error', { message: 'Failed to join project' });
        }
    }
    
    async getOrCreateProject(projectId, user) {
        if (projectId === 'demo-project' || projectId === 1) {
            // Handle demo project
            let project = await this.db.get('SELECT * FROM projects WHERE name = ?', ['Demo Project']);
            if (!project) {
                const id = await this.db.createProject('Demo Project', user.id, 'Collaborative demo');
                project = await this.db.getProject(id);
            }
            return project;
        }
        
        return await this.db.getProject(projectId);
    }
    
    async handleCanvasOperation(socket, { projectId, operation }) {
        const session = this.socketSessions.get(socket.id);
        if (!session || session.projectId !== parseInt(projectId)) {
            socket.emit('error', { message: 'Not authenticated for this project' });
            return;
        }
        
        const room = this.projectRooms.get(parseInt(projectId));
        if (!room) {
            socket.emit('error', { message: 'Project room not found' });
            return;
        }
        
        // Assign sequence number
        operation.sequence = ++room.sequenceNumber;
        operation.userId = session.userId;
        operation.tabId = session.tabId;
        
        // Operation storage is now handled by OperationHistory in handleExecuteOperation
        // Commenting out to prevent duplicate operations
        /*
        await this.db.addOperation(
            projectId,
            session.userId,
            operation.type,
            operation.data,
            operation.sequence
        );
        */
        
        // Apply operation to state manager for persistence
        try {
            await this.applyOperationToState(projectId, operation);
        } catch (error) {
            console.error('❌ Failed to apply operation to state manager:', error);
        }
        
        // Broadcast to ALL sockets in the room (including sender's other tabs)
        this.io.to(`project_${projectId}`).emit('canvas_operation', {
            operation: operation,
            fromUserId: session.userId,
            fromTabId: session.tabId,
            fromSocketId: socket.id
        });
        
        // console.log(`📤 Operation ${operation.type} from ${session.username} (${session.tabId}`);
    }
    
    /**
     * Apply canvas operation to state manager for persistence
     */
    async applyOperationToState(projectId, operation) {
        // Convert legacy canvas operation to state manager format
        const stateOperation = this.convertToStateOperation(operation);
        
        if (stateOperation) {
            const result = await this.stateManager.executeOperation(projectId, stateOperation, operation.userId);
            return result;
        } else {
            console.warn(`⚠️ No state operation created for canvas operation:`, operation.type);
        }
    }
    
    /**
     * Convert legacy canvas operation to state manager operation format
     */
    convertToStateOperation(operation) {
        switch (operation.type) {
            case 'add':
                return {
                    type: 'node_create',
                    params: {
                        id: operation.data.id,
                        type: operation.data.type,
                        pos: [operation.data.x || 0, operation.data.y || 0],
                        size: [operation.data.width || 150, operation.data.height || 100],
                        title: operation.data.content || operation.data.src || '',
                        properties: {
                            ...operation.data,
                            content: operation.data.content,
                            src: operation.data.src
                        }
                    }
                };
            
            case 'update':
                return {
                    type: 'node_property_update',
                    params: {
                        nodeId: operation.data.id,
                        properties: operation.data
                    }
                };
            
            case 'delete':
                return {
                    type: 'node_delete',
                    params: {
                        nodeId: operation.data.id
                    }
                };
            
            default:
                console.warn('Unknown canvas operation type for state conversion:', operation.type);
                return null;
        }
    }
    
    async handleSyncCheck(socket, { projectId, lastSequence }) {
        const session = this.socketSessions.get(socket.id);
        if (!session || session.projectId !== parseInt(projectId)) {
            socket.emit('error', { message: 'Not authenticated for this project' });
            return;
        }
        
        // Get missed operations
        const operations = await this.db.getOperationsSince(projectId, lastSequence);
        
        socket.emit('sync_response', {
            operations: operations,
            currentSequence: this.projectRooms.get(parseInt(projectId))?.sequenceNumber || 0
        });
    }
    
    async getActiveUsersInProject(projectId) {
        const users = new Map(); // userId -> user info
        
        // Collect unique users from all sessions in this project
        for (const [socketId, session] of this.socketSessions.entries()) {
            if (session.projectId === parseInt(projectId)) {
                if (!users.has(session.userId)) {
                    users.set(session.userId, {
                        userId: session.userId,
                        username: session.username,
                        displayName: session.displayName,
                        tabs: []
                    });
                }
                
                users.get(session.userId).tabs.push({
                    socketId: socketId,
                    tabId: session.tabId
                });
            }
        }
        
        return Array.from(users.values());
    }
    
    handleDisconnect(socket) {
        const session = this.socketSessions.get(socket.id);
        if (!session) return;
        
        console.log(`🔌 Disconnecting ${session.username} (${session.tabId})`);
        
        // Remove from session map
        this.socketSessions.delete(socket.id);
        
        // Unregister from undo state sync
        this.undoStateSync.unregisterUserSession(session.userId, socket.id);
        
        // Remove from user's socket set
        const userSocketSet = this.userSockets.get(session.userId);
        if (userSocketSet) {
            userSocketSet.delete(socket.id);
            if (userSocketSet.size === 0) {
                this.userSockets.delete(session.userId);
            }
        }
        
        // Remove from project room
        const room = this.projectRooms.get(session.projectId);
        if (room) {
            room.sockets.delete(socket.id);
            
            // Only notify if this was the user's last tab
            const userStillConnected = this.userSockets.has(session.userId);
            
            if (!userStillConnected) {
                // User completely left
                socket.to(`project_${session.projectId}`).emit('user_left', {
                    userId: session.userId,
                    username: session.username
                });
            } else {
                // Just one tab closed
                socket.to(`project_${session.projectId}`).emit('tab_closed', {
                    userId: session.userId,
                    tabId: session.tabId
                });
            }
            
            // Update active users
            this.getActiveUsersInProject(session.projectId).then(users => {
                this.io.to(`project_${session.projectId}`).emit('active_users', users);
            });
            
            // Clean up empty rooms
            if (room.sockets.size === 0) {
                this.projectRooms.delete(session.projectId);
                console.log(`🧹 Cleaned up empty room for project ${session.projectId}`);
            }
        }
    }
    
    /**
     * Handle heartbeat ping from client
     */
    handlePing(socket, timestamp) {
        // Simple pong response - just echo back the timestamp
        // This allows client to calculate round-trip time
        socket.emit('pong', timestamp);
        
        // Optional: Update last seen time for connection monitoring
        const session = this.socketSessions.get(socket.id);
        if (session) {
            session.lastPing = Date.now();
        }
    }
    
    async handleLeaveProject(socket, { projectId }) {
        // Similar to disconnect but initiated by user
        this.handleDisconnect(socket);
        socket.emit('project_left', { projectId });
    }
    
    /**
     * Handle state-based operation execution
     */
    async handleExecuteOperation(socket, data) {
        const { operationId, type, params, stateVersion, undoData, transactionId } = data;
        
        const session = this.socketSessions.get(socket.id);
        
        console.log(`🎯 Execute operation request:`, {
            operationId,
            type,
            hasUndoData: !!undoData,
            undoDataKeys: undoData ? Object.keys(undoData) : null,
            userId: session?.userId,
            projectId: session?.projectId,
            socketId: socket.id
        });
        
        if (!session) {
            console.error('❌ Operation rejected: No session for socket', socket.id);
            socket.emit('operation_rejected', {
                operationId,
                error: 'Not authenticated'
            });
            return;
        }
        
        // Check operation size to prevent server overload
        const operationSize = JSON.stringify(data).length;
        const MAX_OPERATION_SIZE = 100 * 1024; // 100KB limit
        
        if (operationSize > MAX_OPERATION_SIZE) {
            console.error(`❌ Operation rejected - too large: ${operationSize} bytes (${(operationSize / 1024 / 1024).toFixed(2)}MB)`);
            console.error(`   Type: ${type}, Has embedded data: ${JSON.stringify(params).includes('data:image')}`);
            
            socket.emit('operation_rejected', {
                operationId,
                error: `Operation too large (${(operationSize / 1024 / 1024).toFixed(2)}MB). Please upload images via HTTP first.`,
                details: {
                    size: operationSize,
                    maxSize: MAX_OPERATION_SIZE,
                    type: type
                }
            });
            return;
        }
        
        const projectId = session.projectId;
        
        try {
            // Execute operation on server state
            const result = await this.stateManager.executeOperation(
                projectId,
                { type, params },
                session.userId
            );
            
            if (result.success) {
                // Record operation in history for undo/redo
                const operation = {
                    id: operationId,
                    type,
                    params,
                    undoData,
                    sequenceNumber: result.stateVersion
                };
                
                // console.log(`📝 About to record operation with undo data:`, !!undoData);
                
                // Get active transaction if any
                const transactionKey = `${session.userId}-${projectId}`;
                const activeTransaction = this.activeTransactions.get(transactionKey);
                const txId = activeTransaction ? activeTransaction.id : transactionId;
                
                console.log(`📝 Recording operation in history:`, {
                    operationId: operation.id,
                    type: operation.type,
                    hasUndoData: !!operation.undoData,
                    userId: session.userId,
                    projectId: projectId,
                    transactionId: txId
                });
                
                await this.operationHistory.recordOperation(
                    operation,
                    session.userId,
                    projectId,
                    txId
                );
                
                console.log(`✅ Operation recorded successfully`);
                
                // Send acknowledgment to originator
                socket.emit('operation_ack', {
                    operationId,
                    stateVersion: result.stateVersion
                });
                
                // Broadcast state update to all clients in project
                this.io.to(`project_${projectId}`).emit('state_update', {
                    stateVersion: result.stateVersion,
                    changes: result.changes,
                    operationId,
                    fromUserId: session.userId,
                    fromTabId: session.tabId
                });
                
                // Send updated undo state to all user's sessions
                const undoState = this.operationHistory.getUserUndoState(session.userId, projectId);
                console.log(`📤 Sending undo state update to user ${session.userId}:`, {
                    canUndo: undoState.canUndo,
                    undoCount: undoState.undoCount,
                    projectId: projectId
                });
                this.undoStateSync.broadcastToUser(session.userId, 'undo_state_update', {
                    projectId,
                    undoState
                });
                
                // console.log(`✅ Operation ${type} executed, new version: ${result.stateVersion}`);
            } else {
                // Reject operation
                socket.emit('operation_rejected', {
                    operationId,
                    error: result.error,
                    stateVersion: result.stateVersion
                });
                
                // console.log(`❌ Operation ${type} rejected: ${result.error}`);
            }
        } catch (error) {
            console.error('Error executing operation:', error);
            socket.emit('operation_rejected', {
                operationId,
                error: 'Internal server error'
            });
        }
    }
    
    /**
     * Handle full state sync request
     */
    async handleRequestFullSync(socket, data) {
        const session = this.socketSessions.get(socket.id);
        if (!session) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }
        
        const projectId = data.projectId || session.projectId;
        
        try {
            // Get full state from state manager
            const fullState = await this.stateManager.getFullState(projectId);
            
            socket.emit('full_state_sync', {
                state: fullState,
                stateVersion: fullState.version
            });
            
            console.log(`📤 Sent full state sync to ${session.username}, version: ${fullState.version}`);
        } catch (error) {
            console.error('Error sending full state sync:', error);
            socket.emit('error', { message: 'Failed to sync state' });
        }
    }
    
    /**
     * Handle undo operation request
     */
    async handleUndoOperation(socket, data) {
        const session = this.socketSessions.get(socket.id);
        if (!session) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }
        
        try {
            const result = await this.undoStateSync.handleUndo(
                session.userId,
                session.projectId,
                socket.id
            );
            
            if (result.success) {
                socket.emit('undo_success', result);
                
                // Broadcast state changes to all clients in the project
                if (result.stateUpdate) {
                    // Get current state version
                    const currentVersion = this.stateManager.stateVersions.get(session.projectId) || 0;
                    
                    // Broadcast state update to all clients
                    this.io.to(`project_${session.projectId}`).emit('state_update', {
                        stateVersion: currentVersion,
                        operationId: `undo_${Date.now()}`,
                        fromUserId: session.userId,
                        changes: result.stateUpdate,
                        isUndo: true
                    });
                    
                    console.log(`📡 Broadcast undo state changes to project ${session.projectId}`);
                }
            } else {
                socket.emit('undo_failed', result);
            }
        } catch (error) {
            console.error('Error handling undo:', error);
            socket.emit('error', { message: 'Failed to undo operation' });
        }
    }
    
    /**
     * Handle redo operation request
     */
    async handleRedoOperation(socket, data) {
        const session = this.socketSessions.get(socket.id);
        if (!session) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }
        
        try {
            const result = await this.undoStateSync.handleRedo(
                session.userId,
                session.projectId,
                socket.id
            );
            
            if (result.success) {
                socket.emit('redo_success', result);
                
                // Broadcast state changes to all clients in the project
                if (result.stateUpdate) {
                    // Get current state version
                    const currentVersion = this.stateManager.stateVersions.get(session.projectId) || 0;
                    
                    // Broadcast state update to all clients
                    this.io.to(`project_${session.projectId}`).emit('state_update', {
                        stateVersion: currentVersion,
                        operationId: `redo_${Date.now()}`,
                        fromUserId: session.userId,
                        changes: result.stateUpdate,
                        isRedo: true
                    });
                    
                    console.log(`📡 Broadcast redo state changes to project ${session.projectId}`);
                }
            } else {
                socket.emit('redo_failed', result);
            }
        } catch (error) {
            console.error('Error handling redo:', error);
            socket.emit('error', { message: 'Failed to redo operation' });
        }
    }
    
    /**
     * Get detailed undo history for debug HUD
     */
    async handleGetUndoHistory(socket, data) {
        console.log('📥 Server: Received get_undo_history request:', data);
        
        const session = this.socketSessions.get(socket.id);
        if (!session) {
            console.error('❌ Server: get_undo_history - No session found for socket:', socket.id);
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }
        
        console.log('✅ Server: Session found for get_undo_history:', {
            userId: session.userId,
            projectId: session.projectId
        });
        
        const { limit = 10, showAllUsers = false } = data;
        
        try {
            let undoOperations, redoOperations;
            
            if (showAllUsers) {
                // Get operations from all users for debugging
                undoOperations = this.operationHistory.getAllProjectOperations(
                    session.projectId,
                    limit,
                    'undo'
                );
                
                redoOperations = this.operationHistory.getAllProjectOperations(
                    session.projectId,
                    limit,
                    'redo'
                );
            } else {
                // Get operations for specific user
                undoOperations = this.operationHistory.getUndoableOperations(
                    session.userId,
                    session.projectId,
                    limit
                );
                
                redoOperations = this.operationHistory.getRedoableOperations(
                    session.userId,
                    session.projectId,
                    limit
                );
            }
            
            // Get detailed operation info
            const undoDetails = undoOperations.map(item => {
                if (item.type === 'transaction') {
                    // Bundle of operations
                    const ops = item.operationIds.map(id => this.operationHistory.operations.get(id)).filter(Boolean);
                    return {
                        type: 'bundled_operations',
                        operationId: item.transactionId,
                        timestamp: item.timestamp,
                        operationCount: ops.length,
                        operations: ops.map(op => ({
                            type: op.type,
                            params: op.params,
                            undoData: op.undoData
                        }))
                    };
                } else if (item.type === 'single') {
                    // Single operation
                    const op = this.operationHistory.operations.get(item.operationId);
                    return op ? {
                        type: op.type,
                        operationId: op.id,
                        timestamp: op.timestamp,
                        params: op.params,
                        undoData: op.undoData,
                        userId: op.userId
                    } : null;
                } else {
                    // Fallback for operations without type field
                    const op = this.operationHistory.operations.get(item.operationId);
                    return op ? {
                        type: op.type,
                        operationId: op.id,
                        timestamp: op.timestamp,
                        params: op.params,
                        undoData: op.undoData,
                        userId: op.userId
                    } : null;
                }
            }).filter(Boolean);
            
            const redoDetails = redoOperations.map(item => {
                if (item.type === 'transaction') {
                    const ops = item.operationIds.map(id => this.operationHistory.operations.get(id)).filter(Boolean);
                    return {
                        type: 'bundled_operations',
                        operationId: item.transactionId,
                        timestamp: item.timestamp,
                        operationCount: ops.length,
                        operations: ops.map(op => ({
                            type: op.type,
                            params: op.params,
                            undoData: op.undoData
                        }))
                    };
                } else if (item.type === 'single') {
                    const op = this.operationHistory.operations.get(item.operationId);
                    return op ? {
                        type: op.type,
                        operationId: op.id,
                        timestamp: op.timestamp,
                        params: op.params,
                        undoData: op.undoData,
                        userId: op.userId
                    } : null;
                } else {
                    // Fallback for operations without type field
                    const op = this.operationHistory.operations.get(item.operationId);
                    return op ? {
                        type: op.type,
                        operationId: op.id,
                        timestamp: op.timestamp,
                        params: op.params,
                        undoData: op.undoData,
                        userId: op.userId
                    } : null;
                }
            }).filter(Boolean);
            
            const response = {
                undoOperations: undoDetails,
                redoOperations: redoDetails,
                serverStateVersion: this.stateManager.stateVersions.get(session.projectId) || 0,
                timestamp: Date.now()
            };
            
            console.log('📤 Server: Sending undo_history response:', {
                undoCount: undoDetails.length,
                redoCount: redoDetails.length,
                timestamp: response.timestamp
            });
            
            socket.emit('undo_history', response);
            
        } catch (error) {
            console.error('❌ Server: Error getting undo history:', error);
            socket.emit('error', { message: 'Failed to get undo history' });
        }
    }
    
    /**
     * Handle request for current undo state
     */
    async handleRequestUndoState(socket, data) {
        const session = this.socketSessions.get(socket.id);
        if (!session) {
            console.error('❌ Request undo state failed: No session found for socket', socket.id);
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }
        
        // Log the request details
        console.log('📋 Undo state requested:', {
            socketId: socket.id,
            sessionUserId: session.userId,
            sessionProjectId: session.projectId,
            requestUserId: data?.userId,
            requestProjectId: data?.projectId,
            tabId: session.tabId
        });
        
        try {
            const undoState = this.operationHistory.getUserUndoState(
                session.userId,
                session.projectId
            );
            
            console.log('📊 Undo state retrieved:', {
                userId: session.userId,
                projectId: session.projectId,
                canUndo: undoState.canUndo,
                undoCount: undoState.undoCount,
                canRedo: undoState.canRedo,
                redoCount: undoState.redoCount
            });
            
            socket.emit('undo_state_update', {
                projectId: session.projectId,
                undoState
            });
        } catch (error) {
            console.error('❌ Error getting undo state:', error);
            socket.emit('error', { message: 'Failed to get undo state' });
        }
    }
    
    /**
     * Handle request to clear undo history for a project
     */
    async handleClearUndoHistory(socket, data) {
        const session = this.socketSessions.get(socket.id);
        if (!session) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }
        
        const { projectId } = data;
        
        // Verify user has access to this project
        if (session.projectId !== projectId) {
            socket.emit('error', { message: 'Not authorized for this project' });
            return;
        }
        
        try {
            console.log(`🧹 Clearing undo history for project ${projectId} requested by user ${session.userId}`);
            
            // Clear the operation history for this project
            if (this.operationHistory) {
                // Clear project's operation history
                const cleared = await this.operationHistory.clearProjectHistory(projectId);
                console.log(`✅ Cleared ${cleared} operations for project ${projectId}`);
            }
            
            // Clear from database
            const deleteResult = await this.db.run(
                'DELETE FROM operations WHERE project_id = ?',
                [projectId]
            );
            console.log(`🗑️ Deleted ${deleteResult.changes} operations from database for project ${projectId}`);
            
            // Notify all users in the project that undo history was cleared
            const undoState = {
                canUndo: false,
                canRedo: false,
                undoCount: 0,
                redoCount: 0,
                nextUndo: null,
                nextRedo: null
            };
            
            this.io.to(`project_${projectId}`).emit('undo_state_update', {
                projectId,
                undoState,
                cleared: true
            });
            
            socket.emit('undo_history_cleared', {
                projectId,
                success: true,
                deletedCount: deleteResult.changes
            });
            
            console.log(`✅ Undo history cleared for project ${projectId}`);
        } catch (error) {
            console.error('Error clearing undo history:', error);
            socket.emit('error', { message: 'Failed to clear undo history' });
        }
    }
    
    /**
     * Handle beginning of transaction
     */
    async handleBeginTransaction(socket, data) {
        const session = this.socketSessions.get(socket.id);
        if (!session) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }
        
        const { source } = data;
        const transactionKey = `${session.userId}-${session.projectId}`;
        
        // Create new transaction
        const transaction = {
            id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            userId: session.userId,
            projectId: session.projectId,
            source: source,
            startedAt: Date.now(),
            operations: []
        };
        
        this.activeTransactions.set(transactionKey, transaction);
        
        socket.emit('transaction_started', {
            transactionId: transaction.id
        });
        
        console.log(`📝 Transaction started: ${transaction.id} (${source})`);
    }
    
    /**
     * Handle transaction commit
     */
    async handleCommitTransaction(socket, data) {
        const session = this.socketSessions.get(socket.id);
        if (!session) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }
        
        const transactionKey = `${session.userId}-${session.projectId}`;
        const transaction = this.activeTransactions.get(transactionKey);
        
        if (!transaction) {
            socket.emit('error', { message: 'No active transaction' });
            return;
        }
        
        // Remove from active transactions
        this.activeTransactions.delete(transactionKey);
        
        socket.emit('transaction_committed', {
            transactionId: transaction.id,
            operationCount: transaction.operations.length
        });
        
        console.log(`✅ Transaction committed: ${transaction.id} (${transaction.operations.length} operations)`);
    }
    
    /**
     * Handle transaction abort
     */
    async handleAbortTransaction(socket, data) {
        const session = this.socketSessions.get(socket.id);
        if (!session) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }
        
        const transactionKey = `${session.userId}-${session.projectId}`;
        const transaction = this.activeTransactions.get(transactionKey);
        
        if (!transaction) {
            socket.emit('error', { message: 'No active transaction' });
            return;
        }
        
        // TODO: Implement rollback of operations in aborted transaction
        // For now, just remove the transaction
        this.activeTransactions.delete(transactionKey);
        
        socket.emit('transaction_aborted', {
            transactionId: transaction.id
        });
        
        console.log(`❌ Transaction aborted: ${transaction.id}`);
    }
}

module.exports = CollaborationManager;
