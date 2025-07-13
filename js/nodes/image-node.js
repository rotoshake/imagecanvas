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
        // Animation state for springy auto-align
        // Only set if not already set (e.g. after loading from state)
        if (!this._animPos) this._animPos = [...this.pos];
        if (!this._animVel) this._animVel = [0, 0];
    }

    setImage(src, filename = null) {
        this.properties.src = src;
        this.properties.filename = filename;
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
            // Generate thumbnail
            const maxThumb = 256;
            let tw = this.img.width, th = this.img.height;
            if (tw > th && tw > maxThumb) {
                th = Math.round(th * (maxThumb / tw));
                tw = maxThumb;
            } else if (th > tw && th > maxThumb) {
                tw = Math.round(tw * (maxThumb / th));
                th = maxThumb;
            } else if (tw > maxThumb) {
                tw = th = maxThumb;
            }
            this.thumbnail = document.createElement('canvas');
            this.thumbnail.width = tw;
            this.thumbnail.height = th;
            this.thumbnail.getContext('2d').drawImage(this.img, 0, 0, tw, th);
            if (this.graph && this.graph.canvas) {
                this.graph.canvas.dirty_canvas = true;
                this.graph.canvas.draw();
            }
        };
        this.img.src = src;
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
        if (!this.img) return;
        const w = this.size[0] - 10;
        const h = this.size[1] - 10;
        // Use thumbnail if drawing much smaller than original
        if (this.thumbnail && (w < this.img.width / 2 || h < this.img.height / 2)) {
            ctx.drawImage(this.thumbnail, 0, 0, this.thumbnail.width, this.thumbnail.height, 5, 5, w * this.properties.scale, h * this.properties.scale);
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