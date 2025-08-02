class FloatingColorCorrection {
    constructor(canvas) {
        this.canvas = canvas;
        this.panel = null;
        this.isVisible = false;
        this.currentNode = null;
        this.position = { x: window.innerWidth - 680, y: 100 };
        this.size = { width: 320, height: 400 };
        
        // Components
        this.splineCurveEditor = null;
        
        // Callback for when visibility changes
        this.visibilityCallback = null;
        
        this.createUI();
        this.setupEventListeners();
        this.updatePosition();
        
        // Load saved state from localStorage
        this.loadState();
        
        // Delay selection integration to ensure canvas is ready
        setTimeout(() => {
            this.initializeSelectionIntegration();
        }, 100);
    }

    createUI() {
        this.panel = document.createElement('div');
        this.panel.className = 'floating-color-correction';
        this.panel.innerHTML = `
            <div class="color-correction-header">
                <div class="color-correction-title">Color Correction</div>
                <div class="color-correction-controls">
                    <button class="color-correction-close" title="Close">&times;</button>
                </div>
            </div>
            <div class="color-correction-content">
                <div class="no-selection-message">Select an image to adjust color correction</div>
            </div>
        `;
        
        this.addStyles();
        document.body.appendChild(this.panel);
        
        // Curve editor will be initialized when a node is selected
    }

    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .floating-color-correction {
                position: fixed;
                background: #1e1e1e;
                border: 1px solid #333;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                z-index: 1000;
                font-family: ${FONT_CONFIG.APP_FONT};
                font-size: 12px;
                color: #e0e0e0;
                width: 250px;
                min-width: 200px;
                max-width: 250px;
                min-height: 400px;
                display: flex;
                flex-direction: column;
                user-select: none;
                opacity: 0;
                transform: scale(0.95);
                transition: opacity 0.2s ease, transform 0.2s ease;
                pointer-events: none;
                overflow: hidden;
            }

            .floating-color-correction.visible {
                opacity: 1;
                transform: scale(1);
                pointer-events: auto;
            }

            .color-correction-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 14px;
                background: #2a2a2a;
                border-bottom: 1px solid #333;
                border-radius: 8px 8px 0 0;
                cursor: move;
            }

            .color-correction-title {
                font-weight: 600;
                font-size: 13px;
                color: #f0f0f0;
            }

            .color-correction-controls {
                display: flex;
                gap: 4px;
            }

            .color-correction-close {
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

            .color-correction-close:hover {
                background: #444;
                color: #fff;
            }

            .color-correction-content {
                flex: 1;
                overflow-y: auto;
                overflow-x: hidden;
                padding: 16px;
                scrollbar-width: thin;
                scrollbar-color: #444 #2a2a2a;
            }
            
            .color-correction-content::-webkit-scrollbar {
                width: 8px;
            }
            
            .color-correction-content::-webkit-scrollbar-track {
                background: #2a2a2a;
                border-radius: 4px;
            }
            
            .color-correction-content::-webkit-scrollbar-thumb {
                background: #444;
                border-radius: 4px;
            }
            
            .color-correction-content::-webkit-scrollbar-thumb:hover {
                background: #555;
            }

            .curve-section {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            
            .color-adjustments-section {
                display: flex;
                flex-direction: column;
                gap: 12px;
                border-top: 1px solid #333;
                padding-top: 12px;
                margin-top: 12px;
            }
            
            .adjustment-controls {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            
            .adjustment-row {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .adjustment-label {
                flex: 0 0 80px;
                font-size: 11px;
                color: #ccc;
                font-weight: 500;
            }
            
            .adjustment-slider {
                flex: 1;
                height: 4px;
                -webkit-appearance: none;
                appearance: none;
                background: #444;
                border-radius: 2px;
                outline: none;
            }
            
            .adjustment-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 12px;
                height: 12px;
                background: #0066cc;
                border-radius: 50%;
                cursor: pointer;
                border: none;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
                transition: background-color 0.15s ease, transform 0.15s ease;
            }
            
            .adjustment-slider::-webkit-slider-thumb:hover {
                background: #0077dd;
                transform: scale(1.1);
            }
            
            .adjustment-slider::-moz-range-thumb {
                width: 12px;
                height: 12px;
                background: #0066cc;
                border-radius: 50%;
                cursor: pointer;
                border: none;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
                transition: background-color 0.15s ease, transform 0.15s ease;
            }
            
            .adjustment-slider::-moz-range-thumb:hover {
                background: #0077dd;
                transform: scale(1.1);
            }
            
            .adjustment-value {
                flex: 0 0 45px;
                text-align: right;
                font-size: 11px;
                color: #aaa;
                font-weight: 500;
            }

            .section-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .section-title {
                font-weight: 600;
                font-size: 11px;
                color: #999;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .bypass-toggle {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background-color: #999;
                cursor: pointer;
                transition: background-color 0.2s ease;
                flex-shrink: 0;
            }
            
            .bypass-toggle:hover {
                background-color: #bbb;
            }
            
            .bypass-toggle.active {
                background-color: #555;
            }
            
            .bypass-toggle.active:hover {
                background-color: #666;
            }

            .bypass-label {
                font-size: 11px;
                color: #ccc;
                font-weight: 500;
            }

            .curve-section.bypassed .curve-editor-container {
                opacity: 0.4;
                pointer-events: none;
            }

            .curve-section.bypassed .curve-controls button {
                opacity: 0.4;
                pointer-events: none;
                cursor: not-allowed;
            }
            
            .color-adjustments-section.bypassed .adjustment-controls {
                opacity: 0.4;
                pointer-events: none;
            }

            .curve-editor-container {
                width: 100%;
                height: 225px;
                background: #2a2a2a;
                border: 1px solid #444;
                border-radius: 4px;
                position: relative;
                overflow: hidden;
            }

            .curve-controls {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
            }

            .curve-reset-btn,
            .curve-preset-btn {
                background: #2a2a2a;
                border: 1px solid #444;
                border-radius: 4px;
                padding: 6px 12px;
                color: #e0e0e0;
                font-size: 11px;
                font-family: inherit;
                cursor: pointer;
                transition: background-color 0.15s ease;
            }

            .curve-reset-btn:hover,
            .curve-preset-btn:hover {
                background: #333;
                border-color: #555;
            }

            .curve-reset-btn:active,
            .curve-preset-btn:active {
                background: #222;
            }

            .no-selection-message {
                text-align: center;
                color: #666;
                font-style: italic;
                padding: 40px 20px;
            }
        `;
        document.head.appendChild(style);
    }

    setupEventListeners() {
        // Set up the main header listeners only once
        const closeBtn = this.panel.querySelector('.color-correction-close');
        const header = this.panel.querySelector('.color-correction-header');
        
        closeBtn.addEventListener('click', () => this.hide());
        this.makeDraggable(header);

        // Set up content event delegation - handles all content events
        const contentEl = this.panel.querySelector('.color-correction-content');
        
        // Handle bypass toggle clicks
        contentEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('bypass-toggle')) {
                const type = e.target.dataset.type;
                const isActive = e.target.classList.contains('active');
                
                if (type === 'tone-curve') {
                    this.handleBypassToggle(!isActive);
                } else if (type === 'color-adjustments') {
                    this.handleColorAdjustmentsBypass(!isActive);
                }
            }
        });

        contentEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('curve-reset-btn')) {
                if (this.splineCurveEditor && !this.isBypassed()) {
                    this.splineCurveEditor.reset();
                    this.updateNodeCurve();
                }
            } else if (e.target.classList.contains('curve-preset-btn')) {
                if (!this.isBypassed()) {
                    // TODO: Show preset menu
                    console.log('Presets not yet implemented');
                }
            }
        });

        contentEl.addEventListener('input', (e) => {
            if (e.target.classList.contains('adjustment-slider')) {
                const adjustmentKey = e.target.dataset.adjustment;
                const value = parseFloat(e.target.value);
                // Update the value display
                const valueDisplay = e.target.parentElement.querySelector('.adjustment-value');
                if (valueDisplay) {
                    if (adjustmentKey === 'hue') {
                        valueDisplay.textContent = `${Math.round(value)}°`;
                    } else {
                        valueDisplay.textContent = value.toFixed(2);
                    }
                }
                this.updateNodeAdjustment(adjustmentKey, value);
            }
        });
        
        // Add double-click to reset sliders
        contentEl.addEventListener('dblclick', (e) => {
            if (e.target.classList.contains('adjustment-slider')) {
                const adjustmentKey = e.target.dataset.adjustment;
                const defaultValue = 0; // All adjustments default to 0
                
                // Update the slider
                e.target.value = defaultValue;
                
                // Update the node
                this.updateNodeAdjustment(adjustmentKey, defaultValue);
                
                // Update the displayed value
                const valueDisplay = e.target.parentElement.querySelector('.adjustment-value');
                if (valueDisplay) {
                    valueDisplay.textContent = adjustmentKey === 'hue' ? '0°' : '0.00';
                }
            }
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
            this.saveState();
        };
    }

    initializeCurveEditor() {
        const container = this.panel.querySelector('.curve-editor-container');
        if (!container) return;

        // Clean up existing editor first
        if (this.splineCurveEditor) {
            this.splineCurveEditor.destroy();
            this.splineCurveEditor = null;
        }

        // Create new spline curve editor with fixed width
        if (window.SplineCurveEditor) {
            this.splineCurveEditor = new window.SplineCurveEditor(container, {
                width: 288, // 320px panel - 32px padding (16px each side)
                height: 256,
                onChange: (curveData) => this.handleCurveChange(curveData)
            });
        } else {
            console.error('SplineCurveEditor not loaded');
        }
    }

    initializeSelectionIntegration() {
        try {
            if (this.canvas && this.canvas.selection) {
                this.canvas.selection.addCallback((selectedNodes) => {
                    this.updateSelection(selectedNodes);
                });
            } else {
                setTimeout(() => {
                    this.initializeSelectionIntegration();
                }, 500);
            }
        } catch (error) {
            console.error('Error initializing selection integration:', error);
            setTimeout(() => {
                this.initializeSelectionIntegration();
            }, 1000);
        }
    }

    updateSelection(selectedNodes) {
        // Show for single image or video node selection
        if (selectedNodes.size === 1) {
            const node = Array.from(selectedNodes.values())[0];
            if (node.type === 'media/image' || node.type === 'media/video') {
                this.currentNode = node;
                this.updateUI();
                return;
            }
        }
        
        this.currentNode = null;
        this.updateUI();
    }

    updateUI() {
        const contentEl = this.panel.querySelector('.color-correction-content');
        
        if (!this.currentNode) {
            contentEl.innerHTML = '<div class="no-selection-message">Select an image or video to adjust color correction</div>';
            return;
        }

        // Simple approach - just rebuild content without touching event listeners
        this.renderContent(contentEl);
    }
    
    renderContent(container) {
        container.innerHTML = `
            <div class="curve-section">
                <div class="section-header">
                    <div class="section-title">Tone Curve</div>
                    <div class="bypass-toggle ${this.currentNode.toneCurveBypassed ? 'active' : ''}" data-type="tone-curve" title="Bypass tone curve"></div>
                </div>
                <div class="curve-editor-container"></div>
                <div class="curve-controls">
                    <!-- <button class="curve-reset-btn" title="Reset curve">Reset</button> -->
                    <!-- <button class="curve-preset-btn" title="Presets">Presets</button> -->
                </div>
            </div>
            <div class="color-adjustments-section">
                <div class="section-header">
                    <div class="section-title">Color Adjustments</div>
                    <div class="bypass-toggle ${this.currentNode.colorAdjustmentsBypassed ? 'active' : ''}" data-type="color-adjustments" title="Bypass color adjustments"></div>
                </div>
                <div class="adjustment-controls"></div>
            </div>
        `;
        
        // Initialize curve editor
        this.initializeCurveEditor();
        
        // Load curve data
        if (this.splineCurveEditor) {
            if (this.currentNode.toneCurve && !this.currentNode.toneCurveBypassed) {
                this.splineCurveEditor.loadCurve(this.currentNode.toneCurve);
            } else {
                this.splineCurveEditor.reset();
            }
        }
        
        // Apply bypass state
        if (this.currentNode.toneCurveBypassed) {
            const curveSection = container.querySelector('.curve-section');
            if (curveSection) {
                curveSection.classList.add('bypassed');
            }
        }
        
        // Initialize color adjustments
        this.initializeColorAdjustments();
    }
    
    initializeColorAdjustments() {
        const adjustmentContainer = this.panel.querySelector('.adjustment-controls');
        if (!adjustmentContainer || !this.currentNode) return;
        
        // Define the adjustments with their ranges and defaults
        const adjustments = [
            { key: 'brightness', label: 'Brightness', min: -1, max: 1, default: 0, step: 0.01 },
            { key: 'contrast', label: 'Contrast', min: -1, max: 1, default: 0, step: 0.01 },
            { key: 'saturation', label: 'Saturation', min: -1, max: 1, default: 0, step: 0.01 },
            { key: 'hue', label: 'Hue', min: -180, max: 180, default: 0, step: 1 }
        ];
        
        // Clear existing controls
        adjustmentContainer.innerHTML = '';
        
        // Create sliders for each adjustment
        adjustments.forEach(adjustment => {
            let currentValue = adjustment.default;
            
            // Get current value and handle legacy values that might be in wrong scale
            if (this.currentNode.adjustments && this.currentNode.adjustments[adjustment.key] !== undefined) {
                const rawValue = this.currentNode.adjustments[adjustment.key];
                
                // Convert legacy values if needed
                if (adjustment.key === 'hue') {
                    // Hue should be in degrees (-180 to 180)
                    currentValue = Math.max(-180, Math.min(180, rawValue));
                } else {
                    // Other values should be -1 to 1
                    // If value is outside expected range, it might be legacy (-100 to 100)
                    if (Math.abs(rawValue) > 1) {
                        currentValue = rawValue / 100; // Convert from percentage
                    } else {
                        currentValue = rawValue;
                    }
                    currentValue = Math.max(-1, Math.min(1, currentValue));
                }
            }
            
            const adjustmentRow = document.createElement('div');
            adjustmentRow.className = 'adjustment-row';
            
            // Format value display based on the adjustment type
            const displayValue = adjustment.key === 'hue' ? 
                `${currentValue}°` : 
                currentValue.toFixed(2);
            
            adjustmentRow.innerHTML = `
                <div class="adjustment-label">${adjustment.label}</div>
                <input type="range" 
                       class="adjustment-slider" 
                       data-adjustment="${adjustment.key}"
                       min="${adjustment.min}" 
                       max="${adjustment.max}" 
                       step="${adjustment.step}"
                       value="${currentValue}">
                <div class="adjustment-value">${displayValue}</div>
            `;
            
            adjustmentContainer.appendChild(adjustmentRow);
            
            // Event handling is done via delegation in setupEventListeners
            // No need to add individual listeners here
        });
    }
    
    updateNodeAdjustment(adjustmentKey, value) {
        if (!this.currentNode) return;
        
        // Initialize adjustments object if it doesn't exist
        if (!this.currentNode.adjustments) {
            this.currentNode.adjustments = {
                brightness: 0.0,
                contrast: 0.0,
                saturation: 0.0,
                hue: 0.0
            };
        }
        
        // Update the adjustment value with proper conversion
        if (adjustmentKey === 'brightness' || adjustmentKey === 'contrast' || adjustmentKey === 'saturation') {
            // Ensure value is within -1 to 1 range
            this.currentNode.adjustments[adjustmentKey] = Math.max(-1, Math.min(1, value));
        } else if (adjustmentKey === 'hue') {
            // Ensure hue is within -180 to 180 range
            this.currentNode.adjustments[adjustmentKey] = Math.max(-180, Math.min(180, value));
        }
        
        // Don't set needsGLUpdate for color adjustments - only for LUT changes
        // this.currentNode.needsGLUpdate = true;
        
        // Cancel previous redraw if pending
        if (this._adjustmentRedrawTimeout) {
            cancelAnimationFrame(this._adjustmentRedrawTimeout);
        }
        
        // Schedule redraw with requestAnimationFrame
        this._adjustmentRedrawTimeout = requestAnimationFrame(() => {
            if (window.app?.graphCanvas) {
                window.app.graphCanvas.dirty_canvas = true;
                window.app.graphCanvas.draw();
            }
        });
    }

    handleCurveChange(curveData) {
        if (!this.currentNode || this.isBypassed()) return;

        // Update the node's tone curve data
        this.updateNodeCurve(curveData);
    }

    updateNodeCurve(curveData = null) {
        if (!this.currentNode) return;

        // If bypassed, send null to disable curve
        if (this.isBypassed()) {
            curveData = null;
        } else if (!curveData && this.splineCurveEditor) {
            // Get curve data from editor if not provided
            curveData = this.splineCurveEditor.getCurveData();
        }

        // Update node
        if (this.currentNode.updateToneCurve) {
            this.currentNode.updateToneCurve(curveData);
        } else {
            // Fallback: store directly and trigger redraw
            this.currentNode.toneCurve = curveData;
            this.currentNode.needsGLUpdate = true;
            
            if (window.app?.graphCanvas) {
                requestAnimationFrame(() => {
                    window.app.graphCanvas.dirty_canvas = true;
                });
            }
        }
    }

    handleBypassToggle(bypassed) {
        if (!this.currentNode) return;
        
        const curveSection = this.panel.querySelector('.curve-section');
        const bypassToggle = this.panel.querySelector('[data-type="tone-curve"]');
        
        if (bypassed) {
            curveSection.classList.add('bypassed');
            if (bypassToggle) bypassToggle.classList.add('active');
        } else {
            curveSection.classList.remove('bypassed');
            if (bypassToggle) bypassToggle.classList.remove('active');
        }
        
        // Save bypass state with node
        this.currentNode.toneCurveBypassed = bypassed;
        
        // Update the node immediately
        this.updateNodeCurve();
    }

    isBypassed() {
        return this.currentNode && this.currentNode.toneCurveBypassed;
    }
    
    handleColorAdjustmentsBypass(bypassed) {
        if (!this.currentNode) return;
        
        this.currentNode.colorAdjustmentsBypassed = bypassed;
        
        // Update visual state
        const colorSection = this.panel.querySelector('.color-adjustments-section');
        const bypassToggle = this.panel.querySelector('[data-type="color-adjustments"]');
        
        if (colorSection) {
            if (bypassed) {
                colorSection.classList.add('bypassed');
                if (bypassToggle) bypassToggle.classList.add('active');
            } else {
                colorSection.classList.remove('bypassed');
                if (bypassToggle) bypassToggle.classList.remove('active');
            }
        }
        
        // Trigger redraw to apply/remove adjustments
        this.requestRedraw();
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
            this.saveState();
        }
    }

    hide() {
        if (this.isVisible) {
            this.isVisible = false;
            this.panel.classList.remove('visible');
            
            // Notify any listeners that visibility changed
            this.onVisibilityChange();
            this.saveState();
        }
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    setVisibilityCallback(callback) {
        this.visibilityCallback = callback;
    }
    
    onVisibilityChange() {
        if (this.visibilityCallback) {
            this.visibilityCallback(this.isVisible);
        }
    }
    
    destroy() {
        if (this.splineCurveEditor) {
            this.splineCurveEditor.destroy();
        }
        if (this.panel) {
            this.panel.remove();
        }
    }
    
    saveState() {
        try {
            localStorage.setItem('floating-color-correction-state', JSON.stringify({
                position: { x: this.position.x, y: this.position.y },
                visible: this.isVisible
            }));
        } catch (e) {
            console.error('Failed to save color correction state:', e);
        }
    }
    
    loadState() {
        try {
            const saved = localStorage.getItem('floating-color-correction-state');
            if (saved) {
                const state = JSON.parse(saved);
                
                // Restore position
                if (state.position) {
                    this.position.x = Math.max(0, Math.min(window.innerWidth - 320, state.position.x));
                    this.position.y = Math.max(0, Math.min(window.innerHeight - 400, state.position.y));
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
            console.error('Failed to load color correction state:', e);
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FloatingColorCorrection;
}

// Make FloatingColorCorrection available globally
if (typeof window !== 'undefined') {
    window.FloatingColorCorrection = FloatingColorCorrection;
}