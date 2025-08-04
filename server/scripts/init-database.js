#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;

// Load the Database class
const Database = require('../src/database/database');

async function initDatabase() {
    try {
        console.log('🚀 Initializing ImageCanvas database...');
        
        // Ensure scripts directory exists
        const scriptsDir = path.dirname(__filename);
        await fs.mkdir(scriptsDir, { recursive: true });
        
        // Database path
        const dbPath = path.join(__dirname, '..', 'database', 'canvas.db');
        console.log('📁 Database path:', dbPath);
        
        // Ensure database directory exists
        const dbDir = path.dirname(dbPath);
        await fs.mkdir(dbDir, { recursive: true });
        console.log('📁 Database directory created/verified');
        
        // Check if database already exists
        try {
            await fs.access(dbPath);
            console.log('⚠️  Database file already exists. Delete it first if you want to recreate it.');
            console.log('   Run: del server\\database\\canvas.db');
            process.exit(0);
        } catch (e) {
            // Database doesn't exist, good to proceed
        }
        
        // Create and initialize database
        const db = new Database(dbPath);
        await db.init();
        console.log('✅ Database initialized successfully!');
        
        // Run a test query
        const tables = await db.all(`
            SELECT name FROM sqlite_master 
            WHERE type='table' 
            ORDER BY name;
        `);
        
        console.log('\n📊 Created tables:');
        tables.forEach(table => {
            console.log(`   - ${table.name}`);
        });
        
        // Create default user
        const defaultUser = await db.get('SELECT * FROM users WHERE id = 1');
        if (defaultUser) {
            console.log('\n👤 Default user exists:', defaultUser.username);
        }
        
        // Close database
        await db.close();
        console.log('\n✅ Database initialization complete!');
        console.log('🚀 You can now start the server with: npm start');
        
    } catch (error) {
        console.error('\n❌ Database initialization failed:');
        console.error(error.message);
        console.error('\nStack trace:');
        console.error(error.stack);
        process.exit(1);
    }
}

// Run initialization
initDatabase();