// ===================================
// TEXT NODE CLASS
// ===================================

class TextNode extends BaseNode {
    constructor() {
        super('media/text');
        this.title = 'Text';
        
        // Ensure we get the app font, checking multiple possible sources
        let fontFamily = 'Univers, sans-serif'; // Direct default to Univers
        try {
            if (typeof FONT_CONFIG !== 'undefined' && FONT_CONFIG && FONT_CONFIG.APP_FONT_CANVAS) {
                fontFamily = FONT_CONFIG.APP_FONT_CANVAS;
                console.log('TextNode using FONT_CONFIG:', fontFamily);
            } else if (typeof window !== 'undefined' && window.FONT_CONFIG && window.FONT_CONFIG.APP_FONT_CANVAS) {
                fontFamily = window.FONT_CONFIG.APP_FONT_CANVAS;
                console.log('TextNode using window.FONT_CONFIG:', fontFamily);
            } else {
                console.log('TextNode using default Univers font (FONT_CONFIG not available)');
            }
        } catch (e) {
            console.log('TextNode font config error, using Univers default:', e);
        }
        
        this.properties = {
            text: '',
            bgColor: '#fff',
            bgAlpha: 0.0,
            fontSize: 16,
            leadingFactor: 1.0,
            textColor: '#fff',
            fontFamily: fontFamily,
            textAlign: 'left',
            padding: 10
        };
        this.flags = { hide_title: true };
        this.size = [200, 100];
        this.minSize = [50, 30];
        this.isEditing = false;
        
        // Cache for line breaks to prevent flicker
        this._lineBreakCache = null;
        this._cacheKey = null;
        this._lastWrapWidth = null; // For hysteresis in text wrapping
        this._lastCachedWidth = null; // Track the width we last cached at
    }
    
    setText(text) {
        this.properties.text = text;
        this.invalidateLineBreakCache();
        this.fitTextToBox();
        this.markDirty();
        
        // Broadcast text change for collaboration
        if (this.graph?.canvas?.broadcastNodePropertyUpdate) {
            this.graph.canvas.broadcastNodePropertyUpdate(this.id, 'text', text);
        }
    }
    
    invalidateLineBreakCache() {
        this._lineBreakCache = null;
        this._cacheKey = null;
        this._lastWrapWidth = null; // Reset hysteresis tracking
    }
    
