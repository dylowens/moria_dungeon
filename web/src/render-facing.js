export function directionLabelFromVector(x, y, fallback = "south") {
  if (Math.abs(x) < 0.001 && Math.abs(y) < 0.001) {
    return fallback;
  }
  const angle = Math.atan2(y, x);
  const octant = Math.round(angle / (Math.PI / 4));
  switch (octant) {
    case 0:
      return "east";
    case 1:
      return "south-east";
    case 2:
      return "south";
    case 3:
      return "south-west";
    case 4:
    case -4:
      return "west";
    case -3:
      return "north-west";
    case -2:
      return "north";
    case -1:
      return "north-east";
    default:
      return fallback;
  }
}

export function updateEnemyFacingState({
  kind,
  previousFacing = "south",
  previousSmoothedDx = 0,
  previousSmoothedDy = 0,
  movementDx = 0,
  movementDy = 0,
}) {
  if (kind === "wisp") {
    const smoothedDx = previousSmoothedDx * 0.35 + movementDx * 0.65;
    const smoothedDy = previousSmoothedDy * 0.35 + movementDy * 0.65;
    const facing = Math.hypot(smoothedDx, smoothedDy) >= 0.01
      ? directionLabelFromVector(smoothedDx, smoothedDy, previousFacing)
      : previousFacing;
    return { facing, smoothedDx, smoothedDy };
  }

  const movedEnough = Math.hypot(movementDx, movementDy) >= 0.01;
  return {
    facing: movedEnough ? directionLabelFromVector(movementDx, movementDy, previousFacing) : previousFacing,
    smoothedDx: movementDx,
    smoothedDy: movementDy,
  };
}
