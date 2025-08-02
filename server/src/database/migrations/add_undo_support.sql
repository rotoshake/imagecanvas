-- Add undo support to operations table
ALTER TABLE operations ADD COLUMN transaction_id TEXT;
ALTER TABLE operations ADD COLUMN undo_data JSON;
ALTER TABLE operations ADD COLUMN state TEXT DEFAULT 'applied' CHECK(state IN ('applied', 'undone'));
ALTER TABLE operations ADD COLUMN undone_at DATETIME;
ALTER TABLE operations ADD COLUMN undone_by INTEGER REFERENCES users(id);
ALTER TABLE operations ADD COLUMN redone_at DATETIME;
ALTER TABLE operations ADD COLUMN redone_by INTEGER REFERENCES users(id);

-- Create index for transaction lookups
CREATE INDEX IF NOT EXISTS idx_operations_transaction ON operations(transaction_id);
CREATE INDEX IF NOT EXISTS idx_operations_state ON operations(state);
CREATE INDEX IF NOT EXISTS idx_operations_user_state ON operations(user_id, state);

-- Create table for tracking active transactions
CREATE TABLE IF NOT EXISTS active_transactions (
    id TEXT PRIMARY KEY,
    canvas_id INTEGER NOT NULL REFERENCES canvases(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    source TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    operation_count INTEGER DEFAULT 0,
    state TEXT DEFAULT 'active' CHECK(state IN ('active', 'committed', 'aborted'))
);

CREATE INDEX IF NOT EXISTS idx_active_transactions_user ON active_transactions(user_id, state);
CREATE INDEX IF NOT EXISTS idx_active_transactions_canvas ON active_transactions(canvas_id);