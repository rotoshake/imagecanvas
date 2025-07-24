/**
 * Simple test for debugging phantom node creation in duplication operations
 * This script creates browser automation to test duplication and capture console logs
 */

const puppeteer = require('puppeteer');

async function testPhantomNodes() {
    console.log('🚀 Starting phantom node duplication test...');
    
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: 1280, height: 800 },
        devtools: true,
        args: ['--disable-web-security', '--allow-running-insecure-content']
    });

    const page = await browser.newPage();
    
    // Capture all console messages
    const consoleLogs = [];
    page.on('console', (msg) => {
        const logEntry = {
            type: msg.type(),
            text: msg.text(),
            timestamp: Date.now()
        };
        consoleLogs.push(logEntry);
        
        // Print diagnostic logs in real-time
        if (msg.text().includes('🔥 EXECUTEOP START') || 
            msg.text().includes('🔧 DuplicateNodesCommand') ||
            msg.text().includes('applyOptimistic') ||
            msg.text().includes('graph now has') ||
            msg.text().includes('phantom')) {
            console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);
        }
    });

    try {
        console.log('📖 Loading application...');
        await page.goto('http://localhost:8000', { waitUntil: 'networkidle2', timeout: 30000 });
        
        console.log('⏱️ Waiting for application to initialize...');
        
        // Wait for app to be ready and then wait a bit more to ensure full initialization
        await page.waitForFunction(
            () => window.app && window.app.canvas && window.app.graph,
            { timeout: 15000 }
        );
        
        // Give it extra time to fully load
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('✅ Application loaded and initialized');
        
        // Method 1: Create a test image by dropping a file (simulate drag & drop)
        console.log('\n🖼️ Creating test image node via drag and drop simulation...');
        
        const nodeCreated = await page.evaluate(async () => {
            try {
                // Create a File object to simulate image drop
                const imageDataUrl = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjNDI4NWY0Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuMzVlbSI+VGVzdCBJbWFnZTwvdGV4dD48L3N2Zz4=';
                
                // Convert data URL to blob
                const response = await fetch(imageDataUrl);
                const blob = await response.blob();
                const file = new File([blob], 'test-image.svg', { type: 'image/svg+xml' });
                
                // Simulate drop event
                const dropEvent = new DragEvent('drop', {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: new DataTransfer()
                });
                
                // Add the file to the data transfer
                dropEvent.dataTransfer.files = [file];
                dropEvent.dataTransfer.items.add(file);
                
                // Get canvas element and dispatch drop
                const canvas = document.getElementById('mycanvas');
                if (canvas) {
                    // First dispatch dragover to enable drop
                    const dragOverEvent = new DragEvent('dragover', {
                        bubbles: true,
                        cancelable: true
                    });
                    canvas.dispatchEvent(dragOverEvent);
                    
                    // Then dispatch drop
                    canvas.dispatchEvent(dropEvent);
                    
                    console.log('📋 Drop event dispatched');
                    return true;
                } else {
                    console.error('Canvas element not found');
                    return false;
                }
            } catch (error) {
                console.error('Error creating test node:', error);
                return false;
            }
        });
        
        if (!nodeCreated) {
            throw new Error('Failed to create test node');
        }
        
        // Wait for the image to be processed and added
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Get initial node count
        const initialCount = await page.evaluate(() => {
            return window.app?.graph?.nodes?.length || 0;
        });
        
        console.log(`📊 Initial node count: ${initialCount}`);
        
        if (initialCount === 0) {
            console.log('⚠️ No nodes created from drop. Trying direct node creation...');
            
            // Fallback: Try to create a node directly using canvas methods
            const directCreated = await page.evaluate(() => {
                try {
                    // Try to use canvas drag drop handler directly
                    if (window.app && window.app.canvas && window.app.canvas.createImageNode) {
                        const node = window.app.canvas.createImageNode({
                            filename: 'test-image.svg',
                            src: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjNDI4NWY0Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuMzVlbSI+VGVzdCBJbWFnZTwvdGV4dD48L3N2Zz4=',
                            pos: [400, 300],
                            size: [200, 150]
                        });
                        
                        if (node) {
                            window.app.graph.add(node);
                            window.app.canvas.selection.clear();
                            window.app.canvas.selection.selectNode(node, false);
                            console.log('📝 Created node directly:', node.id);
                            return window.app.graph.nodes.length;
                        }
                    }
                    return 0;
                } catch (error) {
                    console.error('Direct node creation error:', error);
                    return 0;
                }
            });
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            if (directCreated === 0) {
                throw new Error('Unable to create any test nodes');
            }
            
            console.log(`✅ Created node directly. Node count: ${directCreated}`);
        }
        
        // Get final initial count
        const finalInitialCount = await page.evaluate(() => {
            return window.app?.graph?.nodes?.length || 0;
        });
        
        console.log(`📊 Final initial node count: ${finalInitialCount}`);
        
        if (finalInitialCount === 0) {
            throw new Error('No nodes available for testing');
        }
        
        // Test 1: Alt+Drag Duplication
        console.log('\n🔄 TESTING ALT+DRAG DUPLICATION');
        console.log('=================================');
        
        await page.evaluate(() => {
            console.log('🎯 Starting Alt+drag test');
            const canvas = document.getElementById('mycanvas');
            const selectedNodes = window.app.canvas.selection.getSelectedNodes();
            
            if (selectedNodes.length === 0) {
                // Select the first node if nothing is selected
                const firstNode = window.app.graph.nodes[0];
                if (firstNode) {
                    window.app.canvas.selection.selectNode(firstNode, false);
                    console.log('📌 Selected first node for test:', firstNode.id);
                }
            }
            
            const selectedNode = window.app.canvas.selection.getSelectedNodes()[0];
            if (!selectedNode) {
                throw new Error('No node selected for Alt+drag test');
            }
            
            // Simulate Alt+drag
            const rect = canvas.getBoundingClientRect();
            const startX = rect.left + selectedNode.pos[0];
            const startY = rect.top + selectedNode.pos[1];
            const endX = startX + 100;
            const endY = startY + 50;
            
            console.log(`🖱️ Alt+drag from (${startX}, ${startY}) to (${endX}, ${endY})`);
            
            // Mouse down with Alt
            canvas.dispatchEvent(new MouseEvent('mousedown', {
                clientX: startX,
                clientY: startY,
                altKey: true,
                bubbles: true,
                cancelable: true
            }));
            
            // Mouse move
            setTimeout(() => {
                canvas.dispatchEvent(new MouseEvent('mousemove', {
                    clientX: endX,
                    clientY: endY,
                    altKey: true,
                    bubbles: true,
                    cancelable: true
                }));
                
                // Mouse up
                setTimeout(() => {
                    canvas.dispatchEvent(new MouseEvent('mouseup', {
                        clientX: endX,
                        clientY: endY,
                        altKey: true,
                        bubbles: true,
                        cancelable: true
                    }));
                    console.log('✅ Alt+drag sequence completed');
                }, 100);
            }, 100);
        });
        
        // Wait for Alt+drag to complete
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const altDragCount = await page.evaluate(() => {
            return window.app?.graph?.nodes?.length || 0;
        });
        
        console.log(`📊 After Alt+drag: ${altDragCount} nodes (expected: ${finalInitialCount + 1})`);
        const altDragPhantom = altDragCount > (finalInitialCount + 1);
        console.log(`Alt+drag result: ${altDragPhantom ? '❌ PHANTOM NODES DETECTED' : '✅ No phantom nodes'}`);
        
        // Test 2: Ctrl+D Duplication
        console.log('\n🔄 TESTING CTRL+D DUPLICATION');
        console.log('==============================');
        
        const beforeCtrlD = await page.evaluate(() => {
            return window.app?.graph?.nodes?.length || 0;
        });
        
        await page.evaluate(() => {
            console.log('🎯 Starting Ctrl+D test');
            const selectedNodes = window.app.canvas.selection.getSelectedNodes();
            
            if (selectedNodes.length === 0) {
                // Select a node
                const firstNode = window.app.graph.nodes[0];
                if (firstNode) {
                    window.app.canvas.selection.selectNode(firstNode, false);
                    console.log('📌 Selected first node for Ctrl+D test:', firstNode.id);
                }
            }
            
            // Call duplicate directly
            window.app.canvas.duplicateSelected();
            console.log('✅ Ctrl+D duplicateSelected() called');
        });
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const ctrlDCount = await page.evaluate(() => {
            return window.app?.graph?.nodes?.length || 0;
        });
        
        console.log(`📊 After Ctrl+D: ${ctrlDCount} nodes (expected: ${beforeCtrlD + 1})`);
        const ctrlDPhantom = ctrlDCount > (beforeCtrlD + 1);
        console.log(`Ctrl+D result: ${ctrlDPhantom ? '❌ PHANTOM NODES DETECTED' : '✅ No phantom nodes'}`);
        
        // Test 3: Ctrl+C -> Ctrl+V
        console.log('\n🔄 TESTING CTRL+C -> CTRL+V');
        console.log('=============================');
        
        const beforePaste = await page.evaluate(() => {
            return window.app?.graph?.nodes?.length || 0;
        });
        
        await page.evaluate(() => {
            console.log('🎯 Starting Ctrl+C -> Ctrl+V test');
            const selectedNodes = window.app.canvas.selection.getSelectedNodes();
            
            if (selectedNodes.length === 0) {
                const firstNode = window.app.graph.nodes[0];
                if (firstNode) {
                    window.app.canvas.selection.selectNode(firstNode, false);
                    console.log('📌 Selected first node for paste test:', firstNode.id);
                }
            }
            
            // Copy
            window.app.canvas.copySelectedNodes();
            console.log('📋 Ctrl+C copySelectedNodes() called');
            
            setTimeout(() => {
                // Set mouse position for paste
                if (window.app.canvas.mouseState) {
                    window.app.canvas.mouseState.graph = [500, 350];
                }
                
                // Paste
                window.app.canvas.pasteNodes();
                console.log('📋 Ctrl+V pasteNodes() called');
            }, 500);
        });
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const pasteCount = await page.evaluate(() => {
            return window.app?.graph?.nodes?.length || 0;
        });
        
        console.log(`📊 After Ctrl+V: ${pasteCount} nodes (expected: ${beforePaste + 1})`);
        const pastePhantom = pasteCount > (beforePaste + 1);
        console.log(`Ctrl+V result: ${pastePhantom ? '❌ PHANTOM NODES DETECTED' : '✅ No phantom nodes'}`);
        
        // Summary
        console.log('\n📋 SUMMARY');
        console.log('==========');
        console.log(`Alt+drag: ${altDragPhantom ? '❌ Phantom nodes' : '✅ OK'}`);
        console.log(`Ctrl+D: ${ctrlDPhantom ? '❌ Phantom nodes' : '✅ OK'}`);
        console.log(`Ctrl+V: ${pastePhantom ? '❌ Phantom nodes' : '✅ OK'}`);
        
        const overallPhantom = altDragPhantom || ctrlDPhantom || pastePhantom;
        console.log(`\n🎯 OVERALL: ${overallPhantom ? '❌ PHANTOM NODES DETECTED' : '✅ ALL TESTS PASSED'}`);
        
        // Show relevant console logs
        const relevantLogs = consoleLogs.filter(log => 
            log.text.includes('🔥 EXECUTEOP START') ||
            log.text.includes('🔧 DuplicateNodesCommand') ||
            log.text.includes('applyOptimistic') ||
            log.text.includes('graph now has') ||
            log.text.includes('phantom') ||
            log.text.includes('willCallOptimistic') ||
            log.text.includes('ALT+DRAG') ||
            log.text.includes('CTRL+D') ||
            log.text.includes('origin:')
        );
        
        if (relevantLogs.length > 0) {
            console.log('\n📜 RELEVANT CONSOLE LOGS:');
            console.log('==========================');
            relevantLogs.forEach(log => {
                console.log(`[${log.type.toUpperCase()}] ${log.text}`);
            });
        }
        
        // Keep browser open if phantom nodes detected for manual inspection
        if (overallPhantom) {
            console.log('\n🔍 Phantom nodes detected! Keeping browser open for 30 seconds for manual inspection...');
            console.log('   Check the developer console in the browser for more details.');
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
        
        return { success: !overallPhantom, phantomDetected: overallPhantom };
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        
        // Keep browser open on error for debugging
        console.log('🔍 Keeping browser open for 15 seconds for debugging...');
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        return { success: false, error: error.message };
        
    } finally {
        await browser.close();
        console.log('🧹 Browser closed');
    }
}

// Run the test
testPhantomNodes().then(result => {
    if (result.success) {
        console.log('\n🎉 All duplication tests passed!');
        process.exit(0);
    } else {
        console.log('\n💥 Tests failed:', result.error || 'Phantom nodes detected');
        process.exit(1);
    }
}).catch(error => {
    console.error('💥 Test suite error:', error);
    process.exit(1);
});