class FloatingPropertiesInspector {
    constructor(canvas) {
        this.canvas = canvas;
        this.panel = null;
        this.isVisible = false;
        this.currentNodes = new Map();
        this.propertyEditors = new Map();
        this.position = { x: window.innerWidth - 320, y: 100 };
        this.size = { width: 280, height: 400 };
        
        // Debounce timers for different property types
        this.debounceTimers = new Map();
        this.debounceDelay = 150; // milliseconds
        
        // Track which inputs are currently focused/being edited
        this.focusedInputs = new Set();
        this.lastPropertyValues = new Map(); // Cache to compare values
        
        // Callback for when visibility changes
        this.visibilityCallback = null;
        
        this.createUI();
        this.setupEventListeners();
        this.updatePosition();
        // Start hidden - user can toggle with 'p' key
        this.updateProperties(); // Initialize properties even when hidden
        
        // Load saved state from localStorage
        this.loadPropertiesState();
        
        // Delay selection integration to ensure canvas is ready
        setTimeout(() => {
            this.initializeSelectionIntegration();
        }, 100);
    }

    createUI() {
        this.panel = document.createElement('div');
        this.panel.className = 'floating-properties-inspector';
        this.panel.innerHTML = `
            <div class="inspector-header">
                <div class="inspector-title">Properties</div>
                <div class="inspector-controls">
                    <button class="inspector-close" title="Close">&times;</button>
                </div>
            </div>
            <div class="inspector-content">
                <div class="properties-list"></div>
            </div>
        `;
        
        this.addStyles();
        document.body.appendChild(this.panel);
        
        // Make sure panel doesn't block canvas interactions when starting a drag
        this.setupCanvasInteractionHandling();
        
        // Prevent keyboard events from bubbling to canvas
        this.setupKeyboardHandling();
    }

    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .floating-properties-inspector {
                position: fixed;
                background: #1e1e1e;
                border: 1px solid #333;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                z-index: 1000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 12px;
                color: #e0e0e0;
                min-width: 100px;
                max-width: 200px;
                min-height: 100px;
                max-height: 600px;
                display: flex;
                flex-direction: column;
                user-select: none;
                opacity: 0;
                transform: scale(0.95);
                transition: opacity 0.2s ease, transform 0.2s ease;
                pointer-events: none;
            }

            .floating-properties-inspector.visible {
                opacity: 1;
                transform: scale(1);
                pointer-events: auto;
            }

