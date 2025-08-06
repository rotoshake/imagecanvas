/**
 * OtherUsersSelectionManager - Manages and displays other users' selections
 * Shows simplified selection outlines in each user's color
 */
class OtherUsersSelectionManager {
    constructor(app) {
        this.app = app;
        this.otherUsersSelections = new Map(); // userId -> { nodes: Set<nodeId>, color: string }
        this.updateThrottles = new Map(); // userId -> timeoutId
        this.updateDelay = 100; // Debounce delay in ms
        
        this.setupNetworkListeners();
    }
    
    setupNetworkListeners() {
        if (!this.app.networkLayer) return;
        
        // Listen for selection updates from other users
        this.app.networkLayer.on('user_selection_update', (data) => {
            this.handleSelectionUpdate(data);
        });
        
        // Clean up selections when user leaves
        this.app.networkLayer.on('user_left', (user) => {
            this.removeUserSelections(user.userId);
        });
        
        // Clear all when joining a new canvas
        this.app.networkLayer.on('canvas_joined', () => {
            this.clearAllSelections();
        });
    }
    
    handleSelectionUpdate(data) {
        const { userId, selectedNodes, color } = data;
        console.log('📥 Received selection update:', { userId, selectedNodes, color });
        
        // Don't show our own selections
        if (userId === this.app.currentUser?.id) {
            console.log('  Ignoring own selection');
            return;
        }
        
        // Clear existing throttle for this user
        if (this.updateThrottles.has(userId)) {
            clearTimeout(this.updateThrottles.get(userId));
        }
        
        // Throttle updates to reduce rendering load
        const timeoutId = setTimeout(() => {
            this.updateUserSelection(userId, selectedNodes, color);
            this.updateThrottles.delete(userId);
        }, this.updateDelay);
        
        this.updateThrottles.set(userId, timeoutId);
    }
    
    updateUserSelection(userId, selectedNodeIds, color) {
        if (!selectedNodeIds || selectedNodeIds.length === 0) {
            this.otherUsersSelections.delete(userId);
        } else {
            this.otherUsersSelections.set(userId, {
                nodes: new Set(selectedNodeIds),
                color: color || '#999999'
            });
        }
        
        // Mark canvas as dirty to trigger redraw
        if (this.app.graphCanvas) {
            this.app.graphCanvas.dirty_canvas = true;
        }
    }
    
    removeUserSelections(userId) {
        this.otherUsersSelections.delete(userId);
        
        // Mark canvas as dirty to trigger redraw
        if (this.app.graphCanvas) {
            this.app.graphCanvas.dirty_canvas = true;
        }
    }
    
    clearAllSelections() {
        this.otherUsersSelections.clear();
        
        // Clear all throttles
        this.updateThrottles.forEach(timeoutId => clearTimeout(timeoutId));
        this.updateThrottles.clear();
        
        // Mark canvas as dirty to trigger redraw
        if (this.app.graphCanvas) {
            this.app.graphCanvas.dirty_canvas = true;
        }
    }
    
    /**
     * Draw other users' selections
     * Called during canvas rendering
     */
    draw(ctx) {
        if (this.otherUsersSelections.size === 0) return;
        
        ctx.save();
        
        // Get current zoom scale to adjust line width
        const scale = this.app.graphCanvas.viewport.scale;
        
        // Draw each user's selections
        this.otherUsersSelections.forEach((selectionData, userId) => {
            const { nodes: selectedNodeIds, color } = selectionData;
            
            // Set up drawing style for this user
            ctx.strokeStyle = color;
            ctx.lineWidth = 2 / scale; // Compensate for zoom to maintain constant screen width
            ctx.setLineDash([5 / scale, 5 / scale]); // Scale dash pattern too
            ctx.globalAlpha = 0.8;
            
            // Draw outline for each selected node
            selectedNodeIds.forEach(nodeId => {
                const node = this.app.graph.getNodeById(nodeId);
                if (!node) return;
                
                // Draw simple rectangle around node (in graph coordinates)
                const padding = 2 / scale; // Scale padding to maintain constant screen size
                ctx.strokeRect(
                    node.pos[0] - padding,
                    node.pos[1] - padding,
                    node.size[0] + padding * 2,
                    node.size[1] + padding * 2
                );
            });
        });
        
        ctx.restore();
    }
    
    /**
     * Broadcast our selection changes to other users
     */
    broadcastSelectionChange(selectedNodes) {
        if (!this.app.networkLayer || !this.app.networkLayer.isConnected) {
            console.log('❌ Cannot broadcast selection: network not connected');
            return;
        }
        // Get current user ID from network layer
        const currentUserId = this.app.networkLayer?.numericUserId;
        if (!currentUserId) {
            console.log('❌ Cannot broadcast selection: no current user ID');
            return;
        }
        
        const selectedNodeIds = Array.from(selectedNodes.keys());
        console.log('📤 Broadcasting selection update:', selectedNodeIds);
        
        this.app.networkLayer.emit('selection_update', {
            selectedNodes: selectedNodeIds
        });
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OtherUsersSelectionManager;
} else if (typeof window !== 'undefined') {
    window.OtherUsersSelectionManager = OtherUsersSelectionManager;
}