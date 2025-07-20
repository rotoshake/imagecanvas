# Network Layer Debug Tools

This directory contains diagnostic tools to help debug why the NetworkLayer is showing "Cannot broadcast: not connected".

## Diagnostic Tools

1. **check-html-source.html** - Verifies that index.html contains the new architecture script tags
2. **error-catcher.html** - Loads the main app in an iframe and catches all JavaScript errors
3. **force-reload-test.html** - Force reloads NetworkLayer.js with cache busting
4. **loaded-scripts.html** - Shows which scripts are actually loaded in the main window
5. **network-diagnostic.html** - Comprehensive network layer diagnostic with step-by-step testing
6. **simple-network-test.html** - Basic test to load NetworkLayer.js directly
7. **test-network-direct.html** - Direct NetworkLayer testing without the full app

## How to Use

1. Start your web server: `python -m http.server 8000`
2. Open any of these files in your browser:
   - `http://localhost:8000/tests/debug/check-html-source.html` - Start here to verify HTML
   - `http://localhost:8000/tests/debug/loaded-scripts.html` - Check what's actually loading
   - `http://localhost:8000/tests/debug/error-catcher.html` - Find JavaScript errors

## Common Issues

1. **Scripts not in HTML** - The new architecture scripts aren't in index.html
2. **Scripts not loading** - Browser is caching old version or scripts have errors
3. **NetworkLayer not connecting** - Socket.IO not available or server not running
4. **Not joining project** - NetworkLayer connects but doesn't join the project

## Quick Fix Attempts

1. Clear browser cache completely (Cmd+Shift+Delete on Mac)
2. Hard reload the page (Cmd+Shift+R)
3. Check browser console for errors
4. Verify server is running on port 3000