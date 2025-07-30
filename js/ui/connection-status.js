// Connection Status Indicator UI Component
// Shows the current connection status to the collaboration server

class ConnectionStatus {
    constructor(app) {
        this.app = app;
        this.currentStatus = 'disconnected';
        
        // No UI creation - we only use unified notifications now
        this.updateStatus('disconnected');
    }

    /**
     * Update the connection status (notification-based only)
     * @param {string} status - 'connected', 'connecting', 'disconnected', 'error'
     * @param {string} detail - Additional status detail message
     */
    updateStatus(status, detail = null) {
        this.currentStatus = status;
        this.detail = detail;
        
        // Handle different connection states using unified notifications only
        if (status === 'connected') {
            this.hideRetryButton();
            // Show brief success notification for connection
            if (window.unifiedNotifications) {
                window.unifiedNotifications.success('Connected to server', { duration: 3000 });
            }
        } else if (status === 'disconnected' || status === 'error') {
            // Show persistent notifications with retry for disconnected/error states
            this.showPersistentNotification(status, detail);
        } else if (status === 'connecting') {
            // Show non-persistent connecting notification
            const displayText = detail || 'Connecting to server...';
            if (window.unifiedNotifications) {
                window.unifiedNotifications.info(displayText, { 
                    id: 'connection-status',
                    duration: 0, // Persistent while connecting
                    persistent: true 
                });
            }
        }

    }
    
    /**
     * Show persistent notification with retry button for connection issues
     */
    showPersistentNotification(status, detail) {
        if (!window.unifiedNotifications) return;
        
        const shouldShowRetryButton = status === 'disconnected' || status === 'error';
        
        let message = status === 'disconnected' ? 'Connection lost' : 'Connection error';
        if (detail) {
            message = detail;
        }
        
        const notificationConfig = {
            id: 'connection-status',
            type: status === 'disconnected' ? 'error' : 'error',
            message: message,
            duration: 0, // Persistent
            persistent: true,
            closeable: false
        };
        
        // Add manual retry button for persistent connection issues
        if (shouldShowRetryButton) {
            notificationConfig.actions = [
                {
                    text: 'Retry Now',
                    action: () => {
                        this.manualReconnect();
                    }
                }
            ];
        }
        
        window.unifiedNotifications.show(notificationConfig);
    }
    
    /**
     * Trigger manual reconnection
     */
    manualReconnect() {
        
        // Hide current notification
        if (window.unifiedNotifications) {
            window.unifiedNotifications.remove('connection-status');
        }
        
        // Trigger manual reconnection through network layer
        if (window.app?.networkLayer?.manualReconnect) {
            window.app.networkLayer.manualReconnect();
        } else {
            
        }
    }
    
    /**
     * Hide retry button (when connected)
     */
    hideRetryButton() {
        if (window.unifiedNotifications) {
            window.unifiedNotifications.remove('connection-status');
        }
    }

    /**
     * Clean up the component
     */
    destroy() {
        // Clear any connection status notifications
        if (window.unifiedNotifications) {
            window.unifiedNotifications.remove('connection-status');
        }
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.ConnectionStatus = ConnectionStatus;
}