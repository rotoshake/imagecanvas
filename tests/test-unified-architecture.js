#!/usr/bin/env node

const { spawn } = require('child_process');
const http = require('http');
const io = require('socket.io-client');
const path = require('path');
const fs = require('fs');

const SERVER_PORT = 3000;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const SOCKET_URL = `http://localhost:${SERVER_PORT}`;

let serverProcess;
let testResults = {
    passed: 0,
    failed: 0,
    tests: []
};

function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
        info: '[INFO]',
        success: '[✓]',
        error: '[✗]',
        test: '[TEST]'
    }[type] || '[LOG]';
    
    console.log(`${timestamp} ${prefix} ${message}`);
}

function assert(condition, testName, errorMessage) {
    if (condition) {
        testResults.passed++;
        testResults.tests.push({ name: testName, status: 'passed' });
        log(`${testName}`, 'success');
    } else {
        testResults.failed++;
        testResults.tests.push({ name: testName, status: 'failed', error: errorMessage });
        log(`${testName} - ${errorMessage}`, 'error');
    }
}

async function startServer() {
    return new Promise((resolve, reject) => {
        log('Starting server...');
        
        const serverPath = path.join(__dirname, '..', 'server', 'index.js');
        serverProcess = spawn('node', [serverPath], {
            cwd: path.join(__dirname, '..', 'server'),
            env: { ...process.env, NODE_ENV: 'test' }
        });
        
        serverProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log('[SERVER]', output.trim());
            if (output.includes('Server running') || output.includes('ImageCanvas Collaborative Server running')) {
                log('Server started successfully', 'success');
                setTimeout(resolve, 1000); // Give server time to fully initialize
            }
        });
        
        serverProcess.stderr.on('data', (data) => {
            console.error('Server error:', data.toString());
        });
        
        serverProcess.on('error', reject);
        
        setTimeout(() => reject(new Error('Server startup timeout')), 10000);
    });
}

async function stopServer() {
    if (serverProcess) {
        log('Stopping server...');
        serverProcess.kill();
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

async function makeHttpRequest(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: SERVER_PORT,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: data ? JSON.parse(data) : null
                    });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });
        
        req.on('error', (err) => {
            reject(err);
        });
        
        if (body) {
            req.write(JSON.stringify(body));
        }
        
        req.end();
    });
}

async function testWebSocketConnection() {
    return new Promise((resolve, reject) => {
        const socket = io(SOCKET_URL, {
            timeout: 5000,
            autoConnect: true
        });
        
        const timeout = setTimeout(() => {
            socket.disconnect();
            reject(new Error('Socket.IO connection timeout'));
        }, 5000);
        
        socket.on('connect', () => {
            clearTimeout(timeout);
            socket.disconnect();
            resolve(true);
        });
        
        socket.on('connect_error', (err) => {
            clearTimeout(timeout);
            socket.disconnect();
            reject(err);
        });
    });
}

async function testOperationPipeline() {
    return new Promise((resolve, reject) => {
        const socket = io(SOCKET_URL);
        let receivedMessages = [];
        
        socket.on('connect', () => {
            // Join a project using the actual event
            socket.emit('join_project', {
                projectId: 'demo-project',
                username: 'test-user-1',
                displayName: 'Test User 1',
                tabId: 'test-tab-1'
            });
        });
        
        // Listen for the actual events from CollaborationManager
        socket.on('project_joined', (data) => {
            receivedMessages.push({ type: 'project_joined', data });
            
            // Send an operation through the pipeline
            setTimeout(() => {
                socket.emit('canvas_operation', {
                    projectId: data.project.id, // Use correct project ID
                    operation: {
                        type: 'add',
                        data: {
                            type: 'image',
                            src: 'test.jpg',
                            x: 100,
                            y: 100,
                            width: 200,
                            height: 200
                        }
                    }
                });
            }, 100);
        });
        
        socket.on('canvas_operation', (data) => {
            receivedMessages.push({ type: 'canvas_operation', data });
            socket.disconnect();
            resolve({
                success: true,
                messages: receivedMessages
            });
        });
        
        socket.on('connect_error', reject);
        
        setTimeout(() => {
            socket.disconnect();
            resolve({
                success: receivedMessages.length > 0,
                messages: receivedMessages
            });
        }, 5000);
    });
}

