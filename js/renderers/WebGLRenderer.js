/**
 * WebGLRenderer – future-proof high-performance rendering layer.
 * Currently returns false on draw hooks so default Canvas2D path still runs.
 */
class WebGLRenderer {
    /**
     * @param {ImageCanvas} canvasInstance Owning canvas instance.
     */
    constructor(canvasInstance) {
        this.canvas = canvasInstance;

        // Create an overlay canvas so we don't conflict with 2D context
        this.glCanvas = document.createElement('canvas');
        this.glCanvas.style.position = 'absolute';
        this.glCanvas.style.top = '0';
        this.glCanvas.style.left = '0';
        this.glCanvas.style.pointerEvents = 'none'; // let mouse go through
        this.glCanvas.style.zIndex = '1'; // between grid and UI

        const parent = this.canvas.canvas.parentNode;
        if (parent) {
            parent.insertBefore(this.glCanvas, this.canvas.canvas.nextSibling); // after main canvas
            // Ensure main canvas is below
            this.canvas.canvas.style.position = 'relative';
            this.canvas.canvas.style.zIndex = '0';
        } else {
            document.body.appendChild(this.glCanvas);
        }

        this.gl = this.glCanvas.getContext('webgl2', { premultipliedAlpha: false }) ||
                  this.glCanvas.getContext('webgl', { premultipliedAlpha: false });

        if (!this.gl) {
            
            return;
        }

        // Resources
        this.program = this._initShaders();
        // Get uniform locations for color adjustments
        if (this.gl && this.program) {
            this.uBrightness = this.gl.getUniformLocation(this.program, 'u_brightness');
            this.uContrast = this.gl.getUniformLocation(this.program, 'u_contrast');
            this.uSaturation = this.gl.getUniformLocation(this.program, 'u_saturation');
            this.uHue = this.gl.getUniformLocation(this.program, 'u_hue');
        }
        this.positionLoc = this.gl.getAttribLocation(this.program, 'a_position');
        this.texLoc = this.gl.getAttribLocation(this.program, 'a_texCoord');
        this.resolutionLoc = this.gl.getUniformLocation(this.program, 'u_resolution');

        // Create a single VBO reused for all quads (4 vertices)
        this.vertexBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);

