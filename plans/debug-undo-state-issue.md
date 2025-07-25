# Debug Plan: Undo State Not Showing Existing Operations

## Issue Summary
The undo system shows `canUndo: false` and `undoCount: 0` despite there being 20 nodes in the canvas, suggesting that operations aren't being properly recorded or synchronized between client and server.

## Root Cause Analysis

### 1. User/Project ID Mismatch
- **Issue**: Client shows different user IDs in different places
  - Canvas navigator: `userId: 1` (hardcoded)
  - Undo manager: `userId: 1107` (from server)
  - This mismatch means the server may be storing operations under a different user ID than what the client requests

### 2. Missing Operation History
- **Possible causes**:
  - Operations were created before the undo system was properly initialized
  - Operations are being stored with wrong user/project IDs
  - Server isn't recording operations in the history table
  - Client isn't sending proper undo data with operations

### 3. State Request Issues
- **Symptoms**:
  - `request_undo_state` is sent but returns empty state
  - Server may be querying with wrong user/project combination

## Debug Steps

### 1. Add Comprehensive Server Logging
Add logging to track:
- When operations are received and stored
- What user/project IDs are used
- When undo state is requested and what's returned

### 2. Create Debug Endpoint
Add a server endpoint to query operation history directly:
```javascript
// GET /api/debug/operations/:projectId/:userId
// Returns all operations for debugging
```

### 3. Fix User ID Synchronization
- Ensure consistent user ID across all components
- Use the generated user ID from localStorage
- Pass it properly through all network calls

### 4. Add Operation Validation
- Log when operations are sent to server
- Log when server acknowledges operations
- Track if undo data is included

### 5. Create Test Script
Create a browser console script that:
1. Creates a new node
2. Waits for sync
3. Queries undo state
4. Attempts undo
5. Reports all findings

## Implementation Plan

### Phase 1: Enhanced Logging
1. Add server-side logging for all undo-related operations
2. Add client-side logging for operation lifecycle
3. Create correlation IDs to track operations end-to-end

### Phase 2: Fix User ID Flow
1. Ensure canvas navigator's generated user ID is used everywhere
2. Update NetworkLayer to always use the correct user ID
3. Verify server receives and uses correct user ID

### Phase 3: Debug Tools
1. Create server debug endpoint for operation history
2. Create browser console helper functions
3. Add undo system status display in UI

### Phase 4: Fix Operation Recording
1. Ensure all operations include undo data
2. Verify operations are saved to database
3. Check operation history queries use correct filters

## Success Criteria
- Creating a node shows `canUndo: true` after sync
- Undo successfully removes the created node
- Undo state persists across page reloads
- Multiple users can undo their own operations independently