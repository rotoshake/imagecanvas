// Main application logic

// Check if we're using the official LiteGraph or our custom implementation
const isUsingOfficialLiteGraph = typeof LiteGraph !== 'undefined' && LiteGraph.VERSION;

// If not using official LiteGraph, create our custom implementation
if (!isUsingOfficialLiteGraph) {
    // Custom LiteGraph implementation
    class LGraph {
        constructor() {
            this.nodes = [];
            this.connections = [];
            this.running = false;
            this.last_node_id = 0;
        }
        
        add(node) {
            if (!node.id) node.id = ++this.last_node_id;
            this.nodes.push(node);
            node.graph = this;
            return node;
        }
        
        remove(node) {
            const index = this.nodes.indexOf(node);
            if (index !== -1) {
                this.nodes.splice(index, 1);
                StateManager.saveState(this, this.canvas);
            }
        }
        
        start() {
            this.running = true;
        }
        
        stop() {
            this.running = false;
        }
        
        getNodeById(id) {
            return this.nodes.find(n => n.id === id);
        }
    }
    
    class LGraphCanvas {
        constructor(canvas, graph) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.graph = graph;
            this.dirty_canvas = true;
            this.offset = [0, 0];
            this.scale = 1;
            this.selected_nodes = {};
            this.dragging_canvas = false;
            this.dragging_node = null;
            this.resizing_node = null;
            this.node_captured = null;
            this.node_dragged = null;
            this.graph_mouse = [0, 0];
            this.canvas_mouse = [0, 0];
            this.last_mouse = [0, 0];
            this.clipboard = null;
            this.selection_rect = null; // [x, y, w, h] in screen coords
            this.selection_rect_graph = null; // [x, y] in graph coords (start)
            this.fps = 0;
            this._last_fps_update = performance.now();
            this._frames_this_second = 0;
            // Undo/redo stacks
            this.undoStack = [];
            this.redoStack = [];
            this.maxUndo = 20; // Increased from 5 to 20
            this.setupEventListeners();
            this.draw();
            this.grid_align_mode = false;
            this.grid_align_anchor = null;
            this.grid_align_box = null;
            this.grid_align_columns = 1;
            this.grid_align_targets = null;
            this.grid_align_animating = false;
            this.grid_align_anim_nodes = null;
            this.grid_align_anim_targets = null;
            this.grid_align_dragging = false; // <--- NEW: only true while mouse is down
        }
        async initializeUndoStack() {
            this.undoStack = await StateManager.loadUndoStack();
        }
        
        setupEventListeners() {
            this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
            this._boundOnMouseMove = this.onMouseMove.bind(this);
            this.canvas.addEventListener('mousemove', this._boundOnMouseMove);
            this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
            this.canvas.addEventListener('wheel', this.onMouseWheel.bind(this));
            this.canvas.addEventListener('contextmenu', e => e.preventDefault());
            this.canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));
            // Keyboard events
            document.addEventListener('keydown', this.onKeyDown.bind(this));
        }
        
        convertCanvasToOffset(x, y) {
            const rect = this.canvas.getBoundingClientRect();
            return [
                x - rect.left,
                y - rect.top
            ];
        }
        
        convertOffsetToCanvas(x, y) {
            return [
                (x - this.offset[0]) / this.scale,
                (y - this.offset[1]) / this.scale
            ];
        }
        
        onMouseDown(e) {
            const dpr = window.devicePixelRatio || 1;
            const [x, y] = this.convertCanvasToOffset(e.clientX, e.clientY); // screen space
            const graph_mouse = this.convertOffsetToCanvas(x, y);
            this.canvas_mouse = [x, y];
            this.graph_mouse = graph_mouse;
            this.last_mouse = [x, y];

            // --- GRID ALIGN MODE TRIGGER (TAKES PRECEDENCE) ---
            if (e.ctrlKey && e.shiftKey && !this.getNodeAtPos(graph_mouse[0], graph_mouse[1]) && e.button === 0) {
                this.grid_align_mode = true;
                this.grid_align_dragging = true;
                this.grid_align_anchor = [graph_mouse[0], graph_mouse[1]];
                this.grid_align_box = [graph_mouse[0], graph_mouse[1], graph_mouse[0], graph_mouse[1]];
                this.grid_align_columns = 1;
                this.grid_align_targets = null;
                this.grid_align_animating = false;
                this.grid_align_anim_nodes = null;
                this.grid_align_anim_targets = null;
                e.preventDefault();
                return;
            }
            // --- INTERRUPT AUTO-ALIGN ANIMATION IF ACTIVE ---
            if (this.auto_align_animating && this.auto_align_anim_nodes && this.auto_align_anim_targets) {
                // Snap all animating nodes to their final positions
                for (const n of this.auto_align_anim_nodes) {
                    const target = this.auto_align_anim_targets[n.id];
                    if (target) {
                        n.pos[0] = target[0];
                        n.pos[1] = target[1];
                    }
                    delete n._animPos;
                    delete n._animVel;
                }
                // Clear animation state
                this.auto_align_animating = false;
                this.auto_align_anim_nodes = null;
                this.auto_align_anim_targets = null;
                this.auto_align_mode = false;
                this.auto_align_axis = null;
                this.auto_align_targets = null;
                this.auto_align_originals = null;
                this.auto_align_master_order = null;
                this.auto_align_dominant_axis = null;
                this.auto_align_is_reorder_mode = false;
                this.auto_align_last_axis = null;
                this.auto_align_committed = false;
                this.auto_align_committed_axis = null;
                this.auto_align_committed_targets = null;
                this.auto_align_committed_direction = null;
                this.dirty_canvas = true;
                // Optionally, save state and push undo here if you want to treat this as a completed operation
                StateManager.saveState(this.graph, this);
                this.pushUndoState();
            }
            // --- GROUP BOX DRAG ---
            for (const groupNode of this.graph.nodes) {
                if (groupNode.type === 'groupbox' && typeof groupNode.isPointInBar === 'function') {
                    if (groupNode.isPointInBar(graph_mouse[0], graph_mouse[1])) {
                        groupNode._dragging = true;
                        groupNode._dragOffset = [graph_mouse[0] - groupNode.pos[0], graph_mouse[1] - groupNode.pos[1]];
                        this.dragging_groupbox = groupNode;
                        groupNode._containedNodeOffsets = {};
                        for (const id of groupNode.containedNodeIds) {
                            const n = this.graph.getNodeById(id);
                            if (n) {
                                groupNode._containedNodeOffsets[id] = [n.pos[0] - groupNode.pos[0], n.pos[1] - groupNode.pos[1]];
                            }
                        }
                        e.preventDefault();
                        return;
                    }
                }
            }
            // --- NODE DRAG START ---
            // Only allow dragging non-groupbox nodes
            const node = this.getNodeAtPos(graph_mouse[0], graph_mouse[1]);
            // --- FIX: use screen-space for handle detection ---
            const resizeNode = this.getNodeResizeHandle(x, y);
            console.log('onMouseDown:', {x, y, node: node?.id, resizeNode: resizeNode?.id});
            
            // Simple debug for single node
            if (Object.keys(this.selected_nodes).length === 1) {
                const selectedNode = Object.values(this.selected_nodes)[0];
                console.log('Selected node:', selectedNode.id, 'resizeNode:', resizeNode?.id);
            }
            
            // Debug: show handle detection details for selected nodes (FIXED: no extra offset on clickX/Y)
            if (Object.keys(this.selected_nodes).length === 1) {
                const selectedNode = Object.values(this.selected_nodes)[0];
                const dpr = window.devicePixelRatio || 1;
                const nodeBR = [selectedNode.pos[0] + selectedNode.size[0], selectedNode.pos[1] + selectedNode.size[1]];
                const screenX = nodeBR[0] * this.scale + this.offset[0];
                const screenY = nodeBR[1] * this.scale + this.offset[1];
                const handleCssSize = 16;  // FIXED: CSS pixels, not * dpr
                const nodeCssWidth = selectedNode.size[0] * this.scale;
                const nodeCssHeight = selectedNode.size[1] * this.scale;
                const clickX = x;  // FIXED: no + this.offset[0]
                const clickY = y;  // FIXED: no + this.offset[1]
                const inHandleArea = (
                    clickX >= screenX - handleCssSize &&
                    clickX <= screenX &&
                    clickY >= screenY - handleCssSize &&
                    clickY <= screenY
                );
                const handleDisabled = (
                    handleCssSize > nodeCssWidth / 2 ||  // FIXED: /2 instead of /3
                    handleCssSize > nodeCssHeight / 2
                );
                console.log('Handle debug:', {
                    nodeId: selectedNode.id,
                    nodeBR: nodeBR,
                    screenX: screenX,
                    screenY: screenY,
                    handleCssSize: handleCssSize,
                    nodeCssWidth: nodeCssWidth,
                    nodeCssHeight: nodeCssHeight,
                    clickX: clickX,
                    clickY: clickY,
                    inHandleArea: inHandleArea,
                    handleDisabled: handleDisabled
                });
            }
            // --- NEW: Prioritize auto-align before bounding box handle ---
            this._resizing_selection_box = false;
            if (!node && !resizeNode && e.shiftKey && Object.keys(this.selected_nodes).length > 1) {
                // Do not clear selection, start auto-align mode
                this.auto_align_mode = true;
                this.auto_align_start = [this.graph_mouse[0], this.graph_mouse[1]];
                this.auto_align_original_click = [this.graph_mouse[0], this.graph_mouse[1]]; // Store original click position
                this.auto_align_has_left_circle = false; // Track if user has ever left the home circle
                this.auto_align_axis = null; // not determined yet
                this.auto_align_targets = null;
                this.auto_align_last_axis = null;
                this.auto_align_committed = false;
                this.auto_align_committed_axis = null;
                this.auto_align_committed_targets = null;
                this.auto_align_committed_direction = null;
                this.auto_align_commit_point = [this.graph_mouse[0], this.graph_mouse[1]];
                this.auto_align_waiting_for_switch = false; // <-- new
                this.auto_align_is_reorder_mode = false; // Track if we're in reorder mode
                // Store original positions for cancel animation
                this.auto_align_originals = {};
                for (const id in this.selected_nodes) {
                    const n = this.selected_nodes[id];
                    this.auto_align_originals[id] = [...n.pos];
                    if (!n._animPos) n._animPos = [...n.pos];
                    if (!n._animVel) n._animVel = [0, 0];
                }
                e.preventDefault();
                return; // <-- EARLY RETURN: do not set up drag
            }
            // --- Bounding box handle ---
            if (Object.keys(this.selected_nodes).length > 1 && this.isSelectionBoxHandle(x, y)) {
                this._resizing_selection_box = true;
                // Store initial bounding box and node states
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const selId in this.selected_nodes) {
                    const n = this.selected_nodes[selId];
                    minX = Math.min(minX, n.pos[0]);
                    minY = Math.min(minY, n.pos[1]);
                    maxX = Math.max(maxX, n.pos[0] + n.size[0]);
                    maxY = Math.max(maxY, n.pos[1] + n.size[1]);
                }
                this._multi_resize_bbox = [minX, minY, maxX - minX, maxY - minY];
                this._multi_resize_initial = {};
                for (const selId in this.selected_nodes) {
                    const n = this.selected_nodes[selId];
                    this._multi_resize_initial[selId] = {
                        pos: [...n.pos],
                        size: [...n.size],
                        aspect: n.aspectRatio || (n.size[0] / n.size[1])
                    };
                }
                // Record anchor handle and initial mouse position in graph coordinates
                this._multi_resize_anchor = [x, y]; // screen space, but we want graph space
                this._multi_resize_anchor_graph = this.convertOffsetToCanvas(x, y);
                this._multi_resize_mouse_start = this.convertOffsetToCanvas(x, y);
                this._multi_resize_shift = e.shiftKey;
                this._multi_resize_bbox_width_start = maxX - minX;
                this.resizing_node = null;
                e.preventDefault();
                return;
            }
            // Check if clicking on resize handle
            if (resizeNode) {
                this.resizing_node = resizeNode;
                // Only select the node if it is not already selected
                if (!this.selected_nodes[resizeNode.id]) {
                this.selectNode(resizeNode);
                }
                // --- Multi-node resize: store initial bounding box and node states ---
                if (Object.keys(this.selected_nodes).length > 1) {
                    // Compute bounding box
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    for (const selId in this.selected_nodes) {
                        const n = this.selected_nodes[selId];
                        minX = Math.min(minX, n.pos[0]);
                        minY = Math.min(minY, n.pos[1]);
                        maxX = Math.max(maxX, n.pos[0] + n.size[0]);
                        maxY = Math.max(maxY, n.pos[1] + n.size[1]);
                    }
                    this._multi_resize_bbox = [minX, minY, maxX - minX, maxY - minY];
                    this._multi_resize_initial = {};
                    for (const selId in this.selected_nodes) {
                        const n = this.selected_nodes[selId];
                        this._multi_resize_initial[selId] = {
                            pos: [...n.pos],
                            size: [...n.size],
                            aspect: n.aspectRatio || (n.size[0] / n.size[1])
                        };
                    }
                    // Record anchor handle and initial mouse position in graph coordinates
                    this._multi_resize_anchor = [x, y]; // screen space, but we want graph space
                    this._multi_resize_anchor_graph = this.convertOffsetToCanvas(x, y);
                    this._multi_resize_mouse_start = this.convertOffsetToCanvas(x, y);
                } else {
                    // Single node: store initial size/pos for resizing
                    this._single_resize_initial = {
                        pos: [...resizeNode.pos],
                        size: [...resizeNode.size],
                        aspect: resizeNode.aspectRatio || (resizeNode.size[0] / resizeNode.size[1])
                    };
                    this.dragging_node = null; // Prevent drag from interfering with resize
                }
                e.preventDefault();
                return;
            }
            // Check if clicking on a node
            if (node) {
                // Check for alt+drag (duplicate)
                if (e.altKey) {
                    // Clone all selected nodes, not just the clicked one
                    const selectedNodes = Object.values(this.selected_nodes);
                    const clonedNodes = [];
                    
                    if (selectedNodes.length > 0) {
                        // Find the node that was clicked (the one under the mouse)
                        const clickedNode = selectedNodes.find(n => 
                            this.graph_mouse[0] >= n.pos[0] && 
                            this.graph_mouse[0] <= n.pos[0] + n.size[0] &&
                            this.graph_mouse[1] >= n.pos[1] && 
                            this.graph_mouse[1] <= n.pos[1] + n.size[1]
                        ) || selectedNodes[0];
                        
                        // Use the actual mouse position in graph coordinates
                        const mouseX = this.graph_mouse[0];
                        const mouseY = this.graph_mouse[1];
                        
                        // Debug: log the positions to see what's happening
                        console.log('Alt-drag duplication:', {
                            mousePos: [mouseX, mouseY],
                            clickedNode: clickedNode.title,
                            clickedNodePos: clickedNode.pos,
                            clickedNodeSize: clickedNode.size
                        });
                        
                        for (const selectedNode of selectedNodes) {
                            this.duplicateCount = (this.duplicateCount || 0) + 1;
                            const newNode = window.LiteGraph.createNode(selectedNode.type);
                            if (newNode) {
                                // Place new node at exactly the same position as the original
                                newNode.pos = [
                                    selectedNode.pos[0],
                                    selectedNode.pos[1]
                                ];
                                newNode.size = [...selectedNode.size];
                                newNode.properties = {...selectedNode.properties};
                                newNode.title = selectedNode.title;
                                if (selectedNode.type === "media/image" && selectedNode.properties.src) {
                                    newNode.setImage(selectedNode.properties.src, selectedNode.properties.filename);
                                }
                                this.graph.add(newNode);
                                clonedNodes.push(newNode);
                            }
                        }
                        
                        // Select all the cloned nodes
                        this.selected_nodes = {};
                        for (const clonedNode of clonedNodes) {
                            this.selected_nodes[clonedNode.id] = clonedNode;
                        }
                        
                        // Set up multi-drag offsets for all cloned nodes
                        this._multi_drag_offsets = {};
                        for (const clonedNode of clonedNodes) {
                            this._multi_drag_offsets[clonedNode.id] = [
                                clonedNode.pos[0] - this.graph_mouse[0],
                                clonedNode.pos[1] - this.graph_mouse[1]
                            ];
                        }
                        
                        // Start dragging the first cloned node
                        if (clonedNodes.length > 0) {
                            this.dragging_node = clonedNodes[0];
                            this.node_captured = clonedNodes[0];
                        }
                        
                        this.dirty_canvas = true;
                        StateManager.saveState(this.graph, this);
                        this.pushUndoState();
                        e.preventDefault();
                        return;
                    }
                }
                // Shift-click: add/remove node from selection
                if (e.shiftKey) {
                    if (this.selected_nodes[node.id]) {
                        // Deselect if already selected
                        delete this.selected_nodes[node.id];
                    } else {
                        // Add to selection
                        this.selected_nodes[node.id] = node;
                    }
                } else {
                    // If node is already selected, do not change selection (for group drag)
                    if (!this.selected_nodes[node.id]) {
                        // Normal click: select only this node
                        this.selectNode(node);
                    }
                }
                this.dragging_node = node;
                this.node_captured = node;
                // Always store initial offsets for all selected nodes
                if (Object.keys(this.selected_nodes).length > 1) {
                    this._multi_drag_offsets = {};
                    for (const selId in this.selected_nodes) {
                        const selNode = this.selected_nodes[selId];
                        this._multi_drag_offsets[selId] = [
                            selNode.pos[0] - this.graph_mouse[0],
                            selNode.pos[1] - this.graph_mouse[1]
                        ];
                    }
            } else {
                    this._multi_drag_offsets = null;
                }
            } else if (!e.shiftKey || Object.keys(this.selected_nodes).length <= 1) {
                // Only clear selection if not shift+multi-select
                this.selected_nodes = {};
                // Only start rectangular selection for left mouse button
                if (e.button === 0 && !(e.ctrlKey || e.metaKey)) {
                    this.selection_rect = [x * dpr, y * dpr, 0, 0]; // screen coords in device pixels
                    this.selection_rect_graph = [this.graph_mouse[0], this.graph_mouse[1]]; // graph coords
                } else if (e.button === 1 || ((e.ctrlKey || e.metaKey) && e.button === 0)) {
                this.dragging_canvas = true;
            }
            }
            this.dirty_canvas = true;
            e.preventDefault();
        }
        
        onMouseMove(e) {
            console.log('onMouseMove called', 'grid_align_mode:', this.grid_align_mode);
            const dpr = window.devicePixelRatio || 1;
            const [x, y] = this.convertCanvasToOffset(e.clientX, e.clientY);
            this.canvas_mouse = [x, y];
            this.graph_mouse = this.convertOffsetToCanvas(x, y);

            // --- GRID ALIGN MODE (TOP PRIORITY) ---
            if (this.grid_align_mode && this.grid_align_dragging && this.grid_align_anchor) {
                // Update bounding box in graph coordinates
                const ax = this.grid_align_anchor[0];
                const ay = this.grid_align_anchor[1];
                const bx = this.graph_mouse[0];
                const by = this.graph_mouse[1];
                this.grid_align_box = [ax, ay, bx, by];
                // Use max node width as cell width
                const selectedNodes = Object.values(this.selected_nodes);
                let maxNodeWidth = 100;
                let maxNodeHeight = 100;
                if (selectedNodes.length > 0) {
                    maxNodeWidth = Math.max(...selectedNodes.map(n => n.size[0]));
                    maxNodeHeight = Math.max(...selectedNodes.map(n => n.size[1]));
                }
                const cellWidth = maxNodeWidth + DEFAULT_ALIGN_MARGIN;
                const cellHeight = maxNodeHeight + DEFAULT_ALIGN_MARGIN;
                const width = Math.abs(bx - ax);
                const height = Math.abs(by - ay);
                let columns = 1;
                if (width > cellWidth * 1.1) {
                    columns = Math.max(1, Math.round(width / cellWidth));
                }
                this.grid_align_columns = columns;
                // Calculate rows
                const rows = Math.ceil(selectedNodes.length / columns);
                // Determine grid direction
                const leftToRight = bx >= ax;
                const topToBottom = by >= ay;
                // Compute grid origin (top-left or other corner)
                const originX = leftToRight ? Math.min(ax, bx) : Math.max(ax, bx) - columns * cellWidth;
                const originY = topToBottom ? Math.min(ay, by) : Math.max(ay, by) - rows * cellHeight;
                // Assign target positions
                const targets = {};
                selectedNodes.forEach((node, i) => {
                    const col = i % columns;
                    const row = Math.floor(i / columns);
                    let tx = originX + (leftToRight ? col * cellWidth : (columns - 1 - col) * cellWidth);
                    let ty = originY + (topToBottom ? row * cellHeight : (rows - 1 - row) * cellHeight);
                    // Center node in cell, preserve aspect ratio
                    const w = node.size[0], h = node.size[1];
                    tx += (cellWidth - w) / 2;
                    ty += (cellHeight - h) / 2;
                    targets[node.id] = [tx, ty];
                });
                // Animate nodes to targets using spring
                this.grid_align_anim_nodes = selectedNodes;
                this.grid_align_anim_targets = targets;
                if (!this.grid_align_animating) {
                    // Initialize anim state
                    for (const node of selectedNodes) {
                        node._gridAnimPos = [...node.pos];
                        node._gridAnimVel = [0, 0];
                    }
                    this.grid_align_animating = true;
                }
                this.dirty_canvas = true;
                return;
            }
            
            // --- AUTO-ALIGN MODE ---
            if (this.auto_align_mode) {
                // Use threshold in screen px, convert to graph units
                const threshold = 40 / this.scale; // px in graph units
                let axis = null;
                let direction = null;
                const dx = this.graph_mouse[0] - this.auto_align_start[0];
                const dy = this.graph_mouse[1] - this.auto_align_start[1];
                if (Math.abs(dx) > Math.abs(dy)) {
                    axis = 'horizontal';
                    direction = dx > 0 ? 1 : -1;
                } else if (Math.abs(dy) > Math.abs(dx)) {
                    axis = 'vertical';
                    direction = dy > 0 ? 1 : -1;
                }
                // Only commit if drag distance exceeds threshold in one direction from the commit point
                if (!this.auto_align_committed) {
                    const cdx = this.graph_mouse[0] - this.auto_align_commit_point[0];
                    const cdy = this.graph_mouse[1] - this.auto_align_commit_point[1];
                    let commitAxis = null, commitDir = null;
                    if (Math.abs(cdx) > Math.abs(cdy)) {
                        commitAxis = 'horizontal';
                        commitDir = cdx > 0 ? 1 : -1;
                    } else if (Math.abs(cdy) > Math.abs(cdx)) {
                        commitAxis = 'vertical';
                        commitDir = cdy > 0 ? 1 : -1;
                    }
                    if ((commitAxis === 'horizontal' && Math.abs(cdx) > threshold) || (commitAxis === 'vertical' && Math.abs(cdy) > threshold)) {
                        this.auto_align_committed = true;
                        this.auto_align_committed_axis = commitAxis;
                        this.auto_align_committed_direction = commitDir;
                        
                        // Check if images are already aligned on this axis - if so, switch to reorder mode
                        if (this.areImagesAlignedOnAxis(commitAxis)) {
                            this.auto_align_is_reorder_mode = true;
                        } else {
                            this.auto_align_is_reorder_mode = false;
                        }
                        
                        // Do NOT push undo state here - wait for animation completion
                        // Use the helper method for consistent behavior
                        this.triggerAutoAlign(commitAxis);
                        this.auto_align_committed_targets = this.auto_align_anim_targets;
                        this.auto_align_commit_point = [this.graph_mouse[0], this.graph_mouse[1]];
                        this.auto_align_waiting_for_switch = false;
                    } else {
                        // Not committed, keep nodes at original positions
                        for (const id in this.selected_nodes) {
                            const n = this.selected_nodes[id];
                            n._animPos = [...this.auto_align_originals ? this.auto_align_originals[id] : n.pos];
                            n._animVel = [0, 0];
                        }
                        this.dirty_canvas = true;
                        return; // <-- EARLY RETURN: do not run drag logic
                    }
                } else {
                    // After commit, check if user has left the home circle
                    const homeRadius = 100 / this.scale; // 100px radius for home circle (doubled from 50px)
                    const distanceFromHome = Math.sqrt(
                        Math.pow(this.graph_mouse[0] - this.auto_align_original_click[0], 2) +
                        Math.pow(this.graph_mouse[1] - this.auto_align_original_click[1], 2)
                    );
                    
                    // Mark that user has left the circle
                    if (distanceFromHome > homeRadius) {
                        this.auto_align_has_left_circle = true;
                    }
                    
                    // DISABLED: Only allow cancel if user has left the circle and is now back in it
                    /*
                    if (this.auto_align_has_left_circle && distanceFromHome < homeRadius) {
                        // Treat cancel as a third alignment type: "original" alignment
                        const currentAxis = 'original';
                        const currentDirection = 0; // No direction for original alignment
                        
                        // Use the same pattern as regular alignments
                        this.auto_align_committed_axis = currentAxis;
                        this.auto_align_committed_direction = currentDirection;
                        // Use the helper method for consistent behavior
                        this.triggerAutoAlign(currentAxis);
                        this.auto_align_committed_targets = this.auto_align_anim_targets;
                        this.auto_align_commit_point = [this.graph_mouse[0], this.graph_mouse[1]];
                        
                        // Push undo state for cancel operation
                        StateManager.saveState(this.graph, this);
                        this.pushUndoState();
                        
                        return; // <-- EARLY RETURN: do not run drag logic
                    }
                    */
                    
                    // After commit, allow immediate axis switching based on current direction
                    const cdx = this.graph_mouse[0] - this.auto_align_commit_point[0];
                    const cdy = this.graph_mouse[1] - this.auto_align_commit_point[1];
                    const currentAxis = Math.abs(cdx) > Math.abs(cdy) ? 'horizontal' : 'vertical';
                    const currentDirection = currentAxis === 'horizontal' ? Math.sign(cdx) : Math.sign(cdy);
                    
                    // Only allow axis switching if we're not in the home circle
                    // If axis or direction has changed significantly and we're not in home circle, switch immediately
                    const directionThreshold = 40 / this.scale; // increased threshold for direction change
                    if (distanceFromHome > homeRadius && 
                        (currentAxis !== this.auto_align_committed_axis || 
                        (Math.abs(cdx) > directionThreshold && Math.sign(cdx) !== this.auto_align_committed_direction) ||
                        (Math.abs(cdy) > directionThreshold && Math.sign(cdy) !== this.auto_align_committed_direction))) {
                        
                        // Check if switching to reorder mode (if images are already aligned on this axis)
                        const switchingToReorder = this.areImagesAlignedOnAxis(currentAxis);
                        if (switchingToReorder) {
                            this.auto_align_is_reorder_mode = true;
                        } else {
                            this.auto_align_is_reorder_mode = false;
                        }
                        
                        this.auto_align_committed_axis = currentAxis;
                        this.auto_align_committed_direction = currentDirection;
                        // Do NOT update auto_align_originals on axis switch
                        // Use the helper method for consistent behavior
                        this.triggerAutoAlign(currentAxis);
                        this.auto_align_committed_targets = this.auto_align_anim_targets;
                        this.auto_align_commit_point = [this.graph_mouse[0], this.graph_mouse[1]];
                        
                        // Push undo state for axis switching
                        StateManager.saveState(this.graph, this);
                        this.pushUndoState();
                    }
                }
                // Remove duplicate animation logic - let the main animation loop handle it
                this.dirty_canvas = true;
                return; // <-- EARLY RETURN: do not run drag logic
            }
            
            if (this.resizing_node || this._resizing_selection_box) {
                // --- Multi-node resize ---
                if (Object.keys(this.selected_nodes).length > 1 && this._multi_resize_bbox && this._multi_resize_initial) {
                    const bbox = this._multi_resize_bbox;
                    const initial = this._multi_resize_initial;
                    const anchorX = bbox[0];
                    const anchorY = bbox[1];
                    const mouseX = this.graph_mouse[0];
                    const mouseY = this.graph_mouse[1];
                    const shift = e.shiftKey;

                    if (this._resizing_selection_box) {
                        // --- Bounding box handle: scale whole selection as a group ---
                        const oldWidth = bbox[2];
                        const oldHeight = bbox[3];
                        const newWidthAttempt = Math.max(oldWidth * 0.1, mouseX - anchorX); // Min 10% of original width
                        const newHeightAttempt = Math.max(oldHeight * 0.1, mouseY - anchorY); // Min 10% of original height
                        let scaleX = newWidthAttempt / oldWidth;
                        let scaleY = newHeightAttempt / oldHeight;

                        let posScaleX, posScaleY, sizeScaleX, sizeScaleY;
                        if (shift) {
                            // Non-uniform: independent scales for X/Y
                            posScaleX = scaleX;
                            posScaleY = scaleY;
                            sizeScaleX = scaleX;
                            sizeScaleY = scaleY;
                        } else {
                            // Uniform: constrain to preserve bounding box aspect (take min scale)
                            const scale = Math.max(0.1, Math.min(scaleX, scaleY)); // Min scale 10%
                            posScaleX = scale;
                            posScaleY = scale;
                            sizeScaleX = scale;
                            sizeScaleY = scale;
                        }

                        for (const selId in this.selected_nodes) {
                            const n = this.selected_nodes[selId];
                            const init = initial[selId];

                            // Scale size
                            n.size[0] = Math.max(50, init.size[0] * sizeScaleX);
                            n.size[1] = Math.max(50, init.size[1] * sizeScaleY);
                            n.aspectRatio = n.size[0] / n.size[1]; // Update aspect (preserved in uniform case)

                            // Scale position relative to top-left anchor
                            n.pos[0] = anchorX + (init.pos[0] - anchorX) * posScaleX;
                            n.pos[1] = anchorY + (init.pos[1] - anchorY) * posScaleY;

                            if (typeof n.onResize === 'function') {
                                n.onResize();
                            }
                        }
                    } else if (this.resizing_node) {
                        // Existing logic for individual node handle resizes in multi-select (unchanged)
                        const ctrl = e.ctrlKey || e.metaKey;
                        const shift = e.shiftKey;
                        if (ctrl && shift) {
                            // Ctrl+Shift: Snap all to anchor node's width and height (non-uniform)
                            const anchorId = this.resizing_node.id;
                            const anchorInit = initial[anchorId];
                            const anchorStartWidth = anchorInit.size[0];
                            const anchorStartHeight = anchorInit.size[1];
                            const newWidth = Math.max(100, mouseX - anchorInit.pos[0]);
                            const newHeight = Math.max(100, mouseY - anchorInit.pos[1]);
                            for (const selId in this.selected_nodes) {
                                const n = this.selected_nodes[selId];
                                n.size[0] = newWidth;
                                n.size[1] = newHeight;
                                n.aspectRatio = n.size[0] / n.size[1];
                                if (typeof n.onResize === 'function') {
                                    n.onResize();
                                }
                            }
                        } else if (ctrl) {
                            // Ctrl only: Snap all to anchor node's width, keep current aspect ratio
                            const anchorId = this.resizing_node.id;
                            const anchorInit = initial[anchorId];
                            const anchorStartWidth = anchorInit.size[0];
                            const newWidth = Math.max(100, mouseX - anchorInit.pos[0]);
                            for (const selId in this.selected_nodes) {
                                const n = this.selected_nodes[selId];
                                n.size[0] = newWidth;
                                n.size[1] = Math.max(100, newWidth / (n.aspectRatio || 1));
                                if (typeof n.onResize === 'function') {
                                    n.onResize();
                                }
                            }
                        } else if (shift) {
                            // Shift: Non-uniform scale all nodes by the same factors as the dragged (anchor) node
                            const anchorId = this.resizing_node.id;
                            const anchorInit = initial[anchorId];
                            const anchorStartWidth = anchorInit.size[0];
                            const anchorStartHeight = anchorInit.size[1];
                            const newWidth = Math.max(100, mouseX - anchorInit.pos[0]);
                            const newHeight = Math.max(100, mouseY - anchorInit.pos[1]);
                            const scaleX = newWidth / anchorStartWidth;
                            const scaleY = newHeight / anchorStartHeight;
                            for (const selId in this.selected_nodes) {
                                const n = this.selected_nodes[selId];
                                const init = initial[selId];
                                n.size[0] = Math.max(100, init.size[0] * scaleX);
                                n.size[1] = Math.max(100, init.size[1] * scaleY);
                                n.aspectRatio = n.size[0] / n.size[1];
                                if (typeof n.onResize === 'function') {
                                    n.onResize();
                                }
                            }
                        } else {
                            // Default: Uniform scale all images in place, relative to anchor image
                            const anchorId = this.resizing_node.id;
                            const anchorInit = initial[anchorId];
                            const anchorStartWidth = anchorInit.size[0];
                            const newWidth = Math.max(100, mouseX - anchorInit.pos[0]);
                            const scale = newWidth / anchorStartWidth;
                            for (const selId in this.selected_nodes) {
                                const n = this.selected_nodes[selId];
                                const init = initial[selId];
                                n.size[0] = Math.max(100, init.size[0] * scale);
                                n.size[1] = n.size[0] / init.aspect;
                                n.aspectRatio = init.aspect;
                                if (typeof n.onResize === 'function') {
                                    n.onResize();
                                }
                            }
                        }
                    }
                    this.dirty_canvas = true;
                } else if (this.resizing_node && Object.keys(this.selected_nodes).length === 1 && this._single_resize_initial) {
                    // --- Single node resize logic (unchanged) ---
                    const node = this.resizing_node;
                    const init = this._single_resize_initial;
                    const anchorX = init.pos[0];
                    const anchorY = init.pos[1];
                    const mouseX = this.graph_mouse[0];
                    const mouseY = this.graph_mouse[1];
                    const shift = e.shiftKey;
                    let newWidth = Math.max(100, mouseX - anchorX); // 100px minimum
                    let newHeight = Math.max(100, mouseY - anchorY); // 100px minimum
                    if (shift) {
                        // Non-uniform scale
                        node.size[0] = newWidth;
                        node.size[1] = newHeight;
                        node.aspectRatio = node.size[0] / node.size[1];
                    } else {
                        // Uniform scale (preserve aspect)
                        node.size[0] = newWidth;
                        node.size[1] = newWidth / init.aspect;
                        node.aspectRatio = init.aspect;
                    }
                    // Call node's onResize to update internal state
                    if (typeof node.onResize === 'function') {
                        node.onResize();
                    }
                    this.dirty_canvas = true;
                }
            } else if (this.dragging_node) {
                // Multi-node drag
                if (this._multi_drag_offsets) {
                    for (const selId in this.selected_nodes) {
                        const selNode = this.selected_nodes[selId];
                        const offset = this._multi_drag_offsets[selId];
                        selNode.pos[0] = this.graph_mouse[0] + offset[0];
                        selNode.pos[1] = this.graph_mouse[1] + offset[1];
                    }
                } else {
                const dx = x - this.last_mouse[0];
                const dy = y - this.last_mouse[1];
                this.dragging_node.pos[0] += dx / this.scale;
                this.dragging_node.pos[1] += dy / this.scale;
                }
                this.dirty_canvas = true;
            } else if (this.selection_rect) {
                // Update selection rectangle in device pixels
                const [startX, startY] = [this.selection_rect[0], this.selection_rect[1]];
                this.selection_rect[2] = x * dpr - startX;
                this.selection_rect[3] = y * dpr - startY;
                this.dirty_canvas = true;
            } else if (this.dragging_canvas) {
                const dx = x - this.last_mouse[0];
                const dy = y - this.last_mouse[1];
                this.offset[0] += dx;
                this.offset[1] += dy;
                this.dirty_canvas = true;
                // StateManager.saveState(this.graph, this); // Removed for performance
            } else {
                // Update cursor based on what we're hovering over
                const resizeNode = this.getNodeResizeHandle(this.canvas_mouse[0], this.canvas_mouse[1]);
                this.canvas.style.cursor = resizeNode ? 'se-resize' : 'default';
            }
            
            this.last_mouse = [x, y];
            
            // --- GROUP BOX DRAG ---
            if (this.dragging_groupbox && this.dragging_groupbox._dragging) {
                const [x, y] = this.convertCanvasToOffset(e.clientX, e.clientY);
                const graph_mouse = this.convertOffsetToCanvas(x, y);
                const node = this.dragging_groupbox;
                node.pos[0] = graph_mouse[0] - node._dragOffset[0];
                node.pos[1] = graph_mouse[1] - node._dragOffset[1];
                for (const id of node.containedNodeIds) {
                    const n = this.graph.getNodeById(id);
                    if (n && node._containedNodeOffsets && node._containedNodeOffsets[id]) {
                        n.pos[0] = node.pos[0] + node._containedNodeOffsets[id][0];
                        n.pos[1] = node.pos[1] + node._containedNodeOffsets[id][1];
                    }
                }
                this.dirty_canvas = true;
                e.preventDefault();
                return;
            }
            
            // if (this.dirty_canvas) { // Removed direct draw
            //     this.draw();
            // }
        }
        
        onMouseUp(e) {
            // --- AUTO-ALIGN MODE ---
            if (this.auto_align_mode) {
                // Let the animation complete naturally - don't set final positions here
                this.auto_align_mode = false;
                this.auto_align_axis = null;
                this.auto_align_targets = null;
                this.auto_align_originals = null;
                this.auto_align_master_order = null;
                this.auto_align_dominant_axis = null;
                this.auto_align_is_reorder_mode = false;
                // DO NOT reset auto_align_has_been_committed_before here - preserve it across drag operations
                this.auto_align_last_axis = null;
                this.auto_align_committed = false;
                this.auto_align_committed_axis = null;
                this.auto_align_committed_targets = null;
                this.auto_align_committed_direction = null;
                this.dirty_canvas = true;
                return; // <-- EARLY RETURN: do not run drag logic
            }
            if (this.dragging_node || this.resizing_node) {
                StateManager.saveState(this.graph, this);
                this.pushUndoState();
            } else if (this.dragging_canvas) {
                // Only save persistent state for panning, not undo
                StateManager.saveState(this.graph, this);
            }
            if (this.selection_rect && this.selection_rect_graph) {
                // Finalize selection using graph coordinates
                const [gx0, gy0] = this.selection_rect_graph;
                const [sx, sy, sw, sh] = this.selection_rect;
                // Convert selection rectangle end point from device pixels to graph coordinates
                const dpr = window.devicePixelRatio || 1;
                const [ex, ey] = [sx + sw, sy + sh];
                const [gx1, gy1] = this.convertOffsetToCanvas(ex / dpr, ey / dpr);
                const rect = [
                    Math.min(gx0, gx1),
                    Math.min(gy0, gy1),
                    Math.abs(gx1 - gx0),
                    Math.abs(gy1 - gy0)
                ];
                // Only run selection if rectangle is large enough and not just a click
                if (rect[2] > 5 / this.scale && rect[3] > 5 / this.scale) {
                    this.selected_nodes = {};
                    for (const node of this.graph.nodes) {
                        // Node bounding box
                        const nx0 = node.pos[0];
                        const ny0 = node.pos[1];
                        const nx1 = node.pos[0] + node.size[0];
                        const ny1 = node.pos[1] + node.size[1];
                        // Check if node box intersects selection rect
                        if (
                            nx1 > rect[0] && nx0 < rect[0] + rect[2] &&
                            ny1 > rect[1] && ny0 < rect[1] + rect[3]
                        ) {
                            this.selected_nodes[node.id] = node;
                        }
                    }
                } else {
                    // Treat as a simple click: only select node if click was directly on a node
                    const node = this.getNodeAtPos(gx0, gy0);
                    if (node) {
                        this.selected_nodes = {};
                        this.selected_nodes[node.id] = node;
                    } else {
                        this.selected_nodes = {};
                    }
                }
                this.selection_rect = null;
                this.selection_rect_graph = null;
                this.dirty_canvas = true;
            } else {
                // If no selection rectangle, always clear selection on mouse up if not clicking a node
                if (!this.dragging_node && !this.resizing_node) {
                    this.selected_nodes = {};
                    this.dirty_canvas = true;
                }
            }
            this.dragging_canvas = false;
            this.dragging_node = null;
            this.resizing_node = null;
            this.node_captured = null;
            this.node_dragged = null;
            this.dirty_canvas = true;
            this._multi_drag_offsets = null;
            this._multi_resize_bbox = null;
            this._multi_resize_initial = null;
            this._multi_resize_shift = false;
            this._multi_resize_mouse_start = null;
            this._multi_resize_bbox_width_start = null;
            // --- GROUP BOX DRAG END ---
            if (this.dragging_groupbox) {
                this.dragging_groupbox._dragging = false;
                this.dragging_groupbox._containedNodeOffsets = undefined;
                this.dragging_groupbox = null;
            }
            // --- NODE GROUP MEMBERSHIP ON DRAG END ---
            if (this.dragging_node && this.dragging_node.type !== 'groupbox') {
                // Check if node is inside any group box
                let foundGroup = null;
                for (const groupNode of this.graph.nodes) {
                    if (groupNode.type === 'groupbox' && typeof groupNode.isPointInBox === 'function') {
                        const n = this.dragging_node;
                        // Check if node's center is inside the group box
                        const centerX = n.pos[0] + n.size[0] / 2;
                        const centerY = n.pos[1] + n.size[1] / 2;
                        if (groupNode.isPointInBox(centerX, centerY)) {
                            foundGroup = groupNode;
                            break;
                        }
                    }
                }
                // Remove from all groups first
                for (const groupNode of this.graph.nodes) {
                    if (groupNode.type === 'groupbox' && Array.isArray(groupNode.containedNodeIds)) {
                        const idx = groupNode.containedNodeIds.indexOf(this.dragging_node.id);
                        if (idx !== -1) groupNode.containedNodeIds.splice(idx, 1);
                    }
                }
                // Add to found group
                if (foundGroup) {
                    if (!foundGroup.containedNodeIds.includes(this.dragging_node.id)) {
                        foundGroup.containedNodeIds.push(this.dragging_node.id);
                    }
                }
                this.dirty_canvas = true;
                StateManager.saveState(this.graph, this);
                this.pushUndoState();
                this.dragging_node = null;
                this._multi_drag_offsets = null;
            }
            // --- GRID ALIGN MODE END ---
            if (this.grid_align_mode) {
                // Snap nodes to final grid positions
                if (this.grid_align_anim_nodes && this.grid_align_anim_targets) {
                    for (const node of this.grid_align_anim_nodes) {
                        const target = this.grid_align_anim_targets[node.id];
                        if (target) {
                            node.pos[0] = target[0];
                            node.pos[1] = target[1];
                        }
                        delete node._gridAnimPos;
                        delete node._gridAnimVel;
                    }
                }
                StateManager.saveState(this.graph, this);
                this.pushUndoState();
                this.grid_align_mode = false;
                this.grid_align_dragging = false;
                this.grid_align_anchor = null;
                this.grid_align_box = null;
                this.grid_align_columns = 1;
                this.grid_align_targets = null;
                this.grid_align_animating = false;
                this.grid_align_anim_nodes = null;
                this.grid_align_anim_targets = null;
                this.dirty_canvas = true;
                return;
            }
            this._resizing_selection_box = false;
        }
        
        onMouseWheel(e) {
            // Ignore all modifier keys (shift, ctrl, alt, etc.) for consistent zoom behavior
            const [x, y] = this.convertCanvasToOffset(e.clientX, e.clientY);
            
            // Always use the same zoom logic regardless of modifier keys
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            
            // Zoom towards mouse position
            this.offset[0] = x - (x - this.offset[0]) * delta;
            this.offset[1] = y - (y - this.offset[1]) * delta;
            this.scale *= delta;
            
            this.dirty_canvas = true;
            // Debounced save after zooming (only persistent state, not undo)
            clearTimeout(this._zoomSaveTimeout);
            this._zoomSaveTimeout = setTimeout(() => {
                StateManager.saveState(this.graph, this);
            }, 500);
            e.preventDefault();
        }
        
        onKeyDown(e) {
            // Disable shortcuts if editing a title inline
            if (this._editingTitleInput) return;
            // --- Alignment debug keys ---
            if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Toggle title visibility for selected nodes
                const selectedNodes = Object.values(this.selected_nodes);
                if (selectedNodes.length > 0) {
                    // Count how many are hidden
                    let numHidden = 0, numVisible = 0;
                    for (const node of selectedNodes) {
                        if (node.flags && node.flags.hide_title) numHidden++;
                        else numVisible++;
                    }
                    // If mixed, set all to hidden first
                    if (numHidden > 0 && numVisible > 0) {
                        for (const node of selectedNodes) {
                            if (!node.flags) node.flags = {};
                            node.flags.hide_title = true;
                        }
                    } else {
                        // Otherwise, toggle all
                        const newState = !(numHidden === 0); // if all visible, hide; else show
                        for (const node of selectedNodes) {
                            if (!node.flags) node.flags = {};
                            node.flags.hide_title = !newState;
                        }
                    }
                    this.dirty_canvas = true;
                    StateManager.saveState(this.graph, this);
                    this.pushUndoState();
                }
                e.preventDefault();
                return;
            }
            if (e.key === '1' || e.key === '2') {
                const axis = e.key === '1' ? 'horizontal' : 'vertical';
                this.triggerAutoAlign(axis);
                e.preventDefault();
                return;
            }
            if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey)) {
                // Undo
                this.undo();
                e.preventDefault();
                return;
            } else if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
                // Redo
                this.redo();
                e.preventDefault();
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                // Delete selected nodes
                this.pushUndoState();
                Object.values(this.selected_nodes).forEach(node => {
                    this.graph.remove(node);
                });
                this.selected_nodes = {};
                this.dirty_canvas = true;
                // this.draw(); // Removed direct draw
                e.preventDefault();
            } else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
                // Copy
                this.copySelected();
                e.preventDefault();
            } else if (e.key === 'x' && (e.ctrlKey || e.metaKey)) {
                // Cut
                this.copySelected();
                this.pushUndoState();
                Object.values(this.selected_nodes).forEach(node => {
                    this.graph.remove(node);
                });
                this.selected_nodes = {};
                this.dirty_canvas = true;
                StateManager.saveState(this.graph, this);
                this.pushUndoState();
                e.preventDefault();
            } else if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
                // Paste
                this.paste();
                StateManager.saveState(this.graph, this);
                this.pushUndoState();
                e.preventDefault();
            } else if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
                // Duplicate
                this.duplicateSelected(true); // pass true to indicate keyboard
                e.preventDefault();
                return false;
            } else if (e.key === 'h') {
                // Recenter all nodes to the origin and set zoom to 1.0
                this.pushUndoState();
                this.recenterGraphToOrigin();
                this.scale = 1.0;
                const dpr = window.devicePixelRatio || 1;
                this.offset = [this.canvas.width / dpr / 2, this.canvas.height / dpr / 2];
                this.dirty_canvas = true;
                StateManager.saveState(this.graph, this);
                e.preventDefault();
            } else if (e.key === 'f') {
                // Zoom to fit selection (if any), otherwise fit all
                if (Object.keys(this.selected_nodes).length > 0) {
                    this.zoomToFitSelection();
                } else {
                    this.zoomToFitAll();
                }
                // Save persistent state after zoom to fit (not undo)
                StateManager.saveState(this.graph, this);
                e.preventDefault();
            } else if ((e.key === 'a' && (e.ctrlKey || e.metaKey))) {
                // Select all nodes
                for (const node of this.graph.nodes) {
                    this.selected_nodes[node.id] = node;
                }
                this.dirty_canvas = true;
                e.preventDefault();
            } else if (e.key === '[') {
                // Send selected node one step down in the stack of overlapping nodes
                const selected = Object.values(this.selected_nodes);
                if (selected.length === 1) {
                    const node = selected[0];
                    const nodeIdx = this.graph.nodes.indexOf(node);
                    // Find all overlapping nodes below in draw order
                    const overlaps = this.graph.nodes
                        .map((n, idx) => ({ n, idx }))
                        .filter(obj => obj.n !== node &&
                            node.pos[0] < obj.n.pos[0] + obj.n.size[0] &&
                            node.pos[0] + node.size[0] > obj.n.pos[0] &&
                            node.pos[1] < obj.n.pos[1] + obj.n.size[1] &&
                            node.pos[1] + node.size[1] > obj.n.pos[1] &&
                            obj.idx < nodeIdx
                        );
                    if (overlaps.length > 0) {
                        // Find the closest overlapping node below
                        const nextIdx = Math.max(...overlaps.map(obj => obj.idx));
                        this.graph.nodes.splice(nodeIdx, 1);
                        this.graph.nodes.splice(nextIdx, 0, node);
                        this.dirty_canvas = true;
                        StateManager.saveState(this.graph, this);
                        this.pushUndoState();
                    } else {
                        // Fallback: move down one step
                        if (nodeIdx > 0) {
                            this.graph.nodes.splice(nodeIdx, 1);
                            this.graph.nodes.splice(nodeIdx - 1, 0, node);
                            this.dirty_canvas = true;
                            StateManager.saveState(this.graph, this);
                            this.pushUndoState();
                        }
                    }
                }
                e.preventDefault();
            } else if (e.key === ']') {
                // Bring selected node one step up in the stack of overlapping nodes
                const selected = Object.values(this.selected_nodes);
                if (selected.length === 1) {
                    const node = selected[0];
                    const nodeIdx = this.graph.nodes.indexOf(node);
                    // Find all overlapping nodes above in draw order
                    const overlaps = this.graph.nodes
                        .map((n, idx) => ({ n, idx }))
                        .filter(obj => obj.n !== node &&
                            node.pos[0] < obj.n.pos[0] + obj.n.size[0] &&
                            node.pos[0] + node.size[0] > obj.n.pos[0] &&
                            node.pos[1] < obj.n.pos[1] + obj.n.size[1] &&
                            node.pos[1] + node.size[1] > obj.n.pos[1] &&
                            obj.idx > nodeIdx
                        );
                    if (overlaps.length > 0) {
                        // Find the closest overlapping node above
                        const nextIdx = Math.min(...overlaps.map(obj => obj.idx));
                        this.graph.nodes.splice(nodeIdx, 1);
                        this.graph.nodes.splice(nextIdx, 0, node);
                        this.dirty_canvas = true;
                        StateManager.saveState(this.graph, this);
                        this.pushUndoState();
                    } else {
                        // Fallback: move up one step
                        if (nodeIdx < this.graph.nodes.length - 1) {
                            this.graph.nodes.splice(nodeIdx, 1);
                            this.graph.nodes.splice(nodeIdx + 1, 0, node);
                            this.dirty_canvas = true;
                            StateManager.saveState(this.graph, this);
                            this.pushUndoState();
                        }
                    }
                }
                e.preventDefault();
            }
            // --- Group box shortcut (now using LiteGraph's built-in group) ---
            if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Create a new group at the mouse position or default
                const group = new LiteGraph.LGraphGroup('New Group');
                group.pos = this.graph_mouse ? [...this.graph_mouse] : [100, 100];
                group.size = [400, 300];
                this.graph.add(group);
                this.dirty_canvas = true;
                StateManager.saveState(this.graph, this);
                this.pushUndoState();
                e.preventDefault();
                return;
            }
            // --- GRID ALIGN MODE TRIGGER ---
            if (e.ctrlKey && e.shiftKey && !this.getNodeAtPos(this.graph_mouse[0], this.graph_mouse[1])) {
                this.grid_align_mode = true;
                this.grid_align_anchor = [this.graph_mouse[0], this.graph_mouse[1]];
                this.grid_align_box = [this.graph_mouse[0], this.graph_mouse[1], this.graph_mouse[0], this.graph_mouse[1]];
                this.grid_align_columns = 1;
                this.grid_align_targets = null;
                this.grid_align_animating = false;
                this.grid_align_anim_nodes = null;
                this.grid_align_anim_targets = null;
                e.preventDefault();
                return;
            }
        }
        
        // Track offset for cascading duplicates/copies
        duplicateOffset = 20;
        duplicateCount = 0;
        
        copySelected() {
            const selected = Object.values(this.selected_nodes);
            if (selected.length === 0) return;
            this.clipboard = selected.map(node => ({
                type: node.type,
                pos: [...node.pos],
                size: [...node.size],
                properties: {...node.properties},
                title: node.title
            }));
            this.duplicateCount = 0; // reset for new copy
        }
        
        paste() {
            if (!this.clipboard) return;
            this.selected_nodes = {};
            this.duplicateCount = (this.duplicateCount || 0) + 1;
            // Compute bounding box of clipboard nodes
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            this.clipboard.forEach(nodeData => {
                minX = Math.min(minX, nodeData.pos[0]);
                minY = Math.min(minY, nodeData.pos[1]);
                maxX = Math.max(maxX, nodeData.pos[0] + nodeData.size[0]);
                maxY = Math.max(maxY, nodeData.pos[1] + nodeData.size[1]);
            });
            const bboxCenterX = (minX + maxX) / 2;
            const bboxCenterY = (minY + maxY) / 2;
            // Use current mouse position in graph coordinates
            const targetCenter = this.graph_mouse ? [...this.graph_mouse] : [0, 0];
            const dx = targetCenter[0] - bboxCenterX;
            const dy = targetCenter[1] - bboxCenterY;
            this.clipboard.forEach((nodeData, i) => {
                const node = window.LiteGraph.createNode(nodeData.type);
                if (node) {
                    // Center at mouse
                    node.pos = [nodeData.pos[0] + dx, nodeData.pos[1] + dy];
                    node.size = [...nodeData.size];
                    node.properties = {...nodeData.properties};
                    node.title = nodeData.title;
                    this.graph.add(node);
                    node.graph = this.graph;
                    // If node has a hash, try to load image from cache
                    if (nodeData.type === "media/image" && nodeData.properties.hash) {
                        const dataURL = InMemoryImageCache.get(nodeData.properties.hash);
                        if (dataURL) {
                            node.setImage(dataURL, nodeData.properties.filename);
                            if (window.lcanvas) {
                                window.lcanvas.dirty_canvas = true;
                                window.lcanvas.draw();
                            }
                        } else {
                            // Optionally: trigger async load from persistent cache or show placeholder
                        }
                    }
                    this.selectNode(node);
                }
            });
            this.dirty_canvas = true;
            StateManager.saveState(this.graph, this);
            this.pushUndoState();
        }
        
        duplicateSelected(fromKeyboard = false) {
            // Duplicate all selected nodes and select the duplicates
            const selectedNodes = Object.values(this.selected_nodes);
            const duplicatedNodes = [];
            
            for (const selectedNode of selectedNodes) {
                this.duplicateCount = (this.duplicateCount || 0) + 1;
                const offset = this.duplicateOffset * this.duplicateCount;
                const newNode = window.LiteGraph.createNode(selectedNode.type);
                if (newNode) {
                    newNode.pos = [selectedNode.pos[0] + offset, selectedNode.pos[1] + offset];
                    newNode.size = [...selectedNode.size];
                    newNode.properties = {...selectedNode.properties};
                    newNode.title = selectedNode.title;
                    this.graph.add(newNode);
                    newNode.graph = this.graph;
                    // If node has a hash, try to load image from cache
                    if (selectedNode.type === "media/image" && selectedNode.properties.hash) {
                        const dataURL = InMemoryImageCache.get(selectedNode.properties.hash);
                        if (dataURL) {
                            newNode.setImage(dataURL, selectedNode.properties.filename);
                            if (window.lcanvas) {
                                window.lcanvas.dirty_canvas = true;
                                window.lcanvas.draw();
                            }
                        } else {
                            // Optionally: trigger async load from persistent cache or show placeholder
                        }
                    }
                    duplicatedNodes.push(newNode);
                }
            }
            
            // Select all the duplicated nodes
            this.selected_nodes = {};
            for (const duplicatedNode of duplicatedNodes) {
                this.selected_nodes[duplicatedNode.id] = duplicatedNode;
            }
            
            this.dirty_canvas = true;
            StateManager.saveState(this.graph, this);
            this.pushUndoState();
        }
        
        duplicateNode(node) {
            // For alt-drag, always increment duplicateCount
            this.duplicateCount = (this.duplicateCount || 0) + 1;
            const offset = this.duplicateOffset * this.duplicateCount;
            const newNode = window.LiteGraph.createNode(node.type);
            if (newNode) {
                newNode.pos = [node.pos[0] + offset, node.pos[1] + offset];
                newNode.size = [...node.size];
                newNode.properties = {...node.properties};
                newNode.title = node.title;
                if (node.type === "media/image" && node.properties.src) {
                    newNode.setImage(node.properties.src, node.properties.filename);
                }
                this.graph.add(newNode);
                this.selectNode(newNode);
                // For alt-drag, do not set dragging_node so it doesn't stick to cursor
                this.dirty_canvas = true;
                // this.draw(); // Removed direct draw
                StateManager.saveState(this.graph, this);
                this.pushUndoState();
            }
        }
        
        getNodeAtPos(x, y) {
            // Return node if point is inside the node's full bounding box (including title bar)
            for (let i = this.graph.nodes.length - 1; i >= 0; i--) {
                const node = this.graph.nodes[i];
                if (
                    x >= node.pos[0] && x <= node.pos[0] + node.size[0] &&
                    y >= node.pos[1] && y <= node.pos[1] + node.size[1]
                ) {
                    return node;
                }
            }
            return null;
        }
        
        getNodeResizeHandle(x, y) {
            const dpr = window.devicePixelRatio || 1;
            const handleCssSize = 16;  // CSS pixels (not * dpr for hit detection)

            // Prioritize selected nodes first
            const candidates = [...Object.values(this.selected_nodes), ...this.graph.nodes.filter(n => !this.selected_nodes[n.id])];

            for (const node of candidates) {
                if (node.type === 'groupbox') continue;

                // Node bottom-right in graph space
                const nodeBR = [node.pos[0] + node.size[0], node.pos[1] + node.size[1]];

                // Convert to canvas CSS pixels
                const screenX = nodeBR[0] * this.scale + this.offset[0];
                const screenY = nodeBR[1] * this.scale + this.offset[1];

                // Node size in CSS pixels
                const nodeCssWidth = node.size[0] * this.scale;
                const nodeCssHeight = node.size[1] * this.scale;

                // Disable handle if it's too large relative to node (but less aggressive threshold)
                const handleDisabled = (
                    handleCssSize > nodeCssWidth / 2 ||
                    handleCssSize > nodeCssHeight / 2
                );
                if (handleDisabled) continue;

                // Check if click (CSS pixels) is in handle area
                const inHandleArea = (
                    x >= screenX - handleCssSize &&
                    x <= screenX &&
                    y >= screenY - handleCssSize &&
                    y <= screenY
                );

                if (inHandleArea) {
                    return node;
                }
            }
            return null;
        }
        
        selectNode(node) {
            this.selected_nodes = {};
            this.selected_nodes[node.id] = node;
        }
        
        resize() {
            this.applyDPI();
        }
        
        applyDPI() {
            const dpr = window.devicePixelRatio || 1;
            const rect = this.canvas.getBoundingClientRect();
            
            // Set actual canvas size - ensure integers to prevent white lines
            this.canvas.width = Math.ceil(rect.width * dpr);
            this.canvas.height = Math.ceil(rect.height * dpr);
            
            // Reset the context transform before scaling to prevent accumulation
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            // Scale the context
            this.ctx.scale(dpr, dpr);
            
            // Set CSS size - ensure integers
            this.canvas.style.width = Math.floor(rect.width) + 'px';
            this.canvas.style.height = Math.floor(rect.height) + 'px';
            
            this.dirty_canvas = true;
            // this.draw(); // Removed direct draw
        }
        
        // Helper: check if node is visible on the canvas
        isNodeVisible(node) {
            const dpr = window.devicePixelRatio || 1;
            const canvas = this.canvas;
            
            // Node bounding box in screen space
            const x = node.pos[0] * this.scale + this.offset[0];
            const y = node.pos[1] * this.scale + this.offset[1];
            const w = node.size[0] * this.scale;
            const h = node.size[1] * this.scale;
            
            // Add some margin for better culling
            const margin = 50;
            
            // Visible area in screen space
            return (
                x + w > -margin &&
                y + h > -margin &&
                x < canvas.width / dpr + margin &&
                y < canvas.height / dpr + margin
            );
        }
        
        draw() {
            if (!this.ctx) return;
            const ctx = this.ctx;
            const canvas = this.canvas;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // Draw background
            ctx.fillStyle = '#222';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Draw grid
            this.drawGrid(ctx);
            // Draw selection bounding box and handle for multi-node selection (BEHIND images)
            
            // Compute viewport in graph coordinates
            const dpr = window.devicePixelRatio || 1;
            const viewW = canvas.width / this.scale / dpr;
            const viewH = canvas.height / this.scale / dpr;
            const viewport = {
                x: -this.offset[0] / this.scale,
                y: -this.offset[1] / this.scale,
                width: viewW,
                height: viewH
            };
            const margin = 200; // px margin for preloading
            // Load/unload images based on visibility
            for (const node of this.graph.nodes) {
                if (node.type === 'media/image' && node.properties && node.properties.src) {
                    if (isNodeVisibleWithMargin(node, viewport, margin)) {
                        loadNodeImage(node);
                    } else {
                        unloadNodeImage(node);
                    }
                }
            }
            // Apply transform
            ctx.save();
            ctx.translate(this.offset[0], this.offset[1]);
            ctx.scale(this.scale, this.scale);
            // Draw group boxes first
            for (const node of this.graph.nodes) {
                if (node.type === 'groupbox') {
                    this.drawNode(ctx, node);
                }
            }
            // Draw other nodes
            for (const node of this.graph.nodes) {
                if (node.type !== 'groupbox') {
                    this.drawNode(ctx, node);
                }
            }
            ctx.restore();
            // FPS overlay
            this._frames_this_second = (this._frames_this_second || 0) + 1;
            const now = performance.now();
            if (!this._last_fps_update) this._last_fps_update = now;
            if (now - this._last_fps_update > 1000) {
                this.fps = this._frames_this_second;
                this._frames_this_second = 0;
                this._last_fps_update = now;
            }
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = '#222';
            ctx.fillRect(0, 0, 150, 50);
            ctx.font = '14px monospace';
            ctx.fillStyle = '#fff';
            ctx.fillText(`FPS: ${this.fps}`, 10, 20);
            ctx.fillText(`Nodes: ${this.graph.nodes.length}`, 10, 35);
            ctx.restore();
            // Draw grid align overlay if active
            if (this.grid_align_mode && this.grid_align_dragging && this.grid_align_box) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.strokeStyle = '#4af';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                const [ax, ay, bx, by] = this.grid_align_box;
                // Convert both corners from graph to screen coordinates
                const sx0 = ax * this.scale + this.offset[0];
                const sy0 = ay * this.scale + this.offset[1];
                const sx1 = bx * this.scale + this.offset[0];
                const sy1 = by * this.scale + this.offset[1];
                const x0 = Math.min(sx0, sx1), y0 = Math.min(sy0, sy1);
                const x1 = Math.max(sx0, sx1), y1 = Math.max(sy0, sy1);
                // DPI scaling
                const dpr = window.devicePixelRatio || 1;
                ctx.strokeRect(x0 * dpr, y0 * dpr, (x1 - x0) * dpr, (y1 - y0) * dpr);
                ctx.restore();
            }
            // Animate grid align nodes (spring)
            if (this.grid_align_animating && this.grid_align_anim_nodes && this.grid_align_anim_targets) {
                let allDone = true;
                for (const n of this.grid_align_anim_nodes) {
                    const target = this.grid_align_anim_targets[n.id];
                    if (!target) continue;
                    if (!n._gridAnimPos) n._gridAnimPos = [...n.pos];
                    if (!n._gridAnimVel) n._gridAnimVel = [0, 0];
                    let done = true;
                    for (let i = 0; i < 2; ++i) {
                        let x = n._gridAnimPos[i], v = n._gridAnimVel[i], t = target[i];
                        let k = 120.0, d = 12.0, dt = 1/60;
                        let dx = t - x;
                        let ax = k * dx - d * v;
                        v += ax * dt;
                        x += v * dt;
                        n._gridAnimVel[i] = v;
                        n._gridAnimPos[i] = x;
                        if (Math.abs(t - x) > 0.05 || Math.abs(v) > 0.05) done = false;
                    }
                    if (done) {
                        n._gridAnimPos[0] = target[0];
                        n._gridAnimPos[1] = target[1];
                        n._gridAnimVel = [0, 0];
                        // --- NEW: Snap node.pos to animPos if still dragging ---
                        if (this.grid_align_dragging) {
                            n.pos[0] = n._gridAnimPos[0];
                            n.pos[1] = n._gridAnimPos[1];
                        }
                    } else {
                        allDone = false;
                    }
                }
                if (allDone) {
                    this.grid_align_animating = false;
                    for (const n of this.grid_align_anim_nodes) {
                        delete n._gridAnimPos;
                        delete n._gridAnimVel;
                    }
                }
                this.dirty_canvas = true;
            }
            // Draw selection bounding box and handle for multi-node selection
            if (
                Object.keys(this.selected_nodes).length > 1 &&
                !this.grid_align_mode &&
                !this.auto_align_mode &&
                !this.auto_align_animating
            ) {
                // Compute bounding box
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const selId in this.selected_nodes) {
                    const n = this.selected_nodes[selId];
                    minX = Math.min(minX, n.pos[0]);
                    minY = Math.min(minY, n.pos[1]);
                    maxX = Math.max(maxX, n.pos[0] + n.size[0]);
                    maxY = Math.max(maxY, n.pos[1] + n.size[1]);
                }
                // Convert to screen coordinates
                const dpr = window.devicePixelRatio || 1;
                const sx = minX * this.scale + this.offset[0];
                const sy = minY * this.scale + this.offset[1];
                const sw = (maxX - minX) * this.scale;
                const sh = (maxY - minY) * this.scale;
                // Add screen-space margin (8px)
                const marginPx = 8 * dpr;
                const dsx = sx * dpr - marginPx;
                const dsy = sy * dpr - marginPx;
                const dsw = sw * dpr + marginPx * 2;
                const dsh = sh * dpr + marginPx * 2;
                // Draw transparent blue box
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.globalAlpha = 0.15;
                ctx.fillStyle = '#4af';
                ctx.fillRect(dsx, dsy, dsw, dsh);
                ctx.globalAlpha = 1.0;
                ctx.strokeStyle = '#4af';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(dsx, dsy, dsw, dsh);
                // Draw bracket handle (bottom-right corner)
                const handleSize = 16 * dpr;
                ctx.setLineDash([]);
                ctx.save();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 3;
                ctx.shadowColor = 'rgba(0,0,0,0.3)';
                ctx.shadowBlur = 2;
                ctx.beginPath();
                // Horizontal part
                ctx.moveTo(dsx + dsw - handleSize, dsy + dsh - 2);
                ctx.lineTo(dsx + dsw - 2, dsy + dsh - 2);
                // Vertical part
                ctx.moveTo(dsx + dsw - 2, dsy + dsh - handleSize);
                ctx.lineTo(dsx + dsw - 2, dsy + dsh - 2);
                ctx.stroke();
                ctx.restore();
                ctx.restore();
            }
            // Draw selection marquee (rectangular selection)
            if (this.selection_rect) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.strokeStyle = '#4af';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                ctx.globalAlpha = 0.7;
                const [x, y, w, h] = this.selection_rect;
                ctx.strokeRect(x, y, w, h);
                ctx.globalAlpha = 0.15;
                ctx.fillStyle = '#4af';
                ctx.fillRect(x, y, w, h);
                ctx.restore();
            }
        }
        
        drawGrid(ctx) {
            // Hide grid when zoomed out too far
            if (this.scale < 0.5) {
                return;
            }
            
            const gridSize = 20;
            const offsetX = this.offset[0] % (gridSize * this.scale);
            const offsetY = this.offset[1] % (gridSize * this.scale);
            
            ctx.fillStyle = '#333';
            
            // Draw dots at grid intersections
            for (let x = offsetX; x < this.canvas.width; x += gridSize * this.scale) {
                for (let y = offsetY; y < this.canvas.height; y += gridSize * this.scale) {
                    ctx.fillRect(x - 1, y - 1, 2, 2);
                }
            }
        }
        
        drawNode(ctx, node) {
            // Use animPos if auto-align mode or animating, else node.pos
            let drawX = node.pos[0], drawY = node.pos[1];
            if (node._gridAnimPos) {
                drawX = node._gridAnimPos[0];
                drawY = node._gridAnimPos[1];
            } else if ((this.auto_align_mode || this.auto_align_animating) && 
                node._animPos && 
                this.auto_align_anim_nodes && 
                this.auto_align_anim_nodes.includes(node)) {
                drawX = node._animPos[0];
                drawY = node._animPos[1];
            }
            ctx.save();
            ctx.translate(drawX, drawY);
            const isSelected = this.selected_nodes[node.id];
            const size = node.size;
            const titleHeight = 25;
            const borderRadius = 8;
            // Performance optimization: for very small nodes, draw as simple rectangles
            const nodeWidth = node.size[0] * this.scale;
            const nodeHeight = node.size[1] * this.scale;
            const isVerySmall = nodeWidth < 5 || nodeHeight < 5;
            if (isVerySmall) {
                // Draw small nodes as light grey rectangles
                ctx.fillStyle = 'rgba(100,100,100,0.6)';
                ctx.fillRect(5, 5, size[0] - 10, size[1] - 10);
                // Draw selection border if selected
                if (isSelected) {
                    ctx.lineWidth = 2 / this.scale;
                    ctx.strokeStyle = '#4af';
                    ctx.beginPath();
                    ctx.rect(5, 5, size[0] - 10, size[1] - 10);
                    ctx.stroke();
                }
                ctx.restore();
                return;
            }
            // Only draw node background if image is missing or failed to load
            if (!node.img && (!node.properties || !node.properties.src)) {
                ctx.fillStyle = 'rgba(30,30,30,0.95)';
                ctx.fillRect(5, 5, size[0] - 10, size[1] - 10);
            }
            // Draw image/content (fill node except for small border)
            if (node.type === 'media/image' && node.properties && node.properties.src) {
                // Use thumbnail or grey box if node is small (based on on-screen size)
                const dpr = window.devicePixelRatio || 1;
                const screenW = node.size[0] * this.scale * dpr;
                const screenH = node.size[1] * this.scale * dpr;
                const drawW = node.size[0];
                const drawH = node.size[1];
                if (screenW < 32 || screenH < 32) {
                    // Draw grey box
                    ctx.fillStyle = '#888';
                    ctx.fillRect(5, 5, drawW - 10, drawH - 10);
                } else if (screenW < 64 || screenH < 64) {
                    // Use thumbnail, force nearest neighbor
                    ctx.imageSmoothingEnabled = false;
                    if (node.thumbnail instanceof HTMLCanvasElement) {
                        ctx.drawImage(node.thumbnail, 5, 5, drawW - 10, drawH - 10);
                    } else if (node.img instanceof HTMLImageElement && node.img.complete && node.img.naturalWidth > 0) {
                        ctx.drawImage(node.img, 5, 5, drawW - 10, drawH - 10);
                    } else {
                        ctx.fillStyle = '#888';
                        ctx.fillRect(5, 5, drawW - 10, drawH - 10);
                    }
                    // Debug: overlay red when in thumbnail mode
                    // ctx.save();
                    // ctx.globalAlpha = 0.3;
                    // ctx.fillStyle = 'red';
                    // ctx.fillRect(5, 5, drawW - 10, drawH - 10);
                    // ctx.restore();
                    ctx.imageSmoothingEnabled = true; // reset for other nodes
                } else if (node.img instanceof HTMLImageElement && node.img.complete && node.img.naturalWidth > 0) {
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(node.img, 5, 5, drawW - 10, drawH - 10);
                }
            } else if (node.onDrawForeground) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(5, 5, node.size[0] - 10, node.size[1] - 10);
                ctx.clip();
                ctx.translate(0, 0); // already in node space
                node.onDrawForeground(ctx);
                ctx.restore();
            }
            // Draw title text floating above (outside) the node, truncating with ellipsis if too wide
            if (node.type !== 'media/image') {
                if (!(node.flags && node.flags.hide_title)) {
                    ctx.save();
                    const fontSize = 14 / this.scale;
                    ctx.font = `${fontSize}px Arial`;
                    ctx.fillStyle = '#fff';
                    ctx.textBaseline = 'top';
                    ctx.shadowColor = 'rgba(0,0,0,0.6)';
                    ctx.shadowBlur = 2 / this.scale;
                    let title = node.title || 'Node';
                    // Calculate available width as the image width (not scaled)
                    const availableWidth = size[0] - 10;
                    let measured = ctx.measureText(title).width;
                    if (measured > availableWidth) {
                        // Truncate and add ellipsis
                        const ellipsis = '...';
                        let maxLen = title.length;
                        while (maxLen > 0 && ctx.measureText(title.substring(0, maxLen) + ellipsis).width > availableWidth) {
                            maxLen--;
                        }
                        title = title.substring(0, maxLen) + ellipsis;
                    }
                    ctx.fillText(title, 10, -fontSize - 4);
                    ctx.restore();
                }
            } else {
                // For image nodes, only show floating title if not in thumbnail or grey box mode and not hidden
                if (!(node.flags && node.flags.hide_title)) {
                    const dpr = window.devicePixelRatio || 1;
                    const screenW = node.size[0] * this.scale * dpr;
                    const screenH = node.size[1] * this.scale * dpr;
                    if (screenW >= 64 && screenH >= 64) {
                        ctx.save();
                        const fontSize = 14 / this.scale;
                        ctx.font = `${fontSize}px Arial`;
                        ctx.fillStyle = '#fff';
                        ctx.textBaseline = 'top';
                        ctx.shadowColor = 'rgba(0,0,0,0.6)';
                        ctx.shadowBlur = 2 / this.scale;
                        let title = node.title || 'Node';
                        const availableWidth = size[0] - 10;
                        let measured = ctx.measureText(title).width;
                        if (measured > availableWidth) {
                            const ellipsis = '...';
                            let maxLen = title.length;
                            while (maxLen > 0 && ctx.measureText(title.substring(0, maxLen) + ellipsis).width > availableWidth) {
                                maxLen--;
                            }
                            title = title.substring(0, maxLen) + ellipsis;
                        }
                        ctx.fillText(title, 10, -fontSize - 4);
                        ctx.restore();
                    }
                }
            }
            // Draw selection border as a blue rectangle exactly matching the image/content area (in node space)
            if (isSelected) {
                ctx.save();
                ctx.lineWidth = 2 / this.scale;
                ctx.strokeStyle = '#4af';
                ctx.beginPath();
                ctx.rect(5, 5, size[0] - 10, size[1] - 10);
                ctx.stroke();
                ctx.restore();
            }
            // Draw resize handle as a corner bracket only if selected, just inside the node (in node space)
            if (isSelected) {
                const handleSize = 16 / this.scale;
                // Node size in screen space
                const nodeScreenWidth = size[0] * this.scale;
                const nodeScreenHeight = size[1] * this.scale;
                // Only show handle if it would be enabled, or if this node is being resized
                const handleWouldBeEnabled = handleSize <= nodeScreenWidth / 2 && handleSize <= nodeScreenHeight / 2;
                const isBeingResized = this.resizing_node && this.resizing_node.id === node.id;
                if (handleWouldBeEnabled || isBeingResized) {
                    ctx.save();
                    ctx.lineWidth = 3 / this.scale;
                    ctx.strokeStyle = '#fff';
                    ctx.shadowColor = 'rgba(0,0,0,0.3)';
                    ctx.shadowBlur = 2 / this.scale;
                    ctx.beginPath();
                    // Horizontal part
                    ctx.moveTo(size[0] - 5 - handleSize, size[1] - 5 - 2);
                    ctx.lineTo(size[0] - 5 - 2, size[1] - 5 - 2);
                    // Vertical part
                    ctx.moveTo(size[0] - 5 - 2, size[1] - 5 - handleSize);
                    ctx.lineTo(size[0] - 5 - 2, size[1] - 5 - 2);
                    ctx.stroke();
                    ctx.restore();
                }
            }
            ctx.restore();
        }

        onDoubleClick(e) {
            const [x, y] = this.convertCanvasToOffset(e.clientX, e.clientY);
            const graphPos = this.convertOffsetToCanvas(x, y);
            // Check if double-click is on the title of any node
            for (const node of this.graph.nodes) {
                // Skip title editing if title is hidden
                if (node.flags && node.flags.hide_title) {
                    continue;
                }
                const fontSize = 14 / this.scale;
                const titleX = node.pos[0] + 10;
                const titleY = node.pos[1] - fontSize - 4;
                const titleW = node.size[0] - 10;
                const titleH = fontSize + 8;
                if (
                    graphPos[0] >= titleX && graphPos[0] <= titleX + titleW &&
                    graphPos[1] >= titleY && graphPos[1] <= titleY + titleH
                ) {
                    // Inline editing: create input over the title area
                    if (this._editingTitleInput) return; // Only one at a time
                    const canvasRect = this.canvas.getBoundingClientRect();
                    // Convert node title position to screen coordinates
                    const screenX = (titleX * this.scale + this.offset[0]) + canvasRect.left;
                    const screenY = (titleY * this.scale + this.offset[1]) + canvasRect.top;
                    const screenW = (titleW) * this.scale;
                    const screenH = (titleH) * this.scale;
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = node.title || '';
                    input.style.position = 'absolute';
                    input.style.left = `${screenX}px`;
                    input.style.top = `${screenY}px`;
                    input.style.width = `${screenW}px`;
                    input.style.height = `${screenH}px`;
                    input.style.font = `${fontSize * this.scale}px Arial`;
                    input.style.padding = '0px 2px';
                    input.style.border = '1px solid #4af';
                    input.style.background = '#222';
                    input.style.color = '#fff';
                    input.style.zIndex = 1000;
                    input.style.boxSizing = 'border-box';
                    document.body.appendChild(input);
                    input.focus();
                    input.select();
                    this._editingTitleInput = input;
                    this._editingTitleNode = node;
                    const finishEdit = () => {
                        if (input.parentNode) input.parentNode.removeChild(input);
                        if (input.value !== node.title) {
                            node.title = input.value;
                            this.dirty_canvas = true;
                            StateManager.saveState(this.graph, this);
                            this.pushUndoState();
                        }
                        this._editingTitleInput = null;
                        this._editingTitleNode = null;
                    };
                    input.addEventListener('blur', finishEdit);
                    input.addEventListener('keydown', (evt) => {
                        if (evt.key === 'Enter') {
                            input.blur();
                        } else if (evt.key === 'Escape') {
                            input.value = node.title;
                            input.blur();
                        }
                    });
                    return;
                }
            }
            // Check if double-clicked on resize handle for single node
            const resizeNode = this.getNodeResizeHandle(x, y);
            if (resizeNode && Object.keys(this.selected_nodes).length <= 1) {
                // Reset aspect ratio to original image dimensions
                if (resizeNode.properties && resizeNode.properties.src && resizeNode.img) {
                    // Use the actual loaded image dimensions
                    const originalAspect = resizeNode.img.naturalWidth / resizeNode.img.naturalHeight;
                    resizeNode.aspectRatio = originalAspect;
                    resizeNode.size[1] = resizeNode.size[0] / originalAspect;
                } else {
                    // Fallback to stored original aspect
                    const originalAspect = resizeNode.originalAspect || resizeNode.aspectRatio || 1;
                    resizeNode.aspectRatio = originalAspect;
                    resizeNode.size[1] = resizeNode.size[0] / originalAspect;
                }
                this.dirty_canvas = true;
                StateManager.saveState(this.graph, this);
                this.pushUndoState();
                e.preventDefault();
                return;
            }
            if (resizeNode && Object.keys(this.selected_nodes).length > 1) {
                // Reset aspect ratio for all selected images, keeping current width
                for (const selId in this.selected_nodes) {
                    const n = this.selected_nodes[selId];
                    if (n.originalAspect) {
                        n.aspectRatio = n.originalAspect;
                        n.size[1] = n.size[0] / n.originalAspect;
                        if (typeof n.onResize === 'function') {
                            n.onResize();
                        }
                    }
                }
                this.dirty_canvas = true;
                e.preventDefault();
                return;
            }
        }

        // Helper: zoom and pan to fit given nodes
        zoomToFitNodes(nodes) {
            if (!nodes || nodes.length === 0) return;
            // Compute bounding box
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const node of nodes) {
                minX = Math.min(minX, node.pos[0]);
                minY = Math.min(minY, node.pos[1]);
                maxX = Math.max(maxX, node.pos[0] + node.size[0]);
                maxY = Math.max(maxY, node.pos[1] + node.size[1]);
            }
            const bboxW = maxX - minX;
            const bboxH = maxY - minY;
            const margin = 40; // px margin
            const canvas = this.canvas;
            const dpr = window.devicePixelRatio || 1;
            const viewW = canvas.width / dpr - margin * 2;
            const viewH = canvas.height / dpr - margin * 2;
            if (bboxW === 0 || bboxH === 0) return;
            // Fit scale
            const scaleX = viewW / bboxW;
            const scaleY = viewH / bboxH;
            this.scale = Math.min(scaleX, scaleY);
            // Center offset
            const centerX = minX + bboxW / 2;
            const centerY = minY + bboxH / 2;
            this.offset[0] = canvas.width / dpr / 2 - centerX * this.scale;
            this.offset[1] = canvas.height / dpr / 2 - centerY * this.scale;
            this.dirty_canvas = true;
        }
        // Helper: zoom to fit all nodes
        zoomToFitAll() {
            this.zoomToFitNodes(this.graph.nodes);
        }
        // Helper: zoom to fit selected nodes
        zoomToFitSelection() {
            this.zoomToFitNodes(Object.values(this.selected_nodes));
        }

        // Helper: recenter all nodes so their bounding box is centered at the origin
        recenterGraphToOrigin() {
            if (!this.graph.nodes || this.graph.nodes.length === 0) return;
            // Compute bounding box
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const node of this.graph.nodes) {
                minX = Math.min(minX, node.pos[0]);
                minY = Math.min(minY, node.pos[1]);
                maxX = Math.max(maxX, node.pos[0] + node.size[0]);
                maxY = Math.max(maxY, node.pos[1] + node.size[1]);
            }
            const bboxW = maxX - minX;
            const bboxH = maxY - minY;
            const centerX = minX + bboxW / 2;
            const centerY = minY + bboxH / 2;
            // Offset all nodes so center is at (0,0) (use high precision)
            for (const node of this.graph.nodes) {
                node.pos[0] = +(node.pos[0] - centerX).toFixed(6);
                node.pos[1] = +(node.pos[1] - centerY).toFixed(6);
            }
        }

        // --- Undo/Redo ---
        pushUndoState() {
            try {
                const state = JSON.stringify({
                    graph: this.graph.nodes.map(n => ({
                        type: n.type,
                        pos: [...n.pos],
                        size: [...n.size],
                        aspectRatio: n.aspectRatio || (n.size[0] / n.size[1]), // Save aspect ratio for persistence
                        // Only store hash and filename for images
                        properties: n.type === 'media/image'
                            ? { hash: n.properties.hash, filename: n.properties.filename }
                            : { ...n.properties },
                        flags: n.flags ? { ...n.flags } : undefined,
                        title: n.title
                    }))
                    // Do NOT include offset or scale in undo state
                });
                this.undoStack.push(state);
                if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
                this.redoStack = []; // Clear redo stack when new operation is performed
                // Save undo stack to localStorage with error handling
                StateManager.saveUndoStack(this.undoStack);
            } catch (e) {
                console.warn('Failed to save undo state, clearing old states:', e);
                // Clear undo stack if it's causing issues
                this.undoStack = [];
                this.redoStack = [];
                StateManager.saveUndoStack(this.undoStack);
            }
        }
        undo() {
            if (this.undoStack.length < 2) return;
            const current = this.undoStack.pop();
            this.redoStack.push(current);
            const prev = this.undoStack[this.undoStack.length - 1];
            this.loadUndoState(prev);
            
            // Save updated undo stack
            StateManager.saveUndoStack(this.undoStack);
        }
        redo() {
            if (this.redoStack.length === 0) return;
            const state = this.redoStack.pop();
            this.undoStack.push(state);
            this.loadUndoState(state);
            
            // Save updated undo stack
            StateManager.saveUndoStack(this.undoStack);
        }
        loadUndoState(state) {
            try {
                const data = JSON.parse(state);
                // Clear any active auto-align state to prevent conflicts
                this.auto_align_mode = false;
                this.auto_align_animating = false;
                this.auto_align_originals = null;
                this.auto_align_master_order = null;
                this.auto_align_dominant_axis = null;
                this.auto_align_is_reorder_mode = false;
                this.auto_align_committed = false;
                this.auto_align_committed_axis = null;
                this.auto_align_committed_targets = null;
                this.auto_align_committed_direction = null;
                // Restore nodes
                this.graph.nodes = [];
                for (const n of data.graph) {
                    const node = window.LiteGraph.createNode(n.type);
                    if (node) {
                        node.pos = [...n.pos];
                        node.size = [...n.size];
                        node.aspectRatio = n.aspectRatio || (n.size[0] / n.size[1]); // Restore aspect ratio
                        node.properties = { ...n.properties };
                        node.flags = n.flags ? { ...n.flags } : {};
                        node.title = n.title;
                        this.graph.add(node);
                        node.graph = this.graph;
                        // Always trigger async image load from cache for image nodes with a hash
                        if (n.type === 'media/image' && n.properties.hash) {
                            const dataURL = InMemoryImageCache.get(n.properties.hash);
                            if (dataURL) {
                                node.setImage(dataURL, n.properties.filename);
                                node.properties.src = dataURL;
                                InMemoryImageCache.set(n.properties.hash, dataURL);
                                if (window.lcanvas) {
                                    window.lcanvas.dirty_canvas = true;
                                    window.lcanvas.draw();
                                }
                            } else if (window.ImageCache && typeof window.ImageCache.get === 'function') {
                                window.ImageCache.get(n.properties.hash).then(dataURL => {
                                    if (dataURL) {
                                        node.setImage(dataURL, n.properties.filename);
                                        node.properties.src = dataURL;
                                        InMemoryImageCache.set(n.properties.hash, dataURL);
                                        if (window.lcanvas) {
                                            window.lcanvas.dirty_canvas = true;
                                            window.lcanvas.draw();
                                        }
                                    }
                                });
                            }
                        }
                    }
                }
                // Do NOT restore offset/scale from undo state
                this.selected_nodes = {};
                this.dirty_canvas = true;
            } catch (e) {
                console.error('Failed to load undo state', e);
            }
        }

        // Add a helper to detect if images are already aligned on an axis
        areImagesAlignedOnAxis(axis) {
            const nodes = Object.values(this.selected_nodes);
            if (nodes.length < 2) return false;
            
            const tolerance = 10; // pixels tolerance for alignment
            
            if (axis === 'horizontal') {
                // Check if all images have the same Y position (within tolerance)
                const firstY = nodes[0].pos[1];
                return nodes.every(n => Math.abs(n.pos[1] - firstY) < tolerance);
            } else if (axis === 'vertical') {
                // Check if all images have the same X position (within tolerance)
                const firstX = nodes[0].pos[0];
                return nodes.every(n => Math.abs(n.pos[0] - firstX) < tolerance);
            }
            return false;
        }
        
        // Add a helper to compute arrangement targets for a given axis
        computeAutoAlignTargets(axis) {
            // Use persistent originals if available
            const nodes = Object.values(this.selected_nodes);
            const originals = this.auto_align_originals || {};
            
            // Sort by original positions to maintain consistent order when switching axes
            // This ensures the same relative order is preserved regardless of current animated positions
            nodes.sort((a, b) => {
                const aOrig = originals[a.id] || a.pos;
                const bOrig = originals[b.id] || b.pos;
                
                // For horizontal alignment: sort by original X position
                if (axis === 'horizontal') {
                    return aOrig[0] - bOrig[0];
                }
                // For vertical alignment: sort by original Y position
                else {
                    return aOrig[1] - bOrig[1];
                }
            });
            
            let center = 0;
            for (const n of nodes) {
                const orig = originals[n.id] || n.pos;
                center += axis === 'horizontal' ? orig[1] : orig[0];
            }
            center /= nodes.length;
            const totalSize = nodes.reduce((sum, n) => sum + (axis === 'horizontal' ? n.size[0] : n.size[1]), 0);
            const gap = DEFAULT_ALIGN_MARGIN;
            let totalLength = totalSize + gap * (nodes.length - 1);
            let start = (axis === 'horizontal') ? (this.auto_align_start[0] - totalLength / 2) : (this.auto_align_start[1] - totalLength / 2);
            let pos = start;
            const targets = {};
            for (const n of nodes) {
                if (axis === 'horizontal') {
                    targets[n.id] = [pos, center];
                    pos += n.size[0] + gap;
                } else {
                    targets[n.id] = [center, pos];
                    pos += n.size[1] + gap;
                }
            }
            return targets;
        }
            
        // Add a helper to trigger auto-align with the given axis
        triggerAutoAlign(axis) {
            if (Object.keys(this.selected_nodes).length > 1) {
                // Only set auto_align_originals if not already set (for cancel functionality)
                if (!this.auto_align_originals) {
                    this.auto_align_originals = {};
                    for (const id in this.selected_nodes) {
                        const n = this.selected_nodes[id];
                        this.auto_align_originals[id] = [...n.pos];
                    }
                }
                
                // Determine the dominant axis of the current arrangement and use that as master order
                if (!this.auto_align_master_order) {
                    const nodes = Object.values(this.selected_nodes);
                    const originals = this.auto_align_originals;
                    
                    // Calculate the bounding box of the selection
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    for (const n of nodes) {
                        const orig = originals[n.id] || n.pos;
                        minX = Math.min(minX, orig[0]);
                        minY = Math.min(minY, orig[1]);
                        maxX = Math.max(maxX, orig[0] + n.size[0]);
                        maxY = Math.max(maxY, orig[1] + n.size[1]);
                    }
                    
                    const width = maxX - minX;
                    const height = maxY - minY;
                    
                    // Determine dominant axis based on aspect ratio of selection bounding box
                    const isVerticalDominant = height > width;
                    
                    // Sort by the dominant axis to create master order
                    const masterOrder = [...nodes].sort((a, b) => {
                        const aOrig = originals[a.id] || a.pos;
                        const bOrig = originals[b.id] || b.pos;
                        
                        if (isVerticalDominant) {
                            // Vertical dominant: sort by Y position
                            return aOrig[1] - bOrig[1];
                        } else {
                            // Horizontal dominant: sort by X position
                            return aOrig[0] - bOrig[0];
                        }
                    });
                    
                    this.auto_align_master_order = masterOrder.map(n => n.id);
                    this.auto_align_dominant_axis = isVerticalDominant ? 'vertical' : 'horizontal';
                    
                }
                
                // Use center of selection for auto_align_start
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const id in this.selected_nodes) {
                    const n = this.selected_nodes[id];
                    minX = Math.min(minX, n.pos[0]);
                    minY = Math.min(minY, n.pos[1]);
                    maxX = Math.max(maxX, n.pos[0] + n.size[0]);
                    maxY = Math.max(maxY, n.pos[1] + n.size[1]);
                }
                const centerX = (minX + maxX) / 2;
                const centerY = (minY + maxY) / 2;
                this.auto_align_start = [centerX, centerY];
                // For smooth interrupt: only reset _animPos if not animating
                for (const id in this.selected_nodes) {
                    const n = this.selected_nodes[id];
                    if (!this.auto_align_animating || !n._animPos) {
                        n._animPos = [...n.pos];
                    }
                    n._animVel = [0, 0];
                }
                // Handle different axis types
                let targets;
                if (axis === 'original') {
                    // Original alignment: use stored original positions
                    targets = this.auto_align_originals;
                } else {
                    // Regular alignment: compute new targets using master order
                    targets = this.computeAutoAlignTargetsWithMasterOrder(axis);
                }
                this.auto_align_animating = true;
                this.auto_align_anim_nodes = Object.values(this.selected_nodes);
                this.auto_align_anim_targets = targets;
            }
        }
        
        // Add a helper to compute targets using master order
        computeAutoAlignTargetsWithMasterOrder(axis) {
            const nodes = Object.values(this.selected_nodes);
            const originals = this.auto_align_originals || {};
            const masterOrder = this.auto_align_master_order || [];
            
            // Sort nodes according to the master order (regardless of alignment axis)
            let sortedNodes = masterOrder.map(id => nodes.find(n => n.id === id)).filter(Boolean);
            
            // If in reorder mode, reverse the order
            if (this.auto_align_is_reorder_mode) {
                sortedNodes = sortedNodes.reverse();
            }
            
            let center = 0;
            for (const n of sortedNodes) {
                const orig = originals[n.id] || n.pos;
                center += axis === 'horizontal' ? orig[1] : orig[0];
            }
            center /= sortedNodes.length;
            const totalSize = sortedNodes.reduce((sum, n) => sum + (axis === 'horizontal' ? n.size[0] : n.size[1]), 0);
            const gap = DEFAULT_ALIGN_MARGIN;
            let totalLength = totalSize + gap * (sortedNodes.length - 1);
            let start = (axis === 'horizontal') ? (this.auto_align_start[0] - totalLength / 2) : (this.auto_align_start[1] - totalLength / 2);
            let pos = start;
            const targets = {};
            for (const n of sortedNodes) {
                if (axis === 'horizontal') {
                    targets[n.id] = [pos, center];
                    pos += n.size[0] + gap;
                } else {
                    targets[n.id] = [center, pos];
                    pos += n.size[1] + gap;
                }
            }
            return targets;
        }
        // Add a helper to detect if mouse is over the selection bounding box handle
        isSelectionBoxHandle(x, y) {
            if (Object.keys(this.selected_nodes).length <= 1) return false;
            // Compute bounding box in graph space
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const selId in this.selected_nodes) {
                const n = this.selected_nodes[selId];
                minX = Math.min(minX, n.pos[0]);
                minY = Math.min(minY, n.pos[1]);
                maxX = Math.max(maxX, n.pos[0] + n.size[0]);
                maxY = Math.max(maxY, n.pos[1] + n.size[1]);
            }
            // Convert to screen coordinates
            const dpr = window.devicePixelRatio || 1;
            const sx = minX * this.scale + this.offset[0];
            const sy = minY * this.scale + this.offset[1];
            const sw = (maxX - minX) * this.scale;
            const sh = (maxY - minY) * this.scale;
            // Add screen-space margin (8px)
            const marginPx = 8 * dpr;
            const dsx = sx * dpr - marginPx;
            const dsy = sy * dpr - marginPx;
            const dsw = sw * dpr + marginPx * 2;
            const dsh = sh * dpr + marginPx * 2;
            // Make the handle hit area a bit larger for usability
            const handleSize = 20 * dpr;
            return (
                x >= dsx + dsw - handleSize &&
                x <= dsx + dsw &&
                y >= dsy + dsh - handleSize &&
                y <= dsy + dsh
            );
        }
    }
    
    // Create custom LiteGraph object
    window.LiteGraph = {
        createNode: function(type) {
            if (type === "media/image") {
                return new ImageNode();
            }
            return null;
        },
        
        registerNodeType: function(type, nodeClass) {
            console.log('Registered node type:', type);
        }
    };
    
    // Make classes available globally for custom implementation
    window.LGraph = LGraph;
    window.LGraphCanvas = LGraphCanvas;
}

