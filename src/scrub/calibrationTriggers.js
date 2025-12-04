/**
 * calibrationTriggers.js - Comprehensive Calibration Trigger Mapping Database
 *
 * This module provides the CORRECT mapping: REPAIR OPERATIONS → REQUIRED CALIBRATIONS
 *
 * CRITICAL PRINCIPLE: A calibration is ONLY required if:
 * 1. A specific repair operation in the estimate triggers it, AND
 * 2. The vehicle is equipped with that ADAS system
 *
 * The trigger mapping is based on OEM position statements and repair procedures.
 */

import oem from '../../utils/oem/index.js';
import { loadADASCalibrationDataset } from '../../utils/oem/loader.js';
import { normalizeBrand } from '../../utils/oem/parser.js';

const LOG_TAG = '[CALIBRATION_TRIGGERS]';

/**
 * REPAIR OPERATION CATEGORIES
 * Normalized categories for repair operations detected in estimates
 */
export const REPAIR_CATEGORIES = {
  // Glass
  WINDSHIELD: 'windshield',
  REAR_GLASS: 'rear_glass',

  // Bumpers
  FRONT_BUMPER: 'front_bumper',
  REAR_BUMPER: 'rear_bumper',

  // Grille
  GRILLE: 'grille',

  // Mirrors
  SIDE_MIRROR_LEFT: 'side_mirror_left',
  SIDE_MIRROR_RIGHT: 'side_mirror_right',
  SIDE_MIRROR_EITHER: 'side_mirror', // When side not specified

  // Liftgate/Tailgate
  LIFTGATE: 'liftgate',
  TAILGATE: 'tailgate',

  // Hood
  HOOD: 'hood',

  // Quarter Panels
  QUARTER_PANEL_LEFT: 'quarter_panel_left',
  QUARTER_PANEL_RIGHT: 'quarter_panel_right',

  // Doors
  DOOR_FRONT_LEFT: 'door_front_left',
  DOOR_FRONT_RIGHT: 'door_front_right',
  DOOR_REAR_LEFT: 'door_rear_left',
  DOOR_REAR_RIGHT: 'door_rear_right',

  // Headlamps
  HEADLAMP_LEFT: 'headlamp_left',
  HEADLAMP_RIGHT: 'headlamp_right',
  HEADLAMP_EITHER: 'headlamp',

  // Tail Lamps
  TAIL_LAMP_LEFT: 'tail_lamp_left',
  TAIL_LAMP_RIGHT: 'tail_lamp_right',

  // Cameras (direct)
  FRONT_CAMERA: 'front_camera',
  REAR_CAMERA: 'rear_camera',
  SURROUND_CAMERA: 'surround_camera',

  // Radar (direct)
  FRONT_RADAR: 'front_radar',
  REAR_RADAR: 'rear_radar',
  SIDE_RADAR: 'side_radar',

  // Sensors (direct)
  BSM_SENSOR: 'bsm_sensor',
  PARKING_SENSOR_FRONT: 'parking_sensor_front',
  PARKING_SENSOR_REAR: 'parking_sensor_rear',

  // Steering/Suspension
  STEERING_COLUMN: 'steering_column',
  STEERING_GEAR: 'steering_gear',
  STEERING_WHEEL: 'steering_wheel',
  WHEEL_ALIGNMENT: 'wheel_alignment',
  SUSPENSION_FRONT: 'suspension_front',
  SUSPENSION_REAR: 'suspension_rear',
  STRUT: 'strut',
  CONTROL_ARM: 'control_arm',
  KNUCKLE: 'knuckle',
  SUBFRAME: 'subframe',

  // Modules
  MODULE_ADAS: 'module_adas',
  MODULE_ABS: 'module_abs',
  MODULE_SAS: 'module_sas',
  MODULE_EPS: 'module_eps',
  MODULE_IPMA: 'module_ipma',
  MODULE_BCM: 'module_bcm',

  // Airbags (collision indicator)
  AIRBAG_DEPLOYMENT: 'airbag_deployment',

  // Unknown
  UNKNOWN: 'unknown'
};

/**
 * OPERATION TYPES
 * Different repair operations have different calibration implications
 */
