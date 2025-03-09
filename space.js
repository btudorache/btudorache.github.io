// Three.js setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// Create stars
const starsGeometry = new THREE.BufferGeometry();
const starsCount = 3000;

const positions = new Float32Array(starsCount * 3);
const colors = new Float32Array(starsCount * 3);
const sizes = new Float32Array(starsCount);

for (let i = 0; i < starsCount * 3; i += 3) {
    // Position
    positions[i] = (Math.random() - 0.5) * 200;
    positions[i+1] = (Math.random() - 0.5) * 200;
    positions[i+2] = (Math.random() - 0.5) * 200 - 25;
    
    // Color - randomize between white and blue-ish
    const intensity = 0.5 + Math.random() * 0.5;
    const isBlue = Math.random() > 0.7;
    
    if (isBlue) {
        colors[i] = 0.5 * intensity;  // R
        colors[i+1] = 0.7 * intensity;  // G
        colors[i+2] = intensity;  // B
    } else {
        colors[i] = intensity;  // R
        colors[i+1] = intensity;  // G
        colors[i+2] = intensity;  // B
    }
    
    // Size - some stars bigger than others
    sizes[i/3] = Math.random() * 2;
}

starsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
starsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
starsGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

const starsMaterial = new THREE.PointsMaterial({
    size: 0.1,
    vertexColors: true,
    transparent: true,
    opacity: 0.8
});

const stars = new THREE.Points(starsGeometry, starsMaterial);
scene.add(stars);

// Add nebula (distant colorful clouds)
const createNebula = () => {
    const nebulaGeometry = new THREE.BufferGeometry();
    const nebulaCount = 300;
    
    const nebulaPositions = new Float32Array(nebulaCount * 3);
    const nebulaColors = new Float32Array(nebulaCount * 3);
    
    for (let i = 0; i < nebulaCount * 3; i += 3) {
        // Position - far background
        nebulaPositions[i] = (Math.random() - 0.5) * 100;
        nebulaPositions[i+1] = (Math.random() - 0.5) * 100;
        nebulaPositions[i+2] = -100 - Math.random() * 100;
        
        // Color - choose between blue, purple, pink
        const colorChoice = Math.random();
        
        if (colorChoice < 0.33) {
            // Blue
            nebulaColors[i] = 0.1 + Math.random() * 0.2;
            nebulaColors[i+1] = 0.3 + Math.random() * 0.3;
            nebulaColors[i+2] = 0.7 + Math.random() * 0.3;
        } else if (colorChoice < 0.66) {
            // Purple
            nebulaColors[i] = 0.3 + Math.random() * 0.3;
            nebulaColors[i+1] = 0.1 + Math.random() * 0.2;
            nebulaColors[i+2] = 0.7 + Math.random() * 0.3;
        } else {
            // Pink/Red
            nebulaColors[i] = 0.7 + Math.random() * 0.3;
            nebulaColors[i+1] = 0.1 + Math.random() * 0.3;
            nebulaColors[i+2] = 0.3 + Math.random() * 0.3;
        }
    }
    
    nebulaGeometry.setAttribute('position', new THREE.BufferAttribute(nebulaPositions, 3));
    nebulaGeometry.setAttribute('color', new THREE.BufferAttribute(nebulaColors, 3));
    
    const nebulaMaterial = new THREE.PointsMaterial({
        size: 8,
        vertexColors: true,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending
    });
    
    return new THREE.Points(nebulaGeometry, nebulaMaterial);
};

const nebula = createNebula();
scene.add(nebula);

// Add some distant planets
const createPlanet = (radius, color, distance, speed) => {
    const planetGeometry = new THREE.SphereGeometry(radius, 32, 32);
    const planetMaterial = new THREE.MeshBasicMaterial({ 
        color: color,
        transparent: true,
        opacity: 0.7
    });
    
    const planet = new THREE.Mesh(planetGeometry, planetMaterial);
    
    // Position
    const angle = Math.random() * Math.PI * 2;
    planet.position.x = Math.cos(angle) * distance;
    planet.position.y = (Math.random() - 0.5) * 20;
    planet.position.z = Math.sin(angle) * distance - 50;
    
    // Add property for animation
    planet.speed = speed;
    planet.distance = distance;
    planet.angle = angle;
    
    return planet;
};

// Create a few planets
const planets = [
    createPlanet(4, 0x4364e8, 40, 0.0005),  // Blue
    createPlanet(2, 0xfc4ae6, 60, 0.0003),   // Pink
    createPlanet(3, 0x05caf7, 80, 0.0002)    // Cyan
];

planets.forEach(planet => scene.add(planet));

// Position camera
camera.position.z = 30;

// Mouse movement - parallax effect
let mouseX = 0;
let mouseY = 0;
let targetX = 0;
let targetY = 0;

document.addEventListener('mousemove', (event) => {
    mouseX = (event.clientX / window.innerWidth - 0.5);
    mouseY = (event.clientY / window.innerHeight - 0.5);
});

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    
    // Smooth parallax follow
    targetX = mouseX * 0.2;
    targetY = mouseY * 0.2;
    
    // Rotate stars slowly
    stars.rotation.y += 0.0002;
    stars.rotation.x += 0.0001;
    
    // Rotate nebula
    nebula.rotation.y += 0.0003;
    
    // Animate planets
    planets.forEach(planet => {
        planet.angle += planet.speed;
        planet.position.x = Math.cos(planet.angle) * planet.distance;
        planet.position.z = Math.sin(planet.angle) * planet.distance - 50;
        planet.rotation.y += 0.01;
    });
    
    // Smooth camera movement for parallax
    camera.position.x += (targetX - camera.position.x) * 0.05;
    camera.position.y += (-targetY - camera.position.y) * 0.05;
    camera.lookAt(scene.position);
    
    renderer.render(scene, camera);
}

animate();