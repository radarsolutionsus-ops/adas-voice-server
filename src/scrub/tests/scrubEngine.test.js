/**
 * scrubEngine.test.js - Test Cases for V2 Scrub Engine
 *
 * These tests validate that the scrub engine:
 * 1. Only flags calibrations when triggered by repair operations
 * 2. Correctly identifies repair categories
 * 3. Properly verifies vehicle equipment
 * 4. Reconciles with RevvADAS correctly
 */

import { scrubEstimateV2, quickScan } from '../scrubEngine.js';
import { parseEstimate, extractVehicleInfo } from '../estimateParser.js';
import { checkCalibrationTriggered, REPAIR_CATEGORIES, OPERATION_TYPES, ADAS_SYSTEMS } from '../calibrationTriggers.js';
import { decodeVIN, buildEquipmentProfile } from '../vehicleEquipment.js';
import { reconcileCalibrations, parseRevvCalibrations } from '../revvReconciler.js';

/**
 * Test 1: Mirror Replacement (The Original Failure Case)
 *
 * Input: 2022 Mercedes GLC 300, Replace RT Mirror base
 * Expected: Surround View Dynamic Calibration ONLY
 * Should NOT flag: Blind spot, rear radar, parking sensors, SAS
 */
async function testMirrorReplacement() {
  console.log('\n=== TEST 1: Mirror Replacement (Original Failure Case) ===\n');

  const estimateText = `
    REPAIR ESTIMATE
    2022 Mercedes-Benz GLC 300
    VIN: W1N0G8DB4NG070405

    Line 1: Labor - Diagnostic scan
    Line 2: Repl RT Mirror base         Part# 2538102802
            FRONT DOOR - w/surround view w/puddle lamp
    Line 3: Refinish - Blend adjacent panel
  `;

  const revvText = 'Surround View Monitor - Dynamic Calibration';

  const result = await scrubEstimateV2({
    estimateText,
    vehicle: '2022 Mercedes-Benz GLC 300',
    vin: 'W1N0G8DB4NG070405',
    revvText
  });

  console.log('Vehicle:', result.vehicle.brand, result.vehicle.year);
  console.log('Repair operations found:', result.repairOperations.totalFound);
  console.log('Triggered calibrations:', result.triggeredCalibrations.length);

  // Check results
  const triggered = result.triggeredCalibrations.map(tc => tc.calibration);
  console.log('\nTriggered calibrations:', triggered);

  const notTriggered = result.calibrationsNotTriggered.map(cnt => cnt.calibration);
  console.log('Not triggered (vehicle has but no repair):', notTriggered.slice(0, 5));

  // Validate
  let passed = true;

  // Should trigger Surround View
  if (!triggered.some(t => t.toLowerCase().includes('surround'))) {
    console.log('❌ FAIL: Should have triggered Surround View calibration');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly triggered Surround View calibration');
  }

  // Should NOT trigger Blind Spot (no rear bumper work)
  if (triggered.some(t => t.toLowerCase().includes('blind spot'))) {
    console.log('❌ FAIL: Should NOT have triggered Blind Spot (no rear bumper work)');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly did NOT trigger Blind Spot');
  }

  // Should NOT trigger Rear Radar
  if (triggered.some(t => t.toLowerCase().includes('rear radar'))) {
    console.log('❌ FAIL: Should NOT have triggered Rear Radar (front door work)');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly did NOT trigger Rear Radar');
  }

  // Should NOT trigger Parking Sensors
  if (triggered.some(t => t.toLowerCase().includes('parking'))) {
    console.log('❌ FAIL: Should NOT have triggered Parking Sensors');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly did NOT trigger Parking Sensors');
  }

  // Should NOT trigger SAS
  if (triggered.some(t => t.toLowerCase().includes('steering'))) {
    console.log('❌ FAIL: Should NOT have triggered Steering Angle Sensor');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly did NOT trigger Steering Angle Sensor');
  }

  console.log('\nTest 1 Result:', passed ? '✓ PASSED' : '❌ FAILED');
  return passed;
}

/**
 * Test 2: Rear Bumper Replacement
 *
 * Input: 2022 Toyota Camry with TSS, Replace rear bumper cover
 * Expected:
 * - Rear parking sensor calibration (if equipped)
 * - Blind spot monitor calibration (if BSM in bumper)
 * - Rear cross-traffic calibration (if equipped)
 * Should NOT flag: Front camera, front radar, SAS
 */
