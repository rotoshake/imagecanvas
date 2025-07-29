/**
 * AutoInit - Automatically initializes the new collaborative architecture
 * This ensures the new system is always active without manual initialization
 */

(function() {
    console.log('🚀 Auto-initialization script loaded');
    
    let initialized = false;
    
    async function initializeArchitecture() {
        if (initialized || !window.app) return;
        
        try {
            console.log('🏗️ Auto-initializing collaborative architecture...');
            
            // Create and initialize the architecture
            const arch = new CollaborativeArchitecture(window.app);
            window.app.collaborativeArchitecture = arch;
            await arch.initialize();
            
            
            // Initialize systems that depend on the collaborative architecture
            if (window.app.collaborativeArchitecture) {
                console.log('🚀 Initializing post-architecture systems...');
                
                // Initialize the canvas integration
                // if (window.CanvasIntegration) {
                //     window.app.canvasIntegration = new CanvasIntegration(window.app);
                //     window.app.canvasIntegration.initialize();
                //     console.log('✅ CanvasIntegration initialized and active');
                // }
                
                // Initialize background sync manager
                if (window.BackgroundSyncManager) {
                    // The CanvasIntegration will auto-initialize via its own script
                    
                    initialized = true;
                }
            }
            
        } catch (error) {
            console.error('❌ Failed to auto-initialize architecture:', error);
        }
    }
    
    // Try to initialize immediately if app exists
    if (window.app) {
        initializeArchitecture();
    } else {
        // Otherwise wait for app
        const checkInterval = setInterval(() => {
            if (window.app) {
                clearInterval(checkInterval);
                initializeArchitecture();
            }
        }, 50);
        
        // Stop checking after 10 seconds
        setTimeout(() => clearInterval(checkInterval), 10000);
    }
})();