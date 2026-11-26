/**
 * Pure geometry and timeline planner for continuous, zero-pause nested zoom-out chains.
 *
 * Given an ordered sequence of photos and their creative embed coordinates (`portal`, `ratio`),
 * this planner:
 *  1. Sizes every photo relative to its child using `common/video.ts`'s own `frameAround` and
 *     `frameFilledBy` so every embedded image lands at the exact requested visible width ratio.
 *  2. Partitions arbitrarily long chains (e.g., 20+ photos) into compact spatial clusters that stay
 *     below `maxClusterSide`, automatically inserting 2-layer `(child, host)` relay bridges so
 *     cluster handoffs are pixel-identical with zero pops and zero pauses.
 *  3. Optionally closes the chain into a seamless infinite loop (`end -> start`).
 *  4. Computes exact `scroll` durations so exponential zoom velocity stays constant across every shot.
 */
import { clamp } from './core';
import { frameAround, frameFilledBy, MIN_BLOCK_LENGTH, PUSH } from './video';
import { Point, Rect } from './workspace';

export interface ZoomChainNode {
  /** Stable identifier of the original photo (e.g., item id or stringified photo number) */
  id: string;
  /** Natural width / height */
  aspect: number;
  /** Subject focal point [x, y] in 0..1; defaults to [0.5, 0.5] */
  sub?: readonly [number, number];
  /** Normalized [fx, fy] inside this photo where the previous photo is centered; defaults to [0.5, 0.5] */
  portal?: readonly [number, number];
  /** Desired fraction of this photo's showcase frame width taken by the previous photo (default 0.085) */
  ratio?: number;
}

export interface ZoomChainOptions {
  /** Output video aspect ratio (width / height), e.g. 9 / 16 */
  videoAspect: number;
  /** Close the last photo seamlessly back into the first photo (default false) */
  loop?: boolean;
  /** Show landscape photos completely in frame ('full') or height-filled ('fill'); default 'full' */
  wideFit?: 'full' | 'fill';
  /** Room fraction around full-fit wide photos (default 0.02) */
  room?: number;
  /** Showcase zoom for filled photos (default 1.05) */
  zoom?: number;
  /** Target exponential zoom velocity k in s^-1 (default ln(1 / PUSH) / 0.12 = 1.3543) */
  speed?: number;
  /** Max layer width or height inside any single cluster before bridging (default 2_000_000) */
  maxClusterSide?: number;
  /** Width of each cluster's innermost layer in workspace units (default 40) */
  baseWidth?: number;
  /** Top-left workspace origin for Cluster 0 so generated clusters stay clear of existing items */
  origin?: Point;
  /** Clamp portals that would expose canvas background around a full-fit child (default true) */
  clampPortals?: boolean;
}

export interface PlannedLayer {
  /** Index into the input `nodes` array */
  nodeIndex: number;
  /** Original photo id from `nodes[nodeIndex].id` */
  sourceId: string;
  /** Whether this layer needs a fresh duplicate of `sourceId` (bridge or loop start pair) */
  isCopy: boolean;
  rect: Rect;
  subject: Point;
}

export interface PlannedCluster {
  index: number;
  /** Layers stacked top-down (innermost child at index 0, outermost parent last) */
  layers: PlannedLayer[];
  maxWidth: number;
  maxHeight: number;
}

export interface PlannedShot {
  clusterIndex: number;
  layerIndex: number;
  /**
   * - `room`: full photo with `room` margin
   * - `zoom`: height-filled on subject at `zoom`
   * - `bridge-end`: `zoom` frame scaled by `PUSH` around its own center so `endFrame(prev)` matches
   *   the next cluster's `pull-out` `startFrame` identically even for off-center subjects
   */
  framing:
    | { mode: 'room'; room: number }
    | { mode: 'zoom'; zoom: number }
    | { mode: 'bridge-end'; zoom: number };
  length: number;
  arrival: 'cut' | 'scroll';
  stay: 'still' | 'pull-out';
  easing: 'linear' | 'smooth';
}

export interface ZoomChainPlan {
  clusters: PlannedCluster[];
  shots: PlannedShot[];
  totalLength: number;
  speed: number;
  bridgeTime: number;
  warnings: string[];
}

