// Text Node class definition
class TextNode {
    constructor() {
        this.type = "media/text";
        this.properties = {
            text: "",
            isMarkdown: false,
            bgColor: "#fff", // New: background color
            bgAlpha: 0.0       // New: background alpha (fully transparent by default)
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
        // Optionally auto-resize based on text content (simple estimate)
        const lines = text.split('\n').length;
        this.size[1] = Math.max(100, lines * 20 + 20); // Rough height estimate
        this.onResize();
        if (this.graph && this.graph.canvas) {
            this.graph.canvas.dirty_canvas = true;
            this.graph.canvas.draw();
        }
    }

    onResize() {
        // No aspect ratio enforcement for text nodes
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
        // Draw text (plaintext or markdown)
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        let y = 10;
        const lines = this.properties.text.split('\n');
        if (this.properties.isMarkdown) {
            lines.forEach((line) => {
                if (line.startsWith('# ')) {
                    ctx.font = 'bold 18px Arial';
                    ctx.fillText(line.substring(2), 10, y);
                    y += 22;
                    ctx.font = '14px Arial';
                } else {
                    ctx.font = '14px Arial';
                    ctx.fillText(line, 10, y);
                    y += 18;
                }
            });
        } else {
            ctx.font = '14px Arial';
            lines.forEach((line) => {
                ctx.fillText(line, 10, y);
                y += 18;
            });
        }
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