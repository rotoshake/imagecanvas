# Copy/Paste Dropping Nodes Analysis

## Problem Summary
When copying and pasting large amounts of nodes, some nodes are being silently dropped and not appearing in the pasted result.

## Root Cause Analysis

### 1. Failed Chunks Are Not Included in Results

In `BulkOperationManager.js`, when processing chunks, if a chunk fails, it's caught but **no result is pushed to the chunkResults array**:

```javascript
// Line 111-134
try {
    const chunkResult = await this.processChunk(
        operationType,
        chunk,
        params,
        operation
    );
    
    chunkResults.push(chunkResult); // ✅ Success: result is pushed
    operation.processedItems += chunk.items.length;
    
} catch (error) {
    console.error(`❌ Chunk ${i + 1} failed:`, error);
    operation.errors.push({
        chunk: i,
        error: error.message,
        items: chunk.items.length
    });
    
    // ❌ PROBLEM: No result pushed for failed chunk!
    // The nodes in this chunk are lost
    
    if (this.shouldAbortOnError(error)) {
        throw error;
    }
}
```

### 2. The combineChunkResults Function Only Processes Successful Results

The `combineChunkResults` function iterates through chunkResults, but failed chunks never made it into this array:

```javascript
// Line 262-282
combineChunkResults(chunkResults, operationType) {
    const combined = {
        success: true,
        result: {
            nodes: [],
            errors: []
        }
    };
    
    for (const chunkResult of chunkResults) {
        // Only processes results that were pushed to chunkResults array
        // Failed chunks are not here!
        if (chunkResult && chunkResult.result) {
            if (chunkResult.result.nodes) {
                combined.result.nodes.push(...chunkResult.result.nodes);
            }
        }
    }
    
    return combined;
}
```

### 3. Progress Tracking vs Actual Results Mismatch

The operation tracks `processedItems` even for failed chunks, but the actual results don't include those nodes:

- `operation.processedItems += chunk.items.length` happens regardless of success/failure
- But failed chunks don't contribute to the final result
- This creates a mismatch between what's reported and what's actually pasted

### 4. Validation Might Be Filtering Out Valid Nodes

The `validateItems` function filters nodes for certain operations:

```javascript
// Line 19-39
validateItems(items, operationType) {
    if (operationType === 'node_move' || operationType === 'node_duplicate') {
        // Filters out temporary/failed nodes
        return items.filter(nodeId => {
            const node = window.app?.graph?.getNodeById(nodeId);
            if (!node) {
                console.warn(`Skipping non-existent node: ${nodeId}`);
                return false;
            }
            if (node._isTemporary || node._localId || node._syncFailed) {
                console.warn(`Skipping temporary/failed node: ${nodeId}`);
                return false;
            }
            return true;
        });
    }
    return items; // node_paste passes through without validation
}
```

However, `node_paste` operations pass through without validation, so this isn't the issue for paste operations.

## Impact

1. **Silent Data Loss**: Users copy N nodes but only get M nodes pasted (where M < N)
2. **No User Feedback**: Failed chunks are logged to console but users don't see any error
3. **Inconsistent Results**: The same copy/paste operation might work differently depending on network conditions or server load

## Solution

The fix needs to handle failed chunks properly:

1. **Option A**: Retry failed chunks with exponential backoff
2. **Option B**: Include partial results from failed chunks if any nodes succeeded
3. **Option C**: Abort the entire operation if any chunk fails and rollback
4. **Option D**: Track failed nodes and report them to the user

The most user-friendly approach would be Option A with fallback to Option D - retry failed chunks, and if they still fail, report which nodes couldn't be pasted.

## Verification Steps

1. Copy a large number of nodes (>100)
2. Monitor the console for "Chunk X failed" messages
3. Count the number of nodes actually pasted vs copied
4. Check if the missing nodes correspond to failed chunks

## Related Issues

- Chunk size is currently 10 nodes (`CHUNK_SIZE = 10`)
- Timeout is 15 seconds per chunk (`OPERATION_TIMEOUT = 15000`)
- Max payload size is 2MB per chunk (`MAX_PAYLOAD_SIZE = 2 * 1024 * 1024`)

These limits might need adjustment based on node complexity and network conditions.