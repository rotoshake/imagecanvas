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
                font-family: ${FONT_CONFIG.APP_FONT};
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
            
            /* Action Buttons */
            .notification-actions {
                display: flex;
                gap: 8px;
                margin-top: 6px;
                flex-wrap: wrap;
            }
            
            .notification-action-btn {
                background: rgba(255, 255, 255, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.3);
                color: white;
                padding: 4px 8px;
                border-radius: 3px;
                font-size: 10px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
                text-decoration: none;
                white-space: nowrap;
            }
            
            .notification-action-btn:hover {
                background: rgba(255, 255, 255, 0.3);
                border-color: rgba(255, 255, 255, 0.5);
                transform: translateY(-1px);
            }
            
            .notification-action-btn:active {
                transform: translateY(0);
                background: rgba(255, 255, 255, 0.4);
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
                font-family: ${FONT_CONFIG.MONO_FONT};
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
            progress = null,  // { current, total, showBar }
            actions = null    // [{ text, action }]
        } = options;
        
        const notificationId = id || `notification-${++this.notificationIdCounter}`;

        // Remove existing notifications with same ID (immediately for rapid updates)
        if (id) {
            // Remove from notifications map
            if (this.notifications.has(id)) {
                const existingData = this.notifications.get(id);
                if (existingData) {
                    // Clear any timeout
                    if (existingData.timeout) {
                        clearTimeout(existingData.timeout);
                    }
                    // Immediately remove from DOM without animation
                    if (existingData.element && existingData.element.parentNode) {
                        existingData.element.parentNode.removeChild(existingData.element);
                    }
                }
                this.notifications.delete(id);
            }
            
            // Also search DOM for any orphaned elements with same ID (fallback)
            const existingElements = document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`);
            existingElements.forEach(element => {
                if (element.parentNode) {
                    element.parentNode.removeChild(element);
                }
            });
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
                ${actions ? this.getActionsHTML(actions) : ''}
            </div>
        `;

        notification.innerHTML = html;
        
        // Add action button event listeners if actions exist
        if (actions && actions.length > 0) {
            this.setupActionHandlers(notification, actions, notificationId);
        }
        
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
     * Hide a notification (alias for remove)
     */
    hide(id) {
        this.remove(id);
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
     * Generate actions HTML for a notification
     */
    getActionsHTML(actions) {
        if (!actions || !Array.isArray(actions) || actions.length === 0) {
            return '';
        }
        
        const actionButtons = actions.map((action, index) => {
            return `<button class="notification-action-btn" data-action-index="${index}">${this.escapeHtml(action.text)}</button>`;
        }).join('');
        
        return `<div class="notification-actions">${actionButtons}</div>`;
    }
    
    /**
     * Setup action button event handlers
     */
    setupActionHandlers(notification, actions, notificationId) {
        const actionButtons = notification.querySelectorAll('.notification-action-btn');
        
        actionButtons.forEach((button, index) => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const action = actions[index];
                if (action && typeof action.action === 'function') {
                    try {
                        action.action();
                    } catch (error) {
                        console.error('Notification action error:', error);
                    }
                }
            });
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
            info: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>',
            undo: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8C9.97 8 7.9 10.07 7.9 12.6V18h-3v-5.4C4.9 8.13 8.37 5 12.5 5c3.08 0 5.68 1.89 6.66 4.54L18.5 9.5l-1.41 1.41-1.2-1.2c-.4-1.21-1.52-2.11-2.89-2.11z"/></svg>'
        };
        
        return icons[type] || icons.info;
    }

    /**
     * Update undo operation status
     */
    updateUndoStatus(status, detail = null) {
        const statusMessages = {
            in_progress: 'Undoing...',
            success: 'Undo successful',
            failed: 'Undo failed'
        };
        
        const statusTypes = {
            in_progress: 'info',
            success: 'success',
            failed: 'error'
        };
        
        const durations = {
            in_progress: 0, // Persistent
            success: 3000,
            failed: 5000
        };

        this.show({
            id: 'undo-status',
            type: statusTypes[status] || 'info',
            message: statusMessages[status] || status,
            detail: detail,
            duration: durations[status],
            persistent: status === 'in_progress',
            icon: this.getIcon('undo')
        });
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