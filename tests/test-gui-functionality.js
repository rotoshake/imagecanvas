#!/usr/bin/env node

const puppeteer = require('puppeteer');
const path = require('path');

let testResults = {
    passed: 0,
    failed: 0,
    tests: []
};

function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
        info: '[INFO]',
        success: '[✓]',
        error: '[✗]',
        test: '[TEST]'
    }[type] || '[LOG]';
    
    console.log(`${timestamp} ${prefix} ${message}`);
}

function assert(condition, testName, errorMessage) {
    if (condition) {
        testResults.passed++;
        testResults.tests.push({ name: testName, status: 'passed' });
        log(`${testName}`, 'success');
    } else {
        testResults.failed++;
        testResults.tests.push({ name: testName, status: 'failed', error: errorMessage });
        log(`${testName} - ${errorMessage}`, 'error');
    }
}

async function startClientServer() {
    // Check if client server is running on port 8000
    try {
        const response = await fetch('http://localhost:8000');
        if (response.ok) {
            log('Client server already running on port 8000', 'info');
            return true;
        }
    } catch (e) {
        // Server not running, try to start it
        log('Client server not running, please start it on port 8000', 'error');
        return false;
    }
}

async function testGUILoad(page) {
    log('Testing GUI loading...', 'test');
    
    try {
        // Navigate to the application
        await page.goto('http://localhost:8000', { 
            waitUntil: 'networkidle2',
            timeout: 10000 
        });
        
        // Check if page title loaded
        const title = await page.title();
        assert(
            title && title.length > 0,
            'GUI: Page loads with title',
            'Page title is empty'
        );
        
        // Check if canvas element exists
        const canvasExists = await page.$('#mycanvas') !== null;
        assert(
            canvasExists,
            'GUI: Canvas element exists',
            'Canvas element not found'
        );
        
        // Check if main application scripts loaded
        const appScriptLoaded = await page.evaluate(() => {
            return typeof window.ImageCanvas !== 'undefined' || 
                   typeof window.CanvasApp !== 'undefined' ||
                   document.querySelector('script[src*="app.js"]') !== null;
        });
        assert(
            appScriptLoaded,
            'GUI: Application scripts loaded',
            'Main application scripts not detected'
        );
        
        return true;
    } catch (error) {
        assert(false, 'GUI: Page loads successfully', error.message);
        return false;
    }
}

async function testCanvasInteraction(page) {
    log('Testing canvas interaction...', 'test');
    
    try {
        // Wait for canvas to be ready
        await page.waitForSelector('#mycanvas', { timeout: 5000 });
        
        // Test canvas click interaction
        const canvas = await page.$('#mycanvas');
        const canvasBox = await canvas.boundingBox();
        
        // Click on canvas
        await page.click('#mycanvas', {
            offset: {
                x: canvasBox.width / 2,
                y: canvasBox.height / 2
            }
        });
        
        assert(
            true,
            'GUI: Canvas accepts click events',
            'Canvas click failed'
        );
        
        // Test if any toolbar/menu exists
        const hasToolbar = await page.evaluate(() => {
            return document.querySelector('.toolbar') !== null ||
                   document.querySelector('#toolbar') !== null ||
                   document.querySelector('[class*="tool"]') !== null ||
                   document.querySelector('[id*="tool"]') !== null;
        });
        
        // This is informational, not a failure
        if (hasToolbar) {
            log('Toolbar/menu interface detected', 'info');
        } else {
            log('No obvious toolbar detected (may use context menus)', 'info');
        }
        
        return true;
    } catch (error) {
        assert(false, 'GUI: Canvas interaction works', error.message);
        return false;
    }
}

async function testWebSocketConnection(page) {
    log('Testing WebSocket connection from GUI...', 'test');
    
    try {
        // Check if WebSocket connection is established
        const wsConnected = await page.evaluate(() => {
            return new Promise((resolve) => {
                // First check if Socket.IO is available and collaborative mode is enabled
                if (window.io && window.COLLABORATIVE_MODE) {
                    console.log('Testing Socket.IO connection...');
                    const testSocket = window.io('http://localhost:3000');
                    
                    testSocket.on('connect', () => {
                        testSocket.disconnect();
                        resolve(true);
                    });
                    
                    testSocket.on('connect_error', () => {
                        resolve(false);
                    });
                    
                    setTimeout(() => {
                        testSocket.disconnect();
                        resolve(false);
                    }, 3000);
                } else {
                    // Fallback checks
                    const wsFound = window.connected === true || 
                                   window.isConnected === true ||
                                   document.body.classList.contains('connected') ||
                                   (window.socket && window.socket.connected);
                    resolve(wsFound);
                }
            });
        });
        
        assert(
            wsConnected,
            'GUI: WebSocket connection established',
            'No active WebSocket connection detected'
        );
        
        return wsConnected;
    } catch (error) {
        assert(false, 'GUI: WebSocket connection test', error.message);
        return false;
    }
}

