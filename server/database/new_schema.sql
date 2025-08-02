-- Canvas Schema with proper terminology
-- Drop existing tables if they exist
DROP TABLE IF EXISTS active_sessions;
DROP TABLE IF EXISTS active_transactions;
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS operations;
DROP TABLE IF EXISTS canvas_collaborators;
DROP TABLE IF EXISTS canvas_versions;
DROP TABLE IF EXISTS canvases;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS project_collaborators;
DROP TABLE IF EXISTS project_versions;
DROP TABLE IF EXISTS users;

-- Users table
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Canvases table (main table for canvas metadata)
CREATE TABLE canvases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    canvas_data JSON,
    thumbnail_path TEXT,
    last_modified DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Canvas versions table (for storing canvas state)
CREATE TABLE canvas_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canvas_id INTEGER NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    data JSON NOT NULL,
    version INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(canvas_id)
);

-- Canvas collaborators
CREATE TABLE canvas_collaborators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canvas_id INTEGER NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT DEFAULT 'editor',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(canvas_id, user_id)
);

-- Operations table (for undo/redo)
CREATE TABLE operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canvas_id INTEGER NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    data JSON NOT NULL,
    sequence_number INTEGER,
    transaction_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_undone BOOLEAN DEFAULT 0
);

-- Files table
CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT UNIQUE NOT NULL,
    original_name TEXT,
    mime_type TEXT,
    size INTEGER,
    canvas_id INTEGER REFERENCES canvases(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id),
    hash TEXT,
    width INTEGER,
    height INTEGER,
    processing_status TEXT DEFAULT 'pending',
    processed_formats JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Active sessions
CREATE TABLE active_sessions (
    socket_id TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    canvas_id INTEGER REFERENCES canvases(id),
    tab_id TEXT,
    connected_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Active transactions
CREATE TABLE active_transactions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    canvas_id INTEGER NOT NULL REFERENCES canvases(id),
    source TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_canvases_owner ON canvases(owner_id);
CREATE INDEX idx_canvas_versions_canvas ON canvas_versions(canvas_id);
CREATE INDEX idx_canvas_collaborators_canvas ON canvas_collaborators(canvas_id);
CREATE INDEX idx_canvas_collaborators_user ON canvas_collaborators(user_id);
CREATE INDEX idx_operations_canvas ON operations(canvas_id);
CREATE INDEX idx_operations_user ON operations(user_id);
CREATE INDEX idx_operations_sequence ON operations(canvas_id, sequence_number);
CREATE INDEX idx_files_canvas ON files(canvas_id);
CREATE INDEX idx_files_hash ON files(hash);
CREATE INDEX idx_active_sessions_user ON active_sessions(user_id);
CREATE INDEX idx_active_sessions_canvas ON active_sessions(canvas_id);