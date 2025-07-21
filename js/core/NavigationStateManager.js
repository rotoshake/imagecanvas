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
        this.saveDelay = 300; // 300ms debounce
        
        console.log('📍 NavigationStateManager initialized');
    }

    /**
     * Initialize navigation state manager
     */
    initialize() {
        // Hook into viewport changes
        this.setupViewportListeners();
        
        // Hook into canvas switching
        this.setupCanvasSwitchListeners();
        
        console.log('📍 Navigation state manager ready');
    }

    /**
     * Setup listeners for viewport changes (pan/zoom)
     */
    setupViewportListeners() {
        if (!this.canvas.viewport) {
            console.warn('📍 Viewport not available yet, retrying...');
            setTimeout(() => this.setupViewportListeners(), 500);
            return;
        }

        // Hook into existing viewport methods
        const originalZoom = this.canvas.viewport.zoom.bind(this.canvas.viewport);
        this.canvas.viewport.zoom = (...args) => {
            const result = originalZoom(...args);
            this.onViewportChange();
            return result;
        };

        const originalPan = this.canvas.viewport.pan.bind(this.canvas.viewport);
        this.canvas.viewport.pan = (...args) => {
            const result = originalPan(...args);
            this.onViewportChange();
            return result;
        };

        const originalZoomToFit = this.canvas.viewport.zoomToFit.bind(this.canvas.viewport);
        this.canvas.viewport.zoomToFit = (...args) => {
            const result = originalZoomToFit(...args);
            this.onViewportChange();
            return result;
        };

        // Also hook into canvas methods that affect viewport
        if (this.canvas.keyboardZoom) {
            const originalKeyboardZoom = this.canvas.keyboardZoom.bind(this.canvas);
            this.canvas.keyboardZoom = (...args) => {
                const result = originalKeyboardZoom(...args);
                this.onViewportChange();
                return result;
            };
        }

        console.log('📍 Viewport listeners established');
    }

    /**
     * Setup listeners for canvas switching
     */
    setupCanvasSwitchListeners() {
        if (!this.canvasNavigator) {
            console.warn('📍 Canvas navigator not available');
            return;
        }

        // Hook into canvas loading
        const originalLoadCanvas = this.canvasNavigator.loadCanvas.bind(this.canvasNavigator);
        this.canvasNavigator.loadCanvas = async (...args) => {
            // Save current navigation state before switching
            await this.saveCurrentState();
            
            const result = await originalLoadCanvas(...args);
            
            // Load navigation state for new canvas
            await this.loadNavigationState();
            
            return result;
        };

        console.log('📍 Canvas switching listeners established');
    }

    /**
     * Called when viewport changes (pan/zoom)
     */
    onViewportChange() {
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
            console.warn('📍 Invalid navigation state, ignoring:', state);
            return false;
        }

        // Apply state
        this.canvas.viewport.scale = state.scale;
        this.canvas.viewport.offset = [...state.offset];
        this.canvas.viewport.validateState();
        
        // Trigger redraw
        this.canvas.dirty_canvas = true;
        this.canvas.draw();

        console.log('📍 Applied navigation state:', state);
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
            state.scale <= 10 // Reasonable bounds
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
            sessionStorage.setItem(key, JSON.stringify(state));
            console.log('📍 Saved to local cache:', key);
        } catch (error) {
            console.error('📍 Failed to save to local cache:', error);
        }
    }

    /**
     * Load navigation state from local cache
     */
    loadFromLocalCache() {
        const currentCanvasId = this.canvasNavigator?.currentCanvasId;
        if (!currentCanvasId) return null;

        try {
            const key = `navigation_state_${currentCanvasId}`;
            const stored = sessionStorage.getItem(key);
            if (!stored) return null;

            const state = JSON.parse(stored);
            if (this.isValidNavigationState(state)) {
                console.log('📍 Loaded from local cache:', key);
                return state;
            }
        } catch (error) {
            console.error('📍 Failed to load from local cache:', error);
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
                console.log('📍 Navigation state saved to server');
            } else {
                console.error('📍 Failed to save navigation state to server:', response.status);
            }
        } catch (error) {
            console.error('📍 Error saving navigation state to server:', error);
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
                console.log('📍 Loaded navigation state from server');
                return navigationState;
            }
        } catch (error) {
            console.error('📍 Error loading navigation state from server:', error);
        }

        return null;
    }

    /**
     * Smart navigation state loading with fallback chain
     */
    async loadNavigationState() {
        console.log('📍 Loading navigation state...');

        // 1. Try local cache first
        let state = this.loadFromLocalCache();
        if (state) {
            if (this.applyNavigationState(state)) {
                console.log('📍 Used local cache navigation state');
                return;
            }
        }

        // 2. Try server state
        state = await this.loadFromServer();
        if (state) {
            if (this.applyNavigationState(state)) {
                console.log('📍 Used server navigation state');
                return;
            }
        }

        // 3. Fallback to fit-all-nodes
        console.log('📍 No navigation state found, using fit-all fallback');
        this.fitAllNodes();
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
        console.log('📍 Applied fit-all-nodes fallback');
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
            sessionStorage.removeItem(key);
            console.log('📍 Cleared local navigation state');
        } catch (error) {
            console.error('📍 Failed to clear local navigation state:', error);
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
        console.log('📍 NavigationStateManager destroyed');
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.NavigationStateManager = NavigationStateManager;
}