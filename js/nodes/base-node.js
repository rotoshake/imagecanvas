// ===================================
// BASE NODE CLASS
// ===================================

class BaseNode {
    constructor(type) {
        this.id = null;
        this.type = type;
        this.pos = [0, 0];
        this.size = [200, 200];
        this.title = '';
        this.properties = {};
        this.flags = {};
        this.rotation = 0;
        this.aspectRatio = 1;
        this.originalAspect = 1;
        this.graph = null;
        this.loadingState = 'idle'; // idle, loading, loaded, error
        
        // Visual effects
        this.brightness = 1.0; // 1.0 = normal, > 1.0 = brighter
        this.targetBrightness = 1.0;
        this.brightnessTransitionStart = null;
        this.brightnessTransitionDuration = 200; // ms
    }
    
    // Validation methods
    validatePosition() {
        if (!Utils.isValidArray(this.pos, 2)) {
            this.pos = [0, 0];
        }
    }
    
    validateSize() {
        if (!Utils.isValidArray(this.size, 2)) {
            this.size = [200, 200];
        }
        this.size[0] = Math.max(50, this.size[0]);
        this.size[1] = Math.max(50, this.size[1]);
    }
    
    validateRotation() {
        if (!Utils.isValidNumber(this.rotation)) {
            this.rotation = 0;
        }
    }
    
    validate() {
        this.validatePosition();
        this.validateSize();
        this.validateRotation();
    }
    
    // Transformation methods
    getCenter() {
        return [
            this.pos[0] + this.size[0] / 2,
            this.pos[1] + this.size[1] / 2
        ];
    }
    
    getBoundingBox() {
        if (this.rotation === 0) {
            return [this.pos[0], this.pos[1], this.size[0], this.size[1]];
        }
        
        // Calculate rotated bounding box
        const [cx, cy] = this.getCenter();
        const angle = this.rotation * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const hw = this.size[0] / 2;
        const hh = this.size[1] / 2;
        
        const corners = [
            [-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]
        ];
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const [ox, oy] of corners) {
            const x = cx + ox * cos - oy * sin;
            const y = cy + ox * sin + oy * cos;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        
        return [minX, minY, maxX - minX, maxY - minY];
    }
    
    containsPoint(x, y) {
        if (this.rotation === 0) {
            return x >= this.pos[0] && x <= this.pos[0] + this.size[0] &&
                   y >= this.pos[1] && y <= this.pos[1] + this.size[1];
        }
        
        // Transform point to local coordinates
        const [cx, cy] = this.getCenter();
        const dx = x - cx;
        const dy = y - cy;
        const angle = -this.rotation * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        
        const localX = dx * cos - dy * sin + this.size[0] / 2;
        const localY = dx * sin + dy * cos + this.size[1] / 2;
        
        return localX >= 0 && localX <= this.size[0] &&
               localY >= 0 && localY <= this.size[1];
    }
    
