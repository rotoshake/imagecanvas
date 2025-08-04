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
            
        } catch (error) {
            
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
        this.thumbnailSizes = CONFIG.THUMBNAILS?.SIZES || [64, 128, 256, 512, 1024, 2048]; // Match server sizes
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
        
        // Initialize persistent storage
        this._initializePersistentStorage();
        
        // Performance optimization: cache visible node tracking
        this._visibleNodeCache = null;
        this._lastViewportUpdate = 0;
        this._viewportCacheTimeout = 100; // ms - only update every 100ms max
        
        console.log(`🧹 ThumbnailCache initialized with ${this.maxHashEntries} entries / ${(this.maxMemoryBytes / (1024 * 1024)).toFixed(0)}MB limit`);
    }
    
    /**
     * Initialize persistent storage and load existing thumbnails
     * @private
     */
    async _initializePersistentStorage() {
        // Wait for IndexedDB store to be ready
        if (window.indexedDBThumbnailStore) {
            try {
                await window.indexedDBThumbnailStore.initPromise;
                
                // Load existing thumbnails from persistent storage
                const storedHashes = await window.indexedDBThumbnailStore.getAllHashes();
                
                if (storedHashes.length > 0) {
                    console.log(`📦 Found ${storedHashes.length} thumbnail sets in persistent storage`);
                    
                    // Load thumbnails in batches to avoid overwhelming memory
                    let loadedCount = 0;
                    const batchSize = 10;
                    
                    for (let i = 0; i < storedHashes.length; i += batchSize) {
                        const batch = storedHashes.slice(i, i + batchSize);
                        
                        await Promise.all(batch.map(async (hash) => {
                            try {
                                const thumbnails = await window.indexedDBThumbnailStore.getThumbnails(hash);
                                if (thumbnails && Object.keys(thumbnails).length > 0) {
                                    // Convert object back to Map and store in cache
                                    const thumbnailMap = new Map();
                                    let memoryUsed = 0;
                                    
                                    for (const [size, canvas] of Object.entries(thumbnails)) {
                                        thumbnailMap.set(parseInt(size), canvas);
                                        memoryUsed += this._calculateCanvasMemory(canvas);
                                    }
                                    
                                    this.cache.set(hash, thumbnailMap);
                                    this.currentMemoryUsage += memoryUsed;
                                    this._trackAccess(hash);
                                    loadedCount++;
                                }
                            } catch (error) {
                                console.warn(`Failed to load thumbnails for ${hash.substring(0, 8)}:`, error);
                            }
                        }));
                        
                        // Yield control between batches
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                    
                    console.log(`✅ Loaded ${loadedCount} thumbnail sets from persistent storage (${(this.currentMemoryUsage/1024/1024).toFixed(1)}MB)`);
                }
                
            } catch (error) {
                console.warn('Failed to initialize persistent storage:', error);
            }
        }
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
        // Add detailed logging to debug rotation issue
        console.log(`🔍 setThumbnail called: hash=${hash.substring(0, 8)}, size=${size}, canvas=${canvas.width}x${canvas.height}`);
        
        // Validate hash format to prevent corruption
        if (!hash || typeof hash !== 'string' || hash.length < 8) {
            console.error(`❌ Invalid hash provided to setThumbnail: ${hash}`);
            return;
        }
        
        // Validate canvas
        if (!canvas || !canvas.width || !canvas.height) {
            console.error(`❌ Invalid canvas provided to setThumbnail for ${hash.substring(0, 8)}`);
            return;
        }
        
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
        
        // Clone the canvas to prevent external modifications
        const clonedCanvas = document.createElement('canvas');
        clonedCanvas.width = canvas.width;
        clonedCanvas.height = canvas.height;
        const ctx = clonedCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        
        thumbnails.set(size, clonedCanvas);
        this._trackAccess(hash);
        this._notify(hash); // Notify subscribers that a new thumbnail is available
        console.log(`📢 Stored ${size}px thumbnail (${clonedCanvas.width}x${clonedCanvas.height}) for ${hash.substring(0, 8)}`);
        
        // Also mark all image nodes with this hash as needing update
        if (window.app?.graph?.nodes) {
            let updatedCount = 0;
            for (const node of window.app.graph.nodes) {
                if (node.properties?.hash === hash) {
                    node.needsGLUpdate = true;
                    updatedCount++;
                }
            }
            if (updatedCount > 0) {
                console.log(`🔄 Marked ${updatedCount} nodes for GL update`);
                // Force immediate redraw
                if (window.app.graphCanvas) {
                    window.app.graphCanvas.dirty_canvas = true;
                    window.app.graphCanvas.dirty_bgcanvas = true;
                }
            }
        }
        
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
        
        // Skip expensive visible node detection if we're not under extreme pressure
        const underExtremePressure = this.currentMemoryUsage > this.maxMemoryBytes * 1.2;
        
        // Calculate targets
        const entriesToRemove = needCountEviction ? this.cache.size - this.maxHashEntries : 0;
        const memoryToFree = needMemoryEviction ? this.currentMemoryUsage - (this.maxMemoryBytes * 0.9) : 0; // Free to 90% of limit
        
        // Get currently visible nodes to protect them from eviction - only if under extreme pressure
        const visibleHashes = underExtremePressure ? this._getVisibleNodeHashes() : new Set();
        
        // Sort entries by priority: visible nodes last (lowest priority for eviction)
        const sortedEntries = Array.from(this.accessOrder.entries())
            .map(([hash, accessTime]) => ({
                hash,
                accessTime,
                isVisible: underExtremePressure ? visibleHashes.has(hash) : false,
                priority: (underExtremePressure && visibleHashes.has(hash)) ? 1000000 + accessTime : accessTime // Visible nodes get high priority
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
        // Use cached result if still valid
        const now = Date.now();
        if (this._visibleNodeCache && 
            (now - this._lastViewportUpdate) < this._viewportCacheTimeout) {
            return this._visibleNodeCache;
        }
        
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
            
        }
        
        // Cache the result
        this._visibleNodeCache = visibleHashes;
        this._lastViewportUpdate = now;
        
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
        
        // 1. FIRST: Check IndexedDB for persistent thumbnails (instant on refresh)
        if (window.indexedDBThumbnailStore && window.indexedDBThumbnailStore.isAvailable) {
            try {
                const storedThumbnails = await window.indexedDBThumbnailStore.getThumbnails(hash);
                if (storedThumbnails && Object.keys(storedThumbnails).length > 0) {
                    // console.log(`💾 Loading ${Object.keys(storedThumbnails).length} thumbnails from IndexedDB for ${hash.substring(0, 8)}`);
                    
                    // Convert object to Map format with memory tracking
                    const thumbnailMap = new Map();
                    let loadedMemory = 0;
                    
                    Object.entries(storedThumbnails).forEach(([size, canvas]) => {
                        thumbnailMap.set(parseInt(size), canvas);
                        loadedMemory += this._calculateCanvasMemory(canvas);
                    });
                    
                    // Check memory limits before adding
                    if (this.currentMemoryUsage + loadedMemory > this.maxMemoryUsage) {
                        this._enforceMemoryLimit(loadedMemory);
                    }
                    
                    // Cache in memory and update tracking
                    this.cache.set(hash, thumbnailMap);
                    this.currentMemoryUsage += loadedMemory;
                    this.accessOrder.set(hash, Date.now());

                    // Report instant completion
                    if (progressCallback) progressCallback(1);
                    if (window.imageProcessingProgress) {
                        window.imageProcessingProgress.updateThumbnailProgress(hash, 1);
                    }
                    
                    // console.log(`✅ Instant display: ${thumbnailMap.size} sizes loaded from persistent cache`);
                    return thumbnailMap;
                }
            } catch (error) {
                console.warn('IndexedDB thumbnail load failed:', error);
            }
        }
        
        // 2. SECOND: Try to load from server thumbnails (no rebuilding needed)
        const serverThumbnails = await this._loadServerThumbnails(hash, sourceImage);
        if (serverThumbnails && serverThumbnails.size > 0) {
            // console.log(`🌐 Loading ${serverThumbnails.size} thumbnails from server for ${hash.substring(0, 8)}`);
            
            // Calculate memory for loaded thumbnails
            let loadedMemory = 0;
            for (const [size, canvas] of serverThumbnails) {
                loadedMemory += this._calculateCanvasMemory(canvas);
            }
            
            // Check memory limits before adding
            if (this.currentMemoryUsage + loadedMemory > this.maxMemoryUsage) {
                this._enforceMemoryLimit(loadedMemory);
            }
            
            // Cache in memory
            this.cache.set(hash, serverThumbnails);
            this.currentMemoryUsage += loadedMemory;
            this.accessOrder.set(hash, Date.now());
            
            // Store in IndexedDB for instant access next time
            this._storeToIndexedDB(hash, serverThumbnails);
            
            // Report completion
            if (window.imageProcessingProgress) {
                window.imageProcessingProgress.updateThumbnailProgress(hash, 1);
            }
            
            console.log(`✅ Server thumbnails loaded and cached: ${serverThumbnails.size} sizes`);
            return serverThumbnails;
        }
        
        // Generating thumbnails client-side with throttling
        this.activeGenerations++;
        if (window.Logger.isEnabled('THUMBNAIL_GENERATION')) {
            window.Logger.thumbnail('info', `🎬 Starting thumbnail generation for ${hash.substring(0, 8)}... (active: ${this.activeGenerations})`);
        }
        
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
        
        // Store source dimensions for validation
        const sourceDimensions = {
            width: sourceImage.naturalWidth || sourceImage.width || sourceImage.videoWidth,
            height: sourceImage.naturalHeight || sourceImage.height || sourceImage.videoHeight
        };
        console.log(`🎨 Generating thumbnails for ${hash.substring(0, 8)} from source ${sourceDimensions.width}x${sourceDimensions.height}`);
        
        // Phase 1: Generate priority thumbnails immediately (e.g., 64px)
        console.log(`🖼️ Generating priority thumbnails for ${hash.substring(0, 8)}... Sizes:`, this.prioritySizes);
        
        for (let i = 0; i < this.prioritySizes.length; i++) {
            const size = this.prioritySizes[i];
            
            // Skip if this size already exists (e.g., 64px from preview)
            if (thumbnails.has(size)) {
                
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
        
        // Persist thumbnails to IndexedDB for fast loading on refresh
        this._persistThumbnails(hash, thumbnails);
        
        return thumbnails;
    }
    
    /**
     * Persist thumbnails to IndexedDB for fast loading on refresh
     * @private
     */
    async _persistThumbnails(hash, thumbnails) {
        if (!window.indexedDBThumbnailStore || !thumbnails || thumbnails.size === 0) {
            return;
        }
        
        try {
            // Convert Map to object for storage
            const thumbnailsObject = {};
            for (const [size, canvas] of thumbnails) {
                thumbnailsObject[size] = canvas;
            }
            
            await window.indexedDBThumbnailStore.set(hash, thumbnailsObject);
            console.log(`💾 Persisted ${thumbnails.size} thumbnails for ${hash.substring(0, 8)} to IndexedDB`);
        } catch (error) {
            console.warn(`Failed to persist thumbnails for ${hash.substring(0, 8)}:`, error);
        }
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
                
                continue;
            }
            
            const canvas = this._generateSingleThumbnail(sourceImage, size);
            
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
        
        // Persist updated thumbnails to IndexedDB after quality generation
        this._persistThumbnails(hash, thumbnails);
        
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
        const originalWidth = sourceImage.naturalWidth || sourceImage.width || sourceImage.videoWidth;
        const originalHeight = sourceImage.naturalHeight || sourceImage.height || sourceImage.videoHeight;
        
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
        
        // Check if the image might have EXIF orientation issues
        // This happens when naturalWidth/Height differ from width/height
        const hasOrientationIssue = sourceImage.naturalWidth && sourceImage.naturalHeight &&
            ((sourceImage.naturalWidth !== sourceImage.width) || 
             (sourceImage.naturalHeight !== sourceImage.height));
        
        if (hasOrientationIssue) {
            // The browser has applied EXIF rotation to the display dimensions
            // but drawImage might not respect it, so we need to handle it manually
            console.log(`🔄 Detected potential EXIF orientation issue for thumbnail ${size}px`);
            
            // Create a temporary canvas at full resolution to properly capture orientation
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = sourceImage.width;
            tempCanvas.height = sourceImage.height;
            const tempCtx = tempCanvas.getContext('2d');
            
            // Draw at full size first to capture proper orientation
            tempCtx.drawImage(sourceImage, 0, 0);
            
            // Now scale down from the properly oriented temp canvas
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
            ctx.drawImage(tempCanvas, 0, 0, width, height);
        } else {
            // No orientation issues detected, draw normally
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = CONFIG.THUMBNAILS.QUALITY;
            ctx.drawImage(sourceImage, 0, 0, width, height);
        }

        return canvas;
    }
    
    // Get best thumbnail for target size
    getBestThumbnail(hash, targetWidth, targetHeight) {
        const thumbnails = this.getThumbnails(hash);
        if (thumbnails.size === 0) return null;
        
        const targetSize = Math.max(targetWidth, targetHeight);
        
        // Add debug logging for rotation issue
        if (window.DEBUG_THUMBNAILS) {
            console.log(`🔍 getBestThumbnail: hash=${hash.substring(0, 8)}, target=${targetWidth}x${targetHeight}, targetSize=${targetSize}`);
        }
        
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
                    // Debug check for rotation issue
                    if (window.DEBUG_THUMBNAILS) {
                        console.log(`🎯 Selected ${size}px thumbnail (${thumbnail.width}x${thumbnail.height}) for target ${targetWidth}x${targetHeight}`);
                    }
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
        
        this._evictOldEntries();
        
        // More aggressive cleanup - keep only most recent 25 entries
        if (this.cache.size > 25) {
            const oldLimit = this.maxHashEntries;
            this.maxHashEntries = 25;
            this._evictOldEntries();
            this.maxHashEntries = oldLimit;
        }

    }
    
    /**
     * Load specific thumbnail sizes from server (public method)
     * @param {string} hash - Image hash
     * @param {string} serverFilename - Server filename 
     * @param {number[]} sizes - Array of sizes to load
     * @returns {Promise<boolean>} True if any thumbnails were loaded
     */
    async loadServerThumbnails(hash, serverFilename, sizes = null) {
        if (!hash || !serverFilename) return false;
        
        // Validate that serverFilename looks like a server-generated filename
        if (!serverFilename.match(/^\d{13}-[a-z0-9]+\./i)) {
            // Only warn in debug mode - this is common with user-uploaded files
            if (window.DEBUG_CACHE) {
                console.warn(`⚠️ loadServerThumbnails: serverFilename doesn't look server-generated: ${serverFilename}`);
            }
            return false;
        }
        
        // Use provided sizes or default to all sizes
        const sizesToLoad = sizes || this.thumbnailSizes;
        
        // Remove extension from server filename
        const nameWithoutExt = serverFilename.includes('.') 
            ? serverFilename.substring(0, serverFilename.lastIndexOf('.'))
            : serverFilename;
        
        console.log(`🌐 Loading server thumbnails for ${hash.substring(0, 8)} (${nameWithoutExt}), sizes: [${sizesToLoad.join(', ')}]`);
        
        // Get or create thumbnail map for this hash
        let thumbnails = this.cache.get(hash);
        if (!thumbnails) {
            thumbnails = new Map();
            this.cache.set(hash, thumbnails);
        }
        
        const loadPromises = [];
        let loadedCount = 0;
        
        // Try to load each requested thumbnail size from server
        for (const size of sizesToLoad) {
            // Skip if we already have this size
            if (thumbnails.has(size)) {
                console.log(`⏭️ Skipping ${size}px - already cached`);
                continue;
            }
            
            const promise = this._loadSingleServerThumbnail(size, nameWithoutExt)
                .then(canvas => {
                    if (canvas) {
                        // Double-check that the canvas size makes sense for this thumbnail size
                        const maxDim = Math.max(canvas.width, canvas.height);
                        if (maxDim !== size) {
                            console.warn(`⚠️ Server thumbnail size mismatch: expected ${size}px, got ${maxDim}px (${canvas.width}x${canvas.height})`);
                        }
                        
                        thumbnails.set(size, canvas);
                        this.currentMemoryUsage += this._calculateCanvasMemory(canvas);
                        loadedCount++;
                        console.log(`✅ Loaded ${size}px server thumbnail (${canvas.width}x${canvas.height}) for ${hash.substring(0, 8)}`);
                    }
                })
                .catch(error => {
                    console.warn(`❌ Failed to load ${size}px server thumbnail:`, error);
                });
            
            loadPromises.push(promise);
        }
        
        // Wait for all loads to complete
        await Promise.all(loadPromises);
        
        if (loadedCount > 0) {
            this._trackAccess(hash);
            // Persist loaded thumbnails
            this._persistThumbnails(hash, thumbnails);
            console.log(`🎉 Loaded ${loadedCount} server thumbnails for ${hash.substring(0, 8)}`);
            return true;
        }
        
        return false;
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
                // Priority 1: Extract server filename from serverUrl (most reliable)
                if (imageNode.properties?.serverUrl) {
                    const urlParts = imageNode.properties.serverUrl.split('/');
                    const filenameFromUrl = urlParts[urlParts.length - 1];
                    // Only use this if it looks like a server-generated filename (contains timestamp and random chars)
                    if (filenameFromUrl && filenameFromUrl.match(/^\d{13}-[a-z0-9]+\./i)) {
                        serverFilename = filenameFromUrl;
                        console.log(`🔗 Using server filename from serverUrl: ${serverFilename}`);
                    }
                }
                // Priority 2: Check if we have serverFilename property directly (only if serverUrl didn't work)
                if (!serverFilename && imageNode.properties?.serverFilename) {
                    // Only use serverFilename if it looks like a server-generated name
                    if (imageNode.properties.serverFilename.match(/^\d{13}-[a-z0-9]+\./i)) {
                        serverFilename = imageNode.properties.serverFilename;
                        console.log(`📋 Using stored serverFilename: ${serverFilename}`);
                    } else {
                        console.warn(`⚠️ Ignoring serverFilename that looks like original filename: ${imageNode.properties.serverFilename}`);
                    }
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
                        // Verify dimensions before storing
                        const maxDim = Math.max(canvas.width, canvas.height);
                        if (maxDim !== size) {
                            console.warn(`⚠️ Server thumbnail mismatch in _loadServerThumbnails: expected ${size}px, got ${canvas.width}x${canvas.height}`);
                        }
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
            console.log(`📥 Loading ${size}px thumbnail from: ${thumbnailUrl}`);
            const result = await this._loadImageWithTimeout(thumbnailUrl, 10000); // 10 second timeout
            if (result) {
                console.log(`✅ Loaded ${size}px thumbnail (${result.width}x${result.height})`);
                
                return result;
            } else {
                console.log(`❌ Failed to load ${size}px thumbnail`);
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
                    
                    // Store the source URL on the canvas for debugging
                    canvas._sourceUrl = url;

                    resolve(canvas);
                } catch (error) {
                    
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
                    
                    resolve(null);
                }
            }, timeout);
            
            img.src = url;
        });
    }
    
    // ==========================================
    // MEMORY MANAGEMENT METHODS
    // ==========================================
    
    /**
     * Enforce memory limits by evicting oldest entries (LRU)
     * @param {number} requiredMemory - Memory needed for new entry
     */
    _enforceMemoryLimit(requiredMemory) {
        console.log(`🧹 Memory check: current=${(this.currentMemoryUsage/1024/1024).toFixed(1)}MB, need=${(requiredMemory/1024/1024).toFixed(1)}MB, limit=${(this.maxMemoryUsage/1024/1024).toFixed(1)}MB`);
        
        // Convert accessOrder Map to sorted array
        const sortedEntries = Array.from(this.accessOrder.entries())
            .sort((a, b) => a[1] - b[1]); // Sort by timestamp (oldest first)
        
        while (this.currentMemoryUsage + requiredMemory > this.maxMemoryUsage && 
               sortedEntries.length > 0) {
            
            const [hashToEvict] = sortedEntries.shift();
            this._evictThumbnails(hashToEvict);
        }
    }
    
    /**
     * Evict all thumbnails for a specific hash
     * @param {string} hash - Hash to evict
     */
    _evictThumbnails(hash) {
        const thumbnails = this.cache.get(hash);
        if (!thumbnails) return;
        
        let freedMemory = 0;
        
        // Clean up WebGL textures first
        this._cleanupWebGLTextures(hash);
        
        // Clean up canvas elements
        for (const [size, canvas] of thumbnails) {
            freedMemory += this._calculateCanvasMemory(canvas);
            
            // Clear canvas data to free GPU/memory resources
            if (canvas && canvas.getContext) {
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                }
            }
        }
        
        // Remove from caches
        this.cache.delete(hash);
        this.accessOrder.delete(hash);
        this.currentMemoryUsage -= freedMemory;
        
        console.log(`🗑️ Evicted ${thumbnails.size} thumbnails for ${hash.substring(0, 8)}, freed ${(freedMemory/1024/1024).toFixed(1)}MB`);
    }
    
    /**
     * Clean up WebGL textures for a hash
     * @private
     */
    _cleanupWebGLTextures(hash) {
        // Clean up WebGL textures if renderer is available
        if (window.canvas && window.canvas.renderer && window.canvas.renderer.lodManager) {
            window.canvas.renderer.lodManager.clearTexturesForHash(hash);
        }
    }
    
    /**
     * Clean up temporary preview data and unused resources
     */
    cleanupTempData() {
        if (this.tempPreviewCache) {
            for (const [hash, previews] of this.tempPreviewCache) {
                for (const [size, preview] of previews) {
                    // Revoke blob URLs to prevent memory leaks
                    if (typeof preview === 'string' && preview.startsWith('blob:')) {
                        URL.revokeObjectURL(preview);
                    }
                }
            }
            this.tempPreviewCache.clear();
            console.log('🧹 Cleaned up temporary preview cache');
        }
    }
    
    /**
     * Get current memory usage stats
     */
    getMemoryStats() {
        return {
            currentUsage: this.currentMemoryUsage,
            maxUsage: this.maxMemoryUsage,
            utilizationPercent: (this.currentMemoryUsage / this.maxMemoryUsage) * 100,
            entriesCount: this.cache.size,
            oldestEntry: this.accessOrder.size > 0 ? Math.min(...this.accessOrder.values()) : null,
            newestEntry: this.accessOrder.size > 0 ? Math.max(...this.accessOrder.values()) : null
        };
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
    
    // Notification system for thumbnail updates
    subscribe(hash, callback) {
        if (!this.subscribers.has(hash)) {
            this.subscribers.set(hash, new Set());
        }
        this.subscribers.get(hash).add(callback);
    }
    
    unsubscribe(hash, callback) {
        if (this.subscribers.has(hash)) {
            this.subscribers.get(hash).delete(callback);
            if (this.subscribers.get(hash).size === 0) {
                this.subscribers.delete(hash);
            }
        }
    }
    
    _notify(hash) {
        if (this.subscribers.has(hash)) {
            for (const callback of this.subscribers.get(hash)) {
                try {
                    callback(hash);
                } catch (error) {
                    console.error('Error in thumbnail notification callback:', error);
                }
            }
        }
    }
}