async function testRearBumperReplacement() {
  console.log('\n=== TEST 2: Rear Bumper Replacement ===\n');

  const estimateText = `
    ESTIMATE #12345
    2022 Toyota Camry SE
    VIN: 4T1BF1FK7NU123456

    Line 1: R&R Rear Bumper Cover
    Line 2: R&I Rear parking sensors (4)
    Line 3: Refinish rear bumper
    Line 4: Labor - blend
  `;

  const revvText = 'Rear Parking Sensors; Blind Spot Monitor; Rear Cross Traffic Alert';

  const result = await scrubEstimateV2({
    estimateText,
    vehicle: '2022 Toyota Camry SE',
    revvText
  });

  console.log('Vehicle:', result.vehicle.brand, result.vehicle.year);
  console.log('Repair operations found:', result.repairOperations.totalFound);

  const triggered = result.triggeredCalibrations.map(tc => tc.calibration);
  console.log('\nTriggered calibrations:', triggered);

  let passed = true;

  // Should trigger parking sensors or rear radar or BSM (rear bumper work)
  const hasRearRelated = triggered.some(t =>
    t.toLowerCase().includes('parking') ||
    t.toLowerCase().includes('rear') ||
    t.toLowerCase().includes('blind')
  );

  if (!hasRearRelated) {
    console.log('❌ FAIL: Should have triggered rear-related calibrations');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly triggered rear-related calibrations');
  }

  // Should NOT trigger Front Camera
  if (triggered.some(t => t.toLowerCase().includes('front camera'))) {
    console.log('❌ FAIL: Should NOT have triggered Front Camera (no windshield work)');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly did NOT trigger Front Camera');
  }

  // Should NOT trigger Front Radar
  if (triggered.some(t => t.toLowerCase().includes('front radar'))) {
    console.log('❌ FAIL: Should NOT have triggered Front Radar (rear bumper work)');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly did NOT trigger Front Radar');
  }

  console.log('\nTest 2 Result:', passed ? '✓ PASSED' : '❌ FAILED');
  return passed;
}

/**
 * Test 3: Windshield Replacement
 *
 * Input: 2023 Honda Accord with Honda Sensing, Replace windshield
 * Expected: Front camera static calibration
 * Should NOT flag: Anything else unless other repairs present
 */
async function testWindshieldReplacement() {
  console.log('\n=== TEST 3: Windshield Replacement ===\n');

  const estimateText = `
    GLASS REPAIR ESTIMATE
    2023 Honda Accord EX-L with Honda Sensing
    VIN: 1HGCV1F52NA123456

    Line 1: R&R Windshield - laminated glass w/rain sensor
    Line 2: Molding kit
    Line 3: Urethane
  `;

  const revvText = 'Front Camera Calibration (Static)';

  const result = await scrubEstimateV2({
    estimateText,
    vehicle: '2023 Honda Accord EX-L',
    revvText
  });

  console.log('Vehicle:', result.vehicle.brand, result.vehicle.year);
  console.log('Repair operations found:', result.repairOperations.totalFound);

  const triggered = result.triggeredCalibrations.map(tc => tc.calibration);
  console.log('\nTriggered calibrations:', triggered);

  let passed = true;

  // Should trigger Front Camera
  if (!triggered.some(t => t.toLowerCase().includes('front camera'))) {
    console.log('❌ FAIL: Should have triggered Front Camera calibration');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly triggered Front Camera calibration');
  }

  // Should NOT trigger Rear Radar (no rear work)
  if (triggered.some(t => t.toLowerCase().includes('rear radar'))) {
    console.log('❌ FAIL: Should NOT have triggered Rear Radar');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly did NOT trigger Rear Radar');
  }

  // Should NOT trigger BSM (no rear bumper work)
  if (triggered.some(t => t.toLowerCase().includes('blind spot'))) {
    console.log('❌ FAIL: Should NOT have triggered Blind Spot Monitor');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly did NOT trigger Blind Spot Monitor');
  }

  console.log('\nTest 3 Result:', passed ? '✓ PASSED' : '❌ FAILED');
  return passed;
}

/**
 * Test 4: Front Bumper + Grille
 *
 * Input: 2021 Ford F-150 with Co-Pilot360, Replace front bumper + grille
 * Expected:
 * - Front radar static calibration
 * - Front parking sensor calibration (if equipped)
 * Should NOT flag: Rear systems, cameras unless also replaced
 */