            .inspector-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 4px 14px;
                background: #2a2a2a;
                border-bottom: 1px solid #333;
                border-radius: 8px 8px 0 0;
                cursor: move;
            }

            .inspector-title {
                font-weight: 600;
                font-size: 13px;
                color: #f0f0f0;
            }

            .inspector-controls {
                display: flex;
                gap: 4px;
            }

            .inspector-close {
                background: none;
                border: none;
                color: #888;
                font-size: 16px;
                cursor: pointer;
                padding: 0;
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 3px;
                transition: background-color 0.15s ease;
            }

            .inspector-close:hover {
                background: #444;
                color: #fff;
            }

            .inspector-content {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
            }

            .properties-list {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .property-group {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .property-group-title {
                font-weight: 600;
                font-size: 11px;
                color: #999;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 4px;
            }

            .property-item {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .property-label {
                font-size: 11px;
                color: #ccc;
                font-weight: 500;
            }

            .property-input {
                background: #2a2a2a;
                border: 1px solid #444;
                border-radius: 4px;
                padding: 6px 8px;
                color: #e0e0e0;
                font-size: 12px;
                font-family: inherit;
                transition: border-color 0.15s ease;
            }

            .property-input:focus {
                outline: none;
                border-color: #0066cc;
            }

            .property-input[type="number"] {
                -moz-appearance: textfield;
            }

            .property-input[type="number"]::-webkit-outer-spin-button,
            .property-input[type="number"]::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
            }

            .property-input[type="range"] {
                -webkit-appearance: none;
                height: 4px;
                border-radius: 2px;
                background: #444;
                outline: none;
            }

            .property-input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: #0066cc;
                cursor: pointer;
            }

            .property-input[type="color"] {
                width: 100%;
                height: 32px;
                border-radius: 4px;
                border: 1px solid #444;
                background: none;
                cursor: pointer;
            }

            .property-select {
                background: #2a2a2a;
                border: 1px solid #444;
                border-radius: 4px;
                padding: 6px 8px;
                color: #e0e0e0;
                font-size: 12px;
                font-family: inherit;
                cursor: pointer;
            }

            .property-checkbox {
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
            }

            .property-checkbox input[type="checkbox"] {
                width: 14px;
                height: 14px;
                accent-color: #0066cc;
            }

            .property-row {
                display: flex;
                gap: 8px;
            }

            .property-row .property-item {
                flex: 1;
            }

            .no-selection {
                text-align: center;
                color: #666;
                font-style: italic;
                padding: 40px 20px;
            }

            .multi-selection-info {
                background: #2a2a2a;
                border: 1px solid #444;
                border-radius: 4px;
                padding: 8px 12px;
                margin-bottom: 12px;
                font-size: 11px;
                color: #999;
                text-align: center;
            }

            .canvas-stats {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .stat-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 4px 0;
                border-bottom: 1px solid #333;
            }

            .stat-item:last-child {
                border-bottom: none;
            }

            .stat-label {
                font-size: 11px;
                color: #999;
                font-weight: 500;
            }

            .stat-value {
                font-size: 11px;
                color: #e0e0e0;
                font-weight: 600;
            }

            .canvas-actions {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .action-button {
                background: #2a2a2a;
                border: 1px solid #444;
                border-radius: 4px;
                padding: 8px 12px;
                color: #e0e0e0;
                font-size: 11px;
                font-family: inherit;
                cursor: pointer;
                transition: background-color 0.15s ease;
            }

            .action-button:hover {
                background: #333;
                border-color: #555;
            }

            .action-button:active {
                background: #222;
            }

            .canvas-stats-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
            }

            .stat-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
                padding: 6px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 4px;
                border: 2px solid rgba(255, 255, 255, 0.1);
            }

            .stat-item.full-width {
                grid-column: 1 / -1;
            }

            .stat-item .stat-label {
                color: #999;
                font-weight: 500;
                font-size: 9px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 2px;
            }

            .stat-item .stat-value {
                color: #e0e0e0;
                font-weight: 600;
                font-size: 11px;
            }

            .property-input.transform-input {
                width: 50px; /* Adjust this value as needed */
            }

            /* Title input with visibility toggle */
            .title-input-container {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .title-visibility-toggle {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background-color: #999;
                cursor: pointer;
                transition: background-color 0.2s ease;
                flex-shrink: 0;
            }

            .title-visibility-toggle:hover {
                background-color: #bbb;
            }

            .title-visibility-toggle.hidden {
                background-color: #555;
            }

            .title-visibility-toggle.hidden:hover {
                background-color: #666;
            }

            .property-input.title-hidden {
                color: #666;
                background-color: rgba(255, 255, 255, 0.03);
            }

            .property-value-text {
                color: #999;
                font-size: 12px;
                font-style: italic;
                display: inline-block;
                padding: 6px 0;
            }
        `;
        document.head.appendChild(style);
    }

    setupEventListeners() {
        const closeBtn = this.panel.querySelector('.inspector-close');
        closeBtn.addEventListener('click', () => this.hide());

        const header = this.panel.querySelector('.inspector-header');
        this.makeDraggable(header);

        document.addEventListener('click', (e) => {
            if (!this.panel.contains(e.target) && this.isVisible) {
                const canvas = this.canvas.canvas;
                if (!canvas || !canvas.contains(e.target)) {
                    return;
                }
            }
        });
    }
    
    setupCanvasInteractionHandling() {
        // Monitor canvas drag operations
        let isDraggingOnCanvas = false;
        let originalPointerEvents = null;
        
        // Function to temporarily disable panel interaction during canvas drags
        const disablePanelDuringDrag = () => {
            if (this.isVisible && !isDraggingOnCanvas) {
                isDraggingOnCanvas = true;
                originalPointerEvents = this.panel.style.pointerEvents;
                this.panel.style.pointerEvents = 'none';
            }
        };
        
        const enablePanelAfterDrag = () => {
            if (isDraggingOnCanvas) {
                isDraggingOnCanvas = false;
                if (this.isVisible) {
                    this.panel.style.pointerEvents = originalPointerEvents || 'auto';
                }
            }
        };
        
        // Listen for canvas mousedown events to detect drag start
        document.addEventListener('mousedown', (e) => {
            const canvas = this.canvas.canvas;
            if (canvas && canvas.contains(e.target) && !this.panel.contains(e.target)) {
                // Started dragging on canvas
                disablePanelDuringDrag();
            }
        }, true);
        
        // Re-enable on mouseup
        document.addEventListener('mouseup', () => {
            enablePanelAfterDrag();
        }, true);
        
        // Also handle when mouse leaves the window
        document.addEventListener('mouseleave', () => {
            enablePanelAfterDrag();
        });
    }
    
    setupKeyboardHandling() {
        // Prevent keyboard events from bubbling up to canvas when panel is focused
        this.panel.addEventListener('keydown', (e) => {
            // Always stop propagation to prevent canvas shortcuts
            e.stopPropagation();
            
            // Handle Enter key to commit changes
            if (e.key === 'Enter' && e.target.matches('input')) {
                e.target.blur(); // This will trigger the change event
                e.preventDefault();
            }
            
            // Handle Escape key to cancel editing
            if (e.key === 'Escape' && e.target.matches('input')) {
                // Restore original value by triggering updatePropertyValues
                this.updatePropertyValues();
                e.target.blur();
                e.preventDefault();
            }
        });
        
        // Also prevent keyup and keypress from bubbling
        this.panel.addEventListener('keyup', (e) => {
            e.stopPropagation();
        });
        
        this.panel.addEventListener('keypress', (e) => {
            e.stopPropagation();
        });
    }

    makeDraggable(handle) {
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        handle.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = this.panel.offsetLeft;
            startTop = this.panel.offsetTop;
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        });

        const onMouseMove = (e) => {
            if (!isDragging) return;
            
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            
            this.position.x = Math.max(0, Math.min(window.innerWidth - this.panel.offsetWidth, startLeft + dx));
            this.position.y = Math.max(0, Math.min(window.innerHeight - this.panel.offsetHeight, startTop + dy));
            
            this.updatePosition();
        };

        const onMouseUp = () => {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            
            // Save position to localStorage after drag
            this.savePropertiesState();
        };
    }

    initializeSelectionIntegration() {
        try {
            console.log('🔍 Initializing properties inspector selection integration...');
            console.log('Canvas object:', this.canvas);
            console.log('Selection object:', this.canvas.selection);
            
            if (this.canvas && this.canvas.selection) {
                this.canvas.selection.addCallback((selectedNodes) => {
                    // console.log('🎯 Selection changed:', selectedNodes.size, 'nodes selected');
                    this.updateSelection(selectedNodes);
                });
                console.log('✅ Properties inspector connected to selection system');
                
                // Add listeners for canvas state changes to update statistics
                this.setupCanvasStateListeners();
            } else {
                console.warn('⚠️ Canvas or selection system not ready yet, retrying...');
                setTimeout(() => {
                    this.initializeSelectionIntegration();
                }, 500);
            }
        } catch (error) {
            console.error('❌ Error initializing selection integration:', error);
            setTimeout(() => {
                this.initializeSelectionIntegration();
            }, 1000);
        }
    }

    setupCanvasStateListeners() {
        this.lastZoomLevel = null;
        
        // Listen for canvas draw events to update zoom level only
        const originalDraw = this.canvas.draw.bind(this.canvas);
        this.canvas.draw = (...args) => {
            const result = originalDraw(...args);
            
            // Update properties if showing canvas info (no nodes selected)
            if (this.currentNodes.size === 0) {
                this.updateProperties();
            } else {
                // Only update zoom if it changed
                const currentZoom = this.canvas.viewport?.scale || 1;
                if (this.lastZoomLevel !== currentZoom) {
                    this.lastZoomLevel = currentZoom;
                    this.updatePropertyValues();
                }
            }
            return result;
        };

        // Listen for graph changes
        if (this.canvas.graph) {
            const originalAdd = this.canvas.graph.add.bind(this.canvas.graph);
            this.canvas.graph.add = (...args) => {
                const result = originalAdd(...args);
                if (this.currentNodes.size === 0) {
                    this.updateProperties();
                }
                return result;
            };

            const originalRemove = this.canvas.graph.remove.bind(this.canvas.graph);
            this.canvas.graph.remove = (...args) => {
                const result = originalRemove(...args);
                if (this.currentNodes.size === 0) {
                    this.updateProperties();
                }
                return result;
            };

            const originalClear = this.canvas.graph.clear.bind(this.canvas.graph);
            this.canvas.graph.clear = (...args) => {
                const result = originalClear(...args);
                if (this.currentNodes.size === 0) {
                    this.updateProperties();
                }
                return result;
            };
        }

        // Listen for zoom changes
        if (this.canvas.ds) {
            const originalChangeZoom = this.canvas.ds.changeZoom.bind(this.canvas.ds);
            this.canvas.ds.changeZoom = (...args) => {
                const result = originalChangeZoom(...args);
                if (this.currentNodes.size === 0) {
                    this.updateProperties();
                }
                return result;
            };
        }

        // Set up periodic updates for live data - use less frequent updates
        this.updateInterval = setInterval(() => {
            // Only update values, not the entire UI
            this.updatePropertyValues();
        }, 1000); // Less frequent to reduce interference
        
        // Throttle canvas draw updates to prevent excessive updates
        this.lastDrawUpdate = 0;
        const drawUpdateThrottle = 100; // minimum ms between updates
        
        // Listen for canvas draw events to update values after changes
        const updateAfterDraw = () => {
            const now = Date.now();
            // Only update if we have selected nodes and enough time has passed
            if (this.currentNodes.size > 0 && (now - this.lastDrawUpdate) > drawUpdateThrottle) {
                this.lastDrawUpdate = now;
                // Use a small delay to batch multiple rapid draw calls
                setTimeout(() => {
                    this.updatePropertyValues();
                }, 50);
            }
        };
        
        // Add listener for canvas redraws (less aggressive)
        if (this.canvas) {
            const originalDraw = this.canvas.draw.bind(this.canvas);
            this.canvas.draw = (...args) => {
                const result = originalDraw(...args);
                updateAfterDraw();
                return result;
            };
        }
    }

    updateSelection(selectedNodes) {
        // Clear property value cache when selection changes
        this.lastPropertyValues.clear();
        
        this.currentNodes = new Map(selectedNodes);
        this.updateProperties(); // Only rebuild UI when selection changes
    }

    updateProperties() {
        const contentEl = this.panel.querySelector('.properties-list');
        
        // Clear focused inputs since we're rebuilding the UI
        this.focusedInputs.clear();
        
        contentEl.innerHTML = '';

        if (this.currentNodes.size === 0) {
            // Show canvas statistics and properties only when no nodes are selected
            this.renderCanvasStats(contentEl);
            this.renderCanvasProperties(contentEl);
            return;
        }

        if (this.currentNodes.size > 1) {
            const info = document.createElement('div');
            info.className = 'multi-selection-info';
            info.textContent = `${this.currentNodes.size} nodes selected - showing common properties`;
            contentEl.appendChild(info);
        }

        const commonProperties = this.getCommonProperties();
        this.renderPropertyGroups(contentEl, commonProperties);
    }
    
    updateTitleToggleState(toggleDot, inputEl, isHidden) {
        if (isHidden) {
            toggleDot.classList.add('hidden');
            inputEl.classList.add('title-hidden');
        } else {
            toggleDot.classList.remove('hidden');
            inputEl.classList.remove('title-hidden');
        }
    }
    
    updatePropertyValues() {
        // Skip update if any input is focused to prevent interference
        if (this.focusedInputs.size > 0) {
            return;
        }
        
        // Update title toggle state if it exists
        if (this.titleToggleDot && this.currentNodes.size > 0) {
            const nodes = Array.from(this.currentNodes.values());
            const isHidden = nodes.every(node => node.flags?.hide_title);
            this.updateTitleToggleState(this.titleToggleDot, this.titleToggleDot.titleInput, isHidden);
        }
        
        // Update input values without recreating the UI
        const commonProperties = this.getCommonProperties();
        
        for (const [prop, propData] of Object.entries(commonProperties)) {
            const input = document.getElementById(`property-input-${prop}`) || 
                          document.getElementById(`property-select-${prop}`) ||
                          document.getElementById(`property-checkbox-${prop}`);
            
            if (!input) continue;
            
            // Skip if this input is focused or has user selection
            if (this.focusedInputs.has(input.id) || 
                input === document.activeElement ||
                (input.selectionStart !== input.selectionEnd)) {
                continue;
            }
            
            // Compare with cached value to avoid unnecessary updates
            const cacheKey = `${prop}`;
            const currentValue = propData.mixed ? 'mixed' : propData.value;
            
            if (this.lastPropertyValues.get(cacheKey) === currentValue) {
                continue; // No change, skip update
            }
            
            this.lastPropertyValues.set(cacheKey, currentValue);
            
            // Update the input value
            if (input.type === 'checkbox') {
                input.checked = !propData.mixed && !!propData.value;
                input.indeterminate = propData.mixed;
            } else if (input.type === 'number') {
                if (propData.mixed) {
                    input.value = '';
                    input.placeholder = 'Mixed';
                } else {
                    // Format position values to show decimals
                    if ((prop === 'x' || prop === 'y' || prop === 'width' || prop === 'height') && typeof propData.value === 'number') {
                        input.value = propData.value.toFixed(2);
                    } else {
                        input.value = propData.value || 0;
                    }
                }
            } else {
                input.value = propData.mixed ? '' : (propData.value || '');
                input.placeholder = propData.mixed ? 'Mixed values' : '';
            }
        }
        
        // Also update canvas stats
        const statsRows = this.panel.querySelectorAll('.stat-value');
        if (statsRows.length > 0) {
            const canvasInfo = this.getCanvasInfo();
            const values = [
                canvasInfo.nodeCount,
                `${canvasInfo.zoomLevel}%`,
                canvasInfo.imageCount,
                canvasInfo.videoCount,
                canvasInfo.textCount,
                `${canvasInfo.canvasWidth} × ${canvasInfo.canvasHeight}`
            ];
            
            statsRows.forEach((el, index) => {
                if (values[index] !== undefined) {
                    el.textContent = values[index];
                }
            });
        }
    }

    getCommonProperties() {
        if (this.currentNodes.size === 0) return {};
        
        const nodeArray = Array.from(this.currentNodes.values());
        const firstNode = nodeArray[0];
        const commonProps = {};

        const allProperties = {
            x: 'number',
            y: 'number',
            width: 'number', 
            height: 'number',
            rotation: 'number',
            title: 'text'
        };

        if (firstNode.type === 'text') {
            Object.assign(allProperties, {
                text: 'text',
                fontSize: 'number',
                fontFamily: 'select',
                textAlign: 'select',
                textColor: 'color',
                bgColor: 'color',
                bgAlpha: 'range',
                leadingFactor: 'number',
                padding: 'number'
            });
        } else if (firstNode.type === 'video') {
            Object.assign(allProperties, {
                loop: 'checkbox',
                muted: 'checkbox',
                autoplay: 'checkbox',
                paused: 'checkbox'
            });
        } else if (firstNode.type === 'image' || firstNode.type === 'media/image') {
            Object.assign(allProperties, {
                filename: 'readonly',
                scale: 'range'
            });
        }

        for (const [prop, type] of Object.entries(allProperties)) {
            const values = nodeArray.map(node => this.getNodeProperty(node, prop));
            
            if (values.every(val => val !== undefined)) {
                const allSame = values.every(val => val === values[0]);
                commonProps[prop] = {
                    type: type,
                    value: allSame ? values[0] : 'mixed',
                    mixed: !allSame
                };
            }
        }

        return commonProps;
    }

    getNodeProperty(node, prop) {
        switch (prop) {
            case 'x': return node.pos?.[0];
            case 'y': return node.pos?.[1];
            case 'width': return node.size?.[0];
            case 'height': return node.size?.[1];
            case 'filename': return node.properties?.filename;
            default: return node[prop];
        }
    }

    renderPropertyGroups(container, properties) {
        const groups = {
            'Transform': ['x', 'y', 'width', 'height', 'rotation'],
            'Content': ['filename', 'title', 'text', 'fontSize', 'fontFamily', 'textAlign', 'padding', 'leadingFactor'],
            'Appearance': ['textColor', 'bgColor', 'bgAlpha', 'scale'],
            'Playback': ['loop', 'muted', 'autoplay', 'paused']
        };

        for (const [groupName, groupProps] of Object.entries(groups)) {
            const groupProperties = groupProps.filter(prop => properties[prop]);
            if (groupProperties.length === 0) continue;

            const groupEl = document.createElement('div');
            groupEl.className = 'property-group';
            
            const titleEl = document.createElement('div');
            titleEl.className = 'property-group-title';
            titleEl.textContent = groupName;
            groupEl.appendChild(titleEl);

            if (groupName === 'Transform' && groupProperties.includes('x') && groupProperties.includes('y')) {
                this.renderPropertyRow(groupEl, [
                    { prop: 'x', ...properties.x },
                    { prop: 'y', ...properties.y }
                ]);
                groupProperties.splice(groupProperties.indexOf('x'), 1);
                groupProperties.splice(groupProperties.indexOf('y'), 1);
            }

            if (groupName === 'Transform' && groupProperties.includes('width') && groupProperties.includes('height')) {
                this.renderPropertyRow(groupEl, [
                    { prop: 'width', ...properties.width },
                    { prop: 'height', ...properties.height }
                ]);
                groupProperties.splice(groupProperties.indexOf('width'), 1);
                groupProperties.splice(groupProperties.indexOf('height'), 1);
            }

            for (const prop of groupProperties) {
                this.renderProperty(groupEl, prop, properties[prop]);
            }

            container.appendChild(groupEl);
        }
    }

    renderPropertyRow(container, propData) {
        const rowEl = document.createElement('div');
        rowEl.className = 'property-row';
        
        for (const data of propData) {
            this.renderProperty(rowEl, data.prop, data, true);
        }
        
        container.appendChild(rowEl);
    }

    renderProperty(container, prop, propData, inRow = false) {
        const itemEl = document.createElement('div');
        itemEl.className = 'property-item';

        const labelEl = document.createElement('div');
        labelEl.className = 'property-label';
        labelEl.textContent = this.formatPropertyLabel(prop);
        itemEl.appendChild(labelEl);

        if (prop === 'title') {
            // Special handling for title with visibility toggle
            const inputContainer = document.createElement('div');
            inputContainer.className = 'title-input-container';
            
            const inputEl = this.createPropertyInput(prop, propData);
            inputContainer.appendChild(inputEl);
            
            // Create visibility toggle dot
            const toggleDot = document.createElement('div');
            toggleDot.className = 'title-visibility-toggle';
            
            // Check if title is hidden for all selected nodes
            const nodes = Array.from(this.currentNodes.values());
            const isHidden = nodes.every(node => node.flags?.hide_title);
            
            if (isHidden) {
                toggleDot.classList.add('hidden');
                inputEl.classList.add('title-hidden');
            }
            
            // Store references for external updates
            toggleDot.titleInput = inputEl;
            this.titleToggleDot = toggleDot;
            
            toggleDot.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const newHiddenState = !toggleDot.classList.contains('hidden');
                
                // Update all selected nodes
                nodes.forEach(node => {
                    if (!node.flags) node.flags = {};
                    node.flags.hide_title = newHiddenState;
                });
                
                // Update UI
                this.updateTitleToggleState(toggleDot, inputEl, newHiddenState);
                
                // Force canvas redraw
                if (this.canvas.dirty_canvas !== undefined) {
                    this.canvas.dirty_canvas = true;
                }
            });
            
            inputContainer.appendChild(toggleDot);
            
            itemEl.appendChild(inputContainer);
        } else {
            const inputEl = this.createPropertyInput(prop, propData);
            itemEl.appendChild(inputEl);
        }

        container.appendChild(itemEl);
    }

    createPropertyInput(prop, propData) {
        const { type, value, mixed } = propData;

        switch (type) {
            case 'number':
                return this.createNumberInput(prop, value, mixed);
            case 'text':
                return this.createTextInput(prop, value, mixed);
            case 'color':
                return this.createColorInput(prop, value, mixed);
            case 'range':
                return this.createRangeInput(prop, value, mixed);
            case 'select':
                return this.createSelectInput(prop, value, mixed);
            case 'checkbox':
                return this.createCheckboxInput(prop, value, mixed);
            case 'readonly':
                return this.createReadonlyInput(prop, value, mixed);
            default:
                return this.createTextInput(prop, value, mixed);
        }
    }

    createTextInput(prop, value, mixed) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'property-input';
        input.name = `property-${prop}`;
        input.id = `property-input-${prop}`;
        input.value = mixed ? '' : (value || '');
        input.placeholder = mixed ? 'Mixed values' : '';
        
        // Store original value for canceling
        let originalValue = input.value;
        
        // Add focus tracking
        input.addEventListener('focus', () => {
            this.focusedInputs.add(input.id);
            originalValue = input.value; // Store value when focus starts
        });
        
        input.addEventListener('blur', () => {
            this.focusedInputs.delete(input.id);
            // Commit change on blur
            this.updateNodeProperty(prop, input.value);
        });
        
        // Handle keyboard events
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace') {
                e.stopPropagation();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                // Commit change and blur with delay to prevent UI rebuild
                console.log(`Committing ${prop} change: "${input.value}"`);
                this.updateNodeProperty(prop, input.value);
                
                // Keep input in focused set briefly to prevent UI rebuild
                setTimeout(() => {
                    console.log(`Blurring ${prop} input`);
                    input.blur();
                }, 50);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                // Cancel change - restore original value and blur
                input.value = originalValue;
                input.blur();
            }
        });
        
        return input;
    }

    createNumberInput(prop, value, mixed) {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'property-input';
        input.name = `property-${prop}`;
        input.id = `property-input-${prop}`;
        
        // Add specific class for transform properties
        if (prop === 'x' || prop === 'y' || prop === 'width' || prop === 'height') {
            input.classList.add('transform-input');
        }
        
        // Format position values to show decimals
        if ((prop === 'x' || prop === 'y' || prop === 'width' || prop === 'height') && typeof value === 'number') {
            input.value = mixed ? '' : value.toFixed(2); // Two decimal places
        } else {
            input.value = mixed ? '' : (value || 0);
        }
        
        input.placeholder = mixed ? 'Mixed' : '';
        
        if (prop === 'fontSize') {
            input.min = 6;
            input.max = 200;
        } else if (prop === 'rotation') {
            input.min = -360;
            input.max = 360;
        } else if (prop === 'x' || prop === 'y') {
            input.step = 0.1; // Allow decimal positions
        } else if (prop === 'width' || prop === 'height') {
            input.min = 50; // Minimum size
            input.step = 1;
        }
        
        // Store original value for canceling
        let originalValue = input.value;
        
        // Add focus tracking
        input.addEventListener('focus', () => {
            this.focusedInputs.add(input.id);
            originalValue = input.value; // Store value when focus starts
        });
        
        input.addEventListener('blur', () => {
            this.focusedInputs.delete(input.id);
            // Commit change on blur
            this.updateNodeProperty(prop, parseFloat(input.value) || 0);
        });
        
        // Handle keyboard events
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace') {
                e.stopPropagation();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                // Commit change and blur with delay to prevent UI rebuild
                this.updateNodeProperty(prop, parseFloat(input.value) || 0);
                
                // Keep input in focused set briefly to prevent UI rebuild
                setTimeout(() => {
                    input.blur();
                }, 50);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                // Cancel change - restore original value and blur
                input.value = originalValue;
                input.blur();
            }
        });
        
        return input;
    }

    createColorInput(prop, value, mixed) {
        const input = document.createElement('input');
        input.type = 'color';
        input.className = 'property-input';
        input.name = `property-${prop}`;
        input.id = `property-input-${prop}`;
        if (!mixed && value) {
            input.value = value.startsWith('#') ? value : `#${value}`;
        }
        
        input.addEventListener('change', (e) => {
            this.updateNodeProperty(prop, e.target.value);
        });
        
        return input;
    }

    createRangeInput(prop, value, mixed) {
        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'property-input';
        input.name = `property-${prop}`;
        input.id = `property-input-${prop}`;
        input.value = mixed ? 0.5 : (value || 0);
        
        if (prop === 'bgAlpha') {
            input.min = 0;
            input.max = 1;
            input.step = 0.01;
        } else if (prop === 'scale') {
            input.min = 0.1;
            input.max = 3;
            input.step = 0.1;
        }
        
        input.addEventListener('input', (e) => {
            this.updateNodeProperty(prop, parseFloat(e.target.value));
        });
        
        return input;
    }

    createSelectInput(prop, value, mixed) {
        const select = document.createElement('select');
        select.className = 'property-select';
        select.name = `property-${prop}`;
        select.id = `property-select-${prop}`;
        
        let options = [];
        if (prop === 'textAlign') {
            options = [
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' }
            ];
        } else if (prop === 'fontFamily') {
            options = [
                { value: 'Arial', label: 'Arial' },
                { value: 'Helvetica', label: 'Helvetica' },
                { value: 'Times New Roman', label: 'Times New Roman' },
                { value: 'Georgia', label: 'Georgia' },
                { value: 'Verdana', label: 'Verdana' }
            ];
        }
        
        if (mixed) {
            const mixedOption = document.createElement('option');
            mixedOption.value = '';
            mixedOption.textContent = 'Mixed values';
            mixedOption.selected = true;
            select.appendChild(mixedOption);
        }
        
        for (const option of options) {
            const optionEl = document.createElement('option');
            optionEl.value = option.value;
            optionEl.textContent = option.label;
            optionEl.selected = !mixed && value === option.value;
            select.appendChild(optionEl);
        }
        
        select.addEventListener('change', (e) => {
            if (e.target.value) {
                this.updateNodeProperty(prop, e.target.value);
            }
        });
        
        return select;
    }

    createCheckboxInput(prop, value, mixed) {
        const container = document.createElement('div');
        container.className = 'property-checkbox';
        
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = `property-${prop}`;
        input.id = `property-checkbox-${prop}`;
        input.checked = mixed ? false : !!value;
        input.indeterminate = mixed;
        
        const label = document.createElement('label');
        label.textContent = mixed ? 'Mixed values' : (value ? 'Enabled' : 'Disabled');
        
        input.addEventListener('change', (e) => {
            this.updateNodeProperty(prop, e.target.checked);
            label.textContent = e.target.checked ? 'Enabled' : 'Disabled';
        });
        
        container.appendChild(input);
        container.appendChild(label);
        return container;
    }

    createReadonlyInput(prop, value, mixed) {
        const span = document.createElement('span');
        span.className = 'property-value-text';
        span.id = `property-input-${prop}`;
        span.textContent = mixed ? 'Mixed' : (value || 'No file');
        
        return span;
    }

    formatPropertyLabel(prop) {
        const labels = {
            x: 'X',
            y: 'Y',
            width: 'Width',
            height: 'Height',
            rotation: 'Rotation',
            title: 'Title',
            filename: 'Source File',
            text: 'Text',
            fontSize: 'Font Size',
            fontFamily: 'Font Family',
            textAlign: 'Text Align',
            textColor: 'Text Color',
            bgColor: 'Background',
            bgAlpha: 'Background Opacity',
            leadingFactor: 'Line Height',
            padding: 'Padding',
            scale: 'Scale',
            loop: 'Loop',
            muted: 'Muted',
            autoplay: 'Autoplay',
            paused: 'Paused'
        };
        return labels[prop] || prop;
    }

    updateNodeProperty(prop, value) {
        // Debounce the update to avoid too many operations
        const timerKey = `${prop}-update`;
        
        if (this.debounceTimers.has(timerKey)) {
            clearTimeout(this.debounceTimers.get(timerKey));
        }
        
        this.debounceTimers.set(timerKey, setTimeout(() => {
            this.debounceTimers.delete(timerKey);
            this.executeNodePropertyUpdate(prop, value);
        }, this.debounceDelay));
    }
    
    executeNodePropertyUpdate(prop, value) {
        // Access operation pipeline from global app object like the canvas does
        if (!window.app?.operationPipeline) {
            console.warn('Operation pipeline not available');
            return;
        }

        const nodes = Array.from(this.currentNodes.values());
        
        // Handle different property types with appropriate commands
        if (prop === 'x' || prop === 'y') {
            // Position update
            if (nodes.length === 1) {
                const node = nodes[0];
                const newPos = [...node.pos];
                if (prop === 'x') newPos[0] = value;
                else newPos[1] = value;
                
                window.app.operationPipeline.execute('node_move', {
                    nodeId: node.id,
                    position: newPos
                });
            } else {
                // Multi-node move
                const nodeIds = [];
                const positions = [];
                
                nodes.forEach(node => {
                    nodeIds.push(node.id);
                    const newPos = [...node.pos];
                    if (prop === 'x') newPos[0] = value;
                    else newPos[1] = value;
                    positions.push(newPos);
                });
                
                window.app.operationPipeline.execute('node_move', {
                    nodeIds,
                    positions
                });
            }
        } else if (prop === 'width' || prop === 'height') {
            // Size update with validation
            const nodeIds = [];
            const sizes = [];
            
            nodes.forEach(node => {
                const newSize = [...node.size];
                // Ensure minimum size of 50px
                const validatedValue = Math.max(50, value);
                
                if (prop === 'width') newSize[0] = validatedValue;
                else newSize[1] = validatedValue;
                
                nodeIds.push(node.id);
                sizes.push(newSize);
            });
            
            window.app.operationPipeline.execute('node_resize', {
                nodeIds,
                sizes
            });
        } else if (prop === 'rotation') {
            // Rotation update
            nodes.forEach(node => {
                window.app.operationPipeline.execute('node_rotate', {
                    nodeId: node.id,
                    angle: value
                });
            });
        } else if (prop === 'title') {
            // Title update
            nodes.forEach(node => {
                window.app.operationPipeline.execute('node_property_update', {
                    nodeId: node.id,
                    property: 'title',
                    value: value
                });
            });
            
            // Update property values after title change
            setTimeout(() => this.updatePropertyValues(), 100);
        } else {
            // Generic property update
            nodes.forEach(node => {
                window.app.operationPipeline.execute('node_property_update', {
                    nodeId: node.id,
                    property: prop,
                    value: value
                });
            });
        }
    }

    renderCanvasStats(container) {
        const canvasInfo = this.getCanvasInfo();
        
        const statsGroup = document.createElement('div');
        statsGroup.className = 'property-group';
        
        const titleEl = document.createElement('div');
        titleEl.className = 'property-group-title';
        titleEl.textContent = 'Canvas Stats';
        statsGroup.appendChild(titleEl);

        const statsEl = document.createElement('div');
        statsEl.className = 'canvas-stats-grid';
        statsEl.innerHTML = `
            <div class="stat-item">
                <div class="stat-label">Nodes</div>
                <div class="stat-value">${canvasInfo.nodeCount}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Zoom</div>
                <div class="stat-value">${canvasInfo.zoomLevel}%</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Images</div>
                <div class="stat-value">${canvasInfo.imageCount}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Videos</div>
                <div class="stat-value">${canvasInfo.videoCount}</div>
            </div>
            <div class="stat-item">
                <div class="stat-label">Text</div>
                <div class="stat-value">${canvasInfo.textCount}</div>
            </div>
            <div class="stat-item full-width">
                <div class="stat-label">Canvas Size</div>
                <div class="stat-value">${canvasInfo.canvasWidth} × ${canvasInfo.canvasHeight}</div>
            </div>
        `;
        
        statsGroup.appendChild(statsEl);
        container.appendChild(statsGroup);
    }

    renderCanvasProperties(container) {
        const canvasInfo = this.getCanvasInfo();
        
        const groupEl = document.createElement('div');
        groupEl.className = 'property-group';
        
        // Canvas actions
        const actionsEl = document.createElement('div');
        actionsEl.className = 'canvas-actions';
        actionsEl.innerHTML = `
            <button class="action-button" data-action="select-all">Select All</button>
            <button class="action-button" data-action="clear-all">Clear Canvas</button>
            <button class="action-button" data-action="fit-view">Fit to View</button>
            <button class="action-button" data-action="reset-zoom">Reset Zoom</button>
        `;
        
        groupEl.appendChild(actionsEl);
        container.appendChild(groupEl);

        // Add event listeners for canvas actions
        actionsEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('action-button')) {
                this.handleCanvasAction(e.target.dataset.action);
            }
        });
    }

    getCanvasInfo() {
        // Get nodes from the graph
        let nodes = [];
        if (this.canvas.graph && Array.isArray(this.canvas.graph.nodes)) {
            nodes = this.canvas.graph.nodes;
        }
        
        const nodeCount = nodes.length;
        const imageCount = nodes.filter(n => n.type === 'image').length;
        const videoCount = nodes.filter(n => n.type === 'video').length;
        const textCount = nodes.filter(n => n.type === 'text').length;
        
        const canvasEl = this.canvas.canvas;
        const canvasWidth = canvasEl ? canvasEl.width : 0;
        const canvasHeight = canvasEl ? canvasEl.height : 0;
        
        // Get zoom level more reliably
        let zoomLevel = 100;
        if (this.canvas.viewport && typeof this.canvas.viewport.scale === 'number') {
            zoomLevel = Math.round(this.canvas.viewport.scale * 100);
        } else if (this.canvas.ds && typeof this.canvas.ds.scale === 'number') {
            zoomLevel = Math.round(this.canvas.ds.scale * 100);
        } else if (this.canvas.scale && typeof this.canvas.scale === 'number') {
            zoomLevel = Math.round(this.canvas.scale * 100);
        } else if (window.app && window.app.graphCanvas && window.app.graphCanvas.viewport && typeof window.app.graphCanvas.viewport.scale === 'number') {
            zoomLevel = Math.round(window.app.graphCanvas.viewport.scale * 100);
        }
        
        return {
            nodeCount,
            imageCount,
            videoCount,
            textCount,
            canvasWidth,
            canvasHeight,
            zoomLevel
        };
    }

    handleCanvasAction(action) {
        switch (action) {
            case 'select-all':
                if (this.canvas.selectAll) {
                    this.canvas.selectAll();
                }
                break;
            case 'clear-all':
                if (confirm('Are you sure you want to clear the entire canvas?')) {
                    if (this.canvas.graph) {
                        this.canvas.graph.clear();
                        this.canvas.draw();
                    }
                }
                break;
            case 'fit-view':
                if (this.canvas.centerAllNodes) {
                    this.canvas.centerAllNodes();
                }
                break;
            case 'reset-zoom':
                if (this.canvas.ds) {
                    this.canvas.ds.scale = 1.0;
                    this.canvas.ds.offset = [0, 0];
                    this.canvas.draw();
                }
                break;
        }
    }

    formatPropertyUpdate(prop, value) {
        if (prop === 'x') return { pos: [value, this.getNodeProperty(Array.from(this.currentNodes.values())[0], 'y')] };
        if (prop === 'y') return { pos: [this.getNodeProperty(Array.from(this.currentNodes.values())[0], 'x'), value] };
        if (prop === 'width') return { size: [value, this.getNodeProperty(Array.from(this.currentNodes.values())[0], 'height')] };
        if (prop === 'height') return { size: [this.getNodeProperty(Array.from(this.currentNodes.values())[0], 'width'), value] };
        return { [prop]: value };
    }

    applyPropertyUpdate(node, prop, value) {
        if (prop === 'x') {
            node.pos[0] = value;
        } else if (prop === 'y') {
            node.pos[1] = value;
        } else if (prop === 'width') {
            node.size[0] = value;
        } else if (prop === 'height') {
            node.size[1] = value;
        } else {
            node[prop] = value;
        }
    }


    updatePosition() {
        this.panel.style.left = `${this.position.x}px`;
        this.panel.style.top = `${this.position.y}px`;
    }

    show() {
        if (!this.isVisible) {
            this.isVisible = true;
            this.panel.style.display = 'flex';
            requestAnimationFrame(() => {
                this.panel.classList.add('visible');
            });
            
            // Notify any listeners that visibility changed
            this.onVisibilityChange();
            this.savePropertiesState();
        }
    }

    hide() {
        if (this.isVisible) {
            this.isVisible = false;
            this.panel.classList.remove('visible');
            // Don't hide the display, just make it non-interactive
            // This prevents layout jumps and keeps transitions smooth
            
            // Notify any listeners that visibility changed
            this.onVisibilityChange();
            this.savePropertiesState();
        }
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * Set callback for visibility changes
     */
    setVisibilityCallback(callback) {
        this.visibilityCallback = callback;
    }
    
    /**
     * Notify listeners of visibility change
     */
    onVisibilityChange() {
        if (this.visibilityCallback) {
            this.visibilityCallback(this.isVisible);
        }
    }
    
    destroy() {
        // Clean up update interval
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        
        if (this.panel) {
            this.panel.remove();
        }
    }
    
    savePropertiesState() {
        // Save properties panel state to localStorage
        try {
            localStorage.setItem('floating-properties-state', JSON.stringify({
                position: { x: this.position.x, y: this.position.y },
                visible: this.isVisible
            }));
        } catch (e) {
            console.warn('Failed to save properties panel state:', e);
        }
    }
    
    loadPropertiesState() {
        try {
            const saved = localStorage.getItem('floating-properties-state');
            if (saved) {
                const state = JSON.parse(saved);
                
                // Restore position
                if (state.position) {
                    this.position.x = Math.max(0, Math.min(window.innerWidth - 320, state.position.x));
                    this.position.y = Math.max(0, Math.min(window.innerHeight - 200, state.position.y));
                    this.updatePosition();
                }
                
                // Restore visibility state
                if (state.visible !== undefined) {
                    if (state.visible) {
                        this.show();
                    } else {
                        this.hide();
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to load properties panel state:', e);
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FloatingPropertiesInspector;
}