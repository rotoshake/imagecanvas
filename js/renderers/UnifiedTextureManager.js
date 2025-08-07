/**
 * UnifiedTextureManager - Complete refactor of the LOD system
 * Single source of truth for all texture operations with aggressive performance optimization
 */

// Priority Queue implementation for texture loading
class PriorityQueue {
    constructor() {
        this.items = [];
    }
    
    add(item) {
        // Binary search to find insertion point
        let left = 0;
        let right = this.items.length;
        
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (this.items[mid].priority < item.priority) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        
        this.items.splice(left, 0, item);
    }
    
    poll() {
        return this.items.shift();
    }
    
    peek() {
        return this.items[0];
    }
    
    size() {
        return this.items.length;
    }
    
    clear() {
        this.items = [];
    }
    
    remove(predicate) {
        this.items = this.items.filter(item => !predicate(item));
    }
}

// Texture entry that handles both base and color-corrected versions
class TextureEntry {
    constructor(hash, lod, gl) {
        this.hash = hash;
        this.lod = lod; // null = full resolution
        this.gl = gl;
        
        // Textures
        this.baseTexture = null;
        this.correctedTextures = new Map(); // correction key -> texture
        
        // Metadata
        this.width = 0;
        this.height = 0;
        this.memorySize = 0;
        
        // Access tracking
        this.loadFrame = 0;
        this.lastAccessFrame = 0;
        this.accessCount = 0;
        
        // Viewport tracking
        this.lastViewportDistance = 1.0;
        this.isVisible = false;
        this.viewportCoverage = 0;
    }
    
    getTexture(corrections = null) {
        // No corrections needed - return base
        if (!corrections || this.isNeutralCorrections(corrections)) {
            this.lastAccessFrame = performance.now();
            return this.baseTexture;
        }
        
        // Generate correction key
        const key = this.getCorrectionKey(corrections);
        
        // Check if we have this correction cached
        if (this.correctedTextures.has(key)) {
            this.lastAccessFrame = performance.now();
            return this.correctedTextures.get(key);
        }
        
        // We'll need to generate this correction
        // For now, return base texture (correction will be queued)
        return this.baseTexture;
    }
    
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
    
    getCorrectionKey(corrections) {
        return `${corrections.brightness}_${corrections.contrast}_${corrections.saturation}_${corrections.hue}_${corrections.temperature}_${corrections.tint}`;
    }
    
    dispose() {
        // Clean up WebGL textures
        if (this.baseTexture) {
            this.gl.deleteTexture(this.baseTexture);
        }
        for (const texture of this.correctedTextures.values()) {
            this.gl.deleteTexture(texture);
        }
        this.correctedTextures.clear();
    }
}

// Main unified texture manager
class UnifiedTextureManager {
    constructor(gl, options = {}) {
        this.gl = gl;
        
        // Configuration
        this.maxMemory = options.maxMemory || 1.5 * 1024 * 1024 * 1024; // 1.5GB
        this.maxTextures = options.maxTextures || 500;
        this.lodLevels = [64, 128, 256, 512, 1024, 2048, null]; // null = full res
        
        // Core data structures
        this.cache = new Map(); // "hash_lod" -> TextureEntry
        this.loadQueue = new PriorityQueue();
        this.activeLoads = new Set(); // Keys currently being loaded
        
        // Memory tracking
        this.currentMemory = 0;
        this.frameId = 0;
        
        // Viewport reference
        this.viewport = null;
        this.canvas = options.canvas;
        
        // Performance tracking
        this.stats = {
            cacheHits: 0,
            cacheMisses: 0,
            texturesLoaded: 0,
            texturesEvicted: 0,
            memoryUsed: 0
        };
        
        // Frame timing
        this.frameStartTime = 0;
        this.frameBudgetMs = 16; // Target 60fps
        this.loadBudgetMs = 4; // Max time for texture operations per frame
        
        // Decode worker pool (will be implemented next)
        this.decodeWorkers = null;
        this.pendingDecodes = new Map();
        
        // Protection from thrashing
        this.recentlyEvicted = new Map(); // key -> timestamp
        this.evictionCooldown = 2000; // Don't reload for 2 seconds after eviction
        
        // Initial load optimization
        this.isInitialLoad = true;
        this.pageLoadTime = Date.now();
        setTimeout(() => {
            this.isInitialLoad = false;
        }, 3000);
    }
    
