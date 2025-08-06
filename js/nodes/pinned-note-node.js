// ===================================
// PINNED NOTE NODE CLASS
// ===================================

class PinnedNoteNode extends BaseNode {
    constructor() {
        super('ui/pinned-note');
        this.title = 'Pinned Note';
        
        this.properties = {
            text: '',
            bgColor: '#000000',
            bgAlpha: 0.9,
            borderColor: '#4af',
            textColor: '#fff',
            fontSize: 13,
            padding: 12,
            username: '',
            timestamp: null,
            pointerPosition: 'bottom-left' // Position of the speech bubble tail
        };
        
        this.flags = { 
            hide_title: true,
            no_collapse: true
        };
        
        this.size = [200, 80];
        this.minSize = [100, 60];
        this.resizable = true;
        
        // Tail/pointer dimensions
        this.tailWidth = 15;
        this.tailHeight = 20;
        this.tailCurve = 5;
        
        // Screen-space rendering
        this.isScreenSpace = true;
        this.isEditing = false;
        this.anchorPoint = null; // Where the tail points to in graph coordinates
    }
    
    setText(text) {
        this.properties.text = text;
        this.autoResize();
        this.markDirty();
    }
    
    setUserInfo(username, color) {
        this.properties.username = username;
        this.properties.borderColor = color;
        this.properties.timestamp = new Date().toISOString();
        this.markDirty();
    }
    
    onDrawForeground(ctx) {
        // Don't draw on main canvas - we render on overlay
        // This keeps the node selectable but invisible on main canvas
    }
    
    onDrawOverlay(ctx) {
        const canvas = this.graph?.canvas;
        if (!canvas || !canvas.viewport) return;
        
        const viewport = canvas.viewport;
        const scale = viewport.scale;
        
        // Determine if we should show compact mode based on zoom
        const isCompact = scale < 0.5; // Show compact when zoomed out beyond 50%
        
        const { bgColor, bgAlpha, borderColor, textColor, fontSize, padding, text, username } = this.properties;
        
        ctx.save();
        
        // Draw speech bubble background with tail
        if (isCompact) {
            this.drawCompactBubble(ctx, borderColor);
        } else {
            this.drawSpeechBubble(ctx, bgColor, bgAlpha, borderColor);
            
            // Skip text if being edited
            if (!this.isEditing) {
                // Draw username if present
                let yOffset = padding;
                if (username) {
                    ctx.font = `bold 11px ${window.FONT_CONFIG?.APP_FONT_CANVAS || 'Univers, sans-serif'}`;
                    ctx.fillStyle = borderColor;
                    ctx.fillText(username, padding, yOffset + 9);
                    yOffset += 16;
                }
                
                // Draw text
                if (text) {
                    ctx.font = `${fontSize}px ${window.FONT_CONFIG?.APP_FONT_CANVAS || 'Univers, sans-serif'}`;
                    ctx.fillStyle = textColor;
                    
                    // Word wrap text
                    const maxWidth = this.size[0] - padding * 2;
                    const lines = this.wrapText(ctx, text, maxWidth);
                    
                    const lineHeight = fontSize * 1.3;
                    for (const line of lines) {
                        ctx.fillText(line, padding, yOffset + fontSize);
                        yOffset += lineHeight;
                    }
                }
            }
        }
        
        ctx.restore();
    }
    
