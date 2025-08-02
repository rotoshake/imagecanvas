/**
 * WebGLRenderer – High-performance rendering layer with LOD support.
 * Manages texture LODs, atlasing, and frame budget for smooth 60fps rendering.
 */
class WebGLRenderer {
    /**
     * @param {ImageCanvas} canvasInstance Owning canvas instance.
     */
    constructor(canvasInstance) {
        try {
            this.canvas = canvasInstance;

            // Create an overlay canvas so we don't conflict with 2D context
            this.glCanvas = document.createElement('canvas');
            this.glCanvas.style.position = 'absolute';
            this.glCanvas.style.top = '0';
            this.glCanvas.style.left = '0';
            this.glCanvas.style.pointerEvents = 'none'; // let mouse go through
            this.glCanvas.style.zIndex = '1'; // between grid and UI
            this.glCanvas.style.mixBlendMode = 'normal'; // Ensure normal blending
            this.glCanvas.style.isolation = 'isolate'; // Prevent blend mode issues

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
                console.warn('WebGL not supported, falling back to Canvas2D');
                return;
            }

        // Resources
        this.program = this._initShaders();
        
        // Get uniform and attribute locations only if program compiled successfully
        if (this.gl && this.program) {
            this.uBrightness = this.gl.getUniformLocation(this.program, 'u_brightness');
            this.uContrast = this.gl.getUniformLocation(this.program, 'u_contrast');
            this.uSaturation = this.gl.getUniformLocation(this.program, 'u_saturation');
            this.uHue = this.gl.getUniformLocation(this.program, 'u_hue');
            this.uToneLUT = this.gl.getUniformLocation(this.program, 'u_toneLUT');
            this.uHasToneLUT = this.gl.getUniformLocation(this.program, 'u_hasToneLUT');
            this.uOpacity = this.gl.getUniformLocation(this.program, 'u_opacity');
            this.positionLoc = this.gl.getAttribLocation(this.program, 'a_position');
            this.texLoc = this.gl.getAttribLocation(this.program, 'a_texCoord');
            this.resolutionLoc = this.gl.getUniformLocation(this.program, 'u_resolution');
        } else {
            console.error('WebGL shader program failed to compile');
            return;
        }

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

        // Cache of textures per image element (legacy, will be replaced by LOD manager)
        this.textureCache = new WeakMap();
        
        // Initialize LOD and Atlas managers only if GL context is available
        this.lodManager = null;
        this.atlasManager = null;
        
        if (this.gl) {
            try {
                // Check if classes are available
                if (typeof TextureLODManager !== 'undefined') {
                    this.lodManager = new TextureLODManager(this.gl, {
                        maxMemory: 1536 * 1024 * 1024, // 1.5GB - more reasonable for modern GPUs
                        maxTextures: 500,
                        uploadBudget: 16, // 16ms per frame to upload more textures quickly
                        canvas: this.canvas // Pass canvas reference for viewport checks
                    });
                } else {
                    console.warn('TextureLODManager not available');
                }
                
                if (typeof TextureAtlasManager !== 'undefined') {
                    this.atlasManager = new TextureAtlasManager(this.gl, {
                        atlasSize: 4096,
                        thumbnailSize: 64,
                        padding: 2
                    });
                } else {
                    console.warn('TextureAtlasManager not available');
                }
            } catch (error) {
                console.error('Error initializing WebGL managers:', error);
                this.lodManager = null;
                this.atlasManager = null;
            }
        }
        
        // Frame budget management
        this.frameBudget = {
            startTime: 0,
            textureUploads: 8, // ms for texture uploads (increased)
            atlasPacking: 2    // ms for atlas packing (increased)
        };
        
        // Pending texture requests
        this.textureRequests = new Map(); // nodeId -> { hash, priority, screenSize }
        this.pendingServerRequests = new Set(); // Track pending server thumbnail requests
        this.thumbnailSubscriptions = new Map(); // hash -> callback, for thumbnail update notifications
        this.failedRequests = new Map(); // requestKey -> { timestamp, retryCount }
        this.failedRequestTTL = 5 * 60 * 1000; // 5 minutes TTL for failed requests
        
        // LOD calculation cache to prevent repeated calculations
        this.lodCache = new Map(); // nodeId -> { screenSize, optimalLOD, lastUpdate }
        
        // Texture request throttling to prevent spam
        this.lastTextureRequest = new Map(); // nodeId -> { hash, lodSize, timestamp }
        this.textureRequestCooldown = 2000; // 2 seconds between requests for the same node
        
        // Track rendered nodes to avoid unnecessary reprocessing
        this.renderedNodes = new Map(); // nodeId -> { hash, scale, position, textureKey }
        this.framesSinceInit = 0; // Force texture requests on first few frames
        
        // Stats for debugging
        this.stats = {
            lastFrameTime: 0,
            texturesUploaded: 0,
            thumbnailsPacked: 0
        };
        
        // LUT texture cache for tone curves
        this.lutTextureCache = new WeakMap(); // node -> WebGLTexture
        
        // Canvas size cache to avoid getBoundingClientRect every frame
        this._cachedCanvasRect = null;
        this._setupResizeObserver();
        
        } catch (error) {
            console.error('WebGLRenderer initialization error:', error);
            // Clean up if initialization fails
            if (this.glCanvas && this.glCanvas.parentNode) {
                this.glCanvas.parentNode.removeChild(this.glCanvas);
            }
            this.gl = null;
        }
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
            uniform sampler2D u_toneLUT;
            uniform float u_hasToneLUT;
            uniform float u_opacity;

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

            vec3 applyToneCurve(vec3 color) {
                // Apply tone curve LUT if available
                if (u_hasToneLUT > 0.5) {
                    // Sample the LUT for each channel - ensure proper clamping
                    float r = texture2D(u_toneLUT, vec2(clamp(color.r, 0.0, 1.0), 0.5)).r;
                    float g = texture2D(u_toneLUT, vec2(clamp(color.g, 0.0, 1.0), 0.5)).g;
                    float b = texture2D(u_toneLUT, vec2(clamp(color.b, 0.0, 1.0), 0.5)).b;
                    return vec3(r, g, b);
                }
                return color;
            }