    /**
     * Main entry point - request a texture for a node
     */
    requestTexture(node, screenWidth, screenHeight, corrections = null) {
        if (!node.properties?.hash) return null;
        
        const hash = node.properties.hash;
        const dpr = this.viewport?.dpr || 1;
        const effectiveWidth = screenWidth * dpr;
        const effectiveHeight = screenHeight * dpr;
        
        // Determine optimal LOD for this screen size
        const optimalLOD = this.getOptimalLOD(effectiveWidth, effectiveHeight);
        const key = this.getTextureKey(hash, optimalLOD);
        
        // Update viewport tracking for this node
        this.updateNodeViewportInfo(node, screenWidth, screenHeight);
        
        // Check cache first
        if (this.cache.has(key)) {
            const entry = this.cache.get(key);
            entry.lastAccessFrame = this.frameId;
            entry.accessCount++;
            this.stats.cacheHits++;
            
            // Return appropriate texture (base or corrected)
            return entry.getTexture(corrections);
        }
        
        // Not in cache - need to load
        this.stats.cacheMisses++;
        
        // Check if we're already loading this
        if (!this.activeLoads.has(key)) {
            // Check eviction cooldown
            const evictionTime = this.recentlyEvicted.get(key);
            if (evictionTime && Date.now() - evictionTime < this.evictionCooldown) {
                // Too soon after eviction, skip
                return this.getBestAvailable(hash, optimalLOD);
            }
            
            // Calculate priority
            const priority = this.calculatePriority(node, screenWidth, screenHeight, optimalLOD);
            
            // Add to load queue
            this.loadQueue.add({
                hash,
                lod: optimalLOD,
                key,
                node,
                priority,
                corrections,
                screenWidth,
                screenHeight
            });
            
            this.activeLoads.add(key);
        }
        
        // Return best available texture while loading
        return this.getBestAvailable(hash, optimalLOD);
    }
    
    /**
     * Calculate viewport-aware priority
     */
    calculatePriority(node, screenWidth, screenHeight, targetLOD) {
        if (!this.viewport) return 100; // Low priority if no viewport
        
        // 1. Viewport coverage (0-1, higher = more coverage)
        const screenArea = screenWidth * screenHeight;
        const viewportArea = this.viewport.width * this.viewport.height;
        const coverage = Math.min(1, screenArea / viewportArea);
        
        // 2. Distance from viewport center (0-1, lower = closer)
        const nodeCenter = [
            node.pos[0] + node.size[0] / 2,
            node.pos[1] + node.size[1] / 2
        ];
        const viewport = this.viewport.getViewport();
        const viewportBounds = {
            left: viewport.x,
            top: viewport.y,
            right: viewport.x + viewport.width,
            bottom: viewport.y + viewport.height
        };
        const viewportCenter = [
            (viewportBounds.left + viewportBounds.right) / 2,
            (viewportBounds.top + viewportBounds.bottom) / 2
        ];
        
        const maxDist = Math.sqrt(
            Math.pow(viewportBounds.right - viewportBounds.left, 2) +
            Math.pow(viewportBounds.bottom - viewportBounds.top, 2)
        );
        
        const distance = Math.min(1, 
            Math.sqrt(
                Math.pow(nodeCenter[0] - viewportCenter[0], 2) +
                Math.pow(nodeCenter[1] - viewportCenter[1], 2)
            ) / maxDist
        );
        
        // 3. Visibility (0 or 0.5)
        const visible = this.isNodeInViewport(node) ? 0 : 0.5;
        
        // 4. LOD mismatch penalty (0-1, lower = better match)
        const currentLOD = this.getCurrentLOD(node.properties.hash);
        const lodMismatch = currentLOD !== null ? 
            Math.min(1, Math.abs(targetLOD - currentLOD) / 2048) : 0.5;
        
        // 5. Initial load boost
        const initialBoost = this.isInitialLoad ? -0.2 : 0;
        
        // Combined priority (lower = higher priority)
        // Heavy weight on coverage for zoomed content
        const priority = (
            (1 - coverage) * 0.5 +  // 50% weight on coverage (inverted)
            distance * 0.2 +         // 20% weight on distance
            visible * 0.2 +          // 20% weight on visibility
            lodMismatch * 0.1 +      // 10% weight on LOD match
            initialBoost             // Boost during initial load
        );
        
        // Special case: if node covers >50% of viewport, maximum priority
        if (coverage > 0.5) {
            return 0;
        }
        
        return Math.max(0, Math.min(1, priority));
    }
    
