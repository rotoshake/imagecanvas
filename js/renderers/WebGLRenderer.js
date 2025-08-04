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
            this.uTemperature = this.gl.getUniformLocation(this.program, 'u_temperature');
            this.uTint = this.gl.getUniformLocation(this.program, 'u_tint');
            this.uCurvePoints = this.gl.getUniformLocation(this.program, 'u_curvePoints');
            this.uNumCurvePoints = this.gl.getUniformLocation(this.program, 'u_numCurvePoints');
            this.uHasToneCurve = this.gl.getUniformLocation(this.program, 'u_hasToneCurve');
            this.uOpacity = this.gl.getUniformLocation(this.program, 'u_opacity');
            
            // Color balance uniforms
            this.uShadowsColor = this.gl.getUniformLocation(this.program, 'u_shadowsColor');
            this.uShadowsLuminance = this.gl.getUniformLocation(this.program, 'u_shadowsLuminance');
            this.uMidtonesColor = this.gl.getUniformLocation(this.program, 'u_midtonesColor');
            this.uMidtonesLuminance = this.gl.getUniformLocation(this.program, 'u_midtonesLuminance');
            this.uHighlightsColor = this.gl.getUniformLocation(this.program, 'u_highlightsColor');
            this.uHighlightsLuminance = this.gl.getUniformLocation(this.program, 'u_highlightsLuminance');
            this.uHasColorBalance = this.gl.getUniformLocation(this.program, 'u_hasColorBalance');
            this.positionLoc = this.gl.getAttribLocation(this.program, 'a_position');
            this.texLoc = this.gl.getAttribLocation(this.program, 'a_texCoord');
            this.resolutionLoc = this.gl.getUniformLocation(this.program, 'u_resolution');
        } else {
            const error = new Error('WebGL shader program failed to compile');
            console.error(error);
            throw error;
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
        this.textureRequestCooldown = 100; // 100ms between requests for the same LOD
        
        // Track rendered nodes to avoid unnecessary reprocessing
        this.renderedNodes = new Map(); // nodeId -> { hash, scale, position, textureKey }
        this.framesSinceInit = 0; // Force texture requests on first few frames
        
        // Stats for debugging
        this.stats = {
            lastFrameTime: 0,
            texturesUploaded: 0,
            thumbnailsPacked: 0
        };
        
        // No more LUT texture cache needed - using parametric curves
        
        // Cached color correction rendering
        this.colorCorrectedCache = new Map(); // nodeId -> { texture, framebuffer, width, height, timestamp, hash, adjustments }
        this.activeAdjustmentNodeId = null; // Track which node is being actively adjusted
        this.maxCachedTextures = 50; // Limit cache size to prevent GPU memory exhaustion
        this.cacheMemoryUsage = 0; // Track approximate GPU memory usage
        this.maxCacheMemory = 256 * 1024 * 1024; // 256MB max for cached renders
        
        // Canvas size cache to avoid getBoundingClientRect every frame
        this._cachedCanvasRect = null;
        this._setupResizeObserver();
        
        } catch (error) {
            console.error('WebGLRenderer initialization error:', error);
            console.error('Error stack:', error.stack);
            // Clean up if initialization fails
            if (this.glCanvas && this.glCanvas.parentNode) {
                this.glCanvas.parentNode.removeChild(this.glCanvas);
            }
            this.gl = null;
            // Re-throw to prevent partial initialization
            throw error;
        }
    }

    hsvToRgb(h, s, v) {
        // Convert HSV to RGB
        // h: 0-360, s: 0-1, v: 0-1
        const c = v * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = v - c;
        
        let r, g, b;
        if (h < 60) {
            r = c; g = x; b = 0;
        } else if (h < 120) {
            r = x; g = c; b = 0;
        } else if (h < 180) {
            r = 0; g = c; b = x;
        } else if (h < 240) {
            r = 0; g = x; b = c;
        } else if (h < 300) {
            r = x; g = 0; b = c;
        } else {
            r = c; g = 0; b = x;
        }
        
        return {
            r: r + m,
            g: g + m,
            b: b + m
        };
    }
    
    /**
     * Single source of truth for converting color wheel coordinates to RGB
     * Uses NTSC vectorscope color positions
     * @private
     */
    _wheelToRGB(x, y) {
        const distance = Math.sqrt(x * x + y * y);
        if (distance === 0) return [0, 0, 0];
        
        // The ColorBalanceWheel displays colors using this transformation:
        // vectorscopeAngle = (90 - canvasAngle) % 360
        // Then it uses YUV to RGB conversion with:
        // U = sin(vectorscopeAngle) * 0.5
        // V = -cos(vectorscopeAngle) * 0.5
        
        // To get the color that the GUI is showing at position (x,y),
        // we need to replicate the exact same calculation
        const canvasAngle = Math.atan2(y, x) * 180 / Math.PI;
        let vectorscopeAngle = (90 - canvasAngle) % 360;
        if (vectorscopeAngle < 0) vectorscopeAngle += 360;
        
        // Use YUV to RGB conversion exactly as the GUI does
        const angleRad = vectorscopeAngle * Math.PI / 180;
        const U = Math.sin(angleRad) * 0.5;
        const V = -Math.cos(angleRad) * 0.5; // Note the negative, same as GUI
        
        // YUV to RGB conversion (ITU-R BT.601)
        const Y = 0.5; // Middle gray as base
        let R = Y + 1.14 * V;
        let G = Y - 0.395 * U - 0.581 * V;
        let B = Y + 2.032 * U;
        
        // Clamp to valid range
        R = Math.max(0, Math.min(1, R));
        G = Math.max(0, Math.min(1, G));
        B = Math.max(0, Math.min(1, B));
        
        // Convert to offset from neutral (0.5) and scale by distance
        const dr = (R - 0.5) * distance;
        const dg = (G - 0.5) * distance;
        const db = (B - 0.5) * distance;
        
        return [dr, dg, db];
    }
    
    /**
     * Create a framebuffer for off-screen rendering
     * @param {number} width - Width in pixels
     * @param {number} height - Height in pixels
     * @returns {Object} { framebuffer, texture } or null on error
     */
    _createFramebuffer(width, height) {
        try {
            const gl = this.gl;
            
            // Create framebuffer
            const framebuffer = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            
            // Create texture to render to
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            
            // Use RGBA format for full color accuracy
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            
            // Set texture parameters
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            
            // Attach texture to framebuffer
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            
            // Check if framebuffer is complete
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                console.error('Framebuffer not complete');
                gl.deleteTexture(texture);
                gl.deleteFramebuffer(framebuffer);
                return null;
            }
            
            // Unbind
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            
            return { framebuffer, texture };
        } catch (error) {
            console.error('Failed to create framebuffer:', error);
            return null;
        }
    }
    
    /**
     * Start tracking active adjustments for a node
     * @param {string} nodeId - The node being adjusted
     */
    startAdjustment(nodeId) {
        if (this.activeAdjustmentNodeId !== nodeId) {
            // console.log(`🎨 Starting active adjustment for node ${nodeId}`);
            this.activeAdjustmentNodeId = nodeId;
        }
    }
    
    /**
     * End tracking active adjustments for a node
     * @param {string} nodeId - The node that was being adjusted
     */
    endAdjustment(nodeId) {
        if (this.activeAdjustmentNodeId === nodeId) {
            // console.log(`✅ Ending active adjustment for node ${nodeId}`);
            this.activeAdjustmentNodeId = null;
            
            // Debounce cache invalidation to prevent loops
            if (this._endAdjustmentTimer) {
                clearTimeout(this._endAdjustmentTimer);
            }
            
            this._endAdjustmentTimer = setTimeout(() => {
                // Invalidate cache for this node to force re-render with final values
                this._invalidateCache(nodeId);
                this._endAdjustmentTimer = null;
            }, 100);
        }
    }
    
    /**
     * Check if a node has any active color corrections
     * @private
     */
    nodeHasColorCorrection(node) {
        // Check tone curve
        const hasToneCurve = node.toneCurve && node.toneCurve.controlPoints && 
                            !node.toneCurveBypassed;
        
        // Check color adjustments
        const hasAdjustments = node.adjustments && !node.colorAdjustmentsBypassed && (
            node.adjustments.brightness !== 0 || 
            node.adjustments.contrast !== 0 || 
            node.adjustments.saturation !== 0 || 
            node.adjustments.hue !== 0
        );
        
        // Check color balance
        const hasColorBalance = node.colorBalance && !node.colorBalanceBypassed;
        
        return hasToneCurve || hasAdjustments || hasColorBalance;
    }
    
    /**
     * Generate unique cache key for a node's current state
     * @private
     */
    _getCacheKey(node) {
        // Include all color correction properties in the key
        const parts = [
            node.id,
            // Tone curve
            node.toneCurve ? JSON.stringify(node.toneCurve) : 'none',
            node.toneCurveBypassed ? 'tc-bypass' : 'tc-active',
            // Adjustments
            node.adjustments ? JSON.stringify(node.adjustments) : 'none',
            node.colorAdjustmentsBypassed ? 'adj-bypass' : 'adj-active',
            // Color balance
            node.colorBalance ? JSON.stringify(node.colorBalance) : 'none',
            node.colorBalanceBypassed ? 'cb-bypass' : 'cb-active',
            // Size (for resolution changes)
            Math.round(node.size[0]),
            Math.round(node.size[1])
        ];
        
        return parts.join('|');
    }
    
    /**
     * Invalidate cached render for a specific node
     * @param {string} nodeId - The node to invalidate
     */
    _invalidateCache(nodeId) {
        // Need to invalidate all LOD levels for this node
        const keysToDelete = [];
        
        // Find all cache entries for this node (all LOD levels)
        for (const [key, cached] of this.colorCorrectedCache) {
            if (key.startsWith(`${nodeId}_LOD:`)) {
                keysToDelete.push(key);
                
                // Clean up GPU resources
                if (cached.texture) {
                    this.gl.deleteTexture(cached.texture);
                }
                if (cached.framebuffer) {
                    this.gl.deleteFramebuffer(cached.framebuffer);
                }
                
                // Update memory tracking
                const memSize = cached.width * cached.height * 4; // RGBA
                this.cacheMemoryUsage -= memSize;
            }
        }
        
        // Remove all entries for this node
        for (const key of keysToDelete) {
            this.colorCorrectedCache.delete(key);
        }
        
        if (keysToDelete.length > 0 && window.DEBUG_LOD_STATUS) {
            console.log(`🗑️ Invalidated ${keysToDelete.length} cached LOD levels for node ${nodeId}`);
        }
    }
    
    /**
     * Check if a node's cached render is still valid
     * @param {Object} node - The node to check
     * @param {Object} cached - The cached data
     * @param {WebGLTexture} currentSourceTexture - The current source texture
     * @param {number} currentLOD - The current LOD level
     * @returns {boolean} True if cache is valid
     */
    _isCacheValid(node, cached, currentSourceTexture, currentLOD) {
        // Check if source texture hash changed
        if (node.properties?.hash !== cached.hash) {
            return false;
        }
        
        // Check if source texture or LOD changed
        if (cached.sourceTexture !== currentSourceTexture || cached.lodLevel !== currentLOD) {
            if (window.DEBUG_LOD_STATUS) {
                console.log(`🔄 Cache invalid for node ${node.id}: LOD changed from ${cached.lodLevel} to ${currentLOD}`);
            }
            return false;
        }
        
        // Check if adjustments changed
        const adj = node.adjustments || {};
        const cachedAdj = cached.adjustments || {};
        
        if (adj.brightness !== cachedAdj.brightness ||
            adj.contrast !== cachedAdj.contrast ||
            adj.saturation !== cachedAdj.saturation ||
            adj.hue !== cachedAdj.hue) {
            return false;
        }
        
        // Check tone curve
        if (node.toneCurve?.timestamp !== cached.toneCurveTimestamp) {
            return false;
        }
        
        // Check color balance
        if (node.colorBalance && cached.colorBalance) {
            const cb = node.colorBalance;
            const cachedCb = cached.colorBalance;
            
            // Simple deep comparison for color balance
            const changed = JSON.stringify(cb) !== JSON.stringify(cachedCb);
            if (changed) return false;
        } else if (node.colorBalance !== cached.colorBalance) {
            return false;
        }
        
        // Check bypass flags
        if (node.toneCurveBypassed !== cached.toneCurveBypassed ||
            node.colorAdjustmentsBypassed !== cached.colorAdjustmentsBypassed) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Render a node to a texture for caching
     * @param {Object} node - The node to render
     * @param {WebGLTexture} sourceTexture - The source texture
     * @param {number} width - Target width
     * @param {number} height - Target height
     * @returns {Object} { texture, framebuffer } or null on error
     */
    _renderToTexture(node, sourceTexture, width, height) {
        if (!this.gl || !sourceTexture) return null;
        
        // Create or reuse framebuffer
        const fb = this._createFramebuffer(width, height);
        if (!fb) return null;
        
        const gl = this.gl;
        
        // Save current state
        const prevViewport = gl.getParameter(gl.VIEWPORT);
        const prevFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        
        try {
            // Bind framebuffer
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb.framebuffer);
            gl.viewport(0, 0, width, height);
            
            // Clear to transparent
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            
            // Set up rendering
            gl.useProgram(this.program);
            gl.uniform2f(this.resolutionLoc, width, height);
            
            // Simple fullscreen quad
            const verts = new Float32Array([
                0, 0,
                width, 0,
                0, height,
                width, height
            ]);
            
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(this.positionLoc);
            gl.vertexAttribPointer(this.positionLoc, 2, gl.FLOAT, false, 0, 0);
            
            // Texture coordinates - flip Y when rendering to framebuffer
            // This compensates for the Y-flip in the vertex shader
            const flippedTexCoords = new Float32Array([
                0, 1,   // 0,0 -> 0,1
                1, 1,   // 1,0 -> 1,1
                0, 0,   // 0,1 -> 0,0  
                1, 0    // 1,1 -> 1,0
            ]);
            
            gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, flippedTexCoords, gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(this.texLoc);
            gl.vertexAttribPointer(this.texLoc, 2, gl.FLOAT, false, 0, 0);
            
            // Bind source texture
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
            
            // Apply color corrections
            this._applyNodeUniforms(node);
            
            // Draw
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
            
            // Restore state
            gl.bindFramebuffer(gl.FRAMEBUFFER, prevFramebuffer);
            gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
            
            // Restore normal texture coordinates
            gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                0, 0,  1, 0,  0, 1,  1, 1
            ]), gl.STATIC_DRAW);
            
            return fb;
        } catch (error) {
            console.error('Error rendering to texture:', error);
            // Clean up on error
            gl.deleteTexture(fb.texture);
            gl.deleteFramebuffer(fb.framebuffer);
            return null;
        }
    }
    
    /**
     * Apply node uniforms for color corrections
     * @private
     */
    _applyNodeUniforms(node) {
        const gl = this.gl;
        
        // Send adjustment uniforms with validation (check bypass flag)
        // If using cached texture, set all adjustments to 0 since they're already applied
        let brightness = 0, contrast = 0, saturation = 0, hue = 0, temperature = 0, tint = 0;
        
        if (typeof usingCachedTexture === 'undefined' || !usingCachedTexture) {
            const bypassed = node.colorAdjustmentsBypassed;
            const adj = (!bypassed && node.adjustments) ? node.adjustments : {brightness:0,contrast:0,saturation:0,hue:0,temperature:0,tint:0};
            brightness = bypassed ? 0 : (isNaN(adj.brightness) ? 0 : (adj.brightness || 0));
            contrast = bypassed ? 0 : (isNaN(adj.contrast) ? 0 : (adj.contrast || 0));
            saturation = bypassed ? 0 : (isNaN(adj.saturation) ? 0 : (adj.saturation || 0));
            hue = bypassed ? 0 : (isNaN(adj.hue) ? 0 : (adj.hue || 0));
            temperature = bypassed ? 0 : (isNaN(adj.temperature) ? 0 : (adj.temperature || 0));
            tint = bypassed ? 0 : (isNaN(adj.tint) ? 0 : (adj.tint || 0));
        }
        
        gl.uniform1f(this.uBrightness, brightness);
        gl.uniform1f(this.uContrast, contrast);
        gl.uniform1f(this.uSaturation, saturation);
        gl.uniform1f(this.uHue, hue);
        gl.uniform1f(this.uTemperature, temperature);
        gl.uniform1f(this.uTint, tint);
        
        // Opacity always 1.0 for cached renders
        gl.uniform1f(this.uOpacity, 1.0);
        
        // Handle tone curve control points
        if (node.toneCurve && node.toneCurve.controlPoints && !node.toneCurveBypassed) {
            const points = node.toneCurve.controlPoints;
            const numPoints = Math.min(points.length, 8); // Max 8 points
            
            // Convert control points to flat array for uniform
            const pointsArray = new Float32Array(16); // 8 points * 2 components
            for (let i = 0; i < numPoints; i++) {
                pointsArray[i * 2] = points[i].x;
                pointsArray[i * 2 + 1] = points[i].y;
            }
            
            gl.uniform2fv(this.uCurvePoints, pointsArray);
            gl.uniform1i(this.uNumCurvePoints, numPoints);
            gl.uniform1f(this.uHasToneCurve, 1.0);
        } else {
            // Disable tone curve
            gl.uniform1f(this.uHasToneCurve, 0.0);
        }
        
        // Handle color balance
        if (node.colorBalance && !node.colorBalanceBypassed) {
            const cb = node.colorBalance;
            
            // Use centralized color wheel to RGB conversion
            const shadowsRGB = this._wheelToRGB(cb.shadows.x, cb.shadows.y);
            // Invert midtones because gamma = 1.0 - delta in shader
            const midtonesRGB = this._wheelToRGB(-cb.midtones.x, -cb.midtones.y);
            const highlightsRGB = this._wheelToRGB(cb.highlights.x, cb.highlights.y);
            
            // Pass colors directly - shader handles the multipliers
            gl.uniform3fv(this.uShadowsColor, shadowsRGB);
            gl.uniform1f(this.uShadowsLuminance, cb.shadows.luminance);
            
            gl.uniform3fv(this.uMidtonesColor, midtonesRGB);
            gl.uniform1f(this.uMidtonesLuminance, cb.midtones.luminance);
            
            gl.uniform3fv(this.uHighlightsColor, highlightsRGB);
            gl.uniform1f(this.uHighlightsLuminance, cb.highlights.luminance);
            
            gl.uniform1f(this.uHasColorBalance, 1.0);
        } else {
            // Disable color balance
            gl.uniform1f(this.uHasColorBalance, 0.0);
        }
    }
    
    /**
     * Get or create cached render for a node
     * @param {Object} node - The node to get cached render for
     * @param {WebGLTexture} sourceTexture - The source texture
     * @param {number} currentLOD - The current LOD level being used
     * @returns {WebGLTexture|null} Cached texture or null
     */
    _getCachedOrRender(node, sourceTexture, currentLOD) {
        const nodeId = node.id || `${node.type}_${node.pos[0]}_${node.pos[1]}`;
        
        // Check if this is the actively adjusted node
        if (nodeId === this.activeAdjustmentNodeId) {
            // Don't use cache for actively adjusted node
            return null;
        }
        
        // Check if we have any color corrections
        const hasColorCorrections = 
            (node.adjustments && !node.colorAdjustmentsBypassed && (
                node.adjustments.brightness !== 0 ||
                node.adjustments.contrast !== 0 ||
                node.adjustments.saturation !== 0 ||
                node.adjustments.hue !== 0
            )) ||
            (node.toneCurve && !node.toneCurveBypassed) ||
            (node.colorBalance && !node.colorBalanceBypassed);
        
        if (!hasColorCorrections) {
            // No corrections, no need for cache
            return null;
        }
        
        // Use a composite cache key that includes the LOD level
        const cacheKey = `${nodeId}_LOD:${currentLOD}`;
        
        // Check cache
        const cached = this.colorCorrectedCache.get(cacheKey);
        
        if (cached && this._isCacheValid(node, cached, sourceTexture, currentLOD)) {
            // Valid cache hit
            if (window.DEBUG_LOD_STATUS) {
                console.log(`✅ Cache hit for ${cacheKey}`);
            }
            return cached.texture;
        } else if (cached && window.DEBUG_LOD_STATUS) {
            console.log(`❌ Cache invalid for ${cacheKey} - will re-render`);
        }
        
        // Need to render to cache
        // Use the same resolution as what the LOD system determined
        let width, height;
        if (currentLOD === null) {
            // Full resolution - use actual image dimensions
            width = node.originalWidth || node.img?.naturalWidth || 2048;
            height = node.originalHeight || node.img?.naturalHeight || 2048;
        } else {
            // LOD texture - use LOD dimensions with proper aspect ratio
            const originalWidth = node.originalWidth || node.img?.naturalWidth || currentLOD;
            const originalHeight = node.originalHeight || node.img?.naturalHeight || currentLOD;
            const aspectRatio = originalWidth / originalHeight;
            
            if (aspectRatio >= 1) {
                // Landscape or square
                width = currentLOD;
                height = Math.round(currentLOD / aspectRatio);
            } else {
                // Portrait  
                height = currentLOD;
                width = Math.round(currentLOD * aspectRatio);
            }
        }
        
        if (window.DEBUG_LOD_STATUS) {
            console.log(`🎯 Caching color correction: ${width}x${height} (LOD: ${currentLOD === null ? 'full' : currentLOD + 'px'})`);
        }
        
        // Check memory limits
        const requiredMemory = width * height * 4;
        if (this.cacheMemoryUsage + requiredMemory > this.maxCacheMemory) {
            this._evictOldestCache();
        }
        
        // Render to texture
        const result = this._renderToTexture(node, sourceTexture, width, height);
        if (!result) return null;
        
        // Store in cache
        const cacheData = {
            texture: result.texture,
            framebuffer: result.framebuffer,
            width: width,
            height: height,
            timestamp: Date.now(),
            hash: node.properties?.hash,
            sourceTexture: sourceTexture,  // Store the source texture reference
            lodLevel: currentLOD,  // Store the LOD level used
            adjustments: node.adjustments ? {...node.adjustments} : {},
            toneCurveTimestamp: node.toneCurve?.timestamp,
            colorBalance: node.colorBalance ? JSON.parse(JSON.stringify(node.colorBalance)) : null,
            toneCurveBypassed: node.toneCurveBypassed,
            colorAdjustmentsBypassed: node.colorAdjustmentsBypassed,
            colorBalanceBypassed: node.colorBalanceBypassed
        };
        
        this.colorCorrectedCache.set(cacheKey, cacheData);
        this.cacheMemoryUsage += requiredMemory;
        
        if (window.DEBUG_LOD_STATUS) {
            console.log(`✅ Cached color-corrected render for node ${nodeId} at LOD ${currentLOD} (key: ${cacheKey})`);
        }
        
        return result.texture;
    }
    
    /**
     * Evict oldest cache entry when memory limit is reached
     * @private
     */
    _evictOldestCache() {
        let oldestTime = Infinity;
        let oldestKey = null;
        
        // Find oldest entry
        for (const [key, data] of this.colorCorrectedCache) {
            if (data.timestamp < oldestTime) {
                oldestTime = data.timestamp;
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            const cached = this.colorCorrectedCache.get(oldestKey);
            if (cached) {
                // Clean up GPU resources
                if (cached.texture) {
                    this.gl.deleteTexture(cached.texture);
                }
                if (cached.framebuffer) {
                    this.gl.deleteFramebuffer(cached.framebuffer);
                }
                
                // Update memory tracking
                const memSize = cached.width * cached.height * 4; // RGBA
                this.cacheMemoryUsage -= memSize;
                
                // Remove from cache
                this.colorCorrectedCache.delete(oldestKey);
                
                if (window.DEBUG_LOD_STATUS) {
                    console.log(`🗑️ Evicted oldest cache entry: ${oldestKey}`);
                }
            }
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
            uniform float u_temperature;
            uniform float u_tint;
            uniform vec2 u_curvePoints[8]; // Up to 8 control points (x,y pairs)
            uniform int u_numCurvePoints;
            uniform float u_hasToneCurve;
            uniform float u_opacity;
            
            // Color balance uniforms
            uniform vec3 u_shadowsColor;
            uniform float u_shadowsLuminance;
            uniform vec3 u_midtonesColor;
            uniform float u_midtonesLuminance;
            uniform vec3 u_highlightsColor;
            uniform float u_highlightsLuminance;
            uniform float u_hasColorBalance;

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

            float evaluateCurve(float x) {
                if (u_numCurvePoints < 2) return x;
                
                // Clamp input to [0,1]
                x = clamp(x, 0.0, 1.0);
                
                // Manually unrolled loop to avoid dynamic indexing
                if (u_numCurvePoints >= 2 && x <= u_curvePoints[1].x) {
                    float t = (x - u_curvePoints[0].x) / (u_curvePoints[1].x - u_curvePoints[0].x);
                    return mix(u_curvePoints[0].y, u_curvePoints[1].y, t);
                }
                if (u_numCurvePoints >= 3 && x <= u_curvePoints[2].x) {
                    float t = (x - u_curvePoints[1].x) / (u_curvePoints[2].x - u_curvePoints[1].x);
                    return mix(u_curvePoints[1].y, u_curvePoints[2].y, t);
                }
                if (u_numCurvePoints >= 4 && x <= u_curvePoints[3].x) {
                    float t = (x - u_curvePoints[2].x) / (u_curvePoints[3].x - u_curvePoints[2].x);
                    return mix(u_curvePoints[2].y, u_curvePoints[3].y, t);
                }
                if (u_numCurvePoints >= 5 && x <= u_curvePoints[4].x) {
                    float t = (x - u_curvePoints[3].x) / (u_curvePoints[4].x - u_curvePoints[3].x);
                    return mix(u_curvePoints[3].y, u_curvePoints[4].y, t);
                }
                if (u_numCurvePoints >= 6 && x <= u_curvePoints[5].x) {
                    float t = (x - u_curvePoints[4].x) / (u_curvePoints[5].x - u_curvePoints[4].x);
                    return mix(u_curvePoints[4].y, u_curvePoints[5].y, t);
                }
                if (u_numCurvePoints >= 7 && x <= u_curvePoints[6].x) {
                    float t = (x - u_curvePoints[5].x) / (u_curvePoints[6].x - u_curvePoints[5].x);
                    return mix(u_curvePoints[5].y, u_curvePoints[6].y, t);
                }
                if (u_numCurvePoints >= 8) {
                    float t = (x - u_curvePoints[6].x) / (u_curvePoints[7].x - u_curvePoints[6].x);
                    return mix(u_curvePoints[6].y, u_curvePoints[7].y, t);
                }
                
                // Fallback to last point
                if (u_numCurvePoints >= 8) return u_curvePoints[7].y;
                if (u_numCurvePoints >= 7) return u_curvePoints[6].y;
                if (u_numCurvePoints >= 6) return u_curvePoints[5].y;
                if (u_numCurvePoints >= 5) return u_curvePoints[4].y;
                if (u_numCurvePoints >= 4) return u_curvePoints[3].y;
                if (u_numCurvePoints >= 3) return u_curvePoints[2].y;
                return u_curvePoints[1].y;
            }
            
            vec3 applyToneCurve(vec3 color) {
                if (u_hasToneCurve > 0.5) {
                    // Apply curve to each channel
                    return vec3(
                        evaluateCurve(color.r),
                        evaluateCurve(color.g),
                        evaluateCurve(color.b)
                    );
                }
                return color;
            }
            
            // Professional LGG color correction with luminance preservation
            vec3 applyLiftGammaGain(vec3 color, vec3 lift, vec3 gamma, vec3 gain) {
                // Store original luminance
                float originalLuma = dot(color, vec3(0.299, 0.587, 0.114));
                
                // Step 1: Lift - Soft shadow offset
                // lifted = in + L * (1 - in)
                vec3 lifted = color + lift * (1.0 - color);
                
                // Step 2: Gamma - Power curve for midtones
                // gamma_corrected = lifted^(1/G)
                vec3 gammaCorrect = pow(max(lifted, vec3(0.0)), 1.0 / gamma);
                
                // Step 3: Gain - Soft highlight multiplier
                // final = gamma_corrected * M
                vec3 final = gammaCorrect * gain;
                
                // Luminance preservation for lift and gain
                // Calculate how much the luminance changed
                float newLuma = dot(final, vec3(0.299, 0.587, 0.114));
                
                // Blend between full effect and luminance-preserved based on color adjustment strength
                // This preserves luminance more when making strong color shifts
                float colorShift = length(lift - vec3(lift.r + lift.g + lift.b) / 3.0) + 
                                  length(gain - vec3(gain.r + gain.g + gain.b) / 3.0);
                float preserveAmount = smoothstep(0.0, 2.0, colorShift) * 0.7; // Up to 70% preservation
                
                if (newLuma > 0.001) {
                    float lumaCorrection = mix(1.0, originalLuma / newLuma, preserveAmount);
                    final *= lumaCorrection;
                }
                
                return final;
            }
            
            vec3 applyColorBalance(vec3 color) {
                if (u_hasColorBalance < 0.5) return color;
                
                // Convert color wheel positions to lift/gain offsets per channel
                // Shadows affect lift, highlights affect gain
                vec3 lift = u_shadowsColor * 2.0; // 2x stronger
                vec3 gain = vec3(1.0) + u_highlightsColor * 2.0; // 2x stronger
                // Clamp gain to prevent excessive blowouts
                gain = clamp(gain, vec3(0.0), vec3(4.0));
                
                // Midtones color affects gamma per channel
                vec3 gammaDelta = u_midtonesColor * 2.5; // Strong effect
                
                // Apply soft limiting using smoothstep for each channel
                vec3 gamma = vec3(1.0);
                for (int i = 0; i < 3; i++) {
                    float delta = i == 0 ? gammaDelta.r : (i == 1 ? gammaDelta.g : gammaDelta.b);
                    // Soft limit: full effect up to 1.0, then gradually reduce
                    if (abs(delta) > 1.0) {
                        float excess = abs(delta) - 1.0;
                        float softLimit = 1.0 + excess * 0.2; // Reduce excess by 80%
                        delta = sign(delta) * softLimit;
                    }
                    if (i == 0) gamma.r = 1.0 - delta;
                    else if (i == 1) gamma.g = 1.0 - delta;
                    else gamma.b = 1.0 - delta;
                }
                
                // Final safety clamp
                gamma = clamp(gamma, vec3(0.3), vec3(3.0));
                
                // Convert luminance values to LGG parameters
                // Lift: -0.5 to +0.5 range (darker to lighter shadows)
                float liftLum = (u_shadowsLuminance - 0.5);
                lift += vec3(liftLum);
                
                // Gamma: 0.5 to 2.0 range (darker to lighter midtones)
                float gammaLum = pow(2.0, (u_midtonesLuminance - 0.5) * 2.0);
                gamma *= gammaLum;
                
                // Gain: 0.5 to 1.5 range (darker to lighter highlights)
                float gainLum = 0.5 + u_highlightsLuminance;
                gain *= gainLum;
                
                return applyLiftGammaGain(color, lift, gamma, gain);
            }

            void main() {
                vec4 color = texture2D(u_image, v_texCoord);
                
                // Apply tone curve first (before other adjustments)
                color.rgb = applyToneCurve(color.rgb);
                
                // Apply color balance (before basic adjustments)
                color.rgb = applyColorBalance(color.rgb);
                
                // brightness
                color.rgb += u_brightness;
                // contrast  (simple linear)
                color.rgb = (color.rgb - 0.5) * (1.0 + u_contrast) + 0.5;
                // saturation & hue via HSV
                vec3 hsv = rgb2hsv(color.rgb);
                hsv.y *= (1.0 + u_saturation);
                hsv.x += u_hue / 360.0;
                color.rgb = hsv2rgb(hsv);
                
                // Temperature adjustment (warm/cool)
                // Positive values make warmer (more orange), negative make cooler (more blue)
                if (u_temperature != 0.0) {
                    float temp = u_temperature;
                    color.r += temp * 0.1;
                    color.b -= temp * 0.1;
                }
                
                // Tint adjustment (magenta/green)
                // Positive values add magenta, negative add green
                if (u_tint != 0.0) {
                    float tint = u_tint;
                    color.r += tint * 0.05;
                    color.g -= tint * 0.1;
                    color.b += tint * 0.05;
                }
                
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
        if (!this.frameBudget) {
            this.frameBudget = {
                startTime: 0,
                textureUploads: 8,
                atlasPacking: 2
            };
        }
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
        
        // Schedule texture uploads using requestIdleCallback for better performance
        if (this.lodManager && !this._processingUploads) {
            this._processingUploads = true;
            
            // Use requestIdleCallback if available, otherwise fall back to setTimeout
            const scheduleUpload = () => {
                if ('requestIdleCallback' in window) {
                    requestIdleCallback((deadline) => {
                        // Only process uploads if we have idle time
                        if (deadline.timeRemaining() > 2) {
                            this.lodManager.processUploads().then(uploaded => {
                                this.stats.texturesUploaded = uploaded;
                                this._processingUploads = false;
                                // Request redraw if textures were uploaded
                                if (uploaded > 0 && this.canvas && !this.canvas.dirty_canvas) {
                                    this.canvas.dirty_canvas = true;
                                }
                            }).catch(error => {
                                console.error('Error processing texture uploads:', error);
                                this._processingUploads = false;
                            });
                        } else {
                            // Not enough idle time, reschedule
                            this._processingUploads = false;
                        }
                    }, { timeout: 100 });
                } else {
                    // Fallback for browsers without requestIdleCallback
                    setTimeout(() => {
                        this.lodManager.processUploads().then(uploaded => {
                            this.stats.texturesUploaded = uploaded;
                            this._processingUploads = false;
                            if (uploaded > 0 && this.canvas && !this.canvas.dirty_canvas) {
                                this.canvas.dirty_canvas = true;
                            }
                        }).catch(error => {
                            console.error('Error processing texture uploads:', error);
                            this._processingUploads = false;
                        });
                    }, 16); // Next frame
                }
            };
            
            scheduleUpload();
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
        if (!this.textureRequests) {
            this.textureRequests = new Map();
        }
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
        
        
        // Track what's being rendered on the node
        if (node.setLastRenderedResolution) {
            // Use the render info we tracked in drawNode
            if (node._currentRenderInfo) {
                const info = node._currentRenderInfo;
                const lodLabel = info.lodSize === null ? 'full' : `${info.lodSize}px`;
                node.setLastRenderedResolution(
                    info.actualWidth || 0,
                    info.actualHeight || 0,
                    lodLabel
                );
                
                // Notify properties panel of the change
                if (window.propertiesInspector && window.propertiesInspector.isVisible) {
                    window.propertiesInspector.scheduleNavigationUpdate();
                }
            } else if (node.properties?.hash && this.lodManager) {
                // Fallback: try to find in LOD cache
                const nodeCache = this.lodManager.textureCache.get(node.properties.hash);
                if (nodeCache) {
                    // Find which texture is being used
                    let found = false;
                    for (const [lodSize, textureData] of nodeCache) {
                        if (textureData.texture === texture) {
                            const size = lodSize || 'full';
                            node.setLastRenderedResolution(
                                textureData.width, 
                                textureData.height, 
                                size === 'full' ? 'full' : `${size}px`
                            );
                            found = true;
                            
                            // Notify properties panel of the change
                            if (window.propertiesInspector && window.propertiesInspector.isVisible) {
                                window.propertiesInspector.scheduleNavigationUpdate();
                            }
                            break;
                        }
                    }
                    if (!found) {
                        // Check if this is the full resolution image texture
                        if (node.img && this.textureCache.has(node.img)) {
                            const imgTexture = this.textureCache.get(node.img);
                            if (imgTexture === texture) {
                                node.setLastRenderedResolution(
                                    node.img.naturalWidth,
                                    node.img.naturalHeight,
                                    'full'
                                );
                                
                                // Notify properties panel of the change
                                if (window.propertiesInspector && window.propertiesInspector.isVisible) {
                                    window.propertiesInspector.scheduleNavigationUpdate();
                                }
                            }
                        }
                    }
                }
            } else if (texture.source) {
                // Fallback for video nodes
                const source = texture.source;
                if (source instanceof HTMLVideoElement) {
                    node.setLastRenderedResolution(source.videoWidth, source.videoHeight, 'video');
                }
            }
        }
        
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
        // If using cached texture, set all adjustments to 0 since they're already applied
        let brightness = 0, contrast = 0, saturation = 0, hue = 0, temperature = 0, tint = 0;
        
        if (typeof usingCachedTexture === 'undefined' || !usingCachedTexture) {
            const bypassed = node.colorAdjustmentsBypassed;
            const adj = (!bypassed && node.adjustments) ? node.adjustments : {brightness:0,contrast:0,saturation:0,hue:0,temperature:0,tint:0};
            brightness = bypassed ? 0 : (isNaN(adj.brightness) ? 0 : (adj.brightness || 0));
            contrast = bypassed ? 0 : (isNaN(adj.contrast) ? 0 : (adj.contrast || 0));
            saturation = bypassed ? 0 : (isNaN(adj.saturation) ? 0 : (adj.saturation || 0));
            hue = bypassed ? 0 : (isNaN(adj.hue) ? 0 : (adj.hue || 0));
            temperature = bypassed ? 0 : (isNaN(adj.temperature) ? 0 : (adj.temperature || 0));
            tint = bypassed ? 0 : (isNaN(adj.tint) ? 0 : (adj.tint || 0));
        }
        
        this.gl.uniform1f(this.uBrightness, brightness);
        this.gl.uniform1f(this.uContrast, contrast);
        this.gl.uniform1f(this.uSaturation, saturation);
        this.gl.uniform1f(this.uHue, hue);
        this.gl.uniform1f(this.uTemperature, temperature);
        this.gl.uniform1f(this.uTint, tint);
        
        if (window.DEBUG_LOD_STATUS && node.type === 'media/video' && (brightness !== 0 || contrast !== 0 || saturation !== 0 || hue !== 0 || temperature !== 0 || tint !== 0)) {
            console.log(`🎨 Video color adjustments - B:${brightness} C:${contrast} S:${saturation} H:${hue} T:${temperature} Ti:${tint}`);
        }
        
        // Get opacity from gallery view manager if in gallery mode
        let opacity = 1.0;
        if (window.app?.galleryViewManager && window.app.galleryViewManager.active) {
            opacity = window.app.galleryViewManager.getNodeOpacity(node);
        }
        this.gl.uniform1f(this.uOpacity, opacity);
        
        // Skip all color corrections if using cached texture (already has corrections applied)
        if (typeof usingCachedTexture !== 'undefined' && usingCachedTexture) {
            // Disable all color corrections in shader
            this.gl.uniform1f(this.uHasToneCurve, 0.0);
            this.gl.uniform1f(this.uHasColorBalance, 0.0);
        } else {
            // Handle tone curve control points
        if (node.toneCurve && node.toneCurve.controlPoints && !node.toneCurveBypassed) {
            const points = node.toneCurve.controlPoints;
            const numPoints = Math.min(points.length, 8); // Max 8 points
            
            // Convert control points to flat array for uniform
            const pointsArray = new Float32Array(16); // 8 points * 2 components
            for (let i = 0; i < numPoints; i++) {
                pointsArray[i * 2] = points[i].x;
                pointsArray[i * 2 + 1] = points[i].y;
            }
            
            this.gl.uniform2fv(this.uCurvePoints, pointsArray);
            this.gl.uniform1i(this.uNumCurvePoints, numPoints);
            this.gl.uniform1f(this.uHasToneCurve, 1.0);
        } else {
            // Disable tone curve
            this.gl.uniform1f(this.uHasToneCurve, 0.0);
        }
        
        // Handle color balance
        if (node.colorBalance && !node.colorBalanceBypassed) {
            const cb = node.colorBalance;
            
            // Use centralized color wheel to RGB conversion
            const shadowsRGB = this._wheelToRGB(cb.shadows.x, cb.shadows.y);
            // Invert midtones because gamma = 1.0 - delta in shader
            const midtonesRGB = this._wheelToRGB(-cb.midtones.x, -cb.midtones.y);
            const highlightsRGB = this._wheelToRGB(cb.highlights.x, cb.highlights.y);
            
            // Pass colors directly (no additional multiplier needed here)
            this.gl.uniform3fv(this.uShadowsColor, shadowsRGB);
            this.gl.uniform1f(this.uShadowsLuminance, cb.shadows.luminance);
            
            this.gl.uniform3fv(this.uMidtonesColor, midtonesRGB);
            this.gl.uniform1f(this.uMidtonesLuminance, cb.midtones.luminance);
            
            this.gl.uniform3fv(this.uHighlightsColor, highlightsRGB);
            this.gl.uniform1f(this.uHighlightsLuminance, cb.highlights.luminance);
            
            this.gl.uniform1f(this.uHasColorBalance, 1.0);
        } else {
            // Disable color balance
            this.gl.uniform1f(this.uHasColorBalance, 0.0);
        }
        } // Close the else block for usingCachedTexture check

        // Draw
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

        // Clean up texture bindings after draw
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);

        // Return true to indicate we successfully rendered the node
        return true;
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
        
        // Periodically clean up textures for non-visible nodes (every 300 frames = 5 seconds)
        if (this.framesSinceInit % 300 === 0 && this.lodManager && this.canvas) {
            // Get visible nodes from viewport with larger margin to keep nearby nodes loaded
            const visibleNodes = this.canvas.viewport.getVisibleNodes(
                this.canvas.graph.nodes,
                800 // much larger margin to keep nearby nodes loaded
            );
            
            // Clear high zoom tracking and rebuild
            this.lodManager.clearHighZoomNodes();
            
            // Build set of visible hashes and track high zoom nodes
            const visibleHashes = new Set();
            const vp = this.canvas.viewport;
            
            for (const node of visibleNodes) {
                if (node.properties?.hash) {
                    visibleHashes.add(node.properties.hash);
                    
                    // Check if this node needs full resolution
                    const screenWidth = node.size[0] * vp.scale;
                    const screenHeight = node.size[1] * vp.scale;
                    const screenSize = Math.max(screenWidth, screenHeight);
                    
                    // Mark as high zoom if it needs full resolution (>1400px on screen)
                    if (screenSize > 1400) {
                        this.lodManager.markHighZoomNode(node.properties.hash);
                    }
                }
            }
            
            // Unload high-res textures for non-visible nodes
            // Use aggressive mode only if memory is really high
            const memoryPressure = this.lodManager.totalMemory > 600 * 1024 * 1024; // > 600MB (was 350MB)
            this.lodManager.unloadNonVisibleHighRes(visibleHashes, 512, memoryPressure); // Keep up to 512px (was 256px)
            
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
        if (node.adjustments || (node.toneCurve && node.toneCurve.controlPoints)) {
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

        // Skip early exit optimization if node has active adjustments or tone curve
        const hasActiveAdjustments = node.adjustments && (
            node.adjustments.brightness !== 0 || 
            node.adjustments.contrast !== 0 || 
            node.adjustments.saturation !== 0 || 
            node.adjustments.hue !== 0
        );
        
        const hasActiveToneCurve = node.toneCurve && node.toneCurve.controlPoints && !node.toneCurveBypassed;
        
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
        
        if (!hasActiveAdjustments && !hasActiveToneCurve && !node.needsGLUpdate && this.framesSinceInit > 5) {
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
                if (node.type === 'media/video' && node.video && node.video.readyState >= 2) {
                    // For video nodes, use the video element directly
                    const texture = this._ensureTexture(node.video);
                    return this._renderWithTexture(ctx2d, node, texture);
                } else if (this.lodManager && node.properties?.hash) {
                    const screenWidth = node.size[0] * vp.scale;
                    const screenHeight = node.size[1] * vp.scale;
                    const screenSize = Math.max(screenWidth, screenHeight);
                    
                    // For high DPI displays, use full DPR to get actual pixel count
                    const effectiveScreenSize = screenSize * (vp.dpr || 1);
                    
                    const texture = this.lodManager.getBestTexture(
                        node.properties.hash, 
                        effectiveScreenSize,
                        effectiveScreenSize
                    );
                    
                    
                    if (texture) {
                        // Check if we should request a better texture even though nothing else changed
                        // Check LOD cache first
                        const cachedLODInfo = this.lodCache.get(nodeId);
                        const now = Date.now();
                        
                        let optimalLOD;
                        if (cachedLODInfo && Math.abs(cachedLODInfo.screenSize - effectiveScreenSize) < effectiveScreenSize * 0.05 && 
                            now - cachedLODInfo.lastUpdate < 5000) {
                            optimalLOD = cachedLODInfo.optimalLOD;
                        } else {
                            optimalLOD = this.lodManager.getOptimalLOD(effectiveScreenSize, effectiveScreenSize);
                            // Update cache
                            this.lodCache.set(nodeId, {
                                screenSize: effectiveScreenSize,
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
                    }
                    // No texture available in early exit path - don't request one
                    // This prevents the evict->request cycle for unchanged nodes
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
        
        // Calculate screen size for LOD selection
        // node.size = size of the node in graph coordinates
        // vp.scale = zoom level (e.g., 2.0 = 200% zoom)
        // Result: how many pixels the node takes up on screen (before DPR)
        const screenWidth = node.size[0] * vp.scale;
        const screenHeight = node.size[1] * vp.scale;
        const screenSize = Math.max(screenWidth, screenHeight);
        
        // DEBUG: Log LOD calculation details on page load
        if (window.DEBUG_LOD_STATUS) {
            console.log(`🔍 LOD calc for ${node.id}: node=${node.size[0]}x${node.size[1]}, scale=${vp.scale.toFixed(2)}x, screen=${Math.round(screenWidth)}x${Math.round(screenHeight)}, size=${Math.round(screenSize)}`);
        }
        
        // For high DPI displays, we need to consider the full DPR to get the actual pixel count
        // This ensures we load high enough resolution textures for retina displays
        const effectiveScreenSize = screenSize * dpr;
        
        // Check LOD cache to avoid repeated calculations
        const cachedLOD = this.lodCache.get(nodeId);
        const now = Date.now();
        
        // Hysteresis for LOD switching to prevent flickering
        const HYSTERESIS_FACTOR = 0.1; // 10% change required to switch LOD
        let optimalLOD = null;
        
        if (cachedLOD) {
            // Check if screen size changed significantly
            const sizeChange = Math.abs(cachedLOD.screenSize - effectiveScreenSize) / cachedLOD.screenSize;
            
            if (sizeChange < HYSTERESIS_FACTOR && now - cachedLOD.lastUpdate < 5000) {
                // Keep using cached LOD - no significant change
                optimalLOD = cachedLOD.optimalLOD;
            } else {
                // Calculate new LOD
                const newOptimalLOD = this.lodManager.getOptimalLOD(effectiveScreenSize, effectiveScreenSize);
                
                // Apply hysteresis: only switch if it's a different LOD level
                if (cachedLOD.optimalLOD === newOptimalLOD || 
                    (cachedLOD.optimalLOD !== null && newOptimalLOD !== null && 
                     Math.abs(cachedLOD.optimalLOD - newOptimalLOD) < cachedLOD.optimalLOD * 0.25)) {
                    // Keep current LOD - change isn't significant enough
                    optimalLOD = cachedLOD.optimalLOD;
                } else {
                    // Switch to new LOD
                    // console.log(`🔄 LOD change for ${node.id}: ${cachedLOD.optimalLOD === null ? 'full' : cachedLOD.optimalLOD + 'px'} → ${newOptimalLOD === null ? 'full' : newOptimalLOD + 'px'}`);
                    optimalLOD = newOptimalLOD;
                }
                
                // Update cache
                this.lodCache.set(nodeId, {
                    screenSize: effectiveScreenSize,
                    optimalLOD,
                    lastUpdate: now
                });
            }
        } else {
            // No cached LOD - calculate fresh
            optimalLOD = this.lodManager.getOptimalLOD(effectiveScreenSize, effectiveScreenSize);
            this.lodCache.set(nodeId, {
                screenSize: effectiveScreenSize,
                optimalLOD,
                lastUpdate: now
            });
            
            // DEBUG: Log fresh LOD calculation
            if (window.DEBUG_LOD_STATUS) {
                console.log(`🆕 Fresh LOD calc for ${node.id}: effective=${Math.round(effectiveScreenSize)}, optimal=${optimalLOD === null ? 'full' : optimalLOD + 'px'}, threshold=3000`);
            }
            
            // Properties panel will be updated after rendering via post-render tracking
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
            // Apply DPR to get effective pixel count
            const effectiveWidth = screenWidth * dpr;
            const effectiveHeight = screenHeight * dpr;
            texture = this.lodManager.getBestTexture(
                node.properties.hash, 
                effectiveWidth, 
                effectiveHeight
            );
            
            // DEBUG: Log texture selection
            if (window.DEBUG_LOD_STATUS) {
                console.log(`🖼️ Texture selection for ${node.id}: optimalLOD=${optimalLOD === null ? 'full' : optimalLOD + 'px'}, texture found=${!!texture}`);
            }
            
            // If we want full resolution, prefer node.img over any LOD texture
            if (optimalLOD === null) {
                if (node.img && node.img.complete) {
                    texture = this._ensureTexture(node.img);
                    if (window.DEBUG_LOD_STATUS) {
                        console.log(`🖼️ Forcing full res from node.img (ignoring LOD textures)`);
                    }
                } else {
                    // Request full resolution
                    this._requestTexture(node, screenWidth, screenHeight);
                    if (window.DEBUG_LOD_STATUS) {
                        console.log(`🖼️ Requested full res, no fallback`);
                    }
                    return false;
                }
            } else if (!texture) {
                // For LOD textures, use normal fallback logic
                this._requestTexture(node, screenWidth, screenHeight);
                if (window.DEBUG_LOD_STATUS) {
                    console.log(`🖼️ Requested ${optimalLOD}px texture, no fallback`);
                }
                return false;
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
                    actualWidth: textureSource?.naturalWidth || textureSource?.width || actualLOD || 0,
                    actualHeight: textureSource?.naturalHeight || textureSource?.height || actualLOD || 0,
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
                
                // Check if we should request a different texture (with throttling)
                const shouldRequestDifferent = currentLOD !== optimalLOD;
                
                if (shouldRequestDifferent) {
                    const lastRequest = this.lastTextureRequest.get(nodeId);
                    const requestKey = `${node.properties.hash}_${optimalLOD}`;
                    
                    // Only make request if we haven't made the same request recently
                    if (!lastRequest || 
                        lastRequest.hash !== node.properties.hash ||
                        lastRequest.lodSize !== optimalLOD ||
                        now - lastRequest.timestamp > this.textureRequestCooldown) {
                        
                        // Removed verbose texture request logging
                        
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
            
            // Removed: Special case for color corrections that forced full resolution
            // The LOD system now handles color-corrected images properly
            
            // Fall back to Canvas2D only if we have no other options
            if (!texture) {
                return false;
            }
        }

        // Check if this node has color corrections and is not being actively adjusted
        const hasColorCorrection = this.nodeHasColorCorrection(node);
        const isActivelyAdjusted = this.activeAdjustmentNodeId === node.id;
        
        // Track if we're using a cached texture with pre-applied corrections
        let usingCachedTexture = false;
        
        // Store the actual rendered LOD before we modify currentLOD for caching
        const actualRenderedLOD = currentLOD;
        
        // Ensure we have a currentLOD for cache keying
        // If we couldn't determine the LOD from the texture, use the optimal LOD
        if (currentLOD === null || currentLOD === undefined) {
            currentLOD = optimalLOD;
            if (window.DEBUG_LOD_STATUS) {
                console.log(`📎 No current LOD detected, using optimal LOD ${optimalLOD} for cache key`);
            }
        }
        
        // For nodes with color corrections that aren't being actively adjusted, use cached rendering
        if (hasColorCorrection && !isActivelyAdjusted) {
            // For video nodes, only cache if paused
            if (node.type === 'media/video' && (!node.properties.paused || !node.video)) {
                // Playing video - render normally
            } else {
                // Try to get cached render 
                if (window.DEBUG_LOD_STATUS) {
                    console.log(`🔍 Looking for cached render: node=${node.id}, actualLOD=${actualRenderedLOD}, optimalLOD=${optimalLOD}, texture=${texture}`);
                }
                const cachedTexture = this._getCachedOrRender(node, texture, actualRenderedLOD);
                if (cachedTexture) {
                    // Use cached texture instead of original
                    texture = cachedTexture;
                    usingCachedTexture = true;
                    if (window.DEBUG_LOD_STATUS) {
                        console.log(`✓ Using cached texture for node ${node.id} at LOD ${actualRenderedLOD}`);
                    }
                    // Continue with normal rendering flow but with cached texture
                    // Note: Color corrections will be disabled in the shader since they're already baked in
                } else {
                    if (window.DEBUG_LOD_STATUS) {
                        console.log(`✗ No cached texture found for node ${node.id} at LOD ${actualRenderedLOD}`);
                    }
                }
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
        // If using cached texture, set all adjustments to 0 since they're already applied
        let brightness = 0, contrast = 0, saturation = 0, hue = 0, temperature = 0, tint = 0;
        
        if (typeof usingCachedTexture === 'undefined' || !usingCachedTexture) {
            const bypassed = node.colorAdjustmentsBypassed;
            const adj = (!bypassed && node.adjustments) ? node.adjustments : {brightness:0,contrast:0,saturation:0,hue:0,temperature:0,tint:0};
            brightness = bypassed ? 0 : (isNaN(adj.brightness) ? 0 : (adj.brightness || 0));
            contrast = bypassed ? 0 : (isNaN(adj.contrast) ? 0 : (adj.contrast || 0));
            saturation = bypassed ? 0 : (isNaN(adj.saturation) ? 0 : (adj.saturation || 0));
            hue = bypassed ? 0 : (isNaN(adj.hue) ? 0 : (adj.hue || 0));
            temperature = bypassed ? 0 : (isNaN(adj.temperature) ? 0 : (adj.temperature || 0));
            tint = bypassed ? 0 : (isNaN(adj.tint) ? 0 : (adj.tint || 0));
        }
        
        this.gl.uniform1f(this.uBrightness, brightness);
        this.gl.uniform1f(this.uContrast, contrast);
        this.gl.uniform1f(this.uSaturation, saturation);
        this.gl.uniform1f(this.uHue, hue);
        this.gl.uniform1f(this.uTemperature, temperature);
        this.gl.uniform1f(this.uTint, tint);
        
        if (window.DEBUG_LOD_STATUS && node.type === 'media/video' && (brightness !== 0 || contrast !== 0 || saturation !== 0 || hue !== 0 || temperature !== 0 || tint !== 0)) {
            console.log(`🎨 Video color adjustments - B:${brightness} C:${contrast} S:${saturation} H:${hue} T:${temperature} Ti:${tint}`);
        }
        
        // Get opacity from gallery view manager if in gallery mode
        let opacity = 1.0;
        if (window.app?.galleryViewManager && window.app.galleryViewManager.active) {
            opacity = window.app.galleryViewManager.getNodeOpacity(node);
        }
        this.gl.uniform1f(this.uOpacity, opacity);
        
        // Skip all color corrections if using cached texture (already has corrections applied)
        if (typeof usingCachedTexture !== 'undefined' && usingCachedTexture) {
            // Disable all color corrections in shader
            this.gl.uniform1f(this.uHasToneCurve, 0.0);
            this.gl.uniform1f(this.uHasColorBalance, 0.0);
        } else {
            // Handle tone curve control points
        if (node.toneCurve && node.toneCurve.controlPoints && !node.toneCurveBypassed) {
            const points = node.toneCurve.controlPoints;
            const numPoints = Math.min(points.length, 8); // Max 8 points
            
            // Convert control points to flat array for uniform
            const pointsArray = new Float32Array(16); // 8 points * 2 components
            for (let i = 0; i < numPoints; i++) {
                pointsArray[i * 2] = points[i].x;
                pointsArray[i * 2 + 1] = points[i].y;
            }
            
            this.gl.uniform2fv(this.uCurvePoints, pointsArray);
            this.gl.uniform1i(this.uNumCurvePoints, numPoints);
            this.gl.uniform1f(this.uHasToneCurve, 1.0);
        } else {
            // Disable tone curve
            this.gl.uniform1f(this.uHasToneCurve, 0.0);
        }
        
        // Handle color balance
        if (node.colorBalance && !node.colorBalanceBypassed) {
            const cb = node.colorBalance;
            
            // Use centralized color wheel to RGB conversion
            const shadowsRGB = this._wheelToRGB(cb.shadows.x, cb.shadows.y);
            // Invert midtones because gamma = 1.0 - delta in shader
            const midtonesRGB = this._wheelToRGB(-cb.midtones.x, -cb.midtones.y);
            const highlightsRGB = this._wheelToRGB(cb.highlights.x, cb.highlights.y);
            
            // Pass colors directly (no additional multiplier needed here)
            this.gl.uniform3fv(this.uShadowsColor, shadowsRGB);
            this.gl.uniform1f(this.uShadowsLuminance, cb.shadows.luminance);
            
            this.gl.uniform3fv(this.uMidtonesColor, midtonesRGB);
            this.gl.uniform1f(this.uMidtonesLuminance, cb.midtones.luminance);
            
            this.gl.uniform3fv(this.uHighlightsColor, highlightsRGB);
            this.gl.uniform1f(this.uHighlightsLuminance, cb.highlights.luminance);
            
            this.gl.uniform1f(this.uHasColorBalance, 1.0);
        } else {
            // Disable color balance
            this.gl.uniform1f(this.uHasColorBalance, 0.0);
        }
        } // Close the else block for usingCachedTexture check

        // Draw
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

        // Track what was actually rendered for properties panel (only update on LOD changes)
        if (node.setLastRenderedResolution) {
            // Use the actual rendered LOD, not the cache key
            const actualLabel = actualRenderedLOD !== null ? actualRenderedLOD + 'px' : 'full';
            const lastRendered = node.getLastRenderedResolution();
            
            // Only update if LOD has changed or if this is the first render for this node
            if (!lastRendered || lastRendered.source !== actualLabel) {
                if (actualRenderedLOD !== null) {
                    // Calculate display dimensions based on LOD and aspect ratio
                    const originalWidth = node.originalWidth || actualRenderedLOD;
                    const originalHeight = node.originalHeight || actualRenderedLOD;
                    const aspectRatio = originalWidth / originalHeight;
                    
                    let displayWidth, displayHeight;
                    if (aspectRatio >= 1) {
                        // Landscape or square
                        displayWidth = actualRenderedLOD;
                        displayHeight = Math.round(actualRenderedLOD / aspectRatio);
                    } else {
                        // Portrait
                        displayHeight = actualRenderedLOD;
                        displayWidth = Math.round(actualRenderedLOD * aspectRatio);
                    }
                    
                    node.setLastRenderedResolution(displayWidth, displayHeight, actualLabel);
                } else {
                    // Using full resolution
                    const originalWidth = node.originalWidth || node.img?.naturalWidth || 0;
                    const originalHeight = node.originalHeight || node.img?.naturalHeight || 0;
                    node.setLastRenderedResolution(originalWidth, originalHeight, 'full');
                }
                
                // Only notify properties panel when LOD actually changes
                if (window.propertiesInspector && window.propertiesInspector.isVisible) {
                    window.propertiesInspector.scheduleNavigationUpdate();
                }
                
                if (window.DEBUG_LOD_STATUS) {
                    console.log(`🔄 LOD changed to ${actualLabel} for node ${node.id}`);
                }
            }
        }

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
        if (node.needsGLUpdate) {
            node.needsGLUpdate = false;
        }
        
        return true;
    }
    
    /**
     * Draw a cached node texture
     * @private
     */
    _drawCachedNode(node, cached, offsetX, offsetY, scale, opacity) {
        const gl = this.gl;
        const vp = this.canvas.viewport;
        
        // Use the simple shader (no color correction needed for cached)
        gl.useProgram(this.program);
        
        // Update resolution
        const [w, h] = this._resizeCanvas();
        gl.uniform2f(this.resolutionLoc, w, h);
        
        // Calculate position
        let graphPos = node.pos;
        if (node._gridAnimPos) {
            graphPos = node._gridAnimPos;
        } else if (node._animPos) {
            graphPos = node._animPos;
        }
        
        const dpr = vp.dpr;
        const screenPos = vp.convertGraphToOffset(graphPos[0], graphPos[1]);
        const sx = screenPos[0] * dpr;
        const sy = screenPos[1] * dpr;
        const sw = node.size[0] * vp.scale * dpr;
        const sh = node.size[1] * vp.scale * dpr;
        
        // Set up vertices (handle rotation if needed)
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
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.positionLoc);
        gl.vertexAttribPointer(this.positionLoc, 2, gl.FLOAT, false, 0, 0);
        
        // Texture coordinates
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffer);
        gl.enableVertexAttribArray(this.texLoc);
        gl.vertexAttribPointer(this.texLoc, 2, gl.FLOAT, false, 0, 0);
        
        // Bind cached texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, cached.texture);
        
        // Set uniforms - no color correction needed
        gl.uniform1f(this.uBrightness, 0);
        gl.uniform1f(this.uContrast, 0);
        gl.uniform1f(this.uSaturation, 0);
        gl.uniform1f(this.uHue, 0);
        gl.uniform1f(this.uTemperature, 0);
        gl.uniform1f(this.uTint, 0);
        
        // Apply opacity
        let finalOpacity = opacity;
        if (window.app?.galleryViewManager && window.app.galleryViewManager.active) {
            finalOpacity = window.app.galleryViewManager.getNodeOpacity(node);
        }
        gl.uniform1f(this.uOpacity, finalOpacity);
        
        // Draw
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        
        // Clean up
        gl.bindTexture(gl.TEXTURE_2D, null);
        
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
        const dpr = this.canvas.viewport?.dpr || 1;
        const effectiveScreenSize = Math.max(screenWidth, screenHeight) * dpr;
        const optimalLOD = this.lodManager.getOptimalLOD(effectiveScreenSize, effectiveScreenSize);
        // console.log(`📤 Requesting texture: ${optimalLOD === null ? 'full res' : optimalLOD + 'px'} for ${hash.substring(0, 8)}... (screen: ${Math.round(screenWidth)}x${Math.round(screenHeight)}, effective: ${Math.round(effectiveScreenSize)})`);
        
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
                actualWidth: textureSource?.naturalWidth || textureSource?.width || lodSize || 0,
                actualHeight: textureSource?.naturalHeight || textureSource?.height || lodSize || 0,
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