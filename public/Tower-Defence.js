window.addEventListener('keydown', function(e) {
    const tag = document.activeElement.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        e.stopPropagation();
    }
});


// =========================
// Global Variables
// =========================
let playerName = "";
let lastPlayerPosition = { x: 0, y: 10, z: 0 };
const saved = localStorage.getItem("playerPos");
if (saved) lastPlayerPosition = JSON.parse(saved);
let start = true;
let wsProtocol;
let socket;
let playerId;
const INVENTORY_SIZE = 5;
let inventory = Array(INVENTORY_SIZE).fill(null);
let selectedSlot = 0;
let pickableItems = [];
const KEYS = {
    PICKUP: 'e',
};
// =========================
// Initialization
// =========================
window.addEventListener("DOMContentLoaded", () => {
    playerName = localStorage.getItem("playerName") || "";

    if (!playerName) {
        playerName = prompt("Enter your player name:");
        if (!playerName) playerName = "Player"; // fallback
        localStorage.setItem("playerName", playerName);
    }
    wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${wsProtocol}://${window.location.hostname}:51115`);

    socket.onopen = () => {
        socket.send(JSON.stringify({
            type: "setName",
            name: playerName,
            position: lastPlayerPosition
        }));
    };

    socket.onmessage = event => {
        const data = JSON.parse(event.data);

        if (data.type === "error") {
            alert(data.message);
            socket.close();
            return;
        }

        if (data.type === "init") {
            createScene().then((scene) => {
                engine.runRenderLoop(() => scene.render());
            });
            window.addEventListener("resize", () => engine.resize());
        }
    };


});

// =========================
// Settings
// =========================
const SETTINGS = {
    gravity: -0.981,
    jumpForce: 0.3,
    moveSpeed: 8,
    sprintSpeed: 16,
    turnSpeed: 8,
    boxPushMoveSpeed: 0.7,
    boxPushTurnSpeed: 0.7,
    capsule: {
        height: 2,
        radius: 0.5,
        ellipsoid: new BABYLON.Vector3(0.5, 2, 0.5),
        ellipsoidOffset: new BABYLON.Vector3(0, 1, 0)
    },
    groundSize: 100,
    camera: {
        lowerRadiusLimit: 2,
        upperRadiusLimit: 10,
        fov: BABYLON.Tools.ToRadians(70),
        collisionOffsetY: 1.7,
        collisionSmoothing: 0.2,
        collisionReturnSpeed: 0.1,
        collisionOffset: 0.3
    },
    interactionDistance: 3,
    pickUpDistance: 5,
};



// =========================
// Scene Setup
// =========================
const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true);

function setupPointerLock(canvas) {
    canvas.addEventListener('click', function () {
        canvas.requestPointerLock = canvas.requestPointerLock ||
            canvas.mozRequestPointerLock ||
            canvas.webkitRequestPointerLock;
        if (canvas.requestPointerLock) {
            canvas.requestPointerLock();
        }
    });

    document.addEventListener('pointerlockchange', lockChangeAlert, false);
    document.addEventListener('mozpointerlockchange', lockChangeAlert, false);
    document.addEventListener('webkitpointerlockchange', lockChangeAlert, false);

    function lockChangeAlert() {
        if (document.pointerLockElement === canvas ||
            document.mozPointerLockElement === canvas ||
            document.webkitPointerLockElement === canvas) {
            console.log('Pointer locked');
        } else {
            console.log('Pointer unlocked');
        }
    }
}

setupPointerLock(canvas);

// =========================
// Main Scene Creation
// =========================
let previousTime = performance.now();

