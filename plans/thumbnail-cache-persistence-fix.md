# Performance Optimization Plan: Fix Thumbnail Cache Persistence

## Current Status Analysis ✅

- **120fps performance**: FIXED with `loadImageAsyncOptimized`, chunked downloads, `img.decode()`
- **Immediate visual feedback**: FIXED - nodes show grey box + loading ring immediately
- **Video optimization**: FIXED - simplified single thumbnail approach

## Critical Issues Remaining ❌

### 1. Thumbnail Cache Not Persistent (Major Issue)
- **Problem**: `ThumbnailCache` uses in-memory `Map()` - lost on page reload
- **Impact**: Every reload regenerates all thumbnails, even though server thumbnails exist
- **Symptom**: Intensive processing on reload despite cached server thumbnails

### 2. Server Thumbnail Loading Unreliable
- **Problem**: 2-second timeout in `_loadSingleServerThumbnail` too aggressive
- **Problem**: No retry logic - falls back to client generation immediately
- **Impact**: Server thumbnails exist but aren't being used

### 3. No Cache Warming Strategy
- **Problem**: No proactive thumbnail loading on project startup
- **Impact**: Thumbnails load reactively as user scrolls to images

---

## Implementation Plan

### Phase 1: IndexedDB Persistence

**New File**: `js/utils/IndexedDBThumbnailStore.js`
- Store thumbnails as blob data with hash keys
- Auto-sync with in-memory `ThumbnailCache`
- Implement cache invalidation based on file modification time
- Add graceful fallback if IndexedDB unavailable

**Modify**: `js/utils/cache.js`
- Integrate IndexedDB store into `generateThumbnailsProgressive`
- Check IndexedDB before server or client generation
- Write successful generations back to IndexedDB

### Phase 2: Improve Server Thumbnail Loading

**Modify**: `js/utils/cache.js` - `_loadSingleServerThumbnail`
- Increase timeout from 2s to 10s
- Add retry logic: 3 attempts with exponential backoff (1s, 2s, 4s delays)
- Better error logging to identify why server loads fail
- Implement connection timeout vs server processing timeout

### Phase 3: Smart Cache Warming on Project Load

**New Feature**: Background thumbnail preloading
- On project load, inventory all image hashes
- Background check server thumbnail availability for each hash
- Pre-populate IndexedDB with available server thumbnails
- Show thumbnails instantly when user scrolls to images

**Integration Points**:
- Project load in canvas initialization
- State sync manager when receiving project data
- WebSocket project updates

### Phase 4: Performance Monitoring & Validation

**Add Metrics**:
- Cache hit/miss ratios (IndexedDB vs Server vs Client generation)
- Thumbnail load times by source type
- Memory usage tracking
- Reload performance comparison

**Debug Tools**:
- Console commands to inspect cache state
- Visual indicators for thumbnail source (cached/server/generated)
- Performance dashboard in dev mode

---

## Expected Results

- **Instant project startup**: Thumbnails load from IndexedDB cache immediately
- **Zero reprocessing on reload**: Use persistent cached thumbnails across browser sessions
- **Better server utilization**: Actually use server thumbnails that already exist
- **Maintain 120fps**: All optimizations work with existing performance improvements
- **Robust fallback chain**: IndexedDB → Server → Client generation

## Success Metrics

- Page reload time reduced by 80%+ for projects with many images
- Cache hit ratio >90% for repeat project loads
- No duplicate thumbnail processing
- Server thumbnail usage >70% when available

## Technical Implementation Details

### IndexedDB Schema
```javascript
// Store structure
{
  hash: string,           // Image hash (primary key)
  thumbnails: {
    64: Blob,             // 64px thumbnail
    128: Blob,            // 128px thumbnail
    256: Blob,            // 256px thumbnail
    // ... more sizes
  },
  timestamp: number,      // Cache creation time
  serverFilename: string, // Server filename for validation
  version: number         // Schema version for migrations
}
```

### Cache Priority Flow
1. **Check IndexedDB** - Instant if available
2. **Check Server** - 10s timeout with retries
3. **Generate Client-side** - Fallback only
4. **Store in IndexedDB** - For future use

### Performance Monitoring
```javascript
// Cache performance metrics
window.thumbnailCacheStats = {
  hits: { indexedDB: 0, server: 0, generated: 0 },
  misses: 0,
  avgLoadTime: { indexedDB: 0, server: 0, generated: 0 },
  memoryUsage: 0
}
```

This plan builds on the excellent FPS optimizations already implemented while fixing the persistent cache issues that cause performance problems on page reload.