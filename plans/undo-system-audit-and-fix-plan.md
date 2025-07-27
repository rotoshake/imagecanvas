# Undo System Deep Audit & Fix Plan

## Executive Summary

The collaborative undo system is broken due to architectural conflicts between multiple undo managers, improper timing of undo data capture, and incomplete operation bundling. This document provides a comprehensive audit of the issues and a detailed plan to fix them.

## Current Architecture Overview

### Multiple Competing Undo Managers

The system currently has three different undo/redo managers that are interfering with each other:

1. **HybridUndoRedoManager** (`js/core/HybridUndoRedoManager.js`)
   - Designed for offline/local undo with bundling support
   - Has its own history tracking and interceptors
   - Conflicts with server-authoritative approach

2. **CollaborativeUndoRedoManager** (`js/core/CollaborativeUndoRedoManager.js`)
   - Server-authoritative undo for multi-user collaboration
   - Routes undo/redo through server when connected
   - Has duplicate recording issues

3. **ClientUndoManager** (`js/core/ClientUndoManager.js`)
   - Legacy component that may still be referenced
   - Should be removed entirely

## Critical Issues Found

### 1. Double Recording of Operations

**Problem**: Operations are being recorded both client-side and server-side when connected to the server.

**Evidence**: In `CollaborativeUndoRedoManager.captureExecutedCommand()`:
```javascript
// CRITICAL FIX: Skip recording if we're in server-connected mode
// This prevents double recording - operations are already recorded on server
if (this.network?.isConnected && this.app.stateSyncManager) {
    console.log('🔄 Skipping client-side recording - using server-authoritative undo');
    return;
}
```

This comment indicates an attempted fix, but the issue persists because multiple managers are still active.

### 2. Broken Operation Bundling

**Problem**: Drag operations and multi-select operations are not properly bundled into single undo actions.

**Evidence**: 
- Drag operations create multiple individual move commands instead of one bundled command
- The bundling window (100ms) is too short for drag operations
- Initial positions are not consistently captured for proper undo

### 3. Timing Issues with Undo Data Preparation

**Problem**: `prepareUndoData()` is called at the wrong time, missing initial node states.

**Evidence**: In `StateSyncManager.executeOperation()`:
- Undo data is prepared AFTER optimistic execution
- This captures the wrong state for undo operations
- Initial positions for moves are lost

### 4. Incomplete Navigation Filtering

**Problem**: Navigation operations like gallery view are not properly excluded from undo history.

**Current exclusions**:
```javascript
this.excludeFromHistory = new Set([
    'viewport_pan',
    'viewport_zoom',
    'selection_change',
    'hover_change',
    'cursor_move'
]);
```

**Missing exclusions**:
- Gallery view entry/exit
- Node selection clicks
- Bounding box selections
- Focus operations

### 5. Inconsistent Node Type Handling

**Problem**: Different node types (image, video, text) handle undo data differently.

**Issues**:
- Text nodes may not properly save text content for undo
- Video nodes don't preserve playback state
- Media nodes lose their loaded state after undo

## Detailed Fix Plan

### Phase 1: Fix Core Architecture (Priority: Critical)

#### 1.1 Unify Undo Management

**Actions**:
1. Remove `HybridUndoRedoManager` from the codebase
2. Make `CollaborativeUndoRedoManager` the single undo manager
3. Update app initialization to only create one manager
4. Remove duplicate interceptor setup

**Code changes**:
- Delete `/js/core/HybridUndoRedoManager.js`
- Update app initialization to remove hybrid manager references
- Ensure CollaborativeUndoRedoManager handles both online and offline modes

#### 1.2 Fix Undo Data Preparation Timing

**Actions**:
1. Move `prepareUndoData()` call BEFORE command execution
2. Ensure initial state is captured correctly
3. Add validation to reject operations without proper undo data

**Code changes in `StateSyncManager.executeOperation()`**:
```javascript
// Prepare undo data BEFORE execution
if (command.prepareUndoData && typeof command.prepareUndoData === 'function') {
    await command.prepareUndoData(context);
}

// Then execute optimistically
const { rollbackData, localResult } = await this.applyOptimistic(command);
```

### Phase 2: Fix Operation Bundling (Priority: High)

#### 2.1 Implement Proper Drag Bundling

**Actions**:
1. Track drag session from start to finish
2. Store initial positions at drag start
3. Create single bundled command at drag end
4. Include all position changes in one undo entry

