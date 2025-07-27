# Enhanced Plan: Fix Both Cache Persistence + Resource Exhaustion

## Problem Analysis

### Current Issues
1. **Resource Exhaustion with 700+ Duplicate Nodes**
   - `ERR_INSUFFICIENT_RESOURCES` errors from Chrome
   - 700 concurrent HTTP requests for the same image file
   - No request deduplication despite same hash/URL
   - Browser crashes from connection/memory limits

2. **Cache Persistence Issue**
   - `ThumbnailCache` uses in-memory `Map()` - lost on page reload
   - Every reload regenerates all thumbnails despite server thumbnails existing
   - Server thumbnail loading has 2-second timeout that's too aggressive
   - No cache warming strategy on project startup

### Root Cause
The current implementation creates independent HTTP requests for each node, even when they share the same image hash. Combined with no persistent caching, this creates a perfect storm for resource exhaustion.

## Implementation Plan

### Phase 1: Request Deduplication (Critical for 700+ nodes) 🚨

**New File**: `js/utils/ImageLoadManager.js`
```javascript
class ImageLoadManager {
    constructor() {
        this.pendingLoads = new Map(); // hash -> Promise<Image>
        this.loadQueue = [];           // Queue for throttling
        this.activeLoads = 0;          // Current concurrent loads
        this.maxConcurrent = 6;        // Browser connection limit
    }
    
    async loadShared(hash, url) {
        // If already loading this hash, return existing promise
        if (this.pendingLoads.has(hash)) {
            return this.pendingLoads.get(hash);
        }
        
        // Create new load promise
        const loadPromise = this._queueLoad(hash, url);
        this.pendingLoads.set(hash, loadPromise);
        
        // Clean up when done
        loadPromise.finally(() => {
            this.pendingLoads.delete(hash);
        });
        
        return loadPromise;
    }
}
```

**Modify**: `js/nodes/image-node.js`
- Replace direct `loadImageAsyncOptimized()` calls with `ImageLoadManager.loadShared()`
- All nodes with same hash share one HTTP request
- Implement connection throttling to stay under browser limits

### Phase 2: IndexedDB Persistence (Original Plan)

**New File**: `js/utils/IndexedDBThumbnailStore.js`
- Store thumbnails as blob data with hash keys, modification timestamps
- Auto-sync with existing in-memory `ThumbnailCache`
- Schema:
```javascript
{
  hash: string,           // Image hash (primary key)
  thumbnails: {
    64: Blob,             // 64px thumbnail
    128: Blob,            // 128px thumbnail
    256: Blob,            // 256px thumbnail
    512: Blob,            // 512px thumbnail
    1024: Blob,           // 1024px thumbnail
    2048: Blob            // 2048px thumbnail
  },
  timestamp: number,      // Cache creation time
  serverFilename: string, // Server filename for validation
  version: number         // Schema version for migrations
}
```

**Modify**: `js/utils/cache.js`
- Integrate IndexedDB store into `generateThumbnailsProgressive`
- Check IndexedDB before server or client generation
- Write successful generations back to IndexedDB

### Phase 3: Smart Loading Strategy

**Viewport-Based Loading**
```javascript
class ViewportImageLoader {
    constructor(canvas) {
        this.canvas = canvas;
        this.loadRadius = 2000; // Load images within 2000px of viewport
        this.unloadRadius = 4000; // Unload images beyond 4000px
    }
    
    prioritizeVisibleImages(nodes) {
        const viewport = this.canvas.viewport.getBounds();
        return nodes.sort((a, b) => {
            const distA = this.getDistanceToViewport(a, viewport);
            const distB = this.getDistanceToViewport(b, viewport);
            return distA - distB;
        });
    }
}
```

**Progressive Batch Loading**
- Load images in batches of 10-20 rather than all at once
- Use `requestIdleCallback` for non-visible images
- Implement memory pressure monitoring

**Memory Management**
- Track loaded image memory usage
- Unload offscreen images when memory pressure detected
- Reload when images come back into view

### Phase 4: Server & Performance Improvements

