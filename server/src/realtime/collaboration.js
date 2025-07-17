const { v4: uuidv4 } = require('uuid');

// Operation types for real-time synchronization
const OperationTypes = {
    NODE_CREATE: 'node_create',
    NODE_UPDATE: 'node_update',
    NODE_DELETE: 'node_delete',
    NODE_MOVE: 'node_move',
    NODE_RESIZE: 'node_resize',
    NODE_ROTATE: 'node_rotate',
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
            
            // Verify project exists and user has access
            const project = await this.db.getProject(projectId);
            if (!project) {
                socket.emit('error', { message: 'Project not found' });
                return;
            }
            
            // Create session
            const sessionId = uuidv4();
            const session = {
                userId: user.id,
                projectId: parseInt(projectId),
                sessionId: sessionId,
                username: user.username,
                displayName: user.display_name || user.username,
                joinedAt: Date.now()
            };
            
            this.userSessions.set(socket.id, session);
            
            // Join socket room
            socket.join(`project_${projectId}`);
            
            // Initialize or update project room
            if (!this.projectRooms.has(projectId)) {
                this.projectRooms.set(projectId, {
                    users: new Set(),
                    sequenceNumber: 0
                });
            }
            
            const room = this.projectRooms.get(projectId);
            room.users.add(socket.id);
            
            // Store session in database
            await this.db.run(
                'INSERT OR REPLACE INTO active_sessions (id, user_id, project_id, socket_id, last_activity) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
                [sessionId, user.id, projectId, socket.id]
            );
            
            // Send project data to joining user
            socket.emit('project_joined', {
                project: project,
                session: session,
                sequenceNumber: room.sequenceNumber
            });
            
            // Notify other users
            socket.to(`project_${projectId}`).emit('user_joined', {
                userId: user.id,
                username: user.username,
                displayName: user.display_name || user.username,
                sessionId: sessionId
            });
            
            // Send current user list
            const activeUsers = await this.getActiveUsers(projectId);
            socket.emit('active_users', activeUsers);
            
            console.log(`👤 User ${username} joined project ${projectId}`);
            
        } catch (error) {
            console.error('Error joining project:', error);
            socket.emit('error', { message: 'Failed to join project' });
        }
    }
    
    async handleLeaveProject(socket, { projectId }) {
        const session = this.userSessions.get(socket.id);
        if (!session || session.projectId !== parseInt(projectId)) {
            return;
        }
        
        await this.removeUserFromProject(socket, projectId, session);
    }
    
    async handleCanvasOperation(socket, { projectId, operation }) {
        const session = this.userSessions.get(socket.id);
        if (!session || session.projectId !== parseInt(projectId)) {
            socket.emit('error', { message: 'Not authenticated for this project' });
            return;
        }
        
        try {
            const room = this.projectRooms.get(projectId);
            if (!room) {
                socket.emit('error', { message: 'Project room not found' });
                return;
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
        if (!session || session.projectId !== parseInt(projectId)) {
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
        if (!session || session.projectId !== parseInt(projectId)) {
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
        if (!session || session.projectId !== parseInt(projectId)) {
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
            this.removeUserFromProject(socket, session.projectId, session);
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
        // Clean up inactive sessions every 5 minutes
        setInterval(async () => {
            try {
                await this.db.run(
                    "DELETE FROM active_sessions WHERE last_activity < datetime('now', '-1 hour')"
                );
            } catch (error) {
                console.error('Error during session cleanup:', error);
            }
        }, 5 * 60 * 1000);
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
}

module.exports = { CollaborationManager, OperationTypes }; 