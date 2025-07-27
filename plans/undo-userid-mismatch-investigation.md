# Undo System UserId Investigation

## Problem
The server reports `canUndo: false` even after operations are executed and recorded.

## Investigation Results

### 1. Operation Recording
From `/server/src/realtime/collaboration.js:569`:
```javascript
await this.operationHistory.recordOperation(
    operation,
    session.userId,  // This is passed correctly
    projectId,
    txId
);
```

### 2. Session Creation
From `/server/src/realtime/collaboration.js:140-148`:
```javascript
const session = {
    socketId: socket.id,
    userId: user.id,  // Numeric user ID from database
    projectId: project.id,
    username: user.username,
    displayName: user.display_name || user.username,
    tabId: tabId || `tab-${Date.now()}`,
    joinedAt: Date.now()
};
```

### 3. Undo Filtering
From `/server/src/undo/OperationHistory.js:209`:
```javascript
// Only consider operations from this user that are applied
if (op && op.userId === userId && op.state === 'applied') {
```

## Potential Issues

1. **Type Mismatch**: The userId might be stored as different types (string vs number)
2. **Missing undoData**: Operations without undoData are not undoable
3. **User ID not matching**: The userId in the operation might not match the session userId

## Debug Plan

Add logging to verify:
1. What userId is being used when recording operations
2. What userId is being used when checking for undoable operations
3. Whether operations have undoData
4. The data types of userIds being compared

## Next Step
Add debug logging to the server to trace the userId flow and undoData presence.