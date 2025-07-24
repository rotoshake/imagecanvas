# Disconnection Root Cause Analysis

## Summary
After removing performance monitoring and throttling, the core issue remains: disconnections during duplication operations.

## Key Observations

1. **Not a Performance Issue**: Removed all monitoring/throttling - disconnections still occur
2. **Not a Payload Size Issue**: Happens even with small numbers of nodes
3. **Socket.IO Configuration**: Server already has increased timeouts (120s) and buffer sizes (20MB)

## Likely Root Causes

### 1. Synchronous Blocking
The duplication operation might be blocking the event loop, preventing Socket.IO heartbeats:
- Image processing (hash calculation, thumbnail generation)
- Large data URL serialization
- Synchronous file operations

### 2. Memory Pressure
Rapid object creation without garbage collection:
- Multiple copies of large image data URLs in memory
- Node object cloning creating deep copies
- Cache operations holding references

### 3. Race Conditions
Multiple rapid operations overwhelming the system:
- Optimistic updates disabled/enabled rapidly
- Multiple operations queued simultaneously
- State sync conflicts

## Recommended Fix

### Immediate Solution: Async Processing
Make all heavy operations truly asynchronous:

```javascript
// Instead of blocking operations
async createNodeFromData(nodeData, context) {
    // ... node creation ...
    
    // Yield periodically during heavy operations
    await new Promise(resolve => setImmediate(resolve));
    
    // Process image async
    if (node.type === 'media/image') {
        // Don't block on image loading
        node.loadingState = 'loading';
        
        // Load image in background
        setImmediate(async () => {
            await node.setImage(...);
        });
    }
}
```

### Long-term Solution: Operation Batching
Process duplications in smaller chunks:

```javascript
// Process nodes in batches with yields
const BATCH_SIZE = 5;
for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE);
    await processBatch(batch);
    
    // Yield to event loop
    await new Promise(resolve => setImmediate(resolve));
}
```

## Testing Protocol

1. Open browser DevTools
2. Monitor Network tab for WebSocket frames
3. Watch for "ping" and "pong" messages
4. During duplication, check if pings stop
5. If pings stop = event loop blocked

## Conclusion

The disconnections are likely caused by blocking the JavaScript event loop, preventing Socket.IO from sending/receiving heartbeat pings. The solution is to make all operations truly asynchronous and yield control back to the event loop regularly.