async function testStateSynchronization() {
    return new Promise((resolve, reject) => {
        const socket1 = io(SOCKET_URL);
        const socket2 = io(SOCKET_URL);
        let client1Data = [];
        let client2Data = [];
        let syncComplete = false;
        
        const projectId = 'demo-project';
        
        socket1.on('connect', () => {
            socket1.emit('join_project', {
                projectId: projectId,
                username: 'user-1',
                displayName: 'User 1',
                tabId: 'tab-1'
            });
        });
        
        socket2.on('connect', () => {
            setTimeout(() => {
                socket2.emit('join_project', {
                    projectId: projectId,
                    username: 'user-2',
                    displayName: 'User 2',
                    tabId: 'tab-2'
                });
            }, 500);
        });
        
        // Coordinate so Client 1 waits for Client 2 to join
        let client2Joined = false;
        
        socket1.on('project_joined', (data) => {
            client1Data.push({ event: 'project_joined', data });
            
            // Wait for client 2 to join before sending operation
            const waitForClient2 = () => {
                if (client2Joined) {
                    socket1.emit('canvas_operation', {
                        projectId: data.project.id, // Use correct project ID
                        operation: {
                            type: 'add',
                            data: {
                                id: 'test-node-1',
                                type: 'text',
                                content: 'Test text',
                                x: 50,
                                y: 50
                            }
                        }
                    });
                } else {
                    setTimeout(waitForClient2, 100);
                }
            };
            
            setTimeout(waitForClient2, 100);
        });
        
        socket2.on('project_joined', (data) => {
            client2Data.push({ event: 'project_joined', data });
            client2Joined = true;
        });
        
        socket2.on('canvas_operation', (data) => {
            client2Data.push({ event: 'canvas_operation', data });
            
            if (!syncComplete) {
                syncComplete = true;
                socket1.disconnect();
                socket2.disconnect();
                
                resolve({
                    success: true,
                    client1Events: client1Data.length,
                    client2Events: client2Data.length,
                    client1Data,
                    client2Data
                });
            }
        });
        
        socket1.on('connect_error', reject);
        socket2.on('connect_error', reject);
        
        setTimeout(() => {
            socket1.disconnect();
            socket2.disconnect();
            resolve({
                success: false,
                error: 'Timeout waiting for state sync',
                client1Events: client1Data.length,
                client2Events: client2Data.length
            });
        }, 8000);
    });
}

async function testPersistence() {
    const projectId = 'demo-project';
    
    return new Promise((resolve, reject) => {
        const socket1 = io(SOCKET_URL);
        
        socket1.on('connect', () => {
            socket1.emit('join_project', {
                projectId: projectId,
                username: 'persist-user',
                displayName: 'Persist User',
                tabId: 'persist-tab-1'
            });
        });
        
        socket1.on('project_joined', (data) => {
            setTimeout(() => {
                socket1.emit('canvas_operation', {
                    projectId: data.project.id, // Use correct project ID
                    operation: {
                        type: 'add',
                        data: {
                            id: 'persist-node',
                            type: 'text',
                            content: 'Persistent text',
                            x: 100,
                            y: 100
                        }
                    }
                });
                
                setTimeout(() => {
                    socket1.disconnect();
                    
                    // Reconnect and check if data persists
                    const socket2 = io(SOCKET_URL);
                    
                    socket2.on('connect', () => {
                        socket2.emit('join_project', {
                            projectId: projectId,
                            username: 'persist-user-2',
                            displayName: 'Persist User 2',
                            tabId: 'persist-tab-2'
                        });
                    });
                    
                    socket2.on('project_joined', (data) => {
                        // Request full sync to get current state
                        socket2.emit('request_full_sync', { projectId: data.project.id });
                    });
                    
                    socket2.on('full_state_sync', (data) => {
                        const state = data.state;
                        socket2.disconnect();
                        
                        const hasPersistedNode = state.nodes && state.nodes.some(
                            node => node.id === 'persist-node' && 
                                    (node.content === 'Persistent text' || 
                                     node.properties?.content === 'Persistent text' ||
                                     node.title === 'Persistent text')
                        );
                        
                        resolve({
                            success: hasPersistedNode,
                            nodeCount: state.nodes ? state.nodes.length : 0,
                            state
                        });
                    });
                    
                    socket2.on('connect_error', (err) => {
                        socket2.disconnect();
                        reject(err);
                    });
                }, 1000);
            }, 500);
        });
        
        socket1.on('connect_error', reject);
        
        setTimeout(() => {
            resolve({
                success: false,
                error: 'Persistence test timeout'
            });
        }, 10000);
    });
}