    /**
     * Get optimal LOD for screen size
     */
    getOptimalLOD(screenWidth, screenHeight) {
        const targetSize = Math.max(screenWidth, screenHeight);
        const qualityMultiplier = 1.2; // Slight oversample for quality
        const desiredSize = targetSize * qualityMultiplier;
        
        // Progressive LOD levels with smooth transitions
        if (desiredSize <= 80) return 64;
        if (desiredSize <= 160) return 128;
        if (desiredSize <= 320) return 256;
        if (desiredSize <= 640) return 512;
        if (desiredSize <= 1280) return 1024;
        if (desiredSize <= 2560) return 2048;
        return null; // Full resolution
    }
    
    /**
     * Get best available texture for a hash
     */
    getBestAvailable(hash, targetLOD) {
        let bestTexture = null;
        let bestLOD = null;
        let bestDiff = Infinity;
        
        // Search all cached LODs for this hash
        for (const lod of this.lodLevels) {
            const key = this.getTextureKey(hash, lod);
            if (this.cache.has(key)) {
                const entry = this.cache.get(key);
                const lodValue = lod || 10000; // Treat full res as 10000
                const targetValue = targetLOD || 10000;
                const diff = Math.abs(lodValue - targetValue);
                
                // Prefer lower resolution over higher (faster to display)
                if (diff < bestDiff || (diff === bestDiff && lodValue < (bestLOD || 10000))) {
                    bestTexture = entry.baseTexture;
                    bestLOD = lod;
                    bestDiff = diff;
                }
            }
        }
        
        return bestTexture;
    }
    
    /**
     * Process texture load queue
     */
    async processLoadQueue() {
        const startTime = performance.now();
        const budget = this.isInitialLoad ? 8 : this.loadBudgetMs;
        let processed = 0;
        
        while (this.loadQueue.size() > 0 && 
               performance.now() - startTime < budget) {
            
            const item = this.loadQueue.poll();
            if (!item) break;
            
            // Start loading this texture
            this.loadTexture(item);
            processed++;
            
            // Limit concurrent loads
            const maxConcurrent = this.isInitialLoad ? 6 : 3;
            if (this.activeLoads.size >= maxConcurrent) {
                break;
            }
        }
        
        return processed;
    }
    
