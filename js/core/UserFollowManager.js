/**
 * UserFollowManager - Allows users to follow another user's navigation
 * Syncs viewport position, zoom, and view mode (gallery/normal)
 */
class UserFollowManager {
    constructor(app) {
        this.app = app;
        this.followingUserId = null;
        this.isFollowing = false;
        this.followersSet = new Set(); // Set of user IDs who are following us
        this.lastViewportUpdate = 0;
        this.viewportUpdateDelay = 50; // 20Hz max update rate for following
        this.viewportSaveDelay = 2000; // Save viewport state every 2 seconds
        this.broadcastThrottle = null;
        this.saveThrottle = null;
        
        this.setupNetworkListeners();
        this.setupViewportListeners();
        this.createUI();
    }
    
    createUI() {
        // Add follow indicators to user presence in navigator
        // This will be integrated with the canvas navigator's user indicators
    }
    
    setupNetworkListeners() {
        if (!this.app.networkLayer) return;
        
        // Listen for viewport updates from other users
        this.app.networkLayer.on('user_viewport_update', (data) => {
            this.handleViewportUpdate(data);
        });
        
        // Stop following when user leaves
        this.app.networkLayer.on('user_left', (user) => {
            if (this.followingUserId === user.userId) {
                this.stopFollowing();
            }
        });
        
        // Listen for follow notifications to prevent circular following
        this.app.networkLayer.on('user_started_following_you', (data) => {
            const followerId = parseInt(data.userId);
            
            // Add to followers set
            this.followersSet.add(followerId);
            console.log('👥 User started following you:', data.username);
            
            // Check for circular following
            if (this.followingUserId === followerId) {
                this.stopFollowing();
                
                // Show notification
                if (window.unifiedNotifications) {
                    window.unifiedNotifications.show({
                        type: 'info',
                        message: `Stopped following ${data.username} to prevent circular following`,
                        duration: 3000
                    });
                }
            }
            
            // Mark canvas dirty to update cursor visibility
            if (this.app.graphCanvas) {
                this.app.graphCanvas.dirty_canvas = true;
            }
        });
        
        // Listen for unfollow notifications
        this.app.networkLayer.on('user_stopped_following_you', (data) => {
            const followerId = parseInt(data.userId);
            
            // Remove from followers set
            this.followersSet.delete(followerId);
            console.log('👤 User stopped following you:', data.username);
            
            // Mark canvas dirty to update cursor visibility
            if (this.app.graphCanvas) {
                this.app.graphCanvas.dirty_canvas = true;
            }
        });
    }
    
