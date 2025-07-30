/**
 * ResourceManager - Manages resource lifecycle and cleanup
 * Prevents memory leaks by tracking and cleaning up resources
 */
class ResourceManager {
    constructor() {
        this.resources = new Map();
        this.cleanupFunctions = new Set();
        this.timers = new Map();
        this.eventListeners = new Map();
        this.intervals = new Map();
    }
    
    /**
     * Register a resource with optional cleanup function
     */
    register(type, resource, cleanup) {
        if (!this.resources.has(type)) {
            this.resources.set(type, new Set());
        }
        
        this.resources.get(type).add(resource);
        
        if (cleanup) {
            this.cleanupFunctions.add(cleanup);
        }
        
        // Return unregister function
        return () => {
            this.resources.get(type).delete(resource);
            if (cleanup) {
                cleanup();
                this.cleanupFunctions.delete(cleanup);
            }
        };
    }
    
    /**
     * Register a timer
     */
    registerTimer(name, timerId, type = 'timeout') {
        this.timers.set(name, { id: timerId, type });
        
        return () => {
            const timer = this.timers.get(name);
            if (timer) {
                if (timer.type === 'timeout') {
                    clearTimeout(timer.id);
                } else if (timer.type === 'interval') {
                    clearInterval(timer.id);
                }
                this.timers.delete(name);
            }
        };
    }
    
    /**
     * Register an interval (convenience method)
     */
    registerInterval(name, intervalId) {
        return this.registerTimer(name, intervalId, 'interval');
    }
    
    /**
     * Register an event listener
     */
    registerEventListener(element, event, handler, options) {
        const key = `${element.id || 'unknown'}_${event}`;
        
        if (!this.eventListeners.has(key)) {
            this.eventListeners.set(key, new Set());
        }
        
        const listenerInfo = { element, event, handler, options };
        this.eventListeners.get(key).add(listenerInfo);
        
        // Add the event listener
        element.addEventListener(event, handler, options);
        
        // Return cleanup function
        return () => {
            element.removeEventListener(event, handler, options);
            this.eventListeners.get(key).delete(listenerInfo);
            if (this.eventListeners.get(key).size === 0) {
                this.eventListeners.delete(key);
            }
        };
    }
    
    /**
     * Clear all timers
     */
    clearAllTimers() {
        for (const [name, timer] of this.timers) {
            if (timer.type === 'timeout') {
                clearTimeout(timer.id);
            } else if (timer.type === 'interval') {
                clearInterval(timer.id);
            }
            
        }
        this.timers.clear();
    }
    
    /**
     * Clear all event listeners
     */
    clearAllEventListeners() {
        for (const [key, listeners] of this.eventListeners) {
            for (const { element, event, handler, options } of listeners) {
                element.removeEventListener(event, handler, options);
            }
            
        }
        this.eventListeners.clear();
    }
    
    /**
     * Clean up specific resource type
     */
    cleanupType(type) {
        const resources = this.resources.get(type);
        if (resources) {
            
            resources.clear();
        }
    }
    
    /**
     * Execute all cleanup functions
     */
    executeCleanups() {
        
        for (const cleanup of this.cleanupFunctions) {
            try {
                cleanup();
            } catch (error) {
                console.error('Cleanup error:', error);
            }
        }
        
        this.cleanupFunctions.clear();
    }
    
    /**
     * Clean up all resources
     */
    cleanupAll() {
        
        // Clear all timers first
        this.clearAllTimers();
        
        // Clear all event listeners
        this.clearAllEventListeners();
        
        // Execute all cleanup functions
        this.executeCleanups();
        
        // Clear all resource collections
        this.resources.clear();

    }
    
    /**
     * Get resource statistics
     */
    getStats() {
        const stats = {
            resources: {},
            timers: this.timers.size,
            eventListeners: this.eventListeners.size,
            cleanupFunctions: this.cleanupFunctions.size,
            totalResources: 0
        };
        
        for (const [type, resources] of this.resources) {
            stats.resources[type] = resources.size;
            stats.totalResources += resources.size;
        }
        
        return stats;
    }
    
    /**
     * Log current resource usage
     */
    logResourceUsage() {
        const stats = this.getStats();
        
        if (stats.timers > 0) {
            
            for (const [name, timer] of this.timers) {
                console.log(`     - ${name} (${timer.type})`);
            }
        }
        
        if (stats.eventListeners > 0) {
            
        }
        
        for (const [type, count] of Object.entries(stats.resources)) {
            if (count > 0) {
                
            }
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ResourceManager;
}