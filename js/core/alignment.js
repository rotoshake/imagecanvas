// ===================================
// AUTO ALIGNMENT SYSTEM
// ===================================

class AutoAlignmentManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.viewport = canvas.viewport;
        this.selection = canvas.selection;
        
        // Animation timing
        this.lastUpdateTime = 0;
        
        // Performance tracking for large-scale animations
        this.animationFrameStartTime = 0;
        this.animationNodeIndex = 0;  // For batched processing
        
        // Auto-align state
        this.autoAlignMode = false;
        this.autoAlignStart = [0, 0];
        this.autoAlignOriginalClick = [0, 0];
        this.autoAlignHasLeftCircle = false;
        this.autoAlignAxis = null;
        this.autoAlignTargets = null;
        this.autoAlignOriginals = null;
        this.autoAlignMasterOrder = null;
        this.autoAlignDominantAxis = null;
        this.autoAlignIsReorderMode = false;
        this.autoAlignCommitted = false;
        this.autoAlignCommittedAxis = null;
        this.autoAlignCommittedTargets = null;
        this.autoAlignCommittedDirection = null;
        this.autoAlignCommitPoint = [0, 0];
        this.autoAlignAnimating = false;
        this.autoAlignAnimNodes = null;
        this.autoAlignAnimTargets = null;
        
        // Grid align state
        this.gridAlignMode = false;
        this.gridAlignDragging = false;
        this.gridAlignAnchor = null;
        this.gridAlignBox = null;
        this.gridAlignColumns = 1;
        this.gridAlignTargets = null;
        this.gridAlignAnimating = false;
        this.gridAlignAnimNodes = null;
        this.gridAlignAnimTargets = null;
        this.gridAlignInteractionSaved = false;
    }
    
    // ===================================
    // AUTO ALIGNMENT
    // ===================================
    
    startAutoAlign(startPos) {
        if (this.selection.size() < 2) return false;
        

        this.autoAlignMode = true;
        this.autoAlignStart = [...startPos];
        this.autoAlignOriginalClick = [...startPos];
        this.autoAlignHasLeftCircle = false;
        this.autoAlignAxis = null;
        this.autoAlignTargets = null;
        this.autoAlignCommitted = false;
        this.autoAlignCommittedAxis = null;
        this.autoAlignCommittedTargets = null;
        this.autoAlignCommittedDirection = null;
        this.autoAlignCommitPoint = [...startPos];
        this.autoAlignIsReorderMode = false;
        
        // Store original positions
        const selectedNodes = this.selection.getSelectedNodes();
        this.autoAlignOriginals = {};
        for (const node of selectedNodes) {
            this.autoAlignOriginals[node.id] = [...node.pos];
            if (!node._animPos) node._animPos = [...node.pos];
            if (!node._animVel) node._animVel = [0, 0];
        }
        
        window.app.undoManager.beginInteraction(selectedNodes);
        return true;
    }
    
    updateAutoAlign(currentPos) {
        if (!this.autoAlignMode) return;

        
        const threshold = 40 / this.viewport.scale;
        const dx = currentPos[0] - this.autoAlignStart[0];
        const dy = currentPos[1] - this.autoAlignStart[1];
        
        let axis = null;
        let direction = null;
        
        if (Math.abs(dx) > Math.abs(dy)) {
            axis = 'horizontal';
            direction = dx > 0 ? 1 : -1;
        } else if (Math.abs(dy) > Math.abs(dx)) {
            axis = 'vertical';
            direction = dy > 0 ? 1 : -1;
        }
        
        if (!this.autoAlignCommitted) {
            const cdx = currentPos[0] - this.autoAlignCommitPoint[0];
            const cdy = currentPos[1] - this.autoAlignCommitPoint[1];
            
            let commitAxis = null, commitDir = null;
            if (Math.abs(cdx) > Math.abs(cdy)) {
                commitAxis = 'horizontal';
                commitDir = cdx > 0 ? 1 : -1;
            } else if (Math.abs(cdy) > Math.abs(cdx)) {
                commitAxis = 'vertical';
                commitDir = cdy > 0 ? 1 : -1;
            }
            
            if ((commitAxis === 'horizontal' && Math.abs(cdx) > threshold) || 
                (commitAxis === 'vertical' && Math.abs(cdy) > threshold)) {
                

                
                this.autoAlignCommitted = true;
                this.autoAlignCommittedAxis = commitAxis;
                this.autoAlignCommittedDirection = commitDir;
                
                // Check if images are already aligned on this axis
                const alreadyAligned = this.areImagesAlignedOnAxis(commitAxis);
                
                if (alreadyAligned) {
                    this.autoAlignIsReorderMode = true;
                } else {
                    this.autoAlignIsReorderMode = false;
                }
                
                this.triggerAutoAlign(commitAxis);
                this.autoAlignCommittedTargets = this.autoAlignAnimTargets;
                this.autoAlignCommitPoint = [...currentPos];
            } else {
                // Not committed, keep nodes at original positions
                const selectedNodes = this.selection.getSelectedNodes();
                for (const node of selectedNodes) {
                    node._animPos = [...(this.autoAlignOriginals[node.id] || node.pos)];
                    node._animVel = [0, 0];
                }
                this.canvas.dirty_canvas = true;
                return;
            }
        } else {
            // After commit, check for axis switching
            const homeRadius = 100 / this.viewport.scale;
            const distanceFromHome = Math.sqrt(
                Math.pow(currentPos[0] - this.autoAlignOriginalClick[0], 2) +
                Math.pow(currentPos[1] - this.autoAlignOriginalClick[1], 2)
            );
            
            if (distanceFromHome > homeRadius) {
                this.autoAlignHasLeftCircle = true;
            }
            
            const cdx = currentPos[0] - this.autoAlignCommitPoint[0];
            const cdy = currentPos[1] - this.autoAlignCommitPoint[1];
            const currentAxis = Math.abs(cdx) > Math.abs(cdy) ? 'horizontal' : 'vertical';
            const currentDirection = currentAxis === 'horizontal' ? Math.sign(cdx) : Math.sign(cdy);
            
            const directionThreshold = 40 / this.viewport.scale;
            if (distanceFromHome > homeRadius && 
                (currentAxis !== this.autoAlignCommittedAxis || 
                (Math.abs(cdx) > directionThreshold && Math.sign(cdx) !== this.autoAlignCommittedDirection) ||
                (Math.abs(cdy) > directionThreshold && Math.sign(cdy) !== this.autoAlignCommittedDirection))) {
                
                // Check if switching to reorder mode
                const switchingToReorder = this.areImagesAlignedOnAxis(currentAxis);
                
                if (switchingToReorder) {
                    this.autoAlignIsReorderMode = true;
                } else {
                    this.autoAlignIsReorderMode = false;
                }
                this.autoAlignCommittedAxis = currentAxis;
                this.autoAlignCommittedDirection = currentDirection;
                this.triggerAutoAlign(currentAxis);
                this.autoAlignCommittedTargets = this.autoAlignAnimTargets;
                this.autoAlignCommitPoint = [...currentPos];
                
                // DISABLED: Undo state is now handled by the OperationPipeline when drag completes
                // This prevents intermediate undo entries during alignment
                // this.canvas.pushUndoState();
            }
        }
        
        this.canvas.dirty_canvas = true;
    }
    
    finishAutoAlign() {
        if (this.autoAlignCommittedAxis && this.autoAlignCommittedTargets) {
            // Use the same pattern as finishGridAlign to ensure nodeIds and positions match
            const selectedNodes = this.selection.getSelectedNodes();
            const nodeIds = [];
            const positions = [];
            
            for (const node of selectedNodes) {
                if (this.autoAlignCommittedTargets[node.id]) {
                    nodeIds.push(node.id);
                    positions.push(this.autoAlignCommittedTargets[node.id]);
                }
            }
            

            window.app.undoManager.endInteraction('node_align', { 
                nodeIds, 
                positions, 
                axis: this.autoAlignCommittedAxis 
            });
        } else {
            // No alignment was committed, so cancel the interaction
            window.app.undoManager.cancelInteraction();
        }

        this.autoAlignMode = false;
        this.autoAlignAxis = null;
        this.autoAlignTargets = null;
        this.autoAlignOriginals = null;
        this.autoAlignMasterOrder = null;
        this.autoAlignDominantAxis = null;
        this.autoAlignIsReorderMode = false;
        this.autoAlignCommitted = false;
        this.autoAlignCommittedAxis = null;
        this.autoAlignCommittedTargets = null;
        this.autoAlignCommittedDirection = null;
        this.canvas.dirty_canvas = true;
    }
    
    triggerAutoAlign(axis) {
        if (this.selection.size() < 2) {
            return;
        }
        

        // Store original positions if not already set
        if (!this.autoAlignOriginals) {
            this.autoAlignOriginals = {};
            const selectedNodes = this.selection.getSelectedNodes();
            for (const node of selectedNodes) {
                this.autoAlignOriginals[node.id] = [...node.pos];
            }
        }
        
        // Determine master order if not set
        if (!this.autoAlignMasterOrder) {
            const selectedNodes = this.selection.getSelectedNodes();
            
            // Calculate bounding box
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const node of selectedNodes) {
                const orig = this.autoAlignOriginals[node.id] || node.pos;
                minX = Math.min(minX, orig[0]);
                minY = Math.min(minY, orig[1]);
                maxX = Math.max(maxX, orig[0] + node.size[0]);
                maxY = Math.max(maxY, orig[1] + node.size[1]);
            }
            
            const width = maxX - minX;
            const height = maxY - minY;
            const isVerticalDominant = height > width;
            
            // Sort by dominant axis
            const masterOrder = [...selectedNodes].sort((a, b) => {
                const aOrig = this.autoAlignOriginals[a.id] || a.pos;
                const bOrig = this.autoAlignOriginals[b.id] || b.pos;
                
                if (isVerticalDominant) {
                    return aOrig[1] - bOrig[1];
                } else {
                    return aOrig[0] - bOrig[0];
                }
            });
            
            this.autoAlignMasterOrder = masterOrder.map(n => n.id);
            this.autoAlignDominantAxis = isVerticalDominant ? 'vertical' : 'horizontal';
        }
        
        // Calculate center of selection
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const selectedNodes = this.selection.getSelectedNodes();
        for (const node of selectedNodes) {
            minX = Math.min(minX, node.pos[0]);
            minY = Math.min(minY, node.pos[1]);
            maxX = Math.max(maxX, node.pos[0] + node.size[0]);
            maxY = Math.max(maxY, node.pos[1] + node.size[1]);
        }
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        this.autoAlignStart = [centerX, centerY];
        
        // Initialize animation positions
        for (const node of selectedNodes) {
            if (!this.autoAlignAnimating || !node._animPos) {
                node._animPos = [...node.pos];
            }
            node._animVel = [0, 0];
        }
        
        // Calculate targets
        let targets;
        if (axis === 'original') {
            targets = this.autoAlignOriginals;
        } else {
            targets = this.computeAutoAlignTargetsWithMasterOrder(axis);
        }

        this.autoAlignAnimating = true;
        this.autoAlignAnimNodes = selectedNodes;
        this.autoAlignAnimTargets = targets;
    }
    
    computeAutoAlignTargetsWithMasterOrder(axis) {
        const selectedNodes = this.selection.getSelectedNodes();
        const originals = this.autoAlignOriginals || {};
        const masterOrder = this.autoAlignMasterOrder || [];
        
        // Sort nodes according to master order
        let sortedNodes = masterOrder.map(id => selectedNodes.find(n => n.id === id)).filter(Boolean);
        

        
        // If in reorder mode, reverse the order
        if (this.autoAlignIsReorderMode) {
            sortedNodes = sortedNodes.reverse();
        }
        
        // For reorder mode, we want to keep nodes on the same alignment line
        // but rearrange them according to the new order
        if (this.autoAlignIsReorderMode && sortedNodes.length > 0) {
            // Get the current positions to find the alignment line and bounds
            let alignmentCoord = 0;
            let minPos = Infinity;
            let maxPos = -Infinity;
            
            for (const node of sortedNodes) {
                if (axis === 'horizontal') {
                    alignmentCoord += node.pos[1];
                    minPos = Math.min(minPos, node.pos[0]);
                    maxPos = Math.max(maxPos, node.pos[0] + node.size[0]);
                } else {
                    alignmentCoord += node.pos[0];
                    minPos = Math.min(minPos, node.pos[1]);
                    maxPos = Math.max(maxPos, node.pos[1] + node.size[1]);
                }
            }
            alignmentCoord /= sortedNodes.length;
            
            // Calculate total size with new order
            const totalSize = sortedNodes.reduce((sum, n) => sum + (axis === 'horizontal' ? n.size[0] : n.size[1]), 0);
            const gap = CONFIG.ALIGNMENT.DEFAULT_MARGIN;
            const totalLength = totalSize + gap * (sortedNodes.length - 1);
            
            // Start from the leftmost/topmost position of current arrangement
            let pos = minPos;
            const targets = {};
            
            for (const node of sortedNodes) {
                if (axis === 'horizontal') {
                    targets[node.id] = [pos, alignmentCoord];
                    pos += node.size[0] + gap;
                } else {
                    targets[node.id] = [alignmentCoord, pos];
                    pos += node.size[1] + gap;
                }
            }
            
            return targets;
        }
        
        // Normal alignment (not reorder mode)
        let center = 0;
        for (const node of sortedNodes) {
            const orig = originals[node.id] || node.pos;
            center += axis === 'horizontal' ? orig[1] : orig[0];
        }
        center /= sortedNodes.length;
        
        const totalSize = sortedNodes.reduce((sum, n) => sum + (axis === 'horizontal' ? n.size[0] : n.size[1]), 0);
        const gap = CONFIG.ALIGNMENT.DEFAULT_MARGIN;
        const totalLength = totalSize + gap * (sortedNodes.length - 1);
        const start = (axis === 'horizontal') ? 
            (this.autoAlignStart[0] - totalLength / 2) : 
            (this.autoAlignStart[1] - totalLength / 2);
        
        let pos = start;
        const targets = {};
        for (const node of sortedNodes) {
            if (axis === 'horizontal') {
                targets[node.id] = [pos, center];
                pos += node.size[0] + gap;
            } else {
                targets[node.id] = [center, pos];
                pos += node.size[1] + gap;
            }
        }
        
        return targets;
    }
    
    areImagesAlignedOnAxis(axis) {
        const nodes = this.selection.getSelectedNodes();
        if (nodes.length < 2) return false;
        
        const tolerance = CONFIG.ALIGNMENT.TOLERANCE;
        
        if (axis === 'horizontal') {
            const firstY = nodes[0].pos[1];
            const aligned = nodes.every(n => Math.abs(n.pos[1] - firstY) < tolerance);
            if (!aligned) {
                // Not aligned horizontally
            }
            return aligned;
        } else if (axis === 'vertical') {
            const firstX = nodes[0].pos[0];
            const aligned = nodes.every(n => Math.abs(n.pos[0] - firstX) < tolerance);
            if (!aligned) {
                // Not aligned vertically
            }
            return aligned;
        }
        return false;
    }
    
    // ===================================
    // GRID ALIGNMENT
    // ===================================
    
    startGridAlign(startPos) {
        if (this.selection.size() === 0) return false;
        

        this.gridAlignMode = true;
        this.gridAlignDragging = true;
        this.gridAlignAnchor = [...startPos];
        this.gridAlignBox = [startPos[0], startPos[1], startPos[0], startPos[1]];
        this.gridAlignColumns = 1;
        this.gridAlignTargets = null;
        this.gridAlignAnimating = false;
        this.gridAlignAnimNodes = null;
        this.gridAlignAnimTargets = null;
        
        window.app.undoManager.beginInteraction(this.selection.getSelectedNodes());
        return true;
    }
    
    updateGridAlign(currentPos) {
        if (!this.gridAlignMode || !this.gridAlignDragging || !this.gridAlignAnchor) return;
        
        // Update bounding box
        const ax = this.gridAlignAnchor[0];
        const ay = this.gridAlignAnchor[1];
        const bx = currentPos[0];
        const by = currentPos[1];
        this.gridAlignBox = [ax, ay, bx, by];
        
        // Calculate grid parameters
        const selectedNodes = this.selection.getSelectedNodes();
        let maxNodeWidth = 100;
        let maxNodeHeight = 100;
        if (selectedNodes.length > 0) {
            maxNodeWidth = Math.max(...selectedNodes.map(n => n.size[0]));
            maxNodeHeight = Math.max(...selectedNodes.map(n => n.size[1]));
        }
        
        const cellWidth = maxNodeWidth + CONFIG.ALIGNMENT.DEFAULT_MARGIN;
        const cellHeight = maxNodeHeight + CONFIG.ALIGNMENT.DEFAULT_MARGIN;
        const width = Math.abs(bx - ax);
        const height = Math.abs(by - ay);
        
        let columns = 1;
        if (width > cellWidth * 1.1) {
            columns = Math.max(1, Math.round(width / cellWidth));
        }
        this.gridAlignColumns = columns;
        
        // Calculate grid layout
        const rows = Math.ceil(selectedNodes.length / columns);
        const leftToRight = bx >= ax;
        const topToBottom = by >= ay;
        
        const originX = leftToRight ? Math.min(ax, bx) : Math.max(ax, bx) - columns * cellWidth;
        const originY = topToBottom ? Math.min(ay, by) : Math.max(ay, by) - rows * cellHeight;
        
        // Create grid targets
        const gridTargets = [];
        for (let i = 0; i < selectedNodes.length; i++) {
            const col = i % columns;
            const row = Math.floor(i / columns);
            let tx = originX + (leftToRight ? col * cellWidth : (columns - 1 - col) * cellWidth);
            let ty = originY + (topToBottom ? row * cellHeight : (rows - 1 - row) * cellHeight);
            const cx = tx + cellWidth / 2;
            const cy = ty + cellHeight / 2;
            gridTargets.push({tx, ty, cx, cy});
        }
        
        // Assign nodes to grid positions using nearest-neighbor matching
        const availableNodes = [...selectedNodes];
        const targets = {};
        for (const gridTarget of gridTargets) {
            let minDist = Infinity;
            let closestNode = null;
            for (const node of availableNodes) {
                const nx = node.pos[0] + node.size[0] / 2;
                const ny = node.pos[1] + node.size[1] / 2;
                const dist = (nx - gridTarget.cx) ** 2 + (ny - gridTarget.cy) ** 2;
                if (dist < minDist) {
                    minDist = dist;
                    closestNode = node;
                }
            }
            if (closestNode) {
                // Center node in cell
                const w = closestNode.size[0], h = closestNode.size[1];
                const finalTx = gridTarget.tx + (cellWidth - w) / 2;
                const finalTy = gridTarget.ty + (cellHeight - h) / 2;
                targets[closestNode.id] = [finalTx, finalTy];
                availableNodes.splice(availableNodes.indexOf(closestNode), 1);
            }
        }
        
        // Start animation
        this.gridAlignAnimNodes = selectedNodes;
        this.gridAlignAnimTargets = targets;
        // Also store a backup copy for finishGridAlign in case animation completes first
        this.gridAlignFinalTargets = { ...targets };

        if (!this.gridAlignAnimating) {
            for (const node of selectedNodes) {
                node._gridAnimPos = [...node.pos];
                node._gridAnimVel = [0, 0];
            }
            this.gridAlignAnimating = true;
        }
        
        this.canvas.dirty_canvas = true;
    }
    
    finishGridAlign() {

        
        // Capture the current targets for saving (before they might get cleared by animation)
        // Use the final targets backup if animation already cleared the main targets
        const targetsForSave = this.gridAlignAnimTargets ? { ...this.gridAlignAnimTargets } : 
                              this.gridAlignFinalTargets ? { ...this.gridAlignFinalTargets } : null;
        
        if (targetsForSave) {
            // During animation - use the target positions
            const selectedNodes = this.selection.getSelectedNodes();
            const nodeIds = [];
            const positions = [];
            

            
            for (const node of selectedNodes) {
                if (targetsForSave[node.id]) {
                    nodeIds.push(node.id);
                    positions.push(targetsForSave[node.id]);
                }
            }
            

            
            window.app.undoManager.endInteraction('node_align', { 
                nodeIds, 
                positions, 
                axis: 'grid' 
            });
        } else {
            // After animation completed - use current node positions
            const selectedNodes = this.selection.getSelectedNodes();
            if (selectedNodes.length > 0) {
                const nodeIds = selectedNodes.map(node => node.id);
                const positions = selectedNodes.map(node => [...node.pos]);
                

                
                window.app.undoManager.endInteraction('node_align', { 
                    nodeIds, 
                    positions, 
                    axis: 'grid' 
                });
            } else {
                window.app.undoManager.cancelInteraction();
            }
        }

        this.gridAlignMode = false;
        this.gridAlignDragging = false;
        this.gridAlignAnchor = null;
        this.gridAlignBox = null;
        this.gridAlignColumns = 1;
        this.gridAlignTargets = null;
        // Don't clear animation targets - let the animation complete naturally
        // The animation needs these targets to continue running
        // They will be cleared by completeAnimation() when the animation finishes
        // this.gridAlignAnimTargets = null;
        // this.gridAlignFinalTargets = null;
        // this.gridAlignAnimNodes = null;
        this.canvas.dirty_canvas = true;
    }
    
    // ===================================
    // ANIMATION UPDATES
    // ===================================
    
    updateAnimations() {
        let needsRedraw = false;
        
        // Calculate delta time for frame-rate independence
        const currentTime = performance.now() / 1000; // Convert to seconds
        const deltaTime = this.lastUpdateTime ? Math.min(currentTime - this.lastUpdateTime, 0.033) : 0.016; // Cap at ~30fps min
        this.lastUpdateTime = currentTime;
        
        // Clean up any stale animation properties on nodes
        this.cleanupStaleAnimationProperties();
        
        // Update auto-align animations
        if (this.autoAlignAnimating && this.autoAlignAnimNodes && this.autoAlignAnimTargets) {
            needsRedraw = true;
            const nodeCount = this.autoAlignAnimNodes.length;
            
            // Use optimized approach for large node counts
            if (nodeCount >= CONFIG.ALIGNMENT.LARGE_SCALE_THRESHOLD) {
                needsRedraw = this.updateLargeScaleAnimation(deltaTime, this.autoAlignAnimNodes, this.autoAlignAnimTargets, false) || needsRedraw;
            } else {
                needsRedraw = this.updateStandardAnimation(deltaTime, this.autoAlignAnimNodes, this.autoAlignAnimTargets, false) || needsRedraw;
            }
        }
        
        // Update grid-align animations
        if (this.gridAlignAnimating && this.gridAlignAnimNodes && this.gridAlignAnimTargets) {
            needsRedraw = true;
            const nodeCount = this.gridAlignAnimNodes.length;
            
            // Use optimized approach for large node counts
            if (nodeCount >= CONFIG.ALIGNMENT.LARGE_SCALE_THRESHOLD) {
                needsRedraw = this.updateLargeScaleAnimation(deltaTime, this.gridAlignAnimNodes, this.gridAlignAnimTargets, true) || needsRedraw;
            } else {
                needsRedraw = this.updateStandardAnimation(deltaTime, this.gridAlignAnimNodes, this.gridAlignAnimTargets, true) || needsRedraw;
            }
        }
        
        if (needsRedraw) {
            this.canvas.dirty_canvas = true;
        }
    }
    
    // ===================================
    // STANDARD ANIMATION (Small node counts)
    // ===================================
    
    updateStandardAnimation(deltaTime, animNodes, animTargets, isGridAlign) {
        let needsRedraw = true;
        let allDone = true;
        const posKey = isGridAlign ? '_gridAnimPos' : '_animPos';
        const velKey = isGridAlign ? '_gridAnimVel' : '_animVel';
        
        for (const node of animNodes) {
            const target = animTargets[node.id];
            if (!target) continue;
            
            if (!node[posKey]) node[posKey] = [...node.pos];
            if (!node[velKey]) node[velKey] = [0, 0];
            
            let done = true;
            for (let i = 0; i < 2; i++) {
                let x = node[posKey][i], v = node[velKey][i], t = target[i];
                let k = CONFIG.ALIGNMENT.SPRING_K, d = CONFIG.ALIGNMENT.SPRING_D;
                let dx = t - x;
                let ax = k * dx - d * v;
                v += ax * deltaTime;
                x += v * deltaTime;
                node[velKey][i] = v;
                node[posKey][i] = x;
                if (Math.abs(t - x) > CONFIG.ALIGNMENT.ANIMATION_THRESHOLD || Math.abs(v) > CONFIG.ALIGNMENT.ANIMATION_THRESHOLD) done = false;
            }
            
            if (done) {
                node[posKey][0] = target[0];
                node[posKey][1] = target[1];
                node[velKey] = [0, 0];
                
                // Don't snap positions during drag - let animation complete naturally
                // This was causing positions to be set prematurely
            } else {
                allDone = false;
            }
        }
        
        if (allDone) {
            this.completeAnimation(animNodes, animTargets, isGridAlign);
        }
        
        return needsRedraw;
    }
    
    // ===================================
    // LARGE SCALE ANIMATION (High performance for 100+ nodes)
    // ===================================
    
    updateLargeScaleAnimation(deltaTime, animNodes, animTargets, isGridAlign) {
        let needsRedraw = true;
        this.animationFrameStartTime = performance.now();
        
        const posKey = isGridAlign ? '_gridAnimPos' : '_animPos';
        const velKey = isGridAlign ? '_gridAnimVel' : '_animVel';
        const maxBatchSize = CONFIG.ALIGNMENT.MAX_ANIMATION_BATCH_SIZE;
        const frameBudget = CONFIG.ALIGNMENT.FRAME_BUDGET_MS;
        
        // Use adaptive spring constants for large scale
        const k = CONFIG.ALIGNMENT.LARGE_SCALE_SPRING_K;
        const d = CONFIG.ALIGNMENT.LARGE_SCALE_SPRING_D;
        const threshold = CONFIG.ALIGNMENT.ANIMATION_THRESHOLD * CONFIG.ALIGNMENT.LARGE_SCALE_THRESHOLD_MULTIPLIER;
        
        // Reset node index if we're starting a new cycle
        if (this.animationNodeIndex >= animNodes.length) {
            this.animationNodeIndex = 0;
        }
        
        let processedNodes = 0;
        let allDone = true;
        let currentNodeIndex = this.animationNodeIndex;
        
        // Process nodes in batches to maintain frame rate
        while (processedNodes < maxBatchSize && 
               currentNodeIndex < animNodes.length && 
               (performance.now() - this.animationFrameStartTime) < frameBudget) {
            
            const node = animNodes[currentNodeIndex];
            const target = animTargets[node.id];
            
            if (target) {
                if (!node[posKey]) node[posKey] = [...node.pos];
                if (!node[velKey]) node[velKey] = [0, 0];
                
                let done = true;
                for (let i = 0; i < 2; i++) {
                    let x = node[posKey][i], v = node[velKey][i], t = target[i];
                    let dx = t - x;
                    let ax = k * dx - d * v;
                    v += ax * deltaTime;
                    x += v * deltaTime;
                    node[velKey][i] = v;
                    node[posKey][i] = x;
                    if (Math.abs(t - x) > threshold || Math.abs(v) > threshold) done = false;
                }
                
                if (done) {
                    node[posKey][0] = target[0];
                    node[posKey][1] = target[1];
                    node[velKey] = [0, 0];
                    
                    // Don't snap positions during drag - let animation complete naturally
                } else {
                    allDone = false;
                }
            }
            
            currentNodeIndex++;
            processedNodes++;
        }
        
        // Update our position in the node list
        this.animationNodeIndex = currentNodeIndex;
        
        // Check if we need to continue processing or if we're done with all nodes
        if (currentNodeIndex >= animNodes.length) {
            // We've processed all nodes this cycle, check if any are still animating
            let anyStillAnimating = false;
            for (const node of animNodes) {
                const target = animTargets[node.id];
                if (target && node[posKey]) {
                    for (let i = 0; i < 2; i++) {
                        if (Math.abs(target[i] - node[posKey][i]) > threshold || 
                            Math.abs(node[velKey][i]) > threshold) {
                            anyStillAnimating = true;
                            break;
                        }
                    }
                    if (anyStillAnimating) break;
                }
            }
            
            if (!anyStillAnimating) {
                this.completeAnimation(animNodes, animTargets, isGridAlign);
            } else {
                // Reset for next cycle
                this.animationNodeIndex = 0;
            }
        }
        
        return needsRedraw;
    }
    
    // ===================================
    // ANIMATION COMPLETION
    // ===================================
    
    completeAnimation(animNodes, animTargets, isGridAlign) {
        const nodeIds = [];
        const finalPositions = [];
        const posKey = isGridAlign ? '_gridAnimPos' : '_animPos';
        const velKey = isGridAlign ? '_gridAnimVel' : '_animVel';
        
        for (const node of animNodes) {
            if (node[posKey]) {
                // Update the actual node position to match the animation position
                node.pos[0] = node[posKey][0];
                node.pos[1] = node[posKey][1];
                
                nodeIds.push(node.id);
                finalPositions.push([...node.pos]);
                
                delete node[posKey];
                delete node[velKey];
            }
        }
        
        // Mark nodes as having completed animation to prevent server updates from interfering
        if (isGridAlign && animNodes.length > 0) {
            const completionTime = Date.now();
            animNodes.forEach(node => {
                node._alignmentCompletedAt = completionTime;
            });
        }
        
        // This is now handled by the endInteraction call in the canvas
        /*
        if (nodeIds.length > 0 && window.app?.operationPipeline) {
            window.app.operationPipeline.execute('node_move', {
                nodeIds: nodeIds,
                positions: finalPositions,
                source: isGridAlign ? 'grid_align' : 'alignment'
            });
        }
        */
        
        // Invalidate bounding box cache when animation completes
        this.selection.invalidateBoundingBox();
        
        // Reset animation state
        this.animationNodeIndex = 0;
        
        if (isGridAlign) {
            this.gridAlignAnimating = false;
            // Clear all animation state now that animation is complete
            this.gridAlignAnimNodes = null;
            this.gridAlignAnimTargets = null;
            this.gridAlignFinalTargets = null;
        } else {
            if (!this.autoAlignMode) {
                this.autoAlignOriginals = null;
                // Don't clear master order here - it should persist
                // this.autoAlignMasterOrder = null;
                this.autoAlignDominantAxis = null;
                this.autoAlignIsReorderMode = false;
                this.autoAlignAnimating = false;
                // Don't clear targets if still in alignment mode
                // They're needed in finishAutoAlign
            } else {
                this.autoAlignAnimating = false;
                // Don't clear targets while still dragging
            }
        }
    }
    
    // ===================================
    // CLEANUP
    // ===================================
    
    cleanupStaleAnimationProperties() {
        // Only run cleanup occasionally to avoid performance impact
        if (!this._lastCleanupTime) this._lastCleanupTime = 0;
        const now = Date.now();
        if (now - this._lastCleanupTime < 1000) return; // Run at most once per second
        this._lastCleanupTime = now;
        
        // Clean up animation properties from all nodes if no animations are active
        if (!this.autoAlignAnimating && !this.gridAlignAnimating) {
            const allNodes = this.canvas.graph?.nodes || [];
            let cleanedCount = 0;
            
            for (const node of allNodes) {
                let hadAnimProps = false;
                if (node._animPos || node._animVel) {
                    delete node._animPos;
                    delete node._animVel;
                    hadAnimProps = true;
                }
                if (node._gridAnimPos || node._gridAnimVel) {
                    delete node._gridAnimPos;
                    delete node._gridAnimVel;
                    hadAnimProps = true;
                }
                // Also clean up the alignment completion flag if it's old
                if (node._alignmentCompletedAt && (now - node._alignmentCompletedAt > 3000)) {
                    delete node._alignmentCompletedAt;
                    hadAnimProps = true;
                }
                if (hadAnimProps) {
                    cleanedCount++;
                }
            }
            

        }
    }
    
    // ===================================
    // DRAWING
    // ===================================
    
    drawOverlays(ctx) {
        // Draw grid align overlay
        if (this.gridAlignMode && this.gridAlignDragging && this.gridAlignBox) {
            ctx.save();
            ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
            ctx.strokeStyle = '#4af';
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            
            const [ax, ay, bx, by] = this.gridAlignBox;
            const sx0 = ax * this.viewport.scale + this.viewport.offset[0];
            const sy0 = ay * this.viewport.scale + this.viewport.offset[1];
            const sx1 = bx * this.viewport.scale + this.viewport.offset[0];
            const sy1 = by * this.viewport.scale + this.viewport.offset[1];
            
            const x0 = Math.min(sx0, sx1), y0 = Math.min(sy0, sy1);
            const x1 = Math.max(sx0, sx1), y1 = Math.max(sy0, sy1);
            
            ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
            ctx.restore();
        }
    }
    
    // ===================================
    // PUBLIC METHODS
    // ===================================
    
    isActive() {
        return this.autoAlignMode || this.gridAlignMode;
    }
    
    clearMasterOrder() {
        // Call this when selection changes or nodes are deleted
        this.autoAlignMasterOrder = null;
    }
    
    isAnimating() {
        return this.autoAlignAnimating || this.gridAlignAnimating;
    }
    
    stopAll() {
        if (this.autoAlignAnimating && this.autoAlignAnimNodes && this.autoAlignAnimTargets) {
            // Snap to final positions
            for (const node of this.autoAlignAnimNodes) {
                const target = this.autoAlignAnimTargets[node.id];
                if (target) {
                    node.pos[0] = target[0];
                    node.pos[1] = target[1];
                }
                delete node._animPos;
                delete node._animVel;
            }
        }
        
        if (this.gridAlignAnimating && this.gridAlignAnimNodes && this.gridAlignAnimTargets) {
            // Snap to final positions
            for (const node of this.gridAlignAnimNodes) {
                const target = this.gridAlignAnimTargets[node.id];
                if (target) {
                    node.pos[0] = target[0];
                    node.pos[1] = target[1];
                }
                delete node._gridAnimPos;
                delete node._gridAnimVel;
            }
        }
        
        // Reset all state
        this.autoAlignMode = false;
        this.autoAlignAnimating = false;
        this.autoAlignOriginals = null;
        // Don't clear master order - let it persist until selection changes
        // this.autoAlignMasterOrder = null;
        this.autoAlignDominantAxis = null;
        this.autoAlignIsReorderMode = false;
        this.autoAlignCommitted = false;
        this.autoAlignCommittedAxis = null;
        this.autoAlignCommittedTargets = null;
        this.autoAlignCommittedDirection = null;
        
        this.gridAlignMode = false;
        this.gridAlignDragging = false;
        this.gridAlignAnimating = false;
        this.gridAlignAnchor = null;
        this.gridAlignBox = null;
        this.gridAlignTargets = null;
        this.gridAlignAnimNodes = null;
        this.gridAlignAnimTargets = null;
        this.gridAlignFinalTargets = null;
        
        // Reset performance tracking
        this.animationNodeIndex = 0;
        
        // Invalidate bounding box cache when stopping all alignment operations
        this.selection.invalidateBoundingBox();
        
        this.canvas.dirty_canvas = true;
    }
}