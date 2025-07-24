# Bulk Operations Architecture

## Overview

This document describes the robust bulk operations system implemented to handle large-scale node operations (40+ nodes) without server errors or connection issues.

## Problem Statement

Operations on more than 40-60 nodes were causing:
- Server timeout errors
- WebSocket disconnections
- Lost operations requiring manual retry
- Poor user experience with long waits

## Solution Architecture

### 1. **Multi-Tier Operation Handling**

```
User Action → Local First → Chunking → Background Sync → Server
```

- **Tier 1: Small Operations (≤10 nodes)**
  - Direct synchronous execution
  - Immediate server feedback
  - Traditional request/response pattern

- **Tier 2: Medium Operations (11-50 nodes)**
  - BulkOperationManager with smart chunking
  - Progress notifications
  - Chunked but synchronous execution

- **Tier 3: Large Operations (50+ nodes)**
  - Local-first execution with immediate UI feedback
  - Background sync with adaptive chunking
  - Automatic retry with exponential backoff

### 2. **Key Components**

#### BulkOperationManager
- Chunks operations into digestible pieces (10 nodes default)
- Optimizes payload size (2MB max per chunk)
- Shows progress notifications
- Handles partial failures gracefully

#### BackgroundSyncManager
- Queues operations for background processing
- Monitors connection health
- Adapts chunk size based on network conditions
- Implements retry logic with exponential backoff
- Deduplicates operations to prevent duplicates

#### LocalFirstOperations
- Executes operations locally immediately
- Provides instant UI feedback
- Queues server sync in background
- Handles ID mapping when server responds

### 3. **Optimization Strategies**

#### Payload Optimization
- Images with server URLs only send hash + URL (not base64 data)
- Videos follow same optimization pattern
- Reduces payload size by 90%+ for media nodes

#### Adaptive Chunking
- Starts with 20 nodes per chunk
- Increases to 50 if success rate >90%
- Decreases to 5 if success rate <50%
- Adjusts based on network latency

#### Connection Health Monitoring
- Tracks success/failure rates
- Measures average latency
- Pauses operations when offline
- Resumes automatically when connection restored

### 4. **Usage Examples**

#### Duplicate Operation (Ctrl+D)
```javascript
// Small selection - direct execution
if (nodes.length <= 10) {
    await operationPipeline.execute('node_duplicate', {...});
}

// Medium selection - chunked execution
else if (nodes.length <= 50) {
    await bulkOperationManager.executeBulkOperation(...);
}

// Large selection - local first + background sync
else {
    await localFirstOperations.duplicateLocalFirst(...);
}
```

#### Error Handling
- Operations retry up to 3 times
- Exponential backoff (1s, 2s, 4s)
- Failed operations remain visible locally
- User notified of sync issues

### 5. **Performance Characteristics**

| Operation Size | Execution Method | User Wait Time | Reliability |
|---------------|------------------|----------------|-------------|
| 1-10 nodes    | Direct sync      | <1s            | High        |
| 11-50 nodes   | Chunked sync     | 2-5s           | High        |
| 50-200 nodes  | Local first      | Instant        | Very High   |
| 200+ nodes    | Background queue | Instant        | Very High   |

### 6. **Configuration**

Key parameters (can be tuned based on server capacity):
- `CHUNK_SIZE`: 10 nodes (reduced from 20 for reliability)
- `MAX_PAYLOAD_SIZE`: 2MB per chunk
- `OPERATION_TIMEOUT`: 15 seconds per chunk
- `MAX_RETRIES`: 3 attempts
- `BASE_RETRY_DELAY`: 1 second

### 7. **Future Improvements**

1. **WebSocket Compression**
   - Enable perMessageDeflate for all messages
   - Further reduce bandwidth usage

2. **Operation Batching**
   - Combine multiple small operations
   - Reduce server round trips

3. **Differential Sync**
   - Only send changed properties
   - Further reduce payload size

4. **Progressive Enhancement**
   - Start with essential properties
   - Sync additional data in background

## Testing

Use `.scratch/test-bulk-operations.html` to test various operation sizes and monitor:
- Chunk processing in console
- Network request sizes
- Success/failure rates
- Selection state preservation