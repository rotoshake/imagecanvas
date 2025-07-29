// ===================================
// CACHING SYSTEM
// ===================================

class ImageCache {
    constructor() {
        this.memoryCache = new Map();
        this.db = null;
        this.dbName = 'ImageCanvasCache';
        this.storeName = 'images';
        this.maxMemoryItems = 100; // Balanced for performance without excessive memory usage
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
        this.subscribers = new Map(); // For notifying nodes of updates
        this.thumbnailSizes = CONFIG.THUMBNAILS.SIZES || [64, 256, 512]; // Use config sizes
        // Dynamically set priority and quality sizes from config
        this.prioritySizes = this.thumbnailSizes.slice(0, 1); // Smallest size is priority
        this.qualitySizes = this.thumbnailSizes.slice(1); // The rest are for quality
        
        // Memory management - significantly increased to prevent cache thrashing
        this.maxHashEntries = 5000; // Much higher limit to utilize available memory
        this.maxMemoryBytes = 1 * 1024 * 1024 * 1024; // 1GB for thumbnails (half of total 2GB)
        this.currentMemoryUsage = 0; // Track actual memory usage
        this.accessOrder = new Map(); // Track access order for LRU eviction
        this.lastCleanup = Date.now();
        this.cleanupInterval = 120000; // Cleanup every 2 minutes (less frequent to reduce overhead)
        
        // Throttling for performance
        this.activeGenerations = 0;
        this.maxConcurrentGenerations = 2; // Limit concurrent thumbnail generation
        this.generationQueue = []; // Queue for pending generations
        this.lowPriorityQueue = []; // Separate queue for low priority (preload) requests
        this.frameRateThrottle = 16; // Minimum 16ms between operations to maintain 60fps
        
        console.log(`🧹 ThumbnailCache initialized with ${this.maxHashEntries} entries / ${(this.maxMemoryBytes / (1024 * 1024)).toFixed(0)}MB limit`);
    }
    
    // Get thumbnails for a specific hash (returns Map of size -> canvas)
    getThumbnails(hash) {
        this._trackAccess(hash);
        return this.cache.get(hash) || new Map();
    }
    
    // Get a specific thumbnail size for a hash
    getThumbnail(hash, size) {
        // PERFORMANCE: Skip access tracking during renders for speed
        const thumbnails = this.cache.get(hash);
        return thumbnails ? thumbnails.get(size) : null;
    }
    
