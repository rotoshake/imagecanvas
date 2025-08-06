/**
 * GalleryViewManager - Manages the gallery viewing mode for media nodes
 * 
 * Features:
 * - Focused viewing of media nodes (images/videos)
 * - Keyboard navigation through nodes
 * - Clean UI with darkened background
 * - Maintains selection for properties panel
 */

class GalleryViewManager {
    constructor(app) {
        this.app = app;
        this.canvas = app.graphCanvas;
        this.active = false;
        this.currentIndex = 0;
        this.mediaNodes = [];
        this.previousViewportState = null;
        this.closeButton = null;
        
        // Transition state for smooth crossfade
        this.transitionState = {
            active: false,
            fromNode: null,
            toNode: null,
            progress: 0,
            startTime: null,
            duration: 600 // milliseconds for crossfade
        };
        
        // Darkening transition state
        this.darkeningState = {
            progress: 0,
            startTime: null,
            duration: 300, // milliseconds for fade
            direction: 'in' // 'in' or 'out'
        };
        
        // Bind methods
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleCloseClick = this.handleCloseClick.bind(this);
        
    }
    
    /**
     * Enter gallery mode starting with a specific node
     */
    enter(initialNode) {
        if (this.active) return;

        // Save current viewport state
        this.previousViewportState = {
            scale: this.canvas.viewport.scale,
            offset: [...this.canvas.viewport.offset]
        };
        
        // Set active state
        this.active = true;
        
        // Sort and filter media nodes
        this.sortMediaNodes();
        
        // Find index of initial node
        const index = this.mediaNodes.findIndex(n => n.id === initialNode.id);
        if (index === -1) {
            
            this.exit();
            return;
        }
        
        // Create UI elements (close button and counter only)
        this.createUIElements();
        
        // Start darkening animation
        this.startDarkeningAnimation('in');
        
        // Add keyboard listener
        document.addEventListener('keydown', this.handleKeyDown, true);
        
        // Enable gallery interactions (mouse zoom, panning with limits)
        this.enableGalleryInteractions();
        
        // Navigate to initial node (immediate = true to skip fade-in)
        this.navigateToNode(index, true);
        
        // Mark canvas as needing redraw
        this.canvas.dirty_canvas = true;
    }
    
    /**
     * Exit gallery mode
     */
    exit() {
        if (!this.active) return;

        // Clear any pending timeouts
        if (this.zoomSpringbackTimeout) {
            clearTimeout(this.zoomSpringbackTimeout);
            this.zoomSpringbackTimeout = null;
        }
        
        // Start darkening fade out animation
        this.startDarkeningAnimation('out');
        
        // Add fade-out class to UI elements
        if (this.closeButton) {
            this.closeButton.classList.add('fade-out');
        }
        const counter = document.getElementById('gallery-node-counter');
        if (counter) {
            counter.classList.add('fade-out');
        }
        
        // Remove keyboard listener
        document.removeEventListener('keydown', this.handleKeyDown, true);
        
        // Disable gallery interactions and restore original behavior
        this.disableGalleryInteractions();
        
        // Remove UI elements after fade out
        setTimeout(() => {
            this.removeUIElements();
        }, this.darkeningState.duration);
        
        // Restore viewport state with animation
        if (this.previousViewportState) {
            // Use the viewport's animateTo method for smooth transition
            this.canvas.viewport.animateTo(
                [...this.previousViewportState.offset],
                this.previousViewportState.scale,
                CONFIG.NAVIGATION.ANIMATION_DURATION || 400
            );
        }
        
        // Clear state
        this.active = false;
        this.currentIndex = 0;
        this.mediaNodes = [];
        this.previousViewportState = null;
        
        // Mark canvas as needing redraw
        this.canvas.dirty_canvas = true;
        
        // Trigger navigation state save
        if (window.navigationStateManager) {
            window.navigationStateManager.onViewportChange();
        }
    }
    
    /**
     * Reset zoom and pan to gallery default for current node
     */
    resetToGalleryDefault() {
        const currentNode = this.getCurrentNode();
        if (!currentNode) return;

        // Zoom to fit the current node with minimal padding (same as navigateToNode)
        const bbox = currentNode.getBoundingBox();
        const padding = 40;
        this.canvas.viewport.zoomToFit(bbox, padding, true); // true for animation
        
        // Mark canvas as dirty
        this.canvas.dirty_canvas = true;
    }
    
