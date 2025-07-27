// ===================================
// CACHING SYSTEM
// ===================================

class ImageCache {
    constructor() {
        this.memoryCache = new Map();
        this.db = null;
        this.dbName = 'ImageCanvasCache';
        this.storeName = 'images';
        this.maxMemoryItems = 100; // Limit memory cache size
    }
    
    async init() {
        try {
            this.db = await this.openDB();
            console.log('Image cache initialized with IndexedDB support');
        } catch (error) {
            console.warn('IndexedDB not available, using memory cache only:', error);
        }
    }
    
    openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    set(key, value) {
        // Manage memory cache size
        if (this.memoryCache.size >= this.maxMemoryItems) {
            const firstKey = this.memoryCache.keys().next().value;
            this.memoryCache.delete(firstKey);
        }
        
        this.memoryCache.set(key, value);
        
        if (this.db) {
            this.putToDB(key, value).catch(error => {
                console.warn('Failed to store in IndexedDB:', error);
            });
        }
    }
    
    get(key) {
        return this.memoryCache.get(key);
    }
    
    has(key) {
        return this.memoryCache.has(key);
    }
    
    async getFromDB(key) {
        if (!this.db) return null;
        
        try {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);
            
            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    const result = request.result;
                    if (result) {
                        // Also cache in memory for faster access
                        this.memoryCache.set(key, result);
                    }
                    resolve(result);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.warn('Failed to retrieve from IndexedDB:', error);
            return null;
        }
    }
    
    async putToDB(key, value) {
        if (!this.db) return;
        
        try {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            await store.put(value, key);
        } catch (error) {
            console.warn('Failed to store in IndexedDB:', error);
        }
    }
    
    clear() {
        this.memoryCache.clear();
        
        if (this.db) {
            try {
                const transaction = this.db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                store.clear();
            } catch (error) {
                console.warn('Failed to clear IndexedDB:', error);
            }
        }
    }
    
    getStats() {
        return {
            memorySize: this.memoryCache.size,
            maxMemoryItems: this.maxMemoryItems,
            hasIndexedDB: !!this.db
        };
    }
}

// ===================================
// GLOBAL THUMBNAIL CACHE
// ===================================

class ThumbnailCache {
    constructor() {
        // Structure: hash -> { 64: canvas, 128: canvas, 256: canvas, ... }
        this.cache = new Map();
        this.generationQueues = new Map(); // Track ongoing generation to avoid duplication
        this.thumbnailSizes = [64, 128, 256, 512, 1024, 2048];
        
        // Bundled tracking removed - now handled by unified progress system
    }
    
    // Get thumbnails for a specific hash (returns Map of size -> canvas)
    getThumbnails(hash) {
        return this.cache.get(hash) || new Map();
    }
    
    // Get a specific thumbnail size for a hash
    getThumbnail(hash, size) {
        const thumbnails = this.cache.get(hash);
        return thumbnails ? thumbnails.get(size) : null;
    }
    
    // Check if thumbnails exist for a hash
    hasThumbnails(hash) {
        return this.cache.has(hash) && this.cache.get(hash).size > 0;
    }
    
    // Check if a specific size exists for a hash
    hasThumbnail(hash, size) {
        const thumbnails = this.cache.get(hash);
        return thumbnails ? thumbnails.has(size) : false;
    }
    
    // Get all available sizes for a hash
    getAvailableSizes(hash) {
        const thumbnails = this.cache.get(hash);
        return thumbnails ? Array.from(thumbnails.keys()) : [];
    }
    
    // Store a thumbnail
    setThumbnail(hash, size, canvas) {
        if (!this.cache.has(hash)) {
            this.cache.set(hash, new Map());
        }
        this.cache.get(hash).set(size, canvas);
    }
    
