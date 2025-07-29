// Canvas Navigator UI Component
// Provides a panel for managing canvases/projects

class CanvasNavigator {
    constructor(app) {
        this.app = app;
        // Don't set collaborativeManager here - it's not ready yet
        this.isOpen = false;
        this.canvases = [];
        this.currentCanvasId = null;
        
        // Generate a unique user ID for this session
        // This will be consistent across tabs in the same browser session
        this.userId = this.getOrCreateUserId();
        
        this.createUI();
        this.setupEventListeners();
    }
    
    /**
     * Get or create a user ID for this browser session
     */
    getOrCreateUserId() {
        let userId = localStorage.getItem('imageCanvasUserId');
        
        if (!userId) {
            // Generate a unique user ID based on timestamp and random value
            userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            localStorage.setItem('imageCanvasUserId', userId);
        } else {
        }
        
        return userId;
    }
    
    // Get network layer from app when needed
    get networkLayer() {
        return this.app.networkLayer;
    }
    
    // Get persistence handler from app when needed
    get persistenceHandler() {
        return this.app.persistenceHandler;
    }
    
    createUI() {
        // Create navigator panel
        this.panel = document.createElement('div');
        this.panel.className = 'canvas-navigator';
        this.panel.innerHTML = `
            <div class="navigator-header">
                <h3>Image Canvas</h3>
                <button class="close-btn" title="Close">×</button>
            </div>
            <div class="navigator-toolbar">
                <button class="new-canvas-btn">
                    <span class="icon">+</span>
                    New Canvas
                </button>
                <button class="refresh-btn" title="Refresh">
                    <span class="icon">↻</span>
                </button>
            </div>
            <div class="canvas-list-container">
                <div class="canvas-list loading">
                    <div class="loading-spinner">Loading...</div>
                </div>
            </div>
            <div class="navigator-footer">
                <div class="database-info">
                    <span class="database-size">Database: <span class="size-value">--</span></span>
                </div>
                <button class="cleanup-btn" title="Clean up orphaned data and unused media">
                    <span class="icon">🧹</span>
                    Clean Up
                </button>
            </div>
        `;
        
        // Create toggle button
        this.toggleBtn = document.createElement('button');
        this.toggleBtn.className = 'canvas-navigator-toggle';
        this.toggleBtn.innerHTML = '<span class="icon">☰</span>';
        this.toggleBtn.title = 'Show/Hide Canvas Navigator';
        
        // Add styles
        this.addStyles();
        
        // Add to DOM
        document.body.appendChild(this.panel);
        document.body.appendChild(this.toggleBtn);
    }
    
    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Navigator Panel */
            .canvas-navigator {
                position: fixed;
                top: 0;
                left: -240px;
                width: 240px;
                height: 100vh;
                background: rgba(30, 30, 30, 0.75);
                color: #e0e0e0;
                box-shadow: 2px 0 10px rgba(0,0,0,0.3);
                transition: left 0.3s ease;
                z-index: 1000;
                display: flex;
                flex-direction: column;
                font-family: ${FONT_CONFIG.APP_FONT};
            }
            
            .canvas-navigator.open {
                left: 0;
            }
            