export const OPERATION_TYPES = {
  REPLACE: 'replace',      // Complete replacement - ALWAYS triggers calibration
  R_AND_R: 'r&r',          // Remove and Replace - ALWAYS triggers calibration
  R_AND_I: 'r&i',          // Remove and Install - MAY trigger calibration
  REPAIR: 'repair',        // Repair in place - SOMETIMES triggers calibration
  REFINISH: 'refinish',    // Paint only - RARELY triggers calibration
  AIM: 'aim',              // Aim/adjust - ALWAYS triggers calibration
  PROGRAM: 'program',      // Module programming - triggers initialization
  ALIGNMENT: 'alignment',  // Wheel alignment - triggers SAS reset
  SECTIONING: 'sectioning' // Panel sectioning - triggers if sensor area affected
};

/**
 * CALIBRATION TYPES
 */
export const CALIBRATION_TYPES = {
  STATIC: 'static',
  DYNAMIC: 'dynamic',
  STATIC_AND_DYNAMIC: 'static_and_dynamic',
  SELF_LEARNING: 'self_learning',
  PROGRAMMING_ONLY: 'programming_only'
};

/**
 * ADAS SYSTEMS - Canonical names for calibration systems
 */
export const ADAS_SYSTEMS = {
  FRONT_CAMERA: 'Front Camera',
  FRONT_RADAR: 'Front Radar',
  REAR_RADAR: 'Rear Radar',
  BLIND_SPOT_MONITOR: 'Blind Spot Monitor',
  SURROUND_VIEW: 'Surround View Monitor',
  REAR_CAMERA: 'Rear Camera',
  PARKING_SENSORS_FRONT: 'Front Parking Sensors',
  PARKING_SENSORS_REAR: 'Rear Parking Sensors',
  STEERING_ANGLE_SENSOR: 'Steering Angle Sensor',
  HEADLAMP_AIM: 'Headlamp Aim',
  LANE_WATCH: 'LaneWatch Camera',
  DISTRONIC: 'DISTRONIC Radar',
  EYESIGHT: 'EyeSight Cameras',
  ADAPTIVE_HEADLAMPS: 'Adaptive Headlamps',
  RIDE_HEIGHT: 'Ride Height Sensor'
};

/**
 * UNIVERSAL CALIBRATION TRIGGER MAP
 * Maps repair categories to potential calibrations
 * Each entry specifies:
 * - triggers: What calibrations this repair operation can trigger
 * - operation_types: What operation types trigger calibration
 * - conditions: Optional conditions (equipment checks)
 * - confidence: How confident we are this triggers calibration
 */
