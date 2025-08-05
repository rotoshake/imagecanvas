const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs').promises;

class BetterDatabase {
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
        this.createTables();

    }
    
    createTables() {
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
            
            -- Canvas collaborators
            CREATE TABLE IF NOT EXISTS canvas_collaborators (
                canvas_id INTEGER NOT NULL REFERENCES canvases(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (canvas_id, user_id)
            );
            
            -- Sessions table
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_active DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Operations log for collaboration
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
                uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Indices for performance
            CREATE INDEX IF NOT EXISTS idx_operations_canvas_sequence 
                ON operations(canvas_id, sequence_number);
            CREATE INDEX IF NOT EXISTS idx_collaborators_user 
                ON canvas_collaborators(user_id);
            CREATE INDEX IF NOT EXISTS idx_files_canvas 
                ON files(canvas_id);
            CREATE INDEX IF NOT EXISTS idx_files_hash 
                ON files(file_hash);
            CREATE INDEX IF NOT EXISTS idx_sessions_user 
                ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_canvases_owner 
                ON canvases(owner_id);
        `;
        
        this.db.exec(schema);
        
        this.initializeDefaultData();
    }
    
    initializeDefaultData() {
        // Create default user if not exists
        const defaultUserExists = this.db.prepare(
            'SELECT id FROM users WHERE id = 1'
        ).get();
        
        if (!defaultUserExists) {
            this.db.prepare(
                'INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)'
            ).run(1, 'system', 'System User');
        }
        
        // Create default canvas if not exists
        const defaultCanvasExists = this.db.prepare(
            'SELECT id FROM canvases WHERE id = 1'
        ).get();
        
        if (!defaultCanvasExists) {
            this.db.prepare(
                'INSERT INTO canvases (id, name, description, owner_id, canvas_data, thumbnail_path) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(1, 'Welcome Canvas', 'Your first collaborative canvas', 1, '{}', null);
        }

    }
    
    // User management
    async createUser(username, displayName = null) {
        const stmt = this.db.prepare(
            'INSERT INTO users (username, display_name) VALUES (?, ?)'
        );
        const result = stmt.run(username, displayName || username);
        return result.lastInsertRowid;
    }
    
    async getUser(userId) {
        return this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    }
    
    async getUserByUsername(username) {
        return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    }
    
    // Canvas management
    async createCanvas(name, description, ownerId, canvasData = {}) {
        const stmt = this.db.prepare(
            'INSERT INTO canvases (name, description, owner_id, canvas_data) VALUES (?, ?, ?, ?)'
        );
        const result = stmt.run(name, description, ownerId, JSON.stringify(canvasData));
        return result.lastInsertRowid;
    }
    
    async getCanvas(canvasId) {
        const canvas = this.db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId);
        if (canvas && canvas.canvas_data) {
            canvas.canvas_data = JSON.parse(canvas.canvas_data);
        }
        return canvas;
    }
    
    async getAllCanvases() {
        const canvases = this.db.prepare('SELECT * FROM canvases ORDER BY last_modified DESC').all();
        return canvases.map(canvas => {
            if (canvas.canvas_data) {
                canvas.canvas_data = JSON.parse(canvas.canvas_data);
            }
            return canvas;
        });
    }
    
    async updateCanvas(canvasId, updates) {
        const fields = [];
        const values = [];
        
        if (updates.name !== undefined) {
            fields.push('name = ?');
            values.push(updates.name);
        }
        if (updates.description !== undefined) {
            fields.push('description = ?');
            values.push(updates.description);
        }
        if (updates.canvas_data !== undefined) {
            fields.push('canvas_data = ?');
            values.push(JSON.stringify(updates.canvas_data));
        }
        if (updates.thumbnail_path !== undefined) {
            fields.push('thumbnail_path = ?');
            values.push(updates.thumbnail_path);
        }
        
        fields.push('last_modified = CURRENT_TIMESTAMP');
        values.push(canvasId);
        
        const stmt = this.db.prepare(
            `UPDATE canvases SET ${fields.join(', ')} WHERE id = ?`
        );
        stmt.run(...values);
    }
    
    async deleteCanvas(canvasId) {
        // Delete related data first (due to foreign keys)
        this.db.prepare('DELETE FROM operations WHERE canvas_id = ?').run(canvasId);
        this.db.prepare('DELETE FROM canvas_collaborators WHERE canvas_id = ?').run(canvasId);
        this.db.prepare('UPDATE files SET canvas_id = NULL WHERE canvas_id = ?').run(canvasId);
        this.db.prepare('DELETE FROM canvases WHERE id = ?').run(canvasId);
    }
    
    // Collaboration management
    async addCollaborator(canvasId, userId, role = 'editor') {
        const stmt = this.db.prepare(
            'INSERT OR REPLACE INTO canvas_collaborators (canvas_id, user_id, role) VALUES (?, ?, ?)'
        );
        stmt.run(canvasId, userId, role);
    }
    
    async removeCollaborator(canvasId, userId) {
        this.db.prepare(
            'DELETE FROM canvas_collaborators WHERE canvas_id = ? AND user_id = ?'
        ).run(canvasId, userId);
    }
    
    async getCollaborators(canvasId) {
        return this.db.prepare(`
            SELECT u.*, cc.role, cc.added_at 
            FROM canvas_collaborators cc 
            JOIN users u ON cc.user_id = u.id 
            WHERE cc.canvas_id = ?
        `).all(canvasId);
    }
    
    async canUserAccessCanvas(userId, canvasId) {
        const canvas = await this.getCanvas(canvasId);
        if (!canvas) return false;
        if (canvas.owner_id === userId) return true;
        
        const collaborator = this.db.prepare(
            'SELECT role FROM canvas_collaborators WHERE canvas_id = ? AND user_id = ?'
        ).get(canvasId, userId);
        
        return !!collaborator;
    }
    
    // File management
    async saveFileMetadata(fileData) {
        const stmt = this.db.prepare(
            'INSERT INTO files (filename, original_name, mime_type, file_size, file_hash, uploaded_by, canvas_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        const result = stmt.run(
            fileData.filename,
            fileData.originalName,
            fileData.mimeType,
            fileData.fileSize,
            fileData.fileHash,
            fileData.uploadedBy,
            fileData.canvasId || null
        );
        return result.lastInsertRowid;
    }
    
    async getFileMetadata(fileId) {
        return this.db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
    }
    
    async getFileByHash(fileHash) {
        return this.db.prepare('SELECT * FROM files WHERE file_hash = ?').get(fileHash);
    }
    
    // Operations log
    async logOperation(canvasId, userId, operationType, operationData) {
        // Get next sequence number for this canvas
        const lastSeq = this.db.prepare(
            'SELECT MAX(sequence_number) as max_seq FROM operations WHERE canvas_id = ?'
        ).get(canvasId);
        
        const nextSeq = (lastSeq.max_seq || 0) + 1;
        
        const stmt = this.db.prepare(
            'INSERT INTO operations (canvas_id, user_id, operation_type, operation_data, sequence_number) VALUES (?, ?, ?, ?, ?)'
        );
        const result = stmt.run(canvasId, userId, operationType, JSON.stringify(operationData), nextSeq);
        
        return {
            id: result.lastInsertRowid,
            sequence_number: nextSeq
        };
    }
    
    async getOperations(canvasId, afterSequence = 0) {
        const operations = this.db.prepare(
            'SELECT * FROM operations WHERE canvas_id = ? AND sequence_number > ? ORDER BY sequence_number'
        ).all(canvasId, afterSequence);
        
        return operations.map(op => ({
            ...op,
            operation_data: JSON.parse(op.operation_data)
        }));
    }
    
    // Database info
    async getDatabaseSize() {
        const stats = await fs.stat(this.dbPath);
        return stats.size;
    }
    
    // Close database connection
    close() {
        if (this.db) {
            this.db.close();
            console.log('📊 Database connection closed');
        }
    }
}

module.exports = BetterDatabase;