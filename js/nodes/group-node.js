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
        this.padding = 30; // Padding around child nodes - increased for better visual spacing
        this.minScreenPadding = 15; // Minimum padding in screen pixels
        this.titleBarHeight = 30; // Fallback height
        this.screenSpaceTitleBarHeight = 20; // Target screen-space height in pixels
        
        // Initialize size if not already set by BaseNode
        if (!this.size || !Array.isArray(this.size)) {
            this.size = [...this.expandedSize];
        }
        
        // Track already warned about deleted nodes
        this._warnedDeletedNodes = new Set();
        
        // Animation properties
        this.animatedPos = null;
        this.animatedSize = null;
        this.targetPos = null;
        this.targetSize = null;
        this.animationStartTime = null;
        this.animationDuration = 200; // ms - same as brightness transitions
        this.isAnimating = false;
        
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
        
        // Track original position for temp padding removal
        this._tempPaddingApplied = 0;
        this._lastPaddingScale = null;
        
        // Performance optimization: cache child bounds calculations
        this._cachedMinChildY = undefined;
        this._cachedChildCount = 0;
        this._cachedBoundsVersion = 0;
        this._boundsVersion = 0;
    }
    
    /**
     * Configure the group node from server data
     */
    configure(data) {
        // console.log('🔧 GroupNode.configure called with:', data);
        
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
            // console.log(`✅ Loaded ${this.childNodes.size} child nodes:`, Array.from(this.childNodes));
        } else {
            // console.log('⚠️ No childNodes in properties:', data.properties);
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
            const bounds = this.updateBounds(true); // expandOnly = true for animation
            // If bounds changed and needs sync, schedule it after animation
            if (bounds && bounds.needsSync && !this.isAnimating) {
                setTimeout(() => this.syncBoundsToServer(), 300);
            }
            return bounds;
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
        // Don't update bounds when removing - keep current size
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
            const bounds = this.updateBounds(true); // expandOnly = true for animation
            // If bounds changed and needs sync, schedule it after animation
            if (bounds && bounds.needsSync && !this.isAnimating) {
                setTimeout(() => this.syncBoundsToServer(), 300);
            }
            this.markDirty();
        }
    }
    
    /**
     * Get all child node objects
     */
    getChildNodes() {
        if (!this.graph) {
            // Try to find the graph through the global app - this is normal during initialization
            const globalGraph = window.app?.graph;
            if (!globalGraph) {
                return [];
            }
            // Use the global graph
            const childNodeIds = Array.from(this.childNodes);
            const childNodeObjects = childNodeIds
                .map(id => {
                    const node = globalGraph.getNodeById(id);
                    if (!node) {
                        if (!this._warnedDeletedNodes.has(id)) {
                            // Only log at debug level, not warn
                            console.debug(`Group ${this.id}: Removing deleted child node ${id}`);
                            this._warnedDeletedNodes.add(id);
                        }
                        // Remove the deleted node from our childNodes set
                        this.childNodes.delete(id);
                        this._needsChildNodeSync = true;
                    }
                    return node;
                })
                .filter(node => node !== null);
            
            // console.log(`📦 getChildNodes (via global): ${childNodeIds.length} IDs -> ${childNodeObjects.length} nodes found`);
            return childNodeObjects;
        }
        
        const childNodeIds = Array.from(this.childNodes);
        const childNodeObjects = childNodeIds
            .map(id => {
                const node = this.graph.getNodeById(id);
                if (!node) {
                    if (!this._warnedDeletedNodes.has(id)) {
                        // Only log at debug level, not warn
                        console.debug(`Group ${this.id}: Removing deleted child node ${id}`);
                        this._warnedDeletedNodes.add(id);
                    }
                    // Remove the deleted node from our childNodes set
                    this.childNodes.delete(id);
                    this._needsChildNodeSync = true;
                }
                return node;
            })
            .filter(node => node !== null);
        
        // console.log(`📦 getChildNodes: ${childNodeIds.length} IDs -> ${childNodeObjects.length} nodes found`);
        
        // Sync cleaned child nodes back to server if needed
        // Delay sync to avoid triggering during initial load or rapid updates
        if (this._needsChildNodeSync && !this._syncScheduled) {
            this._syncScheduled = true;
            setTimeout(() => {
                this.syncChildNodesToServer();
                this._syncScheduled = false;
            }, 1000);
        }
        
        return childNodeObjects;
    }
    
    /**
     * Sync cleaned child nodes back to server
     */
    syncChildNodesToServer() {
        if (!this._needsChildNodeSync) return;
        
        // Don't sync during initial load or if we haven't actually removed any nodes
        if (!this._hasRemovedDeletedNodes) {
            this._hasRemovedDeletedNodes = true;
            this._needsChildNodeSync = false;
            return;
        }
        
        // Send update command to sync child nodes
        if (window.app?.operationPipeline) {
            const command = new window.NodeCommands.NodePropertyCommand({
                nodeId: this.id,
                property: 'childNodes',
                value: Array.from(this.childNodes)
            });
            window.app.operationPipeline.executeCommand(command);
            
            console.debug(`📤 Synced cleaned child nodes for group ${this.id}`);
        }
        
        this._needsChildNodeSync = false;
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
        // Calculate screen-space size (viewport.scale is already in CSS pixels)
        const screenSpaceWidth = viewport ? this.size[0] * viewport.scale : this.size[0];
        const screenSpaceHeight = viewport ? this.size[1] * viewport.scale : this.size[1];
        
        // Check if group is too small in screen space for full title bar
        const minScreenSizeForTitle = 100;
        const isTooSmall = screenSpaceWidth < minScreenSizeForTitle || screenSpaceHeight < minScreenSizeForTitle;
        
        // For thin bar, use 4 screen pixels converted to world space
        const thinBarWorldHeight = viewport ? 4 / viewport.scale : 4;
        const titleBarHeight = isTooSmall ? thinBarWorldHeight : this.getScreenSpaceTitleBarHeightForViewport(viewport);
        
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
    updateBounds(expandOnly = false, useTargetPositions = false) {
        // Increment bounds version to invalidate caches
        this._boundsVersion = (this._boundsVersion || 0) + 1;
        
        if (this.isCollapsed) {
            this.size = [...this.collapsedSize];
            return {
                pos: [...this.pos],
                size: [...this.size]
            };
        }
        
        // Don't update bounds immediately after alignment animation completes
        if (this._alignmentJustCompleted) {
            const timeSinceCompletion = Date.now() - this._alignmentJustCompleted;
            if (timeSinceCompletion < 1000) { // 1 second grace period
                console.log(`Group ${this.id}: Skipping bounds update - alignment just completed`);
                
                // Schedule a deferred sync after grace period
                if (!this._deferredSyncTimeout) {
                    this._deferredSyncTimeout = setTimeout(() => {
                        delete this._alignmentJustCompleted;
                        delete this._deferredSyncTimeout;
                        // Sync bounds to server after alignment protection expires
                        this.syncBoundsToServer();
                    }, 1100); // Slightly after grace period
                }
                
                return {
                    pos: [...this.pos],
                    size: [...this.size]
                };
            } else {
                // Clear the flag after grace period
                delete this._alignmentJustCompleted;
                if (this._deferredSyncTimeout) {
                    clearTimeout(this._deferredSyncTimeout);
                    delete this._deferredSyncTimeout;
                }
            }
        }
        
        
        const childNodes = this.getChildNodes();
        
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
            
            // Skip null/undefined nodes
            if (!node || !node.pos || !node.size) {
                console.debug(`Skipping invalid child node in group ${this.id}`);
                continue;
            }
            
            const nodeMinX = node.pos[0];
            const nodeMinY = node.pos[1];
            const nodeMaxX = node.pos[0] + node.size[0];
            const nodeMaxY = node.pos[1] + node.size[1];
            
            minX = Math.min(minX, nodeMinX);
            minY = Math.min(minY, nodeMinY);
            maxX = Math.max(maxX, nodeMaxX);
            maxY = Math.max(maxY, nodeMaxY);
        }
        
        // console.log(`📐 Child bounds: min(${minX}, ${minY}) max(${maxX}, ${maxY})`);
        
        // If no valid child nodes were found, keep current size
        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
            console.warn(`⚠️ No valid child nodes found for group ${this.id}`);
            return {
                pos: [...this.pos],
                size: [...this.size]
            };
        }
        
        // Store the bounding box for later padding updates
        this._lastBoundingBox = { minX, minY, maxX, maxY };
        
        // Get viewport for calculating screen-space padding
        const viewport = this.graph?.canvas?.viewport;
        
        
        // Use viewport scale if available, otherwise use stored scale
        const scale = viewport?.scale || this._currentScale;
        
        // Calculate title bar height first to know if we're in thin mode
        let titleBarHeight = this.titleBarHeight;
        let isThinBar = false;
        
        if (scale) {
            // Check if we're in thin bar mode
            const screenSpaceWidth = this.size[0] * scale;
            const screenSpaceHeight = this.size[1] * scale;
            const minScreenSizeForTitle = 80;
            isThinBar = screenSpaceWidth < minScreenSizeForTitle || screenSpaceHeight < minScreenSizeForTitle;
            
            if (isThinBar) {
                titleBarHeight = 4 / scale; // 4 screen pixels
            } else {
                titleBarHeight = this.screenSpaceTitleBarHeight / scale;
            }
        }
        
        // Always use base padding in updateBounds
        let effectiveTopPadding = this.padding;
        
        // Calculate bounds with extra top padding when zoomed out
        const newX = minX - this.padding;
        const newY = minY - effectiveTopPadding - titleBarHeight;
        const newWidth = Math.max(maxX - minX + (this.padding * 2), this.minSize[0]);
        const newHeight = Math.max(maxY - minY + effectiveTopPadding + this.padding + titleBarHeight, this.minSize[1]);
        
        
        
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
            
            // Check if bounds actually changed
            const boundsChanged = 
                Math.abs(this.pos[0] - finalLeft) > 0.1 ||
                Math.abs(this.pos[1] - finalTop) > 0.1 ||
                Math.abs(this.size[0] - finalWidth) > 0.1 ||
                Math.abs(this.size[1] - finalHeight) > 0.1;
            
            // console.log(`📐 Expand only - animating to: pos[${finalLeft}, ${finalTop}] size[${finalWidth}, ${finalHeight}]`);
            
            // Check if we're being animated by alignment system
            if (this._animPos || this._gridAnimPos || this._animSize || this._gridAnimSize) {
                // Don't interfere with alignment animation
                // Just return the calculated bounds without animating
            } else {
                // Start animation to new bounds WITHOUT immediately setting pos/size
                this.animateToBounds(finalLeft, finalTop, finalWidth, finalHeight);
            }
            
            // Return target bounds for server sync
            return {
                pos: [finalLeft, finalTop],
                size: [finalWidth, finalHeight],
                needsSync: boundsChanged // Track if sync is needed
            };
        } else {
            // Animate to new bounds for smooth transition
            // console.log(`📐 Animating from: pos[${this.pos[0]}, ${this.pos[1]}] size[${this.size[0]}, ${this.size[1]}]`);
            // console.log(`📐 Animating to: pos[${newX}, ${newY}] size[${newWidth}, ${newHeight}]`);
            
            // Check if bounds actually changed
            let boundsChanged = 
                Math.abs(this.pos[0] - newX) > 0.1 ||
                Math.abs(this.pos[1] - newY) > 0.1 ||
                Math.abs(this.size[0] - newWidth) > 0.1 ||
                Math.abs(this.size[1] - newHeight) > 0.1;
            
            if (boundsChanged) {
                // Check if we're being animated by alignment system
                if (this._animPos || this._gridAnimPos || this._animSize || this._gridAnimSize) {
                    // Don't interfere with alignment animation
                    // Just return the calculated bounds without animating
                } else {
                    // Start animation to new bounds
                    this.animateToBounds(newX, newY, newWidth, newHeight);
                }
            }
            
            // Return target bounds
            return {
                pos: [newX, newY],
                size: [newWidth, newHeight],
                needsSync: boundsChanged // Track if sync is needed
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
        
        // Register this group as animating
        // Try to get canvas reference from graph or use global app
        let canvas = this.graph?.canvas || window.app?.graphCanvas;
        
        if (canvas?._animatingGroups) {
            canvas._animatingGroups.add(this.id);
        }
        
        // Mark dirty to trigger redraws during animation
        this.markDirty();
    }
    
    /**
     * Update animation state
     * @returns {boolean} true if still animating
     */
    updateAnimation() {
        if (!this.animationStartTime || !this.targetPos || !this.targetSize) {
            this.isAnimating = false;
            return false;
        }
        
        // Mark as animating to prevent position sync conflicts
        this.isAnimating = true;
        
        const now = Date.now();
        const elapsed = now - this.animationStartTime;
        const progress = Math.min(elapsed / this.animationDuration, 1);
        
        // Cubic ease-out (same as other animations)
        const eased = 1 - Math.pow(1 - progress, 3);
        
        // Interpolate position - update silently without triggering sync
        const oldPos = [...this.pos];
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
            this.isAnimating = false;
            
            // Unregister from animating groups
            let canvas = this.graph?.canvas || window.app?.graphCanvas;
            if (canvas?._animatingGroups) {
                canvas._animatingGroups.delete(this.id);
            }
            
            // Log completion for debugging
            // console.log(`Group ${this.id} animation complete at pos[${this.pos[0]}, ${this.pos[1]}]`);
            
            // Sync to server after animation completes
            setTimeout(() => {
                this.syncBoundsToServer();
            }, 50); // Small delay to ensure render completes
            
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
        // console.log(`🚀 moveChildNodes called with delta: ${deltaX}, ${deltaY}`);
        // console.log(`   Group ${this.id} has ${this.childNodes.size} child IDs:`, Array.from(this.childNodes));
        
        const childNodes = this.getChildNodes();
        // console.log(`   Found ${childNodes.length} actual child nodes`);
        
        for (const node of childNodes) {
            if (node === this) continue; // Skip self
            // console.log(`   Moving child ${node.id} from [${node.pos[0]}, ${node.pos[1]}]`);
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
        
        // Get viewport for screen space calculations
        const viewport = this.graph?.canvas?.viewport;
        const screenSpaceWidth = viewport ? this.size[0] * viewport.scale : this.size[0];
        const screenSpaceHeight = viewport ? this.size[1] * viewport.scale : this.size[1];
        
        // Check if group is too small in screen space for full title bar
        const minScreenSizeForTitle = 80;
        const isTooSmall = screenSpaceWidth < minScreenSizeForTitle || screenSpaceHeight < minScreenSizeForTitle;
        
        // For thin bar, use 4 screen pixels converted to world space
        const thinBarWorldHeight = viewport ? 4 / viewport.scale : 4;
        const titleBarHeight = isTooSmall ? thinBarWorldHeight : this.titleBarHeight;
        
        // Use base padding
        let topPadding = this.padding;
        
        // Check if node center is within group bounds (excluding title bar and top padding)
        const nodeCenterX = node.pos[0] + node.size[0] / 2;
        const nodeCenterY = node.pos[1] + node.size[1] / 2;
        
        const groupContentArea = {
            left: this.pos[0],
            top: this.pos[1] + titleBarHeight + topPadding,
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
    onDrawForeground(ctx, titleBarHeight = null, lineWidth = null, fontSize = null, passedViewport = null) {
        ctx.save();
        
        // Use passed viewport or try to get it from graph
        const viewport = passedViewport || this.graph?.canvas?.viewport;
        
        // Temporary padding adjustment based on zoom - only check when zoom changes
        const PADDING_ENABLED = false; // Disabled for performance - was causing continuous calculations
        if (PADDING_ENABLED && viewport && !this.isCollapsed && this.childNodes.size > 0) {
            // Only process when zoom changes significantly (more aggressive threshold)
            if (!this._lastPaddingScale || Math.abs(viewport.scale - this._lastPaddingScale) > 0.1) {
                this._lastPaddingScale = viewport.scale;
                
                // Use the current size to determine title bar mode (before any adjustments)
                const screenSpaceWidth = this.size[0] * viewport.scale;
                const screenSpaceHeight = this.size[1] * viewport.scale;
                const minScreenSizeForTitle = 80;
                const isThinBar = screenSpaceWidth < minScreenSizeForTitle || screenSpaceHeight < minScreenSizeForTitle;
                
                // Calculate actual title bar height in world space
                let actualTitleBarHeight;
                if (isThinBar) {
                    actualTitleBarHeight = 4 / viewport.scale; // 4 screen pixels
                } else {
                    actualTitleBarHeight = this.screenSpaceTitleBarHeight / viewport.scale; // 20 screen pixels
                }
                
                // We want 10 screen pixels from bottom of title bar
                const targetScreenGap = 10;
                const requiredWorldGap = targetScreenGap / viewport.scale;
                
                // Find topmost child Y position - use cached value if available
                let minChildY = Infinity;
                
                // Check if we have a cached value that's still valid
                if (this._cachedMinChildY !== undefined && 
                    this._cachedChildCount === this.childNodes.size &&
                    this._cachedBoundsVersion === this._boundsVersion) {
                    minChildY = this._cachedMinChildY;
                } else {
                    // Calculate and cache
                    const graph = this.graph || window.app?.graph;
                    if (graph) {
                        for (const nodeId of this.childNodes) {
                            const node = graph.getNodeById(nodeId);
                            if (node && node.pos) {
                                minChildY = Math.min(minChildY, node.pos[1]);
                            }
                        }
                    }
                    // Cache the result
                    this._cachedMinChildY = minChildY;
                    this._cachedChildCount = this.childNodes.size;
                    this._cachedBoundsVersion = this._boundsVersion || 0;
                }
                
                if (minChildY !== Infinity) {
                    // Calculate current gap from bottom of title bar
                    // Use original position if we have temp padding applied
                    const effectiveY = this._tempPaddingApplied ? 
                        this.pos[1] + this._tempPaddingApplied : this.pos[1];
                    const titleBarBottom = effectiveY + actualTitleBarHeight;
                    const currentGap = minChildY - titleBarBottom;
                    const currentScreenGap = currentGap * viewport.scale;
                    
                    // If current screen gap is less than target, adjust
                    if (currentScreenGap < targetScreenGap - 1) { // Small tolerance to prevent oscillation
                        const extraPadding = requiredWorldGap - currentGap;
                        
                        if (!this._tempPaddingApplied) {
                            // Apply temporary padding by shifting group up
                            this.pos[1] -= extraPadding;
                            this.size[1] += extraPadding;
                            this._tempPaddingApplied = extraPadding;
                        } else if (Math.abs(extraPadding - this._tempPaddingApplied) > 1) {
                            // Significant change needed
                            const diff = extraPadding - this._tempPaddingApplied;
                            this.pos[1] -= diff;
                            this.size[1] += diff;
                            this._tempPaddingApplied = extraPadding;
                        }
                    } else if (this._tempPaddingApplied && currentScreenGap > targetScreenGap + 5) {
                        // Remove padding only when we have significant excess gap
                        this.pos[1] += this._tempPaddingApplied;
                        this.size[1] -= this._tempPaddingApplied;
                        this._tempPaddingApplied = 0;
                    }
                }
            }
        }
        
        // Calculate screen space dimensions once (reuse if already calculated for padding)
        let screenSpaceWidth, screenSpaceHeight;
        if (this._lastPaddingScale === viewport?.scale) {
            // Reuse calculations from padding check
            screenSpaceWidth = this.size[0] * (viewport?.scale || 1);
            screenSpaceHeight = this.size[1] * (viewport?.scale || 1);
        } else {
            // Calculate fresh
            screenSpaceWidth = viewport ? this.size[0] * viewport.scale : this.size[0];
            screenSpaceHeight = viewport ? this.size[1] * viewport.scale : this.size[1];
        }
        
        // Check if group is too small in screen space for full title bar
        const minScreenSizeForTitle = 80; // Minimum screen pixels to show title
        const isTooSmall = screenSpaceWidth < minScreenSizeForTitle || screenSpaceHeight < minScreenSizeForTitle;
        
        // Debug log when state changes
        if (this._wasTooSmall !== isTooSmall) {
            console.log(`Group ${this.id}: Thin bar mode ${isTooSmall ? 'ON' : 'OFF'} - screen size: ${screenSpaceWidth.toFixed(1)}x${screenSpaceHeight.toFixed(1)}px (scale=${viewport?.scale})`);
            this._wasTooSmall = isTooSmall;
        }
        
        // Use provided values or calculate based on size
        let actualTitleBarHeight;
        if (isTooSmall) {
            // For thin bar, use 4 screen pixels converted to world space
            actualTitleBarHeight = viewport ? 4 / viewport.scale : 4;
        } else {
            // Use the provided screen-space height or fallback
            actualTitleBarHeight = titleBarHeight || this.titleBarHeight;
        }
        
        const actualLineWidth = lineWidth || this.style.borderWidth;
        const actualFontSize = fontSize || 12;
        
        // Draw main group background (only if expanded)
        if (!this.isCollapsed) {
            this.drawGroupBackground(ctx, actualTitleBarHeight, actualLineWidth);
            
        }
        
        // Draw title bar
        this.drawTitleBar(ctx, actualTitleBarHeight, actualLineWidth, actualFontSize, isTooSmall);
        
        // Draw resize handles (only if expanded and selected and not animating)
        if (!this.isCollapsed && this.graph?.canvas?.selection?.isSelected(this)) {
            // Check if alignment is animating
            const alignmentManager = this.graph?.canvas?.alignmentManager;
            if (!alignmentManager || (!alignmentManager.isActive() && !alignmentManager.isAnimating())) {
                this.drawResizeHandles(ctx, actualLineWidth);
            }
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
        
        // Check if we're using thin title bar
        // Compare with a small threshold since floating point
        const viewport = this.graph?.canvas?.viewport;
        const thinBarWorldHeight = viewport ? 4 / viewport.scale : 4;
        const isThinBar = Math.abs(titleBarHeight - thinBarWorldHeight) < 0.01;
        
        // Background with rounded corners
        ctx.fillStyle = this.style.backgroundColor;
        ctx.beginPath();
        
        if (isThinBar) {
            // Simple rectangle for thin bar mode
            ctx.rect(x, y, width, height);
        } else {
            // Rounded corners for normal mode
            ctx.roundRect(x, y, width, height, [0, 0, this.style.cornerRadius, this.style.cornerRadius]);
        }
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
    drawTitleBar(ctx, titleBarHeight, lineWidth, fontSize = null, isTooSmall = false) {
        const x = 0;
        const y = 0;
        const width = this.size[0];
        const height = titleBarHeight;
        
        // Title bar background
        ctx.fillStyle = isTooSmall ? 'rgba(100, 100, 100, 0.8)' : this.style.titleBackgroundColor;
        ctx.beginPath();
        
        if (isTooSmall) {
            // Simple rectangle for thin bar
            ctx.rect(x, y, width, height);
        } else {
            // Rounded corners for normal title bar
            ctx.roundRect(x, y, width, height, [this.style.cornerRadius, this.style.cornerRadius, 0, 0]);
        }
        ctx.fill();
        
        // Title bar border with screen-space line width
        ctx.strokeStyle = this.style.borderColor;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
        
        // Only draw title text if not too small
        if (!isTooSmall) {
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
        }
        
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

    /**
     * Sync current bounds to server
     */
    syncBoundsToServer() {
        // Try to get graph reference
        const graph = this.graph || window.app?.graph;
        
        if (!graph || !window.NodeCommands) {
            // console.warn('Cannot sync bounds - graph or NodeCommands not available');
            return;
        }

        // Don't sync if we're still animating
        if (this.isAnimating || this._animPos || this._gridAnimPos) {
            console.log(`Group ${this.id}: Skipping sync - still animating`);
            return;
        }

        // Don't sync during alignment completion grace period
        if (this._alignmentJustCompleted) {
            const timeSinceCompletion = Date.now() - this._alignmentJustCompleted;
            if (timeSinceCompletion < 1000) {
                console.log(`Group ${this.id}: Skipping sync - alignment just completed`);
                return;
            }
        }

        console.log(`Group ${this.id}: Syncing bounds to server - pos: [${this.pos[0].toFixed(1)}, ${this.pos[1].toFixed(1)}], size: [${this.size[0].toFixed(1)}, ${this.size[1].toFixed(1)}]`);

        // Create group resize command
        const command = new window.NodeCommands.GroupNodeCommand({
            action: 'group_resize',
            groupId: this.id,
            size: [...this.size],
            position: [...this.pos]
        });

        // Execute command through operation pipeline
        if (window.app?.operationPipeline) {
            window.app.operationPipeline.executeCommand(command);
        }
    }
}

// Make GroupNode available globally
if (typeof window !== 'undefined') {
    window.GroupNode = GroupNode;
}