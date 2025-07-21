#!/usr/bin/env node

/**
 * Simple test to debug undo/redo command capture
 */

// Mock minimal environment
const mockWindow = {
    app: null,
    console: console
};

// Mock Command class
class Command {
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
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        // Implement undo logic
    }
}

// Mock MoveNodeCommand
class MoveNodeCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_move', params, origin);
    }
    
    async execute(context) {
        const { graph } = context;
        
        // Store undo data BEFORE moving
        this.undoData = { nodes: [] };
        
        if (this.params.nodeId) {
            const node = graph.getNodeById(this.params.nodeId);
            if (!node) throw new Error('Node not found');
            
            // Store old position
            this.undoData.nodes.push({
                id: node.id,
                oldPosition: [...node.pos]
            });
            
            // Move node
            node.pos[0] = this.params.position[0];
            node.pos[1] = this.params.position[1];
            
            console.log(`✅ Moved node ${node.id} from [${this.undoData.nodes[0].oldPosition}] to [${node.pos}]`);
        }
        
        this.executed = true;
        return { success: true };
    }
    
    async undo(context) {
        if (!this.undoData) {
            throw new Error('No undo data available');
        }
        
        const { graph } = context;
        
        for (const { id, oldPosition } of this.undoData.nodes) {
            const node = graph.getNodeById(id);
            if (node) {
                console.log(`↩️ Restoring node ${id} to position [${oldPosition}]`);
                node.pos[0] = oldPosition[0];
                node.pos[1] = oldPosition[1];
            }
        }
    }
}

// Mock graph
class MockGraph {
    constructor() {
        this.nodes = [];
    }
    
    add(node) {
        this.nodes.push(node);
    }
    
    getNodeById(id) {
        return this.nodes.find(n => n.id === id);
    }
}

// Test the flow
async function testCommandCapture() {
    console.log('🧪 Testing Command Capture Flow\n');
    
    // Setup
    const graph = new MockGraph();
    const node = {
        id: 'test-node-1',
        pos: [100, 100]
    };
    graph.add(node);
    
    const context = { graph };
    
    // Create and execute command
    console.log('1️⃣ Creating MoveNodeCommand...');
    const command = new MoveNodeCommand({
        nodeId: node.id,
        position: [200, 200]
    });
    
    console.log('2️⃣ Command state before execution:');
    console.log({
        executed: command.executed,
        hasUndoData: !!command.undoData
    });
    
    console.log('\n3️⃣ Executing command...');
    await command.execute(context);
    
    console.log('\n4️⃣ Command state after execution:');
    console.log({
        executed: command.executed,
        hasUndoData: !!command.undoData,
        undoData: command.undoData
    });
    
    console.log('\n5️⃣ Testing undo...');
    try {
        await command.undo(context);
        console.log('✅ Undo successful!');
        console.log('Node position after undo:', node.pos);
    } catch (error) {
        console.error('❌ Undo failed:', error.message);
    }
}

// Simulate what CollaborativeUndoRedoManager should do
async function testInterceptorFlow() {
    console.log('\n\n🧪 Testing Interceptor Flow\n');
    
    const graph = new MockGraph();
    const node = {
        id: 'test-node-2', 
        pos: [50, 50]
    };
    graph.add(node);
    
    // Mock minimal app structure
    const app = {
        graph,
        graphCanvas: { dirty_canvas: false },
        stateSyncManager: {
            executeOperation: async (command) => {
                console.log('📤 StateSyncManager.executeOperation called');
                
                const context = { graph: app.graph, canvas: app.graphCanvas };
                
                // This is where the command gets its undo data!
                const result = await command.execute(context);
                
                console.log('📥 After execution in StateSyncManager:');
                console.log({
                    executed: command.executed,
                    hasUndoData: !!command.undoData,
                    undoDataLength: command.undoData?.nodes?.length
                });
                
                return { success: true, result };
            }
        }
    };
    
    // Simulate what the interceptor should capture
    const capturedCommands = [];
    
    // Mock the interceptor
    const originalExecuteOperation = app.stateSyncManager.executeOperation;
    app.stateSyncManager.executeOperation = async function(command) {
        console.log('\n🎯 Interceptor: Before execution');
        
        const result = await originalExecuteOperation.call(this, command);
        
        console.log('🎯 Interceptor: After execution');
        console.log('Command state:', {
            type: command.type,
            executed: command.executed,
            hasUndoData: !!command.undoData
        });
        
        if (command.executed && command.undoData) {
            console.log('✅ Capturing command for undo history!');
            capturedCommands.push(command);
        } else {
            console.log('❌ Command not ready for capture:', {
                executed: command.executed,
                hasUndoData: !!command.undoData
            });
        }
        
        return result;
    };
    
    // Test the flow
    console.log('1️⃣ Creating command...');
    const command = new MoveNodeCommand({
        nodeId: node.id,
        position: [150, 150]
    });
    
    console.log('\n2️⃣ Executing through StateSyncManager...');
    await app.stateSyncManager.executeOperation(command);
    
    console.log('\n3️⃣ Captured commands:', capturedCommands.length);
    if (capturedCommands.length > 0) {
        console.log('✅ Command successfully captured with undo data!');
    } else {
        console.log('❌ Command was not captured!');
    }
}

// Run tests
async function runTests() {
    try {
        await testCommandCapture();
        await testInterceptorFlow();
        
        console.log('\n✅ All tests completed!');
    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.error(error.stack);
    }
}

runTests();