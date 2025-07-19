/**
 * ConnectionStateMachine - Manages connection states and transitions
 * Prevents race conditions and ensures valid state transitions
 */
class ConnectionStateMachine {
    constructor() {
        this.state = 'disconnected';
        this.pendingOperations = [];
        this.stateChangeListeners = new Set();
        
        // Define valid state transitions
        this.transitions = {
            'disconnected': ['connecting'],
            'connecting': ['connected', 'disconnected', 'error'],
            'connected': ['disconnecting', 'error'],
            'disconnecting': ['disconnected'],
            'error': ['connecting', 'disconnected']
        };
        
        // Track transition history for debugging
        this.transitionHistory = [];
        this.maxHistorySize = 50;
    }
    
    /**
     * Get current state
     */
    getState() {
        return this.state;
    }
    
    /**
     * Check if a transition to a new state is valid
     */
    canTransition(newState) {
        const validTransitions = this.transitions[this.state] || [];
        return validTransitions.includes(newState);
    }
    
    /**
     * Transition to a new state with an action
     */
    async transition(newState, action) {
        if (!this.canTransition(newState)) {
            throw new Error(`Invalid transition: ${this.state} -> ${newState}`);
        }
        
        const oldState = this.state;
        const transitionStartTime = Date.now();
        
        // Log transition attempt
        console.log(`🔄 Connection state transition: ${oldState} -> ${newState}`);
        
        // Update state optimistically
        this.state = newState;
        this.recordTransition(oldState, newState, 'started');
        
        try {
            // Execute the transition action
            if (action) {
                await action();
            }
            
            // Transition successful
            this.recordTransition(oldState, newState, 'completed', Date.now() - transitionStartTime);
            this.notifyStateChange(oldState, newState);
            
            // Process any pending operations if we're now connected
            if (newState === 'connected' && this.pendingOperations.length > 0) {
                this.processPendingOperations();
            }
            
        } catch (error) {
            // Rollback state on failure
            console.error(`❌ State transition failed: ${oldState} -> ${newState}`, error);
            this.state = oldState;
            this.recordTransition(oldState, newState, 'failed', Date.now() - transitionStartTime, error.message);
            
            // Transition to error state if appropriate
            if (this.canTransition('error')) {
                this.state = 'error';
                this.notifyStateChange(oldState, 'error');
            }
            
            throw error;
        }
    }
    
    /**
     * Record transition in history
     */
    recordTransition(fromState, toState, status, duration = 0, error = null) {
        this.transitionHistory.push({
            fromState,
            toState,
            status,
            duration,
            error,
            timestamp: Date.now()
        });
        
        // Keep history size bounded
        if (this.transitionHistory.length > this.maxHistorySize) {
            this.transitionHistory.shift();
        }
    }
    
    /**
     * Add a state change listener
     */
    onStateChange(callback) {
        this.stateChangeListeners.add(callback);
        return () => this.stateChangeListeners.delete(callback);
    }
    
    /**
     * Notify all listeners of state change
     */
    notifyStateChange(oldState, newState) {
        for (const listener of this.stateChangeListeners) {
            try {
                listener(oldState, newState);
            } catch (error) {
                console.error('State change listener error:', error);
            }
        }
    }
    
    /**
     * Queue an operation to be executed when connected
     */
    queueOperation(operation) {
        if (this.state === 'connected') {
            // Execute immediately if connected
            return operation();
        } else {
            // Queue for later execution
            return new Promise((resolve, reject) => {
                this.pendingOperations.push({ operation, resolve, reject });
            });
        }
    }
    
    /**
     * Process all pending operations
     */
    async processPendingOperations() {
        const operations = [...this.pendingOperations];
        this.pendingOperations = [];
        
        console.log(`📤 Processing ${operations.length} pending operations`);
        
        for (const { operation, resolve, reject } of operations) {
            try {
                const result = await operation();
                resolve(result);
            } catch (error) {
                reject(error);
            }
        }
    }
    
    /**
     * Clear pending operations (e.g., on disconnect)
     */
    clearPendingOperations(error = new Error('Connection lost')) {
        const operations = [...this.pendingOperations];
        this.pendingOperations = [];
        
        for (const { reject } of operations) {
            reject(error);
        }
    }
    
    /**
     * Get transition history for debugging
     */
    getTransitionHistory() {
        return [...this.transitionHistory];
    }
    
    /**
     * Get current state info
     */
    getStateInfo() {
        return {
            currentState: this.state,
            pendingOperationsCount: this.pendingOperations.length,
            validTransitions: this.transitions[this.state] || [],
            lastTransition: this.transitionHistory[this.transitionHistory.length - 1] || null
        };
    }
    
    /**
     * Reset to initial state (for testing or recovery)
     */
    reset() {
        this.state = 'disconnected';
        this.clearPendingOperations(new Error('State machine reset'));
        this.transitionHistory = [];
        this.notifyStateChange(this.state, 'disconnected');
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConnectionStateMachine;
}