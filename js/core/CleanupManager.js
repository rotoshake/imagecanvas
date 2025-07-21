/**
 * CleanupManager - Centralized cleanup for preventing memory leaks
 * 
 * Manages cleanup of:
 * - Event listeners
 * - WebSocket connections
 * - Media resources (images, videos)
 * - Cached data
 * - Timers and intervals
 */
class CleanupManager {
    constructor() {
        // Track all resources that need cleanup
        this.eventListeners = new Map(); // element -> [{event, handler, options}]
        this.timers = new Set(); // setTimeout IDs
        this.intervals = new Set(); // setInterval IDs
        this.mediaElements = new WeakSet(); // Images and Videos
        this.observers = new Set(); // MutationObservers, ResizeObservers
        this.abortControllers = new Set(); // For fetch requests
        this.cleanupCallbacks = new Set(); // Custom cleanup functions
        
        // Setup global cleanup on page unload
        this.setupGlobalCleanup();
        
        console.log('🧹 CleanupManager initialized');
    }
    
    /**
     * Register an event listener for automatic cleanup
     */
    addEventListener(element, event, handler, options) {
        if (!element || !event || !handler) return;
        
        // Add the listener
        element.addEventListener(event, handler, options);
        
        // Track for cleanup
        if (!this.eventListeners.has(element)) {
            this.eventListeners.set(element, []);
        }
        
        this.eventListeners.get(element).push({
            event,
            handler,
            options
        });
    }
    
    /**
     * Remove a specific event listener
     */
    removeEventListener(element, event, handler, options) {
        if (!element || !event || !handler) return;
        
        // Remove the listener
        element.removeEventListener(event, handler, options);
        
        // Remove from tracking
        const listeners = this.eventListeners.get(element);
        if (listeners) {
            const index = listeners.findIndex(l => 
                l.event === event && 
                l.handler === handler
            );
            
            if (index >= 0) {
                listeners.splice(index, 1);
            }
            
            // Clean up empty arrays
            if (listeners.length === 0) {
                this.eventListeners.delete(element);
            }
        }
    }
    
    /**
     * Register a timer for automatic cleanup
     */
    setTimeout(callback, delay) {
        const timerId = setTimeout(() => {
            this.timers.delete(timerId);
            callback();
        }, delay);
        
        this.timers.add(timerId);
        return timerId;
    }
    
    /**
     * Clear a timer
     */
    clearTimeout(timerId) {
        if (this.timers.has(timerId)) {
            clearTimeout(timerId);
            this.timers.delete(timerId);
        }
    }
    
    /**
     * Register an interval for automatic cleanup
     */
    setInterval(callback, delay) {
        const intervalId = setInterval(callback, delay);
        this.intervals.add(intervalId);
        return intervalId;
    }
    
    /**
     * Clear an interval
     */
    clearInterval(intervalId) {
        if (this.intervals.has(intervalId)) {
            clearInterval(intervalId);
            this.intervals.delete(intervalId);
        }
    }
    
    /**
     * Register a media element for cleanup
     */
    registerMedia(element) {
        if (element instanceof HTMLImageElement || element instanceof HTMLVideoElement) {
            this.mediaElements.add(element);
        }
    }
    
    /**
     * Register an observer for cleanup
     */
    registerObserver(observer) {
        if (observer && typeof observer.disconnect === 'function') {
            this.observers.add(observer);
        }
    }
    
    /**
     * Register an AbortController for cleanup
     */
    registerAbortController(controller) {
        if (controller instanceof AbortController) {
            this.abortControllers.add(controller);
        }
    }
    
    /**
     * Register a custom cleanup callback
     */
    registerCleanup(callback) {
        if (typeof callback === 'function') {
            this.cleanupCallbacks.add(callback);
        }
    }
    
