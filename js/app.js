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
            this.maxUndo = 10;
            this.setupEventListeners();
            this.draw();
        }
        
        setupEventListeners() {
            this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
            this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
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
            const [x, y] = this.convertCanvasToOffset(e.clientX, e.clientY);
            const graph_mouse = this.convertOffsetToCanvas(x, y);
            this.canvas_mouse = [x, y];
            this.graph_mouse = graph_mouse;
            this.last_mouse = [x, y];
            // --- AUTO-ALIGN MODE ---
            // If shift+background click and multi-select, do NOT clear selection, and prep for auto-align
            const node = this.getNodeAtPos(this.graph_mouse[0], this.graph_mouse[1]);
            const resizeNode = this.getNodeResizeHandle(this.graph_mouse[0], this.graph_mouse[1]);
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
                    this._multi_resize_shift = e.shiftKey;
                    this._multi_resize_mouse_start = this.graph_mouse[0];
                    this._multi_resize_bbox_width_start = maxX - minX;
                } else {
                    this._multi_resize_bbox = null;
                    this._multi_resize_initial = null;
                    this._multi_resize_shift = false;
                    this._multi_resize_mouse_start = null;
                    this._multi_resize_bbox_width_start = null;
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
                    
                    for (const selectedNode of selectedNodes) {
                        this.duplicateCount = (this.duplicateCount || 0) + 1;
                        const offset = this.duplicateOffset * this.duplicateCount;
                        const newNode = window.LiteGraph.createNode(selectedNode.type);
                        if (newNode) {
                            // Place new node at mouse position (centered)
                            newNode.pos = [
                                this.graph_mouse[0] - selectedNode.size[0] / 2 + offset,
                                this.graph_mouse[1] - selectedNode.size[1] / 2 + offset
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
                    
                    // Start dragging the first cloned node
                    if (clonedNodes.length > 0) {
                        this.dragging_node = clonedNodes[0];
                        this.node_captured = clonedNodes[0];
                    }
                    
                    this.dirty_canvas = true;
                    StateManager.saveState(this.graph, this.canvas);
                    this.pushUndoState();
                    e.preventDefault();
                    return;
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
            const dpr = window.devicePixelRatio || 1;
            const [x, y] = this.convertCanvasToOffset(e.clientX, e.clientY);
            this.canvas_mouse = [x, y];
            this.graph_mouse = this.convertOffsetToCanvas(x, y);
            
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
                        // Push undo state right before the alignment starts
                        StateManager.saveState(this.graph, this);
                        this.pushUndoState();
                        // Use the helper method for consistent behavior
                        this.triggerAutoAlign(commitAxis);
                        this.auto_align_committed_targets = this.auto_align_anim_targets;
                        this.auto_align_commit_point = [this.graph_mouse[0], this.graph_mouse[1]];
                        this.auto_align_waiting_for_switch = false;
                        // Only log on commit
                        console.log('[AutoAlign] Committed!', {commitAxis, commitDir, targets: this.auto_align_committed_targets, commit_point: this.auto_align_commit_point});
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
                    
                    // Only allow cancel if user has left the circle and is now back in it
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
                        // Debug logging
                        console.log('[AutoAlign] Original alignment triggered!', {currentAxis, currentDirection, targets: this.auto_align_committed_targets, commit_point: this.auto_align_commit_point});
                        return; // <-- EARLY RETURN: do not run drag logic
                    }
                    
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
                        
                        this.auto_align_committed_axis = currentAxis;
                        this.auto_align_committed_direction = currentDirection;
                        // Do NOT update auto_align_originals on axis switch
                        // Use the helper method for consistent behavior
                        this.triggerAutoAlign(currentAxis);
                        this.auto_align_committed_targets = this.auto_align_anim_targets;
                        this.auto_align_commit_point = [this.graph_mouse[0], this.graph_mouse[1]];
                        // Only log on axis switch
                        console.log('[AutoAlign] Axis switched!', {currentAxis, currentDirection, targets: this.auto_align_committed_targets, commit_point: this.auto_align_commit_point});
                    }
                }
                // Remove duplicate animation logic - let the main animation loop handle it
                this.dirty_canvas = true;
                return; // <-- EARLY RETURN: do not run drag logic
            }
            
            if (this.resizing_node) {
                // --- Multi-node resize ---
                if (Object.keys(this.selected_nodes).length > 1 && this._multi_resize_bbox && this._multi_resize_initial) {
                    const bbox = this._multi_resize_bbox;
                    const initial = this._multi_resize_initial;
                    const shift = e.shiftKey;
                    const anchorX = bbox[0];
                    const anchorY = bbox[1];
                    const mouseX = this.graph_mouse[0];
                    let newWidth = Math.max(100, mouseX - anchorX);
                    let scaleX = newWidth / bbox[2];
                    let scaleY = scaleX; // uniform scaling for images
                    if (!shift) {
                        // Group scaling: scale all nodes relative to bbox top-left
                        const mouseStart = this._multi_resize_mouse_start;
                        const bboxWidthStart = this._multi_resize_bbox_width_start;
                        let delta = mouseX - mouseStart;
                        let scale = Math.max(0.1, (bboxWidthStart + delta) / bboxWidthStart);
                        for (const selId in this.selected_nodes) {
                            const n = this.selected_nodes[selId];
                            const init = initial[selId];
                            const relX = init.pos[0] - anchorX;
                            const relY = init.pos[1] - anchorY;
                            n.size[0] = Math.max(100, init.size[0] * scale);
                            n.size[1] = n.size[0] / init.aspect;
                            n.pos[0] = anchorX + relX * scale;
                            n.pos[1] = anchorY + relY * scale;
                        }
                    } else {
                        // Shift: scale each node relative to its own initial width and mouse movement
                        const mouseStart = this._multi_resize_mouse_start;
                        for (const selId in this.selected_nodes) {
                            const n = this.selected_nodes[selId];
                            const init = initial[selId];
                            // Calculate scale factor for this node
                            let delta = mouseX - mouseStart;
                            let scale = Math.max(0.1, (init.size[0] + delta) / init.size[0]);
                            n.size[0] = Math.max(100, init.size[0] * scale);
                            n.size[1] = n.size[0] / init.aspect;
                        }
                    }
                    this.dirty_canvas = true;
                } else if (this.resizing_node) {
                    // Single node resize (original logic)
                const node = this.resizing_node;
                const newWidth = Math.max(100, this.graph_mouse[0] - node.pos[0]);
                const newHeight = newWidth / node.aspectRatio;
                node.size = [newWidth, newHeight];
                this.dirty_canvas = true;
                }
                // StateManager.saveState(this.graph, this); // Removed for performance
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
                const resizeNode = this.getNodeResizeHandle(this.graph_mouse[0], this.graph_mouse[1]);
                this.canvas.style.cursor = resizeNode ? 'se-resize' : 'default';
            }
            
            this.last_mouse = [x, y];
            
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
                this.auto_align_last_axis = null;
                this.auto_align_committed = false;
                this.auto_align_committed_axis = null;
                this.auto_align_committed_targets = null;
                this.auto_align_committed_direction = null;
                this.dirty_canvas = true;
                return; // <-- EARLY RETURN: do not run drag logic
            }
            if (this.dragging_node || this.resizing_node || this.dragging_canvas) {
                StateManager.saveState(this.graph, this);
                this.pushUndoState();
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
        }
        
        onMouseWheel(e) {
            const [x, y] = this.convertCanvasToOffset(e.clientX, e.clientY);
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            
            // Zoom towards mouse position
            this.offset[0] = x - (x - this.offset[0]) * delta;
            this.offset[1] = y - (y - this.offset[1]) * delta;
            this.scale *= delta;
            
            this.dirty_canvas = true;
            // Debounced save after zooming
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
            } else if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
                // Paste
                this.paste();
                e.preventDefault();
            } else if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
                // Duplicate
                this.duplicateSelected(true); // pass true to indicate keyboard
                e.preventDefault();
                return false;
            } else if (e.key === 'h') {
                // Recenter all nodes to the origin and set zoom to 1.0
                this.recenterGraphToOrigin();
                this.scale = 1.0;
                const dpr = window.devicePixelRatio || 1;
                this.offset = [this.canvas.width / dpr / 2, this.canvas.height / dpr / 2];
                this.dirty_canvas = true;
                e.preventDefault();
            } else if (e.key === 'f') {
                // Zoom to fit selection (if any), otherwise fit all
                if (Object.keys(this.selected_nodes).length > 0) {
                    this.zoomToFitSelection();
                } else {
                    this.zoomToFitAll();
                }
                e.preventDefault();
            } else if ((e.key === 'a' && (e.ctrlKey || e.metaKey))) {
                // Select all nodes
                for (const node of this.graph.nodes) {
                    this.selected_nodes[node.id] = node;
                }
                this.dirty_canvas = true;
                e.preventDefault();
            } else if (e.key === '[') {
                // Send selected node one step down in draw order
                const selected = Object.values(this.selected_nodes);
                if (selected.length === 1) {
                    const node = selected[0];
                    const idx = this.graph.nodes.indexOf(node);
                    if (idx > 0) {
                        this.graph.nodes.splice(idx, 1);
                        this.graph.nodes.splice(idx - 1, 0, node);
                        this.dirty_canvas = true;
                        StateManager.saveState(this.graph, this);
                        this.pushUndoState();
                    }
                }
                e.preventDefault();
            } else if (e.key === ']') {
                // Bring selected node one step up in draw order
                const selected = Object.values(this.selected_nodes);
                if (selected.length === 1) {
                    const node = selected[0];
                    const idx = this.graph.nodes.indexOf(node);
                    if (idx < this.graph.nodes.length - 1) {
                        this.graph.nodes.splice(idx, 1);
                        this.graph.nodes.splice(idx + 1, 0, node);
                        this.dirty_canvas = true;
                        StateManager.saveState(this.graph, this);
                        this.pushUndoState();
                    }
                }
                e.preventDefault();
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
            this.clipboard.forEach((nodeData, i) => {
                const node = window.LiteGraph.createNode(nodeData.type);
                if (node) {
                    const offset = this.duplicateOffset * this.duplicateCount;
                    node.pos = [nodeData.pos[0] + offset, nodeData.pos[1] + offset];
                    node.size = [...nodeData.size];
                    node.properties = {...nodeData.properties};
                    node.title = nodeData.title;
                    if (nodeData.type === "media/image" && nodeData.properties.src) {
                        node.setImage(nodeData.properties.src, nodeData.properties.filename);
                    }
                    this.graph.add(node);
                    this.selectNode(node);
                }
            });
            this.dirty_canvas = true;
            // this.draw(); // Removed direct draw
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
                    if (selectedNode.type === "media/image" && selectedNode.properties.src) {
                        newNode.setImage(selectedNode.properties.src, selectedNode.properties.filename);
                    }
                    this.graph.add(newNode);
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
            // Make the clickable area always the same size in screen space
            const dpr = window.devicePixelRatio || 1;
            for (let i = this.graph.nodes.length - 1; i >= 0; i--) {
                const node = this.graph.nodes[i];
                // Node bottom-right corner in graph space
                const nodeBR = [node.pos[0] + node.size[0], node.pos[1] + node.size[1]];
                // Convert to screen space
                const screenX = nodeBR[0] * this.scale + this.offset[0];
                const screenY = nodeBR[1] * this.scale + this.offset[1];
                // Clickable area in screen space (16x16 px)
                const handleScreenSize = 16 * dpr;
                if (
                    x * this.scale + this.offset[0] >= screenX - handleScreenSize &&
                    x * this.scale + this.offset[0] <= screenX &&
                    y * this.scale + this.offset[1] >= screenY - handleScreenSize &&
                    y * this.scale + this.offset[1] <= screenY
                ) {
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
            
            // Set actual canvas size
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            
            // Scale the context
            this.ctx.scale(dpr, dpr);
            
            // Set CSS size
            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';
            
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
            // Visible area in screen space
            return (
                x + w > 0 &&
                y + h > 0 &&
                x < canvas.width / dpr &&
                y < canvas.height / dpr
            );
        }
        
        draw() {
            const ctx = this.ctx;
            const canvas = this.canvas;
            if (this.dirty_canvas) {
                // Clear canvas (fix white line by using Math.ceil)
                ctx.clearRect(0, 0, Math.ceil(canvas.width), Math.ceil(canvas.height));
                // Draw background (fix white line by using Math.ceil)
            ctx.fillStyle = '#222';
                ctx.fillRect(0, 0, Math.ceil(canvas.width), Math.ceil(canvas.height));
            // Draw grid
            this.drawGrid(ctx);
            // Apply transform
            ctx.save();
            ctx.translate(this.offset[0], this.offset[1]);
            ctx.scale(this.scale, this.scale);
                // Draw nodes (culling)
            for (const node of this.graph.nodes) {
                    if (this.isNodeVisible(node)) {
                this.drawNode(ctx, node);
            }
                }
                ctx.restore();
                // Draw selection rectangle if active (always 1px width, device pixels)
                if (this.selection_rect) {
                    ctx.save();
                    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform
                    ctx.strokeStyle = '#4af';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 2]);
                    const [x, y, w, h] = this.selection_rect;
                    ctx.strokeRect(x, y, w, h);
                    ctx.restore();
                }
            this.dirty_canvas = false;
            }
            // --- FPS INDICATOR (always draw) ---
            this._frames_this_second++;
            const now = performance.now();
            if (now - this._last_fps_update > 1000) {
                this.fps = this._frames_this_second;
                this._frames_this_second = 0;
                this._last_fps_update = now;
            }
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = '#222';
            ctx.fillRect(0, 0, 220, 70); // fill overlay area with background color
            ctx.font = '14px monospace';
            ctx.fillStyle = '#fff';
            ctx.fillText(`FPS: ${this.fps}`, 10, 20);
            // Debug overlay
            ctx.font = '11px monospace';
            ctx.fillStyle = '#0f0';
            ctx.fillText(`Mouse client: ${this.canvas_mouse ? this.canvas_mouse.map(v=>v.toFixed(1)).join(',') : ''}`, 10, 35);
            ctx.fillText(`Graph: ${this.graph_mouse ? this.graph_mouse.map(v=>v.toFixed(1)).join(',') : ''}`, 10, 50);
            ctx.fillText(`Scale: ${this.scale.toFixed(3)}  Offset: ${this.offset.map(v=>v.toFixed(1)).join(',')}`, 10, 65);
            ctx.restore();
        }
        
        drawGrid(ctx) {
            const gridSize = 20;
            const offsetX = this.offset[0] % (gridSize * this.scale);
            const offsetY = this.offset[1] % (gridSize * this.scale);
            
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1;
            ctx.beginPath();
            
            for (let x = offsetX; x < this.canvas.width; x += gridSize * this.scale) {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, this.canvas.height);
            }
            
            for (let y = offsetY; y < this.canvas.height; y += gridSize * this.scale) {
                ctx.moveTo(0, y);
                ctx.lineTo(this.canvas.width, y);
            }
            
            ctx.stroke();
        }
        
        drawNode(ctx, node) {
            // Use animPos if auto-align mode or animating, else node.pos
            let drawX = node.pos[0], drawY = node.pos[1];
            if ((this.auto_align_mode || this.auto_align_animating) && node._animPos) {
                drawX = node._animPos[0];
                drawY = node._animPos[1];
            }
            ctx.save();
            ctx.translate(drawX, drawY);
            const isSelected = this.selected_nodes[node.id];
            const size = node.size;
            const titleHeight = 25;
            const borderRadius = 8;
            // Only draw node background if image is missing or failed to load
            if (!node.img && (!node.properties || !node.properties.src)) {
                ctx.fillStyle = 'rgba(30,30,30,0.95)';
                ctx.fillRect(5, 5, size[0] - 10, size[1] - 10);
            }
            // Do not draw any border for unselected nodes
            // Draw image/content (fill node except for small border)
            if (node.onDrawForeground) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(5, 5, size[0] - 10, size[1] - 10);
                ctx.clip();
                ctx.translate(0, 0); // already in node space
                node.onDrawForeground(ctx);
                ctx.restore();
            }
            // Draw title text floating above (outside) the node, truncating with ellipsis if too wide
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
            ctx.restore();
        }

        onDoubleClick(e) {
            const [x, y] = this.convertCanvasToOffset(e.clientX, e.clientY);
            const graphPos = this.convertOffsetToCanvas(x, y);
            // Check if double-click is on the title of any node
            for (const node of this.graph.nodes) {
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
            const state = JSON.stringify({
                graph: this.graph.nodes.map(n => ({
                    type: n.type,
                    pos: [...n.pos],
                    size: [...n.size],
                    properties: {...n.properties},
                    title: n.title
                })),
                offset: [...this.offset],
                scale: this.scale
            });
            this.undoStack.push(state);
            if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
            this.redoStack = [];
        }
        undo() {
            if (this.undoStack.length < 2) return;
            const current = this.undoStack.pop();
            this.redoStack.push(current);
            const prev = this.undoStack[this.undoStack.length - 1];
            this.loadUndoState(prev);
        }
        redo() {
            if (this.redoStack.length === 0) return;
            const state = this.redoStack.pop();
            this.undoStack.push(state);
            this.loadUndoState(state);
        }
        loadUndoState(state) {
            try {
                const data = JSON.parse(state);
                // Restore nodes
                this.graph.nodes = [];
                for (const n of data.graph) {
                    const node = window.LiteGraph.createNode(n.type);
                    if (node) {
                        node.pos = [...n.pos];
                        node.size = [...n.size];
                        node.properties = {...n.properties};
                        node.title = n.title;
                        if (n.type === 'media/image' && n.properties.src) {
                            node.setImage(n.properties.src, n.properties.filename);
                        }
                        this.graph.add(node);
                    }
                }
                // Restore offset/scale
                this.offset = [...data.offset];
                this.scale = data.scale;
                this.selected_nodes = {};
                this.dirty_canvas = true;
            } catch (e) {
                console.error('Failed to load undo state', e);
            }
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
            const gap = 30;
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
                    
                    console.log('[AutoAlign] Dominant axis:', this.auto_align_dominant_axis, 'Master order:', this.auto_align_master_order);
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
                lcanvas.auto_align_animating = true;
                lcanvas.auto_align_anim_nodes = Object.values(this.selected_nodes);
                lcanvas.auto_align_anim_targets = targets;
            }
        }
        
        // Add a helper to compute targets using master order
        computeAutoAlignTargetsWithMasterOrder(axis) {
            const nodes = Object.values(this.selected_nodes);
            const originals = this.auto_align_originals || {};
            const masterOrder = this.auto_align_master_order || [];
            
            // Sort nodes according to the master order (regardless of alignment axis)
            const sortedNodes = masterOrder.map(id => nodes.find(n => n.id === id)).filter(Boolean);
            
            let center = 0;
            for (const n of sortedNodes) {
                const orig = originals[n.id] || n.pos;
                center += axis === 'horizontal' ? orig[1] : orig[0];
            }
            center /= sortedNodes.length;
            const totalSize = sortedNodes.reduce((sum, n) => sum + (axis === 'horizontal' ? n.size[0] : n.size[1]), 0);
            const gap = 30;
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
function initApp() {
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
    
    // Load saved state
    StateManager.loadState(graph, lcanvas, window.LiteGraph);
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

function setupDragAndDrop(canvasElement, graph, lcanvas) {
    canvasElement.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    canvasElement.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    canvasElement.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const files = e.dataTransfer.files;
        if (files.length === 0) return;
        
        // Get drop position
        const rect = canvasElement.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;
        const graphPos = lcanvas.convertOffsetToCanvas(canvasX, canvasY);
        
        Array.from(files).forEach((file, index) => {
            if (!file.type.startsWith('image/')) return;
            
            const reader = new FileReader();
            reader.onload = (event) => {
                const node = window.LiteGraph.createNode("media/image");
                if (node) {
                    // Center the node on the mouse position
                    node.pos = [
                        graphPos[0] - node.size[0] / 2 + (index * 20), 
                        graphPos[1] - node.size[1] / 2 + (index * 20)
                    ];
                    node.setImage(event.target.result, file.name);
                    graph.add(node);
                    
                    // Clear any drag state
                    lcanvas.dragging_canvas = false;
                    lcanvas.dragging_node = null;
                    lcanvas.node_captured = null;
                    lcanvas.node_dragged = null;
                    
                    // Force redraw
                    lcanvas.dirty_canvas = true;
                    // this.draw(); // Removed direct draw
                    
                    // Save state after adding node
                    StateManager.saveState(graph, lcanvas);
                    lcanvas.pushUndoState();
                }
            };
            reader.readAsDataURL(file);
        });
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
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
                    let k = 120.0, d = 12.0, dt = 1/60; // tuned spring
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
                    if (lcanvas.auto_align_originals) {
                        lcanvas.auto_align_originals = null;
                    }
                    if (lcanvas.auto_align_master_order) {
                        lcanvas.auto_align_master_order = null;
                    }
                    lcanvas.auto_align_dominant_axis = null; // Clear dominant axis
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