    /**
     * Enable gallery mode interactions (mouse zoom, panning with limits)
     */
    enableGalleryInteractions() {
        // Always store the original pan method and re-apply our hook
        if (this.canvas.viewport) {
            // Store original if not already stored or if it's been replaced
            if (!this.originalViewportPan || this.canvas.viewport.pan !== this.galleryPanWrapper) {
                this.originalViewportPan = this.canvas.viewport.pan.bind(this.canvas.viewport);
            }
            
            // Create wrapper function
            this.galleryPanWrapper = (deltaX, deltaY) => {
                if (this.active) {
                    // Apply rubber band resistance
                    const [resistedDX, resistedDY] = this.applyRubberBandResistance(deltaX, deltaY);
                    this.originalViewportPan(resistedDX, resistedDY);
                } else {
                    this.originalViewportPan(deltaX, deltaY);
                }
            };
            
            // Apply the wrapper
            this.canvas.viewport.pan = this.galleryPanWrapper;
            
            // Also hook into zoom to check bounds after zooming
            if (!this.originalViewportZoom || this.canvas.viewport.zoom !== this.galleryZoomWrapper) {
                this.originalViewportZoom = this.canvas.viewport.zoom.bind(this.canvas.viewport);
            }
            
            this.galleryZoomWrapper = (delta, centerX, centerY) => {
                this.originalViewportZoom(delta, centerX, centerY);
                if (this.active && !this.canvas.mouseState.down) {
                    // Only spring back if we're not actively interacting
                    // and significantly out of bounds after zoom
                    // This prevents flickering when zooming near the edge
                    clearTimeout(this.zoomSpringbackTimeout);
                    this.zoomSpringbackTimeout = setTimeout(() => {
                        this.checkAndSpringBackAfterZoom();
                    }, 150); // Small delay to let zoom settle
                }
            };
            
            this.canvas.viewport.zoom = this.galleryZoomWrapper;
        }
    }
    
    /**
     * Disable gallery mode interactions and restore original behavior
     */
    disableGalleryInteractions() {
        // Restore original methods
        if (this.canvas.viewport) {
            if (this.originalViewportPan) {
                this.canvas.viewport.pan = this.originalViewportPan;
            }
            if (this.originalViewportZoom) {
                this.canvas.viewport.zoom = this.originalViewportZoom;
            }
        }
    }
    
    /**
     * Apply iOS-style rubber band resistance to pan deltas
     */
    applyRubberBandResistance(deltaX, deltaY) {
        const bounds = this.calculateBounds();
        if (!bounds) return [deltaX, deltaY];
        
        const currentOffset = this.canvas.viewport.offset;
        const proposedOffset = [
            currentOffset[0] + deltaX,
            currentOffset[1] + deltaY
        ];
        
        // Calculate how far out of bounds we are
        const overflowX = this.calculateOverflow(proposedOffset[0], bounds.minX, bounds.maxX);
        const overflowY = this.calculateOverflow(proposedOffset[1], bounds.minY, bounds.maxY);
        
        // Apply rubber band resistance
        let resistedDX = deltaX;
        let resistedDY = deltaY;
        
        if (overflowX !== 0) {
            // Reduce movement based on how far we're already out of bounds
            const resistance = this.calculateResistance(Math.abs(overflowX));
            resistedDX = deltaX * resistance;
        }
        
        if (overflowY !== 0) {
            // Reduce movement based on how far we're already out of bounds
            const resistance = this.calculateResistance(Math.abs(overflowY));
            resistedDY = deltaY * resistance;
        }
        
        return [resistedDX, resistedDY];
    }
    
    /**
     * Calculate rubber band resistance factor (0 to 1)
     * Uses iOS-style logarithmic resistance
     */
    calculateResistance(overflow) {
        // iOS-style resistance: starts at ~0.5 and quickly approaches 0
        const baseResistance = 0.55;
        const falloffRate = 0.003;
        return baseResistance * Math.exp(-falloffRate * overflow);
    }
    
    /**
     * Calculate how far a value is outside its bounds
     */
    calculateOverflow(value, min, max) {
        if (value < min) return value - min; // Negative overflow
        if (value > max) return value - max; // Positive overflow
        return 0; // Within bounds
    }
    