const UNIVERSAL_TRIGGER_MAP = {
  // WINDSHIELD - Almost always triggers front camera calibration
  [REPAIR_CATEGORIES.WINDSHIELD]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.FRONT_CAMERA,
        required_equipment: ['forward_camera', 'front_camera', 'eyesight', 'sensing_camera', 'adas_camera', 'multipurpose_camera'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'HIGH',
        reason: 'Forward-facing camera is mounted to windshield or windshield-adjacent bracket'
      }
    ]
  },

  // FRONT BUMPER - Triggers front radar and potentially parking sensors
  [REPAIR_CATEGORIES.FRONT_BUMPER]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.FRONT_RADAR,
        required_equipment: ['front_radar', 'acc_radar', 'adaptive_cruise', 'mwr', 'millimeter_wave'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R, OPERATION_TYPES.R_AND_I],
        confidence: 'HIGH',
        reason: 'Front radar typically mounted in or behind bumper fascia'
      },
      {
        system: ADAS_SYSTEMS.PARKING_SENSORS_FRONT,
        required_equipment: ['front_parking_sensors', 'parking_aid_front', 'ultrasonic_front'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'MEDIUM',
        reason: 'Front parking sensors mounted in bumper fascia'
      }
    ]
  },

  // REAR BUMPER - Triggers rear radar, BSM, parking sensors
  [REPAIR_CATEGORIES.REAR_BUMPER]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.REAR_RADAR,
        required_equipment: ['rear_radar', 'rear_cross_traffic', 'rcta'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R, OPERATION_TYPES.R_AND_I],
        confidence: 'HIGH',
        reason: 'Rear radar/RCTA sensors typically mounted in rear bumper corners'
      },
      {
        system: ADAS_SYSTEMS.BLIND_SPOT_MONITOR,
        required_equipment: ['blind_spot', 'bsm', 'blis', 'side_radar', 'bsi'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R, OPERATION_TYPES.R_AND_I],
        confidence: 'HIGH',
        reason: 'BSM sensors typically mounted in rear bumper corners or quarter panels',
        condition: 'bsm_in_bumper' // Some vehicles have BSM in quarter panels instead
      },
      {
        system: ADAS_SYSTEMS.PARKING_SENSORS_REAR,
        required_equipment: ['rear_parking_sensors', 'parking_aid_rear', 'ultrasonic_rear', 'back_sonar'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'HIGH',
        reason: 'Rear parking sensors mounted in bumper fascia'
      }
    ]
  },

  // GRILLE - Front radar if radar is behind grille
  [REPAIR_CATEGORIES.GRILLE]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.FRONT_RADAR,
        required_equipment: ['front_radar', 'acc_radar', 'adaptive_cruise'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'MEDIUM',
        reason: 'Some vehicles have front radar behind grille emblem or grille opening',
        condition: 'radar_behind_grille'
      }
    ]
  },

  // SIDE MIRRORS - Surround view cameras, LaneWatch, potentially BSM
  [REPAIR_CATEGORIES.SIDE_MIRROR_LEFT]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.SURROUND_VIEW,
        required_equipment: ['surround_view', '360_camera', 'around_view', 'avm', 'bird_eye'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'HIGH',
        reason: 'Surround view side cameras typically mounted in mirror housing'
      },
      {
        system: ADAS_SYSTEMS.LANE_WATCH,
        required_equipment: ['lanewatch', 'lane_watch'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'HIGH',
        reason: 'Honda LaneWatch camera in passenger mirror (RIGHT side only)',
        condition: 'lanewatch_applicable' // Only Honda, only right mirror in US
      }
    ]
  },

  [REPAIR_CATEGORIES.SIDE_MIRROR_RIGHT]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.SURROUND_VIEW,
        required_equipment: ['surround_view', '360_camera', 'around_view', 'avm', 'bird_eye'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'HIGH',
        reason: 'Surround view side cameras typically mounted in mirror housing'
      },
      {
        system: ADAS_SYSTEMS.LANE_WATCH,
        required_equipment: ['lanewatch', 'lane_watch'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'HIGH',
        reason: 'Honda LaneWatch camera in passenger (right) mirror'
      }
    ]
  },

  [REPAIR_CATEGORIES.SIDE_MIRROR_EITHER]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.SURROUND_VIEW,
        required_equipment: ['surround_view', '360_camera', 'around_view', 'avm', 'bird_eye'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'HIGH',
        reason: 'Surround view side cameras typically mounted in mirror housing'
      }
    ]
  },

  // LIFTGATE/TAILGATE - Rear camera for surround view
  [REPAIR_CATEGORIES.LIFTGATE]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.REAR_CAMERA,
        required_equipment: ['rear_camera', 'backup_camera', 'reverse_camera'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'MEDIUM',
        reason: 'Rear camera typically mounted in liftgate handle or near license plate'
      },
      {
        system: ADAS_SYSTEMS.SURROUND_VIEW,
        required_equipment: ['surround_view', '360_camera', 'around_view', 'avm'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'HIGH',
        reason: 'Surround view rear camera mounted in liftgate'
      }
    ]
  },

  [REPAIR_CATEGORIES.TAILGATE]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.REAR_CAMERA,
        required_equipment: ['rear_camera', 'backup_camera', 'reverse_camera'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'MEDIUM',
        reason: 'Rear camera typically mounted in tailgate handle or near license plate'
      },
      {
        system: ADAS_SYSTEMS.SURROUND_VIEW,
        required_equipment: ['surround_view', '360_camera', 'around_view', 'avm'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'HIGH',
        reason: 'Surround view rear camera mounted in tailgate'
      }
    ]
  },

  // QUARTER PANELS - BSM sensors (some vehicles)
  [REPAIR_CATEGORIES.QUARTER_PANEL_LEFT]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.BLIND_SPOT_MONITOR,
        required_equipment: ['blind_spot', 'bsm', 'blis', 'side_radar'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.SECTIONING],
        confidence: 'MEDIUM',
        reason: 'Some vehicles mount BSM sensors in quarter panel inner structure',
        condition: 'bsm_in_quarter'
      }
    ]
  },

  [REPAIR_CATEGORIES.QUARTER_PANEL_RIGHT]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.BLIND_SPOT_MONITOR,
        required_equipment: ['blind_spot', 'bsm', 'blis', 'side_radar'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.SECTIONING],
        confidence: 'MEDIUM',
        reason: 'Some vehicles mount BSM sensors in quarter panel inner structure',
        condition: 'bsm_in_quarter'
      }
    ]
  },

  // HEADLAMPS - Headlamp aim, AFS
  [REPAIR_CATEGORIES.HEADLAMP_LEFT]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.HEADLAMP_AIM,
        required_equipment: ['headlamp', 'afs', 'adaptive_headlamp', 'auto_leveling_headlamp'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R, OPERATION_TYPES.AIM],
        confidence: 'HIGH',
        reason: 'Headlamp replacement requires aim verification/adjustment'
      },
      {
        system: ADAS_SYSTEMS.ADAPTIVE_HEADLAMPS,
        required_equipment: ['afs', 'adaptive_front_lighting', 'matrix_led', 'dynamic_headlamp'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'HIGH',
        reason: 'Adaptive headlamp systems require calibration after replacement'
      }
    ]
  },

  [REPAIR_CATEGORIES.HEADLAMP_RIGHT]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.HEADLAMP_AIM,
        required_equipment: ['headlamp', 'afs', 'adaptive_headlamp', 'auto_leveling_headlamp'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R, OPERATION_TYPES.AIM],
        confidence: 'HIGH',
        reason: 'Headlamp replacement requires aim verification/adjustment'
      },
      {
        system: ADAS_SYSTEMS.ADAPTIVE_HEADLAMPS,
        required_equipment: ['afs', 'adaptive_front_lighting', 'matrix_led', 'dynamic_headlamp'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'HIGH',
        reason: 'Adaptive headlamp systems require calibration after replacement'
      }
    ]
  },

  // WHEEL ALIGNMENT - SAS reset
  [REPAIR_CATEGORIES.WHEEL_ALIGNMENT]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.STEERING_ANGLE_SENSOR,
        required_equipment: ['steering_angle_sensor', 'sas', 'eps', 'electric_power_steering'],
        operation_types: [OPERATION_TYPES.ALIGNMENT],
        confidence: 'HIGH',
        reason: 'Steering angle sensor requires reset/calibration after wheel alignment'
      }
    ]
  },

  // STEERING COMPONENTS - SAS calibration
  [REPAIR_CATEGORIES.STEERING_COLUMN]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.STEERING_ANGLE_SENSOR,
        required_equipment: ['steering_angle_sensor', 'sas', 'eps'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R, OPERATION_TYPES.R_AND_I],
        confidence: 'HIGH',
        reason: 'SAS is part of steering column assembly'
      }
    ]
  },

  [REPAIR_CATEGORIES.STEERING_GEAR]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.STEERING_ANGLE_SENSOR,
        required_equipment: ['steering_angle_sensor', 'sas', 'eps'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'HIGH',
        reason: 'Steering gear replacement affects steering geometry'
      }
    ]
  },

  // SUSPENSION - SAS, ride height
  [REPAIR_CATEGORIES.SUSPENSION_FRONT]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.STEERING_ANGLE_SENSOR,
        required_equipment: ['steering_angle_sensor', 'sas'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'MEDIUM',
        reason: 'Front suspension work typically requires alignment, which requires SAS reset'
      },
      {
        system: ADAS_SYSTEMS.RIDE_HEIGHT,
        required_equipment: ['ride_height_sensor', 'air_suspension', 'airmatic', 'abc'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'HIGH',
        reason: 'Suspension work on vehicles with air/active suspension requires recalibration'
      }
    ]
  },

  [REPAIR_CATEGORIES.SUSPENSION_REAR]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.RIDE_HEIGHT,
        required_equipment: ['ride_height_sensor', 'air_suspension', 'airmatic', 'abc'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'HIGH',
        reason: 'Suspension work on vehicles with air/active suspension requires recalibration'
      }
    ]
  },

  [REPAIR_CATEGORIES.STRUT]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.STEERING_ANGLE_SENSOR,
        required_equipment: ['steering_angle_sensor', 'sas'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'MEDIUM',
        reason: 'Strut replacement affects alignment, which requires SAS reset'
      }
    ]
  },

  [REPAIR_CATEGORIES.CONTROL_ARM]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.STEERING_ANGLE_SENSOR,
        required_equipment: ['steering_angle_sensor', 'sas'],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R],
        confidence: 'MEDIUM',
        reason: 'Control arm replacement affects alignment, which requires SAS reset'
      }
    ]
  },

  // DIRECT SENSOR/CAMERA WORK - Always triggers calibration
  [REPAIR_CATEGORIES.FRONT_CAMERA]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.FRONT_CAMERA,
        required_equipment: [], // Direct work - no equipment check needed
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R, OPERATION_TYPES.R_AND_I, OPERATION_TYPES.AIM],
        confidence: 'HIGH',
        reason: 'Direct camera work always requires calibration'
      }
    ]
  },

  [REPAIR_CATEGORIES.FRONT_RADAR]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.FRONT_RADAR,
        required_equipment: [],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R, OPERATION_TYPES.R_AND_I, OPERATION_TYPES.AIM],
        confidence: 'HIGH',
        reason: 'Direct radar work always requires calibration'
      }
    ]
  },

  [REPAIR_CATEGORIES.REAR_RADAR]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.REAR_RADAR,
        required_equipment: [],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R, OPERATION_TYPES.R_AND_I],
        confidence: 'HIGH',
        reason: 'Direct radar work always requires calibration'
      }
    ]
  },

  [REPAIR_CATEGORIES.BSM_SENSOR]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.BLIND_SPOT_MONITOR,
        required_equipment: [],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R, OPERATION_TYPES.R_AND_I],
        confidence: 'HIGH',
        reason: 'Direct BSM sensor work always requires calibration'
      }
    ]
  },

  [REPAIR_CATEGORIES.SURROUND_CAMERA]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.SURROUND_VIEW,
        required_equipment: [],
        operation_types: [OPERATION_TYPES.REPLACE, OPERATION_TYPES.R_AND_R, OPERATION_TYPES.R_AND_I],
        confidence: 'HIGH',
        reason: 'Direct surround camera work always requires calibration'
      }
    ]
  },

  // AIRBAG DEPLOYMENT - Indicates collision, may trigger multiple calibrations
  [REPAIR_CATEGORIES.AIRBAG_DEPLOYMENT]: {
    triggers: [
      {
        system: ADAS_SYSTEMS.FRONT_CAMERA,
        required_equipment: ['forward_camera', 'front_camera'],
        operation_types: [OPERATION_TYPES.REPLACE],
        confidence: 'HIGH',
        reason: 'Airbag deployment indicates collision - front camera requires recalibration (Honda specific)'
      },
      {
        system: ADAS_SYSTEMS.FRONT_RADAR,
        required_equipment: ['front_radar'],
        operation_types: [OPERATION_TYPES.REPLACE],
        confidence: 'MEDIUM',
        reason: 'Frontal collision may have affected radar alignment'
      }
    ]
  }
};

