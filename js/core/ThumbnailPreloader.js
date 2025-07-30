/**
 * ThumbnailPreloader - Intelligently pre-generates thumbnails for off-screen nodes
 * to ensure they're ready when the user pans/zooms to them
 */
class ThumbnailPreloader {
    constructor() {
        this.preloadQueue = [];
        this.isProcessing = false;
        this.preloadRadius = 2; // Preload nodes within 2x viewport distance
        this.lastViewportCheck = 0;
        this.checkInterval = 1000; // Check every second
        this.maxPreloadPerBatch = 10; // Limit concurrent preloads
        
        // Start monitoring when app is ready
        this.startMonitoring();
    }
    
    startMonitoring() {
        // Wait for app to be ready
        const checkApp = setInterval(() => {
            if (window.app?.graph?.nodes && window.app?.graphCanvas?.viewport) {
                clearInterval(checkApp);
                
                // Monitor viewport changes
                this.monitorViewport();
            }
        }, 100);
    }
    
    monitorViewport() {
        // Check periodically and on viewport changes
        setInterval(() => this.checkForPreloadCandidates(), this.checkInterval);
        
        // Also check on viewport changes if available
        if (window.app.graphCanvas.viewport.addChangeListener) {
            window.app.graphCanvas.viewport.addChangeListener(() => {
                // Debounce viewport changes
                if (Date.now() - this.lastViewportCheck > 500) {
                    this.lastViewportCheck = Date.now();
                    this.checkForPreloadCandidates();
                }
            });
        }
    }
    
    checkForPreloadCandidates() {
        if (this.isProcessing || !window.thumbnailCache || !window.app?.graph?.nodes) return;
        
        const viewport = window.app.graphCanvas.viewport;
        const nodes = window.app.graph.nodes;
        
        // Get viewport bounds with preload radius
        const padding = CONFIG.PERFORMANCE.VISIBILITY_MARGIN * this.preloadRadius;
        const preloadBounds = {
            left: -viewport.offset[0] / viewport.scale - padding,
            top: -viewport.offset[1] / viewport.scale - padding,
            right: (-viewport.offset[0] + viewport.canvas.width) / viewport.scale + padding,
            bottom: (-viewport.offset[1] + viewport.canvas.height) / viewport.scale + padding
        };
        
        // Find nodes that need preloading
        const candidates = [];
        
        for (const node of nodes) {
            if (node.type !== 'media/image' || !node.properties?.hash) continue;
            
            // Skip if already has thumbnails
            if (window.thumbnailCache.hasThumbnails(node.properties.hash)) continue;
            
            // Skip if node doesn't have a full image yet
            if (!node.img || node.loadingState !== 'loaded') continue;
            
            // Check if node is within preload bounds
            const [x, y] = node.pos;
            const [w, h] = node.size;
            
            if (x + w >= preloadBounds.left && x <= preloadBounds.right &&
                y + h >= preloadBounds.top && y <= preloadBounds.bottom) {
                
                // Calculate distance from viewport center for prioritization
                const centerX = -viewport.offset[0] / viewport.scale + viewport.canvas.width / 2 / viewport.scale;
                const centerY = -viewport.offset[1] / viewport.scale + viewport.canvas.height / 2 / viewport.scale;
                const distance = Math.hypot(x + w/2 - centerX, y + h/2 - centerY);
                
                candidates.push({ node, distance });
            }
        }
        
        if (candidates.length === 0) return;
        
        // Sort by distance (closest first)
        candidates.sort((a, b) => a.distance - b.distance);
        
        // Add to preload queue (limit batch size)
        const toPreload = candidates.slice(0, this.maxPreloadPerBatch);
        
        this.preloadQueue.push(...toPreload);
        this.processQueue();
    }
    
    async processQueue() {
        if (this.isProcessing || this.preloadQueue.length === 0) return;
        
        this.isProcessing = true;
        
        while (this.preloadQueue.length > 0) {
            const { node } = this.preloadQueue.shift();
            
            // Double-check node still needs thumbnails
            if (!window.thumbnailCache.hasThumbnails(node.properties.hash) && node.img) {
                console.log(`🔮 Preloading thumbnails for ${node.properties.filename || node.properties.hash.substring(0, 8)}...`);
                
                // Generate thumbnails with low priority
                await window.thumbnailCache.generateThumbnailsProgressive(
                    node.properties.hash,
                    node.img,
                    null, // No progress callback needed
                    'low' // Low priority for background generation
                );
                
                // Small delay to maintain responsiveness
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        this.isProcessing = false;
    }
    
    // Clear queue (e.g., when user starts interacting)
    clearQueue() {
        this.preloadQueue = [];
        
    }
}

// Initialize global preloader
if (typeof window !== 'undefined') {
    window.thumbnailPreloader = new ThumbnailPreloader();
}