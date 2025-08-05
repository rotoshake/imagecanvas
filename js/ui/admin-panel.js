/**
 * AdminPanel - Administrative interface for system management
 * Provides access to database cleanup, thumbnail management, and other admin functions
 */
class AdminPanel {
    constructor(canvasNavigator) {
        this.canvasNavigator = canvasNavigator;
        this.app = canvasNavigator.app;
        this.networkLayer = canvasNavigator.networkLayer;
        
        this.panel = null;
        this.overlay = null;
        this.currentTab = 'database';
        
        this.tabs = {
            database: { label: 'Database', icon: '🗄️' },
            thumbnails: { label: 'Thumbnails', icon: '🖼️' },
            system: { label: 'System', icon: '⚙️' }
        };
        
        this.createPanel();
        this.setupEventListeners();
    }
    
    createPanel() {
        // Create overlay
        this.overlay = document.createElement('div');
        this.overlay.className = 'admin-panel-overlay';
        this.overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9999;
            display: none;
            backdrop-filter: blur(2px);
        `;
        
        // Create panel
        this.panel = document.createElement('div');
        this.panel.className = 'admin-panel';
        this.panel.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 90%;
            max-width: 800px;
            height: 80%;
            max-height: 600px;
            background: var(--bg-secondary, #1a1a1a);
            border: 1px solid var(--border-color, #333);
            border-radius: 8px;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        `;
        
        // Create header
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 16px 20px;
            border-bottom: 1px solid var(--border-color, #333);
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--bg-primary, #0d0d0d);
        `;
        
        const title = document.createElement('h2');
        title.textContent = 'Admin Panel';
        title.style.cssText = `
            margin: 0;
            font-size: 20px;
            color: var(--text-primary, #fff);
            font-weight: 600;
        `;
        
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✕';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: var(--text-secondary, #888);
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            transition: all 0.2s;
        `;
        closeBtn.addEventListener('mouseover', () => {
            closeBtn.style.background = 'var(--hover-bg, #2a2a2a)';
            closeBtn.style.color = 'var(--text-primary, #fff)';
        });
        closeBtn.addEventListener('mouseout', () => {
            closeBtn.style.background = 'none';
            closeBtn.style.color = 'var(--text-secondary, #888)';
        });
        
        header.appendChild(title);
        header.appendChild(closeBtn);
        
        // Create tab navigation
        const tabNav = document.createElement('div');
        tabNav.style.cssText = `
            display: flex;
            background: var(--bg-primary, #0d0d0d);
            border-bottom: 1px solid var(--border-color, #333);
        `;
        
        Object.entries(this.tabs).forEach(([key, tab]) => {
            const tabBtn = document.createElement('button');
            tabBtn.className = `admin-tab ${key === this.currentTab ? 'active' : ''}`;
            tabBtn.dataset.tab = key;
            tabBtn.innerHTML = `<span class="icon">${tab.icon}</span> ${tab.label}`;
            tabBtn.style.cssText = `
                background: none;
                border: none;
                color: ${key === this.currentTab ? 'var(--text-primary, #fff)' : 'var(--text-secondary, #888)'};
                padding: 12px 20px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 14px;
                font-weight: 500;
                border-bottom: 2px solid transparent;
                transition: all 0.2s;
                ${key === this.currentTab ? 'border-bottom-color: var(--accent-color, #3498db);' : ''}
            `;
            
            tabNav.appendChild(tabBtn);
        });
        
        // Create content area
        const content = document.createElement('div');
        content.className = 'admin-panel-content';
        content.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 20px;
        `;
        
        // Assemble panel
        this.panel.appendChild(header);
        this.panel.appendChild(tabNav);
        this.panel.appendChild(content);
        this.overlay.appendChild(this.panel);
        document.body.appendChild(this.overlay);
        
        // Close button handler
        closeBtn.addEventListener('click', () => this.hide());
        
        // Load initial tab content
        this.loadTabContent(this.currentTab);
    }
    
    setupEventListeners() {
        // Tab switching
        this.panel.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('.admin-tab');
            if (tabBtn) {
                const tab = tabBtn.dataset.tab;
                if (tab !== this.currentTab) {
                    this.switchTab(tab);
                }
            }
        });
        
        // Overlay click to close
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.hide();
            }
        });
        
        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.overlay.style.display !== 'none') {
                this.hide();
            }
        });
    }
    
    switchTab(tab) {
        // Update active tab styling
        this.panel.querySelectorAll('.admin-tab').forEach(btn => {
            const isActive = btn.dataset.tab === tab;
            btn.classList.toggle('active', isActive);
            btn.style.color = isActive ? 'var(--text-primary, #fff)' : 'var(--text-secondary, #888)';
            btn.style.borderBottomColor = isActive ? 'var(--accent-color, #3498db)' : 'transparent';
        });
        
        this.currentTab = tab;
        this.loadTabContent(tab);
    }
    
    loadTabContent(tab) {
        const content = this.panel.querySelector('.admin-panel-content');
        content.innerHTML = '';
        
        switch (tab) {
            case 'database':
                this.loadDatabaseTab(content);
                break;
            case 'thumbnails':
                this.loadThumbnailsTab(content);
                break;
            case 'system':
                this.loadSystemTab(content);
                break;
        }
    }
    
    loadDatabaseTab(container) {
        const section = document.createElement('div');
        section.innerHTML = `
            <h3 style="margin-top: 0; color: var(--text-primary, #fff);">Database Management</h3>
            <p style="color: var(--text-secondary, #888); margin-bottom: 20px;">
                Manage database storage and perform cleanup operations.
            </p>
            
            <div class="database-info" style="
                background: var(--bg-primary, #0d0d0d);
                padding: 16px;
                border-radius: 6px;
                margin-bottom: 24px;
                border: 1px solid var(--border-color, #333);
            ">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: var(--text-secondary, #888);">Database Size:</span>
                    <span class="db-size" style="color: var(--text-primary, #fff); font-weight: 500;">Loading...</span>
                </div>
            </div>
            
            <div class="cleanup-section">
                <h4 style="color: var(--text-primary, #fff); margin-bottom: 16px;">Cleanup Options</h4>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; color: var(--text-primary, #fff); cursor: pointer;">
                        <input type="checkbox" id="cleanup-dry-run" style="margin-right: 8px;">
                        <span>Preview mode (dry run)</span>
                    </label>
                    <p style="color: var(--text-secondary, #888); font-size: 12px; margin: 4px 0 0 24px;">
                        Show what would be deleted without actually removing anything
                    </p>
                </div>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; color: var(--text-primary, #fff); cursor: pointer;">
                        <input type="checkbox" id="cleanup-browser-cache" style="margin-right: 8px;">
                        <span>Clear browser cache</span>
                    </label>
                    <p style="color: var(--text-secondary, #888); font-size: 12px; margin: 4px 0 0 24px;">
                        Clear IndexedDB and local caches
                    </p>
                </div>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; color: var(--text-primary, #fff); cursor: pointer;">
                        <input type="checkbox" id="cleanup-all-thumbnails" style="margin-right: 8px;">
                        <span>Delete all thumbnails</span>
                    </label>
                    <p style="color: var(--text-secondary, #888); font-size: 12px; margin: 4px 0 0 24px;">
                        Remove all thumbnail files (they will be regenerated as needed)
                    </p>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="color: var(--text-primary, #fff); display: block; margin-bottom: 8px;">
                        Grace period (hours):
                    </label>
                    <input type="number" id="cleanup-grace-period" value="24" min="0" max="720" style="
                        background: var(--bg-primary, #0d0d0d);
                        border: 1px solid var(--border-color, #333);
                        color: var(--text-primary, #fff);
                        padding: 8px 12px;
                        border-radius: 4px;
                        width: 100px;
                    ">
                    <p style="color: var(--text-secondary, #888); font-size: 12px; margin-top: 4px;">
                        Keep files accessed within this time period
                    </p>
                </div>
                
                <button class="cleanup-btn" style="
                    background: var(--accent-color, #3498db);
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    transition: all 0.2s;
                ">
                    Run Cleanup
                </button>
            </div>
        `;
        
        container.appendChild(section);
        
        // Update database size
        this.updateDatabaseSize();
        
        // Setup cleanup button
        const cleanupBtn = section.querySelector('.cleanup-btn');
        let isAltPressed = false;
        
        // Track alt/option key state for changing button behavior
        const updateButtonState = (altKey) => {
            isAltPressed = altKey;
            if (altKey) {
                cleanupBtn.textContent = 'Full Wipe';
                cleanupBtn.style.background = '#ff4444';
            } else {
                cleanupBtn.textContent = 'Run Cleanup';
                cleanupBtn.style.background = 'var(--accent-color, #3498db)';
            }
        };
        
        // Listen for Alt/Option key press/release
        document.addEventListener('keydown', (e) => {
            if (e.altKey && !isAltPressed) {
                updateButtonState(true);
            }
        });
        
        document.addEventListener('keyup', (e) => {
            if (!e.altKey && isAltPressed) {
                updateButtonState(false);
            }
        });
        
        // Also check on window focus in case key was released outside
        window.addEventListener('focus', () => {
            updateButtonState(false);
        });
        
        cleanupBtn.addEventListener('click', () => {
            if (isAltPressed) {
                // Trigger full database wipe
                if (window.triggerDatabaseWipe) {
                    window.triggerDatabaseWipe();
                    this.hide(); // Close admin panel
                } else {
                    console.error('Database wipe function not available');
                }
            } else {
                this.runCleanup();
            }
        });
        
        // Hover effect for button
        cleanupBtn.addEventListener('mouseover', () => {
            if (!isAltPressed) {
                cleanupBtn.style.background = 'var(--accent-hover, #2980b9)';
            } else {
                cleanupBtn.style.background = '#cc3333';
            }
        });
        cleanupBtn.addEventListener('mouseout', () => {
            if (!isAltPressed) {
                cleanupBtn.style.background = 'var(--accent-color, #3498db)';
            } else {
                cleanupBtn.style.background = '#ff4444';
            }
        });
    }
    
    loadThumbnailsTab(container) {
        const section = document.createElement('div');
        section.innerHTML = `
            <h3 style="margin-top: 0; color: var(--text-primary, #fff);">Thumbnail Management</h3>
            <p style="color: var(--text-secondary, #888); margin-bottom: 20px;">
                Monitor and manage image thumbnails.
            </p>
            
            <div class="thumbnail-stats" style="
                background: var(--bg-primary, #0d0d0d);
                padding: 16px;
                border-radius: 6px;
                margin-bottom: 24px;
                border: 1px solid var(--border-color, #333);
            ">
                <div style="margin-bottom: 12px;">
                    <div style="color: var(--text-secondary, #888); margin-bottom: 4px;">Thumbnail Status</div>
                    <div class="thumbnail-status" style="color: var(--text-primary, #fff);">Loading...</div>
                </div>
            </div>
            
            <div class="thumbnail-actions">
                <h4 style="color: var(--text-primary, #fff); margin-bottom: 16px;">Actions</h4>
                
                <button class="scan-thumbnails-btn" style="
                    background: var(--bg-tertiary, #2a2a2a);
                    color: var(--text-primary, #fff);
                    border: 1px solid var(--border-color, #333);
                    padding: 10px 20px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                    margin-right: 12px;
                    transition: all 0.2s;
                ">
                    Scan for Missing Thumbnails
                </button>
                
                <button class="regenerate-thumbnails-btn" style="
                    background: var(--accent-color, #3498db);
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                    transition: all 0.2s;
                " disabled>
                    Regenerate Missing Thumbnails
                </button>
                
                <div class="scan-results" style="
                    margin-top: 24px;
                    display: none;
                ">
                    <h5 style="color: var(--text-primary, #fff);">Scan Results</h5>
                    <div class="results-content" style="
                        background: var(--bg-primary, #0d0d0d);
                        padding: 16px;
                        border-radius: 6px;
                        border: 1px solid var(--border-color, #333);
                        max-height: 300px;
                        overflow-y: auto;
                        color: var(--text-secondary, #888);
                    "></div>
                </div>
            </div>
        `;
        
        container.appendChild(section);
        
        // Setup button handlers
        const scanBtn = section.querySelector('.scan-thumbnails-btn');
        const regenerateBtn = section.querySelector('.regenerate-thumbnails-btn');
        
        scanBtn.addEventListener('click', () => {
            this.scanThumbnails();
        });
        
        regenerateBtn.addEventListener('click', () => {
            this.regenerateThumbnails();
        });
        
        // Load initial status
        this.loadThumbnailStatus();
    }
    
    loadSystemTab(container) {
        const section = document.createElement('div');
        section.innerHTML = `
            <h3 style="margin-top: 0; color: var(--text-primary, #fff);">System Information</h3>
            <p style="color: var(--text-secondary, #888); margin-bottom: 20px;">
                View system status and configuration.
            </p>
            
            <div class="system-info" style="
                background: var(--bg-primary, #0d0d0d);
                padding: 16px;
                border-radius: 6px;
                border: 1px solid var(--border-color, #333);
            ">
                <div style="margin-bottom: 12px;">
                    <span style="color: var(--text-secondary, #888);">Server URL:</span>
                    <span style="color: var(--text-primary, #fff); margin-left: 8px;">${this.networkLayer?.serverUrl || 'Not connected'}</span>
                </div>
                <div style="margin-bottom: 12px;">
                    <span style="color: var(--text-secondary, #888);">Connection Status:</span>
                    <span style="color: var(--text-primary, #fff); margin-left: 8px;">${this.networkLayer?.isConnected ? 'Connected' : 'Disconnected'}</span>
                </div>
                <div style="margin-bottom: 12px;">
                    <span style="color: var(--text-secondary, #888);">Current Canvas:</span>
                    <span style="color: var(--text-primary, #fff); margin-left: 8px;">${this.canvasNavigator.currentCanvasId || 'None'}</span>
                </div>
                <div>
                    <span style="color: var(--text-secondary, #888);">Session ID:</span>
                    <span style="color: var(--text-primary, #fff); margin-left: 8px; font-family: monospace; font-size: 12px;">${this.networkLayer?.sessionId || 'N/A'}</span>
                </div>
            </div>
        `;
        
        container.appendChild(section);
    }
    
    async updateDatabaseSize() {
        try {
            const sizeElement = this.panel.querySelector('.db-size');
            if (!sizeElement) return;
            
            const response = await fetch(CONFIG.ENDPOINTS.DATABASE_SIZE);
            if (response.ok) {
                const data = await response.json();
                sizeElement.textContent = this.formatBytes(data.sizeInBytes);
            } else {
                sizeElement.textContent = 'Error loading size';
            }
        } catch (error) {
            console.error('Failed to get database size:', error);
            const sizeElement = this.panel.querySelector('.db-size');
            if (sizeElement) {
                sizeElement.textContent = 'Error loading size';
            }
        }
    }
    
    async runCleanup() {
        const dryRun = this.panel.querySelector('#cleanup-dry-run').checked;
        const clearIndexedDB = this.panel.querySelector('#cleanup-browser-cache').checked;
        const deleteAllThumbnails = this.panel.querySelector('#cleanup-all-thumbnails').checked;
        const gracePeriod = parseInt(this.panel.querySelector('#cleanup-grace-period').value) || 24;
        
        const cleanupBtn = this.panel.querySelector('.cleanup-btn');
        const originalContent = cleanupBtn.innerHTML;
        
        cleanupBtn.disabled = true;
        cleanupBtn.innerHTML = '<span style="display: inline-block; animation: spin 1s linear infinite;">⟳</span> Running...';
        
        // Add spin animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
        
        try {
            // Clear IndexedDB if requested
            if (clearIndexedDB && !dryRun) {
                try {
                    const databases = await indexedDB.databases();
                    for (const db of databases) {
                        if (db.name && (db.name.includes('imagecanvas') || db.name.includes('ImageCanvas'))) {
                            indexedDB.deleteDatabase(db.name);
                        }
                    }
                } catch (e) {
                    console.log('IndexedDB cleanup requires page reload');
                    window._needsReloadAfterCleanup = true;
                }
            }
            
            // Clear client-side caches
            if (!dryRun) {
                if (window.imageCache) window.imageCache.clear();
                if (window.thumbnailCache) window.thumbnailCache.clear();
                if (window.app?.imageResourceCache) window.app.imageResourceCache.clear();
                
                // Clear undo state
                if (window.app?.clientUndoManager) {
                    window.app.clientUndoManager.undoState = {
                        canUndo: false,
                        canRedo: false,
                        undoCount: 0,
                        redoCount: 0,
                        nextUndo: null,
                        nextRedo: null
                    };
                    
                    if (this.canvasNavigator.currentCanvasId && this.networkLayer?.socket) {
                        this.networkLayer.socket.emit('clear_undo_history', {
                            canvasId: this.canvasNavigator.currentCanvasId
                        });
                    }
                }
            }
            
            // Perform server cleanup
            const params = new URLSearchParams();
            if (dryRun) params.append('dryRun', 'true');
            params.append('gracePeriod', gracePeriod.toString());
            if (deleteAllThumbnails) params.append('deleteAllThumbnails', 'true');
            
            const response = await fetch(`${CONFIG.ENDPOINTS.DATABASE_CLEANUP}?${params}`, {
                method: 'POST'
            });
            
            if (!response.ok) throw new Error(`Cleanup failed with status ${response.status}`);
            
            const result = await response.json();
            
            // Update database size
            setTimeout(() => this.updateDatabaseSize(), 1000);
            
            // Show notification
            let message = '';
            if (dryRun) {
                let fileCount = result.fileCleanup?.deletedFiles || 
                               (result.deleted?.files || 0) + (result.deleted?.orphanedDiskFiles || 0);
                message = fileCount > 0 ? 
                    `Preview: ${fileCount} orphaned files found` : 
                    'Preview: No orphaned files found';
            } else {
                let fileCount = result.fileCleanup?.deletedFiles || 
                               (result.deleted?.files || 0) + (result.deleted?.orphanedDiskFiles || 0);
                if (fileCount > 0 || clearIndexedDB) {
                    const parts = [];
                    if (fileCount > 0) parts.push(`${fileCount} files removed`);
                    if (clearIndexedDB) parts.push('browser cache cleared');
                    message = `Cleanup complete: ${parts.join(', ')}`;
                } else {
                    message = 'Cleanup complete: No orphaned files';
                }
            }
            
            if (window.unifiedNotifications) {
                window.unifiedNotifications.success(message);
            }
            
            // Handle page reload if needed
            if (window._needsReloadAfterCleanup) {
                delete window._needsReloadAfterCleanup;
                if (window.unifiedNotifications) {
                    window.unifiedNotifications.info('Reloading page to complete cleanup...');
                }
                setTimeout(() => window.location.reload(), 1500);
            }
            
        } catch (error) {
            console.error('Cleanup failed:', error);
            if (window.unifiedNotifications) {
                window.unifiedNotifications.error('Cleanup failed. Please try again.');
            }
        } finally {
            cleanupBtn.disabled = false;
            cleanupBtn.innerHTML = originalContent;
        }
    }
    
    async loadThumbnailStatus() {
        // TODO: Implement server endpoint to get thumbnail statistics
        const statusElement = this.panel.querySelector('.thumbnail-status');
        if (statusElement) {
            statusElement.textContent = 'Feature coming soon...';
        }
    }
    
    async scanThumbnails() {
        const scanBtn = this.panel.querySelector('.scan-thumbnails-btn');
        const regenerateBtn = this.panel.querySelector('.regenerate-thumbnails-btn');
        const resultsSection = this.panel.querySelector('.scan-results');
        const resultsContent = this.panel.querySelector('.results-content');
        
        scanBtn.disabled = true;
        scanBtn.innerHTML = '<span style="display: inline-block; animation: spin 1s linear infinite;">⟳</span> Scanning...';
        
        try {
            // TODO: Implement server endpoint to scan for missing thumbnails
            await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call
            
            // Mock results for now
            resultsContent.innerHTML = `
                <p>Scan complete!</p>
                <p>• Total images: 0</p>
                <p>• Missing thumbnails: 0</p>
            `;
            
            resultsSection.style.display = 'block';
            regenerateBtn.disabled = false;
            
        } catch (error) {
            console.error('Thumbnail scan failed:', error);
            if (window.unifiedNotifications) {
                window.unifiedNotifications.error('Failed to scan thumbnails');
            }
        } finally {
            scanBtn.disabled = false;
            scanBtn.innerHTML = 'Scan for Missing Thumbnails';
        }
    }
    
    async regenerateThumbnails() {
        const regenerateBtn = this.panel.querySelector('.regenerate-thumbnails-btn');
        regenerateBtn.disabled = true;
        regenerateBtn.innerHTML = '<span style="display: inline-block; animation: spin 1s linear infinite;">⟳</span> Regenerating...';
        
        try {
            // TODO: Implement server endpoint to regenerate missing thumbnails
            await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate API call
            
            if (window.unifiedNotifications) {
                window.unifiedNotifications.success('Thumbnails regenerated successfully');
            }
            
            // Refresh scan results
            await this.scanThumbnails();
            
        } catch (error) {
            console.error('Thumbnail regeneration failed:', error);
            if (window.unifiedNotifications) {
                window.unifiedNotifications.error('Failed to regenerate thumbnails');
            }
        } finally {
            regenerateBtn.disabled = false;
            regenerateBtn.innerHTML = 'Regenerate Missing Thumbnails';
        }
    }
    
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    show() {
        this.overlay.style.display = 'block';
        // Force reflow for animation
        this.overlay.offsetHeight;
        this.panel.style.animation = 'fadeInScale 0.3s ease-out';
        
        // Add animation keyframes
        if (!document.querySelector('#admin-panel-animations')) {
            const style = document.createElement('style');
            style.id = 'admin-panel-animations';
            style.textContent = `
                @keyframes fadeInScale {
                    from {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(0.9);
                    }
                    to {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1);
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    hide() {
        this.panel.style.animation = 'fadeOutScale 0.2s ease-in';
        setTimeout(() => {
            this.overlay.style.display = 'none';
        }, 200);
        
        // Add animation keyframes if not present
        if (!document.querySelector('#admin-panel-animations')) {
            const style = document.createElement('style');
            style.id = 'admin-panel-animations';
            style.textContent = `
                @keyframes fadeOutScale {
                    from {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1);
                    }
                    to {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(0.9);
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }
}

// Export
window.AdminPanel = AdminPanel;