/**
 * OEM-SPECIFIC CALIBRATION TYPE OVERRIDES
 * Different OEMs have different calibration TYPES (static vs dynamic)
 */
const OEM_CALIBRATION_TYPES = {
  'Toyota': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'Lexus': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'Honda': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.LANE_WATCH]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.BLIND_SPOT_MONITOR]: CALIBRATION_TYPES.STATIC
  },
  'Acura': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'Nissan': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.SURROUND_VIEW]: CALIBRATION_TYPES.STATIC
  },
  'Infiniti': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.SURROUND_VIEW]: CALIBRATION_TYPES.STATIC
  },
  'Subaru': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC_AND_DYNAMIC, // Static first, then dynamic test drive
    [ADAS_SYSTEMS.STEERING_ANGLE_SENSOR]: CALIBRATION_TYPES.STATIC
  },
  'BMW': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.DYNAMIC, // BMW KAFAS uses dynamic only
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'MINI': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.DYNAMIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'Mercedes-Benz': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.DISTRONIC]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.SURROUND_VIEW]: CALIBRATION_TYPES.DYNAMIC // Mercedes 360 is dynamic
  },
  'Volkswagen': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'Audi': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'GM': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.PROGRAMMING_ONLY, // GM mostly self-calibrating with SPS
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.SELF_LEARNING,
    [ADAS_SYSTEMS.BLIND_SPOT_MONITOR]: CALIBRATION_TYPES.SELF_LEARNING,
    [ADAS_SYSTEMS.SURROUND_VIEW]: CALIBRATION_TYPES.STATIC // GDS2 learn procedure
  },
  'Chevrolet': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.PROGRAMMING_ONLY,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.SELF_LEARNING,
    [ADAS_SYSTEMS.BLIND_SPOT_MONITOR]: CALIBRATION_TYPES.SELF_LEARNING
  },
  'GMC': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.PROGRAMMING_ONLY,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.SELF_LEARNING
  },
  'Buick': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.PROGRAMMING_ONLY,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.SELF_LEARNING
  },
  'Cadillac': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.PROGRAMMING_ONLY,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.SELF_LEARNING
  },
  'Ford': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.SURROUND_VIEW]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.BLIND_SPOT_MONITOR]: CALIBRATION_TYPES.STATIC // Some models dynamic
  },
  'Lincoln': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'Stellantis': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC, // Autel approved
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'Chrysler': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'Dodge': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'Jeep': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'Ram': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'Hyundai': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'Kia': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'Genesis': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'Mazda': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.BLIND_SPOT_MONITOR]: CALIBRATION_TYPES.STATIC // Doppler simulator required
  },
  'Volvo': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC,
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  },
  'Tesla': {
    [ADAS_SYSTEMS.FRONT_CAMERA]: CALIBRATION_TYPES.STATIC_AND_DYNAMIC, // Static target + owner-initiated drive
    [ADAS_SYSTEMS.FRONT_RADAR]: CALIBRATION_TYPES.STATIC
  }
};

