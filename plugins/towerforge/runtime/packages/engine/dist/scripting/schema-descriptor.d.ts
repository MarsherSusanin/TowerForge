export declare const TOWER_SCRIPT_SCOPES: readonly ("global" | "mission" | "map" | "wave" | "tower" | "enemy" | "ability" | "terrain")[];
export declare const TOWER_SCRIPT_EVENTS: readonly ("gameStarted" | "tick" | "towerPlaced" | "towerSold" | "towerMoved" | "towerUpgraded" | "towerDestroyed" | "towerTargetModeChanged" | "towerFired" | "towerResourcesGranted" | "enemyHit" | "enemyKilled" | "enemyLeaked" | "enemySpawnedOnDeath" | "enemyPhaseSpawned" | "waveStarted" | "waveCleared" | "resourcesGranted" | "abilityUsed" | "enemyEnteredTile" | "terrainChanged" | "objectiveCompleted" | "objectiveFailed" | "starEarned" | "victory" | "defeat" | "signal")[];
export declare const TOWER_SCRIPT_OPERATORS: readonly ("eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "and" | "or" | "not" | "add" | "sub" | "mul" | "div" | "min" | "max" | "coalesce")[];
export declare const TOWER_SCRIPT_TARGETS: Readonly<{
    entity: ("self" | "eventEnemy" | "eventTower" | "allEnemies" | "allTowers")[];
    enemy: ("self" | "eventEnemy" | "allEnemies")[];
    tower: ("self" | "eventTower" | "allTowers")[];
}>;
export declare const TOWER_SCRIPT_ACTION_SCHEMA: Readonly<{
    grantResource: {
        required: {
            resourceId: string;
            amount: string;
        };
    };
    damageCore: {
        required: {
            amount: string;
        };
    };
    healCore: {
        required: {
            amount: string;
        };
    };
    damageEnemy: {
        required: {
            target: string;
            amount: string;
        };
    };
    healEnemy: {
        required: {
            target: string;
            amount: string;
        };
    };
    applyStatus: {
        required: {
            target: string;
            status: string;
        };
    };
    setTowerCooldown: {
        required: {
            target: string;
            value: string;
        };
    };
    addTowerStacks: {
        required: {
            target: string;
            amount: string;
        };
    };
    spawnEnemy: {
        required: {
            enemyTypeId: string;
        };
        optional: {
            count: string;
            routeId: string;
            pathProgress: string;
        };
    };
    setTileTerrain: {
        required: {
            target: string;
            terrainId: string;
        };
        optional: {
            duration: string;
        };
    };
    restoreTileTerrain: {
        required: {
            target: string;
        };
    };
    setState: {
        required: {
            key: string;
            value: string;
        };
    };
    incrementState: {
        required: {
            key: string;
        };
        optional: {
            amount: string;
        };
    };
    emitSignal: {
        required: {
            signal: string;
        };
        optional: {
            payload: string;
        };
    };
}>;
export declare const TOWER_SCRIPT_EVENT_FIELDS: Readonly<{
    gameStarted: string[];
    tick: string[];
    towerPlaced: string[];
    towerSold: string[];
    towerMoved: string[];
    towerUpgraded: string[];
    towerDestroyed: string[];
    towerTargetModeChanged: string[];
    towerFired: string[];
    towerResourcesGranted: string[];
    enemyHit: string[];
    enemyKilled: string[];
    enemyLeaked: string[];
    enemySpawnedOnDeath: string[];
    enemyPhaseSpawned: string[];
    waveStarted: string[];
    waveCleared: string[];
    resourcesGranted: string[];
    abilityUsed: string[];
    enemyEnteredTile: string[];
    terrainChanged: string[];
    objectiveCompleted: string[];
    objectiveFailed: string[];
    starEarned: string[];
    victory: string[];
    defeat: string[];
    signal: string[];
}>;
export declare const TOWER_SCRIPT_LIMITS: Readonly<{
    scriptsPerProject: 128;
    initialStateBytes: 16384;
    handlersPerEvent: 64;
    actionsPerHandler: 64;
    expressionDepth: 12;
    expressionOperationsPerHandler: 512;
    actionsPerTransaction: 512;
    eventsPerTransaction: 512;
    signalRecursionDepth: 8;
    spawnedEnemiesPerAction: 32;
    terrainChangesPerTransaction: 64;
    activeTerrainOverrides: 512;
    stateBytesPerBinding: 65536;
    externalSignalPayloadBytes: 65536;
    retainedDiagnostics: 32;
}>;
export declare const TOWER_SCRIPT_SCHEMA: Readonly<{
    schemaVersion: 2;
    filePattern: "scripts/**/*.tower.json";
    semantics: "Deterministic JSON rules interpreted by the engine; never executable host code.";
    bindingRules: {
        global: string;
        otherScopes: string;
    };
    scopes: readonly ("global" | "mission" | "map" | "wave" | "tower" | "enemy" | "ability" | "terrain")[];
    events: readonly ("gameStarted" | "tick" | "towerPlaced" | "towerSold" | "towerMoved" | "towerUpgraded" | "towerDestroyed" | "towerTargetModeChanged" | "towerFired" | "towerResourcesGranted" | "enemyHit" | "enemyKilled" | "enemyLeaked" | "enemySpawnedOnDeath" | "enemyPhaseSpawned" | "waveStarted" | "waveCleared" | "resourcesGranted" | "abilityUsed" | "enemyEnteredTile" | "terrainChanged" | "objectiveCompleted" | "objectiveFailed" | "starEarned" | "victory" | "defeat" | "signal")[];
    eventFields: Readonly<{
        gameStarted: string[];
        tick: string[];
        towerPlaced: string[];
        towerSold: string[];
        towerMoved: string[];
        towerUpgraded: string[];
        towerDestroyed: string[];
        towerTargetModeChanged: string[];
        towerFired: string[];
        towerResourcesGranted: string[];
        enemyHit: string[];
        enemyKilled: string[];
        enemyLeaked: string[];
        enemySpawnedOnDeath: string[];
        enemyPhaseSpawned: string[];
        waveStarted: string[];
        waveCleared: string[];
        resourcesGranted: string[];
        abilityUsed: string[];
        enemyEnteredTile: string[];
        terrainChanged: string[];
        objectiveCompleted: string[];
        objectiveFailed: string[];
        starEarned: string[];
        victory: string[];
        defeat: string[];
        signal: string[];
    }>;
    expression: {
        literals: string;
        get: {
            $get: string;
        };
        operator: {
            $op: string;
            args: string;
        };
        operators: readonly ("eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "and" | "or" | "not" | "add" | "sub" | "mul" | "div" | "min" | "max" | "coalesce")[];
        contextRoots: string[];
        gameFields: string[];
    };
    targets: Readonly<{
        entity: ("self" | "eventEnemy" | "eventTower" | "allEnemies" | "allTowers")[];
        enemy: ("self" | "eventEnemy" | "allEnemies")[];
        tower: ("self" | "eventTower" | "allTowers")[];
    }>;
    actions: Readonly<{
        grantResource: {
            required: {
                resourceId: string;
                amount: string;
            };
        };
        damageCore: {
            required: {
                amount: string;
            };
        };
        healCore: {
            required: {
                amount: string;
            };
        };
        damageEnemy: {
            required: {
                target: string;
                amount: string;
            };
        };
        healEnemy: {
            required: {
                target: string;
                amount: string;
            };
        };
        applyStatus: {
            required: {
                target: string;
                status: string;
            };
        };
        setTowerCooldown: {
            required: {
                target: string;
                value: string;
            };
        };
        addTowerStacks: {
            required: {
                target: string;
                amount: string;
            };
        };
        spawnEnemy: {
            required: {
                enemyTypeId: string;
            };
            optional: {
                count: string;
                routeId: string;
                pathProgress: string;
            };
        };
        setTileTerrain: {
            required: {
                target: string;
                terrainId: string;
            };
            optional: {
                duration: string;
            };
        };
        restoreTileTerrain: {
            required: {
                target: string;
            };
        };
        setState: {
            required: {
                key: string;
                value: string;
            };
        };
        incrementState: {
            required: {
                key: string;
            };
            optional: {
                amount: string;
            };
        };
        emitSignal: {
            required: {
                signal: string;
            };
            optional: {
                payload: string;
            };
        };
    }>;
    limits: Readonly<{
        scriptsPerProject: 128;
        initialStateBytes: 16384;
        handlersPerEvent: 64;
        actionsPerHandler: 64;
        expressionDepth: 12;
        expressionOperationsPerHandler: 512;
        actionsPerTransaction: 512;
        eventsPerTransaction: 512;
        signalRecursionDepth: 8;
        spawnedEnemiesPerAction: 32;
        terrainChangesPerTransaction: 64;
        activeTerrainOverrides: 512;
        stateBytesPerBinding: 65536;
        externalSignalPayloadBytes: 65536;
        retainedDiagnostics: 32;
    }>;
    example: {
        schemaVersion: number;
        id: string;
        bindings: {
            scope: string;
        }[];
        handlers: {
            enemyKilled: {
                actions: {
                    action: string;
                    resourceId: string;
                    amount: number;
                }[];
            }[];
        };
    };
}>;