async function testCollaborationFeatures(page) {
    log('Testing collaboration features...', 'test');
    
    try {
        // Check for collaboration architecture components
        const hasCollabArchitecture = await page.evaluate(() => {
            return window.COLLABORATIVE_MODE === true &&
                   typeof window.CollaborativeArchitecture !== 'undefined' &&
                   typeof window.NetworkLayer !== 'undefined' &&
                   typeof window.OperationPipeline !== 'undefined';
        });
        
        // Check for any visible collaboration indicators
        const hasCollabIndicators = await page.evaluate(() => {
            // Look for any elements that might indicate collaboration
            const bodyText = document.body.innerText.toLowerCase();
            return bodyText.includes('collaborative') || 
                   bodyText.includes('real-time') ||
                   bodyText.includes('multi-user') ||
                   document.querySelector('[title*="collaborative"]') !== null ||
                   document.querySelector('[title*="real-time"]') !== null;
        });
        
        const hasCollabFeatures = hasCollabArchitecture || hasCollabIndicators;
        
        assert(
            hasCollabFeatures,
            'GUI: Collaboration features visible',
            'No collaboration UI elements detected'
        );
        
        return hasCollabFeatures;
    } catch (error) {
        assert(false, 'GUI: Collaboration features test', error.message);
        return false;
    }
}

async function testMediaHandling(page) {
    log('Testing media handling capabilities...', 'test');
    
    try {
        // Check for file input or drag-drop capabilities
        const hasFileInput = await page.evaluate(() => {
            return document.querySelector('input[type="file"]') !== null;
        });
        
        // Check for drag-drop functionality
        const hasDragDrop = await page.evaluate(() => {
            // Check if DragDropManager class exists
            if (typeof window.DragDropManager !== 'undefined') {
                return true;
            }
            
            // Check if app instance exists and has dragDropManager
            if (window.app && window.app.dragDropManager) {
                return true;
            }
            
            // Check if the source code contains DragDropManager
            const scripts = Array.from(document.getElementsByTagName('script'));
            for (const script of scripts) {
                if (script.src && script.src.includes('dragdrop.js')) {
                    return true;
                }
            }
            
            return false;
        });
        
        // Check for media-related buttons or controls
        const hasMediaControls = await page.evaluate(() => {
            const mediaTerms = ['upload', 'image', 'video', 'media', 'file'];
            return mediaTerms.some(term => {
                const buttons = document.querySelectorAll('button, [role="button"], .btn');
                return Array.from(buttons).some(btn => 
                    btn.textContent.toLowerCase().includes(term) ||
                    btn.className.toLowerCase().includes(term) ||
                    btn.id.toLowerCase().includes(term)
                );
            });
        });
        
        const hasMediaFeatures = hasFileInput || hasDragDrop || hasMediaControls;
        
        assert(
            hasMediaFeatures,
            'GUI: Media handling features present',
            'No media upload/handling UI detected'
        );
        
        return hasMediaFeatures;
    } catch (error) {
        assert(false, 'GUI: Media handling test', error.message);
        return false;
    }
}

async function testErrorHandling(page) {
    log('Testing error handling...', 'test');
    
    try {
        // Check console for errors
        const consoleErrors = [];
        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });
        
        // Trigger a potential error condition (safe test)
        await page.evaluate(() => {
            // Try to trigger a non-critical operation that might show error handling
            if (window.fetch) {
                fetch('/nonexistent-endpoint').catch(() => {
                    // Expected to fail, testing error handling
                });
            }
        });
        
        // Wait a moment for any errors to surface
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if application is still responsive
        const stillResponsive = await page.evaluate(() => {
            return document.readyState === 'complete' && 
                   !document.body.classList.contains('error') &&
                   !document.body.classList.contains('crashed');
        });
        
        assert(
            stillResponsive,
            'GUI: Application remains responsive under error conditions',
            'Application appears to have crashed or become unresponsive'
        );
        
        // Log console errors for information (not necessarily failures)
        if (consoleErrors.length > 0) {
            log(`Console errors detected: ${consoleErrors.length}`, 'info');
            consoleErrors.forEach(error => log(`  - ${error}`, 'info'));
        }
        
        return true;
    } catch (error) {
        assert(false, 'GUI: Error handling test', error.message);
        return false;
    }
}

async function runGUITests() {
    log('Starting ImageCanvas GUI Functionality Tests', 'test');
    log('==========================================', 'test');
    
    let browser;
    
    try {
        // Check if client server is running
        const serverRunning = await startClientServer();
        if (!serverRunning) {
            log('Cannot run GUI tests - client server not available on port 8000', 'error');
            process.exit(1);
        }
        
        // Launch browser
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Set viewport
        await page.setViewport({ width: 1200, height: 800 });
        
        // Run tests
        await testGUILoad(page);
        await testCanvasInteraction(page);
        await testWebSocketConnection(page);
        await testCollaborationFeatures(page);
        await testMediaHandling(page);
        await testErrorHandling(page);
        
        // Print results
        log('==========================================', 'test');
        log(`GUI tests completed: ${testResults.passed + testResults.failed}`, 'test');
        log(`Passed: ${testResults.passed}`, 'success');
        log(`Failed: ${testResults.failed}`, testResults.failed > 0 ? 'error' : 'info');
        
        // Save results
        const resultsPath = path.join(__dirname, 'gui-test-results.json');
        require('fs').writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
        log(`Results saved to ${resultsPath}`, 'info');
        
    } catch (error) {
        log(`Fatal error: ${error.message}`, 'error');
        console.error(error);
    } finally {
        if (browser) {
            await browser.close();
        }
        process.exit(testResults.failed > 0 ? 1 : 0);
    }
}

// Run tests
runGUITests();