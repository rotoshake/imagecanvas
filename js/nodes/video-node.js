// Video Node class definition
class VideoNode {
    constructor() {
        this.type = "media/video";
        this.title = "Video";
        this.properties = { src: null, filename: null, loop: true };
        this.flags = { hide_title: true };
        this.size = [200, 200];
        this.pos = [0, 0];
        this.resizable = true;
        this.aspectRatio = 1;
        this._prev_size = [200, 200];
        this.outputs = [{ name: "video", type: "" }];
        this.video = null;
        this.thumbnails = {}; // Multiple thumbnail sizes (first frame)
        this._thumbnailSizes = [64, 128, 256, 512];
        this.userPaused = false;
        this.rotation = 0; // Add rotation property
        // Defensive: ensure size and scale are valid
        if (!this.size || this.size.length !== 2 || !this.size.every(Number.isFinite)) {
            this.size = [200, 200];
        }
        if (!Number.isFinite(this.properties.scale)) {
            this.properties.scale = 1.0;
        }
        console.debug('[VideoNode] Created', {
            filename: this.properties.filename,
            src: this.properties.src,
            hash: this.properties.hash
        });
    }

    setVideo(src, filename = null, hash = null) {
        this.properties.src = src;
        this.properties.filename = filename;
        if (hash) this.properties.hash = hash;
        this.video = document.createElement('video');
        this.video.muted = true; // Mute by default to avoid audio issues
        this.video.loop = this.properties.loop;
        this.video.autoplay = true; // Start playback automatically
        this._thumbnailsGenerated = false;
        this.video.onloadedmetadata = () => {
            if (!this.video) return;
            const shouldResetAspect = !this.aspectRatio || this.aspectRatio === 1;
            if (shouldResetAspect) {
                this.aspectRatio = this.video.videoWidth / this.video.videoHeight;
                this.originalAspect = this.aspectRatio;
                this.size[0] = this.size[1] * this.aspectRatio;
            } else {
                this.originalAspect = this.video.videoWidth / this.video.videoHeight;
            }
            this._prev_size = this.size.slice();
            this.onResize();
            if (filename && (!this.title || this.title === 'Video')) {
                this.title = filename;
            }
            // Seek to first frame and generate thumbnails after seek
            const tryGenerate = () => {
                if (this._thumbnailsGenerated) return;
                this._thumbnailsGenerated = true;
                this.generateThumbnails();
                if (this.graph && this.graph.canvas) {
                    this.graph.canvas.dirty_canvas = true;
                    this.graph.canvas.draw();
                }
            };
            // If already at 0, just try to generate
            if (Math.abs(this.video.currentTime) > 0.01) {
                this.video.currentTime = 0;
            }
            // Use onseeked if available, fallback to oncanplay
            this.video.onseeked = tryGenerate;
            this.video.oncanplay = tryGenerate;
            // If video is already ready, try immediately
            if (this.video.readyState >= 2) {
                tryGenerate();
            }
            console.debug('[VideoNode] Video loaded', {
                filename: this.properties.filename,
                hash: this.properties.hash,
                width: this.video.videoWidth,
                height: this.video.videoHeight,
                aspectRatio: this.aspectRatio,
                shouldResetAspect: shouldResetAspect
            });
            if (this.graph && this.graph.canvas) {
                this.graph.canvas.dirty_canvas = true;
                this.graph.canvas.draw();
            }
            // Start playback
            this.video.play().catch(e => console.warn('Video playback failed:', e));
        };
        this.video.src = src;
    }

    generateThumbnails() {
        if (!this.video || !this.video.videoWidth || !this.video.videoHeight) return;
        this.thumbnails = {};
        for (const thumbSize of this._thumbnailSizes) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            let tw = this.video.videoWidth, th = this.video.videoHeight;
            if (!tw || !th) { tw = th = 1; }
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
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            try {
                ctx.drawImage(this.video, 0, 0, tw, th);
            } catch (e) {}
            this.thumbnails[thumbSize] = canvas;
        }
    }

    getBestThumbnail(targetWidth, targetHeight) {
        if (!this.video.videoWidth || !this.video.videoHeight) return null;
        for (const size of this._thumbnailSizes) {
            if (size >= targetWidth && size >= targetHeight) {
                return this.thumbnails[size];
            }
        }
        return this.thumbnails[Math.max(...this._thumbnailSizes)];
    }

    onResize() {
        const dw = Math.abs(this.size[0] - this._prev_size[0]);
        const dh = Math.abs(this.size[1] - this._prev_size[1]);
        const isOriginalAspect = this.aspectRatio === this.originalAspect;
        if (isOriginalAspect) {
            if (dw > dh) {
                this.size[1] = this.size[0] / this.aspectRatio;
            } else {
                this.size[0] = this.size[1] * this.aspectRatio;
            }
        } else {
            this.aspectRatio = this.size[0] / this.size[1];
        }
        this._prev_size = this.size.slice();
    }

    onDrawForeground(ctx) {
        if (!this.size || this.size.length !== 2 || !this.size.every(Number.isFinite)) {
            this.size = [200, 200];
        }
        if (!Number.isFinite(this.properties.scale)) {
            this.properties.scale = 1.0;
        }
        if (!this.video && this.properties && this.properties.src) {
            this.setVideo(this.properties.src, this.properties.filename, this.properties.hash);
        }
        if (!this.video || !this.video.videoWidth || !this.video.videoHeight) {
            ctx.save();
            ctx.fillStyle = '#cccccc';
            ctx.fillRect(0, 0, this.size[0], this.size[1]);
            ctx.fillStyle = '#666666';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Loading…', this.size[0] / 2, this.size[1] / 2);
            ctx.restore();
            return;
        }
        let scale = 1, dpr = 1;
        if (this.graph && this.graph.canvas) {
            scale = this.graph.canvas.scale || 1;
            dpr = this.graph.canvas.dpr || window.devicePixelRatio || 1;
        }
        const screenW = this.size[0] * scale * dpr;
        const screenH = this.size[1] * scale * dpr;
        const w = this.size[0];
        const h = this.size[1];
        if (screenW < 32 || screenH < 32) {
            ctx.save();
            ctx.fillStyle = '#888';
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
            return;
        } else if (screenW < 64 || screenH < 64) {
            const targetWidth = Math.round(w * this.properties.scale);
            const targetHeight = Math.round(h * this.properties.scale);
            const thumbnail = this.getBestThumbnail(targetWidth, targetHeight);
            if (thumbnail instanceof HTMLCanvasElement) {
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(thumbnail, 0, 0, w * this.properties.scale, h * this.properties.scale);
            } else {
                ctx.save();
                ctx.fillStyle = '#888';
                ctx.fillRect(0, 0, w, h);
                ctx.restore();
            }
            return;
        } else {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(this.video, 0, 0, w * this.properties.scale, h * this.properties.scale);
            if (!this.userPaused && this.video.paused) {
                this.video.play().catch(()=>{});
            }
        }
        // Remove in-node title drawing here (was previously drawing title inside the node)
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