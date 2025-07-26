// ===================================
// ANIMATION SYSTEM
// ===================================

class AnimationSystem {
    constructor() {
        this.animations = new Map();
        this.running = false;
        this.lastTime = 0;
    }
    
    start() {
        this.running = true;
    }
    
    stop() {
        this.running = false;
    }
    
    // Called by main render loop with deltaTime
    updateAnimations(deltaTime) {
        if (!this.running) return false;
        
        // Convert deltaTime to seconds and cap for stability (33ms = 30 FPS minimum)
        const deltaTimeSeconds = Math.min(deltaTime / 1000, 0.033);
        
        const toRemove = [];
        let hasActiveAnimations = false;
        
        for (const [id, animation] of this.animations) {
            hasActiveAnimations = true;
            const finished = this.updateAnimation(animation, deltaTimeSeconds);
            if (finished) {
                toRemove.push(id);
                if (animation.onComplete) {
                    animation.onComplete();
                }
            }
        }
        
        toRemove.forEach(id => this.animations.delete(id));
        
        // Return true if there are still active animations (need continued updates)
        return hasActiveAnimations && this.animations.size > 0;
    }
    
    updateAnimation(animation, deltaTimeSeconds) {
        const { target, properties, spring } = animation;
        let allFinished = true;
        
        for (const [prop, config] of Object.entries(properties)) {
            const current = target[prop];
            const targetValue = config.target;
            const velocity = config.velocity || 0;
            
            const dx = targetValue - current;
            const acceleration = spring.k * dx - spring.d * velocity;
            
            // All calculations now use seconds directly
            config.velocity = velocity + acceleration * deltaTimeSeconds;
            target[prop] = current + config.velocity * deltaTimeSeconds;
            
            const threshold = config.threshold || 0.05;
            if (Math.abs(dx) > threshold || Math.abs(config.velocity) > threshold) {
                allFinished = false;
            } else {
                // Snap to final value
                target[prop] = targetValue;
                config.velocity = 0;
            }
        }
        
        return allFinished;
    }
    
    addAnimation(id, config) {
        // Normalize properties to the expected format
        const normalizedProperties = {};
        for (const [prop, value] of Object.entries(config.properties)) {
            normalizedProperties[prop] = {
                target: Array.isArray(value) ? [...value] : value,
                velocity: 0,
                threshold: config.threshold || 0.05
            };
        }
        
        this.animations.set(id, {
            target: config.target,
            properties: normalizedProperties,
            spring: config.spring || {
                k: CONFIG.ALIGNMENT.SPRING_K,
                d: CONFIG.ALIGNMENT.SPRING_D
            },
            onComplete: config.onComplete
        });
    }
    
    removeAnimation(id) {
        this.animations.delete(id);
    }
    
    hasAnimation(id) {
        return this.animations.has(id);
    }
    
    clear() {
        this.animations.clear();
    }
    
    // Helper methods for common animation types
    animateToPosition(target, newPos, onComplete) {
        const id = `pos_${target.id || Math.random()}`;
        this.addAnimation(id, {
            target,
            properties: {
                'pos[0]': newPos[0],
                'pos[1]': newPos[1]
            },
            onComplete
        });
        return id;
    }
    
    animateToSize(target, newSize, onComplete) {
        const id = `size_${target.id || Math.random()}`;
        this.addAnimation(id, {
            target,
            properties: {
                'size[0]': newSize[0],
                'size[1]': newSize[1]
            },
            onComplete
        });
        return id;
    }
    
    animateRotation(target, newRotation, onComplete) {
        const id = `rot_${target.id || Math.random()}`;
        this.addAnimation(id, {
            target,
            properties: {
                rotation: newRotation
            },
            onComplete
        });
        return id;
    }
}

// ===================================
// ALIGNMENT ANIMATION HELPERS
// ===================================

class AlignmentAnimator {
    constructor(animationSystem) {
        this.animationSystem = animationSystem;
        this.activeAlignments = new Set();
    }
    
    alignNodes(nodes, axis, spacing = CONFIG.ALIGNMENT.DEFAULT_MARGIN) {
        const alignmentId = `align_${Date.now()}`;
        this.activeAlignments.add(alignmentId);
        
        // Calculate target positions
        const targets = this.calculateAlignmentTargets(nodes, axis, spacing);
        
        // Animate each node to its target position
        const animationPromises = [];
        
        for (const node of nodes) {
            const target = targets.get(node.id);
            if (target) {
                const animId = this.animationSystem.animateToPosition(
                    node,
                    target,
                    () => {
                        // Individual animation completed
                    }
                );
                animationPromises.push(animId);
            }
        }
        
        // Clean up when all animations complete
        Promise.all(animationPromises).then(() => {
            this.activeAlignments.delete(alignmentId);
        });
        
        return alignmentId;
    }
    
    calculateAlignmentTargets(nodes, axis, spacing) {
        const targets = new Map();
        
        if (nodes.length === 0) return targets;
        
        // Sort nodes by current position on the alignment axis
        const sortedNodes = [...nodes].sort((a, b) => {
            return axis === 'horizontal' ? a.pos[0] - b.pos[0] : a.pos[1] - b.pos[1];
        });
        
        // Calculate center line
        let centerSum = 0;
        for (const node of nodes) {
            centerSum += axis === 'horizontal' ? 
                (node.pos[1] + node.size[1] / 2) : 
                (node.pos[0] + node.size[0] / 2);
        }
        const centerLine = centerSum / nodes.length;
        
        // Calculate total length needed
        const totalSize = sortedNodes.reduce((sum, node) => {
            return sum + (axis === 'horizontal' ? node.size[0] : node.size[1]);
        }, 0);
        const totalSpacing = (sortedNodes.length - 1) * spacing;
        const totalLength = totalSize + totalSpacing;
        
        // Find the center of the current arrangement
        const bounds = this.getNodesBounds(nodes);
        const arrangementCenter = axis === 'horizontal' ? 
            (bounds.minX + bounds.maxX) / 2 : 
            (bounds.minY + bounds.maxY) / 2;
        
        // Calculate starting position
        let currentPos = arrangementCenter - totalLength / 2;
        
        // Assign target positions
        for (const node of sortedNodes) {
            if (axis === 'horizontal') {
                targets.set(node.id, [currentPos, centerLine - node.size[1] / 2]);
                currentPos += node.size[0] + spacing;
            } else {
                targets.set(node.id, [centerLine - node.size[0] / 2, currentPos]);
                currentPos += node.size[1] + spacing;
            }
        }
        
        return targets;
    }
    
    getNodesBounds(nodes) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const node of nodes) {
            minX = Math.min(minX, node.pos[0]);
            minY = Math.min(minY, node.pos[1]);
            maxX = Math.max(maxX, node.pos[0] + node.size[0]);
            maxY = Math.max(maxY, node.pos[1] + node.size[1]);
        }
        
        return { minX, minY, maxX, maxY };
    }
    
    isAligning() {
        return this.activeAlignments.size > 0;
    }
    
    stopAllAlignments() {
        for (const alignmentId of this.activeAlignments) {
            // Stop individual animations if needed
        }
        this.activeAlignments.clear();
    }
}