# Matcha Model Studio

Interactive Revit café model: first-person walking, camera-following wall cutaways, folding entrance, ceiling lights, chairs, prototype AC, exploded building layers and dimensions.

## Live site

GitHub Pages is configured from the `main` branch root. The Pages settings and deployment history show the confirmed live URL.

## Controls

Drag to orbit, scroll to zoom, click to inspect. Walk inside uses WASD and F to capture or release mouse look; Escape releases the pointer. Touch devices have movement arrows and drag-to-look. High quality enables the most detailed rendering; Mobile uses a lighter path.

## Source and fidelity

All 220 source elements, 30 material assignments and eight original texture maps are preserved from Cafe_Matcha_Wall_Finishes. The AC is an explicitly labeled prototype addition. WebGL materials and lighting are real-time approximations. Geometry, navigation and application-state tests passed before upload; those tests do not establish GPU visual fidelity.

Serve this repository through HTTP for local development. No build system is required. Third-party rendering code is Three.js, with its MIT license in `assets/THREE-LICENSE.txt`. Model and texture ownership is unchanged.