**Modify**: `js/utils/cache.js` - `_loadSingleServerThumbnail`
```javascript
async _loadSingleServerThumbnail(serverFilename, size, retryCount = 0) {
    const options = {
        timeout: 10000, // Increase from 2s to 10s
        signal: AbortSignal.timeout(10000)
    };
    
    try {
        const response = await fetch(url, options);
        if (!response.ok && retryCount < 3) {
            // Exponential backoff: 1s, 2s, 4s
            await new Promise(resolve => 
                setTimeout(resolve, Math.pow(2, retryCount) * 1000)
            );
            return this._loadSingleServerThumbnail(serverFilename, size, retryCount + 1);
        }
        return response;
    } catch (error) {
        if (retryCount < 3) {
            // Retry on network errors
            return this._loadSingleServerThumbnail(serverFilename, size, retryCount + 1);
        }
        throw error;
    }
}
```

**Performance Monitoring**
```javascript
window.imageLoadStats = {
    // Request deduplication metrics
    deduplicatedRequests: 0,
    totalRequests: 0,
    concurrentHighWaterMark: 0,
    
    // Cache performance metrics
    hits: { indexedDB: 0, server: 0, generated: 0 },
    misses: 0,
    avgLoadTime: { indexedDB: 0, server: 0, generated: 0 },
    
    // Memory usage
    loadedImages: 0,
    estimatedMemoryMB: 0,
    unloadedForMemory: 0
}
```

### Phase 5: Cache Warming on Project Load

**Integration Points**:
- Project load in canvas initialization
- State sync manager when receiving project data
- WebSocket project updates

```javascript
async warmCache(projectNodes) {
    // Inventory all unique image hashes
    const uniqueHashes = new Set(
        projectNodes
            .filter(node => node.type === 'media/image' && node.properties.hash)
            .map(node => node.properties.hash)
    );
    
    // Check IndexedDB for each hash
    const missing = [];
    for (const hash of uniqueHashes) {
        if (!await this.indexedDB.has(hash)) {
            missing.push(hash);
        }
    }
    
    // Background load missing thumbnails from server
    for (const hash of missing) {
        this.backgroundQueue.add(() => this.loadServerThumbnails(hash));
    }
}
```

## Expected Results

### First Load of 700 Duplicate Nodes
- ✅ **One HTTP request** instead of 700 for the same image
- ✅ **No `ERR_INSUFFICIENT_RESOURCES`** errors
- ✅ **No Chrome crashes** from connection exhaustion
- ✅ **Progressive loading** - visible images first
- ✅ **Memory efficient** - automatic unloading of offscreen images

### Subsequent Loads
- ✅ **Instant thumbnails** from IndexedDB cache
- ✅ **Zero HTTP requests** for cached images
- ✅ **Background cache warming** for missing thumbnails
- ✅ **10x faster project startup** for large projects

### Performance Guarantees
- ✅ **120fps maintained** - all loading happens asynchronously
- ✅ **Max 6 concurrent connections** - respects browser limits
- ✅ **Memory bounded** - automatic cleanup prevents OOM
- ✅ **Robust fallback chain**: IndexedDB → Server → Client generation

## Success Metrics

1. **Resource Usage**
   - Concurrent HTTP connections never exceed 6
   - Memory usage stays under 2GB for 1000+ images
   - Zero `ERR_INSUFFICIENT_RESOURCES` errors

2. **Performance**
   - Page reload time reduced by 80%+ for projects with many images
   - Cache hit ratio >90% for repeat project loads
   - First paint <500ms even with 700+ nodes

3. **User Experience**
   - Smooth 120fps interaction during loading
   - Progressive image appearance (no blank canvas)
   - No browser crashes or hangs

## Implementation Priority

1. **Phase 1 (Critical)**: Request deduplication - prevents crashes
2. **Phase 3 (High)**: Viewport loading - improves perceived performance  
3. **Phase 2 (High)**: IndexedDB persistence - fixes reload issue
4. **Phase 4 (Medium)**: Server improvements - better reliability
5. **Phase 5 (Medium)**: Cache warming - optimization

This plan addresses both the immediate resource exhaustion issue (700 concurrent requests) and the longer-term cache persistence problem.