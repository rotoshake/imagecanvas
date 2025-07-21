/**
 * UnifiedNotifications - A unified notification system for all app messages
 * Combines network status, app notifications, and system messages
 */
class UnifiedNotifications {
    constructor() {
        this.container = null;
        this.notifications = new Map();
        this.persistentStatus = null;
        this.notificationIdCounter = 0;
        
        this.init();
    }
    
    init() {
        // Create main container
        this.container = document.createElement('div');
        this.container.className = 'unified-notifications';
        this.container.innerHTML = `
            <div class="notification-area"></div>
            <div class="status-area"></div>
        `;
        
        document.body.appendChild(this.container);
        this.addStyles();
        
        // Get notification and status areas
        this.notificationArea = this.container.querySelector('.notification-area');
        this.statusArea = this.container.querySelector('.status-area');
    }
    
    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Main Container */
            .unified-notifications {
                position: fixed;
                top: 10px;
                right: 10px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 4px;
                pointer-events: none;
                max-width: 280px;
            }
            
            .unified-notifications > * {
                pointer-events: auto;
            }
            
            /* Notification Base */
            .notification-item {
                background: rgba(0, 0, 0, 0.85);
                color: white;
                padding: 8px 12px;
                border-radius: 4px;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
                display: flex;
                align-items: center;
                gap: 8px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 12px;
                line-height: 1.2;
                opacity: 0;
                transform: translateX(20px);
                transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
                margin-bottom: 0;
                min-width: 140px;
                cursor: default;
                backdrop-filter: blur(8px);
                border: 1px solid rgba(255, 255, 255, 0.08);
            }
            
            .notification-item.show {
                opacity: 1;
                transform: translateX(0);
            }
            
            .notification-item.hiding {
                opacity: 0;
                transform: translateX(20px) scale(0.95);
            }
            
