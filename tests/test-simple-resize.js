#!/usr/bin/env node

const puppeteer = require('puppeteer');

async function testSimpleResize() {
    console.log('🔍 Testing simple resize with debug...');
    
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('onResize debug') || text.includes('Maintaining') || text.includes('Using non-uniform')) {
            console.log('>>> ', text);
        }
    });
    
    try {
        await page.goto('http://localhost:8000');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const result = await page.evaluate(() => {
            const nodes = window.app.graph.nodes;
            if (nodes.length === 0) {
                return { error: 'No nodes found' };
            }
            
            const node = nodes[0];
            console.log('BEFORE resize - aspectRatio:', node.aspectRatio, 'originalAspect:', node.originalAspect);
            
            // Manually trigger a resize command
            window.app.operationPipeline.execute('node_resize', {
                nodeIds: [node.id],
                sizes: [[300, 100]]  // Very different aspect ratio
            });
            
            return { nodeId: node.id };
        });
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await page.evaluate(() => {
            const nodes = window.app.graph.nodes;
            const node = nodes[0];
            console.log('AFTER resize - aspectRatio:', node.aspectRatio, 'originalAspect:', node.originalAspect, 'size:', node.size);
        });
        
        console.log('✅ Test completed');
        
    } catch (error) {
        console.error('Test failed:', error);
    }
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    await browser.close();
}

testSimpleResize().catch(console.error);