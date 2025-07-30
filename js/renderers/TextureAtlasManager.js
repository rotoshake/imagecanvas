/**
 * TextureAtlasManager - Packs small thumbnails into texture atlases for efficient rendering
 * Reduces texture switches and draw calls when rendering many small images
 */
class TextureAtlasManager {
    constructor(gl, options = {}) {
        if (!gl) {
            throw new Error('TextureAtlasManager requires a valid WebGL context');
        }
        this.gl = gl;
        
        // Configuration
        this.atlasSize = options.atlasSize || 4096; // 4K atlas
        this.thumbnailSize = options.thumbnailSize || 64; // Size of packed thumbnails
        this.padding = options.padding || 2; // Padding between thumbnails to prevent bleeding
        
        // Calculate grid dimensions
        this.cellSize = this.thumbnailSize + this.padding * 2;
        this.gridSize = Math.floor(this.atlasSize / this.cellSize);
        this.maxThumbnails = this.gridSize * this.gridSize;
        
        // Atlas storage
        this.atlases = []; // Array of atlas objects
        this.thumbnailMap = new Map(); // hash -> { atlasIndex, x, y, width, height }
        
        // Current atlas being filled
        this.currentAtlas = null;
        this.currentAtlasIndex = -1;
        
        // Pending thumbnails to pack
        this.packQueue = [];
        
        console.log(`Atlas Manager: ${this.gridSize}x${this.gridSize} grid, ${this.maxThumbnails} thumbnails per atlas`);
    }
    
    /**
     * Get atlas texture and UV coordinates for a thumbnail
     * @param {string} hash - Image hash
     * @returns {Object|null} { texture, uvs: [u0,v0, u1,v0, u0,v1, u1,v1] }
     */
    getThumbnailLocation(hash) {
        const location = this.thumbnailMap.get(hash);
        if (!location) return null;
        
        const atlas = this.atlases[location.atlasIndex];
        if (!atlas || !atlas.texture) return null;
        
        // Calculate UV coordinates
        const u0 = (location.x + this.padding) / this.atlasSize;
        const v0 = (location.y + this.padding) / this.atlasSize;
        const u1 = (location.x + this.padding + this.thumbnailSize) / this.atlasSize;
        const v1 = (location.y + this.padding + this.thumbnailSize) / this.atlasSize;
        
        return {
            texture: atlas.texture,
            uvs: [u0, v0, u1, v0, u0, v1, u1, v1],
            atlasIndex: location.atlasIndex
        };
    }
    
    /**
     * Request to pack a thumbnail into an atlas
     * @param {string} hash - Image hash
     * @param {HTMLCanvasElement|HTMLImageElement} source - Thumbnail source
     * @param {Function} callback - Called when packing is complete
     */
    requestPacking(hash, source, callback) {
        // Check if already packed
        if (this.thumbnailMap.has(hash)) {
            if (callback) callback(true);
            return;
        }
        
        // Add to pack queue
        this.packQueue.push({ hash, source, callback });
    }
    
    /**
     * Process packing queue within frame budget
     * @param {number} budgetMs - Time budget in milliseconds
     * @returns {number} Number of thumbnails packed
     */
    processPacking(budgetMs = 2) {
        const startTime = performance.now();
        let packed = 0;
        
        while (this.packQueue.length > 0 && 
               performance.now() - startTime < budgetMs) {
            const item = this.packQueue.shift();
            if (!item) break;
            
            if (this._packThumbnail(item)) {
                packed++;
                if (item.callback) item.callback(true);
            } else {
                if (item.callback) item.callback(false);
            }
        }
        
        return packed;
    }
    
    /**
     * Pack a single thumbnail into the current atlas
     * @private
     */
    _packThumbnail(item) {
        const { hash, source } = item;
        
        // Ensure we have a current atlas
        if (!this.currentAtlas) {
            this._createNewAtlas();
        }
        
        // Find next available slot
        const slot = this._findNextSlot();
        if (!slot) {
            // Current atlas is full, create new one
            this._createNewAtlas();
            return this._packThumbnail(item); // Retry with new atlas
        }
        
        // Draw thumbnail to atlas canvas
        const ctx = this.currentAtlas.ctx;
        const x = slot.x * this.cellSize + this.padding;
        const y = slot.y * this.cellSize + this.padding;
        
        try {
            // Clear the cell area (in case of reuse)
            ctx.clearRect(
                slot.x * this.cellSize, 
                slot.y * this.cellSize, 
                this.cellSize, 
                this.cellSize
            );
            
            // Draw the thumbnail
            ctx.drawImage(source, x, y, this.thumbnailSize, this.thumbnailSize);
            
            // Mark slot as used
            this.currentAtlas.usedSlots.add(`${slot.x},${slot.y}`);
            
            // Store location
            this.thumbnailMap.set(hash, {
                atlasIndex: this.currentAtlasIndex,
                x: slot.x * this.cellSize,
                y: slot.y * this.cellSize,
                width: this.thumbnailSize,
                height: this.thumbnailSize
            });
            
            // Mark atlas as dirty (needs texture update)
            this.currentAtlas.dirty = true;
            
            return true;
        } catch (error) {
            console.error('Failed to pack thumbnail:', error);
            return false;
        }
    }
    