// Initialize the application
async function initApp() {
    const graph = isUsingOfficialLiteGraph ? new LiteGraph.LGraph() : new LGraph();
    const canvasElement = document.getElementById('mycanvas');
    lcanvas = isUsingOfficialLiteGraph ? 
        new LiteGraph.LGraphCanvas(canvasElement, graph) : 
        new LGraphCanvas(canvasElement, graph);
    
    // Store reference for nodes to access
    graph.canvas = lcanvas;
    
    // Apply DPI scaling
    lcanvas.applyDPI();
    graph.start();
    
    // Ensure ImageCache is initialized before loading state
    if (typeof window.ImageCache === 'undefined') {
        window.ImageCache = ImageCache;
    }
    if (window.ImageCache && typeof window.ImageCache.open === 'function') {
        await window.ImageCache.open();
    }
    // Load undo stack before loading state
    await lcanvas.initializeUndoStack();
    await StateManager.loadState(graph, lcanvas, window.LiteGraph);
    lcanvas.dirty_canvas = true;
    // No direct draw, handled by animation loop
    
    // Handle window resize and zoom changes
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            lcanvas.resize();
        }, 100);
    });
    
    // Handle browser zoom changes
    let lastDPR = window.devicePixelRatio || 1;
    setInterval(() => {
        const currentDPR = window.devicePixelRatio || 1;
        if (Math.abs(currentDPR - lastDPR) > 0.1) {
            lastDPR = currentDPR;
            lcanvas.applyDPI();
        }
    }, 1000);
    
    // Enable drag-and-drop for images
    setupDragAndDrop(canvasElement, graph, lcanvas);
    
    // Register the image node type
    window.LiteGraph.registerNodeType("media/image", ImageNode);
    
    // Save state periodically
    setInterval(() => StateManager.saveState(graph, lcanvas), 10000);
    
    // Periodic cleanup to prevent quota issues
    setInterval(() => {
        StateManager.cleanupOldStates();
    }, 30000); // Every 30 seconds
    
    // Save state when page is about to unload
    window.addEventListener('beforeunload', () => StateManager.saveState(graph, lcanvas));
    
    console.log('LiteGraph application initialized');
    console.log('Controls:');
    console.log('- Drag & drop images to add them');
    console.log('- Drag nodes to move them');
    console.log('- Alt+drag to duplicate a node');
    console.log('- Ctrl/Cmd+C to copy, Ctrl/Cmd+V to paste');
    console.log('- Ctrl/Cmd+D to duplicate selected');
    console.log('- Delete/Backspace to remove selected');
    console.log('- Drag resize handle (bottom-right) to resize');
    console.log('- Mouse wheel to zoom, drag empty space to pan');
}

