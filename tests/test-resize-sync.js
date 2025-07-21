#!/usr/bin/env node

const puppeteer = require('puppeteer');

async function testResizeSync() {
    console.log('🔍 Testing resize synchronization...');
    
    const browser = await puppeteer.launch({ headless: false });
    
    // Open two tabs
    const page1 = await browser.newPage();
    const page2 = await browser.newPage();
    
    // Set up console logging for both pages
    page1.on('console', msg => console.log('Tab1:', msg.text()));
    page2.on('console', msg => console.log('Tab2:', msg.text()));
    
    try {
        // Load both pages
        await Promise.all([
            page1.goto('http://localhost:8000'),
            page2.goto('http://localhost:8000')
        ]);
        
        // Wait for initialization
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // In tab 1, find a node and perform non-uniform scaling
        const tab1Result = await page1.evaluate(() => {
            // Find a node to test with
            const nodes = window.app.graph.nodes;
            if (nodes.length === 0) {
                return { error: 'No nodes found' };
            }
            
            const node = nodes[0];
            const originalSize = [...node.size];
            const originalAspect = node.aspectRatio;
            
            console.log('Original size:', originalSize);
            console.log('Original aspect:', originalAspect);
            
            // Simulate non-uniform scaling (like holding shift)
            node.size[0] = originalSize[0] * 1.5;  // Scale width by 1.5x
            node.size[1] = originalSize[1] * 1.2;  // Scale height by 1.2x
            
            const newAspect = node.size[0] / node.size[1];
            node.aspectRatio = newAspect;
            
            console.log('After manual scaling - size:', node.size);
            console.log('After manual scaling - aspect:', node.aspectRatio);
            
            // Now trigger the resize command as if it came from collaboration
            if (window.app.operationPipeline) {
                window.app.operationPipeline.execute('node_resize', {
                    nodeIds: [node.id],
                    sizes: [[node.size[0], node.size[1]]]
                });
            }
            
            return {
                nodeId: node.id,
                originalSize,
                newSize: [...node.size],
                originalAspect,
                newAspect
            };
        });
        
        console.log('Tab 1 result:', tab1Result);
        
        // Wait for sync
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // In tab 2, check if the node has the same non-uniform scaling
        const tab2Result = await page2.evaluate((nodeId) => {
            const node = window.app.graph.getNodeById(nodeId);
            if (!node) {
                return { error: 'Node not found in tab 2' };
            }
            
            console.log('Tab 2 - Final size:', node.size);
            console.log('Tab 2 - Final aspect:', node.aspectRatio);
            
            return {
                finalSize: [...node.size],
                finalAspect: node.aspectRatio
            };
        }, tab1Result.nodeId);
        
        console.log('Tab 2 result:', tab2Result);
        
        // Compare results
        const sizesMatch = tab1Result.newSize[0] === tab2Result.finalSize[0] && 
                          tab1Result.newSize[1] === tab2Result.finalSize[1];
        
        console.log('\n📊 Sync Test Results:');
        console.log('Sizes match:', sizesMatch);
        console.log('Tab 1 final size:', tab1Result.newSize);
        console.log('Tab 2 final size:', tab2Result.finalSize);
        console.log('Tab 1 aspect ratio:', tab1Result.newAspect);
        console.log('Tab 2 aspect ratio:', tab2Result.finalAspect);
        
        if (sizesMatch) {
            console.log('✅ Non-uniform scaling synchronized correctly!');
        } else {
            console.log('❌ Non-uniform scaling NOT synchronized');
        }
        
    } catch (error) {
        console.error('Test failed:', error);
    }
    
    await new Promise(resolve => setTimeout(resolve, 5000)); // Keep open for inspection
    await browser.close();
}

testResizeSync().catch(console.error);