    // Generate thumbnails progressively with queue management
    async generateThumbnailsProgressive(hash, sourceImage, progressCallback = null) {
        // Check if already generating for this hash
        if (this.generationQueues.has(hash)) {
            // Return the existing promise
            return this.generationQueues.get(hash);
        }
        
        // Check if thumbnails already exist in memory
        if (this.hasThumbnails(hash)) {
            return this.getThumbnails(hash);
        }
        
        // NEW: Check IndexedDB first
        if (window.indexedDBThumbnailStore && window.indexedDBThumbnailStore.isAvailable) {
            try {
                const storedThumbnails = await window.indexedDBThumbnailStore.getThumbnails(hash);
                if (storedThumbnails) {
                    // Convert object to Map format
                    const thumbnailMap = new Map();
                    Object.entries(storedThumbnails).forEach(([size, canvas]) => {
                        thumbnailMap.set(parseInt(size), canvas);
                    });
                    
                    // Cache in memory
                    this.cache.set(hash, thumbnailMap);
                    
                    console.log(`💾 Loaded thumbnails for ${hash.substring(0, 8)}... from IndexedDB`);
                    
                    // Report completion
                    if (progressCallback) progressCallback(1);
                    if (window.imageProcessingProgress) {
                        window.imageProcessingProgress.updateThumbnailProgress(hash, 1);
                    }
                    
                    return thumbnailMap;
                }
            } catch (error) {
                console.warn('Failed to load from IndexedDB:', error);
            }
        }
        
        // Try to load from server thumbnails
        const serverThumbnails = await this._loadServerThumbnails(hash, sourceImage);
        if (serverThumbnails && serverThumbnails.size > 0) {
            // Loaded thumbnails from server
            this.cache.set(hash, serverThumbnails);
            
            // Store in IndexedDB for next time
            this._storeToIndexedDB(hash, serverThumbnails);
            
            // Report completion to unified progress system
            if (window.imageProcessingProgress) {
                window.imageProcessingProgress.updateThumbnailProgress(hash, 1);
            }
            
            return serverThumbnails;
        }
        
        // Generating thumbnails client-side
        
        // Bundle tracking now handled by unified progress system
        const generationPromise = this._generateThumbnailsInternal(hash, sourceImage, progressCallback);
        this.generationQueues.set(hash, generationPromise);
        
        try {
            const result = await generationPromise;
            // Store generated thumbnails to IndexedDB
            this._storeToIndexedDB(hash, result);
            return result;
        } finally {
            this.generationQueues.delete(hash);
        }
    }
    
    async _generateThumbnailsInternal(hash, sourceImage, progressCallback = null) {
        const thumbnails = new Map();
        this.cache.set(hash, thumbnails);
        
        // Phase 1: Generate essential small thumbnails immediately (64px, 128px)
        const essentialSizes = [64, 128];
        for (let i = 0; i < essentialSizes.length; i++) {
            const size = essentialSizes[i];
            const canvas = this._generateSingleThumbnail(sourceImage, size);
            thumbnails.set(size, canvas);
            
            const progress = 0.3 + (0.3 * (i + 1) / essentialSizes.length);
            if (progressCallback) {
                progressCallback(progress); // 30-60%
            }
            // Report to unified progress system
            if (window.imageProcessingProgress) {
                window.imageProcessingProgress.updateThumbnailProgress(hash, progress);
            }
        }
        
        // Yield control after essential thumbnails
        await new Promise(resolve => requestAnimationFrame(resolve));
        
        // Phase 2: Generate remaining thumbnails with yielding
        const remainingSizes = [256, 512, 1024, 2048];
        for (let i = 0; i < remainingSizes.length; i++) {
            const size = remainingSizes[i];
            
            // Use progressively larger delays for bigger thumbnails
            const delay = size <= 256 ? 8 : size <= 512 ? 12 : 16;
            await new Promise(resolve => {
                setTimeout(() => {
                    const canvas = this._generateSingleThumbnail(sourceImage, size);
                    thumbnails.set(size, canvas);
                    
                    const progress = 0.6 + (0.4 * (i + 1) / remainingSizes.length);
                    if (progressCallback) {
                        progressCallback(progress); // 60-100%
                    }
                    // Report to unified progress system
                    if (window.imageProcessingProgress) {
                        window.imageProcessingProgress.updateThumbnailProgress(hash, progress);
                    }
                    resolve();
                }, delay);
            });
        }
        
        // Report completion to unified progress system
        if (window.imageProcessingProgress) {
            window.imageProcessingProgress.updateThumbnailProgress(hash, 1);
        }
        
        return thumbnails;
    }
    
