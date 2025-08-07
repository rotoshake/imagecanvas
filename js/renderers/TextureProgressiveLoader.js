/**
 * Progressive texture loading system
 * Loads textures from low to high resolution progressively
 */

class TextureProgressiveLoader {
    constructor(textureManager) {
        this.manager = textureManager;
        this.progressiveLoads = new Map(); // hash -> current loading state
        this.lodLevels = [64, 128, 256, 512, 1024, 2048, null];
    }
    
    /**
     * Request progressive loading up to target LOD
     */
    requestProgressive(node, targetLOD, priority) {
        const hash = node.properties?.hash;
        if (!hash) return;
        
        // Check if we're already progressively loading this
        const state = this.progressiveLoads.get(hash);
        if (state && state.targetLOD === targetLOD) {
            return; // Already loading to this target
        }
        
        // Find starting point (best currently available)
        const startLOD = this.findBestAvailable(hash);
        const startIndex = this.lodLevels.indexOf(startLOD);
        const targetIndex = this.lodLevels.indexOf(targetLOD);
        
        if (startIndex >= targetIndex) {
            // Already have target or better
            return;
        }
        
        // Create progressive load state
        const loadState = {
            hash,
            node,
            targetLOD,
            currentIndex: startIndex + 1,
            targetIndex,
            basePriority: priority,
            startTime: performance.now()
        };
        
        this.progressiveLoads.set(hash, loadState);
        
        // Queue next level
        this.queueNextLevel(loadState);
    }
    
    /**
     * Queue next LOD level for loading
     */
    queueNextLevel(loadState) {
        if (loadState.currentIndex > loadState.targetIndex) {
            // Reached target
            this.progressiveLoads.delete(loadState.hash);
            return;
        }
        
        const lod = this.lodLevels[loadState.currentIndex];
        const key = `${loadState.hash}_${lod || 'full'}`;
        
        // Check if already loaded
        if (this.manager.cache.has(key)) {
            // Already have this level, move to next
            loadState.currentIndex++;
            this.queueNextLevel(loadState);
            return;
        }
        
        // Calculate priority with progressive boost
        // Earlier LODs get higher priority for faster initial display
        const levelBoost = (this.lodLevels.length - loadState.currentIndex) * 0.02;
        const priority = Math.max(0, loadState.basePriority - levelBoost);
        
        // Add to load queue
        this.manager.loadQueue.add({
            hash: loadState.hash,
            lod,
            key,
            node: loadState.node,
            priority,
            progressive: true,
            progressiveState: loadState
        });
        
        this.manager.activeLoads.add(key);
    }
    
    /**
     * Called when a texture finishes loading
     */
    onTextureLoaded(hash, lod) {
        const state = this.progressiveLoads.get(hash);
        if (!state) return;
        
        const lodIndex = this.lodLevels.indexOf(lod);
        if (lodIndex >= state.currentIndex) {
            // Move to next level
            state.currentIndex = lodIndex + 1;
            
            // Add small delay between levels to prevent blocking
            setTimeout(() => {
                this.queueNextLevel(state);
            }, 10);
        }
    }
    
    /**
     * Find best currently available LOD
     */
    findBestAvailable(hash) {
        for (let i = this.lodLevels.length - 1; i >= 0; i--) {
            const lod = this.lodLevels[i];
            const key = `${hash}_${lod || 'full'}`;
            if (this.manager.cache.has(key)) {
                return lod;
            }
        }
        return null;
    }
    
    /**
     * Cancel progressive loading for a hash
     */
    cancel(hash) {
        this.progressiveLoads.delete(hash);
        
        // Remove from load queue
        this.manager.loadQueue.remove(item => 
            item.hash === hash && item.progressive
        );
    }
    
    /**
     * Clear all progressive loads
     */
    clear() {
        this.progressiveLoads.clear();
    }
}

/**
 * Color correction processor
 * Handles color corrections efficiently with caching
 */
class ColorCorrectionProcessor {
    constructor(gl) {
        this.gl = gl;
        
        // Shader program for color correction
        this.program = null;
        this.uniforms = {};
        this.attributes = {};
        
        // Framebuffer for rendering corrections
        this.framebuffer = null;
        this.renderTexture = null;
        
        // Vertex buffer for full-screen quad
        this.vertexBuffer = null;
        this.texCoordBuffer = null;
        
        this.initShaders();
        this.initBuffers();
    }
    