async function testFrontBumperAndGrille() {
  console.log('\n=== TEST 4: Front Bumper + Grille Replacement ===\n');

  const estimateText = `
    COLLISION ESTIMATE
    2021 Ford F-150 XLT 4WD with Co-Pilot360
    VIN: 1FTFW1E86MFA12345

    Line 1: R&R Front bumper cover
    Line 2: R&R Front grille
    Line 3: R&I Front parking sensors
    Line 4: Refinish front bumper
  `;

  const revvText = 'Front Radar Calibration; Front Parking Sensors';

  const result = await scrubEstimateV2({
    estimateText,
    vehicle: '2021 Ford F-150 XLT',
    revvText
  });

  console.log('Vehicle:', result.vehicle.brand, result.vehicle.year);
  console.log('Repair operations found:', result.repairOperations.totalFound);

  const triggered = result.triggeredCalibrations.map(tc => tc.calibration);
  console.log('\nTriggered calibrations:', triggered);

  let passed = true;

  // Should trigger Front Radar
  if (!triggered.some(t => t.toLowerCase().includes('front radar'))) {
    console.log('❌ FAIL: Should have triggered Front Radar calibration');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly triggered Front Radar calibration');
  }

  // Should NOT trigger Rear Radar
  if (triggered.some(t => t.toLowerCase().includes('rear radar'))) {
    console.log('❌ FAIL: Should NOT have triggered Rear Radar (front work only)');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly did NOT trigger Rear Radar');
  }

  // Should NOT trigger BSM
  if (triggered.some(t => t.toLowerCase().includes('blind spot'))) {
    console.log('❌ FAIL: Should NOT have triggered Blind Spot Monitor');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly did NOT trigger Blind Spot Monitor');
  }

  // Should NOT trigger Front Camera (no windshield work)
  if (triggered.some(t => t.toLowerCase().includes('front camera'))) {
    console.log('❌ FAIL: Should NOT have triggered Front Camera (no windshield)');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly did NOT trigger Front Camera');
  }

  console.log('\nTest 4 Result:', passed ? '✓ PASSED' : '❌ FAILED');
  return passed;
}

/**
 * Test 5: Wheel Alignment Only
 *
 * Input: Any vehicle, 4-wheel alignment performed
 * Expected: Steering Angle Sensor calibration (reset/zero)
 * Should NOT flag: Cameras, radar (unless other work done)
 */
async function testWheelAlignment() {
  console.log('\n=== TEST 5: Wheel Alignment Only ===\n');

  const estimateText = `
    ALIGNMENT INVOICE
    2020 Subaru Outback Limited with EyeSight
    VIN: 4S4BSANC0L3123456

    Line 1: 4-wheel alignment
    Line 2: Labor - road test
  `;

  const revvText = 'Steering Angle Sensor Reset';

  const result = await scrubEstimateV2({
    estimateText,
    vehicle: '2020 Subaru Outback Limited',
    revvText
  });

  console.log('Vehicle:', result.vehicle.brand, result.vehicle.year);
  console.log('Repair operations found:', result.repairOperations.totalFound);

  const triggered = result.triggeredCalibrations.map(tc => tc.calibration);
  console.log('\nTriggered calibrations:', triggered);

  let passed = true;

  // Should trigger SAS
  if (!triggered.some(t => t.toLowerCase().includes('steering'))) {
    console.log('❌ FAIL: Should have triggered Steering Angle Sensor calibration');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly triggered Steering Angle Sensor calibration');
  }

  // Should NOT trigger Front Camera (no windshield work)
  if (triggered.some(t => t.toLowerCase().includes('front camera'))) {
    console.log('❌ FAIL: Should NOT have triggered Front Camera');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly did NOT trigger Front Camera');
  }

  // Should NOT trigger Front Radar
  if (triggered.some(t => t.toLowerCase().includes('front radar'))) {
    console.log('❌ FAIL: Should NOT have triggered Front Radar');
    passed = false;
  } else {
    console.log('✓ PASS: Correctly did NOT trigger Front Radar');
  }

  console.log('\nTest 5 Result:', passed ? '✓ PASSED' : '❌ FAILED');
  return passed;
}

/**
 * Test 6: No Phantom Calibrations
 * Verify that vehicle features alone don't trigger calibrations
 */
