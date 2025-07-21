#!/usr/bin/env node

const puppeteer = require('puppeteer');

async function debugBlankPage() {
    console.log('🔍 Investigating blank page on localhost:8000...');
    
    const browser = await puppeteer.launch({ 
        headless: false, 
        devtools: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Capture all console messages
    const consoleMessages = [];
    page.on('console', msg => {
        const message = `[${msg.type().toUpperCase()}] ${msg.text()}`;
        consoleMessages.push(message);
        console.log(message);
    });
    
    // Capture network requests
    const networkRequests = [];
    page.on('request', req => {
        networkRequests.push({ url: req.url(), method: req.method() });
    });
    
    // Capture network failures
    const networkFailures = [];
    page.on('requestfailed', req => {
        const failure = `FAILED: ${req.method()} ${req.url()} - ${req.failure().errorText}`;
        networkFailures.push(failure);
        console.log(`❌ ${failure}`);
    });
    
    try {
        console.log('📍 Navigating to localhost:8000...');
        await page.goto('http://localhost:8000', { 
            waitUntil: 'networkidle2',
            timeout: 15000 
        });
        
        // Wait a bit for any delayed loading
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Check what's actually on the page
        const pageInfo = await page.evaluate(() => {
            return {
                title: document.title,
                bodyHTML: document.body.innerHTML,
                bodyText: document.body.innerText,
                hasCanvas: document.querySelector('#mycanvas') !== null,
                canvasVisible: document.querySelector('#mycanvas')?.offsetHeight > 0,
                headContent: document.head.innerHTML,
                loadedScripts: Array.from(document.scripts).map(s => s.src || '(inline)'),
                cssFiles: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => l.href),
                documentReady: document.readyState,
                windowObjects: Object.keys(window).filter(key => 
                    ['app', 'canvas', 'graph', 'DragDropManager', 'CollaborativeArchitecture'].includes(key)
                )
            };
        });
        
        console.log('\n📋 PAGE ANALYSIS:');
        console.log('=================');
        console.log('Title:', pageInfo.title);
        console.log('Document ready state:', pageInfo.documentReady);
        console.log('Body text length:', pageInfo.bodyText.length);
        console.log('Has canvas element:', pageInfo.hasCanvas);
        console.log('Canvas visible:', pageInfo.canvasVisible);
        console.log('Window objects found:', pageInfo.windowObjects);
        console.log('Loaded scripts:', pageInfo.loadedScripts.length);
        console.log('CSS files:', pageInfo.cssFiles);
        
        if (pageInfo.bodyText.length === 0) {
            console.log('\n⚠️ BODY IS EMPTY!');
            console.log('Body HTML:', pageInfo.bodyHTML);
        }
        
        if (networkFailures.length > 0) {
            console.log('\n❌ NETWORK FAILURES:');
            networkFailures.forEach(failure => console.log('  -', failure));
        }
        
        console.log('\n📊 CONSOLE MESSAGES:', consoleMessages.length);
        consoleMessages.forEach(msg => console.log('  ', msg));
        
        // Take a screenshot
        await page.screenshot({ path: '/Users/marcsteinberg/Documents/Projects/ImageCanvas/tests/blank-page-debug.png', fullPage: true });
        console.log('\n📸 Screenshot saved to blank-page-debug.png');
        
        // Keep browser open for manual inspection
        console.log('\n🔍 Browser kept open for manual inspection...');
        console.log('Check the browser window and console, then close it to continue.');
        
        await new Promise((resolve) => {
            page.on('close', resolve);
        });
        
    } catch (error) {
        console.error('❌ Error during investigation:', error);
    }
    
    await browser.close();
}

debugBlankPage().catch(console.error);