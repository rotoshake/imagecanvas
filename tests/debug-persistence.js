#!/usr/bin/env node

const io = require('socket.io-client');

const SOCKET_URL = 'http://localhost:3000';

function log(message, socketId = '') {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} [${socketId || 'DEBUG'}] ${message}`);
}

async function testPersistenceFlow() {
    log('Testing persistence flow step by step');
    
    return new Promise((resolve, reject) => {
        const socket1 = io(SOCKET_URL);
        
        socket1.on('connect', () => {
            log('Socket 1 connected', socket1.id);
            
            socket1.emit('join_project', {
                projectId: 'demo-project',
                username: 'persist-test-user',
                displayName: 'Persist Test User',
                tabId: 'persist-test-tab'
            });
        });
        
        socket1.on('project_joined', (data) => {
            log('Socket 1 joined project: ' + JSON.stringify(data), socket1.id);
            
            // Send an operation
            setTimeout(() => {
                log('Sending test operation', socket1.id);
                socket1.emit('canvas_operation', {
                    projectId: data.project.id,
                    operation: {
                        type: 'add',
                        data: {
                            id: 'persist-test-node',
                            type: 'text',
                            content: 'Persistent test text',
                            x: 50,
                            y: 50
                        }
                    }
                });
            }, 100);
        });
        
        socket1.on('canvas_operation', (data) => {
            log('Socket 1 received operation: ' + JSON.stringify(data), socket1.id);
            
            setTimeout(() => {
                socket1.disconnect();
                log('Socket 1 disconnected, now testing persistence');
                
                // Test persistence with new socket
                const socket2 = io(SOCKET_URL);
                
                socket2.on('connect', () => {
                    log('Socket 2 connected', socket2.id);
                    
                    socket2.emit('join_project', {
                        projectId: 'demo-project',
                        username: 'persist-test-user-2',
                        displayName: 'Persist Test User 2',
                        tabId: 'persist-test-tab-2'
                    });
                });
                
                socket2.on('project_joined', (data) => {
                    log('Socket 2 joined project, requesting full sync', socket2.id);
                    
                    socket2.emit('request_full_sync', { 
                        projectId: data.project.id 
                    });
                });
                
                socket2.on('full_state_sync', (data) => {
                    log('Socket 2 received full state: ' + JSON.stringify(data), socket2.id);
                    
                    socket2.disconnect();
                    
                    const hasNode = data.state.nodes && data.state.nodes.some(
                        node => node.id === 'persist-test-node'
                    );
                    
                    resolve({
                        success: hasNode,
                        state: data.state,
                        nodeCount: data.state.nodes ? data.state.nodes.length : 0
                    });
                });
                
                socket2.on('error', (error) => {
                    log('Socket 2 error: ' + JSON.stringify(error), socket2.id);
                    socket2.disconnect();
                    reject(error);
                });
                
            }, 1000);
        });
        
        socket1.on('error', (error) => {
            log('Socket 1 error: ' + JSON.stringify(error), socket1.id);
            reject(error);
        });
        
        setTimeout(() => {
            reject(new Error('Test timeout'));
        }, 10000);
    });
}

testPersistenceFlow()
    .then(result => {
        console.log('\n=== PERSISTENCE TEST RESULT ===');
        console.log('Success:', result.success);
        console.log('Node count:', result.nodeCount);
        console.log('State:', JSON.stringify(result.state, null, 2));
    })
    .catch(error => {
        console.error('Persistence test failed:', error);
    });