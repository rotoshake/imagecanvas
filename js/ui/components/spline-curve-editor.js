class SplineCurveEditor {
    constructor(container, options = {}) {
        this.container = container;
        this.width = options.width || 256;
        this.height = options.height || 256;
        this.onChange = options.onChange || (() => {});
        
        // Control points for the spline
        this.controlPoints = [
            { x: 0, y: 0 },      // Start point (black)
            { x: 1, y: 1 }       // End point (white)
        ];
        
        // UI state
        this.selectedPoint = null;
        this.hoveredPoint = null;
        this.isDragging = false;
        this.lastClickTime = 0;
        this.doubleClickDelay = 300; // milliseconds
        
        // Configuration
        this.pointRadius = 6;
        this.gridDivisions = 4;
        this.curveResolution = 256; // Number of samples for LUT
        
        // Create canvas
        this.createCanvas();
        this.setupEventListeners();
        this.draw();
    }

    createCanvas() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.cursor = 'crosshair';
        
        this.ctx = this.canvas.getContext('2d');
        this.container.appendChild(this.canvas);
        
        // Handle container resize
        this.resizeObserver = new ResizeObserver(() => {
            const rect = this.container.getBoundingClientRect();
            // Make canvas square based on the smaller dimension
            const size = Math.min(rect.width, rect.height);
            this.width = size;
            this.height = size;
            this.canvas.width = this.width;
            this.canvas.height = this.height;
            this.draw();
        });
        this.resizeObserver.observe(this.container);
    }

    setupEventListeners() {
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
        this.canvas.addEventListener('contextmenu', this.handleContextMenu.bind(this));
        this.canvas.addEventListener('dblclick', this.handleDoubleClick.bind(this));
    }

    handleMouseDown(e) {
        e.preventDefault();
        const point = this.getMousePoint(e);
        
        // Check if this might be a double-click
        const currentTime = Date.now();
        const timeSinceLastClick = currentTime - this.lastClickTime;
        this.lastClickTime = currentTime;
        
        // Check if clicking on existing point
        const clickedPoint = this.findPointAt(point.x, point.y);
        
        if (clickedPoint) {
            this.selectedPoint = clickedPoint;
            this.isDragging = true;
            this.canvas.style.cursor = 'grabbing';
            
            // Add global listeners for dragging
            this.addGlobalDragListeners();
        } else if (e.button === 0 && timeSinceLastClick > this.doubleClickDelay) {
            // Left click - add new point only if not part of a double-click
            const newPoint = this.addPoint(point.x, point.y);
            if (newPoint) {
                this.selectedPoint = newPoint;
                this.isDragging = true;
                this.canvas.style.cursor = 'grabbing';
                
                // Add global listeners for dragging
                this.addGlobalDragListeners();
            }
        }
    }
    
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.isDragging = false;
            this.selectedPoint = null;
            this.hoveredPoint = null;
            this.canvas.style.cursor = 'not-allowed';
        } else {
            this.canvas.style.cursor = 'crosshair';
        }
        this.draw();
    }

    handleMouseMove(e) {
        const point = this.getMousePoint(e);
        
        if (this.isDragging && this.selectedPoint) {
            // Check if this is an endpoint
            const isFirstPoint = this.selectedPoint === this.controlPoints[0];
            const isLastPoint = this.selectedPoint === this.controlPoints[this.controlPoints.length - 1];
            
            // Update point position with constraints
            if (isFirstPoint) {
                // First point: lock X at 0, allow Y movement
                this.selectedPoint.x = 0;
                this.selectedPoint.y = Math.max(0, Math.min(1, point.y));
            } else if (isLastPoint) {
                // Last point: lock X at 1, allow Y movement
                this.selectedPoint.x = 1;
                this.selectedPoint.y = Math.max(0, Math.min(1, point.y));
            } else {
                // Middle points: allow full movement but constrain to valid range
                this.selectedPoint.x = Math.max(0, Math.min(1, point.x));
                this.selectedPoint.y = Math.max(0, Math.min(1, point.y));
                
                // Keep points sorted by X coordinate
                this.sortPoints();
            }
            
            this.draw();
            this.notifyChange(true); // intermediate update - dragging point
        } else {
            // Check for hover
            const hoveredPoint = this.findPointAt(point.x, point.y);
            if (hoveredPoint !== this.hoveredPoint) {
                this.hoveredPoint = hoveredPoint;
                this.canvas.style.cursor = hoveredPoint ? 'grab' : 'crosshair';
                this.draw();
            }
        }
    }

    handleMouseUp(e) {
        if (this.isDragging) {
            this.isDragging = false;
            this.selectedPoint = null;
            this.canvas.style.cursor = this.hoveredPoint ? 'grab' : 'crosshair';
            this.draw();
            
            // Notify final change to save to server
            this.notifyChange(false);
            
            // Remove global listeners
            this.removeGlobalDragListeners();
        }
    }
    
    addGlobalDragListeners() {
        // Store bound functions so we can remove them later
        this._globalMouseMove = this.handleGlobalMouseMove.bind(this);
        this._globalMouseUp = this.handleGlobalMouseUp.bind(this);
        
        document.addEventListener('mousemove', this._globalMouseMove);
        document.addEventListener('mouseup', this._globalMouseUp);
    }
    
    removeGlobalDragListeners() {
        if (this._globalMouseMove) {
            document.removeEventListener('mousemove', this._globalMouseMove);
            this._globalMouseMove = null;
        }
        if (this._globalMouseUp) {
            document.removeEventListener('mouseup', this._globalMouseUp);
            this._globalMouseUp = null;
        }
    }
    
    handleGlobalMouseMove(e) {
        if (this.isDragging && this.selectedPoint) {
            // Convert global mouse position to canvas coordinates
            const rect = this.canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const y = 1 - (e.clientY - rect.top) / rect.height;
            
            // Apply the same constraints as regular mouse move
            const isFirstPoint = this.selectedPoint === this.controlPoints[0];
            const isLastPoint = this.selectedPoint === this.controlPoints[this.controlPoints.length - 1];
            
            if (isFirstPoint) {
                this.selectedPoint.x = 0;
                this.selectedPoint.y = Math.max(0, Math.min(1, y));
            } else if (isLastPoint) {
                this.selectedPoint.x = 1;
                this.selectedPoint.y = Math.max(0, Math.min(1, y));
            } else {
                this.selectedPoint.x = Math.max(0, Math.min(1, x));
                this.selectedPoint.y = Math.max(0, Math.min(1, y));
                this.sortPoints();
            }
            
            this.draw();
            this.notifyChange(true); // intermediate update during drag
        }
    }
    
    handleGlobalMouseUp(e) {
        if (this.isDragging) {
            this.isDragging = false;
            this.selectedPoint = null;
            this.canvas.style.cursor = 'crosshair';
            this.draw();
            
            // Notify final change to save to server
            this.notifyChange(false);
            
            // Remove global listeners
            this.removeGlobalDragListeners();
        }
    }

    handleMouseLeave(e) {
        // Don't stop dragging on mouse leave since we have global listeners
        // Just clear hover state
        this.hoveredPoint = null;
        if (!this.isDragging) {
            this.draw();
        }
    }

    handleContextMenu(e) {
        e.preventDefault();
        const point = this.getMousePoint(e);
        const clickedPoint = this.findPointAt(point.x, point.y);
        
        if (clickedPoint) {
            // Don't allow removing end points (first and last)
            const index = this.controlPoints.indexOf(clickedPoint);
            if (index > 0 && index < this.controlPoints.length - 1) {
                this.controlPoints.splice(index, 1);
                this.draw();
                this.notifyChange(false); // final update - removing point
            }
        }
    }
    
    handleDoubleClick(e) {
        e.preventDefault();
        const point = this.getMousePoint(e);
        const clickedPoint = this.findPointAt(point.x, point.y);
        
        if (clickedPoint) {
            // Don't allow removing end points (first and last)
            const index = this.controlPoints.indexOf(clickedPoint);
            if (index > 0 && index < this.controlPoints.length - 1) {
                this.controlPoints.splice(index, 1);
                this.draw();
                this.notifyChange(false); // final update - removing point
            }
        }
    }

    getMousePoint(e) {
        const rect = this.canvas.getBoundingClientRect();
        // Since canvas maintains aspect ratio, we need to use actual canvas size
        const canvasRect = {
            width: this.canvas.width,
            height: this.canvas.height
        };
        // Calculate the actual position within the square canvas
        const x = (e.clientX - rect.left) / rect.width;
        const y = 1 - (e.clientY - rect.top) / rect.height; // Flip Y axis
        return { x, y };
    }

    findPointAt(x, y) {
        // Calculate threshold based on square canvas to ensure circular hit detection
        const thresholdX = (this.pointRadius * 2) / this.width;
        const thresholdY = (this.pointRadius * 2) / this.height;
        const threshold = Math.max(thresholdX, thresholdY);
        
        for (const point of this.controlPoints) {
            const dx = point.x - x;
            const dy = point.y - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < threshold) {
                return point;
            }
        }
        
        return null;
    }

    addPoint(x, y) {
        // Find insertion position to keep points sorted by X
        let insertIndex = this.controlPoints.length;
        for (let i = 0; i < this.controlPoints.length; i++) {
            if (this.controlPoints[i].x > x) {
                insertIndex = i;
                break;
            }
        }
        
        const newPoint = { x, y };
        this.controlPoints.splice(insertIndex, 0, newPoint);
        this.draw();
        this.notifyChange(false); // final update - adding point
        
        // Return the newly created point so it can be selected immediately
        return newPoint;
    }

    sortPoints() {
        this.controlPoints.sort((a, b) => a.x - b.x);
    }

    draw() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        // Clear canvas
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, w, h);
        
        // Draw grid
        this.drawGrid();
        
        // Draw diagonal reference line
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(w, 0);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Draw histogram placeholder (future feature)
        // this.drawHistogram();
        
        // Draw curve
        this.drawCurve();
        
        // Draw control points
        this.drawControlPoints();
    }

    drawGrid() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const divisions = this.gridDivisions;
        
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        
        for (let i = 1; i < divisions; i++) {
            const x = (w / divisions) * i;
            const y = (h / divisions) * i;
            
            // Vertical lines
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
            
            // Horizontal lines
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
    }

    drawCurve() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        if (this.controlPoints.length < 2) return;
        
        ctx.strokeStyle = '#0066cc';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        // Generate curve using monotonic cubic spline
        const curvePoints = this.generateSplineCurve();
        
        for (let i = 0; i < curvePoints.length; i++) {
            const x = curvePoints[i].x * w;
            const y = (1 - curvePoints[i].y) * h; // Flip Y for canvas coordinates
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
    }

    drawControlPoints() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        for (let i = 0; i < this.controlPoints.length; i++) {
            const point = this.controlPoints[i];
            const x = point.x * w;
            const y = (1 - point.y) * h; // Flip Y for canvas coordinates
            
            // Determine style
            const isFirstPoint = i === 0;
            const isLastPoint = i === this.controlPoints.length - 1;
            const isEndPoint = isFirstPoint || isLastPoint;
            const isHovered = point === this.hoveredPoint;
            const isSelected = point === this.selectedPoint;
            
            // Draw point
            ctx.beginPath();
            ctx.arc(x, y, this.pointRadius, 0, Math.PI * 2);
            
            if (isSelected) {
                ctx.fillStyle = '#0088ff';
                ctx.strokeStyle = '#00aaff';
            } else if (isHovered) {
                if (isEndPoint) {
                    // Can't remove endpoints
                    ctx.fillStyle = '#888';
                    ctx.strokeStyle = '#aaa';
                } else {
                    // Removable point - show in red when hovered
                    ctx.fillStyle = '#cc3333';
                    ctx.strokeStyle = '#ff5555';
                }
            } else if (isEndPoint) {
                // Different colors for locked endpoints
                ctx.fillStyle = '#888';
                ctx.strokeStyle = '#aaa';
            } else {
                ctx.fillStyle = '#444';
                ctx.strokeStyle = '#666';
            }
            
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Draw lock indicator for endpoints
            if (isEndPoint) {
                ctx.strokeStyle = '#ccc';
                ctx.lineWidth = 1;
                ctx.beginPath();
                if (isFirstPoint) {
                    // Vertical line at x=0 to indicate X is locked
                    ctx.moveTo(x - 3, y - 8);
                    ctx.lineTo(x - 3, y + 8);
                } else {
                    // Vertical line at x=1 to indicate X is locked
                    ctx.moveTo(x + 3, y - 8);
                    ctx.lineTo(x + 3, y + 8);
                }
                ctx.stroke();
            }
        }
    }

    generateSplineCurve() {
        const points = this.controlPoints;
        const curvePoints = [];
        const steps = this.curveResolution;
        
        if (points.length === 2) {
            // Simple linear interpolation for 2 points (default tone curve)
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const x = points[0].x + (points[1].x - points[0].x) * t;
                const y = points[0].y + (points[1].y - points[0].y) * t;
                curvePoints.push({ x, y });
            }
        } else {
            // Use monotonic cubic spline for multiple points
            // This ensures no overshooting and maintains monotonicity
            const spline = this.computeMonotonicSpline(points);
            
            for (let i = 0; i <= steps; i++) {
                const x = i / steps;
                const y = this.evaluateMonotonicSpline(spline, x);
                curvePoints.push({ x, y });
            }
        }
        
        return curvePoints;
    }

    computeMonotonicSpline(points) {
        const n = points.length;
        const spline = {
            x: points.map(p => p.x),
            y: points.map(p => p.y),
            m: new Array(n) // slopes
        };
        
        if (n === 2) {
            // For two points, just use linear slope
            spline.m[0] = spline.m[1] = (points[1].y - points[0].y) / (points[1].x - points[0].x);
            return spline;
        }
        
        // Calculate secant slopes between adjacent points
        const delta = [];
        const slopes = [];
        for (let i = 0; i < n - 1; i++) {
            delta[i] = points[i + 1].x - points[i].x;
            slopes[i] = (points[i + 1].y - points[i].y) / delta[i];
        }
        
        // Initialize tangents using Fritsch-Carlson method
        spline.m[0] = slopes[0];
        spline.m[n - 1] = slopes[n - 2];
        
        for (let i = 1; i < n - 1; i++) {
            if (slopes[i - 1] * slopes[i] <= 0) {
                // Sign change or zero - set tangent to zero
                spline.m[i] = 0;
            } else {
                // Use harmonic mean for interior points
                const dx = delta[i - 1] + delta[i];
                spline.m[i] = 3 * dx / ((dx + delta[i]) / slopes[i - 1] + (dx + delta[i - 1]) / slopes[i]);
            }
        }
        
        // Apply monotonicity constraints
        for (let i = 0; i < n - 1; i++) {
            if (slopes[i] === 0) {
                spline.m[i] = spline.m[i + 1] = 0;
            } else {
                const alpha = spline.m[i] / slopes[i];
                const beta = spline.m[i + 1] / slopes[i];
                
                // Ensure monotonicity
                if (alpha < 0) spline.m[i] = 0;
                if (beta < 0) spline.m[i + 1] = 0;
                
                const s = alpha * alpha + beta * beta;
                if (s > 9) {
                    // Rescale to prevent overshooting
                    const tau = 3 / Math.sqrt(s);
                    spline.m[i] = tau * alpha * slopes[i];
                    spline.m[i + 1] = tau * beta * slopes[i];
                }
            }
        }
        
        return spline;
    }
    
    evaluateMonotonicSpline(spline, x) {
        const n = spline.x.length;
        
        // Find the right interval
        let i = 0;
        for (let j = 1; j < n; j++) {
            if (x <= spline.x[j]) {
                i = j - 1;
                break;
            }
        }
        
        // Handle edge cases
        if (x <= spline.x[0]) return spline.y[0];
        if (x >= spline.x[n - 1]) return spline.y[n - 1];
        
        // Hermite interpolation within the interval
        const h = spline.x[i + 1] - spline.x[i];
        const t = (x - spline.x[i]) / h;
        const t2 = t * t;
        const t3 = t2 * t;
        
        // Hermite basis functions
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;
        
        const y = h00 * spline.y[i] + 
                  h10 * h * spline.m[i] + 
                  h01 * spline.y[i + 1] + 
                  h11 * h * spline.m[i + 1];
        
        // Ensure output is in valid range
        return Math.max(0, Math.min(1, y));
    }

    getCurveData() {
        // Return control points directly - no LUT needed
        return {
            controlPoints: this.controlPoints.map(p => ({ x: p.x, y: p.y })),
            timestamp: Date.now()
        };
    }

    loadCurve(curveData) {
        if (curveData && curveData.controlPoints) {
            this.controlPoints = curveData.controlPoints.map(p => ({ x: p.x, y: p.y }));
            this.draw();
        }
    }

    reset() {
        this.controlPoints = [
            { x: 0, y: 0 },
            { x: 1, y: 1 }
        ];
        this.selectedPoint = null;
        this.hoveredPoint = null;
        this.draw();
        this.notifyChange(false); // final update - reset curve
    }

    notifyChange(isIntermediate = true) {
        if (this.onChange) {
            this.onChange(this.getCurveData(), isIntermediate);
        }
    }

    destroy() {
        // Remove any active global listeners
        this.removeGlobalDragListeners();
        
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        if (this.canvas) {
            this.canvas.remove();
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SplineCurveEditor;
}

// Make SplineCurveEditor available globally
if (typeof window !== 'undefined') {
    window.SplineCurveEditor = SplineCurveEditor;
}