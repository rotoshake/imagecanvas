/**
 * NavigationStateManager - Manages pan/zoom state persistence
 * 
 * Features:
 * - Local cache (sessionStorage) for current tab navigation state
 * - Server-side persistence for cross-session navigation state
 * - Smart fallback chain: local -> server -> fit-all-nodes
 * - Debounced auto-save to prevent excessive server calls
 */

class NavigationStateManager {
    constructor(app) {
        this.app = app;
        this.canvas = app.graphCanvas;
        this.canvasNavigator = app.canvasNavigator;
        this.debounceTimer = null;
        this.lastSavedState = null;
        this.saveDelay = 200; // 200ms debounce for better performance
        this.isRestoring = false; // Flag to prevent saving while restoring
        this.pendingRestore = null; // Track if we have a pending restore
        
    }

    /**
     * Initialize navigation state manager
     */
    initialize() {
        // Check if we're on initial page load
        const currentCanvasId = localStorage.getItem('lastCanvasId');
        if (currentCanvasId) {
            // Try to load navigation state immediately on startup
            const state = this.loadFromLocalCache();
            if (state) {
                // Apply navigation state before any renders
                this.applyNavigationState(state);
            }
        }
        
        // Hook into viewport changes
        this.setupViewportListeners();
        
        // Hook into canvas switching
        this.setupCanvasSwitchListeners();
        
        // Hook into drag end events
        this.setupDragEndListeners();
        
    }

    /**
     * Setup listeners for viewport changes (pan/zoom)
     */
    setupViewportListeners() {
        if (!this.canvas.viewport) {
            
            setTimeout(() => this.setupViewportListeners(), 500);
            return;
        }

        // Check if already hooked to prevent double-hooking
        if (this.canvas.viewport._navigationHooked) {
            return;
        }

        // Hook into existing viewport methods
        const originalZoom = this.canvas.viewport.zoom.bind(this.canvas.viewport);
        this.canvas.viewport.zoom = (...args) => {
            const result = originalZoom(...args);
            this.onViewportChange();
            return result;
        };
        
        // Mark as hooked
        this.canvas.viewport._navigationHooked = true;

        const originalPan = this.canvas.viewport.pan.bind(this.canvas.viewport);
        this.canvas.viewport.pan = (...args) => {
            const result = originalPan(...args);
            // Don't save during active dragging - wait for mouse up
            if (!this.canvas.interactionState?.dragging?.canvas) {
                this.onViewportChange();
            }
            return result;
        };

        const originalZoomToFit = this.canvas.viewport.zoomToFit.bind(this.canvas.viewport);
        this.canvas.viewport.zoomToFit = (...args) => {
            const result = originalZoomToFit(...args);
            // Don't call onViewportChange here - viewport's animateTo will handle it
            // when the animation completes (see viewport.js line 202-204)
            return result;
        };

        // Hook into animateTo method (for navigation animations)
        if (this.canvas.viewport.animateTo) {
            const originalAnimateTo = this.canvas.viewport.animateTo.bind(this.canvas.viewport);
            this.canvas.viewport.animateTo = (...args) => {
                const result = originalAnimateTo(...args);
                // Note: onViewportChange will be called when animation completes
                // via the callback we added to the animateTo method
                return result;
            };
        }

        // Also hook into canvas methods that affect viewport
        if (this.canvas.keyboardZoom) {
            const originalKeyboardZoom = this.canvas.keyboardZoom.bind(this.canvas);
            this.canvas.keyboardZoom = (...args) => {
                const result = originalKeyboardZoom(...args);
                this.onViewportChange();
                return result;
            };
        }

    }

    /**
     * Setup listeners for canvas switching
     */
    setupCanvasSwitchListeners() {
        if (!this.canvasNavigator) {
            
            return;
        }

        // Hook into canvas loading
        const originalLoadCanvas = this.canvasNavigator.loadCanvas.bind(this.canvasNavigator);
        this.canvasNavigator.loadCanvas = async (...args) => {
            // Save current navigation state before switching
            await this.saveCurrentState();
            
            const result = await originalLoadCanvas(...args);
            
            // Don't load navigation state here - wait for full state sync
            // Navigation state will be loaded after the canvas data is synced
            
            return result;
        };

        // Listen for full state sync completion to load navigation state
        if (this.app.networkLayer) {
            this.app.networkLayer.on('full_state_sync', (data) => {
                
                // Store that we're restoring
                this.pendingRestore = this.canvasNavigator?.currentCanvasId;
                
                // Load navigation state SYNCHRONOUSLY before canvas renders
                // This prevents the flash of wrong viewport
                const state = this.loadFromLocalCache() || null;
                if (state && state.canvasId === this.canvasNavigator?.currentCanvasId) {
                    this.applyNavigationState(state);
                } else {
                    // Schedule async load for server state
                    setTimeout(async () => {
                        if (this.pendingRestore === this.canvasNavigator?.currentCanvasId) {
                            await this.loadNavigationState();
                            this.pendingRestore = null;
                        }
                    }, 100);
                }
            });
        }

        // Also listen for canvas_joined in case there's no state to sync
        if (this.app.networkLayer) {
            this.app.networkLayer.on('canvas_joined', async (data) => {
                
                // Store that we might need to restore navigation
                this.pendingRestore = this.canvasNavigator?.currentCanvasId;
                
                // Wait to see if we get a full_state_sync
                setTimeout(async () => {
                    // Only restore if we haven't received a full_state_sync
                    if (this.pendingRestore === this.canvasNavigator?.currentCanvasId && 
                        this.app.graph.nodes.length === 0) {
                        await this.loadNavigationState();
                        this.pendingRestore = null;
                    }
                }, 1000);
            });
        }

    }

