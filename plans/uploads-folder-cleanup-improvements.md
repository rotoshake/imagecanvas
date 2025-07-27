# Uploads Folder Cleanup Improvements

## Current State
The uploads folder stores full resolution images permanently, which is necessary for the zoom functionality. However, there are several gaps in garbage collection.

## Issues
1. No cleanup on upload failure
2. No cleanup when nodes are deleted
3. No automatic cleanup on server startup
4. Files can accumulate from interrupted uploads, deleted nodes, or failed operations

## Proposed Improvements

### 1. Server Startup Cleanup
Add automatic cleanup when server starts:
```javascript
async initializeServer() {
    await this.cleanupOrphanedFiles();
    // ... rest of initialization
}
```

### 2. Upload Failure Cleanup
Wrap upload process in try-catch with cleanup:
```javascript
try {
    // upload and thumbnail generation
} catch (error) {
    // Delete the uploaded file if anything fails
    await fs.unlink(uploadPath).catch(() => {});
    throw error;
}
```

### 3. Node Deletion Tracking
When a node is deleted:
- Check if it's the last node using that file hash
- If yes, mark the file for deletion after a grace period
- Could use a "deletion_pending" table with timestamps

### 4. Periodic Background Cleanup
Run a background job every hour/day that:
- Checks for files not referenced in any canvas
- Removes files marked for deletion after grace period
- Cleans up incomplete uploads older than 24 hours

### 5. Reference Counting
Implement proper reference counting:
- Track how many nodes use each file
- Only delete when count reaches zero
- Handle duplicated nodes correctly

## Implementation Priority
1. Server startup cleanup (easiest, immediate benefit)
2. Upload failure cleanup (prevents new orphans)
3. Manual cleanup improvements (already partially done)
4. Background periodic cleanup
5. Full reference counting system