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
const VideoProcessor = require('./src/video/VideoProcessor');
const { RateLimiterMemory } = require('rate-limiter-flexible');

// Configure Sharp for better concurrent processing
// Limit concurrency to prevent memory issues
sharp.concurrency(4); // Process max 4 images at once
sharp.cache({ memory: 50, files: 20 }); // Limit cache to 50MB memory, 20 files

// Create placeholder modules if they don't exist yet
let Database, CollaborationManager;

try {
    Database = require('./src/database/database');
    console.log('✅ Database module loaded successfully');
} catch (error) {
    console.error('❌ Failed to load database module:', error.message);
    Database = class {
        async init() { console.log('📊 Placeholder database initialized'); }
        async close() { console.log('📊 Placeholder database closed'); }
        async all(sql, params = []) { return []; }
        async get(sql, params = []) { return null; }
        async run(sql, params = []) { return { lastID: 1 }; }
        async getAllCanvases() { return []; }
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
        // Load environment variables
        require('dotenv').config();
        
        // Parse CORS origins from environment or use defaults
        const defaultOrigins = [
            "http://localhost:8000",
            "http://127.0.0.1:8000",
            "http://localhost:8080",
            "http://127.0.0.1:8080",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5174"
        ];
        
        this.corsOrigins = process.env.CORS_ORIGINS 
            ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
            : defaultOrigins;
        
        console.log('🔧 CORS Origins configured:', this.corsOrigins);
        
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, {
            cors: {
                origin: this.corsOrigins,
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
        this.videoProcessor = null;
        
        this.setupMiddleware();
        this.setupUpload();
        this.setupRoutes();
    }
    
    setupMiddleware() {
        // CORS must be first to ensure headers are always sent
        this.app.use(cors({
            origin: this.corsOrigins,
            credentials: true,
            methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization"]
        }));
        
        // Rate limiting - higher limits for development
        const rateLimiter = new RateLimiterMemory({
            points: 500, // Number of requests (increased for thumbnail loading)
            duration: 60, // Per 60 seconds
            blockDuration: 10, // Block for 10 seconds (reduced for development)
        });
        
        this.app.use(async (req, res, next) => {
            try {
                // Use req.ip || req.connection.remoteAddress as fallback
                const identifier = req.ip || req.connection.remoteAddress || 'unknown';
                await rateLimiter.consume(identifier);
                next();
            } catch (rejRes) {
                res.status(429).send('Too Many Requests');
            }
        });
        
        // Security
        this.app.use(helmet({
            contentSecurityPolicy: false // Allow inline scripts for development
        }));
        
        // Compression
        this.app.use(compression());
        
        // Body parsing
        this.app.use(express.json({ limit: '500mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '500mb' }));
        
        // Static files
        this.app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
        this.app.use('/canvases', express.static(path.join(__dirname, 'canvases')));
        
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
                const canvasId = req.body.canvasId || null;
                const userId = req.body.userId || 1; // Default to user 1 if not provided
                
                await this.db.run(
                    `INSERT INTO files (filename, original_name, mime_type, size, hash, user_id, canvas_id) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [req.file.filename, req.file.originalname, req.file.mimetype, 
                     req.file.size, hash, userId, canvasId]
                );
                
                try {
                    // Generate thumbnails for images
                    if (req.file.mimetype.startsWith('image/')) {
                        await this.generateThumbnails(req.file.path, req.file.filename);
                    }
                    
                    // Process videos
                    else if (req.file.mimetype.startsWith('video/')) {
                        console.log(`🎬 Processing video: ${req.file.originalname}`);
                        
                        // Check if video needs processing
                        const needsProcessing = await this.videoProcessor.needsProcessing(req.file.path);
                        
                        if (needsProcessing) {
                            const baseFilename = path.parse(req.file.filename).name;
                            const uploadDir = path.dirname(req.file.path);
                            
                            // Emit start event
                            if (this.io) {
                                this.io.emit('video_processing_start', {
                                    filename: req.file.originalname,
                                    serverFilename: req.file.filename
                                });
                            }
                            
                            // Process video in the background
                            this.videoProcessor.processVideo(req.file.path, uploadDir, baseFilename, req.file.originalname)
                                .then(results => {
                                    console.log(`✅ Video processing complete for ${req.file.originalname}`);
                                    
                                    // Update database with processed formats
                                    if (results.formats.webm || results.formats.mp4) {
                                        const formats = Object.keys(results.formats)
                                            .map(fmt => path.basename(results.formats[fmt]))
                                            .join(',');
                                        
                                        this.db.run(
                                            `UPDATE files SET processed_formats = ?, processing_status = 'completed', processing_completed_at = CURRENT_TIMESTAMP WHERE filename = ?`,
                                            [formats, req.file.filename]
                                        ).catch(err => console.error('Failed to update processed formats:', err));
                                    }
                                    
                                    // Emit completion event
                                    if (this.io) {
                                        this.io.emit('video_processing_complete', {
                                            filename: req.file.originalname,
                                            serverFilename: req.file.filename,
                                            formats: Object.keys(results.formats),
                                            success: true
                                        });
                                    }
                                })
                                .catch(error => {
                                    console.error(`❌ Video processing failed for ${req.file.originalname}:`, error);
                                    
                                    // Update database with error
                                    this.db.run(
                                        `UPDATE files SET processing_status = 'failed', processing_error = ?, processing_completed_at = CURRENT_TIMESTAMP WHERE filename = ?`,
                                        [error.message, req.file.filename]
                                    ).catch(err => console.error('Failed to update processing error:', err));
                                    
                                    // Emit failure event
                                    if (this.io) {
                                        this.io.emit('video_processing_complete', {
                                            filename: req.file.originalname,
                                            serverFilename: req.file.filename,
                                            success: false,
                                            error: error.message
                                        });
                                    }
                                });
                            
                            // Return immediately while processing continues in background
                            res.json({
                                success: true,
                                url: `/uploads/${req.file.filename}`,
                                hash: hash,
                                filename: req.file.originalname,
                                serverFilename: req.file.filename,
                                size: req.file.size,
                                processing: true,
                                message: 'Video is being optimized in the background'
                            });
                        } else {
                            // Video is already optimized, return as-is
                            res.json({
                                success: true,
                                url: `/uploads/${req.file.filename}`,
                                hash: hash,
                                filename: req.file.originalname,
                                serverFilename: req.file.filename,
                                size: req.file.size,
                                processing: false
                            });
                        }
                        return; // Exit early for video processing
                    }

                    // Return the URL for the uploaded file (images)
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

                const { canvasId, nodeData } = req.body;
                const parsedNodeData = JSON.parse(nodeData);
                
                // Generate file hash
                const fileBuffer = await fs.readFile(req.file.path);
                const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
                
                // Store file info in database
                const fileInfo = {
                    filename: req.file.filename,
                    original_name: req.file.originalname,
                    mime_type: req.file.mimetype,
                    size: req.file.size,
                    hash: fileHash,
                    canvas_id: parseInt(canvasId)
                };

                // Insert file record into database for tracking
                const userId = parsedNodeData.uploaderUserId || 1; // Default to user 1 if not provided
                await this.db.run(
                    `INSERT INTO files (filename, original_name, mime_type, size, hash, user_id, canvas_id) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [fileInfo.filename, fileInfo.original_name, fileInfo.mime_type, 
                     fileInfo.size, fileInfo.hash, userId, fileInfo.canvas_id]
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

                // Broadcast to other users in the canvas (excluding uploader)
                
                // Get uploader's socket ID if available
                let uploaderSocketId = parsedNodeData.uploaderSocketId || null;
                
                // If not provided, try to find it from user ID
                if (!uploaderSocketId && this.collaborationManager && parsedNodeData.uploaderUserId) {
                    try {
                        // Find the socket for this user
                        for (const [socketId, session] of this.collaborationManager.socketSessions) {
                            if (session.userId === parsedNodeData.uploaderUserId && session.canvasId === parseInt(canvasId)) {
                                uploaderSocketId = socketId;
                                break;
                            }
                        }
                    } catch (e) {
                        
                    }
                }
                
                if (uploaderSocketId) {
                    // Broadcast to everyone in the room EXCEPT the uploader
                    this.io.to(`canvas_${canvasId}`).except(uploaderSocketId).emit('media_uploaded', {
                        fileInfo,
                        nodeData: parsedNodeData,
                        mediaUrl: `/uploads/${req.file.filename}`,
                        fromSocketId: uploaderSocketId
                    });
                    console.log(`✅ Media upload broadcast sent to canvas_${canvasId} (excluding uploader ${uploaderSocketId})`);
                } else {
                    // Fallback: broadcast to everyone (shouldn't happen in normal usage)
                    this.io.to(`canvas_${canvasId}`).emit('media_uploaded', {
                        fileInfo,
                        nodeData: parsedNodeData,
                        mediaUrl: `/uploads/${req.file.filename}`,
                        fromSocketId: null
                    });
                    console.log(`✅ Media upload broadcast sent to canvas_${canvasId} (uploader socket not found)`);
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
        this.app.get('/uploads/:filename', async (req, res) => {
            const filename = req.params.filename;
            const filepath = path.join(__dirname, 'uploads', filename);
            
            // Set CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET');
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            
            // Check if this is a video file that might have processed formats
            const fileExt = path.extname(filename).toLowerCase();
            const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'];
            
            if (videoExtensions.includes(fileExt)) {
                try {
                    // Check if we have processed formats available
                    const fileRecord = await this.db.get(
                        'SELECT processed_formats FROM files WHERE filename = ?',
                        [filename]
                    );
                    
                    if (fileRecord && fileRecord.processed_formats) {
                        // Parse available formats
                        const formats = fileRecord.processed_formats.split(',');
                        
                        // Check browser preference via Accept header
                        const acceptHeader = req.headers.accept || '';
                        
                        // Prefer WebM for browsers that support it
                        if (acceptHeader.includes('video/webm') && formats.some(f => f.endsWith('.webm'))) {
                            const webmFile = formats.find(f => f.endsWith('.webm'));
                            const webmPath = path.join(__dirname, 'uploads', webmFile);
                            
                            // Check if file exists before serving
                            try {
                                await fs.access(webmPath);
                                console.log(`🎬 Serving optimized WebM: ${webmFile}`);
                                return res.sendFile(webmPath);
                            } catch (err) {
                                console.warn(`WebM file not found: ${webmFile}`);
                            }
                        }
                        
                        // Fallback to MP4 if available
                        if (formats.some(f => f.endsWith('.mp4'))) {
                            const mp4File = formats.find(f => f.endsWith('.mp4'));
                            const mp4Path = path.join(__dirname, 'uploads', mp4File);
                            
                            try {
                                await fs.access(mp4Path);
                                console.log(`🎬 Serving optimized MP4: ${mp4File}`);
                                return res.sendFile(mp4Path);
                            } catch (err) {
                                console.warn(`MP4 file not found: ${mp4File}`);
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error checking video formats:', error);
                }
            }
            
            // Default: serve the original file
            res.sendFile(filepath);
        });

        // Check video processing status
        this.app.get('/api/video-status/:filename', async (req, res) => {
            try {
                const { filename } = req.params;
                
                const fileRecord = await this.db.get(
                    `SELECT processing_status, processed_formats, processing_error 
                     FROM files WHERE filename = ?`,
                    [filename]
                );
                
                if (!fileRecord) {
                    return res.status(404).json({ error: 'File not found' });
                }
                
                res.json({
                    status: fileRecord.processing_status || 'unknown',
                    formats: fileRecord.processed_formats ? fileRecord.processed_formats.split(',') : [],
                    error: fileRecord.processing_error
                });
            } catch (error) {
                console.error('Failed to check video status:', error);
                res.status(500).json({ error: 'Failed to check video status' });
            }
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

        // Generate thumbnails endpoint
        this.app.post('/api/thumbnails/generate', async (req, res) => {
            try {
                const { hash, sizes } = req.body;
                
                if (!hash || !Array.isArray(sizes)) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Missing hash or sizes array' 
                    });
                }
                
                // Find the file by hash
                const file = await this.db.get('SELECT * FROM files WHERE hash = ?', [hash]);
                if (!file) {
                    return res.status(404).json({ 
                        success: false, 
                        error: 'File not found for hash' 
                    });
                }
                
                const filePath = path.join(__dirname, 'uploads', file.filename);
                
                // Check if file exists on disk
                try {
                    await fs.access(filePath);
                } catch (error) {
                    return res.status(404).json({ 
                        success: false, 
                        error: 'Original file not found on disk' 
                    });
                }
                
                // Generate thumbnails for requested sizes
                console.log(`🔧 Regenerating thumbnails for ${hash.substring(0, 8)} (${file.filename}), sizes: [${sizes.join(', ')}]`);
                await this.generateThumbnails(filePath, file.filename, sizes);
                
                // Build response URLs
                const nameWithoutExt = path.parse(file.filename).name;
                const urls = {};
                for (const size of sizes) {
                    urls[size] = `/thumbnails/${size}/${nameWithoutExt}.webp`;
                }
                
                res.json({
                    success: true,
                    generated: sizes,
                    urls: urls
                });
                
            } catch (error) {
                console.error('❌ Thumbnail generation failed:', error);
                res.status(500).json({ 
                    success: false, 
                    error: 'Thumbnail generation failed' 
                });
            }
        });

        // Canvas endpoints
        this.app.get('/canvases', async (req, res) => {
            try {
                // Set no-cache headers to ensure fresh data
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                
                const canvases = await this.db.getAllCanvases();
                console.log(`Fetched ${canvases.length} canvases from database`);
                res.json(canvases);
            } catch (error) {
                console.error('Failed to fetch canvases:', error);
                res.status(500).json({ error: 'Failed to fetch canvases' });
            }
        });

        this.app.post('/canvases', async (req, res) => {
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
                    user = await this.db.getUser(userId);
                }
                
                const canvasId = await this.db.createCanvas(name, user.id, description);
                
                const canvas = await this.db.getCanvas(canvasId);
                
                res.json(canvas);
            } catch (error) {
                console.error('❌ Failed to create canvas:', error);
                console.error('Stack trace:', error.stack);
                res.status(500).json({ 
                    error: 'Failed to create canvas',
                    details: error.message 
                });
            }
        });
        
        // Canvas save/load endpoints
        this.app.get('/canvases/:id/state', async (req, res) => {
            try {
                const canvasId = parseInt(req.params.id);
                const canvas = await this.db.get(
                    'SELECT canvas_data FROM canvases WHERE id = ?',
                    [canvasId]
                );
                
                if (!canvas) {
                    return res.status(404).json({ error: 'Canvas not found' });
                }
                
                const canvasData = canvas.canvas_data ? JSON.parse(canvas.canvas_data) : null;
                
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
        
        this.app.put('/canvases/:id/state', async (req, res) => {
            try {
                const canvasId = parseInt(req.params.id);
                const canvasData = req.body.canvas_data;
                
                if (!canvasData) {
                    return res.status(400).json({ error: 'Canvas data required' });
                }
                
                await this.db.run(
                    'UPDATE canvases SET canvas_data = ?, last_modified = CURRENT_TIMESTAMP WHERE id = ?',
                    [JSON.stringify(canvasData), canvasId]
                );
                
                // Broadcast canvas update to other users in the canvas
                this.io.to(`canvas_${canvasId}`).emit('canvas_saved', {
                    canvasId,
                    savedBy: req.body.userId || 'unknown',
                    timestamp: new Date().toISOString()
                });
                
                res.json({ success: true });
            } catch (error) {
                console.error('Failed to save canvas:', error);
                res.status(500).json({ error: 'Failed to save canvas' });
            }
        });
        
        // PATCH endpoint for navigation state updates (both paths for compatibility)
        this.app.patch('/canvases/:id/state', async (req, res) => {
            try {
                const canvasId = parseInt(req.params.id);
                const { navigation_state } = req.body;
                
                if (!navigation_state) {
                    return res.status(400).json({ error: 'Navigation state required' });
                }
                
                // Validate navigation state structure
                if (!this.isValidNavigationState(navigation_state)) {
                    return res.status(400).json({ error: 'Invalid navigation state format' });
                }
                
                // Get current canvas data
                const canvas = await this.db.get(
                    'SELECT canvas_data FROM canvases WHERE id = ?',
                    [canvasId]
                );
                
                if (!canvas) {
                    return res.status(404).json({ error: 'Canvas not found' });
                }
                
                // Parse existing canvas data or create new structure
                let canvasData = {};
                try {
                    if (canvas.canvas_data) {
                        canvasData = JSON.parse(canvas.canvas_data);
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
                    'UPDATE canvases SET canvas_data = ?, last_modified = CURRENT_TIMESTAMP WHERE id = ?',
                    [JSON.stringify(canvasData), canvasId]
                );
                
                res.json({ success: true });
                
            } catch (error) {
                console.error('Failed to update navigation state:', error);
                res.status(500).json({ error: 'Failed to update navigation state' });
            }
        });
        
        // PATCH endpoint for navigation state updates (legacy path)
        this.app.patch('/canvases/:id/canvas', async (req, res) => {
            try {
                const canvasId = parseInt(req.params.id);
                const { navigation_state } = req.body;
                
                if (!navigation_state) {
                    return res.status(400).json({ error: 'Navigation state required' });
                }
                
                // Validate navigation state structure
                if (!this.isValidNavigationState(navigation_state)) {
                    return res.status(400).json({ error: 'Invalid navigation state format' });
                }
                
                // Get current canvas data
                const canvas = await this.db.get(
                    'SELECT canvas_data FROM canvases WHERE id = ?',
                    [canvasId]
                );
                
                if (!canvas) {
                    return res.status(404).json({ error: 'Canvas not found' });
                }
                
                // Parse existing canvas data or create new structure
                let canvasData = {};
                try {
                    if (canvas.canvas_data) {
                        canvasData = JSON.parse(canvas.canvas_data);
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
                    'UPDATE canvases SET canvas_data = ?, last_modified = CURRENT_TIMESTAMP WHERE id = ?',
                    [JSON.stringify(canvasData), canvasId]
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
        
        // Get single canvas
        this.app.get('/canvases/:id', async (req, res) => {
            try {
                const canvasId = parseInt(req.params.id);
                const canvas = await this.db.get(
                    'SELECT * FROM canvases WHERE id = ?',
                    [canvasId]
                );
                
                if (!canvas) {
                    return res.status(404).json({ error: 'Canvas not found' });
                }
                
                res.json(canvas);
            } catch (error) {
                console.error('Failed to get canvas:', error);
                res.status(500).json({ error: 'Failed to get canvas' });
            }
        });
        
        // Update canvas (rename)
        this.app.put('/canvases/:id', async (req, res) => {
            try {
                const canvasId = parseInt(req.params.id);
                const { name } = req.body;
                
                if (!name || !name.trim()) {
                    return res.status(400).json({ error: 'Name is required' });
                }
                
                await this.db.run(
                    'UPDATE canvases SET name = ?, last_modified = CURRENT_TIMESTAMP WHERE id = ?',
                    [name.trim(), canvasId]
                );
                
                const updatedCanvas = await this.db.get(
                    'SELECT * FROM canvases WHERE id = ?',
                    [canvasId]
                );
                
                if (!updatedCanvas) {
                    return res.status(404).json({ error: 'Canvas not found' });
                }
                
                // Broadcast rename to other users in the canvas
                this.io.to(`canvas_${canvasId}`).emit('canvas_renamed', {
                    canvasId,
                    newName: name.trim(),
                    timestamp: new Date().toISOString()
                });
                
                res.json(updatedCanvas);
            } catch (error) {
                console.error('Failed to update canvas:', error);
                res.status(500).json({ error: 'Failed to update canvas' });
            }
        });
        
        // Get user's canvases
        this.app.get('/canvases/user/:userId', async (req, res) => {
            try {
                const userId = parseInt(req.params.userId);
                const canvases = await this.db.all(
                    `SELECT p.*, 
                            (SELECT COUNT(*) FROM canvas_collaborators WHERE canvas_id = p.id) as collaborator_count
                     FROM canvases p 
                     WHERE p.owner_id = ? 
                        OR EXISTS (SELECT 1 FROM canvas_collaborators pc WHERE pc.canvas_id = p.id AND pc.user_id = ?)
                     ORDER BY p.last_modified DESC`,
                    [userId, userId]
                );
                res.json(canvases);
            } catch (error) {
                console.error('Failed to fetch user canvases:', error);
                res.status(500).json({ error: 'Failed to fetch canvases' });
            }
        });
        
        // Delete canvas
        this.app.delete('/canvases/:id', async (req, res) => {
            try {
                const canvasId = parseInt(req.params.id);
                
                // Delete all related data in the correct order to avoid foreign key violations
                await this.db.run('DELETE FROM active_sessions WHERE canvas_id = ?', [canvasId]);
                await this.db.run('DELETE FROM canvas_states WHERE canvas_id = ?', [canvasId]);
                await this.db.run('DELETE FROM active_transactions WHERE canvas_id = ?', [canvasId]);
                await this.db.run('DELETE FROM files WHERE canvas_id = ?', [canvasId]);
                await this.db.run('DELETE FROM operations WHERE canvas_id = ?', [canvasId]);
                await this.db.run('DELETE FROM canvas_versions WHERE canvas_id = ?', [canvasId]);
                await this.db.run('DELETE FROM canvas_collaborators WHERE canvas_id = ?', [canvasId]);
                await this.db.run('DELETE FROM canvases WHERE id = ?', [canvasId]);
                
                // Notify connected users
                this.io.to(`canvas_${canvasId}`).emit('canvas_deleted', { canvasId });
                
                res.json({ success: true });
            } catch (error) {
                console.error('Failed to delete canvas:', error);
                res.status(500).json({ error: 'Failed to delete canvas' });
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
                        if (roomName.startsWith('canvas_') && room.size > 0) {
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
                
                // Get all canvases with canvas data
                let canvases = [];
                try {
                    canvases = await this.db.all(`
                        SELECT id, canvas_data FROM canvases 
                        WHERE canvas_data IS NOT NULL
                    `);
                } catch (error) {
                    console.error('❌ Failed to get canvases from database:', error);
                    return res.status(500).json({ 
                        error: 'Failed to read canvases table',
                        details: error.message 
                    });
                }
                
                // CRITICAL: Also include files from currently active collaborative sessions
                // Get all active canvas states from WebSocket manager
                const activeCanvases = new Set();
                const activeFiles = new Set(); // Track files from active sessions separately
                
                // Method 1: Check CanvasStateManager
                if (this.canvasStateManager && this.canvasStateManager.canvasStates) {

                    for (const [canvasId, state] of this.canvasStateManager.canvasStates.entries()) {
                        activeCanvases.add(parseInt(canvasId));
                        // Add the active state as if it were a saved canvas
                        if (state && state.nodes) {
                            
                            canvases.push({
                                id: canvasId,
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
                        if (roomName.startsWith('canvas_') && room.size > 0) {
                            const canvasId = parseInt(roomName.replace('canvas_', ''));
                            activeCanvases.add(canvasId);
                            
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
                
                console.log(`📋 Scanning ${canvases.length} canvases (${activeCanvases.size} active) for used files...`);
                
                // Extract all media URLs from all canvases
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
                
                for (const canvas of canvases) {
                    try {
                        const canvasData = JSON.parse(canvas.canvas_data);
                        const isActiveCanvas = canvas.isActive || (canvas.id && activeCanvases.has(parseInt(canvas.id)));
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
                                    console.log(`📸 ${isActiveCanvas ? '[ACTIVE]' : '[SAVED]'} Canvas ${canvas.id}:`, JSON.stringify(nodeInfo));
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
                    
                    // Keep only the most recent 50 operations per canvas (was 1000)
                    cleanupResult = await this.db.run(`
                        DELETE FROM operations 
                        WHERE id NOT IN (
                            SELECT id FROM operations o1
                            WHERE (
                                SELECT COUNT(*) FROM operations o2 
                                WHERE o2.canvas_id = o1.canvas_id 
                                AND o2.sequence_number >= o1.sequence_number
                            ) <= 50
                        )
                    `);
                    console.log(`🗑️ Deleted ${cleanupResult.changes} old operations (keeping recent 50 per canvas)`);
                    
                    // 4. Clean up inactive sessions
                    const sessionResult = await this.db.run(
                        "DELETE FROM active_sessions WHERE last_activity < datetime('now', '-1 hour')"
                    );
                    
                    // 5. Clean up orphaned canvas data (canvases without owners)
                    const orphanCanvasResult = await this.db.run(`
                        DELETE FROM canvases 
                        WHERE owner_id NOT IN (SELECT id FROM users)
                    `);
                    
                    // 6. Clean up users who don't own any canvases and aren't collaborators
                    userCleanupResult = await this.db.run(`
                        DELETE FROM users 
                        WHERE id NOT IN (
                            SELECT DISTINCT owner_id FROM canvases
                            UNION
                            SELECT DISTINCT user_id FROM canvas_collaborators
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
                console.log('🧹 Starting database cleanup...');
                
                // Check if database is initialized
                if (!this.db) {
                    return res.status(500).json({ error: 'Database not initialized' });
                }
                
                // Get parameters
                const dryRun = req.query.dryRun === 'true';
                const deleteAllThumbnails = req.query.deleteAllThumbnails === 'true';
                
                console.log(`📋 Cleanup parameters: dryRun=${dryRun}, deleteAllThumbnails=${deleteAllThumbnails}`);
                
                let operationsDeleted = 0;
                let filesDeleted = 0;
                let thumbnailsDeleted = 0;
                let transcodesDeleted = 0;
                let operationsToDelete = 0;
                
                // 1. Clean up ALL operations when no images are referenced
                if (dryRun) {
                    // Count operations that would be deleted
                    try {
                        const countResult = await this.db.get('SELECT COUNT(*) as count FROM operations');
                        operationsToDelete = countResult.count || 0;
                        console.log(`📊 Would delete ${operationsToDelete} operations`);
                    } catch (error) {
                        console.error('Failed to count operations:', error);
                    }
                } else {
                    try {
                        // First count how many operations we have
                        const countResult = await this.db.get('SELECT COUNT(*) as count FROM operations');
                        const totalOps = countResult.count;
                        
                        // Delete ALL operations since user wants complete cleanup
                        const opsResult = await this.db.run('DELETE FROM operations');
                        operationsDeleted = opsResult.changes || 0;
                        console.log(`✅ Deleted ${operationsDeleted} operations (was ${totalOps})`);
                        
                        // Also clear active sessions and transactions
                        const sessionsResult = await this.db.run('DELETE FROM active_sessions');
                        console.log(`✅ Deleted ${sessionsResult.changes || 0} active sessions`);
                        
                        const transResult = await this.db.run('DELETE FROM active_transactions');
                        console.log(`✅ Deleted ${transResult.changes || 0} active transactions`);
                        
                        // Clear canvas versions (keep only latest)
                        const versionsResult = await this.db.run(`
                            DELETE FROM canvas_versions 
                            WHERE id NOT IN (
                                SELECT MAX(id) 
                                FROM canvas_versions 
                                GROUP BY canvas_id
                            )
                        `);
                        console.log(`✅ Deleted ${versionsResult.changes || 0} old canvas versions`);
                        
                    } catch (error) {
                        console.error('Failed to delete operations:', error);
                    }
                }
                
                // 2. Find orphaned files with comprehensive checking
                try {
                    // Get all files from database
                    const allFiles = await this.db.all('SELECT * FROM files');
                    console.log(`📁 Found ${allFiles.length} files in database`);
                    
                    // Get all canvases and their canvas data
                    const canvases = await this.db.all('SELECT id, canvas_data FROM canvases WHERE canvas_data IS NOT NULL');
                    console.log(`📋 Found ${canvases.length} canvases to check`);
                    
                    // Check for files in recent operations (last 30 minutes to protect queued videos)
                    const activeFiles = new Set();
                    const recentOpsTime = Date.now() - (30 * 60 * 1000); // 30 minutes
                    
                    try {
                        const recentOps = await this.db.all(`
                            SELECT operation_data FROM operations 
                            WHERE timestamp > ? 
                            AND (operation_data LIKE '%serverUrl%' OR operation_data LIKE '%uploadImage%')
                            ORDER BY timestamp DESC
                            LIMIT 100
                        `, [recentOpsTime]);
                        
                        console.log(`🕐 Found ${recentOps.length} recent operations to check for active files`);
                        
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
                    } catch (error) {
                        console.error('Failed to check recent operations:', error);
                    }
                    
                    // Build set of referenced files with case-insensitive matching
                    const referencedFiles = new Set();
                    const referencedFilesLower = new Set();
                    
                    // Helper function to add filename variations
                    const addReferencedFile = (filename) => {
                        if (!filename) return;
                        
                        // Add exact filename
                        referencedFiles.add(filename);
                        referencedFilesLower.add(filename.toLowerCase());
                        
                        // Extract just filename from path
                        const pathMatch = filename.match(/([^\/\\]+)$/);
                        if (pathMatch && pathMatch[1] !== filename) {
                            referencedFiles.add(pathMatch[1]);
                            referencedFilesLower.add(pathMatch[1].toLowerCase());
                        }
                        
                        // Remove query parameters
                        const withoutQuery = filename.split('?')[0];
                        if (withoutQuery !== filename) {
                            referencedFiles.add(withoutQuery);
                            referencedFilesLower.add(withoutQuery.toLowerCase());
                            
                            const pathMatch2 = withoutQuery.match(/([^\/\\]+)$/);
                            if (pathMatch2) {
                                referencedFiles.add(pathMatch2[1]);
                                referencedFilesLower.add(pathMatch2[1].toLowerCase());
                            }
                        }
                    };
                    
                    // Add active files from recent operations
                    for (const file of activeFiles) {
                        addReferencedFile(file);
                    }
                    
                    // Check all canvases for file references
                    for (const canvas of canvases) {
                        try {
                            const canvasData = JSON.parse(canvas.canvas_data);
                            if (canvasData && canvasData.nodes) {
                                for (const node of canvasData.nodes) {
                                    if (node.properties) {
                                        // Check all possible file reference locations
                                        if (node.properties.serverFilename) {
                                            addReferencedFile(node.properties.serverFilename);
                                        }
                                        
                                        if (node.properties.serverUrl) {
                                            const match = node.properties.serverUrl.match(/\/uploads\/([^?]+)/);
                                            if (match) {
                                                addReferencedFile(match[1]);
                                            }
                                        }
                                        
                                        if (node.properties.src) {
                                            const match = node.properties.src.match(/\/uploads\/([^?]+)/);
                                            if (match) {
                                                addReferencedFile(match[1]);
                                            }
                                        }
                                        
                                        if (node.properties.filename) {
                                            addReferencedFile(node.properties.filename);
                                        }
                                        
                                        // Check any property that might contain file URLs
                                        for (const [key, value] of Object.entries(node.properties)) {
                                            if (typeof value === 'string' && value.includes('/uploads/')) {
                                                const match = value.match(/\/uploads\/([^?]+)/);
                                                if (match) {
                                                    addReferencedFile(match[1]);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (error) {
                            console.error(`Error parsing canvas data for canvas ${canvas.id}:`, error);
                        }
                    }
                    
                    console.log(`✅ Found ${referencedFiles.size} referenced files (${activeFiles.size} from recent operations)`);
                    
                    // Find orphaned files in database
                    let orphanedFiles = allFiles.filter(file => 
                        !referencedFiles.has(file.filename) && 
                        !referencedFilesLower.has(file.filename.toLowerCase())
                    );
                    
                    // Additional protection: Don't delete recent video files from database
                    orphanedFiles = orphanedFiles.filter(file => {
                        // Check if this is a video file
                        if (file.filename.match(/\.(mov|mp4|avi|webm)$/i)) {
                            // Check file age
                            const uploadTime = new Date(file.upload_date).getTime();
                            const fileAge = Date.now() - uploadTime;
                            // Protect video files less than 1 hour old
                            if (fileAge < 60 * 60 * 1000) {
                                console.log(`🛡️ Protecting recent video in DB: ${file.filename} (age: ${Math.round(fileAge / 1000 / 60)} minutes)`);
                                return false; // Don't include in orphaned list
                            }
                        }
                        return true; // Include in orphaned list
                    });
                    
                    console.log(`🗑️ Found ${orphanedFiles.length} orphaned files in database to delete`);
                    
                    if (!dryRun) {
                        // Delete orphaned files from database and disk
                        for (const file of orphanedFiles) {
                            try {
                                // Delete from database
                                await this.db.run('DELETE FROM files WHERE id = ?', [file.id]);
                                
                                // Delete from disk
                                const uploadsDir = path.join(__dirname, 'uploads');
                                const filePath = path.join(uploadsDir, file.filename);
                                try {
                                    await fs.unlink(filePath);
                                    filesDeleted++;
                                    console.log(`  ✅ Deleted: ${file.filename}`);
                                } catch (error) {
                                    if (error.code !== 'ENOENT') {
                                        console.error(`  ❌ Failed to delete file: ${file.filename}`, error);
                                    }
                                }
                            } catch (error) {
                                console.error(`Failed to delete file record ${file.id}:`, error);
                            }
                        }
                    }
                    
                    // 2b. IMPORTANT: Also scan disk for orphaned files not in database
                    const uploadsDir = path.join(__dirname, 'uploads');
                    let orphanedDiskFiles = 0;
                    try {
                        const diskFiles = await fs.readdir(uploadsDir);
                        const dbFilenames = new Set(allFiles.map(f => f.filename));
                        
                        console.log(`💾 Scanning ${diskFiles.length} files on disk...`);
                        
                        for (const diskFile of diskFiles) {
                            // Skip non-file entries
                            const filePath = path.join(uploadsDir, diskFile);
                            try {
                                const stat = await fs.stat(filePath);
                                if (!stat.isFile()) continue;
                            } catch (error) {
                                console.error(`Failed to stat file ${diskFile}:`, error);
                                continue;
                            }
                            
                            // Check if file is in database
                            const inDatabase = dbFilenames.has(diskFile);
                            
                            // Check if file is referenced anywhere
                            const isReferenced = referencedFiles.has(diskFile) || 
                                               referencedFilesLower.has(diskFile.toLowerCase());
                            
                            // Additional safety: Check partial matches
                            let isUsedAnywhere = isReferenced;
                            if (!isUsedAnywhere) {
                                // Check if this filename appears in any variation
                                for (const refFile of referencedFiles) {
                                    if (refFile.includes(diskFile) || diskFile.includes(refFile)) {
                                        isUsedAnywhere = true;
                                        break;
                                    }
                                }
                            }
                            
                            // IMPORTANT: Never delete video files that might be queued for processing
                            // Check if this is a video file that was recently uploaded
                            if (!isUsedAnywhere && diskFile.match(/\.(mov|mp4|avi|webm)$/i)) {
                                try {
                                    const stat = await fs.stat(filePath);
                                    const fileAge = Date.now() - stat.mtime.getTime();
                                    // Protect video files less than 1 hour old
                                    if (fileAge < 60 * 60 * 1000) {
                                        isUsedAnywhere = true;
                                        console.log(`🛡️ Protecting recent video file: ${diskFile} (age: ${Math.round(fileAge / 1000 / 60)} minutes)`);
                                    }
                                } catch (e) {
                                    // Ignore stat errors
                                }
                            }
                            
                            // Delete if not referenced anywhere
                            if (!isUsedAnywhere) {
                                if (dryRun) {
                                    console.log(`🔍 Would delete orphaned disk file: ${diskFile} (in DB: ${inDatabase})`);
                                    orphanedDiskFiles++;
                                } else {
                                    try {
                                        await fs.unlink(filePath);
                                        orphanedDiskFiles++;
                                        filesDeleted++;
                                        console.log(`  ✅ Deleted orphaned disk file: ${diskFile}`);
                                        
                                        // Also delete associated thumbnails
                                        const nameWithoutExt = path.parse(diskFile).name;
                                        const thumbnailSizes = [64, 128, 256, 512, 1024, 2048];
                                        for (const size of thumbnailSizes) {
                                            try {
                                                const thumbnailPath = path.join(__dirname, 'thumbnails', size.toString(), `${nameWithoutExt}.webp`);
                                                await fs.unlink(thumbnailPath);
                                                thumbnailsDeleted++;
                                            } catch (e) {
                                                // Thumbnail might not exist
                                            }
                                        }
                                    } catch (error) {
                                        console.error(`Failed to delete orphaned disk file ${diskFile}:`, error);
                                    }
                                }
                            }
                        }
                        
                        console.log(`🗑️ ${dryRun ? 'Found' : 'Deleted'} ${orphanedDiskFiles} orphaned files from disk`);
                    } catch (error) {
                        console.error('Error scanning disk for orphaned files:', error);
                    }
                    
                    // 3. Clean up thumbnails
                    if (deleteAllThumbnails && !dryRun) {
                        try {
                            const thumbnailsDir = path.join(__dirname, 'thumbnails');
                            // Clean each size subdirectory
                            const sizes = ['64', '128', '256', '512', '1024', '2048'];
                            for (const size of sizes) {
                                const sizeDir = path.join(thumbnailsDir, size);
                                try {
                                    const thumbnailFiles = await fs.readdir(sizeDir);
                                    for (const file of thumbnailFiles) {
                                        try {
                                            await fs.unlink(path.join(sizeDir, file));
                                            thumbnailsDeleted++;
                                        } catch (error) {
                                            console.error(`Failed to delete thumbnail: ${file}`, error);
                                        }
                                    }
                                } catch (error) {
                                    // Directory might not exist
                                    if (error.code !== 'ENOENT') {
                                        console.error(`Failed to read thumbnail directory ${size}:`, error);
                                    }
                                }
                            }
                            console.log(`✅ Deleted ${thumbnailsDeleted} thumbnails`);
                        } catch (error) {
                            console.error('Failed to clean thumbnails directory:', error);
                        }
                    }
                    
                    // 4. Clean up transcodes directory
                    if (!dryRun) {
                        try {
                            const transcodesDir = path.join(__dirname, 'transcodes');
                            try {
                                const transcodeFiles = await fs.readdir(transcodesDir);
                                // Delete transcodes for orphaned files
                                for (const file of transcodeFiles) {
                                    const baseName = path.parse(file).name;
                                    // Check if this transcode belongs to an orphaned file
                                    const isOrphaned = orphanedFiles.some(f => 
                                        path.parse(f.filename).name === baseName
                                    );
                                    if (isOrphaned) {
                                        try {
                                            await fs.unlink(path.join(transcodesDir, file));
                                            transcodesDeleted++;
                                        } catch (error) {
                                            console.error(`Failed to delete transcode: ${file}`, error);
                                        }
                                    }
                                }
                                console.log(`✅ Deleted ${transcodesDeleted} orphaned transcodes`);
                            } catch (error) {
                                // Directory might not exist
                                if (error.code !== 'ENOENT') {
                                    console.error('Failed to read transcodes directory:', error);
                                }
                            }
                        } catch (error) {
                            console.error('Failed to clean transcodes directory:', error);
                        }
                    }
                    
                    // 5. Run VACUUM to reclaim space (only if not dry run)
                    let beforeSize = 0;
                    let afterSize = 0;
                    
                    if (!dryRun) {
                        try {
                            // Get database size before VACUUM
                            const dbPath = path.join(__dirname, 'database', 'canvas.db');
                            const statsBefore = await fs.stat(dbPath);
                            beforeSize = statsBefore.size;
                            
                            console.log('🔧 Running VACUUM to reclaim database space...');
                            await this.db.run('VACUUM');
                            
                            // Get database size after VACUUM
                            const statsAfter = await fs.stat(dbPath);
                            afterSize = statsAfter.size;
                            
                            const savedBytes = beforeSize - afterSize;
                            const savedMB = (savedBytes / (1024 * 1024)).toFixed(2);
                            console.log(`✅ VACUUM completed. Saved ${savedMB} MB (${beforeSize} → ${afterSize} bytes)`);
                        } catch (error) {
                            console.error('Failed to run VACUUM:', error);
                        }
                    }
                    
                    // Return results
                    const result = {
                        success: true,
                        fileCleanup: {
                            referencedFiles: referencedFiles.size,
                            orphanedFiles: orphanedFiles.length,
                            orphanedDiskFiles: orphanedDiskFiles,
                            deletedFiles: dryRun ? 0 : filesDeleted
                        },
                        operationsDeleted: dryRun ? operationsToDelete : operationsDeleted,
                        thumbnailsDeleted: dryRun ? 0 : thumbnailsDeleted,
                        transcodesDeleted: dryRun ? 0 : transcodesDeleted,
                        databaseSizeBefore: beforeSize,
                        databaseSizeAfter: afterSize,
                        spaceSaved: beforeSize - afterSize,
                        message: dryRun ? 
                            `Dry run completed. Would delete ${orphanedFiles.length + orphanedDiskFiles} files (${orphanedFiles.length} from DB, ${orphanedDiskFiles} from disk).` : 
                            `Cleanup completed. Deleted ${filesDeleted} files (${orphanedFiles.length} from DB, ${orphanedDiskFiles} from disk), ${operationsDeleted} operations, ${thumbnailsDeleted} thumbnails, ${transcodesDeleted} transcodes.`
                    };
                    
                    console.log('✅ Cleanup completed:', result);
                    res.json(result);
                    
                } catch (error) {
                    console.error('❌ File cleanup failed:', error);
                    res.status(500).json({ 
                        error: 'File cleanup failed', 
                        details: error.message 
                    });
                }
                
            } catch (error) {
                console.error('❌ Cleanup failed:', error);
                res.status(500).json({ 
                    error: 'Cleanup failed', 
                    details: error.message 
                });
            }
        })
        
        // Debug endpoint for complete database wipe
        this.app.post('/debug/wipe-database', async (req, res) => {
            try {
                const { confirm, includeFiles } = req.body;
                
                if (!confirm) {
                    return res.status(400).json({ error: 'Confirmation required' });
                }
                
                console.log('🚨 COMPLETE DATABASE WIPE REQUESTED');
                
                const results = {
                    database: false,
                    files: false,
                    thumbnails: false,
                    transcodes: false,
                    errors: []
                };
                
                // 1. Drop all database tables
                try {
                    console.log('📊 Starting database deletion...');
                    
                    // First, close all active connections from collaboration manager
                    if (this.collaborationManager) {
                        console.log('🔌 Disconnecting all active clients...');
                        this.io.emit('server_shutdown', { reason: 'Database wipe in progress' });
                        await new Promise(resolve => setTimeout(resolve, 100)); // Give clients time to disconnect
                    }
                    
                    // Check canvas count before deletion
                    const beforeCount = await this.db.get('SELECT COUNT(*) as count FROM canvases');
                    console.log(`📊 Canvases before wipe: ${beforeCount.count}`);
                    
                    // Set a shorter timeout for database operations
                    await this.db.run('PRAGMA busy_timeout = 5000'); // 5 seconds
                    
                    // Disable foreign key constraints temporarily
                    await this.db.run('PRAGMA foreign_keys = OFF');
                    
                    // Start a transaction for all deletions
                    await this.db.run('BEGIN IMMEDIATE TRANSACTION');
                    
                    try {
                        // Delete in correct order to avoid foreign key violations
                        // Child tables first
                        console.log('Deleting active_sessions...');
                        await this.db.run('DELETE FROM active_sessions');
                        
                        console.log('Deleting active_transactions...');
                        await this.db.run('DELETE FROM active_transactions');
                    
                    console.log('Deleting operations...');
                    await this.db.run('DELETE FROM operations');
                    
                    console.log('Deleting files...');
                    await this.db.run('DELETE FROM files');
                    
                    console.log('Deleting canvas_versions...');
                    await this.db.run('DELETE FROM canvas_versions');
                    
                    console.log('Deleting canvas_collaborators...');
                    await this.db.run('DELETE FROM canvas_collaborators');
                    
                    // Parent table last
                    console.log('Deleting canvases...');
                    const deleteResult = await this.db.run('DELETE FROM canvases');
                    console.log('Delete result:', deleteResult);
                    
                    // Delete users table if it exists
                    try {
                        console.log('Deleting users...');
                        await this.db.run('DELETE FROM users');
                    } catch (e) {
                        // Users table might not exist
                        console.log('Users table not found or already empty');
                    }
                    
                    // Reset auto-increment counters
                    console.log('Resetting auto-increment counters...');
                    await this.db.run("DELETE FROM sqlite_sequence");
                    
                    // Clear in-memory state as well
                    if (this.collaborationManager && this.collaborationManager.stateManager) {
                        console.log('Clearing in-memory canvas states...');
                        this.collaborationManager.stateManager.canvasStates.clear();
                        this.collaborationManager.stateManager.stateVersions.clear();
                    }
                    
                    // Skip VACUUM if database is large - it can take forever
                    // Instead just checkpoint the WAL
                    console.log('Checkpointing WAL...');
                    try {
                        await this.db.run('PRAGMA wal_checkpoint(TRUNCATE)');
                    } catch (e) {
                        console.warn('WAL checkpoint failed (non-critical):', e.message);
                    }
                    
                        // Commit the transaction
                        await this.db.run('COMMIT');
                        console.log('✅ Transaction committed');
                    } catch (txError) {
                        // Rollback on error
                        await this.db.run('ROLLBACK');
                        throw txError;
                    } finally {
                        // Re-enable foreign key constraints
                        await this.db.run('PRAGMA foreign_keys = ON');
                    }
                    
                    // Check canvas count after deletion
                    const afterCount = await this.db.get('SELECT COUNT(*) as count FROM canvases');
                    console.log(`📊 Canvases after wipe: ${afterCount.count}`);
                    
                    // Also log actual canvases to verify
                    const remainingCanvases = await this.db.all('SELECT id, name FROM canvases');
                    if (remainingCanvases.length > 0) {
                        console.log(`⚠️ WARNING: ${remainingCanvases.length} canvases still exist after wipe:`, remainingCanvases);
                    }
                    
                    results.database = true;
                    results.canvasesDeleted = beforeCount.count;
                    results.canvasesRemaining = afterCount.count;
                    console.log('✅ Database tables cleared');
                } catch (error) {
                    console.error('❌ Database wipe failed:', error);
                    results.errors.push(`Database: ${error.message}`);
                }
                
                if (includeFiles) {
                    // 2. Delete all uploaded files
                    try {
                        const uploadsDir = path.join(__dirname, 'uploads');
                        const files = await fs.readdir(uploadsDir);
                        for (const file of files) {
                            try {
                                await fs.unlink(path.join(uploadsDir, file));
                            } catch (e) {
                                // Ignore individual file errors
                            }
                        }
                        results.files = true;
                        console.log(`✅ Deleted ${files.length} uploaded files`);
                    } catch (error) {
                        console.error('❌ Failed to delete uploads:', error);
                        results.errors.push(`Uploads: ${error.message}`);
                    }
                    
                    // 3. Delete all thumbnails
                    try {
                        const thumbnailsDir = path.join(__dirname, 'thumbnails');
                        const sizes = ['64', '128', '256', '512', '1024', '2048'];
                        let totalDeleted = 0;
                        
                        for (const size of sizes) {
                            try {
                                const sizeDir = path.join(thumbnailsDir, size);
                                const files = await fs.readdir(sizeDir);
                                for (const file of files) {
                                    try {
                                        await fs.unlink(path.join(sizeDir, file));
                                        totalDeleted++;
                                    } catch (e) {
                                        // Ignore individual file errors
                                    }
                                }
                            } catch (e) {
                                // Directory might not exist
                            }
                        }
                        results.thumbnails = true;
                        console.log(`✅ Deleted ${totalDeleted} thumbnails`);
                    } catch (error) {
                        console.error('❌ Failed to delete thumbnails:', error);
                        results.errors.push(`Thumbnails: ${error.message}`);
                    }
                    
                    // 4. Delete all transcoded videos
                    try {
                        const transcodesDir = path.join(__dirname, 'transcodes');
                        try {
                            const files = await fs.readdir(transcodesDir);
                            for (const file of files) {
                                try {
                                    await fs.unlink(path.join(transcodesDir, file));
                                } catch (e) {
                                    // Ignore individual file errors
                                }
                            }
                            results.transcodes = true;
                            console.log(`✅ Deleted ${files.length} transcoded files`);
                        } catch (e) {
                            // Directory might not exist
                            if (e.code !== 'ENOENT') {
                                throw e;
                            }
                        }
                    } catch (error) {
                        console.error('❌ Failed to delete transcodes:', error);
                        results.errors.push(`Transcodes: ${error.message}`);
                    }
                }
                
                console.log('🏁 Database wipe complete');
                
                // Send response immediately
                res.json({
                    success: true,
                    results,
                    message: 'Database wiped successfully'
                });
                
                // Note: Collaboration manager will handle reconnections automatically
                // when clients refresh their pages
                
            } catch (error) {
                console.error('❌ Database wipe error:', error);
                res.status(500).json({ 
                    error: 'Database wipe failed', 
                    details: error.message 
                });
            }
        });
        
        // API placeholder routes
        this.app.use('/api/canvases', (req, res) => {
            res.json({ message: 'Canvas API coming soon', status: 'placeholder' });
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
                fileSize: 500 * 1024 * 1024 // 500MB limit for large videos
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

    async generateThumbnails(filePath, filename, requestedSizes = null) {
        const thumbnailSizes = requestedSizes || [64, 128, 256, 512, 1024, 2048];
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
            console.log('📊 Setting up database...');
            const dbPath = path.join(__dirname, 'database', 'canvas.db');
            console.log('📊 Database path:', dbPath);
            
            this.db = new Database(dbPath);
            console.log('📊 Database instance created');
            
            await this.db.init();
            console.log('✅ Database initialized successfully');
            
        } catch (error) {
            console.error('❌ Database initialization failed:', error);
            console.error('Stack trace:', error.stack);
            // Re-throw to prevent server from starting without database
            throw error;
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
            const canvases = await this.db.all(`
                SELECT canvas_data FROM canvases 
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
            
            for (const canvas of canvases) {
                try {
                    const canvasData = JSON.parse(canvas.canvas_data);
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
            
            // Setup automated cleanup interval (every 6 hours)
            this.setupAutomatedCleanup();
            
            // Initialize video processor
            this.videoProcessor = new VideoProcessor({
                deleteOriginal: true,
                maxWidth: 1920,
                maxHeight: 1080
            });
            
            // Make server instance globally available for collaboration manager
            global.imageCanvasServer = this;
            
            // Pass Socket.io instance for real-time progress
            this.videoProcessor.setSocketIO(this.io);
            
            // Listen for video processing progress
            this.videoProcessor.on('progress', (data) => {
                console.log(`🎬 Video conversion progress: ${data.file} (${data.format}): ${data.percent.toFixed(1)}%`);
            });
            
            this.setupRealtime();
            
            // ✅ Startup cleanup logic addressed via CleanupManager and proper file tracking
            // Cleanup is now handled by the client-side CleanupManager with proper validation
            // setTimeout(() => {
            //     this.performStartupCleanup().catch(err => {
            //         console.error('Startup cleanup error:', err);
            //     });
            // }, 2000);
            
            this.server.listen(this.port, () => {
                console.log(`🚀 Server running at http://localhost:${this.port}`);
                console.log(`📁 Upload directory: ${this.uploadDir}`);
                console.log(`🎬 Video processing enabled with formats: ${this.videoProcessor.config.outputFormats.join(', ')}`);
            });
        } catch (error) {
            console.error('❌ Failed to start server:', error);
            process.exit(1);
        }
    }
    
    async stop() {
        // Clear cleanup interval
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        
        if (this.db) {
            await this.db.close();
        }
        this.server.close();
        
    }
    
    /**
     * Setup automated cleanup that runs periodically
     */
    setupAutomatedCleanup() {
        // Run cleanup every 6 hours
        const CLEANUP_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
        
        // Also run initial cleanup after 30 minutes to clean up any startup issues
        // Increased delay to allow video processing to complete
        setTimeout(() => {
            this.performAutomatedCleanup();
        }, 30 * 60 * 1000); // 30 minutes
        
        // Setup recurring cleanup
        this.cleanupInterval = setInterval(() => {
            this.performAutomatedCleanup();
        }, CLEANUP_INTERVAL);
        
        console.log('✅ Automated cleanup scheduled (every 6 hours)');
    }
    
    /**
     * Perform automated cleanup
     */
    async performAutomatedCleanup() {
        console.log('🤖 Starting automated cleanup...');
        
        try {
            // Create a mock request/response for the cleanup endpoint
            const mockReq = {
                query: {
                    dryRun: 'false',
                    deleteAllThumbnails: 'false'
                }
            };
            
            const mockRes = {
                status: () => mockRes,
                json: (result) => {
                    if (result.success) {
                        console.log('✅ Automated cleanup completed:', result.message);
                        
                        // Log detailed results
                        if (result.fileCleanup) {
                            console.log(`  - Referenced files: ${result.fileCleanup.referencedFiles}`);
                            console.log(`  - Deleted files: ${result.fileCleanup.deletedFiles}`);
                        }
                        if (result.operationsDeleted > 0) {
                            console.log(`  - Deleted operations: ${result.operationsDeleted}`);
                        }
                        if (result.spaceSaved > 0) {
                            const savedMB = (result.spaceSaved / (1024 * 1024)).toFixed(2);
                            console.log(`  - Space saved: ${savedMB} MB`);
                        }
                    } else {
                        console.error('❌ Automated cleanup failed:', result.error);
                    }
                }
            };
            
            // Call the cleanup endpoint handler directly
            await this.app._router.stack
                .find(layer => layer.route && layer.route.path === '/database/cleanup')
                .route.stack[0].handle(mockReq, mockRes);
                
        } catch (error) {
            console.error('❌ Automated cleanup error:', error);
        }
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