    _generateSingleThumbnail(sourceImage, size) {
        // Calculate dimensions maintaining aspect ratio
        let width = sourceImage.width || sourceImage.videoWidth;
        let height = sourceImage.height || sourceImage.videoHeight;
        
        if (width > height && width > size) {
            height = Math.round(height * (size / width));
            width = size;
        } else if (height > width && height > size) {
            width = Math.round(width * (size / height));
            height = size;
        } else if (Math.max(width, height) > size) {
            const scale = size / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
        }
        
        // Create canvas with proper size from the start
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        // Simply draw the image - canvas starts transparent by default
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
        ctx.drawImage(sourceImage, 0, 0, width, height);
        
        return canvas;
    }
    
    // Get best thumbnail for target size
    getBestThumbnail(hash, targetWidth, targetHeight) {
        const thumbnails = this.getThumbnails(hash);
        if (thumbnails.size === 0) return null;
        
        const targetSize = Math.max(targetWidth, targetHeight);
        
        // Find the best thumbnail, prioritizing those that meet quality needs
        for (let i = this.thumbnailSizes.length - 1; i >= 0; i--) {
            const size = this.thumbnailSizes[i];
            if (thumbnails.has(size)) {
                const thumbnail = thumbnails.get(size);
                const thumbnailSize = Math.max(thumbnail.width, thumbnail.height);
                
                // If this thumbnail is good enough quality (>= 90% of target), use it
                if (thumbnailSize >= targetSize * 0.9) {
                    return thumbnail;
                }
            }
        }
        
        // If no thumbnail meets the quality threshold, return the largest available
        let largestReady = null;
        let largestSize = 0;
        for (const size of this.thumbnailSizes) {
            if (thumbnails.has(size)) {
                const thumbnail = thumbnails.get(size);
                const thumbnailSize = Math.max(thumbnail.width, thumbnail.height);
                if (thumbnailSize > largestSize) {
                    largestSize = thumbnailSize;
                    largestReady = thumbnail;
                }
            }
        }
        
        return largestReady;
    }
    
    // Clear all thumbnails
    clear() {
        this.cache.clear();
        this.generationQueues.clear();
        // Bundle tracking no longer needed - handled by unified progress system
    }
    
    // Store thumbnails to IndexedDB
    async _storeToIndexedDB(hash, thumbnails) {
        if (!window.indexedDBThumbnailStore || !window.indexedDBThumbnailStore.isAvailable) {
            return;
        }
        
        try {
            // Convert Map to object format
            const thumbnailObj = {};
            for (const [size, canvas] of thumbnails) {
                thumbnailObj[size] = canvas;
            }
            
            // Find server filename if available
            let serverFilename = null;
            if (window.app && window.app.graph) {
                const imageNode = window.app.graph.nodes.find(node => 
                    node.type === 'media/image' && node.properties?.hash === hash
                );
                if (imageNode?.properties?.serverFilename) {
                    serverFilename = imageNode.properties.serverFilename;
                }
            }
            
            await window.indexedDBThumbnailStore.set(hash, thumbnailObj, serverFilename);
        } catch (error) {
            console.warn('Failed to store thumbnails to IndexedDB:', error);
        }
    }
    
    // Get cache statistics
    getStats() {
        const totalHashes = this.cache.size;
        let totalThumbnails = 0;
        let memoryUsage = 0;
        
        for (const [hash, thumbnails] of this.cache) {
            totalThumbnails += thumbnails.size;
            for (const [size, canvas] of thumbnails) {
                memoryUsage += canvas.width * canvas.height * 4; // 4 bytes per pixel
            }
        }
        
        return {
            totalHashes,
            totalThumbnails,
            memoryUsageMB: memoryUsage / (1024 * 1024),
            activeGenerations: this.generationQueues.size
        };
    }
    