async function testNetworkLayer() {
    const response = await makeHttpRequest('/health');
    return {
        healthCheck: response.status === 200,
        data: response.data
    };
}

async function runTests() {
    log('Starting ImageCanvas Architecture Tests', 'test');
    log('=====================================', 'test');
    
    try {
        // Check if server is already running, if not start it
        try {
            const healthCheck = await makeHttpRequest('/health');
            if (healthCheck.status === 200) {
                log('Server already running, skipping startup', 'info');
            } else {
                await startServer();
            }
        } catch (e) {
            log('Server not running, starting it...', 'info');
            await startServer();
        }
        
        // Test 1: Network Layer Health Check
        log('Testing Network Layer...', 'test');
        const networkTest = await testNetworkLayer();
        assert(
            networkTest.healthCheck,
            'Network Layer: Health check endpoint',
            'Health check failed'
        );
        
        // Test 2: WebSocket Connection
        log('Testing WebSocket connection...', 'test');
        const wsConnected = await testWebSocketConnection();
        assert(
            wsConnected,
            'WebSocket: Basic connection',
            'WebSocket connection failed'
        );
        
        // Test 3: Operation Pipeline
        log('Testing Operation Pipeline...', 'test');
        const pipelineResult = await testOperationPipeline();
        assert(
            pipelineResult.success,
            'Operation Pipeline: Message flow',
            'Operation pipeline failed'
        );
        assert(
            pipelineResult.messages.some(m => m.type === 'canvas_operation'),
            'Operation Pipeline: State updates',
            'No canvas operation received'
        );
        
        // Test 4: State Synchronization
        log('Testing State Synchronization...', 'test');
        const syncResult = await testStateSynchronization();
        assert(
            syncResult.success,
            'State Sync: Multi-client synchronization',
            syncResult.error || 'State sync failed'
        );
        
        // Test 5: Persistence
        log('Testing Persistence Handler...', 'test');
        const persistResult = await testPersistence();
        assert(
            persistResult.success,
            'Persistence: Data survives reconnection',
            'Data was not persisted'
        );
        
        // Print results
        log('=====================================', 'test');
        log(`Tests completed: ${testResults.passed + testResults.failed}`, 'test');
        log(`Passed: ${testResults.passed}`, 'success');
        log(`Failed: ${testResults.failed}`, testResults.failed > 0 ? 'error' : 'info');
        
        // Save results
        const resultsPath = path.join(__dirname, 'test-results.json');
        fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
        log(`Results saved to ${resultsPath}`, 'info');
        
    } catch (error) {
        log(`Fatal error: ${error.message}`, 'error');
        console.error(error);
    } finally {
        // Don't stop server if it was already running
        if (serverProcess) {
            await stopServer();
        }
        process.exit(testResults.failed > 0 ? 1 : 0);
    }
}

// Run tests
runTests();