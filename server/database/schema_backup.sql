CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                display_name TEXT,
                avatar_path TEXT,
                last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                owner_id INTEGER NOT NULL REFERENCES users(id),
                canvas_data JSON,
                thumbnail_path TEXT,
                last_modified DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
CREATE TABLE project_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                version_number INTEGER NOT NULL,
                canvas_data JSON NOT NULL,
                changes_summary TEXT,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
CREATE TABLE project_collaborators (
                project_id INTEGER NOT NULL REFERENCES projects(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                permission TEXT CHECK(permission IN ('read', 'write', 'admin')) DEFAULT 'write',
                invited_by INTEGER REFERENCES users(id),
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (project_id, user_id)
            );
CREATE TABLE operations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                operation_type TEXT NOT NULL,
                operation_data JSON NOT NULL,
                sequence_number INTEGER NOT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            , transaction_id TEXT, undo_data JSON, state TEXT DEFAULT 'applied' CHECK(state IN ('applied', 'undone')), undone_at DATETIME, undone_by INTEGER REFERENCES users(id), redone_at DATETIME, redone_by INTEGER REFERENCES users(id), operation_id TEXT);
CREATE TABLE files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                original_name TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                file_hash TEXT NOT NULL,
                uploaded_by INTEGER NOT NULL REFERENCES users(id),
                project_id INTEGER REFERENCES projects(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            , processed_formats TEXT, processing_status TEXT DEFAULT "pending" CHECK(processing_status IN ("pending", "processing", "completed", "failed")), processing_started_at DATETIME, processing_completed_at DATETIME, processing_error TEXT);
CREATE TABLE active_sessions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                project_id INTEGER REFERENCES projects(id),
                socket_id TEXT NOT NULL,
                cursor_position JSON,
                selection_data JSON,
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
            );
CREATE TABLE canvases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                data JSON NOT NULL,
                version INTEGER DEFAULT 1,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(project_id)
            );
CREATE TABLE active_transactions (
                        id TEXT PRIMARY KEY,
                        project_id INTEGER NOT NULL REFERENCES projects(id),
                        user_id INTEGER NOT NULL REFERENCES users(id),
                        source TEXT,
                        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        operation_count INTEGER DEFAULT 0,
                        state TEXT DEFAULT 'active' CHECK(state IN ('active', 'committed', 'aborted'))
                    );
CREATE INDEX idx_projects_owner ON projects(owner_id);
CREATE INDEX idx_project_versions_project ON project_versions(project_id);
CREATE INDEX idx_operations_project_sequence ON operations(project_id, sequence_number);
CREATE INDEX idx_files_hash ON files(file_hash);
CREATE INDEX idx_active_sessions_project ON active_sessions(project_id);
CREATE INDEX idx_active_sessions_user ON active_sessions(user_id);
CREATE INDEX idx_canvases_project ON canvases(project_id);
CREATE INDEX idx_operations_transaction ON operations(transaction_id);
CREATE INDEX idx_operations_state ON operations(state);
CREATE INDEX idx_operations_user_state ON operations(user_id, state);
CREATE INDEX idx_active_transactions_user ON active_transactions(user_id, state);
CREATE INDEX idx_active_transactions_project ON active_transactions(project_id);
