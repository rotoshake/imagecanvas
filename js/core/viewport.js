// ===================================
// VIEWPORT MANAGER
// ===================================

class ViewportManager {
    constructor(canvas, graphCanvas = null) {
        this.canvas = canvas;
        this.graphCanvas = graphCanvas; // Reference to LGraphCanvas instance
        this.offset = [0, 0];
        this.scale = CONFIG.CANVAS.DEFAULT_SCALE;
        this.dpr = window.devicePixelRatio || 1;
        
        // Validation bounds
        this.maxOffset = 1000000; // Prevent extreme offset values
        
        // Movement tracking for LOD optimization
        this.isAnimating = false;
        this.lastMovementTime = 0;
        this.movementTimeout = null;
        
        // Animation properties
        this.animation = null;
        this.animationFrameId = null;
        
        this.setupEventListeners();
        this.validateState();
    }
    
    setGraphCanvas(graphCanvas) {
        this.graphCanvas = graphCanvas;
    }
    
    setupEventListeners() {
        // Handle DPR changes
        this.dprCheckInterval = setInterval(() => {
            const currentDPR = window.devicePixelRatio || 1;
            if (Math.abs(currentDPR - this.dpr) > 0.1) {
                this.dpr = currentDPR;
                this.applyDPI();
            }
        }, 1000);
        
        // Handle window resize
        this.resizeHandler = Utils.debounce(() => this.applyDPI(), 100);
        window.addEventListener('resize', this.resizeHandler);
    }
    
    validateState() {
        // Ensure offset values are reasonable
        if (!Utils.isValidArray(this.offset, 2) || 
            Math.abs(this.offset[0]) > this.maxOffset || 
            Math.abs(this.offset[1]) > this.maxOffset) {
            console.warn('Invalid viewport offset, resetting:', this.offset);
            this.offset = [0, 0];
        }
        
        // Ensure scale is reasonable
        if (!Utils.isValidNumber(this.scale) || 
            this.scale < CONFIG.CANVAS.MIN_SCALE || 
            this.scale > CONFIG.CANVAS.MAX_SCALE) {
            console.warn('Invalid viewport scale, resetting:', this.scale);
            this.scale = CONFIG.CANVAS.DEFAULT_SCALE;
        }
    }
    
