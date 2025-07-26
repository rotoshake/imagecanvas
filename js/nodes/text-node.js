// ===================================
// TEXT NODE CLASS
// ===================================

class TextNode extends BaseNode {
    constructor() {
        super('media/text');
        this.title = 'Text';
        this.properties = {
            text: '',
            bgColor: '#fff',
            bgAlpha: 0.0,
            fontSize: 16,
            leadingFactor: 1.0,
            textColor: '#fff',
            fontFamily: 'Arial',
            textAlign: 'left',
            padding: 10
        };
        this.flags = { hide_title: true };
        this.size = [200, 100];
        this.minSize = [50, 30];
        this.isEditing = false;
    }
    
    setText(text) {
        this.properties.text = text;
        this.fitTextToBox();
        this.markDirty();
        
        // Broadcast text change for collaboration
        if (this.graph?.canvas?.broadcastNodePropertyUpdate) {
            this.graph.canvas.broadcastNodePropertyUpdate(this.id, 'text', text);
        }
    }
    
    setFontSize(fontSize) {
        this.properties.fontSize = Utils.clamp(fontSize, 6, 200);
        this.markDirty();
        
        // Broadcast font size change for collaboration
        if (this.graph?.canvas?.broadcastNodePropertyUpdate) {
            this.graph.canvas.broadcastNodePropertyUpdate(this.id, 'fontSize', this.properties.fontSize);
        }
    }
    
    setBackgroundColor(color, alpha = null) {
        this.properties.bgColor = color;
        if (alpha !== null) {
            this.properties.bgAlpha = Utils.clamp(alpha, 0, 1);
        }
        this.markDirty();
        
        // Broadcast background color changes for collaboration
        if (this.graph?.canvas?.broadcastNodePropertyUpdate) {
            this.graph.canvas.broadcastNodePropertyUpdate(this.id, 'bgColor', color);
            if (alpha !== null) {
                this.graph.canvas.broadcastNodePropertyUpdate(this.id, 'bgAlpha', this.properties.bgAlpha);
            }
        }
    }
    
    setTextColor(color) {
        this.properties.textColor = color;
        this.markDirty();
        
        // Broadcast text color change for collaboration
        if (this.graph?.canvas?.broadcastNodePropertyUpdate) {
            this.graph.canvas.broadcastNodePropertyUpdate(this.id, 'textColor', color);
        }
    }
    
    onResize() {
        super.onResize();
        this.fitTextToBox();
    }
    
    fitTextToBox() {
        const ctx = this.graph?.canvas?.ctx;
        if (!ctx || !this.properties.text) {
            this.properties.fontSize = 16;
            return;
        }
        
        const padding = this.properties.padding;
        const maxWidth = this.size[0] - padding * 2;
        const maxHeight = this.size[1] - padding * 2;
        
        if (maxWidth <= 0 || maxHeight <= 0) return;
        
        // Binary search for optimal font size
        let minSize = 6;
        let maxSize = 200;
        let bestSize = minSize;
        
        while (minSize <= maxSize) {
            const testSize = Math.floor((minSize + maxSize) / 2);
            const textHeight = this.measureTextHeight(ctx, testSize, maxWidth);
            
            if (textHeight <= maxHeight) {
                bestSize = testSize;
                minSize = testSize + 1;
            } else {
                maxSize = testSize - 1;
            }
        }
        
        this.properties.fontSize = bestSize;
    }
    
    measureTextHeight(ctx, fontSize, maxWidth) {
        ctx.save();
        ctx.font = `${fontSize}px ${this.properties.fontFamily}`;
        
        const lineHeight = fontSize * this.properties.leadingFactor;
        const lines = this.properties.text.split('\n');
        let totalHeight = 0;
        
        for (const line of lines) {
            if (line.trim() === '') {
                totalHeight += lineHeight;
                continue;
            }
            
            const lineCount = this.getLineCount(ctx, line, maxWidth);
            totalHeight += lineCount * lineHeight;
        }
        
        ctx.restore();
        return totalHeight;
    }
    