// --- IndexedDB ImageCache Utility ---
const ImageCache = {
    db: null,
    dbName: 'ImageCanvasCache',
    storeName: 'images',
    async open() {
        if (this.db) return this.db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName, 1);
            req.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
            req.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };
            req.onerror = (event) => {
                reject(event.target.error);
            };
        });
    },
    async put(hash, data) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.storeName], 'readwrite');
            const store = tx.objectStore(this.storeName);
            const req = store.put(data, hash);
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e);
        });
    },
    async get(hash) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.storeName], 'readonly');
            const store = tx.objectStore(this.storeName);
            const req = store.get(hash);
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e);
        });
    },
    async has(hash) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.storeName], 'readonly');
            const store = tx.objectStore(this.storeName);
            const req = store.get(hash);
            req.onsuccess = () => resolve(!!req.result);
            req.onerror = (e) => reject(e);
        });
    }
};

// --- Utility: Compute SHA-256 hash of image data (returns hex string) ---
async function hashImageData(dataURL) {
    // Convert base64 to ArrayBuffer
    const base64 = dataURL.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    // Convert buffer to hex string
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Patch setupDragAndDrop to use ImageCache
function setupDragAndDrop(canvasElement, graph, lcanvas) {
    canvasElement.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    canvasElement.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    canvasElement.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const files = e.dataTransfer.files;
        if (files.length === 0) return;
        
        // Get drop position
        const rect = canvasElement.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;
        const graphPos = lcanvas.convertOffsetToCanvas(canvasX, canvasY);
        
        // Prepare to select all new nodes
        const newNodes = [];
        Array.from(files).forEach((file, index) => {
            if (!file.type.startsWith('image/')) return;
            
            const reader = new FileReader();
            reader.onload = async (event) => {
                const dataURL = event.target.result;
                const hash = await hashImageData(dataURL);
                if (!InMemoryImageCache.has(hash)) {
                    InMemoryImageCache.set(hash, dataURL);
                }
                const node = window.LiteGraph.createNode("media/image");
                if (node) {
                    // Cascade nodes with a visible offset
                    node.pos = [
                        graphPos[0] - node.size[0] / 2 + (index * 40), 
                        graphPos[1] - node.size[1] / 2 + (index * 40)
                    ];
                    node.properties.hash = hash;
                    node.properties.filename = file.name;
                    node.setImage(dataURL, file.name);
                    graph.add(node);
                    newNodes.push(node);
                    lcanvas.dirty_canvas = true;
                    StateManager.saveState(graph, lcanvas);
                    lcanvas.pushUndoState();
                }
                // After all files are processed, select all new nodes
                if (newNodes.length === files.length) {
                    lcanvas.selected_nodes = {};
                    for (const n of newNodes) {
                        lcanvas.selected_nodes[n.id] = n;
                    }
                    lcanvas.dirty_canvas = true;
                }
            };
            reader.readAsDataURL(file);
        });
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initApp(); });
} else {
    initApp();
}

