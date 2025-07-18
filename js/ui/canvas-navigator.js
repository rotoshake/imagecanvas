// Canvas Navigator UI Component
// Provides a panel for managing canvases/projects

class CanvasNavigator {
    constructor(app) {
        this.app = app;
        // Don't set collaborativeManager here - it's not ready yet
        this.isOpen = false;
        this.canvases = [];
        this.currentCanvasId = null;
        this.userId = 1; // Default user, will be updated when user system is implemented
        
        this.createUI();
        this.setupEventListeners();
    }
    
    // Get collaborative manager from app when needed
    get collaborativeManager() {
        return this.app.collaborativeManager;
    }
    
    createUI() {
        // Create navigator panel
        this.panel = document.createElement('div');
        this.panel.className = 'canvas-navigator';
        this.panel.innerHTML = `
            <div class="navigator-header">
                <h3>My Canvases</h3>
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
                width: 220px;
                height: 100vh;
                background: #1e1e1e;
                color: #e0e0e0;
                box-shadow: 2px 0 10px rgba(0,0,0,0.3);
                transition: left 0.3s ease;
                z-index: 1000;
                display: flex;
                flex-direction: column;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            
            .canvas-navigator.open {
                left: 0;
            }
            
            /* Header */
            .navigator-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px;
                border-bottom: 1px solid #333;
                background: #252525;
            }
            
            .navigator-header h3 {
                margin: 0;
                font-size: 14px;
                font-weight: 500;
            }
            
            .close-btn {
                background: none;
                border: none;
                color: #999;
                font-size: 24px;
                cursor: pointer;
                padding: 0;
                width: 30px;
                height: 30px;
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
                padding: 15px;
                border-bottom: 1px solid #333;
                display: flex;
                gap: 10px;
            }
            
            .new-canvas-btn {
                flex: 1;
                background: #4CAF50;
                border: none;
                color: white;
                padding: 10px 15px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 500;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                transition: background 0.2s;
            }
            
            .new-canvas-btn:hover {
                background: #45a049;
            }
            
            .new-canvas-btn .icon {
                font-size: 18px;
                line-height: 1;
            }
            
            .refresh-btn {
                background: #333;
                border: none;
                color: #999;
                padding: 10px;
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.2s;
            }
            
            .refresh-btn:hover {
                background: #444;
                color: #fff;
            }
            
            /* Canvas List */
            .canvas-list-container {
                flex: 1;
                overflow-y: auto;
                padding: 10px;
            }
            
            .canvas-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            
            .canvas-list.loading {
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100%;
            }
            
            .loading-spinner {
                color: #666;
            }
            
            /* Canvas Item */
            .canvas-item {
                background: #2a2a2a;
                border: 1px solid #333;
                border-radius: 6px;
                padding: 2px;
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
                padding: 2px;
            }
            
            .canvas-item-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 0px;
            }
            
            .canvas-title {
                font-size: 12px;
                font-weight: 500;
                margin: 0;
                color: #fff;
                word-break: break-word;
            }
            
            .canvas-item.active .canvas-title {
                color: #4CAF50;
            }
            
            .canvas-actions {
                display: flex;
                gap: 5px;
                opacity: 0;
                transition: opacity 0.2s;
            }
            
            .canvas-item:hover .canvas-actions {
                opacity: 1;
            }
            
            .canvas-action-btn {
                background: none;
                border: none;
                color: #666;
                cursor: pointer;
                padding: 4px;
                border-radius: 3px;
                font-size: 12px;
                transition: all 0.2s;
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
                display: flex;
                flex-direction: column;
                gap: 4px;
                font-size: 8px;
		opacity: 0.5;
                color: #999;
            }
            
            .canvas-meta-row {
                display: flex;
                justify-content: space-between;
            }
            
            .collaborator-count {
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            
            /* Toggle Button */
            .canvas-navigator-toggle {
                position: fixed;
                top: 20px;
                left: 20px;
                background: #1e1e1e;
                border: 1px solid #333;
                color: #e0e0e0;
                padding: 10px 15px;
                border-radius: 4px;
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
            const response = await fetch(CONFIG.ENDPOINTS.USER_PROJECTS(this.userId));
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
                    <div class="canvas-actions">
                        <button class="canvas-action-btn duplicate" title="Duplicate">📋</button>
                        <button class="canvas-action-btn delete" title="Delete">🗑️</button>
                    </div>
                </div>
                <div class="canvas-meta">
                    <div class="canvas-meta-row">
                        <span>Modified: ${lastModified}</span>
                        ${collaboratorCount > 0 ? `
                            <span class="collaborator-count">
                                <span>👥</span>
                                <span>${collaboratorCount}</span>
                            </span>
                        ` : ''}
                    </div>
                    ${canvas.description ? `
                        <div class="canvas-description">${this.escapeHtml(canvas.description)}</div>
                    ` : ''}
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
            if (this.collaborativeManager && this.collaborativeManager.isConnected) {
                this.collaborativeManager.joinProject(newCanvas.id);
            }
            
            // Refresh the list
            this.loadCanvases();
            
            // Show success message
            if (this.collaborativeManager) {
                this.collaborativeManager.showStatus(`Created new canvas: ${name}`, 'success');
            }
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
            
            // Disconnect from current project first
            if (this.collaborativeManager && this.collaborativeManager.isConnected && this.collaborativeManager.currentProject) {
                console.log('Leaving current project before switching...');
                // Stop all sync timers
                this.collaborativeManager.stopPeriodicSync();
                this.collaborativeManager.stopAutoSave();
                this.collaborativeManager.stopHeartbeat();
                
                // Leave the current project room
                if (this.collaborativeManager.currentProject.id) {
                    this.collaborativeManager.socket.emit('leave_project', { 
                        projectId: this.collaborativeManager.currentProject.id 
                    });
                }
                
                // Clear the current project reference
                this.collaborativeManager.currentProject = null;
                this.collaborativeManager.sequenceNumber = 0;
            }
            
            // Save current canvas if needed
            if (this.currentCanvasId && this.collaborativeManager) {
                // Force save even if hasUnsavedChanges is false, to ensure we don't lose data
                if (this.app.graph.nodes.length > 0 || this.collaborativeManager.hasUnsavedChanges) {
                    console.log('💾 Saving current canvas before switching...');
                    console.log('💾 Current canvas ID:', this.currentCanvasId);
                    console.log('💾 Current nodes:', this.app.graph.nodes.length);
                    this.collaborativeManager.hasUnsavedChanges = true;
                    await this.collaborativeManager.save();
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
            
            // Clear the current canvas
            console.log('🧹 Clearing canvas, current nodes:', this.app.graph.nodes.length);
            this.app.graph.clear();
            console.log('🧹 Canvas cleared, nodes after clear:', this.app.graph.nodes.length);
            
            // Update current canvas ID
            this.currentCanvasId = canvasId;
            localStorage.setItem('lastCanvasId', canvasId.toString());
            
            // Reset collaborative manager state
            if (this.collaborativeManager) {
                this.collaborativeManager.hasUnsavedChanges = false;
                this.collaborativeManager.lastSaveTime = Date.now();
            }
            
            // Load the canvas data
            try {
                const response = await fetch(CONFIG.ENDPOINTS.PROJECT_CANVAS(canvasId));
                if (!response.ok) throw new Error('Failed to fetch canvas');
                
                const data = await response.json();
                
                if (data.canvas_data) {
                    // Load the state with external data
                    console.log('📥 Loading canvas data, nodes:', data.canvas_data.nodes?.length || 0);
                    await this.app.stateManager.loadState(this.app.graph, this.app.graphCanvas, data.canvas_data);
                    console.log('✅ Canvas data loaded, current nodes:', this.app.graph.nodes.length);
                    
                    // NOW join the new project if collaborative
                    console.log('🔌 Checking collaborative state:', {
                        hasManager: !!this.collaborativeManager,
                        isConnected: this.collaborativeManager?.isConnected,
                        socket: !!this.collaborativeManager?.socket
                    });
                    
                    if (this.collaborativeManager && this.collaborativeManager.isConnected) {
                        // Join will set currentProject and start sync
                        console.log('🔌 Joining collaborative project:', canvasId);
                        await this.collaborativeManager.joinProject(canvasId);
                    } else {
                        console.log('⚠️ Not joining project - collaborative not ready');
                    }
                    
                    // Show success
                    if (this.collaborativeManager) {
                        this.collaborativeManager.showStatus('Canvas loaded', 'success');
                    }
                } else {
                    console.log('📭 No canvas data found - starting with empty canvas');
                    
                    // Still need to join the project for collaboration
                    console.log('🔌 Checking collaborative state (empty canvas):', {
                        hasManager: !!this.collaborativeManager,
                        isConnected: this.collaborativeManager?.isConnected,
                        socket: !!this.collaborativeManager?.socket
                    });
                    
                    if (this.collaborativeManager && this.collaborativeManager.isConnected) {
                        console.log('🔌 Joining collaborative project (empty):', canvasId);
                        await this.collaborativeManager.joinProject(canvasId);
                    } else {
                        console.log('⚠️ Not joining project - collaborative not ready');
                    }
                }
            } catch (error) {
                console.error('Error loading canvas data:', error);
                // Continue with empty canvas but still join project
                if (this.collaborativeManager && this.collaborativeManager.isConnected) {
                    await this.collaborativeManager.joinProject(canvasId);
                }
            }
            
            // Update UI
            this.renderCanvasList();
            
            // Close navigator - DISABLED for testing
            // this.close();
            
        } catch (error) {
            console.error('Failed to load canvas:', error);
            alert('Failed to load canvas: ' + error.message);
        }
    }
    
    async deleteCanvas(canvasId) {
        const canvas = this.canvases.find(c => c.id === canvasId);
        if (!canvas) return;
        
        if (!confirm(`Delete "${canvas.name}"? This cannot be undone.`)) return;
        
        try {
            const response = await fetch(CONFIG.ENDPOINTS.PROJECT(canvasId), {
                method: 'DELETE'
            });
            
            if (!response.ok) throw new Error('Failed to delete canvas');
            
            // If we deleted the current canvas, clear it
            if (canvasId === this.currentCanvasId) {
                this.app.graph.clear();
                this.currentCanvasId = null;
            }
            
            // Refresh the list
            this.loadCanvases();
        } catch (error) {
            console.error('Failed to delete canvas:', error);
            alert('Failed to delete canvas');
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
            if (this.collaborativeManager) {
                this.collaborativeManager.showStatus(`Duplicated canvas: ${name}`, 'success');
            }
        } catch (error) {
            console.error('Failed to duplicate canvas:', error);
            alert('Failed to duplicate canvas');
        }
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
            if (this.collaborativeManager) {
                this.collaborativeManager.showStatus(`Renamed to "${newName}"`, 'success');
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
        if (this.collaborativeManager && this.collaborativeManager.hasUnsavedChanges) {
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
            if (this.collaborativeManager && this.collaborativeManager.isConnected) {
                this.collaborativeManager.joinProject(newCanvas.id);
            }
            
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
            // Check if we're in a duplicate tab by looking for session storage marker
            const tabId = Date.now() + '-' + Math.random();
            const existingTabId = sessionStorage.getItem('imageCanvasTabId');
            
            if (existingTabId) {
                console.log('⚠️ Duplicate tab detected - starting fresh');
                // This is a duplicate tab, don't load the last canvas
                // Clear any residual state
                this.app.graph.clear();
                this.currentCanvasId = null;
                
                // Show the canvas navigator so user can choose
                setTimeout(() => this.open(), 1000);
                return;
            }
            
            // Mark this tab
            sessionStorage.setItem('imageCanvasTabId', tabId);
            
            // Get last used canvas from localStorage
            const lastCanvasId = localStorage.getItem('lastCanvasId');
            
            if (lastCanvasId) {
                // Try to load the last canvas by checking if it exists in user's projects
                const response = await fetch(CONFIG.ENDPOINTS.USER_PROJECTS(this.userId));
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
            const response = await fetch(CONFIG.ENDPOINTS.USER_PROJECTS(this.userId));
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
            if (this.collaborativeManager && this.collaborativeManager.isConnected) {
                this.collaborativeManager.joinProject(newCanvas.id);
            }
            
            // Refresh the list
            await this.loadCanvases();
            
            // Show welcome message
            if (this.collaborativeManager) {
                this.collaborativeManager.showStatus('Welcome! Your first canvas has been created.', 'success');
            }
            
            return newCanvas;
        } catch (error) {
            console.error('Failed to create default canvas:', error);
            return null;
        }
    }
}

// Export for use
window.CanvasNavigator = CanvasNavigator;