    /**
     * Setup listeners for drag end events
     */
    setupDragEndListeners() {
        if (!this.canvas.finishInteractions) {
            
            return;
        }

        // Hook into finishInteractions which is called on mouse up
        const originalFinishInteractions = this.canvas.finishInteractions.bind(this.canvas);
        this.canvas.finishInteractions = () => {
            const wasDraggingCanvas = this.canvas.interactionState?.dragging?.canvas;
            
            // Call original method
            const result = originalFinishInteractions();
            
            // If we were dragging the canvas, save navigation state now
            if (wasDraggingCanvas) {
                this.onViewportChange();
            }
            
            return result;
        };

    }

    /**
     * Called when viewport changes (pan/zoom)
     */
    onViewportChange() {
        // Don't save while we're restoring navigation state
        if (this.isRestoring) {
            return;
        }
        
        // Only log in debug mode
        if (window.DEBUG_NAVIGATION) {
            
            const state = this.getCurrentNavigationState();
            
        }
        
        // Save to local cache immediately
        this.saveToLocalCache();
        
        // Debounce server save
        this.debouncedServerSave();
    }

    /**
     * Get current navigation state
     */
    getCurrentNavigationState() {
        if (!this.canvas.viewport) {
            return null;
        }

        return {
            scale: this.canvas.viewport.scale,
            offset: [...this.canvas.viewport.offset], // Clone array
            timestamp: Date.now(),
            canvasId: this.canvasNavigator?.currentCanvasId || null
        };
    }

    /**
     * Apply navigation state to viewport
     */
    applyNavigationState(state) {
        if (!state || !this.canvas.viewport) {
            return false;
        }

        // Validate state
        if (!this.isValidNavigationState(state)) {
            
            return false;
        }

        // Set flag to prevent saving during restore
        this.isRestoring = true;

        // Apply state
        console.log(`🔄 Applying navigation state: scale=${state.scale}x, offset=[${state.offset[0].toFixed(1)}, ${state.offset[1].toFixed(1)}]`);
        this.canvas.viewport.scale = state.scale;
        this.canvas.viewport.offset = [...state.offset];
        this.canvas.viewport.validateState();
        
        // Clear LOD cache to force recalculation with correct scale
        if (this.canvas.renderer && this.canvas.renderer.lodCache) {
            this.canvas.renderer.lodCache.clear();
        }
        
        // Clear color correction render cache to force re-render at correct LOD
        if (this.canvas.renderer && this.canvas.renderer.colorCorrectedCache) {
            this.canvas.renderer.colorCorrectedCache.clear();
            console.log(`🧹 Cleared color correction cache on navigation state restore`);
        }
        
        // Trigger redraw
        this.canvas.dirty_canvas = true;
        this.canvas.draw();

        // Clear flag after a short delay
        setTimeout(() => {
            this.isRestoring = false;
        }, 100);
        
        return true;
    }

    /**
     * Validate navigation state
     */
    isValidNavigationState(state) {
        return (
            state &&
            typeof state.scale === 'number' &&
            Array.isArray(state.offset) &&
            state.offset.length === 2 &&
            typeof state.offset[0] === 'number' &&
            typeof state.offset[1] === 'number' &&
            state.scale > 0 &&
            state.scale <= 20 // Match client-side MAX_SCALE from config
        );
    }

    /**
     * Save current navigation state to local cache
     */
    saveToLocalCache() {
        const currentCanvasId = this.canvasNavigator?.currentCanvasId;
        if (!currentCanvasId) return;

        const state = this.getCurrentNavigationState();
        if (!state) return;

        try {
            const key = `navigation_state_${currentCanvasId}`;
            // Use localStorage instead of sessionStorage for persistence across reloads
            localStorage.setItem(key, JSON.stringify(state));
        } catch (error) {
            console.error('Failed to save to local cache:', error);
        }
    }

