// ===================================
// ANIMATION SYSTEM
// ===================================

class AnimationSystem {
    constructor() {
        this.animations = new Map();
        this.running = false;
        this.lastTime = 0;
        this.enabled = true; // Global animation control
        
        // Fixed timestep simulation for stable spring physics
        this.fixedTimestep = 1/60;  // 60Hz physics (16.67ms) - 2x faster than 120Hz
        this.accumulator = 0;
        this.maxSubsteps = 4;  // Prevent spiral of death
        this.timeScale = CONFIG.ALIGNMENT.TIME_SCALE || 1.0;  // Time scaling factor from config
        
        // Listen for user preference changes
        this.setupPreferenceListener();
    }
    
    start() {
        this.running = true;
    }
    
    stop() {
        this.running = false;
    }
    
    /**
     * Setup listener for user preference changes
     */
    setupPreferenceListener() {
        // Check for user profile system and listen for preference changes
        if (window.app?.userProfileSystem) {
            window.app.userProfileSystem.addListener('preferenceChanged', (data) => {
                if (data.key === 'enableAnimations') {
                    this.enabled = data.value;
                    
                }
            });
            
            // Set initial state from user preferences
            const enableAnimations = window.app.userProfileSystem.getPreference('enableAnimations', true);
            this.enabled = enableAnimations;
        }
    }
    
    // Called by main render loop with deltaTime
    updateAnimations(deltaTime) {
        if (!this.running || !this.enabled) return false;
        
        // Convert deltaTime to seconds and cap for extreme cases
        const frameDeltaTime = Math.min(deltaTime / 1000, 0.1); // Cap at 100ms
        
        // Accumulate time for fixed timestep simulation with time scaling
        this.accumulator += frameDeltaTime * this.timeScale;
        
        // Clamp accumulator to prevent spiral of death
        const maxAccumulator = this.fixedTimestep * this.maxSubsteps;
        if (this.accumulator > maxAccumulator) {
            this.accumulator = maxAccumulator;
        }
        
        const toRemove = [];
        let hasActiveAnimations = this.animations.size > 0;
        
        // Run physics simulation with fixed timestep
        let substeps = 0;
        while (this.accumulator >= this.fixedTimestep && substeps < this.maxSubsteps) {
            // Update all animations with fixed timestep
            for (const [id, animation] of this.animations) {
                const finished = this.updateAnimation(animation, this.fixedTimestep);
                if (finished && !toRemove.includes(id)) {
                    toRemove.push(id);
                }
            }
            
            this.accumulator -= this.fixedTimestep;
            substeps++;
        }
        
        // Apply interpolation for remaining time if needed
        if (this.accumulator > 0 && this.fixedTimestep > 0) {
            const alpha = this.accumulator / this.fixedTimestep;
            this.interpolateAnimations(alpha);
        }
        
        // Remove finished animations and call their callbacks
        for (const id of toRemove) {
            const animation = this.animations.get(id);
            if (animation && animation.onComplete) {
                animation.onComplete();
            }
            this.animations.delete(id);
        }
        
        // Return true if there are still active animations (need continued updates)
        return hasActiveAnimations && this.animations.size > 0;
    }
    
    interpolateAnimations(alpha) {
        for (const [id, animation] of this.animations) {
            const { target, properties } = animation;
            
            for (const [prop, config] of Object.entries(properties)) {
                if (config.previousValue !== undefined && config.currentValue !== undefined) {
                    // Linear interpolation for smooth visuals
                    target[prop] = config.previousValue + (config.currentValue - config.previousValue) * alpha;
                }
            }
        }
    }
    
    updateAnimation(animation, deltaTimeSeconds) {
        const { target, properties, spring } = animation;
        let allFinished = true;
        
        for (const [prop, config] of Object.entries(properties)) {
            // Store previous value for interpolation
            config.previousValue = config.currentValue !== undefined ? config.currentValue : target[prop];
            
            const current = config.currentValue !== undefined ? config.currentValue : target[prop];
            const targetValue = config.target;
            const velocity = config.velocity || 0;
            
            const dx = targetValue - current;
            const acceleration = spring.k * dx - spring.d * velocity;
            
            // All calculations now use seconds directly
            config.velocity = velocity + acceleration * deltaTimeSeconds;
            const newValue = current + config.velocity * deltaTimeSeconds;
            
            // Store the physics-calculated value
            config.currentValue = newValue;
            
            // Update the actual target property (will be overwritten by interpolation if needed)
            target[prop] = newValue;
            
            const threshold = config.threshold || 0.05;
            if (Math.abs(dx) > threshold || Math.abs(config.velocity) > threshold) {
                allFinished = false;
            } else {
                // Snap to final value
                config.currentValue = targetValue;
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

// Make AnimationSystem and AlignmentAnimator available globally
if (typeof window !== 'undefined') {
    window.AnimationSystem = AnimationSystem;
    window.AlignmentAnimator = AlignmentAnimator;
}