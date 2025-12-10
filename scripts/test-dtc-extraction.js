#!/usr/bin/env node

/**
 * test-dtc-extraction.js - Test script for DTC extraction functionality
 *
 * Tests:
 * 1. DTC pattern extraction
 * 2. VIN extraction and validation
 * 3. PDF classification
 * 4. DTC merging for Column L
 * 5. ADAS DTC detection
 *
 * Usage: node scripts/test-dtc-extraction.js
 */

import dtcExtractor from '../services/dtcExtractor.js';
import scanProcessor from '../services/scanProcessor.js';

const LOG_TAG = '[DTC_TEST]';

// Test data
const TEST_CASES = {
  // Sample scan report text with DTCs
  preScanWithDTCs: `
    Autel MaxiSYS Diagnostic Report
    Vehicle Scan Report - Pre-Scan
    VIN: 1HGBH41JXMN109186
    Date: 12/10/2024

    ECM Module:
    DTC: P0171 - System Too Lean Bank 1
    DTC: P0300 - Random Cylinder Misfire

    BCM Module:
    DTC: B1234 - Camera Calibration Required
    DTC: U0100 - Lost Communication with ECM

    ABS Module:
    No DTCs

    ADAS Module:
    DTC: C1234 - Radar Sensor Misaligned
  `,

  // Clean scan report
  cleanScan: `
    Autel MaxiSYS Diagnostic Report
    Post-Scan Report
    VIN: 2T1BU4EE9DC073456

    All Systems Scan Complete
    No DTCs Found
    System OK

    Modules Scanned: ECM, BCM, ABS, ADAS, Airbag
    Total DTCs: 0
  `,

  // Estimate PDF text (should NOT extract DTCs)
  estimateText: `
    Caliber Collision - Oakland Park
    Repair Order: 3095
    Estimate Summary

    VIN: 5XYPH4A50PG123456
    Vehicle: 2023 Kia Sorento

    Labor Total: $4,500.00
    Parts Total: $2,800.00
    Grand Total: $7,300.00

    Repair Lines:
    R&R Front Bumper
    Refinish Hood
    R&I Headlamp
  `,

  // Post-scan report
  postScan: `
    Final Scan Report - Post-Repair
    VIN: KMTG34SC1SU153228
    Vehicle: 2025 Genesis GV80

    Post-Scan Results:
    All DTCs Cleared
    No Active Faults
    System OK
  `,
};

// Test functions
function testDTCExtraction() {
  console.log(`\n${LOG_TAG} === Testing DTC Extraction ===`);

  // Test 1: Extract DTCs from pre-scan
  const dtcs = dtcExtractor.extractDTCs(TEST_CASES.preScanWithDTCs);
  console.log(`${LOG_TAG} DTCs found: ${dtcs.length}`);
  console.log(`${LOG_TAG} DTCs: ${dtcs.join(', ')}`);

  // Expected: P0171, P0300, B1234, C1234, U0100
  const expectedDTCs = ['P0171', 'P0300', 'B1234', 'C1234', 'U0100'];
  const sortedDTCs = dtcs.sort();
  const sortedExpected = expectedDTCs.sort();

  const dtcMatch = sortedDTCs.length === sortedExpected.length &&
    sortedDTCs.every((d, i) => d === sortedExpected[i]);

  console.log(`${LOG_TAG} DTC extraction: ${dtcMatch ? 'PASS' : 'FAIL'}`);
  if (!dtcMatch) {
    console.log(`${LOG_TAG}   Expected: ${sortedExpected.join(', ')}`);
    console.log(`${LOG_TAG}   Got: ${sortedDTCs.join(', ')}`);
  }

  // Test 2: Clean scan detection
  const cleanDTCs = dtcExtractor.extractDTCs(TEST_CASES.cleanScan);
  const isClean = dtcExtractor.isCleanScan(TEST_CASES.cleanScan);
  console.log(`${LOG_TAG} Clean scan DTCs: ${cleanDTCs.length}`);
  console.log(`${LOG_TAG} isCleanScan: ${isClean}`);
  console.log(`${LOG_TAG} Clean scan detection: ${cleanDTCs.length === 0 && isClean ? 'PASS' : 'FAIL'}`);

  return dtcMatch && cleanDTCs.length === 0 && isClean;
}