    setupViewportListeners() {
        // Track local viewport changes
        if (!this.app.graphCanvas || !this.app.graphCanvas.viewport) return;
        
        const canvas = this.app.graphCanvas;
        const viewport = canvas.viewport;
        
        // Listen for user navigation events
        canvas.canvas.addEventListener('mousedown', () => {
            this.isUserNavigating = true;
        });
        
        canvas.canvas.addEventListener('mouseup', () => {
            // Delay resetting to allow viewport change handler to process
            setTimeout(() => {
                this.isUserNavigating = false;
            }, 100);
        });
        
        canvas.canvas.addEventListener('wheel', () => {
            this.isUserNavigating = true;
            // Reset after wheel event
            setTimeout(() => {
                this.isUserNavigating = false;
            }, 100);
        });
        
        // Create a viewport change handler
        this.viewportChangeHandler = () => {
            // If we're following someone and the viewport changed locally (user interaction),
            // stop following
            if (this.isFollowing && this.isUserNavigating) {
                console.log('🛑 Stopping follow due to user navigation');
                this.stopFollowing();
                return;
            }
            
            // Always broadcast viewport changes for persistence
            // But don't broadcast while following someone else
            if (!this.isFollowing) {
                this.broadcastViewportChange();
            }
        };
        
        // Track if viewport changes are from user interaction
        this.isUserNavigating = false;
        
        // Watch for changes to viewport scale and offset
        // Use Object.defineProperty to intercept property changes
        let currentScale = viewport.scale;
        let currentOffset = [...viewport.offset];
        let currentGalleryView = canvas.galleryViewManager?.active || false;
        
        // Monitor changes using a polling approach since we can't override the viewport easily
        this.viewportMonitorInterval = setInterval(() => {
            const galleryView = canvas.galleryViewManager?.active || false;
            if (viewport.scale !== currentScale || 
                viewport.offset[0] !== currentOffset[0] || 
                viewport.offset[1] !== currentOffset[1] ||
                galleryView !== currentGalleryView) {
                
                currentScale = viewport.scale;
                currentOffset = [...viewport.offset];
                currentGalleryView = galleryView;
                this.viewportChangeHandler();
            }
        }, 100); // Check every 100ms
        
        // Also track gallery view changes
        if (canvas.galleryViewManager) {
            // Hook into toggle method
            if (canvas.galleryViewManager.toggle) {
                const originalToggle = canvas.galleryViewManager.toggle.bind(canvas.galleryViewManager);
                canvas.galleryViewManager.toggle = () => {
                    // Don't treat gallery view toggle as user navigation
                    const wasNavigating = this.isUserNavigating;
                    this.isUserNavigating = false;
                    
                    originalToggle();
                    this.viewportChangeHandler();
                    
                    // Restore navigation state
                    this.isUserNavigating = wasNavigating;
                };
            }
            
            // Hook into enter method
            if (canvas.galleryViewManager.enter) {
                const originalEnter = canvas.galleryViewManager.enter.bind(canvas.galleryViewManager);
                canvas.galleryViewManager.enter = (node) => {
                    // Don't treat gallery view enter as user navigation
                    const wasNavigating = this.isUserNavigating;
                    this.isUserNavigating = false;
                    
                    originalEnter(node);
                    this.viewportChangeHandler();
                    
                    // Restore navigation state
                    this.isUserNavigating = wasNavigating;
                };
            }
            
            // Hook into exit method
            if (canvas.galleryViewManager.exit) {
                const originalExit = canvas.galleryViewManager.exit.bind(canvas.galleryViewManager);
                canvas.galleryViewManager.exit = () => {
                    // Don't treat gallery view exit as user navigation
                    const wasNavigating = this.isUserNavigating;
                    this.isUserNavigating = false;
                    
                    originalExit();
                    this.viewportChangeHandler();
                    
                    // Restore navigation state
                    this.isUserNavigating = wasNavigating;
                };
            }
            
            // Hook into navigation methods to broadcast node changes
            if (canvas.galleryViewManager.navigateToNode) {
                const originalNavigate = canvas.galleryViewManager.navigateToNode.bind(canvas.galleryViewManager);
                canvas.galleryViewManager.navigateToNode = (index, immediate) => {
                    // Don't treat gallery navigation as user navigation
                    const wasNavigating = this.isUserNavigating;
                    this.isUserNavigating = false;
                    
                    originalNavigate(index, immediate);
                    // Broadcast immediately after navigation
                    setTimeout(() => {
                        this.viewportChangeHandler();
                    }, 50);
                    
                    // Restore navigation state
                    this.isUserNavigating = wasNavigating;
                };
            }
        }
    }
    
    broadcastViewportChange() {
        if (!this.app.networkLayer || !this.app.networkLayer.isConnected) return;
        
        // Clear existing throttle
        if (this.broadcastThrottle) {
            clearTimeout(this.broadcastThrottle);
        }
        
        // Throttle broadcasts for real-time following
        this.broadcastThrottle = setTimeout(() => {
            this.broadcastCurrentState();
            this.broadcastThrottle = null;
        }, this.viewportUpdateDelay);
        
        // Save viewport state separately with a longer delay
        this.saveViewportState();
    }
    
    broadcastCurrentState() {
        if (!this.app.networkLayer || !this.app.networkLayer.isConnected) return;
        
        const canvas = this.app.graphCanvas;
        const viewport = canvas.viewport;
        const viewportData = {
            scale: viewport.scale,
            offset: [viewport.offset[0], viewport.offset[1]],
            isGalleryView: canvas.galleryViewManager?.active || false,
            galleryNodeId: canvas.galleryViewManager?.active ? 
                canvas.galleryViewManager.getCurrentNode()?.id : null,
            canvasWidth: canvas.canvas.width,
            canvasHeight: canvas.canvas.height
        };
        
        this.app.networkLayer.emit('viewport_follow_update', viewportData);
    }
    
    saveViewportState() {
        if (!this.app.networkLayer || !this.app.networkLayer.isConnected) return;
        
        // Clear existing save throttle
        if (this.saveThrottle) {
            clearTimeout(this.saveThrottle);
        }
        
        // Save viewport state less frequently
        this.saveThrottle = setTimeout(() => {
            const canvas = this.app.graphCanvas;
            const viewport = canvas.viewport;
            const viewportData = {
                scale: viewport.scale,
                offset: [viewport.offset[0], viewport.offset[1]],
                isGalleryView: canvas.galleryViewManager?.active || false
            };
            
            // The server will save this to the database
            this.app.networkLayer.emit('viewport_update', viewportData);
            this.saveThrottle = null;
        }, this.viewportSaveDelay);
    }
    