    /**
     * Calculate viewport bounds for current node
     */
    calculateBounds() {
        const currentNode = this.getCurrentNode();
        if (!currentNode || !this.canvas.viewport) return null;
        
        const bbox = currentNode.getBoundingBox();
        const canvasWidth = this.canvas.canvas.width / this.canvas.viewport.dpr;
        const canvasHeight = this.canvas.canvas.height / this.canvas.viewport.dpr;
        const scale = this.canvas.viewport.scale;
        
        // bbox is an array [x, y, width, height]
        const [bboxX, bboxY, bboxWidth, bboxHeight] = bbox;
        
        // Calculate bounds - allow panning up to half the image size beyond edges
        const maxPanX = (bboxWidth * scale) / 2;
        const maxPanY = (bboxHeight * scale) / 2;
        
        // Convert to viewport offset bounds
        const nodeCenterX = bboxX + bboxWidth / 2;
        const nodeCenterY = bboxY + bboxHeight / 2;
        
        const minOffsetX = canvasWidth / 2 - (nodeCenterX * scale) - maxPanX;
        const maxOffsetX = canvasWidth / 2 - (nodeCenterX * scale) + maxPanX;
        const minOffsetY = canvasHeight / 2 - (nodeCenterY * scale) - maxPanY;
        const maxOffsetY = canvasHeight / 2 - (nodeCenterY * scale) + maxPanY;
        
        return {
            minX: minOffsetX,
            maxX: maxOffsetX,
            minY: minOffsetY,
            maxY: maxOffsetY
        };
    }
    
    /**
     * Handle mouse up in gallery mode - check for spring-back
     */
    handleMouseUp(e) {
        if (!this.active) return;
        
        // Check if we need to spring back after panning ended
        // Use requestAnimationFrame to ensure we check after the canvas has updated
        requestAnimationFrame(() => {
            this.checkAndSpringBack();
        });
    }
    
    /**
     * Check if we're out of bounds and spring back if needed
     */
    checkAndSpringBack() {
        const bounds = this.calculateBounds();
        if (!bounds) return;
        
        const currentOffset = this.canvas.viewport.offset;
        let targetOffset = [...currentOffset];
        let needsSpringBack = false;
        
        // Check X bounds
        if (currentOffset[0] < bounds.minX) {
            targetOffset[0] = bounds.minX;
            needsSpringBack = true;
        } else if (currentOffset[0] > bounds.maxX) {
            targetOffset[0] = bounds.maxX;
            needsSpringBack = true;
        }
        
        // Check Y bounds
        if (currentOffset[1] < bounds.minY) {
            targetOffset[1] = bounds.minY;
            needsSpringBack = true;
        } else if (currentOffset[1] > bounds.maxY) {
            targetOffset[1] = bounds.maxY;
            needsSpringBack = true;
        }
        
        if (needsSpringBack && !this.canvas.viewport.isAnimating) {
            
            // Use the existing animation system for smooth spring-back
            this.canvas.viewport.animateTo(
                targetOffset,
                this.canvas.viewport.scale,
                CONFIG.NAVIGATION.ANIMATION_DURATION || 400
            );
        }
    }
    
    /**
     * Check bounds after zoom with higher threshold to prevent flickering
     */
    checkAndSpringBackAfterZoom() {
        const bounds = this.calculateBounds();
        if (!bounds) return;
        
        const currentOffset = this.canvas.viewport.offset;
        let targetOffset = [...currentOffset];
        let needsSpringBack = false;
        
        // Use a larger threshold for zoom operations to prevent flickering
        // Only spring back if we're more than 50 pixels out of bounds
        const threshold = 50;
        
        // Check X bounds with threshold
        if (currentOffset[0] < bounds.minX - threshold) {
            targetOffset[0] = bounds.minX;
            needsSpringBack = true;
        } else if (currentOffset[0] > bounds.maxX + threshold) {
            targetOffset[0] = bounds.maxX;
            needsSpringBack = true;
        }
        
        // Check Y bounds with threshold
        if (currentOffset[1] < bounds.minY - threshold) {
            targetOffset[1] = bounds.minY;
            needsSpringBack = true;
        } else if (currentOffset[1] > bounds.maxY + threshold) {
            targetOffset[1] = bounds.maxY;
            needsSpringBack = true;
        }
        
        if (needsSpringBack && !this.canvas.viewport.isAnimating) {
            console.log('🖼️ Springing back after zoom (threshold exceeded)');
            // Use the existing animation system for smooth spring-back
            this.canvas.viewport.animateTo(
                targetOffset,
                this.canvas.viewport.scale,
                CONFIG.NAVIGATION.ANIMATION_DURATION || 400
            );
        }
    }
    
