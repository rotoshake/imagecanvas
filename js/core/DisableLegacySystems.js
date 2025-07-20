/**
 * DisableLegacySystems.js
 * 
 * This file disables all legacy collaborative systems to prevent conflicts
 * with the new OperationPipeline architecture. It should be loaded after
 * all other scripts to ensure it can properly disable legacy systems.
 */

(function() {
    console.log('🚫 Disabling legacy collaborative systems...');
    
    let disabledCount = 0;
    
    // Wait for app to be ready
    const disableLegacy = () => {
        if (!window.app) {
            setTimeout(disableLegacy, 50);
            return;
        }
        
        // 1. Disable CollaborativeManager
        if (window.app.collaborativeManager) {
            console.log('   - Disabling CollaborativeManager');
            
            // Disconnect and prevent reconnection
            if (window.app.collaborativeManager.socket) {
                window.app.collaborativeManager.socket.disconnect();
                window.app.collaborativeManager.socket.removeAllListeners();
            }
            
            // Override key methods to prevent operation
            window.app.collaborativeManager.handleOperation = () => {};
            window.app.collaborativeManager.broadcastOperation = () => {};
            window.app.collaborativeManager.broadcastNodeMove = () => {};
            window.app.collaborativeManager.broadcastNodeCreate = () => {};
            window.app.collaborativeManager.broadcastNodeDelete = () => {};
            window.app.collaborativeManager.save = () => Promise.resolve();
            window.app.collaborativeManager.load = () => Promise.resolve();
            
            // Clear from canvas
            if (window.app.graphCanvas) {
                window.app.graphCanvas.collaborativeManager = null;
            }
            
            disabledCount++;
        }
        
        // 2. Disable ActionManager on canvas
        if (window.app.graphCanvas && window.app.graphCanvas.actionManager) {
            console.log('   - Disabling canvas ActionManager');
            window.app.graphCanvas.actionManager = null;
            window.app.graphCanvas.setActionManager = () => {}; // Prevent re-setting
            disabledCount++;
        }
        
        // 3. Disable UnifiedOperationHandler
        if (window.UnifiedOperationHandler) {
            console.log('   - Disabling UnifiedOperationHandler');
            // Override the class to return dummy instances
            const OriginalHandler = window.UnifiedOperationHandler;
            window.UnifiedOperationHandler = class DummyHandler {
                handleOperation() { return Promise.resolve(); }
                broadcastOperation() {}
                processOperation() { return Promise.resolve(); }
            };
            disabledCount++;
        }
        
        // 4. Disable TransactionManager
        if (window.TransactionManager) {
            console.log('   - Disabling TransactionManager');
            const OriginalManager = window.TransactionManager;
            window.TransactionManager = class DummyTransaction {
                beginTransaction() {}
                commitTransaction() { return Promise.resolve(); }
                rollbackTransaction() {}
                addOperation() {}
            };
            disabledCount++;
        }
        
        // 5. Disable CanvasActionManager broadcasts
        if (window.CanvasActionManager) {
            console.log('   - Disabling CanvasActionManager broadcasts');
            // Find all instances and disable them
            const proto = window.CanvasActionManager.prototype;
            proto.broadcastAction = function() {};
            proto.broadcastNodeMove = function() {};
            proto.broadcastNodeCreate = function() {};
            proto.broadcastNodeDelete = function() {};
            disabledCount++;
        }
        
        // 6. Prevent canvas from using old broadcast methods
        if (window.app.graphCanvas) {
            console.log('   - Disabling canvas broadcast methods');
            const canvas = window.app.graphCanvas;
            
            // Override broadcast methods
            canvas.broadcastNodeMove = function() {};
            canvas.broadcastNodeCreate = function() {};
            canvas.broadcastNodeDelete = function() {};
            canvas.broadcastNodePropertyUpdate = function() {};
            
            // Clear collaborative flag
            canvas.collaborative_mode = false;
        }
        
        // 7. Disable auto-save from old system
        if (window.app.collaborativeManager) {
            console.log('   - Disabling legacy auto-save');
            if (window.app.collaborativeManager.autoSaveInterval) {
                clearInterval(window.app.collaborativeManager.autoSaveInterval);
            }
            window.app.collaborativeManager.startAutoSave = () => {};
            window.app.collaborativeManager.stopAutoSave = () => {};
        }
        
        console.log(`✅ Disabled ${disabledCount} legacy systems`);
        
        // Verify new systems are active
        setTimeout(() => {
            console.log('\n🔍 Verifying new architecture:');
            console.log('   - NetworkLayer:', window.app.networkLayer ? '✅ Active' : '❌ Missing');
            console.log('   - OperationPipeline:', window.app.operationPipeline ? '✅ Active' : '❌ Missing');
            console.log('   - MigrationAdapter:', window.app.migrationAdapter ? '✅ Active' : '❌ Missing');
            
            if (window.app.networkLayer && window.app.operationPipeline) {
                console.log('\n✅ New collaborative architecture is now the only active system');
            } else {
                console.error('⚠️ New architecture not fully initialized!');
            }
        }, 1000);
    };
    
    // Start disabling process
    disableLegacy();
    
    // Also prevent any new legacy systems from being created
    window.addEventListener('load', () => {
        // Override constructors to prevent instantiation
        if (window.CollaborativeManager) {
            const Original = window.CollaborativeManager;
            window.CollaborativeManager = class DisabledCollaborativeManager {
                constructor() {
                    console.warn('⚠️ Attempted to create CollaborativeManager - using new architecture instead');
                }
            };
        }
    });
})();