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
        
        // Track video processing queue
        this.videoQueue = new Map(); // filename -> {position, status, notificationId}
        this.activeVideoProcessing = null; // Currently processing video filename
        this.videoQueueContainer = null; // Container for queue items
        
        this.init();
    }
    
    init() {
        // Create main container
        this.container = document.createElement('div');
        this.container.className = 'unified-notifications';
        this.container.innerHTML = `
            <div class="status-area"></div>
            <div class="notification-area"></div>
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
                gap: 0;
                pointer-events: none;
                max-width: 280px;
            }
            
            .unified-notifications > * {
                pointer-events: auto;
            }
            
            /* Add gaps between areas */
            .status-area,
            .notification-area {
                display: flex;
                flex-direction: column;
                gap: 0; /* Don't use gap - use margins for smooth animations */
            }
            
            .status-area:not(:empty) {
                margin-bottom: 4px;
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
                overflow: hidden;
            }
            
            .notification-item.show {
                opacity: 1;
                transform: translateX(0px);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1), 
            }
            
            .notification-item.hiding {
                opacity: 0;
                transform: translateX(20px) scale(1.0);
                transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                           transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            .notification-wrapper.collapsing {
                transition: height 0.3s cubic-bezier(0.4, 0, 0.2, 1) 0.1s,
                           margin 0.3s cubic-bezier(0.4, 0, 0.2, 1) 0.1s;
            }
            
            /* Wrapper for smooth height animations */
            .notification-wrapper {
                overflow: visible;
                transition: height 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                           margin 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                margin-bottom: 8px;
            }
            
            .notification-wrapper:last-child {
                margin-bottom: 0;
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
            
            .notification-item.video {
                background: rgba(156, 39, 176, 0.9);
                border-color: rgba(156, 39, 176, 0.2);
            }
            
            /* Purple progress bar for video operations */
            .notification-item.video .notification-progress-fill {
                background: rgba(255, 255, 255, 0.9);
            }
            
            /* Compact queue items */
            .notification-item.video-queue-item {
                background: rgba(156, 39, 176, 0.7);
                border-color: rgba(156, 39, 176, 0.2);
                padding: 4px 12px;
                min-height: unset;
                font-size: 12px;
                margin-top: 4px;
                color: white;
                opacity: 1;
                transform: none;
                display: flex;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            .notification-item.video-queue-item:first-child {
                margin-top: 6px;
            }
            
            /* Smooth queue item animations */
            @keyframes slideInQueue {
                from {
                    opacity: 0;
                    transform: translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            @keyframes slideOutQueue {
                from {
                    opacity: 1;
                    transform: translateY(0);
                    max-height: 40px;
                    margin-top: 4px;
                    margin-bottom: 0;
                }
                to {
                    opacity: 0;
                    transform: translateY(-10px);
                    max-height: 0;
                    margin-top: 0;
                    margin-bottom: 0;
                    padding-top: 0;
                    padding-bottom: 0;
                }
            }
            
            .notification-item.video-queue-item {
                /* Remove automatic animation - we'll control it manually */
                /* animation: slideInQueue 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards; */
            }
            
            .notification-item.video-queue-item.removing {
                animation: slideOutQueue 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
            }
            
            .notification-item.video-queue-item .notification-content {
                flex-direction: row;
                align-items: center;
                gap: 8px;
                color: white;
            }
            
            .notification-item.video-queue-item .notification-message {
                flex: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                color: white;
            }
            
            .notification-item.video-queue-item .notification-detail {
                margin: 0;
                font-size: 11px;
                opacity: 0.8;
                color: white;
            }
            
            /* Collapsed queue summary */
            .notification-queue-summary {
                background: rgba(156, 39, 176, 0.7);
                padding: 6px 12px;
                margin-top: 2px;
                border-radius: 4px;
                font-size: 13px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: space-between;
                min-height: 28px;
                color: white;
                border: 1px solid rgba(156, 39, 176, 0.2);
                transition: all 0.2s ease;
            }
            
            .notification-queue-summary:hover {
                background: rgba(156, 39, 176, 0.8);
            }
            
            .notification-queue-summary .queue-count {
                font-weight: 500;
                color: white;
            }
            
            .notification-queue-summary .expand-icon {
                transition: transform 0.2s ease;
                font-size: 12px;
                color: white;
                display: inline-block;
                transform: rotate(0deg);
            }
            
            .notification-queue-summary.expanded .expand-icon {
                transform: rotate(90deg);
            }
            
            /* Video queue container */
            .video-queue-container {
                margin-top: 4px;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            .video-queue-items {
                max-height: 0;
                overflow: hidden;
                transition: max-height 0.3s ease;
            }
            
            .video-queue-items.expanded {
                max-height: 300px;
                overflow-y: auto;
            }
            
            /* Cancel button styling */
            .notification-cancel {
                width: 16px;
                height: 16px;
                cursor: pointer;
                opacity: 0.6;
                transition: opacity 0.15s ease;
                flex-shrink: 0;
                margin-left: 8px;
            }
            
            .notification-cancel:hover {
                opacity: 1;
            }
            
            .notification-cancel svg {
                width: 100%;
                height: 100%;
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
            actions = null,   // [{ text, action }]
            cancelable = false,
            onCancel = null
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
                    if (existingData.wrapper && existingData.wrapper.parentNode) {
                        existingData.wrapper.parentNode.removeChild(existingData.wrapper);
                    } else if (existingData.element && existingData.element.parentNode) {
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
        
        // Create wrapper element for smooth animations
        const wrapper = document.createElement('div');
        wrapper.className = 'notification-wrapper';
        
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
            ${cancelable ? this.getCancelButtonHTML() : ''}
        `;

        notification.innerHTML = html;
        
        // Add action button event listeners if actions exist
        if (actions && actions.length > 0) {
            this.setupActionHandlers(notification, actions, notificationId);
        }
        
        // Add cancel button handler if cancelable
        if (cancelable) {
            this.setupCancelHandler(notification, notificationId);
        }
        
        // Add notification to wrapper
        wrapper.appendChild(notification);
        
        // Add to appropriate area - new items go to the bottom
        if (persistent) {
            // For persistent notifications, check if it's a video and if there's a queue
            if (type === 'video' && this.videoQueueContainer && this.videoQueueContainer.parentNode === this.statusArea) {
                // Insert before the queue container to keep videos grouped
                this.statusArea.insertBefore(wrapper, this.videoQueueContainer);
            } else {
                this.statusArea.appendChild(wrapper);
            }
        } else {
            // For non-persistent notifications, always append to bottom
            this.notificationArea.appendChild(wrapper);
        }
        
        // Store reference with creation time
        this.notifications.set(notificationId, {
            element: notification,
            wrapper: wrapper,
            persistent,
            timeout: null,
            createdAt: Date.now(),
            onCancel: onCancel
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
        
        const { element, wrapper, timeout, createdAt } = notificationData;
        
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
            // First, fade out the notification
            element.classList.add('hiding');
            element.classList.remove('show');
            
            // After a short delay, start collapsing the height
            setTimeout(() => {
                // Get the current height before collapsing
                const currentHeight = wrapper.offsetHeight;
                wrapper.style.height = currentHeight + 'px';
                
                // Force reflow
                wrapper.offsetHeight;
                
                // Add collapsing class and animate to 0
                wrapper.classList.add('collapsing');
                requestAnimationFrame(() => {
                    wrapper.style.height = '0px';
                    wrapper.style.marginBottom = '0px';
                    wrapper.style.overflow = 'hidden';
                });
                
                // Remove after animation completes
                setTimeout(() => {
                    if (wrapper.parentNode) {
                        wrapper.parentNode.removeChild(wrapper);
                    }
                    this.notifications.delete(id);
                }, 400); // Wait for height animation to complete
            }, 100); // Small delay before height animation starts
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
            undo: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8C9.97 8 7.9 10.07 7.9 12.6V18h-3v-5.4C4.9 8.13 8.37 5 12.5 5c3.08 0 5.68 1.89 6.66 4.54L18.5 9.5l-1.41 1.41-1.2-1.2c-.4-1.21-1.52-2.11-2.89-2.11z"/></svg>',
            video: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>'
        };
        
        return icons[type] || icons.info;
    }

    /**
     * Show video processing notification
     */
    showVideoProcessing(filename, options = {}) {
        const notificationId = `video-${filename}`;
        
        // Add to queue tracking
        this.videoQueue.set(filename, {
            position: this.videoQueue.size + 1,
            status: 'uploading',
            notificationId: notificationId
        });
        
        // Update all queue positions
        this.updateQueuePositions();
        
        // Always show the notification (whether active or queued)
        const id = this.show({
            id: notificationId,
            type: 'video',
            message: options.message || `Processing video: ${filename}`,
            detail: options.detail,
            progress: options.progress,
            persistent: true,
            closeable: false,
            cancelable: true,
            onCancel: options.onCancel
        });
        
        // Update queue display
        this.updateQueueDisplay();
        
        return id;
    }
    
    /**
     * Update video processing progress
     */
    updateVideoProgress(filename, progress, format = null, customDetail = null) {
        const notificationId = `video-${filename}`;
        let detail = customDetail;
        
        // If no custom detail, generate based on format
        if (!detail && format) {
            detail = `Converting to ${format.toUpperCase()}`;
        }
        
        // Check if this is a queued status
        const isQueued = customDetail && customDetail.toLowerCase().includes('queued');
        
        if (isQueued && progress === 0) {
            // For queued status, update only the detail without progress bar
            this.update(notificationId, {
                detail,
                progress: null  // Remove progress bar for queued status
            });
        } else if (isQueued && progress === 30) {
            // Just switched from queued to processing, keep detail
            this.update(notificationId, {
                progress: {
                    current: progress,
                    total: 100,
                    showBar: true
                },
                detail
            });
        } else {
            // Normal progress update
            this.update(notificationId, {
                progress: {
                    current: progress,
                    total: 100,
                    showBar: true
                },
                detail
            });
        }
    }
    
    /**
     * Complete video processing
     */
    completeVideoProcessing(filename, success = true) {
        const notificationId = `video-${filename}`;
        
        if (success) {
            this.update(notificationId, {
                type: 'success',
                message: `Video processed: ${filename}`,
                detail: 'Optimized for web playback'
            });
            
            // Remove after 3 seconds
            setTimeout(() => this.remove(notificationId), 3000);
        } else {
            this.update(notificationId, {
                type: 'error',
                message: `Video processing failed: ${filename}`,
                detail: 'Original file will be used'
            });
            
            // Remove after 5 seconds
            setTimeout(() => this.remove(notificationId), 5000);
        }
        
        // Check if this was the active video before removing
        const wasActive = this.isActiveVideo(filename);
        
        // Remove from queue and update positions
        this.videoQueue.delete(filename);
        this.updateQueuePositions();
        
        // If the completed video was active, promote the next one
        if (wasActive) {
            this.promoteNextVideo();
        }
        
        this.updateQueueDisplay();
    }
    
    /**
     * Mark video as uploaded but still processing on server
     */
    markVideoUploaded(filename) {
        const notificationId = `video-${filename}`;
        
        this.update(notificationId, {
            type: 'info',
            message: `Uploaded: ${filename}`,
            detail: 'Processing on server...',
            progress: {
                current: 50,
                total: 100,
                showBar: true
            }
        });
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
     * Generate cancel button HTML
     */
    getCancelButtonHTML() {
        return `
            <div class="notification-cancel">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
            </div>
        `;
    }
    
    /**
     * Setup cancel button handler
     */
    setupCancelHandler(notification, notificationId) {
        const cancelBtn = notification.querySelector('.notification-cancel');
        if (!cancelBtn) return;
        
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Get the notification data
            const notificationData = this.notifications.get(notificationId);
            if (notificationData && notificationData.onCancel) {
                try {
                    notificationData.onCancel();
                } catch (error) {
                    console.error('Cancel handler error:', error);
                }
            }
            
            // Remove the notification
            this.remove(notificationId);
            
            // If this was a video notification, update queue
            if (notificationId.startsWith('video-')) {
                const filename = notificationId.substring(6);
                const wasActive = this.isActiveVideo(filename);
                
                this.videoQueue.delete(filename);
                this.updateQueuePositions();
                
                // If we cancelled the active video, promote the next one
                if (wasActive) {
                    this.promoteNextVideo();
                }
                
                this.updateQueueDisplay();
            }
        });
    }
    
    /**
     * Check if a video is the active (first) one
     */
    isActiveVideo(filename) {
        const sortedQueue = Array.from(this.videoQueue.entries())
            .sort((a, b) => a[1].position - b[1].position);
        
        if (sortedQueue.length > 0 && sortedQueue[0][0] === filename) {
            return true;
        }
        return false;
    }
    
    /**
     * Remove a specific queue item with smooth animation
     */
    removeQueueItem(filename) {
        if (!this.videoQueueContainer) return;
        
        const queueItem = this.videoQueueContainer.querySelector(`[data-filename="${this.escapeHtml(filename)}"]`);
        if (!queueItem) return;
        
        console.log(`🗑️ Smoothly removing queue item: ${filename}`);
        
        // Add removing class to trigger animation
        queueItem.classList.add('removing');
        
        // Remove from DOM after animation completes
        setTimeout(() => {
            if (queueItem.parentNode) {
                queueItem.remove();
            }
            
            // Update positions of remaining items
            this.updateQueuePositionsSmooth();
            
            // Check if we need to rebuild the queue display
            const remainingItems = this.videoQueueContainer.querySelectorAll('.video-queue-item:not(.removing)');
            if (remainingItems.length === 0) {
                // No more queue items, remove the container
                this.videoQueueContainer.remove();
                this.videoQueueContainer = null;
            } else {
                // Update the queue count
                const countElement = this.videoQueueContainer.querySelector('.queue-count');
                if (countElement) {
                    countElement.textContent = `${remainingItems.length} videos queued`;
                }
            }
        }, 300); // Match animation duration
    }
    
    /**
     * Update queue positions smoothly without full rebuild
     */
    updateQueuePositionsSmooth() {
        if (!this.videoQueueContainer) return;
        
        const queueItems = this.videoQueueContainer.querySelectorAll('.video-queue-item:not(.removing)');
        queueItems.forEach((item, index) => {
            const position = index + 2; // +2 because first item is active (position 1)
            const positionElement = item.querySelector('.notification-detail');
            if (positionElement) {
                positionElement.textContent = `Position ${position}`;
            }
        });
    }
    
    /**
     * Promote the next video in queue to active position
     */
    promoteNextVideo() {
        const sortedQueue = Array.from(this.videoQueue.entries())
            .sort((a, b) => a[1].position - b[1].position);
        
        if (sortedQueue.length > 0) {
            const [nextFilename, nextInfo] = sortedQueue[0];
            const notification = this.notifications.get(nextInfo.notificationId);
            
            if (notification && notification.element) {
                // Show the promoted notification with smooth animation
                notification.element.style.display = 'flex';
                
                // If it's hidden in the queue, animate it to active position
                if (notification.wrapper) {
                    notification.wrapper.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
                }
                
                console.log(`📤 Promoted ${nextFilename} to active position`);
                
                // Update positions after promotion
                setTimeout(() => {
                    this.updateQueuePositions();
                    this.updateQueueDisplay();
                }, 100);
            }
        }
    }
    
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * Update queue positions and display
     */
    updateQueuePositions() {
        let position = 1;
        const sortedQueue = Array.from(this.videoQueue.entries())
            .sort((a, b) => a[1].position - b[1].position);
        
        sortedQueue.forEach(([filename, info]) => {
            info.position = position++;
            
            // Update notification detail with queue position
            const notificationId = info.notificationId;
            const notificationData = this.notifications.get(notificationId);
            
            if (notificationData && info.position > 1) {
                // Update queued items to show position
                const detail = info.status === 'uploading' 
                    ? `Uploading... • Queue position ${info.position}`
                    : `Queued • Position ${info.position} of ${this.videoQueue.size}`;
                
                this.update(notificationId, { detail });
            }
        });
    }
    
    /**
     * Update queue display (collapsed/expanded)
     */
    updateQueueDisplay() {
        // Get all video notifications
        const videoNotifications = Array.from(this.notifications.entries())
            .filter(([id]) => id.startsWith('video-'));
        
        // Also check videoQueue size
        const actualQueueSize = this.videoQueue.size;
        // Only log if there's a mismatch or unusual state
        if (videoNotifications.length !== actualQueueSize) {
            console.log(`🎥 Video queue state mismatch: ${videoNotifications.length} notifications, ${actualQueueSize} in queue`);
        }
        
        if (videoNotifications.length <= 1 && actualQueueSize <= 1) {
            // Hide any existing queue container
            if (this.videoQueueContainer) {
                this.videoQueueContainer.remove();
                this.videoQueueContainer = null;
            }
            return;
        }
        
        // If we have a queue container with items being removed, don't rebuild yet
        if (this.videoQueueContainer && this.videoQueueContainer.querySelector('.removing')) {
            console.log(`🎬 Skipping queue rebuild - items are being removed`);
            return;
        }
        
        // Get all videos from the queue (not just those with notifications)
        const allQueuedVideos = Array.from(this.videoQueue.entries())
            .map(([filename, info]) => ({
                filename,
                position: info.position,
                notificationId: info.notificationId,
                hasNotification: this.notifications.has(info.notificationId)
            }))
            .sort((a, b) => a.position - b.position);
        
        // Debug logging disabled to reduce console noise
        // console.log(`📊 All queued videos:`, allQueuedVideos);
        
        // First video is active, rest are queued
        const [active, ...queued] = allQueuedVideos;
        
        // If no queued videos, nothing to show
        if (!queued || queued.length === 0) {
            if (this.videoQueueContainer) {
                this.videoQueueContainer.remove();
                this.videoQueueContainer = null;
            }
            return;
        }
        
        // Find the active notification
        const activeNotification = active ? this.notifications.get(active.notificationId) : null;
        
        // Hide queued notifications (but not the active one)
        queued.forEach(({ notificationId }) => {
            const notification = this.notifications.get(notificationId);
            if (notification && notification.element) {
                notification.element.style.display = 'none';
            }
        });
        
        // Remove existing queue container if exists
        if (this.videoQueueContainer) {
            this.videoQueueContainer.remove();
        }
        
        // Create new queue container
        this.videoQueueContainer = document.createElement('div');
        this.videoQueueContainer.className = 'video-queue-container';
        
        // Insert right after the active notification's wrapper
        if (activeNotification && activeNotification.wrapper) {
            if (activeNotification.wrapper.nextSibling) {
                activeNotification.wrapper.parentNode.insertBefore(this.videoQueueContainer, activeNotification.wrapper.nextSibling);
            } else {
                activeNotification.wrapper.parentNode.appendChild(this.videoQueueContainer);
            }
        } else {
            // Fallback: append to notification area
            this.notificationArea.appendChild(this.videoQueueContainer);
        }
        
        // Build queue HTML
        const isExpanded = this.videoQueueContainer.dataset.expanded === 'true';
        
        // Debug logging disabled to reduce console noise
        // console.log(`📋 Building queue UI: ${queued.length} videos queued`, queued.map(q => q.filename));
        
        this.videoQueueContainer.innerHTML = `
            <div class="notification-queue-summary ${isExpanded ? 'expanded' : ''}" data-queue-toggle>
                <span class="queue-count">${queued.length} videos queued</span>
                <span class="expand-icon">▶</span>
            </div>
            <div class="video-queue-items ${isExpanded ? 'expanded' : ''}">
                ${queued.map(({ filename, position }) => `
                    <div class="notification-item video-queue-item" 
                         data-filename="${this.escapeHtml(filename)}">
                        <div class="notification-content">
                            <div class="notification-message">${this.escapeHtml(filename)}</div>
                            <div class="notification-detail">Position ${position}</div>
                        </div>
                        <div class="notification-cancel" data-cancel-filename="${this.escapeHtml(filename)}">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                            </svg>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        
        // Add event handlers
        this.setupQueueHandlers();
    }
    
    /**
     * Setup queue UI handlers
     */
    setupQueueHandlers() {
        if (!this.videoQueueContainer) return;
        
        // Toggle expand/collapse
        const toggle = this.videoQueueContainer.querySelector('[data-queue-toggle]');
        if (toggle) {
            toggle.addEventListener('click', () => {
                const isExpanded = this.videoQueueContainer.dataset.expanded === 'true';
                const newExpanded = !isExpanded;
                
                this.videoQueueContainer.dataset.expanded = newExpanded;
                
                const summary = this.videoQueueContainer.querySelector('.notification-queue-summary');
                const items = this.videoQueueContainer.querySelector('.video-queue-items');
                
                if (summary) {
                    if (newExpanded) {
                        summary.classList.add('expanded');
                    } else {
                        summary.classList.remove('expanded');
                    }
                }
                
                if (items) {
                    if (newExpanded) {
                        items.classList.add('expanded');
                    } else {
                        items.classList.remove('expanded');
                    }
                }
            });
        }
        
        // Cancel buttons
        const cancelBtns = this.videoQueueContainer.querySelectorAll('[data-cancel-filename]');
        cancelBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const filename = btn.dataset.cancelFilename;
                const notificationId = `video-${filename}`;
                
                // Call cancel handler
                const notificationData = this.notifications.get(notificationId);
                if (notificationData && notificationData.onCancel) {
                    try {
                        notificationData.onCancel();
                    } catch (error) {
                        console.error('Cancel handler error:', error);
                    }
                }
                
                // Check if this is the active video
                const wasActive = this.isActiveVideo(filename);
                
                // Remove from queue data structure
                this.videoQueue.delete(filename);
                
                if (wasActive) {
                    // If cancelling active video, remove the main notification and promote next
                    this.remove(notificationId);
                    this.updateQueuePositions();
                    this.promoteNextVideo();
                    this.updateQueueDisplay();
                } else {
                    // If cancelling queued video, use smooth removal
                    this.removeQueueItem(filename);
                    // Also remove the hidden notification
                    this.remove(notificationId);
                    // Update queue positions in the data structure
                    this.updateQueuePositions();
                }
            });
        });
    }
}

// Create global instance
if (typeof window !== 'undefined') {
    window.unifiedNotifications = new UnifiedNotifications();
}