    /**
     * Sort media nodes left-to-right, top-to-bottom
     */
    sortMediaNodes() {
        const mediaTypes = ['media/image', 'media/video'];
        
        // Get all media nodes
        const allMediaNodes = this.app.graph.nodes
            .filter(n => mediaTypes.includes(n.type));
        
        // Group nodes by their parent group
        const nodesByGroup = new Map();
        const ungroupedNodes = [];
        
        for (const node of allMediaNodes) {
            // Find parent group if any
            let parentGroup = null;
            for (const potentialParent of this.app.graph.nodes) {
                if (potentialParent.type === 'container/group' && 
                    potentialParent.childNodes && 
                    potentialParent.childNodes.has(node.id)) {
                    parentGroup = potentialParent;
                    break;
                }
            }
            
            if (parentGroup) {
                if (!nodesByGroup.has(parentGroup.id)) {
                    nodesByGroup.set(parentGroup.id, {
                        group: parentGroup,
                        nodes: []
                    });
                }
                nodesByGroup.get(parentGroup.id).nodes.push(node);
            } else {
                ungroupedNodes.push(node);
            }
        }
        
        // Sort nodes within each group
        const sortNodes = (nodes) => {
            return nodes.sort((a, b) => {
                const [ax, ay] = a.getCenter();
                const [bx, by] = b.getCenter();
                const rowThreshold = 50; // Consider nodes within 50px as same row
                
                // If nodes are roughly on the same row
                if (Math.abs(ay - by) < rowThreshold) {
                    return ax - bx; // Sort by X position
                }
                return ay - by; // Sort by Y position
            });
        };
        
        // Sort ungrouped nodes
        sortNodes(ungroupedNodes);
        
        // Sort groups by their position
        const sortedGroups = Array.from(nodesByGroup.values()).sort((a, b) => {
            const [ax, ay] = a.group.getCenter();
            const [bx, by] = b.group.getCenter();
            const rowThreshold = 50;
            
            if (Math.abs(ay - by) < rowThreshold) {
                return ax - bx;
            }
            return ay - by;
        });
        
        // Build final sorted array: grouped nodes first (in group order), then ungrouped
        this.mediaNodes = [];
        
        // Add all grouped nodes
        for (const groupData of sortedGroups) {
            sortNodes(groupData.nodes);
            this.mediaNodes.push(...groupData.nodes);
        }
        
        // Add ungrouped nodes at the end
        this.mediaNodes.push(...ungroupedNodes);
    }
    
    /**
     * Navigate to a specific node by index
     */
    navigateToNode(index, immediate = false) {
        if (index < 0 || index >= this.mediaNodes.length) return;
        
        const previousNode = this.getCurrentNode();
        this.currentIndex = index;
        const node = this.mediaNodes[index];

        // Select the node (updates properties panel)
        this.canvas.selection.clear();
        this.canvas.selection.selectNode(node);
        
        // If not immediate and we have a previous node, start crossfade transition
        if (!immediate && previousNode && previousNode !== node) {
            this.startTransition(previousNode, node);
        }
        
        // Zoom to fit the node with minimal padding
        const bbox = node.getBoundingBox();
        const padding = 40; // Minimal padding around the node
        this.canvas.viewport.zoomToFit(bbox, padding, true); // true for animation
        
        // Update node counter if it exists
        this.updateNodeCounter();
        
        // Mark canvas as dirty
        this.canvas.dirty_canvas = true;
    }
    
    /**
     * Start a crossfade transition between nodes
     */
    startTransition(fromNode, toNode) {
        this.transitionState = {
            active: true,
            fromNode: fromNode,
            toNode: toNode,
            progress: 0,
            startTime: performance.now(),
            duration: 300
        };
        
        // Request animation frame to update transition
        this.updateTransition();
    }
    
    /**
     * Update the transition animation
     */
    updateTransition() {
        if (!this.transitionState.active) return;
        
        const now = performance.now();
        const elapsed = now - this.transitionState.startTime;
        const progress = Math.min(elapsed / this.transitionState.duration, 1);
        
        // Use easing function for smooth transition
        this.transitionState.progress = this.easeInOutCubic(progress);
        
        // Mark canvas dirty to trigger redraw
        this.canvas.dirty_canvas = true;
        
        if (progress < 1) {
            // Continue animation
            requestAnimationFrame(() => this.updateTransition());
        } else {
            // Transition complete
            this.transitionState.active = false;
            this.transitionState.fromNode = null;
            this.transitionState.toNode = null;
        }
    }
    
