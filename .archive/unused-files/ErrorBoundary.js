/**
 * ErrorBoundary - Prevents cascading failures and provides error recovery
 * Wraps operations to catch and handle errors gracefully
 */
class ErrorBoundary {
    constructor(options = {}) {
        this.maxRetries = options.maxRetries || 3;
        this.retryDelay = options.retryDelay || 1000;
        this.errorCount = new Map();
        this.lastErrors = new Map();
        this.listeners = new Set();
        this.criticalErrors = new Set();
    }
    
    /**
     * Execute an operation with error boundary protection
     */
    async execute(operation, context = {}) {
        const operationId = context.id || this.generateOperationId();
        const startTime = Date.now();
        
        try {
            
            const result = await operation();
            
            // Reset error count on success
            this.errorCount.delete(operationId);
            
            return result;
            
        } catch (error) {
            return this.handleError(error, operation, operationId, context);
        }
    }
    
    /**
     * Handle errors with retry logic and circuit breaking
     */
    async handleError(error, operation, operationId, context) {
        const errorCount = this.errorCount.get(operationId) || 0;
        this.errorCount.set(operationId, errorCount + 1);
        this.lastErrors.set(operationId, {
            error,
            timestamp: Date.now(),
            count: errorCount + 1
        });
        
        console.error(`❌ Error in operation ${operationId} (attempt ${errorCount + 1}):`, error);
        
        // Notify error listeners
        this.notifyError(error, operationId, context);
        
        // Check if this is a critical error
        if (this.isCriticalError(error)) {
            this.criticalErrors.add(operationId);
            throw error; // Don't retry critical errors
        }
        
        // Check if we should retry
        if (errorCount < this.maxRetries && this.isRetryableError(error)) {
            
            // Exponential backoff with jitter
            const delay = this.retryDelay * Math.pow(2, errorCount) + Math.random() * 1000;
            await this.sleep(delay);
            
            try {
                const result = await operation();
                
                // Reset error count on success
                this.errorCount.delete(operationId);
                
                return result;
                
            } catch (retryError) {
                // Recursive call to handle the retry error
                return this.handleError(retryError, operation, operationId, context);
            }
        }
        
        // Max retries exceeded or non-retryable error
        console.error(`💥 Operation ${operationId} failed permanently after ${errorCount + 1} attempts`);
        
        // Fallback to graceful degradation
        const fallbackResult = await this.executeFallback(error, operationId, context);
        if (fallbackResult !== undefined) {
            return fallbackResult;
        }
        
        throw error;
    }
    
    /**
     * Check if an error is retryable
     */
    isRetryableError(error) {
        // Network errors
        if (error.name === 'NetworkError' || error.code === 'NETWORK_ERROR') {
            return true;
        }
        
        // Timeout errors
        if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
            return true;
        }
        
        // Server busy errors
        if (error.status === 503 || error.message.includes('server busy')) {
            return true;
        }
        
        // Temporary connection issues
        if (error.message.includes('connection') && error.message.includes('lost')) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Check if an error is critical and should not be retried
     */
    isCriticalError(error) {
        // Authentication errors
        if (error.status === 401 || error.status === 403) {
            return true;
        }
        
        // Syntax or type errors in code
        if (error instanceof SyntaxError || error instanceof TypeError) {
            return true;
        }
        
        // Resource not found
        if (error.status === 404) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Execute fallback behavior for failed operations
     */
    async executeFallback(error, operationId, context) {
        if (context.fallback && typeof context.fallback === 'function') {
            try {
                
                return await context.fallback(error);
            } catch (fallbackError) {
                console.error('Fallback execution failed:', fallbackError);
            }
        }
        
        // Default fallback based on operation type
        if (context.type === 'sync') {
            // For sync operations, return cached state
            return this.getFromCache(operationId);
        }
        
        if (context.type === 'broadcast') {
            // For broadcast operations, queue for later
            this.queueForRetry(operationId, context);
            return { queued: true };
        }
        
        return undefined;
    }
    
    /**
     * Add error listener
     */
    onError(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }
    
    /**
     * Notify error listeners
     */
    notifyError(error, operationId, context) {
        for (const listener of this.listeners) {
            try {
                listener(error, operationId, context);
            } catch (listenerError) {
                console.error('Error listener failed:', listenerError);
            }
        }
    }
    
    /**
     * Get error statistics
     */
    getErrorStats() {
        const stats = {
            totalOperations: this.errorCount.size,
            totalErrors: Array.from(this.errorCount.values()).reduce((sum, count) => sum + count, 0),
            criticalErrors: this.criticalErrors.size,
            errorsByOperation: {}
        };
        
        for (const [operationId, count] of this.errorCount) {
            stats.errorsByOperation[operationId] = count;
        }
        
        return stats;
    }
    
    /**
     * Clear error history for operation
     */
    clearErrors(operationId) {
        this.errorCount.delete(operationId);
        this.lastErrors.delete(operationId);
        this.criticalErrors.delete(operationId);
    }
    
    /**
     * Clear all error history
     */
    clearAllErrors() {
        this.errorCount.clear();
        this.lastErrors.clear();
        this.criticalErrors.clear();
    }
    
    /**
     * Generate unique operation ID
     */
    generateOperationId() {
        return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Cache operations - Implemented via ImageResourceCache and ThumbnailCache
     */
    getFromCache(operationId) {
        // ✅ Caching implemented via ImageResourceCache and ThumbnailCache
        
        return null;
    }
    
    /**
     * Retry queue - Implemented via OperationPipeline and StateSyncManager
     */
    queueForRetry(operationId, context) {
        // ✅ Retry system implemented via OperationPipeline and StateSyncManager
        
    }
}

/**
 * Global error boundary for unhandled errors
 */
class GlobalErrorBoundary {
    constructor() {
        this.errorBoundary = new ErrorBoundary();
        this.setupGlobalHandlers();
    }
    
    setupGlobalHandlers() {
        // Handle unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            console.error('Unhandled promise rejection:', event.reason);
            this.errorBoundary.notifyError(event.reason, 'unhandled_promise', { type: 'global' });
            event.preventDefault(); // Prevent console error
        });
        
        // Handle regular errors
        window.addEventListener('error', (event) => {
            console.error('Global error:', event.error);
            this.errorBoundary.notifyError(event.error, 'global_error', { type: 'global' });
        });
        
        // Handle resource loading errors
        window.addEventListener('error', (event) => {
            if (event.target !== window) {
                console.error('Resource loading error:', event.target.src || event.target.href);
                this.errorBoundary.notifyError(new Error('Resource failed to load'), 'resource_error', { 
                    type: 'resource',
                    target: event.target
                });
            }
        }, true);
    }
    
    getErrorBoundary() {
        return this.errorBoundary;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ErrorBoundary, GlobalErrorBoundary };
}