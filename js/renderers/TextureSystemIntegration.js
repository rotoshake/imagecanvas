/**
 * Integration layer between the new UnifiedTextureManager and existing WebGLRenderer
 * Provides a migration path from the old system
 */

class TextureSystemIntegration {
    constructor(webglRenderer) {
        this.renderer = webglRenderer;
        this.gl = webglRenderer.gl;
        this.canvas = webglRenderer.canvas;
        
        // Create new unified system
        this.unifiedManager = new UnifiedTextureManager(this.gl, {
            canvas: this.canvas,
            maxMemory: 1.5 * 1024 * 1024 * 1024 // 1.5GB
        });
        
        // Progressive loader
        this.progressiveLoader = new TextureProgressiveLoader(this.unifiedManager);
        
        // Color correction processor
        this.correctionProcessor = new ColorCorrectionProcessor(this.gl);
        
        // Hook into unified manager for progressive loading
        this.setupProgressiveHooks();
        
        // Feature flag to enable/disable new system
        this.enabled = false;
        
        // Migration stats
        this.stats = {
            oldSystemCalls: 0,
            newSystemCalls: 0,
            migrationStartTime: Date.now()
        };
    }
    
    /**
     * Setup hooks for progressive loading
     */
    setupProgressiveHooks() {
        // Override loadTexture to notify progressive loader
        const originalLoad = this.unifiedManager.loadTexture.bind(this.unifiedManager);
        this.unifiedManager.loadTexture = async (item) => {
            const result = await originalLoad(item);
            
            // Notify progressive loader
            if (item.progressiveState) {
                this.progressiveLoader.onTextureLoaded(item.hash, item.lod);
            }
            
            return result;
        };
        
        // Override texture creation to handle color corrections
        const originalCreate = this.unifiedManager.createTexture.bind(this.unifiedManager);
        this.unifiedManager.createTexture = (source) => {
            return originalCreate(source);
        };
    }
    
    /**
     * Request a texture (main entry point)
     * This replaces calls to the old LOD manager
     */
    requestTexture(node, screenWidth, screenHeight) {
        // Track stats
        if (this.enabled) {
            this.stats.newSystemCalls++;
        } else {
            this.stats.oldSystemCalls++;
        }
        
        // Use new system if enabled
        if (this.enabled) {
            // Get corrections if node has adjustments
            const corrections = this.getNodeCorrections(node);
            
            // Request from unified manager
            const texture = this.unifiedManager.requestTexture(
                node, 
                screenWidth, 
                screenHeight,
                corrections
            );
            
            // If we got a texture but need corrections, apply them
            if (texture && corrections && !this.isNeutralCorrections(corrections)) {
                return this.getOrCreateCorrectedTexture(
                    node.properties.hash,
                    texture,
                    corrections,
                    screenWidth,
                    screenHeight
                );
            }
            
            return texture;
        }
        
        // Fall back to old system
        return this.requestFromOldSystem(node, screenWidth, screenHeight);
    }
    
    /**
     * Get or create color-corrected texture
     */
    getOrCreateCorrectedTexture(hash, baseTexture, corrections, width, height) {
        // Check if this correction already exists in the cache
        const lod = this.unifiedManager.getOptimalLOD(width, height);
        const key = this.unifiedManager.getTextureKey(hash, lod);
        const entry = this.unifiedManager.cache.get(key);
        
        if (entry) {
            const correctionKey = entry.getCorrectionKey(corrections);
            
            // Check if we already have this correction
            if (entry.correctedTextures.has(correctionKey)) {
                return entry.correctedTextures.get(correctionKey);
            }
            
            // Apply corrections
            const correctedTexture = this.correctionProcessor.applyCorrections(
                baseTexture,
                corrections,
                entry.width,
                entry.height
            );
            
            // Cache the corrected texture
            entry.correctedTextures.set(correctionKey, correctedTexture);
            
            // Update memory tracking (approximate)
            const correctionMemory = entry.width * entry.height * 4 * 1.33;
            this.unifiedManager.currentMemory += correctionMemory;
            
            // Check if we need to evict
            if (this.unifiedManager.currentMemory > this.unifiedManager.maxMemory) {
                this.unifiedManager.evictTextures(correctionMemory);
            }
            
            return correctedTexture;
        }
        
        return baseTexture;
    }
    
