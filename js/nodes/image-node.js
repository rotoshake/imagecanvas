// Image Node class definition
class ImageNode {
    constructor() {
        this.type = "media/image";
        this.title = "Image";
        this.properties = { src: null, scale: 1.0, filename: null };
        this.size = [200, 200];
        this.pos = [0, 0];
        this.resizable = true;
        this.aspectRatio = 1;
        this._prev_size = [200, 200];
        this.outputs = [{ name: "image", type: "" }];
        this.img = null;
        this.thumbnails = {}; // Multiple thumbnail sizes
        this._thumbnailSizes = [64, 128, 256, 512]; // Different thumbnail sizes
        // Animation state for springy auto-align
        // Only set if not already set (e.g. after loading from state)
        if (!this._animPos) this._animPos = [...this.pos];
        if (!this._animVel) this._animVel = [0, 0];
        // Defensive: ensure size and scale are valid
        if (!this.size || this.size.length !== 2 || !this.size.every(Number.isFinite)) {
            this.size = [200, 200];
        }
        if (!Number.isFinite(this.properties.scale)) {
            this.properties.scale = 1.0;
        }
        // Debug: log creation and hash if present
        console.debug('[ImageNode] Created', {
            filename: this.properties.filename,
            src: this.properties.src,
            hash: this.properties.hash
        });
    }

    setImage(src, filename = null, hash = null) {
        console.debug('[ImageNode] setImage called', { src, filename, hash });
        this.properties.src = src;
        this.properties.filename = filename;
        if (hash) this.properties.hash = hash;
        this.img = new Image();
        this.img.onload = () => {
            this.aspectRatio = this.img.width / this.img.height;
            this.size[0] = this.size[1] * this.aspectRatio;
            this._prev_size = this.size.slice();
            this.onResize();
            // Update title with full filename (no truncation) only if default
            if (filename && (!this.title || this.title === 'Image')) {
                this.title = filename;
            }
            // Generate multiple thumbnail sizes
            this.generateThumbnails();
            // Debug: log image loaded
            console.debug('[ImageNode] Image loaded', {
                filename: this.properties.filename,
                hash: this.properties.hash,
                width: this.img.width,
                height: this.img.height
            });
            if (this.graph && this.graph.canvas) {
                this.graph.canvas.dirty_canvas = true;
                this.graph.canvas.draw();
                // Debug: log redraw triggered
                console.debug('[ImageNode] Canvas redraw triggered after image load');
            }
        };
        this.img.src = src;
    }

    generateThumbnails() {
        if (!this.img) return;
        
        this.thumbnails = {};
        
        for (const thumbSize of this._thumbnailSizes) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Calculate thumbnail dimensions maintaining aspect ratio
            let tw = this.img.width, th = this.img.height;
            if (tw > th && tw > thumbSize) {
                th = Math.round(th * (thumbSize / tw));
                tw = thumbSize;
            } else if (th > tw && th > thumbSize) {
                tw = Math.round(tw * (thumbSize / th));
                th = thumbSize;
            } else if (tw > thumbSize) {
                tw = th = thumbSize;
            }
            
            canvas.width = tw;
            canvas.height = th;
            
            // Draw with high quality
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(this.img, 0, 0, tw, th);
            
            this.thumbnails[thumbSize] = canvas;
        }
    }

    getBestThumbnail(targetWidth, targetHeight) {
        if (!this.img) return null;
        
        // Find the smallest thumbnail that's still larger than target
        for (const size of this._thumbnailSizes) {
            if (size >= targetWidth && size >= targetHeight) {
                return this.thumbnails[size];
            }
        }
        
        // If no thumbnail is large enough, use the largest one
        return this.thumbnails[Math.max(...this._thumbnailSizes)];
    }

    onResize() {
        const dw = Math.abs(this.size[0] - this._prev_size[0]);
        const dh = Math.abs(this.size[1] - this._prev_size[1]);
        if (dw > dh) {
            this.size[1] = this.size[0] / this.aspectRatio;
        } else {
            this.size[0] = this.size[1] * this.aspectRatio;
        }
        this._prev_size = this.size.slice();
    }

    onDrawForeground(ctx) {
        // Defensive: ensure size and scale are valid before drawing
        if (!this.size || this.size.length !== 2 || !this.size.every(Number.isFinite)) {
            this.size = [200, 200];
        }
        if (!Number.isFinite(this.properties.scale)) {
            this.properties.scale = 1.0;
        }
        if (!this.img) {
            // Draw gray box with loading text
            ctx.save();
            ctx.fillStyle = '#cccccc';
            ctx.fillRect(5, 5, this.size[0] - 10, this.size[1] - 10);
            ctx.fillStyle = '#666666';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Loading…', 5 + (this.size[0] - 10) / 2, 5 + (this.size[1] - 10) / 2);
            ctx.restore();
            return;
        }
        const w = this.size[0] - 10;
        const h = this.size[1] - 10;
        // Determine if we should use thumbnail based on size and zoom
        const shouldUseThumbnail = w < this.img.width / 3 || h < this.img.height / 3;
        if (shouldUseThumbnail && Object.keys(this.thumbnails).length > 0) {
            // Use appropriate thumbnail size
            const targetWidth = Math.round(w * this.properties.scale);
            const targetHeight = Math.round(h * this.properties.scale);
            const thumbnail = this.getBestThumbnail(targetWidth, targetHeight);
            if (thumbnail) {
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(thumbnail, 5, 5, w * this.properties.scale, h * this.properties.scale);
            } else {
                ctx.drawImage(this.img, 5, 5, w * this.properties.scale, h * this.properties.scale);
            }
        } else {
            ctx.drawImage(this.img, 5, 5, w * this.properties.scale, h * this.properties.scale);
        }
    }

    onExecute() {
        if (this.outputs && this.outputs[0]) {
            this.setOutputData(0, this.properties.src);
        }
    }
    
    setOutputData(index, data) {
        // Placeholder for output data
    }
}

// Register the node type (will be called from app.js)