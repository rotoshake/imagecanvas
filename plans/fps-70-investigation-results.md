# 70 FPS Investigation Results

## Current Findings

### Observed Behavior
- Canvas showing 71 FPS with 21 image nodes loaded
- FPS appears to be capped around 70-71
- Simple animation test can achieve 120 FPS (confirmed in earlier test)
- This indicates the issue is in our render pipeline, not browser/system

### Potential Causes

1. **Continuous Render Triggers**
   - Something is forcing continuous redraws even when nothing is changing
   - Need to check what's setting `dirty_canvas = true`

2. **Loading State Checks**
   - Every 100ms we check all nodes for loading state
   - With 21 nodes, this could be significant overhead

3. **Animation System**
   - Even with no active animations, the system still updates every frame
   - Spring animations might never truly "complete"

4. **Frame Scheduling**
   - The FPS limiting logic might be interfering with browser's natural scheduling
   - Target frame time calculation could be off

## Next Steps

1. Use the FPS test modes to isolate the issue:
   - Minimal mode: Test raw performance
   - No animations: Disable animation updates
   - No cap: Remove FPS limiting

2. Check Chrome DevTools:
   - Performance tab to see actual frame timing
   - Rendering tab to check paint/composite costs

3. Add more detailed logging:
   - Track what's triggering each frame
   - Measure time spent in each render phase

## Hypothesis

The 70-71 FPS cap is likely due to:
1. Continuous render triggers from one of the subsystems
2. The render loop timing interfering with browser vsync (70 Hz is an unusual refresh rate)
3. Hidden overhead in the visibility culling or node rendering

Since simple animations achieve 120 FPS, this is definitely fixable and not a hardware limitation.