    /**
     * Create a new atlas
     * @private
     */
    _createNewAtlas() {
        const canvas = document.createElement('canvas');
        canvas.width = this.atlasSize;
        canvas.height = this.atlasSize;
        const ctx = canvas.getContext('2d');
        
        // Clear to transparent
        ctx.clearRect(0, 0, this.atlasSize, this.atlasSize);
        
        // Create WebGL texture
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        
        // Initial texture setup (empty)
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.RGBA, 
            this.atlasSize, this.atlasSize, 0, 
            gl.RGBA, gl.UNSIGNED_BYTE, null
        );
        
        // Set texture parameters
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        
        const atlas = {
            canvas,
            ctx,
            texture,
            usedSlots: new Set(),
            dirty: false,
            lastUpdate: 0
        };
        
        this.atlases.push(atlas);
        this.currentAtlas = atlas;
        this.currentAtlasIndex = this.atlases.length - 1;
        
        console.log(`Created new texture atlas ${this.currentAtlasIndex}`);
    }
    
    /**
     * Find next available slot in current atlas
     * @private
     */
    _findNextSlot() {
        if (!this.currentAtlas) return null;
        
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const key = `${x},${y}`;
                if (!this.currentAtlas.usedSlots.has(key)) {
                    return { x, y };
                }
            }
        }
        
        return null; // Atlas is full
    }
    
    /**
     * Update dirty atlas textures
     * Should be called once per frame before rendering
     */
    updateTextures() {
        const gl = this.gl;
        
        for (const atlas of this.atlases) {
            if (!atlas.dirty) continue;
            
            // Update texture from canvas
            gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
            gl.texImage2D(
                gl.TEXTURE_2D, 0, gl.RGBA, 
                gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas
            );
            
            atlas.dirty = false;
            atlas.lastUpdate = Date.now();
        }
    }
    
    /**
     * Get all thumbnails in a specific atlas (for batched rendering)
     * @param {number} atlasIndex - Atlas index
     * @returns {Array} Array of { hash, x, y, width, height }
     */
    getThumbnailsInAtlas(atlasIndex) {
        const thumbnails = [];
        
        for (const [hash, location] of this.thumbnailMap) {
            if (location.atlasIndex === atlasIndex) {
                thumbnails.push({ hash, ...location });
            }
        }
        
        return thumbnails;
    }
    
    /**
     * Remove a thumbnail from all atlases
     * @param {string} hash - Image hash
     */
    removeThumbnail(hash) {
        const location = this.thumbnailMap.get(hash);
        if (!location) return;
        
        const atlas = this.atlases[location.atlasIndex];
        if (!atlas) return;
        
        // Clear the thumbnail area
        const x = Math.floor(location.x / this.cellSize);
        const y = Math.floor(location.y / this.cellSize);
        atlas.usedSlots.delete(`${x},${y}`);
        
        // Clear on canvas
        atlas.ctx.clearRect(location.x, location.y, this.cellSize, this.cellSize);
        atlas.dirty = true;
        
        // Remove from map
        this.thumbnailMap.delete(hash);
    }
    
    /**
     * Clear all atlases
     */
    clear() {
        const gl = this.gl;
        
        for (const atlas of this.atlases) {
            gl.deleteTexture(atlas.texture);
        }
        
        this.atlases = [];
        this.thumbnailMap.clear();
        this.currentAtlas = null;
        this.currentAtlasIndex = -1;
        this.packQueue = [];
    }
    
    /**
     * Get statistics
     */
    getStats() {
        let totalThumbnails = 0;
        let totalSlots = 0;
        
        for (const atlas of this.atlases) {
            totalThumbnails += atlas.usedSlots.size;
            totalSlots += this.maxThumbnails;
        }
        
        return {
            atlasCount: this.atlases.length,
            totalThumbnails,
            totalSlots,
            utilization: totalSlots > 0 ? (totalThumbnails / totalSlots) : 0,
            queueLength: this.packQueue.length
        };
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TextureAtlasManager;
}

// Make available globally for browser environments
if (typeof window !== 'undefined') {
    window.TextureAtlasManager = TextureAtlasManager;
}