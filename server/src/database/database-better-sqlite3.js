const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs').promises;

class DatabaseWrapper {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.db = null;
    }
    
    async init() {
        // Ensure database directory exists
        const dbDir = path.dirname(this.dbPath);
        await fs.mkdir(dbDir, { recursive: true });
        
        // Open database connection
        this.db = new Database(this.dbPath);
        
        // Configure SQLite for optimal performance
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('cache_size = 10000');
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('temp_store = MEMORY');
        
        // Initialize schema
        await this.createTables();
        console.log('✅ Database initialized with better-sqlite3');
    }
    
    async createTables() {
        const schema = `
            -- Users table
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                display_name TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Canvases table
            CREATE TABLE IF NOT EXISTS canvases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                owner_id INTEGER NOT NULL REFERENCES users(id),
                canvas_data JSON,
                thumbnail_path TEXT,
                last_modified DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Canvas versions for history/undo functionality
            CREATE TABLE IF NOT EXISTS canvas_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                canvas_id INTEGER NOT NULL REFERENCES canvases(id),
                version_number INTEGER NOT NULL,
                canvas_data JSON NOT NULL,
                changes_summary TEXT,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Canvas collaborators
            CREATE TABLE IF NOT EXISTS canvas_collaborators (
                canvas_id INTEGER NOT NULL REFERENCES canvases(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                permission TEXT CHECK(permission IN ('read', 'write', 'admin')) DEFAULT 'write',
                invited_by INTEGER REFERENCES users(id),
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (canvas_id, user_id)
            );
            
            -- Real-time operations log for conflict resolution
            CREATE TABLE IF NOT EXISTS operations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                canvas_id INTEGER NOT NULL REFERENCES canvases(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                operation_type TEXT NOT NULL,
                operation_data JSON NOT NULL,
                sequence_number INTEGER NOT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            -- File metadata for uploads
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                original_name TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                file_hash TEXT NOT NULL,
                uploaded_by INTEGER NOT NULL REFERENCES users(id),
                canvas_id INTEGER REFERENCES canvases(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Active sessions for real-time presence
            CREATE TABLE IF NOT EXISTS active_sessions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                canvas_id INTEGER REFERENCES canvases(id),
                socket_id TEXT,
                cursor_position TEXT,
                viewport_state TEXT,
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Create indexes for performance
            CREATE INDEX IF NOT EXISTS idx_canvas_owner ON canvases(owner_id);
            CREATE INDEX IF NOT EXISTS idx_canvas_versions ON canvas_versions(canvas_id);
            CREATE INDEX IF NOT EXISTS idx_operations_canvas ON operations(canvas_id);
            CREATE INDEX IF NOT EXISTS idx_files_canvas ON files(canvas_id);
            CREATE INDEX IF NOT EXISTS idx_files_hash ON files(file_hash);
            CREATE INDEX IF NOT EXISTS idx_active_sessions_canvas ON active_sessions(canvas_id);
        `;
        
        // Execute schema
        this.db.exec(schema);
        
        // Create default user
        const defaultUser = this.db.prepare('SELECT * FROM users WHERE id = 1').get();
        if (!defaultUser) {
            this.db.prepare(
                'INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)'
            ).run(1, 'default', 'Default User');
            console.log('✅ Created default user');
        }
    }
    
    // Adapter methods to match the original API
    run(sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            const result = stmt.run(...params);
            return Promise.resolve({ 
                lastID: result.lastInsertRowid, 
                changes: result.changes 
            });
        } catch (error) {
            return Promise.reject(error);
        }
    }
    
    get(sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            const result = stmt.get(...params);
            return Promise.resolve(result);
        } catch (error) {
            return Promise.reject(error);
        }
    }
    
    all(sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            const results = stmt.all(...params);
            return Promise.resolve(results);
        } catch (error) {
            return Promise.reject(error);
        }
    }
    
    async close() {
        if (this.db) {
            this.db.close();
            console.log('📊 Database connection closed');
        }
    }
    
    // Transaction support
    async transaction(callback) {
        const trx = this.db.transaction(async () => {
            return await callback(this);
        });
        try {
            const result = await trx();
            return result;
        } catch (error) {
            throw error;
        }
    }
    
    // Utility methods for common operations
    async createUser(username, displayName = null) {
        const result = await this.run(
            'INSERT INTO users (username, display_name) VALUES (?, ?)',
            [username, displayName]
        );
        return result.lastID;
    }
    
    async getUser(id) {
        return this.get('SELECT * FROM users WHERE id = ?', [id]);
    }
    
    async getUserById(id) {
        // Alias for backward compatibility
        return this.getUser(id);
    }
    
    async getUserByUsername(username) {
        return this.get('SELECT * FROM users WHERE username = ?', [username]);
    }
    
    async createCanvas(name, ownerId, description = null, canvasData = null) {
        const result = await this.run(
            'INSERT INTO canvases (name, owner_id, description, canvas_data) VALUES (?, ?, ?, ?)',
            [name, ownerId, description, JSON.stringify(canvasData)]
        );
        return result.lastID;
    }
    
    async getCanvas(id) {
        const canvas = await this.get('SELECT * FROM canvases WHERE id = ?', [id]);
        if (canvas && canvas.canvas_data) {
            canvas.canvas_data = JSON.parse(canvas.canvas_data);
        }
        return canvas;
    }
    
    async getCanvasById(id) {
        // Alias for backward compatibility
        return this.getCanvas(id);
    }
    
    async getAllCanvases() {
        const canvases = await this.all('SELECT * FROM canvases ORDER BY last_modified DESC');
        return canvases.map(canvas => {
            if (canvas.canvas_data) {
                canvas.canvas_data = JSON.parse(canvas.canvas_data);
            }
            return canvas;
        });
    }
    
    async updateCanvas(id, updates) {
        const fields = [];
        const values = [];
        
        for (const [key, value] of Object.entries(updates)) {
            fields.push(`${key} = ?`);
            values.push(key === 'canvas_data' ? JSON.stringify(value) : value);
        }
        
        fields.push('last_modified = CURRENT_TIMESTAMP');
        values.push(id);
        
        await this.run(
            `UPDATE canvases SET ${fields.join(', ')} WHERE id = ?`,
            values
        );
    }
    
    async addOperation(canvasId, userId, operationType, operationData, sequenceNumber) {
        await this.run(
            'INSERT INTO operations (canvas_id, user_id, operation_type, operation_data, sequence_number) VALUES (?, ?, ?, ?, ?)',
            [canvasId, userId, operationType, JSON.stringify(operationData), sequenceNumber]
        );
    }
    
    async getOperations(canvasId, afterSequence = 0) {
        const operations = await this.all(
            'SELECT * FROM operations WHERE canvas_id = ? AND sequence_number > ? ORDER BY sequence_number',
            [canvasId, afterSequence]
        );
        return operations.map(op => {
            op.operation_data = JSON.parse(op.operation_data);
            return op;
        });
    }
    
    async cleanup() {
        // Clean up old operations (keep last 1000 per canvas)
        await this.run(`
            DELETE FROM operations 
            WHERE id NOT IN (
                SELECT id FROM operations 
                WHERE canvas_id = operations.canvas_id 
                ORDER BY sequence_number DESC 
                LIMIT 1000
            )
        `);
        
        // Clean up inactive sessions (older than 1 hour)
        await this.run(
            "DELETE FROM active_sessions WHERE last_activity < datetime('now', '-1 hour')"
        );
        console.log('🧹 Database cleanup completed');
    }
}

module.exports = DatabaseWrapper;