    setFontSize(fontSize) {
        this.properties.fontSize = Utils.clamp(fontSize, 6, 200);
        this.invalidateLineBreakCache();
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
    
    onResize(resizeMode = 'default') {
        super.onResize();
        
        // Don't invalidate cache during resize drag - wait until resize completes
        // The canvas will call onResizeEnd when done
        
        // resizeMode will be passed from canvas when resizing
        // 'fontSize' = normal drag (scale both font size and box proportionally)
        // 'boxOnly' = shift-drag (non-uniform resize box only, keep font size)
        // 'default' = called from other contexts
        // 'noFit' = resize without auto-fitting text
        
        // During drag operations, the canvas passes specific modes
        // We should NOT auto-fit text during drag operations to avoid jumpy behavior
        if (resizeMode === 'fontSize') {
            // Font size is already scaled by canvas resize logic
            // Don't call fitTextToBox as we want to keep the scaled font size
        } else if (resizeMode === 'boxOnly') {
            // Box resized but font size stays the same
            // Text will wrap differently in the new box dimensions
        } else if (resizeMode === 'noFit') {
            // Explicit no-fit mode
        } else if (resizeMode === 'default') {
            // Only auto-fit text when explicitly requested (not during drag)
            // This should only happen for programmatic resizes, not user interaction
            // Commenting out to prevent jumpy resize behavior
            // this.fitTextToBox();
        }
    }
    
    onResizeEnd() {
        // Called when resize operation completes
        // Don't invalidate cache here - keep the existing wrapping
        // The cache will naturally update when the text changes or when needed
        this.markDirty();
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
        
        // Use same tolerance as drawWrappedLine to ensure consistency
        const tolerance = 0.5;
        const effectiveMaxWidth = maxWidth - tolerance;
        
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);
            
            if (metrics.width > effectiveMaxWidth && currentLine) {
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
        // NEVER modify size during any canvas interaction
        // This was causing the jumpy resize behavior
        const canvas = this.graph?.canvas;
        const isResizing = canvas?.interactionState?.resizing?.active;
        const isDragging = canvas?.interactionState?.dragging?.active;
        const isSelecting = canvas?.interactionState?.selecting?.active;
        const isRotating = canvas?.interactionState?.rotating?.active;
        const isAnyInteraction = isResizing || isDragging || isSelecting || isRotating || this.isEditing;
        
        if (!isAnyInteraction) {
            // Only enforce bounds when absolutely no interaction is happening
            if (this.size[0] < this.minSize[0]) this.size[0] = this.minSize[0];
            if (this.size[1] < this.minSize[1]) this.size[1] = this.minSize[1];
        }
        
        // Ensure all properties have valid values
        if (!this.properties.textAlign) {
            this.properties.textAlign = 'left';
        }
        
        // Ensure app font is used - but only update if needed to avoid unnecessary changes
        let targetFont = 'Univers, sans-serif';
        if (typeof FONT_CONFIG !== 'undefined' && FONT_CONFIG && FONT_CONFIG.APP_FONT_CANVAS) {
            targetFont = FONT_CONFIG.APP_FONT_CANVAS;
        } else if (typeof window !== 'undefined' && window.FONT_CONFIG && window.FONT_CONFIG.APP_FONT_CANVAS) {
            targetFont = window.FONT_CONFIG.APP_FONT_CANVAS;
        }
        
        // Only update if the font is different or missing
        if (!this.properties.fontFamily || this.properties.fontFamily === 'Roboto' || this.properties.fontFamily === 'Roboto, sans-serif') {
            this.properties.fontFamily = targetFont;
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
        // Text nodes don't draw on the main canvas - they render on the overlay layer
        // This ensures text always appears on top of images and other content
        
        // The selection box is drawn by the canvas in drawNodeSelection
        // We don't need to draw anything here
    }
    
    // New method for overlay rendering - text nodes render here to appear on top
    onDrawOverlay(ctx) {
        // Skip validation entirely during interactions - it was causing jumpy behavior
        const canvas = this.graph?.canvas;
        const hasInteraction = canvas?.interactionState && (
            canvas.interactionState.resizing?.active ||
            canvas.interactionState.dragging?.active ||
            canvas.interactionState.selecting?.active ||
            canvas.interactionState.rotating?.active
        );
        
        if (!hasInteraction && !this.isEditing) {
            this.validate();
        }
        
        const { bgColor, bgAlpha, text, fontSize, leadingFactor, textColor, fontFamily, textAlign, padding } = this.properties;
        
        ctx.save();
        
        // Position is handled by the canvas overlay system, so we just clip to bounds
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
        
        // Border is already drawn in onDrawForeground, no need to duplicate here
        
        ctx.restore();
    }
    
    drawText(ctx, text, padding, fontSize, leadingFactor, textAlign) {
        const lineHeight = fontSize * leadingFactor;
        const maxWidth = this.size[0] - padding * 2;
        
        // Get wrapped lines - this will use cache during resize automatically
        const wrappedLines = this.getWrappedLines(ctx, text, maxWidth, fontSize);
        
        let yOffset = padding;
        for (const line of wrappedLines) {
            if (line.trim() === '') {
                yOffset += lineHeight;
                continue;
            }
            
            this.drawAlignedText(ctx, line, padding, yOffset, maxWidth, textAlign);
            yOffset += lineHeight;
        }
    }
    
    getWrappedLines(ctx, text, maxWidth, fontSize) {
        // Create cache key from relevant parameters
        // Use stepped width in cache key for better cache reuse during resize
        const STEP_SIZE = 30;  // Larger steps = more stable
        const steppedWidth = Math.floor(maxWidth / STEP_SIZE) * STEP_SIZE;
        const cacheKey = `${text}|${steppedWidth}|${fontSize}|${this.properties.fontFamily}`;
        
        // Return cached result if available
        // During editing, always use cache to maintain consistent wrapping
        if ((this._cacheKey === cacheKey || this.isEditing) && this._lineBreakCache) {
            return this._lineBreakCache;
        }
        
        // Calculate new line breaks
        const allLines = [];
        const inputLines = text.split('\n');
        
        // Save and restore context state to ensure consistent measurements
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset to identity transform
        ctx.font = `${fontSize}px ${this.properties.fontFamily}`;
        
        for (const line of inputLines) {
            if (line.trim() === '') {
                allLines.push('');
                continue;
            }
            
            // Wrap this line
            const wrappedLines = this.wrapLine(ctx, line, maxWidth);
            allLines.push(...wrappedLines);
        }
        
        ctx.restore();
        
        // Cache the result
        this._cacheKey = cacheKey;
        this._lineBreakCache = allLines;
        this._lastCachedWidth = maxWidth; // Remember what width we cached at
        
        return allLines;
    }
    
    wrapLine(ctx, line, maxWidth) {
        const words = line.split(' ');
        const lines = [];
        let currentLine = '';
        
        // Round width to nearest 30 pixels to create larger "steps" that prevent constant re-wrapping
        // This creates wider zones where text layout remains stable
        const STEP_SIZE = 30;
        const steppedWidth = Math.floor(maxWidth / STEP_SIZE) * STEP_SIZE;
        
        // Use the stepped width for calculations, with a small buffer
        const effectiveMaxWidth = steppedWidth - 2;
        
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);
            const width = Math.ceil(metrics.width); // Round up to avoid edge cases
            
            if (width > effectiveMaxWidth && currentLine) {
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
        // Don't call fitTextToBox here - it changes the font size unexpectedly
        // Just mark dirty to redraw with the current settings
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
                fontFamily: (typeof FONT_CONFIG !== 'undefined' && FONT_CONFIG && FONT_CONFIG.APP_FONT_CANVAS) ? FONT_CONFIG.APP_FONT_CANVAS : 'Univers, sans-serif',
                textAlign: 'center',
                leadingFactor: 1.2
            },
            subtitle: {
                fontSize: 18,
                textColor: '#ccc',
                fontFamily: (typeof FONT_CONFIG !== 'undefined' && FONT_CONFIG && FONT_CONFIG.APP_FONT_CANVAS) ? FONT_CONFIG.APP_FONT_CANVAS : 'Univers, sans-serif',
                textAlign: 'center',
                leadingFactor: 1.1
            },
            body: {
                fontSize: 14,
                textColor: '#fff',
                fontFamily: (typeof FONT_CONFIG !== 'undefined' && FONT_CONFIG && FONT_CONFIG.APP_FONT_CANVAS) ? FONT_CONFIG.APP_FONT_CANVAS : 'Univers, sans-serif',
                textAlign: 'left',
                leadingFactor: 1.4
            },
            caption: {
                fontSize: 12,
                textColor: '#999',
                fontFamily: (typeof FONT_CONFIG !== 'undefined' && FONT_CONFIG && FONT_CONFIG.APP_FONT_CANVAS) ? FONT_CONFIG.APP_FONT_CANVAS : 'Univers, sans-serif',
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