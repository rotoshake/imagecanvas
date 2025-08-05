# Bulk Upload Optimization Plan

## Current Issue

When uploading 200 images, the system fails for about half of them due to:

1. **WebSocket Flooding** - 200 individual `node_create` operations sent through WebSocket
2. **HTTP Connection Limits** - Up to 12 concurrent uploads overwhelming the server
3. **State Sync Timeouts** - Operations timing out due to queue backlog
4. **Server Overload** - Too many concurrent operations

## Key Finding

**We ARE using HTTP uploads correctly!** The issue is not with image data being sent through WebSocket. The problem is the sheer volume of operations:
- 200 node creation operations
- 200 HTTP upload requests  
- 200 upload completion operations
- All happening nearly simultaneously

## Proposed Solution

### 1. Batch Node Creation

Instead of:
```javascript
// Current: 200 individual operations
for (const node of nodes) {
    await operationPipeline.execute('node_create', {...})
}
```

Implement:
```javascript
// Proposed: Batched operations
await operationPipeline.execute('batch_node_create', {
    nodes: nodes.map(n => ({
        type: n.type,
        pos: n.pos,
        size: n.size,
        properties: n.properties
    }))
})
```

### 2. Progressive Upload Strategy

```javascript
// Phase 1: Create all nodes (batched)
const nodes = await createNodes(files);

// Phase 2: Upload in controlled batches
const UPLOAD_BATCH_SIZE = 6; // Respect browser connection limit
for (let i = 0; i < nodes.length; i += UPLOAD_BATCH_SIZE) {
    const batch = nodes.slice(i, i + UPLOAD_BATCH_SIZE);
    await Promise.all(batch.map(node => uploadImage(node)));
    
    // Brief pause between batches
    await new Promise(resolve => setTimeout(resolve, 100));
}
```

### 3. Deferred State Sync

- Create nodes locally first
- Upload images in background
- Sync state in batches after uploads complete
- Use operation bundling for efficiency

## Implementation Steps

1. **Create Batch Operations**
   - `batch_node_create` command
   - `batch_upload_complete` command
   - Server support for batch operations

2. **Optimize Upload Queue**
   - Reduce concurrent limit for bulk operations
   - Add inter-batch delays
   - Monitor server response times

3. **Progressive Loading**
   - Show nodes immediately with loading state
   - Load thumbnails first
   - Defer full resolution loading

4. **Server Optimization**
   - Increase connection limits
   - Implement request queuing
   - Add batch operation endpoints

## Expected Results

- Reduce WebSocket messages from 600+ to ~10
- Control HTTP connection usage
- Prevent timeout failures
- Support 1000+ image uploads reliably

## Current Workarounds

Until implemented, users can:
1. Upload in smaller batches (50-100 images)
2. Wait between batches
3. Use folder upload for better batching
4. Increase server connection limits