    getLineCount(ctx, text, maxWidth) {
        if (!text.trim()) return 1;
        
        const words = text.split(' ');
        let currentLine = '';
        let lineCount = 0;
        
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);
            
            if (metrics.width > maxWidth && currentLine) {
                lineCount++;
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        
        if (currentLine) lineCount++;
        return Math.max(1, lineCount);
    }
    
    validate() {
        // Add bounds check
        if (this.size[0] < this.minSize[0]) this.size[0] = this.minSize[0];
        if (this.size[1] < this.minSize[1]) this.size[1] = this.minSize[1];
        
        // Ensure all properties have valid values
        if (!this.properties.textAlign) {
            this.properties.textAlign = 'left';
        }
        if (!this.properties.fontFamily) {
            this.properties.fontFamily = 'Arial';
        }
        if (typeof this.properties.fontSize !== 'number') {
            this.properties.fontSize = 16;
        }
        if (typeof this.properties.leadingFactor !== 'number') {
            this.properties.leadingFactor = 1.0;
        }
        if (typeof this.properties.bgAlpha !== 'number') {
            this.properties.bgAlpha = 0.0;
        }
        if (typeof this.properties.padding !== 'number') {
            this.properties.padding = 10;
        }
        if (!this.properties.bgColor) {
            this.properties.bgColor = '#fff';
        }
        if (!this.properties.textColor) {
            this.properties.textColor = '#fff';
        }
        if (this.properties.text === undefined || this.properties.text === null) {
            this.properties.text = '';
        }
    }
    
