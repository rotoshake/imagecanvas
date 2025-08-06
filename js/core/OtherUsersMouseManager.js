/**
 * OtherUsersMouseManager - Manages and displays other users' mouse positions
 * Shows mouse cursors in each user's color with low refresh rate
 */
class OtherUsersMouseManager {
    constructor(app) {
        this.app = app;
        this.otherUsersMice = new Map(); // userId -> { x, y, color, username, lastUpdate }
        this.updateThrottles = new Map(); // userId -> timeoutId
        this.lastBroadcastTime = 0;
        this.idleTimeout = null;
        this.updateDelay = 50; // Throttle incoming updates to 20Hz
        this.broadcastDelay = 50; // Broadcast our position at 20Hz max
        this.mouseTimeout = 5000; // Hide mouse after 5 seconds of inactivity
        this.currentMousePosition = null; // Store current user's mouse position
        
        // Delay setup to ensure canvas is ready
        setTimeout(() => {
            this.setupEventListeners();
            this.setupNetworkListeners();
        }, 100);
        
        this.startCleanupTimer();
    }
    
    setupEventListeners() {
        // Track mouse movement on the canvas
        const canvas = this.app.graphCanvas?.canvas;
        if (!canvas) {
            console.error('❌ OtherUsersMouseManager: Canvas not found');
            return;
        }
        
        console.log('✅ OtherUsersMouseManager: Setting up mouse event listeners');
        
        canvas.addEventListener('mousemove', (e) => {
            this.handleLocalMouseMove(e);
        });
        
        canvas.addEventListener('mouseleave', () => {
            this.broadcastMouseLeave();
        });
    }
    
    setupNetworkListeners() {
        if (!this.app.networkLayer) return;
        
        // Listen for mouse position updates from other users
        this.app.networkLayer.on('user_mouse_update', (data) => {
            this.handleMouseUpdate(data);
        });
        
        // Clean up when user leaves
        this.app.networkLayer.on('user_left', (user) => {
            this.removeUserMouse(user.userId);
        });
        
        // Clear all when joining a new canvas
        this.app.networkLayer.on('canvas_joined', () => {
            this.clearAllMice();
        });
    }
    
    handleLocalMouseMove(e) {
        if (!this.app.networkLayer || !this.app.networkLayer.isConnected) {
            return;
        }
        // Get current user ID from network layer
        const currentUserId = this.app.networkLayer?.numericUserId;
        if (!currentUserId) {
            console.log('❌ Cannot broadcast mouse: no current user ID');
            return;
        }
        
        // Always calculate current position
        const rect = e.target.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;
        const graphPos = this.app.graphCanvas.viewport.convertOffsetToGraph(canvasX, canvasY);
        
        // Store latest position for both idle timeout and chat bubble positioning
        this.lastMousePosition = { x: graphPos[0], y: graphPos[1] };
        this.currentMousePosition = { x: graphPos[0], y: graphPos[1] };
        
        const now = Date.now();
        
        // If enough time has passed since last broadcast, send immediately
        if (!this.lastBroadcastTime || (now - this.lastBroadcastTime) >= this.broadcastDelay) {
            this.app.networkLayer.emit('mouse_position_update', {
                x: graphPos[0],
                y: graphPos[1]
            });
            
            this.lastBroadcastTime = now;
        }
        
        // Clear any existing idle timeout
        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
        }
        
