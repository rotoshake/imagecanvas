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
        
        // Color balance panel
        this.colorBalancePanel = null;
        this.colorBalanceVisible = false;
        this.colorBalancePosition = null;
        
        // Undo interaction tracking
        this.toneCurveUndoStarted = false;
        this.adjustmentUndoStarted = false;
        this.colorBalanceUndoStarted = false;
        
        // Callback for when visibility changes
        this.visibilityCallback = null;
        
        this.createUI();
        this.setupEventListeners();
        this.updatePosition();
        
        // Setup canvas drag detection to allow drag operations to pass through
        this.setupCanvasDragDetection();
        
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
                padding: 4px 14px;
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
            
            /* Gradient backgrounds for different adjustment types */
            .adjustment-slider[data-adjustment="brightness"] {
                background: linear-gradient(to right, #000000, #ffffff);
            }
            
            .adjustment-slider[data-adjustment="contrast"] {
                background: linear-gradient(to right, #808080, #ffffff);
            }
            
            .adjustment-slider[data-adjustment="saturation"] {
                background: linear-gradient(to right, #808080,rgb(255, 0, 0));
            }
            
            .adjustment-slider[data-adjustment="hue"] {
                background: linear-gradient(to right, 
rgb(255, 48, 48) 0%, 
rgb(255, 255, 49) 16.66%, 
rgb(50, 255, 50) 33.33%, 
rgb(53, 255, 255) 50%, 
rgb(47, 47, 254) 66.66%, 
rgb(255, 57, 255) 83.33%, 
rgb(255, 50, 50) 100%);
            }
            
            .adjustment-slider[data-adjustment="temperature"] {
                background: linear-gradient(to right, 
                    #0066ff 0%, 
                    #99ccff 25%, 
                    #ffffff 50%, 
                    #ffcc00 75%, 
                    #ff6600 100%);
            }
            
            .adjustment-slider[data-adjustment="tint"] {
                background: linear-gradient(to right, #00ff00, #ff00ff);
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
            
            .color-balance-section {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-top: 1px solid #333;
                padding: 8px 0;
                margin-top: 8px;
            }
            
            .color-balance-section .section-header {
                width: 100%;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .curve-editor-container {
                width: 100%;
                aspect-ratio: 1;
                max-height: 225px;
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
                } else if (type === 'color-balance') {
                    this.handleColorBalanceBypass(!isActive);
                }
            }
        });

        contentEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('curve-reset-btn')) {
                if (this.splineCurveEditor && !this.isBypassed()) {
                    this.splineCurveEditor.reset();
                    this.updateNodeCurve();
                }
            } else if (e.target.classList.contains('color-balance-btn')) {
                this.showColorBalancePanel();
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
                this.updateNodeAdjustment(adjustmentKey, value, true); // intermediate update
            }
        });
        
        // Commit on mouse up (change event fires after mouse release)
        contentEl.addEventListener('change', (e) => {
            if (e.target.classList.contains('adjustment-slider')) {
                const adjustmentKey = e.target.dataset.adjustment;
                const value = parseFloat(e.target.value);
                this.updateNodeAdjustment(adjustmentKey, value, false); // final update
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
                this.updateNodeAdjustment(adjustmentKey, defaultValue, false); // commit reset
                
                // Update the displayed value
                const valueDisplay = e.target.parentElement.querySelector('.adjustment-value');
                if (valueDisplay) {
                    valueDisplay.textContent = adjustmentKey === 'hue' ? '0°' : '0.00';
                }
            }
        });
    }

    setupCanvasDragDetection() {
        // Track canvas drag state to allow drag operations to pass through panel
        let isCanvasDragging = false;
        let originalPointerEvents = null;
        
        // Listen for mousedown on canvas to detect start of canvas drag
        document.addEventListener('mousedown', (e) => {
            // Check if mousedown started on canvas (not on this panel)
            const canvas = this.canvas?.canvas;
            if (canvas && canvas.contains(e.target) && !this.panel.contains(e.target)) {
                // Canvas drag started - temporarily disable panel pointer events
                if (this.isVisible && !isCanvasDragging) {
                    isCanvasDragging = true;
                    originalPointerEvents = this.panel.style.pointerEvents;
                    this.panel.style.pointerEvents = 'none';
                }
            }
        }, true); // Use capture phase to catch early
        
        // Re-enable panel interaction on mouseup
        document.addEventListener('mouseup', () => {
            if (isCanvasDragging) {
                isCanvasDragging = false;
                if (this.isVisible) {
                    // Restore original pointer events or default to auto
                    this.panel.style.pointerEvents = originalPointerEvents || 'auto';
                }
            }
        }, true);
        
        // Also handle mouse leaving window during drag
        document.addEventListener('mouseleave', () => {
            if (isCanvasDragging) {
                isCanvasDragging = false;
                if (this.isVisible) {
                    this.panel.style.pointerEvents = originalPointerEvents || 'auto';
                }
            }
        });
        
        // Handle color balance panel if it exists
        const checkColorBalancePanel = () => {
            if (this.colorBalancePanel) {
                document.addEventListener('mousedown', (e) => {
                    const canvas = this.canvas?.canvas;
                    if (canvas && canvas.contains(e.target) && 
                        !this.panel.contains(e.target) && 
                        !this.colorBalancePanel.contains(e.target)) {
                        if (this.colorBalanceVisible && !isCanvasDragging) {
                            this.colorBalancePanel.style.pointerEvents = 'none';
                        }
                    }
                }, true);
                
                document.addEventListener('mouseup', () => {
                    if (this.colorBalanceVisible && isCanvasDragging) {
                        this.colorBalancePanel.style.pointerEvents = 'auto';
                    }
                }, true);
            }
        };
        
        // Check immediately and periodically for color balance panel
        checkColorBalancePanel();
        this.colorBalancePanelCheckInterval = setInterval(checkColorBalancePanel, 1000);
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
                onChange: (curveData, isIntermediate) => this.handleCurveChange(curveData, isIntermediate)
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
                const previousNode = this.currentNode;
                this.currentNode = node;
                
                // Set up undo/redo listeners for the new node
                this.setupUndoRedoListeners();
                
                // Always update UI - it will be smart about what to update
                this.updateUI();
                
                // Update color balance panel if it's open
                if (this.colorBalancePanel && this.colorBalanceVisible) {
                    this.updateColorBalancePanel();
                }
                
                // Check if color balance panel should be restored
                if (!previousNode) {
                    this.checkColorBalancePanelRestore();
                }
                return;
            }
        }
        
        this.currentNode = null;
        this.updateUI();
        
        // Update color balance panel to show no selection state instead of hiding
        if (this.colorBalancePanel && this.colorBalanceVisible) {
            this.updateColorBalancePanel();
        }
    }
    
    checkColorBalancePanelRestore() {
        if (!this.currentNode) return;
        
        try {
            const saved = localStorage.getItem('floating-color-balance-state');
            if (saved) {
                const state = JSON.parse(saved);
                if (state.visible && !this.colorBalancePanel) {
                    // Create and show the color balance panel
                    this.showColorBalancePanel();
                }
            }
        } catch (e) {
            // Silent fail
        }
    }
    
    setupUndoRedoListeners() {
        try {
            // Clean up previous listeners
            if (this._undoRedoListener) {
                if (window.app?.events?.off) {
                    window.app.events.off('undo_state_changed', this._undoRedoListener);
                }
                if (window.app?.networkLayer?.off) {
                    window.app.networkLayer.off('undo_success', this._undoRedoListener);
                    window.app.networkLayer.off('redo_success', this._undoRedoListener);
                }
            }
            
            // Set up new listener for undo/redo events using available event systems
            if (this.currentNode) {
                this._undoRedoListener = (data) => {
                    try {
                        // Refresh UI to match the node's current state after undo/redo
                        requestAnimationFrame(() => {
                            this.refreshUIFromNode();
                        });
                    } catch (error) {
                        console.error('Error in color correction undo listener:', error);
                    }
                };
                
                // Listen for undo state changes via app.events
                if (window.app?.events?.on) {
                    window.app.events.on('undo_state_changed', this._undoRedoListener);
                }
                
                // Also listen directly to network events for undo/redo success
                if (window.app?.networkLayer?.on) {
                    window.app.networkLayer.on('undo_success', this._undoRedoListener);
                    window.app.networkLayer.on('redo_success', this._undoRedoListener);
                }
            }
        } catch (error) {
            console.error('Error setting up color correction undo listeners:', error);
        }
    }
    
    refreshUIFromNode() {
        if (!this.currentNode) return;
        
        // Update adjustment sliders
        this.updateAdjustmentControlsFromNode();
        
        // Update curve editor
        if (this.splineCurveEditor) {
            if (this.currentNode.toneCurve && this.currentNode.toneCurve.controlPoints) {
                this.splineCurveEditor.loadCurve(this.currentNode.toneCurve);
            } else {
                this.splineCurveEditor.reset();
            }
        }
        
        // Update bypass toggle states
        this.updateBypassStatesFromNode();
        
        // Update color balance wheels
        if (this.colorBalancePanel && this.colorBalanceVisible) {
            this.updateColorBalancePanel();
        }
    }
    
    updateAdjustmentControlsFromNode() {
        if (!this.currentNode) return;
        
        const adjustmentContainer = this.panel.querySelector('.adjustment-controls');
        if (!adjustmentContainer) return;
        
        const sliders = adjustmentContainer.querySelectorAll('.adjustment-slider');
        sliders.forEach(slider => {
            const key = slider.dataset.adjustment;
            if (this.currentNode.adjustments && this.currentNode.adjustments[key] !== undefined) {
                let value = this.currentNode.adjustments[key];
                
                // Handle legacy value conversion
                if (key === 'hue') {
                    value = Math.max(-180, Math.min(180, value));
                } else if (Math.abs(value) > 1) {
                    value = value / 100; // Convert from percentage
                }
                
                slider.value = value;
                
                // Update the display value
                const valueDisplay = slider.parentElement.querySelector('.adjustment-value');
                if (valueDisplay) {
                    if (key === 'hue') {
                        valueDisplay.textContent = `${Math.round(value)}°`;
                    } else {
                        valueDisplay.textContent = value.toFixed(2);
                    }
                }
            }
        });
    }
    
    updateBypassStatesFromNode() {
        if (!this.currentNode) return;
        
        const toneCurveBypass = this.panel.querySelector('[data-type="tone-curve"]');
        const colorAdjustmentsBypass = this.panel.querySelector('[data-type="color-adjustments"]');
        const colorBalanceBypass = this.panel.querySelector('[data-type="color-balance"]');
        
        if (toneCurveBypass) {
            toneCurveBypass.classList.toggle('active', this.currentNode.toneCurveBypassed);
            const curveSection = this.panel.querySelector('.curve-section');
            if (curveSection) {
                curveSection.classList.toggle('bypassed', this.currentNode.toneCurveBypassed);
            }
        }
        
        if (colorAdjustmentsBypass) {
            colorAdjustmentsBypass.classList.toggle('active', this.currentNode.colorAdjustmentsBypassed);
            const colorSection = this.panel.querySelector('.color-adjustments-section');
            if (colorSection) {
                colorSection.classList.toggle('bypassed', this.currentNode.colorAdjustmentsBypassed);
            }
        }
        
        if (colorBalanceBypass) {
            colorBalanceBypass.classList.toggle('active', this.currentNode.colorBalanceBypassed);
        }
    }

    updateUI() {
        const contentEl = this.panel.querySelector('.color-correction-content');
        
        if (!this.currentNode) {
            contentEl.innerHTML = '<div class="no-selection-message">Select an image or video to adjust color correction</div>';
            this.splineCurveEditor = null; // Clear reference since content is gone
            return;
        }

        // Check if we already have content rendered
        const hasContent = contentEl.querySelector('.curve-section');
        
        if (!hasContent) {
            // First time showing content, render everything
            this.renderContent(contentEl);
        } else {
            // Content exists, just update the data
            // Ensure curve editor is initialized
            if (!this.splineCurveEditor) {
                this.initializeCurveEditor();
            }
            
            // Update spline curve editor
            if (this.splineCurveEditor) {
                if (this.currentNode.toneCurve && this.currentNode.toneCurve.controlPoints) {
                    this.splineCurveEditor.loadCurve(this.currentNode.toneCurve);
                } else {
                    this.splineCurveEditor.reset();
                }
            }
            
            // Update bypass toggle states and section visual states
            const toneCurveBypass = contentEl.querySelector('[data-type="tone-curve"]');
            const colorAdjustmentsBypass = contentEl.querySelector('[data-type="color-adjustments"]');
            const colorBalanceBypass = contentEl.querySelector('[data-type="color-balance"]');
            const curveSection = contentEl.querySelector('.curve-section');
            const colorAdjustmentsSection = contentEl.querySelector('.color-adjustments-section');
            const colorBalanceSection = contentEl.querySelector('.color-balance-section');
            
            if (toneCurveBypass) {
                toneCurveBypass.classList.toggle('active', this.currentNode.toneCurveBypassed);
            }
            if (curveSection) {
                curveSection.classList.toggle('bypassed', this.currentNode.toneCurveBypassed);
            }
            
            if (colorAdjustmentsBypass) {
                colorAdjustmentsBypass.classList.toggle('active', this.currentNode.colorAdjustmentsBypassed);
            }
            if (colorAdjustmentsSection) {
                colorAdjustmentsSection.classList.toggle('bypassed', this.currentNode.colorAdjustmentsBypassed);
            }
            
            if (colorBalanceBypass) {
                colorBalanceBypass.classList.toggle('active', this.currentNode.colorBalanceBypassed);
            }
            if (colorBalanceSection) {
                colorBalanceSection.classList.toggle('bypassed', this.currentNode.colorBalanceBypassed);
            }
            
            // Update adjustment sliders
            const adjustmentControls = contentEl.querySelector('.adjustment-controls');
            if (adjustmentControls) {
                this.updateAdjustmentControls(adjustmentControls);
            } else {
                // If adjustment controls don't exist, initialize them
                this.initializeColorAdjustments();
            }
        }
    }
    
    renderContent(container) {
        container.innerHTML = `
            <div class="curve-section ${this.currentNode.toneCurveBypassed ? 'bypassed' : ''}">
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
            <div class="color-balance-section ${this.currentNode.colorBalanceBypassed ? 'bypassed' : ''}">
                <div class="section-header">
                    <button class="curve-preset-btn color-balance-btn" title="Color Balance">Color Balance</button>
                    <div class="bypass-toggle ${this.currentNode.colorBalanceBypassed ? 'active' : ''}" data-type="color-balance" title="Bypass color balance"></div>
                </div>
            </div>
            <div class="color-adjustments-section ${this.currentNode.colorAdjustmentsBypassed ? 'bypassed' : ''}">
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
        
        // Initialize color adjustments
        this.initializeColorAdjustments();
    }
    
    updateAdjustmentControls(container) {
        // Update existing adjustment sliders without rebuilding
        const sliders = container.querySelectorAll('.adjustment-slider');
        sliders.forEach(slider => {
            const key = slider.dataset.adjustment;
            if (this.currentNode.adjustments && this.currentNode.adjustments[key] !== undefined) {
                let value = this.currentNode.adjustments[key];
                
                // Handle legacy value conversion
                if (key === 'hue') {
                    value = Math.max(-180, Math.min(180, value));
                } else if (Math.abs(value) > 1) {
                    value = value / 100; // Convert from percentage
                }
                
                slider.value = value;
                
                // Update the display value
                const valueDisplay = slider.parentElement.querySelector('.adjustment-value');
                if (valueDisplay) {
                    if (key === 'hue') {
                        valueDisplay.textContent = `${Math.round(value)}°`;
                    } else {
                        valueDisplay.textContent = value.toFixed(2);
                    }
                }
            }
        });
    }
    
    initializeColorAdjustments() {
        const adjustmentContainer = this.panel.querySelector('.adjustment-controls');
        if (!adjustmentContainer || !this.currentNode) return;
        
        // Define the adjustments with their ranges and defaults
        // TO ADD NEW ADJUSTMENTS:
        // 1. Add a new entry to this array with key, label, min, max, default, and step
        // 2. The adjustment will automatically be saved to the server and synced
        // 3. Update the WebGL shader in WebGLRenderer.js to use the new adjustment
        const adjustments = [
            { key: 'brightness', label: 'Brightness', min: -1, max: 1, default: 0, step: 0.01 },
            { key: 'contrast', label: 'Contrast', min: -1, max: 1, default: 0, step: 0.01 },
            { key: 'saturation', label: 'Saturation', min: -1, max: 1, default: 0, step: 0.01 },
            { key: 'hue', label: 'Hue', min: -180, max: 180, default: 0, step: 1 },
            { key: 'temperature', label: 'Temperature', min: -1, max: 1, default: 0, step: 0.01 },
            { key: 'tint', label: 'Tint', min: -1, max: 1, default: 0, step: 0.01 }
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
    
    updateNodeAdjustment(adjustmentKey, value, isIntermediate = true) {
        if (!this.currentNode) return;
        
        // Begin undo interaction on first intermediate change
        if (isIntermediate && !this.adjustmentUndoStarted) {
            this.beginAdjustmentUndo();
            this.adjustmentUndoStarted = true;
        }
        
        // Notify WebGLRenderer that adjustments are starting
        if (isIntermediate && window.app?.graphCanvas?.renderer?.startAdjustment) {
            window.app.graphCanvas.renderer.startAdjustment(this.currentNode.id);
        }
        
        // Initialize adjustments object if it doesn't exist
        if (!this.currentNode.adjustments) {
            this.currentNode.adjustments = {};
        }
        
        // Ensure all current adjustment keys exist with defaults
        const adjustmentDefaults = {
            brightness: 0.0,
            contrast: 0.0,
            saturation: 0.0,
            hue: 0.0,
            temperature: 0.0,
            tint: 0.0
        };
        
        // Apply defaults for any missing properties
        for (const [key, defaultValue] of Object.entries(adjustmentDefaults)) {
            if (this.currentNode.adjustments[key] === undefined) {
                this.currentNode.adjustments[key] = defaultValue;
            }
        }
        
        // Prepare the new adjustments object with the updated value
        const newAdjustments = { ...this.currentNode.adjustments };
        
        // Update the adjustment value with proper conversion
        if (adjustmentKey === 'brightness' || adjustmentKey === 'contrast' || 
            adjustmentKey === 'saturation' || adjustmentKey === 'temperature' || 
            adjustmentKey === 'tint') {
            // Ensure value is within -1 to 1 range
            newAdjustments[adjustmentKey] = Math.max(-1, Math.min(1, value));
        } else if (adjustmentKey === 'hue') {
            // Ensure hue is within -180 to 180 range
            newAdjustments[adjustmentKey] = Math.max(-180, Math.min(180, value));
        }
        
        // Simple direct update - just update the node locally
        this.currentNode.adjustments = newAdjustments;
        
        // For video nodes, update immediately
        if (this.currentNode.type === 'media/video' && this.currentNode.updateAdjustments) {
            this.currentNode.updateAdjustments(this.currentNode.adjustments);
        }
        
        // Invalidate WebGL cache and trigger redraw
        this.currentNode.needsGLUpdate = true;
        if (window.app?.graphCanvas) {
            window.app.graphCanvas.dirty_canvas = true;
        }
        
        // End undo interaction and save to server after final updates
        if (!isIntermediate && this.adjustmentUndoStarted) {
            this.endAdjustmentUndo();
            this.adjustmentUndoStarted = false;
            
            // Notify WebGLRenderer that adjustments are complete
            if (window.app?.graphCanvas?.renderer?.endAdjustment) {
                window.app.graphCanvas.renderer.endAdjustment(this.currentNode.id);
            }
        }
    }

    handleCurveChange(curveData, isIntermediate = true) {
        if (!this.currentNode || this.isBypassed()) return;

        if (isIntermediate) {
            // Intermediate change during dragging - begin undo interaction if not started
            if (!this.toneCurveUndoStarted) {
                this.beginToneCurveUndo();
                this.toneCurveUndoStarted = true;
            }
        } else {
            // Final change
            if (this.toneCurveUndoStarted) {
                // End ongoing drag interaction
                this.endToneCurveUndo();
                this.toneCurveUndoStarted = false;
            } else {
                // Immediate operation (add/remove point) - create single undo entry
                this.beginToneCurveUndo();
                // Update node first, then end interaction
                this.updateNodeCurve(curveData, isIntermediate);
                this.endToneCurveUndo();
                return; // Skip the second updateNodeCurve call
            }
        }

        // Update the node's tone curve data
        this.updateNodeCurve(curveData, isIntermediate);
    }

    updateNodeCurve(curveData = null, isIntermediate = true) {
        if (!this.currentNode) return;

        // Notify WebGLRenderer that adjustments are starting
        if (isIntermediate && window.app?.graphCanvas?.renderer?.startAdjustment) {
            window.app.graphCanvas.renderer.startAdjustment(this.currentNode.id);
        }

        // If bypassed, send null to disable curve
        if (this.isBypassed()) {
            curveData = null;
        } else if (!curveData && this.splineCurveEditor) {
            // Get curve data from editor if not provided
            curveData = this.splineCurveEditor.getCurveData();
        }

        // Simple direct update - just update the node locally
        this.currentNode.toneCurve = curveData;
        
        // Invalidate WebGL cache and trigger redraw
        this.currentNode.needsGLUpdate = true;
        if (window.app?.graphCanvas) {
            window.app.graphCanvas.dirty_canvas = true;
        }
        
        // Notify WebGLRenderer that adjustments are complete on final updates
        if (!isIntermediate) {
            if (window.app?.graphCanvas?.renderer?.endAdjustment) {
                window.app.graphCanvas.renderer.endAdjustment(this.currentNode.id);
            }
        }
    }

    beginToneCurveUndo() {
        if (window.app?.undoManager && this.currentNode) {
            window.app.undoManager.beginInteraction([this.currentNode]);
        }
    }

    endToneCurveUndo() {
        if (window.app?.undoManager && this.currentNode) {
            window.app.undoManager.endInteraction('node_property_update', {
                property: 'toneCurve',
                value: this.currentNode.toneCurve
            });
        }
    }

    beginAdjustmentUndo() {
        if (window.app?.undoManager && this.currentNode) {
            window.app.undoManager.beginInteraction([this.currentNode]);
        }
    }

    endAdjustmentUndo() {
        if (window.app?.undoManager && this.currentNode) {
            window.app.undoManager.endInteraction('node_property_update', {
                property: 'adjustments',
                value: this.currentNode.adjustments
            });
        }
    }

    beginColorBalanceUndo() {
        if (window.app?.undoManager && this.currentNode) {
            window.app.undoManager.beginInteraction([this.currentNode]);
        }
    }

    endColorBalanceUndo() {
        if (window.app?.undoManager && this.currentNode) {
            window.app.undoManager.endInteraction('node_property_update', {
                property: 'colorBalance',
                value: this.currentNode.colorBalance
            });
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
        
        // Use undo system for bypass toggle
        if (window.app?.undoManager) {
            window.app.undoManager.beginInteraction([this.currentNode]);
            window.app.undoManager.endInteraction('node_property_update', {
                property: 'toneCurveBypassed',
                value: bypassed
            });
        }
        
        // Trigger redraw to apply/remove tone curve
        this.requestRedraw();
    }

    isBypassed() {
        return this.currentNode && this.currentNode.toneCurveBypassed;
    }
    
    handleColorAdjustmentsBypass(bypassed) {
        if (!this.currentNode) return;
        
        // Update locally immediately
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
        
        // Use undo system for bypass toggle
        if (window.app?.undoManager) {
            window.app.undoManager.beginInteraction([this.currentNode]);
            window.app.undoManager.endInteraction('node_property_update', {
                property: 'colorAdjustmentsBypassed',
                value: bypassed
            });
        }
        
        // Trigger redraw to apply/remove adjustments
        this.requestRedraw();
    }
    
    handleColorBalanceBypass(bypassed) {
        if (!this.currentNode) return;
        
        // Update locally immediately
        this.currentNode.colorBalanceBypassed = bypassed;
        
        // Update visual state in main panel
        const bypassToggle = this.panel.querySelector('[data-type="color-balance"]');
        const colorBalanceSection = this.panel.querySelector('.color-balance-section');
        
        if (bypassToggle) {
            if (bypassed) {
                bypassToggle.classList.add('active');
            } else {
                bypassToggle.classList.remove('active');
            }
        }
        
        if (colorBalanceSection) {
            if (bypassed) {
                colorBalanceSection.classList.add('bypassed');
            } else {
                colorBalanceSection.classList.remove('bypassed');
            }
        }
        
        // Update color balance panel to reflect bypass state (always update if panel exists)
        if (this.colorBalancePanel) {
            this.updateColorBalancePanel();
        }
        
        // Use undo system for bypass toggle
        if (window.app?.undoManager) {
            window.app.undoManager.beginInteraction([this.currentNode]);
            window.app.undoManager.endInteraction('node_property_update', {
                property: 'colorBalanceBypassed',
                value: bypassed
            });
        }
        
        // Trigger redraw to apply/remove color balance
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
            
            // Also show color balance panel if it was visible before
            if (this.colorBalancePanel && this.colorBalanceVisible) {
                this.colorBalancePanel.style.display = 'flex';
                requestAnimationFrame(() => {
                    this.colorBalancePanel.classList.add('visible');
                });
            }
            
            // Notify any listeners that visibility changed
            this.onVisibilityChange();
            this.saveState();
        }
    }

    hide() {
        if (this.isVisible) {
            this.isVisible = false;
            this.panel.classList.remove('visible');
            
            // Also hide color balance panel if it's visible
            if (this.colorBalancePanel && this.colorBalancePanel.classList.contains('visible')) {
                this.colorBalancePanel.classList.remove('visible');
                setTimeout(() => {
                    this.colorBalancePanel.style.display = 'none';
                }, 200);
            }
            
            // Set display: none after transition to prevent interference with canvas drag operations
            setTimeout(() => {
                if (!this.isVisible) { // Only hide if still not visible
                    this.panel.style.display = 'none';
                }
            }, 200); // Match the CSS transition duration
            
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
    
    
    requestRedraw() {
        // Trigger canvas redraw AND invalidate WebGL caches
        if (this.currentNode) {
            this.currentNode.needsGLUpdate = true;
            
            // Also invalidate the cache directly if renderer is available
            if (window.app?.graphCanvas?.renderer?._invalidateCache) {
                window.app.graphCanvas.renderer._invalidateCache(this.currentNode.id);
            }
        }
        if (window.app?.graphCanvas) {
            window.app.graphCanvas.dirty_canvas = true;
        }
    }
    
    // Note: These methods have been removed and replaced with undo system integration
    // All color correction operations now use beginInteraction/endInteraction for proper undo support
    
    showColorBalancePanel() {
        if (!this.currentNode) {
            return;
        }
        
        // Create panel if it doesn't exist
        if (!this.colorBalancePanel) {
            this.createColorBalancePopup();
            // Load saved position
            this.loadColorBalanceState();
        }
        
        // Show the panel
        this.colorBalanceVisible = true;
        this.colorBalancePanel.style.display = 'flex';
        requestAnimationFrame(() => {
            this.colorBalancePanel.classList.add('visible');
        });
        
        // Apply bypassed state if needed
        if (this.currentNode.colorBalanceBypassed) {
            const content = this.colorBalancePanel.querySelector('.color-balance-content');
            if (content) {
                content.style.opacity = '0.5';
                content.style.pointerEvents = 'none';
            }
        }
        
        // Save state
        this.saveColorBalanceState();
    }
    
    createColorBalancePopup() {
        // Create floating panel (not overlay)
        this.colorBalancePanel = document.createElement('div');
        this.colorBalancePanel.className = 'floating-color-balance';
        this.colorBalancePanel.innerHTML = `
            <div class="color-balance-header">
                <div class="color-balance-title">Color Balance</div>
                <div class="color-balance-controls">
                    <button class="color-balance-close" title="Close">&times;</button>
                </div>
            </div>
            <div class="color-balance-content">
                <div class="color-balance-wheels-container">
                    <div class="color-balance-wheel-group">
                        <canvas id="colorBalanceShadows" width="160" height="160"></canvas>
                        <div class="color-balance-wheel-label">Shadows</div>
                        <div class="color-balance-values" id="shadowsValues">Y:0 R:0 G:0 B:0</div>
                    </div>
                    <div class="color-balance-wheel-group">
                        <canvas id="colorBalanceMidtones" width="160" height="160"></canvas>
                        <div class="color-balance-wheel-label">Midtones</div>
                        <div class="color-balance-values" id="midtonesValues">Y:0 R:0 G:0 B:0</div>
                    </div>
                    <div class="color-balance-wheel-group">
                        <canvas id="colorBalanceHighlights" width="160" height="160"></canvas>
                        <div class="color-balance-wheel-label">Highlights</div>
                        <div class="color-balance-values" id="highlightsValues">Y:0 R:0 G:0 B:0</div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(this.colorBalancePanel);
        
        // Initialize position
        this.colorBalancePosition = { x: window.innerWidth - 900, y: 100 };
        this.colorBalancePanel.style.left = `${this.colorBalancePosition.x}px`;
        this.colorBalancePanel.style.top = `${this.colorBalancePosition.y}px`;
        
        // Add styles
        this.addColorBalanceStyles();
        
        // Setup event handlers
        this.setupColorBalanceEvents();
        
        // Initialize color wheels
        this.initializeColorBalanceWheels();
    }
    
    addColorBalanceStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .floating-color-balance {
                position: fixed;
                background: #1e1e1e;
                border: 1px solid #333;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                z-index: 1000;
                font-family: ${FONT_CONFIG.APP_FONT};
                font-size: 12px;
                color: #e0e0e0;
                display: flex;
                flex-direction: column;
                user-select: none;
                opacity: 0;
                transform: scale(0.95);
                transition: opacity 0.2s ease, transform 0.2s ease;
                pointer-events: none;
            }
            
            .floating-color-balance.visible {
                opacity: 1;
                transform: scale(1);
                pointer-events: auto;
            }
            
            .color-balance-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 4px 14px;
                background: #2a2a2a;
                border-bottom: 1px solid #333;
                border-radius: 8px 8px 0 0;
                cursor: move;
            }
            
            .color-balance-title {
                font-weight: 600;
                font-size: 13px;
                color: #f0f0f0;
            }
            
            .color-balance-close {
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
            
            .color-balance-close:hover {
                background: #444;
                color: #fff;
            }
            
            .color-balance-content {
                padding: 12px;
            }
            
            .color-balance-wheels-container {
                display: flex;
                gap: 16px;
                justify-content: center;
            }
            
            .color-balance-wheel-group {
                text-align: center;
            }
            
            .color-balance-wheel-group canvas {
                display: block;
                cursor: crosshair;
            }
            
            .color-balance-wheel-label {
                margin-top: 6px;
                font-size: 10px;
                /* text-transform: uppercase; */
                color: #888;
                font-weight: 400;
                letter-spacing: 0.3px;
            }
            
            .color-balance-values {
                margin-top: 4px;
                font-size: 9px;
                color: #666;
                font-family: monospace;
                letter-spacing: 0.5px;
            }
            
            .color-balance-button-controls {
                display: flex;
                justify-content: center;
                gap: 8px;
                margin-top: 12px;
            }
            
            .color-balance-reset-btn {
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
            
            .color-balance-reset-btn:hover {
                background: #333;
                border-color: #555;
            }
            
            .color-balance-reset-btn:active {
                background: #222;
            }
        `;
        document.head.appendChild(style);
    }
    
    setupColorBalanceEvents() {
        const closeBtn = this.colorBalancePanel.querySelector('.color-balance-close');
        const header = this.colorBalancePanel.querySelector('.color-balance-header');
        
        // Close button
        closeBtn.addEventListener('click', () => {
            this.hideColorBalancePanel();
        });
        
        // Make panel draggable
        this.makeColorBalanceDraggable(header);
    }
    
    makeColorBalanceDraggable(handle) {
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        handle.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = this.colorBalancePanel.offsetLeft;
            startTop = this.colorBalancePanel.offsetTop;
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        });

        const onMouseMove = (e) => {
            if (!isDragging) return;
            
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            
            this.colorBalancePosition.x = Math.max(0, Math.min(window.innerWidth - this.colorBalancePanel.offsetWidth, startLeft + dx));
            this.colorBalancePosition.y = Math.max(0, Math.min(window.innerHeight - this.colorBalancePanel.offsetHeight, startTop + dy));
            
            this.colorBalancePanel.style.left = `${this.colorBalancePosition.x}px`;
            this.colorBalancePanel.style.top = `${this.colorBalancePosition.y}px`;
        };

        const onMouseUp = () => {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            
            // Save position to localStorage
            this.saveColorBalanceState();
        };
    }
    
    updateColorBalancePanel() {
        if (!this.colorBalancePanel) return;
        
        // Handle no selection case - disable wheels but keep panel visible
        if (!this.currentNode) {
            if (this.shadowsWheel && this.midtonesWheel && this.highlightsWheel) {
                // Reset wheels to neutral position
                this.shadowsWheel.setValue(0, 0, 0.5);
                this.midtonesWheel.setValue(0, 0, 0.5);
                this.highlightsWheel.setValue(0, 0, 0.5);
                
                // Update displays to show neutral values
                this.updateYRGBDisplay('shadows', { x: 0, y: 0, luminance: 0.5 });
                this.updateYRGBDisplay('midtones', { x: 0, y: 0, luminance: 0.5 });
                this.updateYRGBDisplay('highlights', { x: 0, y: 0, luminance: 0.5 });
                
                // Disable interaction (add opacity and disable pointer events)
                const content = this.colorBalancePanel.querySelector('.color-balance-content');
                if (content) {
                    content.style.opacity = '0.5';
                    content.style.pointerEvents = 'none';
                }
            }
            return;
        }
        
        // Initialize or get existing color balance data
        if (!this.currentNode.colorBalance) {
            this.currentNode.colorBalance = {
                shadows: { x: 0, y: 0, luminance: 0.5 },
                midtones: { x: 0, y: 0, luminance: 0.5 },
                highlights: { x: 0, y: 0, luminance: 0.5 }
            };
        }
        
        // Update wheel values if they exist
        if (this.shadowsWheel && this.midtonesWheel && this.highlightsWheel) {
            const cb = this.currentNode.colorBalance;
            this.shadowsWheel.setValue(cb.shadows.x, cb.shadows.y, cb.shadows.luminance);
            this.midtonesWheel.setValue(cb.midtones.x, cb.midtones.y, cb.midtones.luminance);
            this.highlightsWheel.setValue(cb.highlights.x, cb.highlights.y, cb.highlights.luminance);
            
            // Update YRGB displays
            this.updateYRGBDisplay('shadows', cb.shadows);
            this.updateYRGBDisplay('midtones', cb.midtones);
            this.updateYRGBDisplay('highlights', cb.highlights);
        }
        
        // Handle bypass state - disable/enable interaction based on bypass
        const content = this.colorBalancePanel.querySelector('.color-balance-content');
        if (content) {
            if (this.currentNode.colorBalanceBypassed) {
                content.style.opacity = '0.5';
                content.style.pointerEvents = 'none';
            } else {
                content.style.opacity = '1';
                content.style.pointerEvents = 'auto';
            }
        }
    }
    
    initializeColorBalanceWheels() {
        if (!window.ColorBalanceWheel) {
            console.error('ColorBalanceWheel not loaded');
            return;
        }
        
        // Initialize or get existing color balance data
        if (!this.currentNode.colorBalance) {
            this.currentNode.colorBalance = {
                shadows: { x: 0, y: 0, luminance: 0.5 },
                midtones: { x: 0, y: 0, luminance: 0.5 },
                highlights: { x: 0, y: 0, luminance: 0.5 }
            };
        }
        
        // Check if bypassed and apply disabled state
        if (this.currentNode.colorBalanceBypassed) {
            const content = this.colorBalancePanel.querySelector('.color-balance-content');
            if (content) {
                content.style.opacity = '0.5';
                content.style.pointerEvents = 'none';
            }
        }
        
        // Create wheel instances
        const shadowsCanvas = this.colorBalancePanel.querySelector('#colorBalanceShadows');
        const midtonesCanvas = this.colorBalancePanel.querySelector('#colorBalanceMidtones');
        const highlightsCanvas = this.colorBalancePanel.querySelector('#colorBalanceHighlights');
        
        if (shadowsCanvas && midtonesCanvas && highlightsCanvas) {
            this.shadowsWheel = new window.ColorBalanceWheel(shadowsCanvas, 'shadows', 
                (value) => {
                    if (this.currentNode) {
                        this.currentNode.colorBalance.shadows = value;
                        this.updateColorBalance();
                        this.updateYRGBDisplay('shadows', value);
                    }
                },
                () => {
                    // onChangeEnd - save to server
                    if (this.currentNode) {
                        this.updateColorBalance(true);
                    }
                }
            );
            
            this.midtonesWheel = new window.ColorBalanceWheel(midtonesCanvas, 'midtones', 
                (value) => {
                    if (this.currentNode) {
                        this.currentNode.colorBalance.midtones = value;
                        this.updateColorBalance();
                        this.updateYRGBDisplay('midtones', value);
                    }
                },
                () => {
                    // onChangeEnd - save to server
                    if (this.currentNode) {
                        this.updateColorBalance(true);
                    }
                }
            );
            
            this.highlightsWheel = new window.ColorBalanceWheel(highlightsCanvas, 'highlights', 
                (value) => {
                    if (this.currentNode) {
                        this.currentNode.colorBalance.highlights = value;
                        this.updateColorBalance();
                        this.updateYRGBDisplay('highlights', value);
                    }
                },
                () => {
                    // onChangeEnd - save to server
                    if (this.currentNode) {
                        this.updateColorBalance(true);
                    }
                }
            );
            
            // Load current values
            const cb = this.currentNode.colorBalance;
            this.shadowsWheel.setValue(cb.shadows.x, cb.shadows.y, cb.shadows.luminance);
            this.midtonesWheel.setValue(cb.midtones.x, cb.midtones.y, cb.midtones.luminance);
            this.highlightsWheel.setValue(cb.highlights.x, cb.highlights.y, cb.highlights.luminance);
            
            // Update initial YRGB displays
            this.updateYRGBDisplay('shadows', cb.shadows);
            this.updateYRGBDisplay('midtones', cb.midtones);
            this.updateYRGBDisplay('highlights', cb.highlights);
        }
    }
    
    updateYRGBDisplay(range, value) {
        const element = document.getElementById(`${range}Values`);
        if (!element) {
            return;
        }
        
        const x = value.x || 0;
        const y = value.y || 0;
        const lum = value.luminance || 0.5;
        
        // Use the same wheelToRGB function as the shader (NTSC vectorscope)
        function wheelToRGB(x, y) {
            const distance = Math.sqrt(x * x + y * y);
            if (distance === 0) return [0, 0, 0];
            
            // Match the WebGLRenderer._wheelToRGB implementation
            const canvasAngle = Math.atan2(y, x) * 180 / Math.PI;
            let vectorscopeAngle = (90 - canvasAngle) % 360;
            if (vectorscopeAngle < 0) vectorscopeAngle += 360;
            
            // Use YUV to RGB conversion exactly as the GUI does
            const angleRad = vectorscopeAngle * Math.PI / 180;
            const U = Math.sin(angleRad) * 0.5;
            const V = -Math.cos(angleRad) * 0.5; // Note the negative, same as GUI
            
            // YUV to RGB conversion (ITU-R BT.601)
            const Y = 0.5; // Middle gray as base
            let R = Y + 1.14 * V;
            let G = Y - 0.395 * U - 0.581 * V;
            let B = Y + 2.032 * U;
            
            // Clamp to valid range
            R = Math.max(0, Math.min(1, R));
            G = Math.max(0, Math.min(1, G));
            B = Math.max(0, Math.min(1, B));
            
            // Convert to offset from neutral (0.5) and scale by distance
            return [
                (R - 0.5) * distance,
                (G - 0.5) * distance,
                (B - 0.5) * distance
            ];
        }
        
        // Calculate RGB values based on wheel position
        let rgb = wheelToRGB(x, y);
        
        // Format values for display
        const lumOffset = Math.round((lum - 0.5) * 100);
        let r = Math.round(rgb[0] * 100);
        let g = Math.round(rgb[1] * 100);
        let b = Math.round(rgb[2] * 100);
        
        // No special handling needed for midtones display
        // The values should match what the user sees on the wheel
        
        // Add + prefix for positive values
        const lumStr = lumOffset > 0 ? `+${lumOffset}` : `${lumOffset}`;
        const rStr = r > 0 ? `+${r}` : `${r}`;
        const gStr = g > 0 ? `+${g}` : `${g}`;
        const bStr = b > 0 ? `+${b}` : `${b}`;
        
        // Debug: Add indicator to see if midtones inversion is working
        // const prefix = range === 'midtones' ? '[M] ' : '';
        const prefix = '';
        element.textContent = `${prefix}Y:${lumStr} R:${rStr} G:${gStr} B:${bStr}`;
    }
    
    updateColorBalance(isFinal = false) {
        if (!this.currentNode || !this.currentNode.colorBalance) {
            return;
        }
        
        // Begin undo interaction on first intermediate change
        if (!isFinal && !this.colorBalanceUndoStarted) {
            this.beginColorBalanceUndo();
            this.colorBalanceUndoStarted = true;
        }
        
        // Notify WebGLRenderer of active adjustments and invalidate cache
        if (window.app?.graphCanvas?.renderer?.startAdjustment) {
            window.app.graphCanvas.renderer.startAdjustment(this.currentNode.id);
        }
        
        // Invalidate WebGL cache and trigger redraw
        this.currentNode.needsGLUpdate = true;
        if (window.app?.graphCanvas) {
            window.app.graphCanvas.dirty_canvas = true;
        }
        
        // End undo interaction and save to server on final update
        if (isFinal && this.colorBalanceUndoStarted) {
            this.endColorBalanceUndo();
            this.colorBalanceUndoStarted = false;
            
            // Notify WebGLRenderer that adjustments are complete
            if (window.app?.graphCanvas?.renderer?.endAdjustment) {
                window.app.graphCanvas.renderer.endAdjustment(this.currentNode.id);
            }
        }
    }
    
    hideColorBalancePanel() {
        if (this.colorBalancePanel) {
            this.colorBalanceVisible = false;
            this.colorBalancePanel.classList.remove('visible');
            setTimeout(() => {
                this.colorBalancePanel.style.display = 'none';
            }, 200);
            
            // Save final values
            this.updateColorBalance(true);
            this.saveColorBalanceState();
        }
    }
    
    saveColorBalanceState() {
        try {
            localStorage.setItem('floating-color-balance-state', JSON.stringify({
                position: this.colorBalancePosition,
                visible: this.colorBalanceVisible
            }));
        } catch (e) {
            console.error('Failed to save color balance state:', e);
        }
    }
    
    loadColorBalanceState() {
        try {
            const saved = localStorage.getItem('floating-color-balance-state');
            if (saved) {
                const state = JSON.parse(saved);
                
                // Restore position
                if (state.position) {
                    this.colorBalancePosition.x = Math.max(0, Math.min(window.innerWidth - 600, state.position.x));
                    this.colorBalancePosition.y = Math.max(0, Math.min(window.innerHeight - 300, state.position.y));
                    this.colorBalancePanel.style.left = `${this.colorBalancePosition.x}px`;
                    this.colorBalancePanel.style.top = `${this.colorBalancePosition.y}px`;
                }
                
                // Restore visibility state
                if (state.visible && this.currentNode) {
                    this.colorBalanceVisible = true;
                    this.colorBalancePanel.style.display = 'flex';
                    requestAnimationFrame(() => {
                        this.colorBalancePanel.classList.add('visible');
                    });
                }
            }
        } catch (e) {
            console.error('Failed to load color balance state:', e);
        }
    }
    
    destroy() {
        // Clear color balance panel check interval
        if (this.colorBalancePanelCheckInterval) {
            clearInterval(this.colorBalancePanelCheckInterval);
            this.colorBalancePanelCheckInterval = null;
        }
        
        // Clean up undo/redo listeners
        if (this._undoRedoListener) {
            if (window.app?.events?.off) {
                window.app.events.off('undo_state_changed', this._undoRedoListener);
            }
            if (window.app?.networkLayer?.off) {
                window.app.networkLayer.off('undo_success', this._undoRedoListener);
                window.app.networkLayer.off('redo_success', this._undoRedoListener);
            }
        }
        
        if (this.splineCurveEditor) {
            this.splineCurveEditor.destroy();
        }
        if (this.colorBalancePanel) {
            this.colorBalancePanel.remove();
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