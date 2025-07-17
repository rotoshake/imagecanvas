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