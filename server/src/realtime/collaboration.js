const { v4: uuidv4 } = require('uuid');
const CanvasStateManager = require('./CanvasStateManager');

/**
 * Fixed Collaboration Manager - Supports multiple tabs per user
 * Key changes:
 * 1. Each tab gets a unique socket connection
 * 2. Multiple tabs can share the same user account
 * 3. Operations sync across all tabs of the same user
 * 4. Server maintains authoritative state
 */
class CollaborationManager {
    constructor(io, db) {
        this.io = io;
        this.db = db;
        
        // State manager for authoritative canvas state
        this.stateManager = new CanvasStateManager(db);
        
        // Track sessions by socket ID
        this.socketSessions = new Map(); // socketId -> session info
        
        // Track which sockets belong to which user
        this.userSockets = new Map(); // userId -> Set of socketIds
        
        // Track project rooms
        this.projectRooms = new Map(); // projectId -> room info
        
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
        
        // Store operation
        await this.db.addOperation(
            projectId,
            session.userId,
            operation.type,
            operation.data,
            operation.sequence
        );
        
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
        
        console.log(`📤 Operation ${operation.type} from ${session.username} (${session.tabId})`);
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
    
    async handleLeaveProject(socket, { projectId }) {
        // Similar to disconnect but initiated by user
        this.handleDisconnect(socket);
        socket.emit('project_left', { projectId });
    }
    
    /**
     * Handle state-based operation execution
     */
    async handleExecuteOperation(socket, data) {
        const { operationId, type, params, stateVersion } = data;
        const session = this.socketSessions.get(socket.id);
        
        if (!session) {
            socket.emit('operation_rejected', {
                operationId,
                error: 'Not authenticated'
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
                
                console.log(`✅ Operation ${type} executed, new version: ${result.stateVersion}`);
            } else {
                // Reject operation
                socket.emit('operation_rejected', {
                    operationId,
                    error: result.error,
                    stateVersion: result.stateVersion
                });
                
                console.log(`❌ Operation ${type} rejected: ${result.error}`);
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
}

module.exports = CollaborationManager;