import {
  cameraAt,
  CameraStop,
  frameAround,
  frameFilledBy,
  PUSH,
  VideoProject,
} from '../common/video';
import { planZoomChain, ZoomChainNode } from '../common/zoom-chain';

const TALL = 9 / 16;

function make20Nodes(): ZoomChainNode[] {
  // Mix of landscape (3:2) and portrait (2:3) photos mirroring a real 20-photo park reel
  const tallSet = new Set([0, 5, 11, 16, 17, 18]);
  return Array.from({ length: 20 }, (_, i) => ({
    id: `p${i + 1}`,
    aspect: tallSet.has(i) ? 2 / 3 : 3 / 2,
    sub: [0.5, 0.5] as const,
    portal: [0.48, 0.45] as const,
    ratio: i === 0 ? 0.065 : 0.085,
  }));
}

describe('planZoomChain', () => {
  it('partitions a 20-photo looping chain into bounded clusters with pixel-identical bridge & loop geometry', () => {
    const nodes = make20Nodes();
    const plan = planZoomChain(nodes, {
      videoAspect: TALL,
      loop: true,
      wideFit: 'full',
      room: 0.02,
      zoom: 1.05,
      maxClusterSide: 2_000_000,
    });

    expect(plan.clusters.length).toBeGreaterThanOrEqual(5);
    expect(plan.warnings).toEqual([]);
    // Every cluster stays strictly within the maxClusterSide ceiling
    for (const cluster of plan.clusters) {
      expect(Math.max(cluster.maxWidth, cluster.maxHeight)).toBeLessThanOrEqual(2_000_000);
      // Every cluster in a looping chain starts with a 2-layer copy pair (child, host)
      expect(cluster.layers[0].isCopy).toBe(true);
      expect(cluster.layers[1].isCopy).toBe(true);
      for (let j = 2; j < cluster.layers.length; j++) {
        expect(cluster.layers[j].isCopy).toBe(false);
      }
    }

    // Verify exact relative child->host geometry across every relay bridge AND across the loop seam
    for (let c = 0; c < plan.clusters.length; c++) {
      const prevCluster = plan.clusters[(c - 1 + plan.clusters.length) % plan.clusters.length];
      const nextCluster = plan.clusters[c];
      const prevChild = prevCluster.layers[prevCluster.layers.length - 2];
      const prevHost = prevCluster.layers[prevCluster.layers.length - 1];
      const nextChild = nextCluster.layers[0];
      const nextHost = nextCluster.layers[1];

      expect(nextChild.sourceId).toBe(prevChild.sourceId);
      expect(nextHost.sourceId).toBe(prevHost.sourceId);

      // Relative scale & centered position of child inside host match to < 1e-4
      const relWPrev = prevChild.rect.width / prevHost.rect.width;
      const relWNext = nextChild.rect.width / nextHost.rect.width;
      expect(relWNext).toBeCloseTo(relWPrev, 4);

      const relCxPrev =
        (prevChild.rect.x + prevChild.rect.width / 2 - prevHost.rect.x) / prevHost.rect.width;
      const relCxNext =
        (nextChild.rect.x + nextChild.rect.width / 2 - nextHost.rect.x) / nextHost.rect.width;
      expect(relCxNext).toBeCloseTo(relCxPrev, 4);

      const relCyPrev =
        (prevChild.rect.y + prevChild.rect.height / 2 - prevHost.rect.y) / prevHost.rect.height;
      const relCyNext =
        (nextChild.rect.y + nextChild.rect.height / 2 - nextHost.rect.y) / nextHost.rect.height;
      expect(relCyNext).toBeCloseTo(relCyPrev, 4);
    }

    // Verify constant exponential zoom velocity across every scroll shot
    const camera: CameraStop[] = plan.shots.map((s, idx) => {
      const layer = plan.clusters[s.clusterIndex].layers[s.layerIndex];
      const frame =
        s.framing.mode === 'room'
          ? frameAround(layer.rect, TALL, s.framing.room)
          : (() => {
              const base = frameFilledBy(layer.rect, TALL);
              const w = base.width / s.framing.zoom;
              const h = base.height / s.framing.zoom;
              return {
                x: base.x + (base.width - w) / 2,
                y: base.y + (base.height - h) / 2,
                width: w,
                height: h,
              };
            })();
      return {
        id: `s${idx}`,
        frame,
        length: s.length,
        arrival: s.arrival,
        arrivalTime: 1.2,
        stay: s.stay,
        easing: s.easing,
      };
    });

    const video: VideoProject = {
      width: 1080,
      height: 1920,
      fps: 30,
      background: '#000',
      frame: camera[0].frame,
      camera,
      layouts: [],
      motions: [],
    };
    // Loop seam: end frame's relative scale inside last host equals t=0 frame's relative scale inside first host
    const startFrame = cameraAt(video, 0);
    const endFrame = cameraAt(video, plan.totalLength - 1e-4);
    const firstHost = plan.clusters[0].layers[1].rect;
    const lastHost = plan.clusters[plan.clusters.length - 1].layers.at(-1)!.rect;
    expect(startFrame.height / firstHost.height).toBeCloseTo(endFrame.height / lastHost.height, 3);
    expect(startFrame.width / firstHost.width).toBeCloseTo(endFrame.width / lastHost.width, 3);
  });

  it('builds a single non-looping cluster without unnecessary copies when chain fits in bounds', () => {
    const plan = planZoomChain(
      [
        { id: 'a', aspect: 3 / 2 },
        { id: 'b', aspect: 3 / 2, portal: [0.5, 0.5], ratio: 0.1 },
        { id: 'c', aspect: 2 / 3, portal: [0.5, 0.5], ratio: 0.1 },
      ],
      { videoAspect: TALL, loop: false, wideFit: 'full' },
    );
    expect(plan.clusters).toHaveLength(1);
    expect(plan.clusters[0].layers.every((l) => !l.isCopy)).toBe(true);
    // Final shot in a non-looping chain ends at showcase zoom (not bridgeEndZoom = zoom / PUSH)
    const lastShot = plan.shots[plan.shots.length - 1];
    expect(lastShot.framing).toEqual({ mode: 'zoom', zoom: 1.05 });
    expect(1.05 / PUSH).toBeGreaterThan(1.2);
  });

  it('clamps unsafe portals near edges of wide parents and emits a clear warning', () => {
    const plan = planZoomChain(
      [
        { id: 'child', aspect: 3 / 2 },
        { id: 'parent', aspect: 3 / 2, portal: [0.5, 0.02], ratio: 0.1 },
      ],
      { videoAspect: TALL, loop: false, wideFit: 'full', room: 0.04 },
    );
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain('too close to edge');
    // Clamped child showcase frame stays strictly inside parent bounds
    const [child, parent] = plan.clusters[0].layers;
    const childShowcase = frameAround(child.rect, TALL, 0.04);
    expect(childShowcase.y).toBeGreaterThanOrEqual(parent.rect.y);
    expect(childShowcase.y + childShowcase.height).toBeLessThanOrEqual(
      parent.rect.y + parent.rect.height,
    );
  });

  it('validates invalid inputs before computing', () => {
    expect(() => planZoomChain([{ id: 'only', aspect: 1.5 }], { videoAspect: TALL })).toThrow(
      'at least 2',
    );
    expect(() =>
      planZoomChain(
        [
          { id: 'a', aspect: 1.5 },
          { id: 'b', aspect: 1.5, ratio: 0.9 },
        ],
        { videoAspect: TALL },
      ),
    ).toThrow('ratio');
  });
});
