/**
 * Base Command class for all operations
 * Implements command pattern with validation, execution, and undo
 */
class Command {
    constructor(type, params, origin = 'local') {
        this.id = this.generateId();
        this.type = type;
        this.params = params || {};
        this.origin = origin; // 'local' or 'remote'
        this.source = params.source; // For operation bundling (e.g., 'group_rotation', 'alignment')
        this.timestamp = Date.now();
        this.executed = false;
        this.undoData = null;
    }
    
    /**
     * Generate unique command ID
     */
    generateId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Validate command parameters
     * @returns {Object} { valid: boolean, error?: string }
     */
    validate() {
        return { valid: true };
    }
    
    /**
     * Execute the command
     * @param {Object} context - Execution context { app, graph, canvas }
     * @returns {Promise<Object>} Execution result
     */
    async execute(context) {
        throw new Error(`Execute not implemented for ${this.type}`);
    }

    /**
     * Prepare undo data for the command
     * @param {Object} context - Execution context { app, graph, canvas }
     */
    async prepareUndoData(context) {
        // Default implementation does nothing.
        // Subclasses should override this to capture necessary data for undo.
    }
    
    /**
     * Undo the command
     * @param {Object} context - Execution context { app, graph, canvas }
     * @returns {Promise<Object>} Undo result
     */
    async undo(context) {
        throw new Error(`Undo not implemented for ${this.type}`);
    }
    
    /**
     * Check if this command can be merged with another
     * @param {Command} other - Another command
     * @returns {boolean}
     */
    canMergeWith(other) {
        return false;
    }
    
    /**
     * Merge this command with another
     * @param {Command} other - Another command
     * @returns {Command} Merged command
     */
    mergeWith(other) {
        throw new Error('Merge not implemented');
    }
    
    /**
     * Serialize command for network transmission
     * @returns {Object}
     */
    serialize() {
        return {
            id: this.id,
            type: this.type,
            params: this.params,
            timestamp: this.timestamp,
            undoData: this.undoData,
            source: this.source
        };
    }
    
    /**
     * Create command from serialized data
     * @param {Object} data - Serialized command data
     * @param {string} origin - Command origin
     * @returns {Command}
     */
    static deserialize(data, origin = 'remote') {
        const command = new this(data.params, origin);
        command.id = data.id;
        command.timestamp = data.timestamp;
        return command;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Command;
}