    /**
     * Load a texture (placeholder - will integrate with thumbnail system)
     */
    async loadTexture(item) {
        const { hash, lod, key, node } = item;
        
        // Get texture source from thumbnail cache
        let source = null;
        if (window.thumbnailCache && lod !== null) {
            const thumbnails = window.thumbnailCache.getThumbnails(hash);
            source = thumbnails?.get(lod);
        } else if (node.img?.complete) {
            // Full resolution
            source = node.img;
        }
        
        if (!source) {
            // Not available yet - remove from active loads
            this.activeLoads.delete(key);
            return;
        }
        
        // Create WebGL texture (simplified for now)
        try {
            const texture = this.createTexture(source);
            
            // Create cache entry
            const entry = new TextureEntry(hash, lod, this.gl);
            entry.baseTexture = texture;
            entry.width = source.width || source.naturalWidth;
            entry.height = source.height || source.naturalHeight;
            entry.memorySize = entry.width * entry.height * 4 * 1.33; // Include mipmaps
            entry.loadFrame = this.frameId;
            entry.lastAccessFrame = this.frameId;
            
            // Check memory and evict if needed
            await this.ensureMemoryAvailable(entry.memorySize);
            
            // Add to cache
            this.cache.set(key, entry);
            this.currentMemory += entry.memorySize;
            this.stats.texturesLoaded++;
            
            // Mark canvas dirty to trigger redraw
            if (this.canvas) {
                this.canvas.dirty_canvas = true;
            }
        } catch (error) {
            console.error(`Failed to load texture ${key}:`, error);
        } finally {
            this.activeLoads.delete(key);
        }
    }
    