    handleViewportUpdate(data) {
        const { userId, scale, offset, isGalleryView, galleryNodeId } = data;
        
        // Only apply if we're following this user
        // Compare both as numbers to handle type mismatches
        const userIdNum = typeof userId === 'string' ? parseInt(userId) : userId;
        const followingIdNum = typeof this.followingUserId === 'string' ? parseInt(this.followingUserId) : this.followingUserId;
        
        if (!this.isFollowing || followingIdNum !== userIdNum) {
            return;
        }
        
        // Throttle updates
        const now = Date.now();
        if (now - this.lastViewportUpdate < this.viewportUpdateDelay) return;
        this.lastViewportUpdate = now;
        
        // Apply viewport changes
        const canvas = this.app.graphCanvas;
        if (!canvas) return;
        
        // Temporarily disable broadcasting while applying remote changes
        const wasFollowing = this.isFollowing;
        this.isFollowing = true;
        
        const viewport = canvas.viewport;
        if (!viewport) {
            console.error('❌ Canvas missing viewport');
            return;
        }
        
        // Apply to viewport properties
        viewport.scale = scale;
        viewport.offset[0] = offset[0];
        viewport.offset[1] = offset[1];
        
        // Validate the viewport state
        if (viewport.validateState) {
            viewport.validateState();
        }
        
        // Apply gallery view state
        if (canvas.galleryViewManager) {
            const isCurrentlyGallery = canvas.galleryViewManager.active || false;
            
            if (isGalleryView && !isCurrentlyGallery) {
                // Temporarily disable navigation detection
                const wasNavigating = this.isUserNavigating;
                this.isUserNavigating = false;
                
                // Find the specific node the leader is viewing
                let targetNode = null;
                if (galleryNodeId) {
                    targetNode = this.app.graph.getNodeById(galleryNodeId);
                }
                
                // Fallback to first media node if specific node not found
                if (!targetNode) {
                    targetNode = this.app.graph.nodes.find(node => 
                        node.type === 'media/image' || node.type === 'media/video'
                    );
                }
                
                if (targetNode && canvas.galleryViewManager.enter) {
                    canvas.galleryViewManager.enter(targetNode);
                } else if (canvas.galleryViewManager.toggle) {
                    canvas.galleryViewManager.toggle();
                }
                
                this.isUserNavigating = wasNavigating;
            } else if (!isGalleryView && isCurrentlyGallery) {
                // Temporarily disable navigation detection
                const wasNavigating = this.isUserNavigating;
                this.isUserNavigating = false;
                
                if (canvas.galleryViewManager.exit) {
                    canvas.galleryViewManager.exit();
                } else if (canvas.galleryViewManager.toggle) {
                    canvas.galleryViewManager.toggle();
                }
                
                this.isUserNavigating = wasNavigating;
            } else if (isGalleryView && isCurrentlyGallery && galleryNodeId) {
                // Both in gallery view - check if viewing same node
                const currentNode = canvas.galleryViewManager.getCurrentNode();
                if (currentNode && currentNode.id !== galleryNodeId) {
                    // Find the target node
                    const targetNode = this.app.graph.getNodeById(galleryNodeId);
                    if (targetNode) {
                        // Find index of target node in media nodes array
                        const index = canvas.galleryViewManager.mediaNodes.findIndex(
                            node => node.id === galleryNodeId
                        );
                        
                        if (index !== -1) {
                            // Temporarily disable navigation detection
                            const wasNavigating = this.isUserNavigating;
                            this.isUserNavigating = false;
                            
                            canvas.galleryViewManager.navigateToNode(index, true); // immediate
                            
                            this.isUserNavigating = wasNavigating;
                        }
                    }
                }
            }
        }
        
        this.isFollowing = wasFollowing;
        
        // Mark canvas as dirty
        canvas.dirty_canvas = true;
    }
    
