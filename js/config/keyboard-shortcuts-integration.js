// ===================================
// KEYBOARD SHORTCUTS INTEGRATION
// ===================================

// This file shows how to integrate the keyboard shortcuts config with the existing system

// Example: Replace hardcoded shortcuts in canvas.js handleKeyboardShortcut method
class KeyboardShortcutManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.customShortcuts = {};
        this.enabled = true;
        
        // Load custom shortcuts from localStorage if available
        this.loadCustomShortcuts();
    }
    
    // Override a default shortcut
    setCustomShortcut(category, action, newKeys, newModifiers) {
        if (!this.customShortcuts[category]) {
            this.customShortcuts[category] = {};
        }
        
        this.customShortcuts[category][action] = {
            keys: newKeys,
            modifiers: newModifiers || []
        };
        
        this.saveCustomShortcuts();
    }
    
    // Reset a shortcut to default
    resetShortcut(category, action) {
        if (this.customShortcuts[category]) {
            delete this.customShortcuts[category][action];
            if (Object.keys(this.customShortcuts[category]).length === 0) {
                delete this.customShortcuts[category];
            }
        }
        this.saveCustomShortcuts();
    }
    
    // Get the active shortcut (custom or default)
    getShortcut(category, action) {
        if (this.customShortcuts[category]?.[action]) {
            return {
                ...KEYBOARD_SHORTCUTS[category][action],
                ...this.customShortcuts[category][action]
            };
        }
        return KEYBOARD_SHORTCUTS[category][action];
    }
    
    // Save custom shortcuts to localStorage
    saveCustomShortcuts() {
        localStorage.setItem('imagecanvas_custom_shortcuts', JSON.stringify(this.customShortcuts));
    }
    
    // Load custom shortcuts from localStorage
    loadCustomShortcuts() {
        const saved = localStorage.getItem('imagecanvas_custom_shortcuts');
        if (saved) {
            try {
                this.customShortcuts = JSON.parse(saved);
            } catch (e) {
                console.error('Failed to load custom shortcuts:', e);
                this.customShortcuts = {};
            }
        }
    }
    
    // Handle a keyboard event
    handleKeyEvent(event) {
        if (!this.enabled) return false;
        
        // Don't handle shortcuts when typing in input fields
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
            return false;
        }
        
        // Check gallery mode first
        if (this.canvas.galleryViewManager?.active) {
            return this.handleGalleryShortcut(event);
        }
        
        // Find matching shortcut
        const match = this.findMatchingShortcut(event);
        
        // Debug logging for copy/paste/undo
        if (event.key === 'c' || event.key === 'v' || event.key === 'z') {
            console.log(`🔍 Key pressed: ${event.key}, Ctrl: ${event.ctrlKey}, Meta: ${event.metaKey}, Match: ${match ? match.name : 'none'}`);
        }
        
        if (!match) return false;
        
        // Execute the corresponding action
        return this.executeShortcut(match.category, match.name, event);
    }
    
    // Find which shortcut matches the event (considering custom shortcuts)
    findMatchingShortcut(event) {
        // Check if globals are available
        if (!window.KEYBOARD_SHORTCUTS || !window.matchesShortcut) {
            console.error('❌ Keyboard shortcuts not loaded properly');
            return null;
        }
        
        // Check each category
        for (const [categoryName, category] of Object.entries(KEYBOARD_SHORTCUTS)) {
            // Skip gallery shortcuts if not in gallery mode
            if (categoryName === 'GALLERY' && !this.canvas.galleryViewManager?.active) {
                continue;
            }
            
            for (const [actionName, defaultShortcut] of Object.entries(category)) {
                const shortcut = this.getShortcut(categoryName, actionName);
                if (matchesShortcut(event, shortcut)) {
                    return {
                        category: categoryName,
                        name: actionName,
                        shortcut
                    };
                }
            }
        }
        return null;
    }
    
    // Execute a shortcut action
    executeShortcut(category, action, event) {
        const canvas = this.canvas;
        
        // console.log(`🎯 Executing shortcut - Category: ${category}, Action: ${action}`);
        
        switch (category) {
            case 'NAVIGATION':
                return this.executeNavigationShortcut(action, event);
            case 'SELECTION':
                return this.executeSelectionShortcut(action, event);
            case 'NODE_OPERATIONS':
                return this.executeNodeOperationShortcut(action, event);
            case 'CLIPBOARD':
                return this.executeClipboardShortcut(action, event);
            case 'LAYERS':
                return this.executeLayerShortcut(action, event);
            case 'FILE':
                return this.executeFileShortcut(action, event);
            case 'HISTORY':
                return this.executeHistoryShortcut(action, event);
            case 'PANELS':
                return this.executePanelShortcut(action, event);
            case 'ALIGNMENT':
                return this.executeAlignmentShortcut(action, event);
            case 'TEXT_EDITING':
                return this.executeTextEditingShortcut(action, event);
            case 'DEBUG':
                return this.executeDebugShortcut(action, event);
            case 'ARROW_NAV':
                return this.executeArrowNavShortcut(action, event);
        }
        
        return false;
    }
    
    // Navigation shortcuts
    executeNavigationShortcut(action, event) {
        const canvas = this.canvas;
        
        switch (action) {
            case 'ZOOM_IN':
                canvas.keyboardZoom(2.0);
                return true;
            case 'ZOOM_OUT':
                canvas.keyboardZoom(0.5);
                return true;
            case 'FIT_VIEW':
                canvas.zoomToFit();
                return true;
            case 'RESET_VIEW':
                canvas.resetView();
                return true;
        }
        return false;
    }
    
    // Selection shortcuts
    executeSelectionShortcut(action, event) {
        const canvas = this.canvas;
        
        switch (action) {
            case 'SELECT_ALL':
                canvas.selectAll();
                return true;
            case 'GRID_ALIGN':
                // Grid align is handled in mouse events, not keyboard events
                // This is here for completeness but won't be called from keyboard
                return false;
        }
        return false;
    }
    
    // Node operation shortcuts
    executeNodeOperationShortcut(action, event) {
        const canvas = this.canvas;
        
        switch (action) {
            case 'DUPLICATE':
                canvas.duplicateSelected();
                return true;
            case 'DELETE':
                canvas.deleteSelected();
                return true;
            case 'GROUP_CREATE':
                canvas.createGroupFromSelected();
                return true;
            case 'TEXT_NODE':
                canvas.createTextNodeAt(canvas.mouseState.graph);
                return true;
            case 'SHAPE_NODE':
                if (window.app?.nodeCreationMenu) {
                    window.app.nodeCreationMenu.createNodeAtCenter('shape');
                }
                return true;
        }
        return false;
    }
    
    // Clipboard shortcuts
    executeClipboardShortcut(action, event) {
        const canvas = this.canvas;
        
        console.log(`📋 Executing clipboard action: ${action}`);
        
        switch (action) {
            case 'COPY':
                console.log('📋 Calling copySelected()');
                canvas.copySelected();
                return true;
            case 'CUT':
                console.log('✂️ Calling cutSelected()');
                canvas.cutSelected();
                return true;
            case 'PASTE':
                console.log('📋 Calling paste()');
                canvas.paste();
                return true;
        }
        return false;
    }
    
    // Layer shortcuts
    executeLayerShortcut(action, event) {
        const canvas = this.canvas;
        
        switch (action) {
            case 'MOVE_UP':
                canvas.moveSelectedUp();
                return true;
            case 'MOVE_DOWN':
                canvas.moveSelectedDown();
                return true;
            case 'BRING_TO_FRONT':
                canvas.bringSelectedToFront();
                return true;
            case 'SEND_TO_BACK':
                canvas.sendSelectedToBack();
                return true;
        }
        return false;
    }
    
    // File shortcuts
    executeFileShortcut(action, event) {
        const canvas = this.canvas;
        
        switch (action) {
            case 'SAVE':
                if (window.canvasNavigator && !window.canvasNavigator.currentCanvasId && canvas.graph.nodes.length > 0) {
                    const timestamp = new Date().toLocaleString();
                    window.canvasNavigator.saveAsNewCanvas(`Untitled Canvas - ${timestamp}`, true);
                    if (canvas.showNotification) {
                        canvas.showNotification({
                            type: 'success',
                            message: 'Canvas created and saved'
                        });
                    }
                } else if (canvas.collaborativeManager && canvas.collaborativeManager.save) {
                    canvas.collaborativeManager.save();
                } else {
                    canvas.stateManager.saveState();
                }
                return true;
            case 'SYNC':
                if (window.app?.stateSyncManager?.network) {
                    console.log('🔄 Manual sync triggered with R key');
                    if (window.unifiedNotifications) {
                        window.unifiedNotifications.info('Syncing with server...', {
                            id: 'manual-sync',
                            duration: 2000
                        });
                    }
                    window.app.stateSyncManager.requestFullSync(true);
                } else {
                    console.log('⚠️ Cannot sync - no network connection');
                    if (window.unifiedNotifications) {
                        window.unifiedNotifications.warning('Cannot sync - not connected to server', {
                            duration: 3000
                        });
                    }
                }
                return true;
            case 'OPEN_NAVIGATOR':
                if (window.canvasNavigator) {
                    window.canvasNavigator.toggle();
                }
                return true;
        }
        return false;
    }
    
    // History shortcuts
    executeHistoryShortcut(action, event) {
        const undoManager = window.app?.undoManager;
        if (!undoManager) return false;
        
        switch (action) {
            case 'UNDO':
                undoManager.undo();
                return true;
            case 'REDO':
            case 'REDO_ALT':
                undoManager.redo();
                return true;
        }
        return false;
    }
    
    // Panel shortcuts
    executePanelShortcut(action, event) {
        switch (action) {
            case 'PROPERTIES':
                if (window.propertiesInspector) {
                    window.propertiesInspector.toggle();
                }
                return true;
            case 'COLOR_CORRECTION':
                if (window.colorCorrectionPanel) {
                    window.colorCorrectionPanel.toggle();
                }
                return true;
            case 'USER_PROFILE':
                if (window.app?.userProfilePanel) {
                    window.app.userProfilePanel.toggle();
                }
                return true;
            case 'TOGGLE_TITLES':
                this.canvas.toggleTitleVisibility();
                return true;
        }
        return false;
    }
    
    // Alignment shortcuts
    executeAlignmentShortcut(action, event) {
        const canvas = this.canvas;
        
        switch (action) {
            case 'ALIGN_HORIZONTAL':
                canvas.alignSelected('horizontal');
                return true;
            case 'ALIGN_VERTICAL':
                canvas.alignSelected('vertical');
                return true;
        }
        return false;
    }
    
    // Text editing shortcuts
    executeTextEditingShortcut(action, event) {
        const canvas = this.canvas;
        
        switch (action) {
            case 'FINISH_EDIT':
                if (canvas.isEditingText()) {
                    canvas.finishTextEditing();
                }
                return true;
            case 'CANCEL_EDIT':
                if (canvas.isEditingText()) {
                    canvas.cancelTextEditing();
                }
                return true;
        }
        return false;
    }
    
    // Debug shortcuts
    executeDebugShortcut(action, event) {
        const canvas = this.canvas;
        
        switch (action) {
            case 'FPS_TEST':
                console.log('🧪 FPS Test Menu triggered');
                canvas.showFPSTestMenu();
                return true;
            case 'DATABASE_WIPE':
                // Trigger the database wipe function if it exists
                if (window.triggerDatabaseWipe) {
                    window.triggerDatabaseWipe();
                } else {
                    console.warn('Database wipe functionality not available');
                }
                return true;
        }
        return false;
    }
    
    // Arrow navigation shortcuts
    executeArrowNavShortcut(action, event) {
        const canvas = this.canvas;
        
        if (!CONFIG.NAVIGATION.ARROW_KEY_ENABLED) return false;
        
        const directionMap = {
            'UP': 'up',
            'DOWN': 'down',
            'LEFT': 'left',
            'RIGHT': 'right'
        };
        
        const direction = directionMap[action];
        if (direction) {
            const selectedNodes = canvas.selection.getSelectedNodes();
            let fromNode = null;
            
            if (selectedNodes.length > 0) {
                // Use the first selected node as reference
                fromNode = selectedNodes[0];
            } else {
                // No nodes selected - start with the node closest to viewport center
                fromNode = canvas.findNodeClosestToViewportCenter();
                if (fromNode) {
                    // Select this node first
                    canvas.selection.selectNode(fromNode, true);
                    canvas.navigateToNode(fromNode);
                    return true;
                }
            }
            
            if (fromNode) {
                const targetNode = canvas.findNodeInDirection(fromNode, direction);
                
                if (targetNode) {
                    // Clear current selection
                    canvas.selection.clear();
                    // Select the target node
                    canvas.selection.selectNode(targetNode, true);
                    // Navigate to it with animation
                    canvas.navigateToNode(targetNode);
                }
            }
            return true;
        }
        
        return false;
    }
    
    // Gallery mode shortcuts
    handleGalleryShortcut(event) {
        const gallery = this.canvas.galleryViewManager;
        const shortcut = this.findMatchingShortcut(event);
        
        if (!shortcut) return false;
        
        // Handle GALLERY-specific shortcuts
        if (shortcut.category === 'GALLERY') {
            switch (shortcut.name) {
                case 'NEXT':
                    gallery.next();
                    return true;
                case 'PREVIOUS':
                    gallery.previous();
                    return true;
                case 'EXIT':
                    gallery.exit();
                    return true;
            }
        }
        
        // Allow certain NAVIGATION shortcuts in gallery mode
        if (shortcut.category === 'NAVIGATION') {
            switch (shortcut.name) {
                case 'PAN':
                    // Don't handle the PAN shortcut here - let it fall through to normal canvas handling
                    // The Space key itself doesn't do anything, it's the Space+drag that matters
                    return false;
                case 'ZOOM_IN':
                    this.canvas.keyboardZoom(2.0);
                    return true;
                case 'ZOOM_OUT':
                    this.canvas.keyboardZoom(0.5);
                    return true;
                case 'FIT_VIEW':
                    this.canvas.zoomToFit();
                    return true;
                case 'RESET_VIEW':
                    this.canvas.resetView();
                    return true;
            }
        }
        
        // Allow certain PANELS shortcuts in gallery mode
        if (shortcut.category === 'PANELS') {
            switch (shortcut.name) {
                case 'PROPERTIES':
                    if (window.propertiesInspector) {
                        window.propertiesInspector.toggle();
                    }
                    return true;
                case 'COLOR_CORRECTION':
                    if (window.colorCorrectionPanel) {
                        window.colorCorrectionPanel.toggle();
                    }
                    return true;
            }
        }
        
        return false;
    }
    
    // Get all shortcuts as a formatted list (for help display)
    getAllShortcuts() {
        const shortcuts = [];
        
        for (const [categoryName, category] of Object.entries(KEYBOARD_SHORTCUTS)) {
            const categoryShortcuts = [];
            
            for (const [actionName, defaultShortcut] of Object.entries(category)) {
                const shortcut = this.getShortcut(categoryName, actionName);
                categoryShortcuts.push({
                    action: actionName,
                    description: shortcut.description,
                    keys: getShortcutString(shortcut),
                    isCustom: !!this.customShortcuts[categoryName]?.[actionName]
                });
            }
            
            shortcuts.push({
                category: categoryName,
                shortcuts: categoryShortcuts
            });
        }
        
        return shortcuts;
    }
    
    // Display help dialog
    showHelp() {
        const shortcuts = this.getAllShortcuts();
        
        // Create help dialog HTML
        let html = '<div class="keyboard-shortcuts-help">';
        
        for (const category of shortcuts) {
            html += `<div class="shortcut-category">`;
            html += `<h3>${category.category.replace(/_/g, ' ')}</h3>`;
            html += '<table>';
            
            for (const shortcut of category.shortcuts) {
                html += '<tr>';
                html += `<td class="shortcut-keys">${shortcut.keys}${shortcut.isCustom ? ' *' : ''}</td>`;
                html += `<td class="shortcut-description">${shortcut.description}</td>`;
                html += '</tr>';
            }
            
            html += '</table>';
            html += '</div>';
        }
        
        html += '<p class="shortcut-note">* Custom shortcut</p>';
        html += '</div>';
        
        // You would display this in a modal or panel
        console.log('Keyboard Shortcuts:', this.getAllShortcuts());
        return html;
    }
}

// Export for use
window.KeyboardShortcutManager = KeyboardShortcutManager;