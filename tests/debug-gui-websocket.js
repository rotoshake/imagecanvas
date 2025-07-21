#!/usr/bin/env node

const puppeteer = require('puppeteer');

async function debugWebSocketConnection() {
    console.log('🔍 Debugging WebSocket connection in GUI...');
    
    const browser = await puppeteer.launch({ headless: false, devtools: true });
    const page = await browser.newPage();
    
    // Log all console messages from the page
    page.on('console', msg => {
        console.log(`[PAGE ${msg.type()}]`, msg.text());
    });
    
    // Navigate to the application
    await page.goto('http://localhost:8000', { waitUntil: 'networkidle2' });
    
    // Wait for scripts to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check what's available in the global scope
    const globalObjects = await page.evaluate(() => {
        const globals = {};
        
        // Check for Socket.IO
        globals.hasSocketIO = typeof window.io !== 'undefined';
        globals.hasSocket = typeof window.socket !== 'undefined';
        
        // Check for WebSocket
        globals.hasWebSocket = typeof window.WebSocket !== 'undefined';
        globals.hasWS = typeof window.ws !== 'undefined';
        
        // Check for collaborative mode
        globals.collaborativeMode = window.COLLABORATIVE_MODE;
        
        // Check for any connection-related globals
        globals.connected = window.connected;
        globals.isConnected = window.isConnected;
        
        // Check if any collaborative architecture is initialized
        globals.hasCollaborativeArchitecture = typeof window.CollaborativeArchitecture !== 'undefined';
        globals.hasNetworkLayer = typeof window.NetworkLayer !== 'undefined';
        globals.hasOperationPipeline = typeof window.OperationPipeline !== 'undefined';
        
        return globals;
    });
    
    console.log('🌐 Global objects:', JSON.stringify(globalObjects, null, 2));
    
    // Try to manually establish connection
    const connectionResult = await page.evaluate(() => {
        return new Promise((resolve) => {
            if (window.io && window.COLLABORATIVE_MODE) {
                console.log('Attempting to create Socket.IO connection...');
                const socket = window.io('http://localhost:3000');
                
                socket.on('connect', () => {
                    resolve({ success: true, method: 'socket.io', id: socket.id });
                });
                
                socket.on('connect_error', (error) => {
                    resolve({ success: false, method: 'socket.io', error: error.message });
                });
                
                setTimeout(() => {
                    resolve({ success: false, method: 'socket.io', error: 'timeout' });
                }, 5000);
            } else {
                resolve({ success: false, error: 'Socket.IO not available' });
            }
        });
    });
    
    console.log('🔌 Connection result:', JSON.stringify(connectionResult, null, 2));
    
    // Close browser after debug
    setTimeout(async () => {
        await browser.close();
        process.exit(0);
    }, 10000);
}

debugWebSocketConnection().catch(console.error);