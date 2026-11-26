// The contrails the aeroplane leaves behind: a ribbon of quads that follows the
// wingtips, fading as it ages. They are drawn from the same points the flight
// model has, so they always match where the aeroplane really was.
import * as THREE from '../vendor/three.module.min.js';

/**
 * A ribbon of triangles that is rebuilt every frame from a list of points.
 */
function createRibbon(width, colour, opacity) {
  const positions = new Float32Array(64 * 2 * 3);
  const uvs = new Float32Array(64 * 2 * 2);
  const indices = [];
  for (let index = 0; index < 63; index += 1) {
    const a = index * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.setDrawRange(0, 0);
  const material = new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    fog: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, geometry, positions, uvs };
}

export function createTrails(quality) {
  const group = new THREE.Group();
  const maxPoints = quality.trailSegments;
  const wings = [
    { side: -1, ribbon: createRibbon(0.55, 0xf2f6ff, 0.5), points: [] },
    { side: 1, ribbon: createRibbon(0.55, 0xf2f6ff, 0.5), points: [] },
  ];
  wings.forEach((wing) => group.add(wing.ribbon.mesh));

  return {
    group,
    /** Empties the trails, for a new flight. */
    reset() {
      wings.forEach((wing) => {
        wing.points.length = 0;
        wing.ribbon.geometry.setDrawRange(0, 0);
      });
    },
    /**
     * Adds a point to each trail and rebuilds the ribbons.
     * @param {object} flight the flight model
     */
    update(flight) {
      const position = flight.state.position;
      const heading = flight.state.heading;
      const roll = flight.state.roll;
      const right = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
      const up = new THREE.Vector3(0, 1, 0);
      // The wingtip's position: the wing's half-span out, and a little down.
      const tip = right.clone().multiplyScalar(5.2 * Math.cos(roll)).addScaledVector(up, -0.25 + 5.2 * Math.sin(roll));

      wings.forEach((wing) => {
        const point = position.clone().add(tip.clone().multiplyScalar(wing.side));
        wing.points.push(point);
        if (wing.points.length > maxPoints) wing.points.shift();

        const count = wing.points.length;
        if (count < 2) {
          wing.ribbon.geometry.setDrawRange(0, 0);
          return;
        }
        const positions = wing.ribbon.positions;
        const uvs = wing.ribbon.uvs;
        for (let index = 0; index < count; index += 1) {
          const current = wing.points[index];
          const previous = wing.points[Math.max(0, index - 1)];
          const next = wing.points[Math.min(count - 1, index + 1)];
          const direction = next.clone().sub(previous).normalize();
          const side = new THREE.Vector3().crossVectors(direction, up).normalize().multiplyScalar(0.28);
          const at = index * 6;
          positions[at] = current.x - side.x;
          positions[at + 1] = current.y - side.y;
          positions[at + 2] = current.z - side.z;
          positions[at + 3] = current.x + side.x;
          positions[at + 4] = current.y + side.y;
          positions[at + 5] = current.z + side.z;
          const age = index / count;
          const uvAt = index * 4;
          uvs[uvAt] = age;
          uvs[uvAt + 1] = 0;
          uvs[uvAt + 2] = age;
          uvs[uvAt + 3] = 1;
        }
        wing.ribbon.geometry.attributes.position.needsUpdate = true;
        wing.ribbon.geometry.attributes.uv.needsUpdate = true;
        wing.ribbon.geometry.setDrawRange(0, (count - 1) * 6);
        // The trail fades as it ages.
        wing.ribbon.mesh.material.opacity = 0.42 * Math.min(1, count / 12);
      });
    },
  };
}
