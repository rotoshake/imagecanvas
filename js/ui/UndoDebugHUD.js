/**
 * UndoDebugHUD - Visual debugging interface for undo/redo system
 * 
 * Features:
 * - Shows recent undo history and available redo operations
 * - Real-time updates as operations occur
 * - Detailed operation information
 * - Server sync status
 * - Color-coded operation status
 */
class UndoDebugHUD {
    constructor(app) {
        this.app = app;
        this.isVisible = false;
        this.selectedOperation = null;
        this.expandedOperations = new Set();
        
        // Operation type icons
        this.operationIcons = {
            'node_move': '↔️',
            'node_resize': '↔️',
            'node_rotate': '🔄',
            'node_delete': '🗑️',
            'node_create': '➕',
            'node_duplicate': '📋',
            'node_paste': '📋',
            'node_property_update': '✏️',
            'node_batch_property_update': '✏️',
            'node_reset': '🔄',
            'video_toggle': '▶️',
            'bundled_operations': '📦'
        };
        
        this.createHUD();
        this.setupEventListeners();
        this.setupKeyboardShortcut();
    }
    
    createHUD() {
        // Main container
        this.container = document.createElement('div');
        this.container.className = 'undo-debug-hud';
        this.container.style.cssText = `
            position: fixed;
            right: -400px;
            top: 0;
            width: 400px;
            height: 100vh;
            background: rgba(20, 20, 30, 0.95);
            color: #fff;
            font-family: ${FONT_CONFIG.MONO_FONT};
            font-size: 12px;
            transition: right 0.3s ease;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            box-shadow: -2px 0 10px rgba(0, 0, 0, 0.3);
            overflow: hidden;
        `;
        
        // Header
        this.header = document.createElement('div');
        this.header.className = 'undo-debug-header';
        this.header.style.cssText = `
            padding: 15px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(30, 30, 40, 0.8);
        `;
        this.header.innerHTML = `
            <h3 style="margin: 0 0 10px 0; font-size: 16px; font-weight: 600;">
                🐛 Undo/Redo Debug HUD
            </h3>
            <div class="status-info" style="font-size: 11px; opacity: 0.8;">
                <div>Loading...</div>
            </div>
        `;
        
        // Content container
        this.content = document.createElement('div');
        this.content.className = 'undo-debug-content';
        this.content.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        `;
        
        // Undo section
        this.undoSection = document.createElement('div');
        this.undoSection.className = 'undo-section';
        this.undoSection.innerHTML = `
            <h4 style="margin: 10px 0; padding: 5px 10px; background: rgba(255, 255, 255, 0.1); 
                       border-radius: 4px; font-size: 13px;">
                ← UNDO <span class="undo-count" style="opacity: 0.6; font-size: 11px;"></span>
            </h4>
            <div class="undo-list"></div>
        `;
        
        // Current position marker
        this.currentMarker = document.createElement('div');
        this.currentMarker.style.cssText = `
            margin: 15px 0;
            padding: 10px;
            background: rgba(0, 123, 255, 0.2);
            border: 1px solid rgba(0, 123, 255, 0.5);
            border-radius: 4px;
            text-align: center;
            font-weight: 600;
        `;
        this.currentMarker.textContent = '● CURRENT POSITION';
        
        // Redo section
        this.redoSection = document.createElement('div');
        this.redoSection.className = 'redo-section';
        this.redoSection.innerHTML = `
            <h4 style="margin: 10px 0; padding: 5px 10px; background: rgba(255, 255, 255, 0.1); 
                       border-radius: 4px; font-size: 13px;">
                → REDO <span class="redo-count" style="opacity: 0.6; font-size: 11px;"></span>
            </h4>
            <div class="redo-list"></div>
        `;
        
        // Detail panel
        this.detailPanel = document.createElement('div');
        this.detailPanel.className = 'detail-panel';
        this.detailPanel.style.cssText = `
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 0;
            background: rgba(10, 10, 20, 0.98);
            border-top: 1px solid rgba(255, 255, 255, 0.2);
            transition: height 0.3s ease;
            overflow: hidden;
        `;
        
        this.detailContent = document.createElement('div');
        this.detailContent.style.cssText = `
            padding: 15px;
            overflow-y: auto;
            height: 100%;
        `;
        this.detailPanel.appendChild(this.detailContent);
        
        // Assemble
        this.content.appendChild(this.undoSection);
        this.content.appendChild(this.currentMarker);
        this.content.appendChild(this.redoSection);
        
        this.container.appendChild(this.header);
        this.container.appendChild(this.content);
        this.container.appendChild(this.detailPanel);
        
        document.body.appendChild(this.container);
        
        // Add styles
        this.addStyles();
    }
    
    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .undo-debug-hud * {
                box-sizing: border-box;
            }
            
            .undo-debug-hud::-webkit-scrollbar {
                width: 8px;
            }
            
            .undo-debug-hud::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.05);
            }
            
            .undo-debug-hud::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.2);
                border-radius: 4px;
            }
            
            .operation-item {
                margin: 5px 0;
                padding: 10px;
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.2s ease;
                position: relative;
            }
            
            .operation-item:hover {
                background: rgba(255, 255, 255, 0.08);
                border-color: rgba(255, 255, 255, 0.2);
            }
            
            .operation-item.selected {
                background: rgba(0, 123, 255, 0.2);
                border-color: rgba(0, 123, 255, 0.5);
            }
            
            .operation-item.success { border-left: 3px solid #4CAF50; }
            .operation-item.warning { border-left: 3px solid #FFC107; }
            .operation-item.error { border-left: 3px solid #F44336; }
            .operation-item.bundled { border-left: 3px solid #9C27B0; }
            
            .operation-header {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .operation-type {
                font-weight: 600;
                flex: 1;
            }
            
            .operation-time {
                font-size: 10px;
                opacity: 0.6;
            }
            
            .operation-details {
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                font-size: 11px;
                opacity: 0.8;
                display: none;
            }
            
            .operation-item.expanded .operation-details {
                display: block;
            }
            
            .operation-value {
                font-family: ${FONT_CONFIG.MONO_FONT};
                background: rgba(0, 0, 0, 0.3);
                padding: 2px 4px;
                border-radius: 2px;
                margin: 2px 0;
                word-break: break-all;
            }
            
            .sync-status {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 2px 8px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 3px;
                font-size: 10px;
            }
            
            .sync-status.synced { background: rgba(76, 175, 80, 0.2); }
            .sync-status.syncing { background: rgba(255, 193, 7, 0.2); }
            .sync-status.error { background: rgba(244, 67, 54, 0.2); }
            
            .empty-state {
                text-align: center;
                opacity: 0.5;
                padding: 20px;
                font-style: italic;
            }
            
            .detail-section {
                margin-bottom: 15px;
            }
            
            .detail-section h5 {
                margin: 0 0 8px 0;
                font-size: 12px;
                opacity: 0.8;
            }
            
            .json-viewer {
                background: rgba(0, 0, 0, 0.3);
                padding: 10px;
                border-radius: 4px;
                font-family: ${FONT_CONFIG.MONO_FONT};
                font-size: 11px;
                overflow-x: auto;
                white-space: pre;
            }
            
            .action-buttons {
                display: flex;
                gap: 10px;
                margin-top: 10px;
            }
            
            .action-button {
                padding: 5px 10px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 3px;
                color: white;
                font-size: 11px;
                cursor: pointer;
                transition: all 0.2s;
            }
            
            .action-button:hover {
                background: rgba(255, 255, 255, 0.2);
            }
        `;
        document.head.appendChild(style);
    }
    
