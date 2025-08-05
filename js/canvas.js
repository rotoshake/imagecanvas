// ===================================
// MAIN CANVAS CLASS
// ===================================

class ImageCanvas {
    constructor(canvas, graph) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', {
            alpha: false, // No alpha channel needed for main canvas
            desynchronized: true, // Better performance
            willReadFrequently: false // Force GPU acceleration
        });
        this.graph = graph;
        this.graph.canvas = this;
        
        // Core systems
        this.viewport = new ViewportManager(canvas, this);
        this.selection = new SelectionManager(this.viewport);
        this.handleDetector = new HandleDetector(this.viewport, this.selection);
        this.animationSystem = new AnimationSystem();
        this.alignmentManager = new AutoAlignmentManager(this);
        
        // Keyboard shortcuts system
        this.shortcutManager = null; // Will be initialized after config loads
        
        // State
        this.dirty_canvas = true;
        this.dirty_nodes = new Set(); // Track which specific nodes need redrawing
        this.mouseState = this.createMouseState();
        this.interactionState = this.createInteractionState();
        this._renderLoopId = null; // Track render loop to prevent duplicates
        this._animatingGroups = new Set(); // Track groups that are currently animating
        
        // Performance
        this.frameCounter = 0;
        this.lastFrameTime = performance.now();
        this.fps = 0;
        
        // FPS Test Mode
        this.fpsTestMode = 'normal'; // 'normal', 'minimal', 'nocap', 'noanimations', 'noloading'
        this.frameTimes = [];
        
        // Spacebar tracking for panning
        this.spacePressed = false;
        this.maxFrameTimeSamples = 120; // Keep last 2 seconds at 60fps
        this.isTestModeActive = false;
        
        // Visibility caching
        this.cachedVisibleNodes = null;
        this.lastViewportState = null;
        
        // Async loading management
        this.loadingQueue = new Set();
        this.preloadQueue = new Set();
        this.maxConcurrentLoads = 3;
        this.currentLoads = 0;
        
        // Undo/redo (will be connected to StateManager)
        this.stateManager = null;
        
        // Clipboard for copy/paste
        this.clipboard = [];
        
        // Initialize action manager
        this.actionManager = null; // Will be set when collaborative manager is ready
        
        // Gallery view manager
        this.galleryViewManager = null; // Will be set by app
        
        // Initialize
        this.setupEventListeners();
        this.initializeShortcutManager();
        this.viewport.applyDPI();
        this.animationSystem.start();
        this.startRenderLoop();
        this.startPreloadLoop();
        
        // Ensure at least one initial draw happens
        setTimeout(() => {
            this.dirty_canvas = true;
        }, 100);
        
        console.log('ImageCanvas initialized');
        
        // Setup FPS testing helpers for console (with delay to ensure everything is ready)
        setTimeout(() => {
            this.setupFPSTestingHelpers();
        }, 100);
        
        // Initialize renderer abstraction
        const rendererMode = (window.CONFIG?.RENDERER?.DEFAULT || 'canvas2d').toLowerCase();
        try {
            if (rendererMode === 'webgl' && typeof WebGLRenderer !== 'undefined') {
                this.renderer = new WebGLRenderer(this);
            } else if (typeof Canvas2DRenderer !== 'undefined') {
                this.renderer = new Canvas2DRenderer(this);
            }
        } catch (error) {
            console.error('Error creating renderer:', error);
            // Fall back to Canvas2D if WebGL fails
            if (rendererMode === 'webgl' && typeof Canvas2DRenderer !== 'undefined') {
                this.renderer = new Canvas2DRenderer(this);
            }
        }
        
        // --- UI overlay canvas (for selection UI) ---
        {
            const parent = canvas.parentNode || document.body;
            this.uiCanvas = document.createElement('canvas');
            this.uiCanvas.style.position = 'absolute';
            this.uiCanvas.style.top = '0';
            this.uiCanvas.style.left = '0';
            this.uiCanvas.style.pointerEvents = 'none';
            this.uiCanvas.style.zIndex = '2';
            parent.appendChild(this.uiCanvas);
            this.uiCtx = this.uiCanvas.getContext('2d');
        }

        this._resizeUICanvas = () => {
            if (!this.uiCanvas) return;
            const dpr = window.devicePixelRatio || 1;
            const rect = this.canvas.getBoundingClientRect();
            this.uiCanvas.width = rect.width * dpr;
            this.uiCanvas.height = rect.height * dpr;
            this.uiCanvas.style.width = rect.width + 'px';
            this.uiCanvas.style.height = rect.height + 'px';
        };
        this._resizeUICanvas();
    }
    
    createMouseState() {
        return {
            canvas: [0, 0],
            graph: [0, 0],
            last: [0, 0],
            down: false,
            button: -1
        };
    }
    
    createInteractionState() {
        return {
            dragging: {
                canvas: false,
                node: null,
                nodes: new Map(),
                offsets: new Map(),
                isDuplication: false,  // Track if this drag is from duplication
                hasMoved: false,       // Track if actual movement occurred
                potentialGroup: null,  // Group that nodes might be added to
                nodesOverGroup: new Set(), // Nodes currently over a group
                draggedFromGroup: null // Group that nodes were dragged from (for removal)
            },
            resizing: {
                active: false,
                type: null,
                node: null,
                nodes: new Set(),
                initial: new Map(),
                shiftKey: false,
                initialBBox: null
            },
            rotating: {
                active: false,
                type: null,
                node: null,
                nodes: new Set(),
                center: [0, 0],
                initialAngle: 0,
                initial: new Map()
            },
            selecting: {
                active: false,
                startGraph: [0, 0]
            }
        };
    }
    
    setupEventListeners() {
        // Mouse events
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('wheel', this.onMouseWheel.bind(this));
        this.canvas.addEventListener('contextmenu', e => e.preventDefault());
        this.canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));
        
        // Keyboard events
        document.addEventListener('keydown', this.onKeyDown.bind(this));
        document.addEventListener('keyup', this.onKeyUp.bind(this));
        
        // Window resize - debounced to prevent flicker
        this.debouncedResize = Utils.debounce(this.onWindowResize.bind(this), 100);
        window.addEventListener('resize', this.debouncedResize);
        // Call resize immediately to set initial size
        this.onWindowResize();
        
        // Selection callbacks
        this.selection.addCallback(this.onSelectionChanged.bind(this));
    }
    
    initializeShortcutManager() {
        // Initialize keyboard shortcut manager if available
        if (typeof KeyboardShortcutManager !== 'undefined') {
            this.shortcutManager = new KeyboardShortcutManager(this);
        } else {
            console.warn('KeyboardShortcutManager not available - using fallback keyboard handling');
        }
    }
    
    // Helper methods to check if drag shortcuts are enabled
    isPanDragEnabled(event) {
        if (!this.shortcutManager) {
            // Fallback to hardcoded behavior
            return event.ctrlKey || event.metaKey || this.spacePressed;
        }
        
        // Check if pan shortcuts match current event
        const panShortcut = this.shortcutManager.getShortcut('NAVIGATION', 'PAN');
        const panAltShortcut = this.shortcutManager.getShortcut('NAVIGATION', 'PAN_ALT');
        
        // Space key panning
        if (panShortcut && this.spacePressed) {
            return true;
        }
        
        // Ctrl/Cmd panning (if enabled in config)
        if (panAltShortcut && (event.ctrlKey || event.metaKey)) {
            return true;
        }
        
        return false;
    }
    
    isDuplicateDragEnabled(event) {
        if (!this.shortcutManager) {
            // Fallback to hardcoded behavior
            return event.altKey;
        }
        
        const duplicateShortcut = this.shortcutManager.getShortcut('NODE_OPERATIONS', 'DUPLICATE_DRAG');
        return duplicateShortcut && window.matchesShortcut && window.matchesShortcut(event, duplicateShortcut);
    }
    
    isAutoAlignDragEnabled(event) {
        if (!this.shortcutManager) {
            // Fallback to hardcoded behavior
            return event.shiftKey;
        }
        
        const alignShortcut = this.shortcutManager.getShortcut('SELECTION', 'AUTO_ALIGN');
        return alignShortcut && window.matchesShortcut && window.matchesShortcut(event, alignShortcut);
    }
    
    isToggleSelectEnabled(event) {
        if (!this.shortcutManager) {
            // Fallback to hardcoded behavior
            return event.shiftKey && !event.ctrlKey && !event.metaKey;
        }
        
        const toggleShortcut = this.shortcutManager.getShortcut('SELECTION', 'TOGGLE_SELECT');
        return toggleShortcut && event.shiftKey && !event.ctrlKey && !event.metaKey;
    }
    
    isZoomModifierEnabled(event) {
        // For now, keep zoom modifier hardcoded since it's not in the config
        // This could be made configurable in the future
        return event.ctrlKey || event.metaKey;
    }
    
    isGridAlignEnabled(event) {
        if (!this.shortcutManager) {
            // Fallback to hardcoded behavior
            return (event.ctrlKey || event.metaKey) && event.shiftKey;
        }
        
        const gridAlignShortcut = this.shortcutManager.getShortcut('SELECTION', 'GRID_ALIGN');
        return gridAlignShortcut && (event.ctrlKey || event.metaKey) && event.shiftKey;
    }
    
    isRotationSnapEnabled(event) {
        if (!this.shortcutManager) {
            // Fallback to hardcoded behavior
            return event.shiftKey;
        }
        
        const rotationSnapShortcut = this.shortcutManager.getShortcut('SELECTION', 'ROTATION_SNAP');
        return rotationSnapShortcut && event.shiftKey;
    }
    
    isResizeAspectLockEnabled(event) {
        if (!this.shortcutManager) {
            // Fallback to hardcoded behavior
            return event.shiftKey;
        }
        
        const aspectLockShortcut = this.shortcutManager.getShortcut('SELECTION', 'RESIZE_ASPECT_LOCK');
        return aspectLockShortcut && event.shiftKey;
    }
    
    isResizeFromCenterEnabled(event) {
        if (!this.shortcutManager) {
            // Fallback to hardcoded behavior
            return event.ctrlKey || event.metaKey;
        }
        
        const resizeFromCenterShortcut = this.shortcutManager.getShortcut('SELECTION', 'RESIZE_FROM_CENTER');
        return resizeFromCenterShortcut && (event.ctrlKey || event.metaKey);
    }
    
    startRenderLoop() {
        // Prevent multiple render loops
        if (this._renderLoopId) {
            console.warn('Render loop already running, skipping duplicate start');
            return;
        }
        
        // Track loading state check timing
        let lastLoadingCheck = 0;
        const LOADING_CHECK_INTERVAL = 100; // Check every 100ms - balanced performance/responsiveness
        
        // Track which nodes were loading to detect when they finish
        const loadingNodeIds = new Set();
        
        // Track actively loading nodes for efficient checks
        const activelyLoadingNodes = new Map(); // nodeId -> node reference
        
        // FPS limiting
        let lastRenderTime = 0;
        const targetFrameTime = 1000 / CONFIG.PERFORMANCE.MAX_FPS; // milliseconds per frame
        
        // Test mode render loops - but allow dynamic switching
        if (this.fpsTestMode !== 'normal') {
            this.startTestRenderLoop();
            return;
        }
        
        // Use requestAnimationFrame for efficient rendering
        const renderFrame = (currentTime) => {
            // Apply FPS limiting based on config
            if (CONFIG.PERFORMANCE.USE_FPS_LIMIT) {
                const timeSinceLastRender = currentTime - lastRenderTime;
                
                // Skip this frame if we haven't reached the target frame time
                if (timeSinceLastRender < targetFrameTime) {
                    this._renderLoopId = requestAnimationFrame(renderFrame);
                    return;
                }
            }
            // If USE_FPS_LIMIT is false, we let RAF handle natural display sync
            
            // Calculate deltaTime BEFORE updating lastRenderTime  
            const deltaTime = lastRenderTime > 0 ? currentTime - lastRenderTime : 16.67;
            
            // Count this as a potential frame for accurate FPS measurement
            this.updatePerformanceStats(currentTime);
            lastRenderTime = currentTime;
            
            const now = Date.now();
            let shouldDraw = this.dirty_canvas;
            let renderReasons = [];
            
            if (this.dirty_canvas) renderReasons.push('dirty');
            
            // Debug: Track why we're rendering
            if (window.DEBUG_RENDER_REASONS && renderReasons.length > 0) {
                console.log(`🎬 Render triggered by: ${renderReasons.join(', ')}`);
            }
            
            // Periodically check if we have loading nodes
            if (now - lastLoadingCheck > LOADING_CHECK_INTERVAL) {
                lastLoadingCheck = now;
                
                // First, check if any new nodes need to start loading
                if (this.graph && this.graph.nodes) {
                    for (const node of this.graph.nodes) {
                        if ((node.type === 'media/image' || node.type === 'canvas/image' || node.type === 'image') &&
                            !activelyLoadingNodes.has(node.id)) {
                            // Check if this node needs to start loading
                            const needsLoading = node.loadingState === 'loading' || 
                                   (node.loadingState === 'idle' && 
                                    (node.properties?.serverUrl || node.properties?.hash) && 
                                    !node.img);
                            
                            if (needsLoading) {
                                activelyLoadingNodes.set(node.id, node);
                                loadingNodeIds.add(node.id);
                            }
                        }
                    }
                }
                
                // Now check only the actively loading nodes
                const finishedNodes = [];
                for (const [nodeId, node] of activelyLoadingNodes) {
                    if (node.loadingState === 'loaded' || node.img) {
                        // This node finished loading!
                        finishedNodes.push(nodeId);
                        shouldDraw = true;
                    }
                }
                
                // Remove finished nodes from tracking
                for (const nodeId of finishedNodes) {
                    activelyLoadingNodes.delete(nodeId);
                    loadingNodeIds.delete(nodeId);
                }
                
                // Trigger redraw if we have loading nodes
                if (activelyLoadingNodes.size > 0) {
                    shouldDraw = true;
                    renderReasons.push(`loading(${activelyLoadingNodes.size})`);
                }
            }
            
            // Update alignment animations
            if (this.alignmentManager) {
                this.alignmentManager.updateAnimations();
            }
            
            // Update general animations (integrated for 120 FPS performance)
            const hasActiveAnimations = this.animationSystem && this.animationSystem.updateAnimations(deltaTime);
            
            // Check if any videos need updates - early exit if no video nodes exist
            let hasVideoUpdates = false;
            let videoOnlyUpdate = false;
            
            // Check whether graph has video nodes - recheck periodically or when nodes change
            // Invalidate cache if node count changed
            const currentNodeCount = this.graph.nodes ? this.graph.nodes.length : 0;
            if (this._hasVideoNodes === undefined || this._lastNodeCount !== currentNodeCount) {
                this._hasVideoNodes = this.graph.nodes && this.graph.nodes.some(n => n.type === 'media/video');
                this._lastNodeCount = currentNodeCount;
            }
            
            if (this._hasVideoNodes) {
                if (this.dirty_nodes.size > 0) {
                    // Check if we only have video node updates
                    videoOnlyUpdate = true;
                    for (const nodeId of this.dirty_nodes) {
                        const node = this.graph.getNodeById(nodeId);
                        if (!node || node.type !== 'media/video') {
                            videoOnlyUpdate = false;
                            break;
                        }
                        if (node.video && !node.video.paused) {
                            hasVideoUpdates = true;
                        }
                    }
                }
                
                // Also check for any playing videos that might not be in dirty_nodes yet
                if (!hasVideoUpdates && this.graph.nodes) {
                    hasVideoUpdates = this.graph.nodes.some(node => 
                        node.type === 'media/video' && node.video && !node.video.paused
                    );
                }
            }
            
            const hasActiveAlignment = this.alignmentManager && this.alignmentManager.isAnimating();
            const hasActiveViewportAnimation = this.viewport && this.viewport.isAnimating;
            const hasGroupAnimations = this._animatingGroups && this._animatingGroups.size > 0;
            
            if (hasVideoUpdates) {
                shouldDraw = true;
                renderReasons.push(videoOnlyUpdate ? 'video-only' : 'video');
            }
            if (hasActiveAlignment) {
                shouldDraw = true;
                renderReasons.push('alignment');
            }
            if (hasActiveViewportAnimation) {
                shouldDraw = true;
                renderReasons.push('viewport');
            }
            if (hasGroupAnimations) {
                shouldDraw = true;
                renderReasons.push('group-resize');
            }
            if (hasActiveAnimations) {
                shouldDraw = true;
                renderReasons.push('animations');
            }
            
            // Debug logging for render reasons
            if (window.DEBUG_FPS && shouldDraw && renderReasons.length > 0) {
                console.log(`🎯 Frame triggered by: ${renderReasons.join(', ')}`);
            }
            
            if (shouldDraw) {
                this.dirty_canvas = false;
                this.dirty_nodes.clear(); // Clear dirty nodes after drawing
                this.draw();
            }
            
            // Only continue the render loop if we have ongoing animations or updates
            const needsContinuousUpdates = hasActiveAnimations || 
                                         hasActiveAlignment || 
                                         hasActiveViewportAnimation || 
                                         hasVideoUpdates ||
                                         activelyLoadingNodes.size > 0 ||
                                         hasGroupAnimations;
            
            if (needsContinuousUpdates || this.dirty_canvas || this.dirty_nodes.size > 0) {
                this._renderLoopId = requestAnimationFrame(renderFrame);
            } else {
                // Stop the loop - it will restart when something changes
                this._renderLoopId = null;
            }
        };
        
        // Start the loop
        this._renderLoopId = requestAnimationFrame(renderFrame);
        
        // Set up a getter/setter to restart the loop when canvas becomes dirty
        this._setupDirtyCanvasWatcher();
    }
    
    _setupDirtyCanvasWatcher() {
        // Only set up once
        if (this._dirtyCanvasWatcherSetup) return;
        this._dirtyCanvasWatcherSetup = true;
        
        // Store the actual dirty state
        this._dirty_canvas_internal = this.dirty_canvas || false;
        
        // Override the property to restart render loop when set to true
        Object.defineProperty(this, 'dirty_canvas', {
            get() {
                return this._dirty_canvas_internal;
            },
            set(value) {
                this._dirty_canvas_internal = value;
                
                // If setting to true and render loop is not running, restart it
                if (value === true && !this._renderLoopId) {
                    this.startRenderLoop();
                }
            },
            configurable: true
        });
    }
    
    startTestRenderLoop() {
        // Prevent multiple render loops
        if (this._renderLoopId) {
            console.warn('Test render loop already running, skipping duplicate start');
            return;
        }
        
        console.log(`🧪 FPS Test Mode: ${this.fpsTestMode}`);
        
        let lastRenderTime = 0;
        
        const testRenderFrame = (currentTime) => {
            // Track frame times for statistics
            if (lastRenderTime > 0) {
                const frameTime = currentTime - lastRenderTime;
                this.frameTimes.push(frameTime);
                if (this.frameTimes.length > this.maxFrameTimeSamples) {
                    this.frameTimes.shift();
                }
            }
            
            // Different test modes
            switch (this.fpsTestMode) {
                case 'minimal':
                    // Truly minimal - just clear and draw basic background
                    this.updatePerformanceStats(currentTime);
                    
                    const ctx = this.ctx;
                    const canvas = this.canvas;
                    
                    // Clear canvas
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    
                    // Draw basic background
                    ctx.fillStyle = ColorUtils.get('backgrounds', 'canvas_primary');
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    
                    // Draw simple FPS indicator
                    ctx.fillStyle = ColorUtils.get('accents', 'primary');
                    ctx.font = `16px ${FONT_CONFIG.MONO_FONT_CANVAS}`;
                    ctx.fillText(`MINIMAL MODE - FPS: ${this.fps}`, 10, 30);
                    break;
                    
                case 'nocap':
                    // Normal render but no FPS cap
                    this.updatePerformanceStats(currentTime);
                    this.dirty_canvas = true; // Force continuous draw
                    this.draw();
                    break;
                    
                case 'noanimations':
                    // Normal render but skip all animation updates
                    this.updatePerformanceStats(currentTime);
                    this.dirty_canvas = true;
                    this.draw();
                    break;
                    
                case 'noloading':
                    // Normal render but skip loading checks
                    this.updatePerformanceStats(currentTime);
                    this.dirty_canvas = true;
                    this.draw();
                    break;
            }
            
            lastRenderTime = currentTime;
            this._renderLoopId = requestAnimationFrame(testRenderFrame);
        };
        
        this._renderLoopId = requestAnimationFrame(testRenderFrame);
    }
    
    setFPSTestMode(mode) {
        const validModes = ['normal', 'minimal', 'nocap', 'noanimations', 'noloading'];
        if (!validModes.includes(mode)) {
            console.error(`Invalid FPS test mode: ${mode}. Valid modes: ${validModes.join(', ')}`);
            return;
        }
        
        const oldMode = this.fpsTestMode;
        
        // Stop existing render loop before switching
        if (this._renderLoopId) {
            cancelAnimationFrame(this._renderLoopId);
            this._renderLoopId = null;
        }
        
        this.fpsTestMode = mode;
        this.frameTimes = []; // Reset frame time samples
        
        console.log(`🧪 FPS Test Mode changed to: ${mode}`);
        
        // If switching from normal mode to a test mode, start the test render loop
        if (oldMode === 'normal' && mode !== 'normal') {
            console.log('🚀 Starting test render loop immediately...');
            this.isTestModeActive = true;
            this.startTestRenderLoop();
        } else if (mode === 'normal') {
            console.log('📊 FPS Test Mode disabled. Reload to return to normal rendering.');
            this.isTestModeActive = false;
        } else {
            console.log('✅ Test mode updated');
        }
        
        // Force canvas redraw to show mode change in stats
        this.dirty_canvas = true;
    }
    
    getFrameTimeStats() {
        if (this.frameTimes.length === 0) return null;
        
        const sorted = [...this.frameTimes].sort((a, b) => a - b);
        const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
        const p50 = sorted[Math.floor(sorted.length * 0.5)];
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const p99 = sorted[Math.floor(sorted.length * 0.99)];
        
        return {
            samples: sorted.length,
            avg: avg.toFixed(2),
            p50: p50.toFixed(2),
            p95: p95.toFixed(2),
            p99: p99.toFixed(2),
            avgFPS: (1000 / avg).toFixed(1),
            p50FPS: (1000 / p50).toFixed(1)
        };
    }
    
    showFPSTestMenu() {
        const modes = [
            { key: '1', mode: 'normal', desc: 'Normal rendering' },
            { key: '2', mode: 'minimal', desc: 'Minimal (just draw)' },
            { key: '3', mode: 'nocap', desc: 'No FPS cap' },
            { key: '4', mode: 'noanimations', desc: 'No animations' },
            { key: '5', mode: 'noloading', desc: 'No loading checks' }
        ];
        
        let message = '🧪 FPS Test Modes:\n';
        modes.forEach(m => {
            const current = this.fpsTestMode === m.mode ? ' ✓' : '';
            message += `${m.key}: ${m.desc}${current}\n`;
        });
        message += '\nPress a number key or ESC to cancel';
        
        // Always show in console
        console.log(message);
        
        if (this.showNotification) {
            this.showNotification({
                type: 'info',
                message: message,
                duration: 10000
            });
        } else {
            // Fallback: Create a temporary overlay
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.9);
                color: white;
                padding: 20px;
                font-family: monospace;
                font-size: 14px;
                white-space: pre;
                z-index: 10000;
                border: 2px solid #4af;
                border-radius: 8px;
            `;
            overlay.textContent = message;
            document.body.appendChild(overlay);
            
            // Remove overlay after selection or timeout
            const removeOverlay = () => {
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
            };
            setTimeout(removeOverlay, 10000);
            
            // Store removal function for cleanup
            this._fpsMenuCleanup = removeOverlay;
        }
        
        // Listen for next key press
        const handleKey = (e) => {
            const key = e.key;
            const mode = modes.find(m => m.key === key);
            
            if (mode) {
                this.setFPSTestMode(mode.mode);
                document.removeEventListener('keydown', handleKey);
                
                // Clean up overlay if exists
                if (this._fpsMenuCleanup) {
                    this._fpsMenuCleanup();
                    this._fpsMenuCleanup = null;
                }
                
                // Show stats after mode change
                setTimeout(() => {
                    this.showFPSStats();
                }, 100);
            } else if (key === 'Escape') {
                document.removeEventListener('keydown', handleKey);
                
                // Clean up overlay if exists
                if (this._fpsMenuCleanup) {
                    this._fpsMenuCleanup();
                    this._fpsMenuCleanup = null;
                }
            }
        };
        
        document.addEventListener('keydown', handleKey);
    }
    
    showFPSStats() {
        const stats = this.getFrameTimeStats();
        if (!stats) {
            console.log('📊 No frame time data available yet');
            return;
        }
        
        const message = `📊 Frame Time Stats:
Samples: ${stats.samples}
Avg: ${stats.avg}ms (${stats.avgFPS} FPS)
P50: ${stats.p50}ms (${stats.p50FPS} FPS)
P95: ${stats.p95}ms
P99: ${stats.p99}ms
Mode: ${this.fpsTestMode}`;
        
        console.log(message);
        
        if (this.showNotification) {
            this.showNotification({
                type: 'info',
                message: message,
                duration: 5000
            });
        }
    }
    
    setupFPSTestingHelpers() {
        // Add global FPS testing functions to window for easy console access
        window.testFPS = (mode) => {
            const modes = { 1: 'normal', 2: 'minimal', 3: 'nocap', 4: 'noanimations', 5: 'noloading' };
            const modeName = modes[mode] || mode;
            
            if (!['normal', 'minimal', 'nocap', 'noanimations', 'noloading'].includes(modeName)) {
                console.log('Invalid mode. Use: testFPS(2) for minimal, testFPS(3) for no cap, etc.');
                return;
            }
            
            this.setFPSTestMode(modeName);
            console.log(`✅ FPS Test Mode set to: ${modeName} - Reload to activate`);
        };
        
        window.fpsStats = () => {
            const stats = this.getFrameTimeStats();
            console.log(`Current FPS: ${this.fps}`);
            console.log(`Test Mode: ${this.fpsTestMode}`);
            
            if (stats && stats.samples > 0) {
                console.log(`Frame Stats: ${stats.avg}ms avg (${stats.avgFPS} FPS), ${stats.p50}ms median`);
            }
        };
        
        console.log('📊 FPS Testing: Use testFPS(2) or Ctrl+Shift+F');
    }
    
    
    // ===================================
    // EVENT HANDLERS
    // ===================================
    
    onMouseDown(e) {
        // In gallery mode, skip node interactions but allow canvas panning
        const isGalleryMode = this.galleryViewManager && this.galleryViewManager.active;
        
        // Finish any active text editing
        if (this._editingTextInput) {
            this.finishTextEditing();
        }

        const [x, y] = this.viewport.convertCanvasToOffset(e.clientX, e.clientY);
        this.mouseState.canvas = [x, y];
        this.mouseState.graph = this.viewport.convertOffsetToGraph(x, y);
        this.mouseState.last = [x, y];
        this.mouseState.down = true;
        this.mouseState.button = e.button;
        
        // Debug: log all properties of node under mouse (commented out to reduce console noise)
        // const node = this.handleDetector.getNodeAtPosition(...this.mouseState.graph, this.graph.nodes);
        // if (node) {
        //     console.group(`Node Debug: ${node.title || node.type} (id: ${node.id})`);
        //     console.log('type:', node.type);
        //     console.log('id:', node.id);
        //     console.log('pos:', node.pos);
        //     console.log('size:', node.size);
        //     console.log('rotation:', node.rotation);
        //     console.log('aspectRatio:', node.aspectRatio);
        //     console.log('properties:', node.properties);
        //     console.log('flags:', node.flags);
        //     if (typeof node.getVideoInfo === 'function') {
        //         console.log('videoInfo:', node.getVideoInfo());
        //     }
        //     console.groupEnd();
        // }
        
        // Stop any active animations that might interfere
        if (this.alignmentManager && this.alignmentManager.isAnimating()) {
            this.alignmentManager.stopAll();
        }
        
        // GRID ALIGN MODE TRIGGER (TAKES PRECEDENCE)
        if (this.isGridAlignEnabled(e) && e.button === 0) {
            
            if (this.alignmentManager && this.alignmentManager.startGridAlign(this.mouseState.graph)) {
                e.preventDefault();
                return;
            }
        }

        // Handle different interaction modes in priority order
        if (this.handlePanMode(e)) return;
        
        // In gallery mode, skip node interactions (only allow panning)
        if (isGalleryMode) {
            e.preventDefault();
            return;
        }
        
        if (this.handleRotationMode(e)) return;
        if (this.handleResizeMode(e)) return;
        if (this.handleNodeDrag(e)) return;
        if (this.handleAutoAlign(e)) return;
        if (this.handleSelection(e)) return;
        
        // If nothing was clicked, cancel any pending interaction
        window.app.undoManager.cancelInteraction();

        e.preventDefault();
    }
    
    onMouseMove(e) {
        // Let normal mouse move handling work even in gallery mode
        // Gallery mode will skip node interactions in the mouse down handler
        
        const [x, y] = this.viewport.convertCanvasToOffset(e.clientX, e.clientY);
        this.mouseState.canvas = [x, y];
        this.mouseState.graph = this.viewport.convertOffsetToGraph(x, y);
        
        // Handle alignment modes first
        if (this.alignmentManager) {
            if (this.alignmentManager.gridAlignMode && this.alignmentManager.gridAlignDragging) {
                this.alignmentManager.updateGridAlign(this.mouseState.graph);
                // Invalidate bounding box cache during grid alignment dragging
                this.selection.invalidateBoundingBox();
                this.mouseState.last = [x, y];
                this.dirty_canvas = true;
                return;
            }
            
            if (this.alignmentManager.autoAlignMode) {
                this.alignmentManager.updateAutoAlign(this.mouseState.graph);
                this.mouseState.last = [x, y];
                this.dirty_canvas = true;
                return;
            }
        }
        
        // Regular interaction updates
        if (this.mouseState.down) {
            this.updateInteractions(e);
            // Only mark dirty when actually dragging/interacting
            this.dirty_canvas = true;
        }
        this.updateCursor();
        
        this.mouseState.last = [x, y];
        // Don't mark canvas dirty for simple mouse moves without interaction
    }
    
    onMouseUp(e) {
        // Handle alignment mode endings
        if (this.alignmentManager) {
            if (this.alignmentManager.autoAlignMode) {
                this.alignmentManager.finishAutoAlign();
                this.mouseState.down = false;
                this.mouseState.button = -1;
                this.dirty_canvas = true;
                return;
            }
            
            if (this.alignmentManager.gridAlignMode) {
                this.alignmentManager.finishGridAlign();
                this.mouseState.down = false;
                this.mouseState.button = -1;
                this.dirty_canvas = true;
                return;
            }
        }
        
        // Regular interaction cleanup
        this.finishInteractions();
        
        // Gallery mode spring-back check
        if (this.galleryViewManager && this.galleryViewManager.active) {
            if (this.galleryViewManager.handleMouseUp) {
                this.galleryViewManager.handleMouseUp(e);
            }
        }
        
        // DISABLED: Undo state is now handled by the OperationPipeline through node_duplicate operations
        // This prevents duplicate undo entries for duplication operations
        // if (this.interactionState.dragging.isDuplication) {
        //     this.pushUndoState();
        //     this.interactionState.dragging.isDuplication = false;
        // }
        
        // Still reset the duplication flag
        if (this.interactionState.dragging.isDuplication) {
            this.interactionState.dragging.isDuplication = false;
        }
        
        this.mouseState.down = false;
        this.mouseState.button = -1;
        this.dirty_canvas = true;
    }
    
    onMouseWheel(e) {
        e.preventDefault();
        
        const mousePos = this.mouseState.canvas || [0, 0];
        
        // Check for pinch zoom (ctrl key or cmd key on Mac)
        if (this.isZoomModifierEnabled(e)) {
            // Direct pinch zoom - no momentum
            const zoomScale = 1 - (e.deltaY * 0.01);
            const currentScale = this.viewport.scale;
            const targetScale = currentScale * zoomScale;
            
            // Apply zoom with the calculated scale
            this.viewport.scale = Utils.clamp(
                targetScale,
                CONFIG.CANVAS.MIN_SCALE,
                CONFIG.CANVAS.MAX_SCALE
            );
            
            if (this.viewport.scale !== currentScale) {
                const scaleDelta = this.viewport.scale / currentScale;
                this.viewport.offset[0] = mousePos[0] - (mousePos[0] - this.viewport.offset[0]) * scaleDelta;
                this.viewport.offset[1] = mousePos[1] - (mousePos[1] - this.viewport.offset[1]) * scaleDelta;
                this.viewport.validateState();
            }
        } else {
            // Always zoom on regular scroll (removed trackpad detection)
            const delta = e.deltaY < 0 ? -1 : 1; // Negative for zoom in (wheel up), positive for zoom out (wheel down)
            this.viewport.zoom(delta, mousePos[0], mousePos[1]);
        }
        
        // Notify viewport of movement for LOD optimization
        this.viewport.notifyMovement();
        
        // Update text editing overlay if active
        if (this._editingTextInput && this._editingTextNode) {
            this.positionTextEditingOverlay(this._editingTextInput, this._editingTextNode);
            this.updateTextEditingOverlaySize(this._editingTextInput, this._editingTextNode);
        }
        
        // Throttle preload queue clearing to avoid performance impact
        if (!this._preloadClearTimeout) {
            this._preloadClearTimeout = setTimeout(() => {
                this.clearPreloadQueue();
                this._preloadClearTimeout = null;
            }, 100);
        }
        
        this.dirty_canvas = true;
    }
    
    onDoubleClick(e) {
        console.log('Double-click detected at canvas:', this.mouseState.canvas);
        
        // Check for double-click on handles first
        const rotationHandle = this.handleDetector.getRotationHandle(...this.mouseState.canvas);
        if (rotationHandle) {
            console.log('Rotation handle double-click');
            const nodes = this.selection.getSelectedNodes();
            if (nodes.length > 0) {
                window.app.undoManager.beginInteraction(nodes);
                const finalValues = nodes.map(() => 0);
                window.app.undoManager.endInteraction('node_reset', { resetRotation: true, values: finalValues });
            }
            return;
        }
        
        const resizeHandle = this.handleDetector.getResizeHandle(...this.mouseState.canvas);
        console.log('Resize handle detected:', resizeHandle);
        if (resizeHandle) {
            const nodes = this.selection.getSelectedNodes();
            console.log('Selected nodes for resize:', nodes);
            if (nodes.length > 0) {
                // Check if all selected nodes are groups
                const allGroups = nodes.every(n => n.type === 'container/group');
                console.log('All groups?', allGroups);
                
                if (allGroups) {
                    console.log('Double-click resize: Fitting groups to children');
                    
                    // Begin undo interaction for all groups
                    window.app.undoManager.beginInteraction(nodes);
                    
                    // Collect resize data for all groups
                    const nodeIds = [];
                    const positions = [];
                    const sizes = [];
                    
                    // For groups, animate to fit contents (shrinking allowed)
                    for (const groupNode of nodes) {
                        console.log(`Processing group ${groupNode.id}, current bounds:`, {
                            pos: [...groupNode.pos],
                            size: [...groupNode.size],
                            childCount: groupNode.childNodes?.size || 0
                        });
                        
                        if (groupNode.updateBounds) {
                            // Store current bounds for undo
                            const oldBounds = {
                                pos: [...groupNode.pos],
                                size: [...groupNode.size]
                            };
                            
                            // Update bounds with shrinking allowed (expandOnly = false)
                            console.log('Calling updateBounds(false) to fit children...');
                            const newBounds = groupNode.updateBounds(false);
                            console.log('updateBounds returned:', newBounds);
                            
                            // The updateBounds method already starts the animation internally
                            // No need to call animateToBounds again here
                            
                            // Collect data for undo system
                            if (newBounds) {
                                nodeIds.push(groupNode.id);
                                positions.push([...newBounds.pos]);
                                sizes.push([...newBounds.size]);
                                
                                // Send resize command to sync using the NEW bounds
                                if (window.app?.operationPipeline) {
                                    const command = new window.NodeCommands.GroupNodeCommand({
                                        action: 'group_resize',
                                        groupId: groupNode.id,
                                        size: [...newBounds.size],
                                        position: [...newBounds.pos]
                                    });
                                    window.app.operationPipeline.executeCommand(command);
                                }
                            }
                        }
                    }
                    
                    // End undo interaction with group resize data
                    window.app.undoManager.endInteraction('group_resize', { 
                        nodeIds, 
                        positions,
                        sizes
                    });
                } else {
                    // For non-group nodes, reset aspect ratio as before
                    window.app.undoManager.beginInteraction(nodes);
                    const finalValues = nodes.map(n => n.originalAspect || 1);
                    window.app.undoManager.endInteraction('node_reset', { resetAspectRatio: true, values: finalValues });
                }
            }
            return;
        }
        
        // Check for title double-click first (since title area is outside node bounds)
        const nodes = this.graph.nodes || [];
        for (let i = nodes.length - 1; i >= 0; i--) {
            const node = nodes[i];
            if (this.canEditTitle(node, this.mouseState.graph)) {
                this.startTitleEditing(node, e);
                return;
            }
        }
        
        // Otherwise, check for node double-click
        const result = this.handleDetector.getNodeAtPosition(...this.mouseState.graph, this.graph.nodes);
        if (result) {
            let node = result;
            let interactionType = null;
            
            // Handle new format from group nodes
            if (result.node && result.interactionType) {
                node = result.node;
                interactionType = result.interactionType;
            }
            
            // Handle group-specific double-click actions
            if (node.type === 'container/group') {
                if (interactionType === 'titleBar') {
                    this.startTitleEditing(node, e);
                    return;
                } else if (interactionType === 'collapseButton') {
                    // Already handled in single click
                    return;
                }
                // Note: groups only respond to title bar double-clicks
                return;
            }
            
            // Check if this is a media node and we should enter gallery mode
            if (this.galleryViewManager && (node.type === 'media/image' || node.type === 'media/video')) {
                // Don't enter gallery mode if we're clicking on the title area
                if (!this.canEditTitle(node, this.mouseState.graph)) {
                    // Not clicking on title, enter gallery mode
                    this.galleryViewManager.enter(node);
                    return;
                }
                // Otherwise, let title editing take precedence
            }
            
            // Special handling for video nodes with multi-selection
            if (node.type === 'media/video' && this.selection.size() > 1) {
                // Toggle the clicked video
                if (node.onDblClick) {
                    node.onDblClick(e);
                }
                
                // Get the new state of the clicked video
                const clickedVideoState = node.properties.paused;
                
                // Broadcast the toggle for the clicked video (send playing state, not paused)
                this.broadcastVideoToggle(node.id, !clickedVideoState);
                
                // Apply the same state to all other selected video nodes
                const selectedNodes = this.selection.getSelectedNodes();
                for (const selectedNode of selectedNodes) {
                    if (selectedNode.type === 'media/video' && selectedNode.id !== node.id) {
                        if (clickedVideoState) {
                            selectedNode.pause();
                        } else {
                            selectedNode.play();
                        }
                        
                        // Broadcast toggle for each video (send playing state, not paused)
                        this.broadcastVideoToggle(selectedNode.id, !clickedVideoState);
                    }
                }
                
                this.pushUndoState();
                this.dirty_canvas = true;
                return;
            }
            
            // Call the node's onDblClick method if it exists
            if (node.onDblClick && node.onDblClick(e)) {
                return;
            }
            
            // Fallback to default behaviors
            if (node.type === 'media/text') {
                this.startTextEditing(node, e);
            }
            // Title editing is now handled before node detection
        }
        // else: do nothing on background double-click
    }
    
    onKeyDown(e) {
        // Track spacebar press for panning
        if (e.key === ' ' || e.code === 'Space') {
            this.spacePressed = true;
            // Update cursor to indicate pan mode if hovering over canvas
            if (this.canvas.style) {
                this.canvas.style.cursor = 'grab';
            }
        }
        
        if (this.isEditingText()) return;
        
        // Use shortcut manager for all keyboard shortcuts
        if (this.shortcutManager && this.shortcutManager.handleKeyEvent(e)) {
            e.preventDefault();
        }
    }
    
    onKeyUp(e) {
        // Track spacebar release
        if (e.key === ' ' || e.code === 'Space') {
            this.spacePressed = false;
            // Reset cursor
            if (this.canvas.style) {
                this.canvas.style.cursor = '';
            }
        }
    }
    
    onSelectionChanged(selection) {
        this.dirty_canvas = true;
        
        // Navigation state only needs to be saved on viewport changes, not selection changes
        // The selection state is part of the canvas state, not navigation state
    }
    
    onWindowResize() {
        // Update canvas size to match window size
        const dpr = window.devicePixelRatio || 1;
        
        // Get the size the canvas should be displayed at
        const displayWidth = window.innerWidth;
        const displayHeight = window.innerHeight;
        
        // Set the actual canvas size accounting for device pixel ratio
        this.canvas.width = displayWidth * dpr;
        this.canvas.height = displayHeight * dpr;
        
        // Scale the canvas back down using CSS
        this.canvas.style.width = displayWidth + 'px';
        this.canvas.style.height = displayHeight + 'px';
        
        // Update viewport DPR and apply transformations
        if (this.viewport) {
            this.viewport.dpr = dpr;
            // Apply DPI to reset canvas transformations
            this.viewport.applyDPI();
            if (this.uiCanvas) {
                this._resizeUICanvas();
            }
        }
        
        // Force immediate redraw
        this.dirty_canvas = true;
        this.draw();
    }
    
    // ===================================
    // INTERACTION HANDLERS
    // ===================================
    
    handlePanMode(e) {
        // Check for canvas pan using configurable shortcuts
        if (e.button === 0 && this.isPanDragEnabled(e)) {
            this.interactionState.dragging.canvas = true;
            // Update cursor to grabbing when dragging
            if (this.canvas.style) {
                this.canvas.style.cursor = 'grabbing';
            }
            return true;
        }
        
        // Alt+drag for node duplication (if enabled in config)
        if (e.button === 0 && this.isDuplicateDragEnabled(e)) {
            const result = this.handleDetector.getNodeAtPosition(...this.mouseState.graph, this.graph.nodes);
            if (result) {
                const node = result.node || result;
                // Allow duplication of all node types including groups
                this.startNodeDuplication(node, e);
                return true;
            }
        }
        
        // Middle mouse for canvas pan
        if (e.button === 1) {
            this.interactionState.dragging.canvas = true;
            return true;
        }
        
        return false;
    }
    
    
    handleRotationMode(e) {
        if (e.button !== 0) return false;
        
        const rotationHandle = this.handleDetector.getRotationHandle(...this.mouseState.canvas);
        if (rotationHandle) {
            this.startRotation(rotationHandle);
            return true;
        }
        return false;
    }
    
    handleResizeMode(e) {
        if (e.button !== 0) return false;
        
        const resizeHandle = this.handleDetector.getResizeHandle(...this.mouseState.canvas);
        if (resizeHandle) {
            this.startResize(resizeHandle);
            return true;
        }
        return false;
    }
    
    handleNodeDrag(e) {
        if (e.button !== 0) return false;
        
        const result = this.handleDetector.getNodeAtPosition(...this.mouseState.graph, this.graph.nodes);
        if (result) {
            // Handle different interaction types for groups
            if (result.node && result.interactionType) {
                const { node, interactionType } = result;
                
                switch (interactionType) {
                    case 'titleBar':
                        this.startGroupTitleBarDrag(node, e);
                        return true;
                    case 'resizeHandle':
                        this.startGroupResize(node, e);
                        return true;
                    case 'collapseButton':
                        this.toggleGroupCollapsed(node);
                        return true;
                    // Note: removed 'background' case - groups only selectable via title bar
                }
            } else {
                // Regular node
                this.startNodeDrag(result, e);
                return true;
            }
        }
        return false;
    }
    
    handleAutoAlign(e) {
        // Auto-align mode: Shift + left click on empty space with multi-selection (if enabled in config)
        if (this.isAutoAlignDragEnabled(e) && e.button === 0 && this.selection.size() > 1 &&
            !this.handleDetector.getNodeAtPosition(...this.mouseState.graph, this.graph.nodes)) {
            
            if (this.alignmentManager && this.alignmentManager.startAutoAlign(this.mouseState.graph)) {
                e.preventDefault();
                return true;
            }
        }
        return false;
    }
    
    handleSelection(e) {
        if (e.button === 0) {
            this.startSelection(e);
            return true;
        }
        return false;
    }
    
    // ===================================
    // INTERACTION STARTERS
    // ===================================
    
    startNodeDrag(node, e) {
        if (this.isToggleSelectEnabled(e)) {
            // Shift-click (but not Ctrl+Shift): toggle selection (if enabled in config)
            if (this.selection.isSelected(node)) {
                // Remove from selection
                this.selection.deselectNode(node);
                // If we just deselected the only node, there's nothing to drag
                if (this.selection.isEmpty()) {
                    // Clean up drag state
                    this.interactionState.dragging.active = false;
                    this.interactionState.dragging.node = null;
                    this.interactionState.dragging.offsets.clear();
                    this.interactionState.dragging.hasMoved = false;
                    this.interactionState.dragging.initialPositions = null;
                    return;
                }
                // Use another selected node as the drag reference
                const selectedNodes = this.selection.getSelectedNodes();
                this.interactionState.dragging.node = selectedNodes[0];
            } else {
                // Add to selection
                this.selection.selectNode(node, true);
                this.interactionState.dragging.node = node;
            }
        } else {
            // Regular click or Ctrl+Shift (for grid align)
            if (!this.selection.isSelected(node)) {
                // Node not selected: replace selection with this node
                this.selection.clear();
                this.selection.selectNode(node, true);
            }
            // If node was already selected, keep current selection
            this.interactionState.dragging.node = node;
        }
        
        const nodesForInteraction = this.selection.getSelectedNodes();
        if (nodesForInteraction.length > 0) {
            window.app.undoManager.beginInteraction(nodesForInteraction);
        }
        
        // Set drag state
        this.interactionState.dragging.active = true;
        this.interactionState.dragging.hasMoved = false;
        
        // Track if nodes are being dragged from a group
        this.interactionState.dragging.draggedFromGroup = null;
        const groups = this.graph.nodes.filter(n => n.type === 'container/group');
        for (const group of groups) {
            for (const selectedNode of nodesForInteraction) {
                if (group.childNodes.has(selectedNode.id)) {
                    this.interactionState.dragging.draggedFromGroup = group;
                    break;
                }
            }
            if (this.interactionState.dragging.draggedFromGroup) break;
        }
        
        // Capture initial positions for undo before any movement
        this.interactionState.dragging.initialPositions = new Map();
        for (const selectedNode of nodesForInteraction) {
            this.interactionState.dragging.initialPositions.set(
                selectedNode.id, 
                [...selectedNode.pos]
            );
        }
        
        // Calculate offsets for all selected nodes
        for (const selectedNode of nodesForInteraction) {
            const offset = [
                selectedNode.pos[0] - this.mouseState.graph[0],
                selectedNode.pos[1] - this.mouseState.graph[1]
            ];
            this.interactionState.dragging.offsets.set(selectedNode.id, offset);
        }
    }
    
    startResize(resizeHandle) {
        this.interactionState.resizing.active = true;
        this.interactionState.resizing.type = resizeHandle.type;
        this.interactionState.resizing.node = resizeHandle.node;
        this.interactionState.resizing.nodes = new Set(resizeHandle.nodes || [resizeHandle.node]);
        this.interactionState.resizing.isMultiContext = resizeHandle.isMultiContext || false;
        
        const nodesToCapture = Array.from(this.interactionState.resizing.nodes);
        window.app.undoManager.beginInteraction(nodesToCapture);
        
        // Store initial bounding box for multi-resize or single-resize in multi-context
        if (resizeHandle.type === 'multi-resize' || resizeHandle.isMultiContext) {
            this.interactionState.resizing.initialBBox = this.selection.getBoundingBox();
        }
        
        // Store initial state for all relevant nodes
        const nodesToStore = this.selection.size() > 1 ? this.selection.getSelectedNodes() : [resizeHandle.node];
        for (const node of nodesToStore) {
            this.interactionState.resizing.initial.set(node.id, {
                pos: [...node.pos],
                size: [...node.size],
                aspect: node.aspectRatio || (node.size[0] / node.size[1])
            });
        }
    }
    
    startRotation(rotationHandle) {
        this.interactionState.rotating.active = true;
        this.interactionState.rotating.type = rotationHandle.type;
        this.interactionState.rotating.node = rotationHandle.node;
        this.interactionState.rotating.nodes = new Set(rotationHandle.nodes || [rotationHandle.node]);
        this.interactionState.rotating.center = rotationHandle.center;
        this.interactionState.rotating.initialAngle = Math.atan2(
            this.mouseState.graph[1] - rotationHandle.center[1],
            this.mouseState.graph[0] - rotationHandle.center[0]
        );
        
        // For single-rotation in multi-selection context, capture all selected nodes
        let nodesToCapture;
        if (rotationHandle.type === 'single-rotation' && this.selection.size() > 1) {
            nodesToCapture = this.selection.getSelectedNodes();
            // Update rotating.nodes to include all selected nodes
            this.interactionState.rotating.nodes = new Set(nodesToCapture);
        } else {
            nodesToCapture = Array.from(this.interactionState.rotating.nodes);
        }
        
        window.app.undoManager.beginInteraction(nodesToCapture);
        
        // Store initial state for all relevant nodes
        const nodesToStore = this.selection.size() > 1 ? this.selection.getSelectedNodes() : [rotationHandle.node];
        for (const node of nodesToStore) {
            this.interactionState.rotating.initial.set(node.id, {
                pos: [...node.pos],
                rotation: node.rotation || 0
            });
        }
    }
    
    startSelection(e) {
        this.interactionState.selecting.active = true;
        this.interactionState.selecting.startGraph = [...this.mouseState.graph];
        
        // Pass modifier keys to selection manager
        const modifiers = {
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey || e.metaKey,
            altKey: e.altKey
        };
        
        this.selection.startSelection(this.mouseState.graph, modifiers);
        
        // Only clear selection for replace mode (no modifiers)
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
            this.selection.clear();
        }
    }
    
    async startNodeDuplication(node, e) {
        // Check if multiple nodes are selected
        const isMultiSelection = this.selection.size() > 1 && this.selection.isSelected(node);
        
        let duplicates = [];
        let draggedDuplicate = null;
        
        // For collaborative systems, create nodes locally first, then sync properly after drag
        if (isMultiSelection) {
            // Multi-selection: duplicate all selected nodes locally
            const selectedNodes = this.selection.getSelectedNodes();
            
            for (const selectedNode of selectedNodes) {
                const duplicate = this.duplicateNode(selectedNode);
                if (duplicate) {
                    // Position duplicate at same location initially
                    duplicate.pos[0] = selectedNode.pos[0];
                    duplicate.pos[1] = selectedNode.pos[1];
                    
                    this.graph.add(duplicate);
                    duplicates.push(duplicate);
                    
                    // Mark as temporary - will be replaced by server version later
                    duplicate._isTemporary = true;
                    duplicate._temporaryCreatedAt = Date.now();
                    
                    // Remember which duplicate corresponds to the dragged node
                    if (selectedNode.id === node.id) {
                        draggedDuplicate = duplicate;
                    }
                }
            }
        } else {
            // Single node: duplicate just this node locally
            const duplicate = this.duplicateNode(node);
            if (duplicate) {
                duplicate.pos[0] = node.pos[0];
                duplicate.pos[1] = node.pos[1];
                this.graph.add(duplicate);
                duplicates.push(duplicate);
                
                // Mark as temporary - will be replaced by server version later
                duplicate._isTemporary = true;
                duplicate._temporaryCreatedAt = Date.now();
                
                draggedDuplicate = duplicate;
            }
        }
        
        // Mark these nodes as needing collaborative sync after drag completes
        // But only if the collaborative system is properly authenticated
        // Alt+drag now uses the collaborative system directly via node_duplicate command
        // No need to mark for sync since it's already handled properly
        
        if (duplicates.length === 0) return;
        
        // Clear selection and select all duplicates
        this.selection.clear();
        duplicates.forEach(dup => this.selection.selectNode(dup, true));
        
        // Start dragging all duplicates, using the dragged duplicate as reference
        this.interactionState.dragging.node = draggedDuplicate;
        this.interactionState.dragging.isDuplication = true;  // Mark as duplication drag
        
        // Force redraw to show any loading states
        this.dirty_canvas = true;
        
        // Calculate offsets for all duplicates
        for (const duplicate of duplicates) {
            const offset = [
                duplicate.pos[0] - this.mouseState.graph[0],
                duplicate.pos[1] - this.mouseState.graph[1]
            ];
            this.interactionState.dragging.offsets.set(duplicate.id, offset);
        }
        
        // DON'T push undo state yet - wait until drag is complete for atomic operation
        this.dirty_canvas = true;
    }
    // ===================================
    // INTERACTION UPDATES
    // ===================================
    
    updateInteractions(e) {
        if (this.interactionState.dragging.canvas) {
            this.updateCanvasDrag();
        } else if (this.interactionState.dragging.node) {
            this.updateNodeDrag();
        } else if (this.interactionState.resizing.active) {
            // Check if we're resizing a group
            const resizingNode = Array.from(this.interactionState.resizing.nodes)[0];
            if (resizingNode && resizingNode.type === 'container/group') {
                this.updateGroupResize(...this.mouseState.graph);
            } else {
                this.updateResize(e);
            }
        } else if (this.interactionState.rotating.active) {
            this.updateRotation(e);
        } else if (this.interactionState.selecting.active) {
            this.updateSelection();
        }
    }
    
    updateCanvasDrag() {
        const dx = this.mouseState.canvas[0] - this.mouseState.last[0];
        const dy = this.mouseState.canvas[1] - this.mouseState.last[1];
        this.viewport.pan(dx, dy);
        
        // Update text editing overlay if active
        if (this._editingTextInput && this._editingTextNode) {
            this.positionTextEditingOverlay(this._editingTextInput, this._editingTextNode);
        }
    }
    
    updateNodeDrag() {
        let moved = false;
        const movedGroups = new Map(); // Track group movements for child updates
        const draggedNodes = [];
        
        // Build a set of dragged node IDs for quick lookup
        const draggedNodeIds = new Set(this.interactionState.dragging.offsets.keys());
        
        // First update positions
        for (const [nodeId, offset] of this.interactionState.dragging.offsets) {
            const node = this.graph.getNodeById(nodeId);
            if (node) {
                const oldX = node.pos[0];
                const oldY = node.pos[1];
                const newX = this.mouseState.graph[0] + offset[0];
                const newY = this.mouseState.graph[1] + offset[1];
                
                // Check if position actually changed (with small threshold to avoid floating point issues)
                if (Math.abs(oldX - newX) > 0.01 || Math.abs(oldY - newY) > 0.01) {
                    moved = true;
                    
                    // If this is a group node, track the movement delta
                    if (node.type === 'container/group') {
                        movedGroups.set(node, {
                            deltaX: newX - oldX,
                            deltaY: newY - oldY
                        });
                    }
                }
                
                node.pos[0] = newX;
                node.pos[1] = newY;
                draggedNodes.push(node);
            }
        }
        
        // Move child nodes of any groups that were moved
        // Pass the set of dragged node IDs so children that are also being dragged are skipped
        for (const [groupNode, delta] of movedGroups) {
            if (groupNode.moveChildNodes) {
                groupNode.moveChildNodes(delta.deltaX, delta.deltaY, draggedNodeIds);
            }
        }
        
        // Check if dragged nodes are over any groups (for add/remove detection)
        // Only update if we have dragged nodes and moved
        if (draggedNodes.length > 0 && moved) {
            this.updateGroupHoverStates(draggedNodes);
        }
        
        // Track if any movement occurred
        if (moved) {
            this.interactionState.dragging.hasMoved = true;
        }
        
        // Invalidate selection bounding box cache when nodes move
        this.selection.invalidateBoundingBox();
    }
    
    updateResize(e) {
        const mouseX = this.mouseState.graph[0];
        const mouseY = this.mouseState.graph[1];
        
        if (this.interactionState.resizing.type === 'single-resize') {
            this.updateSingleResize(mouseX, mouseY, this.isResizeAspectLockEnabled(e), this.isResizeFromCenterEnabled(e));
        } else if (this.interactionState.resizing.type === 'multi-resize') {
            this.updateMultiResize(mouseX, mouseY, this.isResizeAspectLockEnabled(e), this.isResizeFromCenterEnabled(e));
        }
    }
    
    updateSingleResize(mouseX, mouseY, shift, ctrl) {
        const node = this.interactionState.resizing.node;
        const initial = this.interactionState.resizing.initial.get(node.id);
        if (!initial) return;
        
        // Calculate new size and position with proper anchor point
        let newWidth, newHeight, newPosX, newPosY;
        
        if (node.rotation && node.rotation !== 0) {
            // For rotated nodes, resize from the opposite corner (top-left) as anchor
            const angle = node.rotation * Math.PI / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            
            // Calculate the top-left corner position in world coordinates (our anchor point)
            const anchorLocalX = -initial.size[0] / 2;
            const anchorLocalY = -initial.size[1] / 2;
            const centerX = initial.pos[0] + initial.size[0] / 2;
            const centerY = initial.pos[1] + initial.size[1] / 2;
            
            const anchorX = centerX + anchorLocalX * cos - anchorLocalY * sin;
            const anchorY = centerY + anchorLocalX * sin + anchorLocalY * cos;
            
            // Transform mouse position to local coordinate system relative to anchor
            const dx = mouseX - anchorX;
            const dy = mouseY - anchorY;
            
            // Rotate to get local coordinates
            const localDx = dx * cos + dy * sin;
            const localDy = -dx * sin + dy * cos;
            
            // Calculate new size (ensuring positive values)
            newWidth = Math.max(50, Math.abs(localDx));
            newHeight = Math.max(50, Math.abs(localDy));
            
            // Calculate new position to keep anchor point fixed
            const newCenterX = anchorX + (newWidth / 2) * cos - (newHeight / 2) * sin;
            const newCenterY = anchorY + (newWidth / 2) * sin + (newHeight / 2) * cos;
            
            newPosX = newCenterX - newWidth / 2;
            newPosY = newCenterY - newHeight / 2;
        } else {
            // No rotation, use simple calculation with top-left anchor
            newWidth = Math.max(50, mouseX - initial.pos[0]);
            newHeight = Math.max(50, mouseY - initial.pos[1]);
            newPosX = initial.pos[0]; // Keep top-left fixed
            newPosY = initial.pos[1];
        }
        
        // Check if this is a single-resize in multi-selection context
        // In this case, we should scale all selected nodes as a group
        const isMultiContext = this.interactionState.resizing.isMultiContext;
        
        if (isMultiContext) {
            // Single handle drag in multi-selection: scale all selected nodes as group
            this.updateMultiResizeFromSingleHandle(mouseX, mouseY, shift, ctrl, node, initial);
            return;
        }
        
        // Individual node resize (single selection or not in multi-context)
        // Single node: update size and position with anchor point
        if (shift) {
            // Non-uniform scaling
            node.size[0] = newWidth;
            node.size[1] = newHeight;
            node.aspectRatio = node.size[0] / node.size[1];
        } else {
            // Maintain aspect ratio
            const aspectHeight = newWidth / initial.aspect;
            node.size[0] = newWidth;
            node.size[1] = aspectHeight;
            node.aspectRatio = initial.aspect;
            
            // Recalculate position for aspect-constrained resize if rotated
            if (node.rotation && node.rotation !== 0) {
                const angle = node.rotation * Math.PI / 180;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                
                // Calculate anchor point again
                const anchorLocalX = -initial.size[0] / 2;
                const anchorLocalY = -initial.size[1] / 2;
                const centerX = initial.pos[0] + initial.size[0] / 2;
                const centerY = initial.pos[1] + initial.size[1] / 2;
                
                const anchorX = centerX + anchorLocalX * cos - anchorLocalY * sin;
                const anchorY = centerY + anchorLocalX * sin + anchorLocalY * cos;
                
                // Recalculate position with new aspect-constrained height
                const newCenterX = anchorX + (newWidth / 2) * cos - (aspectHeight / 2) * sin;
                const newCenterY = anchorY + (newWidth / 2) * sin + (aspectHeight / 2) * cos;
                
                newPosX = newCenterX - newWidth / 2;
                newPosY = newCenterY - aspectHeight / 2;
            }
        }
        
        // Update position (for both rotated and non-rotated nodes)
        node.pos[0] = newPosX;
        node.pos[1] = newPosY;
        
        if (node.onResize) {
            node.onResize();
        }
        
        // Invalidate bounding box cache after single node resize
        this.selection.invalidateBoundingBox();
    }
    
    updateMultiResize(mouseX, mouseY, shift, ctrl) {
        const initialBBox = this.interactionState.resizing.initialBBox;
        if (!initialBBox) return;
        
        const [bx, by, bw, bh] = initialBBox;
        const newWidth = Math.max(bw * 0.1, mouseX - bx);
        const newHeight = Math.max(bh * 0.1, mouseY - by);
        
        let scaleX = newWidth / bw;
        let scaleY = newHeight / bh;
        
        if (!shift) {
            // Uniform scaling - use X scale (drag direction) to maintain proportions
            scaleY = scaleX;
        }
        
        // Scale nodes as if bounding box top-left is pinned to canvas
        // Everything deforms from that fixed anchor point
        for (const node of this.selection.selectedNodes.values()) {
            const initial = this.interactionState.resizing.initial.get(node.id);
            if (!initial) continue;
            
            if (node.rotation && node.rotation !== 0) {
                // For rotated nodes: apply scaling in their local coordinate system
                // to approximate the visual deformation effect
                const angle = node.rotation * Math.PI / 180;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                
                // Transform global scale factors into local coordinate system
                const localScaleX = Math.abs(scaleX * cos) + Math.abs(scaleY * sin);
                const localScaleY = Math.abs(scaleX * sin) + Math.abs(scaleY * cos);
                
                node.size[0] = Math.max(50, initial.size[0] * localScaleX);
                node.size[1] = Math.max(50, initial.size[1] * localScaleY);
            } else {
                // Non-rotated nodes: direct scaling
                node.size[0] = Math.max(50, initial.size[0] * scaleX);
                node.size[1] = Math.max(50, initial.size[1] * scaleY);
            }
            
            node.aspectRatio = node.size[0] / node.size[1];
            
            // All nodes: scale position from bounding box top-left anchor
            node.pos[0] = bx + (initial.pos[0] - bx) * scaleX;
            node.pos[1] = by + (initial.pos[1] - by) * scaleY;
            
            if (node.onResize) {
                node.onResize();
            }
        }
        
        // Invalidate bounding box cache after multi-resize
        this.selection.invalidateBoundingBox();
    }
    
    updateMultiResizeFromSingleHandle(mouseX, mouseY, shift, ctrl, draggedNode, draggedInitial) {
        // This method handles when you drag an individual node handle in multi-selection context
        // Each node scales by the same factor, but from its own anchor point (delta scaling)
        
        // Calculate how much the dragged node would resize using the same logic as individual resize
        let scaleX, scaleY;
        
        if (draggedNode.rotation && draggedNode.rotation !== 0) {
            // For rotated dragged node, transform mouse position to local coordinates
            const angle = draggedNode.rotation * Math.PI / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            
            // Calculate the top-left corner position in world coordinates (anchor point)
            const anchorLocalX = -draggedInitial.size[0] / 2;
            const anchorLocalY = -draggedInitial.size[1] / 2;
            const centerX = draggedInitial.pos[0] + draggedInitial.size[0] / 2;
            const centerY = draggedInitial.pos[1] + draggedInitial.size[1] / 2;
            
            const anchorX = centerX + anchorLocalX * cos - anchorLocalY * sin;
            const anchorY = centerY + anchorLocalX * sin + anchorLocalY * cos;
            
            // Transform mouse position to local coordinate system relative to anchor
            const dx = mouseX - anchorX;
            const dy = mouseY - anchorY;
            
            // Rotate to get local coordinates
            const localDx = dx * cos + dy * sin;
            const localDy = -dx * sin + dy * cos;
            
            // Calculate new size based on local coordinates
            const newWidth = Math.max(50, Math.abs(localDx));
            const newHeight = Math.max(50, Math.abs(localDy));
            
            // Calculate scale factors
            scaleX = newWidth / draggedInitial.size[0];
            scaleY = newHeight / draggedInitial.size[1];
        } else {
            // No rotation on dragged node - simple calculation
            const newWidth = Math.max(50, mouseX - draggedInitial.pos[0]);
            const newHeight = Math.max(50, mouseY - draggedInitial.pos[1]);
            
            scaleX = newWidth / draggedInitial.size[0];
            scaleY = newHeight / draggedInitial.size[1];
        }
        
        if (!shift) {
            // Uniform scaling - use X scale to maintain proportions
            scaleY = scaleX;
        }
        
        // Ensure all selected nodes are tracked for server sync
        for (const node of this.selection.selectedNodes.values()) {
            // Add all selected nodes to the resizing nodes set so they get synced to server
            this.interactionState.resizing.nodes.add(node);
            
            // Ensure initial state is captured for all nodes (needed for undo/sync)
            if (!this.interactionState.resizing.initial.has(node.id)) {
                this.interactionState.resizing.initial.set(node.id, {
                    pos: [...node.pos],
                    size: [...node.size],
                    aspect: node.aspectRatio || (node.size[0] / node.size[1])
                });
            }
        }
        
        // Apply the same scale factors to all selected nodes, each from its own anchor
        for (const node of this.selection.selectedNodes.values()) {
            const initial = this.interactionState.resizing.initial.get(node.id);
            if (!initial) continue;
            
            // Calculate new size using the same scale factors
            const newWidth = Math.max(50, initial.size[0] * scaleX);
            const newHeight = Math.max(50, initial.size[1] * scaleY);
            
            // For delta scaling, handle position based on rotation
            let newPosX, newPosY;
            
            if (node.rotation && node.rotation !== 0) {
                // For rotated nodes, maintain anchor point behavior (same as individual resize)
                const angle = node.rotation * Math.PI / 180;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                
                // Calculate the top-left corner position in world coordinates (our anchor point)
                const anchorLocalX = -initial.size[0] / 2;
                const anchorLocalY = -initial.size[1] / 2;
                const centerX = initial.pos[0] + initial.size[0] / 2;
                const centerY = initial.pos[1] + initial.size[1] / 2;
                
                const anchorX = centerX + anchorLocalX * cos - anchorLocalY * sin;
                const anchorY = centerY + anchorLocalX * sin + anchorLocalY * cos;
                
                // Calculate new position to keep anchor point fixed
                const newCenterX = anchorX + (newWidth / 2) * cos - (newHeight / 2) * sin;
                const newCenterY = anchorY + (newWidth / 2) * sin + (newHeight / 2) * cos;
                
                newPosX = newCenterX - newWidth / 2;
                newPosY = newCenterY - newHeight / 2;
            } else {
                // No rotation: anchor point is simply the top-left corner - keep it exactly the same
                newPosX = initial.pos[0]; // Keep top-left fixed - no change!
                newPosY = initial.pos[1]; // Keep top-left fixed - no change!
            }
            
            // Update node properties
            node.size[0] = newWidth;
            node.size[1] = newHeight;
            node.pos[0] = newPosX;
            node.pos[1] = newPosY;
            node.aspectRatio = node.size[0] / node.size[1];
            
            if (node.onResize) {
                node.onResize();
            }
        }
        
        // Invalidate bounding box cache after multi-selection resize
        this.selection.invalidateBoundingBox();
    }
    
    updateRotation(e) {
        const { type, center, initialAngle, initial } = this.interactionState.rotating;
        
        const currentAngle = Math.atan2(
            this.mouseState.graph[1] - center[1],
            this.mouseState.graph[0] - center[0]
        );
        
        let deltaAngle = currentAngle - initialAngle;
        let deltaDegrees = deltaAngle * 180 / Math.PI;
        
        if (type === 'single-rotation') {
            const node = this.interactionState.rotating.node;
            const initialRotation = initial.get(node.id)?.rotation || 0;
            
            // Check if we're in multi-selection context
            const isMultiSelection = this.selection.size() > 1;
            
            if (isMultiSelection) {
                // Multi-selection: apply rotation delta to all selected nodes around their individual centers
                for (const selectedNode of this.selection.getSelectedNodes()) {
                    const nodeInitial = initial.get(selectedNode.id);
                    if (!nodeInitial) continue;
                    
                    let newRotation = nodeInitial.rotation + deltaDegrees;
                    
                    // Snap to absolute angles when Shift is held (if enabled in config)
                    if (this.isRotationSnapEnabled(e)) {
                        const snapAngle = CONFIG.HANDLES.ROTATION_SNAP_ANGLE;
                        newRotation = Math.round(newRotation / snapAngle) * snapAngle;
                    }
                    
                    selectedNode.rotation = newRotation % 360;
                }
            } else {
                // Single node: original behavior
                let newRotation = initialRotation + deltaDegrees;
                
                // Snap to absolute angles when Shift is held (if enabled in config)
                if (this.isRotationSnapEnabled(e)) {
                    const snapAngle = CONFIG.HANDLES.ROTATION_SNAP_ANGLE;
                    newRotation = Math.round(newRotation / snapAngle) * snapAngle;
                }
                
                node.rotation = newRotation % 360;
            }
            
            // Invalidate bounding box cache during rotation
            this.selection.invalidateBoundingBox();
        } else {
            // Multi-rotation: rotate around group center
            
            // Snap the delta angle when Shift is held (for orbital rotation, if enabled in config)
            if (this.isRotationSnapEnabled(e)) {
                const snapAngle = CONFIG.HANDLES.ROTATION_SNAP_ANGLE;
                const snappedDeltaDegrees = Math.round(deltaDegrees / snapAngle) * snapAngle;
                deltaAngle = snappedDeltaDegrees * Math.PI / 180;
                deltaDegrees = snappedDeltaDegrees;
            }
            
            const cos = Math.cos(deltaAngle);
            const sin = Math.sin(deltaAngle);
            
            for (const node of this.interactionState.rotating.nodes) {
                const initialState = initial.get(node.id);
                if (!initialState) continue;
                
                // Rotate position around center
                const dx = initialState.pos[0] + node.size[0] / 2 - center[0];
                const dy = initialState.pos[1] + node.size[1] / 2 - center[1];
                
                const newDx = dx * cos - dy * sin;
                const newDy = dx * sin + dy * cos;
                
                node.pos[0] = center[0] + newDx - node.size[0] / 2;
                node.pos[1] = center[1] + newDy - node.size[1] / 2;
                
                // Rotate node itself (no snapping for individual rotation in group mode)
                node.rotation = (initialState.rotation + deltaDegrees) % 360;
            }
            
            // Invalidate bounding box cache during multi-rotation
            this.selection.invalidateBoundingBox();
        }
    }
    
    updateSelection() {
        this.selection.updateSelection(this.mouseState.graph);
    }
    
    updateCursor() {
        if (this.mouseState.down) return; // Don't change cursor during interactions
        
        const cursor = this.handleDetector.getCursor(...this.mouseState.canvas);
        this.canvas.style.cursor = cursor;
    }
    
    // ===================================
    // GROUP INTERACTION METHODS
    // ===================================
    
    startGroupTitleBarDrag(groupNode, e) {
        // Handle alt-drag for duplication
        if (e.altKey) {
            this.startNodeDuplication(groupNode, e);
            return;
        }
        
        // Handle shift-click for selection toggle
        if (e.shiftKey) {
            if (this.selection.isSelected(groupNode)) {
                // Shift-click on selected group: deselect it
                this.selection.deselectNode(groupNode);
                // If we just deselected the only node, there's nothing to drag
                if (this.selection.isEmpty()) {
                    // Still need to set up drag state to prevent issues
                    this.interactionState.dragging.active = false;
                    this.interactionState.dragging.node = null;
                    this.interactionState.dragging.offsets.clear();
                    this.interactionState.dragging.hasMoved = false;
                    this.interactionState.dragging.initialPositions = null;
                    return;
                }
                // Use another selected node as the drag reference
                const selectedNodes = this.selection.getSelectedNodes();
                this.interactionState.dragging.node = selectedNodes[0];
            } else {
                // Shift-click on unselected group: add to selection
                this.selection.selectNode(groupNode, true);
                this.interactionState.dragging.node = groupNode;
            }
        } else {
            // Regular click: select only this group if not already selected
            if (!this.selection.isSelected(groupNode)) {
                this.selection.clear();
                this.selection.selectNode(groupNode);
            }
            this.interactionState.dragging.node = groupNode;
        }
        
        this.interactionState.dragging.active = true;
        this.interactionState.dragging.hasMoved = false;
        
        // Get all nodes that will be affected (selected groups and their children)
        const nodesForInteraction = [];
        const selectedNodes = this.selection.getSelectedNodes();
        
        for (const node of selectedNodes) {
            nodesForInteraction.push(node);
            
            // If this is a group, also include all child nodes for undo tracking
            if (node.type === 'container/group' && node.getChildNodes) {
                const childNodes = node.getChildNodes();
                for (const child of childNodes) {
                    if (!nodesForInteraction.includes(child)) {
                        nodesForInteraction.push(child);
                    }
                }
            }
        }
        
        // Filter out any undefined nodes before passing to undo manager
        const validNodes = nodesForInteraction.filter(n => n != null);
        if (validNodes.length > 0) {
            window.app.undoManager.beginInteraction(validNodes);
        }
        
        // Capture initial positions for undo before any movement
        this.interactionState.dragging.initialPositions = new Map();
        for (const node of nodesForInteraction) {
            if (!node) continue; // Skip undefined nodes (deleted children)
            this.interactionState.dragging.initialPositions.set(
                node.id, 
                [...node.pos]
            );
        }
        
        // Calculate offsets only for the selected nodes (not children)
        for (const selectedNode of selectedNodes) {
            const offset = [
                selectedNode.pos[0] - this.mouseState.graph[0],
                selectedNode.pos[1] - this.mouseState.graph[1]
            ];
            this.interactionState.dragging.offsets.set(selectedNode.id, offset);
        }
        
        this.dirty_canvas = true;
    }
    
    startGroupResize(groupNode, e) {
        // Select the group if not already selected
        if (!this.selection.isSelected(groupNode)) {
            this.selection.clear();
            this.selection.selectNode(groupNode);
        }
        
        this.interactionState.resizing.active = true;
        this.interactionState.resizing.nodes = new Set([groupNode]);  // Use Set instead of array
        this.interactionState.resizing.initial = new Map();
        this.interactionState.resizing.initial.set(groupNode.id, {
            pos: [...groupNode.pos],
            size: [...groupNode.size]
        });
        
        this.dirty_canvas = true;
    }
    
    toggleGroupCollapsed(groupNode) {
        if (window.app?.operationPipeline) {
            const command = new window.NodeCommands.GroupNodeCommand({
                action: 'group_toggle_collapsed',
                groupId: groupNode.id
            });
            
            window.app.operationPipeline.executeCommand(command);
        } else {
            // Fallback for non-collaborative mode
            groupNode.toggleCollapsed();
            this.dirty_canvas = true;
        }
    }
    
    
    updateGroupResize(mouseX, mouseY) {
        if (!this.interactionState.resizing.active) return;
        
        const groupNode = Array.from(this.interactionState.resizing.nodes)[0];
        if (groupNode.type !== 'container/group') return;
        
        const initial = this.interactionState.resizing.initial.get(groupNode.id);
        if (!initial) return;
        
        // Calculate new size from bottom-right corner
        const newWidth = Math.max(groupNode.minSize[0], mouseX - groupNode.pos[0]);
        const newHeight = Math.max(groupNode.minSize[1], mouseY - groupNode.pos[1]);
        
        
        groupNode.size[0] = newWidth;
        groupNode.size[1] = newHeight;
        
        groupNode.markDirty();
        this.dirty_canvas = true;
    }
    
    /**
     * Update brightness effects when dragging nodes over groups
     */
    updateGroupHoverStates(draggedNodes) {
        // Skip if we're dragging groups themselves
        const isDraggingGroups = draggedNodes.some(n => n.type === 'container/group');
        if (isDraggingGroups) return;
        
        // Find all groups in the graph
        const groups = this.graph.nodes.filter(n => n.type === 'container/group');
        
        // Get current hover state
        const previousGroup = this.interactionState.dragging.potentialGroup;
        
        // Check which group the node under the mouse is over
        let targetGroup = null;
        let nodeUnderMouse = null;
        
        // Find which dragged node is under the mouse cursor
        const mousePos = this.mouseState.graph;
        for (const node of draggedNodes) {
            const nodeLeft = node.pos[0];
            const nodeTop = node.pos[1];
            const nodeRight = node.pos[0] + node.size[0];
            const nodeBottom = node.pos[1] + node.size[1];
            
            if (mousePos[0] >= nodeLeft && mousePos[0] <= nodeRight &&
                mousePos[1] >= nodeTop && mousePos[1] <= nodeBottom) {
                nodeUnderMouse = node;
                break;
            }
        }
        
        // If we found the node under mouse, check if it's over a group
        if (nodeUnderMouse) {
            for (const group of groups) {
                // Skip collapsed groups
                if (group.isCollapsed) continue;
                
                // Check if the node under mouse is over this group
                if (group.shouldContainNode && group.shouldContainNode(nodeUnderMouse)) {
                    targetGroup = group;
                    break; // Use first matching group
                }
            }
        }
        
        // If we found a target group, ALL dragged nodes will be added to it
        const nodesOverGroup = targetGroup ? new Set(draggedNodes) : new Set();
        
        // Handle group changes with debouncing
        if (targetGroup !== previousGroup) {
            const now = Date.now();
            
            // Check if we can update (150ms delay between changes)
            if (!this._lastGroupHoverChange || (now - this._lastGroupHoverChange) > 150) {
                // Reset brightness for previous group
                if (previousGroup && previousGroup.setBrightness) {
                    previousGroup.setBrightness(1.0);
                }
                
                // Set brightness for new group
                if (targetGroup && targetGroup.setBrightness) {
                    targetGroup.setBrightness(1.5);
                }
                
                // Update state
                this.interactionState.dragging.potentialGroup = targetGroup;
                this.interactionState.dragging.nodesOverGroup = nodesOverGroup;
                this._lastGroupHoverChange = now;
            }
        } else {
            // Same group, just update the nodes set
            this.interactionState.dragging.nodesOverGroup = nodesOverGroup;
        }
        
        // Update state
        if (targetGroup) {
            this.interactionState.dragging.potentialGroup = targetGroup;
            this.interactionState.dragging.nodesOverGroup = nodesOverGroup;
            
            // Brighten the GROUP that nodes are over
            if (targetGroup.setBrightness) {
                // Check if we're adding new nodes or removing existing ones
                const hasNewNodes = Array.from(nodesOverGroup).some(node => !targetGroup.childNodes.has(node.id));
                const hasExistingNodes = Array.from(nodesOverGroup).some(node => targetGroup.childNodes.has(node.id));
                
                if (hasNewNodes) {
                    // Brighten more when adding new nodes
                    targetGroup.setBrightness(1.5);
                } else if (hasExistingNodes && this.interactionState.dragging.draggedFromGroup === targetGroup) {
                    // Moderate brightness when potentially removing nodes
                    targetGroup.setBrightness(1.3);
                }
            }
        }
        
        // Reset the original group brightness if nodes are being dragged away
        if (this.interactionState.dragging.draggedFromGroup && 
            this.interactionState.dragging.draggedFromGroup !== targetGroup &&
            this.interactionState.dragging.draggedFromGroup.setBrightness) {
            console.log(`💡 Resetting original group ${this.interactionState.dragging.draggedFromGroup.id} to 1.0`);
            this.interactionState.dragging.draggedFromGroup.setBrightness(1.0);
        }
    }
    
    // ===================================
    // FINISH INTERACTIONS
    // ===================================
    
    finishInteractions() {
        const wasInteracting = this.isInteracting();
        const undoManager = window.app?.undoManager;

        // Canvas pan
        if (this.interactionState.dragging.canvas) {
            this.interactionState.dragging.canvas = false;
            // Reset cursor if we were using spacebar
            if (this.spacePressed && this.canvas.style) {
                this.canvas.style.cursor = 'grab';
            } else if (this.canvas.style) {
                this.canvas.style.cursor = '';
            }
        }

        // Node drag
        if (this.interactionState.dragging.node && this.interactionState.dragging.hasMoved) {
            if (this.interactionState.dragging.isDuplication) {
                // Handle alt-drag duplication
                const duplicatedNodes = this.selection.getSelectedNodes().filter(node => node._isTemporary);
                if (duplicatedNodes.length > 0 && window.app?.operationPipeline) {
                    // Prepare node data at final positions
                    const nodeData = duplicatedNodes.map(node => {
                        // Use serializeNode to ensure proper data format
                        const serialized = this.serializeNode(node);
                        // Update position to final drag position
                        serialized.pos = [...node.pos];
                        return serialized;
                    });
                    
                    // Don't remove temporary nodes here - let StateSyncManager handle them
                    // This allows proper tracking of selected nodes for restoration
                    
                    // Create nodes through server with node_duplicate command
                    window.app.operationPipeline.execute('node_duplicate', {
                        nodeData: nodeData,
                        source: 'alt_drag'
                    }).then(result => {
                        if (result && result.result && result.result.nodes) {
                            // For optimistic updates, nodes are already selected
                            // For non-optimistic, we need to wait for server nodes
                            if (!window.app?.operationPipeline?.stateSyncManager?.optimisticEnabled) {
                                // Store node IDs to select when they arrive from server
                                this._pendingSelectionNodeIds = result.result.nodes.map(n => n.id);
                            }
                            // With optimistic updates, the selection will be restored by StateSyncManager
                            // when server nodes replace the temporary ones
                        }
                    }).catch(error => {
                        console.error('Failed to sync alt-drag duplicates:', error);
                    });
                }
            } else {
                // Handle group assignment/removal before regular move
                const potentialGroup = this.interactionState.dragging.potentialGroup;
                const nodesOverGroup = this.interactionState.dragging.nodesOverGroup;
                const draggedFromGroup = this.interactionState.dragging.draggedFromGroup;
                
                // Add nodes to group if dropped on one
                if (potentialGroup && nodesOverGroup.size > 0) {
                    // Collect nodes to add and existing nodes that moved
                    const nodesToAdd = [];
                    const existingNodesMoved = [];
                    
                    for (const node of nodesOverGroup) {
                        if (!potentialGroup.childNodes.has(node.id)) {
                            nodesToAdd.push(node.id);
                        } else {
                            // This is an existing child that was moved within the group
                            existingNodesMoved.push(node);
                        }
                    }
                    
                    if (nodesToAdd.length > 0) {
                        // Temporarily disable bounds updates during batch operation
                        const originalUpdateBounds = potentialGroup.updateBounds;
                        potentialGroup.updateBounds = () => {}; // No-op
                        
                        // Add all nodes to the group
                        const addPromises = [];
                        for (const nodeId of nodesToAdd) {
                            if (window.app?.operationPipeline) {
                                const command = new window.NodeCommands.GroupNodeCommand({
                                    action: 'group_add_node',
                                    groupId: potentialGroup.id,
                                    nodeId: nodeId
                                });
                                addPromises.push(window.app.operationPipeline.executeCommand(command));
                            }
                        }
                        
                        // Wait for all add operations to complete, then update bounds once
                        Promise.all(addPromises).then(() => {
                            // Restore original updateBounds method
                            potentialGroup.updateBounds = originalUpdateBounds;
                            
                            // Now update bounds once for all added nodes (with animation)
                            const targetBounds = potentialGroup.updateBounds(true);
                            
                            // Send single resize command to sync the new bounds
                            if (window.app?.operationPipeline && targetBounds) {
                                const command = new window.NodeCommands.GroupNodeCommand({
                                    action: 'group_resize',
                                    groupId: potentialGroup.id,
                                    size: [...targetBounds.size],
                                    position: [...targetBounds.pos]
                                });
                                window.app.operationPipeline.executeCommand(command).catch(error => {
                                    console.error('Failed to sync group resize:', error);
                                });
                            }
                        });
                    } else if (existingNodesMoved.length > 0) {
                        // No new nodes to add, but existing nodes were moved within the group
                        // Check if the group needs to expand to accommodate the new positions
                        const targetBounds = potentialGroup.updateBounds(true);
                        
                        // If bounds changed, sync with server
                        if (window.app?.operationPipeline && targetBounds) {
                            const command = new window.NodeCommands.GroupNodeCommand({
                                action: 'group_resize',
                                groupId: potentialGroup.id,
                                size: [...targetBounds.size],
                                position: [...targetBounds.pos]
                            });
                            window.app.operationPipeline.executeCommand(command).catch(error => {
                                console.error('Failed to sync group resize after rearrangement:', error);
                            });
                        }
                    }
                }
                
                // Remove nodes from group if dragged out
                if (draggedFromGroup && !potentialGroup) {
                    const draggedNodes = this.selection.getSelectedNodes();
                    const removePromises = [];
                    for (const node of draggedNodes) {
                        if (draggedFromGroup.childNodes.has(node.id)) {
                            // Remove node from group
                            if (window.app?.operationPipeline) {
                                const command = new window.NodeCommands.GroupNodeCommand({
                                    action: 'group_remove_node',
                                    groupId: draggedFromGroup.id,
                                    nodeId: node.id
                                });
                                removePromises.push(window.app.operationPipeline.executeCommand(command));
                            }
                        }
                    }
                    
                    // Don't update bounds when removing nodes - groups never shrink
                }
                
                // Reset brightness for all groups
                if (potentialGroup && potentialGroup.setBrightness) {
                    potentialGroup.setBrightness(1.0);
                }
                if (draggedFromGroup && draggedFromGroup.setBrightness) {
                    draggedFromGroup.setBrightness(1.0);
                }
                
                // Regular node move - include child nodes if groups were moved
                const selectedNodes = this.selection.getSelectedNodes();
                const allMovedNodes = [];
                
                // Collect all nodes that were moved (selected + children of groups)
                for (const node of selectedNodes) {
                    allMovedNodes.push(node);
                    
                    // If this is a group, also include child nodes
                    if (node.type === 'container/group' && node.getChildNodes) {
                        const childNodes = node.getChildNodes();
                        for (const child of childNodes) {
                            if (!allMovedNodes.includes(child)) {
                                allMovedNodes.push(child);
                            }
                        }
                    }
                }
                
                if (allMovedNodes.length > 0) {
                    const nodeIds = allMovedNodes.map(n => n.id);
                    const finalPositions = allMovedNodes.map(n => [...n.pos]);
                    window.app.undoManager.endInteraction('node_move', { 
                        nodeIds: nodeIds,
                        positions: finalPositions 
                    });
                }
            }
        }

        // Resize
        if (this.interactionState.resizing.active) {
            const nodes = Array.from(this.interactionState.resizing.nodes);
            if (nodes.length > 0) {
                // Check if we're resizing a single group node
                if (nodes.length === 1 && nodes[0].type === 'container/group') {
                    const groupNode = nodes[0];
                    
                    // Use GroupNodeCommand for group resize
                    if (window.app?.operationPipeline) {
                        const command = new window.NodeCommands.GroupNodeCommand({
                            action: 'group_resize',
                            groupId: groupNode.id,
                            size: [...groupNode.size],
                            position: [...groupNode.pos]
                        });
                        
                        window.app.operationPipeline.executeCommand(command);
                    }
                } else {
                    // Regular node resize
                    const nodeIds = nodes.map(n => n.id);
                    const finalSizes = nodes.map(n => {
                        // Ensure size is a valid array
                        if (!n.size || !Array.isArray(n.size) || n.size.length !== 2) {
                            console.error(`Invalid size for node ${n.id}:`, n.size, 'Node:', n);
                            return [100, 100]; // Default size
                        }
                        return [...n.size];
                    });
                    const finalPositions = nodes.map(n => [...n.pos]);
                    
                    console.log('📐 Resize params:', {
                        nodeIds,
                        sizes: finalSizes,
                        positions: finalPositions
                    });
                    
                    window.app.undoManager.endInteraction('node_resize', { 
                        nodeIds, 
                        sizes: finalSizes, 
                        positions: finalPositions 
                    });
                }
            }
        }

        // Rotation
        if (this.interactionState.rotating.active) {
            const nodes = Array.from(this.interactionState.rotating.nodes);
            if (nodes.length > 0) {
                const nodeIds = nodes.map(n => n.id);
                const finalRotations = nodes.map(n => n.rotation || 0);
                const finalPositions = nodes.map(n => [...n.pos]);
                window.app.undoManager.endInteraction('node_rotate', { 
                    nodeIds,
                    angles: finalRotations, 
                    positions: finalPositions 
                });
            }
        }

        // Sync any group bounds that may have changed during interactions
        if (this.graph) {
            const groups = this.graph.nodes.filter(n => n.type === 'container/group');
            for (const group of groups) {
                // Check if group needs sync (not animating and has been modified)
                if (group.syncBoundsToServer && !group.isAnimating && !group._animPos && !group._gridAnimPos) {
                    // Schedule sync after a short delay to batch updates
                    setTimeout(() => {
                        if (group.syncBoundsToServer) {
                            group.syncBoundsToServer();
                        }
                    }, 100);
                }
            }
        }

        // Reset all interaction states
        this.interactionState.dragging.active = false;
        this.interactionState.dragging.node = null;
        this.interactionState.dragging.offsets.clear();
        this.interactionState.dragging.hasMoved = false;
        this.interactionState.dragging.initialPositions = null;
        this.interactionState.dragging.potentialGroup = null;
        this.interactionState.dragging.nodesOverGroup.clear();
        this.interactionState.dragging.draggedFromGroup = null;
        this.interactionState.resizing.active = false;
        this.interactionState.resizing.nodes.clear();
        this.interactionState.resizing.initial.clear();
        this.interactionState.rotating.active = false;
        this.interactionState.rotating.nodes.clear();
        this.interactionState.rotating.initial.clear();

        if (this.interactionState.selecting.active) {
            this.selection.finishSelection(this.graph.nodes);
            this.interactionState.selecting.active = false;
        }

        this.dirty_canvas = true;
    }
    
    isInteracting() {
        return this.interactionState.dragging.node ||
               this.interactionState.resizing.active ||
               this.interactionState.rotating.active ||
               this.interactionState.dragging.canvas ||
               this.viewport?.isAnimating;
    }
    
    // ===================================
    // KEYBOARD SHORTCUTS
    // ===================================
    
    
    // ===================================
    // UTILITY METHODS
    // ===================================
    
    copySelected() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) {
            console.log('⚠️ No nodes selected to copy');
            return;
        }
        
        // Build a set of selected node IDs for quick lookup
        const selectedIds = new Set(selected.map(n => n.id));
        
        // Serialize nodes and track parent-child relationships
        const serializedNodes = [];
        const parentChildMap = new Map(); // Maps group node index to child node indices
        
        selected.forEach((node, index) => {
            const serialized = this.serializeNode(node);
            
            // For group nodes, track which selected children belong to this group
            if (node.type === 'container/group') {
                // console.log(`📋 Checking group ${node.id}, childNodes:`, node.childNodes);
                if (node.childNodes && node.childNodes.size > 0) {
                    const childIndices = [];
                    // console.log(`📋 Group has ${node.childNodes.size} children, selected IDs:`, selectedIds);
                    
                    // Check each child to see if it's also being copied
                    for (const childId of node.childNodes) {
                        // console.log(`📋 Checking if child ${childId} is in selected set:`, selectedIds.has(childId));
                        if (selectedIds.has(childId)) {
                            // Find the index of this child in the selected array
                            const childIndex = selected.findIndex(n => n.id === childId);
                            if (childIndex !== -1) {
                                childIndices.push(childIndex);
                            }
                        }
                    }
                    
                    // console.log(`📋 Found ${childIndices.length} selected children for group ${node.id}`);
                    if (childIndices.length > 0) {
                        parentChildMap.set(index, childIndices);
                        // Store the child relationships in the serialized data
                        serialized._copiedChildIndices = childIndices;
                        // console.log(`📋 Group ${node.id} has ${childIndices.length} children being copied:`, childIndices);
                    }
                } else {
                    // console.log(`📋 Group ${node.id} has no childNodes or childNodes is empty`);
                }
            }
            
            serializedNodes.push(serialized);
        });
        
        // Store the serialized nodes with relationship data
        if (window.app?.bulkOperationManager) {
            this.clipboard = serializedNodes.map(node => {
                // Optimize large media data
                return window.app.bulkOperationManager.optimizeNodeData(node);
            });
        } else {
            this.clipboard = serializedNodes;
        }
        
        console.log(`📋 Copied ${selected.length} nodes to clipboard, clipboard now has ${this.clipboard.length} items`);
        
        // Log node types for debugging
        const nodeTypes = {};
        this.clipboard.forEach(node => {
            nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1;
        });
        console.log('Clipboard contents:', nodeTypes);
        
        // Show notification for large copies
        if (selected.length > 50) {
            window.app?.notifications?.show({
                type: 'success',
                message: `Copied ${selected.length} nodes to clipboard`,
                timeout: 2000
            });
        }
    }
    
    cutSelected() {
        this.copySelected();
        this.deleteSelected();
    }
    
    async paste() {
        if (!this.clipboard || this.clipboard.length === 0) {
            console.log('⚠️ Clipboard is empty, nothing to paste');
            return;
        }
        
        // console.log(`📋 Starting paste operation with ${this.clipboard.length} nodes`);
        
        // Use OperationPipeline for collaborative paste
        if (window.app?.operationPipeline) {
            try {
                const mouseGraphPos = this.mouseState?.graph || [0, 0];
                let result;
                
                // Use BulkOperationManager for medium to large paste operations
                if (this.clipboard.length > 10 && window.app?.bulkOperationManager) {
                    // Optimize node data before sending
                    result = await window.app.bulkOperationManager.executeBulkOperation(
                        'node_paste',
                        this.clipboard,
                        { targetPosition: mouseGraphPos },
                        (nodeData) => window.app.bulkOperationManager.optimizeNodeData(nodeData)
                    );
                } else {
                    // Show progress feedback for medium operations
                    let progressNotification = null;
                    if (this.clipboard.length > 10) {
                        progressNotification = window.app?.notifications?.show({
                            type: 'info', 
                            message: `Pasting ${this.clipboard.length} nodes...`,
                            timeout: 0 // Don't auto-dismiss
                        });
                    }
                    
                    console.log('📋 Pasting nodes with data:', this.clipboard);
                    result = await window.app.operationPipeline.execute('node_paste', {
                        nodeData: this.clipboard,
                        targetPosition: mouseGraphPos
                    });
                    
                    // Clear progress notification
                    if (progressNotification) {
                        window.app?.notifications?.dismiss(progressNotification);
                    }
                }
                
                
                // console.log(`📋 Paste operation result:`, result);
                // console.log(`📋 Result structure - has result:`, !!result.result, 'has nodes:', !!(result.result && result.result.nodes));
                // console.log(`📋 Result.result:`, result.result);
                if (result && result.result && result.result.nodes) {
                    // console.log(`📋 Paste operation completed: ${result.result.nodes.length} nodes created`);
                    
                    // Clear selection first
                    this.selection.clear();
                    
                    // Don't select nodes immediately with optimistic updates
                    // Let StateSyncManager handle selection restoration through _pendingDuplicationSelection
                    if (!window.app?.operationPipeline?.stateSyncManager?.optimisticEnabled) {
                        // For non-optimistic, store node IDs to select when they arrive from server
                        this._pendingSelectionNodeIds = result.result.nodes.map(n => n.id);
                    }
                    // With optimistic updates, the selection will be restored by StateSyncManager
                    // when server nodes replace the temporary ones
                    
                    this.dirty_canvas = true;
                    
                    // Save navigation state after paste
                    if (window.navigationStateManager) {
                        console.log('📍 Saving navigation state after paste');
                        window.navigationStateManager.onViewportChange();
                    }
                } else {
                    console.warn('⚠️ Paste operation returned no nodes');
                }
            } catch (error) {
                console.error('Failed to paste nodes:', error);
                
                // Clear progress notification
                if (progressNotification) {
                    window.app?.notifications?.dismiss(progressNotification);
                }
                
                // Show error to user
                window.app?.notifications?.show({
                    type: 'error',
                    message: `Failed to paste ${this.clipboard.length} nodes: ${error.message || 'Server error'}`,
                    timeout: 5000
                });
                
            }
        } else {
            // Fallback to local operation
            this.pasteLocal();
        }
    }
    
    pasteLocal() {
        if (!this.clipboard || this.clipboard.length === 0) return;
        
        // Get current mouse position in graph coordinates
        const mouseGraphPos = this.mouseState?.graph || [0, 0];
        const newNodes = [];
        
        // Calculate the center of the clipboard content
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const nodeData of this.clipboard) {
            minX = Math.min(minX, nodeData.pos[0]);
            minY = Math.min(minY, nodeData.pos[1]);
            maxX = Math.max(maxX, nodeData.pos[0] + nodeData.size[0]);
            maxY = Math.max(maxY, nodeData.pos[1] + nodeData.size[1]);
        }
        
        const clipboardCenter = [(minX + maxX) / 2, (minY + maxY) / 2];
        
        for (const nodeData of this.clipboard) {
            const node = this.deserializeNode(nodeData);
            if (node) {
                // Position relative to mouse instead of fixed offset
                const offsetFromCenter = [
                    nodeData.pos[0] - clipboardCenter[0],
                    nodeData.pos[1] - clipboardCenter[1]
                ];
                
                node.pos[0] = mouseGraphPos[0] + offsetFromCenter[0];
                node.pos[1] = mouseGraphPos[1] + offsetFromCenter[1];
                
                this.graph.add(node);
                newNodes.push(node);
            }
        }
        
        if (newNodes.length > 0) {
            this.selection.clear();
            newNodes.forEach(node => this.selection.selectNode(node, true));
            this.pushUndoState();
            this.dirty_canvas = true;
        }
    }
    
    async duplicateSelected() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) return;
        
        // Use OperationPipeline for collaborative duplicate
        if (window.app?.operationPipeline) {
            try {
                const nodeIds = selected.map(node => node.id);
                let result;
                
                // Use BulkOperationManager for medium to large selections
                if (nodeIds.length > 10 && window.app?.bulkOperationManager) {
                    result = await window.app.bulkOperationManager.executeBulkOperation(
                        'node_duplicate',
                        nodeIds,
                        { offset: [20, 20] },
                        null // No item preparation needed for nodeIds
                    );
                } else {
                    // Show progress feedback for medium operations
                    let progressNotification = null;
                    if (nodeIds.length > 10) {
                        progressNotification = window.app?.notifications?.show({
                            type: 'info',
                            message: `Duplicating ${nodeIds.length} nodes...`,
                            timeout: 0 // Don't auto-dismiss
                        });
                    }
                    
                    result = await window.app.operationPipeline.execute('node_duplicate', {
                        nodeIds: nodeIds,
                        offset: [20, 20]
                    });
                    
                    // Clear progress notification
                    if (progressNotification) {
                        window.app?.notifications?.dismiss(progressNotification);
                    }
                }
                
                
                if (result && result.result && result.result.nodes) {
                    // Clear selection first
                    this.selection.clear();
                    
                    // Don't select nodes immediately with optimistic updates
                    // Let StateSyncManager handle selection restoration through _pendingDuplicationSelection
                    if (!window.app?.operationPipeline?.stateSyncManager?.optimisticEnabled) {
                        // For non-optimistic, store node IDs to select when they arrive from server
                        this._pendingSelectionNodeIds = result.result.nodes.map(n => n.id);
                    }
                    // With optimistic updates, the selection will be restored by StateSyncManager
                    // when server nodes replace the temporary ones
                    
                    this.dirty_canvas = true;
                }
            } catch (error) {
                console.error('Failed to duplicate nodes:', error);
                
                // Clear progress notification
                if (progressNotification) {
                    window.app?.notifications?.dismiss(progressNotification);
                }
                
                // Show error to user
                window.app?.notifications?.show({
                    type: 'error',
                    message: `Failed to duplicate ${nodeIds.length} nodes: ${error.message || 'Server error'}`,
                    timeout: 5000
                });
                
            }
        } else {
            // Fallback to local operation
            this.duplicateSelectedLocal();
        }
    }
    
    duplicateSelectedLocal() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) return;
        
        const duplicates = [];
        const offset = 20;
        
        for (const node of selected) {
            const duplicate = this.duplicateNode(node);
            if (duplicate) {
                duplicate.pos[0] += offset;
                duplicate.pos[1] += offset;
                this.graph.add(duplicate);
                duplicates.push(duplicate);
            }
        }
        
        if (duplicates.length > 0) {
            this.selection.clear();
            duplicates.forEach(dup => this.selection.selectNode(dup, true));
            this.pushUndoState();
            this.dirty_canvas = true;
        }
    }
    
    async syncLocalDuplicatesWithServer() {
        // Find all nodes marked for collaborative sync
        const nodesToSync = this.graph.nodes.filter(node => node._needsCollaborativeSync);
        
        if (nodesToSync.length === 0) return;
        
        // Define progressNotification at function scope
        let progressNotification = null;
        
        try {
            
            // Convert local nodes to collaborative by removing them locally 
            // and creating them through the collaborative system at final position
            const nodeDataArray = nodesToSync.map(node => ({
                originalId: node.id,
                type: node.type,
                pos: [...node.pos], // Final position after drag
                size: [...node.size],
                properties: { ...node.properties },
                flags: { ...node.flags },
                title: node.title,
                rotation: node.rotation || 0,
                aspectRatio: node.aspectRatio
            }));
            
            // Remove local duplicates first and clear them from selection
            nodesToSync.forEach(node => {
                this.selection.deselectNode(node);
                this.graph.remove(node);
                delete node._needsCollaborativeSync;
            });
            
            // Show progress feedback for large operations
            if (nodeDataArray.length > 50) {
                progressNotification = window.app?.notifications?.show({
                    type: 'info',
                    message: `Converting ${nodeDataArray.length} nodes...`,
                    timeout: 0 // Don't auto-dismiss
                });
            }
            
            // Use node_duplicate for better cache utilization
            const result = await window.app.operationPipeline.execute('node_duplicate', {
                nodeIds: [], // Empty since we're providing explicit node data
                nodeData: nodeDataArray, // Explicit node data with positions
                offset: [0, 0] // No offset, already positioned
            });
            
            // Clear progress notification
            if (progressNotification) {
                window.app?.notifications?.dismiss(progressNotification);
            }
            
            if (result && result.result && result.result.nodes) {
                // Select the created nodes
                result.result.nodes.forEach(node => {
                    this.selection.selectNode(node, true);
                });
                console.log(`🔄 Converted ${result.result.nodes.length} local duplicates to collaborative nodes`);
            } else {
                console.error('❌ Failed to create collaborative nodes:', result);
            }
            
            // Force the canvas to update selection visuals
            this.dirty_canvas = true;
            
            
        } catch (error) {
            console.error('Failed to convert local duplicates to collaborative:', error);
            
            // Clear progress notification
            if (progressNotification) {
                window.app?.notifications?.dismiss(progressNotification);
            }
            
            // Show error to user
            window.app?.notifications?.show({
                type: 'error',
                message: `Failed to convert ${nodeDataArray.length} nodes: ${error.message || 'Server error'}`,
                timeout: 5000
            });
            
            // If collaborative conversion failed (e.g., authentication error), 
            // we need to handle the local duplicates properly
            if (error.message && error.message.includes('Not authenticated')) {
                // Remove sync flags from local nodes so they don't cause issues
                const stillPendingNodes = this.graph.nodes.filter(node => node._needsCollaborativeSync);
                stillPendingNodes.forEach(node => {
                    delete node._needsCollaborativeSync;
                });
            } else {
                console.error('Unexpected error during conversion, cleaning up local duplicates');
                // For other errors, remove the local duplicates to prevent phantom nodes
                const stillPendingNodes = this.graph.nodes.filter(node => node._needsCollaborativeSync);
                stillPendingNodes.forEach(node => {
                    this.selection.deselectNode(node);
                    this.graph.remove(node);
                });
                this.selection.clear();
            }
            
        }
    }
    
    async deleteSelected() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) return;

        const undoManager = window.app?.undoManager;
        if (selected.length > 1) {
            undoManager?.beginTransaction('delete_multiple_nodes');
        }

        const nodeIds = selected.map(node => node.id);
        await window.app.operationPipeline.execute('node_delete', { nodeIds });

        if (selected.length > 1) {
            undoManager?.commitTransaction();
        }

        this.selection.clear();
    }
    
    selectAll() {
        this.selection.selectAll(this.graph.nodes);
    }
    
    createGroupFromSelected() {
        const selected = this.selection.getSelectedNodes();
        
        // Allow creating empty groups
        if (selected.length === 0) {
            // Create empty group at mouse position or center of viewport
            const mousePos = this.mouseState.graph || [0, 0];
            const defaultSize = 200;
            const titleBarHeight = 30;
            
            // Center the group on the mouse position
            const groupX = mousePos[0] - defaultSize / 2;
            const groupY = mousePos[1] - (defaultSize + titleBarHeight) / 2;
            
            // Create group through collaborative system using GroupNodeCommand
            if (window.app?.operationPipeline) {
                const command = new window.NodeCommands.GroupNodeCommand({
                    action: 'group_create',
                    nodeIds: [], // Empty group
                    groupPos: [groupX, groupY],
                    groupSize: [defaultSize, defaultSize + titleBarHeight],
                    groupTitle: `Group ${this.graph.nodes.filter(n => n.type === 'container/group').length + 1}`
                });
                
                window.app.operationPipeline.executeCommand(command);
            } else {
                console.warn('No operation pipeline available - group creation requires collaborative mode');
            }
            return;
        }
        
        // Don't allow grouping if any selected nodes are already groups
        const hasGroups = selected.some(node => node.type === 'container/group');
        if (hasGroups) {
            console.warn('Cannot create group: groups cannot contain other groups');
            return;
        }
        
        // Calculate bounding box of selected nodes
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const node of selected) {
            const nodeMinX = node.pos[0];
            const nodeMinY = node.pos[1];
            const nodeMaxX = node.pos[0] + node.size[0];
            const nodeMaxY = node.pos[1] + node.size[1];
            
            minX = Math.min(minX, nodeMinX);
            minY = Math.min(minY, nodeMinY);
            maxX = Math.max(maxX, nodeMaxX);
            maxY = Math.max(maxY, nodeMaxY);
        }
        
        // Calculate group position and size with padding
        const padding = 20;
        const titleBarHeight = 30;
        const groupX = minX - padding;
        const groupY = minY - padding - titleBarHeight;
        const groupWidth = maxX - minX + (padding * 2);
        const groupHeight = maxY - minY + (padding * 2) + titleBarHeight;
        
        // Create group through collaborative system
        // Always use the collaborative path - optimistic updates will provide immediate feedback
        if (window.app?.operationPipeline) {
            const command = new window.NodeCommands.GroupNodeCommand({
                action: 'group_create',
                nodeIds: selected.map(node => node.id),
                groupPos: [groupX, groupY],
                groupSize: [groupWidth, groupHeight],
                groupTitle: `Group ${this.graph.nodes.filter(n => n.type === 'container/group').length + 1}`
            });
            
            window.app.operationPipeline.executeCommand(command);
            
            // Clear selection - the new group will be selected when optimistic update applies
        } else {
            console.warn('No operation pipeline available - group creation requires collaborative mode');
        }
    }
    
    zoomToFit() {
        if (this.selection.isEmpty()) {
            this.zoomToFitAll();
        } else {
            this.zoomToFitSelection();
        }
    }
    
    zoomToFitAll() {
        const bbox = this.graph.getBoundingBox();
        if (bbox) {
            this.viewport.zoomToFit(bbox, 40, true); // Enable animation
            this.dirty_canvas = true;
        }
    }
    
    zoomToFitSelection() {
        const bbox = this.selection.getBoundingBox();
        if (bbox) {
            this.viewport.zoomToFit(bbox, 40, true); // Enable animation
            this.dirty_canvas = true;
        }
    }
    
    centerOnSelection() {
        const bbox = this.selection.getBoundingBox();
        if (bbox) {
            // Calculate center of selection bounding box
            const centerX = bbox[0] + bbox[2] / 2;
            const centerY = bbox[1] + bbox[3] / 2;
            
            // Pan to center without changing zoom
            this.viewport.panToCenter(centerX, centerY, true); // Enable animation
            this.dirty_canvas = true;
        }
    }
    
    keyboardZoom(factor) {
        // Get canvas center as zoom pivot point
        const canvasWidth = this.canvas.width / this.viewport.dpr;
        const canvasHeight = this.canvas.height / this.viewport.dpr;
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        
        // Convert factor to delta for viewport.zoom method
        // factor > 1 means zoom in (negative delta), factor < 1 means zoom out (positive delta)
        const delta = factor > 1 ? -1 : 1;
        
        // Use viewport.zoom() to ensure navigation state is saved through hooks
        this.viewport.zoom(delta, centerX, centerY);
        
        this.dirty_canvas = true;
    }
    
    resetView() {
        // Panic button: move all nodes to graph origin (0,0) and reset viewport
        const nodes = this.graph.nodes;
        
        if (nodes.length > 0) {
            // Calculate current bounding box of all nodes
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            
            for (const node of nodes) {
                const [x, y, w, h] = node.getBoundingBox();
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x + w);
                maxY = Math.max(maxY, y + h);
            }
            
            // Calculate current center of all nodes
            const currentCenterX = (minX + maxX) / 2;
            const currentCenterY = (minY + maxY) / 2;
            
            // Move all nodes so their center is at graph origin (0, 0)
            const deltaX = -currentCenterX;
            const deltaY = -currentCenterY;
            
            this.pushUndoState(); // Save state before moving nodes
            
            for (const node of nodes) {
                node.pos[0] += deltaX;
                node.pos[1] += deltaY;
            }
        }
        
        // Reset viewport to standard home position
        // Use viewport.resetView() if available, otherwise direct modification
        if (this.viewport.resetView) {
            this.viewport.resetView();
        } else {
            this.viewport.scale = 1.0;
            const canvasWidth = this.canvas.width / this.viewport.dpr;
            const canvasHeight = this.canvas.height / this.viewport.dpr;
            this.viewport.offset = [canvasWidth / 2, canvasHeight / 2];
        }
        
        // Force navigation state save after reset
        if (window.navigationStateManager) {
            console.log('🔍 Manually triggering navigation state save after resetView');
            window.navigationStateManager.onViewportChange();
        }
        
        this.dirty_canvas = true;
        // Navigation state is saved by NavigationStateManager.onViewportChange() above
    }
    
    findNodeInDirection(fromNode, direction) {
        const nodes = this.graph.nodes;
        if (nodes.length <= 1) return null;
        
        const [fromX, fromY] = fromNode.getCenter();
        let bestNode = null;
        let bestScore = Infinity;
        
        // Define direction angles (in radians)
        const directionAngles = {
            'right': 0,
            'down': Math.PI / 2,
            'left': Math.PI,
            'up': -Math.PI / 2
        };
        
        const targetAngle = directionAngles[direction];
        const angleTolerance = Utils.degToRad(CONFIG.NAVIGATION.DIRECTION_ANGLE_TOLERANCE);
        
        for (const node of nodes) {
            if (node === fromNode) continue;
            
            // Skip group nodes
            if (node.type === 'container/group') continue;
            
            const [toX, toY] = node.getCenter();
            const angle = Utils.angleFromTo(fromX, fromY, toX, toY);
            
            // Calculate angular difference
            let angleDiff = Math.abs(angle - targetAngle);
            if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
            
            // Skip if outside direction quadrant
            if (angleDiff > angleTolerance) continue;
            
            // Calculate distance
            const distance = Utils.distance(fromX, fromY, toX, toY);
            
            // Score based on distance and angle alignment
            // Prefer closer nodes and better angle alignment
            const angleScore = angleDiff / angleTolerance; // 0 to 1
            const score = distance * (1 + angleScore * 0.5);
            
            if (score < bestScore) {
                bestScore = score;
                bestNode = node;
            }
        }
        
        return bestNode;
    }
    
    navigateToNode(direction) {
        const selected = this.selection.getSelectedNodes();
        if (selected.length !== 1) return;
        
        const currentNode = selected[0];
        const nextNode = this.findNodeInDirection(currentNode, direction);
        
        if (nextNode) {
            // Clear current selection
            this.selection.clear();
            
            // Select the next node
            this.selection.select(nextNode);
            
            // Center on the selected node with animation (no zoom)
            this.centerOnSelection();
            
            // Mark dirty for redraw
            this.dirty_canvas = true;
        }
    }
    
    alignSelected(axis) {
        const selected = this.selection.getSelectedNodes();
        if (selected.length < 2) return;

        window.app.undoManager.beginInteraction(selected);
        window.app.undoManager.endInteraction('node_align', { axis });
    }

    moveSelectedUp() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) return;

        const nodeIds = selected.map(node => node.id);
        window.app.operationPipeline.execute('node_layer_order', { nodeIds, direction: 'up' });
    }
    
    moveSelectedDown() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) return;

        const nodeIds = selected.map(node => node.id);
        window.app.operationPipeline.execute('node_layer_order', { nodeIds, direction: 'down' });
    }
    
    sendSelectedToBack() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) return;

        // Find minimum z-index
        let minZ = Infinity;
        for (const node of this.graph.nodes) {
            const z = node.zIndex ?? 0;
            if (z < minZ) minZ = z;
        }
        
        // Set selected nodes to below minimum
        for (const node of selected) {
            node.zIndex = minZ - 1;
            
            // If it's a group, move all children too
            if (node.type === 'container/group' && node.childNodes) {
                for (const childId of node.childNodes) {
                    const child = this.graph.getNodeById(childId);
                    if (child) {
                        child.zIndex = minZ - 1;
                    }
                }
            }
        }
        
        // Normalize z-indices
        this.normalizeAllZIndices();
    }
    
    bringSelectedToFront() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) return;

        // Find maximum z-index
        let maxZ = -Infinity;
        for (const node of this.graph.nodes) {
            const z = node.zIndex ?? 0;
            if (z > maxZ) maxZ = z;
        }
        
        // Set selected nodes to above maximum
        for (const node of selected) {
            node.zIndex = maxZ + 1;
            
            // If it's a group, move all children too
            if (node.type === 'container/group' && node.childNodes) {
                for (const childId of node.childNodes) {
                    const child = this.graph.getNodeById(childId);
                    if (child) {
                        child.zIndex = maxZ + 1;
                    }
                }
            }
        }
        
        // Normalize z-indices
        this.normalizeAllZIndices();
    }
    
    normalizeAllZIndices() {
        // Sort all nodes by current z-index
        const sorted = [...this.graph.nodes].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
        
        // Reassign z-indices as integers starting from 0
        sorted.forEach((node, index) => {
            node.zIndex = index;
        });
    }
    
    // ===================================
    // SMART LAYER ORDERING
    // ===================================
    
    getEffectiveZIndex(node) {
        // Find parent group if any
        const parentGroup = this.getParentGroup(node);
        if (parentGroup) {
            // Use parent group's z-index
            return parentGroup.zIndex ?? 0;
        }
        // Use node's own z-index
        return node.zIndex ?? 0;
    }
    
    getParentGroup(node) {
        // Find which group contains this node
        for (const n of this.graph.nodes) {
            if (n.type === 'container/group' && n.childNodes?.has(node.id)) {
                return n;
            }
        }
        return null;
    }
    
    getOverlappingNodes(targetNode) {
        const [tx, ty, tw, th] = targetNode.getBoundingBox();
        const overlapping = [];
        
        for (const node of this.graph.nodes) {
            if (node === targetNode) continue;
            
            const [nx, ny, nw, nh] = node.getBoundingBox();
            
            // Check if bounding boxes overlap
            if (tx < nx + nw && tx + tw > nx && ty < ny + nh && ty + th > ny) {
                overlapping.push(node);
            }
        }
        
        overlapping.push(targetNode); // Include the target node itself
        return overlapping;
    }
    
    moveNodeUpSmart(node) {
        const overlapping = this.getOverlappingNodes(node);
        
        if (overlapping.length <= 1) {
            // No overlapping nodes, use regular movement
            this.graph.moveNodeUp(node);
            return;
        }
        
        // Sort overlapping nodes by their current layer order (position in nodes array)
        overlapping.sort((a, b) => this.graph.nodes.indexOf(a) - this.graph.nodes.indexOf(b));
        
        const currentIndex = overlapping.indexOf(node);
        if (currentIndex < overlapping.length - 1) {
            // Move to next position in overlapping group
            const nextNode = overlapping[currentIndex + 1];
            this.swapNodeLayers(node, nextNode);
        }
        // If already at top of overlapping group, do nothing
    }
    
    moveNodeDownSmart(node) {
        const overlapping = this.getOverlappingNodes(node);
        
        if (overlapping.length <= 1) {
            // No overlapping nodes, use regular movement
            this.graph.moveNodeDown(node);
            return;
        }
        
        // Sort overlapping nodes by their current layer order (position in nodes array)
        overlapping.sort((a, b) => this.graph.nodes.indexOf(a) - this.graph.nodes.indexOf(b));
        
        const currentIndex = overlapping.indexOf(node);
        if (currentIndex > 0) {
            // Move to previous position in overlapping group
            const prevNode = overlapping[currentIndex - 1];
            this.swapNodeLayers(node, prevNode);
        }
        // If already at bottom of overlapping group, do nothing
    }
    
    swapNodeLayers(nodeA, nodeB) {
        const indexA = this.graph.nodes.indexOf(nodeA);
        const indexB = this.graph.nodes.indexOf(nodeB);
        
        if (indexA !== -1 && indexB !== -1) {
            [this.graph.nodes[indexA], this.graph.nodes[indexB]] = [this.graph.nodes[indexB], this.graph.nodes[indexA]];
        }
    }
    
    moveGroupUp(selectedNodes) {
        // Sort selected nodes by current layer order
        const sortedNodes = [...selectedNodes].sort((a, b) => 
            this.graph.nodes.indexOf(a) - this.graph.nodes.indexOf(b)
        );
        
        // Find the topmost selected node
        const topNode = sortedNodes[sortedNodes.length - 1];
        const topIndex = this.graph.nodes.indexOf(topNode);
        
        // Find next non-selected node above the group
        let targetIndex = topIndex + 1;
        while (targetIndex < this.graph.nodes.length && 
               selectedNodes.includes(this.graph.nodes[targetIndex])) {
            targetIndex++;
        }
        
        if (targetIndex < this.graph.nodes.length) {
            // Move entire group past the next non-selected node
            this.moveGroupToPosition(sortedNodes, targetIndex + 1 - sortedNodes.length);
        }
        // If group is already at the top, do nothing
    }
    
    moveGroupDown(selectedNodes) {
        // Sort selected nodes by current layer order
        const sortedNodes = [...selectedNodes].sort((a, b) => 
            this.graph.nodes.indexOf(a) - this.graph.nodes.indexOf(b)
        );
        
        // Find the bottommost selected node
        const bottomNode = sortedNodes[0];
        const bottomIndex = this.graph.nodes.indexOf(bottomNode);
        
        // Find next non-selected node below the group
        let targetIndex = bottomIndex - 1;
        while (targetIndex >= 0 && 
               selectedNodes.includes(this.graph.nodes[targetIndex])) {
            targetIndex--;
        }
        
        if (targetIndex >= 0) {
            // Move entire group behind the next non-selected node
            this.moveGroupToPosition(sortedNodes, targetIndex);
        }
        // If group is already at the bottom, do nothing
    }
    
    moveGroupToPosition(nodesToMove, insertIndex) {
        // Remove all nodes from their current positions
        const nodes = this.graph.nodes;
        for (const node of nodesToMove) {
            const index = nodes.indexOf(node);
            if (index !== -1) {
                nodes.splice(index, 1);
                // Adjust insert index if we removed a node before it
                if (index < insertIndex) {
                    insertIndex--;
                }
            }
        }
        
        // Insert all nodes at the new position in their original relative order
        for (let i = 0; i < nodesToMove.length; i++) {
            nodes.splice(insertIndex + i, 0, nodesToMove[i]);
        }
    }
    
    createTextNodeAtCenter() {
        const viewport = this.viewport.getViewport();
        const center = [
            viewport.x + viewport.width / 2,
            viewport.y + viewport.height / 2
        ];
        this.createTextNodeAt(center);
    }
    
    createTextNodeAt(pos) {
        if (typeof NodeFactory === 'undefined') {
            console.warn('NodeFactory not available');
            return;
        }
        
        const node = NodeFactory.createNode('media/text');
        if (node) {
            node.pos = [pos[0] - node.size[0] / 2, pos[1] - node.size[1] / 2];
            if (node.setText) {
                node.setText('Text');
            }
            this.graph.add(node);
            this.selection.selectNode(node);
            
            // Broadcast text node creation for collaboration
            if (this.collaborativeManager) {
                // Node creation is already synced when added to graph
            }
            
            this.pushUndoState();
            this.dirty_canvas = true;
        }
    }
    
    toggleTitleVisibility() {
        const selected = this.selection.getSelectedNodes();
        const nonTextNodes = selected.filter(node => node.type !== 'media/text');
        
        if (nonTextNodes.length === 0) return;
        
        // Determine current state
        const hiddenCount = nonTextNodes.filter(node => node.flags?.hide_title).length;
        const newHiddenState = hiddenCount < nonTextNodes.length;
        
        for (const node of nonTextNodes) {
            if (!node.flags) node.flags = {};
            node.flags.hide_title = newHiddenState;
        }
        
        this.pushUndoState();
        this.dirty_canvas = true;
    }
    
    // ===================================
    // NODE UTILITIES
    // ===================================
    
    duplicateNode(originalNode) {
        const nodeData = this.serializeNode(originalNode);
        const duplicate = this.deserializeNode(nodeData, true); // true = skip media loading
        
        // Add suffix to duplicated titles
        if (duplicate && duplicate.title) {
            // Check if title already has "Copy" suffix
            const copyMatch = duplicate.title.match(/^(.*?)\s*\(Copy\s*(\d*)\)$/);
            if (copyMatch) {
                // Increment copy number
                const baseName = copyMatch[1];
                const copyNum = copyMatch[2] ? parseInt(copyMatch[2]) + 1 : 2;
                duplicate.title = `${baseName} (Copy ${copyNum})`;
            } else {
                // Add first copy suffix
                duplicate.title = `${duplicate.title} (Copy)`;
            }
        }
        
        // For media nodes, copy the actual media element reference if available
        if (duplicate && (originalNode.type === 'media/image' || originalNode.type === 'media/video')) {
            if (originalNode.img && duplicate.setImage) {
                // Copy image reference directly to avoid grey error box
                duplicate.img = originalNode.img;
                duplicate.loadingState = 'loaded';
                duplicate.loadingProgress = 1.0;
            } else if (originalNode.video && duplicate.setVideo) {
                // Copy video reference for video nodes
                duplicate.video = originalNode.video;
                duplicate.loadingState = 'loaded';
                duplicate.loadingProgress = 1.0;
            }
        }
        
        return duplicate;
    }
    
    serializeNode(node) {
        // Use UndoOptimization utility if available
        if (window.UndoOptimization) {
            return window.UndoOptimization.optimizeNodeData(node, true); // true = forCopy
        }
        
        // Fallback to inline optimization
        const serialized = {
            type: node.type,
            pos: [...node.pos],
            size: [...node.size],
            title: node.title,
            properties: { ...node.properties },
            flags: { ...node.flags },
            aspectRatio: node.aspectRatio,
            rotation: node.rotation
        };
        
        // For group nodes, preserve childNodes for copy/paste tracking
        if (node.type === 'container/group') {
            // Ensure properties exist
            if (!serialized.properties) {
                serialized.properties = {};
            }
            // Convert Set to Array for serialization
            if (node.childNodes instanceof Set) {
                serialized.properties.childNodes = Array.from(node.childNodes);
                // console.log(`📋 Serializing group ${node.id} with ${node.childNodes.size} children:`, serialized.properties.childNodes);
            } else {
                serialized.properties.childNodes = [];
            }
        }
        
        // For media nodes, ensure we never include data URLs
        if (node.type === 'media/image' || node.type === 'media/video') {
            // Keep only reference properties
            serialized.properties = {
                hash: node.properties.hash,
                serverUrl: node.properties.serverUrl,
                serverFilename: node.properties.serverFilename,
                filename: node.properties.filename,
                scale: node.properties.scale || 1.0,
                originalSrc: node.properties.originalSrc // For single-user mode fallback
            };
            // Remove any accidental src field with data URL
            if (serialized.properties.src && serialized.properties.src.startsWith('data:')) {
                delete serialized.properties.src;
            }
        }
        
        return serialized;
    }
    
    loadMediaForNode(node, nodeData) {
        const hash = nodeData.properties.hash;
        const filename = nodeData.properties.filename;
        const isVideo = nodeData.type === 'media/video';
        
        // Try to get from cache first
        if (window.imageCache) {
            const cached = window.imageCache.get(hash);
            if (cached) {
                if (isVideo && node.setVideo) {
                    node.setVideo(cached, filename, hash);
                } else if (node.setImage) {
                    node.setImage(cached, filename, hash);
                }
                return;
            }
        }
        
        // Check if thumbnails exist
        const hasThumbnails = window.thumbnailCache && window.thumbnailCache.hasThumbnails(hash);
        
        if (hasThumbnails) {
            // Thumbnails exist - set to loaded state so thumbnails are used for rendering
            node.loadingState = 'loaded';
            node.loadingProgress = 1.0;
            
            // For images, we can load the full image in background without changing loading state
            // For videos, we still need to load the full video
            if (isVideo) {
                node.loadingState = 'loading';
                node.loadingProgress = 0.1;
            }
        } else {
            node.loadingState = 'loading';
            node.loadingProgress = 0;
        }
        
        // Try to load from collaborative server if available
        if (this.collaborativeManager?.isConnected) {
            const serverUrl = `${CONFIG.ENDPOINTS.UPLOADS}/${nodeData.properties.serverFilename || filename}`;
            
            if (isVideo && node.setVideo) {
                node.setVideo(serverUrl, filename, hash).catch(() => {
                    console.warn('Failed to load video from server:', filename);
                    node.loadingState = 'error';
                });
            } else if (node.setImage) {
                node.setImage(serverUrl, filename, hash).catch(() => {
                    console.warn('Failed to load image from server:', filename);
                    node.loadingState = 'error';
                });
            }
        } else {
            // Single-user mode: try to find original source
            const originalSrc = nodeData.properties.originalSrc || nodeData.properties.src;
            if (originalSrc) {
                if (isVideo && node.setVideo) {
                    node.setVideo(originalSrc, filename, hash).catch(() => {
                        console.warn('Failed to load video from original source:', filename);
                        node.loadingState = 'error';
                    });
                } else if (node.setImage) {
                    node.setImage(originalSrc, filename, hash).catch(() => {
                        console.warn('Failed to load image from original source:', filename);
                        node.loadingState = 'error';
                    });
                }
            } else {
                // Check if the node already has media loaded (e.g., from alt-drag duplication)
                if ((node.img && node.img.complete) || (node.video && node.video.readyState >= 2)) {
                    // Media is already loaded, no need to warn
                    node.loadingState = 'loaded';
                    node.loadingProgress = 1.0;
                } else {
                    console.warn('No source available for duplicated media node:', filename);
                    node.loadingState = 'error';
                }
            }
        }
    }
    
    deserializeNode(nodeData, skipMediaLoading = false) {
        if (typeof NodeFactory === 'undefined') {
            console.warn('NodeFactory not available');
            return null;
        }
        
        const node = NodeFactory.createNode(nodeData.type);
        if (!node) return null;
        
        node.pos = [...nodeData.pos];
        node.size = [...nodeData.size];
        node.title = nodeData.title;
        node.properties = { ...nodeData.properties };
        // Merge flags preserving constructor defaults (like hide_title: true)
        if (nodeData.flags) {
            node.flags = { ...node.flags, ...nodeData.flags };
        }
        node.aspectRatio = nodeData.aspectRatio || 1;
        node.rotation = nodeData.rotation || 0;
        
        // Load media content if available (skip for local duplicates)
        if (!skipMediaLoading && (nodeData.type === 'media/image' || nodeData.type === 'media/video') && nodeData.properties.hash) {
            this.loadMediaForNode(node, nodeData);
        }
        
        return node;
    }
    
    // ===================================
    // EDITING SUPPORT
    // ===================================
    
    isEditingText() {
        // Check if editing node title or text
        if (this._editingTitleInput || this._editingTextInput) {
            return true;
        }
        
        // Check if editing canvas title in navigator
        const canvasTitleInput = document.querySelector('.canvas-title-input');
        if (canvasTitleInput && document.activeElement === canvasTitleInput) {
            return true;
        }
        
        return false;
    }
    
    canEditTitle(node, pos) {
        if (node.flags?.hide_title) return false;
        const displayTitle = node.getDisplayTitle();
        if (!displayTitle) return false;
        
        // Check if node is too small to show title (same as in drawNodeTitle)
        const screenScale = this.viewport.scale;
        const minScreenSize = 40;
        const nodeScreenWidth = node.size[0] * screenScale;
        const nodeScreenHeight = node.size[1] * screenScale;
        
        if (nodeScreenWidth < minScreenSize || nodeScreenHeight < minScreenSize) {
            return false; // Title not visible
        }
        
        // Get the actual draw position (accounting for animations)
        let drawPos = node.pos;
        if (node._gridAnimPos) {
            drawPos = node._gridAnimPos;  // Grid-align animation
        } else if (node._animPos) {
            drawPos = node._animPos;      // Auto-align animation
        }
        
        // Transform the click position into the node's local coordinate space
        // This accounts for both translation and rotation
        let localX = pos[0] - drawPos[0];
        let localY = pos[1] - drawPos[1];
        
        // If the node is rotated, apply inverse rotation to get local coordinates
        if (node.rotation) {
            const angle = -node.rotation * Math.PI / 180; // Negative for inverse rotation
            const cx = node.size[0] / 2;
            const cy = node.size[1] / 2;
            
            // Translate to rotation center
            const dx = localX - cx;
            const dy = localY - cy;
            
            // Apply inverse rotation
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            localX = dx * cos - dy * sin + cx;
            localY = dx * sin + dy * cos + cy;
        }
        
        // Title is drawn at local position (0, -titlePadding) in node space
        const titlePadding = 8 / screenScale; // Must match drawNodeTitle
        const fontSize = 14 / screenScale; // Must match drawNodeTitle
        const titleHeight = fontSize * 1.4; // Slightly increased for better hit area
        
        // Check if the local position is within title bounds
        // Title spans from x=0 to x=node.size[0] in local space
        // Title y position is from -titlePadding-titleHeight to -titlePadding+titleHeight*0.5
        const inBounds = localX >= 0 && localX <= node.size[0] &&
                        localY >= -titlePadding - titleHeight && 
                        localY <= -titlePadding + titleHeight * 0.5;
        
        return inBounds;
    }
    
    startTitleEditing(node, e) {
        if (this._editingTitleInput) {
            this.finishTitleEditing();
        }

        // Create input overlay for title editing
        const input = document.createElement('input');
        input.type = 'text';
        input.value = node.title || '';
        input.style.position = 'fixed';
        input.style.zIndex = '10000';
        input.style.border = `2px solid ${ColorUtils.get('borders', 'focus')}`;
        input.style.outline = 'none';
        input.style.background = ColorUtils.get('backgrounds', 'overlay_dark');
        input.style.color = ColorUtils.get('text', 'bright');
        input.style.fontFamily = FONT_CONFIG.APP_FONT;
        input.style.padding = '2px 4px';
        input.style.borderRadius = '4px';
        input.style.minWidth = '150px';
        input.style.boxSizing = 'border-box';
        
        // Get actual draw position (accounting for animations)
        let drawPos = node.pos;
        if (this.animationManager && this.animationManager.getNodeDrawPosition) {
            drawPos = this.animationManager.getNodeDrawPosition(node);
        } else if (node._gridAnimPos) {
            drawPos = node._gridAnimPos;
        } else if (node._animPos) {
            drawPos = node._animPos;
        }
        
        // Calculate position for input above the node - must match drawNodeTitle
        const screenScale = this.viewport.scale;
        const titlePadding = 8 / screenScale; // Same as in drawNodeTitle
        const fontSize = 14 / screenScale; // Same as in drawNodeTitle
        const titleY = drawPos[1] - titlePadding;
        
        // Convert to screen coordinates
        const [screenX, screenY] = this.viewport.convertGraphToOffset(drawPos[0], titleY);
        
        // Get canvas bounds for positioning
        const canvasRect = this.canvas.getBoundingClientRect();
        
        // Account for device pixel ratio
        const dpr = window.devicePixelRatio || 1;
        
        // Set font size that looks consistent at current zoom
        const baseFontSize = 14; // Match drawNodeTitle base size
        input.style.fontSize = `${baseFontSize}px`;
        
        // Position the input - add canvas offset and adjust for input height
        // Note: convertGraphToOffset already returns CSS pixels, not canvas pixels
        // Account for input border (2px) and padding (2px)
        const inputBorderPadding = 4; // 2px border + 2px padding
        input.style.left = `${canvasRect.left + screenX - inputBorderPadding}px`;
        // Adjust vertical position to align baseline - canvas draws from baseline, input from top
        input.style.top = `${canvasRect.top + screenY - baseFontSize - inputBorderPadding}px`;
        
        // Set width to match node width
        const nodeScreenWidth = node.size[0] * this.viewport.scale;
        input.style.width = `${Math.max(150, nodeScreenWidth)}px`;
        
        // Store references
        this._editingTitleInput = input;
        this._editingTitleNode = node;
        this._originalTitle = node.title || '';
        
        // Event handlers
        let isFinishing = false;
        input.addEventListener('blur', () => {
            if (!isFinishing) {
                this.finishTitleEditing();
            }
        });
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
                isFinishing = true;
                this.cancelTitleEditing();
            } else if (e.key === 'Enter') {
                isFinishing = true;
                this.finishTitleEditing();
            }
        });
        
        // Add to DOM and focus
        document.body.appendChild(input);
        input.focus();
        input.select();
    }
    
    startTextEditing(node, e) {
        if (this._editingTextInput) {
            this.finishTextEditing();
        }

        // Mark node as editing
        node.startEditing();
        
        // Create WYSIWYG textarea overlay
        const textarea = document.createElement('textarea');
        textarea.name = `text-edit-${node.id}`;
        textarea.id = `text-edit-${node.id}`;
        textarea.value = node.properties.text || '';
        textarea.style.position = 'fixed';
        textarea.style.zIndex = '10000';
        textarea.style.resize = 'none';
        textarea.style.border = `2px solid ${ColorUtils.get('borders', 'focus')}`;
        textarea.style.outline = 'none';
        textarea.style.background = 'transparent';
        textarea.style.color = node.properties.textColor;
        textarea.style.fontFamily = node.properties.fontFamily;
        textarea.style.fontSize = `${node.properties.fontSize * this.viewport.scale}px`;
        textarea.style.textAlign = node.properties.textAlign;
        textarea.style.lineHeight = node.properties.leadingFactor;
        textarea.style.padding = `${node.properties.padding * this.viewport.scale}px`;
        textarea.style.overflow = 'hidden';
        textarea.style.whiteSpace = 'pre-wrap';
        textarea.style.wordWrap = 'break-word';

        // Position and size the textarea to match the node
        this.positionTextEditingOverlay(textarea, node);

        // Event handlers
        textarea.addEventListener('blur', () => this.finishTextEditing());
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.cancelTextEditing();
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.finishTextEditing();
            }
            e.stopPropagation();
        });

        // Update text and size in real-time
        textarea.addEventListener('input', () => {
            node.properties.text = textarea.value;
            this.dirty_canvas = true;
            this.updateTextEditingOverlaySize(textarea, node);
            
            // Broadcast text changes in real-time for collaboration
            if (this.collaborativeManager) {
                this.broadcastNodePropertyUpdate(node.id, 'text', textarea.value);
            }
        });

        // Add to DOM and focus
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        // Store references
        this._editingTextInput = textarea;
        this._editingTextNode = node;
    }

    positionTextEditingOverlay(textarea, node) {
        // Use animated position if available
        let nodePos = node.pos;
        if (node._gridAnimPos) {
            nodePos = node._gridAnimPos;
        } else if (node._animPos) {
            nodePos = node._animPos;
        }

        const [screenX, screenY] = this.viewport.convertGraphToOffset(nodePos[0], nodePos[1]);
        const rect = this.canvas.getBoundingClientRect();
        
        textarea.style.left = `${rect.left + screenX}px`;
        textarea.style.top = `${rect.top + screenY}px`;
        textarea.style.width = `${node.size[0] * this.viewport.scale}px`;
        textarea.style.height = `${node.size[1] * this.viewport.scale}px`;
    }

    updateTextEditingOverlaySize(textarea, node) {
        // Update overlay size to match node
        textarea.style.width = `${node.size[0] * this.viewport.scale}px`;
        textarea.style.height = `${node.size[1] * this.viewport.scale}px`;
        textarea.style.fontSize = `${node.properties.fontSize * this.viewport.scale}px`;
        textarea.style.padding = `${node.properties.padding * this.viewport.scale}px`;
    }

    finishTextEditing() {
        if (!this._editingTextInput || !this._editingTextNode) return;

        const node = this._editingTextNode;
        const textarea = this._editingTextInput;
        
        // Update node text
        node.properties.text = textarea.value;
        node.stopEditing();
        
        // Auto-resize if needed
        const oldSize = [...node.size];
        if (node.autoResize) {
            node.autoResize();
        }
        
        // Broadcast final text state and any size changes for collaboration
        if (this.collaborativeManager) {
            this.broadcastNodePropertyUpdate(node.id, 'text', textarea.value);
            
            // If size changed during auto-resize, broadcast that too
            if (oldSize[0] !== node.size[0] || oldSize[1] !== node.size[1]) {
                this.broadcastNodeResize();
            }
        }

        // Cleanup
        document.body.removeChild(textarea);
        this._editingTextInput = null;
        this._editingTextNode = null;
        
        this.pushUndoState();
        this.dirty_canvas = true;
    }

    cancelTextEditing() {
        if (!this._editingTextInput || !this._editingTextNode) return;

        const node = this._editingTextNode;
        const textarea = this._editingTextInput;
        
        // Restore original text (no changes)
        node.stopEditing();
        
        // Cleanup
        document.body.removeChild(textarea);
        this._editingTextInput = null;
        this._editingTextNode = null;
        
        this.dirty_canvas = true;
    }
    
    finishTitleEditing() {
        if (!this._editingTitleInput || !this._editingTitleNode) return;

        const node = this._editingTitleNode;
        const input = this._editingTitleInput;
        
        // Clear references first to prevent double execution
        this._editingTitleInput = null;
        this._editingTitleNode = null;
        
        // Update node title
        const newTitle = input.value.trim();
        if (newTitle !== node.title) {
            // Use operation pipeline for collaborative support
            if (window.app?.operationPipeline) {
                window.app.operationPipeline.execute('node_property_update', {
                    nodeId: node.id,
                    property: 'title',
                    value: newTitle
                });
            } else {
                node.title = newTitle;
            }
            
            // Mark canvas dirty to redraw
            this.dirty_canvas = true;
        }
        
        // Cleanup - check if input still has parent before removing
        if (input.parentNode) {
            input.parentNode.removeChild(input);
        }
        this._originalTitle = null;
    }

    cancelTitleEditing() {
        if (!this._editingTitleInput || !this._editingTitleNode) return;

        const node = this._editingTitleNode;
        const input = this._editingTitleInput;
        
        // Clear references first to prevent double execution
        this._editingTitleInput = null;
        this._editingTitleNode = null;
        
        // Restore original title (no changes)
        node.title = this._originalTitle;
        
        // Cleanup - check if input still has parent before removing
        if (input.parentNode) {
            input.parentNode.removeChild(input);
        }
        this._originalTitle = null;
        
        this.dirty_canvas = true;
    }
    
    resetAspectRatio(resizeHandle) {
        if (resizeHandle.type === 'single-resize') {
            const node = resizeHandle.node;
            if (node.originalAspect) {
                if (window.app?.operationPipeline) {
                    window.app.operationPipeline.execute('node_reset', {
                        nodeIds: [node.id],
                        resetAspectRatio: true,
                        resetRotation: false,
                        values: [node.originalAspect]
                    });
                    // Ensure immediate visual feedback
                    this.dirty_canvas = true;
                } else {
                    // Fallback
                    node.aspectRatio = node.originalAspect;
                    node.size[1] = node.size[0] / node.originalAspect;
                    if (node.onResize) node.onResize();
                    this.dirty_canvas = true;
                }
                
                this.pushUndoState();
            }
        } else if (resizeHandle.type === 'multi-resize') {
            // Reset all selected nodes to their individual original aspect ratios
            const nodeIds = [];
            const originalAspects = [];
            
            for (const node of resizeHandle.nodes) {
                if (node.originalAspect) {
                    nodeIds.push(node.id);
                    originalAspects.push(node.originalAspect);
                }
            }
            
            if (nodeIds.length > 0) {
                if (window.app?.operationPipeline) {
                    window.app.operationPipeline.execute('node_reset', {
                        nodeIds: nodeIds,
                        resetAspectRatio: true,
                        resetRotation: false,
                        values: originalAspects
                    });
                    // Ensure immediate visual feedback
                    this.dirty_canvas = true;
                } else {
                    // Fallback
                    for (const node of resizeHandle.nodes) {
                        if (node.originalAspect) {
                            node.aspectRatio = node.originalAspect;
                            node.size[1] = node.size[0] / node.originalAspect;
                            if (node.onResize) node.onResize();
                        }
                    }
                    this.dirty_canvas = true;
                }
            }
            
            this.pushUndoState();
        }
    }
    
    resetRotation(rotationHandle) {
        if (rotationHandle.type === 'single-rotation') {
            if (window.app?.operationPipeline) {
                window.app.operationPipeline.execute('node_reset', {
                    nodeIds: [rotationHandle.node.id],
                    resetRotation: true,
                    resetAspectRatio: false
                });
                // Ensure immediate visual feedback
                this.dirty_canvas = true;
            } else {
                // Fallback
                rotationHandle.node.rotation = 0;
                this.dirty_canvas = true;
            }
        } else {
            const nodeIds = rotationHandle.nodes.map(n => n.id);
            const values = nodeIds.map(() => 0);
            
            if (window.app?.operationPipeline) {
                window.app.operationPipeline.execute('node_reset', {
                    nodeIds: nodeIds,
                    resetRotation: true,
                    resetAspectRatio: false,
                    values: values
                });
                // Ensure immediate visual feedback
                this.dirty_canvas = true;
            } else {
                // Fallback
                for (const node of rotationHandle.nodes) {
                    node.rotation = 0;
                }
                this.dirty_canvas = true;
            }
        }
        this.pushUndoState();
    }
    
    // ===================================
    // UNDO/REDO SYSTEM
    // ===================================
    
    setStateManager(stateManager) {
        this.stateManager = stateManager;
    }
    
    // Action management is now handled by OperationPipeline
    
    pushUndoState() {
        if (this.stateManager && typeof this.stateManager.pushUndoState === 'function') {
            this.stateManager.pushUndoState(this.graph, this);
        } else {
            console.warn('State manager not available for undo');
        }
    }
    
    undo() {
        // Use ClientUndoManager (single source of truth)
        if (window.app?.undoManager) {
            window.app.undoManager.undo();
        } else {
            console.warn('ClientUndoManager not available - undo disabled');
        }
    }
    
    redo() {
        // Use ClientUndoManager (single source of truth)
        if (window.app?.undoManager) {
            window.app.undoManager.redo();
        } else {
            console.warn('ClientUndoManager not available - redo disabled');
        }
    }
    
    // ===================================
    // DEBOUNCED OPERATIONS
    // ===================================
    
    
    // ===================================
    // RENDERING SYSTEM
    // ===================================
    
    forceRedraw() {
        this.dirty_canvas = true;
    }
    
    markNodeDirty(node) {
        // Mark a specific node as needing redraw
        if (node && node.id) {
            this.dirty_nodes.add(node.id);
            // Still mark canvas as dirty, but we'll use this info to optimize later
            this.dirty_canvas = true;
        }
    }
    
    invalidateVisibilityCache() {
        this.cachedVisibleNodes = null;
    }
    
    startPreloadLoop() {
        const processLoadingQueue = async () => {
            // Process visible nodes first (high priority)
            if (this.loadingQueue.size > 0 && this.currentLoads < this.maxConcurrentLoads) {
                const nodeId = this.loadingQueue.values().next().value;
                this.loadingQueue.delete(nodeId);
                
                const node = this.graph.getNodeById(nodeId);
                if (node && node.loadingState === 'idle') {
                    this.currentLoads++;
                    
                    try {
                        const success = await this.loadNodeFromCache(node);
                        if (success) {
                            this.dirty_canvas = true; // Trigger redraw
                        }
                    } finally {
                        this.currentLoads--;
                    }
                }
            }
            
            // Process preload queue if we have spare capacity
            else if (this.preloadQueue.size > 0 && this.currentLoads < this.maxConcurrentLoads) {
                const nodeId = this.preloadQueue.values().next().value;
                this.preloadQueue.delete(nodeId);
                
                const node = this.graph.getNodeById(nodeId);
                if (node && node.loadingState === 'idle') {
                    this.currentLoads++;
                    
                    try {
                        await this.loadNodeFromCache(node);
                        // Don't trigger redraw for preloads unless visible
                        if (this.viewport.isNodeVisible(node, CONFIG.PERFORMANCE.VISIBILITY_MARGIN)) {
                            this.dirty_canvas = true;
                        }
                    } finally {
                        this.currentLoads--;
                    }
                }
            }
            
            // Schedule next processing cycle
            setTimeout(processLoadingQueue, 16); // ~60fps processing
        };
        
        processLoadingQueue();
    }
    
    clearPreloadQueue() {
        this.preloadQueue.clear();
        // Keep visible queue since those are important
    }

    clearAllQueues() {
        this.loadingQueue.clear();
        this.preloadQueue.clear();
    }
    
    updatePerformanceStats(timestamp) {
        this.frameCounter++;
        
        if (timestamp - this.lastFrameTime >= 1000) {
            this.fps = this.frameCounter;
            this.frameCounter = 0;
            this.lastFrameTime = timestamp;
        }
    }
    
    draw() {
        if (!this.ctx) return;
        
        // Prepare WebGL frame if renderer available
        if (this.renderer && typeof this.renderer.beginFrame === 'function') {
            this.renderer.beginFrame();
        }
        
        // Start performance monitoring
        if (window.app?.performanceMonitor) {
            window.app.performanceMonitor.startFrame();
        }
        
        const startTime = performance.now();
        
        const ctx = this.ctx;
        const canvas = this.canvas;
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw background
        ctx.fillStyle = ColorUtils.get('backgrounds', 'canvas_primary');
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Apply gallery mode darkening if active
        if (this.galleryViewManager && this.galleryViewManager.active) {
            const opacity = this.galleryViewManager.getDarkeningOpacity();
            if (opacity > 0) {
                ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
        }
        
        // Draw grid (skip in gallery mode for cleaner look)
        if (!this.galleryViewManager || !this.galleryViewManager.active) {
            this.drawGrid(ctx);
        }
        
        const gridTime = performance.now();
        
        // Apply viewport transformation
        ctx.save();
        ctx.translate(this.viewport.offset[0], this.viewport.offset[1]);
        ctx.scale(this.viewport.scale, this.viewport.scale);
        
        // Check if viewport has changed (or if we haven't initialized yet)
        const viewportChanged = !this.lastViewportState ||
            this.viewport.offset[0] !== this.lastViewportState.offsetX ||
            this.viewport.offset[1] !== this.lastViewportState.offsetY ||
            this.viewport.scale !== this.lastViewportState.scale;
        
        // Get visible nodes - use cache if viewport hasn't changed AND node count hasn't changed
        let visibleNodes;
        const nodeCountChanged = this.cachedVisibleNodes && 
            this.cachedVisibleNodes.length !== this.graph.nodes.length;
            
        if (viewportChanged || !this.cachedVisibleNodes || nodeCountChanged) {
            visibleNodes = this.viewport.getVisibleNodes(
                this.graph.nodes, 
                this.getConfig('PERFORMANCE.VISIBILITY_MARGIN', 200)
            );
            
            // Update cache
            this.cachedVisibleNodes = visibleNodes;
            this.lastViewportState = {
                offsetX: this.viewport.offset[0],
                offsetY: this.viewport.offset[1],
                scale: this.viewport.scale
            };
            
            // Only update node visibility when viewport changes or nodes added/removed
            this.updateNodeVisibility(visibleNodes);
        } else {
            visibleNodes = this.cachedVisibleNodes;
        }
        
        // Always ensure selected nodes and nodes requesting GL update are rendered
        if (this.graph && this.graph.nodes) {
            const extra = [];
            // selected nodes
            for (const n of this.selection.getSelectedNodes()) extra.push(n);
            // nodes with pending GL update
            for (const n of this.graph.nodes) {
                if (n.needsGLUpdate) extra.push(n);
            }
            for (const n of extra) {
                if (!visibleNodes.includes(n)) {
                    visibleNodes.push(n);
                }
            }
        }
        
        const cullTime = performance.now();
        
        // Memory management cleanup
        if (window.memoryManager && window.memoryManager.shouldCleanup()) {
            window.memoryManager.performCleanup(visibleNodes, this.graph.nodes, this.viewport);
        }
        
        // Draw all visible nodes sorted by z-index
        // Sort visible nodes by z-index (lower z-index drawn first)
        const sortedNodes = [...visibleNodes].sort((a, b) => {
            // Get effective z-index (considering group membership)
            const aZ = this.getEffectiveZIndex(a);
            const bZ = this.getEffectiveZIndex(b);
            
            // If z-indices are the same, maintain relative order within group
            if (aZ === bZ) {
                // Groups should be drawn before their children
                if (a.type === 'container/group' && a.childNodes?.has(b.id)) return -1;
                if (b.type === 'container/group' && b.childNodes?.has(a.id)) return 1;
            }
            
            return aZ - bZ;
        });
        
        // Draw nodes in z-order
        for (const node of sortedNodes) {
            // In gallery mode, only draw the current node
            if (this.galleryViewManager && this.galleryViewManager.shouldHideNode(node)) {
                continue;
            }
            this.drawNode(ctx, node);
        }
        
        const nodesTime = performance.now();
        
        ctx.restore();
        
        // Draw UI layer (selection outlines, handles, overlays)
        const renderUI = () => {
            if (!this.uiCtx) return;
            const dpr = this.viewport.dpr;
            this.uiCtx.setTransform(1,0,0,1,0,0);
            this.uiCtx.clearRect(0,0,this.uiCanvas.width,this.uiCanvas.height);
            this.uiCtx.scale(dpr,dpr);
            this.uiCtx.translate(this.viewport.offset[0], this.viewport.offset[1]);
            this.uiCtx.scale(this.viewport.scale, this.viewport.scale);

            // Only draw selection if not in gallery view mode and not during alignment animation
            if ((!this.galleryViewManager || !this.galleryViewManager.active) &&
                (!this.alignmentManager || (!this.alignmentManager.isActive() && !this.alignmentManager.isAnimating()))) {
                const selectedNodes = this.selection.getSelectedNodes();
                for (const node of selectedNodes) {
                    // replicate transform logic from drawNode
                    let drawPos = node.pos;
                    if (node._gridAnimPos) {
                        drawPos = node._gridAnimPos;
                    } else if (node._animPos) {
                        drawPos = node._animPos;
                    }
                    this.uiCtx.save();
                    this.uiCtx.translate(drawPos[0], drawPos[1]);
                    if (node.rotation) {
                        this.uiCtx.translate(node.size[0]/2, node.size[1]/2);
                        this.uiCtx.rotate(node.rotation * Math.PI/180);
                        this.uiCtx.translate(-node.size[0]/2, -node.size[1]/2);
                    }
                    this.drawNodeSelection(this.uiCtx, node);
                    this.uiCtx.restore();
                }
            }

            // Draw node titles on UI layer
            for (const node of visibleNodes) {
                // replicate transform logic from drawNode
                let drawPos = node.pos;
                if (node._gridAnimPos) {
                    drawPos = node._gridAnimPos;
                } else if (node._animPos) {
                    drawPos = node._animPos;
                }
                this.uiCtx.save();
                this.uiCtx.translate(drawPos[0], drawPos[1]);
                if (node.rotation) {
                    this.uiCtx.translate(node.size[0]/2, node.size[1]/2);
                    this.uiCtx.rotate(node.rotation * Math.PI/180);
                    this.uiCtx.translate(-node.size[0]/2, -node.size[1]/2);
                }
                this.drawNodeTitle(this.uiCtx, node);
                this.uiCtx.restore();
            }

            // Overlays like selection rectangle or bounding box
            this.drawOverlays(this.uiCtx);
        };
        renderUI();
        
        // Draw performance stats
        this.drawStats(ctx);
        
        const uiTime = performance.now();
        
        const totalTime = uiTime - startTime;
        
        // Update performance monitor
        if (window.app?.performanceMonitor) {
            const monitor = window.app.performanceMonitor;
            monitor.mark('render', totalTime);
            monitor.mark('grid', gridTime - startTime);
            monitor.mark('cull', cullTime - gridTime);
            monitor.mark('draw', nodesTime - cullTime);
            monitor.mark('ui', uiTime - nodesTime);
            monitor.endFrame();
            
            // Draw performance HUD if enabled
            monitor.drawHUD(ctx);
        }
        
        // Performance debugging - enable with window.DEBUG_FPS = true
        if (window.DEBUG_FPS && totalTime > 8.33) {
            console.log(`🐌 Slow frame: ${totalTime.toFixed(1)}ms total (grid: ${(gridTime-startTime).toFixed(1)}ms, cull: ${(cullTime-gridTime).toFixed(1)}ms, nodes: ${(nodesTime-cullTime).toFixed(1)}ms, ui: ${(uiTime-nodesTime).toFixed(1)}ms)`);
        }
        
        // Finalize WebGL frame if renderer available
        if (this.renderer && typeof this.renderer.endFrame === 'function') {
            this.renderer.endFrame();
        }
    }
    
    drawGrid(ctx) {
        if (!this.viewport.shouldDrawGrid()) return;
        
        const gridInfo = this.viewport.getGridOffset();
        const gridColor = ColorUtils.get('canvas', 'grid_lines');
        
        // Use the original simple approach but ensure color is set
        ctx.fillStyle = gridColor;
        
        // Draw grid dots
        for (let x = gridInfo.x; x < this.canvas.width; x += gridInfo.spacing) {
            for (let y = gridInfo.y; y < this.canvas.height; y += gridInfo.spacing) {
                ctx.fillRect(x - 1, y - 1, 2, 2);
            }
        }
    }
    
    updateNodeVisibility(visibleNodes) {
        // Create a Set of visible node IDs for fast lookup
        const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
        
        // Track visibility changes
        if (!this.previousVisibleNodes) {
            this.previousVisibleNodes = new Set();
        }
        
        // Check all nodes for visibility changes
        if (this.graph && this.graph.nodes) {
            for (const node of this.graph.nodes) {
                const isNowVisible = visibleNodeIds.has(node.id);
                const wasVisible = this.previousVisibleNodes.has(node.id);
                
                // Notify nodes of visibility changes
                if (isNowVisible !== wasVisible && typeof node.onVisibilityChange === 'function') {
                    node.onVisibilityChange(isNowVisible);
                }
                
                // Queue media loading for newly visible nodes (non-blocking)
                if (isNowVisible && !wasVisible && 
                    (node.type === 'media/image' || node.type === 'media/video') && 
                    node.loadingState === 'idle' && node.properties.hash) {
                    this.queueNodeLoading(node, 'visible');
                }
            }
        }
        
        // Update the previous visible set
        this.previousVisibleNodes = visibleNodeIds;
        
        // Queue preloading for nearby nodes
        this.queueNearbyNodes();
    }
    
    queueNodeLoading(node, priority = 'normal') {
        if (this.loadingQueue.has(node.id) || this.preloadQueue.has(node.id)) {
            return; // Already queued
        }
        
        if (priority === 'visible') {
            // High priority: visible nodes go to front of loading queue
            this.loadingQueue.add(node.id);
        } else {
            // Lower priority: nearby nodes go to preload queue
            this.preloadQueue.add(node.id);
        }
    }
    
    queueNearbyNodes() {
        // Only queue a few nearby nodes to avoid excessive preloading
        const viewport = this.viewport.getViewport();
        const expandedMargin = CONFIG.PERFORMANCE.VISIBILITY_MARGIN * 2;
        
        let nearbyCount = 0;
        const maxNearby = 10; // Limit preloading
        
        for (const node of this.graph.nodes) {
            if (nearbyCount >= maxNearby) break;
            
            if ((node.type === 'media/image' || node.type === 'media/video') && 
                node.loadingState === 'idle' && node.properties.hash &&
                !this.loadingQueue.has(node.id) && !this.preloadQueue.has(node.id)) {
                
                // Check if nearby (but not visible)
                if (this.viewport.isNodeVisible(node, expandedMargin) && 
                    !this.viewport.isNodeVisible(node, CONFIG.PERFORMANCE.VISIBILITY_MARGIN)) {
                    this.queueNodeLoading(node, 'preload');
                    nearbyCount++;
                }
            }
        }
    }
    
    async loadNodeFromCache(node) {
        if (!window.imageCache) return false;
        
        const cached = window.imageCache.get(node.properties.hash);
        if (cached) {
            try {
                if (node.type === 'media/video' && node.setVideo) {
                    await node.setVideo(cached, node.properties.filename, node.properties.hash);
                } else if (node.setImage) {
                    await node.setImage(cached, node.properties.filename, node.properties.hash);
                }
                return true;
            } catch (error) {
                console.warn('Failed to load cached media:', error);
                return false;
            }
        }
        return false;
    }
    
    drawNode(ctx, node) {
        // Renderer abstraction hook – delegate if custom renderer handles this node
        if (this.renderer && typeof this.renderer.drawNode === 'function') {
            const handled = this.renderer.drawNode(ctx, node);
            if (handled === true) {
                return; // Skip default drawing path when renderer finished
            }
        }
        
        ctx.save();
        
        // Apply gallery mode opacity during transitions
        if (this.galleryViewManager && this.galleryViewManager.active) {
            const opacity = this.galleryViewManager.getNodeOpacity(node);
            if (opacity < 1) {
                ctx.globalAlpha = opacity;
            }
        }
        
        // Update brightness animation
        if (node.updateBrightness && node.updateBrightness()) {
            this.dirty_canvas = true; // Keep animating
        }
        
        // Update group expansion animation - only check if registered as animating
        if (node.type === 'container/group' && this._animatingGroups.has(node.id)) {
            const stillAnimating = node.updateAnimation();
            if (stillAnimating) {
                this.dirty_canvas = true; // Keep animating
            } else {
                // Animation finished, remove from set
                this._animatingGroups.delete(node.id);
            }
        }
        
        // Apply brightness effect
        if (node.brightness && node.brightness !== 1.0) {
            ctx.filter = `brightness(${node.brightness})`;
        }
        
        // Use animated position if available (priority order)
        let drawPos = node.pos;
        if (node._gridAnimPos) {
            drawPos = node._gridAnimPos;  // Grid-align animation
        } else if (node._animPos) {
            drawPos = node._animPos;      // Auto-align animation
        }
        
        ctx.translate(drawPos[0], drawPos[1]);
        
        // Use animated size for groups if available
        let drawSize = node.size;
        if (node.type === 'container/group') {
            if (node._gridAnimSize) {
                drawSize = node._gridAnimSize;
            } else if (node._animSize) {
                drawSize = node._animSize;
            }
            // Temporarily update node size for rendering
            if (drawSize !== node.size) {
                node._originalSize = node.size;
                node.size = drawSize;
            }
        }
        
        // Apply rotation
        if (node.rotation) {
            ctx.translate(node.size[0] / 2, node.size[1] / 2);
            ctx.rotate(node.rotation * Math.PI / 180);
            ctx.translate(-node.size[0] / 2, -node.size[1] / 2);
        }
        
        // Draw node content
        if (node.onDrawForeground) {
            // For group nodes, pass viewport for calculations
            if (node.type === 'container/group' && node.getScreenSpaceTitleBarHeightForViewport) {
                const screenSpaceTitleBarHeight = node.getScreenSpaceTitleBarHeightForViewport(this.viewport);
                const screenSpaceLineWidth = node.style.borderWidth / this.viewport.scale;
                const screenSpaceFontSize = 12 / this.viewport.scale; // 12px target font size
                // Pass viewport as additional parameter
                node.onDrawForeground(ctx, screenSpaceTitleBarHeight, screenSpaceLineWidth, screenSpaceFontSize, this.viewport);
            } else {
                node.onDrawForeground(ctx);
            }
        }
        
        // Draw title above the node (before selection, in node's coordinate space)
        if (!node.flags?.hide_title) {
            const displayTitle = node.getDisplayTitle();
            if (displayTitle) {
                this.drawNodeTitle(ctx, node);
            }
        }
        
        // Draw selection and handles (hide during alignment and gallery mode)
        if (this.selection.isSelected(node) && 
            (!this.alignmentManager || (!this.alignmentManager.isActive() && !this.alignmentManager.isAnimating())) &&
            (!this.galleryViewManager || this.galleryViewManager.shouldRenderSelectionUI())) {
            this.drawNodeSelection(ctx, node);
        }
        
        ctx.restore();
        
        // Restore original size if it was temporarily changed for groups
        if (node.type === 'container/group' && node._originalSize) {
            node.size = node._originalSize;
            delete node._originalSize;
        }
    }
    
    drawNodeSelection(ctx, node) {
        // Selection border
        ctx.lineWidth = 2 / this.viewport.scale;
        ctx.strokeStyle = ColorUtils.get('canvas', 'selection_stroke');
        ctx.strokeRect(0, 0, node.size[0], node.size[1]);
        
        // Draw handles if node is large enough and not during alignment animations
        const shouldDrawHandles = this.handleDetector.shouldShowHandles(node) && 
                                 (!this.alignmentManager || !this.alignmentManager.isAnimating());
        
        if (shouldDrawHandles) {
            this.drawNodeHandles(ctx, node);
        }
    }
    
    drawNodeHandles(ctx, node) {
        const handleSize = this.getConfig('HANDLES.SIZE', 12) / this.viewport.scale;
        
        // Resize handle
        ctx.save();
        ctx.lineWidth = 3 / this.viewport.scale;
        ctx.strokeStyle = ColorUtils.get('canvas', 'handle_fill');
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 2 / this.viewport.scale;
        
        ctx.beginPath();
        ctx.moveTo(node.size[0] - handleSize, node.size[1]);
        ctx.lineTo(node.size[0], node.size[1]);
        ctx.moveTo(node.size[0], node.size[1] - handleSize);
        ctx.lineTo(node.size[0], node.size[1]);
        ctx.stroke();
        ctx.restore();
        
        // Rotation handle (drawn in screen space) - skip for group nodes
        if (node.type !== 'container/group') {
            this.drawRotationHandle(ctx, node);
        }
    }
    
    drawRotationHandle(ctx, node) {
        if (!this.handleDetector.getRotatedCorner) return;
        
        const [screenX, screenY] = this.handleDetector.getRotatedCorner(node, 'br');
        
        // Use animated position if available, otherwise use actual position
        let drawPos = node.pos;
        if (node._gridAnimPos) {
            drawPos = node._gridAnimPos;  // Grid-align animation
        } else if (node._animPos) {
            drawPos = node._animPos;      // Auto-align animation
        }
        
        const centerX = drawPos[0] + node.size[0] / 2;
        const centerY = drawPos[1] + node.size[1] / 2;
        const [centerScreenX, centerScreenY] = this.viewport.convertGraphToOffset(centerX, centerY);
        
        const dx = screenX - centerScreenX;
        const dy = screenY - centerScreenY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist === 0) return;
        
        const nx = dx / dist;
        const ny = dy / dist;
        
        const handleDist = 12;
        const hx = screenX + nx * handleDist;
        const hy = screenY + ny * handleDist;
        
        ctx.save();
        ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, 2 * Math.PI);
        ctx.fillStyle = ColorUtils.get('canvas', 'selection_fill');
        ctx.globalAlpha = 0.5;
        ctx.fill();
        ctx.restore();
    }
    
    drawNodeTitle(ctx, node) {
        // Skip if hidden by node flag
        if (node.flags?.hide_title) {
            return;
        }
        
        // Skip if hidden by user preference
        const showTitles = window.app?.userProfileSystem?.getPreference('showTitles', true);
        if (!showTitles) {
            return;
        }
        
        // Get display title (with fallback)
        const displayTitle = node.getDisplayTitle();
        if (!displayTitle) {
            return;
        }
        
        // Calculate screen scale for consistent sizing
        const screenScale = this.viewport.scale;
        
        // Only show title if node is large enough on screen
        const minScreenSize = 40; // pixels
        const nodeScreenWidth = node.size[0] * screenScale;
        const nodeScreenHeight = node.size[1] * screenScale;
        
        if (nodeScreenWidth < minScreenSize || nodeScreenHeight < minScreenSize) {
            return; // Node too small, don't show title
        }
        
        ctx.save();
        
        // Move to title position (above the node, in node's coordinate space)
        const titlePadding = 8 / screenScale; // Scale padding to maintain consistent appearance
        ctx.translate(0, -titlePadding);
        
        // Set font size that scales with zoom but has reasonable limits
        const baseFontSize = 14;
        const fontSize = baseFontSize / screenScale;
        ctx.font = `${fontSize}px ${FONT_CONFIG.APP_FONT_CANVAS}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        
        // Calculate max width based on node width
        const maxWidth = node.size[0] - (8 / screenScale);
        
        // Truncate text if too long
        let truncatedTitle = displayTitle;
        const textMetrics = ctx.measureText(truncatedTitle);
        if (textMetrics.width > maxWidth) {
            // Truncate with ellipsis
            while (truncatedTitle.length > 0 && ctx.measureText(truncatedTitle + '...').width > maxWidth) {
                truncatedTitle = truncatedTitle.slice(0, -1);
            }
            truncatedTitle += '...';
        }
        
        
        // Draw text with shadow for better visibility
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 2 / screenScale;
        ctx.shadowOffsetX = 1 / screenScale;
        ctx.shadowOffsetY = 1 / screenScale;
        
        ctx.fillStyle = '#ffffff';
        ctx.fillText(truncatedTitle, 4 / screenScale, 0);
        
        ctx.restore();
    }
    
    drawOverlays(ctx) {
        // Skip all overlays in gallery mode
        if (this.galleryViewManager && !this.galleryViewManager.shouldRenderSelectionUI()) {
            return;
        }
        
        // Draw selection rectangle
        if (this.interactionState.selecting.active) {
            this.drawSelectionRectangle(ctx);
        }
        
        // Draw multi-selection bounding box (hide during alignment)
        if (this.selection.size() > 1 && 
            (!this.alignmentManager || (!this.alignmentManager.isActive() && !this.alignmentManager.isAnimating()))) {
            this.drawSelectionBoundingBox(ctx);
        }
        
        // Draw alignment overlays
        if (this.alignmentManager) {
            this.alignmentManager.drawOverlays(ctx);
        }
    }
    
    drawSelectionRectangle(ctx) {
        const rect = this.selection.getSelectionRect();
        if (!rect) return;
        
        ctx.save();
        ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
        
        // Convert to screen coordinates
        const [sx, sy] = this.viewport.convertGraphToOffset(rect[0], rect[1]);
        const [ex, ey] = this.viewport.convertGraphToOffset(rect[0] + rect[2], rect[1] + rect[3]);
        
        const screenRect = [sx, sy, ex - sx, ey - sy];
        
        ctx.strokeStyle = ColorUtils.get('canvas', 'selection_stroke');
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.globalAlpha = 0.5;
        ctx.strokeRect(...screenRect);
        
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = ColorUtils.get('canvas', 'selection_fill');
        ctx.fillRect(...screenRect);
        ctx.restore();
    }
    
    drawSelectionBoundingBox(ctx) {
        const bbox = this.selection.getBoundingBox();
        if (!bbox) return;
        
        const [minX, minY, width, height] = bbox;
        const [sx, sy] = this.viewport.convertGraphToOffset(minX, minY);
        const sw = width * this.viewport.scale;
        const sh = height * this.viewport.scale;
        
        const margin = 8;
        
        ctx.save();
        ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
        
        // Transparent background
        ctx.globalAlpha = 0.0;
        ctx.fillStyle = ColorUtils.get('canvas', 'selection_fill');
        ctx.fillRect(sx - margin, sy - margin, sw + margin * 2, sh + margin * 2);
        
        // Border
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = ColorUtils.get('canvas', 'selection_stroke');
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(sx - margin, sy - margin, sw + margin * 2, sh + margin * 2);
        
        // Resize handle
        this.drawMultiResizeHandle(ctx, sx, sy, sw, sh, margin);
        
        // Rotation handle
        this.drawMultiRotationHandle(ctx, sx, sy, sw, sh, margin);
        
        ctx.restore();
    }
    
    drawMultiResizeHandle(ctx, sx, sy, sw, sh, margin) {
        const handleSize = 16;
        const brX = sx + sw + margin;
        const brY = sy + sh + margin;
        
        ctx.setLineDash([]);
        ctx.strokeStyle = ColorUtils.get('canvas', 'handle_fill');
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 2;
        
        ctx.beginPath();
        ctx.moveTo(brX - handleSize, brY - 2);
        ctx.lineTo(brX - 2, brY - 2);
        ctx.moveTo(brX - 2, brY - handleSize);
        ctx.lineTo(brX - 2, brY - 2);
        ctx.stroke();
    }
    
    drawMultiRotationHandle(ctx, sx, sy, sw, sh, margin) {
        const offset = 16;
        const brX = sx + sw + margin;
        const brY = sy + sh + margin;
        const hx = brX + offset;
        const hy = brY + offset;
        
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, 2 * Math.PI);
        ctx.fillStyle = ColorUtils.get('canvas', 'selection_fill');
        ctx.globalAlpha = 0.5;
        ctx.fill();
    }
    
    drawStats(ctx) {
        ctx.save();
        ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
        
        // Position in lower left
        const statsHeight = this.fpsTestMode !== 'normal' ? 100 : 80;
        const statsWidth = 160;
        const margin = 10;
        const yPos = (this.canvas.height / this.viewport.dpr) - statsHeight - margin;
        
        // Set 50% opacity for entire HUD
        ctx.globalAlpha = 0.5;
        
        // Background
        ctx.fillStyle = 'rgba(34, 34, 34, 0.8)';
        ctx.fillRect(margin, yPos, statsWidth, statsHeight);
        
        // Stats text
        ctx.font = `12px ${FONT_CONFIG.MONO_FONT_CANVAS}`;
        ctx.fillStyle = '#fff';
        
        // Get memory usage - prefer real browser memory over estimates
        let memoryDisplay = 'N/A';
        if (performance.memory) {
            const usedMB = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
            const limitMB = Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024);
            const percent = Math.round((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100);
            memoryDisplay = `${usedMB}MB (${percent}%)`;
        } else if (window.memoryManager) {
            const memoryStats = window.memoryManager.getMemoryStats();
            memoryDisplay = memoryStats ? memoryStats.formatted : 'N/A';
        }
        
        const stats = [
            `FPS: ${this.fps}`,
            `Nodes: ${this.graph.nodes.length}`,
            `Selected: ${this.selection.size()}`,
            `Scale: ${(this.viewport.scale * 100).toFixed(0)}%`,
            `Memory: ${memoryDisplay}`
        ];
        
        // Add test mode indicator if active
        if (this.fpsTestMode !== 'normal') {
            stats.push(`TEST: ${this.fpsTestMode}`);
            
            // Add frame time stats if available
            const frameStats = this.getFrameTimeStats();
            if (frameStats && frameStats.samples > 10) {
                ctx.fillStyle = '#ff0';  // Yellow for test stats
            }
        }
        
        stats.forEach((stat, i) => {
            // Color memory stat based on usage level
            if (stat.startsWith('Memory:') && performance.memory) {
                const percent = Math.round((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100);
                if (percent >= 95) ctx.fillStyle = '#f44336'; // Red
                else if (percent >= 75) ctx.fillStyle = '#ff9800'; // Orange
                else ctx.fillStyle = '#4caf50'; // Green
            } else if (stat.startsWith('Memory:') && window.memoryManager) {
                const memoryStats = window.memoryManager.getMemoryStats();
                ctx.fillStyle = memoryStats ? memoryStats.color : '#fff';
            } else {
                ctx.fillStyle = '#fff';
            }
            ctx.fillText(stat, margin + 5, yPos + 15 + i * 14);
        });
        
        ctx.restore();
    }
    
    // ===================================
    // UTILITY METHODS
    // ===================================
    
    getUniqueCachedAssetsOnCanvas() {
        // Count unique hashes of image/video nodes on the canvas that are cached
        const uniqueHashes = new Set();
        
        for (const node of this.graph.nodes) {
            if ((node.type === 'media/image' || node.type === 'media/video') && node.properties?.hash) {
                // Only count if the asset is actually cached
                if (window.app?.imageResourceCache?.has(node.properties.hash)) {
                    uniqueHashes.add(node.properties.hash);
                }
            }
        }
        
        return uniqueHashes.size;
    }
    
    getConfig(path, defaultValue) {
        return window.CONFIG?.[path] || defaultValue;
    }
    
    // ===================================
    // CLEANUP
    // ===================================
    
    cleanup() {
        // Stop render loop
        if (this.animationSystem) {
            this.animationSystem.stop();
        }
        
        // Remove event listeners
        this.canvas.removeEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.removeEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.removeEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.removeEventListener('wheel', this.onMouseWheel.bind(this));
        this.canvas.removeEventListener('contextmenu', e => e.preventDefault());
        this.canvas.removeEventListener('dblclick', this.onDoubleClick.bind(this));
        
        document.removeEventListener('keydown', this.onKeyDown.bind(this));
        document.removeEventListener('keyup', this.onKeyUp.bind(this));
        
        if (this.debouncedResize) {
            window.removeEventListener('resize', this.debouncedResize);
        }
        
        if (this.selection) {
            this.selection.removeCallback(this.onSelectionChanged.bind(this));
        }
        
        // Clear references
        this.graph = null;
        this.viewport = null;
        this.selection = null;
        this.handleDetector = null;
        this.animationSystem = null;
        this.alignmentManager = null;
        
        console.log('ImageCanvas cleaned up');
    }
    
    // ===================================
    // DEBUG AND UTILITIES
    // ===================================
    
    getDebugInfo() {
        return {
            fps: this.fps,
            nodes: this.graph?.nodes?.length || 0,
            selected: this.selection?.size() || 0,
            viewport: this.viewport?.getDebugInfo(),
            interaction: this.interactionState,
            mouse: this.mouseState,
            loadingQueue: this.loadingQueue.size,
            preloadQueue: this.preloadQueue.size,
            concurrentLoads: this.currentLoads
        };
    }
    
    // ===================================
    // COLLABORATIVE OPERATIONS
    // ===================================
    
    broadcastNodeMove() {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // Operations are sent through the pipeline when nodes are moved
    }
    
    broadcastNodeResize() {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // Operations are sent through the pipeline when nodes are resized
    }
    
    broadcastNodeDelete(nodeIds) {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // Operations are sent through the pipeline when nodes are deleted
    }
    
    broadcastNodeCreate(node) {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // The pipeline handles node creation when nodes are added to the graph
    }
    
    broadcastNodeReset(nodeIds, resetType, values) {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // Reset operations are sent through the pipeline
    }
    
    broadcastVideoToggle(nodeId, playing) {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // Video toggle operations are sent through the pipeline
    }
    
    // Removed broadcastAlignment - alignment now uses node_move operations
    
    broadcastNodePropertyUpdate(nodeIds, propertyName, values) {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // Property updates are sent through the pipeline
    }
    
    broadcastLayerOrderChange(nodes, direction) {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // Layer order changes are sent through the pipeline
    }
    
    // ===================================
    // NAVIGATION METHODS
    // ===================================
    
    findNodeClosestToViewportCenter() {
        if (!this.viewport || !this.viewport.convertCanvasToGraph) {
            console.warn('Viewport not properly initialized for findNodeClosestToViewportCenter');
            return null;
        }
        
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        const graphCenter = this.viewport.convertCanvasToGraph(centerX, centerY);
        
        if (!graphCenter || !this.graph || !this.graph.nodes) {
            return null;
        }
        
        let closestNode = null;
        let minDistance = Infinity;
        
        for (const node of this.graph.nodes) {
            if (!node.pos || !node.size) continue;
            
            // Skip group nodes
            if (node.type === 'container/group') continue;
            
            const nodeCenterX = node.pos[0] + node.size[0] / 2;
            const nodeCenterY = node.pos[1] + node.size[1] / 2;
            const distance = Math.sqrt(
                Math.pow(nodeCenterX - graphCenter[0], 2) +
                Math.pow(nodeCenterY - graphCenter[1], 2)
            );
            
            if (distance < minDistance) {
                minDistance = distance;
                closestNode = node;
            }
        }
        
        return closestNode;
    }
    
    findNodeInDirection(fromNode, direction) {
        let bestCandidate = null;
        let minScore = Infinity;
        
        const fromCenter = [
            fromNode.pos[0] + fromNode.size[0] / 2,
            fromNode.pos[1] + fromNode.size[1] / 2
        ];
        
        for (const targetNode of this.graph.nodes) {
            if (targetNode.id === fromNode.id) continue;
            
            // Skip group nodes
            if (targetNode.type === 'container/group') continue;
            
            const targetCenter = [
                targetNode.pos[0] + targetNode.size[0] / 2,
                targetNode.pos[1] + targetNode.size[1] / 2
            ];
            
            const dx = targetCenter[0] - fromCenter[0];
            const dy = targetCenter[1] - fromCenter[1];
            
            let isCandidate = false;
            let primaryDistance = 0;
            let secondaryDistance = 0;
            
            switch (direction) {
                case 'right':
                    if (dx > 0) {
                        isCandidate = true;
                        primaryDistance = dx;
                        secondaryDistance = Math.abs(dy);
                    }
                    break;
                case 'left':
                    if (dx < 0) {
                        isCandidate = true;
                        primaryDistance = -dx;
                        secondaryDistance = Math.abs(dy);
                    }
                    break;
                case 'down':
                    if (dy > 0) {
                        isCandidate = true;
                        primaryDistance = dy;
                        secondaryDistance = Math.abs(dx);
                    }
                    break;
                case 'up':
                    if (dy < 0) {
                        isCandidate = true;
                        primaryDistance = -dy;
                        secondaryDistance = Math.abs(dx);
                    }
                    break;
            }
            
            if (isCandidate) {
                // Score prioritizes being in the correct direction and then being aligned
                const score = primaryDistance + secondaryDistance * 2;
                if (score < minScore) {
                    minScore = score;
                    bestCandidate = targetNode;
                }
            }
        }
        
        return bestCandidate;
    }
    
    navigateToNode(node) {
        if (!node) return;
        
        this.selection.clear();
        this.selection.selectNode(node, true);
        this.centerOnSelection();
    }
}

// Make ImageCanvas available globally and keep backward compatibility alias
if (typeof window !== 'undefined') {
    window.ImageCanvas = ImageCanvas;
    window.LGraphCanvas = ImageCanvas; // Temporary alias
}