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
                socket_id TEXT NOT NULL,
                cursor_position JSON,
                selection_data JSON,
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Canvas state for server-authoritative sync
            CREATE TABLE IF NOT EXISTS canvas_states (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                canvas_id INTEGER NOT NULL REFERENCES canvases(id),
                data JSON NOT NULL,
                version INTEGER DEFAULT 1,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(canvas_id)
            );
            
            -- Indexes for performance
            CREATE INDEX IF NOT EXISTS idx_canvases_owner ON canvases(owner_id);
            CREATE INDEX IF NOT EXISTS idx_canvas_versions_canvas ON canvas_versions(canvas_id);
            CREATE INDEX IF NOT EXISTS idx_operations_canvas_sequence ON operations(canvas_id, sequence_number);
            CREATE INDEX IF NOT EXISTS idx_files_hash ON files(file_hash);
            CREATE INDEX IF NOT EXISTS idx_active_sessions_canvas ON active_sessions(canvas_id);
            CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_canvas_states_canvas ON canvas_states(canvas_id);
        `;
        
        await this.exec(schema);
        
        // Apply undo system migrations
        await this.applyUndoMigrations();
        
        // Apply video processing migrations
        await this.applyVideoMigrations();
        
        // Create default user if it doesn't exist
        const defaultUser = await this.get('SELECT * FROM users WHERE id = 1');
        if (!defaultUser) {
            await this.run(
                'INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)',
                [1, 'default', 'Default User']
            );
            
        }
    }
    
    async applyUndoMigrations() {
        try {
            // Check if migrations have already been applied
            const columns = await this.all(`PRAGMA table_info(operations)`);
            const hasTransactionId = columns.some(col => col.name === 'transaction_id');
            
            if (!hasTransactionId) {
                
                // Add undo support columns to operations table
                await this.run('ALTER TABLE operations ADD COLUMN transaction_id TEXT');
                await this.run('ALTER TABLE operations ADD COLUMN undo_data JSON');
                await this.run(`ALTER TABLE operations ADD COLUMN state TEXT DEFAULT 'applied' CHECK(state IN ('applied', 'undone'))`);
                await this.run('ALTER TABLE operations ADD COLUMN undone_at DATETIME');
                await this.run('ALTER TABLE operations ADD COLUMN undone_by INTEGER REFERENCES users(id)');
                await this.run('ALTER TABLE operations ADD COLUMN redone_at DATETIME');
                await this.run('ALTER TABLE operations ADD COLUMN redone_by INTEGER REFERENCES users(id)');
                
                // Create indexes
                await this.run('CREATE INDEX IF NOT EXISTS idx_operations_transaction ON operations(transaction_id)');
                await this.run('CREATE INDEX IF NOT EXISTS idx_operations_state ON operations(state)');
                await this.run('CREATE INDEX IF NOT EXISTS idx_operations_user_state ON operations(user_id, state)');
                
                // Create active transactions table
                await this.run(`
                    CREATE TABLE IF NOT EXISTS active_transactions (
                        id TEXT PRIMARY KEY,
                        canvas_id INTEGER NOT NULL REFERENCES canvases(id),
                        user_id INTEGER NOT NULL REFERENCES users(id),
                        source TEXT,
                        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        operation_count INTEGER DEFAULT 0,
                        state TEXT DEFAULT 'active' CHECK(state IN ('active', 'committed', 'aborted'))
                    )
                `);
                
                await this.run('CREATE INDEX IF NOT EXISTS idx_active_transactions_user ON active_transactions(user_id, state)');
                await this.run('CREATE INDEX IF NOT EXISTS idx_active_transactions_canvas ON active_transactions(canvas_id)');

            }
        } catch (error) {
            console.error('⚠️ Error applying undo migrations:', error);
            // Non-fatal - the system can work without these columns
        }
    }
    
    async applyVideoMigrations() {
        try {
            // Check if video processing columns exist
            const columns = await this.all(`PRAGMA table_info(files)`);
            const hasProcessedFormats = columns.some(col => col.name === 'processed_formats');
            
            if (!hasProcessedFormats) {
                console.log('🎬 Applying video processing migrations...');
                
                // Add columns for video processing
                await this.run('ALTER TABLE files ADD COLUMN processed_formats TEXT');
                await this.run('ALTER TABLE files ADD COLUMN processing_status TEXT DEFAULT "pending" CHECK(processing_status IN ("pending", "processing", "completed", "failed"))');
                await this.run('ALTER TABLE files ADD COLUMN processing_started_at DATETIME');
                await this.run('ALTER TABLE files ADD COLUMN processing_completed_at DATETIME');
                await this.run('ALTER TABLE files ADD COLUMN processing_error TEXT');
                
                console.log('✅ Video processing migrations applied');
            }
        } catch (error) {
            console.error('⚠️ Error applying video migrations:', error);
            // Non-fatal - the system can work without these columns
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
    async createUser(username, displayName = null) {
        const result = await this.run(
            'INSERT INTO users (username, display_name) VALUES (?, ?)',
            [username, displayName]
        );
        return result.lastID;
    }
    
    async getUser(id) {
        return await this.get('SELECT * FROM users WHERE id = ?', [id]);
    }
    
    async getUserByUsername(username) {
        return await this.get('SELECT * FROM users WHERE username = ?', [username]);
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
    
    async updateCanvas(id, updates) {
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
    
    async getOperationsSince(canvasId, sequenceNumber) {
        const operations = await this.all(
            'SELECT * FROM operations WHERE canvas_id = ? AND sequence_number > ? ORDER BY sequence_number',
            [canvasId, sequenceNumber]
        );
        
        return operations.map(op => ({
            ...op,
            operation_data: JSON.parse(op.operation_data)
        }));
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

    }
    
    async close() {
        if (this.db) {
            await this.cleanup();
            this.db.close();
            this.db = null;
            
        }
    }
}

module.exports = Database; 