    /**
     * Get corrections from node
     */
    getNodeCorrections(node) {
        if (!node.adjustments) return null;
        
        const adj = node.adjustments;
        
        // Check if all adjustments are neutral
        if (adj.brightness === 0 && 
            adj.contrast === 0 && 
            adj.saturation === 0 &&
            adj.hue === 0 &&
            adj.temperature === 0 &&
            adj.tint === 0) {
            return null;
        }
        
        return {
            brightness: adj.brightness || 0,
            contrast: adj.contrast || 0,
            saturation: adj.saturation || 0,
            hue: adj.hue || 0,
            temperature: adj.temperature || 0,
            tint: adj.tint || 0
        };
    }
    
    /**
     * Check if corrections are neutral
     */
    isNeutralCorrections(corrections) {
        return !corrections || (
            corrections.brightness === 0 &&
            corrections.contrast === 0 &&
            corrections.saturation === 0 &&
            corrections.hue === 0 &&
            corrections.temperature === 0 &&
            corrections.tint === 0
        );
    }
    
    /**
     * Request from old system (fallback)
     */
    requestFromOldSystem(node, screenWidth, screenHeight) {
        // Use the existing LOD manager if available
        if (this.renderer.lodManager) {
            const hash = node.properties?.hash;
            if (hash) {
                const texture = this.renderer.lodManager.getBestTexture(
                    hash,
                    screenWidth,
                    screenHeight
                );
                
                // Request loading if not available
                if (!texture) {
                    const dpr = this.canvas.viewport?.dpr || 1;
                    const effectiveWidth = screenWidth * dpr;
                    const effectiveHeight = screenHeight * dpr;
                    const optimalLOD = this.renderer.lodManager.getOptimalLOD(
                        effectiveWidth,
                        effectiveHeight
                    );
                    
                    // Try to get texture source and request
                    let source = null;
                    if (window.thumbnailCache && optimalLOD !== null) {
                        const thumbnails = window.thumbnailCache.getThumbnails(hash);
                        source = thumbnails?.get(optimalLOD);
                    } else if (node.img?.complete) {
                        source = node.img;
                    }
                    
                    if (source) {
                        this.renderer.lodManager.requestTexture(
                            hash,
                            optimalLOD,
                            0, // High priority
                            source,
                            true, // Visible
                            Math.max(screenWidth, screenHeight)
                        );
                    }
                }
                
                return texture;
            }
        }
        
        return null;
    }
    
    /**
     * Begin frame processing
     */
    beginFrame() {
        if (this.enabled) {
            // Set viewport reference
            if (this.canvas?.viewport) {
                this.unifiedManager.setViewport(this.canvas.viewport);
            }
            
            // Process unified manager frame
            this.unifiedManager.beginFrame();
        }
    }
    
    /**
     * Enable the new system
     */
    enable() {
        this.enabled = true;
        console.log('✅ UnifiedTextureManager enabled');
        
        // Clear old system caches if they exist
        if (this.renderer.lodManager) {
            console.log('🧹 Clearing old LOD manager cache');
            this.renderer.lodManager.clear();
        }
    }
    
    /**
     * Disable the new system (fallback to old)
     */
    disable() {
        this.enabled = false;
        console.log('⏸️ UnifiedTextureManager disabled, using old system');
        
        // Clear new system cache
        this.unifiedManager.clear();
    }
    
    /**
     * Get statistics
     */
    getStats() {
        const runtime = Date.now() - this.stats.migrationStartTime;
        
        return {
            enabled: this.enabled,
            runtime: Math.round(runtime / 1000) + 's',
            oldSystemCalls: this.stats.oldSystemCalls,
            newSystemCalls: this.stats.newSystemCalls,
            unified: this.unifiedManager.getStats(),
            memoryUsedMB: Math.round(this.unifiedManager.currentMemory / 1024 / 1024),
            memoryLimitMB: Math.round(this.unifiedManager.maxMemory / 1024 / 1024)
        };
    }
    
    /**
     * Clean up resources
     */
    dispose() {
        this.unifiedManager.clear();
        this.correctionProcessor.dispose();
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TextureSystemIntegration;
}

if (typeof window !== 'undefined') {
    window.TextureSystemIntegration = TextureSystemIntegration;
}