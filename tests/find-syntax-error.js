#!/usr/bin/env node

const fs = require('fs');
const vm = require('vm');

// List of JS files in load order from index.html
const jsFiles = [
    'js/utils/config.js',
    'js/utils/utils.js', 
    'js/core/GraphCircularReferenceResolver.js',
    'js/utils/cache.js',
    'js/utils/state.js',
    'js/core/animation.js',
    'js/core/viewport.js',
    'js/core/selection.js',
    'js/core/handles.js',
    'js/core/alignment.js',
    'js/nodes/base-node.js',
    'js/nodes/image-node.js',
    'js/nodes/video-node.js',
    'js/nodes/text-node.js',
    'js/graph.js',
    'js/actions/OperationBatcher.js',
    'js/actions/IncrementalStateSynchronizer.js',
    'js/actions/CompressionManager.js',
    'js/actions/PerformanceWorker.js',
    'js/canvas.js',
    'js/dragdrop.js',
    'js/actions/ConnectionStateMachine.js',
    'js/actions/ResourceManager.js',
    'js/actions/ErrorBoundary.js',
    'js/commands/Command.js',
    'js/commands/NodeCommands.js',
    'js/commands/NodeCommandsExtended.js',
    'js/core/CleanupManager.js',
    'js/core/OperationDependencyTracker.js',
    'js/core/OperationPipeline.js',
    'js/core/NetworkLayer.js',
    'js/core/PersistenceHandler.js',
    'js/core/StateSyncManager.js',
    'js/core/CollaborativeArchitecture.js',
    'js/core/CanvasIntegration.js',
    'js/core/AutoInit.js',
    'js/ui/canvas-navigator.js',
    'js/ui/floating-properties-inspector.js',
    'js/app.js'
];

function checkSyntax(filePath) {
    try {
        const fullPath = `/Users/marcsteinberg/Documents/Projects/ImageCanvas/${filePath}`;
        const code = fs.readFileSync(fullPath, 'utf8');
        
        // Try to parse as JavaScript
        new vm.Script(code);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

console.log('🔍 Checking JavaScript files for syntax errors...\n');

for (const file of jsFiles) {
    const result = checkSyntax(file);
    if (result.success) {
        console.log(`✅ ${file}`);
    } else {
        console.log(`❌ ${file}`);
        console.log(`   Error: ${result.error}`);
        console.log('');
        
        // Show the problematic line
        try {
            const fullPath = `/Users/marcsteinberg/Documents/Projects/ImageCanvas/${file}`;
            const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
            const errorMatch = result.error.match(/line (\d+)/);
            if (errorMatch) {
                const lineNum = parseInt(errorMatch[1]) - 1;
                console.log(`   Line ${lineNum + 1}: ${lines[lineNum]}`);
                if (lines[lineNum - 1]) console.log(`   Line ${lineNum}: ${lines[lineNum - 1]}`);
                if (lines[lineNum + 1]) console.log(`   Line ${lineNum + 2}: ${lines[lineNum + 1]}`);
            }
        } catch (e) {
            // Ignore file read errors
        }
        break; // Stop at first error
    }
}