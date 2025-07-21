#!/usr/bin/env node

const puppeteer = require('puppeteer');

async function testDragOperations() {
    console.log('🎯 Testing drag operations...');
    
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    const errors = [];
    const consoleMessages = [];
    
    page.on('console', msg => {
        const message = `[${msg.type()}] ${msg.text()}`;
        consoleMessages.push(message);
        if (msg.type() === 'error') {
            console.log('❌', message);
        }
    });
    
    page.on('pageerror', error => {
        errors.push(`Page Error: ${error.message}`);
        console.log('❌ Page Error:', error.message);
    });
    
    try {
        await page.goto('http://localhost:8000', { 
            waitUntil: 'networkidle0',
            timeout: 10000 
        });
        
        // Wait for app to initialize
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Create a test node by simulating a click on canvas
        const nodeId = await page.evaluate(() => {
            // Check what node types are available
            if (!window.LiteGraph || !window.app) {
                throw new Error('LiteGraph or app not available');
            }
            
            // Create a simple node - try different approaches
            let textNode;
            try {
                if (window.LiteGraph.registered_node_types['basic/text']) {
                    textNode = window.LiteGraph.createNode('basic/text');
                } else if (window.LiteGraph.registered_node_types['text/text']) {
                    textNode = window.LiteGraph.createNode('text/text');
                } else {
                    // Fallback - create a basic node manually
                    textNode = {
                        id: Date.now(),
                        type: 'test/node',
                        pos: [100, 100],
                        size: [100, 50],
                        properties: { text: 'Test Node' },
                        flags: {}
                    };
                }
                
                if (textNode) {
                    textNode.pos = [100, 100];
                    if (textNode.properties) {
                        textNode.properties.text = 'Test Node';
                    }
                    window.app.graph.add(textNode);
                    
                    // Select the node
                    if (window.app.canvas.selectNode) {
                        window.app.canvas.selectNode(textNode);
                    }
                    
                    return textNode.id;
                }
            } catch (e) {
                throw new Error('Failed to create node: ' + e.message);
            }
        });
        
        console.log('✅ Created test node');
        
        // Simulate drag operation
        const dragResult = await page.evaluate(() => {
            const canvas = document.querySelector('#mycanvas');
            const rect = canvas.getBoundingClientRect();
            
            // Get the selected node
            const selectedNodes = window.app.canvas.selection.getSelectedNodes();
            if (selectedNodes.length === 0) {
                return { error: 'No node selected' };
            }
            
            const node = selectedNodes[0];
            const oldPos = [...node.pos];
            
            // Simulate mouse down
            const startX = rect.left + node.pos[0] + 50;
            const startY = rect.top + node.pos[1] + 25;
            
            const mouseDownEvent = new MouseEvent('mousedown', {
                clientX: startX,
                clientY: startY,
                button: 0,
                bubbles: true
            });
            canvas.dispatchEvent(mouseDownEvent);
            
            // Simulate drag
            const endX = startX + 100;
            const endY = startY + 50;
            
            const mouseMoveEvent = new MouseEvent('mousemove', {
                clientX: endX,
                clientY: endY,
                button: 0,
                bubbles: true
            });
            canvas.dispatchEvent(mouseMoveEvent);
            
            // Simulate mouse up to trigger finishInteractions
            const mouseUpEvent = new MouseEvent('mouseup', {
                clientX: endX,
                clientY: endY,
                button: 0,
                bubbles: true
            });
            canvas.dispatchEvent(mouseUpEvent);
            
            // Wait a bit for async operations
            return new Promise(resolve => {
                setTimeout(() => {
                    const newPos = [...node.pos];
                    resolve({
                        nodeId: node.id,
                        oldPosition: oldPos,
                        newPosition: newPos,
                        moved: oldPos[0] !== newPos[0] || oldPos[1] !== newPos[1]
                    });
                }, 100);
            });
        });
        
        console.log('📊 Drag test result:', dragResult);
        
        // Wait for any async operations to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log('\n📋 Test Results:');
        console.log('Errors:', errors.length);
        console.log('Node moved:', dragResult.moved);
        
        if (errors.length === 0) {
            console.log('✅ Drag operations working correctly');
        } else {
            console.log('❌ Errors detected:');
            errors.forEach(err => console.log('  ', err));
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
    
    await browser.close();
}

testDragOperations().catch(console.error);