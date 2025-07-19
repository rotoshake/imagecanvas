const { v4: uuidv4 } = require('uuid');

// Operation types for real-time synchronization
const OperationTypes = {
    NODE_CREATE: 'node_create',
    NODE_UPDATE: 'node_update',
    NODE_DELETE: 'node_delete',
    NODE_MOVE: 'node_move',
    NODE_RESIZE: 'node_resize',
    NODE_ROTATE: 'node_rotate',
    NODE_RESET: 'node_reset',
    NODE_PROPERTY_UPDATE: 'node_property_update',
    VIDEO_TOGGLE: 'video_toggle',
    NODE_ALIGN: 'node_align',
    SELECTION_CHANGE: 'selection_change',
    VIEWPORT_CHANGE: 'viewport_change',
    CURSOR_MOVE: 'cursor_move',
    PROJECT_JOIN: 'project_join',
    PROJECT_LEAVE: 'project_leave'
};

class CollaborationManager {
    constructor(io, database) {
        this.io = io;
        this.db = database;
        this.projectRooms = new Map(); // projectId -> { users: Set, sequenceNumber: number }
        this.userSessions = new Map(); // socketId -> { userId, projectId, sessionId }
        
        this.setupSocketHandlers();
        this.startCleanupInterval();
        
        console.log('🔌 Collaboration manager initialized');
    }
    
    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`👋 Client connected: ${socket.id}`);
            
            // Add immediate debug logging
            console.log('🔍 Setting up event handlers for socket:', socket.id);
            
            // Debug: Log all incoming events
            try {
                socket.onAny((eventName, ...args) => {
                    console.log('🔍 Socket event received:', eventName, 'from', socket.id);
                    if (eventName === 'sync_check') {
                        console.log('🔍 sync_check args:', args);
                    }
                });
                console.log('✅ onAny handler registered successfully');
            } catch (error) {
                console.error('❌ Failed to register onAny handler:', error);
            }
            
            // User authentication and project joining
            socket.on('join_project', async (data) => {
                await this.handleJoinProject(socket, data);
            });
            
            socket.on('leave_project', async (data) => {
                await this.handleLeaveProject(socket, data);
            });
            
            // Canvas operations
            socket.on('canvas_operation', async (data) => {
                await this.handleCanvasOperation(socket, data);
            });
            
            // Cursor and selection tracking
            socket.on('cursor_update', async (data) => {
                await this.handleCursorUpdate(socket, data);
            });
            
            socket.on('selection_update', async (data) => {
                await this.handleSelectionUpdate(socket, data);
            });
            
            // Viewport synchronization
            socket.on('viewport_update', async (data) => {
                await this.handleViewportUpdate(socket, data);
            });

            // Media operations handled via upload endpoint
            
            // Project state sharing
            socket.on('share_project_state', async (data) => {
                await this.handleProjectStateShare(socket, data);
            });
            
            // Periodic sync and health monitoring
            socket.on('sync_check', async (data) => {
                console.log('📥 sync_check event received from', socket.id, 'with data:', data);
                try {
                    await this.handleSyncCheck(socket, data);
                } catch (error) {
                    console.error('❌ Error in sync_check handler:', error);
                    console.error('Error stack:', error.stack);
                    // Re-throw to let the original error handler catch it
                    throw error;
                }
            });
            
            socket.on('heartbeat', async (data) => {
                await this.handleHeartbeat(socket, data);
            });
            
            // Disconnect handling
            socket.on('disconnect', () => {
                this.handleDisconnect(socket);
            });
            
        });
    }
    
    async handleJoinProject(socket, { projectId, userId, username, displayName }) {
        try {
            // Verify user exists or create them
            let user = await this.db.getUserByUsername(username);
            if (!user) {
                const newUserId = await this.db.createUser(username, displayName);
                user = await this.db.getUser(newUserId);
            }
            
            // Handle special demo project case
            let project;
            let actualProjectId = projectId;
            
            if (projectId === 'demo-project') {
                // Look for existing global demo project or create one
                const existingDemo = await this.db.get('SELECT * FROM projects WHERE name = ?', ['Demo Project']);
                if (existingDemo) {
                    project = existingDemo;
                    actualProjectId = existingDemo.id;
                    console.log(`🎬 ${username} joining existing demo project ${actualProjectId}`);
                } else {
                    console.log('🎬 Creating global demo project for the first time');
                    const demoProjectId = await this.db.createProject('Demo Project', user.id, 'Real-time collaborative demo canvas');
                    project = await this.db.getProject(demoProjectId);
                    actualProjectId = demoProjectId;
                    console.log(`🎬 Created demo project ${actualProjectId} for user:`, username);
                }
            } else {
                // Verify regular project exists and user has access
                project = await this.db.getProject(projectId);
                if (!project) {
                    socket.emit('error', { message: 'Project not found' });
                    return;
                }
            }
            
            // Create session
            const sessionId = uuidv4();
            const session = {
                userId: user.id,
                projectId: actualProjectId,
                sessionId: sessionId,
                username: user.username,
                displayName: user.display_name || user.username,
                joinedAt: Date.now()
            };
            
            this.userSessions.set(socket.id, session);
            
            // Join socket room
            socket.join(`project_${actualProjectId}`);
            
            // Initialize or update project room
            const roomProjectId = typeof actualProjectId === 'string' ? parseInt(actualProjectId) : actualProjectId;
            if (!this.projectRooms.has(roomProjectId)) {
                // Get the latest sequence from database
                const latestOp = await this.db.get(
                    'SELECT MAX(sequence_number) as latest FROM operations WHERE project_id = ?',
                    [roomProjectId]
                );
                const latestSequence = latestOp?.latest || 0;
                
                this.projectRooms.set(roomProjectId, {
                    users: new Set(),
                    sequenceNumber: latestSequence
                });
                
                console.log(`📊 Initialized room for project ${roomProjectId} with sequence ${latestSequence}`);
            }
            
            const room = this.projectRooms.get(roomProjectId);
            room.users.add(socket.id);
            
            // Store session in database
            await this.db.run(
                'INSERT INTO active_sessions (id, user_id, project_id, socket_id, last_activity) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
                [sessionId, user.id, actualProjectId, socket.id]
            );
            
            // Send project data to joining user
            socket.emit('project_joined', {
                project: project,
                session: session,
                sequenceNumber: room.sequenceNumber
            });
            
            // Send current active users to joining user
            const activeUsers = await this.getActiveUsersInProject(actualProjectId);
            socket.emit('active_users', activeUsers);
            
            // Project state will be shared by existing users via request_project_state
            
            // Notify other users
            socket.to(`project_${actualProjectId}`).emit('user_joined', {
                userId: user.id,
                username: user.username,
                displayName: user.display_name || user.username
            });
            
            // Request project state from existing users (if any)
            if (room.users.size > 1) {
                // Ask the first existing user to share their state
                const otherUsers = Array.from(room.users).filter(socketId => socketId !== socket.id);
                if (otherUsers.length > 0) {
                    this.io.to(otherUsers[0]).emit('request_project_state', {
                        forUser: socket.id,
                        projectId: actualProjectId
                    });
                }
            }
            
            console.log(`👤 User ${user.username} joined project ${project.name}`);
            
        } catch (error) {
            console.error('Error handling join project:', error);
            socket.emit('error', { message: 'Failed to join project' });
        }
    }
    
    async handleProjectStateShare(socket, { projectState, forUser }) {
        // Forward project state from one user to another
        if (forUser && projectState) {
            this.io.to(forUser).emit('project_state', projectState);
            console.log('📤 Shared project state between users');
        }
    }
    
    async getActiveUsersInProject(projectId) {
        try {
            // Get users from in-memory sessions (these are guaranteed to be connected)
            const activeUsers = [];
            
            console.log('📋 Getting active users for project:', projectId);
            console.log('📋 Current sessions:', this.userSessions.size);
            
            for (const [socketId, session] of this.userSessions.entries()) {
                console.log('📋 Checking session:', socketId, 'projectId:', session.projectId, 'vs', projectId);
                if (session.projectId === parseInt(projectId)) {
                    activeUsers.push({
                        userId: session.userId,
                        username: session.username,
                        displayName: session.displayName,
                        socketId: socketId
                    });
                }
            }
            
            console.log('📋 Found active users:', activeUsers.length);
            return activeUsers;
        } catch (error) {
            console.error('Error getting active users:', error);
            return [];
        }
    }
    
    async handleLeaveProject(socket, { projectId }) {
        const session = this.userSessions.get(socket.id);
        if (!session || parseInt(session.projectId) !== parseInt(projectId)) {
            // Still emit confirmation even if session not found
            socket.emit('project_left', { projectId: parseInt(projectId) });
            return;
        }
        
        await this.removeUserFromProject(socket, projectId, session);
        
        // Emit confirmation to the leaving user
        socket.emit('project_left', { projectId: parseInt(projectId) });
    }
    
    async handleCanvasOperation(socket, { projectId, operation }) {
        const session = this.userSessions.get(socket.id);
        if (!session || parseInt(session.projectId) !== parseInt(projectId)) {
            socket.emit('error', { message: 'Not authenticated for this project' });
            return;
        }
        
        try {
            const roomProjectId = typeof projectId === 'string' ? parseInt(projectId) : projectId;
            let room = this.projectRooms.get(roomProjectId);
            
            // Initialize room if it doesn't exist
            if (!room) {
                console.log('⚠️ Project room not found, initializing for project:', roomProjectId);
                
                // Get the latest sequence from database
                const latestOp = await this.db.get(
                    'SELECT MAX(sequence_number) as latest FROM operations WHERE project_id = ?',
                    [roomProjectId]
                );
                const latestSequence = latestOp?.latest || 0;
                
                this.projectRooms.set(roomProjectId, {
                    users: new Set([socket.id]),
                    sequenceNumber: latestSequence
                });
                
                room = this.projectRooms.get(roomProjectId);
            }
            
            // Assign sequence number
            room.sequenceNumber++;
            const sequenceNumber = room.sequenceNumber;
            
            // Transform operation if needed (basic implementation)
            const transformedOperation = await this.transformOperation(operation, projectId, sequenceNumber);
            
            // Store operation in database
            await this.db.addOperation(
                projectId,
                session.userId,
                transformedOperation.type,
                transformedOperation.data,
                sequenceNumber
            );
            
            // Broadcast to all users in project (including sender for confirmation)
            this.io.to(`project_${projectId}`).emit('canvas_operation', {
                operation: transformedOperation,
                sequenceNumber: sequenceNumber,
                userId: session.userId,
                username: session.username,
                timestamp: Date.now()
            });
            
            // Update project's last modified time
            await this.db.updateProject(projectId, { 
                last_modified: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Error handling canvas operation:', error);
            socket.emit('error', { message: 'Failed to process operation' });
        }
    }


    
    async handleCursorUpdate(socket, { projectId, position }) {
        const session = this.userSessions.get(socket.id);
        if (!session || parseInt(session.projectId) !== parseInt(projectId)) {
            return;
        }
        
        // Update session in database
        await this.db.run(
            'UPDATE active_sessions SET cursor_position = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?',
            [JSON.stringify(position), session.sessionId]
        );
        
        // Broadcast cursor position to other users
        socket.to(`project_${projectId}`).emit('cursor_update', {
            userId: session.userId,
            username: session.username,
            position: position
        });
    }
    
    async handleSelectionUpdate(socket, { projectId, selection }) {
        const session = this.userSessions.get(socket.id);
        if (!session || parseInt(session.projectId) !== parseInt(projectId)) {
            return;
        }
        
        // Update session in database
        await this.db.run(
            'UPDATE active_sessions SET selection_data = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?',
            [JSON.stringify(selection), session.sessionId]
        );
        
        // Broadcast selection to other users
        socket.to(`project_${projectId}`).emit('selection_update', {
            userId: session.userId,
            username: session.username,
            selection: selection
        });
    }
    
    async handleViewportUpdate(socket, { projectId, viewport }) {
        const session = this.userSessions.get(socket.id);
        if (!session || parseInt(session.projectId) !== parseInt(projectId)) {
            return;
        }
        
        // Broadcast viewport (for viewport following features)
        socket.to(`project_${projectId}`).emit('viewport_update', {
            userId: session.userId,
            username: session.username,
            viewport: viewport
        });
    }
    
    handleDisconnect(socket) {
        const session = this.userSessions.get(socket.id);
        if (session) {
            const projectId = session.projectId;
            this.removeUserFromProject(socket, projectId, session);
            // Emit confirmation even on disconnect
            socket.emit('project_left', { projectId: parseInt(projectId) });
        }
        console.log(`👋 Client disconnected: ${socket.id}`);
    }
    
    async removeUserFromProject(socket, projectId, session) {
        try {
            // Remove from room
            const room = this.projectRooms.get(projectId);
            if (room) {
                room.users.delete(socket.id);
                if (room.users.size === 0) {
                    this.projectRooms.delete(projectId);
                }
            }
            
            // Remove from database
            await this.db.run('DELETE FROM active_sessions WHERE id = ?', [session.sessionId]);
            
            // Remove from user sessions
            this.userSessions.delete(socket.id);
            
            // Leave socket room
            socket.leave(`project_${projectId}`);
            
            // Notify other users
            socket.to(`project_${projectId}`).emit('user_left', {
                userId: session.userId,
                username: session.username,
                sessionId: session.sessionId
            });
            
            console.log(`👤 User ${session.username} left project ${projectId}`);
            
        } catch (error) {
            console.error('Error removing user from project:', error);
        }
    }
    
    async transformOperation(operation, projectId, sequenceNumber) {
        // Basic operational transformation - can be enhanced for complex conflict resolution
        // For now, we'll implement a simple last-write-wins with timestamps
        
        const transformedOperation = {
            ...operation,
            sequenceNumber: sequenceNumber,
            timestamp: Date.now()
        };
        
        // TODO: Implement more sophisticated OT algorithms for specific operation types
        // For example, transforming conflicting move operations, resize operations, etc.
        
        return transformedOperation;
    }
    
    async getActiveUsers(projectId) {
        const sessions = await this.db.all(
            `SELECT s.*, u.username, u.display_name 
             FROM active_sessions s 
             JOIN users u ON s.user_id = u.id 
             WHERE s.project_id = ?`,
            [projectId]
        );
        
        return sessions.map(session => ({
            userId: session.user_id,
            username: session.username,
            displayName: session.display_name || session.username,
            sessionId: session.id,
            cursorPosition: session.cursor_position ? JSON.parse(session.cursor_position) : null,
            selection: session.selection_data ? JSON.parse(session.selection_data) : null,
            lastActivity: session.last_activity
        }));
    }
    
    async getProjectOperations(projectId, since = 0) {
        return await this.db.getOperationsSince(projectId, since);
    }


    
    startCleanupInterval() {
        // Clean up inactive sessions every 2 minutes
        setInterval(async () => {
            try {
                // Remove sessions older than 1 hour
                await this.db.run(
                    "DELETE FROM active_sessions WHERE last_activity < datetime('now', '-1 hour')"
                );
                
                // Remove database sessions that don't have active socket connections
                const dbSessions = await this.db.all('SELECT id, socket_id FROM active_sessions');
                for (const dbSession of dbSessions) {
                    if (!this.userSessions.has(dbSession.socket_id)) {
                        await this.db.run('DELETE FROM active_sessions WHERE id = ?', [dbSession.id]);
                        console.log(`🧹 Cleaned up stale session: ${dbSession.socket_id}`);
                    }
                }
            } catch (error) {
                console.error('Error during session cleanup:', error);
            }
        }, 2 * 60 * 1000); // Every 2 minutes instead of 5
    }
    
    // Utility method to broadcast to a project
    broadcastToProject(projectId, event, data) {
        this.io.to(`project_${projectId}`).emit(event, data);
    }
    
    // Get project statistics
    getProjectStats(projectId) {
        const room = this.projectRooms.get(projectId);
        return {
            activeUsers: room ? room.users.size : 0,
            sequenceNumber: room ? room.sequenceNumber : 0
        };
    }
    
    // ===================================
    // PERIODIC SYNC AND HEALTH MONITORING
    // ===================================
    
    async handleSyncCheck(socket, { projectId, sequenceNumber, stateHash, timestamp }) {
        console.log('🔍 Sync check received:', { projectId, sequenceNumber, stateHash, timestamp });
        
        const session = this.userSessions.get(socket.id);
        console.log('🔍 Session found:', !!session, session ? { projectId: session.projectId, userId: session.userId } : 'none');
        
        if (!session || parseInt(session.projectId) !== parseInt(projectId)) {
            console.log('❌ Sync check authentication failed:', { 
                hasSession: !!session, 
                sessionProjectId: session?.projectId, 
                requestProjectId: projectId,
                comparison: session ? `${parseInt(session.projectId)} !== ${parseInt(projectId)}` : 'no session'
            });
            socket.emit('error', { message: 'Not authenticated for this project' });
            return;
        }
        
        try {
            console.log('🔍 Processing sync check for project:', projectId);
            
            // Get latest sequence number for this project
            const latestOp = await this.db.get(
                'SELECT MAX(sequence_number) as latest FROM operations WHERE project_id = ?',
                [typeof projectId === 'string' ? parseInt(projectId) : projectId]
            );
            const latestSequence = latestOp?.latest || 0;
            
            // Get room sequence number as well
            const room = this.projectRooms.get(typeof projectId === 'string' ? parseInt(projectId) : projectId);
            const roomSequence = room?.sequenceNumber || 0;
            
            console.log('🔍 Project:', projectId, 'DB sequence:', latestSequence, 'Room sequence:', roomSequence, 'Client sequence:', sequenceNumber);
            
            // Check if client is behind
            const needsSync = sequenceNumber < latestSequence;
            let missedOperations = [];
            
            if (needsSync) {
                // Get missed operations if any
                missedOperations = await this.db.all(
                    `SELECT operation_type, operation_data, sequence_number, user_id, applied_at 
                     FROM operations 
                     WHERE project_id = ? AND sequence_number > ? 
                     ORDER BY sequence_number ASC`,
                    [typeof projectId === 'string' ? parseInt(projectId) : projectId, sequenceNumber]
                );
                
                missedOperations = missedOperations.map(op => ({
                    operation: {
                        type: op.operation_type,
                        data: JSON.parse(op.operation_data)
                    },
                    sequenceNumber: op.sequence_number,
                    userId: op.user_id,
                    timestamp: op.applied_at
                }));
                
                console.log('🔍 Found missed operations:', missedOperations.length);
            }
            
            // Calculate server state hash (simplified version)
            const serverStateHash = await this.calculateServerStateHash(typeof projectId === 'string' ? parseInt(projectId) : projectId);
            
            console.log('🔍 Sending sync response:', { needsSync, latestSequence, serverStateHash });
            
            socket.emit('sync_response', {
                projectId: typeof projectId === 'string' ? parseInt(projectId) : projectId,  // Include projectId in response
                needsSync,
                missedOperations,
                latestSequence,
                serverStateHash,
                clientStateHash: stateHash,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error('❌ Error handling sync check:', error);
            socket.emit('error', { message: 'Sync check failed' });
        }
    }
    
    async calculateServerStateHash(projectId) {
        // This is a simplified version - in production you'd want to calculate
        // a proper hash of the current project state
        const latestOp = await this.db.get(
            'SELECT sequence_number, applied_at FROM operations WHERE project_id = ? ORDER BY sequence_number DESC LIMIT 1',
            [typeof projectId === 'string' ? parseInt(projectId) : projectId]
        );
        
        return latestOp ? `${latestOp.sequence_number}_${latestOp.applied_at}` : '0_0';
    }
    
    async handleHeartbeat(socket, { timestamp, projectId }) {
        const session = this.userSessions.get(socket.id);
        if (!session) {
            return; // Silently ignore heartbeats from invalid sessions
        }
        
        try {
            // Update last activity in database
            await this.db.run(
                'UPDATE active_sessions SET last_activity = CURRENT_TIMESTAMP WHERE socket_id = ?',
                [socket.id]
            );
            
            // Respond with heartbeat acknowledgment
            socket.emit('heartbeat_response', {
                timestamp: Date.now(),
                serverTime: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Error handling heartbeat:', error);
        }
    }
}

module.exports = { CollaborationManager, OperationTypes }; 