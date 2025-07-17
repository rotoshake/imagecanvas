// ===================================
// MAIN CANVAS CLASS
// ===================================

class LGraphCanvas {
    constructor(canvas, graph) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.graph = graph;
        this.graph.canvas = this;
        
        // Core systems
        this.viewport = new ViewportManager(canvas);
        this.selection = new SelectionManager();
        this.handleDetector = new HandleDetector(this.viewport, this.selection);
        this.animationSystem = new AnimationSystem();
        this.alignmentManager = new AutoAlignmentManager(this);
        
        // State
        this.dirty_canvas = true;
        this.mouseState = this.createMouseState();
        this.interactionState = this.createInteractionState();
        
        // Performance
        this.frameCounter = 0;
        this.lastFrameTime = performance.now();
        this.fps = 0;
        
        // Async loading management
        this.loadingQueue = new Set();
        this.preloadQueue = new Set();
        this.maxConcurrentLoads = 3;
        this.currentLoads = 0;
        
        // Undo/redo (will be connected to StateManager)
        this.stateManager = null;
        
        // Clipboard for copy/paste
        this.clipboard = [];
        
        // Initialize
        this.setupEventListeners();
        this.viewport.applyDPI();
        this.animationSystem.start();
        this.startRenderLoop();
        this.startPreloadLoop();
        
