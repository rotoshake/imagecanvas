// ===================================
// HANDLE DETECTOR
// ===================================

class HandleDetector {
    constructor(viewport, selection) {
        this.viewport = viewport;
        this.selection = selection;
    }
    
    getNodeAtPosition(x, y, nodes) {
        // Check from top to bottom (reverse order for proper layering)
        for (let i = nodes.length - 1; i >= 0; i--) {
            const node = nodes[i];
            if (node.containsPoint(x, y)) {
                return node;
            }
        }
        return null;
    }
    
    getResizeHandle(x, y) {
        const selectedNodes = this.selection.getSelectedNodes();
        
        // Check multi-selection bounding box handle first
        if (selectedNodes.length > 1) {
            const bbox = this.selection.getBoundingBox();
            if (bbox && this.isSelectionBoxHandle(x, y, bbox)) {
                return { 
                    type: 'multi-resize', 
                    nodes: selectedNodes,
                    bbox: bbox
                };
            }
        }
        
        // Check individual node handles (prioritize selected nodes)
        const candidates = [...selectedNodes, ...this.getUnselectedNodes(selectedNodes)];
        
        for (const node of candidates) {
            if (this.isNodeResizeHandle(x, y, node)) {
                return { 
                    type: 'single-resize', 
                    node: node,
                    isMultiContext: selectedNodes.length > 1 && this.selection.isSelected(node)
                };
            }
        }
        
        return null;
    }
    
    getRotationHandle(x, y) {
        const selectedNodes = this.selection.getSelectedNodes();
        
        // Check multi-selection rotation handle first
        if (selectedNodes.length > 1) {
            const bbox = this.selection.getBoundingBox();
            if (bbox && this.isSelectionRotationHandle(x, y, bbox)) {
                return { 
                    type: 'multi-rotation', 
                    nodes: selectedNodes,
                    center: this.selection.getCenter()
                };
            }
        }
        
        // Check individual node rotation handles
        for (const node of selectedNodes) {
            if (this.isNodeRotationHandle(x, y, node)) {
                return { 
                    type: 'single-rotation', 
                    node: node,
                    center: node.getCenter(),
                    isMultiContext: selectedNodes.length > 1
                };
            }
        }
        
        return null;
    }
    
    getUnselectedNodes(selectedNodes) {
        const selectedIds = new Set(selectedNodes.map(n => n.id));
        return this.viewport.canvas?.graph?.nodes?.filter(n => !selectedIds.has(n.id)) || [];
    }
    
    isNodeResizeHandle(x, y, node) {
        if (!this.shouldShowHandles(node)) return false;
        
        const [screenX, screenY] = this.getRotatedCorner(node, 'br');
        const [centerX, centerY] = this.viewport.convertGraphToOffset(...node.getCenter());
        
        // Calculate inward offset from corner
        const inward = 10;
        const dx = screenX - centerX;
        const dy = screenY - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / dist;
        const ny = dy / dist;
        
        const hitX = screenX - nx * inward;
        const hitY = screenY - ny * inward;
        
        return Utils.distance(x, y, hitX, hitY) <= CONFIG.HANDLES.SIZE;
    }
    
    isNodeRotationHandle(x, y, node) {
        if (!this.shouldShowHandles(node)) return false;
        
        const [screenX, screenY] = this.getRotatedCorner(node, 'br');
        const distance = Utils.distance(x, y, screenX, screenY);
        
        // Check if within rotation handle area but outside resize area
        const inRotationArea = distance < CONFIG.HANDLES.ROTATION_DISTANCE && 
                              distance > CONFIG.HANDLES.MIN_ROTATION_DISTANCE;
        
        // Make sure we're not clicking on the node itself
        const graphPos = this.viewport.convertOffsetToGraph(x, y);
        const notOnNode = !node.containsPoint(graphPos[0], graphPos[1]);
        
        return inRotationArea && notOnNode;
    }
    
    isSelectionBoxHandle(x, y, bbox) {
        if (!bbox) return false;
        
        const [minX, minY, width, height] = bbox;
        const [sx, sy] = this.viewport.convertGraphToOffset(minX, minY);
        const sw = width * this.viewport.scale;
        const sh = height * this.viewport.scale;
        
        const margin = 8;
        const handleSize = 20;
        
        // Bottom-right corner of bounding box
        const brX = sx + sw + margin;
        const brY = sy + sh + margin;
        
        return x >= brX - handleSize && x <= brX &&
               y >= brY - handleSize && y <= brY;
    }
    
