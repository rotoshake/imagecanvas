#!/usr/bin/env node

const io = require('socket.io-client');

const SOCKET_URL = 'http://localhost:3000';

function log(message, socketId = '') {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} [${socketId || 'DEBUG'}] ${message}`);
}

async function testBasicFlow() {
    log('Starting debug test of collaboration flow');
    
    return new Promise((resolve, reject) => {
        const socket = io(SOCKET_URL);
        let events = [];
        
        socket.on('connect', () => {
            log('Connected', socket.id);
            events.push('connected');
            
            // Join project (use demo project or create new one)
            socket.emit('join_project', {
                projectId: 'demo-project',
                username: 'debug-user',
                displayName: 'Debug User',
                tabId: 'debug-tab'
            });
        });
        
        socket.on('project_joined', (data) => {
            log('Project joined: ' + JSON.stringify(data), socket.id);
            events.push('project_joined');
            
            const projectId = data.project.id; // Use the actual project ID from response
            
            // Send a canvas operation
            setTimeout(() => {
                log('Sending canvas operation', socket.id);
                socket.emit('canvas_operation', {
                    projectId: projectId,
                    operation: {
                        type: 'add',
                        data: {
                            id: 'debug-node',
                            type: 'text',
                            content: 'Debug text',
                            x: 100,
                            y: 100
                        }
                    }
                });
            }, 100);
        });
        
        socket.on('canvas_operation', (data) => {
            log('Received canvas operation: ' + JSON.stringify(data), socket.id);
            events.push('canvas_operation_received');
            
            socket.disconnect();
            resolve({
                success: true,
                events: events,
                lastData: data
            });
        });
        
        socket.on('error', (error) => {
            log('Error: ' + JSON.stringify(error), socket.id);
            events.push('error');
            reject(error);
        });
        
        socket.on('connect_error', (error) => {
            log('Connect error: ' + error.message, socket.id);
            reject(error);
        });
        
        socket.on('disconnect', () => {
            log('Disconnected', socket.id);
        });
        
        // Add listeners for other events we might receive
        ['active_users', 'user_joined', 'user_left', 'tab_closed'].forEach(eventType => {
            socket.on(eventType, (data) => {
                log(`Received ${eventType}: ${JSON.stringify(data)}`, socket.id);
                events.push(eventType);
            });
        });
        
        setTimeout(() => {
            socket.disconnect();
            resolve({
                success: false,
                events: events,
                error: 'Timeout'
            });
        }, 5000);
    });
}

testBasicFlow()
    .then(result => {
        console.log('\n=== TEST RESULT ===');
        console.log('Success:', result.success);
        console.log('Events:', result.events);
        if (result.lastData) {
            console.log('Last data:', JSON.stringify(result.lastData, null, 2));
        }
        if (result.error) {
            console.log('Error:', result.error);
        }
    })
    .catch(error => {
        console.error('Test failed:', error);
    });