// Canvas Navigator UI Component
// Provides a panel for managing canvases

class CanvasNavigator {
    constructor(app) {
        this.app = app;
        // Don't set collaborativeManager here - it's not ready yet
        this.isOpen = false;
        this.canvases = [];
        this.currentCanvasId = null;
        this.activeUsersPerCanvas = new Map(); // canvasId -> array of users
        
        // Generate a unique user ID for this session
        // This will be consistent across tabs in the same browser session
        this.userId = this.getOrCreateUserId();
        
        this.createUI();
        this.setupEventListeners();
        this.setupUserProfileListener();
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
                <div class="header-controls">
                    <button class="user-btn" title="User Profile">
                        <span class="user-avatar">👤</span>
                    </button>
                    <button class="close-btn" title="Close">×</button>
                </div>
            </div>
            <div class="navigator-toolbar">
                <button class="new-canvas-btn">
                    <span class="icon">+</span>
                </button>
                <!-- <button class="refresh-btn" title="Refresh">
                    <span class="icon">↻</span>
                </button> -->
                <!-- <h2 class="shared-canvases-title">
                    Shared Canvases
                </h2> -->
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
                <button class="admin-btn" title="Admin Panel">
                    <span class="icon">⚙️</span>
                    <!-- Admin -->
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
                background: rgba(30, 30, 30, 0.85);
                backdrop-filter: blur(10px);
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
                color: ${COLORS.text.emphasized};
            }
            
            .header-controls {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            
            .user-btn {
                background: none;
                border: none;
                color: #999;
                font-size: 16px;
                cursor: pointer;
                padding: 0;
                width: 28px;
                height: 28px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: all 0.2s;
                border: 1px solid transparent;
            }
            
            .user-btn:hover {
                opacity: 0.85;
                transform: scale(1.05);
            }
            
            .user-avatar {
                font-size: 14px;
                line-height: 1;
            }
            
            .close-btn {
                background: none;
                border: none;
                color:  ${COLORS.text.muted};
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
                /*background: ${COLORS.buttons.hover_secondary};*/
                color: ${COLORS.text.emphasized};
            }
            
            /* Toolbar */
            .navigator-toolbar {
                padding: 4px 12px;
                /*border-bottom: 1px solid #333;*/
                display: flex;
                gap: 8px;
            }
            
            .shared-canvases-title {
                font-size: 12px;
                font-weight: bold;
                margin: 4px !important;
                padding: 8px 0px;
                color: ${COLORS.text.base};
                word-break: break-word;
                flex: 1;
                min-width: 0;
                line-height: 1.2;
                display: flex;
                align-items: center;
            }
            
            .new-canvas-btn {
                background: none;
                border: none;
                color: ${COLORS.text.muted};
                padding: 0;
                border-radius: 4px;
                cursor: pointer;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }
            .new-canvas-btn:hover {
                /*background: ${COLORS.buttons.hover_secondary};*/
                color: ${COLORS.text.emphasized};
            }
            
            .new-canvas-btn .icon {
                font-size: 16px;
                line-height: 1;
            }
            
            .refresh-btn {
                background: ${COLORS.buttons.secondary};
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
                background: ${COLORS.buttons.hover_secondary};
                color: #fff;
            }
            
            /* Canvas List */
            .canvas-list-container {
                flex: 1;
                overflow-y: auto;
                padding: 0px 12px   ;
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
                background: ${COLORS.buttons.secondary};
                /*border: 1px solid #333;*/
                border-radius: 4px;
                padding: 4px 8px;
                cursor: pointer;
                transition: all 0.2s;
                position: relative;
            }
            
            .canvas-item:hover {
                background: ${COLORS.buttons.hover_secondary};
                border-color: #444;
                /*transform: translateX(2px);*/
            }
            
            .canvas-item.active {
                background:${COLORS.buttons.active_secondary};
                padding: 4px 7px;
            }
            
            .canvas-item-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 0;
                gap: 4px;
            }
            
