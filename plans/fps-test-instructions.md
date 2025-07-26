# FPS Testing Instructions

## How to Use the FPS Test System

### 1. Activate FPS Test Mode
Press **Ctrl+Shift+F** (or Cmd+Shift+F on Mac) to open the FPS test menu.

### 2. Select a Test Mode
After pressing Ctrl+Shift+F, you'll see a menu. Press a number key:
- **1**: Normal rendering (default)
- **2**: Minimal (just draw, no checks)
- **3**: No FPS cap (removes 120 FPS limit)
- **4**: No animations (disables animation systems)
- **5**: No loading checks

### 3. View Results
- The current test mode appears in the stats display (bottom left)
- Frame statistics will be shown after selecting a mode
- Check the console for detailed frame time percentiles

### 4. Analyze Performance
After running in a test mode for a few seconds:
- Press **Ctrl+Shift+F** again and select a different mode
- Compare FPS between modes to identify bottlenecks

## What Each Mode Tests

### Minimal Mode (2)
- Raw canvas drawing performance
- No state checks, no FPS limiting
- Should achieve maximum possible FPS

### No Cap Mode (3)
- Normal rendering without FPS limiting
- Shows if the 120 FPS cap is the limitation

### No Animations Mode (4)
- Disables animation and alignment systems
- Tests if animation updates are the bottleneck

### No Loading Mode (5)
- Skips image loading state checks
- Tests if loading system overhead is significant

## Expected Results

- **Minimal mode** should show your system's maximum FPS capability
- If minimal mode is also capped at 70 FPS, it's likely a browser/system limitation
- If minimal mode reaches 120+ FPS but others don't, the bottleneck is in our code

## Console Commands

You can also control test modes from the console:
```javascript
// Set test mode
app.graphCanvas.setFPSTestMode('minimal');

// Get frame time statistics
app.graphCanvas.getFrameTimeStats();

// Show current stats
app.graphCanvas.showFPSStats();
```

## Troubleshooting

If FPS doesn't improve in minimal mode:
1. Check Chrome's FPS meter (DevTools > Rendering > FPS meter)
2. Verify no other tabs/apps are consuming GPU
3. Check if hardware acceleration is enabled in Chrome
4. Try a different browser to rule out Chrome-specific issues