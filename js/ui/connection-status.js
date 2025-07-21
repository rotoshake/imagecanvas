// Connection Status Indicator UI Component
// Shows the current connection status to the collaboration server

class ConnectionStatus {
    constructor(app) {
        this.app = app;
        this.currentStatus = 'disconnected';
        this.isVisible = true;
        
        this.createUI();
        this.updateStatus('disconnected');
    }
    
    createUI() {
        // Create status indicator
        this.indicator = document.createElement('div');
        this.indicator.className = 'connection-status';
        this.indicator.innerHTML = `
            <div class="status-icon">
                <div class="status-dot"></div>
            </div>
            <div class="status-text">Disconnected</div>
        `;
        
        // Add styles
        this.addStyles();
        
        // Add to DOM (top-right corner)
        document.body.appendChild(this.indicator);
        
        // Add click handler to show details
        this.indicator.addEventListener('click', () => {
            this.showDetails();
        });
    }
    
    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Connection Status Indicator */
            .connection-status {
                position: fixed;
                top: 10px;
                right: 10px;
                display: flex;
                align-items: center;
                gap: 8px;
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 8px 12px;
                border-radius: 6px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 12px;
                z-index: 10000;
                cursor: pointer;
                transition: all 0.3s ease;
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .connection-status:hover {
                background: rgba(0, 0, 0, 0.9);
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            }
            
            .connection-status.hidden {
                opacity: 0;
                pointer-events: none;
            }
            
            /* Status Icon */
            .status-icon {
                position: relative;
                width: 12px;
                height: 12px;
            }
            
            .status-dot {
                width: 100%;
                height: 100%;
                border-radius: 50%;
                transition: all 0.3s ease;
            }
            
            /* Status States */
            .connection-status.connected .status-dot {
                background: #4CAF50;
                box-shadow: 0 0 6px rgba(76, 175, 80, 0.6);
            }
            
            .connection-status.connecting .status-dot {
                background: #FF9800;
                box-shadow: 0 0 6px rgba(255, 152, 0, 0.6);
                animation: pulse 1.5s infinite;
            }
            
            .connection-status.disconnected .status-dot {
                background: #F44336;
                box-shadow: 0 0 6px rgba(244, 67, 54, 0.6);
            }
            
            .connection-status.error .status-dot {
                background: #E91E63;
                box-shadow: 0 0 6px rgba(233, 30, 99, 0.6);
                animation: pulse 1s infinite;
            }
            
            /* Pulse animation */
            @keyframes pulse {
                0% { 
                    transform: scale(1); 
                    opacity: 1; 
                }
                50% { 
                    transform: scale(1.2); 
                    opacity: 0.7; 
                }
                100% { 
                    transform: scale(1); 
                    opacity: 1; 
                }
            }
            
            /* Status text */
            .status-text {
                font-weight: 500;
                text-transform: capitalize;
            }
            
            /* Status details popup */
            .status-details {
                position: fixed;
                top: 60px;
                right: 10px;
                background: rgba(0, 0, 0, 0.95);
                color: white;
                padding: 16px;
                border-radius: 8px;
                font-family: monospace;
                font-size: 11px;
                z-index: 10001;
                max-width: 300px;
                backdrop-filter: blur(15px);
                border: 1px solid rgba(255, 255, 255, 0.2);
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
                opacity: 0;
                transform: translateY(-10px);
                transition: all 0.3s ease;
                pointer-events: none;
            }
            
            .status-details.visible {
                opacity: 1;
                transform: translateY(0);
                pointer-events: auto;
            }
            
            .status-details h4 {
                margin: 0 0 12px 0;
                font-size: 13px;
                color: #4CAF50;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            
            .status-details .detail-row {
                display: flex;
                justify-content: space-between;
                margin-bottom: 6px;
                padding: 2px 0;
            }
            
            .status-details .detail-label {
                color: #999;
                margin-right: 12px;
            }
            
            .status-details .detail-value {
                color: #fff;
                text-align: right;
                word-break: break-all;
            }
            
            .status-details .close-btn {
                position: absolute;
                top: 8px;
                right: 8px;
                background: none;
                border: none;
                color: #999;
                cursor: pointer;
                font-size: 16px;
                padding: 4px;
            }
            
            .status-details .close-btn:hover {
                color: #fff;
            }
        `;
        
        document.head.appendChild(style);
    }
    
    /**
     * Update the connection status
     * @param {string} status - 'connected', 'connecting', 'disconnected', 'error'
     * @param {Object} details - Additional status details
     */
    updateStatus(status, details = {}) {
        this.currentStatus = status;
        this.details = details;
        
        // Update visual state
        this.indicator.className = `connection-status ${status}`;
        
        // Update text
        const statusText = this.indicator.querySelector('.status-text');
        const statusMessages = {
            connected: 'Connected',
            connecting: 'Connecting...',
            disconnected: 'Offline',
            error: 'Connection Error'
        };
        
        statusText.textContent = statusMessages[status] || status;
        
        // Auto-hide after being connected for a while
        if (status === 'connected') {
            setTimeout(() => {
                if (this.currentStatus === 'connected') {
                    this.fadeOut();
                }
            }, 3000);
        } else {
            this.fadeIn();
        }
        
        console.log(`🔗 Connection status: ${status}`);
    }
    
    /**
     * Show detailed connection information
     */
    showDetails() {
        // Create or update details popup
        let popup = document.querySelector('.status-details');
        if (!popup) {
            popup = document.createElement('div');
            popup.className = 'status-details';
            document.body.appendChild(popup);
        }
        
        // Get network layer status
        const networkStatus = this.app.networkLayer?.getStatus() || {};
        const projectInfo = networkStatus.project || {};
        
        popup.innerHTML = `
            <button class="close-btn">×</button>
            <h4>Connection Details</h4>
            
            <div class="detail-row">
                <span class="detail-label">Status:</span>
                <span class="detail-value">${this.currentStatus}</span>
            </div>
            
            <div class="detail-row">
                <span class="detail-label">Tab ID:</span>
                <span class="detail-value">${networkStatus.tabId?.substr(-8) || 'N/A'}</span>
            </div>
            
            <div class="detail-row">
                <span class="detail-label">Project:</span>
                <span class="detail-value">${projectInfo.id || 'None'}</span>
            </div>
            
            <div class="detail-row">
                <span class="detail-label">User:</span>
                <span class="detail-value">${networkStatus.user?.username || 'Anonymous'}</span>
            </div>
            
            <div class="detail-row">
                <span class="detail-label">Server:</span>
                <span class="detail-value">${this.app.networkLayer?.serverUrl || 'N/A'}</span>
            </div>
            
            <div class="detail-row">
                <span class="detail-label">Session:</span>
                <span class="detail-value">${networkStatus.sessionId?.substr(-8) || 'N/A'}</span>
            </div>
        `;
        
        // Show popup
        setTimeout(() => {
            popup.classList.add('visible');
        }, 10);
        
        // Handle close button
        const closeBtn = popup.querySelector('.close-btn');
        closeBtn.addEventListener('click', () => {
            popup.classList.remove('visible');
            setTimeout(() => {
                if (popup.parentNode) {
                    popup.parentNode.removeChild(popup);
                }
            }, 300);
        });
        
        // Auto-close after 5 seconds
        setTimeout(() => {
            if (popup.classList.contains('visible')) {
                popup.classList.remove('visible');
                setTimeout(() => {
                    if (popup.parentNode) {
                        popup.parentNode.removeChild(popup);
                    }
                }, 300);
            }
        }, 5000);
    }
    
    /**
     * Fade in the indicator
     */
    fadeIn() {
        if (!this.isVisible) {
            this.indicator.classList.remove('hidden');
            this.isVisible = true;
        }
    }
    
    /**
     * Fade out the indicator
     */
    fadeOut() {
        if (this.isVisible) {
            this.indicator.classList.add('hidden');
            this.isVisible = false;
        }
    }
    
    /**
     * Show the indicator permanently
     */
    show() {
        this.fadeIn();
    }
    
    /**
     * Hide the indicator
     */
    hide() {
        this.fadeOut();
    }
    
    /**
     * Clean up the component
     */
    destroy() {
        if (this.indicator && this.indicator.parentNode) {
            this.indicator.parentNode.removeChild(this.indicator);
        }
        
        // Remove details popup if it exists
        const popup = document.querySelector('.status-details');
        if (popup && popup.parentNode) {
            popup.parentNode.removeChild(popup);
        }
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.ConnectionStatus = ConnectionStatus;
}