// ===================================
// SELECTION MANAGER
// ===================================

class SelectionManager {
    constructor() {
        this.selectedNodes = new Map();
        this.selectionRect = null;
        this.callbacks = new Set();
        this.lastSelection = new Map(); // For undo/redo
        
        // Performance optimization: cache bounding box
        this._cachedBoundingBox = null;
        this._boundingBoxDirty = true;
    }
    
    addCallback(callback) {
        this.callbacks.add(callback);
    }
    
    removeCallback(callback) {
        this.callbacks.delete(callback);
    }
    
    notifyChange() {
        // Invalidate bounding box cache when selection changes
        this._boundingBoxDirty = true;
        
        // Mark canvas dirty to ensure visual update
        if (window.app?.graphCanvas) {
            window.app.graphCanvas.dirty_canvas = true;
        }
        
        this.callbacks.forEach(callback => {
            try {
                callback(this.selectedNodes);
            } catch (error) {
                console.warn('Selection callback error:', error);
            }
        });
    }
    
    selectNode(node, addToSelection = false) {
        if (!addToSelection) {
            this.selectedNodes.clear();
        }
        this.selectedNodes.set(node.id, node);
        this.notifyChange();
    }
    
    deselectNode(node) {
        this.selectedNodes.delete(node.id);
        this.notifyChange();
    }
    
    toggleNode(node) {
        if (this.selectedNodes.has(node.id)) {
            this.deselectNode(node);
        } else {
            this.selectNode(node, true);
        }
    }
    
    selectAll(nodes) {
        this.selectedNodes.clear();
        nodes.forEach(node => this.selectedNodes.set(node.id, node));
        this.notifyChange();
    }
    
    selectInRect(nodes, rect) {
        const [x, y, width, height] = rect;
        const selectionBounds = [
            Math.min(x, x + width),
            Math.min(y, y + height),
            Math.abs(width),
            Math.abs(height)
        ];
        
        this.selectedNodes.clear();
        
        for (const node of nodes) {
            const [nx, ny, nw, nh] = node.getBoundingBox();
            
            // Check if node intersects with selection rectangle
            if (nx + nw > selectionBounds[0] && 
                nx < selectionBounds[0] + selectionBounds[2] &&
                ny + nh > selectionBounds[1] && 
                ny < selectionBounds[1] + selectionBounds[3]) {
                this.selectedNodes.set(node.id, node);
            }
        }
        
        this.notifyChange();
    }
    
    clear() {
        if (this.selectedNodes.size > 0) {
            this.selectedNodes.clear();
            this.notifyChange();
        }
    }
    
    isEmpty() {
        return this.selectedNodes.size === 0;
    }
    
    size() {
        return this.selectedNodes.size;
    }
    
    getSelectedNodes() {
        return Array.from(this.selectedNodes.values());
    }
    
    getFirstSelected() {
        return this.selectedNodes.values().next().value || null;
    }
    
    isSelected(node) {
        return this.selectedNodes.has(node.id);
    }
    