const DEFAULT_RATIO = 0.085;
const DEFAULT_ROOM = 0.02;
const DEFAULT_ZOOM = 1.05;
const DEFAULT_BRIDGE_TIME = 0.12;
const DEFAULT_MAX_CLUSTER_SIDE = 2_000_000;
const DEFAULT_BASE_WIDTH = 40;
/** Aspect ratio threshold above videoAspect to treat a photo as landscape for wideFit: 'full' */
const WIDE_RATIO_FACTOR = 1.2;

function isFullWide(aspect: number, videoAspect: number, wideFit: 'full' | 'fill'): boolean {
  return wideFit === 'full' && aspect > videoAspect * WIDE_RATIO_FACTOR;
}

/** Exact frame dimensions when showing a photo of size `(w, h)` with `frameFilledBy` at `zoom` */
function filledFrameSize(
  w: number,
  h: number,
  videoAspect: number,
  zoom: number,
): { width: number; height: number } {
  const filled = frameFilledBy({ x: 0, y: 0, width: w, height: h }, videoAspect);
  return { width: filled.width / zoom, height: filled.height / zoom };
}

/** Exact frame dimensions when showing a photo of size `(w, h)` with `frameAround` at `room` */
function aroundFrameSize(
  w: number,
  h: number,
  videoAspect: number,
  room: number,
): { width: number; height: number } {
  const around = frameAround({ x: 0, y: 0, width: w, height: h }, videoAspect, room);
  return { width: around.width, height: around.height };
}

/** Showcase frame dimensions for a node of size `(w, h)` */
function showcaseFrameSize(
  w: number,
  h: number,
  aspect: number,
  videoAspect: number,
  wideFit: 'full' | 'fill',
  room: number,
  zoom: number,
): { width: number; height: number } {
  return isFullWide(aspect, videoAspect, wideFit)
    ? aroundFrameSize(w, h, videoAspect, room)
    : filledFrameSize(w, h, videoAspect, zoom);
}

/** Parent `(w, h)` sized so a child of width `childW` occupies `ratio` of the parent's showcase frame width */
function parentSizeFor(
  childW: number,
  parentAspect: number,
  ratio: number,
  videoAspect: number,
  wideFit: 'full' | 'fill',
  room: number,
  zoom: number,
): { w: number; h: number } {
  const targetShowW = childW / ratio;
  const unit = showcaseFrameSize(parentAspect, 1, parentAspect, videoAspect, wideFit, room, zoom);
  const h = targetShowW / unit.width;
  return { w: h * parentAspect, h };
}

/**
 * Scales `frame` around its own center by `PUSH` (0.85), matching `cameraAt`'s `pull-out`
 * `startFrame` identically even when the shot's subject is off-center.
 */
export function bridgeEndFrame(frame: Rect): Rect {
  const width = frame.width * PUSH;
  const height = frame.height * PUSH;
  return {
    x: frame.x + (frame.width - width) / 2,
    y: frame.y + (frame.height - height) / 2,
    width,
    height,
  };
}

/**
 * Plans all cluster splits, layer rects, bridge/loop copies, and constant-velocity camera shots
 * for a nested continuous zoom-out chain.
 */