    /**
     * Create WebGL texture from source
     */
    createTexture(source) {
        const gl = this.gl;
        const texture = gl.createTexture();
        
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        
        // High quality filtering
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        
        // Only generate mipmaps for large textures
        const width = source.width || source.naturalWidth || 256;
        const height = source.height || source.naturalHeight || 256;
        
        if (width > 256 || height > 256) {
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else {
            // Small textures don't need mipmaps
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        
        return texture;
    }
    
    /**
     * Ensure enough memory is available
     */
    async ensureMemoryAvailable(requiredMemory) {
        const targetMemory = this.maxMemory * 0.9; // Keep 10% buffer
        
        if (this.currentMemory + requiredMemory <= targetMemory) {
            return; // Enough space
        }
        
        // Need to evict
        const toFree = this.currentMemory + requiredMemory - targetMemory;
        this.evictTextures(toFree);
    }
    
    /**
     * Evict textures based on smart scoring
     */
    evictTextures(bytesToFree) {
        // Build eviction candidates with scores
        const candidates = [];
        
        for (const [key, entry] of this.cache) {
            // Never evict visible textures
            if (entry.isVisible) continue;
            
            // Never evict recently loaded textures
            if (this.frameId - entry.loadFrame < 60) continue;
            
            candidates.push({
                key,
                entry,
                score: this.getEvictionScore(entry)
            });
        }
        
        // Sort by score (higher = evict first)
        candidates.sort((a, b) => b.score - a.score);
        
        let freed = 0;
        const evicted = [];
        
        for (const { key, entry } of candidates) {
            if (freed >= bytesToFree) break;
            
            // Evict this texture
            entry.dispose();
            this.cache.delete(key);
            this.currentMemory -= entry.memorySize;
            freed += entry.memorySize;
            
            // Track eviction to prevent immediate reload
            this.recentlyEvicted.set(key, Date.now());
            evicted.push(key);
            
            this.stats.texturesEvicted++;
        }
        
        // Clean up old eviction records
        const now = Date.now();
        for (const [key, time] of this.recentlyEvicted) {
            if (now - time > this.evictionCooldown) {
                this.recentlyEvicted.delete(key);
            }
        }
        
        return freed;
    }
    
    /**
     * Calculate eviction score (higher = more likely to evict)
     */
    getEvictionScore(entry) {
        const age = this.frameId - entry.lastAccessFrame;
        const accessFrequency = entry.accessCount / Math.max(1, this.frameId - entry.loadFrame);
        const distance = entry.lastViewportDistance;
        const size = entry.memorySize / (1024 * 1024); // Convert to MB
        
        // Weighted scoring
        const score = (
            age * 0.3 +                    // 30% weight on age since last access
            (1 - accessFrequency) * 0.2 +  // 20% weight on access frequency (inverted)
            distance * 0.3 +                // 30% weight on viewport distance
            Math.log(size + 1) * 0.2       // 20% weight on size (logarithmic)
        );
        
        return score;
    }
    
    /**
     * Update viewport information for a node
     */
    updateNodeViewportInfo(node, screenWidth, screenHeight) {
        if (!this.viewport) return;
        
        const hash = node.properties?.hash;
        if (!hash) return;
        
        // Update all cached entries for this hash
        for (const lod of this.lodLevels) {
            const key = this.getTextureKey(hash, lod);
            if (this.cache.has(key)) {
                const entry = this.cache.get(key);
                
                // Calculate viewport metrics
                const screenArea = screenWidth * screenHeight;
                const viewportArea = this.viewport.width * this.viewport.height;
                entry.viewportCoverage = Math.min(1, screenArea / viewportArea);
                
                // Update visibility
                entry.isVisible = this.isNodeInViewport(node);
                
                // Update viewport distance
                const nodeCenter = [
                    node.pos[0] + node.size[0] / 2,
                    node.pos[1] + node.size[1] / 2
                ];
                const viewport = this.viewport.getViewport();
                const viewportBounds = {
                    left: viewport.x,
                    top: viewport.y,
                    right: viewport.x + viewport.width,
                    bottom: viewport.y + viewport.height
                };
                const viewportCenter = [
                    (viewportBounds.left + viewportBounds.right) / 2,
                    (viewportBounds.top + viewportBounds.bottom) / 2
                ];
                
                const maxDist = Math.sqrt(
                    Math.pow(viewportBounds.right - viewportBounds.left, 2) +
                    Math.pow(viewportBounds.bottom - viewportBounds.top, 2)
                );
                
                entry.lastViewportDistance = Math.min(1, 
                    Math.sqrt(
                        Math.pow(nodeCenter[0] - viewportCenter[0], 2) +
                        Math.pow(nodeCenter[1] - viewportCenter[1], 2)
                    ) / maxDist
                );
            }
        }
    }
    
    /**
     * Check if node is in viewport
     */
    isNodeInViewport(node) {
        if (!this.viewport) return false;
        
        const viewport = this.viewport.getViewport();
        const nodeLeft = node.pos[0];
        const nodeTop = node.pos[1];
        const nodeRight = node.pos[0] + node.size[0];
        const nodeBottom = node.pos[1] + node.size[1];
        
        return !(
            nodeRight < viewport.x ||
            nodeLeft > viewport.x + viewport.width ||
            nodeBottom < viewport.y ||
            nodeTop > viewport.y + viewport.height
        );
    }
    
    /**
     * Get current LOD for a hash
     */
    getCurrentLOD(hash) {
        // Find highest resolution currently loaded
        let bestLOD = null;
        
        for (const lod of this.lodLevels.reverse()) {
            const key = this.getTextureKey(hash, lod);
            if (this.cache.has(key)) {
                bestLOD = lod;
                break;
            }
        }
        
        return bestLOD;
    }
    
    /**
     * Generate cache key for texture
     */
    getTextureKey(hash, lod) {
        return `${hash}_${lod || 'full'}`;
    }
    
    /**
     * Set viewport reference
     */
    setViewport(viewport) {
        this.viewport = viewport;
    }
    
    /**
     * Begin new frame
     */
    beginFrame() {
        this.frameId++;
        this.frameStartTime = performance.now();
        
        // Process load queue
        this.processLoadQueue();
    }
    
    /**
     * Get statistics
     */
    getStats() {
        return {
            ...this.stats,
            memoryUsed: this.currentMemory,
            memoryLimit: this.maxMemory,
            cacheSize: this.cache.size,
            queueSize: this.loadQueue.size(),
            activeLoads: this.activeLoads.size
        };
    }
    
    /**
     * Clear all cached textures
     */
    clear() {
        for (const entry of this.cache.values()) {
            entry.dispose();
        }
        this.cache.clear();
        this.loadQueue.clear();
        this.activeLoads.clear();
        this.recentlyEvicted.clear();
        this.currentMemory = 0;
        this.frameId = 0;
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UnifiedTextureManager;
}

if (typeof window !== 'undefined') {
    window.UnifiedTextureManager = UnifiedTextureManager;
}