/**
 * Get calibration triggers for a repair operation
 * @param {string} repairCategory - The repair category from REPAIR_CATEGORIES
 * @returns {Array} - Array of potential calibration triggers
 */
export function getTriggersForRepair(repairCategory) {
  return UNIVERSAL_TRIGGER_MAP[repairCategory]?.triggers || [];
}

/**
 * Get calibration type for a brand/system combination
 * @param {string} brand - Vehicle brand
 * @param {string} system - ADAS system from ADAS_SYSTEMS
 * @returns {string} - Calibration type from CALIBRATION_TYPES
 */
export function getCalibrationType(brand, system) {
  const normalizedBrand = normalizeBrand(brand);
  const brandTypes = OEM_CALIBRATION_TYPES[normalizedBrand];

  if (brandTypes && brandTypes[system]) {
    return brandTypes[system];
  }

  // Default to static if not specified
  return CALIBRATION_TYPES.STATIC;
}

/**
 * Get all possible triggers for a specific ADAS system
 * @param {string} system - ADAS system from ADAS_SYSTEMS
 * @returns {Array} - Array of repair categories that trigger this system
 */
export function getRepairsThatTriggerSystem(system) {
  const triggeringRepairs = [];

  for (const [category, config] of Object.entries(UNIVERSAL_TRIGGER_MAP)) {
    const systemTriggers = config.triggers.filter(t => t.system === system);
    if (systemTriggers.length > 0) {
      triggeringRepairs.push({
        category,
        triggers: systemTriggers
      });
    }
  }

  return triggeringRepairs;
}