    setupEventListeners() {
        // Listen for undo state changes
        const undoManager = this.app.undoManager || this.app.clientUndoManager;
        if (undoManager) {
            // Poll for updates with server request
            this.updateInterval = setInterval(() => {
                if (this.isVisible) {
                    console.log('🔄 UndoDebugHUD: Polling for updates');
                    this.update();
                }
            }, 500);
        }
        
        // Listen for state sync events
        if (this.app.networkLayer) {
            // Listen for all operation-related events
            const operationEvents = [
                'undo_state_update',
                'state_update',
                'node_updated',
                'node_created',
                'node_deleted',
                'node_moved',
                'node_resized',
                'node_rotated',
                'operation_applied',
                'undo_performed',
                'redo_performed',
                'transaction_committed'
            ];
            
            operationEvents.forEach(eventName => {
                this.app.networkLayer.on(eventName, (data) => {
                    console.log(`🎯 UndoDebugHUD: Received ${eventName} event`, data);
                    if (this.isVisible) {
                        // Debounce updates to avoid too many requests
                        clearTimeout(this.updateDebounceTimer);
                        this.updateDebounceTimer = setTimeout(() => {
                            console.log(`🔄 UndoDebugHUD: Updating after ${eventName}`);
                            this.update();
                        }, 100);
                    }
                });
            });
            
            // Listen for detailed history response
            this.app.networkLayer.on('undo_history', (data) => {
                console.log('📥 UndoDebugHUD: Received undo_history response', data);
                if (this.isVisible) {
                    this.handleHistoryData(data);
                }
            });
        } else {
            console.warn('⚠️ UndoDebugHUD: NetworkLayer not available yet');
            // Retry setup after a delay
            setTimeout(() => this.setupEventListeners(), 1000);
        }
    }
    
