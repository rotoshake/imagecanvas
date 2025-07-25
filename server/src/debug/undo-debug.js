/**
 * Debug utilities for the undo system
 */
class UndoDebugger {
    constructor(db, operationHistory) {
        this.db = db;
        this.operationHistory = operationHistory;
    }
    
    /**
     * Get comprehensive debug info for a user/project
     */
    async getDebugInfo(userId, projectId) {
        const info = {
            timestamp: new Date().toISOString(),
            userId,
            projectId,
            database: {},
            memory: {},
            timeline: {},
            issues: []
        };
        
        try {
            // 1. Check database state
            const dbOps = await this.db.all(
                `SELECT COUNT(*) as total, 
                        COUNT(CASE WHEN undo_data IS NOT NULL THEN 1 END) as with_undo,
                        COUNT(CASE WHEN undo_data IS NULL THEN 1 END) as without_undo
                 FROM operations 
                 WHERE project_id = ? AND user_id = ?`,
                [projectId, userId]
            );
            
            info.database = dbOps[0] || { total: 0, with_undo: 0, without_undo: 0 };
            
            if (info.database.without_undo > 0) {
                info.issues.push(`Found ${info.database.without_undo} operations without undo data`);
            }
            
            // 2. Check in-memory state
            const timeline = this.operationHistory.timeline.get(projectId) || [];
            const userOps = this.operationHistory.userOperations.get(userId) || [];
            
            info.memory = {
                timelineLength: timeline.length,
                userOperationsCount: userOps.length,
                operationsMapSize: this.operationHistory.operations.size
            };
            
            // 3. Check timeline initialization
            info.timeline = {
                isInitialized: timeline.length > 0,
                lastOperation: timeline[timeline.length - 1] || null
            };
            
            if (timeline.length === 0 && info.database.total > 0) {
                info.issues.push('Timeline not loaded from database');
            }
            
            // 4. Get current undo state
            info.undoState = this.operationHistory.getUserUndoState(userId, projectId);
            
            // 5. Check for recent operations
            const recentOps = await this.db.all(
                `SELECT id, operation_type, applied_at, 
                        CASE WHEN undo_data IS NOT NULL THEN 1 ELSE 0 END as has_undo
                 FROM operations 
                 WHERE project_id = ? AND user_id = ?
                 ORDER BY applied_at DESC
                 LIMIT 5`,
                [projectId, userId]
            );
            
            info.recentOperations = recentOps;
            
            // 6. Check user session
            const user = await this.db.get(
                `SELECT id, username, created_at FROM users WHERE id = ?`,
                [userId]
            );
            
            info.user = user;
            
            if (!user) {
                info.issues.push('User not found in database');
            }
            
        } catch (error) {
            info.error = error.message;
            info.issues.push(`Debug error: ${error.message}`);
        }
        
        return info;
    }
    
    /**
     * Force reload operation history from database
     */
    async forceReloadHistory(projectId) {
        console.log(`🔄 Force reloading history for project ${projectId}`);
        
        // Clear existing
        this.operationHistory.timeline.delete(projectId);
        
        // Reload
        await this.operationHistory.loadProjectHistory(projectId);
        
        const timeline = this.operationHistory.timeline.get(projectId) || [];
        return {
            success: true,
            operationsLoaded: timeline.length
        };
    }
    
    /**
     * Get operation details
     */
    async getOperationDetails(operationId) {
        // Check memory
        const memOp = this.operationHistory.operations.get(operationId);
        
        // Check database
        const dbOp = await this.db.get(
            `SELECT * FROM operations WHERE id = ?`,
            [operationId.replace('op_', '')]
        );
        
        return {
            inMemory: memOp || null,
            inDatabase: dbOp || null,
            mismatch: !!(memOp && !dbOp) || (!memOp && dbOp)
        };
    }
}

module.exports = UndoDebugger;