    isSelectionRotationHandle(x, y, bbox) {
        if (!bbox) return false;
        
        const [minX, minY, width, height] = bbox;
        const [sx, sy] = this.viewport.convertGraphToOffset(minX, minY);
        const sw = width * this.viewport.scale;
        const sh = height * this.viewport.scale;
        
        const margin = 8;
        const offset = 16;
        
        // Position relative to bounding box corner
        const brX = sx + sw + margin;
        const brY = sy + sh + margin;
        const hx = brX + offset;
        const hy = brY + offset;
        
        return Utils.distance(x, y, hx, hy) <= 12;
    }
    
    shouldShowHandles(node) {
        if (!node) return false;
        
        const nodeWidth = node.size[0] * this.viewport.scale;
        const nodeHeight = node.size[1] * this.viewport.scale;
        
        return nodeWidth >= CONFIG.HANDLES.MIN_NODE_SIZE && 
               nodeHeight >= CONFIG.HANDLES.MIN_NODE_SIZE;
    }
    
    getRotatedCorner(node, corner = 'br') {
        const angle = (node.rotation || 0) * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        
        // Use animated position if available, otherwise use actual position
        const pos = this.getNodePosition(node);
        const cx = pos[0] + node.size[0] / 2;
        const cy = pos[1] + node.size[1] / 2;
        
        // Calculate local corner offset
        let lx = node.size[0] / 2;
        let ly = node.size[1] / 2;
        
        switch (corner) {
            case 'tl': lx = -lx; ly = -ly; break;
            case 'tr': ly = -ly; break;
            case 'bl': lx = -lx; break;
            case 'br': break; // already correct
        }
        
        // Apply rotation
        const wx = cx + lx * cos - ly * sin;
        const wy = cy + lx * sin + ly * cos;
        
        return this.viewport.convertGraphToOffset(wx, wy);
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
    
    // Utility methods for different handle types
    getHandleAtPosition(x, y) {
        // Check rotation handles first (they're usually further from the node)
        const rotationHandle = this.getRotationHandle(x, y);
        if (rotationHandle) {
            return { ...rotationHandle, handleType: 'rotation' };
        }
        
        // Then check resize handles
        const resizeHandle = this.getResizeHandle(x, y);
        if (resizeHandle) {
            return { ...resizeHandle, handleType: 'resize' };
        }
        
        return null;
    }
    
    getCursor(x, y) {
        const handle = this.getHandleAtPosition(x, y);
        
        if (handle) {
            switch (handle.handleType) {
                case 'resize':
                    // For single node resize, adjust cursor based on rotation
                    if (handle.type === 'single-resize' && handle.node && handle.node.rotation) {
                        const rotation = ((handle.node.rotation % 360) + 360) % 360; // Normalize to 0-360
                        
                        // Map rotation to 8 cursor directions (every 45 degrees)
                        if (rotation >= 337.5 || rotation < 22.5) {
                            return 'se-resize'; // 0°
                        } else if (rotation >= 22.5 && rotation < 67.5) {
                            return 's-resize'; // 45°
                        } else if (rotation >= 67.5 && rotation < 112.5) {
                            return 'sw-resize'; // 90°
                        } else if (rotation >= 112.5 && rotation < 157.5) {
                            return 'w-resize'; // 135°
                        } else if (rotation >= 157.5 && rotation < 202.5) {
                            return 'nw-resize'; // 180°
                        } else if (rotation >= 202.5 && rotation < 247.5) {
                            return 'n-resize'; // 225°
                        } else if (rotation >= 247.5 && rotation < 292.5) {
                            return 'ne-resize'; // 270°
                        } else {
                            return 'e-resize'; // 315°
                        }
                    }
                    return 'se-resize';
                case 'rotation':
                    return 'pointer';
            }
        }
        
        return 'default';
    }
    
    // Debug information
    getDebugInfo(x, y) {
        const selectedNodes = this.selection.getSelectedNodes();
        const nodeAtPos = this.getNodeAtPosition(
            ...this.viewport.convertOffsetToGraph(x, y), 
            this.viewport.canvas?.graph?.nodes || []
        );
        
        return {
            mousePos: [x, y],
            graphPos: this.viewport.convertOffsetToGraph(x, y),
            nodeAtPos: nodeAtPos?.id || null,
            selectedCount: selectedNodes.length,
            resizeHandle: !!this.getResizeHandle(x, y),
            rotationHandle: !!this.getRotationHandle(x, y),
            shouldShowHandles: nodeAtPos ? this.shouldShowHandles(nodeAtPos) : false
        };
    }
}

// Make HandleDetector available globally
if (typeof window !== 'undefined') {
    window.HandleDetector = HandleDetector;
}