            /* Icon Styles */
            .notification-icon {
                width: 14px;
                height: 14px;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .notification-icon svg {
                width: 100%;
                height: 100%;
            }
            
            /* Message Styles */
            .notification-content {
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            
            .notification-message {
                font-weight: 500;
                word-wrap: break-word;
                font-size: 12px;
            }
            
            .notification-detail {
                font-size: 10px;
                opacity: 0.7;
                font-weight: 400;
            }
            
            /* Type Variations */
            .notification-item.success {
                background: rgba(76, 175, 80, 0.9);
                border-color: rgba(76, 175, 80, 0.2);
            }
            
            .notification-item.error {
                background: rgba(244, 67, 54, 0.9);
                border-color: rgba(244, 67, 54, 0.2);
            }
            
            .notification-item.warning {
                background: rgba(255, 152, 0, 0.9);
                border-color: rgba(255, 152, 0, 0.2);
            }
            
            .notification-item.info {
                background: rgba(33, 150, 243, 0.9);
                border-color: rgba(33, 150, 243, 0.2);
            }
            
            
            /* Close Button */
            .notification-close {
                width: 14px;
                height: 14px;
                cursor: pointer;
                opacity: 0.5;
                transition: opacity 0.15s;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .notification-close:hover {
                opacity: 0.9;
            }
            
            .notification-close svg {
                width: 10px;
                height: 10px;
            }
            
            /* Animations */
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            
            /* Progress Bar (auto-dismiss timer) */
            .notification-progress {
                position: absolute;
                bottom: 0;
                left: 0;
                height: 2px;
                background: rgba(255, 255, 255, 0.2);
                border-radius: 0 0 4px 4px;
                transition: width linear;
                transform-origin: left;
            }
            
            /* Progress Container */
            .notification-progress-container {
                margin-top: 8px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            /* Visual Progress Bar */
            .notification-progress-bar {
                flex: 1;
                height: 6px;
                background: rgba(255, 255, 255, 0.2);
                border-radius: 3px;
                overflow: hidden;
            }
            
            .notification-progress-fill {
                height: 100%;
                background: rgba(255, 255, 255, 0.8);
                border-radius: 3px;
                transition: width 0.3s ease;
            }
            
            /* Text Progress Bar */
            .notification-progress-text {
                font-family: monospace;
                font-size: 10px;
                letter-spacing: -1px;
                opacity: 0.8;
            }
            
            /* Progress Label */
            .notification-progress-label {
                font-size: 10px;
                font-weight: 600;
                opacity: 0.9;
                min-width: 35px;
                text-align: right;
            }
            
            /* Responsive */
            @media (max-width: 480px) {
                .unified-notifications {
                    left: 10px;
                    right: 10px;
                    max-width: none;
                }
                
                .notification-item {
                    font-size: 13px;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    /**
     * Show a notification
     */
    show(options) {
        const {
            type = 'info',
            message,
            detail = null,
            duration = 3000,
            persistent = false,
            closeable = true,
            id = null,
            icon = null,
            progress = null  // { current, total, showBar }
        } = options;
        
        const notificationId = id || `notification-${++this.notificationIdCounter}`;
        
        
        // Remove existing notification with same ID
        if (id && this.notifications.has(id)) {
            this.remove(id);
        }
        
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification-item ${type}`;
        notification.dataset.id = notificationId;
        
        // Build HTML
        let html = `
            <div class="notification-icon">
                ${this.getIcon(type, icon)}
            </div>
            <div class="notification-content">
                <div class="notification-message">${this.escapeHtml(message)}</div>
                ${detail ? `<div class="notification-detail">${this.escapeHtml(detail)}</div>` : ''}
                ${progress ? this.getProgressHTML(progress) : ''}
            </div>
        `;
        
        
        notification.innerHTML = html;
        
        
        // Add to appropriate area
        if (persistent) {
            this.statusArea.appendChild(notification);
        } else {
            this.notificationArea.appendChild(notification);
        }
        
        // Store reference with creation time
        this.notifications.set(notificationId, {
            element: notification,
            persistent,
            timeout: null,
            createdAt: Date.now()
        });
        
        // Animate in
        requestAnimationFrame(() => {
            notification.classList.add('show');
        });
        
        // Auto-remove after duration (if not persistent)
        if (!persistent && duration > 0) {
            const notificationData = this.notifications.get(notificationId);
            // Ensure minimum display time of 250ms
            const actualDuration = Math.max(duration, 250);
            
            notificationData.timeout = setTimeout(() => {
                this.remove(notificationId);
            }, actualDuration);
            
            // Add progress bar for timed notifications (only for longer durations)
            if (actualDuration > 1000) {
                const progress = document.createElement('div');
                progress.className = 'notification-progress';
                progress.style.width = '100%';
                progress.style.transition = `width ${actualDuration}ms linear`;
                notification.appendChild(progress);
                
                requestAnimationFrame(() => {
                    progress.style.width = '0%';
                });
            }
        }
        
        return notificationId;
    }
    
    /**
     * Update an existing notification
     */
    update(id, options) {
        const notificationData = this.notifications.get(id);
        if (!notificationData) return;
        
        const { element } = notificationData;
        const { message, detail, type, progress } = options;
        
        if (message) {
            const messageEl = element.querySelector('.notification-message');
            if (messageEl) messageEl.textContent = message;
        }
        
        if (detail !== undefined) {
            const detailEl = element.querySelector('.notification-detail');
            if (detail && !detailEl) {
                const contentEl = element.querySelector('.notification-content');
                const newDetailEl = document.createElement('div');
                newDetailEl.className = 'notification-detail';
                newDetailEl.textContent = detail;
                contentEl.appendChild(newDetailEl);
            } else if (detailEl) {
                if (detail) {
                    detailEl.textContent = detail;
                } else {
                    detailEl.remove();
                }
            }
        }
        
        if (type) {
            element.className = `notification-item ${type} show`;
        }
        
        if (progress !== undefined) {
            const contentEl = element.querySelector('.notification-content');
            const existingProgress = element.querySelector('.notification-progress-container');
            
            if (progress && contentEl) {
                if (existingProgress) {
                    // Update existing progress
                    existingProgress.outerHTML = this.getProgressHTML(progress);
                } else {
                    // Add new progress
                    contentEl.insertAdjacentHTML('beforeend', this.getProgressHTML(progress));
                }
            } else if (existingProgress) {
                // Remove progress
                existingProgress.remove();
            }
        }
    }
    
    /**
     * Remove a notification
     */
    remove(id) {
        const notificationData = this.notifications.get(id);
        if (!notificationData) return;
        
        const { element, timeout, createdAt } = notificationData;
        
        // Check if already being removed
        if (element.dataset.removing === 'true') {
            return;
        }
        element.dataset.removing = 'true';
        
        // Clear timeout if exists
        if (timeout) {
            clearTimeout(timeout);
        }
        
        // Ensure minimum display time of 250ms
        const timeShown = Date.now() - createdAt;
        const remainingTime = Math.max(0, 250 - timeShown);
        
        setTimeout(() => {
            // Animate out
            element.classList.add('hiding');
            element.classList.remove('show');
            
            setTimeout(() => {
                if (element.parentNode) {
                    element.parentNode.removeChild(element);
                }
                this.notifications.delete(id);
            }, 200);
        }, remainingTime);
    }
    
    /**
     * Update network connection status
     */
    updateConnectionStatus(status, detail = null) {
        const statusMessages = {
            connected: 'Connected to server',
            connecting: 'Connecting to server...',
            disconnected: 'Disconnected from server',
            error: 'Connection error'
        };
        
        const statusTypes = {
            connected: 'success',
            connecting: 'warning',
            disconnected: 'error',
            error: 'error'
        };
        
        const durations = {
            connected: 3000,      // Same as other success messages
            connecting: 3000,     // Show for 3 seconds
            disconnected: 0,      // Persistent until reconnected
            error: 5000          // Longer for errors
        };
        
        
        // Remove any existing network status notification
        if (this.notifications.has('network-status')) {
            // Get the notification data before removing
            const existingData = this.notifications.get('network-status');
            if (existingData && existingData.timeout) {
                clearTimeout(existingData.timeout);
            }
            // Force immediate removal without animation
            if (existingData && existingData.element && existingData.element.parentNode) {
                existingData.element.parentNode.removeChild(existingData.element);
            }
            this.notifications.delete('network-status');
        }
        
        // Show appropriate notification
        this.show({
            id: 'network-status',
            type: statusTypes[status] || 'info',
            message: statusMessages[status] || status,
            detail: detail,
            duration: durations[status] || 3000,
            persistent: status === 'disconnected',
            closeable: status !== 'disconnected'
        });
    }
    
    /**
     * Show a success notification
     */
    success(message, options = {}) {
        return this.show({ ...options, type: 'success', message });
    }
    
    /**
     * Show an error notification
     */
    error(message, options = {}) {
        return this.show({ ...options, type: 'error', message });
    }
    
    /**
     * Show a warning notification
     */
    warning(message, options = {}) {
        return this.show({ ...options, type: 'warning', message });
    }
    
    /**
     * Show an info notification
     */
    info(message, options = {}) {
        return this.show({ ...options, type: 'info', message });
    }
    
    /**
     * Clear all non-persistent notifications
     */
    clear() {
        this.notifications.forEach((data, id) => {
            if (!data.persistent) {
                this.remove(id);
            }
        });
    }
    
    /**
     * Get progress HTML
     */
    getProgressHTML(progress) {
        const { current, total, showBar = true } = progress;
        const percentage = Math.round((current / total) * 100);
        
        let html = '<div class="notification-progress-container">';
        
        if (showBar) {
            // Visual progress bar (like the blue one)
            html += `
                <div class="notification-progress-bar">
                    <div class="notification-progress-fill" style="width: ${percentage}%"></div>
                </div>
            `;
        } else {
            // Text-based progress bar (monospace blocks)
            const filled = Math.floor(percentage / 5);
            const empty = 20 - filled;
            const progressBar = '█'.repeat(filled) + '░'.repeat(empty);
            html += `<div class="notification-progress-text">${progressBar}</div>`;
        }
        
        html += `<div class="notification-progress-label">${percentage}%</div>`;
        html += '</div>';
        
        return html;
    }
    
    /**
     * Get icon for notification type
     */
    getIcon(type, customIcon) {
        if (customIcon) return customIcon;
        
        const icons = {
            success: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
            error: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
            warning: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
            info: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>'
        };
        
        return icons[type] || icons.info;
    }
    
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Create global instance
if (typeof window !== 'undefined') {
    window.unifiedNotifications = new UnifiedNotifications();
}