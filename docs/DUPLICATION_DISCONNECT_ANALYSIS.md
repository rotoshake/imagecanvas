# Duplication Disconnect Analysis

## Issue Summary
Server disconnections occur during duplication operations, even with small numbers of nodes (previously only with 60+ nodes).

## Implemented Fixes

### 1. Connection Health Monitoring
- Added real-time connection monitoring before/after operations
- Tracks socket state, pending operations, and memory usage
- Logs detailed diagnostics when connection is lost

### 2. Operation Throttling
- Added intelligent throttling based on pending operations
- Only activates when > 10 operations are pending
- Minimal 20ms delay to prevent WebSocket flooding

### 3. Diagnostic Tools
- Created `.scratch/duplication-disconnect-test.js` for debugging
- Monitors all socket events and operation pipeline
- Provides test function for controlled duplication testing

## Root Cause Analysis

### Potential Causes:
1. **Rapid Message Flooding**: Multiple operations sent too quickly
2. **Memory Pressure**: Large node data causing memory spikes
3. **Circular References**: Node serialization creating infinite loops
4. **Event Loop Blocking**: Synchronous operations blocking socket heartbeat

### Key Findings:
- Socket.IO doesn't expose `bufferedAmount` like WebSocket
- Pending operations queue can indicate connection stress
- Connection loss happens during the operation, not after

## Recommended Next Steps

### 1. Server-Side Investigation
Check server logs for:
- Memory usage during duplication
- Socket.IO disconnect reasons
- Error messages during node creation

### 2. Client-Side Monitoring
Run the diagnostic script:
```javascript
// Copy contents of .scratch/duplication-disconnect-test.js to console
// Then test with: testDuplication(5)
```

### 3. Possible Additional Fixes

#### A. Add Batch Processing
Instead of sending all nodes at once, batch them:
```javascript
// Process nodes in chunks of 10
const chunkSize = 10;
for (let i = 0; i < nodeIds.length; i += chunkSize) {
    const chunk = nodeIds.slice(i, i + chunkSize);
    await processChunk(chunk);
    await new Promise(resolve => setTimeout(resolve, 50));
}
```

#### B. Add Connection Keep-Alive
Prevent timeout during long operations:
```javascript
// Send periodic ping during operation
const keepAlive = setInterval(() => {
    socket.emit('ping');
}, 5000);
// Clear after operation
```

#### C. Optimize Node Serialization
Check for circular references or large data:
```javascript
// Add size check before sending
const serialized = JSON.stringify(nodeData);
if (serialized.length > 1000000) { // 1MB
    console.warn('Large payload detected');
}
```

## Testing Protocol

1. Open browser console
2. Run diagnostic script
3. Test with increasing node counts:
   - `testDuplication(1)` - baseline
   - `testDuplication(5)` - small batch
   - `testDuplication(10)` - medium batch
   - `testDuplication(20)` - large batch

4. Monitor for:
   - Exact disconnection timing
   - Memory usage spikes
   - Pending operation buildup
   - Socket event sequence

## Performance Impact

The implemented throttling has minimal impact:
- Only activates under stress (>10 pending ops)
- 20ms delay is imperceptible to users
- Prevents cascading failures
- No impact on single operations

## Conclusion

The fixes implemented provide:
1. Better visibility into disconnection causes
2. Protection against rapid-fire operations
3. Tools for further debugging

The disconnections with small node counts suggest the issue isn't payload size but rather timing or serialization. Server logs and the diagnostic script will help identify the exact cause.