export function planZoomChain(
  nodes: readonly ZoomChainNode[],
  options: ZoomChainOptions,
): ZoomChainPlan {
  if (nodes.length < 2) {
    throw new Error('zoomChain needs at least 2 photos');
  }
  const { videoAspect } = options;
  if (!Number.isFinite(videoAspect) || videoAspect <= 0) {
    throw new Error('videoAspect must be positive');
  }
  const loop = options.loop === true;
  const wideFit = options.wideFit ?? 'full';
  const room = options.room ?? DEFAULT_ROOM;
  const zoom = options.zoom ?? DEFAULT_ZOOM;
  const maxClusterSide = options.maxClusterSide ?? DEFAULT_MAX_CLUSTER_SIDE;
  const baseWidth = options.baseWidth ?? DEFAULT_BASE_WIDTH;
  const origin = options.origin ?? { x: 0, y: 0 };
  const clampPortals = options.clampPortals !== false;

  if (!Number.isFinite(room) || room < 0 || room > 0.5) {
    throw new Error('room must be between 0 and 0.5');
  }
  if (!Number.isFinite(zoom) || zoom < 1 || zoom > 5) {
    throw new Error('zoom must be between 1 and 5');
  }
  if (!Number.isFinite(maxClusterSide) || maxClusterSide < 1000 || maxClusterSide > 1e7) {
    throw new Error('maxClusterSide must be between 1000 and 10000000');
  }
  if (!Number.isFinite(baseWidth) || baseWidth < 1 || baseWidth > 10_000) {
    throw new Error('baseWidth must be between 1 and 10000');
  }
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) {
    throw new Error('origin coordinates must be finite');
  }

  // Validate nodes and normalize defaults
  const norm = nodes.map((node, i) => {
    if (!Number.isFinite(node.aspect) || node.aspect <= 0) {
      throw new Error(`Node ${i + 1}: aspect must be positive`);
    }
    const ratio = node.ratio ?? DEFAULT_RATIO;
    if (!Number.isFinite(ratio) || ratio < 0.02 || ratio > 0.5) {
      throw new Error(`Node ${i + 1}: ratio must be between 0.02 and 0.5`);
    }
    const sub: [number, number] = [node.sub?.[0] ?? 0.5, node.sub?.[1] ?? 0.5];
    const portal: [number, number] = [node.portal?.[0] ?? 0.5, node.portal?.[1] ?? 0.5];
    for (const [label, pt] of [
      ['sub', sub],
      ['portal', portal],
    ] as const) {
      if (
        !Number.isFinite(pt[0]) ||
        !Number.isFinite(pt[1]) ||
        pt[0] < 0 ||
        pt[0] > 1 ||
        pt[1] < 0 ||
        pt[1] > 1
      ) {
        throw new Error(`Node ${i + 1}: ${label} coordinates must be finite numbers in 0..1`);
      }
    }
    return { ...node, ratio, sub, portal };
  });

  // Derive matched bridgeTime and exponential zoom rate K so pull-out and scroll velocities match identically
  const targetSpeed = options.speed ?? Math.log(1 / PUSH) / DEFAULT_BRIDGE_TIME;
  if (!Number.isFinite(targetSpeed) || targetSpeed <= 0.1 || targetSpeed > 10) {
    throw new Error('speed must be between 0.1 and 10');
  }
  const bridgeTime = Math.max(
    MIN_BLOCK_LENGTH,
    Math.round((Math.log(1 / PUSH) / targetSpeed) * 100) / 100,
  );
  const speed = Math.log(1 / PUSH) / bridgeTime;

  // Build ordered node-index sequence: [0..N-1] (or [0..N-1, 0] when looping)
  const sequence: number[] = norm.map((_, i) => i);
  if (loop) {
    sequence.push(0);
  }

  interface RawClusterSpec {
    /** Index into `sequence` of the host photo this cluster starts on */
    startSeq: number;
    /** Index into `sequence` of the outermost photo this cluster ends on */
    endSeq: number;
    /** Node index of the embedded child inside `sequence[startSeq]`, if any */
    bridgeChildNode?: number;
  }

  // Greedily partition `sequence` into clusters keeping every layer <= maxClusterSide
  const clusterSpecs: RawClusterSpec[] = [];
  let startSeq = 0;
  while (startSeq < sequence.length - 1) {
    const hasBridgeChild = startSeq > 0 || loop;
    const bridgeChildNode =
      startSeq > 0 ? sequence[startSeq - 1] : loop ? norm.length - 1 : undefined;

    let currW = baseWidth;
    if (hasBridgeChild) {
      const hostNode = norm[sequence[startSeq]];
      currW = parentSizeFor(
        currW,
        hostNode.aspect,
        hostNode.ratio,
        videoAspect,
        wideFit,
        room,
        zoom,
      ).w;
    }

    let endSeq = startSeq;
    for (let s = startSeq + 1; s < sequence.length; s++) {
      const nextNode = norm[sequence[s]];
      const nextSize = parentSizeFor(
        currW,
        nextNode.aspect,
        nextNode.ratio,
        videoAspect,
        wideFit,
        room,
        zoom,
      );
      // Always advance by at least 1 photo even if a single jump is huge
      if (s > startSeq + 1 && Math.max(nextSize.w, nextSize.h) > maxClusterSide) {
        break;
      }
      currW = nextSize.w;
      endSeq = s;
    }

    clusterSpecs.push({ startSeq, endSeq, bridgeChildNode });
    startSeq = endSeq;
  }

  const warnings: string[] = [];

  // Pre-compute sizes for every cluster to determine clean non-overlapping grid spacing
  interface SizedEntry {
    nodeIndex: number;
    isCopy: boolean;
    w: number;
    h: number;
    x: number;
    y: number;
  }

  const sizedClusters: SizedEntry[][] = clusterSpecs.map((spec) => {
    const entries: SizedEntry[] = [];
    if (spec.bridgeChildNode !== undefined) {
      entries.push({
        nodeIndex: spec.bridgeChildNode,
        isCopy: true,
        w: 0,
        h: 0,
        x: 0,
        y: 0,
      });
      entries.push({
        nodeIndex: sequence[spec.startSeq],
        isCopy: true,
        w: 0,
        h: 0,
        x: 0,
        y: 0,
      });
    } else {
      entries.push({
        nodeIndex: sequence[spec.startSeq],
        isCopy: false,
        w: 0,
        h: 0,
        x: 0,
        y: 0,
      });
    }
    for (let s = spec.startSeq + 1; s <= spec.endSeq; s++) {
      entries.push({
        nodeIndex: sequence[s],
        isCopy: false,
        w: 0,
        h: 0,
        x: 0,
        y: 0,
      });
    }

    entries[0].w = baseWidth;
    entries[0].h = baseWidth / norm[entries[0].nodeIndex].aspect;
    for (let j = 1; j < entries.length; j++) {
      const prev = entries[j - 1];
      const curr = entries[j];
      const currNode = norm[curr.nodeIndex];
      const size = parentSizeFor(
        prev.w,
        currNode.aspect,
        currNode.ratio,
        videoAspect,
        wideFit,
        room,
        zoom,
      );
      curr.w = size.w;
      curr.h = size.h;
    }
    return entries;
  });

  const maxAnyW = Math.max(...sizedClusters.map((c) => c[c.length - 1].w));
  const maxAnyH = Math.max(...sizedClusters.map((c) => c[c.length - 1].h));
  const stepX = Math.ceil(maxAnyW * 1.25);
  const stepY = Math.ceil(maxAnyH * 1.25);
  const cols = Math.max(1, Math.ceil(Math.sqrt(sizedClusters.length)));

  // Position every cluster on the grid & validate/clamp portals so child showcase never leaks outside parent
  const clusters: PlannedCluster[] = sizedClusters.map((entries, c) => {
    const col = c % cols;
    const row = Math.floor(c / cols);
    const last = entries[entries.length - 1];
    last.x = origin.x + col * stepX;
    last.y = origin.y + row * stepY;

    for (let j = entries.length - 2; j >= 0; j--) {
      const child = entries[j];
      const parent = entries[j + 1];
      const childNode = norm[child.nodeIndex];
      const parentNode = norm[parent.nodeIndex];

      // Safe bounds so the child's showcase frame sits completely inside parent
      const childFrame = showcaseFrameSize(
        child.w,
        child.h,
        childNode.aspect,
        videoAspect,
        wideFit,
        room,
        zoom,
      );
      const minFx = Math.min(0.49, childFrame.width / 2 / parent.w + 0.01);
      const minFy = Math.min(0.49, childFrame.height / 2 / parent.h + 0.01);
      let [fx, fy] = parentNode.portal;
      const clampedFx = clamp(fx, minFx, 1 - minFx);
      const clampedFy = clamp(fy, minFy, 1 - minFy);
      if (clampedFx !== fx || clampedFy !== fy) {
        warnings.push(
          `Cluster ${c + 1} (${childNode.id} in ${
            parentNode.id
          }): portal [${fx}, ${fy}] too close to edge for full-frame child; ${
            clampPortals
              ? `clamped to [${clampedFx.toFixed(3)}, ${clampedFy.toFixed(3)}]`
              : 'may expose background'
          }`,
        );
        if (clampPortals) {
          fx = clampedFx;
          fy = clampedFy;
        }
      }
      child.x = parent.x + fx * parent.w - child.w / 2;
      child.y = parent.y + fy * parent.h - child.h / 2;
    }

    const layers: PlannedLayer[] = entries.map((e) => ({
      nodeIndex: e.nodeIndex,
      sourceId: norm[e.nodeIndex].id,
      isCopy: e.isCopy,
      rect: {
        x: Math.round(e.x * 1000) / 1000,
        y: Math.round(e.y * 1000) / 1000,
        width: Math.round(e.w * 1000) / 1000,
        height: Math.round(e.h * 1000) / 1000,
      },
      subject: { x: norm[e.nodeIndex].sub[0], y: norm[e.nodeIndex].sub[1] },
    }));

    return {
      index: c,
      layers,
      maxWidth: Math.round(last.w),
      maxHeight: Math.round(last.h),
    };
  });

  // Build constant-velocity zero-pause camera timeline
  const shots: PlannedShot[] = [];
  let prevFrameH = 0;

  const scrollLength = (fromH: number, toH: number, label: string): number => {
    if (toH <= fromH) {
      throw new Error(
        `${label}: zoom-out is not monotonic (ratio too large for wide bridge/fill transition — lower ratio or use wideFit: "fill")`,
      );
    }
    return Math.max(MIN_BLOCK_LENGTH, Math.round((Math.log(toH / fromH) / speed) * 100) / 100);
  };

  for (let c = 0; c < clusters.length; c++) {
    const cluster = clusters[c];
    const hasBridgeChild = clusterSpecs[c].bridgeChildNode !== undefined;
    const hostLayerIdx = hasBridgeChild ? 1 : 0;
    const hostLayer = cluster.layers[hostLayerIdx];
    const hostNode = norm[hostLayer.nodeIndex];
    const isLastCluster = c === clusters.length - 1;

    // Cluster entry: 0.12 s linear pull-out from bridgeEndZoom -> zoom
    shots.push({
      clusterIndex: c,
      layerIndex: hostLayerIdx,
      framing: { mode: 'zoom', zoom },
      length: bridgeTime,
      arrival: 'cut',
      stay: 'pull-out',
      easing: 'linear',
    });
    prevFrameH = filledFrameSize(
      hostLayer.rect.width,
      hostLayer.rect.height,
      videoAspect,
      zoom,
    ).height;

    // If the bridge host is landscape in 'full' mode, smoothly finish pulling out to full width
    if (isFullWide(hostNode.aspect, videoAspect, wideFit)) {
      const targetH = aroundFrameSize(
        hostLayer.rect.width,
        hostLayer.rect.height,
        videoAspect,
        room,
      ).height;
      const length = scrollLength(prevFrameH, targetH, `Cluster ${c + 1} (${hostNode.id})`);
      shots.push({
        clusterIndex: c,
        layerIndex: hostLayerIdx,
        framing: { mode: 'room', room },
        length,
        arrival: 'scroll',
        stay: 'still',
        easing: 'smooth',
      });
      prevFrameH = targetH;
    }

    for (let j = hostLayerIdx + 1; j < cluster.layers.length; j++) {
      const layer = cluster.layers[j];
      const node = norm[layer.nodeIndex];
      const isClusterEnd = j === cluster.layers.length - 1;
      const endsAtBridge = isClusterEnd && (!isLastCluster || loop);

      if (endsAtBridge) {
        const targetH =
          filledFrameSize(layer.rect.width, layer.rect.height, videoAspect, zoom).height * PUSH;
        const length = scrollLength(prevFrameH, targetH, `Cluster ${c + 1} (${node.id})`);
        shots.push({
          clusterIndex: c,
          layerIndex: j,
          framing: { mode: 'bridge-end', zoom },
          length,
          arrival: 'scroll',
          stay: 'still',
          easing: 'smooth',
        });
        prevFrameH = targetH;
      } else if (isFullWide(node.aspect, videoAspect, wideFit)) {
        const targetH = aroundFrameSize(
          layer.rect.width,
          layer.rect.height,
          videoAspect,
          room,
        ).height;
        const length = scrollLength(prevFrameH, targetH, `Cluster ${c + 1} (${node.id})`);
        shots.push({
          clusterIndex: c,
          layerIndex: j,
          framing: { mode: 'room', room },
          length,
          arrival: 'scroll',
          stay: 'still',
          easing: 'smooth',
        });
        prevFrameH = targetH;
      } else {
        const targetH = filledFrameSize(
          layer.rect.width,
          layer.rect.height,
          videoAspect,
          zoom,
        ).height;
        const length = scrollLength(prevFrameH, targetH, `Cluster ${c + 1} (${node.id})`);
        shots.push({
          clusterIndex: c,
          layerIndex: j,
          framing: { mode: 'zoom', zoom },
          length,
          arrival: 'scroll',
          stay: 'still',
          easing: 'smooth',
        });
        prevFrameH = targetH;
      }
    }
  }

  const totalLength = Math.round(shots.reduce((sum, s) => sum + s.length, 0) * 100) / 100;
  return {
    clusters,
    shots,
    totalLength,
    speed: Math.round(speed * 10000) / 10000,
    bridgeTime,
    warnings,
  };
}