    /**
     * Clean up all event listeners for an element
     */
    cleanupElement(element) {
        const listeners = this.eventListeners.get(element);
        if (listeners) {
            // Remove all listeners
            listeners.forEach(({ event, handler, options }) => {
                element.removeEventListener(event, handler, options);
            });
            
            // Clear tracking
            this.eventListeners.delete(element);
        }
    }
    
    /**
     * Clean up all media elements
     */
    cleanupMedia() {
        // Note: WeakSet doesn't have iteration, so we rely on GC
        // This method is here for documentation purposes
        console.log('Media elements will be garbage collected');
    }
    
    /**
     * Clean up specific component
     */
    cleanupComponent(component) {
        // Clean up any tracked resources for this component
        if (component.cleanup && typeof component.cleanup === 'function') {
            try {
                component.cleanup();
            } catch (error) {
                console.error('Error during component cleanup:', error);
            }
        }
    }
    
    /**
     * Perform full cleanup
     */
    cleanup() {
        console.log('🧹 Performing full cleanup...');
        
        // Clear all timers
        this.timers.forEach(timerId => clearTimeout(timerId));
        this.timers.clear();
        
        // Clear all intervals
        this.intervals.forEach(intervalId => clearInterval(intervalId));
        this.intervals.clear();
        
        // Remove all event listeners
        this.eventListeners.forEach((listeners, element) => {
            listeners.forEach(({ event, handler, options }) => {
                try {
                    element.removeEventListener(event, handler, options);
                } catch (error) {
                    console.warn('Failed to remove listener:', error);
                }
            });
        });
        this.eventListeners.clear();
        
        // Disconnect all observers
        this.observers.forEach(observer => {
            try {
                observer.disconnect();
            } catch (error) {
                console.warn('Failed to disconnect observer:', error);
            }
        });
        this.observers.clear();
        
        // Abort all pending requests
        this.abortControllers.forEach(controller => {
            try {
                controller.abort();
            } catch (error) {
                console.warn('Failed to abort request:', error);
            }
        });
        this.abortControllers.clear();
        
        // Run custom cleanup callbacks
        this.cleanupCallbacks.forEach(callback => {
            try {
                callback();
            } catch (error) {
                console.error('Error in cleanup callback:', error);
            }
        });
        this.cleanupCallbacks.clear();
        
        console.log('✅ Cleanup complete');
    }
    
    /**
     * Setup global cleanup on page unload
     */
    setupGlobalCleanup() {
        // Use pagehide instead of unload (unload is deprecated)
        window.addEventListener('pagehide', (event) => {
            // pagehide fires when user navigates away
            this.cleanup();
        });
        
        // Keep beforeunload for additional coverage
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
        
        // Also cleanup on visibility change (mobile)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                // Partial cleanup for hidden tabs
                this.cleanupAbortControllers();
            }
        });
    }
    
    /**
     * Cleanup only abort controllers (for background tabs)
     */
    cleanupAbortControllers() {
        this.abortControllers.forEach(controller => {
            try {
                controller.abort();
            } catch (error) {
                // Ignore
            }
        });
        this.abortControllers.clear();
    }
    
    /**
     * Get cleanup statistics
     */
    getStats() {
        return {
            eventListeners: this.eventListeners.size,
            timers: this.timers.size,
            intervals: this.intervals.size,
            observers: this.observers.size,
            abortControllers: this.abortControllers.size,
            cleanupCallbacks: this.cleanupCallbacks.size
        };
    }
}

// Create global instance
if (typeof window !== 'undefined') {
    window.cleanupManager = new CleanupManager();
    
    // Helper functions for easy access
    window.managedAddEventListener = (element, event, handler, options) => {
        window.cleanupManager.addEventListener(element, event, handler, options);
    };
    
    window.managedSetTimeout = (callback, delay) => {
        return window.cleanupManager.setTimeout(callback, delay);
    };
    
    window.managedSetInterval = (callback, delay) => {
        return window.cleanupManager.setInterval(callback, delay);
    };
}