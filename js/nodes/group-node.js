// ===================================
// GROUP NODE CLASS
// ===================================

class GroupNode extends BaseNode {
    constructor() {
        super('container/group');
        this.title = 'Group';
        this.childNodes = new Set(); // Set of node IDs that belong to this group
        this.isCollapsed = false;
        this.collapsedSize = [200, 40]; // Size when collapsed (width, height of title bar)
        this.expandedSize = [300, 200]; // Minimum expanded size
        this.padding = 20; // Padding around child nodes
        this.titleBarHeight = 30; // Fallback height
        this.screenSpaceTitleBarHeight = 20; // Target screen-space height in pixels
        
        // Initialize size if not already set by BaseNode
        if (!this.size || !Array.isArray(this.size)) {
            this.size = [...this.expandedSize];
        }
        
        // Animation properties
        this.animatedPos = null;
        this.animatedSize = null;
        this.targetPos = null;
        this.targetSize = null;
        this.animationStartTime = null;
        this.animationDuration = 200; // ms - same as brightness transitions
        
        // Visual styling
        this.style = {
            backgroundColor: 'rgba(60, 60, 60, 0.5)',
            borderColor: 'rgba(120, 120, 120, 0.9)',
            borderWidth: 1,
            titleBackgroundColor: 'rgba(80, 80, 80, 0.9)',
            titleTextColor: '#ffffff',
            cornerRadius: 4
        };
        
        // Handle positions for resizing (when expanded)
        this.resizeHandles = [
            { name: 'se', x: 1, y: 1 }, // bottom-right
            { name: 'sw', x: 0, y: 1 }, // bottom-left
            { name: 'ne', x: 1, y: 0 }, // top-right
            { name: 'nw', x: 0, y: 0 }  // top-left (not active - reserved for title)
        ];
        
        // State for interactions
        this.isResizing = false;
        this.isDraggingTitleBar = false;
        this.resizeHandle = null;
        this.dragStartPos = null;
        this.dragStartSize = null;
        
        // Minimum size constraints
        this.minSize = [150, 100];
        
        // Override flags to ensure groups are always visible
        this.flags = { 
            hide_title: true, // Disable floating title since we have title bar
            render_behind_nodes: true // Groups render behind regular nodes
        };
    }
    
    /**
     * Configure the group node from server data
     */
    configure(data) {
        console.log('🔧 GroupNode.configure called with:', data);
        
        // Call parent configure if it exists
        if (super.configure) {
            super.configure(data);
        }
        
        // Restore child nodes from properties
        if (data.properties && data.properties.childNodes) {
            this.childNodes.clear();
            for (const nodeId of data.properties.childNodes) {
                this.childNodes.add(nodeId);
            }
            console.log(`✅ Loaded ${this.childNodes.size} child nodes:`, Array.from(this.childNodes));
        } else {
            console.log('⚠️ No childNodes in properties:', data.properties);
        }
        
        // Restore other group-specific properties
        if (data.properties) {
            if (data.properties.isCollapsed !== undefined) {
                this.isCollapsed = data.properties.isCollapsed;
            }
            if (data.properties.style) {
                Object.assign(this.style, data.properties.style);
            }
        }
    }
    
    /**
     * Add a node to this group
     */
    addChildNode(nodeId, skipBoundsUpdate = false) {
        if (typeof nodeId === 'object') {
            nodeId = nodeId.id; // Handle both node objects and IDs
        }
        this.childNodes.add(nodeId);
        if (!skipBoundsUpdate) {
            return this.updateBounds(true); // expandOnly = true for animation
        }
        this.markDirty();
        return null;
    }
    
    /**
     * Remove a node from this group
     */
    removeChildNode(nodeId) {
        if (typeof nodeId === 'object') {
            nodeId = nodeId.id;
        }
        this.childNodes.delete(nodeId);
        // Don't update bounds when removing (keep current size)
        this.markDirty();
    }
    
    /**
     * Add multiple nodes to this group at once
     * This avoids multiple animations when adding several nodes
     */
    addMultipleChildNodes(nodeIds) {
        let added = false;
        for (let nodeId of nodeIds) {
            if (typeof nodeId === 'object') {
                nodeId = nodeId.id;
            }
            if (!this.childNodes.has(nodeId)) {
                this.childNodes.add(nodeId);
                added = true;
            }
        }
        if (added) {
            this.updateBounds(true); // expandOnly = true for animation
            this.markDirty();
        }
    }
    