        // Element array for two triangles
        this.indexBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2, 2,1,3]), this.gl.STATIC_DRAW);

        // Texture coord buffer (static 0-1)
        this.texBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
            0,0, 1,0, 0,1, 1,1
        ]), this.gl.STATIC_DRAW);

        // Cache of textures per image element
        this.textureCache = new WeakMap();
    }

    _initShaders() {
        const vsSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            uniform vec2 u_resolution;
            void main() {
                // convert from pixels to 0.0-1.0
                vec2 zeroToOne = a_position / u_resolution;
                // convert to 0-2
                vec2 zeroToTwo = zeroToOne * 2.0;
                // convert to ‑1..1 clip space (flip Y)
                vec2 clip = zeroToTwo - 1.0;
                gl_Position = vec4(clip * vec2(1, -1), 0, 1);
                v_texCoord = a_texCoord;
            }`;

        const fsSource = `
            precision mediump float;
            varying vec2 v_texCoord;
            uniform sampler2D u_image;
            uniform float u_brightness;
            uniform float u_contrast;
            uniform float u_saturation;
            uniform float u_hue; // degrees

            vec3 rgb2hsv(vec3 c) {
                vec4 K = vec4(0., -1./3., 2./3., -1.);
                vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
                vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
                float d = q.x - min(q.w, q.y);
                float e = 1e-10;
                return vec3(abs(q.z + (q.w - q.y)/(6.*d+e)), d/(q.x+e), q.x);
            }

            vec3 hsv2rgb(vec3 c) {
                vec3 p = abs(fract(c.xxx + vec3(0., 2./3., 1./3.))*6.-3.);
                return c.z * mix(vec3(1.), clamp(p-1.,0.,1.), c.y);
            }

            void main() {
                vec4 color = texture2D(u_image, v_texCoord);
                // brightness
                color.rgb += u_brightness;
                // contrast  (simple linear)
                color.rgb = (color.rgb - 0.5)*(1.0+u_contrast)+0.5;
                // saturation & hue via HSV
                vec3 hsv = rgb2hsv(color.rgb);
                hsv.y *= (1.0 + u_saturation);
                hsv.x += u_hue/360.0;
                color.rgb = hsv2rgb(hsv);
                gl_FragColor = color;
            }`;

        const compile = (src, type) => {
            const shader = this.gl.createShader(type);
            this.gl.shaderSource(shader, src);
            this.gl.compileShader(shader);
            if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
                console.error('Shader compile error:', this.gl.getShaderInfoLog(shader));
            }
            return shader;
        };

        const vs = compile(vsSource, this.gl.VERTEX_SHADER);
        const fs = compile(fsSource, this.gl.FRAGMENT_SHADER);
        const program = this.gl.createProgram();
        this.gl.attachShader(program, vs);
        this.gl.attachShader(program, fs);
        this.gl.linkProgram(program);
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('Program link error:', this.gl.getProgramInfoLog(program));
        }
        return program;
    }

    _ensureTexture(image) {
        let tex = this.textureCache.get(image);
        if (tex) return tex;
        tex = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image);

        this.textureCache.set(image, tex);
        return tex;
    }

    _resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.canvas.getBoundingClientRect();
        const w = rect.width * dpr;
        const h = rect.height * dpr;
        if (this.glCanvas.width !== w || this.glCanvas.height !== h) {
            this.glCanvas.width = w;
            this.glCanvas.height = h;
            this.glCanvas.style.width = rect.width + 'px';
            this.glCanvas.style.height = rect.height + 'px';
            this.gl.viewport(0,0,w,h);
        }
        return [w,h];
    }

    /**
     * Prepare GL canvas for a new frame – resize & clear.
     * Called once per ImageCanvas.draw().
     */
    beginFrame() {
        if (!this.gl) return;
        this._resizeCanvas();
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
        this.gl.clearColor(0,0,0,0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }

    drawNode(ctx2d, node) {
        if (!this.gl) return false; // No GL support.

        // Only handle image nodes for now
        if (node.type !== 'media/image') return false;
        if (!node.img || !node.img.complete) return false;

        const [w,h] = this._resizeCanvas();

        // Use animated position if available (matches Canvas2D path)
        let graphPos = node.pos;
        if (node._gridAnimPos) {
            graphPos = node._gridAnimPos;
        } else if (node._animPos) {
            graphPos = node._animPos;
        }

        // Compute screen-space rectangle
        const vp = this.canvas.viewport;
        const dpr = vp.dpr;
        const screenPos = vp.convertGraphToOffset(graphPos[0], graphPos[1]);
        const sx = screenPos[0] * dpr;
        const sy = screenPos[1] * dpr;
        const sw = node.size[0] * vp.scale * dpr;
        const sh = node.size[1] * vp.scale * dpr;

        // Update GL state
        this.gl.useProgram(this.program);
        this.gl.uniform2f(this.resolutionLoc, w, h);

        // Vertices
        let verts;
        if (node.rotation && node.rotation !== 0) {
            const rad = node.rotation * Math.PI / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const cx = sx + sw / 2;
            const cy = sy + sh / 2;

            const rotate = (x, y) => {
                const dx = x - cx;
                const dy = y - cy;
                return [
                    cx + dx * cos - dy * sin,
                    cy + dx * sin + dy * cos
                ];
            };

            const p1 = rotate(sx, sy);           // top-left
            const p2 = rotate(sx + sw, sy);      // top-right
            const p3 = rotate(sx, sy + sh);      // bottom-left
            const p4 = rotate(sx + sw, sy + sh); // bottom-right

            verts = new Float32Array([
                p1[0], p1[1],
                p2[0], p2[1],
                p3[0], p3[1],
                p4[0], p4[1]
            ]);
        } else {
            verts = new Float32Array([
                sx, sy,
                sx + sw, sy,
                sx, sy + sh,
                sx + sw, sy + sh
            ]);
        }
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, verts, this.gl.DYNAMIC_DRAW);
        this.gl.enableVertexAttribArray(this.positionLoc);
        this.gl.vertexAttribPointer(this.positionLoc, 2, this.gl.FLOAT, false, 0, 0);

        // Texcoords
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texBuffer);
        this.gl.enableVertexAttribArray(this.texLoc);
        this.gl.vertexAttribPointer(this.texLoc, 2, this.gl.FLOAT, false, 0, 0);

        // Texture
        const tex = this._ensureTexture(node.img);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, tex);

        // Send adjustment uniforms
        const adj = node.adjustments || {brightness:0,contrast:0,saturation:0,hue:0};
        this.gl.uniform1f(this.uBrightness, adj.brightness);
        this.gl.uniform1f(this.uContrast, adj.contrast);
        this.gl.uniform1f(this.uSaturation, adj.saturation);
        this.gl.uniform1f(this.uHue, adj.hue);

        // Draw
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

        // Indicate handled so Canvas2D path is skipped
        node.needsGLUpdate = false;
        return true;
    }
}

if (typeof window !== 'undefined') {
    window.WebGLRenderer = WebGLRenderer;
} 