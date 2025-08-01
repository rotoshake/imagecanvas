const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
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
        
        // Track canvas rooms
        this.canvasRooms = new Map(); // canvasId -> room info
        
        // Track active transactions
        this.activeTransactions = new Map(); // `${userId}-${canvasId}` -> transaction info
        
        this.setupSocketHandlers();
    }
    
    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            
            // Canvas management
            socket.on('join_canvas', async (data) => {
                await this.handleJoinCanvas(socket, data);
            });
            
            socket.on('leave_canvas', async (data) => {
                await this.handleLeaveCanvas(socket, data);
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
            
            // Video processing cancellation
            socket.on('cancel_video_processing', (data) => {
                this.handleCancelVideoProcessing(socket, data);
            });
            
            // Video processing resume
            socket.on('resume_video_processing', (data) => {
                this.handleResumeVideoProcessing(socket, data);
            });
            
            // Disconnect
            socket.on('disconnect', () => {
                this.handleDisconnect(socket);
            });
        });
    }
    
    async handleJoinCanvas(socket, { canvasId, username, displayName, tabId }) {
        try {
            console.log(`📥 Join request from ${username} (tab: ${tabId}) for canvas ${canvasId}`);
            
            // Find or create user (but allow multiple connections)
            let user = await this.db.getUserByUsername(username);
            if (!user) {
                const userId = await this.db.createUser(username, displayName);
                user = await this.db.getUser(userId);
                console.log(`👤 Created new user: ${username} (ID: ${userId})`);
            } else {
                console.log(`👤 Found existing user: ${username} (ID: ${user.id})`);
            }
            
            // Verify canvas exists
            const canvas = await this.getOrCreateCanvas(canvasId, user);
            if (!canvas) {
                socket.emit('error', { message: 'Canvas not found' });
                return;
            }
            
            // Create session for this specific socket/tab
            const session = {
                socketId: socket.id,
                userId: user.id,
                canvasId: canvas.id,
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
            
            // Initialize operation history for this canvas
            await this.operationHistory.initializeCanvas(canvas.id);
            
            // Join socket room
            socket.join(`canvas_${canvas.id}`);
            
            // Initialize canvas room if needed
            if (!this.canvasRooms.has(canvas.id)) {
                const latestOp = await this.db.get(
                    'SELECT MAX(sequence_number) as latest FROM operations WHERE canvas_id = ?',
                    [canvas.id]
                );
                
                this.canvasRooms.set(canvas.id, {
                    sockets: new Set(),
                    sequenceNumber: latestOp?.latest || 0
                });
            }
            
            const room = this.canvasRooms.get(canvas.id);
            room.sockets.add(socket.id);
            
            // Send success response
            socket.emit('canvas_joined', {
                canvas: canvas,
                session: {
                    userId: user.id,
                    username: user.username,
                    displayName: session.displayName,
                    tabId: session.tabId
                },
                sequenceNumber: room.sequenceNumber
            });
            
            // Get active users (count unique users, not sockets)
            const activeUsers = await this.getActiveUsersInCanvas(canvas.id);
            
            // Send to joining socket
            socket.emit('active_users', activeUsers);
            
            // Notify others (including other tabs of same user)
            socket.to(`canvas_${canvas.id}`).emit('user_joined', {
                userId: user.id,
                username: user.username,
                displayName: session.displayName,
                tabId: session.tabId
            });
            
            // Send updated user list to all
            socket.to(`canvas_${canvas.id}`).emit('active_users', activeUsers);
            
            // Request state from another tab (prefer same user's tab if available)
            if (room.sockets.size > 1) {
                const otherSockets = Array.from(room.sockets).filter(sid => sid !== socket.id);
                const sameUserSocket = otherSockets.find(sid => {
                    const sess = this.socketSessions.get(sid);
                    return sess && sess.userId === user.id;
                });
                
                const targetSocket = sameUserSocket || otherSockets[0];
                this.io.to(targetSocket).emit('request_canvas_state', {
                    forUser: socket.id,
                    canvasId: canvas.id
                });
            }
            
            console.log(`✅ ${username} (${session.tabId}) joined canvas ${canvas.name}`);
            
            // Send initial undo state to the user
            const undoState = this.operationHistory.getUserUndoState(user.id, canvas.id);
            socket.emit('undo_state_update', {
                undoState,
                canvasId: canvas.id
            });
            
        } catch (error) {
            console.error('Error in handleJoinCanvas:', error);
            socket.emit('error', { message: 'Failed to join canvas' });
        }
    }
    
    async getOrCreateCanvas(canvasId, user) {
        if (canvasId === 'demo-canvas' || canvasId === 1) {
            // Handle demo canvas - check canvases table by name
            let canvas = await this.db.get('SELECT * FROM canvases WHERE name = ?', ['Demo Canvas']);
            if (!canvas) {
                const id = await this.db.createCanvas('Demo Canvas', user.id, 'Collaborative demo canvas');
                canvas = await this.db.getCanvas(id);
            }
            return canvas;
        }
        
        return await this.db.getCanvas(canvasId);
    }
    
    async handleCanvasOperation(socket, { canvasId, operation }) {
        const session = this.socketSessions.get(socket.id);
        if (!session || session.canvasId !== parseInt(canvasId)) {
            socket.emit('error', { message: 'Not authenticated for this canvas' });
            return;
        }
        
        const room = this.canvasRooms.get(parseInt(canvasId));
        if (!room) {
            socket.emit('error', { message: 'Canvas room not found' });
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
            canvasId,
            session.userId,
            operation.type,
            operation.data,
            operation.sequence
        );
        */
        
        // Apply operation to state manager for persistence
        try {
            await this.applyOperationToState(canvasId, operation);
        } catch (error) {
            console.error('❌ Failed to apply operation to state manager:', error);
        }
        
        // Broadcast to ALL sockets in the room (including sender's other tabs)
        this.io.to(`canvas_${canvasId}`).emit('canvas_operation', {
            operation: operation,
            fromUserId: session.userId,
            fromTabId: session.tabId,
            fromSocketId: socket.id
        });
        
        // 
    }
    
    /**
     * Apply canvas operation to state manager for persistence
     */
    async applyOperationToState(canvasId, operation) {
        // Convert legacy canvas operation to state manager format
        const stateOperation = this.convertToStateOperation(operation);
        
        if (stateOperation) {
            const result = await this.stateManager.executeOperation(canvasId, stateOperation, operation.userId);
            return result;
        } else {
            
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
                
                return null;
        }
    }
    
    async handleSyncCheck(socket, { canvasId, lastSequence }) {
        const session = this.socketSessions.get(socket.id);
        if (!session || session.canvasId !== parseInt(canvasId)) {
            socket.emit('error', { message: 'Not authenticated for this canvas' });
            return;
        }
        
        // Get missed operations
        const operations = await this.db.getOperationsSince(canvasId, lastSequence);
        
        socket.emit('sync_response', {
            operations: operations,
            currentSequence: this.canvasRooms.get(parseInt(canvasId))?.sequenceNumber || 0
        });
    }
    
    async getActiveUsersInCanvas(canvasId) {
        const users = new Map(); // userId -> user info
        
        // Collect unique users from all sessions in this canvas
        for (const [socketId, session] of this.socketSessions.entries()) {
            if (session.canvasId === parseInt(canvasId)) {
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
        
        // Remove from canvas room
        const room = this.canvasRooms.get(session.canvasId);
        if (room) {
            room.sockets.delete(socket.id);
            
            // Only notify if this was the user's last tab
            const userStillConnected = this.userSockets.has(session.userId);
            
            if (!userStillConnected) {
                // User completely left
                socket.to(`canvas_${session.canvasId}`).emit('user_left', {
                    userId: session.userId,
                    username: session.username
                });
            } else {
                // Just one tab closed
                socket.to(`canvas_${session.canvasId}`).emit('tab_closed', {
                    userId: session.userId,
                    tabId: session.tabId
                });
            }
            
            // Update active users
            this.getActiveUsersInCanvas(session.canvasId).then(users => {
                this.io.to(`canvas_${session.canvasId}`).emit('active_users', users);
            });
            
            // Clean up empty rooms
            if (room.sockets.size === 0) {
                this.canvasRooms.delete(session.canvasId);
                
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
    
    async handleLeaveCanvas(socket, { canvasId }) {
        // Similar to disconnect but initiated by user
        this.handleDisconnect(socket);
        socket.emit('canvas_left', { canvasId });
    }
    
    /**
     * Handle video processing cancellation
     */
    async handleCancelVideoProcessing(socket, { filename }) {
        console.log(`🚫 Received video processing cancellation request for: ${filename}`);
        
        // Get the server instance through the app
        const server = this.db.server || global.imageCanvasServer;
        if (server && server.videoProcessor) {
            const cancelled = await server.videoProcessor.cancelProcessing(filename);
            
            if (cancelled) {
                // Emit cancellation confirmation
                socket.emit('video_processing_cancelled', { 
                    filename, 
                    success: true 
                });
                
                // Also emit to all clients that the video was cancelled
                this.io.emit('video_processing_complete', {
                    filename,
                    success: false,
                    error: 'Cancelled by user'
                });
            } else {
                socket.emit('video_processing_cancelled', { 
                    filename, 
                    success: false,
                    error: 'Processing not found' 
                });
            }
        } else {
            console.error('⚠️ VideoProcessor not available');
            socket.emit('video_processing_cancelled', { 
                filename, 
                success: false,
                error: 'Server video processor not available' 
            });
        }
    }
    
    /**
     * Handle video processing resume request
     */
    async handleResumeVideoProcessing(socket, { filename, serverFilename }) {
        console.log(`🔄 Received video processing resume request for: ${filename}`);
        
        const server = this.db.server || global.imageCanvasServer;
        if (!server || !server.videoProcessor) {
            console.error('⚠️ VideoProcessor not available');
            socket.emit('error', { message: 'Video processor not available' });
            return;
        }
        
        try {
            // Check if file exists on disk
            const uploadPath = path.join(server.uploadDir, serverFilename);
            const fileExists = await fs.access(uploadPath).then(() => true).catch(() => false);
            
            if (!fileExists) {
                console.error(`❌ Video file not found: ${uploadPath}`);
                socket.emit('video_processing_error', {
                    filename,
                    error: 'Source file not found'
                });
                return;
            }
            
            // Check processing status in database
            const fileRecord = await this.db.get(
                `SELECT processing_status FROM files WHERE filename = ?`,
                [serverFilename]
            );
            
            if (fileRecord && fileRecord.processing_status === 'completed') {
                console.log(`✅ Video already processed: ${filename}`);
                // Emit completion event so the node can update
                this.io.emit('video_processing_complete', {
                    filename,
                    serverFilename,
                    success: true,
                    formats: ['webm'] // TODO: Get actual formats from DB
                });
                return;
            }
            
            // Update status to pending
            await this.db.run(
                `UPDATE files SET processing_status = 'pending' WHERE filename = ?`,
                [serverFilename]
            );
            
            // Re-queue for processing
            console.log(`📝 Re-queuing video for processing: ${filename}`);
            
            // Emit start event
            this.io.emit('video_processing_start', {
                filename,
                serverFilename
            });
            
            // Process the video
            const outputDir = path.join(path.dirname(uploadPath), '');
            const baseFilename = path.parse(serverFilename).name;
            
            server.videoProcessor.processVideo(uploadPath, outputDir, baseFilename, filename)
                .then(results => {
                    console.log(`✅ Video processing resumed and completed: ${filename}`);
                    
                    // Update database
                    this.db.run(
                        `UPDATE files SET processing_status = 'completed', processed_formats = ? WHERE filename = ?`,
                        [Object.keys(results.formats).join(','), serverFilename]
                    );
                    
                    // Emit completion
                    this.io.emit('video_processing_complete', {
                        filename,
                        serverFilename,
                        success: true,
                        formats: Object.keys(results.formats)
                    });
                })
                .catch(error => {
                    console.error(`❌ Video processing resume failed: ${filename}`, error);
                    
                    // Update database
                    this.db.run(
                        `UPDATE files SET processing_status = 'error', processing_error = ? WHERE filename = ?`,
                        [error.message, serverFilename]
                    );
                    
                    // Emit error
                    this.io.emit('video_processing_complete', {
                        filename,
                        serverFilename,
                        success: false,
                        error: error.message
                    });
                });
            
        } catch (error) {
            console.error(`❌ Error resuming video processing:`, error);
            socket.emit('error', { message: 'Failed to resume video processing' });
        }
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
            canvasId: session?.canvasId,
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
        
        const canvasId = session.canvasId;
        
        try {
            // Execute operation on server state
            const result = await this.stateManager.executeOperation(
                canvasId,
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
                    sequenceNumber: result.stateVersion,
                    changes: result.changes // Include server-captured changes
                };
                
                // 
                // Get active transaction if any
                const transactionKey = `${session.userId}-${canvasId}`;
                const activeTransaction = this.activeTransactions.get(transactionKey);
                const txId = activeTransaction ? activeTransaction.id : transactionId;

                await this.operationHistory.recordOperation(
                    operation,
                    session.userId,
                    canvasId,
                    txId
                );

                // Send acknowledgment to originator
                socket.emit('operation_ack', {
                    operationId,
                    stateVersion: result.stateVersion
                });
                
                // Broadcast state update to all clients in canvas
                this.io.to(`canvas_${canvasId}`).emit('state_update', {
                    stateVersion: result.stateVersion,
                    changes: result.changes,
                    operationId,
                    fromUserId: session.userId,
                    fromTabId: session.tabId
                });
                
                // Send updated undo state to all user's sessions
                const undoState = this.operationHistory.getUserUndoState(session.userId, canvasId);
                
                this.undoStateSync.broadcastToUser(session.userId, 'undo_state_update', {
                    canvasId,
                    undoState
                });
                
                // 
            } else {
                // Reject operation
                socket.emit('operation_rejected', {
                    operationId,
                    error: result.error,
                    stateVersion: result.stateVersion
                });
                
                // 
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
        
        const canvasId = data.canvasId || session.canvasId;
        
        try {
            // Get full state from state manager
            const fullState = await this.stateManager.getFullState(canvasId);
            
            socket.emit('full_state_sync', {
                state: fullState,
                stateVersion: fullState.version
            });

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
                session.canvasId,
                socket.id
            );
            
            if (result.success) {
                socket.emit('undo_success', result);
                
                // Broadcast state changes to all clients in the canvas
                if (result.stateUpdate) {
                    // Get current state version
                    const currentVersion = this.stateManager.stateVersions.get(session.canvasId) || 0;
                    
                    // Broadcast state update to all clients
                    this.io.to(`canvas_${session.canvasId}`).emit('state_update', {
                        stateVersion: currentVersion,
                        operationId: `undo_${Date.now()}`,
                        fromUserId: session.userId,
                        changes: result.stateUpdate,
                        isUndo: true
                    });

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
                session.canvasId,
                socket.id
            );
            
            if (result.success) {
                socket.emit('redo_success', result);
                
                // Broadcast state changes to all clients in the canvas
                if (result.stateUpdate) {
                    // Get current state version
                    const currentVersion = this.stateManager.stateVersions.get(session.canvasId) || 0;
                    
                    // Broadcast state update to all clients
                    this.io.to(`canvas_${session.canvasId}`).emit('state_update', {
                        stateVersion: currentVersion,
                        operationId: `redo_${Date.now()}`,
                        fromUserId: session.userId,
                        changes: result.stateUpdate,
                        isRedo: true
                    });

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
        
        const session = this.socketSessions.get(socket.id);
        if (!session) {
            console.error('❌ Server: get_undo_history - No session found for socket:', socket.id);
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }

        const { limit = 10, showAllUsers = false } = data;
        
        try {
            let undoOperations, redoOperations;
            
            if (showAllUsers) {
                // Get operations from all users for debugging
                undoOperations = this.operationHistory.getAllCanvasOperations(
                    session.canvasId,
                    limit,
                    'undo'
                );
                
                redoOperations = this.operationHistory.getAllCanvasOperations(
                    session.canvasId,
                    limit,
                    'redo'
                );
            } else {
                // Get operations for specific user
                undoOperations = this.operationHistory.getUndoableOperations(
                    session.userId,
                    session.canvasId,
                    limit
                );
                
                redoOperations = this.operationHistory.getRedoableOperations(
                    session.userId,
                    session.canvasId,
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
                serverStateVersion: this.stateManager.stateVersions.get(session.canvasId) || 0,
                timestamp: Date.now()
            };

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
        
        try {
            const undoState = this.operationHistory.getUserUndoState(
                session.userId,
                session.canvasId
            );

            socket.emit('undo_state_update', {
                canvasId: session.canvasId,
                undoState
            });
        } catch (error) {
            console.error('❌ Error getting undo state:', error);
            socket.emit('error', { message: 'Failed to get undo state' });
        }
    }
    
    /**
     * Handle request to clear undo history for a canvas
     */
    async handleClearUndoHistory(socket, data) {
        const session = this.socketSessions.get(socket.id);
        if (!session) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }
        
        const { canvasId } = data;
        
        // Verify user has access to this canvas
        if (session.canvasId !== canvasId) {
            socket.emit('error', { message: 'Not authorized for this canvas' });
            return;
        }
        
        try {
            
            // Clear the operation history for this canvas
            if (this.operationHistory) {
                // Clear canvas's operation history
                const cleared = await this.operationHistory.clearCanvasHistory(canvasId);
                
            }
            
            // Clear from database
            const deleteResult = await this.db.run(
                'DELETE FROM operations WHERE canvas_id = ?',
                [canvasId]
            );
            
            // Notify all users in the canvas that undo history was cleared
            const undoState = {
                canUndo: false,
                canRedo: false,
                undoCount: 0,
                redoCount: 0,
                nextUndo: null,
                nextRedo: null
            };
            
            this.io.to(`canvas_${canvasId}`).emit('undo_state_update', {
                canvasId,
                undoState,
                cleared: true
            });
            
            socket.emit('undo_history_cleared', {
                canvasId,
                success: true,
                deletedCount: deleteResult.changes
            });

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
        const transactionKey = `${session.userId}-${session.canvasId}`;
        
        // Create new transaction
        const transaction = {
            id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            userId: session.userId,
            canvasId: session.canvasId,
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
        
        const transactionKey = `${session.userId}-${session.canvasId}`;
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
        
        const transactionKey = `${session.userId}-${session.canvasId}`;
        const transaction = this.activeTransactions.get(transactionKey);
        
        if (!transaction) {
            socket.emit('error', { message: 'No active transaction' });
            return;
        }
        
        // ✅ Transaction rollback implemented via ClientUndoManager and StateSyncManager
        // Rollback is handled by the client-side undo system with proper state restoration
        this.activeTransactions.delete(transactionKey);
        
        socket.emit('transaction_aborted', {
            transactionId: transaction.id
        });

    }
}

module.exports = CollaborationManager;