/**
 * Load OEM-specific triggers from the calibration dataset
 * This enriches the universal map with OEM-specific data
 * @param {string} brand - Vehicle brand
 * @returns {Object} - Brand-specific trigger data
 */
export function loadOEMTriggers(brand) {
  try {
    const dataset = loadADASCalibrationDataset();
    const normalizedBrand = normalizeBrand(brand);

    const brandCalibrations = dataset.filter(row =>
      normalizeBrand(row.brand) === normalizedBrand
    );

    if (brandCalibrations.length === 0) {
      return null;
    }

    const triggers = {};

    for (const cal of brandCalibrations) {
      const systemType = cal.system_type;
      const calTriggers = cal.calibration_triggers?.split(';').map(t => t.trim()).filter(t => t) || [];

      triggers[systemType] = {
        systemCode: cal.system_code,
        staticRequired: cal.static_calibration?.toLowerCase().includes('yes'),
        dynamicRequired: cal.dynamic_calibration?.toLowerCase().includes('yes'),
        triggers: calTriggers,
        targetSpecs: cal.target_specs,
        tools: cal.required_tools?.split(';').map(t => t.trim()).filter(t => t) || [],
        quirks: cal.special_quirks,
        dtcBlockers: cal.dtc_blockers
      };
    }

    return {
      brand: normalizedBrand,
      systems: triggers
    };
  } catch (err) {
    console.error(`${LOG_TAG} Error loading OEM triggers for ${brand}:`, err.message);
    return null;
  }
}