function testVINExtraction() {
  console.log(`\n${LOG_TAG} === Testing VIN Extraction ===`);

  // Test 1: Extract VIN from pre-scan
  const vin1 = dtcExtractor.extractVIN(TEST_CASES.preScanWithDTCs);
  console.log(`${LOG_TAG} VIN from pre-scan: ${vin1}`);
  const vin1Pass = vin1 === '1HGBH41JXMN109186';
  console.log(`${LOG_TAG} VIN extraction 1: ${vin1Pass ? 'PASS' : 'FAIL'}`);

  // Test 2: Extract VIN from estimate
  const vin2 = dtcExtractor.extractVIN(TEST_CASES.estimateText);
  console.log(`${LOG_TAG} VIN from estimate: ${vin2}`);
  const vin2Pass = vin2 === '5XYPH4A50PG123456';
  console.log(`${LOG_TAG} VIN extraction 2: ${vin2Pass ? 'PASS' : 'FAIL'}`);

  // Test 3: VIN validation
  const validVIN = dtcExtractor.isValidVIN('1HGBH41JXMN109186');
  const invalidVIN = dtcExtractor.isValidVIN('ALLDATAREF123456');
  console.log(`${LOG_TAG} Valid VIN check: ${validVIN ? 'PASS' : 'FAIL'}`);
  console.log(`${LOG_TAG} Invalid VIN rejection: ${!invalidVIN ? 'PASS' : 'FAIL'}`);

  return vin1Pass && vin2Pass && validVIN && !invalidVIN;
}

function testADASDTCDetection() {
  console.log(`\n${LOG_TAG} === Testing ADAS DTC Detection ===`);

  // Test ADAS DTC detection
  const adasCodes = ['B1234', 'U0100', 'C1234', 'U1001'];
  const nonAdasCodes = ['P0171', 'P0300'];

  let allPass = true;

  for (const code of adasCodes) {
    const isAdas = dtcExtractor.isADASDTC(code);
    console.log(`${LOG_TAG} ${code} is ADAS: ${isAdas} (expected: true)`);
    if (!isAdas) allPass = false;
  }

  for (const code of nonAdasCodes) {
    const isAdas = dtcExtractor.isADASDTC(code);
    console.log(`${LOG_TAG} ${code} is ADAS: ${isAdas} (expected: false)`);
    if (isAdas) allPass = false;
  }

  console.log(`${LOG_TAG} ADAS DTC detection: ${allPass ? 'PASS' : 'FAIL'}`);
  return allPass;
}

function testDTCFormatting() {
  console.log(`\n${LOG_TAG} === Testing DTC Formatting ===`);

  // Test 1: Format PRE scan DTCs
  const dtcs = ['P0171', 'U0100'];
  const formatted = dtcExtractor.formatDTCsForColumn(dtcs, 'PRE');
  console.log(`${LOG_TAG} Formatted PRE: ${formatted}`);
  const prePass = formatted === 'PRE: P0171, U0100';
  console.log(`${LOG_TAG} PRE format: ${prePass ? 'PASS' : 'FAIL'}`);

  // Test 2: Format empty DTCs
  const empty = dtcExtractor.formatDTCsForColumn([], 'PRE');
  console.log(`${LOG_TAG} Formatted empty: ${empty}`);
  const emptyPass = empty === 'PRE: None';
  console.log(`${LOG_TAG} Empty format: ${emptyPass ? 'PASS' : 'FAIL'}`);

  // Test 3: Merge PRE with existing POST
  const existing = 'PRE: P0171 | POST: None';
  const merged = dtcExtractor.mergeDTCs(existing, ['U0100'], 'POST');
  console.log(`${LOG_TAG} Merged: ${merged}`);
  const mergePass = merged === 'PRE: P0171 | POST: U0100';
  console.log(`${LOG_TAG} Merge format: ${mergePass ? 'PASS' : 'FAIL'}`);

  // Test 4: Parse Column L value
  const parsed = dtcExtractor.parseDTCColumn('PRE: P0171, U0100 | POST: None');
  console.log(`${LOG_TAG} Parsed PRE: ${parsed.pre.join(', ')}`);
  console.log(`${LOG_TAG} Parsed POST: ${parsed.post.length === 0 ? 'None' : parsed.post.join(', ')}`);
  const parsePass = parsed.pre.length === 2 && parsed.post.length === 0;
  console.log(`${LOG_TAG} Parse format: ${parsePass ? 'PASS' : 'FAIL'}`);

  return prePass && emptyPass && mergePass && parsePass;
}