    // Track access for LRU eviction
    _trackAccess(hash) {
        if (this.cache.has(hash)) {
            // Update access time
            this.accessOrder.set(hash, Date.now());
        }
        
        // Periodic cleanup check
        const now = Date.now();
        if (now - this.lastCleanup > this.cleanupInterval) {
            this._performCleanup();
        }
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
    
    // Store a thumbnail (with memory management)
    setThumbnail(hash, size, canvas) {
        if (!this.cache.has(hash)) {
            this.cache.set(hash, new Map());
            this.accessOrder.set(hash, Date.now());
        }
        
        const thumbnails = this.cache.get(hash);
        const oldCanvas = thumbnails.get(size);
        
        // Update memory tracking
        if (oldCanvas) {
            this.currentMemoryUsage -= this._calculateCanvasMemory(oldCanvas);
        }
        this.currentMemoryUsage += this._calculateCanvasMemory(canvas);
        
        thumbnails.set(size, canvas);
        this._trackAccess(hash);
        this._notify(hash); // Notify subscribers that a new thumbnail is available
        
        // Check if we need to evict based on memory OR count
        if (this.currentMemoryUsage > this.maxMemoryBytes || this.cache.size > this.maxHashEntries) {
            this._evictOldEntries();
        }
    }
    
    // Calculate memory usage of a canvas
    _calculateCanvasMemory(canvas) {
        return canvas.width * canvas.height * 4; // 4 bytes per pixel (RGBA)
    }
    
    // Perform smart eviction with viewport awareness
    _evictOldEntries() {
        // Determine if we need to evict based on count or memory
        const needCountEviction = this.cache.size > this.maxHashEntries;
        const needMemoryEviction = this.currentMemoryUsage > this.maxMemoryBytes;
        
        if (!needCountEviction && !needMemoryEviction) return;
        
        // Calculate targets
        const entriesToRemove = needCountEviction ? this.cache.size - this.maxHashEntries : 0;
        const memoryToFree = needMemoryEviction ? this.currentMemoryUsage - (this.maxMemoryBytes * 0.9) : 0; // Free to 90% of limit
        
        // Get currently visible nodes to protect them from eviction
        const visibleHashes = this._getVisibleNodeHashes();
        
        // Sort entries by priority: visible nodes last (lowest priority for eviction)
        const sortedEntries = Array.from(this.accessOrder.entries())
            .map(([hash, accessTime]) => ({
                hash,
                accessTime,
                isVisible: visibleHashes.has(hash),
                priority: visibleHashes.has(hash) ? 1000000 + accessTime : accessTime // Visible nodes get high priority
            }))
            .sort((a, b) => a.priority - b.priority); // Lowest priority first (oldest non-visible)
        
        let removed = 0;
        let freedMemory = 0;
        
        for (const entry of sortedEntries) {
            // Check if we've met our targets
            if (removed >= entriesToRemove && freedMemory >= memoryToFree) break;
            
            const { hash, accessTime, isVisible } = entry;
            
            // Skip visible nodes unless we're under extreme memory pressure
            if (isVisible && freedMemory < memoryToFree * 0.8) {
                continue;
            }
            
            // Clean up canvas elements to free memory
            const thumbnails = this.cache.get(hash);
            if (thumbnails) {
                let hashMemory = 0;
                for (const [size, canvas] of thumbnails) {
                    hashMemory += this._calculateCanvasMemory(canvas);
                    // Clear canvas to help GC
                    if (canvas && canvas.getContext) {
                        const ctx = canvas.getContext('2d');
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                    }
                }
                freedMemory += hashMemory;
                this.currentMemoryUsage -= hashMemory;
            }
            
            this.cache.delete(hash);
            this.accessOrder.delete(hash);
            removed++;
        }
        
        console.log(`🧹 Evicted ${removed} entries, freed ${(freedMemory / (1024 * 1024)).toFixed(1)}MB. Cache: ${this.cache.size} entries, ${(this.currentMemoryUsage / (1024 * 1024)).toFixed(1)}MB`);
    }
    
    // Get hashes of currently visible nodes
    _getVisibleNodeHashes() {
        const visibleHashes = new Set();
        
        try {
            if (window.app?.graph?.nodes && window.app?.graphCanvas?.viewport) {
                const viewport = window.app.graphCanvas.viewport;
                const nodes = window.app.graph.nodes;
                
                // Get viewport bounds with some padding
                const padding = 200; // Extra padding to preload nearby images
                const viewBounds = {
                    left: -viewport.offset[0] - padding,
                    top: -viewport.offset[1] - padding,
                    right: -viewport.offset[0] + viewport.canvas.width / viewport.scale + padding,
                    bottom: -viewport.offset[1] + viewport.canvas.height / viewport.scale + padding
                };
                
                // Check which nodes are visible or near-visible
                for (const node of nodes) {
                    if (node.type === 'media/image' && node.properties?.hash) {
                        const [x, y] = node.pos;
                        const [w, h] = node.size;
                        
                        // Check if node intersects with padded viewport
                        if (x + w >= viewBounds.left && x <= viewBounds.right &&
                            y + h >= viewBounds.top && y <= viewBounds.bottom) {
                            visibleHashes.add(node.properties.hash);
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('Failed to get visible node hashes:', error);
        }
        
        return visibleHashes;
    }
    
    // Periodic cleanup
    _performCleanup() {
        this.lastCleanup = Date.now();
        
        // Force eviction if over limit
        if (this.cache.size > this.maxHashEntries) {
            this._evictOldEntries();
        }
        
        // Clean up any stale generation queues
        for (const [hash, promise] of this.generationQueues) {
            if (promise._timestamp && (Date.now() - promise._timestamp) > 60000) {
                console.log(`🧹 Cleaning up stale generation queue for ${hash.substring(0, 8)}...`);
                this.generationQueues.delete(hash);
            }
        }
    }
    
    // Generate thumbnails progressively with queue management
    async generateThumbnailsProgressive(hash, sourceImage, progressCallback = null, priority = 'normal') {
        // Check if already generating for this hash
        if (this.generationQueues.has(hash)) {
            // Return the existing promise
            return this.generationQueues.get(hash);
        }
        
        // Check if thumbnails already exist in memory
        if (this.hasThumbnails(hash)) {
            return this.getThumbnails(hash);
        }
        
        // Throttle concurrent generations to maintain performance
        if (this.activeGenerations >= this.maxConcurrentGenerations) {
            return new Promise((resolve) => {
                const queueItem = {
                    hash,
                    sourceImage,
                    progressCallback,
                    priority,
                    resolve
                };
                
                // Add to appropriate queue based on priority
                if (priority === 'low') {
                    this.lowPriorityQueue.push(queueItem);
                    console.log(`⏳ Queued low-priority thumbnail generation for ${hash.substring(0, 8)}... (low queue: ${this.lowPriorityQueue.length})`);
                } else {
                    this.generationQueue.push(queueItem);
                    console.log(`⏳ Queued thumbnail generation for ${hash.substring(0, 8)}... (queue: ${this.generationQueue.length})`);
                }
            });
        }
        
        // NEW: Check IndexedDB first
        if (window.indexedDBThumbnailStore && window.indexedDBThumbnailStore.isAvailable) {
            try {
                const storedThumbnails = await window.indexedDBThumbnailStore.getThumbnails(hash);
                if (storedThumbnails) {
                    // Convert object to Map format
                    const thumbnailMap = new Map();
                    let loadedMemory = 0;
                    Object.entries(storedThumbnails).forEach(([size, canvas]) => {
                        thumbnailMap.set(parseInt(size), canvas);
                        loadedMemory += this._calculateCanvasMemory(canvas);
                    });
                    
                    // Cache in memory and update memory tracking
                    this.cache.set(hash, thumbnailMap);
                    this.currentMemoryUsage += loadedMemory;
                    this.accessOrder.set(hash, Date.now());
                    
                    
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
            // Calculate memory for loaded thumbnails
            let loadedMemory = 0;
            for (const [size, canvas] of serverThumbnails) {
                loadedMemory += this._calculateCanvasMemory(canvas);
            }
            
            // Loaded thumbnails from server
            this.cache.set(hash, serverThumbnails);
            this.currentMemoryUsage += loadedMemory;
            this.accessOrder.set(hash, Date.now());
            
            // Store in IndexedDB for next time
            this._storeToIndexedDB(hash, serverThumbnails);
            
            // Report completion to unified progress system
            if (window.imageProcessingProgress) {
                window.imageProcessingProgress.updateThumbnailProgress(hash, 1);
            }
            
            return serverThumbnails;
        }
        
        // Generating thumbnails client-side with throttling
        this.activeGenerations++;
        console.log(`🎬 Starting thumbnail generation for ${hash.substring(0, 8)}... (active: ${this.activeGenerations})`);
        
        const generationPromise = this._generateThumbnailsInternal(hash, sourceImage, progressCallback, priority);
        this.generationQueues.set(hash, generationPromise);
        
        try {
            const result = await generationPromise;
            // Store generated thumbnails to IndexedDB
            this._storeToIndexedDB(hash, result);
            return result;
        } finally {
            this.generationQueues.delete(hash);
            this.activeGenerations--;
            
            // Process next item in queue
            this._processNextInQueue();
        }
    }
    
    /**
     * Process the next item in the generation queue
     */
    _processNextInQueue() {
        if (this.activeGenerations >= this.maxConcurrentGenerations) return;
        
        // Process normal/high priority queue first
        if (this.generationQueue.length > 0) {
            const { hash, sourceImage, progressCallback, priority, resolve } = this.generationQueue.shift();
            
            console.log(`🎬 Processing queued thumbnail generation for ${hash.substring(0, 8)}... (remaining: ${this.generationQueue.length})`);
            
            // Process the queued item directly (avoid recursion)
            this._generateThumbnailsInternal(hash, sourceImage, progressCallback, priority)
                .then(resolve)
                .catch(error => {
                    console.error(`❌ Queued thumbnail generation failed for ${hash.substring(0, 8)}...`, error);
                    resolve(new Map()); // Return empty map on failure
                });
        }
        // Then process low priority queue if no normal priority items
        else if (this.lowPriorityQueue.length > 0) {
            const { hash, sourceImage, progressCallback, priority, resolve } = this.lowPriorityQueue.shift();
            
            console.log(`🎬 Processing low-priority thumbnail generation for ${hash.substring(0, 8)}... (remaining: ${this.lowPriorityQueue.length})`);
            
            // Process the queued item during idle time (avoid recursion)
            requestIdleCallback(() => {
                this._generateThumbnailsInternal(hash, sourceImage, progressCallback, priority)
                    .then(resolve)
                    .catch(error => {
                        console.error(`❌ Low-priority thumbnail generation failed for ${hash.substring(0, 8)}...`, error);
                        resolve(new Map()); // Return empty map on failure
                    });
            }, { timeout: 5000 });
        }
    }
    
    async _generateThumbnailsInternal(hash, sourceImage, progressCallback = null, priority = 'normal') {
        const thumbnails = new Map();
        this.cache.set(hash, thumbnails);
        
        // Phase 1: Generate priority thumbnails immediately (e.g., 64px)
        console.log(`🖼️ Generating priority thumbnails for ${hash.substring(0, 8)}... Sizes:`, this.prioritySizes);
        
        for (let i = 0; i < this.prioritySizes.length; i++) {
            const size = this.prioritySizes[i];
            
            // Skip if this size already exists (e.g., 64px from preview)
            if (thumbnails.has(size)) {
                console.log(`⏭️ Skipping ${size}px thumbnail - already exists from preview`);
                continue;
            }
            
            const canvas = this._generateSingleThumbnail(sourceImage, size);
            
            // Only store if we actually generated a thumbnail
            if (canvas) {
                thumbnails.set(size, canvas);
                this.currentMemoryUsage += this._calculateCanvasMemory(canvas);
            }
            
            const progress = 0.2 + (0.6 * (i + 1) / this.prioritySizes.length);
            if (progressCallback) {
                progressCallback(progress); // 20-80% for priority sizes
            }
            // Report to unified progress system
            if (window.imageProcessingProgress) {
                window.imageProcessingProgress.updateThumbnailProgress(hash, progress);
            }
            
            // Yield control after each priority thumbnail for responsiveness
            await new Promise(resolve => setTimeout(resolve, this.frameRateThrottle));
        }
        
        // Phase 2: Wait for higher quality thumbnails to be generated
        await new Promise(resolve => {
            const generateQuality = () => {
                this._generateQualityThumbnails(hash, sourceImage, thumbnails, progressCallback)
                    .finally(resolve); // Ensure we resolve whether it succeeds or fails
            };

            console.log(`Scheduling quality thumbnail generation for ${hash.substring(0, 8)}`);
            if (priority !== 'low') {
                requestIdleCallback(generateQuality, { timeout: 1000 }); // Reduced timeout
            } else {
                setTimeout(generateQuality, 3000); // Reduced timeout
            }
        });
        
        console.log(`✅ All thumbnails generated for ${hash.substring(0, 8)}. Returning map.`);
        return thumbnails;
    }
    
    /**
     * Generate higher quality thumbnails (256px, 512px) when system is idle
     */
    async _generateQualityThumbnails(hash, sourceImage, thumbnails, progressCallback = null) {
        console.log(`🎨🎨🎨 STARTING quality thumbnail generation for ${hash.substring(0, 8)}. Sizes:`, this.qualitySizes);
        
        for (let i = 0; i < this.qualitySizes.length; i++) {
            const size = this.qualitySizes[i];
            
            // Check if we still need this thumbnail (cache might have been evicted)
            if (!this.cache.has(hash)) {
                console.log(`🚫 Cache evicted for ${hash.substring(0, 8)}..., stopping quality generation`);
                return;
            }
            
            // Skip if this size already exists
            if (thumbnails.has(size)) {
                console.log(`⏭️ Skipping ${size}px thumbnail - already exists`);
                continue;
            }
            
            const canvas = this._generateSingleThumbnail(sourceImage, size);
            console.log(`🔧 Generated ${size}px thumbnail:`, canvas ? `${canvas.width}x${canvas.height}` : 'FAILED');
            
            // Only store if we actually generated a thumbnail
            if (canvas) {
                thumbnails.set(size, canvas);
                this.currentMemoryUsage += this._calculateCanvasMemory(canvas);
                console.log(`✅ Stored ${size}px thumbnail in cache for ${hash.substring(0, 8)}`);
            }
            
            const progress = 0.8 + (0.2 * (i + 1) / this.qualitySizes.length);
            if (progressCallback) {
                progressCallback(progress); // 80-100% for quality sizes
            }
            // Report to unified progress system
            if (window.imageProcessingProgress) {
                window.imageProcessingProgress.updateThumbnailProgress(hash, progress);
            }
            
            // Longer yield for quality thumbnails to maintain responsiveness
            await new Promise(resolve => setTimeout(resolve, this.frameRateThrottle * 2));
        }
        
        // All quality thumbnails generated, report final completion
        if (progressCallback) {
            progressCallback(1.0);
        }
        // Report to unified progress system
        if (window.imageProcessingProgress) {
            window.imageProcessingProgress.updateThumbnailProgress(hash, 1);
        }
        console.log(`✅ All quality thumbnails complete for ${hash.substring(0, 8)}`);
        
        return thumbnails;
    }
    
    _generateSingleThumbnail(sourceImage, size) {
        // If source is already a canvas, use it directly
        if (sourceImage instanceof HTMLCanvasElement) {
            const canvas = document.createElement('canvas');
            canvas.width = sourceImage.width;
            canvas.height = sourceImage.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(sourceImage, 0, 0);
            return canvas;
        }

        // Get original dimensions
        const originalWidth = sourceImage.width || sourceImage.videoWidth;
        const originalHeight = sourceImage.height || sourceImage.videoHeight;
        
        // Skip if original is smaller than or equal to target size
        // For example, a 300x300 image doesn't need a 512px thumbnail
        if (Math.max(originalWidth, originalHeight) <= size) {
            console.log(`⏭️ Skipping ${size}px thumbnail - original is only ${Math.max(originalWidth, originalHeight)}px`);
            return null; // Signal to use original instead
        }
        
        // Calculate dimensions maintaining aspect ratio
        let width = originalWidth;
        let height = originalHeight;
        
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
        
        // Find the best thumbnail, prioritizing the smallest that meets quality needs
        for (let i = 0; i < this.thumbnailSizes.length; i++) {
            const size = this.thumbnailSizes[i];
            if (thumbnails.has(size)) {
                const thumbnail = thumbnails.get(size);
                const thumbnailSize = Math.max(thumbnail.width, thumbnail.height);
                
                // If this thumbnail is good enough quality, use it
                // Use a sliding scale: be more permissive for smaller targets
                const qualityThreshold = targetSize <= 128 ? 0.5 : 0.8;
                if (thumbnailSize >= targetSize * qualityThreshold) {
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
        this.currentMemoryUsage = 0;
        this.accessOrder.clear();
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
    
    // Get cache statistics (enhanced with memory monitoring)
    getStats() {
        const totalHashes = this.cache.size;
        let totalThumbnails = 0;
        
        for (const [hash, thumbnails] of this.cache) {
            totalThumbnails += thumbnails.size;
        }
        
        return {
            totalHashes,
            totalThumbnails,
            memoryUsageMB: this.currentMemoryUsage / (1024 * 1024),
            maxMemoryMB: this.maxMemoryBytes / (1024 * 1024),
            memoryUtilization: (this.currentMemoryUsage / this.maxMemoryBytes * 100).toFixed(1) + '%',
            activeGenerations: this.generationQueues.size,
            maxHashEntries: this.maxHashEntries,
            countPressure: (totalHashes / this.maxHashEntries * 100).toFixed(1) + '%',
            thumbnailSizes: this.thumbnailSizes.length
        };
    }
    
    // Force cleanup for memory pressure
    forceCleanup() {
        console.log('🧹 Forcing thumbnail cache cleanup due to memory pressure');
        this._evictOldEntries();
        
        // More aggressive cleanup - keep only most recent 25 entries
        if (this.cache.size > 25) {
            const oldLimit = this.maxHashEntries;
            this.maxHashEntries = 25;
            this._evictOldEntries();
            this.maxHashEntries = oldLimit;
        }
        
        console.log(`🧹 Forced cleanup complete. Cache size: ${this.cache.size}`);
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
    
    // ==========================================
    // PREVIEW METHODS (for drag & drop integration)
    // ==========================================
    
    /**
     * Store preview-specific data (temporary or permanent)
     * @param {string} hash - Image hash (could be temporary)
     * @param {number} size - Preview size
     * @param {string|Blob} previewData - Preview URL or blob
     * @param {boolean} isTemporary - Whether this is temporary preview data
     */
    setPreview(hash, size, previewData, isTemporary = false) {
        if (isTemporary) {
            // For temporary previews, use a separate temporary cache
            if (!this.tempPreviewCache) {
                this.tempPreviewCache = new Map();
            }
            
            if (!this.tempPreviewCache.has(hash)) {
                this.tempPreviewCache.set(hash, new Map());
            }
            
            this.tempPreviewCache.get(hash).set(size, previewData);
            return;
        }
        
        // For permanent previews, store in main cache
        // Convert blob URL to canvas if needed
        if (typeof previewData === 'string' && previewData.startsWith('blob:')) {
            // Create an image element to load the blob URL
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                
                // Store the canvas
                this.setThumbnail(hash, size, canvas);
                
                // Clean up blob URL
                URL.revokeObjectURL(previewData);
            };
            img.src = previewData;
        } else if (previewData instanceof HTMLCanvasElement) {
            this.setThumbnail(hash, size, previewData);
        }
    }
    
    /**
     * Get preview for specific size
     * @param {string} hash - Image hash
     * @param {number} size - Preview size
     * @returns {Promise<string|null>} Preview URL or null
     */
    async getPreview(hash, size) {
        // Check temporary cache first
        if (this.tempPreviewCache && this.tempPreviewCache.has(hash)) {
            const tempPreviews = this.tempPreviewCache.get(hash);
            if (tempPreviews.has(size)) {
                return tempPreviews.get(size);
            }
        }
        
        // Check main cache
        const thumbnail = this.getThumbnail(hash, size);
        if (thumbnail) {
            // Convert canvas to blob URL
            return new Promise((resolve) => {
                thumbnail.toBlob((blob) => {
                    if (blob) {
                        resolve(URL.createObjectURL(blob));
                    } else {
                        resolve(null);
                    }
                }, 'image/webp', 0.8);
            });
        }
        
        return null;
    }
    
    /**
     * Update hash mapping for temporary previews (when real hash becomes available)
     * @param {string} tempHash - Temporary hash
     * @param {string} realHash - Real image hash
     */
    updatePreviewHash(tempHash, realHash) {
        if (!this.tempPreviewCache || !this.tempPreviewCache.has(tempHash)) {
            return;
        }
        
        const tempPreviews = this.tempPreviewCache.get(tempHash);
        this.tempPreviewCache.set(realHash, tempPreviews);
        this.tempPreviewCache.delete(tempHash);
        
        console.log(`🔄 Updated preview hash mapping: ${tempHash.substring(0, 8)}... → ${realHash.substring(0, 8)}...`);
    }
    
    /**
     * Clean up temporary preview cache
     */
    cleanupTempPreviews() {
        if (this.tempPreviewCache) {
            // Revoke object URLs to prevent memory leaks
            for (const [hash, previews] of this.tempPreviewCache) {
                for (const [size, url] of previews) {
                    if (typeof url === 'string' && url.startsWith('blob:')) {
                        URL.revokeObjectURL(url);
                    }
                }
            }
            this.tempPreviewCache.clear();
        }
    }
    
    // Legacy bundle methods removed - now handled by unified progress system
}

// ===================================
// GLOBAL MEMORY MONITORING
// ===================================

// Global function to monitor and manage memory usage
window.monitorImageMemory = function() {
    console.log('📊 Image Memory Usage Report:');
    
    // ImageCache stats
    if (window.imageCache) {
        const imageStats = window.imageCache.getStats();
        console.log(`🖼️ ImageCache: ${imageStats.memorySize} items (max: ${imageStats.maxMemoryItems})`);
    }
    
    // ThumbnailCache stats  
    if (window.thumbnailCache) {
        const thumbStats = window.thumbnailCache.getStats();
        console.log(`🖼️ ThumbnailCache: ${thumbStats.totalHashes} images, ${thumbStats.totalThumbnails} thumbnails`);
        console.log(`💾 Memory: ${thumbStats.memoryUsageMB.toFixed(1)}MB / ${thumbStats.maxMemoryMB.toFixed(0)}MB (${thumbStats.memoryUtilization})`);
        console.log(`📊 Count: ${thumbStats.totalHashes} / ${thumbStats.maxHashEntries} (${thumbStats.countPressure})`);
        
        if (parseFloat(thumbStats.memoryUtilization) > 90 || parseFloat(thumbStats.countPressure) > 80) {
            console.warn('⚠️ High cache pressure detected! Consider calling cleanupImageMemory()');
        }
    }
    
    // Browser memory (if available)
    if (performance.memory) {
        const memMB = performance.memory.usedJSHeapSize / (1024 * 1024);
        const maxMB = performance.memory.jsHeapSizeLimit / (1024 * 1024);
        console.log(`🧠 JS Heap: ${memMB.toFixed(1)}MB / ${maxMB.toFixed(1)}MB (${(memMB/maxMB*100).toFixed(1)}%)`);
    }
};

// Global function to force cleanup
window.cleanupImageMemory = function() {
    console.log('🧹 Starting aggressive image memory cleanup...');
    
    let cleaned = 0;
    
    // Clean thumbnail cache
    if (window.thumbnailCache) {
        const beforeStats = window.thumbnailCache.getStats();
        window.thumbnailCache.forceCleanup();
        const afterStats = window.thumbnailCache.getStats();
        cleaned += (beforeStats.totalHashes - afterStats.totalHashes);
        console.log(`🗑️ Cleaned ${beforeStats.totalHashes - afterStats.totalHashes} thumbnail entries`);
    }
    
    // Clean temporary preview cache
    if (window.thumbnailCache && window.thumbnailCache.cleanupTempPreviews) {
        window.thumbnailCache.cleanupTempPreviews();
        console.log('🗑️ Cleaned temporary preview cache');
    }
    
    // Force garbage collection if available (dev tools)
    if (window.gc) {
        window.gc();
        console.log('🗑️ Forced garbage collection');
    }
    
    console.log(`✅ Memory cleanup complete. Total entries cleaned: ${cleaned}`);
    
    // Show updated stats
    setTimeout(() => window.monitorImageMemory(), 100);
};