# Undo System Audit - Image Upload Integration

## Issue Summary

The undo system exhibits unexpected behavior with the new image upload logic:
- Sometimes undo works correctly
- Sometimes undo does nothing
- The issue is specifically related to how uploaded images are handled

## Root Cause Analysis

### Current Image Upload Flow

1. **Immediate Local Display**:
   - User drops image
   - Temporary node created locally with `_isTemporary` flag
   - Image displayed immediately using local data URL

2. **Background Upload**:
   - Image uploaded to server via HTTP
   - Server returns URL

3. **Server Sync**:
   - `operationPipeline.execute('node_create')` called
   - Server creates new node with different ID
   - Temporary local node removed
   - Server node replaces it in the graph

### Why Undo Fails

1. **Timing Issue**: 
   - Undo operation captures the server node ID
   - But this happens AFTER the temporary node is removed
   - Undo tries to remove a node that was already removed

2. **ID Mismatch**:
   - Temporary node has one ID
   - Server node has different ID
   - Undo data references server node ID
   - But the operation that created the visual node (temporary) has different ID

3. **Double Operations**:
   - Two separate operations occur:
     - Creating temporary node (not tracked)
     - Creating server node (tracked)
   - Only the server operation is in undo history

## Test Results

Testing revealed:
- Undo manager is properly initialized
- Interceptors are correctly set up
- Operations ARE being captured
- But the captured operation doesn't match what the user sees

## Solution Options

### Option 1: Track Temporary Node Creation
- Capture the initial temporary node creation in undo history
- Link it to the server sync operation
- When undoing, remove both nodes

### Option 2: Single Operation Flow
- Don't create temporary node separately
- Use operation pipeline from the start
- Let operation pipeline handle immediate display AND server sync

### Option 3: Update Undo Data After Sync
- After server sync completes, update the undo data
- Map temporary node ID to server node ID
- Ensure undo removes the correct node

## Recommended Fix

Option 2 is cleanest - modify dragdrop.js to use operation pipeline from the start:

1. When image dropped, immediately call `operationPipeline.execute('node_create')`
2. Let the operation pipeline:
   - Create node locally for immediate display
   - Handle background upload
   - Update node with server data when ready
3. This ensures single operation in undo history that correctly tracks the node

## Implementation Plan

1. Modify dragdrop.js to use operation pipeline immediately
2. Update CreateNodeCommand to handle background upload
3. Ensure undo data tracks the correct node throughout its lifecycle
4. Test undo/redo with various scenarios