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
        
        // Initialize action manager
        this.actionManager = null; // Will be set when collaborative manager is ready
        
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
                isDuplication: false,  // Track if this drag is from duplication
                hasMoved: false       // Track if actual movement occurred
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
        
        // Window resize
        window.addEventListener('resize', this.onWindowResize.bind(this));
        // Call resize immediately to set initial size
        this.onWindowResize();
        
        // Start render loop
        this.startRenderLoop();
        
        // Selection callbacks
        this.selection.addCallback(this.onSelectionChanged.bind(this));
    }
    
    startRenderLoop() {
        // Use requestAnimationFrame for efficient rendering
        const renderFrame = () => {
            if (this.dirty_canvas) {
                this.dirty_canvas = false;
                this.draw();
            }
            requestAnimationFrame(renderFrame);
        };
        requestAnimationFrame(renderFrame);
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
        
        // Debug: log all properties of node under mouse (commented out to reduce console noise)
        // const node = this.handleDetector.getNodeAtPosition(...this.mouseState.graph, this.graph.nodes);
        // if (node) {
        //     console.group(`Node Debug: ${node.title || node.type} (id: ${node.id})`);
        //     console.log('type:', node.type);
        //     console.log('id:', node.id);
        //     console.log('pos:', node.pos);
        //     console.log('size:', node.size);
        //     console.log('rotation:', node.rotation);
        //     console.log('aspectRatio:', node.aspectRatio);
        //     console.log('properties:', node.properties);
        //     console.log('flags:', node.flags);
        //     if (typeof node.getVideoInfo === 'function') {
        //         console.log('videoInfo:', node.getVideoInfo());
        //     }
        //     console.groupEnd();
        // }
        
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
                // Invalidate bounding box cache during grid alignment dragging
                this.selection.invalidateBoundingBox();
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
        
        // DISABLED: Undo state is now handled by the OperationPipeline through node_duplicate operations
        // This prevents duplicate undo entries for duplication operations
        // if (this.interactionState.dragging.isDuplication) {
        //     this.pushUndoState();
        //     this.interactionState.dragging.isDuplication = false;
        // }
        
        // Still reset the duplication flag
        if (this.interactionState.dragging.isDuplication) {
            this.interactionState.dragging.isDuplication = false;
        }
        
        this.mouseState.down = false;
        this.mouseState.button = -1;
        this.dirty_canvas = true;
    }
    
    onMouseWheel(e) {
        e.preventDefault();
        
        // Navigation zoom (intentionally NOT synced to other users)
        const delta = e.deltaY < 0 ? 1 : -1; // Positive for zoom in, negative for zoom out
        const mousePos = this.mouseState.canvas || [0, 0];
        
        // Use the viewport.zoom method to ensure navigation state is saved
        this.viewport.zoom(delta, mousePos[0], mousePos[1]);
        
        // Notify viewport of movement for LOD optimization
        this.viewport.notifyMovement();
        
        // Update text editing overlay if active
        if (this._editingTextInput && this._editingTextNode) {
            this.positionTextEditingOverlay(this._editingTextInput, this._editingTextNode);
            this.updateTextEditingOverlaySize(this._editingTextInput, this._editingTextNode);
        }
        
        // Clear preload queue during zoom - will be repopulated with new nearby nodes
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
                const nodeIds = selectedNodes.map(n => n.id);
                const values = selectedNodes.map(() => 0);
                
                if (window.app?.operationPipeline) {
                    window.app.operationPipeline.execute('node_reset', {
                        nodeIds: nodeIds,
                        resetRotation: true,
                        resetAspectRatio: false,
                        source: 'multi_select_reset'
                    });
                } else {
                    // Fallback
                    for (const node of selectedNodes) {
                        node.rotation = 0;
                    }
                    this.dirty_canvas = true;
                }
                
                this.pushUndoState();
            } else {
                // Single node selected
                this.resetRotation(rotationHandle);
            }
            return;
        }
        
        const resizeHandle = this.handleDetector.getResizeHandle(...this.mouseState.canvas);
        if (resizeHandle) {
            console.log(`Double-click on resize handle: type=${resizeHandle.type}, selection size=${this.selection.size()}`);
            // If multiple nodes are selected, reset all their aspect ratios
            if (this.selection.size() > 1) {
                const selectedNodes = this.selection.getSelectedNodes();
                const nodeIds = [];
                const originalAspects = [];
                
                for (const node of selectedNodes) {
                    if (node.originalAspect) {
                        nodeIds.push(node.id);
                        originalAspects.push(node.originalAspect);
                    } else {
                        console.warn(`Node ${node.id} (${node.type}) missing originalAspect property`);
                    }
                }
                
                console.log(`Multi-node aspect ratio reset: ${nodeIds.length} nodes with originalAspect`, nodeIds, originalAspects);
                
                if (window.app?.operationPipeline && nodeIds.length > 0) {
                    window.app.operationPipeline.execute('node_reset', {
                        nodeIds: nodeIds,
                        resetAspectRatio: true,
                        resetRotation: false,
                        values: originalAspects
                    });
                } else {
                    // Fallback
                    for (const node of selectedNodes) {
                        if (node.originalAspect) {
                            node.aspectRatio = node.originalAspect;
                            node.size[1] = node.size[0] / node.originalAspect;
                            if (node.onResize) node.onResize();
                        }
                    }
                    this.dirty_canvas = true;
                }
                
                this.pushUndoState();
            } else {
                // Single node selected
                this.resetAspectRatio(resizeHandle);
            }
            return;
        }
        
        // Check for title double-click first (since title area is outside node bounds)
        const nodes = this.graph.nodes || [];
        for (let i = nodes.length - 1; i >= 0; i--) {
            const node = nodes[i];
            if (this.canEditTitle(node, this.mouseState.graph)) {
                this.startTitleEditing(node, e);
                return;
            }
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
                
                // Broadcast the toggle for the clicked video (send playing state, not paused)
                this.broadcastVideoToggle(node.id, !clickedVideoState);
                
                // Apply the same state to all other selected video nodes
                const selectedNodes = this.selection.getSelectedNodes();
                for (const selectedNode of selectedNodes) {
                    if (selectedNode.type === 'media/video' && selectedNode.id !== node.id) {
                        if (clickedVideoState) {
                            selectedNode.pause();
                        } else {
                            selectedNode.play();
                        }
                        
                        // Broadcast toggle for each video (send playing state, not paused)
                        this.broadcastVideoToggle(selectedNode.id, !clickedVideoState);
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
            }
            // Title editing is now handled before node detection
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
    
    onWindowResize() {
        // Update canvas size to match window size
        const dpr = window.devicePixelRatio || 1;
        
        // Get the size the canvas should be displayed at
        const displayWidth = window.innerWidth;
        const displayHeight = window.innerHeight;
        
        // Set the actual canvas size accounting for device pixel ratio
        this.canvas.width = displayWidth * dpr;
        this.canvas.height = displayHeight * dpr;
        
        // Scale the canvas back down using CSS
        this.canvas.style.width = displayWidth + 'px';
        this.canvas.style.height = displayHeight + 'px';
        
        // Update viewport DPR
        if (this.viewport) {
            this.viewport.dpr = dpr;
        }
        
        // Set canvas to redraw
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
        
        // Reset movement tracking
        this.interactionState.dragging.hasMoved = false;
        
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
        this.interactionState.resizing.isMultiContext = resizeHandle.isMultiContext || false;
        
        // Store initial bounding box for multi-resize or single-resize in multi-context
        if (resizeHandle.type === 'multi-resize' || resizeHandle.isMultiContext) {
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
    
    async startNodeDuplication(node, e) {
        // Check if multiple nodes are selected
        const isMultiSelection = this.selection.size() > 1 && this.selection.isSelected(node);
        
        let duplicates = [];
        let draggedDuplicate = null;
        
        // For collaborative systems, create nodes locally first, then sync properly after drag
        if (isMultiSelection) {
            // Multi-selection: duplicate all selected nodes locally
            const selectedNodes = this.selection.getSelectedNodes();
            
            for (const selectedNode of selectedNodes) {
                const duplicate = this.duplicateNode(selectedNode);
                if (duplicate) {
                    // Position duplicate at same location initially
                    duplicate.pos[0] = selectedNode.pos[0];
                    duplicate.pos[1] = selectedNode.pos[1];
                    
                    this.graph.add(duplicate);
                    duplicates.push(duplicate);
                    
                    // Mark as temporary - will be replaced by server version later
                    duplicate._isTemporary = true;
                    duplicate._temporaryCreatedAt = Date.now();
                    
                    // Remember which duplicate corresponds to the dragged node
                    if (selectedNode.id === node.id) {
                        draggedDuplicate = duplicate;
                    }
                }
            }
        } else {
            // Single node: duplicate just this node locally
            const duplicate = this.duplicateNode(node);
            if (duplicate) {
                duplicate.pos[0] = node.pos[0];
                duplicate.pos[1] = node.pos[1];
                this.graph.add(duplicate);
                duplicates.push(duplicate);
                
                // Mark as temporary - will be replaced by server version later
                duplicate._isTemporary = true;
                duplicate._temporaryCreatedAt = Date.now();
                
                draggedDuplicate = duplicate;
            }
        }
        
        // Mark these nodes as needing collaborative sync after drag completes
        // But only if the collaborative system is properly authenticated
        // Alt+drag now uses the collaborative system directly via node_duplicate command
        // No need to mark for sync since it's already handled properly
        
        if (duplicates.length === 0) return;
        
        // Clear selection and select all duplicates
        this.selection.clear();
        duplicates.forEach(dup => this.selection.selectNode(dup, true));
        
        // Start dragging all duplicates, using the dragged duplicate as reference
        this.interactionState.dragging.node = draggedDuplicate;
        this.interactionState.dragging.isDuplication = true;  // Mark as duplication drag
        
        // Force immediate redraw to show any loading states
        this.dirty_canvas = true;
        requestAnimationFrame(() => this.draw());
        
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
        let moved = false;
        for (const [nodeId, offset] of this.interactionState.dragging.offsets) {
            const node = this.graph.getNodeById(nodeId);
            if (node) {
                const newX = this.mouseState.graph[0] + offset[0];
                const newY = this.mouseState.graph[1] + offset[1];
                
                // Check if position actually changed (with small threshold to avoid floating point issues)
                if (Math.abs(node.pos[0] - newX) > 0.01 || Math.abs(node.pos[1] - newY) > 0.01) {
                    moved = true;
                }
                
                node.pos[0] = newX;
                node.pos[1] = newY;
            }
        }
        
        // Track if any movement occurred
        if (moved) {
            this.interactionState.dragging.hasMoved = true;
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
        
        // Calculate new size and position with proper anchor point
        let newWidth, newHeight, newPosX, newPosY;
        
        if (node.rotation && node.rotation !== 0) {
            // For rotated nodes, resize from the opposite corner (top-left) as anchor
            const angle = node.rotation * Math.PI / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            
            // Calculate the top-left corner position in world coordinates (our anchor point)
            const anchorLocalX = -initial.size[0] / 2;
            const anchorLocalY = -initial.size[1] / 2;
            const centerX = initial.pos[0] + initial.size[0] / 2;
            const centerY = initial.pos[1] + initial.size[1] / 2;
            
            const anchorX = centerX + anchorLocalX * cos - anchorLocalY * sin;
            const anchorY = centerY + anchorLocalX * sin + anchorLocalY * cos;
            
            // Transform mouse position to local coordinate system relative to anchor
            const dx = mouseX - anchorX;
            const dy = mouseY - anchorY;
            
            // Rotate to get local coordinates
            const localDx = dx * cos + dy * sin;
            const localDy = -dx * sin + dy * cos;
            
            // Calculate new size (ensuring positive values)
            newWidth = Math.max(50, Math.abs(localDx));
            newHeight = Math.max(50, Math.abs(localDy));
            
            // Calculate new position to keep anchor point fixed
            const newCenterX = anchorX + (newWidth / 2) * cos - (newHeight / 2) * sin;
            const newCenterY = anchorY + (newWidth / 2) * sin + (newHeight / 2) * cos;
            
            newPosX = newCenterX - newWidth / 2;
            newPosY = newCenterY - newHeight / 2;
        } else {
            // No rotation, use simple calculation with top-left anchor
            newWidth = Math.max(50, mouseX - initial.pos[0]);
            newHeight = Math.max(50, mouseY - initial.pos[1]);
            newPosX = initial.pos[0]; // Keep top-left fixed
            newPosY = initial.pos[1];
        }
        
        // Check if this is a single-resize in multi-selection context
        // In this case, we should scale all selected nodes as a group
        const isMultiContext = this.interactionState.resizing.isMultiContext;
        
        if (isMultiContext) {
            // Single handle drag in multi-selection: scale all selected nodes as group
            this.updateMultiResizeFromSingleHandle(mouseX, mouseY, shift, ctrl, node, initial);
            return;
        }
        
        // Individual node resize (single selection or not in multi-context)
        // Single node: update size and position with anchor point
        if (shift) {
            // Non-uniform scaling
            node.size[0] = newWidth;
            node.size[1] = newHeight;
            node.aspectRatio = node.size[0] / node.size[1];
        } else {
            // Maintain aspect ratio
            const aspectHeight = newWidth / initial.aspect;
            node.size[0] = newWidth;
            node.size[1] = aspectHeight;
            node.aspectRatio = initial.aspect;
            
            // Recalculate position for aspect-constrained resize if rotated
            if (node.rotation && node.rotation !== 0) {
                const angle = node.rotation * Math.PI / 180;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                
                // Calculate anchor point again
                const anchorLocalX = -initial.size[0] / 2;
                const anchorLocalY = -initial.size[1] / 2;
                const centerX = initial.pos[0] + initial.size[0] / 2;
                const centerY = initial.pos[1] + initial.size[1] / 2;
                
                const anchorX = centerX + anchorLocalX * cos - anchorLocalY * sin;
                const anchorY = centerY + anchorLocalX * sin + anchorLocalY * cos;
                
                // Recalculate position with new aspect-constrained height
                const newCenterX = anchorX + (newWidth / 2) * cos - (aspectHeight / 2) * sin;
                const newCenterY = anchorY + (newWidth / 2) * sin + (aspectHeight / 2) * cos;
                
                newPosX = newCenterX - newWidth / 2;
                newPosY = newCenterY - aspectHeight / 2;
            }
        }
        
        // Update position (for both rotated and non-rotated nodes)
        node.pos[0] = newPosX;
        node.pos[1] = newPosY;
        
        if (node.onResize) {
            node.onResize();
        }
        
        // Invalidate bounding box cache after single node resize
        this.selection.invalidateBoundingBox();
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
            // Uniform scaling - use X scale (drag direction) to maintain proportions
            scaleY = scaleX;
        }
        
        // Scale nodes as if bounding box top-left is pinned to canvas
        // Everything deforms from that fixed anchor point
        for (const node of this.selection.selectedNodes.values()) {
            const initial = this.interactionState.resizing.initial.get(node.id);
            if (!initial) continue;
            
            if (node.rotation && node.rotation !== 0) {
                // For rotated nodes: apply scaling in their local coordinate system
                // to approximate the visual deformation effect
                const angle = node.rotation * Math.PI / 180;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                
                // Transform global scale factors into local coordinate system
                const localScaleX = Math.abs(scaleX * cos) + Math.abs(scaleY * sin);
                const localScaleY = Math.abs(scaleX * sin) + Math.abs(scaleY * cos);
                
                node.size[0] = Math.max(50, initial.size[0] * localScaleX);
                node.size[1] = Math.max(50, initial.size[1] * localScaleY);
            } else {
                // Non-rotated nodes: direct scaling
                node.size[0] = Math.max(50, initial.size[0] * scaleX);
                node.size[1] = Math.max(50, initial.size[1] * scaleY);
            }
            
            node.aspectRatio = node.size[0] / node.size[1];
            
            // All nodes: scale position from bounding box top-left anchor
            node.pos[0] = bx + (initial.pos[0] - bx) * scaleX;
            node.pos[1] = by + (initial.pos[1] - by) * scaleY;
            
            if (node.onResize) {
                node.onResize();
            }
        }
        
        // Invalidate bounding box cache after multi-resize
        this.selection.invalidateBoundingBox();
    }
    
    updateMultiResizeFromSingleHandle(mouseX, mouseY, shift, ctrl, draggedNode, draggedInitial) {
        // This method handles when you drag an individual node handle in multi-selection context
        // Each node scales by the same factor, but from its own anchor point (delta scaling)
        
        // Calculate how much the dragged node would resize using the same logic as individual resize
        let scaleX, scaleY;
        
        if (draggedNode.rotation && draggedNode.rotation !== 0) {
            // For rotated dragged node, transform mouse position to local coordinates
            const angle = draggedNode.rotation * Math.PI / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            
            // Calculate the top-left corner position in world coordinates (anchor point)
            const anchorLocalX = -draggedInitial.size[0] / 2;
            const anchorLocalY = -draggedInitial.size[1] / 2;
            const centerX = draggedInitial.pos[0] + draggedInitial.size[0] / 2;
            const centerY = draggedInitial.pos[1] + draggedInitial.size[1] / 2;
            
            const anchorX = centerX + anchorLocalX * cos - anchorLocalY * sin;
            const anchorY = centerY + anchorLocalX * sin + anchorLocalY * cos;
            
            // Transform mouse position to local coordinate system relative to anchor
            const dx = mouseX - anchorX;
            const dy = mouseY - anchorY;
            
            // Rotate to get local coordinates
            const localDx = dx * cos + dy * sin;
            const localDy = -dx * sin + dy * cos;
            
            // Calculate new size based on local coordinates
            const newWidth = Math.max(50, Math.abs(localDx));
            const newHeight = Math.max(50, Math.abs(localDy));
            
            // Calculate scale factors
            scaleX = newWidth / draggedInitial.size[0];
            scaleY = newHeight / draggedInitial.size[1];
        } else {
            // No rotation on dragged node - simple calculation
            const newWidth = Math.max(50, mouseX - draggedInitial.pos[0]);
            const newHeight = Math.max(50, mouseY - draggedInitial.pos[1]);
            
            scaleX = newWidth / draggedInitial.size[0];
            scaleY = newHeight / draggedInitial.size[1];
        }
        
        if (!shift) {
            // Uniform scaling - use X scale to maintain proportions
            scaleY = scaleX;
        }
        
        // Apply the same scale factors to all selected nodes, each from its own anchor
        for (const node of this.selection.selectedNodes.values()) {
            const initial = this.interactionState.resizing.initial.get(node.id);
            if (!initial) continue;
            
            // Calculate new size using the same scale factors
            const newWidth = Math.max(50, initial.size[0] * scaleX);
            const newHeight = Math.max(50, initial.size[1] * scaleY);
            
            // For delta scaling, handle position based on rotation
            let newPosX, newPosY;
            
            if (node.rotation && node.rotation !== 0) {
                // For rotated nodes, maintain anchor point behavior (same as individual resize)
                const angle = node.rotation * Math.PI / 180;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                
                // Calculate the top-left corner position in world coordinates (our anchor point)
                const anchorLocalX = -initial.size[0] / 2;
                const anchorLocalY = -initial.size[1] / 2;
                const centerX = initial.pos[0] + initial.size[0] / 2;
                const centerY = initial.pos[1] + initial.size[1] / 2;
                
                const anchorX = centerX + anchorLocalX * cos - anchorLocalY * sin;
                const anchorY = centerY + anchorLocalX * sin + anchorLocalY * cos;
                
                // Calculate new position to keep anchor point fixed
                const newCenterX = anchorX + (newWidth / 2) * cos - (newHeight / 2) * sin;
                const newCenterY = anchorY + (newWidth / 2) * sin + (newHeight / 2) * cos;
                
                newPosX = newCenterX - newWidth / 2;
                newPosY = newCenterY - newHeight / 2;
            } else {
                // No rotation: anchor point is simply the top-left corner - keep it exactly the same
                newPosX = initial.pos[0]; // Keep top-left fixed - no change!
                newPosY = initial.pos[1]; // Keep top-left fixed - no change!
            }
            
            // Update node properties
            node.size[0] = newWidth;
            node.size[1] = newHeight;
            node.pos[0] = newPosX;
            node.pos[1] = newPosY;
            node.aspectRatio = node.size[0] / node.size[1];
            
            if (node.onResize) {
                node.onResize();
            }
        }
        
        // Invalidate bounding box cache after multi-selection resize
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
            
            // Invalidate bounding box cache during rotation
            this.selection.invalidateBoundingBox();
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
            
            // Invalidate bounding box cache during multi-rotation
            this.selection.invalidateBoundingBox();
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
        
        // Canvas pan (navigation - intentionally NOT synced to other users)
        if (this.interactionState.dragging.canvas) {
            this.interactionState.dragging.canvas = false;
            this.debouncedSave(); // Save viewport state locally only
        }
        
        // Node drag
        if (this.interactionState.dragging.node) {
            const wasDuplication = this.interactionState.dragging.isDuplication;
            const hasMoved = this.interactionState.dragging.hasMoved;
            
            // Broadcast move operation for collaboration
            // Skip move operations for duplicated nodes, temporary nodes, or if no movement occurred
            if (window.app?.operationPipeline && wasInteracting && !wasDuplication && hasMoved) {
                const selectedNodes = this.selection.getSelectedNodes();
                // Filter out temporary nodes that don't exist on server yet
                const collaborativeNodes = selectedNodes.filter(n => {
                    // Exclude temporary nodes
                    if (n._isTemporary || n._localId || n._pendingSync) {
                        return false;
                    }
                    // Exclude nodes with invalid IDs
                    if (!n.id || typeof n.id !== 'number') {
                        return false;
                    }
                    // Exclude nodes that previously failed sync
                    if (n._syncFailed) {
                        return false;
                    }
                    return true;
                });
                
                if (collaborativeNodes.length === 1) {
                    const node = collaborativeNodes[0];
                    const moveData = {
                        nodeId: node.id,
                        position: [...node.pos]
                    };
                    
                    // For move operations, we don't need to send media properties
                    // The server already has this data and positions are the only thing changing
                    
                    window.app.operationPipeline.execute('node_move', moveData);
                } else if (collaborativeNodes.length > 1) {
                    // For very large selections, chunk the move operations
                    if (collaborativeNodes.length > 50) {
                        console.log(`📦 Chunking move operation for ${collaborativeNodes.length} nodes`);
                        
                        const chunkSize = 20;
                        const chunks = [];
                        
                        for (let i = 0; i < collaborativeNodes.length; i += chunkSize) {
                            chunks.push(collaborativeNodes.slice(i, i + chunkSize));
                        }
                        
                        // Execute chunks asynchronously to avoid blocking
                        (async () => {
                            for (let i = 0; i < chunks.length; i++) {
                                const chunk = chunks[i];
                                let moveData = {
                                    nodeIds: chunk.map(n => n.id),
                                    positions: chunk.map(n => [...n.pos])
                                };
                                
                                // REMOVED: Validation - let server handle missing nodes gracefully
                                
                                try {
                                    await window.app.operationPipeline.execute('node_move', moveData);
                                    
                                    // Small delay between chunks to avoid overwhelming server
                                    if (i < chunks.length - 1) {
                                        await new Promise(resolve => setTimeout(resolve, 50));
                                    }
                                } catch (error) {
                                    console.error(`Move chunk ${i + 1}/${chunks.length} failed:`, error);
                                    // Continue with other chunks
                                }
                            }
                        })();
                    } else {
                        // Small batch can go directly
                        let moveData = {
                            nodeIds: collaborativeNodes.map(n => n.id),
                            positions: collaborativeNodes.map(n => [...n.pos])
                        };
                        
                        // REMOVED: Validation - let server handle missing nodes gracefully
                        
                        window.app.operationPipeline.execute('node_move', moveData);
                    }
                }
                // No warning for empty collaborative nodes - this is expected for duplication
            }
            
            this.interactionState.dragging.node = null;
            this.interactionState.dragging.offsets.clear();
            this.interactionState.dragging.hasMoved = false;
            
            // For Alt+drag duplication, sync the nodes through collaborative system
            // but keep the local nodes visible for seamless transition
            if (wasDuplication && window.app?.operationPipeline) {
                const duplicatedNodes = this.selection.getSelectedNodes();
                if (duplicatedNodes.length > 0) {
                    // Generate operation ID for tracking
                    const operationId = `alt-drag-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                    
                    // Collect temporary nodes for tracking
                    const tempNodeMap = new Map();
                    const tempNodeIds = [];
                    duplicatedNodes.forEach(node => {
                        if (node._isTemporary) {
                            tempNodeMap.set(node.id, node);
                            tempNodeIds.push(node.id);
                            // Add operation ID to node for correlation
                            node._operationId = operationId;
                            console.log(`🏷️ Tracking temporary node: ${node.id} at [${node.pos[0]}, ${node.pos[1]}] with operation ${operationId}`);
                        }
                    });
                    
                    // Create node data for all duplicates at their final positions
                    const nodeDataArray = duplicatedNodes.map(node => {
                        // Use BulkOperationManager's optimization if available
                        if (window.app?.bulkOperationManager) {
                            return window.app.bulkOperationManager.optimizeNodeData(node);
                        }
                        
                        // Fallback to inline optimization
                        const nodeData = {
                            type: node.type,
                            pos: [...node.pos], // Final position after drag
                            size: [...node.size],
                            properties: { ...node.properties },
                            flags: { ...node.flags },
                            title: node.title,
                            rotation: node.rotation || 0,
                            aspectRatio: node.aspectRatio
                        };
                        
                        // For cached images, only send hash and server URL, not the full data
                        if (node.type === 'media/image' && node.properties.hash) {
                            console.log(`📤 Preparing Alt+drag node data - hash:${node.properties.hash.substring(0,8)} serverUrl:${!!node.properties.serverUrl}`);
                            
                            // If we have a serverUrl, use minimal data
                            if (node.properties.serverUrl) {
                                nodeData.properties = {
                                    hash: node.properties.hash,
                                    filename: node.properties.filename,
                                    serverUrl: node.properties.serverUrl,
                                    serverFilename: node.properties.serverFilename
                                };
                                // Don't include the large src data URL
                                delete nodeData.properties.src;
                            }
                            // Otherwise, we need to send the src for the server to upload
                            else {
                                console.log(`⚠️ No serverUrl for cached image, keeping src data`);
                            }
                        }
                        
                        return nodeData;
                    });
                    
                    // Create through collaborative system WITHOUT removing local nodes
                    let operationPromise;
                    
                    // For Alt+drag with many nodes, chunk the operation manually
                    if (nodeDataArray.length > 20) {
                        // Split into smaller chunks and execute sequentially
                        const chunkSize = 10;
                        const chunks = [];
                        for (let i = 0; i < nodeDataArray.length; i += chunkSize) {
                            chunks.push(nodeDataArray.slice(i, i + chunkSize));
                        }
                        
                        console.log(`📦 Alt+drag: Splitting ${nodeDataArray.length} nodes into ${chunks.length} chunks`);
                        
                        // Execute chunks sequentially
                        operationPromise = (async () => {
                            const results = [];
                            for (let i = 0; i < chunks.length; i++) {
                                const chunk = chunks[i];
                                console.log(`📤 Sending chunk ${i + 1}/${chunks.length} with ${chunk.length} nodes`);
                                
                                try {
                                    const result = await window.app.operationPipeline.execute('node_duplicate', {
                                        nodeIds: [],
                                        nodeData: chunk,
                                        offset: [0, 0]
                                    });
                                    
                                    if (result && result.result && result.result.nodes) {
                                        results.push(...result.result.nodes);
                                    }
                                    
                                    // Small delay between chunks
                                    if (i < chunks.length - 1) {
                                        await new Promise(resolve => setTimeout(resolve, 100));
                                    }
                                } catch (error) {
                                    console.error(`❌ Chunk ${i + 1} failed:`, error);
                                    // Continue with other chunks
                                }
                            }
                            
                            return { result: { nodes: results } };
                        })();
                    } else {
                        // Track operation in StateSyncManager's OperationTracker
                        if (window.app?.operationPipeline?.stateSyncManager?.operationTracker) {
                            window.app.operationPipeline.stateSyncManager.operationTracker.trackOperation(operationId, {
                                type: 'node_duplicate',
                                tempNodeIds: tempNodeIds,
                                nodeData: nodeDataArray
                            });
                        }
                        
                        // Small operations can go directly
                        operationPromise = window.app.operationPipeline.execute('node_duplicate', {
                            nodeIds: [], // Empty since we're providing explicit node data
                            nodeData: nodeDataArray, // Explicit node data with final positions
                            offset: [0, 0], // No offset, already positioned
                            operationId: operationId // Include operation ID for correlation
                        });
                    }
                    
                    operationPromise.then(result => {
                        console.log('🔄 Alt+drag duplicate server response received');
                        
                        // Clear selection
                        this.selection.clear();
                        
                        // For optimistic updates, select the nodes immediately
                        if (window.app?.operationPipeline?.stateSyncManager?.optimisticEnabled) {
                            if (result && result.result && result.result.nodes) {
                                result.result.nodes.forEach(nodeData => {
                                    // Find the actual node in the graph by ID
                                    const node = this.graph.getNodeById(nodeData.id);
                                    if (node) {
                                        this.selection.selectNode(node, true);
                                    }
                                });
                            }
                        } else {
                            // For non-optimistic, store node IDs to select when they arrive from server
                            if (result && result.result && result.result.nodes) {
                                this._pendingSelectionNodeIds = result.result.nodes.map(n => n.id);
                            }
                        }
                        
                        // Force a redraw to ensure any loading states are visible
                        this.dirty_canvas = true;
                        requestAnimationFrame(() => this.draw());
                        
                    }).catch(error => {
                        console.error('❌ Alt+drag duplicate failed:', error);
                        // On error, just remove the temporary flag
                        tempNodeMap.forEach(node => {
                            delete node._isTemporary;
                            delete node._temporaryCreatedAt;
                        });
                    });
                }
            }
            
            this.interactionState.dragging.isDuplication = false;
            
            // For duplication: always create undo state (even without movement)
            // For regular drag: only create undo state if there was interaction
            // DISABLED: Undo state is now handled by the OperationPipeline through node_move operations
            // This prevents duplicate undo entries for drag operations
            // if (wasDuplication || wasInteracting) {
            //     this.pushUndoState();
            // }
        }
        
        // Resize
        if (this.interactionState.resizing.active) {
            // Broadcast resize operation for collaboration
            if (window.app?.operationPipeline && wasInteracting) {
                const selectedNodes = this.selection.getSelectedNodes();
                console.log(`🎯 Finishing resize operation for ${selectedNodes.length} nodes`);
                
                if (selectedNodes.length === 1) {
                    const node = selectedNodes[0];
                    // For rotated nodes, include position to maintain center
                    const params = {
                        nodeIds: [node.id],
                        sizes: [[node.size[0], node.size[1]]]
                    };
                    if (node.rotation && Math.abs(node.rotation) > 0.001) {
                        params.positions = [[node.pos[0], node.pos[1]]];
                    }
                    console.log('📐 Executing node_resize:', params);
                    window.app.operationPipeline.execute('node_resize', params);
                } else if (selectedNodes.length > 1) {
                    const params = {
                        nodeIds: selectedNodes.map(n => n.id),
                        sizes: selectedNodes.map(n => [...n.size]),
                        source: 'multi_scale'
                    };
                    // Multi-node resize ALWAYS needs positions because nodes scale relative to bounding box
                    // This is true for both uniform and non-uniform scaling
                    params.positions = selectedNodes.map(n => [...n.pos]);
                    console.log('📐 Executing multi-node node_resize:', params);
                    window.app.operationPipeline.execute('node_resize', params);
                }
            }
            
            this.interactionState.resizing.active = false;
            this.interactionState.resizing.node = null;
            this.interactionState.resizing.nodes.clear();
            this.interactionState.resizing.initial.clear();
            this.interactionState.resizing.initialBBox = null; // Clear initial bbox on finish
            // DISABLED: Undo state is now handled by the OperationPipeline through node_resize operations
            // if (wasInteracting) this.pushUndoState();
        }
        
        // Rotation
        if (this.interactionState.rotating.active) {
            // Send rotation update through OperationPipeline
            if (window.app?.operationPipeline && wasInteracting) {
                const selectedNodes = this.selection.getSelectedNodes();
                if (selectedNodes.length === 1) {
                    const node = selectedNodes[0];
                    window.app.operationPipeline.execute('node_rotate', {
                        nodeId: node.id,
                        angle: node.rotation || 0
                    });
                } else if (selectedNodes.length > 1) {
                    // For multi-selection rotation, we need to update both rotation AND position
                    // since we're rotating around the group center, not individual centers
                    
                    // Check if this was a multi-rotation (around group center)
                    const isMultiRotation = this.interactionState.rotating.type === 'multi-rotation';
                    
                    if (isMultiRotation) {
                        // For multi-rotation around group center, send a single batch operation
                        // This includes both rotations and positions in one message
                        window.app.operationPipeline.execute('node_rotate', {
                            nodeIds: selectedNodes.map(n => n.id),
                            angles: selectedNodes.map(n => n.rotation || 0),
                            positions: selectedNodes.map(n => [...n.pos]),
                            source: 'group_rotation'
                        });
                    } else {
                        // Single rotation handle in multi-selection context
                        // Only rotations change, not positions - use batch operation
                        window.app.operationPipeline.execute('node_rotate', {
                            nodeIds: selectedNodes.map(n => n.id),
                            angles: selectedNodes.map(n => n.rotation || 0),
                            source: 'multi_select_rotation'
                        });
                    }
                }
            }
            
            this.interactionState.rotating.active = false;
            this.interactionState.rotating.node = null;
            this.interactionState.rotating.nodes.clear();
            this.interactionState.rotating.initial.clear();
            // DISABLED: Undo state is now handled by the OperationPipeline through node_rotate operations
            // if (wasInteracting) this.pushUndoState();
        }
        
        // Selection
        if (this.interactionState.selecting.active) {
            this.selection.finishSelection(this.graph.nodes);
            this.interactionState.selecting.active = false;
        }
        
        this.dirty_canvas = true;
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
        
        // Save
        if (ctrl && key === 's') {
            if (window.canvasNavigator && !window.canvasNavigator.currentCanvasId && this.graph.nodes.length > 0) {
                // No current canvas but we have content - create one automatically
                const timestamp = new Date().toLocaleString();
                window.canvasNavigator.saveAsNewCanvas(`Untitled Canvas - ${timestamp}`, true);
                if (this.showNotification) {
                    this.showNotification({
                        type: 'success',
                        message: 'Canvas created and saved'
                    });
                }
            } else if (this.collaborativeManager && this.collaborativeManager.save) {
                this.collaborativeManager.save();
            } else {
                // Save to localStorage for single-user mode
                this.stateManager.saveState();
            }
            return true;
        }
        
        // Undo/Redo - Let ClientUndoManager handle these shortcuts
        // The ClientUndoManager always handles keyboard shortcuts, so we skip these here
        
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
        
        // Toggle properties panel
        if (key === 'p' && !ctrl && !shift && !alt) {
            if (window.propertiesInspector) {
                window.propertiesInspector.toggle();
            }
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
        
        // Arrow key navigation
        if (CONFIG.NAVIGATION.ARROW_KEY_ENABLED && !ctrl && !alt) {
            const directionMap = {
                'arrowup': 'up',
                'arrowdown': 'down',
                'arrowleft': 'left',
                'arrowright': 'right'
            };
            
            const direction = directionMap[key];
            if (direction) {
                const selectedNodes = this.selection.getSelectedNodes();
                let fromNode = null;
                
                if (selectedNodes.length > 0) {
                    // Use the first selected node as reference
                    fromNode = selectedNodes[0];
                } else {
                    // No nodes selected - start with the node closest to viewport center
                    fromNode = this.findNodeClosestToViewportCenter();
                    if (fromNode) {
                        // Select this node first
                        this.selection.selectNode(fromNode, true);
                        this.navigateToNode(fromNode);
                        return true;
                    }
                }
                
                if (fromNode) {
                    const targetNode = this.findNodeInDirection(fromNode, direction);
                    
                    if (targetNode) {
                        // Clear current selection
                        this.selection.clear();
                        // Select the target node
                        this.selection.selectNode(targetNode, true);
                        // Navigate to it with animation
                        this.navigateToNode(targetNode);
                    }
                }
                return true;
            }
        }
        
        return false;
    }
    
    // ===================================
    // UTILITY METHODS
    // ===================================
    
    copySelected() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) return;
        
        // Serialize nodes and optimize if BulkOperationManager is available
        if (window.app?.bulkOperationManager) {
            this.clipboard = selected.map(node => {
                const serialized = this.serializeNode(node);
                // Optimize large media data
                return window.app.bulkOperationManager.optimizeNodeData(serialized);
            });
        } else {
            this.clipboard = selected.map(node => this.serializeNode(node));
        }
        
        console.log(`📋 Copied ${selected.length} nodes to clipboard`);
        
        // Log node types for debugging
        const nodeTypes = {};
        this.clipboard.forEach(node => {
            nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1;
        });
        console.log('Clipboard contents:', nodeTypes);
        
        // Show notification for large copies
        if (selected.length > 50) {
            window.app?.notifications?.show({
                type: 'success',
                message: `Copied ${selected.length} nodes to clipboard`,
                timeout: 2000
            });
        }
    }
    
    cutSelected() {
        this.copySelected();
        this.deleteSelected();
    }
    
    async paste() {
        if (!this.clipboard || this.clipboard.length === 0) return;
        
        console.log(`📋 Starting paste operation with ${this.clipboard.length} nodes`);
        
        // Use OperationPipeline for collaborative paste
        if (window.app?.operationPipeline) {
            try {
                const mouseGraphPos = this.mouseState?.graph || [0, 0];
                let result;
                
                // Use BulkOperationManager for medium to large paste operations
                if (this.clipboard.length > 10 && window.app?.bulkOperationManager) {
                    // Optimize node data before sending
                    result = await window.app.bulkOperationManager.executeBulkOperation(
                        'node_paste',
                        this.clipboard,
                        { targetPosition: mouseGraphPos },
                        (nodeData) => window.app.bulkOperationManager.optimizeNodeData(nodeData)
                    );
                } else {
                    // Show progress feedback for medium operations
                    let progressNotification = null;
                    if (this.clipboard.length > 10) {
                        progressNotification = window.app?.notifications?.show({
                            type: 'info', 
                            message: `Pasting ${this.clipboard.length} nodes...`,
                            timeout: 0 // Don't auto-dismiss
                        });
                    }
                    
                    result = await window.app.operationPipeline.execute('node_paste', {
                        nodeData: this.clipboard,
                        targetPosition: mouseGraphPos
                    });
                    
                    // Clear progress notification
                    if (progressNotification) {
                        window.app?.notifications?.dismiss(progressNotification);
                    }
                }
                
                
                if (result && result.result && result.result.nodes) {
                    console.log(`📋 Paste operation completed: ${result.result.nodes.length} nodes created`);
                    
                    // Clear selection first
                    this.selection.clear();
                    
                    // For optimistic updates, select the nodes immediately
                    if (window.app?.operationPipeline?.stateSyncManager?.optimisticEnabled) {
                        result.result.nodes.forEach(nodeData => {
                            // Find the actual node in the graph by ID
                            const node = this.graph.getNodeById(nodeData.id);
                            if (node) {
                                this.selection.selectNode(node, true);
                            }
                        });
                    } else {
                        // For non-optimistic, store node IDs to select when they arrive from server
                        this._pendingSelectionNodeIds = result.result.nodes.map(n => n.id);
                    }
                    
                    this.dirty_canvas = true;
                } else {
                    console.warn('⚠️ Paste operation returned no nodes');
                }
            } catch (error) {
                console.error('Failed to paste nodes:', error);
                
                // Clear progress notification
                if (progressNotification) {
                    window.app?.notifications?.dismiss(progressNotification);
                }
                
                // Show error to user
                window.app?.notifications?.show({
                    type: 'error',
                    message: `Failed to paste ${this.clipboard.length} nodes: ${error.message || 'Server error'}`,
                    timeout: 5000
                });
                
            }
        } else {
            // Fallback to local operation
            this.pasteLocal();
        }
    }
    
    pasteLocal() {
        if (!this.clipboard || this.clipboard.length === 0) return;
        
        // Get current mouse position in graph coordinates
        const mouseGraphPos = this.mouseState?.graph || [0, 0];
        const newNodes = [];
        
        // Calculate the center of the clipboard content
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const nodeData of this.clipboard) {
            minX = Math.min(minX, nodeData.pos[0]);
            minY = Math.min(minY, nodeData.pos[1]);
            maxX = Math.max(maxX, nodeData.pos[0] + nodeData.size[0]);
            maxY = Math.max(maxY, nodeData.pos[1] + nodeData.size[1]);
        }
        
        const clipboardCenter = [(minX + maxX) / 2, (minY + maxY) / 2];
        
        for (const nodeData of this.clipboard) {
            const node = this.deserializeNode(nodeData);
            if (node) {
                // Position relative to mouse instead of fixed offset
                const offsetFromCenter = [
                    nodeData.pos[0] - clipboardCenter[0],
                    nodeData.pos[1] - clipboardCenter[1]
                ];
                
                node.pos[0] = mouseGraphPos[0] + offsetFromCenter[0];
                node.pos[1] = mouseGraphPos[1] + offsetFromCenter[1];
                
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
    
    async duplicateSelected() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) return;
        
        // Use OperationPipeline for collaborative duplicate
        if (window.app?.operationPipeline) {
            try {
                const nodeIds = selected.map(node => node.id);
                let result;
                
                // Use BulkOperationManager for medium to large selections
                if (nodeIds.length > 10 && window.app?.bulkOperationManager) {
                    result = await window.app.bulkOperationManager.executeBulkOperation(
                        'node_duplicate',
                        nodeIds,
                        { offset: [20, 20] },
                        null // No item preparation needed for nodeIds
                    );
                } else {
                    // Show progress feedback for medium operations
                    let progressNotification = null;
                    if (nodeIds.length > 10) {
                        progressNotification = window.app?.notifications?.show({
                            type: 'info',
                            message: `Duplicating ${nodeIds.length} nodes...`,
                            timeout: 0 // Don't auto-dismiss
                        });
                    }
                    
                    result = await window.app.operationPipeline.execute('node_duplicate', {
                        nodeIds: nodeIds,
                        offset: [20, 20]
                    });
                    
                    // Clear progress notification
                    if (progressNotification) {
                        window.app?.notifications?.dismiss(progressNotification);
                    }
                }
                
                
                if (result && result.result && result.result.nodes) {
                    // Clear selection first
                    this.selection.clear();
                    
                    // For optimistic updates, select the nodes immediately
                    if (window.app?.operationPipeline?.stateSyncManager?.optimisticEnabled) {
                        result.result.nodes.forEach(nodeData => {
                            // Find the actual node in the graph by ID
                            const node = this.graph.getNodeById(nodeData.id);
                            if (node) {
                                this.selection.selectNode(node, true);
                            }
                        });
                    } else {
                        // For non-optimistic, store node IDs to select when they arrive from server
                        this._pendingSelectionNodeIds = result.result.nodes.map(n => n.id);
                    }
                    
                    this.dirty_canvas = true;
                    
                    // Force immediate redraw to show loading states
                    requestAnimationFrame(() => this.draw());
                }
            } catch (error) {
                console.error('Failed to duplicate nodes:', error);
                
                // Clear progress notification
                if (progressNotification) {
                    window.app?.notifications?.dismiss(progressNotification);
                }
                
                // Show error to user
                window.app?.notifications?.show({
                    type: 'error',
                    message: `Failed to duplicate ${nodeIds.length} nodes: ${error.message || 'Server error'}`,
                    timeout: 5000
                });
                
            }
        } else {
            // Fallback to local operation
            this.duplicateSelectedLocal();
        }
    }
    
    duplicateSelectedLocal() {
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
    
    async syncLocalDuplicatesWithServer() {
        // Find all nodes marked for collaborative sync
        const nodesToSync = this.graph.nodes.filter(node => node._needsCollaborativeSync);
        
        if (nodesToSync.length === 0) return;
        
        // Define progressNotification at function scope
        let progressNotification = null;
        
        try {
            
            // Convert local nodes to collaborative by removing them locally 
            // and creating them through the collaborative system at final position
            const nodeDataArray = nodesToSync.map(node => ({
                originalId: node.id,
                type: node.type,
                pos: [...node.pos], // Final position after drag
                size: [...node.size],
                properties: { ...node.properties },
                flags: { ...node.flags },
                title: node.title,
                rotation: node.rotation || 0,
                aspectRatio: node.aspectRatio
            }));
            
            // Remove local duplicates first and clear them from selection
            nodesToSync.forEach(node => {
                this.selection.deselectNode(node);
                this.graph.remove(node);
                delete node._needsCollaborativeSync;
            });
            
            // Show progress feedback for large operations
            if (nodeDataArray.length > 50) {
                progressNotification = window.app?.notifications?.show({
                    type: 'info',
                    message: `Converting ${nodeDataArray.length} nodes...`,
                    timeout: 0 // Don't auto-dismiss
                });
            }
            
            // Use node_duplicate for better cache utilization
            const result = await window.app.operationPipeline.execute('node_duplicate', {
                nodeIds: [], // Empty since we're providing explicit node data
                nodeData: nodeDataArray, // Explicit node data with positions
                offset: [0, 0] // No offset, already positioned
            });
            
            // Clear progress notification
            if (progressNotification) {
                window.app?.notifications?.dismiss(progressNotification);
            }
            
            if (result && result.result && result.result.nodes) {
                // Select the created nodes
                result.result.nodes.forEach(node => {
                    this.selection.selectNode(node, true);
                });
                console.log(`🔄 Converted ${result.result.nodes.length} local duplicates to collaborative nodes`);
            } else {
                console.error('❌ Failed to create collaborative nodes:', result);
            }
            
            // Force the canvas to update selection visuals
            this.dirty_canvas = true;
            
            
        } catch (error) {
            console.error('Failed to convert local duplicates to collaborative:', error);
            
            // Clear progress notification
            if (progressNotification) {
                window.app?.notifications?.dismiss(progressNotification);
            }
            
            // Show error to user
            window.app?.notifications?.show({
                type: 'error',
                message: `Failed to convert ${nodeDataArray.length} nodes: ${error.message || 'Server error'}`,
                timeout: 5000
            });
            
            // If collaborative conversion failed (e.g., authentication error), 
            // we need to handle the local duplicates properly
            if (error.message && error.message.includes('Not authenticated')) {
                // Remove sync flags from local nodes so they don't cause issues
                const stillPendingNodes = this.graph.nodes.filter(node => node._needsCollaborativeSync);
                stillPendingNodes.forEach(node => {
                    delete node._needsCollaborativeSync;
                });
            } else {
                console.error('Unexpected error during conversion, cleaning up local duplicates');
                // For other errors, remove the local duplicates to prevent phantom nodes
                const stillPendingNodes = this.graph.nodes.filter(node => node._needsCollaborativeSync);
                stillPendingNodes.forEach(node => {
                    this.selection.deselectNode(node);
                    this.graph.remove(node);
                });
                this.selection.clear();
            }
            
        }
    }
    
    async deleteSelected() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) return;
        
        // Use OperationPipeline for collaborative deletion
        if (window.app?.operationPipeline) {
            try {
                const nodeIds = selected.map(node => node.id);
                await window.app.operationPipeline.execute('node_delete', {
                    nodeIds: nodeIds
                });
                // The operation pipeline handles the actual deletion and selection clearing
                // No need to manually remove nodes or clear selection
                this.dirty_canvas = true;
            } catch (error) {
                console.error('Failed to delete nodes:', error);
            }
        } else {
            // Fallback to local deletion if no operation pipeline
            this.deleteSelectedLocal();
        }
    }
    
    deleteSelectedLocal() {
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
            this.viewport.zoomToFit(bbox, 40, true); // Enable animation
            this.dirty_canvas = true;
        }
    }
    
    zoomToFitSelection() {
        const bbox = this.selection.getBoundingBox();
        if (bbox) {
            this.viewport.zoomToFit(bbox, 40, true); // Enable animation
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
        
        // Trigger navigation state save
        if (window.navigationStateManager) {
            window.navigationStateManager.onViewportChange();
        }
        
        this.dirty_canvas = true;
        this.debouncedSave();
    }
    
    findNodeInDirection(fromNode, direction) {
        const nodes = this.graph.nodes;
        if (nodes.length <= 1) return null;
        
        const [fromX, fromY] = fromNode.getCenter();
        let bestNode = null;
        let bestScore = Infinity;
        
        // Define direction angles (in radians)
        const directionAngles = {
            'right': 0,
            'down': Math.PI / 2,
            'left': Math.PI,
            'up': -Math.PI / 2
        };
        
        const targetAngle = directionAngles[direction];
        const angleTolerance = Utils.degToRad(CONFIG.NAVIGATION.DIRECTION_ANGLE_TOLERANCE);
        
        for (const node of nodes) {
            if (node === fromNode) continue;
            
            const [toX, toY] = node.getCenter();
            const angle = Utils.angleFromTo(fromX, fromY, toX, toY);
            
            // Calculate angular difference
            let angleDiff = Math.abs(angle - targetAngle);
            if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
            
            // Skip if outside direction quadrant
            if (angleDiff > angleTolerance) continue;
            
            // Calculate distance
            const distance = Utils.distance(fromX, fromY, toX, toY);
            
            // Score based on distance and angle alignment
            // Prefer closer nodes and better angle alignment
            const angleScore = angleDiff / angleTolerance; // 0 to 1
            const score = distance * (1 + angleScore * 0.5);
            
            if (score < bestScore) {
                bestScore = score;
                bestNode = node;
            }
        }
        
        return bestNode;
    }
    
    navigateToNode(direction) {
        const selected = this.selection.getSelectedNodes();
        if (selected.length !== 1) return;
        
        const currentNode = selected[0];
        const nextNode = this.findNodeInDirection(currentNode, direction);
        
        if (nextNode) {
            // Clear current selection
            this.selection.clear();
            
            // Select the next node
            this.selection.select(nextNode);
            
            // Zoom to fit the selected node with animation
            this.zoomToFitSelection();
            
            // Mark dirty for redraw
            this.dirty_canvas = true;
        }
    }
    
    alignSelected(axis) {
        const selected = this.selection.getSelectedNodes();
        if (selected.length < 2) return;
        
        this.pushUndoState();
        if (this.alignmentAnimator) {
            // Perform alignment
            this.alignmentAnimator.alignNodes(selected, axis);
            
            // Send the resulting positions through OperationPipeline
            if (window.app?.operationPipeline) {
                // Collect the new positions after alignment
                const nodeIds = selected.map(n => n.id);
                const positions = selected.map(n => [...n.pos]);
                
                // Send as a single batch move operation with alignment source
                window.app.operationPipeline.execute('node_move', {
                    nodeIds: nodeIds,
                    positions: positions
                }, { source: 'alignment' });
            }
        }
    }
    
    moveSelectedUp() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) return;
        
        this.pushUndoState();
        
        if (selected.length === 1) {
            // Single node: smart overlapping detection
            this.moveNodeUpSmart(selected[0]);
        } else {
            // Multiple nodes: group layer movement
            this.moveGroupUp(selected);
        }
        
        // Broadcast layer order change for collaboration
        this.broadcastLayerOrderChange(selected, 'up');
        
        this.dirty_canvas = true;
    }
    
    moveSelectedDown() {
        const selected = this.selection.getSelectedNodes();
        if (selected.length === 0) return;
        
        this.pushUndoState();
        
        if (selected.length === 1) {
            // Single node: smart overlapping detection
            this.moveNodeDownSmart(selected[0]);
        } else {
            // Multiple nodes: group layer movement
            this.moveGroupDown(selected);
        }
        
        // Broadcast layer order change for collaboration
        this.broadcastLayerOrderChange(selected, 'down');
        
        this.dirty_canvas = true;
    }
    
    // ===================================
    // SMART LAYER ORDERING
    // ===================================
    
    getOverlappingNodes(targetNode) {
        const [tx, ty, tw, th] = targetNode.getBoundingBox();
        const overlapping = [];
        
        for (const node of this.graph.nodes) {
            if (node === targetNode) continue;
            
            const [nx, ny, nw, nh] = node.getBoundingBox();
            
            // Check if bounding boxes overlap
            if (tx < nx + nw && tx + tw > nx && ty < ny + nh && ty + th > ny) {
                overlapping.push(node);
            }
        }
        
        overlapping.push(targetNode); // Include the target node itself
        return overlapping;
    }
    
    moveNodeUpSmart(node) {
        const overlapping = this.getOverlappingNodes(node);
        
        if (overlapping.length <= 1) {
            // No overlapping nodes, use regular movement
            this.graph.moveNodeUp(node);
            return;
        }
        
        // Sort overlapping nodes by their current layer order (position in nodes array)
        overlapping.sort((a, b) => this.graph.nodes.indexOf(a) - this.graph.nodes.indexOf(b));
        
        const currentIndex = overlapping.indexOf(node);
        if (currentIndex < overlapping.length - 1) {
            // Move to next position in overlapping group
            const nextNode = overlapping[currentIndex + 1];
            this.swapNodeLayers(node, nextNode);
        }
        // If already at top of overlapping group, do nothing
    }
    
    moveNodeDownSmart(node) {
        const overlapping = this.getOverlappingNodes(node);
        
        if (overlapping.length <= 1) {
            // No overlapping nodes, use regular movement
            this.graph.moveNodeDown(node);
            return;
        }
        
        // Sort overlapping nodes by their current layer order (position in nodes array)
        overlapping.sort((a, b) => this.graph.nodes.indexOf(a) - this.graph.nodes.indexOf(b));
        
        const currentIndex = overlapping.indexOf(node);
        if (currentIndex > 0) {
            // Move to previous position in overlapping group
            const prevNode = overlapping[currentIndex - 1];
            this.swapNodeLayers(node, prevNode);
        }
        // If already at bottom of overlapping group, do nothing
    }
    
    swapNodeLayers(nodeA, nodeB) {
        const indexA = this.graph.nodes.indexOf(nodeA);
        const indexB = this.graph.nodes.indexOf(nodeB);
        
        if (indexA !== -1 && indexB !== -1) {
            [this.graph.nodes[indexA], this.graph.nodes[indexB]] = [this.graph.nodes[indexB], this.graph.nodes[indexA]];
        }
    }
    
    moveGroupUp(selectedNodes) {
        // Sort selected nodes by current layer order
        const sortedNodes = [...selectedNodes].sort((a, b) => 
            this.graph.nodes.indexOf(a) - this.graph.nodes.indexOf(b)
        );
        
        // Find the topmost selected node
        const topNode = sortedNodes[sortedNodes.length - 1];
        const topIndex = this.graph.nodes.indexOf(topNode);
        
        // Find next non-selected node above the group
        let targetIndex = topIndex + 1;
        while (targetIndex < this.graph.nodes.length && 
               selectedNodes.includes(this.graph.nodes[targetIndex])) {
            targetIndex++;
        }
        
        if (targetIndex < this.graph.nodes.length) {
            // Move entire group past the next non-selected node
            this.moveGroupToPosition(sortedNodes, targetIndex + 1 - sortedNodes.length);
        }
        // If group is already at the top, do nothing
    }
    
    moveGroupDown(selectedNodes) {
        // Sort selected nodes by current layer order
        const sortedNodes = [...selectedNodes].sort((a, b) => 
            this.graph.nodes.indexOf(a) - this.graph.nodes.indexOf(b)
        );
        
        // Find the bottommost selected node
        const bottomNode = sortedNodes[0];
        const bottomIndex = this.graph.nodes.indexOf(bottomNode);
        
        // Find next non-selected node below the group
        let targetIndex = bottomIndex - 1;
        while (targetIndex >= 0 && 
               selectedNodes.includes(this.graph.nodes[targetIndex])) {
            targetIndex--;
        }
        
        if (targetIndex >= 0) {
            // Move entire group behind the next non-selected node
            this.moveGroupToPosition(sortedNodes, targetIndex);
        }
        // If group is already at the bottom, do nothing
    }
    
    moveGroupToPosition(nodesToMove, insertIndex) {
        // Remove all nodes from their current positions
        const nodes = this.graph.nodes;
        for (const node of nodesToMove) {
            const index = nodes.indexOf(node);
            if (index !== -1) {
                nodes.splice(index, 1);
                // Adjust insert index if we removed a node before it
                if (index < insertIndex) {
                    insertIndex--;
                }
            }
        }
        
        // Insert all nodes at the new position in their original relative order
        for (let i = 0; i < nodesToMove.length; i++) {
            nodes.splice(insertIndex + i, 0, nodesToMove[i]);
        }
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
            
            // Broadcast text node creation for collaboration
            if (this.collaborativeManager) {
                // Node creation is already synced when added to graph
            }
            
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
        const duplicate = this.deserializeNode(nodeData);
        
        // For media nodes, copy the actual media element reference if available
        if (duplicate && (originalNode.type === 'media/image' || originalNode.type === 'media/video')) {
            if (originalNode.img && duplicate.setImage) {
                // Copy image reference directly to avoid grey error box
                duplicate.img = originalNode.img;
                duplicate.loadingState = 'loaded';
                duplicate.loadingProgress = 1.0;
            } else if (originalNode.video && duplicate.setVideo) {
                // Copy video reference for video nodes
                duplicate.video = originalNode.video;
                duplicate.loadingState = 'loaded';
                duplicate.loadingProgress = 1.0;
            }
        }
        
        return duplicate;
    }
    
    serializeNode(node) {
        // Use UndoOptimization utility if available
        if (window.UndoOptimization) {
            return window.UndoOptimization.optimizeNodeData(node);
        }
        
        // Fallback to inline optimization
        const serialized = {
            type: node.type,
            pos: [...node.pos],
            size: [...node.size],
            title: node.title,
            properties: { ...node.properties },
            flags: { ...node.flags },
            aspectRatio: node.aspectRatio,
            rotation: node.rotation
        };
        
        // For media nodes, ensure we never include data URLs
        if (node.type === 'media/image' || node.type === 'media/video') {
            // Keep only reference properties
            serialized.properties = {
                hash: node.properties.hash,
                serverUrl: node.properties.serverUrl,
                filename: node.properties.filename,
                scale: node.properties.scale || 1.0
            };
            // Remove any accidental src field
            delete serialized.properties.src;
        }
        
        return serialized;
    }
    
    loadMediaForNode(node, nodeData) {
        const hash = nodeData.properties.hash;
        const filename = nodeData.properties.filename;
        const isVideo = nodeData.type === 'media/video';
        
        // Try to get from cache first
        if (window.imageCache) {
            const cached = window.imageCache.get(hash);
            if (cached) {
                if (isVideo && node.setVideo) {
                    node.setVideo(cached, filename, hash);
                } else if (node.setImage) {
                    node.setImage(cached, filename, hash);
                }
                return;
            }
        }
        
        // If thumbnails exist, we can at least show those while loading
        if (window.thumbnailCache && window.thumbnailCache.hasThumbnails(hash)) {
            node.loadingState = 'loaded';
            node.loadingProgress = 1.0;
        } else {
            node.loadingState = 'loading';
            node.loadingProgress = 0;
        }
        
        // Try to load from collaborative server if available
        if (this.collaborativeManager?.isConnected) {
            const serverUrl = `${CONFIG.ENDPOINTS.UPLOADS}/${nodeData.properties.serverFilename || filename}`;
            
            if (isVideo && node.setVideo) {
                node.setVideo(serverUrl, filename, hash).catch(() => {
                    console.warn('Failed to load video from server:', filename);
                    node.loadingState = 'error';
                });
            } else if (node.setImage) {
                node.setImage(serverUrl, filename, hash).catch(() => {
                    console.warn('Failed to load image from server:', filename);
                    node.loadingState = 'error';
                });
            }
        } else {
            // Single-user mode: try to find original source
            const originalSrc = nodeData.properties.originalSrc || nodeData.properties.src;
            if (originalSrc) {
                if (isVideo && node.setVideo) {
                    node.setVideo(originalSrc, filename, hash).catch(() => {
                        console.warn('Failed to load video from original source:', filename);
                        node.loadingState = 'error';
                    });
                } else if (node.setImage) {
                    node.setImage(originalSrc, filename, hash).catch(() => {
                        console.warn('Failed to load image from original source:', filename);
                        node.loadingState = 'error';
                    });
                }
            } else {
                console.warn('No source available for duplicated media node:', filename);
                node.loadingState = 'error';
            }
        }
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
            this.loadMediaForNode(node, nodeData);
        }
        
        return node;
    }
    
    // ===================================
    // EDITING SUPPORT
    // ===================================
    
    isEditingText() {
        // Check if editing node title or text
        if (this._editingTitleInput || this._editingTextInput) {
            return true;
        }
        
        // Check if editing canvas title in navigator
        const canvasTitleInput = document.querySelector('.canvas-title-input');
        if (canvasTitleInput && document.activeElement === canvasTitleInput) {
            return true;
        }
        
        return false;
    }
    
    canEditTitle(node, pos) {
        if (node.flags?.hide_title) return false;
        const displayTitle = node.getDisplayTitle();
        if (!displayTitle) return false;
        
        // Check if node is too small to show title (same as in drawNodeTitle)
        const screenScale = this.viewport.scale;
        const minScreenSize = 40;
        const nodeScreenWidth = node.size[0] * screenScale;
        const nodeScreenHeight = node.size[1] * screenScale;
        
        if (nodeScreenWidth < minScreenSize || nodeScreenHeight < minScreenSize) {
            return false; // Title not visible
        }
        
        // Get the actual draw position (accounting for animations)
        let drawPos = node.pos;
        if (node._gridAnimPos) {
            drawPos = node._gridAnimPos;  // Grid-align animation
        } else if (node._animPos) {
            drawPos = node._animPos;      // Auto-align animation
        }
        
        // Transform the click position into the node's local coordinate space
        // This accounts for both translation and rotation
        let localX = pos[0] - drawPos[0];
        let localY = pos[1] - drawPos[1];
        
        // If the node is rotated, apply inverse rotation to get local coordinates
        if (node.rotation) {
            const angle = -node.rotation * Math.PI / 180; // Negative for inverse rotation
            const cx = node.size[0] / 2;
            const cy = node.size[1] / 2;
            
            // Translate to rotation center
            const dx = localX - cx;
            const dy = localY - cy;
            
            // Apply inverse rotation
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            localX = dx * cos - dy * sin + cx;
            localY = dx * sin + dy * cos + cy;
        }
        
        // Title is drawn at local position (0, -titlePadding) in node space
        const titlePadding = 8 / screenScale; // Must match drawNodeTitle
        const fontSize = 14 / screenScale; // Must match drawNodeTitle
        const titleHeight = fontSize * 1.4; // Slightly increased for better hit area
        
        // Check if the local position is within title bounds
        // Title spans from x=0 to x=node.size[0] in local space
        // Title y position is from -titlePadding-titleHeight to -titlePadding+titleHeight*0.5
        const inBounds = localX >= 0 && localX <= node.size[0] &&
                        localY >= -titlePadding - titleHeight && 
                        localY <= -titlePadding + titleHeight * 0.5;
        
        return inBounds;
    }
    
    startTitleEditing(node, e) {
        if (this._editingTitleInput) {
            this.finishTitleEditing();
        }

        // Create input overlay for title editing
        const input = document.createElement('input');
        input.type = 'text';
        input.value = node.title || '';
        input.style.position = 'fixed';
        input.style.zIndex = '10000';
        input.style.border = '2px solid #4af';
        input.style.outline = 'none';
        input.style.background = 'rgba(0, 0, 0, 0.8)';
        input.style.color = '#ffffff';
        input.style.fontFamily = 'Arial';
        input.style.padding = '2px 4px';
        input.style.borderRadius = '4px';
        input.style.minWidth = '150px';
        input.style.boxSizing = 'border-box';
        
        // Get actual draw position (accounting for animations)
        let drawPos = node.pos;
        if (this.animationManager && this.animationManager.getNodeDrawPosition) {
            drawPos = this.animationManager.getNodeDrawPosition(node);
        } else if (node._gridAnimPos) {
            drawPos = node._gridAnimPos;
        } else if (node._animPos) {
            drawPos = node._animPos;
        }
        
        // Calculate position for input above the node - must match drawNodeTitle
        const screenScale = this.viewport.scale;
        const titlePadding = 8 / screenScale; // Same as in drawNodeTitle
        const fontSize = 14 / screenScale; // Same as in drawNodeTitle
        const titleY = drawPos[1] - titlePadding;
        
        // Convert to screen coordinates
        const [screenX, screenY] = this.viewport.convertGraphToOffset(drawPos[0], titleY);
        
        // Get canvas bounds for positioning
        const canvasRect = this.canvas.getBoundingClientRect();
        
        // Account for device pixel ratio
        const dpr = window.devicePixelRatio || 1;
        
        // Set font size that looks consistent at current zoom
        const baseFontSize = 14; // Match drawNodeTitle base size
        input.style.fontSize = `${baseFontSize}px`;
        
        // Position the input - add canvas offset and adjust for input height
        // Note: convertGraphToOffset already returns CSS pixels, not canvas pixels
        // Account for input border (2px) and padding (2px)
        const inputBorderPadding = 4; // 2px border + 2px padding
        input.style.left = `${canvasRect.left + screenX - inputBorderPadding}px`;
        // Adjust vertical position to align baseline - canvas draws from baseline, input from top
        input.style.top = `${canvasRect.top + screenY - baseFontSize - inputBorderPadding}px`;
        
        // Set width to match node width
        const nodeScreenWidth = node.size[0] * this.viewport.scale;
        input.style.width = `${Math.max(150, nodeScreenWidth)}px`;
        
        // Store references
        this._editingTitleInput = input;
        this._editingTitleNode = node;
        this._originalTitle = node.title || '';
        
        // Event handlers
        let isFinishing = false;
        input.addEventListener('blur', () => {
            if (!isFinishing) {
                this.finishTitleEditing();
            }
        });
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
                isFinishing = true;
                this.cancelTitleEditing();
            } else if (e.key === 'Enter') {
                isFinishing = true;
                this.finishTitleEditing();
            }
        });
        
        // Add to DOM and focus
        document.body.appendChild(input);
        input.focus();
        input.select();
    }
    
    startTextEditing(node, e) {
        if (this._editingTextInput) {
            this.finishTextEditing();
        }

        // Mark node as editing
        node.startEditing();
        
        // Create WYSIWYG textarea overlay
        const textarea = document.createElement('textarea');
        textarea.name = `text-edit-${node.id}`;
        textarea.id = `text-edit-${node.id}`;
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
            
            // Broadcast text changes in real-time for collaboration
            if (this.collaborativeManager) {
                this.broadcastNodePropertyUpdate(node.id, 'text', textarea.value);
            }
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
        const oldSize = [...node.size];
        if (node.autoResize) {
            node.autoResize();
        }
        
        // Broadcast final text state and any size changes for collaboration
        if (this.collaborativeManager) {
            this.broadcastNodePropertyUpdate(node.id, 'text', textarea.value);
            
            // If size changed during auto-resize, broadcast that too
            if (oldSize[0] !== node.size[0] || oldSize[1] !== node.size[1]) {
                this.broadcastNodeResize();
            }
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
    
    finishTitleEditing() {
        if (!this._editingTitleInput || !this._editingTitleNode) return;

        const node = this._editingTitleNode;
        const input = this._editingTitleInput;
        
        // Clear references first to prevent double execution
        this._editingTitleInput = null;
        this._editingTitleNode = null;
        
        // Update node title
        const newTitle = input.value.trim();
        if (newTitle !== node.title) {
            // Use operation pipeline for collaborative support
            if (window.app?.operationPipeline) {
                window.app.operationPipeline.execute('node_property_update', {
                    nodeId: node.id,
                    property: 'title',
                    value: newTitle
                });
            } else {
                node.title = newTitle;
            }
            
            // Mark canvas dirty to redraw
            this.dirty_canvas = true;
        }
        
        // Cleanup - check if input still has parent before removing
        if (input.parentNode) {
            input.parentNode.removeChild(input);
        }
        this._originalTitle = null;
    }

    cancelTitleEditing() {
        if (!this._editingTitleInput || !this._editingTitleNode) return;

        const node = this._editingTitleNode;
        const input = this._editingTitleInput;
        
        // Clear references first to prevent double execution
        this._editingTitleInput = null;
        this._editingTitleNode = null;
        
        // Restore original title (no changes)
        node.title = this._originalTitle;
        
        // Cleanup - check if input still has parent before removing
        if (input.parentNode) {
            input.parentNode.removeChild(input);
        }
        this._originalTitle = null;
        
        this.dirty_canvas = true;
    }
    
    resetAspectRatio(resizeHandle) {
        if (resizeHandle.type === 'single-resize') {
            const node = resizeHandle.node;
            if (node.originalAspect) {
                if (window.app?.operationPipeline) {
                    window.app.operationPipeline.execute('node_reset', {
                        nodeIds: [node.id],
                        resetAspectRatio: true,
                        resetRotation: false,
                        values: [node.originalAspect]
                    });
                } else {
                    // Fallback
                    node.aspectRatio = node.originalAspect;
                    node.size[1] = node.size[0] / node.originalAspect;
                    if (node.onResize) node.onResize();
                    this.dirty_canvas = true;
                }
                
                this.pushUndoState();
            }
        } else if (resizeHandle.type === 'multi-resize') {
            // Reset all selected nodes to their individual original aspect ratios
            const nodeIds = [];
            const originalAspects = [];
            
            for (const node of resizeHandle.nodes) {
                if (node.originalAspect) {
                    nodeIds.push(node.id);
                    originalAspects.push(node.originalAspect);
                }
            }
            
            if (nodeIds.length > 0) {
                if (window.app?.operationPipeline) {
                    window.app.operationPipeline.execute('node_reset', {
                        nodeIds: nodeIds,
                        resetAspectRatio: true,
                        resetRotation: false,
                        values: originalAspects
                    });
                } else {
                    // Fallback
                    for (const node of resizeHandle.nodes) {
                        if (node.originalAspect) {
                            node.aspectRatio = node.originalAspect;
                            node.size[1] = node.size[0] / node.originalAspect;
                            if (node.onResize) node.onResize();
                        }
                    }
                    this.dirty_canvas = true;
                }
            }
            
            this.pushUndoState();
        }
    }
    
    resetRotation(rotationHandle) {
        if (rotationHandle.type === 'single-rotation') {
            if (window.app?.operationPipeline) {
                window.app.operationPipeline.execute('node_reset', {
                    nodeIds: [rotationHandle.node.id],
                    resetRotation: true,
                    resetAspectRatio: false
                });
            } else {
                // Fallback
                rotationHandle.node.rotation = 0;
                this.dirty_canvas = true;
            }
        } else {
            const nodeIds = rotationHandle.nodes.map(n => n.id);
            const values = nodeIds.map(() => 0);
            
            if (window.app?.operationPipeline) {
                window.app.operationPipeline.execute('node_reset', {
                    nodeIds: nodeIds,
                    resetRotation: true,
                    resetAspectRatio: false,
                    values: values
                });
            } else {
                // Fallback
                for (const node of rotationHandle.nodes) {
                    node.rotation = 0;
                }
                this.dirty_canvas = true;
            }
        }
        this.pushUndoState();
    }
    
    // ===================================
    // UNDO/REDO SYSTEM
    // ===================================
    
    setStateManager(stateManager) {
        this.stateManager = stateManager;
    }
    
    // Action management is now handled by OperationPipeline
    
    pushUndoState() {
        if (this.stateManager && typeof this.stateManager.pushUndoState === 'function') {
            this.stateManager.pushUndoState(this.graph, this);
        } else {
            console.warn('State manager not available for undo');
        }
    }
    
    undo() {
        // Use ClientUndoManager (single source of truth)
        if (window.app?.undoManager) {
            window.app.undoManager.undo();
        } else {
            console.warn('ClientUndoManager not available - undo disabled');
        }
    }
    
    redo() {
        // Use ClientUndoManager (single source of truth)
        if (window.app?.undoManager) {
            window.app.undoManager.redo();
        } else {
            console.warn('ClientUndoManager not available - redo disabled');
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
            const hasActiveViewportAnimation = this.viewport && this.viewport.isAnimating;
            
            if (hasActiveVideos || hasActiveAlignment || hasActiveViewportAnimation) {
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
        // if (totalTime > 16) {
        //     console.log(`🐌 Slow frame: ${totalTime.toFixed(1)}ms total (grid: ${(gridTime-startTime).toFixed(1)}ms, cull: ${(cullTime-gridTime).toFixed(1)}ms, nodes: ${(nodesTime-cullTime).toFixed(1)}ms, ui: ${(uiTime-nodesTime).toFixed(1)}ms)`);
        // }
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
        
        // Draw title above the node (before selection, in node's coordinate space)
        if (!node.flags?.hide_title) {
            const displayTitle = node.getDisplayTitle();
            if (displayTitle) {
                this.drawNodeTitle(ctx, node);
            }
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
        const shouldDrawHandles = this.handleDetector.shouldShowHandles(node) && 
                                 (!this.alignmentManager || !this.alignmentManager.isAnimating());
        
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
    
    drawNodeTitle(ctx, node) {
        // Skip if hidden
        if (node.flags?.hide_title) {
            return;
        }
        
        // Get display title (with fallback)
        const displayTitle = node.getDisplayTitle();
        if (!displayTitle) {
            return;
        }
        
        // Calculate screen scale for consistent sizing
        const screenScale = this.viewport.scale;
        
        // Only show title if node is large enough on screen
        const minScreenSize = 40; // pixels
        const nodeScreenWidth = node.size[0] * screenScale;
        const nodeScreenHeight = node.size[1] * screenScale;
        
        if (nodeScreenWidth < minScreenSize || nodeScreenHeight < minScreenSize) {
            return; // Node too small, don't show title
        }
        
        ctx.save();
        
        // Move to title position (above the node, in node's coordinate space)
        const titlePadding = 8 / screenScale; // Scale padding to maintain consistent appearance
        ctx.translate(0, -titlePadding);
        
        // Set font size that scales with zoom but has reasonable limits
        const baseFontSize = 14;
        const fontSize = baseFontSize / screenScale;
        ctx.font = `${fontSize}px Arial`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        
        // Calculate max width based on node width
        const maxWidth = node.size[0] - (8 / screenScale);
        
        // Truncate text if too long
        let truncatedTitle = displayTitle;
        const textMetrics = ctx.measureText(truncatedTitle);
        if (textMetrics.width > maxWidth) {
            // Truncate with ellipsis
            while (truncatedTitle.length > 0 && ctx.measureText(truncatedTitle + '...').width > maxWidth) {
                truncatedTitle = truncatedTitle.slice(0, -1);
            }
            truncatedTitle += '...';
        }
        
        
        // Draw text with shadow for better visibility
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 2 / screenScale;
        ctx.shadowOffsetX = 1 / screenScale;
        ctx.shadowOffsetY = 1 / screenScale;
        
        ctx.fillStyle = '#ffffff';
        ctx.fillText(truncatedTitle, 4 / screenScale, 0);
        
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
        
        // Position in lower left
        const statsHeight = 80;
        const statsWidth = 160;
        const margin = 10;
        const yPos = (this.canvas.height / this.viewport.dpr) - statsHeight - margin;
        
        // Set 50% opacity for entire HUD
        ctx.globalAlpha = 0.5;
        
        // Background
        ctx.fillStyle = 'rgba(34, 34, 34, 0.8)';
        ctx.fillRect(margin, yPos, statsWidth, statsHeight);
        
        // Stats text
        ctx.font = '12px monospace';
        ctx.fillStyle = '#fff';
        
        // Count unique cached assets on the canvas
        const uniqueCachedAssets = this.getUniqueCachedAssetsOnCanvas();
        const cacheStats = window.app?.imageResourceCache ? window.app.imageResourceCache.getStats() : null;
        const cacheDisplay = cacheStats ? 
            `${uniqueCachedAssets}/${cacheStats.totalCached} (${cacheStats.hitRate})` : 
            `${uniqueCachedAssets} unique`;
        
        const stats = [
            `FPS: ${this.fps}`,
            `Nodes: ${this.graph.nodes.length}`,
            `Selected: ${this.selection.size()}`,
            `Scale: ${(this.viewport.scale * 100).toFixed(0)}%`,
            `References: ${uniqueCachedAssets}`
        ];
        
        stats.forEach((stat, i) => {
            ctx.fillText(stat, margin + 5, yPos + 15 + i * 14);
        });
        
        ctx.restore();
    }
    
    // ===================================
    // UTILITY METHODS
    // ===================================
    
    getUniqueCachedAssetsOnCanvas() {
        // Count unique hashes of image/video nodes on the canvas that are cached
        const uniqueHashes = new Set();
        
        for (const node of this.graph.nodes) {
            if ((node.type === 'media/image' || node.type === 'media/video') && node.properties?.hash) {
                // Only count if the asset is actually cached
                if (window.app?.imageResourceCache?.has(node.properties.hash)) {
                    uniqueHashes.add(node.properties.hash);
                }
            }
        }
        
        return uniqueHashes.size;
    }
    
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
        window.removeEventListener('resize', this.onWindowResize);
        
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
    
    // ===================================
    // COLLABORATIVE OPERATIONS
    // ===================================
    
    broadcastNodeMove() {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // Operations are sent through the pipeline when nodes are moved
    }
    
    broadcastNodeResize() {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // Operations are sent through the pipeline when nodes are resized
    }
    
    broadcastNodeDelete(nodeIds) {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // Operations are sent through the pipeline when nodes are deleted
    }
    
    broadcastNodeCreate(node) {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // The pipeline handles node creation when nodes are added to the graph
    }
    
    broadcastNodeReset(nodeIds, resetType, values) {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // Reset operations are sent through the pipeline
    }
    
    broadcastVideoToggle(nodeId, playing) {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // Video toggle operations are sent through the pipeline
    }
    
    // Removed broadcastAlignment - alignment now uses node_move operations
    
    broadcastNodePropertyUpdate(nodeIds, propertyName, values) {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // Property updates are sent through the pipeline
    }
    
    broadcastLayerOrderChange(nodes, direction) {
        // Now handled by OperationPipeline - this method is kept for compatibility
        // Layer order changes are sent through the pipeline
    }
    
    // ===================================
    // NAVIGATION METHODS
    // ===================================
    
    findNodeClosestToViewportCenter() {
        const nodes = this.graph.nodes;
        if (nodes.length === 0) return null;
        
        // Get viewport center coordinates
        const viewport = this.viewport.getViewport();
        const centerX = viewport.x + viewport.width / 2;
        const centerY = viewport.y + viewport.height / 2;
        
        let closestNode = null;
        let closestDistance = Infinity;
        
        for (const node of nodes) {
            const [nodeX, nodeY] = node.getCenter();
            const distance = Utils.distance(centerX, centerY, nodeX, nodeY);
            
            if (distance < closestDistance) {
                closestDistance = distance;
                closestNode = node;
            }
        }
        
        return closestNode;
    }

    findNodeInDirection(fromNode, direction) {
        const nodes = this.graph.nodes;
        if (nodes.length <= 1) return null;
        
        const [fromX, fromY] = fromNode.getCenter();
        let bestNode = null;
        let bestScore = Infinity;
        
        // Define direction angles (in radians)
        const directionAngles = {
            'right': 0,
            'down': Math.PI / 2,
            'left': Math.PI,
            'up': -Math.PI / 2
        };
        
        const targetAngle = directionAngles[direction];
        const angleTolerance = Utils.degToRad(CONFIG.NAVIGATION.DIRECTION_ANGLE_TOLERANCE);
        
        for (const node of nodes) {
            // Skip the source node
            if (node === fromNode) continue;
            
            const [toX, toY] = node.getCenter();
            
            // Calculate angle to this node
            const angle = Utils.angleFromTo(fromX, fromY, toX, toY);
            
            // Calculate angular difference, normalized to [-π, π]
            let angleDiff = angle - targetAngle;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            
            // Skip nodes that aren't in the general direction
            if (Math.abs(angleDiff) > angleTolerance) continue;
            
            // Calculate distance
            const distance = Utils.distance(fromX, fromY, toX, toY);
            
            // Score based on distance and angular deviation
            // Prefer closer nodes and those more aligned with the direction
            const angleWeight = 0.3;
            const distanceWeight = 0.7;
            const score = distance * distanceWeight + Math.abs(angleDiff) * 1000 * angleWeight;
            
            if (score < bestScore) {
                bestScore = score;
                bestNode = node;
            }
        }
        
        return bestNode;
    }
    
    navigateToNode(node) {
        if (!node) return;
        
        // Get the node's bounding box
        const bbox = node.getBoundingBox();
        
        // Zoom to fit the node with animation
        this.viewport.zoomToFit(bbox, 80, true);
        
        // Mark canvas as dirty
        this.dirty_canvas = true;
    }
}