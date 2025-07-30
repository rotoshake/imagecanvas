/**
 * Fast render mixin for ImageNode to optimize performance during movement
 * This module adds aggressive performance optimizations for pan/zoom operations
 */

// Add fast render mode to ImageNode
if (typeof window !== 'undefined' && window.ImageNode) {
    const originalOnDrawForeground = window.ImageNode.prototype.onDrawForeground;
    
    // Track global movement state
    window.globalMovementState = {
        isMoving: false,
        lastMovementTime: 0,
        frameSkipCounter: 0,
        lowQualityMode: false,
        movementStartTime: 0,
        isZooming: false,
        renderSkipRate: 2 // Default frame skip rate
    };
    
    // Hook into canvas movement when it becomes available
    function hookCanvasMovement() {
        if (window.app && window.app.graphCanvas) {
            const canvas = window.app.graphCanvas;
            let moveTimeout;
            
            // Hook into mouse events
            const originalProcessMouseDown = canvas.processMouseDown;
            const originalProcessMouseMove = canvas.processMouseMove;
            const originalProcessMouseWheel = canvas.processMouseWheel;
            const originalSetZoom = canvas.setZoom;
            
            // Track when dragging starts
            canvas.processMouseDown = function(e) {
                const result = originalProcessMouseDown.call(this, e);
                
                // Start tracking if we're dragging
                if (this.dragging_canvas) {
                    window.globalMovementState.isMoving = true;
                    window.globalMovementState.movementStartTime = performance.now();
                }
                
                return result;
            };
            
            // Track mouse movement during drag
            canvas.processMouseMove = function(e) {
                if (this.dragging_canvas) {
                    window.globalMovementState.isMoving = true;
                    window.globalMovementState.lastMovementTime = performance.now();
                    
                    // Enter low quality mode after 100ms
                    if (performance.now() - window.globalMovementState.movementStartTime > 100) {
                        window.globalMovementState.lowQualityMode = true;
                    }
                    
                    clearTimeout(moveTimeout);
                    moveTimeout = setTimeout(() => {
                        window.globalMovementState.isMoving = false;
                        window.globalMovementState.lowQualityMode = false;
                        window.globalMovementState.movementStartTime = 0;
                        window.globalMovementState.frameSkipCounter = 0;
                        this.dirty_canvas = true;
                    }, 200);
                }
                
                return originalProcessMouseMove.call(this, e);
            };
            
            // Track zoom operations (mouse wheel)
            if (originalProcessMouseWheel) {
                canvas.processMouseWheel = function(e) {
                    // Start movement tracking immediately for zoom
                    window.globalMovementState.isMoving = true;
                    window.globalMovementState.lastMovementTime = performance.now();
                    window.globalMovementState.movementStartTime = performance.now();
                    window.globalMovementState.lowQualityMode = true; // Immediate low quality for zoom
                    window.globalMovementState.isZooming = true;
                    
                    clearTimeout(moveTimeout);
                    moveTimeout = setTimeout(() => {
                        window.globalMovementState.isMoving = false;
                        window.globalMovementState.lowQualityMode = false;
                        window.globalMovementState.movementStartTime = 0;
                        window.globalMovementState.frameSkipCounter = 0;
                        window.globalMovementState.isZooming = false;
                        // Clear all render caches to force fresh renders
                        if (canvas.graph && canvas.graph.nodes) {
                            canvas.graph.nodes.forEach(node => {
                                if (node._cachedRenderData) {
                                    node._cachedRenderData = null;
                                    node._lastScale = null;
                                }
                            });
                        }
                        this.dirty_canvas = true;
                    }, 300); // Slightly longer delay for zoom to settle
                    
                    return originalProcessMouseWheel.call(this, e);
                };
            } else {
                
                // Try to hook into the canvas wheel event directly
                canvas.canvas.addEventListener('wheel', function(e) {
                    if (e.ctrlKey || e.metaKey || e.shiftKey) return; // Skip if modifiers
                    
                    window.globalMovementState.isMoving = true;
                    window.globalMovementState.lastMovementTime = performance.now();
                    window.globalMovementState.movementStartTime = performance.now();
                    window.globalMovementState.lowQualityMode = true;
                    window.globalMovementState.isZooming = true;
                    
                    clearTimeout(moveTimeout);
                    moveTimeout = setTimeout(() => {
                        window.globalMovementState.isMoving = false;
                        window.globalMovementState.lowQualityMode = false;
                        window.globalMovementState.movementStartTime = 0;
                        window.globalMovementState.frameSkipCounter = 0;
                        window.globalMovementState.isZooming = false;
                        if (canvas.graph && canvas.graph.nodes) {
                            canvas.graph.nodes.forEach(node => {
                                if (node._cachedRenderData) {
                                    node._cachedRenderData = null;
                                    node._lastScale = null;
                                }
                            });
                        }
                        canvas.dirty_canvas = true;
                    }, 300);
                }, { passive: true });
            }
            
            // Track programmatic zoom
            if (originalSetZoom) {
                canvas.setZoom = function(scale, offset) {
                    // Track zoom operation
                    window.globalMovementState.isMoving = true;
                    window.globalMovementState.lastMovementTime = performance.now();
                    window.globalMovementState.lowQualityMode = true;
                    window.globalMovementState.isZooming = true;
                    
                    const result = originalSetZoom.call(this, scale, offset);
                    
                    clearTimeout(moveTimeout);
                    moveTimeout = setTimeout(() => {
                        window.globalMovementState.isMoving = false;
                        window.globalMovementState.lowQualityMode = false;
                        window.globalMovementState.frameSkipCounter = 0;
                        window.globalMovementState.isZooming = false;
                        this.dirty_canvas = true;
                    }, 300);
                    
                    return result;
                };
            }

            return true;
        }
        return false;
    }
    
    // Try to hook immediately, or wait for app initialization
    if (!hookCanvasMovement()) {
        // Wait for app to be ready
        const checkInterval = setInterval(() => {
            if (hookCanvasMovement()) {
                clearInterval(checkInterval);
            }
        }, 100);
    }
    
    // Fast render version of onDrawForeground
    window.ImageNode.prototype.onDrawForeground = function(ctx) {
        // Skip validation during movement
        if (!window.globalMovementState.isMoving) {
            this.validate();
        }
        
        // During zoom, do aggressive viewport culling
        if (window.globalMovementState.isZooming && this.graph?.canvas?.viewport) {
            // Quick visibility check - skip nodes far outside viewport during zoom
            const viewport = this.graph.canvas.viewport;
            const margin = 100; // Small margin during zoom
            const viewBounds = {
                left: -viewport.offset[0] / viewport.scale - margin,
                top: -viewport.offset[1] / viewport.scale - margin,
                right: (-viewport.offset[0] + viewport.canvas.width) / viewport.scale + margin,
                bottom: (-viewport.offset[1] + viewport.canvas.height) / viewport.scale + margin
            };
            
            // Quick bounds check
            const [x, y] = this.pos;
            const [w, h] = this.size;
            if (x + w < viewBounds.left || x > viewBounds.right ||
                y + h < viewBounds.top || y > viewBounds.bottom) {
                // Skip rendering this node entirely
                return;
            }
        }
        
        // Fast path for movement - skip complex rendering
        if (window.globalMovementState.lowQualityMode) {
            // Aggressive frame skipping during zoom
            window.globalMovementState.frameSkipCounter++;
            const skipRate = window.globalMovementState.isZooming ? 3 : 2; // Skip more frames during zoom
            if (window.globalMovementState.frameSkipCounter % skipRate !== 0) {
                // Just fill with background color on skipped frames
                ctx.fillStyle = '#2a2a2a';
                ctx.fillRect(0, 0, this.size[0], this.size[1]);
                return;
            }
            
            // Use ultra-low quality during fast movement
            let quickImage = null;
            
            // PERFORMANCE: Use pre-cached 64px thumbnail for all nodes during movement
            if (!this._fastThumbnail64 && this.properties.hash && window.thumbnailCache) {
                // Cache 64px thumbnail once
                this._fastThumbnail64 = window.thumbnailCache.getThumbnail(this.properties.hash, 64);
            }
            
            quickImage = this._fastThumbnail64 || this._cachedThumbnail;
            
            if (quickImage) {
                // Ultra fast render - no smoothing, no state changes
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(quickImage, 0, 0, this.size[0], this.size[1]);
            } else {
                // Just show placeholder
                ctx.fillStyle = '#2a2a2a';
                ctx.fillRect(0, 0, this.size[0], this.size[1]);
            }
            
            return;
        }
        
        // Normal rendering when not in low quality mode
        // Check if we're in deferred state first (most common for large sets)
        if (this.loadingState === 'deferred' && this._imageDataReady) {
            const quickRender = () => {
                if (this._cachedThumbnail) {
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'low';
                    ctx.drawImage(this._cachedThumbnail, 0, 0, this.size[0], this.size[1]);
                    return true;
                }
                return false;
            };
            
            if (!quickRender() && this.properties.hash && window.thumbnailCache) {
                const thumbnail = this.getBestThumbnail(this.size[0], this.size[1]);
                if (thumbnail) {
                    this._cachedThumbnail = thumbnail;
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'low';
                    ctx.drawImage(thumbnail, 0, 0, this.size[0], this.size[1]);
                } else {
                    this.drawPlaceholderWithInfo(ctx);
                }
            } else if (!this._cachedThumbnail) {
                this.drawPlaceholderWithInfo(ctx);
            }
            return;
        }
        
        // Fall back to original implementation for other states
        return originalOnDrawForeground.call(this, ctx);
    };

}