    onDrawForeground(ctx) {
        this.validate();
        
        const { bgColor, bgAlpha, text, fontSize, leadingFactor, textColor, fontFamily, textAlign, padding } = this.properties;
        
        ctx.save();
        
        // Clip to node bounds
        ctx.beginPath();
        ctx.rect(0, 0, this.size[0], this.size[1]);
        ctx.clip();
        
        // Draw background
        if (bgAlpha > 0) {
            const color = this.parseColor(bgColor);
            if (color) {
                ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${bgAlpha})`;
                ctx.fillRect(0, 0, this.size[0], this.size[1]);
            }
        }
        
        // Skip text if being edited externally
        if (this.isEditing) {
            ctx.restore();
            return;
        }
        
        // Draw text
        if (text) {
            ctx.fillStyle = textColor;
            ctx.textAlign = textAlign;
            ctx.textBaseline = 'top';
            ctx.font = `${fontSize}px ${fontFamily}`;
            
            this.drawText(ctx, text, padding, fontSize, leadingFactor, textAlign);
        }
        
        // Draw border if focused/selected
        if (this.graph?.canvas?.selection?.isSelected(this)) {
            this.drawTextBorder(ctx);
        }
        
        ctx.restore();
    }
    
    drawText(ctx, text, padding, fontSize, leadingFactor, textAlign) {
        const lineHeight = fontSize * leadingFactor;
        const maxWidth = this.size[0] - padding * 2;
        const lines = text.split('\n');
        let yOffset = padding;
        
        for (const line of lines) {
            if (line.trim() === '') {
                yOffset += lineHeight;
                continue;
            }
            
            this.drawWrappedLine(ctx, line, padding, yOffset, maxWidth, lineHeight, textAlign);
            const lineCount = this.getLineCount(ctx, line, maxWidth);
            yOffset += lineCount * lineHeight;
        }
    }
    
    drawWrappedLine(ctx, line, padding, startY, maxWidth, lineHeight, textAlign) {
        const words = line.split(' ');
        let currentLine = '';
        let yOffset = startY;
        
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);
            
            if (metrics.width > maxWidth && currentLine) {
                // Draw current line
                this.drawAlignedText(ctx, currentLine, padding, yOffset, maxWidth, textAlign);
                yOffset += lineHeight;
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        
        // Draw remaining text
        if (currentLine) {
            this.drawAlignedText(ctx, currentLine, padding, yOffset, maxWidth, textAlign);
        }
    }
    
    drawAlignedText(ctx, text, padding, y, maxWidth, textAlign) {
        let x = padding;
        
        switch (textAlign) {
            case 'center':
                x = padding + maxWidth / 2;
                break;
            case 'right':
                x = padding + maxWidth;
                break;
            case 'left':
            default:
                x = padding;
                break;
        }
        
        ctx.fillText(text, x, y);
    }
    
    drawTextBorder(ctx) {
        ctx.save();
        ctx.strokeStyle = '#4af';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(1, 1, this.size[0] - 2, this.size[1] - 2);
        ctx.restore();
    }
    
    parseColor(colorString) {
        const match = colorString.match(/^#([0-9a-fA-F]{6})$/);
        if (match) {
            const hex = match[1];
            return {
                r: parseInt(hex.substr(0, 2), 16),
                g: parseInt(hex.substr(2, 2), 16),
                b: parseInt(hex.substr(4, 2), 16)
            };
        }
        return null;
    }
    
    // Text editing support
    startEditing() {
        this.isEditing = true;
        this.markDirty();
    }
    
    stopEditing() {
        this.isEditing = false;
        this.fitTextToBox();
        this.markDirty();
    }
    
    // Double-click to edit text
    onDblClick(e) {
        if (this.graph?.canvas?.startTextEditing) {
            this.graph.canvas.startTextEditing(this, e);
            return true; // Handled
        }
        return false;
    }

    // Auto-resize based on content
    autoResize() {
        if (!this.properties.text) return;
        
        const ctx = this.graph?.canvas?.ctx;
        if (!ctx) return;
        
        ctx.save();
        ctx.font = `${this.properties.fontSize}px ${this.properties.fontFamily}`;
        
        const padding = this.properties.padding * 2;
        const lines = this.properties.text.split('\n');
        let maxWidth = 0;
        let totalHeight = 0;
        
        const lineHeight = this.properties.fontSize * this.properties.leadingFactor;
        
        for (const line of lines) {
            const metrics = ctx.measureText(line || ' ');
            maxWidth = Math.max(maxWidth, metrics.width);
            totalHeight += lineHeight;
        }
        
        this.size[0] = Math.max(this.minSize[0], maxWidth + padding);
        this.size[1] = Math.max(this.minSize[1], totalHeight + padding);
        
        ctx.restore();
        this.markDirty();
    }
    
    // Text manipulation utilities
    getWordCount() {
        return this.properties.text.split(/\s+/).filter(word => word.length > 0).length;
    }
    
    getCharacterCount() {
        return this.properties.text.length;
    }
    
    getLineCount() {
        return this.properties.text.split('\n').length;
    }
    
    // Preset text styles
    applyStyle(styleName) {
        const styles = {
            title: {
                fontSize: 24,
                textColor: '#fff',
                fontFamily: 'Arial',
                textAlign: 'center',
                leadingFactor: 1.2
            },
            subtitle: {
                fontSize: 18,
                textColor: '#ccc',
                fontFamily: 'Arial',
                textAlign: 'center',
                leadingFactor: 1.1
            },
            body: {
                fontSize: 14,
                textColor: '#fff',
                fontFamily: 'Arial',
                textAlign: 'left',
                leadingFactor: 1.4
            },
            caption: {
                fontSize: 12,
                textColor: '#999',
                fontFamily: 'Arial',
                textAlign: 'left',
                leadingFactor: 1.3
            }
        };
        
        const style = styles[styleName];
        if (style) {
            Object.assign(this.properties, style);
            this.fitTextToBox();
            this.markDirty();
            
            // Broadcast style changes for collaboration
            if (this.graph?.canvas?.broadcastNodePropertyUpdate) {
                // Broadcast each changed property
                for (const [property, value] of Object.entries(style)) {
                    this.graph.canvas.broadcastNodePropertyUpdate(this.id, property, value);
                }
            }
        }
    }
    
    // Export text content
    getTextInfo() {
        return {
            text: this.properties.text,
            wordCount: this.getWordCount(),
            characterCount: this.getCharacterCount(),
            lineCount: this.getLineCount(),
            fontSize: this.properties.fontSize,
            fontFamily: this.properties.fontFamily,
            size: [...this.size]
        };
    }
}

// Make TextNode available globally for browser environments
if (typeof window !== 'undefined') {
    window.TextNode = TextNode;
}