    /**
     * Get all child node objects
     */
    getChildNodes() {
        if (!this.graph) {
            console.log('⚠️ getChildNodes: No graph reference! Will try global graph...');
            // Try to find the graph through the global app
            const globalGraph = window.app?.graph;
            if (!globalGraph) {
                console.log('❌ No global graph found either!');
                return [];
            }
            // Use the global graph
            const childNodeIds = Array.from(this.childNodes);
            const childNodeObjects = childNodeIds
                .map(id => {
                    const node = globalGraph.getNodeById(id);
                    if (!node) {
                        console.log(`⚠️ Child node ${id} not found in global graph!`);
                    }
                    return node;
                })
                .filter(node => node !== null);
            
            console.log(`📦 getChildNodes (via global): ${childNodeIds.length} IDs -> ${childNodeObjects.length} nodes found`);
            return childNodeObjects;
        }
        
        const childNodeIds = Array.from(this.childNodes);
        const childNodeObjects = childNodeIds
            .map(id => {
                const node = this.graph.getNodeById(id);
                if (!node) {
                    console.log(`⚠️ Child node ${id} not found in graph!`);
                }
                return node;
            })
            .filter(node => node !== null);
        
        console.log(`📦 getChildNodes: ${childNodeIds.length} IDs -> ${childNodeObjects.length} nodes found`);
        return childNodeObjects;
    }
    
    /**
     * Get title bar height in world space based on viewport zoom
     * This should be called from canvas context, not node context
     */
    getScreenSpaceTitleBarHeightForViewport(viewport) {
        if (!viewport) {
            return this.titleBarHeight; // Fallback
        }
        
        // Calculate world-space height that results in desired screen-space pixels
        return this.screenSpaceTitleBarHeight / viewport.scale;
    }
    
    /**
     * Check if a point is within the title bar for dragging
     * Note: This should be called from canvas context with proper viewport
     */
    isPointInTitleBar(x, y, viewport = null) {
        const titleBarHeight = this.getScreenSpaceTitleBarHeightForViewport(viewport);
        return (
            x >= this.pos[0] && 
            x <= this.pos[0] + this.size[0] &&
            y >= this.pos[1] && 
            y <= this.pos[1] + titleBarHeight
        );
    }
    
    /**
     * Check if a point is within a resize handle
     */
    getResizeHandleAt(x, y) {
        if (this.isCollapsed) return null;
        
        const handleSize = 12;
        const halfHandle = handleSize / 2;
        
        for (const handle of this.resizeHandles) {
            if (handle.name === 'nw') continue; // Skip top-left (title bar area)
            
            const handleX = this.pos[0] + (handle.x * this.size[0]) - halfHandle;
            const handleY = this.pos[1] + (handle.y * this.size[1]) - halfHandle;
            
            if (x >= handleX && x <= handleX + handleSize &&
                y >= handleY && y <= handleY + handleSize) {
                return handle.name;
            }
        }
        return null;
    }
    
    /**
     * Update group bounds to fit all child nodes with padding
     * @param {boolean} expandOnly - If true, only expands, never shrinks
     * @returns {{pos: number[], size: number[]}} The target bounds (for server sync)
     */
    updateBounds(expandOnly = false) {
        if (this.isCollapsed) {
            this.size = [...this.collapsedSize];
            return {
                pos: [...this.pos],
                size: [...this.size]
            };
        }
        
        const childNodes = this.getChildNodes();
        console.log(`📐 updateBounds: Group ${this.id} has ${childNodes.length} children`);
        
        if (childNodes.length === 0) {
            // Don't shrink to default size if expandOnly is true
            if (!expandOnly) {
                this.size = [...this.expandedSize];
            }
            return {
                pos: [...this.pos],
                size: [...this.size]
            };
        }
        
        // Calculate bounding box of all child nodes
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const node of childNodes) {
            if (node === this) continue; // Skip self to avoid recursion
            
            const nodeMinX = node.pos[0];
            const nodeMinY = node.pos[1];
            const nodeMaxX = node.pos[0] + node.size[0];
            const nodeMaxY = node.pos[1] + node.size[1];
            
            minX = Math.min(minX, nodeMinX);
            minY = Math.min(minY, nodeMinY);
            maxX = Math.max(maxX, nodeMaxX);
            maxY = Math.max(maxY, nodeMaxY);
        }
        
        console.log(`📐 Child bounds: min(${minX}, ${minY}) max(${maxX}, ${maxY})`);
        
        // Calculate new bounds with padding
        const titleBarHeight = this.titleBarHeight; // Use fallback for bounds calculation
        const newX = minX - this.padding;
        const newY = minY - this.padding - titleBarHeight;
        const newWidth = Math.max(maxX - minX + (this.padding * 2), this.minSize[0]);
        const newHeight = Math.max(maxY - minY + (this.padding * 2) + titleBarHeight, this.minSize[1]);
        
