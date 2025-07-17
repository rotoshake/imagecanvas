const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');

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
    const collab = require('./src/realtime/collaboration');
    CollaborationManager = collab.CollaborationManager;
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
                origin: ["http://localhost:8000", "http://127.0.0.1:8000"],
                methods: ["GET", "POST"],
                credentials: true
            }
        });
        
        this.port = process.env.PORT || 3000;
        this.db = null;
        this.collaborationManager = null;
        
        this.setupMiddleware();
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
            origin: ["http://localhost:8000", "http://127.0.0.1:8000"],
            credentials: true
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
                features: {
                    database: this.db ? 'ready' : 'placeholder',
                    collaboration: this.collaborationManager ? 'ready' : 'placeholder',
                    websockets: 'ready'
                }
            });
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
        
        // WebSocket test endpoint
        this.app.get('/test-websocket', (req, res) => {
            res.send(`
                <!DOCTYPE html>
                <html>
                <head><title>WebSocket Test</title></head>
                <body>
                    <h1>ImageCanvas WebSocket Test</h1>
                    <div id="status">Connecting...</div>
                    <div id="messages"></div>
                    <script src="/socket.io/socket.io.js"></script>
                    <script>
                        const socket = io();
                        const status = document.getElementById('status');
                        const messages = document.getElementById('messages');
                        
                        socket.on('connect', () => {
                            status.textContent = 'Connected to ImageCanvas server!';
                            status.style.color = 'green';
                        });
                        
                        socket.on('disconnect', () => {
                            status.textContent = 'Disconnected';
                            status.style.color = 'red';
                        });
                        
                        socket.on('test_response', (data) => {
                            messages.innerHTML += '<p>Server: ' + JSON.stringify(data) + '</p>';
                        });
                        
                        // Test message
                        setTimeout(() => {
                            socket.emit('test_message', { message: 'Hello from client!' });
                        }, 1000);
                    </script>
                </body>
                </html>
            `);
        });
        
        // Fallback route
        this.app.use('*', (req, res) => {
            res.status(404).json({ error: 'Endpoint not found' });
        });
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
                console.log(`🎯 Ready for Phase 2 development!`);
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