const createScene = async () => {
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color3(0.1, 0.1, 0.1);

    const havokInstance = await HavokPhysics();
    const havokPlugin = new BABYLON.HavokPlugin(true, havokInstance);
    scene.enablePhysics(new BABYLON.Vector3(0, SETTINGS.gravity, 0), havokPlugin);

    scene.gravity = new BABYLON.Vector3(0, SETTINGS.gravity, 0);
    scene.collisionsEnabled = true;

    // =========================
    // Lighting and Environment
    // =========================
    const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
    light.intensity = 0.9;

    const ground = BABYLON.MeshBuilder.CreateGround("ground", {
        width: SETTINGS.groundSize,
        height: SETTINGS.groundSize
    }, scene);
    ground.checkCollisions = true;

    const groundMaterial = new BABYLON.StandardMaterial("groundMat", scene);
    groundMaterial.diffuseTexture = new BABYLON.Texture("assets/texture_01.png", scene);
    groundMaterial.diffuseTexture.uScale = 10;
    groundMaterial.diffuseTexture.vScale = 10;
    groundMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
    ground.receiveShadows = true;
    ground.material = groundMaterial;
    ground.collisionGroup = 1;
    ground.collisionMask = -1; // Collide with everything


    var wall = BABYLON.MeshBuilder.CreateBox("wall", {size: 2}, scene);
    wall.position.y = 1;
    var wallAggregate = new BABYLON.PhysicsAggregate(wall, BABYLON.PhysicsShapeType.BOX, { mass: 0, restitution:0.0}, scene);
    const wallMaterial = new BABYLON.StandardMaterial("wall");
    wallMaterial.diffuseTexture = new BABYLON.Texture("https://raw.githubusercontent.com/CedricGuillemet/dump/master/Wall_1mx1m.png");
    wall.material = wallMaterial;

    // =========================
    // Player Setup
    // =========================
    const capsule = BABYLON.MeshBuilder.CreateCapsule("capsule", {
        height: SETTINGS.capsule.height,
        radius: SETTINGS.capsule.radius
    }, scene);
    capsule.position.x = lastPlayerPosition.x;
    capsule.position.y = lastPlayerPosition.y;
    capsule.position.z = lastPlayerPosition.z;
    capsule.checkCollisions = true;
    capsule.applyGravity = true;
    capsule.ellipsoid = SETTINGS.capsule.ellipsoid;
    capsule.ellipsoidOffset = SETTINGS.capsule.ellipsoidOffset;
    capsule.collisionGroup = 2;
    capsule.collisionMask = -1;

    initInventorySystem()

    function saveCurrentPosition() {
        localStorage.setItem("playerPos", JSON.stringify({
            x: capsule.position.x,
            y: capsule.position.y,
            z: capsule.position.z
        }));
    }


    scene.onBeforeRenderObservable.add(() => {
        if (capsule.position.y < -50) {
            capsule.position.set(0, 10, 0);
            capsule.physicsImpostor?.setLinearVelocity(new BABYLON.Vector3(0, 0, 0));
        }
    });

    // =========================
    // Crouching State Variables
    // =========================
    let isCrouching = false;
    let crouchKeyHeld = false;

    const CROUCH_HEIGHT = 1.1;
    const CROUCH_ELLI = new BABYLON.Vector3(0.5, 0.55, 0.5);
    const CROUCH_OFFSET = new BABYLON.Vector3(0, 0, 0);
    let originalHeight = SETTINGS.capsule.height;
    let originalEllipsoid = SETTINGS.capsule.ellipsoid.clone();
    let originalOffset = SETTINGS.capsule.ellipsoidOffset.clone();

    window.addEventListener('keydown', (e) => {
        if ((e.key === 'Control' || e.key.toLowerCase() === 'c') && !isCrouching && playerState.canCrouch) {
            crouch(true);

        }
    });
    window.addEventListener('keyup', (e) => {
        if ((e.key === 'Control' || e.key.toLowerCase() === 'c') && isCrouching) {
            crouch(false);

        }
    });

    window.addEventListener('keydown', (e) => {
        if ((e.key === 'Control' || e.key.toLowerCase() === 'c')) {
            crouchKeyHeld = true;
        }
    });
    window.addEventListener('keyup', (e) => {
        if ((e.key === 'Control' || e.key.toLowerCase() === 'c')) {
            crouchKeyHeld = false;
        }
    });

    let playerFeetY = null;

    function getFeetY() {
        return capsule.position.y - (capsule.scaling.y * originalHeight) / 2 + capsule.ellipsoidOffset.y;
    }

    function setFeetY(targetFeetY, capsuleHeight) {
        capsule.position.y = targetFeetY + (capsuleHeight) / 2 - capsule.ellipsoidOffset.y;
    }

    function crouch(enable) {
        if (!capsule) return;
        if (enable && !isCrouching) {
            isCrouching = true;
            playerFeetY = getFeetY();
            capsule.scaling.y = CROUCH_HEIGHT / originalHeight;
            capsule.ellipsoid = CROUCH_ELLI;
            capsule.ellipsoidOffset = CROUCH_OFFSET;
            setFeetY(playerFeetY, CROUCH_HEIGHT);
        } else if (!enable && isCrouching) {
            const headOffsetY = (CROUCH_HEIGHT / 2) - CROUCH_OFFSET.y;
            const uncrouchedHeadOffsetY = (originalHeight / 2) - originalOffset.y;
            const uncrouchedRadius = originalEllipsoid.x;

            const directions = [
                new BABYLON.Vector3(0, 0, 0),
                new BABYLON.Vector3(uncrouchedRadius * 0.85, 0, 0),
                new BABYLON.Vector3(-uncrouchedRadius * 0.85, 0, 0),
                new BABYLON.Vector3(0, 0, uncrouchedRadius * 0.85),
                new BABYLON.Vector3(0, 0, -uncrouchedRadius * 0.85),
            ];
            const crouchedTop = capsule.position.clone();
            crouchedTop.y += headOffsetY;

            const rayHeight = originalHeight - CROUCH_HEIGHT + 0.15;
            let blocked = false;

            for (let offset of directions) {
                const origin = crouchedTop.add(offset);
                const ray = new BABYLON.Ray(origin, new BABYLON.Vector3(0, 2, 0), rayHeight);
                const pick = scene.pickWithRay(ray, (mesh) => mesh !== capsule && mesh.checkCollisions, true);
                if (pick && pick.hit) {
                    blocked = true;
                    break;
                }
            }
            if (blocked) return;

            isCrouching = false;
            capsule.scaling.y = 1;
            capsule.ellipsoid = originalEllipsoid.clone();
            capsule.ellipsoidOffset = originalOffset.clone();
            setFeetY(playerFeetY, originalHeight);
            playerFeetY = null;
        }
    }


    originalHeight = SETTINGS.capsule.height;
    originalEllipsoid = SETTINGS.capsule.ellipsoid.clone();
    originalOffset = SETTINGS.capsule.ellipsoidOffset.clone();
    const lowBox = BABYLON.MeshBuilder.CreateBox("lowBox", {
        width: 2,
        depth: 2,
        height: 1.2
    }, scene);
    lowBox.position.set(5, 2, 0);
    lowBox.checkCollisions = true;
    const boxMat = new BABYLON.StandardMaterial("lowBoxMat", scene);
    boxMat.diffuseColor = BABYLON.Color3.FromHexString("#8FF");
    lowBox.material = boxMat;

    // =========================
    // Event Handlers
    // =========================
    window.addEventListener('beforeunload', function() {
        if (socket.readyState === WebSocket.OPEN) {
            socket.close();
        }
    });

    window.addEventListener("beforeunload", saveCurrentPosition);

    // =========================
    // Networking Functions
    // =========================


    const otherPlayers = {};

    socket.onmessage = event => {
        const msg = JSON.parse(event.data);

        if (msg.type === "error") {
            alert(msg.message);
            socket.close();
            return;
        }

        if (msg.type === "init") {
            playerId = msg.id;
            start = false;
            for (const id in msg.players) {
                if (id !== playerId) createOtherPlayer(id, msg.players[id]);
            }
        } else if (msg.type === "update") {
            if (!otherPlayers[msg.id]) {
                createOtherPlayer(msg.id, { ...msg.position, name: msg.name });
            } else {
                otherPlayers[msg.id].position = BABYLON.Vector3.Lerp(
                    otherPlayers[msg.id].position,
                    new BABYLON.Vector3(msg.position.x, msg.position.y, msg.position.z),
                    0.2
                );
                if (otherPlayers[msg.id].nameLabel && msg.name) {
                    otherPlayers[msg.id].nameLabel.children[0].text = msg.name;
                }
            }
        } else if (msg.type === "disconnect") {
            if (otherPlayers[msg.id]) {
                if (otherPlayers[msg.id].nameLabel) {
                    advancedTexture.removeControl(otherPlayers[msg.id].nameLabel);
                }
                otherPlayers[msg.id].dispose();
                delete otherPlayers[msg.id];
            }
        }
    };

    // =========================
    // UI Elements
    // =========================
    const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("playerUI");

    scene.onBeforeRenderObservable.add(() => {
        for (const id in otherPlayers) {
            const mesh = otherPlayers[id];
            if (mesh.nameLabel) {
                const pos = BABYLON.Vector3.Project(
                    mesh.position.add(new BABYLON.Vector3(0, 2.5, 0)),
                    BABYLON.Matrix.Identity(),
                    scene.getTransformMatrix(),
                    camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
                );
                mesh.nameLabel.leftInPixels = pos.x - engine.getRenderWidth() / 2 - 50;
                mesh.nameLabel.topInPixels  = pos.y - engine.getRenderHeight() / 2 - 15;
                mesh.nameLabel.isVisible = true;
            }
        }
    });

    // =========================
    // Player Management
    // =========================
    function createOtherPlayer(id, data) {
        const mesh = BABYLON.MeshBuilder.CreateCapsule(`player_${id}`, { height: 2, radius: 0.5 }, scene);
        mesh.position = new BABYLON.Vector3(data.x, data.y, data.z);
        mesh.checkCollisions = true;
        mesh.applyGravity = true;
        mesh.ellipsoid = SETTINGS.capsule.ellipsoid;
        mesh.ellipsoidOffset = SETTINGS.capsule.ellipsoidOffset;

        let nameLabel = null;
        if (data.name && data.name !== playerName) {
            nameLabel = new BABYLON.GUI.Rectangle();
            nameLabel.width = "100px";
            nameLabel.height = "30px";
            nameLabel.background = "black";
            nameLabel.alpha = 0.5;
            nameLabel.thickness = 0;
            const textBlock = new BABYLON.GUI.TextBlock();
            textBlock.text = data.name;
            textBlock.color = "white";
            nameLabel.addControl(textBlock);
            advancedTexture.addControl(nameLabel);
        }
        mesh.nameLabel = nameLabel;
        otherPlayers[id] = mesh;
    }

    // =========================
    // Camera Setup
    // =========================
    const forwardIndicator = BABYLON.MeshBuilder.CreateBox("forward", {size: 0.2}, scene);
    forwardIndicator.material = new BABYLON.StandardMaterial("redMat", scene);
    forwardIndicator.material.diffuseColor = BABYLON.Color3.Red();
    forwardIndicator.parent = capsule;
    forwardIndicator.position.z = 1;

    const camera = new BABYLON.ArcRotateCamera("arcCam", Math.PI / 2, Math.PI / 2.5, 6, capsule.position, scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = SETTINGS.camera.lowerRadiusLimit;
    camera.upperRadiusLimit = SETTINGS.camera.upperRadiusLimit;
    camera.fov = SETTINGS.camera.fov;
    camera.wheelDeltaPercentage = 0;
    camera.panningSensibility = 0;



    // =========================
    // Input Handling
    // =========================
    const inputMap = {};
    scene.actionManager = new BABYLON.ActionManager(scene);
    scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyDownTrigger, evt => {
        inputMap[evt.sourceEvent.key.toLowerCase()] = true;
        if (evt.sourceEvent.key === 'Shift') {
            inputMap['shift'] = true;
        }
    }));
    scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyUpTrigger, evt => {
        inputMap[evt.sourceEvent.key.toLowerCase()] = false;
        if (evt.sourceEvent.key === 'Shift') {
            inputMap['shift'] = false;
        }
    }));


    async function createTestItem(x, y, z, itemType = 'health', color = BABYLON.Color3.Red(), modelPath = null) {
        let item;

        if (modelPath) {
            const result = await BABYLON.SceneLoader.ImportMeshAsync(null, "", modelPath, scene);
            item = result.meshes[0];
            item.position = new BABYLON.Vector3(x, y, z);
            item.scaling = new BABYLON.Vector3(0.5, 0.5, 0.5);
        } else {
            item = BABYLON.MeshBuilder.CreateBox('item', {size: 0.5}, scene);
            item.position = new BABYLON.Vector3(x, y, z);
            const mat = new BABYLON.StandardMaterial('itemMat', scene);
            mat.diffuseColor = color;
            item.material = mat;
        }

        item.checkCollisions = false;
        return makePickable(item, itemType, { modelType: modelPath ? 'glb' : 'box', modelPath });
    }

    function findSafeDropPosition(mesh, position) {
        const directions = [
            new BABYLON.Vector3(1, 0, 0),   // Right
            new BABYLON.Vector3(-1, 0, 0),  // Left
            new BABYLON.Vector3(0, 1, 0),   // Up
            new BABYLON.Vector3(0, -1, 0),  // Down
            new BABYLON.Vector3(0, 0, 1),   // Forward
            new BABYLON.Vector3(0, 0, -1)   // Backward
        ];

        const rayLength = 100;
        const rayHelper = new BABYLON.Ray(position, new BABYLON.Vector3(0, -1, 0), rayLength);

        const checkCollision = (pos) => {
            const radius = Math.max(
                mesh.getBoundingInfo().boundingBox.extendSize.x * mesh.scaling.x,
                mesh.getBoundingInfo().boundingBox.extendSize.y * mesh.scaling.y,
                mesh.getBoundingInfo().boundingBox.extendSize.z * mesh.scaling.z
            );

            for (const dir of directions) {
                const ray = new BABYLON.Ray(pos, dir, radius * 2);
                const hit = scene.pickWithRay(ray, (m) => m !== mesh && m.isPickable && m.isEnabled());
                if (hit.hit && hit.distance < radius * 0.5) {
                    return true;
                }
            }
            return false;
        };

        if (!checkCollision(position)) {
            return position.clone();
        }

        const step = 0.5;
        const maxAttempts = 10;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            for (const dir of directions) {
                for (let dist = 1; dist <= 3; dist++) {
                    const offset = dir.scale(step * dist * attempt);
                    const testPos = position.add(offset);

                    if (!checkCollision(testPos)) {
                        rayHelper.origin.copyFrom(testPos);
                        const hit = scene.pickWithRay(rayHelper, (m) => m.isPickable && m.isEnabled());
                        if (hit.hit) {
                            testPos.y = hit.pickedPoint.y + (mesh.getBoundingInfo().boundingBox.extendSize.y * mesh.scaling.y);
                            return testPos;
                        }
                    }
                }
            }
        }

        return position.clone();
    }

    function makePickable(mesh, itemType, itemData = {}) {
        if (!mesh) return null;

        if (!mesh.metadata) {
            mesh.metadata = {};
        }
        mesh.metadata.isPickupItem = true;
        mesh.metadata.itemType = itemType;
        mesh.metadata.itemData = itemData;
        mesh.metadata.velocityY = 0;
        mesh.metadata.isGrounded = false;
        mesh.metadata.gravity = -0.0005;
        mesh.metadata.groundHeight = null;

        const safePosition = findSafeDropPosition(mesh, mesh.position.clone());
        mesh.position.copyFrom(safePosition);

        if (!pickableItems.includes(mesh)) {
            pickableItems.push(mesh);
        }

        let lastUpdateTime = Date.now();
        const rayLength = 50;
        const ray = new BABYLON.Ray(mesh.position, new BABYLON.Vector3(0, -1, 0), rayLength);
        const predicate = function(meshToCheck) {
            return meshToCheck !== mesh && meshToCheck.isPickable && meshToCheck.isEnabled();
        };

        const animationId = scene.onBeforeRenderObservable.add(() => {
            if (mesh && mesh.metadata && mesh.metadata.isPickupItem) {
                mesh.rotation.y += 0.02;

                ray.origin.copyFrom(mesh.position);
                ray.origin.y += 0.1;
                const hit = scene.pickWithRay(ray, predicate);

                if (hit.pickedMesh) {
                    const groundY = hit.pickedPoint.y + (mesh.getBoundingInfo().boundingBox.extendSize.y * mesh.scaling.y);

                    if (!mesh.metadata.isGrounded) {
                        const now = Date.now();
                        const deltaTime = (now - lastUpdateTime) || 16;
                        lastUpdateTime = now;

                        mesh.metadata.velocityY += mesh.metadata.gravity * deltaTime;
                        mesh.position.y = Math.max(groundY, mesh.position.y + mesh.metadata.velocityY);

                        if (mesh.position.y <= groundY + 0.01) {
                            mesh.position.y = groundY;
                            mesh.metadata.isGrounded = true;
                            mesh.metadata.velocityY = 0;
                        }
                    } else {
                        mesh.position.y = groundY + Math.sin(engine.getDeltaTime() * 0.003) * 0.02;
                    }
                } else {
                    const now = Date.now();
                    const deltaTime = (now - lastUpdateTime) || 16;
                    lastUpdateTime = now;

                    mesh.metadata.velocityY += mesh.metadata.gravity * deltaTime;
                    mesh.position.y += mesh.metadata.velocityY;
                    mesh.metadata.isGrounded = false;
                }

                if (scene.pickWithRay(new BABYLON.Ray(mesh.position, new BABYLON.Vector3(0, 1, 0), 0.1),
                    (m) => m !== mesh && m.isPickable && m.isEnabled())?.hit) {
                    const safePos = findSafeDropPosition(mesh, mesh.position);
                    if (safePos) {
                        mesh.position.copyFrom(safePos);
                        mesh.metadata.velocityY = 0;
                    }
                }
            }
        });
        mesh.metadata.animationId = animationId;

        return mesh;
    }

    function createInventoryUI() {
        const hotbar = document.createElement('div');
        hotbar.id = 'hotbar';
        hotbar.style.position = 'fixed';
        hotbar.style.bottom = '20px';
        hotbar.style.left = '50%';
        hotbar.style.transform = 'translateX(-50%)';
        hotbar.style.display = 'flex';
        hotbar.style.gap = '5px';
        hotbar.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        hotbar.style.padding = '10px';
        hotbar.style.borderRadius = '5px';
        hotbar.style.zIndex = '1000';

        const prompt = document.createElement('div');
        prompt.id = 'pickup-prompt';
        prompt.style.position = 'fixed';
        prompt.style.bottom = '100px';
        prompt.style.left = '50%';
        prompt.style.transform = 'translateX(-50%)';
        prompt.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        prompt.style.color = 'white';
        prompt.style.padding = '10px 20px';
        prompt.style.borderRadius = '5px';
        prompt.style.display = 'none';
        prompt.style.zIndex = '1001';
        document.body.appendChild(prompt);

        for (let i = 0; i < INVENTORY_SIZE; i++) {
            const slot = document.createElement('div');
            slot.className = 'inventory-slot';
            slot.style.width = '50px';
            slot.style.height = '50px';
            slot.style.border = '2px solid #666';
            slot.style.borderRadius = '5px';
            slot.style.display = 'flex';
            slot.style.justifyContent = 'center';
            slot.style.alignItems = 'center';
            slot.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
            slot.style.cursor = 'pointer';

            slot.addEventListener('click', () => selectSlot(i));
            hotbar.appendChild(slot);
        }

        document.body.appendChild(hotbar);
        updateHotbar();
    }

    function updateHotbar() {
        const hotbar = document.getElementById('hotbar');
        if (!hotbar) return;

        const slots = hotbar.getElementsByClassName('inventory-slot');
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            slot.innerHTML = '';
            slot.style.borderColor = i === selectedSlot ? '#fff' : '#666';
            slot.style.backgroundColor = i === selectedSlot ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)';

            if (inventory[i]) {
                const item = inventory[i];
                const itemElement = document.createElement('div');
                itemElement.className = 'inventory-item';
                itemElement.style.width = '40px';
                itemElement.style.height = '40px';
                itemElement.style.borderRadius = '3px';
                itemElement.style.display = 'flex';
                itemElement.style.justifyContent = 'center';
                itemElement.style.alignItems = 'center';
                itemElement.style.fontWeight = 'bold';
                itemElement.style.color = '#000';

                switch(item.type) {
                    case 'health':
                        itemElement.style.backgroundColor = item.modelType === 'glb' ? '#ff9999' : '#ff0000';
                        itemElement.textContent = item.modelType === 'glb' ? '3D' : 'H';
                        break;
                    case 'ammo':
                        itemElement.style.backgroundColor = item.modelType === 'glb' ? '#ffff99' : '#ffff00';
                        itemElement.textContent = item.modelType === 'glb' ? '3D' : 'A';
                        break;
                    case 'weapon':
                        itemElement.style.backgroundColor = item.modelType === 'glb' ? '#99ff99' : '#00ff00';
                        itemElement.textContent = item.modelType === 'glb' ? '3D' : 'W';
                        break;
                    default:
                        itemElement.style.backgroundColor = '#ffffff';
                        itemElement.textContent = item.modelType === 'glb' ? '3D' : '?';
                }

                slot.appendChild(itemElement);
            }
        }
    }

    function selectSlot(slotIndex) {
        if (slotIndex >= 0 && slotIndex < INVENTORY_SIZE) {
            selectedSlot = slotIndex;
            updateHotbar();
        }
    }

    function addToInventory(itemType, itemData = {}) {
        const emptySlot = inventory.findIndex(slot => slot === null);
        if (emptySlot !== -1) {
            inventory[emptySlot] = { type: itemType, ...itemData };
            updateHotbar();
            return true;
        }
        return false;
    }

    function checkForPickups() {
        if (!camera || !capsule) return;

        let closestItem = null;
        let closestDistance = SETTINGS.pickUpDistance;

        for (let i = pickableItems.length - 1; i >= 0; i--) {
            const item = pickableItems[i];

            if (!item || !item.metadata || !item.metadata.isPickupItem) {
                if (item) {
                    const index = pickableItems.indexOf(item);
                    if (index > -1) {
                        pickableItems.splice(index, 1);
                    }
                }
                continue;
            }

            const distance = BABYLON.Vector3.Distance(capsule.position, item.position);
            if (distance < closestDistance) {
                closestItem = item;
                closestDistance = distance;
            }
        }

        const prompt = document.getElementById('pickup-prompt');
        if (closestItem && prompt) {
            prompt.style.display = 'block';
            prompt.textContent = `Press E to pick up ${closestItem.metadata.itemType}`;
        } else if (prompt) {
            prompt.style.display = 'none';
        }

        return closestItem;
    }

    function setupInventoryControls() {
        window.addEventListener('keydown', (e) => {
            const numKey = parseInt(e.key);
            if (!isNaN(numKey) && numKey >= 1 && numKey <= INVENTORY_SIZE) {
                selectSlot(numKey - 1);
                return;
            }

            if (e.key === 'Backspace' && inventory[selectedSlot]) {
                dropItem(selectedSlot);
                return;
            }

            if (e.key.toLowerCase() === KEYS.PICKUP) {
                const closestItem = checkForPickups();
                if (closestItem) {
                    if (addToInventory(closestItem.metadata.itemType, closestItem.metadata.itemData)) {
                        if (closestItem && !closestItem.isDisposed()) {
                            if (closestItem.metadata.animationId) {
                                scene.onBeforeRenderObservable.remove(closestItem.metadata.animationId);
                            }
                            closestItem.dispose();
                        }
                        const index = pickableItems.indexOf(closestItem);
                        if (index > -1) {
                            pickableItems.splice(index, 1);
                        }
                    }
                }
            }
            else if (e.key === 'e' && inventory[selectedSlot]) {
                dropItem(selectedSlot);
            }
        });
    }

    function dropItem(slotIndex) {
        const item = inventory[slotIndex];
        if (!item) return;

        const localForward = new BABYLON.Vector3(0, 0, 1);
        const rotationMatrix = BABYLON.Matrix.RotationYawPitchRoll(
            capsule.rotation.y,
            capsule.rotation.x,
            capsule.rotation.z
        );

        const worldForward = BABYLON.Vector3.TransformNormal(localForward, rotationMatrix);
        const dropOffset = 2;
        const dropPosition = capsule.position.add(worldForward.scale(dropOffset));
        dropPosition.y = capsule.position.y;

        createTestItem(
            dropPosition.x,
            dropPosition.y,
            dropPosition.z,
            item.type,
            new BABYLON.Color3(1, 1, 1),
            item.modelPath
        );
        inventory[slotIndex] = null;
        updateHotbar();
    }

    function initInventorySystem() {
        createInventoryUI();
        setupInventoryControls();

        scene.onBeforeRenderObservable.add(checkForPickups);

        createTestItem(5, 1, 0, 'health', BABYLON.Color3.Red());
        createTestItem(0, 1, 5, 'ammo', BABYLON.Color3.Yellow());
        createTestItem(-5, 1, 0, 'weapon', BABYLON.Color3.Green());
        createTestItem(5, 1, 0, 'weapon', null, 'assets/dummy.glb');
    }

    // =========================
    // Drawer Interaction
    // =========================
    async function createDrawer(scene, modelPath, position, interactionDistance = 3, movingOffset = new BABYLON.Vector3(0, 0, 0)) {
        const loadedModel = await BABYLON.SceneLoader.ImportMeshAsync(null, "", modelPath, scene);

        let stationaryPart, movingPart;
        loadedModel.meshes.forEach(mesh => {
            if (mesh.name.toLowerCase().includes("stationary")) {
                stationaryPart = mesh;
            } else if (mesh.name.toLowerCase().includes("moving")) {
                movingPart = mesh;
            }
        });

        if (!stationaryPart || !movingPart) {
            throw new Error("Model must contain 'stationary' and 'moving' parts in their names.");
        }

        stationaryPart.position = position.clone();
        movingPart.position = position.clone();

        const offsetPosition = position.clone();
        offsetPosition.x -= 3;

        stationaryPart.position = offsetPosition.clone();
        movingPart.position = offsetPosition.clone();

        movingPart.position = offsetPosition.add(movingOffset);

        let isDrawerOpen = false;
        const openPosition = movingPart.position.add(new BABYLON.Vector3(0, 0, 1));
        const closePosition = movingPart.position.clone();

        function toggleDrawer() {
            if (isDrawerOpen) {
                BABYLON.Animation.CreateAndStartAnimation(
                    'closeDrawer',
                    movingPart,
                    'position',
                    60,
                    10,
                    movingPart.position,
                    closePosition,
                    BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
                );
            } else {
                BABYLON.Animation.CreateAndStartAnimation(
                    'openDrawer',
                    movingPart,
                    'position',
                    60,
                    10,
                    movingPart.position,
                    openPosition,
                    BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
                );
            }
            isDrawerOpen = !isDrawerOpen;
        }

        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");
        const interactionLabel = new BABYLON.GUI.TextBlock();
        interactionLabel.text = "E to interact";
        interactionLabel.color = "white";
        interactionLabel.fontSize = 24;
        interactionLabel.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        interactionLabel.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        interactionLabel.isVisible = false;
        advancedTexture.addControl(interactionLabel);

        scene.onBeforeRenderObservable.add(() => {
            const distanceToDrawer = BABYLON.Vector3.Distance(capsule.position, stationaryPart.position);

            if (distanceToDrawer <= interactionDistance) {
                const screenPosition = BABYLON.Vector3.Project(
                    movingPart.position,
                    BABYLON.Matrix.Identity(),
                    scene.getTransformMatrix(),
                    camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
                );

                interactionLabel.leftInPixels = screenPosition.x - (engine.getRenderWidth() / 2);
                interactionLabel.topInPixels = screenPosition.y - (engine.getRenderHeight() / 2);
                interactionLabel.isVisible = true;
            } else {
                interactionLabel.isVisible = false;
            }

            if (distanceToDrawer <= interactionDistance && inputMap["e"]) {
                toggleDrawer();
                inputMap["e"] = false;
            }
        });

        return {
            stationaryPart,
            movingPart,
            toggleDrawer,
        };
    }

    createDrawer(scene, "assets/drawer.glb", new BABYLON.Vector3(3, 0.5, -5), 3, new BABYLON.Vector3(0, 0, 0.2));
    createDrawer(scene, "assets/drawer.glb", new BABYLON.Vector3(3, 0.5, -15), 3, new BABYLON.Vector3(0, 0, 0.2));

    // =========================
    // Box Attachment System
    // =========================
    let isPushingBox = false;
    let pushedBox = null;
    const PUSH_OFFSET = new BABYLON.Vector3(0, 0, -1.5);
    const BOX_SIZE = 1.3;
    let originalMoveSpeed = SETTINGS.moveSpeed;
    let originalTurnSpeed = SETTINGS.turnSpeed;

    const pushableBoxes = [];

    function createPushableBox(x, y, z, color) {
        const box = BABYLON.MeshBuilder.CreateBox('pushBox', {size: BOX_SIZE}, scene);
        box.position = new BABYLON.Vector3(x, y, z);
        box.checkCollisions = true;

        box.ellipsoid = new BABYLON.Vector3(BOX_SIZE * 0.5, BOX_SIZE * 0.5, BOX_SIZE * 0.5);
        box.ellipsoidOffset = new BABYLON.Vector3(0, BOX_SIZE * 0.5, 0);

        const boxMat = new BABYLON.StandardMaterial('boxMat', scene);
        boxMat.diffuseColor = color || new BABYLON.Color3(
            Math.random() * 0.5 + 0.5,
            Math.random() * 0.5 + 0.5,
            Math.random() * 0.5 + 0.5
        );
        box.material = boxMat;

        box.collisionGroup = 3;
        box.collisionMask = -1;

        pushableBoxes.push(box);
        return box;
    }

    createPushableBox(5, 1, 5, new BABYLON.Color3(1, 0, 0));  // Red box
    createPushableBox(-5, 1, 5, new BABYLON.Color3(0, 1, 0)); // Green box
    createPushableBox(0, 1, -5, new BABYLON.Color3(0, 0, 1)); // Blue box


    const pushPromptUI = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("pushPromptUI");
    const pushPrompt = new BABYLON.GUI.TextBlock("pushPrompt", "E to push");
    pushPrompt.color = "white";
    pushPrompt.fontSize = 48;
    pushPrompt.fontFamily = "Arial";
    pushPrompt.outlineColor = "black";
    pushPrompt.outlineWidth = 4;
    pushPrompt.alpha = 0;
    pushPromptUI.addControl(pushPrompt);

    scene.onBeforeRenderObservable.add(() => {
        if (isPushingBox) {
            pushPrompt.alpha = 0;
            return;
        }

        let closestBox = null;
        let minDistance = 3.0;

        for (const box of pushableBoxes) {
            const distance = BABYLON.Vector3.Distance(capsule.position, box.position);
            if (distance < minDistance) {
                minDistance = distance;
                closestBox = box;
            }
        }

        pushPrompt.alpha = BABYLON.Scalar.Lerp(
            pushPrompt.alpha,
            closestBox ? 1 : 0,
            0.1
        );

        if (closestBox) {
            pushPrompt.top = "0px";
            pushPrompt.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
            pushPrompt.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        }
    });

    function toggleBoxPushing() {
        if (isPushingBox) {
            // When stopping pushing
            isPushingBox = false;
            pushedBox = null;

            SETTINGS.moveSpeed = originalMoveSpeed;
            SETTINGS.turnSpeed = originalTurnSpeed;

            playerState.canRun = true;
            playerState.canCrouch = true;
            playerState.canJump = true;

            console.log('Stopped pushing box');
        } else {
            let closestBox = null;
            let minDistance = 2.0;

            for (const box of pushableBoxes) {
                const distance = BABYLON.Vector3.Distance(capsule.position, box.position);
                const directionToBox = box.position.subtract(capsule.position).normalize();
                const dot = BABYLON.Vector3.Dot(capsule.forward, directionToBox);

                if (distance < minDistance && dot > 0.7) {
                    closestBox = box;
                    minDistance = distance;
                }
            }

            if (closestBox) {
                isPushingBox = true;
                pushedBox = closestBox;

                originalMoveSpeed = SETTINGS.moveSpeed;
                originalTurnSpeed = SETTINGS.turnSpeed;

                SETTINGS.moveSpeed = SETTINGS.boxPushMoveSpeed || 1.5;
                SETTINGS.turnSpeed = SETTINGS.boxPushTurnSpeed || 0.3;

                playerState.canRun = false;
                playerState.canCrouch = false;
                playerState.canJump = false;

                if (playerState.isCrouching) {
                    crouch(false);
                }

                console.log('Started pushing box');
            }
        }
    }


    scene.onBeforeRenderObservable.add(() => {
        if (isPushingBox && pushedBox) {
            const boxForward = new BABYLON.Vector3(0, 0, 1);
            const boxRotationMatrix = BABYLON.Matrix.RotationY(pushedBox.rotation.y);
            const boxTransformedForward = BABYLON.Vector3.TransformCoordinates(boxForward, boxRotationMatrix);

            const targetPlayerPosition = pushedBox.position.add(boxTransformedForward.scale(PUSH_OFFSET.z));
            targetPlayerPosition.y = capsule.position.y;

            let rotationAmount = 0;
            let isMovingBackward = (inputMap["s"] || inputMap["ArrowDown"]);
            let turnDirection = 1;

            if (isMovingBackward) {
                turnDirection = -1;
            }

            if (inputMap["d"] || inputMap["ArrowLeft"]) rotationAmount += 0.03 * turnDirection;
            if (inputMap["a"] || inputMap["ArrowRight"]) rotationAmount -= 0.03 * turnDirection;

            if (rotationAmount !== 0) {
                pushedBox.rotation.y += rotationAmount;

                const newBoxRotationMatrix = BABYLON.Matrix.RotationY(pushedBox.rotation.y);
                boxTransformedForward.copyFrom(BABYLON.Vector3.TransformCoordinates(boxForward, newBoxRotationMatrix));

                targetPlayerPosition.copyFrom(pushedBox.position).addInPlace(boxTransformedForward.scale(PUSH_OFFSET.z));
                targetPlayerPosition.y = capsule.position.y;
            }

            let moveAmount = 0;
            if (inputMap["w"] || inputMap["ArrowUp"]) moveAmount += 0.1;
            if (inputMap["s"] || inputMap["ArrowDown"]) moveAmount -= 0.1;

            if (moveAmount !== 0) {
                const movement = boxTransformedForward.scale(moveAmount);
                movement.y = 0;

                const oldBoxPosition = pushedBox.position.clone();
                const oldPlayerY = targetPlayerPosition.y;

                pushedBox.moveWithCollisions(movement);

                pushedBox.position.y = oldBoxPosition.y;

                targetPlayerPosition.x += movement.x;
                targetPlayerPosition.z += movement.z;
                targetPlayerPosition.y = oldPlayerY;

                capsule.position.x = targetPlayerPosition.x;
                capsule.position.z = targetPlayerPosition.z;
                capsule.position.y = oldPlayerY;
            }

            const newPosition = BABYLON.Vector3.Lerp(
                capsule.position,
                targetPlayerPosition,
                0.2
            );

            capsule.moveWithCollisions(newPosition.subtract(capsule.position));

            const direction = pushedBox.position.subtract(capsule.position);
            direction.y = 0;

            if (direction.lengthSquared() > 0.01) {
                let targetRotation = Math.atan2(direction.x, direction.z);

                let currentRotation = ((capsule.rotation.y % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

                targetRotation = ((targetRotation - currentRotation + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI + currentRotation;

                capsule.rotation.y = BABYLON.Scalar.Lerp(
                    currentRotation,
                    targetRotation,
                    0.2
                );
            }
        }
    });

    scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
        BABYLON.ActionManager.OnKeyDownTrigger,
        (evt) => {
            if (evt.sourceEvent.key.toLowerCase() === 'e') {
                toggleBoxPushing();
            }
        }
    ));


    // =========================
    // Movement and Physics
    // =========================
    let verticalVelocity = 0;
    let isJumping = false;
    let grounded = false;
    let jumpCooldown = 0.1;
    let jumpTimer = 0;

    const playerState = {
        isWalking: false,
        isRunning: false,
        isCrouching: false,
        isJumping: false,
        isGrounded: false,
        currentSpeed: 0,
        canRun: true,
        canCrouch: true,
        canJump: true
    };

    scene.onBeforeRenderObservable.add(() => {

        const currentTime = performance.now();
        const deltaTime = (currentTime - previousTime) / 1000;
        previousTime = currentTime;

        const isMoving = (inputMap["w"] || inputMap["a"] || inputMap["s"] || inputMap["d"]);
        const isSprinting = inputMap['shift'] && isMoving && !isCrouching && grounded && playerState.canRun;

        playerState.isWalking = isMoving && !isSprinting && grounded;
        playerState.isRunning = isSprinting;
        playerState.isCrouching = isCrouching;
        playerState.isJumping = !grounded && verticalVelocity > 0;
        playerState.isGrounded = grounded;

        const currentMoveSpeed = isSprinting ? SETTINGS.sprintSpeed : SETTINGS.moveSpeed;
        playerState.currentSpeed = isMoving ? (isSprinting ? 2 : 1) : 0;

        const moveSpeed = currentMoveSpeed;
        const turnSpeed = SETTINGS.turnSpeed * deltaTime;
        let moveDirection = new BABYLON.Vector3.Zero();

        const camForward = camera.getForwardRay().direction;
        camForward.y = 0;
        camForward.normalize();
        const camRight = BABYLON.Vector3.Cross(camForward, BABYLON.Vector3.Up()).normalize();

        if (inputMap["w"]) moveDirection.addInPlace(camForward);
        if (inputMap["s"]) moveDirection.subtractInPlace(camForward);
        if (inputMap["d"]) moveDirection.subtractInPlace(camRight);
        if (inputMap["a"]) moveDirection.addInPlace(camRight);

        if (moveDirection.length() > 0) {
            moveDirection.normalize();
            moveDirection.scaleInPlace(moveSpeed * deltaTime);
        }

        function isGrounded() {
            const rayOrigin = capsule.position.add(new BABYLON.Vector3(0, -capsule.ellipsoid.y + 1, 0));
            const ray = new BABYLON.Ray(rayOrigin, new BABYLON.Vector3(0, -1, 0), 0.15);
            const pick = scene.pickWithRay(ray, (mesh) => mesh.checkCollisions && mesh !== capsule, true);
            return pick.hit;
        }

        jumpTimer -= deltaTime;

        grounded = isGrounded();

        if (grounded) {
            if (inputMap[" "] && jumpTimer <= 0 && playerState.canJump) {
                verticalVelocity = SETTINGS.jumpForce;
                jumpTimer = jumpCooldown;
            } else if (verticalVelocity < 0) {
                verticalVelocity = -0.1;
            }
        } else {
            verticalVelocity += SETTINGS.gravity * deltaTime;
        }

        if (
            isCrouching &&
            !crouchKeyHeld
        ) {
            crouch(false);
        } else if (inputMap["Control"] && !isCrouching && playerState.canCrouch) {
            crouch(true);
        }

        moveDirection.y = verticalVelocity;
        capsule.moveWithCollisions(moveDirection);

        if (moveDirection.x !== 0 || moveDirection.z !== 0) {
            const targetRotation = Math.atan2(moveDirection.x, moveDirection.z);
            capsule.rotation.y = lerpAngleShortest(capsule.rotation.y, targetRotation, turnSpeed);
        }
        camera.target = capsule.position.clone();

        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: "update",
                position: {
                    x: capsule.position.x,
                    y: capsule.position.y,
                    z: capsule.position.z
                }
            }));
        }
    });

    // =========================
    // Utility Functions
    // =========================

    window.addEventListener('keydown', function (event) {
        if(event.key === 'b') {
            capsule.showBoundingBox = !capsule.showBoundingBox;
            ground.showBoundingBox = !ground.showBoundingBox;
            Object.values(otherPlayers).forEach(playerMesh => {
                playerMesh.showBoundingBox = !playerMesh.showBoundingBox;
            });
        }
    });


    function lerpAngleShortest(from, to, alpha) {
        let delta = to - from;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        return from + delta * alpha;
    }

    function createDebugUI() {
        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("debugUI");
        const debugText = new BABYLON.GUI.TextBlock();
        debugText.text = "";
        debugText.color = "white";
        debugText.fontSize = 20;
        debugText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        debugText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        debugText.paddingLeft = "10px";
        debugText.paddingTop = "10px";
        advancedTexture.addControl(debugText);

        scene.onBeforeRenderObservable.add(() => {
            const state = [];
            if (playerState.isWalking) state.push("Walking");
            if (playerState.isRunning) state.push("Running");
            if (playerState.isCrouching) state.push("Crouching");
            if (playerState.isJumping) state.push("Jumping");
            if (state.length === 0) state.push("Idle");
            
            debugText.text = `State: ${state.join(", ")}\n` +
                           `Speed: ${playerState.currentSpeed.toFixed(1)}x\n` +
                           `Grounded: ${playerState.isGrounded ? "Yes" : "No"}\n` +
                           `Position: (${capsule.position.x.toFixed(1)}, ${capsule.position.y.toFixed(1)}, ${capsule.position.z.toFixed(1)})`;
        });
    }

    createDebugUI();

    return scene;
};