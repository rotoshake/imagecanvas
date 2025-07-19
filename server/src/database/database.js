const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;

class Database {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.db = null;
    }
    
    async init() {
        // Ensure database directory exists
        const dbDir = path.dirname(this.dbPath);
        await fs.mkdir(dbDir, { recursive: true });
        
        // Open database connection
        this.db = new sqlite3.Database(this.dbPath);
        
        // Configure SQLite for optimal performance
        await this.run('PRAGMA journal_mode = WAL');
        await this.run('PRAGMA synchronous = NORMAL');
        await this.run('PRAGMA cache_size = 10000');
        await this.run('PRAGMA foreign_keys = ON');
        await this.run('PRAGMA temp_store = MEMORY');
        
        // Initialize schema
        await this.createTables();
        
        console.log('✅ Database configured with WAL mode and optimizations');
    }
    
    async createTables() {
        const schema = `
            -- Users table
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                display_name TEXT,
                avatar_path TEXT,
                last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Projects table
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                owner_id INTEGER NOT NULL REFERENCES users(id),
                canvas_data JSON,
                thumbnail_path TEXT,
                last_modified DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Project versions for history/undo functionality
            CREATE TABLE IF NOT EXISTS project_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                version_number INTEGER NOT NULL,
                canvas_data JSON NOT NULL,
                changes_summary TEXT,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Project collaborators
            CREATE TABLE IF NOT EXISTS project_collaborators (
                project_id INTEGER NOT NULL REFERENCES projects(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                permission TEXT CHECK(permission IN ('read', 'write', 'admin')) DEFAULT 'write',
                invited_by INTEGER REFERENCES users(id),
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (project_id, user_id)
            );
            
            -- Real-time operations log for conflict resolution
            CREATE TABLE IF NOT EXISTS operations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id),
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
                project_id INTEGER REFERENCES projects(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Active sessions for real-time presence
            CREATE TABLE IF NOT EXISTS active_sessions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                project_id INTEGER REFERENCES projects(id),
                socket_id TEXT NOT NULL,
                cursor_position JSON,
                selection_data JSON,
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Indexes for performance
            CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
            CREATE INDEX IF NOT EXISTS idx_project_versions_project ON project_versions(project_id);
            CREATE INDEX IF NOT EXISTS idx_operations_project_sequence ON operations(project_id, sequence_number);
            CREATE INDEX IF NOT EXISTS idx_files_hash ON files(file_hash);
            CREATE INDEX IF NOT EXISTS idx_active_sessions_project ON active_sessions(project_id);
            CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id);
        `;
        
        await this.exec(schema);
        console.log('✅ Database schema created/updated');
        
        // Create default user if it doesn't exist
        const defaultUser = await this.get('SELECT * FROM users WHERE id = 1');
        if (!defaultUser) {
            await this.run(
                'INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)',
                [1, 'default', 'Default User']
            );
            console.log('✅ Default user created');
        }
    }
    
    // Promisified database methods
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }
    
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
    
    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
    
    exec(sql) {
        return new Promise((resolve, reject) => {
            this.db.exec(sql, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
    
    // Transaction support
    async transaction(callback) {
        await this.run('BEGIN TRANSACTION');
        try {
            const result = await callback(this);
            await this.run('COMMIT');
            return result;
        } catch (error) {
            await this.run('ROLLBACK');
            throw error;
        }
    }
    
    // Utility methods for common operations
    async createUser(username, displayName = null, avatarPath = null) {
        const result = await this.run(
            'INSERT INTO users (username, display_name, avatar_path) VALUES (?, ?, ?)',
            [username, displayName, avatarPath]
        );
        return result.lastID;
    }
    
    async getUser(id) {
        return await this.get('SELECT * FROM users WHERE id = ?', [id]);
    }
    
    async getUserByUsername(username) {
        return await this.get('SELECT * FROM users WHERE username = ?', [username]);
    }
    
    async createProject(name, ownerId, description = null, canvasData = null) {
        const result = await this.run(
            'INSERT INTO projects (name, owner_id, description, canvas_data) VALUES (?, ?, ?, ?)',
            [name, ownerId, description, JSON.stringify(canvasData)]
        );
        return result.lastID;
    }
    
    async getProject(id) {
        const project = await this.get('SELECT * FROM projects WHERE id = ?', [id]);
        if (project && project.canvas_data) {
            project.canvas_data = JSON.parse(project.canvas_data);
        }
        return project;
    }
    
    async updateProject(id, updates) {
        const fields = [];
        const values = [];
        
        for (const [key, value] of Object.entries(updates)) {
            if (key === 'canvas_data') {
                fields.push(`${key} = ?`);
                values.push(JSON.stringify(value));
            } else {
                fields.push(`${key} = ?`);
                values.push(value);
            }
        }
        
        fields.push('last_modified = CURRENT_TIMESTAMP');
        values.push(id);
        
        await this.run(
            `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`,
            values
        );
    }
    
    async addOperation(projectId, userId, operationType, operationData, sequenceNumber) {
        await this.run(
            'INSERT INTO operations (project_id, user_id, operation_type, operation_data, sequence_number) VALUES (?, ?, ?, ?, ?)',
            [projectId, userId, operationType, JSON.stringify(operationData), sequenceNumber]
        );
    }
    
    async getOperationsSince(projectId, sequenceNumber) {
        const operations = await this.all(
            'SELECT * FROM operations WHERE project_id = ? AND sequence_number > ? ORDER BY sequence_number',
            [projectId, sequenceNumber]
        );
        
        return operations.map(op => ({
            ...op,
            operation_data: JSON.parse(op.operation_data)
        }));
    }
    
    async cleanup() {
        // Clean up old operations (keep last 1000 per project)
        await this.run(`
            DELETE FROM operations 
            WHERE id NOT IN (
                SELECT id FROM operations 
                WHERE project_id = operations.project_id 
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
    
    async close() {
        if (this.db) {
            await this.cleanup();
            this.db.close();
            this.db = null;
            console.log('📊 Database connection closed');
        }
    }
}

module.exports = Database; 