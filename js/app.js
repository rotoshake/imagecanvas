// ===================================
// MAIN APPLICATION
// ===================================

class ImageCanvasApp {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.graph = new ImageGraph();
        this.graphCanvas = new ImageCanvas(this.canvas, this.graph);
        this.dragDropManager = new DragDropManager(this.canvas, this.graph);
        this.stateManager = new StateManager();
        this.bulkOperationManager = new BulkOperationManager();
        this.backgroundSyncManager = null; // Will be initialized after network layer
        
        this.init();
    }
    
    async init() {
        
        try {
            // Initialize caching systems
            await window.imageCache.init();
            window.thumbnailCache = new ThumbnailCache();
            
            // Initialize memory management
            window.memoryManager = new MemoryManager();
            
            // Initialize offscreen render cache
            window.offscreenRenderCache = new OffscreenRenderCache();
            
            // Initialize performance monitor
            this.performanceMonitor = new PerformanceMonitor();
            
            // Initialize image resource cache for deduplication
            this.imageResourceCache = new ImageResourceCache();
            
            await this.stateManager.init();
            
            // Connect state manager to canvas
            this.graphCanvas.setStateManager(this.stateManager);
            
            // Initialize alignment system
            this.graphCanvas.alignmentManager = new AutoAlignmentManager(this.graphCanvas);
            
            // Initialize node plugin system
            this.nodePluginSystem = new NodePluginSystem();
            
            // Initialize node creation menu
            this.nodeCreationMenu = new NodeCreationMenu(this.canvas);
            
            // Initialize user profile system
            this.userProfileSystem = new UserProfileSystem();
            await this.userProfileSystem.init();
            
            // Initialize user profile panel
            this.userProfilePanel = new UserProfilePanel();
            
            // Register node types (now handled by NodePluginSystem)
            // NodeFactory.registerNodeType('media/image', ImageNode);
            // NodeFactory.registerNodeType('media/video', VideoNode);
            // NodeFactory.registerNodeType('media/text', TextNode);
            
            // State will be loaded from server when joining a project
            // Collaborative features are now handled by CollaborativeArchitecture
            
            // Setup auto-save
            this.setupAutoSave();
            
            // Setup cleanup
            this.setupCleanup();

            this.logControls();
            
            // Setup FPS testing helpers
            this.setupFPSTestingHelpers();
            
            // DISABLED: This migration was causing 404 errors by changing filenames to non-existent files
            // Fix incorrect serverFilename values after a delay to ensure nodes are loaded
            // setTimeout(() => {
            //     this.migrateServerFilenames();
            // }, 1000);
            
        } catch (error) {
            console.error('Failed to initialize app:', error);
        }
    }
    
    setupAutoSave() {
        // Auto-save disabled - server handles all persistence with state sync
    }
    
    setupCleanup() {
        this.cleanupHandler = () => {
            this.cleanup();
        };
        window.addEventListener('beforeunload', this.cleanupHandler);
    }
    
    cleanup() {
        
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }
        
        if (this.beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this.beforeUnloadHandler);
        }
        
        if (this.cleanupHandler) {
            window.removeEventListener('beforeunload', this.cleanupHandler);
        }
        
        // Clean up components
        if (this.graphCanvas) {
            this.graphCanvas.cleanup();
        }
        
        if (this.dragDropManager?.cleanup) {
            this.dragDropManager.cleanup();
        }

        if (this.networkLayer?.cleanup) {
            this.networkLayer.cleanup();
        }
        
        if (this.stateSyncManager?.cleanup) {
            this.stateSyncManager.cleanup();
        }
        
        if (this.operationPipeline?.cleanup) {
            this.operationPipeline.cleanup();
        }
        
        // Clear references
        this.graph = null;
        this.graphCanvas = null;
        this.dragDropManager = null;
        this.stateManager = null;
        this.networkLayer = null;
        this.stateSyncManager = null;
        this.operationPipeline = null;
    }
    
    logControls() {
        
    }
    
    /**
     * Show a notification to the user (using unified notification system)
     */
    showNotification(options) {
        if (window.unifiedNotifications) {
            const { type = 'info', message, duration = 3000, detail } = options;
            return window.unifiedNotifications.show({
                type,
                message,
                detail,
                duration
            });
        }
        
        // Fallback to simple notification if unified system not loaded
        
    }
    
    /**
     * Update connection status (using ConnectionStatus component)
     */
    updateConnectionStatus(status, detail) {
        if (this.connectionStatus) {
            this.connectionStatus.updateStatus(status, detail);
        }
    }
    
    /**
     * Create properties inspector toggle button
     */
    createPropertiesButton() {
        // Create button element
        this.propertiesBtn = document.createElement('button');
        this.propertiesBtn.className = 'properties-inspector-toggle';
        this.propertiesBtn.innerHTML = '<span class="icon">ⓘ</span>';
        this.propertiesBtn.title = 'Show/Hide Properties Inspector';
        
        // Add styles
        this.addPropertiesButtonStyles();
        
        // Add click handler
        this.propertiesBtn.addEventListener('click', () => {
            this.propertiesInspector.toggle();
            this.propertiesBtn.classList.toggle('active', this.propertiesInspector.isVisible);
        });
        
        // Add to DOM
        document.body.appendChild(this.propertiesBtn);

    }
    
    /**
     * Create color correction toggle button
     */
    createColorCorrectionButton() {
        // Create button element
        this.colorCorrectionBtn = document.createElement('button');
        this.colorCorrectionBtn.className = 'color-correction-toggle';
        this.colorCorrectionBtn.innerHTML = '<span class="icon">🎨</span>';
        this.colorCorrectionBtn.title = 'Show/Hide Color Correction (C)';
        
        // Add styles
        this.addColorCorrectionButtonStyles();
        
        // Add click handler
        this.colorCorrectionBtn.addEventListener('click', () => {
            this.colorCorrectionPanel.toggle();
            this.colorCorrectionBtn.classList.toggle('active', this.colorCorrectionPanel.isVisible);
        });
        
        // Add to DOM
        document.body.appendChild(this.colorCorrectionBtn);
    }
    
    /**
     * Add styles for properties button
     */
    addPropertiesButtonStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Properties Inspector Toggle Button */
            .properties-inspector-toggle {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: #1e1e1e;
                border: 1px solid #333;
                color: #e0e0e0;
                padding: 6px;
                border-radius: 50%;
                cursor: pointer;
                font-size: 12px;
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
                z-index: 999;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            }
            
            .properties-inspector-toggle .icon {
                font-size: 14px;
                line-height: 1;
            }
            
            .properties-inspector-toggle:hover {
                background: #252525;
                border-color: #444;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                transform: translateY(-1px);
            }
            
            .properties-inspector-toggle.active {
                background: #333;
                border-color: #0066cc;
                box-shadow: 0 0 0 2px rgba(0, 102, 204, 0.2);
            }
            
            .properties-inspector-toggle:active {
                transform: translateY(0);
            }
            
            /* Responsive adjustments */
            @media (max-width: 768px) {
                .properties-inspector-toggle {
                    bottom: 15px;
                    right: 15px;
                    width: 18px;
                    height: 18px;
                    padding: 5px;
                }
                
                .properties-inspector-toggle .icon {
                    font-size: 12px;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    /**
     * Add styles for color correction button
     */
    addColorCorrectionButtonStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Color Correction Toggle Button */
            .color-correction-toggle {
                position: fixed;
                bottom: 20px;
                right: 60px;
                background: #1e1e1e;
                border: 1px solid #333;
                color: #e0e0e0;
                padding: 6px;
                border-radius: 50%;
                cursor: pointer;
                font-size: 12px;
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
                z-index: 999;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            }
            
            .color-correction-toggle .icon {
                font-size: 14px;
                line-height: 1;
            }
            
            .color-correction-toggle:hover {
                background: #252525;
                border-color: #444;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                transform: translateY(-1px);
            }
            
            .color-correction-toggle.active {
                background: #333;
                border-color: #ff6b6b;
                box-shadow: 0 0 0 2px rgba(255, 107, 107, 0.2);
            }
            
            .color-correction-toggle:active {
                transform: translateY(0);
            }
            
            /* Responsive adjustments */
            @media (max-width: 768px) {
                .color-correction-toggle {
                    bottom: 15px;
                    right: 50px;
                    width: 18px;
                    height: 18px;
                    padding: 5px;
                }
                
                .color-correction-toggle .icon {
                    font-size: 12px;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    setupFPSTestingHelpers() {
        // Add global FPS testing functions to window for easy console access
        window.testFPS = (mode) => {
            const canvas = this.graphCanvas;
            if (!canvas) {
                console.error('Canvas not ready');
                return;
            }
            
            const modes = { 1: 'normal', 2: 'minimal', 3: 'nocap', 4: 'noanimations', 5: 'noloading' };
            const modeName = modes[mode] || mode;
            
            if (!['normal', 'minimal', 'nocap', 'noanimations', 'noloading'].includes(modeName)) {
                
                console.log('  testFPS(1) - Normal');
                console.log('  testFPS(2) - Minimal (raw performance)');
                console.log('  testFPS(3) - No FPS cap');
                console.log('  testFPS(4) - No animations');
                console.log('  testFPS(5) - No loading checks');
                return;
            }
            
            canvas.setFPSTestMode(modeName);
            
            console.log('⚠️  Reload the page: location.reload()');
        };
        
        window.fpsStats = () => {
            const canvas = this.graphCanvas;
            if (!canvas) {
                console.error('Canvas not ready');
                return;
            }
            
            const stats = canvas.getFrameTimeStats();

            if (stats && stats.samples > 0) {
                console.log(`⏱️  Frame Times: ${stats.avg}ms avg (${stats.avgFPS} FPS), ${stats.p50}ms median`);
            } else {
                console.log('⏱️  No frame time data yet (wait a few seconds in test mode)');
            }
        };
        
        // Test with limited nodes to find performance curve
        window.testNodes = (maxNodes = 5) => {
            const canvas = this.graphCanvas;
            if (!canvas) {
                console.error('Canvas not ready');
                return;
            }

            // Store original nodes
            const originalNodes = canvas.graph.nodes;
            
            // Limit to maxNodes
            canvas.graph.nodes = originalNodes.slice(0, maxNodes);
            
            // Monitor FPS for 5 seconds
            setTimeout(() => {
                
                // Restore original nodes
                canvas.graph.nodes = originalNodes;
                canvas.dirty_canvas = true;

            }, 5000);
            
            canvas.dirty_canvas = true;
        };
        
        // Profile what's slow in the draw method
        window.profileDraw = () => {
            const canvas = this.graphCanvas;
            if (!canvas) {
                console.error('Canvas not ready');
                return;
            }

            const originalDraw = canvas.draw;
            const timings = {
                grid: [],
                culling: [],
                nodes: [],
                ui: [],
                total: []
            };
            
            canvas.draw = function() {
                if (!this.ctx) return;
                
                const startTime = performance.now();
                const ctx = this.ctx;
                const canvas = this.canvas;
                
                // Clear canvas
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                // Background
                if (this.galleryViewManager && this.galleryViewManager.active) {
                    ctx.fillStyle = '#111';
                } else {
                    ctx.fillStyle = '#222';
                }
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                
                // Draw grid
                const gridStart = performance.now();
                if (!this.galleryViewManager || !this.galleryViewManager.active) {
                    this.drawGrid(ctx);
                }
                const gridTime = performance.now() - gridStart;
                
                // Viewport transformation
                ctx.save();
                ctx.translate(this.viewport.offset[0], this.viewport.offset[1]);
                ctx.scale(this.viewport.scale, this.viewport.scale);
                
                // Culling
                const cullStart = performance.now();
                const viewportChanged = !this.lastViewportState ||
                    this.viewport.offset[0] !== this.lastViewportState.offsetX ||
                    this.viewport.offset[1] !== this.lastViewportState.offsetY ||
                    this.viewport.scale !== this.lastViewportState.scale;
                
                let visibleNodes;
                const nodeCountChanged = this.cachedVisibleNodes && 
                    this.cachedVisibleNodes.length !== this.graph.nodes.length;
                    
                if (viewportChanged || !this.cachedVisibleNodes || nodeCountChanged) {
                    visibleNodes = this.viewport.getVisibleNodes(
                        this.graph.nodes, 
                        this.getConfig('PERFORMANCE.VISIBILITY_MARGIN', 200)
                    );
                    this.cachedVisibleNodes = visibleNodes;
                    this.lastViewportState = {
                        offsetX: this.viewport.offset[0],
                        offsetY: this.viewport.offset[1],
                        scale: this.viewport.scale
                    };
                    this.updateNodeVisibility(visibleNodes);
                } else {
                    visibleNodes = this.cachedVisibleNodes;
                }
                const cullTime = performance.now() - cullStart;
                
                // Draw nodes
                const nodesStart = performance.now();
                for (const node of visibleNodes) {
                    if (this.galleryViewManager && this.galleryViewManager.shouldHideNode(node)) {
                        continue;
                    }
                    this.drawNode(ctx, node);
                }
                const nodesTime = performance.now() - nodesStart;
                
                ctx.restore();
                
                // UI overlays
                const uiStart = performance.now();
                this.drawOverlays(ctx);
                this.drawStats(ctx);
                const uiTime = performance.now() - uiStart;
                
                const totalTime = performance.now() - startTime;
                
                // Collect timing data
                timings.grid.push(gridTime);
                timings.culling.push(cullTime);
                timings.nodes.push(nodesTime);
                timings.ui.push(uiTime);
                timings.total.push(totalTime);
                
                // Log slow frames
                if (totalTime > 8.33) {
                    console.log(`🐌 Slow frame: ${totalTime.toFixed(1)}ms (grid: ${gridTime.toFixed(1)}ms, cull: ${cullTime.toFixed(1)}ms, nodes: ${nodesTime.toFixed(1)}ms, ui: ${uiTime.toFixed(1)}ms)`);
                }
            };
            
            // Restore and show results after 10 seconds
            setTimeout(() => {
                canvas.draw = originalDraw;
                
                if (timings.total.length === 0) {
                    
                    return;
                }
                
                const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
                const max = (arr) => Math.max(...arr);

                console.log(`Total time - avg: ${avg(timings.total).toFixed(2)}ms, max: ${max(timings.total).toFixed(2)}ms`);
                console.log(`Grid - avg: ${avg(timings.grid).toFixed(2)}ms, max: ${max(timings.grid).toFixed(2)}ms`);
                console.log(`Culling - avg: ${avg(timings.culling).toFixed(2)}ms, max: ${max(timings.culling).toFixed(2)}ms`);
                console.log(`Nodes - avg: ${avg(timings.nodes).toFixed(2)}ms, max: ${max(timings.nodes).toFixed(2)}ms`);
                console.log(`UI - avg: ${avg(timings.ui).toFixed(2)}ms, max: ${max(timings.ui).toFixed(2)}ms`);
                console.log(`Theoretical max FPS: ${(1000 / avg(timings.total)).toFixed(1)}`);
            }, 10000);
        };
        
        // Debug what's causing continuous renders
        window.debugRedraws = () => {
            const canvas = this.graphCanvas;
            if (!canvas) {
                console.error('Canvas not ready');
                return;
            }

            console.log(`Alignment active: ${canvas.alignmentManager?.isAnimating() || false}`);
            
            const videoCount = canvas.graph.nodes.filter(n => 
                n.type === 'media/video' && n.video && !n.video.paused
            ).length;
            
            const loadingCount = canvas.graph.nodes.filter(n => 
                n.loadingState === 'loading'
            ).length;
            
            // Check if the render loop is actually running at 73 FPS
            let frameCount = 0;
            const startTime = performance.now();
            
            const originalDraw = canvas.draw;
            canvas.draw = function() {
                frameCount++;
                if (frameCount % 20 === 0) { // Log every 20th frame
                    const elapsed = (performance.now() - startTime) / 1000;
                    const currentFPS = frameCount / elapsed;
                    console.log(`🎯 Draw called ${frameCount} times, effective FPS: ${currentFPS.toFixed(1)}`);
                }
                return originalDraw.call(this);
            };
            
            // Restore after 5 seconds
            setTimeout(() => {
                canvas.draw = originalDraw;
                const elapsed = (performance.now() - startTime) / 1000;
                const avgFPS = frameCount / elapsed;
                console.log(`✅ Debug complete: ${frameCount} draws in ${elapsed.toFixed(1)}s = ${avgFPS.toFixed(1)} FPS`);
            }, 5000);
        };
        
        // Immediate minimal test (no reload needed)
        window.testMinimal = () => {
            const canvas = this.graphCanvas;
            if (!canvas) {
                console.error('Canvas not ready');
                return;
            }

            canvas.setFPSTestMode('minimal');
            
            // Wait 3 seconds then show stats
            setTimeout(() => {
                
                const stats = canvas.getFrameTimeStats();
                
                if (stats && stats.samples > 0) {
                    console.log(`Frame Times: ${stats.avg}ms avg (${stats.avgFPS} FPS)`);
                }
            }, 3000);
        };
        
        // Quick test function that creates a simple animation to verify FPS capability
        window.testRawFPS = () => {
            
            // Create a simple test canvas
            const testCanvas = document.createElement('canvas');
            testCanvas.width = 400;
            testCanvas.height = 300;
            testCanvas.style.position = 'fixed';
            testCanvas.style.top = '10px';
            testCanvas.style.right = '10px';
            testCanvas.style.zIndex = '10000';
            testCanvas.style.border = `2px solid ${ColorUtils.get('accents', 'primary')}`;
            testCanvas.style.background = ColorUtils.get('litegraph', 'background_dark');
            document.body.appendChild(testCanvas);
            
            const ctx = testCanvas.getContext('2d');
            let frameCount = 0;
            let lastTime = performance.now();
            let testFPS = 0;
            
            let x = 50, y = 50, vx = 3, vy = 2;
            
            const animate = (currentTime) => {
                frameCount++;
                
                if (currentTime - lastTime >= 1000) {
                    testFPS = frameCount;
                    frameCount = 0;
                    lastTime = currentTime;
                    
                }
                
                // Clear and draw
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, 400, 300);
                
                // Update position
                x += vx;
                y += vy;
                if (x <= 0 || x >= 380) vx = -vx;
                if (y <= 0 || y >= 280) vy = -vy;
                
                // Draw box
                ctx.fillStyle = '#4af';
                ctx.fillRect(x, y, 20, 20);
                
                // Draw FPS
                ctx.fillStyle = '#fff';
                ctx.font = '14px monospace';
                ctx.fillText(`Raw FPS: ${testFPS}`, 10, 25);
                
                requestAnimationFrame(animate);
            };
            
            requestAnimationFrame(animate);
            
            // Remove after 10 seconds
            setTimeout(() => {
                document.body.removeChild(testCanvas);
                
            }, 10000);
        };
        
        // Debug FPS limiting
        window.debugFPSLimit = () => {
            const canvas = this.graphCanvas;
            if (!canvas) {
                console.error('Canvas not ready');
                return;
            }

            // Check the target frame time
            const targetFPS = window.CONFIG?.PERFORMANCE?.MAX_FPS || 120;
            const targetFrameTime = 1000 / targetFPS;
            console.log(`Target FPS: ${targetFPS}, Target frame time: ${targetFrameTime.toFixed(2)}ms`);
            
            let frameCount = 0;
            let skippedFrames = 0;
            let totalWaitTime = 0;
            
            // Hook into the render loop to see timing
            const originalRequestAnimationFrame = window.requestAnimationFrame;
            window.requestAnimationFrame = function(callback) {
                return originalRequestAnimationFrame.call(window, function(timestamp) {
                    frameCount++;
                    
                    // Log timing occasionally
                    if (frameCount % 60 === 0) {
                        console.log(`📊 Frame ${frameCount}, skipped: ${skippedFrames}, avg wait: ${(totalWaitTime/frameCount).toFixed(2)}ms`);
                    }
                    
                    return callback(timestamp);
                });
            };
            
            setTimeout(() => {
                window.requestAnimationFrame = originalRequestAnimationFrame;
                
                console.log(`Effective FPS: ${(frameCount / 5).toFixed(1)}`);
            }, 5000);
        };
        
        // Quick test for FPS limiting bug
        window.testFPSLimiting = () => {
            
            // Enable FPS limit debugging
            window.DEBUG_FPS_LIMIT = true;
            
            // Switch back to normal mode (with FPS limiting)
            const canvas = this.graphCanvas;
            canvas.setFPSTestMode('normal');

            setTimeout(() => {
                window.DEBUG_FPS_LIMIT = false;
                
            }, 10000);
        };

        console.log('  testFPSLimiting() - Test FPS limiting bug (drag while running)');
        console.log('  profileDraw()  - Profile draw performance');
        console.log('  testMinimal()  - Test minimal mode (200+ FPS)');
        console.log('  fpsStats()     - Show current stats');
    }
    
    /**
     * Migrate serverFilename values from original filenames to actual server filenames
     * This fixes issues where drag-drop uploads had incorrect serverFilename values
     */
    async migrateServerFilenames() {
        if (!this.graph?.nodes) return;
        
        let migratedCount = 0;
        
        for (const node of this.graph.nodes) {
            // Handle both image and video nodes
            if ((node.type === 'media/image' || node.type === 'media/video') && node.properties) {
                const props = node.properties;
                
                // Check if serverFilename looks like an original filename (e.g., "IMG_7189.jpeg")
                // instead of a server filename (e.g., "1752793848045-hvat3b.jpeg")
                let needsMigration = false;
                let actualServerFilename = null;
                
                // Check serverFilename
                if (props.serverFilename && !props.serverFilename.match(/^\d{13}-[a-z0-9]+\./)) {
                    needsMigration = true;
                }
                
                // Also check if serverUrl contains the wrong filename
                if (props.serverUrl) {
                    const urlMatch = props.serverUrl.match(/\/uploads\/(.+)$/);
                    if (urlMatch && urlMatch[1] && !urlMatch[1].match(/^\d{13}-[a-z0-9]+\./)) {
                        needsMigration = true;
                        // serverUrl also has wrong filename
                    }
                }
                
                if (needsMigration) {
                    // Look for the actual server filename in other properties or generate a placeholder
                    // First check if we have a properly formatted filename anywhere
                    if (props.serverUrl) {
                        const match = props.serverUrl.match(/(\d{13}-[a-z0-9]+\.[^/]+)$/);
                        if (match) {
                            actualServerFilename = match[1];
                        }
                    }
                    
                    // If we found a valid server filename, update both serverFilename and serverUrl
                    if (actualServerFilename) {
                        const nodeTypeLabel = node.type === 'media/video' ? '🎬' : '🖼️';
                        console.log(`🔧 Migrating filenames for ${nodeTypeLabel} ${props.hash?.substring(0, 8)}:`);
                        console.log(`   serverFilename: "${props.serverFilename}" → "${actualServerFilename}"`);
                        
                        props.serverFilename = actualServerFilename;
                        
                        // Fix serverUrl too
                        if (props.serverUrl) {
                            const oldUrl = props.serverUrl;
                            props.serverUrl = `/uploads/${actualServerFilename}`;
                            console.log(`   serverUrl: "${oldUrl}" → "${props.serverUrl}"`);
                        }
                        
                        migratedCount++;
                    } else {
                        // Can't determine the actual filename - this node needs to be re-uploaded
                        console.warn(`⚠️ Cannot migrate ${node.type} node - no valid server filename found:`, {
                            hash: props.hash?.substring(0, 8),
                            serverFilename: props.serverFilename,
                            serverUrl: props.serverUrl,
                            filename: props.filename
                        });
                    }
                }
            }
        }
        
        if (migratedCount > 0) {
            console.log(`✅ Migrated ${migratedCount} media nodes with incorrect serverFilename values`);
            // Mark canvas as dirty to ensure any visible images update
            if (this.graphCanvas) {
                this.graphCanvas.dirty_canvas = true;
            }
        }
    }
}

// ===================================
// NODE FACTORY
// ===================================

class NodeFactory {
    static nodeTypes = new Map();
    
    static createNode(type, options = {}) {
        // Use NodePluginSystem if available
        if (window.app?.nodePluginSystem) {
            try {
                const node = window.app.nodePluginSystem.createNode(type, options.properties || {});
                
                // Apply additional options
                if (node && options) {
                    if (options.id) node.id = options.id;
                    if (options.pos) node.pos = [...options.pos];
                    if (options.size) node.size = [...options.size];
                    if (options.flags) {
                        for (const [key, value] of Object.entries(options.flags)) {
                            if (value !== undefined) {
                                node.flags[key] = value;
                            }
                        }
                    }
                    if (options.title) node.title = options.title;
                    if (options.rotation !== undefined) node.rotation = options.rotation;
                    if (options.aspectRatio !== undefined) node.aspectRatio = options.aspectRatio;
                }
                
                return node;
            } catch (error) {
                
            }
        }
        
        // Legacy fallback
        let node = null;
        
        // Get node class
        const NodeClass = this.nodeTypes.get(type);
        if (NodeClass) {
            node = new NodeClass();
        } else {
            // Fallback for built-in types
            switch (type) {
                case 'media/image':
                case 'canvas/image':
                case 'image':  // Legacy database type
                    node = new ImageNode();
                    break;
                case 'media/video':
                case 'canvas/video':
                case 'video':  // Legacy database type
                    node = new VideoNode();
                    break;
                case 'media/text':
                case 'canvas/text':
                case 'text':   // Legacy database type
                    node = new TextNode();
                    break;
                default:
                    
                    return null;
            }
        }
        
        // Apply options if provided
        if (node && options) {
            if (options.id) node.id = options.id;
            if (options.pos) node.pos = [...options.pos];
            if (options.size) node.size = [...options.size];
            if (options.properties) {
                Object.assign(node.properties, options.properties);
                
                // Handle special properties that should be stored directly on the node
                if (options.properties.originalWidth !== undefined) {
                    node.originalWidth = options.properties.originalWidth;
                }
                if (options.properties.originalHeight !== undefined) {
                    node.originalHeight = options.properties.originalHeight;
                }
            }
            if (options.flags) {
                // Only override specific flags that are explicitly provided
                // This preserves constructor defaults (like hide_title: true)
                for (const [key, value] of Object.entries(options.flags)) {
                    if (value !== undefined) {
                        node.flags[key] = value;
                    }
                }
            }
            if (options.title) node.title = options.title;
            if (options.rotation !== undefined) node.rotation = options.rotation;
            if (options.aspectRatio !== undefined) node.aspectRatio = options.aspectRatio;
            
            // Do NOT automatically add to graph - let the caller handle it
            // This prevents double-adding and broadcast loops
        }
        
        return node;
    }
    
    static registerNodeType(type, nodeClass) {
        this.nodeTypes.set(type, nodeClass);
        
    }
}

// Export NodeFactory globally
window.NodeFactory = NodeFactory;

// ===================================
// GLOBAL INSTANCES AND COMPATIBILITY
// ===================================

// Global instances
window.imageCache = new ImageCache();
let app = null;

// Custom LiteGraph compatibility object
window.LiteGraph = {
    createNode: (type) => NodeFactory.createNode(type),
    registerNodeType: (type, nodeClass) => NodeFactory.registerNodeType(type, nodeClass)
};

// ===================================
// INITIALIZATION
// ===================================

async function initApp() {
    const canvasElement = document.getElementById('mycanvas');
    if (!canvasElement) {
        console.error('Canvas element not found');
        return;
    }
    
    try {
        // Create the app instance
        app = new ImageCanvasApp(canvasElement);
        
        // Make app globally accessible for debugging
        window.app = app;
        window.lcanvas = app.graphCanvas;
        
        // AutoInit runs automatically when loaded - no manual initialization needed
        
        // Now initialize Canvas Navigator (guaranteed to have network layer)
        app.canvasNavigator = new CanvasNavigator(app);
        window.canvasNavigator = app.canvasNavigator;
        
        // Initialize Image Upload Coordinator
        if (window.ImageUploadCoordinator) {
            app.imageUploadCoordinator = new ImageUploadCoordinator(app);
        }
        
        // Initialize Connection Status
        app.connectionStatus = new ConnectionStatus(app);
        window.connectionStatus = app.connectionStatus;
        
        // Initialize Floating Properties Inspector
        app.propertiesInspector = new FloatingPropertiesInspector(app.graphCanvas);
        window.propertiesInspector = app.propertiesInspector;
        
        // Initialize Floating Color Correction Panel
        app.colorCorrectionPanel = new FloatingColorCorrection(app.graphCanvas);
        window.colorCorrectionPanel = app.colorCorrectionPanel;
        
        // Create Properties Inspector Toggle Button
        app.createPropertiesButton();
        
        // Set up visibility sync between button and inspector
        app.propertiesInspector.setVisibilityCallback((isVisible) => {
            app.propertiesBtn.classList.toggle('active', isVisible);
        });
        
        // Create Color Correction Toggle Button
        app.createColorCorrectionButton();
        
        // Set up visibility sync between button and panel
        app.colorCorrectionPanel.setVisibilityCallback((isVisible) => {
            app.colorCorrectionBtn.classList.toggle('active', isVisible);
        });
        
        // Initialize Navigation State Manager
        app.navigationStateManager = new NavigationStateManager(app);
        window.navigationStateManager = app.navigationStateManager;
        
        // Initialize Gallery View Manager
        app.galleryViewManager = new GalleryViewManager(app);
        window.galleryViewManager = app.galleryViewManager;
        app.graphCanvas.galleryViewManager = app.galleryViewManager;
        
        // Add event listener for node added to graph
        app.graph.onNodeAdded = (node) => {
            
            // If the node has an initSubscriptions method, call it.
            // This ensures that subscriptions are set up after all managers are initialized.
            if (typeof node.initSubscriptions === 'function') {
                node.initSubscriptions();
            }
        };

        // Undo/Redo Manager
        app.undoManager = new ClientUndoManager(app.graph, app.operationPipeline);

        // Load last canvas or create default
        // Use more robust initialization that doesn't strictly depend on collaborative architecture
        setTimeout(() => {
            
            let attempts = 0;
            const maxAttempts = 20; // 10 seconds max wait
            
            // Check if essential components are ready (with fallback)
            const checkAndLoad = () => {
                attempts++;
                
                // Check if we have the essential components needed for startup
                const hasEssentials = app.canvasNavigator && 
                                    (app.networkLayer || attempts > 10); // Allow fallback after 5 seconds
                
                const isArchitectureReady = app.collaborativeArchitecture?.initialized;
                
                if (isArchitectureReady || (hasEssentials && attempts > 6)) {

                    // Initialize NavigationStateManager if available
                    if (app.navigationStateManager) {
                        app.navigationStateManager.initialize();
                    }
                    
                    // Ensure extended commands are registered
                    if (app.operationPipeline && app.operationPipeline.registerExtendedCommands) {
                        
                        app.operationPipeline.registerExtendedCommands();
                    }
                    
                    // Load startup canvas
                    if (app.canvasNavigator?.loadStartupCanvas) {
                        app.canvasNavigator.loadStartupCanvas().catch(error => {
                            console.error('❌ Failed to load startup canvas:', error);
                            // Continue anyway, user can manually open navigator
                        });
                    } else {
                        
                    }
                    
                } else if (attempts >= maxAttempts) {

                    // Still try to load if we have canvas navigator
                    if (app.canvasNavigator?.loadStartupCanvas) {
                        app.canvasNavigator.loadStartupCanvas().catch(error => {
                            console.error('❌ Fallback startup canvas load failed:', error);
                        });
                    }
                    
                } else {
                    console.log(`⏳ Waiting for components... (${attempts}/${maxAttempts})`);
                    setTimeout(checkAndLoad, 500);
                }
            };
            
            checkAndLoad();
        }, 500);
        
    } catch (error) {
        console.error('Failed to initialize application:', error);
    }
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// Debug shortcut for database wipe (Ctrl+Shift+Delete)
document.addEventListener('keydown', async (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'Delete') {
        e.preventDefault();
        
        // Create confirmation dialog
        const backdrop = document.createElement('div');
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #2a2a2a;
            border: 2px solid #ff4444;
            border-radius: 8px;
            padding: 30px;
            max-width: 500px;
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        
        dialog.innerHTML = `
            <h2 style="margin: 0 0 20px 0; color: #ff4444;">⚠️ Complete Database Wipe</h2>
            <p style="margin: 0 0 20px 0; line-height: 1.5;">
                This will <strong>permanently delete</strong>:
            </p>
            <ul style="margin: 0 0 20px 0; padding-left: 20px; line-height: 1.8;">
                <li>All projects and canvases</li>
                <li>All uploaded images and videos</li>
                <li>All thumbnails and transcoded files</li>
                <li>All database records</li>
                <li>Browser cache and IndexedDB</li>
            </ul>
            <p style="margin: 0 0 25px 0; color: #ffaa44;">
                <strong>This action cannot be undone!</strong>
            </p>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="wipe-cancel" style="
                    padding: 10px 20px;
                    background: #444;
                    border: none;
                    color: #fff;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                ">Cancel</button>
                <button id="wipe-confirm" style="
                    padding: 10px 20px;
                    background: #ff4444;
                    border: none;
                    color: #fff;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: bold;
                ">Wipe Everything</button>
            </div>
        `;
        
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
        
        // Handle dialog actions
        const cancelBtn = document.getElementById('wipe-cancel');
        const confirmBtn = document.getElementById('wipe-confirm');
        
        const closeDialog = () => {
            backdrop.remove();
        };
        
        cancelBtn.onclick = closeDialog;
        backdrop.onclick = (e) => {
            if (e.target === backdrop) closeDialog();
        };
        
        confirmBtn.onclick = async () => {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Wiping...';
            
            try {
                // 1. Clear client-side storage
                console.log('🧹 Clearing browser storage...');
                
                // Clear IndexedDB
                const databases = ['ImageCanvasThumbnails', 'ThumbnailStore', 'ImageCanvasDB', 'imageCanvas'];
                for (const dbName of databases) {
                    try {
                        await new Promise((resolve) => {
                            const deleteReq = indexedDB.deleteDatabase(dbName);
                            deleteReq.onsuccess = resolve;
                            deleteReq.onerror = resolve;
                            deleteReq.onblocked = () => setTimeout(resolve, 100);
                        });
                        console.log(`✅ Deleted IndexedDB: ${dbName}`);
                    } catch (e) {
                        // Ignore errors
                    }
                }
                
                // Clear localStorage - but be selective to preserve user preferences
                const keysToPreserve = ['DEBUG', 'DEBUG_COLLAB', 'username', 'imagecanvas_username'];
                const preservedValues = {};
                
                // Save values we want to keep
                keysToPreserve.forEach(key => {
                    const value = localStorage.getItem(key);
                    if (value !== null) {
                        preservedValues[key] = value;
                    }
                });
                
                // Clear everything
                localStorage.clear();
                
                // Restore preserved values
                Object.entries(preservedValues).forEach(([key, value]) => {
                    localStorage.setItem(key, value);
                });
                
                console.log('✅ Cleared localStorage (preserved user preferences)');
                
                // Clear sessionStorage
                sessionStorage.clear();
                console.log('✅ Cleared sessionStorage');
                
                // Clear canvas-related localStorage items
                localStorage.removeItem('lastCanvasId');
                localStorage.removeItem('currentCanvasId');
                localStorage.removeItem('activeCanvasId');
                console.log('✅ Cleared canvas references from localStorage');
                
                // Clear caches
                if (window.imageCache) window.imageCache.clear();
                if (window.thumbnailCache) window.thumbnailCache.clear();
                if (window.offscreenRenderCache) window.offscreenRenderCache.clear();
                console.log('✅ Cleared memory caches');
                
                // Clear canvas navigator cache if it exists
                if (window.app?.canvasNavigator) {
                    window.app.canvasNavigator.canvases = [];
                    window.app.canvasNavigator.currentCanvasId = null;
                    console.log('✅ Cleared canvas navigator cache');
                }
                
                // 2. Call server endpoint to wipe database
                console.log('🗄️ Wiping server database...');
                
                // Add timeout to prevent infinite hanging
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
                
                const response = await fetch(`${CONFIG.SERVER.API_BASE}/debug/wipe-database`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        confirm: true,
                        includeFiles: true
                    }),
                    signal: controller.signal
                }).finally(() => clearTimeout(timeoutId));
                
                if (!response.ok) {
                    throw new Error(`Server wipe failed: ${response.status}`);
                }
                
                const result = await response.json();
                console.log('✅ Server wipe complete:', result);
                
                // 3. Show success and reload
                confirmBtn.textContent = 'Complete! Reloading...';
                confirmBtn.style.background = '#44ff44';
                
                // Wait a bit longer to ensure database operations complete
                setTimeout(() => {
                    // Force hard reload to bypass any caches
                    // Use location.href to ensure complete reload
                    window.location.href = window.location.href.split('?')[0] + '?t=' + Date.now();
                }, 2000);
                
            } catch (error) {
                console.error('❌ Wipe failed:', error);
                confirmBtn.textContent = 'Failed!';
                confirmBtn.style.background = '#ff0000';
                
                // Show error
                const errorMsg = document.createElement('p');
                errorMsg.style.cssText = 'color: #ff6666; margin-top: 15px;';
                errorMsg.textContent = `Error: ${error.message}`;
                dialog.appendChild(errorMsg);
                
                // Re-enable button after delay
                setTimeout(() => {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = 'Wipe Everything';
                    confirmBtn.style.background = '#ff4444';
                }, 3000);
            }
        };
        
        // Focus on cancel button by default (safety)
        cancelBtn.focus();
    }
});

// Handle errors gracefully
window.addEventListener('error', (event) => {
    // Ignore benign ResizeObserver errors
    if (event.message && event.message.includes('ResizeObserver loop')) {
        event.preventDefault();
        return;
    }
    
    console.error('Application error:', event.error);
    if (event.error === null) {
        console.error('Null error details:', event);
        console.error('Error message:', event.message);
        console.error('Error filename:', event.filename);
        console.error('Error line:', event.lineno);
        console.error('Error column:', event.colno);
    }
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    event.preventDefault();
});