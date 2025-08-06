/**
 * ChatPanel - Instant messaging panel with chat bubbles
 * Activated with apostrophe (') key, shows messages as bubbles near mouse
 */
class ChatPanel {
    constructor(app) {
        this.app = app;
        this.isOpen = false;
        this.messages = []; // Array of {userId, username, color, message, timestamp}
        this.chatBubbles = new Map(); // userId -> bubble element
        this.bubbleTimeouts = new Map(); // userId -> timeoutId
        this.bubbleLifetime = 5000; // 5 seconds
        
        this.createUI();
        this.setupEventListeners();
        this.setupNetworkListeners();
    }
    
    createUI() {
        // Create chat panel
        this.panel = document.createElement('div');
        this.panel.className = 'chat-panel';
        this.panel.innerHTML = `
            <div class="chat-header">
                <span class="chat-title">Chat</span>
                <button class="chat-close-btn">×</button>
            </div>
            <div class="chat-messages"></div>
            <div class="chat-input-container">
                <input type="text" class="chat-input" placeholder="Type a message..." />
                <button class="chat-send-btn">Send</button>
            </div>
        `;
        
        // Get elements
        this.messagesContainer = this.panel.querySelector('.chat-messages');
        this.input = this.panel.querySelector('.chat-input');
        this.sendBtn = this.panel.querySelector('.chat-send-btn');
        this.closeBtn = this.panel.querySelector('.chat-close-btn');
        
        // Add styles
        this.addStyles();
        
        // Add to DOM
        document.body.appendChild(this.panel);
    }
    
    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Chat Panel */
            .chat-panel {
                position: fixed;
                bottom: -300px;
                left: 50%;
                transform: translateX(-50%);
                width: 400px;
                height: 300px;
                background: rgba(30, 30, 30, 0.95);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px 8px 0 0;
                box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.3);
                display: flex;
                flex-direction: column;
                transition: bottom 0.3s ease;
                z-index: 1000;
                font-family: ${window.FONT_CONFIG?.APP_FONT || 'Arial'};
            }
            
            .chat-panel.open {
                bottom: 0;
            }
            
            .chat-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 12px;
                background: rgba(0, 0, 0, 0.3);
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .chat-title {
                font-size: 14px;
                font-weight: bold;
                color: #fff;
            }
            
            .chat-close-btn {
                background: none;
                border: none;
                color: #999;
                font-size: 20px;
                cursor: pointer;
                padding: 0;
                width: 24px;
                height: 24px;
                line-height: 1;
            }
            
            .chat-close-btn:hover {
                color: #fff;
            }
            
            .chat-messages {
                flex: 1;
                overflow-y: auto;
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            
            .chat-message {
                display: flex;
                align-items: flex-start;
                gap: 8px;
            }
            
            .chat-message-own {
                flex-direction: row-reverse;
            }
            
            .chat-message-own .chat-content {
                align-items: flex-end;
            }
            
            .chat-message-own .chat-username {
                text-align: right;
            }
            
            .chat-message-own .chat-text {
                text-align: right;
            }
            
            .chat-avatar {
                width: 24px;
                height: 24px;
                border-radius: 50%;
                background: #333;
                border: 2px solid;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                font-weight: bold;
                color: #fff;
                flex-shrink: 0;
            }
            
            .chat-content {
                flex: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
            }
            
            .chat-username {
                font-size: 11px;
                font-weight: bold;
                margin-bottom: 2px;
            }
            
            .chat-text {
                font-size: 13px;
                color: #e0e0e0;
                word-wrap: break-word;
            }
            
            .chat-time {
                font-size: 10px;
                color: #666;
                margin-left: 4px;
            }
            
            .chat-input-container {
                display: flex;
                gap: 8px;
                padding: 12px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .chat-input {
                flex: 1;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 4px;
                color: #fff;
                padding: 6px 10px;
                font-size: 13px;
                font-family: inherit;
            }
            
            .chat-input:focus {
                outline: none;
                border-color: rgba(255, 255, 255, 0.4);
                background: rgba(255, 255, 255, 0.15);
            }
            
            .chat-input::placeholder {
                color: rgba(255, 255, 255, 0.5);
            }
            
            .chat-send-btn {
                background: #4af;
                border: none;
                border-radius: 4px;
                color: #000;
                font-weight: bold;
                padding: 6px 16px;
                cursor: pointer;
                font-size: 13px;
                transition: background 0.2s;
            }
            
            .chat-send-btn:hover {
                background: #5bf;
            }
            
            /* Chat Bubbles */
            .chat-bubble {
                position: fixed;
                background: rgba(0, 0, 0, 0.9);
                border: 2px solid;
                border-radius: 8px;
                padding: 6px 10px;
                max-width: 200px;
                word-wrap: break-word;
                font-size: 13px;
                color: #fff;
                z-index: 999;
                pointer-events: none;
                animation: bubbleFadeIn 0.3s ease;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            }
            
            .chat-bubble.fade-out {
                animation: bubbleFadeOut 0.3s ease;
                opacity: 0;
            }
            
            .chat-bubble-username {
                font-size: 11px;
                font-weight: bold;
                margin-bottom: 2px;
            }
            
            .chat-bubble-text {
                font-size: 13px;
            }
            
            @keyframes bubbleFadeIn {
                from {
                    opacity: 0;
                    transform: scale(0.8) translateY(10px);
                }
                to {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }
            }
            
            @keyframes bubbleFadeOut {
                from {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }
                to {
                    opacity: 0;
                    transform: scale(0.8) translateY(-10px);
                }
            }
            
            /* Scrollbar styling */
            .chat-messages::-webkit-scrollbar {
                width: 6px;
            }
            
            .chat-messages::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.05);
            }
            
            .chat-messages::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.2);
                border-radius: 3px;
            }
            
            .chat-messages::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.3);
            }
        `;
        document.head.appendChild(style);
    }
    
    setupEventListeners() {
        // Keyboard shortcut (backtick key)
        document.addEventListener('keydown', (e) => {
            if (e.key === '`' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Don't toggle if already typing in an input
                if (document.activeElement.tagName === 'INPUT' || 
                    document.activeElement.tagName === 'TEXTAREA') {
                    return;
                }
                
                e.preventDefault();
                this.toggle();
            }
        });
        
        // Global escape handler for when chat panel elements have focus
        this.panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                e.preventDefault();
                e.stopPropagation();
                this.close();
                
                // Return focus to canvas so next Esc can exit gallery view
                if (this.app.graphCanvas && this.app.graphCanvas.canvas) {
                    this.app.graphCanvas.canvas.focus();
                }
            }
        });
        
        // Close button
        this.closeBtn.addEventListener('click', () => this.close());
        
        // Send button
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        
        // Enter key in input
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
            
            // Prevent backtick from closing panel while typing
            if (e.key === '`') {
                e.stopPropagation();
            }
            
            // Stop all other hotkeys from propagating while typing
            // except for Escape which we handle separately
            if (e.key !== 'Escape') {
                e.stopPropagation();
            }
        });
        
        // Escape key to close
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.close();
                
                // Return focus to canvas so next Esc can exit gallery view
                if (this.app.graphCanvas && this.app.graphCanvas.canvas) {
                    this.app.graphCanvas.canvas.focus();
                }
            }
        });
    }
    
    setupNetworkListeners() {
        if (!this.app.networkLayer) return;
        
        // Listen for chat messages from other users
        this.app.networkLayer.on('chat_message', (data) => {
            this.handleIncomingMessage(data);
        });
        
        // Clear messages when joining a new canvas
        this.app.networkLayer.on('canvas_joined', () => {
            this.clearMessages();
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
        this.input.focus();
    }
    
    close() {
        this.isOpen = false;
        this.panel.classList.remove('open');
    }
    
    sendMessage() {
        const message = this.input.value.trim();
        if (!message) return;
        
        // Clear input
        this.input.value = '';
        
        // Get current mouse position from the last known position
        let mouseX, mouseY;
        if (this.app.otherUsersMouseManager && this.app.otherUsersMouseManager.currentMousePosition) {
            mouseX = this.app.otherUsersMouseManager.currentMousePosition.x;
            mouseY = this.app.otherUsersMouseManager.currentMousePosition.y;
        } else if (this.app.graphCanvas && this.app.graphCanvas.canvas_mouse_pos) {
            const mousePos = this.app.graphCanvas.canvas_mouse_pos;
            mouseX = mousePos[0];
            mouseY = mousePos[1];
        }
        
        // Send message through network
        if (this.app.networkLayer && this.app.networkLayer.isConnected) {
            this.app.networkLayer.emit('chat_message', {
                message: message,
                mouseX: mouseX,
                mouseY: mouseY
            });
        }
        
        // Add to local chat history
        if (this.app.currentUser) {
            const userInfo = {
                userId: this.app.networkLayer?.numericUserId || this.app.currentUser.id,
                username: this.app.currentUser.displayName || this.app.currentUser.username,
                color: this.app.currentUser.color || '#4af'
            };
            
            this.addMessage(userInfo.userId, userInfo.username, userInfo.color, message);
            
            // Show bubble near mouse position
            if (mouseX !== undefined && mouseY !== undefined) {
                // Convert graph coordinates to screen coordinates
                const screenPos = this.app.graphCanvas.viewport.convertGraphToOffset(mouseX, mouseY);
                const canvas = this.app.graphCanvas.canvas;
                const rect = canvas.getBoundingClientRect();
                const x = rect.left + screenPos[0];
                const y = rect.top + screenPos[1];
                this.showChatBubble(userInfo.userId, userInfo.username, userInfo.color, message, x, y);
            }
        }
    }
    
    handleIncomingMessage(data) {
        const { userId, username, color, message, mouseX, mouseY } = data;
        
        // Add to chat history
        this.addMessage(userId, username, color, message);
        
        // Show bubble near user's mouse position
        if (mouseX !== undefined && mouseY !== undefined) {
            // Convert graph coordinates to screen coordinates
            const screenPos = this.app.graphCanvas.viewport.convertGraphToOffset(mouseX, mouseY);
            const canvas = this.app.graphCanvas.canvas;
            const rect = canvas.getBoundingClientRect();
            const x = rect.left + screenPos[0];
            const y = rect.top + screenPos[1];
            this.showChatBubble(userId, username, color, message, x, y);
        }
    }
    
    addMessage(userId, username, color, message) {
        const timestamp = new Date();
        
        // Add to messages array
        this.messages.push({
            userId,
            username,
            color,
            message,
            timestamp
        });
        
        // Check if this is our own message
        const isOwnMessage = userId === this.app.networkLayer?.numericUserId;
        
        // Create message element
        const messageEl = document.createElement('div');
        messageEl.className = isOwnMessage ? 'chat-message chat-message-own' : 'chat-message';
        
        const initial = username ? username.charAt(0).toUpperCase() : '?';
        const timeStr = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        if (isOwnMessage) {
            // Own message - same structure but will be mirrored by CSS
            messageEl.innerHTML = `
                <div class="chat-avatar" style="border-color: ${color}">${initial}</div>
                <div class="chat-content">
                    <div class="chat-username" style="color: ${color}">
                        You
                        <span class="chat-time">${timeStr}</span>
                    </div>
                    <div class="chat-text">${this.escapeHtml(message)}</div>
                </div>
            `;
        } else {
            // Other user's message
            messageEl.innerHTML = `
                <div class="chat-avatar" style="border-color: ${color}">${initial}</div>
                <div class="chat-content">
                    <div class="chat-username" style="color: ${color}">
                        ${username}
                        <span class="chat-time">${timeStr}</span>
                    </div>
                    <div class="chat-text">${this.escapeHtml(message)}</div>
                </div>
            `;
        }
        
        this.messagesContainer.appendChild(messageEl);
        
        // Scroll to bottom
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
    
    showChatBubble(userId, username, color, message, x, y) {
        // Remove existing bubble for this user
        const existingBubble = this.chatBubbles.get(userId);
        if (existingBubble) {
            existingBubble.remove();
            clearTimeout(this.bubbleTimeouts.get(userId));
        }
        
        // Create new bubble
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble';
        bubble.style.borderColor = color;
        bubble.innerHTML = `
            <div class="chat-bubble-username" style="color: ${color}">${username}</div>
            <div class="chat-bubble-text">${this.escapeHtml(message)}</div>
        `;
        
        // Position bubble (offset from mouse position)
        bubble.style.left = `${x + 20}px`;
        bubble.style.top = `${y - 40}px`;
        
        document.body.appendChild(bubble);
        this.chatBubbles.set(userId, bubble);
        
        // Auto-remove after timeout
        const timeoutId = setTimeout(() => {
            bubble.classList.add('fade-out');
            setTimeout(() => {
                bubble.remove();
                this.chatBubbles.delete(userId);
            }, 300);
        }, this.bubbleLifetime);
        
        this.bubbleTimeouts.set(userId, timeoutId);
    }
    
    clearMessages() {
        this.messages = [];
        this.messagesContainer.innerHTML = '';
        
        // Remove all bubbles
        this.chatBubbles.forEach(bubble => bubble.remove());
        this.chatBubbles.clear();
        
        // Clear timeouts
        this.bubbleTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        this.bubbleTimeouts.clear();
    }
    
    escapeHtml(unsafe) {
        const div = document.createElement('div');
        div.textContent = unsafe;
        return div.innerHTML;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChatPanel;
} else if (typeof window !== 'undefined') {
    window.ChatPanel = ChatPanel;
}