        console.log('LGraphCanvas initialized');
    }
    
    createMouseState() {
        return {
            canvas: [0, 0],
            graph: [0, 0],
            last: [0, 0],
            down: false,
            button: -1
        };
    }
    
    createInteractionState() {
        return {
            dragging: {
                canvas: false,
                node: null,
                nodes: new Map(),
                offsets: new Map(),
                isDuplication: false  // Track if this drag is from duplication
            },
            resizing: {
                active: false,
                type: null,
                node: null,
                nodes: new Set(),
                initial: new Map(),
                shiftKey: false,
                initialBBox: null
            },
            rotating: {
                active: false,
                type: null,
                node: null,
                nodes: new Set(),
                center: [0, 0],
                initialAngle: 0,
                initial: new Map()
            },
            selecting: {
                active: false,
                startGraph: [0, 0]
            }
        };
    }
    
    setupEventListeners() {
        // Mouse events
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('wheel', this.onMouseWheel.bind(this));
        this.canvas.addEventListener('contextmenu', e => e.preventDefault());
        this.canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));
        
        // Keyboard events
        document.addEventListener('keydown', this.onKeyDown.bind(this));
        
        // Selection callbacks
        this.selection.addCallback(this.onSelectionChanged.bind(this));
    }
    
    // ===================================
    // EVENT HANDLERS
    // ===================================
    
    onMouseDown(e) {
        // Finish any active text editing
        if (this._editingTextInput) {
            this.finishTextEditing();
        }

        const [x, y] = this.viewport.convertCanvasToOffset(e.clientX, e.clientY);
        this.mouseState.canvas = [x, y];
        this.mouseState.graph = this.viewport.convertOffsetToGraph(x, y);
        this.mouseState.last = [x, y];
        this.mouseState.down = true;
        this.mouseState.button = e.button;
        
        // Debug: log all properties of node under mouse
        const node = this.handleDetector.getNodeAtPosition(...this.mouseState.graph, this.graph.nodes);
        if (node) {
            console.group(`Node Debug: ${node.title || node.type} (id: ${node.id})`);
            console.log('type:', node.type);
            console.log('id:', node.id);
            console.log('pos:', node.pos);
            console.log('size:', node.size);
            console.log('rotation:', node.rotation);
            console.log('aspectRatio:', node.aspectRatio);
            console.log('properties:', node.properties);
            console.log('flags:', node.flags);
            if (typeof node.getVideoInfo === 'function') {
                console.log('videoInfo:', node.getVideoInfo());
            }
            console.groupEnd();
        }
        
        // Stop any active animations that might interfere
        if (this.alignmentManager && this.alignmentManager.isAnimating()) {
            this.alignmentManager.stopAll();
        }
        
        // GRID ALIGN MODE TRIGGER (TAKES PRECEDENCE)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.button === 0) {
            
            if (this.alignmentManager && this.alignmentManager.startGridAlign(this.mouseState.graph)) {
                e.preventDefault();
                return;
            }
        }

        // Handle different interaction modes in priority order
        if (this.handlePanMode(e)) return;
        if (this.handleRotationMode(e)) return;
        if (this.handleResizeMode(e)) return;
        if (this.handleNodeDrag(e)) return;
        if (this.handleAutoAlign(e)) return;
        if (this.handleSelection(e)) return;
        
        e.preventDefault();
    }
    
    onMouseMove(e) {
        const [x, y] = this.viewport.convertCanvasToOffset(e.clientX, e.clientY);
        this.mouseState.canvas = [x, y];
        this.mouseState.graph = this.viewport.convertOffsetToGraph(x, y);
        
        // Handle alignment modes first
        if (this.alignmentManager) {
            if (this.alignmentManager.gridAlignMode && this.alignmentManager.gridAlignDragging) {
                this.alignmentManager.updateGridAlign(this.mouseState.graph);
                this.mouseState.last = [x, y];
                this.dirty_canvas = true;
                return;
            }
            
            if (this.alignmentManager.autoAlignMode) {
                this.alignmentManager.updateAutoAlign(this.mouseState.graph);
                this.mouseState.last = [x, y];
                this.dirty_canvas = true;
                return;
            }
        }
        
        // Regular interaction updates
        this.updateInteractions(e);
        this.updateCursor();
        
        this.mouseState.last = [x, y];
        this.dirty_canvas = true;
    }
    
    onMouseUp(e) {
        // Handle alignment mode endings
        if (this.alignmentManager) {
            if (this.alignmentManager.autoAlignMode) {
                this.alignmentManager.finishAutoAlign();
                this.mouseState.down = false;
                this.mouseState.button = -1;
                this.dirty_canvas = true;
                return;
            }
            
            if (this.alignmentManager.gridAlignMode) {
                this.alignmentManager.finishGridAlign();
                this.mouseState.down = false;
                this.mouseState.button = -1;
                this.dirty_canvas = true;
                return;
            }
        }
        
        // Regular interaction cleanup
        this.finishInteractions();
        
        // Safety: ensure duplication undo state is created even if something went wrong
        if (this.interactionState.dragging.isDuplication) {
            this.pushUndoState();
            this.interactionState.dragging.isDuplication = false;
        }
        
        this.mouseState.down = false;
        this.mouseState.button = -1;
        this.dirty_canvas = true;
    }
    
    onMouseWheel(e) {
        e.preventDefault();
        
        // Manual zoom implementation to avoid viewport validation issues
        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        
        // Get current values safely
        const currentScale = this.viewport.scale || 1;
        const currentOffset = this.viewport.offset || [0, 0];
        const mousePos = this.mouseState.canvas || [0, 0];
        
        // Calculate new scale using config values
        const newScale = Utils.clamp(
            currentScale * zoomFactor,
            CONFIG.CANVAS.MIN_SCALE,
            CONFIG.CANVAS.MAX_SCALE
        );
        
        // Calculate new offset to zoom towards mouse position
        const scaleRatio = newScale / currentScale;
        const newOffset = [
            mousePos[0] - (mousePos[0] - currentOffset[0]) * scaleRatio,
            mousePos[1] - (mousePos[1] - currentOffset[1]) * scaleRatio
        ];
        
        // Set values directly, ensuring they're valid numbers
        this.viewport.scale = newScale;
        this.viewport.offset = [
            isFinite(newOffset[0]) ? newOffset[0] : currentOffset[0],
            isFinite(newOffset[1]) ? newOffset[1] : currentOffset[1]
        ];
        
        // Update text editing overlay if active
        if (this._editingTextInput && this._editingTextNode) {
            this.positionTextEditingOverlay(this._editingTextInput, this._editingTextNode);
            this.updateTextEditingOverlaySize(this._editingTextInput, this._editingTextNode);
        }
        
        // Clear preload queue during zoom - will be repopulated with new nearby nodes
        console.log(`🔍 Zoom detected - clearing preload queue for fresh prioritization`);
        this.clearPreloadQueue();
        
        this.dirty_canvas = true;
    }
    
    onDoubleClick(e) {
        // Check for double-click on handles first
        const rotationHandle = this.handleDetector.getRotationHandle(...this.mouseState.canvas);
        if (rotationHandle) {
            // If multiple nodes are selected, reset all their rotations
            if (this.selection.size() > 1) {
                const selectedNodes = this.selection.getSelectedNodes();
                for (const node of selectedNodes) {
                    node.rotation = 0;
                }
                this.pushUndoState();
                this.dirty_canvas = true;
            } else {
                // Single node selected
                this.resetRotation(rotationHandle);
            }
            return;
        }
        
        const resizeHandle = this.handleDetector.getResizeHandle(...this.mouseState.canvas);
        if (resizeHandle) {
            // If multiple nodes are selected, reset all their aspect ratios
            if (this.selection.size() > 1) {
                const selectedNodes = this.selection.getSelectedNodes();
                for (const node of selectedNodes) {
                    if (node.originalAspect) {
                        node.aspectRatio = node.originalAspect;
                        node.size[1] = node.size[0] / node.originalAspect;
                        if (node.onResize) node.onResize();
                    }
                }
                this.pushUndoState();
                this.dirty_canvas = true;
            } else {
                // Single node selected
                this.resetAspectRatio(resizeHandle);
            }
            return;
        }
        
        // Otherwise, check for node double-click
        const node = this.handleDetector.getNodeAtPosition(...this.mouseState.graph, this.graph.nodes);
        if (node) {
            // Special handling for video nodes with multi-selection
            if (node.type === 'media/video' && this.selection.size() > 1) {
                // Toggle the clicked video
                if (node.onDblClick) {
                    node.onDblClick(e);
                }
                
                // Get the new state of the clicked video
                const clickedVideoState = node.properties.paused;
                
                // Apply the same state to all other selected video nodes
                const selectedNodes = this.selection.getSelectedNodes();
                for (const selectedNode of selectedNodes) {
                    if (selectedNode.type === 'media/video' && selectedNode.id !== node.id) {
                        if (clickedVideoState) {
                            selectedNode.pause();
                        } else {
                            selectedNode.play();
                        }
                    }
                }
                
                this.pushUndoState();
                this.dirty_canvas = true;
                return;
            }
            
            // Call the node's onDblClick method if it exists
            if (node.onDblClick && node.onDblClick(e)) {
                return;
            }
            
            // Fallback to default behaviors
            if (node.type === 'media/text') {
                this.startTextEditing(node, e);
            } else if (this.canEditTitle(node, this.mouseState.graph)) {
                this.startTitleEditing(node, e);
            }
        }
        // else: do nothing on background double-click
    }
    
    onKeyDown(e) {
        if (this.isEditingText()) return;
        
        if (this.handleKeyboardShortcut(e)) {
            e.preventDefault();
        }
    }
    
    onSelectionChanged(selection) {
        this.dirty_canvas = true;
    }
    
    // ===================================
    // INTERACTION HANDLERS
    // ===================================
    
    handlePanMode(e) {
        // Ctrl/Cmd+drag anywhere for canvas pan (highest priority)
        if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
            this.interactionState.dragging.canvas = true;
            return true;
        }
        
        // Alt+drag for node duplication
        if (e.button === 0 && e.altKey) {
            const node = this.handleDetector.getNodeAtPosition(...this.mouseState.graph, this.graph.nodes);
            if (node) {
                this.startNodeDuplication(node, e);
                return true;
            }
        }
        
        // Middle mouse for canvas pan
        if (e.button === 1) {
            this.interactionState.dragging.canvas = true;
            return true;
        }
        
        return false;
    }
    
    
    handleRotationMode(e) {
        if (e.button !== 0) return false;
        
        const rotationHandle = this.handleDetector.getRotationHandle(...this.mouseState.canvas);
        if (rotationHandle) {
            this.startRotation(rotationHandle);
            return true;
        }
        return false;
    }
    
    handleResizeMode(e) {
        if (e.button !== 0) return false;
        
        const resizeHandle = this.handleDetector.getResizeHandle(...this.mouseState.canvas);
        if (resizeHandle) {
            this.startResize(resizeHandle);
            return true;
        }
        return false;
    }
    
    handleNodeDrag(e) {
        if (e.button !== 0) return false;
        
        const node = this.handleDetector.getNodeAtPosition(...this.mouseState.graph, this.graph.nodes);
        if (node) {
            this.startNodeDrag(node, e);
            return true;
        }
        return false;
    }
    
    handleAutoAlign(e) {
        // Auto-align mode: Shift + left click on empty space with multi-selection
        if (e.shiftKey && e.button === 0 && this.selection.size() > 1 &&
            !this.handleDetector.getNodeAtPosition(...this.mouseState.graph, this.graph.nodes)) {
            
            if (this.alignmentManager && this.alignmentManager.startAutoAlign(this.mouseState.graph)) {
                e.preventDefault();
                return true;
            }
        }
        return false;
    }
    
    handleSelection(e) {
        if (e.button === 0) {
            this.startSelection(e);
            return true;
        }
        return false;
    }
    
    // ===================================
    // INTERACTION STARTERS
    // ===================================
    
    startNodeDrag(node, e) {
        if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
            // Shift-click (but not Ctrl+Shift): toggle selection
            if (this.selection.isSelected(node)) {
                // Remove from selection
                this.selection.deselectNode(node);
                // If we just deselected the only node, there's nothing to drag
                if (this.selection.isEmpty()) {
                    return;
                }
                // Use another selected node as the drag reference
                const selectedNodes = this.selection.getSelectedNodes();
                this.interactionState.dragging.node = selectedNodes[0];
            } else {
                // Add to selection
                this.selection.selectNode(node, true);
                this.interactionState.dragging.node = node;
            }
        } else {
            // Regular click or Ctrl+Shift (for grid align)
            if (!this.selection.isSelected(node)) {
                // Node not selected: replace selection with this node
                this.selection.clear();
                this.selection.selectNode(node, true);
            }
            // If node was already selected, keep current selection
            this.interactionState.dragging.node = node;
        }
        
        // Calculate offsets for all selected nodes
        const selectedNodes = this.selection.getSelectedNodes();
        for (const selectedNode of selectedNodes) {
            const offset = [
                selectedNode.pos[0] - this.mouseState.graph[0],
                selectedNode.pos[1] - this.mouseState.graph[1]
            ];
            this.interactionState.dragging.offsets.set(selectedNode.id, offset);
        }
    }
    
    startResize(resizeHandle) {
        this.interactionState.resizing.active = true;
        this.interactionState.resizing.type = resizeHandle.type;
        this.interactionState.resizing.node = resizeHandle.node;
        this.interactionState.resizing.nodes = new Set(resizeHandle.nodes || [resizeHandle.node]);
        
        // Store initial bounding box for multi-resize
        if (resizeHandle.type === 'multi-resize') {
            this.interactionState.resizing.initialBBox = this.selection.getBoundingBox();
        }
        
        // Store initial state for all relevant nodes
        const nodesToStore = this.selection.size() > 1 ? this.selection.getSelectedNodes() : [resizeHandle.node];
        for (const node of nodesToStore) {
            this.interactionState.resizing.initial.set(node.id, {
                pos: [...node.pos],
                size: [...node.size],
                aspect: node.aspectRatio || (node.size[0] / node.size[1])
            });
        }
    }
    
    startRotation(rotationHandle) {
        this.interactionState.rotating.active = true;
        this.interactionState.rotating.type = rotationHandle.type;
        this.interactionState.rotating.node = rotationHandle.node;
        this.interactionState.rotating.nodes = new Set(rotationHandle.nodes || [rotationHandle.node]);
        this.interactionState.rotating.center = rotationHandle.center;
        this.interactionState.rotating.initialAngle = Math.atan2(
            this.mouseState.graph[1] - rotationHandle.center[1],
            this.mouseState.graph[0] - rotationHandle.center[0]
        );
        
        // Store initial state for all relevant nodes
        const nodesToStore = this.selection.size() > 1 ? this.selection.getSelectedNodes() : [rotationHandle.node];
        for (const node of nodesToStore) {
            this.interactionState.rotating.initial.set(node.id, {
                pos: [...node.pos],
                rotation: node.rotation || 0
            });
        }
    }
    
    startSelection(e) {
        this.interactionState.selecting.active = true;
        this.interactionState.selecting.startGraph = [...this.mouseState.graph];
        
        this.selection.startSelection(this.mouseState.graph);
        
        if (!e.shiftKey) {
            this.selection.clear();
        }
    }
    
    startNodeDuplication(node, e) {
        // Check if multiple nodes are selected
        const isMultiSelection = this.selection.size() > 1 && this.selection.isSelected(node);
        
        let duplicates = [];
        let draggedDuplicate = null;
        
        if (isMultiSelection) {
            // Multi-selection: duplicate all selected nodes
            const selectedNodes = this.selection.getSelectedNodes();
            const offset = 20;
            
            for (const selectedNode of selectedNodes) {
                const duplicate = this.duplicateNode(selectedNode);
                if (duplicate) {
                    // Position duplicate with offset
                    duplicate.pos[0] = selectedNode.pos[0] + offset;
                    duplicate.pos[1] = selectedNode.pos[1] + offset;
                    
                    this.graph.add(duplicate);
                    duplicates.push(duplicate);
                    
                    // Remember which duplicate corresponds to the dragged node
                    if (selectedNode.id === node.id) {
                        draggedDuplicate = duplicate;
                    }
                }
            }
        } else {
            // Single node: duplicate just this node
            const duplicate = this.duplicateNode(node);
            if (duplicate) {
                duplicate.pos[0] = node.pos[0] + 20;
                duplicate.pos[1] = node.pos[1] + 20;
                this.graph.add(duplicate);
                duplicates.push(duplicate);
                draggedDuplicate = duplicate;
            }
        }
        
        if (duplicates.length === 0) return;
        
        // Clear selection and select all duplicates
        this.selection.clear();
        duplicates.forEach(dup => this.selection.selectNode(dup, true));
        
        // Start dragging all duplicates, using the dragged duplicate as reference
        this.interactionState.dragging.node = draggedDuplicate;
        this.interactionState.dragging.isDuplication = true;  // Mark as duplication drag
        
        // Calculate offsets for all duplicates
        for (const duplicate of duplicates) {
            const offset = [
                duplicate.pos[0] - this.mouseState.graph[0],
                duplicate.pos[1] - this.mouseState.graph[1]
            ];
            this.interactionState.dragging.offsets.set(duplicate.id, offset);
        }
        
        // DON'T push undo state yet - wait until drag is complete for atomic operation
        this.dirty_canvas = true;
    }
    // ===================================
    // INTERACTION UPDATES
    // ===================================
    
    updateInteractions(e) {
        if (this.interactionState.dragging.canvas) {
            this.updateCanvasDrag();
        } else if (this.interactionState.dragging.node) {
            this.updateNodeDrag();
        } else if (this.interactionState.resizing.active) {
            this.updateResize(e);
        } else if (this.interactionState.rotating.active) {
            this.updateRotation(e);
        } else if (this.interactionState.selecting.active) {
            this.updateSelection();
        }
    }
    
    updateCanvasDrag() {
        const dx = this.mouseState.canvas[0] - this.mouseState.last[0];
        const dy = this.mouseState.canvas[1] - this.mouseState.last[1];
        this.viewport.pan(dx, dy);
        
        // Update text editing overlay if active
        if (this._editingTextInput && this._editingTextNode) {
            this.positionTextEditingOverlay(this._editingTextInput, this._editingTextNode);
        }
    }
    
    updateNodeDrag() {
        for (const [nodeId, offset] of this.interactionState.dragging.offsets) {
            const node = this.graph.getNodeById(nodeId);
            if (node) {
                node.pos[0] = this.mouseState.graph[0] + offset[0];
                node.pos[1] = this.mouseState.graph[1] + offset[1];
            }
        }
        // Invalidate selection bounding box cache when nodes move
        this.selection.invalidateBoundingBox();
    }
    
    updateResize(e) {
        const mouseX = this.mouseState.graph[0];
        const mouseY = this.mouseState.graph[1];
        
        if (this.interactionState.resizing.type === 'single-resize') {
            this.updateSingleResize(mouseX, mouseY, e.shiftKey, e.ctrlKey || e.metaKey);
        } else if (this.interactionState.resizing.type === 'multi-resize') {
            this.updateMultiResize(mouseX, mouseY, e.shiftKey, e.ctrlKey || e.metaKey);
        }
    }
    
    updateSingleResize(mouseX, mouseY, shift, ctrl) {
        const node = this.interactionState.resizing.node;
        const initial = this.interactionState.resizing.initial.get(node.id);
        if (!initial) return;
        
        const newWidth = Math.max(50, mouseX - initial.pos[0]);
        const newHeight = Math.max(50, mouseY - initial.pos[1]);
        
        // Check if we're in multi-selection context
        const isMultiSelection = this.selection.size() > 1;
        
        if (isMultiSelection) {
            // Multi-selection: apply delta to all selected nodes
            if (ctrl && shift) {
                // Ctrl+Shift: Match all nodes to dragged node's size and aspect ratio
                const targetWidth = newWidth;
                const targetHeight = shift ? newHeight : newWidth / initial.aspect;
                const targetAspect = targetWidth / targetHeight;
                
                for (const selectedNode of this.selection.getSelectedNodes()) {
                    selectedNode.size[0] = targetWidth;
                    selectedNode.size[1] = targetHeight;
                    selectedNode.aspectRatio = targetAspect;
                    if (selectedNode.onResize) selectedNode.onResize();
                }
            } else {
                // Normal multi-selection scaling: apply delta to all
                const scaleX = newWidth / initial.size[0];
                const scaleY = shift ? (newHeight / initial.size[1]) : scaleX;
                
                for (const selectedNode of this.selection.getSelectedNodes()) {
                    const nodeInitial = this.interactionState.resizing.initial.get(selectedNode.id);
                    if (!nodeInitial) continue;
                    
                    selectedNode.size[0] = Math.max(50, nodeInitial.size[0] * scaleX);
                    selectedNode.size[1] = Math.max(50, nodeInitial.size[1] * scaleY);
                    selectedNode.aspectRatio = selectedNode.size[0] / selectedNode.size[1];
                    if (selectedNode.onResize) selectedNode.onResize();
                }
                // Invalidate bounding box cache after batch resize
                this.selection.invalidateBoundingBox();
            }
        } else {
            // Single node: original behavior
            if (shift) {
                // Non-uniform scaling
                node.size[0] = newWidth;
                node.size[1] = newHeight;
                node.aspectRatio = node.size[0] / node.size[1];
            } else {
                // Maintain aspect ratio
                node.size[0] = newWidth;
                node.size[1] = newWidth / initial.aspect;
                node.aspectRatio = initial.aspect;
            }
            
            if (node.onResize) {
                node.onResize();
            }
            
            // Invalidate bounding box cache after single node resize
            this.selection.invalidateBoundingBox();
        }
    }
    
    updateMultiResize(mouseX, mouseY, shift, ctrl) {
        const initialBBox = this.interactionState.resizing.initialBBox;
        if (!initialBBox) return;
        
        const [bx, by, bw, bh] = initialBBox;
        const newWidth = Math.max(bw * 0.1, mouseX - bx);
        const newHeight = Math.max(bh * 0.1, mouseY - by);
        
        let scaleX = newWidth / bw;
        let scaleY = newHeight / bh;
        
        if (!shift) {
            // Uniform scaling - use minimum scale to maintain proportions
            const scale = Math.min(scaleX, scaleY);
            scaleX = scaleY = scale;
        }
        
        // Apply scaling to all selected nodes relative to bounding box
        for (const node of this.selection.selectedNodes.values()) {
            const initial = this.interactionState.resizing.initial.get(node.id);
            if (!initial) continue;
            
            // Scale size
            node.size[0] = Math.max(50, initial.size[0] * scaleX);
            node.size[1] = Math.max(50, initial.size[1] * scaleY);
            node.aspectRatio = node.size[0] / node.size[1];
            
            // Scale position relative to bounding box origin
            node.pos[0] = bx + (initial.pos[0] - bx) * scaleX;
            node.pos[1] = by + (initial.pos[1] - by) * scaleY;
            
            if (node.onResize) {
                node.onResize();
            }
        }
        
        // Invalidate bounding box cache after multi-resize
        this.selection.invalidateBoundingBox();
    }
    
    updateRotation(e) {
        const { type, center, initialAngle, initial } = this.interactionState.rotating;
        
        const currentAngle = Math.atan2(
            this.mouseState.graph[1] - center[1],
            this.mouseState.graph[0] - center[0]
        );
        
        let deltaAngle = currentAngle - initialAngle;
        let deltaDegrees = deltaAngle * 180 / Math.PI;
        
        if (type === 'single-rotation') {
            const node = this.interactionState.rotating.node;
            const initialRotation = initial.get(node.id)?.rotation || 0;
            
            // Check if we're in multi-selection context
            const isMultiSelection = this.selection.size() > 1;
            
            if (isMultiSelection) {
                // Multi-selection: apply rotation delta to all selected nodes around their individual centers
                for (const selectedNode of this.selection.getSelectedNodes()) {
                    const nodeInitial = initial.get(selectedNode.id);
                    if (!nodeInitial) continue;
                    
                    let newRotation = nodeInitial.rotation + deltaDegrees;
                    
                    // Snap to absolute angles when Shift is held
                    if (e.shiftKey) {
                        const snapAngle = CONFIG.HANDLES.ROTATION_SNAP_ANGLE;
                        newRotation = Math.round(newRotation / snapAngle) * snapAngle;
                    }
                    
                    selectedNode.rotation = newRotation % 360;
                }
            } else {
                // Single node: original behavior
                let newRotation = initialRotation + deltaDegrees;
                
                // Snap to absolute angles when Shift is held
                if (e.shiftKey) {
                    const snapAngle = CONFIG.HANDLES.ROTATION_SNAP_ANGLE;
                    newRotation = Math.round(newRotation / snapAngle) * snapAngle;
                }
                
                node.rotation = newRotation % 360;
            }
        } else {
            // Multi-rotation: rotate around group center
            
            // Snap the delta angle when Shift is held (for orbital rotation)
            if (e.shiftKey) {
                const snapAngle = CONFIG.HANDLES.ROTATION_SNAP_ANGLE;
                const snappedDeltaDegrees = Math.round(deltaDegrees / snapAngle) * snapAngle;
                deltaAngle = snappedDeltaDegrees * Math.PI / 180;
                deltaDegrees = snappedDeltaDegrees;
            }
            
            const cos = Math.cos(deltaAngle);
            const sin = Math.sin(deltaAngle);
            
            for (const node of this.interactionState.rotating.nodes) {
                const initialState = initial.get(node.id);
                if (!initialState) continue;
                
                // Rotate position around center
                const dx = initialState.pos[0] + node.size[0] / 2 - center[0];
                const dy = initialState.pos[1] + node.size[1] / 2 - center[1];
                
                const newDx = dx * cos - dy * sin;
                const newDy = dx * sin + dy * cos;
                
                node.pos[0] = center[0] + newDx - node.size[0] / 2;
                node.pos[1] = center[1] + newDy - node.size[1] / 2;
                
                // Rotate node itself (no snapping for individual rotation in group mode)
                node.rotation = (initialState.rotation + deltaDegrees) % 360;
            }
        }
    }
    
    updateSelection() {
        this.selection.updateSelection(this.mouseState.graph);
    }
    
    updateCursor() {
        if (this.mouseState.down) return; // Don't change cursor during interactions
        
        const cursor = this.handleDetector.getCursor(...this.mouseState.canvas);
        this.canvas.style.cursor = cursor;
    }
    
    // ===================================
    // FINISH INTERACTIONS
    // ===================================
    
    finishInteractions() {
        const wasInteracting = this.isInteracting();
        
        // Canvas pan
        if (this.interactionState.dragging.canvas) {
            this.interactionState.dragging.canvas = false;
            this.debouncedSave(); // Save viewport state
        }
        
        // Node drag
        if (this.interactionState.dragging.node) {
            const wasDuplication = this.interactionState.dragging.isDuplication;
            
            this.interactionState.dragging.node = null;
            this.interactionState.dragging.offsets.clear();
            this.interactionState.dragging.isDuplication = false;
            
            // For duplication: always create undo state (even without movement)
            // For regular drag: only create undo state if there was interaction
            if (wasDuplication || wasInteracting) {
                this.pushUndoState();
            }
        }
        
        // Resize
        if (this.interactionState.resizing.active) {
            this.interactionState.resizing.active = false;
            this.interactionState.resizing.node = null;
            this.interactionState.resizing.nodes.clear();
            this.interactionState.resizing.initial.clear();
            this.interactionState.resizing.initialBBox = null; // Clear initial bbox on finish
            if (wasInteracting) this.pushUndoState();
        }
        
        // Rotation
        if (this.interactionState.rotating.active) {
            this.interactionState.rotating.active = false;
            this.interactionState.rotating.node = null;
            this.interactionState.rotating.nodes.clear();
            this.interactionState.rotating.initial.clear();
            if (wasInteracting) this.pushUndoState();
        }
        
        // Selection
        if (this.interactionState.selecting.active) {
            this.selection.finishSelection(this.graph.nodes);
            this.interactionState.selecting.active = false;
        }
        
        this.canvas.style.cursor = 'default';
    }
    
    isInteracting() {
        return this.interactionState.dragging.node ||
               this.interactionState.resizing.active ||
               this.interactionState.rotating.active;
    }
    
    // ===================================
    // KEYBOARD SHORTCUTS
    // ===================================
    
    handleKeyboardShortcut(e) {
        const key = e.key.toLowerCase();
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        const alt = e.altKey;
        
        // Undo/Redo
        if (ctrl && key === 'z' && !shift) {
            this.undo();
            return true;
        }
        if (ctrl && ((key === 'z' && shift) || key === 'y')) {
            this.redo();
            return true;
        }
        
        // Copy/Cut/Paste
        if (ctrl && key === 'c') {
            this.copySelected();
            return true;
        }
        if (ctrl && key === 'x') {
            this.cutSelected();
            return true;
        }
        if (ctrl && key === 'v') {
            this.paste();
            return true;
        }
        if (ctrl && key === 'd') {
            this.duplicateSelected();
            return true;
        }
        
        // Selection
        if (ctrl && key === 'a') {
            this.selectAll();
            return true;
        }
        
        // Delete
        if (key === 'delete' || key === 'backspace') {
            this.deleteSelected();
            return true;
        }
        
        // View controls
        if (key === 'f') {
            this.zoomToFit();
            return true;
        }
        if (key === 'h') {
            this.resetView();
            return true;
        }
        
        // Zoom controls
        if (key === '=' || key === '+') {
            this.keyboardZoom(2.0);
            return true;
        }
        if (key === '-') {
            this.keyboardZoom(0.5);
            return true;
        }
        
        // Layer controls
        if (key === '[') {
            this.moveSelectedDown();
            return true;
        }
        if (key === ']') {
            this.moveSelectedUp();
            return true;
        }
        
        // Create new text node
        if (key === 't' && !shift) {
            this.createTextNodeAt(this.mouseState.graph);
            return true;
        }
        
        // Toggle title visibility
        if (key === 't' && shift) {
            this.toggleTitleVisibility();
            return true;
        }
        
        // Alignment shortcuts
        if (key === '1') {
            this.alignSelected('horizontal');
            return true;
        }
        if (key === '2') {
            this.alignSelected('vertical');
            return true;
        }
        
        return false;
    }
    
    // ===================================
    // UTILITY METHODS
    // ===================================
    
    copySelected() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) return;
        
        this.clipboard = selected.map(node => this.serializeNode(node));
        console.log(`Copied ${selected.length} nodes`);
    }
    
    cutSelected() {
        this.copySelected();
        this.deleteSelected();
    }
    
    paste() {
        if (!this.clipboard || this.clipboard.length === 0) return;
        
        const offset = 20;
        const newNodes = [];
        
        for (const nodeData of this.clipboard) {
            const node = this.deserializeNode(nodeData);
            if (node) {
                node.pos[0] += offset;
                node.pos[1] += offset;
                this.graph.add(node);
                newNodes.push(node);
            }
        }
        
        if (newNodes.length > 0) {
            this.selection.clear();
            newNodes.forEach(node => this.selection.selectNode(node, true));
            this.pushUndoState();
            this.dirty_canvas = true;
        }
    }
    
    duplicateSelected() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) return;
        
        const duplicates = [];
        const offset = 20;
        
        for (const node of selected) {
            const duplicate = this.duplicateNode(node);
            if (duplicate) {
                duplicate.pos[0] += offset;
                duplicate.pos[1] += offset;
                this.graph.add(duplicate);
                duplicates.push(duplicate);
            }
        }
        
        if (duplicates.length > 0) {
            this.selection.clear();
            duplicates.forEach(dup => this.selection.selectNode(dup, true));
            this.pushUndoState();
            this.dirty_canvas = true;
        }
    }
    
    deleteSelected() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) return;
        
        this.pushUndoState();
        
        for (const node of selected) {
            this.graph.remove(node);
        }
        
        this.selection.clear();
        this.dirty_canvas = true;
    }
    
    selectAll() {
        this.selection.selectAll(this.graph.nodes);
    }
    
    zoomToFit() {
        if (this.selection.isEmpty()) {
            this.zoomToFitAll();
        } else {
            this.zoomToFitSelection();
        }
    }
    
    zoomToFitAll() {
        const bbox = this.graph.getBoundingBox();
        if (bbox) {
            this.viewport.zoomToFit(bbox);
            this.dirty_canvas = true;
        }
    }
    
    zoomToFitSelection() {
        const bbox = this.selection.getBoundingBox();
        if (bbox) {
            this.viewport.zoomToFit(bbox);
            this.dirty_canvas = true;
        }
    }
    
    keyboardZoom(factor) {
        // Get canvas center as zoom pivot point
        const canvasWidth = this.canvas.width / this.viewport.dpr;
        const canvasHeight = this.canvas.height / this.viewport.dpr;
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        
        // Calculate new scale
        const currentScale = this.viewport.scale;
        const newScale = Utils.clamp(
            currentScale * factor,
            CONFIG.CANVAS.MIN_SCALE,
            CONFIG.CANVAS.MAX_SCALE
        );
        
        if (newScale !== currentScale) {
            // Apply zoom centered on canvas
            const scaleRatio = newScale / currentScale;
            this.viewport.offset[0] = centerX - (centerX - this.viewport.offset[0]) * scaleRatio;
            this.viewport.offset[1] = centerY - (centerY - this.viewport.offset[1]) * scaleRatio;
            this.viewport.scale = newScale;
            this.dirty_canvas = true;
        }
    }
    
    resetView() {
        // Panic button: move all nodes to graph origin (0,0) and reset viewport
        const nodes = this.graph.nodes;
        
        if (nodes.length > 0) {
            // Calculate current bounding box of all nodes
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            
            for (const node of nodes) {
                const [x, y, w, h] = node.getBoundingBox();
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x + w);
                maxY = Math.max(maxY, y + h);
            }
            
            // Calculate current center of all nodes
            const currentCenterX = (minX + maxX) / 2;
            const currentCenterY = (minY + maxY) / 2;
            
            // Move all nodes so their center is at graph origin (0, 0)
            const deltaX = -currentCenterX;
            const deltaY = -currentCenterY;
            
            this.pushUndoState(); // Save state before moving nodes
            
            for (const node of nodes) {
                node.pos[0] += deltaX;
                node.pos[1] += deltaY;
            }
        }
        
        // Reset viewport to standard home position
        this.viewport.scale = 1.0;
        const canvasWidth = this.canvas.width / this.viewport.dpr;
        const canvasHeight = this.canvas.height / this.viewport.dpr;
        this.viewport.offset = [canvasWidth / 2, canvasHeight / 2];
        
        this.dirty_canvas = true;
        this.debouncedSave();
    }
    
    alignSelected(axis) {
        const selected = this.selection.getSelectedNodes();
        if (selected.length < 2) return;
        
        this.pushUndoState();
        if (this.alignmentAnimator) {
            this.alignmentAnimator.alignNodes(selected, axis);
        }
    }
    
    moveSelectedUp() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length !== 1) return;
        
        this.graph.moveNodeUp(selected[0]);
        this.pushUndoState();
        this.dirty_canvas = true;
    }
    
    moveSelectedDown() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length !== 1) return;
        
        this.graph.moveNodeDown(selected[0]);
        this.pushUndoState();
        this.dirty_canvas = true;
    }
    
    createTextNodeAtCenter() {
        const viewport = this.viewport.getViewport();
        const center = [
            viewport.x + viewport.width / 2,
            viewport.y + viewport.height / 2
        ];
        this.createTextNodeAt(center);
    }
    
    createTextNodeAt(pos) {
        if (typeof NodeFactory === 'undefined') {
            console.warn('NodeFactory not available');
            return;
        }
        
        const node = NodeFactory.createNode('media/text');
        if (node) {
            node.pos = [pos[0] - node.size[0] / 2, pos[1] - node.size[1] / 2];
            if (node.setText) {
                node.setText('Text');
            }
            this.graph.add(node);
            this.selection.selectNode(node);
            this.pushUndoState();
            this.dirty_canvas = true;
        }
    }
    
    toggleTitleVisibility() {
        const selected = this.selection.getSelectedNodes();
        const nonTextNodes = selected.filter(node => node.type !== 'media/text');
        
        if (nonTextNodes.length === 0) return;
        
        // Determine current state
        const hiddenCount = nonTextNodes.filter(node => node.flags?.hide_title).length;
        const newHiddenState = hiddenCount < nonTextNodes.length;
        
        for (const node of nonTextNodes) {
            if (!node.flags) node.flags = {};
            node.flags.hide_title = newHiddenState;
        }
        
        this.pushUndoState();
        this.dirty_canvas = true;
    }
    
    // ===================================
    // NODE UTILITIES
    // ===================================
    
    duplicateNode(originalNode) {
        const nodeData = this.serializeNode(originalNode);
        return this.deserializeNode(nodeData);
    }
    
    serializeNode(node) {
        return {
            type: node.type,
            pos: [...node.pos],
            size: [...node.size],
            title: node.title,
            properties: { ...node.properties },
            flags: { ...node.flags },
            aspectRatio: node.aspectRatio,
            rotation: node.rotation
        };
    }
    
    deserializeNode(nodeData) {
        if (typeof NodeFactory === 'undefined') {
            console.warn('NodeFactory not available');
            return null;
        }
        
        const node = NodeFactory.createNode(nodeData.type);
        if (!node) return null;
        
        node.pos = [...nodeData.pos];
        node.size = [...nodeData.size];
        node.title = nodeData.title;
        node.properties = { ...nodeData.properties };
        node.flags = { ...nodeData.flags };
        node.aspectRatio = nodeData.aspectRatio || 1;
        node.rotation = nodeData.rotation || 0;
        
        // Load media content if available
        if ((nodeData.type === 'media/image' || nodeData.type === 'media/video') && nodeData.properties.hash) {
            if (window.imageCache) {
                const cached = window.imageCache.get(nodeData.properties.hash);
                if (cached) {
                    if (nodeData.type === 'media/video' && node.setVideo) {
                        node.setVideo(cached, nodeData.properties.filename, nodeData.properties.hash);
                    } else if (node.setImage) {
                        node.setImage(cached, nodeData.properties.filename, nodeData.properties.hash);
                    }
                }
            }
        }
        
        return node;
    }
    
    // ===================================
    // EDITING SUPPORT
    // ===================================
    
    isEditingText() {
        return this._editingTitleInput || this._editingTextInput;
    }
    
    canEditTitle(node, pos) {
        if (node.flags?.hide_title) return false;
        if (!node.title) return false;
        
        // Check if click is in title area
        const titleHeight = 24;
        return pos[1] >= node.pos[1] - titleHeight && pos[1] <= node.pos[1];
    }
    
    startTitleEditing(node, e) {
        // Implementation for title editing...
        console.log('Start title editing for node:', node.id);
    }
    
    startTextEditing(node, e) {
        if (this._editingTextInput) {
            this.finishTextEditing();
        }

        // Mark node as editing
        node.startEditing();
        
        // Create WYSIWYG textarea overlay
        const textarea = document.createElement('textarea');
        textarea.value = node.properties.text || '';
        textarea.style.position = 'fixed';
        textarea.style.zIndex = '10000';
        textarea.style.resize = 'none';
        textarea.style.border = '2px solid #4af';
        textarea.style.outline = 'none';
        textarea.style.background = 'transparent';
        textarea.style.color = node.properties.textColor;
        textarea.style.fontFamily = node.properties.fontFamily;
        textarea.style.fontSize = `${node.properties.fontSize * this.viewport.scale}px`;
        textarea.style.textAlign = node.properties.textAlign;
        textarea.style.lineHeight = node.properties.leadingFactor;
        textarea.style.padding = `${node.properties.padding * this.viewport.scale}px`;
        textarea.style.overflow = 'hidden';
        textarea.style.whiteSpace = 'pre-wrap';
        textarea.style.wordWrap = 'break-word';

        // Position and size the textarea to match the node
        this.positionTextEditingOverlay(textarea, node);

        // Event handlers
        textarea.addEventListener('blur', () => this.finishTextEditing());
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.cancelTextEditing();
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.finishTextEditing();
            }
            e.stopPropagation();
        });

        // Update text and size in real-time
        textarea.addEventListener('input', () => {
            node.properties.text = textarea.value;
            this.dirty_canvas = true;
            this.updateTextEditingOverlaySize(textarea, node);
        });

        // Add to DOM and focus
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        // Store references
        this._editingTextInput = textarea;
        this._editingTextNode = node;
    }

    positionTextEditingOverlay(textarea, node) {
        // Use animated position if available
        let nodePos = node.pos;
        if (node._gridAnimPos) {
            nodePos = node._gridAnimPos;
        } else if (node._animPos) {
            nodePos = node._animPos;
        }

        const [screenX, screenY] = this.viewport.convertGraphToOffset(nodePos[0], nodePos[1]);
        const rect = this.canvas.getBoundingClientRect();
        
        textarea.style.left = `${rect.left + screenX}px`;
        textarea.style.top = `${rect.top + screenY}px`;
        textarea.style.width = `${node.size[0] * this.viewport.scale}px`;
        textarea.style.height = `${node.size[1] * this.viewport.scale}px`;
    }

    updateTextEditingOverlaySize(textarea, node) {
        // Update overlay size to match node
        textarea.style.width = `${node.size[0] * this.viewport.scale}px`;
        textarea.style.height = `${node.size[1] * this.viewport.scale}px`;
        textarea.style.fontSize = `${node.properties.fontSize * this.viewport.scale}px`;
        textarea.style.padding = `${node.properties.padding * this.viewport.scale}px`;
    }

    finishTextEditing() {
        if (!this._editingTextInput || !this._editingTextNode) return;

        const node = this._editingTextNode;
        const textarea = this._editingTextInput;
        
        // Update node text
        node.properties.text = textarea.value;
        node.stopEditing();
        
        // Auto-resize if needed
        if (node.autoResize) {
            node.autoResize();
        }

        // Cleanup
        document.body.removeChild(textarea);
        this._editingTextInput = null;
        this._editingTextNode = null;
        
        this.pushUndoState();
        this.dirty_canvas = true;
    }

    cancelTextEditing() {
        if (!this._editingTextInput || !this._editingTextNode) return;

        const node = this._editingTextNode;
        const textarea = this._editingTextInput;
        
        // Restore original text (no changes)
        node.stopEditing();
        
        // Cleanup
        document.body.removeChild(textarea);
        this._editingTextInput = null;
        this._editingTextNode = null;
        
        this.dirty_canvas = true;
    }
    
    resetAspectRatio(resizeHandle) {
        if (resizeHandle.type === 'single-resize') {
            const node = resizeHandle.node;
            if (node.originalAspect) {
                node.aspectRatio = node.originalAspect;
                node.size[1] = node.size[0] / node.originalAspect;
                if (node.onResize) node.onResize();
                this.pushUndoState();
                this.dirty_canvas = true;
            }
        } else if (resizeHandle.type === 'multi-resize') {
            // Reset all selected nodes to their individual original aspect ratios
            for (const node of resizeHandle.nodes) {
                if (node.originalAspect) {
                    node.aspectRatio = node.originalAspect;
                    node.size[1] = node.size[0] / node.originalAspect;
                    if (node.onResize) node.onResize();
                }
            }
            this.pushUndoState();
            this.dirty_canvas = true;
        }
    }
    
    resetRotation(rotationHandle) {
        if (rotationHandle.type === 'single-rotation') {
            rotationHandle.node.rotation = 0;
        } else {
            for (const node of rotationHandle.nodes) {
                node.rotation = 0;
            }
        }
        this.pushUndoState();
        this.dirty_canvas = true;
    }
    
    // ===================================
    // UNDO/REDO SYSTEM
    // ===================================
    
    setStateManager(stateManager) {
        this.stateManager = stateManager;
    }
    
    pushUndoState() {
        if (this.stateManager && typeof this.stateManager.pushUndoState === 'function') {
            this.stateManager.pushUndoState(this.graph, this);
        } else {
            console.warn('State manager not available for undo');
        }
    }
    
    undo() {
        if (this.stateManager && typeof this.stateManager.undo === 'function') {
            const success = this.stateManager.undo(this.graph, this);
            if (success) {
                this.selection.clear();
                this.dirty_canvas = true;
            }
        } else {
            console.warn('State manager not available for undo');
        }
    }
    
    redo() {
        if (this.stateManager && typeof this.stateManager.redo === 'function') {
            const success = this.stateManager.redo(this.graph, this);
            if (success) {
                this.selection.clear();
                this.dirty_canvas = true;
            }
        } else {
            console.warn('State manager not available for redo');
        }
    }
    
    // ===================================
    // DEBOUNCED OPERATIONS
    // ===================================
    
    debouncedSave() {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
        }
        this._saveTimeout = setTimeout(() => {
            if (this.stateManager) {
                this.stateManager.saveState(this.graph, this);
            }
        }, 500);
    }
    
    // ===================================
    // RENDERING SYSTEM
    // ===================================
    
    startRenderLoop() {
        const render = (timestamp) => {
            this.updatePerformanceStats(timestamp);
            
            // Update alignment animations
            if (this.alignmentManager) {
                this.alignmentManager.updateAnimations();
            }
            
            if (this.dirty_canvas) {
                this.draw();
                this.dirty_canvas = false;
            }
            
            // Check if any videos are playing or alignment is active
            const hasActiveVideos = this.graph.nodes.some(node => 
                node.type === 'media/video' && node.video && !node.video.paused
            );
            
            const hasActiveAlignment = this.alignmentManager && this.alignmentManager.isAnimating();
            
            if (hasActiveVideos || hasActiveAlignment) {
                this.dirty_canvas = true;
            }
            
            requestAnimationFrame(render);
        };
        
        requestAnimationFrame(render);
    }
    
    startPreloadLoop() {
        const processLoadingQueue = async () => {
            // Process visible nodes first (high priority)
            if (this.loadingQueue.size > 0 && this.currentLoads < this.maxConcurrentLoads) {
                const nodeId = this.loadingQueue.values().next().value;
                this.loadingQueue.delete(nodeId);
                
                const node = this.graph.getNodeById(nodeId);
                if (node && node.loadingState === 'idle') {
                    this.currentLoads++;
                    
                    try {
                        const success = await this.loadNodeFromCache(node);
                        if (success) {
                            this.dirty_canvas = true; // Trigger redraw
                        }
                    } finally {
                        this.currentLoads--;
                    }
                }
            }
            
            // Process preload queue if we have spare capacity
            else if (this.preloadQueue.size > 0 && this.currentLoads < this.maxConcurrentLoads) {
                const nodeId = this.preloadQueue.values().next().value;
                this.preloadQueue.delete(nodeId);
                
                const node = this.graph.getNodeById(nodeId);
                if (node && node.loadingState === 'idle') {
                    this.currentLoads++;
                    
                    try {
                        await this.loadNodeFromCache(node);
                        // Don't trigger redraw for preloads unless visible
                        if (this.viewport.isNodeVisible(node, CONFIG.PERFORMANCE.VISIBILITY_MARGIN)) {
                            this.dirty_canvas = true;
                        }
                    } finally {
                        this.currentLoads--;
                    }
                }
            }
            
            // Schedule next processing cycle
            setTimeout(processLoadingQueue, 16); // ~60fps processing
        };
        
        processLoadingQueue();
    }
    
    clearPreloadQueue() {
        this.preloadQueue.clear();
        // Keep visible queue since those are important
    }

    clearAllQueues() {
        this.loadingQueue.clear();
        this.preloadQueue.clear();
    }
    
    updatePerformanceStats(timestamp) {
        this.frameCounter++;
        
        if (timestamp - this.lastFrameTime >= 1000) {
            this.fps = this.frameCounter;
            this.frameCounter = 0;
            this.lastFrameTime = timestamp;
        }
    }
    
    draw() {
        if (!this.ctx) return;
        
        const startTime = performance.now();
        
        const ctx = this.ctx;
        const canvas = this.canvas;
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw background
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw grid
        this.drawGrid(ctx);
        
        const gridTime = performance.now();
        
        // Apply viewport transformation
        ctx.save();
        ctx.translate(this.viewport.offset[0], this.viewport.offset[1]);
        ctx.scale(this.viewport.scale, this.viewport.scale);
        
        // Get visible nodes for performance
        const visibleNodes = this.viewport.getVisibleNodes(
            this.graph.nodes, 
            this.getConfig('PERFORMANCE.VISIBILITY_MARGIN', 200)
        );
        
        const cullTime = performance.now();
        
        // Update node visibility and loading
        this.updateNodeVisibility(visibleNodes);
        
        // Draw all visible nodes
        for (const node of visibleNodes) {
            this.drawNode(ctx, node);
        }
        
        const nodesTime = performance.now();
        
        ctx.restore();
        
        // Draw UI overlays (selection, handles, etc.)
        this.drawOverlays(ctx);
        
        // Draw performance stats
        this.drawStats(ctx);
        
        const uiTime = performance.now();
        
        const totalTime = uiTime - startTime;
        
        // Log performance if frame takes longer than 16ms (below 60fps)
        if (totalTime > 16) {
            console.log(`🐌 Slow frame: ${totalTime.toFixed(1)}ms total (grid: ${(gridTime-startTime).toFixed(1)}ms, cull: ${(cullTime-gridTime).toFixed(1)}ms, nodes: ${(nodesTime-cullTime).toFixed(1)}ms, ui: ${(uiTime-nodesTime).toFixed(1)}ms)`);
        }
    }
    
    drawGrid(ctx) {
        if (!this.viewport.shouldDrawGrid()) return;
        
        const gridInfo = this.viewport.getGridOffset();
        ctx.fillStyle = '#333';
        
        for (let x = gridInfo.x; x < this.canvas.width; x += gridInfo.spacing) {
            for (let y = gridInfo.y; y < this.canvas.height; y += gridInfo.spacing) {
                ctx.fillRect(x - 1, y - 1, 2, 2);
            }
        }
    }
    
    updateNodeVisibility(visibleNodes) {
        // Queue media loading for visible nodes (non-blocking)
        for (const node of visibleNodes) {
            if ((node.type === 'media/image' || node.type === 'media/video') && 
                node.loadingState === 'idle' && node.properties.hash) {
                this.queueNodeLoading(node, 'visible');
            }
        }
        
        // Queue preloading for nearby nodes
        this.queueNearbyNodes();
    }
    
    queueNodeLoading(node, priority = 'normal') {
        if (this.loadingQueue.has(node.id) || this.preloadQueue.has(node.id)) {
            return; // Already queued
        }
        
        if (priority === 'visible') {
            // High priority: visible nodes go to front of loading queue
            this.loadingQueue.add(node.id);
        } else {
            // Lower priority: nearby nodes go to preload queue
            this.preloadQueue.add(node.id);
        }
    }
    
    queueNearbyNodes() {
        // Only queue a few nearby nodes to avoid excessive preloading
        const viewport = this.viewport.getViewport();
        const expandedMargin = CONFIG.PERFORMANCE.VISIBILITY_MARGIN * 2;
        
        let nearbyCount = 0;
        const maxNearby = 10; // Limit preloading
        
        for (const node of this.graph.nodes) {
            if (nearbyCount >= maxNearby) break;
            
            if ((node.type === 'media/image' || node.type === 'media/video') && 
                node.loadingState === 'idle' && node.properties.hash &&
                !this.loadingQueue.has(node.id) && !this.preloadQueue.has(node.id)) {
                
                // Check if nearby (but not visible)
                if (this.viewport.isNodeVisible(node, expandedMargin) && 
                    !this.viewport.isNodeVisible(node, CONFIG.PERFORMANCE.VISIBILITY_MARGIN)) {
                    this.queueNodeLoading(node, 'preload');
                    nearbyCount++;
                }
            }
        }
    }
    
    async loadNodeFromCache(node) {
        if (!window.imageCache) return false;
        
        const cached = window.imageCache.get(node.properties.hash);
        if (cached) {
            try {
                if (node.type === 'media/video' && node.setVideo) {
                    await node.setVideo(cached, node.properties.filename, node.properties.hash);
                } else if (node.setImage) {
                    await node.setImage(cached, node.properties.filename, node.properties.hash);
                }
                return true;
            } catch (error) {
                console.warn('Failed to load cached media:', error);
                return false;
            }
        }
        return false;
    }
    
    drawNode(ctx, node) {
        ctx.save();
        
        // Use animated position if available (priority order)
        let drawPos = node.pos;
        if (node._gridAnimPos) {
            drawPos = node._gridAnimPos;  // Grid-align animation
        } else if (node._animPos) {
            drawPos = node._animPos;      // Auto-align animation
        }
        
        ctx.translate(drawPos[0], drawPos[1]);
        
        // Apply rotation
        if (node.rotation) {
            ctx.translate(node.size[0] / 2, node.size[1] / 2);
            ctx.rotate(node.rotation * Math.PI / 180);
            ctx.translate(-node.size[0] / 2, -node.size[1] / 2);
        }
        
        // Draw node content
        if (node.onDrawForeground) {
            node.onDrawForeground(ctx);
        }
        
        // Draw selection and handles (hide during alignment)
        if (this.selection.isSelected(node) && 
            (!this.alignmentManager || !this.alignmentManager.isActive())) {
            this.drawNodeSelection(ctx, node);
        }
        
        ctx.restore();
    }
    
    drawNodeSelection(ctx, node) {
        // Selection border
        ctx.lineWidth = 2 / this.viewport.scale;
        ctx.strokeStyle = '#4af';
        ctx.strokeRect(0, 0, node.size[0], node.size[1]);
        
        // Draw handles if node is large enough and not during alignment animations
        // For performance: limit individual handles when many nodes are selected
        const shouldDrawHandles = this.handleDetector.shouldShowHandles(node) && 
                                 (!this.alignmentManager || !this.alignmentManager.isAnimating()) &&
                                 (this.selection.size() <= 5); // Only draw individual handles for 5 or fewer nodes
        
        if (shouldDrawHandles) {
            this.drawNodeHandles(ctx, node);
        }
    }
    
    drawNodeHandles(ctx, node) {
        const handleSize = this.getConfig('HANDLES.SIZE', 12) / this.viewport.scale;
        
        // Resize handle
        ctx.save();
        ctx.lineWidth = 3 / this.viewport.scale;
        ctx.strokeStyle = '#fff';
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 2 / this.viewport.scale;
        
        ctx.beginPath();
        ctx.moveTo(node.size[0] - handleSize, node.size[1]);
        ctx.lineTo(node.size[0], node.size[1]);
        ctx.moveTo(node.size[0], node.size[1] - handleSize);
        ctx.lineTo(node.size[0], node.size[1]);
        ctx.stroke();
        ctx.restore();
        
        // Rotation handle (drawn in screen space)
        this.drawRotationHandle(ctx, node);
    }
    
    drawRotationHandle(ctx, node) {
        if (!this.handleDetector.getRotatedCorner) return;
        
        const [screenX, screenY] = this.handleDetector.getRotatedCorner(node, 'br');
        
        // Use animated position if available, otherwise use actual position
        let drawPos = node.pos;
        if (node._gridAnimPos) {
            drawPos = node._gridAnimPos;  // Grid-align animation
        } else if (node._animPos) {
            drawPos = node._animPos;      // Auto-align animation
        }
        
        const centerX = drawPos[0] + node.size[0] / 2;
        const centerY = drawPos[1] + node.size[1] / 2;
        const [centerScreenX, centerScreenY] = this.viewport.convertGraphToOffset(centerX, centerY);
        
        const dx = screenX - centerScreenX;
        const dy = screenY - centerScreenY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist === 0) return;
        
        const nx = dx / dist;
        const ny = dy / dist;
        
        const handleDist = 12;
        const hx = screenX + nx * handleDist;
        const hy = screenY + ny * handleDist;
        
        ctx.save();
        ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, 2 * Math.PI);
        ctx.fillStyle = '#4af';
        ctx.globalAlpha = 0.5;
        ctx.fill();
        ctx.restore();
    }
    
    drawOverlays(ctx) {
        // Draw selection rectangle
        if (this.interactionState.selecting.active) {
            this.drawSelectionRectangle(ctx);
        }
        
        // Draw multi-selection bounding box (hide during alignment)
        if (this.selection.size() > 1 && 
            (!this.alignmentManager || !this.alignmentManager.isActive())) {
            this.drawSelectionBoundingBox(ctx);
        }
        
        // Draw alignment overlays
        if (this.alignmentManager) {
            this.alignmentManager.drawOverlays(ctx);
        }
    }
    
    drawSelectionRectangle(ctx) {
        const rect = this.selection.getSelectionRect();
        if (!rect) return;
        
        ctx.save();
        ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
        
        // Convert to screen coordinates
        const [sx, sy] = this.viewport.convertGraphToOffset(rect[0], rect[1]);
        const [ex, ey] = this.viewport.convertGraphToOffset(rect[0] + rect[2], rect[1] + rect[3]);
        
        const screenRect = [sx, sy, ex - sx, ey - sy];
        
        ctx.strokeStyle = '#4af';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.globalAlpha = 0.5;
        ctx.strokeRect(...screenRect);
        
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = '#4af';
        ctx.fillRect(...screenRect);
        ctx.restore();
    }
    
    drawSelectionBoundingBox(ctx) {
        const bbox = this.selection.getBoundingBox();
        if (!bbox) return;
        
        const [minX, minY, width, height] = bbox;
        const [sx, sy] = this.viewport.convertGraphToOffset(minX, minY);
        const sw = width * this.viewport.scale;
        const sh = height * this.viewport.scale;
        
        const margin = 8;
        
        ctx.save();
        ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
        
        // Transparent background
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = '#4af';
        ctx.fillRect(sx - margin, sy - margin, sw + margin * 2, sh + margin * 2);
        
        // Border
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = '#4af';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(sx - margin, sy - margin, sw + margin * 2, sh + margin * 2);
        
        // Resize handle
        this.drawMultiResizeHandle(ctx, sx, sy, sw, sh, margin);
        
        // Rotation handle
        this.drawMultiRotationHandle(ctx, sx, sy, sw, sh, margin);
        
        ctx.restore();
    }
    
    drawMultiResizeHandle(ctx, sx, sy, sw, sh, margin) {
        const handleSize = 16;
        const brX = sx + sw + margin;
        const brY = sy + sh + margin;
        
        ctx.setLineDash([]);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 2;
        
        ctx.beginPath();
        ctx.moveTo(brX - handleSize, brY - 2);
        ctx.lineTo(brX - 2, brY - 2);
        ctx.moveTo(brX - 2, brY - handleSize);
        ctx.lineTo(brX - 2, brY - 2);
        ctx.stroke();
    }
    
    drawMultiRotationHandle(ctx, sx, sy, sw, sh, margin) {
        const offset = 16;
        const brX = sx + sw + margin;
        const brY = sy + sh + margin;
        const hx = brX + offset;
        const hy = brY + offset;
        
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, 2 * Math.PI);
        ctx.fillStyle = '#4af';
        ctx.globalAlpha = 0.5;
        ctx.fill();
    }
    
    drawStats(ctx) {
        ctx.save();
        ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
        
        // Background
        ctx.fillStyle = 'rgba(34, 34, 34, 0.8)';
        ctx.fillRect(10, 10, 160, 80);
        
        // Stats text
        ctx.font = '12px monospace';
        ctx.fillStyle = '#fff';
        
        const cacheStats = window.imageCache ? window.imageCache.getStats() : { memorySize: 'N/A' };
        
        const stats = [
            `FPS: ${this.fps}`,
            `Nodes: ${this.graph.nodes.length}`,
            `Selected: ${this.selection.size()}`,
            `Scale: ${(this.viewport.scale * 100).toFixed(0)}%`,
            `Cache: ${cacheStats.memorySize}`
        ];
        
        stats.forEach((stat, i) => {
            ctx.fillText(stat, 15, 25 + i * 14);
        });
        
        ctx.restore();
    }
    
    // ===================================
    // UTILITY METHODS
    // ===================================
    
    getConfig(path, defaultValue) {
        // Helper to safely get config values
        try {
            const keys = path.split('.');
            let value = window.CONFIG || {};
            for (const key of keys) {
                value = value[key];
                if (value === undefined) return defaultValue;
            }
            return value;
        } catch (e) {
            return defaultValue;
        }
    }
    
    // ===================================
    // CLEANUP
    // ===================================
    
    cleanup() {
        // Stop animation system
        if (this.animationSystem) {
            this.animationSystem.stop();
        }
        
        // Cleanup viewport
        if (this.viewport) {
            this.viewport.cleanup();
        }
        
        // Clear timeouts
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
        }
        
        // Remove event listeners
        this.canvas.removeEventListener('mousedown', this.onMouseDown);
        this.canvas.removeEventListener('mousemove', this.onMouseMove);
        this.canvas.removeEventListener('mouseup', this.onMouseUp);
        this.canvas.removeEventListener('wheel', this.onMouseWheel);
        this.canvas.removeEventListener('dblclick', this.onDoubleClick);
        document.removeEventListener('keydown', this.onKeyDown);
        
        console.log('LGraphCanvas cleaned up');
    }
    
    // ===================================
    // DEBUG AND UTILITIES
    // ===================================
    
    getDebugInfo() {
        return {
            viewport: this.viewport.getDebugInfo ? this.viewport.getDebugInfo() : 'N/A',
            selection: this.selection.getDebugInfo ? this.selection.getDebugInfo() : 'N/A',
            graph: this.graph.getDebugInfo ? this.graph.getDebugInfo() : 'N/A',
            performance: {
                fps: this.fps,
                dirty: this.dirty_canvas,
                frameCounter: this.frameCounter
            },
            interactions: {
                dragging: this.interactionState.dragging.canvas || !!this.interactionState.dragging.node,
                resizing: this.interactionState.resizing.active,
                rotating: this.interactionState.rotating.active,
                selecting: this.interactionState.selecting.active
            },
            mouse: {
                canvas: this.mouseState.canvas,
                graph: this.mouseState.graph,
                down: this.mouseState.down,
                button: this.mouseState.button
            }
        };
    }
}