        // Set up idle timeout to send final position
        this.idleTimeout = setTimeout(() => {
            // Send the stored final position
            if (this.lastMousePosition) {
                this.app.networkLayer.emit('mouse_position_update', this.lastMousePosition);
            }
            
            this.idleTimeout = null;
            this.lastMousePosition = null;
        }, 1000); // Send final update 1 second after stopping
    }
    
    broadcastMouseLeave() {
        if (!this.app.networkLayer || !this.app.networkLayer.isConnected) return;
        
        this.app.networkLayer.emit('mouse_leave');
    }
    
    handleMouseUpdate(data) {
        const { userId, x, y, color, username } = data;
        
        // Don't show our own mouse - compare numeric IDs
        const currentUserId = this.app.networkLayer?.numericUserId;
        // console.log('📥 Mouse update:', { userId, currentUserId, x, y, color, username });
        
        if (userId === currentUserId) {
            // console.log('   Ignoring own mouse');
            return;
        }
        
        // Clear existing throttle for this user
        if (this.updateThrottles.has(userId)) {
            clearTimeout(this.updateThrottles.get(userId));
        }
        
        // Always update immediately for smooth motion
        // The sender is already throttling, so we don't need to throttle on receive
        this.updateUserMouse(userId, x, y, color, username);
    }
    
    updateUserMouse(userId, x, y, color, username) {
        if (x === null || y === null) {
            // User left canvas area
            this.removeUserMouse(userId);
        } else {
            this.otherUsersMice.set(userId, {
                x,
                y,
                color: color || '#999999',
                username: username || 'User',
                lastUpdate: Date.now()
            });
        }
        
        // Mark canvas as dirty to trigger redraw
        if (this.app.graphCanvas) {
            this.app.graphCanvas.dirty_canvas = true;
        }
    }
    
    removeUserMouse(userId) {
        this.otherUsersMice.delete(userId);
        
        // Mark canvas as dirty to trigger redraw
        if (this.app.graphCanvas) {
            this.app.graphCanvas.dirty_canvas = true;
        }
    }
    
    clearAllMice() {
        this.otherUsersMice.clear();
        
        // Clear all throttles
        this.updateThrottles.forEach(timeoutId => clearTimeout(timeoutId));
        this.updateThrottles.clear();
        
        // Mark canvas as dirty to trigger redraw
        if (this.app.graphCanvas) {
            this.app.graphCanvas.dirty_canvas = true;
        }
    }
    
    startCleanupTimer() {
        // Clean up stale mouse positions every second
        setInterval(() => {
            const now = Date.now();
            const staleUsers = [];
            
            this.otherUsersMice.forEach((mouseData, userId) => {
                if (now - mouseData.lastUpdate > this.mouseTimeout) {
                    staleUsers.push(userId);
                }
            });
            
            staleUsers.forEach(userId => this.removeUserMouse(userId));
        }, 1000);
    }
    
    /**
     * Draw other users' mouse cursors
     * Called during canvas rendering
     */
    draw(ctx) {
        if (this.otherUsersMice.size === 0) {
            return;
        }
        
        // Check if we're in gallery view (our own, not following)
        const inOwnGalleryView = this.app.graphCanvas?.galleryViewManager?.active && 
                                !this.app.userFollowManager?.isFollowing;
        
        // console.log('🖱️ Drawing', this.otherUsersMice.size, 'mouse cursors');
        
        ctx.save();
        
        // Get DPR for proper scaling
        const dpr = this.app.graphCanvas.viewport.dpr || 1;
        
        // Reset any transforms to draw in pure screen space with DPR
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        
        // Draw each user's mouse cursor
        this.otherUsersMice.forEach((mouseData, userId) => {
            // If we're in our own gallery view, only show cursors of users following us
            if (inOwnGalleryView && !this.app.userFollowManager?.isUserFollowingMe(userId)) {
                return; // Skip this cursor
            }
            const { x, y, color, username } = mouseData;
            
            // Convert graph coordinates to screen coordinates
            const screenPos = this.app.graphCanvas.viewport.convertGraphToOffset(x, y);
            // console.log('   Mouse at graph:', {x, y}, '-> screen:', screenPos);
            
            // Draw cursor in screen space (not affected by zoom)
            ctx.save();
            ctx.translate(screenPos[0], screenPos[1]);
            
            // Create a tinted cursor using the user's color
            // First draw a white cursor as base
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            
            // Arrow cursor shape (fixed size in pixels)
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, 12);
            ctx.lineTo(3, 10);
            ctx.lineTo(5, 15);
            ctx.lineTo(7, 14);
            ctx.lineTo(5, 9);
            ctx.lineTo(9, 9);
            ctx.closePath();
            
            ctx.fill();
            ctx.stroke();
            
            // Apply color tint as overlay with transparency
            ctx.globalCompositeOperation = 'multiply';
            ctx.fillStyle = color;
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
            
            // Draw username label with background
            const labelX = 12;
            const labelY = 0;
            ctx.font = '11px ' + (window.FONT_CONFIG?.APP_FONT || 'Arial');
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            
            // Measure text for background
            const textMetrics = ctx.measureText(username);
            const textWidth = textMetrics.width;
            const textHeight = 14;
            
            // Draw background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(labelX - 2, labelY - textHeight/2, textWidth + 4, textHeight);
            
            // Draw text
            ctx.fillStyle = color;
            ctx.fillText(username, labelX, labelY);
            
            ctx.restore();
        });
        
        ctx.restore();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OtherUsersMouseManager;
} else if (typeof window !== 'undefined') {
    window.OtherUsersMouseManager = OtherUsersMouseManager;
}