        if (expandOnly) {
            // Calculate current bounds
            const currentRight = this.pos[0] + this.size[0];
            const currentBottom = this.pos[1] + this.size[1];
            const newRight = newX + newWidth;
            const newBottom = newY + newHeight;
            
            // Only expand bounds, never shrink
            const finalLeft = Math.min(this.pos[0], newX);
            const finalTop = Math.min(this.pos[1], newY);
            const finalRight = Math.max(currentRight, newRight);
            const finalBottom = Math.max(currentBottom, newBottom);
            
            const finalWidth = finalRight - finalLeft;
            const finalHeight = finalBottom - finalTop;
            
            console.log(`📐 Expand only - animating to: pos[${finalLeft}, ${finalTop}] size[${finalWidth}, ${finalHeight}]`);
            
            // Start animation to new bounds WITHOUT immediately setting pos/size
            this.animateToBounds(finalLeft, finalTop, finalWidth, finalHeight);
            
            // Return target bounds for server sync
            return {
                pos: [finalLeft, finalTop],
                size: [finalWidth, finalHeight]
            };
        } else {
            // Update position and size (original behavior - for initial creation)
            console.log(`📐 Old bounds: pos[${this.pos[0]}, ${this.pos[1]}] size[${this.size[0]}, ${this.size[1]}]`);
            
            this.pos[0] = newX;
            this.pos[1] = newY;
            this.size[0] = newWidth;
            this.size[1] = newHeight;
            
            console.log(`📐 New bounds: pos[${this.pos[0]}, ${this.pos[1]}] size[${this.size[0]}, ${this.size[1]}]`);
            
            // Return current bounds
            return {
                pos: [this.pos[0], this.pos[1]],
                size: [this.size[0], this.size[1]]
            };
        }
    }
    
    /**
     * Animate to new bounds
     */
    animateToBounds(x, y, width, height) {
        // If no animation is running, store current pos/size as animation start
        if (!this.animationStartTime) {
            this.animatedPos = [...this.pos];
            this.animatedSize = [...this.size];
        } else {
            // If animation is already running, use current interpolated values as new start
            const now = Date.now();
            const elapsed = now - this.animationStartTime;
            const progress = Math.min(elapsed / this.animationDuration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            
            // Calculate current interpolated position
            const currentX = this.animatedPos[0] + (this.targetPos[0] - this.animatedPos[0]) * eased;
            const currentY = this.animatedPos[1] + (this.targetPos[1] - this.animatedPos[1]) * eased;
            const currentWidth = this.animatedSize[0] + (this.targetSize[0] - this.animatedSize[0]) * eased;
            const currentHeight = this.animatedSize[1] + (this.targetSize[1] - this.animatedSize[1]) * eased;
            
            this.animatedPos = [currentX, currentY];
            this.animatedSize = [currentWidth, currentHeight];
        }
        
        // Set targets
        this.targetPos = [x, y];
        this.targetSize = [width, height];
        
        // Start/restart animation
        this.animationStartTime = Date.now();
        
        // Mark dirty to trigger redraws during animation
        this.markDirty();
    }
    
    /**
     * Update animation state
     * @returns {boolean} true if still animating
     */
    updateAnimation() {
        if (!this.animationStartTime || !this.targetPos || !this.targetSize) {
            return false;
        }
        
        const now = Date.now();
        const elapsed = now - this.animationStartTime;
        const progress = Math.min(elapsed / this.animationDuration, 1);
        
        // Cubic ease-out (same as other animations)
        const eased = 1 - Math.pow(1 - progress, 3);
        
        // Interpolate position
        this.pos[0] = this.animatedPos[0] + (this.targetPos[0] - this.animatedPos[0]) * eased;
        this.pos[1] = this.animatedPos[1] + (this.targetPos[1] - this.animatedPos[1]) * eased;
        
        // Interpolate size
        this.size[0] = this.animatedSize[0] + (this.targetSize[0] - this.animatedSize[0]) * eased;
        this.size[1] = this.animatedSize[1] + (this.targetSize[1] - this.animatedSize[1]) * eased;
        
        if (progress >= 1) {
            // Animation complete
            this.pos[0] = this.targetPos[0];
            this.pos[1] = this.targetPos[1];
            this.size[0] = this.targetSize[0];
            this.size[1] = this.targetSize[1];
            
            // Clear animation state
            this.animationStartTime = null;
            this.animatedPos = null;
            this.animatedSize = null;
            this.targetPos = null;
            this.targetSize = null;
            
            return false;
        }
        
        return true;
    }
    
    /**
     * Toggle collapsed state
     */
    toggleCollapsed() {
        this.isCollapsed = !this.isCollapsed;
        if (this.isCollapsed) {
            this.size = [...this.collapsedSize];
        } else {
            this.updateBounds();
        }
        this.markDirty();
    }
    
    /**
     * Move all child nodes by the given offset
     */
    moveChildNodes(deltaX, deltaY) {
        console.log(`🚀 moveChildNodes called with delta: ${deltaX}, ${deltaY}`);
        console.log(`   Group ${this.id} has ${this.childNodes.size} child IDs:`, Array.from(this.childNodes));
        
        const childNodes = this.getChildNodes();
        console.log(`   Found ${childNodes.length} actual child nodes`);
        
        for (const node of childNodes) {
            if (node === this) continue; // Skip self
            console.log(`   Moving child ${node.id} from [${node.pos[0]}, ${node.pos[1]}]`);
            node.pos[0] += deltaX;
            node.pos[1] += deltaY;
            node.markDirty();
        }
    }
    
    /**
     * Check if a node should be contained within this group based on position
     */
    shouldContainNode(node) {
        if (node === this || node.type === 'container/group') return false;
        if (this.isCollapsed) return false;
        
        // Check if node center is within group bounds (excluding title bar)
        const nodeCenterX = node.pos[0] + node.size[0] / 2;
        const nodeCenterY = node.pos[1] + node.size[1] / 2;
        
        const titleBarHeight = this.titleBarHeight; // Use fallback for containment check
        const groupContentArea = {
            left: this.pos[0],
            top: this.pos[1] + titleBarHeight,
            right: this.pos[0] + this.size[0],
            bottom: this.pos[1] + this.size[1]
        };
        
        return (
            nodeCenterX >= groupContentArea.left &&
            nodeCenterX <= groupContentArea.right &&
            nodeCenterY >= groupContentArea.top &&
            nodeCenterY <= groupContentArea.bottom
        );
    }
    
    /**
     * Get cursor style for different areas of the group
     */
    getCursorForPosition(x, y) {
        if (this.isPointInTitleBar(x, y)) {
            return 'move';
        }
        
        const handle = this.getResizeHandleAt(x, y);
        if (handle) {
            switch (handle) {
                case 'se': case 'nw': return 'nw-resize';
                case 'sw': case 'ne': return 'ne-resize';
                case 'n': case 's': return 'ns-resize';
                case 'e': case 'w': return 'ew-resize';
                default: return 'default';
            }
        }
        
        return 'default';
    }
    
    /**
     * Render the group node
     * Note: titleBarHeight, lineWidth, and fontSize should be calculated in canvas context before node transform
     */
    onDrawForeground(ctx, titleBarHeight = null, lineWidth = null, fontSize = null) {
        ctx.save();
        
        // Use provided screen-space values or fallbacks
        const actualTitleBarHeight = titleBarHeight || this.titleBarHeight;
        const actualLineWidth = lineWidth || this.style.borderWidth;
        const actualFontSize = fontSize || 12;
        
        // Draw main group background (only if expanded)
        if (!this.isCollapsed) {
            this.drawGroupBackground(ctx, actualTitleBarHeight, actualLineWidth);
        }
        
        // Draw title bar
        this.drawTitleBar(ctx, actualTitleBarHeight, actualLineWidth, actualFontSize);
        
        // Draw resize handles (only if expanded and selected)
        if (!this.isCollapsed && this.graph?.canvas?.selection?.isSelected(this)) {
            this.drawResizeHandles(ctx, actualLineWidth);
        }
        
        // Draw child count indicator if collapsed
        if (this.isCollapsed) {
            this.drawChildCountIndicator(ctx, actualTitleBarHeight);
        }
        
        ctx.restore();
    }
    
    /**
     * Draw the main group background
     */
    drawGroupBackground(ctx, titleBarHeight, lineWidth) {
        const x = 0;
        const y = titleBarHeight;
        const width = this.size[0];
        const height = this.size[1] - titleBarHeight;
        
        // Background with rounded corners
        ctx.fillStyle = this.style.backgroundColor;
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, [0, 0, this.style.cornerRadius, this.style.cornerRadius]);
        ctx.fill();
        
        // Border with screen-space line width
        ctx.strokeStyle = this.style.borderColor;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    }
    
    /**
     * Get display title for the group
     */
    getDisplayTitle() {
        return this.title || 'Group';
    }
    
    /**
     * Draw the title bar
     */
    drawTitleBar(ctx, titleBarHeight, lineWidth, fontSize = null) {
        const x = 0;
        const y = 0;
        const width = this.size[0];
        const height = titleBarHeight;
        
        // Title bar background
        ctx.fillStyle = this.style.titleBackgroundColor;
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, [this.style.cornerRadius, this.style.cornerRadius, 0, 0]);
        ctx.fill();
        
        // Title bar border with screen-space line width
        ctx.strokeStyle = this.style.borderColor;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
        
        // Title text with screen-space font size
        ctx.fillStyle = this.style.titleTextColor;
        const actualFontSize = fontSize || 12; // Use passed font size or fallback
        ctx.font = `bold ${actualFontSize}px Arial`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        
        const titleText = this.getDisplayTitle();
        const maxTitleWidth = width - 16; // Just leave some padding
        const truncatedTitle = this.truncateText(ctx, titleText, maxTitleWidth);
        
        ctx.fillText(truncatedTitle, 8, height / 2);
        
        // Collapse/expand button - removed per user request
        // this.drawCollapseButton(ctx, width - 25, height / 2);
    }
    
    /**
     * Draw collapse/expand button
     */
    drawCollapseButton(ctx, x, y) {
        const size = 8;
        
        ctx.fillStyle = this.style.titleTextColor;
        ctx.beginPath();
        
        if (this.isCollapsed) {
            // Plus sign for expand
            ctx.rect(x - 1, y - size/2, 2, size);
            ctx.rect(x - size/2, y - 1, size, 2);
        } else {
            // Minus sign for collapse
            ctx.rect(x - size/2, y - 1, size, 2);
        }
        
        ctx.fill();
    }
    
    /**
     * Draw resize handles
     */
    drawResizeHandles(ctx, lineWidth) {
        const handleSize = 8;
        const halfHandle = handleSize / 2;
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.lineWidth = lineWidth;
        
        for (const handle of this.resizeHandles) {
            if (handle.name === 'nw') continue; // Skip top-left
            
            const handleX = (handle.x * this.size[0]) - halfHandle;
            const handleY = (handle.y * this.size[1]) - halfHandle;
            
            ctx.fillRect(handleX, handleY, handleSize, handleSize);
            ctx.strokeRect(handleX, handleY, handleSize, handleSize);
        }
    }
    
    /**
     * Draw child count indicator when collapsed
     */
    drawChildCountIndicator(ctx, titleBarHeight) {
        const count = this.childNodes.size;
        if (count === 0) return;
        
        const x = this.size[0] - 35;
        const y = titleBarHeight / 2;
        
        ctx.fillStyle = 'rgba(100, 150, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = 'white';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(count.toString(), x, y);
    }
    
    /**
     * Truncate text to fit within specified width
     */
    truncateText(ctx, text, maxWidth) {
        if (ctx.measureText(text).width <= maxWidth) {
            return text;
        }
        
        while (text.length > 0 && ctx.measureText(text + '...').width > maxWidth) {
            text = text.slice(0, -1);
        }
        
        return text + '...';
    }
    
    /**
     * Handle double-click on title bar for editing
     */
    onTitleBarDoubleClick() {
        // This will be handled by the canvas interaction system
        return true;
    }
    
    /**
     * Serialize the group node for saving/network transfer
     */
    serialize() {
        const data = super.serialize ? super.serialize() : {
            id: this.id,
            type: this.type,
            pos: [...this.pos],
            size: [...this.size],
            title: this.title,
            properties: {},
            flags: this.flags
        };
        
        // Add group-specific properties
        data.properties.childNodes = Array.from(this.childNodes);
        data.properties.isCollapsed = this.isCollapsed;
        data.properties.style = { ...this.style };
        
        return data;
    }
    
    /**
     * Get undo data specific to group nodes
     */
    getUndoData() {
        const baseData = super.getUndoData();
        return {
            ...baseData,
            childNodes: Array.from(this.childNodes),
            isCollapsed: this.isCollapsed,
            style: { ...this.style }
        };
    }
    
    /**
     * Restore group state from undo data
     */
    restoreFromUndoData(data) {
        super.restoreFromUndoData && super.restoreFromUndoData(data);
        this.childNodes = new Set(data.childNodes || []);
        this.isCollapsed = data.isCollapsed || false;
        if (data.style) {
            this.style = { ...this.style, ...data.style };
        }
        this.updateBounds();
    }
    
    /**
     * Clean up when group is removed
     */
    onRemoved() {
        super.onRemoved();
        // Child nodes remain in the graph, just remove group association
        this.childNodes.clear();
    }
}

// Make GroupNode available globally
if (typeof window !== 'undefined') {
    window.GroupNode = GroupNode;
}