    applyDPI() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * this.dpr;
        this.canvas.height = rect.height * this.dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        
        const ctx = this.canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(this.dpr, this.dpr);
    }
    
    convertCanvasToOffset(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        return [clientX - rect.left, clientY - rect.top];
    }
    
    convertCanvasToGraph(clientX, clientY) {
        const offset = this.convertCanvasToOffset(clientX, clientY);
        return this.convertOffsetToGraph(offset[0], offset[1]);
    }
    
    convertOffsetToGraph(x, y) {
        return [
            (x - this.offset[0]) / this.scale,
            (y - this.offset[1]) / this.scale
        ];
    }
    
    convertGraphToOffset(x, y) {
        return [
            x * this.scale + this.offset[0],
            y * this.scale + this.offset[1]
        ];
    }
    
    zoom(delta, centerX, centerY) {
        const zoomFactor = delta > 0 ? (1 / CONFIG.CANVAS.ZOOM_FACTOR) : CONFIG.CANVAS.ZOOM_FACTOR;
        const newScale = Utils.clamp(
            this.scale * zoomFactor,
            CONFIG.CANVAS.MIN_SCALE,
            CONFIG.CANVAS.MAX_SCALE
        );
        
        if (newScale !== this.scale) {
            const scaleDelta = newScale / this.scale;
            this.offset[0] = centerX - (centerX - this.offset[0]) * scaleDelta;
            this.offset[1] = centerY - (centerY - this.offset[1]) * scaleDelta;
            this.scale = newScale;
            this.validateState();
        }
    }
    
    pan(deltaX, deltaY) {
        this.offset[0] += deltaX;
        this.offset[1] += deltaY;
        this.validateState();
    }
    
    zoomToFit(boundingBox, margin = 40, animate = true) {
        if (!boundingBox) return;
        
        const [x, y, width, height] = boundingBox;
        const canvasWidth = this.canvas.width / this.dpr;
        const canvasHeight = this.canvas.height / this.dpr;
        
        const availableWidth = canvasWidth - margin * 2;
        const availableHeight = canvasHeight - margin * 2;
        
        if (width === 0 || height === 0) return;
        
        const scaleX = availableWidth / width;
        const scaleY = availableHeight / height;
        const targetScale = Utils.clamp(
            Math.min(scaleX, scaleY),
            CONFIG.CANVAS.MIN_SCALE,
            CONFIG.CANVAS.MAX_SCALE
        );
        
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const targetOffsetX = canvasWidth / 2 - centerX * targetScale;
        const targetOffsetY = canvasHeight / 2 - centerY * targetScale;
        
        if (animate && CONFIG.NAVIGATION.ENABLE_ANIMATION) {
            this.animateTo(
                [targetOffsetX, targetOffsetY],
                targetScale,
                CONFIG.NAVIGATION.ANIMATION_DURATION
            );
        } else {
            this.scale = targetScale;
            this.offset[0] = targetOffsetX;
            this.offset[1] = targetOffsetY;
            this.validateState();
        }
    }
    
    panToCenter(graphX, graphY, animate = true) {
        // Calculate target offset to center the given graph coordinates
        const canvasWidth = this.canvas.width / this.dpr;
        const canvasHeight = this.canvas.height / this.dpr;
        
        const targetOffsetX = canvasWidth / 2 - graphX * this.scale;
        const targetOffsetY = canvasHeight / 2 - graphY * this.scale;
        
        if (animate && CONFIG.NAVIGATION.ENABLE_ANIMATION) {
            this.animateTo(
                [targetOffsetX, targetOffsetY],
                this.scale, // Keep current scale
                CONFIG.NAVIGATION.ANIMATION_DURATION
            );
        } else {
            this.offset[0] = targetOffsetX;
            this.offset[1] = targetOffsetY;
            this.validateState();
            
            // Trigger navigation state save
            if (window.navigationStateManager) {
                window.navigationStateManager.onViewportChange();
            }
        }
    }
    
    animateTo(targetOffset, targetScale, duration = 400) {
        // Cancel any existing animation
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        // Store start values
        const startOffset = [...this.offset];
        const startScale = this.scale;
        const startTime = performance.now();
        
        // Mark as animating
        this.isAnimating = true;
        
        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Apply easing
            const easedProgress = Utils.easeInOutCubic(progress);
            
            // Interpolate values
            this.offset[0] = Utils.lerp(startOffset[0], targetOffset[0], easedProgress);
            this.offset[1] = Utils.lerp(startOffset[1], targetOffset[1], easedProgress);
            this.scale = Utils.lerp(startScale, targetScale, easedProgress);
            
            // Validate and trigger redraw
            this.validateState();
            
            // Mark canvas as dirty for main render loop
            if (this.graphCanvas) {
                this.graphCanvas.dirty_canvas = true;
            }
            
            // Continue or finish animation
            if (progress < 1) {
                this.animationFrameId = requestAnimationFrame(animate);
            } else {
                this.animationFrameId = null;
                this.isAnimating = false;
                // Ensure final values are exact
                this.offset[0] = targetOffset[0];
                this.offset[1] = targetOffset[1];
                this.scale = targetScale;
                this.validateState();
                
                // Trigger navigation state save after animation completes
                if (window.navigationStateManager) {
                    window.navigationStateManager.onViewportChange();
                }
            }
        };
        
        this.animationFrameId = requestAnimationFrame(animate);
    }
    
    resetView() {
        this.scale = CONFIG.CANVAS.DEFAULT_SCALE;
        const canvasWidth = this.canvas.width / this.dpr;
        const canvasHeight = this.canvas.height / this.dpr;
        this.offset = [canvasWidth / 2, canvasHeight / 2];
    }
    
    getViewport() {
        const canvasWidth = this.canvas.width / this.dpr;
        const canvasHeight = this.canvas.height / this.dpr;
        
        return {
            x: -this.offset[0] / this.scale,
            y: -this.offset[1] / this.scale,
            width: canvasWidth / this.scale,
            height: canvasHeight / this.scale
        };
    }
    
    isNodeVisible(node, margin = 0) {
        const viewport = this.getViewport();
        
        // Use animated position if available, otherwise use actual position
        const pos = this.getNodePosition(node);
        
        // Calculate bounding box considering rotation and animated position
        let x, y, w, h;
        if (node.rotation === 0) {
            x = pos[0];
            y = pos[1];
            w = node.size[0];
            h = node.size[1];
        } else {
            // Calculate rotated bounding box using animated position
            const cx = pos[0] + node.size[0] / 2;
            const cy = pos[1] + node.size[1] / 2;
            const angle = node.rotation * Math.PI / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const hw = node.size[0] / 2;
            const hh = node.size[1] / 2;
            
            const corners = [
                [-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]
            ];
            
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            
            for (const [ox, oy] of corners) {
                const cornerX = cx + ox * cos - oy * sin;
                const cornerY = cy + ox * sin + oy * cos;
                minX = Math.min(minX, cornerX);
                minY = Math.min(minY, cornerY);
                maxX = Math.max(maxX, cornerX);
                maxY = Math.max(maxY, cornerY);
            }
            
            x = minX;
            y = minY;
            w = maxX - minX;
            h = maxY - minY;
        }
        
        return (
            x + w > viewport.x - margin &&
            x < viewport.x + viewport.width + margin &&
            y + h > viewport.y - margin &&
            y < viewport.y + viewport.height + margin
        );
    }
    
    getNodePosition(node) {
        // Check for auto-align animation position
        if (node._animPos && Array.isArray(node._animPos)) {
            return node._animPos;
        }
        
        // Check for grid-align animation position
        if (node._gridAnimPos && Array.isArray(node._gridAnimPos)) {
            return node._gridAnimPos;
        }
        
        // Fall back to actual position
        return node.pos;
    }
    
    getVisibleNodes(nodes, margin = CONFIG.PERFORMANCE.VISIBILITY_MARGIN) {
        return nodes.filter(node => this.isNodeVisible(node, margin));
    }
    
    getScreenBounds() {
        return {
            width: this.canvas.width / this.dpr,
            height: this.canvas.height / this.dpr
        };
    }
    
    // Grid drawing utilities
    shouldDrawGrid() {
        return this.scale >= CONFIG.CANVAS.MIN_GRID_SCALE;
    }
    
    getGridOffset() {
        const gridSize = CONFIG.CANVAS.GRID_SIZE;
        return {
            x: this.offset[0] % (gridSize * this.scale),
            y: this.offset[1] % (gridSize * this.scale),
            spacing: gridSize * this.scale
        };
    }
    
    cleanup() {
        if (this.dprCheckInterval) {
            clearInterval(this.dprCheckInterval);
        }
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }
    }
    
    // Debugging utilities
    getDebugInfo() {
        return {
            offset: [...this.offset],
            scale: this.scale,
            dpr: this.dpr,
            viewport: this.getViewport(),
            canvasSize: this.getScreenBounds()
        };
    }

    notifyMovement() {
        // Track when viewport is moving for LOD optimization
        this.lastMovementTime = performance.now();
        
        // Clear existing timeout
        if (this.movementTimeout) {
            clearTimeout(this.movementTimeout);
        }
        
        // Set isAnimating flag and clear it after movement stops
        this.isAnimating = true;
        this.movementTimeout = setTimeout(() => {
            this.isAnimating = false;
            // Trigger quality update after movement stops
            if (this.graphCanvas) {
                this.graphCanvas.dirty_canvas = true;
            }
        }, 150); // Consider movement stopped after 150ms of no updates
    }
    
    // Check if we should defer quality updates
    shouldDeferQualityUpdate() {
        // Defer during animation or recent movement
        if (this.isAnimating) return true;
        
        // Also defer if movement was very recent
        const timeSinceMovement = performance.now() - this.lastMovementTime;
        return timeSinceMovement < 200; // Defer for 200ms after last movement
    }
}

// Make ViewportManager available globally
if (typeof window !== 'undefined') {
    window.ViewportManager = ViewportManager;
}