    /**
     * Easing function for smooth transitions
     */
    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    
    /**
     * Simple ease-out function for more natural fades
     */
    easeOut(t) {
        return 1 - Math.pow(1 - t, 2);
    }
    
    /**
     * Start darkening animation
     */
    startDarkeningAnimation(direction) {
        this.darkeningState.direction = direction;
        this.darkeningState.startTime = performance.now();
        this.updateDarkeningAnimation();
    }
    
    /**
     * Update darkening animation
     */
    updateDarkeningAnimation() {
        const now = performance.now();
        const elapsed = now - this.darkeningState.startTime;
        const rawProgress = Math.min(elapsed / this.darkeningState.duration, 1);
        
        // Apply easing - use simple ease-out for more natural fade
        const easedProgress = this.easeOut(rawProgress);
        
        // Set progress based on direction
        if (this.darkeningState.direction === 'in') {
            this.darkeningState.progress = easedProgress;
        } else {
            this.darkeningState.progress = 1 - easedProgress;
        }
        
        // Trigger canvas redraw
        this.canvas.dirty_canvas = true;
        
        // Continue animation if not complete
        if (rawProgress < 1) {
            requestAnimationFrame(() => this.updateDarkeningAnimation());
        }
    }
    
    /**
     * Get current darkening opacity (0 to 0.4)
     */
    getDarkeningOpacity() {
        return this.darkeningState.progress * 0.4;
    }
    
    /**
     * Get opacity for a node during transition
     */
    getNodeOpacity(node) {
        if (!this.transitionState.active) return 1;
        
        const { fromNode, toNode, progress } = this.transitionState;
        
        if (node === fromNode) {
            // Fade out the old node
            return 1 - progress;
        } else if (node === toNode) {
            // Fade in the new node
            return progress;
        }
        
        // Other nodes stay hidden
        return 0;
    }
    
    /**
     * Navigate to the next node
     */
    next() {
        const nextIndex = (this.currentIndex + 1) % this.mediaNodes.length;
        this.navigateToNode(nextIndex);
    }
    
    /**
     * Navigate to the previous node
     */
    previous() {
        const prevIndex = (this.currentIndex - 1 + this.mediaNodes.length) % this.mediaNodes.length;
        this.navigateToNode(prevIndex);
    }
    
    /**
     * Get the current node being viewed
     */
    getCurrentNode() {
        return this.mediaNodes[this.currentIndex] || null;
    }
    
