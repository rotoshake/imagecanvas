#!/usr/bin/env node

const puppeteer = require('puppeteer');

async function testConsoleErrors() {
    console.log('🔍 Monitoring console for validation errors...');
    
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    const errors = [];
    const validationErrors = [];
    
    page.on('console', msg => {
        const message = msg.text();
        if (msg.type() === 'error') {
            errors.push(message);
            if (message.includes('Validation failed') || message.includes('Invalid position')) {
                validationErrors.push(message);
                console.log('❌ Validation Error:', message);
            }
        }
    });
    
    page.on('pageerror', error => {
        errors.push(error.message);
        if (error.message.includes('Validation failed') || error.message.includes('Invalid position')) {
            validationErrors.push(error.message);
            console.log('❌ Page Error:', error.message);
        }
    });
    
    try {
        await page.goto('http://localhost:8000', { 
            waitUntil: 'networkidle0',
            timeout: 10000 
        });
        
        console.log('✅ Page loaded successfully');
        
        // Wait for full initialization
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Test if we can interact with the canvas without errors
        await page.evaluate(() => {
            const canvas = document.querySelector('#mycanvas');
            if (canvas) {
                // Simulate some mouse interactions
                const rect = canvas.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                
                // Mouse down
                const mouseDown = new MouseEvent('mousedown', {
                    clientX: centerX,
                    clientY: centerY,
                    button: 0,
                    bubbles: true
                });
                canvas.dispatchEvent(mouseDown);
                
                // Mouse move
                const mouseMove = new MouseEvent('mousemove', {
                    clientX: centerX + 50,
                    clientY: centerY + 50,
                    button: 0,
                    bubbles: true
                });
                canvas.dispatchEvent(mouseMove);
                
                // Mouse up
                const mouseUp = new MouseEvent('mouseup', {
                    clientX: centerX + 50,
                    clientY: centerY + 50,
                    button: 0,
                    bubbles: true
                });
                canvas.dispatchEvent(mouseUp);
            }
        });
        
        console.log('✅ Simulated mouse interactions');
        
        // Wait for any async operations
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('\n📊 Results:');
        console.log('Total errors:', errors.length);
        console.log('Validation errors:', validationErrors.length);
        
        if (validationErrors.length === 0) {
            console.log('✅ No validation errors detected - fix successful!');
        } else {
            console.log('❌ Validation errors still present:');
            validationErrors.forEach(err => console.log('  ', err));
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
    
    await browser.close();
}

testConsoleErrors().catch(console.error);