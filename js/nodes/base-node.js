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
        const radius = Math.min(this.size[0], this.size[1]) * 0.15; // 15% of smallest dimension
        
        // Make line width screen-space aware
        const scale = this.graph?.canvas?.viewport?.scale || 1;
        const lineWidth = 3 / scale; // Consistent thickness regardless of zoom
        
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
    
    drawTitle(ctx) {
        if (!this.title || this.flags.hide_title) return;
        
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
            this.graph.canvas.dirty_canvas = true;
        }
    }
    
    // Lifecycle methods (override in subclasses)
    onResize() {}
    onDrawForeground(ctx) {}
    onRemoved() {}
}