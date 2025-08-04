const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

async function debugDatabase() {
    const dbPath = path.join(__dirname, 'database', 'canvas.db');
    console.log('Database path:', dbPath);
    
    // Check if directory exists
    const dbDir = path.dirname(dbPath);
    console.log('Database directory:', dbDir);
    console.log('Directory exists:', fs.existsSync(dbDir));
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(dbDir)) {
        console.log('Creating directory...');
        fs.mkdirSync(dbDir, { recursive: true });
    }
    
    console.log('Creating SQLite database...');
    
    // Create database with verbose logging
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
            console.error('Error opening database:', err);
        } else {
            console.log('Database opened successfully');
        }
    });
    
    // Try to create a simple table
    db.serialize(() => {
        db.run("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)", (err) => {
            if (err) {
                console.error('Error creating table:', err);
            } else {
                console.log('Test table created');
            }
        });
        
        // Check if file exists after creation
        setTimeout(() => {
            console.log('Database file exists:', fs.existsSync(dbPath));
            console.log('Files in directory:', fs.readdirSync(dbDir));
            
            db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                } else {
                    console.log('Database closed');
                }
            });
        }, 1000);
    });
}

debugDatabase();