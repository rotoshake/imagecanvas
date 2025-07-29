/**
 * TransactionManager - Manual transaction bundling
 * 
 * Provides explicit control for bundling operations into atomic transactions:
 * 1. `beginTransaction(source)`
 * 2. `commitTransaction()`
 * 3. `abortTransaction()`
 */
class TransactionManager {
    constructor(undoManager) {
        this.undoManager = undoManager;
        
        // Active transaction tracking
        this.activeTransaction = null;
        
    }
    
    /**
     * Process an operation (for tracking purposes, no transaction logic)
     */
    processOperation(operation) {
        // Let undo manager track the operation
        if (this.undoManager) {
            this.undoManager.trackOperation(operation);
        }
    }
    
    /**
     * Start a new transaction
     */
    beginTransaction(source) {
        if (this.activeTransaction) {
            this.commitTransaction();
        }
        
        this.activeTransaction = {
            source: source,
            startTime: Date.now()
        };
        
        if (this.undoManager) {
            this.undoManager.beginTransaction(source);
        }
        
        console.log(`📝 Manual transaction started: ${source}`);
    }
    
    /**
     * Commit active transaction
     */
    commitTransaction() {
        if (!this.activeTransaction) return;
        
        const duration = Date.now() - this.activeTransaction.startTime;
        console.log(`✅ Manual transaction committed: ${this.activeTransaction.source} (${duration}ms)`);
        
        if (this.undoManager) {
            this.undoManager.commitTransaction();
        }
        
        this.activeTransaction = null;
    }
    
    /**
     * Abort active transaction
     */
    abortTransaction() {
        if (!this.activeTransaction) return;
        
        console.log(`❌ Transaction aborted: ${this.activeTransaction.source}`);
        
        if (this.undoManager) {
            this.undoManager.abortTransaction();
        }
        
        this.activeTransaction = null;
    }
    
    /**
     * Check if currently in a transaction
     */
    isInTransaction() {
        return !!this.activeTransaction;
    }
    
    /**
     * Get current transaction info
     */
    getCurrentTransaction() {
        if (!this.activeTransaction) return null;
        
        return {
            source: this.activeTransaction.source,
            duration: Date.now() - this.activeTransaction.startTime
        };
    }
    
    /**
     * Cleanup
     */
    destroy() {
        this.commitTransaction();
    }
}