// ===================================
// GLOBAL MEMORY MONITORING
// ===================================

// Global function to monitor and manage memory usage
window.monitorImageMemory = function() {
    
    // ImageCache stats
    if (window.imageCache) {
        const imageStats = window.imageCache.getStats();
        console.log(`🖼️ ImageCache: ${imageStats.memorySize} items (max: ${imageStats.maxMemoryItems})`);
    }
    
    // ThumbnailCache stats  
    if (window.thumbnailCache) {
        const thumbStats = window.thumbnailCache.getStats();
        
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
    
    let cleaned = 0;
    
    // Clean thumbnail cache
    if (window.thumbnailCache) {
        const beforeStats = window.thumbnailCache.getStats();
        window.thumbnailCache.forceCleanup();
        const afterStats = window.thumbnailCache.getStats();
        cleaned += (beforeStats.totalHashes - afterStats.totalHashes);
        
    }
    
    // Clean temporary preview cache
    if (window.thumbnailCache && window.thumbnailCache.cleanupTempPreviews) {
        window.thumbnailCache.cleanupTempPreviews();
        
    }
    
    // Force garbage collection if available (dev tools)
    if (window.gc) {
        window.gc();
        
    }

    // Show updated stats
    setTimeout(() => window.monitorImageMemory(), 100);
};

// ===================================
// GLOBAL EXPORTS
// ===================================

// Make classes available globally
window.ImageCache = ImageCache;
window.ThumbnailCache = ThumbnailCache;