#!/usr/bin/env node

/**
 * CLI test for collaborative undo/redo system
 * Run with: node tests/test-collaborative-undo.js
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Create a mock DOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body><canvas id="testCanvas"></canvas></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
    resources: 'usable'
});

global.window = dom.window;
global.document = dom.window.document;
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
global.requestIdleCallback = (cb) => setTimeout(cb, 0);

// Mock canvas context
const canvas = document.getElementById('testCanvas');
canvas.getContext = () => ({
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    beginPath: () => {},
    closePath: () => {},
    stroke: () => {},
    fill: () => {},
    measureText: () => ({ width: 100 }),
    fillText: () => {},
    strokeText: () => {},
    drawImage: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    setTransform: () => {}
});

// Helper to load scripts
function loadScript(scriptPath) {
    const fullPath = path.join(__dirname, '..', scriptPath);
    const code = fs.readFileSync(fullPath, 'utf8');
    
    try {
        // Create a function that runs in window context
        const fn = new Function('window', 'document', 'console', 'global', code);
        fn(window, document, console, global);
        console.log(`✅ Loaded: ${scriptPath}`);
    } catch (error) {
        console.error(`Error loading ${scriptPath}:`, error.message);
        throw error;
    }
}

// Mock dependencies
window.CONFIG = {
    CANVAS: { MIN_SCALE: 0.1, MAX_SCALE: 10 },
    ALIGNMENT: { DEFAULT_MARGIN: 20 },
    STORAGE: { MAX_UNDO_STATES: 50 }
};

window.Utils = {
    clamp: (val, min, max) => Math.max(min, Math.min(max, val))
};

// Load required files in order
console.log('🔄 Loading dependencies...');

// Mock classes that would normally be loaded
class LGraph {
    constructor() {
        this.nodes = [];
        this.lastNodeId = 0;
    }
    add(node) {
        this.nodes.push(node);
        console.log(`📦 Added node ${node.id} to graph`);
    }
    remove(node) {
        const idx = this.nodes.indexOf(node);
        if (idx >= 0) {
            this.nodes.splice(idx, 1);
            console.log(`🗑️ Removed node ${node.id} from graph`);
        }
    }
    getNodeById(id) {
        return this.nodes.find(n => n.id === id);
    }
    clear() {
        this.nodes = [];
    }
}

class LGraphCanvas {
    constructor(canvas, graph) {
        this.canvas = canvas;
        this.graph = graph;
        this.dirty_canvas = false;
        this.selection = {
            getSelectedNodes: () => [],
            clear: () => {}
        };
    }
}

// Mock node
class Node {
    constructor(type) {
        this.id = Date.now() + Math.random();
        this.type = type;
        this.pos = [0, 0];
        this.size = [200, 100];
        this.properties = {};
        this.flags = {};
    }
}

window.NodeFactory = {
    createNode: (type) => new Node(type)
};

// Create mock app
window.app = {
    graph: new LGraph(),
    graphCanvas: new LGraphCanvas(canvas, new LGraph()),
    showNotification: (options) => {
        console.log(`🔔 Notification [${options.type}]: ${options.message}`);
    }
};

// Create Command base class first
window.Command = class Command {
    constructor(type, params = {}, origin = 'local') {
        this.id = `${type}_${Date.now()}_${Math.random()}`;
        this.type = type;
        this.params = params;
        this.origin = origin;
        this.timestamp = Date.now();
        this.executed = false;
        this.undoData = null;
    }
    
    validate() {
        return { valid: true };
    }
    
    async execute(context) {
        throw new Error('Execute not implemented');
    }
    
    async undo(context) {
        throw new Error('Undo not implemented');
    }
    
    canMergeWith(other) {
        return false;
    }
    
    mergeWith(other) {
        throw new Error('Merge not implemented');
    }
};

// Load the actual scripts
try {
    // Now load commands that depend on Command
    loadScript('js/commands/NodeCommands.js');
    loadScript('js/commands/NodeCommandsExtended.js');
    
    // Load core systems
    loadScript('js/core/OperationPipeline.js');
    
    // Mock network layer
    window.app.networkLayer = {
        isConnected: false,
        on: () => {},
        emit: () => {}
    };
    
    // Mock state sync manager
    window.app.stateSyncManager = {
        executeOperation: async (command) => {
            console.log('🔄 Mock StateSyncManager executing:', command.type);
            
            // Simulate the command execution
            const context = {
                app: window.app,
                graph: window.app.graph,
                canvas: window.app.graphCanvas
            };
            
            // Execute the command to populate undo data
            const result = await command.execute(context);
            
            console.log('✅ Command executed, undoData:', {
                hasUndoData: !!command.undoData,
                undoDataKeys: command.undoData ? Object.keys(command.undoData) : []
            });
            
            return { success: true, result };
        },
        optimisticEnabled: true
    };
    
    // Initialize operation pipeline
    window.app.operationPipeline = new OperationPipeline(window.app);
    
    // Load undo/redo manager
    loadScript('js/core/CollaborativeUndoRedoManager.js');
    
    // Initialize undo/redo
    window.app.undoRedoManager = new CollaborativeUndoRedoManager(window.app);
    window.app.undoRedoManager.userId = 'test-user-1';
    
    console.log('✅ All dependencies loaded');
    
} catch (error) {
    console.error('❌ Failed to load dependencies:', error);
    process.exit(1);
}

// Test functions
async function testBasicUndo() {
    console.log('\n🧪 Test 1: Basic Create and Undo');
    console.log('================================');
    
    // Clear history
    window.app.undoRedoManager.currentUserHistory = [];
    window.app.undoRedoManager.historyIndex = -1;
    
    // Create a node
    console.log('📝 Creating node...');
    const result = await window.app.operationPipeline.execute('node_create', {
        type: 'basic/text',
        pos: [100, 100],
        size: [200, 100],
        properties: { text: 'Test Node' }
    });
    
    console.log('Result:', {
        success: result.success,
        nodeCreated: !!result.result?.node
    });
    
    // Check history
    console.log('\n📚 History after create:');
    const historyInfo = window.app.undoRedoManager.getHistoryInfo();
    console.log(historyInfo);
    
    // Try to undo
    console.log('\n↩️ Attempting undo...');
    const undoResult = await window.app.undoRedoManager.undo();
    console.log('Undo result:', undoResult);
    
    // Check graph state
    console.log('\n📊 Graph state after undo:');
    console.log('Nodes in graph:', window.app.graph.nodes.length);
}

async function testMoveUndo() {
    console.log('\n🧪 Test 2: Move and Undo');
    console.log('========================');
    
    // Clear and create a node first
    window.app.graph.clear();
    window.app.undoRedoManager.currentUserHistory = [];
    window.app.undoRedoManager.historyIndex = -1;
    
    // Create node directly (not through pipeline)
    const node = new Node('basic/text');
    node.id = 'test-node-1';
    window.app.graph.add(node);
    
    console.log('📝 Moving node...');
    const moveResult = await window.app.operationPipeline.execute('node_move', {
        nodeId: node.id,
        position: [200, 200]
    });
    
    console.log('Move result:', {
        success: moveResult.success
    });
    
    // Check if command has undo data
    const lastCommand = window.app.undoRedoManager.currentUserHistory[0];
    console.log('\n🔍 Checking captured command:');
    console.log({
        hasCommand: !!lastCommand,
        type: lastCommand?.type,
        hasUndoData: !!lastCommand?.undoData,
        undoData: lastCommand?.undoData
    });
    
    // Try undo
    console.log('\n↩️ Attempting undo...');
    const undoResult = await window.app.undoRedoManager.undo();
    console.log('Undo result:', undoResult);
    
    if (undoResult) {
        console.log('Node position after undo:', node.pos);
    }
}

async function testInterceptorDebug() {
    console.log('\n🧪 Test 3: Interceptor Debug');
    console.log('============================');
    
    // Add detailed logging to the interceptor
    const originalCaptureCommand = window.app.undoRedoManager.captureExecutedCommand.bind(window.app.undoRedoManager);
    window.app.undoRedoManager.captureExecutedCommand = function(command) {
        console.log('🎯 captureExecutedCommand called with:', {
            type: command.type,
            executed: command.executed,
            hasUndoData: !!command.undoData,
            undoDataDetail: command.undoData
        });
        return originalCaptureCommand(command);
    };
    
    // Clear state
    window.app.graph.clear();
    window.app.undoRedoManager.currentUserHistory = [];
    window.app.undoRedoManager.historyIndex = -1;
    
    // Create through pipeline
    console.log('📝 Creating node through pipeline...');
    const result = await window.app.operationPipeline.execute('node_create', {
        type: 'basic/text',
        pos: [100, 100]
    });
    
    console.log('\n📊 Final state:');
    console.log('History length:', window.app.undoRedoManager.currentUserHistory.length);
    console.log('History index:', window.app.undoRedoManager.historyIndex);
}

// Run tests
async function runTests() {
    console.log('🚀 Starting Collaborative Undo/Redo Tests\n');
    
    try {
        await testBasicUndo();
        await new Promise(resolve => setTimeout(resolve, 100));
        
        await testMoveUndo();
        await new Promise(resolve => setTimeout(resolve, 100));
        
        await testInterceptorDebug();
        
        console.log('\n✅ Tests completed');
    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.error(error.stack);
    }
}

runTests();