    initShaders() {
        const gl = this.gl;
        
        const vertexShader = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;
        
        const fragmentShader = `
            precision highp float;
            
            uniform sampler2D u_texture;
            uniform float u_brightness;
            uniform float u_contrast;
            uniform float u_saturation;
            uniform float u_hue;
            uniform float u_temperature;
            uniform float u_tint;
            
            varying vec2 v_texCoord;
            
            vec3 rgb2hsv(vec3 c) {
                vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
                vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
                vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
                
                float d = q.x - min(q.w, q.y);
                float e = 1.0e-10;
                return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
            }
            
            vec3 hsv2rgb(vec3 c) {
                vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
            }
            
            void main() {
                vec4 color = texture2D(u_texture, v_texCoord);
                vec3 rgb = color.rgb;
                
                // Brightness
                rgb += u_brightness;
                
                // Contrast
                rgb = ((rgb - 0.5) * (1.0 + u_contrast)) + 0.5;
                
                // Saturation & Hue
                vec3 hsv = rgb2hsv(rgb);
                hsv.y *= (1.0 + u_saturation);
                hsv.x = mod(hsv.x + u_hue, 1.0);
                rgb = hsv2rgb(hsv);
                
                // Temperature & Tint
                rgb.r += u_temperature * 0.1;
                rgb.b -= u_temperature * 0.1;
                rgb.g += u_tint * 0.1;
                
                gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
            }
        `;
        
        // Compile shaders
        const vs = this.compileShader(gl.VERTEX_SHADER, vertexShader);
        const fs = this.compileShader(gl.FRAGMENT_SHADER, fragmentShader);
        
        // Create program
        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);
        
        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Shader link failed:', gl.getProgramInfoLog(this.program));
            return;
        }
        
        // Get locations
        this.attributes.position = gl.getAttribLocation(this.program, 'a_position');
        this.attributes.texCoord = gl.getAttribLocation(this.program, 'a_texCoord');
        
        this.uniforms.texture = gl.getUniformLocation(this.program, 'u_texture');
        this.uniforms.brightness = gl.getUniformLocation(this.program, 'u_brightness');
        this.uniforms.contrast = gl.getUniformLocation(this.program, 'u_contrast');
        this.uniforms.saturation = gl.getUniformLocation(this.program, 'u_saturation');
        this.uniforms.hue = gl.getUniformLocation(this.program, 'u_hue');
        this.uniforms.temperature = gl.getUniformLocation(this.program, 'u_temperature');
        this.uniforms.tint = gl.getUniformLocation(this.program, 'u_tint');
    }
    
    compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile failed:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        
        return shader;
    }
    
    initBuffers() {
        const gl = this.gl;
        
        // Full-screen quad vertices
        const vertices = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
             1,  1
        ]);
        
        const texCoords = new Float32Array([
            0, 1,
            1, 1,
            0, 0,
            1, 0
        ]);
        
        this.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
        
        this.texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    }
    
    /**
     * Apply color corrections to a texture
     */
    applyCorrections(sourceTexture, corrections, width, height) {
        const gl = this.gl;
        
        // Create or resize render texture
        if (!this.renderTexture || this.renderWidth !== width || this.renderHeight !== height) {
            if (this.renderTexture) {
                gl.deleteTexture(this.renderTexture);
            }
            
            this.renderTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.renderTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            
            this.renderWidth = width;
            this.renderHeight = height;
        }
        
        // Create or reuse framebuffer
        if (!this.framebuffer) {
            this.framebuffer = gl.createFramebuffer();
        }
        
        // Render to texture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.renderTexture, 0);
        
        // Save current viewport
        const oldViewport = gl.getParameter(gl.VIEWPORT);
        gl.viewport(0, 0, width, height);
        
        // Use correction shader
        gl.useProgram(this.program);
        
        // Bind source texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
        gl.uniform1i(this.uniforms.texture, 0);
        
        // Set correction uniforms
        gl.uniform1f(this.uniforms.brightness, corrections.brightness || 0);
        gl.uniform1f(this.uniforms.contrast, corrections.contrast || 0);
        gl.uniform1f(this.uniforms.saturation, corrections.saturation || 0);
        gl.uniform1f(this.uniforms.hue, corrections.hue || 0);
        gl.uniform1f(this.uniforms.temperature, corrections.temperature || 0);
        gl.uniform1f(this.uniforms.tint, corrections.tint || 0);
        
        // Set up attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.enableVertexAttribArray(this.attributes.position);
        gl.vertexAttribPointer(this.attributes.position, 2, gl.FLOAT, false, 0, 0);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(this.attributes.texCoord);
        gl.vertexAttribPointer(this.attributes.texCoord, 2, gl.FLOAT, false, 0, 0);
        
        // Draw
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        
        // Create output texture
        const outputTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, outputTexture);
        gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, width, height, 0);
        
        // Only generate mipmaps for large textures
        if (width > 256 || height > 256) {
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        
        // Restore state
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(oldViewport[0], oldViewport[1], oldViewport[2], oldViewport[3]);
        
        return outputTexture;
    }
    
    /**
     * Clean up resources
     */
    dispose() {
        const gl = this.gl;
        
        if (this.program) {
            gl.deleteProgram(this.program);
        }
        if (this.framebuffer) {
            gl.deleteFramebuffer(this.framebuffer);
        }
        if (this.renderTexture) {
            gl.deleteTexture(this.renderTexture);
        }
        if (this.vertexBuffer) {
            gl.deleteBuffer(this.vertexBuffer);
        }
        if (this.texCoordBuffer) {
            gl.deleteBuffer(this.texCoordBuffer);
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TextureProgressiveLoader, ColorCorrectionProcessor };
}

if (typeof window !== 'undefined') {
    window.TextureProgressiveLoader = TextureProgressiveLoader;
    window.ColorCorrectionProcessor = ColorCorrectionProcessor;
}