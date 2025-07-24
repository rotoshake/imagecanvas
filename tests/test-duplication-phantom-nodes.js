/**
 * Automated test for debugging phantom node creation in duplication operations
 * Tests all three duplication methods: Alt+drag, Ctrl+D, and Ctrl+V (paste)
 * 
 * Run this test with Node.js and Puppeteer to simulate browser interactions
 * and capture console logs for debugging phantom node creation.
 */

const puppeteer = require('puppeteer');
const path = require('path');

class DuplicationPhantomNodeTester {
    constructor() {
        this.browser = null;
        this.page = null;
        this.consoleLogs = [];
    }

    async initialize() {
        console.log('🚀 Initializing phantom node duplication test...');
        
        // Launch browser with debugging enabled
        this.browser = await puppeteer.launch({
            headless: false, // Set to true for headless testing
            defaultViewport: { width: 1280, height: 800 },
            devtools: true,
            args: [
                '--disable-web-security',
                '--allow-running-insecure-content',
                '--disable-features=VizDisplayCompositor'
            ]
        });

        this.page = await this.browser.newPage();
        
        // Capture console logs
        this.page.on('console', (msg) => {
            const logEntry = {
                type: msg.type(),
                text: msg.text(),
                timestamp: Date.now()
            };
            this.consoleLogs.push(logEntry);
            
            // Print important diagnostic logs to terminal
            if (msg.text().includes('🔥 EXECUTEOP START') || 
                msg.text().includes('🔧 DuplicateNodesCommand') ||
                msg.text().includes('applyOptimistic') ||
                msg.text().includes('phantom') ||
                msg.text().includes('graph now has')) {
                console.log(`[CONSOLE ${msg.type().toUpperCase()}]: ${msg.text()}`);
            }
        });

        // Load the application
        const appUrl = 'http://localhost:8000';
        console.log(`📖 Loading application from ${appUrl}...`);
        
        try {
            await this.page.goto(appUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            console.log('✅ Application loaded successfully');
        } catch (error) {
            console.error('❌ Failed to load application:', error.message);
            throw error;
        }

        // Wait for the application to initialize
        await this.page.waitForFunction(
            () => window.app && window.app.canvas && window.app.graph,
            { timeout: 10000 }
        );
        
        console.log('✅ Application initialized');
    }

    async createTestImageNode() {
        console.log('🖼️ Creating test image node...');
        
        // Create a test image node programmatically
        const nodeId = await this.page.evaluate(() => {
            // Create a simple test image node
            const node = new ImageNode();
            node.pos = [400, 300]; // Center of canvas
            node.size = [200, 150];
            node.filename = 'test-image.jpg';
            node.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjNDI4NWY0Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuMzVlbSI+VGVzdCBJbWFnZTwvdGV4dD48L3N2Zz4=';
            
            // Add to graph and select
            window.app.graph.add(node);
            window.app.canvas.selection.clear();
            window.app.canvas.selection.selectNode(node, false);
            
            console.log(`📊 Created test node: ${node.id}, graph has ${window.app.graph.nodes.length} nodes`);
            return node.id;
        });

        console.log(`✅ Test image node created with ID: ${nodeId}`);
        return nodeId;
    }

    async getGraphNodeCount() {
        return await this.page.evaluate(() => {
            return window.app.graph.nodes.length;
        });
    }

    async testAltDragDuplication() {
        console.log('\n🔄 TESTING ALT+DRAG DUPLICATION');
        console.log('=================================');
        
        const initialCount = await this.getGraphNodeCount();
        console.log(`📊 Initial node count: ${initialCount}`);

        // Clear previous console logs for this test
        this.consoleLogs = [];

        try {
            await this.page.evaluate(() => {
                const canvas = document.getElementById('mycanvas');
                const selectedNode = window.app.canvas.selection.getSelectedNodes()[0];
                
                if (!selectedNode) {
                    throw new Error('No node selected for Alt+drag test');
                }

                console.log(`🎯 Starting Alt+drag on node: ${selectedNode.id}`);
                
                // Simulate Alt+drag sequence
                const startX = selectedNode.pos[0];
                const startY = selectedNode.pos[1];
                const endX = startX + 100;
                const endY = startY + 50;

                // Mouse down with Alt key
                const mouseDownEvent = new MouseEvent('mousedown', {
                    clientX: startX,
                    clientY: startY,
                    altKey: true,
                    bubbles: true
                });
                canvas.dispatchEvent(mouseDownEvent);

                // Small delay to ensure duplication logic triggers
                setTimeout(() => {
                    // Mouse move to simulate drag
                    const mouseMoveEvent = new MouseEvent('mousemove', {
                        clientX: endX,
                        clientY: endY,
                        altKey: true,
                        bubbles: true
                    });
                    canvas.dispatchEvent(mouseMoveEvent);

                    // Mouse up to complete the operation
                    setTimeout(() => {
                        const mouseUpEvent = new MouseEvent('mouseup', {
                            clientX: endX,
                            clientY: endY,
                            altKey: true,
                            bubbles: true
                        });
                        canvas.dispatchEvent(mouseUpEvent);
                    }, 100);
                }, 100);
            });

            // Wait for the duplication to complete
            await this.page.waitForTimeout(2000);

            const finalCount = await this.getGraphNodeCount();
            console.log(`📊 Final node count: ${finalCount}`);
            
            const expectedCount = initialCount + 1;
            const hasPhantomNodes = finalCount > expectedCount;
            
            console.log(`✅ Alt+drag result: ${hasPhantomNodes ? '❌ PHANTOM NODES DETECTED' : '✅ No phantom nodes'}`);
            console.log(`   Expected: ${expectedCount}, Actual: ${finalCount}`);

            return {
                method: 'Alt+drag',
                initialCount,
                finalCount,
                expectedCount,
                hasPhantomNodes,
                consoleLogs: [...this.consoleLogs]
            };

        } catch (error) {
            console.error('❌ Alt+drag test failed:', error);
            return {
                method: 'Alt+drag',
                error: error.message,
                consoleLogs: [...this.consoleLogs]
            };
        }
    }

    async testCtrlDDuplication() {
        console.log('\n🔄 TESTING CTRL+D DUPLICATION');
        console.log('==============================');

        const initialCount = await this.getGraphNodeCount();
        console.log(`📊 Initial node count: ${initialCount}`);

        // Clear previous console logs for this test
        this.consoleLogs = [];

        try {
            await this.page.evaluate(() => {
                const selectedNodes = window.app.canvas.selection.getSelectedNodes();
                
                if (selectedNodes.length === 0) {
                    throw new Error('No nodes selected for Ctrl+D test');
                }

                console.log(`🎯 Starting Ctrl+D duplication on ${selectedNodes.length} node(s)`);
                
                // Trigger Ctrl+D duplication directly
                window.app.canvas.duplicateSelected();
            });

            // Wait for the duplication to complete
            await this.page.waitForTimeout(2000);

            const finalCount = await this.getGraphNodeCount();
            console.log(`📊 Final node count: ${finalCount}`);
            
            const expectedCount = initialCount + 1;
            const hasPhantomNodes = finalCount > expectedCount;
            
            console.log(`✅ Ctrl+D result: ${hasPhantomNodes ? '❌ PHANTOM NODES DETECTED' : '✅ No phantom nodes'}`);
            console.log(`   Expected: ${expectedCount}, Actual: ${finalCount}`);

            return {
                method: 'Ctrl+D',
                initialCount,
                finalCount,
                expectedCount,
                hasPhantomNodes,
                consoleLogs: [...this.consoleLogs]
            };

        } catch (error) {
            console.error('❌ Ctrl+D test failed:', error);
            return {
                method: 'Ctrl+D',
                error: error.message,
                consoleLogs: [...this.consoleLogs]
            };
        }
    }

    async testCtrlVPaste() {
        console.log('\n🔄 TESTING CTRL+C -> CTRL+V PASTE');
        console.log('==================================');

        const initialCount = await this.getGraphNodeCount();
        console.log(`📊 Initial node count: ${initialCount}`);

        // Clear previous console logs for this test
        this.consoleLogs = [];

        try {
            // First copy the selected node(s)
            await this.page.evaluate(() => {
                const selectedNodes = window.app.canvas.selection.getSelectedNodes();
                
                if (selectedNodes.length === 0) {
                    throw new Error('No nodes selected for Ctrl+C/Ctrl+V test');
                }

                console.log(`📋 Copying ${selectedNodes.length} node(s) with Ctrl+C`);
                
                // Trigger copy operation
                window.app.canvas.copySelectedNodes();
            });

            await this.page.waitForTimeout(500);

            // Then paste
            await this.page.evaluate(() => {
                console.log(`📋 Pasting with Ctrl+V`);
                
                // Set mouse position for paste location
                if (window.app.canvas.mouseState) {
                    window.app.canvas.mouseState.graph = [500, 350]; // Different location
                }
                
                // Trigger paste operation
                window.app.canvas.pasteNodes();
            });

            // Wait for the paste to complete
            await this.page.waitForTimeout(2000);

            const finalCount = await this.getGraphNodeCount();
            console.log(`📊 Final node count: ${finalCount}`);
            
            const expectedCount = initialCount + 1;
            const hasPhantomNodes = finalCount > expectedCount;
            
            console.log(`✅ Ctrl+V result: ${hasPhantomNodes ? '❌ PHANTOM NODES DETECTED' : '✅ No phantom nodes'}`);
            console.log(`   Expected: ${expectedCount}, Actual: ${finalCount}`);

            return {
                method: 'Ctrl+V',
                initialCount,
                finalCount,
                expectedCount,
                hasPhantomNodes,
                consoleLogs: [...this.consoleLogs]
            };

        } catch (error) {
            console.error('❌ Ctrl+V test failed:', error);
            return {
                method: 'Ctrl+V',
                error: error.message,
                consoleLogs: [...this.consoleLogs]
            };
        }
    }

    async generateReport(testResults) {
        console.log('\n📋 PHANTOM NODE DUPLICATION TEST REPORT');
        console.log('========================================');

        const phantomDetected = testResults.some(result => result.hasPhantomNodes);
        
        console.log(`\n🎯 OVERALL RESULT: ${phantomDetected ? '❌ PHANTOM NODES DETECTED' : '✅ NO PHANTOM NODES'}\n`);

        testResults.forEach((result, index) => {
            console.log(`${index + 1}. ${result.method}:`);
            if (result.error) {
                console.log(`   ❌ ERROR: ${result.error}`);
            } else {
                console.log(`   Initial: ${result.initialCount} nodes`);
                console.log(`   Final: ${result.finalCount} nodes`);
                console.log(`   Expected: ${result.expectedCount} nodes`);
                console.log(`   Status: ${result.hasPhantomNodes ? '❌ Phantom nodes detected' : '✅ Working correctly'}`);
                
                // Show relevant console logs
                const relevantLogs = result.consoleLogs.filter(log => 
                    log.text.includes('🔥 EXECUTEOP START') ||
                    log.text.includes('🔧 DuplicateNodesCommand') ||
                    log.text.includes('applyOptimistic') ||
                    log.text.includes('graph now has')
                );
                
                if (relevantLogs.length > 0) {
                    console.log(`   📜 Key Console Logs:`);
                    relevantLogs.forEach(log => {
                        console.log(`      [${log.type.toUpperCase()}] ${log.text}`);
                    });
                }
            }
            console.log('');
        });

        // Generate detailed log file
        const reportData = {
            timestamp: new Date().toISOString(),
            summary: {
                totalTests: testResults.length,
                phantomNodeDetected: phantomDetected,
                passedTests: testResults.filter(r => !r.hasPhantomNodes && !r.error).length,
                failedTests: testResults.filter(r => r.hasPhantomNodes || r.error).length
            },
            testResults: testResults
        };

        const fs = require('fs');
        const reportPath = path.join(__dirname, 'phantom-node-test-results.json');
        fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
        console.log(`📄 Detailed report saved to: ${reportPath}`);

        return reportData;
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            console.log('🧹 Browser closed');
        }
    }