            void main() {
                vec4 color = texture2D(u_image, v_texCoord);
                
                // Apply tone curve first (before other adjustments)
                color.rgb = applyToneCurve(color.rgb);
                
                // brightness
                color.rgb += u_brightness;
                // contrast  (simple linear)
                color.rgb = (color.rgb - 0.5) * (1.0 + u_contrast) + 0.5;
                // saturation & hue via HSV
                vec3 hsv = rgb2hsv(color.rgb);
                hsv.y *= (1.0 + u_saturation);
                hsv.x += u_hue / 360.0;
                color.rgb = hsv2rgb(hsv);
                
                // Apply opacity
                color.a *= u_opacity;
                
                gl_FragColor = color;
            }`;

        const compile = (src, type) => {
            const shader = this.gl.createShader(type);
            this.gl.shaderSource(shader, src);
            this.gl.compileShader(shader);
            if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
                console.error('Shader compile error:', this.gl.getShaderInfoLog(shader));
                return null;
            }
            return shader;
        };

        const vs = compile(vsSource, this.gl.VERTEX_SHADER);
        const fs = compile(fsSource, this.gl.FRAGMENT_SHADER);
        
        if (!vs || !fs) {
            console.error('Failed to compile shaders');
            return null;
        }
        
        const program = this.gl.createProgram();
        this.gl.attachShader(program, vs);
        this.gl.attachShader(program, fs);
        this.gl.linkProgram(program);
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('Program link error:', this.gl.getProgramInfoLog(program));
            return null;
        }
        return program;
    }

    _ensureTexture(imageOrVideo) {
        const isVideo = imageOrVideo instanceof HTMLVideoElement;
        let tex = this.textureCache.get(imageOrVideo);
        
        if (!tex) {
            // Create new texture
            tex = this.gl.createTexture();
            this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
            this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            this.textureCache.set(imageOrVideo, tex);
            
            // Always upload the first frame
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, imageOrVideo);
            
            // For videos, track the last update time
            if (isVideo) {
                if (!this.videoUpdateTracking) {
                    this.videoUpdateTracking = new WeakMap();
                }
                this.videoUpdateTracking.set(imageOrVideo, {
                    lastUpdateTime: imageOrVideo.currentTime,
                    frameCount: 0
                });
            }
        } else {
            // Texture exists, check if we need to update it
            this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
            
            if (isVideo) {
                // Only update video texture if the frame has changed
                const tracking = this.videoUpdateTracking?.get(imageOrVideo);
                if (!tracking || Math.abs(imageOrVideo.currentTime - tracking.lastUpdateTime) > 0.016) { // ~60fps threshold
                    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, imageOrVideo);
                    
                    if (tracking) {
                        tracking.lastUpdateTime = imageOrVideo.currentTime;
                        tracking.frameCount++;
                    }
                }
            } else {
                // For images, only upload if not already uploaded
                // The texture already has the image data from creation
            }
        }
        
        return tex;
    }

    _resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        
        // Use cached rect to avoid expensive getBoundingClientRect per frame
        if (!this._cachedCanvasRect) {
            this._updateCanvasRect();
        }
        
        const rect = this._cachedCanvasRect;
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
    
    _updateCanvasRect() {
        // This is the expensive call - only do it on actual resize
        this._cachedCanvasRect = this.canvas.canvas.getBoundingClientRect();
    }
    
    _setupResizeObserver() {
        if (typeof ResizeObserver === 'undefined') {
            // Fallback for browsers without ResizeObserver
            window.addEventListener('resize', () => this._updateCanvasRect());
            return;
        }
        
        this._resizeObserver = new ResizeObserver(() => {
            this._updateCanvasRect();
            // Request redraw on actual resize
            if (this.canvas) {
                this.canvas.dirty_canvas = true;
            }
        });
        
        this._resizeObserver.observe(this.canvas.canvas);
    }

    /**
     * Prepare GL canvas for a new frame – resize & clear.
     * Also processes texture uploads within frame budget.
     * Called once per ImageCanvas.draw().
     */
    beginFrame() {
        if (!this.gl) return;
        
        // Clear actively rendered textures tracking for this frame
        if (this.lodManager) {
            this.lodManager.clearActivelyRendered();
        }
        
        // Increment frame counter for initial texture loading
        this.framesSinceInit++;
        
        // Track frame timing
        this.frameBudget.startTime = performance.now();
        
        // Resize and always clear at the start of each frame to prevent artifacts
        this._resizeCanvas();
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
        
        // Clear the canvas at the beginning of each frame to prevent artifacts
        this.gl.clearColor(0,0,0,0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        
        // Track if we'll draw anything with WebGL this frame
        this._hasCleared = true;
        this._willDrawWebGL = false;
        
        // Process texture uploads within budget (non-blocking)
        if (this.lodManager && !this._processingUploads) {
            this._processingUploads = true;
            this.lodManager.processUploads().then(uploaded => {
                this.stats.texturesUploaded = uploaded;
                this._processingUploads = false;
                // Request redraw if textures were uploaded
                // But only if we're not already in a render loop
                if (uploaded > 0 && this.canvas && !this.canvas.dirty_canvas) {
                    this.canvas.dirty_canvas = true;
                }
            }).catch(error => {
                console.error('Error processing texture uploads:', error);
                this._processingUploads = false;
            });
        }
        
        // Process atlas packing within budget
        if (this.atlasManager) {
            const packingBudget = this.frameBudget.atlasPacking;
            this.stats.thumbnailsPacked = this.atlasManager.processPacking(packingBudget);
            
            // Update atlas textures if any were packed
            if (this.stats.thumbnailsPacked > 0) {
                this.atlasManager.updateTextures();
            }
        }
        
        // Clear texture requests from last frame
        this.textureRequests.clear();
        
        // Note: Don't clear pendingServerRequests here as they persist across frames until complete
        
        // Periodically clean up old cache entries (every 60 frames ≈ 1 second at 60fps)
        if (this.frameBudget.startTime % 1000 < 16) { // Roughly every second
            this._cleanupCaches();
        }
    }
    
    /**
     * Render a node with an existing texture (fast path - no LOD calculations)
     * @private
     */
    _renderWithTexture(ctx2d, node, texture) {
        const [w,h] = this._resizeCanvas();
        const vp = this.canvas.viewport;
        const dpr = vp.dpr;
        
        // Use animated position if available (matches Canvas2D path)
        let graphPos = node.pos;
        if (node._gridAnimPos) {
            graphPos = node._gridAnimPos;
        } else if (node._animPos) {
            graphPos = node._animPos;
        }

        // Compute screen-space rectangle
        const screenPos = vp.convertGraphToOffset(graphPos[0], graphPos[1]);
        const sx = screenPos[0] * dpr;
        const sy = screenPos[1] * dpr;
        const sw = node.size[0] * vp.scale * dpr;
        const sh = node.size[1] * vp.scale * dpr;

        // Mark that we will draw with WebGL this frame
        this._willDrawWebGL = true;
        
        // Reset texture units to prevent state leakage
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        this.gl.activeTexture(this.gl.TEXTURE0);

        // Update GL state
        this.gl.useProgram(this.program);
        this.gl.uniform2f(this.resolutionLoc, w, h);

        // Vertices (handle rotation if needed)
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

            const p1 = rotate(sx, sy);
            const p2 = rotate(sx + sw, sy);
            const p3 = rotate(sx, sy + sh);
            const p4 = rotate(sx + sw, sy + sh);

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

        // Bind texture
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

        // Send adjustment uniforms with validation (check bypass flag)
        const bypassed = node.colorAdjustmentsBypassed;
        const adj = (!bypassed && node.adjustments) ? node.adjustments : {brightness:0,contrast:0,saturation:0,hue:0};
        const brightness = bypassed ? 0 : (isNaN(adj.brightness) ? 0 : (adj.brightness || 0));
        const contrast = bypassed ? 0 : (isNaN(adj.contrast) ? 0 : (adj.contrast || 0));
        const saturation = bypassed ? 0 : (isNaN(adj.saturation) ? 0 : (adj.saturation || 0));
        const hue = bypassed ? 0 : (isNaN(adj.hue) ? 0 : (adj.hue || 0));
        
        this.gl.uniform1f(this.uBrightness, brightness);
        this.gl.uniform1f(this.uContrast, contrast);
        this.gl.uniform1f(this.uSaturation, saturation);
        this.gl.uniform1f(this.uHue, hue);
        
        if (window.DEBUG_LOD_STATUS && node.type === 'media/video' && (brightness !== 0 || contrast !== 0 || saturation !== 0 || hue !== 0)) {
            console.log(`🎨 Video color adjustments - B:${brightness} C:${contrast} S:${saturation} H:${hue}`);
        }
        
        // Get opacity from gallery view manager if in gallery mode
        let opacity = 1.0;
        if (window.app?.galleryViewManager && window.app.galleryViewManager.active) {
            opacity = window.app.galleryViewManager.getNodeOpacity(node);
        }
        this.gl.uniform1f(this.uOpacity, opacity);
        
        // Handle tone curve LUT
        if (node.toneCurve && node.toneCurve.lut && !node.toneCurveBypassed) {
            const lutTexture = this._ensureLUTTexture(node);
            if (lutTexture) {
                this.gl.activeTexture(this.gl.TEXTURE1);
                this.gl.bindTexture(this.gl.TEXTURE_2D, lutTexture);
                this.gl.uniform1i(this.uToneLUT, 1);
                this.gl.uniform1f(this.uHasToneLUT, 1.0);
            } else {
                // Make sure to disable LUT if texture creation failed
                this.gl.activeTexture(this.gl.TEXTURE1);
                this.gl.bindTexture(this.gl.TEXTURE_2D, null);
                this.gl.uniform1f(this.uHasToneLUT, 0.0);
            }
        } else {
            // Disable LUT completely and unbind texture
            this.gl.activeTexture(this.gl.TEXTURE1);
            this.gl.bindTexture(this.gl.TEXTURE_2D, null);
            this.gl.uniform1f(this.uHasToneLUT, 0.0);
        }

        // Draw
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

        // Clean up texture bindings after draw
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);

        // Return false to allow canvas to continue drawing other elements (title, selection, etc.)
        return false;
    }
    
    /**
     * Clean up old cache entries to prevent memory leaks
     * @private
     */
    _cleanupCaches() {
        const now = Date.now();
        const maxAge = 10000; // 10 seconds
        
        // Clean up LOD cache
        for (const [nodeId, entry] of this.lodCache) {
            if (now - entry.lastUpdate > maxAge) {
                this.lodCache.delete(nodeId);
            }
        }
        
        // Clean up texture request cache
        for (const [nodeId, entry] of this.lastTextureRequest) {
            if (now - entry.timestamp > maxAge) {
                this.lastTextureRequest.delete(nodeId);
            }
        }
        
        // Clean up rendered nodes cache (more aggressive - 5 seconds)
        for (const [nodeId, entry] of this.renderedNodes) {
            if (now - (entry.lastAccess || 0) > 5000) {
                this.renderedNodes.delete(nodeId);
            }
        }
    }
    
    /**
     * Called at the end of the frame to finalize WebGL rendering state
     */
    endFrame() {
        if (!this.gl || !this.glCanvas) return;
        
        // Don't hide canvas with opacity - this might be causing flashing
        // Just ensure we clean up texture state
        
        // Clean up any remaining texture bindings
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        
        // Periodically clean up textures for non-visible nodes (every 60 frames)
        if (this.framesSinceInit % 60 === 0 && this.lodManager && this.canvas) {
            // Get visible nodes from viewport
            const visibleNodes = this.canvas.viewport.getVisibleNodes(
                this.canvas.graph.nodes,
                200 // margin
            );
            
            // Build set of visible hashes
            const visibleHashes = new Set();
            for (const node of visibleNodes) {
                if (node.properties?.hash) {
                    visibleHashes.add(node.properties.hash);
                }
            }
            
            // Unload high-res textures for non-visible nodes
            // Use aggressive mode if memory is getting high
            const memoryPressure = this.lodManager.totalMemory > 350 * 1024 * 1024; // > 350MB
            this.lodManager.unloadNonVisibleHighRes(visibleHashes, 256, memoryPressure);
            
            // Debug: Log cache contents when memory is high
            if (this.lodManager.totalMemory > 300 * 1024 * 1024) { // > 300MB
                this.lodManager.logCacheContents();
            }
        }
        
        // Smart preloading: Preload nearby nodes at the same LOD as visible ones
        if (this.framesSinceInit % 30 === 0 && this.lodManager && this.canvas) {
            this._preloadNearbyNodes();
        }
        
        // Flush any pending GL commands
        this.gl.flush();
    }

    drawNode(ctx2d, node) {
        if (!this.gl) {
            if (window.DEBUG_LOD_STATUS) console.log('❌ No WebGL context');
            return false; // No GL support.
        }

        // Handle image and video nodes
        if (node.type !== 'media/image' && node.type !== 'media/video') {
            return false;
        }
        
        // Debug: Log when we're processing a node with adjustments
        if (node.adjustments || (node.toneCurve && node.toneCurve.lut)) {
            const hasAdjustments = node.adjustments && (
                node.adjustments.brightness !== 0 || 
                node.adjustments.contrast !== 0 || 
                node.adjustments.saturation !== 0 || 
                node.adjustments.hue !== 0
            );
            // console.log(`WebGL processing node - Adjustments: ${hasAdjustments}, ToneCurve: ${!!node.toneCurve?.lut}, needsGLUpdate: ${node.needsGLUpdate}`);
        }
        
        // For video nodes, we can render without a hash if they have a valid video element
        if (node.type === 'media/video') {
            if (!node.video || node.video.readyState < 2) {
                if (window.DEBUG_LOD_STATUS) console.log('❌ Video not ready for WebGL rendering');
                return false;
            }
            if (window.DEBUG_LOD_STATUS) console.log('✅ Video node ready for WebGL rendering');
        } else {
            // Image nodes need a hash to work with
            if (!node.properties?.hash) {
                if (window.DEBUG_LOD_STATUS) console.log('❌ No hash for image node');
                return false;
            }
        }

        // Skip early exit optimization if node has active adjustments
        const hasActiveAdjustments = node.adjustments && (
            node.adjustments.brightness !== 0 || 
            node.adjustments.contrast !== 0 || 
            node.adjustments.saturation !== 0 || 
            node.adjustments.hue !== 0
        );
        
        const nodeId = node.id || (node.properties?.hash ? 
            `${node.properties.hash}_${node.pos[0]}_${node.pos[1]}` : 
            `${node.type}_${node.pos[0]}_${node.pos[1]}`);
        const vp = this.canvas.viewport;
        const currentState = {
            hash: node.properties?.hash || node.type,
            scale: vp.scale,
            position: `${node.pos[0]},${node.pos[1]}`,
            rotation: node.rotation || 0
        };
        
        if (!hasActiveAdjustments && !node.needsGLUpdate && this.framesSinceInit > 5) {
            // Early exit if nothing has changed for this node (skip first 5 frames to ensure textures load)
            const lastState = this.renderedNodes.get(nodeId);
            if (lastState && 
                lastState.hash === currentState.hash &&
                Math.abs(lastState.scale - currentState.scale) < 0.01 &&
                lastState.position === currentState.position &&
                lastState.rotation === currentState.rotation) {
                
                // Update last access time for cache cleanup
                lastState.lastAccess = Date.now();
                
                // Nothing has changed, check if we have a valid texture and just render it
                if (this.lodManager) {
                    const screenWidth = node.size[0] * vp.scale * vp.dpr;
                    const screenHeight = node.size[1] * vp.scale * vp.dpr;
                    const texture = this.lodManager.getBestTexture(
                        node.properties.hash, 
                        screenWidth,
                        screenHeight
                    );
                    
                    if (texture) {
                        // Check if we should request a better texture even though nothing else changed
                        // Check LOD cache first
                        const cachedLODInfo = this.lodCache.get(nodeId);
                        const screenSize = Math.max(screenWidth, screenHeight);
                        const now = Date.now();
                        
                        let optimalLOD;
                        if (cachedLODInfo && Math.abs(cachedLODInfo.screenSize - screenSize) < screenSize * 0.05 && 
                            now - cachedLODInfo.lastUpdate < 5000) {
                            optimalLOD = cachedLODInfo.optimalLOD;
                        } else {
                            optimalLOD = this.lodManager.getOptimalLOD(screenWidth, screenHeight);
                            // Update cache
                            this.lodCache.set(nodeId, {
                                screenSize,
                                optimalLOD,
                                lastUpdate: now
                            });
                        }
                        
                        // Find current texture's LOD
                        let currentLOD = null;
                        const nodeCache = this.lodManager.textureCache.get(node.properties.hash);
                        if (nodeCache) {
                            for (const [lodSize, textureData] of nodeCache) {
                                if (textureData.texture === texture) {
                                    currentLOD = lodSize;
                                    break;
                                }
                            }
                        }
                        
                        // Request better texture if needed
                        if (currentLOD !== null && optimalLOD !== null && currentLOD < optimalLOD) {
                            const now = Date.now();
                            const lastRequest = this.lastTextureRequest.get(nodeId);
                            
                            if (!lastRequest || 
                                lastRequest.hash !== node.properties.hash ||
                                lastRequest.lodSize !== optimalLOD ||
                                now - lastRequest.timestamp > this.textureRequestCooldown) {
                                
                                // console.log(`📈 Early exit: Requesting better texture: current=${currentLOD}px, optimal=${optimalLOD}px`);
                                
                                this.lastTextureRequest.set(nodeId, {
                                    hash: node.properties.hash,
                                    lodSize: optimalLOD,
                                    timestamp: now
                                });
                                
                                this._requestTexture(node, screenWidth, screenHeight);
                            }
                        }
                        
                        // Just render with existing texture, skip all LOD calculations
                        return this._renderWithTexture(ctx2d, node, texture);
                    } else {
                        // No texture available yet - need to request one!
                        const now = Date.now();
                        const lastRequest = this.lastTextureRequest.get(nodeId);
                        const optimalLOD = this.lodManager.getOptimalLOD(screenWidth, screenHeight);
                        
                        if (!lastRequest || 
                            lastRequest.hash !== node.properties.hash ||
                            lastRequest.lodSize !== optimalLOD ||
                            now - lastRequest.timestamp > this.textureRequestCooldown) {
                            
                            this.lastTextureRequest.set(nodeId, {
                                hash: node.properties.hash,
                                lodSize: optimalLOD,
                                timestamp: now
                            });
                            
                            this._requestTexture(node, screenWidth, screenHeight);
                        }
                    }
                }
                
                // No texture available, fall back to Canvas2D
                return false;
            }
        }
        
        // State has changed, update tracking and proceed with full processing
        currentState.lastAccess = Date.now();
        this.renderedNodes.set(nodeId, currentState);

        const [w,h] = this._resizeCanvas();

        // Use animated position if available (matches Canvas2D path)
        let graphPos = node.pos;
        if (node._gridAnimPos) {
            graphPos = node._gridAnimPos;
        } else if (node._animPos) {
            graphPos = node._animPos;
        }

        // Compute screen-space rectangle
        const dpr = vp.dpr;
        const screenPos = vp.convertGraphToOffset(graphPos[0], graphPos[1]);
        const sx = screenPos[0] * dpr;
        const sy = screenPos[1] * dpr;
        const sw = node.size[0] * vp.scale * dpr;
        const sh = node.size[1] * vp.scale * dpr;
        
        // Calculate screen size for LOD selection (include DPR for high-DPI displays)
        const screenWidth = node.size[0] * vp.scale * dpr;
        const screenHeight = node.size[1] * vp.scale * dpr;
        const screenSize = Math.max(screenWidth, screenHeight);
        
        // Check LOD cache to avoid repeated calculations
        const cachedLOD = this.lodCache.get(nodeId);
        const now = Date.now();
        
        // Use cached LOD if screen size hasn't changed significantly (within 5%)
        let optimalLOD = null;
        if (cachedLOD && Math.abs(cachedLOD.screenSize - screenSize) < screenSize * 0.05 && 
            now - cachedLOD.lastUpdate < 5000) { // Cache valid for 5 seconds
            optimalLOD = cachedLOD.optimalLOD;
        } else {
            // Calculate new optimal LOD only once
            optimalLOD = this.lodManager.getOptimalLOD(screenWidth, screenHeight);
            
            // Cache the result
            this.lodCache.set(nodeId, {
                screenSize,
                optimalLOD,
                lastUpdate: now
            });
            
            // Debug: Only log when LOD actually changes
            if (screenWidth > 5000 || screenHeight > 5000) {
                console.warn(`🚨 Huge screen size detected: ${Math.round(screenWidth)}x${Math.round(screenHeight)} (node: ${node.size[0]}x${node.size[1]}, scale: ${vp.scale.toFixed(2)}, dpr: ${dpr})`);
            }
        }
        
        // Get best available texture from LOD manager or video element
        let texture = null;
        let currentLOD = null;
        
        // For video nodes, use the video element directly
        if (node.type === 'media/video' && node.video && node.video.readyState >= 2) {
            texture = this._ensureTexture(node.video);
            currentLOD = 'video';
            if (window.DEBUG_LOD_STATUS) console.log(`🎥 Rendering video node ${node.id} with WebGL`);
        } else if (this.lodManager && node.type === 'media/image') {
            // For image nodes, use LOD manager
            // First try to get the best texture for the current size
            texture = this.lodManager.getBestTexture(
                node.properties.hash, 
                screenWidth, 
                screenHeight
            );
            
            // If no texture at all, try to get ANY available texture to maintain framerate
            if (!texture) {
                texture = this.lodManager.getAnyAvailableTexture(node.properties.hash);
            }
        
            
        // Track what's actually being rendered for debugging
        if (texture && node.type === 'media/image') {
            // Try to determine the texture size from the LOD manager
                const nodeCache = this.lodManager.textureCache.get(node.properties.hash);
                let actualLOD = null;
                let textureSource = null;
                
                if (nodeCache) {
                    // Find which texture entry matches our current texture
                    for (const [lodSize, textureData] of nodeCache) {
                        if (textureData.texture === texture) {
                            actualLOD = lodSize;
                            textureSource = textureData.source;
                            break;
                        }
                    }
                }
                
                node._currentRenderInfo = {
                    textureSource: textureSource || texture,
                    lodSize: actualLOD,
                    screenWidth: Math.round(screenWidth / (this.canvas.viewport?.dpr || 1)),
                    actualWidth: textureSource?.width || texture.width,
                    actualHeight: textureSource?.height || texture.height,
                    isFullRes: actualLOD === null && textureSource === node.img
                };
            }
            
            // Check if we have a texture but it's lower quality than optimal
            if (texture) {
                // Try to determine current texture's LOD from cache
                const nodeCache = this.lodManager.textureCache.get(node.properties.hash);
                if (nodeCache) {
                    // Find which LOD we're currently using
                    for (const [lodSize, textureData] of nodeCache) {
                        if (textureData.texture === texture) {
                            currentLOD = lodSize;
                            break;
                        }
                    }
                }
                
                // Check if we should request a better texture (with throttling)
                const shouldRequestBetter = (currentLOD !== null && optimalLOD !== null && currentLOD < optimalLOD) ||
                                           (currentLOD !== null && currentLOD <= 128 && screenWidth > 200);
                
                if (shouldRequestBetter) {
                    const lastRequest = this.lastTextureRequest.get(nodeId);
                    const requestKey = `${node.properties.hash}_${optimalLOD}`;
                    
                    // Only make request if we haven't made the same request recently (throttle to 500ms)
                    if (!lastRequest || 
                        lastRequest.hash !== node.properties.hash ||
                        lastRequest.lodSize !== optimalLOD ||
                        now - lastRequest.timestamp > this.textureRequestCooldown) {
                        
                        if (currentLOD < optimalLOD) {
                            // console.log(`📈 Requesting higher quality texture: current=${currentLOD}px, optimal=${optimalLOD}px, screen=${Math.round(screenWidth)}px`);
                        } else {
                            // console.log(`🔍 Requesting better texture for zoomed view: current=${currentLOD}px, screen=${Math.round(screenWidth)}px`);
                        }
                        
                        // Update throttling cache
                        this.lastTextureRequest.set(nodeId, {
                            hash: node.properties.hash,
                            lodSize: optimalLOD,
                            timestamp: now
                        });
                        
                        this._requestTexture(node, screenWidth, screenHeight);
                    }
                }
            }
        }
        
        // If no texture available, request loading
        if (!texture) {
            // Check if we can use atlas for small size
            if (this.atlasManager && screenWidth <= 80 && screenHeight <= 80) {
                const atlasLocation = this.atlasManager.getThumbnailLocation(node.properties.hash);
                if (atlasLocation) {
                    texture = atlasLocation.texture;
                    // Will handle UV coordinates later in shader
                } else {
                    // Request atlas packing if we have a 64px thumbnail
                    this._requestAtlasPacking(node);
                }
            }
            
            // Request appropriate LOD texture (with throttling)
            const lastRequest = this.lastTextureRequest.get(nodeId);
            if (!lastRequest || 
                lastRequest.hash !== node.properties.hash ||
                lastRequest.lodSize !== optimalLOD ||
                now - lastRequest.timestamp > this.textureRequestCooldown) {
                
                // Update throttling cache
                this.lastTextureRequest.set(nodeId, {
                    hash: node.properties.hash,
                    lodSize: optimalLOD,
                    timestamp: now
                });
                
                this._requestTexture(node, screenWidth, screenHeight);
            }
            
            // Special case: If node has tone curve or color adjustments, try to use the node's img element
            // to prevent falling back to Canvas2D which might cause blending issues
            if ((node.toneCurve && node.toneCurve.lut) || 
                (node.adjustments && (node.adjustments.brightness !== 0 || node.adjustments.contrast !== 0 || 
                 node.adjustments.saturation !== 0 || node.adjustments.hue !== 0))) {
                if (node.img && node.img.complete) {
                    texture = this._ensureTexture(node.img);
                }
            }
            
            // Fall back to Canvas2D only if we have no other options
            if (!texture) {
                return false;
            }
        }

        // Mark that we will draw with WebGL this frame
        this._willDrawWebGL = true;
        
        // Reset texture units to prevent state leakage
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        this.gl.activeTexture(this.gl.TEXTURE0);

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

        // Bind texture
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

        // Send adjustment uniforms with validation (check bypass flag)
        const bypassed = node.colorAdjustmentsBypassed;
        const adj = (!bypassed && node.adjustments) ? node.adjustments : {brightness:0,contrast:0,saturation:0,hue:0};
        const brightness = bypassed ? 0 : (isNaN(adj.brightness) ? 0 : (adj.brightness || 0));
        const contrast = bypassed ? 0 : (isNaN(adj.contrast) ? 0 : (adj.contrast || 0));
        const saturation = bypassed ? 0 : (isNaN(adj.saturation) ? 0 : (adj.saturation || 0));
        const hue = bypassed ? 0 : (isNaN(adj.hue) ? 0 : (adj.hue || 0));
        
        this.gl.uniform1f(this.uBrightness, brightness);
        this.gl.uniform1f(this.uContrast, contrast);
        this.gl.uniform1f(this.uSaturation, saturation);
        this.gl.uniform1f(this.uHue, hue);
        
        if (window.DEBUG_LOD_STATUS && node.type === 'media/video' && (brightness !== 0 || contrast !== 0 || saturation !== 0 || hue !== 0)) {
            console.log(`🎨 Video color adjustments - B:${brightness} C:${contrast} S:${saturation} H:${hue}`);
        }
        
        // Get opacity from gallery view manager if in gallery mode
        let opacity = 1.0;
        if (window.app?.galleryViewManager && window.app.galleryViewManager.active) {
            opacity = window.app.galleryViewManager.getNodeOpacity(node);
        }
        this.gl.uniform1f(this.uOpacity, opacity);
        
        // Handle tone curve LUT
        if (node.toneCurve && node.toneCurve.lut && !node.toneCurveBypassed) {
            const lutTexture = this._ensureLUTTexture(node);
            if (lutTexture) {
                this.gl.activeTexture(this.gl.TEXTURE1);
                this.gl.bindTexture(this.gl.TEXTURE_2D, lutTexture);
                this.gl.uniform1i(this.uToneLUT, 1);
                this.gl.uniform1f(this.uHasToneLUT, 1.0);
            } else {
                // Make sure to disable LUT if texture creation failed
                this.gl.activeTexture(this.gl.TEXTURE1);
                this.gl.bindTexture(this.gl.TEXTURE_2D, null);
                this.gl.uniform1f(this.uHasToneLUT, 0.0);
            }
        } else {
            // Disable LUT completely and unbind texture
            this.gl.activeTexture(this.gl.TEXTURE1);
            this.gl.bindTexture(this.gl.TEXTURE_2D, null);
            this.gl.uniform1f(this.uHasToneLUT, 0.0);
        }

        // Draw
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

        // Clean up texture bindings after draw
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);

        // DEBUG: Show LOD status if enabled
        if (window.DEBUG_LOD_STATUS) {
            console.log(`✅ WebGL rendering ${node.properties.hash.substring(0, 8)} with ${currentLOD}px texture`);
            // Store LOD info on node for Canvas2D overlay
            node._webglLOD = {
                current: currentLOD,
                optimal: optimalLOD, // Use the already calculated value
                screenSize: Math.max(screenWidth, screenHeight),
                loading: this.textureRequests.has(node.id)
            };
        }

        // Reset needsGLUpdate flag since we've now processed the node
        if (node.needsGLUpdate && !node.toneCurve?.lut) {
            // Only reset if we don't have a tone curve, as tone curves handle their own flag
            node.needsGLUpdate = false;
        }
        
        return true;
    }
    
    /**
     * Request texture loading for a node - elegant single-path logic
     * @private
     */
    _requestTexture(node, screenWidth, screenHeight, overridePriority = null) {
        if (!node.properties?.hash || !this.lodManager) return;
        
        // Skip server thumbnail requests for video nodes - they use their own simple thumbnail system
        if (node.type === 'media/video') {
            return;
        }
        
        const hash = node.properties.hash;
        const optimalLOD = this.lodManager.getOptimalLOD(screenWidth, screenHeight);
        
        // Single decision tree - no overlapping conditions
        let textureSource = null;
        let lodSize = null;
        let priority = overridePriority !== null ? overridePriority : (screenWidth > 512 ? 0 : 2); // High priority for large display unless overridden
        
        // 1. Try exact optimal size from thumbnails
        if (window.thumbnailCache && optimalLOD !== null) {
            const thumbnails = window.thumbnailCache.getThumbnails(hash);
            const exactMatch = thumbnails?.get(optimalLOD);
            if (exactMatch) {
                textureSource = exactMatch;
                lodSize = optimalLOD;
            }
        }
        
        // 2. If no exact match, check if we should generate the optimal size
        if (!textureSource && window.thumbnailCache && optimalLOD) {
            const thumbnails = window.thumbnailCache.getThumbnails(hash);
            if (thumbnails && thumbnails.size > 0) {
                // Find the best available thumbnail, but only if it's close to optimal
                let bestSize = 0;
                let bestThumbnail = null;
                
                for (const [size, thumb] of thumbnails) {
                    if (size >= optimalLOD && (!bestSize || size < bestSize)) {
                        // Found a thumbnail that's good enough quality
                        bestSize = size;
                        bestThumbnail = thumb;
                    } else if (size > bestSize) {
                        // Keep track of largest available as fallback
                        bestSize = size;
                        bestThumbnail = thumb;
                    }
                }
                
                // Check if we're already waiting for a better quality thumbnail
                const requestKey = `${hash}_${optimalLOD}`;
                const alreadyWaiting = this.pendingServerRequests.has(requestKey);
                
                // Only use existing thumbnail if it's reasonably close to optimal OR we're not waiting for better
                if (bestSize >= optimalLOD * 0.8) {
                    // Close enough to optimal, use it
                    textureSource = bestThumbnail;
                    lodSize = bestSize;
                    // console.log(`📎 Using existing ${bestSize}px thumbnail (optimal: ${optimalLOD}px`);
                } else if (!alreadyWaiting && bestSize > 0) {
                    // Use lower quality temporarily only if we're not already waiting for better
                    textureSource = bestThumbnail;
                    lodSize = bestSize;
                    // console.log(`⏳ Using temporary ${bestSize}px thumbnail while requesting ${optimalLOD}px`);
                    
                    // IMPORTANT: Still need to request the optimal size from server
                    // even though we're using a temporary texture
                    if (bestSize < optimalLOD && node.properties?.serverFilename) {
                        this.pendingServerRequests.add(requestKey);
                        this._requestServerThumbnail(hash, node.properties.serverFilename, optimalLOD, requestKey);
                    }
                } else {
                    // console.log(`📉 Existing ${bestSize}px thumbnail too small for optimal ${optimalLOD}px${alreadyWaiting ? ' (already waiting for better)' : ', will request'}`);
                    // Don't set textureSource - let it fall through to server request
                }
            }
        }
        
        // 3. Fallback to full resolution only when really needed
        if (!textureSource && node.img?.complete) {
            // Only use full res if we truly need it and have waited for thumbnails
            if (!optimalLOD || optimalLOD > 2048) {
                // Only for truly large displays that exceed thumbnail capabilities
                textureSource = node.img;
                lodSize = null; // null = full resolution
                priority += 1; // Lower priority for full res
            }
            // For smaller displays, prefer to wait for thumbnails rather than use full res
        }
        
        // 4. Make the request (only one per call)
        if (textureSource) {
            const dpr = this.canvas.viewport.dpr || 1;
            // console.log(`🎯 Requesting ${lodSize || 'FULL'}px texture for ${hash.substring(0, 8)} (optimal: ${optimalLOD || 'FULL'}px, screen: ${Math.round(screenWidth/dpr)}px @ ${dpr}x DPR)`);
            
            // Track what's actually being rendered for debugging
            node._currentRenderInfo = {
                textureSource,
                lodSize,
                optimalLOD,
                screenWidth: Math.round(screenWidth/dpr),
                dpr,
                isFullRes: lodSize === null
            };
            
            this.lodManager.requestTexture(hash, lodSize, priority, textureSource);
        } else {
            // 5. If nothing available, request server thumbnails for optimal size
            const requestKey = `${hash}_${optimalLOD}`;
            
            // Check if this request has failed recently
            const failedInfo = this.failedRequests.get(requestKey);
            if (failedInfo) {
                const now = Date.now();
                if (now - failedInfo.timestamp < this.failedRequestTTL) {
                    // Skip this request - it failed recently
                    if (window.DEBUG_LOD_STATUS) {
                        console.log(`⏭️ Skipping failed request for ${hash.substring(0, 8)} (${optimalLOD}px) - failed ${failedInfo.retryCount} times`);
                    }
                    return;
                } else {
                    // TTL expired, remove from failed cache
                    this.failedRequests.delete(requestKey);
                }
            }
            
            // Don't make duplicate requests for the same hash+size combo
            if (!this.pendingServerRequests.has(requestKey)) {
                // console.log(`⏳ No texture available for ${hash.substring(0, 8)}, requesting server thumbnail (optimal: ${optimalLOD || 'FULL'}px)`);
                
                if (node.properties?.serverFilename && optimalLOD) {
                    // Request specific size from server
                    this.pendingServerRequests.add(requestKey);
                    this._requestServerThumbnail(hash, node.properties.serverFilename, optimalLOD, requestKey);
                } else if (node.img && window.thumbnailCache) {
                    // Fallback to progressive loading of all server thumbnails
                    window.thumbnailCache.generateThumbnailsProgressive(hash, node.img);
                    
                    // Show what sizes the cache is configured for
                    const availableSizes = window.thumbnailCache.thumbnailSizes;
                    // console.log(`📝 Cache configured for sizes: [${availableSizes.join(', ')}]`);
                }
            } else {
                // console.log(`⏸️ Already requesting ${optimalLOD}px for ${hash.substring(0, 8)}, waiting...`);
            }
        }
    }
    
    /**
     * Request specific thumbnail size from server
     * @private
     */
    _requestServerThumbnail(hash, serverFilename, size, requestKey) {
        if (!hash || !serverFilename || !size) return;
        
        // console.log(`🌐 Requesting ${size}px thumbnail from server for ${hash.substring(0, 8)} (${serverFilename}`)`;
        
        // Subscribe to thumbnail updates for this hash if not already subscribed
        if (window.thumbnailCache && !this.thumbnailSubscriptions.has(hash)) {
            const callback = this._onThumbnailUpdate.bind(this);
            window.thumbnailCache.subscribe(hash, callback);
            this.thumbnailSubscriptions.set(hash, callback);
        }
        
        // Use coordinator if available, otherwise fall back to direct request
        if (window.thumbnailRequestCoordinator) {
            window.thumbnailRequestCoordinator.requestThumbnail(hash, serverFilename, size, 'webgl-renderer')
                .then((success) => {
                    // Clean up pending request tracking
                    if (requestKey) {
                        this.pendingServerRequests.delete(requestKey);
                    }
                    
                    if (success) {
                        // console.log(`✅ Server thumbnail ${size}px loaded for ${hash.substring(0, 8)}`);
                        // Force a redraw to show the new texture
                        if (this.canvas) {
                            this.canvas.dirty_canvas = true;
                        }
                    } else {
                        // console.warn(`⚠️ Server thumbnail ${size}px not available for ${hash.substring(0, 8)}`);
                        // Mark as failed request
                        this._markFailedRequest(requestKey);
                    }
                })
                .catch(error => {
                    // Clean up pending request tracking on error too
                    if (requestKey) {
                        this.pendingServerRequests.delete(requestKey);
                    }
                    // console.warn(`❌ Failed to load server thumbnail ${size}px for ${hash.substring(0, 8)}:`, error);
                    // Mark as failed request
                    this._markFailedRequest(requestKey);
                });
        } else if (window.thumbnailCache && window.thumbnailCache.loadServerThumbnails) {
            // Fallback to direct request
            window.thumbnailCache.loadServerThumbnails(hash, serverFilename, [size])
                .then((success) => {
                    // Clean up pending request tracking
                    if (requestKey) {
                        this.pendingServerRequests.delete(requestKey);
                    }
                    
                    if (success) {
                        // console.log(`✅ Server thumbnail ${size}px loaded for ${hash.substring(0, 8)}`);
                        // Force a redraw to show the new texture
                        if (this.canvas) {
                            this.canvas.dirty_canvas = true;
                        }
                    } else {
                        // console.warn(`⚠️ Server thumbnail ${size}px not available for ${hash.substring(0, 8)}`);
                        // Mark as failed request
                        this._markFailedRequest(requestKey);
                    }
                })
                .catch(error => {
                    // Clean up pending request tracking on error too
                    if (requestKey) {
                        this.pendingServerRequests.delete(requestKey);
                    }
                    // console.warn(`❌ Failed to load server thumbnail ${size}px for ${hash.substring(0, 8)}:`, error);
                    // Mark as failed request
                    this._markFailedRequest(requestKey);
                });
        }
    }
    
    /**
     * Request atlas packing for small thumbnails
     * @private
     */
    _requestAtlasPacking(node) {
        if (!node.properties?.hash || !this.atlasManager) return;
        
        const hash = node.properties.hash;
        
        // Try to get 64px thumbnail from cache
        if (window.thumbnailCache) {
            const thumbnail = window.thumbnailCache.getThumbnails(hash)?.get(64);
            if (thumbnail) {
                this.atlasManager.requestPacking(hash, thumbnail, (success) => {
                    if (success && this.canvas) {
                        // Force redraw to show packed thumbnail
                        this.canvas.dirty_canvas = true;
                    }
                });
            }
        }
    }
    
    /**
     * Get frame statistics for debugging
     */
    getFrameStats() {
        const lodStats = this.lodManager ? this.lodManager.getStats() : null;
        const atlasStats = this.atlasManager ? this.atlasManager.getStats() : null;
        
        return {
            ...this.stats,
            frameTime: performance.now() - this.frameBudget.startTime,
            lod: lodStats,
            atlas: atlasStats,
            pendingRequests: this.textureRequests.size
        };
    }
    
    /**
     * Intelligently preload nearby nodes at the same LOD as currently visible ones
     * @private
     */
    _preloadNearbyNodes() {
        if (!this.canvas || !this.lodManager) return;
        
        const vp = this.canvas.viewport;
        const scale = vp.scale;
        
        // FIRST PRIORITY: Ensure preview textures (256px) are loaded for a WIDE area
        // This ensures smooth zoom-out animations
        this._ensurePreviewTextures();
        
        // Get visible nodes with a small margin
        const visibleNodes = vp.getVisibleNodes(
            this.canvas.graph.nodes,
            50 // Small margin for currently visible
        );
        
        // Calculate the average screen size of visible nodes to determine LOD
        let totalScreenSize = 0;
        let visibleImageCount = 0;
        
        for (const node of visibleNodes) {
            if (node.type === 'media/image' && node.properties?.hash) {
                const screenWidth = node.size[0] * scale;
                const screenHeight = node.size[1] * scale;
                const screenSize = Math.max(screenWidth, screenHeight);
                totalScreenSize += screenSize;
                visibleImageCount++;
            }
        }
        
        if (visibleImageCount === 0) return;
        
        // Determine the optimal LOD for this zoom level
        const avgScreenSize = totalScreenSize / visibleImageCount;
        const optimalLOD = this.lodManager.getOptimalLOD(avgScreenSize, avgScreenSize);
        
        // Only log preloading for large operations
        if (visibleImageCount > 50) {
            console.log(`🔮 Preloading: ${visibleImageCount} visible, avg screen size ${Math.round(avgScreenSize)}px → optimal LOD: ${optimalLOD || 'FULL'}`);
        }
        
        // Check if we're zoomed out on many small images
        if (visibleImageCount > 20 && avgScreenSize < 100) {
            console.warn(`⚠️ Many small images visible: ${visibleImageCount} at ~${Math.round(avgScreenSize)}px each`);
        }
        
        // Get nodes in a wider area for preloading
        const nearbyNodes = vp.getVisibleNodes(
            this.canvas.graph.nodes,
            Math.max(400, avgScreenSize * 2) // Preload area based on zoom level
        );
        
        // Preload textures for nearby nodes that aren't visible yet
        let preloadCount = 0;
        const maxPreloads = 5; // Limit to prevent overwhelming the system
        
        for (const node of nearbyNodes) {
            if (node.type !== 'media/image' || !node.properties?.hash) continue;
            
            // Skip if already visible
            if (visibleNodes.includes(node)) continue;
            
            // Check if we already have this texture at the desired LOD
            const hash = node.properties.hash;
            const nodeCache = this.lodManager.textureCache.get(hash);
            
            if (nodeCache && nodeCache.has(optimalLOD)) {
                // Already have this LOD, skip
                continue;
            }
            
            // Don't preload full resolution unless we're really zoomed in
            if (optimalLOD === null && avgScreenSize < 1500) {
                continue;
            }
            
            // Request the texture at the optimal LOD for current zoom
            const screenWidth = node.size[0] * scale;
            const screenHeight = node.size[1] * scale;
            
            // Low priority for preloading
            this._requestTexture(node, screenWidth, screenHeight, 5);
            
            preloadCount++;
            if (preloadCount >= maxPreloads) break;
        }
        
        // Only log significant preload operations
        if (preloadCount > 10 && optimalLOD > 256) {
            console.log(`📥 Preloaded ${preloadCount} textures at ${optimalLOD || 'FULL'}px`);
        }
    }
    
    /**
     * Ensure preview textures (256px) are loaded for a wide area
     * This is critical for smooth zoom-out animations
     * @private
     */
    _ensurePreviewTextures() {
        if (!this.canvas || !this.lodManager) return;
        
        const vp = this.canvas.viewport;
        
        // Get nodes in a VERY wide area (enough to cover typical zoom-out)
        const wideAreaNodes = vp.getVisibleNodes(
            this.canvas.graph.nodes,
            2000 // Very wide margin to ensure smooth animations
        );
        
        let previewRequestCount = 0;
        const maxPreviewRequests = 20; // Allow more preview requests since they're small
        
        for (const node of wideAreaNodes) {
            if (node.type !== 'media/image' || !node.properties?.hash) continue;
            
            const hash = node.properties.hash;
            const nodeCache = this.lodManager.textureCache.get(hash);
            
            // Check if we have at least a 256px preview
            const hasPreview = nodeCache && (nodeCache.has(256) || nodeCache.has(128) || nodeCache.has(64));
            
            if (!hasPreview) {
                // Request a 256px preview with medium priority
                this._requestTexture(node, 256, 256, 3);
                previewRequestCount++;
                
                if (previewRequestCount >= maxPreviewRequests) break;
            }
        }
        
        // Only log significant preview operations
        if (previewRequestCount > 20) {
            console.log(`🖼️ Ensuring ${previewRequestCount} preview textures are loaded`);
        }
    }
    
    _ensureLUTTexture(node) {
        // Check cache first
        let lutTexture = this.lutTextureCache.get(node);
        
        // If texture exists but curve has changed, delete old texture
        if (lutTexture && node.needsGLUpdate) {
            // Silently invalidate LUT texture
            this.gl.deleteTexture(lutTexture);
            lutTexture = null;
            this.lutTextureCache.delete(node);
        }
        
        if (!lutTexture && node.toneCurve && node.toneCurve.lut) {
            const lut = node.toneCurve.lut;
            const size = lut.length;
            
            // Validate LUT data
            if (size < 2) {
                console.warn('LUT data too small, skipping texture creation');
                return null;
            }
            
            // Check if this is an identity curve (y = x) and skip if so
            let isIdentityCurve = true;
            const tolerance = 0.01;
            for (let i = 0; i < size; i++) {
                const expected = i / (size - 1);
                if (Math.abs(lut[i] - expected) > tolerance) {
                    isIdentityCurve = false;
                    break;
                }
            }
            
            // if (isIdentityCurve) {
            //     console.log('Identity curve detected, skipping LUT texture creation');
            //     return null;
            // }
            
            // Create new LUT texture
            lutTexture = this.gl.createTexture();
            this.gl.bindTexture(this.gl.TEXTURE_2D, lutTexture);
            
            // Configure texture parameters for 1D LUT
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
            
            // Create RGBA texture data for better compatibility
            const lutData = new Uint8Array(size * 4);
            
            for (let i = 0; i < size; i++) {
                // Clamp and convert to 0-255 range
                const value = Math.floor(Math.max(0, Math.min(1, lut[i])) * 255);
                const idx = i * 4;
                lutData[idx] = value;     // R
                lutData[idx + 1] = value; // G  
                lutData[idx + 2] = value; // B
                lutData[idx + 3] = 255;   // A (full opacity)
            }
            
            // Upload as 1D texture (width x 1)
            this.gl.texImage2D(
                this.gl.TEXTURE_2D,
                0,
                this.gl.RGBA,
                size,
                1,
                0,
                this.gl.RGBA,
                this.gl.UNSIGNED_BYTE,
                lutData
            );
            
            // Cache the texture
            this.lutTextureCache.set(node, lutTexture);
            
            // Reset the GL update flag only when LUT texture is successfully created
            node.needsGLUpdate = false;
            
            // Only log LUT creation when debugging
            if (window.DEBUG_LOD_STATUS) {
                console.log(`Created LUT texture: ${size} samples, range [${Math.min(...lut).toFixed(3)}, ${Math.max(...lut).toFixed(3)}]`);
            }
        }
        
        return lutTexture;
    }
    
    /**
     * Clean up resources
     */
    destroy() {
        // Clean up thumbnail subscriptions
        if (window.thumbnailCache) {
            for (const [hash, callback] of this.thumbnailSubscriptions) {
                window.thumbnailCache.unsubscribe(hash, callback);
            }
        }
        this.thumbnailSubscriptions.clear();
        
        // Clean up ResizeObserver
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        
        // Clean up WebGL resources
        if (this.gl && this.glCanvas) {
            // Remove canvas from DOM
            if (this.glCanvas.parentNode) {
                this.glCanvas.parentNode.removeChild(this.glCanvas);
            }
            
            // Clean up LOD manager
            if (this.lodManager) {
                this.lodManager.clear();
            }
            
            // Clean up atlas manager
            if (this.atlasManager) {
                this.atlasManager.clear();
            }
        }
    }
    
    /**
     * Handle thumbnail update notification
     * @private
     */
    _onThumbnailUpdate(hash) {
        // Only log when debugging is enabled
        if (window.DEBUG_LOD_STATUS) {
            console.log(`🔄 Thumbnail updated for ${hash.substring(0, 8)}, invalidating renderer cache`);
        }
        
        // Clear the LOD manager's cache for this hash to force re-evaluation
        if (this.lodManager) {
            this.lodManager.invalidateHash(hash);
        }
        
        // Clear any failed requests for this hash since new thumbnails are available
        for (const [requestKey, ] of this.failedRequests) {
            if (requestKey.startsWith(hash)) {
                this.failedRequests.delete(requestKey);
            }
        }
        
        // Find all nodes using this hash and mark them as needing update
        if (window.app?.graph?.nodes) {
            for (const node of window.app.graph.nodes) {
                if (node.properties?.hash === hash) {
                    // Clear the node from our rendered nodes cache to force re-render
                    const nodeId = node.id || (node.properties?.hash ? 
            `${node.properties.hash}_${node.pos[0]}_${node.pos[1]}` : 
            `${node.type}_${node.pos[0]}_${node.pos[1]}`);
                    this.renderedNodes.delete(nodeId);
                    
                    // Mark the node as needing GL update
                    node.needsGLUpdate = true;
                }
            }
        }
        
        // Request a redraw
        if (this.canvas) {
            this.canvas.dirty_canvas = true;
            this.canvas.dirty_bgcanvas = true;
        }
    }
    
    /**
     * Mark a request as failed
     * @private
     */
    _markFailedRequest(requestKey) {
        if (!requestKey) return;
        
        const existing = this.failedRequests.get(requestKey);
        if (existing) {
            existing.retryCount++;
            existing.timestamp = Date.now();
        } else {
            this.failedRequests.set(requestKey, {
                timestamp: Date.now(),
                retryCount: 1
            });
        }
        
        // Periodically clean up old failed requests
        if (this.failedRequests.size > 100) {
            this._cleanupFailedRequests();
        }
    }
    
    /**
     * Clean up expired failed requests
     * @private
     */
    _cleanupFailedRequests() {
        const now = Date.now();
        for (const [key, info] of this.failedRequests) {
            if (now - info.timestamp > this.failedRequestTTL) {
                this.failedRequests.delete(key);
            }
        }
    }
}

if (typeof window !== 'undefined') {
    window.WebGLRenderer = WebGLRenderer;
} 