function testPDFClassification() {
  console.log(`\n${LOG_TAG} === Testing PDF Classification ===`);

  // Test filename-based classification
  const testCases = [
    { filename: '3095-PRESCAN.pdf', expected: 'pre_scan' },
    { filename: '3095-ENTPRE.pdf', expected: 'pre_scan' },
    { filename: 'PRE SCAN.pdf', expected: 'pre_scan' },
    { filename: '3095-POSTSCAN.pdf', expected: 'post_scan' },
    { filename: 'FINAL SCAN.pdf', expected: 'post_scan' },
    { filename: '3095.pdf', expected: 'estimate' },
    { filename: '1HGBH41JXMN109186.pdf', expected: 'revv_report' },
    { filename: 'VehID_12345.pdf', expected: 'revv_report' },
  ];

  let allPass = true;

  for (const tc of testCases) {
    const result = scanProcessor.classifyPDF(tc.filename, '');
    const pass = result === tc.expected;
    console.log(`${LOG_TAG} ${tc.filename} -> ${result} (expected: ${tc.expected}) ${pass ? 'PASS' : 'FAIL'}`);
    if (!pass) allPass = false;
  }

  // Test content-based classification
  const estimateResult = scanProcessor.classifyPDF('document.pdf', TEST_CASES.estimateText);
  const estimatePass = estimateResult === 'estimate';
  console.log(`${LOG_TAG} Content-based estimate: ${estimateResult} ${estimatePass ? 'PASS' : 'FAIL'}`);
  if (!estimatePass) allPass = false;

  const scanResult = scanProcessor.classifyPDF('document.pdf', TEST_CASES.preScanWithDTCs);
  const scanPass = scanResult === 'pre_scan';
  console.log(`${LOG_TAG} Content-based scan: ${scanResult} ${scanPass ? 'PASS' : 'FAIL'}`);
  if (!scanPass) allPass = false;

  console.log(`${LOG_TAG} PDF Classification: ${allPass ? 'PASS' : 'FAIL'}`);
  return allPass;
}

function testProcessScanReport() {
  console.log(`\n${LOG_TAG} === Testing Scan Report Processing ===`);

  // Test full scan report processing
  const result = dtcExtractor.processScanReport(TEST_CASES.preScanWithDTCs, 'PRE');

  console.log(`${LOG_TAG} DTCs: ${result.dtcs.join(', ')}`);
  console.log(`${LOG_TAG} Formatted: ${result.formatted}`);
  console.log(`${LOG_TAG} Has ADAS DTCs: ${result.hasADASDTCs}`);
  console.log(`${LOG_TAG} ADAS DTCs: ${result.adasDTCs?.join(', ') || 'None'}`);
  console.log(`${LOG_TAG} Warning: ${result.warning || 'None'}`);

  const dtcsPass = result.dtcs.length > 0;
  const formattedPass = result.formatted.startsWith('PRE:');
  const adasPass = result.hasADASDTCs === true;
  const warningPass = result.warning !== null;

  console.log(`${LOG_TAG} DTCs found: ${dtcsPass ? 'PASS' : 'FAIL'}`);
  console.log(`${LOG_TAG} Formatting: ${formattedPass ? 'PASS' : 'FAIL'}`);
  console.log(`${LOG_TAG} ADAS detection: ${adasPass ? 'PASS' : 'FAIL'}`);
  console.log(`${LOG_TAG} Warning generated: ${warningPass ? 'PASS' : 'FAIL'}`);

  return dtcsPass && formattedPass && adasPass && warningPass;
}

function testROExtraction() {
  console.log(`\n${LOG_TAG} === Testing RO Extraction from Filenames ===`);

  const testCases = [
    { filename: '3095.pdf', expected: '3095' },
    { filename: '3095-PRESCAN.pdf', expected: '3095' },
    { filename: 'RO_12345.pdf', expected: '12345' },
    { filename: 'RO-12345.pdf', expected: '12345' },
    { filename: 'PRE SCAN.pdf', expected: null },
  ];

  let allPass = true;

  for (const tc of testCases) {
    const result = scanProcessor.extractROFromFilename(tc.filename);
    const pass = result === tc.expected;
    console.log(`${LOG_TAG} ${tc.filename} -> ${result || 'null'} (expected: ${tc.expected || 'null'}) ${pass ? 'PASS' : 'FAIL'}`);
    if (!pass) allPass = false;
  }

  console.log(`${LOG_TAG} RO Extraction: ${allPass ? 'PASS' : 'FAIL'}`);
  return allPass;
}

// Main test runner
async function runTests() {
  console.log(`${LOG_TAG} Starting DTC Extraction Tests`);
  console.log(`${LOG_TAG} ================================`);

  const results = {
    dtcExtraction: testDTCExtraction(),
    vinExtraction: testVINExtraction(),
    adasDtcDetection: testADASDTCDetection(),
    dtcFormatting: testDTCFormatting(),
    pdfClassification: testPDFClassification(),
    scanProcessing: testProcessScanReport(),
    roExtraction: testROExtraction(),
  };

  console.log(`\n${LOG_TAG} ================================`);
  console.log(`${LOG_TAG} Test Results Summary`);
  console.log(`${LOG_TAG} ================================`);

  let allPassed = true;
  for (const [name, passed] of Object.entries(results)) {
    console.log(`${LOG_TAG} ${name}: ${passed ? 'PASS' : 'FAIL'}`);
    if (!passed) allPassed = false;
  }

  console.log(`${LOG_TAG} ================================`);
  console.log(`${LOG_TAG} Overall: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);

  process.exit(allPassed ? 0 : 1);
}

runTests().catch(err => {
  console.error(`${LOG_TAG} Test error:`, err);
  process.exit(1);
});