// After initApp is called
let lcanvas = null; // will be set in initApp
function animationLoop() {
    if (lcanvas) {
        // --- Animate auto-align nodes ---
        if (lcanvas.auto_align_animating && lcanvas.auto_align_anim_nodes && lcanvas.auto_align_anim_targets) {
            let allDone = true;
            for (const n of lcanvas.auto_align_anim_nodes) {
                const target = lcanvas.auto_align_anim_targets[n.id];
                if (!target) continue;
                if (!n._animPos) n._animPos = [...n.pos];
                if (!n._animVel) n._animVel = [0, 0];
                let done = true;
                for (let i = 0; i < 2; ++i) {
                    let x = n._animPos[i], v = n._animVel[i], t = target[i];
                    let k = 180.0, d = 13.0, dt = 1/40; // tuned spring
                    let dx = t - x;
                    let ax = k * dx - d * v;
                    v += ax * dt;
                    x += v * dt;
                    n._animVel[i] = v;
                    n._animPos[i] = x;
                    if (Math.abs(t - x) > 0.05 || Math.abs(v) > 0.05) done = false;
                }
                if (done) {
                    n._animPos[0] = target[0];
                    n._animPos[1] = target[1];
                    n._animVel = [0, 0];
                } else {
                    allDone = false;
                }
            }
            if (allDone) {
                // When animation is done, set node.pos = node._animPos and clear anim fields
                for (const n of lcanvas.auto_align_anim_nodes) {
                    if (n._animPos) {
                        n.pos[0] = n._animPos[0];
                        n.pos[1] = n._animPos[1];
                        delete n._animPos;
                        delete n._animVel;
                    }
                }
                // Only clear originals and stop animating if auto-align mode is not active (final completion)
                if (!lcanvas.auto_align_mode) {
                    // Push undo state only when animation is completely finished
                    StateManager.saveState(lcanvas.graph, lcanvas);
                    lcanvas.pushUndoState();
                    
                    if (lcanvas.auto_align_originals) {
                        lcanvas.auto_align_originals = null;
                    }
                    if (lcanvas.auto_align_master_order) {
                        lcanvas.auto_align_master_order = null;
                    }
                    lcanvas.auto_align_dominant_axis = null; // Clear dominant axis
                    lcanvas.auto_align_is_reorder_mode = false; // Clear reorder mode
                    lcanvas.auto_align_animating = false;
                } else {
                    // If auto-align mode is still active, just stop the current animation
                    // but keep the system ready for new animations
                    lcanvas.auto_align_animating = false;
                }
            }
            lcanvas.dirty_canvas = true;
        }
        lcanvas.draw(); // Always call draw every frame
    }
    requestAnimationFrame(animationLoop);
}
animationLoop();

