#!/usr/bin/env node

const puppeteer = require('puppeteer');

async function checkPage() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    const errors = [];
    const consoleMessages = [];
    
    page.on('console', msg => {
        consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    });
    
    page.on('pageerror', error => {
        errors.push(`Page Error: ${error.message}`);
    });
    
    page.on('requestfailed', req => {
        errors.push(`Request Failed: ${req.url()} - ${req.failure().errorText}`);
    });
    
    try {
        await page.goto('http://localhost:8000', { 
            waitUntil: 'networkidle0',
            timeout: 10000 
        });
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const info = await page.evaluate(() => {
            return {
                title: document.title,
                bodyVisible: window.getComputedStyle(document.body).display !== 'none',
                canvasExists: !!document.querySelector('#mycanvas'),
                canvasDisplay: document.querySelector('#mycanvas') ? 
                    window.getComputedStyle(document.querySelector('#mycanvas')).display : 'not found',
                canvasSize: document.querySelector('#mycanvas') ? {
                    width: document.querySelector('#mycanvas').offsetWidth,
                    height: document.querySelector('#mycanvas').offsetHeight
                } : null,
                bodyText: document.body.innerText.trim(),
                hasErrors: !!document.querySelector('.error'),
                windowVars: Object.keys(window).filter(k => 
                    ['app', 'graph', 'LGraph', 'LiteGraph'].includes(k)
                )
            };
        });
        
        console.log('📋 PAGE INFO:');
        console.log('Title:', info.title);
        console.log('Body visible:', info.bodyVisible);  
        console.log('Canvas exists:', info.canvasExists);
        console.log('Canvas display:', info.canvasDisplay);
        console.log('Canvas size:', info.canvasSize);
        console.log('Body text length:', info.bodyText.length);
        console.log('Window vars:', info.windowVars);
        
        if (errors.length > 0) {
            console.log('\n❌ ERRORS:');
            errors.forEach(err => console.log('  ', err));
        }
        
        if (consoleMessages.length > 0) {
            console.log('\n📝 CONSOLE:');
            consoleMessages.slice(-10).forEach(msg => console.log('  ', msg));
        }
        
        // The key insight: check if canvas has any content
        const canvasContent = await page.evaluate(() => {
            const canvas = document.querySelector('#mycanvas');
            if (!canvas) return 'no canvas';
            
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            
            // Check if any pixel is not transparent
            for (let i = 3; i < imageData.data.length; i += 4) {
                if (imageData.data[i] !== 0) {
                    return 'has content';
                }
            }
            return 'empty canvas';
        });
        
        console.log('Canvas content:', canvasContent);
        
    } catch (error) {
        console.error('Navigation error:', error.message);
    }
    
    await browser.close();
}

checkPage().catch(console.error);