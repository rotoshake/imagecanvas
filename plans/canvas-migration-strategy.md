# Canvas Migration Strategy

## Current State
We have a mixed state where:
- Client-side code uses "canvas" terminology
- Server-side code is partially updated to "canvas"
- Database schema still uses "project" terminology
- Some methods are aliased (bandaid approach)

## Problems with Current Approach
1. **Aliases are confusing** - Having both `initializeProject` and `initializeCanvas` makes the codebase harder to understand
2. **Inconsistent terminology** - Mixed use of project/canvas throughout
3. **Database mismatches** - Code refers to `canvas_id` but DB has `project_id`
4. **Technical debt** - The longer we wait, the harder it becomes

## Recommended Approach

### Option 1: Full Migration Now (Recommended)
Complete the migration in one go:

1. **Database Migration**
   - Rename `projects` table to `canvases`
   - Rename all `project_id` columns to `canvas_id`
   - Update all foreign key constraints
   - Create migration script for existing data

2. **Server Code Updates**
   - Update all method names (no aliases)
   - Update all SQL queries
   - Update all variable names
   - Update all comments

3. **API Updates**
   - Change `/projects` endpoints to `/canvases`
   - Update response field names

4. **Client Updates**
   - Update CONFIG.ENDPOINTS.PROJECTS to CONFIG.ENDPOINTS.CANVASES
   - Ensure all references are consistent

### Option 2: Revert to Project Terminology
If full migration is too risky right now:

1. **Revert Client Changes**
   - Change back to project terminology
   - Keep the fixes but use old names

2. **Revert Server Changes**
   - Use project terminology consistently
   - Remove any canvas references

3. **Plan Migration for Later**
   - Document the desired end state
   - Schedule for a maintenance window

## Decision Point
The aliases approach (current state) is the worst of both worlds:
- It doesn't fully solve the confusion
- It adds complexity
- It makes the codebase harder to maintain

We should either:
- **Commit to canvas** and finish the migration properly
- **Stay with project** until we can do a clean migration

## My Recommendation
**Do the full migration now**. We've already done significant work, and the system is partially broken anyway. Let's fix it properly rather than adding more bandaids.