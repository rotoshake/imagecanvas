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

// Create placeholder modules if they don't exist yet
let Database, CollaborationManager;

try {
    Database = require('./src/database/database');
} catch (error) {
    console.log('⚠️  Database module not ready, using placeholder');
    Database = class {
        async init() { console.log('📊 Placeholder database initialized'); }
        async close() { console.log('📊 Placeholder database closed'); }
    };
}

try {
    CollaborationManager = require('./src/realtime/collaboration');
} catch (error) {
    console.log('⚠️  Collaboration module not ready, using placeholder');
    CollaborationManager = class {
        constructor(io, db) {
            console.log('🔌 Placeholder collaboration manager initialized');
        }
    };
}

class ImageCanvasServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, {
            cors: {
                origin: ["http://localhost:8000", "http://127.0.0.1:8000", "http://localhost:8080", "http://127.0.0.1:8080"],
                methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                credentials: true
            },
            // Allow multiple connections from same origin
            allowEIO3: true,
            // Increase ping timeout to prevent premature disconnections
            pingTimeout: 60000,
            pingInterval: 25000,
            // Allow WebSocket and polling transports
            transports: ['websocket', 'polling']
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
            origin: ["http://localhost:8000", "http://127.0.0.1:8000", "http://localhost:8080", "http://127.0.0.1:8080"],
            credentials: true,
            methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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

        // File upload endpoint
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

                // Generate thumbnails for images
                if (req.file.mimetype.startsWith('image/')) {
                    await this.generateThumbnails(req.file.path, req.file.filename);
                }

                // Broadcast to other users in the project (excluding uploader)
                console.log(`📤 Broadcasting media upload: ${fileInfo.original_name} to project_${projectId}`);
                
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
                        console.warn('Could not find uploader socket:', e.message);
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
                    mediaUrl: `/uploads/${req.file.filename}`
                });

            } catch (error) {
                console.error('Upload error:', error);
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
                console.log('📝 Creating project:', { name, description, ownerId });
                
                // Validate input
                if (!name || !ownerId) {
                    return res.status(400).json({ error: 'Name and ownerId are required' });
                }
                
                // Check if database is initialized
                if (!this.db) {
                    console.error('❌ Database not initialized');
                    return res.status(500).json({ error: 'Database not initialized' });
                }
                
                const projectId = await this.db.createProject(name, ownerId, description);
                console.log('✅ Project created with ID:', projectId);
                
                const project = await this.db.getProject(projectId);
                console.log('📦 Retrieved project:', project);
                
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
                
                res.json({ 
                    success: true,
                    canvas_data: project.canvas_data ? JSON.parse(project.canvas_data) : null
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
                
                // Delete the project and related data
                await this.db.run('DELETE FROM project_collaborators WHERE project_id = ?', [projectId]);
                await this.db.run('DELETE FROM project_versions WHERE project_id = ?', [projectId]);
                await this.db.run('DELETE FROM operations WHERE project_id = ?', [projectId]);
                await this.db.run('DELETE FROM projects WHERE id = ?', [projectId]);
                
                // Notify connected users
                this.io.to(`project_${projectId}`).emit('project_deleted', { projectId });
                
                res.json({ success: true });
            } catch (error) {
                console.error('Failed to delete project:', error);
                res.status(500).json({ error: 'Failed to delete project' });
            }
        });
        
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
        
        for (const size of thumbnailSizes) {
            try {
                const thumbnailDir = path.join(__dirname, 'thumbnails', size.toString());
                await fs.mkdir(thumbnailDir, { recursive: true });
                
                const thumbnailPath = path.join(thumbnailDir, `${nameWithoutExt}.webp`);
                
                await sharp(filePath)
                    .resize(size, size, { 
                        fit: 'inside',
                        withoutEnlargement: true 
                    })
                    .webp({ quality: 85 })
                    .toFile(thumbnailPath);
                    
            } catch (error) {
                console.warn(`Failed to generate ${size}px thumbnail:`, error);
            }
        }
    }
    
    async setupDatabase() {
        try {
            this.db = new Database(path.join(__dirname, 'database', 'canvas.db'));
            await this.db.init();
            console.log('✅ Database initialized');
        } catch (error) {
            console.error('❌ Database initialization failed:', error);
            // Continue with placeholder for development
        }
    }
    
    setupRealtime() {
        try {
            this.collaborationManager = new CollaborationManager(this.io, this.db);
            
            // Add basic test handlers
            // NOTE: Commenting out to avoid conflicts with CollaborationManager
            /*
            this.io.on('connection', (socket) => {
                console.log(`👋 Client connected: ${socket.id}`);
                
                socket.on('test_message', (data) => {
                    console.log('Test message received:', data);
                    socket.emit('test_response', { 
                        message: 'Hello from ImageCanvas server!',
                        echo: data,
                        timestamp: Date.now()
                    });
                });
                
                socket.on('disconnect', () => {
                    console.log(`👋 Client disconnected: ${socket.id}`);
                });
            });
            */
            
            console.log('✅ Real-time collaboration initialized');
        } catch (error) {
            console.error('❌ Real-time setup failed:', error);
        }
    }
    
    async start() {
        try {
            // Initialize systems
            await this.setupDatabase();
            this.setupRealtime();
            
            this.server.listen(this.port, () => {
                console.log(`🚀 ImageCanvas Collaborative Server running on port ${this.port}`);
                console.log(`📊 Health check: http://localhost:${this.port}/health`);
                console.log(`🔌 WebSocket test: http://localhost:${this.port}/test-websocket`);
                console.log(`📁 File uploads: http://localhost:${this.port}/uploads`);
                console.log(`📋 Projects: http://localhost:${this.port}/projects`);
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
        console.log('🛑 Server stopped');
    }
}

// Start server if this file is run directly
if (require.main === module) {
    const server = new ImageCanvasServer();
    server.start();
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down gracefully...');
        await server.stop();
        process.exit(0);
    });
}

module.exports = ImageCanvasServer; 