    /**
     * Load navigation state from local cache
     */
    loadFromLocalCache() {
        // Try currentCanvasId first, fall back to lastCanvasId for startup
        const currentCanvasId = this.canvasNavigator?.currentCanvasId || localStorage.getItem('lastCanvasId');
        if (!currentCanvasId) return null;

        try {
            const key = `navigation_state_${currentCanvasId}`;
            // Use localStorage instead of sessionStorage
            const stored = localStorage.getItem(key);
            if (!stored) return null;

            const state = JSON.parse(stored);
            if (this.isValidNavigationState(state)) {
                // Add canvasId to state for validation
                state.canvasId = currentCanvasId;
                return state;
            }
        } catch (error) {
            console.error('Failed to load from local cache:', error);
        }

        return null;
    }

    /**
     * Save navigation state to server (debounced)
     */
    debouncedServerSave() {
        // Clear existing timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        // Set new timer
        this.debounceTimer = setTimeout(() => {
            this.saveToServer();
        }, this.saveDelay);
    }

    /**
     * Save current navigation state to server
     */
    async saveToServer() {
        const currentCanvasId = this.canvasNavigator?.currentCanvasId;
        if (!currentCanvasId) return;

        const state = this.getCurrentNavigationState();
        if (!state) return;

        // Don't save if state hasn't changed
        if (this.lastSavedState && this.statesEqual(state, this.lastSavedState)) {
            return;
        }

        try {
            const response = await fetch(CONFIG.ENDPOINTS.PROJECT_CANVAS(currentCanvasId), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    navigation_state: {
                        scale: state.scale,
                        offset: state.offset,
                        timestamp: state.timestamp
                    },
                    userId: this.canvasNavigator?.userId || 1
                })
            });

            if (response.ok) {
                this.lastSavedState = { ...state };
            } else {
                console.error('Failed to save navigation state to server:', response.status);
            }
        } catch (error) {
            console.error('Error saving navigation state to server:', error);
        }
    }

    /**
     * Load navigation state from server
     */
    async loadFromServer() {
        const currentCanvasId = this.canvasNavigator?.currentCanvasId;
        if (!currentCanvasId) return null;

        try {
            const response = await fetch(CONFIG.ENDPOINTS.PROJECT_CANVAS(currentCanvasId));
            if (!response.ok) return null;

            const data = await response.json();
            const navigationState = data.navigation_state;

            if (navigationState && this.isValidNavigationState(navigationState)) {
                return navigationState;
            }
        } catch (error) {
            console.error('Error loading navigation state from server:', error);
        }

        return null;
    }

    /**
     * Smart navigation state loading with fallback chain
     */
    async loadNavigationState() {
        // Don't load if we're already restoring
        if (this.isRestoring) {
            return;
        }

        // 1. Try local cache first
        let state = this.loadFromLocalCache();
        if (state) {
            // Verify this is for the current canvas
            if (state.canvasId === this.canvasNavigator?.currentCanvasId) {
                if (this.applyNavigationState(state)) {
                    return;
                }
            }
        }

        // 2. Try server state
        state = await this.loadFromServer();
        if (state) {
            if (this.applyNavigationState(state)) {
                return;
            }
        }

        // 3. Fallback to fit-all-nodes only if we have nodes
        if (this.app.graph.nodes.length > 0) {
            this.fitAllNodes();
        }
    }

    /**
     * Save current navigation state (called before canvas switching)
     */
    async saveCurrentState() {
        // Save to local cache
        this.saveToLocalCache();

        // Save to server immediately (no debounce when switching)
        await this.saveToServer();
    }

    /**
     * Fit all nodes (fallback behavior)
     */
    fitAllNodes() {
        if (this.canvas.zoomToFitAll) {
            this.canvas.zoomToFitAll();
        } else if (this.canvas.viewport) {
            // Manual fit-all implementation
            const bbox = this.canvas.graph?.getBoundingBox();
            if (bbox) {
                this.canvas.viewport.zoomToFit(bbox);
                this.canvas.dirty_canvas = true;
                this.canvas.draw();
            }
        }
    }

    /**
     * Compare two navigation states
     */
    statesEqual(state1, state2) {
        if (!state1 || !state2) return false;
        
        return (
            Math.abs(state1.scale - state2.scale) < 0.001 &&
            Math.abs(state1.offset[0] - state2.offset[0]) < 0.1 &&
            Math.abs(state1.offset[1] - state2.offset[1]) < 0.1
        );
    }

    /**
     * Clear navigation state for current canvas
     */
    clearNavigationState() {
        const currentCanvasId = this.canvasNavigator?.currentCanvasId;
        if (!currentCanvasId) return;

        // Clear local cache
        try {
            const key = `navigation_state_${currentCanvasId}`;
            // Use localStorage
            localStorage.removeItem(key);
        } catch (error) {
            console.error('Failed to clear local navigation state:', error);
        }
    }

    /**
     * Get navigation state status for debugging
     */
    getStatus() {
        const currentCanvasId = this.canvasNavigator?.currentCanvasId;
        const localState = this.loadFromLocalCache();
        const currentState = this.getCurrentNavigationState();

        return {
            canvasId: currentCanvasId,
            hasLocalCache: !!localState,
            currentState: currentState,
            lastSaved: this.lastSavedState
        };
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.NavigationStateManager = NavigationStateManager;
}