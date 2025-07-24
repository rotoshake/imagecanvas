# Bulk Copy Fix Plan

## Problem Statement
When copying large numbers of nodes (50+), some nodes are silently lost during the paste operation. This happens because:
1. Chunk size is too small (10 nodes)
2. Validation incorrectly filters nodes
3. No proper error recovery for paste operations

## Proposed Solution

### 1. Increase Chunk Size Based on Operation Type
```javascript
// BulkOperationManager.js
getChunkSize(operationType) {
    switch(operationType) {
        case 'node_paste':
        case 'node_duplicate':
            return 50; // Larger chunks for creation operations
        case 'node_move':
            return 30; // Medium chunks for updates
        case 'node_delete':
            return 100; // Large chunks for deletions (lightweight)
        default:
            return 20;
    }
}
```

### 2. Fix Validation for Paste Operations
```javascript
validateItems(items, operationType) {
    // Paste operations send node data, not IDs - don't validate
    if (operationType === 'node_paste') {
        return items;
    }
    
    // Only validate operations that use node IDs
    if (operationType === 'node_move' || operationType === 'node_delete') {
        // ... existing validation
    }
    
    return items;
}
```

### 3. Add Intelligent Retry with Smaller Chunks
```javascript
async executeChunkWithRetry(chunk, operationType, options, retryCount = 0) {
    try {
        return await this.sendChunk(chunk, operationType, options);
    } catch (error) {
        if (retryCount < this.MAX_RETRIES) {
            // For large chunks that fail, try splitting them
            if (chunk.items.length > 10) {
                console.log(`Splitting failed chunk of ${chunk.items.length} items`);
                const midpoint = Math.floor(chunk.items.length / 2);
                const chunk1 = { items: chunk.items.slice(0, midpoint) };
                const chunk2 = { items: chunk.items.slice(midpoint) };
                
                const results = await Promise.all([
                    this.executeChunkWithRetry(chunk1, operationType, options, retryCount + 1),
                    this.executeChunkWithRetry(chunk2, operationType, options, retryCount + 1)
                ]);
                
                return this.mergeResults(results);
            }
            
            // Small chunk - retry with backoff
            await this.delay(this.RETRY_DELAY * Math.pow(2, retryCount));
            return this.executeChunkWithRetry(chunk, operationType, options, retryCount + 1);
        }
        
        throw error;
    }
}
```

### 4. Add Progress Tracking with Accurate Counts
```javascript
// Track actual progress
let processedCount = 0;
let failedCount = 0;

for (const chunk of chunks) {
    try {
        const result = await this.executeChunkWithRetry(chunk, operationType, options);
        processedCount += result.nodes.length;
    } catch (error) {
        failedCount += chunk.items.length;
        // Continue processing other chunks
    }
}
```

### 5. Implement Client-Side Verification
```javascript
// After paste operation completes
async verifyPasteOperation(expectedCount, actualNodes) {
    if (actualNodes.length < expectedCount) {
        const missing = expectedCount - actualNodes.length;
        console.warn(`⚠️ ${missing} nodes missing from paste operation`);
        
        // Show user notification
        window.app?.notifications?.show({
            type: 'warning',
            message: `Only ${actualNodes.length} of ${expectedCount} nodes were pasted. Retrying missing nodes...`,
            timeout: 5000
        });
        
        // Attempt recovery...
    }
}
```

### 6. Add Server-Side Batching Support
Instead of processing each chunk separately, allow the server to accept larger batches and process them more efficiently:

```javascript
// Server-side
async handleBulkPaste(nodeDataArray) {
    const batchSize = 100;
    const results = [];
    
    for (let i = 0; i < nodeDataArray.length; i += batchSize) {
        const batch = nodeDataArray.slice(i, i + batchSize);
        const batchResults = await this.processBatch(batch);
        results.push(...batchResults);
    }
    
    return results;
}
```

## Implementation Priority
1. **Immediate Fix**: Increase chunk size and fix validation (items 1 & 2)
2. **Medium Term**: Add intelligent retry and progress tracking (items 3 & 4)
3. **Long Term**: Implement verification and server batching (items 5 & 6)

## Testing Plan
1. Test with 50, 100, 200, 500 nodes
2. Test with mixed node types (images, text, etc.)
3. Test with network throttling
4. Test with server under load
5. Verify all nodes are pasted correctly

## Success Metrics
- 100% of copied nodes should be pasted (or user notified of failures)
- Paste operations should complete in < 5 seconds for 100 nodes
- No silent data loss
- Clear user feedback throughout the process