// GroupBoxNode: visually like an image node, with a draggable top bar
class GroupBoxNode {
    constructor(x, y, w, h, containedNodeIds = []) {
        this.type = 'groupbox';
        this.pos = [x, y];
        this.size = [w, h];
        this.title = 'Group';
        this.containedNodeIds = containedNodeIds; // array of node ids
        this.id = null; // will be set by graph
        this.flags = { groupbox: true };
        this._dragging = false;
        this._dragOffset = [0, 0];
        // In node constructor, store original aspect and width
        this.originalAspect = this.aspectRatio || (this.size[0] / this.size[1]);
        this.originalWidth = this.size[0];
    }
    // Draw the group box
    onDrawForeground(ctx) {
        // Draw background
        ctx.save();
        ctx.fillStyle = 'rgba(60,60,80,0.18)';
        ctx.strokeStyle = '#4af';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(0, 0, this.size[0], this.size[1], 12);
        ctx.fill();
        ctx.stroke();
        // Draw top bar
        ctx.fillStyle = '#223a5e';
        ctx.fillRect(0, 0, this.size[0], 28);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px Arial';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.title, 12, 14);
        ctx.restore();
    }
    // Check if a point is inside the top bar
    isPointInBar(x, y) {
        return x >= this.pos[0] && x <= this.pos[0] + this.size[0] &&
               y >= this.pos[1] && y <= this.pos[1] + 28;
    }
    // Check if a point is inside the group box
    isPointInBox(x, y) {
        return x >= this.pos[0] && x <= this.pos[0] + this.size[0] &&
               y >= this.pos[1] && y <= this.pos[1] + this.size[1];
    }
}