            /* Header */
            .navigator-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px;
                border-bottom: 1px solid #333;
                background: #252525;
            }
            
            .navigator-header h3 {
                margin: 0;
                font-size: 14px;
                font-weight: 700;
                font-style: bold;
            }
            
            .close-btn {
                background: none;
                border: none;
                color: #999;
                font-size: 20px;
                cursor: pointer;
                padding: 0;
                width: 28px;
                height: 28px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                transition: all 0.2s;
            }
            
            .close-btn:hover {
                background: #333;
                color: #fff;
            }
            
            /* Toolbar */
            .navigator-toolbar {
                padding: 12px;
                border-bottom: 1px solid #333;
                display: flex;
                gap: 8px;
            }
            
            .new-canvas-btn {
                flex: 1;
                background: #4CAF50;
                border: none;
                color: white;
                padding: 8px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 500;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                transition: background 0.2s;
            }
            
            .new-canvas-btn:hover {
                background: #45a049;
            }
            
            .new-canvas-btn .icon {
                font-size: 16px;
                line-height: 1;
            }
            
            .refresh-btn {
                background: #333;
                border: none;
                color: #999;
                padding: 8px;
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.2s;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .refresh-btn:hover {
                background: #444;
                color: #fff;
            }
            
            /* Canvas List */
            .canvas-list-container {
                flex: 1;
                overflow-y: auto;
                padding: 12px;
            }
            
            .canvas-list {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            
            .canvas-list.loading {
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100%;
            }
            
            .loading-spinner {
                color: #666;
                font-size: 12px;
            }
            
            /* Canvas Item */
            .canvas-item {
                background: #2a2a2a;
                border: 1px solid #333;
                border-radius: 4px;
                padding: 4px 8px;
                cursor: pointer;
                transition: all 0.2s;
                position: relative;
            }
            
            .canvas-item:hover {
                background: #333;
                border-color: #444;
                transform: translateX(2px);
            }
            
            .canvas-item.active {
                background: #3a3a3a;
                border-color: #4CAF50;
                border-width: 2px;
                padding: 1px 7px;
            }
            
            .canvas-item-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 0;
                gap: 4px;
            }
            
            .canvas-title {
                font-size: 12px;
                font-weight: 300;
                margin: 4px !important;
                padding: 0;
                color: #fff;
                word-break: break-word;
                flex: 1;
                min-width: 0;
                line-height: 1.2;
                display: block;
            }
            
            .canvas-item.active .canvas-title {
                color: #4CAF50;
            }
            
            .canvas-actions {
                display: flex !important;
                flex-direction: row !important;
                gap: 2px !important;
                opacity: 0;
                transition: opacity 0.2s;
                flex-shrink: 0;
                height: 16px;
                min-width: 34px; /* 16px + 2px gap + 16px */
                align-items: center;
                justify-content: flex-start;
                white-space: nowrap;
            }
            
            .canvas-item:hover .canvas-actions {
                opacity: 1;
            }
            
            .canvas-action-btn {
                background: none;
                border: none;
                color: #666;
                cursor: pointer;
                padding: 0;
                margin: 0;
                border-radius: 2px;
                font-size: 10px;
                line-height: 1;
                transition: all 0.2s;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 16px;
                height: 16px;
                flex-shrink: 0;
                box-sizing: border-box;
                overflow: hidden;
            }
            
            .canvas-action-btn:hover {
                background: #444;
                color: #fff;
            }
            
            .canvas-action-btn.delete:hover {
                background: #d32f2f;
                color: #fff;
            }
            
            .canvas-meta {
                font-size: 9px;
                opacity: 0.6;
                color: #999;
                line-height: 1;
                display: flex;
                margin: 4px 0 4px 4px;
                justify-content: space-between;
                align-items: center;
            }
            
            .collaborator-count {
                font-size: 9px;
                margin-left: 8px;
            }
            
            /* Toggle Button */
            .canvas-navigator-toggle {
                position: fixed;
                top: 20px;
                left: 20px;
                background: #1e1e1e;
                border: 1px solid #333;
                color: #e0e0e0;
                padding: 8px 10px;
                border-radius: 15%;
                cursor: pointer;
                font-size: 12px;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: all 0.2s;
                z-index: 999;
            }
            
            .canvas-navigator-toggle:hover {
                background: #252525;
                border-color: #444;
            }
            
            .canvas-navigator-toggle.active {
                background: #333;
                border-color: #4CAF50;
            }
            
            /* Empty State */
            .empty-state {
                text-align: center;
                padding: 40px 20px;
                color: #666;
            }
            
            .empty-state h4 {
                margin: 0 0 10px 0;
                font-size: 16px;
                font-weight: 500;
                color: #999;
            }
            
            .empty-state p {
                margin: 0;
                font-size: 14px;
                color: #666;
            }
            
            /* Footer */
            .navigator-footer {
                padding: 12px;
                border-top: 1px solid #333;
                background: #252525;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
            }
            
            .database-info {
                font-size: 11px;
                color: #999;
            }
            
            .size-value {
                color: #e0e0e0;
                font-weight: 500;
            }
            
            .cleanup-btn {
                background: #333;
                border: none;
                color: #999;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 4px;
                transition: all 0.2s;
            }
            
            .cleanup-btn:hover {
                background: #444;
                color: #fff;
            }
            
            .cleanup-btn.loading {
                opacity: 0.6;
                cursor: not-allowed;
            }
            
            .cleanup-btn .icon {
                font-size: 12px;
            }
        `;
        document.head.appendChild(style);
    }
    
    setupEventListeners() {
        // Toggle button
        this.toggleBtn.addEventListener('click', () => this.toggle());
        
        // Close button
        this.panel.querySelector('.close-btn').addEventListener('click', () => this.close());
        
        // New canvas button
        this.panel.querySelector('.new-canvas-btn').addEventListener('click', () => this.createNewCanvas());
        
        // Refresh button
        this.panel.querySelector('.refresh-btn').addEventListener('click', () => this.loadCanvases());
        
        // Cleanup button
        const cleanupBtn = this.panel.querySelector('.cleanup-btn');
        if (cleanupBtn) {
            cleanupBtn.addEventListener('click', () => {
                this.performCleanup();
            });
        } else {
            console.error('❌ Cleanup button not found during setup');
        }
        
        // Keyboard shortcut (Ctrl/Cmd + O)
        document.addEventListener('keydown', (e) => {
            // Don't handle shortcuts if editing text
            const canvasTitleInput = document.querySelector('.canvas-title-input');
            if (canvasTitleInput && document.activeElement === canvasTitleInput) {
                return;
            }
            
            if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
                e.preventDefault();
                this.toggle();
            }
        });
    }
    
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }
    
    open() {
        this.isOpen = true;
        this.panel.classList.add('open');
        this.toggleBtn.classList.add('active');
        this.loadCanvases();
        this.updateDatabaseSize();
    }
    
    close() {
        this.isOpen = false;
        this.panel.classList.remove('open');
        this.toggleBtn.classList.remove('active');
    }
    
    async loadCanvases() {
        const listContainer = this.panel.querySelector('.canvas-list');
        listContainer.innerHTML = '<div class="loading-spinner">Loading...</div>';
        listContainer.classList.add('loading');
        
        try {
            // Use general projects endpoint to show all canvases
            const response = await fetch(CONFIG.ENDPOINTS.PROJECTS);
            if (!response.ok) throw new Error('Failed to load canvases');
            
            this.canvases = await response.json();
            this.renderCanvasList();
        } catch (error) {
            console.error('Failed to load canvases:', error);
            listContainer.innerHTML = '<div class="error">Failed to load canvases</div>';
        }
    }
    
    renderCanvasList() {
        const listContainer = this.panel.querySelector('.canvas-list');
        listContainer.classList.remove('loading');
        
        if (this.canvases.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <h4>No canvases yet</h4>
                    <p>Click the "New Canvas" button above to get started</p>
                </div>
            `;
            return;
        }
        
        listContainer.innerHTML = this.canvases.map(canvas => this.renderCanvasItem(canvas)).join('');
        
        // Add click handlers
        listContainer.querySelectorAll('.canvas-item').forEach(item => {
            const canvasId = parseInt(item.dataset.canvasId);
            
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.canvas-actions') && !e.target.closest('.canvas-title-input')) {
                    this.loadCanvas(canvasId);
                }
            });
            
            // Double-click on title to rename
            const titleEl = item.querySelector('.canvas-title');
            if (titleEl) {
                titleEl.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    this.startRenaming(canvasId, titleEl);
                });
            }
            
            // Delete button
            const deleteBtn = item.querySelector('.delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteCanvas(canvasId);
                });
            }
            
            // Duplicate button
            const duplicateBtn = item.querySelector('.duplicate');
            if (duplicateBtn) {
                duplicateBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.duplicateCanvas(canvasId);
                });
            }
        });
    }
    
    renderCanvasItem(canvas) {
        const isActive = canvas.id === this.currentCanvasId;
        const lastModified = new Date(canvas.last_modified).toLocaleDateString();
        const collaboratorCount = canvas.collaborator_count || 0;
        
        return `
            <div class="canvas-item ${isActive ? 'active' : ''}" data-canvas-id="${canvas.id}">
                <div class="canvas-item-header">
                    <h4 class="canvas-title" data-canvas-id="${canvas.id}" data-original-name="${this.escapeHtml(canvas.name || 'Untitled Canvas')}">${this.escapeHtml(canvas.name || 'Untitled Canvas')}</h4>
                    <div class="canvas-actions"><button class="canvas-action-btn duplicate" title="Duplicate">📋</button><button class="canvas-action-btn delete" title="Delete">🗑️</button></div>
                </div>
                <div class="canvas-meta">
                    <span>Modified: ${lastModified}</span>
                    ${collaboratorCount > 0 ? `<span class="collaborator-count">👥 ${collaboratorCount}</span>` : ''}
                </div>
            </div>
        `;
    }
    
    async createNewCanvas() {
        // If we have content but no canvas ID, silently save as a new canvas first
        if (!this.currentCanvasId && this.app.graph.nodes.length > 0) {
            const timestamp = new Date().toLocaleString();
            await this.saveAsNewCanvas(`Untitled Canvas - ${timestamp}`, true); // true = silent
        }
        
        const name = prompt('Canvas name:', 'Untitled Canvas');
        if (!name) return;
        
        try {
            const response = await fetch(CONFIG.ENDPOINTS.PROJECTS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    ownerId: this.userId,
                    description: ''
                })
            });
            
            if (!response.ok) throw new Error('Failed to create canvas');
            
            const newCanvas = await response.json();
            
            // Clear current canvas and load the new one
            this.app.graph.clear();
            this.currentCanvasId = newCanvas.id;
            
            // Join the project if collaborative
            // Join using the new NetworkLayer if available
            if (this.app.networkLayer) {
                await this.joinProjectWithRetry(newCanvas.id);
            }
            
            // Project joining is now handled by NetworkLayer
            
            // Refresh the list
            this.loadCanvases();
            
        } catch (error) {
            console.error('Failed to create canvas:', error);
            alert('Failed to create canvas');
        }
    }
    
    async loadCanvas(canvasId) {
        try {
            console.log('Loading canvas:', canvasId);
            
            // Don't reload if it's already the current canvas
            if (this.currentCanvasId === canvasId) {
                console.log('Canvas already loaded');
                // this.close(); // DISABLED for testing
                return;
            }
            
            // Check if network layer is connected
            if (this.networkLayer && !this.networkLayer.isConnected) {
                // Wait for connection
                let attempts = 0;
                while (!this.networkLayer.isConnected && attempts < 30) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                }
                if (!this.networkLayer.isConnected) {
                    console.error('⚠️ Network connection timeout - proceeding anyway');
                }
            }
            
            // Disconnect from current project first
            if (this.networkLayer && this.networkLayer.isConnected && this.networkLayer.currentProject) {
                console.log('Leaving current project before switching...');
                // NetworkLayer handles its own cleanup
                
                // Leave the current project room and wait for confirmation
                if (this.networkLayer.currentProject.id) {
                    await this.leaveProjectAndWait(this.networkLayer.currentProject.id);
                }
                
                // NetworkLayer manages its own state
            }
            
            // Save current canvas if needed
            if (this.currentCanvasId && this.networkLayer) {
                // Force save even if hasUnsavedChanges is false, to ensure we don't lose data
                if (this.app.graph.nodes.length > 0) {
                    console.log('💾 Saving current canvas before switching...');
                    console.log('💾 Current canvas ID:', this.currentCanvasId);
                    console.log('💾 Current nodes:', this.app.graph.nodes.length);
                    // Mark as needing save
                    // Saving is now handled by PersistenceHandler
                    if (this.persistenceHandler) {
                        try {
                            await this.persistenceHandler.save();
                        } catch (error) {
                            console.error('💾 Failed to save before canvas switch:', error);
                            // Continue with canvas switch even if save fails
                        }
                    } else {
                        console.warn('💾 No persistence handler available - skipping save');
                    }
                    console.log('💾 Save completed');
                } else {
                    console.log('💾 No nodes to save in current canvas');
                }
            } else if (!this.currentCanvasId && this.app.graph.nodes.length > 0) {
                // Don't auto-save if we're in a duplicated tab situation
                console.log('⚠️ Have nodes but no canvas ID - possible duplicate tab');
                // Clear the nodes instead of saving to avoid creating unwanted canvases
                this.app.graph.clear();
            }
            
            // Stop any existing auto-save
            this.stopAutoSave();
            
            // Clear the current canvas
            this.app.graph.clear();
            
            // Update current canvas ID
            this.currentCanvasId = canvasId;
            localStorage.setItem('lastCanvasId', canvasId.toString());
            
            // Reset collaborative manager state
            if (this.networkLayer) {
                this.networkLayer.hasUnsavedChanges = false;
                this.networkLayer.lastSaveTime = Date.now();
            }
            
            // Load the canvas data
            try {
                const response = await fetch(CONFIG.ENDPOINTS.PROJECT_CANVAS(canvasId));
                if (!response.ok) throw new Error('Failed to fetch canvas');
                
                const data = await response.json();
                
                if (data.canvas_data) {
                    // With state sync, we don't load from the REST endpoint
                    // The state will come from the WebSocket after joining
                    
                    // NOW join the new project if collaborative
                    
                    // Join using the new NetworkLayer with retry logic
                    if (this.app.networkLayer) {
                        await this.joinProjectWithRetry(canvasId);
                    } else {
                        console.warn('⚠️ No NetworkLayer available - project joining disabled');
                    }
                    
                    // Show success
                    if (this.app.showNotification) {
                        this.app.showNotification({
                            type: 'success',
                            message: 'Canvas loaded'
                        });
                    }
                } else {
                    
                    // Still need to join the project for collaboration
                    
                    // Join using the new NetworkLayer with retry logic
                    if (this.app.networkLayer) {
                        await this.joinProjectWithRetry(canvasId);
                    } else {
                        console.warn('⚠️ No NetworkLayer available - project joining disabled');
                    }
                }
            } catch (error) {
                console.error('Error loading canvas data:', error);
                // Continue with empty canvas but still join project
                // Join using the new NetworkLayer with retry logic
                if (this.app.networkLayer) {
                    await this.joinProjectWithRetry(canvasId);
                }
            }
            
            // Update UI
            this.renderCanvasList();
            
            // Start auto-save for this canvas
            this.startAutoSave();
            
            // Close navigator - DISABLED for testing
            // this.close();
            
        } catch (error) {
            console.error('Failed to load canvas:', error);
            alert('Failed to load canvas: ' + error.message);
        }
    }
    
    async deleteCanvas(canvasId) {
        const canvas = this.canvases.find(c => c.id === canvasId);
        if (!canvas) {
            console.error('Canvas not found:', canvasId);
            return;
        }
        
        if (!confirm(`Delete "${canvas.name}"? This cannot be undone.`)) {
            console.log('Delete cancelled by user');
            return;
        }
        
        try {
            const deleteUrl = CONFIG.ENDPOINTS.PROJECT(canvasId);
            
            const response = await fetch(deleteUrl, {
                method: 'DELETE'
            });
            
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Delete failed:', errorText);
                throw new Error(`Failed to delete canvas: ${response.status} ${response.statusText}`);
            }
            
            // If we deleted the current canvas, clear it
            if (canvasId === this.currentCanvasId) {
                this.app.graph.clear();
                this.currentCanvasId = null;
                
                // Stop auto-save
                this.stopAutoSave();
                
                // Clear localStorage
                localStorage.removeItem('lastCanvasId');
            }
            
            // Refresh the list
            await this.loadCanvases();
            
            // Show success message
            if (this.app.showNotification) {
                this.app.showNotification({
                    type: 'success',
                    message: 'Canvas deleted successfully'
                });
            }
        } catch (error) {
            console.error('Failed to delete canvas:', error);
            alert(`Failed to delete canvas: ${error.message}`);
        }
    }
    
    async duplicateCanvas(canvasId) {
        const canvas = this.canvases.find(c => c.id === canvasId);
        if (!canvas) return;
        
        const name = prompt('Name for duplicated canvas:', `${canvas.name} (Copy)`);
        if (!name) return;
        
        try {
            // For now, we'll create a new canvas and copy the data
            // In the future, this could be a server-side operation
            
            // Load the original canvas data
            const response = await fetch(CONFIG.ENDPOINTS.PROJECT_CANVAS(canvasId));
            const data = await response.json();
            
            // Create new canvas
            const createResponse = await fetch(CONFIG.ENDPOINTS.PROJECTS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    ownerId: this.userId,
                    description: canvas.description || ''
                })
            });
            
            if (!createResponse.ok) throw new Error('Failed to create canvas');
            
            const newCanvas = await createResponse.json();
            
            // Copy the canvas data if it exists
            if (data.canvas_data) {
                await fetch(CONFIG.ENDPOINTS.PROJECT_CANVAS(newCanvas.id), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        canvas_data: data.canvas_data,
                        userId: this.userId
                    })
                });
            }
            
            // Refresh the list
            this.loadCanvases();
            
            // Show success message
            if (this.app.showNotification) {
                this.app.showNotification({
                    type: 'success',
                    message: `Duplicated canvas: ${name}`
                });
            }
        } catch (error) {
            console.error('Failed to duplicate canvas:', error);
            alert('Failed to duplicate canvas');
        }
    }
    
    async leaveProjectAndWait(projectId) {
        return new Promise((resolve) => {
            
            // Set up one-time listener for leave confirmation
            const leaveHandler = (data) => {
                if (data && parseInt(data.projectId) === parseInt(projectId)) {
                    this.networkLayer.socket.off('project_left', leaveHandler);
                    resolve();
                }
            };
            
            // Set up timeout in case server doesn't respond
            const timeout = setTimeout(() => {
                this.networkLayer.socket.off('project_left', leaveHandler);
                resolve();
            }, 2000); // 2 second timeout
            
            // Listen for confirmation
            this.networkLayer.socket.on('project_left', leaveHandler);
            
            // Emit leave request
            this.networkLayer.socket.emit('leave_project', { 
                projectId: projectId 
            });
            
            // Clear timeout on confirmation
            this.networkLayer.socket.once('project_left', () => {
                clearTimeout(timeout);
            });
        });
    }
    
    async joinProjectWithRetry(canvasId, maxAttempts = 3) {
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Check if network is connected
                if (!this.app.networkLayer.isConnected) {
                    
                    // Wait for connection with timeout
                    let waitTime = 0;
                    const maxWaitTime = 5000; // 5 seconds
                    const checkInterval = 200;
                    
                    while (!this.app.networkLayer.isConnected && waitTime < maxWaitTime) {
                        await new Promise(resolve => setTimeout(resolve, checkInterval));
                        waitTime += checkInterval;
                    }
                    
                    if (!this.app.networkLayer.isConnected) {
                        console.warn(`⚠️ Network connection timeout on attempt ${attempt}`);
                        if (attempt === maxAttempts) {
                            console.error('❌ Failed to connect to network after all attempts');
                            return false;
                        }
                        continue; // Try next attempt
                    }
                }
                
                // Now try to join the project
                this.app.networkLayer.joinProject(canvasId);
                
                // Wait a moment to see if join was successful
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Check if the undo manager has the project ID set (indicates successful join)
                if (this.app.undoManager && this.app.undoManager.projectId === canvasId) {
                    return true;
                }
                
                // For now, assume success if we got this far
                return true;
                
            } catch (error) {
                console.error(`❌ Project join attempt ${attempt} failed:`, error);
                
                if (attempt === maxAttempts) {
                    console.error('❌ All project join attempts failed');
                    return false;
                }
                
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
        
        return false;
    }
    
    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    
    startRenaming(canvasId, titleEl) {
        const canvas = this.canvases.find(c => c.id === canvasId);
        if (!canvas) return;
        
        const currentName = canvas.name || 'Untitled Canvas';
        
        // Create input element
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'canvas-title-input';
        input.name = 'canvas-title';
        input.id = `canvas-title-${canvas.id}`;
        input.value = currentName;
        input.style.cssText = `
            width: 100%;
            background: #1a1a1a;
            border: 1px solid #4CAF50;
            color: #fff;
            padding: 4px 8px;
            font-size: 12px;
            font-weight: 500;
            border-radius: 3px;
            outline: none;
        `;
        
        // Replace title with input
        titleEl.style.display = 'none';
        titleEl.parentNode.insertBefore(input, titleEl);
        
        // Focus and select all text
        input.focus();
        input.select();
        
        // Handle save
        const saveRename = async () => {
            const newName = input.value.trim();
            if (newName && newName !== currentName) {
                await this.renameCanvas(canvasId, newName);
            }
            
            // Restore title
            input.remove();
            titleEl.style.display = '';
        };
        
        // Handle cancel
        const cancelRename = () => {
            input.remove();
            titleEl.style.display = '';
        };
        
        // Event handlers
        input.addEventListener('blur', saveRename);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveRename();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
            }
        });
        
        // Prevent click propagation
        input.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
    
    async renameCanvas(canvasId, newName) {
        try {
            const response = await fetch(CONFIG.ENDPOINTS.PROJECT(canvasId), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName })
            });
            
            if (!response.ok) throw new Error('Failed to rename canvas');
            
            // Update local data
            const canvas = this.canvases.find(c => c.id === canvasId);
            if (canvas) {
                canvas.name = newName;
            }
            
            // Refresh the list
            this.renderCanvasList();
            
            // Show success
            if (this.app.showNotification) {
                this.app.showNotification({
                    type: 'success',
                    message: `Renamed to "${newName}"`
                });
            }
        } catch (error) {
            console.error('Failed to rename canvas:', error);
            alert('Failed to rename canvas');
        }
    }
    
    hasUnsavedChanges() {
        // Check if we have nodes and no current canvas ID
        if (!this.currentCanvasId && this.app.graph.nodes.length > 0) {
            return true;
        }
        
        // Check collaborative manager for unsaved changes
        if (this.networkLayer && this.networkLayer.hasUnsavedChanges) {
            return true;
        }
        
        return false;
    }
    
    async saveAsNewCanvas(name, silent = false) {
        try {
            // Create new canvas
            const response = await fetch(CONFIG.ENDPOINTS.PROJECTS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    ownerId: this.userId,
                    description: ''
                })
            });
            
            if (!response.ok) throw new Error('Failed to create canvas');
            
            const newCanvas = await response.json();
            this.currentCanvasId = newCanvas.id;
            
            // Save current state to the new canvas
            const canvasData = this.app.stateManager.serializeState(this.app.graph, this.app.graphCanvas);
            await fetch(CONFIG.ENDPOINTS.PROJECT_CANVAS(newCanvas.id), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    canvas_data: canvasData,
                    userId: this.userId
                })
            });
            
            // Join the project if collaborative
            // Join using the new NetworkLayer if available
            if (this.app.networkLayer) {
                await this.joinProjectWithRetry(newCanvas.id);
            }
            
            // Project joining is now handled by NetworkLayer
            
            // Refresh the list
            await this.loadCanvases();
            
            return newCanvas;
        } catch (error) {
            console.error('Failed to save as new canvas:', error);
            if (!silent) {
                alert('Failed to save canvas');
            }
            return null;
        }
    }
    
    async loadStartupCanvas() {
        
        try {
            // Wait for network layer to be ready if it exists
            if (this.app.networkLayer) {
                let networkAttempts = 0;
                const maxNetworkAttempts = 20; // 10 seconds
                
                while (!this.app.networkLayer.isConnected && networkAttempts < maxNetworkAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    networkAttempts++;
                    
                }
                
                if (!this.app.networkLayer.isConnected) {
                    console.warn('⚠️ Network connection timeout - proceeding anyway');
                }
            }
            
            // Check if we're in demo mode
            const isDemoMode = window.location.pathname.includes('demo.html');
            
            if (isDemoMode) {
                
                // For demo mode, always load or create the demo canvas
                await this.loadCanvases();
                const demoCanvas = this.canvases.find(c => c.name === 'Demo Canvas');
                
                if (demoCanvas) {
                    await this.loadCanvas(demoCanvas.id);
                } else {
                    const response = await fetch(CONFIG.ENDPOINTS.PROJECTS, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: 'Demo Canvas',
                            ownerId: 1,
                            description: 'Collaborative demo canvas'
                        })
                    });
                    
                    if (response.ok) {
                        const newCanvas = await response.json();
                        await this.loadCanvas(newCanvas.id);
                    }
                }
                return;
            }
            
            // Generate a unique tab ID for this tab
            const tabId = Date.now() + '-' + Math.random();
            
            // Use a more sophisticated duplicate detection that doesn't interfere with multiple tabs
            // Store tab ID in a way that's unique to this exact tab instance
            const tabKey = 'imageCanvasTab_' + window.name || 'default';
            window.name = window.name || 'tab_' + tabId; // Ensure window has a name
            
            // Don't treat new tabs as duplicates - sessionStorage is shared between tabs!
            // Only check for actual duplicates (same window reloaded)
            const isReload = performance.navigation.type === 1;
            
            
            // Get last used canvas from localStorage
            const lastCanvasId = localStorage.getItem('lastCanvasId');
            
            if (lastCanvasId) {
                // Try to load the last canvas by checking if it exists in all projects
                const response = await fetch(CONFIG.ENDPOINTS.PROJECTS);
                if (response.ok) {
                    const canvases = await response.json();
                    const lastCanvas = canvases.find(c => c.id === parseInt(lastCanvasId));
                    if (lastCanvas) {
                        await this.loadCanvas(parseInt(lastCanvasId));
                        return;
                    }
                }
            }
            
            // No last canvas or it doesn't exist, check if user has any canvases
            const response = await fetch(CONFIG.ENDPOINTS.PROJECTS);
            if (response.ok) {
                const canvases = await response.json();
                
                if (canvases.length > 0) {
                    // Load the most recent canvas
                    await this.loadCanvas(canvases[0].id);
                } else {
                    // No canvases exist, create a default one
                    const newCanvas = await this.createDefaultCanvas();
                    if (newCanvas) {
                        this.currentCanvasId = newCanvas.id;
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load startup canvas:', error);
            // Continue with blank canvas
        }
    }
    
    async createDefaultCanvas() {
        try {
            const response = await fetch(CONFIG.ENDPOINTS.PROJECTS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'My First Canvas',
                    ownerId: this.userId,
                    description: 'Welcome to ImageCanvas!'
                })
            });
            
            if (!response.ok) throw new Error('Failed to create default canvas');
            
            const newCanvas = await response.json();
            
            // Join the project if collaborative
            // Join using the new NetworkLayer if available
            if (this.app.networkLayer) {
                await this.joinProjectWithRetry(newCanvas.id);
            }
            
            // Project joining is now handled by NetworkLayer
            
            // Refresh the list
            await this.loadCanvases();
            
            // Show welcome message
            if (this.app.showNotification) {
                this.app.showNotification({
                    type: 'success',
                    message: 'Welcome! Your first canvas has been created.'
                });
            }
            
            return newCanvas;
        } catch (error) {
            console.error('Failed to create default canvas:', error);
            return null;
        }
    }
    
    // Auto-save functionality
    startAutoSave() {
        // Clear any existing timer
        this.stopAutoSave();
        
        // Save every 30 seconds if there are changes
        this.autoSaveTimer = setInterval(async () => {
            if (this.currentCanvasId && this.app.graph._nodes && this.app.graph._nodes.length > 0) {
                await this.saveCanvasToServer();
            }
        }, 30000); // 30 seconds
        
    }
    
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }
    
    async saveCanvasToServer() {
        if (!this.currentCanvasId) {
            console.warn('No canvas ID - cannot save');
            return false;
        }
        
        try {
            // Serialize the current state
            const canvasData = this.app.stateManager.serializeState(this.app.graph, this.app.graphCanvas);
            
            // Save to server
            const response = await fetch(CONFIG.ENDPOINTS.PROJECT_CANVAS(this.currentCanvasId), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    canvas_data: canvasData,
                    userId: this.userId
                })
            });
            
            if (!response.ok) {
                console.error('Failed to save canvas:', response.status, response.statusText);
                return false;
            }
            
            // Update last modified time in local cache
            const canvas = this.canvases.find(c => c.id === this.currentCanvasId);
            if (canvas) {
                canvas.last_modified = new Date().toISOString();
            }
            
            return true;
        } catch (error) {
            console.error('Error saving canvas to server:', error);
            return false;
        }
    }
    
    // Manual save method
    async saveCanvas() {
        const saved = await this.saveCanvasToServer();
        if (saved && this.app.showNotification) {
            this.app.showNotification({
                type: 'success',
                message: 'Canvas saved'
            });
        }
        return saved;
    }
    
    async updateDatabaseSize() {
        try {
            // Add timestamp to prevent caching
            const response = await fetch(`${CONFIG.ENDPOINTS.DATABASE_SIZE}?t=${Date.now()}`);
            if (!response.ok) throw new Error('Failed to get database size');
            
            const data = await response.json();
            const sizeElement = this.panel.querySelector('.size-value');
            if (sizeElement) {
                // Show breakdown if available
                if (data.breakdown) {
                    const db = data.breakdown.database.formatted;
                    const uploads = data.breakdown.uploads.formatted;
                    const thumbs = data.breakdown.thumbnails.formatted;
                    sizeElement.innerHTML = `${data.sizeFormatted}<br><small style="font-size: 9px; opacity: 0.7">DB: ${db}, Files: ${uploads}</small>`;
                } else {
                    sizeElement.textContent = data.sizeFormatted || '--';
                }
            }
        } catch (error) {
            console.error('Failed to get database size:', error);
            const sizeElement = this.panel.querySelector('.size-value');
            if (sizeElement) {
                sizeElement.textContent = 'Error';
            }
        }
    }
    
    async performCleanup() {
        const cleanupBtn = this.panel.querySelector('.cleanup-btn');
        if (!cleanupBtn) {
            console.error('Cleanup button not found');
            return;
        }
        
        if (cleanupBtn.classList.contains('loading')) {
            console.log('Cleanup already in progress');
            return;
        }
        
        // Create a custom dialog for cleanup options
        const dialog = document.createElement('div');
        dialog.className = 'cleanup-dialog';
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #2a2a2a;
            border: 1px solid #444;
            border-radius: 8px;
            padding: 20px;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            max-width: 500px;
            color: #eee;
        `;
        
        dialog.innerHTML = `
            <h3 style="margin-top: 0; color: #fff;">Database Cleanup</h3>
            <p style="color: #ccc; margin-bottom: 15px;">This will scan for and remove orphaned files using a safe mark-and-sweep approach.</p>
            
            <div style="background: #1a1a1a; border-radius: 4px; padding: 10px; margin-bottom: 15px;">
                <strong style="color: #4a9eff;">What will be cleaned:</strong>
                <ul style="margin: 5px 0; padding-left: 20px; color: #aaa;">
                    <li>Orphaned media files not referenced in any canvas</li>
                    <li>Old operations with embedded image data</li>
                    <li>Client-side caches (images, thumbnails)</li>
                    <li>Undo/redo history</li>
                </ul>
            </div>
            
            <div style="background: #1a1a1a; border-radius: 4px; padding: 10px; margin-bottom: 20px;">
                <strong style="color: #4eff4a;">Protected files:</strong>
                <ul style="margin: 5px 0; padding-left: 20px; color: #aaa;">
                    <li>All files referenced in saved canvases</li>
                    <li>Files in recent operations (last 24 hours)</li>
                </ul>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 10px;">
                    <input type="checkbox" id="cleanup-dry-run" style="margin-right: 8px;">
                    <span>Dry run (preview what would be deleted without actually deleting)</span>
                </label>
                <label style="display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" id="cleanup-all-thumbnails" style="margin-right: 8px;">
                    <span>Delete ALL thumbnails (including those with active images)</span>
                </label>
                <div style="font-size: 11px; color: #888; margin-left: 24px; margin-top: 4px;">
                    ⚠️ This will clear the entire thumbnail cache. Thumbnails will be regenerated when needed.
                </div>
            </div>
            
            
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="cleanup-cancel" style="padding: 8px 16px; background: #444; border: none; border-radius: 4px; color: #fff; cursor: pointer;">Cancel</button>
                <button id="cleanup-proceed" style="padding: 8px 16px; background: #4a9eff; border: none; border-radius: 4px; color: #fff; cursor: pointer; font-weight: bold;">Proceed</button>
            </div>
        `;
        
        // Add backdrop
        const backdrop = document.createElement('div');
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 9999;
        `;
        
        document.body.appendChild(backdrop);
        document.body.appendChild(dialog);
        
        // Handle dialog actions
        const cleanup = async (dryRun, gracePeriod, deleteAllThumbnails) => {
            backdrop.remove();
            dialog.remove();
            
            // Proceed with cleanup
            await this.executeCleanup(dryRun, gracePeriod, deleteAllThumbnails);
        };
        
        document.getElementById('cleanup-cancel').onclick = () => {
            backdrop.remove();
            dialog.remove();
            console.log('Cleanup cancelled by user');
        };
        
        document.getElementById('cleanup-proceed').onclick = () => {
            const dryRun = document.getElementById('cleanup-dry-run').checked;
            const gracePeriod = 0; // Always use 0 grace period
            const deleteAllThumbnails = document.getElementById('cleanup-all-thumbnails').checked;
            cleanup(dryRun, gracePeriod, deleteAllThumbnails);
        };
        
        // Focus on proceed button
        document.getElementById('cleanup-proceed').focus();
        
        return;  // Exit here, actual cleanup happens in executeCleanup
    }
    
    async executeCleanup(dryRun = false, gracePeriod = 0, deleteAllThumbnails = false) {
        const cleanupBtn = this.panel.querySelector('.cleanup-btn');
        if (!cleanupBtn) {
            console.error('Cleanup button not found');
            return;
        }
        
        cleanupBtn.classList.add('loading');
        cleanupBtn.disabled = true;
        const originalContent = cleanupBtn.innerHTML;
        cleanupBtn.innerHTML = '<span class="icon">⏳</span> Cleaning...';
        
        try {
            // Clear client-side caches first (only if not dry run)
            if (!dryRun) {
                // Clear image cache
                if (window.imageCache) {
                    window.imageCache.clear();
                }
                
                // Clear thumbnail cache
                if (window.thumbnailCache) {
                    window.thumbnailCache.clear();
                }
                
                // Clear image resource cache
                if (window.app && window.app.imageResourceCache) {
                    window.app.imageResourceCache.clear();
                }
                
                // Clear client undo state
                if (window.app && window.app.clientUndoManager) {
                    // Reset local undo state
                    window.app.clientUndoManager.undoState = {
                        canUndo: false,
                        canRedo: false,
                        undoCount: 0,
                        redoCount: 0,
                        nextUndo: null,
                        nextRedo: null
                    };
                    
                    // Request server to clear undo history for this project
                    if (this.currentCanvasId && this.networkLayer && this.networkLayer.socket) {
                        this.networkLayer.socket.emit('clear_undo_history', {
                            projectId: this.currentCanvasId
                        });
                    }
                }
                
                // Clear any local storage
                try {
                    // Clear undo-related localStorage entries
                    const keysToRemove = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key && (key.includes('undo') || key.includes('redo'))) {
                            keysToRemove.push(key);
                        }
                    }
                    keysToRemove.forEach(key => localStorage.removeItem(key));
                } catch (e) {
                    console.warn('Failed to clear some localStorage entries:', e);
                }
            } // End if (!dryRun)
            
            // Now perform server cleanup with parameters
            const params = new URLSearchParams();
            if (dryRun) params.append('dryRun', 'true');
            params.append('gracePeriod', gracePeriod.toString());
            if (deleteAllThumbnails) params.append('deleteAllThumbnails', 'true');
            
            const response = await fetch(`${CONFIG.ENDPOINTS.DATABASE_CLEANUP}?${params}`, {
                method: 'POST'
            });
            if (!response.ok) throw new Error(`Cleanup failed with status ${response.status}`);
            
            const result = await response.json();
            
            // Update database size after a short delay to ensure DB operations are complete
            setTimeout(async () => {
                await this.updateDatabaseSize();
            }, 1000);
            
            // Show success notification
            if (this.app.showNotification) {
                let message = dryRun ? 'Dry run completed:\n' : 'Cleanup completed:\n';
                const parts = [];
                
                // Handle new cleanup response format
                if (result.fileCleanup) {
                    if (dryRun) {
                        parts.push(`• Found ${result.fileCleanup.referencedFiles} referenced files`);
                        parts.push(`• Would delete ${result.fileCleanup.deletedFiles} orphaned files`);
                    } else {
                        parts.push(`• Deleted ${result.fileCleanup.deletedFiles} orphaned files`);
                    }
                }
                
                if (result.operationsDeleted > 0) {
                    parts.push(`• ${dryRun ? 'Would delete' : 'Deleted'} ${result.operationsDeleted} old operations`);
                }
                
                // Legacy format support
                if (result.deleted) {
                    if (result.deleted.files > 0) {
                        parts.push(`• Removed ${result.deleted.files} orphaned database files`);
                    }
                    if (result.deleted.orphanedDiskFiles > 0) {
                        parts.push(`• Removed ${result.deleted.orphanedDiskFiles} orphaned disk files`);
                    }
                    if (result.deleted.largeOperations > 0) {
                        parts.push(`• Removed ${result.deleted.largeOperations} operations with embedded images`);
                    }
                    if (result.deleted.operations > 0) {
                        parts.push(`• Cleared ${result.deleted.operations} old operations`);
                    }
                    if (result.deleted.users > 0) {
                        parts.push(`• Removed ${result.deleted.users} orphaned users`);
                    }
                }
                
                // Show size reduction if available
                if (result.previousSize && result.newSize) {
                    parts.push(`• Database size: ${result.previousSize.formatted} → ${result.newSize.formatted}`);
                }
                
                // Client cleanup results (only if not dry run)
                if (!dryRun) {
                    parts.push('• Cleared all client-side caches');
                    parts.push('• Reset undo/redo history');
                }
                
                message = parts.length > 0 ? `${dryRun ? 'Dry run' : 'Cleanup'} completed:\n${parts.join('\n')}` : (dryRun ? 'Dry run completed' : 'Cleanup completed');
                
                this.app.showNotification({
                    type: 'success',
                    message: message,
                    duration: 5000 // Show for longer since it's multi-line
                });
            }
            
            
        } catch (error) {
            console.error('Failed to perform cleanup:', error);
            if (this.app.showNotification) {
                this.app.showNotification({
                    type: 'error',
                    message: 'Cleanup failed. Please try again.'
                });
            }
        } finally {
            cleanupBtn.classList.remove('loading');
            cleanupBtn.disabled = false;
            cleanupBtn.innerHTML = originalContent;
        }
    }
}

// Export for use
window.CanvasNavigator = CanvasNavigator;