    /**
     * Handle keyboard events in gallery mode
     */
    handleKeyDown(e) {
        if (!this.active) return;
        
        // Allow Space key to pass through to canvas for panning
        if (e.key === ' ' || e.code === 'Space') {
            return; // Don't handle, let it bubble to canvas
        }
        
        switch(e.key.toLowerCase()) {
            case 'arrowleft':
                e.preventDefault();
                e.stopPropagation();
                this.previous();
                break;
                
            case 'arrowright':
                e.preventDefault();
                e.stopPropagation();
                this.next();
                break;
                
            case 'escape':
                // Check if chat panel is open and has focus
                if (window.app?.chatPanel?.isOpen) {
                    // Let the chat panel handle it
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                this.exit();
                break;
                
            case 'p': // Toggle properties inspector
                e.preventDefault();
                e.stopPropagation();
                if (window.propertiesInspector) {
                    window.propertiesInspector.toggle();
                }
                break;
                
            case 'c': // Toggle color correction panel
                e.preventDefault();
                e.stopPropagation();
                if (window.colorCorrectionPanel) {
                    window.colorCorrectionPanel.toggle();
                }
                break;
                
            case 'f': // Reset zoom and pan to gallery default
                e.preventDefault();
                e.stopPropagation();
                this.resetToGalleryDefault();
                break;
                
            case ' ': // Space key for video play/pause
                e.preventDefault();
                e.stopPropagation();
                const currentNode = this.getCurrentNode();
                if (currentNode && currentNode.type === 'media/video') {
                    if (currentNode.properties.paused) {
                        currentNode.play();
                    } else {
                        currentNode.pause();
                    }
                    this.canvas.dirty_canvas = true;
                }
                break;
                
            case '-': // Zoom out
            case '_': // Zoom out (shift+minus)
                e.preventDefault();
                e.stopPropagation();
                if (this.canvas.keyboardZoom) {
                    this.canvas.keyboardZoom(0.5);
                }
                break;
                
            case '+': // Zoom in
            case '=': // Zoom in (equals key, commonly used for plus)
                e.preventDefault();
                e.stopPropagation();
                if (this.canvas.keyboardZoom) {
                    this.canvas.keyboardZoom(2);
                }
                break;
        }
    }
    
    /**
     * Create the UI elements (close button and counter)
     */
    createUIElements() {
        // Create close button
        this.closeButton = document.createElement('div');
        this.closeButton.className = 'gallery-close';
        this.closeButton.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.5 7.5L7.5 22.5M7.5 7.5L22.5 22.5" stroke="white" stroke-width="3" stroke-linecap="round"/>
            </svg>
        `;
        this.closeButton.addEventListener('click', this.handleCloseClick);
        
        // Create node counter
        const counter = document.createElement('div');
        counter.className = 'gallery-counter';
        counter.id = 'gallery-node-counter';
        
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .gallery-close {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 25px;
                height: 25px;
                cursor: pointer;
                pointer-events: auto;
                background: rgba(0, 0, 0, 0.5);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s, opacity 0.3s ease-out;
                z-index: 10000;
                animation: fadeIn 0.3s ease-out;
            }
            
            .gallery-close:hover {
                background: rgba(0, 0, 0, 0.7);
            }
            
            .gallery-close.fade-out {
                opacity: 0;
            }
            
            .gallery-counter {
                position: fixed;
                bottom: 5px;
                left: 50%;
                transform: translateX(-50%);
                color: #777777;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 14px;
                padding: 6px 12px;
                background: rgba(0, 0, 0, 0.5);
                border-radius: 10px;
                pointer-events: none;
                z-index: 10000;
                transition: opacity 0.3s ease-out;
                animation: fadeIn 0.3s ease-out;
                white-space: nowrap;
                max-width: 90%;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .gallery-counter.fade-out {
                opacity: 0;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
        `;
        
        // Add to DOM
        document.body.appendChild(style);
        document.body.appendChild(this.closeButton);
        document.body.appendChild(counter);
        
        this.updateNodeCounter();
    }
    
    /**
     * Remove the UI elements
     */
    removeUIElements() {
        if (this.closeButton) {
            this.closeButton.removeEventListener('click', this.handleCloseClick);
            this.closeButton.remove();
            this.closeButton = null;
        }
        
        const counter = document.getElementById('gallery-node-counter');
        if (counter) {
            counter.remove();
        }
        
        // Remove styles
        const styles = document.querySelectorAll('style');
        styles.forEach(style => {
            if (style.textContent.includes('.gallery-close') || style.textContent.includes('.gallery-counter')) {
                style.remove();
            }
        });
    }
    
    /**
     * Find the parent group of a node
     */
    findParentGroup(node) {
        for (const potentialParent of this.app.graph.nodes) {
            if (potentialParent.type === 'container/group' && 
                potentialParent.childNodes && 
                potentialParent.childNodes.has(node.id)) {
                return potentialParent;
            }
        }
        return null;
    }
    
    /**
     * Update the node counter display
     */
    updateNodeCounter() {
        const counter = document.getElementById('gallery-node-counter');
        if (counter && this.mediaNodes.length > 0) {
            const currentNode = this.mediaNodes[this.currentIndex];
            const parentGroup = this.findParentGroup(currentNode);
            
            let displayText = `${this.currentIndex + 1} / ${this.mediaNodes.length}`;
            
            if (parentGroup && parentGroup.title) {
                displayText += ` • ${parentGroup.title}`;
            }
            
            counter.textContent = displayText;
        }
    }
    
    /**
     * Handle close button click
     */
    handleCloseClick(e) {
        e.preventDefault();
        e.stopPropagation();
        this.exit();
    }
    
    /**
     * Check if a node should be hidden in gallery mode
     */
    shouldHideNode(node) {
        if (!this.active) return false;
        
        // During transition, show both nodes involved
        if (this.transitionState.active) {
            const { fromNode, toNode } = this.transitionState;
            return node !== fromNode && node !== toNode;
        }
        
        // Normal case - hide all except current
        const currentNode = this.getCurrentNode();
        return currentNode && node.id !== currentNode.id;
    }
    
    /**
     * Check if we should render selection UI
     */
    shouldRenderSelectionUI() {
        return !this.active;
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.GalleryViewManager = GalleryViewManager;
}