// Global image cache
const InMemoryImageCache = new Map();

// Helper: create a thumbnail for an image
function createThumbnail(img, size = 64) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    return canvas;
}

// Helper: load an image for a node, using the global cache
function loadNodeImage(node, onload) {
    if (!node.properties || !node.properties.src) return;
    // If node already has a valid image, do nothing
    if (node.img instanceof HTMLImageElement && node.img.complete && node.img.naturalWidth > 0) return;
    // If cache has a fully loaded image, use it
    const cached =  InMemoryImageCache.get(node.properties.src);
    if (cached instanceof HTMLImageElement && cached.complete && cached.naturalWidth > 0) {
        node.img = cached;
        node.thumbnail = createThumbnail(node.img, 64);
        if (onload) onload();
        return;
    }
    // Otherwise, load and cache the image
    const img = new window.Image();
    img.onload = function() {
        // Only cache fully loaded images
        InMemoryImageCache.set(node.properties.src, img);
        node.img = img;
        node.thumbnail = createThumbnail(img, 64);
        if (onload) onload();
    };
    img.src = node.properties.src;
}

// Helper: unload an image for a node (do NOT remove from cache)
function unloadNodeImage(node) {
    node.img = null;
    node.thumbnail = null;
    // Do NOT remove from ImageCache here; cache is only cleared explicitly or with an LRU policy
}

// Helper: check if a node is visible with margin
function isNodeVisibleWithMargin(node, viewport, margin) {
    return (
        node.pos[0] + node.size[0] > viewport.x - margin &&
        node.pos[0] < viewport.x + viewport.width + margin &&
        node.pos[1] + node.size[1] > viewport.y - margin &&
        node.pos[1] < viewport.y + viewport.height + margin
    );
}

// Add at the very top of the file
const DEFAULT_ALIGN_MARGIN = 20;