    setupKeyboardShortcut() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+Shift+U to toggle HUD
            if (e.ctrlKey && e.shiftKey && e.key === 'U') {
                e.preventDefault();
                this.toggle();
            }
        });
    }
    
    toggle() {
        this.isVisible = !this.isVisible;
        this.container.style.right = this.isVisible ? '0' : '-400px';
        
        if (this.isVisible) {
            console.log('🔓 UndoDebugHUD: Opening panel');
            this.update();
        } else {
            console.log('🔒 UndoDebugHUD: Closing panel');
        }
    }
    
    update() {
        console.log('📊 UndoDebugHUD: Updating display');
        
        // Update status info
        this.updateStatus();
        
        // Always request fresh data from server
        this.requestHistoryFromServer();
    }
    
    updateStatus() {
        const statusInfo = this.header.querySelector('.status-info');
        const isConnected = this.app.networkLayer?.isConnected;
        const undoManager = this.app.undoManager || this.app.clientUndoManager;
        const undoState = undoManager?.undoState;
        const stateVersion = this.app.stateSyncManager?.serverStateVersion;
        
        statusInfo.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    User: ${undoManager?.userId || 'N/A'} | 
                    Project: ${undoManager?.projectId || 'N/A'}
                </div>
                <div class="sync-status ${isConnected ? 'synced' : 'error'}">
                    ${isConnected ? '✅' : '❌'} ${isConnected ? 'Connected' : 'Disconnected'}
                </div>
            </div>
            <div style="margin-top: 5px;">
                Server State: v${stateVersion || '?'} | 
                Can Undo: ${undoState?.canUndo ? 'Yes' : 'No'} | 
                Can Redo: ${undoState?.canRedo ? 'Yes' : 'No'}
            </div>
        `;
    }
    
    requestHistoryFromServer() {
        // Request detailed history from server
        if (this.app.networkLayer?.isConnected) {
            const timestamp = Date.now();
            console.log(`📤 [${timestamp}] UndoDebugHUD: Requesting undo history from server with limit: 20`);
            
            // Show loading state
            this.showLoadingState();
            
            // Set a timeout to handle if server doesn't respond
            const timeoutId = setTimeout(() => {
                console.error('⏱️ UndoDebugHUD: Timeout waiting for server response');
                this.showTimeoutState();
            }, 5000);
            
            // Store timeout ID to clear it when response arrives
            this.pendingRequestTimeout = timeoutId;
            
            this.app.networkLayer.emit('get_undo_history', {
                limit: 20,  // Increased from 10 to show more history
                timestamp: timestamp,  // For tracking request/response
                showAllUsers: true  // Show operations from all users for debugging
            });
        } else {
            console.log('❌ UndoDebugHUD: Cannot request history - not connected to server');
            this.showDisconnectedState();
        }
    }
    
    showTimeoutState() {
        const undoList = this.undoSection.querySelector('.undo-list');
        const redoList = this.redoSection.querySelector('.redo-list');
        
        undoList.innerHTML = '<div class="empty-state" style="color: #FFC107;">Request timed out - check server connection</div>';
        redoList.innerHTML = '<div class="empty-state" style="color: #FFC107;">Request timed out - check server connection</div>';
    }
    
    showLoadingState() {
        const undoList = this.undoSection.querySelector('.undo-list');
        const redoList = this.redoSection.querySelector('.redo-list');
        
        if (undoList) {
            undoList.innerHTML = '<div class="empty-state">Loading...</div>';
        }
        if (redoList) {
            redoList.innerHTML = '<div class="empty-state">Loading...</div>';
        }
    }
    
    showDisconnectedState() {
        const undoList = this.undoSection.querySelector('.undo-list');
        const redoList = this.redoSection.querySelector('.redo-list');
        
        undoList.innerHTML = '<div class="empty-state" style="color: #F44336;">Disconnected from server</div>';
        redoList.innerHTML = '<div class="empty-state" style="color: #F44336;">Disconnected from server</div>';
    }
    
    handleHistoryData(data) {
        // Clear any pending timeout
        if (this.pendingRequestTimeout) {
            clearTimeout(this.pendingRequestTimeout);
            this.pendingRequestTimeout = null;
        }
        
        const timestamp = data.timestamp || Date.now();
        console.log(`📊 [${timestamp}] UndoDebugHUD: Received history data from server:`, {
            undoCount: data.undoOperations?.length || 0,
            redoCount: data.redoOperations?.length || 0,
            hasData: !!data
        });
        
        if (data.undoOperations && data.undoOperations.length > 0) {
            console.log('📊 UndoDebugHUD: Sample undo operations:', data.undoOperations.slice(0, 3));
        }
        if (data.redoOperations && data.redoOperations.length > 0) {
            console.log('📊 UndoDebugHUD: Sample redo operations:', data.redoOperations.slice(0, 3));
        }
        
        this.historyData = data;
        this.renderHistoryFromServer();
    }
    
    renderHistory() {
        const undoManager = this.app.undoManager || this.app.clientUndoManager;
        const undoState = undoManager?.undoState || {};
        
        // Update counts
        this.undoSection.querySelector('.undo-count').textContent = 
            `(${undoState.undoCount || 0} available)`;
        this.redoSection.querySelector('.redo-count').textContent = 
            `(${undoState.redoCount || 0} available)`;
        
        // Use server data if available, otherwise show basic info
        if (this.historyData) {
            this.renderHistoryFromServer();
        } else {
            this.renderUndoList();
            this.renderRedoList();
        }
    }
    
    renderHistoryFromServer() {
        if (!this.historyData) return;
        
        // Render undo operations
        const undoList = this.undoSection.querySelector('.undo-list');
        if (this.historyData.undoOperations && this.historyData.undoOperations.length > 0) {
            undoList.innerHTML = this.historyData.undoOperations
                .map((op, index) => this.renderDetailedOperation(op, index + 1))
                .join('');
        } else {
            undoList.innerHTML = '<div class="empty-state">No operations to undo</div>';
        }
        
        // Render redo operations
        const redoList = this.redoSection.querySelector('.redo-list');
        if (this.historyData.redoOperations && this.historyData.redoOperations.length > 0) {
            redoList.innerHTML = this.historyData.redoOperations
                .map((op, index) => this.renderDetailedOperation(op, -(index + 1)))
                .join('');
        } else {
            redoList.innerHTML = '<div class="empty-state">No operations to redo</div>';
        }
    }
    
    renderDetailedOperation(op, index) {
        console.log('📊 Rendering operation:', op);
        const isExpanded = this.expandedOperations.has(op.operationId);
        const icon = this.operationIcons[op.type] || '📄';
        const time = this.formatTime(op.timestamp);
        const statusClass = op.undoData ? 'success' : 'warning';
        
        // Format operation value preview
        let valuePreview = '';
        if (op.type === 'node_move' && op.undoData?.previousPositions) {
            const nodeId = Object.keys(op.undoData.previousPositions)[0];
            if (nodeId) {
                const pos = op.undoData.previousPositions[nodeId];
                valuePreview = `→ [${Math.round(pos[0])}, ${Math.round(pos[1])}]`;
            }
        } else if (op.type === 'node_rotate' && op.undoData?.previousRotations) {
            const nodeId = Object.keys(op.undoData.previousRotations)[0];
            if (nodeId) {
                const rotation = op.undoData.previousRotations[nodeId];
                valuePreview = `→ ${rotation}°`;
            }
        } else if (op.type === 'node_resize' && op.undoData?.previousSizes) {
            const nodeId = Object.keys(op.undoData.previousSizes)[0];
            if (nodeId) {
                const size = op.undoData.previousSizes[nodeId];
                valuePreview = `→ [${Math.round(size[0])}, ${Math.round(size[1])}]`;
            }
        } else if (op.type === 'node_property_update' && op.params?.property) {
            valuePreview = `→ ${op.params.property}`;
        } else if (op.type === 'bundled_operations') {
            valuePreview = `→ ${op.operationCount} ops`;
        }
        
        // Show user ID if available
        const userDisplay = op.userId ? `<span style="opacity: 0.6; font-size: 10px;">User ${op.userId}</span>` : '';
        
        return `
            <div class="operation-item ${statusClass}" 
                 data-op-id="${op.operationId}"
                 data-op-type="${op.type}"
                 onclick="window.undoDebugHUD.toggleOperation('${op.operationId}')">
                <div class="operation-header">
                    <span class="operation-icon">${icon}</span>
                    <span class="operation-type">${op.type}</span>
                    <span class="operation-value" style="opacity: 0.7; font-size: 11px;">${valuePreview}</span>
                    ${userDisplay}
                    <span class="operation-time">${time}</span>
                </div>
                ${isExpanded ? this.renderDetailedOperationInfo(op) : ''}
            </div>
        `;
    }
    
    renderDetailedOperationInfo(op) {
        let details = `
            <div class="operation-details">
                <div class="operation-value">
                    Operation ID: ${op.operationId}
                </div>
        `;
        
        if (op.params && Object.keys(op.params).length > 0) {
            details += `
                <div class="operation-value">
                    Params: ${JSON.stringify(op.params, null, 2)}
                </div>
            `;
        }
        
        if (op.undoData) {
            details += `
                <div class="operation-value">
                    Undo Data: ${JSON.stringify(op.undoData, null, 2)}
                </div>
            `;
        } else {
            details += `
                <div class="operation-value" style="color: #FFC107;">
                    ⚠️ No undo data available
                </div>
            `;
        }
        
        if (op.operations) {
            // Bundled operations
            details += `
                <div class="operation-value">
                    Bundled Operations (${op.operationCount}):
                    ${op.operations.map(subOp => `
                        <div style="margin-left: 20px; margin-top: 5px;">
                            ${this.operationIcons[subOp.type] || '📄'} ${subOp.type}
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        details += `</div>`;
        return details;
    }
    
    renderUndoList() {
        const undoList = this.undoSection.querySelector('.undo-list');
        const undoManager = this.app.undoManager || this.app.clientUndoManager;
        const undoState = undoManager?.undoState || {};
        
        if (!undoState.canUndo) {
            undoList.innerHTML = '<div class="empty-state">No operations to undo</div>';
            return;
        }
        
        // Show next undo operation
        if (undoState.nextUndo) {
            undoList.innerHTML = this.renderOperation(undoState.nextUndo, 1);
        } else {
            undoList.innerHTML = '<div class="empty-state">Undo history unavailable</div>';
        }
    }
    
    renderRedoList() {
        const redoList = this.redoSection.querySelector('.redo-list');
        const undoManager = this.app.undoManager || this.app.clientUndoManager;
        const undoState = undoManager?.undoState || {};
        
        if (!undoState.canRedo) {
            redoList.innerHTML = '<div class="empty-state">No operations to redo</div>';
            return;
        }
        
        // Show next redo operation
        if (undoState.nextRedo) {
            redoList.innerHTML = this.renderOperation(undoState.nextRedo, -1);
        } else {
            redoList.innerHTML = '<div class="empty-state">Redo history unavailable</div>';
        }
    }
    
    renderOperation(op, index) {
        const isExpanded = this.expandedOperations.has(op.operationId);
        const icon = this.operationIcons[op.type] || '📄';
        const time = this.formatTime(op.timestamp);
        
        // If op.type is missing, try to determine from other properties
        const operationType = op.type || 'unknown';
        
        return `
            <div class="operation-item success" 
                 data-op-id="${op.operationId || 'unknown'}"
                 data-op-type="${operationType}"
                 onclick="window.undoDebugHUD.toggleOperation('${op.operationId || 'unknown'}')">
                <div class="operation-header">
                    <span class="operation-icon">${icon}</span>
                    <span class="operation-type">${operationType}</span>
                    <span class="operation-time">${time}</span>
                </div>
                ${isExpanded ? this.renderOperationDetails(op) : ''}
            </div>
        `;
    }
    
    renderOperationDetails(op) {
        return `
            <div class="operation-details">
                <div class="operation-value">
                    Operation ID: ${op.operationId}
                </div>
                <div class="operation-value">
                    Type: ${op.type}
                </div>
                ${op.timestamp ? `
                    <div class="operation-value">
                        Time: ${new Date(op.timestamp).toLocaleString()}
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    toggleOperation(opId) {
        if (this.expandedOperations.has(opId)) {
            this.expandedOperations.delete(opId);
        } else {
            this.expandedOperations.add(opId);
        }
        this.renderHistory();
    }
    
    formatTime(timestamp) {
        if (!timestamp) return 'Unknown';
        
        const now = Date.now();
        const diff = now - timestamp;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        return `${Math.floor(diff / 86400000)}d ago`;
    }
    
    showDetail(operation) {
        this.selectedOperation = operation;
        this.detailPanel.style.height = '300px';
        
        this.detailContent.innerHTML = `
            <h4 style="margin: 0 0 15px 0;">Operation Details</h4>
            
            <div class="detail-section">
                <h5>Basic Info</h5>
                <div class="operation-value">ID: ${operation.operationId}</div>
                <div class="operation-value">Type: ${operation.type}</div>
                <div class="operation-value">User: ${operation.userId}</div>
                <div class="operation-value">Time: ${new Date(operation.timestamp).toLocaleString()}</div>
            </div>
            
            <div class="detail-section">
                <h5>Undo Data</h5>
                <div class="json-viewer">${JSON.stringify(operation.undoData || {}, null, 2)}</div>
            </div>
            
            <div class="action-buttons">
                <button class="action-button" onclick="window.undoDebugHUD.copyOperationData()">
                    Copy Data
                </button>
                <button class="action-button" onclick="window.undoDebugHUD.hideDetail()">
                    Close
                </button>
            </div>
        `;
    }
    
    hideDetail() {
        this.detailPanel.style.height = '0';
        this.selectedOperation = null;
    }
    
    copyOperationData() {
        if (this.selectedOperation) {
            navigator.clipboard.writeText(JSON.stringify(this.selectedOperation, null, 2));
            console.log('Operation data copied to clipboard');
        }
    }
}

// Initialize when ready
if (typeof window !== 'undefined') {
    window.UndoDebugHUD = UndoDebugHUD;
}