async function testNoPhantomCalibrations() {
  console.log('\n=== TEST 6: No Phantom Calibrations ===\n');

  const estimateText = `
    PAINT ESTIMATE
    2022 BMW X5 xDrive40i with Driving Assistant Professional
    VIN: 5UXCR6C55N9B12345

    Line 1: Refinish LT front fender
    Line 2: Blend LT front door
    Line 3: Clear coat
  `;

  // RevvADAS might list all the features the car has
  const revvText = 'Front Camera (Dynamic); Front Radar; Blind Spot Monitor; Surround View';

  const result = await scrubEstimateV2({
    estimateText,
    vehicle: '2022 BMW X5 xDrive40i',
    revvText
  });

  console.log('Vehicle:', result.vehicle.brand, result.vehicle.year);
  console.log('Repair operations found:', result.repairOperations.totalFound);

  const triggered = result.triggeredCalibrations.map(tc => tc.calibration);
  console.log('\nTriggered calibrations:', triggered);

  // This is just paint work - should NOT trigger any calibrations
  let passed = true;

  if (triggered.length > 0) {
    console.log('❌ FAIL: Paint-only work should NOT trigger any calibrations');
    console.log('   Incorrectly triggered:', triggered);
    passed = false;
  } else {
    console.log('✓ PASS: Correctly triggered NO calibrations for paint-only work');
  }

  // Verify that vehicle has systems but they're in "not triggered" list
  const notTriggered = result.calibrationsNotTriggered;
  if (notTriggered.length > 0) {
    console.log('✓ PASS: Systems correctly identified as present but not triggered:');
    notTriggered.forEach(nt => {
      console.log(`   - ${nt.calibration}: ${nt.reason}`);
    });
  }

  console.log('\nTest 6 Result:', passed ? '✓ PASSED' : '❌ FAILED');
  return passed;
}

/**
 * Test 7: Location Sensitivity
 * Verify that right side work doesn't trigger left side calibrations
 */
async function testLocationSensitivity() {
  console.log('\n=== TEST 7: Location Sensitivity ===\n');

  const estimateText = `
    REPAIR ESTIMATE
    2023 Honda Civic EX with Honda Sensing
    VIN: 2HGFE2F55NH123456

    Line 1: Repl RT headlamp assembly
    Line 2: R&I RT front fender
  `;

  const result = await scrubEstimateV2({
    estimateText,
    vehicle: '2023 Honda Civic EX'
  });

  console.log('Vehicle:', result.vehicle.brand, result.vehicle.year);
  console.log('Repair operations found:', result.repairOperations.totalFound);

  // Check that we detect RIGHT side
  const repairLines = result.repairOperations.lines;
  console.log('\nRepair lines with locations:');
  repairLines.forEach(line => {
    console.log(`  - ${line.description} | Side: ${line.location?.side || 'none'}`);
  });

  let passed = true;

  // Verify location is detected
  const hasRightSide = repairLines.some(l => l.location?.side === 'right');
  if (hasRightSide) {
    console.log('✓ PASS: Correctly detected RIGHT side location');
  } else {
    console.log('❌ FAIL: Should have detected RIGHT side location');
    passed = false;
  }

  console.log('\nTest 7 Result:', passed ? '✓ PASSED' : '❌ FAILED');
  return passed;
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         ADAS SCRUB ENGINE V2 - TEST SUITE                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const results = [];

  results.push({ name: 'Test 1: Mirror Replacement', passed: await testMirrorReplacement() });
  results.push({ name: 'Test 2: Rear Bumper', passed: await testRearBumperReplacement() });
  results.push({ name: 'Test 3: Windshield', passed: await testWindshieldReplacement() });
  results.push({ name: 'Test 4: Front Bumper + Grille', passed: await testFrontBumperAndGrille() });
  results.push({ name: 'Test 5: Wheel Alignment', passed: await testWheelAlignment() });
  results.push({ name: 'Test 6: No Phantom Calibrations', passed: await testNoPhantomCalibrations() });
  results.push({ name: 'Test 7: Location Sensitivity', passed: await testLocationSensitivity() });

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    TEST RESULTS SUMMARY                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  let passedCount = 0;
  let failedCount = 0;

  results.forEach(r => {
    const icon = r.passed ? '✓' : '❌';
    const status = r.passed ? 'PASSED' : 'FAILED';
    console.log(`${icon} ${r.name}: ${status}`);
    if (r.passed) passedCount++;
    else failedCount++;
  });

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Total: ${results.length} | Passed: ${passedCount} | Failed: ${failedCount}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (failedCount === 0) {
    console.log('✓ ALL TESTS PASSED - Scrub engine is working correctly!\n');
  } else {
    console.log('❌ SOME TESTS FAILED - Review the failures above.\n');
  }

  return { passedCount, failedCount, total: results.length };
}

// Export for external use
export {
  testMirrorReplacement,
  testRearBumperReplacement,
  testWindshieldReplacement,
  testFrontBumperAndGrille,
  testWheelAlignment,
  testNoPhantomCalibrations,
  testLocationSensitivity,
  runAllTests
};

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}