            .canvas-item-right {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .canvas-active-users {
                display: flex;
                align-items: center;
                gap: -4px; /* Overlap indicators slightly */
            }
            
            .user-indicator {
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: #333;
                border: 2px solid;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
                font-weight: bold;
                color: #fff;
                position: relative;
                z-index: 1;
                transition: transform 0.1s ease;
            }
            
            .user-indicator:hover {
                transform: scale(1.1);
                z-index: 2;
                cursor: pointer;
            }
            
            .user-indicator.following {
                box-shadow: 0 0 0 3px rgba(68, 170, 255, 0.5);
                background: rgba(68, 170, 255, 0.2);
            }
            
            .canvas-title {
                font-size: 12px;
                font-weight: 300;
                margin: 4px !important;
                padding: 0;
                color: ${COLORS.text.base};
                word-break: break-word;
                flex: 1;
                min-width: 0;
                line-height: 1.2;
                display: block;
            }
            
            .canvas-item.active .canvas-title {
                color: ${COLORS.text.emphasized};
                font-weight: bold;
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
                background: ${COLORS.buttons.hover_confirm};
                color: #fff;
            }
            
            .canvas-action-btn.delete:hover {
                background: ${COLORS.buttons.hover_warning};
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
                font-size: 9    px;
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
            
            .admin-btn {
                background: none;
                border: none;
                color: #999;
                padding: 0;
                border-radius: 4px;
                cursor: pointer;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
            }
            
            .admin-btn:hover {
                background: ${COLORS.buttons.hover_secondary};
                color: #fff;
            }
            
            .admin-btn.loading {
                opacity: 0.6;
                cursor: not-allowed;
            }
            
            .admin-btn .icon {
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
        
        // User button
        const userBtn = this.panel.querySelector('.user-btn');
        if (userBtn) {
            userBtn.addEventListener('click', () => {
                if (window.app?.userProfilePanel) {
                    window.app.userProfilePanel.toggle();
                }
            });
        }
        
        // New canvas button
        this.panel.querySelector('.new-canvas-btn').addEventListener('click', () => this.createNewCanvas());
        
        // Network events will be set up later when network layer is available
        
        // Refresh button
        const refreshBtn = this.panel.querySelector('.refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadCanvases());
        }
        
        // Admin button
        const adminBtn = this.panel.querySelector('.admin-btn');
        if (adminBtn) {
            adminBtn.addEventListener('click', () => {
                this.openAdminPanel();
            });
        } else {
            console.error('Admin button not found');
        }
        
        // Note: Ctrl/Cmd + O shortcut is now handled by the main keyboard shortcuts system
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
        
        // Set current canvas ID from localStorage if not already set
        if (!this.currentCanvasId) {
            const lastCanvasId = localStorage.getItem('lastCanvasId');
            if (lastCanvasId) {
                this.currentCanvasId = parseInt(lastCanvasId);
            }
        }
        
        // Update user avatar display
        if (window.app?.userProfileSystem?.currentUser) {
            this.updateUserAvatar(window.app.userProfileSystem.currentUser);
        }
        
        this.loadCanvases();
        this.updateDatabaseSize();
    }
    
    close() {
        this.isOpen = false;
        this.panel.classList.remove('open');
        this.toggleBtn.classList.remove('active');
    }
    
    updateUserAvatar(user) {
        const userAvatar = this.panel.querySelector('.user-avatar');
        const userBtn = this.panel.querySelector('.user-btn');
        if (!userAvatar || !userBtn) return;
        
        if (user) {
            // Show user's first initial with colored background
            userAvatar.textContent = user.username.charAt(0).toUpperCase();
            const userColor = window.app?.userProfileSystem?.getUserColor() || '#4a90e2';
            
            // Style the button as a colored circle with initial
            userBtn.style.background = userColor;
            userBtn.style.color = '#fff';
            userBtn.style.fontWeight = '600';
            userBtn.style.border = `1px solid ${userColor}`;
            userAvatar.style.color = '#fff';
        } else {
            // Show default avatar for guest
            userAvatar.textContent = '👤';
            userBtn.style.background = 'none';
            userBtn.style.color = '#999';
            userBtn.style.fontWeight = 'normal';
            userBtn.style.border = '1px solid transparent';
            userAvatar.style.color = '#999';
        }
    }
    
    async loadCanvases() {
        const listContainer = this.panel.querySelector('.canvas-list');
        listContainer.innerHTML = '<div class="loading-spinner">Loading...</div>';
        listContainer.classList.add('loading');
        
        try {
            // Use general canvases endpoint to show all canvases
            // Add cache-busting timestamp to ensure fresh data
            const response = await fetch(`${CONFIG.ENDPOINTS.PROJECTS}?t=${Date.now()}`);
            if (!response.ok) throw new Error('Failed to load canvases');
            
            this.canvases = await response.json();
            console.log('Loaded canvases:', this.canvases.length);
            
            // Ensure there's always at least one canvas
            if (this.canvases.length === 0) {
                console.log('🎨 No canvases found - creating default "Untitled Canvas"');
                
                try {
                    const createResponse = await fetch(CONFIG.ENDPOINTS.PROJECTS, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: 'Untitled Canvas',
                            ownerId: this.userId,
                            description: ''
                        })
                    });
                    
                    if (createResponse.ok) {
                        const newCanvas = await createResponse.json();
                        this.canvases = [newCanvas];
                        
                        // Update localStorage
                        localStorage.setItem('lastCanvasId', newCanvas.id);
                        localStorage.setItem('currentCanvasId', newCanvas.id);
                        localStorage.setItem('activeCanvasId', newCanvas.id);
                        
                        console.log('✅ Created default canvas:', newCanvas);
                        
                        // Actually load the canvas to join it
                        await this.loadCanvas(newCanvas.id);
                    }
                } catch (createError) {
                    console.error('Failed to create default canvas:', createError);
                }
            }
            
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
                if (!e.target.closest('.canvas-actions') && 
                    !e.target.closest('.canvas-title-input') &&
                    !e.target.closest('.user-indicator')) {
                    this.loadCanvas(canvasId);
                }
            });
            
            // Add click handlers for user indicators
            item.querySelectorAll('.user-indicator').forEach(indicator => {
                indicator.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const userId = indicator.dataset.userId;
                    if (window.app?.userFollowManager) {
                        window.app.userFollowManager.toggleFollowing(userId);
                    }
                });
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
        if (isActive) {
            console.log(`Rendering canvas ${canvas.id} as active`);
        }
        const lastModified = new Date(canvas.last_modified).toLocaleDateString();
        const collaboratorCount = canvas.collaborator_count || 0;
        
        // Get active users for this canvas (excluding current user)
        const activeUsers = this.activeUsersPerCanvas.get(canvas.id) || [];
        // Use numeric user ID from network layer for comparison
        const currentNumericUserId = this.app?.networkLayer?.numericUserId;
        const otherUsers = activeUsers.filter(user => user.userId !== currentNumericUserId);
        const userIndicators = otherUsers.map(user => this.renderUserIndicator(user)).join('');
        
        return `
            <div class="canvas-item ${isActive ? 'active' : ''}" data-canvas-id="${canvas.id}">
                <div class="canvas-item-header">
                    <h4 class="canvas-title" data-canvas-id="${canvas.id}" data-original-name="${this.escapeHtml(canvas.name || 'Untitled Canvas')}">${this.escapeHtml(canvas.name || 'Untitled Canvas')}</h4>
                    <div class="canvas-item-right">
                        ${otherUsers.length > 0 ? `<div class="canvas-active-users">${userIndicators}</div>` : ''}
                        <div class="canvas-actions"><button class="canvas-action-btn duplicate" title="Duplicate">📋</button><button class="canvas-action-btn delete" title="Delete">🗑️</button></div>
                    </div>
                </div>
                <!-- <div class="canvas-meta">
                    <span>Modified: ${lastModified}</span>
                    ${collaboratorCount > 0 ? `<span class="collaborator-count">👥 ${collaboratorCount}</span>` : ''}
                </div> -->
            </div>
        `;
    }
    
    renderUserIndicator(user) {
        const initial = user.username ? user.username.charAt(0).toUpperCase() : '?';
        const displayName = user.displayName || user.username || 'Guest';
        const isFollowing = this.followingUserId === user.userId;
        return `<div class="user-indicator ${isFollowing ? 'following' : ''}" 
                     style="border-color: ${user.color}" 
                     title="${this.escapeHtml(displayName)} - Click to follow"
                     data-user-id="${user.userId}">${initial}</div>`;
    }
    
    updateFollowingState(followingUserId) {
        this.followingUserId = followingUserId;
        this.renderCanvasList();
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
            
            // Join the canvas if collaborative
            // Join using the new NetworkLayer if available
            if (this.app.networkLayer) {
                await this.joinProjectWithRetry(newCanvas.id);
            }
            
            // Project joining is now handled by NetworkLayer
            
            // Refresh the list
            this.loadCanvases();
            
        } catch (error) {
            
            alert('Failed to create canvas');
        }
    }
    
    async loadCanvas(canvasId) {
        try {
            
            // Don't reload if it's already the current canvas
            if (this.currentCanvasId === canvasId) {
                
                // this.close(); // DISABLED for testing
                return;
            }
            
            // Update UI immediately to show active state
            const previousCanvasId = this.currentCanvasId;
            this.currentCanvasId = canvasId;
            this.renderCanvasList(); // Update UI immediately
            
            // Show loading notification
            if (this.app.showNotification) {
                this.app.showNotification({
                    type: 'info',
                    message: 'Loading canvas...',
                    duration: 1000
                });
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
                    
                }
            }
            
            // Disconnect from current canvas first
            if (this.networkLayer && this.networkLayer.isConnected && this.networkLayer.currentProject) {
                
                // NetworkLayer handles its own cleanup
                
                // Leave the current canvas room and wait for confirmation
                if (this.networkLayer.currentProject.id) {
                    await this.leaveCanvasAndWait(this.networkLayer.currentCanvas.id);
                }
                
                // NetworkLayer manages its own state
            }
            
            // Save current canvas if needed
            if (this.currentCanvasId && this.networkLayer) {
                // Force save even if hasUnsavedChanges is false, to ensure we don't lose data
                if (this.app.graph.nodes.length > 0) {

                    // Mark as needing save
                    // Saving is now handled by PersistenceHandler
                    if (this.persistenceHandler) {
                        try {
                            await this.persistenceHandler.save();
                        } catch (error) {
                            
                            // Continue with canvas switch even if save fails
                        }
                    } else {
                        
                    }
                    
                } else {
                    
                }
            } else if (!this.currentCanvasId && this.app.graph.nodes.length > 0) {
                // Don't auto-save if we're in a duplicated tab situation
                
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
            console.log(`Canvas loaded: ID ${canvasId} now active`);
            
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
                    
                    // NOW join the new canvas if collaborative
                    
                    // Join using the new NetworkLayer with retry logic
                    if (this.app.networkLayer) {
                        await this.joinProjectWithRetry(canvasId);
                    } else {
                        
                    }
                    
                    // Show success
                    // if (this.app.showNotification) {
                    //     this.app.showNotification({
                    //         type: 'success',
                    //         message: 'Canvas loaded'
                    //     });
                    // }
                } else {
                    
                    // Still need to join the canvas for collaboration
                    
                    // Join using the new NetworkLayer with retry logic
                    if (this.app.networkLayer) {
                        await this.joinProjectWithRetry(canvasId);
                    } else {
                        
                    }
                }
            } catch (error) {
                
                // Continue with empty canvas but still join it
                // Join using the new NetworkLayer with retry logic
                if (this.app.networkLayer) {
                    await this.joinProjectWithRetry(canvasId);
                }
            }
            
            // Start auto-save for this canvas
            this.startAutoSave();
            
            // Close navigator - DISABLED for testing
            // this.close();
            
        } catch (error) {
            console.error('Failed to load canvas:', error);
            
            // Revert to previous canvas on failure
            this.currentCanvasId = previousCanvasId;
            this.renderCanvasList();
            
            alert('Failed to load canvas: ' + error.message);
        }
    }
    
    async deleteCanvas(canvasId) {
        const canvas = this.canvases.find(c => c.id === canvasId);
        if (!canvas) {
            
            return;
        }
        
        if (!confirm(`Delete "${canvas.name}"? This cannot be undone.`)) {
            
            return;
        }
        
        try {
            const deleteUrl = CONFIG.ENDPOINTS.PROJECT(canvasId);
            
            const response = await fetch(deleteUrl, {
                method: 'DELETE'
            });

            if (!response.ok) {
                const errorText = await response.text();
                
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
            
            alert('Failed to duplicate canvas');
        }
    }
    
    async leaveCanvasAndWait(canvasId) {
        return new Promise((resolve) => {
            
            // Set up one-time listener for leave confirmation
            const leaveHandler = (data) => {
                if (data && parseInt(data.canvasId) === parseInt(canvasId)) {
                    this.networkLayer.socket.off('canvas_left', leaveHandler);
                    resolve();
                }
            };
            
            // Set up timeout in case server doesn't respond
            const timeout = setTimeout(() => {
                this.networkLayer.socket.off('canvas_left', leaveHandler);
                resolve();
            }, 2000); // 2 second timeout
            
            // Listen for confirmation
            this.networkLayer.socket.on('canvas_left', leaveHandler);
            
            // Emit leave request
            this.networkLayer.socket.emit('leave_canvas', { 
                canvasId: canvasId 
            });
            
            // Clear timeout on confirmation
            this.networkLayer.socket.once('canvas_left', () => {
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
                        
                        if (attempt === maxAttempts) {
                            
                            return false;
                        }
                        continue; // Try next attempt
                    }
                }
                
                // Now try to join the canvas
                const joined = await this.app.networkLayer.joinCanvas(canvasId);
                
                if (!joined) {
                    console.error('Failed to join canvas via network');
                    return false;
                }
                
                // Check if the undo manager has the canvas ID set (indicates successful join)
                if (this.app.undoManager && this.app.undoManager.canvasId === canvasId) {
                    return true;
                }
                
                // For now, assume success if we got this far
                return true;
                
            } catch (error) {
                
                if (attempt === maxAttempts) {
                    
                    return false;
                }
                
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
        
        return false;
    }
    
    setupNetworkListeners() {
        if (!this.networkLayer) return;
        
        this.networkLayer.on('active_users', (users) => {
            this.updateActiveUsersForCurrentCanvas(users);
        });
        
        this.networkLayer.on('user_joined', (user) => {
            this.updateActiveUsersForCurrentCanvas();
        });
        
        this.networkLayer.on('user_left', (user) => {
            this.updateActiveUsersForCurrentCanvas();
        });
    }
    
    updateActiveUsersForCurrentCanvas(users) {
        if (!this.currentCanvasId) return;
        
        // If users are provided, update the map
        if (users) {
            this.activeUsersPerCanvas.set(this.currentCanvasId, users);
        }
        
        // Re-render the canvas list to update user indicators
        this.renderCanvasList();
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
            
            // Join the canvas if collaborative
            // Join using the new NetworkLayer if available
            if (this.app.networkLayer) {
                await this.joinProjectWithRetry(newCanvas.id);
            }
            
            // Project joining is now handled by NetworkLayer
            
            // Refresh the list
            await this.loadCanvases();
            
            return newCanvas;
        } catch (error) {
            
            if (!silent) {
                alert('Failed to save canvas');
            }
            return null;
        }
    }
    
    async loadStartupCanvas() {
        
        try {
            // Clear any cached data first
            this.canvases = [];
            this.currentCanvasId = null;
            
            // Wait for network layer to be ready if it exists
            if (this.app.networkLayer) {
                let networkAttempts = 0;
                const maxNetworkAttempts = 20; // 10 seconds
                
                while (!this.app.networkLayer.isConnected && networkAttempts < maxNetworkAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    networkAttempts++;
                    
                }
                
                if (!this.app.networkLayer.isConnected) {
                    
                }
            }
            
            // Check if we're in demo mode
            const isDemoMode = window.location.pathname.includes('demo.html');
            
            if (isDemoMode) {
                // For demo mode, just load the first available canvas or create a new untitled one
                await this.loadCanvases();
                
                if (this.canvases.length > 0) {
                    // Load the first available canvas
                    await this.loadCanvas(this.canvases[0].id);
                } else {
                    // Create a new untitled canvas
                    const response = await fetch(CONFIG.ENDPOINTS.PROJECTS, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: 'Untitled Canvas',
                            ownerId: 1,
                            description: ''
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
                // Try to load the last canvas by checking if it exists in all canvases
                const response = await fetch(CONFIG.ENDPOINTS.PROJECTS);
                if (response.ok) {
                    const canvases = await response.json();
                    const lastCanvas = canvases.find(c => c.id === parseInt(lastCanvasId));
                    if (lastCanvas) {
                        await this.loadCanvas(parseInt(lastCanvasId));
                        return;
                    } else {
                        // Canvas no longer exists, clear the reference
                        localStorage.removeItem('lastCanvasId');
                        console.log('Last canvas no longer exists, cleared reference');
                    }
                }
            }
            
            // No last canvas or it doesn't exist, check if user has any canvases
            const response = await fetch(`${CONFIG.ENDPOINTS.PROJECTS}?t=${Date.now()}`);
            if (response.ok) {
                const canvases = await response.json();
                console.log(`Startup: Found ${canvases.length} canvases in database`);
                
                if (canvases.length > 0) {
                    // Load the most recent canvas
                    await this.loadCanvas(canvases[0].id);
                } else {
                    console.log('No canvases found, will create default canvas');
                    // No canvases exist, create a default one
                    const newCanvas = await this.createDefaultCanvas();
                    if (newCanvas) {
                        // Load the newly created canvas
                        await this.loadCanvas(newCanvas.id);
                    }
                }
            }
        } catch (error) {
            
            // Continue with blank canvas
        }
    }
    
    async createDefaultCanvas() {
        try {
            const response = await fetch(CONFIG.ENDPOINTS.PROJECTS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'Untitled Canvas',
                    ownerId: this.userId,
                    description: ''
                })
            });
            
            if (!response.ok) throw new Error('Failed to create default canvas');
            
            const newCanvas = await response.json();
            
            // Set as current canvas and save to localStorage
            this.currentCanvasId = newCanvas.id;
            localStorage.setItem('lastCanvasId', newCanvas.id.toString());
            
            // Join the canvas if collaborative
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
                
                return false;
            }
            
            // Update last modified time in local cache
            const canvas = this.canvases.find(c => c.id === this.currentCanvasId);
            if (canvas) {
                canvas.last_modified = new Date().toISOString();
            }
            
            return true;
        } catch (error) {
            
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
            
            const sizeElement = this.panel.querySelector('.size-value');
            if (sizeElement) {
                sizeElement.textContent = 'Error';
            }
        }
    }
    
    async performCleanup() {
        const cleanupBtn = this.panel.querySelector('.cleanup-btn');
        if (!cleanupBtn) {
            
            return;
        }
        
        if (cleanupBtn.classList.contains('loading')) {
            
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
            background: rgba(30, 30, 30, 0.95);
            border: 1px solid #333;
            border-radius: 8px;
            padding: 20px;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            max-width: 360px;
            color: #e0e0e0;
            font-family: ${FONT_CONFIG.APP_FONT};
        `;
        
        dialog.innerHTML = `
            <h3 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 500; color: #fff;">Clean Up</h3>
            
            <div id="cleanup-stats" style="margin: 0 0 16px 0; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 6px; font-size: 12px; line-height: 1.6;">
                <div style="display: flex; align-items: center; justify-content: center; color: #666;">
                    <span style="animation: spin 1s linear infinite; display: inline-block; margin-right: 8px;">⟳</span>
                    Calculating...
                </div>
            </div>
            
            <div style="margin-bottom: 16px;">
                <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 8px;">
                    <input type="checkbox" id="cleanup-all-thumbnails" style="margin-right: 8px;">
                    <span style="font-size: 13px;">Clear all thumbnails</span>
                </label>
                <label style="display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" id="cleanup-indexeddb" style="margin-right: 8px;">
                    <span style="font-size: 13px;">Clear browser cache</span>
                </label>
            </div>

            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="cleanup-cancel" style="padding: 6px 16px; background: #333; border: none; border-radius: 4px; color: #999; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s;">Cancel</button>
                <button id="cleanup-proceed" style="padding: 6px 16px; background: #4CAF50; border: none; border-radius: 4px; color: #fff; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s;">Clean Up</button>
            </div>
        `;
        
        // Add spinning animation style
        const style = document.createElement('style');
        style.textContent = `
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
        
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
        
        // Function to update stats display
        const updateStats = async (deleteAllThumbnails = false) => {
            const statsDiv = document.getElementById('cleanup-stats');
            statsDiv.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; color: #666;">
                    <span style="animation: spin 1s linear infinite; display: inline-block; margin-right: 8px;">⟳</span>
                    Calculating...
                </div>
            `;
            
            try {
                // Run dry run to get stats
                const params = new URLSearchParams();
                params.append('dryRun', 'true');
                if (deleteAllThumbnails) params.append('deleteAllThumbnails', 'true');
                
                const response = await fetch(`${CONFIG.ENDPOINTS.DATABASE_CLEANUP}?${params}`, {
                    method: 'POST'
                });
                const result = await response.json();
                
                // Calculate totals
                let orphanedFiles = 0;
                let thumbnailCount = 0;
                let operationCount = 0;
                
                if (result.fileCleanup) {
                    orphanedFiles = result.fileCleanup.orphanedFiles || 0;
                }
                
                if (result.operationsDeleted !== undefined) {
                    operationCount = result.operationsDeleted;
                }
                
                // Estimate thumbnails (if checkbox is checked)
                if (deleteAllThumbnails) {
                    // Rough estimate: 6 sizes per image
                    thumbnailCount = orphanedFiles * 6;
                }
                
                // Get IndexedDB size estimate
                let indexedDBSize = 0;
                let thumbnailDBSize = 0;
                
                if (navigator.storage && navigator.storage.estimate) {
                    const estimate = await navigator.storage.estimate();
                    indexedDBSize = estimate.usage || 0;
                }
                
                // Try to get more specific info about thumbnail DB
                try {
                    // Check if the thumbnail database exists
                    const dbExists = await new Promise((resolve) => {
                        const openReq = indexedDB.open('ImageCanvasThumbnails');
                        openReq.onsuccess = (e) => {
                            e.target.result.close(); // Close immediately
                            resolve(true);
                        };
                        openReq.onerror = () => resolve(false);
                    });
                    
                    if (dbExists && window.thumbnailStore && window.thumbnailStore.getStats) {
                        const stats = window.thumbnailStore.getStats();
                        // Estimate based on number of entries (rough estimate: 50KB per thumbnail)
                        thumbnailDBSize = (stats.writes || 0) * 50 * 1024;
                    }
                } catch (e) {
                    // Ignore errors
                }
                
                // Update display
                statsDiv.innerHTML = `
                    <div style="color: #e0e0e0;">
                        <div style="margin-bottom: 6px;">
                            <strong>Orphaned files:</strong> ${orphanedFiles}
                        </div>
                        <div style="margin-bottom: 6px;">
                            <strong>Operations/Undo history:</strong> ${operationCount}
                        </div>
                        ${deleteAllThumbnails ? `
                        <div style="margin-bottom: 6px;">
                            <strong>Thumbnails:</strong> ~${thumbnailCount}
                        </div>
                        ` : ''}
                        <div style="margin-bottom: 6px;">
                            <strong>Browser cache:</strong> ${(indexedDBSize / (1024 * 1024)).toFixed(1)} MB
                        </div>
                        ${orphanedFiles === 0 && operationCount === 0 && !deleteAllThumbnails ? `
                        <div style="margin-top: 8px; color: #4CAF50; font-size: 11px;">
                            ✓ Nothing to clean up
                        </div>
                        ` : ''}
                    </div>
                `;
            } catch (error) {
                statsDiv.innerHTML = `
                    <div style="color: #f44336;">
                        Failed to calculate cleanup stats
                    </div>
                `;
            }
        };
        
        // Initial stats load
        updateStats();
        
        // Update stats when thumbnail checkbox changes
        const thumbnailCheckbox = document.getElementById('cleanup-all-thumbnails');
        thumbnailCheckbox.addEventListener('change', () => {
            updateStats(thumbnailCheckbox.checked);
        });
        
        // Handle dialog actions
        const cleanup = async () => {
            // Get checkbox values before removing dialog
            const deleteAllThumbnails = document.getElementById('cleanup-all-thumbnails').checked;
            const clearIndexedDB = document.getElementById('cleanup-indexeddb').checked;
            
            // Now remove dialog elements
            backdrop.remove();
            dialog.remove();
            style.remove();
            
            // Clear IndexedDB if requested
            if (clearIndexedDB) {
                let indexedDBCleared = false;
                try {
                    // First, close any open connections
                    if (window.indexedDBThumbnailStore && window.indexedDBThumbnailStore.close) {
                        window.indexedDBThumbnailStore.close();
                        console.log('Closed IndexedDB connection');
                    }
                    
                    // Also try closing window.thumbnailStore if it exists
                    if (window.thumbnailStore && window.thumbnailStore !== window.indexedDBThumbnailStore) {
                        if (window.thumbnailStore.close) {
                            window.thumbnailStore.close();
                        }
                        window.thumbnailStore.isAvailable = false;
                        window.thumbnailStore.db = null;
                    }
                    
                    // Wait a bit for connections to close
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Delete the known thumbnail database
                    await new Promise((resolve, reject) => {
                        const deleteReq = indexedDB.deleteDatabase('ImageCanvasThumbnails');
                        deleteReq.onsuccess = () => {
                            console.log('✅ Deleted ImageCanvasThumbnails database');
                            indexedDBCleared = true;
                            resolve();
                        };
                        deleteReq.onerror = () => {
                            console.error('Failed to delete ImageCanvasThumbnails database');
                            reject(deleteReq.error);
                        };
                        deleteReq.onblocked = () => {
                            console.warn('Database deletion blocked - will force reload after cleanup');
                            // Mark that we need to reload
                            window._needsReloadAfterCleanup = true;
                            // Still resolve after a timeout
                            setTimeout(resolve, 1000);
                        };
                    });
                    
                    // Try to delete other potential databases
                    const otherDBs = ['ThumbnailStore', 'ImageCanvasDB', 'imageCanvas'];
                    for (const dbName of otherDBs) {
                        try {
                            await new Promise((resolve) => {
                                const deleteReq = indexedDB.deleteDatabase(dbName);
                                deleteReq.onsuccess = () => {
                                    console.log(`✅ Deleted ${dbName} database`);
                                    indexedDBCleared = true;
                                    resolve();
                                };
                                deleteReq.onerror = () => resolve();
                                deleteReq.onblocked = () => setTimeout(resolve, 100);
                            });
                        } catch (e) {
                            // Ignore errors for non-existent databases
                        }
                    }
                    
                    // Also clear any cached thumbnail references
                    if (window.thumbnailCache) {
                        window.thumbnailCache.clear();
                    }
                    
                    // Force reload of thumbnail store
                    if (window.thumbnailStore) {
                        window.thumbnailStore.isAvailable = false;
                        window.thumbnailStore.db = null;
                    }
                    
                } catch (error) {
                    console.error('Failed to clear IndexedDB:', error);
                }
            }
            
            // Proceed with server cleanup (never dry run now)
            await this.executeCleanup(false, 0, deleteAllThumbnails, clearIndexedDB);
        };
        
        // Add button hover effects
        const cancelBtn = document.getElementById('cleanup-cancel');
        const proceedBtn = document.getElementById('cleanup-proceed');
        
        cancelBtn.onmouseenter = () => { cancelBtn.style.background = '#444'; cancelBtn.style.color = '#fff'; };
        cancelBtn.onmouseleave = () => { cancelBtn.style.background = '#333'; cancelBtn.style.color = '#999'; };
        
        proceedBtn.onmouseenter = () => { proceedBtn.style.background = '#45a049'; };
        proceedBtn.onmouseleave = () => { proceedBtn.style.background = '#4CAF50'; };
        
        cancelBtn.onclick = () => {
            backdrop.remove();
            dialog.remove();
            style.remove();
        };
        
        proceedBtn.onclick = cleanup;
        
        // Focus on proceed button
        proceedBtn.focus();
        
        return;  // Exit here, actual cleanup happens in executeCleanup
    }
    
    async executeCleanup(dryRun = false, gracePeriod = 0, deleteAllThumbnails = false, clearIndexedDB = false) {
        const cleanupBtn = this.panel.querySelector('.cleanup-btn');
        if (!cleanupBtn) {
            
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
                    
                    // Request server to clear undo history for this canvas
                    if (this.currentCanvasId && this.networkLayer && this.networkLayer.socket) {
                        this.networkLayer.socket.emit('clear_undo_history', {
                            canvasId: this.currentCanvasId
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
                let message = '';
                
                if (dryRun) {
                    // For dry run, show what would be deleted
                    let fileCount = 0;
                    if (result.fileCleanup) {
                        fileCount = result.fileCleanup.deletedFiles;
                    } else if (result.deleted) {
                        fileCount = (result.deleted.files || 0) + (result.deleted.orphanedDiskFiles || 0);
                    }
                    
                    if (fileCount > 0) {
                        message = `Preview: ${fileCount} orphaned files found`;
                    } else {
                        message = 'Preview: No orphaned files found';
                    }
                } else {
                    // For actual cleanup, show what was deleted
                    let fileCount = 0;
                    if (result.fileCleanup) {
                        fileCount = result.fileCleanup.deletedFiles;
                    } else if (result.deleted) {
                        fileCount = (result.deleted.files || 0) + (result.deleted.orphanedDiskFiles || 0);
                    }
                    
                    if (fileCount > 0 || clearIndexedDB) {
                        const parts = [];
                        if (fileCount > 0) parts.push(`${fileCount} files removed`);
                        if (clearIndexedDB) parts.push('browser cache cleared');
                        message = `Cleanup complete: ${parts.join(', ')}`;
                    } else {
                        message = 'Cleanup complete: No orphaned files';
                    }
                }
                
                this.app.showNotification({
                    type: 'success',
                    message: message
                });
            }

        } catch (error) {
            
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
            
            // If IndexedDB deletion was blocked and we need to reload
            if (window._needsReloadAfterCleanup) {
                delete window._needsReloadAfterCleanup;
                
                // Show reload notification
                if (this.app.showNotification) {
                    this.app.showNotification({
                        type: 'info',
                        message: 'Reloading page to complete cleanup...'
                    });
                }
                
                // Reload after a short delay
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            }
        }
    }
    
    /**
     * Open the admin panel
     */
    openAdminPanel() {
        // Check if admin panel already exists
        if (window.adminPanel) {
            window.adminPanel.show();
            return;
        }
        
        // Load admin panel script if not already loaded
        if (!window.AdminPanel) {
            const script = document.createElement('script');
            script.src = '/js/ui/admin-panel.js';
            script.onload = () => {
                // Create and show admin panel after script loads
                window.adminPanel = new AdminPanel(this);
                window.adminPanel.show();
            };
            script.onerror = () => {
                console.error('Failed to load admin panel script');
                if (this.app.showNotification) {
                    this.app.showNotification({
                        type: 'error',
                        message: 'Failed to load admin panel'
                    });
                }
            };
            document.head.appendChild(script);
        } else {
            // Create and show admin panel
            window.adminPanel = new AdminPanel(this);
            window.adminPanel.show();
        }
    }
    
    /**
     * Setup user profile listener with retry mechanism
     */
    setupUserProfileListener() {
        const trySetup = () => {
            if (this.app?.userProfileSystem) {
                // Remove any existing listener first to avoid duplicates
                if (this._userChangedHandler) {
                    this.app.userProfileSystem.removeListener('userChanged', this._userChangedHandler);
                }
                
                // Create and store the handler
                this._userChangedHandler = (user) => {
                    this.updateUserAvatar(user);
                };
                
                // Add the listener
                this.app.userProfileSystem.addListener('userChanged', this._userChangedHandler);
                
                // Update avatar immediately if user is already logged in
                if (this.app.userProfileSystem.currentUser) {
                    this.updateUserAvatar(this.app.userProfileSystem.currentUser);
                }
                
                return true;
            }
            return false;
        };
        
        // Try immediately
        if (!trySetup()) {
            // If not available, retry periodically
            const retryInterval = setInterval(() => {
                if (trySetup()) {
                    clearInterval(retryInterval);
                }
            }, 100);
            
            // Stop trying after 5 seconds
            setTimeout(() => clearInterval(retryInterval), 5000);
        }
    }
}

// Export for use
window.CanvasNavigator = CanvasNavigator;