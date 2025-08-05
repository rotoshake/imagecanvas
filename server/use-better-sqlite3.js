// Script to temporarily switch to better-sqlite3 for Windows compatibility
const fs = require('fs');
const path = require('path');

const databasePath = path.join(__dirname, 'src/database/database.js');
const betterSqlitePath = path.join(__dirname, 'src/database/database-better-sqlite3.js');
const backupPath = path.join(__dirname, 'src/database/database-original.js');

// Create backup of original
if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(databasePath, backupPath);
    console.log('✅ Created backup of original database.js');
}

// Copy better-sqlite3 version
fs.copyFileSync(betterSqlitePath, databasePath);
console.log('✅ Switched to better-sqlite3 version');
console.log('📝 Now run: npm install better-sqlite3');
console.log('📝 Then run: npm start');