    /**
     * Try to load thumbnails from server first
     */
    async _loadServerThumbnails(hash, sourceImage) {
        // Extract server filename from image node properties
        let serverFilename = null;
        
        if (window.app && window.app.graph) {
            // Find the image node with this hash
            const imageNode = window.app.graph.nodes.find(node => 
                node.type === 'media/image' && node.properties?.hash === hash
            );
            
            if (imageNode) {
                // Try to extract server filename from serverUrl
                if (imageNode.properties?.serverUrl) {
                    const urlParts = imageNode.properties.serverUrl.split('/');
                    serverFilename = urlParts[urlParts.length - 1]; // Get filename from URL
                    // Extracted server filename from serverUrl
                }
                // Fallback: check if we have serverFilename property directly
                else if (imageNode.properties?.serverFilename) {
                    serverFilename = imageNode.properties.serverFilename;
                    // Using stored serverFilename
                }
            }
        }
        
        if (!serverFilename) {
            // No server filename found - cannot load server thumbnails
            return null;
        }
        
        // Remove extension from server filename (e.g., "1753408409158-444qmr.jpg" -> "1753408409158-444qmr")
        const nameWithoutExt = serverFilename.includes('.') 
            ? serverFilename.substring(0, serverFilename.lastIndexOf('.'))
            : serverFilename;
        
        // Attempting to load server thumbnails
        
        const thumbnails = new Map();
        const loadPromises = [];
        
        // Try to load each thumbnail size from server
        for (const size of this.thumbnailSizes) {
            const promise = this._loadSingleServerThumbnail(size, nameWithoutExt)
                .then(canvas => {
                    if (canvas) {
                        thumbnails.set(size, canvas);
                        // Loaded server thumbnail
                    }
                })
                .catch(error => {
                    // Silently fail for individual thumbnails
                    // Server thumbnail not available
                });
            loadPromises.push(promise);
        }
        
        // Wait for all thumbnail loads to complete
        await Promise.all(loadPromises);
        
        // Server thumbnail loading complete
        return thumbnails.size > 0 ? thumbnails : null;
    }
    
    /**
     * Load a single thumbnail from server with retry logic
     */
    async _loadSingleServerThumbnail(size, nameWithoutExt, retryCount = 0) {
        // Note: Server should generate WebP with alpha channel support (-exact flag in cwebp)
        const thumbnailUrl = `${CONFIG.SERVER.API_BASE}/thumbnails/${size}/${nameWithoutExt}.webp`;
        
        try {
            const result = await this._loadImageWithTimeout(thumbnailUrl, 10000); // 10 second timeout
            if (result) {
                return result;
            }
            
            // Retry logic with exponential backoff
            if (retryCount < 3) {
                const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
                console.log(`⏳ Retrying thumbnail ${size}px after ${delay}ms (attempt ${retryCount + 1}/3)`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this._loadSingleServerThumbnail(size, nameWithoutExt, retryCount + 1);
            }
            
            return null;
        } catch (error) {
            console.warn(`Failed to load ${size}px thumbnail from server:`, error);
            return null;
        }
    }
    
    /**
     * Load image with timeout helper
     */
    async _loadImageWithTimeout(url, timeout = 10000) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            let timeoutId = null;
            let loaded = false;
            
            const cleanup = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
            };
            
            img.onload = () => {
                if (loaded) return;
                loaded = true;
                cleanup();
                
                try {
                    // Create canvas and draw the server thumbnail
                    const canvas = Utils.createCanvas(img.width, img.height);
                    const ctx = canvas.getContext('2d', { alpha: true });
                    
                    // Ensure canvas is transparent before drawing
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    
                    // Draw image preserving alpha channel
                    ctx.drawImage(img, 0, 0);
                    
                    
                    resolve(canvas);
                } catch (error) {
                    console.warn(`Failed to create canvas:`, error);
                    resolve(null);
                }
            };
            
            img.onerror = () => {
                if (loaded) return;
                loaded = true;
                cleanup();
                resolve(null);
            };
            
            // Set timeout
            timeoutId = setTimeout(() => {
                if (!loaded) {
                    loaded = true;
                    img.src = ''; // Cancel load
                    console.warn(`Timeout loading thumbnail from ${url}`);
                    resolve(null);
                }
            }, timeout);
            
            img.src = url;
        });
    }
    
    // Legacy bundle methods removed - now handled by unified progress system
}