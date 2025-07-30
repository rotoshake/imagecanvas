#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Configuration for cleanup
const CLEANUP_CONFIG = {
    // Files to process
    sourceDirs: ['js', 'server'],
    
    // Patterns to remove
    patterns: {
        consoleLogs: [
            /console\.log\([^)]*\);?\s*$/gm,
            /console\.warn\([^)]*\);?\s*$/gm,
            /console\.error\([^)]*\);?\s*$/gm,
        ],
        
        // Keep important error logging
        keepPatterns: [
            /console\.error\(.*error.*\)/gi,
            /console\.warn\(.*warning.*\)/gi,
        ],
        
        // Debug comments to remove
        debugComments: [
            /\/\/ console\.log\([^)]*\);?\s*$/gm,
            /\/\/ TODO:.*$/gm,
            /\/\/ FIXME:.*$/gm,
            /\/\/ HACK:.*$/gm,
        ]
    }
};

function cleanupFile(filePath) {
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        let originalContent = content;
        let changes = 0;
        
        // Remove console.log statements (but keep error logging)
        CLEANUP_CONFIG.patterns.consoleLogs.forEach(pattern => {
            const matches = content.match(pattern);
            if (matches) {
                // Check if this should be kept
                const shouldKeep = CLEANUP_CONFIG.patterns.keepPatterns.some(keepPattern => 
                    keepPattern.test(matches[0])
                );
                
                if (!shouldKeep) {
                    content = content.replace(pattern, '');
                    changes += matches.length;
                }
            }
        });
        
        // Remove debug comments
        CLEANUP_CONFIG.patterns.debugComments.forEach(pattern => {
            const matches = content.match(pattern);
            if (matches) {
                content = content.replace(pattern, '');
                changes += matches.length;
            }
        });
        
        // Remove empty lines
        content = content.replace(/\n\s*\n\s*\n/g, '\n\n');
        
        if (content !== originalContent) {
            fs.writeFileSync(filePath, content);
            console.log(`✅ Cleaned ${filePath} (${changes} changes)`);
            return changes;
        }
        
        return 0;
    } catch (error) {
        console.error(`❌ Error cleaning ${filePath}:`, error.message);
        return 0;
    }
}

function findJsFiles(dir) {
    const files = [];
    
    function scan(currentDir) {
        const items = fs.readdirSync(currentDir);
        
        for (const item of items) {
            const fullPath = path.join(currentDir, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
                scan(fullPath);
            } else if (item.endsWith('.js') || item.endsWith('.mjs')) {
                files.push(fullPath);
            }
        }
    }
    
    scan(dir);
    return files;
}

function main() {
    console.log('🧹 Starting codebase cleanup...');
    
    let totalChanges = 0;
    let totalFiles = 0;
    
    CLEANUP_CONFIG.sourceDirs.forEach(dir => {
        if (fs.existsSync(dir)) {
            const files = findJsFiles(dir);
            console.log(`📁 Processing ${files.length} files in ${dir}/`);
            
            files.forEach(file => {
                const changes = cleanupFile(file);
                totalChanges += changes;
                if (changes > 0) totalFiles++;
            });
        }
    });
    
    console.log(`\n🎉 Cleanup complete!`);
    console.log(`📊 Total changes: ${totalChanges}`);
    console.log(`📁 Files modified: ${totalFiles}`);
}

if (require.main === module) {
    main();
}

module.exports = { cleanupFile, findJsFiles }; 