    drawCompactBubble(ctx, borderColor) {
        // Draw a simple circle when zoomed out
        const radius = 8;
        
        ctx.beginPath();
        ctx.arc(this.size[0] / 2, this.size[1] / 2, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fill();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Small tail
        ctx.beginPath();
        ctx.moveTo(this.size[0] / 2 - 4, this.size[1] / 2 + radius);
        ctx.lineTo(this.size[0] / 2 - 8, this.size[1] / 2 + radius + 8);
        ctx.lineTo(this.size[0] / 2, this.size[1] / 2 + radius);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fill();
        ctx.strokeStyle = borderColor;
        ctx.stroke();
    }
    
    drawSpeechBubble(ctx, bgColor, bgAlpha, borderColor) {
        const width = this.size[0];
        const height = this.size[1];
        const radius = 8;
        
        // Parse background color for alpha
        const color = this.parseColor(bgColor);
        
        // Start drawing the speech bubble
        ctx.beginPath();
        
        // Top edge
        ctx.moveTo(radius, 0);
        ctx.lineTo(width - radius, 0);
        ctx.arcTo(width, 0, width, radius, radius);
        
        // Right edge
        ctx.lineTo(width, height - radius);
        ctx.arcTo(width, height, width - radius, height, radius);
        
        // Bottom edge (with tail on the left)
        ctx.lineTo(this.tailWidth + radius + 10, height);
        
        // Draw tail pointing to bottom-left
        ctx.lineTo(this.tailWidth + 5, height + this.tailHeight); // Tail point
        ctx.lineTo(radius + 5, height);
        
        // Continue bottom edge
        ctx.lineTo(radius, height);
        ctx.arcTo(0, height, 0, height - radius, radius);
        
        // Left edge
        ctx.lineTo(0, radius);
        ctx.arcTo(0, 0, radius, 0, radius);
        
        ctx.closePath();
        
        // Fill background
        if (bgAlpha > 0 && color) {
            ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${bgAlpha})`;
            ctx.fill();
        }
        
        // Draw border
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    
    wrapText(ctx, text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);
            
            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        
        if (currentLine) {
            lines.push(currentLine);
        }
        
        return lines;
    }
    
    autoResize() {
        if (!this.properties.text) return;
        
        const ctx = this.graph?.canvas?.ctx;
        if (!ctx) return;
        
        ctx.save();
        ctx.font = `${this.properties.fontSize}px ${window.FONT_CONFIG?.APP_FONT_CANVAS || 'Univers, sans-serif'}`;
        
        const padding = this.properties.padding * 2;
        const lines = this.properties.text.split('\n');
        let maxWidth = 0;
        
        // Calculate max width needed
        for (const line of lines) {
            const metrics = ctx.measureText(line);
            maxWidth = Math.max(maxWidth, metrics.width);
        }
        
        // Calculate height needed
        const lineHeight = this.properties.fontSize * 1.3;
        let totalHeight = lines.length * lineHeight + padding;
        
        // Add space for username if present
        if (this.properties.username) {
            totalHeight += 16;
        }
        
        // Add space for tail
        totalHeight += 10;
        
        // Update size
        this.size[0] = Math.min(400, Math.max(this.minSize[0], maxWidth + padding));
        this.size[1] = Math.max(this.minSize[1], totalHeight);
        
        ctx.restore();
        this.markDirty();
    }
    
    parseColor(colorString) {
        if (!colorString) return null;
        
        // Handle hex colors
        const hexMatch = colorString.match(/^#([0-9a-fA-F]{6})$/);
        if (hexMatch) {
            const hex = hexMatch[1];
            return {
                r: parseInt(hex.substr(0, 2), 16),
                g: parseInt(hex.substr(2, 2), 16),
                b: parseInt(hex.substr(4, 2), 16)
            };
        }
        
        // Handle rgb colors
        const rgbMatch = colorString.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        if (rgbMatch) {
            return {
                r: parseInt(rgbMatch[1]),
                g: parseInt(rgbMatch[2]),
                b: parseInt(rgbMatch[3])
            };
        }
        
        return { r: 0, g: 0, b: 0 };
    }
    
    // Override to include tail in bounds checking
    getBounding() {
        const bounds = [
            this.pos[0],
            this.pos[1],
            this.pos[0] + this.size[0],
            this.pos[1] + this.size[1] + this.tailHeight
        ];
        return bounds;
    }
    
    // Check if point is inside the bubble (including tail)
    isPointInside(x, y) {
        // Check main bubble area
        if (x >= this.pos[0] && x <= this.pos[0] + this.size[0] &&
            y >= this.pos[1] && y <= this.pos[1] + this.size[1]) {
            return true;
        }
        
        // Check tail area (approximate)
        const tailLeft = this.pos[0] + 5;
        const tailRight = this.pos[0] + this.tailWidth + 15;
        const tailTop = this.pos[1] + this.size[1];
        const tailBottom = this.pos[1] + this.size[1] + this.tailHeight;
        
        if (x >= tailLeft && x <= tailRight &&
            y >= tailTop && y <= tailBottom) {
            return true;
        }
        
        return false;
    }
    
    // Double-click to edit
    onDblClick(e) {
        if (this.graph?.canvas?.startPinnedNoteEditing) {
            this.graph.canvas.startPinnedNoteEditing(this, e);
            return true;
        }
        return false;
    }
    
    // Start/stop editing
    startEditing() {
        this.isEditing = true;
        this.markDirty();
    }
    
    stopEditing() {
        this.isEditing = false;
        this.autoResize();
        this.markDirty();
    }
    
    // Export note content
    getInfo() {
        return {
            text: this.properties.text,
            username: this.properties.username,
            timestamp: this.properties.timestamp,
            color: this.properties.borderColor
        };
    }
}

// Make PinnedNoteNode available globally for browser environments
if (typeof window !== 'undefined') {
    window.PinnedNoteNode = PinnedNoteNode;
}