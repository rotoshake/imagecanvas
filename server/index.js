const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs').promises;
const crypto = require('crypto');

// Configure Sharp for better concurrent processing
// Limit concurrency to prevent memory issues
sharp.concurrency(4); // Process max 4 images at once
sharp.cache({ memory: 50, files: 20 }); // Limit cache to 50MB memory, 20 files

// Create placeholder modules if they don't exist yet
let Database, CollaborationManager;

try {
    Database = require('./src/database/database');
} catch (error) {
    
    Database = class {
        async init() { console.log('📊 Placeholder database initialized'); }
        async close() { console.log('📊 Placeholder database closed'); }
    };
}

try {
    CollaborationManager = require('./src/realtime/collaboration');
} catch (error) {
    
    CollaborationManager = class {
        constructor(io, db) {
            
        }
    };
}

class ImageCanvasServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, {
            cors: {
                origin: [
                    "http://localhost:8000",
                    "http://127.0.0.1:8000",
                    "http://localhost:8080",
                    "http://127.0.0.1:8080",
                    "http://localhost:5173",
                    "http://127.0.0.1:5173",
                    "http://localhost:5174",
                    "http://127.0.0.1:5174"
                ],
                methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
                credentials: true
            },
            // Allow multiple connections from same origin
            allowEIO3: true,
            // Increase ping timeout to prevent premature disconnections during bulk operations
            pingTimeout: 300000, // 5 minutes for very large operations
            pingInterval: 30000,
            // Allow WebSocket and polling transports
            transports: ['websocket', 'polling'],
            // Increase maximum HTTP buffer size for large operations (50MB for high-res images)
            maxHttpBufferSize: 5e7,
            // Enable compression for large payloads
            perMessageDeflate: {
                threshold: 1024 // Compress messages larger than 1KB
            }
        });
        
        this.port = process.env.PORT || 3000;
        this.db = null;
        this.collaborationManager = null;
        
        this.setupMiddleware();
        this.setupUpload();
        this.setupRoutes();
    }
    
    setupMiddleware() {
        // Security
        this.app.use(helmet({
            contentSecurityPolicy: false // Allow inline scripts for development
        }));
        
        // Compression and CORS
        this.app.use(compression());
        this.app.use(cors({
            origin: [
                "http://localhost:8000",
                "http://127.0.0.1:8000",
                "http://localhost:8080",
                "http://127.0.0.1:8080",
                "http://localhost:5173",
                "http://127.0.0.1:5173"
            ],
            credentials: true,
            methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization"]
        }));
        
        // Body parsing
        this.app.use(express.json({ limit: '50mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));
        
        // Static files
        this.app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
        this.app.use('/projects', express.static(path.join(__dirname, 'projects')));
        
        // Request logging
        this.app.use((req, res, next) => {
            console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
            next();
        });
    }
    
    setupRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({ 
                status: 'ok', 
                timestamp: Date.now(),
                version: '2.0.0-alpha',
                features: ['collaboration', 'file-upload', 'thumbnails']
            });
        });

        // WebSocket test page
        this.app.get('/test-websocket', (req, res) => {
            res.send(`
                <!DOCTYPE html>
                <html>
                <head><title>WebSocket Test</title></head>
                <body>
                    <h1>ImageCanvas WebSocket Test</h1>
                    <div id="status">Connecting...</div>
                    <script src="/socket.io/socket.io.js"></script>
                    <script>
                        const socket = io();
                        const status = document.getElementById('status');
                        
                        socket.on('connect', () => {
                            status.textContent = 'Connected! Socket ID: ' + socket.id;
                            status.style.color = 'green';
                        });
                        
                        socket.on('disconnect', () => {
                            status.textContent = 'Disconnected';
                            status.style.color = 'red';
                        });
                    </script>
                </body>
                </html>
            `);
        });

        // API upload endpoint for new HTTP upload system
        this.app.post('/api/upload', this.uploadMiddleware, async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({ error: 'No file uploaded' });
                }

                const hash = req.body.hash || crypto.createHash('sha256').update(await fs.readFile(req.file.path)).digest('hex');
                
                // Insert file record into database for tracking
                const projectId = req.body.projectId || null;
                const userId = req.body.userId || 1; // Default to user 1 if not provided
                
                await this.db.run(
                    `INSERT INTO files (filename, original_name, mime_type, file_size, file_hash, uploaded_by, project_id) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [req.file.filename, req.file.originalname, req.file.mimetype, 
                     req.file.size, hash, userId, projectId]
                );
                
                try {
                    // Generate thumbnails for images
                    if (req.file.mimetype.startsWith('image/')) {
                        await this.generateThumbnails(req.file.path, req.file.filename);
                    }

                    // Return the URL for the uploaded file
                    res.json({
                        success: true,
                        url: `/uploads/${req.file.filename}`,
                        hash: hash,
                        filename: req.file.originalname,  // Original filename from user
                        serverFilename: req.file.filename, // Actual filename on server
                        size: req.file.size
                    });

                } catch (thumbnailError) {
                    // If thumbnail generation fails, clean up the uploaded file
                    console.error('Thumbnail generation failed, cleaning up:', thumbnailError);
                    try {
                        await fs.unlink(req.file.path);
                        
                    } catch (unlinkError) {
                        console.error('Failed to clean up file:', unlinkError);
                    }
                    throw thumbnailError; // Re-throw to be caught by outer catch
                }
            } catch (error) {
                console.error('Upload error:', error);
                
                // Try to clean up the uploaded file if it exists
                if (req.file && req.file.path) {
                    try {
                        await fs.unlink(req.file.path);
                        
                    } catch (unlinkError) {
                        console.error('Failed to clean up file:', unlinkError);
                    }
                }
                
                res.status(500).json({ error: 'Upload failed', details: error.message });
            }
        });

        // File upload endpoint (legacy)
        this.app.post('/upload', this.uploadMiddleware, async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({ error: 'No file uploaded' });
                }

                const { projectId, nodeData } = req.body;
                const parsedNodeData = JSON.parse(nodeData);
                
                // Generate file hash
                const fileBuffer = await fs.readFile(req.file.path);
                const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
                
                // Store file info in database
                const fileInfo = {
                    filename: req.file.filename,
                    original_name: req.file.originalname,
                    mime_type: req.file.mimetype,
                    file_size: req.file.size,
                    file_hash: fileHash,
                    project_id: parseInt(projectId)
                };

                // Insert file record into database for tracking
                const userId = parsedNodeData.uploaderUserId || 1; // Default to user 1 if not provided
                await this.db.run(
                    `INSERT INTO files (filename, original_name, mime_type, file_size, file_hash, uploaded_by, project_id) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [fileInfo.filename, fileInfo.original_name, fileInfo.mime_type, 
                     fileInfo.file_size, fileInfo.file_hash, userId, fileInfo.project_id]
                );

                try {
                    // Generate thumbnails for images
                    if (req.file.mimetype.startsWith('image/')) {
                        await this.generateThumbnails(req.file.path, req.file.filename);
                    }
                } catch (thumbnailError) {
                    // If thumbnail generation fails, clean up the uploaded file
                    console.error('Thumbnail generation failed, cleaning up:', thumbnailError);
                    try {
                        await fs.unlink(req.file.path);
                        
                    } catch (unlinkError) {
                        console.error('Failed to clean up file:', unlinkError);
                    }
                    throw thumbnailError; // Re-throw to be caught by outer catch
                }

                // Broadcast to other users in the project (excluding uploader)
                
                // Get uploader's socket ID if available
                let uploaderSocketId = parsedNodeData.uploaderSocketId || null;
                
                // If not provided, try to find it from user ID
                if (!uploaderSocketId && this.collaborationManager && parsedNodeData.uploaderUserId) {
                    try {
                        // Find the socket for this user
                        for (const [socketId, session] of this.collaborationManager.socketSessions) {
                            if (session.userId === parsedNodeData.uploaderUserId && session.projectId === parseInt(projectId)) {
                                uploaderSocketId = socketId;
                                break;
                            }
                        }
                    } catch (e) {
                        
                    }
                }
                
                if (uploaderSocketId) {
                    // Broadcast to everyone in the room EXCEPT the uploader
                    this.io.to(`project_${projectId}`).except(uploaderSocketId).emit('media_uploaded', {
                        fileInfo,
                        nodeData: parsedNodeData,
                        mediaUrl: `/uploads/${req.file.filename}`,
                        fromSocketId: uploaderSocketId
                    });
                    console.log(`✅ Media upload broadcast sent to project_${projectId} (excluding uploader ${uploaderSocketId})`);
                } else {
                    // Fallback: broadcast to everyone (shouldn't happen in normal usage)
                    this.io.to(`project_${projectId}`).emit('media_uploaded', {
                        fileInfo,
                        nodeData: parsedNodeData,
                        mediaUrl: `/uploads/${req.file.filename}`,
                        fromSocketId: null
                    });
                    console.log(`✅ Media upload broadcast sent to project_${projectId} (uploader socket not found)`);
                }

                res.json({ 
                    success: true, 
                    fileInfo,
                    mediaUrl: `/uploads/${req.file.filename}`,
                    serverFilename: req.file.filename, // Add server filename for clarity
                    filename: req.file.originalname
                });

            } catch (error) {
                console.error('Upload error:', error);
                
                // Try to clean up the uploaded file if it exists
                if (req.file && req.file.path) {
                    try {
                        await fs.unlink(req.file.path);
                        
                    } catch (unlinkError) {
                        console.error('Failed to clean up file:', unlinkError);
                    }
                }
                
                res.status(500).json({ error: 'Upload failed' });
            }
        });

        // Serve uploaded files with proper CORS headers
        this.app.get('/uploads/:filename', (req, res) => {
            const filename = req.params.filename;
            const filepath = path.join(__dirname, 'uploads', filename);
            
            // Set CORS headers for images
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET');
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            
            res.sendFile(filepath);
        });

        // Serve thumbnails with proper CORS headers
        this.app.get('/thumbnails/:size/:filename', (req, res) => {
            const { size, filename } = req.params;
            const thumbnailPath = path.join(__dirname, 'thumbnails', size, filename);
            
            // Set CORS headers for images
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET');
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            
            res.sendFile(thumbnailPath);
        });

        // Project endpoints
        this.app.get('/projects', async (req, res) => {
            try {
                const projects = await this.db.all('SELECT * FROM projects ORDER BY last_modified DESC');
                res.json(projects);
            } catch (error) {
                console.error('Failed to fetch projects:', error);
                res.status(500).json({ error: 'Failed to fetch projects' });
            }
        });

        this.app.post('/projects', async (req, res) => {
            try {
                const { name, description, ownerId } = req.body;
                
                // Validate input
                if (!name || !ownerId) {
                    return res.status(400).json({ error: 'Name and ownerId are required' });
                }
                
                // Check if database is initialized
                if (!this.db) {
                    console.error('❌ Database not initialized');
                    return res.status(500).json({ error: 'Database not initialized' });
                }
                
                // Get or create user by username
                let user = await this.db.getUserByUsername(ownerId);
                if (!user) {
                    
                    const userId = await this.db.createUser(ownerId, ownerId);
                    user = await this.db.getUserById(userId);
                }
                
                const projectId = await this.db.createProject(name, user.id, description);
                
                const project = await this.db.getProject(projectId);
                
                res.json(project);
            } catch (error) {
                console.error('❌ Failed to create project:', error);
                console.error('Stack trace:', error.stack);
                res.status(500).json({ 
                    error: 'Failed to create project',
                    details: error.message 
                });
            }
        });
        
        // Canvas save/load endpoints
        this.app.get('/projects/:id/canvas', async (req, res) => {
            try {
                const projectId = parseInt(req.params.id);
                const project = await this.db.get(
                    'SELECT canvas_data FROM projects WHERE id = ?',
                    [projectId]
                );
                
                if (!project) {
                    return res.status(404).json({ error: 'Project not found' });
                }
                
                const canvasData = project.canvas_data ? JSON.parse(project.canvas_data) : null;
                
                res.json({ 
                    success: true,
                    canvas_data: canvasData,
                    navigation_state: canvasData?.navigation_state || null
                });
            } catch (error) {
                console.error('Failed to load canvas:', error);
                res.status(500).json({ error: 'Failed to load canvas' });
            }
        });
        
        this.app.put('/projects/:id/canvas', async (req, res) => {
            try {
                const projectId = parseInt(req.params.id);
                const canvasData = req.body.canvas_data;
                
                if (!canvasData) {
                    return res.status(400).json({ error: 'Canvas data required' });
                }
                
                await this.db.run(
                    'UPDATE projects SET canvas_data = ?, last_modified = CURRENT_TIMESTAMP WHERE id = ?',
                    [JSON.stringify(canvasData), projectId]
                );
                
                // Broadcast canvas update to other users in the project
                this.io.to(`project_${projectId}`).emit('canvas_saved', {
                    projectId,
                    savedBy: req.body.userId || 'unknown',
                    timestamp: new Date().toISOString()
                });
                
                res.json({ success: true });
            } catch (error) {
                console.error('Failed to save canvas:', error);
                res.status(500).json({ error: 'Failed to save canvas' });
            }
        });
        
        // PATCH endpoint for navigation state updates
        this.app.patch('/projects/:id/canvas', async (req, res) => {
            try {
                const projectId = parseInt(req.params.id);
                const { navigation_state } = req.body;
                
                if (!navigation_state) {
                    return res.status(400).json({ error: 'Navigation state required' });
                }
                
                // Validate navigation state structure
                if (!this.isValidNavigationState(navigation_state)) {
                    return res.status(400).json({ error: 'Invalid navigation state format' });
                }
                
                // Get current canvas data
                const project = await this.db.get(
                    'SELECT canvas_data FROM projects WHERE id = ?',
                    [projectId]
                );
                
                if (!project) {
                    return res.status(404).json({ error: 'Project not found' });
                }
                
                // Parse existing canvas data or create new structure
                let canvasData = {};
                try {
                    if (project.canvas_data) {
                        canvasData = JSON.parse(project.canvas_data);
                    }
                } catch (error) {
                    console.error('Failed to parse canvas_data:', error);
                    canvasData = {};
                }
                
                // Ensure canvasData is an object
                if (!canvasData || typeof canvasData !== 'object') {
                    canvasData = {};
                }
                
                // Update navigation state
                canvasData.navigation_state = navigation_state;
                
                // Save back to database
                await this.db.run(
                    'UPDATE projects SET canvas_data = ?, last_modified = CURRENT_TIMESTAMP WHERE id = ?',
                    [JSON.stringify(canvasData), projectId]
                );
                
                res.json({ 
                    success: true,
                    message: 'Navigation state updated'
                });
                
            } catch (error) {
                console.error('Failed to update navigation state:', error);
                res.status(500).json({ error: 'Failed to update navigation state' });
            }
        });
        
        // Get single project
        this.app.get('/projects/:id', async (req, res) => {
            try {
                const projectId = parseInt(req.params.id);
                const project = await this.db.get(
                    'SELECT * FROM projects WHERE id = ?',
                    [projectId]
                );
                
                if (!project) {
                    return res.status(404).json({ error: 'Project not found' });
                }
                
                res.json(project);
            } catch (error) {
                console.error('Failed to get project:', error);
                res.status(500).json({ error: 'Failed to get project' });
            }
        });
        
        // Update project (rename)
        this.app.put('/projects/:id', async (req, res) => {
            try {
                const projectId = parseInt(req.params.id);
                const { name } = req.body;
                
                if (!name || !name.trim()) {
                    return res.status(400).json({ error: 'Name is required' });
                }
                
                await this.db.run(
                    'UPDATE projects SET name = ?, last_modified = CURRENT_TIMESTAMP WHERE id = ?',
                    [name.trim(), projectId]
                );
                
                const updatedProject = await this.db.get(
                    'SELECT * FROM projects WHERE id = ?',
                    [projectId]
                );
                
                if (!updatedProject) {
                    return res.status(404).json({ error: 'Project not found' });
                }
                
                // Broadcast rename to other users in the project
                this.io.to(`project_${projectId}`).emit('project_renamed', {
                    projectId,
                    newName: name.trim(),
                    timestamp: new Date().toISOString()
                });
                
                res.json(updatedProject);
            } catch (error) {
                console.error('Failed to update project:', error);
                res.status(500).json({ error: 'Failed to update project' });
            }
        });
        
        // Get user's projects
        this.app.get('/projects/user/:userId', async (req, res) => {
            try {
                const userId = parseInt(req.params.userId);
                const projects = await this.db.all(
                    `SELECT p.*, 
                            (SELECT COUNT(*) FROM project_collaborators WHERE project_id = p.id) as collaborator_count
                     FROM projects p 
                     WHERE p.owner_id = ? 
                        OR EXISTS (SELECT 1 FROM project_collaborators pc WHERE pc.project_id = p.id AND pc.user_id = ?)
                     ORDER BY p.last_modified DESC`,
                    [userId, userId]
                );
                res.json(projects);
            } catch (error) {
                console.error('Failed to fetch user projects:', error);
                res.status(500).json({ error: 'Failed to fetch projects' });
            }
        });
        
        // Delete project
        this.app.delete('/projects/:id', async (req, res) => {
            try {
                const projectId = parseInt(req.params.id);
                
                // Delete all related data in the correct order to avoid foreign key violations
                await this.db.run('DELETE FROM active_sessions WHERE project_id = ?', [projectId]);
                await this.db.run('DELETE FROM canvases WHERE project_id = ?', [projectId]);
                await this.db.run('DELETE FROM files WHERE project_id = ?', [projectId]);
                await this.db.run('DELETE FROM operations WHERE project_id = ?', [projectId]);
                await this.db.run('DELETE FROM project_versions WHERE project_id = ?', [projectId]);
                await this.db.run('DELETE FROM project_collaborators WHERE project_id = ?', [projectId]);
                await this.db.run('DELETE FROM projects WHERE id = ?', [projectId]);
                
                // Notify connected users
                this.io.to(`project_${projectId}`).emit('project_deleted', { projectId });
                
                res.json({ success: true });
            } catch (error) {
                console.error('Failed to delete project:', error);
                res.status(500).json({ error: 'Failed to delete project' });
            }
        });
        
        // Database maintenance endpoints
        this.app.get('/database/size', async (req, res) => {
            try {
                const stats = await fs.stat(this.db.dbPath);
                const sizeInBytes = stats.size;
                
                // Also check for WAL and SHM files (SQLite Write-Ahead Logging)
                let databaseSize = sizeInBytes;
                try {
                    const walStats = await fs.stat(this.db.dbPath + '-wal');
                    databaseSize += walStats.size;
                } catch (e) {
                    // WAL file might not exist
                }
                try {
                    const shmStats = await fs.stat(this.db.dbPath + '-shm');
                    databaseSize += shmStats.size;
                } catch (e) {
                    // SHM file might not exist
                }
                
                // Calculate uploads folder size
                let uploadsSize = 0;
                const uploadsDir = path.join(__dirname, 'uploads');
                try {
                    const files = await fs.readdir(uploadsDir);
                    for (const file of files) {
                        try {
                            const filePath = path.join(uploadsDir, file);
                            const fileStat = await fs.stat(filePath);
                            if (fileStat.isFile()) {
                                uploadsSize += fileStat.size;
                            }
                        } catch (e) {
                            // Skip files we can't access
                        }
                    }
                } catch (e) {
                    console.error('Error calculating uploads folder size:', e);
                }
                
                // Calculate thumbnails folder size
                let thumbnailsSize = 0;
                const thumbnailsDir = path.join(__dirname, 'thumbnails');
                try {
                    const sizes = ['64', '128', '256', '512', '1024', '2048'];
                    for (const size of sizes) {
                        const sizeDir = path.join(thumbnailsDir, size);
                        try {
                            const files = await fs.readdir(sizeDir);
                            for (const file of files) {
                                try {
                                    const filePath = path.join(sizeDir, file);
                                    const fileStat = await fs.stat(filePath);
                                    if (fileStat.isFile()) {
                                        thumbnailsSize += fileStat.size;
                                    }
                                } catch (e) {
                                    // Skip files we can't access
                                }
                            }
                        } catch (e) {
                            // Size directory might not exist
                        }
                    }
                } catch (e) {
                    console.error('Error calculating thumbnails folder size:', e);
                }
                
                const totalSize = databaseSize + uploadsSize + thumbnailsSize;
                
                res.json({ 
                    success: true,
                    sizeInBytes: totalSize,
                    sizeFormatted: this.formatBytes(totalSize),
                    breakdown: {
                        database: {
                            bytes: databaseSize,
                            formatted: this.formatBytes(databaseSize)
                        },
                        uploads: {
                            bytes: uploadsSize,
                            formatted: this.formatBytes(uploadsSize)
                        },
                        thumbnails: {
                            bytes: thumbnailsSize,
                            formatted: this.formatBytes(thumbnailsSize)
                        }
                    }
                });
            } catch (error) {
                console.error('Failed to get database size:', error);
                res.status(500).json({ error: 'Failed to get database size' });
            }
        });
        
        // OLD CLEANUP ENDPOINT - Replaced with mark-and-sweep approach
        /*
        this.app.post('/database/cleanup', async (req, res) => {
            try {
                
                // Check if database is initialized
                if (!this.db || !this.db.dbPath) {
                    console.error('❌ Database not initialized');
                    return res.status(500).json({ error: 'Database not initialized' });
                }
                
                // TEMPORARY: Skip all file deletion until we implement proper mark-and-sweep

                // Clean up old operations only (safe)
                let operationsDeleted = 0;
                try {
                    const result = await this.db.run(`
                        DELETE FROM operations 
                        WHERE operation_data LIKE '%data:image%'
                        AND timestamp < ?
                    `, [Date.now() - 24 * 60 * 60 * 1000]); // Older than 1 day
                    
                    operationsDeleted = result.changes || 0;
                    
                } catch (error) {
                    
                }
                
                // Return simple success response
                return res.json({
                    success: true,
                    message: 'Cleanup completed (file deletion temporarily disabled)',
                    deleted: {
                        files: 0,
                        orphanedDiskFiles: 0,
                        operations: operationsDeleted,
                        users: 0
                    }
                });
                
                // Skip all the old complex cleanup code below
                return;
                
                // SAFETY: Check for query parameter to force unsafe cleanup (for testing)
                const forceUnsafe = req.query.force === 'true';
                if (forceUnsafe) {
                    
                }
                
                // CRITICAL: Check for active collaborative sessions
                let activeSessionCount = 0;
                if (this.collaborationManager && this.collaborationManager.io) {
                    const rooms = this.collaborationManager.io.sockets.adapter.rooms;
                    for (const [roomName, room] of rooms.entries()) {
                        if (roomName.startsWith('project_') && room.size > 0) {
                            activeSessionCount++;
                        }
                    }
                }
                
                if (activeSessionCount > 0) {
                    
                } else {
                    
                }
                
                // Get initial size
                let initialSize = 0;
                try {
                    const initialStats = await fs.stat(this.db.dbPath);
                    initialSize = initialStats.size;
                    try {
                        const walStats = await fs.stat(this.db.dbPath + '-wal');
                        initialSize += walStats.size;
                    } catch (e) {}
                    try {
                        const shmStats = await fs.stat(this.db.dbPath + '-shm');
                        initialSize += shmStats.size;
                    } catch (e) {}
                    console.log(`📊 Initial database size: ${this.formatBytes(initialSize)}`);
                } catch (error) {
                    console.error('❌ Failed to get initial database size:', error);
                    // Continue anyway
                }
                
                // 1. Find orphaned files (files not referenced by any node)
                // First get all files
                let allFiles = [];
                try {
                    allFiles = await this.db.all('SELECT * FROM files');
                    
                } catch (error) {
                    console.error('❌ Failed to get files from database:', error);
                    return res.status(500).json({ 
                        error: 'Failed to read files table',
                        details: error.message 
                    });
                }
                
                // Get all projects with canvas data
                let projects = [];
                try {
                    projects = await this.db.all(`
                        SELECT id, canvas_data FROM projects 
                        WHERE canvas_data IS NOT NULL
                    `);
                } catch (error) {
                    console.error('❌ Failed to get projects from database:', error);
                    return res.status(500).json({ 
                        error: 'Failed to read projects table',
                        details: error.message 
                    });
                }
                
                // CRITICAL: Also include files from currently active collaborative sessions
                // Get all active project states from WebSocket manager
                const activeProjects = new Set();
                const activeFiles = new Set(); // Track files from active sessions separately
                
                // Method 1: Check CanvasStateManager
                if (this.canvasStateManager && this.canvasStateManager.projectStates) {

                    for (const [projectId, state] of this.canvasStateManager.projectStates.entries()) {
                        activeProjects.add(parseInt(projectId));
                        // Add the active state as if it were a saved project
                        if (state && state.nodes) {
                            
                            projects.push({
                                id: projectId,
                                canvas_data: JSON.stringify({ nodes: state.nodes }),
                                isActive: true
                            });
                        }
                    }
                } else {
                    
                }
                
                // Method 2: Check collaboration rooms directly
                if (this.collaborationManager && this.collaborationManager.io) {
                    
                    const rooms = this.collaborationManager.io.sockets.adapter.rooms;
                    for (const [roomName, room] of rooms.entries()) {
                        if (roomName.startsWith('project_') && room.size > 0) {
                            const projectId = parseInt(roomName.replace('project_', ''));
                            activeProjects.add(projectId);
                            
                        }
                    }
                }
                
                // Method 3: Check VERY recent operations (last 5 minutes only)
                // This catches files that are actively being worked on RIGHT NOW
                let recentOps = [];
                try {
                    const recentOpsTime = Date.now() - (5 * 60 * 1000); // 5 minutes
                    recentOps = await this.db.all(`
                        SELECT operation_data FROM operations 
                        WHERE timestamp > ? 
                        AND (operation_data LIKE '%serverUrl%' OR operation_data LIKE '%uploadImage%')
                        ORDER BY timestamp DESC
                        LIMIT 100
                    `, [recentOpsTime]);
                } catch (error) {
                    console.error('❌ Failed to get recent operations:', error);
                    // Continue without recent ops - not critical
                }
                
                if (recentOps.length > 0) {
                    console.log(`🕐 Found ${recentOps.length} very recent operations (last 5 min) to check`);
                    
                    // Extract files from recent operations
                    for (const op of recentOps) {
                        try {
                            const data = JSON.parse(op.operation_data);
                            if (data.params) {
                                // Check for file references in operation params
                                const checkParams = (params) => {
                                    if (params.serverUrl && params.serverUrl.includes('/uploads/')) {
                                        const match = params.serverUrl.match(/\/uploads\/([^?]+)/);
                                        if (match) activeFiles.add(match[1]);
                                    }
                                    if (params.serverFilename) {
                                        activeFiles.add(params.serverFilename);
                                    }
                                    if (params.nodes && Array.isArray(params.nodes)) {
                                        for (const node of params.nodes) {
                                            if (node.properties) checkParams(node.properties);
                                        }
                                    }
                                };
                                checkParams(data.params);
                            }
                        } catch (e) {
                            // Ignore parse errors
                        }
                    }
                }
                
                console.log(`📋 Scanning ${projects.length} projects (${activeProjects.size} active) for used files...`);
                
                // Extract all media URLs from all projects
                const usedFilenames = new Set();
                const usedFilenamesLower = new Set(); // Case-insensitive matching
                
                // Helper function to add a filename in all variations
                const addUsedFilename = (filename) => {
                    if (!filename) return;
                    
                    // Add the exact filename
                    usedFilenames.add(filename);
                    usedFilenamesLower.add(filename.toLowerCase());
                    
                    // If it's a path, extract just the filename
                    const pathMatch = filename.match(/([^\/\\]+)$/);
                    if (pathMatch && pathMatch[1] !== filename) {
                        usedFilenames.add(pathMatch[1]);
                        usedFilenamesLower.add(pathMatch[1].toLowerCase());
                    }
                    
                    // Also try without query parameters
                    const withoutQuery = filename.split('?')[0];
                    if (withoutQuery !== filename) {
                        usedFilenames.add(withoutQuery);
                        usedFilenamesLower.add(withoutQuery.toLowerCase());
                        
                        const pathMatch2 = withoutQuery.match(/([^\/\\]+)$/);
                        if (pathMatch2) {
                            usedFilenames.add(pathMatch2[1]);
                            usedFilenamesLower.add(pathMatch2[1].toLowerCase());
                        }
                    }
                    
                    // Also add just the base filename without extension for safety
                    const baseName = path.parse(filename).name;
                    if (baseName && baseName !== filename) {
                        usedFilenames.add(baseName);
                        usedFilenamesLower.add(baseName.toLowerCase());
                    }
                };
                
                for (const project of projects) {
                    try {
                        const canvasData = JSON.parse(project.canvas_data);
                        const isActiveProject = project.isActive || (project.id && activeProjects.has(parseInt(project.id)));
                        if (canvasData && canvasData.nodes) {
                            for (const node of canvasData.nodes) {
                                // Debug: Log ALL image/video nodes to see what we're checking
                                if (node.type === 'media/image' || node.type === 'media/video') {
                                    const nodeInfo = {
                                        id: node.id,
                                        type: node.type,
                                        serverUrl: node.properties?.serverUrl,
                                        serverFilename: node.properties?.serverFilename,
                                        filename: node.properties?.filename,
                                        src: node.properties?.src,
                                        hash: node.properties?.hash?.substring(0, 8)
                                    };
                                    console.log(`📸 ${isActiveProject ? '[ACTIVE]' : '[SAVED]'} Project ${project.id}:`, JSON.stringify(nodeInfo));
                                }
                                
                                // Check multiple possible locations for file references
                                // 1. Direct serverFilename property (most common)
                                if (node.properties && node.properties.serverFilename) {
                                    addUsedFilename(node.properties.serverFilename);
                                }
                                
                                // 2. Check serverUrl property (MOST COMMON IN ACTIVE STATE)
                                if (node.properties && node.properties.serverUrl) {
                                    // Extract filename from full URL like "/uploads/filename.jpg"
                                    const urlMatch = node.properties.serverUrl.match(/\/uploads\/([^?]+)/);
                                    if (urlMatch) {
                                        addUsedFilename(urlMatch[1]);
                                    }
                                }
                                
                                // 3. Check src property for uploads
                                if (node.properties && node.properties.src) {
                                    const srcMatch = node.properties.src.match(/\/uploads\/([^?]+)/);
                                    if (srcMatch) {
                                        addUsedFilename(srcMatch[1]);
                                    }
                                }
                                
                                // 4. Legacy: Check data.mediaUrl (older format)
                                if (node.data && node.data.mediaUrl) {
                                    const match = node.data.mediaUrl.match(/\/uploads\/([^?]+)/);
                                    if (match) {
                                        addUsedFilename(match[1]);
                                    }
                                }
                                
                                // 5. Check filename property (might contain actual server filename)
                                if (node.properties && node.properties.filename) {
                                    addUsedFilename(node.properties.filename);
                                }
                                
                                // 6. Check for any property that might contain a filename pattern
                                if (node.properties) {
                                    for (const [key, value] of Object.entries(node.properties)) {
                                        if (typeof value === 'string' && value.includes('/uploads/')) {
                                            const match = value.match(/\/uploads\/(.+?)(?:\?|$)/);
                                            if (match) {
                                                addUsedFilename(match[1]);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Error parsing canvas data:', error);
                    }
                }
                
                // Add all active files from operations
                for (const filename of activeFiles) {
                    addUsedFilename(filename);
                }
                
                console.log(`✅ Found ${usedFilenames.size} files in use:
  - From canvas data: ${usedFilenames.size - activeFiles.size}
  - From active operations (last 5 min): ${activeFiles.size}`);
                
                // Debug: Log all used filenames
                
                if (usedFilenames.size <= 20) {
                    for (const filename of usedFilenames) {
                        
                    }
                } else {
                    console.log('  (too many to list)');
                }
                
                // Debug: Log all database filenames
                
                if (allFiles.length <= 20) {
                    for (const file of allFiles) {
                        console.log(`  - ${file.filename} (uploaded: ${new Date(file.upload_date).toISOString()})`);
                    }
                } else {
                    console.log('  (too many to list)');
                }
                
                // Find orphaned files - use case-insensitive comparison
                const orphanedFiles = allFiles.filter(file => !usedFilenamesLower.has(file.filename.toLowerCase()));
                
                // Safety check: Prevent mass deletion
                const deletionPercentage = allFiles.length > 0 ? (orphanedFiles.length / allFiles.length) * 100 : 0;
                if (allFiles.length > 0 && deletionPercentage > 50 && !forceUnsafe) {
                    console.warn(`⚠️ Cleanup would delete ${orphanedFiles.length} of ${allFiles.length} files (${deletionPercentage.toFixed(1)}%)`);
                    return res.status(400).json({ 
                        error: 'Safety check failed', 
                        message: `Cleanup would delete ${deletionPercentage.toFixed(1)}% of files. This seems excessive. Use ?force=true to override.`,
                        stats: {
                            totalFiles: allFiles.length,
                            orphanedFiles: orphanedFiles.length,
                            percentage: deletionPercentage
                        }
                    });
                }
                
                // Debug: Log orphaned files
                
                for (const file of orphanedFiles) {
                    
                }
                
                // 2. Delete orphaned file records and actual files
                let deletedFiles = 0;
                for (const file of orphanedFiles) {
                    try {
                        const filePath = path.join(__dirname, 'uploads', file.filename);
                        await fs.unlink(filePath);
                        await this.db.run('DELETE FROM files WHERE id = ?', [file.id]);
                        deletedFiles++;
                        
                        // Also delete thumbnails
                        const thumbnailSizes = [64, 128, 256, 512, 1024, 2048];
                        const nameWithoutExt = path.parse(file.filename).name;
                        for (const size of thumbnailSizes) {
                            try {
                                const thumbnailPath = path.join(__dirname, 'thumbnails', size.toString(), `${nameWithoutExt}.webp`);
                                await fs.unlink(thumbnailPath);
                            } catch (e) {
                                // Thumbnail might not exist
                            }
                        }
                    } catch (error) {
                        console.error(`Failed to delete file ${file.filename}:`, error);
                    }
                }
                
                // 2b. IMPORTANT: Also delete files in uploads folder that aren't in database
                const uploadsDir = path.join(__dirname, 'uploads');
                let orphanedDiskFiles = 0;
                try {
                    const diskFiles = await fs.readdir(uploadsDir);
                    const dbFilenames = new Set(allFiles.map(f => f.filename));

                    for (const diskFile of diskFiles) {
                        // Skip non-file entries (directories, etc)
                        const filePath = path.join(uploadsDir, diskFile);
                        const stat = await fs.stat(filePath);
                        if (!stat.isFile()) continue;
                        
                        // IMPORTANT: File must NOT be used in any canvas (regardless of database status)
                        const inDatabase = dbFilenames.has(diskFile);
                        const isUsed = usedFilenames.has(diskFile) || usedFilenamesLower.has(diskFile.toLowerCase());
                        
                        // Additional safety: Check if the filename appears anywhere in our used set
                        // This catches cases where the stored name might have extra path info
                        let isUsedAnywhere = isUsed;
                        if (!isUsedAnywhere) {
                            // Check if this file appears in any variation
                            for (const usedFile of usedFilenames) {
                                if (usedFile.includes(diskFile) || diskFile.includes(usedFile)) {
                                    isUsedAnywhere = true;
                                    
                                    break;
                                }
                            }
                        }
                        
                        // Only delete if the file is NOT being used
                        if (!isUsedAnywhere) {
                            console.log(`❓ Considering deletion of: ${diskFile} (in DB: ${inDatabase}, used: ${isUsedAnywhere})`);
                        } else {
                            console.log(`✅ Keeping: ${diskFile} (in use)`);
                        }
                        
                        // Manual cleanup: Delete if NOT being used (regardless of age)
                        if (!isUsedAnywhere) {
                            try {
                                await fs.unlink(filePath);
                                orphanedDiskFiles++;
                                
                                // Also try to delete associated thumbnails
                                const nameWithoutExt = path.parse(diskFile).name;
                                const thumbnailSizes = [64, 128, 256, 512, 1024, 2048];
                                for (const size of thumbnailSizes) {
                                    try {
                                        const thumbnailPath = path.join(__dirname, 'thumbnails', size.toString(), `${nameWithoutExt}.webp`);
                                        await fs.unlink(thumbnailPath);
                                    } catch (e) {
                                        // Thumbnail might not exist
                                    }
                                }
                            } catch (error) {
                                console.error(`Failed to delete orphaned disk file ${diskFile}:`, error);
                            }
                        }
                    }
                    console.log(`🗑️ Deleted ${orphanedDiskFiles} orphaned files from disk (not in database)`);
                } catch (error) {
                    console.error('Error cleaning orphaned disk files:', error);
                }
                
                // 3. Clean up old operations more aggressively
                // Declare result variables outside try block
                let imageDataOpsResult, largeOpsResult, cleanupResult, userCleanupResult;
                
                // Temporarily disable foreign key constraints for cleanup
                await this.db.run('PRAGMA foreign_keys = OFF');
                
                try {
                    // First, delete ALL operations that contain base64 image data
                    // This is the main cause of database bloat
                    imageDataOpsResult = await this.db.run(`
                        DELETE FROM operations 
                        WHERE operation_data LIKE '%data:image%'
                    `);
                    
                    // Also delete any large operations (over 10KB) that might contain other embedded data
                    largeOpsResult = await this.db.run(`
                        DELETE FROM operations 
                        WHERE length(operation_data) > 10000
                    `);
                    
                    // Keep only the most recent 50 operations per project (was 1000)
                    cleanupResult = await this.db.run(`
                        DELETE FROM operations 
                        WHERE id NOT IN (
                            SELECT id FROM operations o1
                            WHERE (
                                SELECT COUNT(*) FROM operations o2 
                                WHERE o2.project_id = o1.project_id 
                                AND o2.sequence_number >= o1.sequence_number
                            ) <= 50
                        )
                    `);
                    console.log(`🗑️ Deleted ${cleanupResult.changes} old operations (keeping recent 50 per project)`);
                    
                    // 4. Clean up inactive sessions
                    const sessionResult = await this.db.run(
                        "DELETE FROM active_sessions WHERE last_activity < datetime('now', '-1 hour')"
                    );
                    
                    // 5. Clean up orphaned project data (projects without owners)
                    const orphanProjectResult = await this.db.run(`
                        DELETE FROM projects 
                        WHERE owner_id NOT IN (SELECT id FROM users)
                    `);
                    
                    // 6. Clean up users who don't own any projects and aren't collaborators
                    userCleanupResult = await this.db.run(`
                        DELETE FROM users 
                        WHERE id NOT IN (
                            SELECT DISTINCT owner_id FROM projects
                            UNION
                            SELECT DISTINCT user_id FROM project_collaborators
                        )
                    `);
                    
                } finally {
                    // Re-enable foreign key constraints
                    await this.db.run('PRAGMA foreign_keys = ON');
                }
                
                // 7. Checkpoint WAL file and VACUUM to reclaim space
                
                // First, checkpoint the WAL file to merge it back to main database
                await this.db.run('PRAGMA wal_checkpoint(TRUNCATE)');

                // Then vacuum to reclaim space
                await this.db.run('VACUUM');

                // Finally, checkpoint again to clean up
                await this.db.run('PRAGMA wal_checkpoint(TRUNCATE)');
                
                // Get new database size (including WAL and SHM files)
                const stats = await fs.stat(this.db.dbPath);
                let totalSize = stats.size;
                try {
                    const walStats = await fs.stat(this.db.dbPath + '-wal');
                    totalSize += walStats.size;
                } catch (e) {
                    // WAL file might not exist after checkpoint
                }
                try {
                    const shmStats = await fs.stat(this.db.dbPath + '-shm');
                    totalSize += shmStats.size;
                } catch (e) {
                    // SHM file might not exist after checkpoint
                }
                
                // Count total operations deleted
                let totalOpsDeleted = 0;
                let totalUsersDeleted = 0;
                try {
                    // Access these within a try block in case they're undefined
                    totalOpsDeleted = (imageDataOpsResult?.changes || 0) + 
                                     (largeOpsResult?.changes || 0) + 
                                     (cleanupResult?.changes || 0);
                    totalUsersDeleted = userCleanupResult?.changes || 0;
                } catch (e) {
                    
                }

                // Safety check - warn if we're about to delete a lot of files
                if (deletedFiles + orphanedDiskFiles > 100) {
                    
                }
                
                res.json({ 
                    success: true,
                    deleted: {
                        files: deletedFiles,
                        orphanedDiskFiles: orphanedDiskFiles,
                        operations: totalOpsDeleted,
                        users: totalUsersDeleted
                    },
                    newSize: {
                        bytes: totalSize,
                        formatted: this.formatBytes(totalSize)
                    },
                    previousSize: {
                        bytes: initialSize,
                        formatted: this.formatBytes(initialSize)
                    }
                });
                
                console.log(`📊 Final database size: ${this.formatBytes(totalSize)} (was ${this.formatBytes(initialSize)})`);
                
            } catch (error) {
                console.error('Failed to perform cleanup:', error);
                console.error('Stack trace:', error.stack);
                res.status(500).json({ 
                    error: 'Failed to perform cleanup',
                    details: error.message 
                });
            }
        });
        */
        
        // Setup cleanup endpoint - note: db will be initialized later
        // This is a closure that will use this.db when the endpoint is called
        this.app.post('/database/cleanup', async (req, res) => {
            try {
                
                // Check if database is initialized
                if (!this.db) {
                    return res.status(500).json({ error: 'Database not initialized' });
                }
                
                // Get parameters
                const dryRun = req.query.dryRun === 'true';
                const graceperiodMinutes = parseInt(req.query.gracePeriod) || 60;
                
                // For now, just clean up old operations
                let operationsDeleted = 0;
                try {
                    // Delete old operations with embedded image data
                    const imageOpsResult = await this.db.run(`
                        DELETE FROM operations 
                        WHERE operation_data LIKE '%data:image%'
                        AND datetime(applied_at) < datetime('now', '-7 days')
                    `);
                    
                    operationsDeleted = imageOpsResult.changes || 0;
                } catch (error) {
                    
                }
                
                // Return results
                res.json({
                    success: true,
                    operationsDeleted,
                    message: dryRun ? 
                        'Dry run completed' : 
                        `Cleaned up ${operationsDeleted} old operations`
                });
                
            } catch (error) {
                console.error('❌ Cleanup failed:', error);
                res.status(500).json({ 
                    error: 'Cleanup failed', 
                    details: error.message 
                });
            }
        })
        
        // API placeholder routes
        this.app.use('/api/projects', (req, res) => {
            res.json({ message: 'Project API coming soon', status: 'placeholder' });
        });
        
        this.app.use('/api/users', (req, res) => {
            res.json({ message: 'User API coming soon', status: 'placeholder' });
        });
        
        this.app.use('/api/files', (req, res) => {
            res.json({ message: 'File API coming soon', status: 'placeholder' });
        });
        
        // Fallback route
        this.app.use('*', (req, res) => {
            res.status(404).json({ error: 'Endpoint not found' });
        });
    }

    setupUpload() {
        // Configure multer for file uploads
        const storage = multer.diskStorage({
            destination: async (req, file, cb) => {
                const uploadsDir = path.join(__dirname, 'uploads');
                try {
                    await fs.mkdir(uploadsDir, { recursive: true });
                    cb(null, uploadsDir);
                } catch (error) {
                    cb(error);
                }
            },
            filename: (req, file, cb) => {
                // Generate unique filename with timestamp
                const timestamp = Date.now();
                const randomStr = Math.random().toString(36).substring(7);
                const ext = path.extname(file.originalname);
                cb(null, `${timestamp}-${randomStr}${ext}`);
            }
        });

        this.uploadMiddleware = multer({
            storage: storage,
            limits: {
                fileSize: 50 * 1024 * 1024 // 50MB limit
            },
            fileFilter: (req, file, cb) => {
                // Allow images and videos
                if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
                    cb(null, true);
                } else {
                    cb(new Error('Only image and video files are allowed'));
                }
            }
        }).single('file');
    }

    async generateThumbnails(filePath, filename) {
        const thumbnailSizes = [64, 128, 256, 512, 1024, 2048];
        const nameWithoutExt = path.parse(filename).name;
        
        try {
            // Load the image once for metadata
            const image = sharp(filePath);
            const metadata = await image.metadata();
            
            // Skip if image is corrupted or invalid
            if (!metadata.width || !metadata.height) {
                
                return;
            }
            
            // Process thumbnails in smaller batches to avoid memory issues
            const batchSize = 2; // Process 2 sizes at a time
            for (let i = 0; i < thumbnailSizes.length; i += batchSize) {
                const batch = thumbnailSizes.slice(i, i + batchSize);
                
                await Promise.all(batch.map(async (size) => {
                    try {
                        const thumbnailDir = path.join(__dirname, 'thumbnails', size.toString());
                        await fs.mkdir(thumbnailDir, { recursive: true });
                        
                        const thumbnailPath = path.join(thumbnailDir, `${nameWithoutExt}.webp`);
                        
                        // Check if thumbnail already exists
                        try {
                            await fs.access(thumbnailPath);
                            
                            return;
                        } catch (e) {
                            // File doesn't exist, continue to generate
                        }
                        
                        // Create a fresh sharp instance for each operation
                        // This prevents memory buildup
                        const resizeOptions = { 
                            fit: 'inside',
                            withoutEnlargement: true 
                        };
                        
                        // Only create thumbnail if source is large enough or if it's a small size
                        if (size <= 512 || (metadata.width >= size || metadata.height >= size)) {
                            await sharp(filePath)
                                .resize(size, size, resizeOptions)
                                .webp({ quality: 85 })
                                .toFile(thumbnailPath);
                        } else {
                            // For large thumbnails of small images, skip creation
                            console.log(`Skipping ${size}px thumbnail for ${filename} (source: ${metadata.width}x${metadata.height})`);
                        }

                    } catch (error) {
                        
                    }
                }));
                
                // Small delay between batches to prevent resource exhaustion
                if (i + batchSize < thumbnailSizes.length) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
        } catch (error) {
            console.error(`❌ Failed to process thumbnails for ${filename}:`, error.message);
            // Don't throw - this is non-critical
        }
    }
    
    async setupDatabase() {
        try {
            this.db = new Database(path.join(__dirname, 'database', 'canvas.db'));
            await this.db.init();
            
        } catch (error) {
            console.error('❌ Database initialization failed:', error);
            // Continue with placeholder for development
        }
    }
    
    async performStartupCleanup() {
        
        try {
            // Wait a bit for database to be fully ready
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Get all files from database
            const dbFiles = await this.db.all('SELECT filename FROM files');
            const dbFilenames = new Set(dbFiles.map(f => f.filename));
            
            // Get all files referenced in canvases
            const projects = await this.db.all(`
                SELECT canvas_data FROM projects 
                WHERE canvas_data IS NOT NULL
            `);
            
            const usedFilenames = new Set();
            const usedFilenamesLower = new Set(); // Case-insensitive matching
            
            // Helper function to add a filename in all variations
            const addUsedFilename = (filename) => {
                if (!filename) return;
                
                // Add the exact filename
                usedFilenames.add(filename);
                usedFilenamesLower.add(filename.toLowerCase());
                
                // If it's a path, extract just the filename
                const pathMatch = filename.match(/([^\/\\]+)$/);
                if (pathMatch && pathMatch[1] !== filename) {
                    usedFilenames.add(pathMatch[1]);
                    usedFilenamesLower.add(pathMatch[1].toLowerCase());
                }
                
                // Also try without query parameters
                const withoutQuery = filename.split('?')[0];
                if (withoutQuery !== filename) {
                    usedFilenames.add(withoutQuery);
                    usedFilenamesLower.add(withoutQuery.toLowerCase());
                    
                    const pathMatch2 = withoutQuery.match(/([^\/\\]+)$/);
                    if (pathMatch2) {
                        usedFilenames.add(pathMatch2[1]);
                        usedFilenamesLower.add(pathMatch2[1].toLowerCase());
                    }
                }
            };
            
            for (const project of projects) {
                try {
                    const canvasData = JSON.parse(project.canvas_data);
                    if (canvasData && canvasData.nodes) {
                        for (const node of canvasData.nodes) {
                            // Check multiple possible locations for file references
                            // 1. Direct serverFilename property (most common)
                            if (node.properties && node.properties.serverFilename) {
                                addUsedFilename(node.properties.serverFilename);
                            }
                            
                            // 2. Check src property for uploads
                            if (node.properties && node.properties.src) {
                                const srcMatch = node.properties.src.match(/\/uploads\/(.+)$/);
                                if (srcMatch) {
                                    addUsedFilename(srcMatch[1]);
                                }
                            }
                            
                            // 3. Legacy: Check data.mediaUrl (older format)
                            if (node.data && node.data.mediaUrl) {
                                const match = node.data.mediaUrl.match(/\/uploads\/(.+)$/);
                                if (match) {
                                    addUsedFilename(match[1]);
                                }
                            }
                            
                            // 4. Check filename property (might contain actual server filename)
                            if (node.properties && node.properties.filename) {
                                addUsedFilename(node.properties.filename);
                            }
                            
                            // 5. Check serverUrl property for uploads pattern
                            if (node.properties && node.properties.serverUrl) {
                                const urlMatch = node.properties.serverUrl.match(/\/uploads\/(.+)$/);
                                if (urlMatch) {
                                    addUsedFilename(urlMatch[1]);
                                }
                            }
                            
                            // 6. Check for any property that might contain a filename pattern
                            if (node.properties) {
                                for (const [key, value] of Object.entries(node.properties)) {
                                    if (typeof value === 'string' && value.includes('/uploads/')) {
                                        const match = value.match(/\/uploads\/(.+?)(?:\?|$)/);
                                        if (match) {
                                            addUsedFilename(match[1]);
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error parsing canvas data during startup cleanup:', error);
                }
            }
            
            // Check uploads directory
            const uploadsDir = path.join(__dirname, 'uploads');
            let cleanedFiles = 0;
            let cleanedSize = 0;
            
            try {
                const diskFiles = await fs.readdir(uploadsDir);
                
                for (const diskFile of diskFiles) {
                    const filePath = path.join(uploadsDir, diskFile);
                    const stat = await fs.stat(filePath);
                    
                    if (!stat.isFile()) continue;
                    
                    // Delete if not used in any canvas
                    const isUsed = usedFilenames.has(diskFile) || usedFilenamesLower.has(diskFile.toLowerCase());
                    const inDatabase = dbFilenames.has(diskFile);
                    
                    // Check if file was recently created (within last hour)
                    const fileAge = Date.now() - stat.mtimeMs;
                    const ONE_HOUR = 60 * 60 * 1000;
                    const isRecent = fileAge < ONE_HOUR;
                    
                    if (!isUsed && !isRecent) {
                        try {
                            cleanedSize += stat.size;
                            await fs.unlink(filePath);
                            cleanedFiles++;
                            
                            // If in database, remove the database entry too
                            if (inDatabase) {
                                await this.db.run('DELETE FROM files WHERE filename = ?', [diskFile]);
                            }
                            
                            // Clean up thumbnails
                            const nameWithoutExt = path.parse(diskFile).name;
                            const thumbnailSizes = [64, 128, 256, 512, 1024, 2048];
                            for (const size of thumbnailSizes) {
                                try {
                                    const thumbnailPath = path.join(__dirname, 'thumbnails', size.toString(), `${nameWithoutExt}.webp`);
                                    await fs.unlink(thumbnailPath);
                                } catch (e) {
                                    // Thumbnail might not exist
                                }
                            }

                        } catch (error) {
                            console.error(`  ❌ Failed to clean up ${diskFile}:`, error.message);
                        }
                    } else if (!isUsed && isRecent) {
                        console.log(`  ⏰ Skipping recent file: ${diskFile} (created ${Math.round(fileAge / 1000)}s ago)`);
                    }
                }
                
                if (cleanedFiles > 0) {
                    console.log(`✅ Startup cleanup complete: removed ${cleanedFiles} files (${this.formatBytes(cleanedSize)})`);
                } else {
                    
                }
            } catch (error) {
                console.error('Error during startup cleanup:', error);
            }
        } catch (error) {
            console.error('Failed to perform startup cleanup:', error);
            // Don't exit - this is not critical for server operation
        }
    }
    
    setupRealtime() {
        try {
            this.collaborationManager = new CollaborationManager(this.io, this.db);
            
            // Add basic test handlers
            // NOTE: Commenting out to avoid conflicts with CollaborationManager
            /*
            this.io.on('connection', (socket) => {
                
                socket.on('test_message', (data) => {
                    
                    socket.emit('test_response', { 
                        message: 'Hello from ImageCanvas server!',
                        echo: data,
                        timestamp: Date.now()
                    });
                });
                
                socket.on('disconnect', () => {
                    
                });
            });
            */

        } catch (error) {
            console.error('❌ Real-time setup failed:', error);
        }
    }
    
    async start() {
        try {
            // Initialize systems
            await this.setupDatabase();
            
            // Database is now initialized, cleanup endpoint can use it
            
            this.setupRealtime();
            
            // ✅ Startup cleanup logic addressed via CleanupManager and proper file tracking
            // Cleanup is now handled by the client-side CleanupManager with proper validation
            // setTimeout(() => {
            //     this.performStartupCleanup().catch(err => {
            //         console.error('Startup cleanup error:', err);
            //     });
            // }, 2000);
            
            this.server.listen(this.port, () => {

            });
        } catch (error) {
            console.error('❌ Failed to start server:', error);
            process.exit(1);
        }
    }
    
    async stop() {
        if (this.db) {
            await this.db.close();
        }
        this.server.close();
        
    }

    /**
     * Validate navigation state structure
     */
    isValidNavigationState(state) {
        return (
            state &&
            typeof state.scale === 'number' &&
            Array.isArray(state.offset) &&
            state.offset.length === 2 &&
            typeof state.offset[0] === 'number' &&
            typeof state.offset[1] === 'number' &&
            state.scale > 0 &&
            state.scale <= 20 && // Match client CONFIG.CANVAS.MAX_SCALE
            typeof state.timestamp === 'number' &&
            state.timestamp > 0
        );
    }
    
    /**
     * Format bytes to human readable string
     */
    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
}

// Start server if this file is run directly
if (require.main === module) {
    const server = new ImageCanvasServer();
    server.start();
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
        
        await server.stop();
        process.exit(0);
    });
}

module.exports = ImageCanvasServer; // Restart trigger Wed Jul 23 23:12:03 PDT 2025
