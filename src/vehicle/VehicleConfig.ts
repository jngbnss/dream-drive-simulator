/**
 * 차량 파라미터. 기본 프리셋은 Mercedes-Benz GLC 300 4MATIC Coupé(C254, 2023~) 공개 제원을 참고한 추정치입니다.
 * 출처가 확인되지 않은 값은 "추정"으로 표시합니다. (docs/02-vehicle-physics.md)
 */
export interface VehicleConfig {
  massKg: number;
  /** 섀시 로컬 기준 무게중심 높이 (서스펜션 장착점 기준, m) */
  comY: number;
  length: number;
  width: number;
  wheelbase: number;
  track: number;
  wheelRadius: number;
  /** 정차 시 서스펜션 장착점의 지면 높이 (시각 모델 정렬용) */
  rideHeight: number;
  suspension: { restLength: number; maxTravel: number; stiffness: number; compression: number; relaxation: number };
  tire: { frictionSlip: number; sideFrictionStiffness: number };
  engine: { idleRpm: number; redlineRpm: number; torqueCurve: [number, number][] };
  gearbox: { ratios: number[]; reverse: number; finalDrive: number; efficiency: number; upshiftRpm: number; downshiftRpm: number; shiftTime: number };
  /** 앞바퀴 토크 비율 (4MATIC 참고: 약 0.45, 추정) */
  frontTorqueSplit: number;
  maxBrakeForceN: number;
  steering: { maxAngleRad: number; highSpeedAngleRad: number; falloffSpeed: number };
  aero: { cdA: number; rollingResistance: number };
  topSpeedKmh: number;
}

export const GLC_COUPE_INSPIRED: VehicleConfig = {
  massKg: 1900, // 공차중량 약 1.8~1.9t (추정)
  comY: -0.2,
  length: 4.76, // 4,764mm
  width: 1.89, // 1,890mm
  wheelbase: 2.89, // 2,888mm
  track: 1.63, // 추정
  wheelRadius: 0.36, // 235/50 R19 근사
  rideHeight: 0.62,
  suspension: { restLength: 0.32, maxTravel: 0.2, stiffness: 32, compression: 3.2, relaxation: 3.6 },
  tire: { frictionSlip: 2.2, sideFrictionStiffness: 1.0 },
  engine: {
    idleRpm: 800,
    redlineRpm: 6300,
    // 2.0L 직렬 4기통 터보 + 48V ISG: 258hp / 400Nm (1,800–4,000rpm 평탄 토크, 추정 곡선)
    torqueCurve: [
      [800, 220], [1500, 330], [1800, 400], [4000, 400], [5000, 365], [5800, 318], [6300, 285],
    ],
  },
  gearbox: {
    // 9G-TRONIC 기어비 (공개 자료 기반 근사)
    ratios: [5.35, 3.24, 2.25, 1.64, 1.21, 1.0, 0.86, 0.72, 0.6],
    reverse: 4.8,
    finalDrive: 2.65,
    efficiency: 0.88,
    upshiftRpm: 5800,
    downshiftRpm: 1900,
    shiftTime: 0.18,
  },
  frontTorqueSplit: 0.45,
  maxBrakeForceN: 19000,
  steering: { maxAngleRad: 0.6, highSpeedAngleRad: 0.12, falloffSpeed: 32 },
  aero: { cdA: 0.31 * 2.55, rollingResistance: 0.013 },
  topSpeedKmh: 240,
};
