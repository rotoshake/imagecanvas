# Canvas Terminology Cleanup Plan

## Overview
The codebase currently uses inconsistent terminology between "project" and "canvas". This plan outlines the systematic cleanup needed to standardize on "canvas" terminology throughout.

## Current Status

### Client-side Files Updated:
1. **NetworkLayer.js** - Updated:
   - `currentProject` → `currentCanvas`
   - `project_joined` → `canvas_joined` 
   - `project_left` → `canvas_left`
   - `joinProject` → `joinCanvas`
   - `leaveProject` → `leaveCanvas`
   - All internal references updated

2. **StateSyncManager.js** - Updated:
   - Error messages changed from "project" to "canvas"
   - `projectId` → `canvasId` references

3. **ClientUndoManager.js** - Updated:
   - `projectId` → `canvasId`
   - `project_joined` → `canvas_joined` event listener

4. **NavigationStateManager.js** - Updated:
   - `project_joined` → `canvas_joined` event listener

5. **canvas-navigator.js** - Updated:
   - Comments and method names
   - `leaveProjectAndWait` → `leaveCanvasAndWait`
   - Socket event emissions updated

### Server-side Files Partially Updated:
1. **collaboration.js** - Partially updated:
   - Socket event handlers renamed
   - `handleJoinProject` → `handleJoinCanvas`
   - `handleLeaveProject` → `handleLeaveCanvas`
   - `getOrCreateProject` → `getOrCreateCanvas`
   - `projectRooms` → `canvasRooms`
   
   **Still needs updating:**
   - All internal `projectId` references
   - Database query references
   - Socket room names (`project_${id}` → `canvas_${id}`)
   - Event emissions
   - Error messages

## Remaining Work

### 1. Complete Server-side Updates
- **collaboration.js** - Update all remaining project references:
  - `session.projectId` → `session.canvasId`
  - `project_${id}` room names → `canvas_${id}`
  - Database operations referencing `project_id`
  - All event emissions with projectId
  - Error messages

- **OperationHistory.js** - Update project references
- **CanvasStateManager.js** - Update project references  
- **UndoStateSync.js** - Update project references
- **database.js** - Update method names and queries

### 2. Database Schema Migration
- Rename `projects` table to `canvases`
- Rename `project_id` columns to `canvas_id` in all tables:
  - operations
  - operation_history
  - undo_history
  - files (if applicable)

### 3. API Endpoints
- Update REST endpoints from `/projects` to `/canvases`
- Update all request/response objects to use canvas terminology

### 4. Configuration and Constants
- Update CONFIG.ENDPOINTS.PROJECTS to CONFIG.ENDPOINTS.CANVASES
- Update any project-related constants

### 5. Testing and Validation
- Test canvas creation/loading
- Test collaboration features
- Test undo/redo functionality
- Test file operations
- Ensure no "project" references remain in error messages or logs

## Implementation Order
1. Complete collaboration.js updates
2. Update other server modules (OperationHistory, etc.)
3. Update database.js methods
4. Create database migration script
5. Update API endpoints
6. Update client CONFIG
7. Test thoroughly

## Notes
- The database currently has both `projects` and `canvases` tables
- Need to ensure backward compatibility during migration
- Some methods like `createProject` may need to be aliased temporarily