    startFollowing(userId) {
        if (this.followingUserId === userId) return;
        
        // Don't allow following yourself - check against numeric user ID
        const currentUserId = this.app.networkLayer?.numericUserId;
        if (parseInt(userId) === currentUserId) {
            console.log('Cannot follow yourself');
            if (window.unifiedNotifications) {
                window.unifiedNotifications.show({
                    type: 'warning',
                    message: "You can't follow yourself",
                    duration: 2000
                });
            }
            return;
        }
        
        // Check if user is in a different canvas and switch to it first
        const targetUserCanvas = this.getUserCanvas(parseInt(userId));
        const currentCanvas = this.app.networkLayer?.currentCanvas?.id;
        
        if (targetUserCanvas && targetUserCanvas !== currentCanvas) {
            console.log(`🔄 Target user is in canvas ${targetUserCanvas}, switching from ${currentCanvas}`);
            
            // Show notification that we're switching canvases
            if (window.unifiedNotifications) {
                const username = this.getUsername(userId);
                window.unifiedNotifications.show({
                    type: 'info',
                    message: `Switching to ${username}'s canvas...`,
                    duration: 2000
                });
            }
            
            // Switch to target user's canvas first, then start following
            if (this.app.canvasNavigator) {
                this.app.canvasNavigator.loadCanvas(targetUserCanvas).then(() => {
                    // Canvas switched successfully, now start following
                    this.continueFollowing(userId);
                }).catch(error => {
                    console.error('Failed to switch canvas for following:', error);
                    if (window.unifiedNotifications) {
                        window.unifiedNotifications.show({
                            type: 'error',
                            message: 'Failed to switch canvas',
                            duration: 3000
                        });
                    }
                });
            } else {
                console.error('CanvasNavigator not available for canvas switching');
            }
            return;
        }
        
        // User is in same canvas (or no canvas info), proceed with following
        this.continueFollowing(userId);
    }
    
    continueFollowing(userId) {
        // Always convert to number for consistency
        this.followingUserId = parseInt(userId);
        this.isFollowing = true;
        console.log('✅ Started following user:', this.followingUserId);
        
        // Show notification
        if (window.unifiedNotifications) {
            const user = this.getUsername(userId);
            window.unifiedNotifications.show({
                type: 'info',
                message: `Following ${user}'s view`,
                duration: 2000
            });
        }
        
        // Update UI to show following state
        this.updateFollowingUI();
        
        // Notify the user that we're following them (for circular following prevention)
        if (this.app.networkLayer && this.app.networkLayer.isConnected) {
            this.app.networkLayer.emit('start_following_user', {
                targetUserId: this.followingUserId
            });
        }
        
        // Request current viewport state from the server
        if (this.app.networkLayer && this.app.networkLayer.isConnected) {
            this.app.networkLayer.emit('request_user_viewport', {
                userId: this.followingUserId
            });
        }
    }
    
    stopFollowing() {
        if (!this.isFollowing) return;
        
        this.isFollowing = false;
        const userId = this.followingUserId;
        this.followingUserId = null;
        
        // Notify the user that we stopped following them
        if (this.app.networkLayer && this.app.networkLayer.isConnected && userId) {
            this.app.networkLayer.emit('stop_following_user', {
                targetUserId: userId
            });
        }
        
        // Show notification
        if (window.unifiedNotifications) {
            const user = this.getUsername(userId);
            window.unifiedNotifications.show({
                type: 'info',
                message: `Stopped following ${user}`,
                duration: 2000
            });
        }
        
        // Update UI
        this.updateFollowingUI();
    }
    
    toggleFollowing(userId) {
        // Always convert to number for comparison
        const userIdNum = parseInt(userId);
        
        if (this.followingUserId === userIdNum) {
            this.stopFollowing();
        } else {
            this.startFollowing(userId);
        }
    }
    
    getUsername(userId) {
        // Try to find username from active users across all canvases
        if (this.app.canvasNavigator) {
            const allUsers = this.app.canvasNavigator.activeUsersPerCanvas;
            for (const [canvasId, users] of allUsers.entries()) {
                const user = users.find(u => parseInt(u.userId) === parseInt(userId));
                if (user) {
                    return user.displayName || user.username;
                }
            }
        }
        
        return `User ${userId}`;
    }
    
    getUserCanvas(userId) {
        // Find which canvas a user is currently in
        if (this.app.canvasNavigator) {
            const allUsers = this.app.canvasNavigator.activeUsersPerCanvas;
            for (const [canvasId, users] of allUsers.entries()) {
                const user = users.find(u => parseInt(u.userId) === parseInt(userId));
                if (user) {
                    return canvasId;
                }
            }
        }
        
        return null; // User not found or not in any canvas
    }
    
    updateFollowingUI() {
        // This will be called to update any UI indicators
        // For now, we'll integrate with the canvas navigator's user indicators
        if (this.app.canvasNavigator) {
            this.app.canvasNavigator.updateFollowingState(this.followingUserId);
        }
    }
    
    isUserFollowingMe(userId) {
        return this.followersSet.has(parseInt(userId));
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UserFollowManager;
} else if (typeof window !== 'undefined') {
    window.UserFollowManager = UserFollowManager;
}