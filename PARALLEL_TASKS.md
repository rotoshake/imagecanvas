# Parallel Development Task Assignment

## Completed: Phase 1 - Emergency Fixes ✅
- Fixed this.ws → this.socket bug
- Added ConnectionStateMachine for state management
- Implemented ResourceManager for cleanup
- Added ErrorBoundary system for error recovery

**Branch**: `main` (completed and committed)

---

## Phase 2 - Core Refactoring 
**Branch**: `phase2-core-refactoring`
**Worktree**: `./worktrees/phase2/`

### Tasks:
1. **UnifiedOperationHandler** - Eliminate triple implementation
   - Replace the 3 separate operation implementations
   - Create single centralized operation handler
   - File: `js/actions/UnifiedOperationHandler.js`

2. **TransactionManager** - Add atomicity for complex operations  
   - Implement rollback capabilities
   - File: `js/actions/TransactionManager.js`

3. **Centralize State Management**
   - Consolidate state handling logic
   - Remove redundant state tracking

### Priority: High (needed for reliability)

---

## Phase 3 - Performance Optimization
**Branch**: `phase3-performance` 
**Worktree**: `./worktrees/phase3/`

### Tasks:
1. **Operation Batching**
   - Implement OperationBatcher class
   - Reduce network calls by 60-80%
   - File: `js/actions/OperationBatcher.js`

2. **Incremental State Sync** 
   - Replace full-state broadcasts with deltas
   - File: `js/actions/IncrementalStateSynchronizer.js`

3. **Compression for Large Payloads**
   - Add compression for operations > 1KB
   - Move heavy operations to Web Workers

### Priority: Medium (performance improvements)

---

## Coordination Instructions

### For Claude working on Phase 2:
```bash
cd worktrees/phase2
```

### For Claude working on Phase 3:
```bash
cd worktrees/phase3
```

### Communication:
- Each phase should work independently 
- Commit frequently with descriptive messages
- Use branch naming: `phase2-*` or `phase3-*`
- Reference this file for task coordination

### Merge Strategy:
1. Complete and test each phase independently
2. Merge Phase 2 first (critical for stability)
3. Merge Phase 3 after Phase 2 is stable
4. Final integration testing

---

## Success Metrics (from opinionC.md):
- **Sync failures**: Drop from ~15% to <1%
- **Memory usage**: Stable (no growth over time)  
- **Network traffic**: Reduce by 60-80% with batching
- **User-reported bugs**: Decrease by 90%
- **Performance**: Operations complete in <100ms

---

## Next Steps:
1. Clone this repo to separate locations for multiple Claude instances
2. Have one Claude work in each worktree
3. Focus on completing Phase 2 first for maximum stability impact
4. Phase 3 can be developed in parallel once Phase 2 structure is established