**Code changes in `CanvasIntegration`**:
- Add drag session tracking
- Capture initial positions on mouse down
- Bundle all moves on mouse up
- Pass bundle metadata through pipeline

#### 2.2 Fix Multi-Select Operation Bundling

**Actions**:
1. Detect operations on multiple selected nodes
2. Bundle operations with same source (e.g., 'alignment', 'group_rotation')
3. Handle compound operations (move + rotate from bounding box)

**Bundle detection patterns**:
- Same operation type on multiple nodes within time window
- Operations with same 'source' parameter
- Bounding box handle operations

### Phase 3: Improve Operation Filtering (Priority: Medium)

#### 3.1 Expand Navigation Exclusions

**Actions**:
1. Add gallery view operations to exclusion list
2. Add node selection operations
3. Add bounding box selection operations

**Updated exclusion set**:
```javascript
this.excludeFromHistory = new Set([
    'viewport_pan',
    'viewport_zoom',
    'selection_change',
    'hover_change',
    'cursor_move',
    'gallery_enter',
    'gallery_exit',
    'node_select',
    'node_deselect',
    'bounding_box_select',
    'focus_change'
]);
```

#### 3.2 Implement Proper Text Node Support

**Actions**:
1. Add text content to undo data
2. Preserve cursor position and selection
3. Handle text formatting changes

**Text node undo data**:
```javascript
{
    content: node.content,
    cursorPosition: node.cursorPosition,
    selection: node.selection,
    formatting: node.formatting
}
```

### Phase 4: Enhance Reliability (Priority: Medium)

#### 4.1 Add Robust Error Handling

**Actions**:
1. Handle missing nodes gracefully
2. Provide clear user feedback
3. Add retry logic for network failures
4. Log detailed error information

**Error handling patterns**:
- Validate node existence before undo
- Show user-friendly error messages
- Retry failed server operations
- Fallback to partial undo if possible

#### 4.2 Improve State Consistency

**Actions**:
1. Ensure canvas updates after every undo/redo
2. Clean up optimistic updates properly
3. Maintain correct state version tracking
4. Handle concurrent operations

### Phase 5: Testing & Validation (Priority: High)

#### 5.1 Test Scenarios

1. **Basic Operations**:
   - Single node move undo/redo
   - Multi-node move undo/redo
   - Create and delete operations
   - Property changes

2. **Complex Operations**:
   - Drag operations (single and multi-node)
   - Bounding box rotation + move
   - Alignment operations
   - Bulk operations

3. **Edge Cases**:
   - Undo after node deletion by another user
   - Redo with state conflicts
   - Network disconnection during undo
   - Rapid undo/redo sequences

4. **Collaborative Scenarios**:
   - Multiple users undoing simultaneously
   - Undo affecting another user's nodes
   - Cross-tab undo synchronization

## Implementation Order

1. **Week 1**: Core Architecture Fixes
   - Fix undo data preparation timing
   - Remove duplicate undo managers
   - Unify under CollaborativeUndoRedoManager

2. **Week 2**: Operation Bundling
   - Implement proper drag bundling
   - Fix multi-select operation bundling
   - Add compound operation support

3. **Week 3**: Filtering & Node Support
   - Add missing navigation filters
   - Implement text node undo support
   - Fix media node state preservation

4. **Week 4**: Testing & Polish
   - Comprehensive testing
   - Error handling improvements
   - Performance optimization
   - Documentation updates

## Success Metrics

1. **Functional Requirements**:
   - Single drag = single undo action
   - Multi-select operations bundle correctly
   - Navigation operations excluded from history
   - All node types support undo/redo

2. **Performance Requirements**:
   - Undo/redo completes in < 100ms
   - No memory leaks from history tracking
   - Efficient state storage

3. **Reliability Requirements**:
   - No data loss during undo/redo
   - Graceful handling of conflicts
   - Clear user feedback
   - Consistent state across all clients

## Risks & Mitigations

1. **Risk**: Breaking existing functionality
   - **Mitigation**: Comprehensive test suite before deployment

2. **Risk**: Performance degradation
   - **Mitigation**: Profile and optimize bundling logic

3. **Risk**: Collaborative conflicts
   - **Mitigation**: Server-side conflict resolution

4. **Risk**: Large undo history memory usage
   - **Mitigation**: Implement history size limits and cleanup

## Conclusion

The undo system requires significant refactoring to work properly. The main issues stem from architectural conflicts between multiple undo managers and incorrect timing of state capture. By following this plan, we can create a robust, efficient undo system that properly handles all canvas operations while maintaining consistency in collaborative environments.