    async runFullTest() {
        try {
            await this.initialize();
            
            // Create a test image node to work with
            await this.createTestImageNode();
            
            const testResults = [];
            
            // Test all three duplication methods
            testResults.push(await this.testAltDragDuplication());
            testResults.push(await this.testCtrlDDuplication());
            testResults.push(await this.testCtrlVPaste());
            
            // Generate and display report
            const report = await this.generateReport(testResults);
            
            return report;
            
        } catch (error) {
            console.error('❌ Test suite failed:', error);
            throw error;
        } finally {
            await this.cleanup();
        }
    }
}

// Main execution
async function main() {
    console.log('🧪 Starting ImageCanvas Phantom Node Duplication Test Suite');
    console.log('============================================================\n');
    
    const tester = new DuplicationPhantomNodeTester();
    
    try {
        const report = await tester.runFullTest();
        
        console.log('\n🎉 Test suite completed successfully');
        console.log(`📊 Summary: ${report.summary.passedTests}/${report.summary.totalTests} tests passed`);
        
        process.exit(report.summary.phantomNodeDetected ? 1 : 0);
        
    } catch (error) {
        console.error('\n💥 Test suite failed with error:', error);
        process.exit(1);
    }
}

// Run if this file is executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { DuplicationPhantomNodeTester };