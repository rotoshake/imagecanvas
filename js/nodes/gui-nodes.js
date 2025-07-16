// Text Node class definition
class TextNode {
    constructor() {
        this.type = "media/text";
        this.properties = {
            text: "",
            isMarkdown: false,
            bgColor: "#fff", // New: background color
            bgAlpha: 0.0,       // New: background alpha (fully transparent by default)
            fontSize: 100 // New: base font size in graph units
        };
        this.flags = { hide_title: true };
        this.size = [200, 100];
        this.pos = [0, 0];
        this.resizable = true;
        this.aspectRatio = null; // No fixed aspect for text
        this._prev_size = [200, 100];
        this.outputs = [{ name: "text", type: "" }];
        // Defensive: ensure size is valid
        if (!this.size || this.size.length !== 2 || !this.size.every(Number.isFinite)) {
            this.size = [200, 100];
        }
        console.debug('[TextNode] Created', {
            text: this.properties.text.substring(0, 50) + '...'
        });
    }

    setText(text, isMarkdown = false) {
        this.properties.text = text;
        this.properties.isMarkdown = isMarkdown;
        // Auto-compute height based on wrapped text
        const ctx = this.graph?.canvas?.ctx;
        const scale = this.graph?.canvas?.scale || 1;
        const padding = 10; // Graph units padding
        let totalHeight = padding * 2; // Top and bottom padding
        if (ctx) {
            ctx.save();
            const lines = this.properties.text.split('\n');
            const fontSize = this.properties.fontSize;
            lines.forEach((line) => {
                let currentFontSize = fontSize * scale; // CSS px
                let lineHeight = currentFontSize * 1.4; // CSS px
                let isHeader = false;
                if (this.properties.isMarkdown && line.startsWith('# ')) {
                    isHeader = true;
                    currentFontSize *= 1.3;
                    lineHeight = currentFontSize * 1.2;
                    ctx.font = `bold ${currentFontSize}px Arial`;
                    line = line.substring(2);
                } else {
                    ctx.font = `${currentFontSize}px Arial`;
                }
                // Simulate word wrap to count lines and add height
                const words = line.split(' ');
                let currentLine = '';
                const maxWidthCss = (this.size[0] - padding * 2) * scale;
                for (const word of words) {
                    const testLine = currentLine ? `${currentLine} ${word}` : word;
                    const metrics = ctx.measureText(testLine);
                    if (metrics.width > maxWidthCss && currentLine) {
                        totalHeight += lineHeight / scale; // Convert to graph units
                        currentLine = word;
                    } else {
                        currentLine = testLine;
                    }
                }
                totalHeight += lineHeight / scale; // Add last line
            });
            ctx.restore();
        } else {
            // Fallback approximation if no ctx
            const lines = this.properties.text.split('\n').length;
            const lineHeight = this.properties.fontSize * 1.4;
            totalHeight = lines * lineHeight + padding * 2;
        }
        this.size[1] = Math.max(100, totalHeight);
        this._prev_size = this.size.slice();
        if (this.graph && this.graph.canvas) {
            this.graph.canvas.dirty_canvas = true;
            this.graph.canvas.draw();
        }
    }

    onResize() {
        // Scale font size based on size change (geometric mean for balanced scaling)
        const scaleX = this.size[0] / (this._prev_size[0] || 200);
        const scaleY = this.size[1] / (this._prev_size[1] || 100);
        this.properties.fontSize *= Math.sqrt(scaleX * scaleY);
        this.properties.fontSize = Math.max(8, Math.min(4096, this.properties.fontSize)); // Clamp (higher max)
        this._prev_size = this.size.slice();
    }

    onDrawForeground(ctx) {
        // Defensive: ensure size is valid
        if (!this.size || this.size.length !== 2 || !this.size.every(Number.isFinite)) {
            this.size = [200, 100];
        }
        const w = this.size[0];
        const h = this.size[1];
        ctx.save();
        const { bgColor, bgAlpha } = this.properties;
        // Only fill if alpha > 0
        if (bgAlpha > 0) {
            // Robust hex to rgb
            let r = 255, g = 255, b = 255;
            if (/^#([0-9a-fA-F]{6})$/.test(bgColor)) {
                r = parseInt(bgColor.slice(1,3),16);
                g = parseInt(bgColor.slice(3,5),16);
                b = parseInt(bgColor.slice(5,7),16);
            }
            ctx.fillStyle = `rgba(${r},${g},${b},${bgAlpha})`;
            ctx.fillRect(0, 0, w, h);
        }
        // Skip text drawing if this node is being edited (let the overlay div handle it for WYSIWYG)
        if (this.graph && this.graph.canvas && this.graph.canvas._editingTextNode === this) {
            ctx.restore();
            return;
        }
        // Draw text with word wrapping (match editing overlay)
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        let y = 10;  // Graph units padding
        const lines = this.properties.text.split('\n');
        const fontSize = this.properties.fontSize;
        const drawFontSize = fontSize; // Graph units (transform handles scaling)
        const padding = 10;
        const maxWidth = this.size[0] - padding * 2;
        lines.forEach((line) => {
            let currentFontSize = drawFontSize;
            let isHeader = false;
            let lineHeight = currentFontSize * 1.4;
            if (this.properties.isMarkdown && line.startsWith('# ')) {
                isHeader = true;
                currentFontSize *= 1.3;
                lineHeight = currentFontSize * 1.2;
                ctx.font = `bold ${currentFontSize}px Arial`;
                line = line.substring(2);
            } else {
                ctx.font = `${currentFontSize}px Arial`;
            }
            // Word wrap the line
            const words = line.split(' ');
            let currentLine = '';
            for (const word of words) {
                const testLine = currentLine ? `${currentLine} ${word}` : word;
                const metrics = ctx.measureText(testLine);
                if (metrics.width > maxWidth && currentLine) {
                    ctx.font = isHeader ? `bold ${currentFontSize}px Arial` : `${currentFontSize}px Arial`;
                    ctx.fillText(currentLine, padding, y);
                    y += lineHeight;
                    currentLine = word;
                } else {
                    currentLine = testLine;
                }
            }
            // Draw remaining line
            if (currentLine) {
                ctx.font = isHeader ? `bold ${currentFontSize}px Arial` : `${currentFontSize}px Arial`;
                ctx.fillText(currentLine, padding, y);
                y += lineHeight;
            }
        });
        ctx.restore();
    }

    onExecute() {
        if (this.outputs && this.outputs[0]) {
            this.setOutputData(0, this.properties.text);
        }
    }
    
    setOutputData(index, data) {
        // Placeholder for output data
    }
}