    getBoundingBox() {
        if (this.selectedNodes.size === 0) return null;
        
        // Use cached bounding box if available and not dirty
        // Note: Cache is invalidated during animations to ensure dynamic updates
        if (!this._boundingBoxDirty && this._cachedBoundingBox) {
            // Check if any selected nodes are animating (invalidates cache)
            let hasAnimatingNodes = false;
            for (const node of this.selectedNodes.values()) {
                if (node._animPos || node._gridAnimPos) {
                    hasAnimatingNodes = true;
                    break;
                }
            }
            
            if (!hasAnimatingNodes) {
                return this._cachedBoundingBox;
            }
        }
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const node of this.selectedNodes.values()) {
            // Use animated position if available, otherwise use actual position
            const pos = this.getNodePosition(node);
            
            // Calculate bounding box considering rotation
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
                
                let nodeMinX = Infinity, nodeMinY = Infinity, nodeMaxX = -Infinity, nodeMaxY = -Infinity;
                
                for (const [ox, oy] of corners) {
                    const cornerX = cx + ox * cos - oy * sin;
                    const cornerY = cy + ox * sin + oy * cos;
                    nodeMinX = Math.min(nodeMinX, cornerX);
                    nodeMinY = Math.min(nodeMinY, cornerY);
                    nodeMaxX = Math.max(nodeMaxX, cornerX);
                    nodeMaxY = Math.max(nodeMaxY, cornerY);
                }
                
                x = nodeMinX;
                y = nodeMinY;
                w = nodeMaxX - nodeMinX;
                h = nodeMaxY - nodeMinY;
            }
            
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
        }
        
        this._cachedBoundingBox = [minX, minY, maxX - minX, maxY - minY];
        this._boundingBoxDirty = false;
        return this._cachedBoundingBox;
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
    
    // Method to invalidate bounding box cache (called when nodes are moved/transformed)
    invalidateBoundingBox() {
        this._boundingBoxDirty = true;
    }
    
    getCenter() {
        const bbox = this.getBoundingBox();
        if (!bbox) return null;
        
        return [
            bbox[0] + bbox[2] / 2,
            bbox[1] + bbox[3] / 2
        ];
    }
    
    // Selection rectangle management
    startSelection(startPos) {
        this.selectionRect = {
            start: [...startPos],
            current: [...startPos],
            active: true
        };
    }
    
    updateSelection(currentPos) {
        if (!this.selectionRect || !this.selectionRect.active) return;
        this.selectionRect.current = [...currentPos];
    }
    
    getSelectionRect() {
        if (!this.selectionRect || !this.selectionRect.active) return null;
        
        const [sx, sy] = this.selectionRect.start;
        const [cx, cy] = this.selectionRect.current;
        
        return [sx, sy, cx - sx, cy - sy];
    }
    
    finishSelection(nodes) {
        if (!this.selectionRect || !this.selectionRect.active) return;
        
        const rect = this.getSelectionRect();
        if (rect && (Math.abs(rect[2]) > 5 || Math.abs(rect[3]) > 5)) {
            this.selectInRect(nodes, rect);
        }
        
        this.selectionRect = null;
    }
    
    cancelSelection() {
        this.selectionRect = null;
    }
    
    // Utility methods for multi-selection operations
    moveSelected(deltaX, deltaY) {
        for (const node of this.selectedNodes.values()) {
            node.pos[0] += deltaX;
            node.pos[1] += deltaY;
        }
    }
    
    scaleSelected(scaleX, scaleY, origin = null) {
        if (this.selectedNodes.size === 0) return;
        
        const center = origin || this.getCenter();
        if (!center) return;
        
        for (const node of this.selectedNodes.values()) {
            // Scale position relative to center
            const dx = node.pos[0] - center[0];
            const dy = node.pos[1] - center[1];
            node.pos[0] = center[0] + dx * scaleX;
            node.pos[1] = center[1] + dy * scaleY;
            
            // Scale size
            node.size[0] *= scaleX;
            node.size[1] *= scaleY;
            
            // Update aspect ratio
            node.aspectRatio = node.size[0] / node.size[1];
            
            if (node.onResize) {
                node.onResize();
            }
        }
    }
    
    rotateSelected(deltaAngle, center = null) {
        if (this.selectedNodes.size === 0) return;
        
        const rotationCenter = center || this.getCenter();
        if (!rotationCenter) return;
        
        const cos = Math.cos(deltaAngle);
        const sin = Math.sin(deltaAngle);
        
        for (const node of this.selectedNodes.values()) {
            // Rotate position around center (using node center for accuracy)
            const nodeCenterX = node.pos[0] + node.size[0] / 2;
            const nodeCenterY = node.pos[1] + node.size[1] / 2;
            const dx = nodeCenterX - rotationCenter[0];
            const dy = nodeCenterY - rotationCenter[1];
            
            const newDx = dx * cos - dy * sin;
            const newDy = dx * sin + dy * cos;
            
            node.pos[0] = rotationCenter[0] + newDx - node.size[0] / 2;
            node.pos[1] = rotationCenter[1] + newDy - node.size[1] / 2;
            
            // Apply delta to node's individual rotation
            node.rotation = (node.rotation || 0) + deltaAngle * (180 / Math.PI);
            node.rotation = node.rotation % 360;
            
            // Mark node as dirty if needed
            if (node.markDirty) {
                node.markDirty();
            }
        }
    }
    
    resetRotations() {
        if (this.selectedNodes.size === 0) return;
        
        for (const node of this.selectedNodes.values()) {
            node.rotation = 0;
            
            // Mark node as dirty if needed
            if (node.markDirty) {
                node.markDirty();
            }
        }
    }
    
    deleteSelected() {
        const nodesToDelete = this.getSelectedNodes();
        this.clear();
        return nodesToDelete;
    }
    
    duplicateSelected(offset = [20, 20]) {
        const selectedNodes = this.getSelectedNodes();
        const duplicates = [];
        
        for (const node of selectedNodes) {
            // This would need to be implemented with the node factory
            // const duplicate = NodeFactory.duplicateNode(node);
            // duplicate.pos[0] += offset[0];
            // duplicate.pos[1] += offset[1];
            // duplicates.push(duplicate);
        }
        
        return duplicates;
    }
    
    // Save/restore selection state for undo/redo
    saveState() {
        this.lastSelection = new Map(this.selectedNodes);
    }
    
    restoreState() {
        this.selectedNodes = new Map(this.lastSelection);
        this.notifyChange();
    }
    
    // Debugging
    getDebugInfo() {
        return {
            count: this.selectedNodes.size,
            nodeIds: Array.from(this.selectedNodes.keys()),
            boundingBox: this.getBoundingBox(),
            center: this.getCenter()
        };
    }
}