    // Drawing utilities
    drawPlaceholder(ctx, text) {
        ctx.fillStyle = '#444';
        ctx.fillRect(0, 0, this.size[0], this.size[1]);
        
        ctx.fillStyle = '#888';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, this.size[0] / 2, this.size[1] / 2);
    }
    
    drawProgressRing(ctx, progress = 0) {
        // Draw semi-transparent background
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, this.size[0], this.size[1]);
        
        const centerX = this.size[0] / 2;
        const centerY = this.size[1] / 2;
        
        // Get scale for screen-space calculations with fallbacks
        const scale = this.graph?.canvas?.viewport?.scale || 
                     window.app?.graphCanvas?.viewport?.scale ||
                     1;
        
        // Screen-space consistent line width (4px on screen)
        const lineWidth = 4 / scale;
        
        // Calculate radius with limits
        const nodeMinDimension = Math.min(this.size[0], this.size[1]);
        const baseRadius = nodeMinDimension * 0.15; // 15% of smallest dimension
        
        // Ensure ring fits within node (leave space for line width)
        const maxRadiusForNode = (nodeMinDimension / 2) - (lineWidth * 2); // Leave room for stroke
        
        // Screen-space limits
        const minRadius = 10 / scale;  // 20px minimum in screen space
        const maxRadius = 100 / scale; // 100px maximum in screen space
        
        // Apply all constraints: must fit in node, respect screen-space limits
        const radius = Math.max(
            Math.min(baseRadius, maxRadiusForNode, maxRadius),
            Math.min(minRadius, maxRadiusForNode) // Don't exceed node bounds even for minimum
        );
        
        // Don't draw ring if it would be too small or negative
        if (radius <= lineWidth || maxRadiusForNode <= 0) {
            return; // Node too small for ring
        }
        
        // Draw background ring
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = lineWidth;
        ctx.stroke();
        
        // Draw progress ring (radial fill)
        if (progress > 0) {
            ctx.beginPath();
            // Start from top (-PI/2) and fill clockwise
            const endAngle = -Math.PI / 2 + (progress * Math.PI * 2);
            ctx.arc(centerX, centerY, radius, -Math.PI / 2, endAngle);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        }
    }
    
    /**
     * Get the display title for the node
     * Falls back to filename if title is empty
     * @returns {string} The title to display
     */
    getDisplayTitle() {
        // Return custom title if it exists and isn't empty
        if (this.title && this.title.trim()) {
            return this.title;
        }
        
        // Fall back to filename if available
        if (this.properties?.filename) {
            return this.properties.filename;
        }
        
        // Fall back to node type as last resort
        return this.type || 'Node';
    }
    
    drawTitle(ctx) {
        // Default implementation draws title inside the node
        // Override in subclasses for custom behavior
        if (!this.title || this.flags?.hide_title) return;
        
        ctx.save();
        ctx.font = 'bold 15px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.shadowColor = 'black';
        ctx.shadowBlur = 5;
        
        const maxWidth = this.size[0] - 16;
        const displayTitle = Utils.truncateText(ctx, this.title, maxWidth);
        
        ctx.fillStyle = '#fff';
        ctx.fillText(displayTitle, 8, 12);
        ctx.restore();
    }
    
    markDirty() {
        if (this.graph?.canvas) {
            // For video nodes, use node-specific dirty tracking
            if (this.type === 'media/video' && this.graph.canvas.markNodeDirty) {
                this.graph.canvas.markNodeDirty(this);
            } else {
                // For other nodes, mark entire canvas as dirty
                this.graph.canvas.dirty_canvas = true;
            }
        }
    }
    
    /**
     * Set target brightness with transition
     * @param {number} brightness - Target brightness (1.0 = normal, > 1.0 = brighter)
     */
    setBrightness(brightness) {
        if (this.targetBrightness !== brightness) {
            this.targetBrightness = brightness;
            this.brightnessTransitionStart = Date.now();
            this.markDirty();
        }
    }
    
    /**
     * Update brightness based on transition
     * @returns {boolean} true if still transitioning
     */
    updateBrightness() {
        if (this.brightness === this.targetBrightness) {
            return false;
        }
        
        const now = Date.now();
        const elapsed = now - this.brightnessTransitionStart;
        const progress = Math.min(elapsed / this.brightnessTransitionDuration, 1);
        
        // Smooth easing
        const eased = 0.5 - Math.cos(progress * Math.PI) / 2;
        
        // Interpolate brightness
        const startBrightness = this.brightness;
        this.brightness = startBrightness + (this.targetBrightness - startBrightness) * eased;
        
        if (progress >= 1) {
            this.brightness = this.targetBrightness;
            return false;
        }
        
        return true;
    }
    
    // Lifecycle methods (override in subclasses)
    onResize() {}
    onDrawForeground(ctx) {}
    // Called when the node is removed from the graph
    onRemoved() {
        // Base implementation does nothing, can be overridden by subclasses
    }

    /**
     * Prepares data for an undo operation by capturing the node's current state.
     * This data can be used to restore the node to this state if an operation is undone.
     */
    prepareUndoData() {
        this.undoData = this.getUndoData();
    }

    /**
     * Retrieves a snapshot of the node's current state for undo purposes.
     * @returns {object} An object containing the node's current state.
     */
    getUndoData() {
        return {
            id: this.id,
            pos: [...this.pos],
            size: [...this.size],
            rotation: this.rotation,
            properties: JSON.parse(JSON.stringify(this.properties)), // Deep copy
            title: this.title,
            aspectRatio: this.aspectRatio,
        };
    }
}

// Make BaseNode available globally for browser environments
if (typeof window !== 'undefined') {
    window.BaseNode = BaseNode;
}