/**
 * Check if a repair operation triggers a specific calibration for a given brand
 * @param {Object} params
 * @param {string} params.brand - Vehicle brand
 * @param {string} params.repairCategory - Repair category from REPAIR_CATEGORIES
 * @param {string} params.operationType - Operation type from OPERATION_TYPES
 * @param {Array} params.vehicleEquipment - Array of ADAS features the vehicle has
 * @returns {Array} - Array of calibrations triggered
 */
export function checkCalibrationTriggered({ brand, repairCategory, operationType, vehicleEquipment = [] }) {
  const triggered = [];
  const triggers = getTriggersForRepair(repairCategory);

  if (!triggers || triggers.length === 0) {
    return triggered;
  }

  // Normalize equipment list for matching
  const normalizedEquipment = vehicleEquipment.map(e =>
    e.toLowerCase().replace(/[\s\-_]/g, '')
  );

  for (const trigger of triggers) {
    // Check if operation type triggers this calibration
    if (!trigger.operation_types.includes(operationType)) {
      continue;
    }

    // If no required equipment specified, assume direct sensor work
    if (!trigger.required_equipment || trigger.required_equipment.length === 0) {
      triggered.push({
        system: trigger.system,
        calibrationType: getCalibrationType(brand, trigger.system),
        confidence: trigger.confidence,
        reason: trigger.reason,
        triggeredBy: repairCategory,
        operationType: operationType
      });
      continue;
    }

    // Check if vehicle has required equipment
    const hasEquipment = trigger.required_equipment.some(req => {
      const normalizedReq = req.toLowerCase().replace(/[\s\-_]/g, '');
      return normalizedEquipment.some(eq =>
        eq.includes(normalizedReq) || normalizedReq.includes(eq)
      );
    });

    if (hasEquipment) {
      triggered.push({
        system: trigger.system,
        calibrationType: getCalibrationType(brand, trigger.system),
        confidence: trigger.confidence,
        reason: trigger.reason,
        triggeredBy: repairCategory,
        operationType: operationType,
        condition: trigger.condition || null
      });
    }
  }

  return triggered;
}

/**
 * Get a human-readable explanation of why a calibration is or isn't required
 * @param {Object} params
 * @param {string} params.system - ADAS system
 * @param {boolean} params.isRequired - Whether calibration is required
 * @param {string} params.reason - If required, why
 * @param {string} params.repairLine - The repair line that triggered/didn't trigger
 * @returns {string}
 */
export function getCalibrationExplanation({ system, isRequired, reason, repairLine }) {
  if (isRequired) {
    return `${system} calibration IS REQUIRED because: ${reason}. Triggered by repair line: "${repairLine}"`;
  } else {
    return `${system} calibration NOT REQUIRED for this estimate - no repair operations affect this system`;
  }
}

export default {
  REPAIR_CATEGORIES,
  OPERATION_TYPES,
  CALIBRATION_TYPES,
  ADAS_SYSTEMS,
  getTriggersForRepair,
  getCalibrationType,
  getRepairsThatTriggerSystem,
  loadOEMTriggers,
  checkCalibrationTriggered,
  getCalibrationExplanation
};
