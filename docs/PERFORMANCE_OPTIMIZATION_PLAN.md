# Performance Optimization Action Plan

## Issue 1: Slow Bulk Rotation Reset (Half-second delay per image)

### Current Problem
When selecting multiple images and resetting their rotations, each operation appears to execute sequentially with server round-trips, causing a ~500ms delay per image.

### Root Cause Analysis
1. The `node_reset` command executes through the operation pipeline
2. Each operation waits for server acknowledgment before visual update
3. No local-first optimization for bulk operations

### Solution: Implement Local-First Bulk Operations

#### Phase 1: Immediate Local Updates
```javascript
// In ResetNodeCommand.execute()
async execute(context) {
    // 1. Apply all changes locally immediately
    const nodes = this.params.nodeIds.map(id => graph.getNodeById(id));
    nodes.forEach((node, i) => {
        if (this.params.resetRotation) {
            node.rotation = 0;
        }
        // ... other resets
    });
    
    // 2. Trigger immediate canvas redraw
    context.canvas.dirty_canvas = true;
    
    // 3. Then sync with server (non-blocking)
    // Server sync happens in background
}
```

#### Phase 2: Batch Operations
- Combine multiple reset operations into a single server request
- Use operation batching with a small time window (50ms)

#### Phase 3: Optimize Rendering
- Batch canvas updates for multiple nodes
- Use requestAnimationFrame for smoother updates

---

## Issue 2: Image Duplication Re-uploads Same Files

### Current Problem
When duplicating images, the system re-uploads the same file to the server even though it has the same hash, causing unnecessary delays and bandwidth usage.

### Root Cause Analysis
1. `DuplicateNodesCommand` creates new node instances without checking for existing resources
2. No hash-based deduplication on client side
3. Thumbnails are regenerated instead of reused

### Solution: Implement Client-Side Image Deduplication

#### Phase 1: Hash-Based Resource Sharing
```javascript
// Add to app initialization
class ImageResourceCache {
    constructor() {
        this.hashToUrl = new Map();      // hash -> server URL
        this.hashToThumbnail = new Map(); // hash -> thumbnail URL
        this.hashToFile = new Map();      // hash -> File/Blob
    }
    
    async getOrUpload(file, hash) {
        if (this.hashToUrl.has(hash)) {
            return {
                url: this.hashToUrl.get(hash),
                thumbnail: this.hashToThumbnail.get(hash),
                cached: true
            };
        }
        // Only upload if not cached
        return this.uploadNewImage(file, hash);
    }
}
```

#### Phase 2: Modify Duplication Logic
```javascript
// In DuplicateNodesCommand
async createNodeFromData(nodeData, context) {
    const node = NodeFactory.createNode(nodeData.type);
    
    if (node.type === 'media/image' && nodeData.properties.hash) {
        // Check cache first
        const cached = app.imageCache.get(nodeData.properties.hash);
        if (cached) {
            node.properties.src = cached.url;
            node.properties.serverFilename = cached.serverFilename;
            // Skip upload entirely
        }
    }
    
    return node;
}
```

#### Phase 3: Server-Side Optimization
- Implement hash-based deduplication on server
- Return existing file info if hash matches
- Share storage between identical images

---

## Implementation Priority

### High Priority (Immediate Impact)
1. **Local-first bulk operations** - Fixes the most visible performance issue
2. **Client-side image cache** - Prevents redundant uploads

### Medium Priority (Quality of Life)
3. **Operation batching** - Reduces server load
4. **Thumbnail sharing** - Saves bandwidth and processing

### Low Priority (Future Optimization)
5. **Progressive image loading** - Load low-res first, then high-res
6. **WebWorker processing** - Offload heavy operations

---

## Estimated Timeline

1. **Week 1**: Local-first bulk operations
   - Modify ResetNodeCommand for immediate updates
   - Test with 100+ selected nodes
   
2. **Week 2**: Image deduplication system
   - Implement ImageResourceCache
   - Modify duplicate/paste commands
   
3. **Week 3**: Testing and refinement
   - Performance benchmarks
   - Edge case handling

---

## Success Metrics

1. Bulk rotation reset: < 100ms total for 100 nodes (vs current ~50 seconds)
2. Image duplication: No upload for duplicates (vs current re-upload)
3. Bandwidth reduction: 90%+ for duplicate-heavy workflows
4. User perception: Instant visual feedback for all operations