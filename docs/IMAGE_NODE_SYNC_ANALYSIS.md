# Image Node Synchronization Issues Analysis

## Executive Summary

When copying large amounts of image nodes between tabs, synchronization issues arise due to a combination of asynchronous image loading, temporary node handling, optimistic updates, and race conditions in the collaborative system. This leads to tabs showing different images or missing nodes entirely.

## Key Issues Identified

### 1. Asynchronous Image Loading Race Conditions

**Problem**: Image nodes load their content asynchronously via `setImage()`, which creates multiple timing issues:

```javascript
// In image-node.js
async setImage(src, filename = null, hash = null) {
    this.loadingState = 'loading';
    this.loadingProgress = 0.1;
    
    // Asynchronous load that can complete at different times
    this.img = await this.loadImageAsyncOptimized(src);
    
    // Multiple async operations happening in parallel
    if (hash && window.thumbnailCache) {
        window.thumbnailCache.generateThumbnailsProgressive(hash, this.img, ...);
    }
}
```

**Impact**: 
- Different tabs may complete image loading at different times
- Server state updates may arrive before or after local image loading completes
- No synchronization between image loading completion and collaborative state updates

### 2. Temporary Node Matching Issues

**Problem**: The system uses position-based matching to replace temporary nodes with server nodes, but this is unreliable:

```javascript
// In StateSyncManager.js
findTemporaryNodeAtPosition(pos, type) {
    const tolerance = 5; // 5 pixel tolerance
    // Position-based matching can fail with:
    // - Floating point precision issues
    // - Nodes that have moved slightly
    // - Multiple nodes at similar positions
}
```

**Impact**:
- Temporary nodes may not be properly replaced by server nodes
- Can result in duplicate nodes (both temporary and server versions)
- Different tabs may have different matching results

### 3. Image Cache Synchronization

**Problem**: The ImageResourceCache is local to each tab and not synchronized:

```javascript
// Each tab has its own cache instance
window.app.imageResourceCache = new ImageResourceCache();
```

**Impact**:
- Cache misses in one tab don't benefit from cache hits in another
- Server URLs may be cached in one tab but not another
- Different tabs may use different image sources (data URL vs server URL)

### 4. Bulk Operation Chunking and Image Data

**Problem**: When bulk operations are chunked, image data handling becomes complex:

```javascript
// In BulkOperationManager.js
optimizeNodeData(node) {
    if (node.type === 'media/image' && node.properties.hash) {
        if (node.properties.serverUrl) {
            // Send minimal data
            optimized.properties = {
                hash: node.properties.hash,
                serverUrl: node.properties.serverUrl
            };
        } else {
            // Need to send full image data
            optimized.properties = { ...node.properties };
        }
    }
}
```

**Impact**:
- Large copy operations may be split across chunks
- Some chunks may have server URLs while others have data URLs
- Inconsistent handling between chunks can cause sync issues

### 5. Optimistic Updates vs Server State

**Problem**: Optimistic updates create nodes immediately but server state arrives later:

```javascript
// In DuplicateNodesCommand
if (optimisticEnabled || isRemoteOrigin) {
    graph.add(duplicate);
}
```

**Impact**:
- Local nodes may have different IDs than server nodes
- Image loading may start with local data but need to switch to server data
- Race conditions between optimistic cleanup and server state application

### 6. Loading State Management

**Problem**: Loading states are not properly synchronized between tabs:

```javascript
// Loading state is local to each node instance
node.loadingState = 'loading';
node.loadingProgress = 0;
```

**Impact**:
- One tab may show loading progress while another shows the loaded image
- No mechanism to sync loading progress between tabs
- Loading failures in one tab don't propagate to others

## Root Causes

1. **No Image Loading Coordination**: Image loading happens independently in each tab without coordination through the collaborative system.

2. **Weak Node Identity**: Temporary nodes are matched by position rather than a stable identifier, making replacement unreliable.

3. **Local-Only Caching**: Image resource caching happens per-tab rather than being shared or synchronized.

4. **Async Operation Conflicts**: Multiple asynchronous operations (image loading, server sync, thumbnail generation) can interleave in different orders.

5. **Missing State Reconciliation**: No mechanism to reconcile differences in image loading state between tabs after bulk operations.

## Recommendations

### 1. Implement Stable Node Identity
- Use a unique identifier for temporary nodes that persists through server sync
- Replace position-based matching with ID-based matching

### 2. Centralize Image Loading State
- Track image loading state in the collaborative system
- Broadcast loading progress and completion events

### 3. Improve Cache Synchronization
- Share cache state between tabs via server or shared storage
- Ensure all tabs use the same image source (server URL) once available

### 4. Add Image Loading Coordination
- Implement a loading queue that coordinates across tabs
- Ensure image data is fully resolved before applying server state

### 5. Enhance Bulk Operation Handling
- Ensure all nodes in a bulk operation use consistent image sources
- Add validation to ensure image data integrity across chunks

### 6. Implement State Verification
- Add periodic state verification to detect and fix desync issues
- Implement checksum validation for image content

## Test Scenarios

1. **Large Bulk Copy**: Copy 50+ image nodes and verify all tabs show identical results
2. **Rapid Tab Switching**: Copy images and immediately switch tabs during loading
3. **Network Latency**: Simulate slow network conditions during image upload/sync
4. **Cache Miss Scenario**: Clear cache in one tab and verify proper sync
5. **Concurrent Operations**: Have multiple tabs copying images simultaneously